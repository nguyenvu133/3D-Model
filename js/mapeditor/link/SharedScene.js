/* ============================================================
 * mapeditor/link/SharedScene.js — Cầu nối 2 chiều MapEditor ↔ Studio
 * Cơ chế (xem docs/MAP_EDITOR.md §3):
 *  1) localStorage key `pixistudio.sharedScene` (cùng origin) — chính.
 *  2) Tham số URL `?scene=<tên project | sharedScene>` — mở thẳng 1 scene.
 *  3) Export/import file .json — fallback khi khác origin/máy.
 * Format: pixistudio-shared-scene-1 (SceneData.toShared/fromShared).
 * File này không phụ thuộc DOM/THREE — dùng được cả trong harness.
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  var KEY = 'pixistudio.sharedScene';
  var PROJECT_PREFIX = 'mapeditor.project.';
  var AUTOSAVE_KEY = 'mapeditor.autosave';

  function safeParse(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  var SharedScene = {
    KEY: KEY,
    PROJECT_PREFIX: PROJECT_PREFIX,
    AUTOSAVE_KEY: AUTOSAVE_KEY,

    /* ---------- shared key ----------
     * write() TRẢ {ok:true} | {ok:false, reason, message} — KHÔNG throw.
     * reason: 'quota' (localStorage đầy / QuotaExceededError),
     *         'security' (bị chặn / SecurityError, vd. private mode),
     *         'unknown' (lỗi khác). saveProject/saveAutosave vẫn trả boolean. */
    write: function (doc) {
      try {
        localStorage.setItem(KEY, JSON.stringify(doc));
        return { ok: true };
      } catch (e) {
        var name = (e && e.name) || '';
        var reason = 'unknown';
        if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') reason = 'quota';
        else if (name === 'SecurityError') reason = 'security';
        return { ok: false, reason: reason, message: (e && e.message) || String(e) };
      }
    },
    read: function () {
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return null;
        return safeParse(raw);
      } catch (e) { return null; }
    },
    clear: function () {
      try { localStorage.removeItem(KEY); } catch (e) { }
    },
    has: function () {
      try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
    },

    /* ---------- URL ?scene= ---------- */
    readUrlParam: function (search) {
      search = search || (typeof window !== 'undefined' ? window.location.search : '');
      var m = /[?&]scene=([^&]+)/.exec(search);
      if (!m) return null;
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    },
    /* ?scene= có thể là: 'pixistudio.sharedScene' | tên project MapEditor | 'studio' */
    resolveUrlScene: function (search) {
      var name = SharedScene.readUrlParam(search);
      if (!name) return null;
      if (name === KEY || name === 'sharedScene') {
        var doc = SharedScene.read();
        return doc ? { kind: 'shared', doc: doc } : null;
      }
      var proj = SharedScene.loadProject(name);
      if (proj) return { kind: 'project', data: proj };
      return null;
    },

    /* ---------- project slots của MapEditor ---------- */
    saveProject: function (name, data) {
      try {
        localStorage.setItem(PROJECT_PREFIX + name, JSON.stringify(data));
        return true;
      } catch (e) { return false; }
    },
    loadProject: function (name) {
      try {
        var raw = localStorage.getItem(PROJECT_PREFIX + name);
        return raw ? safeParse(raw) : null;
      } catch (e) { return null; }
    },
    listProjects: function () {
      var out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(PROJECT_PREFIX) === 0) {
            var raw = safeParse(localStorage.getItem(k));
            out.push({ name: k.slice(PROJECT_PREFIX.length), savedAt: (raw && raw.savedAt) || '?', size: (localStorage.getItem(k) || '').length });
          }
        }
      } catch (e) { }
      return out.sort(function (a, b) { return String(b.savedAt).localeCompare(String(a.savedAt)); });
    },
    deleteProject: function (name) {
      try { localStorage.removeItem(PROJECT_PREFIX + name); } catch (e) { }
    },
    saveAutosave: function (data) {
      try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
    },
    loadAutosave: function () {
      try { var raw = localStorage.getItem(AUTOSAVE_KEY); return raw ? safeParse(raw) : null; } catch (e) { return null; }
    },

    /* ---------- download / đọc file ---------- */
    downloadText: function (text, filename, mime) {
      var blob = new Blob([text], { type: mime || 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },
    readFileAsText: function (file) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve(r.result); };
        r.onerror = function () { reject(new Error('Đọc file thất bại')); };
        r.readAsText(file);
      });
    }
  };

  ME.SharedScene = SharedScene;
})();
