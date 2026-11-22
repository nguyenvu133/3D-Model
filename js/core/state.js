/* ============================================================
 * core/state.js — App state trung tâm + settings
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const DEFAULTS = {
    workspace: 'studio',          // studio | model | rig | animation | scene | material | render | game | tools | settings
    leftPage: 'assets',           // assets | model | rig | animation | material | scene | render | export | ai
    selection: null,              // THREE.Object3D đang chọn
    selectionId: null,
    selectionName: '—',
    viewMode: 'perspective',      // perspective mặc định đầu tiên (yêu cầu user)
    shading: 'lit',               // lit | solid | wireframe | xray | material | render
    gizmoMode: 'select',          // select | move | rotate | scale
    gizmoSpace: 'local',
    leftCollapsed: false,
    rightCollapsed: false,
    bottomCollapsed: false,
    gridVisible: true,
    bonesVisible: false,
    loopPlayback: true,
    fps: 60,
    totalFrames: 120,
    frame: 0,
    playing: false,
    autosaveInterval: 60,         // giây
    snapTransform: false,
    showQuadLabels: true,
    showPerfHud: true
  };

  const SETTINGS_KEY = 'pixiStudio.settings.v5';

  const State = {
    data: Object.assign({}, DEFAULTS),
    settings: {
      autosave: true,
      autosaveInterval: 60,
      gridSegments: 24,
      shadows: true,
      toneMapping: 'aces',
      antialias: true,
      defaultQuality: 'ultra',
      engine: 'three',            // three | pixi
      accent: 'purple',
      seenVersion: ''             // v20.0: phiên bản đã xem "Có gì mới" — để hiện 1 lần sau nâng cấp
    }
  };

  State.get = function (key) { return State.data[key]; };

  State.set = function (key, value, silent) {
    const old = State.data[key];
    if (old === value) return;
    State.data[key] = value;
    if (!silent) bus.emit('state:changed', { key: key, value: value, old: old });
    return value;
  };

  State.setMany = function (obj, silent) {
    Object.keys(obj).forEach(function (k) { State.set(k, obj[k], silent); });
  };

  /* ---------- Settings persistence ---------- */
  State.loadSettings = function () {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        Object.keys(saved).forEach(function (k) {
          if (State.settings.hasOwnProperty(k)) State.settings[k] = saved[k];
        });
      }
    } catch (e) { console.warn('[State] settings load lỗi:', e); }
  };

  State.saveSettings = function () {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(State.settings));
    } catch (e) { /* private mode — bỏ qua */ }
  };

  State.resetAll = function () {
    const keep = {};
    State.data = Object.assign({}, DEFAULTS, keep);
    bus.emit('state:reset', {});
  };

  /* ---------- Selection helpers ---------- */
  State.select = function (object3D, extra) {
    State.data.selection = object3D || null;
    State.data.selectionId = object3D ? (object3D.uuid || U.uid('obj')) : null;
    State.data.selectionName = object3D ? (object3D.name || 'Object') : '—';
    bus.emit('selection:changed', Object.assign({
      object3D: object3D || null,
      id: State.data.selectionId,
      name: State.data.selectionName
    }, extra || {}));
  };

  window.PixiStudio.State = State;
})();
