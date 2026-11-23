(function () {
'use strict';

/* ================= CONFIG & UTILS ================= */
var CFG = {
  TILE_W: 64, TILE_H: 32,
  MAP_W: 56, MAP_H: 56,
  MAX_ZOOM: 1.7, MIN_ZOOM: 0.5
};
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function isoX(wx, wy) { return (wx - wy) * CFG.TILE_W / 2; }
function isoY(wx, wy) { return (wx + wy) * CFG.TILE_H / 2; }
function depthOf(wx, wy) { return wx + wy; }
function screenToWorld(sx, sy) {
  var X = sx / (CFG.TILE_W / 2), Y = sy / (CFG.TILE_H / 2);
  return { x: (X + Y) / 2, y: (Y - X) / 2 };
}
function $(id) { return document.getElementById(id); }

/* ================= AUDIO (WebAudio, không cần file) ================= */
var AudioMan = {
  ctx: null, muted: false,
  init: function () {
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
  },
  tone: function (freq0, freq1, dur, type, vol) {
    if (!this.ctx || this.muted) return;
    try {
      var ctx = this.ctx, t = ctx.currentTime;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, freq1), t + dur);
      g.gain.setValueAtTime(vol || 0.07, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { }
  },
  sfx: function (type) {
    if (!this.ctx || this.muted) return;
    if (type === 'hit') this.tone(170, 60, 0.09, 'square', 0.08);
    else if (type === 'swing') this.tone(700, 220, 0.1, 'sine', 0.04);
    else if (type === 'skill') this.tone(220, 880, 0.28, 'sawtooth', 0.06);
    else if (type === 'ult') { this.tone(80, 440, 0.7, 'sawtooth', 0.12); this.tone(120, 900, 0.6, 'sine', 0.08); }
    else if (type === 'pickup') this.tone(880, 1320, 0.14, 'sine', 0.05);
    else if (type === 'levelup') { this.tone(523, 523, 0.12, 'sine', 0.08); setTimeout(function () { AudioMan.tone(784, 784, 0.18, 'sine', 0.08); }, 110); }
    else if (type === 'death') this.tone(300, 40, 0.35, 'sawtooth', 0.07);
    else if (type === 'click') this.tone(600, 500, 0.05, 'sine', 0.04);
    else if (type === 'quest') { this.tone(660, 660, 0.12, 'sine', 0.07); setTimeout(function () { AudioMan.tone(990, 990, 0.2, 'sine', 0.07); }, 120); }
  }
};

/* ================= GAME ENGINE ================= */
var Engine = { app: null, layers: {}, worldRoot: null, time: 0 };
Engine.init = function () {
  return new Promise(function (resolve) {
    var app = new PIXI.Application();
    Engine.app = app;
    app.init({
      width: window.innerWidth, height: window.innerHeight,
      background: 0x0d1420, antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true
    }).then(function () {
      $('stage').appendChild(app.canvas);
      var worldRoot = new PIXI.Container();
      Engine.worldRoot = worldRoot;
      app.stage.addChild(worldRoot);
      var layers = {
        terrain: new PIXI.Container(), groundFx: new PIXI.Container(),
        env: new PIXI.Container(), characters: new PIXI.Container(),
        effects: new PIXI.Container(), overlay: new PIXI.Container()
      };
      Object.keys(layers).forEach(function (k) { layers[k].sortableChildren = true; worldRoot.addChild(layers[k]); });
      layers.env.zIndex = 10; layers.characters.zIndex = 20;
      layers.effects.zIndex = 30; layers.overlay.zIndex = 40;
      Engine.layers = layers;
      /* lớp tuyết: cố định theo màn hình, không theo camera */
      Engine.snowLayer = new PIXI.Container();
      app.stage.addChild(Engine.snowLayer);
      window.addEventListener('resize', function () { app.renderer.resize(window.innerWidth, window.innerHeight); });
      resolve(app);
    });
  });
};

/* ================= TILE MAP — Trường Bạch ================= */
var TileMap = {
  /* true = đi được; false = bị chặn (nhà, núi, nước) */
  blocked: [],
  build: function () {
    var g = new PIXI.Graphics();
    var TW = CFG.TILE_W, TH = CFG.TILE_H, W = CFG.MAP_W, H = CFG.MAP_H;
    this.blocked = [];
    for (var x = 0; x < W; x++) { this.blocked[x] = []; for (var y = 0; y < H; y++) this.blocked[x][y] = false; }
    /* nền núi xa */
    g.rect(-2600, -1600, W * TW + 5200, H * TH + 3200).fill(0x3d4c6e);
    /* tiles tuyết — batch theo màu */
    var batches = {}, COLORS = [0x5c6c8c, 0x566280, 0x526078, 0x64748f];
    COLORS.forEach(function (c) { batches[c] = new PIXI.Graphics(); });
    for (var tx = 0; tx < W; tx++) {
      for (var ty = 0; ty < H; ty++) {
        var sx = isoX(tx, ty), sy = isoY(tx, ty);
        var tint = (tx * 7 + ty * 13) % 10;
        var col = tint > 8 ? 0x64748f : tint > 5 ? 0x5c6c8c : tint > 2 ? 0x566280 : 0x526078;
        batches[col].moveTo(sx, sy).lineTo(sx + TW / 2, sy + TH / 2).lineTo(sx, sy + TH).lineTo(sx - TW / 2, sy + TH / 2).closePath();
      }
    }
    COLORS.forEach(function (c) { batches[c].fill(c); Engine.layers.terrain.addChild(batches[c]); });
    /* đường đá chính: cổng thành (28,44) → đền (28,6), nhánh ngang qua quảng trường */
    var road = new PIXI.Graphics();
    function roadRect(gfx, x0, y0, x1, y1) {
      var p0 = { x: isoX(x0, y0), y: isoY(x0, y0) }, p1 = { x: isoX(x1, y0), y: isoY(x1, y0) },
          p2 = { x: isoX(x1, y1), y: isoY(x1, y1) }, p3 = { x: isoX(x0, y1), y: isoY(x0, y1) };
      gfx.poly([p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y]);
    }
    roadRect(road, 26.5, 4, 29.5, 46); roadRect(road, 12, 27.5, 44, 30.5); roadRect(road, 40, 30, 52, 32);
    road.fill(0x8d8578);
    Engine.layers.terrain.addChild(road);
    var roadEdge = new PIXI.Graphics();
    roadRect(roadEdge, 26.5, 4, 27.2, 46); roadRect(roadEdge, 28.8, 4, 29.5, 46);
    roadEdge.fill(0x6e675c);
    Engine.layers.terrain.addChild(roadEdge);
    /* hồ băng góc tây nam */
    var lake = new PIXI.Graphics();
    lake.ellipse(isoX(8, 46), isoY(8, 46) + 10, 150, 60).fill(0x9fc8e8);
    lake.ellipse(isoX(8, 46), isoY(8, 46) + 6, 130, 48).fill(0xcfe6f7);
    Engine.layers.terrain.addChild(lake);
    for (var lx = 4; lx <= 12; lx++) for (var ly = 42; ly <= 50; ly++) this.blocked[lx][ly] = true;
  },
  isBlocked: function (wx, wy) {
    var x = Math.floor(wx), y = Math.floor(wy);
    if (x < 0 || y < 0 || x >= CFG.MAP_W || y >= CFG.MAP_H) return true;
    return this.blocked[x][y];
  },
  blockRect: function (x0, y0, x1, y1) {
    for (var x = Math.floor(x0); x <= Math.floor(x1); x++)
      for (var y = Math.floor(y0); y <= Math.floor(y1); y++)
        if (x >= 0 && y >= 0 && x < CFG.MAP_W && y < CFG.MAP_H) this.blocked[x][y] = true;
  }
};

/* ================= WORLD — đền, nhà, cây, cổng, portal ================= */
var World = {
  npcs: [],
  build: function () {
    this.buildMountains();
    this.buildTemple();
    this.buildHouses();
    this.buildTrees();
    this.buildFences();
    this.buildLanterns();
    this.buildProps();
    this.buildStatues();
    this.buildGate();
    this.buildPortal();
    this.buildNPCs();
  },
  envSprite: function (g, wx, wy) {
    var tex = Engine.app.renderer.generateTexture(g);
    var s = new PIXI.Sprite(tex);
    s.anchor.set(0.5, 1);
    s.position.set(isoX(wx, wy), isoY(wx, wy));
    s.zIndex = depthOf(wx, wy);
    Engine.layers.env.addChild(s);
    return s;
  },
  buildMountains: function () {
    var peaks = [
      { x: 2, y: 2, h: 340, w: 420 }, { x: 14, y: 0, h: 420, w: 520 }, { x: 30, y: -2, h: 380, w: 480 },
      { x: 46, y: 1, h: 460, w: 560 }, { x: 56, y: 8, h: 360, w: 440 }, { x: -2, y: 22, h: 300, w: 380 },
      { x: 58, y: 26, h: 320, w: 400 }
    ];
    peaks.forEach(function (p) {
      var g = new PIXI.Graphics();
      var bx = isoX(p.x, p.y), by = isoY(p.x, p.y);
      g.moveTo(bx - p.w / 2, by).lineTo(bx, by - p.h).lineTo(bx + p.w / 2, by).closePath().fill(0x2c3a58);
      g.moveTo(bx - p.w * 0.16, by - p.h * 0.62).lineTo(bx, by - p.h).lineTo(bx + p.w * 0.16, by - p.h * 0.62).lineTo(bx, by - p.h * 0.42).closePath().fill(0xe8eef7);
      var s = new PIXI.Sprite(Engine.app.renderer.generateTexture(g));
      s.anchor.set(0.5, 1); s.position.set(bx, by); s.zIndex = -1000;
      Engine.layers.env.addChild(s);
    });
  },
  buildTemple: function () {
    TileMap.blockRect(24, 2, 32, 9);
    var g = new PIXI.Graphics();
    var cx = isoX(28, 5.5), cy = isoY(28, 5.5);
    /* bậc thềm */
    g.rect(cx - 150, cy - 8, 300, 22).fill(0x7a7264);
    g.rect(cx - 120, cy - 26, 240, 20).fill(0x8d8578);
    /* thân đền */
    g.rect(cx - 110, cy - 150, 220, 128).fill(0x8a2f26);
    g.rect(cx - 110, cy - 150, 220, 10).fill(0xc9a94f);
    g.rect(cx - 96, cy - 128, 34, 96).fill(0x5e1f18);
    g.rect(cx + 62, cy - 128, 34, 96).fill(0x5e1f18);
    /* cửa vàng */
    g.rect(cx - 22, cy - 92, 44, 92).fill(0x3a2408);
    g.rect(cx - 18, cy - 88, 36, 84).fill(0xc9a94f);
    g.circle(cx - 8, cy - 48, 4).fill(0x3a2408); g.circle(cx + 8, cy - 48, 4).fill(0x3a2408);
    /* mái 2 tầng */
    function roof(ry, hw, rise) {
      g.moveTo(cx - hw, ry).lineTo(cx, ry - rise).lineTo(cx + hw, ry).lineTo(cx + hw - 18, ry + 12).lineTo(cx - hw + 18, ry + 12).closePath().fill(0x1e4d3a);
      g.moveTo(cx - hw, ry).lineTo(cx, ry - rise).lineTo(cx + hw, ry).lineTo(cx + hw - 18, ry + 4).lineTo(cx - hw + 18, ry + 4).closePath().fill(0xe8eef7);
    }
    roof(cy - 148, 150, 62); roof(cy - 196, 116, 52);
    g.rect(cx - 6, cy - 240, 12, 46).fill(0xc9a94f);
    g.circle(cx, cy - 246, 8).fill(0xffd94d);
    /* cột đèn 2 bên */
    [-150, 150].forEach(function (dx) {
      g.rect(cx + dx - 3, cy - 70, 6, 70).fill(0x4a3220);
      g.ellipse(cx + dx, cy - 78, 14, 18).fill(0xff5a3c);
      g.ellipse(cx + dx, cy - 78, 9, 12).fill(0xffd94d);
    });
    this.envSprite(g, 28, 5.5);
  },
  buildHouses: function () {
    var houses = [
      { x: 16, y: 16, w: 3.4, d: 2.6, c: 0x7a4a2e }, { x: 36, y: 14, w: 3.6, d: 2.8, c: 0x6e3f2a },
      { x: 14, y: 34, w: 3.2, d: 2.4, c: 0x84603a }, { x: 40, y: 36, w: 3.8, d: 2.6, c: 0x74452c },
      { x: 20, y: 22, w: 3.0, d: 2.4, c: 0x8a5a34 }, { x: 38, y: 22, w: 3.0, d: 2.4, c: 0x6e4a30 },
      { x: 46, y: 18, w: 3.2, d: 2.4, c: 0x7d5232 }
    ];
    houses.forEach(function (h) {
      TileMap.blockRect(h.x - h.w / 2, h.y - h.d / 2, h.x + h.w / 2, h.y + h.d / 2);
      var g = new PIXI.Graphics();
      var cx = isoX(h.x, h.y), cy = isoY(h.x, h.y);
      var hw = h.w * 30, hh = h.d * 30;
      g.moveTo(cx - hw, cy).lineTo(cx, cy - 34).lineTo(cx + hw, cy).lineTo(cx, cy + 34).closePath().fill(0x5e4632);
      g.moveTo(cx - hw + 8, cy - 4).lineTo(cx, cy - 34).lineTo(cx + hw - 8, cy - 4).lineTo(cx, cy + 26).closePath().fill(h.c);
      g.moveTo(cx - hw - 14, cy - 40).lineTo(cx, cy - 96).lineTo(cx + hw + 14, cy - 40).lineTo(cx + hw - 6, cy - 26).lineTo(cx - hw + 6, cy - 26).closePath().fill(0x1e4d3a);
      g.moveTo(cx - hw - 14, cy - 40).lineTo(cx, cy - 96).lineTo(cx + hw + 14, cy - 40).lineTo(cx + hw - 6, cy - 32).lineTo(cx - hw + 6, cy - 32).closePath().fill(0xdfe8f2);
      g.rect(cx - 10, cy - 22, 20, 30).fill(0x2a1a08);
      g.rect(cx - 7, cy - 19, 14, 24).fill(0xffc86e);
      World.envSprite(g, h.x, h.y);
    });
  },
  buildTrees: function () {
    var spots = [];
    for (var i = 0; i < 46; i++) {
      var x = rand(2, 54), y = rand(2, 54);
      if (x > 24 && x < 32 && y < 12) continue;
      if (x > 25 && x < 31 && y > 4 && y < 47) continue;
      if (x > 11 && x < 45 && y > 26.5 && y < 31.5) continue;
      if (x > 3 && x < 13 && y > 41 && y < 51) continue;
      spots.push({ x: x, y: y, s: rand(0.8, 1.3) });
    }
    spots.forEach(function (t) {
      var g = new PIXI.Graphics();
      var s = t.s;
      g.rect(-3 * s, -34 * s, 6 * s, 34 * s).fill(0x4a3220);
      g.moveTo(0, -96 * s).lineTo(26 * s, -34 * s).lineTo(-26 * s, -34 * s).closePath().fill(0x1d4a2e);
      g.moveTo(0, -76 * s).lineTo(19 * s, -34 * s).lineTo(-19 * s, -34 * s).closePath().fill(0xe8eef7);
      g.moveTo(0, -116 * s).lineTo(18 * s, -66 * s).lineTo(-18 * s, -66 * s).closePath().fill(0x25603a);
      g.moveTo(0, -116 * s).lineTo(10 * s, -84 * s).lineTo(-10 * s, -84 * s).closePath().fill(0xe8eef7);
      World.envSprite(g, t.x, t.y);
    });
  },
  buildFences: function () {
    function fenceRun(x0, y0, x1, y1) {
      var g = new PIXI.Graphics();
      var n = Math.floor(dist(x0, y0, x1, y1) / 1.4);
      for (var i = 0; i <= n; i++) {
        var wx = x0 + (x1 - x0) * i / n, wy = y0 + (y1 - y0) * i / n;
        var sx = isoX(wx, wy), sy = isoY(wx, wy);
        g.rect(sx - 2, sy - 22, 4, 22).fill(0x6b4a2a);
        if (i < n) {
          var nx = x0 + (x1 - x0) * (i + 1) / n, ny = y0 + (y1 - y0) * (i + 1) / n;
          g.moveTo(sx, sy - 16).lineTo(isoX(nx, ny), isoY(nx, ny) - 16).stroke({ width: 3, color: 0x7d5a34 });
        }
      }
      var s = new PIXI.Sprite(Engine.app.renderer.generateTexture(g));
      s.anchor.set(0, 0); s.position.set(0, 0); s.zIndex = 5;
      Engine.layers.env.addChild(s);
    }
    fenceRun(12, 24, 24, 24); fenceRun(32, 24, 44, 24);
    fenceRun(12, 33, 24, 33); fenceRun(32, 33, 44, 33);
    fenceRun(10, 12, 10, 44); fenceRun(46, 12, 46, 44);
  },
  buildLanterns: function () {
    var spots = [[24, 26], [32, 26], [24, 32], [32, 32], [26, 12], [30, 12], [26, 40], [30, 40], [42, 28], [14, 28]];
    spots.forEach(function (p) {
      var g = new PIXI.Graphics();
      g.rect(-2, -52, 4, 52).fill(0x2a2018);
      g.ellipse(0, -60, 11, 14).fill(0xff5a3c);
      g.ellipse(0, -60, 7, 9).fill(0xffd94d);
      g.rect(-12, -74, 24, 4).fill(0xc9a94f);
      g.rect(-12, -50, 24, 4).fill(0xc9a94f);
      var s = World.envSprite(g, p[0], p[1]);
      /* hào quang */
      var glow = new PIXI.Graphics();
      glow.circle(0, -60, 26).fill({ color: 0xffb347, alpha: 0.12 });
      var gs = new PIXI.Sprite(Engine.app.renderer.generateTexture(glow));
      gs.anchor.set(0.5, 1); gs.position.set(s.position.x, s.position.y); gs.zIndex = s.zIndex - 0.1;
      Engine.layers.env.addChild(gs);
    });
  },
  buildProps: function () {
    [{ x: 18, y: 42 }, { x: 42, y: 42 }, { x: 16, y: 30 }].forEach(function (p) {
      var g = new PIXI.Graphics();
      g.ellipse(0, 0, 16, 7).fill(0x6b4a2a);
      g.rect(-14, -22, 28, 22).fill(0x8a5f36);
      g.ellipse(0, -22, 14, 6).fill(0xa87a48);
      World.envSprite(g, p.x, p.y);
    });
    /* cọc luyện công */
    var g2 = new PIXI.Graphics();
    g2.rect(-4, -70, 8, 70).fill(0x5e4632);
    g2.rect(-16, -78, 32, 10).fill(0x7d5a34);
    World.envSprite(g2, 34, 38);
    World.envSprite(g2, 22, 38);
  },
  buildStatues: function () {
    [{ x: 26, y: 31 }, { x: 30, y: 31 }].forEach(function (p) {
      TileMap.blockRect(p.x - 0.6, p.y - 0.6, p.x + 0.6, p.y + 0.6);
      var g = new PIXI.Graphics();
      g.rect(-16, -6, 32, 10).fill(0x7a7264);
      g.rect(-11, -58, 22, 54).fill(0x9aa4b5);
      g.circle(0, -66, 9).fill(0x9aa4b5);
      g.moveTo(-11, -58).lineTo(0, -40).lineTo(11, -58).closePath().fill(0x7d8aa0);
      World.envSprite(g, p.x, p.y);
    });
  },
  buildGate: function () {
    TileMap.blockRect(25.5, 44, 30.5, 45.5);
    var g = new PIXI.Graphics();
    var cx = isoX(28, 44.8), cy = isoY(28, 44.8);
    g.rect(cx - 130, cy - 8, 20, 130).fill(0x6e3f2a);
    g.rect(cx + 110, cy - 8, 20, 130).fill(0x6e3f2a);
    g.rect(cx - 140, cy - 150, 280, 26).fill(0x1e4d3a);
    g.moveTo(cx - 150, cy - 150).lineTo(cx, cy - 196).lineTo(cx + 150, cy - 150).lineTo(cx + 140, cy - 138).lineTo(cx - 140, cy - 138).closePath().fill(0x1e4d3a);
    g.moveTo(cx - 150, cy - 150).lineTo(cx, cy - 196).lineTo(cx + 150, cy - 150).lineTo(cx + 140, cy - 144).lineTo(cx - 140, cy - 144).closePath().fill(0xe8eef7);
    g.rect(cx - 52, cy - 124, 104, 20).fill(0x8a2f26);
    g.circle(cx, cy - 158, 10).fill(0xffd94d);
    this.envSprite(g, 28, 44.8);
  },
  buildPortal: function () {
    /* cổng dungeon — vòng xoáy tím ở phía đông */
    var g = new PIXI.Graphics();
    g.ellipse(0, 0, 46, 16).fill({ color: 0x8a2be2, alpha: 0.35 });
    g.ellipse(0, -4, 36, 26).fill(0x6a1fb0);
    g.ellipse(0, -8, 26, 34).fill(0x9d4edd);
    g.ellipse(0, -8, 16, 22).fill(0xe0aaff);
    g.ellipse(0, -8, 8, 12).fill(0xffffff);
    var s = this.envSprite(g, 50, 30);
    s.userData = { portal: true };
    this.portalSprite = s;
    TileMap.blockRect(49, 29, 51, 31);
  },
  buildNPCs: function () {
    /* Vệ Binh ở cổng thành — giao nhiệm vụ */
    var guard = Characters.make('npc', { x: 25.5, y: 42.5, name: 'Vệ Binh A Hổ', level: 30 });
    guard.isNPC = true;
    this.npcs.push(guard);
    var elder = Characters.make('npc2', { x: 24, y: 20, name: 'Trưởng Lão Tuyết', level: 40 });
    elder.isNPC = true;
    this.npcs.push(elder);
  }
};

/* ================= SPRITE FACTORY — nhân vật vẽ tay (low-poly style) ================= */
var SpriteFactory = {
  tex: {},
  humanoid: function (key, o) {
    if (this.tex[key]) return this.tex[key];
    var g = new PIXI.Graphics();
    var S = o.scale || 1;
    /* bóng */
    g.ellipse(0, 0, 22 * S, 7 * S).fill({ color: 0x000000, alpha: 0.3 });
    /* áo choàng */
    g.moveTo(-14 * S, -8 * S).lineTo(-11 * S, -46 * S).lineTo(11 * S, -46 * S).lineTo(14 * S, -8 * S).closePath().fill(o.robe);
    g.rect(-14 * S, -30 * S, 28 * S, 5 * S).fill(o.trim);
    g.moveTo(-11 * S, -46 * S).lineTo(0, -40 * S).lineTo(11 * S, -46 * S).closePath().fill(o.trim);
    /* đai lưng */
    g.rect(-13 * S, -22 * S, 26 * S, 4 * S).fill(0xc9a94f);
    /* đầu */
    g.circle(0, -54 * S, 9 * S).fill(o.skin);
    /* tóc + búi */
    g.arc(0, -55 * S, 9 * S, Math.PI, 0).fill(o.hair);
    g.circle(0, -64 * S, 4 * S).fill(o.hair);
    /* mắt */
    g.circle(-3.5 * S, -54 * S, 1.2 * S).fill(0x1a1a1a);
    g.circle(3.5 * S, -54 * S, 1.2 * S).fill(0x1a1a1a);
    /* tay */
    g.rect(-17 * S, -44 * S, 5 * S, 16 * S).fill(o.robe);
    g.rect(12 * S, -44 * S, 5 * S, 16 * S).fill(o.robe);
    var t = Engine.app.renderer.generateTexture(g);
    this.tex[key] = t;
    return t;
  },
  weapon: function (key, kind, color) {
    if (this.tex[key]) return this.tex[key];
    var g = new PIXI.Graphics();
    if (kind === 'sword') {
      g.rect(-2, -46, 4, 34).fill(0xdfe8f2);
      g.moveTo(-2, -46).lineTo(0, -54).lineTo(2, -46).closePath().fill(0xdfe8f2);
      g.rect(-6, -12, 12, 4).fill(0xc9a94f);
      g.rect(-2, -8, 4, 10).fill(0x5e4632);
    } else if (kind === 'spear') {
      g.rect(-1.5, -58, 3, 56).fill(0x7d5a34);
      g.moveTo(-5, -58).lineTo(0, -72).lineTo(5, -58).closePath().fill(color);
      g.rect(-4, -58, 8, 3).fill(0xc9a94f);
    } else if (kind === 'fan') {
      g.moveTo(0, 0).lineTo(-16, -26).lineTo(0, -32).lineTo(16, -26).closePath().fill(color);
      g.moveTo(0, 0).lineTo(-10, -28).lineTo(0, -30).lineTo(10, -28).closePath().fill(0xffffff);
      g.rect(-2, 0, 4, 10).fill(0x5e4632);
    } else if (kind === 'staff') {
      g.rect(-2, -56, 4, 58).fill(0x6b4a2a);
      g.circle(0, -60, 7).fill(color);
      g.circle(0, -60, 4).fill(0xffffff);
    }
    var t = Engine.app.renderer.generateTexture(g);
    this.tex[key] = t;
    return t;
  },
  monster: function (key, o) {
    if (this.tex[key]) return this.tex[key];
    var g = new PIXI.Graphics();
    var S = o.scale || 1;
    g.ellipse(0, 0, 24 * S, 8 * S).fill({ color: 0x000000, alpha: 0.3 });
    /* thân */
    g.ellipse(0, -20 * S, 20 * S, 22 * S).fill(o.body);
    g.ellipse(0, -16 * S, 14 * S, 15 * S).fill(o.belly || o.body);
    /* đầu */
    g.circle(0, -44 * S, 13 * S).fill(o.body);
    /* sừng / tai */
    if (o.horns) {
      g.moveTo(-10 * S, -52 * S).lineTo(-16 * S, -66 * S).lineTo(-6 * S, -56 * S).closePath().fill(0xd8cdb8);
      g.moveTo(10 * S, -52 * S).lineTo(16 * S, -66 * S).lineTo(6 * S, -56 * S).closePath().fill(0xd8cdb8);
    }
    /* mắt */
    g.circle(-5 * S, -46 * S, 2.5 * S).fill(o.eye || 0xff2e2e);
    g.circle(5 * S, -46 * S, 2.5 * S).fill(o.eye || 0xff2e2e);
    /* răng nanh */
    g.moveTo(-5 * S, -36 * S).lineTo(-3 * S, -32 * S).lineTo(-1 * S, -36 * S).closePath().fill(0xffffff);
    g.moveTo(1 * S, -36 * S).lineTo(3 * S, -32 * S).lineTo(5 * S, -36 * S).closePath().fill(0xffffff);
    /* tay */
    g.ellipse(-20 * S, -22 * S, 6 * S, 12 * S).fill(o.body);
    g.ellipse(20 * S, -22 * S, 6 * S, 12 * S).fill(o.body);
    var t = Engine.app.renderer.generateTexture(g);
    this.tex[key] = t;
    return t;
  },
  boss: function () {
    var key = 'boss';
    if (this.tex[key]) return this.tex[key];
    var g = new PIXI.Graphics(), S = 1.9;
    g.ellipse(0, 0, 34 * S, 11 * S).fill({ color: 0x000000, alpha: 0.35 });
    /* áo giáp vàng */
    g.moveTo(-20 * S, -10 * S).lineTo(-16 * S, -70 * S).lineTo(16 * S, -70 * S).lineTo(20 * S, -10 * S).closePath().fill(0x8a6d1f);
    g.moveTo(-16 * S, -70 * S).lineTo(0, -60 * S).lineTo(16 * S, -70 * S).closePath().fill(0xc9a94f);
    g.rect(-19 * S, -44 * S, 38 * S, 6 * S).fill(0xffd94d);
    /* vai rồng */
    g.circle(-18 * S, -66 * S, 9 * S).fill(0xc9a94f);
    g.circle(18 * S, -66 * S, 9 * S).fill(0xc9a94f);
    /* đầu rồng */
    g.circle(0, -82 * S, 13 * S).fill(0x5e4632);
    g.moveTo(-12 * S, -90 * S).lineTo(-22 * S, -108 * S).lineTo(-8 * S, -94 * S).closePath().fill(0xffd94d);
    g.moveTo(12 * S, -90 * S).lineTo(22 * S, -108 * S).lineTo(8 * S, -94 * S).closePath().fill(0xffd94d);
    g.circle(-5 * S, -84 * S, 3 * S).fill(0xff2e2e);
    g.circle(5 * S, -84 * S, 3 * S).fill(0xff2e2e);
    g.moveTo(-6 * S, -74 * S).lineTo(-3 * S, -69 * S).lineTo(0, -74 * S).lineTo(3 * S, -69 * S).lineTo(6 * S, -74 * S).closePath().fill(0xffffff);
    /* tay + trảo */
    g.rect(-26 * S, -64 * S, 7 * S, 26 * S).fill(0x8a6d1f);
    g.rect(19 * S, -64 * S, 7 * S, 26 * S).fill(0x8a6d1f);
    var t = Engine.app.renderer.generateTexture(g);
    this.tex[key] = t;
    return t;
  }
};

/* ================= GAME STATE ================= */
var Game = {
  started: false, over: false, victory: false,
  time: 0, gold: 0, kills: 0, bossKills: 0,
  combo: 0, comboTimer: 0,
  party: [], enemies: [], loots: [],
  target: null, boss: null,
  questIdx: 0, questKill: 0,
  camera: { x: 0, y: 0, zoom: 1 },
  input: { x: 0, y: 0, joy: false },
  keys: {},
  shake: 0
};

var QUESTS = [
  { title: 'Diệt Tuyết Yêu (0/8)', desc: 'Vệ Binh A Hổ: Tuyết Yêu hoành hành phía tây bắc. Diệt 8 con để lấy lại an toàn cho Trường Bạch.', need: 8, kind: 'snow' },
  { title: 'Dẹp Sơn Tặc (0/5)', desc: 'Trưởng Lão Tuyết: Sơn Tặc cướp bóc phía đông. Dẹp 5 tên để mở đường tới Ải Bắc.', need: 5, kind: 'bandit' },
  { title: 'Hạ Long Ngâm Lão Tổ (0/1)', desc: 'Long Ngâm Lão Tổ thức tỉnh ở đấu trường phía đông nam. Hạ hắn để hoàn thành Quan Ải!', need: 1, kind: 'boss' }
];

var ENEMY_DEFS = {
  snow:   { name: 'Tuyết Yêu', hp: 60, atk: 8, speed: 1.6, xp: 25, gold: 12, scale: 1.0, range: 1.1, color: 0xdfe8f2 },
  bandit: { name: 'Sơn Tặc', hp: 90, atk: 12, speed: 2.0, xp: 40, gold: 22, scale: 1.05, range: 1.1, color: 0x4a3a28 },
  elite:  { name: 'Tuyết Yêu Tinh Anh', hp: 220, atk: 18, speed: 1.8, xp: 120, gold: 60, scale: 1.35, range: 1.3, color: 0xc9d4e8 },
  boss:   { name: 'Long Ngâm Lão Tổ', hp: 1200, atk: 26, speed: 1.4, xp: 600, gold: 300, scale: 1.9, range: 1.8, color: 0x8a6d1f }
};

/* ================= CHARACTERS ================= */
var Characters = {
  idSeq: 1,
  make: function (type, opts) {
    opts = opts || {};
    var ch = {
      id: this.idSeq++, type: type, kind: opts.kind || 'enemy',
      name: opts.name || type, level: opts.level || 1,
      x: opts.x || 28, y: opts.y || 40, dir: 1,
      hp: 100, maxHp: 100, mp: 100, maxMp: 100,
      atk: 12, def: 0, speed: 3.2, radius: 0.55,
      state: 'idle', target: null, attackCd: 0, attackTimer: 0,
      walkPhase: Math.random() * 6, flashT: 0, dead: false, respawnT: 0,
      homeX: opts.x || 28, homeY: opts.y || 40,
      skillCd: {}, aiTimer: 0, swingT: 0, dashT: 0, dashDx: 0, dashDy: 0,
      slowT: 0, isNPC: false, isBoss: false, isElite: false
    };
    var c = new PIXI.Container();
    ch.container = c;
    var body, weapon = null;
    if (type === 'leader') {
      ch.kind = 'party'; ch.maxHp = 320; ch.hp = 320; ch.maxMp = 160; ch.mp = 160; ch.atk = 26; ch.speed = 4.6; ch.level = 1;
      body = new PIXI.Sprite(SpriteFactory.humanoid('leader', { robe: 0x2b5cb8, trim: 0xffd94d, skin: 0xf2c89b, hair: 0x1a1a1a }));
      weapon = new PIXI.Sprite(SpriteFactory.weapon('w_sword', 'sword', 0xdfe8f2));
    } else if (type === 'spear') {
      ch.kind = 'party'; ch.maxHp = 420; ch.hp = 420; ch.maxMp = 100; ch.mp = 100; ch.atk = 22; ch.speed = 4.2; ch.level = 1;
      body = new PIXI.Sprite(SpriteFactory.humanoid('spear', { robe: 0xb85c1e, trim: 0xffe9a8, skin: 0xe8b88a, hair: 0x2a1a08 }));
      weapon = new PIXI.Sprite(SpriteFactory.weapon('w_spear', 'spear', 0xff8a3c));
    } else if (type === 'mage') {
      ch.kind = 'party'; ch.maxHp = 260; ch.hp = 260; ch.maxMp = 240; ch.mp = 240; ch.atk = 30; ch.speed = 4.0; ch.level = 1;
      body = new PIXI.Sprite(SpriteFactory.humanoid('mage', { robe: 0x7a3fd4, trim: 0xe0aaff, skin: 0xf7d3ae, hair: 0x3a2a5e }));
      weapon = new PIXI.Sprite(SpriteFactory.weapon('w_fan', 'fan', 0x9d4edd));
    } else if (type === 'npc') {
      ch.kind = 'npc'; ch.maxHp = 9999; ch.hp = 9999; ch.atk = 0;
      body = new PIXI.Sprite(SpriteFactory.humanoid('npc', { robe: 0x2e5e2e, trim: 0xc9a94f, skin: 0xf2c89b, hair: 0x111111 }));
      weapon = new PIXI.Sprite(SpriteFactory.weapon('w_spear2', 'spear', 0xc9a94f));
    } else if (type === 'npc2') {
      ch.kind = 'npc'; ch.maxHp = 9999; ch.hp = 9999; ch.atk = 0;
      body = new PIXI.Sprite(SpriteFactory.humanoid('npc2', { robe: 0xe8eef7, trim: 0x5cb8ff, skin: 0xf2c89b, hair: 0xe8e8e8 }));
      weapon = new PIXI.Sprite(SpriteFactory.weapon('w_staff', 'staff', 0x5cb8ff));
    } else if (type === 'boss') {
      ch.kind = 'boss'; ch.isBoss = true; ch.maxHp = ENEMY_DEFS.boss.hp; ch.hp = ch.maxHp; ch.atk = ENEMY_DEFS.boss.atk;
      ch.speed = ENEMY_DEFS.boss.speed; ch.radius = 1.1; ch.level = 15;
      ch.xp = ENEMY_DEFS.boss.xp; ch.gold = ENEMY_DEFS.boss.gold; ch.range = ENEMY_DEFS.boss.range;
      body = new PIXI.Sprite(SpriteFactory.boss());
    } else {
      var def = ENEMY_DEFS[type] || ENEMY_DEFS.snow;
      ch.maxHp = def.hp; ch.hp = def.hp; ch.atk = def.atk; ch.speed = def.speed; ch.radius = 0.55;
      ch.xp = def.xp; ch.gold = def.gold; ch.range = def.range;
      ch.isElite = (type === 'elite');
      if (type === 'snow') body = new PIXI.Sprite(SpriteFactory.monster('snow', { body: 0xdfe8f2, belly: 0xffffff, horns: true, eye: 0x2b5cb8 }));
      else if (type === 'bandit') body = new PIXI.Sprite(SpriteFactory.monster('bandit', { body: 0x4a3a28, belly: 0x5e4632, horns: false, eye: 0xff2e2e }));
      else body = new PIXI.Sprite(SpriteFactory.monster('elite', { body: 0xb8c8e8, belly: 0xdfe8f2, horns: true, eye: 0xff2e2e, scale: 1.35 }));
    }
    body.anchor.set(0.5, 1);
    c.addChild(body);
    ch.body = body;
    if (weapon) {
      weapon.anchor.set(0.5, 0.85);
      weapon.position.set(16, -34);
      c.addChild(weapon);
      ch.weapon = weapon;
    }
    /* thanh HP */
    var hpC = new PIXI.Container();
    var bg = new PIXI.Graphics(); bg.rect(-22, -84, 44, 6).fill({ color: 0x000000, alpha: 0.6 });
    var fill = new PIXI.Graphics();
    hpC.addChild(bg); hpC.addChild(fill);
    hpC.visible = false;
    c.addChild(hpC);
    ch.hpBar = hpC; ch.hpFill = fill;
    /* tên */
    var nameT = new PIXI.Text({ text: ch.name, style: { fontFamily: 'Arial', fontSize: 11, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
    nameT.anchor.set(0.5, 1); nameT.position.set(0, -88);
    c.addChild(nameT);
    ch.nameText = nameT;
    if (ch.isBoss) { nameT.style.fontSize = 15; nameT.style.fill = 0xffb347; }
    if (ch.kind === 'party') { nameT.style.fill = 0x8dff9e; }
    if (ch.kind === 'npc') { nameT.style.fill = 0xffd94d; }
    c.position.set(isoX(ch.x, ch.y), isoY(ch.x, ch.y));
    c.zIndex = depthOf(ch.x, ch.y);
    Engine.layers.characters.addChild(c);
    return ch;
  },
  updateHpBar: function (ch) {
    var ratio = clamp(ch.hp / ch.maxHp, 0, 1);
    ch.hpFill.clear();
    ch.hpFill.rect(-21, -83, 42 * ratio, 4).fill(ratio > 0.5 ? 0x4dff6e : ratio > 0.25 ? 0xffc93c : 0xff2e2e);
    ch.hpBar.visible = (ch.hp < ch.maxHp && !ch.dead);
  },
  spawnParty: function () {
    var leader = this.make('leader', { x: 28, y: 40, name: 'Lâm Phong' });
    var spear = this.make('spear', { x: 27, y: 41, name: 'Thiết Ngưu' });
    var mage = this.make('mage', { x: 29, y: 41, name: 'Bạch Tuyết' });
    Game.party = [leader, spear, mage];
    Game.leader = leader;
    return leader;
  },
  spawnEnemies: function () {
    var zones = [
      { type: 'snow', n: 9, x0: 8, y0: 8, x1: 20, y1: 20 },
      { type: 'bandit', n: 7, x0: 38, y0: 14, x1: 48, y1: 24 },
      { type: 'elite', n: 3, x0: 44, y0: 26, x1: 52, y1: 34 },
      { type: 'snow', n: 4, x0: 12, y0: 34, x1: 20, y1: 44 }
    ];
    zones.forEach(function (z) {
      for (var i = 0; i < z.n; i++) {
        var ex = rand(z.x0, z.x1), ey = rand(z.y0, z.y1), tries = 0;
        while (TileMap.isBlocked(ex, ey) && tries++ < 6) { ex = rand(z.x0, z.x1); ey = rand(z.y0, z.y1); }
        var e = Characters.make(z.type, { x: ex, y: ey });
        e.homeX = e.x; e.homeY = e.y;
        Game.enemies.push(e);
      }
    });
    var boss = this.make('boss', { x: 48, y: 40, name: 'Long Ngâm Lão Tổ', level: 15 });
    boss.homeX = 48; boss.homeY = 40;
    Game.boss = boss;
    Game.enemies.push(boss);
  },
  /* hoạt ảnh đi bộ / vung vũ khí / chớp khi trúng đòn */
  animate: function (ch, dt, moving) {
    var c = ch.container;
    if (moving) {
      ch.walkPhase += dt * 11;
      c.position.y = isoY(ch.x, ch.y) + Math.abs(Math.sin(ch.walkPhase)) * -4;
      c.rotation = Math.sin(ch.walkPhase) * 0.04;
    } else {
      c.position.y = isoY(ch.x, ch.y);
      c.rotation = 0;
    }
    if (ch.swingT > 0) {
      ch.swingT -= dt;
      if (ch.weapon) ch.weapon.rotation = -2.4 * (1 - ch.swingT / 0.28);
    } else if (ch.weapon) ch.weapon.rotation = 0;
    if (ch.flashT > 0) {
      ch.flashT -= dt;
      ch.body.tint = (Math.floor(ch.flashT * 20) % 2 === 0) ? 0xff8080 : 0xffffff;
      if (ch.flashT <= 0) ch.body.tint = 0xffffff;
    }
    c.position.x = isoX(ch.x, ch.y);
    c.scale.x = ch.dir >= 0 ? 1 : -1;
    c.zIndex = depthOf(ch.x, ch.y);
  }
};

/* ================= INPUT — bàn phím / chuột / joystick cảm ứng ================= */
var Input = {
  moveTarget: null,
  init: function () {
    var self = this;
    window.addEventListener('keydown', function (e) {
      if (!Game.started || Game.over) return;
      Game.keys[e.code] = true;
      if (e.code === 'Space') { e.preventDefault(); Combat.dash(Game.leader); }
      if (e.code === 'KeyJ') Combat.tryAttack(Game.leader);
      if (e.code === 'Digit1') Skills.cast(0);
      if (e.code === 'Digit2') Skills.cast(1);
      if (e.code === 'Digit3') Skills.cast(2);
      if (e.code === 'Digit4') Skills.cast(3);
      if (e.code === 'Digit5') Skills.cast(4);
      if (e.code === 'Digit6') Skills.cast(5);
      if (e.code === 'KeyR') Skills.castUlt();
    });
    window.addEventListener('keyup', function (e) { Game.keys[e.code] = false; });
    /* click chuột: chạm quái = khóa mục tiêu, chạm đất = di chuyển tới */
    var canvas = Engine.app.canvas;
    canvas.addEventListener('pointerdown', function (e) {
      if (!Game.started || Game.over) return;
      var rect = canvas.getBoundingClientRect();
      var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      var w = Input.screenToWorldPoint(sx, sy);
      var hit = null, best = 1.2;
      Game.enemies.forEach(function (en) {
        if (en.dead) return;
        var d = dist(w.x, w.y, en.x, en.y);
        if (d < best) { best = d; hit = en; }
      });
      if (hit) { Game.target = hit; Input.moveTarget = null; Combat.tryAttack(Game.leader); }
      else { Input.moveTarget = w; Game.target = null; }
    });
    /* zoom chuột */
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      Camera.zoomBy(e.deltaY < 0 ? 1.12 : 0.89);
    }, { passive: false });
    /* pinch zoom 2 ngón */
    var pinch = { d0: 0, z0: 1 };
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2) {
        var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (pinch.d0 > 0) Camera.setZoom(pinch.z0 * d / pinch.d0);
        else { pinch.d0 = d; pinch.z0 = Game.camera.zoom; }
      }
    }, { passive: true });
    canvas.addEventListener('touchend', function () { pinch.d0 = 0; });
    /* joystick */
    var joy = $('joy'), knob = $('joyKnob'), joyId = null;
    function joyMove(e) {
      var r = joy.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
      var len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; len = 1; }
      knob.style.transform = 'translate(' + dx * 34 + 'px,' + dy * 34 + 'px)';
      Game.input.x = dx; Game.input.y = dy; Game.input.joy = true;
      Input.moveTarget = null;
    }
    joy.addEventListener('pointerdown', function (e) { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); joyMove(e); });
    joy.addEventListener('pointermove', function (e) { if (e.pointerId === joyId) joyMove(e); });
    function joyEnd(e) {
      if (e.pointerId !== joyId) return;
      joyId = null;
      knob.style.transform = '';
      Game.input.x = 0; Game.input.y = 0; Game.input.joy = false;
    }
    joy.addEventListener('pointerup', joyEnd);
    joy.addEventListener('pointercancel', joyEnd);
    /* nút skill (cảm ứng + chuột) */
    document.querySelectorAll('.skillBtn[data-skill]').forEach(function (b) {
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); Skills.cast(parseInt(b.dataset.skill, 10)); });
    });
    $('btnAtk').addEventListener('pointerdown', function (e) { e.preventDefault(); Combat.tryAttack(Game.leader); });
    $('btnUlt').addEventListener('pointerdown', function (e) { e.preventDefault(); Skills.castUlt(); });
    $('btnDash').addEventListener('pointerdown', function (e) { e.preventDefault(); Combat.dash(Game.leader); });
    $('btnZoomIn').addEventListener('click', function () { Camera.zoomBy(1.2); });
    $('btnZoomOut').addEventListener('click', function () { Camera.zoomBy(0.84); });
    $('btnSound').addEventListener('click', function () {
      AudioMan.muted = !AudioMan.muted;
      $('btnSound').textContent = AudioMan.muted ? '🔇' : '🔊';
    });
    $('btnHelp').addEventListener('click', function () { UI.showDialog('Hướng dẫn', 'Joystick trái / WASD để di chuyển. Chạm vào quái để khóa mục tiêu. Nút ⚔ đánh thường, 1–6 dùng skill, 🌟 tuyệt kỹ, 💨 lướt né. Nói chuyện với Vệ Binh ở cổng thành để nhận nhiệm vụ. Hạ Boss Long Ngâm để chiến thắng!'); });
  },
  readMove: function () {
    var x = 0, y = 0;
    if (Game.keys['KeyW'] || Game.keys['ArrowUp']) y -= 1;
    if (Game.keys['KeyS'] || Game.keys['ArrowDown']) y += 1;
    if (Game.keys['KeyA'] || Game.keys['ArrowLeft']) x -= 1;
    if (Game.keys['KeyD'] || Game.keys['ArrowRight']) x += 1;
    if (x !== 0 || y !== 0) {
      /* màn hình: x = phải, y = xuống → world: wx=(x+y)/√2, wy=(y-x)/√2 */
      var wx = (x + y) / Math.SQRT2, wy = (y - x) / Math.SQRT2;
      var len = Math.hypot(wx, wy);
      return { x: wx / len, y: wy / len };
    }
    if (Game.input.joy && (Game.input.x !== 0 || Game.input.y !== 0)) {
      /* joystick: lên = bắc, phải = đông — chuyển sang world */
      var jx = Game.input.x, jy = Game.input.y;
      var wx2 = (jx + jy) / Math.SQRT2, wy2 = (jy - jx) / Math.SQRT2;
      var l2 = Math.hypot(wx2, wy2) || 1;
      return { x: wx2 / l2, y: wy2 / l2, mag: Math.min(1, Math.hypot(jx, jy)) };
    }
    return { x: 0, y: 0 };
  },
  screenToWorldPoint: function (sx, sy) {
    var cam = Game.camera;
    var wx = (sx - window.innerWidth / 2) / cam.zoom + cam.x;
    var wy = (sy - window.innerHeight / 2 + 40) / cam.zoom + cam.y;
    return screenToWorld(wx, wy);
  }
};

/* ================= CAMERA ================= */
var Camera = {
  setZoom: function (z) { Game.camera.zoom = clamp(z, CFG.MIN_ZOOM, CFG.MAX_ZOOM); },
  zoomBy: function (f) { this.setZoom(Game.camera.zoom * f); },
  update: function (dt) {
    var L = Game.leader;
    if (!L) return;
    var tx = isoX(L.x, L.y), ty = isoY(L.x, L.y);
    var cam = Game.camera;
    cam.x += (tx - cam.x) * Math.min(1, dt * 5);
    cam.y += (ty - cam.y) * Math.min(1, dt * 5);
    var shakeX = 0, shakeY = 0;
    if (Game.shake > 0) {
      Game.shake -= dt;
      shakeX = rand(-1, 1) * Game.shake * 30;
      shakeY = rand(-1, 1) * Game.shake * 30;
    }
    Engine.worldRoot.position.set(
      window.innerWidth / 2 - (cam.x + shakeX) * cam.zoom,
      window.innerHeight / 2 - (cam.y + shakeY) * cam.zoom - 40
    );
    Engine.worldRoot.scale.set(cam.zoom);
  }
};

/* ================= DI CHUYỂN & VA CHẠM ================= */
function tryMove(ch, dx, dy, dt) {
  var sp = ch.speed * (ch.slowT > 0 ? 0.55 : 1);
  if (ch.dashT > 0) { sp *= 3; dx = ch.dashDx; dy = ch.dashDy; }
  var nx = ch.x + dx * sp * dt, ny = ch.y + dy * sp * dt;
  if (!TileMap.isBlocked(nx, ch.y)) ch.x = nx;
  if (!TileMap.isBlocked(ch.x, ny)) ch.y = ny;
  ch.x = clamp(ch.x, 1, CFG.MAP_W - 2);
  ch.y = clamp(ch.y, 1, CFG.MAP_H - 2);
  if (dx !== 0 || dy !== 0) ch.dir = dx >= 0 ? 1 : -1;
  return (dx !== 0 || dy !== 0);
}

/* ================= AI — ĐỒNG ĐỘI ================= */
var PartyAI = {
  update: function (dt) {
    var L = Game.leader;
    if (!L || !Game.started || Game.over) return;
    /* leader di chuyển */
    var mv = Input.readMove();
    var moving = false;
    if (mv.x !== 0 || mv.y !== 0) {
      moving = tryMove(L, mv.x, mv.y, dt * (mv.mag || 1));
      Input.moveTarget = null;
    } else if (Input.moveTarget) {
      var d = dist(L.x, L.y, Input.moveTarget.x, Input.moveTarget.y);
      if (d > 0.4) {
        var dx = (Input.moveTarget.x - L.x) / d, dy = (Input.moveTarget.y - L.y) / d;
        moving = tryMove(L, dx, dy, dt);
      } else Input.moveTarget = null;
    }
    if (L.dashT > 0) { L.dashT -= dt; moving = true; tryMove(L, 0, 0, dt); }
    if (L.slowT > 0) L.slowT -= dt;
    /* tự đánh khi có quái gần */
    if (!Game.target || Game.target.dead) {
      Game.target = this.nearestEnemy(L, 6);
    }
    if (Game.target && !Game.target.dead) {
      var td = dist(L.x, L.y, Game.target.x, Game.target.y);
      if (td < 1.4) Combat.tryAttack(L);
      else if (mv.x === 0 && mv.y === 0 && !Input.moveTarget) {
        var dx2 = (Game.target.x - L.x) / td, dy2 = (Game.target.y - L.y) / td;
        moving = tryMove(L, dx2, dy2, dt);
      }
    }
    Characters.animate(L, dt, moving);
    /* 2 đồng đội: đánh quái gần, không thì bám theo leader */
    var offsets = [{ x: -1.2, y: 0.8 }, { x: 1.2, y: 0.8 }];
    for (var i = 1; i < Game.party.length; i++) {
      var m = Game.party[i];
      if (m.dead) { this.handleDead(m, dt); continue; }
      if (m.slowT > 0) m.slowT -= dt;
      var foe = this.nearestEnemy(m, 4.5);
      var mv2 = false;
      if (foe) {
        var fd = dist(m.x, m.y, foe.x, foe.y);
        if (fd < 1.3) Combat.tryAttack(m);
        else { mv2 = tryMove(m, (foe.x - m.x) / fd, (foe.y - m.y) / fd, dt); }
        /* đồng đội tự xài skill khi đông quái */
        if (m.type === 'mage' && !m.skillCd.mageNova) { Skills.followerSkill(m, 'nova'); m.skillCd.mageNova = 6; }
        if (m.type === 'spear' && !m.skillCd.spearSpin) { Skills.followerSkill(m, 'spin'); m.skillCd.spearSpin = 7; }
      } else {
        var ox = L.x + offsets[i - 1].x, oy = L.y + offsets[i - 1].y;
        var od = dist(m.x, m.y, ox, oy);
        if (od > 9) { m.x = ox; m.y = oy; }
        else if (od > 0.6) { mv2 = tryMove(m, (ox - m.x) / od, (oy - m.y) / od, dt); }
      }
      for (var k in m.skillCd) { m.skillCd[k] -= dt; if (m.skillCd[k] <= 0) delete m.skillCd[k]; }
      Characters.animate(m, dt, mv2);
    }
  },
  nearestEnemy: function (from, range) {
    var best = null, bd = range;
    Game.enemies.forEach(function (e) {
      if (e.dead) return;
      var d = dist(from.x, from.y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  },
  handleDead: function (m, dt) {
    m.respawnT -= dt;
    m.container.alpha = 0.35;
    if (m.respawnT <= 0) {
      m.dead = false; m.hp = Math.floor(m.maxHp * 0.6);
      m.x = Game.leader.x + rand(-1, 1); m.y = Game.leader.y + rand(-1, 1);
      m.container.alpha = 1;
      Effects.ring(m.x, m.y, 0x4dff6e, 1.2);
      UI.toast(m.name + ' đã hồi sinh!');
    }
  }
};

/* ================= AI — QUÁI & BOSS ================= */
var EnemyAI = {
  update: function (dt) {
    for (var i = 0; i < Game.enemies.length; i++) {
      var e = Game.enemies[i];
      if (e.dead) {
        e.respawnT -= dt;
        if (e.respawnT <= 0) this.respawn(e);
        continue;
      }
      if (e.slowT > 0) e.slowT -= dt;
      e.attackCd -= dt;
      e.aiTimer -= dt;
      var foe = this.nearestParty(e, e.isBoss ? 11 : 7);
      var moving = false;
      if (foe) {
        var d = dist(e.x, e.y, foe.x, foe.y);
        var range = e.isBoss ? 1.9 : 1.25;
        if (d > range) {
          moving = tryMove(e, (foe.x - e.x) / d, (foe.y - e.y) / d, dt);
        } else if (e.attackCd <= 0) {
          e.attackCd = e.isBoss ? 1.4 : 1.1;
          e.swingT = 0.28;
          Combat.dealDamage(e, foe, e.atk, false);
          AudioMan.sfx('hit');
          if (e.isBoss) this.bossAttack(e, foe);
        }
      } else {
        /* patrol quanh home */
        if (e.aiTimer <= 0) {
          e.aiTimer = rand(2, 4);
          e.wanderX = e.homeX + rand(-2, 2);
          e.wanderY = e.homeY + rand(-2, 2);
        }
        if (e.wanderX !== undefined) {
          var wd = dist(e.x, e.y, e.wanderX, e.wanderY);
          if (wd > 0.4) moving = tryMove(e, (e.wanderX - e.x) / wd, (e.wanderY - e.y) / wd, dt);
        }
      }
      /* boss: dưới 50% HP → cuồng nộ + triệu hồi */
      if (e.isBoss && !e.enraged && e.hp < e.maxHp * 0.5) {
        e.enraged = true;
        e.atk = Math.floor(e.atk * 1.4); e.speed *= 1.3;
        UI.banner('LONG NGÂM CUỒNG NỘ!', 'Boss tăng sức mạnh — cẩn thận đòn AoE!');
        Effects.ring(e.x, e.y, 0xff2e2e, 3);
        Game.shake = 0.5;
        for (var s = 0; s < 2; s++) {
          var min = Characters.make('snow', { x: e.x + rand(-2, 2), y: e.y + rand(-2, 2) });
          min.homeX = e.x; min.homeY = e.y;
          Game.enemies.push(min);
        }
      }
      Characters.animate(e, dt, moving);
      Characters.updateHpBar(e);
    }
  },
  nearestParty: function (from, range) {
    var best = null, bd = range;
    Game.party.forEach(function (p) {
      if (p.dead) return;
      var d = dist(from.x, from.y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    });
    return best;
  },
  bossAttack: function (boss, foe) {
    /* đòn quét AoE vàng mỗi 4 đòn */
    boss.hitCount = (boss.hitCount || 0) + 1;
    if (boss.hitCount % 4 === 0) {
      Effects.ring(boss.x, boss.y, 0xffd94d, 3.2);
      Game.shake = 0.35;
      AudioMan.sfx('skill');
      Game.party.forEach(function (p) {
        if (!p.dead && dist(p.x, p.y, boss.x, boss.y) < 3.2) {
          Combat.dealDamage(boss, p, Math.floor(boss.atk * 1.2), false, true);
        }
      });
    }
  },
  respawn: function (e) {
    if (e.isBoss) {
      e.respawnT = 60;
      if (!e.dead) return;
      e.dead = false; e.hp = e.maxHp; e.atk = ENEMY_DEFS.boss.atk; e.speed = ENEMY_DEFS.boss.speed;
      e.enraged = false; e.x = e.homeX; e.y = e.homeY;
      e.container.visible = true; e.container.alpha = 1;
      Characters.updateHpBar(e);
      UI.toast('Long Ngâm Lão Tổ đã hồi sinh ở đấu trường!');
      return;
    }
    e.dead = false; e.hp = e.maxHp;
    e.x = e.homeX + rand(-1, 1); e.y = e.homeY + rand(-1, 1);
    e.container.visible = true; e.container.alpha = 1;
    Characters.updateHpBar(e);
  }
};

/* ================= COMBAT ================= */
var Combat = {
  attackCd: 0,
  tryAttack: function (ch) {
    if (!ch || ch.dead || Game.over) return;
    if (ch.attackCd > 0) return;
    var foe = null;
    if (ch === Game.leader && Game.target && !Game.target.dead && dist(ch.x, ch.y, Game.target.x, Game.target.y) < 1.6) foe = Game.target;
    if (!foe) foe = PartyAI.nearestEnemy(ch, 1.5);
    if (!foe) return;
    ch.attackCd = ch === Game.leader ? 0.55 : 0.85;
    ch.swingT = 0.28;
    ch.dir = foe.x >= ch.x ? 1 : -1;
    AudioMan.sfx('swing');
    Effects.slash(foe.x, foe.y);
    this.dealDamage(ch, foe, ch.atk, false);
  },
  dealDamage: function (atk, tgt, base, isSkill, noCrit) {
    if (!tgt || tgt.dead) return 0;
    var crit = !noCrit && Math.random() < 0.15;
    var dmg = Math.max(1, Math.round(base * rand(0.85, 1.15) - (tgt.def || 0)));
    if (crit) dmg = Math.round(dmg * 1.8);
    tgt.hp -= dmg;
    tgt.flashT = 0.12;
    Characters.updateHpBar(tgt);
    Effects.dmgNumber(tgt.x, tgt.y, dmg, crit, isSkill);
    if (tgt === Game.leader) { Game.shake = Math.max(Game.shake, 0.12); }
    if (tgt.hp <= 0) this.kill(tgt, atk);
    else if (tgt.kind === 'enemy' || tgt.kind === 'boss') { tgt.hpBar.visible = true; }
    return dmg;
  },
  kill: function (tgt, atk) {
    tgt.hp = 0;
    tgt.dead = true;
    tgt.container.visible = false;
    Characters.updateHpBar(tgt);
    AudioMan.sfx('death');
    Effects.burst(tgt.x, tgt.y, tgt.isBoss ? 0xffd94d : 0xff5a4e, tgt.isBoss ? 40 : 14);
    if (tgt.kind === 'enemy' || tgt.kind === 'boss') {
      Game.kills++;
      var isBoss = tgt.isBoss;
      /* loot */
      var coins = isBoss ? 8 : randInt(1, 3);
      for (var i = 0; i < coins; i++) Loot.spawn('gold', tgt.x + rand(-0.8, 0.8), tgt.y + rand(-0.8, 0.8), isBoss ? 40 : randInt(4, 12));
      if (Math.random() < (isBoss ? 1 : 0.35)) Loot.spawn('hp', tgt.x + rand(-0.6, 0.6), tgt.y + rand(-0.6, 0.6), 40);
      /* XP */
      Progression.gainXp(tgt.xp || 25);
      /* quest */
      if (!isBoss) {
        var q = QUESTS[Game.questIdx];
        if (q && ((q.kind === 'snow' && tgt.type === 'snow') || (q.kind === 'bandit' && tgt.type === 'bandit'))) {
          Game.questKill++;
          UI.updateQuest();
          if (Game.questKill >= q.need) Quests.complete();
        }
      } else {
        Game.bossKills++;
        $('bossBarWrap').style.display = 'none';
        if (Game.questIdx === 2) { Game.questKill = 1; Quests.complete(); }
        else UI.banner('BOSS ĐÃ BỊ HẠ!', 'Long Ngâm Lão Tổ gục ngã — nhận ' + tgt.gold + ' vàng!');
      }
      tgt.respawnT = isBoss ? 60 : (tgt.isElite ? 30 : 12);
      if (Game.target === tgt) Game.target = null;
    } else if (tgt.kind === 'party') {
      tgt.respawnT = 8;
      UI.toast(tgt.name + ' đã gục — sẽ hồi sinh sau 8s!');
      if (Game.party.every(function (p) { return p.dead; })) {
        Game.over = true;
        UI.showEnd(false);
      }
    }
  },
  dash: function (ch) {
    if (!ch || ch.dead || ch.dashCd > 0 || Game.over) return;
    var mv = Input.readMove();
    var dx = mv.x, dy = mv.y;
    if (dx === 0 && dy === 0) { dx = ch.dir; dy = 0; }
    var len = Math.hypot(dx, dy) || 1;
    ch.dashDx = dx / len; ch.dashDy = dy / len;
    ch.dashT = 0.18; ch.dashCd = 1.2;
    AudioMan.sfx('swing');
    Effects.burst(ch.x, ch.y, 0x9fc8e8, 6);
  }
};

/* ================= SKILLS — 9 chiêu võ lâm ================= */
var SKILLS = [
  { name: 'Kiếm Khí', mp: 15, cd: 2.5, desc: 'Sóng kiếm xanh bay xa' },
  { name: 'Kim Cương Hoàn', mp: 20, cd: 5, desc: 'Vòng vàng AoE quanh thân' },
  { name: 'Long Kích', mp: 25, cd: 6, desc: 'Lao tới như rồng, sát thương đường thẳng' },
  { name: 'Hỏa Bạo', mp: 25, cd: 6, desc: 'Nổ lửa tại mục tiêu' },
  { name: 'Băng Phong Bạo', mp: 30, cd: 8, desc: 'Bão băng làm chậm + sát thương' },
  { name: 'Lôi Đình', mp: 30, cd: 8, desc: 'Sét đánh 5 quái ngẫu nhiên' }
];
var ULT = { name: 'Thần Long Giáng Thế', mp: 60, cd: 30 };

var Skills = {
  cds: [0, 0, 0, 0, 0, 0], ultCd: 0,
  cast: function (i) {
    var L = Game.leader;
    if (!L || L.dead || Game.over) return;
    var s = SKILLS[i];
    if (this.cds[i] > 0) return;
    if (L.mp < s.mp) { UI.toast('Không đủ MP!'); return; }
    L.mp -= s.mp;
    this.cds[i] = s.cd;
    L.swingT = 0.28;
    AudioMan.sfx('skill');
    var tgt = Game.target && !Game.target.dead ? Game.target : PartyAI.nearestEnemy(L, 9);
    var base = 40 + Game.leader.level * 6;
    if (i === 0) {
      var dx = tgt ? (tgt.x - L.x) : L.dir, dy = tgt ? (tgt.y - L.y) : 0;
      var len = Math.hypot(dx, dy) || 1;
      Effects.wave(L.x, L.y, dx / len, dy / len, base);
    } else if (i === 1) {
      Effects.ring(L.x, L.y, 0xffd94d, 2.8);
      Game.shake = 0.2;
      this.aoe(L.x, L.y, 2.8, base + 15, L);
    } else if (i === 2) {
      var dx2 = tgt ? (tgt.x - L.x) : L.dir, dy2 = tgt ? (tgt.y - L.y) : 0;
      var l2 = Math.hypot(dx2, dy2) || 1;
      L.dashDx = dx2 / l2; L.dashDy = dy2 / l2; L.dashT = 0.22;
      Effects.dragonSegment(L.x, L.y, dx2 / l2, dy2 / l2, base + 30);
      this.aoe(L.x + dx2 / l2 * 1.5, L.y + dy2 / l2 * 1.5, 1.8, base + 30, L);
    } else if (i === 3) {
      var tx = tgt ? tgt.x : L.x + L.dir * 2, ty = tgt ? tgt.y : L.y;
      Effects.fire(tx, ty);
      Game.shake = 0.25;
      this.aoe(tx, ty, 2.2, base + 25, L);
    } else if (i === 4) {
      var tx2 = tgt ? tgt.x : L.x, ty2 = tgt ? tgt.y : L.y;
      Effects.ice(tx2, ty2);
      this.aoe(tx2, ty2, 3, base + 5, L, true);
    } else if (i === 5) {
      var foes = Game.enemies.filter(function (e) { return !e.dead && dist(e.x, e.y, L.x, L.y) < 9; });
      for (var k = 0; k < Math.min(5, foes.length); k++) {
        var f = foes[Math.floor(Math.random() * foes.length)];
        Effects.lightning(f.x, f.y);
        Combat.dealDamage(L, f, base + 10, true);
      }
      if (foes.length === 0) UI.toast('Không có quái trong tầm sét!');
    }
    UI.updateSkillButtons();
  },
  castUlt: function () {
    var L = Game.leader;
    if (!L || L.dead || Game.over) return;
    if (this.ultCd > 0) return;
    if (L.mp < ULT.mp) { UI.toast('Không đủ MP cho Tuyệt Kỹ!'); return; }
    L.mp -= ULT.mp;
    this.ultCd = ULT.cd;
    AudioMan.sfx('ult');
    Game.shake = 0.6;
    var base = 120 + Game.leader.level * 10;
    Effects.dragonUlt(L.x, L.y);
    Effects.ring(L.x, L.y, 0xffd94d, 5);
    Game.enemies.forEach(function (e) {
      if (!e.dead && dist(e.x, e.y, L.x, L.y) < 5.5) Combat.dealDamage(L, e, base, true);
    });
    UI.banner('THẦN LONG GIÁNG THẾ!', 'Tuyệt kỹ võ lâm chấn động Trường Bạch!');
    UI.updateSkillButtons();
  },
  followerSkill: function (m, kind) {
    if (m.dead) return;
    if (kind === 'nova') {
      Effects.ice(m.x, m.y);
      this.aoe(m.x, m.y, 2.4, 30 + Game.leader.level * 3, m, true);
    } else if (kind === 'spin') {
      Effects.ring(m.x, m.y, 0xff8a3c, 2.2);
      this.aoe(m.x, m.y, 2.2, 35 + Game.leader.level * 3, m);
    }
    m.swingT = 0.28;
    AudioMan.sfx('skill');
  },
  aoe: function (x, y, r, dmg, src, slow) {
    Game.enemies.forEach(function (e) {
      if (e.dead) return;
      if (dist(e.x, e.y, x, y) <= r) {
        Combat.dealDamage(src, e, dmg, true);
        if (slow && !e.dead) e.slowT = 3;
      }
    });
  },
  tick: function (dt) {
    for (var i = 0; i < this.cds.length; i++) if (this.cds[i] > 0) this.cds[i] -= dt;
    if (this.ultCd > 0) this.ultCd -= dt;
    Game.party.forEach(function (p) { if (p.attackCd > 0) p.attackCd -= dt; if (p.dashCd > 0) p.dashCd -= dt; });
  }
};

/* ================= HIỆU ỨNG & HẠT ================= */
var Effects = {
  fx: [], dmgPool: [], dmgIdx: 0,
  init: function () {
    for (var i = 0; i < 24; i++) {
      var t = new PIXI.Text({ text: '', style: { fontFamily: 'Arial', fontSize: 16, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0x000000, width: 4 } } });
      t.anchor.set(0.5, 1);
      t.visible = false;
      Engine.layers.effects.addChild(t);
      this.dmgPool.push(t);
    }
    /* tuyết rơi */
    this.snow = [];
    for (var s = 0; s < 110; s++) {
      var fl = new PIXI.Graphics();
      fl.circle(0, 0, rand(1.5, 3.5)).fill({ color: 0xffffff, alpha: rand(0.4, 0.9) });
      fl.position.set(rand(0, window.innerWidth), rand(0, window.innerHeight));
      fl.userData = { vx: rand(-14, 14), vy: rand(22, 55) };
      Engine.snowLayer.addChild(fl);
      this.snow.push(fl);
    }
  },
  dmgNumber: function (x, y, dmg, crit, isSkill) {
    var t = this.dmgPool[this.dmgIdx++ % this.dmgPool.length];
    t.text = (crit ? '💥 ' : '') + dmg;
    t.style.fontSize = crit ? 22 : isSkill ? 19 : 16;
    t.style.fill = crit ? 0xffd94d : isSkill ? 0x7ad4ff : 0xffffff;
    t.position.set(isoX(x, y) + rand(-8, 8), isoY(x, y) - 70);
    t.alpha = 1; t.visible = true;
    t.userData = { life: 0.9 };
  },
  ring: function (x, y, color, maxR) {
    var g = new PIXI.Graphics();
    g.position.set(isoX(x, y), isoY(x, y));
    g.zIndex = depthOf(x, y) + 0.5;
    Engine.layers.effects.addChild(g);
    this.fx.push({ kind: 'ring', g: g, t: 0, dur: 0.55, color: color, maxR: maxR * 32 });
  },
  slash: function (x, y) {
    var g = new PIXI.Graphics();
    g.position.set(isoX(x, y), isoY(x, y) - 40);
    g.zIndex = depthOf(x, y) + 0.5;
    Engine.layers.effects.addChild(g);
    this.fx.push({ kind: 'slash', g: g, t: 0, dur: 0.22 });
  },
  burst: function (x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var g = new PIXI.Graphics();
      var r = rand(2, 5);
      g.circle(0, 0, r).fill(color);
      g.position.set(isoX(x, y), isoY(x, y) - 30);
      g.zIndex = depthOf(x, y) + 0.5;
      Engine.layers.effects.addChild(g);
      var a = rand(0, Math.PI * 2), sp = rand(40, 160);
      this.fx.push({ kind: 'dot', g: g, t: 0, dur: rand(0.35, 0.7), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60 });
    }
  },
  wave: function (x, y, dx, dy, dmg) {
    var g = new PIXI.Graphics();
    g.moveTo(0, -14).lineTo(22, 0).lineTo(0, 14).closePath().fill({ color: 0x5cb8ff, alpha: 0.9 });
    g.moveTo(0, -8).lineTo(14, 0).lineTo(0, 8).closePath().fill(0xffffff);
    g.position.set(isoX(x, y), isoY(x, y) - 36);
    g.rotation = Math.atan2((dy + dx) * 0.5, dx - dy);
    g.zIndex = depthOf(x, y) + 0.5;
    Engine.layers.effects.addChild(g);
    this.fx.push({ kind: 'proj', g: g, t: 0, dur: 0.8, dx: dx, dy: dy, dmg: dmg, hit: {} });
  },
  fire: function (x, y) {
    for (var i = 0; i < 22; i++) {
      var g = new PIXI.Graphics();
      g.circle(0, 0, rand(3, 7)).fill(pick([0xff5a1e, 0xff8a3c, 0xffd94d]));
      g.position.set(isoX(x, y) + rand(-30, 30), isoY(x, y) - rand(10, 50));
      g.zIndex = depthOf(x, y) + 0.5;
      Engine.layers.effects.addChild(g);
      this.fx.push({ kind: 'dot', g: g, t: 0, dur: rand(0.4, 0.8), vx: rand(-20, 20), vy: rand(-90, -30) });
    }
    this.ring(x, y, 0xff8a3c, 2.2);
  },
  ice: function (x, y) {
    for (var i = 0; i < 18; i++) {
      var g = new PIXI.Graphics();
      g.moveTo(0, -10).lineTo(4, 0).lineTo(0, 10).lineTo(-4, 0).closePath().fill(0x9fdcff);
      g.position.set(isoX(x, y) + rand(-50, 50), isoY(x, y) - rand(0, 60));
      g.zIndex = depthOf(x, y) + 0.5;
      Engine.layers.effects.addChild(g);
      this.fx.push({ kind: 'dot', g: g, t: 0, dur: rand(0.5, 0.9), vx: rand(-10, 10), vy: rand(20, 60) });
    }
    this.ring(x, y, 0x9fdcff, 3);
  },
  lightning: function (x, y) {
    var g = new PIXI.Graphics();
    var bx = isoX(x, y), by = isoY(x, y) - 40;
    g.moveTo(bx + rand(-6, 6), by - 150);
    for (var i = 1; i <= 5; i++) g.lineTo(bx + rand(-16, 16), by - 150 + i * 30);
    g.stroke({ width: 4, color: 0xffe95c });
    g.moveTo(bx, by - 150);
    for (var j = 1; j <= 5; j++) g.lineTo(bx + rand(-10, 10), by - 150 + j * 30);
    g.stroke({ width: 2, color: 0xffffff });
    g.zIndex = depthOf(x, y) + 0.5;
    Engine.layers.effects.addChild(g);
    this.fx.push({ kind: 'bolt', g: g, t: 0, dur: 0.25 });
    this.burst(x, y, 0xffe95c, 8);
  },
  dragonSegment: function (x, y, dx, dy, dmg) {
    for (var i = 0; i < 7; i++) {
      var g = new PIXI.Graphics();
      g.circle(0, 0, 10 - i).fill(i % 2 ? 0xffd94d : 0xff8a3c);
      var px = x + dx * i * 0.4, py = y + dy * i * 0.4;
      g.position.set(isoX(px, py), isoY(px, py) - 36 - Math.sin(i) * 8);
      g.zIndex = depthOf(px, py) + 0.5;
      Engine.layers.effects.addChild(g);
      this.fx.push({ kind: 'dot', g: g, t: 0, dur: 0.4, vx: dx * 220, vy: dy * 110 });
    }
  },
  dragonUlt: function (x, y) {
    for (var i = 0; i < 26; i++) {
      var g = new PIXI.Graphics();
      g.circle(0, 0, 12 - i * 0.35).fill(i % 2 ? 0xffd94d : 0x5cb8ff);
      var ang = i * 0.35;
      var px = x + Math.cos(ang) * (1.2 + i * 0.28), py = y + Math.sin(ang) * (1.2 + i * 0.28) * 0.5;
      g.position.set(isoX(px, py), isoY(px, py) - 50 - Math.sin(i * 0.6) * 18);
      g.zIndex = depthOf(px, py) + 0.6;
      Engine.layers.effects.addChild(g);
      this.fx.push({ kind: 'dot', g: g, t: 0, dur: 0.9, vx: Math.cos(ang) * 60, vy: -30 });
    }
  },
  update: function (dt) {
    /* tuyết rơi */
    if (this.snow) {
      this.snow.forEach(function (f) {
        f.position.x += f.userData.vx * dt;
        f.position.y += f.userData.vy * dt;
        if (f.position.y > window.innerHeight + 10) { f.position.y = -10; f.position.x = rand(0, window.innerWidth); }
        if (f.position.x < -10) f.position.x = window.innerWidth + 10;
        if (f.position.x > window.innerWidth + 10) f.position.x = -10;
      });
    }
    /* số damage bay lên */
    this.dmgPool.forEach(function (t) {
      if (!t.visible) return;
      t.userData.life -= dt;
      t.position.y -= 42 * dt;
      t.alpha = Math.max(0, t.userData.life / 0.9);
      if (t.userData.life <= 0) t.visible = false;
    });
    /* fx */
    for (var i = this.fx.length - 1; i >= 0; i--) {
      var f = this.fx[i];
      f.t += dt;
      var k = f.t / f.dur;
      if (k >= 1) { Engine.layers.effects.removeChild(f.g); f.g.destroy(); this.fx.splice(i, 1); continue; }
      if (f.kind === 'ring') {
        var r = f.maxR * (0.15 + 0.85 * k);
        f.g.clear();
        f.g.circle(0, 0, r).stroke({ width: 6 * (1 - k) + 2, color: f.color, alpha: 1 - k });
        f.g.circle(0, 0, r * 0.75).stroke({ width: 3 * (1 - k) + 1, color: 0xffffff, alpha: (1 - k) * 0.8 });
      } else if (f.kind === 'slash') {
        f.g.clear();
        f.g.arc(0, 0, 34, -0.6 + k * 1.2, 0.4 + k * 1.2).stroke({ width: 7 * (1 - k) + 2, color: 0x9fdcff, alpha: 1 - k });
      } else if (f.kind === 'dot') {
        f.g.position.x += f.vx * dt;
        f.g.position.y += f.vy * dt;
        f.g.alpha = 1 - k;
      } else if (f.kind === 'bolt') {
        f.g.alpha = 1 - k * 0.7;
      } else if (f.kind === 'proj') {
        Game.enemies.forEach(function (e) {
          if (e.dead || f.hit[e.id]) return;
          var ex = isoX(e.x, e.y), ey = isoY(e.x, e.y) - 36;
          if (Math.hypot(ex - f.g.position.x, ey - f.g.position.y) < 42) {
            f.hit[e.id] = true;
            Combat.dealDamage(Game.leader, e, f.dmg, true);
          }
        });
        /* world (dx,dy) → màn hình iso: sx=(dx-dy)*S, sy=(dx+dy)*S/2 */
        var S = 340;
        f.g.position.x += (f.dx - f.dy) * S * dt;
        f.g.position.y += (f.dx + f.dy) * S * 0.5 * dt;
        f.g.alpha = 1 - k * 0.5;
      }
    }
  }
};

/* ================= LOOT ================= */
var Loot = {
  spawn: function (kind, x, y, val) {
    var g = new PIXI.Graphics();
    if (kind === 'gold') {
      g.circle(0, 0, 8).fill(0xffd94d);
      g.circle(0, 0, 5).fill(0xfff3b0);
    } else {
      g.circle(0, 0, 9).fill(0x2ecc71);
      g.rect(-2, -6, 4, 12).fill(0xffffff);
      g.rect(-6, -2, 12, 4).fill(0xffffff);
    }
    g.position.set(isoX(x, y), isoY(x, y) - 10);
    g.zIndex = depthOf(x, y) + 0.2;
    Engine.layers.effects.addChild(g);
    Game.loots.push({ kind: kind, val: val, x: x, y: y, g: g, t: 0 });
  },
  update: function (dt) {
    var L = Game.leader;
    for (var i = Game.loots.length - 1; i >= 0; i--) {
      var l = Game.loots[i];
      l.t += dt;
      l.g.position.y = isoY(l.x, l.y) - 10 + Math.sin(l.t * 4) * 3;
      if (L && !L.dead) {
        var d = dist(L.x, L.y, l.x, l.y);
        if (d < 2.2) {
          var dx = (L.x - l.x) / (d || 1), dy = (L.y - l.y) / (d || 1);
          l.x += dx * 6 * dt; l.y += dy * 6 * dt;
          l.g.position.set(isoX(l.x, l.y), isoY(l.x, l.y) - 10);
        }
        if (d < 0.6) {
          if (l.kind === 'gold') { Game.gold += l.val; }
          else {
            Game.party.forEach(function (p) { if (!p.dead) p.hp = Math.min(p.maxHp, p.hp + l.val); });
            UI.toast('+' + l.val + ' HP cho cả đội!');
          }
          AudioMan.sfx('pickup');
          Engine.layers.effects.removeChild(l.g);
          l.g.destroy();
          Game.loots.splice(i, 1);
        }
      }
      if (l.t > 45) {
        Engine.layers.effects.removeChild(l.g);
        l.g.destroy();
        Game.loots.splice(i, 1);
      }
    }
  }
};

/* ================= TIẾN TRÌNH — XP / LEVEL ================= */
var Progression = {
  xp: 0, xpNeed: 100, level: 1,
  gainXp: function (n) {
    this.xp += n;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = Math.floor(100 * Math.pow(1.35, this.level - 1));
      Game.party.forEach(function (p) {
        p.level = Progression.level;
        p.maxHp = Math.floor(p.maxHp * 1.12);
        p.atk = Math.floor(p.atk * 1.1);
        p.hp = p.maxHp; p.mp = p.maxMp;
      });
      AudioMan.sfx('levelup');
      Effects.ring(Game.leader.x, Game.leader.y, 0xffd94d, 3);
      Effects.burst(Game.leader.x, Game.leader.y, 0xffd94d, 24);
      UI.banner('⭐ LÊN CẤP ' + this.level + '!', 'HP/MP hồi đầy — sức mạnh tăng!');
    }
  }
};

/* ================= UI — HUD / MINIMAP / NHIỆM VỤ ================= */
var UI = {
  partyBuilt: false,
  buildParty: function () {
    var box = $('partyBox');
    box.innerHTML = '';
    var colors = ['#2b5cb8', '#b85c1e', '#7a3fd4'];
    var icons = ['⚔', '🔱', '❄'];
    Game.party.forEach(function (p, i) {
      var div = document.createElement('div');
      div.className = 'panel member' + (i === 0 ? ' leader' : '');
      div.id = 'member' + i;
      div.innerHTML = '<div class="avatar" style="background:' + colors[i] + '">' + icons[i] + '</div>' +
        '<div class="info"><div class="mname">' + p.name + ' · Lv<span class="mlvl">' + p.level + '</span></div>' +
        '<div class="mbar"><div class="mhp" style="width:100%"></div></div>' +
        '<div class="mbar"><div class="mmp" style="width:100%"></div></div></div>';
      box.appendChild(div);
    });
    this.partyBuilt = true;
  },
  update: function () {
    var L = Game.leader;
    if (!L) return;
    $('hpFill').style.width = clamp(L.hp / L.maxHp * 100, 0, 100) + '%';
    $('mpFill').style.width = clamp(L.mp / L.maxMp * 100, 0, 100) + '%';
    $('xpFill').style.width = clamp(Progression.xp / Progression.xpNeed * 100, 0, 100) + '%';
    $('hpText').textContent = Math.max(0, Math.ceil(L.hp)) + '/' + L.maxHp;
    $('mpText').textContent = Math.floor(L.mp) + '/' + L.maxMp;
    $('lvlBadge').textContent = Progression.level;
    $('goldText').textContent = Game.gold;
    Game.party.forEach(function (p, i) {
      var el = $('member' + i);
      if (!el) return;
      el.querySelector('.mhp').style.width = clamp(p.hp / p.maxHp * 100, 0, 100) + '%';
      el.querySelector('.mmp').style.width = clamp(p.mp / p.maxMp * 100, 0, 100) + '%';
      el.querySelector('.mlvl').textContent = p.level;
      el.classList.toggle('dead', !!p.dead);
    });
    /* combo */
    if (Game.combo >= 3) {
      $('comboBox').style.display = 'block';
      $('comboNum').textContent = Game.combo;
    } else $('comboBox').style.display = 'none';
    /* boss bar */
    var B = Game.boss;
    if (B && !B.dead && dist(L.x, L.y, B.x, B.y) < 14) {
      $('bossBarWrap').style.display = 'block';
      $('bossFill').style.width = clamp(B.hp / B.maxHp * 100, 0, 100) + '%';
    } else $('bossBarWrap').style.display = 'none';
    this.updateSkillButtons();
  },
  updateSkillButtons: function () {
    var L = Game.leader;
    if (!L) return;
    document.querySelectorAll('.skillBtn[data-skill]').forEach(function (b) {
      var i = parseInt(b.dataset.skill, 10);
      var cd = Skills.cds[i];
      b.classList.toggle('onCd', cd > 0);
      b.querySelector('.cd').textContent = cd > 0 ? Math.ceil(cd) : '';
      b.classList.toggle('noMp', L.mp < SKILLS[i].mp);
    });
    var ult = $('btnUlt');
    ult.classList.toggle('onCd', Skills.ultCd > 0);
    ult.querySelector('.cd').textContent = Skills.ultCd > 0 ? Math.ceil(Skills.ultCd) : '';
    ult.classList.toggle('noMp', L.mp < ULT.mp);
  },
  updateQuest: function () {
    var q = QUESTS[Game.questIdx];
    if (!q) {
      $('questTitle').textContent = 'Đã hoàn thành tất cả!';
      $('questDesc').textContent = 'Quan Ải Long Ngâm đã xong. Bạn có thể farm Boss hoặc chơi lại.';
      $('questProg').textContent = '🏆 HOÀN THÀNH';
      return;
    }
    $('questTitle').textContent = q.title.replace(/\(\d+\/\d+\)/, '(' + Game.questKill + '/' + q.need + ')');
    $('questDesc').textContent = q.desc;
    $('questProg').textContent = 'Tiến độ: ' + Game.questKill + '/' + q.need;
  },
  updateActivity: function () {
    var B = Game.boss;
    var bossTxt = !B ? '—' : B.dead ? '✅ Đã hạ' : '🐉 HP ' + Math.max(0, Math.ceil(B.hp)) + '/' + B.maxHp;
    $('actProg').innerHTML =
      'Quái đã diệt: <b>' + Game.kills + '</b><br>' +
      'Boss Long Ngâm: <b>' + bossTxt + '</b><br>' +
      'Cấp đội: <b>' + Progression.level + '</b> · Vàng: <b>' + Game.gold + '</b><br>' +
      'Phần thưởng: <b>500 XP + Bảo Kiếm Long Ngâm</b>';
  },
  banner: function (big, sub) {
    var b = $('banner');
    b.querySelector('.big').textContent = big;
    b.querySelector('.sub').textContent = sub || '';
    b.style.display = 'block';
    clearTimeout(this._bt);
    this._bt = setTimeout(function () { b.style.display = 'none'; }, 2400);
  },
  toast: function (msg) {
    var t = $('toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(this._tt);
    this._tt = setTimeout(function () { t.style.display = 'none'; }, 2000);
  },
  showDialog: function (who, txt) {
    $('dialog').querySelector('.who').textContent = who;
    $('dialog').querySelector('.txt').textContent = txt;
    $('dialog').style.display = 'block';
  },
  hideDialog: function () { $('dialog').style.display = 'none'; },
  showEnd: function (victory) {
    Game.over = true;
    $('endTitle').textContent = victory ? '🏆 CHIẾN THẮNG!' : '💀 ĐỘI ĐÃ GỤC NGÃ';
    $('endSub').textContent = victory
      ? 'Quan Ải Long Ngâm hoàn thành — Trường Bạch lại yên bình!'
      : 'Long Ngâm vẫn ngự trị Tuyết Sơn... Hãy thử lại!';
    $('endStats').textContent = 'Cấp ' + Progression.level + ' · Diệt ' + Game.kills + ' quái · ' + Game.gold + ' vàng · Boss hạ: ' + Game.bossKills;
    $('endScreen').style.display = 'flex';
    AudioMan.sfx(victory ? 'levelup' : 'death');
  },
  drawMinimap: function () {
    var cv = $('minimap'), ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    ctx.fillStyle = '#16233d'; ctx.fillRect(0, 0, W, H);
    var sx = W / CFG.MAP_W, sy = H / CFG.MAP_H;
    /* đường */
    ctx.strokeStyle = '#8d8578'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(28 * sx, 4 * sy); ctx.lineTo(28 * sx, 46 * sy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(12 * sx, 29 * sy); ctx.lineTo(44 * sx, 29 * sy); ctx.stroke();
    /* đền */
    ctx.fillStyle = '#c9a94f'; ctx.fillRect(26 * sx, 3 * sy, 4 * sx, 4 * sy);
    /* portal */
    ctx.fillStyle = '#9d4edd'; ctx.beginPath(); ctx.arc(50 * sx, 30 * sy, 4, 0, 7); ctx.fill();
    /* NPC */
    World.npcs.forEach(function (n) {
      ctx.fillStyle = '#ffd94d'; ctx.beginPath(); ctx.arc(n.x * sx, n.y * sy, 3, 0, 7); ctx.fill();
    });
    /* quái */
    Game.enemies.forEach(function (e) {
      if (e.dead) return;
      ctx.fillStyle = e.isBoss ? '#ff2e2e' : '#ff7a5c';
      ctx.beginPath(); ctx.arc(e.x * sx, e.y * sy, e.isBoss ? 5 : 2.5, 0, 7); ctx.fill();
    });
    /* đội */
    Game.party.forEach(function (p, i) {
      if (p.dead) return;
      ctx.fillStyle = i === 0 ? '#4dff6e' : '#5cb8ff';
      ctx.beginPath(); ctx.arc(p.x * sx, p.y * sy, i === 0 ? 4 : 3, 0, 7); ctx.fill();
    });
  }
};

/* ================= NHIỆM VỤ ================= */
var Quests = {
  complete: function () {
    var q = QUESTS[Game.questIdx];
    AudioMan.sfx('quest');
    Progression.gainXp(150);
    Game.gold += 100;
    UI.banner('✅ NHIỆM VỤ HOÀN THÀNH!', q.title + ' — thưởng 150 XP + 100 vàng');
    Game.questIdx++;
    Game.questKill = 0;
    UI.updateQuest();
    if (Game.questIdx >= QUESTS.length) {
      setTimeout(function () { UI.showEnd(true); }, 1800);
    }
  },
  npcTalk: function (npc) {
    var q = QUESTS[Game.questIdx];
    if (!q) { UI.showDialog(npc.name, 'Quan Ải đã xong, hiệp khách! Trường Bạch cảm ơn ngươi.'); return; }
    if (npc.name.indexOf('A Hổ') >= 0) {
      UI.showDialog('Vệ Binh A Hổ', q.kind === 'snow'
        ? 'Tuyết Yêu phía tây bắc đang phá làng. Diệt ' + q.need + ' con giúp ta! (' + Game.questKill + '/' + q.need + ')'
        : q.kind === 'bandit'
          ? 'Sơn Tặc phía đông cướp bóc không ngừng. Dẹp ' + q.need + ' tên! (' + Game.questKill + '/' + q.need + ')'
          : 'Long Ngâm Lão Tổ ở đấu trường đông nam. Chỉ ngươi mới hạ được hắn!');
    } else {
      UI.showDialog('Trưởng Lão Tuyết', q.kind === 'boss'
        ? 'Lão Tổ đã thức tỉnh... Mang theo đủ HP, dùng Tuyệt Kỹ khi hắn cuồng nộ. Chúc ngươi may mắn!'
        : 'Đường lên Tuyết Sơn hiểm trở, nhưng võ công của ngươi đã tiến bộ. Cứ theo nhiệm vụ mà làm.');
    }
  }
};

/* ================= MAIN LOOP & KHỞI ĐỘNG ================= */
var Main = {
  lastUI: 0, lastMap: 0,
  start: function () {
    AudioMan.init();
    $('startScreen').style.display = 'none';
    $('btnStart').disabled = true;
    $('btnStart').textContent = 'ĐANG TẢI...';
    Engine.init().then(function () {
      TileMap.build();
      World.build();
      Characters.spawnParty();
      Characters.spawnEnemies();
      Effects.init();
      Input.init();
      UI.buildParty();
      UI.updateQuest();
      UI.updateActivity();
      Game.started = true;
      $('startScreen').style.display = 'none';
      UI.banner('❄ TRƯỜNG BẠCH ❄', 'Nói chuyện với Vệ Binh A Hổ ở cổng thành để nhận nhiệm vụ!');
      /* click NPC */
      Engine.app.canvas.addEventListener('pointerdown', function (e) {
        if (!Game.started || Game.over) return;
        var rect = Engine.app.canvas.getBoundingClientRect();
        var w = Input.screenToWorldPoint(e.clientX - rect.left, e.clientY - rect.top);
        var hit = null, best = 1.6;
        World.npcs.forEach(function (n) {
          var d = dist(w.x, w.y, n.x, n.y);
          if (d < best) { best = d; hit = n; }
        });
        if (hit) {
          Input.moveTarget = null;
          if (dist(Game.leader.x, Game.leader.y, hit.x, hit.y) < 3.5) Quests.npcTalk(hit);
          else { Input.moveTarget = { x: hit.x, y: hit.y }; UI.toast('Đang tới chỗ ' + hit.name + '...'); }
        }
      });
      Engine.app.ticker.add(function (ticker) {
        var dt = Math.min(ticker.deltaMS / 1000, 0.05);
        if (!Game.started || Game.over) return;
        Game.time += dt;
        PartyAI.update(dt);
        EnemyAI.update(dt);
        Skills.tick(dt);
        Effects.update(dt);
        Loot.update(dt);
        Camera.update(dt);
        /* hồi MP */
        Game.party.forEach(function (p) { if (!p.dead) p.mp = Math.min(p.maxMp, p.mp + 7 * dt); });
        /* combo reset */
        if (Game.comboTimer > 0) { Game.comboTimer -= dt; if (Game.comboTimer <= 0) Game.combo = 0; }
        /* HUD 10 lần/giây */
        if (Game.time - Main.lastUI > 0.1) { Main.lastUI = Game.time; UI.update(); UI.updateActivity(); }
        if (Game.time - Main.lastMap > 0.25) { Main.lastMap = Game.time; UI.drawMinimap(); }
      });
    });
  }
};

$('btnStart').addEventListener('click', function () { Main.start(); });
$('btnAgain').addEventListener('click', function () { location.reload(); });
$('dlgBtn').addEventListener('click', function () { UI.hideDialog(); });

})();
