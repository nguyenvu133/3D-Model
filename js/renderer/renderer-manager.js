/* ============================================================
 * renderer/renderer-manager.js — Điều phối render backend,
 * resize, dispatch mỗi frame, bridge renderer.info cho Perf.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;

  const Manager = {
    mode: 'three',        // 'three' | 'pixi'
    renderTimeMs: 0
  };

  Manager.init = function (threeCanvas, pixiCanvas, container) {
    Manager.container = container;
    Manager.threeCanvas = threeCanvas;
    Manager.pixiCanvas = pixiCanvas;

    /* Three.js là backend chính */
    const three = PixiStudio.ThreeRenderer.create(threeCanvas);
    if (!three) {
      bus.emit('notify', {
        type: 'error', title: 'WebGL init thất bại',
        message: 'Không tạo được Three.js WebGL context. Trình duyệt có hỗ trợ WebGL?'
      });
      return;
    }

    /* Pixi overlay layer */
    PixiStudio.PixiRenderer.create(pixiCanvas, container);

    Manager._wireShadowEvents();

    /* Resize observer — responsive mọi màn hình */
    Manager._setupResize();

    bus.emit('renderer:ready', {
      webgl2: PixiStudio.ThreeRenderer.webgl2,
      webgpu: PixiStudio.ThreeRenderer.webgpuAvailable,
      maxTextureSize: PixiStudio.ThreeRenderer.maxTextureSize
    });
  };

  Manager._setupResize = function () {
    const container = Manager.container;
    if (!container) return;
    let raf = null;
    const doResize = function () {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        const w = container.clientWidth || 1;
        const h = container.clientHeight || 1;
        PixiStudio.ThreeRenderer.resize(w, h);
        bus.emit('viewport:resized', { width: w, height: h });
      });
    };
    if (window.ResizeObserver) {
      new ResizeObserver(doResize).observe(container);
    } else {
      window.addEventListener('resize', doResize);
    }
    doResize();
  };

  /* ============================================================
     SHADOW POLICY — shadow map chỉ vẽ lại khi CẦN
     Trước đây shadow map được render lại MỌI frame (tốn cả pass hình học
     ～50k tris vào map 2048²) dù cảnh không đổi. Nay:
       • cảnh tĩnh → giữ nguyên shadow map cũ (không tốn pass nào)
       • có animation chạy / object đổi transform / model mới → đánh dấu dirty
       • an toàn: tự làm mới ít nhất mỗi 400ms (nếu có thay đổi không qua event)
     ============================================================ */
  Manager.shadowDirty = true;
  Manager._lastShadowRefresh = 0;

  Manager.markShadowDirty = function () { Manager.shadowDirty = true; };

  Manager.isAnimating = function () {
    const a = PixiStudio.Anim;
    if (a && a.current && a.actions && a.actions[a.current] && a.actions[a.current].paused !== true) return true;
    const rig = PixiStudio.RigAutoGen;
    if (rig && rig.current && rig.current.mixer && rig.playing !== false) return true;
    const f = PixiStudio.FbxRig;
    if (f && f.loaded && f.mixer && f.current) return true;
    const pb = PixiStudio.Playback;
    const keys = PixiStudio.Timeline && PixiStudio.Timeline.keys;
    if (pb && pb.playing && keys && keys.tracks && keys.tracks.length) return true;
    return false;
  };

  Manager._applyShadowPolicy = function () {
    const r = PixiStudio.ThreeRenderer.renderer;
    if (!r) return;
    if (Manager.isAnimating()) Manager.shadowDirty = true;
    const now = performance.now();
    if (now - Manager._lastShadowRefresh > 400) {
      Manager.shadowDirty = true;
      Manager._lastShadowRefresh = now;
    }
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = !!Manager.shadowDirty;
    if (Manager.shadowDirty) Manager.shadowDirty = false;
  };

  Manager._wireShadowEvents = function () {
    if (Manager._shadowWired) return;
    Manager._shadowWired = true;
    ['model:loaded', 'model:stats-updated', 'transform:changing', 'transform:changed',
      'rig:created', 'rig:autogen', 'viewport:view', 'asset:imported'].forEach(function (ev) {
      bus.on(ev, function () { Manager.shadowDirty = true; });
    });
    bus.on('state:changed', function (d) { if (d && d.key === 'shading') Manager.shadowDirty = true; });
  };

  /* Được gọi mỗi frame từ app loop */
  Manager.render = function (dt) {
    const t0 = performance.now();
    Manager._applyShadowPolicy();
    const vp = PixiStudio.Viewport;
    if (vp && vp.scene) {
      vp.render(dt);
    }
    Manager.renderTimeMs = performance.now() - t0;
  };

  /* Snapshot stats của SCENE CHÍNH.
     Lý do: Viewport.render còn vẽ thêm axis-gizmo ở cuối frame, mà
     renderer.info tự reset mỗi lần renderer.render() → nếu đọc sau đó thì
     HUD/Perf chỉ thấy tam giác + draw call của gizmo (sai số liệu).
     Vì vậy Viewport gọi captureInfo() NGAY SAU khi vẽ scene chính. */
  Manager.captureInfo = function () {
    const r = PixiStudio.ThreeRenderer.renderer;
    if (!r) return;
    Manager._info = {
      calls: r.info.render.calls,
      triangles: r.info.render.triangles,
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
      points: r.info.render.points,
      lines: r.info.render.lines,
      programs: r.info.programs ? r.info.programs.length : 0
    };
  };

  Manager.info = function () {
    if (Manager._info) return Manager._info;
    Manager.captureInfo();
    return Manager._info || { calls: 0, triangles: 0, geometries: 0, textures: 0, points: 0, lines: 0, programs: 0 };
  };

  Manager.setMode = function (mode) {
    if (mode !== 'three' && mode !== 'pixi') return;
    Manager.mode = mode;
    if (mode === 'pixi') {
      /* Pixi standalone mode: ẩn three canvas */
      Manager.threeCanvas.style.visibility = 'hidden';
      PixiStudio.PixiRenderer.setEnabled(true);
    } else {
      Manager.threeCanvas.style.visibility = 'visible';
    }
    bus.emit('renderer:mode', { mode: mode });
  };

  window.PixiStudio.RendererManager = Manager;
})();
