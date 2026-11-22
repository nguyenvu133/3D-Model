/* ============================================================
 * renderer/pixi-effects.js — PixiJS v7 Effects Engine (v20.0)
 *
 * Mở rộng lớp overlay 2D của PixiRenderer (trước đây chỉ có bụi
 * + sparkle): particle emitter có cấu hình, vòng xung kích,
 * chữ nổi 2D, flash màn hình. Dùng chung 1 radial texture nên
 * mọi hạt batch thành ít draw call. Không chạm Three.js.
 *
 * API:
 *   PixiEffects.init(app)                 — gọi từ PixiRenderer.create
 *   PixiEffects.update(dt)                — gọi mỗi frame từ PixiRenderer._tick
 *   PixiEffects.emit(preset, x, y, opts)  — 'burst' | 'fire' | 'magic' | 'smoke'
 *   PixiEffects.ring(x, y, opts)          — vòng xung kích lan ra + mờ dần
 *   PixiEffects.floatText(text, x, y, opts) — chữ nổi bay lên + mờ dần
 *   PixiEffects.flash(color, alpha, dur)  — chớp sáng toàn màn hình
 *   PixiEffects.setQuality('low'|'medium'|'high') — ngân sách hạt
 *   PixiEffects.stats()                   — { emitters, particles, texts, rings }
 * ============================================================ */
(function () {
  'use strict';

  var QUALITY_BUDGET = { low: 0.5, medium: 1, high: 2 };

  var PixiEffects = {
    app: null,
    layer: null,
    textLayer: null,
    quality: 'medium',
    _emitters: [],
    _texts: [],
    _rings: [],
    _flash: null,
    _tex: null
  };

  PixiEffects.init = function (app) {
    if (!window.PIXI || !app) return false;
    PixiEffects.app = app;
    PixiEffects.layer = new PIXI.Container();
    PixiEffects.textLayer = new PIXI.Container();
    /* layer hiệu ứng nằm TRÊN bụi (dust ở stage gốc) */
    app.stage.addChild(PixiEffects.layer);
    app.stage.addChild(PixiEffects.textLayer);
    return true;
  };

  /* ---------- texture dùng chung (radial gradient) ---------- */
  PixiEffects._texture = function () {
    if (PixiEffects._tex) return PixiEffects._tex;
    /* tái dùng texture bụi của PixiRenderer nếu có (đỡ tạo canvas mới) */
    if (window.PixiStudio && PixiStudio.PixiRenderer && PixiStudio.PixiRenderer._dustTex) {
      PixiEffects._tex = PixiStudio.PixiRenderer._dustTex;
      return PixiEffects._tex;
    }
    var c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    PixiEffects._tex = PIXI.Texture.from(c);
    return PixiEffects._tex;
  };

  /* ---------- presets ---------- */
  var PRESETS = {
    burst: { count: 16, speed: [60, 220], life: [0.4, 0.9], size: [2, 6], gravity: 160, tints: [0xb79bff, 0x27bfff, 0xffffff], blend: 'add' },
    fire: { count: 24, speed: [20, 70], life: [0.5, 1.1], size: [4, 10], gravity: -140, tints: [0xff9d00, 0xff5a00, 0xffd23e], blend: 'add', spread: 0.9 },
    magic: { count: 20, speed: [30, 90], life: [0.6, 1.2], size: [2, 5], gravity: -60, tints: [0xb79bff, 0x7c3aed, 0x27bfff], blend: 'add', sway: 40 },
    smoke: { count: 14, speed: [10, 40], life: [0.8, 1.6], size: [8, 18], gravity: -25, tints: [0x9aa0b0, 0x6b7280], blend: 'normal', grow: 1.6 }
  };

  function makeParticle(tex, x, y, cfg) {
    var s = new PIXI.Sprite(tex);
    s.anchor.set(0.5);
    var ang = Math.random() * Math.PI * 2;
    var sp = cfg.speed[0] + Math.random() * (cfg.speed[1] - cfg.speed[0]);
    var spread = cfg.spread !== undefined ? cfg.spread : 1;
    /* fire/magic bay chủ yếu lên trên: giới hạn góc quanh -90° */
    if (cfg.spread !== undefined) ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * spread;
    var size = cfg.size[0] + Math.random() * (cfg.size[1] - cfg.size[0]);
    var life = cfg.life[0] + Math.random() * (cfg.life[1] - cfg.life[0]);
    s.x = x; s.y = y;
    s.scale.set(size / 16);
    s.tint = cfg.tints[Math.floor(Math.random() * cfg.tints.length)];
    s.alpha = 0.9;
    if (cfg.blend === 'add') s.blendMode = PIXI.BLEND_MODES.ADD;
    return {
      g: s, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      life: life, maxLife: life, size: size,
      gravity: cfg.gravity || 0, sway: cfg.sway || 0, grow: cfg.grow || 1,
      seed: Math.random() * 10
    };
  }

  PixiEffects.emit = function (preset, x, y, opts) {
    if (!PixiEffects.app || !PixiEffects.layer) return 0;
    var cfg = PRESETS[preset] || PRESETS.burst;
    opts = opts || {};
    var budget = QUALITY_BUDGET[PixiEffects.quality] || 1;
    var n = Math.max(1, Math.round((opts.count || cfg.count) * budget));
    var tex = PixiEffects._texture();
    var em = { parts: [], preset: preset };
    for (var i = 0; i < n; i++) {
      var p = makeParticle(tex, x + (Math.random() - 0.5) * (opts.spreadX || 8), y + (Math.random() - 0.5) * (opts.spreadY || 8), cfg);
      if (opts.tint !== undefined) p.g.tint = opts.tint;
      PixiEffects.layer.addChild(p.g);
      em.parts.push(p);
    }
    PixiEffects._emitters.push(em);
    return n;
  };

  /* burst nhanh tại 1 điểm — dùng cho click chọn (thay Graphics cũ) */
  PixiEffects.burst = function (x, y, count) {
    return PixiEffects.emit('burst', x, y, { count: count || 16 });
  };

  /* ---------- vòng xung kích ---------- */
  PixiEffects.ring = function (x, y, opts) {
    if (!PixiEffects.app || !PixiEffects.layer) return;
    opts = opts || {};
    var g = new PIXI.Graphics();
    g.lineStyle(opts.width || 3, opts.color || 0xb79bff, 1);
    g.drawCircle(0, 0, 4);
    g.x = x; g.y = y;
    PixiEffects.layer.addChild(g);
    PixiEffects._rings.push({
      g: g, r: 4, maxR: opts.maxR || 90, life: opts.life || 0.6, maxLife: opts.life || 0.6
    });
  };

  /* ---------- chữ nổi 2D ---------- */
  PixiEffects.floatText = function (text, x, y, opts) {
    if (!PixiStudio || !PixiEffects.app || !PixiEffects.textLayer) return;
    opts = opts || {};
    var t = new PIXI.Text(String(text), {
      fontFamily: 'Arial, sans-serif',
      fontSize: opts.size || 13,
      fontWeight: 'bold',
      fill: opts.color || 0xffffff,
      stroke: 0x1a1033,
      strokeThickness: 4,
      align: 'center'
    });
    t.anchor.set(0.5);
    t.x = x; t.y = y;
    PixiEffects.textLayer.addChild(t);
    PixiEffects._texts.push({ g: t, life: opts.life || 1.2, maxLife: opts.life || 1.2, vy: -(opts.rise || 34) });
  };

  /* ---------- flash toàn màn hình ---------- */
  PixiEffects.flash = function (color, alpha, dur) {
    if (!PixiEffects.app || !PixiEffects.layer) return;
    var app = PixiEffects.app;
    var W = app.renderer.width / (app.renderer.resolution || 1);
    var H = app.renderer.height / (app.renderer.resolution || 1);
    if (PixiEffects._flash) { PixiEffects.layer.removeChild(PixiEffects._flash.g); }
    var g = new PIXI.Graphics();
    g.beginFill(color === undefined ? 0xffffff : color, 1);
    g.drawRect(0, 0, W, H);
    g.endFill();
    g.alpha = alpha === undefined ? 0.25 : alpha;
    PixiEffects.layer.addChild(g);
    PixiEffects._flash = { g: g, life: dur || 0.35, maxLife: dur || 0.35 };
  };

  PixiEffects.setQuality = function (q) {
    if (QUALITY_BUDGET[q] !== undefined) PixiEffects.quality = q;
    return PixiEffects.quality;
  };

  PixiEffects.stats = function () {
    var n = 0;
    PixiEffects._emitters.forEach(function (e) { n += e.parts.length; });
    return { emitters: PixiEffects._emitters.length, particles: n, texts: PixiEffects._texts.length, rings: PixiEffects._rings.length, quality: PixiEffects.quality };
  };

  /* ---------- update mỗi frame ---------- */
  PixiEffects.update = function (dt) {
    if (!PixiEffects.app) return;
    var t = performance.now() / 1000;
    var i, j, p;
    for (i = PixiEffects._emitters.length - 1; i >= 0; i--) {
      var em = PixiEffects._emitters[i];
      for (j = em.parts.length - 1; j >= 0; j--) {
        p = em.parts[j];
        p.life -= dt;
        p.vy += p.gravity * dt;
        p.g.x += (p.vx + (p.sway ? Math.sin(t * 5 + p.seed) * p.sway : 0)) * dt;
        p.g.y += p.vy * dt;
        var k = Math.max(0, p.life / p.maxLife);
        p.g.alpha = k * 0.9;
        if (p.grow !== 1) p.g.scale.set((p.size * (1 + (1 - k) * p.grow)) / 16);
        if (p.life <= 0) {
          PixiEffects.layer.removeChild(p.g);
          p.g.destroy();
          em.parts.splice(j, 1);
        }
      }
      if (!em.parts.length) PixiEffects._emitters.splice(i, 1);
    }
    for (i = PixiEffects._texts.length - 1; i >= 0; i--) {
      var tx = PixiEffects._texts[i];
      tx.life -= dt;
      tx.g.y += tx.vy * dt;
      tx.g.alpha = Math.max(0, tx.life / tx.maxLife);
      if (tx.life <= 0) {
        PixiEffects.textLayer.removeChild(tx.g);
        tx.g.destroy();
        PixiEffects._texts.splice(i, 1);
      }
    }
    for (i = PixiEffects._rings.length - 1; i >= 0; i--) {
      var rg = PixiEffects._rings[i];
      rg.life -= dt;
      var prog = 1 - Math.max(0, rg.life / rg.maxLife);
      rg.r = 4 + (rg.maxR - 4) * prog;
      rg.g.clear();
      rg.g.lineStyle(3 * (1 - prog) + 1, 0xb79bff, Math.max(0, 1 - prog));
      rg.g.drawCircle(0, 0, rg.r);
      if (rg.life <= 0) {
        PixiEffects.layer.removeChild(rg.g);
        rg.g.destroy();
        PixiEffects._rings.splice(i, 1);
      }
    }
    if (PixiEffects._flash) {
      var f = PixiEffects._flash;
      f.life -= dt;
      f.g.alpha = Math.max(0, f.life / f.maxLife) * 0.25;
      if (f.life <= 0) {
        PixiEffects.layer.removeChild(f.g);
        f.g.destroy();
        PixiEffects._flash = null;
      }
    }
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.PixiEffects = PixiEffects;
})();
