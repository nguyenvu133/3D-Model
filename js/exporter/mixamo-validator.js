/* ============================================================
 * exporter/mixamo-validator.js — Mixamo Pre-flight (v20.0)
 *
 * Kiểm tra model TRƯỚC khi xuất FBX cho Mixamo, dựa trên các lỗi
 * thực tế đã gặp với X Bot.fbx và FBX exporter (xem
 * docs/V20_UPGRADE_REPORT.md):
 *   - Mixamo chỉ nhận FBX 2013 trở xuống (exporter đã ghi 7300)
 *   - Auto-rig Mixamo giới hạn ~50.000 tam giác
 *   - Nhân vật phải đứng thẳng theo +Y, cao ~1.8 (exporter tự
 *     xoay trục dài nhất lên Y và auto-scale, nhưng vẫn báo để
 *     người dùng biết model sẽ bị biến đổi)
 *   - Rig phải tên mixamorig:* thì Mixamo mới map xương chuẩn
 *   - 1 Skin chung cho nhiều mesh skin là giới hạn của exporter
 *
 * Pure function trên THREE scene — không chạm DOM, không block
 * export: trả về { ok, errors, warnings, stats }, SaveManager chỉ
 * việc gộp warnings vào thông báo. Chạy được cả trong Node
 * (test với three r128) nếu window/THREE đã sẵn sàng.
 * ============================================================ */
(function () {
  'use strict';

  var MAX_TRIS = 50000;        /* giới hạn auto-rig Mixamo */
  var MIXAMO_BONES = 65;       /* khung xương chuẩn mixamorig:* */
  var MIN_HEIGHT = 1.2, MAX_HEIGHT = 3.5;  /* ngoài khoảng này exporter auto-scale */

  function collect(root) {
    var meshes = [], skinned = [], bones = [], boneVisualSkipped = 0;
    var tris = 0;
    root.updateMatrixWorld(true);
    root.traverse(function (o) {
      if (o.isBone) { bones.push(o); return; }
      if (o.userData && (o.userData.isBoneVisual || o.userData.skipSkin)) {
        if (o.isMesh) boneVisualSkipped++;
        return;
      }
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        meshes.push(o);
        var pos = o.geometry.attributes.position;
        tris += Math.round((o.geometry.index ? o.geometry.index.count : pos.count) / 3);
        if (o.isSkinnedMesh) skinned.push(o);
      }
    });
    return { meshes: meshes, skinned: skinned, bones: bones, tris: tris, boneVisualSkipped: boneVisualSkipped };
  }

  function hasTexture(root) {
    var found = false;
    var SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
    root.traverse(function (o) {
      if (!o.isMesh || !o.material || found) return;
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

  var MixamoValidator = {};

  /* mode: 'rig' (Save Mixamo Rig — có xương) | 'mesh-only' (Save Mixamo) */
  MixamoValidator.check = function (root, opts) {
    opts = opts || {};
    var mode = opts.mode || 'rig';
    var errors = [], warnings = [];
    var stats = { meshes: 0, tris: 0, bones: 0, mixamoBones: 0, skinnedMeshes: 0, height: 0, heightAxis: 'Y', hasTexture: false };

    if (!root || !root.traverse) {
      return { ok: false, errors: ['Không có model để kiểm tra'], warnings: warnings, stats: stats };
    }

    var c = collect(root);
    stats.meshes = c.meshes.length;
    stats.tris = c.tris;
    stats.bones = c.bones.length;
    stats.skinnedMeshes = c.skinned.length;
    stats.hasTexture = hasTexture(root);
    c.bones.forEach(function (b) { if (/^mixamorig:?/.test(b.name || '')) stats.mixamoBones++; });

    /* --- kích thước / trục dọc (khớp logic auto-detect của fbx-binary.js) --- */
    if (window.THREE && c.meshes.length) {
      var bb = new THREE.Box3();
      c.meshes.forEach(function (m) { bb.expandByObject(m); });
      if (!bb.isEmpty()) {
        var size = bb.getSize(new THREE.Vector3());
        var dims = [size.x, size.y, size.z];
        var axis = dims.indexOf(Math.max.apply(null, dims));
        stats.heightAxis = 'XYZ'[axis];
        stats.height = dims[axis];
      }
    }

    /* --- lỗi chặn (Mixamo sẽ từ chối) --- */
    if (!c.meshes.length) errors.push('Không có mesh nào để xuất FBX');
    if (c.tris > MAX_TRIS) errors.push(c.tris + ' tam giác > giới hạn 50.000 của Mixamo — hãy giảm chi tiết (Decimate) trước khi upload');
    if (mode === 'rig' && c.bones.length === 0 && c.skinned.length === 0)
      warnings.push('Không có xương/skin — file sẽ là mesh-only, Mixamo tự auto-rig');

    /* --- cảnh báo (xuất được nhưng có thể lỗi / mất màu / sai dáng) --- */
    if (mode === 'rig' && c.bones.length > 0 && stats.mixamoBones === 0)
      warnings.push('Xương không tên mixamorig:* — Mixamo có thể không map được, nên dùng Save Mixamo Rig để dựng khung chuẩn 65 xương');
    if (c.bones.length > MIXAMO_BONES)
      warnings.push(c.bones.length + ' xương > khung chuẩn Mixamo (' + MIXAMO_BONES + ') — xương thừa có thể bị Mixamo bỏ qua');
    if (c.skinned.length > 1)
      warnings.push(c.skinned.length + ' mesh cùng skin 1 skeleton — exporter ghi chung 1 Skin, nên gộp mesh trước khi xuất nếu được');
    if (stats.height > 0 && (stats.height < MIN_HEIGHT || stats.height > MAX_HEIGHT))
      warnings.push('Chiều cao ' + stats.height.toFixed(2) + ' (trục ' + stats.heightAxis + ') ngoài khoảng ' + MIN_HEIGHT + '–' + MAX_HEIGHT + ' — exporter sẽ auto-scale về ~1.8');
    if (stats.heightAxis !== 'Y')
      warnings.push('Model cao theo trục ' + stats.heightAxis + ' — exporter sẽ xoay lên +Y khi xuất');
    if (!stats.hasTexture)
      warnings.push('Không có texture — model sẽ không có màu trên Mixamo (X Bot.fbx gốc cũng không có texture)');
    if (c.boneVisualSkipped > 0)
      warnings.push('Đã bỏ ' + c.boneVisualSkipped + ' mesh trang trí của xương (joint sphere) — không xuất ra FBX');

    return { ok: errors.length === 0, errors: errors, warnings: warnings, stats: stats };
  };

  /* Một dòng tóm tắt để gắn vào notification của SaveManager. */
  MixamoValidator.summary = function (result) {
    var s = result.stats;
    return s.meshes + ' mesh · ' + s.tris + ' tam giác · ' + s.bones + ' xương (' + s.mixamoBones + ' mixamorig) · ' +
      s.skinnedMeshes + ' skinned mesh · cao ' + (s.height ? s.height.toFixed(2) + ' (' + s.heightAxis + ')' : '?') +
      (s.hasTexture ? ' · có texture' : ' · không texture');
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.MixamoValidator = MixamoValidator;
})();
