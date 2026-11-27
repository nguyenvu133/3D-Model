/* ============================================================
 * animation/anim-graph-editor.js — VISUAL EDITOR node-based
 * cho Blend Tree + State Machine (tab ARP 'Anim Graph').
 *
 * TƯƠNG TÁC (ghi trong UI, thanh trợ giúp dưới toolbar):
 *   • Kéo node: giữ tiêu đề node rồi kéo.
 *   • Nối dây: bấm cổng OUT (chấm dưới node) rồi bấm cổng IN
 *     (chấm trên node đích). Bấm lại cổng OUT để hủy.
 *   • Zoom: lăn chuột. Pan: kéo nền canvas.
 *   • Chọn node/dây: bấm vào → sửa ở panel thuộc tính bên phải.
 *   • Xóa: nút Xóa trong panel thuộc tính (hoặc phím Delete khi
 *     đang chọn node).
 *   • Điện thoại: panel full-screen, nút ≥ 44px, panel thuộc tính
 *     nằm dưới canvas khi màn hình hẹp (xem css/anim-graph.css).
 *
 * TÍCH HỢP (không sửa file khác):
 *   • Đọc clip qua AnimBlendTree.clipList() (SyncClips/Animator).
 *   • Phát preview qua AnimBlendTree.createRuntime() /
 *     AnimStateMachine.createRuntime() (mixer riêng của graph);
 *     khi bấm Phát thì gọi ArpAnimator.stop() (API công khai) để
 *     2 mixer không giành nhau. Ngoài ra có chế độ "Phát qua
 *     Animator" (xem Editor.playViaAnimator): editor chỉ đánh giá
 *     logic graph (transition/trọng số) rồi gọi Animator.play(id)
 *     + setFadeDuration() — Animator giữ mixer/action của nó.
 *   • Phát 'anim:graph-state-changed' qua runtime (Animator hiển
 *     thị clip/state hiện tại qua bus — Animator không bị sửa).
 *   • Lưu: localStorage auto-save (debounce 300ms) + xuất/nhập
 *     file .json, format 'pixistudio-anim-graph-1' (legacy, giữ
 *     tương thích) + NHIỀU graph qua AnimGraphStore
 *     ('pixistudio-anim-graphs-v2': danh sách graph, nhân bản,
 *     đổi tên, xóa, mapping nhân vật↔graph).
 *
 * MỞ RỘNG SM2 (vòng Animation mở rộng, 2026-11-27):
 *   • Zoom/pan ĐÃ CÓ từ trước (lăn chuột zoom 0.4–2, kéo nền pan);
 *     vòng này thêm nút zoom + Fit + minimap (bấm để nhảy tới).
 *   • Tìm kiếm node (lọc/highlight + Enter nhảy tới).
 *   • Copy/paste node (Ctrl+C/V, giữ kết nối nội bộ), nhân bản
 *     state / nhân bản cả cây Blend Tree, undo/redo RIÊNG trong
 *     editor (Ctrl+Z/Y, stack snapshot riêng — không dùng History
 *     toàn cục của studio).
 *   • Kéo dây có snap (kéo từ cổng OUT, hút vào cổng IN gần nhất)
 *     + kéo node snap lưới 10px; tự sắp xếp node (auto-layout
 *     theo tầng BFS từ root/entry).
 *   • Màu node theo loại — render theo registry data-driven
 *     (Editor.NODE_TYPES, merge thêm loại mới từ runtime nếu
 *     SM1 đăng ký BT.NODE_TYPES/SM.NODE_TYPES; loại lạ fallback
 *     màu mặc định, không crash).
 *   • Ghi chú tự do trên graph (comment node, không ảnh hưởng
 *     chạy; lưu trong store entry, không đưa vào runtime graph).
 *   • Validation chi tiết: panel liệt kê lỗi/cảnh báo có nodeId
 *     (state mồ côi, transition thiếu điều kiện, clip thiếu,
 *     parameter chưa khai báo); bấm lỗi nhảy tới node.
 *   • Xem trước: bấm state để phát state đó (đã có), highlight
 *     transition đang chạy + tiến độ %, slider parameter ngoài
 *     viewport chỉnh realtime khi đang phát.
 * ============================================================ */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined' && window.PixiStudio) || {};
  var bus = (PS && PS.bus) || { emit: function () {}, on: function () {} };
  var U = (PS && PS.Utils) || null;
  var doc = (typeof document !== 'undefined') ? document : null;

  var STORAGE_KEY = 'pixistudio-anim-graph-1';
  var BACKUP_KEY = 'pixistudio-anim-graph-1-backup';
  var NODE_W = 180;
  var GRID_SNAP = 10;      /* kéo node snap lưới 10px */
  var WIRE_SNAP_PX = 40;   /* kéo dây: hút vào cổng IN trong 40px */
  var HISTORY_MAX = 25; /* stack undo duy nhất _undoStack: 25 bước */

  /* Registry màu/icon node theo loại — data-driven: SM1 (runtime) có
     thể đăng ký thêm loại qua BT.NODE_TYPES / SM.NODE_TYPES; loại lạ
     fallback về 'unknown' (không crash, không cần sửa editor tay). */
  var DEFAULT_NODE_TYPES = {
    clip:      { label: 'Clip',     color: '#2e7d32', head: '#2e5d33', icon: '▶' },
    blend1d:   { label: 'Blend 1D', color: '#1565c0', head: '#1d4a7a', icon: '↔' },
    blend2d:   { label: 'Blend 2D', color: '#6a1b9a', head: '#4a2a6a', icon: '✥' },
    add:       { label: 'Add/Mask', color: '#e65100', head: '#7a3d16', icon: '+' },
    /* Loại mới của SM1 (runtime): editor tự nhận qua registry, không
       cần sửa tay từng loại. */
    random:    { label: 'Random',   color: '#7b1fa2', head: '#4a2a6a', icon: '⚄' },
    mirror:    { label: 'Mirror',   color: '#00897b', head: '#14565e', icon: '⇋' },
    timescale: { label: 'Time Scale', color: '#5d4037', head: '#4a3226', icon: '×' },
    layer:     { label: 'Layer',    color: '#c2185b', head: '#6a1a3a', icon: '▤' },
    blendadditive: { label: 'Blend Additive', color: '#ad1457', head: '#5e1030', icon: '±' },
    layered:   { label: 'Layered',  color: '#4527a0', head: '#2a1a5e', icon: '▦' },
    sequence:  { label: 'Sequence', color: '#00695c', head: '#14453e', icon: '▶▶' },
    state:     { label: 'State',    color: '#00838f', head: '#14565e', icon: '●' },
    comment:   { label: 'Ghi chú',  color: '#f9a825', head: '#7a5c16', icon: '✎' },
    unknown:   { label: '?',        color: '#616161', head: '#424242', icon: '?' }
  };

  function nodeTypeInfo(type) {
    var B = BT(), S = SM();
    var reg = null;
    try {
      /* Runtime SM1 đăng ký NODE_TYPES dạng MẢNG tên loại
         (BT.NODE_TYPES = ['clip', ...]) — loại trong mảng là loại
         hợp lệ, dùng label/màu mặc định của editor cho loại đó. */
      if (B && B.NODE_TYPES) {
        if (B.NODE_TYPES[type]) reg = B.NODE_TYPES[type];
        else if (Array.isArray(B.NODE_TYPES) && B.NODE_TYPES.indexOf(type) >= 0) reg = { label: type };
      }
      if (!reg && S && S.NODE_TYPES) {
        if (S.NODE_TYPES[type]) reg = S.NODE_TYPES[type];
        else if (Array.isArray(S.NODE_TYPES) && S.NODE_TYPES.indexOf(type) >= 0) reg = { label: type };
      }
    } catch (e) {}
    var base = DEFAULT_NODE_TYPES[type] || DEFAULT_NODE_TYPES.unknown;
    if (!reg) return base;
    return {
      label: reg.label || base.label,
      color: reg.color || base.color,
      head: reg.head || base.head,
      icon: reg.icon || base.icon
    };
  }

  function el(tag, attrs, children) {
    if (U && U.el) return U.el(tag, attrs, children);
    var node = doc.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null) return;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) { if (c != null) node.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    }
    return node;
  }
  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message }); } catch (e) {}
  }
  function ls() {
    try { return (typeof localStorage !== 'undefined' ? localStorage : window.localStorage); } catch (e) { return null; }
  }
  function BT() { return PS.AnimBlendTree; }
  function SM() { return PS.AnimStateMachine; }

  var Editor = {
    mode: 'blendtree',
    btGraph: null, smGraph: null,
    btRuntime: null, smRuntime: null,
    selected: null,      // {kind:'node'|'transition'|'connection', id}
    pendingFrom: null,   // node id đang chờ nối dây
    pan: { x: 0, y: 0 }, zoom: 1,
    playing: false, _raf: 0, _lastT: 0, _saveTimer: 0,
    _container: null, _canvas: null, _world: null, _svg: null, _props: null, _paramBar: null, _status: null,
    /* --- SM2: editor-local --- */
    NODE_TYPES: DEFAULT_NODE_TYPES,
    history: { undo: [], redo: [] },   // stack snapshot riêng (không dùng History toàn cục)
    clipboard: null,                    // {mode, nodes:[], connections:[]}
    searchQuery: '',
    comments: { blendtree: [], statemachine: [] }, // ghi chú tự do (không vào runtime graph)
    playViaAnimator: false,             // true: editor đánh giá logic, Animator.play() phát clip
    _animDrive: null,                   // trạng thái driver Animator {mode, ...}
    _lastAnimatorClip: null,
    _droveAnimator: false,
    _activeEntry: { blendtree: null, statemachine: null }, // id entry trong AnimGraphStore
    _storeReady: false,
    _selListener: false, _focused: false,
    _wireDrag: null,                    // {from, x, y, moved}
    _minimap: null, _graphBar: null, _issues: null, _searchInput: null
  };

  function Store() { return PS.AnimGraphStore || null; }
  function currentComments() { return Editor.comments[Editor.mode]; }

  function graph() { return Editor.mode === 'statemachine' ? Editor.smGraph : Editor.btGraph; }
  function runtime() { return Editor.mode === 'statemachine' ? Editor.smRuntime : Editor.btRuntime; }

  /* ================= KHỞI TẠO / DEMO ================= */

  function newGraphs() {
    var B = BT(), S = SM();
    Editor.btGraph = B ? B.createGraph('Blend Tree') : { mode: 'blendtree', name: 'Blend Tree', parameters: [], nodes: [], connections: [], rootId: null };
    Editor.smGraph = S ? S.createStateMachine('State Machine') : { mode: 'statemachine', name: 'State Machine', parameters: [], states: [], transitions: [], entryStateId: null };
  }

  function firstClips(n) {
    var B = BT();
    var list = B ? B.clipList() : [];
    /* Ưu tiên clip có clip THREE thật (phát được qua mixer); clip
       autogen/preset chỉ có definition thì không phát được. */
    var real = list.filter(function (c) { return c.hasClip; });
    var pool = real.length ? real : list;
    return pool.slice(0, n);
  }

  /* Demo Locomotion: speed 0→1 blend Idle/Walk/Run; SM Idle→Walk→Run. */
  Editor.buildDemo = function () {
    var B = BT(), S = SM();
    if (!B || !S) return { ok: false, error: 'Thiếu module BlendTree/StateMachine.' };
    Editor.pushUndo();
    var clips = firstClips(3);
    var ids = clips.map(function (c) { return c.id; });
    while (ids.length < 3) ids.push('demo:Clip' + (ids.length + 1));
    /* --- Blend Tree --- */
    var g = B.createGraph('Demo Locomotion');
    B.addParameter(g, { name: 'speed', type: 'float', defaultValue: 0, min: 0, max: 1 });
    B.addParameter(g, { name: 'attack', type: 'trigger' });
    var nIdle = B.addNode(g, { type: 'clip', name: 'Idle', clipId: ids[0], x: 40, y: 200 }).node;
    var nWalk = B.addNode(g, { type: 'clip', name: 'Walk', clipId: ids[1], x: 250, y: 200 }).node;
    var nRun = B.addNode(g, { type: 'clip', name: 'Run', clipId: ids[2], x: 460, y: 200 }).node;
    var blend = B.addNode(g, { type: 'blend1d', name: 'Locomotion', parameter: 'speed', x: 250, y: 30 }).node;
    B.connect(g, blend.id, nIdle.id, { threshold: 0 });
    B.connect(g, blend.id, nWalk.id, { threshold: 0.5 });
    B.connect(g, blend.id, nRun.id, { threshold: 1 });
    B.setRoot(g, blend.id);
    Editor.btGraph = g;
    /* --- State Machine --- */
    var sm = S.createStateMachine('Demo Locomotion');
    B.addParameter(sm, { name: 'speed', type: 'float', defaultValue: 0, min: 0, max: 1 });
    B.addParameter(sm, { name: 'attack', type: 'trigger' });
    var sIdle = S.addState(sm, { name: 'Idle', clipId: ids[0], x: 40, y: 60 }).state;
    var sWalk = S.addState(sm, { name: 'Walk', clipId: ids[1], x: 270, y: 60 }).state;
    var sRun = S.addState(sm, { name: 'Run', clipId: ids[2], x: 500, y: 60 }).state;
    S.setEntry(sm, sIdle.id);
    S.addTransition(sm, { from: sIdle.id, to: sWalk.id, conditions: [{ param: 'speed', op: '>', value: 0.1 }], duration: 0.3 });
    S.addTransition(sm, { from: sWalk.id, to: sRun.id, conditions: [{ param: 'speed', op: '>', value: 0.6 }], duration: 0.3 });
    S.addTransition(sm, { from: sWalk.id, to: sIdle.id, conditions: [{ param: 'speed', op: '<=', value: 0.1 }], duration: 0.3 });
    S.addTransition(sm, { from: sRun.id, to: sWalk.id, conditions: [{ param: 'speed', op: '<=', value: 0.6 }], duration: 0.3 });
    Editor.smGraph = sm;
    Editor.selected = null;
    Editor.saveSoon();
    return { ok: true, clips: clips.length };
  };

  /* ================= UNDO RIÊNG (snapshot JSON, 25 bước) ============
     Ủy thác sang hệ history của SM2 (historyPush/historyUndo, có cả
     redo + chống snapshot trùng) khi có; fallback stack riêng khi
     chưa load phần SM2 (vd harness chỉ load file này). */
  Editor._undoStack = [];
  Editor.pushUndo = function () {
    if (typeof Editor.historyPush === 'function') { Editor.historyPush(); return; }
    var B = BT(), S = SM();
    if (!B || !S || !Editor.btGraph || !Editor.smGraph) return;
    try {
      Editor._undoStack.push(JSON.stringify({
        blendtree: B.serialize(Editor.btGraph),
        statemachine: S.serialize(Editor.smGraph)
      }));
      if (Editor._undoStack.length > 25) Editor._undoStack.shift();
    } catch (e) {}
  };
  Editor.undo = function () {
    /* historyUndo() gọi undo() để chạy thân gốc; cờ _undoing ngăn
       delegate quay lại historyUndo gây đệ quy vô hạn. */
    if (typeof Editor.historyUndo === 'function' && !Editor._undoing) return Editor.historyUndo();
    if (Editor.history) Editor.history.redo.length = 0; /* nhánh undo mới → redo cũ hết hiệu lực */
    var B = BT(), S = SM();
    if (!Editor._undoStack.length) return { ok: false, error: 'Hết lịch sử hoàn tác.' };
    var raw = Editor._undoStack.pop();
    try {
      var data = JSON.parse(raw);
      var r1 = B.deserialize(data.blendtree);
      var r2 = S.deserialize(data.statemachine);
      if (r1.ok) Editor.btGraph = r1.graph;
      if (r2.ok) Editor.smGraph = r2.graph;
      if (data.comments) { try { Editor.comments = JSON.parse(JSON.stringify(data.comments)); } catch (e2) {} }
      Editor.selected = null;
      Editor.saveSoon();
      Editor.renderAll();
      return { ok: true, left: Editor._undoStack.length };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  };

  /* Nhân bản + tự sắp xếp: bản SM2 (định nghĩa sau trong file này)
     thắng — nhân bản cả cây con + dây nối, layout qua computeLayout.
     (Bản cũ của vòng này đã xóa để chỉ còn 1 định nghĩa.) */

  /* ================= THƯ VIỆN NHIỀU GRAPH + GẮN MODEL ============ */
  Editor.LIB_KEY = 'pixistudio-anim-graph-library-1';
  Editor.ATTACH_KEY = 'pixistudio-anim-graph-attach-1';
  Editor._libName = '';
  Editor.listLibrary = function () {
    try {
      var store = ls();
      var raw = store && store.getItem(Editor.LIB_KEY);
      var lib = raw ? JSON.parse(raw) : { graphs: {}, active: null };
      if (!lib.graphs) lib.graphs = {};
      return lib;
    } catch (e) { return { graphs: {}, active: null }; }
  };
  Editor.saveToLibrary = function (name) {
    var B = BT(), S = SM();
    name = String(name || '').trim();
    if (!name) return { ok: false, error: 'Nhập tên graph để lưu vào thư viện.' };
    try {
      var store = ls();
      if (!store) return { ok: false, error: 'Không có localStorage.' };
      var lib = Editor.listLibrary();
      lib.graphs[name] = {
        blendtree: B.serialize(Editor.btGraph), statemachine: S.serialize(Editor.smGraph),
        comments: JSON.parse(JSON.stringify(Editor.comments)) /* SM2: ghi chú đi kèm graph */
      };
      lib.active = name;
      Editor._libName = name;
      store.setItem(Editor.LIB_KEY, JSON.stringify(lib));
      return { ok: true, name: name };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  };
  Editor.loadFromLibrary = function (name) {
    var B = BT(), S = SM();
    var lib = Editor.listLibrary();
    var entry = lib.graphs[name];
    if (!entry) return { ok: false, error: 'Không có graph "' + name + '" trong thư viện.' };
    Editor.pushUndo();
    if (entry.blendtree) { var r1 = B.deserialize(entry.blendtree); if (r1.ok) Editor.btGraph = r1.graph; }
    if (entry.statemachine) { var r2 = S.deserialize(entry.statemachine); if (r2.ok) Editor.smGraph = r2.graph; }
    if (entry.comments) { try { Editor.comments = JSON.parse(JSON.stringify(entry.comments)); } catch (e) {} }
    lib.active = name;
    Editor._libName = name;
    try { var store = ls(); if (store) store.setItem(Editor.LIB_KEY, JSON.stringify(lib)); } catch (e) {}
    Editor.selected = null;
    Editor.saveSoon();
    Editor.renderAll();
    return { ok: true, name: name };
  };
  Editor.deleteFromLibrary = function (name) {
    try {
      var store = ls();
      if (!store) return { ok: false, error: 'Không có localStorage.' };
      var lib = Editor.listLibrary();
      if (!lib.graphs[name]) return { ok: false, error: 'Không có graph "' + name + '".' };
      delete lib.graphs[name];
      if (lib.active === name) lib.active = null;
      store.setItem(Editor.LIB_KEY, JSON.stringify(lib));
      Editor._libName = '';
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  };
  function getTargetName() {
    try {
      if (PS.Models && typeof PS.Models.getCurrent === 'function') {
        var m = PS.Models.getCurrent();
        if (m && m.name) return m.name;
      }
    } catch (e) {}
    try {
      if (PS.RigAutoGen && PS.RigAutoGen.current && PS.RigAutoGen.current.modelName) return PS.RigAutoGen.current.modelName;
    } catch (e) {}
    return null;
  }
  Editor.attachToModel = function () {
    var modelName = getTargetName();
    if (!modelName) return { ok: false, error: 'Chưa có model hiện tại để gắn.' };
    var graphName = Editor._libName || Editor.listLibrary().active || '';
    if (!graphName) return { ok: false, error: 'Lưu graph vào thư viện trước (đặt tên rồi bấm Lưu vào thư viện).' };
    try {
      var store = ls();
      if (!store) return { ok: false, error: 'Không có localStorage.' };
      var at = {};
      try { at = JSON.parse(store.getItem(Editor.ATTACH_KEY) || '{}'); } catch (e) { at = {}; }
      at[modelName] = graphName;
      store.setItem(Editor.ATTACH_KEY, JSON.stringify(at));
      return { ok: true, model: modelName, graph: graphName };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  };
  Editor.loadAttachedForModel = function () {
    var modelName = getTargetName();
    if (!modelName) return { ok: false };
    try {
      var store = ls();
      var at = store ? JSON.parse(store.getItem(Editor.ATTACH_KEY) || '{}') : {};
      var graphName = at[modelName];
      if (!graphName) return { ok: false };
      return Editor.loadFromLibrary(graphName);
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  };

  /* ================= LƯU / TẢI ================= */

  Editor.saveSoon = function () {
    if (Editor._saveTimer) return;
    Editor._saveTimer = setTimeout(function () { Editor._saveTimer = 0; Editor.save(); }, 300);
  };

  Editor.save = function () {
    var B = BT(), S = SM();
    if (!B || !S) return { ok: false, error: 'Thiếu module.' };
    try {
      var store = ls();
      if (!store) return { ok: false, error: 'Không có localStorage.' };
      var prev = store.getItem(STORAGE_KEY);
      if (prev) { try { store.setItem(BACKUP_KEY, prev); } catch (e) {} }
      var data = {
        format: 'pixistudio-anim-graph-1', version: 1,
        blendtree: B.serialize(Editor.btGraph),
        statemachine: S.serialize(Editor.smGraph)
      };
      store.setItem(STORAGE_KEY, JSON.stringify(data));
      Editor.syncStoreEntry();
      return { ok: true, bytes: JSON.stringify(data).length };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  };

  Editor.load = function () {
    var B = BT(), S = SM();
    var store = ls();
    if (!store) return { ok: false, error: 'Không có localStorage.' };
    var raw = store.getItem(STORAGE_KEY);
    if (!raw) return { ok: false, error: 'Chưa có graph đã lưu.' };
    try {
      var data = JSON.parse(raw);
      if (data.format !== 'pixistudio-anim-graph-1') return { ok: false, error: 'Format lạ: ' + (data.format || '(trống)') };
      if (data.blendtree) { var r1 = B.deserialize(data.blendtree); if (r1.ok) Editor.btGraph = r1.graph; }
      if (data.statemachine) { var r2 = S.deserialize(data.statemachine); if (r2.ok) Editor.smGraph = r2.graph; }
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  };

  Editor.renderLibrarySelect = function () {
    var sel = Editor._libSelect;
    if (!sel) return;
    var lib = Editor.listLibrary();
    sel.innerHTML = '';
    var placeholder = doc.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— thư viện graph —';
    sel.appendChild(placeholder);
    Object.keys(lib.graphs).forEach(function (name) {
      var o = doc.createElement('option');
      o.value = name;
      o.textContent = name + (lib.active === name ? ' ★' : '');
      if (lib.active === name) o.selected = true;
      sel.appendChild(o);
    });
    Editor._libName = lib.active || Editor._libName || '';
  };

  Editor.exportJSON = function () {
    var S2 = Store();
    if (S2 && Editor._storeReady) {
      /* Xuất TẤT CẢ graph trong store (format v2) — nhập lại được
         bằng importJSON (nhận cả v2 lẫn legacy v1). */
      Editor.syncStoreEntry();
      var ex = S2.exportText();
      if (ex.ok && U && U.downloadText) U.downloadText(ex.text, 'anim-graphs.json', 'application/json');
      return { ok: true, text: ex.text || '' };
    }
    var B = BT(), S = SM();
    var data = {
      format: 'pixistudio-anim-graph-1', version: 1,
      blendtree: B.serialize(Editor.btGraph),
      statemachine: S.serialize(Editor.smGraph)
    };
    var text = JSON.stringify(data, null, 2);
    if (U && U.downloadText) U.downloadText(text, 'anim-graph.json', 'application/json');
    return { ok: true, text: text };
  };

  Editor.importJSON = function (text) {
    var S2 = Store();
    if (S2) {
      /* Nhận cả format v2 (nhiều graph) lẫn legacy v1. */
      var r = S2.importText(text);
      if (!r.ok) return r;
      Editor._storeReady = true;
      /* Nạp graph đầu tiên vừa nhập của mode hiện tại. */
      var list = S2.list(Editor.mode);
      var hit = list.find(function (e) { return r.imported.indexOf(e.name) >= 0; });
      if (hit) Editor.loadStoreEntry(hit);
      Editor.selected = null;
      Editor.renderAll();
      Editor.renderGraphBar();
      return { ok: true, imported: r.imported };
    }
    var B = BT(), S = SM();
    var data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'JSON lỗi: ' + (e && e.message) }; }
    if (!data || data.format !== 'pixistudio-anim-graph-1') return { ok: false, error: 'Không phải file Anim Graph (format pixistudio-anim-graph-1).' };
    if (data.blendtree) { var r1 = B.deserialize(data.blendtree); if (!r1.ok) return r1; Editor.btGraph = r1.graph; }
    if (data.statemachine) { var r2 = S.deserialize(data.statemachine); if (!r2.ok) return r2; Editor.smGraph = r2.graph; }
    Editor.selected = null;
    Editor.saveSoon();
    Editor.renderAll();
    return { ok: true };
  };

  /* ================= TARGET / PREVIEW ================= */

  function getTarget() {
    try {
      if (PS.Viewport && typeof PS.Viewport.getMainModel === 'function') {
        var m = PS.Viewport.getMainModel();
        if (m) return m;
      }
    } catch (e) {}
    try {
      var RAG = PS.RigAutoGen;
      if (RAG && RAG.current) return RAG.current.root || RAG.current.group || RAG.current.model || null;
    } catch (e) {}
    return null;
  }

  Editor.playPreview = function () {
    var B = BT(), S = SM();
    if (!B || !S) return { ok: false, error: 'Thiếu module BlendTree/StateMachine.' };
    /* Đổi nhân vật → ưu tiên graph đã gắn cho nhân vật đó. */
    var cid = Editor.currentCharacterId();
    if (cid) Editor.maybeSwitchGraphForCharacter(cid);
    /* Chế độ "Phát qua Animator": editor chỉ đánh giá logic graph,
       Animator.play() phát clip bằng mixer/action của nó. */
    if (Editor.playViaAnimator) return Editor.startAnimatorDrive();
    var target = getTarget();
    if (!target) return { ok: false, error: 'Chưa có model — rig/import model trước rồi bấm Phát.' };
    /* Dừng Animator (API công khai) để 2 mixer không giành nhau. */
    try { if (PS.ArpAnimator && PS.ArpAnimator.playing) PS.ArpAnimator.stop(); } catch (e) {}
    var rt = runtime();
    if (!rt) return { ok: false, error: 'Chưa tạo được runtime.' };
    rt.setTarget(target);
    try { rt.smoothing = 0.15; } catch (e) {}
    var res;
    if (Editor.mode === 'statemachine') res = rt.play(Editor.smGraph);
    else res = rt.playGraph(Editor.btGraph);
    if (!res.ok) return res;
    Editor.playing = true;
    Editor._lastT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    function loop(t) {
      if (!Editor.playing) return;
      var now = t || Date.now();
      var dt = Math.min(0.1, (now - Editor._lastT) / 1000 || 0.016);
      Editor._lastT = now;
      try { rt.tick(dt); } catch (e) {}
      Editor.updateStatus();
      Editor.updatePlaybackHighlight();
      Editor._raf = requestAnimationFrame(loop);
    }
    Editor._raf = requestAnimationFrame(loop);
    Editor.updateStatus();
    return { ok: true };
  };

  Editor.stopPreview = function () {
    Editor.playing = false;
    try { if (Editor._raf) cancelAnimationFrame(Editor._raf); } catch (e) {}
    Editor._raf = 0;
    Editor.stopAnimatorDrive();
    try { if (Editor.btRuntime) Editor.btRuntime.stop(); } catch (e) {}
    try { if (Editor.smRuntime) Editor.smRuntime.stop(); } catch (e) {}
    Editor.updateStatus();
    Editor.updatePlaybackHighlight();
    return { ok: true };
  };

  Editor.setParamLive = function (name, value) {
    var g = graph();
    var B = BT();
    if (!B) return { ok: false, error: 'Thiếu module.' };
    var r = B.setParameter(g, name, value);
    if (r.ok && Editor.playing) {
      try { runtime().setParameter(name, value); } catch (e) {}
    }
    Editor.saveSoon();
    return r;
  };

  /* ================= RENDER ================= */

  function nodeLabel(n) {
    if (Editor.mode === 'statemachine') return n.name + (n.isExit ? ' (exit)' : '') + (n.subMachine ? ' ▸ sub' : '');
    return n.name + ' · ' + (({ clip: 'Clip', blend1d: 'Blend 1D', blend2d: 'Blend 2D', add: 'Add/Mask', random: 'Random', mirror: 'Mirror', timescale: 'Time Scale', layer: 'Layer' })[n.type] || nodeTypeInfo(n.type).label);
  }

  function nodeSub(n) {
    if (Editor.mode === 'statemachine') {
      return (n.subMachine ? 'sub-machine: ' + (n.subMachine.states || []).length + ' state · ' : '') +
        (n.clipId || (n.isExit ? 'exit — quay về máy cha' : 'chưa gán clip')) +
        (Editor.smGraph.entryStateId === n.id ? ' ★ entry' : '');
    }
    if (n.type === 'clip') return n.clipId || 'chưa chọn clip';
    if (n.type === 'blend1d') return 'param: ' + (n.parameter || '—') + ' · ' + n.children.length + ' con';
    if (n.type === 'blend2d') return 'x: ' + (n.parameterX || '—') + ' y: ' + (n.parameterY || '—') + ' · ' + n.children.length + ' con';
    if (n.type === 'add') return 'mask: ' + (n.mask || 'upper') + ' · w=' + n.weight;
    if (n.type === 'layer') return 'mask: ' + (n.mask || 'upper') + ' · 1 base + ' + Math.max(0, n.children.length - 1) + ' overlay';
    if (n.type === 'random') return 'đang chọn con #' + (n.picked || 0) + ' / ' + n.children.length;
    if (n.type === 'mirror') return 'lật clip con (trái ↔ phải)';
    if (n.type === 'timescale') return '×' + (n.timeScale || 1) + (n.parameter ? ' (param ' + n.parameter + ')' : '');
    if ((n.children || []).length) return n.children.length + ' con'; /* loại mới của SM1: mô tả chung */
    return '';
  }

  Editor.renderAll = function () {
    if (!Editor._container) return;
    Editor.renderNodes();
    Editor.renderProps();
    Editor.renderParamBar();
    Editor.updateStatus();
  };

  Editor.renderNodes = function () {
    var world = Editor._world;
    if (!world) return;
    world.innerHTML = '';
    Editor._svg = el('svg', { class: 'ag-svg', style: { position: 'absolute', left: '0', top: '0', width: '4000px', height: '3000px', overflow: 'visible', 'pointer-events': 'none' } });
    world.appendChild(Editor._svg);
    var g = graph();
    var items = Editor.mode === 'statemachine' ? g.states : g.nodes;
    var q = (Editor._search || '').toLowerCase();
    items.forEach(function (n) {
      var isSel = Editor.selected && Editor.selected.kind === 'node' && Editor.selected.id === n.id;
      var isRoot = Editor.mode === 'blendtree' && g.rootId === n.id;
      var isEntry = Editor.mode === 'statemachine' && g.entryStateId === n.id;
      var dimmed = q && (n.name || '').toLowerCase().indexOf(q) < 0;
      /* Màu theo loại — data-driven qua registry (loại mới của SM1
         tự có màu, loại lạ fallback). */
      var typeKey = Editor.mode === 'statemachine' ? 'state' : (n.type || 'unknown');
      var typeInfo = nodeTypeInfo(typeKey);
      var box = el('div', {
        class: 'ag-node ag-node-type-' + typeKey + (isSel ? ' ag-selected' : '') + (isRoot || isEntry ? ' ag-root' : '') + (Editor.pendingFrom === n.id ? ' ag-pending' : '') + (dimmed ? ' ag-dim' : ''),
        style: { left: n.x + 'px', top: n.y + 'px', width: NODE_W + 'px', borderColor: typeInfo.color }
      }, [
        el('div', { class: 'ag-port ag-port-in', title: 'Cổng IN — bấm để nối dây từ node khác vào đây', onclick: function (ev) { ev.stopPropagation(); Editor.onPortIn(n.id); } }),
        el('div', {
          class: 'ag-node-head',
          style: { background: typeInfo.head },
          onmousedown: function (ev) { Editor.startDrag(ev, n); },
          onclick: function (ev) { ev.stopPropagation(); Editor.selected = { kind: 'node', id: n.id }; Editor.renderAll(); }
        }, [el('span', { text: typeInfo.icon + ' ' + nodeLabel(n) })]),
        el('div', { class: 'ag-node-body', text: nodeSub(n) }),
        el('div', {
          class: 'ag-port ag-port-out', title: 'Cổng OUT — kéo để nối dây (hút vào cổng IN gần nhất) hoặc bấm rồi bấm cổng IN của node đích',
          onmousedown: function (ev) { Editor.startWireDrag(ev, n.id); },
          onclick: function (ev) { ev.stopPropagation(); Editor.onPortOut(n.id); }
        })
      ]);
      box.dataset.nodeId = n.id;
      world.appendChild(box);
    });
    Editor.drawConnections();
    Editor.applyTransform();
    Editor.renderComments();
    Editor.applySearch(Editor._search || '');
    Editor.updateMinimap();
  };

  Editor.applyTransform = function () {
    if (!Editor._world) return;
    Editor._world.style.transform = 'translate(' + Editor.pan.x + 'px,' + Editor.pan.y + 'px) scale(' + Editor.zoom + ')';
    Editor._world.style.transformOrigin = '0 0';
  };

  Editor.drawConnections = function () {
    if (!Editor._svg) return;
    var svg = Editor._svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var g = graph();
    var NS = 'http://www.w3.org/2000/svg';
    function portPos(nodeId, isOut) {
      var box = Editor._world && Editor._world.querySelector('[data-node-id="' + nodeId + '"]');
      if (box) {
        var x = parseFloat(box.style.left) || 0, y = parseFloat(box.style.top) || 0;
        var h = box.offsetHeight || 96;
        return { x: x + NODE_W / 2, y: y + (isOut ? h : 0) };
      }
      var n = Editor.mode === 'statemachine'
        ? (g.states || []).find(function (s) { return s.id === nodeId; })
        : (g.nodes || []).find(function (x) { return x.id === nodeId; });
      if (!n) return null;
      return { x: (n.x || 0) + NODE_W / 2, y: (n.y || 0) + (isOut ? 96 : 0) };
    }
    function path(a, b, cls, sel) {
      var p = doc.createElementNS(NS, 'path');
      var mx = (a.x + b.x) / 2;
      p.setAttribute('d', 'M ' + a.x + ' ' + a.y + ' C ' + mx + ' ' + a.y + ', ' + mx + ' ' + b.y + ', ' + b.x + ' ' + b.y);
      p.setAttribute('class', 'ag-wire' + (cls ? ' ' + cls : '') + (sel ? ' ag-wire-selected' : ''));
      p.addEventListener('click', function (ev) { ev.stopPropagation(); });
      svg.appendChild(p);
      return p;
    }
    if (Editor.mode === 'blendtree') {
      (g.connections || []).forEach(function (c) {
        var a = portPos(c.from, true), b = portPos(c.to, false);
        if (a && b) path(a, b, '', Editor.selected && Editor.selected.kind === 'connection' && Editor.selected.id === c.from + '>' + c.to);
      });
    } else {
      (g.transitions || []).forEach(function (t) {
        if (t.from === '*') return; /* Any State vẽ riêng ở panel */
        var a = portPos(t.from, true), b = portPos(t.to, false);
        if (a && b) {
          var sel = Editor.selected && Editor.selected.kind === 'transition' && Editor.selected.id === t.id;
          var wireEl = path(a, b, '', sel);
          /* dataset để highlight transition đang chạy (SM2). */
          if (wireEl && wireEl.dataset) {
            wireEl.dataset.transId = t.id;
            wireEl.dataset.transFrom = t.from;
            wireEl.dataset.transTo = t.to;
          }
          var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          var label = doc.createElementNS(NS, 'text');
          label.setAttribute('x', mid.x); label.setAttribute('y', mid.y - 6);
          label.setAttribute('class', 'ag-wire-label');
          label.textContent = (t.conditions || []).map(function (c) { return c.param + ' ' + c.op + ' ' + c.value; }).join(' & ') || 'luôn đúng';
          label.addEventListener('click', function (ev) {
            ev.stopPropagation();
            Editor.selected = { kind: 'transition', id: t.id };
            Editor.renderAll();
          });
          svg.appendChild(label);
        }
      });
    }
    /* Dây đang chờ nối: từ pending node tới chuột (kéo dây thì tới
       đúng vị trí chuột, không thì vẽ tạm tới giữa canvas). */
    if (Editor.pendingFrom) {
      var a = portPos(Editor.pendingFrom, true);
      if (a) {
        var dest = (Editor._wireDrag && Editor._wireDragPos) ? Editor._wireDragPos : { x: a.x, y: a.y + 120 };
        path(a, dest, 'ag-wire-pending', false);
      }
    }
  };

  Editor.onPortOut = function (nodeId) {
    Editor.pendingFrom = (Editor.pendingFrom === nodeId) ? null : nodeId;
    Editor.renderNodes();
    Editor.updateStatus();
  };

  Editor.onPortIn = function (nodeId) {
    if (!Editor.pendingFrom) { Editor.selected = { kind: 'node', id: nodeId }; Editor.renderAll(); return; }
    var from = Editor.pendingFrom;
    Editor.pendingFrom = null;
    if (from === nodeId) { Editor.renderNodes(); return; }
    var B = BT(), S = SM();
    var res;
    Editor.pushUndo();
    if (Editor.mode === 'statemachine') {
      res = S.addTransition(Editor.smGraph, { from: from, to: nodeId, conditions: [], duration: 0.3 });
      if (res.ok) Editor.selected = { kind: 'transition', id: res.transition.id };
    } else {
      var parent = B.getNode(Editor.btGraph, from);
      var data = {};
      if (parent && parent.type === 'blend1d') data.threshold = parent.children.length * 0.5;
      if (parent && parent.type === 'blend2d') data = { x: parent.children.length, y: 0 };
      res = B.connect(Editor.btGraph, from, nodeId, data);
      if (res.ok) Editor.selected = { kind: 'node', id: from };
    }
    if (!res.ok) notify('warning', 'Anim Graph', res.error);
    Editor.saveSoon();
    Editor.renderAll();
  };

  Editor.startDrag = function (ev, node) {
    ev.preventDefault();
    ev.stopPropagation();
    Editor.selected = { kind: 'node', id: node.id };
    var startX = ev.clientX, startY = ev.clientY;
    var origX = node.x, origY = node.y;
    var moved = false, pushed = false;
    function mv(e2) {
      var dx = (e2.clientX - startX) / Editor.zoom, dy = (e2.clientY - startY) / Editor.zoom;
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        if (!pushed) { pushed = true; Editor.pushUndo(); }
        moved = true;
      }
      /* Snap lưới 10px (SM2). */
      node.x = Math.max(0, Math.round((origX + dx) / GRID_SNAP) * GRID_SNAP);
      node.y = Math.max(0, Math.round((origY + dy) / GRID_SNAP) * GRID_SNAP);
      var box = Editor._world && Editor._world.querySelector('[data-node-id="' + node.id + '"]');
      if (box) { box.style.left = node.x + 'px'; box.style.top = node.y + 'px'; }
      Editor.drawConnections();
      Editor.updateMinimap();
    }
    function up() {
      doc.removeEventListener('mousemove', mv);
      doc.removeEventListener('mouseup', up);
      if (moved) { Editor.saveSoon(); Editor.renderNodes(); }
      else Editor.renderProps();
    }
    doc.addEventListener('mousemove', mv);
    doc.addEventListener('mouseup', up);
  };

  /* ================= PANEL THUỘC TÍNH ================= */

  function clipOptions(selectedId) {
    var B = BT();
    var list = B ? B.clipList() : [];
    var opts = [el('option', { value: '' }, ['— chọn clip —'])];
    list.forEach(function (c) {
      opts.push(el('option', { value: c.id, selected: c.id === selectedId ? 'selected' : undefined },
        [c.name + ' (' + (c.source || '?') + (c.duration ? ', ' + c.duration.toFixed(2) + 's' : '') + ')']));
    });
    if (selectedId && !list.some(function (c) { return c.id === selectedId; })) {
      opts.push(el('option', { value: selectedId, selected: 'selected' }, [selectedId + ' (không tìm thấy)']));
    }
    return opts;
  }

  function paramOptions(selectedName) {
    var g = graph();
    var opts = [el('option', { value: '' }, ['— chọn parameter —'])];
    (g.parameters || []).forEach(function (p) {
      opts.push(el('option', { value: p.name, selected: p.name === selectedName ? 'selected' : undefined },
        [p.name + ' (' + p.type + ')']));
    });
    return opts;
  }

  function numInput(label, value, onChange, step) {
    return el('label', { class: 'ag-field' }, [
      el('span', { text: label }),
      el('input', {
        type: 'number', value: String(value), step: step || '0.1',
        onchange: function (ev) { onChange(parseFloat(ev.target.value)); }
      })
    ]);
  }

  Editor.renderProps = function () {
    var box = Editor._props;
    if (!box) return;
    box.innerHTML = '';
    var g = graph();
    var sel = Editor.selected;
    box.appendChild(el('h3', { text: 'Thuộc tính' }));
    if (!sel) {
      box.appendChild(el('p', { class: 'ag-hint', text: 'Bấm 1 node hoặc 1 dây để sửa. Bấm cổng OUT rồi cổng IN để nối dây.' }));
      box.appendChild(Editor._paramEditor());
      return;
    }
    if (sel.kind === 'node') {
      var n = Editor.mode === 'statemachine'
        ? (g.states || []).find(function (s) { return s.id === sel.id; })
        : (g.nodes || []).find(function (x) { return x.id === sel.id; });
      if (!n) { Editor.selected = null; Editor.renderProps(); return; }
      box.appendChild(el('div', { class: 'ag-prop-title', text: nodeLabel(n) }));
      box.appendChild(el('label', { class: 'ag-field' }, [
        el('span', { text: 'Tên' }),
        el('input', { type: 'text', value: n.name, onchange: function (ev) { n.name = ev.target.value; Editor.saveSoon(); Editor.renderNodes(); } })
      ]));
      if (Editor.mode === 'statemachine' || n.type === 'clip') {
        box.appendChild(el('label', { class: 'ag-field' }, [
          el('span', { text: 'Clip' }),
          el('select', { onchange: function (ev) { n.clipId = ev.target.value || null; Editor.saveSoon(); Editor.renderNodes(); } }, clipOptions(n.clipId))
        ]));
        box.appendChild(numInput('Tốc độ', n.speed || 1, function (v) { n.speed = v || 1; Editor.saveSoon(); }));
        box.appendChild(el('label', { class: 'ag-field ag-check' }, [
          el('input', {
            type: 'checkbox', checked: n.loop !== false ? 'checked' : undefined,
            onchange: function (ev) { n.loop = ev.target.checked; Editor.saveSoon(); }
          }),
          el('span', { text: 'Lặp (loop)' })
        ]));
        if (Editor.mode === 'statemachine') {
          box.appendChild(el('button', {
            class: 'ag-btn', text: '★ Đặt làm entry',
            onclick: function () { SM().setEntry(g, n.id); Editor.saveSoon(); Editor.renderAll(); }
          }));
          box.appendChild(el('button', {
            class: 'ag-btn', text: '▶ Phát state này',
            onclick: function () {
              var r = Editor.playPreview();
              if (r.ok) { var rt = runtime(); if (rt && rt.forceState) rt.forceState(n.id); }
              else notify('warning', 'Anim Graph', r.error);
            }
          }));
          box.appendChild(el('label', { class: 'ag-field ag-check' }, [
            el('input', {
              type: 'checkbox', checked: n.isExit ? 'checked' : undefined,
              onchange: function (ev) { n.isExit = ev.target.checked; Editor.saveSoon(); Editor.renderNodes(); }
            }),
            el('span', { text: 'Là Exit state (sub-machine: quay về máy cha)' })
          ]));
          var onEnterMsg = (n.onEnter || []).find(function (a) { return a.type === 'notify'; });
          var onExitMsg = (n.onExit || []).find(function (a) { return a.type === 'notify'; });
          box.appendChild(el('label', { class: 'ag-field' }, [
            el('span', { text: 'Thông báo khi vào state (onEnter)' }),
            el('input', {
              type: 'text', value: onEnterMsg ? (onEnterMsg.message || '') : '', placeholder: 'vd: Đã vào Attack',
              onchange: function (ev) {
                n.onEnter = ev.target.value ? [{ type: 'notify', message: ev.target.value }] : [];
                Editor.saveSoon();
              }
            })
          ]));
          box.appendChild(el('label', { class: 'ag-field' }, [
            el('span', { text: 'Thông báo khi rời state (onExit)' }),
            el('input', {
              type: 'text', value: onExitMsg ? (onExitMsg.message || '') : '', placeholder: 'vd: Rời Attack',
              onchange: function (ev) {
                n.onExit = ev.target.value ? [{ type: 'notify', message: ev.target.value }] : [];
                Editor.saveSoon();
              }
            })
          ]));
          if (n.subMachine) {
            box.appendChild(el('p', { class: 'ag-hint', text: 'Sub-machine: ' + (n.subMachine.states || []).length + ' state.' }));
            box.appendChild(el('button', {
              class: 'ag-btn', text: 'Gỡ sub-machine',
              onclick: function () { Editor.pushUndo(); n.subMachine = null; Editor.saveSoon(); Editor.renderAll(); }
            }));
          } else {
            box.appendChild(el('button', {
              class: 'ag-btn', text: '＋ Tạo sub-machine (2 state)',
              onclick: function () {
                Editor.pushUndo();
                var sub = SM().createStateMachine(n.name + ' (sub)');
                BT().addParameter(sub, { name: 'done', type: 'trigger' });
                var a = SM().addState(sub, { name: 'SubIdle', clipId: n.clipId, x: 40, y: 60 }).state;
                var b = SM().addState(sub, { name: 'SubExit', clipId: null, x: 270, y: 60, isExit: true }).state;
                SM().setEntry(sub, a.id);
                SM().addTransition(sub, { from: a.id, to: b.id, conditions: [{ param: 'done', op: '==', value: true }], duration: 0.2 });
                n.subMachine = sub;
                Editor.saveSoon();
                Editor.renderAll();
              }
            }));
          }
        }
      }
      if (Editor.mode === 'blendtree' && n.type === 'blend1d') {
        box.appendChild(el('label', { class: 'ag-field' }, [
          el('span', { text: 'Parameter' }),
          el('select', { onchange: function (ev) { n.parameter = ev.target.value || null; Editor.saveSoon(); Editor.renderNodes(); } }, paramOptions(n.parameter))
        ]));
        n.children.forEach(function (ch, i) {
          var child = BT().getNode(g, ch.nodeId);
          box.appendChild(numInput('Ngưỡng #' + (i + 1) + ' (' + (child ? child.name : '?') + ')', ch.threshold, function (v) { ch.threshold = v; Editor.saveSoon(); Editor.renderNodes(); }));
        });
      }
      if (Editor.mode === 'blendtree' && n.type === 'blend2d') {
        box.appendChild(el('label', { class: 'ag-field' }, [
          el('span', { text: 'Parameter X' }),
          el('select', { onchange: function (ev) { n.parameterX = ev.target.value || null; Editor.saveSoon(); } }, paramOptions(n.parameterX))
        ]));
        box.appendChild(el('label', { class: 'ag-field' }, [
          el('span', { text: 'Parameter Y' }),
          el('select', { onchange: function (ev) { n.parameterY = ev.target.value || null; Editor.saveSoon(); } }, paramOptions(n.parameterY))
        ]));
        n.children.forEach(function (ch, i) {
          var child = BT().getNode(g, ch.nodeId);
          box.appendChild(el('div', { class: 'ag-row' }, [
            el('span', { text: 'Con #' + (i + 1) + ' (' + (child ? child.name : '?') + ')' }),
            numInput('x', ch.x || 0, function (v) { ch.x = v; Editor.saveSoon(); }),
            numInput('y', ch.y || 0, function (v) { ch.y = v; Editor.saveSoon(); })
          ]));
        });
      }
      if (Editor.mode === 'blendtree' && n.type === 'add') {
        box.appendChild(el('label', { class: 'ag-field' }, [
          el('span', { text: 'Kiểu overlay' }),
          el('select', { onchange: function (ev) { n.mask = ev.target.value; Editor.saveSoon(); Editor.renderNodes(); } }, [
            el('option', { value: 'upper', selected: n.mask === 'upper' ? 'selected' : undefined }, ['Mask thân trên']),
            el('option', { value: 'lower', selected: n.mask === 'lower' ? 'selected' : undefined }, ['Mask thân dưới']),
            el('option', { value: 'additive', selected: n.mask === 'additive' ? 'selected' : undefined }, ['Additive'])
          ])
        ]));
        box.appendChild(numInput('Trọng số overlay', n.weight, function (v) { n.weight = Math.max(0, Math.min(1, v)); Editor.saveSoon(); }));
        box.appendChild(el('p', { class: 'ag-hint', text: 'Con 1 = base, con 2 = overlay. Nối dây theo thứ tự đó.' }));
      }
      if (Editor.mode === 'blendtree' && n.type === 'random') {
        box.appendChild(el('p', { class: 'ag-hint', text: 'Đang chọn con #' + (n.picked || 0) + ' trong ' + n.children.length + ' con.' }));
        box.appendChild(el('button', {
          class: 'ag-btn', text: '🎲 Chọn lại ngẫu nhiên',
          onclick: function () { BT().reroll(g, n.id); Editor.saveSoon(); Editor.renderAll(); }
        }));
      }
      if (Editor.mode === 'blendtree' && n.type === 'mirror') {
        box.appendChild(el('p', { class: 'ag-hint', text: 'Lật clip con qua Animator.mirrorClip (trái ↔ phải). Nối 1 clip con duy nhất.' }));
      }
      if (Editor.mode === 'blendtree' && n.type === 'timescale') {
        box.appendChild(numInput('Hệ số nhân tốc độ', n.timeScale || 1, function (v) { n.timeScale = v || 1; Editor.saveSoon(); }));
        box.appendChild(el('label', { class: 'ag-field' }, [
          el('span', { text: 'Parameter tốc độ (tùy chọn, ghi đè hệ số)' }),
          el('select', { onchange: function (ev) { n.parameter = ev.target.value || null; Editor.saveSoon(); } }, paramOptions(n.parameter))
        ]));
      }
      if (Editor.mode === 'blendtree' && n.type === 'layer') {
        box.appendChild(el('label', { class: 'ag-field' }, [
          el('span', { text: 'Kiểu overlay' }),
          el('select', { onchange: function (ev) { n.mask = ev.target.value; Editor.saveSoon(); Editor.renderNodes(); } }, [
            el('option', { value: 'upper', selected: n.mask === 'upper' ? 'selected' : undefined }, ['Mask thân trên']),
            el('option', { value: 'lower', selected: n.mask === 'lower' ? 'selected' : undefined }, ['Mask thân dưới']),
            el('option', { value: 'additive', selected: n.mask === 'additive' ? 'selected' : undefined }, ['Additive'])
          ])
        ]));
        n.children.forEach(function (ch, i) {
          var child = BT().getNode(g, ch.nodeId);
          if (i === 0) box.appendChild(el('p', { class: 'ag-hint', text: 'Con #1 (' + (child ? child.name : '?') + ') = base.' }));
          else box.appendChild(numInput('Trọng số overlay #' + i + ' (' + (child ? child.name : '?') + ')', ch.weight === undefined ? 1 : ch.weight, function (v) { ch.weight = Math.max(0, Math.min(1, v)); Editor.saveSoon(); }));
        });
        box.appendChild(el('p', { class: 'ag-hint', text: 'Nối con đầu = base, các con sau = overlay (tối đa 4 overlay).' }));
      }
      box.appendChild(el('button', {
        class: 'ag-btn', text: '⧉ Nhân bản node này',
        onclick: function () { var r = Editor.duplicateSelected(); if (!r.ok) notify('warning', 'Anim Graph', r.error); }
      }));
      if (Editor.mode === 'blendtree') {
        box.appendChild(el('button', {
          class: 'ag-btn', text: '★ Đặt làm root',
          onclick: function () { BT().setRoot(g, n.id); Editor.saveSoon(); Editor.renderAll(); }
        }));
      }
      box.appendChild(el('button', {
        class: 'ag-btn ag-danger', text: 'Xóa node này',
        onclick: function () {
          var r;
          Editor.pushUndo();
          if (Editor.mode === 'statemachine') r = SM().removeState(g, n.id);
          else r = BT().removeNode(g, n.id);
          if (!r.ok) notify('warning', 'Anim Graph', r.error);
          Editor.selected = null;
          Editor.saveSoon();
          Editor.renderAll();
        }
      }));
      return;
    }
    if (sel.kind === 'transition') {
      var t = (g.transitions || []).find(function (x) { return x.id === sel.id; });
      if (!t) { Editor.selected = null; Editor.renderProps(); return; }
      var fromN = t.from === '*' ? { name: 'Any State' } : (g.states || []).find(function (s) { return s.id === t.from; }) || { name: '?' };
      var toN = (g.states || []).find(function (s) { return s.id === t.to; }) || { name: '?' };
      box.appendChild(el('div', { class: 'ag-prop-title', text: 'Transition: ' + fromN.name + ' → ' + toN.name }));
      box.appendChild(numInput('Thời gian chuyển (s)', t.duration, function (v) { t.duration = Math.max(0, v || 0); Editor.saveSoon(); }));
      box.appendChild(el('label', { class: 'ag-field ag-check' }, [
        el('input', {
          type: 'checkbox', checked: t.hasExitTime ? 'checked' : undefined,
          onchange: function (ev) { t.hasExitTime = ev.target.checked; Editor.saveSoon(); Editor.renderProps(); }
        }),
        el('span', { text: 'Có exit time' })
      ]));
      if (t.hasExitTime) box.appendChild(numInput('Exit time (0–1)', t.exitTime, function (v) { t.exitTime = Math.max(0, Math.min(1, v)); Editor.saveSoon(); }, '0.05'));
      box.appendChild(el('label', { class: 'ag-field ag-check' }, [
        el('input', {
          type: 'checkbox', checked: t.interrupt ? 'checked' : undefined,
          onchange: function (ev) { t.interrupt = ev.target.checked; Editor.saveSoon(); }
        }),
        el('span', { text: 'Interrupt — cắt ngang crossfade đang chạy' })
      ]));
      box.appendChild(el('h4', { text: 'Điều kiện (AND)' }));
      (t.conditions || []).forEach(function (c, i) {
        box.appendChild(el('div', { class: 'ag-cond' }, [
          el('select', { onchange: function (ev) { c.param = ev.target.value; Editor.saveSoon(); } }, paramOptions(c.param)),
          el('select', { onchange: function (ev) { c.op = ev.target.value; Editor.saveSoon(); } },
            ['>', '<', '==', '>=', '<=', '!='].map(function (op) {
              return el('option', { value: op, selected: c.op === op ? 'selected' : undefined }, [op]);
            })),
          el('input', { type: 'number', step: '0.1', value: String(c.value), onchange: function (ev) { c.value = parseFloat(ev.target.value); Editor.saveSoon(); } }),
          el('button', { class: 'ag-btn ag-small', text: '✕', onclick: function () { t.conditions.splice(i, 1); Editor.saveSoon(); Editor.renderProps(); } })
        ]));
      });
      box.appendChild(el('button', {
        class: 'ag-btn', text: '+ Thêm điều kiện',
        onclick: function () { t.conditions.push({ param: (g.parameters[0] || {}).name || 'speed', op: '>', value: 0.5 }); Editor.saveSoon(); Editor.renderProps(); }
      }));
      box.appendChild(el('button', {
        class: 'ag-btn ag-danger', text: 'Xóa transition này',
        onclick: function () {
          SM().removeTransition(g, t.id);
          Editor.selected = null;
          Editor.saveSoon();
          Editor.renderAll();
        }
      }));
      return;
    }
    box.appendChild(Editor._paramEditor());
  };

  Editor._paramEditor = function () {
    var g = graph();
    var B = BT();
    var wrap = el('div', { class: 'ag-params' });
    wrap.appendChild(el('h4', { text: 'Parameters' }));
    (g.parameters || []).forEach(function (p, i) {
      var row = el('div', { class: 'ag-param-row' }, [
        el('span', { text: p.name + ' (' + p.type + ')' }),
        el('button', { class: 'ag-btn ag-small', text: '✕', onclick: function () { B.removeParameter(g, p.name); Editor.saveSoon(); Editor.renderAll(); } })
      ]);
      wrap.appendChild(row);
      void i;
    });
    var nameInput = el('input', { type: 'text', placeholder: 'tên parameter mới (vd speed)' });
    var typeSel = el('select', {}, [
      el('option', { value: 'float' }, ['float']),
      el('option', { value: 'int' }, ['int']),
      el('option', { value: 'bool' }, ['bool']),
      el('option', { value: 'trigger' }, ['trigger'])
    ]);
    wrap.appendChild(el('div', { class: 'ag-row' }, [nameInput, typeSel,
      el('button', {
        class: 'ag-btn', text: '+ Thêm',
        onclick: function () {
          var r = B.addParameter(g, { name: nameInput.value, type: typeSel.value, defaultValue: 0, min: 0, max: 1 });
          if (!r.ok) notify('warning', 'Anim Graph', r.error);
          Editor.saveSoon();
          Editor.renderAll();
        }
      })]));
    return wrap;
  };

  /* ================= THANH PARAMETER (preview trực tiếp) ================= */

  Editor.renderParamBar = function () {
    var bar = Editor._paramBar;
    if (!bar) return;
    bar.innerHTML = '';
    var g = graph();
    bar.appendChild(el('span', { class: 'ag-param-title', text: 'Preview:' }));
    if (!(g.parameters || []).length) {
      bar.appendChild(el('span', { class: 'ag-hint', text: 'Chưa có parameter — thêm ở panel thuộc tính.' }));
      return;
    }
    (g.parameters || []).forEach(function (p) {
      if (p.type === 'float' || p.type === 'int') {
        var val = el('span', { class: 'ag-param-val', text: String(p.value) });
        bar.appendChild(el('label', { class: 'ag-slider' }, [
          el('span', { text: p.name }),
          el('input', {
            type: 'range', min: String(p.min), max: String(p.max),
            step: p.type === 'int' ? '1' : '0.01', value: String(p.value),
            oninput: function (ev) { Editor.setParamLive(p.name, parseFloat(ev.target.value)); val.textContent = ev.target.value; Editor.renderNodes(); }
          }),
          val
        ]));
      } else if (p.type === 'bool') {
        bar.appendChild(el('button', {
          class: 'ag-btn' + (p.value ? ' ag-active' : ''), text: p.name + ': ' + (p.value ? 'ON' : 'OFF'),
          onclick: function (ev) { Editor.setParamLive(p.name, !p.value); Editor.renderParamBar(); }
        }));
      } else if (p.type === 'trigger') {
        bar.appendChild(el('button', {
          class: 'ag-btn', text: '⚡ ' + p.name,
          onclick: function () { Editor.setParamLive(p.name, true); }
        }));
      }
    });
  };

  Editor.updateStatus = function () {
    var st = Editor._status;
    if (!st) return;
    var g = graph();
    var B = BT(), S = SM();
    var v = Editor.mode === 'statemachine' ? S.validate(g, B.resolveClip) : B.validate(g, B.resolveClip);
    var rt = runtime();
    var extra = '';
    if (Editor.playing && rt) {
      if (Editor.mode === 'statemachine' && rt.currentState) {
        var cur = rt.currentState();
        extra = ' · đang phát: ' + (cur ? cur.name : '?') + ' (' + (rt.stateTime || 0).toFixed(2) + 's)';
      } else if (rt.currentClipIds) {
        extra = ' · đang phát: ' + (rt.currentClipIds() || []).join(', ');
      }
    }
    /* Phát qua Animator: hiện state/clip + tiến độ transition. */
    if (Editor.playing && Editor._animDrive) {
      var dr = Editor._animDrive;
      if (dr.mode === 'statemachine') {
        var cs = SM().getState(g, dr.currentId);
        extra = ' · đang phát (Animator): ' + (cs ? cs.name : '?') + ' (' + (dr.stateTime || 0).toFixed(2) + 's)';
        if (dr.inTransition) {
          var pct = dr.inTransition.duration > 0 ? Math.round(dr.inTransition.t / dr.inTransition.duration * 100) : 100;
          var fromS = SM().getState(g, dr.inTransition.from);
          var toS = SM().getState(g, dr.inTransition.to);
          extra += ' · đang chuyển ' + (fromS ? fromS.name : '?') + ' → ' + (toS ? toS.name : '?') + ' ' + pct + '%';
        }
      } else if (dr.weights) {
        var dom = Object.keys(dr.weights).filter(function (id) { return dr.weights[id] > 0.01; });
        extra = ' · đang phát (Animator): ' + dom.join(', ');
      }
    } else if (Editor.playing && Editor.mode === 'statemachine' && rt && rt.inTransition) {
      /* Runtime riêng: transition đang chạy + tiến độ %. */
      var it = rt.inTransition;
      var pct2 = it.duration > 0 ? Math.round(it.t / it.duration * 100) : 100;
      var fS = SM().getState(g, it.from);
      var tS = SM().getState(g, it.to);
      extra += ' · đang chuyển ' + (fS ? fS.name : '?') + ' → ' + (tS ? tS.name : '?') + ' ' + pct2 + '%';
    }
    st.textContent = (v.ok ? '✓ Graph hợp lệ' : '⚠ ' + v.errors.join(' ')) +
      (Editor.pendingFrom ? ' · Đang nối dây — bấm cổng IN của node đích' : '') + extra;
    st.className = 'ag-status' + (v.ok ? '' : ' ag-status-warn');
    /* Panel validation chi tiết + highlight dây/node đang phát. */
    Editor.renderIssues();
    Editor.updatePlaybackHighlight();
  };

  /* ================= SM2: UNDO/REDO RIÊNG TRONG EDITOR =================
     Snapshot = JSON cả 2 graph + comments. Gọi historyPush() TRƯỚC
     mỗi thay đổi cấu trúc (nút bấm, nối dây, xóa, kéo xong, paste,
     auto-layout, import, demo). Các ô input trong panel thuộc tính
     snapshot ở onfocus (trước khi sửa). Không dùng History toàn cục
     để tránh lẫn undo của studio. */
  Editor.historySnapshot = function () {
    var B = BT(), S = SM();
    try {
      /* Format snapshot THỐNG NHẤT với pushUndo(): {blendtree,
         statemachine, comments} — để cả undo() gốc lẫn historyRestore
         đều đọc được cùng 1 stack _undoStack. */
      return JSON.stringify({
        blendtree: B && Editor.btGraph ? B.serialize(Editor.btGraph) : null,
        statemachine: S && Editor.smGraph ? S.serialize(Editor.smGraph) : null,
        comments: Editor.comments
      });
    } catch (e) { return null; }
  };

  /* Ghi snapshot hiện tại vào _undoStack (không đụng redo, không gọi
     pushUndo — pushUndo delegate sang historyPush nên gọi lại sẽ đệ
     quy vô hạn). */
  Editor._pushUndoSnapshot = function () {
    var snap = Editor.historySnapshot();
    if (!snap) return;
    if (!Editor._undoStack) Editor._undoStack = [];
    if (Editor._undoStack.length && Editor._undoStack[Editor._undoStack.length - 1] === snap) return; /* không đổi */
    Editor._undoStack.push(snap);
    if (Editor._undoStack.length > HISTORY_MAX) Editor._undoStack.shift();
  };

  Editor.historyPush = function () {
    Editor._pushUndoSnapshot();
    Editor.history.redo.length = 0;
  };

  Editor.historyRestore = function (snap) {
    var B = BT(), S = SM();
    var data;
    try { data = JSON.parse(snap); } catch (e) { return { ok: false, error: 'Snapshot lỗi.' }; }
    /* Nhận cả 2 kiểu key (blendtree/statemachine chuẩn; bt/sm cũ). */
    var btData = data.blendtree || data.bt;
    var smData = data.statemachine || data.sm;
    if (btData && B) { var r1 = B.deserialize(btData); if (r1.ok) Editor.btGraph = r1.graph; }
    if (smData && S) { var r2 = S.deserialize(smData); if (r2.ok) Editor.smGraph = r2.graph; }
    if (data.comments) Editor.comments = data.comments;
    Editor.selected = null;
    Editor.pendingFrom = null;
    Editor.saveSoon();
    Editor.renderAll();
    return { ok: true };
  };

  Editor.historyUndo = function () {
    if (Editor._undoing) return { ok: false, error: 'Đang undo.' };
    Editor._undoing = true;
    var cur = Editor.historySnapshot();
    var r = (typeof Editor.undo === 'function') ? Editor.undo() : { ok: false, error: 'Thiếu Editor.undo.' };
    Editor._undoing = false;
    if (r.ok && cur) Editor.history.redo.push(cur);
    return r;
  };

  Editor.historyRedo = function () {
    var h = Editor.history;
    if (!h.redo.length) return { ok: false, error: 'Không còn gì để redo.' };
    var snap = h.redo.pop();
    /* Lưu trạng thái hiện tại vào undo stack NHƯNG không xóa redo
       còn lại (dùng _pushUndoSnapshot, không qua historyPush). */
    Editor._pushUndoSnapshot();
    return Editor.historyRestore(snap);
  };

  /* ================= SM2: COPY / PASTE / NHÂN BẢN ================= */

  function newUid(prefix) {
    return (prefix || 'n') + '_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6);
  }

  Editor.copySelected = function () {
    var sel = Editor.selected;
    if (!sel || sel.kind !== 'node') return { ok: false, error: 'Chọn 1 node trước rồi copy.' };
    var g = graph();
    var src = Editor.mode === 'statemachine'
      ? (g.states || []).find(function (s) { return s.id === sel.id; })
      : (g.nodes || []).find(function (n) { return n.id === sel.id; });
    if (!src) return { ok: false, error: 'Không tìm thấy node.' };
    var nodes = [JSON.parse(JSON.stringify(src))];
    var conns = [];
    if (Editor.mode === 'blendtree') {
      /* Giữ kết nối nội bộ: chỉ nối tới node cũng nằm trong clipboard
         (copy 1 node → không có kết nối nội bộ; nhân bản cây thì có). */
      (g.connections || []).forEach(function (c) {
        if (nodes.some(function (n) { return n.id === c.from; }) && nodes.some(function (n) { return n.id === c.to; })) {
          conns.push({ from: c.from, to: c.to });
        }
      });
    }
    Editor.clipboard = { mode: Editor.mode, nodes: nodes, connections: conns };
    return { ok: true, count: nodes.length };
  };

  Editor.pasteClipboard = function () {
    var cb = Editor.clipboard;
    if (!cb || !cb.nodes || !cb.nodes.length) return { ok: false, error: 'Clipboard trống — copy 1 node trước (Ctrl+C).' };
    if (cb.mode !== Editor.mode) return { ok: false, error: 'Clipboard là ' + (cb.mode === 'statemachine' ? 'State' : 'Blend Tree') + ' — chuyển đúng tab rồi paste.' };
    Editor.historyPush();
    var B = BT(), S = SM();
    var g = graph();
    var idMap = {};
    var pasted = [];
    cb.nodes.forEach(function (n0) {
      var n = JSON.parse(JSON.stringify(n0));
      idMap[n0.id] = newUid(Editor.mode === 'statemachine' ? 'state' : 'node');
      n.id = idMap[n0.id];
      n.x = (n.x || 0) + 40; n.y = (n.y || 0) + 40;
      n.name = (n.name || 'Node') + ' copy';
      if (Editor.mode === 'statemachine') {
        if (g.states.some(function (s) { return s.name === n.name; })) n.name = n.name + ' ' + (g.states.length + 1);
        g.states.push(n);
      } else {
        g.nodes.push(n);
        if (!g.rootId) g.rootId = n.id;
      }
      pasted.push(n);
    });
    if (Editor.mode === 'blendtree') {
      /* Remap children[] sang id mới TRƯỚC (children đã copy theo
         node gốc còn giữ id cũ) — rồi mới khôi phục connections. */
      pasted.forEach(function (n) {
        (n.children || []).forEach(function (ch) { if (idMap[ch.nodeId]) ch.nodeId = idMap[ch.nodeId]; });
      });
      cb.connections.forEach(function (c) {
        var from = idMap[c.from], to = idMap[c.to];
        if (!from || !to) return;
        var parent = B.getNode(g, from);
        if (!parent) return;
        /* Parent đã có child này qua children[] remap → chỉ bổ sung
           bản ghi connections (để vẽ dây), không connect lại. */
        if (parent.children.some(function (ch) { return ch.nodeId === to; })) {
          if (!g.connections.some(function (x) { return x.from === from && x.to === to; })) {
            g.connections.push({ from: from, to: to });
          }
        } else {
          B.connect(g, from, to, {});
        }
      });
    }
    Editor.selected = { kind: 'node', id: pasted[0].id };
    Editor.saveSoon();
    Editor.renderAll();
    return { ok: true, count: pasted.length };
  };

  /* Nhân bản node đang chọn. Blend Tree: nhân bản CẢ CÂY CON (node +
     mọi descendant + kết nối nội bộ). State Machine: nhân bản 1 state
     (transition không copy theo — đích chưa chắc đã paste cùng). */
  Editor.duplicateSelected = function () {
    var sel = Editor.selected;
    if (!sel || sel.kind !== 'node') return { ok: false, error: 'Chọn 1 node/state trước rồi nhân bản.' };
    var g = graph();
    if (Editor.mode === 'statemachine') {
      var st = (g.states || []).find(function (s) { return s.id === sel.id; });
      if (!st) return { ok: false, error: 'Không tìm thấy state.' };
      Editor.clipboard = { mode: 'statemachine', nodes: [JSON.parse(JSON.stringify(st))], connections: [] };
      return Editor.pasteClipboard();
    }
    var B = BT();
    var root = B.getNode(g, sel.id);
    if (!root) return { ok: false, error: 'Không tìm thấy node.' };
    /* Thu thập cây con (DFS theo children). */
    var nodes = [];
    var seen = {};
    (function walk(n) {
      if (!n || seen[n.id]) return; seen[n.id] = true;
      nodes.push(JSON.parse(JSON.stringify(n)));
      (n.children || []).forEach(function (ch) { walk(B.getNode(g, ch.nodeId)); });
    })(root);
    var conns = (g.connections || []).filter(function (c) { return seen[c.from] && seen[c.to]; })
      .map(function (c) { return { from: c.from, to: c.to }; });
    Editor.clipboard = { mode: 'blendtree', nodes: nodes, connections: conns };
    return Editor.pasteClipboard();
  };

  /* ================= SM2: AUTO-LAYOUT (thuần, test được) ============
     computeLayout(items, edges, startId): BFS theo tầng từ startId,
     x = tầng * 280, y = thứ tự trong tầng * 150. Node ngoài tầm với
     (không nối từ start) xếp tầng cuối. Trả {id:{x,y}}. */
  Editor.computeLayout = function (items, edges, startId) {
    var byId = {};
    items.forEach(function (n) { byId[n.id] = n; });
    var adj = {};
    edges.forEach(function (e) {
      if (!byId[e.from] || !byId[e.to]) return;
      (adj[e.from] = adj[e.from] || []).push(e.to);
    });
    var layer = {};
    var queue = [];
    if (startId && byId[startId]) { layer[startId] = 0; queue.push(startId); }
    else if (items.length) { layer[items[0].id] = 0; queue.push(items[0].id); }
    while (queue.length) {
      var cur = queue.shift();
      (adj[cur] || []).forEach(function (nx) {
        if (layer[nx] === undefined) { layer[nx] = layer[cur] + 1; queue.push(nx); }
      });
    }
    var maxLayer = 0;
    items.forEach(function (n) {
      if (layer[n.id] === undefined) { layer[n.id] = 999; }
      if (layer[n.id] !== 999 && layer[n.id] > maxLayer) maxLayer = layer[n.id];
    });
    items.forEach(function (n) { if (layer[n.id] === 999) layer[n.id] = maxLayer + 1; });
    var perLayer = {};
    var out = {};
    items.forEach(function (n) {
      var L = layer[n.id];
      var idx = perLayer[L] || 0; perLayer[L] = idx + 1;
      out[n.id] = { x: 80 + L * 280, y: 80 + idx * 150 };
    });
    return out;
  };

  Editor.autoLayout = function () {
    var g = graph();
    Editor.historyPush();
    var pos;
    if (Editor.mode === 'statemachine') {
      pos = Editor.computeLayout(g.states || [], (g.transitions || []).map(function (t) {
        return { from: t.from === '*' ? null : t.from, to: t.to };
      }).filter(function (e) { return e.from; }), g.entryStateId);
      (g.states || []).forEach(function (s) { if (pos[s.id]) { s.x = pos[s.id].x; s.y = pos[s.id].y; } });
    } else {
      /* Blend Tree: root tầng 0, con của root tầng 1... edge đi từ
         cha (blend) xuống con nên dùng connections gốc (from=cha). */
      pos = Editor.computeLayout(g.nodes || [], g.connections || [], g.rootId);
      (g.nodes || []).forEach(function (n) { if (pos[n.id]) { n.x = pos[n.id].x; n.y = pos[n.id].y; } });
    }
    Editor.saveSoon();
    Editor.renderAll();
    return { ok: true };
  };

  /* ================= SM2: VALIDATION CHI TIẾT =================
     Trả issues [{level:'error'|'warning', message, nodeId, kind}].
     nodeId = null khi lỗi toàn graph. Dùng để vẽ panel + bấm nhảy tới. */
  Editor.validateDetailed = function () {
    var g = graph();
    var B = BT(), S = SM();
    var issues = [];
    function err(message, nodeId, kind) { issues.push({ level: 'error', message: message, nodeId: nodeId || null, kind: kind || '' }); }
    function warn(message, nodeId, kind) { issues.push({ level: 'warning', message: message, nodeId: nodeId || null, kind: kind || '' }); }
    if (Editor.mode === 'statemachine') {
      var states = g.states || [];
      if (!states.length) { err('State Machine rỗng — thêm state rồi gán clip.', null, 'empty'); return { issues: issues }; }
      if (!S.getState(g, g.entryStateId)) err('Chưa chọn state mặc định (entry).', null, 'entry');
      var incoming = {};
      (g.transitions || []).forEach(function (t) { if (t.from !== '*') incoming[t.to] = (incoming[t.to] || 0) + 1; });
      states.forEach(function (s) {
        if (!s.clipId) err('State "' + s.name + '" chưa gán clip.', s.id, 'clip');
        else if (B && !B.resolveClip(s.clipId)) err('State "' + s.name + '": clip "' + s.clipId + '" không tìm thấy.', s.id, 'clip');
        if (s.id !== g.entryStateId && !incoming[s.id]) warn('State "' + s.name + '" mồ côi — không có transition nào đi vào.', s.id, 'orphan');
      });
      (g.transitions || []).forEach(function (t) {
        var toN = S.getState(g, t.to);
        var fromN = t.from === '*' ? null : S.getState(g, t.from);
        if (!toN) { err('Transition tới state không tồn tại.', null, 'transition'); return; }
        if (t.from !== '*' && !fromN) { err('Transition từ state không tồn tại.', null, 'transition'); return; }
        if (!(t.conditions || []).length) warn('Transition ' + (fromN ? '"' + fromN.name + '"' : 'Any State') + ' → "' + toN.name + '" thiếu điều kiện (luôn đúng).', toN.id, 'transition');
        (t.conditions || []).forEach(function (c) {
          if (!B.getParameter(g, c.param)) err('Transition → "' + toN.name + '": parameter "' + c.param + '" chưa khai báo.', toN.id, 'param');
        });
      });
    } else {
      var nodes = g.nodes || [];
      if (!nodes.length) { err('Graph rỗng — thêm node Clip/Blend rồi nối dây.', null, 'empty'); return { issues: issues }; }
      if (!B.getNode(g, g.rootId)) err('Chưa chọn node root.', null, 'root');
      /* Node tới được từ root (theo children). */
      var reach = {};
      (function walk(id) {
        if (!id || reach[id]) return; reach[id] = true;
        var n = B.getNode(g, id);
        if (n) (n.children || []).forEach(function (ch) { walk(ch.nodeId); });
      })(g.rootId);
      nodes.forEach(function (n) {
        if (n.type === 'clip') {
          if (!n.clipId) err('Node Clip "' + n.name + '" chưa chọn clip.', n.id, 'clip');
          else if (!B.resolveClip(n.clipId)) err('Node "' + n.name + '": clip "' + n.clipId + '" không tìm thấy.', n.id, 'clip');
        } else if (n.type === 'blend1d' || n.type === 'blend2d' || n.type === 'add' ||
          n.type === 'blendadditive' || n.type === 'random' || n.type === 'layer' || n.type === 'layered') {
          /* Số con tối thiểu theo runtime (SM1): blend/add/random/
             layer cần ≥ 2; mirror/timescale/sequence cần ≥ 1. */
          if ((n.children || []).length < 2) err('Node ' + nodeTypeInfo(n.type).label + ' "' + n.name + '" cần ≥ 2 con (đang có ' + (n.children || []).length + ').', n.id, 'children');
        } else if (n.type === 'mirror' || n.type === 'timescale' || n.type === 'sequence') {
          if ((n.children || []).length < 1) err('Node ' + nodeTypeInfo(n.type).label + ' "' + n.name + '" cần ≥ 1 con.', n.id, 'children');
        }
        [n.parameter, n.parameterX, n.parameterY, n.triggerParam].forEach(function (pn) {
          if (pn && !B.getParameter(g, pn)) err('Node "' + n.name + '" dùng parameter "' + pn + '" chưa khai báo.', n.id, 'param');
        });
        if (n.id !== g.rootId && !reach[n.id]) warn('Node "' + n.name + '" mồ côi — không nối tới root.', n.id, 'orphan');
      });
    }
    return { issues: issues };
  };

  /* ================= SM2: TÌM KIẾM + NHẢY TỚI ================= */

  Editor.centerOnNode = function (nodeId) {
    var g = graph();
    var n = Editor.mode === 'statemachine'
      ? (g.states || []).find(function (s) { return s.id === nodeId; })
      : (g.nodes || []).find(function (x) { return x.id === nodeId; });
    if (!n) return { ok: false, error: 'Không có node.' };
    Editor.centerOnWorld((n.x || 0) + NODE_W / 2, (n.y || 0) + 48);
    Editor.selected = { kind: 'node', id: nodeId };
    Editor.renderAll();
    return { ok: true };
  };

  Editor.centerOnWorld = function (wx, wy) {
    var cv = Editor._canvas;
    if (!cv) return;
    var w = cv.clientWidth || 800, h = cv.clientHeight || 400;
    Editor.pan.x = w / 2 - wx * Editor.zoom;
    Editor.pan.y = h / 2 - wy * Editor.zoom;
    Editor.applyTransform();
    Editor.updateMinimap();
  };

  /* Thu toàn bộ graph (node + ghi chú) vừa khung nhìn. */
  Editor.fitView = function () {
    var g = graph();
    var items = Editor.mode === 'statemachine' ? (g.states || []) : (g.nodes || []);
    var all = items.concat(currentComments());
    if (!all.length) return { ok: false, error: 'Graph trống.' };
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    all.forEach(function (n) {
      minX = Math.min(minX, n.x || 0); minY = Math.min(minY, n.y || 0);
      maxX = Math.max(maxX, (n.x || 0) + NODE_W); maxY = Math.max(maxY, (n.y || 0) + 120);
    });
    var cv = Editor._canvas;
    var cw = (cv && cv.clientWidth) || 800, ch = (cv && cv.clientHeight) || 400;
    var zx = cw / Math.max(1, maxX - minX + 80), zy = ch / Math.max(1, maxY - minY + 80);
    Editor.zoom = Math.max(0.4, Math.min(1.5, Math.min(zx, zy)));
    Editor.centerOnWorld((minX + maxX) / 2, (minY + maxY) / 2);
    return { ok: true };
  };

  Editor.applySearch = function (q) {
    Editor.searchQuery = String(q || '').trim().toLowerCase();
    if (!Editor._world) return;
    var nodes = Editor._world.querySelectorAll('.ag-node');
    var firstMatch = null;
    nodes.forEach(function (box) {
      var id = box.dataset.nodeId;
      var g = graph();
      var n = Editor.mode === 'statemachine'
        ? (g.states || []).find(function (s) { return s.id === id; })
        : (g.nodes || []).find(function (x) { return x.id === id; });
      var name = (n && n.name ? n.name : '').toLowerCase();
      var match = !Editor.searchQuery || name.indexOf(Editor.searchQuery) >= 0;
      box.classList.toggle('ag-dim', !!Editor.searchQuery && !match);
      box.classList.toggle('ag-match', !!Editor.searchQuery && match);
      if (match && Editor.searchQuery && !firstMatch) firstMatch = id;
    });
    Editor._firstSearchMatch = firstMatch;
  };

  Editor.jumpToSearch = function () {
    if (Editor._firstSearchMatch) Editor.centerOnNode(Editor._firstSearchMatch);
  };

  /* ================= SM2: MINIMAP =================
     Bản đồ nhỏ góc canvas: node = chấm màu theo loại, khung trắng =
     vùng đang xem. Bấm vào minimap để nhảy tới điểm đó. */
  Editor.updateMinimap = function () {
    var mm = Editor._minimap;
    if (!mm || !Editor._canvas) return;
    var S = 160 / 4000; /* world 4000x3000 → 160x120 */
    var g = graph();
    var items = Editor.mode === 'statemachine' ? (g.states || []) : (g.nodes || []);
    var html = '';
    items.forEach(function (n) {
      var info = nodeTypeInfo(Editor.mode === 'statemachine' ? 'state' : n.type);
      html += '<div class="ag-mm-node" style="left:' + ((n.x || 0) * S) + 'px;top:' + ((n.y || 0) * S) +
        'px;width:' + Math.max(4, NODE_W * S) + 'px;height:6px;background:' + info.color + '"></div>';
    });
    /* Khung vùng đang xem (pan/zoom → world rect). */
    var cv = Editor._canvas;
    var vw = (cv.clientWidth || 800) / Editor.zoom, vh = (cv.clientHeight || 400) / Editor.zoom;
    var vx = -Editor.pan.x / Editor.zoom, vy = -Editor.pan.y / Editor.zoom;
    html += '<div class="ag-mm-view" style="left:' + (vx * S) + 'px;top:' + (vy * S) +
      'px;width:' + (vw * S) + 'px;height:' + (vh * S) + 'px"></div>';
    mm.innerHTML = html;
  };

  Editor.minimapJump = function (ev) {
    var mm = Editor._minimap;
    if (!mm) return;
    var r = mm.getBoundingClientRect();
    var S = 160 / 4000;
    var wx = (ev.clientX - r.left) / S, wy = (ev.clientY - r.top) / S;
    Editor.centerOnWorld(wx, wy);
  };

  /* ================= SM2: GHI CHÚ (COMMENT) TRÊN GRAPH =================
     Lưu trong Editor.comments[mode] + store entry; KHÔNG đưa vào
     runtime graph nên không ảnh hưởng validate/phát. */
  Editor.addComment = function (text, x, y) {
    var list = currentComments();
    var c = {
      id: newUid('comment'), text: text || 'Ghi chú mới — bấm đúp để sửa',
      x: x !== undefined ? x : 120, y: y !== undefined ? y : 120, w: 200, h: 64
    };
    list.push(c);
    Editor.saveSoon();
    Editor.renderAll();
    return { ok: true, comment: c };
  };

  Editor.removeComment = function (id) {
    var list = currentComments();
    var i = list.findIndex(function (c) { return c.id === id; });
    if (i < 0) return { ok: false, error: 'Không có ghi chú.' };
    Editor.historyPush();
    list.splice(i, 1);
    Editor.saveSoon();
    Editor.renderAll();
    return { ok: true };
  };

  Editor.renderComments = function () {
    var world = Editor._world;
    if (!world) return;
    currentComments().forEach(function (c) {
      var box = el('div', {
        class: 'ag-comment',
        style: { left: c.x + 'px', top: c.y + 'px', width: (c.w || 200) + 'px', minHeight: (c.h || 64) + 'px' }
      }, [
        el('div', {
          class: 'ag-comment-head',
          text: '✎ Ghi chú',
          onmousedown: function (ev) { Editor.startCommentDrag(ev, c); }
        }),
        el('div', {
          class: 'ag-comment-body', text: c.text,
          ondblclick: function (ev) {
            ev.stopPropagation();
            var ta = el('textarea', { class: 'ag-comment-edit', value: c.text });
            var body = ev.target;
            body.innerHTML = '';
            body.appendChild(ta);
            ta.focus();
            ta.addEventListener('blur', function () { c.text = ta.value; Editor.saveSoon(); Editor.renderAll(); });
            ta.addEventListener('keydown', function (ke) {
              if (ke.key === 'Enter' && !ke.shiftKey) { ke.preventDefault(); ta.blur(); }
              ke.stopPropagation();
            });
          }
        }),
        el('button', {
          class: 'ag-comment-del', text: '✕', title: 'Xóa ghi chú',
          onclick: function (ev) { ev.stopPropagation(); Editor.removeComment(c.id); }
        })
      ]);
      box.dataset.commentId = c.id;
      world.appendChild(box);
    });
  };

  Editor.startCommentDrag = function (ev, c) {
    ev.preventDefault(); ev.stopPropagation();
    Editor.historyPush();
    var startX = ev.clientX, startY = ev.clientY, ox = c.x, oy = c.y;
    function mv(e2) {
      c.x = Math.max(0, ox + (e2.clientX - startX) / Editor.zoom);
      c.y = Math.max(0, oy + (e2.clientY - startY) / Editor.zoom);
      var box = Editor._world && Editor._world.querySelector('[data-comment-id="' + c.id + '"]');
      if (box) { box.style.left = c.x + 'px'; box.style.top = c.y + 'px'; }
    }
    function up() {
      doc.removeEventListener('mousemove', mv);
      doc.removeEventListener('mouseup', up);
      Editor.saveSoon();
    }
    doc.addEventListener('mousemove', mv);
    doc.addEventListener('mouseup', up);
  };

  /* ================= SM2: PANEL VALIDATION ================= */

  Editor.renderIssues = function () {
    var box = Editor._issues;
    if (!box) return;
    var res = Editor.validateDetailed();
    Editor._lastIssues = res.issues;
    /* updateStatus chạy mỗi frame khi phát — chỉ vẽ lại khi danh
       sách lỗi thay đổi (so theo signature). */
    var sig = JSON.stringify(res.issues);
    if (sig === Editor._issuesSig) return;
    Editor._issuesSig = sig;
    box.innerHTML = '';
    var errs = res.issues.filter(function (i) { return i.level === 'error'; }).length;
    var warns = res.issues.filter(function (i) { return i.level === 'warning'; }).length;
    if (!res.issues.length) {
      box.appendChild(el('span', { class: 'ag-issue-ok', text: '✓ Graph hợp lệ — không có lỗi/cảnh báo.' }));
      return;
    }
    box.appendChild(el('span', { class: 'ag-issue-count', text: '⚠ ' + errs + ' lỗi · ' + warns + ' cảnh báo — bấm để nhảy tới node:' }));
    res.issues.forEach(function (iss) {
      box.appendChild(el('button', {
        class: 'ag-issue ag-issue-' + iss.level,
        text: (iss.level === 'error' ? '✕ ' : '⚠ ') + iss.message,
        onclick: function () {
          if (iss.nodeId) Editor.centerOnNode(iss.nodeId);
          else notify('info', 'Anim Graph', iss.message);
        }
      }));
    });
  };

  /* ================= SM2: NHIỀU GRAPH + MAPPING NHÂN VẬT ================= */

  /* characterId: Models.currentId → State.selectionId (uuid object
     đang chọn) → uuid/tên target. Mapping lưu trong store:
     charMap[characterId] = {blendtree: entryId, statemachine: entryId}. */
  Editor.currentCharacterId = function () {
    try { if (PS.Models && PS.Models.currentId) return String(PS.Models.currentId); } catch (e) {}
    try { if (PS.State && PS.State.data && PS.State.data.selectionId) return String(PS.State.data.selectionId); } catch (e) {}
    var t = getTarget();
    if (t) return t.uuid || t.name || null;
    return null;
  };

  Editor.currentCharacterName = function () {
    try {
      if (PS.Models && PS.Models.currentId && PS.Models.models) {
        var m = PS.Models.models[PS.Models.currentId];
        if (m && m.name) return m.name;
      }
    } catch (e) {}
    try { if (PS.State && PS.State.data && PS.State.data.selectionName) return PS.State.data.selectionName; } catch (e) {}
    var t = getTarget();
    return (t && t.name) || '—';
  };

  /* Đồng bộ entry đang mở vào store (gọi trong save()). */
  Editor.syncStoreEntry = function () {
    var S2 = Store();
    if (!S2 || !Editor._storeReady) return;
    var mode = Editor.mode;
    var id = Editor._activeEntry[mode];
    var B = BT(), Sm = SM();
    if (!id) return;
    var entry = S2.get(id);
    if (!entry) return;
    try {
      entry.data = mode === 'statemachine' ? Sm.serialize(Editor.smGraph) : B.serialize(Editor.btGraph);
      entry.comments = JSON.parse(JSON.stringify(currentComments()));
      S2.upsert(entry);
    } catch (e) {}
  };

  /* Nạp entry của store vào slot graph của mode đang mở. */
  Editor.loadStoreEntry = function (entry) {
    var B = BT(), S = SM();
    if (!entry || !entry.data) return { ok: false, error: 'Entry trống.' };
    var r = entry.mode === 'statemachine' ? S.deserialize(entry.data) : B.deserialize(entry.data);
    if (!r.ok) return r;
    Editor.historyPush();
    if (entry.mode === 'statemachine') Editor.smGraph = r.graph;
    else Editor.btGraph = r.graph;
    Editor.comments[entry.mode] = Array.isArray(entry.comments) ? JSON.parse(JSON.stringify(entry.comments)) : [];
    Editor._activeEntry[entry.mode] = entry.id;
    var S2 = Store();
    if (S2) S2.setActive(entry.mode, entry.id);
    Editor.selected = null;
    Editor.saveSoon();
    Editor.renderAll();
    return { ok: true, entry: entry };
  };

  /* Khởi tạo store lần đầu: migrate legacy → entry; nếu chưa có gì
     thì tạo entry từ graph hiện tại (demo/trống). */
  Editor.initStore = function () {
    var S2 = Store();
    if (!S2) return { ok: false, error: 'Chưa có AnimGraphStore.' };
    if (!Editor._storeReady) {
      var mig = S2.migrateLegacy();
      if (mig.ok) notify('info', 'Anim Graph', 'Đã chuyển ' + mig.imported.join(', ') + ' từ bản lưu cũ sang danh sách graph.');
      Editor._storeReady = true;
    }
    var B = BT(), S = SM();
    ['blendtree', 'statemachine'].forEach(function (mode) {
      var active = S2.getActive(mode);
      if (active) return;
      var g = mode === 'statemachine' ? Editor.smGraph : Editor.btGraph;
      if (!g) return;
      var data = mode === 'statemachine' ? S.serialize(g) : B.serialize(g);
      var cr = S2.create(g.name || (mode === 'statemachine' ? 'State Machine' : 'Blend Tree'), mode, data, []);
      if (cr.ok) Editor._activeEntry[mode] = cr.entry.id;
    });
    /* Nạp entry active của mode hiện tại (nếu khác graph đang mở). */
    var cur = S2.getActive(Editor.mode);
    if (cur && cur.id !== Editor._activeEntry[Editor.mode]) Editor.loadStoreEntry(cur);
    else if (cur) Editor._activeEntry[Editor.mode] = cur.id;
    return { ok: true };
  };

  Editor.renderGraphBar = function () {
    var bar = Editor._graphBar;
    if (!bar) return;
    bar.innerHTML = '';
    var S2 = Store();
    var mode = Editor.mode;
    if (!S2) {
      bar.appendChild(el('span', { class: 'ag-hint', text: 'Chưa có AnimGraphStore — chỉ lưu 1 graph (legacy).' }));
      return;
    }
    var list = S2.list(mode);
    var activeId = Editor._activeEntry[mode] || (S2.getActive(mode) || {}).id;
    var sel = el('select', {
      class: 'ag-graph-select',
      title: 'Graph đang mở (' + (mode === 'statemachine' ? 'State Machine' : 'Blend Tree') + ')',
      onchange: function (ev) {
        var entry = S2.get(ev.target.value);
        if (entry) { var r = Editor.loadStoreEntry(entry); if (!r.ok) notify('warning', 'Anim Graph', r.error); Editor.renderGraphBar(); }
      }
    });
    if (!list.length) sel.appendChild(el('option', { value: '' }, ['— chưa có graph —']));
    list.forEach(function (e) {
      sel.appendChild(el('option', { value: e.id, selected: e.id === activeId ? 'selected' : undefined }, [e.name]));
    });
    bar.appendChild(el('span', { class: 'ag-graph-label', text: 'Graph:' }));
    bar.appendChild(sel);
    function gbBtn(label, title, fn) {
      bar.appendChild(el('button', { class: 'ag-btn ag-small', text: label, title: title, onclick: fn }));
    }
    gbBtn('+ Mới', 'Tạo graph trống mới', function () {
      var name = null;
      try { name = window.prompt('Tên graph mới:', mode === 'statemachine' ? 'State Machine mới' : 'Blend Tree mới'); } catch (e) {}
      if (!name) return;
      var B = BT(), S = SM();
      var g = mode === 'statemachine' ? S.createStateMachine(name) : B.createGraph(name);
      var cr = S2.create(name, mode, mode === 'statemachine' ? S.serialize(g) : B.serialize(g), []);
      if (!cr.ok) { notify('warning', 'Anim Graph', 'Tạo graph lỗi.'); return; }
      Editor.loadStoreEntry(cr.entry);
      Editor.renderGraphBar();
    });
    gbBtn('⧉ Nhân bản', 'Nhân bản graph đang mở', function () {
      var cur = S2.get(Editor._activeEntry[mode]);
      if (!cur) { notify('warning', 'Anim Graph', 'Chưa có graph đang mở.'); return; }
      Editor.syncStoreEntry();
      var r = S2.duplicate(cur.id);
      if (!r.ok) { notify('warning', 'Anim Graph', r.error); return; }
      Editor.loadStoreEntry(r.entry);
      Editor.renderGraphBar();
      notify('success', 'Anim Graph', 'Đã nhân bản: ' + r.entry.name);
    });
    gbBtn('✎ Đổi tên', 'Đổi tên graph đang mở', function () {
      var cur = S2.get(Editor._activeEntry[mode]);
      if (!cur) return;
      var name = null;
      try { name = window.prompt('Tên mới:', cur.name); } catch (e) {}
      if (!name) return;
      var r = S2.rename(cur.id, name);
      if (!r.ok) notify('warning', 'Anim Graph', r.error);
      Editor.renderGraphBar();
    });
    gbBtn('✕ Xóa', 'Xóa graph đang mở', function () {
      var cur = S2.get(Editor._activeEntry[mode]);
      if (!cur) return;
      var ok = true;
      try { ok = window.confirm('Xóa graph "' + cur.name + '"? Không khôi phục được.'); } catch (e) {}
      if (!ok) return;
      var r = S2.remove(cur.id);
      if (!r.ok) { notify('warning', 'Anim Graph', r.error); return; }
      var next = S2.getActive(mode);
      if (next) Editor.loadStoreEntry(next);
      else { Editor.historyPush(); if (mode === 'statemachine') Editor.smGraph = SM().createStateMachine('State Machine'); else Editor.btGraph = BT().createGraph('Blend Tree'); Editor._activeEntry[mode] = null; Editor.renderAll(); }
      Editor.renderGraphBar();
    });
    gbBtn('⇄ Gắn NV', 'Gắn graph đang mở vào nhân vật hiện tại', function () {
      var cid = Editor.currentCharacterId();
      if (!cid) { notify('warning', 'Anim Graph', 'Chưa chọn nhân vật nào.'); return; }
      var cur = S2.get(Editor._activeEntry[mode]);
      if (!cur) { notify('warning', 'Anim Graph', 'Chưa có graph đang mở.'); return; }
      Editor.syncStoreEntry();
      S2.setCharacterGraph(cid, mode, cur.id);
      Editor.renderGraphBar();
      notify('success', 'Anim Graph', 'Đã gắn "' + cur.name + '" vào nhân vật ' + Editor.currentCharacterName() + '.');
    });
    var cid2 = Editor.currentCharacterId();
    var mapped = cid2 ? S2.getCharacterGraph(cid2, mode) : null;
    bar.appendChild(el('span', {
      class: 'ag-hint',
      text: 'NV: ' + Editor.currentCharacterName() + (mapped ? ' · graph đã gắn: ' + mapped.name : ' · chưa gắn graph')
    }));
  };

  /* Đổi nhân vật → tự chuyển sang graph đã gắn cho nhân vật đó
     (nếu có). Lắng nghe 1 lần duy nhất. */
  Editor.maybeSwitchGraphForCharacter = function (characterId) {
    var S2 = Store();
    if (!S2 || !characterId) return;
    var mapped = S2.getCharacterGraph(characterId, Editor.mode);
    if (mapped && mapped.id !== Editor._activeEntry[Editor.mode]) {
      var r = Editor.loadStoreEntry(mapped);
      if (r.ok) {
        notify('info', 'Anim Graph', 'Đã chuyển sang graph "' + mapped.name + '" của nhân vật ' + Editor.currentCharacterName() + '.');
        Editor.renderGraphBar();
      }
    } else {
      Editor.renderGraphBar();
    }
  };

  /* ================= SM2: PHÁT GRAPH QUA ANIMATOR =================
     Editor chỉ đánh giá LOGIC graph (transition/trọng số) rồi gọi
     Animator.play(clipId) + setFadeDuration() — Animator giữ mixer/
     action của nó, không tạo mixer thứ 2. Dùng cho cả clip THREE,
     keyframe và autogen (Animator.play tự ủy thác). */
  Editor.startAnimatorDrive = function () {
    var AN = PS.ArpAnimator;
    if (!AN || typeof AN.play !== 'function') return { ok: false, error: 'ArpAnimator chưa load (cần Animator.play).' };
    var B = BT(), S = SM();
    if (!B || !S) return { ok: false, error: 'Thiếu module BlendTree/StateMachine.' };
    var target = getTarget();
    if (!target) return { ok: false, error: 'Chưa có model — rig/import model trước rồi bấm Phát.' };
    var g = graph();
    var v = Editor.mode === 'statemachine' ? S.validate(g, B.resolveClip) : B.validate(g, B.resolveClip);
    if (!v.ok) return { ok: false, error: 'Graph lỗi: ' + v.errors.join(' ') };
    Editor.stopPreview();
    var drive = { mode: Editor.mode, graph: g, lastClipId: null, stateTime: 0, stateDuration: 0, currentId: null, inTransition: null };
    if (Editor.mode === 'statemachine') {
      var entry = S.getState(g, g.entryStateId) || g.states[0];
      drive.currentId = entry.id;
      var clip0 = B.resolveClip(entry.clipId);
      drive.stateDuration = (clip0 && clip0.duration) || 0;
    }
    Editor._animDrive = drive;
    Editor.playing = true;
    Editor._droveAnimator = true;
    Editor._lastT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    /* Phát ngay state/clip đầu (không chờ tick đầu). */
    Editor._animatorDriveTick(0);
    function loop(t) {
      if (!Editor.playing || !Editor._animDrive) return;
      var now = t || Date.now();
      var dt = Math.min(0.1, (now - Editor._lastT) / 1000 || 0.016);
      Editor._lastT = now;
      try { Editor._animatorDriveTick(dt); } catch (e) {}
      Editor.updateStatus();
      Editor.updatePlaybackHighlight();
      Editor._raf = requestAnimationFrame(loop);
    }
    Editor._raf = requestAnimationFrame(loop);
    Editor.updateStatus();
    return { ok: true, via: 'animator' };
  };

  function animatorPlayClip(clipId, fadeDuration) {
    var AN = PS.ArpAnimator;
    if (!AN || typeof AN.play !== 'function') return { ok: false, error: 'Thiếu Animator.play.' };
    try {
      if (typeof AN.setFadeDuration === 'function') AN.setFadeDuration(Math.max(0, fadeDuration || 0));
      else AN.fadeDuration = Math.max(0, fadeDuration || 0);
    } catch (e) {}
    return AN.play(clipId);
  }

  Editor._animatorDriveTick = function (dt) {
    var drive = Editor._animDrive;
    if (!drive) return { ok: false, reason: 'no-drive' };
    var B = BT(), S = SM();
    var g = drive.graph;
    if (drive.mode === 'statemachine') {
      drive.stateTime += dt;
      if (drive.inTransition) {
        drive.inTransition.t += dt;
        if (drive.inTransition.t >= drive.inTransition.duration) drive.inTransition = null;
      }
      var cur = S.getState(g, drive.currentId);
      if (!cur) return { ok: false, error: 'Không có state hiện tại.' };
      var progress = drive.stateDuration > 0 ? drive.stateTime / drive.stateDuration : 0;
      /* Phát clip của state hiện tại nếu chưa phát (lần đầu / sau khi
         Animator bị stop ngoài). */
      if (drive.lastClipId !== cur.clipId) {
        var r0 = animatorPlayClip(cur.clipId, 0);
        if (r0.ok) drive.lastClipId = cur.clipId;
      }
      if (!drive.inTransition) {
        var hit = null;
        var anyList = (g.transitions || []).filter(function (t) { return t.from === '*'; });
        var ownList = (g.transitions || []).filter(function (t) { return t.from === drive.currentId; });
        var lists = [anyList, ownList];
        outer:
        for (var li = 0; li < lists.length; li++) {
          var list = lists[li];
          for (var i = 0; i < list.length; i++) {
            var tr = list[i];
            if (tr.from === '*' && tr.to === drive.currentId) continue;
            if (tr.hasExitTime && progress < (tr.exitTime === undefined ? 1 : tr.exitTime)) continue;
            if (!S.conditionsMet(g, tr)) continue;
            hit = tr; break outer;
          }
        }
        if (hit) {
          var toSt = S.getState(g, hit.to);
          var prevId = drive.currentId;
          var r = animatorPlayClip(toSt.clipId, hit.duration);
          if (r.ok) {
            drive.currentId = toSt.id;
            drive.stateTime = 0;
            var clip = B.resolveClip(toSt.clipId);
            drive.stateDuration = (clip && clip.duration) || 0;
            drive.lastClipId = toSt.clipId;
            drive.inTransition = { from: prevId, to: toSt.id, transitionId: hit.id, t: 0, duration: hit.duration };
            try {
              bus.emit('anim:graph-state-changed', {
                mode: 'statemachine', state: toSt.name, from: cur.name, to: toSt.name,
                transition: hit.id, reason: 'condition', via: 'animator'
              });
            } catch (e) {}
            (hit.conditions || []).forEach(function (c) {
              var p = B.getParameter(g, c.param);
              if (p && p.type === 'trigger') p.value = false;
            });
          }
        }
      }
      return { ok: true, state: cur.name, stateTime: drive.stateTime };
    }
    /* Blend Tree: clip có trọng số lớn nhất → Animator.play khi đổi. */
    var ev = B.evaluateWeights(g, B.resolveClip);
    var bestId = null, bestW = 0;
    Object.keys(ev.weights || {}).forEach(function (id) {
      if (ev.weights[id] > bestW) { bestW = ev.weights[id]; bestId = id; }
    });
    if (bestId && bestId !== drive.lastClipId && bestW > 0.01) {
      var r2 = animatorPlayClip(bestId, 0.15);
      if (r2.ok) drive.lastClipId = bestId;
    }
    drive.weights = ev.weights;
    return { ok: true, weights: ev.weights };
  };

  Editor.stopAnimatorDrive = function () {
    Editor._animDrive = null;
    if (Editor._droveAnimator) {
      Editor._droveAnimator = false;
      try { if (PS.ArpAnimator && typeof PS.ArpAnimator.stop === 'function') PS.ArpAnimator.stop(); } catch (e) {}
    }
    return { ok: true };
  };

  /* ================= SM2: HIGHLIGHT PHÁT LẠI =================
     Chạy mỗi frame khi đang phát: dây transition đang chạy sáng lên,
     node/state đang phát viền xanh, tiến độ % hiện ở status. Chỉ đổi
     class DOM, không render lại toàn bộ. */
  Editor.updatePlaybackHighlight = function () {
    if (!Editor._world || !Editor.playing) return;
    var activeTransId = null, progress = -1;
    if (Editor._animDrive && Editor._animDrive.inTransition) {
      activeTransId = Editor._animDrive.inTransition.transitionId;
      progress = Editor._animDrive.inTransition.duration > 0
        ? Editor._animDrive.inTransition.t / Editor._animDrive.inTransition.duration : 1;
    } else if (Editor.mode === 'statemachine' && Editor.smRuntime && Editor.smRuntime.inTransition) {
      activeTransId = Editor.smRuntime.inTransition.transitionId || null;
      /* SM runtime lưu inTransition {from,to,t,duration} — không có id. */
      progress = Editor.smRuntime.inTransition.duration > 0
        ? Editor.smRuntime.inTransition.t / Editor.smRuntime.inTransition.duration : 1;
    }
    var wires = Editor._world.querySelectorAll('.ag-wire');
    wires.forEach(function (w) {
      var isActive = (activeTransId && w.dataset.transId === activeTransId) ||
        (!activeTransId && progress >= 0 && w.dataset.transFrom && Editor.smRuntime && Editor.smRuntime.inTransition &&
          w.dataset.transFrom === Editor.smRuntime.inTransition.from && w.dataset.transTo === Editor.smRuntime.inTransition.to);
      w.classList.toggle('ag-wire-active', !!isActive);
    });
    /* Node đang phát: SM = currentState, BT = clip có trọng số > 0.01. */
    var activeNodeIds = {};
    if (Editor._animDrive && Editor._animDrive.mode === 'statemachine' && Editor._animDrive.currentId) {
      activeNodeIds[Editor._animDrive.currentId] = true;
    } else if (Editor.mode === 'statemachine' && Editor.smRuntime && Editor.smRuntime.currentState) {
      var cs = null;
      try { cs = Editor.smRuntime.currentState(); } catch (e) {}
      if (cs) activeNodeIds[cs.id] = true;
    } else if (Editor.mode === 'blendtree') {
      var weights = null;
      if (Editor._animDrive && Editor._animDrive.weights) weights = Editor._animDrive.weights;
      else if (Editor.btRuntime) { try { weights = Editor.btRuntime.getWeights(); } catch (e) {} }
      if (weights) {
        var g = graph();
        (g.nodes || []).forEach(function (n) {
          if (n.type === 'clip' && n.clipId && (weights[n.clipId] || 0) > 0.01) activeNodeIds[n.id] = true;
        });
      }
    }
    var nodes = Editor._world.querySelectorAll('.ag-node');
    nodes.forEach(function (box) {
      box.classList.toggle('ag-playing', !!activeNodeIds[box.dataset.nodeId]);
    });
    Editor._transitionProgress = progress;
  };

  /* ================= SM2: KÉO DÂY CÓ SNAP =================
     Mousedown cổng OUT → kéo dây theo chuột; thả trong 40px của cổng
     IN gần nhất thì nối (hút vào cổng đó). Thả xa → hủy. Bấm nhanh
     không kéo vẫn giữ hành vi click-click cũ (pendingFrom). */
  Editor.startWireDrag = function (ev, nodeId) {
    ev.preventDefault();
    ev.stopPropagation();
    var startX = ev.clientX, startY = ev.clientY;
    var wasPending = (Editor.pendingFrom === nodeId);
    Editor._wireDrag = { from: nodeId, x: startX, y: startY, moved: false, snapTarget: null, wasPending: wasPending };
    function toWorld(cx, cy) {
      var r = Editor._canvas.getBoundingClientRect();
      return { x: (cx - r.left - Editor.pan.x) / Editor.zoom, y: (cy - r.top - Editor.pan.y) / Editor.zoom };
    }
    function nearestPort(wx, wy) {
      var best = null, bestD = WIRE_SNAP_PX / Editor.zoom + 30;
      var g = graph();
      var items = Editor.mode === 'statemachine' ? (g.states || []) : (g.nodes || []);
      items.forEach(function (n) {
        if (n.id === nodeId) return;
        var px = (n.x || 0) + NODE_W / 2, py = (n.y || 0); /* cổng IN trên đỉnh node */
        var d = Math.hypot(wx - px, wy - py);
        if (d < bestD) { bestD = d; best = n.id; }
      });
      return best;
    }
    function mv(e2) {
      var wd = Editor._wireDrag;
      if (!wd) return;
      if (Math.abs(e2.clientX - startX) + Math.abs(e2.clientY - startY) > 6) {
        if (!wd.moved) Editor.pendingFrom = nodeId; /* bắt đầu kéo → vẽ dây tạm tới chuột */
        wd.moved = true;
      }
      var w = toWorld(e2.clientX, e2.clientY);
      wd.x = e2.clientX; wd.y = e2.clientY;
      wd.snapTarget = nearestPort(w.x, w.y);
      /* Vẽ dây tạm: dùng lại drawConnections với pendingTo. */
      Editor._wireDragPos = w;
      Editor.drawConnections();
      /* Highlight cổng IN gần nhất. */
      var ports = Editor._world.querySelectorAll('.ag-port-in');
      ports.forEach(function (p) { p.classList.remove('ag-port-snap'); });
      if (wd.snapTarget) {
        var box = Editor._world.querySelector('[data-node-id="' + wd.snapTarget + '"] .ag-port-in');
        if (box) box.classList.add('ag-port-snap');
      }
    }
    function up(e2) {
      doc.removeEventListener('mousemove', mv);
      doc.removeEventListener('mouseup', up);
      var wd = Editor._wireDrag;
      Editor._wireDrag = null;
      Editor._wireDragPos = null;
      if (!wd) return;
      if (wd.moved) {
        /* Kéo-thả: nối vào cổng snap (nếu có). */
        if (wd.snapTarget) {
          Editor.pendingFrom = nodeId;
          Editor.onPortIn(wd.snapTarget);
        } else {
          Editor.pendingFrom = null;
          Editor.renderNodes();
        }
      } else {
        /* Bấm nhanh: toggle pending như click-click cũ (wasPending
           thì tắt, chưa pending thì bật). */
        Editor.pendingFrom = wd.wasPending ? null : nodeId;
        Editor.renderNodes();
        Editor.updateStatus();
      }
    }
    doc.addEventListener('mousemove', mv);
    doc.addEventListener('mouseup', up);
  };

  /* ================= TAB RENDER ================= */

  Editor.render = function (container) {
    Editor._container = container;
    container.innerHTML = '';
    container.className = 'ag-root';
    var B = BT(), S = SM();
    if (!Editor.btGraph || !Editor.smGraph) newGraphs();
    if (!Editor.btRuntime && B) Editor.btRuntime = B.createRuntime();
    if (!Editor.smRuntime && S) Editor.smRuntime = S.createRuntime();
    /* Thử load graph đã lưu (1 lần): ưu tiên graph đang active trong
       thư viện, rồi graph gắn với model hiện tại, rồi auto-save. */
    if (!Editor._loadedOnce) {
      Editor._loadedOnce = true;
      var lib0 = Editor.listLibrary();
      var loaded0 = false;
      if (lib0.active) { var lr = Editor.loadFromLibrary(lib0.active); loaded0 = lr.ok; }
      if (!loaded0) { var ar = Editor.loadAttachedForModel(); loaded0 = ar.ok; }
      if (!loaded0) { var ld = Editor.load(); if (ld.ok) { /* đã load */ } }
    }
    if (bus && typeof bus.on === 'function') {
      try { bus.on('arp:animator-clip-changed', function () { Editor.renderNodes(); }); } catch (e) {}
    }

    /* Toolbar */
    var toolbar = el('div', { class: 'ag-toolbar' });
    var modeSel = el('select', {
      class: 'ag-mode',
      onchange: function (ev) { Editor.stopPreview(); Editor.mode = ev.target.value; Editor.selected = null; Editor.render(Editor._container); }
    }, [
      el('option', { value: 'blendtree', selected: Editor.mode === 'blendtree' ? 'selected' : undefined }, ['Blend Tree']),
      el('option', { value: 'statemachine', selected: Editor.mode === 'statemachine' ? 'selected' : undefined }, ['State Machine'])
    ]);
    toolbar.appendChild(modeSel);
    /* Tìm kiếm node/state theo tên (node không khớp bị mờ). */
    var searchInput = el('input', {
      type: 'text', class: 'ag-search', placeholder: '🔍 Tìm node/state…',
      value: Editor._search || '',
      oninput: function (ev) { Editor._search = ev.target.value; Editor.renderNodes(); },
      onkeydown: function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); Editor.jumpToSearch(); }
        else if (ev.key === 'Escape') { ev.target.value = ''; Editor._search = ''; Editor.renderNodes(); }
      }
    });
    Editor._searchInput = searchInput;
    toolbar.appendChild(searchInput);
    var addBtn = function (label, fn) {
      toolbar.appendChild(el('button', { class: 'ag-btn', text: label, onclick: function () { Editor.pushUndo(); fn(); } }));
    };
    if (Editor.mode === 'blendtree') {
      addBtn('+ Clip', function () { B.addNode(Editor.btGraph, { type: 'clip', x: 60 + Math.random() * 200, y: 200 + Math.random() * 120 }); Editor.saveSoon(); Editor.renderAll(); });
      addBtn('+ Blend 1D', function () { B.addNode(Editor.btGraph, { type: 'blend1d', x: 200, y: 60 }); Editor.saveSoon(); Editor.renderAll(); });
      addBtn('+ Blend 2D', function () { B.addNode(Editor.btGraph, { type: 'blend2d', x: 200, y: 60 }); Editor.saveSoon(); Editor.renderAll(); });
      addBtn('+ Add/Mask', function () { B.addNode(Editor.btGraph, { type: 'add', x: 200, y: 60 }); Editor.saveSoon(); Editor.renderAll(); });
      addBtn('+ Random', function () { B.addNode(Editor.btGraph, { type: 'random', x: 200, y: 60 }); Editor.saveSoon(); Editor.renderAll(); });
      addBtn('+ Mirror', function () { B.addNode(Editor.btGraph, { type: 'mirror', x: 200, y: 60 }); Editor.saveSoon(); Editor.renderAll(); });
      addBtn('+ Time Scale', function () { B.addNode(Editor.btGraph, { type: 'timescale', x: 200, y: 60 }); Editor.saveSoon(); Editor.renderAll(); });
      addBtn('+ Layer', function () { B.addNode(Editor.btGraph, { type: 'layer', x: 200, y: 60 }); Editor.saveSoon(); Editor.renderAll(); });
      addBtn('+ Blend Additive', function () { B.addNode(Editor.btGraph, { type: 'blendadditive', x: 200, y: 60 }); Editor.saveSoon(); Editor.renderAll(); });
      addBtn('+ Layered', function () { B.addNode(Editor.btGraph, { type: 'layered', x: 200, y: 60 }); Editor.saveSoon(); Editor.renderAll(); });
      addBtn('+ Sequence', function () { B.addNode(Editor.btGraph, { type: 'sequence', x: 200, y: 60 }); Editor.saveSoon(); Editor.renderAll(); });
    } else {
      addBtn('+ State', function () { S.addState(Editor.smGraph, { name: 'State ' + (Editor.smGraph.states.length + 1), x: 60 + Math.random() * 200, y: 120 + Math.random() * 120 }); Editor.saveSoon(); Editor.renderAll(); });
      addBtn('+ Any → State', function () {
        notify('info', 'Anim Graph', 'Bấm cổng OUT của 1 state rồi bấm cổng IN của state đích — hoặc chọn transition Any State ở panel thuộc tính (from = *).');
      });
    }
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: '↩ Hoàn tác',
      onclick: function () { var r = Editor.undo(); if (!r.ok) notify('warning', 'Anim Graph', r.error); }
    }));
    /* SM2: redo + copy/paste + nhân bản + ghi chú + zoom/fit. */
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: '↪ Làm lại',
      title: 'Redo (Ctrl+Y)',
      onclick: function () { var r = Editor.historyRedo(); if (!r.ok) notify('warning', 'Anim Graph', r.error); }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: '⧉ Copy',
      title: 'Copy node đang chọn (Ctrl+C)',
      onclick: function () { var r = Editor.copySelected(); if (!r.ok) notify('warning', 'Anim Graph', r.error); }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: '⎘ Paste',
      title: 'Paste node đã copy (Ctrl+V)',
      onclick: function () { var r = Editor.pasteClipboard(); if (!r.ok) notify('warning', 'Anim Graph', r.error); }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: '⧉ Nhân bản',
      title: 'Nhân bản node/state đang chọn — Blend Tree nhân bản cả cây con (Ctrl+D)',
      onclick: function () { var r = Editor.duplicateSelected(); if (!r.ok) notify('warning', 'Anim Graph', r.error); }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: '✎ Ghi chú',
      title: 'Thêm ghi chú tự do trên graph (bấm đúp để sửa)',
      onclick: function () { Editor.addComment(); }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: '−',
      title: 'Thu nhỏ',
      onclick: function () { Editor.zoom = Math.max(0.4, Editor.zoom / 1.2); Editor.applyTransform(); Editor.updateMinimap(); }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: '+',
      title: 'Phóng to',
      onclick: function () { Editor.zoom = Math.min(2, Editor.zoom * 1.2); Editor.applyTransform(); Editor.updateMinimap(); }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: '⤢ Fit',
      title: 'Thu toàn bộ graph vừa khung nhìn',
      onclick: function () { Editor.fitView(); }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: '⧉ Tự sắp xếp',
      onclick: function () { Editor.autoLayout(); }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn ag-play', text: '▶ Phát graph',
      onclick: function () {
        if (Editor.playing) { Editor.stopPreview(); return; }
        var r = Editor.playPreview();
        if (!r.ok) notify('warning', 'Anim Graph', r.error);
        Editor.renderToolbarPlay();
      }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: '■ Dừng',
      onclick: function () { Editor.stopPreview(); Editor.renderToolbarPlay(); }
    }));
    /* SM2: phát qua Animator (editor đánh giá logic, Animator.play phát clip). */
    toolbar.appendChild(el('button', {
      class: 'ag-btn' + (Editor.playViaAnimator ? ' ag-active' : ''), text: '⇄ Phát qua Animator',
      title: 'BẬT: editor chỉ đánh giá logic graph, Animator.play() phát clip bằng mixer của Animator. TẮT: phát bằng mixer riêng của graph.',
      onclick: function (ev) {
        Editor.stopPreview();
        Editor.playViaAnimator = !Editor.playViaAnimator;
        ev.target.classList.toggle('ag-active', Editor.playViaAnimator);
        notify('info', 'Anim Graph', Editor.playViaAnimator ? 'Phát graph qua Animator (mixer Animator).' : 'Phát bằng mixer riêng của graph.');
      }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: 'Demo',
      onclick: function () { Editor.stopPreview(); var r = Editor.buildDemo(); if (!r.ok) notify('warning', 'Anim Graph', r.error); Editor.renderAll(); }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: 'Lưu',
      onclick: function () { var r = Editor.save(); notify(r.ok ? 'success' : 'warning', 'Anim Graph', r.ok ? 'Đã lưu graph (auto-save cũng bật).' : r.error); }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: 'Xuất .json',
      onclick: function () { Editor.exportJSON(); }
    }));
    var fileInput = el('input', {
      type: 'file', accept: '.json,application/json', style: { display: 'none' },
      onchange: function (ev) {
        var f = ev.target.files && ev.target.files[0];
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          var r = Editor.importJSON(String(rd.result || ''));
          notify(r.ok ? 'success' : 'warning', 'Anim Graph', r.ok ? 'Đã nhập graph.' : r.error);
          Editor.renderAll();
        };
        rd.readAsText(f);
      }
    });
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: 'Nhập .json',
      onclick: function () { fileInput.click(); }
    }));
    toolbar.appendChild(fileInput);
    /* Thư viện nhiều graph + gắn vào model. */
    var libNameInput = el('input', {
      type: 'text', class: 'ag-search', placeholder: 'Tên graph trong thư viện…',
      value: Editor._libName || ''
    });
    toolbar.appendChild(libNameInput);
    var libSelect = el('select', {
      class: 'ag-mode',
      onchange: function (ev) {
        if (!ev.target.value) return;
        var r = Editor.loadFromLibrary(ev.target.value);
        if (!r.ok) notify('warning', 'Anim Graph', r.error);
        Editor.renderLibrarySelect();
      }
    });
    toolbar.appendChild(libSelect);
    Editor._libSelect = libSelect;
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: 'Lưu vào thư viện',
      onclick: function () {
        var r = Editor.saveToLibrary(libNameInput.value);
        notify(r.ok ? 'success' : 'warning', 'Anim Graph', r.ok ? 'Đã lưu "' + r.name + '" vào thư viện.' : r.error);
        Editor.renderLibrarySelect();
      }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: 'Xóa khỏi thư viện',
      onclick: function () {
        var r = Editor.deleteFromLibrary(libSelect.value || libNameInput.value);
        notify(r.ok ? 'success' : 'warning', 'Anim Graph', r.ok ? 'Đã xóa khỏi thư viện.' : r.error);
        Editor.renderLibrarySelect();
      }
    }));
    toolbar.appendChild(el('button', {
      class: 'ag-btn', text: '📌 Gắn vào model này',
      onclick: function () {
        var r = Editor.attachToModel();
        notify(r.ok ? 'success' : 'warning', 'Anim Graph', r.ok ? 'Đã gắn graph "' + r.graph + '" vào model "' + r.model + '".' : r.error);
        Editor.updateStatus();
      }
    }));
    container.appendChild(toolbar);
    Editor._toolbar = toolbar;
    Editor.renderLibrarySelect();

    container.appendChild(el('div', {
      class: 'ag-help',
      text: 'Kéo node bằng tiêu đề · Nối dây: bấm cổng OUT (dưới) rồi bấm cổng IN (trên) của node đích · Zoom: lăn chuột · Pan: kéo nền · Xóa node: chọn node rồi bấm Xóa ở panel phải.'
    }));

    /* Thanh parameter preview */
    Editor._paramBar = el('div', { class: 'ag-param-bar' });
    container.appendChild(Editor._paramBar);

    /* Canvas + panel thuộc tính */
    var main = el('div', { class: 'ag-main' });
    var canvas = el('div', {
      class: 'ag-canvas',
      onmousedown: function (ev) {
        if (ev.target !== canvas) return;
        Editor.selected = null;
        var sx = ev.clientX, sy = ev.clientY, ox = Editor.pan.x, oy = Editor.pan.y;
        function mv(e2) {
          Editor.pan.x = ox + (e2.clientX - sx);
          Editor.pan.y = oy + (e2.clientY - sy);
          Editor.applyTransform();
        }
        function up() { doc.removeEventListener('mousemove', mv); doc.removeEventListener('mouseup', up); Editor.renderProps(); }
        doc.addEventListener('mousemove', mv);
        doc.addEventListener('mouseup', up);
      },
      onwheel: function (ev) {
        ev.preventDefault();
        Editor.zoom = Math.max(0.4, Math.min(2, Editor.zoom * (ev.deltaY < 0 ? 1.1 : 0.9)));
        Editor.applyTransform();
      }
    });
    Editor._canvas = canvas;
    Editor._world = el('div', { class: 'ag-world' });
    canvas.appendChild(Editor._world);
    /* SM2: minimap góc canvas (bấm để nhảy tới). */
    Editor._minimap = el('div', {
      class: 'ag-minimap', title: 'Minimap — bấm để nhảy tới',
      onclick: function (ev) { ev.stopPropagation(); Editor.minimapJump(ev); }
    });
    canvas.appendChild(Editor._minimap);
    main.appendChild(canvas);
    Editor._props = el('div', { class: 'ag-props' });
    main.appendChild(Editor._props);
    container.appendChild(main);

    Editor._status = el('div', { class: 'ag-status' });
    container.appendChild(Editor._status);

    /* SM2: panel validation chi tiết (bấm lỗi để nhảy tới node). */
    Editor._issues = el('div', { class: 'ag-issues' });
    container.appendChild(Editor._issues);

    /* SM2: theo dõi focus để phím tắt Ctrl+C/V/Z/Y/D chỉ chạy khi
       đang thao tác trong editor (không cướp phím khi gõ ô input). */
    try { container.setAttribute('tabindex', '0'); } catch (e) {}
    if (!Editor._focusListener && doc) {
      Editor._focusListener = true;
      doc.addEventListener('mousedown', function (ev) {
        Editor._focused = !!(Editor._container && Editor._container.contains(ev.target));
      }, true);
    }

    Editor.renderAll();
  };

  Editor.renderToolbarPlay = function () {
    /* Nút Phát đổi nhãn theo trạng thái — render lại toolbar đơn giản: */
    if (!Editor._toolbar) return;
    var btn = Editor._toolbar.querySelector('.ag-play');
    if (btn) btn.textContent = Editor.playing ? '⏸ Đang phát — bấm để dừng' : '▶ Phát graph';
  };

  /* Phím tắt khi editor focus (theo dõi qua Editor._focused hoặc
     activeElement trong container): Delete xóa node · Ctrl+Z hoàn tác ·
     Ctrl+Y / Ctrl+Shift+Z làm lại · Ctrl+C/V copy/paste · Ctrl+D nhân
     bản. Bỏ qua khi đang gõ trong ô input (không cướp Ctrl+C/V chữ). */
  try {
    doc.addEventListener('keydown', function (ev) {
      if (!Editor._container || (!Editor._focused && !Editor._container.contains(doc.activeElement))) return;
      var tag = (ev.target && ev.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'z' || ev.key === 'Z')) {
        ev.preventDefault();
        if (ev.shiftKey) Editor.historyRedo(); else Editor.undo();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'y' || ev.key === 'Y')) {
        ev.preventDefault();
        Editor.historyRedo();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'c' || ev.key === 'C')) {
        ev.preventDefault();
        Editor.copySelected();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'v' || ev.key === 'V')) {
        ev.preventDefault();
        Editor.pasteClipboard();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'd' || ev.key === 'D')) {
        ev.preventDefault();
        Editor.duplicateSelected();
        return;
      }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && Editor.selected && Editor.selected.kind === 'node') {
        var g = graph();
        Editor.pushUndo();
        if (Editor.mode === 'statemachine') SM().removeState(g, Editor.selected.id);
        else BT().removeNode(g, Editor.selected.id);
        Editor.selected = null;
        Editor.saveSoon();
        Editor.renderAll();
      }
    });
  } catch (e) {}

  PS.AnimGraphEditor = Editor;

  /* Đăng ký tab ARP 'anim-graph' (sau Animator — panel liệt kê tab
     ngoài TAB_ORDER theo thứ tự đăng ký). */
  try {
    var Panel = PS.ArpPanel;
    if (Panel && typeof Panel.registerTab === 'function') {
      Panel.registerTab('anim-graph', 'Anim Graph', function (c) { Editor.render(c); });
    }
  } catch (e) {}
})();
