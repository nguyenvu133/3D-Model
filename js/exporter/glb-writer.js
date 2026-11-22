/* ============================================================
 * exporter/glb-writer.js — GLB Writer riêng của Studio (v2)
 * Viết GLB chuẩn glTF 2.0 với 2 CHẾ ĐỘ TƯƠNG THÍCH:
 *
 *   compatTarget: 'universal'  ← meshy.ai / tripo3d.ai / Blender / Sketchfab
 *     • KHÔNG extension bắt buộc nào (extensionsRequired rỗng)
 *     • texture chỉ image/jpeg + image/png (spec core)
 *     • f32 positions/normals/uv — mọi loader phổ thông đọc được
 *
 *   compatTarget: 'web'        ← three.js app của bạn (nhỏ nhất)
 *     • quantize int8/uint16 (KHR_mesh_quantization)
 *     • meshopt server encode (EXT_meshopt_compression)
 *     • texture WebP (+ fallback JPEG theo EXT_texture_webp khi universal)
 *
 * Tối ưu vẫn thật: weld vertices, u16 indices khi ≤65K, texture resize.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;

  const DEFAULTS = {
    compatTarget: 'universal',   // 'universal' | 'web'
    tripoFormat: false,          // true = mirror định dạng tripo_convert GLB (f32 + u16 + JPEG + specular ext)
    weldVertices: false,         // mặc định OFF để không rách mesh; bật với weldMode
    weldMode: 'exact',           // 'exact' (chỉ gộp đỉnh trùng bit) | 'tight' | 'loose'
    quantizeNormals: false,      // universal OFF — chỉ bật cho target web
    quantizeUV: false,
    prefer16bitIndices: true,    // u16 là spec CORE — an toàn mọi loader
    force16bitIndices: false,    // tripoFormat: ép u16 (nếu verts > 65535 sẽ sai — cẩn thận)
    textureMaxSize: 0,           // 0 = GIỮ NGUYÊN kích thước texture (không vỡ hình)
    textureFormat: 'auto',       // 'auto' | 'jpeg' | 'png' | 'webp'
    textureQuality: 0.92,
    flipTextures: 'auto'
  };

  /* UUID ngắn kiểu Tripo */
  function tripoUUID() {
    let s = '';
    for (let i = 0; i < 32; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
    return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20, 32);
  }

  const MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;

  /* PNG 1×1 trong suốt — fallback giữ index ổn định */
  const TINY_PNG = new Uint8Array([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
    0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x62, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
  ]);

  const GLBWriter = { defaults: Object.assign({}, DEFAULTS) };

  /* ============================================================
     VERTEX WELD — 3 chế độ:
       exact: chỉ gộp đỉnh TRÙNG TUYỆT ĐỐI (bit-for-bit) — an toàn 100% mesh
       tight: round 1e7 — gộp thêm đỉnh gần trùng tuyệt đối
       loose: round 1e5 — gộp mạnh (cần kiểm tra mesh)
     ============================================================ */
  function weldGeometry(pos, nor, uv, uv2, col, idx, weldMode) {
    const map = new Map();
    const remap = new Int32Array(pos.length / 3).fill(-1);
    const newPos = [], newNor = [], newUv = [], newUv2 = [], newCol = [];
    let newCount = 0;

    const buildKey = function (vi) {
      let k;
      if (weldMode === 'exact') {
        /* bit-for-bit: dùng giá trị nguyên gốc */
        k = pos[vi * 3] + ',' + pos[vi * 3 + 1] + ',' + pos[vi * 3 + 2];
        if (nor) k += '|' + nor[vi * 3] + ',' + nor[vi * 3 + 1] + ',' + nor[vi * 3 + 2];
        if (uv) k += '|' + uv[vi * 2] + ',' + uv[vi * 2 + 1];
        if (uv2) k += '|' + uv2[vi * 2] + ',' + uv2[vi * 2 + 1];
        if (col) k += '|' + col[vi * 4] + ',' + col[vi * 4 + 1] + ',' + col[vi * 4 + 2] + ',' + (col[vi * 4 + 3] || 1);
        return k;
      }
      const pR = weldMode === 'tight' ? 1e7 : 1e5;
      const nR = weldMode === 'tight' ? 1e6 : 1e3;
      const tR = weldMode === 'tight' ? 1e7 : 1e4;
      k = Math.round(pos[vi * 3] * pR) + ',' + Math.round(pos[vi * 3 + 1] * pR) + ',' + Math.round(pos[vi * 3 + 2] * pR);
      if (nor) k += '|' + Math.round(nor[vi * 3] * nR) + Math.round(nor[vi * 3 + 1] * nR) + Math.round(nor[vi * 3 + 2] * nR);
      if (uv) k += '|' + Math.round(uv[vi * 2] * tR) + ',' + Math.round(uv[vi * 2 + 1] * tR);
      if (uv2) k += '|' + Math.round(uv2[vi * 2] * tR) + Math.round(uv2[vi * 2 + 1] * tR);
      if (col) k += '|' + Math.round(col[vi * 4] * 255) + Math.round(col[vi * 4 + 1] * 255) + Math.round(col[vi * 4 + 2] * 255) + Math.round((col[vi * 4 + 3] || 1) * 255);
      return k;
    };

    for (let vi = 0; vi < pos.length / 3; vi++) {
      const key = buildKey(vi);
      let mapped = map.get(key);
      if (mapped === undefined) {
        mapped = newCount++;
        map.set(key, mapped);
        newPos.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
        if (nor) newNor.push(nor[vi * 3], nor[vi * 3 + 1], nor[vi * 3 + 2]);
        if (uv) newUv.push(uv[vi * 2], uv[vi * 2 + 1]);
        if (uv2) newUv2.push(uv2[vi * 2], uv2[vi * 2 + 1]);
        if (col) newCol.push(col[vi * 4], col[vi * 4 + 1], col[vi * 4 + 2], col[vi * 4 + 3] !== undefined ? col[vi * 4 + 3] : 1);
      }
      remap[vi] = mapped;
    }

    const newIdx = new Uint32Array(idx.length);
    for (let i = 0; i < idx.length; i++) newIdx[i] = remap[idx[i]];

    return {
      position: new Float32Array(newPos),
      normal: nor ? new Float32Array(newNor) : null,
      uv: uv ? new Float32Array(newUv) : null,
      uv2: uv2 ? new Float32Array(newUv2) : null,
      color: col ? new Float32Array(newCol) : null,
      index: newIdx,
      vertCount: newCount
    };
  }

  /* ============================================================
     TEXTURE PIPELINE — resize + re-encode, alpha-aware, spec-safe
     Trả về { primary, fallback?, alpha }
     ============================================================ */
  function encodeTexture(threeTexture, opts, textureName) {
    return new Promise(function (resolve) {
      /* EXPORT dùng ORIGINAL full-res image (display có thể đã downscale) */
      const img = (threeTexture && threeTexture.userData && threeTexture.userData.originalImage) ||
                  (threeTexture && threeTexture.image);
      if (!img || !(img.width > 0)) { resolve(null); return; }

      const srcW = img.width, srcH = img.height;
      let dstW = srcW, dstH = srcH;
      if (opts.textureMaxSize > 0 && Math.max(srcW, srcH) > opts.textureMaxSize) {
        const scale = opts.textureMaxSize / Math.max(srcW, srcH);
        dstW = Math.max(1, Math.round(srcW * scale));
        dstH = Math.max(1, Math.round(srcH * scale));
      }

      const canvas = document.createElement('canvas');
      canvas.width = dstW; canvas.height = dstH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      if (opts.flipTextures === 'auto' && threeTexture.flipY === true) {
        ctx.translate(0, dstH);
        ctx.scale(1, -1);
      }
      try {
        ctx.drawImage(img, 0, 0, dstW, dstH);
      } catch (e) {
        console.warn('[GLBWriter] texture tainted, bỏ qua:', textureName);
        resolve(null); return;
      }

      /* Alpha check (rẻ: quét canvas — catch tainted) */
      let hasAlpha = false;
      try {
        const data = ctx.getImageData(0, 0, Math.min(dstW, 256), Math.min(dstH, 256)).data;
        /* downsample quét: chỉ cần một pixel alpha < 250 */
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] < 250) { hasAlpha = true; break; }
        }
      } catch (e) { hasAlpha = false; }

      const universal = opts.compatTarget !== 'web';
      let fmt = opts.textureFormat || 'auto';
      if (fmt === 'keep') fmt = 'auto';
      const isNormal = /normal/i.test(textureName || '');

      /* --- chọn mime PRIMARY: normal map KHÔNG bao giờ dùng JPEG (phá normal) --- */
      let mime;
      if (isNormal && (fmt === 'jpeg' || fmt === 'auto')) {
        mime = 'image/png';
      } else if (fmt === 'png') mime = 'image/png';
      else if (fmt === 'jpeg') mime = hasAlpha ? 'image/png' : 'image/jpeg';
      else if (fmt === 'webp') mime = 'image/webp';
      else /* auto */ mime = hasAlpha ? 'image/png' : 'image/jpeg';

      /* quality: normal map luôn ≥0.96 để không banding */
      const quality = isNormal ? Math.max(opts.textureQuality, 0.96) : opts.textureQuality;

      const toBlob = function (m, q) {
        return new Promise(function (res) {
          canvas.toBlob(function (b) {
            if (!b) { res(null); return; }
            b.arrayBuffer().then(function (ab) {
              res({ bytes: new Uint8Array(ab), mimeType: m, width: dstW, height: dstH });
            });
          }, m, q);
        });
      };

      const primaryP = toBlob(mime, mime === 'image/webp' || mime === 'image/jpeg' ? quality : undefined);

      /* --- WebP KHÔNG phải mime lõi của glTF 2.0: `texture.source` BẮT BUỘC là
         image/jpeg hoặc image/png. WebP chỉ hợp lệ trong extensions.EXT_texture_webp.source,
         còn source lõi phải là bản fallback JPEG/PNG.
         Trước đây target 'web' ghi thẳng webp vào source → Khronos Validator báo
         TEXTURE_INVALID_IMAGE_MIME_TYPE + IMAGE_NON_ENABLED_MIME_TYPE (11 lỗi),
         và Meshy/Tripo/Blender/Unity hiển thị TRẮNG vì không đọc được texture.
         Nay: LUÔN tạo fallback lõi cho webp, bất kể target. */
      let fallbackP = Promise.resolve(null);
      if (mime === 'image/webp') {
        const fbMime = isNormal ? 'image/png' : (hasAlpha ? 'image/png' : 'image/jpeg');
        fallbackP = toBlob(fbMime, fbMime === 'image/jpeg' ? quality : undefined);
      }

      Promise.all([primaryP, fallbackP]).then(function (res) {
        if (!res[0] && !res[1]) { resolve(null); return; }
        /* webp hỏng nhưng fallback ok → dùng fallback làm ảnh chính */
        if (!res[0] && res[1]) {
          resolve({ primary: res[1], fallback: null, alpha: hasAlpha, originalWidth: srcW, originalHeight: srcH });
          return;
        }
        resolve({
          primary: res[0],
          fallback: res[1],
          alpha: hasAlpha,
          originalWidth: srcW, originalHeight: srcH
        });
      });
    });
  }

  /* ============================================================
     MAIN WRITE
     ============================================================ */
  GLBWriter.write = function (object3D, options) {
    const opts = Object.assign({}, GLBWriter.defaults, options || {});
    const universal = opts.compatTarget !== 'web';
    if (opts.tripoFormat) {
      /* Mirror tripo_convert GLB: f32 thuần + u16 indices + JPEG + không extension required */
      opts.quantizeNormals = false;
      opts.quantizeUV = false;
      opts.textureMaxSize = opts.textureMaxSize || 0;
      opts.textureFormat = 'jpeg';
      opts.textureQuality = Math.max(opts.textureQuality || 0.9, 0.9);
      opts.force16bitIndices = true;
    }
    const tripoUUIDStr = tripoUUID();
    return new Promise(function (resolve, reject) {
      if (!window.THREE) { reject(new Error('THREE chưa sẵn sàng')); return; }

      /* Thu thập meshes — BỎ mesh trang trí của bone (octahedron/joint sphere) và
         SkeletonHelper. Trước đây chúng bị ghi vào file: model rig xong export ra
         kèm ~24 khối tím + cầu xanh → "nhân vật bị lỗi" khi mở ở Meshy/Blender. */
      const meshes = [];
      object3D.updateMatrixWorld(true);
      object3D.traverse(function (o) {
        if (!o.isMesh) return;
        if (o.userData && (o.userData.isBoneVisual || o.userData.skipSkinExport)) return;
        meshes.push(o);
      });
      if (!meshes.length) { reject(new Error('Không có mesh nào trong object')); return; }

      const stats = { vertsBefore: 0, trisBefore: 0, vertsAfter: 0, trisAfter: 0, textures: [] };

      /* Buffer assembly */
      const binParts = [];
      let binCursor = 0;
      const place = function (bytes) {
        const pad = (4 - (binCursor % 4)) % 4;
        if (pad) { binParts.push(new Uint8Array(pad)); binCursor += pad; }
        const loc = { byteOffset: binCursor, byteLength: bytes.length };
        binParts.push(bytes);
        binCursor += bytes.length;
        return loc;
      };

      const json = {
        asset: { version: '2.0', generator: 'PixiJS Studio × Tripo3D AI Studio v20.0 — GLB Writer (compat: ' + (universal ? 'universal' : 'web') + (opts.tripoFormat ? ' · tripoGLB' : '') + ')' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [],
        meshes: [],
        accessors: [],
        bufferViews: [],
        materials: [],
        textures: [],
        images: [],
        samplers: [],
        buffers: [],
        skins: []
      };
      const extsUsed = new Set();

      /* ---------- TEXTURE CACHE ---------- */
      const texCache = new Map();      // threeTex.uuid → textureIndex
      const textureJobs = [];          // {textureIndex, promise, name, threeTex}

      function pushImage(enc) {
        const loc = place(enc.bytes);
        const imageIndex = json.images.length;
        json.images.push({ mimeType: enc.mimeType, bufferView: json.bufferViews.length, name: 'tex' + imageIndex });
        json.bufferViews.push({ buffer: 0, byteOffset: loc.byteOffset, byteLength: loc.byteLength });
        return imageIndex;
      }

      function ensureTexture(threeTex, name) {
        if (!threeTex || !threeTex.image) return -1;
        if (texCache.has(threeTex.uuid)) return texCache.get(threeTex.uuid);
        const texIndex = json.textures.length;
        texCache.set(threeTex.uuid, texIndex);
        json.textures.push({ sampler: 0, source: -1 });   // placeholder — gán sau khi encode
        textureJobs.push({ textureIndex: texIndex, promise: encodeTexture(threeTex, opts, name || 'texture_' + texIndex), name: name || 'texture_' + texIndex, threeTex: threeTex });
        return texIndex;
      }

      json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });

      /* ---------- MATERIALS ---------- */
      const matCache = new Map();

      meshes.forEach(function (mesh) {
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (!mat || matCache.has(mat.uuid)) return;
        matCache.set(mat.uuid, json.materials.length);

        const mIndex = json.materials.length;
        const pbr = {
          metallicFactor: mat.metalness !== undefined ? mat.metalness : 0.5,
          roughnessFactor: mat.roughness !== undefined ? mat.roughness : 0.5
        };
        const matDef = { name: (opts.tripoFormat ? 'tripo_mat_' + tripoUUIDStr : (mat.name || 'material_' + mIndex)).slice(0, 80), pbrMetallicRoughness: pbr };

        if (mat.map) {
          const ti = ensureTexture(mat.map, 'baseColor_' + mIndex);
          pbr.baseColorTexture = { index: ti };
        }
        if (mat.color && !(mat.map && mat.color.getHex() === 0xffffff)) {
          pbr.baseColorFactor = [mat.color.r, mat.color.g, mat.color.b, mat.opacity !== undefined ? mat.opacity : 1];
        }
        if (mat.metalnessMap && mat.metalnessMap === mat.roughnessMap) {
          pbr.metallicRoughnessTexture = { index: ensureTexture(mat.metalnessMap, 'orm_' + mIndex) };
        } else if (mat.roughnessMap) {
          pbr.metallicRoughnessTexture = { index: ensureTexture(mat.roughnessMap, 'roughness_' + mIndex) };
        }
        if (mat.normalMap) {
          matDef.normalTexture = { index: ensureTexture(mat.normalMap, 'normal_' + mIndex) };
        }
        if (mat.aoMap && mat.aoMap !== mat.roughnessMap) {
          matDef.occlusionTexture = { index: ensureTexture(mat.aoMap, 'ao_' + mIndex) };
        }
        if (mat.emissiveMap) {
          matDef.emissiveTexture = { index: ensureTexture(mat.emissiveMap, 'emissive_' + mIndex) };
        }
        if (mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0) {
          matDef.emissiveFactor = [mat.emissive.r, mat.emissive.g, mat.emissive.b];
        }
        if (mat.transparent) matDef.alphaMode = 'BLEND';
        else if (mat.alphaTest > 0) { matDef.alphaMode = 'MASK'; matDef.alphaCutoff = mat.alphaTest; }
        if (mat.side === THREE.DoubleSide) matDef.doubleSided = true;

        /* tripoFormat: KHR_materials_specular như file tripo_convert */
        if (opts.tripoFormat) {
          matDef.extensions = { KHR_materials_specular: { specularColorFactor: [1, 1, 1], specularFactor: 0.5 } };
          extsUsed.add('KHR_materials_specular');
        }

        json.materials.push(matDef);
      });

      /* ---------- GEOMETRY → MESHES/ACCESSORS ---------- */
      const nodeIndex = json.nodes.length;
      json.nodes.push({ name: (object3D.name || 'root').slice(0, 80), children: [] });

      const weldMode = opts.weldMode || 'exact';

      meshes.forEach(function (mesh, mi) {
        const geo = mesh.geometry;
        const indexAttr = geo.index;
        const posAttr = geo.attributes.position;
        if (!posAttr) return;

        let pos = new Float32Array(posAttr.array);
        let nor = geo.attributes.normal ? new Float32Array(geo.attributes.normal.array) : null;
        let uvA = geo.attributes.uv ? new Float32Array(geo.attributes.uv.array) : null;
        let uv2A = geo.attributes.uv2 ? new Float32Array(geo.attributes.uv2.array) : null;
        let colA = geo.attributes.color ? new Float32Array(geo.attributes.color.array) : null;
        let idx = indexAttr
          ? new Uint32Array(indexAttr.array)
          : (function () {
            const seq = new Uint32Array(pos.length / 3);
            for (let i = 0; i < seq.length; i++) seq[i] = i;
            return seq;
          })();

        stats.vertsBefore += pos.length / 3;
        stats.trisBefore += idx.length / 3;

        if (opts.weldVertices) {
          const w = weldGeometry(pos, nor, uvA, uv2A, colA, idx, weldMode);
          pos = w.position; nor = w.normal; uvA = w.uv; uv2A = w.uv2; colA = w.color; idx = w.index;
        }

        /* Quantize normals → int8 (CHỈ target web) */
        let norData = null;
        let norQuant = false;
        if (nor) {
          if (opts.quantizeNormals) {
            const q = new Int8Array(nor.length);
            for (let i = 0; i < nor.length; i++) {
              q[i] = Math.max(-127, Math.min(127, Math.round(nor[i] * 127)));
            }
            norData = q;
            norQuant = true;
            extsUsed.add('KHR_mesh_quantization');
          } else {
            norData = new Uint8Array(nor.buffer, nor.byteOffset, nor.byteLength);
          }
        }

        /* Quantize UV → uint16 (CHỈ target web) */
        let uvData = null;
        let uvQuant = false;
        if (uvA) {
          if (opts.quantizeUV) {
            const q = new Uint16Array(uvA.length);
            for (let i = 0; i < uvA.length; i++) {
              q[i] = Math.max(0, Math.min(65535, Math.round(uvA[i] * 65535)));
            }
            uvData = q;
            uvQuant = true;
            extsUsed.add('KHR_mesh_quantization');
          } else {
            uvData = new Uint8Array(uvA.buffer, uvA.byteOffset, uvA.byteLength);
          }
        }

        /* Indices 16-bit khi đủ nhỏ (u16 = spec core — an toàn mọi loader) */
        let idxComponent = 5125;
        let idxBytes = new Uint8Array(idx.buffer, idx.byteOffset, idx.length * 4);
        let maxVert = 0;
        for (let i = 0; i < idx.length; i++) if (idx[i] > maxVert) maxVert = idx[i];
        maxVert += 1;
        if ((opts.prefer16bitIndices || opts.force16bitIndices) && maxVert <= 65535) {
          const u16 = new Uint16Array(idx.length);
          for (let i = 0; i < idx.length; i++) u16[i] = idx[i];
          idxBytes = new Uint8Array(u16.buffer, u16.byteOffset, u16.byteLength);
          idxComponent = 5123;
        }

        /* POSITION min/max */
        let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < pos.length / 3; i++) {
          const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }

        /* Accessors + bufferViews */
        const accPos = json.accessors.length;
        json.accessors.push({
          bufferView: json.bufferViews.length,
          componentType: 5126, count: pos.length / 3, type: 'VEC3',
          min: [minX, minY, minZ], max: [maxX, maxY, maxZ]
        });
        json.bufferViews.push(Object.assign({ buffer: 0, byteLength: pos.byteLength, target: 34962 }, place(new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength))));
        const attrs = { POSITION: accPos };

        if (norData) {
          const accNor = json.accessors.length;
          /* glTF accessor count = số ĐỈNH (không phải số components!) */
          const accDef = { bufferView: json.bufferViews.length, count: nor.length / 3, type: 'VEC3' };
          if (norQuant) { accDef.componentType = 5120; accDef.normalized = true; }
          else accDef.componentType = 5126;
          json.accessors.push(accDef);
          json.bufferViews.push(Object.assign({ buffer: 0, byteLength: norData.byteLength, target: 34962 }, place(norData)));
          attrs.NORMAL = accNor;
        }

        if (uvData) {
          const accUv = json.accessors.length;
          const accDef = { bufferView: json.bufferViews.length, count: uvA.length / 2, type: 'VEC2' };
          if (uvQuant) { accDef.componentType = 5123; accDef.normalized = true; }
          else accDef.componentType = 5126;
          json.accessors.push(accDef);
          json.bufferViews.push(Object.assign({ buffer: 0, byteLength: uvData.byteLength, target: 34962 }, place(uvData)));
          attrs.TEXCOORD_0 = accUv;
        }

        if (colA) {
          const accCol = json.accessors.length;
          json.accessors.push({ bufferView: json.bufferViews.length, componentType: 5126, count: colA.length / 4, type: 'VEC4' });
          json.bufferViews.push(Object.assign({ buffer: 0, byteLength: colA.byteLength, target: 34962 }, place(new Uint8Array(colA.buffer, colA.byteOffset, colA.byteLength))));
          attrs.COLOR_0 = accCol;
        }

        const accIdx = json.accessors.length;
        json.accessors.push({ bufferView: json.bufferViews.length, componentType: idxComponent, count: idx.length, type: 'SCALAR' });
        json.bufferViews.push(Object.assign({ buffer: 0, byteLength: idxBytes.byteLength, target: 34963 }, place(idxBytes)));

        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const matIndex = mat && matCache.has(mat.uuid) ? matCache.get(mat.uuid) : undefined;

        const meshDef = {
          name: (opts.tripoFormat ? 'tripo_mesh_' + tripoUUIDStr : (mesh.name || 'mesh_' + mi)).slice(0, 80),
          primitives: [{ mode: 4, attributes: attrs, indices: accIdx }]
        };
        if (matIndex !== undefined) meshDef.primitives[0].material = matIndex;
        json.meshes.push(meshDef);

        const nodeDef = { mesh: json.meshes.length - 1, name: (mesh.name || 'node_' + mi).slice(0, 80) };
        if (mesh !== object3D) {
          const p = mesh.position, q = mesh.quaternion, s = mesh.scale;
          if (p.lengthSq() > 0) nodeDef.translation = [p.x, p.y, p.z];
          if (q.x !== 0 || q.y !== 0 || q.z !== 0 || q.w !== 1) nodeDef.rotation = [q.x, q.y, q.z, q.w];
          if (s.x !== 1 || s.y !== 1 || s.z !== 1) nodeDef.scale = [s.x, s.y, s.z];
        }
        json.nodes.push(nodeDef);
        json.nodes[nodeIndex].children.push(json.nodes.length - 1);

        stats.vertsAfter += pos.length / 3;
        stats.trisAfter += idx.length / 3;
      });

      if (json.nodes[0].children.length === 1) {
        const child = json.nodes[json.nodes[0].children[0]];
        json.nodes[0].mesh = child.mesh;
        json.nodes[0].name = child.name;
        delete json.nodes[0].children;
        json.nodes.length = 1;
      }

      /* ---------- Chờ textures encode → gán images đúng spec ---------- */
      bus.emit('notify', { type: 'info', title: 'GLB Writer', message: 'Đang encode ' + textureJobs.length + ' texture (' + (universal ? 'universal: jpeg/png' : 'web: webp/meshopt') + ')…' });

      Promise.all(textureJobs.map(function (j) { return j.promise; })).then(function (encodedList) {
        encodedList.forEach(function (enc, i) {
          const job = textureJobs[i];
          const texDef = json.textures[job.textureIndex];

          if (!enc || !enc.primary) {
            /* texture lỗi — PNG 1×1 để không lệch index */
            texDef.source = pushImage({ bytes: TINY_PNG, mimeType: 'image/png', width: 1, height: 1 });
            stats.textures.push({ name: job.name, before: '?', after: '1×1 (skipped/tainted)', format: 'image/png', size: TINY_PNG.length });
            return;
          }

          const primaryIdx = pushImage(enc.primary);
          if (enc.fallback) {
            /* WebP đúng spec: texture.source = fallback, EXT_texture_webp.source = webp */
            const fbIdx = pushImage(enc.fallback);
            texDef.source = fbIdx;
            texDef.extensions = { EXT_texture_webp: { source: primaryIdx } };
            extsUsed.add('EXT_texture_webp');
          } else {
            texDef.source = primaryIdx;
          }

          stats.textures.push({
            name: job.name,
            before: job.threeTex.image ? (job.threeTex.image.width + '×' + job.threeTex.image.height) : '?',
            after: enc.primary.width + '×' + enc.primary.height,
            format: enc.primary.mimeType,
            size: enc.primary.bytes.length,
            alpha: enc.alpha,
            fallback: !!enc.fallback
          });
        });

        /* Không ghi mảng skins rỗng: Khronos Validator coi đây là EMPTY_ENTITY. */
        if (!json.skins || !json.skins.length) delete json.skins;
        if (extsUsed.size) json.extensionsUsed = Array.from(extsUsed);
        /* extensionsRequired: cố ý KHÔNG ghi — tối đa tương thích */

        /* ---------- BIN + GLB ---------- */
        const binPad = (4 - (binCursor % 4)) % 4;
        const binTotal = binCursor + binPad;
        const binData = new Uint8Array(binTotal);
        let cur = 0;
        binParts.forEach(function (p) { binData.set(p, cur); cur += p.length; });
        json.buffers = [{ byteLength: binTotal }];

        const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
        const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
        const totalLen = 12 + 8 + jsonBytes.length + jsonPad + 8 + binTotal;

        const out = new ArrayBuffer(totalLen);
        const dv = new DataView(out);
        dv.setUint32(0, MAGIC, true);
        dv.setUint32(4, 2, true);
        dv.setUint32(8, totalLen, true);
        dv.setUint32(12, jsonBytes.length + jsonPad, true);
        dv.setUint32(16, CHUNK_JSON, true);
        new Uint8Array(out, 20).set(jsonBytes);
        for (let i = 0; i < jsonPad; i++) new Uint8Array(out, 20 + jsonBytes.length, jsonPad)[i] = 0x20;
        let w = 20 + jsonBytes.length + jsonPad;
        dv.setUint32(w, binTotal, true);
        dv.setUint32(w + 4, CHUNK_BIN, true);
        new Uint8Array(out, w + 8).set(binData);

        const blob = new Blob([out], { type: 'model/gltf-binary' });
        resolve({
          blob: blob,
          report: Object.assign(stats, {
            sizeBytes: blob.size,
            geometryBytes: binTotal,
            compatTarget: universal ? 'universal' : 'web',
            extensionsUsed: Array.from(extsUsed),
            options: opts
          })
        });
      }).catch(reject);
    });
  };

  /* ============================================================
     ESTIMATE nhanh
     ============================================================ */
  GLBWriter.estimate = function (object3D, options) {
    const opts = Object.assign({}, GLBWriter.defaults, options || {});
    let verts = 0, tris = 0;
    object3D && object3D.traverse(function (o) {
      if (!o.isMesh) return;
      verts += o.geometry.attributes.position.count;
      tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
    });
    const vAfter = opts.weldVertices ? verts * 0.9 : verts;
    const posBytes = vAfter * 12;
    const norBytes = opts.quantizeNormals ? vAfter * 3 : vAfter * 12;
    const uvBytes = opts.quantizeUV ? vAfter * 4 : vAfter * 8;
    const idxBytes = tris * 3 * (opts.prefer16bitIndices && vAfter <= 65535 ? 2 : 4);
    return {
      verts: Math.round(vAfter),
      tris: Math.round(tris),
      geometryBytes: Math.round(posBytes + norBytes + uvBytes + idxBytes),
      note: 'Ước tính geometry — texture nén riêng theo format'
    };
  };

  window.PixiStudio.GLBWriter = GLBWriter;
})();
