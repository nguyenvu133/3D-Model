/* ============================================================
 * mapeditor/velo/VeloPanel.js — Panel UI Velo trong MapEditor.
 * Gắn vào DOM bằng JS (không sửa MapEditor.html ngoài script
 * tags): thêm 1 section vào cột phải (#me-right), các nút:
 * Import demo3d Velo (fetch main.scene từ GitHub), chọn file
 * .scene local, Export Velo (.scene) + xem trước text,
 * Tải main.scene / Tải .meta / Tải tất cả (tải tuần tự).
 * Toàn bộ text tiếng Việt. Không làm nút giả: nút nào cũng
 * gọi VeloImport/VeloExport thật; nếu chưa có scene thì báo rõ.
 * ============================================================ */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  root.MapEditor = root.MapEditor || {};
  var ME = root.MapEditor;

  var VeloPanel = {
    _inited: false,
    _els: {}
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function setStatus(msg, isError) {
    var s = VeloPanel._els.status;
    if (s) {
      s.textContent = msg;
      s.style.color = isError ? '#ff7a7a' : '';
    }
    if (ME.MapEditor && ME.MapEditor.setStatus) ME.MapEditor.setStatus(msg);
  }

  function currentData() {
    if (ME.VeloExport && ME.VeloExport.currentData) return ME.VeloExport.currentData();
    return ME.MapEditor ? ME.MapEditor.data : null;
  }

  function showPreview(text) {
    var pre = VeloPanel._els.preview;
    if (pre) pre.textContent = text;
  }

  VeloPanel.importDemo = function () {
    if (!ME.VeloImport || !ME.VeloImport.importDemo3d) {
      setStatus('VeloImport chưa load.', true);
      return;
    }
    setStatus('Đang tải demo3d Velo từ GitHub…');
    ME.VeloImport.importDemo3d().then(function (res) {
      setStatus(res.message || ('Đã import ' + res.objects.length + ' object.'));
    }).catch(function (e) {
      setStatus('Import demo3d lỗi: ' + e.message + ' — thử chọn file .scene local.', true);
    });
  };

  VeloPanel.importFilePicker = function () {
    var input = VeloPanel._els.fileInput;
    if (input) input.click();
  };

  VeloPanel.onFileChosen = function (file) {
    if (!file) return;
    setStatus('Đang import ' + file.name + '…');
    ME.VeloImport.importFile(file).then(function (res) {
      setStatus(res.message || ('Đã import ' + res.objects.length + ' object từ ' + file.name + '.'));
    }).catch(function (e) {
      setStatus('Import file lỗi: ' + e.message, true);
    });
  };

  VeloPanel.exportPreview = function () {
    var data = currentData();
    if (!data) { setStatus('Chưa có scene để export.', true); return null; }
    if (!ME.VeloExport) { setStatus('VeloExport chưa load.', true); return null; }
    try {
      var gen = ME.VeloExport.generate(data);
      showPreview(gen.text);
      var v = ME.VeloExport.validate(gen.text);
      var warn = gen.warnings.length ? ' · ' + gen.warnings.length + ' cảnh báo (xem console)' : '';
      gen.warnings.forEach(function (w) { console.warn('[VeloExport]', w); });
      setStatus(v.ok
        ? 'Export OK: ' + gen.stats.objects + ' object, ' + gen.stats.prefabInstances + ' prefab instance, ' + gen.stats.spawners + ' spawner — parse lại được (' + v.totalNodes + ' node).' + warn
        : 'Export xong nhưng parse lại LỖI: ' + v.errors.join('; '));
      return gen;
    } catch (e) {
      setStatus('Export lỗi: ' + e.message, true);
      return null;
    }
  };

  VeloPanel.downloadScene = function () {
    var gen = VeloPanel.exportPreview();
    if (!gen) return;
    try {
      ME.VeloExport.downloadScene();
      setStatus('Đã tải main.scene (' + gen.stats.objects + ' object).');
    } catch (e) {
      setStatus('Tải main.scene lỗi: ' + e.message, true);
    }
  };

  VeloPanel.downloadMetas = function () {
    var data = currentData();
    if (!data) { setStatus('Chưa có scene để export.', true); return; }
    setStatus('Đang tải các file .meta…');
    ME.VeloExport.downloadMetas(data).then(function (proj) {
      setStatus('Đã tải ' + proj.files.filter(function (f) { return /\.meta$/.test(f.path); }).length + ' file .meta.');
    }).catch(function (e) {
      setStatus('Tải .meta lỗi: ' + e.message, true);
    });
  };

  VeloPanel.downloadAll = function () {
    var data = currentData();
    if (!data) { setStatus('Chưa có scene để export.', true); return; }
    VeloPanel.exportPreview();
    setStatus('Đang tải tất cả file Velo (main.scene + .meta + README)…');
    ME.VeloExport.downloadAll(data).then(function (proj) {
      setStatus('Đã tải tất cả: ' + proj.files.length + ' file (' + proj.files.map(function (f) { return f.path; }).join(', ') + '). Nhớ copy file FBX vào assets/models/ (xem README-VELO.md).');
    }).catch(function (e) {
      setStatus('Tải tất cả lỗi: ' + e.message, true);
    });
  };

  VeloPanel.init = function () {
    if (VeloPanel._inited) return true;
    if (typeof document === 'undefined') return false;
    var right = document.getElementById('me-right');
    var host = right || document.body;
    if (!host) return false;
    VeloPanel._inited = true;

    var head = el('div', 'panel-head', '🎮 Velo — Import/Export .scene');
    var body = el('div', 'panel-body');
    body.style.cssText = 'flex:none;max-height:340px;';
    var inner = el('div');
    inner.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:2px;';

    function btn(label, title, fn) {
      var b = el('button', 'btn sm', label);
      b.title = title || label;
      b.style.textAlign = 'left';
      b.addEventListener('click', fn);
      return b;
    }

    inner.appendChild(btn('⬇ Import demo3d Velo', 'Tải main.scene demo3d từ repo velo-engine/velo (nhánh 3d) rồi dựng vào map', function () { VeloPanel.importDemo(); }));
    inner.appendChild(btn('📂 Chọn file .scene…', 'Import file .scene bất kỳ của bạn (cùng parser)', function () { VeloPanel.importFilePicker(); }));
    inner.appendChild(btn('⬆ Export Velo (.scene) — xem trước', 'Sinh text .scene từ map hiện tại, hiện ở khung xem trước bên dưới', function () { VeloPanel.exportPreview(); }));
    inner.appendChild(btn('⬇ Tải main.scene', 'Tải file main.scene đã export', function () { VeloPanel.downloadScene(); }));
    inner.appendChild(btn('⬇ Tải .meta', 'Tải tuần tự các file .meta (main.scene + prefab + model)', function () { VeloPanel.downloadMetas(); }));
    inner.appendChild(btn('⬇ Tải tất cả', 'Tải tuần tự: main.scene + .meta + README-VELO.md (+ .scene prefab nếu đã tải về)', function () { VeloPanel.downloadAll(); }));

    var note = el('div', null,
      'Import: demo3d Velo (Hero Thần Điêu, 4 đuốc, 7 cây, portal…) — HUD 2D bỏ qua. ' +
      'Export: game logic V + file FBX không kèm, xem docs/VELO_INTEGRATION.md.');
    note.style.cssText = 'color:var(--text3);font-size:11px;line-height:1.4;';
    inner.appendChild(note);

    var status = el('div', null, 'Velo sẵn sàng.');
    status.id = 'me-velo-status';
    status.style.cssText = 'font-size:11px;line-height:1.4;min-height:16px;';
    inner.appendChild(status);

    var pre = el('pre', null, '// Xem trước text .scene sẽ hiện ở đây sau khi bấm Export.');
    pre.id = 'me-velo-preview';
    pre.style.cssText = 'font-size:10px;line-height:1.35;max-height:150px;overflow:auto;background:rgba(0,0,0,0.25);padding:6px;border-radius:4px;white-space:pre-wrap;word-break:break-word;margin:0;';
    inner.appendChild(pre);

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.scene';
    fileInput.className = 'hidden';
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (f) VeloPanel.onFileChosen(f);
    });
    inner.appendChild(fileInput);

    body.appendChild(inner);
    if (right) {
      right.appendChild(head);
      right.appendChild(body);
    } else {
      var wrap = el('div');
      wrap.style.cssText = 'position:fixed;right:12px;top:12px;z-index:50;background:#1a2233;color:#fff;padding:10px;border-radius:8px;max-width:320px;';
      wrap.appendChild(head);
      wrap.appendChild(body);
      host.appendChild(wrap);
    }
    VeloPanel._els = { status: status, preview: pre, fileInput: fileInput };
    return true;
  };

  ME.VeloPanel = VeloPanel;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { VeloPanel.init(); });
    } else {
      VeloPanel.init();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ME.VeloPanel;
  }
})();
