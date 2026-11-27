/* ============================================================
 * core/app.js — Bootstrap: init thứ tự phụ thuộc, render loop,
 * wiring các module, load model mẫu chuẩn kiemhiep.glb.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;
  /* Notifications module load sau app.js → truy cập LAZY qua getter */
  const getBoot = function () { return PixiStudio.Notifications; };

  const App = {
    booted: false,
    _lastFrame: 0,
    _running: false
  };

  /* ---------- RENDER LOOP ---------- */
  App.startLoop = function () {
    App._running = true;
    App._lastFrame = performance.now();

    function loop(now) {
      if (!App._running) return;
      requestAnimationFrame(loop);

      const dt = Math.min(0.1, (now - App._lastFrame) / 1000);
      App._lastFrame = now;

      try {
        /* gameplay/animation updates */
        PixiStudio.Playback.update(dt);
        PixiStudio.Anim.update(dt);
        if (PixiStudio.RigAutoGen) PixiStudio.RigAutoGen.update(dt);
        if (PixiStudio.FbxRig) PixiStudio.FbxRig.update(dt);
        if (PixiStudio.Thandieu) PixiStudio.Thandieu.update(dt);
        if (PixiStudio.Coco) PixiStudio.Coco.update(dt);
        if (PixiStudio.Hy3d) PixiStudio.Hy3d.update(dt);
        /* v21.0 Smart Studio: IK giữ target, crossfade ramp, WASD controller */
        if (PixiStudio.IKSolver) PixiStudio.IKSolver.update(dt);
        if (PixiStudio.AnimBlender) PixiStudio.AnimBlender.update(dt);
        if (PixiStudio.CharacterController) PixiStudio.CharacterController.update(dt);
        /* ARP Viewport: nhãn bám khớp, chain IK, trails/onion (mỗi module tự
           guard khi chưa có rig / đang ẩn nên gọi vô điều kiện được). */
        if (PixiStudio.ArpVpLabels) PixiStudio.ArpVpLabels.update(dt);
        if (PixiStudio.ArpVpIk) PixiStudio.ArpVpIk.update(dt);
        if (PixiStudio.ArpVpTrails) PixiStudio.ArpVpTrails.update(dt);
        /* ARP Constraints (NHÓM 3): bone constraint stack (Copy/Limit/
           Track/Stretch/IK) — áp sau Anim/mixer để ghi đè pose mỗi
           frame, trước render. Module tự guard khi chưa có rig. */
        if (PixiStudio.ArpConstraints) PixiStudio.ArpConstraints.update(dt);
        PixiStudio.Physics.step(dt);
        PixiStudio.GridEnv.pulse(now / 1000);

        /* render 3D */
        PixiStudio.RendererManager.render(dt);

        /* perf sampling */
        PixiStudio.Perf.tick(dt);
      } catch (err) {
        console.error('[App] loop lỗi (không dừng app):', err);
      }
    }
    requestAnimationFrame(loop);
  };

  /* ---------- WIRING ---------- */
  App.wireEvents = function () {
    /* selection → gizmo attach */
    bus.on('selection:changed', function (data) {
      const mode = PixiStudio.State.get('gizmoMode');
      if (mode === 'select' || !data.object3D) {
        PixiStudio.Gizmo.attach(null);
      } else {
        PixiStudio.Gizmo.attach(data.object3D);
      }
    });

    /* gizmo mode change */
    bus.on('state:changed', function (data) {
      if (data.key === 'gizmoMode') {
        PixiStudio.Gizmo.setMode(data.value);
        /* nếu bật move/rotate/scale → attach luôn selection hiện tại */
        if (data.value !== 'select') {
          const sel = PixiStudio.State.get('selection');
          if (sel && PixiStudio.State.get('viewMode') !== 'quad') {
            PixiStudio.Gizmo.attach(sel);
          }
        }
      }
      if (data.key === 'shading') {
        PixiStudio.Viewport.invalidateShading();
      }
    });

    /* model loaded → animation target + timeline + statusbar */
    bus.on('model:loaded', function (data) {
      PixiStudio.Anim.setTarget(null);   /* reset */
      const entry = PixiStudio.Models.models[data.id];
      if (entry) {
        PixiStudio.Anim.setTarget(entry.object3D);
        if (entry.clips.length) {
          PixiStudio.Anim.registerGLTFClips(entry.object3D, entry.clips);
        }
      }
      /* FIX (ARP View vòng 1): model có rig load xong thì TỰ HIỆN
         skeleton + nhãn (+ IK nếu có control rig) — trước đây không có
         auto-show nào ở đây, skeleton/nhãn chỉ tự hiện khi bấm rig
         (event 'arp:rig-complete') nên model Mixamo/FBX đã rig sẵn
         không bao giờ hiện xương. Dùng autoShow() của từng module để
         vẫn tôn trọng "user đã tắt tay trong phiên cho đúng model đó";
         model MỚI load (uuid mới) thì mặc định hiện. IK chỉ gọi khi
         có QuickRig.current (control rig) — ArpVpIk.show() khi chưa
         có rig sẽ tự báo lỗi, không ép. */
      try {
        const obj = entry && entry.object3D;
        let hasBones = false;
        if (obj && obj.traverse) obj.traverse(function (o) { if (o && o.isBone) hasBones = true; });
        if (hasBones) {
          if (PixiStudio.ArpVpSkeleton) {
            if (typeof PixiStudio.ArpVpSkeleton.autoShow === 'function') PixiStudio.ArpVpSkeleton.autoShow(obj);
            else if (typeof PixiStudio.ArpVpSkeleton.show === 'function') PixiStudio.ArpVpSkeleton.show(obj);
          }
          if (PixiStudio.ArpVpLabels) {
            if (typeof PixiStudio.ArpVpLabels.autoShow === 'function') PixiStudio.ArpVpLabels.autoShow(obj);
            else if (typeof PixiStudio.ArpVpLabels.show === 'function') PixiStudio.ArpVpLabels.show(obj);
          }
          if (PixiStudio.ArpVpIk && PixiStudio.ArpQuickRig && PixiStudio.ArpQuickRig.current &&
              typeof PixiStudio.ArpVpIk.show === 'function') {
            PixiStudio.ArpVpIk.show();
          }
        }
      } catch (e) { /* auto-show không được chặn model:loaded */ }
      PixiStudio.Toolbar.renderPage('model');
      const sbView = document.getElementById('sb-view');
      if (sbView) sbView.textContent = 'View: ' + PixiStudio.State.get('viewMode');
    });

    /* gizmo dragging → chặn orbit (controls tự check) + inspector sync */
    bus.on('transform:changing', function () {
      PixiStudio.Inspector.syncTransform(PixiStudio.State.get('selection'));
    });

    /* viewport resize → quad label vẫn ok (CSS), ruler redraw */
    bus.on('viewport:resized', U.debounce(function () {
      PixiStudio.TimelineUI.drawRuler();
    }, 150));

    /* window trước khi đóng — save cuối */
    window.addEventListener('beforeunload', function () {
      try { PixiStudio.Storage.saveProject('__autosave__', true); } catch (e) { }
    });
  };

  /* ---------- WHAT'S NEW (hiện 1 lần sau nâng cấp) ---------- */
  App._maybeShowWhatsNew = function () {
    try {
      var seen = PixiStudio.State.settings.seenVersion || '';
      if (seen === PixiStudio.VERSION) return;
      PixiStudio.State.settings.seenVersion = PixiStudio.VERSION;
      PixiStudio.State.saveSettings();
      if (PixiStudio.Modals && PixiStudio.Modals.showWhatsNew) {
        PixiStudio.Modals.showWhatsNew();
      }
    } catch (e) { /* private mode / modal chưa sẵn sàng — bỏ qua */ }
  };

  /* ---------- BOOT SEQUENCE ---------- */
  App.boot = function () {
    if (App.booted) return;
    App.booted = true;

    console.log('%c PixiJS Studio × Tripo3D AI Studio v' + PixiStudio.VERSION + ' ', 'background:#713BFF;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold');

    getBoot().bootProgress(5, 'Checking WebGL support…');

    /* Kiểm tra WebGL */
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
    if (!gl) {
      getBoot().bootProgress(100, 'WebGL không khả dụng');
      document.getElementById('boot-status').textContent = '❌ Trình duyệt không hỗ trợ WebGL — app cần WebGL để chạy 3D viewport.';
      return;
    }

    if (!window.THREE) {
      document.getElementById('boot-status').textContent = '❌ Three.js chưa load — kiểm tra kết nối CDN (jsdelivr/unpkg) hoặc tải offline vào js/vendor/.';
      return;
    }

    getBoot().bootProgress(15, 'Loading settings…');
    PixiStudio.State.loadSettings();

    getBoot().bootProgress(25, 'Initializing renderer…');
    const canvasWrap = document.getElementById('viewport-canvas-wrap');
    const threeCanvas = document.getElementById('three-canvas');
    const pixiCanvas = document.getElementById('pixi-overlay');
    PixiStudio.RendererManager.init(threeCanvas, pixiCanvas, canvasWrap);

    getBoot().bootProgress(38, 'Building 3D viewport…');
    PixiStudio.Viewport.init(canvasWrap);

    /* ARP Viewport: bấm chọn xương trong viewport (idempotent, defensive —
       tự bỏ qua nếu viewport chưa sẵn sàng). */
    if (PixiStudio.ArpVpSelect) { try { PixiStudio.ArpVpSelect.init(); } catch (e) {} }

    /* Áp settings ban đầu */
    PixiStudio.GridEnv.setVisible(true);
    if (!PixiStudio.State.settings.shadows) PixiStudio.Lighting.setShadows(false);
    if (!PixiStudio.State.get('showQuadLabels')) {
      const ql = document.getElementById('quad-labels');
      if (ql) ql.classList.add('hidden');
    }
    if (!PixiStudio.State.get('showPerfHud')) {
      const ph = document.getElementById('perf-hud');
      if (ph) ph.classList.add('hidden');
    }

    getBoot().bootProgress(50, 'Starting render loop…');
    App.startLoop();

    getBoot().bootProgress(60, 'Building UI panels…');
    PixiStudio.Toolbar.render();
    PixiStudio.Topbar.init();
    if (PixiStudio.HistoryPanel) PixiStudio.HistoryPanel.init();
    if (PixiStudio.MapLink) PixiStudio.MapLink.init();
    PixiStudio.Panels.init();
    PixiStudio.Shortcuts.init();
    if (PixiStudio.Interaction) PixiStudio.Interaction.init();
    PixiStudio.Inspector.init();
    PixiStudio.AssetLibrary.init();
    PixiStudio.TimelineUI.init();
    PixiStudio.AIPanel.init();
    PixiStudio.Exporter.init();
    if (PixiStudio.SaveManager) PixiStudio.SaveManager.init();
    if (PixiStudio.RigAutoGen) PixiStudio.RigAutoGen.renderPanel();
    if (PixiStudio.MeshyRigging) PixiStudio.MeshyRigging.init();
    if (PixiStudio.AnimAutoGen) PixiStudio.AnimAutoGen.renderPanel();
    PixiStudio.Perf.start();

    /* restore autosave? — tắt mặc định để boot sạch; bật qua settings */
    /* PixiStudio.Storage.restoreAutosave(); */

    getBoot().bootProgress(75, 'Wiring modules…');
    App.wireEvents();
    PixiStudio.Importers.setupDragDrop();

    /* Icon hydration cho markup tĩnh */
    U.hydrateIcons(document);
    /* render lại các panel đã hydrate icon */
    PixiStudio.Toolbar.render();
    PixiStudio.Topbar.render();

    getBoot().bootProgress(85, 'Loading sample model (kiemhiep.glb)…');
    /* Load model mẫu chuẩn — async sau frame đầu để UI hiển thị trước */
    requestAnimationFrame(function () {
      setTimeout(function () {
        PixiStudio.Models.loadDefault().then(function () {
          getBoot().bootProgress(100, 'Ready!');
          /* Undo/Redo toàn diện (v2): baseline = state sau khi model mẫu
             đã load — bước đầu tiên của user undo được về đúng đây. */
          if (PixiStudio.History && PixiStudio.History.captureBaseline) PixiStudio.History.captureBaseline();
          setTimeout(function () {
            getBoot().hideBoot();
            App._maybeShowWhatsNew();
            bus.emit('app:ready', {
              loadMs: Math.round(performance.now() - (App._bootStart || performance.now()))
            });
            bus.emit('notify', {
              type: 'info', title: 'Chào mừng tới PixiJS Studio × Tripo3D AI Studio',
              message: 'Orbit: kéo chuột trái · Pan: Shift+trái / chuột phải · Zoom: scroll · Chọn model: click · Gizmo: W/E/R · Views: 1-8',
              duration: 8000
            });
          }, 250);
        }).catch(function (err) {
          console.error('[App] loadDefault thất bại hoàn toàn:', err);
          getBoot().hideBoot();
        });
      }, 60);
    });

    /* Autosave */
    PixiStudio.Storage.startAutosave();

    /* Start time */
    App._bootStart = performance.now();
  };

  window.PixiStudio.App = App;
})();
