/* ============================================================
 * core/history.js — Undo / Redo snapshot engine
 * Snapshot: transforms + visibility của mọi object đã đăng ký.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const MAX = 60;

  const History = {
    _undo: [],
    _redo: [],
    _locked: false
  };

  /* Chụp snapshot hiện tại từ Scene registry */
  function snapshot(label) {
    const entries = {};
    if (PixiStudio.Scene) {
      const objs = PixiStudio.Scene.registry;
      for (const uuid in objs) {
        const o = objs[uuid] && objs[uuid].object3D;
        if (!o) continue;
        entries[uuid] = {
          p: [o.position.x, o.position.y, o.position.z],
          r: [o.rotation.x, o.rotation.y, o.rotation.z],
          s: [o.scale.x, o.scale.y, o.scale.z],
          v: o.visible,
          name: o.name
        };
      }
    }
    return { label: label || 'change', time: Date.now(), entries: entries };
  }

  History.push = function (label, customSnapshot) {
    if (History._locked) return;
    const snap = customSnapshot || snapshot(label);
    snap.label = label || snap.label;
    History._undo.push(snap);
    if (History._undo.length > MAX) History._undo.shift();
    History._redo.length = 0;
    bus.emit('history:changed', { canUndo: true, canRedo: false, label: label });
    return snap;
  };

  function apply(snap) {
    if (!PixiStudio.Scene || !snap) return;
    const objs = PixiStudio.Scene.registry;
    for (const uuid in snap.entries) {
      const reg = objs[uuid];
      if (!reg || !reg.object3D) continue;
      const e = snap.entries[uuid];
      const o = reg.object3D;
      o.position.set(e.p[0], e.p[1], e.p[2]);
      o.rotation.set(e.r[0], e.r[1], e.r[2]);
      o.scale.set(e.s[0], e.s[1], e.s[2]);
      o.visible = e.v;
      o.name = e.name || o.name;
    }
    bus.emit('transform:changed', { source: 'history' });
    bus.emit('history:applied', { label: snap.label });
  }

  History.undo = function () {
    if (!History._undo.length) return false;
    /* Chụp trạng thái hiện tại vào redo trước khi quay về */
    const current = snapshot('redo-point');
    const snap = History._undo.pop();
    History._locked = true;
    apply(snap);
    History._locked = false;
    History._redo.push(current);
    bus.emit('history:changed', { canUndo: History._undo.length > 0, canRedo: true, label: snap.label });
    return true;
  };

  History.redo = function () {
    if (!History._redo.length) return false;
    const current = snapshot('undo-point');
    const snap = History._redo.pop();
    History._locked = true;
    apply(snap);
    History._locked = false;
    History._undo.push(current);
    bus.emit('history:changed', { canUndo: true, canRedo: History._redo.length > 0, label: snap.label });
    return true;
  };

  History.clear = function () {
    History._undo.length = 0;
    History._redo.length = 0;
    bus.emit('history:changed', { canUndo: false, canRedo: false });
  };

  History.info = function () {
    return { undo: History._undo.length, redo: History._redo.length, last: History._undo.length ? History._undo[History._undo.length - 1].label : null };
  };

  window.PixiStudio.History = History;
})();
