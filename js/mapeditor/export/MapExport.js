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

  /* Thu gọn shared doc trước khi ghi/tải: deep-clone rồi làm tròn
   * terrain.heights về 3 chữ số thập phân (đủ chính xác cho terrain,
   * giảm ~30% dung lượng JSON → ít chạm quota localStorage hơn).
   * KHÔNG sửa SceneData.js — chỉ xử lý trên bản clone ở đây. */
  MapExport.compactSharedDoc = function (doc) {
    var c = JSON.parse(JSON.stringify(doc));
    var h = c && c.map && c.map.terrain && c.map.terrain.heights;
    if (Array.isArray(h)) {
      for (var i = 0; i < h.length; i++) {
        if (typeof h[i] === 'number') h[i] = Math.round(h[i] * 1000) / 1000;
      }
    }
    return c;
  };

  MapExport.sharedFileName = function () {
    return (MapExport.currentName || 'map').replace(/[^\w\-]+/g, '_') + '.shared-scene.json';
  };

  /* export scene JSON theo format chia sẻ (để mở trong Studio) */
  MapExport.exportSharedFile = function () {
    if (!ME.MapEditor || !ME.MapEditor.data) return false;
    var doc = MapExport.compactSharedDoc(ME.SceneData.toShared(ME.MapEditor.data, 'mapeditor'));
    ME.SharedScene.downloadText(JSON.stringify(doc, null, 2), MapExport.sharedFileName(), 'application/json');
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

  /* ---------- nối Studio ----------
   * openInStudio(): thử shared key trước (đường chính).
   * Ghi key THẤT BẠI (quota/security) → FALLBACK TỰ ĐỘNG: tải file
   * Shared JSON + hiện panel hướng dẫn 3 bước, nút "Đã tải xong —
   * Mở Studio" mở index.html (không cần shared key); Studio sẽ
   * import bằng nút "Import Shared JSON" trên topbar. */
  MapExport.openInStudio = function () {
    if (!ME.MapEditor || !ME.MapEditor.data) return false;
    var doc = MapExport.compactSharedDoc(ME.SceneData.toShared(ME.MapEditor.data, 'mapeditor'));
    var res = ME.SharedScene.write(doc);
    if (res && res.ok) {
      window.location.href = 'index.html?scene=pixistudio.sharedScene&from=mapeditor';
      return true;
    }
    var reasonText = (res && res.reason === 'quota')
      ? 'localStorage đã đầy'
      : (res && res.reason === 'security')
        ? 'trình duyệt chặn ghi localStorage (chế độ riêng tư / chặn cookie bên thứ ba)'
        : 'không ghi được shared key';
    /* fallback: tải file Shared JSON ngay, rồi hướng dẫn bằng panel */
    try { ME.SharedScene.downloadText(JSON.stringify(doc, null, 2), MapExport.sharedFileName(), 'application/json'); } catch (e) { }
    if (ME.MapEditor.notify) ME.MapEditor.notify('Mở trong Studio', 'Không ghi được shared key (' + reasonText + '). Đã tải file Shared JSON — làm theo 3 bước trong panel.', 'warning');
    MapExport._showSharedFallbackPanel(reasonText);
    return false;
  };

  /* Panel hướng dẫn 3 bước khi shared key ghi thất bại (tạo bằng JS,
   * không cần sửa MapEditor.html). Nút chính mở Studio không cần key. */
  MapExport._showSharedFallbackPanel = function (reasonText) {
    var old = document.getElementById('me-shared-fallback-panel');
    if (old) old.remove();
    var fname = MapExport.sharedFileName();
    var panel = document.createElement('div');
    panel.id = 'me-shared-fallback-panel';
    panel.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);font-family:inherit;';
    panel.innerHTML =
      '<div style="background:#1e2230;color:#eef1f8;max-width:480px;width:92%;padding:20px 22px;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);">' +
      '<h3 style="margin:0 0 6px;font-size:17px;">Không ghi được shared key — đã tải file Shared JSON</h3>' +
      '<p style="margin:0 0 12px;font-size:13px;opacity:.85;">Lý do: ' + reasonText + '. Map của bạn vẫn an toàn trong file vừa tải.</p>' +
      '<ol style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.9;">' +
      '<li>File <b>' + fname + '</b> vừa được tải xuống (kiểm tra thư mục Downloads).</li>' +
      '<li>Bấm nút <b>“Đã tải xong — Mở Studio”</b> bên dưới để mở Studio.</li>' +
      '<li>Trong Studio, bấm nút <b>“Import Shared JSON”</b> trên thanh topbar rồi chọn file vừa tải.</li>' +
      '</ol>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button id="me-shared-fallback-close" style="padding:8px 14px;border-radius:8px;border:1px solid #555;background:transparent;color:#eef1f8;cursor:pointer;">Đóng</button>' +
      '<button id="me-shared-fallback-open" style="padding:8px 14px;border-radius:8px;border:none;background:#713bff;color:#fff;cursor:pointer;">Đã tải xong — Mở Studio</button>' +
      '</div></div>';
    document.body.appendChild(panel);
    var openBtn = document.getElementById('me-shared-fallback-open');
    if (openBtn) openBtn.addEventListener('click', function () { window.location.href = 'index.html'; });
    var closeBtn = document.getElementById('me-shared-fallback-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { panel.remove(); });
  };

  /* Nút "Export Shared JSON" riêng, cạnh nút "Mở trong Studio"
   * (#me-studio-btn). Tự gắn bằng JS lúc load (MapExport.js chạy cuối
   * body nên DOM đã sẵn sàng) — không sửa MapEditor.html/MapEditor.js.
   * Gọi lại được nếu topbar render lại: MapExport.bindSharedButtons(). */
  MapExport.bindSharedButtons = function () {
    if (document.getElementById('me-export-shared-btn')) return;
    var studioBtn = document.getElementById('me-studio-btn');
    if (!studioBtn || !studioBtn.parentNode) return;
    var b = document.createElement('button');
    b.id = 'me-export-shared-btn';
    b.className = studioBtn.className || 'btn sm';
    b.title = 'Tải file .shared-scene.json — import trong Studio bằng nút "Import Shared JSON"';
    b.textContent = '⬇ Export Shared JSON';
    b.addEventListener('click', function () {
      if (MapExport.exportSharedFile() && ME.MapEditor.notify) {
        ME.MapEditor.notify('Export Shared JSON', 'Đã tải "' + MapExport.sharedFileName() + '". Mở Studio rồi bấm "Import Shared JSON" để import.', 'success');
      } else if (ME.MapEditor.notify) {
        ME.MapEditor.notify('Export Shared JSON', 'Chưa có map để export.', 'error');
      }
    });
    studioBtn.parentNode.insertBefore(b, studioBtn.nextSibling);
  };
  (function () {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', MapExport.bindSharedButtons);
    } else {
      MapExport.bindSharedButtons();
    }
  })();

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
