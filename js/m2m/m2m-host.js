/* m2m/m2m-host.js — lớp tương thích tối thiểu cho trang mesh2motion.html
 *
 * Trang mesh2motion.html là app độc lập nhưng DÙNG LẠI các module đã kiểm chứng
 * của studio: js/animation/m2m-motion.js (retarget + catalog) và
 * js/rigging/creature-rigs.js (dựng rig theo họ). Hai module đó chỉ cần một số
 * mặt API của namespace PixiStudio, nên file này cung cấp đúng những mặt đó.
 */
(function () {
  'use strict';

  window.PixiStudio = window.PixiStudio || {};
  const P = window.PixiStudio;

  /* ---------- Utils tối thiểu (dùng chung U của studio) ---------- */
  if (!P.Utils) {
    const U = {};
    U.el = function (tag, attrs, children) {
      const n = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v === undefined || v === null) return;
        if (k === 'class') n.className = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { n.dataset[d] = v[d]; });
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v);
      });
      (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
      return n;
    };
    U.formatNumber = function (n) { return Number(n || 0).toLocaleString('en-US'); };
    U.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
    P.Utils = U;
  }
  const U = P.Utils;

  /* ---------- Thông báo ---------- */
  P.Notifications = P.Notifications || {
    showLoading: function () { },
    updateLoading: function () { },
    hideLoading: function () { },
    bootProgress: function () { },
    boot: function () { }
  };
  P.notify = function (opts) {
    if (P.bus) P.bus.emit('notify', opts || {});
    const host = document.getElementById('m2m-toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (opts && opts.type || 'info');
    el.innerHTML = '<b>' + ((opts && opts.title) || '') + '</b><span>' + ((opts && opts.message) || '') + '</span>';
    host.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 350); }, Math.min(9000, (opts && opts.duration) || 3800));
  };
  if (P.bus) {
    P.bus.on('notify', function (d) {
      const host = document.getElementById('m2m-toasts');
      if (!host) return;
      const el = document.createElement('div');
      el.className = 'toast ' + ((d && d.type) || 'info');
      el.innerHTML = '<b>' + ((d && d.title) || '') + '</b><span>' + ((d && d.message) || '') + '</span>';
      host.appendChild(el);
      setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 350); }, Math.min(9000, (d && d.duration) || 3800));
    });
  }

  /* ---------- State tối thiểu ---------- */
  P.State = P.State || {
    data: { selection: null, gizmoMode: 'select', viewMode: 'perspective', shading: 'lit', settings: {} },
    settings: {},
    get: function (k) { return P.State.data[k]; },
    set: function (k, v) { P.State.data[k] = v; if (P.bus) P.bus.emit('state:changed', { key: k, value: v }); return v; },
    select: function (o) {
      P.State.data.selection = o || null;
      if (P.bus) P.bus.emit('selection:changed', { object3D: o || null, name: o ? (o.name || 'Object') : '—' });
    },
    loadSettings: function () { },
    saveSettings: function () { }
  };

  /* ---------- Models tối thiểu: uỷ quyền cho engine của trang ---------- */
  P.Models = {
    models: {},
    currentId: null,
    loadGLBFromBuffer: function (buf, name, size) {
      if (!window.M2MPage || !window.M2MPage.loadModelBuffer) return Promise.reject(new Error('engine chưa sẵn sàng'));
      return window.M2MPage.loadModelBuffer(buf, name, size);
    },
    getCurrent: function () {
      const id = P.Models.currentId;
      return id ? P.Models.models[id] || null : null;
    },
    remove: function (id) {
      const e = P.Models.models[id];
      if (!e) return;
      if (window.M2MPage && window.M2MPage.removeModel) window.M2MPage.removeModel(e.object3D);
      delete P.Models.models[id];
      if (P.Models.currentId === id) P.Models.currentId = null;
    }
  };

  /* ---------- Viewport tối thiểu ---------- */
  P.Viewport = P.Viewport || {
    modelRoot: null,
    orbit: null,
    getMainModel: function () {
      const root = P.Viewport.modelRoot;
      if (!root) return null;
      return root.children.find(function (c) { return c.visible; }) || null;
    },
    focusSelected: function () { if (window.M2MPage && window.M2MPage.focus) window.M2MPage.focus(); },
    setView: function (v) { if (window.M2MPage && window.M2MPage.setView) window.M2MPage.setView(v); },
    screenshot: function (w, h, f) { return window.M2MPage ? window.M2MPage.screenshot(w, h, f) : null; }
  };

  /* ---------- RigAutoGen tối thiểu: chỉ host rig + tick mixer ---------- */
  P.RigAutoGen = P.RigAutoGen || {
    current: null,
    playing: true,
    visible: true,
    speed: 1,
    update: function (dt) {
      const cur = P.RigAutoGen.current;
      if (cur && cur.mixer && P.RigAutoGen.playing) cur.mixer.update(dt * P.RigAutoGen.speed);
    },
    toggleVisibility: function () {
      P.RigAutoGen.visible = !P.RigAutoGen.visible;
      const cur = P.RigAutoGen.current;
      if (cur && cur.root) cur.root.visible = P.RigAutoGen.visible;
      return P.RigAutoGen.visible;
    },
    rebindSkin: function () {
      const cur = P.RigAutoGen.current;
      if (!cur || !cur.skeleton || !cur.target) return 0;
      cur.root.updateMatrixWorld(true);
      cur.skeleton.calculateInverses();
      let n = 0;
      cur.target.traverse(function (o) {
        if (!o.isSkinnedMesh) return;
        o.updateMatrixWorld(true);
        o.bind(cur.skeleton, o.matrixWorld);
        n++;
      });
      return n;
    }
  };

  /* ---------- Rig / FbxRig placeholder ---------- */
  P.Rig = P.Rig || { current: null };
  P.FbxRig = P.FbxRig || { loaded: false, fbxRoot: null, mixer: null, generated: [] };

  /* fps/severity dùng khi notify bằng P.notify */
  window.M2MHost = { U: U };
})();