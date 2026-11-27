/* ============================================================
 * ui/topbar.js — Workspace nav tabs, Save/Upgrade/Local,
 * window controls (trung thực trên web), statusbar updates.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const WORKSPACES = [
    { id: 'studio', name: 'Studio', icon: 'assets', page: 'assets' },
    { id: 'model', name: 'Model', icon: 'model', page: 'model' },
    { id: 'rig', name: 'Rig', icon: 'rig', page: 'rig' },
    { id: 'rigging', name: 'Rigging', icon: 'character', page: 'rigging' },
    { id: 'animation', name: 'Animation', icon: 'animation', page: 'animation' },
    { id: 'scene', name: 'Scene', icon: 'scene', page: 'scene' },
    { id: 'material', name: 'Material', icon: 'material', page: 'material' },
    { id: 'render', name: 'Render', icon: 'render', page: 'render' },
    { id: 'game', name: 'Game', icon: 'game', page: 'export' },
    { id: 'mapeditor', name: 'Map Editor', icon: 'scene', page: 'studio', action: 'mapeditor' },
    { id: 'tools', name: 'Tools', icon: 'wand', page: 'ai' },
    { id: 'settings', name: 'Settings', icon: 'settings', page: 'assets' }
  ];

  const Topbar = { active: 'studio' };

  Topbar.render = function () {
    const nav = document.getElementById('workspace-nav');
    if (!nav) return;
    nav.innerHTML = '';
    WORKSPACES.forEach(function (ws) {
      nav.appendChild(U.el('div', {
        class: 'ws-tab' + (Topbar.active === ws.id ? ' active' : ''),
        html: U.icon(ws.icon) + '<span>' + ws.name + '</span>',
        'data-tooltip': 'Workspace: ' + ws.name,
        onclick: function () { Topbar.selectWorkspace(ws.id); }
      }));
    });
  };

  Topbar.selectWorkspace = function (id) {
    Topbar.active = id;
    PixiStudio.State.set('workspace', id);
    U.$$('#workspace-nav .ws-tab').forEach(function (tab, i) {
      tab.classList.toggle('active', WORKSPACES[i] && WORKSPACES[i].id === id);
    });
    /* scroll active tab into view khi nav tràn */
    const activeEl = document.querySelector('#workspace-nav .ws-tab.active');
    if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    bus.emit('workspace:selected', { id: id });

    const ws = WORKSPACES.find(function (w) { return w.id === id; });
    if (!ws) return;

    if (id === 'settings') {
      PixiStudio.Modals.showSettings();
      return;
    }
    /* Map Editor: tab này không đổi workspace — mở Map Editor 2 chiều.
     * Nếu ghi shared key thất bại, MapLink hiện panel fallback và ở lại
     * Studio → trả tab active về Studio. */
    if (id === 'mapeditor') {
      if (PixiStudio.MapLink && PixiStudio.MapLink.openMapEditor) {
        var ok = PixiStudio.MapLink.openMapEditor();
        if (!ok) {
          Topbar.active = 'studio';
          U.$$('#workspace-nav .ws-tab').forEach(function (tab, i) {
            tab.classList.toggle('active', WORKSPACES[i] && WORKSPACES[i].id === 'studio');
          });
        }
      } else {
        bus.emit('notify', { type: 'error', title: 'Map Editor', message: 'Module MapLink chưa load — kiểm tra script js/core/map-link.js trong index.html.' });
        Topbar.active = 'studio';
        U.$$('#workspace-nav .ws-tab').forEach(function (tab, i) {
          tab.classList.toggle('active', WORKSPACES[i] && WORKSPACES[i].id === 'studio');
        });
      }
      return;
    }
    if (id === 'game') {
      /* highlight Game Ready card */
      const gr = document.getElementById('bottom-right-2');
      if (gr) {
        gr.style.transition = 'box-shadow .4s';
        gr.style.boxShadow = '0 0 0 2px var(--success)';
        setTimeout(function () { gr.style.boxShadow = ''; }, 1200);
      }
      PixiStudio.Toolbar.selectTool('export');
      return;
    }
    if (id === 'tools') {
      PixiStudio.Toolbar.selectTool('ai');
      return;
    }
    if (id === 'rigging') {
      /* Meshy-style Rigging Studio — page riêng trái */
      PixiStudio.State.set('workspace', id);
      PixiStudio.State.set('leftPage', 'rigging');
      U.$$('.lp-page').forEach(function (page) {
        page.classList.toggle('hidden', page.id !== 'page-rigging');
      });
      const title = document.getElementById('left-panel-title');
      if (title) title.textContent = 'Rigging Studio';
      if (PixiStudio.MeshyRigging) PixiStudio.MeshyRigging.renderPanel();
      const app = document.getElementById('app');
      if (window.innerWidth <= 1023) document.body.classList.add('left-drawer-open');
      else if (app.classList.contains('left-collapsed')) app.classList.remove('left-collapsed');
      /* active states sync */
      U.$$('#workspace-nav .ws-tab').forEach(function (tab, i) {
        tab.classList.toggle('active', WORKSPACES[i] && WORKSPACES[i].id === id);
      });
      U.$$('#toolbar .tool-btn').forEach(function (btn) {
        btn.classList.remove('active');
      });
      bus.emit('ui:page', { page: 'rigging' });
      return;
    }
    PixiStudio.Toolbar.selectTool(ws.page);
  };

  Topbar.updateStatus = function () {
    /* AI dot */
    const st = PixiStudio.AI.Tripo.status();
    const dot = document.getElementById('sb-ai-dot');
    const label = document.getElementById('sb-ai-state');
    if (dot) dot.className = 'dot ' + (st.connected ? 'warn' : 'off');
    if (label) label.textContent = st.connected ? 'Connected · ' + st.mode : 'Not connected';
    /* engine label */
    const engine = document.getElementById('sb-engine');
    if (engine) {
      engine.textContent = 'Three.js r128 · ' + (PixiStudio.ThreeRenderer.webgl2 ? 'WebGL2' : 'WebGL1') +
        (PixiStudio.ThreeRenderer.webgpuAvailable ? ' · WebGPU avail' : '');
    }
    const dotEngine = document.getElementById('sb-engine-dot');
    if (dotEngine) dotEngine.className = 'dot';
  };

  Topbar.init = function () {
    Topbar.render();
    Topbar.updateStatus();

    /* Nav scroll: lăn chuột = scroll ngang; active tab luôn nằm trong tầm nhìn */
    const nav = document.getElementById('workspace-nav');
    if (nav) {
      nav.addEventListener('wheel', function (e) {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          nav.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      }, { passive: false });
    }
    bus.on('workspace:selected', function (data) {
      if (nav) {
        const el = nav.querySelector('.ws-tab.active');
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    });

    /* Undo / Redo toàn diện (v2) — nút topbar + panel Lịch sử */
    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) {
      undoBtn.addEventListener('click', function () {
        if (PixiStudio.History) PixiStudio.History.undo();
      });
    }
    const redoBtn = document.getElementById('btn-redo');
    if (redoBtn) {
      redoBtn.addEventListener('click', function () {
        if (PixiStudio.History) PixiStudio.History.redo();
      });
    }
    const histBtn = document.getElementById('btn-history');
    if (histBtn) {
      histBtn.addEventListener('click', function () {
        if (PixiStudio.HistoryPanel) PixiStudio.HistoryPanel.toggle();
      });
    }
    const syncUndoRedo = function (data) {
      if (undoBtn) undoBtn.disabled = !(data && data.canUndo);
      if (redoBtn) redoBtn.disabled = !(data && data.canRedo);
      if (undoBtn) undoBtn.setAttribute('data-tooltip', 'Undo (Ctrl+Z)' + (data && data.label ? ' — ' + data.label : ''));
      if (redoBtn) redoBtn.setAttribute('data-tooltip', 'Redo (Ctrl+Shift+Z / Ctrl+Y)');
    };
    bus.on('history:changed', syncUndoRedo);
    /* trạng thái ban đầu: chưa undo/redo được */
    syncUndoRedo({ canUndo: false, canRedo: false });

    /* Save button */
    const saveBtn = document.getElementById('btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        PixiStudio.Modals.showProjectManager();
      });
    }

    /* What's new button — mở lại hộp thoại "Có gì mới" bất cứ lúc nào */
    const whatsNewBtn = document.getElementById('btn-whats-new');
    if (whatsNewBtn) {
      whatsNewBtn.addEventListener('click', function () {
        if (PixiStudio.Modals && PixiStudio.Modals.showWhatsNew) PixiStudio.Modals.showWhatsNew();
      });
    }

    /* Upgrade button — trung thực */
    const upgradeBtn = document.getElementById('btn-upgrade');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', function () {
        bus.emit('notify', {
          type: 'info', title: 'Upgrade',
          message: 'Studio v' + PixiStudio.VERSION + ' — đầy đủ tính năng local. Bản Pro (AI cloud quota, cloud render) khi tích hợp backend thật.'
        });
      });
    }

    /* Local model selector dropdown */
    const localBtn = document.getElementById('btn-local-model');
    if (localBtn) {
      localBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        Topbar._showLocalMenu(e.currentTarget);
      });
    }

    /* Window controls — trung thực (web chỉ có fullscreen) */
    const bindWin = function (id, action) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', action);
    };
    bindWin('win-min', function () {
      bus.emit('notify', { type: 'info', title: 'Minimize', message: 'Chỉ khả dụng khi đóng gói Electron/Tauri. Trên web dùng Ctrl+Tab chuyển app.' });
    });
    bindWin('win-max', function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(function () { });
    });
    bindWin('win-close', function () {
      bus.emit('notify', { type: 'info', title: 'Close', message: 'Đóng tab trình duyệt để thoát (Ctrl+W). AutoSave đã lưu trạng thái.' });
    });

    /* Autosave label update */
    bus.on('autosave:tick', function () {
      const sb = document.getElementById('sb-autosave');
      if (sb) sb.innerHTML = 'Autosave: <b style="color:var(--success)">' + PixiStudio.Storage.autosaveLabel().replace('autosaved ', '') + '</b>';
    });
  };

  Topbar._showLocalMenu = function (anchor) {
    const menu = PixiStudio.Panels.dropdown;
    const rect = anchor.getBoundingClientRect();
    const st = PixiStudio.AI.Tripo.status();
    const items = [
      { title: 'Local AI Status' },
      { label: 'Backend: ' + st.endpoint, icon: 'cloud', hint: st.connected ? 'connected' : 'not set' },
      { label: 'Mode: ' + st.mode, icon: 'settings' },
      { sep: true },
      { label: 'Open AI Tools panel…', icon: 'ai', onClick: function () { PixiStudio.Toolbar.selectTool('ai'); } },
      { label: 'Configure API key…', icon: 'wand', onClick: function () { PixiStudio.Toolbar.selectTool('ai'); } }
    ];
    menu.open(items, rect.left - 120, rect.bottom + 6);
  };

  window.PixiStudio.Topbar = Topbar;
})();
