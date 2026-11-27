/* ============================================================
 * rig/arp-export.js — TAB EXPORT (PHẦN B của "Auto Rig Pro Blend")
 *
 * Mở rộng xuất của AutoRigPro (FBX rigged + .py Blender):
 *   • Format FBX 6100/7300/7400/7500 + Binary/ASCII (xem VERSIONS)
 *   • Preset: Unity, Unreal, Mixamo, Blender, Maya, 3ds Max, Godot
 *     + preset riêng lưu localStorage (pixistudio.arp-export-presets)
 *   • Xương/skin: giữ/bỏ skeleton, giữ/bỏ skin, giới hạn influence
 *     mỗi đỉnh (1–8), chuẩn hóa weight, bind pose, đổi tên xương
 *   • Animation: chọn clip, bake (24/30/60 fps), root motion,
 *     loop/once, rút gọn keyframe theo tolerance
 *   • Mesh: decimate (MeshoptSimplifier vendored), weld, tính lại
 *     normal, triangulate, LOD (xuất thêm bản low-poly)
 *   • Texture: nhúng/rời, cỡ 256–4096, JPEG/PNG, quality, chọn slot
 *   • Preflight: chặn lỗi nặng, cảnh báo lỗi nhẹ (theo preset đích)
 *   • Batch + lịch sử xuất (localStorage, nút Tải lại)
 *   • .py Blender mở rộng theo preset đã chọn
 *
 * GIỚI HẠN TRUNG THỰC (đọc trước khi dùng):
 *   • Writer là FBXBinary tự viết của studio, KHÔNG phải SDK Autodesk:
 *     - Binary chỉ hỗ trợ THẬT 7300/7400. 6100 → fallback 7300,
 *       7500 → fallback 7400 (ghi rõ trong report, không bịa version).
 *       ASCII luôn là 7300 (FBX 2013) bất kể version chọn.
 *     - File xuất ra LUÔN Y-up (writer bake trục dọc về +Y, chân y=0).
 *       Preset ghi up-axis danh nghĩa (vd Blender/3ds Max là Z-up)
 *       chỉ để hiển thị + đưa vào .py (Blender import axis_up);
 *       writer KHÔNG có tùy chọn forward axis riêng.
 *     - UnitScaleFactor trong file luôn là 100 (cm) do writer ghi cứng;
 *       scale preset chỉ đổi autoScale/scaleFactor (bake vào geometry).
 *     - Không hỗ trợ constraints, custom properties phức tạp, morph
 *       target, blend shape, IK/FK rig, hay NURBS của FBX gốc.
 *   • GLB vẫn qua GLTFExporter r128 (CDN) — cần mạng/CDN đã load.
 *   • Decimate cần MeshoptSimplifier (js/vendor/meshopt_simplifier.js,
 *     WebAssembly) — dùng exportFBXAsync/exportFile (Promise); bản
 *     đồng bộ exportFBX trả lỗi rõ nếu meshopt chưa sẵn sàng.
 *   • Bind pose T/A chỉ áp khi rig lưu sẵn pose đó (target.userData
 *     .arpPoses); AutoRigPro không lưu pose → báo và giữ tư thế hiện tại.
 *   • Retarget chỉ map theo tên xương (xem arp-remap.js).
 * ============================================================ */
(function () {
  'use strict';

  var bus = PixiStudio.bus;
  var U = PixiStudio.Utils;

  /* ---------- FBX version: writer chỉ hỗ trợ THẬT 7300/7400 ---------- */
  var SUPPORTED_VERSIONS = [7300, 7400];
  var VERSION_LABELS = { 6100: 'FBX 2011 (6.1)', 7300: 'FBX 2013 (7.3)', 7400: 'FBX 2014 (7.4)', 7500: 'FBX 2016 (7.5)' };
  function resolveVersion(requested, ascii) {
    var req = parseInt(requested, 10);
    if (ascii) {
      return { version: 7300, requested: isFinite(req) ? req : 7300, fallback: 'ASCII luôn dùng FBX 7300 (7.3) — writer ASCII chỉ hỗ trợ 7300.' };
    }
    if (!isFinite(req)) return { version: 7300, requested: 7300, fallback: '' };
    if (req === 7300 || req === 7400) return { version: req, requested: req, fallback: '' };
    if (req === 6100) return { version: 7300, requested: 6100, fallback: 'Writer không hỗ trợ FBX 6100 — fallback về 7300 (gần nhất).' };
    if (req === 7500) return { version: 7400, requested: 7500, fallback: 'Writer không hỗ trợ FBX 7500 — fallback về 7400 (gần nhất).' };
    var near = req <= 7350 ? 7300 : 7400;
    return { version: near, requested: req, fallback: 'Writer chỉ hỗ trợ 7300/7400 — fallback về ' + near + '.' };
  }

  /* ---------- Preset đích ----------
     upAxis/forwardAxis: quy ước DANH NGHĨA của phần mềm đích (để hiển
     thị + đưa vào .py). File FBX xuất ra luôn Y-up do writer bake
     (xem header). scaleMode: 'auto' = autoScale về ~1.8 đơn vị;
     'keep' = giữ nguyên kích thước scene. */
  var PRESETS = {
    unity: {
      id: 'unity', label: 'Unity',
      version: 7300, format: 'binary', upAxis: 'Y', forwardAxis: '-Z',
      scaleMode: 'auto', autoScale: true, scaleFactor: 1,
      keepPrefix: true, stripPrefix: false, swapLR: false,
      noSkeleton: false, keepSkin: true, embedTextures: true,
      limits: { warnTris: 100000 },
      changes: 'FBX 7300 Binary · Y-up · autoScale về ~1.8m · giữ skeleton 41 xương tên mixamorig: · texture nhúng.',
      note: 'Mở trực tiếp trong Unity — Rig Type: Humanoid (xương đã đúng tên Mixamo).'
    },
    unreal: {
      id: 'unreal', label: 'Unreal',
      version: 7400, format: 'binary', upAxis: 'Y', forwardAxis: '-Z',
      scaleMode: 'keep', autoScale: false, scaleFactor: 1,
      keepPrefix: true, stripPrefix: false, swapLR: false,
      noSkeleton: false, keepSkin: true, embedTextures: true,
      limits: { warnTris: 100000 },
      changes: 'FBX 7400 Binary · Y-up · KHÔNG autoScale (giữ đúng kích thước gốc trong scene) · giữ skeleton 41 xương tên mixamorig: · texture nhúng.',
      note: 'Preset này CHỈ đổi up-axis/autoScale, KHÔNG rescale cm→m. Khi import vào Unreal, đặt Import Uniform Scale theo ý nếu model gốc theo cm.'
    },
    mixamo: {
      id: 'mixamo', label: 'Mixamo (mesh-only)',
      version: 7300, format: 'binary', upAxis: 'Y', forwardAxis: '-Z',
      scaleMode: 'auto', autoScale: true, scaleFactor: 1,
      keepPrefix: false, stripPrefix: true, swapLR: false,
      noSkeleton: true, keepSkin: false, embedTextures: true, mixamoNames: true,
      limits: { maxTris: 50000 },
      changes: 'FBX 7300 Binary · MESH-ONLY: 0 xương / 0 skin · tên kiểu Mixamo · texture nhúng (chỉ map + normal) · autoScale về ~1.8m.',
      note: '⚠ File này dùng để UPLOAD LÊN mixamo.com tự auto-rig — KHÔNG phải file rigged, mở trong Blender/Unity sẽ không có skeleton. Mixamo chặn file > 50.000 tris.'
    },
    blender: {
      id: 'blender', label: 'Blender',
      version: 7400, format: 'binary', upAxis: 'Z', forwardAxis: '-Y',
      scaleMode: 'keep', autoScale: false, scaleFactor: 1,
      keepPrefix: true, stripPrefix: false, swapLR: false,
      noSkeleton: false, keepSkin: true, embedTextures: true,
      limits: { warnTris: 200000 },
      changes: 'FBX 7400 Binary · giữ đúng kích thước gốc · giữ skeleton 41 xương tên mixamorig: · texture nhúng · kèm .py import đúng axis (forward -Y, up Z).',
      note: 'Blender dùng Z-up trong viewport; file FBX vẫn Y-up (writer bake), Blender tự đổi khi import — .py đi kèm đặt sẵn axis_forward/axis_up.'
    },
    maya: {
      id: 'maya', label: 'Maya',
      version: 7400, format: 'binary', upAxis: 'Y', forwardAxis: '-Z',
      scaleMode: 'auto', autoScale: true, scaleFactor: 1,
      keepPrefix: true, stripPrefix: false, swapLR: false,
      noSkeleton: false, keepSkin: true, embedTextures: true,
      limits: { warnTris: 200000 },
      changes: 'FBX 7400 Binary · Y-up · autoScale về ~1.8 đơn vị · giữ skeleton 41 xương tên mixamorig: · texture nhúng.',
      note: 'Maya đọc FBX 7400 trực tiếp; đơn vị cm trong Maya ≈ đơn vị file ×100 do UnitScaleFactor=100 của writer.'
    },
    '3dsmax': {
      id: '3dsmax', label: '3ds Max',
      version: 7400, format: 'binary', upAxis: 'Z', forwardAxis: '-Y',
      scaleMode: 'keep', autoScale: false, scaleFactor: 1,
      keepPrefix: true, stripPrefix: false, swapLR: false,
      noSkeleton: false, keepSkin: true, embedTextures: true,
      limits: { warnTris: 200000 },
      changes: 'FBX 7400 Binary · giữ đúng kích thước gốc · giữ skeleton 41 xương tên mixamorig: · texture nhúng.',
      note: '3ds Max dùng Z-up; file FBX vẫn Y-up (writer bake), Max tự đổi khi import (System Unit Setup).'
    },
    godot: {
      id: 'godot', label: 'Godot',
      version: 7300, format: 'binary', upAxis: 'Y', forwardAxis: '-Z',
      scaleMode: 'keep', autoScale: false, scaleFactor: 1,
      keepPrefix: true, stripPrefix: false, swapLR: false,
      noSkeleton: false, keepSkin: true, embedTextures: true,
      limits: { warnTris: 100000 },
      changes: 'FBX 7300 Binary · Y-up · giữ đúng kích thước gốc · giữ skeleton 41 xương tên mixamorig: · texture nhúng.',
      note: 'Godot khuyên dùng GLB hơn FBX (FBX qua importer ngoài, có thể lệch skin) — nếu Godot lỗi thì xuất GLB ở cùng tab này.'
    }
  };
  var PRESET_IDS = ['unity', 'unreal', 'mixamo', 'blender', 'maya', '3dsmax', 'godot'];

  var PRESETS_KEY = 'pixistudio.arp-export-presets';
  var HISTORY_KEY = 'pixistudio.arp-export-history';
  var HISTORY_MAX = 10;
  var HISTORY_MAX_BYTES = 1000000;   /* chỉ lưu bytes khi file ≤ 1MB */

  var ArpExport = {
    PRESETS: PRESETS,
    PRESET_IDS: PRESET_IDS,
    SUPPORTED_VERSIONS: SUPPORTED_VERSIONS,
    lastResult: null,
    lastFormat: 'fbx',
    lastPreset: 'unity'
  };

  function notify(type, title, message, duration) {
    if (bus && bus.emit) bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 });
  }

  function sanitizeName(name) {
    return String(name || 'model').replace(/\.(glb|gltf|fbx|obj|stl)$/i, '')
      .replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'model';
  }

  function getTarget(target) {
    if (target) return target;
    if (PixiStudio.State && PixiStudio.State.get) {
      var sel = PixiStudio.State.get('selection');
      if (sel) return sel;
    }
    if (PixiStudio.Viewport && PixiStudio.Viewport.getMainModel) return PixiStudio.Viewport.getMainModel();
    return null;
  }

  function getModelName(target, opts) {
    if (opts && opts.modelName) return sanitizeName(opts.modelName);
    if (PixiStudio.Models && PixiStudio.Models.current && PixiStudio.Models.current.name) return sanitizeName(PixiStudio.Models.current.name);
    if (target && target.name) return sanitizeName(target.name);
    return 'model';
  }

  /* ---------- localStorage an toàn (jsdom / trình duyệt chặn) ---------- */
  function lsGet(key) {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(key);
    } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(key, value);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- Custom preset (localStorage) ---------- */
  function listCustomPresets() {
    try {
      var raw = lsGet(PRESETS_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      return Object.keys(obj);
    } catch (e) { return []; }
  }
  ArpExport.listCustomPresets = listCustomPresets;

  function loadCustomPreset(name) {
    try {
      var raw = lsGet(PRESETS_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      return obj[name] || null;
    } catch (e) { return null; }
  }
  ArpExport.loadCustomPreset = loadCustomPreset;

  function saveCustomPreset(name, preset) {
    name = String(name || '').trim();
    if (!name) return { ok: false, error: 'Tên preset trống.' };
    if (PRESETS[name]) return { ok: false, error: 'Tên "' + name + '" trùng preset có sẵn.' };
    var obj = {};
    try { obj = JSON.parse(lsGet(PRESETS_KEY) || '{}'); } catch (e) { obj = {}; }
    var copy = JSON.parse(JSON.stringify(preset || {}));
    copy.id = name;
    copy.custom = true;
    obj[name] = copy;
    if (!lsSet(PRESETS_KEY, JSON.stringify(obj))) return { ok: false, error: 'Không ghi được localStorage.' };
    return { ok: true, name: name };
  }
  ArpExport.saveCustomPreset = saveCustomPreset;

  function deleteCustomPreset(name) {
    var obj = {};
    try { obj = JSON.parse(lsGet(PRESETS_KEY) || '{}'); } catch (e) { obj = {}; }
    if (!obj[name]) return false;
    delete obj[name];
    return lsSet(PRESETS_KEY, JSON.stringify(obj));
  }
  ArpExport.deleteCustomPreset = deleteCustomPreset;

  /* Resolve preset: id built-in | tên custom | object preset. Trả về bản
     clone đầy đủ field (thiếu field nào thì lấy mặc định của Unity). */
  function resolvePreset(preset) {
    var base = JSON.parse(JSON.stringify(PRESETS.unity));
    var found = null;
    if (!preset) found = PRESETS.unity;
    else if (typeof preset === 'string') found = PRESETS[preset] || loadCustomPreset(preset);
    else if (typeof preset === 'object') found = preset;
    if (!found) return { preset: base, unknown: true };
    var merged = JSON.parse(JSON.stringify(base));
    Object.keys(found).forEach(function (k) { merged[k] = found[k]; });
    if (!merged.limits) merged.limits = {};
    return { preset: merged, unknown: false };
  }
  ArpExport.resolvePreset = resolvePreset;

  /* Gộp opts người dùng lên preset → options đầy đủ cho pipeline. */
  function resolveOptions(opts) {
    opts = opts || {};
    var rp = resolvePreset(opts.preset);
    var p = rp.preset;
    var o = {
      preset: p.id || 'unity',
      presetDef: p,
      unknownPreset: rp.unknown,
      format: opts.format === 'glb' ? 'glb' : 'fbx',
      version: (opts.version !== undefined && opts.version !== null) ? opts.version : p.version,
      ascii: !!opts.ascii || p.format === 'ascii',
      modelName: opts.modelName || null,
      keepSkeleton: (opts.keepSkeleton !== undefined) ? !!opts.keepSkeleton : !p.noSkeleton,
      keepSkeletonRequested: opts.keepSkeleton,
      keepSkin: (opts.keepSkin !== undefined) ? !!opts.keepSkin : !!p.keepSkin,
      keepSkinRequested: opts.keepSkin,
      maxInfluences: (opts.maxInfluences !== undefined) ? (opts.maxInfluences | 0) : 4,
      normalizeWeights: opts.normalizeWeights !== false,
      bindPose: opts.bindPose || 'current',
      rename: opts.rename || null,
      scaleFactor: (typeof opts.scaleFactor === 'number' && isFinite(opts.scaleFactor) && opts.scaleFactor > 0) ? opts.scaleFactor : (p.scaleFactor || 1),
      autoScale: (opts.autoScale !== undefined) ? !!opts.autoScale : !!p.autoScale,
      clips: opts.clips || null,
      animationSelection: opts.animationSelection || 'all',
      selectedClipIds: opts.selectedClipIds || null,
      bakeFps: (opts.bakeFps !== undefined) ? (+opts.bakeFps || 0) : 0,
      rootMotion: opts.rootMotion !== false,
      loop: opts.loop || 'loop',
      reduceTolerance: (typeof opts.reduceTolerance === 'number') ? opts.reduceTolerance : 0,
      mesh: opts.mesh || {},
      lod: opts.lod || null,
      texture: opts.texture || {},
      embedTextures: (opts.embedTextures !== undefined) ? !!opts.embedTextures : (opts.texture && opts.texture.embed !== undefined ? !!opts.texture.embed : !!p.embedTextures),
      externalTextures: !!(opts.texture && opts.texture.embed === false)
    };
    if (o.preset === 'mixamo') { /* KHÔNG ép keepSkeleton=false ở đây:
      user cố tình xin giữ skeleton với Mixamo phải bị preflight CHẶN
      (xem preflight: keepSkeletonRequested). Mặc định preset đã là
      noSkeleton nên keepSkeleton=false khi không truyền gì. */ }
    if (o.maxInfluences < 1) o.maxInfluences = 1;
    if (o.maxInfluences > 8) o.maxInfluences = 8;
    return o;
  }
  ArpExport.resolveOptions = resolveOptions;

  /* ---------- Đếm mesh / xương / texture thật (cho báo cáo + preflight) ----------
     LƯU Ý: KHÔNG loại mesh có userData.skipSkin — SkinnedMesh sau rig
     cũng mang cờ đó (xem AutoRigPro.bindSkin); mesh gốc đã bị gỡ khỏi
     scene nên không đếm trùng. */
  function countStats(target) {
    var meshes = 0, bones = 0, tris = 0, verts = 0;
    var texSet = {};
    var texCount = 0;
    var texPx = 0;
    if (!target || !target.traverse) return { meshes: 0, bones: 0, tris: 0, verts: 0, textures: 0, texPixels: 0 };
    target.traverse(function (o) {
      if (o.isBone) bones++;
      if (!o.isMesh) return;
      if (o.userData && o.userData.isBoneVisual) return;
      meshes++;
      var geo = o.geometry;
      if (geo) {
        var vc = geo.attributes.position ? geo.attributes.position.count : 0;
        verts += vc;
        tris += Math.floor((geo.index ? geo.index.count : vc) / 3);
      }
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m) return;
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'bumpMap', 'alphaMap', 'aoMap'].forEach(function (k) {
          var t = m[k];
          if (t && t.image) {
            var key = (t.uuid || '') + '|' + k;
            if (!texSet[key]) {
              texSet[key] = true;
              texCount++;
              var w = t.image.width || 0, h = t.image.height || 0;
              if (w && h) texPx += w * h;
            }
          }
        });
      });
    });
    return { meshes: meshes, bones: bones, tris: tris, verts: verts, textures: texCount, texPixels: texPx };
  }
  ArpExport.countStats = countStats;

  function estimateSizeBytes(stats) {
    /* ước tính thô: verts ~64B (pos+normal+uv+skin) + index 6B/tri +
       xương ~2KB + texture JPEG ~0.12B/px. Ghi rõ là ước tính. */
    var geo = (stats.verts || 0) * 64 + (stats.tris || 0) * 6 + (stats.bones || 0) * 2048;
    var tex = Math.round((stats.texPixels || 0) * 0.12);
    return geo + tex;
  }

  /* ============================================================
     PREFLIGHT — kiểm tra trước khi xuất. Trả về
     { blocked, errors[], warnings[], stats, estSizeBytes, preset, version }.
     CHẶN (blocked=true): lỗi nặng — exportFBX trả về luôn, không ghi file.
     CẢNH BÁO: vẫn cho xuất, ghi trong report.
     ============================================================ */
  function preflight(target, opts) {
    opts = opts || {};
    var resolved = (opts.presetDef) ? opts : resolveOptions(opts);
    var p = resolved.presetDef;
    var out = { blocked: false, errors: [], warnings: [], stats: null, estSizeBytes: 0, preset: p.id, version: resolved.version };
    target = getTarget(target);
    if (!target) {
      out.errors.push('Chưa có model nào để xuất.');
      out.blocked = true;
      return out;
    }
    var stats = countStats(target);
    out.stats = stats;
    out.estSizeBytes = estimateSizeBytes(stats);
    if (resolved.unknownPreset) out.warnings.push('Preset "' + resolved.preset + '" không có sẵn — dùng mặc định Unity.');
    if (!stats.meshes) {
      out.errors.push('Model không có mesh nào.');
      out.blocked = true;
      return out;
    }
    var vr = resolveVersion(resolved.version, resolved.ascii);
    out.version = vr.version;
    out.requestedVersion = vr.requested;
    if (vr.fallback) out.warnings.push(vr.fallback);
    if (resolved.ascii && resolved.format === 'glb') {
      out.errors.push('GLB không có dạng ASCII — bỏ chọn ASCII hoặc đổi format FBX.');
      out.blocked = true;
    }
    /* --- giới hạn theo preset đích --- */
    var lim = p.limits || {};
    if (p.id === 'mixamo') {
      if (resolved.keepSkeletonRequested === true) {
        out.errors.push('Preset Mixamo là mesh-only — không thể giữ skeleton (user đã bật "Giữ skeleton"). Bỏ chọn "Giữ skeleton" hoặc đổi preset.');
        out.blocked = true;
      }
      if (resolved.clips && resolved.clips.length) {
        out.errors.push('Preset Mixamo là mesh-only — không xuất được animation clip (clip cần skeleton). Bỏ clip hoặc đổi preset.');
        out.blocked = true;
      }
      if (stats.tris > (lim.maxTris || 50000)) {
        out.errors.push('Mixamo chặn file > ' + (lim.maxTris || 50000) + ' tris (model này ' + stats.tris + ' tris) — giảm tris bằng Decimate/LOD rồi xuất lại.');
        out.blocked = true;
      } else if (stats.tris >= 45000) {
        out.warnings.push('Model ' + stats.tris + ' tris, sát giới hạn Mixamo 50.000 — nên decimate nhẹ cho chắc.');
      }
      if (stats.bones > 0) out.warnings.push('Model đang có skeleton (' + stats.bones + ' xương) — preset Mixamo sẽ BỎ skeleton khi xuất (file mesh-only).');
    } else {
      if (lim.warnTris && stats.tris > lim.warnTris) {
        out.warnings.push('Model ' + stats.tris + ' tris vượt khuyến nghị của ' + p.label + ' (<' + lim.warnTris + ' tris) — nên decimate/LOD, file vẫn xuất được.');
      }
      if (!resolved.keepSkeleton && resolved.clips && resolved.clips.length) {
        out.errors.push('Đã tắt "Giữ skeleton" nhưng lại chọn animation clip — clip cần skeleton. Bật lại skeleton hoặc bỏ clip.');
        out.blocked = true;
      }
      if (!resolved.keepSkin && resolved.keepSkeleton) {
        out.warnings.push('Giữ skeleton nhưng bỏ skin weights — file có xương nhưng mesh không theo xương (dùng khi chỉ cần skeleton).');
      }
    }
    if (resolved.format === 'glb' && p.id === 'mixamo') {
      out.errors.push('Preset Mixamo (mesh-only) chỉ áp dụng cho FBX — GLB luôn giữ skeleton nếu model đã rig. Chọn format FBX để xuất file Mixamo.');
      out.blocked = true;
    }
    if (resolved.embedTextures && stats.textures === 0) {
      out.warnings.push('Model không có texture nào — file xuất ra sẽ không có màu (chỉ material trơn).');
    }
    if (!resolved.keepSkeleton && stats.bones > 0) {
      out.warnings.push('Sẽ bỏ ' + stats.bones + ' xương khỏi file xuất (chọn "Giữ skeleton" để giữ).');
    }
    if (resolved.bindPose && resolved.bindPose !== 'current') {
      var poses = (target.userData && target.userData.arpPoses) || null;
      if (!poses || !poses[resolved.bindPose]) {
        out.warnings.push('Rig không lưu pose "' + resolved.bindPose + '" — giữ tư thế hiện tại khi xuất.');
      }
    }
    return out;
  }
  ArpExport.preflight = preflight;

  /* ============================================================
     CLONE ĐỂ XUẤT — deep clone target (không đụng scene gốc):
     geometry clone, material clone, bone clone, skeleton rebind.
     Bỏ SkeletonHelper / LineSegments / bone visual. Trả về
     { root, boneByUuid, boneByName }.
     ============================================================ */
  function cloneExportTarget(target) {
    var origBones = [], origSkinned = [];
    target.traverse(function (o) {
      if (o.isBone) origBones.push(o);
      if (o.isSkinnedMesh) origSkinned.push(o);
    });
    var cloneBones = [], cloneSkinned = [];
    function cloneNode(orig) {
      if (!orig) return null;
      if (orig.isSkeletonHelper || orig.isLineSegments) return null;
      if (orig.userData && orig.userData.isBoneVisual) return null;
      var c = null;
      try {
        c = new orig.constructor();
      } catch (e) {
        try { c = orig.clone(false); } catch (e2) { return null; }
      }
      c.name = orig.name || '';
      if (orig.position) c.position.copy(orig.position);
      if (orig.quaternion) c.quaternion.copy(orig.quaternion);
      if (orig.scale) c.scale.copy(orig.scale);
      c.visible = orig.visible;
      if (typeof orig.castShadow !== 'undefined') c.castShadow = orig.castShadow;
      if (typeof orig.receiveShadow !== 'undefined') c.receiveShadow = orig.receiveShadow;
      if (typeof orig.frustumCulled !== 'undefined') c.frustumCulled = orig.frustumCulled;
      var ud = {};
      Object.keys(orig.userData || {}).forEach(function (k) {
        if (k === '__sourceMesh') return;
        try { ud[k] = orig.userData[k]; } catch (e) {}
      });
      c.userData = ud;
      if (orig.isMesh) {
        if (orig.geometry) c.geometry = orig.geometry.clone();
        if (orig.material) {
          if (Array.isArray(orig.material)) c.material = orig.material.map(function (m) { return m ? m.clone() : m; });
          else c.material = orig.material.clone();
        }
        if (orig.isBone) cloneBones.push(c);
        if (orig.isSkinnedMesh) cloneSkinned.push(c);
      } else if (orig.isBone) {
        cloneBones.push(c);
      }
      (orig.children || []).forEach(function (child) {
        var cc = cloneNode(child);
        if (cc) c.add(cc);
      });
      return c;
    }
    var root = cloneNode(target);
    var boneByUuid = {};
    origBones.forEach(function (b, i) { if (cloneBones[i]) boneByUuid[b.uuid] = cloneBones[i]; });
    var boneByName = {};
    cloneBones.forEach(function (b) { boneByName[b.name] = b; });
    origSkinned.forEach(function (origMesh, i) {
      var mesh = cloneSkinned[i];
      if (!mesh) return;
      var bones = ((origMesh.skeleton && origMesh.skeleton.bones) || []).map(function (b) {
        return boneByUuid[b.uuid] || boneByName[b.name] || null;
      }).filter(Boolean);
      if (!bones.length) return;
      var skel = new THREE.Skeleton(bones);
      try { skel.calculateInverses(); } catch (e) {}
      try {
        mesh.bind(skel, origMesh.bindMatrix ? origMesh.bindMatrix.clone() : origMesh.matrixWorld.clone());
      } catch (e) {}
    });
    return { root: root, boneByUuid: boneByUuid, boneByName: boneByName };
  }
  ArpExport.cloneExportTarget = cloneExportTarget;

  /* ============================================================
     TÙY CHỌN XƯƠNG / SKIN (áp trên clone, không đụng scene gốc)
     ============================================================ */

  /* Đổi tên xương hàng loạt: stripPrefix (bỏ "mixamorig:"), addPrefix
     (thêm prefix, vd "mixamorig:"), swapLR (Left ↔ Right). Trả về
     { renamed, map: oldFullName → newFullName }. */
  function renameBones(root, rename) {
    rename = rename || {};
    var map = {};
    var renamed = 0;
    var bones = [];
    root.traverse(function (o) { if (o.isBone) bones.push(o); });
    /* swapLR 2 lượt qua placeholder để Left/Right không đè nhau */
    var swap = !!rename.swapLR;
    bones.forEach(function (b) {
      var oldName = b.name;
      var bare = oldName.replace(/^mixamorig:?/i, '');
      var name = bare;
      if (swap) {
        name = name.replace(/Left/g, '\u0001L\u0001').replace(/Right/g, 'Left').replace(/\u0001L\u0001/g, 'Right');
      }
      if (rename.stripPrefix) { /* bare đã bỏ prefix */ }
      else if (rename.addPrefix) {
        var prefix = String(rename.addPrefix);
        if (prefix && name.indexOf(prefix) !== 0) name = prefix + name;
      } else {
        /* mặc định giữ nguyên dạng tên gốc (có prefix hay không) */
        name = oldName.replace(/^mixamorig:?/i, '');
        if (swap) name = name.replace(/Left/g, '\u0001L\u0001').replace(/Right/g, 'Left').replace(/\u0001L\u0001/g, 'Right');
        if (/^mixamorig:?/i.test(oldName)) name = 'mixamorig:' + name;
      }
      if (rename.stripPrefix) name = bare;
      if (name !== oldName) {
        b.name = name;
        map[oldName] = name;
        renamed++;
      }
    });
    return { renamed: renamed, map: map };
  }
  ArpExport.renameBones = renameBones;

  /* Giới hạn influence mỗi đỉnh: giữ N weight lớn nhất, còn lại về 0
     rồi chuẩn hóa tổng = 1.0. Pure function trên geometry (test được).
     KHÔNG để xương nào mất hết weight: xương nào chỉ còn influence
     "bảo hiểm" 0.01 (AutoRigPro guarantee) mà bị cắt thì được gán lại
     0.01 vào đỉnh mà nó mạnh nhất (thay influence yếu nhất tại đó). */
  function limitInfluences(geometry, maxN) {
    if (!geometry || !geometry.attributes.skinIndex || !geometry.attributes.skinWeight) {
      return { ok: false, error: 'Geometry không có skinIndex/skinWeight.' };
    }
    maxN = Math.max(1, Math.min(8, maxN | 0));
    var idx = geometry.attributes.skinIndex;
    var wgt = geometry.attributes.skinWeight;
    var changed = 0, maxBefore = 0;
    /* đỉnh mạnh nhất của mỗi xương (để sửa lại nếu xương mất hết weight) */
    var bestVert = {};
    for (var bv = 0; bv < idx.count; bv++) {
      for (var bk = 0; bk < 4; bk++) {
        var bw = wgt.array[bv * 4 + bk];
        if (bw > 0) {
          var bb = idx.array[bv * 4 + bk];
          if (!bestVert[bb] || bw > bestVert[bb].w) bestVert[bb] = { v: bv, w: bw };
        }
      }
    }
    for (var v = 0; v < idx.count; v++) {
      var inf = [];
      for (var k = 0; k < 4; k++) {
        var w = wgt.array[v * 4 + k];
        if (w > 0) inf.push({ i: idx.array[v * 4 + k], w: w, k: k });
      }
      if (inf.length > maxBefore) maxBefore = inf.length;
      if (inf.length <= maxN) continue;
      inf.sort(function (a, b) { return b.w - a.w; });
      var keep = inf.slice(0, maxN);
      var sum = 0;
      keep.forEach(function (x) { sum += x.w; });
      for (var k2 = 0; k2 < 4; k2++) { wgt.array[v * 4 + k2] = 0; idx.array[v * 4 + k2] = 0; }
      keep.forEach(function (x, j) {
        idx.array[v * 4 + j] = x.i;
        wgt.array[v * 4 + j] = sum > 0 ? x.w / sum : 0;
      });
      changed++;
    }
    /* sửa xương mất hết weight (chỉ còn influence bảo hiểm đã bị cắt) */
    var totals = {};
    for (var tv = 0; tv < idx.count; tv++) {
      for (var tk = 0; tk < 4; tk++) {
        var tw = wgt.array[tv * 4 + tk];
        if (tw > 0) totals[idx.array[tv * 4 + tk]] = (totals[idx.array[tv * 4 + tk]] || 0) + tw;
      }
    }
    var repaired = 0;
    Object.keys(bestVert).forEach(function (bKey) {
      var b = +bKey;
      if ((totals[b] || 0) > 0) return;
      var bv2 = bestVert[b].v;
      var minK = -1, minW = Infinity, nz = 0, sum2 = 0;
      for (var k3 = 0; k3 < 4; k3++) {
        var w3 = wgt.array[bv2 * 4 + k3];
        sum2 += w3;
        if (w3 > 0) {
          nz++;
          /* min chỉ tính trên slot có weight > 0 — slot 0 không phải
             "influence yếu nhất" để thay (thay vào đó làm tăng số
             influence vượt maxN) */
          if (w3 < minW) { minW = w3; minK = k3; }
        }
      }
      var slot = -1;
      if (nz < maxN) {
        /* còn slot trống VÀ chưa đủ N influence: thêm vào slot trống */
        for (var k4 = 0; k4 < 4; k4++) { if (wgt.array[bv2 * 4 + k4] === 0) { slot = k4; break; } }
      }
      if (slot < 0) slot = minK >= 0 ? minK : 0;   /* đã đủ N: thay influence yếu nhất */
      idx.array[bv2 * 4 + slot] = b;
      wgt.array[bv2 * 4 + slot] = 0.01;
      var s2 = wgt.array[bv2 * 4] + wgt.array[bv2 * 4 + 1] + wgt.array[bv2 * 4 + 2] + wgt.array[bv2 * 4 + 3];
      if (s2 > 0) {
        for (var k5 = 0; k5 < 4; k5++) wgt.array[bv2 * 4 + k5] /= s2;
      }
      repaired++;
    });
    return { ok: true, maxBefore: maxBefore, maxAfter: Math.min(maxBefore, maxN), changedVerts: changed, repairedBones: repaired };
  }
  ArpExport.limitInfluences = limitInfluences;

  /* Chuẩn hóa weight: tổng mỗi đỉnh = 1.0. Pure function. */
  function normalizeSkinWeights(geometry) {
    if (!geometry || !geometry.attributes.skinWeight) return { ok: false, error: 'Geometry không có skinWeight.' };
    var wgt = geometry.attributes.skinWeight;
    var fixed = 0, maxErr = 0;
    for (var v = 0; v < wgt.count; v++) {
      var s = wgt.array[v * 4] + wgt.array[v * 4 + 1] + wgt.array[v * 4 + 2] + wgt.array[v * 4 + 3];
      var err = Math.abs(s - 1);
      if (err > maxErr) maxErr = err;
      if (s > 1e-9 && err > 1e-6) {
        for (var k = 0; k < 4; k++) wgt.array[v * 4 + k] /= s;
        fixed++;
      }
    }
    return { ok: true, fixedVerts: fixed, maxErrBefore: +maxErr.toFixed(6) };
  }
  ArpExport.normalizeSkinWeights = normalizeSkinWeights;

  function applySkinOptions(clone, maxInfluences, normalize) {
    var report = { limited: [], normalized: [] };
    clone.traverse(function (o) {
      if (!o.isSkinnedMesh || !o.geometry) return;
      if (maxInfluences && maxInfluences < 4) {
        var r = limitInfluences(o.geometry, maxInfluences);
        if (r.ok) report.limited.push({ mesh: o.name, maxBefore: r.maxBefore, changedVerts: r.changedVerts });
      }
      if (normalize) {
        var n = normalizeSkinWeights(o.geometry);
        if (n.ok) report.normalized.push({ mesh: o.name, fixedVerts: n.fixedVerts, maxErrBefore: n.maxErrBefore });
      }
    });
    return report;
  }

  /* Bỏ skin nhưng giữ skeleton: SkinnedMesh → Mesh thường (writer sẽ
     không ghi cluster/skin, xương vẫn còn trong file). */
  function unbindSkin(clone) {
    var converted = 0;
    var list = [];
    clone.traverse(function (o) { if (o.isSkinnedMesh) list.push(o); });
    list.forEach(function (mesh) {
      var m = new THREE.Mesh(mesh.geometry, mesh.material);
      m.name = mesh.name;
      m.position.copy(mesh.position);
      m.rotation.copy(mesh.rotation);
      m.scale.copy(mesh.scale);
      m.castShadow = mesh.castShadow;
      m.userData = mesh.userData || {};
      var parent = mesh.parent;
      if (parent) {
        var idx = parent.children.indexOf(mesh);
        parent.remove(mesh);
        parent.add(m);
        if (idx >= 0) { parent.children.splice(parent.children.indexOf(m), 1); parent.children.splice(idx, 0, m); }
      }
      converted++;
    });
    return { converted: converted };
  }

  /* Bind pose: chỉ áp khi rig lưu sẵn pose (target.userData.arpPoses
     {tpose|apose: {boneName: {p:[x,y,z], q:[x,y,z,w]}}}). Không có →
     {applied:false, reason} và giữ tư thế hiện tại. */
  function applyBindPose(clone, target, pose) {
    if (!pose || pose === 'current') return { applied: false, pose: 'current', reason: '' };
    var poses = (target && target.userData && target.userData.arpPoses) || null;
    if (!poses || !poses[pose]) {
      return { applied: false, pose: pose, reason: 'Rig không lưu pose "' + pose + '" — giữ tư thế hiện tại khi xuất.' };
    }
    var data = poses[pose];
    var applied = 0;
    clone.traverse(function (o) {
      if (!o.isBone) return;
      var d = data[o.name] || data[o.name.replace(/^mixamorig:?/i, '')];
      if (!d) return;
      if (d.p) o.position.set(d.p[0], d.p[1], d.p[2]);
      if (d.q) o.quaternion.set(d.q[0], d.q[1], d.q[2], d.q[3]);
      applied++;
    });
    clone.updateMatrixWorld(true);
    clone.traverse(function (o) {
      if (o.isSkinnedMesh && o.skeleton) {
        try { o.skeleton.calculateInverses(); } catch (e) {}
        try { o.bind(o.skeleton, o.bindMatrix); } catch (e) {}
      }
    });
    return { applied: true, pose: pose, bones: applied, reason: '' };
  }
  ArpExport.applyBindPose = applyBindPose;

  /* ============================================================
     TÙY CHỌN MESH (áp trên clone)
     ============================================================ */
  function rebuildGeometryFromRemap(geometry, remap, unique, newIndex) {
    Object.keys(geometry.attributes).forEach(function (key) {
      var attr = geometry.attributes[key];
      var itemSize = attr.itemSize;
      var ArrCtor = attr.array.constructor;
      var out = new ArrCtor(unique * itemSize);
      for (var i = 0; i < attr.count; i++) {
        var ni = remap[i];
        if (ni === undefined || ni === null || ni >= unique) continue;
        for (var c = 0; c < itemSize; c++) out[ni * itemSize + c] = attr.array[i * itemSize + c];
      }
      geometry.setAttribute(key, new THREE.BufferAttribute(out, itemSize, attr.normalized));
    });
    if (newIndex) {
      var idxArr = new Uint32Array(newIndex.length);
      for (var j = 0; j < newIndex.length; j++) idxArr[j] = newIndex[j];
      geometry.setIndex(new THREE.BufferAttribute(idxArr, 1));
    }
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
  }

  /* Weld: gộp đỉnh trùng vị trí (+normal+uv+skin). Trả về report. */
  function weldGeometry(geometry, tolerance) {
    if (!geometry || !geometry.attributes.position) return { ok: false, error: 'Geometry không có position.' };
    var tol = (typeof tolerance === 'number' && tolerance > 0) ? tolerance : 1e-4;
    var pos = geometry.attributes.position;
    var norm = geometry.attributes.normal;
    var uv = geometry.attributes.uv;
    var sIdx = geometry.attributes.skinIndex;
    var sWgt = geometry.attributes.skinWeight;
    var q = function (v) { return Math.round(v / tol); };
    var keyOf = function (i) {
      var k = q(pos.getX(i)) + ',' + q(pos.getY(i)) + ',' + q(pos.getZ(i));
      if (norm) k += '|' + q(norm.getX(i)) + ',' + q(norm.getY(i)) + ',' + q(norm.getZ(i));
      if (uv) k += '|' + q(uv.getX(i)) + ',' + q(uv.getY(i));
      if (sIdx) k += '|' + sIdx.array[i * 4] + ',' + sIdx.array[i * 4 + 1] + ',' + sIdx.array[i * 4 + 2] + ',' + sIdx.array[i * 4 + 3];
      if (sWgt) k += '|' + Math.round(sWgt.array[i * 4] * 1000) + ',' + Math.round(sWgt.array[i * 4 + 1] * 1000) + ',' + Math.round(sWgt.array[i * 4 + 2] * 1000) + ',' + Math.round(sWgt.array[i * 4 + 3] * 1000);
      return k;
    };
    var map = {};
    var remap = new Uint32Array(pos.count);
    var unique = 0;
    for (var i = 0; i < pos.count; i++) {
      var k = keyOf(i);
      if (map[k] === undefined) map[k] = unique++;
      remap[i] = map[k];
    }
    var before = pos.count;
    var oldIndex = geometry.index ? geometry.index.array : null;
    var triCount = oldIndex ? oldIndex.length / 3 : pos.count / 3;
    var newIndex = new Uint32Array(triCount * 3);
    for (var t = 0; t < triCount * 3; t++) {
      var vi = oldIndex ? oldIndex[t] : t;
      newIndex[t] = remap[vi];
    }
    rebuildGeometryFromRemap(geometry, remap, unique, newIndex);
    return { ok: true, beforeVerts: before, afterVerts: unique, removed: before - unique };
  }
  ArpExport.weldGeometry = weldGeometry;

  /* Triangulate: geometry three.js vốn đã là tam giác; nếu chưa có
     index thì index hóa (qua weld) — nếu đã indexed thì no-op. */
  function triangulateGeometry(geometry) {
    if (!geometry || !geometry.attributes.position) return { ok: false, error: 'Geometry không có position.' };
    if (geometry.index) return { ok: true, note: 'Đã là tam giác có index — không cần đổi.' };
    var w = weldGeometry(geometry, 1e-4);
    if (!w.ok) return w;
    return { ok: true, note: 'Chưa có index — đã index hóa thành tam giác.', beforeVerts: w.beforeVerts, afterVerts: w.afterVerts };
  }

  /* Tính lại normal: 'smooth' (computeVertexNormals trên indexed) hoặc
     'flat' (toNonIndexed + computeVertexNormals — mặt phẳng từng mặt). */
  function recomputeNormalsGeometry(geometry, mode) {
    if (!geometry || !geometry.attributes.position) return { ok: false, error: 'Geometry không có position.' };
    if (mode === 'flat') {
      var flat = geometry.index ? geometry.toNonIndexed() : geometry;
      flat.computeVertexNormals();
      return { ok: true, geometry: flat, mode: 'flat' };
    }
    geometry.computeVertexNormals();
    return { ok: true, geometry: geometry, mode: 'smooth' };
  }

  /* ---------- Meshopt (vendored js/vendor/meshopt_simplifier.js) ---------- */
  var meshoptReadyFlag = false;
  function getMeshopt() {
    if (typeof window !== 'undefined' && window.MeshoptSimplifier) return window.MeshoptSimplifier;
    if (typeof MeshoptSimplifier !== 'undefined') return MeshoptSimplifier;
    return null;
  }
  function ensureMeshopt() {
    var M = getMeshopt();
    if (!M) return Promise.resolve(false);
    if (M.supported === false) return Promise.resolve(false);
    if (meshoptReadyFlag) return Promise.resolve(true);
    if (M.ready && typeof M.ready.then === 'function') {
      return M.ready.then(function () { meshoptReadyFlag = true; return true; }, function () { return false; });
    }
    meshoptReadyFlag = true;
    return Promise.resolve(true);
  }
  ArpExport.ensureMeshopt = ensureMeshopt;

  /* Decimate 1 geometry về targetTris (MeshoptSimplifier.simplify +
     compactMesh + rebuild attributes). Trả về report. */
  function decimateGeometry(geometry, targetTris) {
    var M = getMeshopt();
    if (!M || !M.simplify) return { ok: false, error: 'MeshoptSimplifier chưa load (js/vendor/meshopt_simplifier.js) — không decimate được.' };
    if (!geometry || !geometry.attributes.position) return { ok: false, error: 'Geometry không có position.' };
    if (!geometry.index) {
      var w = weldGeometry(geometry, 1e-4);
      if (!w.ok) return w;
    }
    var posAttr = geometry.attributes.position;
    var idxAttr = geometry.index;
    var totalTris = Math.floor(idxAttr.count / 3);
    if (!targetTris || targetTris >= totalTris) {
      return { ok: true, skipped: true, before: totalTris, after: totalTris, note: 'Target tris >= tris hiện tại — không giảm.' };
    }
    var positions = new Float32Array(posAttr.array);
    var indices = new Uint32Array(idxAttr.count);
    for (var i = 0; i < idxAttr.count; i++) indices[i] = idxAttr.getX(i);
    var targetIdx = Math.max(3, Math.floor(targetTris) * 3);
    var res;
    try {
      res = M.simplify(indices, positions, 3, targetIdx, 0.01, ['LockBorder']);
    } catch (e) {
      return { ok: false, error: 'Meshopt simplify lỗi: ' + (e && e.message || e) };
    }
    var newIndices = res[0];
    var err = res[1];
    var remapRes;
    try {
      remapRes = M.compactMesh(newIndices);
    } catch (e) {
      return { ok: false, error: 'Meshopt compactMesh lỗi: ' + (e && e.message || e) };
    }
    var remap = remapRes[0], unique = remapRes[1];
    rebuildGeometryFromRemap(geometry, remap, unique, newIndices);
    return { ok: true, before: totalTris, after: Math.floor(newIndices.length / 3), error: (typeof err === 'number' ? +err.toFixed(4) : err) };
  }
  ArpExport.decimateGeometry = decimateGeometry;

  /* Áp toàn bộ tùy chọn mesh lên clone. Trả về report hoặc {error}. */
  function applyMeshOptions(clone, meshOpts) {
    meshOpts = meshOpts || {};
    var report = { beforeTris: 0, afterTris: 0, decimate: [], weld: [], normals: [], triangulate: [] };
    var meshes = [];
    clone.traverse(function (o) {
      if (o.isMesh && !(o.userData && o.userData.isBoneVisual) && o.geometry) meshes.push(o);
    });
    var totalTris = 0;
    meshes.forEach(function (m) {
      var g = m.geometry;
      totalTris += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
    });
    report.beforeTris = totalTris;
    if (meshOpts.triangulate) {
      meshes.forEach(function (m) {
        var r = triangulateGeometry(m.geometry);
        if (r.ok) report.triangulate.push({ mesh: m.name, note: r.note || '' });
      });
    }
    if (meshOpts.weld) {
      meshes.forEach(function (m) {
        var r = weldGeometry(m.geometry, meshOpts.weldTolerance || 1e-4);
        if (r.ok) report.weld.push({ mesh: m.name, removed: r.removed });
        else report.weld.push({ mesh: m.name, error: r.error });
      });
    }
    if (meshOpts.targetTris && meshOpts.targetTris > 0) {
      /* chia target theo tỉ lệ tris từng mesh */
      var total2 = 0;
      meshes.forEach(function (m) {
        var g = m.geometry;
        total2 += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
      });
      var assigned = 0;
      meshes.forEach(function (m, mi) {
        var g = m.geometry;
        var t = Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
        var share = (mi === meshes.length - 1) ? (meshOpts.targetTris - assigned) : Math.max(3, Math.floor(meshOpts.targetTris * t / Math.max(1, total2)));
        assigned += share;
        var r = decimateGeometry(g, share);
        if (!r.ok) { report.error = r.error; return; }
        report.decimate.push({ mesh: m.name, before: r.before, after: r.after, error: r.error });
      });
      if (report.error) return report;
    }
    if (meshOpts.normals && meshOpts.normals !== 'keep') {
      meshes.forEach(function (m) {
        var r = recomputeNormalsGeometry(m.geometry, meshOpts.normals);
        if (r.ok) {
          m.geometry = r.geometry;
          report.normals.push({ mesh: m.name, mode: r.mode });
        }
      });
    }
    var after = 0;
    meshes.forEach(function (m) {
      var g = m.geometry;
      after += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
    });
    report.afterTris = after;
    return report;
  }
  ArpExport.applyMeshOptions = applyMeshOptions;

  /* ============================================================
     TÙY CHỌN TEXTURE (áp trên clone, qua opts.textureBytes của writer)
     - slots: chỉ xuất các slot chọn (bỏ slot còn lại khỏi material clone)
     - size: downscale về max cạnh (chỉ thu nhỏ, không phóng to)
     - format: 'auto' (normal→PNG, còn lại JPEG) | 'jpeg' | 'png'
     - quality: 0.5–0.95 cho JPEG
     - embed=false: xuất rời thành file riêng (externalFiles)
     Trả về { textureBytes|null, externalFiles[], report }.
     ============================================================ */
  var TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'];
  function encodeTextureImage(img, targetSize, mime, quality) {
    try {
      var w = img.width || img.videoWidth || 0;
      var h = img.height || img.videoHeight || 0;
      if (!w || !h) return null;
      var scale = 1;
      if (targetSize && targetSize > 0) scale = Math.min(1, targetSize / Math.max(w, h));
      var tw = Math.max(1, Math.round(w * scale));
      var th = Math.max(1, Math.round(h * scale));
      var c = document.createElement('canvas');
      c.width = tw; c.height = th;
      var cx = c.getContext('2d');
      cx.drawImage(img, 0, 0, tw, th);
      var url = c.toDataURL(mime, mime === 'image/jpeg' ? quality : undefined);
      var b64 = url.split(',')[1];
      if (!b64) return null;
      return { b64: b64, mime: mime, w: tw, h: th, origW: w, origH: h };
    } catch (e) { return null; }
  }

  function dataURLBytes(b64) {
    try {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch (e) { return null; }
  }

  function prepareTextures(clone, texOpts, modelName) {
    texOpts = texOpts || {};
    var report = { slots: [], resized: 0, processedBytes: 0, originalPixels: 0, embed: texOpts.embed !== false, size: texOpts.size || 0, format: texOpts.format || 'auto', quality: texOpts.quality || 0.85, fallback: '' };
    var selected = Array.isArray(texOpts.slots) && texOpts.slots.length ? texOpts.slots : TEX_SLOTS.slice();
    report.slots = selected.slice();
    var textureBytes = {};
    var externalFiles = [];
    var meshes = [];
    clone.traverse(function (o) {
      if (o.isMesh && !(o.userData && o.userData.isBoneVisual)) meshes.push(o);
    });
    var needEncode = !!(texOpts.size || texOpts.format || texOpts.quality || texOpts.slots || texOpts.embed === false);
    if (!needEncode) return { textureBytes: null, externalFiles: externalFiles, report: report, applied: false };
    meshes.forEach(function (mesh, mi) {
      var mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach(function (mat) {
        if (!mat) return;
        var matName = mat.name || ('mat_' + mi);
        TEX_SLOTS.forEach(function (slot) {
          var tex = mat[slot];
          if (selected.indexOf(slot) < 0) {
            if (tex) mat[slot] = null;   /* bỏ slot không chọn */
            return;
          }
          if (!tex) return;
          var img = (tex.userData && tex.userData.originalImage) || tex.image;
          if (!img) return;
          var isNormal = /normal/i.test(slot);
          var mime = texOpts.format === 'png' ? 'image/png' : texOpts.format === 'jpeg' ? 'image/jpeg' : (isNormal ? 'image/png' : 'image/jpeg');
          var quality = Math.max(0.5, Math.min(0.95, (typeof texOpts.quality === 'number' ? texOpts.quality : 0.85)));
          var enc = encodeTextureImage(img, texOpts.size || 0, mime, quality);
          if (!enc) return;
          report.resized++;
          report.originalPixels += (enc.origW * enc.origH);
          var bytes = dataURLBytes(enc.b64);
          var byteLen = bytes ? bytes.length : 0;
          report.processedBytes += byteLen;
          if (texOpts.embed === false) {
            var ext = mime === 'image/png' ? 'png' : 'jpg';
            externalFiles.push({
              filename: (modelName || 'model') + '_' + slot + '.' + ext,
              bytes: bytes, mime: mime, slot: slot, w: enc.w, h: enc.h
            });
          } else {
            if (!textureBytes[matName]) textureBytes[matName] = {};
            textureBytes[matName][slot] = { b64: enc.b64, mime: mime, w: enc.w, h: enc.h };
          }
        });
      });
    });
    if (texOpts.embed === false) {
      /* xuất rời: writer không nhúng texture */
      return { textureBytes: null, externalFiles: externalFiles, report: report, applied: true, embedTextures: false };
    }
    return { textureBytes: textureBytes, externalFiles: externalFiles, report: report, applied: true, embedTextures: true };
  }
  ArpExport.prepareTextures = prepareTextures;

  /* ============================================================
     TÙY CHỌN ANIMATION
     ============================================================ */
  function listClipsForExport(target) {
    var out = [], seen = {};
    var push = function (id, clip, source) {
      if (!clip || !clip.tracks || !clip.name) return;
      var k = String(clip.name);
      if (seen[k]) return;
      seen[k] = true;
      out.push({ id: id || k, name: k, clip: clip, source: source || 'studio' });
    };
    var pushEntries = function (entries, source) {
      if (!entries || !entries.forEach) return;
      entries.forEach(function (e) {
        if (!e) return;
        if (e.clip) push(e.id || e.name, e.clip, source);
        else if (e.tracks) push(e.id || e.name, e, source);
      });
    };
    if (PixiStudio.ArpRemap && PixiStudio.ArpRemap.listClips) {
      try { PixiStudio.ArpRemap.listClips(target).forEach(function (e) { push(e.id, e.clip, e.source); }); } catch (e) {}
    }
    var AAG = PixiStudio.AnimAutoGen;
    var ARP = PixiStudio.AutoRigPro;
    if (AAG && AAG.generateAll && ARP && ARP.lastResult && ARP.lastResult.rig) {
      try { pushEntries(AAG.generateAll(ARP.lastResult.rig), 'AnimAutoGen'); } catch (e) {}
    }
    ['FbxRig', 'Coco', 'Hy3d', 'Thandieu'].forEach(function (ns) {
      var mod = PixiStudio[ns];
      if (!mod) return;
      if (mod.clips) pushEntries(mod.clips, ns);
      if (mod.animations) pushEntries(mod.animations, ns);
    });
    var tgt = target || getTarget();
    if (tgt && tgt.animations) pushEntries(tgt.animations, 'model');
    return out;
  }
  ArpExport.listClipsForExport = listClipsForExport;

  function resolveClipsForExport(opts, target) {
    var all = listClipsForExport(target);
    var wanted = opts.clips;
    if (!wanted || !wanted.length) {
      if (opts.animationSelection === 'none') return [];
      if (opts.animationSelection === 'selected' && opts.selectedClipIds && opts.selectedClipIds.length) {
        return all.filter(function (e) {
          return opts.selectedClipIds.indexOf(e.id) >= 0 || opts.selectedClipIds.indexOf(e.name) >= 0;
        }).map(function (e) { return e.clip; });
      }
      return all.map(function (e) { return e.clip; });
    }
    return wanted.map(function (w) {
      if (typeof w === 'string') {
        var f = all.filter(function (e) { return e.id === w || e.name === w; })[0];
        return f ? f.clip : null;
      }
      if (w && w.tracks) return w;
      if (w && w.clip) return w.clip;
      return null;
    }).filter(Boolean);
  }

  function isHipsBone(boneName) {
    return String(boneName || '').replace(/^mixamorig:?/i, '').toLowerCase() === 'hips';
  }

  function dropRootMotionTrack(clip) {
    var tracks = clip.tracks.filter(function (t) {
      var dot = t.name.lastIndexOf('.');
      if (dot <= 0) return true;
      return !(isHipsBone(t.name.slice(0, dot)) && t.name.slice(dot + 1) === 'position');
    });
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  }

  /* Bake: sample clip bằng mixer trên clone, lấy mẫu đều theo fps.
     Trả về clip mới (tracks đều theo 1/fps) hoặc null khi không bake được. */
  function bakeClip(clip, cloneRoot, fps, rootMotion) {
    if (!clip || !clip.tracks.length || !cloneRoot || !(fps > 0)) return null;
    var bones = {};
    cloneRoot.traverse(function (o) { if (o.isBone) bones[o.name] = o; });
    var wanted = {};
    clip.tracks.forEach(function (t) {
      var dot = t.name.lastIndexOf('.');
      if (dot <= 0) return;
      var b = t.name.slice(0, dot), p = t.name.slice(dot + 1);
      if (!bones[b]) return;
      if (!rootMotion && isHipsBone(b) && p === 'position') return;
      if (!wanted[b]) wanted[b] = {};
      wanted[b][p] = true;
    });
    var boneNames = Object.keys(wanted);
    if (!boneNames.length) return null;
    var saved = boneNames.map(function (b) {
      return { bone: bones[b], p: bones[b].position.clone(), q: bones[b].quaternion.clone(), s: bones[b].scale.clone() };
    });
    var mixer = new THREE.AnimationMixer(cloneRoot);
    var action;
    try {
      action = mixer.clipAction(clip);
      action.reset();
      action.setLoop(THREE.LoopOnce);
      action.clampWhenFinished = true;
      action.play();
    } catch (e) { return null; }
    var dur = clip.duration;
    var steps = Math.max(1, Math.round(dur * fps));
    var dt = dur / steps;
    var times = [];
    var samples = {};
    boneNames.forEach(function (b) { samples[b] = { pos: [], quat: [], scale: [] }; });
    var sampleAt = function (t) {
      cloneRoot.updateMatrixWorld(true);
      times.push(Math.round(t * 1000) / 1000);
      boneNames.forEach(function (b) {
        var bone = bones[b];
        samples[b].pos.push(bone.position.x, bone.position.y, bone.position.z);
        samples[b].quat.push(bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w);
        samples[b].scale.push(bone.scale.x, bone.scale.y, bone.scale.z);
      });
    };
    /* r128 AnimationMixer không có setTime — bước bằng update(dt) */
    try { mixer.update(0); } catch (e) {}
    sampleAt(0);
    for (var i = 1; i <= steps; i++) {
      try { mixer.update(dt); } catch (e) {}
      sampleAt(Math.min(i * dt, dur));
    }
    try { mixer.stopAllAction(); } catch (e) {}
    saved.forEach(function (s) {
      s.bone.position.copy(s.p);
      s.bone.quaternion.copy(s.q);
      s.bone.scale.copy(s.s);
    });
    cloneRoot.updateMatrixWorld(true);
    var timesArr = new Float32Array(times);
    var tracks = [];
    boneNames.forEach(function (b) {
      var w = wanted[b];
      if (w.position) tracks.push(new THREE.VectorKeyframeTrack(b + '.position', timesArr, new Float32Array(samples[b].pos)));
      if (w.quaternion) tracks.push(new THREE.QuaternionKeyframeTrack(b + '.quaternion', timesArr, new Float32Array(samples[b].quat)));
      if (w.scale) tracks.push(new THREE.VectorKeyframeTrack(b + '.scale', timesArr, new Float32Array(samples[b].scale)));
    });
    if (!tracks.length) return null;
    var baked = new THREE.AnimationClip(clip.name, dur, tracks);
    baked.userData = { baked: true, fps: fps };
    return baked;
  }
  ArpExport.bakeClip = bakeClip;

  /* Rút gọn keyframe: bỏ key giữa nếu nội suy từ 2 key kề sai số
     < tolerance (position: đơn vị scene; rotation: độ). */
  function trackInterpError(track, i0, i1, i2) {
    var times = track.times, values = track.values;
    var size = track.getValueSize();
    var t0 = times[i0], t1 = times[i1], t2 = times[i2];
    if (t2 <= t0) return Infinity;
    var f = (t1 - t0) / (t2 - t0);
    if (track instanceof THREE.QuaternionKeyframeTrack) {
      var qa = new THREE.Quaternion(values[i0 * 4], values[i0 * 4 + 1], values[i0 * 4 + 2], values[i0 * 4 + 3]);
      var qb = new THREE.Quaternion(values[i2 * 4], values[i2 * 4 + 1], values[i2 * 4 + 2], values[i2 * 4 + 3]);
      var qm = qa.clone().slerp(qb, f);
      var q1 = new THREE.Quaternion(values[i1 * 4], values[i1 * 4 + 1], values[i1 * 4 + 2], values[i1 * 4 + 3]);
      var dot = Math.abs(qm.dot(q1));
      if (dot > 1) dot = 1;
      return 2 * Math.acos(dot) * 180 / Math.PI;   /* độ */
    }
    var err = 0;
    for (var c = 0; c < size; c++) {
      var a = values[i0 * size + c], b = values[i2 * size + c];
      var pred = a + (b - a) * f;
      var d = Math.abs(values[i1 * size + c] - pred);
      if (d > err) err = d;
    }
    return err;
  }

  function reduceTrack(track, tolerance) {
    var n = track.times.length;
    if (n <= 2 || !(tolerance > 0)) return { track: track, removed: 0 };
    var kept = [];
    for (var i = 0; i < n; i++) kept.push(i);
    var removed = 0;
    var changed = true;
    while (changed) {
      changed = false;
      for (var k = 1; k < kept.length - 1; k++) {
        var err = trackInterpError(track, kept[k - 1], kept[k], kept[k + 1]);
        if (err < tolerance) {
          kept.splice(k, 1);
          removed++;
          changed = true;
          break;
        }
      }
    }
    if (!removed) return { track: track, removed: 0 };
    var size = track.getValueSize();
    var newTimes = new Float32Array(kept.length);
    var newValues = new Float32Array(kept.length * size);
    kept.forEach(function (idx, j) {
      newTimes[j] = track.times[idx];
      for (var c = 0; c < size; c++) newValues[j * size + c] = track.values[idx * size + c];
    });
    var nt = new track.constructor(track.name, newTimes, newValues);
    return { track: nt, removed: removed };
  }

  function reduceClip(clip, tolerance) {
    var tracks = [];
    var removed = 0;
    clip.tracks.forEach(function (t) {
      var r = reduceTrack(t, tolerance);
      tracks.push(r.track);
      removed += r.removed;
    });
    var out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
    out.userData = { reduced: removed };
    return { clip: out, removedKeys: removed };
  }
  ArpExport.reduceClip = reduceClip;

  function renameClipTracks(clip, renameMap) {
    if (!renameMap) return clip;
    var tracks = clip.tracks.map(function (t) {
      var dot = t.name.lastIndexOf('.');
      if (dot <= 0) return t;
      var bone = t.name.slice(0, dot);
      var dest = renameMap[bone];
      if (!dest) return t;
      var nt = t.clone();
      nt.name = dest + t.name.slice(dot);
      return nt;
    });
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  }

  function prepareAnimations(clone, opts, renameMap) {
    var clips = resolveClipsForExport(opts, null);
    var report = { count: 0, names: [], baked: 0, reducedKeys: 0, droppedRootMotion: 0 };
    if (!clips.length) return { animations: [], report: report };
    var anims = [];
    clips.forEach(function (clip) {
      var c = clip;
      if (opts.bakeFps > 0) {
        var baked = bakeClip(c, clone, opts.bakeFps, opts.rootMotion);
        if (baked) { c = baked; report.baked++; }
        else if (!opts.rootMotion) { c = dropRootMotionTrack(c); report.droppedRootMotion++; }
      } else if (!opts.rootMotion) {
        c = dropRootMotionTrack(c);
        report.droppedRootMotion++;
      }
      if (opts.reduceTolerance > 0) {
        var r = reduceClip(c, opts.reduceTolerance);
        c = r.clip;
        report.reducedKeys += r.removedKeys;
      }
      if (renameMap) c = renameClipTracks(c, renameMap);
      anims.push({ name: c.name, clip: c });
      report.names.push(c.name);
    });
    report.count = anims.length;
    report.loop = opts.loop || 'loop';
    return { animations: anims, report: report };
  }
  ArpExport.prepareAnimations = prepareAnimations;

  /* ============================================================
     SCRIPT BLENDER (.py) MỞ RỘNG THEO PRESET
     ============================================================ */
  function buildBlenderScriptEx(fbxFilename, blendFilename, modelName, preset) {
    var p = preset || PRESETS.unity;
    var fwd = p.forwardAxis || '-Z';
    var up = p.upAxis || 'Y';
    var lines = [
      '# Auto Rig Pro Blend — import FBX rigged + save .blend',
      '# Model: ' + (modelName || 'model'),
      '# Preset: ' + p.label + ' — FBX ' + p.version + ', up-axis ' + up + ', forward ' + fwd + ', scale: ' + (p.scaleMode || ''),
      '# ' + (p.changes || ''),
      '# Cach dung:',
      '#   1. Dat file .py nay CUNG THU MUC voi file ' + fbxFilename,
      '#   2. Blender -> Scripting -> Open -> chon file .py nay -> Run Script',
      '#      (hoac chay: blender --background --python ' + fbxFilename.replace(/\.fbx$/i, '') + '.py)',
      '#   3. File .blend se duoc luu cung thu muc: ' + blendFilename,
      'import bpy',
      'import os',
      '',
      'HERE = os.path.dirname(os.path.abspath(__file__))',
      'FBX_FILE = os.path.join(HERE, ' + JSON.stringify(fbxFilename) + ')',
      'BLEND_FILE = os.path.join(HERE, ' + JSON.stringify(blendFilename) + ')',
      '',
      '# Xoá scene mặc định',
      'bpy.ops.wm.read_factory_settings(use_empty=True)',
      '',
      '# Import FBX (preset ' + p.label + ': forward ' + fwd + ', up ' + up + ')',
      'bpy.ops.import_scene.fbx(filepath=FBX_FILE, axis_forward=' + JSON.stringify(fwd) + ', axis_up=' + JSON.stringify(up) + ', global_scale=1.0, use_manual_orientation=False)',
      '',
      '# Lưu thành .blend',
      'bpy.ops.wm.save_as_mainfile(filepath=BLEND_FILE)',
      'print("AutoRigPro: imported", FBX_FILE)',
      'print("AutoRigPro: saved .blend ->", BLEND_FILE)'
    ];
    return lines.join('\n') + '\n';
  }
  ArpExport.buildBlenderScriptEx = buildBlenderScriptEx;

  /* ---------- helpers b64 ---------- */
  function bytesToB64(bytes) {
    var s = '';
    var CH = 32768;
    for (var i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
    }
    return btoa(s);
  }
  function b64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /* ---------- Lịch sử xuất (localStorage) ---------- */
  function getHistory() {
    try { return JSON.parse(lsGet(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }
  ArpExport.getHistory = getHistory;

  function clearHistory() {
    lsSet(HISTORY_KEY, '[]');
  }
  ArpExport.clearHistory = clearHistory;

  function saveHistoryEntry(result, modelName) {
    if (!result || !result.ok) return null;
    var entry = {
      id: 'exp_' + Date.now() + '_' + Math.floor(Math.random() * 1000000),
      filename: result.filename, preset: result.preset, format: result.format,
      version: result.version, sizeBytes: result.sizeBytes,
      time: new Date().toISOString(), modelName: modelName || '',
      dataB64: null
    };
    try {
      if (result.bytes && result.bytes.length <= HISTORY_MAX_BYTES) entry.dataB64 = bytesToB64(result.bytes);
      else if (result.buffer && result.buffer.byteLength <= HISTORY_MAX_BYTES) entry.dataB64 = bytesToB64(new Uint8Array(result.buffer));
    } catch (e) {}
    var hist = getHistory();
    hist.unshift(entry);
    hist = hist.slice(0, HISTORY_MAX);
    lsSet(HISTORY_KEY, JSON.stringify(hist));
    return entry;
  }

  function redownloadHistory(id) {
    var hist = getHistory();
    var found = null;
    hist.forEach(function (h) { if (h.id === id) found = h; });
    if (!found) return { ok: false, error: 'Không tìm thấy mục lịch sử.' };
    if (!found.dataB64) {
      return { ok: false, error: 'File "' + found.filename + '" quá lớn (>1MB) nên bytes không được lưu — cần xuất lại.' };
    }
    var bytes = b64ToBytes(found.dataB64);
    if (U && U.downloadBlob) U.downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), found.filename);
    notify('success', 'Tải lại từ lịch sử', found.filename + ' — ' + (U && U.formatBytes ? U.formatBytes(bytes.length) : bytes.length + ' B') + '.');
    return { ok: true, filename: found.filename };
  }
  ArpExport.redownloadHistory = redownloadHistory;

  /* ---------- Chuẩn bị clone đầy đủ (dùng chung cho main + LOD) ---------- */
  function prepareClone(target, opts) {
    var cloned = cloneExportTarget(target);
    var clone = cloned.root;
    if (opts.scaleFactor && opts.scaleFactor !== 1) {
      clone.scale.multiplyScalar(opts.scaleFactor);
      clone.updateMatrixWorld(true);
    }
    var renameReport = opts.rename ? renameBones(clone, opts.rename) : null;
    var bindReport = applyBindPose(clone, target, opts.bindPose);
    if (!opts.keepSkin && opts.keepSkeleton) unbindSkin(clone);
    var skinReport = null;
    if (opts.keepSkin && opts.keepSkeleton) {
      skinReport = applySkinOptions(clone, opts.maxInfluences, opts.normalizeWeights);
    }
    return { clone: clone, renameReport: renameReport, bindReport: bindReport, skinReport: skinReport };
  }

  function presetFilenameSuffix(presetId) {
    if (presetId === 'unity') return '_AutoRigPro';
    if (presetId === 'unreal') return '_AutoRigPro_Unreal';
    if (presetId === 'mixamo') return '_Mixamo';
    if (presetId === 'blender') return '_AutoRigPro_Blender';
    if (presetId === 'maya') return '_AutoRigPro_Maya';
    if (presetId === '3dsmax') return '_AutoRigPro_3dsMax';
    if (presetId === 'godot') return '_AutoRigPro_Godot';
    return '_AutoRigPro_' + sanitizeName(presetId);
  }

  function needsMeshopt(resolved) {
    if (resolved.mesh && resolved.mesh.targetTris > 0) return true;
    if (resolved.lod && resolved.lod.enabled && resolved.lod.targetTris > 0) return true;
    return false;
  }

  function isMeshoptReadySync() {
    if (meshoptReadyFlag) return true;
    var M = getMeshopt();
    if (!M || !M.simplify || M.supported === false) return false;
    try {
      var idx = new Uint32Array([0, 1, 2]);
      var pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      M.simplify(idx, pos, 3, 3, 0.01, []);
      meshoptReadyFlag = true;
      return true;
    } catch (e) { return false; }
  }

  /* ============================================================
     BUILD FBX MỞ RỘNG (đồng bộ) — pipeline đầy đủ.
     ============================================================ */
  function buildFBXExtended(target, opts) {
    var pf = preflight(target, opts);
    if (pf.blocked) {
      return { ok: false, blocked: true, preflight: pf, error: pf.errors.join('; '), format: 'fbx', preset: opts.preset, version: pf.version };
    }
    var vr = resolveVersion(opts.version, opts.ascii);
    var p = opts.presetDef;
    var name = getModelName(target, opts);
    var suffix = presetFilenameSuffix(opts.preset);
    var fbxFilename = name + suffix + (opts.ascii ? '_Ascii' : '') + '.fbx';
    var blendFilename = name + suffix + (opts.ascii ? '_Ascii' : '') + '.blend';
    var pyFilename = name + suffix + (opts.ascii ? '_Ascii' : '') + '.py';
    var W = PixiStudio.FBXBinary;
    var ARP = PixiStudio.AutoRigPro;
    if (!W || !W.write) {
      return { ok: false, error: 'FBXBinary chưa load — không xuất được FBX.', format: 'fbx', preset: opts.preset, preflight: pf };
    }

    var prep = prepareClone(target, opts);
    var clone = prep.clone;

    var meshReport = applyMeshOptions(clone, opts.mesh || {});
    if (meshReport.error) {
      return { ok: false, error: meshReport.error, format: 'fbx', preset: opts.preset, preflight: pf, meshReport: meshReport };
    }

    var texOpts = Object.assign({}, opts.texture || {});
    texOpts.embed = opts.embedTextures;
    var texPrep = prepareTextures(clone, texOpts, name);

    var animPrep = prepareAnimations(clone, opts, prep.renameReport ? prep.renameReport.map : null);

    var writerOpts = {
      version: vr.version,
      ascii: opts.ascii,
      keepSkeleton: opts.keepSkeleton,
      noSkeleton: !opts.keepSkeleton,
      mixamoNames: p.mixamoNames === true,
      upAxis: opts.upAxis || 'Y',
      autoScale: opts.autoScale,
      embedTextures: texPrep.embedTextures !== false ? opts.embedTextures : false,
      textureBytes: texPrep.textureBytes || undefined,
      animations: animPrep.animations,
      fps: opts.bakeFps || 30
    };
    var res;
    try {
      res = W.write(clone, writerOpts);
    } catch (e) {
      return { ok: false, error: 'FBXBinary.write lỗi: ' + (e && e.message || e), format: 'fbx', preset: opts.preset, preflight: pf };
    }

    /* --- LOD: bản low-poly cùng lúc (clone thứ 2, decimate riêng) --- */
    var lod = null;
    if (opts.lod && opts.lod.enabled && opts.lod.targetTris > 0) {
      var lodPrep = prepareClone(target, opts);
      var lodMeshReport = applyMeshOptions(lodPrep.clone, { targetTris: opts.lod.targetTris });
      if (!lodMeshReport.error) {
        var lodTex = prepareTextures(lodPrep.clone, texOpts, name);
        var lodWriterOpts = Object.assign({}, writerOpts, {
          textureBytes: lodTex.textureBytes || undefined,
          embedTextures: lodTex.embedTextures !== false ? opts.embedTextures : false,
          animations: []
        });
        try {
          var lodRes = W.write(lodPrep.clone, lodWriterOpts);
          var lodFilename = name + suffix + '_LOD' + (opts.ascii ? '_Ascii' : '') + '.fbx';
          lod = {
            bytes: lodRes.bytes, filename: lodFilename, report: lodRes.report,
            targetTris: opts.lod.targetTris, tris: countStats(lodPrep.clone).tris, meshReport: lodMeshReport
          };
        } catch (e) {
          lod = { error: 'LOD write lỗi: ' + (e && e.message || e) };
        }
      } else {
        lod = { error: lodMeshReport.error };
      }
    }

    var pyText;
    if (ARP && ARP.buildBlenderScript && opts.preset === 'unity' && !opts.ascii) {
      pyText = ARP.buildBlenderScript(fbxFilename, blendFilename, name);
    } else {
      pyText = buildBlenderScriptEx(fbxFilename, blendFilename, name, p);
    }

    var stats = countStats(clone);
    var result = {
      ok: true, format: 'fbx', preset: opts.preset, presetLabel: p.label,
      version: vr.version, requestedVersion: vr.requested, versionFallback: vr.fallback,
      ascii: !!opts.ascii,
      bytes: res.bytes, filename: fbxFilename,
      pyText: pyText, pyFilename: pyFilename, blendFilename: blendFilename,
      report: res.report, boneCount: res.report.bones, hasSkin: res.report.hasSkin,
      stats: stats, sizeBytes: res.bytes.length,
      preflight: pf, meshReport: meshReport, textureReport: texPrep.report,
      animationReport: animPrep.report, renameReport: prep.renameReport,
      bindReport: prep.bindReport, skinReport: prep.skinReport,
      externalTextures: texPrep.externalFiles || [],
      lod: lod
    };
    ArpExport.lastResult = result;
    ArpExport.lastFormat = 'fbx';
    ArpExport.lastPreset = opts.preset;
    return result;
  }
  ArpExport.buildFBXExtended = buildFBXExtended;

  /* ---------- Đường cũ (plain call) — giữ nguyên để test cũ pass ---------- */
  function isPlainCall(opts) {
    if (!opts) return true;
    return Object.keys(opts).every(function (k) {
      return ['preset', 'modelName', 'format'].indexOf(k) >= 0;
    });
  }

  function exportFBXPlain(target, opts) {
    opts = opts || {};
    target = getTarget(target);
    var presetId = PRESETS[opts.preset] ? opts.preset : 'unity';
    var result = { ok: false, format: 'fbx', preset: presetId, bytes: null, filename: '', pyText: '', pyFilename: '', blendFilename: '', report: null, boneCount: 0, hasSkin: false, stats: null, error: '' };
    if (!target) {
      result.error = 'Chưa có model nào để xuất.';
      notify('warning', 'Export', result.error);
      return result;
    }
    var ARP = PixiStudio.AutoRigPro;
    var name = getModelName(target, opts);
    var W = PixiStudio.FBXBinary;

    /* Preflight cũng áp cho đường plain (vd Mixamo + >50k tris phải chặn
       dù gọi đơn giản). Lenhhosung 50k tris + rigged vẫn qua được. */
    var pf = preflight(target, { preset: presetId });
    if (pf.blocked) {
      result.blocked = true;
      result.preflight = pf;
      result.error = pf.errors.join('; ');
      notify('error', 'Export — preflight chặn', result.error);
      return result;
    }
    result.preflight = pf;

    if (presetId === 'unity') {
      if (!ARP || !ARP.buildExport) {
        result.error = 'AutoRigPro chưa load — không xuất được preset Unity.';
        notify('error', 'Export', result.error);
        return result;
      }
      var built = ARP.buildExport(target, name);
      if (!built) {
        result.error = 'AutoRigPro.buildExport thất bại — kiểm tra model đã rig chưa.';
        notify('error', 'Export', result.error);
        return result;
      }
      result.bytes = built.bytes;
      result.filename = built.filename;
      result.report = built.report;
      result.pyText = built.pyText;
      result.pyFilename = built.pyFilename;
      result.blendFilename = built.blendFilename;
      result.boneCount = built.boneCount;
      result.hasSkin = built.hasSkin;
    } else if (presetId === 'unreal') {
      if (!W || !W.write || !ARP || !ARP.buildBlenderScript) {
        result.error = 'FBXBinary hoặc AutoRigPro chưa load — không xuất được preset Unreal.';
        notify('error', 'Export', result.error);
        return result;
      }
      var fbxFilename = name + '_AutoRigPro_Unreal.fbx';
      var blendFilename = name + '_AutoRigPro_Unreal.blend';
      var pyFilename = name + '_AutoRigPro_Unreal.py';
      var res;
      try {
        res = W.write(target, { version: 7300, keepSkeleton: true, noSkeleton: false, upAxis: 'Y', autoScale: false, embedTextures: true });
      } catch (e) {
        result.error = 'FBXBinary.write lỗi: ' + (e && e.message || e);
        notify('error', 'Export', result.error);
        return result;
      }
      result.bytes = res.bytes;
      result.filename = fbxFilename;
      result.report = res.report;
      result.pyText = ARP.buildBlenderScript(fbxFilename, blendFilename, name);
      result.pyFilename = pyFilename;
      result.blendFilename = blendFilename;
      result.boneCount = res.report.bones;
      result.hasSkin = res.report.hasSkin;
    } else { /* mixamo — mesh-only */
      if (!W || !W.write || !ARP || !ARP.buildBlenderScript) {
        result.error = 'FBXBinary hoặc AutoRigPro chưa load — không xuất được preset Mixamo.';
        notify('error', 'Export', result.error);
        return result;
      }
      var mFbx = name + '_Mixamo.fbx';
      var mBlend = name + '_Mixamo.blend';
      var mPy = name + '_Mixamo.py';
      var mRes;
      try {
        mRes = W.write(target, { version: 7300, noSkeleton: true, mixamoNames: true, upAxis: 'Y', autoScale: true, embedTextures: true });
      } catch (e) {
        result.error = 'FBXBinary.write lỗi: ' + (e && e.message || e);
        notify('error', 'Export', result.error);
        return result;
      }
      result.bytes = mRes.bytes;
      result.filename = mFbx;
      result.report = mRes.report;
      result.pyText = ARP.buildBlenderScript(mFbx, mBlend, name);
      result.pyFilename = mPy;
      result.blendFilename = mBlend;
      result.boneCount = 0;
      result.hasSkin = false;
    }

    result.stats = countStats(target);
    result.sizeBytes = result.bytes ? result.bytes.length : 0;
    result.ok = true;
    ArpExport.lastResult = result;
    ArpExport.lastFormat = 'fbx';
    ArpExport.lastPreset = presetId;
    return result;
  }

  /* ============================================================
     EXPORT FBX — đồng bộ. opts xem resolveOptions().
     Plain call (chỉ preset/modelName) đi đường cũ; có tùy chọn mở
     rộng thì đi pipeline clone. Cần decimate/LOD mà meshopt chưa
     sẵn sàng → trả lỗi, dùng exportFBXAsync/exportFile.
     ============================================================ */
  function exportFBX(target, opts) {
    opts = opts || {};
    target = getTarget(target);
    if (isPlainCall(opts)) return exportFBXPlain(target, opts);
    var resolved = resolveOptions(opts);
    if (needsMeshopt(resolved) && !isMeshoptReadySync()) {
      var M = getMeshopt();
      if (!M || M.supported === false) {
        return { ok: false, error: 'MeshoptSimplifier chưa load hoặc không hỗ trợ (cần WebAssembly + js/vendor/meshopt_simplifier.js) — không decimate/LOD được.', format: 'fbx', preset: resolved.preset, needsAsync: true };
      }
      return { ok: false, error: 'Meshopt (WebAssembly) chưa load xong — dùng exportFile() hoặc exportFBXAsync() (Promise) để chờ rồi xuất lại.', format: 'fbx', preset: resolved.preset, needsAsync: true };
    }
    return buildFBXExtended(target, resolved);
  }
  ArpExport.exportFBX = exportFBX;

  /* Bản async: chờ MeshoptSimplifier.ready rồi mới build. */
  function exportFBXAsync(target, opts) {
    var resolved = resolveOptions(opts || {});
    if (!needsMeshopt(resolved)) return Promise.resolve(buildFBXExtended(getTarget(target), resolved));
    return ensureMeshopt().then(function (ok) {
      if (!ok) {
        return { ok: false, error: 'MeshoptSimplifier chưa sẵn sàng/không hỗ trợ (cần WebAssembly) — không decimate/LOD được.', format: 'fbx', preset: resolved.preset };
      }
      return buildFBXExtended(getTarget(target), resolved);
    });
  }
  ArpExport.exportFBXAsync = exportFBXAsync;

  /* ============================================================
     EXPORT GLB — Promise (GLTFExporter r128 async).
     Chuẩn hóa attribute về Float32 (theo anim-glb-export.js) rồi
     khôi phục sau khi ghi — GLTFExporter r128 lỗi với attribute
     Int/Uint normalized (model meshopt hay bị).
     ============================================================ */
  function denormValue(v, arr) {
    if (arr instanceof Int8Array) return Math.max(v / 127, -1);
    if (arr instanceof Uint8Array) return v / 255;
    if (arr instanceof Int16Array) return Math.max(v / 32767, -1);
    if (arr instanceof Uint16Array) return v / 65535;
    return v;
  }

  function normalizeAttributesForGLTF(root) {
    var saved = [];
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      var g = o.geometry;
      /* index cũng phải cùng realm với GLTFExporter (constructor check
         giống attribute) — GLTFLoader tạo index ở realm khác trong
         harness jsdom nên phải đổi sang Uint32Array mới. */
      if (g.index) {
        var idxArr = new Uint32Array(g.index.count);
        for (var ii = 0; ii < g.index.count; ii++) idxArr[ii] = g.index.getX(ii);
        saved.push({ geo: g, key: '__index', attr: g.index });
        g.setIndex(new THREE.BufferAttribute(idxArr, 1));
      }
      Object.keys(g.attributes).forEach(function (key) {
        if (key === 'skinIndex' || key === 'skinWeight') return;
        var a = g.attributes[key];
        if (a.array instanceof Float32Array && !a.normalized) return;
        var size = a.itemSize;
        var out = new Float32Array(a.count * size);
        for (var i = 0; i < a.count; i++) {
          for (var c = 0; c < size; c++) {
            var raw = c === 0 ? a.getX(i) : c === 1 ? a.getY(i) : c === 2 ? a.getZ(i) : a.getW(i);
            out[i * size + c] = a.normalized ? denormValue(raw, a.array) : raw;
          }
        }
        saved.push({ geo: g, key: key, attr: a });
        g.setAttribute(key, new THREE.BufferAttribute(out, size));
      });
    });
    return function restore() {
      saved.forEach(function (s) {
        if (s.key === '__index') s.geo.setIndex(s.attr);
        else s.geo.setAttribute(s.key, s.attr);
      });
    };
  }

  function exportGLB(target, opts) {
    opts = opts || {};
    target = getTarget(target);
    var resolved = resolveOptions(opts);
    var presetId = resolved.preset;
    return new Promise(function (resolve) {
      var result = { ok: false, format: 'glb', preset: presetId, buffer: null, filename: '', report: null, boneCount: 0, hasSkin: false, stats: null, sizeBytes: 0, error: '' };
      if (!target) {
        result.error = 'Chưa có model nào để xuất.';
        notify('warning', 'Export', result.error);
        resolve(result);
        return;
      }
      if (!window.THREE || !THREE.GLTFExporter) {
        result.error = 'GLTFExporter chưa load (CDN examples/js) — kiểm tra mạng rồi tải lại trang. Không export được GLB.';
        notify('error', 'Export GLB', result.error);
        resolve(result);
        return;
      }
      var name = getModelName(target, opts);
      var suffix = presetFilenameSuffix(presetId);
      result.filename = name + suffix + '.glb';
      if (presetId === 'mixamo') {
        result.error = 'Preset Mixamo (mesh-only) chỉ áp dụng cho FBX — GLB luôn giữ skeleton nếu model đã rig. Chọn format FBX để xuất file Mixamo.';
        notify('warning', 'Export GLB', result.error);
        resolve(result);
        return;
      }
      var hidden = [];
      target.traverse(function (o) {
        if (!o.visible) return;
        if ((o.userData && o.userData.isBoneVisual) || o.isLineSegments || o.isSkeletonHelper) {
          o.visible = false;
          hidden.push(o);
        }
      });
      var restoreHidden = function () { hidden.forEach(function (o) { o.visible = true; }); };
      var restoreAttrs = normalizeAttributesForGLTF(target);
      var clips = [];
      try { clips = resolveClipsForExport(resolved, target).map(function (c) { return c; }); } catch (e) { clips = []; }
      var exporter = new THREE.GLTFExporter();
      try {
        exporter.parse(target, function (res) {
          restoreHidden();
          restoreAttrs();
          if (!(res instanceof ArrayBuffer)) {
            result.error = 'GLTFExporter không trả về ArrayBuffer — kiểm tra lại tham số options.';
            notify('error', 'Export GLB', result.error);
            resolve(result);
            return;
          }
          result.buffer = res;
          result.sizeBytes = res.byteLength;
          result.stats = countStats(target);
          result.boneCount = result.stats.bones;
          result.hasSkin = (function () {
            var s = false;
            target.traverse(function (o) { if (o.isSkinnedMesh) s = true; });
            return s;
          })();
          result.animationCount = clips.length;
          result.ok = true;
          ArpExport.lastResult = result;
          ArpExport.lastFormat = 'glb';
          ArpExport.lastPreset = presetId;
          resolve(result);
        }, { binary: true, animations: clips, onlyVisible: true, embedImages: true });
      } catch (err) {
        restoreHidden();
        restoreAttrs();
        result.error = 'GLTFExporter lỗi: ' + (err && err.message || err);
        notify('error', 'Export GLB', result.error);
        resolve(result);
      }
    });
  }
  ArpExport.exportGLB = exportGLB;

  /* ---------- Tải file về + notify + báo cáo + lịch sử ---------- */
  function downloadResult(result, modelName) {
    if (!result || !result.ok) return false;
    if (result.format === 'fbx') {
      if (U && U.downloadBlob) U.downloadBlob(new Blob([result.bytes], { type: 'application/octet-stream' }), result.filename);
      if (U && U.downloadText) U.downloadText(result.pyText, result.pyFilename, 'text/x-python');
      if (result.lod && result.lod.bytes && U && U.downloadBlob) {
        U.downloadBlob(new Blob([result.lod.bytes], { type: 'application/octet-stream' }), result.lod.filename);
      }
      (result.externalTextures || []).forEach(function (f) {
        if (U && U.downloadBlob && f.bytes) U.downloadBlob(new Blob([f.bytes], { type: f.mime || 'image/jpeg' }), f.filename);
      });
    } else if (result.format === 'glb') {
      if (U && U.downloadBlob) U.downloadBlob(new Blob([result.buffer], { type: 'model/gltf-binary' }), result.filename);
    }
    saveHistoryEntry(result, modelName);
    var st = result.stats || {};
    var fmtSize = (U && U.formatBytes) ? U.formatBytes(result.sizeBytes) : (result.sizeBytes + ' B');
    var msg = result.filename + ' · ' + (st.meshes || 0) + ' mesh · ' + (st.tris || 0) + ' tris · ' +
      result.boneCount + ' xương · skin ' + (result.hasSkin ? 'có' : 'không') + ' · ' +
      (st.textures || 0) + ' texture nhúng · ' + fmtSize;
    if (result.format === 'fbx') {
      msg += ' · kèm ' + result.pyFilename + ' (mở .py trong Blender để lưu ' + result.blendFilename + ')';
      if (result.animationReport && result.animationReport.count) msg += ' · ' + result.animationReport.count + ' clip (' + result.animationReport.names.join(', ') + ')';
      if (result.lod && result.lod.bytes) msg += ' · kèm LOD ' + result.lod.filename + ' (' + result.lod.tris + ' tris)';
      if (result.externalTextures && result.externalTextures.length) msg += ' · ' + result.externalTextures.length + ' texture rời';
    } else {
      msg += ' · GLB không kèm .py (script .py chỉ import FBX)';
    }
    var pfWarn = (result.preflight && result.preflight.warnings) || [];
    if (pfWarn.length) msg += ' — LƯU Ý: ' + pfWarn.join('; ');
    notify('success', 'Export xong (' + (PRESETS[result.preset] ? PRESETS[result.preset].label : result.preset) + ')', msg, 15000);
    if (bus && bus.emit) bus.emit('arpexport:exported', { filename: result.filename, format: result.format, preset: result.preset, bytes: result.sizeBytes, bones: result.boneCount });
    return true;
  }
  ArpExport.downloadResult = downloadResult;

  /* Dispatcher: format 'fbx' | 'glb'. Luôn trả Promise<result>. */
  function exportFile(target, opts) {
    opts = opts || {};
    var format = opts.format === 'glb' ? 'glb' : 'fbx';
    if (format === 'glb') {
      return exportGLB(target, opts).then(function (r) {
        if (r.ok) downloadResult(r, getModelName(getTarget(target), opts));
        return r;
      });
    }
    var resolved = resolveOptions(opts);
    var p = needsMeshopt(resolved) ? exportFBXAsync(target, opts) : Promise.resolve(exportFBX(target, opts));
    return p.then(function (r) {
      if (r.ok) downloadResult(r, getModelName(getTarget(target), opts));
      return r;
    });
  }
  ArpExport.exportFile = exportFile;

  /* ---------- Xuất hàng loạt: nhiều model một lượt ---------- */
  function listSceneModels() {
    var out = [], seen = {};
    var add = function (t) {
      if (!t || !t.uuid || seen[t.uuid]) return;
      seen[t.uuid] = 1;
      out.push(t);
    };
    add(getTarget());
    if (PixiStudio.Models && Array.isArray(PixiStudio.Models.list)) {
      PixiStudio.Models.list.forEach(add);
    }
    return out;
  }
  ArpExport.listSceneModels = listSceneModels;

  function exportBatch(models, opts) {
    opts = opts || {};
    var list = (models || []).map(function (m) {
      if (m && m.target) return { target: m.target, modelName: m.modelName || (m.target && m.target.name) || null };
      return { target: m, modelName: (m && m.name) || null };
    }).filter(function (e) { return !!e.target; });
    var results = [];
    var chain = Promise.resolve();
    list.forEach(function (entry) {
      chain = chain.then(function () {
        var o2 = Object.assign({}, opts, { modelName: entry.modelName || opts.modelName });
        return exportFile(entry.target, o2).then(function (r) { results.push(r); });
      });
    });
    return chain.then(function () { return results; });
  }
  ArpExport.exportBatch = exportBatch;

  /* ============================================================
     UI TAB — radio FBX/GLB + version + preset (7 + custom) +
     xương/skin + animation + mesh + texture + preflight + batch
     + lịch sử. Đăng ký qua ArpPanel.registerTab('export', ...).
     ============================================================ */
  function el(tag, attrs, children) {
    if (U && U.el) return U.el(tag, attrs, children);
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null) return;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function sectionEl(title, extra) {
    var s = el('div', { class: 'arp-sec', style: 'margin-bottom:10px;' });
    s.appendChild(el('div', { class: 'dim small', style: 'font-weight:600;margin-bottom:4px;', text: title }));
    if (extra) s.appendChild(extra);
    return s;
  }

  function renderExportTab(container) {
    if (!container) return;
    container.innerHTML = '';
    var state = { format: 'fbx', preset: 'unity', busy: false };

    container.appendChild(el('div', { class: 'dim small', style: 'line-height:1.6;margin-bottom:8px;', text: 'Xuất model đã rig (Auto Rig Pro, 41 xương Mixamo). FBX luôn kèm file .py Blender; GLB không kèm .py. Texture mặc định nhúng trong file. Bấm "Kiểm tra trước" để xem preflight trước khi xuất.' }));

    /* ---- format + version + ascii ---- */
    var fmtRow = el('div', { style: 'display:flex;gap:12px;align-items:center;margin-bottom:8px;flex-wrap:wrap;' });
    [['fbx', 'FBX'], ['glb', 'GLB']].forEach(function (pair) {
      var label = el('label', { style: 'display:flex;gap:4px;align-items:center;cursor:pointer;' });
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'arp-export-format';
      radio.value = pair[0];
      radio.checked = state.format === pair[0];
      radio.addEventListener('change', function () { state.format = pair[0]; });
      label.appendChild(radio);
      label.appendChild(document.createTextNode(pair[1]));
      fmtRow.appendChild(label);
    });
    var verSel = el('select', { class: 'arp-select', style: 'width:110px;' });
    [6100, 7300, 7400, 7500].forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = 'FBX ' + v + (v === 7300 ? ' (mặc định)' : '');
      if (v === 7300) opt.selected = true;
      verSel.appendChild(opt);
    });
    fmtRow.appendChild(el('span', { class: 'dim small', text: 'Version:' }));
    fmtRow.appendChild(verSel);
    var asciiChk = document.createElement('input');
    asciiChk.type = 'checkbox';
    var asciiLbl = el('label', { class: 'small', style: 'display:flex;gap:4px;align-items:center;cursor:pointer;', text: 'ASCII (luôn 7300)' });
    asciiLbl.insertBefore(asciiChk, asciiLbl.firstChild);
    fmtRow.appendChild(asciiLbl);
    container.appendChild(fmtRow);
    container.appendChild(el('div', { class: 'dim small', style: 'margin:-4px 0 8px;', text: 'Writer chỉ hỗ trợ thật 7300/7400: 6100 → fallback 7300, 7500 → fallback 7400. ASCII luôn 7300.' }));

    /* ---- preset + custom ---- */
    var presetSel = el('select', { class: 'arp-select', style: 'width:100%;margin-bottom:8px;' });
    var fillPresetSel = function () {
      presetSel.innerHTML = '';
      PRESET_IDS.forEach(function (id) {
        var opt = document.createElement('option');
        opt.value = id;
        opt.textContent = PRESETS[id].label;
        if (id === state.preset) opt.selected = true;
        presetSel.appendChild(opt);
      });
      listCustomPresets().forEach(function (name) {
        var opt = document.createElement('option');
        opt.value = name;
        opt.textContent = '★ ' + name + ' (riêng)';
        if (name === state.preset) opt.selected = true;
        presetSel.appendChild(opt);
      });
    };
    var presetDesc = el('div', { class: 'small', style: 'line-height:1.6;margin-bottom:8px;' });
    var renderPresetDesc = function () {
      var rp = resolvePreset(state.preset);
      var p = rp.preset;
      presetDesc.innerHTML = '';
      presetDesc.appendChild(el('div', { text: 'Đổi gì: ' + (p.changes || '') }));
      presetDesc.appendChild(el('div', { style: state.preset === 'mixamo' ? 'color:var(--error,#f66);' : '', text: p.note || '' }));
      if (state.format === 'glb' && state.preset === 'mixamo') {
        presetDesc.appendChild(el('div', { style: 'color:var(--error,#f66);', text: 'Preset Mixamo không áp dụng cho GLB — chọn FBX để xuất mesh-only, hoặc đổi preset.' }));
      }
    };
    presetSel.addEventListener('change', function () { state.preset = presetSel.value; renderPresetDesc(); });
    fillPresetSel();
    renderPresetDesc();
    container.appendChild(presetSel);
    container.appendChild(presetDesc);
    var customRow = el('div', { style: 'display:flex;gap:8px;margin-bottom:8px;' });
    var customName = el('input', { type: 'text', placeholder: 'Tên preset riêng…', style: 'flex:1;' });
    customRow.appendChild(customName);
    customRow.appendChild(el('button', {
      class: 'btn sm', text: '💾 Lưu preset riêng',
      onclick: function () {
        var name = customName.value.trim();
        if (!name) { notify('warning', 'Preset riêng', 'Nhập tên preset trước.'); return; }
        var cur = collectOpts();
        var saved = saveCustomPreset(name, cur.presetDef);
        if (saved.ok) {
          fillPresetSel();
          state.preset = name;
          presetSel.value = name;
          renderPresetDesc();
          notify('success', 'Preset riêng', 'Đã lưu preset "' + name + '".');
        } else notify('error', 'Preset riêng', saved.error);
      }
    }));
    customRow.appendChild(el('button', {
      class: 'btn sm', text: '🗑 Xóa preset riêng',
      onclick: function () {
        if (deleteCustomPreset(state.preset)) {
          state.preset = 'unity';
          fillPresetSel();
          presetSel.value = 'unity';
          renderPresetDesc();
        }
      }
    }));
    container.appendChild(customRow);

    /* ---- xương / skin ---- */
    var boneBox = el('div', { style: 'display:flex;flex-direction:column;gap:4px;' });
    var mkChk = function (label, checked, id) {
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!checked;
      input.id = id;
      var lbl = el('label', { class: 'small', style: 'display:flex;gap:6px;align-items:center;cursor:pointer;' });
      lbl.appendChild(input);
      lbl.appendChild(document.createTextNode(label));
      return lbl;
    };
    boneBox.appendChild(mkChk('Giữ skeleton trong file', true, 'arp-bone-keep'));
    boneBox.appendChild(mkChk('Giữ skin weights', true, 'arp-bone-skin'));
    boneBox.appendChild(mkChk('Chuẩn hóa lại weight (tổng = 1.0)', true, 'arp-bone-norm'));
    boneBox.appendChild(mkChk('Bỏ prefix mixamorig: khỏi tên xương', false, 'arp-bone-strip'));
    boneBox.appendChild(mkChk('Đổi trái ↔ phải (Left ↔ Right)', false, 'arp-bone-swap'));
    var inflRow = el('div', { style: 'display:flex;gap:8px;align-items:center;' });
    inflRow.appendChild(el('span', { class: 'small', text: 'Influence tối đa / đỉnh:' }));
    var inflSel = el('select', { id: 'arp-bone-infl' });
    [1, 2, 3, 4, 5, 6, 7, 8].forEach(function (n) {
      var opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = String(n);
      if (n === 4) opt.selected = true;
      inflSel.appendChild(opt);
    });
    inflRow.appendChild(inflSel);
    inflRow.appendChild(el('span', { class: 'small dim', text: 'Bind pose:' }));
    var bindSel = el('select', { id: 'arp-bone-bind' });
    [['current', 'Hiện tại'], ['tpose', 'T-pose'], ['apose', 'A-pose']].forEach(function (pair) {
      var opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      bindSel.appendChild(opt);
    });
    inflRow.appendChild(bindSel);
    boneBox.appendChild(inflRow);
    container.appendChild(sectionEl('🦴 Xương / Skin', boneBox));

    /* ---- animation ---- */
    var animBox = el('div', { style: 'display:flex;flex-direction:column;gap:4px;' });
    var clips = listClipsForExport(null);
    var clipChecks = [];
    if (!clips.length) {
      animBox.appendChild(el('div', { class: 'dim small', text: 'Chưa có clip nào trong studio (rig AnimAutoGen / load FBX kèm clip / Remap trước). Xuất FBX sẽ không có animation.' }));
    } else {
      animBox.appendChild(el('div', { class: 'dim small', text: 'Clip xuất (' + clips.length + '):' }));
      clips.forEach(function (e) {
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = true;
        input.value = e.id;
        clipChecks.push(input);
        var lbl = el('label', { class: 'small', style: 'display:flex;gap:6px;align-items:center;cursor:pointer;' });
        lbl.appendChild(input);
        lbl.appendChild(document.createTextNode(e.name + ' (' + e.clip.duration.toFixed(2) + 's · ' + e.source + ')'));
        animBox.appendChild(lbl);
      });
    }
    var animRow = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' });
    animRow.appendChild(el('span', { class: 'small', text: 'Bake:' }));
    var bakeSel = el('select', { id: 'arp-anim-bake' });
    [[0, 'Không bake'], [24, '24 fps'], [30, '30 fps'], [60, '60 fps']].forEach(function (pair) {
      var opt = document.createElement('option');
      opt.value = String(pair[0]);
      opt.textContent = pair[1];
      bakeSel.appendChild(opt);
    });
    animRow.appendChild(bakeSel);
    animBox.appendChild(animRow);
    animBox.appendChild(mkChk('Gồm root motion (Hips.position)', true, 'arp-anim-root'));
    var loopRow = el('div', { style: 'display:flex;gap:8px;align-items:center;' });
    loopRow.appendChild(el('span', { class: 'small', text: 'Loop:' }));
    var loopSel = el('select', { id: 'arp-anim-loop' });
    [['loop', 'Loop'], ['once', 'Once']].forEach(function (pair) {
      var opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      loopSel.appendChild(opt);
    });
    loopRow.appendChild(loopSel);
    loopRow.appendChild(el('span', { class: 'small', text: 'Rút gọn key (tolerance):' }));
    var tolInput = el('input', { id: 'arp-anim-tol', type: 'number', value: '0', step: '0.001', min: '0', style: 'width:70px;' });
    loopRow.appendChild(tolInput);
    animBox.appendChild(loopRow);
    container.appendChild(sectionEl('🎬 Animation', animBox));

    /* ---- mesh ---- */
    var meshBox = el('div', { style: 'display:flex;flex-direction:column;gap:4px;' });
    var meshRow = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' });
    meshRow.appendChild(el('span', { class: 'small', text: 'Decimate tới (tris, 0 = không):' }));
    meshRow.appendChild(el('input', { id: 'arp-mesh-tris', type: 'number', value: '0', min: '0', step: '1000', style: 'width:90px;' }));
    meshBox.appendChild(meshRow);
    meshBox.appendChild(mkChk('Weld đỉnh trùng', false, 'arp-mesh-weld'));
    meshBox.appendChild(mkChk('Triangulate (đảm bảo tam giác)', false, 'arp-mesh-tri'));
    var normRow = el('div', { style: 'display:flex;gap:8px;align-items:center;' });
    normRow.appendChild(el('span', { class: 'small', text: 'Tính lại normal:' }));
    var normSel = el('select', { id: 'arp-mesh-norm' });
    [['keep', 'Giữ nguyên'], ['smooth', 'Smooth'], ['flat', 'Flat']].forEach(function (pair) {
      var opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      normSel.appendChild(opt);
    });
    normRow.appendChild(normSel);
    meshBox.appendChild(normRow);
    var lodRow = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' });
    lodRow.appendChild(mkChk('Xuất thêm bản LOD low-poly', false, 'arp-mesh-lod'));
    lodRow.appendChild(el('span', { class: 'small', text: 'LOD tris:' }));
    lodRow.appendChild(el('input', { id: 'arp-mesh-lodtris', type: 'number', value: '15000', min: '0', step: '1000', style: 'width:90px;' }));
    meshBox.appendChild(lodRow);
    container.appendChild(sectionEl('🔷 Mesh', meshBox));

    /* ---- texture ---- */
    var texBox = el('div', { style: 'display:flex;flex-direction:column;gap:4px;' });
    var texRow = el('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;' });
    [['embed', 'Nhúng trong FBX'], ['external', 'Xuất rời file riêng']].forEach(function (pair) {
      var label = el('label', { class: 'small', style: 'display:flex;gap:4px;align-items:center;cursor:pointer;' });
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'arp-tex-embed';
      radio.value = pair[0];
      radio.checked = pair[0] === 'embed';
      label.appendChild(radio);
      label.appendChild(document.createTextNode(pair[1]));
      texRow.appendChild(label);
    });
    texBox.appendChild(texRow);
    var texRow2 = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' });
    texRow2.appendChild(el('span', { class: 'small', text: 'Cỡ:' }));
    var texSizeSel = el('select', { id: 'arp-tex-size' });
    [[0, 'Gốc'], [256, '256'], [512, '512'], [1024, '1024'], [2048, '2048'], [4096, '4096']].forEach(function (pair) {
      var opt = document.createElement('option');
      opt.value = String(pair[0]);
      opt.textContent = String(pair[1]);
      texSizeSel.appendChild(opt);
    });
    texRow2.appendChild(texSizeSel);
    texRow2.appendChild(el('span', { class: 'small', text: 'Format:' }));
    var texFmtSel = el('select', { id: 'arp-tex-fmt' });
    [['auto', 'Tự động'], ['jpeg', 'JPEG'], ['png', 'PNG']].forEach(function (pair) {
      var opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      texFmtSel.appendChild(opt);
    });
    texRow2.appendChild(texFmtSel);
    texRow2.appendChild(el('span', { class: 'small', text: 'JPEG quality:' }));
    var texQ = el('input', { id: 'arp-tex-q', type: 'range', min: '0.5', max: '0.95', step: '0.05', value: '0.85', style: 'width:90px;' });
    texRow2.appendChild(texQ);
    texBox.appendChild(texRow2);
    var slotRow = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;' });
    var slotChecks = {};
    TEX_SLOTS.forEach(function (slot) {
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      slotChecks[slot] = input;
      var lbl = el('label', { class: 'small', style: 'display:flex;gap:4px;align-items:center;cursor:pointer;' });
      lbl.appendChild(input);
      lbl.appendChild(document.createTextNode(slot));
      slotRow.appendChild(lbl);
    });
    texBox.appendChild(el('div', { class: 'small dim', text: 'Slot xuất:' }));
    texBox.appendChild(slotRow);
    container.appendChild(sectionEl('🖼 Texture', texBox));

    /* ---- preflight + export ---- */
    var pfBox = el('div', { class: 'arp-export-preflight small', style: 'line-height:1.6;margin-bottom:8px;', text: 'Chưa kiểm tra.' });
    var reportBox = el('div', { class: 'arp-export-report small', style: 'line-height:1.6;margin-bottom:8px;', text: 'Chưa xuất.' });
    container.appendChild(sectionEl('🔍 Preflight', pfBox));
    container.appendChild(reportBox);

    var q = function (id) { return container.querySelector('#' + id); };
    var qVal = function (id) { var n = q(id); return n ? n.value : ''; };
    var qChk = function (id) { var n = q(id); return n ? !!n.checked : false; };
    var collectOpts = function () {
      var selectedClips = clipChecks.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
      var slots = TEX_SLOTS.filter(function (s) { return slotChecks[s] && slotChecks[s].checked; });
      var texEmbed = true;
      var embedRadios = container.querySelectorAll('input[name="arp-tex-embed"]');
      embedRadios.forEach(function (r) { if (r.checked && r.value === 'external') texEmbed = false; });
      var opts = {
        format: state.format,
        preset: state.preset,
        version: parseInt(verSel.value, 10) || 7300,
        ascii: asciiChk.checked,
        keepSkeleton: qChk('arp-bone-keep'),
        keepSkin: qChk('arp-bone-skin'),
        maxInfluences: parseInt(qVal('arp-bone-infl'), 10) || 4,
        normalizeWeights: qChk('arp-bone-norm'),
        bindPose: qVal('arp-bone-bind') || 'current',
        rename: (qChk('arp-bone-strip') || qChk('arp-bone-swap')) ? { stripPrefix: qChk('arp-bone-strip'), swapLR: qChk('arp-bone-swap') } : null,
        animationSelection: selectedClips.length === clips.length ? 'all' : 'selected',
        selectedClipIds: selectedClips,
        bakeFps: parseInt(qVal('arp-anim-bake'), 10) || 0,
        rootMotion: qChk('arp-anim-root'),
        loop: qVal('arp-anim-loop') || 'loop',
        reduceTolerance: parseFloat(qVal('arp-anim-tol')) || 0,
        mesh: {
          targetTris: parseInt(qVal('arp-mesh-tris'), 10) || 0,
          weld: qChk('arp-mesh-weld'),
          normals: qVal('arp-mesh-norm') || 'keep',
          triangulate: qChk('arp-mesh-tri')
        },
        lod: qChk('arp-mesh-lod') ? { enabled: true, targetTris: parseInt(qVal('arp-mesh-lodtris'), 10) || 15000 } : null,
        texture: {
          embed: texEmbed,
          size: parseInt(qVal('arp-tex-size'), 10) || 0,
          format: qVal('arp-tex-fmt') || 'auto',
          quality: parseFloat(q('arp-tex-q') ? q('arp-tex-q').value : '0.85') || 0.85,
          slots: slots
        }
      };
      opts.presetDef = resolvePreset(state.preset).preset;
      return opts;
    };
    state.collectOpts = collectOpts;

    var renderPf = function (pf) {
      pfBox.innerHTML = '';
      if (!pf) { pfBox.textContent = 'Chưa kiểm tra.'; return; }
      var st = pf.stats || {};
      pfBox.appendChild(el('div', { text: (st.meshes || 0) + ' mesh · ' + (st.tris || 0) + ' tris · ' + (st.bones || 0) + ' xương · ' + (st.textures || 0) + ' texture · ước tính ' + ((U && U.formatBytes) ? U.formatBytes(pf.estSizeBytes) : pf.estSizeBytes + ' B') }));
      if (pf.blocked) pfBox.appendChild(el('div', { style: 'color:var(--error,#f66);', html: '<b>⛔ CHẶN XUẤT:</b> ' + pf.errors.join('; ') }));
      else if (pf.errors.length) pfBox.appendChild(el('div', { style: 'color:var(--error,#f66);', text: 'Lỗi: ' + pf.errors.join('; ') }));
      pf.warnings.forEach(function (w) {
        pfBox.appendChild(el('div', { style: 'color:var(--warning,#fa0);', text: '⚠ ' + w }));
      });
      if (!pf.blocked && !pf.warnings.length) pfBox.appendChild(el('div', { style: 'color:var(--success,#4c4);', text: '✓ Sẵn sàng xuất.' }));
    };

    var btnRow = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;' });
    btnRow.appendChild(el('button', {
      class: 'btn', text: '🔍 Kiểm tra trước khi xuất',
      onclick: function () {
        var opts = collectOpts();
        var pf = preflight(null, opts);
        renderPf(pf);
      }
    }));
    var exportBtn = el('button', {
      class: 'btn primary', text: '⬇ Xuất',
      onclick: function () {
        if (state.busy) return;
        if (state.format === 'glb' && state.preset === 'mixamo') {
          notify('warning', 'Export', 'Preset Mixamo chỉ áp dụng cho FBX — đổi format sang FBX hoặc đổi preset.');
          return;
        }
        state.busy = true;
        exportBtn.textContent = 'Đang xuất…';
        reportBox.textContent = 'Đang xuất…';
        var opts = collectOpts();
        exportFile(null, opts).then(function (r) {
          state.busy = false;
          exportBtn.textContent = '⬇ Xuất';
          renderPf(r.preflight || null);
          if (!r.ok) { reportBox.textContent = '✕ Xuất thất bại: ' + (r.error || 'lỗi không rõ.'); return; }
          var st = r.stats || {};
          var fmtSize = (U && U.formatBytes) ? U.formatBytes(r.sizeBytes) : (r.sizeBytes + ' B');
          reportBox.innerHTML = '';
          reportBox.appendChild(el('div', { style: 'color:var(--success,#4c4);', html: '<b>✓ ' + r.filename + '</b> (' + fmtSize + ')' }));
          reportBox.appendChild(el('div', { text: (st.meshes || 0) + ' mesh · ' + (st.tris || 0) + ' tris · ' + r.boneCount + ' xương · skin ' + (r.hasSkin ? 'có' : 'không') + ' · ' + (st.textures || 0) + ' texture nhúng' }));
          if (r.format === 'fbx') reportBox.appendChild(el('div', { text: 'Kèm ' + r.pyFilename + ' — mở .py trong Blender để lưu ' + r.blendFilename + '.' }));
          else reportBox.appendChild(el('div', { text: 'GLB không kèm file .py (script .py chỉ import FBX).' }));
          if (r.lod && r.lod.bytes) reportBox.appendChild(el('div', { text: 'Kèm LOD: ' + r.lod.filename + ' (' + r.lod.tris + ' tris).' }));
          renderHistory();
        });
      }
    });
    btnRow.appendChild(exportBtn);
    btnRow.appendChild(el('button', {
      class: 'btn', text: '📦 Xuất hàng loạt (mọi model trong scene)',
      onclick: function () {
        if (state.busy) return;
        state.busy = true;
        var models = listSceneModels();
        if (!models.length) { notify('warning', 'Export batch', 'Không có model nào trong scene.'); state.busy = false; return; }
        exportBatch(models.map(function (m) { return { target: m, modelName: m.name }; }), collectOpts()).then(function (results) {
          state.busy = false;
          var okCount = results.filter(function (r) { return r.ok; }).length;
          reportBox.textContent = 'Batch xong: ' + okCount + '/' + results.length + ' model xuất được.';
          renderHistory();
        });
      }
    }));
    container.appendChild(btnRow);

    /* ---- lịch sử ---- */
    var histBox = el('div', { class: 'arp-export-history small', style: 'line-height:1.8;' });
    var renderHistory = function () {
      histBox.innerHTML = '';
      var hist = getHistory();
      histBox.appendChild(el('div', { class: 'dim', style: 'font-weight:600;', text: '🕘 Lịch sử xuất gần nhất (' + hist.length + ')' }));
      if (!hist.length) {
        histBox.appendChild(el('div', { class: 'dim', text: 'Chưa có lần xuất nào.' }));
        return;
      }
      hist.forEach(function (h) {
        var row = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' });
        row.appendChild(el('span', { text: h.filename + ' · ' + h.preset + ' · ' + ((U && U.formatBytes) ? U.formatBytes(h.sizeBytes) : h.sizeBytes + ' B') + ' · ' + (h.time || '').slice(0, 19).replace('T', ' ') }));
        row.appendChild(el('button', {
          class: 'btn sm', text: '⬇ Tải lại',
          onclick: function () {
            var r = redownloadHistory(h.id);
            if (!r.ok) notify('warning', 'Lịch sử', r.error);
          }
        }));
        histBox.appendChild(row);
      });
      histBox.appendChild(el('button', {
        class: 'btn sm', text: 'Xóa lịch sử',
        onclick: function () { clearHistory(); renderHistory(); }
      }));
    };
    renderHistory();
    container.appendChild(histBox);
  }
  ArpExport.renderExportTab = renderExportTab;

  /* Đăng ký tab khi shell đã có; guard để module chạy độc lập. */
  if (window.PixiStudio && PixiStudio.ArpPanel && typeof PixiStudio.ArpPanel.registerTab === 'function') {
    PixiStudio.ArpPanel.registerTab('export', 'Export', renderExportTab);
  }

  ArpExport._test = {
    PRESETS: PRESETS,
    resolveVersion: resolveVersion,
    resolvePreset: resolvePreset,
    resolveOptions: resolveOptions,
    exportFBX: exportFBX,
    exportFBXAsync: exportFBXAsync,
    exportGLB: exportGLB,
    exportFile: exportFile,
    exportBatch: exportBatch,
    preflight: preflight,
    countStats: countStats,
    sanitizeName: sanitizeName,
    cloneExportTarget: cloneExportTarget,
    renameBones: renameBones,
    limitInfluences: limitInfluences,
    normalizeSkinWeights: normalizeSkinWeights,
    weldGeometry: weldGeometry,
    decimateGeometry: decimateGeometry,
    prepareTextures: prepareTextures,
    listClipsForExport: listClipsForExport,
    bakeClip: bakeClip,
    reduceClip: reduceClip,
    buildBlenderScriptEx: buildBlenderScriptEx,
    getHistory: getHistory,
    redownloadHistory: redownloadHistory,
    saveCustomPreset: saveCustomPreset,
    loadCustomPreset: loadCustomPreset,
    listCustomPresets: listCustomPresets,
    deleteCustomPreset: deleteCustomPreset,
    listSceneModels: listSceneModels,
    getMeshopt: getMeshopt,
    ensureMeshopt: ensureMeshopt
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpExport = ArpExport;
})();
