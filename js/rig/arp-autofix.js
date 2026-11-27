/* ============================================================
 * js/rig/arp-autofix.js — "CHỈNH SỬA AUTO" (Auto Fix) cho
 * Auto Rig Pro Blend — PHẦN (C).
 *
 * 1 section trong cửa sổ ARP (tab Quick Rig, qua
 * ArpQuickRig.registerSection — mẫu QR3) với 4 bước, mỗi bước
 * có nút chạy riêng + nút "Chạy tất cả" + báo cáo TRƯỚC/SAU:
 *   (a) Sửa trục Z-up → Y-up (xoay -90°/+90° quanh X theo hướng
 *       đầu) rồi chuẩn hoá chiều cao + chân chạm đất (toán học
 *       của Manager.normalize: cao chuẩn 2.0m, đáy y=0, giữa XZ —
 *       nhưng BAKE vào geometry/xương/clip để file FBX xuất ra
 *       giữ nguyên, vì Manager.normalize chỉ đổi scale/position
 *       của object root mà writer không bake theo).
 *   (b) Pivot về điểm đất giữa 2 bàn chân (từ 2 xương mắt cá
 *       Ankle L/R — Mixamo dùng LeftFoot/RightFoot; chưa rig thì
 *       từ 2 cụm đỉnh thấp nhất của mesh, chia theo X).
 *   (c) Ground clip: chỉnh Hips/root Y theo từng keyframe sao
 *       cho bàn chân thấp nhất chạm y=0 mọi frame (chỉ đổi Y của
 *       root, GIỮ NGUYÊN X/Z + xoay) — logic theo recipe chuẩn
 *       Standard Character v1 (docs/STANDARD_CHARACTER.md) +
 *       pass tinh chỉnh dày 48Hz: Hips Y nội suy tuyến tính giữa
 *       2 key trong khi bàn chân cong phi tuyến nên ngón chân có
 *       thể lún ~3cm GIỮA 2 key — pass này chèn key Hips Y tại
 *       các mẫu 48Hz còn lún (key cũ không mất, X/Z không đổi).
 *   (d) Low poly ~15.000 tris bằng MeshoptSimplifier (như nút
 *       "Tối ưu FBX": weld → decimate → compact → weld lại),
 *       GIỮ skeleton + skin weights + clips + texture; clip được
 *       ground LẠI trên mesh đã decimate (meshopt làm ngắn đầu
 *       ngón chân tới ~1cm) rồi mới xuất FBX 7300
 *       `<tên>_LowPoly-Grounded.fbx` qua FBXBinary.write.
 *       LƯU Ý: fbx2gltf 0.9.7 convert được file này (mesh/skin/
 *       texture) nhưng báo 0 animation channels — giới hạn có sẵn
 *       của FBXBinary.write, file golden chuẩn cũng bị y hệt;
 *       clip kiểm chứng bằng FBXLoader r128 (đọc đủ 3 clip).
 *
 * ĐĂNG KÝ (registry ĐÃ CÓ — js/rig/arp-plugins.js, load sau
 * arp-panel.js, TRƯỚC các module tab ARP):
 *   - Chính: PixiStudio.ArpPlugins.register('auto-fix', {tab: true,
 *     render, onEnable, onDisable}) → tab riêng 'plugin:auto-fix'
 *     trong cửa sổ ARP + dòng quản lý trong tab Plugins. ctx của
 *     registry (ctx.getModel()/getSkeleton()/notify()) được dùng
 *     để lấy model khi render từ tab plugin.
 *   - Dự phòng (CHỈ khi không có registry — panel cũ):
 *     ArpQuickRig.registerSection('autofix', render) — section
 *     hiện trong tab Quick Rig (mẫu QR3); ArpPanel.registerTab(
 *     'autofix', ...) — tab trực tiếp mở bằng showTab('autofix').
 *     Khi registry đã có thì KHÔNG đăng ký 2 đường này.
 *   - LƯU Ý panel (sửa 2026-11-27 — bug trùng tab): renderTabBar
 *     trong js/ui/arp-panel.js vẽ MỌI tab đã đăng ký ngoài
 *     TAB_ORDER (không chỉ 'plugin:*'), nên registerTab('autofix')
 *     tạo thêm 1 nút tab "Chỉnh sửa auto" trùng với tab plugin
 *     "Chỉnh sửa auto (Auto Fix)". Ghi chú cũ ("nút tab đó không
 *     hiện — chỉ mở được bằng showTab") là SAI và đã gây trùng.
 *
 * GIỚI HẠN (ghi rõ để khỏi hiểu lầm):
 *   - Ground clip chỉ sửa Y của root (Hips), không sửa xoay bàn
 *     chân / khớp gối — clip có tư thế ngồi xổm sâu, robe chạm
 *     đất vẫn có thể còn đỉnh robe dưới y=0 (lỗi skinning gốc,
 *     không phải lỗi ground).
 *   - Decimate meshopt có floor do mesh rời rạc: mesh gồm nhiều
 *     mảnh rời / đỉnh đã weld hết cỡ thì không giảm thêm được;
 *     khi đó báo đúng tris đạt được, không ép số.
 *   - Bước (a) chỉ nhận diện Z-up qua bbox hình học (trục dài
 *     nhất); file có bbox gần vuông (tỉ lệ < 1.5x) thì mặc định
 *     Y-up, không xoay.
 *   - Chưa rig: bước (c) báo "model chưa có clip", bước (d) báo
 *     "cần rig trước" + nút chuyển sang tab Smart.
 * ============================================================ */
(function () {
  'use strict';

  var THREE = (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
  var TARGET_HEIGHT = 2.0; /* = CONFIG.TARGET_HEIGHT của Manager.normalize */
  var TARGET_TRIS = 15000;
  var MAX_TRIS = 16000;
  var FOOT_CLASS_RADIUS = 0.15; /* m, như recipe Standard Character */
  var MESHOPT_ERROR = 0.02; /* sai số meshopt (m), như nút Tối ưu FBX */

  function getThree() {
    if (THREE) return THREE;
    if (typeof window !== 'undefined' && window.THREE) { THREE = window.THREE; return THREE; }
    return null;
  }
  function notify(type, title, message) {
    try {
      var P = (typeof window !== 'undefined') ? window.PixiStudio : null;
      if (P && P.bus && P.bus.emit) P.bus.emit('notify', { type: type, title: title, message: message });
    } catch (e) { /* no bus: im lặng */ }
  }
  function san(name) { return String(name || '').replace(/^mixamorig:?/i, '').replace(/:/g, ''); }
  function r4(v) { return Math.round(v * 10000) / 10000; }
  function fmt3(v) { return '[' + r4(v[0]) + ', ' + r4(v[1]) + ', ' + r4(v[2]) + ']'; }
  function sanitizeName(name) {
    return String(name || 'model').replace(/\.(glb|gltf|fbx|obj|stl)$/i, '')
      .replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'model';
  }
  function triCountOf(geo) {
    if (!geo || !geo.attributes || !geo.attributes.position) return 0;
    return Math.floor((geo.index ? geo.index.count : geo.attributes.position.count) / 3);
  }
  function countTris(root) {
    var total = 0, meshes = 0;
    if (!root || !root.traverse) return { tris: 0, meshes: 0 };
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      if (o.userData && o.userData.isBoneVisual) return;
      meshes++;
      total += triCountOf(o.geometry);
    });
    return { tris: total, meshes: meshes };
  }

  /* ---------- tìm model / mesh / xương / clip ---------- */
  function findMeshes(model) {
    var out = [];
    if (!model || !model.traverse) return out;
    model.traverse(function (o) {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        if (o.userData && o.userData.isBoneVisual) return;
        out.push(o);
      }
    });
    return out;
  }
  function findMainMesh(model) {
    var meshes = findMeshes(model);
    if (!meshes.length) return null;
    for (var i = 0; i < meshes.length; i++) if (meshes[i].isSkinnedMesh) return meshes[i];
    return meshes[0];
  }
  function findBones(model) {
    var bones = [];
    if (!model || !model.traverse) return bones;
    model.traverse(function (o) { if (o.isBone) bones.push(o); });
    return bones;
  }
  function findRootBone(bones) {
    var roots = bones.filter(function (b) {
      var p = b.parent;
      while (p) { if (p.isBone) return false; p = p.parent; }
      return true;
    });
    if (!roots.length) return null;
    if (roots.length === 1) return roots[0];
    for (var i = 0; i < roots.length; i++) if (/hips/i.test(san(roots[i].name))) return roots[i];
    return roots[0];
  }
  function getClips(model) {
    if (!model) return [];
    if (Array.isArray(model.animations) && model.animations.length) return model.animations;
    var entry = model.userData && model.userData.modelEntry;
    if (entry && Array.isArray(entry.clips) && entry.clips.length) return entry.clips;
    return [];
  }
  function setClips(model, clips) {
    model.animations = clips;
    var entry = model.userData && model.userData.modelEntry;
    if (entry) entry.clips = clips;
  }
  function getTarget() {
    var P = (typeof window !== 'undefined') ? window.PixiStudio : null;
    if (!P) return null;
    if (P.State && P.State.get) {
      var sel = P.State.get('selection');
      if (sel) return sel;
    }
    if (P.Viewport && P.Viewport.getMainModel) {
      var m = P.Viewport.getMainModel();
      if (m) return m;
    }
    if (P.Models && P.Models.getCurrent) {
      var cur = P.Models.getCurrent();
      if (cur && cur.object3D) return cur.object3D;
    }
    return null;
  }

  /* ---------- clip helpers: chỉ đổi track của root bone ---------- */
  function transformRootTracks(clips, rootBone, matrix4, quat) {
    var T = getThree();
    (clips || []).forEach(function (clip) {
      clip.tracks = clip.tracks.map(function (t) {
        var dot = t.name.lastIndexOf('.');
        if (t.name.slice(0, dot) !== rootBone.name) return t;
        var prop = t.name.slice(dot + 1);
        var times = Array.prototype.slice.call(t.times);
        if (prop === 'position') {
          var vals = [];
          for (var i = 0; i < times.length; i++) {
            var v = new T.Vector3(t.values[i * 3], t.values[i * 3 + 1], t.values[i * 3 + 2]);
            if (matrix4) v.applyMatrix4(matrix4);
            vals.push(v.x, v.y, v.z);
          }
          return new T.VectorKeyframeTrack(t.name, times, vals);
        }
        if (prop === 'quaternion' && quat) {
          var qv = [];
          var q = new T.Quaternion();
          for (var j = 0; j < times.length; j++) {
            q.set(t.values[j * 4], t.values[j * 4 + 1], t.values[j * 4 + 2], t.values[j * 4 + 3]);
            q.premultiply(quat).normalize();
            qv.push(q.x, q.y, q.z, q.w);
          }
          return new T.QuaternionKeyframeTrack(t.name, times, qv);
        }
        return t;
      });
    });
  }
  function shiftRootTracks(clips, rootBone, dx, dy, dz) {
    (clips || []).forEach(function (clip) {
      clip.tracks.forEach(function (t) {
        var dot = t.name.lastIndexOf('.');
        if (t.name.slice(0, dot) === rootBone.name && t.name.slice(dot + 1) === 'position') {
          for (var i = 0; i < t.times.length; i++) {
            t.values[i * 3] += dx; t.values[i * 3 + 1] += dy; t.values[i * 3 + 2] += dz;
          }
        }
      });
    });
  }
  function scaleRootTracks(clips, rootBone, s) {
    (clips || []).forEach(function (clip) {
      clip.tracks.forEach(function (t) {
        var dot = t.name.lastIndexOf('.');
        if (t.name.slice(0, dot) === rootBone.name && t.name.slice(dot + 1) === 'position') {
          for (var i = 0; i < t.times.length; i++) {
            t.values[i * 3] *= s; t.values[i * 3 + 1] *= s; t.values[i * 3 + 2] *= s;
          }
        }
      });
    });
  }

  /* ---------- BAKE transform của root object vào nội dung ----------
   * Manager.normalize đổi scale/position của object root; writer FBX
   * với upAxis 'keep' + autoScale false KHÔNG bake transform đó vào
   * geometry/xương nên file xuất ra sẽ lệch. Hàm này dời toàn bộ
   * transform của root (+ các node trung gian không phải xương) vào
   * geometry (world) + rootBone local + clip root tracks, rồi reset
   * root về identity. Bảo toàn matrixWorld của mọi xương. */
  function bakeRootTransform(model, mesh, rootBone, clips) {
    var T = getThree();
    if (!model || !mesh) return { baked: false, reason: 'no-model-or-mesh' };
    /* rootBone phải có chuỗi tổ tiên tới model không chứa xương */
    var chain = [];
    if (rootBone) {
      var p = rootBone.parent;
      while (p && p !== model) {
        if (p.isBone) return { baked: false, reason: 'root-bone parent chain contains a bone' };
        chain.push(p); p = p.parent;
      }
      if (p !== model && rootBone.parent !== model) return { baked: false, reason: 'root-bone is not under model root' };
    }
    model.updateMatrixWorld(true);
    var parentWorld = (rootBone && rootBone.parent) ? rootBone.parent.matrixWorld.clone() : new T.Matrix4();
    var rootWorld = rootBone ? rootBone.matrixWorld.clone() : null;
    var meshes = findMeshes(model);
    var meshWorlds = meshes.map(function (m) { return m.matrixWorld.clone(); });
    /* 1. geometry -> world */
    meshes.forEach(function (m, i) { m.geometry.applyMatrix4(meshWorlds[i]); });
    /* 2. reset transform của model + node trung gian + chính các mesh */
    var anc = [model].concat(chain);
    meshes.forEach(function (m) {
      var q = m.parent;
      while (q && q !== model) { if (anc.indexOf(q) < 0) anc.push(q); q = q.parent; }
    });
    anc.forEach(function (n) { n.position.set(0, 0, 0); n.quaternion.identity(); n.scale.set(1, 1, 1); });
    meshes.forEach(function (m) { m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1); });
    /* 3. rootBone local = world cũ (cha giờ là identity) */
    if (rootBone && rootWorld) {
      var wp = new T.Vector3(), wq = new T.Quaternion(), ws = new T.Vector3();
      rootWorld.decompose(wp, wq, ws);
      rootBone.position.copy(wp);
      rootBone.quaternion.copy(wq);
      rootBone.scale.copy(ws);
    }
    /* 4. clip root tracks: local cũ -> world (cha cũ) == local mới */
    if (rootBone && clips && clips.length) {
      var pq = new T.Quaternion().setFromRotationMatrix(parentWorld);
      transformRootTracks(clips, rootBone, parentWorld, pq);
    }
    model.updateMatrixWorld(true);
    if (mesh.isSkinnedMesh && mesh.skeleton) mesh.skeleton.calculateInverses();
    return { baked: true };
  }

  /* ---------- (a) PHÁT HIỆN + SỬA TRỤC ---------- */
  function detectUpAxis(mesh, bones) {
    var geo = mesh.geometry;
    geo.computeBoundingBox();
    var bb = geo.boundingBox;
    var ex = bb.max.x - bb.min.x, ey = bb.max.y - bb.min.y, ez = bb.max.z - bb.min.z;
    var up = null, how = '';
    if (ez > ey * 1.5 && ez >= ex) { up = 'Z'; how = 'bbox trục dài nhất là Z (' + r4(ez) + 'm so với Y ' + r4(ey) + 'm)'; }
    else if (ey > ez * 1.5 && ey >= ex) { up = 'Y'; how = 'bbox trục dài nhất là Y (' + r4(ey) + 'm so với Z ' + r4(ez) + 'm)'; }
    else { up = 'Y'; how = 'bbox không rõ ràng (Y ' + r4(ey) + 'm, Z ' + r4(ez) + 'm, X ' + r4(ex) + 'm) — mặc định Y-up, không xoay'; }
    return { up: up, how: how, extents: [r4(ex), r4(ey), r4(ez)], bboxMin: [r4(bb.min.x), r4(bb.min.y), r4(bb.min.z)], bboxMax: [r4(bb.max.x), r4(bb.max.y), r4(bb.max.z)] };
  }
  function normalizeObject(model) {
    /* Dùng Manager.normalize có sẵn khi chạy trong studio (nó scale về
       cao 2.0m, đáy y=0, giữa XZ); ngoài studio dùng cùng công thức. */
    var P = (typeof window !== 'undefined') ? window.PixiStudio : null;
    if (P && P.Models && typeof P.Models.normalize === 'function') { P.Models.normalize(model); return 'Manager.normalize'; }
    var T = getThree();
    var box = new T.Box3().setFromObject(model);
    if (box.isEmpty()) return 'empty';
    var size = box.getSize(new T.Vector3());
    var center = box.getCenter(new T.Vector3());
    var scale = TARGET_HEIGHT / Math.max(0.0001, size.y);
    model.scale.multiplyScalar(scale);
    model.updateMatrixWorld(true);
    var box2 = new T.Box3().setFromObject(model);
    var center2 = box2.getCenter(new T.Vector3());
    model.position.x -= center2.x;
    model.position.z -= center2.z;
    model.position.y -= box2.min.y;
    model.updateMatrixWorld(true);
    return 'internal-normalize (same math as Manager.normalize)';
  }
  function contentAdjust(model, mesh, bones, rootBone, clips) {
    /* Sau bake: hiệu chỉnh cuối trên nội dung (scale về đúng 2.0m,
       đáy y=0, giữa XZ) — đảm bảo số đo sau bước (a) luôn đúng dù
       đường normalize nào đã chạy.
       QUAN TRỌNG: scale phải áp cho CẢ geometry + vị trí local của
       MỌI xương + MỌI position track trong clip (không chỉ root),
       nếu không skeleton lệch khỏi mesh. Tịnh tiến thì chỉ cần ở
       root (lan qua hierarchy). */
    var T = getThree();
    var geo = mesh.geometry;
    geo.computeBoundingBox();
    var bb = geo.boundingBox;
    var h = bb.max.y - bb.min.y;
    if (h <= 0) return { adjusted: false, reason: 'zero-height bbox' };
    var s = TARGET_HEIGHT / h;
    var did = false;
    if (Math.abs(s - 1) > 1e-4) {
      geo.scale(s, s, s);
      (bones || []).forEach(function (b) { b.position.multiplyScalar(s); });
      (clips || []).forEach(function (clip) {
        clip.tracks.forEach(function (t) {
          var dot = t.name.lastIndexOf('.');
          if (t.name.slice(dot + 1) !== 'position') return;
          for (var i = 0; i < t.times.length; i++) {
            t.values[i * 3] *= s; t.values[i * 3 + 1] *= s; t.values[i * 3 + 2] *= s;
          }
        });
      });
      did = true;
    }
    geo.computeBoundingBox();
    bb = geo.boundingBox;
    var cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2, minY = bb.min.y;
    var dx = -cx, dy = -minY, dz = -cz;
    if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6 || Math.abs(dz) > 1e-6) {
      geo.translate(dx, dy, dz);
      if (rootBone) rootBone.position.x += dx, rootBone.position.y += dy, rootBone.position.z += dz;
      if (clips && clips.length && rootBone) shiftRootTracks(clips, rootBone, dx, dy, dz);
      did = true;
    }
    model.updateMatrixWorld(true);
    if (mesh.isSkinnedMesh && mesh.skeleton) mesh.skeleton.calculateInverses();
    geo.computeBoundingBox();
    bb = geo.boundingBox;
    return { adjusted: did, scale: r4(s), heightAfter: r4(bb.max.y - bb.min.y), minYAfter: r4(bb.min.y) };
  }

  function fixAxes(model, opts) {
    opts = opts || {};
    var T = getThree();
    if (!T) return { ok: false, step: 'axes', reason: 'THREE chưa sẵn sàng' };
    var mesh = findMainMesh(model);
    if (!mesh) return { ok: false, step: 'axes', reason: 'no-mesh', message: 'Không tìm thấy mesh nào trong model.' };
    var bones = findBones(model);
    var rootBone = findRootBone(bones);
    var clips = getClips(model);
    var det = detectUpAxis(mesh, bones);
    var heightBefore = det.up === 'Z' ? det.extents[2] : det.extents[1];
    var applied = false, angleDeg = 0, why = '';
    if (det.up === 'Z') {
      /* Hướng xoay: đầu ở -Z -> Rx(+90°); đầu ở +Z -> Rx(-90°) để đầu lên +Y */
      var angle = Math.PI / 2;
      var head = null;
      for (var i = 0; i < bones.length; i++) if (/^head$/i.test(san(bones[i].name))) { head = bones[i]; break; }
      model.updateMatrixWorld(true);
      if (head) {
        var wp = new T.Vector3();
        head.getWorldPosition(wp);
        angle = wp.z < 0 ? Math.PI / 2 : -Math.PI / 2;
        why = 'xương đầu ' + head.name + ' ở world Z=' + r4(wp.z);
      } else {
        var bb = mesh.geometry.boundingBox;
        angle = Math.abs(bb.min.z) >= Math.abs(bb.max.z) ? Math.PI / 2 : -Math.PI / 2;
        why = 'không có xương đầu; bbox Z [' + r4(bb.min.z) + ', ' + r4(bb.max.z) + ']';
      }
      var R4 = new T.Matrix4().makeRotationX(angle);
      var Rq = new T.Quaternion().setFromEuler(new T.Euler(angle, 0, 0));
      mesh.geometry.applyMatrix4(R4);
      if (rootBone) {
        rootBone.position.applyMatrix4(R4);
        rootBone.quaternion.premultiply(Rq);
      }
      model.updateMatrixWorld(true);
      if (mesh.isSkinnedMesh && mesh.skeleton) mesh.skeleton.calculateInverses();
      if (clips.length && rootBone) transformRootTracks(clips, rootBone, R4, Rq);
      applied = true;
      angleDeg = Math.round(angle * 180 / Math.PI);
    }
    var normHow = normalizeObject(model);
    var bake = bakeRootTransform(model, mesh, rootBone, clips);
    var adj = contentAdjust(model, mesh, bones, rootBone, clips);
    mesh.geometry.computeBoundingBox();
    var bb2 = mesh.geometry.boundingBox;
    return {
      ok: true, step: 'axes',
      detectedUp: det.up, detectHow: det.how,
      applied: applied, angleDeg: angleDeg, rotateWhy: why,
      heightBefore: r4(heightBefore),
      heightAfter: r4(bb2.max.y - bb2.min.y),
      minYAfter: r4(bb2.min.y),
      normalizeHow: normHow, baked: bake.baked, bakeReason: bake.reason || null,
      contentAdjust: adj,
      message: applied
        ? 'Model vốn Z-up (' + det.how + ') — đã xoay Rx(' + angleDeg + '°) về Y-up; cao ' + r4(heightBefore) + 'm → ' + r4(bb2.max.y - bb2.min.y) + 'm, chân chạm y=0.'
        : 'Model vốn đã Y-up (' + det.how + ') — không cần xoay; cao chuẩn hoá ' + r4(bb2.max.y - bb2.min.y) + 'm, chân chạm y=0.'
    };
  }

  /* ---------- (b) PIVOT VỀ ĐIỂM ĐẤT GIỮA 2 BÀN CHÂN ---------- */
  function findAnkleBones(bones) {
    var ankle = bones.filter(function (b) { return /ankle/i.test(san(b.name)); });
    var foot = bones.filter(function (b) { return /foot/i.test(san(b.name)) && !/toe/i.test(san(b.name)); });
    var pool = ankle.length >= 2 ? ankle : foot;
    var left = null, right = null;
    pool.forEach(function (b) {
      var n = san(b.name);
      if (/left/i.test(n)) left = b;
      else if (/right/i.test(n)) right = b;
    });
    if (!left || !right) {
      /* Không có tên L/R rõ ràng: lấy 2 xương có X trái dấu nhau */
      if (pool.length >= 2) {
        pool.forEach(function (b) {
          var v = new (getThree()).Vector3();
          b.getWorldPosition(v);
          if (v.x >= 0 && !left) left = b;
          if (v.x < 0 && !right) right = b;
        });
      }
    }
    return { left: left, right: right, kind: ankle.length >= 2 ? 'ankle' : 'foot' };
  }
  function clusterBottomVerts(mesh) {
    var T = getThree();
    var geo = mesh.geometry;
    geo.computeBoundingBox();
    var bb = geo.boundingBox;
    var h = bb.max.y - bb.min.y;
    if (h <= 0) return { ok: false, reason: 'zero-height' };
    var band = bb.min.y + Math.max(0.02, h * 0.03);
    var posA = geo.attributes.position.array;
    var n = geo.attributes.position.count;
    var xs = [], pts = [];
    for (var i = 0; i < n; i++) {
      var y = posA[i * 3 + 1];
      if (y <= band) { xs.push(posA[i * 3]); pts.push([posA[i * 3], posA[i * 3 + 2]]); }
    }
    if (pts.length < 20) return { ok: false, reason: 'too-few-bottom-verts', count: pts.length };
    xs.sort(function (a, b) { return a - b; });
    var bestGap = 0, bestIdx = -1;
    for (var j = 1; j < xs.length; j++) {
      var g = xs[j] - xs[j - 1];
      if (g > bestGap) { bestGap = g; bestIdx = j; }
    }
    /* Hai bàn chân phải tách nhau bằng 1 khoảng trống rõ ràng; mesh
       đặc (hộp, cầu) có đỉnh đáy trải đều theo X nên gap lớn nhất rất
       nhỏ → không phải humanoid. */
    if (bestGap < Math.max(0.02, h * 0.02)) return { ok: false, reason: 'not-humanoid', detail: 'đỉnh đáy trải đều theo X, không tách thành 2 cụm (gap lớn nhất ' + r4(bestGap) + 'm)' };
    var splitX = (xs[bestIdx - 1] + xs[bestIdx]) / 2;
    var cA = { x: 0, z: 0, n: 0, minX: Infinity, maxX: -Infinity }, cB = { x: 0, z: 0, n: 0, minX: Infinity, maxX: -Infinity };
    pts.forEach(function (p) {
      var c = p[0] < splitX ? cA : cB;
      c.x += p[0]; c.z += p[1]; c.n++;
      if (p[0] < c.minX) c.minX = p[0];
      if (p[0] > c.maxX) c.maxX = p[0];
    });
    if (cA.n < 20 || cB.n < 20) return { ok: false, reason: 'not-humanoid', detail: 'một cụm đáy quá ít đỉnh (' + cA.n + '/' + cB.n + ')' };
    cA.x /= cA.n; cA.z /= cA.n; cB.x /= cB.n; cB.z /= cB.n;
    var dx = cA.x - cB.x, dz = cA.z - cB.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.03 || dist > 1.2) return { ok: false, reason: 'not-humanoid', detail: 'khoảng cách 2 cụm đáy bất thường: ' + r4(dist) + 'm' };
    /* Bàn chân thật: mỗi cụm hẹp theo X (rộng ~0.1m) so với khoảng
       cách 2 chân; khối đặc (hộp chia lưới) bị chẻ đôi thì mỗi "cụm"
       rộng bằng nửa khối → loại. */
    var rangeA = cA.maxX - cA.minX, rangeB = cB.maxX - cB.minX;
    if (rangeA < 0.02 || rangeB < 0.02) return { ok: false, reason: 'not-humanoid', detail: 'cụm đáy suy biến (rộng X ' + r4(rangeA) + '/' + r4(rangeB) + 'm)' };
    if (rangeA > 0.6 * dist || rangeB > 0.6 * dist) return { ok: false, reason: 'not-humanoid', detail: 'cụm đáy quá rộng so với khoảng cách 2 chân (rộng X ' + r4(rangeA) + '/' + r4(rangeB) + 'm, cách nhau ' + r4(dist) + 'm)' };
    return {
      ok: true, method: 'clusters',
      left: cA.x >= cB.x ? cA : cB, right: cA.x >= cB.x ? cB : cA,
      mid: [(cA.x + cB.x) / 2, (cA.z + cB.z) / 2],
      footDistance: r4(dist), gap: r4(bestGap), counts: [cA.n, cB.n]
    };
  }
  function findFeet(model, mesh, bones) {
    var T = getThree();
    if (mesh.isSkinnedMesh && mesh.skeleton) { try { mesh.skeleton.pose(); } catch (e) {} }
    model.updateMatrixWorld(true);
    var ank = findAnkleBones(bones);
    if (ank.left && ank.right) {
      var vl = new T.Vector3(), vr = new T.Vector3();
      ank.left.getWorldPosition(vl);
      ank.right.getWorldPosition(vr);
      var dx = vl.x - vr.x, dz = vl.z - vr.z;
      var dist = Math.sqrt(dx * dx + dz * dz);
      return {
        ok: true, method: 'ankles-' + ank.kind,
        left: [r4(vl.x), r4(vl.y), r4(vl.z)], right: [r4(vr.x), r4(vr.y), r4(vr.z)],
        mid: [r4((vl.x + vr.x) / 2), r4((vl.z + vr.z) / 2)],
        footDistance: r4(dist),
        leftName: ank.left.name, rightName: ank.right.name
      };
    }
    var cl = clusterBottomVerts(mesh);
    if (cl.ok) {
      return {
        ok: true, method: cl.method,
        left: [r4(cl.left.x), 0, r4(cl.left.z)], right: [r4(cl.right.x), 0, r4(cl.right.z)],
        mid: [r4(cl.mid[0]), r4(cl.mid[1])],
        footDistance: cl.footDistance, gap: cl.gap, counts: cl.counts
      };
    }
    return { ok: false, reason: 'not-humanoid', detail: cl.detail || cl.reason || 'không tìm được 2 xương mắt cá và không tách được 2 cụm đỉnh đáy' };
  }
  function fixPivot(model, opts) {
    opts = opts || {};
    var T = getThree();
    if (!T) return { ok: false, step: 'pivot', reason: 'THREE chưa sẵn sàng' };
    var mesh = findMainMesh(model);
    if (!mesh) return { ok: false, step: 'pivot', reason: 'no-mesh', message: 'Không tìm thấy mesh nào trong model.' };
    var bones = findBones(model);
    var rootBone = findRootBone(bones);
    var clips = getClips(model);
    var feet = findFeet(model, mesh, bones);
    if (!feet.ok) {
      return {
        ok: false, step: 'pivot', reason: feet.reason,
        message: 'Không phải humanoid: ' + (feet.detail || feet.reason) + '. Dừng ở bước (b) — hãy rig model humanoid (2 bàn chân / 2 mắt cá) rồi chạy lại.'
      };
    }
    mesh.geometry.computeBoundingBox();
    var minYBefore = mesh.geometry.boundingBox.min.y;
    var mx = feet.mid[0], mz = feet.mid[1];
    var dx = -mx, dy = -minYBefore, dz = -mz;
    mesh.geometry.translate(dx, dy, dz);
    if (rootBone) {
      rootBone.position.x += dx; rootBone.position.y += dy; rootBone.position.z += dz;
      if (clips.length) shiftRootTracks(clips, rootBone, dx, dy, dz);
    }
    model.updateMatrixWorld(true);
    if (mesh.isSkinnedMesh && mesh.skeleton) mesh.skeleton.calculateInverses();
    /* kiểm chứng lại */
    var feet2 = findFeet(model, mesh, bones);
    mesh.geometry.computeBoundingBox();
    var minYAfter = mesh.geometry.boundingBox.min.y;
    return {
      ok: true, step: 'pivot',
      method: feet.method,
      oldPivot: [r4(mx), r4(minYBefore), r4(mz)],
      newPivot: [0, 0, 0],
      footDistance: feet.footDistance,
      leftName: feet.leftName || null, rightName: feet.rightName || null,
      midAfter: feet2.ok ? [r4(feet2.mid[0]), r4(feet2.mid[1])] : null,
      minYAfter: r4(minYAfter),
      shift: [r4(dx), r4(dy), r4(dz)],
      message: 'Pivot cũ (điểm đất giữa 2 chân) ' + fmt3([mx, minYBefore, mz]) + ' → pivot mới (0, 0, 0). Khoảng cách 2 bàn chân ' + feet.footDistance + 'm (' + feet.method + ').'
    };
  }

  /* ---------- (c) GROUND CLIP ---------- */
  function findFootBones(bones) {
    var foot = bones.filter(function (b) { return /foot/i.test(san(b.name)); });
    var toe = bones.filter(function (b) { return /toe/i.test(san(b.name)); });
    return { foot: foot, toe: toe, all: foot.concat(toe) };
  }
  function buildFootClass(mesh, footBones) {
    var geo = mesh.geometry;
    var posA = geo.attributes.position.array;
    var nVerts = geo.attributes.position.count;
    var wp = new (getThree()).Vector3();
    var joints = footBones.map(function (b) { b.getWorldPosition(wp); return wp.clone(); });
    var footClass = new Uint8Array(nVerts);
    var cnt = 0;
    for (var vi = 0; vi < nVerts; vi++) {
      var px = posA[vi * 3], py = posA[vi * 3 + 1], pz = posA[vi * 3 + 2];
      for (var j = 0; j < joints.length; j++) {
        var d = joints[j];
        var ddx = px - d.x, ddy = py - d.y, ddz = pz - d.z;
        if (ddx * ddx + ddy * ddy + ddz * ddz <= FOOT_CLASS_RADIUS * FOOT_CLASS_RADIUS) { footClass[vi] = 1; cnt++; break; }
      }
    }
    return { footClass: footClass, count: cnt };
  }
  function makeSkinnedMinY(mesh, footClass) {
    var T = getThree();
    var geo = mesh.geometry;
    var posA = geo.attributes.position.array;
    var swA = geo.attributes.skinWeight.array;
    var siA = geo.attributes.skinIndex.array;
    var nVerts = geo.attributes.position.count;
    return function (stride, onlyFoot) {
      var skel = mesh.skeleton;
      skel.update();
      var bm = skel.boneMatrices;
      var minY = Infinity;
      for (var vi = 0; vi < nVerts; vi += stride) {
        if (onlyFoot && footClass && !footClass[vi]) continue;
        var y = 0;
        for (var k = 0; k < 4; k++) {
          var w = swA[vi * 4 + k];
          if (!w) continue;
          var m = siA[vi * 4 + k] * 16;
          y += w * (bm[m + 1] * posA[vi * 3] + bm[m + 5] * posA[vi * 3 + 1] + bm[m + 9] * posA[vi * 3 + 2] + bm[m + 13]);
        }
        if (y < minY) minY = y;
      }
      return minY;
    };
  }
  /* Nội suy tuyến tính 1 position track tại thời điểm t (position
     track trong three.js nội suy tuyến tính nên giá trị chèn thêm
     giữ nguyên đường cong X/Z). */
  function samplePositionTrack(track, t) {
    var times = track.times, vals = track.values;
    var n = times.length;
    if (t <= times[0]) return [vals[0], vals[1], vals[2]];
    if (t >= times[n - 1]) return [vals[(n - 1) * 3], vals[(n - 1) * 3 + 1], vals[(n - 1) * 3 + 2]];
    var i = 0;
    while (i < n - 2 && times[i + 1] < t) i++;
    var t0 = times[i], t1 = times[i + 1];
    var f = (t1 > t0) ? (t - t0) / (t1 - t0) : 0;
    return [
      vals[i * 3] + (vals[(i + 1) * 3] - vals[i * 3]) * f,
      vals[i * 3 + 1] + (vals[(i + 1) * 3 + 1] - vals[i * 3 + 1]) * f,
      vals[i * 3 + 2] + (vals[(i + 1) * 3 + 2] - vals[i * 3 + 2]) * f
    ];
  }
  /* Chèn key vào root position track: fixes = [{t, lift}] — tại mỗi
     mẫu còn lún, nâng Hips Y thêm lift (X/Z lấy đúng nội suy cũ nên
     chuyển động ngang không đổi; key cũ không mất). */
  function insertRootKeys(clip, rootBone, fixes) {
    var T = getThree();
    var newTracks = clip.tracks.map(function (t) {
      var dot = t.name.lastIndexOf('.');
      if (t.name.slice(0, dot) !== rootBone.name || t.name.slice(dot + 1) !== 'position') return t;
      var times = Array.prototype.slice.call(t.times);
      var vals = Array.prototype.slice.call(t.values);
      fixes.forEach(function (fx) {
        var idx = -1;
        for (var i = 0; i < times.length; i++) if (Math.abs(times[i] - fx.t) < 0.001) { idx = i; break; }
        if (idx >= 0) { vals[idx * 3 + 1] += fx.lift; return; }
        var p = samplePositionTrack(t, fx.t);
        var j = 0;
        while (j < times.length && times[j] < fx.t) j++;
        times.splice(j, 0, fx.t);
        vals.splice(j * 3, 0, p[0], p[1] + fx.lift, p[2]);
      });
      return new T.VectorKeyframeTrack(t.name, times, vals);
    });
    return new T.AnimationClip(clip.name, clip.duration, newTracks);
  }
  /* Tinh chỉnh dày: sau khi ground theo key, Hips Y nội suy tuyến
     tính giữa 2 key trong khi bàn chân cong phi tuyến → ngón chân có
     thể lún ~3cm GIỮA 2 key (đo được ở Attack t≈1.15s). Quét dày
     48Hz, chèn key Hips Y tại mẫu còn lún < -0.008m, lặp tối đa
     3 pass. Chỉ NÂNG Y (không hạ) nên không tạo thêm điểm lún mới. */
  function refineGround(model, mesh, rootBone, clip, footClass, skinnedMinY) {
    var T = getThree();
    var cur = clip, inserted = 0, passes = 0;
    for (var pass = 0; pass < 3; pass++) {
      var mixer = new T.AnimationMixer(model);
      var action = mixer.clipAction(cur);
      action.setLoop(T.LoopOnce, 1); action.clampWhenFinished = true; action.play();
      var fixes = [];
      var nSteps = Math.ceil(cur.duration * 48);
      for (var s = 0; s <= nSteps; s++) {
        var t = Math.min(cur.duration, s / 48);
        mixer.setTime(t); model.updateMatrixWorld(true);
        var f = footClass ? skinnedMinY(5, true) : skinnedMinY(5, false);
        if (f < -0.008) fixes.push({ t: t, lift: -f });
      }
      mixer.stopAllAction();
      mesh.skeleton.pose(); model.updateMatrixWorld(true);
      if (!fixes.length) break;
      passes++;
      cur = insertRootKeys(cur, rootBone, fixes);
      inserted += fixes.length;
      if (inserted > 96) break;
    }
    return { clip: cur, inserted: inserted, passes: passes };
  }
  function groundClip(model, mesh, rootBone, clip, footClass, skinnedMinY) {
    var T = getThree();
    var rootPos = null;
    for (var i = 0; i < clip.tracks.length; i++) {
      if (clip.tracks[i].name === rootBone.name + '.position') { rootPos = clip.tracks[i]; break; }
    }
    if (!rootPos) return { clip: clip, skipped: 'no ' + rootBone.name + '.position track', stats: null };
    var keyTimes = Array.prototype.slice.call(rootPos.times);
    var mixer = new T.AnimationMixer(model);
    var action = mixer.clipAction(clip);
    action.setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    var offsets = [];
    var wp = new T.Vector3();
    for (var k = 0; k < keyTimes.length; k++) {
      mixer.setTime(keyTimes[k]);
      model.updateMatrixWorld(true);
      var fMin = footClass ? skinnedMinY(1, true) : skinnedMinY(1, false);
      offsets.push(fMin);
    }
    mixer.stopAllAction();
    var newTracks = clip.tracks.map(function (t) {
      var dot = t.name.lastIndexOf('.');
      var nodeName = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
      if (nodeName === rootBone.name && prop === 'position') {
        var times = Array.prototype.slice.call(t.times);
        var vals = Array.prototype.slice.call(t.values);
        for (var j = 0; j < times.length; j++) vals[j * 3 + 1] = vals[j * 3 + 1] - offsets[j];
        return new T.VectorKeyframeTrack(t.name, times, vals);
      }
      return (typeof t.clone === 'function') ? t.clone() : t;
    });
    var grounded = new T.AnimationClip(clip.name, clip.duration, newTracks);
    /* tinh chỉnh dày 48Hz (chèn key Hips Y tại mẫu còn lún giữa 2 key) */
    var refined = refineGround(model, mesh, rootBone, grounded, footClass, skinnedMinY);
    grounded = refined.clip;
    /* kiểm chứng dày 48Hz trên clip đã ground */
    var mixer2 = new T.AnimationMixer(model);
    var action2 = mixer2.clipAction(grounded);
    action2.setLoop(T.LoopOnce, 1);
    action2.clampWhenFinished = true;
    action2.play();
    var gFootMin = Infinity, gFootMax = -Infinity, gAllMin = Infinity, gAllMax = -Infinity;
    var nSteps = Math.ceil(grounded.duration * 48);
    for (var s = 0; s <= nSteps; s++) {
      var t = Math.min(grounded.duration, s / 48);
      mixer2.setTime(t);
      model.updateMatrixWorld(true);
      var f1 = footClass ? skinnedMinY(5, true) : skinnedMinY(5, false);
      var a1 = skinnedMinY(5, false);
      if (f1 < gFootMin) gFootMin = f1;
      if (f1 > gFootMax) gFootMax = f1;
      if (a1 < gAllMin) gAllMin = a1;
      if (a1 > gAllMax) gAllMax = a1;
    }
    mixer2.stopAllAction();
    mesh.skeleton.pose();
    model.updateMatrixWorld(true);
    var maxOff = 0;
    offsets.forEach(function (o) { var a = Math.abs(o); if (a > maxOff) maxOff = a; });
    var stats = {
      name: clip.name, duration: r4(clip.duration), tracks: clip.tracks.length, keys: keyTimes.length,
      framesFixed: keyTimes.length,
      refineInserted: refined.inserted, refinePasses: refined.passes,
      rootKeysAfter: grounded.tracks.filter(function (t) { return t.name === rootBone.name + '.position'; })[0].times.length,
      maxOffset: r4(maxOff),
      offsetMin: r4(Math.min.apply(null, offsets)),
      offsetMax: r4(Math.max.apply(null, offsets)),
      dense48Hz: {
        minSoleFoot: [r4(gFootMin), r4(gFootMax)],
        minSoleAll: [r4(gAllMin), r4(gAllMax)],
        grounded: gFootMin >= -0.02 && gFootMax <= 0.02
      }
    };
    return { clip: grounded, skipped: null, stats: stats };
  }
  function groundClips(model, opts) {
    opts = opts || {};
    var T = getThree();
    if (!T) return { ok: false, step: 'ground', reason: 'THREE chưa sẵn sàng' };
    var clips = getClips(model);
    if (!clips.length) {
      return { ok: false, step: 'ground', reason: 'no-clips', clipsFixed: 0, message: 'Model chưa có clip animation nào — bước (c) bỏ qua (model chưa rig hoặc chưa gắn clip).' };
    }
    var mesh = findMainMesh(model);
    if (!mesh || !mesh.isSkinnedMesh) return { ok: false, step: 'ground', reason: 'no-rig', clipsFixed: 0, message: 'Model chưa rig (không có SkinnedMesh) nên không ground được clip.' };
    var bones = findBones(model);
    var rootBone = findRootBone(bones);
    if (!rootBone) return { ok: false, step: 'ground', reason: 'no-root-bone', clipsFixed: 0 };
    mesh.skeleton.pose();
    model.updateMatrixWorld(true);
    var footInfo = findFootBones(bones);
    var footClass = null, footCnt = 0;
    if (footInfo.all.length >= 2) {
      var fc = buildFootClass(mesh, footInfo.all);
      footClass = fc.footClass; footCnt = fc.count;
    }
    var skinnedMinY = makeSkinnedMinY(mesh, footClass);
    var stats = [], maxOffset = 0, framesTotal = 0;
    var newClips = clips.map(function (clip) {
      var r = groundClip(model, mesh, rootBone, clip, footClass, skinnedMinY);
      if (r.skipped) { stats.push({ name: clip.name, skipped: r.skipped }); return clip; }
      stats.push(r.stats);
      framesTotal += r.stats.framesFixed;
      if (r.stats.maxOffset > maxOffset) maxOffset = r.stats.maxOffset;
      return r.clip;
    });
    setClips(model, newClips);
    mesh.skeleton.pose();
    model.updateMatrixWorld(true);
    var allGrounded = stats.every(function (s) { return !s.dense48Hz || s.dense48Hz.grounded; });
    return {
      ok: true, step: 'ground',
      clips: stats, clipsFixed: stats.filter(function (s) { return !s.skipped; }).length,
      framesFixed: framesTotal, maxOffset: r4(maxOffset),
      footClassVerts: footCnt, allGrounded: allGrounded,
      message: 'Đã ground ' + stats.filter(function (s) { return !s.skipped; }).length + '/' + clips.length + ' clip, ' + framesTotal + ' keyframe; độ lệch Y lớn nhất đã khử ' + r4(maxOffset) + 'm; kiểm chứng 48Hz: ' + (allGrounded ? 'chân chạm đất mọi frame (±0.02m).' : 'CÒN frame lệch >0.02m (xem chi tiết từng clip — thường do robe/tà áo).')
    };
  }

  /* ---------- (d) LOW POLY + XUẤT FBX ---------- */
  function cloneModelForExport(root) {
    var T = getThree();
    var clone = root.clone(true);
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
        o.skeleton = new T.Skeleton(nb, o.skeleton.boneInverses);
      }
    });
    return clone;
  }
  function compactGeometry(geometry) {
    var T = getThree();
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
    if (used.length === n) return geometry;
    var newCount = used.length;
    var g = new T.BufferGeometry();
    Object.keys(geometry.attributes).forEach(function (name) {
      var attr = geometry.attributes[name];
      var itemSize = attr.itemSize;
      var Arr = attr.array.constructor;
      var out = new Arr(newCount * itemSize);
      for (var u = 0; u < newCount; u++) {
        var src = used[u];
        for (var k = 0; k < itemSize; k++) out[u * itemSize + k] = attr.array[src * itemSize + k];
      }
      g.setAttribute(name, new T.BufferAttribute(out, itemSize));
    });
    var newIdx = new Uint32Array(idxArr.length);
    for (var j2 = 0; j2 < idxArr.length; j2++) newIdx[j2] = remap[idxArr[j2]];
    g.setIndex(new T.BufferAttribute(newIdx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
  function weldGeometry(geometry) {
    var T = getThree();
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
      if (geometry.index) return geometry;
      var g0 = new T.BufferGeometry();
      Object.keys(geometry.attributes).forEach(function (nm) { g0.setAttribute(nm, geometry.attributes[nm]); });
      var idx0 = new Uint32Array(n);
      for (var j0 = 0; j0 < n; j0++) idx0[j0] = j0;
      g0.setIndex(new T.BufferAttribute(idx0, 1));
      g0.computeBoundingBox(); g0.computeBoundingSphere();
      return g0;
    }
    var g = new T.BufferGeometry();
    names.forEach(function (name) {
      var at = geometry.attributes[name];
      var itemSize = at.itemSize;
      var Arr = at.array.constructor;
      var out = new Arr(used.length * itemSize);
      for (var u = 0; u < used.length; u++) {
        var src = used[u];
        for (var k2 = 0; k2 < itemSize; k2++) out[u * itemSize + k2] = at.array[src * itemSize + k2];
      }
      g.setAttribute(name, new T.BufferAttribute(out, itemSize));
    });
    var oldIdx = geometry.index ? geometry.index.array : null;
    var idxLen = oldIdx ? oldIdx.length : n;
    var newIdx = new Uint32Array(idxLen);
    for (var j = 0; j < idxLen; j++) newIdx[j] = remap[oldIdx ? oldIdx[j] : j];
    g.setIndex(new T.BufferAttribute(newIdx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
  function waitMeshoptReady(timeoutMs) {
    var P = (typeof window !== 'undefined') ? window.PixiStudio : null;
    var MSE = P && P.MixamoSafeExport;
    if (MSE && typeof MSE.waitMeshoptReady === 'function') return MSE.waitMeshoptReady(timeoutMs || 10000);
    var M = (typeof window !== 'undefined') ? window.MeshoptSimplifier : null;
    if (!M || !M.ready) return Promise.resolve(false);
    return Promise.race([
      M.ready.then(function () { return true; }).catch(function () { return false; }),
      new Promise(function (res) { setTimeout(function () { res(false); }, timeoutMs || 10000); })
    ]);
  }
  function decimateCloneToBudget(clone, triBudget, targetError) {
    var P = (typeof window !== 'undefined') ? window.PixiStudio : null;
    var MSE = P && P.MixamoSafeExport;
    if (!MSE || typeof MSE.decimateMeshopt !== 'function') return { ok: false, reason: 'meshopt-api-missing', trisBefore: 0, trisAfter: 0 };
    var meshes = [];
    clone.traverse(function (o) {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        if (o.userData && o.userData.isBoneVisual) return;
        meshes.push(o);
      }
    });
    var total = 0;
    meshes.forEach(function (m) { total += triCountOf(m.geometry); });
    var trisAfter = total, done = 0;
    if (total > triBudget) {
      meshes.forEach(function (m, i) {
        var t = triCountOf(m.geometry);
        var share = (i === meshes.length - 1)
          ? Math.max(1, triBudget - done)
          : Math.max(1, Math.floor(triBudget * t / Math.max(1, total)));
        var welded = weldGeometry(m.geometry);
        var d = MSE.decimateMeshopt(welded, share, targetError);
        if (d) { m.geometry = weldGeometry(compactGeometry(d.geometry)); done += d.trisAfter; }
        else { m.geometry = welded; done += t; }
      });
      trisAfter = done;
    }
    return { ok: true, trisBefore: total, trisAfter: trisAfter };
  }
  function collectTextureBytes(root) {
    /* Trình duyệt: lấy map (JPEG q0.9, tối đa 1024) + normalMap (PNG,
       tối đa 1024) từ material qua canvas — đúng chuẩn Standard v1
       (map JPEG + normalMap PNG nhúng). Không có canvas thì {}. */
    var out = {};
    try {
      if (typeof document === 'undefined' || !document.createElement) return out;
      root.traverse(function (o) {
        if (!o.isMesh || !o.material) return;
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) {
          if (!m || out[m.name]) return;
          var entry = {};
          [['map', 'image/jpeg', 0.9], ['normalMap', 'image/png', undefined]].forEach(function (spec) {
            var slot = spec[0], mime = spec[1], q = spec[2];
            var tex = m[slot];
            if (!tex) return;
            var img = (tex.userData && tex.userData.originalImage) || tex.image;
            if (!img || !img.width || !img.height) return;
            var scale = Math.min(1, 1024 / Math.max(img.width, img.height));
            var w = Math.max(1, Math.round(img.width * scale));
            var h = Math.max(1, Math.round(img.height * scale));
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            var cx = c.getContext('2d');
            if (!cx) return;
            if (tex.flipY === false) { cx.translate(0, h); cx.scale(1, -1); }
            cx.drawImage(img, 0, 0, w, h);
            var url = c.toDataURL(mime, q);
            var b64 = url.split(',')[1];
            if (b64) entry[slot] = { b64: b64, mime: mime, w: w, h: h };
          });
          if (entry.map || entry.normalMap) out[m.name || ''] = entry;
        });
      });
    } catch (e) { /* canvas lỗi: xuất không texture, không crash */ }
    return out;
  }
  function checkSkinWeights(root) {
    var worst = 0, checked = 0, bad = 0;
    root.traverse(function (o) {
      if (!o.isSkinnedMesh || !o.geometry.attributes.skinWeight) return;
      var sw = o.geometry.attributes.skinWeight.array;
      var n = o.geometry.attributes.position.count;
      for (var i = 0; i < n; i += 7) {
        var s = sw[i * 4] + sw[i * 4 + 1] + sw[i * 4 + 2] + sw[i * 4 + 3];
        var d = Math.abs(s - 1);
        if (d > worst) worst = d;
        if (d > 1e-3) bad++;
        checked++;
      }
    });
    return { checked: checked, badVerts: bad, maxDev: r4(worst) };
  }
  function lowPolyExport(model, opts) {
    opts = opts || {};
    var P = (typeof window !== 'undefined') ? window.PixiStudio : null;
    var FBX = P && P.FBXBinary;
    var trisBefore = countTris(model).tris;
    var bones = findBones(model);
    var skinned = findMeshes(model).filter(function (m) { return m.isSkinnedMesh && m.skeleton && m.skeleton.bones && m.skeleton.bones.length; });
    var clips = getClips(model);
    var name = sanitizeName(opts.modelName || (P && P.Models && P.Models.current && P.Models.current.name) || model.name || 'model');
    var filename = name + '_LowPoly-Grounded.fbx';
    if (!skinned.length) {
      return Promise.resolve({
        ok: false, step: 'lowpoly', reason: 'need-rig',
        trisBefore: trisBefore, bones: bones.length, clips: clips.length,
        message: 'Model chưa rig (không có SkinnedMesh) — cần rig trước khi low-poly/xuất FBX chuẩn. Sang tab Smart để rig rồi quay lại đây.'
      });
    }
    if (!FBX || typeof FBX.write !== 'function') {
      return Promise.resolve({ ok: false, step: 'lowpoly', reason: 'fbx-writer-missing', trisBefore: trisBefore, message: 'FBXBinary.write chưa sẵn sàng.' });
    }
    var targetTris = opts.targetTris || TARGET_TRIS;
    var needReduce = trisBefore > MAX_TRIS;
    return waitMeshoptReady(10000).then(function (ready) {
      if (needReduce && !ready) {
        return { ok: false, step: 'lowpoly', reason: 'meshopt-unavailable', trisBefore: trisBefore, message: 'Meshopt chưa sẵn sàng (WASM chưa load) nên không giảm được tris. Thử lại sau vài giây.' };
      }
      var clone = cloneModelForExport(model);
      var dec = { ok: true, trisBefore: trisBefore, trisAfter: trisBefore };
      var exportClips = clips;
      var reground = null;
      if (needReduce) {
        dec = decimateCloneToBudget(clone, targetTris, opts.targetError || MESHOPT_ERROR);
        if (!dec.ok) return { ok: false, step: 'lowpoly', reason: dec.reason, trisBefore: trisBefore, message: 'Không decimate được: ' + dec.reason };
        /* Ground LẠI trên mesh đã decimate: meshopt (sai số tới 0.02m)
           làm ngắn/dịch đầu ngón chân nên clip ground theo mesh gốc
           lệch tới ~1cm khi đo trên mesh mới. Ground lại trên clone
           (chỉ đổi bản xuất, không đụng clip của model gốc). */
        clone.animations = clips;
        var rg = groundClips(clone);
        if (rg.ok) {
          exportClips = getClips(clone);
          reground = { clipsFixed: rg.clipsFixed, framesFixed: rg.framesFixed, maxOffset: rg.maxOffset, allGrounded: rg.allGrounded };
        }
      }
      var textureBytes = opts.textureBytes || collectTextureBytes(clone);
      var texCount = 0;
      Object.keys(textureBytes).forEach(function (k) { texCount += Object.keys(textureBytes[k]).length; });
      var animEntries = exportClips.map(function (c) { return { name: c.name, clip: c }; });
      var res;
      try {
        res = FBX.write(clone, {
          version: 7300, upAxis: 'keep', autoScale: false, fps: 30,
          embedTextures: true, textureBytes: textureBytes,
          keepSkeleton: true, animations: animEntries
        });
      } catch (e) {
        return { ok: false, step: 'lowpoly', reason: 'export-error', trisBefore: trisBefore, message: 'Xuất FBX lỗi: ' + (e && e.message ? e.message : e) };
      }
      if (!res || !res.bytes || !res.bytes.length) {
        return { ok: false, step: 'lowpoly', reason: 'export-empty', trisBefore: trisBefore, message: 'FBXBinary.write trả về file rỗng.' };
      }
      var skinCheck = checkSkinWeights(clone);
      return {
        ok: true, step: 'lowpoly',
        needed: needReduce, skippedReduce: !needReduce,
        trisBefore: trisBefore, trisAfter: dec.trisAfter,
        bones: bones.length, skeletonBones: skinned[0].skeleton.bones.length,
        clips: exportClips.length, clipNames: exportClips.map(function (c) { return c.name; }),
        textures: texCount,
        bytes: res.bytes, size: res.bytes.length,
        estSizeMB: r4(res.bytes.length / 1048576),
        filename: filename, report: res.report, skinCheck: skinCheck,
        regroundAfterDecimate: reground,
        message: needReduce
          ? 'Tris ' + trisBefore.toLocaleString('en-US') + ' → ' + dec.trisAfter.toLocaleString('en-US') + ' (mục tiêu ~' + targetTris.toLocaleString('en-US') + '), ' + bones.length + ' xương, ' + exportClips.length + ' clip, ' + texCount + ' texture, file ~' + r4(res.bytes.length / 1048576) + ' MB → ' + filename + (reground ? ' (đã ground lại ' + reground.clipsFixed + ' clip trên mesh decimate).' : '')
          : 'Model vốn đã ≤ ' + MAX_TRIS.toLocaleString('en-US') + ' tris (' + trisBefore.toLocaleString('en-US') + ') — không cần giảm; vẫn xuất file chuẩn ' + filename + ' (' + bones.length + ' xương, ' + exportClips.length + ' clip, ' + texCount + ' texture, ~' + r4(res.bytes.length / 1048576) + ' MB).'
      };
    });
  }

  /* ---------- CHẠY TẤT CẢ ---------- */
  function runAll(model, opts) {
    opts = opts || {};
    var steps = {};
    var axes = fixAxes(model, opts);
    steps.axes = axes;
    if (!axes.ok) return Promise.resolve({ ok: false, steps: steps, stoppedAt: 'axes', message: axes.message || axes.reason });
    var pivot = fixPivot(model, opts);
    steps.pivot = pivot;
    if (!pivot.ok) return Promise.resolve({ ok: false, steps: steps, stoppedAt: 'pivot', message: pivot.message || pivot.reason });
    var ground = groundClips(model, opts);
    steps.ground = ground;
    /* (c) không có clip thì vẫn chạy tiếp (d) — chỉ dừng khi model
       không phải humanoid (đã dừng ở pivot) hoặc không rig (d báo). */
    return lowPolyExport(model, opts).then(function (lowpoly) {
      steps.lowpoly = lowpoly;
      var ok = !!lowpoly.ok;
      return {
        ok: ok, steps: steps, stoppedAt: ok ? null : 'lowpoly',
        message: ok
          ? 'Auto Fix xong: trục ' + axes.detectedUp + ' → Y-up, pivot (0,0,0), ground ' + (ground.clipsFixed || 0) + ' clip, low-poly ' + lowpoly.trisBefore + ' → ' + lowpoly.trisAfter + ' tris → ' + lowpoly.filename
          : ('Dừng ở bước Low-poly: ' + (lowpoly.message || lowpoly.reason))
      };
    });
  }

  /* ---------- UI: SECTION TRONG TAB QUICK RIG / TAB PLUGIN ---------- */
  function modelStatusLine(model) {
    if (!model) return 'Chưa có model nào trong scene — hãy load model trước (GLB/FBX).';
    var c = countTris(model);
    var bones = findBones(model);
    var skinned = findMeshes(model).filter(function (m) { return m.isSkinnedMesh; }).length;
    var clips = getClips(model);
    return 'Model: ' + (model.name || 'model') + ' — ' + c.tris.toLocaleString('en-US') + ' tris / ' + c.meshes + ' mesh / ' +
      bones.length + ' xương' + (skinned ? ' (đã rig)' : ' (CHƯA RIG)') + ' / ' + clips.length + ' clip' +
      (clips.length ? ' (' + clips.map(function (x) { return x.name; }).join(', ') + ')' : '');
  }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'style' && typeof attrs[k] === 'object') { Object.keys(attrs[k]).forEach(function (s) { n.style[s] = attrs[k][s]; }); }
      else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    if (text != null) n.textContent = text;
    return n;
  }
  function downloadBytes(bytes, filename) {
    var P = (typeof window !== 'undefined') ? window.PixiStudio : null;
    try {
      var blob = new Blob([bytes], { type: 'application/octet-stream' });
      if (P && P.Utils && typeof P.Utils.downloadBlob === 'function') { P.Utils.downloadBlob(blob, filename); return true; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { URL.revokeObjectURL(url); a.remove(); } catch (e) {} }, 1000);
      return true;
    } catch (e) { return false; }
  }
  function renderSection(container, ctx) {
    if (!container) return;
    /* Model để chạy: ưu tiên ctx.getModel() của registry plugin
       (thử RigAutoGen → Viewport → Models), rồi mới tới getTarget()
       (State selection → Viewport.getMainModel). ctx.getModel() có
       thể trả về entry của ModelManager ({object3D}) thì unwrap. */
    function resolveModel() {
      var m = null;
      try {
        if (ctx && typeof ctx.getModel === 'function') m = ctx.getModel();
      } catch (e) { m = null; }
      if (m && m.object3D) m = m.object3D;
      if (m && m.traverse) return m;
      return getTarget();
    }
    var wrap = el('div', { 'class': 'arp-autofix-section', style: { borderTop: '1px solid #888', marginTop: '10px', paddingTop: '6px' } });
    wrap.setAttribute('data-qr3-section', 'autofix');
    wrap.appendChild(el('h3', {}, '🔧 Chỉnh sửa auto (Auto Fix)'));
    wrap.appendChild(el('p', { style: { margin: '4px 0', opacity: '0.85' } },
      'Đưa model về chuẩn Standard Character v1 (FBX 7300, Y-up, chân chạm đất, pivot giữa 2 chân, ~15.000 tris). Mỗi bước chạy riêng được; "Chạy tất cả" chạy a → d.'));
    var status = el('div', { 'class': 'arp-autofix-status', style: { margin: '6px 0', fontSize: '13px' } }, modelStatusLine(resolveModel()));
    wrap.appendChild(status);
    var refreshBtn = el('button', { 'class': 'btn sm', style: { marginBottom: '6px' }, onclick: function () { status.textContent = modelStatusLine(resolveModel()); } }, '↻ Cập nhật trạng thái model');
    wrap.appendChild(refreshBtn);
    var smartBtn = el('button', { 'class': 'btn sm', style: { marginBottom: '6px', marginLeft: '6px', display: 'none' }, onclick: function () {
      var P = window.PixiStudio;
      if (P && P.ArpPanel && typeof P.ArpPanel.showTab === 'function') P.ArpPanel.showTab('smart');
    } }, '→ Sang tab Smart để rig');
    wrap.appendChild(smartBtn);

    function reportBox() {
      var d = el('div', { 'class': 'arp-autofix-report', style: { whiteSpace: 'pre-wrap', fontSize: '12.5px', background: 'rgba(0,0,0,0.08)', padding: '6px', borderRadius: '4px', margin: '4px 0', minHeight: '18px' } }, 'Chưa chạy.');
      wrap.appendChild(d);
      return d;
    }
    function stepBlock(title, desc, runFn, isAsync) {
      var box = el('div', { style: { margin: '8px 0' } });
      box.appendChild(el('b', {}, title));
      box.appendChild(el('div', { style: { fontSize: '12.5px', opacity: '0.85' } }, desc));
      var rep = reportBox();
      var btn = el('button', { 'class': 'btn sm', style: { marginTop: '4px' }, onclick: function () {
        var model = resolveModel();
        if (!model) { rep.textContent = 'Chưa có model nào trong scene.'; return; }
        btn.disabled = true;
        rep.textContent = 'Đang chạy…';
        status.textContent = modelStatusLine(model);
        function done(r) {
          btn.disabled = false;
          rep.textContent = (r && r.ok ? '✅ ' : '⚠️ ') + (r && (r.message || r.reason) || 'Xong.') +
            (r ? '\n' + JSON.stringify(r, function (k, v) { return (k === 'bytes' || k === 'clip') ? undefined : v; }, 1) : '');
          status.textContent = modelStatusLine(resolveModel());
          if (r && r.step === 'lowpoly' && r.reason === 'need-rig') smartBtn.style.display = '';
          if (r && r.step === 'lowpoly' && r.ok && r.bytes) {
            var okDl = downloadBytes(r.bytes, r.filename);
            rep.textContent += okDl ? '\n⬇ Đã tải về: ' + r.filename : '\n(Tải về thất bại — bấm Chạy lại bước Low-poly.)';
          }
        }
        try {
          var out = runFn(model);
          if (out && typeof out.then === 'function') out.then(done).catch(function (e) { done({ ok: false, message: 'Lỗi: ' + (e && e.message ? e.message : e) }); });
          else done(out);
        } catch (e) { done({ ok: false, message: 'Lỗi: ' + (e && e.message ? e.message : e) }); }
      } }, 'Chạy');
      box.appendChild(btn);
      box.appendChild(rep);
      wrap.appendChild(box);
      return { box: box, rep: rep, btn: btn };
    }
    stepBlock('(a) Sửa trục Z-up → Y-up',
      'Phát hiện trục đứng qua bbox; nếu Z-up thì xoay ±90° quanh X (theo hướng đầu), rồi chuẩn hoá cao 2.0m + chân chạm y=0.',
      function (m) { return fixAxes(m); });
    stepBlock('(b) Pivot về điểm đất giữa 2 bàn chân',
      'Lấy điểm giữa 2 mắt cá (Ankle L/R — Mixamo: LeftFoot/RightFoot); chưa rig thì tách 2 cụm đỉnh đáy theo X. Dời pivot về (0,0,0).',
      function (m) { return fixPivot(m); });
    stepBlock('(c) Ground clip (chân chạm đất từng frame)',
      'Với mỗi clip, chỉnh Hips/root Y theo từng keyframe để bàn chân thấp nhất chạm y=0; giữ nguyên chuyển động ngang + xoay. Pass tinh chỉnh dày 48Hz chèn thêm key Hips Y nếu ngón chân còn lún giữa 2 key.',
      function (m) { return groundClips(m); });
    stepBlock('(d) Low poly ~15.000 tris + xuất FBX chuẩn',
      'Meshopt decimate về ~15.000 tris (giữ rig + clip + texture), xuất <tên>_LowPoly-Grounded.fbx (FBX 7300, Y-up). Model ≤16.000 tris thì không cần giảm. Chưa rig thì báo "cần rig trước".',
      function (m) { return lowPolyExport(m); }, true);

    var allRep = reportBox();
    var allBtn = el('button', { 'class': 'btn sm', style: { marginTop: '6px', fontWeight: 'bold' }, onclick: function () {
      var model = resolveModel();
      if (!model) { allRep.textContent = 'Chưa có model nào trong scene.'; return; }
      allBtn.disabled = true;
      allRep.textContent = 'Đang chạy tất cả (a → d)…';
      runAll(model).then(function (r) {
        allBtn.disabled = false;
        allRep.textContent = (r.ok ? '✅ ' : '⚠️ ') + r.message +
          '\n' + JSON.stringify(r.steps, function (k, v) { return (k === 'bytes' || k === 'clip') ? undefined : v; }, 1);
        status.textContent = modelStatusLine(resolveModel());
        if (r.steps.lowpoly && r.steps.lowpoly.reason === 'need-rig') smartBtn.style.display = '';
        if (r.steps.lowpoly && r.steps.lowpoly.ok && r.steps.lowpoly.bytes) {
          var okDl = downloadBytes(r.steps.lowpoly.bytes, r.steps.lowpoly.filename);
          allRep.textContent += okDl ? '\n⬇ Đã tải về: ' + r.steps.lowpoly.filename : '\n(Tải về thất bại — chạy lại bước (d).)';
        }
      }).catch(function (e) {
        allBtn.disabled = false;
        allRep.textContent = 'Lỗi: ' + (e && e.message ? e.message : e);
      });
    } }, '▶ Chạy tất cả (a → d)');
    wrap.appendChild(allBtn);
    wrap.appendChild(allRep);
    container.appendChild(wrap);
  }

  /* ---------- PUBLIC API ---------- */
  var AutoFix = {
    version: '1.0.0',
    TARGET_TRIS: TARGET_TRIS,
    MAX_TRIS: MAX_TRIS,
    TARGET_HEIGHT: TARGET_HEIGHT,
    detectUpAxis: detectUpAxis,
    fixAxes: fixAxes,
    findFeet: findFeet,
    fixPivot: fixPivot,
    groundClip: groundClip,
    groundClips: groundClips,
    lowPolyExport: lowPolyExport,
    runAll: runAll,
    getTarget: getTarget,
    getClips: getClips,
    setClips: setClips,
    render: renderSection,
    renderSection: renderSection,
    onEnable: function (ctx) {
      var P = (typeof window !== 'undefined') ? window.PixiStudio : null;
      if (P && P.ArpPanel && typeof P.ArpPanel.open === 'function') P.ArpPanel.open('plugin:auto-fix');
    },
    onDisable: function (ctx) {
      var P = (typeof window !== 'undefined') ? window.PixiStudio : null;
      if (P && P.ArpPanel && P.ArpPanel.currentTab && P.ArpPanel.currentTab() === 'plugin:auto-fix' && typeof P.ArpPanel.showTab === 'function') P.ArpPanel.showTab('quickrig');
    }
  };
  AutoFix._test = {
    triCountOf: triCountOf,
    countTris: countTris,
    findMainMesh: findMainMesh,
    findBones: findBones,
    findRootBone: findRootBone,
    findAnkleBones: findAnkleBones,
    clusterBottomVerts: clusterBottomVerts,
    buildFootClass: buildFootClass,
    makeSkinnedMinY: makeSkinnedMinY,
    cloneModelForExport: cloneModelForExport,
    weldGeometry: weldGeometry,
    compactGeometry: compactGeometry,
    decimateCloneToBudget: decimateCloneToBudget,
    checkSkinWeights: checkSkinWeights,
    collectTextureBytes: collectTextureBytes,
    bakeRootTransform: bakeRootTransform,
    normalizeObject: normalizeObject,
    contentAdjust: contentAdjust,
    transformRootTracks: transformRootTracks,
    shiftRootTracks: shiftRootTracks
  };

  if (typeof window !== 'undefined') {
    window.PixiStudio = window.PixiStudio || {};
    window.PixiStudio.ArpAutoFix = AutoFix;
    /* 1) Plugin registry js/rig/arp-plugins.js — đường đăng ký CHÍNH:
       tab riêng 'plugin:auto-fix' + dòng quản lý trong tab Plugins.
       Trùng id THROW (registry thiết kế vậy) nên bọc try/catch;
       nếu plugin đã có (load 2 lần) thì coi như đã đăng ký. */
    var pluginRegistered = false;
    try {
      if (window.PixiStudio.ArpPlugins && typeof window.PixiStudio.ArpPlugins.register === 'function') {
        window.PixiStudio.ArpPlugins.register('auto-fix', {
          name: 'Chỉnh sửa auto (Auto Fix)',
          version: '1.0.0',
          description: 'Đưa model về chuẩn Standard Character v1: sửa trục Z-up → Y-up, pivot giữa 2 chân, ground clip, low-poly ~15.000 tris + xuất FBX 7300.',
          tab: true,
          enabled: true,
          render: renderSection,
          onEnable: AutoFix.onEnable,
          onDisable: AutoFix.onDisable
        });
        pluginRegistered = true;
      }
    } catch (e) {
      /* register THROW khi trùng id (load 2 lần): plugin đã có trong
         registry từ lần load trước → không cần fallback. */
      try {
        var _AP = window.PixiStudio.ArpPlugins;
        if (_AP && typeof _AP.get === 'function' && _AP.get('auto-fix')) pluginRegistered = true;
      } catch (e2) {}
    }
    /* 2) + 3) CHỈ khi KHÔNG có registry (panel cũ): section trong tab
       Quick Rig + tab trực tiếp 'autofix'. Khi registry đã có, tab
       plugin 'plugin:auto-fix' là nơi DUY NHẤT hiện Auto Fix.
       LÝ DO (bug đã gặp 2026-11-27): renderTabBar trong
       arp-panel.js vẽ MỌI tab đã đăng ký ngoài TAB_ORDER (không chỉ
       'plugin:*') nên registerTab('autofix') tạo thêm 1 nút tab
       "Chỉnh sửa auto" trùng với tab plugin "Chỉnh sửa auto
       (Auto Fix)" — cùng nội dung, 2 tab. Ghi chú cũ ở đây ("nút
       tab không hiện") là SAI. */
    if (!pluginRegistered) {
      try {
        if (window.PixiStudio.ArpQuickRig && typeof window.PixiStudio.ArpQuickRig.registerSection === 'function') {
          window.PixiStudio.ArpQuickRig.registerSection('autofix', renderSection);
        }
      } catch (e) {}
      try {
        if (window.PixiStudio.ArpPanel && typeof window.PixiStudio.ArpPanel.registerTab === 'function') {
          window.PixiStudio.ArpPanel.registerTab('autofix', 'Chỉnh sửa auto', renderSection);
        }
      } catch (e) {}
    }
  }
  /* Node / harness: module.exports để test trực tiếp (không ảnh hưởng browser). */
  if (typeof module !== 'undefined' && module.exports) module.exports = AutoFix;
})();
