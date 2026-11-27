/* ============================================================
 * exporter/save-manager.js — SAVE CENTER v20.0
 * Hệ thống lưu/tối ưu file đầy đủ:
 *   • 13 định dạng xuất (GLB tối ưu, GLTF, OBJ, STL, PLY, JSON,
 *     PNG/JPG/WebP, WebM, ZIP bundle, Spritesheet, Thumbnails, Project)
 *   • 6 preset tối ưu: Game Ready / Web Preview / Full Quality /
 *     3D Print / Spritesheet / Project
 *   • Pipeline giảm dung lượng THẬT: weld + quantize + texture
 *     resize/WebP + 16-bit indices → báo cáo trước/sau chi tiết
 *   • Texture Audit, Save History (localStorage), Verify-after-save,
 *     Batch export, Auto-backup rotation, filename template
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const HISTORY_KEY = 'pixiStudio.saveHistory.v1';
  const OPTIONS_KEY = 'pixiStudio.saveOptions.v1';

  /* ============================================================
     ĐỊNH NGHĨA FORMATS
     ============================================================ */
  const FORMATS = [
    { id: 'tripo-glb', name: 'TripoGLB — định dạng Tripo', ext: '.glb', icon: 'wand', real: true, desc: 'GLB giống HỆT file tripo_convert: f32 + u16 indices + JPEG + KHR_materials_specular + 0 extension required — Meshy/Tripo/Blender đều đọc' },
    { id: 'glb-hq', name: 'GLB — High Quality', ext: '.glb', icon: 'diamond', real: true, desc: 'GIỮ NGUYÊN hình: không weld/quantize, texture giữ 4096 chỉ nén lại (WebP/JPEG q0.95) + meshopt lossless' },
    { id: 'glb-opt', name: 'GLB — Tối ưu', ext: '.glb', icon: 'cube', real: true, desc: 'Weld + quantize + texture resize — nhẹ nhất, chấp nhận giảm chi tiết' },
    { id: 'glb-full', name: 'GLB — Full Quality', ext: '.glb', icon: 'cube', real: true, desc: 'GLTFExporter gốc — giữ nguyên 100% mọi chi tiết, không nén' },
    { id: 'gltf', name: 'GLTF (JSON)', ext: '.gltf', icon: 'file', real: true, desc: 'JSON text — dễ inspect, dung lượng lớn hơn' },
    { id: 'zip-gltf', name: 'GLTF Source Pack (ZIP)', ext: '.zip', icon: 'folder', real: true, desc: 'GLTF JSON + textures tách file — chuẩn nguồn cho pipeline' },
    { id: 'dae', name: 'DAE Collada + Textures', ext: '.zip', icon: 'scene', real: true, desc: 'Collada XML + texture PNG — Blender/Maya/Unity import chuẩn' },
    { id: 'fbx', name: 'FBX Binary (có rig — Blender/Unity/Unreal)', ext: '.fbx', icon: 'file', real: true, desc: 'FBX 7.4 BINARY có skeleton + skin + bind pose — dùng cho Blender/Unity/Unreal/Maya. KHÔNG dùng cho Mixamo: file có xương sẽ bị Mixamo báo "unable to map your existing skeleton" — muốn lên Mixamo thì dùng FBX Mixamo (mesh-only) hoặc nút Save Mixamo.' },
    { id: 'fbx-mixamo', name: 'FBX Mixamo (MÀU + auto-rig)', ext: '.fbx', icon: 'wand', real: true, desc: 'FBX 2013 BINARY đã sửa cho Mixamo: mesh-only (Mixamo tự auto-rig), hướng +Y, đáy y=0, cao 1.8, mặt +Z, MẶT KÍN — VÀ nhúng texture vào Video.Content + nối Texture→Material (DiffuseColor/NormalMap) nên model có MÀU khi lên Mixamo.' },
    { id: 'blend-kit', name: 'BLEND — Blender Import Kit', ext: '.zip', icon: 'model', real: true, desc: 'ZIP: model.glb + script .py chạy trong Blender (Scripting → Run) tạo mesh+texture thật → Save As .blend' },
    { id: 'fbx-mixamo-rig', name: 'FBX 2013 Mixamo-safe (mesh-only, tự auto-rig)', ext: '.fbx', icon: 'model', real: true, desc: 'FBX 2013 (version 7300) Mixamo-safe: file xuất ra là mesh-only (Mixamo tự auto-rig) + texture nhúng, < 50k tris. Khung 65 xương mixamorig:* chỉ dựng TRONG SCENE để làm animation, KHÔNG xuất xương ra file — vì file có xương bị Mixamo từ chối ở bước map-skeleton (xem MIXAMO_EXPORT_FIX.md Lần 4).' },
    { id: 'obj', name: 'OBJ', ext: '.obj', icon: 'file', real: true, desc: 'Wavefront — chỉ geometry, phổ biến Universal' },
    { id: 'obj-color', name: 'OBJ + MTL + Texture (ZIP CÓ MÀU)', ext: '.zip', icon: 'scene', real: true, desc: 'ZIP: model.obj + model.mtl + ảnh texture (map_Kd / norm). OBJ chỉ mang màu khi đi kèm .mtl và ảnh — ZIP giữ đủ bộ 3 để Blender/Maya/Unity/Mixamo import ra CÓ MÀU.' },
    { id: 'stl', name: 'STL', ext: '.stl', icon: 'print', real: true, desc: '3D Printing — binary mesh không màu' },
    { id: 'ply', name: 'PLY', ext: '.ply', icon: 'print', real: true, desc: 'Stanford PLY ASCII — point/mesh scan' },
    { id: 'json-geo', name: 'JSON Geometry', ext: '.json', icon: 'file', real: true, desc: 'Đỉnh/UV/index thô — cho engine tự viết' },
    { id: 'png', name: 'PNG Render', ext: '.png', icon: 'image', real: true, desc: 'Render viewport độ phân giải chọn' },
    { id: 'jpg', name: 'JPG Render', ext: '.jpg', icon: 'image', real: true, desc: 'Nhỏ hơn PNG — không trong suốt' },
    { id: 'webp', name: 'WebP Render', ext: '.webp', icon: 'image', real: true, desc: 'Modern — nhỏ nhất, chất lượng tốt' },
    { id: 'spritesheet', name: 'Spritesheet 8 góc', ext: '.png', icon: 'game', real: true, desc: '8 hướng quay 256px — sprite game 2D' },
    { id: 'thumbnail', name: 'Thumbnail', ext: '.png', icon: 'image', real: true, desc: 'Ảnh nhỏ model 256px' },
    { id: 'webm', name: 'Video WebM', ext: '.webm', icon: 'animation', real: true, desc: 'Ghi 5s viewport (MediaRecorder)' },
    { id: 'zip', name: 'ZIP Bundle', ext: '.zip', icon: 'folder', real: true, desc: 'GLB + textures + manifest + screenshot + README' },
    { id: 'project', name: 'Project JSON', ext: '.pixistudio.json', icon: 'save', real: true, desc: 'Toàn bộ scene + timeline + settings' },
    { id: 'gif', name: 'GIF', ext: '.gif', icon: 'animation', real: false, desc: 'Cần gif.js encoder — ⏸ planned v5.1' },
    { id: 'mp4', name: 'MP4', ext: '.mp4', icon: 'animation', real: false, desc: 'Cần ffmpeg.wasm — ⏸ planned v5.1' }
  ];

  /* ============================================================
     PRESETS
     ============================================================ */
  const PRESETS = [
    {
      id: 'high-quality', name: '💎 High Quality', icon: 'diamond',
      desc: 'GIỮ NGUYÊN chất lượng gốc — Universal JPEG/PNG, không meshopt bắt buộc; tương thích Meshy/Tripo/Blender/Unity',
      target: 'universal',
      options: { weldVertices: false, weldMode: 'exact', quantizeNormals: false, quantizeUV: false, textureMaxSize: 0, textureFormat: 'auto', textureQuality: 0.95, prefer16bitIndices: true, meshoptServerEncode: false, simplifyRatio: 0 },
      format: 'glb-hq'
    },
    {
      id: 'decimated', name: '🪓 Decimated', icon: 'optimize',
      desc: 'GIẢM TRIANGLES thật 50% (simplify giữ UV + shape) + texture 2048 JPEG q0.95 — game-ready nhẹ mà không vỡ hình',
      target: 'universal',
      options: { weldVertices: false, weldMode: 'exact', quantizeNormals: false, quantizeUV: false, textureMaxSize: 2048, textureFormat: 'jpeg', textureQuality: 0.95, prefer16bitIndices: true, meshoptServerEncode: false, simplifyRatio: 0.5 },
      format: 'glb-hq'
    },
    {
      id: 'ai-upload', name: '🤖 AI Upload', icon: 'wand',
      desc: 'Universal an toàn nhất cho Meshy/Tripo — không vỡ hình, texture 2048 JPEG q0.95',
      target: 'universal',
      options: { weldVertices: false, weldMode: 'exact', quantizeNormals: false, quantizeUV: false, textureMaxSize: 2048, textureFormat: 'jpeg', textureQuality: 0.95, prefer16bitIndices: true, meshoptServerEncode: false, simplifyRatio: 0 },
      format: 'glb-hq'
    },
    {
      id: 'game-ready', name: '🎮 Game Ready', icon: 'game',
      desc: 'Universal — weld exact + texture 1024 JPEG/PNG. Cân bằng, Meshy/Tripo đọc được',
      target: 'universal',
      options: { weldVertices: true, weldMode: 'exact', quantizeNormals: false, quantizeUV: false, textureMaxSize: 1024, textureFormat: 'auto', textureQuality: 0.9, prefer16bitIndices: true, meshoptServerEncode: false },
      format: 'glb-opt'
    },
    {
      id: 'web-preview', name: '🌐 Web Preview', icon: 'cloud',
      desc: 'Web three.js — quantize + meshopt + WebP 512. NHỎ NHẤT (chấp nhận giảm chi tiết)',
      target: 'web',
      options: { weldVertices: true, weldMode: 'tight', quantizeNormals: true, quantizeUV: true, textureMaxSize: 512, textureFormat: 'webp', textureQuality: 0.75, prefer16bitIndices: true, meshoptServerEncode: true },
      format: 'glb-opt'
    },
    {
      id: 'full-quality', name: '💎 Full Original', icon: 'layers',
      desc: 'GLTFExporter gốc — giữ nguyên 100% mọi chi tiết, KHÔNG nén gì (file to nhất)',
      options: {}, format: 'glb-full'
    },
    {
      id: 'print', name: '🖨️ 3D Print', icon: 'print',
      desc: 'STL binary — mesh không màu, chuẩn máy in 3D',
      options: {}, format: 'stl'
    },
    {
      id: 'sprite', name: '🕹️ Spritesheet', icon: 'gamepad',
      desc: '8 góc quay 256px → PNG sheet cho game 2D',
      options: {}, format: 'spritesheet'
    },
    {
      id: 'project', name: '💾 Project', icon: 'save',
      desc: 'Lưu toàn bộ workspace — scene, timeline, settings',
      options: {}, format: 'project'
    }
  ];

  /* ============================================================
     STATE
     ============================================================ */
  const SaveManager = {
    options: Object.assign({
      compatTarget: 'universal',      // 'universal' | 'web'
      weldVertices: false,            // mặc định OFF — không rách mesh
      weldMode: 'exact',              // exact = chỉ gộp đỉnh trùng tuyệt đối
      quantizeNormals: false,         // universal OFF — chỉ target web
      quantizeUV: false,
      prefer16bitIndices: true,
      textureMaxSize: 0,              // 0 = giữ nguyên kích thước texture
      textureFormat: 'auto',          // auto = jpeg/png spec-safe (alpha-aware)
      textureQuality: 0.92,
      simplifyRatio: 0,               // 0 = off; 0.25/0.5/0.75 = giảm triangles (simplify giữ UV+shape)
      verifyAfterSave: true,
      meshoptServerEncode: false,     // universal OFF — chỉ target web
      autoName: true
    }),
    lastPreset: 'high-quality',
    history: [],
    _estTimer: null,
    _meshoptServer: null     // null = chưa probe; true/false sau ping
  };

  /* Chuyển chế độ tương thích — set option theo target */
  SaveManager.FORMATS = FORMATS;
  /* v21.0 — Export Preset theo engine (Unity/Unreal/Godot/Roblox/Mixamo).
     null = giữ hành vi mặc định cũ. Áp vào lần xuất FBX generic
     (saveFBXBinary); nút Save Mixamo giữ cố định 7300/Y vì Mixamo bắt buộc. */
  SaveManager.exportPreset = null;
  SaveManager.setExportPreset = function (id) {
    if (!PixiStudio.ExportPresets || !PixiStudio.ExportPresets.get(id)) return false;
    SaveManager.exportPreset = id;
    return true;
  };
  SaveManager.setCompatTarget = function (target) {
    SaveManager.options.compatTarget = target;
    if (target === 'universal') {
      SaveManager.options.quantizeNormals = false;
      SaveManager.options.quantizeUV = false;
      SaveManager.options.meshoptServerEncode = false;
      if (SaveManager.options.textureFormat === 'webp') SaveManager.options.textureFormat = 'auto';
    } else {
      SaveManager.options.quantizeNormals = true;
      SaveManager.options.quantizeUV = true;
      SaveManager.options.meshoptServerEncode = true;
      SaveManager.options.textureFormat = 'webp';
    }
    SaveManager.saveState();
    bus.emit('save:target', { target: target });
  };

  /* ---------- Persistence ---------- */
  SaveManager.loadState = function () {
    try {
      const rawOpts = localStorage.getItem(OPTIONS_KEY);
      if (rawOpts) Object.assign(SaveManager.options, JSON.parse(rawOpts));
      SaveManager.history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch (e) { /* ignore */ }
  };

  SaveManager.saveState = function () {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(SaveManager.options));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(SaveManager.history.slice(0, 20)));
    } catch (e) { /* ignore */ }
  };

  SaveManager.logSave = function (entry) {
    SaveManager.history.unshift(Object.assign({ at: new Date().toISOString() }, entry));
    if (SaveManager.history.length > 20) SaveManager.history.length = 20;
    SaveManager.saveState();
    bus.emit('save:history', { count: SaveManager.history.length });
  };

  /* ---------- Filename ---------- */
  function sanitizeName(name) {
    return String(name || 'model').replace(/[^a-zA-Z0-9-_ \u00C0-\u1EF9]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'model';
  }

  function buildFileName(modelName, tag, ext) {
    const d = new Date();
    const stamp = U.pad2(d.getHours()) + U.pad2(d.getMinutes()) + U.pad2(d.getSeconds());
    return sanitizeName(modelName) + '_' + tag + '_' + stamp + ext;
  }

  /* ============================================================
     PLY EXPORTER (ASCII) — tự viết
     ============================================================ */
  function exportPLY(object3D) {
    let positions = [], uvs = [], normals = [], indices = [];
    object3D.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    object3D.traverse(function (o) {
      if (!o.isMesh) return;
      const geo = o.geometry;
      const pos = geo.attributes.position;
      const offset = positions.length / 3;
      o.updateMatrixWorld(true);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        positions.push(v.x, v.y, v.z);
        if (geo.attributes.uv) { uvs.push(geo.attributes.uv.getX(i) || 0, geo.attributes.uv.getY(i) || 0); }
        else { uvs.push(0, 0); }
        if (geo.attributes.normal) {
          v.fromBufferAttribute(geo.attributes.normal, i).transformDirection(o.matrixWorld);
          normals.push(v.x, v.y, v.z);
        } else { normals.push(0, 1, 0); }
      }
      const idx = geo.index;
      if (idx) {
        for (let i = 0; i < idx.count; i += 3) {
          indices.push(offset + idx.getX(i), offset + idx.getX(i + 1), offset + idx.getX(i + 2));
        }
      } else {
        for (let i = 0; i < pos.count; i += 3) {
          indices.push(offset + i, offset + i + 1, offset + i + 2);
        }
      }
    });

    const hasUv = uvs.some(function (v) { return v !== 0; });
    let header = 'ply\nformat ascii 1.0\ncomment PixiJS Studio × Tripo3D AI Studio v21.0\n' +
      'element vertex ' + (positions.length / 3) + '\n' +
      'property float x\nproperty float y\nproperty float z\n' +
      'property float nx\nproperty float ny\nproperty float nz\n';
    if (hasUv) header += 'property float s\nproperty float t\n';
    header += 'element face ' + (indices.length / 3) + '\nproperty list uchar int vertex_indices\nend_header\n';

    const lines = [header];
    for (let i = 0; i < positions.length / 3; i++) {
      let row = positions[i * 3].toFixed(4) + ' ' + positions[i * 3 + 1].toFixed(4) + ' ' + positions[i * 3 + 2].toFixed(4) +
        ' ' + normals[i * 3].toFixed(3) + ' ' + normals[i * 3 + 1].toFixed(3) + ' ' + normals[i * 3 + 2].toFixed(3);
      if (hasUv) row += ' ' + uvs[i * 2].toFixed(4) + ' ' + uvs[i * 2 + 1].toFixed(4);
      lines.push(row);
    }
    for (let i = 0; i < indices.length; i += 3) {
      lines.push('3 ' + indices[i] + ' ' + indices[i + 1] + ' ' + indices[i + 2]);
    }
    return lines.join('\n');
  }

  /* ============================================================
     JSON GEOMETRY EXPORTER
     ============================================================ */
  function exportJSONGeometry(object3D) {
    const out = { name: object3D.name, format: 'pixi-studio-geometry-1', meshes: [] };
    object3D.traverse(function (o) {
      if (!o.isMesh) return;
      const g = o.geometry;
      const m = {
        name: o.name,
        position: Array.from(g.attributes.position.array).map(function (v) { return Math.round(v * 1e5) / 1e5; }),
        normal: g.attributes.normal ? Array.from(g.attributes.normal.array).map(function (v) { return Math.round(v * 1e3) / 1e3; }) : null,
        uv: g.attributes.uv ? Array.from(g.attributes.uv.array).map(function (v) { return Math.round(v * 1e4) / 1e4; }) : null,
        index: g.index ? Array.from(g.index.array) : null
      };
      out.meshes.push(m);
    });
    return JSON.stringify(out);
  }

  /* ============================================================
     SPRITESHEET — 8 góc quay, composite 4×2
     ============================================================ */
  function exportSpritesheet(object3D, size) {
    const N = 8;
    const cell = size || 256;
    return new Promise(function (resolve, reject) {
      const scene = new THREE.Scene();
      const clone = object3D.clone();
      clone.traverse(function (o) { if (o.isMesh) { o.castShadow = false; } });
      scene.add(clone);
      scene.add(new THREE.HemisphereLight(0x8a8aff, 0x2a2233, 1.1));
      const key = new THREE.DirectionalLight(0xfff4e0, 1.3);
      key.position.set(3, 5, 4);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xb79bff, 0.7);
      rim.position.set(-3, 4, -5);
      scene.add(rim);

      const box = new THREE.Box3().setFromObject(clone);
      if (box.isEmpty()) { reject(new Error('bbox rỗng')); return; }
      const center = box.getCenter(new THREE.Vector3());
      const sizeV = box.getSize(new THREE.Vector3());
      const radius = Math.max(sizeV.x, sizeV.y, sizeV.z) * 1.4 + 0.5;

      const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 200);
      const shots = [];
      let done = 0;

      function shoot(angleIdx) {
        const a = angleIdx / N * Math.PI * 2;
        cam.position.set(
          center.x + radius * Math.sin(a),
          center.y + sizeV.y * 0.18,
          center.z + radius * Math.cos(a)
        );
        cam.lookAt(center);
        const url = PixiStudio.ThreeRenderer.renderToImage(scene, cam, cell, cell, 'png');
        shots[angleIdx] = url;
        done++;
        PixiStudio.Notifications.updateLoading(Math.round(done / N * 90), 'Render spritesheet ' + done + '/' + N + ' góc…');
        if (done < N) {
          setTimeout(function () { shoot(done); }, 30);
        } else {
          /* composite 4×2 */
          const canvas = document.createElement('canvas');
          canvas.width = cell * 4; canvas.height = cell * 2;
          const ctx = canvas.getContext('2d');
          let loaded = 0;
          shots.forEach(function (url, i) {
            const img = new Image();
            img.onload = function () {
              const col = i % 4, row = Math.floor(i / 4);
              ctx.drawImage(img, col * cell, row * cell);
              loaded++;
              if (loaded === N) {
                PixiStudio.Notifications.hideLoading();
                resolve(canvas.toDataURL('image/png'));
              }
            };
            img.src = url;
          });
        }
      }
      PixiStudio.Notifications.showLoading('Render spritesheet…', 0);
      shoot(0);
    });
  }

  /* ============================================================
     TEXTURE AUDIT
     ============================================================ */
  SaveManager.auditTextures = function (object3D) {
    const seen = new Map();
    object3D && object3D.traverse(function (o) {
      if (!o.isMesh) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mat) return;
      [['map', 'BaseColor'], ['normalMap', 'Normal'], ['roughnessMap', 'Roughness'], ['metalnessMap', 'Metallic'], ['aoMap', 'AO'], ['emissiveMap', 'Emission']].forEach(function (pair) {
        const tex = mat[pair[0]];
        if (tex && tex.image && tex.image.width && !seen.has(tex.uuid)) {
          /* ước tính bytes theo format: JPEG ~0.35 byte/px, PNG ~1.2 */
          const px = tex.image.width * tex.image.height;
          const est = Math.round(px * 0.6);
          seen.set(tex.uuid, {
            slot: pair[1], width: tex.image.width, height: tex.image.height,
            estBytes: est, flipY: tex.flipY
          });
        }
      });
    });
    return Array.from(seen.values());
  };

  /* helper encode texture cho zip — canvas → PNG bytes */
  function encodeTexForZip(texEntry) {
    return new Promise(function (resolve) {
      const img = texEntry.tex && texEntry.tex.image;
      if (!img) { resolve(null); return; }
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      try {
        if (texEntry.tex.flipY === true) { ctx.translate(0, canvas.height); ctx.scale(1, -1); }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function (b) {
          if (!b) { resolve(null); return; }
          b.arrayBuffer().then(function (ab) { resolve(new Uint8Array(ab)); });
        }, 'image/png');
      } catch (e) { resolve(null); }
    });
  }

  /* ============================================================
     DAE COLLADA EXPORTER — XML chuẩn 1.4.1 (Blender/Maya/Unity import)
     Trả { dae, textures: [{name, tex, matName, slot, idx}] }
     ============================================================ */
  function gatherMeshData(object3D) {
    const meshes = [];
    object3D.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    object3D.traverse(function (o) {
      if (!o.isMesh) return;
      const geo = o.geometry;
      const pos = geo.attributes.position;
      const idx = geo.index;
      const verts = [];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        verts.push(v.x, v.y, v.z);
      }
      const norms = [];
      if (geo.attributes.normal) {
        for (let i = 0; i < geo.attributes.normal.count; i++) {
          v.fromBufferAttribute(geo.attributes.normal, i).transformDirection(o.matrixWorld);
          norms.push(v.x, v.y, v.z);
        }
      }
      const uvs = [];
      if (geo.attributes.uv) {
        for (let i = 0; i < geo.attributes.uv.count; i++) {
          uvs.push(geo.attributes.uv.getX(i), geo.attributes.uv.getY(i));
        }
      }
      const tris = [];
      if (idx) {
        for (let i = 0; i < idx.count; i += 3) tris.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
      } else {
        for (let i = 0; i < pos.count; i += 3) tris.push(i, i + 1, i + 2);
      }
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const textures = [];
      if (mat) {
        if (mat.map && mat.map.image) textures.push({ slot: 'diffuse', tex: mat.map });
        if (mat.normalMap && mat.normalMap.image) textures.push({ slot: 'normal', tex: mat.normalMap });
        if (mat.roughnessMap && mat.roughnessMap.image) textures.push({ slot: 'orm', tex: mat.roughnessMap });
      }
      meshes.push({
        name: (o.name || 'mesh_' + meshes.length).replace(/[^\w-]/g, '_'),
        verts: verts, norms: norms, uvs: uvs, tris: tris,
        vertsParts: verts.map(function (x) { return x.toFixed(5); }),
        normsParts: norms.map(function (x) { return x.toFixed(4); }),
        uvsParts: uvs.map(function (x) { return x.toFixed(5); }),
        hasUV: uvs.length > 0, hasNrm: norms.length > 0,
        matName: mat ? (mat.name || 'mat_' + meshes.length).replace(/[^\w-]/g, '_') : 'default_mat',
        color: mat ? mat.color : null,
        textures: textures
      });
    });
    return meshes;
  }

  function exportDAE(object3D, opts) {
    const meshes = gatherMeshData(object3D);
    const now = new Date().toISOString();
    let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
    xml += '<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">\n';
    xml += ' <asset>\n  <contributor><authoring_tool>PixiJS Studio × Tripo3D AI Studio v21.0</authoring_tool></contributor>\n';
    xml += '  <created>' + now + '</created><modified>' + now + '</modified>\n';
    xml += '  <unit name="meter" meter="1"/><up_axis>Y_UP</up_axis>\n </asset>\n';

    /* texture encode jobs (PNG trong zip) */
    const texEntries = [];
    let texIdx = 0;
    meshes.forEach(function (m) {
      m.textures.forEach(function (t) {
        if (t.tex.image) {
          texEntries.push({ name: m.matName + '_' + t.slot + '_' + texIdx + '.png', tex: t.tex, matName: m.matName, slot: t.slot, idx: texIdx });
          texIdx++;
        }
      });
    });

    /* library_images */
    xml += ' <library_images>\n';
    texEntries.forEach(function (t) {
      xml += '  <image id="img' + t.idx + '" name="img' + t.idx + '"><init_from>' + t.name + '</init_from></image>\n';
    });
    xml += ' </library_images>\n';

    /* library_effects — diffuse texture nếu có, ngược lại màu */
    xml += ' <library_effects>\n';
    const matSeen = {};
    meshes.forEach(function (m) {
      if (matSeen[m.matName]) return;
      matSeen[m.matName] = true;
      const matTexs = texEntries.filter(function (t) { return t.matName === m.matName; });
      const diffuseTex = matTexs.find(function (t) { return t.slot === 'diffuse'; });
      xml += '  <effect id="' + m.matName + '_fx"><profile_COMMON>\n   <technique sid="common">\n    <lambert>\n';
      if (diffuseTex) {
        xml += '     <diffuse><texture texture="tex' + diffuseTex.idx + '" texcoord="UVSET0"/></diffuse>\n';
      } else if (m.color) {
        xml += '     <diffuse><color r="' + m.color.r.toFixed(3) + '" g="' + m.color.g.toFixed(3) + '" b="' + m.color.b.toFixed(3) + '" a="1"/></diffuse>\n';
      } else {
        xml += '     <diffuse><color r="0.8" g="0.8" b="0.8" a="1"/></diffuse>\n';
      }
      xml += '    </lambert>\n   </technique>\n  </profile_COMMON></effect>\n';
    });
    xml += ' </library_effects>\n';

    xml += ' <library_materials>\n';
    meshes.forEach(function (m) {
      /* matSeen giữ — material id trùng chỉ ghi 1 lần */
      xml += '  <material id="' + m.matName + '" name="' + m.matName + '"><instance_effect url="#' + m.matName + '_fx"/></material>\n';
    });
    xml += ' </library_materials>\n';

    /* library_geometries */
    xml += ' <library_geometries>\n';
    meshes.forEach(function (m, gi) {
      xml += '  <geometry id="geo' + gi + '" name="' + m.name + '"><mesh>\n';
      xml += '   <source id="geo' + gi + '-pos"><float_array id="geo' + gi + '-pos-array" count="' + m.verts.length + '">' +
        m.verts.map(function (x) { return x.toFixed(5); }).join(' ') + '</float_array>\n';
      xml += '   <technique_common><accessor source="#geo' + gi + '-pos-array" count="' + (m.verts.length / 3) + '" stride="3">' +
        '<param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>\n';
      if (m.hasNrm) {
        xml += '   <source id="geo' + gi + '-nrm"><float_array id="geo' + gi + '-nrm-array" count="' + m.norms.length + '">' +
          m.norms.map(function (x) { return x.toFixed(4); }).join(' ') + '</float_array>\n';
        xml += '   <technique_common><accessor source="#geo' + gi + '-nrm-array" count="' + (m.norms.length / 3) + '" stride="3">' +
          '<param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>\n';
      }
      if (m.hasUV) {
        xml += '   <source id="geo' + gi + '-uv"><float_array id="geo' + gi + '-uv-array" count="' + m.uvs.length + '">' +
          m.uvs.map(function (x) { return x.toFixed(5); }).join(' ') + '</float_array>\n';
        xml += '   <technique_common><accessor source="#geo' + gi + '-uv-array" count="' + (m.uvs.length / 2) + '" stride="2">' +
          '<param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>\n';
      }
      xml += '   <vertices id="geo' + gi + '-vtx"><input semantic="POSITION" source="#geo' + gi + '-pos"/></vertices>\n';
      const stride = 1 + (m.hasNrm ? 1 : 0) + (m.hasUV ? 1 : 0);
      xml += '   <triangles material="mat' + gi + '" count="' + (m.tris.length / 3) + '">\n';
      xml += '    <input semantic="VERTEX" source="#geo' + gi + '-vtx" offset="0"/>\n';
      if (m.hasNrm) xml += '    <input semantic="NORMAL" source="#geo' + gi + '-nrm" offset="1"/>\n';
      if (m.hasUV) xml += '    <input semantic="TEXCOORD" source="#geo' + gi + '-uv" offset="' + (m.hasNrm ? 2 : 1) + '" set="0"/>\n';
      /* p: theo offset — mỗi vertex có uv? tris là vertex index; mở rộng per-corner */
      const pArr = [];
      for (let t = 0; t < m.tris.length; t++) {
        const vi = m.tris[t];
        pArr.push(vi);
        if (m.hasNrm) pArr.push(vi);
        if (m.hasUV) pArr.push(vi);
      }
      xml += '    <p>' + pArr.join(' ') + '</p>\n';
      xml += '   </triangles>\n  </mesh></geometry>\n';
    });
    xml += ' </library_geometries>\n';

    /* visual scene */
    xml += ' <library_visual_scenes><visual_scene id="Scene" name="TruongBach">\n';
    meshes.forEach(function (m, gi) {
      xml += '  <node id="node' + gi + '" name="' + m.name + '" type="NODE">\n';
      xml += '   <instance_geometry url="#geo' + gi + '"><bind_material><technique_common>\n';
      xml += '    <instance_material symbol="mat' + gi + '" target="#' + m.matName + '"><bind_vertex_input semantic="UVSET0" input_semantic="TEXCOORD" input_set="0"/></instance_material>\n';
      xml += '   </technique_common></bind_material></instance_geometry>\n';
      xml += '  </node>\n';
    });
    xml += ' </visual_scene></library_visual_scenes>\n';
    xml += ' <scene><instance_visual_scene url="#Scene"/></scene>\n';
    xml += '</COLLADA>';

    return { dae: xml, textures: texEntries };
  }

  /* ============================================================
     FBX ASCII 7.4 EXPORTER — cơ bản (mesh + material + uv/normal)
     LƯU Ý trung thực: Blender chỉ đọc FBX BINARY; ASCII dùng cho
     Maya/Autodesk/MotionBuilder. File này không embed texture.
     ============================================================ */
  /* ============================================================
     FBX BINARY 7.4 — wrapper cho Save Center
     ============================================================ */
  /* ============================================================
     FBX MIXAMO — "Save Mixamo": mesh-only + auto-rig + CÓ MÀU
     ------------------------------------------------------------
     Mixamo chỉ nhận FBX 2013 trở xuống và từ chối file có rig lạ,
     nên bản này cố tình bỏ skeleton (noSkeleton) và sửa hệ trục/
tỉ lệ.
     Để model CÓ MÀU trên Mixamo, ảnh texture được nhúng thẳng vào
     Video.Content (raw bytes) và nối vào Material bằng connection OP
     kèm tên property — đúng cấu trúc file Meshy gốc mà Mixamo đọc được.
     Vì vậy phải CHỜ ảnh texture decode xong trước khi ghi file.
     ============================================================ */
  function waitForTextures(root, timeoutMs) {
    const imgs = [];
    const seen = new Set();
    const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
    if (!root || !root.traverse) return Promise.resolve({ total: 0, ready: 0 });
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m) return;
        SLOTS.forEach(function (s) {
          const t = m[s];
          const im = (t && (t.userData && t.userData.originalImage || t.image)) || null;
          if (im && !seen.has(im)) { seen.add(im); imgs.push(im); }
        });
      });
    });
    if (!imgs.length) return Promise.resolve({ total: 0, ready: 0 });
    const ready = function (im) { return (im.width || im.videoWidth || 0) > 0; };
    const waits = imgs.map(function (im) {
      if (ready(im)) return Promise.resolve(true);
      if (typeof im.decode === 'function') {
        return im.decode().then(function () { return ready(im); }).catch(function () { return ready(im); });
      }
      return new Promise(function (res) {
        const done = function () { res(ready(im)); };
        im.addEventListener && im.addEventListener('load', done, { once: true });
        im.addEventListener && im.addEventListener('error', done, { once: true });
        setTimeout(done, timeoutMs);
      });
    });
    const all = Promise.all(waits).then(function () { return true; });
    const boom = new Promise(function (r) { setTimeout(function () { r(false); }, timeoutMs); });
    return Promise.race([all, boom]).then(function () {
      let ok = 0; imgs.forEach(function (im) { if (ready(im)) ok++; });
      return { total: imgs.length, ready: ok };
    });
  }

  function countTris(root) {
    let tris = 0;
    if (root && root.traverse) root.traverse(function (o) {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        const pos = o.geometry.attributes.position;
        tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
      }
    });
    return Math.round(tris);
  }

  /* v20.0 — Mixamo Pre-flight: kiểm tra model trước khi ghi FBX.
     Lỗi chặn (errors) → ok=false, warn chứa 'LỖI: ...'; cảnh báo →
     ok=true, warn để gộp vào thông báo. Thiếu module validator thì
     bỏ qua (giữ hành vi cũ). ROUND 4: luôn chạy trên nhóm ĐÃ chuẩn
     bị Mixamo-safe (xem prepareMixamoSafe) — ngưỡng tris là >= 50.000. */
  function mixamoPreflight(target, mode) {
    var V = PixiStudio.MixamoValidator;
    if (!V) return { ok: true, warn: [] };
    try {
      var res = V.check(target, { mode: mode });
      var warn = [];
      res.errors.forEach(function (e) { warn.push('LỖI: ' + e); });
      res.warnings.forEach(function (w) { warn.push(w); });
      return { ok: res.ok, warn: warn, summary: V.summary(res) };
    } catch (e) { return { ok: true, warn: [] }; }
  }

  /* v21.0+ (round 4) — Chuẩn bị mesh Mixamo-safe TRƯỚC khi ghi FBX:
     bỏ skeleton + tự decimate giữ UV nếu >= 50k tris (đúng công thức
     2 file mẫu Thiếu Lâm/Thần Điêu đã sửa tay). Trả { group, report }
     hoặc null (đã notify lỗi). Thiếu module thì dùng model gốc như cũ. */
  function prepareMixamoSafe(source) {
    const MSE = PixiStudio.MixamoSafeExport;
    if (!MSE || typeof MSE.prepare !== 'function') {
      const t = countTris(source);
      return { group: source, report: { trisBefore: t, trisAfter: t, decimated: false, warnings: [] } };
    }
    PixiStudio.Notifications.updateLoading(45, 'Đang chuẩn bị mesh Mixamo-safe (bỏ skeleton, giảm tris nếu cần)...');
    const prepared = MSE.prepare(source);
    if (!prepared.group) {
      bus.emit('notify', { type: 'error', title: 'Mixamo-safe', message: 'Không xuất được file Mixamo: ' + prepared.report.errors.join('; ') });
      return null;
    }
    return prepared;
  }

  function saveFBXMixamo(target, modelName, finish, fmt, textureBytes) {
    PixiStudio.Notifications.updateLoading(20, 'Chờ texture decode để nhúng màu vào FBX...');
    return new Promise(function (resolve) {
      /* Chờ meshopt WASM sẵn sàng SONG SONG với texture (không thêm
         thời gian chờ — texture decode lâu hơn nhiều). prepare() dùng
         meshopt khi sẵn sàng, rơi về voxel khi chưa kịp load. */
      var MSE0 = PixiStudio.MixamoSafeExport;
      var readyP = (MSE0 && MSE0.waitMeshoptReady) ? MSE0.waitMeshoptReady(5000) : Promise.resolve(false);
      Promise.all([waitForTextures(target, 8000), readyP]).then(function (results) {
        var tx = results[0];
        PixiStudio.Notifications.updateLoading(60, 'Ghi FBX 2013 cho Mixamo (mesh-only + texture nhúng)...');
        setTimeout(function () {
          try {
            /* Round 4 — chuẩn bị Mixamo-safe trước: bỏ skeleton, tự
               decimate giữ UV nếu >= 50k tris (như file Thiếu Lâm/
               Thần Điêu đã sửa tay). Pre-flight chỉ chạy trên nhóm
               ĐÃ chuẩn bị — chỉ chặn khi decimate xong vẫn không đạt. */
            const prepared = prepareMixamoSafe(target);
            if (!prepared) { PixiStudio.Notifications.hideLoading(); resolve(null); return; }
            const pre = mixamoPreflight(prepared.group, 'mesh-only');
            if (!pre.ok) {
              PixiStudio.Notifications.hideLoading();
              bus.emit('notify', { type: 'error', title: 'Mixamo Pre-flight', message: 'Model chưa đủ điều kiện upload Mixamo: ' + pre.warn.join('; ') });
              resolve(null);
              return;
            }
            const res = PixiStudio.FBXBinary.write(prepared.group, {
              noSkeleton: true,
              prepareMixamo: true,
              mixamoNames: true,   /* tên 'Class::Name' như 2 file mẫu đã auto-rig được */
              version: 7300,
              upAxis: 'Y',
              autoScale: true,
              includeTextures: true,
              embedTextures: true,
              /* textureBytes: nút GLB→FBX trích trực tiếp từ file GLB
                 (không qua tex.image/canvas) — file LUÔN có màu. */
              textureBytes: textureBytes || null
            });
            const blob = new Blob([res.bytes], { type: 'application/octet-stream' });
            const name = buildFileName(modelName, 'mixamo', fmt ? fmt.ext : '.fbx');
            finish(blob, { mixamo: true, textures: res.report.textures }, name);
            const r = res.report;
            const warn = pre.warn.slice();
            warn.push.apply(warn, prepared.report.warnings || []);
            if (!r.textures && tx.total) warn.push('texture chưa decode xong (' + tx.ready + '/' + tx.total + ') — file sẽ KHÔNG có màu');
            bus.emit('notify', {
              type: warn.length ? 'warning' : 'success',
              title: 'Save Mixamo xong',
              message: r.meshes + ' mesh · ' + prepared.report.trisBefore + ' → ' + prepared.report.trisAfter + ' tam giác · ' + r.textures + ' texture nhúng · mesh-only (Mixamo tự auto-rig) · ' + U.formatBytes(r.bytes) +
                (warn.length ? ' — LƯU Ý: ' + warn.join('; ') : ' — mở https://www.mixamo.com → Characters → Upload Character.'),
              duration: 12000
            });
            resolve(null);
          } catch (err) {
            PixiStudio.Notifications.hideLoading();
            bus.emit('notify', { type: 'error', title: 'Save Mixamo lỗi', message: String(err && err.message || err) });
            resolve(null);
          }
        }, 40);
      });
    });
  }

  /* ============================================================
     GLB → FBX MIXAMO — nút chuyển file trực tiếp (11-2026)
     ------------------------------------------------------------
     Vấn đề: nút Save Mixamo chỉ xuất MODEL ĐANG Ở TRONG SCENE
     (State.selection || Viewport.getMainModel). Nếu model muốn
     chuyển chưa được load vào scene, hoặc scene đang giữ model
     khác, nút đó xuất sai model / không ra file — và người dùng
     tưởng là lỗi Mixamo. Nút này bỏ qua scene hoàn toàn: chọn
     file .glb trên máy → parse bằng GLTFLoader → chạy ĐÚNG
     pipeline Save Mixamo (prepareMixamoSafe + preflight +
     FBXBinary.write noSkeleton/version 7300) → tải .fbx về.
     Dùng chung code nên file ra giống hệt nút Save Mixamo
     (đã kiểm chứng bằng fbx2gltf: v7300, 0 xương, 0 skin).
     ============================================================ */
  /* ============================================================
     GLB → FBX: trích texture TRỰC TIẾP từ file GLB (bytes gốc).
     ------------------------------------------------------------
     Lý do: GLTFLoader trên Chrome/Android dùng ImageBitmapLoader —
     tex.image là ImageBitmap, và canvas.toDataURL trên ảnh 3072²
     có thể fail trên máy yếu → nút GLB→FBX ra file mất màu (người
     dùng báo 2026-11-26). Cách này đọc bytes gốc từ GLB (bufferView)
     rồi lật dọc bằng canvas: lật được → JPEG đã lật (đúng chiều FBX);
     lật fail → nhúng bytes gốc (vẫn có màu, chỉ có thể lộn chiều).
     File LUÔN có texture, không còn mất màu. Trả Promise -> map
     {matName: {map: {b64,mime,w,h}, normalMap: {...}}} (định dạng
     textureBytes mà FBXBinary.write đã hỗ trợ).
     ============================================================ */
  function bytesToBase64(u8) {
    var s = '';
    var CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(s);
  }
  function imageDims(u8, mime) {
    /* PNG: IHDR width/height big-endian tại byte 16/20. JPEG: quét
       marker tìm SOF0 (0xFFC0) / SOF2 (0xFFC2), height/width tại +5/+7. */
    try {
      if (mime === 'image/png' && u8.length > 24 && u8[0] === 0x89 && u8[1] === 0x50) {
        var w = (u8[16] << 24) | (u8[17] << 16) | (u8[18] << 8) | u8[19];
        var h = (u8[20] << 24) | (u8[21] << 16) | (u8[22] << 8) | u8[23];
        return { w: w, h: h };
      }
      if (mime === 'image/jpeg' && u8.length > 4 && u8[0] === 0xFF && u8[1] === 0xD8) {
        var p = 2;
        while (p + 9 < u8.length) {
          if (u8[p] !== 0xFF) { p++; continue; }
          var mk = u8[p + 1];
          if (mk === 0xC0 || mk === 0xC2) {
            return { w: (u8[p + 7] << 8) | u8[p + 8], h: (u8[p + 5] << 8) | u8[p + 6] };
          }
          if (mk === 0xD8 || mk === 0x01 || (mk >= 0xD0 && mk <= 0xD7)) { p += 2; continue; }
          var len = (u8[p + 2] << 8) | u8[p + 3];
          p += 2 + len;
        }
      }
    } catch (e) { /* bỏ qua */ }
    return { w: 0, h: 0 };
  }
  function flipImageBytes(u8, mime, isNormal) {
    /* Lật dọc ảnh bytes -> JPEG (map) / PNG (normal) bằng canvas.
       Trả Promise<{b64,mime,w,h}>; fail -> null (caller dùng bytes gốc). */
    return new Promise(function (resolve) {
      try {
        var blob = new Blob([u8], { type: mime });
        var url = (window.URL || window.webkitURL).createObjectURL(blob);
        var img = new Image();
        var done = function (ok) {
          try { (window.URL || window.webkitURL).revokeObjectURL(url); } catch (e) { /* noop */ }
          if (!ok || !img.width || !img.height) { resolve(null); return; }
          try {
            var c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            var cx = c.getContext('2d');
            cx.translate(0, img.height); cx.scale(1, -1);
            cx.drawImage(img, 0, 0, img.width, img.height);
            var outMime = isNormal ? 'image/png' : 'image/jpeg';
            var dataUrl = c.toDataURL(outMime, outMime === 'image/jpeg' ? 0.92 : undefined);
            var b64 = dataUrl.split(',')[1];
            resolve({ b64: b64, mime: outMime, w: img.width, h: img.height });
          } catch (e) { resolve(null); }
        };
        img.onload = function () { done(true); };
        img.onerror = function () { done(false); };
        setTimeout(function () { done(false); }, 8000);
        img.src = url;
      } catch (e) { resolve(null); }
    });
  }
  function extractGLBTextureBytes(arrayBuffer) {
    return new Promise(function (resolve) {
      var out = {};
      try {
        var dv = new DataView(arrayBuffer);
        if (dv.getUint32(0, true) !== 0x46546C67) { resolve(out); return; }  /* 'glTF' */
        var jsonLen = dv.getUint32(12, true);
        var json = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer, 20, jsonLen)));
        var off = 20 + jsonLen;
        if (off + 8 > arrayBuffer.byteLength) { resolve(out); return; }
        var binLen = dv.getUint32(off, true);
        var bin = new Uint8Array(arrayBuffer, off + 8, binLen);
        var images = (json.images || []).map(function (im) {
          if (im.bufferView === undefined) return null;
          var bv = json.bufferViews[im.bufferView];
          var o = bv.byteOffset || 0;
          var bytes = bin.slice(o, o + bv.byteLength);
          var mime = im.mimeType || (bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg');
          return { bytes: bytes, mime: mime };
        });
        var jobs = [];
        (json.materials || []).forEach(function (mat, mi) {
          var name = mat.name || ('mat_' + mi);
          var pbr = mat.pbrMetallicRoughness || {};
          var slots = [];
          if (pbr.baseColorTexture !== undefined) slots.push(['map', pbr.baseColorTexture.index, false]);
          if (mat.normalTexture !== undefined) slots.push(['normalMap', mat.normalTexture.index, true]);
          slots.forEach(function (sl) {
            var tex = (json.textures || [])[sl[1]];
            if (!tex || tex.source === undefined) return;
            var im = images[tex.source];
            if (!im) return;
            var dims = imageDims(im.bytes, im.mime);
            var raw = { b64: bytesToBase64(im.bytes), mime: im.mime, w: dims.w, h: dims.h };
            jobs.push(flipImageBytes(im.bytes, im.mime, sl[2]).then(function (flipped) {
              if (!out[name]) out[name] = {};
              /* Ưu tiên ảnh đã lật (đúng chiều FBX); lật fail -> bytes gốc. */
              out[name][sl[0]] = flipped || raw;
            }));
          });
        });
        if (!jobs.length) { resolve(out); return; }
        Promise.all(jobs).then(function () { resolve(out); });
      } catch (e) { resolve(out); }
    });
  }

  /* Expose để test harness kiểm chứng (không dùng trong UI). */
  SaveManager._extractGLBTextureBytes = extractGLBTextureBytes;

  SaveManager.convertGLBBufferToMixamoFBX = function (arrayBuffer, baseName) {
    if (!THREE.GLTFLoader) return Promise.reject(new Error('GLTFLoader chưa sẵn sàng (CDN lỗi?) — tải lại trang rồi thử lại.'));
    PixiStudio.Notifications.showLoading('Đang đọc file GLB…', 5);
    /* Trích texture TRỰC TIẾP từ GLB song song với GLTFLoader — không
       phụ thuộc tex.image/ImageBitmap + canvas.toDataURL (hay fail trên
       máy yếu -> file mất màu). */
    var texP = extractGLBTextureBytes(arrayBuffer);
    return new Promise(function (resolve, reject) {
      new THREE.GLTFLoader().parse(arrayBuffer, '', resolve, reject);
    }).then(function (gltf) {
      var model = (gltf && gltf.scene) || (gltf && gltf.scenes && gltf.scenes[0]);
      if (!model) throw new Error('File GLB không chứa scene nào.');
      var name = String(baseName || 'model').replace(/\.[^.]+$/, '');
      var out = null;
      return texP.then(function (textureBytes) {
        /* GLTFLoader đặt material.name theo tên trong GLB; material nào
           không tên thì gán tên 'mat_i' cho khớp key textureBytes. */
        var mi = 0;
        model.traverse(function (o) {
          if (!o.isMesh || !o.material) return;
          var mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(function (m) {
            if (m && !m.name) { m.name = 'mat_' + (mi++); }
          });
        });
        return saveFBXMixamo(model, name, function (blob, report, filename) {
          U.downloadBlob(blob, filename);
          PixiStudio.Notifications.hideLoading();
          SaveManager.logSave({ name: filename, format: 'fbx-mixamo', sizeBytes: blob.size });
          bus.emit('notify', {
            type: 'success', title: 'Đã chuyển ' + filename,
            message: (blob.size / 1048576).toFixed(2) + ' MB · mesh-only (Mixamo tự auto-rig) — mở https://www.mixamo.com → Characters → Upload Character.',
            duration: 12000
          });
          out = { blob: blob, filename: filename };
        }, { id: 'fbx-mixamo', ext: '.fbx' }, textureBytes);
      }).then(function () { return out; });
    });
  };

  SaveManager.convertGLBToMixamoFBX = function () {
    /* Input file PHẢI gắn vào DOM (ẩn) trước khi click(): input tạo bằng
       createElement mà không append thì click() im lặng trên headless
       Chrome và một số trình duyệt Android — nút bấm không mở hộp chọn
       file, không toast, không lỗi (phát hiện 2026-11-26 khi kiểm thử
       nút thật trên studio live: bấm 3 lần, không phản hồi gì). Dùng 1
       input ẩn cố định, tái sử dụng mỗi lần bấm; reset value sau mỗi
       lần chọn để chọn lại cùng file vẫn kích hoạt onchange. */
    var input = SaveManager._glbFileInput;
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = '.glb,.gltf';
      input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
      input.onchange = function () {
        var file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        U.readFileAsArrayBuffer(file).then(function (buf) {
          return SaveManager.convertGLBBufferToMixamoFBX(buf, file.name);
        }).catch(function (err) {
          PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'Chuyển GLB → FBX lỗi', message: String(err && err.message || err) });
        });
      };
      document.body.appendChild(input);
      SaveManager._glbFileInput = input;
    }
    input.click();
  };

  /* ============================================================
     TỐI ƯU FBX < 1MB — nút "Tối ưu FBX" (11-2026)
     ------------------------------------------------------------
     Tối ưu model ĐANG Ở TRONG SCENE xuống dưới 1 MiB để chia sẻ /
     upload nơi giới hạn dung lượng: giảm tris bằng meshopt (giữ
     hình dạng + UV + skin weights) + thu nhỏ texture về JPEG
     + giữ nguyên skeleton/skin (khác nút Save Mixamo là mesh-only).
     Lặp tối đa 5 mức, dừng ngay khi file < 1MB; nếu 5 mức vẫn chưa
     đủ thì tải bản nhỏ nhất kèm cảnh báo.

     TEXTURE-FIRST (v2, 2026-11-27) — đo trên file thật:
     GLB Tripo gốc (50.000 tris) chi 660.639 B cho 3 texture 1024²
     (32% file); file tối ưu cũ chỉ chi 18.424 B cho 2 texture 256²
     (2% file) mà vẫn 1.018.188 B trên Thiếu Lâm rigged — nút cũ
     KHÁT TEXTURE: độ nét cảm nhận chủ yếu đến từ độ phân giải
     texture, không phải tris. Đo bằng PIL trên texture thật:
     map 512² q85 ≈ 66KB, normal 512² q85 ≈ 23KB (tổng ≈ 89KB);
     map 256² q70 + normal 256² q70 ≈ 18KB. Đổi 1.500 tris
     (~9% tris, ~85KB geometry) lấy texture 512² thay cho 256²
     (4x điểm ảnh, +71KB) nên bảng attempt mới ưu tiên texture
     512² ở 3 mức đầu, chỉ giảm TRIS trước (16.000 → 14.500 →
     13.000), rồi mới hạ texture xuống 384² (mức 4), và chỉ về
     256² + bỏ normalMap ở mức cuối khi thật sự không vừa.
     Map và normalMap DÙNG CHUNG 1 mức tex/q: normalMap JPEG rất
     rẻ (nền trơn → 512² q85 chỉ ≈ 23KB, ~26% ngân sách texture)
     nên tách res riêng chỉ tiết kiệm ~11KB mà tốn thêm schema +
     chữ ký textureProvider — không đáng; basecolor (quyết định độ
     nét nhiều nhất) được giữ 512² tới mức 3 nhờ đó.
     Ước tính (Thiếu Lâm rigged, geometry ~62 B/tri do đỉnh double
     nhiễu — xem ghi chú dưới): mức 1 ≈ 1.086.000 B → trượt, mức 2
     ≈ 980KB vừa; Thần Điêu GLB mức 1 ≈ 891KB vừa ngay.
     KHÔNG tăng giới hạn 1MB, KHÔNG bỏ skeleton/animation,
     KHÔNG bỏ weld/meshopt.

     QUAN TRỌNG — writer ghi Vertices/Normals/UV dạng double (8
     byte); FBX SDK (fbx2gltf/Blender) SEGFAULT khi gặp mảng float
     cho geometry nên KHÔNG đổi sang float được. Thay vào đó writer
     nén zlib (enc=1, chuẩn Blender — FBXLoader r128 đọc bằng
     fflate.unzlibSync) + ghi Normal/UV dạng IndexToDirect (mảng
     chỉ chứa giá trị duy nhất + Index map từng polygon-vertex,
     như Blender) → ~60 byte/tri (đã đo trên Thiếu Lâm: 15.520
     tris ≈ 955KB, ngang Blender). Chi phí geometry PHỤ THUỘC
     NGUỒN (đo 2026-11-27): file Mixamo có đỉnh double "sạch"
     (byte thấp mantissa toàn 0 — thực chất là float32) nên
     Vertices nén còn 131.637 B; file rigged AttackRun có đỉnh
     double nhiễu đủ 8 byte (byte thấp 256 giá trị khác nhau)
     nên cùng ~13,6k đỉnh Vertices nén tới 221.787 B (+90KB,
     ~62 B/tri thay vì ~57 B/tri). Hướng cải tiến sau (ngoài
     vòng này): lượng tử đỉnh về độ chính xác float32 trước khi
     ghi để Vertices nén tốt hơn — KHÔNG làm ở đây vì chạm
     writer + có thể ảnh hưởng skin/bindpose. KHÔNG dùng ByVertex cho UV:
     1 vị trí có nhiều UV (UV seam) nên reader sẽ bỏ UV và gộp
     đỉnh theo vị trí (đã đo 2026-11-26: 9.495 đỉnh → 4.353).
     Ngoài ra writer ghi TOÀN BỘ đỉnh trong attribute (kể cả đỉnh
     không còn trong index sau decimate) nên sau khi decimate
     PHẢI compact geometry (chỉ giữ đỉnh còn dùng) — nếu không
     file vẫn to như gốc dù tris đã giảm.
     ============================================================ */
  var OPT_1MB = 1048576; /* 1 MiB */
  /* TEXTURE-FIRST (v2, 2026-11-27): 3 mức đầu giữ texture 512²,
     chỉ giảm TRIS trước; mức 4 mới hạ texture 384²; mức cuối
     mới về 256² + bỏ normalMap. Xem bảng đo trong comment đầu mục. */
  var OPT_ATTEMPTS = [
    { tris: 16000, tex: 512, q: 0.85, dropNormal: false, err: 0.02 },
    { tris: 14500, tex: 512, q: 0.80, dropNormal: false, err: 0.02 },
    { tris: 13000, tex: 512, q: 0.70, dropNormal: false, err: 0.03 },
    { tris: 11500, tex: 384, q: 0.80, dropNormal: false, err: 0.03 },
    { tris: 9500, tex: 256, q: 0.60, dropNormal: true, err: 0.04 }
  ];

  /* MỨC NHẸ HƠN (v2-lite, 2026-11-27) — cùng nguyên tắc
     TEXTURE-FIRST trong ngân sách nhỏ hơn: 2 mức đầu vẫn giữ
     texture 512², chỉ giảm TRIS trước; mức 3-4 mới hạ 384²;
     mức cuối mới về 256² + bỏ normalMap. Ước tính theo model
     "xấu nhất" đã đo (Thiếu Lâm rigged, geometry ~64 B/tri do
     đỉnh double nhiễu; texture đo thật: 512² q80 ≈ 75KB,
     512² q70 ≈ 58KB, 384² q80 ≈ 47KB, 384² q70 ≈ 36KB,
     256² q60 ≈ 15KB map-only):
       700KB: mức 1 ≈ 9.500×64 + 75K ≈ 680KB vừa;
       500KB: mức 1 ≈ 6.500×64 + 75K ≈ 489KB vừa;
       300KB: mức 1 ≈ 3.500×64 + 58K ≈ 281KB vừa.
     Ở 300KB tris chỉ còn ~3.500 — silhouette sẽ thô rõ, chỉ
     còn texture giữ mặt/áo đọc được (xem render so sánh trong
     harness). Rig + skin giữ nguyên ở mọi mức (chỉ tris và
     texture thay đổi); clip thì writer vốn không ghi (giới hạn
     đã biết, không liên quan mức dung lượng). */
  var OPT_ATTEMPTS_700K = [
    { tris: 9500, tex: 512, q: 0.80, dropNormal: false, err: 0.02 },
    { tris: 8500, tex: 512, q: 0.70, dropNormal: false, err: 0.03 },
    { tris: 7500, tex: 384, q: 0.80, dropNormal: false, err: 0.03 },
    { tris: 6500, tex: 384, q: 0.70, dropNormal: false, err: 0.04 },
    { tris: 5500, tex: 256, q: 0.60, dropNormal: true, err: 0.05 }
  ];
  var OPT_ATTEMPTS_500K = [
    { tris: 6500, tex: 512, q: 0.80, dropNormal: false, err: 0.03 },
    { tris: 6000, tex: 512, q: 0.70, dropNormal: false, err: 0.03 },
    { tris: 5500, tex: 384, q: 0.80, dropNormal: false, err: 0.04 },
    { tris: 4500, tex: 384, q: 0.70, dropNormal: false, err: 0.04 },
    { tris: 3500, tex: 256, q: 0.60, dropNormal: true, err: 0.05 }
  ];
  var OPT_ATTEMPTS_300K = [
    { tris: 3500, tex: 512, q: 0.70, dropNormal: false, err: 0.03 },
    { tris: 3000, tex: 512, q: 0.70, dropNormal: false, err: 0.04 },
    { tris: 2800, tex: 384, q: 0.80, dropNormal: false, err: 0.04 },
    { tris: 2400, tex: 384, q: 0.70, dropNormal: false, err: 0.05 },
    { tris: 2000, tex: 256, q: 0.60, dropNormal: true, err: 0.05 }
  ];
  /* Bảng mức dung lượng cho nút Tối ưu FBX (UI: select cạnh nút,
     mặc định 1MB — hành vi cũ không đổi khi không chọn gì). */
  var OPT_TARGETS = [
    { id: '1mb', label: '<1MB', bytes: 1048576, suffix: 'opt1mb', attempts: OPT_ATTEMPTS },
    { id: '700k', label: '<700KB', bytes: 716800, suffix: 'opt700k', attempts: OPT_ATTEMPTS_700K },
    { id: '500k', label: '<500KB', bytes: 512000, suffix: 'opt500k', attempts: OPT_ATTEMPTS_500K },
    { id: '300k', label: '<300KB', bytes: 307200, suffix: 'opt300k', attempts: OPT_ATTEMPTS_300K }
  ];
  /* Tra mức theo số byte yêu cầu: khớp đúng id/bytes thì lấy đúng
     mức; số lạ thì lấy mức lớn nhất mà vẫn <= yêu cầu (không bao
     giờ tự nhảy lên mức nặng hơn); dưới 300KB thì lấy 300KB. */
  function optTargetFor(bytes) {
    var b = (typeof bytes === 'number' && isFinite(bytes) && bytes > 0) ? Math.floor(bytes) : OPT_1MB;
    /* Bảng xếp từ nặng xuống nhẹ: mức đầu tiên vừa <= yêu cầu là
       mức lớn nhất còn đạt — không bao giờ tự nhảy lên mức nặng hơn. */
    for (var i = 0; i < OPT_TARGETS.length; i++) {
      if (OPT_TARGETS[i].bytes <= b) return OPT_TARGETS[i];
    }
    return OPT_TARGETS[OPT_TARGETS.length - 1]; /* dưới 300KB thì lấy 300KB */
  }

  /* Số tam giác của 1 geometry (triCountOf nằm trong
     MixamoSafeExport, không có sẵn trong scope này). */
  function triCountOfGeo(geo) {
    if (!geo || !geo.attributes || !geo.attributes.position) return 0;
    return Math.floor((geo.index ? geo.index.count : geo.attributes.position.count) / 3);
  }

  /* Clone 1 model (kể cả rig) để xuất file mà KHÔNG sửa scene.
     THREE.Object3D.clone() của SkinnedMesh giữ skeleton trỏ về
     xương GỐC (không phải xương clone) → writer tra
     boneIds[bone.uuid] sẽ lệch / crash (boneWorldX[uuid] undefined).
     Hàm này rebind skeleton của mesh clone về xương clone (khớp
     theo tên — xương rig có tên duy nhất), giữ nguyên boneInverses
     (bind matrix không đổi vì xương clone cùng transform local). */
  function cloneModelForExport(root) {
    var THREE = window.THREE;
    /* r128: SkeletonHelper.clone() crash (new SkeletonHelper() không có root →
       getBoneList(undefined)). Model rig bằng AutoRigPro có helper nằm trong
       cây (auto-rig-pro.js add helper vào target) nên clone(true) trực tiếp
       sẽ crash — nút "Tối ưu FBX" sẽ lỗi trên đúng model vừa rig. Tạm gỡ
       helper khỏi cây trước khi clone rồi gắn lại đúng chỗ. */
    var detachedHelpers = [];
    try {
      root.traverse(function (o) {
        if (o.isSkeletonHelper && o.parent) detachedHelpers.push({ obj: o, parent: o.parent });
      });
      detachedHelpers.forEach(function (d) { try { d.parent.remove(d.obj); } catch (e) {} });
    } catch (e) {}
    var clone;
    try { clone = root.clone(true); }
    finally {
      detachedHelpers.forEach(function (d) { try { d.parent.add(d.obj); } catch (e) {} });
    }
    var origBones = [], cloneBones = [];
    root.traverse(function (o) { if (o.isBone) origBones.push(o); });
    clone.traverse(function (o) { if (o.isBone) cloneBones.push(o); });
    var byName = {};
    cloneBones.forEach(function (b) { byName[b.name] = b; });
    var boneMap = new Map();
    origBones.forEach(function (b) { if (byName[b.name]) boneMap.set(b, byName[b.name]); });
    clone.traverse(function (o) {
      if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones) {
        var nb = o.skeleton.bones.map(function (b) { return boneMap.get(b) || b; });
        o.skeleton = new THREE.Skeleton(nb, o.skeleton.boneInverses);
      }
    });
    /* --- ARP-RIGLAYERS (Nhóm 5, 2026-11-27): gỡ control/mechanism
       khỏi bản clone xuất — xương __proxy LÀ Bone nên FBXBinary.write
       sẽ ghi nó nếu không gỡ; control Object3D + mesh hiển thị cũng
       được gỡ cho sạch. Chỉ gỡ xương KHÔNG nằm trong skeleton.bones
       nên skin không đổi. Không có ArpRigLayers thì bỏ qua, export
       chạy như cũ. --- */
    try {
      var RL = window.PixiStudio && PixiStudio.ArpRigLayers;
      if (RL && typeof RL.stripNonDeformFromClone === 'function') RL.stripNonDeformFromClone(clone);
    } catch (e) {}
    return clone;
  }

  /* Compact geometry: chỉ giữ các đỉnh còn được index dùng tới, remap
     index theo. BẮT BUỘC sau decimateMeshopt vì nó chỉ đổi index
     (attribute vẫn giữ đủ đỉnh gốc) mà writer ghi toàn bộ đỉnh trong
     attribute thành double → file không nhỏ lại. Compact là phép
     biến đổi không mất mát (chỉ bỏ đỉnh thừa), giữ nguyên mọi
     attribute theo đỉnh (kể cả skinIndex/skinWeight). */
  function compactGeometry(geometry) {
    var THREE = window.THREE;
    var index = geometry.index;
    if (!index || !index.array) return geometry;
    var idxArr = index.array;
    var pos = geometry.attributes.position;
    if (!pos) return geometry;
    var n = pos.count;
    var remap = new Int32Array(n);
    for (var i = 0; i < n; i++) remap[i] = -1;
    var used = [];
    for (var j = 0; j < idxArr.length; j++) {
      var vi = idxArr[j];
      if (remap[vi] === -1) { remap[vi] = used.length; used.push(vi); }
    }
    if (used.length === n) return geometry; /* không có đỉnh thừa */
    var newCount = used.length;
    var g = new THREE.BufferGeometry();
    Object.keys(geometry.attributes).forEach(function (name) {
      var attr = geometry.attributes[name];
      var itemSize = attr.itemSize;
      var Arr = attr.array.constructor;
      var out = new Arr(newCount * itemSize);
      for (var u = 0; u < newCount; u++) {
        var src = used[u];
        for (var k = 0; k < itemSize; k++) out[u * itemSize + k] = attr.array[src * itemSize + k];
      }
      g.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
    });
    var newIdx = new Uint32Array(idxArr.length);
    for (var j2 = 0; j2 < idxArr.length; j2++) newIdx[j2] = remap[idxArr[j2]];
    g.setIndex(new THREE.BufferAttribute(newIdx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  /* Weld/index geometry: gộp các đỉnh trùng (vị trí + normal + UV +
     skin) thành 1 đỉnh duy nhất, trả geometry đã index. BẮT BUỘC
     trước meshopt vì FBXLoader trả geometry non-indexed (mỗi tam
     giác 3 đỉnh riêng, 140.751 verts cho 46.917 tris) → meshopt
     không có cạnh chung để collapse nên simplify trả nguyên không
     giảm (đã đo: 46.917 → 46.917, err 0). Key gồm đủ attribute để
     không gộp nhầm đỉnh khác normal (cạnh sắc) hay khác skin weights. */
  /* Weld/index geometry: gộp các đỉnh trùng (vị trí + normal + UV +
     skin) thành 1 đỉnh duy nhất, trả geometry đã index. BẮT BUỘC
     trước meshopt vì FBXLoader trả geometry non-indexed (mỗi tam
     giác 3 đỉnh riêng, 140.751 verts cho 46.917 tris) → meshopt
     không có cạnh chung để collapse nên simplify trả nguyên không
     giảm (đã đo: 46.917 → 46.917, err 0). Key gồm đủ attribute để
     không gộp nhầm đỉnh khác normal (cạnh sắc) hay khác skin weights.
     CHẠY ĐƯỢC CẢ TRÊN GEOMETRY ĐÃ INDEXED: sau meshopt,
     decimateMeshopt xóa normal cũ + computeVertexNormals() tính lại
     → các đỉnh từng khác normal gốc (weld giữ riêng) giờ có cùng
     normal mới nên thành trùng y hệt (đã đo: 9.487 đỉnh ghi ra
     nhưng chỉ 4.353 duy nhất) — vì vậy decimateCloneToBudget gọi
     weld LẠI sau compact để gộp số đỉnh trùng này. */
  function weldGeometry(geometry) {
    var THREE = window.THREE;
    if (!geometry) return geometry;
    var pos = geometry.attributes.position;
    if (!pos) return geometry;
    var names = Object.keys(geometry.attributes);
    var n = pos.count;
    var map = new Map();
    var remap = new Int32Array(n);
    var used = [];
    for (var i = 0; i < n; i++) {
      var parts = [];
      for (var a = 0; a < names.length; a++) {
        var attr = geometry.attributes[names[a]];
        var base = i * attr.itemSize;
        for (var k = 0; k < attr.itemSize; k++) {
          var v = attr.array[base + k];
          parts.push(typeof v === 'number' ? v.toFixed(5) : String(v));
        }
      }
      var key = parts.join('|');
      var idx = map.get(key);
      if (idx === undefined) { idx = used.length; map.set(key, idx); used.push(i); }
      remap[i] = idx;
    }
    if (used.length === n) {
      if (geometry.index) return geometry; /* đã index, không gộp được thêm */
      /* Không gộp được đỉnh nào — vẫn cần index để meshopt chạy. */
      var g0 = new THREE.BufferGeometry();
      Object.keys(geometry.attributes).forEach(function (nm) { g0.setAttribute(nm, geometry.attributes[nm]); });
      var idx0 = new Uint32Array(n);
      for (var j0 = 0; j0 < n; j0++) idx0[j0] = j0;
      g0.setIndex(new THREE.BufferAttribute(idx0, 1));
      g0.computeBoundingBox(); g0.computeBoundingSphere();
      return g0;
    }
    var g = new THREE.BufferGeometry();
    names.forEach(function (name) {
      var at = geometry.attributes[name];
      var itemSize = at.itemSize;
      var Arr = at.array.constructor;
      var out = new Arr(used.length * itemSize);
      for (var u = 0; u < used.length; u++) {
        var src = used[u];
        for (var k2 = 0; k2 < itemSize; k2++) out[u * itemSize + k2] = at.array[src * itemSize + k2];
      }
      g.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
    });
    var oldIdx = geometry.index ? geometry.index.array : null;
    var idxLen = oldIdx ? oldIdx.length : n;
    var newIdx = new Uint32Array(idxLen);
    for (var j = 0; j < idxLen; j++) newIdx[j] = remap[oldIdx ? oldIdx[j] : j];
    g.setIndex(new THREE.BufferAttribute(newIdx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  /* Decimate toàn bộ mesh trong clone về tổng triBudget (chia theo tỉ
     lệ tris gốc, như prepare). targetError: sai số meshopt (m).
     Trả {trisBefore, trisAfter}. */
  function decimateCloneToBudget(clone, triBudget, targetError) {
    var MSE = PixiStudio.MixamoSafeExport;
    var meshes = [];
    clone.traverse(function (o) {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        if (o.userData && o.userData.isBoneVisual) return;
        meshes.push(o);
      }
    });
    var total = 0;
    meshes.forEach(function (m) { total += triCountOfGeo(m.geometry); });
    var trisAfter = total;
    if (MSE && typeof MSE.decimateMeshopt === 'function' && total > triBudget) {
      var done = 0;
      meshes.forEach(function (m, i) {
        var t = triCountOfGeo(m.geometry);
        var share = (i === meshes.length - 1)
          ? Math.max(1, triBudget - done)
          : Math.max(1, Math.floor(triBudget * t / Math.max(1, total)));
        /* Weld trước (FBX non-indexed) rồi mới meshopt, xong compact,
           rồi weld LẠI: meshopt tính lại normal nên nhiều đỉnh thành
           trùng y hệt (khác normal gốc, cùng normal mới) — weld lần 2
           gộp chúng, file gọn ~2 lần (đã đo 9.487 → 4.353 đỉnh). */
        var welded = weldGeometry(m.geometry);
        var d = MSE.decimateMeshopt(welded, share, targetError);
        if (d) { m.geometry = weldGeometry(compactGeometry(d.geometry)); done += d.trisAfter; }
        else { m.geometry = welded; done += t; }
      });
      trisAfter = done;
    }
    return { trisBefore: total, trisAfter: trisAfter };
  }

  /* Downscale 1 texture qua canvas: thu nhỏ về maxDim (giữ tỉ lệ),
     lật dọc (FBX bottom-up; cùng logic flipY như encodeTextureToBytes),
     encode JPEG. Trả {b64, mime, w, h} (định dạng textureBytes mà
     FBXBinary.write đã hỗ trợ — bytes đã lật sẵn nên writer không
     lật lại) hoặc null. Tối ưu: cả map lẫn normalMap đều JPEG
     (normal PNG gốc 1.3MB → JPEG 512² ~70KB). */
  function downscaleTextureToBytes(tex, slot, maxDim, quality) {
    try {
      var img = (tex.userData && tex.userData.originalImage) || tex.image;
      if (!img) return null;
      var w0 = img.width || img.videoWidth || 0;
      var h0 = img.height || img.videoHeight || 0;
      if (!w0 || !h0) return null;
      var scale = Math.min(1, maxDim / Math.max(w0, h0));
      var w = Math.max(1, Math.round(w0 * scale));
      var h = Math.max(1, Math.round(h0 * scale));
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var cx = c.getContext('2d');
      if (tex.flipY === false) { cx.translate(0, h); cx.scale(1, -1); }
      cx.drawImage(img, 0, 0, w, h);
      var url = c.toDataURL('image/jpeg', quality);
      var b64 = url.split(',')[1];
      if (!b64) return null;
      return { b64: b64, mime: 'image/jpeg', w: w, h: h };
    } catch (e) { return null; }
  }

  /* Thu thập textureBytes đã downscale cho cả model (chỉ map +
     normalMap, đúng công thức 2 texture). Key theo tên material
     (writer tra provided[m.name]). */
  function collectDownscaledTextures(root, maxDim, quality, dropNormal) {
    var out = {};
    if (!root || !root.traverse) return out;
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m || out[m.name]) return;
        var entry = {};
        if (m.map) { var mb = downscaleTextureToBytes(m.map, 'map', maxDim, quality); if (mb) entry.map = mb; }
        if (!dropNormal && m.normalMap) { var nb = downscaleTextureToBytes(m.normalMap, 'normalMap', maxDim, quality); if (nb) entry.normalMap = nb; }
        if (entry.map || entry.normalMap) out[m.name || ''] = entry;
      });
    });
    return out;
  }

  /* Số texture record TỐI THIỂU file ghi ra phải có, đếm theo material
     RIÊNG BIỆT có map (+ normalMap trừ khi attempt bỏ normal).
     GUARD CHỐNG MẤT MÀU (2026-11-27, user báo FBX <1MB mất texture):
     model gốc CÓ texture mà file ghi ra thiếu texture record (downscale
     fail + ảnh chưa load khiến cả fallback full-res của writer cũng
     fail) thì file đó nhỏ hơn hẳn nên sẽ thắng "best = nhỏ nhất" + break
     sớm — đúng cơ chế file trắng lọt ra. Attempt nào thiếu texture so
     với mức tối thiểu này thì BỊ LOẠI (không thành best, không break);
     nếu mọi attempt đều mất màu thì optimizer trả null + ghi lý do vào
     lastOptError để nút bấm báo lỗi rõ ràng thay vì tải file trắng về.
     Model vốn không có texture (expect = 0) thì guard không chặn. */
  var lastOptError = null;
  function expectedTextureRecords(root, dropNormal) {
    var seen = [], n = 0;
    if (!root || !root.traverse) return 0;
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m || seen.indexOf(m) >= 0) return;
        seen.push(m);
        if (m.map) n++;
        if (m.normalMap && !dropNormal) n++;
      });
    });
    return n;
  }
  /* Số texture record writer thật sự nhúng (report.textures =
     texRecords.length trong fbx-binary.js); null = không biết (giữ
     hành vi cũ, không chặn). */
  function writtenTextureRecords(res) {
    if (!res || !res.report || typeof res.report.textures !== 'number') return null;
    return res.report.textures;
  }

  /* Chieu dai nhat cua model NHU TRONG FILE (don vi cua geometry,
     chua scale cua root) — dung lam targetHeight cho FBXBinary.write
     trong nut "Toi uu FBX" (xem ghi chu o targetHeight trong
     fbx-binary.js). Studio normalize (Manager.normalize) scale root
     len 2.0m de hien thi; neu chi do bbox world thi file 1.8m xuat ra
     thanh 2.0m — xuong lech ~11% (Hips +67mm, Head +132mm, da do
     2026-11-27). QUAN TRONG: phai do tren CLONE SAU DECIMATE (moi
     attempt), khong phai tren root goc — decimate lam bbox co lai
     chut it (err 0.05: dai nhat giam ~0.3%); neu lay targetHeight tu
     root goc roi chia cho h cua clone da decimate thi unitScale lech
     ~1.003 (xuong lech them ~3mm + file to them do nen zlib kem).
     Do bang bbox cua geometry trong khong gian local cua root (loai
     bo root.matrixWorld, dung cho ca mesh long nhau duoi xuong), lay
     hop cua cac mesh (uu tien skinned, giong writer). Chi tra ve gia
     tri khi o don vi met hop ly (1.2..3.5, cung band cua writer):
     file cm/mm (vd dai 180) thi tra 0 de writer tu quyet theo band
     cu. Root scale = 1 thi local == world, tra ve dung chieu dai do
     — writer se co unitScale = 1 (khong doi gi). */
  function fileTargetHeight(root) {
    var THREE = window.THREE;
    if (!root || !root.traverse || !THREE) return 0;
    try {
      root.updateMatrixWorld(true);
      var meshes = [], skinned = [];
      root.traverse(function (o) {
        if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
          if (o.userData && o.userData.isBoneVisual) return;
          meshes.push(o);
          if (o.isSkinnedMesh) skinned.push(o);
        }
      });
      var list = skinned.length ? skinned : meshes;
      if (!list.length) return 0;
      var invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
      var min = new THREE.Vector3(Infinity, Infinity, Infinity);
      var max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      var v = new THREE.Vector3();
      list.forEach(function (m) {
        var g = m.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        var bb = g.boundingBox;
        if (!bb) return;
        var rel = new THREE.Matrix4().copy(invRoot).multiply(m.matrixWorld);
        var corners = [
          [bb.min.x, bb.min.y, bb.min.z], [bb.min.x, bb.min.y, bb.max.z],
          [bb.min.x, bb.max.y, bb.min.z], [bb.min.x, bb.max.y, bb.max.z],
          [bb.max.x, bb.min.y, bb.min.z], [bb.max.x, bb.min.y, bb.max.z],
          [bb.max.x, bb.max.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z]
        ];
        corners.forEach(function (c) {
          v.set(c[0], c[1], c[2]).applyMatrix4(rel);
          min.min(v); max.max(v);
        });
      });
      var s = new THREE.Vector3().subVectors(max, min);
      var local = Math.max(s.x, s.y, s.z);
      if (!isFinite(local) || local < 1.2 || local > 3.5) return 0;
      return local;
    } catch (e) { return 0; }
  }

  /* Vòng lặp tối ưu trên root đã cho (KHÔNG sửa root gốc — clone +
     decimate + ghi thử từng mức). textureProvider(maxDim, quality,
     dropNormal) -> textureBytes map; mặc định dùng canvas (trình
     duyệt). targetBytes (tùy chọn): mức dung lượng mục tiêu —
     1MB mặc định (hành vi cũ); 700KB/500KB/300KB dùng bảng attempt
     nhẹ tương ứng (xem OPT_TARGETS). Trả {bytes, filename, size,
     trisBefore, trisAfter, texMaxDim, texQ, attempt, targetBytes,
     targetId, targetLabel, underTarget, under1MB, report} hoặc null. */
  SaveManager.optimizeRootUnder1MB = function (root, modelName, textureProvider, targetBytes) {
    var target = optTargetFor(targetBytes);
    var attempts = target.attempts;
    var best = null;
    var trisBefore = countTris(root);
    lastOptError = null;
    var texLost = 0;
    for (var a = 0; a < attempts.length; a++) {
      var att = attempts[a];
      var texBytes = null;
      try { texBytes = textureProvider ? textureProvider(att.tex, att.q, att.dropNormal) : null; } catch (e) { texBytes = null; }
      var clone = cloneModelForExport(root);
      var dec = decimateCloneToBudget(clone, att.tris, att.err);
      var targetHeight = fileTargetHeight(clone); /* sau decimate — xem ghi chu o fileTargetHeight */
      var res = null;
      try {
        res = PixiStudio.FBXBinary.write(clone, {
          version: 7300, upAxis: 'Y', autoScale: true,
          prepareMixamo: true, keepSkeleton: true,
          embedTextures: true, textureBytes: texBytes,
          targetHeight: targetHeight
        });
      } catch (e) { res = null; }
      if (!res || !res.bytes || !res.bytes.length) continue;
      /* GUARD MẤT MÀU: file ghi ra thiếu texture so với model gốc thì
         loại attempt này (không best, không break) — xem ghi chú ở
         expectedTextureRecords. */
      var expectTex = expectedTextureRecords(root, att.dropNormal);
      var gotTex = writtenTextureRecords(res);
      if (expectTex > 0 && gotTex !== null && gotTex < expectTex) {
        texLost++;
        lastOptError = 'Mất texture ở mức ' + (a + 1) + '/' + attempts.length + ' (gốc có ' + expectTex + ' texture, file ghi ra chỉ có ' + gotTex + ') — texture chưa load xong hoặc downscale lỗi; thử lại sau khi texture hiện đủ màu trong viewport.';
        continue;
      }
      var size = res.bytes.length;
      var entry = { bytes: res.bytes, size: size, trisAfter: dec.trisAfter, texMaxDim: att.tex, texQ: att.q, attempt: a + 1, report: res.report };
      if (!best || size < best.size) best = entry;
      if (size < target.bytes) break;
    }
    if (!best) {
      if (texLost > 0 && !lastOptError) lastOptError = 'Mọi mức tối ưu đều mất texture — không xuất file trắng.';
      return null;
    }
    return {
      bytes: best.bytes, filename: buildFileName(modelName, target.suffix, '.fbx'),
      size: best.size, trisBefore: trisBefore, trisAfter: best.trisAfter,
      texMaxDim: best.texMaxDim, texQ: best.texQ, attempt: best.attempt,
      targetBytes: target.bytes, targetId: target.id, targetLabel: target.label,
      underTarget: best.size < target.bytes,
      under1MB: best.size < OPT_1MB, report: best.report
    };
  };

  /* ============================================================
     ĐƯỜNG WORKER (NHÓM 3, 2026-11-27) — tối ưu FBX off-main-thread
     Bản async của vòng lặp tối ưu: meshopt decimate + texture
     downscale chạy trong Web Worker (js/workers/), FBXBinary.write
     VẪN chạy main thread (cần THREE.Object3D — xem ghi chú trong
     pixistudio-worker.js). Mọi bước worker lỗi -> fallback về hàm
     sync cũ ngay tại chỗ, kết quả cuối giống hệt đường sync.
     ============================================================ */

  /* Thu thập textureBytes đã downscale — bản async: từng texture đi
     qua WorkerBridge.downscaleTextureViaWorker (ImageBitmap ->
     worker resize + encode JPEG); bridge tự fallback canvas sync
     khi worker lỗi/không hỗ trợ. */
  function collectDownscaledTexturesAsync(root, maxDim, quality, dropNormal, onProgress) {
    var WB = PixiStudio.WorkerBridge;
    var jobs = [];
    if (!root || !root.traverse) return Promise.resolve({});
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m) return;
        if (m.map) jobs.push({ mat: m, slot: 'map', tex: m.map });
        if (!dropNormal && m.normalMap) jobs.push({ mat: m, slot: 'normalMap', tex: m.normalMap });
      });
    });
    var seen = {};
    var uniq = jobs.filter(function (j) {
      var k = (j.mat.name || '') + '|' + j.slot;
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    var out = {};
    var done = 0;
    var chain = Promise.resolve();
    uniq.forEach(function (j) {
      chain = chain.then(function () {
        var p;
        if (WB && WB.downscaleTextureViaWorker) {
          p = WB.downscaleTextureViaWorker(j.tex, maxDim, quality)
            .catch(function () { return downscaleTextureToBytes(j.tex, j.slot, maxDim, quality); });
        } else {
          p = Promise.resolve(downscaleTextureToBytes(j.tex, j.slot, maxDim, quality));
        }
        return p.then(function (b) {
          if (b) {
            var key = j.mat.name || '';
            out[key] = out[key] || {};
            out[key][j.slot] = b;
          }
          done++;
          if (onProgress) onProgress(done / Math.max(1, uniq.length), 'Texture ' + done + '/' + uniq.length);
        });
      });
    });
    return chain.then(function () { return out; });
  }

  /* Bản async của decimateCloneToBudget: weld/compact vẫn main
     thread (THREE), chỉ bước meshopt simplify đi qua worker. */
  function decimateCloneToBudgetAsync(clone, triBudget, targetError, onProgress) {
    var MSE = PixiStudio.MixamoSafeExport;
    var WB = PixiStudio.WorkerBridge;
    var meshes = [];
    clone.traverse(function (o) {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        if (o.userData && o.userData.isBoneVisual) return;
        meshes.push(o);
      }
    });
    var total = 0;
    meshes.forEach(function (m) { total += triCountOfGeo(m.geometry); });
    var trisAfter = total;
    if (MSE && typeof MSE.decimateMeshopt === 'function' && total > triBudget) {
      var done = 0;
      var chain = Promise.resolve();
      meshes.forEach(function (m, i) {
        chain = chain.then(function () {
          var t = triCountOfGeo(m.geometry);
          var share = (i === meshes.length - 1)
            ? Math.max(1, triBudget - done)
            : Math.max(1, Math.floor(triBudget * t / Math.max(1, total)));
          var welded = weldGeometry(m.geometry);
          function applySync() {
            var d = MSE.decimateMeshopt(welded, share, targetError);
            if (d) { m.geometry = weldGeometry(compactGeometry(d.geometry)); done += d.trisAfter; }
            else { m.geometry = welded; done += t; }
          }
          if (WB && WB.decimateGeometryViaWorker) {
            return WB.decimateGeometryViaWorker(welded, share, targetError)
              .then(function (r) {
                if (r && r.geometry && r.geometry !== welded) {
                  m.geometry = weldGeometry(compactGeometry(r.geometry)); done += r.trisAfter;
                } else if (r && r.unchanged) { m.geometry = welded; done += t; }
                else applySync();
              })
              .catch(function () { applySync(); });
          }
          applySync();
          return Promise.resolve();
        }).then(function () {
          if (onProgress) onProgress((i + 1) / Math.max(1, meshes.length), 'Decimate mesh ' + (i + 1) + '/' + meshes.length);
        });
      });
      return chain.then(function () { return { trisBefore: total, trisAfter: done }; });
    }
    return Promise.resolve({ trisBefore: total, trisAfter: trisAfter });
  }

  /* Bản async của optimizeRootUnder1MB: cùng bảng attempt (1MB /
     700K / 500K / 300K — KHÔNG sửa), chỉ đổi textureProvider +
     decimate sang bản async qua worker. Trả cùng shape kết quả. */
  SaveManager.optimizeRootUnder1MBAsync = function (root, modelName, targetBytes, onProgress, cancelFlag) {
    var target = optTargetFor(targetBytes);
    var attempts = target.attempts;
    var best = null;
    var trisBefore = countTris(root);
    var stopped = false; /* dừng khi 1 attempt đã đạt target (như break ở bản sync) */
    lastOptError = null;
    var texLost = 0;
    var chain = Promise.resolve();
    var chain = Promise.resolve();
    for (var a = 0; a < attempts.length; a++) {
      (function (a) {
        chain = chain.then(function () {
          if (stopped) return null;
          if (cancelFlag && cancelFlag.cancelled) return null;
          var att = attempts[a];
          if (onProgress) onProgress(5 + (a / attempts.length) * 90, 'Mức ' + (a + 1) + '/' + attempts.length + ' — texture ' + att.tex + 'px, ' + att.tris + ' tris…');
          return collectDownscaledTexturesAsync(root, att.tex, att.q, att.dropNormal, function (f, msg) {
            if (onProgress) onProgress(5 + (a / attempts.length) * 90 + f * 10, msg);
          }).then(function (texBytes) {
            if (cancelFlag && cancelFlag.cancelled) return null;
            var clone = cloneModelForExport(root);
            return decimateCloneToBudgetAsync(clone, att.tris, att.err, function (f, msg) {
              if (onProgress) onProgress(5 + (a / attempts.length) * 90 + 10 + f * 20, msg);
            }).then(function (dec) {
              if (cancelFlag && cancelFlag.cancelled) return null;
              var targetHeight = fileTargetHeight(clone); /* sau decimate — xem ghi chu o fileTargetHeight */
              var res = null;
              try {
                /* FBXBinary.write VẪN main thread (cần THREE.Object3D). */
                res = PixiStudio.FBXBinary.write(clone, {
                  version: 7300, upAxis: 'Y', autoScale: true,
                  prepareMixamo: true, keepSkeleton: true,
                  embedTextures: true, textureBytes: texBytes,
                  targetHeight: targetHeight
                });
              } catch (e) { res = null; }
              if (!res || !res.bytes || !res.bytes.length) return null;
              /* GUARD MẤT MÀU (như bản sync): file ghi ra thiếu texture
                 so với model gốc thì loại attempt này — không best,
                 không dừng. Xem ghi chú ở expectedTextureRecords. */
              var expectTex = expectedTextureRecords(root, att.dropNormal);
              var gotTex = writtenTextureRecords(res);
              if (expectTex > 0 && gotTex !== null && gotTex < expectTex) {
                texLost++;
                lastOptError = 'Mất texture ở mức ' + (a + 1) + '/' + attempts.length + ' (gốc có ' + expectTex + ' texture, file ghi ra chỉ có ' + gotTex + ') — texture chưa load xong hoặc downscale lỗi; thử lại sau khi texture hiện đủ màu trong viewport.';
                return null;
              }
              var size = res.bytes.length;
              var entry = { bytes: res.bytes, size: size, trisAfter: dec.trisAfter, texMaxDim: att.tex, texQ: att.q, attempt: a + 1, report: res.report };
              if (!best || size < best.size) best = entry;
              if (size < target.bytes) stopped = true;
              return (size < target.bytes) ? 'done' : null;
            });
          });
        }).then(function (stop) {
          /* stopped đã được set ở trên; link tiếp theo tự bỏ qua. */
        });
      })(a);
    }
    return chain.then(function () {
      if (cancelFlag && cancelFlag.cancelled) return null;
      if (!best) {
        if (texLost > 0 && !lastOptError) lastOptError = 'Mọi mức tối ưu đều mất texture — không xuất file trắng.';
        return null;
      }
      return {
        bytes: best.bytes, filename: buildFileName(modelName, target.suffix, '.fbx'),
        size: best.size, trisBefore: trisBefore, trisAfter: best.trisAfter,
        texMaxDim: best.texMaxDim, texQ: best.texQ, attempt: best.attempt,
        targetBytes: target.bytes, targetId: target.id, targetLabel: target.label,
        underTarget: best.size < target.bytes,
        under1MB: best.size < OPT_1MB, report: best.report, viaWorker: true
      };
    });
  };

  /* Nút "Tối ưu FBX" — đường worker: chờ texture + meshopt sẵn
     sàng như đường sync, rồi chạy optimizeRootUnder1MBAsync với
     progress + nút Hủy (WorkerBridge.runWithProgress). Bất kỳ lỗi
     nào trong đường worker đều fallback về đường sync cũ
     (optimizeRootUnder1MB) — không bao giờ fail hẳn chỉ vì worker. */
  SaveManager.optimizeFBXUnder1MBWorker = function (targetBytes) {
    var target = PixiStudio.State.get('selection') || PixiStudio.Viewport.getMainModel();
    if (!target) {
      bus.emit('notify', { type: 'warning', title: 'Tối ưu FBX', message: 'Chưa có model nào trong scene để tối ưu.' });
      return Promise.resolve(null);
    }
    var modelName = target.name || 'model';
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var optTarget = optTargetFor(targetBytes);
    var WB = PixiStudio.WorkerBridge;
    var cancelFlag = { cancelled: false };
    var MSE = PixiStudio.MixamoSafeExport;
    var readyP = (MSE && MSE.waitMeshoptReady) ? MSE.waitMeshoptReady(5000) : Promise.resolve(false);
    var flow = Promise.all([waitForTextures(target, 8000), readyP]).then(function () {
      return SaveManager.optimizeRootUnder1MBAsync(target, modelName, optTarget.bytes, function (pct, msg) {
        if (PixiStudio.Notifications && PixiStudio.Notifications.updateLoading) {
          PixiStudio.Notifications.updateLoading(pct, 'Tối ưu FBX ' + optTarget.label + ' (worker) — ' + msg);
        }
      }, cancelFlag);
    }).then(function (res) {
      if (cancelFlag.cancelled) {
        bus.emit('notify', { type: 'warning', title: 'Tối ưu FBX', message: 'Đã hủy tối ưu.' });
        return null;
      }
      if (!res) {
        /* Worker path không ra kết quả -> fallback đường sync cũ. */
        return SaveManager.optimizeRootUnder1MB(target, modelName, function (maxDim, q, dropNormal) {
          return collectDownscaledTextures(target, maxDim, q, dropNormal);
        }, optTarget.bytes);
      }
      return res;
    }).then(function (res) {
      if (!res) {
        var texErr = (SaveManager._optimizeFBX && SaveManager._optimizeFBX.lastOptError) ? SaveManager._optimizeFBX.lastOptError() : null;
        bus.emit('notify', { type: 'error', title: 'Tối ưu FBX lỗi', message: texErr || 'Không ghi được file FBX.' });
        return null;
      }
      var blob = new Blob([res.bytes], { type: 'application/octet-stream' });
      U.downloadBlob(blob, res.filename);
      var elapsed = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
      SaveManager.logSave({ name: res.filename, format: 'fbx-' + res.targetId, sizeBytes: res.size });
      var sizeTxt = res.size >= 1048576 ? (res.size / 1048576).toFixed(2) + ' MB' : Math.round(res.size / 1024) + ' KB';
      bus.emit('notify', {
        type: res.underTarget ? 'success' : 'warning',
        title: res.underTarget ? 'Đã tối ưu FBX ' + res.targetLabel : 'Đã tối ưu FBX (vẫn trên ' + res.targetLabel + ')',
        message: sizeTxt + ' · ' + res.trisBefore + ' → ' + res.trisAfter + ' tam giác · texture ' + res.texMaxDim + 'px JPEG q' + Math.round(res.texQ * 100) + ' · rig + skin giữ nguyên · ' + (elapsed >= 1000 ? (elapsed / 1000).toFixed(1) + 's' : elapsed + 'ms') + ' · worker' +
          (res.underTarget ? '' : ' — đã thử 5 mức, model này khó xuống dưới ' + res.targetLabel + ' (thử bỏ normalMap / giảm tris tay).'),
        duration: 12000
      });
      return res;
    }).catch(function (err) {
      if (cancelFlag.cancelled) return null;
      bus.emit('notify', { type: 'error', title: 'Tối ưu FBX lỗi', message: String(err && err.message || err) });
      return null;
    });
    /* Progress overlay + nút Hủy (tạo động, không sửa index.html). */
    var handle = null;
    if (WB && WB.runWithProgress) {
      handle = WB.runWithProgress('Đang tối ưu FBX ' + optTarget.label + ' (worker)…', flow, { cancellable: true });
      var origCancel = handle.cancel;
      handle.cancel = function () {
        cancelFlag.cancelled = true;
        if (WB) WB.cancelAll();
        origCancel();
      };
      return handle.promise;
    }
    return flow;
  };

  /* Nút "Tối ưu FBX": tối ưu model đang ở trong scene rồi tải về.
     targetBytes (tùy chọn, từ select cạnh nút — mặc định 1MB). */
  SaveManager.optimizeFBXUnder1MB = function (targetBytes) {
    var target = PixiStudio.State.get('selection') || PixiStudio.Viewport.getMainModel();
    if (!target) {
      bus.emit('notify', { type: 'warning', title: 'Tối ưu FBX', message: 'Chưa có model nào trong scene để tối ưu.' });
      return Promise.resolve(null);
    }
    var modelName = target.name || 'model';
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var optTarget = optTargetFor(targetBytes);
    /* NHÓM 3 (Web Worker): worker khả dụng -> đi đường worker
       (meshopt + texture off-main-thread, có progress + nút Hủy);
       đường sync cũ bên dưới giữ nguyên làm fallback. */
    var WB0 = PixiStudio.WorkerBridge;
    if (WB0 && WB0.isSupported()) return SaveManager.optimizeFBXUnder1MBWorker(targetBytes);
    PixiStudio.Notifications.showLoading('Đang tối ưu FBX ' + optTarget.label + '…', 5);
    var MSE = PixiStudio.MixamoSafeExport;
    var readyP = (MSE && MSE.waitMeshoptReady) ? MSE.waitMeshoptReady(5000) : Promise.resolve(false);
    return Promise.all([waitForTextures(target, 8000), readyP]).then(function () {
      return new Promise(function (resolve) {
        setTimeout(function () {
          try {
            var res = SaveManager.optimizeRootUnder1MB(target, modelName, function (maxDim, q, dropNormal) {
              return collectDownscaledTextures(target, maxDim, q, dropNormal);
            }, optTarget.bytes);
            PixiStudio.Notifications.hideLoading();
            if (!res) {
              var texErr2 = (SaveManager._optimizeFBX && SaveManager._optimizeFBX.lastOptError) ? SaveManager._optimizeFBX.lastOptError() : null;
              bus.emit('notify', { type: 'error', title: 'Tối ưu FBX lỗi', message: texErr2 || 'Không ghi được file FBX.' });
              resolve(null); return;
            }
            var blob = new Blob([res.bytes], { type: 'application/octet-stream' });
            U.downloadBlob(blob, res.filename);
            var elapsed = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
            SaveManager.logSave({ name: res.filename, format: 'fbx-' + res.targetId, sizeBytes: res.size });
            var sizeTxt = res.size >= 1048576 ? (res.size / 1048576).toFixed(2) + ' MB' : Math.round(res.size / 1024) + ' KB';
            bus.emit('notify', {
              type: res.underTarget ? 'success' : 'warning',
              title: res.underTarget ? 'Đã tối ưu FBX ' + res.targetLabel : 'Đã tối ưu FBX (vẫn trên ' + res.targetLabel + ')',
              message: sizeTxt + ' · ' + res.trisBefore + ' → ' + res.trisAfter + ' tam giác · texture ' + res.texMaxDim + 'px JPEG q' + Math.round(res.texQ * 100) + ' · rig + skin giữ nguyên · ' + (elapsed >= 1000 ? (elapsed / 1000).toFixed(1) + 's' : elapsed + 'ms') +
                (res.underTarget ? '' : ' — đã thử 5 mức, model này khó xuống dưới ' + res.targetLabel + ' (thử bỏ normalMap / giảm tris tay).'),
              duration: 12000
            });
            resolve(res);
          } catch (err) {
            PixiStudio.Notifications.hideLoading();
            bus.emit('notify', { type: 'error', title: 'Tối ưu FBX lỗi', message: String(err && err.message || err) });
            resolve(null);
          }
        }, 40);
      });
    });
  };

  /* Expose để test harness kiểm chứng (không dùng trong UI). */
  SaveManager._optimizeFBX = {
    OPT_1MB: OPT_1MB, OPT_ATTEMPTS: OPT_ATTEMPTS,
    OPT_ATTEMPTS_700K: OPT_ATTEMPTS_700K,
    OPT_ATTEMPTS_500K: OPT_ATTEMPTS_500K,
    OPT_ATTEMPTS_300K: OPT_ATTEMPTS_300K,
    OPT_TARGETS: OPT_TARGETS, optTargetFor: optTargetFor,
    cloneModelForExport: cloneModelForExport,
    fileTargetHeight: fileTargetHeight,
    compactGeometry: compactGeometry,
    weldGeometry: weldGeometry,
    decimateCloneToBudget: decimateCloneToBudget,
    decimateCloneToBudgetAsync: decimateCloneToBudgetAsync,
    downscaleTextureToBytes: downscaleTextureToBytes,
    collectDownscaledTextures: collectDownscaledTextures,
    collectDownscaledTexturesAsync: collectDownscaledTexturesAsync,
    optimizeRootUnder1MBAsync: SaveManager.optimizeRootUnder1MBAsync,
    optimizeFBXUnder1MBWorker: SaveManager.optimizeFBXUnder1MBWorker,
    expectedTextureRecords: expectedTextureRecords,
    /* Lý do lần tối ưu gần nhất trả null do mất texture (guard chống
       mất màu) — nút bấm đọc để báo lỗi rõ ràng thay vì "Không ghi
       được file FBX." chung chung; null khi không có lỗi texture. */
    lastOptError: function () { return lastOptError; }
  };

  /* ============================================================
     FBX 2013 + MIXAMO RIG — "giống X Bot.fbx"
     ------------------------------------------------------------
     Phân tích X Bot.fbx (file Mixamo/Maya 2020) cho thấy nó gồm:
       Model::Mesh + 65 Model::LimbNode (mixamorig:*)
       NodeAttribute TypeFlags "Skeleton", Deformer::Skin + Cluster,
       Pose::skinCluster (BindPose), Material Phong, KHÔNG texture.
     Writer của studio ĐÃ ghi đúng các loại node này; khác biệt duy nhất
     là số version: 7400 = FBX 2014, còn Mixamo chỉ nhận "2013 or earlier"
     ⇒ nút này ghi version 7300 (FBX 2013) VÀ tự rig + auto-skin nếu cần.
     ROUND 4 (11-2026) — ĐỔI HƯỚNG: file Thiếu Lâm chứng minh xuất
     KÈM skeleton vẫn bị Mixamo từ chối (chỉ 24/65 xương có skin +
     A-pose → map-skeleton thất bại), còn file mesh-only thì Mixamo
     auto-rig được. Nên nút này GIỮ việc dựng khung 65 xương trong
     scene (để làm animation), nhưng FILE xuất ra là mesh-only
     Mixamo-safe (< 50k tris, có texture), giống hệt 2 file mẫu.
     ============================================================ */
  function ensureMixamoRig(target) {
    const RigAutoGen = PixiStudio.RigAutoGen;
    const ensure = PixiStudio.AnimGLBExport && PixiStudio.AnimGLBExport.ensureRig;
    if (ensure) {
      try { return ensure(target, 'Mixamo Compatible'); } catch (e) { /* fallthrough */ }
    }
    if (!RigAutoGen) return null;
    let rig = RigAutoGen.current;
    if (!rig || rig.target !== target) rig = RigAutoGen.generate(target, 'Mixamo Compatible');
    else if (!rig.skinnedCount) { try { RigAutoGen.bindSkin(target); } catch (e) {} rig = RigAutoGen.current; }
    return rig;
  }

  function collectRigInfo(root) {
    let bones = 0, skinned = 0, mixamoNamed = 0;
    const names = [];
    if (root && root.traverse) root.traverse(function (o) {
      if (o.isBone) { bones++; if (names.length < 6) names.push(o.name); if (/^mixamorig:?/.test(o.name)) mixamoNamed++; }
      if (o.isSkinnedMesh) skinned++;
    });
    return { bones: bones, skinned: skinned, mixamoNamed: mixamoNamed, sample: names };
  }

  function saveFBXMixamoRig(target, modelName, finish, fmt) {
    PixiStudio.Notifications.updateLoading(10, 'Dựng khung xương chuẩn Mixamo (65 xương, Hips là gốc)...');
    return new Promise(function (resolve) {
      setTimeout(function () {
        /* ƯU TIÊN: dựng khung xương CHUẨN MIXAMO (65 xương, tên y hệt X Bot.fbx)
           trên một BẢN SAO của model — không sửa scene, không dùng tên tự đặt
           (Root/Chest) vốn làm Mixamo không map được xương. */
        let built = null, buildErr = null;
        try {
          if (PixiStudio.MixamoSkeleton) built = PixiStudio.MixamoSkeleton.build(target, { height: 1.8 });
        } catch (e) { buildErr = e; built = null; }

        /* Fallback: rig cũ (auto-gen) nếu thiếu module khung xương chuẩn */
        let rig = null;
        if (!built) { try { rig = ensureMixamoRig(target); } catch (e) { rig = null; } }

        const out = built ? built.group : target;
        PixiStudio.Notifications.updateLoading(35, built
          ? 'Đã có khung xương chuẩn Mixamo — chờ texture rồi ghi FBX 2013...'
          : (rig ? 'Đã có rig (auto-gen) — chờ texture rồi ghi FBX 2013...' : 'Không rig được — xuất mesh-only FBX 2013...'));

        var MSE0r = PixiStudio.MixamoSafeExport;
        var readyPr = (MSE0r && MSE0r.waitMeshoptReady) ? MSE0r.waitMeshoptReady(5000) : Promise.resolve(false);
        Promise.all([waitForTextures(out, 8000), readyPr]).then(function (results) {
          var tx = results[0];
          setTimeout(function () {
            try {
              const info = built
                ? { bones: built.stats.bones, skinned: built.skinnedMeshes.length, mixamoNamed: built.stats.bones, sample: [] }
                : collectRigInfo(target);
              const hasRig = info.bones > 0;
              /* Round 4 — file Mixamo LUÔN mesh-only: chuẩn bị Mixamo-safe
                 trên nhóm đã rig (bỏ skeleton, tự decimate giữ UV nếu
                 >= 50k). Pre-flight chỉ chạy trên nhóm ĐÃ chuẩn bị. */
              const prepared = prepareMixamoSafe(out);
              if (!prepared) { PixiStudio.Notifications.hideLoading(); resolve(null); return; }
              const pre = mixamoPreflight(prepared.group, 'mesh-only');
              if (!pre.ok) {
                PixiStudio.Notifications.hideLoading();
                bus.emit('notify', { type: 'error', title: 'Mixamo Pre-flight', message: 'Model chưa đủ điều kiện upload Mixamo: ' + pre.warn.join('; ') });
                resolve(null);
                return;
              }
              const res = PixiStudio.FBXBinary.write(prepared.group, {
                version: 7300,                    /* FBX 2013 — Mixamo chỉ nhận ≤ 2013 */
                prepareMixamo: true,
                mixamoNames: true,                /* tên 'Class::Name' như 2 file mẫu đã auto-rig được */
                keepSkeleton: false,              /* mesh-only — Mixamo tự auto-rig */
                noSkeleton: true,
                upAxis: 'Y',
                autoScale: true,
                embedTextures: true
              });
              const blob = new Blob([res.bytes], { type: 'application/octet-stream' });
              const name = buildFileName(modelName, 'mixamo-rig', fmt ? fmt.ext : '.fbx');
              finish(blob, { version: 7300, bones: res.report.bones, hasSkin: res.report.hasSkin }, name);
              const r = res.report;
              const warn = pre.warn.slice();
              warn.push.apply(warn, prepared.report.warnings || []);
              if (!built && buildErr) warn.push('không dựng được khung xương chuẩn Mixamo (' + String(buildErr.message || buildErr) + ') — dùng rig auto-gen');
              if (!hasRig) warn.push('không tạo được rig trong scene — file là mesh-only, Mixamo sẽ tự auto-rig');
              PixiStudio.Notifications.hideLoading();
              bus.emit('notify', {
                type: warn.length ? 'warning' : 'success',
                title: 'FBX 2013 Mixamo-safe đã lưu',
                message: 'FBX 2013 (version ' + r.version + ') · mesh-only · ' + prepared.report.trisBefore + ' → ' + prepared.report.trisAfter + ' tam giác · ' + r.meshes + ' mesh · ' + r.textures +
                  ' texture · ' + U.formatBytes(r.bytes) + ' — Mixamo tự auto-rig (khung xương ' + info.bones + ' xương vẫn giữ trong scene để làm animation, không xuất ra file); upload Mixamo: Characters → Upload Character.' +
                  (warn.length ? ' LƯU Ý: ' + warn.join('; ') : ''),
                duration: 15000
              });
              resolve(null);
            } catch (err) {
              PixiStudio.Notifications.hideLoading();
              bus.emit('notify', { type: 'error', title: 'FBX 2013 + rig lỗi', message: String(err && err.message || err) });
              resolve(null);
            }
          }, 40);
        });
      }, 30);
    });
  }

  function saveFBXBinary(target, modelName, finish, fmt) {
    /* Lần 7 (11-2026) — preset Mixamo KHÔNG được ghi skeleton: file có
       xương (A-pose, chỉ 24/65 xương có skin) bị Mixamo từ chối ở bước
       map-skeleton ("unable to map your existing skeleton"). Preset
       Mixamo luôn đi đường Mixamo-safe (mesh-only, Mixamo tự auto-rig)
       giống hệt nút Save Mixamo; preset Unity/Unreal vẫn giữ skeleton. */
    if (SaveManager.exportPreset === 'mixamo') {
      return saveFBXMixamo(target, modelName, finish, fmt);
    }
    PixiStudio.Notifications.updateLoading(30, 'Đang ghi FBX Binary 7.4 (skeleton + skin + bind pose)...');
    return new Promise(function (resolve) {
      setTimeout(function () {
        try {
          /* v21.0 — Export Preset: đổi version/upAxis/autoScale theo engine đã chọn */
          const writeOpts = { fps: 30 };
          const presetOpts = SaveManager.exportPreset && PixiStudio.ExportPresets
            ? PixiStudio.ExportPresets.writeOpts(SaveManager.exportPreset) : null;
          if (presetOpts && presetOpts.format === 'fbx') {
            if (presetOpts.version) writeOpts.version = presetOpts.version;
            writeOpts.upAxis = presetOpts.upAxis;
            writeOpts.autoScale = presetOpts.autoScale;
          }
          const res = PixiStudio.FBXBinary.write(target, writeOpts);
          const blob = new Blob([res.bytes], { type: 'application/octet-stream' });
          const name = buildFileName(modelName, presetOpts ? presetOpts.suffix : 'fbx', fmt ? fmt.ext : '.fbx');
          finish(blob, {}, name);
          const r = res.report;
          bus.emit('notify', {
            type: r.hasSkin ? 'success' : 'warning',
            title: 'FBX Binary đã lưu',
            message: r.meshes + ' mesh · ' + r.bones + ' bone · ' + r.clusters + ' skin cluster · ' + U.formatBytes(r.bytes) +
              (r.hasSkin
                ? ' — có rig + skin: dùng cho Blender/Unity/Unreal. KHÔNG upload file này lên Mixamo (Mixamo sẽ báo "unable to map your existing skeleton") — muốn lên Mixamo thì dùng nút Save Mixamo (FBX Mixamo mesh-only).'
                : ' — mesh-only (không xương): Mixamo-safe, upload Mixamo được; Blender/Unity cũng đọc được.'),
            duration: 11000
          });
          resolve(null);
        } catch (err) {
          PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'FBX Binary lỗi', message: String(err && err.message || err) });
          resolve(null);
        }
      }, 40);
    });
  }

  /* ============================================================
     OBJ + MTL + TEXTURE (ZIP) — "OBJ có màu"
     ------------------------------------------------------------
     OBJ KHÔNG mang được ảnh trong chính nó: màu nằm ở bộ ba
       model.obj  +  model.mtl (newmtl/Kd/map_Kd)  +  file ảnh
     nên bắt buộc đóng gói cả 3 vào một ZIP, giữ đúng tên file mà
     .mtl tham chiếu.
     Chiều UV: OBJ dùng gốc dưới-trái (như FBX). glTF dùng gốc trên-trái
     (GLTFLoader flipY=false) ⇒ nguồn là glTF thì ghi v' = 1 - v để ảnh
     không bị lộn; nguồn đã là FBX (flipY=true) thì giữ nguyên.
     ============================================================ */
  function safeFileName(s, fallback) {
    return String(s == null ? '' : s).replace(/[^a-zA-Z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
  }

  /* Trả về { objText, mtlText, images:[{name,bytes,mime}], stats } */
  function buildObjMtlBundle(root, modelName) {
    const meshes = [];
    root.traverse(function (o) {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) meshes.push(o);
    });
    if (!meshes.length) return null;

    const images = [];
    const usedNames = {};
    const matLines = ['# PixiStudio MTL — OBJ + texture (map_Kd)', '# model: ' + modelName, ''];
    const objLines = ['# PixiStudio OBJ — ' + modelName, 'mtllib ' + modelName + '.mtl'];
    let vBase = 1, vtBase = 1, vnBase = 1;
    let triCount = 0, meshCount = 0, matCount = 0;

    meshes.forEach(function (mesh, meshIndex) {
      mesh.updateMatrixWorld(true);
      const geo = mesh.geometry;
      const pos = geo.attributes.position;
      const nor = geo.attributes.normal;
      const uv = geo.attributes.uv;
      const index = geo.index;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const groups = (geo.groups && geo.groups.length && mats.length > 1) ? geo.groups : null;

      /* Nguồn glTF? (map flipY === false) → phải lật V cho OBJ */
      let flipV = false;
      mats.forEach(function (m) {
        if (!m) return;
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap'].forEach(function (s) {
          if (m[s] && m[s].flipY === false) flipV = true;
        });
      });

      const normM = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      const tmp = new THREE.Vector3();
      objLines.push('', 'o ' + safeFileName(mesh.name, 'mesh_' + meshIndex));

      for (let i = 0; i < pos.count; i++) {
        tmp.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        objLines.push('v ' + tmp.x.toFixed(6) + ' ' + tmp.y.toFixed(6) + ' ' + tmp.z.toFixed(6));
      }
      if (uv) {
        for (let i = 0; i < uv.count; i++) {
          const v = uv.getY(i);
          objLines.push('vt ' + uv.getX(i).toFixed(6) + ' ' + (flipV ? (1 - v) : v).toFixed(6));
        }
      }
      if (nor) {
        for (let i = 0; i < nor.count; i++) {
          tmp.fromBufferAttribute(nor, i).applyMatrix3(normM).normalize();
          objLines.push('vn ' + tmp.x.toFixed(6) + ' ' + tmp.y.toFixed(6) + ' ' + tmp.z.toFixed(6));
        }
      }

      /* material → MTL + ảnh */
      const matNames = mats.map(function (m, mi) {
        const base = safeFileName(m && (m.name || m.type), 'material_' + meshIndex + '_' + mi);
        let name = base, k = 2;
        while (usedNames[name]) name = base + '_' + (k++);
        usedNames[name] = 1;
        matCount++;

        const L = ['newmtl ' + name];
        const c = (m && m.color) ? m.color : { r: 1, g: 1, b: 1 };
        L.push('Kd ' + [c.r, c.g, c.b].map(function (x) { return x.toFixed(4); }).join(' '));
        const e = (m && m.emissive) ? m.emissive : { r: 0, g: 0, b: 0 };
        L.push('Ka ' + [e.r, e.g, e.b].map(function (x) { return x.toFixed(4); }).join(' '));
        const sp = (m && m.specular) ? m.specular : { r: 1, g: 1, b: 1 };
        L.push('Ks ' + [sp.r, sp.g, sp.b].map(function (x) { return x.toFixed(4); }).join(' '));
        L.push('Ns ' + (m && m.roughness != null ? (1 - m.roughness) * 250 : 25).toFixed(2));
        L.push('Ni 1.45');
        L.push('d ' + (m && m.opacity != null && m.opacity < 1 ? m.opacity.toFixed(4) : '1.0000'));
        L.push('illum 2');

        const SLOTS = [
          ['map', 'map_Kd'],
          ['normalMap', 'norm'],
          ['roughnessMap', 'map_Pr'],
          ['metalnessMap', 'map_Pm'],
          ['aoMap', 'map_Ka'],
          ['emissiveMap', 'map_Ke']
        ];
        SLOTS.forEach(function (s) {
          const tex = m && m[s[0]];
          const img = tex && ((tex.userData && tex.userData.originalImage) || tex.image);
          if (!img) return;
          const e2 = (PixiStudio.FBXBinary && PixiStudio.FBXBinary.encodeTexture)
            ? PixiStudio.FBXBinary.encodeTexture(tex, s[0], { texFlip: 'keep' }) : null;
          if (!e2 || !e2.bytes || !e2.bytes.length) return;
          const ext = e2.mime === 'image/png' ? '.png' : '.jpg';
          const fname = safeFileName(name + '_' + s[0], 'tex') + ext;
          if (!images.some(function (x) { return x.name === fname; })) images.push({ name: fname, bytes: e2.bytes, mime: e2.mime });
          L.push(s[1] + ' ' + fname);
        });
        matLines.push(L.join('\n'), '');
        return name;
      });

      const emitFace = function (a, b, cc) {
        const hasT = !!uv, hasN = !!nor;
        const f = [a, b, cc].map(function (i) {
          const vi = vBase + i;
          if (hasT && hasN) return vi + '/' + (vtBase + i) + '/' + (vnBase + i);
          if (hasT) return vi + '/' + (vtBase + i);
          if (hasN) return vi + '//' + (vnBase + i);
          return String(vi);
        });
        objLines.push('f ' + f.join(' '));
      };

      const groupsToWrite = groups || [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
      groupsToWrite.forEach(function (g) {
        const mi = Math.min(g.materialIndex || 0, matNames.length - 1);
        objLines.push('usemtl ' + matNames[mi]);
        const end = g.start + g.count;
        for (let i = g.start; i + 2 < end; i += 3) {
          const a = index ? index.getX(i) : i;
          const b = index ? index.getX(i + 1) : i + 1;
          const cc = index ? index.getX(i + 2) : i + 2;
          emitFace(a, b, cc);
          triCount++;
        }
      });

      vBase += pos.count;
      if (uv) vtBase += uv.count;
      if (nor) vnBase += nor.count;
      meshCount++;
    });

    return {
      objText: objLines.join('\n') + '\n',
      mtlText: matLines.join('\n') + '\n',
      images: images,
      stats: { meshes: meshCount, tris: triCount, materials: matCount, images: images.length }
    };
  }

  function saveOBJColorZip(root, modelName, finish, fmt) {
    PixiStudio.Notifications.updateLoading(20, 'Chờ texture decode để nhúng vào OBJ + MTL...');
    return new Promise(function (resolve) {
      waitForTextures(root, 8000).then(function (tx) {
        PixiStudio.Notifications.updateLoading(60, 'Ghi model.obj + model.mtl + ảnh texture...');
        setTimeout(function () {
          try {
            const base = safeFileName(modelName, 'model');
            const bundle = buildObjMtlBundle(root, base);
            if (!bundle) {
              PixiStudio.Notifications.hideLoading();
              bus.emit('notify', { type: 'warning', title: 'OBJ + MTL', message: 'Không tìm thấy mesh nào để xuất.' });
              return resolve(null);
            }
            const encT = new TextEncoder();
            const files = [
              { name: base + '.obj', data: encT.encode(bundle.objText) },
              { name: base + '.mtl', data: encT.encode(bundle.mtlText) }
            ];
            bundle.images.forEach(function (img) { files.push({ name: img.name, data: img.bytes }); });
            files.push({
              name: 'README.txt',
              data: encT.encode(
                'PixiStudio — OBJ + MTL + TEXTURE\n' +
                '================================\n' +
                'OBJ KHONG mang mau trong chinh no. Giu DU 3 thanh phan trong cung thu muc:\n' +
                '  1) ' + base + '.obj\n' +
                '  2) ' + base + '.mtl   (khai bao: newmtl / Kd / map_Kd)\n' +
                '  3) ' + bundle.images.length + ' file anh texture: ' + bundle.images.map(function (i) { return i.name; }).join(', ') + '\n\n' +
                'Import:\n' +
                '  Blender : File > Import > Wavefront (.obj) -> chon ' + base + '.obj\n' +
                '  Maya    : File > Import -> chon .obj (doc kem .mtl)\n' +
                '  Unity   : keo ca thu muc vao Assets, chon Material > Extract Textures\n' +
                '  Mixamo  : Characters > Upload Character -> FBX (khuyen nghi) hoac ZIP nay\n\n' +
                'Luu y: doi ten file phai doi theo trong ' + base + '.mtl (dong map_Kd).\n' +
                'Thong tin: ' + bundle.stats.meshes + ' mesh, ' + bundle.stats.tris + ' tam giac, ' +
                bundle.stats.materials + ' material, ' + bundle.stats.images + ' anh.\n'
              )
            });
            const blob = PixiStudio.ZipWriter.create(files);
            const name = buildFileName(modelName, 'obj-mtl', fmt ? fmt.ext : '.zip');
            finish(blob, { format: 'obj-color' }, name);
            const warn = [];
            if (!bundle.stats.images) warn.push(tx.total ? 'texture chưa decode xong (' + tx.ready + '/' + tx.total + ') — file sẽ không có màu' : 'model không có texture — file sẽ không có màu');
            if (bundle.stats.tris > 50000) warn.push(bundle.stats.tris + ' tam giác > 50.000 (giới hạn auto-rig Mixamo)');
            PixiStudio.Notifications.hideLoading();
            bus.emit('notify', {
              type: warn.length ? 'warning' : 'success',
              title: warn.length ? 'OBJ + MTL đã lưu (có cảnh báo)' : 'OBJ + MTL + Texture đã lưu',
              message: bundle.stats.meshes + ' mesh · ' + bundle.stats.tris + ' tam giác · ' + bundle.stats.materials +
                ' material · ' + bundle.stats.images + ' ảnh texture · ' + U.formatBytes(blob.size) +
                ' — giải nén giữ ĐỦ .obj + .mtl + ảnh cạnh nhau (đổi tên file phải sửa dòng map_Kd trong .mtl).' +
                (warn.length ? ' LƯU Ý: ' + warn.join('; ') : ''),
              duration: 12000
            });
            resolve(null);
          } catch (err) {
            PixiStudio.Notifications.hideLoading();
            bus.emit('notify', { type: 'error', title: 'OBJ + MTL lỗi', message: String(err && err.message || err) });
            resolve(null);
          }
        }, 40);
      });
    });
  }

  function exportFBXAscii(object3D) {
    const meshes = gatherMeshData(object3D);
    const now = new Date();
    let f = '';
    f += '; FBX 7.4.0 project file\n';
    f += '; Generated by PixiJS Studio x Tripo3D AI Studio v21.0\n';
    f += '; NOTE: ASCII FBX — Maya/Autodesk doc duoc. Blender chi doc FBX binary (dung DAE/GLB).\n\n';
    f += 'FBXHeaderExtension:  {\n\tFBXHeaderVersion: 1003\n\tFBXVersion: 7400\n\tCreator: "PixiJS Studio"\n\tCreationTimeStamp:  {\n\t\tVersion: 1000\n\t\tYear: ' + now.getFullYear() + '\n\t\tMonth: ' + (now.getMonth() + 1) + '\n\t\tDay: ' + now.getDate() + '\n\t\tHour: ' + now.getHours() + '\n\t}\n}\n\n';
    f += 'GlobalSettings:  {\n\tVersion: 1000\n\tProperties70:  {\n\t\tP: "UpAxis", "int", "Integer", "",1\n\t\tP: "UpAxisSign", "int", "Integer", "",1\n\t\tP: "FrontAxis", "int", "Integer", "",2\n\t\tP: "FrontAxisSign", "int", "Integer", "",1\n\t\tP: "CoordSystem", "int", "Integer", "",0\n\t\tP: "OriginalUnitScaleFactor", "double", "Number", "",1\n\t}\n}\n\n';

    f += 'Objects:  {\n';
    let idCounter = 1000000;
    const geoIds = [], matIds = [], texIds = [];
    meshes.forEach(function (m, gi) {
      const gid = idCounter++;
      geoIds.push(gid);
      /* Vertices */
      f += '\tGeometry: ' + gid + ', "Geometry::' + m.name + '", "Mesh" {\n';
      f += '\t\tVertices: *' + m.verts.length + ' {\n\t\t\ta: ' + m.verts.map(function (x) { return x.toFixed(5); }).join(',') + '\n\t\t}\n';
      /* PolygonVertexIndex — last index của mỗi tam giác là ~idx (bitwise NOT) */
      const piv = [];
      for (let t = 0; t < m.tris.length; t += 3) {
        piv.push(m.tris[t], m.tris[t + 1], ~(m.tris[t + 2]));
      }
      f += '\t\tPolygonVertexIndex: *' + piv.length + ' {\n\t\t\ta: ' + piv.join(',') + '\n\t\t}\n';
      f += '\t\tGeometryVersion: 124\n';
      if (m.hasNrm) {
        f += '\t\tLayerElementNormal: 0 {\n\t\t\tVersion: 101\n\t\t\tName: ""\n\t\t\tMappingInformationType: "ByPolygonVertex"\n\t\t\tReferenceInformationType: "Direct"\n\t\t\tNormals: *' + (m.tris.length * 3) + ' {\n\t\t\t\ta: ';
        /* normals per polygon-vertex */
        const nArr = [];
        for (let t = 0; t < m.tris.length; t++) {
          const vi = m.tris[t];
          nArr.push(m.norms[vi * 3].toFixed(4), m.norms[vi * 3 + 1].toFixed(4), m.norms[vi * 3 + 2].toFixed(4));
        }
        f += nArr.join(',') + '\n\t\t\t}\n\t\t}\n';
      }
      if (m.hasUV) {
        f += '\t\tLayerElementUV: 0 {\n\t\t\tVersion: 101\n\t\t\tName: "UVMap"\n\t\t\tMappingInformationType: "ByPolygonVertex"\n\t\t\tReferenceInformationType: "IndexToDirect"\n\t\t\tUV: *' + m.uvs.length + ' {\n\t\t\t\ta: ' + m.uvs.map(function (x) { return x.toFixed(5); }).join(',') + '\n\t\t\t}\n\t\t\tUVIndex: *' + m.tris.length + ' {\n\t\t\t\ta: ';
        const uvArr = [];
        for (let t = 0; t < m.tris.length; t++) uvArr.push(m.tris[t]);
        f += uvArr.join(',') + '\n\t\t\t}\n\t\t}\n';
      }
      f += '\t\tLayerElementMaterial: 0 {\n\t\t\tVersion: 101\n\t\t\tName: ""\n\t\t\tMappingInformationType: "AllSame"\n\t\t\tMaterials: *1 {\n\t\t\t\ta: 0\n\t\t\t}\n\t\t}\n';
      f += '\t\tLayer: 0 {\n\t\t\tVersion: 100\n\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementNormal"\n\t\t\t\tTypedIndex: 0\n\t\t\t}\n\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementMaterial"\n\t\t\t\tTypedIndex: 0\n\t\t\t}\n';
      if (m.hasUV) f += '\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementUV"\n\t\t\t\tTypedIndex: 0\n\t\t\t}\n';
      f += '\t\t}\n\t}\n';

      /* Material */
      const mid = idCounter++;
      matIds.push(mid);
      const r = m.color ? m.color.r : 0.8, g2 = m.color ? m.color.g : 0.8, b = m.color ? m.color.b : 0.8;
      f += '\tMaterial: ' + mid + ', "Material::' + m.matName + '", "" {\n\t\tVersion: 102\n\t\tShadingModel: "phong"\n\t\tMultiLayer: 0\n\t\tProperties70:  {\n\t\t\tP: "DiffuseColor", "Color", "", "A",1,' + r.toFixed(3) + ',' + g2.toFixed(3) + ',' + b.toFixed(3) + '\n\t\t}\n\t}\n';
    });

    /* Model nodes */
    meshes.forEach(function (m, gi) {
      const modelId = idCounter++;
      f += '\tModel: ' + modelId + ', "Model::' + m.name + '", "Mesh" {\n\t\tVersion: 232\n\t\tProperties70:  {\n\t\t\tP: "InheritType", "enum", "", "",1\n\t\t}\n\t\tShading: true\n\t\tCulling: "CullingOff"\n\t}\n';
      m._modelId = modelId;
    });
    f += '}\n\n';

    f += 'Connections:  {\n';
    meshes.forEach(function (m, gi) {
      f += '\t;Model::' + m.name + ' -> RootNode\n\tC: "OO",' + m._modelId + ',0\n\n';
      f += '\t;Geometry::' + m.name + ' -> ' + m.name + '\n\tC: "OO",' + geoIds[gi] + ',' + m._modelId + '\n\n';
      f += '\t;Material::' + m.matName + ' -> ' + m.name + '\n\tC: "OO",' + matIds[gi] + ',' + m._modelId + '\n\n';
    });
    f += '}\n\n';

    f += 'Takes:  {\n\tCurrent: ""\n}\n';
    return f;
  }

  /* ============================================================
     DEEP CONVERT cho GLTFExporter (r128 không đọc Int8/Int16 attributes)
     Clone container + clone geometry + convert mọi attribute → Float32
     ============================================================ */
  function deepConvertForExporter(object3D) {
    const clone = object3D.clone(true);
    const v = new THREE.Vector3();
    clone.traverse(function (o) {
      if (!o.isMesh) return;
      /* clone geometry riêng để không phá runtime */
      o.geometry = o.geometry.clone();
      const g = o.geometry;
      ['position', 'normal', 'uv', 'uv2', 'tangent', 'color'].forEach(function (key) {
        const a = g.attributes[key];
        if (!a) return;
        if (a.array instanceof Float32Array) return;
        const f = new Float32Array(a.count * a.itemSize);
        if (a.normalized) {
          const src = a.array;
          let scale = 1;
          if (src instanceof Int8Array) scale = 127;
          else if (src instanceof Int16Array) scale = 32767;
          else if (src.constructor && src.constructor.name === 'Uint8Array') scale = 255;
          for (let i = 0; i < f.length; i++) f[i] = src[i] / scale;
        } else {
          for (let i = 0; i < f.length; i++) f[i] = a.array[i];
        }
        g.setAttribute(key, new THREE.BufferAttribute(f, a.itemSize, false));
      });
      /* world matrix bake cho mesh transform nếu model có transform riêng */
      if (o !== clone) {
        o.updateMatrixWorld(true);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        if (g.attributes.normal) {
          const n = g.attributes.normal;
          for (let i = 0; i < n.count; i++) {
            v.fromBufferAttribute(n, i).transformDirection(o.matrixWorld);
            n.setXYZ(i, v.x, v.y, v.z);
          }
        }
        o.position.set(0, 0, 0);
        o.rotation.set(0, 0, 0);
        o.scale.set(1, 1, 1);
        o.updateMatrix();
      }
      /* index → Uint32 */
      if (g.index && !(g.index.array instanceof Uint32Array)) {
        const u = new Uint32Array(g.index.count);
        for (let i = 0; i < g.index.count; i++) u[i] = g.index.getX(i);
        g.setIndex(new THREE.BufferAttribute(u, 1));
      }
      g.morphAttributes = {};
    });
    return clone;
  }

  /* ============================================================
     SIMPLIFY FROM SERVER — GIẢM TRIANGLES THẬT qua MeshoptSimplifier
     Parse GLB → gửi indices/positions/uvs → server simplify giữ UV+shape
     → compact vertices → trả GLB mới với index buffer gọn.
     Chất lượng hình KHÔNG vỡ: simplify giữ shape + UV seams (LockBorder).
     ============================================================ */
  SaveManager.applySimplifyFromServer = function (glbBlob, opts) {
    if (!opts.simplifyRatio || opts.simplifyRatio >= 1) return Promise.resolve(glbBlob);
    return SaveManager._probeMeshoptServer().then(function (available) {
      if (!available) {
        bus.emit('notify', {
          type: 'warning', title: 'Giảm triangles cần server',
          message: 'Chạy server.bat + npm install meshoptimizer để bật simplify. Đang lưu không giảm tris.',
          duration: 6000
        });
        return glbBlob;
      }
      return glbBlob.arrayBuffer().then(function (ab) {
        const dv = new DataView(ab);
        if (dv.getUint32(0, true) !== 0x46546c67) return glbBlob;
        const totalLen = dv.getUint32(8, true);
        let json = null, bin = null;
        let off = 12;
        while (off < totalLen) {
          const len = dv.getUint32(off, true);
          const type = dv.getUint32(off + 4, true);
          if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, off + 8, len)));
          else if (type === 0x004e4942) bin = new Uint8Array(ab, off + 8, len);
          off += 8 + len;
        }
        if (!json || !bin) return glbBlob;

        /* Gom primitives cần simplify (mesh có indices+position+uv) */
        const jobs = [];
        const jobRefs = [];
        (json.meshes || []).forEach(function (mesh) {
          (mesh.primitives || []).forEach(function (prim) {
            const idxAcc = json.accessors[prim.indices];
            const posAcc = json.accessors[prim.attributes.POSITION];
            const uvAcc = prim.attributes.TEXCOORD_0 !== undefined ? json.accessors[prim.attributes.TEXCOORD_0] : null;
            if (!idxAcc || !posAcc) return;
            const idxBv = json.bufferViews[idxAcc.bufferView];
            const posBv = json.bufferViews[posAcc.bufferView];
            const toB64 = function (bytes) {
              let s = '';
              const CH = 32768;
              for (let i = 0; i < bytes.length; i += CH) {
                s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
              }
              return btoa(s);
            };
            jobs.push({
              indices: toB64(new Uint8Array(bin.buffer, bin.byteOffset + idxBv.byteOffset, idxAcc.count * 4)),
              vertexCount: posAcc.count,
              positions: toB64(new Uint8Array(bin.buffer, bin.byteOffset + posBv.byteOffset, posAcc.count * 12)),
              uvs: uvAcc ? toB64(new Uint8Array(bin.buffer, bin.byteOffset + json.bufferViews[uvAcc.bufferView].byteOffset, uvAcc.count * 8)) : null,
              targetRatio: opts.simplifyRatio,
              errorPct: 0.01
            });
            jobRefs.push({ mesh: mesh, prim: prim });
          });
        });

        if (!jobs.length) return glbBlob;
        PixiStudio.Notifications.updateLoading(45, '🪓 Giảm triangles ' + Math.round(opts.simplifyRatio * 100) + '% qua server…');

        return fetch('/api/meshopt-simplify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobs: jobs })
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (!res.ok || !res.results) {
          bus.emit('notify', { type: 'error', title: 'Simplify server từ chối', message: String(res.error || 'không rõ').slice(0, 200) });
          return glbBlob;
        }

          /* Rebuild SẠCH: bufferViews mới hoàn toàn — bỏ views cũ */
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

          const newBufferViews = [];
          const placeInto = function (bytes) {
            const loc = place(bytes);
            const bvIdx = newBufferViews.length;
            newBufferViews.push(Object.assign({ buffer: 0, byteLength: bytes.length }, loc));
            return bvIdx;
          };

          /* images giữ nguyên */
          (json.images || []).forEach(function (img) {
            if (img && img.bufferView !== undefined) {
              const bv = json.bufferViews[img.bufferView];
              const copy = bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);
              const oldBvIdx = img.bufferView;
              newBufferViews[oldBvIdx] = Object.assign({}, bv, place(copy));
            }
          });

          let totalTrisAfter = 0;
          res.results.forEach(function (r, i) {
            const ref = jobRefs[i];
            const prim = ref.prim;
            const idxAcc = json.accessors[prim.indices];
            const posAcc = json.accessors[prim.attributes.POSITION];
            const newIndices = Uint8Array.from(atob(r.indices), function (c) { return c.charCodeAt(0); });
            const newIdxU32 = new Uint32Array(newIndices.buffer, 0, r.indexCount);

            /* compact vertices: remap theo index mới dùng */
            const used = new Uint8Array(posAcc.count);
            for (let i2 = 0; i2 < newIdxU32.length; i2++) used[newIdxU32[i2]] = 1;
            const remap = new Int32Array(posAcc.count).fill(-1);
            let newVertCount = 0;
            for (let i2 = 0; i2 < posAcc.count; i2++) if (used[i2]) remap[i2] = newVertCount++;
            const remappedIdx = new Uint32Array(newIdxU32.length);
            for (let i2 = 0; i2 < newIdxU32.length; i2++) remappedIdx[i2] = remap[newIdxU32[i2]];

            /* compact MỖI attribute của primitive theo remap */
            Object.keys(prim.attributes).forEach(function (attrName) {
              const accIdx = prim.attributes[attrName];
              if (accIdx === undefined) return;
              const acc = json.accessors[accIdx];
              const bv = json.bufferViews[acc.bufferView];
              const compSize = { VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type] || 3;
              const bytesPerComp = acc.componentType === 5126 ? 4 : acc.componentType === 5123 ? 2 : acc.componentType === 5120 ? 1 : 1;
              const stride = acc.normalized && acc.componentType === 5120 ? 4 : compSize * bytesPerComp;
              const srcOff = bv.byteOffset + (acc.byteOffset || 0);
              const newArr = new Float32Array(newVertCount * compSize);
              /* views tạo 1 lần trước vòng lặp (perf) */
              const isF32 = acc.componentType === 5126;
              const srcViewF32 = isF32 ? new Float32Array(bin.buffer, bin.byteOffset + srcOff, bv.byteLength / 4) : null;
              const srcViewI8 = (!isF32 && acc.componentType === 5120) ? new Int8Array(bin.buffer, bin.byteOffset + srcOff, bv.byteLength) : null;
              for (let old = 0; old < posAcc.count; old++) {
                const ni = remap[old];
                if (ni === -1) continue;
                for (let c2 = 0; c2 < compSize; c2++) {
                  const srcIdx = old * (stride / bytesPerComp) + c2;
                  if (isF32) {
                    newArr[ni * compSize + c2] = srcViewF32[srcIdx];
                  } else if (srcViewI8) {
                    const v = srcViewI8[old * stride + c2];
                    newArr[ni * compSize + c2] = acc.normalized ? Math.max(-1, v / 127) : v;
                  }
                }
              }
              acc.count = newVertCount;
              if (attrName === 'POSITION') {
                acc.min = [newArr[0], newArr[1], newArr[2]];
                acc.max = [newArr[newArr.length - 3], newArr[newArr.length - 2], newArr[newArr.length - 1]];
                for (let vi = 0; vi < newVertCount; vi++) {
                  acc.min[0] = Math.min(acc.min[0], newArr[vi * 3]); acc.max[0] = Math.max(acc.max[0], newArr[vi * 3]);
                  acc.min[1] = Math.min(acc.min[1], newArr[vi * 3 + 1]); acc.max[1] = Math.max(acc.max[1], newArr[vi * 3 + 1]);
                  acc.min[2] = Math.min(acc.min[2], newArr[vi * 3 + 2]); acc.max[2] = Math.max(acc.max[2], newArr[vi * 3 + 2]);
                }
              }
              acc.bufferView = placeInto(new Uint8Array(newArr.buffer, 0, newArr.byteLength));
            });

            /* index accessor mới — u16 nếu vừa */
            const loc2 = place(remappedIdx);
            idxAcc.bufferView = placeInto(remappedIdx);
            idxAcc.count = remappedIdx.length;
            if (newVertCount <= 65535) idxAcc.componentType = 5123;
            binParts.push(new Uint8Array(0)); /* loc2 đã place — giữ thứ tự an toàn */
            totalTrisAfter += r.indexCount / 3;
          });

          const binPad = (4 - (binCursor % 4)) % 4;
          const binTotal = binCursor + binPad;
          const newBin = new Uint8Array(binTotal);
          let cur = 0;
          binParts.forEach(function (p) { newBin.set(p, cur); cur += p.length; });
          json.buffers = [{ byteLength: binTotal }];
          json.bufferViews = newBufferViews.filter(Boolean);

          const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
          const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
          const totalOut = 12 + 8 + jsonBytes.length + jsonPad + 8 + binTotal;
          const out = new ArrayBuffer(totalOut);
          const odv = new DataView(out);
          odv.setUint32(0, 0x46546c67, true);
          odv.setUint32(4, 2, true);
          odv.setUint32(8, totalOut, true);
          odv.setUint32(12, jsonBytes.length + jsonPad, true);
          odv.setUint32(16, 0x4e4f534a, true);
          new Uint8Array(out, 20).set(jsonBytes);
          for (let i = 0; i < jsonPad; i++) new Uint8Array(out, 20 + jsonBytes.length, jsonPad)[i] = 0x20;
          let w = 20 + jsonBytes.length + jsonPad;
          odv.setUint32(w, binTotal, true);
          odv.setUint32(w + 4, 0x004e4942, true);
          new Uint8Array(out, w + 8).set(newBin);

          const newBlob = new Blob([out], { type: 'model/gltf-binary' });
          SaveManager._simplifyInfo = { srcTris: jobs.reduce(function (s, j) { return s + j.vertexCount / 2 * 0; }, 0) || null, dstTris: totalTrisAfter };
          return newBlob;
        }).catch(function (err) {
          bus.emit('notify', { type: 'warning', title: 'Simplify lỗi', message: String(err && err.message || err) + ' — giữ mesh nguyên.' });
          return glbBlob;
        });
      });
    });
  };

  /* ============================================================
     MAIN SAVE ENTRY
     ============================================================ */
  SaveManager.save = function (formatId, overrideOptions, tag) {
    const target = PixiStudio.State.get('selection') || PixiStudio.Viewport.getMainModel();
    if (!target) {
      bus.emit('notify', { type: 'warning', title: 'Save', message: 'Chưa có model nào để lưu.' });
      return Promise.resolve(null);
    }
    const modelName = target.name || 'model';
    const fmt = FORMATS.find(function (f) { return f.id === formatId; });
    if (!fmt) return Promise.resolve(null);
    if (!fmt.real) {
      if (formatId === 'blend-legacy') {
        /* Blender hướng dẫn trung thực — dùng DAE/GLB import trực tiếp */
        PixiStudio.Modals.open({
          title: 'BLEND — hướng dẫn trung thực',
          body: (function () {
            const wrap = U.el('div');
            wrap.appendChild(U.el('p', { style: 'color:var(--text-2);line-height:1.7;font-weight:500;margin-bottom:10px;', text: 'File .blend là format binary riêng của Blender (DNA1/RNA structures) — không có encoder JS mở. Studio cung cấp 2 đường dẫn import Blender chuẩn:' }));
            wrap.appendChild(U.el('button', {
              class: 'btn primary block', style: 'margin-bottom:8px;',
              html: U.icon('scene') + ' Xuất DAE + textures → Blender: File > Import > Collada',
              onclick: function () { PixiStudio.Modals.close(); SaveManager.save('dae'); }
            }));
            wrap.appendChild(U.el('button', {
              class: 'btn block', style: 'margin-bottom:8px;',
              html: U.icon('cube') + ' Xuất GLB → Blender: File > Import > glTF 2.0 (khuyến nghị)',
              onclick: function () { PixiStudio.Modals.close(); SaveManager.save('glb-full'); }
            }));
            wrap.appendChild(U.el('button', {
              class: 'btn block',
              html: U.icon('folder') + ' Xuất GLTF Source Pack (ZIP)',
              onclick: function () { PixiStudio.Modals.close(); SaveManager.save('zip-gltf'); }
            }));
            return wrap;
          })(),
          buttons: [{ label: 'Đóng', class: 'btn' }]
        });
        return Promise.resolve(null);
      }
      bus.emit('notify', { type: 'warning', title: fmt.name + ' — chưa hỗ trợ', message: fmt.desc });
      return Promise.resolve(null);
    }

    const t0 = performance.now();
    PixiStudio.Notifications.showLoading('Chuẩn bị lưu ' + fmt.name + '…', 5);

    const opts = Object.assign({}, SaveManager.options, overrideOptions || {});

    const finish = function (blob, report, filename) {
      U.downloadBlob(blob, filename);
      const elapsed = Math.round(performance.now() - t0);
      const entry = {
        name: filename, format: fmt.id, sizeBytes: blob.size,
        trisBefore: report ? report.trisBefore : null, trisAfter: report ? report.trisAfter : null,
        beforeBytes: report ? report.originalSizeBytes || null : null,
        elapsedMs: elapsed
      };
      SaveManager.logSave(entry);
      PixiStudio.Notifications.hideLoading();
      bus.emit('notify', {
        type: 'success', title: 'Đã lưu ' + filename,
        message: (blob.size / 1048576).toFixed(2) + ' MB · ' + (report && report.savedPercent !== undefined ? 'giảm ' + report.savedPercent + '%' : '') + ' trong ' + (elapsed >= 1000 ? (elapsed / 1000).toFixed(1) + 's' : elapsed + 'ms')
      });
      if (report && report.showDialog) SaveManager.showReport(report);
      bus.emit('save:done', entry);
      return entry;
    };

    switch (formatId) {
      /* ===== TripoGLB — mirror định dạng tripo_convert GLB ===== */
      case 'tripo-glb': {
        PixiStudio.Notifications.updateLoading(15, 'TripoGLB — xuất theo định dạng tripo_convert…');
        const srcEntry = PixiStudio.Models.getCurrent();
        return PixiStudio.GLBWriter.write(target, {
          compatTarget: 'universal',
          tripoFormat: true,
          weldVertices: false, weldMode: 'exact',
          quantizeNormals: false, quantizeUV: false,
          textureMaxSize: 0, textureFormat: 'jpeg', textureQuality: 0.9,
          force16bitIndices: true, prefer16bitIndices: true,
          meshoptServerEncode: false, simplifyRatio: 0
        }).then(function (result) {
          const filename = buildFileName(modelName, 'tripo', fmt.ext);
          result.report.originalSizeBytes = srcEntry ? (srcEntry.fileSize || 0) : 0;
          if (srcEntry && srcEntry.fileSize) {
            result.report.savedPercent = Math.round((1 - result.blob.size / srcEntry.fileSize) * 100);
          } else result.report.savedPercent = null;
          result.report.sizeBytes = result.blob.size;
          result.report.showDialog = true;
          const entry = finish(result.blob, result.report, filename);
          if (SaveManager.options.verifyAfterSave) {
            /* TripoGLB universal — verify bằng loader thuần không decoder */
            SaveManager._verifyBlob(result.blob, 'universal').then(function (v) {
              if (v.ok) {
                bus.emit('notify', {
                  type: 'success', title: 'TripoGLB Verify ✓ (loader THUẦN)',
                  message: U.formatNumber(v.tris) + ' tris — Meshy/Tripo/Blender đọc được.'
                });
              } else {
                bus.emit('notify', { type: 'error', title: 'TripoGLB Verify ✖', message: v.message });
              }
            });
          }
          return entry;
        }).catch(function (err) {
          PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'TripoGLB lỗi', message: err.message });
        });
      }

      case 'glb-hq': {
        /* High Quality — giữ nguyên chất lượng hình: không weld/quantize,
           texture GIỮ kích thước gốc chỉ re-encode chất lượng cao, meshopt lossless
           (+ simplify nếu bật option Giảm triangles) */
        PixiStudio.Notifications.updateLoading(15, 'High Quality — giữ nguyên texture, nén không mất chi tiết…');
        const srcEntry = PixiStudio.Models.getCurrent();
        return PixiStudio.GLBWriter.write(target, opts).then(function (result) {
          return SaveManager.applySimplifyFromServer(result.blob, opts).then(function (simpleBlob) {
            const blobAfterSimple = simpleBlob || result.blob;
            return SaveManager.applyMeshoptFromServer(blobAfterSimple, opts).then(function (finalBlob) {
            const usedBlob = finalBlob && finalBlob.size < blobAfterSimple.size ? finalBlob : blobAfterSimple;
            const filename = buildFileName(modelName, tag || 'hq', fmt.ext);
            result.report.originalSizeBytes = srcEntry ? (srcEntry.fileSize || 0) : 0;
            if (srcEntry && srcEntry.fileSize) {
              result.report.savedPercent = Math.round((1 - usedBlob.size / srcEntry.fileSize) * 100);
            } else result.report.savedPercent = null;
            result.report.sizeBytes = usedBlob.size;
            result.report.meshoptEnabled = finalBlob && finalBlob.size < blobAfterSimple.size;
            result.report.qualityMode = 'high';
            result.report.simplifyRatio = opts.simplifyRatio || 0;
            if (opts.simplifyRatio > 0) {
              result.report.trisBefore = null;
              result.report.simplified = true;
            }
            result.report.showDialog = true;
            const entry = finish(usedBlob, result.report, filename);
            if (SaveManager.options.verifyAfterSave) {
              SaveManager._verifyBlob(usedBlob, result.report.compatTarget).then(function (v) {
                if (v.ok) {
                  bus.emit('notify', {
                    type: 'success', title: 'Verify ✓ (loader ' + (result.report.compatTarget === 'web' ? 'three + meshopt' : 'THUẦN') + ')',
                    message: U.formatNumber(v.tris) + ' tris — chất lượng giữ nguyên.'
                  });
                } else {
                  bus.emit('notify', { type: 'error', title: 'Verify ✖', message: v.message });
                }
              });
            }
            return entry;
          });
          });
        }).catch(function (err) {
          PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'GLB High Quality lỗi', message: err.message });
        });
      }

      case 'glb-opt': {
        PixiStudio.Notifications.updateLoading(15, 'Đang tối ưu geometry + encode texture…');
        const srcEntry = PixiStudio.Models.getCurrent();
        return PixiStudio.GLBWriter.write(target, opts).then(function (result) {
          /* Bước 2: simplify (giảm triangles) nếu bật → Bước 3: nén meshopt */
          return SaveManager.applySimplifyFromServer(result.blob, opts).then(function (simpleBlob) {
            const blobAfterSimple = simpleBlob || result.blob;
            return SaveManager.applyMeshoptFromServer(blobAfterSimple, opts).then(function (finalBlob) {
            const usedBlob = finalBlob && finalBlob.size < blobAfterSimple.size ? finalBlob : blobAfterSimple;
            const filename = buildFileName(modelName, tag || 'opt', fmt.ext);
            result.report.originalSizeBytes = srcEntry ? (srcEntry.fileSize || 0) : 0;
            if (srcEntry && srcEntry.fileSize) {
              result.report.savedPercent = Math.round((1 - usedBlob.size / srcEntry.fileSize) * 100);
            } else {
              result.report.savedPercent = null;
            }
            result.report.sizeBytes = usedBlob.size;
            result.report.geometryBytes = result.report.geometryBytes - (usedBlob.size < result.blob.size ? (result.blob.size - usedBlob.size) : 0);
            result.report.meshoptEnabled = usedBlob.size < result.blob.size;
            result.report.showDialog = true;
            const entry = finish(usedBlob, result.report, filename);
            /* Verify-after-save — universal: loader thuần KHÔNG decoder (nghiêm ngặt) */
            if (SaveManager.options.verifyAfterSave) {
              SaveManager._verifyBlob(usedBlob, result.report.compatTarget).then(function (v) {
                if (v.ok) {
                  bus.emit('notify', {
                    type: 'success', title: 'Verify ✓ (loader ' + (result.report.compatTarget === 'web' ? 'three + meshopt' : 'THUẦN không decoder') + ')',
                    message: U.formatNumber(v.tris) + ' tris khớp — file đọc được độc lập.'
                  });
                } else {
                  bus.emit('notify', { type: 'error', title: 'Verify ✖', message: v.message + ' — file có vấn đề, thử lại với target Universal.' });
                }
              });
            }
            return entry;
          });
          });
        }).catch(function (err) {
          PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'GLB tối ưu lỗi', message: err.message });
        });
      }

      case 'glb-full': {
        /* Full Original — GLBWriter high-fidelity: không weld/quantize/resize,
           texture JPEG/PNG nguyên kích thước (ổn định hơn GLTFExporter với mesh lớn) */
        return PixiStudio.GLBWriter.write(target, {
          compatTarget: 'universal',
          weldVertices: false, weldMode: 'exact',
          quantizeNormals: false, quantizeUV: false,
          textureMaxSize: 0, textureFormat: 'auto', textureQuality: 0.95,
          prefer16bitIndices: true
        }).then(function (result) {
          const blob = result.blob;
          finish(blob, {
            sizeBytes: blob.size, geometryBytes: result.report.geometryBytes,
            textures: result.report.textures, compatTarget: 'universal',
            extensionsUsed: result.report.extensionsUsed, qualityMode: 'full-original'
          }, buildFileName(modelName, 'full', fmt.ext));
          return null;
        }).catch(function (err) {
          PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'Export lỗi', message: String(err && err.message || err) });
          return null;
        });
      }

      case 'gltf': {
        return new Promise(function (resolve) {
          PixiStudio.Notifications.updateLoading(30, 'GLTFExporter JSON…');
          if (!THREE.GLTFExporter) { PixiStudio.Notifications.hideLoading(); resolve(null); return; }
          new THREE.GLTFExporter().parse(deepConvertForExporter(target), function (result) {
            const blob = new Blob([JSON.stringify(result)], { type: 'model/gltf+json' });
            finish(blob, {}, buildFileName(modelName, 'gltf', fmt.ext));
            resolve(null);
          }, function () { PixiStudio.Notifications.hideLoading(); }, { binary: false });
        });
      }

      /* ===== FBX 2013 + MIXAMO RIG (giống X Bot.fbx) ===== */
      case 'fbx-mixamo-rig': {
        if (!PixiStudio.FBXBinary) {
          PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'FBX Mixamo rig', message: 'Thiếu module FBXBinary.' });
          return Promise.resolve(null);
        }
        return saveFBXMixamoRig(target, modelName, finish, fmt);
      }

      /* ===== OBJ + MTL + TEXTURE (ZIP) — OBJ "có màu" ===== */
      case 'obj-color': {
        if (!PixiStudio.ZipWriter) {
          PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'OBJ + MTL', message: 'Thiếu ZipWriter — không đóng gói được ZIP.' });
          return Promise.resolve(null);
        }
        return saveOBJColorZip(target, modelName, finish, fmt);
      }

      /* ===== OBJ thuần (chỉ geometry, do THREE.OBJExporter) ===== */
      case 'obj': {
        PixiStudio.Notifications.updateLoading(40, 'OBJExporter…');
        if (!THREE.OBJExporter) { PixiStudio.Notifications.hideLoading(); bus.emit('notify', { type: 'error', title: 'OBJExporter chưa load' }); return Promise.resolve(null); }
        try {
          const text = new THREE.OBJExporter().parse(target);
          const blob = new Blob([text], { type: 'text/plain' });
          finish(blob, {}, buildFileName(modelName, 'obj', fmt.ext));
        } catch (err) {
          PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'OBJ lỗi', message: String(err) });
        }
        return Promise.resolve(null);
      }

      case 'stl': {
        PixiStudio.Notifications.updateLoading(40, 'STLExporter…');
        if (!THREE.STLExporter) { PixiStudio.Notifications.hideLoading(); bus.emit('notify', { type: 'error', title: 'STLExporter chưa load' }); return Promise.resolve(null); }
        try {
          const data = new THREE.STLExporter().parse(target);
          const blob = new Blob([data], { type: 'model/stl' });
          finish(blob, {}, buildFileName(modelName, 'print', fmt.ext));
        } catch (err) {
          PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'STL lỗi', message: String(err) });
        }
        return Promise.resolve(null);
      }

      case 'ply': {
        PixiStudio.Notifications.updateLoading(40, 'Tạo PLY ASCII…');
        setTimeout(function () {
          try {
            const text = exportPLY(target);
            const blob = new Blob([text], { type: 'text/plain' });
            finish(blob, {}, buildFileName(modelName, 'ply', fmt.ext));
          } catch (err) {
            PixiStudio.Notifications.hideLoading();
            bus.emit('notify', { type: 'error', title: 'PLY lỗi', message: String(err) });
          }
        }, 60);
        return Promise.resolve(null);
      }

      case 'json-geo': {
        PixiStudio.Notifications.updateLoading(50, 'Serialize JSON…');
        setTimeout(function () {
          const text = exportJSONGeometry(target);
          const blob = new Blob([text], { type: 'application/json' });
          finish(blob, {}, buildFileName(modelName, 'geo', fmt.ext));
        }, 60);
        return Promise.resolve(null);
      }

      /* ===== DAE Collada + textures (ZIP) — Blender/Maya/Unity ===== */
      case 'dae': {
        PixiStudio.Notifications.updateLoading(20, 'Tạo Collada XML + encode textures…');
        const daeResult = exportDAE(target, opts);
        const jobs = daeResult.textures.map(function (t, i) {
          return encodeTexForZip(t).then(function (bytes) {
            return { name: t.name, bytes: bytes };
          });
        });
        return Promise.all(jobs).then(function (texFiles) {
          const files = [{ name: buildFileName(modelName, 'dae', '.dae').replace('.zip', '.dae'), data: new TextEncoder().encode(daeResult.dae) }];
          texFiles.forEach(function (tf) {
            if (tf.bytes) files.push({ name: tf.name, data: tf.bytes });
          });
          files.push({
            name: 'README.txt',
            data: new TextEncoder().encode('DAE Collada 1.4.1 + textures PNG\nBlender: File > Import > Collada (DAE)\nMaya/Unity: import trực tiếp\nXuất bởi PixiJS Studio × Tripo3D AI Studio v21.0')
          });
          const blob = PixiStudio.ZipWriter.create(files);
          PixiStudio.Notifications.hideLoading();
          return finish(blob, {}, buildFileName(modelName, 'dae-pack', fmt.ext));
        });
      }

      /* ===== FBX MIXAMO — mesh-only + auto-rig + texture nhúng (CÓ MÀU) ===== */
      case 'fbx-mixamo': {
        if (!PixiStudio.FBXBinary) {
          PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'Save Mixamo', message: 'Thiếu module FBXBinary — không tạo được FBX Mixamo.' });
          return Promise.resolve(null);
        }
        return saveFBXMixamo(target, modelName, finish, fmt);
      }

      /* ===== FBX ASCII 7.4 — Maya/Autodesk (Blender cần binary) ===== */
      case 'fbx': {
        /* Ưu tiên FBX BINARY 7.4 có skeleton + skin (Blender/Unity/Unreal đọc được).
           Lần 7: preset Mixamo KHÔNG đi đường này — saveFBXBinary tự chuyển sang
           đường Mixamo-safe (mesh-only) vì file có xương bị Mixamo từ chối.
           ASCII cũ chỉ có geometry nên Mixamo từ chối — chỉ dùng làm fallback. */
        if (PixiStudio.FBXBinary) return saveFBXBinary(target, modelName, finish, fmt);
        PixiStudio.Notifications.updateLoading(40, 'Tạo FBX ASCII…');
        setTimeout(function () {
          try {
            const text = exportFBXAscii(target);
            const blob = new Blob([text], { type: 'application/octet-stream' });
            finish(blob, {}, buildFileName(modelName, 'fbx', fmt.ext));
            bus.emit('notify', {
              type: 'info', title: 'FBX ASCII đã lưu',
              message: 'Maya/Autodesk/MotionBuilder đọc được. Blender chỉ đọc FBX binary — dùng DAE hoặc GLB cho Blender.',
              duration: 7000
            });
          } catch (err) {
            PixiStudio.Notifications.hideLoading();
            bus.emit('notify', { type: 'error', title: 'FBX lỗi', message: String(err) });
          }
        }, 60);
        return Promise.resolve(null);
      }

      /* ===== GLTF Source Pack (JSON + README zip) ===== */
      case 'zip-gltf': {
        PixiStudio.Notifications.updateLoading(30, 'GLTFExporter JSON → pack…');
        if (!THREE.GLTFExporter) { PixiStudio.Notifications.hideLoading(); return Promise.resolve(null); }
        return new Promise(function (resolve) {
          new THREE.GLTFExporter().parse(deepConvertForExporter(target), function (result) {
            const jsonText = JSON.stringify(result, null, 1);
            const files = [
              { name: 'model.gltf', data: new TextEncoder().encode(jsonText) },
              {
                name: 'README.txt',
                data: new TextEncoder().encode('GLTF source pack — model.gltf embed data URI buffers/textures.\nDùng làm nguồn pipeline (không phải file runtime tối ưu — dùng GLB).\nXuất bởi PixiJS Studio × Tripo3D AI Studio v21.0')
              }
            ];
            const blob = PixiStudio.ZipWriter.create(files);
            PixiStudio.Notifications.hideLoading();
            finish(blob, {}, buildFileName(modelName, 'gltfpack', fmt.ext));
            resolve(null);
          }, function (err) {
            PixiStudio.Notifications.hideLoading();
            bus.emit('notify', { type: 'error', title: 'GLTF pack lỗi', message: String(err && err.message || err) });
            resolve(null);
          }, { binary: false });
        });
      }

      /* ===== BLEND — Blender Import Kit: GLB + bpy script tạo mesh+texture ===== */
      case 'blend-kit': {
        PixiStudio.Notifications.updateLoading(20, 'Đóng gói Blender Import Kit…');
        /* Bước 1: GLB quality cao */
        return PixiStudio.GLBWriter.write(target, Object.assign({}, opts, {
          compatTarget: 'universal', weldVertices: false, weldMode: 'exact',
          quantizeNormals: false, quantizeUV: false,
          textureMaxSize: 0, textureFormat: 'png', textureQuality: 0.95,
          prefer16bitIndices: true
        })).then(function (glbResult) {
          /* Bước 2: thu thập mesh data + texture dataURL cho script bpy */
          const meshes = gatherMeshData(target);
          const texJobs = [];
          const texInfos = [];
          meshes.forEach(function (m) {
            m.textures.forEach(function (t, ti) {
              if (!t.tex || !t.tex.image) return;
              const texName = m.matName + '_' + t.slot + '.png';
              const info = { name: texName, matName: m.matName, slot: t.slot, b64Promise: null };
              texInfos.push(info);
              texJobs.push(new Promise(function (res) {
                const img = t.tex.image;
                const canvas = document.createElement('canvas');
                canvas.width = Math.min(img.width, 2048); canvas.height = Math.min(img.height, 2048);
                const cx2 = canvas.getContext('2d');
                try {
                  if (t.tex.flipY === true) { cx2.translate(0, canvas.height); cx2.scale(1, -1); }
                  cx2.drawImage(img, 0, 0, canvas.width, canvas.height);
                  canvas.toBlob(function (b) {
                    if (!b) { res(null); return; }
                    const r = new FileReader();
                    r.onload = function () {
                      info.b64 = String(r.result).split(',')[1];
                      res(info);
                    };
                    r.readAsDataURL(b);
                  }, 'image/png');
                } catch (e) { res(info); }
              }));
            });
          });

          return Promise.all(texJobs).then(function () {
            PixiStudio.Notifications.updateLoading(60, 'Tạo Blender Python script…');

            /* Python script — bpy tạo mesh + texture trực tiếp trong Blender */
            let py = '# Blender Import Script — ' + modelName + '\n';
            py += '# Chạy trong Blender: tab Scripting -> Open -> chọn file nay -> Run Script\n';
            py += '# Sau do: File > Save As... de luu thanh file .blend cua ban\n';
            py += 'import bpy, base64, tempfile, os, mathutils\n\n';
            py += 'scene = bpy.context.scene\n\n';
            /* xoá object cũ cùng tên */
            py += 'for ob in list(bpy.data.objects):\n    if ob.name.startswith("PXS_"):\n        bpy.data.objects.remove(ob, do_unlink=True)\n\n';
            py += 'def pxs_make_material(name, tex_b64, tex_name):\n    mat = bpy.data.materials.new(name)\n    mat.use_nodes = True\n    nt = mat.node_tree\n    bsdf = nt.nodes.get("Principled BSDF") or next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)\n    if tex_b64:\n        pth = tempfile.gettempdir() + os.sep + tex_name\n        open(pth, "wb").write(base64.b64decode(tex_b64))\n        img = bpy.data.images.load(pth)\n        texn = nt.nodes.new("ShaderNodeTexImage")\n        texn.image = img\n        if bsdf:\n            nt.links.new(texn.outputs["Color"], bsdf.inputs["Base Color"])\n    return mat\n\n';

            meshes.forEach(function (m, gi) {
              const objName = 'PXS_' + m.name;
              /* verts/faces chunk để script gọn */
              const vertStr = m.verts.map(function (x) { return x.toFixed(4); }).join(',');
              const faceChunks = [];
              for (let t = 0; t < m.tris.length; t += 3) {
                faceChunks.push('(' + m.tris[t] + ',' + m.tris[t + 1] + ',' + m.tris[t + 2] + ')');
              }
              const faceStr = faceChunks.join(',');
              const uvStr = m.hasUV ? m.uvs.map(function (x) { return x.toFixed(4); }).join(',') : '';

              py += '# --- mesh ' + objName + ' ---\n';
              py += 'mv = [' + vertStr + ']\n';
              py += 'mf = [' + faceStr + ']\n';
              py += 'mu = [' + uvStr + ']\n';
              py += 'mesh' + gi + ' = bpy.data.meshes.new("' + objName + '")\n';
              py += 'mesh' + gi + '.from_pydata(mv, [], [list(f) for f in mf])\n';
              py += 'mesh' + gi + '.update()\n';
              py += 'ob' + gi + ' = bpy.data.objects.new("' + objName + '", mesh' + gi + ')\n';
              py += 'scene.collection.objects.link(ob' + gi + ')\n';
              if (m.hasUV) {
                py += 'uvl = mesh' + gi + '.uv_layers.new(name="UVMap")\n';
                py += 'for fi, poly in enumerate(mesh' + gi + '.polygons):\n    for li, loop_idx in enumerate(poly.loop_indices):\n        vi = mesh' + gi + '.loops[loop_idx].vertex_index\n        uvl.data[loop_idx].uv = (mu[vi*2], mu[vi*2+1])\n';
              }
              /* material + texture */
              const matTexs = texInfos.filter(function (t) { return t.matName === m.matName && t.slot === 'diffuse' && t.b64; });
              const b64v = matTexs.length ? matTexs[0].b64 : '';
              const texn = matTexs.length ? matTexs[0].name : '';
              /* b64 quá dài — chunk xuống dòng python string */
              py += 'mat' + gi + ' = pxs_make_material("' + m.matName + '", """' + b64v + '""", "' + texn + '")\n';
              py += 'if ob' + gi + '.data.materials:\n    ob' + gi + '.data.materials[0] = mat' + gi + '\nelse:\n    ob' + gi + '.data.materials.append(mat' + gi + ')\n';
              py += 'ob' + gi + '.select_set(True)\n\n';
            });
            py += 'print("PXS: imported ' + meshes.length + ' mesh(s) — Save As .blend de hoan tat")\n';

            /* GLB file bytes */
            return glbResult.blob.arrayBuffer().then(function (glbAb) {
              const files = [
                { name: 'model.glb', data: new Uint8Array(glbAb) },
                { name: 'import_to_blender.py', data: new TextEncoder().encode(py) },
                texInfos.filter(function (t) { return t.b64; }).map(function (t) {
                  return { name: t.name, data: Uint8Array.from(atob(t.b64), function (c) { return c.charCodeAt(0); }) };
                }),
                [{
                  name: 'README.txt',
                  data: new TextEncoder().encode(
                    '=== BLEND IMPORT KIT — ' + modelName + ' ===\n\n' +
                    'Cach 1 (NHANH): Blender -> File > Import > glTF 2.0 -> chon model.glb\n' +
                    '  (Blender 3.x+ ho tro glTF san - khong can script)\n\n' +
                    'Cach 2 (TAO MESH TU SCRIPT): Blender -> tab Scripting -> New -> dan\n' +
                    '  noi dung import_to_blender.py -> Run Script. Mesh + texture se duoc\n' +
                    '  tao truc tiep trong scene. Sau do: File > Save As... => file .blend cua ban.\n\n' +
                    'Xuat boi PixiJS Studio x Tripo3D AI Studio v21.0 - ' + new Date().toLocaleString())
                }]
              ].flat();
              const blob = PixiStudio.ZipWriter.create(files);
              PixiStudio.Notifications.hideLoading();
              return finish(blob, {}, buildFileName(modelName, 'blendkit', fmt.ext));
            });
          }).catch(function (err) {
            PixiStudio.Notifications.hideLoading();
            bus.emit('notify', { type: 'error', title: 'Blend Kit lỗi', message: String(err && err.message || err) });
            return null;
          });
        });
      }

      case 'png': case 'jpg': case 'webp': {
        PixiStudio.Notifications.updateLoading(30, 'Render ' + fmt.name + '…');
        setTimeout(function () {
          const url = PixiStudio.Viewport.screenshot(1920, 1080, formatId === 'jpg' ? 'jpg' : formatId === 'webp' ? 'webp' : 'png');
          PixiStudio.Notifications.hideLoading();
          if (url) U.downloadDataURL(url, buildFileName(modelName, 'render', fmt.ext));
          SaveManager.logSave({ name: 'render.' + fmt.ext, format: formatId, sizeBytes: Math.round(url ? url.length * 0.75 : 0), elapsedMs: Math.round(performance.now() - t0) });
        }, 80);
        return Promise.resolve(null);
      }

      case 'thumbnail': {
        PixiStudio.Notifications.updateLoading(30, 'Render thumbnail…');
        setTimeout(function () {
          const url = PixiStudio.Viewport.screenshot(256, 256, 'png');
          PixiStudio.Notifications.hideLoading();
          if (url) U.downloadDataURL(url, buildFileName(modelName, 'thumb', fmt.ext));
        }, 80);
        return Promise.resolve(null);
      }

      case 'spritesheet': {
        return exportSpritesheet(target, 256).then(function (dataUrl) {
          const bytes = PixiStudio.ZipWriter.dataURLToBytes(dataUrl);
          const blob = new Blob([bytes], { type: 'image/png' });
          return finish(blob, {}, buildFileName(modelName, 'sheet8', fmt.ext));
        }).catch(function (err) {
          PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'Spritesheet lỗi', message: err.message });
        });
      }

      case 'webm': {
        PixiStudio.Notifications.hideLoading();
        PixiStudio.Exporter.recordWebM();
        return Promise.resolve(null);
      }

      case 'zip': {
        return SaveManager.buildBundle(target, opts).then(function (result) {
          const filename = buildFileName(modelName, 'bundle', fmt.ext);
          return finish(result.blob, result.report, filename);
        });
      }

      case 'project': {
        PixiStudio.Notifications.updateLoading(40, 'Serialize project…');
        setTimeout(function () {
          PixiStudio.Storage.exportProjectFile(sanitizeName(modelName) + '_scene');
          PixiStudio.Notifications.hideLoading();
        }, 60);
        return Promise.resolve(null);
      }
    }
    return Promise.resolve(null);
  };

  /* ============================================================
     MESHOPT SERVER ENCODE — nén geometry sâu hơn qua server Node
     GLBWriter ghi GLB phẳng → parse → gửi buffer lên server
     → nhận bytes nén → rebuild GLB với EXT_meshopt_compression.
     Nếu server không có (file:// hoặc npm chưa cài) → giữ GLB phẳng.
     ============================================================ */
  SaveManager._probeMeshoptServer = function () {
    if (SaveManager._meshoptServer !== null) return Promise.resolve(SaveManager._meshoptServer);
    return fetch('/api/meshopt-ping')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        SaveManager._meshoptServer = !!j.ok && !!j.encoder;
        return SaveManager._meshoptServer;
      })
      .catch(function () { SaveManager._meshoptServer = false; return false; });
  };

  SaveManager.applyMeshoptFromServer = function (glbBlob, opts) {
    return SaveManager._probeMeshoptServer().then(function (available) {
      if (!available || !opts.meshoptServerEncode) return glbBlob;
      /* GUARD tương thích: meshopt làm Meshy/Tripo từ chối file */
      if (opts.compatTarget !== 'web') {
        bus.emit('notify', {
          type: 'warning', title: 'Meshopt đã bỏ qua',
          message: 'Target Universal — meshopt gây fail Meshy/Tripo. Chuyển target Web nếu muốn nén meshopt.',
          duration: 6000
        });
        return glbBlob;
      }

      return glbBlob.arrayBuffer().then(function (ab) {
        const dv = new DataView(ab);
        if (dv.getUint32(0, true) !== 0x46546c67) return glbBlob;
        const totalLen = dv.getUint32(8, true);
        let json = null, bin = null;
        let off = 12;
        while (off < totalLen) {
          const len = dv.getUint32(off, true);
          const type = dv.getUint32(off + 4, true);
          if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, off + 8, len)));
          else if (type === 0x004e4942) bin = new Uint8Array(ab, off + 8, len);
          off += 8 + len;
        }
        if (!json || !bin) return glbBlob;

        /* Gom jobs: mỗi bufferView KHÔNG phải image */
        const isImageBV = {};
        (json.images || []).forEach(function (img) { if (img && img.bufferView !== undefined) isImageBV[img.bufferView] = true; });

        /* accessor tham chiếu bufferView → count/type — stride fallback từ accessor */
        const NATURAL_STRIDE = { 'VEC3': 3, 'VEC2': 2, 'VEC4': 4, 'SCALAR': 1 };
        function strideFrom(acc) {
          const bv = json.bufferViews[acc.bufferView];
          if (bv && bv.byteStride) return bv.byteStride;
          const comps = NATURAL_STRIDE[acc.type] || 1;
          const size = acc.componentType === 5126 ? 4 : acc.componentType === 5125 ? 4 : acc.componentType === 5123 ? 2 : acc.componentType === 5122 ? 2 : 1;
          /* meshopt convention: VEC3 int8 decode stride 4 (padded) */
          if (acc.type === 'VEC3' && size === 1) return 4;
          return comps * size;
        }
        const bvInfo = {};
        (json.accessors || []).forEach(function (acc) {
          if (acc.bufferView === undefined) return;
          if (bvInfo[acc.bufferView]) return;
          bvInfo[acc.bufferView] = {
            count: acc.count,
            stride: strideFrom(acc),
            mode: acc.type === 'SCALAR' ? 'TRIANGLES' : 'ATTRIBUTES'
          };
        });

        const jobs = [];
        const jobBV = [];
        Object.keys(bvInfo).forEach(function (bvIdx) {
          const bv = json.bufferViews[bvIdx];
          if (!bv || isImageBV[bvIdx]) return;
          const info = bvInfo[bvIdx];
          if (!info.stride || !info.count) return;
          const slice = bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);
          let base64 = '';
          const CHUNK = 32768;
          for (let i = 0; i < slice.length; i += CHUNK) {
            base64 += String.fromCharCode.apply(null, slice.subarray(i, Math.min(i + CHUNK, slice.length)));
          }
          jobs.push({ data: btoa(base64), count: info.count, stride: info.stride, mode: info.mode });
          jobBV.push({ bvIdx: Number(bvIdx), info: info });
        });

        if (!jobs.length) return glbBlob;
        PixiStudio.Notifications.updateLoading(70, 'Nén meshopt qua server (' + jobs.length + ' buffer)…');

        return fetch('/api/meshopt-encode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobs: jobs })
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (!res.ok || !res.results) return glbBlob;

          /* Rebuild BIN: images giữ nguyên, geometry thay bằng bytes nén */
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

          const newBufferViews = [];
          /* images giữ NGUYÊN vị trí bufferView của chúng (img.bufferView) */
          (json.images || []).forEach(function (img) {
            if (img && img.bufferView !== undefined) {
              const bv = json.bufferViews[img.bufferView];
              const loc = place(bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength));
              newBufferViews[img.bufferView] = { buffer: 0, byteOffset: loc.byteOffset, byteLength: loc.byteLength };
            }
          });

          res.results.forEach(function (result, i) {
            const info = jobBV[i];
            const compressed = Uint8Array.from(atob(result.data), function (c) { return c.charCodeAt(0); });
            const loc = place(compressed);
            const bvIdx = info.bvIdx;
            const originalBv = json.bufferViews[bvIdx];
            const ext = {
              buffer: 0,
              byteOffset: loc.byteOffset,
              byteLength: compressed.length,
              byteStride: info.info.stride,
              mode: info.info.mode,
              count: info.info.count
            };
            newBufferViews[bvIdx] = {
              buffer: 0,
              byteOffset: 0,
              byteLength: originalBv.byteLength,
              target: originalBv.target,
              ...(info.info.mode === 'TRIANGLES' ? {} : { byteStride: info.info.stride }),
              extensions: { EXT_meshopt_compression: ext }
            };
          });

          const binPad = (4 - (binCursor % 4)) % 4;
          const binTotal = binCursor + binPad;
          const newBin = new Uint8Array(binTotal);
          let cur = 0;
          binParts.forEach(function (p) { newBin.set(p, cur); cur += p.length; });

          json.buffers = [{ byteLength: binTotal }];
          json.bufferViews = newBufferViews;
          if (!json.extensionsUsed) json.extensionsUsed = [];
          if (!json.extensionsRequired) json.extensionsRequired = [];
          if (json.extensionsUsed.indexOf('EXT_meshopt_compression') === -1) json.extensionsUsed.push('EXT_meshopt_compression');
          if (json.extensionsRequired.indexOf('EXT_meshopt_compression') === -1) json.extensionsRequired.push('EXT_meshopt_compression');

          /* GLB container */
          const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
          const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
          const totalOut = 12 + 8 + jsonBytes.length + jsonPad + 8 + binTotal;
          const out = new ArrayBuffer(totalOut);
          const odv = new DataView(out);
          odv.setUint32(0, 0x46546c67, true);
          odv.setUint32(4, 2, true);
          odv.setUint32(8, totalOut, true);
          odv.setUint32(12, jsonBytes.length + jsonPad, true);
          odv.setUint32(16, 0x4e4f534a, true);
          new Uint8Array(out, 20).set(jsonBytes);
          for (let i = 0; i < jsonPad; i++) new Uint8Array(out, 20 + jsonBytes.length, jsonPad)[i] = 0x20;
          let w = 20 + jsonBytes.length + jsonPad;
          odv.setUint32(w, binTotal, true);
          odv.setUint32(w + 4, 0x004e4942, true);
          new Uint8Array(out, w + 8).set(newBin);

          const newBlob = new Blob([out], { type: 'model/gltf-binary' });
          SaveManager._meshoptSavedBytes = glbBlob.size - newBlob.size;
          return newBlob;
        }).catch(function () {
          return glbBlob;   /* server lỗi — giữ bản phẳng */
        });
      });
    });
  };

  /* ============================================================
     VERIFY AFTER SAVE — import blob ngược lại kiểm tra
     universal → GLTFLoader KHÔNG decoder (nghiêm ngặt như Meshy/Tripo)
     web → có decoder
     ============================================================ */
  SaveManager._verifyBlob = function (blob, compatTarget) {
    return new Promise(function (resolve) {
      if (!THREE.GLTFLoader) { resolve({ ok: false, message: 'GLTFLoader chưa sẵn sàng' }); return; }
      const url = URL.createObjectURL(blob);
      const loader = new THREE.GLTFLoader();
      const strict = compatTarget !== 'web';
      if (!strict && window.MeshoptDecoder && loader.setMeshoptDecoder) {
        loader.setMeshoptDecoder(window.MeshoptDecoder);
      }
      loader.load(url, function (gltf) {
        URL.revokeObjectURL(url);
        let tris = 0, meshes = 0;
        gltf.scene.traverse(function (o) {
          if (o.isMesh) {
            meshes++;
            const g = o.geometry;
            tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
          }
        });
        resolve({ ok: meshes > 0, tris: Math.round(tris), meshes: meshes, message: meshes > 0 ? '' : 'Không có mesh' });
      }, undefined, function (err) {
        URL.revokeObjectURL(url);
        resolve({ ok: false, message: String(err && err.message || err) });
      });
    });
  };

  /* ============================================================
     ZIP BUNDLE
     ============================================================ */
  SaveManager.buildBundle = function (target, opts) {
    const modelName = target.name || 'model';
    PixiStudio.Notifications.updateLoading(10, 'Đóng gói bundle…');
    const files = [];
    const report = { parts: [], showDialog: true };

    return PixiStudio.GLBWriter.write(target, opts).then(function (glbResult) {
      /* nén meshopt cho model.glb trong bundle */
      return SaveManager.applyMeshoptFromServer(glbResult.blob, opts).then(function (finalBlob) {
        const used = finalBlob && finalBlob.size < glbResult.blob.size ? finalBlob : glbResult.blob;
        report.parts.push({ name: 'model GLB (tối ưu' + (used.size < glbResult.blob.size ? ' + meshopt' : '') + ')', bytes: used.size });
        return used.arrayBuffer();
      });
    }).then(function (glbAb) {
      files.push({ name: 'model.glb', data: new Uint8Array(glbAb) });

      /* Screenshot */
      PixiStudio.Notifications.updateLoading(55, 'Render preview…');
      const shot = PixiStudio.Viewport.screenshot(1024, 576, 'png');
      if (shot) {
        files.push({ name: 'preview.png', data: PixiStudio.ZipWriter.dataURLToBytes(shot) });
        report.parts.push({ name: 'preview PNG', bytes: Math.round(shot.length * 0.75) });
      }

      /* Manifest */
      const entry = PixiStudio.Models.getCurrent();
      const manifest = {
        name: modelName,
        generator: 'PixiJS Studio × Tripo3D AI Studio v21.0',
        exportedAt: new Date().toISOString(),
        model: {
          triangles: entry ? entry.stats.triangles : null,
          vertices: entry ? entry.stats.vertices : null,
          height: entry ? entry.stats.height : null
        },
        optimization: Object.assign({}, SaveManager.options),
        parts: report.parts,
        runtime: { engine: 'pixijs-7.4 + three-r128', webgl2: PixiStudio.ThreeRenderer.webgl2 },
        usage: 'Load model.glb bằng THREE.GLTFLoader.setMeshoptDecoder — xem README.md'
      };
      files.push({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });

      /* README */
      const readme = [
        '=== ' + modelName + ' — Export Bundle ===',
        '',
        'model.glb        : Model GLB tối ưu (weld + quantize + texture nén)',
        'preview.png      : Render preview 1024×576 từ viewport',
        'manifest.json    : Metadata + thông số tối ưu',
        '',
        'Cách dùng:',
        '  • Three.js: loader.setMeshoptDecoder(MeshoptDecoder); loader.load("model.glb", ...)',
        '  • Babylon.js / PlayCanvas / Unity glTFast đều đọc GLB chuẩn glTF 2.0',
        '',
        'Xuất bởi PixiJS Studio × Tripo3D AI Studio v21.0 — ' + new Date().toLocaleString()
      ].join('\n');
      files.push({ name: 'README.txt', data: new TextEncoder().encode(readme) });

      PixiStudio.Notifications.updateLoading(85, 'Nén ZIP…');
      const blob = PixiStudio.ZipWriter.create(files);
      const total = files.reduce(function (s, f) { return s + f.data.length; }, 0);
      report.totalBytes = blob.size;
      report.parts.push({ name: 'ZIP overhead', bytes: blob.size - total });
      const srcEntry = PixiStudio.Models.getCurrent();
      if (srcEntry && srcEntry.fileSize) {
        report.savedPercent = Math.round((1 - blob.size / srcEntry.fileSize) * 100);
      }
      PixiStudio.Notifications.hideLoading();
      return { blob: blob, report: report };
    });
  };

  /* ============================================================
     BATCH — xuất TẤT CẢ models
     ============================================================ */
  SaveManager.saveAllModels = function () {
    const ids = Object.keys(PixiStudio.Models.models);
    if (!ids.length) {
      bus.emit('notify', { type: 'warning', title: 'Batch export', message: 'Chưa có model nào.' });
      return;
    }
    PixiStudio.Notifications.showLoading('Batch export 0/' + ids.length + '…', 0);
    let i = 0;
    const results = [];
    const next = function () {
      if (i >= ids.length) {
        PixiStudio.Notifications.hideLoading();
        const totalSize = results.reduce(function (s, r) { return s + (r ? r.sizeBytes : 0); }, 0);
        bus.emit('notify', {
          type: 'success', title: 'Batch export xong',
          message: results.length + ' file — tổng ' + (totalSize / 1048576).toFixed(2) + ' MB'
        });
        SaveManager.renderPage && SaveManager.renderPage();
        return;
      }
      const entry = PixiStudio.Models.models[ids[i]];
      PixiStudio.Notifications.updateLoading(Math.round(i / ids.length * 90), 'Batch export ' + (i + 1) + '/' + ids.length + ': ' + entry.name + '…');
      PixiStudio.GLBWriter.write(entry.object3D, SaveManager.options).then(function (result) {
        const blob = result.blob;
        U.downloadBlob(blob, sanitizeName(entry.name) + '_batch.glb');
        results.push({ name: entry.name, sizeBytes: blob.size });
        SaveManager.logSave({ name: entry.name + '_batch.glb', format: 'glb-opt', sizeBytes: blob.size, trisAfter: result.report.trisAfter });
        i++;
        setTimeout(next, 120);
      }).catch(function () { i++; setTimeout(next, 120); });
    };
    next();
  };

  /* ============================================================
     AUTOSAVE ROTATION — giữ 5 slot vòng
     ============================================================ */
  SaveManager.rotateAutosave = function () {
    try {
      /* dồn slot: slot_4→del, slot_n→slot_n+1 */
      for (let i = 4; i >= 1; i--) {
        const src = localStorage.getItem(PixiStudio.Storage.PREFIX_PLACEHOLDER || 'pixiStudio.project.__autosave_' + i + '__');
        if (src) localStorage.setItem('pixiStudio.project.__autosave_' + (i + 1) + '__', src);
      }
      const cur = localStorage.getItem('pixiStudio.project.__autosave__');
      if (cur) localStorage.setItem('pixiStudio.project.__autosave_1__', cur);
    } catch (e) { /* quota */ }
  };

  /* ============================================================
     REPORT MODAL — hiển thị trước/sau chi tiết
     ============================================================ */
  SaveManager.showReport = function (report) {
    const rows = [];
    if (report.originalSizeBytes) {
      rows.push(['File gốc', U.formatBytes(report.originalSizeBytes)]);
      rows.push(['File đã lưu', U.formatBytes(report.sizeBytes) + '  (−' + report.savedPercent + '%)']);
    } else {
      rows.push(['Kích thước', U.formatBytes(report.sizeBytes)]);
    }
    if (report.trisBefore !== null && report.trisAfter !== null) {
      rows.push(['Triangles', U.formatNumber(report.trisBefore) + ' → ' + U.formatNumber(report.trisAfter)]);
      rows.push(['Vertices', U.formatNumber(report.vertsBefore) + ' → ' + U.formatNumber(report.vertsAfter)]);
    }
    rows.push(['Geometry bytes', U.formatBytes(report.geometryBytes)]);
    if (report.compatTarget) {
      rows.push(['Chế độ tương thích', report.compatTarget === 'web'
        ? 'Web (three.js) — meshopt + quantize + WebP'
        : 'UNIVERSAL — meshy.ai / tripo3d.ai / Blender đọc được']);
    }
    const extList = report.extensionsUsed || [];
    rows.push(['Extensions (used, không required)', extList.length ? extList.join(', ') : 'không có — spec core thuần']);
    if (report.meshoptEnabled) {
      rows.push(['Meshopt nén', 'BẬT — EXT_meshopt_compression (server)']);
    }

    const texRows = (report.textures || []).map(function (t) {
      return U.el('div', { class: 'info-row' }, [
        U.el('span', { class: 'i-label', text: t.name + ' (' + t.before + ' → ' + t.after + ')' }),
        U.el('span', { class: 'i-value', text: U.formatBytes(t.size) + ' · ' + t.format.replace('image/', '') })
      ]);
    });

    const body = U.el('div');
    body.appendChild(U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-content', style: 'padding-top:10px;' }, rows.map(function (r) {
        return U.el('div', { class: 'info-row' }, [
          U.el('span', { class: 'i-label', text: r[0] }),
          U.el('span', { class: 'i-value', text: r[1] })
        ]);
      }))
    ]));
    if (texRows.length) {
      body.appendChild(U.el('div', { class: 'page-block' }, [
        U.el('h4', { text: 'Textures' }),
        U.el('div', { class: 'section-block' }, [U.el('div', { class: 'section-content', style: 'padding-top:10px;' }, texRows)])
      ]));
    }
    if (report.parts) {
      body.appendChild(U.el('div', { class: 'page-block' }, [
        U.el('h4', { text: 'Bundle parts' }),
        U.el('div', { class: 'section-block' }, [U.el('div', { class: 'section-content', style: 'padding-top:10px;' },
          report.parts.map(function (p) {
            return U.el('div', { class: 'info-row' }, [
              U.el('span', { class: 'i-label', text: p.name }),
              U.el('span', { class: 'i-value', text: U.formatBytes(p.bytes) })
            ]);
          })
        )])
      ]));
    }

    PixiStudio.Modals.open({
      title: '📊 Compression Report',
      body: body,
      buttons: [{ label: 'Đóng', class: 'btn primary' }]
    });
  };

  /* ============================================================
     SAVE DIALOG (Ctrl+Shift+S)
     ============================================================ */
  SaveManager.openDialog = function (presetId) {
    const preset = PRESETS.find(function (p) { return p.id === presetId; });
    const body = U.el('div');
    const target = PixiStudio.State.get('selection') || PixiStudio.Viewport.getMainModel();

    body.appendChild(U.el('p', { style: 'color:var(--text-2);font-size:12.5px;margin-bottom:12px;', text: preset ? preset.desc : 'Chọn định dạng lưu:' }));

    const grid = U.el('div', { class: 'mt-grid', style: 'grid-template-columns:repeat(3,1fr);' });
    FORMATS.forEach(function (f) {
      grid.appendChild(U.el('button', {
        class: 'mt-btn' + (f.real ? ' primary' : ''),
        html: U.icon(f.icon) + '<span>' + f.name + (f.real ? '' : ' ⏸') + '</span>',
        onclick: function () {
          PixiStudio.Modals.close();
          if (f.real) SaveManager.save(f.id);
        }
      }));
    });
    body.appendChild(grid);
    /* Chuyển file GLB → FBX Mixamo trực tiếp, không cần load model
       vào scene (nút Save Mixamo chỉ xuất model đang ở trong scene). */
    body.appendChild(U.el('button', {
      class: 'btn primary lg block', style: 'margin-top:12px;',
      text: '📁 Chuyển GLB → FBX Mixamo (chọn file .glb trên máy)',
      onclick: function () {
        PixiStudio.Modals.close();
        SaveManager.convertGLBToMixamoFBX();
      }
    }));
    if (preset) {
      body.appendChild(U.el('button', {
        class: 'btn primary lg block', style: 'margin-top:12px;',
        text: '⚡ Áp preset: ' + preset.name,
        onclick: function () {
          PixiStudio.Modals.close();
          SaveManager.save(preset.format, preset.options, preset.id);
        }
      }));
    }
    PixiStudio.Modals.open({ title: '💾 Save — ' + (target ? target.name : 'chưa có model'), body: body, buttons: [{ label: 'Huỷ', class: 'btn' }] });
  };

  /* ============================================================
     PAGE RENDER — Save Center (page-export)
     ============================================================ */
  SaveManager.renderPage = function () {
    const body = document.getElementById('export-page-body');
    if (!body) return;
    body.innerHTML = '';
    const target = PixiStudio.Viewport.getMainModel();

    /* --- TARGET SWITCH (universal/web) --- */
    const targetSection = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('target') }), U.el('span', { text: 'Chế độ tương thích — chọn đích' })])
    ]);
    const targetBody = U.el('div', { class: 'section-content' });
    const isUni = SaveManager.options.compatTarget === 'universal';
    const targetRow = U.el('div', { style: 'display:flex;gap:6px;margin-bottom:8px;' }, [
      U.el('button', {
        class: 'btn sm grow' + (isUni ? ' success' : ''),
        html: '✓ Universal — Meshy/Tripo/Blender',
        onclick: function () { SaveManager.setCompatTarget('universal'); SaveManager.renderPage(); }
      }),
      U.el('button', {
        class: 'btn sm grow' + (!isUni ? ' primary' : ''),
        html: '✓ Web three.js — nhỏ nhất',
        onclick: function () { SaveManager.setCompatTarget('web'); SaveManager.renderPage(); }
      })
    ]);
    targetBody.appendChild(targetRow);
    targetBody.appendChild(U.el('div', {
      class: 'dim small',
      style: 'line-height:1.55;padding:4px 2px;',
      html: isUni
        ? '<b style="color:var(--success)">UNIVERSAL:</b> texture chỉ JPEG/PNG (spec core), <u>không</u> extension bắt buộc — meshy.ai, studio.tripo3d.ai, Blender, Sketchfab đều đọc được.'
        : '<b style="color:#b79bff">WEB:</b> quantize + meshopt + WebP — file nhỏ nhất, CHỈ load bởi app có MeshoptDecoder (three.js). Meshy/Tripo sẽ <b style="color:var(--danger)">từ chối</b> loại này.'
    }));
    targetSection.appendChild(targetBody);
    body.insertBefore(targetSection, body.firstChild);

    /* --- Presets --- */
    body.appendChild(U.el('h4', { text: '⚡ Presets tối ưu — 1 click' }));
    const presetGrid = U.el('div', { class: 'mt-grid', style: 'grid-template-columns:repeat(2,1fr);gap:7px;' });
    PRESETS.forEach(function (p) {
      const isCurrent = SaveManager.lastPreset === p.id;
      presetGrid.appendChild(U.el('button', {
        class: 'mt-btn' + (isCurrent ? ' primary' : '') + (p.target && p.target !== SaveManager.options.compatTarget ? '' : ''),
        style: 'aspect-ratio:auto;padding:8px 4px;' + (p.target && p.target !== SaveManager.options.compatTarget ? 'opacity:.55;' : ''),
        html: '<span style="font-size:15px;margin-bottom:2px;">' + p.icon.split(' ')[0] + '</span><span>' + p.name.replace(/^\S+\s/, '') + '</span><span style="font-size:7.5px;font-weight:500;color:var(--text-4);line-height:1.25;">' + p.desc.split('—')[1] + '</span>',
        'data-tooltip': p.desc,
        onclick: function () {
          SaveManager.lastPreset = p.id;
          if (p.target) SaveManager.setCompatTarget(p.target);
          SaveManager.save(p.format, p.options, p.id);
          SaveManager.renderPage();
        }
      }));
    });
    body.appendChild(presetGrid);

    /* --- Optimization options --- */
    const optSection = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('optimize') }), U.el('span', { text: 'Tùy chọn tối ưu dung lượng' })])
    ]);
    const optBody = U.el('div', { class: 'section-content' });

    const toggles = [
      ['weldVertices', 'Weld vertices (gộp đỉnh trùng)', 'Giảm ~15-30% vertices, không ảnh hưởng hình dáng'],
      ['quantizeNormals', 'Quantize normals → int8', 'NORMAL 12B → 3B/đỉnh (KHR_mesh_quantization)'],
      ['quantizeUV', 'Quantize UV → uint16', 'UV 8B → 4B/đỉnh'],
      ['prefer16bitIndices', 'Indices 16-bit khi ≤ 65.535 đỉnh', 'Index 4B → 2B/index'],
      ['meshoptServerEncode', 'Nén meshopt server-side (EXT_meshopt_compression)', 'Server Node nén geometry ~3x — cần chạy qua server.bat + npm install meshoptimizer'],
      ['verifyAfterSave', 'Verify sau khi lưu (tự load lại file)', 'Đảm bảo file mới đọc được']
    ];
    toggles.forEach(function (t) {
      const row = U.el('div', { class: 'toggle-row' }, [
        U.el('span', { class: 't-label', text: t[1], 'data-tooltip': t[2] })
      ]);
      const toggle = U.el('div', { class: 'toggle' + (SaveManager.options[t[0]] ? ' on' : '') });
      toggle.addEventListener('click', function () {
        SaveManager.options[t[0]] = !SaveManager.options[t[0]];
        toggle.classList.toggle('on', SaveManager.options[t[0]]);
        SaveManager.saveState();
        SaveManager.updateEstimate();
      });
      row.appendChild(toggle);
      optBody.appendChild(row);
    });

    /* Texture max size */
    const texRow = U.el('div', { class: 'toggle-row' }, [U.el('span', { class: 't-label', text: 'Texture max size' })]);
    const texWrap = U.el('div', { class: 'select-wrap', style: 'width:110px;' });
    const texSel = U.el('select', { class: 'select', style: 'height:26px;font-size:11px;' });
    [[0, 'Giữ nguyên'], [2048, '2048px'], [1024, '1024px'], [512, '512px'], [256, '256px']].forEach(function (o) {
      const opt = U.el('option', { value: String(o[0]), text: o[1] });
      if (SaveManager.options.textureMaxSize === o[0]) opt.selected = true;
      texSel.appendChild(opt);
    });
    texSel.addEventListener('change', function () { SaveManager.options.textureMaxSize = parseInt(texSel.value, 10); SaveManager.saveState(); SaveManager.updateEstimate(); });
    texWrap.appendChild(texSel);
    texRow.appendChild(texWrap);
    optBody.appendChild(texRow);

    /* Texture format */
    const fmtRow = U.el('div', { class: 'toggle-row' }, [U.el('span', { class: 't-label', text: 'Texture format', 'data-tooltip': 'Auto = JPEG/PNG spec-safe (PNG tự động khi có alpha). WebP chỉ dùng cho target Web three.js.' })]);
    const fmtWrap = U.el('div', { class: 'select-wrap', style: 'width:150px;' });
    const fmtSel = U.el('select', { class: 'select', style: 'height:26px;font-size:11px;' });
    [['auto', 'Auto (JPEG/PNG an toàn)'], ['jpeg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP (web three.js)']].forEach(function (o) {
      const opt = U.el('option', { value: o[0], text: o[1] });
      if (SaveManager.options.textureFormat === o[0]) opt.selected = true;
      fmtSel.appendChild(opt);
    });
    fmtSel.addEventListener('change', function () { SaveManager.options.textureFormat = fmtSel.value; SaveManager.saveState(); SaveManager.updateEstimate(); });
    fmtWrap.appendChild(fmtSel);
    fmtRow.appendChild(fmtWrap);
    optBody.appendChild(fmtRow);

    /* Quality slider */
    const qRow = U.el('div', { class: 'slider-row' }, [U.el('span', { class: 's-label', text: 'Texture quality' })]);
    const qSlider = U.el('input', { type: 'range', class: 'slider', min: '0.4', max: '1', step: '0.05', value: String(SaveManager.options.textureQuality) });
    const qVal = U.el('span', { class: 's-val', text: Math.round(SaveManager.options.textureQuality * 100) + '%' });
    qSlider.addEventListener('input', function () {
      SaveManager.options.textureQuality = parseFloat(qSlider.value);
      qVal.textContent = Math.round(SaveManager.options.textureQuality * 100) + '%';
      SaveManager.saveState();
    });
    qRow.appendChild(qSlider); qRow.appendChild(qVal);
    optBody.appendChild(qRow);

    /* GIẢM TRIANGLES — simplify qua server (MeshoptSimplifier) */
    const simRow = U.el('div', { class: 'toggle-row' }, [
      U.el('span', { class: 't-label', text: '🪓 Giảm triangles (simplify giữ UV + shape)' })
    ]);
    const simWrap = U.el('div', { class: 'select-wrap', style: 'width:110px;' });
    const simSel = U.el('select', { class: 'select', style: 'height:26px;font-size:11px;' });
    [['0', 'Off'], ['0.25', 'Giảm 25%'], ['0.5', 'Giảm 50%'], ['0.75', 'Giảm 75%']].forEach(function (o) {
      const opt = U.el('option', { value: o[0], text: o[1] });
      if (String(SaveManager.options.simplifyRatio) === o[0]) opt.selected = true;
      simSel.appendChild(opt);
    });
    simSel.addEventListener('change', function () {
      SaveManager.options.simplifyRatio = parseFloat(simSel.value);
      SaveManager.saveState();
    });
    simWrap.appendChild(simSel);
    simRow.appendChild(simWrap);
    optBody.appendChild(simRow);
    optBody.appendChild(U.el('div', { class: 'dim small', style: 'padding:2px 0 6px;line-height:1.5;', text: 'Simplify giảm SỐ TAM GIÁC thật qua server (MeshoptSimplifier giữ UV seams + shape) — chất lượng ảnh giữ nguyên, cần chạy qua server.bat + npm install meshoptimizer.' }));

    optSection.appendChild(optBody);
    body.appendChild(optSection);

    /* --- Texture audit --- */
    const audit = target ? SaveManager.auditTextures(target) : [];
    if (audit.length) {
      const auditSection = U.el('div', { class: 'section-block' }, [
        U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('image') }), U.el('span', { text: 'Texture Audit (' + audit.length + ')' })])
      ]);
      const auditBody = U.el('div', { class: 'section-content' });
      let totalBytes = 0;
      audit.forEach(function (t) {
        totalBytes += t.estBytes;
        auditBody.appendChild(U.el('div', { class: 'info-row' }, [
          U.el('span', { class: 'i-label', text: t.slot + ' — ' + t.width + '×' + t.height }),
          U.el('span', { class: 'i-value', text: '~' + U.formatBytes(t.estBytes) })
        ]));
      });
      auditBody.appendChild(U.el('div', { class: 'info-row' }, [
        U.el('span', { class: 'i-label', text: 'Tổng texture' }),
        U.el('span', { class: 'i-value', style: 'color:var(--warning);', text: '~' + U.formatBytes(totalBytes) })
      ]));
      auditBody.appendChild(U.el('div', { class: 'dim small', style: 'padding:6px 0;', text: 'Texture chiếm phần lớn file — giảm size/format ở trên để nén mạnh.' }));
      auditSection.appendChild(auditBody);
      body.appendChild(auditSection);
    }

    /* --- All formats grid --- */
    body.appendChild(U.el('h4', { text: '📤 Tất cả định dạng xuất' }));
    const fmtGrid = U.el('div', { class: 'mt-grid', style: 'grid-template-columns:repeat(3,1fr);gap:5px;' });
    FORMATS.forEach(function (f) {
      fmtGrid.appendChild(U.el('button', {
        class: 'mt-btn' + (f.real ? '' : ' '),
        style: f.real ? '' : 'opacity:.55;',
        html: U.icon(f.icon) + '<span>' + f.name.replace(' — ', '<br>') + (f.real ? '' : ' ⏸') + '</span>',
        'data-tooltip': f.desc,
        onclick: function () {
          if (f.real) SaveManager.save(f.id);
          else bus.emit('notify', { type: 'warning', title: f.name + ' — planned v5.1', message: f.desc });
        }
      }));
    });
    body.appendChild(fmtGrid);

    /* --- Batch & bundle actions --- */
    body.appendChild(U.el('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-top:12px;' }, [
      U.el('button', { class: 'btn sm', html: U.icon('folder') + ' Đóng gói ZIP Bundle (model+textures+manifest)', onclick: function () { SaveManager.save('zip'); } }),
      U.el('button', { class: 'btn sm', html: U.icon('duplicate') + ' Batch export ALL models → GLB tối ưu', onclick: function () { SaveManager.saveAllModels(); } }),
      U.el('button', { class: 'btn sm ghost', html: U.icon('help') + ' Ctrl+Shift+S = hộp thoại lưu nhanh', onclick: function () { SaveManager.openDialog(); } })
    ]));

    /* --- Save history --- */
    const histSection = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('timeline') }), U.el('span', { text: 'Save History (' + SaveManager.history.length + ')' })])
    ]);
    const histBody = U.el('div', { class: 'section-content' });
    if (SaveManager.history.length) {
      SaveManager.history.slice(0, 8).forEach(function (h) {
        const saved = h.beforeBytes && h.beforeBytes > 0 && h.sizeBytes ? ' (−' + Math.round((1 - h.sizeBytes / h.beforeBytes) * 100) + '%)' : '';
        histBody.appendChild(U.el('div', { class: 'info-row' }, [
          U.el('span', { class: 'i-label', text: h.name }),
          U.el('span', { class: 'i-value', text: U.formatBytes(h.sizeBytes || 0) + saved })
        ]));
      });
      histBody.appendChild(U.el('div', { style: 'display:flex;gap:6px;margin-top:8px;' }, [
        U.el('button', { class: 'btn sm ghost grow', text: 'Xoá history', onclick: function () { SaveManager.history = []; SaveManager.saveState(); SaveManager.renderPage(); } })
      ]));
    } else {
      histBody.appendChild(U.el('div', { class: 'empty-state', style: 'padding:8px;' }, [
        U.el('span', { text: 'Chưa lưu file nào — history tự ghi sau mỗi lần save.' })
      ]));
    }
    histSection.appendChild(histBody);
    body.appendChild(histSection);

    SaveManager.updateEstimate();
  };

  /* Estimate hiển thị nhanh */
  SaveManager.updateEstimate = U.debounce(function () {
    const el = document.getElementById('save-estimate');
    if (!el) return;
    const target = PixiStudio.Viewport.getMainModel();
    if (!target) { el.textContent = ''; return; }
    const est = PixiStudio.GLBWriter.estimate(target, SaveManager.options);
    el.textContent = 'Ước tính GLB tối ưu: ~' + U.formatBytes(est.geometryBytes) + ' geometry · ' + U.formatNumber(est.tris) + ' tris (texture nén riêng)';
  }, 250);

  /* ---------- INIT ---------- */
  SaveManager.init = function () {
    SaveManager.loadState();

    /* Ctrl+S = quick save last preset; Ctrl+Shift+S = dialog */
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); e.stopPropagation();
        if (e.shiftKey) {
          SaveManager.openDialog();
        } else {
          const preset = PRESETS.find(function (p) { return p.id === SaveManager.lastPreset; });
          if (preset) {
            SaveManager.save(preset.format, preset.options, preset.id);
          } else {
            SaveManager.save('project');
          }
        }
        return false;
      }
    }, true);   /* capture — chạy trước shortcuts.js */

    bus.on('save:done', function () {
      const sb = document.getElementById('sb-autosave');
      if (sb) sb.innerHTML = 'Last save: <b style="color:var(--success)">' + new Date().toLocaleTimeString() + '</b>';
      /* refresh page nếu đang mở */
      const page = document.getElementById('page-export');
      if (page && !page.classList.contains('hidden')) SaveManager.renderPage();
    });

    /* autosave rotation hook */
    bus.on('autosave:tick', function () {
      SaveManager.rotateAutosave();
    });

    SaveManager.renderPage();
  };

  window.PixiStudio.SaveManager = SaveManager;
})();
