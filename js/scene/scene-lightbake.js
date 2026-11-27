/* ============================================================
 * scene/scene-lightbake.js — Lighting bake (lightmap) CPU
 * PixiStudio.LightBake
 *
 * Bake ánh sáng tĩnh (directional / point / spot / ambient /
 * hemisphere lấy từ PixiStudio.Lighting.group) xuống texture
 * lightmap cho mesh TĨNH, áp qua material.lightMap (three r128).
 *
 * GIỚI HẠN NÓI THẲNG (đọc trước khi dùng):
 *  - Đây là bake CPU XẤP XỈ, KHÔNG phải raytrace thật, KHÔNG có
 *    shadow map thật: không có đổ bóng (occlusion giữa các vật),
 *    không có bounce / GI, không có specular. Chỉ tính irradiance
 *    trực tiếp theo khoảng cách + góc tới + cone (spot).
 *  - Irradiance tính TẠI MỖI VERTEX rồi "vẽ" (splat) lên texture
 *    theo UV của mesh. Mesh ít vertex / UV bị chồng lấp / UV ngoài
 *    [0,1] sẽ cho lightmap thô hoặc sai vùng. Mesh không có UV thì
 *    rơi về chế độ vertex-color (không tạo texture).
 *  - Lightmap dùng kênh UV2 của three r128: nếu geometry chưa có
 *    uv2, module tự copy uv -> uv2 (không sửa uv gốc).
 *  - SkinnedMesh / vật động / bone-visual / helper KHÔNG được bake.
 *  - Data URL lightmap KHÔNG nhét vào project JSON (localStorage
 *    ~5MB sẽ nổ): chỉ lưu metadata trong project, pixel lưu vào
 *    IndexedDB 'pixiStudio.lightmaps'. Nếu IndexedDB không khả
 *    dụng, lightmap chỉ sống trong phiên và UI sẽ cảnh báo.
 * ============================================================ */
(function () {
  'use strict';

  var bus = (window.PixiStudio && PixiStudio.bus) || null;
  function emit(evt, data) { if (bus) { try { bus.emit(evt, data); } catch (e) {} } }

  var IDB_NAME = 'pixiStudio.lightmaps';
  var IDB_STORE = 'maps';

  var LightBake = {
    /* uuid mesh -> { texture, dataUrl, width, height, mode:'texture'|'vertex',
       materials:[{mat, origLightMap, origIntensity, origVertexColors}],
       resolution, bakedAt, avg, min, max, bytes } */
    baked: {},
    enabled: true,          // lightmap đang được áp (toggle xem trước/sau)
    resolution: 256,        // 256 | 512 | 1024
    dilatePasses: 2,        // số vòng lấp lỗ trống sau khi splat
    lastBakeMs: 0,
    lastStats: null
  };

  /* ---------- THU THẬP LIGHT ---------- */
  LightBake.collectLights = function () {
    var out = [];
    var group = PixiStudio.Lighting && PixiStudio.Lighting.group;
    if (group) {
      group.traverse(function (o) {
        if (o.isLight && o.visible !== false) out.push(o);
      });
    }
    /* fallback: quét toàn scene nếu Lighting module chưa có */
    if (!out.length && PixiStudio.Viewport && PixiStudio.Viewport.scene) {
      PixiStudio.Viewport.scene.traverse(function (o) {
        if (o.isLight && o.visible !== false) out.push(o);
      });
    }
    return out;
  };

  /* ---------- IRRADIANCE TẠI 1 ĐIỂM ---------- */
  /* lights: mảng light đã collect; p: Vector3 world; n: Vector3 normal
   * (đã chuẩn hoá). Trả về [r,g,b] tuyến tính 0..~n (chưa clamp). */
  var _tmpL = null, _tmpDir = null;
  function irradianceAt(lights, p, n, out) {
    if (typeof THREE !== 'undefined') {
      _tmpL = _tmpL || new THREE.Vector3();
      _tmpDir = _tmpDir || new THREE.Vector3();
    }
    var r = 0, g = 0, b = 0;
    for (var i = 0; i < lights.length; i++) {
      var L = lights[i];
      var col = L.color;
      var cr = col.r, cg = col.g, cb = col.b;
      var inten = (L.intensity === undefined ? 1 : L.intensity);
      if (L.isAmbientLight) {
        r += cr * inten; g += cg * inten; b += cb * inten;
      } else if (L.isHemisphereLight) {
        /* t = 0 (hướng xuống, màu đất) .. 1 (hướng lên, màu trời) */
        var t = n.y * 0.5 + 0.5;
        r += (L.groundColor.r + (L.color.r - L.groundColor.r) * t) * inten;
        g += (L.groundColor.g + (L.color.g - L.groundColor.g) * t) * inten;
        b += (L.groundColor.b + (L.color.b - L.groundColor.b) * t) * inten;
      } else if (L.isDirectionalLight) {
        /* hướng sáng = từ vị trí light tới target (mặc định gốc) */
        var tgt = (L.target && L.target.position) ? L.target.position : { x: 0, y: 0, z: 0 };
        _tmpDir.set(tgt.x - L.position.x, tgt.y - L.position.y, tgt.z - L.position.z).normalize();
        var d = -(n.x * _tmpDir.x + n.y * _tmpDir.y + n.z * _tmpDir.z);
        if (d > 0) { r += cr * inten * d; g += cg * inten * d; b += cb * inten * d; }
      } else if (L.isPointLight) {
        _tmpL.set(L.position.x - p.x, L.position.y - p.y, L.position.z - p.z);
        var dist = _tmpL.length();
        if (L.distance > 0 && dist > L.distance) continue;
        if (dist < 1e-4) dist = 1e-4;
        _tmpL.multiplyScalar(1 / dist);
        var ndotl = n.x * _tmpL.x + n.y * _tmpL.y + n.z * _tmpL.z;
        if (ndotl <= 0) continue;
        /* xấp xỉ suy hao: 1/(1+d^2) — tránh nổ ở d->0 như 1/d^2 thật,
           đồng thời vẫn tối dần theo khoảng cách. KHÔNG phải falloff
           vật lý chuẩn của three (decay=2). */
        var att = 1 / (1 + dist * dist);
        r += cr * inten * att * ndotl; g += cg * inten * att * ndotl; b += cb * inten * att * ndotl;
      } else if (L.isSpotLight) {
        _tmpL.set(L.position.x - p.x, L.position.y - p.y, L.position.z - p.z);
        var sd = _tmpL.length();
        if (L.distance > 0 && sd > L.distance) continue;
        if (sd < 1e-4) sd = 1e-4;
        _tmpL.multiplyScalar(1 / sd);
        var sdot = n.x * _tmpL.x + n.y * _tmpL.y + n.z * _tmpL.z;
        if (sdot <= 0) continue;
        var satt = 1 / (1 + sd * sd);
        /* cone: hướng spot = từ vị trí tới target */
        var st = (L.target && L.target.position) ? L.target.position : { x: 0, y: 0, z: 0 };
        _tmpDir.set(st.x - L.position.x, st.y - L.position.y, st.z - L.position.z).normalize();
        var cosA = -(_tmpL.x * _tmpDir.x + _tmpL.y * _tmpDir.y + _tmpL.z * _tmpDir.z);
        var cosOuter = Math.cos(L.angle || Math.PI / 4);
        if (cosA < cosOuter) continue;
        var pen = L.penumbra || 0;
        var cone = 1;
        if (pen > 0) {
          var cosInner = Math.cos((L.angle || Math.PI / 4) * (1 - pen));
          cone = (cosA - cosOuter) / Math.max(1e-6, cosInner - cosOuter);
          if (cone > 1) cone = 1; if (cone < 0) cone = 0;
        }
        r += cr * inten * satt * sdot * cone; g += cg * inten * satt * sdot * cone; b += cb * inten * satt * sdot * cone;
      }
    }
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  }
  LightBake._irradianceAt = irradianceAt; /* cho harness */

  /* ---------- MESH TĨNH ---------- */
  LightBake.isStaticMesh = function (o) {
    if (!o || !o.isMesh || !o.geometry) return false;
    if (o.isSkinnedMesh) return false;
    if (o.userData && (o.userData.isBoneVisual || o.userData.isArpBoneLabel || o.userData.dynamic)) return false;
    if (!o.visible) return false;
    return true;
  };

  /* Quét mesh tĩnh: ưu tiên registry (primitive + model đã đăng ký),
   * fallback quét modelRoot + scene. Trả về mảng mesh duy nhất. */
  LightBake.collectStaticMeshes = function (scene) {
    var seen = {}, out = [];
    function push(o) {
      if (LightBake.isStaticMesh(o) && !seen[o.uuid]) { seen[o.uuid] = true; out.push(o); }
    }
    var S = PixiStudio.Scene;
    if (S && S.registry) {
      Object.keys(S.registry).forEach(function (uuid) {
        var reg = S.registry[uuid];
        var o = reg && reg.object3D;
        if (!o) return;
        if (o.isMesh) push(o);
        else if (o.traverse) o.traverse(push);
      });
    }
    var root = (PixiStudio.Viewport && PixiStudio.Viewport.modelRoot) || scene;
    if (root && root.traverse) root.traverse(push);
    if (scene && scene !== root && scene.traverse) scene.traverse(push);
    return out;
  };

  /* ---------- BAKE 1 MESH ---------- */
  LightBake.bakeMesh = function (mesh, opts) {
    opts = opts || {};
    var resolution = opts.resolution || LightBake.resolution;
    if (!window.THREE) throw new Error('THREE chưa load');
    if (!LightBake.isStaticMesh(mesh)) return null;
    var lights = opts.lights || LightBake.collectLights();
    if (!lights.length) return null;

    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var geo = mesh.geometry;
    var pos = geo.attributes.position;
    var nor = geo.attributes.normal;
    var uv = geo.attributes.uv;
    if (!pos) return null;
    mesh.updateWorldMatrix(true, false);

    var nrm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    var wp = new THREE.Vector3(), wn = new THREE.Vector3();
    var irr = [0, 0, 0];
    var count = pos.count;
    var perVertex = new Float32Array(count * 3);

    for (var v = 0; v < count; v++) {
      wp.fromBufferAttribute(pos, v).applyMatrix4(mesh.matrixWorld);
      if (nor) wn.fromBufferAttribute(nor, v).applyMatrix3(nrm).normalize();
      else wn.set(0, 1, 0);
      irradianceAt(lights, wp, wn, irr);
      perVertex[v * 3] = irr[0]; perVertex[v * 3 + 1] = irr[1]; perVertex[v * 3 + 2] = irr[2];
    }

    var rec = {
      mesh: mesh, uuid: mesh.uuid, name: mesh.name || 'mesh',
      resolution: resolution, bakedAt: new Date().toISOString(),
      materials: [], avg: 0, min: 0, max: 0, bytes: 0, mode: 'texture'
    };

    /* --- không có UV: fallback vertex-color --- */
    if (!uv) {
      rec.mode = 'vertex';
      var colors = new Float32Array(count * 3);
      var sum = 0, mn = Infinity, mx = 0;
      for (var c = 0; c < count; c++) {
        var r = Math.min(1, perVertex[c * 3]), g2 = Math.min(1, perVertex[c * 3 + 1]), b2 = Math.min(1, perVertex[c * 3 + 2]);
        colors[c * 3] = r; colors[c * 3 + 1] = g2; colors[c * 3 + 2] = b2;
        var lum = 0.2126 * r + 0.7152 * g2 + 0.0722 * b2;
        sum += lum; if (lum < mn) mn = lum; if (lum > mx) mx = lum;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      rec.avg = count ? sum / count : 0; rec.min = mn === Infinity ? 0 : mn; rec.max = mx;
      rec.bytes = count * 3 * 4;
      LightBake._applyVertexMode(mesh, rec);
      LightBake.baked[mesh.uuid] = rec;
      rec.ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
      return rec;
    }

    /* --- có UV: splat irradiance lên texture --- */
    var W = resolution, H = resolution;
    var acc = new Float32Array(W * H * 3);
    var cnt = new Float32Array(W * H);
    for (var i = 0; i < count; i++) {
      var u = uv.getX(i), vv = uv.getY(i);
      /* UV ngoài [0,1] thì wrap — ghi chú rõ: lightmap sai vùng nếu UV chồng */
      u = u - Math.floor(u); vv = vv - Math.floor(vv);
      var px = Math.min(W - 1, Math.floor(u * W));
      var py = Math.min(H - 1, Math.floor((1 - vv) * H)); /* flip Y: texture top-down */
      /* splat 3x3 để lấp khe giữa các vertex thưa */
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var xx = px + dx, yy = py + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          var idx = (yy * W + xx);
          acc[idx * 3] += perVertex[i * 3];
          acc[idx * 3 + 1] += perVertex[i * 3 + 1];
          acc[idx * 3 + 2] += perVertex[i * 3 + 2];
          cnt[idx] += 1;
        }
      }
    }
    /* dilate: lấp texel trống bằng trung bình hàng xóm (vài vòng) */
    for (var pass = 0; pass < LightBake.dilatePasses; pass++) {
      var acc2 = new Float32Array(acc), cnt2 = new Float32Array(cnt);
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          var id = y * W + x;
          if (cnt[id] > 0) continue;
          var sr = 0, sg = 0, sb = 0, n2 = 0;
          for (var oy = -1; oy <= 1; oy++) {
            for (var ox = -1; ox <= 1; ox++) {
              var nx = x + ox, ny = y + oy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              var nid = ny * W + nx;
              if (cnt[nid] > 0) { sr += acc[nid * 3] / cnt[nid]; sg += acc[nid * 3 + 1] / cnt[nid]; sb += acc[nid * 3 + 2] / cnt[nid]; n2++; }
            }
          }
          if (n2 > 0) { acc2[id * 3] = sr / n2; acc2[id * 3 + 1] = sg / n2; acc2[id * 3 + 2] = sb / n2; cnt2[id] = 1; }
        }
      }
      acc = acc2; cnt = cnt2;
    }
    /* chuẩn hoá -> Uint8, đo thống kê độ sáng */
    var data = new Uint8Array(W * H * 3);
    var sumL = 0, mnL = Infinity, mxL = 0, filled = 0;
    for (var p2 = 0; p2 < W * H; p2++) {
      var d0 = cnt[p2] > 0 ? acc[p2 * 3] / cnt[p2] : 0;
      var d1 = cnt[p2] > 0 ? acc[p2 * 3 + 1] / cnt[p2] : 0;
      var d2 = cnt[p2] > 0 ? acc[p2 * 3 + 2] / cnt[p2] : 0;
      var R = Math.max(0, Math.min(255, Math.round(d0 * 255)));
      var G = Math.max(0, Math.min(255, Math.round(d1 * 255)));
      var B = Math.max(0, Math.min(255, Math.round(d2 * 255)));
      data[p2 * 3] = R; data[p2 * 3 + 1] = G; data[p2 * 3 + 2] = B;
      if (cnt[p2] > 0) {
        filled++;
        var lum2 = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        sumL += lum2; if (lum2 < mnL) mnL = lum2; if (lum2 > mxL) mxL = lum2;
      }
    }
    rec.avg = filled ? sumL / filled : 0;
    rec.min = mnL === Infinity ? 0 : mnL;
    rec.max = mxL;
    rec.filledTexels = filled;
    rec.bytes = W * H * 3;

    var tex = new THREE.DataTexture(data, W, H, THREE.RGBFormat);
    tex.needsUpdate = true;
    tex.flipY = false; /* đã flip tay khi map uv->py */
    rec.texture = tex;
    rec.rawData = data; /* giữ để test + export dataURL */
    rec.width = W; rec.height = H;

    /* lightMap r128 dùng uv2: copy uv -> uv2 nếu chưa có */
    if (!geo.attributes.uv2) {
      geo.setAttribute('uv2', new THREE.BufferAttribute(uv.array.slice(), 2));
    }
    LightBake._applyTextureMode(mesh, rec);
    LightBake.baked[mesh.uuid] = rec;
    rec.ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
    return rec;
  };

  /* ---------- ÁP / GỠ LIGHTMAP LÊN MATERIAL ---------- */
  function eachMaterial(mesh, fn) {
    var m = mesh.material;
    if (!m) return;
    if (Array.isArray(m)) m.forEach(fn); else fn(m);
  }

  LightBake._applyTextureMode = function (mesh, rec) {
    eachMaterial(mesh, function (mat) {
      rec.materials.push({
        mat: mat,
        origLightMap: mat.lightMap || null,
        origIntensity: (mat.lightMapIntensity === undefined ? 1 : mat.lightMapIntensity),
        origVertexColors: !!mat.vertexColors
      });
      mat.lightMap = rec.texture;
      mat.lightMapIntensity = 1;
      mat.needsUpdate = true;
    });
  };

  LightBake._applyVertexMode = function (mesh, rec) {
    eachMaterial(mesh, function (mat) {
      rec.materials.push({
        mat: mat,
        origLightMap: mat.lightMap || null,
        origIntensity: (mat.lightMapIntensity === undefined ? 1 : mat.lightMapIntensity),
        origVertexColors: !!mat.vertexColors
      });
      mat.vertexColors = true;
      mat.needsUpdate = true;
    });
  };

  /* Bật/tắt toàn bộ lightmap đã bake (xem trước/sau). */
  LightBake.setEnabled = function (on) {
    LightBake.enabled = !!on;
    Object.keys(LightBake.baked).forEach(function (uuid) {
      var rec = LightBake.baked[uuid];
      rec.materials.forEach(function (entry) {
        if (on) {
          if (rec.mode === 'texture') { entry.mat.lightMap = rec.texture; entry.mat.lightMapIntensity = 1; }
          else { entry.mat.vertexColors = true; }
        } else {
          if (rec.mode === 'texture') { entry.mat.lightMap = entry.origLightMap; entry.mat.lightMapIntensity = entry.origIntensity; }
          else { entry.mat.vertexColors = entry.origVertexColors; }
        }
        entry.mat.needsUpdate = true;
      });
    });
    emit('lightbake:toggled', { enabled: LightBake.enabled });
    return LightBake.enabled;
  };

  /* Gỡ hẳn lightmap của 1 mesh (khôi phục material gốc). */
  LightBake.clearMesh = function (meshOrUuid) {
    var uuid = typeof meshOrUuid === 'string' ? meshOrUuid : (meshOrUuid && meshOrUuid.uuid);
    var rec = LightBake.baked[uuid];
    if (!rec) return false;
    rec.materials.forEach(function (entry) {
      entry.mat.lightMap = entry.origLightMap;
      entry.mat.lightMapIntensity = entry.origIntensity;
      entry.mat.vertexColors = entry.origVertexColors;
      entry.mat.needsUpdate = true;
    });
    if (rec.texture) rec.texture.dispose();
    delete LightBake.baked[uuid];
    return true;
  };

  LightBake.clearAll = function () {
    Object.keys(LightBake.baked).forEach(function (uuid) { LightBake.clearMesh(uuid); });
  };

  /* ---------- BAKE CẢ SCENE (async, có progress) ---------- */
  LightBake.bakeScene = function (opts, onProgress) {
    opts = opts || {};
    if (typeof opts === 'function') { onProgress = opts; opts = {}; }
    var meshes = opts.meshes || LightBake.collectStaticMeshes(
      PixiStudio.Viewport && PixiStudio.Viewport.scene);
    var resolution = opts.resolution || LightBake.resolution;
    var lights = LightBake.collectLights();
    var results = [];
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var i = 0;
    return new Promise(function (resolve) {
      function step() {
        var tEnd = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) + 24;
        while (i < meshes.length) {
          var rec = null;
          try { rec = LightBake.bakeMesh(meshes[i], { resolution: resolution, lights: lights }); } catch (e) { rec = null; }
          if (rec) results.push(rec);
          i++;
          if (onProgress) {
            try { onProgress({ done: i, total: meshes.length, mesh: meshes[i - 1], rec: rec }); } catch (e) {}
          }
          if (((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) > tEnd && i < meshes.length) break;
        }
        if (i < meshes.length) { setTimeout(step, 0); return; }
        LightBake.lastBakeMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
        var stats = {
          meshes: results.length, skipped: meshes.length - results.length,
          ms: LightBake.lastBakeMs, resolution: resolution,
          avg: results.length ? results.reduce(function (a, r) { return a + r.avg; }, 0) / results.length : 0
        };
        LightBake.lastStats = stats;
        emit('lightbake:done', stats);
        resolve({ results: results, stats: stats });
      }
      step();
    });
  };

  /* ---------- DATA URL / INDEXEDDB ---------- */
  LightBake.getDataURL = function (uuid) {
    var rec = LightBake.baked[uuid];
    if (!rec) return null;
    if (rec.dataUrl) return rec.dataUrl;
    if (rec.mode !== 'texture' || !rec.rawData) return null;
    if (typeof document === 'undefined') return null;
    try {
      var canvas = document.createElement('canvas');
      canvas.width = rec.width; canvas.height = rec.height;
      var ctx = canvas.getContext('2d');
      if (!ctx) return null;
      var img = ctx.createImageData(rec.width, rec.height);
      for (var i = 0; i < rec.width * rec.height; i++) {
        img.data[i * 4] = rec.rawData[i * 3];
        img.data[i * 4 + 1] = rec.rawData[i * 3 + 1];
        img.data[i * 4 + 2] = rec.rawData[i * 3 + 2];
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      rec.dataUrl = canvas.toDataURL('image/png');
      return rec.dataUrl;
    } catch (e) { return null; }
  };

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB không khả dụng')); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('mở IndexedDB lỗi')); };
    });
  }

  /* Lưu lightmap đã bake vào IndexedDB (data URL). Trả về số byte đã lưu. */
  LightBake.saveToIndexedDB = function () {
    var uuids = Object.keys(LightBake.baked);
    if (!uuids.length) return Promise.resolve({ saved: 0, bytes: 0 });
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        var store = tx.objectStore(IDB_STORE);
        var bytes = 0, saved = 0;
        uuids.forEach(function (uuid) {
          var url = LightBake.getDataURL(uuid);
          if (!url) return;
          bytes += url.length;
          var req = store.put({ uuid: uuid, name: LightBake.baked[uuid].name, resolution: LightBake.baked[uuid].resolution, dataUrl: url, at: Date.now() }, uuid);
          req.onsuccess = function () { saved++; };
        });
        tx.oncomplete = function () { resolve({ saved: saved, bytes: bytes }); };
        tx.onerror = function () { reject(tx.error || new Error('ghi IndexedDB lỗi')); };
      });
    });
  };

  LightBake.loadFromIndexedDB = function (uuid) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(uuid);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error || new Error('đọc IndexedDB lỗi')); };
      });
    });
  };

  /* Metadata NHẸ cho project JSON (không chứa pixel). */
  LightBake.serializeMeta = function () {
    return Object.keys(LightBake.baked).map(function (uuid) {
      var r = LightBake.baked[uuid];
      return { uuid: uuid, name: r.name, mode: r.mode, resolution: r.resolution, avg: Math.round(r.avg * 10) / 10, bytes: r.bytes, bakedAt: r.bakedAt };
    });
  };

  /* Khôi phục lightmap khi load project: đọc pixel từ IndexedDB rồi áp lại.
   * Mesh phải tồn tại trong scene (khớp uuid). Trả về Promise số mesh khôi phục được. */
  LightBake.restoreFromProject = function (metaList) {
    if (!metaList || !metaList.length) return Promise.resolve(0);
    var jobs = metaList.map(function (meta) {
      return LightBake.loadFromIndexedDB(meta.uuid).then(function (stored) {
        if (!stored || !stored.dataUrl) return false;
        var mesh = null;
        var S = PixiStudio.Scene;
        if (S && S.registry && S.registry[meta.uuid]) mesh = S.registry[meta.uuid].object3D;
        if (!mesh && PixiStudio.Viewport && PixiStudio.Viewport.scene) {
          PixiStudio.Viewport.scene.traverse(function (o) { if (o.uuid === meta.uuid) mesh = o; });
        }
        if (!mesh || !LightBake.isStaticMesh(mesh)) return false;
        /* rebuild texture từ dataURL qua Image */
        return new Promise(function (resolve) {
          if (typeof Image === 'undefined') { resolve(false); return; }
          var img = new Image();
          img.onload = function () {
            try {
              var canvas = document.createElement('canvas');
              canvas.width = img.width; canvas.height = img.height;
              var ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              var imgData = ctx.getImageData(0, 0, img.width, img.height);
              var raw = new Uint8Array(img.width * img.height * 3);
              for (var i = 0; i < img.width * img.height; i++) {
                raw[i * 3] = imgData.data[i * 4]; raw[i * 3 + 1] = imgData.data[i * 4 + 1]; raw[i * 3 + 2] = imgData.data[i * 4 + 2];
              }
              var tex = new THREE.DataTexture(raw, img.width, img.height, THREE.RGBFormat);
              tex.needsUpdate = true; tex.flipY = false;
              var geo = mesh.geometry;
              if (geo.attributes.uv && !geo.attributes.uv2) geo.setAttribute('uv2', new THREE.BufferAttribute(geo.attributes.uv.array.slice(), 2));
              var rec = { mesh: mesh, uuid: mesh.uuid, name: meta.name || mesh.name, resolution: meta.resolution, mode: 'texture', texture: tex, rawData: raw, width: img.width, height: img.height, materials: [], avg: meta.avg || 0, min: 0, max: 0, bytes: img.width * img.height * 3, bakedAt: meta.bakedAt || '' };
              LightBake._applyTextureMode(mesh, rec);
              LightBake.baked[mesh.uuid] = rec;
              resolve(true);
            } catch (e) { resolve(false); }
          };
          img.onerror = function () { resolve(false); };
          img.src = stored.dataUrl;
        });
      }).catch(function () { return false; });
    });
    return Promise.all(jobs).then(function (flags) {
      return flags.filter(Boolean).length;
    });
  };

  /* ---------- UI PANEL (gắn vào Scene page) ---------- */
  LightBake.renderPanel = function (container) {
    var wrap = container || (typeof document !== 'undefined' ? document.getElementById('scene-page-body') : null);
    if (!wrap || typeof document === 'undefined') return null;
    var old = wrap.querySelector('[data-lightbake-panel]');
    if (old) old.remove();

    var block = document.createElement('div');
    block.className = 'page-block';
    block.setAttribute('data-lightbake-panel', '1');
    var h = document.createElement('h4');
    h.textContent = 'Lighting Bake (lightmap CPU)';
    block.appendChild(h);
    var note = document.createElement('div');
    note.style.cssText = 'font-size:11px;opacity:.75;margin-bottom:6px;';
    note.textContent = 'Bake xấp xỉ CPU (không raytrace/shadow thật). Chỉ mesh tĩnh; SkinnedMesh bị bỏ qua. Lightmap lưu IndexedDB, metadata lưu kèm project.';
    block.appendChild(note);

    var row1 = document.createElement('div');
    row1.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
    var lbl = document.createElement('span');
    lbl.textContent = 'Độ phân giải:';
    lbl.style.fontSize = '12px';
    row1.appendChild(lbl);
    var sel = document.createElement('select');
    sel.className = 'arp-select';
    sel.style.cssText = 'padding:4px 6px;';
    [256, 512, 1024].forEach(function (r) {
      var o = document.createElement('option');
      o.value = String(r); o.textContent = r + ' × ' + r;
      if (r === LightBake.resolution) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () { LightBake.resolution = parseInt(sel.value, 10) || 256; };
    row1.appendChild(sel);
    block.appendChild(row1);

    var row2 = document.createElement('div');
    row2.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;';
    function mkBtn(text, fn) {
      var b = document.createElement('button');
      b.className = 'btn sm'; b.textContent = text; b.onclick = fn;
      row2.appendChild(b); return b;
    }
    var status = document.createElement('div');
    status.style.cssText = 'font-size:12px;margin-top:6px;min-height:16px;';
    status.textContent = 'Chưa bake.';
    var prog = document.createElement('div');
    prog.style.cssText = 'height:6px;background:rgba(128,128,128,.25);border-radius:3px;margin-top:6px;overflow:hidden;display:none;';
    var progFill = document.createElement('div');
    progFill.style.cssText = 'height:100%;width:0%;background:#713BFF;';
    prog.appendChild(progFill);
    mkBtn('Bake cả scene', function () {
      prog.style.display = 'block';
      status.textContent = 'Đang bake…';
      LightBake.bakeScene(function (p) {
        progFill.style.width = Math.round(p.done / Math.max(1, p.total) * 100) + '%';
        status.textContent = 'Đang bake ' + p.done + '/' + p.total + '…';
      }).then(function (res) {
        prog.style.display = 'none';
        status.textContent = 'Bake xong: ' + res.stats.meshes + ' mesh, ' + res.stats.ms.toFixed(0) + 'ms, độ sáng TB ' + res.stats.avg.toFixed(0) + '/255.';
        LightBake.saveToIndexedDB().then(function (s) {
          status.textContent += ' Đã lưu ' + s.saved + ' lightmap (' + (s.bytes / 1024).toFixed(0) + 'KB) vào IndexedDB.';
        }).catch(function () {
          status.textContent += ' (CẢNH BÁO: không lưu được IndexedDB — lightmap chỉ sống trong phiên này.)';
        });
        emit('lightbake:ui', res.stats);
      });
    });
    mkBtn('Bake object đã chọn', function () {
      var selObj = null;
      try { selObj = PixiStudio.State && PixiStudio.State.get('selection'); } catch (e) {}
      if (!selObj) { status.textContent = 'Chưa chọn object nào.'; return; }
      var meshes = [];
      selObj.traverse ? selObj.traverse(function (o) { if (LightBake.isStaticMesh(o)) meshes.push(o); }) : null;
      if (!meshes.length && LightBake.isStaticMesh(selObj)) meshes.push(selObj);
      if (!meshes.length) { status.textContent = 'Object đã chọn không phải mesh tĩnh (SkinnedMesh/động bị bỏ qua).'; return; }
      LightBake.bakeScene({ meshes: meshes }, function (p) {
        status.textContent = 'Đang bake ' + p.done + '/' + p.total + '…';
      }).then(function (res) {
        status.textContent = 'Bake xong: ' + res.stats.meshes + ' mesh, ' + res.stats.ms.toFixed(0) + 'ms.';
        LightBake.saveToIndexedDB().catch(function () {});
      });
    });
    var toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn sm';
    toggleBtn.textContent = 'Tắt lightmap (xem gốc)';
    toggleBtn.onclick = function () {
      var on = LightBake.setEnabled(!LightBake.enabled);
      toggleBtn.textContent = on ? 'Tắt lightmap (xem gốc)' : 'Bật lightmap';
      status.textContent = on ? 'Lightmap đang BẬT.' : 'Lightmap đang TẮT — đang xem vật liệu gốc.';
    };
    row2.appendChild(toggleBtn);
    mkBtn('Xoá lightmap', function () {
      LightBake.clearAll();
      status.textContent = 'Đã gỡ toàn bộ lightmap, vật liệu về gốc.';
    });
    block.appendChild(row2);
    block.appendChild(prog);
    block.appendChild(status);
    wrap.appendChild(block);
    return block;
  };

  window.PixiStudio.LightBake = LightBake;
})();
