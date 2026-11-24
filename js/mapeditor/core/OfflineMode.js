/* ============================================================
 * mapeditor/core/OfflineMode.js — Chế độ OFFLINE cho MapEditor
 * (NHÓM 2 — vendor + offline).
 *
 * Mục đích: mở MapEditor.html trên điện thoại qua file:// mà
 * KHÔNG cần mạng — thư viện three/pixi/loaders đã vendor về
 * js/vendor/ (nguồn chính trong MapEditor.html), còn mọi thao
 * tác cần mạng thì bị vô hiệu hoá rõ ràng + có lối thay thế
 * bằng file local (FileReader, không upload đâu cả).
 *
 * Tự init khi DOM sẵn sàng (không cần sửa MapEditor.js):
 *  - Badge "● Offline"/"● Online" trên toolbar (#me-toolbar),
 *    cập nhật khi event online/offline. "Offline" ở đây là
 *    offline HIỆU LỰC: mất mạng HOẶC đang mở qua file://
 *    (trình duyệt chặn fetch() tới file/mạng local trên file://).
 *  - Vô hiệu hoá các nút cần mạng trong panel Velo (khớp theo
 *    text nút: "Import demo3d", "...từ GitHub"...), kèm tooltip
 *    ghi rõ lý do; khi có mạng trở lại thì mở lại.
 *  - Chèn khối picker offline vào panel Velo lúc runtime
 *    (không sửa VeloPanel.js): "Mở .scene từ máy (offline)"
 *    → VeloImport.importFile, "Mở .fbx Thần Điêu từ máy
 *    (offline)" → VeloImport.loadHeroFBXFromBuffer.
 *  - Chặn sớm VeloImport.importDemo3d khi offline (fetch GitHub
 *    chắc chắn lỗi) để báo lỗi rõ ràng thay vì treo/chờ timeout.
 *
 * Vanilla JS, không cần THREE/DOM để load; mọi truy cập DOM
 * đều guard để file vẫn require được bằng node (test).
 * ============================================================ */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  root.MapEditor = root.MapEditor || {};
  var ME = root.MapEditor;

  var BADGE_ID = 'me-offline-badge';
  var PICKERS_ID = 'me-offline-pickers';
  /* Text nút cần mạng (khớp không phân biệt hoa/thường, khớp chuỗi
   * con). "Import demo3d Velo" fetch main.scene từ GitHub;
   * mọi nút nhắc tới GitHub raw cũng cần mạng. Nút tải file
   * (.scene/.meta — Blob download) và nút chọn file local thì
   * KHÔNG nằm trong danh sách này, vẫn dùng được offline. */
  var NETWORK_BUTTON_PATTERNS = [/demo3d/i, /từ github/i, /github raw/i, /\bgithub\b/i];

  function isFileProtocol() {
    try {
      return typeof location !== 'undefined' && location.protocol === 'file:';
    } catch (e) { return false; }
  }

  function isOnline() {
    try {
      if (typeof navigator === 'undefined' || typeof navigator.onLine === 'undefined') return true;
      return !!navigator.onLine;
    } catch (e) { return true; }
  }

  /* Offline HIỆU LỰC: mất mạng, hoặc đang mở qua file://. */
  function isOffline() {
    return !isOnline() || isFileProtocol();
  }

  function offlineReason() {
    if (isFileProtocol()) return 'đang mở qua file:// — trình duyệt chặn fetch() tới file/mạng local';
    if (!isOnline()) return 'không có mạng (navigator.onLine = false)';
    return '';
  }

  function setStatus(msg) {
    try {
      if (ME.MapEditor && ME.MapEditor.setStatus) { ME.MapEditor.setStatus(msg); return; }
      var s = (typeof document !== 'undefined') ? document.getElementById('me-velo-status') : null;
      if (s) s.textContent = msg;
    } catch (e) { }
  }

  function hasDocument() {
    return typeof document !== 'undefined' && document;
  }

  /* ---------- badge Online/Offline trên toolbar ---------- */
  function ensureBadge() {
    if (!hasDocument()) return null;
    var badge = document.getElementById(BADGE_ID);
    if (badge) return badge;
    badge = document.createElement('span');
    badge.id = BADGE_ID;
    badge.title = 'Trạng thái mạng';
    badge.style.cssText = 'font-size:12px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;';
    var toolbar = document.getElementById('me-toolbar');
    if (toolbar) {
      toolbar.appendChild(badge);
    } else if (document.body) {
      badge.style.cssText += 'position:fixed;top:8px;right:8px;z-index:99;background:#222;color:#fff;';
      document.body.appendChild(badge);
    } else {
      return null;
    }
    return badge;
  }

  function updateBadge() {
    var badge = ensureBadge();
    if (!badge) return;
    var off = isOffline();
    badge.textContent = off ? '● Offline' : '● Online';
    badge.style.background = off ? '#7a2e2e' : '#1e5c33';
    badge.style.color = '#fff';
    badge.title = off
      ? 'Offline: ' + offlineReason() + ' — các nút cần mạng bị khoá, dùng file local thay thế.'
      : 'Online — các nút cần mạng (Import demo3d từ GitHub…) dùng được.';
  }

  /* ---------- vô hiệu hoá nút cần mạng ---------- */
  function needsNetwork(btn) {
    var t = '';
    try { t = (btn.textContent || '') + ' ' + (btn.title || ''); } catch (e) { }
    for (var i = 0; i < NETWORK_BUTTON_PATTERNS.length; i++) {
      if (NETWORK_BUTTON_PATTERNS[i].test(t)) return true;
    }
    return false;
  }

  function applyButtonState(btn, off) {
    if (!btn) return;
    if (off) {
      if (!btn.disabled) {
        try { btn.dataset.meOfflinePrevTitle = btn.title || ''; } catch (e) { }
        btn.disabled = true;
      }
      btn.title = 'Cần mạng — ' + offlineReason() + '. Dùng file local (nút offline bên dưới) thay thế.';
      try { if (btn.classList) btn.classList.add('me-offline-disabled'); } catch (e) { }
    } else {
      if (btn.disabled) {
        btn.disabled = false;
        try { btn.title = btn.dataset.meOfflinePrevTitle || btn.title || ''; } catch (e) { }
        try { if (btn.classList) btn.classList.remove('me-offline-disabled'); } catch (e) { }
      }
    }
  }

  function disableNetworkButtons() {
    if (!hasDocument()) return 0;
    var off = isOffline();
    var count = 0;
    var btns = document.querySelectorAll ? document.querySelectorAll('button') : [];
    for (var i = 0; i < btns.length; i++) {
      if (needsNetwork(btns[i])) { applyButtonState(btns[i], off); count++; }
    }
    return count;
  }

  /* ---------- chặn sớm importDemo3d khi offline ---------- */
  var _demoGuarded = false;
  function guardImportDemo() {
    if (_demoGuarded) return;
    if (!ME.VeloImport || typeof ME.VeloImport.importDemo3d !== 'function') return;
    var orig = ME.VeloImport.importDemo3d;
    ME.VeloImport.importDemo3d = function (opts) {
      if (isOffline()) {
        var msg = 'Import demo3d cần mạng — ' + offlineReason() +
          '. Dùng nút "📂 Mở .scene từ máy (offline)" trong panel Velo để import file .scene local.';
        setStatus(msg);
        return Promise.reject(new Error(msg));
      }
      return orig.call(ME.VeloImport, opts);
    };
    _demoGuarded = true;
  }

  /* ---------- khối picker offline chèn vào panel Velo ---------- */
  function readFileAsArrayBuffer(file) {
    if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onload = function () { resolve(rd.result); };
      rd.onerror = function () { reject(new Error('đọc file lỗi')); };
      rd.readAsArrayBuffer(file);
    });
  }

  function onSceneFileChosen(file) {
    if (!file) return;
    if (ME.VeloPanel && typeof ME.VeloPanel.onFileChosen === 'function') {
      ME.VeloPanel.onFileChosen(file);
      return;
    }
    setStatus('Đang import ' + file.name + ' (offline)…');
    if (!ME.VeloImport || typeof ME.VeloImport.importFile !== 'function') {
      setStatus('VeloImport chưa load.', true);
      return;
    }
    ME.VeloImport.importFile(file).then(function (res) {
      setStatus(res.message || ('Đã import ' + res.objects.length + ' object từ ' + file.name + ' (offline).'));
    }).catch(function (e) {
      setStatus('Import file lỗi: ' + e.message, true);
    });
  }

  function onFbxFileChosen(file) {
    if (!file) return;
    if (ME.VeloPanel && typeof ME.VeloPanel.onHeroFileChosen === 'function') {
      ME.VeloPanel.onHeroFileChosen(file);
      return;
    }
    setStatus('Đang parse ' + file.name + ' (offline)…');
    if (!ME.VeloImport || typeof ME.VeloImport.loadHeroFBXFromBuffer !== 'function') {
      setStatus('VeloImport chưa load.', true);
      return;
    }
    readFileAsArrayBuffer(file).then(function (buf) {
      return ME.VeloImport.loadHeroFBXFromBuffer(buf, file.name);
    }).then(function (ok) {
      setStatus(ok
        ? 'Đã load Thần Điêu FBX từ file bạn chọn (offline) — Hero là Thần Điêu thật (chỉ lưu trong phiên).'
        : 'File FBX đã chọn parse lỗi — Hero giữ dạng chibi.', !ok);
    }).catch(function (e) {
      setStatus('Đọc file FBX lỗi: ' + e.message, true);
    });
  }

  function makePickerButton(label, title, accept, onFile) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.className = 'hidden';
    input.style.display = 'none';
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      input.value = '';
      if (f) onFile(f);
    });
    var b = document.createElement('button');
    b.className = 'btn sm';
    b.textContent = label;
    b.title = title;
    b.style.textAlign = 'left';
    b.addEventListener('click', function () { input.click(); });
    return { button: b, input: input };
  }

  function injectOfflinePickers() {
    if (!hasDocument()) return false;
    if (document.getElementById(PICKERS_ID)) return true;
    /* Neo vào panel Velo: #me-velo-status nằm trong inner div của
     * panel-body Velo (VeloPanel.js tạo). Chưa có panel thì thôi —
     * MutationObserver sẽ gọi lại khi panel xuất hiện. */
    var anchor = document.getElementById('me-velo-status');
    var host = null;
    if (anchor && anchor.parentNode) host = anchor.parentNode;
    else {
      var right = document.getElementById('me-right');
      if (right) host = right;
    }
    if (!host) return false;
    var box = document.createElement('div');
    box.id = PICKERS_ID;
    box.style.cssText = 'border:1px dashed #7a6a2e;border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:6px;margin-bottom:2px;';
    var head = document.createElement('div');
    head.textContent = '📴 Offline — mở file từ máy (không cần mạng)';
    head.style.cssText = 'font-size:11px;font-weight:700;color:#ffcf5a;';
    box.appendChild(head);
    var scene = makePickerButton('📂 Mở .scene từ máy (offline)',
      'Import file .scene trên máy/điện thoại bằng FileReader — chạy offline, không upload đâu cả',
      '.scene', onSceneFileChosen);
    box.appendChild(scene.button);
    box.appendChild(scene.input);
    var fbx = makePickerButton('📂 Mở .fbx Thần Điêu từ máy (offline)',
      'Chọn file than_dieu_run.fbx trên máy/điện thoại — Hero thành Thần Điêu thật ngay, chỉ lưu trong phiên, không upload đâu cả',
      '.fbx', onFbxFileChosen);
    box.appendChild(fbx.button);
    box.appendChild(fbx.input);
    var note = document.createElement('div');
    note.textContent = 'File đọc bằng FileReader ngay trên máy — không cần mạng, không upload. ' +
      'Nút "Import demo3d Velo" cần mạng nên bị khoá khi offline.';
    note.style.cssText = 'color:var(--text3);font-size:11px;line-height:1.4;';
    box.appendChild(note);
    if (anchor && anchor.parentNode === host) host.insertBefore(box, host.firstChild);
    else host.appendChild(box);
    return true;
  }

  /* ---------- scan tổng: badge + nút mạng + picker + guard ---------- */
  function scan() {
    updateBadge();
    disableNetworkButtons();
    injectOfflinePickers();
    guardImportDemo();
  }

  var _inited = false;
  var _observer = null;

  function init() {
    if (_inited) return true;
    _inited = true;
    if (!hasDocument()) return false;
    scan();
    try {
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('online', scan);
        window.addEventListener('offline', scan);
      }
    } catch (e) { }
    try {
      if (typeof MutationObserver !== 'undefined' && document.body) {
        _observer = new MutationObserver(function () { scan(); });
        _observer.observe(document.body, { childList: true, subtree: true });
      }
    } catch (e) { }
    /* VeloPanel.init chạy ở DOMContentLoaded — quét lại vài lần để
     * bắt kịp panel được tạo sau OfflineMode. */
    try {
      setTimeout(scan, 500);
      setTimeout(scan, 1500);
      setTimeout(scan, 3000);
    } catch (e) { }
    return true;
  }

  var OfflineMode = {
    isOffline: isOffline,
    isFileProtocol: isFileProtocol,
    isOnline: isOnline,
    offlineReason: offlineReason,
    updateBadge: updateBadge,
    disableNetworkButtons: disableNetworkButtons,
    injectOfflinePickers: injectOfflinePickers,
    scan: scan,
    init: init
  };

  ME.OfflineMode = OfflineMode;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { init(); });
    } else {
      init();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ME.OfflineMode;
  }
})();
