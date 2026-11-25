/* ============================================================
 * exporter/mixamo-safe-export.js — Chuẩn bị mesh "Mixamo-safe"
 * trước khi xuất FBX cho Mixamo (round 4, v21.0+).
 *
 * Bài học từ file Thiếu Lâm (11-2026): file do chính studio xuất
 * (Rig 1 Lượt + Export FBX) vẫn bị Mixamo từ chối dù FileId/footer/
 * version đều đúng, vì 3 yếu tố cộng lại:
 *   (a) đúng 50.000 tris = chạm ngưỡng auto-rig của Mixamo;
 *   (b) file CÓ skeleton (65 xương mixamorig:, chỉ 24 xương có skin
 *       weights — 40 xương ngón tay + HeadTop_End không skin) nên
 *       Mixamo đi nhánh map-skeleton có sẵn thay vì auto-rig, và
 *       bind pose A-pose (tay 138,6°) không phải T-pose chuẩn → map
 *       thất bại ("unable to map your existing skeleton");
 *   (c) validator/pre-flight của studio đều dùng `>` nên đúng 50.000
 *       lọt qua mọi cửa kiểm tra.
 * File làm lại bằng tay (thieulam-Mixamo.fbx 9.056.956 B, 46.917 tris;
 * thandieu-Mixamo.fbx 8.140.892 B, 43.133 tris) chứng minh công thức
 * đúng: mesh-only + decimate giữ UV + nhúng texture. Module này đưa
 * đúng công thức đó vào NÚT EXPORT, để mọi file xuất ra đều giống
 * hệt 2 file mẫu — không cần làm tay nữa.
 *
 * Mạch chuẩn (MixamoSafeExport.prepare):
 *   1. Clone geometry từng mesh, nướng matrixWorld vào, BỎ skeleton/
 *      skinning (xoá skinIndex/skinWeight, dựng lại bằng THREE.Mesh
 *      thường — KHÔNG clone SkinnedMesh, vì clone giữ isSkinnedMesh
 *      và skeleton) → xuất mesh-only để Mixamo tự auto-rig.
 *   2. Chuẩn hoá tỉ lệ (y hệt quy tắc autoScale của fbx-binary.js):
 *      cao ngoài [1,2–3,5] thì scale về 1,8; đáy y=0, tâm X/Z về 0 —
 *      để cỡ ô decimate (mét) ổn định với mọi model.
 *   3. Nếu tổng tris >= 50.000 → sweep tối đa 5 ô (0.007 → 0.028),
 *      dừng ở ô đầu tiên cho tris ≤ 47.000 VÀ cạnh hở < 2% VÀ
 *      UV spread ≤ 1/64; mesh đa-material (groups > 1) không giảm
 *      được (mất map material) nên giữ nguyên và tính vào tổng.
 *   4. Hàn vị trí (weldPositions, eps = max(0.004, ô × 0.5)) rồi đo lại —
 *      eps tỉ lệ với ô vì khe hở sau decimate tỉ lệ với cỡ ô (round 5).
 *   5. Trả { group, report } — group null + report.errors khi không
 *      cứu được (vd decimate xong vẫn ≥ 50k). Validator (đã sửa
 *      ngưỡng `>=`) chạy trên nhóm ĐÃ chuẩn bị, chỉ chặn lúc này.
 *
 * Thuật toán decimateUV/weldPositions/openRatio port nguyên từ
 * ~/workspace/.test-fbx/convert-thieulam.js (đã chứng minh bằng
 * FBX SDK thật): gom đỉnh theo (vị trí + UV lượng tử hoá 1/64),
 * trung bình vị trí/normal/UV (/màu nếu có) rồi hàn. KHÔNG dùng
 * LODGenerator.decimate (js/mesh/lod-generator.js) — nó làm mất UV.
 * ============================================================ */
(function () {
  'use strict';

  var MAX_TRIS = 50000;        /* ngưỡng auto-rig Mixamo (chặn ở >=) */
  var TARGET_TRIS = 47000;     /* đích sau decimate (cách ngưỡng 3.000) */
  var MAX_OPEN_RATIO = 0.02;   /* cạnh hở < 2% */
  var UV_QUANT = 1 / 64;       /* lượng tử hoá UV — như 2 file mẫu */
  var WELD_EPS = 0.004;        /* hàn vị trí sau decimate — SÀN, không phải hằng số:
                                  eps thật = max(WELD_EPS, ô * 0.5) (xem sweep bên dưới) */
  var WELD_RATIO = 0.5;        /* weld eps = ô * 0.5 — khe hở do decimate tỉ lệ với cỡ ô;
                                  bài học lenhhosung (12-2026): weld cố định 0.004 chỉ hàn
                                  được khi ô ≤ 0.008; ô 0.010 → cạnh hở 2,17% (vượt ngưỡng
                                  2%) trong khi ô 0.007 thì 47.564 tris (vượt đích 47.000)
                                  — cả 5 ô đều trượt, nút export chặn hẳn, không có file.
                                  Tỉ lệ 0.5 = pipeline làm tay (weld 0.003 ở ô 0.006). */
  var CELLS = [0.007, 0.010, 0.015, 0.022, 0.028];  /* tối đa 5 lần thử — 0.007 là ô đã chứng minh trên file Thiếu Lâm (46.917 tris); ô lớn hơn cho mesh lưới đều (sphere/box) vốn khó giảm */
  var MIN_HEIGHT = 1.2, MAX_HEIGHT = 3.5, NORM_HEIGHT = 1.8; /* như fbx-binary.js */

  var MixamoSafeExport = {};
  MixamoSafeExport.MAX_TRIS = MAX_TRIS;
  MixamoSafeExport.TARGET_TRIS = TARGET_TRIS;
  MixamoSafeExport.MAX_OPEN_RATIO = MAX_OPEN_RATIO;
  MixamoSafeExport.UV_QUANT = UV_QUANT;
  MixamoSafeExport.WELD_EPS = WELD_EPS;
  MixamoSafeExport.WELD_RATIO = WELD_RATIO;
  MixamoSafeExport.CELLS = CELLS.slice();

  /* ---------------- đếm ---------------- */
  function triCountOf(geo) {
    return Math.floor((geo.index ? geo.index.count : geo.attributes.position.count) / 3);
  }
  MixamoSafeExport.triCountOf = triCountOf;

  function countTris(root) {
    var tris = 0, meshes = 0;
    if (!root || !root.traverse) return { tris: 0, meshes: 0 };
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      if (o.userData && (o.userData.isBoneVisual || o.userData.skipSkin)) return;
      meshes++;
      tris += triCountOf(o.geometry);
    });
    return { tris: tris, meshes: meshes };
  }
  MixamoSafeExport.countTris = countTris;

  /* Tỉ lệ cạnh hở = số cạnh chỉ thuộc 1 tam giác / tổng số cạnh.
     Đo trên vị trí đã hàn theo 5 chữ số thập phân (như validator). */
  function openRatio(geo) {
    var pos = geo.attributes.position;
    var idx = geo.index;
    var n = pos.count;
    var weld = new Map();
    var vid = new Int32Array(n);
    for (var i = 0; i < n; i++) {
      var k = pos.getX(i).toFixed(5) + ',' + pos.getY(i).toFixed(5) + ',' + pos.getZ(i).toFixed(5);
      if (!weld.has(k)) weld.set(k, weld.size);
      vid[i] = weld.get(k);
    }
    var triCount = Math.floor((idx ? idx.count : n) / 3);
    var e = new Map();
    for (var t = 0; t < triCount; t++) {
      var a = idx ? vid[idx.getX(t * 3)] : vid[t * 3];
      var b = idx ? vid[idx.getX(t * 3 + 1)] : vid[t * 3 + 1];
      var c = idx ? vid[idx.getX(t * 3 + 2)] : vid[t * 3 + 2];
      var pairs = [[a, b], [b, c], [c, a]];
      for (var p = 0; p < 3; p++) {
        var x = pairs[p][0], y = pairs[p][1];
        if (x === y) continue;
        var ek = Math.min(x, y) + '_' + Math.max(x, y);
        e.set(ek, (e.get(ek) || 0) + 1);
      }
    }
    var open = 0;
    e.forEach(function (v) { if (v === 1) open++; });
    return e.size ? open / e.size : 1;
  }
  MixamoSafeExport.openRatio = openRatio;

  /* ---------------- decimate giữ UV ---------------- */
  /* Gom đỉnh theo (ô vị trí + ô UV lượng tử hoá), trung bình vị trí /
     normal / UV (/màu nếu có). Đỉnh cùng vị trí nhưng UV khác ô không
     gộp — tránh nhoè UV qua seam (bài học round 3 Thần Điêu). */
  function decimateUV(geometry, cellSize, uvQuant) {
    uvQuant = uvQuant || UV_QUANT;
    var THREE = window.THREE;
    var pos = geometry.attributes.position;
    var nrm = geometry.attributes.normal;
    var uv = geometry.attributes.uv;
    var col = geometry.attributes.color;
    var index = geometry.index;
    var cell = cellSize;
    var vertCount = pos.count;
    var map = {};
    var sums = [];
    var remap = new Int32Array(vertCount);
    var uvMM = [];
    for (var i = 0; i < vertCount; i++) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      var u = uv ? uv.getX(i) : 0, v = uv ? uv.getY(i) : 0;
      var key = Math.floor(x / cell) + ',' + Math.floor(y / cell) + ',' + Math.floor(z / cell) +
        '|' + Math.floor(u / uvQuant) + ',' + Math.floor(v / uvQuant);
      var ni = map[key];
      if (ni === undefined) {
        ni = sums.length;
        map[key] = ni;
        sums.push([x, y, z,
          nrm ? nrm.getX(i) : 0, nrm ? nrm.getY(i) : 0, nrm ? nrm.getZ(i) : 0,
          u, v, 1,
          col ? col.getX(i) : 0, col ? col.getY(i) : 0, col ? col.getZ(i) : 0]);
        uvMM.push([u, u, v, v]);
      } else {
        var s = sums[ni];
        s[0] += x; s[1] += y; s[2] += z;
        if (nrm) { s[3] += nrm.getX(i); s[4] += nrm.getY(i); s[5] += nrm.getZ(i); }
        s[6] += u; s[7] += v;
        s[8]++;
        if (col) { s[9] += col.getX(i); s[10] += col.getY(i); s[11] += col.getZ(i); }
        var mm = uvMM[ni];
        if (u < mm[0]) mm[0] = u; if (u > mm[1]) mm[1] = u;
        if (v < mm[2]) mm[2] = v; if (v > mm[3]) mm[3] = v;
      }
      remap[i] = ni;
    }
    var n = sums.length;
    var newPos = new Float32Array(n * 3);
    var newNrm = new Float32Array(n * 3);
    var newUv = new Float32Array(n * 2);
    var newCol = col ? new Float32Array(n * 3) : null;
    for (var j = 0; j < n; j++) {
      var sj = sums[j];
      newPos[j * 3] = sj[0] / sj[8];
      newPos[j * 3 + 1] = sj[1] / sj[8];
      newPos[j * 3 + 2] = sj[2] / sj[8];
      var nx = sj[3] / sj[8], ny = sj[4] / sj[8], nz = sj[5] / sj[8];
      var l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      newNrm[j * 3] = nx / l; newNrm[j * 3 + 1] = ny / l; newNrm[j * 3 + 2] = nz / l;
      newUv[j * 2] = sj[6] / sj[8];
      newUv[j * 2 + 1] = sj[7] / sj[8];
      if (newCol) {
        newCol[j * 3] = sj[9] / sj[8];
        newCol[j * 3 + 1] = sj[10] / sj[8];
        newCol[j * 3 + 2] = sj[11] / sj[8];
      }
    }
    var triCount = index ? index.count / 3 : vertCount / 3;
    var newIndex = [];
    for (var t = 0; t < triCount; t++) {
      var a = index ? remap[index.getX(t * 3)] : remap[t * 3];
      var c2 = index ? remap[index.getX(t * 3 + 1)] : remap[t * 3 + 1];
      var c3 = index ? remap[index.getX(t * 3 + 2)] : remap[t * 3 + 2];
      if (a === c2 || c2 === c3 || a === c3) continue;
      newIndex.push(a, c2, c3);
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(newNrm, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(newUv, 2));
    if (newCol) out.setAttribute('color', new THREE.BufferAttribute(newCol, 3));
    out.setIndex(newIndex);
    out.computeBoundingBox();
    out.computeBoundingSphere();
    var worstUvSpread = 0;
    for (var m = 0; m < n; m++) {
      var mm2 = uvMM[m];
      var sp = Math.max(mm2[1] - mm2[0], mm2[3] - mm2[2]);
      if (sp > worstUvSpread) worstUvSpread = sp;
    }
    return { geometry: out, verticesBefore: vertCount, verticesAfter: n, trisBefore: Math.floor(triCount), trisAfter: newIndex.length / 3, cell: cellSize, uvQuant: uvQuant, worstUvSpread: worstUvSpread };
  }
  MixamoSafeExport.decimateUV = decimateUV;

  /* Hàn các đỉnh trùng vị trí (eps) về 1 centroid — sửa cạnh hở do
     decimate tách seam. Không động UV. Trả { maxDisp, groups }. */
  function weldPositions(geometry, eps) {
    var pos = geometry.attributes.position;
    var n = pos.count;
    var parent = new Int32Array(n);
    for (var i = 0; i < n; i++) parent[i] = i;
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }
    var cell = new Map();
    var key = function (ix, iy, iz) { return ix + ',' + iy + ',' + iz; };
    for (var i2 = 0; i2 < n; i2++) {
      var k = key(Math.floor(pos.getX(i2) / eps), Math.floor(pos.getY(i2) / eps), Math.floor(pos.getZ(i2) / eps));
      if (!cell.has(k)) cell.set(k, []);
      cell.get(k).push(i2);
    }
    for (var i3 = 0; i3 < n; i3++) {
      var cx = Math.floor(pos.getX(i3) / eps), cy = Math.floor(pos.getY(i3) / eps), cz = Math.floor(pos.getZ(i3) / eps);
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) {
        var list = cell.get(key(cx + dx, cy + dy, cz + dz));
        if (!list) continue;
        for (var li = 0; li < list.length; li++) {
          var j = list[li];
          if (j <= i3) continue;
          var ddx = pos.getX(i3) - pos.getX(j), ddy = pos.getY(i3) - pos.getY(j), ddz = pos.getZ(i3) - pos.getZ(j);
          if (ddx * ddx + ddy * ddy + ddz * ddz <= eps * eps) union(i3, j);
        }
      }
    }
    var groups = new Map();
    for (var i4 = 0; i4 < n; i4++) {
      var r = find(i4);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i4);
    }
    var maxDisp = 0;
    groups.forEach(function (list2) {
      if (list2.length < 2) return;
      var sx = 0, sy = 0, sz = 0;
      for (var q = 0; q < list2.length; q++) { sx += pos.getX(list2[q]); sy += pos.getY(list2[q]); sz += pos.getZ(list2[q]); }
      var ccx = sx / list2.length, ccy = sy / list2.length, ccz = sz / list2.length;
      for (var q2 = 0; q2 < list2.length; q2++) {
        var ii = list2[q2];
        var d = Math.hypot(pos.getX(ii) - ccx, pos.getY(ii) - ccy, pos.getZ(ii) - ccz);
        if (d > maxDisp) maxDisp = d;
        pos.setXYZ(ii, ccx, ccy, ccz);
      }
    });
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { maxDisp: maxDisp, groups: groups.size };
  }
  MixamoSafeExport.weldPositions = weldPositions;

  /* ---------------- xương có/không skin ---------------- */
  /* Đếm xương trong rig nguồn và xương nào thật sự có skin weights
     (> 0 ở ít nhất 1 vertex). File Thiếu Lâm: 65 xương, chỉ 24 có
     skin — 41 xương ngón tay + HeadTop_End không skin, và đó là một
     trong các lý do Mixamo map-skeleton thất bại. */
  function countSkinUsage(root) {
    var bones = [];
    var usedUuids = {};
    if (!root || !root.traverse) return { total: 0, used: 0, unskinned: 0 };
    root.traverse(function (o) {
      if (o.isBone) bones.push(o);
    });
    root.traverse(function (o) {
      if (!o.isSkinnedMesh || !o.skeleton || !o.skeleton.bones) return;
      var si = o.geometry && o.geometry.attributes.skinIndex;
      var sw = o.geometry && o.geometry.attributes.skinWeight;
      if (!si || !sw) return;
      var n = si.count;
      var siArr = si.array, swArr = sw.array;
      for (var i = 0; i < n; i++) {
        for (var k = 0; k < 4; k++) {
          if (swArr[i * 4 + k] > 0) {
            var b = o.skeleton.bones[siArr[i * 4 + k]];
            if (b) usedUuids[b.uuid] = true;
          }
        }
      }
    });
    var usedCount = 0;
    bones.forEach(function (b) { if (usedUuids[b.uuid]) usedCount++; });
    /* Chỉ đếm xương có trong cây scene; xương chỉ nằm trong skeleton
       mà không gắn vào scene thì không tính. */
    var total = bones.length;
    var unskinned = Math.max(0, total - usedCount);
    return { total: total, used: usedCount, unskinned: unskinned };
  }
  MixamoSafeExport.countSkinUsage = countSkinUsage;

  function hasTexture(root) {
    var found = false;
    if (!root || !root.traverse) return false;
    var SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
    root.traverse(function (o) {
      if (found || !o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m) return;
        SLOTS.forEach(function (s) {
          var t = m[s];
          if (t && t.image) found = true;
        });
      });
    });
    return found;
  }
  MixamoSafeExport.hasTexture = hasTexture;

  /* ---------------- prepare chính ---------------- */
  /* Chuẩn bị nhóm mesh-only an toàn cho Mixamo từ model nguồn.
     Trả về { group, report }. group = null khi không cứu được
     (report.errors ghi rõ lý do). KHÔNG sửa model nguồn: geometry
     được clone, material dùng chung (giữ texture để writer nhúng). */
  MixamoSafeExport.prepare = function (root, opts) {
    var THREE = window.THREE;
    opts = opts || {};
    var targetTris = opts.targetTris || TARGET_TRIS;
    var cells = opts.cells || CELLS;
    var weldEps = opts.weldEps || WELD_EPS;
    var report = {
      ok: false, errors: [], warnings: [],
      trisBefore: 0, trisAfter: 0, decimated: false, cell: null, attempts: 0,
      openRatio: 1, worstUvSpread: 0, weldMaxDisp: 0, weldEps: null,
      meshes: 0, bonesTotal: 0, bonesUnskinned: 0, hasTexture: false
    };
    if (!THREE) { report.errors.push('THREE chưa sẵn sàng'); return { group: null, report: report }; }
    if (!root || !root.traverse) { report.errors.push('Không có model để chuẩn bị'); return { group: null, report: report }; }

    /* --- xương nguồn (để cảnh báo, không xuất ra file) --- */
    var skin = countSkinUsage(root);
    report.bonesTotal = skin.total;
    report.bonesUnskinned = skin.unskinned;
    if (skin.total > 0 && skin.unskinned > 0) {
      report.warnings.push('Bỏ skeleton (' + skin.unskinned + '/' + skin.total + ' xương không có skin weights — vd xương ngón tay/đầu mút) để Mixamo tự auto-rig lại thay vì map xương có sẵn');
    } else if (skin.total > 0) {
      report.warnings.push('Bỏ skeleton (' + skin.total + ' xương) để Mixamo tự auto-rig lại');
    }
    report.hasTexture = hasTexture(root);

    /* --- clone mesh, nướng world matrix, bỏ skin attributes --- */
    root.updateMatrixWorld(true);
    var items = [];   /* { name, geo, material, reducible } */
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      if (o.userData && (o.userData.isBoneVisual || o.userData.skipSkin)) return;
      var geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');
      var multi = Array.isArray(o.material) || (geo.groups && geo.groups.length > 1);
      items.push({ name: o.name || 'mesh', geo: geo, material: o.material, reducible: !multi });
    });
    if (!items.length) { report.errors.push('Không có mesh nào để xuất FBX'); return { group: null, report: report }; }
    report.meshes = items.length;

    /* --- chuẩn hoá tỉ lệ (y hệt autoScale của fbx-binary.js) --- */
    var bb = new THREE.Box3();
    bb.makeEmpty();
    items.forEach(function (it) {
      var b = it.geo.boundingBox;
      if (b) { bb.min.min(b.min); bb.max.max(b.max); }
    });
    var h = 0;
    if (!bb.isEmpty()) {
      var size = bb.getSize(new THREE.Vector3());
      h = Math.max(size.x, size.y, size.z);
    }
    var norm = new THREE.Matrix4();
    if (h > 0) {
      var s = (h < MIN_HEIGHT || h > MAX_HEIGHT) ? NORM_HEIGHT / h : 1;
      var tx = -(bb.min.x + bb.max.x) / 2 * s;
      var ty = -bb.min.y * s;
      var tz = -(bb.min.z + bb.max.z) / 2 * s;
      norm.makeTranslation(tx, ty, tz);
      norm.premultiply(new THREE.Matrix4().makeScale(s, s, s));
      items.forEach(function (it) { it.geo.applyMatrix4(norm); it.geo.computeBoundingBox(); it.geo.computeBoundingSphere(); });
    }

    var trisBefore = 0;
    items.forEach(function (it) { trisBefore += triCountOf(it.geo); });
    report.trisBefore = trisBefore;

    /* --- decimate nếu cần --- */
    var finalGeos = items.map(function (it) { return it.geo; });
    if (trisBefore >= MAX_TRIS) {
      var accepted = null;
      var best = null;
      for (var ci = 0; ci < cells.length; ci++) {
        var cell = cells[ci];
        /* Hàn theo ô: khe hở sau decimate tỉ lệ với cỡ ô (tâm cluster
           cách nhau ~ô), nên weld eps cố định 0.004 chỉ hàn được khi
           ô ≤ 0.008. Ở ô lớn hơn, các cặp seam nằm ngoài tầm eps nên
           cạnh hở tăng vọt theo ô (lenhhosung: 0,08% ở ô 0.007 →
           2,17% ở ô 0.010 → 19,5% ở ô 0.028). eps = max(sàn, ô*0.5)
           hàn được seam ở mọi ô; maxDisp vẫn ~1 cm ở ô được chọn. */
        var cellWeldEps = Math.max(weldEps, cell * WELD_RATIO);
        var trial = [];
        var totalTris = 0, worstOpen = 0, worstSpread = 0, worstDisp = 0;
        var okTrial = true;
        for (var mi = 0; mi < items.length; mi++) {
          var it2 = items[mi];
          var g2 = it2.geo;
          if (it2.reducible) {
            var d = decimateUV(it2.geo, cell, UV_QUANT);
            g2 = d.geometry;
            var w = weldPositions(g2, cellWeldEps);
            if (w.maxDisp > worstDisp) worstDisp = w.maxDisp;
            if (d.worstUvSpread > worstSpread) worstSpread = d.worstUvSpread;
          }
          trial.push(g2);
          totalTris += triCountOf(g2);
          var op = openRatio(g2);
          if (op > worstOpen) worstOpen = op;
        }
        var attempt = { cell: cell, weldEps: cellWeldEps, tris: totalTris, openRatio: worstOpen, worstUvSpread: worstSpread, weldMaxDisp: worstDisp, geos: trial };
        if (!best || totalTris < best.tris) best = attempt;
        report.attempts = ci + 1;
        /* UV spread bị chặn bởi lượng tử hoá 1/64 theo cấu trúc key —
           cộng epsilon nhỏ cho sai số float. */
        if (totalTris <= targetTris && worstOpen < MAX_OPEN_RATIO && worstSpread <= UV_QUANT + 1e-6) { accepted = attempt; break; }
      }
      if (!accepted) {
        report.errors.push('Không giảm được xuống dưới ' + targetTris + ' tam giác (thử ' + report.attempts + ' ô, tốt nhất ' + (best ? best.tris : '?') + ' tris, cạnh hở ' + (best ? (best.openRatio * 100).toFixed(1) + '%' : '?') + ') — hãy giảm tay bằng Decimate/LOD trước khi xuất');
        report.trisAfter = best ? best.tris : trisBefore;
        report.openRatio = best ? best.openRatio : 1;
        report.weldEps = best ? best.weldEps : null;
        return { group: null, report: report };
      }
      finalGeos = accepted.geos;
      report.decimated = true;
      report.cell = accepted.cell;
      report.weldEps = accepted.weldEps;
      report.openRatio = accepted.openRatio;
      report.worstUvSpread = accepted.worstUvSpread;
      report.weldMaxDisp = accepted.weldMaxDisp;
      report.warnings.push('Đã tự giảm ' + trisBefore.toLocaleString('en-US') + ' → ' + accepted.tris.toLocaleString('en-US') + ' tam giác (ô ' + accepted.cell + ', weld ' + accepted.weldEps.toFixed(4) + ', giữ UV) để vừa giới hạn Mixamo');
    } else {
      /* Không decimate: vẫn đo cạnh hở/UV trên geometry gốc để báo cáo */
      var worstOpen0 = 0, worstSpread0 = 0;
      items.forEach(function (it) {
        var op0 = openRatio(it.geo);
        if (op0 > worstOpen0) worstOpen0 = op0;
      });
      report.openRatio = worstOpen0;
      report.worstUvSpread = worstSpread0;
    }

    var trisAfter = 0;
    finalGeos.forEach(function (g) { trisAfter += triCountOf(g); });
    report.trisAfter = trisAfter;
    if (trisAfter >= MAX_TRIS) {
      report.errors.push('Sau khi chuẩn bị vẫn ' + trisAfter + ' tam giác ≥ giới hạn 50.000 của Mixamo');
      return { group: null, report: report };
    }

    /* --- dựng nhóm xuất: chỉ Mesh thường, không xương, không skin --- */
    var group = new THREE.Group();
    group.name = (root.name || 'model') + '_mixamo';
    for (var gi = 0; gi < items.length; gi++) {
      var m = new THREE.Mesh(finalGeos[gi], items[gi].material);
      m.name = items[gi].name;
      group.add(m);
    }
    group.updateMatrixWorld(true);
    report.ok = true;
    return { group: group, report: report };
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.MixamoSafeExport = MixamoSafeExport;
})();
