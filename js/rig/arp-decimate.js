/* ============================================================
 * rig/arp-decimate.js — NHÓM 1 (Rig mở rộng, 2026-11-27):
 *   (1) Decimation mở rộng dùng trong Auto Rig (meshopt simplify,
 *       giữ biên/UV/skin) + (2) Auto Rig phân tích HÌNH DẠNG mesh
 *       (không chỉ bbox) rồi CHỌN rig phù hợp thay vì ép humanoid
 *       41 xương.
 *
 * Decimation — pipeline đã kiểm chứng ở nút "Tối ưu FBX <1MB"
 * (js/exporter/save-manager.js decimateCloneToBudget, đo thật trên
 * Thiếu Lâm 46.917 tris): weld/index → meshopt simplify (LockBorder)
 * → compact → weld lại. Weld BẮT BUỘC trước meshopt vì FBXLoader
 * trả geometry non-indexed (140.751 verts cho 46.917 tris) — không
 * weld thì meshopt không có cạnh chung để collapse và trả nguyên
 * không giảm (đã đo 46.917 → 46.917). KHÔNG dùng voxel decimateUV
 * (mất skin) — meshopt chỉ đổi index nên mọi attribute theo đỉnh
 * (position/uv/normal/skinIndex/skinWeight/color) được giữ nguyên
 * giá trị, chỉ remap qua compact/weld.
 *
 * Giữ chi tiết vùng khớp — CÁCH LÀM THẬT (không phải khóa đỉnh):
 * API meshopt JS trong repo (js/vendor/meshopt_simplifier.js) chỉ
 * có simplify() với cờ LockBorder, KHÔNG khóa được đỉnh tùy ý.
 * Vì vậy decimate TÁCH tam giác thành 2 tập: vùng khớp (tam giác
 * có đỉnh trong bán kính 0.06H quanh vai/khuỷu/cổ tay/hông/gối/
 * mắt cá — đo từ landmark thật) thì GIỮ NGUYÊN chỉ số, chỉ
 * simplify tập còn lại về (target − số tris vùng khớp). An toàn vì
 * meshopt chỉ đổi index, không dời đỉnh: tam giác vùng khớp giữ
 * nguyên hình, tam giác kề vẫn dùng chung đỉnh nên không rách lưới.
 * Sai số leo thang theo lần thử (×1, ×2, ×4) tới khi đạt target —
 * đã đo: Thiếu Lâm về ~15k tris cần sai số ~0.02 (0.011×H), sai
 * số 0.005×H kẹt ở ~38k. Tỉ lệ giữ tris vùng khớp được ĐO và báo
 * (mục tiêu ≥ 60%).
 *
 * Phân tích hình dạng — đo từ đỉnh mesh THẬT (mẫu tối đa 60k đỉnh):
 *   • Độ dày chi: tiết diện ngang (xSpread/zSpread + nửa rộng thân
 *     trung vị) tại 10 dải cao; cỡ bàn chân + độ dày bắp chân tại
 *     dải gối, quanh tâm từng chân chạm đất.
 *   • Số chân: cụm điểm chạm đất (dải y ≤ ground+0.03H) — lưới XZ
 *     ô 0.015H, liên thông 4-hướng, gộp các cụm có tâm cách nhau
 *     < 0.12H (ngón chân tách mảnh trên model ít verts như Fox) và
 *     CHỈ gộp cùng phía đường giữa X (2 chân trái/phải không gộp
 *     xuyên cx — Fox có đỉnh trong 2 chân sau cách nhau 0.114H).
 *     Đã đo thật: Thiếu Lâm → 2, XBot → 2, Fox → 4.
 *   • Đuôi: phần kéo dài phía sau hông (vượt zMin/zMax dải hông
 *     0.4–0.6H hơn 0.12H, đủ điểm). Đã đo: Fox 0.25H (có đuôi),
 *     Thiếu Lâm 0.06H (vạt áo, không tính), XBot 0.
 *   • Cánh/sừng (phần nhô trên): điểm y > 0.8H vượt 1.6× nửa rộng
 *     vai — cả 3 model test đều 0 (không có cánh/sừng).
 *   • Robot (khớp cứng): KHÔNG dùng tỉ lệ normal trục (đã đo:
 *     Thiếu Lâm 0.52 vs XBot 0.44 — không phân biệt được vì
 *     FBXLoader làm mịn normal). Dùng 3 tín hiệu đo được: (a) ≥2
 *     mesh full-body chồng nhau (XBot: Beta_Surface + Beta_Joints,
 *     cả 2 cao > 0.8H — Thiếu Lâm/Fox chỉ 1 mesh); (b) số xương
 *     > 60 (XBot 129, Thiếu Lâm 41, Fox 24); (c) tên model/mesh
 *     chứa bot/robot/mech (chỉ là gợi ý yếu, +1 điểm).
 *     robotScore ≥ 2 → robot.
 *   • Thân ngang (quadruped): D(z)/H > 1.2 — Fox 1.96, Thiếu Lâm
 *     0.41, XBot 0.18.
 * Thứ tự quyết định: cánh/sừng → creature; ≥4 chân hoặc thân
 * ngang → quadruped; robotScore ≥ 2 → robot; đuôi → creature;
 * còn lại → humanoid.
 *
 * Rig được chọn (chooseRig): humanoid → full41 (41 xương, như cũ);
 * robot → hy3d28 gọn (28 xương, bỏ ngón tay/chân — khớp cứng);
 * quadruped → rig fox/horse qua PixiStudio.CreatureRigs (cần
 * assets/animations/mesh2motion/rigs/*.json + skeleton.glb — HIỆN
 * CHƯA CÓ trong repo nên chỉ trả plan, KHÔNG tự dựng skeleton);
 * creature (đuôi/cánh) → humanoid 41 + xương đuôi/cánh (chưa có
 * builder — trả plan, không ép rig sai). autoRigCompatible=false
 * thì tab Smart KHÔNG chạy AutoRigPro.run() humanoid mà báo rõ
 * và lưu plan vào metadata (xem ArpSmart.rig).
 *
 * Tích hợp: load SAU arp-smart.js (index.html). Tab Smart gọi
 * ArpDecimate.analyzeShape / .decimate / .chooseRig; kết quả lưu
 * vào ArpSmart.lastShapeAnalysis / lastRigPlan / lastDecimate và
 * gắn vào result của AutoRigPro.run() qua opts.shapeAnalysis /
 * opts.rigPlan / opts.decimateResult (xem auto-rig-pro.js, khối
 * đánh dấu NHÓM 1).
 * ============================================================ */
(function () {
  'use strict';

  var DEFAULT_RATIO = 0.32;          /* 46.917 → ~15.000 tris */
  var DEFAULT_TARGET_ERROR_FRAC = 0.005; /* sai số meshopt = 0.005 × H */
  var DEFAULT_JOINT_RADIUS_FRAC = 0.06;  /* bán kính vùng khớp = 0.06 × H */
  var DEFAULT_MIN_JOINT_RETENTION = 0.60; /* giữ ≥60% tris vùng khớp */
  var SAMPLE_CAP = 60000;

  var ArpDecimate = {
    lastAnalysis: null,
    lastDecimate: null,
    lastRigPlan: null
  };

  /* ---------------- helpers chung ---------------- */
  function getThree() { return (typeof window !== 'undefined' && window.THREE) || (typeof THREE !== 'undefined' ? THREE : null); }

  function collectMeshes(root) {
    var out = [];
    if (!root || !root.traverse) return out;
    root.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.userData && (o.userData.isArpMarker || o.userData.isArpGhost || o.userData.isBoneVisual)) return;
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      out.push(o);
    });
    return out;
  }

  function triCountOfGeo(geo) {
    if (!geo || !geo.attributes || !geo.attributes.position) return 0;
    return Math.floor((geo.index ? geo.index.count : geo.attributes.position.count) / 3);
  }
  ArpDecimate.triCountOfGeo = triCountOfGeo;

  /* Đếm tris/verts/mesh/skinned của cả model. */
  ArpDecimate.measure = function (root) {
    var meshes = collectMeshes(root);
    var tris = 0, verts = 0, skinned = 0;
    meshes.forEach(function (m) {
      tris += triCountOfGeo(m.geometry);
      verts += m.geometry.attributes.position.count;
      if (m.isSkinnedMesh || (m.geometry.attributes.skinIndex && m.geometry.attributes.skinWeight)) skinned++;
    });
    return { tris: tris, verts: verts, meshes: meshes.length, skinnedMeshes: skinned };
  };

  /* Mẫu điểm world (tối đa SAMPLE_CAP) — cùng cách lấy mẫu của
     AutoRigPro.measureLandmarks để số liệu khớp nhau. */
  function samplePoints(root, cap) {
    var THREE = getThree();
    var meshes = collectMeshes(root);
    var pts = [];
    if (!THREE || !meshes.length) return { pts: pts, meshes: meshes };
    root.updateMatrixWorld(true);
    var perMesh = Math.max(1, Math.floor((cap || SAMPLE_CAP) / meshes.length));
    var tmp = new THREE.Vector3();
    meshes.forEach(function (m) {
      var pos = m.geometry.attributes.position;
      var step = Math.max(1, Math.floor(pos.count / perMesh));
      for (var i = 0; i < pos.count; i += step) {
        tmp.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        pts.push([tmp.x, tmp.y, tmp.z]);
      }
    });
    return { pts: pts, meshes: meshes };
  }
  ArpDecimate._test = { samplePoints: samplePoints, collectMeshes: collectMeshes };

  /* Bbox tổng (mesh thật) + các mốc cơ bản. */
  function bboxOf(root) {
    var THREE = getThree();
    var meshes = collectMeshes(root);
    if (!THREE || !meshes.length) return null;
    var box = new THREE.Box3();
    meshes.forEach(function (m) { box.expandByObject(m); });
    if (box.isEmpty()) return null;
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    return {
      box: box, size: size, center: center,
      H: Math.max(1e-6, size.y), W: Math.max(size.x, size.z),
      sizeX: size.x, sizeZ: size.z,
      cx: center.x, cz: center.z,
      groundY: box.min.y, headTopY: box.max.y
    };
  }

  /* ---------------- meshopt ---------------- */
  ArpDecimate.meshoptAvailable = function () {
    var MSE = (typeof window !== 'undefined' && window.PixiStudio) ? window.PixiStudio.MixamoSafeExport : null;
    if (MSE && typeof MSE.decimateMeshopt === 'function') return true;
    var M = (typeof window !== 'undefined') ? window.MeshoptSimplifier : null;
    return !!(M && typeof M.simplify === 'function');
  };

  /* Chờ WASM meshopt sẵn sàng (dùng lại hàm của MixamoSafeExport
     nếu có, không thì window.MeshoptSimplifier.ready). */
  ArpDecimate.waitReady = function (timeoutMs) {
    var MSE = (typeof window !== 'undefined' && window.PixiStudio) ? window.PixiStudio.MixamoSafeExport : null;
    if (MSE && typeof MSE.waitMeshoptReady === 'function') return MSE.waitMeshoptReady(timeoutMs || 5000);
    var M = (typeof window !== 'undefined') ? window.MeshoptSimplifier : null;
    if (!M || !M.ready) return Promise.resolve(false);
    return Promise.race([
      M.ready.then(function () { return true; }).catch(function () { return false; }),
      new Promise(function (res) { setTimeout(function () { res(false); }, timeoutMs || 5000); })
    ]);
  };

  /* Weld/index geometry: gộp đỉnh trùng (vị trí + normal + UV +
     skin...) thành 1 đỉnh. Key gồm MỌI attribute nên không gộp
     nhầm đỉnh khác normal (cạnh sắc) hay khác skin weights.
     (Cùng logic đã kiểm chứng trong save-manager.js.) */
  function weldGeometry(geometry) {
    var THREE = getThree();
    if (!THREE || !geometry) return geometry;
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
      var g0 = new THREE.BufferGeometry();
      names.forEach(function (nm) { g0.setAttribute(nm, geometry.attributes[nm]); });
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
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }

  /* Compact: chỉ giữ đỉnh còn được index dùng tới, remap index.
     Không mất mát (chỉ bỏ đỉnh thừa), giữ nguyên mọi attribute
     theo đỉnh (kể cả skinIndex/skinWeight). */
  function compactGeometry(geometry) {
    var THREE = getThree();
    if (!THREE || !geometry) return geometry;
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
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  ArpDecimate._test.weldGeometry = weldGeometry;
  ArpDecimate._test.compactGeometry = compactGeometry;

  /* 1 lần simplify qua MixamoSafeExport.decimateMeshopt (ưu tiên —
     cùng code path với nút Tối ưu FBX) hoặc trực tiếp qua
     window.MeshoptSimplifier khi chưa load exporter.
     LƯU Ý: trả null cả khi simplify ném lỗi (vd WASM chưa sẵn sàng)
     — caller phải xử lý fallback, không được coi null là "đã xong". */
  function simplifyOnce(geometry, targetTris, targetError) {
    var THREE = getThree();
    var MSE = (typeof window !== 'undefined' && window.PixiStudio) ? window.PixiStudio.MixamoSafeExport : null;
    if (MSE && typeof MSE.decimateMeshopt === 'function') {
      return MSE.decimateMeshopt(geometry, targetTris, targetError);
    }
    var M = (typeof window !== 'undefined') ? window.MeshoptSimplifier : null;
    if (!THREE || !M || typeof M.simplify !== 'function') return null;
    var pos = geometry.attributes.position;
    var index = geometry.index;
    if (!pos || !pos.array) return null;
    var idxArr = (index && index.array) ? index.array : null;
    if (!idxArr) {
      idxArr = new Uint32Array(pos.count);
      for (var i = 0; i < pos.count; i++) idxArr[i] = i;
    }
    var srcTris = Math.floor(idxArr.length / 3);
    if (srcTris <= targetTris) return null;
    var out;
    try {
      out = M.simplify(idxArr, pos.array, 3, targetTris * 3, targetError, ['LockBorder']);
    } catch (e) { return null; }
    if (!out || !out[0] || !out[0].length) return null;
    var g = new THREE.BufferGeometry();
    Object.keys(geometry.attributes).forEach(function (name) {
      g.setAttribute(name, geometry.attributes[name].clone());
    });
    g.setIndex(new THREE.BufferAttribute(out[0], 1));
    if (g.attributes.normal) g.deleteAttribute('normal');
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    return { geometry: g, trisAfter: Math.floor(out[0].length / 3), err: out[1] };
  }

  /* Tách tam giác thành vùng khớp / còn lại. Tam giác vùng khớp =
     có ≥1 đỉnh trong bán kính radius của khớp gần nhất (tính theo
     world). Trả { jointIdx, restIdx, jointTris, restTris } — index
     dạng Uint32Array (3 số/tam giác). */
  function splitJointTriangles(geometry, joints, radius, matrixWorld) {
    var pos = geometry.attributes.position;
    var idx = geometry.index ? geometry.index.array : null;
    var nTri = idx ? Math.floor(idx.length / 3) : Math.floor(pos.count / 3);
    var r2 = radius * radius;
    var jointIdx = [], restIdx = [];
    var e = matrixWorld ? matrixWorld.elements : null;
    var toWorld = function (i, out) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (!e) { out[0] = x; out[1] = y; out[2] = z; return; }
      out[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
      out[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      out[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    };
    var p = [0, 0, 0];
    for (var t = 0; t < nTri; t++) {
      var i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      var isJoint = false;
      var vs = [i0, i1, i2];
      for (var v = 0; v < 3 && !isJoint; v++) {
        toWorld(vs[v], p);
        for (var j = 0; j < joints.length; j++) {
          var dx = p[0] - joints[j].x, dy = p[1] - joints[j].y, dz = p[2] - joints[j].z;
          if (dx * dx + dy * dy + dz * dz < r2) { isJoint = true; break; }
        }
      }
      if (isJoint) { jointIdx.push(i0, i1, i2); }
      else { restIdx.push(i0, i1, i2); }
    }
    return {
      jointIdx: new Uint32Array(jointIdx), restIdx: new Uint32Array(restIdx),
      jointTris: jointIdx.length / 3, restTris: restIdx.length / 3
    };
  }
  ArpDecimate._test.splitJointTriangles = splitJointTriangles;

  /* Decimate 1 geometry ĐÃ WELD về targetTris.
     opts.joints + opts.jointRadius: bật bảo vệ khớp — tách tam giác
     vùng khớp ra, chỉ simplify phần còn lại về (target − tris vùng
     khớp), rồi gộp index lại. Nếu tris vùng khớp ≥ target thì không
     thể vừa bảo vệ vừa đạt target → simplify đồng đều (báo rõ
     jointProtected=false). */
  function decimateWelded(welded, targetTris, opts) {
    opts = opts || {};
    var THREE = getThree();
    var trisBefore = triCountOfGeo(welded);
    if (trisBefore <= targetTris) return { geometry: welded, trisBefore: trisBefore, trisAfter: trisBefore, simplified: false, jointProtected: false };
    var err = (typeof opts.targetError === 'number' && opts.targetError > 0)
      ? opts.targetError
      : DEFAULT_TARGET_ERROR_FRAC * (opts.modelH || 1.8);
    var joints = opts.joints || null;
    if (joints && joints.length) {
      var split = splitJointTriangles(welded, joints, opts.jointRadius || 0.1, opts.matrixWorld || null);
      if (split.jointTris >= targetTris) {
        /* Không đủ chỗ cho vùng khớp — simplify đồng đều, báo rõ. */
        var d0 = simplifyOnce(welded, targetTris, err);
        if (!d0) return { geometry: welded, trisBefore: trisBefore, trisAfter: trisBefore, simplified: false, jointProtected: false, error: 'meshopt không khả dụng hoặc không giảm được' };
        var g0 = weldGeometry(compactGeometry(d0.geometry));
        return { geometry: g0, trisBefore: trisBefore, trisAfter: triCountOfGeo(g0), simplified: true, jointProtected: false, jointTris: split.jointTris, meshoptErr: d0.err };
      }
      var restTarget = Math.max(1, targetTris - split.jointTris);
      var newRestIdx = split.restIdx;
      if (split.restTris > restTarget) {
        var tmp = new THREE.BufferGeometry();
        Object.keys(welded.attributes).forEach(function (name) { tmp.setAttribute(name, welded.attributes[name]); });
        tmp.setIndex(new THREE.BufferAttribute(split.restIdx, 1));
        var d = simplifyOnce(tmp, restTarget, err);
        if (d) newRestIdx = d.geometry.index.array;
        /* simplify null (WASM chưa sẵn / lỗi) → giữ nguyên phần
           còn lại, chỉ báo simplified=false ở dưới. */
      }
      var merged = new Uint32Array(split.jointIdx.length + newRestIdx.length);
      merged.set(split.jointIdx, 0);
      merged.set(newRestIdx, split.jointIdx.length);
      var g = new THREE.BufferGeometry();
      Object.keys(welded.attributes).forEach(function (name) { g.setAttribute(name, welded.attributes[name]); });
      g.setIndex(new THREE.BufferAttribute(merged, 1));
      if (g.attributes.normal) g.deleteAttribute('normal');
      g.computeVertexNormals();
      g.computeBoundingBox(); g.computeBoundingSphere();
      var g2 = weldGeometry(compactGeometry(g));
      var simplified = (split.restTris > restTarget) ? !!newRestIdx && newRestIdx.length < split.restIdx.length : false;
      return { geometry: g2, trisBefore: trisBefore, trisAfter: triCountOfGeo(g2), simplified: simplified || triCountOfGeo(g2) < trisBefore, jointProtected: true, jointTris: split.jointTris, meshoptErr: undefined };
    }
    var d1 = simplifyOnce(welded, targetTris, err);
    if (!d1) return { geometry: welded, trisBefore: trisBefore, trisAfter: trisBefore, simplified: false, jointProtected: false, error: 'meshopt không khả dụng hoặc không giảm được' };
    var g1 = weldGeometry(compactGeometry(d1.geometry));
    return { geometry: g1, trisBefore: trisBefore, trisAfter: triCountOfGeo(g1), simplified: true, jointProtected: false, meshoptErr: d1.err };
  }

  /* Decimate 1 geometry về targetTris: weld → simplify → compact
     → weld lại (weld lần 2 gộp các đỉnh trùng nhau sau khi meshopt
     tính lại normal — đã đo gọn ~2 lần ở save-manager).
     opts.joints/jointRadius/matrixWorld: bật bảo vệ khớp (xem
     decimateWelded). Trả { geometry, trisBefore, trisAfter,
     simplified, jointProtected } — geometry mới (không sửa geometry
     gốc); null khi không có gì để làm. */
  ArpDecimate.decimateGeometry = function (geometry, targetTris, opts) {
    opts = opts || {};
    if (!geometry) return null;
    var trisBefore = triCountOfGeo(geometry);
    if (trisBefore <= 0) return null;
    if (trisBefore <= targetTris) return { geometry: geometry, trisBefore: trisBefore, trisAfter: trisBefore, simplified: false, jointProtected: false };
    var welded = weldGeometry(geometry);
    return decimateWelded(welded, targetTris, opts);
  };

  /* ---------------- vị trí khớp (để đo vùng khớp) ----------------
     Lấy từ AutoRigPro.measureLandmarks khi có (đo thật trên mesh);
     fallback tỉ lệ bbox như auto-rig-pro.js khi chưa load Smart. */
  ArpDecimate.jointPositions = function (target, landmarks) {
    var ARP = (typeof window !== 'undefined' && window.PixiStudio) ? window.PixiStudio.AutoRigPro : null;
    var lm = landmarks || (ARP && ARP.measureLandmarks ? ARP.measureLandmarks(target) : null);
    var bb = bboxOf(target);
    if (!bb) return [];
    var H = bb.H, cx = bb.cx, cz = bb.cz, groundY = bb.groundY;
    if (!lm) {
      lm = {
        chinY: groundY + 0.85 * H, shoulderY: groundY + 0.78 * H,
        elbowY: groundY + 0.63 * H, wristY: groundY + 0.49 * H,
        groinY: groundY + 0.52 * H, kneeY: groundY + 0.28 * H,
        ankleY: groundY + 0.06 * H, shoulderWidth: 0.13 * H,
        handX: 0.50 * H, hipX: 0.09 * H
      };
    }
    var pts = [];
    var push = function (name, x, y, z) { pts.push({ name: name, x: x, y: y, z: z === undefined ? cz : z }); };
    push('LeftShoulder', cx - lm.shoulderWidth, lm.shoulderY);
    push('RightShoulder', cx + lm.shoulderWidth, lm.shoulderY);
    push('LeftElbow', cx - lm.handX * 0.7, lm.elbowY);
    push('RightElbow', cx + lm.handX * 0.7, lm.elbowY);
    push('LeftWrist', cx - lm.handX, lm.wristY);
    push('RightWrist', cx + lm.handX, lm.wristY);
    push('LeftHip', cx - lm.hipX, lm.groinY);
    push('RightHip', cx + lm.hipX, lm.groinY);
    push('LeftKnee', cx - lm.hipX, lm.kneeY);
    push('RightKnee', cx + lm.hipX, lm.kneeY);
    push('LeftAnkle', cx - lm.hipX, lm.ankleY);
    push('RightAnkle', cx + lm.hipX, lm.ankleY);
    return pts;
  };

  /* Tỉ lệ tris nằm trong vùng khớp (tâm tam giác cách khớp gần nhất
     < radius). Trả { trisInJoint, trisTotal, retention } — retention
     là tỉ lệ so với trisInJoint gốc (truyền vào qua before). */
  function jointTris(geometry, joints, radius, matrixWorld) {
    var pos = geometry.attributes.position;
    if (!pos) return { trisInJoint: 0, trisTotal: 0 };
    var idx = geometry.index ? geometry.index.array : null;
    var nTri = idx ? Math.floor(idx.length / 3) : Math.floor(pos.count / 3);
    var r2 = radius * radius;
    var inside = 0;
    for (var t = 0; t < nTri; t++) {
      var i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      var cxp = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3;
      var cyp = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3;
      var czp = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3;
      if (matrixWorld) {
        /* Tâm tam giác local → world (khớp tính theo world). */
        var e = matrixWorld.elements;
        var wx = e[0] * cxp + e[4] * cyp + e[8] * czp + e[12];
        var wy = e[1] * cxp + e[5] * cyp + e[9] * czp + e[13];
        var wz = e[2] * cxp + e[6] * cyp + e[10] * czp + e[14];
        cxp = wx; cyp = wy; czp = wz;
      }
      for (var j = 0; j < joints.length; j++) {
        var dx = cxp - joints[j].x, dy = cyp - joints[j].y, dz = czp - joints[j].z;
        if (dx * dx + dy * dy + dz * dz < r2) { inside++; break; }
      }
    }
    return { trisInJoint: inside, trisTotal: nTri };
  }
  ArpDecimate._test.jointTris = jointTris;

  /* ---------------- decimate cả model (in-place) ----------------
     opts: { ratio (mặc định 0.32) | targetTris, targetError,
       protectJoints (mặc định true), jointRadius (mặc định 0.06H),
       minJointRetention (mặc định 0.60), maxAttempts (mặc định 3),
       landmarks (dùng lại landmark đã đo, tránh đo lại) }.
     Chia target tris theo tỉ lệ tris gốc từng mesh. Vòng thử thích
     ứng: sai số leo thang (×1, ×2, ×4) tới khi đạt target; chọn
     attempt đầu tiên đạt cả tris (≤1.15×target) lẫn giữ vùng khớp
     (≥ ngưỡng), nếu không đạt thì lấy attempt giữ khớp tốt nhất và
     báo rõ (result.targetMet=false).
     Trả result đầy đủ (tris/verts trước-sau, từng mesh, retention,
     số lần thử). GHI ĐÈ geometry của mesh trong scene (model gốc
     trên đĩa không đổi); lưu tóm tắt vào root.userData.arpDecimate. */
  ArpDecimate.decimate = function (root, opts) {
    opts = opts || {};
    var THREE = getThree();
    if (!THREE) return { ok: false, error: 'THREE chưa sẵn sàng' };
    var before = ArpDecimate.measure(root);
    if (!before.meshes || before.tris <= 0) return { ok: false, error: 'Không có mesh nào để decimate', before: before };
    var targetTotal;
    if (typeof opts.targetTris === 'number' && opts.targetTris > 0) targetTotal = Math.floor(opts.targetTris);
    else {
      var ratio = (typeof opts.ratio === 'number' && opts.ratio > 0 && opts.ratio < 1) ? opts.ratio : DEFAULT_RATIO;
      targetTotal = Math.max(100, Math.floor(before.tris * ratio));
    }
    if (targetTotal >= before.tris) return { ok: true, skipped: true, reason: 'Tris đã ≤ target', before: before, after: before, trisBefore: before.tris, trisAfter: before.tris, targetTris: targetTotal };
    var bb = bboxOf(root);
    var H = bb ? bb.H : 1.8;
    var protect = opts.protectJoints !== false;
    var jointRadius = (typeof opts.jointRadius === 'number' && opts.jointRadius > 0) ? opts.jointRadius : DEFAULT_JOINT_RADIUS_FRAC * H;
    var minRetention = (typeof opts.minJointRetention === 'number') ? opts.minJointRetention : DEFAULT_MIN_JOINT_RETENTION;
    var maxAttempts = (typeof opts.maxAttempts === 'number' && opts.maxAttempts >= 1) ? Math.floor(opts.maxAttempts) : 3;
    var joints = protect ? ArpDecimate.jointPositions(root, opts.landmarks) : [];
    var meshes = collectMeshes(root);
    /* Đếm tris vùng khớp gốc (để tính retention sau). */
    var jointBefore = 0;
    if (protect && joints.length) {
      root.updateMatrixWorld(true);
      meshes.forEach(function (m) { jointBefore += jointTris(m.geometry, joints, jointRadius, m.matrixWorld).trisInJoint; });
    }
    var best = null, bestFallback = null;
    var attempts = 0;
    /* Weld 1 lần cho mọi mesh (weld 140k verts ~3-4s — không weld
       lại mỗi attempt). Mỗi attempt simplify từ bản weld này với
       sai số leo thang (×1, ×2, ×4): meshopt dừng theo giới hạn
       sai số, nên target thấp cần sai số lớn hơn mới đạt được
       (đã đo: Thiếu Lâm về ~15k cần ~0.02, sai số 0.005×H kẹt ở
       ~38k). Chọn attempt ĐẦU TIÊN đạt cả 2 điều kiện (tris ≤
       1.15×target VÀ retention ≥ ngưỡng); nếu không attempt nào
       đạt thì lấy attempt giữ khớp tốt nhất và báo rõ. */
    var baseErr = (typeof opts.targetError === 'number' && opts.targetError > 0)
      ? opts.targetError
      : DEFAULT_TARGET_ERROR_FRAC * H;
    var originals = meshes.map(function (m) { return m.geometry; });
    var weldeds = originals.map(function (g) { return weldGeometry(g); });
    root.updateMatrixWorld(true);
    for (var a = 0; a < maxAttempts; a++) {
      attempts++;
      var errMult = Math.pow(2, a);
      var done = 0, perMesh = [], attemptGeos = [];
      meshes.forEach(function (m, i) {
        var t = triCountOfGeo(weldeds[i]);
        var share = (i === meshes.length - 1)
          ? Math.max(1, targetTotal - done)
          : Math.max(1, Math.floor(targetTotal * t / Math.max(1, before.tris)));
        var d = decimateWelded(weldeds[i], share, {
          targetError: baseErr * errMult, modelH: H,
          joints: (protect && joints.length) ? joints : null,
          jointRadius: jointRadius, matrixWorld: m.matrixWorld
        });
        if (d) { attemptGeos.push(d.geometry); perMesh.push({ mesh: m.name || ('mesh' + i), trisBefore: d.trisBefore, trisAfter: d.trisAfter, simplified: d.simplified, jointProtected: !!d.jointProtected }); done += d.trisAfter; }
        else { attemptGeos.push(weldeds[i]); perMesh.push({ mesh: m.name || ('mesh' + i), trisBefore: t, trisAfter: t, simplified: false }); done += t; }
      });
      /* Đo retention trên chính geometry của attempt này (không
         decimate lại lần 2). */
      var jointAfter = 0;
      if (protect && joints.length && jointBefore > 0) {
        attemptGeos.forEach(function (g, gi) { jointAfter += jointTris(g, joints, jointRadius, meshes[gi].matrixWorld).trisInJoint; });
      }
      var retention = (protect && jointBefore > 0) ? jointAfter / jointBefore : 1;
      var cand = { attempt: a + 1, targetTris: targetTotal, trisAfter: done, perMesh: perMesh, jointBefore: jointBefore, jointAfter: jointAfter, jointRetention: retention, geos: attemptGeos, errMult: errMult };
      var qualifies = retention >= minRetention && done <= 1.15 * targetTotal;
      if (qualifies && (!best || cand.trisAfter < best.trisAfter)) best = cand;
      if (!bestFallback || cand.jointRetention > bestFallback.jointRetention ||
        (cand.jointRetention === bestFallback.jointRetention && cand.trisAfter < bestFallback.trisAfter)) bestFallback = cand;
      if (qualifies) break;
    }
    if (!best) best = bestFallback;
    best.targetMet = best.trisAfter <= 1.15 * targetTotal;
    /* Gán geometry của attempt tốt nhất vào scene (đã decimate rồi,
       không chạy lại — deterministic vì cùng input). */
    var doneF = 0, perMeshF = best.perMesh;
    meshes.forEach(function (m, i) {
      m.geometry = best.geos[i];
      doneF += perMeshF[i].trisAfter;
    });
    var after = ArpDecimate.measure(root);
    var result = {
      ok: true, before: before, after: after,
      trisBefore: before.tris, trisAfter: after.tris,
      vertsBefore: before.verts, vertsAfter: after.verts,
      targetTris: targetTotal, ratio: targetTotal / Math.max(1, before.tris),
      targetMet: !!best.targetMet,
      attempts: attempts, jointRetention: best.jointRetention,
      jointTrisBefore: best.jointBefore, jointTrisAfter: best.jointAfter,
      protectJoints: protect, perMesh: perMeshF
    };
    ArpDecimate.lastDecimate = result;
    try { if (root) { root.userData = root.userData || {}; root.userData.arpDecimate = { trisBefore: result.trisBefore, trisAfter: result.trisAfter, vertsBefore: result.vertsBefore, vertsAfter: result.vertsAfter, jointRetention: result.jointRetention, targetTris: result.targetTris }; } } catch (e) {}
    return result;
  };

  /* Bản async: chờ meshopt WASM rồi decimate đồng bộ. */
  ArpDecimate.decimateAsync = function (root, opts) {
    return ArpDecimate.waitReady(8000).then(function () { return ArpDecimate.decimate(root, opts); });
  };

  ArpDecimate.summarizeDecimate = function (r) {
    if (!r || !r.ok) return 'Decimate lỗi: ' + ((r && r.error) || '?');
    if (r.skipped) return 'Decimate: bỏ qua — ' + (r.reason || '');
    return 'Decimate: ' + r.trisBefore.toLocaleString('en-US') + ' → ' + r.trisAfter.toLocaleString('en-US') +
      ' tris (' + (r.trisAfter / Math.max(1, r.trisBefore) * 100).toFixed(0) + '%), verts ' +
      r.vertsBefore.toLocaleString('en-US') + ' → ' + r.vertsAfter.toLocaleString('en-US') +
      ' · giữ vùng khớp ' + (r.jointRetention * 100).toFixed(0) + '% (' + r.attempts + ' lần thử, target ' +
      r.targetTris.toLocaleString('en-US') + ' tris' + (r.targetMet === false ? ' — CHƯA ĐẠT target' : '') + ')';
  };

  /* ---------------- phân tích hình dạng ---------------- */
  /* Cụm điểm chạm đất: lưới XZ ô 0.015H, liên thông 4-hướng, gộp
     cụm có tâm < 0.12H (union-find). Trả { count, centers:[{x,z,n}] }. */
  function groundClusters(pts, groundY, H, cx) {
    var cell = 0.015 * H;
    var band = pts.filter(function (p) { return p[1] <= groundY + 0.03 * H; });
    var grid = new Map();
    band.forEach(function (p) {
      var k = Math.floor(p[0] / cell) + ',' + Math.floor(p[2] / cell);
      var e = grid.get(k);
      if (!e) { e = { n: 0, sx: 0, sz: 0 }; grid.set(k, e); }
      e.n++; e.sx += p[0]; e.sz += p[2];
    });
    var keys = Array.from(grid.keys());
    var seen = new Set();
    var comps = [];
    keys.forEach(function (k) {
      if (seen.has(k)) return;
      var q = [k]; seen.add(k);
      var n = 0, sx = 0, sz = 0;
      while (q.length) {
        var cur = q.pop();
        var e = grid.get(cur);
        n += e.n; sx += e.sx; sz += e.sz;
        var pr = cur.split(',').map(Number);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var nk = (pr[0] + d[0]) + ',' + (pr[1] + d[1]);
          if (grid.has(nk) && !seen.has(nk)) { seen.add(nk); q.push(nk); }
        });
      }
      comps.push({ n: n, x: sx / n, z: sz / n });
    });
    var minSize = Math.max(4, Math.floor(band.length * 0.005));
    comps = comps.filter(function (c) { return c.n >= minSize; });
    /* Union-find gộp cụm gần nhau (< 0.12H giữa 2 tâm) — CHỈ gộp
       cùng phía đường giữa X (2 chân trái/phải không bao giờ gộp
       xuyên qua cx: đã đo Fox có 2 đỉnh trong của 2 chân sau cách
       nhau 0.114H < 0.12H — không chặn phía thì 4 chân thành 3). */
    var parent = comps.map(function (_, i) { return i; });
    var find = function (i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    var sideOf = function (x) { var d = x - cx; return Math.abs(d) < 0.02 * H ? 0 : (d < 0 ? -1 : 1); };
    for (var i = 0; i < comps.length; i++) {
      for (var j = i + 1; j < comps.length; j++) {
        var dx = comps[i].x - comps[j].x, dz = comps[i].z - comps[j].z;
        if (Math.sqrt(dx * dx + dz * dz) >= 0.12 * H) continue;
        var si = sideOf(comps[i].x), sj = sideOf(comps[j].x);
        if (si !== 0 && sj !== 0 && si !== sj) continue; /* khác phía cx */
        var ri = find(i), rj = find(j);
        if (ri !== rj) parent[ri] = rj;
      }
    }
    var groups = {};
    comps.forEach(function (c, i) {
      var r = find(i);
      if (!groups[r]) groups[r] = { n: 0, sx: 0, sz: 0, parts: 0 };
      groups[r].n += c.n; groups[r].sx += c.x * c.n; groups[r].sz += c.z * c.n; groups[r].parts++;
    });
    var centers = Object.keys(groups).map(function (k) {
      var g = groups[k];
      return { x: g.sx / g.n, z: g.sz / g.n, n: g.n, parts: g.parts };
    });
    centers.sort(function (a, b) { return b.n - a.n; });
    return { count: centers.length, centers: centers, bandPoints: band.length, rawClusters: comps.length };
  }
  ArpDecimate._test.groundClusters = groundClusters;

  /* Tiết diện ngang tại 10 dải cao: xSpread/zSpread + nửa rộng
     thân (trung vị |x-cx| — loại tay/chân để đo thân). */
  function thicknessProfile(pts, groundY, H, cx) {
    var bands = [];
    for (var b = 0; b < 10; b++) {
      var y0 = groundY + b * H / 10, y1 = y0 + H / 10;
      var inB = pts.filter(function (p) { return p[1] >= y0 && p[1] < y1; });
      if (!inB.length) { bands.push({ yRel: b / 10, count: 0, xSpread: 0, zSpread: 0, torsoHalfWidth: 0 }); continue; }
      var xs = inB.map(function (p) { return p[0]; });
      var zs = inB.map(function (p) { return p[2]; });
      var ax = inB.map(function (p) { return Math.abs(p[0] - cx); }).sort(function (a, b2) { return a - b2; });
      bands.push({
        yRel: b / 10, count: inB.length,
        xSpread: Math.max.apply(null, xs) - Math.min.apply(null, xs),
        zSpread: Math.max.apply(null, zs) - Math.min.apply(null, zs),
        torsoHalfWidth: ax[Math.floor(ax.length * 0.5)] || 0
      });
    }
    return bands;
  }
  ArpDecimate._test.thicknessProfile = thicknessProfile;

  /* Đuôi: đo cả 2 hướng ±Z (không biết model quay mặt nào). Lấy
     zMin/zMax của dải hông (0.4–0.6H); phần vượt ra ngoài > 0.12H
     với đủ điểm, ở dải y 0.25–0.75H, là đuôi. Đuôi là đầu có maxY
     THẤP hơn — đầu (mõm/tai) vươn xa nhưng cao tới ~1.0H, đuôi
     chỉ tới ~0.3H (đã đo Fox: sau maxY 0.31H, trước maxY 1.00H —
     lấy maxY cao hơn thì nhầm đầu thành đuôi 0.38H). */
  function detectTail(pts, groundY, H) {
    var hip = pts.filter(function (p) { return p[1] >= groundY + 0.4 * H && p[1] < groundY + 0.6 * H; });
    if (!hip.length) return { present: false, length: 0, lengthRel: 0, points: 0, direction: null };
    var zMin = Infinity, zMax = -Infinity;
    hip.forEach(function (p) { if (p[2] < zMin) zMin = p[2]; if (p[2] > zMax) zMax = p[2]; });
    var minPts = Math.max(10, Math.floor(pts.length * 0.002));
    var back = pts.filter(function (p) { return p[2] < zMin - 0.02 * H && p[1] >= groundY + 0.25 * H && p[1] < groundY + 0.75 * H; });
    var front = pts.filter(function (p) { return p[2] > zMax + 0.02 * H && p[1] >= groundY + 0.25 * H && p[1] < groundY + 0.75 * H; });
    var backLen = 0, frontLen = 0;
    if (back.length) backLen = zMin - Math.min.apply(null, back.map(function (p) { return p[2]; }));
    if (front.length) frontLen = Math.max.apply(null, front.map(function (p) { return p[2]; })) - zMax;
    /* maxY toàn bộ điểm vượt ra 2 đầu (không lọc y) — đầu cao. */
    var backAll = pts.filter(function (p) { return p[2] < zMin - 0.02 * H; });
    var frontAll = pts.filter(function (p) { return p[2] > zMax + 0.02 * H; });
    var maxYOf = function (arr) { return arr.length ? (Math.max.apply(null, arr.map(function (p) { return p[1]; })) - groundY) / H : 0; };
    var backMaxY = maxYOf(backAll), frontMaxY = maxYOf(frontAll);
    /* Đuôi = đầu thấp hơn; nếu maxY gần nhau (<0.1H) thì lấy đầu
       dài hơn. */
    var tailIsBack;
    if (Math.abs(backMaxY - frontMaxY) < 0.1) tailIsBack = backLen >= frontLen;
    else tailIsBack = backMaxY < frontMaxY;
    var len = tailIsBack ? backLen : frontLen;
    var n = tailIsBack ? back.length : front.length;
    return {
      present: len > 0.12 * H && n >= minPts,
      length: len, lengthRel: len / H, points: n, direction: tailIsBack ? '-Z' : '+Z',
      hipZMin: zMin, hipZMax: zMax,
      backLengthRel: backLen / H, frontLengthRel: frontLen / H,
      backMaxYRel: backMaxY, frontMaxYRel: frontMaxY
    };
  }
  ArpDecimate._test.detectTail = detectTail;

  /* Phần nhô phía trên (cánh/sừng): điểm y > 0.8H vượt 1.6× nửa
     rộng vai (phân vị 90 |x-cx| ở dải 0.75–0.82H). */
  function detectUpperProtrusions(pts, groundY, H, cx) {
    var sh = pts.filter(function (p) { return p[1] >= groundY + 0.75 * H && p[1] < groundY + 0.82 * H; });
    var shHW = 0;
    if (sh.length) {
      var ax = sh.map(function (p) { return Math.abs(p[0] - cx); }).sort(function (a, b) { return a - b; });
      shHW = ax[Math.floor(ax.length * 0.9)] || 0;
    }
    var up = pts.filter(function (p) { return p[1] >= groundY + 0.8 * H && Math.abs(p[0] - cx) > shHW * 1.6; });
    var overhang = 0;
    if (up.length) overhang = Math.max.apply(null, up.map(function (p) { return Math.abs(p[0] - cx); })) - shHW;
    var minPts = Math.max(20, Math.floor(pts.length * 0.01));
    return {
      present: up.length >= minPts && overhang > 0.08 * H,
      points: up.length, pointsRel: pts.length ? up.length / pts.length : 0,
      overhang: overhang, overhangRel: overhang / H, shoulderHalfWidth: shHW
    };
  }
  ArpDecimate._test.detectUpperProtrusions = detectUpperProtrusions;

  /* Tín hiệu robot: (a) ≥2 mesh full-body chồng nhau, (b) > 60
     xương, (c) tên chứa bot/robot/mech (gợi ý yếu). */
  function robotFeatures(root, meshes, bb, legs) {
    var fullBody = 0;
    meshes.forEach(function (m) {
      var THREE = getThree();
      if (!THREE) return;
      var b = new THREE.Box3().setFromObject(m);
      if (b.isEmpty()) return;
      var s = b.getSize(new THREE.Vector3());
      if (s.y > 0.8 * bb.H && s.x > 0.5 * bb.sizeX) fullBody++;
    });
    var bones = 0;
    if (root && root.traverse) root.traverse(function (o) { if (o.isBone) bones++; });
    var names = [];
    if (root && root.name) names.push(root.name);
    meshes.forEach(function (m) { if (m.name) names.push(m.name); });
    var nameHint = /bot|robot|mech|droid|android|cyborg/i.test(names.join(' '));
    var score = (fullBody >= 2 ? 2 : 0) + (bones > 60 ? 1 : 0) + (nameHint ? 1 : 0) + (legs === 1 ? 1 : 0);
    return { fullBodyMeshes: fullBody, boneCount: bones, nameHint: nameHint, names: names, score: score, isRobot: score >= 2 };
  }

  /* Độ dày chi: cỡ bàn chân (spread XZ quanh tâm chân ở dải đất)
     + độ dày bắp chân (spread X quanh tâm chân ở dải gối 0.25–0.31H). */
  function limbThickness(pts, groundY, H, legCenters) {
    if (!legCenters || !legCenters.length) return { footDiameter: null, calfThickness: null, perLeg: [] };
    var perLeg = legCenters.map(function (c) {
      var foot = pts.filter(function (p) {
        return p[1] <= groundY + 0.03 * H &&
          Math.abs(p[0] - c.x) < 0.12 * H && Math.abs(p[2] - c.z) < 0.12 * H;
      });
      var calf = pts.filter(function (p) {
        return p[1] >= groundY + 0.25 * H && p[1] < groundY + 0.31 * H &&
          Math.abs(p[0] - c.x) < 0.10 * H;
      });
      var spread = function (arr, axis) {
        if (!arr.length) return 0;
        var vs = arr.map(function (p) { return p[axis]; });
        return Math.max.apply(null, vs) - Math.min.apply(null, vs);
      };
      return {
        center: { x: c.x, z: c.z },
        footX: spread(foot, 0), footZ: spread(foot, 2),
        calfX: spread(calf, 0)
      };
    });
    var avg = function (arr) { return arr.length ? arr.reduce(function (s, v) { return s + v; }, 0) / arr.length : 0; };
    var footD = avg(perLeg.map(function (l) { return Math.max(l.footX, l.footZ); }));
    var calfT = avg(perLeg.map(function (l) { return l.calfX; }));
    return { footDiameter: footD, footDiameterRel: footD / H, calfThickness: calfT, calfThicknessRel: calfT / H, perLeg: perLeg };
  }

  /* ---------------- API chính: phân tích + chọn rig ---------------- */
  ArpDecimate.analyzeShape = function (target) {
    var bb = bboxOf(target);
    if (!bb) return { ok: false, error: 'Không đo được bbox — model rỗng hoặc không có mesh.' };
    var s = samplePoints(target, SAMPLE_CAP);
    var pts = s.pts;
    if (!pts.length) return { ok: false, error: 'Không lấy được đỉnh mẫu nào.' };
    var H = bb.H;
    var profile = thicknessProfile(pts, bb.groundY, H, bb.cx);
    var ground = groundClusters(pts, bb.groundY, H, bb.cx);
    var legs = ground.count;
    var tail = detectTail(pts, bb.groundY, H);
    var upper = detectUpperProtrusions(pts, bb.groundY, H, bb.cx);
    var horizontalBody = bb.sizeZ > 1.2 * H;
    var robot = robotFeatures(target, s.meshes, bb, legs);
    var limbs = limbThickness(pts, bb.groundY, H, ground.centers);

    var type, reasons = [], confidence = 0.6;
    if (upper.present) {
      type = 'creature';
      reasons.push('Có phần nhô phía trên thân (cánh/sừng): ' + upper.points + ' điểm, vượt vai ' + (upper.overhangRel * 100).toFixed(0) + '%H.');
      confidence = 0.8;
    } else if (legs >= 4 || horizontalBody) {
      type = 'quadruped';
      if (legs >= 4) { reasons.push('Đếm được ' + legs + ' cụm chân chạm đất.'); confidence += 0.15; }
      if (horizontalBody) { reasons.push('Thân nằm ngang: dài (Z) ' + bb.sizeZ.toFixed(2) + ' > 1.2× cao ' + H.toFixed(2) + ' (D/H=' + (bb.sizeZ / H).toFixed(2) + ').'); confidence += 0.1; }
      if (tail.present) { reasons.push('Có đuôi dài ' + (tail.lengthRel * 100).toFixed(0) + '%H hướng ' + tail.direction + '.'); confidence += 0.05; }
      confidence = Math.min(0.95, confidence);
    } else if (robot.isRobot) {
      type = 'robot';
      reasons.push('Robot (khớp cứng), robotScore ' + robot.score + '/5: ' +
        robot.fullBodyMeshes + ' mesh full-body chồng nhau' +
        (robot.boneCount > 60 ? ', ' + robot.boneCount + ' xương' : '') +
        (robot.nameHint ? ', tên gợi ý robot' : '') +
        (legs === 1 ? ', chỉ 1 cụm chạm đất' : '') + '.');
      confidence = 0.85;
    } else if (tail.present) {
      type = 'creature';
      reasons.push('Có đuôi dài ' + (tail.lengthRel * 100).toFixed(0) + '%H hướng ' + tail.direction + ' nhưng chỉ ' + legs + ' chân.');
      confidence = 0.8;
    } else {
      type = 'humanoid';
      reasons.push(legs + ' cụm chân chạm đất, thân đứng (D/H=' + (bb.sizeZ / H).toFixed(2) + '), không đuôi/cánh, robotScore ' + robot.score + '/5.');
      confidence = 0.85;
    }

    var analysis = {
      ok: true, type: type, confidence: Math.min(0.95, confidence), reasons: reasons,
      height: H, heightRel: 1, widthX: bb.sizeX, depthZ: bb.sizeZ, depthHeightRatio: bb.sizeZ / H,
      groundY: bb.groundY, cx: bb.cx, cz: bb.cz,
      legs: legs, legCenters: ground.centers,
      groundClustersRaw: ground.rawClusters, groundBandPoints: ground.bandPoints,
      tail: tail, upperProtrusions: upper, horizontalBody: horizontalBody,
      robot: robot, limbs: limbs, thicknessProfile: profile,
      meshCount: s.meshes.length, samplePoints: pts.length,
      tris: ArpDecimate.measure(target).tris
    };
    analysis.rigPlan = ArpDecimate.chooseRig(analysis);
    ArpDecimate.lastAnalysis = analysis;
    ArpDecimate.lastRigPlan = analysis.rigPlan;
    return analysis;
  };

  /* Chọn rig theo kết quả phân tích. autoRigCompatible=false nghĩa
     là pipeline humanoid của AutoRigPro KHÔNG được ép chạy — tab
     Smart phải báo rõ + lưu plan (xem ArpSmart.rig). */
  ArpDecimate.chooseRig = function (analysis) {
    if (!analysis || !analysis.ok) return { type: 'unknown', autoRigCompatible: false, boneSet: null, boneCount: 0, reason: 'Chưa phân tích được hình dạng.' };
    var t = analysis.type;
    if (t === 'humanoid') {
      return { type: 'humanoid', autoRigCompatible: true, boneSet: 'full41', boneCount: 41, fingers: true, toes: true, twist: false, reason: 'Humanoid 2 chân — rig 41 xương Mixamo như cũ.' };
    }
    if (t === 'robot') {
      return { type: 'robot', autoRigCompatible: true, boneSet: 'hy3d28', boneCount: 28, fingers: false, toes: false, twist: false, reason: 'Robot khớp cứng — rig gọn 28 xương (kiểu HY3D), bỏ ngón tay/chân vì khớp robot không có ngón mềm.' };
    }
    if (t === 'quadruped') {
      return { type: 'quadruped', autoRigCompatible: false, boneSet: 'quadruped', boneCount: null, fingers: false, toes: false, reason: analysis.legs + ' chân + thân ngang — cần rig 4 chân (fox/horse), KHÔNG ép rig humanoid 41 xương.', buildVia: 'PixiStudio.CreatureRigs (rig fox/horse) — cần assets/animations/mesh2motion/rigs/*.json + skeleton.glb, hiện chưa có trong repo.' };
    }
    if (t === 'creature') {
      var app = analysis.tail && analysis.tail.present ? 'đuôi dài ' + (analysis.tail.lengthRel * 100).toFixed(0) + '%H' : 'cánh/sừng';
      return { type: 'creature', autoRigCompatible: false, boneSet: 'full41+tail', boneCount: 41, fingers: true, toes: true, reason: 'Creature có ' + app + ' — cần rig humanoid 41 xương + xương đuôi/cánh riêng (chưa có builder).', buildVia: 'Rig humanoid 41 xương rồi thêm xương đuôi/cánh thủ công (vòng sau).' };
    }
    return { type: 'unknown', autoRigCompatible: false, boneSet: null, boneCount: 0, reason: 'Loại chưa xác định.' };
  };

  ArpDecimate.summarizeAnalysis = function (a) {
    if (!a || !a.ok) return 'Phân tích lỗi: ' + ((a && a.error) || '?');
    var label = { humanoid: 'Humanoid (2 chân)', quadruped: 'Quadruped (4 chân)', robot: 'Robot (khớp cứng)', creature: 'Creature (đuôi/cánh)' }[a.type] || a.type;
    return 'Phân tích mesh: ' + label + ' (tin cậy ' + (a.confidence * 100).toFixed(0) + '%) · ' +
      a.legs + ' chân chạm đất · cao ' + a.height.toFixed(2) + ' · D/H ' + a.depthHeightRatio.toFixed(2) +
      (a.tail.present ? ' · đuôi ' + (a.tail.lengthRel * 100).toFixed(0) + '%H' : ' · không đuôi') +
      ' · robotScore ' + a.robot.score + '/5 · Rig chọn: ' + (a.rigPlan ? a.rigPlan.reason : '?');
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpDecimate = ArpDecimate;
})();
