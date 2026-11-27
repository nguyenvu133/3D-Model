/* ============================================================
 * ui/arp-vp-toolbar.js — PHẦN 5 (vòng mở rộng Viewport):
 * THANH CÔNG CỤ VIEWPORT cho Auto Rig Pro Blend.
 *
 * 1 thanh overlay riêng trong viewport (góc trên-trái, dễ thấy,
 * không che model): 11 nút bật/tắt nhanh cho đủ 11 layer registry
 * (Skeleton, Nhãn xương, IK, Markers, Ghost, Grid, Control helpers,
 * Trails, Onion, Đo đạc, Tham chiếu) + "Hiện tất cả" / "Ẩn tất cả".
 * Mỗi nút có trạng thái RÕ RÀNG: bật = nền tím sáng, tắt = mờ.
 *
 * Mọi nút bấm gọi PixiStudio.ArpViewport (js/rig/arp-vp-core.js) —
 * KHÔNG gọi trực tiếp module hiển thị. Layer nào chưa đăng ký
 * (module vp khác chưa load) thì nút vẫn hiện, bấm không lỗi
 * (chỉ ghi log), nút mang class 'arp-vp-btn-missing' + title báo
 * "module chưa load"; khi module đăng ký sau, toolbar tự cập nhật
 * nhờ ArpViewport.onLayerChange.
 *
 * 4 layer built-in (markers/ghost/grid/helpers) do toolbar tự đăng ký
 * vào registry khi mount — CHỈ KHI chưa có module nào đăng ký key đó
 * (không ghi đè đăng ký của module khác). Adapter đọc API hiện có,
 * defensive hoàn toàn:
 *   - markers: ArpSmart.markerGroup.visible (Smart chưa có hàm
 *     show/hide marker public — quản lý trực tiếp group
 *     '__arp_markers__'; chưa Guess Markers thì chưa có gì để hiện,
 *     show trả false + log rõ).
 *   - ghost: ArpSmart.showGhost()/hideGhost(), cờ ArpSmart.ghost.visible.
 *   - grid: PixiStudio.GridEnv.setVisible(on) / GridEnv.visible
 *     (grid có sẵn trong viewport — chỉ ẩn lưới + trục, giữ glow ring).
 *   - helpers: ArpQuickRig.toggleControls(bool) /
 *     ArpQuickRig.current.controlsVisible (chưa có control rig thì
 *     toggle trả false + log rõ).
 *
 * API: ArpVpToolbar.mount(container?) / destroy() / refresh() /
 *   isMounted() / getToolbarEl() / BUTTONS
 * Tự mount khi load nếu #viewport-canvas-wrap đã có trong DOM
 * (script tag đặt cuối body); nếu chưa thì chờ DOMContentLoaded.
 * Muốn mount thủ công thì gọi ArpVpToolbar.mount() — idempotent.
 *
 * THỨ TỰ LOAD: sau arp-vp-core.js và sau arp-smart.js /
 * arp-quickrig.js (adapter đọc API lúc bấm nút nên thứ tự không
 * bắt buộc, nhưng mount sau 2 module đó thì trạng thái ban đầu
 * của markers/ghost/grid/helpers mới đúng ngay từ đầu).
 * ============================================================ */
(function () {
  'use strict';

  var PS = window.PixiStudio || (window.PixiStudio = {});

  /* Nút trên thanh công cụ, theo đúng thứ tự nhiệm vụ liệt kê.
     FIX2: đủ 11 nút = 11 layer registry (trước đây chỉ 7 nút;
     trails/onion/measure/reference chỉ bật được qua preset).
     4 nút mới không cần adapter built-in — trails/onion do
     arp-vp-trails.js, measure/reference do arp-vp-measure.js tự
     đăng ký vào registry; module chưa load thì nút vẫn hiện với
     class 'arp-vp-btn-missing' như các nút cũ. */
  var BUTTONS = [
    { key: 'skeleton', label: 'Skeleton', icon: '🦴', title: 'Hiện/ẩn skeleton' },
    { key: 'labels', label: 'Nhãn xương', icon: '🏷️', title: 'Hiện/ẩn nhãn tên xương' },
    { key: 'ik', label: 'IK', icon: '🎯', title: 'Hiện/ẩn IK target + pole' },
    { key: 'markers', label: 'Markers', icon: '📍', title: 'Hiện/ẩn marker Smart (cần Guess Markers trước)' },
    { key: 'ghost', label: 'Ghost', icon: '👻', title: 'Hiện/ẩn ghost skeleton preview' },
    { key: 'grid', label: 'Grid', icon: '#️⃣', title: 'Hiện/ẩn lưới + trục viewport' },
    { key: 'helpers', label: 'Control helpers', icon: '🕹️', title: 'Hiện/ẩn control helpers Quick Rig' },
    { key: 'trails', label: 'Trails', icon: '🌀', title: 'Hiện/ẩn motion trails (cần đang phát animation)' },
    { key: 'onion', label: 'Onion', icon: '🧅', title: 'Hiện/ẩn onion skinning (cần đang phát animation)' },
    { key: 'measure', label: 'Đo đạc', icon: '📏', title: 'Hiện/ẩn đo đạc kích thước model' },
    { key: 'reference', label: 'Tham chiếu', icon: '🧍', title: 'Hiện/ẩn khung tham chiếu T/A-pose' }
  ];

  var TOOLBAR_ID = 'arp-vp-toolbar';
  var _el = null;          /* root div của toolbar */
  var _btns = {};          /* key -> button element */
  var _unsubscribe = null; /* hủy onLayerChange khi destroy */
  var _builtinsRegistered = false;

  function logWarn(msg) {
    if (window.console && console.warn) console.warn('[ArpVpToolbar] ' + msg);
  }

  function getCore() { return (PS && PS.ArpViewport) || null; }
  function getSmart() { return (PS && PS.ArpSmart) || null; }
  function getGrid() { return (PS && PS.GridEnv) || null; }
  function getQR() { return (PS && PS.ArpQuickRig) || null; }

  /* ---------- Adapter built-in (chỉ đăng ký khi key chưa có) ---------- */

  function markersShow() {
    var S = getSmart();
    if (!S) { logWarn('Markers: ArpSmart chưa load.'); return false; }
    if (S.markerGroup) { S.markerGroup.visible = true; return true; }
    var any = false;
    (S.markers || []).forEach(function (m) {
      if (m && m.mesh) { m.mesh.visible = true; any = true; }
    });
    if (!any) logWarn('Markers: chưa có marker nào — bấm Guess Markers ở tab Smart trước.');
    return any;
  }
  function markersHide() {
    var S = getSmart();
    if (!S) return false;
    if (S.markerGroup) { S.markerGroup.visible = false; return true; }
    var any = false;
    (S.markers || []).forEach(function (m) {
      if (m && m.mesh) { m.mesh.visible = false; any = true; }
    });
    return any;
  }
  function markersVisible() {
    var S = getSmart();
    if (!S) return false;
    if (S.markerGroup) return !!S.markerGroup.visible;
    return (S.markers || []).some(function (m) { return m && m.mesh && m.mesh.visible; });
  }

  function ghostShow() {
    var S = getSmart();
    if (!S) { logWarn('Ghost: ArpSmart chưa load.'); return false; }
    if (typeof S.showGhost === 'function') return S.showGhost() !== false;
    if (S.ghost) { S.ghost.visible = true; if (S.ghost.group) S.ghost.group.visible = true; return true; }
    return false;
  }
  function ghostHide() {
    var S = getSmart();
    if (!S) return false;
    if (typeof S.hideGhost === 'function') return S.hideGhost() !== false;
    if (S.ghost) { S.ghost.visible = false; if (S.ghost.group) S.ghost.group.visible = false; return true; }
    return false;
  }
  function ghostVisible() {
    var S = getSmart();
    return !!(S && S.ghost && S.ghost.visible);
  }

  function gridShow() {
    var G = getGrid();
    if (!G || typeof G.setVisible !== 'function') { logWarn('Grid: GridEnv chưa load.'); return false; }
    G.setVisible(true);
    return true;
  }
  function gridHide() {
    var G = getGrid();
    if (!G || typeof G.setVisible !== 'function') return false;
    G.setVisible(false);
    return true;
  }
  function gridVisible() {
    var G = getGrid();
    if (!G) return false;
    if (typeof G.visible === 'boolean') return G.visible;
    return true; /* GridEnv mặc định hiện lưới */
  }

  /* LƯU Ý: QuickRig.toggleControls trả về TRẠNG THÁI MỚI (true/false),
     không phải success — false sau khi tắt là thành công, chỉ thất
     bại khi không có control rig (trả false vì !cur). Nên kiểm tra
     QR.current trước rồi coi mọi boolean trả về là thành công. */
  function helpersShow() {
    var QR = getQR();
    if (!QR || typeof QR.toggleControls !== 'function') { logWarn('Control helpers: ArpQuickRig chưa load.'); return false; }
    if (!QR.current) { logWarn('Control helpers: chưa có control rig — tạo Quick Rig trước.'); return false; }
    QR.toggleControls(true);
    return true;
  }
  function helpersHide() {
    var QR = getQR();
    if (!QR || typeof QR.toggleControls !== 'function') return false;
    if (!QR.current) return false;
    QR.toggleControls(false);
    return true;
  }
  function helpersVisible() {
    var QR = getQR();
    if (!QR || !QR.current) return false;
    return !!QR.current.controlsVisible;
  }

  var BUILTIN_LAYERS = [
    { key: 'markers', label: 'Markers', show: markersShow, hide: markersHide, isVisible: markersVisible, defaultVisible: false },
    { key: 'ghost', label: 'Ghost', show: ghostShow, hide: ghostHide, isVisible: ghostVisible, defaultVisible: false },
    { key: 'grid', label: 'Grid', show: gridShow, hide: gridHide, isVisible: gridVisible, defaultVisible: true },
    { key: 'helpers', label: 'Control helpers', show: helpersShow, hide: helpersHide, isVisible: helpersVisible, defaultVisible: false }
  ];

  function registerBuiltinLayers() {
    var core = getCore();
    if (!core) { logWarn('ArpViewport (arp-vp-core.js) chưa load — toolbar chỉ hiển thị, nút bấm chưa có tác dụng.'); return false; }
    /* Kiểm tra theo từng key (không tin cờ _builtinsRegistered một mình):
       core có thể đã load lại (vd harness reload) trong khi toolbar vẫn
       còn — layer nào thiếu thì đăng ký lại, layer module khác đã đăng
       ký thì không ghi đè. */
    BUILTIN_LAYERS.forEach(function (def) {
      if (!core.hasLayer || !core.hasLayer(def.key)) {
        core.registerLayer(def.key, def);
      }
    });
    _builtinsRegistered = true;
    return true;
  }

  /* ---------- DOM ---------- */

  function findWrap(container) {
    if (container) {
      if (typeof container === 'string') return document.getElementById(container) || document.querySelector(container);
      if (container.nodeType === 1) return container;
    }
    return document.getElementById('viewport-canvas-wrap') || document.body;
  }

  function buildToolbar() {
    var bar = document.createElement('div');
    bar.id = TOOLBAR_ID;
    bar.className = 'arp-vp-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Auto Rig Pro — công cụ viewport');

    var collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'arp-vp-btn arp-vp-collapse';
    collapse.textContent = '▾ ARP View';
    collapse.title = 'Thu gọn / mở rộng thanh công cụ viewport';
    collapse.addEventListener('click', function () {
      bar.classList.toggle('collapsed');
      collapse.textContent = bar.classList.contains('collapsed') ? '▸ ARP View' : '▾ ARP View';
    });
    bar.appendChild(collapse);

    var wrap = document.createElement('div');
    wrap.className = 'arp-vp-btns';
    bar.appendChild(wrap);

    BUTTONS.forEach(function (def) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'arp-vp-btn off';
      b.setAttribute('data-layer', def.key);
      b.textContent = def.icon + ' ' + def.label;
      b.title = def.title;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        var core = getCore();
        if (!core) { logWarn('ArpViewport chưa load — không bật/tắt được layer "' + def.key + '".'); return; }
        var res = core.toggleLayer(def.key);
        if (res === null) logWarn('Layer "' + def.key + '" chưa sẵn sàng (module chưa đăng ký hoặc bật/tắt thất bại).');
        ArpVpToolbar.refresh();
      });
      wrap.appendChild(b);
      _btns[def.key] = b;
    });

    var all = document.createElement('div');
    all.className = 'arp-vp-bulk';
    var showAll = document.createElement('button');
    showAll.type = 'button';
    showAll.className = 'arp-vp-btn arp-vp-bulk-btn';
    showAll.textContent = 'Hiện tất cả';
    showAll.title = 'Bật tất cả layer viewport đã đăng ký';
    showAll.addEventListener('click', function () {
      var core = getCore();
      if (!core) { logWarn('ArpViewport chưa load.'); return; }
      var n = core.showAll ? core.showAll() : 0;
      if (!n) logWarn('Hiện tất cả: không có layer nào bật được (module chưa đăng ký?).');
      ArpVpToolbar.refresh();
    });
    var hideAll = document.createElement('button');
    hideAll.type = 'button';
    hideAll.className = 'arp-vp-btn arp-vp-bulk-btn';
    hideAll.textContent = 'Ẩn tất cả';
    hideAll.title = 'Tắt tất cả layer viewport đã đăng ký';
    hideAll.addEventListener('click', function () {
      var core = getCore();
      if (!core) { logWarn('ArpViewport chưa load.'); return; }
      var n = core.hideAll ? core.hideAll() : 0;
      if (!n) logWarn('Ẩn tất cả: không có layer nào tắt được (module chưa đăng ký?).');
      ArpVpToolbar.refresh();
    });
    all.appendChild(showAll);
    all.appendChild(hideAll);
    wrap.appendChild(all);

    return bar;
  }

  /* ---------- API ---------- */

  var ArpVpToolbar = {};

  ArpVpToolbar.BUTTONS = BUTTONS;

  ArpVpToolbar.mount = function (container) {
    if (_el && _el.parentNode) return true; /* đã mount — idempotent */
    if (typeof document === 'undefined') return false;
    registerBuiltinLayers();
    var wrap = findWrap(container);
    if (!wrap) return false;
    _el = buildToolbar();
    /* Thanh overlay nằm trong viewport wrap (position:relative sẵn
       trong css/layout.css) — góc trên-trái, không che model ở giữa. */
    wrap.appendChild(_el);
    var core = getCore();
    if (core && typeof core.onLayerChange === 'function') {
      _unsubscribe = core.onLayerChange(function () { ArpVpToolbar.refresh(); });
    }
    ArpVpToolbar.refresh();
    return true;
  };

  ArpVpToolbar.destroy = function () {
    if (_unsubscribe) { try { _unsubscribe(); } catch (e) {} _unsubscribe = null; }
    if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
    _el = null;
    _btns = {};
    return true;
  };

  ArpVpToolbar.refresh = function () {
    if (!_el) return false;
    var core = getCore();
    BUTTONS.forEach(function (def) {
      var b = _btns[def.key];
      if (!b) return;
      var registered = !!(core && core.hasLayer && core.hasLayer(def.key));
      var visible = !!(core && core.isLayerVisible(def.key));
      b.classList.toggle('on', visible);
      b.classList.toggle('off', !visible);
      b.classList.toggle('arp-vp-btn-missing', !registered);
      b.setAttribute('aria-pressed', visible ? 'true' : 'false');
      b.title = def.title + (registered ? '' : ' — module chưa load');
    });
    return true;
  };

  ArpVpToolbar.isMounted = function () { return !!(_el && _el.parentNode); };
  ArpVpToolbar.getToolbarEl = function () { return _el; };

  /* Test hooks (harness dùng, không dùng trong studio). */
  ArpVpToolbar._test = {
    TOOLBAR_ID: TOOLBAR_ID,
    BUILTIN_LAYERS: BUILTIN_LAYERS,
    registerBuiltinLayers: registerBuiltinLayers,
    getButtons: function () { return _btns; },
    adapters: {
      markersShow: markersShow, markersHide: markersHide, markersVisible: markersVisible,
      ghostShow: ghostShow, ghostHide: ghostHide, ghostVisible: ghostVisible,
      gridShow: gridShow, gridHide: gridHide, gridVisible: gridVisible,
      helpersShow: helpersShow, helpersHide: helpersHide, helpersVisible: helpersVisible
    }
  };

  PS.ArpVpToolbar = ArpVpToolbar;

  /* Tự mount khi load (script đặt cuối body nên wrap thường đã có);
     nếu DOM chưa sẵn thì chờ DOMContentLoaded. */
  function autoMount() {
    try {
      if (typeof document === 'undefined') return;
      if (document.getElementById('viewport-canvas-wrap')) ArpVpToolbar.mount();
    } catch (e) { /* mount thủ công sau vẫn được */ }
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoMount);
    } else {
      autoMount();
    }
  }
})();
