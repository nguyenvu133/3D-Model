/* ============================================================
 * WUXIA 3D — Quan Ải Long Ngâm (bản three.js, nhân vật 3D thật)
 * three.js r128 (UMD) + GLTFLoader + MeshoptDecoder
 * Model thật: models/RobotExpressive.glb (hero, 14 anim),
 *   models/Fox.glb (Hồ Ly Tinh, Walk/Run), models/CesiumMan.glb (NPC),
 *   models/kiem-hiep.glb (tượng kiếm hiệp ở đền, meshopt).
 * Nhân vật còn lại dựng procedural bằng khối three.js.
 * ============================================================ */
(function () {
'use strict';

/* ================= CONFIG & UTILS ================= */
var CFG = {
  TILE: 2,              /* 1 ô = 2 đơn vị thế giới */
  MAP_W: 56, MAP_H: 56,
  MAX_ZOOM: 34, MIN_ZOOM: 13
};
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
/* tile -> world */
function wX(tx) { return (tx - CFG.MAP_W / 2) * CFG.TILE; }
function wZ(ty) { return (ty - CFG.MAP_H / 2) * CFG.TILE; }
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

/* ================= ENGINE (three.js) ================= */
var Engine = { renderer: null, scene: null, camera: null, clock: null, groundMesh: null };
Engine.init = function () {
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1420);
  scene.fog = new THREE.Fog(0x0d1420, 55, 150);
  Engine.scene = scene;
  var camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 400);
  Engine.camera = camera;
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  Engine.renderer = renderer;
  $('stage').appendChild(renderer.domElement);
  /* đèn */
  var hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2438, 0.85);
  scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xfff2cc, 1.05);
  sun.position.set(40, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far = 180;
  scene.add(sun);
  Engine.sun = sun;
  /* đèn ấm ở đền + cổng */
  [[28, 6], [28, 44]].forEach(function (p) {
    var pl = new THREE.PointLight(0xffb347, 0.9, 26);
    pl.position.set(wX(p[0]), 6, wZ(p[1]));
    scene.add(pl);
  });
  Engine.clock = new THREE.Clock();
  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
};

/* ================= TILE MAP — Trường Bạch ================= */
var TileMap = {
  blocked: [],
  build: function () {
    this.blocked = [];
    for (var x = 0; x < CFG.MAP_W; x++) { this.blocked[x] = []; for (var y = 0; y < CFG.MAP_H; y++) this.blocked[x][y] = false; }
    for (var lx = 4; lx <= 12; lx++) for (var ly = 42; ly <= 50; ly++) this.blocked[lx][ly] = true; /* hồ băng */
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

/* ================= GROUND — mặt đất tuyết + đường đá (canvas texture) ================= */
function groundTexture() {
  var cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 1024;
  var ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#5c6c8c'; ctx.fillRect(0, 0, 1024, 1024);
  /* đốm tuyết */
  for (var i = 0; i < 2600; i++) {
    ctx.fillStyle = pick(['#566280', '#64748f', '#526078', '#6b7c9e']);
    ctx.fillRect(Math.random() * 1024, Math.random() * 1024, rand(4, 14), rand(4, 14));
  }
  function tileToPx(tx, ty) { return [tx / CFG.MAP_W * 1024, ty / CFG.MAP_H * 1024]; }
  function roadRect(x0, y0, x1, y1) {
    var a = tileToPx(x0, y0), b = tileToPx(x1, y1);
    ctx.fillStyle = '#8d8578';
    ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.fillStyle = '#6e675c';
    ctx.fillRect(a[0], a[1], 4, b[1] - a[1]);
    ctx.fillRect(b[0] - 4, a[1], 4, b[1] - a[1]);
  }
  roadRect(26.5, 4, 29.5, 46); roadRect(12, 27.5, 44, 30.5); roadRect(40, 30, 52, 32);
  /* hồ băng */
  var lp = tileToPx(8, 46);
  ctx.fillStyle = '#9fc8e8';
  ctx.beginPath(); ctx.ellipse(lp[0], lp[1], 90, 42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#cfe6f7';
  ctx.beginPath(); ctx.ellipse(lp[0], lp[1], 72, 30, 0, 0, Math.PI * 2); ctx.fill();
  /* quảng trường trước đền */
  var qp = tileToPx(28, 12);
  ctx.fillStyle = '#7a7264';
  ctx.beginPath(); ctx.ellipse(qp[0], qp[1], 120, 60, 0, 0, Math.PI * 2); ctx.fill();
  var tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

/* ================= WORLD 3D — đền, nhà, cây, cổng, portal ================= */
var World = {
  npcs: [], portalPos: { x: 50, y: 30 },
  mat: function (color, opts) {
    var o = Object.assign({ color: color }, opts || {});
    return new THREE.MeshLambertMaterial(o);
  },
  box: function (w, h, d, color, x, y, z, opts) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mat(color, opts));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    Engine.scene.add(m);
    return m;
  },
  cone: function (r, h, color, x, y, z, seg, opts) {
    var m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg || 4), this.mat(color, opts));
    m.position.set(x, y, z);
    m.rotation.y = Math.PI / 4;
    m.castShadow = true; m.receiveShadow = true;
    Engine.scene.add(m);
    return m;
  },
  cyl: function (rt, rb, h, color, x, y, z, seg, opts) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 8), this.mat(color, opts));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    Engine.scene.add(m);
    return m;
  },
  sphere: function (r, color, x, y, z, opts) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), this.mat(color, opts));
    m.position.set(x, y, z);
    m.castShadow = true;
    Engine.scene.add(m);
    return m;
  },
  build: function () {
    /* mặt đất */
    var tex = groundTexture();
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.MAP_W * CFG.TILE, CFG.MAP_H * CFG.TILE),
      tex ? new THREE.MeshLambertMaterial({ map: tex }) : this.mat(0x5c6c8c)
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    Engine.scene.add(ground);
    Engine.groundMesh = ground;
    this.buildMountains();
    this.buildTemple();
    this.buildHouses();
    this.buildTrees();
    this.buildFences();
    this.buildLanterns();
    this.buildGate();
    this.buildPortal();
    this.buildProps();
    this.buildStatue();
    this.buildSnow();
  },
  buildMountains: function () {
    var peaks = [
      { x: 2, y: 2, h: 34, r: 22 }, { x: 14, y: 0, h: 42, r: 26 }, { x: 30, y: -2, h: 38, r: 24 },
      { x: 46, y: 1, h: 46, r: 28 }, { x: 56, y: 8, h: 36, r: 22 }, { x: -2, y: 22, h: 30, r: 20 },
      { x: 58, y: 26, h: 32, r: 20 }, { x: 8, y: 58, h: 34, r: 22 }, { x: 40, y: 58, h: 38, r: 24 }
    ];
    peaks.forEach(function (p) {
      var m = new THREE.Mesh(new THREE.ConeGeometry(p.r, p.h, 5), World.mat(0x2c3a58));
      m.position.set(wX(p.x), p.h / 2 - 2, wZ(p.y));
      Engine.scene.add(m);
      var cap = new THREE.Mesh(new THREE.ConeGeometry(p.r * 0.42, p.h * 0.38, 5), World.mat(0xe8eef7));
      cap.position.set(wX(p.x), p.h - 2 - p.h * 0.19, wZ(p.y));
      Engine.scene.add(cap);
    });
  },
  buildTemple: function () {
    TileMap.blockRect(24, 2, 32, 9);
    var cx = wX(28), cz = wZ(5.5);
    /* bậc thềm */
    this.box(15, 0.6, 8, 0x7a7264, cx, 0.3, cz + 3);
    this.box(13, 0.6, 6, 0x8d8578, cx, 0.9, cz + 2);
    /* thân đền */
    this.box(11, 6.5, 6, 0x8a2f26, cx, 4.2, cz);
    this.box(11.4, 0.5, 6.4, 0xc9a94f, cx, 7.2, cz);
    /* cửa vàng */
    this.box(2.2, 4.2, 0.3, 0xc9a94f, cx, 3.1, cz + 3.1);
    this.box(0.2, 0.2, 0.1, 0x3a2408, cx - 0.5, 2.6, cz + 3.3);
    /* cột */
    [-4.6, 4.6].forEach(function (dx) { World.cyl(0.35, 0.35, 6.5, 0x5e1f18, cx + dx, 4.2, cz + 2.6, 8); });
    /* mái 2 tầng (chóp 4 mặt) */
    this.cone(9.5, 3.4, 0x1e4d3a, cx, 9, cz, 4);
    this.cone(9.7, 0.5, 0xe8eef7, cx, 7.6, cz, 4);
    this.cone(7, 2.8, 0x1e4d3a, cx, 12, cz, 4);
    this.cone(7.2, 0.4, 0xe8eef7, cx, 10.8, cz, 4);
    /* đỉnh vàng */
    this.sphere(0.5, 0xffd94d, cx, 14.2, cz, { emissive: 0x8a6d1f });
    this.cyl(0.12, 0.12, 1.6, 0xc9a94f, cx, 13.4, cz, 6);
    /* đèn lồng 2 bên cửa */
    [-6.5, 6.5].forEach(function (dx) {
      World.cyl(0.12, 0.12, 3.4, 0x4a3220, cx + dx, 1.7, cz + 3.4, 6);
      World.sphere(0.7, 0xff5a3c, cx + dx, 3.9, cz + 3.4, { emissive: 0x992200 });
    });
  },
  buildHouses: function () {
    var houses = [
      { x: 16, y: 16 }, { x: 36, y: 14 }, { x: 14, y: 34 }, { x: 40, y: 36 },
      { x: 20, y: 22 }, { x: 38, y: 22 }, { x: 46, y: 18 }
    ];
    houses.forEach(function (h) {
      TileMap.blockRect(h.x - 1.7, h.y - 1.3, h.x + 1.7, h.y + 1.3);
      var cx = wX(h.x), cz = wZ(h.y);
      World.box(6.8, 3, 5, 0x7a4a2e, cx, 1.5, cz);
      World.cone(5.4, 2.6, 0x1e4d3a, cx, 4.3, cz, 4);
      World.cone(5.5, 0.35, 0xdfe8f2, cx, 3.2, cz, 4);
      /* cửa sổ ấm */
      var win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1),
        new THREE.MeshBasicMaterial({ color: 0xffc86e }));
      win.position.set(cx, 1.6, cz + 2.55);
      Engine.scene.add(win);
      var win2 = win.clone();
      win2.position.set(cx - 2, 1.6, cz + 2.55);
      Engine.scene.add(win2);
    });
  },
  buildTrees: function () {
    var spots = [];
    for (var i = 0; i < 52; i++) {
      var x = rand(2, 54), y = rand(2, 54);
      if (x > 24 && x < 32 && y < 12) continue;
      if (x > 25 && x < 31 && y > 4 && y < 47) continue;
      if (x > 11 && x < 45 && y > 26.5 && y < 31.5) continue;
      if (x > 3 && x < 13 && y > 41 && y < 51) continue;
      spots.push({ x: x, y: y, s: rand(0.8, 1.35) });
    }
    spots.forEach(function (t) {
      var cx = wX(t.x), cz = wZ(t.y), s = t.s;
      World.cyl(0.18 * s, 0.24 * s, 1.6 * s, 0x4a3220, cx, 0.8 * s, cz, 6);
      World.cone(1.5 * s, 2.6 * s, 0x1d4a2e, cx, 2.8 * s, cz, 8);
      World.cone(1.1 * s, 2.2 * s, 0x25603a, cx, 4.4 * s, cz, 8);
      World.cone(0.55 * s, 1.1 * s, 0xe8eef7, cx, 5.6 * s, cz, 8);
    });
  },
  buildFences: function () {
    function run(x0, y0, x1, y1) {
      var n = Math.floor(dist(x0, y0, x1, y1) / 1.4);
      for (var i = 0; i <= n; i++) {
        var wx = x0 + (x1 - x0) * i / n, wy = y0 + (y1 - y0) * i / n;
        World.box(0.14, 1.1, 0.14, 0x6b4a2a, wX(wx), 0.55, wZ(wy));
      }
      var g = new THREE.Group();
      var len = dist(x0, y0, x1, y1) * CFG.TILE;
      var rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.12), World.mat(0x7d5a34));
      rail.position.set((wX(x0) + wX(x1)) / 2, 0.85, (wZ(y0) + wZ(y1)) / 2);
      rail.rotation.y = -Math.atan2(wZ(y1) - wZ(y0), wX(x1) - wX(x0));
      rail.castShadow = true;
      Engine.scene.add(rail);
    }
    run(12, 24, 24, 24); run(32, 24, 44, 24);
    run(12, 33, 24, 33); run(32, 33, 44, 33);
    run(10, 12, 10, 44); run(46, 12, 46, 44);
  },
  buildLanterns: function () {
    var spots = [[24, 26], [32, 26], [24, 32], [32, 32], [26, 12], [30, 12], [26, 40], [30, 40], [42, 28], [14, 28]];
    spots.forEach(function (p) {
      var cx = wX(p[0]), cz = wZ(p[1]);
      World.cyl(0.09, 0.09, 2.6, 0x2a2018, cx, 1.3, cz, 6);
      World.sphere(0.55, 0xff5a3c, cx, 2.9, cz, { emissive: 0x992200 });
      World.sphere(0.7, 0xffb347, cx, 2.9, cz, { emissive: 0xff8a00, transparent: true, opacity: 0.18 });
    });
  },
  buildGate: function () {
    TileMap.blockRect(25.5, 44, 30.5, 45.5);
    var cx = wX(28), cz = wZ(44.8);
    [-6.5, 6.5].forEach(function (dx) { World.box(1.1, 7.5, 1.1, 0x6e3f2a, cx + dx, 3.75, cz); });
    World.box(15.5, 1.3, 1.4, 0x1e4d3a, cx, 7.6, cz);
    World.cone(10.5, 2.6, 0x1e4d3a, cx, 9.4, cz, 4);
    World.cone(10.7, 0.35, 0xe8eef7, cx, 8.3, cz, 4);
    World.sphere(0.5, 0xffd94d, cx, 11.4, cz, { emissive: 0x8a6d1f });
    World.box(5.2, 1, 0.2, 0x8a2f26, cx, 6.6, cz + 0.8);
  },
  buildPortal: function () {
    TileMap.blockRect(49, 29, 51, 31);
    var cx = wX(50), cz = wZ(30);
    var torus = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.35, 10, 28),
      new THREE.MeshBasicMaterial({ color: 0x9d4edd }));
    torus.position.set(cx, 2.6, cz);
    torus.rotation.y = Math.PI / 4;
    Engine.scene.add(torus);
    this.portalRing = torus;
    var core = new THREE.Mesh(new THREE.CircleGeometry(2.3, 24),
      new THREE.MeshBasicMaterial({ color: 0x6a1fb0, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    core.position.set(cx, 2.6, cz);
    core.rotation.y = Math.PI / 4;
    Engine.scene.add(core);
    var pl = new THREE.PointLight(0x9d4edd, 1.2, 18);
    pl.position.set(cx, 3, cz);
    Engine.scene.add(pl);
  },
  buildProps: function () {
    [{ x: 18, y: 42 }, { x: 42, y: 42 }, { x: 16, y: 30 }].forEach(function (p) {
      World.cyl(0.7, 0.7, 1.1, 0x8a5f36, wX(p.x), 0.55, wZ(p.y), 10);
      World.cyl(0.72, 0.72, 0.12, 0xa87a48, wX(p.x), 1.12, wZ(p.y), 10);
    });
    /* cọc luyện công */
    [{ x: 34, y: 38 }, { x: 22, y: 38 }].forEach(function (p) {
      World.cyl(0.22, 0.22, 3.4, 0x5e4632, wX(p.x), 1.7, wZ(p.y), 8);
      World.box(1.6, 0.5, 1.6, 0x7d5a34, wX(p.x), 3.6, wZ(p.y));
    });
    /* tượng đá 2 bên quảng trường */
    [{ x: 26, y: 31 }, { x: 30, y: 31 }].forEach(function (p) {
      TileMap.blockRect(p.x - 0.6, p.y - 0.6, p.x + 0.6, p.y + 0.6);
      World.box(1.6, 0.5, 1.6, 0x7a7264, wX(p.x), 0.25, wZ(p.y));
      World.cyl(0.5, 0.65, 2.6, 0x9aa4b5, wX(p.x), 1.8, wZ(p.y), 8);
      World.sphere(0.45, 0x9aa4b5, wX(p.x), 3.4, wZ(p.y));
    });
  },
  buildStatue: function () {
    /* tượng kiếm hiệp — model GLB thật của repo (meshopt), đặt trước đền */
    var loader = new THREE.GLTFLoader();
    if (window.MeshoptDecoder && loader.setMeshoptDecoder) {
      try { loader.setMeshoptDecoder(window.MeshoptDecoder); } catch (e) { }
    }
    var pedestal = this.box(3, 1, 3, 0x7a7264, wX(28), 0.5, wZ(10));
    loader.load('models/kiem-hiep.glb', function (gltf) {
      var m = gltf.scene;
      m.position.set(wX(28), 1, wZ(10));
      m.scale.set(1.4, 1.4, 1.4);
      m.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      Engine.scene.add(m);
      World.statue = m;
    }, undefined, function () { /* lỗi thì thôi — vẫn có bệ đá */ });
  },
  buildSnow: function () {
    var N = 900;
    var pos = new Float32Array(N * 3);
    for (var i = 0; i < N; i++) {
      pos[i * 3] = rand(-56, 56);
      pos[i * 3 + 1] = rand(0, 30);
      pos[i * 3 + 2] = rand(-56, 56);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, transparent: true, opacity: 0.85, sizeAttenuation: true });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    Engine.scene.add(pts);
    this.snowPts = pts;
    this.snowVel = new Float32Array(N);
    for (var j = 0; j < N; j++) this.snowVel[j] = rand(1.2, 3);
  },
  updateSnow: function (dt, cx, cz) {
    if (!this.snowPts) return;
    var p = this.snowPts.geometry.attributes.position.array;
    for (var i = 0; i < p.length; i += 3) {
      p[i + 1] -= this.snowVel[i / 3] * dt;
      p[i] += Math.sin(Engine.time * 0.7 + i) * dt * 0.4;
      if (p[i + 1] < 0) {
        p[i + 1] = rand(22, 30);
        p[i] = cx + rand(-56, 56);
        p[i + 2] = cz + rand(-56, 56);
      }
    }
    this.snowPts.geometry.attributes.position.needsUpdate = true;
    if (this.portalRing) this.portalRing.rotation.z += dt * 0.6;
  }
};

/* ================= MODELS — procedural + GLB thật ================= */
function textSprite(text, color, scale) {
  var cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  var ctx = cv.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 30px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = '#000';
    ctx.strokeText(text, 128, 32);
    ctx.fillStyle = color || '#ffffff';
    ctx.fillText(text, 128, 32);
  }
  var tex = new THREE.CanvasTexture(cv);
  var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(scale || 2.4, (scale || 2.4) * 0.25, 1);
  return sp;
}

/* người low-poly dựng bằng khối (mặt hướng +Z) */
function buildHumanoid(o) {
  var S = o.scale || 1;
  var g = new THREE.Group();
  var robe = World.mat(o.robe), skin = World.mat(o.skin), hair = World.mat(o.hair), trim = World.mat(o.trim || 0xc9a94f);
  function part(geo, material, x, y, z, parent) {
    var m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    (parent || g).add(m);
    return m;
  }
  /* chân (pivot ở hông) */
  var legL = new THREE.Group(); legL.position.set(-0.17, 0.88, 0); g.add(legL);
  var legR = new THREE.Group(); legR.position.set(0.17, 0.88, 0); g.add(legR);
  part(new THREE.BoxGeometry(0.22, 0.88, 0.24), robe, 0, -0.44, 0, legL);
  part(new THREE.BoxGeometry(0.22, 0.88, 0.24), robe, 0, -0.44, 0, legR);
  /* váy áo */
  part(new THREE.BoxGeometry(0.68, 0.55, 0.4), robe, 0, 0.95, 0);
  /* thân */
  part(new THREE.BoxGeometry(0.62, 0.72, 0.36), robe, 0, 1.45, 0);
  part(new THREE.BoxGeometry(0.64, 0.1, 0.38), trim, 0, 1.15, 0);
  part(new THREE.BoxGeometry(0.64, 0.08, 0.38), trim, 0, 1.78, 0);
  /* tay (pivot ở vai) */
  var armL = new THREE.Group(); armL.position.set(-0.42, 1.72, 0); g.add(armL);
  var armR = new THREE.Group(); armR.position.set(0.42, 1.72, 0); g.add(armR);
  part(new THREE.BoxGeometry(0.18, 0.72, 0.2), robe, 0, -0.36, 0, armL);
  part(new THREE.BoxGeometry(0.18, 0.72, 0.2), robe, 0, -0.36, 0, armR);
  /* đầu */
  var head = new THREE.Group(); head.position.set(0, 1.98, 0); g.add(head);
  part(new THREE.SphereGeometry(0.26, 12, 10), skin, 0, 0, 0, head);
  var hairTop = part(new THREE.SphereGeometry(0.27, 12, 10), hair, 0, 0.06, -0.03, head);
  hairTop.scale.set(1, 0.75, 1);
  part(new THREE.SphereGeometry(0.09, 8, 6), hair, 0, 0.3, 0, head);
  part(new THREE.SphereGeometry(0.035, 6, 6), World.mat(0x1a1a1a), -0.09, 0.02, 0.24, head);
  part(new THREE.SphereGeometry(0.035, 6, 6), World.mat(0x1a1a1a), 0.09, 0.02, 0.24, head);
  /* vũ khí ở tay phải */
  var weapon = null;
  if (o.weapon === 'sword') {
    weapon = new THREE.Group();
    part(new THREE.BoxGeometry(0.07, 0.95, 0.03), World.mat(0xdfe8f2), 0, -0.5, 0.05, weapon);
    part(new THREE.BoxGeometry(0.22, 0.06, 0.06), World.mat(0xc9a94f), 0, -0.02, 0.05, weapon);
    part(new THREE.BoxGeometry(0.06, 0.22, 0.06), World.mat(0x5e4632), 0, 0.1, 0.05, weapon);
    weapon.position.set(0, -0.72, 0.05);
    armR.add(weapon);
  } else if (o.weapon === 'spear') {
    weapon = new THREE.Group();
    part(new THREE.CylinderGeometry(0.035, 0.035, 2.1, 6), World.mat(0x7d5a34), 0, -0.6, 0.05, weapon);
    var tip = part(new THREE.ConeGeometry(0.09, 0.4, 6), World.mat(0xff8a3c), 0, -1.8, 0.05, weapon);
    tip.rotation.x = Math.PI;
    weapon.position.set(0, -0.72, 0.05);
    armR.add(weapon);
  } else if (o.weapon === 'fan') {
    weapon = new THREE.Group();
    part(new THREE.BoxGeometry(0.55, 0.4, 0.03), World.mat(0x9d4edd), 0, -0.85, 0.05, weapon);
    part(new THREE.BoxGeometry(0.06, 0.25, 0.05), World.mat(0x5e4632), 0, -0.62, 0.05, weapon);
    weapon.position.set(0, -0.72, 0.05);
    armR.add(weapon);
  } else if (o.weapon === 'staff') {
    weapon = new THREE.Group();
    part(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 6), World.mat(0x6b4a2a), 0, -0.6, 0.05, weapon);
    part(new THREE.SphereGeometry(0.12, 8, 8), World.mat(0x5cb8ff, { emissive: 0x224488 }), 0, -1.6, 0.05, weapon);
    weapon.position.set(0, -0.72, 0.05);
    armR.add(weapon);
  }
  g.scale.set(S, S, S);
  return { group: g, parts: { armL: armL, armR: armR, legL: legL, legR: legR, head: head, weapon: weapon }, height: 2.3 * S };
}

/* quái low-poly */
function buildMonster(o) {
  var S = o.scale || 1;
  var g = new THREE.Group();
  var body = World.mat(o.body), belly = World.mat(o.belly || o.body);
  function part(geo, material, x, y, z, parent) {
    var m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    (parent || g).add(m);
    return m;
  }
  var legL = new THREE.Group(); legL.position.set(-0.2, 0.5, 0); g.add(legL);
  var legR = new THREE.Group(); legR.position.set(0.2, 0.5, 0); g.add(legR);
  part(new THREE.BoxGeometry(0.24, 0.5, 0.26), body, 0, -0.25, 0, legL);
  part(new THREE.BoxGeometry(0.24, 0.5, 0.26), body, 0, -0.25, 0, legR);
  var torso = part(new THREE.SphereGeometry(0.55, 12, 10), body, 0, 0.95, 0);
  torso.scale.set(1, 1.1, 0.9);
  var bl = part(new THREE.SphereGeometry(0.38, 10, 8), belly, 0, 0.85, 0.18);
  bl.scale.set(1, 1, 0.6);
  var head = new THREE.Group(); head.position.set(0, 1.6, 0); g.add(head);
  part(new THREE.SphereGeometry(0.36, 12, 10), body, 0, 0, 0, head);
  if (o.horns) {
    var h1 = part(new THREE.ConeGeometry(0.1, 0.42, 6), World.mat(0xd8cdb8), -0.24, 0.42, 0, head);
    h1.rotation.z = 0.5;
    var h2 = part(new THREE.ConeGeometry(0.1, 0.42, 6), World.mat(0xd8cdb8), 0.24, 0.42, 0, head);
    h2.rotation.z = -0.5;
  }
  part(new THREE.SphereGeometry(0.06, 6, 6), World.mat(0xff2e2e, { emissive: 0x880000 }), -0.13, 0.05, 0.3, head);
  part(new THREE.SphereGeometry(0.06, 6, 6), World.mat(0xff2e2e, { emissive: 0x880000 }), 0.13, 0.05, 0.3, head);
  var armL = new THREE.Group(); armL.position.set(-0.55, 1.25, 0); g.add(armL);
  var armR = new THREE.Group(); armR.position.set(0.55, 1.25, 0); g.add(armR);
  part(new THREE.BoxGeometry(0.2, 0.7, 0.22), body, 0, -0.35, 0, armL);
  part(new THREE.BoxGeometry(0.2, 0.7, 0.22), body, 0, -0.35, 0, armR);
  g.scale.set(S, S, S);
  return { group: g, parts: { armL: armL, armR: armR, legL: legL, legR: legR, head: head }, height: 2 * S };
}

/* nạp GLB thật — lỗi thì gọi cb(err) để dùng procedural */
function loadGLB(url, cb) {
  var loader = new THREE.GLTFLoader();
  if (window.MeshoptDecoder && loader.setMeshoptDecoder) {
    try { loader.setMeshoptDecoder(window.MeshoptDecoder); } catch (e) { }
  }
  loader.load(url, function (gltf) {
    var g = gltf.scene;
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    var mixer = new THREE.AnimationMixer(g);
    var clips = {};
    gltf.animations.forEach(function (a) { clips[a.name] = a; });
    cb(null, { group: g, mixer: mixer, clips: clips });
  }, undefined, function () { cb(new Error('load failed: ' + url)); });
}

/* ================= GAME STATE ================= */
var Game = {
  started: false, over: false, victory: false,
  time: 0, gold: 0, kills: 0, bossKills: 0,
  combo: 0, comboTimer: 0,
  party: [], enemies: [], loots: [],
  target: null, boss: null, leader: null,
  questIdx: 0, questKill: 0,
  camera: { dist: 24, theta: Math.PI / 4 },
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
  snow: { name: 'Tuyết Yêu', hp: 60, atk: 8, speed: 1.6, xp: 25, gold: 12, scale: 1.0, range: 1.1 },
  bandit: { name: 'Sơn Tặc', hp: 90, atk: 12, speed: 2.0, xp: 40, gold: 22, scale: 1.05, range: 1.1 },
  elite: { name: 'Hồ Ly Tinh', hp: 220, atk: 18, speed: 1.8, xp: 120, gold: 60, scale: 1.35, range: 1.3 },
  boss: { name: 'Long Ngâm Lão Tổ', hp: 1200, atk: 26, speed: 1.4, xp: 600, gold: 300, scale: 1.9, range: 1.8 }
};

/* ================= CHARACTERS ================= */
var Characters = {
  idSeq: 1,
  make: function (type, opts) {
    opts = opts || {};
    var ch = {
      id: this.idSeq++, type: type, kind: opts.kind || 'enemy',
      name: opts.name || type, level: opts.level || 1,
      x: opts.x || 28, y: opts.y || 40, dirAngle: 0,
      hp: 100, maxHp: 100, mp: 100, maxMp: 100,
      atk: 12, def: 0, speed: 3.2, radius: 0.55,
      state: 'idle', target: null, attackCd: 0,
      walkPhase: Math.random() * 6, flashT: 0, dead: false, respawnT: 0,
      homeX: opts.x || 28, homeY: opts.y || 40,
      skillCd: {}, aiTimer: 0, swingT: 0, dashT: 0, dashDx: 0, dashDy: 0,
      slowT: 0, isNPC: false, isBoss: false, isElite: false,
      mixer: null, clips: {}, animCur: null, animAction: null, parts: null, height: 2.2
    };
    var built = null;
    if (type === 'leader') {
      ch.kind = 'party'; ch.maxHp = 320; ch.hp = 320; ch.maxMp = 160; ch.mp = 160; ch.atk = 26; ch.speed = 4.6;
      built = buildHumanoid({ robe: 0x2b5cb8, trim: 0xffd94d, skin: 0xf2c89b, hair: 0x1a1a1a, weapon: 'sword' });
      ch.glbUrl = 'models/RobotExpressive.glb'; ch.glbScale = 1.3;
    } else if (type === 'spear') {
      ch.kind = 'party'; ch.maxHp = 420; ch.hp = 420; ch.maxMp = 100; ch.mp = 100; ch.atk = 22; ch.speed = 4.2;
      built = buildHumanoid({ robe: 0xb85c1e, trim: 0xffe9a8, skin: 0xe8b88a, hair: 0x2a1a08, weapon: 'spear' });
    } else if (type === 'mage') {
      ch.kind = 'party'; ch.maxHp = 260; ch.hp = 260; ch.maxMp = 240; ch.mp = 240; ch.atk = 30; ch.speed = 4.0;
      built = buildHumanoid({ robe: 0x7a3fd4, trim: 0xe0aaff, skin: 0xf7d3ae, hair: 0x3a2a5e, weapon: 'fan' });
    } else if (type === 'npc') {
      ch.kind = 'npc'; ch.maxHp = 9999; ch.hp = 9999; ch.atk = 0; ch.isNPC = true;
      built = buildHumanoid({ robe: 0x2e5e2e, trim: 0xc9a94f, skin: 0xf2c89b, hair: 0x111111, weapon: 'spear' });
      ch.glbUrl = 'models/CesiumMan.glb'; ch.glbScale = 1.0;
    } else if (type === 'npc2') {
      ch.kind = 'npc'; ch.maxHp = 9999; ch.hp = 9999; ch.atk = 0; ch.isNPC = true;
      built = buildHumanoid({ robe: 0xe8eef7, trim: 0x5cb8ff, skin: 0xf2c89b, hair: 0xe8e8e8, weapon: 'staff' });
      ch.glbUrl = 'models/CesiumMan.glb'; ch.glbScale = 1.0;
    } else if (type === 'boss') {
      ch.kind = 'boss'; ch.isBoss = true;
      var def = ENEMY_DEFS.boss;
      ch.maxHp = def.hp; ch.hp = def.hp; ch.atk = def.atk; ch.speed = def.speed; ch.radius = 1.1; ch.level = 15;
      ch.xp = def.xp; ch.gold = def.gold; ch.range = def.range;
      built = buildHumanoid({ robe: 0x8a6d1f, trim: 0xffd94d, skin: 0x5e4632, hair: 0xffd94d, weapon: 'spear', scale: 1.9 });
      /* sừng rồng cho boss */
      var hornMat = World.mat(0xffd94d);
      [-0.2, 0.2].forEach(function (dx) {
        var horn = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5, 6), hornMat);
        horn.position.set(dx, 2.2, 0);
        horn.rotation.z = dx > 0 ? -0.4 : 0.4;
        horn.castShadow = true;
        built.parts.head.add(horn);
      });
      built.height = 4.2;
    } else {
      var d2 = ENEMY_DEFS[type] || ENEMY_DEFS.snow;
      ch.maxHp = d2.hp; ch.hp = d2.hp; ch.atk = d2.atk; ch.speed = d2.speed;
      ch.xp = d2.xp; ch.gold = d2.gold; ch.range = d2.range;
      ch.isElite = (type === 'elite');
      if (type === 'snow') built = buildMonster({ body: 0xdfe8f2, belly: 0xffffff, horns: true });
      else if (type === 'bandit') built = buildMonster({ body: 0x4a3a28, belly: 0x5e4632, horns: false });
      else {
        built = buildMonster({ body: 0xc98a3c, belly: 0xe8b88a, horns: true, scale: 1.35 });
        ch.glbUrl = 'models/Fox.glb'; ch.glbScale = 1.4; /* Hồ Ly Tinh thật */
      }
    }
    ch.group = built.group;
    ch.parts = built.parts;
    ch.height = built.height || 2.2;
    /* thanh HP + tên (sprite luôn hướng camera) */
    var hpBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x111111, depthWrite: false }));
    hpBg.scale.set(1.3, 0.16, 1);
    hpBg.position.y = ch.height + 0.55;
    var hpFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x4dff6e, depthWrite: false }));
    hpFg.scale.set(1.26, 0.1, 1);
    hpFg.position.y = ch.height + 0.55;
    hpFg.visible = false;
    var nameSp = textSprite(ch.name, ch.kind === 'party' ? '#8dff9e' : ch.kind === 'npc' ? '#ffd94d' : ch.isBoss ? '#ffb347' : '#ffffff', ch.isBoss ? 3.4 : 2.2);
    nameSp.position.y = ch.height + 0.85;
    ch.group.add(hpBg); ch.group.add(hpFg); ch.group.add(nameSp);
    ch.hpBg = hpBg; ch.hpFg = hpFg;
    this.place(ch);
    Engine.scene.add(ch.group);
    /* nạp model GLB thật (async) — thay placeholder khi xong */
    if (ch.glbUrl) {
      var self = this;
      loadGLB(ch.glbUrl, function (err, res) {
        if (err || !res) return;
        if (ch.dead) return;
        ch.group.remove.apply(ch.group, ch.group.children.slice());
        res.group.scale.set(ch.glbScale, ch.glbScale, ch.glbScale);
        ch.group.add(res.group);
        ch.mixer = res.mixer; ch.clips = res.clips;
        ch.group.add(hpBg); ch.group.add(hpFg); ch.group.add(nameSp);
        if (ch.type === 'leader') ch.animCur = null;
        ch.height = (ch.type === 'leader' ? 2.4 : ch.type === 'elite' ? 1.4 : 2.2);
        hpBg.position.y = ch.height + 0.55; hpFg.position.y = ch.height + 0.55;
        nameSp.position.y = ch.height + 0.85;
      });
    }
    return ch;
  },
  place: function (ch) {
    ch.group.position.set(wX(ch.x), 0, wZ(ch.y));
    ch.group.rotation.y = ch.dirAngle;
  },
  updateHpBar: function (ch) {
    var ratio = clamp(ch.hp / ch.maxHp, 0, 1);
    ch.hpFg.scale.x = 1.26 * ratio;
    ch.hpFg.material.color.setHex(ratio > 0.5 ? 0x4dff6e : ratio > 0.25 ? 0xffc93c : 0xff2e2e);
    ch.hpFg.visible = (ch.hp < ch.maxHp && !ch.dead);
    ch.hpBg.visible = ch.hpFg.visible;
  },
  setAnim: function (ch, name) {
    if (!ch.mixer || !ch.clips[name] || ch.animCur === name) return;
    var action = ch.mixer.clipAction(ch.clips[name]);
    if (ch.animAction) ch.animAction.fadeOut(0.15);
    action.reset().fadeIn(0.15).play();
    ch.animAction = action;
    ch.animCur = name;
  },
  animate: function (ch, dt, moving) {
    this.place(ch);
    if (ch.mixer) {
      ch.mixer.update(dt);
      var want = null;
      if (ch.dead) want = ch.clips.Death ? 'Death' : null;
      else if (ch.swingT > 0) want = ch.clips.Punch ? 'Punch' : null;
      else if (moving) want = ch.clips.Running ? 'Running' : ch.clips.Walking ? 'Walking' : null;
      else want = ch.clips.Idle ? 'Idle' : null;
      if (want) this.setAnim(ch, want);
    } else if (ch.parts) {
      if (moving) {
        ch.walkPhase += dt * 10;
        var s = Math.sin(ch.walkPhase);
        ch.parts.legL.rotation.x = s * 0.65;
        ch.parts.legR.rotation.x = -s * 0.65;
        ch.parts.armL.rotation.x = -s * 0.5;
        ch.parts.armR.rotation.x = s * 0.5;
        ch.group.position.y = Math.abs(Math.cos(ch.walkPhase)) * 0.06;
      } else {
        ch.parts.legL.rotation.x *= 0.8; ch.parts.legR.rotation.x *= 0.8;
        ch.parts.armL.rotation.x *= 0.8; ch.parts.armR.rotation.x *= 0.8;
        ch.group.position.y = 0;
      }
      if (ch.swingT > 0) {
        ch.swingT -= dt;
        if (ch.parts.armR) ch.parts.armR.rotation.x = -2.2 * (1 - ch.swingT / 0.28);
      }
    }
    if (ch.flashT > 0) {
      ch.flashT -= dt;
      ch.group.traverse(function (o) {
        if (o.isMesh && o.material && o.material.emissive) o.material.emissive.setHex(0x881111);
      });
      if (ch.flashT <= 0) {
        ch.group.traverse(function (o) {
          if (o.isMesh && o.material && o.material.emissive) o.material.emissive.setHex(0x000000);
        });
      }
    }
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
  }
};

/* ================= INPUT — bàn phím / chuột / joystick cảm ứng ================= */
var Input = {
  moveTarget: null,
  raycaster: null,
  init: function () {
    this.raycaster = new THREE.Raycaster();
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
    var canvas = Engine.renderer.domElement;
    canvas.addEventListener('pointerdown', function (e) {
      if (!Game.started || Game.over) return;
      var hit = Input.pick(e.clientX, e.clientY);
      if (hit && hit.char && (hit.char.kind === 'enemy' || hit.char.kind === 'boss')) {
        Game.target = hit.char;
        Input.moveTarget = null;
        Combat.tryAttack(Game.leader);
      } else if (hit && hit.char && hit.char.kind === 'npc') {
        Input.moveTarget = null;
        if (dist(Game.leader.x, Game.leader.y, hit.char.x, hit.char.y) < 3.5) Quests.npcTalk(hit.char);
        else { Input.moveTarget = { x: hit.char.x, y: hit.char.y }; UI.toast('Đang tới chỗ ' + hit.char.name + '...'); }
      } else if (hit && hit.ground) {
        Input.moveTarget = hit.ground;
        Game.target = null;
      }
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      Camera.zoomBy(e.deltaY < 0 ? 0.88 : 1.14);
    }, { passive: false });
    /* pinch zoom */
    var pinch = { d0: 0, z0: 24 };
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2) {
        var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (pinch.d0 > 0) Camera.setDist(pinch.z0 * pinch.d0 / d);
        else { pinch.d0 = d; pinch.z0 = Game.camera.dist; }
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
    /* nút skill */
    document.querySelectorAll('.skillBtn[data-skill]').forEach(function (b) {
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); Skills.cast(parseInt(b.dataset.skill, 10)); });
    });
    $('btnAtk').addEventListener('pointerdown', function (e) { e.preventDefault(); Combat.tryAttack(Game.leader); });
    $('btnUlt').addEventListener('pointerdown', function (e) { e.preventDefault(); Skills.castUlt(); });
    $('btnDash').addEventListener('pointerdown', function (e) { e.preventDefault(); Combat.dash(Game.leader); });
    $('btnZoomIn').addEventListener('click', function () { Camera.zoomBy(0.85); });
    $('btnZoomOut').addEventListener('click', function () { Camera.zoomBy(1.18); });
    $('btnSound').addEventListener('click', function () {
      AudioMan.muted = !AudioMan.muted;
      $('btnSound').textContent = AudioMan.muted ? '🔇' : '🔊';
    });
    $('btnHelp').addEventListener('click', function () { UI.showDialog('Hướng dẫn', 'Joystick trái / WASD để di chuyển. Chạm vào quái để khóa mục tiêu. Nút ⚔ đánh thường, 1–6 dùng skill, 🌟 tuyệt kỹ, 💨 lướt né. Nói chuyện với Vệ Binh ở cổng thành để nhận nhiệm vụ. Hạ Boss Long Ngâm để chiến thắng!'); });
  },
  /* raycast: trả {char} hoặc {ground:{x,y}} theo tile */
  pick: function (sx, sy) {
    var ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, Engine.camera);
    var groups = [];
    Game.enemies.forEach(function (e) { if (!e.dead) groups.push(e.group); });
    World.npcs.forEach(function (n) { groups.push(n.group); });
    var hits = this.raycaster.intersectObjects(groups, true);
    if (hits.length) {
      var o = hits[0].object, g = o;
      while (g && !g.userData.char) g = g.parent;
      if (g && g.userData.char) return { char: g.userData.char };
    }
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    var pt = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, pt)) {
      return { ground: { x: pt.x / CFG.TILE + CFG.MAP_W / 2, y: pt.z / CFG.TILE + CFG.MAP_H / 2 } };
    }
    return null;
  },
  readMove: function () {
    var x = 0, y = 0;
    if (Game.keys['KeyW'] || Game.keys['ArrowUp']) y -= 1;
    if (Game.keys['KeyS'] || Game.keys['ArrowDown']) y += 1;
    if (Game.keys['KeyA'] || Game.keys['ArrowLeft']) x -= 1;
    if (Game.keys['KeyD'] || Game.keys['ArrowRight']) x += 1;
    if (x !== 0 || y !== 0) {
      /* màn hình: x = phải, y = xuống → tile: dx=(x+y)/√2, dy=(y-x)/√2 */
      var wx = (x + y) / Math.SQRT2, wy = (y - x) / Math.SQRT2;
      var len = Math.hypot(wx, wy);
      return { x: wx / len, y: wy / len };
    }
    if (Game.input.joy && (Game.input.x !== 0 || Game.input.y !== 0)) {
      var jx = Game.input.x, jy = Game.input.y;
      var wx2 = (jx + jy) / Math.SQRT2, wy2 = (jy - jx) / Math.SQRT2;
      var l2 = Math.hypot(wx2, wy2) || 1;
      return { x: wx2 / l2, y: wy2 / l2, mag: Math.min(1, Math.hypot(jx, jy)) };
    }
    return { x: 0, y: 0 };
  }
};

/* ================= CAMERA — isometric follow ================= */
var Camera = {
  setDist: function (d) { Game.camera.dist = clamp(d, CFG.MIN_ZOOM, CFG.MAX_ZOOM); },
  zoomBy: function (f) { this.setDist(Game.camera.dist * f); },
  update: function (dt) {
    var L = Game.leader;
    if (!L) return;
    var theta = Game.camera.theta;
    var el = 0.62; /* ~35° */
    var d = Game.camera.dist;
    var tx = wX(L.x), tz = wZ(L.y);
    var cx = tx + Math.sin(theta) * Math.cos(el) * d;
    var cy = Math.sin(el) * d + 1;
    var cz = tz + Math.cos(theta) * Math.cos(el) * d;
    var shakeX = 0, shakeZ = 0;
    if (Game.shake > 0) {
      Game.shake -= dt;
      shakeX = rand(-1, 1) * Game.shake * 1.2;
      shakeZ = rand(-1, 1) * Game.shake * 1.2;
    }
    Engine.camera.position.set(cx + shakeX, cy, cz + shakeZ);
    Engine.camera.lookAt(tx, 1, tz);
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
  if (dx !== 0 || dy !== 0) ch.dirAngle = Math.atan2(dx, dy);
  return (dx !== 0 || dy !== 0);
}

/* ================= AI — ĐỒNG ĐỘI ================= */
var PartyAI = {
  update: function (dt) {
    var L = Game.leader;
    if (!L || !Game.started || Game.over) return;
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
    if (!Game.target || Game.target.dead) Game.target = this.nearestEnemy(L, 6);
    if (Game.target && !Game.target.dead) {
      var td = dist(L.x, L.y, Game.target.x, Game.target.y);
      if (td < 1.4) Combat.tryAttack(L);
      else if (mv.x === 0 && mv.y === 0 && !Input.moveTarget) {
        var dx2 = (Game.target.x - L.x) / td, dy2 = (Game.target.y - L.y) / td;
        moving = tryMove(L, dx2, dy2, dt);
      }
    }
    Characters.animate(L, dt, moving);
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
        else mv2 = tryMove(m, (foe.x - m.x) / fd, (foe.y - m.y) / fd, dt);
        if (m.type === 'mage' && !m.skillCd.mageNova) { Skills.followerSkill(m, 'nova'); m.skillCd.mageNova = 6; }
        if (m.type === 'spear' && !m.skillCd.spearSpin) { Skills.followerSkill(m, 'spin'); m.skillCd.spearSpin = 7; }
      } else {
        var ox = L.x + offsets[i - 1].x, oy = L.y + offsets[i - 1].y;
        var od = dist(m.x, m.y, ox, oy);
        if (od > 9) { m.x = ox; m.y = oy; }
        else if (od > 0.6) mv2 = tryMove(m, (ox - m.x) / od, (oy - m.y) / od, dt);
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
    m.group.visible = false;
    if (m.respawnT <= 0) {
      m.dead = false; m.hp = Math.floor(m.maxHp * 0.6);
      m.x = Game.leader.x + rand(-1, 1); m.y = Game.leader.y + rand(-1, 1);
      m.group.visible = true;
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
          e.dirAngle = Math.atan2(foe.x - e.x, foe.y - e.y);
          Combat.dealDamage(e, foe, e.atk, false);
          AudioMan.sfx('hit');
          if (e.isBoss) this.bossAttack(e, foe);
        }
      } else {
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
      if (e.isBoss && !e.enraged && e.hp < e.maxHp * 0.5) {
        e.enraged = true;
        e.atk = Math.floor(e.atk * 1.4); e.speed *= 1.3;
        UI.banner('LONG NGÂM CUỒNG NỘ!', 'Boss tăng sức mạnh — cẩn thận đòn AoE!');
        Effects.ring(e.x, e.y, 0xff2e2e, 3);
        Game.shake = 0.5;
        for (var s = 0; s < 2; s++) {
          var min = Characters.make('snow', { x: e.x + rand(-2, 2), y: e.y + rand(-2, 2) });
          min.homeX = e.x; min.homeY = e.y;
          min.group.userData.char = min;
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
      e.dead = false; e.hp = e.maxHp; e.atk = ENEMY_DEFS.boss.atk; e.speed = ENEMY_DEFS.boss.speed;
      e.enraged = false; e.x = e.homeX; e.y = e.homeY;
      e.group.visible = true;
      Characters.updateHpBar(e);
      UI.toast('Long Ngâm Lão Tổ đã hồi sinh ở đấu trường!');
      return;
    }
    e.dead = false; e.hp = e.maxHp;
    e.x = e.homeX + rand(-1, 1); e.y = e.homeY + rand(-1, 1);
    e.group.visible = true;
    Characters.updateHpBar(e);
  }
};

/* ================= COMBAT ================= */
var Combat = {
  tryAttack: function (ch) {
    if (!ch || ch.dead || Game.over) return;
    if (ch.attackCd > 0) return;
    var foe = null;
    if (ch === Game.leader && Game.target && !Game.target.dead && dist(ch.x, ch.y, Game.target.x, Game.target.y) < 1.6) foe = Game.target;
    if (!foe) foe = PartyAI.nearestEnemy(ch, 1.5);
    if (!foe) return;
    ch.attackCd = ch === Game.leader ? 0.55 : 0.85;
    ch.swingT = 0.28;
    ch.dirAngle = Math.atan2(foe.x - ch.x, foe.y - ch.y);
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
    Effects.dmgNumber(tgt.x, tgt.y, tgt.height || 2, dmg, crit, isSkill);
    if (tgt.kind === 'enemy' || tgt.kind === 'boss') {
      Game.combo++;
      Game.comboTimer = 2.5;
    }
    if (tgt === Game.leader) Game.shake = Math.max(Game.shake, 0.12);
    if (tgt.hp <= 0) this.kill(tgt, atk);
    return dmg;
  },
  kill: function (tgt, atk) {
    tgt.hp = 0;
    tgt.dead = true;
    tgt.group.visible = false;
    Characters.updateHpBar(tgt);
    AudioMan.sfx('death');
    Effects.burst(tgt.x, tgt.y, tgt.isBoss ? 0xffd94d : 0xff5a4e, tgt.isBoss ? 40 : 14);
    if (tgt.kind === 'enemy' || tgt.kind === 'boss') {
      Game.kills++;
      var isBoss = tgt.isBoss;
      var coins = isBoss ? 8 : randInt(1, 3);
      for (var i = 0; i < coins; i++) Loot.spawn('gold', tgt.x + rand(-0.8, 0.8), tgt.y + rand(-0.8, 0.8), isBoss ? 40 : randInt(4, 12));
      if (Math.random() < (isBoss ? 1 : 0.35)) Loot.spawn('hp', tgt.x + rand(-0.6, 0.6), tgt.y + rand(-0.6, 0.6), 40);
      Progression.gainXp(tgt.xp || 25);
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
    if (dx === 0 && dy === 0) { dx = Math.sin(ch.dirAngle); dy = Math.cos(ch.dirAngle); }
    var len = Math.hypot(dx, dy) || 1;
    ch.dashDx = dx / len; ch.dashDy = dy / len;
    ch.dashT = 0.18; ch.dashCd = 1.2;
    AudioMan.sfx('swing');
    Effects.burst(ch.x, ch.y, 0x9fc8e8, 6);
  }
};

/* ================= SKILLS — 9 chiêu võ lâm (bản 3D) ================= */
var SKILLS = [
  { name: 'Kiếm Khí', mp: 15, cd: 2.5 },
  { name: 'Kim Cương Hoàn', mp: 20, cd: 5 },
  { name: 'Long Kích', mp: 25, cd: 6 },
  { name: 'Hỏa Bạo', mp: 25, cd: 6 },
  { name: 'Băng Phong Bạo', mp: 30, cd: 8 },
  { name: 'Lôi Đình', mp: 30, cd: 8 }
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
      var dx = tgt ? (tgt.x - L.x) : Math.sin(L.dirAngle), dy = tgt ? (tgt.y - L.y) : Math.cos(L.dirAngle);
      var len = Math.hypot(dx, dy) || 1;
      Effects.wave(L.x, L.y, dx / len, dy / len, base);
    } else if (i === 1) {
      Effects.ring(L.x, L.y, 0xffd94d, 2.8);
      Game.shake = 0.2;
      this.aoe(L.x, L.y, 2.8, base + 15, L);
    } else if (i === 2) {
      var dx2 = tgt ? (tgt.x - L.x) : Math.sin(L.dirAngle), dy2 = tgt ? (tgt.y - L.y) : Math.cos(L.dirAngle);
      var l2 = Math.hypot(dx2, dy2) || 1;
      L.dashDx = dx2 / l2; L.dashDy = dy2 / l2; L.dashT = 0.22;
      L.dirAngle = Math.atan2(dx2, dy2);
      Effects.dragonSegment(L.x, L.y, dx2 / l2, dy2 / l2);
      this.aoe(L.x + dx2 / l2 * 1.5, L.y + dy2 / l2 * 1.5, 1.8, base + 30, L);
    } else if (i === 3) {
      var tx = tgt ? tgt.x : L.x + Math.sin(L.dirAngle) * 2, ty = tgt ? tgt.y : L.y + Math.cos(L.dirAngle) * 2;
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

/* ================= HIỆU ỨNG 3D ================= */
var Effects = {
  fx: [], dmgPool: [], dmgIdx: 0,
  init: function () {
    var layer = $('dmgLayer');
    for (var i = 0; i < 20; i++) {
      var d = document.createElement('div');
      d.className = 'dmgNum';
      d.style.display = 'none';
      layer.appendChild(d);
      this.dmgPool.push({ el: d, life: 0, x: 0, y: 0, h: 2 });
    }
  },
  _mesh: function (geo, color, opts) {
    var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial(Object.assign({ color: color, transparent: true }, opts || {})));
    Engine.scene.add(m);
    return m;
  },
  dmgNumber: function (x, y, h, dmg, crit, isSkill) {
    var d = this.dmgPool[this.dmgIdx++ % this.dmgPool.length];
    d.el.textContent = (crit ? '💥 ' : '') + dmg;
    d.el.className = 'dmgNum' + (crit ? ' crit' : isSkill ? ' skill' : '');
    d.el.style.display = 'block';
    d.life = 0.9; d.x = x; d.y = y; d.h = h;
  },
  ring: function (x, y, color, maxR) {
    var m = this._mesh(new THREE.RingGeometry(0.85, 1, 40), color, { side: THREE.DoubleSide, opacity: 0.95, depthWrite: false });
    m.rotation.x = -Math.PI / 2;
    m.position.set(wX(x), 0.12, wZ(y));
    this.fx.push({ kind: 'ring', m: m, t: 0, dur: 0.55, maxR: maxR * CFG.TILE });
  },
  slash: function (x, y) {
    var m = this._mesh(new THREE.TorusGeometry(1.1, 0.14, 8, 14, Math.PI * 1.1), 0x9fdcff, { opacity: 0.95, depthWrite: false });
    m.position.set(wX(x), 1.2, wZ(y));
    m.rotation.set(0.6, 0, rand(0, 3));
    this.fx.push({ kind: 'slash', m: m, t: 0, dur: 0.22 });
  },
  burst: function (x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var m = this._mesh(new THREE.SphereGeometry(rand(0.08, 0.2), 6, 6), color, { opacity: 1 });
      m.position.set(wX(x), rand(0.5, 1.8), wZ(y));
      var a = rand(0, Math.PI * 2), sp = rand(2, 8);
      this.fx.push({ kind: 'dot', m: m, t: 0, dur: rand(0.35, 0.7), vx: Math.cos(a) * sp, vy: rand(2, 6), vz: Math.sin(a) * sp });
    }
  },
  wave: function (x, y, dx, dy, dmg) {
    var m = this._mesh(new THREE.BoxGeometry(1.6, 0.5, 0.08), 0x5cb8ff, { opacity: 0.95 });
    m.position.set(wX(x), 1.2, wZ(y));
    m.rotation.y = Math.atan2(dx, dy);
    this.fx.push({ kind: 'proj', m: m, t: 0, dur: 0.9, dx: dx, dy: dy, dmg: dmg, hit: {}, x: x, y: y });
  },
  fire: function (x, y) {
    this.burst(x, y, 0xff5a1e, 14);
    this.burst(x, y, 0xffd94d, 10);
    var s = this._mesh(new THREE.SphereGeometry(0.5, 12, 10), 0xff8a3c, { opacity: 0.5, depthWrite: false });
    s.position.set(wX(x), 0.8, wZ(y));
    this.fx.push({ kind: 'boom', m: s, t: 0, dur: 0.45, maxR: 2.2 * CFG.TILE });
    this.ring(x, y, 0xff8a3c, 2.2);
  },
  ice: function (x, y) {
    for (var i = 0; i < 14; i++) {
      var m = this._mesh(new THREE.ConeGeometry(0.14, 0.7, 5), 0x9fdcff, { opacity: 0.95 });
      m.position.set(wX(x) + rand(-3, 3), rand(2, 5), wZ(y) + rand(-3, 3));
      m.rotation.x = Math.PI;
      this.fx.push({ kind: 'dot', m: m, t: 0, dur: rand(0.5, 0.9), vx: 0, vy: -6, vz: 0 });
    }
    this.ring(x, y, 0x9fdcff, 3);
  },
  lightning: function (x, y) {
    var pts = [];
    var bx = wX(x), bz = wZ(y);
    for (var i = 0; i <= 5; i++) pts.push(new THREE.Vector3(bx + rand(-0.8, 0.8), 12 - i * 2.2, bz + rand(-0.8, 0.8)));
    var geo = new THREE.BufferGeometry().setFromPoints(pts);
    var line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe95c, transparent: true }));
    Engine.scene.add(line);
    this.fx.push({ kind: 'bolt', m: line, t: 0, dur: 0.25 });
    this.burst(x, y, 0xffe95c, 8);
  },
  dragonSegment: function (x, y, dx, dy) {
    for (var i = 0; i < 8; i++) {
      var m = this._mesh(new THREE.SphereGeometry(0.34 - i * 0.02, 8, 8), i % 2 ? 0xffd94d : 0xff8a3c, { opacity: 1 });
      m.position.set(wX(x + dx * i * 0.45), 1.2 + Math.sin(i) * 0.4, wZ(y + dy * i * 0.45));
      this.fx.push({ kind: 'dot', m: m, t: 0, dur: 0.4, vx: dx * 16, vy: 0, vz: dy * 16 });
    }
  },
  dragonUlt: function (x, y) {
    for (var i = 0; i < 26; i++) {
      var m = this._mesh(new THREE.SphereGeometry(0.42 - i * 0.012, 8, 8), i % 2 ? 0xffd94d : 0x5cb8ff, { opacity: 1 });
      var ang = i * 0.35;
      m.position.set(wX(x) + Math.cos(ang) * (1.5 + i * 0.5), 1.6 + Math.sin(i * 0.6) * 1.2, wZ(y) + Math.sin(ang) * (1.5 + i * 0.5));
      this.fx.push({ kind: 'dot', m: m, t: 0, dur: 0.9, vx: Math.cos(ang) * 3, vy: 1, vz: Math.sin(ang) * 3 });
    }
  },
  update: function (dt) {
    /* số damage DOM: chiếu 3D -> màn hình */
    var cam = Engine.camera;
    this.dmgPool.forEach(function (d) {
      if (d.life <= 0) { d.el.style.display = 'none'; return; }
      d.life -= dt;
      var v = new THREE.Vector3(wX(d.x), d.h + 0.8 + (0.9 - d.life), wZ(d.y));
      v.project(cam);
      d.el.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
      d.el.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
      d.el.style.opacity = Math.max(0, d.life / 0.9);
      if (d.life <= 0) d.el.style.display = 'none';
    });
    for (var i = this.fx.length - 1; i >= 0; i--) {
      var f = this.fx[i];
      f.t += dt;
      var k = f.t / f.dur;
      if (k >= 1) { Engine.scene.remove(f.m); if (f.m.geometry) f.m.geometry.dispose(); if (f.m.material) f.m.material.dispose(); this.fx.splice(i, 1); continue; }
      if (f.kind === 'ring') {
        var r = f.maxR * (0.15 + 0.85 * k);
        f.m.scale.set(r, r, 1);
        f.m.material.opacity = 0.95 * (1 - k);
      } else if (f.kind === 'slash') {
        f.m.material.opacity = 0.95 * (1 - k);
        f.m.rotation.z += dt * 8;
      } else if (f.kind === 'dot') {
        f.m.position.x += f.vx * dt;
        f.m.position.y += f.vy * dt;
        f.m.position.z += f.vz * dt;
        if (f.vy < 0) f.vy -= 12 * dt;
        f.m.material.opacity = 1 - k;
      } else if (f.kind === 'bolt') {
        f.m.material.opacity = 1 - k * 0.7;
      } else if (f.kind === 'boom') {
        var br = f.maxR * k;
        f.m.scale.set(br, br, br);
        f.m.material.opacity = 0.5 * (1 - k);
      } else if (f.kind === 'proj') {
        var sp = 16;
        f.x += f.dx * sp * dt / CFG.TILE;
        f.y += f.dy * sp * dt / CFG.TILE;
        f.m.position.set(wX(f.x), 1.2, wZ(f.y));
        f.m.material.opacity = 1 - k * 0.5;
        Game.enemies.forEach(function (e) {
          if (e.dead || f.hit[e.id]) return;
          if (dist(e.x, e.y, f.x, f.y) < 0.9) {
            f.hit[e.id] = true;
            Combat.dealDamage(Game.leader, e, f.dmg, true);
          }
        });
      }
    }
  }
};

/* ================= LOOT ================= */
var Loot = {
  spawn: function (kind, x, y, val) {
    var m;
    if (kind === 'gold') {
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 12),
        new THREE.MeshLambertMaterial({ color: 0xffd94d, emissive: 0x6b5200 }));
      m.rotation.x = Math.PI / 2;
    } else {
      m = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8),
        new THREE.MeshLambertMaterial({ color: 0x2ecc71, emissive: 0x0a5c22 }));
    }
    m.position.set(wX(x), 0.5, wZ(y));
    m.castShadow = true;
    Engine.scene.add(m);
    Game.loots.push({ kind: kind, val: val, x: x, y: y, m: m, t: 0 });
  },
  update: function (dt) {
    var L = Game.leader;
    for (var i = Game.loots.length - 1; i >= 0; i--) {
      var l = Game.loots[i];
      l.t += dt;
      l.m.rotation.y += dt * 3;
      l.m.position.y = 0.5 + Math.sin(l.t * 4) * 0.15;
      if (L && !L.dead) {
        var d = dist(L.x, L.y, l.x, l.y);
        if (d < 2.2) {
          var dx = (L.x - l.x) / (d || 1), dy = (L.y - l.y) / (d || 1);
          l.x += dx * 6 * dt; l.y += dy * 6 * dt;
          l.m.position.set(wX(l.x), l.m.position.y, wZ(l.y));
        }
        if (d < 0.6) {
          if (l.kind === 'gold') { Game.gold += l.val; }
          else {
            Game.party.forEach(function (p) { if (!p.dead) p.hp = Math.min(p.maxHp, p.hp + l.val); });
            UI.toast('+' + l.val + ' HP cho cả đội!');
          }
          AudioMan.sfx('pickup');
          Engine.scene.remove(l.m);
          Game.loots.splice(i, 1);
          continue;
        }
      }
      if (l.t > 45) {
        Engine.scene.remove(l.m);
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
    if (Game.combo >= 3) {
      $('comboBox').style.display = 'block';
      $('comboNum').textContent = Game.combo;
    } else $('comboBox').style.display = 'none';
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
    if (!ctx) return;
    var W = cv.width, H = cv.height;
    ctx.fillStyle = '#16233d'; ctx.fillRect(0, 0, W, H);
    var sx = W / CFG.MAP_W, sy = H / CFG.MAP_H;
    ctx.strokeStyle = '#8d8578'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(28 * sx, 4 * sy); ctx.lineTo(28 * sx, 46 * sy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(12 * sx, 29 * sy); ctx.lineTo(44 * sx, 29 * sy); ctx.stroke();
    ctx.fillStyle = '#c9a94f'; ctx.fillRect(26 * sx, 3 * sy, 4 * sx, 4 * sy);
    ctx.fillStyle = '#9d4edd'; ctx.beginPath(); ctx.arc(50 * sx, 30 * sy, 4, 0, 7); ctx.fill();
    World.npcs.forEach(function (n) {
      ctx.fillStyle = '#ffd94d'; ctx.beginPath(); ctx.arc(n.x * sx, n.y * sy, 3, 0, 7); ctx.fill();
    });
    Game.enemies.forEach(function (e) {
      if (e.dead) return;
      ctx.fillStyle = e.isBoss ? '#ff2e2e' : '#ff7a5c';
      ctx.beginPath(); ctx.arc(e.x * sx, e.y * sy, e.isBoss ? 5 : 2.5, 0, 7); ctx.fill();
    });
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
    Engine.init();
    TileMap.build();
    World.build();
    Characters.spawnParty();
    Characters.spawnEnemies();
    /* NPC — Vệ Binh + Trưởng Lão (model CesiumMan thật, fallback procedural) */
    var guard = Characters.make('npc', { x: 25.5, y: 42.5, name: 'Vệ Binh A Hổ', level: 30 });
    var elder = Characters.make('npc2', { x: 24, y: 20, name: 'Trưởng Lão Tuyết', level: 40 });
    World.npcs.push(guard, elder);
    /* đăng ký raycast: group -> character */
    Game.party.concat(Game.enemies, World.npcs).forEach(function (c) { c.group.userData.char = c; });
    Effects.init();
    Input.init();
    UI.buildParty();
    UI.updateQuest();
    UI.updateActivity();
    Game.started = true;
    UI.banner('❄ TRƯỜNG BẠCH 3D ❄', 'Nói chuyện với Vệ Binh A Hổ ở cổng thành để nhận nhiệm vụ!');
    var self = this;
    function loop() {
      requestAnimationFrame(loop);
      var dt = Math.min(Engine.clock.getDelta(), 0.05);
      if (!Game.started) { Engine.renderer.render(Engine.scene, Engine.camera); return; }
      if (Game.over) { Engine.renderer.render(Engine.scene, Engine.camera); return; }
      Game.time += dt;
      Engine.time = Game.time;
      PartyAI.update(dt);
      EnemyAI.update(dt);
      World.npcs.forEach(function (n) { Characters.animate(n, dt, false); });
      Skills.tick(dt);
      Effects.update(dt);
      Loot.update(dt);
      Camera.update(dt);
      World.updateSnow(dt, wX(Game.leader.x), wZ(Game.leader.y));
      Game.party.forEach(function (p) { if (!p.dead) p.mp = Math.min(p.maxMp, p.mp + 7 * dt); });
      if (Game.comboTimer > 0) { Game.comboTimer -= dt; if (Game.comboTimer <= 0) Game.combo = 0; }
      if (Game.time - self.lastUI > 0.1) { self.lastUI = Game.time; UI.update(); UI.updateActivity(); }
      if (Game.time - self.lastMap > 0.25) { self.lastMap = Game.time; UI.drawMinimap(); }
      Engine.renderer.render(Engine.scene, Engine.camera);
    }
    loop();
  }
};

$('btnStart').addEventListener('click', function () { Main.start(); });
$('btnAgain').addEventListener('click', function () { location.reload(); });
$('dlgBtn').addEventListener('click', function () { UI.hideDialog(); });

})();
