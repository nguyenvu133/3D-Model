/* ============================================================
 * animation/anim-blendtree.js — ANIMATION BLEND TREE
 *
 * Blend Tree cho studio 3D-Model (Auto Rig Pro Blend).
 * DÙNG LẠI, không viết lại:
 *   • PixiStudio.AnimBlender — maskedClip / makeAdditive cho
 *     node Add/Mask (upper-body overlay).
 *   • Clip nguồn qua PixiStudio.ArpSyncClips.listAllClips()
 *     (fallback RigAutoGen.current.clips, fallback Animator).
 *   • Phát qua THREE.AnimationMixer r128 (mixer riêng của graph,
 *     không đụng mixer của Animator/Anim).
 *
 * NODE:
 *   clip    — 1 clip (speed/loop riêng).
 *   blend1d — blend theo 1 parameter float: 2+ clip con, mỗi con
 *             có threshold; nội suy tuyến tính giữa 2 ngưỡng kề.
 *   blend2d — blend theo 2 parameter (x, y): mỗi clip con có vị
 *             trí 2D; trọng số theo nghịch đảo bình phương khoảng
 *             cách (exact match → 1.0). Tổng trọng số luôn = 1.
 *   add     — base + overlay: overlay dùng AnimBlender.maskedClip
 *             (mask upper/lower) hoặc makeAdditive (additive).
 *
 * PARAMETER: float / int / bool / trigger (trigger tự reset sau
 * khi tiêu thụ 1 lần trong tick).
 *
 * TOÁN TRỌNG SỐ (thuần, kiểm bằng harness):
 *   computeBlend1D(children, v) / computeBlend2D(children, x, y)
 *   → mảng trọng số, tổng = 1 (trừ khi không có con nào).
 *
 * RUNTIME (AnimGraphRuntime): mixer riêng trên target root, cache
 * action theo clip object, mỗi tick đánh giá lại trọng số từ
 * parameter hiện tại và áp lên action (setEffectiveWeight /
 * timeScale). smoothing=0 mặc định → trọng số áp chính xác ngay;
 * editor đặt 0.15s để preview mượt.
 *
 * LƯU/TẢI: format 'pixistudio-anim-graph-1' — xem AnimGraphIO
 * (serialize/deserialize/saveToStorage/loadFromStorage ở cuối file).
 *
 * BUS: phát 'anim:graph-state-changed' {mode:'blendtree', weights,
 * currentClipIds} mỗi khi trọng số đổi; Animator lắng nghe để hiển
 * thị clip/state hiện tại (Animator KHÔNG bị sửa — tích hợp 1 chiều
 * qua bus). Không sửa arp-animator.js / save-manager.js.
 *
 * MỞ RỘNG SM1 (2026-11-27, vòng Animation — nhóm SM1 runtime):
 * Node đã có từ trước / do coordinator song song làm: clip, blend1d,
 * blend2d, add, random (uniform + reroll tay), mirror (ctx.mirror),
 * timescale, layer (1 base + overlay, tối đa 5 con).
 * Nhóm SM1 bổ sung (file này): node blendadditive (base + additive
 * chuyên dụng), node layered (bí danh của layer, cùng ngữ nghĩa),
 * node sequence (phát các clip con nối tiếp, runtime tự chuyển clip
 * khi hết thời lượng); random có trọng số + mode trigger/cycle
 * (mode 'manual' giữ nguyên hành vi cũ); timescale kẹp 0.25–2x;
 * mirror dùng lại đủ 4 nguồn (ArpAnimMirror → ArpSyncClips →
 * ArpAnimator → ArpMirror); connect() ghi được entry.weight cho
 * layer/layered/random; API mới evaluate() → [{clipId, weight, ...}]
 * đã sort và getBlendPosition(nodeId) → tọa độ blend hiện tại để
 * editor vẽ preview; setParameter phát bus 'anim:graph-param-changed'.
 * Format JSON giữ 'pixistudio-anim-graph-1' (schema 1.1, tương thích
 * ngược: field mới đều có giá trị mặc định khi deserialize).
 * ============================================================ */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined' && window.PixiStudio) || {};
  var bus = (PS && PS.bus) || { emit: function () {}, on: function () {} };
  var T = (typeof window !== 'undefined' && window.THREE) ||
          (typeof THREE !== 'undefined' ? THREE : null);

  var FORMAT = 'pixistudio-anim-graph-1';
  var STORAGE_KEY = 'pixistudio-anim-graph-1';

  var _uid = 0;
  function uid(prefix) { _uid++; return (prefix || 'n') + '_' + Date.now().toString(36) + '_' + _uid; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message }); } catch (e) {}
  }

  /* ================= PARAMETER ================= */

  function defaultParamValue(type) {
    if (type === 'bool' || type === 'trigger') return false;
    return 0;
  }

  function addParameter(graph, spec) {
    spec = spec || {};
    var name = String(spec.name || '').trim();
    if (!name) return { ok: false, error: 'Tên parameter trống.' };
    if (graph.parameters.some(function (p) { return p.name === name; })) {
      return { ok: false, error: 'Parameter "' + name + '" đã tồn tại.' };
    }
    var type = spec.type || 'float';
    if (['float', 'int', 'bool', 'trigger'].indexOf(type) < 0) type = 'float';
    var p = {
      name: name, type: type,
      value: spec.value !== undefined ? spec.value : (spec.defaultValue !== undefined ? spec.defaultValue : defaultParamValue(type)),
      defaultValue: spec.defaultValue !== undefined ? spec.defaultValue : defaultParamValue(type),
      min: isNum(spec.min) ? spec.min : (type === 'float' || type === 'int' ? 0 : 0),
      max: isNum(spec.max) ? spec.max : (type === 'float' || type === 'int' ? 1 : 1)
    };
    if (type === 'float' || type === 'int') {
      if (p.min > p.max) { var t = p.min; p.min = p.max; p.max = t; }
      p.value = clamp(+p.value || 0, p.min, p.max);
      p.defaultValue = clamp(+p.defaultValue || 0, p.min, p.max);
    }
    if (type === 'int') { p.value = Math.round(p.value); p.defaultValue = Math.round(p.defaultValue); }
    graph.parameters.push(p);
    return { ok: true, parameter: p };
  }

  function getParameter(graph, name) {
    return graph.parameters.find(function (p) { return p.name === name; }) || null;
  }

  function setParameter(graph, name, value) {
    var p = getParameter(graph, name);
    if (!p) return { ok: false, error: 'Không có parameter "' + name + '".' };
    if (p.type === 'float') p.value = clamp(+value || 0, p.min, p.max);
    else if (p.type === 'int') p.value = Math.round(clamp(+value || 0, p.min, p.max));
    else if (p.type === 'bool') p.value = !!value;
    else if (p.type === 'trigger') p.value = !!value;
    /* SM1: báo cho editor/preview biết parameter vừa đổi realtime. */
    try { bus.emit('anim:graph-param-changed', { name: name, value: p.value, type: p.type }); } catch (e) {}
    return { ok: true, value: p.value };
  }

  function getParameterValue(graph, name, fallback) {
    var p = getParameter(graph, name);
    return p ? p.value : fallback;
  }

  function removeParameter(graph, name) {
    var i = graph.parameters.findIndex(function (p) { return p.name === name; });
    if (i < 0) return { ok: false, error: 'Không có parameter "' + name + '".' };
    graph.parameters.splice(i, 1);
    return { ok: true };
  }

  function resetParameters(graph) {
    graph.parameters.forEach(function (p) { p.value = p.defaultValue; });
  }

  /* ================= GRAPH / NODE ================= */

  function createGraph(name) {
    return {
      version: FORMAT, mode: 'blendtree', name: name || 'Blend Tree',
      parameters: [], nodes: [], connections: [], rootId: null
    };
  }

  function addNode(graph, spec) {
    spec = spec || {};
    var type = spec.type || 'clip';
    if (['clip', 'blend1d', 'blend2d', 'add', 'random', 'mirror', 'timescale', 'layer', 'blendadditive', 'layered', 'sequence'].indexOf(type) < 0) {
      return { ok: false, error: 'Loại node lạ: ' + type };
    }
    var node = {
      id: spec.id || uid('node'), type: type,
      name: spec.name || ({ clip: 'Clip', blend1d: 'Blend 1D', blend2d: 'Blend 2D', add: 'Add / Mask', random: 'Random', mirror: 'Mirror', timescale: 'Time Scale', layer: 'Layer', blendadditive: 'Blend Additive', layered: 'Blend Layered', sequence: 'Sequence' })[type],
      x: isNum(spec.x) ? spec.x : 40, y: isNum(spec.y) ? spec.y : 40,
      clipId: spec.clipId || null,
      speed: isNum(spec.speed) ? spec.speed : 1,
      loop: spec.loop !== false,
      parameter: spec.parameter || null,      // blend1d: tên param float
      parameterX: spec.parameterX || null,   // blend2d: param trục X
      parameterY: spec.parameterY || null,   // blend2d: param trục Y
      mask: spec.mask || 'upper',            // add/layer: 'upper' | 'lower' | 'additive'
      weight: isNum(spec.weight) ? clamp(spec.weight, 0, 1) : 1, // add/blendadditive: trọng số overlay
      timeScale: isNum(spec.timeScale) ? clamp(spec.timeScale, 0.25, 2) : 1, // timescale: hệ số nhân tốc độ (0.25–2x)
      picked: isNum(spec.picked) ? spec.picked : 0, // random: chỉ số con đang chọn
      /* SM1: random mở rộng — mode 'manual' (cũ: chỉ reroll tay) |
         'trigger' (bốc lại khi triggerParam=true) | 'cycle' (bốc lại
         mỗi khi clip con hiện tại phát hết). seed=0 → Math.random,
         seed>0 → deterministic (mulberry32) để test lặp lại được. */
      mode: (spec.mode === 'trigger' || spec.mode === 'cycle' || spec.mode === 'manual') ? spec.mode : 'manual',
      triggerParam: spec.triggerParam || null,
      seed: isNum(spec.seed) ? (spec.seed | 0) : 0,
      children: []                            // [{nodeId, threshold} | {nodeId, x, y} | {nodeId, weight}]
    };
    graph.nodes.push(node);
    if (!graph.rootId) graph.rootId = node.id;
    return { ok: true, node: node };
  }

  function getNode(graph, id) {
    return graph.nodes.find(function (n) { return n.id === id; }) || null;
  }

  function removeNode(graph, id) {
    var i = graph.nodes.findIndex(function (n) { return n.id === id; });
    if (i < 0) return { ok: false, error: 'Không có node ' + id };
    graph.nodes.splice(i, 1);
    graph.nodes.forEach(function (n) {
      n.children = n.children.filter(function (c) { return c.nodeId !== id; });
    });
    graph.connections = graph.connections.filter(function (c) { return c.from !== id && c.to !== id; });
    if (graph.rootId === id) graph.rootId = graph.nodes.length ? graph.nodes[0].id : null;
    return { ok: true };
  }

  /* Nối child vào parent (parent = blend/add node, child = node con).
     data: blend1d {threshold}, blend2d {x,y}, add {} (thứ tự: base rồi overlay). */
  function connect(graph, parentId, childId, data) {
    var parent = getNode(graph, parentId), child = getNode(graph, childId);
    if (!parent || !child) return { ok: false, error: 'Node không tồn tại.' };
    if (parentId === childId) return { ok: false, error: 'Không nối node vào chính nó.' };
    if (parent.type === 'clip') return { ok: false, error: 'Node Clip không có input con.' };
    if (parent.children.some(function (c) { return c.nodeId === childId; })) {
      return { ok: false, error: 'Đã nối rồi.' };
    }
    if (parent.type === 'add' && parent.children.length >= 2) {
      return { ok: false, error: 'Node Add chỉ nhận 2 con (base + overlay).' };
    }
    /* SM1: blendadditive như add (2 con); layered như layer (tối đa 5). */
    if (parent.type === 'blendadditive' && parent.children.length >= 2) {
      return { ok: false, error: 'Node Blend Additive chỉ nhận 2 con (base + additive).' };
    }
    if ((parent.type === 'layer' || parent.type === 'layered') && parent.children.length >= 5) {
      return { ok: false, error: 'Node Layer tối đa 5 con (1 base + 4 overlay).' };
    }
    if ((parent.type === 'mirror' || parent.type === 'timescale') && parent.children.length >= 1) {
      return { ok: false, error: 'Node ' + (parent.type === 'mirror' ? 'Mirror' : 'Time Scale') + ' chỉ nhận 1 con.' };
    }
    /* Chống vòng lặp: child không được là tổ tiên của parent. */
    var seen = {};
    (function walk(id) {
      if (seen[id]) return; seen[id] = true;
      var n = getNode(graph, id);
      if (n) n.children.forEach(function (c) { walk(c.nodeId); });
    })(childId);
    if (seen[parentId]) return { ok: false, error: 'Nối này tạo vòng lặp.' };
    data = data || {};
    var entry = { nodeId: childId };
    if (parent.type === 'blend1d') entry.threshold = isNum(data.threshold) ? data.threshold : parent.children.length;
    if (parent.type === 'blend2d') { entry.x = isNum(data.x) ? data.x : 0; entry.y = isNum(data.y) ? data.y : 0; }
    /* SM1: layer/layered/random ghi trọng số từng con (mặc định 1).
       Trước đây connect() không ghi entry.weight nên trọng số layer
       luôn rơi về 1 — sửa tại đây, không đổi hành vi node cũ khác. */
    if (parent.type === 'layer' || parent.type === 'layered' || parent.type === 'random') {
      entry.weight = isNum(data.weight) ? clamp(data.weight, 0, 1) : 1;
    }
    if (parent.type === 'layer') entry.weight = isNum(data.weight) ? clamp(data.weight, 0, 1) : 1;
    parent.children.push(entry);
    graph.connections.push({ from: parentId, to: childId });
    return { ok: true, entry: entry };
  }

  function disconnect(graph, parentId, childId) {
    var parent = getNode(graph, parentId);
    if (!parent) return { ok: false, error: 'Không có node cha.' };
    var before = parent.children.length;
    parent.children = parent.children.filter(function (c) { return c.nodeId !== childId; });
    graph.connections = graph.connections.filter(function (c) { return !(c.from === parentId && c.to === childId); });
    return { ok: parent.children.length < before };
  }

  function setRoot(graph, nodeId) {
    if (!getNode(graph, nodeId)) return { ok: false, error: 'Không có node ' + nodeId };
    graph.rootId = nodeId;
    return { ok: true };
  }

  /* Node Random: chọn ngẫu nhiên 1 con (gọi khi trigger / bấm nút
     "Chọn lại" trong editor). setRandomPick để test xác định. */
  function reroll(graph, nodeId) {
    var node = getNode(graph, nodeId);
    if (!node) return { ok: false, error: 'Không có node ' + nodeId };
    if (node.type !== 'random') return { ok: false, error: 'Node "' + node.name + '" không phải Random.' };
    if (node.children.length < 2) return { ok: false, error: 'Node Random cần ≥ 2 con.' };
    node.picked = Math.floor(Math.random() * node.children.length);
    return { ok: true, picked: node.picked };
  }

  function setRandomPick(graph, nodeId, index) {
    var node = getNode(graph, nodeId);
    if (!node) return { ok: false, error: 'Không có node ' + nodeId };
    if (node.type !== 'random') return { ok: false, error: 'Node "' + node.name + '" không phải Random.' };
    if (!isNum(index) || index < 0 || index >= node.children.length) {
      return { ok: false, error: 'Chỉ số ngoài khoảng (0–' + (node.children.length - 1) + ').' };
    }
    node.picked = Math.floor(index);
    return { ok: true, picked: node.picked };
  }

  /* ================= SM1: RNG + SEQUENCE + MIRROR (thuần) ================= */

  /* mulberry32 — RNG deterministic theo seed (seed=0 → Math.random). */
  function createRng(seed) {
    if (!seed) return Math.random;
    var a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Bốc 1 con theo trọng số entry.weight (mặc định 1). rng: hàm () → [0,1).
     Trả chỉ số con; không có con → -1. */
  function computeRandomPick(children, rng) {
    var n = children.length;
    if (!n) return -1;
    var total = 0;
    var ws = children.map(function (ch) {
      var w = isNum(ch.weight) ? Math.max(0, ch.weight) : 1;
      total += w;
      return w;
    });
    if (total <= 0) return 0;
    var r = (typeof rng === 'function' ? rng() : Math.random()) * total;
    for (var i = 0; i < n; i++) {
      r -= ws[i];
      if (r <= 0) return i;
    }
    return n - 1;
  }

  /* Bốc lại có trọng số cho node Random (dùng cho mode trigger/cycle).
     counter: số lần bốc trước đó (để seed deterministic cho ra pick khác). */
  function rerollWeighted(graph, nodeId, counter) {
    var node = getNode(graph, nodeId);
    if (!node) return { ok: false, error: 'Không có node ' + nodeId };
    if (node.type !== 'random') return { ok: false, error: 'Node "' + node.name + '" không phải Random.' };
    if (node.children.length < 2) return { ok: false, error: 'Node Random cần ≥ 2 con.' };
    var rng = node.seed ? createRng(node.seed + (counter || 0) * 7919) : Math.random;
    node.picked = computeRandomPick(node.children, rng);
    return { ok: true, picked: node.picked };
  }

  /* Sequence thuần: children [{nodeId}], durations [giây/con] (song song
     thứ tự children), elapsed: thời gian đã chạy, loop: hết thì quay lại
     đầu (true) hay dừng ở con cuối (false).
     Trả {index, localTime, done} — done=true khi !loop và đã chạy hết. */
  function computeSequenceIndex(children, durations, elapsed, loop) {
    var n = children.length;
    if (!n) return { index: -1, localTime: 0, done: true };
    var durs = children.map(function (c, i) {
      var d = durations && isNum(durations[i]) ? durations[i] : 0;
      return d > 0 ? d : 0;
    });
    var total = durs.reduce(function (a, b) { return a + b; }, 0);
    if (total <= 0) return { index: 0, localTime: 0, done: false };
    var t = elapsed || 0;
    if (loop !== false) {
      t = ((t % total) + total) % total;
    } else if (t >= total) {
      return { index: n - 1, localTime: durs[n - 1], done: true };
    }
    var acc = 0;
    for (var i = 0; i < n; i++) {
      if (t < acc + durs[i]) return { index: i, localTime: t - acc, done: false };
      acc += durs[i];
    }
    return { index: n - 1, localTime: durs[n - 1], done: loop === false };
  }

  /* Mirror dùng lại — thử lần lượt các module đã có (đều trả {ok, clip}
     hoặc clip thô). Cache theo object clip để không mirror lại. */
  var _mirrorCache = [];
  function mirrorClipResolved(clip) {
    if (!clip) return null;
    for (var i = 0; i < _mirrorCache.length; i++) {
      if (_mirrorCache[i].src === clip) return _mirrorCache[i].out;
    }
    var out = null;
    var sources = [PS.ArpAnimMirror, PS.ArpSyncClips, PS.ArpAnimator, PS.ArpMirror];
    for (var s = 0; s < sources.length && !out; s++) {
      var mod = sources[s];
      if (mod && typeof mod.mirrorClip === 'function') {
        try {
          var r = mod.mirrorClip(clip);
          if (r && r.ok && r.clip) out = r.clip;
          else if (r && r.tracks) out = r; /* clip thô */
        } catch (e) { out = null; }
      }
    }
    if (!out) out = clip; /* không mirror được thì phát clip gốc */
    _mirrorCache.push({ src: clip, out: out });
    if (_mirrorCache.length > 64) _mirrorCache.shift();
    return out;
  }

  /* ================= TOÁN TRỌNG SỐ (thuần) ================= */

  /* children: [{threshold}] đã sort theo threshold; v: giá trị param.
     Trả mảng trọng số cùng thứ tự children (sau sort nội bộ — hàm trả
     kèm order để caller map lại). Dạng trả: {weights:[], order:[]} */
  function computeBlend1D(children, v) {
    var n = children.length;
    var weights = children.map(function () { return 0; });
    if (!n) return { weights: weights, order: [] };
    var idx = children.map(function (c, i) { return i; });
    idx.sort(function (a, b) { return (children[a].threshold || 0) - (children[b].threshold || 0); });
    var th = idx.map(function (i) { return children[i].threshold || 0; });
    if (n === 1) { weights[idx[0]] = 1; return { weights: weights, order: idx }; }
    if (v <= th[0]) { weights[idx[0]] = 1; return { weights: weights, order: idx }; }
    if (v >= th[n - 1]) { weights[idx[n - 1]] = 1; return { weights: weights, order: idx }; }
    for (var s = 0; s < n - 1; s++) {
      if (v >= th[s] && v <= th[s + 1]) {
        var span = th[s + 1] - th[s];
        var k = span === 0 ? 0 : (v - th[s]) / span;
        weights[idx[s]] = 1 - k;
        weights[idx[s + 1]] = k;
        return { weights: weights, order: idx };
      }
    }
    weights[idx[n - 1]] = 1;
    return { weights: weights, order: idx };
  }

  /* children: [{x, y}]. Trọng số ∝ 1/(d²+eps); khớp đúng điểm → 1. */
  function computeBlend2D(children, x, y) {
    var n = children.length;
    var weights = children.map(function () { return 0; });
    if (!n) return { weights: weights };
    for (var i = 0; i < n; i++) {
      var dx = x - (children[i].x || 0), dy = y - (children[i].y || 0);
      if (dx === 0 && dy === 0) {
        weights = children.map(function () { return 0; });
        weights[i] = 1;
        return { weights: weights };
      }
    }
    var raw = children.map(function (c) {
      var ddx = x - (c.x || 0), ddy = y - (c.y || 0);
      return 1 / (ddx * ddx + ddy * ddy + 1e-6);
    });
    var sum = raw.reduce(function (a, b) { return a + b; }, 0);
    if (sum <= 0) { weights[0] = 1; return { weights: weights }; }
    return { weights: raw.map(function (r) { return r / sum; }) };
  }

  /* Đánh giá đệ quy từ root → {weights:{clipId:w}, meta:{clipId:{speed,loop,overlay,kind,mask}}, errors:[]}.
     clipResolver(clipId) → THREE.AnimationClip | null (chỉ dùng để
     kiểm tra tồn tại; trọng số tính được cả khi clip chưa load). */
  function evaluateWeights(graph, clipResolver, opts) {
    /* SM1: opts.sequenceState = {nodeId:{index}} — runtime giữ vị trí
       sequence; không truyền thì sequence đứng ở con đầu (index 0). */
    opts = opts || {};
    var seqState = opts.sequenceState || {};
    var out = { weights: {}, meta: {}, errors: [] };
    if (!graph.nodes.length) { out.errors.push('Graph rỗng — chưa có node nào.'); return out; }
    var root = getNode(graph, graph.rootId) || graph.nodes[0];
    if (!root) { out.errors.push('Không có node root.'); return out; }
    var visiting = {};
    function addWeight(clipId, w, meta) {
      if (!clipId || w <= 0) return;
      out.weights[clipId] = (out.weights[clipId] || 0) + w;
      if (!out.meta[clipId]) out.meta[clipId] = meta;
    }
    /* ctx: {overlay, kind, mask} (từ node Add/Layer) + {mirror} (từ
       node Mirror) + {speedMul} (từ node Time Scale). */
    function evalNode(node, w, ctx) {
      if (!node || w <= 0) return;
      if (visiting[node.id]) { out.errors.push('Vòng lặp tại node "' + node.name + '".'); return; }
      visiting[node.id] = true;
      if (node.type === 'clip') {
        if (!node.clipId) out.errors.push('Node Clip "' + node.name + '" chưa chọn clip.');
        else {
          if (clipResolver) {
            var c = null;
            try { c = clipResolver(node.clipId); } catch (e) { c = null; }
            if (!c) out.errors.push('Clip "' + node.clipId + '" không tìm thấy (node "' + node.name + '").');
          }
          addWeight(node.clipId, w, {
            speed: (node.speed || 1) * (ctx && ctx.speedMul ? ctx.speedMul : 1),
            loop: node.loop !== false,
            overlay: !!(ctx && ctx.overlay),
            kind: ctx ? ctx.kind : null,
            mask: ctx ? ctx.mask : null,
            mirror: !!(ctx && ctx.mirror)
          });
        }
      } else if (node.type === 'blend1d') {
        var kids = node.children.map(function (ch) { return getNode(graph, ch.nodeId); });
        if (kids.length < 2) { out.errors.push('Node Blend 1D "' + node.name + '" cần ≥ 2 clip con (đang có ' + kids.length + ').'); }
        var v = getParameterValue(graph, node.parameter, 0);
        var r1 = computeBlend1D(node.children, +v || 0);
        node.children.forEach(function (ch, i) {
          evalNode(getNode(graph, ch.nodeId), w * r1.weights[i], ctx);
        });
      } else if (node.type === 'blend2d') {
        if (node.children.length < 2) { out.errors.push('Node Blend 2D "' + node.name + '" cần ≥ 2 clip con (đang có ' + node.children.length + ').'); }
        var vx = getParameterValue(graph, node.parameterX, 0);
        var vy = getParameterValue(graph, node.parameterY, 0);
        var r2 = computeBlend2D(node.children, +vx || 0, +vy || 0);
        node.children.forEach(function (ch, i) {
          evalNode(getNode(graph, ch.nodeId), w * r2.weights[i], ctx);
        });
      } else if (node.type === 'add') {
        if (node.children.length < 2) { out.errors.push('Node Add "' + node.name + '" cần 2 con (base + overlay).'); }
        var base = node.children[0] ? getNode(graph, node.children[0].nodeId) : null;
        var over = node.children[1] ? getNode(graph, node.children[1].nodeId) : null;
        if (base) evalNode(base, w, ctx);
        if (over) {
          var kind = node.mask === 'additive' ? 'additive' : ('mask:' + (node.mask || 'upper'));
          evalNode(over, w * (isNum(node.weight) ? node.weight : 1),
            { overlay: true, kind: kind, mask: node.mask || 'upper' });
        }
      } else if (node.type === 'blendadditive') {
        /* SM1: như Add nhưng luôn additive (không mask): base w=1,
           additive w=node.weight, blendMode Additive ở runtime. */
        if (node.children.length < 2) { out.errors.push('Node Blend Additive "' + node.name + '" cần 2 con (base + additive).'); }
        var baBase = node.children[0] ? getNode(graph, node.children[0].nodeId) : null;
        var baOver = node.children[1] ? getNode(graph, node.children[1].nodeId) : null;
        if (baBase) evalNode(baBase, w, ctx);
        if (baOver) {
          evalNode(baOver, w * (isNum(node.weight) ? node.weight : 1),
            { overlay: true, kind: 'additive', mask: 'additive' });
        }
      } else if (node.type === 'sequence') {
        /* SM1: chỉ con đang chọn phát (vị trí do runtime giữ trong
           opts.sequenceState; thuần thì mặc định con đầu). */
        if (node.children.length < 1) { out.errors.push('Node Sequence "' + node.name + '" cần ≥ 1 clip con.'); }
        var sIdx = 0;
        if (seqState[node.id] && isNum(seqState[node.id].index)) sIdx = seqState[node.id].index;
        sIdx = clamp(sIdx, 0, Math.max(0, node.children.length - 1));
        var sChild = node.children[sIdx] ? getNode(graph, node.children[sIdx].nodeId) : null;
        if (sChild) evalNode(sChild, w, ctx);
      } else if (node.type === 'layer' || node.type === 'layered') {
        /* Layer: con đầu = base, các con sau = overlay (mỗi con có
           trọng số riêng trong entry.weight, chung mask của node). */
        if (node.children.length < 2) { out.errors.push('Node Layer "' + node.name + '" cần ≥ 2 con (1 base + overlay).'); }
        node.children.forEach(function (ch, i) {
          var child = getNode(graph, ch.nodeId);
          if (!child) return;
          if (i === 0) evalNode(child, w, ctx);
          else {
            var lkind = node.mask === 'additive' ? 'additive' : ('mask:' + (node.mask || 'upper'));
            evalNode(child, w * (isNum(ch.weight) ? ch.weight : 1),
              { overlay: true, kind: lkind, mask: node.mask || 'upper' });
          }
        });
      } else if (node.type === 'random') {
        if (node.children.length < 2) { out.errors.push('Node Random "' + node.name + '" cần ≥ 2 clip con để chọn.'); }
        var pick = clamp(node.picked || 0, 0, Math.max(0, node.children.length - 1));
        var picked = node.children[pick] ? getNode(graph, node.children[pick].nodeId) : null;
        if (picked) evalNode(picked, w, ctx);
      } else if (node.type === 'mirror') {
        if (node.children.length < 1) { out.errors.push('Node Mirror "' + node.name + '" cần 1 con.'); }
        var mChild = node.children[0] ? getNode(graph, node.children[0].nodeId) : null;
        if (mChild) {
          var mCtx = Object.assign({}, ctx || {}, { mirror: true });
          evalNode(mChild, w, mCtx);
        }
      } else if (node.type === 'timescale') {
        if (node.children.length < 1) { out.errors.push('Node Time Scale "' + node.name + '" cần 1 con.'); }
        var tChild = node.children[0] ? getNode(graph, node.children[0].nodeId) : null;
        if (tChild) {
          var mul = isNum(node.timeScale) ? clamp(node.timeScale, 0.25, 2) : 1;
          if (node.parameter) {
            var pv = getParameterValue(graph, node.parameter, null);
            if (pv !== null && pv !== undefined) mul = clamp(+pv || 1, 0.25, 2);
          }
          var tCtx = Object.assign({}, ctx || {}, { speedMul: (ctx && ctx.speedMul ? ctx.speedMul : 1) * mul });
          evalNode(tChild, w, tCtx);
        }
      }
      delete visiting[node.id];
    }
    evalNode(root, 1, null);
    /* Chuẩn hoá: tổng trọng số base (không overlay) = 1. */
    var baseSum = 0;
    Object.keys(out.weights).forEach(function (id) {
      if (!out.meta[id] || !out.meta[id].overlay) baseSum += out.weights[id];
    });
    if (baseSum > 0 && Math.abs(baseSum - 1) > 1e-6) {
      Object.keys(out.weights).forEach(function (id) {
        if (!out.meta[id] || !out.meta[id].overlay) out.weights[id] /= baseSum;
      });
    }
    return out;
  }

  /* SM1: tọa độ blend hiện tại của node Blend 2D/1D — editor dùng để
     vẽ preview (chấm vị trí + trọng số từng clip con).
     Trả {ok, x, y, weights:[{clipId, nodeId, weight}]} (blend2d) hoặc
     {ok, value, weights:[...]} (blend1d); node khác → {ok:false}. */
  function getBlendPosition(graph, nodeId) {
    var node = getNode(graph, nodeId);
    if (!node) return { ok: false, error: 'Không có node ' + nodeId };
    if (node.type === 'blend2d') {
      var x = +getParameterValue(graph, node.parameterX, 0) || 0;
      var y = +getParameterValue(graph, node.parameterY, 0) || 0;
      var r = computeBlend2D(node.children, x, y);
      return {
        ok: true, type: 'blend2d', x: x, y: y,
        weights: node.children.map(function (ch, i) {
          var cn = getNode(graph, ch.nodeId);
          return { clipId: cn ? cn.clipId : null, nodeId: ch.nodeId, x: ch.x || 0, y: ch.y || 0, weight: r.weights[i] || 0 };
        })
      };
    }
    if (node.type === 'blend1d') {
      var v = +getParameterValue(graph, node.parameter, 0) || 0;
      var r1 = computeBlend1D(node.children, v);
      return {
        ok: true, type: 'blend1d', value: v,
        weights: node.children.map(function (ch, i) {
          var cn = getNode(graph, ch.nodeId);
          return { clipId: cn ? cn.clipId : null, nodeId: ch.nodeId, threshold: ch.threshold || 0, weight: r1.weights[i] || 0 };
        })
      };
    }
    return { ok: false, error: 'Node "' + node.name + '" không phải Blend 1D/2D.' };
  }

  /* SM1: đánh giá gọn cho preview/mixer — trả danh sách clip đã sort
     theo trọng số giảm dần: {ok, list:[{clipId, weight, speed, loop,
     overlay, kind, mask, mirror}], weights, meta, errors}. */
  function evaluate(graph, clipResolver, opts) {
    var ev = evaluateWeights(graph, clipResolver, opts);
    var list = Object.keys(ev.weights).map(function (id) {
      var m = ev.meta[id] || {};
      return {
        clipId: id, weight: ev.weights[id],
        speed: m.speed || 1, loop: m.loop !== false,
        overlay: !!m.overlay, kind: m.kind || null,
        mask: m.mask || null, mirror: !!m.mirror
      };
    }).sort(function (a, b) { return b.weight - a.weight; });
    return { ok: ev.errors.length === 0, list: list, weights: ev.weights, meta: ev.meta, errors: ev.errors };
  }

  function validate(graph, clipResolver) {
    var errors = [];
    if (!graph.nodes.length) errors.push('Graph rỗng — thêm node Clip/Blend rồi nối dây.');
    if (!getNode(graph, graph.rootId)) errors.push('Chưa chọn node root.');
    var ev = evaluateWeights(graph, clipResolver);
    ev.errors.forEach(function (e) { if (errors.indexOf(e) < 0) errors.push(e); });
    /* Parameter dùng trong node phải tồn tại. */
    graph.nodes.forEach(function (n) {
      [n.parameter, n.parameterX, n.parameterY, n.triggerParam].forEach(function (pn) {
        if (pn && !getParameter(graph, pn)) errors.push('Node "' + n.name + '" dùng parameter "' + pn + '" không tồn tại.');
      });
    });
    return { ok: errors.length === 0, errors: errors };
  }

  /* ================= CLIP NGUỒN ================= */

  function clipList() {
    var out = [], seen = {};
    function push(id, name, source, duration) {
      if (!id || seen[id]) return seen[id] ? out.find(function (e) { return e.id === id; }) : null;
      seen[id] = true;
      var entry = { id: id, name: name || id, source: source || '', duration: duration || 0 };
      out.push(entry);
      return entry;
    }
    try {
      var SC = PS.ArpSyncClips;
      if (SC && typeof SC.listAllClips === 'function') {
        SC.listAllClips().forEach(function (e) {
          var entry = push(e.id, e.name, e.source, e.duration);
          if (entry && (e.clipObject || e.keys)) entry.hasClip = true;
        });
      }
    } catch (e) {}
    try {
      var RAG = PS.RigAutoGen;
      if (RAG && RAG.current && Array.isArray(RAG.current.clips)) {
        RAG.current.clips.forEach(function (c) { if (c) push(c.id, c.name || c.id, 'rig', c.clip ? c.clip.duration : 0); });
      }
    } catch (e) {}
    try {
      var AN = PS.ArpAnimator;
      if (AN && typeof AN.listClips === 'function') {
        AN.listClips().forEach(function (e) {
          var entry = push(e.id, e.name, e.source, e.duration);
          if (entry && e.clip) entry.hasClip = true;
        });
      }
    } catch (e) {}
    return out;
  }

  /* clipId → THREE.AnimationClip | null (qua sync-clips / Animator / rig). */
  function resolveClip(clipId) {
    if (!clipId) return null;
    try {
      var SC = PS.ArpSyncClips;
      if (SC && typeof SC.listAllClips === 'function') {
        var hit = SC.listAllClips().find(function (e) { return e.id === clipId; });
        if (hit && hit.clipObject) return hit.clipObject;
        if (hit && hit.keys && SC.buildClipFromKeys) {
          try { var built = SC.buildClipFromKeys(hit); if (built) return built; } catch (e) {}
        }
      }
    } catch (e) {}
    try {
      var AN = PS.ArpAnimator;
      if (AN && typeof AN.getClip === 'function') {
        var e2 = AN.getClip(clipId);
        if (e2 && e2.clip) return e2.clip;
      }
    } catch (e) {}
    try {
      var RAG = PS.RigAutoGen;
      if (RAG && RAG.current && Array.isArray(RAG.current.clips)) {
        var c = RAG.current.clips.find(function (x) { return x && x.id === clipId; });
        if (c) return c.clip || c;
      }
    } catch (e) {}
    return null;
  }

  /* ================= RUNTIME PHÁT ================= */

  function createRuntime() {
    var rt = {
      target: null, mixer: null, graph: null,
      actions: {},        // clipId -> {action, clip, kind}
      weights: {}, meta: {},
      playing: false, smoothing: 0,
      _lastEmitted: '',
      _pendingTriggerReset: [],
      /* SM1: vị trí sequence {nodeId:{index,t}} + số lần bốc random
         {nodeId:{n}} (để seed deterministic cho pick khác nhau). */
      _seqState: {}, _randState: {}
    };

    rt.setTarget = function (root) {
      rt.target = root || null;
      rt.mixer = null;
      rt.actions = {};
      if (root && T && T.AnimationMixer) {
        try { rt.mixer = new T.AnimationMixer(root); } catch (e) { rt.mixer = null; }
      }
      return { ok: !!rt.mixer };
    };

    rt.setParameter = function (name, value) {
      if (!rt.graph) return { ok: false, error: 'Chưa có graph.' };
      var r = setParameter(rt.graph, name, value);
      if (r.ok && getParameter(rt.graph, name).type === 'trigger' && r.value === true) {
        rt._pendingTriggerReset.push(name);
      }
      return r;
    };

    function actionFor(clipId, meta) {
      var clip = resolveClip(clipId);
      if (!clip) return null;
      /* SM1: Node Mirror — lật clip qua mirrorClipResolved (dùng lại
         ArpAnimMirror → ArpSyncClips → ArpAnimator → ArpMirror, có
         cache theo clipId để không mirror lại mỗi tick). */
      if (meta && meta.mirror) {
        if (!rt._mirrorCache) rt._mirrorCache = {};
        if (!rt._mirrorCache[clipId]) {
          rt._mirrorCache[clipId] = mirrorClipResolved(clip) || clip;
        }
        clip = rt._mirrorCache[clipId];
      }
      var key = clipId + '|' + ((meta && meta.overlay) ? (meta.kind || 'overlay') : 'base') + ((meta && meta.mirror) ? '|mirror' : '');
      var entry = rt.actions[key];
      if (entry) return entry;
      if (!rt.mixer) return null;
      var playClip = clip;
      try {
        var AB = PS.AnimBlender;
        if (meta && meta.overlay && AB) {
          if (meta.kind === 'additive' && typeof AB.makeAdditive === 'function') {
            playClip = AB.makeAdditive(clip);
          } else if (meta.kind && meta.kind.indexOf('mask:') === 0 && typeof AB.maskedClip === 'function') {
            var bones = meta.mask === 'lower' ? AB.LOWER_BODY : AB.UPPER_BODY;
            var mc = AB.maskedClip(clip, bones);
            if (mc && mc.kept) playClip = mc.clip; else return null;
          }
        }
      } catch (e) { playClip = clip; }
      var action;
      try {
        action = rt.mixer.clipAction(playClip);
        action.reset();
        action.setLoop(meta && meta.loop === false ? T.LoopOnce : T.LoopRepeat);
        if (meta && meta.overlay && meta.kind === 'additive' && ('blendMode' in action) && T.AdditiveAnimationBlendMode !== undefined) {
          action.blendMode = T.AdditiveAnimationBlendMode;
        }
        action.setEffectiveWeight(0);
        action.play();
      } catch (e) { return null; }
      entry = { action: action, clip: playClip, kind: key };
      rt.actions[key] = entry;
      return entry;
    }

    /* Áp trọng số mục tiêu lên các action (smoothing=0 → áp ngay). */
    rt._applyWeights = function (evalOut, dt) {
      var targets = evalOut.weights, meta = evalOut.meta;
      var k = rt.smoothing > 0 && dt > 0 ? Math.min(1, dt / rt.smoothing) : 1;
      Object.keys(rt.actions).forEach(function (key) {
        var clipId = key.split('|')[0];
        var want = targets[clipId] || 0;
        var entry = rt.actions[key];
        var cur = entry.action.getEffectiveWeight();
        var next = cur + (want - cur) * k;
        if (Math.abs(next) < 0.001) next = 0;
        entry.action.setEffectiveWeight(next);
        if (next <= 0 && entry.action.paused === false) { /* giữ action để resume rẻ */ }
      });
      Object.keys(targets).forEach(function (clipId) {
        var entry = actionFor(clipId, meta[clipId]);
        if (!entry) return;
        var want = targets[clipId] || 0;
        var cur = entry.action.getEffectiveWeight();
        var next = cur + (want - cur) * k;
        entry.action.setEffectiveWeight(next);
        var speed = (meta[clipId] && meta[clipId].speed) || 1;
        try { entry.action.setEffectiveTimeScale(speed); } catch (e) {}
      });
      rt.weights = targets;
      rt.meta = meta;
      var sig = JSON.stringify(targets);
      if (sig !== rt._lastEmitted) {
        rt._lastEmitted = sig;
        try {
          bus.emit('anim:graph-state-changed', {
            mode: 'blendtree', weights: targets,
            currentClipIds: Object.keys(targets).filter(function (id) { return targets[id] > 0.01; })
          });
        } catch (e) {}
      }
    };

    rt.playGraph = function (graph) {
      if (!graph) return { ok: false, error: 'Chưa có graph.' };
      if (!rt.mixer) return { ok: false, error: 'Chưa có model target — rig/import model trước.' };
      var v = validate(graph, resolveClip);
      if (!v.ok) return { ok: false, error: 'Graph lỗi: ' + v.errors.join(' ') };
      rt.graph = graph;
      rt.playing = true;
      rt._seqState = {}; /* SM1: phát lại từ đầu sequence */
      rt._randState = {};
      var ev = evaluateWeights(graph, resolveClip, { sequenceState: rt._seqState });
      rt._applyWeights(ev, 0);
      return { ok: true, weights: ev.weights };
    };

    /* Phát 1 clip duy nhất (State Machine dùng — crossfade mượt). */
    rt.playSingle = function (clipId, opts) {
      opts = opts || {};
      if (!rt.mixer) return { ok: false, error: 'Chưa có model target.' };
      var clip = resolveClip(clipId);
      if (!clip) return { ok: false, error: 'Không tìm thấy clip "' + clipId + '".' };
      var meta = { speed: opts.speed || 1, loop: opts.loop !== false };
      var entry = actionFor(clipId, meta);
      if (!entry) return { ok: false, error: 'Không tạo được action cho "' + clipId + '".' };
      var dur = Math.max(0.05, opts.crossfade || 0);
      var prev = rt._singleCurrent;
      /* reset() và setEffectiveWeight() đều gọi stopFading() (r128) nên
         PHẢI reset trước, rồi mới crossFadeTo; khi crossfade thì KHÔNG
         set weight=1 (sẽ hủy ramp fade-in). */
      entry.action.reset();
      try { entry.action.setEffectiveTimeScale(meta.speed); } catch (e) {}
      if (prev && prev !== entry && dur > 0) {
        try { prev.action.crossFadeTo(entry.action, dur, false); } catch (e) {}
        /* _updateWeight (r128) nhân this.weight với ramp fade — weight
           phải = 1 để ramp có tác dụng. Gán TRỰC TIẾP action.weight
           (không qua setEffectiveWeight vì setter gọi stopFading(),
           sẽ hủy ramp vừa lên lịch). */
        entry.action.weight = 1;
      } else {
        if (prev && prev !== entry) {
          try { prev.action.setEffectiveWeight(0); prev.action.stop(); } catch (e) {}
        }
        entry.action.setEffectiveWeight(1);
      }
      entry.action.play();
      rt._singleCurrent = entry;
      rt._singleClipId = clipId;
      rt.playing = true;
      try {
        bus.emit('anim:graph-state-changed', { mode: 'statemachine', currentClipIds: [clipId], state: opts.stateName || clipId });
      } catch (e) {}
      return { ok: true, clipId: clipId };
    };

    /* SM1: tiến sequence + random cycle/trigger mỗi tick, TRƯỚC khi
       đánh giá trọng số. Sequence: hết thời lượng clip con hiện tại
       (clip trực tiếp; con lồng nhau dùng 1s) thì sang con tiếp (hết
       thì quay đầu nếu node.loop, không thì dừng ở con cuối). */
    rt._advanceDynamicNodes = function (dt) {
      if (!rt.graph) return;
      rt.graph.nodes.forEach(function (node) {
        if (node.type === 'sequence') {
          var st = rt._seqState[node.id] || (rt._seqState[node.id] = { index: 0, t: 0 });
          if (!node.children.length) return;
          var entry = node.children[clamp(st.index, 0, node.children.length - 1)];
          var dur = 1;
          var cn = entry ? getNode(rt.graph, entry.nodeId) : null;
          if (cn && cn.type === 'clip' && cn.clipId) {
            var c = resolveClip(cn.clipId);
            if (c && c.duration > 0) dur = c.duration / ((cn.speed || 1) * 1);
          }
          st.t += dt;
          if (st.t >= dur) {
            st.t = 0;
            st.index++;
            if (st.index >= node.children.length) {
              st.index = node.loop === false ? node.children.length - 1 : 0;
            }
          }
        } else if (node.type === 'random' && node.children.length >= 2) {
          if (node.mode === 'trigger' && node.triggerParam) {
            var p = getParameter(rt.graph, node.triggerParam);
            if (p && p.value === true) {
              var rs = rt._randState[node.id] || (rt._randState[node.id] = { n: 0 });
              rs.n++;
              rerollWeighted(rt.graph, node.id, rs.n);
            }
          } else if (node.mode === 'cycle') {
            var cs = rt._seqState[node.id] || (rt._seqState[node.id] = { index: 0, t: 0 });
            var centry = node.children[clamp(node.picked || 0, 0, node.children.length - 1)];
            var cdur = 1;
            var ccn = centry ? getNode(rt.graph, centry.nodeId) : null;
            if (ccn && ccn.type === 'clip' && ccn.clipId) {
              var cc = resolveClip(ccn.clipId);
              if (cc && cc.duration > 0) cdur = cc.duration / (ccn.speed || 1);
            }
            cs.t += dt;
            if (cs.t >= cdur) {
              cs.t = 0;
              var rs2 = rt._randState[node.id] || (rt._randState[node.id] = { n: 0 });
              rs2.n++;
              rerollWeighted(rt.graph, node.id, rs2.n);
            }
          }
        }
      });
    };

    rt.tick = function (dt) {
      if (!rt.playing || !rt.mixer) return { ok: false, reason: 'not-playing' };
      dt = dt || 0;
      if (rt.graph) {
        rt._advanceDynamicNodes(dt); /* SM1: sequence/random trước */
        var ev = evaluateWeights(rt.graph, resolveClip, { sequenceState: rt._seqState });
        rt._applyWeights(ev, dt);
        /* Trigger: tiêu thụ xong 1 tick thì reset về false. */
        if (rt._pendingTriggerReset.length) {
          rt._pendingTriggerReset.forEach(function (n) {
            var p = getParameter(rt.graph, n);
            if (p) p.value = false;
          });
          rt._pendingTriggerReset = [];
        }
      }
      try { rt.mixer.update(dt); } catch (e) {}
      return { ok: true, time: rt.mixer.time };
    };

    rt.stop = function () {
      rt.playing = false;
      rt.graph = null;
      Object.keys(rt.actions).forEach(function (key) {
        try { rt.actions[key].action.stop(); } catch (e) {}
      });
      rt.actions = {};
      rt._singleCurrent = null;
      rt.weights = {};
      return { ok: true };
    };

    rt.getWeights = function () { return rt.weights || {}; };
    rt.currentClipIds = function () {
      return Object.keys(rt.weights || {}).filter(function (id) { return rt.weights[id] > 0.01; });
    };
    /* SM1: preview API — tọa độ blend + danh sách clip có trọng số. */
    rt.getBlendPosition = function (nodeId) {
      if (!rt.graph) return { ok: false, error: 'Chưa có graph.' };
      return getBlendPosition(rt.graph, nodeId);
    };
    rt.evaluate = function () {
      if (!rt.graph) return { ok: false, error: 'Chưa có graph.', list: [] };
      return evaluate(rt.graph, resolveClip, { sequenceState: rt._seqState });
    };
    return rt;
  }

  /* ================= LƯU / TẢI (AnimGraphIO) ================= */

  function serialize(graph) {
    return {
      format: FORMAT, version: 1,
      name: graph.name || 'Anim Graph',
      mode: graph.mode || 'blendtree',
      parameters: graph.parameters || [],
      nodes: graph.nodes || [],
      connections: graph.connections || [],
      rootId: graph.rootId || null,
      states: graph.states || undefined,
      transitions: graph.transitions || undefined,
      entryStateId: graph.entryStateId || undefined
    };
  }

  function deserialize(data) {
    if (!data || typeof data !== 'object') return { ok: false, error: 'Dữ liệu không phải JSON object.' };
    if (data.format !== FORMAT) return { ok: false, error: 'Format lạ: ' + (data.format || '(trống)') + ' — cần ' + FORMAT + '.' };
    var graph = {
      version: FORMAT, mode: data.mode || 'blendtree',
      name: data.name || 'Anim Graph',
      parameters: Array.isArray(data.parameters) ? data.parameters : [],
      nodes: Array.isArray(data.nodes) ? data.nodes : [],
      connections: Array.isArray(data.connections) ? data.connections : [],
      rootId: data.rootId || null
    };
    if (graph.mode === 'statemachine') {
      graph.states = Array.isArray(data.states) ? data.states : [];
      graph.transitions = Array.isArray(data.transitions) ? data.transitions : [];
      graph.entryStateId = data.entryStateId || null;
    }
    /* Khôi phục trường mặc định cho node cũ. */
    graph.nodes.forEach(function (n) {
      if (!n.children) n.children = [];
      if (n.speed === undefined) n.speed = 1;
      if (n.loop === undefined) n.loop = true;
      if (n.x === undefined) n.x = 40;
      if (n.y === undefined) n.y = 40;
      if (n.timeScale === undefined) n.timeScale = 1;
      else n.timeScale = clamp(n.timeScale, 0.25, 2); /* SM1: kẹp 0.25–2x */
      if (n.picked === undefined) n.picked = 0;
      /* SM1: field mới của random/sequence. */
      if (n.mode === undefined && n.type === 'random') n.mode = 'manual';
      if (n.triggerParam === undefined) n.triggerParam = null;
      if (n.seed === undefined) n.seed = 0;
      (n.children || []).forEach(function (ch) {
        if ((n.type === 'layer' || n.type === 'layered' || n.type === 'random') && ch.weight === undefined) ch.weight = 1;
      });
    });
    (graph.states || []).forEach(function (s) {
      if (s.isExit === undefined) s.isExit = false;
      if (!s.onEnter) s.onEnter = [];
      if (!s.onExit) s.onExit = [];
    });
    (graph.transitions || []).forEach(function (t) {
      if (t.interrupt === undefined) t.interrupt = false;
    });
    return { ok: true, graph: graph };
  }

  function saveToStorage(graph, key) {
    try {
      var s = JSON.stringify(serialize(graph));
      (typeof localStorage !== 'undefined' ? localStorage : (typeof window !== 'undefined' ? window.localStorage : null))
        .setItem(key || STORAGE_KEY, s);
      return { ok: true, bytes: s.length };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  function loadFromStorage(key) {
    try {
      var ls = (typeof localStorage !== 'undefined' ? localStorage : (typeof window !== 'undefined' ? window.localStorage : null));
      var s = ls && ls.getItem(key || STORAGE_KEY);
      if (!s) return { ok: false, error: 'Chưa có graph đã lưu.' };
      return deserialize(JSON.parse(s));
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  var BlendTree = {
    FORMAT: FORMAT, STORAGE_KEY: STORAGE_KEY,
    createGraph: createGraph,
    addParameter: addParameter, getParameter: getParameter,
    setParameter: setParameter, getParameterValue: getParameterValue,
    removeParameter: removeParameter, resetParameters: resetParameters,
    addNode: addNode, getNode: getNode, removeNode: removeNode,
    connect: connect, disconnect: disconnect, setRoot: setRoot,
    reroll: reroll, setRandomPick: setRandomPick,
    /* SM1 */
    createRng: createRng, computeRandomPick: computeRandomPick,
    rerollWeighted: rerollWeighted, computeSequenceIndex: computeSequenceIndex,
    mirrorClipResolved: mirrorClipResolved,
    getBlendPosition: getBlendPosition, evaluate: evaluate,
    NODE_TYPES: ['clip', 'blend1d', 'blend2d', 'add', 'blendadditive', 'layered', 'layer', 'random', 'sequence', 'mirror', 'timescale'],
    computeBlend1D: computeBlend1D, computeBlend2D: computeBlend2D,
    evaluateWeights: evaluateWeights, validate: validate,
    clipList: clipList, resolveClip: resolveClip,
    createRuntime: createRuntime,
    serialize: serialize, deserialize: deserialize,
    saveToStorage: saveToStorage, loadFromStorage: loadFromStorage,
    _test: { uid: uid }
  };

  PS.AnimBlendTree = BlendTree;
  PS.AnimGraphIO = {
    FORMAT: FORMAT, STORAGE_KEY: STORAGE_KEY,
    serialize: serialize, deserialize: deserialize,
    saveToStorage: saveToStorage, loadFromStorage: loadFromStorage
  };
})();
