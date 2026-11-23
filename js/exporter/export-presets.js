/* ============================================================
 * exporter/export-presets.js — Export Presets (v21.0)
 *
 * 1 click xuất đúng chuẩn từng engine — preset chỉ đổi những gì
 * FBX/GLB writer thật sự hỗ trợ (version, upAxis, autoScale) +
 * ghi chú đơn vị để import đúng bên engine.
 *
 *  - Mixamo: FBX 2013 (7300), Y-up, auto-scale về 1.8m — Mixamo chỉ
 *    nhận "2013 or earlier".
 *  - Unity: FBX 2014+, Y-up, mét — Unity import mặc định đã đúng.
 *  - Unreal: FBX 2014+, Z-up, cm — Unreal là Z-up; scale cm chỉnh ở
 *    cửa sổ Import (Unreal mặc định Convert Scene Unit).
 *  - Godot: GLB, Y-up, mét — Godot ưu tiên GLB.
 *  - Roblox: FBX 2013, Y-up, studs (1 stud ≈ 28cm) — xuất về ~6.4
 *    stud cao, import qua Avatar Importer.
 * ============================================================ */
(function () {
  'use strict';

  const PRESETS = {
    mixamo: {
      id: 'mixamo', name: 'Mixamo', format: 'fbx', version: 7300, upAxis: 'Y',
      autoScale: true, unit: 'm', suffix: 'mixamo',
      note: 'FBX 2013, Y-up, cao 1.8m — Mixamo chỉ nhận 2013 trở về trước.'
    },
    unity: {
      id: 'unity', name: 'Unity', format: 'fbx', version: 7400, upAxis: 'Y',
      autoScale: true, unit: 'm', suffix: 'unity',
      note: 'FBX 2014+, Y-up, mét — Unity import mặc định, scale 1.'
    },
    unreal: {
      id: 'unreal', name: 'Unreal Engine', format: 'fbx', version: 7400, upAxis: 'Z',
      autoScale: true, unit: 'cm', suffix: 'unreal',
      note: 'FBX 2014+, Z-up — Unreal là Z-up; đơn vị cm chỉnh ở cửa sổ Import (Convert Scene Unit).'
    },
    godot: {
      id: 'godot', name: 'Godot', format: 'glb', version: 0, upAxis: 'Y',
      autoScale: true, unit: 'm', suffix: 'godot',
      note: 'GLB, Y-up, mét — Godot ưu tiên GLB, import thẳng.'
    },
    roblox: {
      id: 'roblox', name: 'Roblox', format: 'fbx', version: 7300, upAxis: 'Y',
      autoScale: true, unit: 'stud', suffix: 'roblox',
      note: 'FBX 2013, Y-up — import qua Avatar Importer (R15), 1 stud ≈ 28cm.'
    }
  };

  const ExportPresets = {
    PRESETS: PRESETS,
    current: 'mixamo'
  };

  ExportPresets.list = function () {
    return Object.keys(PRESETS).map(function (id) { return PRESETS[id]; });
  };
  ExportPresets.get = function (id) {
    return PRESETS[id] || null;
  };
  ExportPresets.setCurrent = function (id) {
    if (!PRESETS[id]) return false;
    ExportPresets.current = id;
    return true;
  };
  /* Opts thật đưa vào FBXBinary.write / GLB writer. */
  ExportPresets.writeOpts = function (id) {
    const p = PRESETS[id || ExportPresets.current];
    if (!p) return null;
    return { format: p.format, version: p.version, upAxis: p.upAxis, autoScale: p.autoScale, unit: p.unit, suffix: p.suffix };
  };
  ExportPresets.fileSuffix = function (id) {
    const p = PRESETS[id || ExportPresets.current];
    return p ? p.suffix : 'export';
  };

  window.PixiStudio.ExportPresets = ExportPresets;
})();
