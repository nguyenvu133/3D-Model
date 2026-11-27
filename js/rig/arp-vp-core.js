/* ============================================================
 * rig/arp-vp-core.js — PHẦN 5 (vòng mở rộng Viewport):
 * REGISTRY LAYER CHUNG cho Auto Rig Pro Blend.
 *
 * Mọi module hiển thị trong viewport (skeleton, nhãn xương, IK,
 * markers, ghost, grid, helpers, trails, measure, presets...)
 * đăng ký layer của mình vào đây rồi toolbar (js/ui/arp-vp-toolbar.js)
 * bật/tắt qua registry — không gọi trực tiếp module của nhau.
 *
 * THỨ TỰ LOAD (coordinator gộp script tag — KHÔNG sửa index.html ở đây):
 *   1. js/rig/arp-vp-core.js        (file này — TRƯỚC mọi module vp khác)
 *   2. js/rig/arp-vp-skeleton.js / arp-vp-labels.js / arp-vp-ik.js /
 *      arp-vp-trails.js / arp-vp-measure.js / arp-vp-presets.js ...
 *      (mỗi module tự registerLayer khi load)
 *   3. js/ui/arp-vp-toolbar.js      (sau core + sau arp-smart.js /
 *      arp-quickrig.js để adapter built-in đọc đúng API)
 *
 * Contract cho module đăng ký:
 *   ArpViewport.registerLayer(key, {
 *     label: 'Skeleton',            // tên hiển thị trên toolbar
 *     show: function () {},         // bắt buộc để bật (trả false nếu bật không được)
 *     hide: function () {},         // bắt buộc để tắt
 *     isVisible: function () {},    // nên có — nguồn trạng thái thật;
 *                                   // thiếu thì registry dùng trạng thái đã lưu
 *     defaultVisible: false         // trạng thái mặc định khi chưa có bản
 *                                   // lưu và module không báo được isVisible
 *   });
 * QUY ƯỚC GIÁ TRỊ TRẢ VỀ (sửa vòng fix2 — trước đây chỉ literal
 * `false` bị coi là thất bại nên `{ok:false}` vẫn được tính là
 * thành công, preset/toolbar báo sai):
 *   - show/hide trả `true` (hoặc `undefined`, `{ok:true}`, ...) khi
 *     THÀNH CÔNG; trả literal `false`, `{ok:false, ...}` hoặc throw
 *     khi THẤT BẠI.
 *   - Setter kiểu "trả về giá trị mới" (vd `setXVisible(false)` trả
 *     `false` sau khi tắt thành công) là MƠ HỒ và CẤM dùng làm
 *     show/hide của layer — setter phải trả `true` khi thành công
 *     (xem arp-vp-measure.js: setReferenceVisible /
 *     setMeasurementsVisible / setGroundVisible).
 *   - Đăng ký trùng key thì GHI ĐÈ (module load sau thắng).
 *   - show/hide/isVisible phải defensive: không được throw khi scene
 *     chưa sẵn sàng — throw thì registry coi như thất bại (false).
 *
 * Trạng thái bật/tắt lưu vào localStorage 'pixistudio.arp-viewport'
 * (dạng {v:1, layers:{key:bool}}); JSON hỏng / localStorage bị chặn
 * thì về mặc định, không lỗi.
 *
 * API:
 *   registerLayer(key, def) / showLayer(key) / hideLayer(key) /
 *   toggleLayer(key) → true/false (trạng thái mới) | null (chưa đăng ký
 *   hoặc bật/tắt thất bại) / isLayerVisible(key) / listLayers() /
 *   showAll() / hideAll() → số layer áp dụng được /
 *   onLayerChange(cb) → hàm hủy đăng ký; cb nhận {key, visible, type}
 *   với type = 'change' | 'registered' | 'reset' /
 *   getSavedState() / resetSavedState()
 *
 * GIỚI HẠN:
 *   - Registry không tự tạo group 3D nào — chỉ điều phối show/hide
 *     của module đã đăng ký. Layer chưa đăng ký: mọi hàm trả false êm.
 *   - Khi đăng ký, nếu có trạng thái đã lưu khác trạng thái mặc định
 *     thì registry gọi show/hide để khôi phục (defensive, try/catch).
 *   - localStorage chỉ lưu trạng thái, không đồng bộ qua GitHub.
 * ============================================================ */
(function () {
  'use strict';

  var PS = window.PixiStudio || (window.PixiStudio = {});
  var STORAGE_KEY = 'pixistudio.arp-viewport';

  var _layers = {};    /* key -> { key, label, show, hide, isVisible, defaultVisible } */
  var _state = {};     /* key -> bool (trạng thái cuối cùng registry biết) */
  var _listeners = []; /* onLayerChange callbacks */

  function bus() { return (PS && PS.bus) || null; }

  function emitBus(ev, data) {
    try {
      var b = bus();
      if (b && typeof b.emit === 'function') b.emit(ev, data);
    } catch (e) { /* bus lỗi: registry vẫn chạy */ }
  }

  function notify(evt) {
    var list = _listeners.slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](evt); } catch (e) { /* 1 listener lỗi không chặn các listener khác */ }
    }
    emitBus('arp-viewport:layer-changed', evt);
  }

  /* ---------- localStorage ---------- */

  function loadSaved() {
    try {
      if (!window.localStorage) return {};
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return {};
      /* Chấp nhận cả 2 dạng: {v:1, layers:{...}} và {key:bool} phẳng. */
      var layers = (s.layers && typeof s.layers === 'object') ? s.layers : s;
      var out = {};
      Object.keys(layers).forEach(function (k) {
        if (typeof layers[k] === 'boolean') out[k] = layers[k];
      });
      return out;
    } catch (e) { return {}; } /* JSON hỏng / bị chặn → mặc định */
  }

  function saveState() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, layers: _state }));
      }
    } catch (e) { /* localStorage đầy / bị chặn: trạng thái chỉ giữ trong phiên */ }
  }

  /* Khởi động: đọc bản lưu 1 lần. */
  var _saved = loadSaved();

  /* ---------- core ---------- */

  function callFn(fn, key) {
    if (typeof fn !== 'function') return null; /* module không có hàm này */
    try {
      var r = fn();
      if (r === false) return false;
      /* FIX2: mọi show() của VP trả {ok:false, reason} khi thất bại
         (skeleton/labels/IK/measure...) — object đó PHẢI tính là thất
         bại, nếu không showLayer() set state=true + showAll() đếm
         layer "áp được" dù thật sự không hiện gì. */
      if (r && typeof r === 'object' && r.ok === false) return false;
      return true;
    } catch (e) {
      if (window.console && console.warn) {
        console.warn('[ArpViewport] layer "' + key + '" lỗi:', e && e.message ? e.message : e);
      }
      return false;
    }
  }

  var ArpViewport = {};

  /* Đăng ký (hoặc ghi đè) 1 layer. Trả true khi đăng ký xong. */
  ArpViewport.registerLayer = function (key, def) {
    if (!key || typeof key !== 'string') return false;
    if (!def || typeof def !== 'object') return false;
    var entry = {
      key: key,
      label: (typeof def.label === 'string' && def.label) ? def.label : key,
      show: (typeof def.show === 'function') ? def.show : null,
      hide: (typeof def.hide === 'function') ? def.hide : null,
      isVisible: (typeof def.isVisible === 'function') ? def.isVisible : null,
      defaultVisible: !!def.defaultVisible
    };
    var isOverwrite = !!_layers[key];
    _layers[key] = entry;
    /* Trạng thái khởi đầu: bản lưu (nếu có) > trạng thái thật của module
       (isVisible, vd markerGroup vốn đang hiện) > mặc định của module. */
    var initial;
    if (Object.prototype.hasOwnProperty.call(_saved, key)) initial = !!_saved[key];
    else if (entry.isVisible) {
      try { initial = !!entry.isVisible(); } catch (e) { initial = entry.defaultVisible; }
    }
    else initial = entry.defaultVisible;
    _state[key] = initial;
    /* Khôi phục trạng thái đã lưu: chỉ gọi show/hide khi trạng thái cần
       áp khác với "mặc định im lặng" của module vừa load — thực tế gọi
       luôn 1 lần cho chắc, show/hide của module phải idempotent. */
    if (Object.prototype.hasOwnProperty.call(_saved, key)) {
      var ok = initial ? callFn(entry.show, key) : callFn(entry.hide, key);
      /* show/hide thất bại (vd scene chưa có model) thì vẫn giữ cờ đã
         lưu — lần toggle sau sẽ áp lại. */
      if (ok === true && entry.isVisible) {
        try { _state[key] = !!entry.isVisible(); } catch (e) { /* giữ cờ đã lưu */ }
      }
    }
    notify({ key: key, visible: _state[key], type: isOverwrite ? 'registered-overwrite' : 'registered' });
    emitBus('arp-viewport:layer-registered', { key: key, label: entry.label, visible: _state[key] });
    return true;
  };

  ArpViewport.showLayer = function (key) {
    var layer = _layers[key];
    if (!layer) return false;
    if (ArpViewport.isLayerVisible(key)) { _state[key] = true; saveState(); return true; }
    if (!layer.show) return false;
    if (callFn(layer.show, key) !== true) return false;
    _state[key] = true;
    saveState();
    notify({ key: key, visible: true, type: 'change' });
    return true;
  };

  ArpViewport.hideLayer = function (key) {
    var layer = _layers[key];
    if (!layer) return false;
    if (!ArpViewport.isLayerVisible(key)) { _state[key] = false; saveState(); return true; }
    if (!layer.hide) return false;
    if (callFn(layer.hide, key) !== true) return false;
    _state[key] = false;
    saveState();
    notify({ key: key, visible: false, type: 'change' });
    return true;
  };

  /* Trả trạng thái mới (true/false), hoặc null khi layer chưa đăng ký
     hoặc bật/tắt thất bại — phân biệt với "tắt thành công" (= false). */
  ArpViewport.toggleLayer = function (key) {
    if (!_layers[key]) return null;
    var now = ArpViewport.isLayerVisible(key);
    var ok = now ? ArpViewport.hideLayer(key) : ArpViewport.showLayer(key);
    if (!ok) return null;
    return !now;
  };

  ArpViewport.isLayerVisible = function (key) {
    var layer = _layers[key];
    if (!layer) return false;
    if (layer.isVisible) {
      try { return !!layer.isVisible(); } catch (e) { /* rơi xuống cờ đã lưu */ }
    }
    if (Object.prototype.hasOwnProperty.call(_state, key)) return !!_state[key];
    return !!layer.defaultVisible;
  };

  ArpViewport.hasLayer = function (key) { return !!_layers[key]; };

  ArpViewport.listLayers = function () {
    return Object.keys(_layers).map(function (key) {
      return { key: key, label: _layers[key].label, visible: ArpViewport.isLayerVisible(key) };
    });
  };

  /* Bật/tắt tất cả layer ĐÃ ĐĂNG KÝ. Trả số layer áp dụng được. */
  ArpViewport.showAll = function () {
    var n = 0;
    Object.keys(_layers).forEach(function (key) {
      if (ArpViewport.showLayer(key)) n++;
    });
    return n;
  };

  ArpViewport.hideAll = function () {
    var n = 0;
    Object.keys(_layers).forEach(function (key) {
      if (ArpViewport.hideLayer(key)) n++;
    });
    return n;
  };

  /* Đăng ký callback khi trạng thái layer đổi. Trả hàm hủy đăng ký. */
  ArpViewport.onLayerChange = function (cb) {
    if (typeof cb !== 'function') return function () {};
    _listeners.push(cb);
    return function () {
      var i = _listeners.indexOf(cb);
      if (i >= 0) _listeners.splice(i, 1);
    };
  };

  /* Bản sao trạng thái đã lưu (để toolbar/panel hiển thị, test đọc). */
  ArpViewport.getSavedState = function () {
    var out = {};
    Object.keys(_state).forEach(function (k) { out[k] = _state[k]; });
    return out;
  };

  /* Xóa bản lưu, đưa mọi layer về defaultVisible (không gọi show/hide —
     chỉ reset cờ; lần toggle sau áp lại). */
  ArpViewport.resetSavedState = function () {
    try { if (window.localStorage) window.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    _saved = {};
    Object.keys(_layers).forEach(function (key) {
      _state[key] = !!_layers[key].defaultVisible;
      notify({ key: key, visible: _state[key], type: 'reset' });
    });
    return ArpViewport.getSavedState();
  };

  /* Test hooks (harness dùng, không dùng trong studio). */
  ArpViewport._test = {
    STORAGE_KEY: STORAGE_KEY,
    getLayers: function () { return _layers; },
    getState: function () { return _state; },
    getListeners: function () { return _listeners; },
    reloadSaved: function () { _saved = loadSaved(); return _saved; }
  };

  PS.ArpViewport = ArpViewport;
})();
