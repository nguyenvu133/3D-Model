/* ============================================================
 * rig/arp-vp-presets.js — PHẦN 8: Viewport presets hiển thị
 * (vòng mở rộng Viewport của Auto Rig Pro Blend)
 *
 * Preset hiển thị theo mục đích, 1 nút bấm đổi preset:
 *   • "Rigging":   skeleton + nhãn xương + markers BẬT;
 *                   IK, trails, onion, ghost TẮT.
 *   • "Animation": IK + trails + onion BẬT; nhãn, markers TẮT.
 *   • "Clean":     chỉ model — TẮT hết overlay đã biết.
 *   • "Full":      BẬT tất cả layer đã biết.
 *   • VIEW2 (2026-11-27, ưu tiên 4): "XRay" — skeleton + xray BẬT,
 *     còn lại TẮT (soi xương xuyên mesh); "Motion" — skeleton +
 *     trails + onion + rootmotion + angles BẬT (xem lại chuyển động
 *     + góc khớp). 2 preset mới vẽ ở hàng riêng trong UI (hàng chính
 *     giữ đúng 4 nút builtin cũ). Full/Clean giữ nguyên 11 key cũ
 *     (không ép xray/angles/rootmotion — giống Rigging/Animation
 *     không ép grid/helpers/measure/reference): 3 layer mới do
 *     XRay/Motion + toolbar điều khiển. Lý do: map Full mà có key
 *     chưa đăng ký thì matchesPreset (coi chưa đăng ký = tắt) không
 *     bao giờ khớp Full, và XRay sẽ khớp nhầm trạng thái
 *     "Rigging trừ labels" khi xray chưa đăng ký.
 *
 * Preset riêng của user: đặt tên, lưu map trạng thái layer hiện
 * tại vào localStorage `pixistudio.arp-vp-presets`, áp/xóa được,
 * hỗ trợ tối thiểu 5 preset riêng (giới hạn trên 20).
 *
 * Preset mặc định sau khi rig xong: "Rigging" — áp tự động khi
 * nhận event 'arp:rig-complete' trên bus PixiStudio.bus.
 *
 * DEFENSIVE (các module layer chạy song song, registry do PHẦN 5
 * làm — file js/rig/arp-vp-core.js có thể CHƯA tồn tại lúc file
 * này load): mọi truy cập registry PixiStudio.ArpViewport đều
 * resolve LAZY tại thời điểm gọi; registry chưa có hoặc layer
 * chưa đăng ký thì bỏ qua êm (ghi log vào kết quả trả về, không
 * throw). Bus cũng vậy: chưa có thì thử gắn lại ở lần gọi sau.
 * Module này KHÔNG tự sửa index.html — coordinator gộp script
 * tag sau; UI nối qua renderInto(el) / bindPanel().
 *
 * API: PixiStudio.ArpVpPresets
 *   apply(name, opts) / saveCustom(name) / deleteCustom(name)
 *   listCustom() / listPresets() / getPreset(name)
 *   getActive() / snapshot() / matchesPreset(name)
 *   refreshActive() / renderInto(container) / bindPanel()
 *   onActiveChange(cb) / offActiveChange(cb)
 * ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'pixistudio.arp-vp-presets';
  var MAX_CUSTOM = 20;          /* hỗ trợ tối thiểu 5 preset riêng */
  var MAX_NAME_LEN = 50;

  /* Các layer viewport ARP đã biết (registry chung, PHẦN 5).
   * Layer ngoài danh sách này mà registry có thì vẫn được snapshot
   * qua listLayers() và vẫn lưu được vào preset riêng. */
  var KNOWN_LAYERS = [
    'skeleton', 'labels', 'ik', 'markers', 'ghost', 'grid',
    'helpers', 'trails', 'onion', 'measure', 'reference',
    'xray', 'angles', 'rootmotion' /* VIEW2 */
  ];

  /* Mỗi preset là 1 map key layer → on/off. Chỉ những key có trong
   * map mới bị chạm tới khi áp preset; key vắng mặt được giữ nguyên
   * (Rigging/Animation không ép grid/helpers/measure/reference). */
  var BUILTINS = {
    Rigging: {
      skeleton: true, labels: true, markers: true,
      ik: false, trails: false, onion: false, ghost: false
    },
    Animation: {
      ik: true, trails: true, onion: true,
      labels: false, markers: false
    },
    Clean: {
      skeleton: false, labels: false, ik: false, markers: false,
      ghost: false, grid: false, helpers: false, trails: false,
      onion: false, measure: false, reference: false
    },
    Full: {
      skeleton: true, labels: true, ik: true, markers: true,
      ghost: true, grid: true, helpers: true, trails: true,
      onion: true, measure: true, reference: true
    },
    /* VIEW2 — 2 preset mở rộng (xem ghi chú đầu file). Rigging/
       Animation KHÔNG đụng tới xray/angles/rootmotion nên áp 2
       preset này không làm mất trạng thái xray/góc/root motion. */
    /* VIEW2 — preset mở rộng KHỐNG CHẾ ĐỦ 14 LAYER (kể cả xray/
       angles/rootmotion): preset chỉ ép 1 phần sẽ để lại layer cũ
       (vd XRay bật xray, Motion không tắt → trạng thái sau Motion
       vẫn trùng map XRay, refreshActive báo nhầm XRay khi user tắt
       tay 1 layer — xem (7e) test-arp-vp-view2.js). */
    XRay: {
      skeleton: true, xray: true,
      labels: false, ik: false, markers: false, ghost: false,
      grid: false, helpers: false, trails: false, onion: false,
      measure: false, reference: false, angles: false, rootmotion: false
    },
    Motion: {
      skeleton: true, trails: true, onion: true,
      rootmotion: true, angles: true,
      labels: false, ik: false, markers: false, ghost: false,
      grid: false, helpers: false, measure: false, reference: false,
      xray: false
    }
  };
  var BUILTIN_NAMES = ['Rigging', 'Animation', 'Clean', 'Full'];
  /* VIEW2: tên preset mở rộng — renderInto vẽ ở hàng riêng
     (attribute data-arp-vp-preset-x) để hàng chính giữ đúng 4 nút
     builtin cũ; refreshActive/listPresets vẫn nhận diện đủ 6. */
  var EXTENDED_PRESET_NAMES = ['XRay', 'Motion'];
  var ALL_BUILTIN_NAMES = BUILTIN_NAMES.concat(EXTENDED_PRESET_NAMES);
  var DEFAULT_AFTER_RIG = 'Rigging';

  var _active = null;           /* tên preset đang khớp, hoặc 'Custom', hoặc null (chưa biết) */
  var _applying = false;        /* cờ chống onLayerChange tự đổi active khi đang áp preset */
  var _layerListenerBound = false;
  var _busListenerBound = false;
  var _activeListeners = [];    /* cb(active) khi preset active đổi */
  var _ui = null;               /* refs DOM do renderInto() tạo */

  /* ---------- helpers ---------- */
  function _log() {
    try { if (typeof console !== 'undefined' && console.log) console.log.apply(console, ['[ArpVpPresets]'].concat(Array.prototype.slice.call(arguments))); } catch (e) {}
  }
  function _warn() {
    try { if (typeof console !== 'undefined' && console.warn) console.warn.apply(console, ['[ArpVpPresets]'].concat(Array.prototype.slice.call(arguments))); } catch (e) {}
  }
  function _registry() {
    try {
      var PS = (typeof window !== 'undefined' && window.PixiStudio) || (typeof PixiStudio !== 'undefined' ? PixiStudio : null);
      return (PS && PS.ArpViewport) || null;
    } catch (e) { return null; }
  }
  function _bus() {
    try {
      var PS = (typeof window !== 'undefined' && window.PixiStudio) || (typeof PixiStudio !== 'undefined' ? PixiStudio : null);
      return (PS && PS.bus) || null;
    } catch (e) { return null; }
  }
  function _ls() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) {}
    return null;
  }
  function _clone(obj) {
    var out = {};
    if (!obj) return out;
    Object.keys(obj).forEach(function (k) { out[k] = !!obj[k]; });
    return out;
  }
  function _allLayerKeys() {
    var keys = KNOWN_LAYERS.slice();
    var reg = _registry();
    if (reg && typeof reg.listLayers === 'function') {
      try {
        var listed = reg.listLayers() || [];
        listed.forEach(function (item) {
          var k = (typeof item === 'string') ? item : (item && item.key);
          if (k && keys.indexOf(k) === -1) keys.push(k);
        });
      } catch (e) {}
    }
    return keys;
  }
  function _isRegistered(key) {
    var reg = _registry();
    if (!reg) return false;
    if (typeof reg.listLayers === 'function') {
      try {
        var listed = reg.listLayers() || [];
        for (var i = 0; i < listed.length; i++) {
          var k = (typeof listed[i] === 'string') ? listed[i] : listed[i].key;
          if (k === key) return true;
        }
        return false;
      } catch (e) { return false; }
    }
    /* Registry không có listLayers: coi như layer có thể tồn tại,
     * thử show/hide trong try/catch ở apply(). */
    return true;
  }

  /* ---------- custom presets (localStorage) ---------- */
  function _loadCustomRaw() {
    var ls = _ls();
    if (!ls) return {};
    try {
      var raw = ls.getItem(STORAGE_KEY);
      if (!raw) return {};
      var data = JSON.parse(raw);
      return (data && typeof data === 'object') ? data : {};
    } catch (e) { return {}; }
  }
  function _saveCustomRaw(data) {
    var ls = _ls();
    if (!ls) return false;
    try { ls.setItem(STORAGE_KEY, JSON.stringify(data)); return true; }
    catch (e) { return false; }
  }

  /* ---------- trạng thái layer hiện tại ---------- */
  function snapshot() {
    var reg = _registry();
    var out = {};
    _allLayerKeys().forEach(function (key) {
      var v = null;
      if (reg && typeof reg.isLayerVisible === 'function') {
        try { var r = reg.isLayerVisible(key); v = (r === null || r === undefined) ? null : !!r; }
        catch (e) { v = null; }
      }
      out[key] = v;
    });
    return out;
  }

  function matchesPreset(name) {
    var map = getPreset(name);
    if (!map) return false;
    var snap = snapshot();
    var keys = Object.keys(map);
    if (!keys.length) return false;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      /* Layer chưa đăng ký coi như đang TẮT (null → false). */
      var cur = (snap[k] === null || snap[k] === undefined) ? false : snap[k];
      if (cur !== !!map[k]) return false;
    }
    return true;
  }

  /* ---------- active preset ---------- */
  function _setActive(name, opts) {
    opts = opts || {};
    if (_active === name) { _updateActiveLabel(); return; }
    _active = name;
    _updateActiveLabel();
    if (!opts.silent) {
      _activeListeners.slice().forEach(function (cb) {
        try { cb(name); } catch (e) {}
      });
      var bus = _bus();
      if (bus && typeof bus.emit === 'function') {
        try { bus.emit('arp:vp-preset-changed', { active: name }); } catch (e) {}
      }
    }
  }

  /* So trạng thái hiện tại với mọi preset đã biết; khớp preset nào
   * thì active = tên đó, không khớp preset nào thì 'Custom'. */
  function refreshActive() {
    if (_applying) return _active;
    var i, name;
    /* VIEW2: kiểm tra 4 preset gốc trước, rồi 2 preset mở rộng —
       thứ tự này giữ 'Rigging' thắng khi trạng thái khớp cả Rigging
       lẫn 1 preset mở rộng. */
    for (i = 0; i < ALL_BUILTIN_NAMES.length; i++) {
      if (matchesPreset(ALL_BUILTIN_NAMES[i])) { _setActive(ALL_BUILTIN_NAMES[i]); return _active; }
    }
    var customs = listCustom();
    for (i = 0; i < customs.length; i++) {
      if (matchesPreset(customs[i].name)) { _setActive(customs[i].name); return _active; }
    }
    _setActive('Custom');
    return _active;
  }

  function _ensureLayerListener() {
    if (_layerListenerBound) return;
    var reg = _registry();
    if (!reg || typeof reg.onLayerChange !== 'function') return;
    try {
      reg.onLayerChange(function () {
        if (_applying) return;
        refreshActive();
      });
      _layerListenerBound = true;
    } catch (e) { /* registry chưa sẵn sàng — thử lại lần sau */ }
  }

  function _ensureBusListener() {
    if (_busListenerBound) return;
    var bus = _bus();
    if (!bus || typeof bus.on !== 'function') return;
    try {
      bus.on('arp:rig-complete', function (d) {
        /* User vừa rig xong thường muốn thấy xương → preset Rigging.
           NHƯNG bỏ qua event từ QuickRig (convert/autogen/mixamo): module
           IK vừa tự hiện IK trên event arpquickrig:converted/autogen-done
           (phát TRƯỚC rig-complete) — nếu áp Rigging ở đây sẽ ẨN IK ngay
           sau khi nó vừa hiện. Rigging chỉ auto-áp sau rig Smart mới. */
        if (d && d.source && String(d.source).indexOf('quickrig') === 0) return;
        apply(DEFAULT_AFTER_RIG, { source: 'rig-complete' });
      });
      _busListenerBound = true;
    } catch (e) { /* bus chưa sẵn sàng — thử lại lần sau */ }
  }

  /* ---------- API chính ---------- */
  function getPreset(name) {
    if (!name || typeof name !== 'string') return null;
    if (BUILTINS.hasOwnProperty(name)) return _clone(BUILTINS[name]);
    var customs = _loadCustomRaw();
    if (customs.hasOwnProperty(name) && customs[name] && customs[name].map) {
      return _clone(customs[name].map);
    }
    return null;
  }

  function listPresets() {
    return BUILTIN_NAMES.concat(EXTENDED_PRESET_NAMES, listCustom().map(function (c) { return c.name; }));
  }

  /* Áp preset: gọi ArpViewport.showLayer/hideLayer cho từng layer
   * trong map; layer chưa đăng ký thì bỏ qua êm, ghi vào skipped.
   * FIX2 (báo cáo trung thực): trước đây ghi `applied[key]=want` vô
   * điều kiện nên apply('Full') báo ik/markers/ghost/helpers:true
   * trong khi show() của chúng trả {ok:false} (chưa có control rig /
   * chưa có marker...) và listLayers() thực tế vẫn false.
   * Nay: chỉ ghi applied khi show/hide trả true VÀ trạng thái thật
   * (isLayerVisible, nếu đọc được) khớp với want; ngược lại ghi
   * skipped kèm lý do {key, reason}. Layer chưa đăng ký vẫn ghi
   * skipped dạng chuỗi (tương thích harness cũ).
   * Active preset cũng trung thực: còn layer nào skip thì active
   * được tính lại (thường là 'Custom') thay vì ép tên preset. */
  function apply(name, opts) {
    opts = opts || {};
    _ensureBusListener();
    _ensureLayerListener();
    var map = getPreset(name);
    if (!map) {
      _warn('apply: không có preset "' + name + '"');
      return { ok: false, name: name, reason: 'unknown-preset', applied: {}, skipped: [] };
    }
    var reg = _registry();
    var applied = {};
    var skipped = [];
    _applying = true;
    try {
      Object.keys(map).forEach(function (key) {
        var want = !!map[key];
        if (!reg || !_isRegistered(key)) { skipped.push(key); return; }
        var ok = false;
        try {
          if (want && typeof reg.showLayer === 'function') ok = reg.showLayer(key);
          else if (!want && typeof reg.hideLayer === 'function') ok = reg.hideLayer(key);
        } catch (e) {
          skipped.push({ key: key, reason: want ? 'show-threw' : 'hide-threw', error: e && e.message ? e.message : String(e) });
          _warn('apply: layer "' + key + '" lỗi:', e && e.message);
          return;
        }
        if (!ok) {
          skipped.push({ key: key, reason: want ? 'show-failed' : 'hide-failed' });
          return;
        }
        /* show/hide báo thành công nhưng trạng thái thật không đổi
           (vd module trả true mà isVisible vẫn sai) → không ghi applied. */
        try {
          if (reg && typeof reg.isLayerVisible === 'function') {
            var cur = reg.isLayerVisible(key);
            if (cur !== null && cur !== undefined && !!cur !== want) {
              skipped.push({ key: key, reason: 'state-mismatch' });
              return;
            }
          }
        } catch (e) { /* không đọc được trạng thái thật: tin show/hide */ }
        applied[key] = want;
      });
    } finally {
      _applying = false;
    }
    if (skipped.length) _log('apply "' + name + '": bỏ qua layer:', JSON.stringify(skipped));
    if (!skipped.length) _setActive(name);
    else refreshActive();
    var bus = _bus();
    if (bus && typeof bus.emit === 'function') {
      try { bus.emit('arp:vp-preset-applied', { name: name, applied: applied, skipped: skipped, source: opts.source || 'manual' }); } catch (e) {}
    }
    _renderCustomList();
    return { ok: true, name: name, applied: applied, skipped: skipped };
  }

  function saveCustom(name) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { ok: false, reason: 'empty-name' };
    }
    name = name.trim();
    if (name.length > MAX_NAME_LEN) return { ok: false, reason: 'name-too-long', max: MAX_NAME_LEN };
    if (BUILTINS.hasOwnProperty(name)) {
      return { ok: false, reason: 'builtin-name', name: name };
    }
    var customs = _loadCustomRaw();
    var names = Object.keys(customs);
    if (!customs.hasOwnProperty(name) && names.length >= MAX_CUSTOM) {
      return { ok: false, reason: 'limit-reached', max: MAX_CUSTOM };
    }
    /* Lưu map trạng thái layer HIỆN TẠI (chỉ layer đọc được trạng thái). */
    var snap = snapshot();
    var map = {};
    Object.keys(snap).forEach(function (k) {
      if (snap[k] !== null && snap[k] !== undefined) map[k] = !!snap[k];
    });
    customs[name] = { map: map, savedAt: Date.now() };
    if (!_saveCustomRaw(customs)) return { ok: false, reason: 'storage-unavailable' };
    _setActive(name);
    _renderCustomList();
    var bus = _bus();
    if (bus && typeof bus.emit === 'function') {
      try { bus.emit('arp:vp-preset-saved', { name: name, map: _clone(map) }); } catch (e) {}
    }
    return { ok: true, name: name, map: _clone(map), count: Object.keys(customs).length };
  }

  function deleteCustom(name) {
    if (!name || typeof name !== 'string') return { ok: false, reason: 'empty-name' };
    var customs = _loadCustomRaw();
    if (!customs.hasOwnProperty(name)) return { ok: false, reason: 'not-found', name: name };
    delete customs[name];
    if (!_saveCustomRaw(customs)) return { ok: false, reason: 'storage-unavailable' };
    if (_active === name) refreshActive();
    _renderCustomList();
    var bus = _bus();
    if (bus && typeof bus.emit === 'function') {
      try { bus.emit('arp:vp-preset-deleted', { name: name }); } catch (e) {}
    }
    return { ok: true, name: name, count: Object.keys(customs).length };
  }

  function listCustom() {
    var customs = _loadCustomRaw();
    return Object.keys(customs).map(function (name) {
      var c = customs[name] || {};
      return { name: name, map: _clone(c.map || {}), savedAt: c.savedAt || 0 };
    }).sort(function (a, b) { return (a.savedAt || 0) - (b.savedAt || 0); });
  }

  function getActive() { return _active; }

  function onActiveChange(cb) {
    if (typeof cb === 'function') _activeListeners.push(cb);
    return cb;
  }
  function offActiveChange(cb) {
    var i = _activeListeners.indexOf(cb);
    if (i >= 0) _activeListeners.splice(i, 1);
  }

  /* ---------- UI ---------- */
  function _updateActiveLabel() {
    var label = _active || '—';
    if (_ui && _ui.activeLabel) _ui.activeLabel.textContent = label;
    try {
      if (typeof document !== 'undefined') {
        var nodes = document.querySelectorAll('[data-arp-vp-active]');
        for (var i = 0; i < nodes.length; i++) nodes[i].textContent = label;
      }
    } catch (e) {}
  }

  function _renderCustomList() {
    if (!_ui || !_ui.customList) return;
    var list = _ui.customList;
    while (list.firstChild) list.removeChild(list.firstChild);
    var customs = listCustom();
    if (!customs.length) {
      var empty = document.createElement('div');
      empty.className = 'arp-vp-presets-empty';
      empty.textContent = 'Chưa có preset riêng.';
      list.appendChild(empty);
      return;
    }
    customs.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'arp-vp-preset-row';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'arp-vp-preset-btn arp-vp-custom-btn';
      btn.textContent = c.name;
      btn.title = 'Áp preset "' + c.name + '"';
      btn.addEventListener('click', function () { apply(c.name); });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'arp-vp-preset-del';
      del.textContent = '✕';
      del.title = 'Xóa preset "' + c.name + '"';
      del.addEventListener('click', function () { deleteCustom(c.name); });
      row.appendChild(btn);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  /* Vẽ khối preset vào 1 container cho trước. Coordinator gọi sau
   * khi panel ARP mở, hoặc bindPanel() tự tìm panel. */
  function renderInto(container) {
    if (!container || typeof document === 'undefined') return null;
    _ensureBusListener();
    _ensureLayerListener();
    var root = document.createElement('div');
    root.className = 'arp-vp-presets';
    root.setAttribute('data-arp-vp-presets', '');

    var head = document.createElement('div');
    head.className = 'arp-vp-presets-head';
    var title = document.createElement('span');
    title.textContent = 'Viewport preset: ';
    var activeLabel = document.createElement('strong');
    activeLabel.className = 'arp-vp-active';
    activeLabel.setAttribute('data-arp-vp-active', '');
    activeLabel.textContent = _active || '—';
    head.appendChild(title);
    head.appendChild(activeLabel);
    root.appendChild(head);

    var btnRow = document.createElement('div');
    btnRow.className = 'arp-vp-presets-row';
    BUILTIN_NAMES.forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'arp-vp-preset-btn';
      b.setAttribute('data-arp-vp-preset', name);
      b.textContent = name;
      b.addEventListener('click', function () { apply(name); });
      btnRow.appendChild(b);
    });
    root.appendChild(btnRow);

    /* VIEW2: hàng preset mở rộng (XRay/Motion) — attribute riêng
       data-arp-vp-preset-x để không lẫn với 4 nút builtin cũ. */
    var extRow = document.createElement('div');
    extRow.className = 'arp-vp-presets-row arp-vp-presets-extended';
    EXTENDED_PRESET_NAMES.forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'arp-vp-preset-btn arp-vp-extended-btn';
      b.setAttribute('data-arp-vp-preset-x', name);
      b.textContent = name;
      b.title = name === 'XRay' ? 'Soi xương xuyên mesh (skeleton + X-ray)' : 'Xem lại chuyển động (trails + onion + root motion + góc khớp)';
      b.addEventListener('click', function () { apply(name); });
      extRow.appendChild(b);
    });
    root.appendChild(extRow);

    var saveRow = document.createElement('div');
    saveRow.className = 'arp-vp-presets-save';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'arp-vp-preset-name';
    input.placeholder = 'Tên preset riêng…';
    input.maxLength = MAX_NAME_LEN;
    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'arp-vp-preset-btn arp-vp-save-btn';
    saveBtn.textContent = 'Lưu preset hiện tại';
    saveBtn.addEventListener('click', function () {
      var res = saveCustom(input.value);
      if (!res.ok) {
        _warn('Lưu preset riêng thất bại:', res.reason);
        if (typeof window !== 'undefined' && window.alert) {
          var msg = res.reason === 'empty-name' ? 'Nhập tên preset trước.'
            : res.reason === 'builtin-name' ? 'Tên "' + input.value.trim() + '" trùng preset có sẵn.'
            : res.reason === 'limit-reached' ? 'Đã đủ ' + MAX_CUSTOM + ' preset riêng — xóa bớt 1 cái trước.'
            : 'Không lưu được preset (' + res.reason + ').';
          window.alert(msg);
        }
      } else { input.value = ''; }
    });
    saveRow.appendChild(input);
    saveRow.appendChild(saveBtn);
    root.appendChild(saveRow);

    var customList = document.createElement('div');
    customList.className = 'arp-vp-presets-custom';
    root.appendChild(customList);

    _ui = { root: root, activeLabel: activeLabel, customList: customList, nameInput: input };
    container.appendChild(root);
    _renderCustomList();
    refreshActive();
    return root;
  }

  /* Tìm panel ARP đang mở và gắn khối preset vào cuối. Trả false
   * nếu chưa tìm thấy panel (coordinator gọi lại sau khi mở panel). */
  function bindPanel() {
    if (typeof document === 'undefined') return false;
    var host = null;
    try {
      host = document.querySelector('#arp-panel-body')
        || document.querySelector('.arp-window-body')
        || document.querySelector('#arp-panel')
        || document.querySelector('[data-arp-panel]');
    } catch (e) { host = null; }
    if (!host) return false;
    if (host.querySelector('[data-arp-vp-presets]')) return true; /* đã gắn rồi */
    renderInto(host);
    return true;
  }

  /* Gắn listener bus/registry ngay khi load được (defensive: nếu
   * bus/registry chưa có, lần gọi API đầu tiên sẽ thử gắn lại). */
  _ensureBusListener();
  _ensureLayerListener();

  var ArpVpPresets = {
    apply: apply,
    saveCustom: saveCustom,
    deleteCustom: deleteCustom,
    listCustom: listCustom,
    listPresets: listPresets,
    getPreset: getPreset,
    getActive: getActive,
    snapshot: snapshot,
    matchesPreset: matchesPreset,
    refreshActive: refreshActive,
    renderInto: renderInto,
    bindPanel: bindPanel,
    onActiveChange: onActiveChange,
    offActiveChange: offActiveChange,
    DEFAULT_AFTER_RIG: DEFAULT_AFTER_RIG,
    STORAGE_KEY: STORAGE_KEY,
    MAX_CUSTOM: MAX_CUSTOM,
    _test: {
      KNOWN_LAYERS: KNOWN_LAYERS,
      BUILTINS: BUILTINS,
      BUILTIN_NAMES: BUILTIN_NAMES,
      EXTENDED_PRESET_NAMES: EXTENDED_PRESET_NAMES,
      ALL_BUILTIN_NAMES: ALL_BUILTIN_NAMES,
      STORAGE_KEY: STORAGE_KEY,
      reset: function () {
        _active = null;
        _applying = false;
        _layerListenerBound = false;
        _busListenerBound = false;
        _activeListeners = [];
        _ui = null;
      },
      rebind: function () { _ensureBusListener(); _ensureLayerListener(); }
    }
  };

  if (typeof window !== 'undefined') {
    window.PixiStudio = window.PixiStudio || {};
    window.PixiStudio.ArpVpPresets = ArpVpPresets;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = ArpVpPresets;
})();
