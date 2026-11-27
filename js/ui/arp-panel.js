/* ============================================================
 * ui/arp-panel.js — PANEL AUTO RIG PRO BLEND (bản mở rộng,
 * PHẦN A + PHẦN 9 cửa sổ nổi riêng)
 *
 * Từ PHẦN 9 panel không còn là modal overlay chặn màn hình mà là
 * 1 CỬA SỔ NỔI RIÊNG BIỆT (.arp-window, #arp-window):
 *  - thanh tiêu đề riêng, gradient tím nổi bật + viền đậm;
 *  - kéo thanh tiêu đề để di chuyển, kéo góc dưới-phải để resize
 *    (min 360x300, không vượt viewport);
 *  - nút Thu nhỏ / Phóng to / Đóng trên header; Esc vẫn đóng;
 *  - bấm nền ngoài cửa sổ KHÔNG đóng nữa (overlay trong suốt,
 *    pointer-events:none — vẫn thấy + tương tác được viewport/model
 *    phía sau, kéo cửa sổ sang bên để xem model trong lúc chỉnh
 *    marker/control);
 *  - nhớ vị trí + kích thước vào localStorage
 *    ('pixistudio.arp-window'); nút ⟲ reset về mặc định
 *    (giữa màn hình, 720x560 PC);
 *  - mobile ≤767px: cửa sổ thành full-screen (.arp-window-mobile).
 * Chuyển tab không làm mất vị trí/kích thước (geometry lưu riêng).
 *
 * API (giữ nguyên từ PHẦN A):
 *   ArpPanel.open(tabId) / close() / showTab(id) /
 *   registerTab(id, title, renderFn) / isOpen() / currentTab()
 * API mới (PHẦN 9):
 *   ArpPanel.minimize() / maximize() / restore() /
 *   resetWindowPos() / getWindowState() /
 *   setWindowPos(x, y) / setWindowSize(w, h)
 *   getWindowState() → {x, y, w, h, maximized, minimized, mode}
 *     mode: 'normal' | 'maximized' | 'minimized' | 'mobile'
 * API mới (Plugins — js/rig/arp-plugins.js):
 *   ArpPanel.unregisterTab(id) — gỡ 1 tab (plugin bị tắt/gỡ);
 *   nếu tab đang mở thì về tab Smart.
 *   Tab 'plugins' (quản lý plugin) nằm trong TAB_ORDER; các tab
 *   của plugin (id 'plugin:<id>') do ArpPlugins đăng ký, render
 *   sau các tab cố định trong renderTabBar.
 *
 * Tab Smart do js/rig/arp-smart.js render (PixiStudio.ArpSmart).
 * 4 tab còn lại do agent khác đăng ký qua registerTab — panel này
 * KHÔNG tự dựng nội dung của chúng.
 * Nút topbar btn-auto-rig-pro gọi ArpPanel.open() (wiring trong
 * js/ui/panels.js).
 *
 * GIỚI HẠN (ghi rõ để khỏi hiểu lầm):
 *  - drag/resize bằng chuột trên PC là chính; trên điện thoại dùng
 *    chạm kéo thanh tiêu đề (mobile là full-screen nên không resize
 *    bằng kéo góc — dùng nút Phóng to thay).
 *  - vị trí lưu ở localStorage trình duyệt, không đồng bộ qua GitHub.
 *  - drag/resize dùng pointer events, fallback mouse events khi
 *    trình duyệt không có PointerEvent.
 * ============================================================ */
(function () {
  'use strict';

  var bus = PixiStudio.bus;

  var TAB_ORDER = ['smart', 'remap', 'export', 'quickrig', 'boneshape', 'plugins'];
  var TAB_TITLES = {
    smart: 'Smart',
    remap: 'Remap',
    export: 'Export',
    quickrig: 'Quick Rig',
    boneshape: 'Bone Shape',
    plugins: 'Plugins'
  };

  /* --- Cửa sổ nổi (PHẦN 9) --- */
  var WIN_KEY = 'pixistudio.arp-window';
  var WIN_DEFAULT_W = 720;
  var WIN_DEFAULT_H = 560;
  var WIN_MIN_W = 360;
  var WIN_MIN_H = 300;
  var MOBILE_MAX_W = 767;
  var HEADER_H = 48; /* chiều cao ước lượng của thanh tiêu đề, dùng để clamp khi kéo */

  /* Geometry cửa sổ. x/y = null nghĩa là chưa đặt → căn giữa khi mở. */
  var _win = {
    x: null, y: null,
    w: WIN_DEFAULT_W, h: WIN_DEFAULT_H,
    maximized: false, minimized: false,
    prev: null /* geometry thường trước khi max/min, để restore */
  };

  var ArpPanel = {
    _built: false,
    _open: false,
    _current: 'smart',
    _tabs: {},          /* id -> { title, renderFn } */
    _overlay: null,
    _window: null,
    _header: null,
    _minBtn: null,
    _maxBtn: null,
    _body: null,
    _bar: null,
    _dragActive: false
  };
  ArpPanel.TAB_ORDER = TAB_ORDER;

  function notify(type, title, message) {
    if (bus && bus.emit) bus.emit('notify', { type: type, title: title, message: message });
  }

  /* ---------- Geometry cửa sổ (hàm thuần, harness gọi trực tiếp) ---------- */

  function viewportSize() {
    var w = (typeof window !== 'undefined' && window.innerWidth) ||
      (document.documentElement && document.documentElement.clientWidth) || 1024;
    var h = (typeof window !== 'undefined' && window.innerHeight) ||
      (document.documentElement && document.documentElement.clientHeight) || 768;
    return { w: w, h: h };
  }

  function isMobileMode() { return viewportSize().w <= MOBILE_MAX_W; }

  function clampNum(v, lo, hi) { if (v < lo) return lo; if (v > hi) return hi; return v; }

  function defaultPos() {
    var vp = viewportSize();
    return {
      x: Math.max(0, Math.round((vp.w - _win.w) / 2)),
      y: Math.max(0, Math.round((vp.h - _win.h) / 2))
    };
  }

  function ensurePos() {
    if (_win.x == null || _win.y == null) {
      var p = defaultPos();
      if (_win.x == null) _win.x = p.x;
      if (_win.y == null) _win.y = p.y;
    }
  }

  /* Đọc geometry đã lưu. Trả false khi chưa có / hỏng → dùng mặc định. */
  function loadWindowState() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(WIN_KEY);
      if (!raw) return false;
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return false;
      if (typeof s.w === 'number' && isFinite(s.w)) _win.w = clampNum(Math.round(s.w), WIN_MIN_W, 4096);
      if (typeof s.h === 'number' && isFinite(s.h)) _win.h = clampNum(Math.round(s.h), WIN_MIN_H, 4096);
      if (typeof s.x === 'number' && isFinite(s.x)) _win.x = Math.round(s.x);
      if (typeof s.y === 'number' && isFinite(s.y)) _win.y = Math.round(s.y);
      _win.maximized = !!s.maximized;
      _win.minimized = !!s.minimized;
      _win.prev = null;
      /* Viewport có thể đã nhỏ lại từ lần lưu trước → clamp lại. */
      var vp = viewportSize();
      if (_win.x != null) _win.x = clampNum(_win.x, 0, Math.max(0, vp.w - _win.w));
      if (_win.y != null) _win.y = clampNum(_win.y, 0, Math.max(0, vp.h - HEADER_H));
      return true;
    } catch (e) { return false; }
  }

  function saveWindowState() {
    try {
      if (window.localStorage) window.localStorage.setItem(WIN_KEY, JSON.stringify(ArpPanel.getWindowState()));
    } catch (e) { /* localStorage đầy / bị chặn: vị trí chỉ giữ trong phiên */ }
  }

  /* Áp state hiện tại lên DOM: class max/min/mobile + style left/top/w/h.
     Chuyển tab không gọi hàm này nên geometry không bao giờ bị reset. */
  function applyWindowState() {
    var el = ArpPanel._window;
    if (!el) return;
    ensurePos();
    var mobile = isMobileMode();
    el.classList.toggle('arp-window-mobile', mobile);
    el.classList.toggle('maximized', !mobile && _win.maximized);
    el.classList.toggle('minimized', !mobile && _win.minimized);
    if (!mobile && !_win.maximized && !_win.minimized) {
      el.style.left = _win.x + 'px';
      el.style.top = _win.y + 'px';
      el.style.width = _win.w + 'px';
      el.style.height = _win.h + 'px';
    } else if (mobile) {
      el.style.left = ''; el.style.top = ''; el.style.width = ''; el.style.height = '';
    }
    if (ArpPanel._maxBtn) ArpPanel._maxBtn.title = _win.maximized ? 'Khôi phục kích thước' : 'Phóng to';
    if (ArpPanel._minBtn) ArpPanel._minBtn.title = _win.minimized ? 'Khôi phục cửa sổ' : 'Thu nhỏ';
  }

  ArpPanel.getWindowState = function () {
    ensurePos();
    var mode = 'normal';
    if (isMobileMode()) mode = 'mobile';
    else if (_win.maximized) mode = 'maximized';
    else if (_win.minimized) mode = 'minimized';
    return { x: _win.x, y: _win.y, w: _win.w, h: _win.h, maximized: _win.maximized, minimized: _win.minimized, mode: mode };
  };

  /* Đặt vị trí (clamp trong viewport, chừa thanh tiêu đề luôn thấy được).
     Khi đang kéo (drag) thì không ghi localStorage từng move — chỉ ghi
     khi thả chuột; gọi trực tiếp thì ghi ngay. */
  ArpPanel.setWindowPos = function (x, y) {
    var vp = viewportSize();
    ensurePos();
    _win.x = clampNum(Math.round(x), 0, Math.max(0, vp.w - _win.w));
    _win.y = clampNum(Math.round(y), 0, Math.max(0, vp.h - HEADER_H));
    if (ArpPanel._window && !_win.maximized && !_win.minimized && !isMobileMode()) {
      ArpPanel._window.style.left = _win.x + 'px';
      ArpPanel._window.style.top = _win.y + 'px';
    }
    if (!ArpPanel._dragActive) saveWindowState();
    return ArpPanel.getWindowState();
  };

  /* Đặt kích thước (min 360x300, không vượt viewport tính từ vị trí hiện tại). */
  ArpPanel.setWindowSize = function (w, h) {
    var vp = viewportSize();
    ensurePos();
    _win.w = clampNum(Math.round(w), WIN_MIN_W, Math.max(WIN_MIN_W, vp.w - _win.x));
    _win.h = clampNum(Math.round(h), WIN_MIN_H, Math.max(WIN_MIN_H, vp.h - _win.y));
    if (ArpPanel._window && !_win.maximized && !_win.minimized && !isMobileMode()) {
      ArpPanel._window.style.width = _win.w + 'px';
      ArpPanel._window.style.height = _win.h + 'px';
    }
    if (!ArpPanel._dragActive) saveWindowState();
    return ArpPanel.getWindowState();
  };

  /* Thu nhỏ về 1 thanh nhỏ ở góc dưới-trái màn hình. Bấm lại (nút hoặc
     thanh thu nhỏ) để khôi phục. */
  ArpPanel.minimize = function () {
    if (_win.minimized) return ArpPanel.restore();
    ensurePos();
    if (!_win.maximized) _win.prev = { x: _win.x, y: _win.y, w: _win.w, h: _win.h };
    _win.minimized = true;
    _win.maximized = false;
    applyWindowState();
    saveWindowState();
    return true;
  };

  /* Phóng to full màn hình. Bấm lại để về kích thước cũ. */
  ArpPanel.maximize = function () {
    if (_win.maximized) return ArpPanel.restore();
    ensurePos();
    _win.prev = { x: _win.x, y: _win.y, w: _win.w, h: _win.h };
    _win.maximized = true;
    _win.minimized = false;
    applyWindowState();
    saveWindowState();
    return true;
  };

  /* Khôi phục từ trạng thái thu nhỏ / phóng to về geometry thường. */
  ArpPanel.restore = function () {
    if (!_win.maximized && !_win.minimized) return false;
    if (_win.prev) {
      _win.x = _win.prev.x; _win.y = _win.prev.y;
      _win.w = _win.prev.w; _win.h = _win.prev.h;
    }
    _win.prev = null;
    _win.maximized = false;
    _win.minimized = false;
    applyWindowState();
    saveWindowState();
    return true;
  };

  /* Đưa cửa sổ về mặc định (giữa màn hình, 720x560 PC), xóa bản lưu. */
  ArpPanel.resetWindowPos = function () {
    try { if (window.localStorage) window.localStorage.removeItem(WIN_KEY); } catch (e) {}
    _win.x = null; _win.y = null;
    _win.w = WIN_DEFAULT_W; _win.h = WIN_DEFAULT_H;
    _win.maximized = false; _win.minimized = false; _win.prev = null;
    ensurePos();
    applyWindowState();
    saveWindowState();
    return ArpPanel.getWindowState();
  };

  /* ---------- Kéo thả (drag di chuyển / resize) ---------- */

  function closestButton(node) {
    while (node && node !== ArpPanel._window) {
      if (node.tagName === 'BUTTON') return node;
      node = node.parentNode;
    }
    return null;
  }

  function startWindowDrag(e, kind) {
    if (isMobileMode() || _win.maximized || _win.minimized) return;
    if (e.button != null && e.button !== 0) return; /* chỉ nút trái */
    ensurePos();
    var startX = e.clientX, startY = e.clientY;
    var orig = { x: _win.x, y: _win.y, w: _win.w, h: _win.h };
    var moved = false;
    var usePointer = typeof window.PointerEvent !== 'undefined';
    function onMove(ev) {
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (dx !== 0 || dy !== 0) moved = true;
      if (kind === 'move') ArpPanel.setWindowPos(orig.x + dx, orig.y + dy);
      else ArpPanel.setWindowSize(orig.w + dx, orig.h + dy);
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      ArpPanel._dragActive = false;
      if (ArpPanel._window) ArpPanel._window.classList.remove('dragging');
      if (moved) saveWindowState();
    }
    ArpPanel._dragActive = true;
    if (ArpPanel._window) ArpPanel._window.classList.add('dragging');
    if (usePointer) {
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    } else {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }
    if (e.preventDefault) e.preventDefault();
  }

  /* Tab Smart mặc định: render qua ArpSmart, fallback nút Rig nhanh
     nếu arp-smart.js chưa load. */
  function renderSmartDefault(container) {
    var Smart = PixiStudio.ArpSmart;
    if (Smart && Smart.render) { Smart.render(container); return; }
    container.innerHTML =
      '<p class="arp-note">Tab Smart chưa load được (arp-smart.js) — vẫn rig nhanh được bằng pipeline cũ.</p>' +
      '<div class="arp-row"><button id="arp-smart-fallback-rig" class="arp-btn arp-btn-primary">🦴 Rig (pipeline cũ)</button></div>';
    var btn = container.querySelector('#arp-smart-fallback-rig');
    if (btn) btn.addEventListener('click', function () {
      if (PixiStudio.AutoRigPro && PixiStudio.AutoRigPro.run) PixiStudio.AutoRigPro.run();
      else notify('error', 'Auto Rig Pro Blend', 'AutoRigPro chưa sẵn sàng.');
    });
  }

  function renderPlaceholder(container, id) {
    var title = TAB_TITLES[id] || id;
    container.innerHTML =
      '<div class="arp-placeholder">' +
      '<h3>' + title + ' — Đang phát triển</h3>' +
      '<p>Tab này đang được xây dựng trong bản mở rộng Auto Rig Pro Blend. ' +
      'Quay lại tab Smart để rig model trước.</p>' +
      '</div>';
  }

  function renderTabBar() {
    if (!ArpPanel._bar) return;
    ArpPanel._bar.innerHTML = '';
    TAB_ORDER.forEach(function (id) {
      var tab = ArpPanel._tabs[id];
      var title = (tab && tab.title) || TAB_TITLES[id] || id;
      var b = document.createElement('button');
      b.className = 'arp-tab' + (ArpPanel._current === id ? ' active' : '');
      b.setAttribute('data-tab', id);
      b.textContent = title;
      b.addEventListener('click', function () { ArpPanel.showTab(id); });
      ArpPanel._bar.appendChild(b);
    });
    /* Tab của plugin (id 'plugin:<id>', đăng ký qua ArpPlugins):
       nằm sau các tab cố định, theo thứ tự đăng ký. Plugin bị tắt
       thì ArpPlugins gọi unregisterTab nên không còn ở đây. */
    Object.keys(ArpPanel._tabs).forEach(function (id) {
      if (TAB_ORDER.indexOf(id) >= 0) return;
      var tab = ArpPanel._tabs[id];
      var b = document.createElement('button');
      b.className = 'arp-tab' + (ArpPanel._current === id ? ' active' : '');
      b.setAttribute('data-tab', id);
      b.textContent = (tab && tab.title) || id;
      b.addEventListener('click', function () { ArpPanel.showTab(id); });
      ArpPanel._bar.appendChild(b);
    });
  }

  ArpPanel._build = function () {
    if (ArpPanel._built) return;
    var overlay = document.createElement('div');
    overlay.id = 'arp-panel-overlay';
    overlay.className = 'arp-overlay';
    overlay.innerHTML =
      '<div class="arp-window arp-panel" id="arp-window" role="dialog" aria-label="Auto Rig Pro Blend">' +
      '<div class="arp-header arp-window-header" id="arp-window-header">' +
      '<div class="arp-title">🦴 Auto Rig Pro Blend</div>' +
      '<div class="arp-window-controls">' +
      '<button class="arp-win-btn" id="arp-window-reset" title="Reset vị trí cửa sổ" aria-label="Reset vị trí cửa sổ">⟲</button>' +
      '<button class="arp-win-btn" id="arp-window-min" title="Thu nhỏ" aria-label="Thu nhỏ">–</button>' +
      '<button class="arp-win-btn" id="arp-window-max" title="Phóng to" aria-label="Phóng to">⛶</button>' +
      '<button class="arp-win-btn arp-close" id="arp-panel-close" title="Đóng" aria-label="Đóng">✕</button>' +
      '</div>' +
      '</div>' +
      '<div class="arp-tabs" id="arp-tab-bar"></div>' +
      '<div class="arp-tab-body" id="arp-tab-body"></div>' +
      '<div class="arp-resize-handle" id="arp-resize-handle" title="Kéo để đổi kích thước"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    ArpPanel._overlay = overlay;
    ArpPanel._window = overlay.querySelector('#arp-window');
    ArpPanel._body = overlay.querySelector('#arp-tab-body');
    ArpPanel._bar = overlay.querySelector('#arp-tab-bar');
    ArpPanel._header = overlay.querySelector('#arp-window-header');
    ArpPanel._minBtn = overlay.querySelector('#arp-window-min');
    ArpPanel._maxBtn = overlay.querySelector('#arp-window-max');
    overlay.querySelector('#arp-panel-close').addEventListener('click', function () { ArpPanel.close(); });
    overlay.querySelector('#arp-window-reset').addEventListener('click', function () { ArpPanel.resetWindowPos(); });
    ArpPanel._minBtn.addEventListener('click', function () { ArpPanel.minimize(); });
    ArpPanel._maxBtn.addEventListener('click', function () { ArpPanel.maximize(); });
    /* Bấm thanh tiêu đề của cửa sổ đang thu nhỏ → khôi phục
       (bỏ qua khi bấm trúng nút trên header). */
    ArpPanel._header.addEventListener('click', function (e) {
      if (_win.minimized && !closestButton(e.target)) ArpPanel.restore();
    });
    /* Kéo thanh tiêu đề để di chuyển cửa sổ (chuột + chạm).
       Không kéo khi bấm trúng nút trên header. */
    var downEv = (typeof window.PointerEvent !== 'undefined') ? 'pointerdown' : 'mousedown';
    ArpPanel._header.addEventListener(downEv, function (e) {
      if (closestButton(e.target)) return;
      startWindowDrag(e, 'move');
    });
    /* Kéo góc dưới-phải để đổi kích thước. */
    overlay.querySelector('#arp-resize-handle').addEventListener(downEv, function (e) {
      startWindowDrag(e, 'resize');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ArpPanel._open) ArpPanel.close();
    });
    /* Đổi desktop/mobile khi xoay màn hình / resize trình duyệt. */
    window.addEventListener('resize', function () {
      if (ArpPanel._open) applyWindowState();
    });
    /* Plugin đăng ký TRƯỚC khi panel load: registry giữ lại, panel
       nhận tab Plugins + tab plugin khi build (xem arp-plugins.js). */
    if (window.PixiStudio && PixiStudio.ArpPlugins && typeof PixiStudio.ArpPlugins.syncPanelTabs === 'function') {
      try { PixiStudio.ArpPlugins.syncPanelTabs(); } catch (e) {}
    }
    ArpPanel._built = true;
  };

  /* Đăng ký / ghi đè nội dung 1 tab. renderFn(containerEl) dựng nội
     dung trong #arp-tab-body. Nếu tab đang mở thì render lại ngay. */
  ArpPanel.registerTab = function (id, title, renderFn) {
    if (!id) return false;
    if (typeof title === 'function') { renderFn = title; title = null; }
    ArpPanel._tabs[id] = { title: title || TAB_TITLES[id] || id, renderFn: renderFn || null };
    if (ArpPanel._built) {
      renderTabBar();
      if (ArpPanel._open && ArpPanel._current === id) ArpPanel.showTab(id);
    }
    return true;
  };

  /* Gỡ 1 tab (ArpPlugins gọi khi plugin bị tắt/gỡ). Nếu tab đang
     mở thì chuyển về tab Smart. Trả false khi tab không tồn tại. */
  ArpPanel.unregisterTab = function (id) {
    if (!id || !ArpPanel._tabs[id]) return false;
    delete ArpPanel._tabs[id];
    if (ArpPanel._current === id) {
      ArpPanel._current = 'smart';
      if (ArpPanel._open) { ArpPanel.showTab('smart'); return true; }
    }
    if (ArpPanel._built) renderTabBar();
    return true;
  };

  ArpPanel.showTab = function (id) {
    if (TAB_ORDER.indexOf(id) < 0 && !ArpPanel._tabs[id]) return false;
    ArpPanel._build();
    ArpPanel._current = id;
    renderTabBar();
    var tab = ArpPanel._tabs[id];
    ArpPanel._body.innerHTML = '';
    if (id === 'smart' && (!tab || !tab.renderFn)) renderSmartDefault(ArpPanel._body);
    else if (tab && tab.renderFn) tab.renderFn(ArpPanel._body);
    else renderPlaceholder(ArpPanel._body, id);
    return true;
  };

  ArpPanel.open = function (tabId) {
    ArpPanel._build();
    loadWindowState();
    ArpPanel._open = true;
    ArpPanel._overlay.classList.add('open');
    applyWindowState();
    ArpPanel.showTab(tabId || ArpPanel._current || 'smart');
    return true;
  };

  ArpPanel.close = function () {
    ArpPanel._open = false;
    if (ArpPanel._overlay) ArpPanel._overlay.classList.remove('open');
    return true;
  };

  ArpPanel.isOpen = function () { return ArpPanel._open; };
  ArpPanel.currentTab = function () { return ArpPanel._current; };

  /* Test hooks */
  ArpPanel._test = {
    TAB_ORDER: TAB_ORDER,
    TAB_TITLES: TAB_TITLES,
    WIN_KEY: WIN_KEY,
    WIN_DEFAULT: { w: WIN_DEFAULT_W, h: WIN_DEFAULT_H },
    WIN_MIN: { w: WIN_MIN_W, h: WIN_MIN_H },
    getTabs: function () { return ArpPanel._tabs; },
    getBody: function () { return ArpPanel._body; },
    getOverlay: function () { return ArpPanel._overlay; },
    getWindowEl: function () { return ArpPanel._window; },
    getWindowState: function () { return ArpPanel.getWindowState(); }
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpPanel = ArpPanel;
})();
