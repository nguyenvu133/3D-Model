/* ============================================================
 * mapeditor/export/MapExport.js — Save/Load/Export/Import
 * Project MapEditor: localStorage `mapeditor.project.<name>`,
 * file `.mapeditor.json`. Nối Studio: shared key
 * `pixistudio.sharedScene` (SharedScene.write) rồi mở index.html.
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  var MapExport = {};

  MapExport.currentName = 'Truong Bach';

  MapExport.save = function (name) {
    if (!ME.MapEditor || !ME.MapEditor.data) return false;
    name = name || MapExport.currentName;
    MapExport.currentName = name;
    var data = ME.MapEditor.data;
    data.savedAt = new Date().toISOString();
    var ok = ME.SharedScene.saveProject(name, data);
    if (ok && ME.MapEditor.setStatus) ME.MapEditor.setStatus('Đã lưu project "' + name + '"');
    return ok;
  };

  MapExport.load = function (name) {
    var data = ME.SharedScene.loadProject(name);
    if (!data) return false;
    MapExport.currentName = name;
    return ME.MapEditor.loadData(data);
  };

  MapExport.list = function () {
    return ME.SharedScene.listProjects();
  };

  MapExport.delete = function (name) {
    ME.SharedScene.deleteProject(name);
  };

  MapExport.exportFile = function (name) {
    if (!ME.MapEditor || !ME.MapEditor.data) return false;
    var data = JSON.parse(JSON.stringify(ME.MapEditor.data));
    data.savedAt = new Date().toISOString();
    var fname = (name || MapExport.currentName || 'map').replace(/[^\w\-]+/g, '_') + '.mapeditor.json';
    ME.SharedScene.downloadText(JSON.stringify(data, null, 2), fname, 'application/json');
    return true;
  };

  MapExport.importFile = function (file) {
    return ME.SharedScene.readFileAsText(file).then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) { throw new Error('File JSON không hợp lệ'); }
      var errs = ME.SceneData.validate(data);
      if (errs.length) throw new Error('Scene lỗi: ' + errs.join('; '));
      return ME.MapEditor.loadData(data);
    });
  };

  /* export scene JSON theo format chia sẻ (để mở trong Studio) */
  MapExport.exportSharedFile = function () {
    if (!ME.MapEditor || !ME.MapEditor.data) return false;
    var doc = ME.SceneData.toShared(ME.MapEditor.data, 'mapeditor');
    var fname = (MapExport.currentName || 'map').replace(/[^\w\-]+/g, '_') + '.shared-scene.json';
    ME.SharedScene.downloadText(JSON.stringify(doc, null, 2), fname, 'application/json');
    return true;
  };

  MapExport.importSharedFile = function (file) {
    return ME.SharedScene.readFileAsText(file).then(function (text) {
      var doc;
      try { doc = JSON.parse(text); } catch (e) { throw new Error('File JSON không hợp lệ'); }
      var res = ME.SceneData.fromShared(doc);
      if (!res.data) throw new Error('Shared scene lỗi: ' + res.warnings.join('; '));
      var ok = ME.MapEditor.loadData(res.data);
      if (res.warnings.length && ME.MapEditor.notify) {
        ME.MapEditor.notify('Import shared scene', res.warnings.join(' | '), 'warning');
      }
      return ok;
    });
  };

  /* ---------- nối Studio ---------- */
  MapExport.openInStudio = function () {
    if (!ME.MapEditor || !ME.MapEditor.data) return false;
    var doc = ME.SceneData.toShared(ME.MapEditor.data, 'mapeditor');
    var ok = ME.SharedScene.write(doc);
    if (!ok) {
      if (ME.MapEditor.notify) ME.MapEditor.notify('Mở trong Studio', 'Không ghi được shared key (localStorage đầy/bị chặn). Dùng Export Shared JSON rồi import trong Studio.', 'error');
      return false;
    }
    window.location.href = 'index.html?scene=pixistudio.sharedScene&from=mapeditor';
    return true;
  };

  /* đọc shared key lúc boot (MapEditor mở từ Studio) */
  MapExport.checkIncomingShared = function () {
    var resolved = ME.SharedScene.resolveUrlScene();
    if (resolved && resolved.kind === 'shared') {
      var res = ME.SceneData.fromShared(resolved.doc);
      if (res.data) {
        ME.MapEditor.loadData(res.data);
        /* đã tiêu thụ shared key — xoá để không import lại lần sau */
        ME.SharedScene.clear();
        if (res.warnings.length && ME.MapEditor.notify) {
          ME.MapEditor.notify('Nhận scene từ Studio', res.warnings.join(' | '), 'warning');
        } else if (ME.MapEditor.notify) {
          ME.MapEditor.notify('Nhận scene từ Studio', 'Đã load scene "' + res.data.name + '" từ Studio.', 'success');
        }
        return true;
      }
      return false;
    }
    if (resolved && resolved.kind === 'project') {
      ME.MapEditor.loadData(resolved.data);
      return true;
    }
    return false;
  };

  ME.MapExport = MapExport;
})();
