/* ============================================================
 * ui/arp-vp-toolbar.js — PHẦN 5 (vòng mở rộng Viewport):
 * THANH CÔNG CỤ VIEWPORT cho Auto Rig Pro Blend.
 *
 * DỜI XUỐNG TIMELINE (2026-11-27): thanh KHÔNG còn mount trong
 * viewport (góc trên-trái) vì che bảng Camera (#ix-camera-panel,
 * cũng góc trên-trái). Mount mới: 1 hàng riêng
 * #arp-vp-timeline-row ngay dưới #timeline-toolbar trong
 * #timeline-panel — thành dải ngang trong luồng, không che gì.
 * Fallback: cuối #timeline-toolbar → #viewport-canvas-wrap cũ
 * (giữ nguyên hành vi cũ khi timeline chưa có trong DOM, vd
 * harness cũ / index.html cache cũ).
 *
 * 11 nút bật/tắt nhanh cho đủ 11 layer registry (Skeleton, Nhãn
 * xương, IK, Markers, Ghost, Grid, Control helpers, Trails,
 * Onion, Đo đạc, Tham chiếu) + "Hiện tất cả" / "Ẩn tất cả".
 * Mỗi nút có trạng thái RÕ RÀNG: bật = nền tím sáng, tắt = mờ.
 *
 * Popover nhóm xương: #timeline-panel có overflow:hidden nên
 * popover KHÔNG thể mở lên/xuống trong panel (bị cắt). Vì vậy
 * popover được append vào document.body với position:fixed —
 * ở timeline mở HƯỚNG LÊN (neo bottom theo nút Nhóm xương),
 * ở viewport mở xuống như cũ (neo top theo nút). Xem
 * positionGroupsPop().
 *
 * Mọi nút bấm gọi PixiStudio.ArpViewport (js/rig/arp-vp-core.js) —
 * KHÔNG gọi trực tiếp module hiển thị. Layer nào chưa đăng ký
 * (module vp khác chưa load) thì nút vẫn hiện, bấm không lỗi
 * (chỉ ghi log), nút mang class 'arp-vp-btn-missing' + title báo
 * "module chưa load"; khi module đăng ký sau, toolbar tự cập nhật
 * nhờ ArpViewport.onLayerChange.
 *
 * VIEW2 (2026-11-27, ưu tiên 4): thêm 1 hàng nút phụ (không nằm
 * trong BUTTONS — BUTTONS giữ đúng 11 nút layer cũ để harness cũ
 * không đổi; nút phụ dùng attribute data-vp2, không dùng
 * data-layer): X-ray / Góc khớp / Root motion (3 layer mới, bấm
 * qua registry như nút chính), Vệt dày (đổi kiểu trail
 * ribbon↔line qua ArpVpTrails.setTrailStyle), Nhóm xương (mở
 * popover 8 checkbox ẩn/hiện từng nhóm xương qua
 * ArpVpSkeleton.setGroupVisible).
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
  var TIMELINE_ROW_ID = 'arp-vp-timeline-row';
  var TIMELINE_TOOLBAR_ID = 'timeline-toolbar';
  var TIMELINE_PANEL_ID = 'timeline-panel';
  var VIEWPORT_WRAP_ID = 'viewport-canvas-wrap';
  var _el = null;          /* root div của toolbar */
  var _btns = {};          /* key -> button element */
  var _unsubscribe = null; /* hủy onLayerChange khi destroy */
  var _builtinsRegistered = false;
  /* DỜI XUỐNG TIMELINE (2026-11-27): 'timeline' | 'viewport' | 'other' */
  var _mountMode = null;
  var _resizeHandler = null;
  /* VIEW2 — hàng nút phụ (xem ghi chú đầu file). */
  var EXTRA_BUTTONS = [
    { key: 'xray', label: 'X-ray', icon: '🔍', title: 'X-ray: làm mờ mesh để xương hiện xuyên qua' },
    { key: 'angles', label: 'Góc khớp', icon: '📐', title: 'Hiện/ẩn góc khớp live (khuỷu/gối)' },
    { key: 'rootmotion', label: 'Root motion', icon: '🛤️', title: 'Hiện/ẩn đường root motion (Hips)' },
    { key: 'ribbon', label: 'Vệt dày', icon: '➖', title: 'Bật/tắt vệt motion dày (ribbon) — tắt thì chỉ còn line 1px' },
    { key: 'groups', label: 'Nhóm xương', icon: '🦴', title: 'Hiện/ẩn xương theo nhóm (cột sống/đầu/tay/chân/ngón)' }
  ];
  var _extraBtns = {};     /* key -> button element (hàng phụ) */
  var _groupsPop = null;   /* div popover chọn nhóm xương */
  var _groupsOpen = false;

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

  /* VIEW2 — X-ray: adapter qua ArpVpSkeleton.setXrayEnabled (dùng
     shading 'xray' có sẵn của viewport, xem arp-vp-skeleton.js).
     Đăng ký ở toolbar theo mẫu markers/ghost/grid/helpers để module
     skeleton không tự đăng ký layer (harness skeleton đếm đúng 1
     lần registerLayer 'skeleton'). getSkeleton() định nghĩa ở mục
     VIEW2 phía dưới (function declaration nên hoist được). */
  function xrayShow() {
    var SK = getSkeleton();
    if (!SK || typeof SK.setXrayEnabled !== 'function') { logWarn('X-ray: ArpVpSkeleton chưa load.'); return false; }
    var r = SK.setXrayEnabled(true);
    return r === true || (r && r.ok === true);
  }
  function xrayHide() {
    var SK = getSkeleton();
    if (!SK || typeof SK.setXrayEnabled !== 'function') return false;
    var r = SK.setXrayEnabled(false);
    return r === true || (r && r.ok === true);
  }
  function xrayVisible() {
    var SK = getSkeleton();
    if (!SK || typeof SK.isXrayEnabled !== 'function') return false;
    return !!SK.isXrayEnabled();
  }

  var BUILTIN_LAYERS = [
    { key: 'markers', label: 'Markers', show: markersShow, hide: markersHide, isVisible: markersVisible, defaultVisible: false },
    { key: 'ghost', label: 'Ghost', show: ghostShow, hide: ghostHide, isVisible: ghostVisible, defaultVisible: false },
    { key: 'grid', label: 'Grid', show: gridShow, hide: gridHide, isVisible: gridVisible, defaultVisible: true },
    { key: 'helpers', label: 'Control helpers', show: helpersShow, hide: helpersHide, isVisible: helpersVisible, defaultVisible: false },
    { key: 'xray', label: 'X-ray', show: xrayShow, hide: xrayHide, isVisible: xrayVisible, defaultVisible: false }
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

  /* DỜI XUỐNG TIMELINE (2026-11-27): thứ tự ưu tiên mount —
     1) hàng riêng #arp-vp-timeline-row (ngay dưới #timeline-toolbar),
     2) cuối #timeline-toolbar, 3) #viewport-canvas-wrap cũ. */
  function findTimelineMount() {
    if (typeof document === 'undefined') return null;
    var row = document.getElementById(TIMELINE_ROW_ID);
    if (row) return row;
    return document.getElementById(TIMELINE_TOOLBAR_ID);
  }

  function mountModeFor(wrap) {
    if (!wrap) return 'other';
    if (wrap.id === TIMELINE_ROW_ID || wrap.id === TIMELINE_TOOLBAR_ID) return 'timeline';
    if (typeof wrap.closest === 'function' && wrap.closest('#' + TIMELINE_PANEL_ID)) return 'timeline';
    if (wrap.id === VIEWPORT_WRAP_ID) return 'viewport';
    return 'other';
  }

  function findWrap(container) {
    if (container) {
      if (typeof container === 'string') return document.getElementById(container) || document.querySelector(container);
      if (container.nodeType === 1) return container;
    }
    return findTimelineMount() ||
      document.getElementById(VIEWPORT_WRAP_ID) || document.body;
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

    /* VIEW2: hàng nút phụ (X-ray / Góc khớp / Root motion / Vệt dày /
       Nhóm xương) — nằm dưới hàng nút layer chính. */
    bar.appendChild(buildExtraRow());

    /* VIEW2: hàng preset hiển thị — trước đây ArpVpPresets.renderInto()
       không có caller nào trong app nên nút preset (kể cả XRay/Motion
       mới) không bao giờ hiện trong studio thật. Gắn thẳng vào toolbar
       để user bấm được ngay trong viewport. */
    bar.appendChild(buildPresetRow());

    return bar;
  }

  /* ---------- VIEW2: hàng nút phụ + popover nhóm xương ---------- */

  function getTrails() { return (PS && PS.ArpVpTrails) || null; }
  function getSkeleton() { return (PS && PS.ArpVpSkeleton) || null; }

  function toggleRibbon() {
    var T = getTrails();
    if (!T || typeof T.setTrailStyle !== 'function' || typeof T.getTrailStyle !== 'function') {
      logWarn('Vệt dày: ArpVpTrails chưa load.');
      return;
    }
    var next = T.getTrailStyle() === 'ribbon' ? 'line' : 'ribbon';
    T.setTrailStyle(next);
    ArpVpToolbar.refresh();
  }

  /* Popover chọn nhóm xương: 8 checkbox + Tất cả/Ẩn hết. Nội dung
     dựng lại mỗi lần mở (số xương/part lấy tươi từ getGroups()). */
  function buildGroupsPop() {
    var pop = document.createElement('div');
    pop.id = 'arp-vp-groups-pop';
    pop.className = 'arp-vp-groups-pop';
    /* DỜI XUỐNG TIMELINE (2026-11-27): popover KHÔNG còn absolute
       trong toolbar (top:100% cũ) — #timeline-panel có
       overflow:hidden nên mở lên hay xuống trong panel đều bị cắt.
       Popover append vào document.body, position:fixed, vị trí
       left/top/bottom do positionGroupsPop() đặt theo nút Nhóm
       xương (timeline: mở HƯỚNG LÊN; viewport: mở xuống). */
    pop.style.cssText = 'position:fixed;z-index:60;' +
      'background:rgba(10,18,32,0.96);color:#e8f0ff;border:1px solid #7b61ff;border-radius:8px;' +
      'padding:8px 10px;font-size:12px;line-height:1.7;min-width:210px;display:none;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.5);';
    var title = document.createElement('div');
    title.style.cssText = 'font-weight:bold;margin-bottom:4px;';
    title.textContent = 'Nhóm xương';
    pop.appendChild(title);
    var list = document.createElement('div');
    list.className = 'arp-vp-groups-list';
    pop.appendChild(list);
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-top:6px;';
    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'arp-vp-btn arp-vp-bulk-btn';
    allBtn.textContent = 'Tất cả';
    allBtn.addEventListener('click', function () { setAllGroups(true); });
    var noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    noneBtn.className = 'arp-vp-btn arp-vp-bulk-btn';
    noneBtn.textContent = 'Ẩn hết';
    noneBtn.addEventListener('click', function () { setAllGroups(false); });
    row.appendChild(allBtn);
    row.appendChild(noneBtn);
    pop.appendChild(row);
    return pop;
  }

  function setAllGroups(on) {
    var SK = getSkeleton();
    if (!SK || typeof SK.getGroups !== 'function') { logWarn('Nhóm xương: ArpVpSkeleton chưa load.'); return; }
    SK.getGroups().forEach(function (g) {
      if (typeof SK.setGroupVisible === 'function') SK.setGroupVisible(g.key, on);
    });
    refreshGroupsPop();
  }

  function refreshGroupsPop() {
    if (!_groupsPop) return;
    var list = _groupsPop.querySelector('.arp-vp-groups-list');
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    var SK = getSkeleton();
    if (!SK || typeof SK.getGroups !== 'function') {
      var note = document.createElement('div');
      note.textContent = 'Chưa có skeleton — rig model trước.';
      list.appendChild(note);
      return;
    }
    SK.getGroups().forEach(function (g) {
      var label = document.createElement('label');
      label.style.cssText = 'display:flex;gap:6px;align-items:center;cursor:pointer;';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!g.visible;
      cb.setAttribute('data-vp-group', g.key);
      cb.addEventListener('change', function () {
        if (typeof SK.setGroupVisible === 'function') SK.setGroupVisible(g.key, cb.checked);
        ArpVpToolbar.refresh();
      });
      label.appendChild(cb);
      var span = document.createElement('span');
      span.textContent = g.label + ' (' + g.bones + ' xương, ' + g.visibleParts + '/' + g.parts + ' hiện)';
      label.appendChild(span);
      list.appendChild(label);
    });
  }

  /* DỜI XUỐNG TIMELINE (2026-11-27): định vị popover theo nút
     Nhóm xương. Timeline: thanh ở dưới cùng → mở HƯỚNG LÊN
     (style.bottom neo theo mép trên nút); viewport: mở xuống như
     cũ (style.top neo theo mép dưới nút). jsdom trả rect 0 — vẫn
     đặt được bottom/top (kiểm chứng được bằng style), không crash. */
  function positionGroupsPop() {
    if (!_groupsPop || !_groupsOpen) return;
    var btn = _extraBtns.groups;
    if (!btn || typeof btn.getBoundingClientRect !== 'function') return;
    var r = btn.getBoundingClientRect();
    var vw = (typeof window !== 'undefined' && window.innerWidth) || 1024;
    var vh = (typeof window !== 'undefined' && window.innerHeight) || 768;
    var left = Math.max(4, Math.min(r.left || 0, vw - 220));
    _groupsPop.style.left = left + 'px';
    if (_mountMode === 'timeline') {
      _groupsPop.style.top = '';
      _groupsPop.style.bottom = Math.max(4, vh - (r.top || 0) + 6) + 'px';
    } else {
      _groupsPop.style.bottom = '';
      _groupsPop.style.top = ((r.bottom || 0) + 6) + 'px';
    }
  }

  function toggleGroupsPop() {
    if (!_el) return;
    if (!_groupsPop) {
      _groupsPop = buildGroupsPop();
      /* Append vào body (không phải _el) để thoát overflow:hidden
         của #timeline-panel — xem ghi chú ở buildGroupsPop(). */
      (document.body || _el).appendChild(_groupsPop);
    }
    _groupsOpen = !_groupsOpen;
    if (_groupsOpen) { refreshGroupsPop(); positionGroupsPop(); }
    _groupsPop.style.display = _groupsOpen ? 'block' : 'none';
    ArpVpToolbar.refresh();
  }

  function buildExtraRow() {
    var row = document.createElement('div');
    row.className = 'arp-vp-btns arp-vp-btns-extra';
    EXTRA_BUTTONS.forEach(function (def) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'arp-vp-btn off';
      b.setAttribute('data-vp2', def.key); /* VIEW2: KHÔNG dùng data-layer (giữ 11 nút cũ) */
      b.textContent = def.icon + ' ' + def.label;
      b.title = def.title;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        if (def.key === 'ribbon') { toggleRibbon(); return; }
        if (def.key === 'groups') { toggleGroupsPop(); return; }
        var core = getCore();
        if (!core) { logWarn('ArpViewport chưa load — không bật/tắt được layer "' + def.key + '".'); return; }
        var res = core.toggleLayer(def.key);
        if (res === null) logWarn('Layer "' + def.key + '" chưa sẵn sàng (module chưa đăng ký hoặc bật/tắt thất bại).');
        ArpVpToolbar.refresh();
      });
      row.appendChild(b);
      _extraBtns[def.key] = b;
    });
    return row;
  }

  /* ---------- VIEW2: hàng preset hiển thị ---------- */

  var _presetBtns = {}; /* name -> button element (hàng preset) */
  var PRESET_ORDER = ['Rigging', 'Animation', 'Clean', 'Full', 'XRay', 'Motion'];
  var PRESET_EXTENDED = { XRay: true, Motion: true };

  function getPresets() { return (PS && PS.ArpVpPresets) || null; }

  function buildPresetRow() {
    var row = document.createElement('div');
    row.className = 'arp-vp-btns arp-vp-btns-presets';
    row.setAttribute('data-arp-vp-presets', '');
    PRESET_ORDER.forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'arp-vp-btn off';
      b.setAttribute('data-arp-vp-preset', name);
      if (PRESET_EXTENDED[name]) b.setAttribute('data-arp-vp-preset-x', name);
      b.textContent = name;
      b.title = 'Preset hiển thị: ' + name;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        var P = getPresets();
        if (!P || typeof P.apply !== 'function') { logWarn('Preset "' + name + '": ArpVpPresets chưa load.'); return; }
        P.apply(name);
        ArpVpToolbar.refresh();
      });
      row.appendChild(b);
      _presetBtns[name] = b;
    });
    return row;
  }

  function refreshPresets() {
    if (!_el) return;
    var P = getPresets();
    var active = null;
    try { active = (P && typeof P.getActive === 'function') ? P.getActive() : null; } catch (e) {}
    Object.keys(_presetBtns).forEach(function (name) {
      var b = _presetBtns[name];
      if (!b) return;
      var on = active === name;
      b.classList.toggle('on', on);
      b.classList.toggle('off', !on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function refreshExtra() {
    if (!_el) return;
    var core = getCore();    ['xray', 'angles', 'rootmotion'].forEach(function (key) {
      var b = _extraBtns[key];
      if (!b) return;
      var registered = !!(core && core.hasLayer && core.hasLayer(key));
      var visible = !!(core && core.isLayerVisible(key));
      b.classList.toggle('on', visible);
      b.classList.toggle('off', !visible);
      b.classList.toggle('arp-vp-btn-missing', !registered);
      b.setAttribute('aria-pressed', visible ? 'true' : 'false');
    });
    var rb = _extraBtns.ribbon;
    if (rb) {
      var T = getTrails();
      var on = !!(T && typeof T.getTrailStyle === 'function' && T.getTrailStyle() === 'ribbon');
      var missing = !T || typeof T.setTrailStyle !== 'function';
      rb.classList.toggle('on', on);
      rb.classList.toggle('off', !on);
      rb.classList.toggle('arp-vp-btn-missing', missing);
      rb.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var gb = _extraBtns.groups;
    if (gb) {
      var sk = getSkeleton();
      var missingG = !sk || typeof sk.getGroups !== 'function';
      gb.classList.toggle('on', _groupsOpen);
      gb.classList.toggle('off', !_groupsOpen);
      gb.classList.toggle('arp-vp-btn-missing', missingG);
      gb.setAttribute('aria-pressed', _groupsOpen ? 'true' : 'false');
    }
    if (_groupsOpen) { refreshGroupsPop(); positionGroupsPop(); }
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
    _mountMode = mountModeFor(wrap);
    _el = buildToolbar();
    /* DỜI XUỐNG TIMELINE (2026-11-27): class theo nơi mount — CSS
       .arp-vp-in-timeline đổi thanh thành dải ngang trong luồng
       (position:relative); mặc định còn lại giữ overlay absolute
       cũ trong viewport. */
    _el.classList.add(_mountMode === 'timeline' ? 'arp-vp-in-timeline' : 'arp-vp-in-viewport');
    wrap.appendChild(_el);
    var core = getCore();
    if (core && typeof core.onLayerChange === 'function') {
      _unsubscribe = core.onLayerChange(function () { ArpVpToolbar.refresh(); });
    }
    /* Popover fixed theo nút — resize cửa sổ thì định vị lại. */
    if (typeof window !== 'undefined' && window.addEventListener) {
      _resizeHandler = function () { positionGroupsPop(); };
      window.addEventListener('resize', _resizeHandler);
    }
    ArpVpToolbar.refresh();
    return true;
  };

  ArpVpToolbar.destroy = function () {
    if (_unsubscribe) { try { _unsubscribe(); } catch (e) {} _unsubscribe = null; }
    if (typeof window !== 'undefined' && window.removeEventListener && _resizeHandler) {
      try { window.removeEventListener('resize', _resizeHandler); } catch (e) {}
      _resizeHandler = null;
    }
    /* Popover nay ở document.body (không còn là con của _el) nên
       phải gỡ riêng — harness view2 (8k) kiểm tra destroy gỡ cả
       #arp-vp-toolbar lẫn #arp-vp-groups-pop. */
    if (_groupsPop && _groupsPop.parentNode) {
      try { _groupsPop.parentNode.removeChild(_groupsPop); } catch (e) {}
    }
    if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
    _el = null;
    _btns = {};
    _extraBtns = {};
    _presetBtns = {};
    _groupsPop = null;
    _groupsOpen = false;
    _mountMode = null;
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
    refreshExtra();
    refreshPresets();
    return true;
  };

  ArpVpToolbar.isMounted = function () { return !!(_el && _el.parentNode); };
  ArpVpToolbar.getToolbarEl = function () { return _el; };

  /* Test hooks (harness dùng, không dùng trong studio). */
  ArpVpToolbar._test = {
    TOOLBAR_ID: TOOLBAR_ID,
    TIMELINE_ROW_ID: TIMELINE_ROW_ID,
    TIMELINE_TOOLBAR_ID: TIMELINE_TOOLBAR_ID,
    VIEWPORT_WRAP_ID: VIEWPORT_WRAP_ID,
    getMountMode: function () { return _mountMode; },
    isInTimeline: function () { return _mountMode === 'timeline'; },
    positionGroupsPop: positionGroupsPop,
    BUILTIN_LAYERS: BUILTIN_LAYERS,
    registerBuiltinLayers: registerBuiltinLayers,
    getButtons: function () { return _btns; },
    EXTRA_BUTTONS: EXTRA_BUTTONS,
    getExtraButtons: function () { return _extraBtns; },
    PRESET_ORDER: PRESET_ORDER,
    getPresetButtons: function () { return _presetBtns; },
    refreshPresets: refreshPresets,
    getGroupsPop: function () { return _groupsPop; },
    isGroupsOpen: function () { return _groupsOpen; },
    toggleGroupsPop: toggleGroupsPop,
    refreshExtra: refreshExtra,
    adapters: {
      markersShow: markersShow, markersHide: markersHide, markersVisible: markersVisible,
      ghostShow: ghostShow, ghostHide: ghostHide, ghostVisible: ghostVisible,
      gridShow: gridShow, gridHide: gridHide, gridVisible: gridVisible,
      helpersShow: helpersShow, helpersHide: helpersHide, helpersVisible: helpersVisible,
      xrayShow: xrayShow, xrayHide: xrayHide, xrayVisible: xrayVisible
    }
  };

  PS.ArpVpToolbar = ArpVpToolbar;

  /* Tự mount khi load (script đặt cuối body nên DOM thường đã có);
     mount() tự tìm hàng timeline trước, fallback viewport wrap.
     Nếu DOM chưa sẵn thì chờ DOMContentLoaded. */
  function autoMount() {
    try {
      if (typeof document === 'undefined') return;
      ArpVpToolbar.mount();
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
