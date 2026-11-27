/* ============================================================
 * animation/anim-statemachine.js — ANIMATION STATE MACHINE
 *
 * State Machine cho studio 3D-Model (Auto Rig Pro Blend).
 * DÙNG LẠI, không viết lại:
 *   • PixiStudio.AnimBlendTree — parameter (float/int/bool/
 *     trigger), clipList/resolveClip, AnimGraphIO (JSON format
 *     'pixistudio-anim-graph-1'), AnimGraphRuntime.playSingle
 *     (crossfade qua THREE.AnimationAction.crossFadeTo).
 *   • Clip nguồn qua ArpSyncClips / Animator / RigAutoGen
 *     (xem AnimBlendTree.resolveClip).
 *
 * STATE = 1 clip (Idle/Walk/Run/Attack...). TRANSITION có:
 *   • conditions: [{param, op, value}] — op ∈ > < == >= <= != ;
 *     nhiều điều kiện = AND.
 *   • duration: thời gian crossfade (giây).
 *   • exitTime: 0..1 — chỉ chuyển khi clip chạy tới X% (nếu bật).
 *   • from='*' — Any State: chuyển từ BẤT KỲ state nào.
 *   • entryStateId: state mặc định khi bắt đầu phát.
 *
 * RUNTIME: tick(dt) gọn nhẹ — mỗi frame chỉ kiểm tra transition
 * của state hiện tại (+ Any State), không duyệt toàn bộ graph.
 * Chuyển state = crossfade qua runtime.playSingle. Trigger param
 * tự reset sau khi 1 transition tiêu thụ nó.
 *
 * Không sửa arp-animator.js / save-manager.js. Tích hợp qua bus
 * 'anim:graph-state-changed' {mode:'statemachine', state, from, to}.
 *
 * MỞ RỘNG SM1 (2026-11-27, vòng Animation — nhóm SM1 runtime):
 * Đã có từ trước / do coordinator song song làm: sub-machine (stack
 * frame, isExit bật về frame cha), onEnter/onExit (notify/setParam/
 * emit), interrupt, validate đệ quy + kế thừa parameter.
 * Nhóm SM1 bổ sung (file này): điều kiện phức tạp — transition.logic
 * 'AND'|'OR' + conditionTree đệ quy {op:'AND'|'OR', conditions:[...]};
 * subExitTo — sau khi sub-machine exit thì frame cha chuyển tiếp tới
 * state này; action onEnter/onExit loại 'sound' (bus
 * 'anim:graph-play-sound'); API runtime playState(name),
 * getActiveState(), getActiveTransition() ({from, to, progress});
 * interrupt còn xét transition từ state nguồn đang crossfade và bỏ
 * qua exitTime với transition interrupt; deserialize chuẩn hoá đệ
 * quy cả sub-machine. Entry = entryStateId (cờ isEntry đồng bộ).
 * ============================================================ */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined' && window.PixiStudio) || {};
  var bus = (PS && PS.bus) || { emit: function () {}, on: function () {} };
  var BT = null;
  try { BT = PS.AnimBlendTree || null; } catch (e) { BT = null; }

  var FORMAT = 'pixistudio-anim-graph-1';
  var _uid = 0;
  function uid(prefix) { _uid++; return (prefix || 's') + '_' + Date.now().toString(36) + '_' + _uid; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function bt() { return PS.AnimBlendTree || BT; }

  /* ================= MODEL ================= */

  function createStateMachine(name) {
    return {
      version: FORMAT, mode: 'statemachine', name: name || 'State Machine',
      parameters: [], states: [], transitions: [], entryStateId: null
    };
  }

  function addState(sm, spec) {
    spec = spec || {};
    var name = String(spec.name || '').trim();
    if (!name) return { ok: false, error: 'Tên state trống.' };
    if (sm.states.some(function (s) { return s.name === name; })) {
      return { ok: false, error: 'State "' + name + '" đã tồn tại.' };
    }
    var st = {
      id: spec.id || uid('state'), name: name,
      clipId: spec.clipId || null,
      speed: isNum(spec.speed) ? spec.speed : 1,
      loop: spec.loop !== false,
      x: isNum(spec.x) ? spec.x : 40, y: isNum(spec.y) ? spec.y : 40,
      /* Mở rộng 11:42: isExit = state kết thúc sub-machine (quay về
         state cha); subMachine = state machine con nhúng (object cùng
         format); onEnter/onExit = [{type:'notify'|'setParam'|'emit', ...}].
         SM1: subExitTo = state ở máy cha sẽ chuyển tới khi sub-machine
         exit (null = ở lại state cha); isEntry = cờ đồng bộ entry. */
      isExit: !!spec.isExit,
      isEntry: !!spec.isEntry,
      subMachine: spec.subMachine || null,
      subExitTo: spec.subExitTo || null,
      onEnter: Array.isArray(spec.onEnter) ? spec.onEnter : [],
      onExit: Array.isArray(spec.onExit) ? spec.onExit : []
    };
    sm.states.push(st);
    if (!sm.entryStateId) { sm.entryStateId = st.id; st.isEntry = true; }
    return { ok: true, state: st };
  }

  function getState(sm, id) {
    return sm.states.find(function (s) { return s.id === id; }) || null;
  }

  function removeState(sm, id) {
    var i = sm.states.findIndex(function (s) { return s.id === id; });
    if (i < 0) return { ok: false, error: 'Không có state ' + id };
    sm.states.splice(i, 1);
    sm.transitions = sm.transitions.filter(function (t) { return t.from !== id && t.to !== id; });
    if (sm.entryStateId === id) sm.entryStateId = sm.states.length ? sm.states[0].id : null;
    return { ok: true };
  }

  function setEntry(sm, id) {
    if (!getState(sm, id)) return { ok: false, error: 'Không có state ' + id };
    sm.entryStateId = id;
    /* SM1: đồng bộ cờ isEntry để editor vẽ đúng state bắt đầu. */
    sm.states.forEach(function (s) { s.isEntry = (s.id === id); });
    return { ok: true };
  }

  var OPS = ['>', '<', '==', '>=', '<=', '!='];
  function addTransition(sm, spec) {
    spec = spec || {};
    var from = spec.from || '*';
    var to = spec.to;
    if (!to) return { ok: false, error: 'Transition cần state đích (to).' };
    if (!getState(sm, to)) return { ok: false, error: 'Không có state đích ' + to };
    if (from !== '*' && !getState(sm, from)) return { ok: false, error: 'Không có state nguồn ' + from };
    if (from !== '*' && from === to) return { ok: false, error: 'Transition tự tới chính nó.' };
    var conds = Array.isArray(spec.conditions) ? spec.conditions : [];
    for (var i = 0; i < conds.length; i++) {
      var c = conds[i];
      if (!c.param) return { ok: false, error: 'Điều kiện #' + (i + 1) + ' thiếu tên parameter.' };
      if (OPS.indexOf(c.op) < 0) return { ok: false, error: 'Toán tử lạ: ' + c.op + ' (dùng ' + OPS.join(' ') + ').' };
    }
    /* SM1: cây điều kiện đệ quy {op:'AND'|'OR', conditions:[cond|nhóm]}.
       Kiểm tra từng lá (param + op) giống conditions thường. */
    var tree = spec.conditionTree || null;
    if (tree) {
      var treeErr = validateConditionTree(tree);
      if (treeErr) return { ok: false, error: treeErr };
    }
    var tr = {
      id: spec.id || uid('trans'),
      from: from, to: to,
      conditions: conds.map(function (c) { return { param: c.param, op: c.op, value: c.value }; }),
      /* SM1: logic 'AND' (mặc định, giữ hành vi cũ) | 'OR' cho danh
         sách conditions phẳng; conditionTree (nếu có) thắng cả hai. */
      logic: spec.logic === 'OR' ? 'OR' : 'AND',
      conditionTree: tree,
      duration: isNum(spec.duration) ? Math.max(0, spec.duration) : 0.3,
      hasExitTime: !!spec.hasExitTime,
      exitTime: isNum(spec.exitTime) ? Math.max(0, Math.min(1, spec.exitTime)) : 1,
      /* Mở rộng 11:42: interrupt=true → transition này được phép cắt
         ngang crossfade đang chạy (mặc định false). */
      interrupt: !!spec.interrupt,
      name: spec.name || ''
    };
    sm.transitions.push(tr);
    return { ok: true, transition: tr };
  }

  function removeTransition(sm, id) {
    var i = sm.transitions.findIndex(function (t) { return t.id === id; });
    if (i < 0) return { ok: false, error: 'Không có transition ' + id };
    sm.transitions.splice(i, 1);
    return { ok: true };
  }

  /* ================= ĐIỀU KIỆN ================= */

  function paramValue(sm, name) {
    var B = bt();
    if (B && typeof B.getParameterValue === 'function') return B.getParameterValue(sm, name, undefined);
    var p = (sm.parameters || []).find(function (x) { return x.name === name; });
    return p ? p.value : undefined;
  }

  function evaluateCondition(sm, cond) {
    var v = paramValue(sm, cond.param);
    if (v === undefined) return false;
    var target = cond.value;
    switch (cond.op) {
      case '>': return v > target;
      case '<': return v < target;
      case '>=': return v >= target;
      case '<=': return v <= target;
      case '==': return v == target; /* eslint-disable-line eqeqeq */
      case '!=': return v != target; /* eslint-disable-line eqeqeq */
      default: return false;
    }
  }

  /* Nhiều điều kiện = AND. Không có điều kiện = luôn đúng (chỉ còn
     phụ thuộc exitTime nếu bật).
     SM1: nếu transition có conditionTree thì dùng cây; nếu logic='OR'
     thì chỉ cần 1 điều kiện đúng; mặc định AND (giữ hành vi cũ). */
  function conditionsMet(sm, transition) {
    if (transition.conditionTree) return evaluateConditionGroup(sm, transition.conditionTree);
    var list = transition.conditions || [];
    if (transition.logic === 'OR') {
      if (!list.length) return true;
      return list.some(function (c) { return evaluateCondition(sm, c); });
    }
    return list.every(function (c) { return evaluateCondition(sm, c); });
  }

  /* SM1: kiểm tra cây điều kiện đệ quy — node nhóm {op:'AND'|'OR',
     conditions:[...]} hoặc lá {param, op, value}. Trả chuỗi lỗi hoặc null. */
  function validateConditionTree(node) {
    if (!node || typeof node !== 'object') return 'conditionTree không phải object.';
    if (node.param) {
      if (OPS.indexOf(node.op) < 0) return 'Toán tử lạ trong conditionTree: ' + node.op;
      return null;
    }
    if (node.op !== 'AND' && node.op !== 'OR') return 'Nhóm điều kiện cần op AND/OR, nhận được: ' + node.op;
    if (!Array.isArray(node.conditions) || !node.conditions.length) return 'Nhóm điều kiện rỗng.';
    for (var i = 0; i < node.conditions.length; i++) {
      var e = validateConditionTree(node.conditions[i]);
      if (e) return e;
    }
    return null;
  }

  /* SM1: đánh giá cây điều kiện — lá dùng evaluateCondition, nhóm
     AND = mọi con đúng, OR = 1 con đúng. valueGetter (tuỳ chọn) để
     runtime tra parameter xuyên frame cha/con. */
  function evaluateConditionGroup(sm, group, valueGetter) {
    if (!group || typeof group !== 'object') return true;
    if (group.param) {
      if (typeof valueGetter === 'function') {
        var v = valueGetter(group.param);
        if (v === undefined) return false;
        var target = group.value;
        switch (group.op) {
          case '>': return v > target;
          case '<': return v < target;
          case '>=': return v >= target;
          case '<=': return v <= target;
          case '==': return v == target; /* eslint-disable-line eqeqeq */
          case '!=': return v != target; /* eslint-disable-line eqeqeq */
          default: return false;
        }
      }
      return evaluateCondition(sm, group);
    }
    var list = group.conditions || [];
    if (!list.length) return true;
    if (group.op === 'OR') return list.some(function (c) { return evaluateConditionGroup(sm, c, valueGetter); });
    return list.every(function (c) { return evaluateConditionGroup(sm, c, valueGetter); });
  }

  /* SM1: gom tên parameter trong cây điều kiện (để validate). */
  function conditionTreeParams(node, out) {
    out = out || [];
    if (!node || typeof node !== 'object') return out;
    if (node.param) { if (out.indexOf(node.param) < 0) out.push(node.param); return out; }
    (node.conditions || []).forEach(function (c) { conditionTreeParams(c, out); });
    return out;
  }

  /* SM1: chạy action onEnter/onExit của state.
     Loại action: notify (bus notify) | setParam (đổi parameter) |
     emit (bus 'anim:graph-state-action') | sound (bus
     'anim:graph-play-sound' {sound, state} — studio chưa có audio
     engine riêng nên chỉ phát bus, UI/audio hook nghe để phát). */
  function runStateActions(sm, state, when) {
    if (!state) return [];
    var list = when === 'onEnter' ? (state.onEnter || []) : (state.onExit || []);
    var done = [];
    list.forEach(function (a) {
      try {
        if (a.type === 'notify') {
          bus.emit('notify', { type: 'info', title: 'Anim Graph', message: a.message || (state.name + ' ' + when) });
        } else if (a.type === 'setParam') {
          var B2 = bt();
          if (B2) B2.setParameter(sm, a.param, a.value);
        } else if (a.type === 'emit') {
          bus.emit('anim:graph-state-action', { state: state.name, when: when, name: a.name || a.type, value: a.value });
        } else if (a.type === 'sound') {
          bus.emit('anim:graph-play-sound', { sound: a.sound || a.name || '', state: state.name, when: when });
        }
        done.push(a);
      } catch (e) {}
    });
    return done;
  }

  /* SM1: thêm 1 action vào onEnter/onExit của state. */
  function addStateAction(sm, stateId, when, action) {
    var st = getState(sm, stateId);
    if (!st) return { ok: false, error: 'Không có state ' + stateId };
    if (when !== 'onEnter' && when !== 'onExit') return { ok: false, error: 'when phải là onEnter/onExit.' };
    if (!action || !action.type) return { ok: false, error: 'Action cần type.' };
    if (!st[when]) st[when] = [];
    st[when].push(action);
    return { ok: true };
  }

  function validate(sm, clipResolver) {
    var errors = [];
    if (!sm.states.length) errors.push('State Machine rỗng — thêm state rồi gán clip.');
    if (!getState(sm, sm.entryStateId)) errors.push('Chưa chọn state mặc định (entry).');
    var B = bt();
    sm.states.forEach(function (s) {
      if (s.subMachine) {
        /* State sub-machine: clip riêng không bắt buộc; kiểm tra đệ quy.
           Sub-machine kế thừa parameter của máy cha khi chưa có riêng. */
        if (!s.subMachine.parameters || !s.subMachine.parameters.length) {
          s.subMachine.parameters = sm.parameters || [];
        }
        /* SM1: subExitTo (nếu có) phải là state tồn tại trong máy cha. */
        if (s.subExitTo && !getState(sm, s.subExitTo)) {
          errors.push('State "' + s.name + '": subExitTo tới state không tồn tại.');
        }
        var sub = validate(s.subMachine, clipResolver);
        sub.errors.forEach(function (e) { errors.push('Sub-machine "' + s.name + '": ' + e); });
        return;
      }
      if (s.isExit) return; /* Exit state không cần clip. */
      if (!s.clipId) errors.push('State "' + s.name + '" chưa gán clip.');
      else if (clipResolver) {
        var c = null;
        try { c = clipResolver(s.clipId); } catch (e) { c = null; }
        if (!c) errors.push('State "' + s.name + '": clip "' + s.clipId + '" không tìm thấy.');
      }
    });
    sm.transitions.forEach(function (t) {
      if (!getState(sm, t.to)) errors.push('Transition tới state không tồn tại.');
      if (t.from !== '*' && !getState(sm, t.from)) errors.push('Transition từ state không tồn tại.');
      (t.conditions || []).forEach(function (cond) {
        if (paramValue(sm, cond.param) === undefined) {
          errors.push('Transition → "' + (getState(sm, t.to) || {}).name + '": parameter "' + cond.param + '" không tồn tại.');
        }
      });
      /* SM1: parameter trong conditionTree cũng phải tồn tại. */
      if (t.conditionTree) {
        conditionTreeParams(t.conditionTree).forEach(function (pn) {
          if (paramValue(sm, pn) === undefined) {
            errors.push('Transition → "' + (getState(sm, t.to) || {}).name + '": parameter "' + pn + '" (trong conditionTree) không tồn tại.');
          }
        });
      }
    });
    return { ok: errors.length === 0, errors: errors };
  }

  /* ================= RUNTIME ================= */

  function createRuntime() {
    var B = bt();
    var inner = B && typeof B.createRuntime === 'function' ? B.createRuntime() : null;
    var rt = {
      sm: null, currentId: null, stateTime: 0, stateDuration: 0,
      playing: false, inTransition: null, _inner: inner, _stack: []
    };

    rt.setTarget = function (root) {
      if (!inner) return { ok: false, error: 'Thiếu AnimBlendTree runtime.' };
      return inner.setTarget(root);
    };

    rt.setParameter = function (name, value) {
      if (!rt.sm) return { ok: false, error: 'Chưa có state machine.' };
      var B2 = bt();
      if (!B2) return { ok: false, error: 'Thiếu AnimBlendTree.' };
      var r = B2.setParameter(rt.sm, name, value);
      if (r.ok && inner) inner.setParameter(name, value);
      return r;
    };

    rt.getParameterValue = function (name) {
      return rt.sm ? paramValue(rt.sm, name) : undefined;
    };

    function topFrame() { return rt._stack.length ? rt._stack[rt._stack.length - 1] : null; }
    function currentState() {
      var f = topFrame();
      return f ? getState(f.sm, f.currentId) : null;
    }
    /* Đồng bộ các field ngoài (currentId/stateTime/...) theo frame trên cùng. */
    function syncCurrent() {
      var f = topFrame();
      rt.currentId = f ? f.currentId : null;
      rt.stateTime = f ? f.stateTime : 0;
      rt.stateDuration = f ? f.stateDuration : 0;
    }
    function clipDurationOf(state) {
      if (!state || !state.clipId) return 0;
      try {
        var B2 = bt();
        var c = B2 ? B2.resolveClip(state.clipId) : null;
        return (c && c.duration) || 0;
      } catch (e) { return 0; }
    }
    /* Chạy action onEnter/onExit của state (dùng hàm module — có cả
       loại 'sound'; xem runStateActions ở trên). */
    function runStateActionsRT(sm, state, when) {
      return runStateActions(sm, state, when);
    }
    /* Vào 1 state trong frame: phát clip (crossfade) hoặc đẩy frame
       sub-machine (state có subMachine). */
    function enterState(frame, state, crossfade, reason) {
      runStateActionsRT(frame.sm, state, 'onEnter');
      if (state.subMachine) {
        var sub = state.subMachine;
        if (!sub.parameters || !sub.parameters.length) sub.parameters = frame.sm.parameters || [];
        var subEntry = getState(sub, sub.entryStateId) || sub.states[0];
        if (!subEntry) return { ok: false, error: 'Sub-machine của "' + state.name + '" rỗng.' };
        frame.currentId = state.id;
        frame.stateTime = 0;
        frame.stateDuration = 0;
        rt._stack.push({ sm: sub, currentId: subEntry.id, stateTime: 0, stateDuration: clipDurationOf(subEntry) });
        syncCurrent();
        var res = inner.playSingle(subEntry.clipId, { crossfade: crossfade || 0, speed: subEntry.speed, loop: subEntry.loop, stateName: subEntry.name });
        if (!res.ok) { rt._stack.pop(); syncCurrent(); return res; }
        runStateActionsRT(sub, subEntry, 'onEnter');
        try { bus.emit('anim:graph-state-changed', { mode: 'statemachine', state: subEntry.name, reason: 'sub-enter' }); } catch (e) {}
        return { ok: true, state: subEntry.name, sub: true };
      }
      frame.currentId = state.id;
      frame.stateTime = 0;
      frame.stateDuration = clipDurationOf(state);
      syncCurrent();
      /* SM1 FIX: state isExit (hoặc không có clip) không phát clip —
         trước đây playSingle(null) trả lỗi nên transition vào exit
         state luôn fail và sub-machine không bao giờ thoát được. */
      if (state.isExit || !state.clipId) {
        try { bus.emit('anim:graph-state-changed', { mode: 'statemachine', state: state.name, reason: reason || 'enter' }); } catch (e) {}
        return { ok: true, state: state.name };
      }
      var r2 = inner.playSingle(state.clipId, { crossfade: crossfade || 0, speed: state.speed, loop: state.loop, stateName: state.name });
      if (!r2.ok) return r2;
      try { bus.emit('anim:graph-state-changed', { mode: 'statemachine', state: state.name, reason: reason || 'enter' }); } catch (e) {}
      return { ok: true, state: state.name };
    }

    function doTransition(tr, reason) {
      var frame = topFrame();
      if (!frame) return { ok: false, error: 'Chưa phát.' };
      var fromSt = currentState();
      var toSt = getState(frame.sm, tr.to);
      if (!toSt) return { ok: false, error: 'State đích không tồn tại.' };
      runStateActionsRT(frame.sm, fromSt, 'onExit');
      var res = enterState(frame, toSt, tr.duration, reason || 'condition');
      if (!res.ok) return res;
      rt.inTransition = { id: tr.id, from: fromSt ? fromSt.id : null, to: toSt.id, t: 0, duration: tr.duration };
      try {
        bus.emit('anim:graph-state-changed', {
          mode: 'statemachine', state: toSt.name, from: fromSt ? fromSt.name : null,
          to: toSt.name, transition: tr.id, reason: reason || 'condition'
        });
      } catch (e) {}
      /* Trigger đã tiêu thụ thì reset về false sau transition (cả
         trigger nằm trong conditionTree — SM1). */
      var trigParams = (tr.conditions || []).map(function (c) { return c.param; });
      if (tr.conditionTree) conditionTreeParams(tr.conditionTree).forEach(function (pn) { if (trigParams.indexOf(pn) < 0) trigParams.push(pn); });
      trigParams.forEach(function (pn) {
        var B3 = bt();
        var p = B3 && B3.getParameter(frame.sm, pn);
        if (p && p.type === 'trigger') { p.value = false; if (inner) inner.setParameter(pn, false); }
      });
      return { ok: true, from: fromSt ? fromSt.id : null, to: toSt.id };
    }

    rt.forceState = function (stateId) {
      if (!inner) return { ok: false, error: 'Thiếu runtime phát.' };
      var frame = topFrame();
      if (!frame) {
        if (!rt.sm) return { ok: false, error: 'Chưa có state machine.' };
        frame = { sm: rt.sm, currentId: null, stateTime: 0, stateDuration: 0 };
        rt._stack.push(frame);
      }
      var st = getState(frame.sm, stateId);
      if (!st) return { ok: false, error: 'Không có state ' + stateId };
      var cur = currentState();
      if (cur) runStateActionsRT(frame.sm, cur, 'onExit');
      var res = enterState(frame, st, 0.2, 'force');
      if (!res.ok) return res;
      /* SM1: forceState cũng là 1 crossfade (0.2s) — ghi lại để
         getActiveTransition() thấy được (trước đây bỏ trống nên
         editor tưởng không có transition nào đang chạy). */
      rt.inTransition = { id: 'force', from: cur ? cur.id : null, to: st.id, t: 0, duration: 0.2 };
      rt.playing = true;
      return { ok: true, state: st.name };
    };

    /* SM1: phát state theo TÊN (editor bấm tên state) — tìm ở frame
       trên cùng trước, rồi tới máy gốc. */
    rt.playState = function (name) {
      if (!inner) return { ok: false, error: 'Thiếu runtime phát.' };
      var frame = topFrame();
      var st = null;
      if (frame) st = frame.sm.states.find(function (s) { return s.name === name; }) || null;
      if (!st && rt.sm) st = rt.sm.states.find(function (s) { return s.name === name; }) || null;
      if (!st) return { ok: false, error: 'Không có state "' + name + '".' };
      if (frame && getState(frame.sm, st.id)) return rt.forceState(st.id);
      if (!rt.sm) return { ok: false, error: 'Chưa có state machine.' };
      /* State thuộc máy gốc nhưng frame hiện tại là sub-machine: thoát
         sub-machine rồi mới phát (bật frame cho tới khi thấy state). */
      while (rt._stack.length > 1 && !getState(topFrame().sm, st.id)) rt._stack.pop();
      syncCurrent();
      return rt.forceState(st.id);
    };

    /* SM1: state đang chạy (frame trên cùng) + transition đang chạy
       (null khi không chuyển). Editor dùng để highlight + vẽ tiến độ. */
    rt.getActiveState = function () { return currentState(); };
    rt.getActiveTransition = function () {
      if (!rt.inTransition) return null;
      var frame = topFrame();
      var fromSt = frame ? getState(frame.sm, rt.inTransition.from) : null;
      var toSt = frame ? getState(frame.sm, rt.inTransition.to) : null;
      var dur = rt.inTransition.duration || 0;
      return {
        id: rt.inTransition.id || null,
        from: fromSt ? fromSt.name : null, to: toSt ? toSt.name : null,
        fromId: rt.inTransition.from, toId: rt.inTransition.to,
        t: rt.inTransition.t, duration: dur,
        progress: dur > 0 ? Math.min(1, rt.inTransition.t / dur) : 1
      };
    };

    rt.play = function (sm) {
      if (sm) rt.sm = sm;
      if (!rt.sm) return { ok: false, error: 'Chưa có state machine.' };
      if (!inner || !inner.mixer) return { ok: false, error: 'Chưa có model target — rig/import model trước.' };
      var B2 = bt();
      var v = validate(rt.sm, B2 ? B2.resolveClip : null);
      if (!v.ok) return { ok: false, error: 'State Machine lỗi: ' + v.errors.join(' ') };
      rt._stack = [{ sm: rt.sm, currentId: null, stateTime: 0, stateDuration: 0 }];
      var frame = topFrame();
      var entry = getState(rt.sm, rt.sm.entryStateId) || rt.sm.states[0];
      var res = enterState(frame, entry, 0, 'entry');
      if (!res.ok) { rt._stack = []; return res; }
      rt.playing = true;
      return { ok: true, state: entry.name };
    };

    /* Đánh giá transition mỗi frame: Any State trước, rồi transition
       từ state hiện tại. Chỉ 1 transition / frame. Transition có
       interrupt=true được cắt ngang crossfade đang chạy. */
    rt.tick = function (dt) {
      if (!rt.playing) return { ok: false, reason: 'not-playing' };
      var frame = topFrame();
      if (!frame) return { ok: false, error: 'Không có state hiện tại.' };
      dt = dt || 0;
      frame.stateTime += dt;
      syncCurrent();
      if (rt.inTransition) {
        rt.inTransition.t += dt;
        if (rt.inTransition.t >= rt.inTransition.duration) rt.inTransition = null;
      }
      var cur = currentState();
      if (!cur) return { ok: false, error: 'Không có state hiện tại.' };
      /* Exit state của sub-machine: bật ra frame cha. */
      if (cur.isExit && rt._stack.length > 1) {
        runStateActionsRT(frame.sm, cur, 'onExit');
        rt._stack.pop();
        var parent = topFrame();
        syncCurrent();
        var parentState = parent ? getState(parent.sm, parent.currentId) : null;
        try {
          bus.emit('anim:graph-state-changed', {
            mode: 'statemachine', state: parentState ? parentState.name : null, reason: 'sub-exit'
          });
        } catch (e) {}
        /* SM1: subExitTo — cha chuyển tiếp tới state đã định (nếu có). */
        if (parentState && parentState.subExitTo && getState(parent.sm, parentState.subExitTo)) {
          var subTr = { id: 'sub-exit', from: parentState.id, to: parentState.subExitTo, conditions: [], duration: 0.2 };
          doTransition(subTr, 'sub-exit');
        }
        if (inner) inner.tick(dt);
        return { ok: true, state: currentState() ? currentState().name : (parentState ? parentState.name : null), stateTime: rt.stateTime, subExit: true };
      }
      var progress = frame.stateDuration > 0 ? frame.stateTime / frame.stateDuration : 0;
      function tryList(list) {
        for (var i = 0; i < list.length; i++) {
          var tr = list[i];
          if (tr.from !== '*' && tr.from !== frame.currentId) {
            /* SM1 FIX: transition interrupt còn được xét từ state NGUỒN
               của crossfade đang chạy (trước đây tryList chặn ngay ở
               đây nên danh sách nguồn thêm vào không bao giờ được xét). */
            if (!(rt.inTransition && tr.interrupt && tr.from === rt.inTransition.from)) continue;
          }
          if (tr.from === '*' && tr.to === frame.currentId) continue; /* Any State không tự chuyển vào chính mình */
          if (rt.inTransition && !tr.interrupt) continue;
          /* SM1: transition interrupt bỏ qua exitTime (ngắt là ngắt
             ngay); transition thường vẫn chờ đủ exitTime. */
          if (tr.hasExitTime && !tr.interrupt && progress < (tr.exitTime === undefined ? 1 : tr.exitTime)) continue;
          if (!conditionsMet(frame.sm, tr)) continue;
          return doTransition(tr, tr.from === '*' ? 'any-state' : 'condition');
        }
        return null;
      }
      var anyList = frame.sm.transitions.filter(function (t) { return t.from === '*'; });
      var hit = tryList(anyList);
      if (!hit) {
        var ownList = frame.sm.transitions.filter(function (t) { return t.from === frame.currentId; });
        /* SM1: đang crossfade thì transition interrupt còn được xét
           từ state NGUỒN của crossfade đó (vd A→B đang chạy, interrupt
           B→C hay A→C đều được xét). */
        if (rt.inTransition && rt.inTransition.from && rt.inTransition.from !== frame.currentId) {
          var srcList = frame.sm.transitions.filter(function (t) { return t.from === rt.inTransition.from; });
          srcList.forEach(function (t) { if (ownList.indexOf(t) < 0) ownList.push(t); });
        }
        hit = tryList(ownList);
      }
      if (inner) inner.tick(dt);
      return { ok: true, state: cur.name, stateTime: frame.stateTime };
    };

    rt.stop = function () {
      rt.playing = false;
      rt._stack = [];
      rt.currentId = null;
      rt.stateTime = 0;
      rt.stateDuration = 0;
      rt.inTransition = null;
      if (inner) inner.stop();
      return { ok: true };
    };

    rt.currentState = currentState;
    rt.getWeights = function () { return inner ? inner.getWeights() : {}; };
    return rt;
  }

  /* ================= LƯU / TẢI (dùng chung AnimGraphIO) ================= */

  function serialize(sm) {
    var B = bt();
    if (B && B.serialize) return B.serialize(sm);
    return { format: FORMAT, version: 1, mode: 'statemachine', name: sm.name, parameters: sm.parameters, states: sm.states, transitions: sm.transitions, entryStateId: sm.entryStateId };
  }

  function deserialize(data) {
    var B = bt();
    if (B && B.deserialize) {
      var r = B.deserialize(data);
      if (r.ok && r.graph && r.graph.mode === 'statemachine') {
        normalizeStateMachine(r.graph);
      }
      return r;
    }
    return { ok: false, error: 'Thiếu AnimBlendTree (AnimGraphIO).' };
  }

  /* SM1: chuẩn hoá đệ quy (cả sub-machine lồng nhau) — field mới có
     giá trị mặc định, file cũ vẫn load được. */
  function normalizeStateMachine(sm) {
    if (!sm || typeof sm !== 'object') return sm;
    if (!Array.isArray(sm.parameters)) sm.parameters = [];
    if (!Array.isArray(sm.states)) sm.states = [];
    if (!Array.isArray(sm.transitions)) sm.transitions = [];
    sm.states.forEach(function (s) {
      if (s.speed === undefined) s.speed = 1;
      if (s.loop === undefined) s.loop = true;
      if (s.x === undefined) s.x = 40;
      if (s.y === undefined) s.y = 40;
      if (s.isExit === undefined) s.isExit = false;
      if (s.isEntry === undefined) s.isEntry = (sm.entryStateId === s.id);
      if (!s.onEnter) s.onEnter = [];
      if (!s.onExit) s.onExit = [];
      if (s.subExitTo === undefined) s.subExitTo = null;
      if (s.subMachine) normalizeStateMachine(s.subMachine);
    });
    sm.transitions.forEach(function (t) {
      if (t.duration === undefined) t.duration = 0.3;
      if (t.hasExitTime === undefined) t.hasExitTime = false;
      if (t.exitTime === undefined) t.exitTime = 1;
      if (t.logic === undefined) t.logic = 'AND';
      if (t.conditionTree === undefined) t.conditionTree = null;
      if (t.interrupt === undefined) t.interrupt = false;
      if (!Array.isArray(t.conditions)) t.conditions = [];
    });
    return sm;
  }

  var SM = {
    FORMAT: FORMAT,
    createStateMachine: createStateMachine,
    addState: addState, getState: getState, removeState: removeState, setEntry: setEntry,
    addTransition: addTransition, removeTransition: removeTransition,
    evaluateCondition: evaluateCondition, conditionsMet: conditionsMet,
    /* SM1 */
    evaluateConditionGroup: evaluateConditionGroup,
    validateConditionTree: validateConditionTree,
    conditionTreeParams: conditionTreeParams,
    runStateActions: runStateActions, addStateAction: addStateAction,
    normalizeStateMachine: normalizeStateMachine,
    validate: validate, createRuntime: createRuntime,
    serialize: serialize, deserialize: deserialize,
    OPS: OPS,
    _test: { paramValue: paramValue }
  };

  PS.AnimStateMachine = SM;
})();
