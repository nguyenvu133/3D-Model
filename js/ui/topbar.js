/* ============================================================
 * ui/topbar.js — Workspace nav tabs, Save/Upgrade/Local,
 * window controls (trung thực trên web), statusbar updates.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  /* overflow: class ẩn tab ở breakpoint hẹp (xem css/responsive.css mục
     WORKSPACE-NAV) — tab không có overflow luôn hiện; DOM giữ nguyên thứ tự
     WORKSPACES nên selectWorkspace theo chỉ số không đổi. */
  const WORKSPACES = [
    { id: 'studio', name: 'Studio', icon: 'assets', page: 'assets' },
    { id: 'model', name: 'Model', icon: 'model', page: 'model' },
    { id: 'rig', name: 'Rig', icon: 'rig', page: 'rig' },
    { id: 'rigging', name: 'Rigging', icon: 'character', page: 'rigging', overflow: 'ws-overflow-1280' },
    { id: 'animation', name: 'Animation', icon: 'animation', page: 'animation' },
    { id: 'scene', name: 'Scene', icon: 'scene', page: 'scene', overflow: 'ws-overflow-1280' },
    { id: 'material', name: 'Material', icon: 'material', page: 'material', overflow: 'ws-overflow-1920' },
    { id: 'render', name: 'Render', icon: 'render', page: 'render', overflow: 'ws-overflow-1920' },
    { id: 'game', name: 'Game', icon: 'game', page: 'export', overflow: 'ws-overflow-1920' },
    { id: 'mapeditor', name: 'Map Editor', icon: 'scene', page: 'studio', action: 'mapeditor', overflow: 'ws-overflow-2560' },
    { id: 'tools', name: 'Tools', icon: 'wand', page: 'ai', overflow: 'ws-overflow-2560' },
    { id: 'settings', name: 'Settings', icon: 'settings', page: 'assets', overflow: 'ws-overflow-2560' }
  ];

  const Topbar = { active: 'studio' };

  Topbar.render = function () {
    const nav = document.getElementById('workspace-nav');
    if (!nav) return;
    nav.innerHTML = '';
    WORKSPACES.forEach(function (ws) {
      nav.appendChild(U.el('div', {
        class: 'ws-tab' + (ws.overflow ? ' ' + ws.overflow : '') +
          (Topbar.active === ws.id ? ' active ws-pinned' : ''),
        html: U.icon(ws.icon) + '<span>' + ws.name + '</span>',
        'data-tooltip': 'Workspace: ' + ws.name,
        onclick: function () { Topbar.selectWorkspace(ws.id); }
      }));
    });
  };

  /* Tab active luôn hiện trên thanh (dù class ws-overflow-* đang ẩn nó ở
     breakpoint hiện tại): CSS #workspace-nav .ws-tab.ws-pinned thắng rule ẩn.
     Gọi sau mọi chỗ đổi .active (render/selectWorkspace/các nhánh fallback). */
  Topbar._syncWsPin = function () {
    U.$$('#workspace-nav .ws-tab').forEach(function (tab, i) {
      tab.classList.toggle('ws-pinned', WORKSPACES[i] && WORKSPACES[i].id === Topbar.active);
    });
  };

  Topbar.selectWorkspace = function (id) {
    Topbar.active = id;
    PixiStudio.State.set('workspace', id);
    U.$$('#workspace-nav .ws-tab').forEach(function (tab, i) {
      tab.classList.toggle('active', WORKSPACES[i] && WORKSPACES[i].id === id);
    });
    Topbar._syncWsPin();
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
          Topbar._syncWsPin();
        }
      } else {
        bus.emit('notify', { type: 'error', title: 'Map Editor', message: 'Module MapLink chưa load — kiểm tra script js/core/map-link.js trong index.html.' });
        Topbar.active = 'studio';
        U.$$('#workspace-nav .ws-tab').forEach(function (tab, i) {
          tab.classList.toggle('active', WORKSPACES[i] && WORKSPACES[i].id === 'studio');
        });
        Topbar._syncWsPin();
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
      Topbar._syncWsPin();
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

    /* Nút "⋯ Thêm" — menu gom nút phụ khi màn hẹp (user 2026-11-28) */
    Topbar.initTopbarMore();

    /* Nút "⋯" workspace-nav — menu gom tab phụ khi màn hẹp (user 2026-11-28) */
    Topbar.initWsNavMore();
  };

  /* ============ Nút "⋯ Thêm" — gom nút phụ vào menu dropdown ============
     Ở màn hẹp (≤1600px) các nút .tb-overflow bị CSS ẩn khỏi thanh, và ở mobile
     (≤767px) thêm .tb-overflow-sm; menu dựng lại từ CHÍNH các nút đó (label lấy
     từ .lbl, icon từ data-ic) và bấm item = .click() lên nút thật → mọi handler
     (panels.js/topbar.js) giữ nguyên, không đổi id/class/wiring. Select mức tối
     ưu ở mobile không vào menu dạng nút được → item riêng để chuyển mức (cycle),
     Optimize đọc sel.value lúc bấm nên vẫn đúng mức đã chọn. */
  Topbar.initTopbarMore = function () {
    var moreBtn = document.getElementById('btn-topbar-more');
    var scroller = document.getElementById('topbar-actions-scroll');
    if (!moreBtn || !PixiStudio.Panels || !PixiStudio.Panels.dropdown) return;
    var mqMobile = window.matchMedia('(max-width: 767px)');
    var mqNarrow = window.matchMedia('(max-width: 1600px)');

    /* Chụp icon lúc init — Topbar.init chạy ở app.js:246, TRƯỚC khi
       U.hydrateIcons (app.js:271) thay <i data-ic> bằng SVG không còn data-ic;
       menu mở sau (lúc click) vẫn cần tên icon gốc để hiện đúng icon. */
    var iconById = {};
    Array.prototype.forEach.call(
      document.querySelectorAll('#topbar-actions-scroll .tb-overflow, #topbar-actions-scroll .tb-overflow-sm'),
      function (el) {
        var ic = el.querySelector('[data-ic]');
        if (el.id && ic) iconById[el.id] = ic.getAttribute('data-ic');
      });

    var btnLabel = function (el) {
      var lbl = el.querySelector('.lbl');
      if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();
      var tip = el.getAttribute('data-tooltip') || el.id || '';
      return tip.split('—')[0].trim() || el.id;
    };
    var btnIcon = function (el) {
      if (el.id && iconById[el.id]) return iconById[el.id];
      var ic = el.querySelector('[data-ic]');
      return (ic && ic.getAttribute('data-ic')) || 'dots';
    };
    var selText = function () {
      var sel = document.getElementById('opt-target-size');
      if (!sel || !sel.options || sel.selectedIndex < 0) return '';
      return sel.options[sel.selectedIndex].text;
    };
    var cycleOptTarget = function () {
      var sel = document.getElementById('opt-target-size');
      if (!sel || !sel.options || !sel.options.length) return;
      sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
      if (typeof document.createEvent === 'function') {
        var ev = document.createEvent('HTMLEvents');
        ev.initEvent('change', true, false);
        sel.dispatchEvent(ev);
      }
    };
    var openMenu = function (anchor) {
      var items = [{ title: 'Thêm — các nút khác' }];
      var nodes = document.querySelectorAll('#topbar-actions-scroll .tb-overflow, #topbar-actions-scroll .tb-overflow-sm');
      var isMobile = mqMobile.matches;
      var isNarrow = mqNarrow.matches;
      Array.prototype.forEach.call(nodes, function (el) {
        if (el.tagName === 'SELECT' || el.disabled) return;
        var hidden = false;
        if (el.classList.contains('tb-overflow') && isNarrow) hidden = true;
        if (el.classList.contains('tb-overflow-sm') && isMobile) hidden = true;
        if (!hidden) return;
        (function (btn) {
          items.push({ label: btnLabel(btn), icon: btnIcon(btn), onClick: function () { btn.click(); } });
        })(el);
      });
      /* mobile: select mức tối ưu không bấm trực tiếp trong menu → item cycle mức */
      if (isMobile && document.getElementById('opt-target-size')) {
        items.push({ sep: true });
        items.push({
          label: 'Mức tối ưu FBX', hint: selText(), icon: 'wand', onClick: function () {
            cycleOptTarget();
            setTimeout(function () { openMenu(anchor); }, 30);
          }
        });
      }
      if (items.length <= 1) return;
      var rect = anchor.getBoundingClientRect();
      PixiStudio.Panels.dropdown.open(items, rect.right - 220, rect.bottom + 6);
    };

    moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openMenu(e.currentTarget);
    });

    /* vùng cuộn còn nút khuất → mờ mép phải để biết mà vuốt/cuộn */
    var updateOverflow = function () {
      if (!scroller) return;
      scroller.classList.toggle('has-overflow', scroller.scrollWidth > scroller.clientWidth + 1);
    };
    if (scroller) {
      /* lăn chuột dọc = cuộn ngang (giống #workspace-nav) */
      scroller.addEventListener('wheel', function (e) {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          scroller.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      }, { passive: false });
      var scheduleUpdate = function () { setTimeout(updateOverflow, 60); };
      window.addEventListener('resize', scheduleUpdate);
      if (mqNarrow.addEventListener) {
        mqNarrow.addEventListener('change', scheduleUpdate);
        mqMobile.addEventListener('change', scheduleUpdate);
      }
      updateOverflow();
      setTimeout(updateOverflow, 600);
      setTimeout(updateOverflow, 2000);
    }
  };

  /* ============ Nút "⋯" workspace-nav — gom tab phụ vào menu dropdown ============
     Theo mẫu initTopbarMore: tab nào class ws-overflow-* đang bị CSS ẩn ở
     breakpoint hiện tại thì vào menu (Panels.dropdown có sẵn); bấm item =
     .click() lên tab thật (tab display:none vẫn nhận .click() qua JS) nên mọi
     handler giữ nguyên. Tab active được ghim hiện trên thanh (.ws-pinned)
     VÀ đánh dấu .selected (✓) trong menu. ≤1023px dùng dải tab riêng đủ 12
     tab nên không mở menu. Icon lấy thẳng từ WORKSPACES (không cần chụp lúc
     init như topbar-actions vì tên icon có sẵn trong mảng). */
  Topbar.initWsNavMore = function () {
    var moreBtn = document.getElementById('btn-wsnav-more');
    var nav = document.getElementById('workspace-nav');
    if (!moreBtn || !nav || !PixiStudio.Panels || !PixiStudio.Panels.dropdown) return;
    var mqMobile = window.matchMedia('(max-width: 1023px)');
    var mq1280 = window.matchMedia('(max-width: 1279px)');
    var mq1920 = window.matchMedia('(max-width: 1919px)');
    var mq2560 = window.matchMedia('(max-width: 2559px)');
    var isHidden = function (ws) {
      if (mqMobile.matches) return false; /* dải tab riêng: đủ 12 tab, không menu */
      if (ws.overflow === 'ws-overflow-1280') return mq1280.matches;
      if (ws.overflow === 'ws-overflow-1920') return mq1920.matches;
      if (ws.overflow === 'ws-overflow-2560') return mq2560.matches;
      return false;
    };
    var openMenu = function (anchor) {
      var items = [{ title: 'Workspace — các tab khác' }];
      var hiddenIdx = [];
      WORKSPACES.forEach(function (ws, i) {
        if (!isHidden(ws)) return;
        hiddenIdx.push(i);
        (function (w, idx) {
          items.push({
            label: w.name, icon: w.icon, onClick: function () {
              var tab = nav.querySelectorAll('.ws-tab')[idx];
              if (tab) tab.click();
            }
          });
        })(ws, i);
      });
      if (items.length <= 1) return;
      var rect = anchor.getBoundingClientRect();
      PixiStudio.Panels.dropdown.open(items, rect.left, rect.bottom + 6);
      /* đánh dấu ✓ tab đang active — dropdown.open() không nhận cờ selected */
      var ddItems = document.querySelectorAll('#dropdown-root .dd-item');
      hiddenIdx.forEach(function (idx, j) {
        if (WORKSPACES[idx].id === Topbar.active && ddItems[j]) ddItems[j].classList.add('selected');
      });
    };

    moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openMenu(e.currentTarget);
    });

    /* nav còn tab cuộn khuất (dải mobile + tab active ghim tràn) → mờ mép phải */
    var updateOverflow = function () {
      if (!nav) return;
      nav.classList.toggle('has-overflow', nav.scrollWidth > nav.clientWidth + 1);
    };
    window.addEventListener('resize', function () { setTimeout(updateOverflow, 60); });
    updateOverflow();
    setTimeout(updateOverflow, 600);
    setTimeout(updateOverflow, 2000);
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
