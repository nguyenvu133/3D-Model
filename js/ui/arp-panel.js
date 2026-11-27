/* ============================================================
 * ui/arp-panel.js — PANEL AUTO RIG PRO BLEND (bản mở rộng, PHẦN A)
 *
 * Một panel modal overlay giữa màn hình (dùng được cả PC/mobile)
 * với thanh tab 5 tab: Smart / Remap / Export / Quick Rig /
 * Bone Shape.
 *
 * API:
 *   ArpPanel.open()            — mở panel (mặc định tab Smart)
 *   ArpPanel.close()           — đóng panel (marker vẫn giữ nguyên)
 *   ArpPanel.showTab(id)       — chuyển tab ('smart' | 'remap' |
 *                                'export' | 'quickrig' | 'boneshape')
 *   ArpPanel.registerTab(id, title, renderFn)
 *                              — đăng ký nội dung 1 tab;
 *                                renderFn(containerEl) dựng nội dung
 *                                trong #arp-tab-body. Tab chưa đăng ký
 *                                hiện chữ "Đang phát triển", không lỗi.
 *   ArpPanel.isOpen() / ArpPanel.currentTab()
 *
 * Tab Smart do js/rig/arp-smart.js render (PixiStudio.ArpSmart).
 * 4 tab còn lại do agent khác đăng ký qua registerTab — panel này
 * KHÔNG tự dựng nội dung của chúng.
 * Nút topbar btn-auto-rig-pro sẽ đổi sang ArpPanel.open() (wiring
 * trong js/ui/panels.js — coordinator gộp sau, xem báo cáo).
 * ============================================================ */
(function () {
  'use strict';

  var bus = PixiStudio.bus;

  var TAB_ORDER = ['smart', 'remap', 'export', 'quickrig', 'boneshape'];
  var TAB_TITLES = {
    smart: 'Smart',
    remap: 'Remap',
    export: 'Export',
    quickrig: 'Quick Rig',
    boneshape: 'Bone Shape'
  };

  var ArpPanel = {
    _built: false,
    _open: false,
    _current: 'smart',
    _tabs: {},          /* id -> { title, renderFn } */
    _overlay: null,
    _body: null,
    _bar: null
  };
  ArpPanel.TAB_ORDER = TAB_ORDER;

  function notify(type, title, message) {
    if (bus && bus.emit) bus.emit('notify', { type: type, title: title, message: message });
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
  }

  ArpPanel._build = function () {
    if (ArpPanel._built) return;
    var overlay = document.createElement('div');
    overlay.id = 'arp-panel-overlay';
    overlay.className = 'arp-overlay';
    overlay.innerHTML =
      '<div class="arp-panel" role="dialog" aria-label="Auto Rig Pro Blend">' +
      '<div class="arp-header">' +
      '<div class="arp-title">🦴 Auto Rig Pro Blend</div>' +
      '<button class="arp-close" id="arp-panel-close" aria-label="Đóng">✕</button>' +
      '</div>' +
      '<div class="arp-tabs" id="arp-tab-bar"></div>' +
      '<div class="arp-tab-body" id="arp-tab-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    ArpPanel._overlay = overlay;
    ArpPanel._body = overlay.querySelector('#arp-tab-body');
    ArpPanel._bar = overlay.querySelector('#arp-tab-bar');
    overlay.querySelector('#arp-panel-close').addEventListener('click', function () { ArpPanel.close(); });
    /* Bấm nền mờ ngoài panel thì đóng (không đóng khi bấm trong panel). */
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) ArpPanel.close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ArpPanel._open) ArpPanel.close();
    });
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
    ArpPanel._open = true;
    ArpPanel._overlay.classList.add('open');
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
    getTabs: function () { return ArpPanel._tabs; },
    getBody: function () { return ArpPanel._body; },
    getOverlay: function () { return ArpPanel._overlay; }
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpPanel = ArpPanel;
})();
