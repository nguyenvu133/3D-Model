/* ============================================================
 * core/utils.js — DOM helpers, icon registry, format helpers
 * PixiJS Studio × Tripo3D AI Studio v20.0
 * ============================================================ */
(function () {
  'use strict';

  const U = {};

  /* ---------- DOM helpers ---------- */
  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.el = function (tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v === undefined || v === null) return;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.keys(v).forEach(function (dk) { node.dataset[dk] = v[dk]; });
        else node.setAttribute(k, v);
      });
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c === null || c === undefined) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  };

  /* ---------- Misc ---------- */
  let _uid = 0;
  U.uid = function (prefix) { return (prefix || 'id') + '-' + (++_uid) + '-' + Date.now().toString(36); };
  U.clamp = function (v, min, max) { return Math.max(min, Math.min(max, v)); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.round = function (v, d) { const m = Math.pow(10, d === undefined ? 2 : d); return Math.round(v * m) / m; };
  U.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  U.random = function (min, max) { return min + Math.random() * (max - min); };
  U.pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };

  U.escapeHtml = function (s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  U.formatBytes = function (bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  U.formatNumber = function (n) {
    if (n === undefined || n === null || isNaN(n)) return '—';
    return n.toLocaleString('en-US');
  };

  U.debounce = function (fn, wait) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  };

  U.throttle = function (fn, wait) {
    let last = 0;
    return function () {
      const now = Date.now();
      if (now - last >= wait) { last = now; fn.apply(this, arguments); }
    };
  };

  /* ---------- Download helpers ---------- */
  U.downloadBlob = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  };

  U.downloadText = function (text, filename, mime) {
    U.downloadBlob(new Blob([text], { type: mime || 'application/octet-stream' }), filename);
  };

  U.downloadDataURL = function (dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); }, 200);
  };

  U.readFileAsArrayBuffer = function (file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Không đọc được file: ' + file.name)); };
      r.readAsArrayBuffer(file);
    });
  };
  U.readFileAsDataURL = function (file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Không đọc được file: ' + file.name)); };
      r.readAsDataURL(file);
    });
  };
  U.readFileAsText = function (file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Không đọc được file: ' + file.name)); };
      r.readAsText(file);
    });
  };

  /* Fetch URL → ArrayBuffer (cho model mẫu chuẩn — biết đúng fileSize) */
  U.readFileViaFetch = function (url) {
    return new Promise(function (resolve, reject) {
      fetch(url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      }).then(resolve).catch(reject);
    });
  };

  /* ============================================================
     ICON REGISTRY — bộ SVG stroke 24x24 (dùng chung toàn UI)
     ============================================================ */
  const P = {
    /* brand & basic */
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>',
    /* modules */
    assets: '<path d="M4 7l4-3h8l4 3v12l-4 2H8l-4-2V7z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
    model: '<path d="M12 3l7 4v10l-7 4-7-4V7l7-4z"/><circle cx="12" cy="9" r="1.6"/><circle cx="8" cy="14" r="1.6"/><circle cx="16" cy="14" r="1.6"/>',
    rig: '<path d="M5 19L15 9"/><circle cx="16.5" cy="7.5" r="3"/><circle cx="4.5" cy="19.5" r="2"/>',
    animation: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M10 9l5 3-5 3V9z"/><path d="M3 9h3M3 14h3M18 9h3M18 14h3"/>',
    material: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.4"/><circle cx="14.5" cy="8.5" r="1.4"/><circle cx="15.5" cy="13.5" r="1.4"/>',
    scene: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12.5l9 5 9-5M3 17l9 5 9-5"/>',
    render: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l7 4"/><path d="M12 12l-8 3"/>',
    game: '<rect x="3" y="7" width="18" height="11" rx="4"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="15.5" cy="11.5" r="1"/><circle cx="17.8" cy="13.5" r="1"/>',
    export: '<path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
    ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"/><path d="M19 15l.9 2.3 2.1.7-2.1.7L19 21l-.9-2.3-2.1-.7 2.1-.7L19 15z"/>',
    timeline: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.2-1.6l2-1.5-2-3.4-2.3.9A7 7 0 0014.6 5L14 2.5h-4L9.4 5a7 7 0 00-1.9 1.1l-2.3-1-2 3.5 2 1.5A7 7 0 005 12c0 .5.1 1.1.2 1.6l-2 1.5 2 3.4 2.3-.9c.6.5 1.2.8 1.9 1.1L10 21.5h4l.6-2.5c.7-.3 1.3-.6 1.9-1.1l2.3.9 2-3.4-2-1.5c.1-.5.2-1.1.2-1.6z"/>',
    /* topbar actions */
    save: '<path d="M5 3h11l4 4v14H5V3z"/><path d="M8 3v5h7V3M8 13h8v8H8v-8z"/>',
    crown: '<path d="M3 8l4 4 5-7 5 7 4-4-1.5 11h-15L3 8z"/>',
    cloud: '<path d="M7 18a4 4 0 01-.5-8A5.5 5.5 0 0117.5 9a4.5 4.5 0 01-.5 9H7z"/>',
    'win-min': '<path d="M5 12h14"/>',
    'win-max': '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
    'win-close': '<path d="M6 6l12 12M18 6L6 18"/>',
    'panel-left': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    /* library */
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
    filter: '<path d="M4 5h16l-6 7v6l-4 2v-8L4 5z"/>',
    refresh: '<path d="M20 12a8 8 0 10-2.3 5.7"/><path d="M20 12V7m0 5h-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    import: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4"/>',
    'chevron-left': '<path d="M14 6l-6 6 6 6"/>',
    'chevron-right': '<path d="M10 6l6 6-6 6"/>',
    caret: '<path d="M6 9l6 6 6-6"/>',
    /* viewport tools */
    cursor: '<path d="M5 3l14 8.5-6.5 1L9 19 5 3z"/>',
    move: '<path d="M12 3v18M3 12h18"/><path d="M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
    rotate: '<path d="M4 12a8 8 0 108-8"/><path d="M12 1.5L12 8l5-3.5"/>',
    scale: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 15l6-6M15 9v3.5M15 9h-3.5"/>',
    focus: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    bone: '<path d="M7.5 16.5l9-9"/><path d="M6 21a2.6 2.6 0 01-2.6-2.6c0-1 .5-1.7 1.3-2.2-.4-1.4.7-2.9 2.3-2.9.6 0 1.1.2 1.5.5l7.6-7.6c-.3-.4-.5-.9-.5-1.5 0-1.6 1.5-2.7 2.9-2.3.5-.8 1.2-1.3 2.2-1.3A2.6 2.6 0 0123 3.9c0 1-.5 1.7-1.3 2.2.4 1.4-.7 2.9-2.3 2.9-.6 0-1.1-.2-1.5-.5l-7.6 7.6c.3.4.5.9.5 1.5 0 1.6-1.5 2.7-2.9 2.3-.5.8-1.2 1.3-2.2 1.3z" transform="scale(.78) translate(2 2)"/>',
    grid: '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/><rect x="3" y="3" width="18" height="18" rx="1.5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M3 17l5-4 4 3 4-4 5 5"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    aperture: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l7.8 4.5M12 12l-7.8 4.5M12 12L4.2 7.5M12 12l7.8-4.5"/>',
    gamepad: '<rect x="3" y="7" width="18" height="11" rx="4"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="15.5" cy="11" r="1.2"/><circle cx="17.5" cy="13.5" r="1.2"/>',
    rocket: '<path d="M12 3c4 2 6 6 6 10l-3 2h-6l-3-2c0-4 2-8 6-10z"/><path d="M9 15l-3 6M15 15l3 6M12 17v4"/><circle cx="12" cy="9" r="1.8"/>',
    /* playback */
    play: '<path d="M7 5l12 7-12 7V5z"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    'skip-start': '<path d="M5 5v14M19 5l-10 7 10 7V5z"/>',
    'skip-end': '<path d="M19 5v14M5 5l10 7L5 19V5z"/>',
    prev: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    loop: '<path d="M4 12a8 8 0 018-8h5"/><path d="M14 1.5L17.5 4 14 6.5M20 12a8 8 0 01-8 8H7"/><path d="M10 17.5L6.5 20 10 22.5"/>',
    key: '<rect x="10.5" y="3.5" width="9" height="9" rx="1.5" transform="rotate(45 15 8)"/><path d="M8 16l-5 5M6 18l2 2M4 20l1.5 1.5"/>',
    /* timeline & edit */
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
    paste: '<rect x="7" y="4" width="10" height="17" rx="2"/><path d="M9 4a3 3 0 016 0M9 10h6M9 14h6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
    duplicate: '<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M11 21h7a2 2 0 002-2v-7"/><path d="M17 9v8h-8"/>',
    edit: '<path d="M4 20l1-4L16.5 4.5a2 2 0 013 3L8 19l-4 1z"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/>',
    eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
    'eye-off': '<path d="M2 12s3.5-6.5 10-6.5c2 0 3.7.6 5.1 1.4M22 12s-3.5 6.5-10 6.5c-2 0-3.7-.6-5.1-1.4"/><path d="M4 4l16 16"/>',
    folder: '<path d="M3 7V5a1 1 0 011-1h5l2 2h9a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V7z"/>',
    file: '<path d="M6 2h8l4 4v16H6V2z"/><path d="M14 2v4h4"/>',
    audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    /* model tools */
    wand: '<path d="M6 21L21 6"/><path d="M18 3l.7 1.8L20.5 5.5l-1.8.7L18 8l-.7-1.8-1.8-.7 1.8-.7L18 3z"/><path d="M4.5 3.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3L2.7 5.3l1.3-.5.5-1.3z"/>',
    optimize: '<path d="M13 3L4 14h6l-1 7 9-11h-6l1-7z"/>',
    bake: '<path d="M12 22c4 0 7-2.5 7-6.5 0-4.5-4-6.5-4-10.5-3 1-4 3.5-4 5.5 0-1-1-2.5-2.5-3C7 10 5 12 5 15.5 5 19.5 8 22 12 22z"/>',
    retopo: '<circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17M8 3.5c-3 5-3 12 0 17M16 3.5c3 5 3 12 0 17"/>',
    lod: '<path d="M12 4l9 5-9 5-9-5 9-5z"/><path d="M4.5 13.5L12 17.7l7.5-4.2M4.5 17.5L12 21.7l7.5-4.2" opacity=".6"/>',
    collider: '<path d="M4 8l8-4 8 4v8l-8 4-8-4V8z"/><path d="M4 8l8 4 8-4M12 12v8" stroke-dasharray="2.5 2.2"/>',
    uv: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M12 3c-4 5 4 7 0 18M12 3c4 5-4 7 0 18"/>',
    physics: '<circle cx="12" cy="12" r="1.8"/><ellipse cx="12" cy="12" rx="9.5" ry="4"/><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(120 12 12)"/>',
    character: '<circle cx="12" cy="7" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    weapon: '<path d="M3.5 20.5L14 10"/><path d="M14 10l6.5-6.5M17 3l4 4-1.5 1.5-3-.5L14 10l-2-2 2.5-2.5-.5-3L15.5 3z"/>',
    prop: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>',
    env: '<path d="M12 3l5 7h-10l5-7z"/><path d="M12 10v11M8 21h8"/><path d="M19 9l3 4.5h-6l3-4.5z" opacity=".6"/>',
    fx: '<path d="M5 13c2.5 0 4.5-2 4.5-4.5S7.5 4 5 4 0.5 6 0.5 8.5 2.5 13 5 13z" transform="translate(3 3) scale(.9)"/><path d="M17 8l1.2 3L21 12.2 18.2 13.4 17 16.5l-1.2-3.1-2.8-1.2 2.8-1.2L17 8z"/><path d="M8.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/>',
    link: '<path d="M9.5 14.5l5-5"/><path d="M7 12l-2.5 2.5a3.5 3.5 0 005 5L12 17M17 12l2.5-2.5a3.5 3.5 0 00-5-5L12 7"/>',
    group: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="M8 11v4a3 3 0 003 3"/><circle cx="16" cy="8" r="3" opacity=".45"/>',
    /* misc */
    check: '<path d="M5 13l4.5 4.5L19 7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    warning: '<path d="M12 3l10 17H2L12 3z"/><path d="M12 10v4M12 17v.5"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5A2.5 2.5 0 1112 15v1.5"/><path d="M12 19v.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M19.5 4.5l-2 2M6.5 17.5l-2 2"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-4 10.5c.8.7 1.3 1.6 1.5 2.5h5c.2-.9.7-1.8 1.5-2.5A6 6 0 0012 3z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12.5l9 5 9-5M3 17l9 5 9-5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
    swords: '<path d="M4 4l7 7M20 4l-7 7M4 20l4-4M20 20l-4-4"/><path d="M3 17l4 4M17 3l4 4" opacity=".5"/>',
    hat: '<path d="M4 17h16l-2-6c-1.5-5-10.5-5-12 0l-2 6z"/><path d="M2 17h20"/>',
    ghost: '<path d="M5 21V11a7 7 0 0114 0v10l-2.3-2-2.4 2-2.3-2-2.3 2-2.4-2L5 21z"/><circle cx="9.5" cy="11" r="1"/><circle cx="14.5" cy="11" r="1"/>',
    ninja: '<circle cx="12" cy="12" r="9"/><path d="M3.5 10h17M7 8h10" /><path d="M9 14.5c1 1 2 1.5 3 1.5s2-.5 3-1.5"/>',
    dragon: '<path d="M3 12c3-6 9-9 15-7l-3 3 4 1-3 3 3 2c-4 3-9 3-13-1l-3-1z"/><circle cx="15" cy="9" r=".8"/>',
    flower: '<circle cx="12" cy="12" r="2.5"/><path d="M12 9.5C12 6 10 4 12 3s0 3 0 6.5zM14.5 12C18 12 20 10 21 12s-3 0-6.5 0zM12 14.5c0 3.5 2 5.5 0 6.5s0-3 0-6.5zM9.5 12C6 12 4 14 3 12s3 0 6.5 0z"/>'
  };

  U.icon = function (name, cls) {
    const path = P[name] || P.cube;
    return '<svg class="' + (cls || 'ic') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
  };

  U.hasIcon = function (name) { return !!P[name]; };

  /* Thay thế mọi <i data-ic="name"> trong DOM bằng SVG thật */
  U.hydrateIcons = function (root) {
    U.$$('[data-ic]', root || document).forEach(function (node) {
      const name = node.getAttribute('data-ic');
      node.outerHTML = U.icon(name, node.className || 'ic');
    });
  };

  /* ---------- Toast/format shortcuts đăng ký sau (notifications) ---------- */

  /* Export namespace */
  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.Utils = U;
  /* VERSION do js/core/version.js định nghĩa (load trước file này);
     giữ fallback để app vẫn chạy nếu thiếu version.js. */
  window.PixiStudio.VERSION = window.PixiStudio.VERSION || '20.0.0';
})();
