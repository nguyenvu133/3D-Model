/* ============================================================
 * core/storage.js — localStorage, Autosave, Project Manager
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const PREFIX = 'pixiStudio.project.';
  const HISTORY_KEY = 'pixiStudio.promptHistory.v5';
  const AUTOSAVE_KEY = PREFIX + '__autosave__';

  let autosaveTimer = null;
  let lastSaveLabel = 'ready';

  const Storage = {};

  Storage.serializeProject = function () {
    /* Thu thập dữ liệu từ các module nếu có */
    const project = {
      version: PixiStudio.VERSION,
      savedAt: new Date().toISOString(),
      state: {
        viewMode: PixiStudio.State.get('viewMode'),
        shading: PixiStudio.State.get('shading'),
        fps: PixiStudio.State.get('fps'),
        totalFrames: PixiStudio.State.get('totalFrames')
      },
      objects: [],
      timeline: null,
      ai: PixiStudio.AI && PixiStudio.AI.Tripo ? PixiStudio.AI.Tripo.serialize() : null
    };

    /* Scene objects (transforms) */
    if (PixiStudio.Scene) {
      project.objects = PixiStudio.Scene.serializeObjects();
    }

    /* Timeline keyframes */
    if (PixiStudio.Timeline && PixiStudio.Timeline.keys) {
      project.timeline = PixiStudio.Timeline.keys.serialize();
    }

    return project;
  };

  Storage.deserializeProject = function (data) {
    if (!data) return false;
    try {
      if (data.state) {
        PixiStudio.State.setMany({
          fps: data.state.fps || 30,
          totalFrames: data.state.totalFrames || 120
        }, true);
      }
      if (data.ai && PixiStudio.AI && PixiStudio.AI.Tripo) {
        PixiStudio.AI.Tripo.deserialize(data.ai);
      }
      if (data.objects && PixiStudio.Scene) {
        PixiStudio.Scene.applySerializedObjects(data.objects);
      }
      if (data.timeline && PixiStudio.Timeline && PixiStudio.Timeline.keys) {
        PixiStudio.Timeline.keys.deserialize(data.timeline);
      }
      bus.emit('project:loaded', { name: data.name || 'project' });
      return true;
    } catch (err) {
      console.error('[Storage] load project lỗi:', err);
      return false;
    }
  };

  /* ---------- Project slots ---------- */
  Storage.listProjects = function () {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.indexOf(PREFIX) === 0 && key !== AUTOSAVE_KEY) {
          const name = key.slice(PREFIX.length);
          let meta = { savedAt: '?', size: 0 };
          try {
            const raw = JSON.parse(localStorage.getItem(key));
            meta.savedAt = raw.savedAt || '?';
            meta.size = localStorage.getItem(key).length;
          } catch (e) { /* slot lỗi — vẫn list */ }
          out.push({ name: name, savedAt: meta.savedAt, size: meta.size, key: key });
        }
      }
    } catch (e) { /* private mode */ }
    return out.sort(function (a, b) { return b.savedAt.localeCompare(a.savedAt); });
  };

  Storage.saveProject = function (name, silent) {
    const data = Storage.serializeProject();
    try {
      localStorage.setItem(PREFIX + name, JSON.stringify(data));
      lastSaveLabel = 'saved ' + new Date().toLocaleTimeString();
      bus.emit('project:saved', { name: name, autosave: !!silent });
      return true;
    } catch (err) {
      lastSaveLabel = 'save FAILED';
      bus.emit('project:saveError', { name: name, error: String(err) });
      return false;
    }
  };

  Storage.loadProject = function (name) {
    try {
      const raw = localStorage.getItem(PREFIX + name);
      if (!raw) return false;
      const data = JSON.parse(raw);
      data.name = name;
      return Storage.deserializeProject(data);
    } catch (err) {
      console.error('[Storage] load lỗi:', err);
      return false;
    }
  };

  Storage.deleteProject = function (name) {
    try { localStorage.removeItem(PREFIX + name); } catch (e) { }
    bus.emit('project:deleted', { name: name });
  };

  /* ---------- Autosave ---------- */
  Storage.startAutosave = function () {
    Storage.stopAutosave();
    const intervalSec = (PixiStudio.State.settings && PixiStudio.State.settings.autosaveInterval) || 60;
    autosaveTimer = setInterval(function () {
      if (!PixiStudio.State.settings.autosave) return;
      const ok = Storage.saveProject('__autosave__', true);
      if (ok) {
        lastSaveLabel = 'autosaved ' + new Date().toLocaleTimeString();
        bus.emit('autosave:tick', { at: Date.now() });
      }
    }, intervalSec * 1000);
  };

  Storage.stopAutosave = function () {
    if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null; }
  };

  Storage.autosaveLabel = function () { return lastSaveLabel; };

  Storage.restoreAutosave = function () {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      return Storage.deserializeProject(data);
    } catch (e) { return false; }
  };

  /* ---------- Prompt history (AI) ---------- */
  Storage.getPrompts = function () {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  };
  Storage.addPrompt = function (text, type) {
    if (!text || !text.trim()) return;
    const list = Storage.getPrompts();
    list.unshift({ text: text.trim(), type: type || 'text', at: new Date().toISOString() });
    if (list.length > 40) list.length = 40;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { }
    bus.emit('ai:promptHistory', { count: list.length });
  };

  /* ---------- Download/Upload project JSON ---------- */
  Storage.exportProjectFile = function (name) {
    const data = Storage.serializeProject();
    data.name = name || 'pixi-studio-project';
    U.downloadText(JSON.stringify(data, null, 2), (data.name || 'project') + '.pixistudio.json', 'application/json');
  };

  Storage.importProjectFile = function (file) {
    return U.readFileAsText(file).then(function (text) {
      const data = JSON.parse(text);
      return Storage.deserializeProject(data);
    });
  };

  window.PixiStudio.Storage = Storage;
})();
