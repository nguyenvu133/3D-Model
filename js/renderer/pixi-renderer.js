/* ============================================================
 * renderer/pixi-renderer.js — PixiJS v7 overlay layer
 * Chạy THẬT: particle bụi lơ lửng + sparkle khi select model.
 * Nếu PIXI chưa load (CDN lỗi) → bỏ qua an toàn.
 * ============================================================ */
(function () {
  'use strict';

  const PixiRenderer = {
    app: null,
    container: null,
    particles: [],
    sparkles: [],
    enabled: true,
    failed: false
  };

  PixiRenderer.create = function (canvas, container) {
    if (!window.PIXI) {
      console.warn('[PixiRenderer] PIXI chưa load — overlay 2D tắt. App vẫn chạy với Three.js.');
      PixiRenderer.failed = true;
      return null;
    }
    try {
      const app = new PIXI.Application({
        view: canvas,
        transparent: true,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: 1,                 /* overlay chỉ có hạt bụi — 1x là đủ, tiết kiệm GPU */
        resizeTo: container || canvas.parentElement,
        autoStart: true
      });
      PixiRenderer.app = app;
      PixiRenderer.container = container || null;

      /* Layer dust particles */
      PixiRenderer._initDust();

      /* Ticker render loop */
      app.ticker.add(function () { PixiRenderer._tick(app.ticker.deltaMS / 1000); });

      return app;
    } catch (err) {
      console.warn('[PixiRenderer] init lỗi:', err);
      PixiRenderer.failed = true;
      return null;
    }
  };

  /* ---------- Dust particles (bụi vàng tím lơ lửng) ----------
     Dùng SPRITE chung 1 texture (radial gradient) → Pixi batch thành 1 draw call.
     Trước đây mỗi hạt là 1 PIXI.Graphics riêng = 42 draw call/frame. */
  PixiRenderer._dustTexture = function () {
    if (PixiRenderer._dustTex) return PixiRenderer._dustTex;
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    PixiRenderer._dustTex = PIXI.Texture.from(c);
    return PixiRenderer._dustTex;
  };

  PixiRenderer._initDust = function () {
    const app = PixiRenderer.app;
    const stage = app.stage;
    const W = () => app.renderer.width / (app.renderer.resolution || 1);
    const H = () => app.renderer.height / (app.renderer.resolution || 1);
    const tex = PixiRenderer._dustTexture();

    const count = 42;
    for (let i = 0; i < count; i++) {
      const g = new PIXI.Sprite(tex);
      g.anchor.set(0.5);
      const size = 1 + Math.random() * 2.2;
      g.scale.set((size * 2) / 32);
      g.tint = Math.random() < 0.5 ? 0xb79bff : 0x27bfff;
      g.alpha = 0.25 + Math.random() * 0.45;

      g.x = Math.random() * W();
      g.y = Math.random() * H();
      g.vx = (Math.random() - 0.5) * 8;
      g.vy = -(4 + Math.random() * 12);
      g.phase = Math.random() * Math.PI * 2;
      g.baseAlpha = g.alpha;

      stage.addChild(g);
      PixiRenderer.particles.push(g);
    }
  };

  PixiRenderer._tick = function (dt) {
    if (!PixiRenderer.enabled) return;
    /* tab đang ẩn → không tốn GPU cho overlay */
    if (document.hidden) return;
    const app = PixiRenderer.app;
    if (!app) return;
    const W = app.renderer.width / (app.renderer.resolution || 1);
    const H = app.renderer.height / (app.renderer.resolution || 1);
    const t = performance.now() / 1000;

    /* Dust */
    const ps = PixiRenderer.particles;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.phase += dt * 2;
      p.alpha = p.baseAlpha * (0.55 + 0.45 * Math.sin(p.phase));
      if (p.y < -8) { p.y = H + 8; p.x = Math.random() * W; }
      if (p.x < -8) p.x = W + 8;
      if (p.x > W + 8) p.x = -8;
    }

    /* Sparkles chọn object — bay lên rồi tắt */
    const sp = PixiRenderer.sparkles;
    for (let i = sp.length - 1; i >= 0; i--) {
      const s = sp[i];
      s.life -= dt;
      s.g.y -= 60 * dt;
      s.g.x += Math.sin(t * 6 + s.seed) * 20 * dt;
      s.g.alpha = Math.max(0, s.life / s.maxLife);
      s.g.scale.set(0.5 + s.life / s.maxLife);
      if (s.life <= 0) {
        app.stage.removeChild(s.g);
        s.g.destroy();
        sp.splice(i, 1);
      }
    }
  };

  /* Bắn sparkle tại toạ độ pixel của viewport */
  PixiRenderer.burst = function (x, y, count) {
    if (!PixiRenderer.app || !PixiRenderer.enabled) return;
    const n = count || 16;
    for (let i = 0; i < n; i++) {
      const g = new PIXI.Graphics();
      const c = Math.random() < 0.5 ? 0xb79bff : 0x27bfff;
      const r = 1.5 + Math.random() * 2.5;
      g.beginFill(c, 1);
      g.drawCircle(0, 0, r);
      /* 4 tia chữ thập cho dễ nhìn */
      g.lineStyle(1.2, c, 0.8);
      g.moveTo(-r * 2.4, 0); g.lineTo(r * 2.4, 0);
      g.moveTo(0, -r * 2.4); g.lineTo(0, r * 2.4);
      g.endFill();
      g.x = x + (Math.random() - 0.5) * 60;
      g.y = y + (Math.random() - 0.5) * 40;
      const life = 0.5 + Math.random() * 0.6;
      g.alpha = 1;
      PixiRenderer.app.stage.addChild(g);
      PixiRenderer.sparkles.push({ g: g, life: life, maxLife: life, seed: Math.random() * 10 });
    }
  };

  PixiRenderer.resize = function () {
    if (PixiRenderer.app && PixiRenderer.container) {
      PixiRenderer.app.queueResize && PixiRenderer.app.queueResize();
    }
  };

  PixiRenderer.setEnabled = function (on) {
    PixiRenderer.enabled = !!on;
    if (PixiRenderer.app) PixiRenderer.app.stage.visible = !!on;
  };

  window.PixiStudio.PixiRenderer = PixiRenderer;
})();
