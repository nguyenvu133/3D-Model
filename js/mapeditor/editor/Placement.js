/* ============================================================
 * mapeditor/editor/Placement.js — Prefab wuxia procedural
 * (đền, nhà, thông, trúc, đá, cầu, đèn lồng, cổng, portal,
 * lửa trại, tượng, hàng rào, thác, hero chibi, quái, boss)
 * + đặt object lên terrain (raycast / heightAt), scatter.
 * Mọi prefab là THREE.Group thật, có userData.mapType/mapId để
 * serialize ngược về SceneData.
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  /* Vật liệu dùng chung (shared material): mat() cache theo màu + opts để
   * map 150+ object không tạo hàng nghìn material trùng nhau. BuildPrefab
   * clone material trước khi đổi màu/roughness riêng (xem buildPrefab),
   * nên cache này không làm rò rỉ tuỳ chỉnh giữa các object. */
  var MAT_CACHE = {};
  function mat(color, opts) {
    opts = opts || {};
    var key = color + '|' + (opts.roughness !== undefined ? opts.roughness : 0.85) + '|' +
      (opts.metalness || 0) + '|' + (opts.transparent ? 1 : 0) + '|' +
      (opts.opacity !== undefined ? opts.opacity : 1) + '|' + (opts.emissive || 0) + '|' +
      (opts.emissiveIntensity !== undefined ? opts.emissiveIntensity : 1) + '|' + (opts.doubleSide ? 1 : 0);
    if (MAT_CACHE[key]) return MAT_CACHE[key];
    var m = new THREE.MeshStandardMaterial({
      color: color,
      roughness: opts.roughness !== undefined ? opts.roughness : 0.85,
      metalness: opts.metalness || 0,
      transparent: !!opts.transparent,
      opacity: opts.opacity !== undefined ? opts.opacity : 1,
      emissive: opts.emissive || 0x000000,
      emissiveIntensity: opts.emissiveIntensity !== undefined ? opts.emissiveIntensity : 1,
      side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide
    });
    MAT_CACHE[key] = m;
    return m;
  }
  function box(w, h, d, color, x, y, z, opts) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function cone(r, h, color, x, y, z, seg, opts) {
    var m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg || 4), mat(color, opts));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function cyl(rt, rb, h, color, x, y, z, seg, opts) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 8), mat(color, opts));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function sphere(r, color, x, y, z, opts) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat(color, opts));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /* ---------- từng prefab ---------- */
  var BUILDERS = {};

  BUILDERS.temple = function (o) {
    var g = new THREE.Group();
    g.add(box(15, 0.6, 8, 0x7a7264, 0, 0.3, 3));
    g.add(box(13, 0.6, 6, 0x8d8578, 0, 0.9, 2));
    g.add(box(11, 6.5, 6, 0x8a2f26, 0, 4.2, 0));
    g.add(box(11.4, 0.5, 6.4, 0xc9a94f, 0, 7.2, 0));
    g.add(box(2.2, 4.2, 0.3, 0xc9a94f, 0, 3.1, 3.1));
    [-4.6, 4.6].forEach(function (dx) { g.add(cyl(0.35, 0.35, 6.5, 0x5e1f18, dx, 4.2, 2.6, 8)); });
    var r1 = cone(9.5, 3.4, 0x1e4d3a, 0, 9, 0, 4); r1.rotation.y = Math.PI / 4; g.add(r1);
    var s1 = cone(9.7, 0.5, 0xe8eef7, 0, 7.6, 0, 4); s1.rotation.y = Math.PI / 4; g.add(s1);
    var r2 = cone(7, 2.8, 0x1e4d3a, 0, 12, 0, 4); r2.rotation.y = Math.PI / 4; g.add(r2);
    var s2 = cone(7.2, 0.4, 0xe8eef7, 0, 10.8, 0, 4); s2.rotation.y = Math.PI / 4; g.add(s2);
    g.add(sphere(0.5, 0xffd94d, 0, 14.2, 0, { emissive: 0x8a6d1f }));
    g.add(cyl(0.12, 0.12, 1.6, 0xc9a94f, 0, 13.4, 0, 6));
    return g;
  };

  BUILDERS.house = function (o) {
    var g = new THREE.Group();
    g.add(box(6.8, 3, 5, 0x7a4a2e, 0, 1.5, 0));
    var r = cone(5.4, 2.6, 0x1e4d3a, 0, 4.3, 0, 4); r.rotation.y = Math.PI / 4; g.add(r);
    var s = cone(5.5, 0.35, 0xdfe8f2, 0, 3.2, 0, 4); s.rotation.y = Math.PI / 4; g.add(s);
    var win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ color: 0xffc86e }));
    win.position.set(0, 1.6, 2.55); g.add(win);
    var win2 = win.clone(); win2.position.set(-2, 1.6, 2.55); g.add(win2);
    return g;
  };

  BUILDERS.pine = function (o) {
    var g = new THREE.Group();
    g.add(cyl(0.18, 0.24, 1.6, 0x4a3220, 0, 0.8, 0, 6));
    g.add(cone(1.5, 2.6, 0x1d4a2e, 0, 2.8, 0, 8));
    g.add(cone(1.1, 2.2, 0x25603a, 0, 4.4, 0, 8));
    g.add(cone(0.55, 1.1, 0xe8eef7, 0, 5.6, 0, 8));
    return g;
  };

  BUILDERS.bamboo = function (o) {
    var g = new THREE.Group();
    for (var i = 0; i < 5; i++) {
      var dx = (i - 2) * 0.7;
      g.add(cyl(0.12, 0.14, 6 + (i % 2), 0x4a8a3a, dx, 3 + (i % 2) * 0.5, (i % 3 - 1) * 0.5, 6));
      g.add(cone(0.5, 1.2, 0x5aa04a, dx, 6.4 + (i % 2) * 0.5, (i % 3 - 1) * 0.5, 6));
    }
    return g;
  };

  BUILDERS.rock = function (o) {
    var g = new THREE.Group();
    var r = new THREE.Mesh(new THREE.DodecahedronGeometry(1.4, 0), mat(0x8a8a94));
    r.scale.set(1, 0.7, 0.9); r.position.y = 0.7;
    r.castShadow = true; r.receiveShadow = true;
    g.add(r);
    var r2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 0), mat(0x9aa4b5));
    r2.position.set(1.2, 0.4, 0.6); r2.scale.set(1, 0.6, 1);
    r2.castShadow = true; g.add(r2);
    return g;
  };

  BUILDERS.bridge = function (o) {
    var g = new THREE.Group();
    for (var i = 0; i < 7; i++) {
      g.add(box(3.6, 0.18, 1.2, 0x7d5a34, 0, 0.4 + Math.sin(i / 6 * Math.PI) * 0.7, -3.6 + i * 1.2));
    }
    [-1.9, 1.9].forEach(function (dx) {
      g.add(box(0.14, 1.0, 7.4, 0x6b4a2a, dx, 0.9, 0));
      g.add(box(0.12, 0.12, 7.4, 0x8a6a42, dx, 1.35, 0));
    });
    return g;
  };

  BUILDERS.lantern = function (o) {
    var g = new THREE.Group();
    g.add(cyl(0.09, 0.09, 2.6, 0x2a2018, 0, 1.3, 0, 6));
    g.add(sphere(0.55, 0xff5a3c, 0, 2.9, 0, { emissive: 0x992200 }));
    g.add(sphere(0.7, 0xffb347, 0, 2.9, 0, { emissive: 0xff8a00, transparent: true, opacity: 0.18 }));
    return g;
  };

  BUILDERS.gate = function (o) {
    var g = new THREE.Group();
    [-6.5, 6.5].forEach(function (dx) { g.add(box(1.1, 7.5, 1.1, 0x6e3f2a, dx, 3.75, 0)); });
    g.add(box(15.5, 1.3, 1.4, 0x1e4d3a, 0, 7.6, 0));
    var r = cone(10.5, 2.6, 0x1e4d3a, 0, 9.4, 0, 4); r.rotation.y = Math.PI / 4; g.add(r);
    var s = cone(10.7, 0.35, 0xe8eef7, 0, 8.3, 0, 4); s.rotation.y = Math.PI / 4; g.add(s);
    g.add(sphere(0.5, 0xffd94d, 0, 11.4, 0, { emissive: 0x8a6d1f }));
    g.add(box(5.2, 1, 0.2, 0x8a2f26, 0, 6.6, 0.8));
    return g;
  };

  BUILDERS.torii = function (o) {
    /* cổng torii đỏ kiểu Nhật/wuxia — 2 trụ + 2 xà ngang cong nhẹ */
    var g = new THREE.Group();
    [-2.6, 2.6].forEach(function (dx) { g.add(cyl(0.32, 0.38, 6.4, 0xb02020, dx, 3.2, 0, 10)); });
    g.add(box(7.6, 0.55, 0.7, 0x8a1414, 0, 6.6, 0));
    var top = box(8.6, 0.45, 0.9, 0x1a1a1a, 0, 7.4, 0);
    g.add(top);
    g.add(box(6.4, 0.4, 0.5, 0xb02020, 0, 5.6, 0));
    g.add(box(0.5, 0.9, 0.5, 0xc9a94f, 0, 7.0, 0));
    return g;
  };

  BUILDERS.well = function (o) {
    /* giếng đá có mái */
    var g = new THREE.Group();
    var rim = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 1.1, 12, 1, true), mat(0x8a8a94, { doubleSide: true }));
    rim.position.y = 0.55; rim.castShadow = true; rim.receiveShadow = true;
    g.add(rim);
    var water = new THREE.Mesh(new THREE.CircleGeometry(1.15, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a5a7a, roughness: 0.1, metalness: 0.2 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.85;
    g.add(water);
    [-1.1, 1.1].forEach(function (dx) { g.add(box(0.18, 2.2, 0.18, 0x6b4a2a, dx, 1.1, 0)); });
    var roof = cone(1.9, 1.1, 0x1e4d3a, 0, 2.9, 0, 4); roof.rotation.y = Math.PI / 4; g.add(roof);
    var bucket = cyl(0.22, 0.22, 0.3, 0x6b4a2a, 0, 1.9, 0, 8);
    g.add(bucket);
    return g;
  };

  BUILDERS.tower = function (o) {
    /* tháp canh 3 tầng mái */
    var g = new THREE.Group();
    g.add(box(5, 1, 5, 0x7a7264, 0, 0.5, 0));
    var tiers = [[4.2, 3.2, 0], [3.4, 3.0, 5.4], [2.6, 2.8, 10.4]];
    tiers.forEach(function (t, i) {
      g.add(box(t[0], t[1], t[0], i % 2 ? 0x7a4a2e : 0x8a2f26, 0, t[2] + t[1] / 2 + 1, 0));
      var roof = cone(t[0] * 0.85, 1.6, 0x1e4d3a, 0, t[2] + t[1] + 1.8, 0, 4);
      roof.rotation.y = Math.PI / 4; g.add(roof);
      var snow = cone(t[0] * 0.87, 0.25, 0xe8eef7, 0, t[2] + t[1] + 1.1, 0, 4);
      snow.rotation.y = Math.PI / 4; g.add(snow);
    });
    g.add(sphere(0.4, 0xffd94d, 0, 14.6, 0, { emissive: 0x8a6d1f }));
    return g;
  };

  BUILDERS.portal = function (o) {
    var g = new THREE.Group();
    var torus = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.35, 10, 28), new THREE.MeshBasicMaterial({ color: 0x9d4edd }));
    torus.position.y = 2.6; torus.rotation.y = Math.PI / 4;
    g.add(torus);
    var core = new THREE.Mesh(new THREE.CircleGeometry(2.3, 24),
      new THREE.MeshBasicMaterial({ color: 0x6a1fb0, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    core.position.y = 2.6; core.rotation.y = Math.PI / 4;
    g.add(core);
    g.add(box(6.4, 0.5, 1.2, 0x3a3a44, 0, 0.25, 0));
    return g;
  };

  BUILDERS.campfire = function (o) {
    var g = new THREE.Group();
    g.add(cyl(0.7, 0.8, 0.4, 0x6b4a2a, 0, 0.2, 0, 8));
    for (var i = 0; i < 5; i++) {
      var a = i / 5 * Math.PI * 2;
      var log = cyl(0.09, 0.09, 1.1, 0x4a3220, Math.cos(a) * 0.3, 0.5, Math.sin(a) * 0.3, 5);
      log.rotation.z = Math.cos(a) * 0.7; log.rotation.x = -Math.sin(a) * 0.7;
      g.add(log);
    }
    var flame = cone(0.45, 1.1, 0xff8a2a, 0, 1.1, 0, 8, { emissive: 0xcc4400, emissiveIntensity: 1.4 });
    flame.name = 'flame';
    g.add(flame);
    return g;
  };

  BUILDERS.statue = function (o) {
    var g = new THREE.Group();
    g.add(box(3, 1, 3, 0x7a7264, 0, 0.5, 0));
    g.add(cyl(0.5, 0.65, 2.6, 0x9aa4b5, 0, 2.3, 0, 8));
    g.add(sphere(0.45, 0x9aa4b5, 0, 3.9, 0));
    var sword = box(0.14, 2.2, 0.3, 0xc9a94f, 0.7, 2.6, 0);
    sword.rotation.z = 0.5;
    g.add(sword);
    return g;
  };

  BUILDERS.fence = function (o) {
    var g = new THREE.Group();
    for (var i = 0; i < 5; i++) g.add(box(0.14, 1.1, 0.14, 0x6b4a2a, -2.8 + i * 1.4, 0.55, 0));
    g.add(box(5.8, 0.12, 0.12, 0x7d5a34, 0, 0.85, 0));
    return g;
  };

  BUILDERS.waterfall = function (o) {
    var g = new THREE.Group();
    var cliff = new THREE.Mesh(new THREE.DodecahedronGeometry(4, 0), mat(0x6a6a74));
    cliff.scale.set(1.2, 1.4, 0.8); cliff.position.y = 3;
    cliff.castShadow = true; cliff.receiveShadow = true;
    g.add(cliff);
    var water = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 5.5),
      new THREE.MeshStandardMaterial({ color: 0x7ac8e8, transparent: true, opacity: 0.75, roughness: 0.2, metalness: 0.1 }));
    water.position.set(0, 3, 3.3);
    g.add(water);
    var foam = new THREE.Mesh(new THREE.CircleGeometry(2.4, 16),
      new THREE.MeshStandardMaterial({ color: 0xe8f4f8, transparent: true, opacity: 0.6 }));
    foam.rotation.x = -Math.PI / 2; foam.position.set(0, 0.15, 4.2);
    g.add(foam);
    return g;
  };

  function humanoid(o, opts) {
    /* chibi humanoid — tay/chân là group riêng để anim được */
    opts = opts || {};
    var skin = opts.skin || 0xf2c89b;
    var cloth = opts.cloth || 0x8a2f26;
    var g = new THREE.Group();
    var body = new THREE.Group(); g.add(body);
    var torso = box(0.9, 0.9, 0.55, cloth, 0, 1.15, 0); body.add(torso);
    var head = sphere(0.55, skin, 0, 2.15, 0); head.name = 'head'; body.add(head);
    var hair = sphere(0.56, opts.hair || 0x2a2018, 0, 2.3, -0.08);
    hair.scale.set(1, 0.7, 1); body.add(hair);
    var bun = sphere(0.22, opts.hair || 0x2a2018, 0, 2.65, 0); body.add(bun);
    var armL = new THREE.Group(); armL.position.set(-0.55, 1.5, 0);
    var aL = box(0.28, 0.8, 0.28, cloth, 0, -0.35, 0); armL.add(aL);
    var armR = new THREE.Group(); armR.position.set(0.55, 1.5, 0);
    var aR = box(0.28, 0.8, 0.28, cloth, 0, -0.35, 0); armR.add(aR);
    body.add(armL); body.add(armR);
    var legL = new THREE.Group(); legL.position.set(-0.25, 0.75, 0);
    legL.add(box(0.3, 0.75, 0.3, opts.pants || 0x2c3a58, 0, -0.35, 0));
    var legR = new THREE.Group(); legR.position.set(0.25, 0.75, 0);
    legR.add(box(0.3, 0.75, 0.3, opts.pants || 0x2c3a58, 0, -0.35, 0));
    body.add(legL); body.add(legR);
    if (opts.sword) {
      var sw = box(0.08, 1.1, 0.16, 0xc9c9d8, 0, -0.7, 0.1);
      sw.rotation.x = 0.4; armR.add(sw);
    }
    g.userData.limbs = { body: body, head: head, armL: armL, armR: armR, legL: legL, legR: legR };
    return g;
  }

  BUILDERS.hero = function (o) {
    return humanoid(o, { cloth: 0x8a2f26, sword: true });
  };
  BUILDERS.monster = function (o) {
    var g = humanoid(o, { cloth: 0x3a5a3a, skin: 0x9ab87a, hair: 0x1a2a1a, pants: 0x24301e });
    g.scale.setScalar(1.15);
    return g;
  };
  BUILDERS.boss = function (o) {
    var g = humanoid(o, { cloth: 0x5a1a6a, skin: 0xd8c8e8, hair: 0xe8e8f2, pants: 0x2a1030, sword: true });
    g.scale.setScalar(1.9);
    return g;
  };

  BUILDERS.light = function (o) {
    var g = new THREE.Group();
    var bulb = sphere(0.3, 0xffd94d, 0, 0, 0, { emissive: 0xffc86e, emissiveIntensity: 1.5 });
    g.add(bulb);
    var pl = new THREE.PointLight(0xfff2cc, 1, 18);
    g.add(pl);
    g.userData.pointLight = pl;
    return g;
  };

  BUILDERS.patrol = function (o) {
    var g = new THREE.Group();
    var pts = (o.path || [[-8, -8], [8, -8], [8, 8], [-8, 8]]).map(function (p) {
      return new THREE.Vector3(p[0], 0.3, p[1]);
    });
    if (pts.length > 1) {
      pts.push(pts[0].clone());
      var geo = new THREE.BufferGeometry().setFromPoints(pts);
      var line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd94d }));
      g.add(line);
      pts.slice(0, -1).forEach(function (p) {
        g.add(sphere(0.28, 0xffd94d, p.x, 0.3, p.z, { emissive: 0x8a6d1f }));
      });
    }
    return g;
  };

  /* ================= PREFAB MỚI — đợt mở rộng viewport (2026-11-24) ================
   * 35 builder mới (xem NEW_TYPES cuối file). Mỗi builder trả THREE.Group thật,
   * dùng chung helper mat()/box()/cone()/cyl()/sphere() nên material được cache. */

  function lanternColored(color, glow) {
    var g = new THREE.Group();
    g.add(cyl(0.09, 0.09, 2.6, 0x2a2018, 0, 1.3, 0, 6));
    g.add(sphere(0.55, color, 0, 2.9, 0, { emissive: glow }));
    g.add(sphere(0.7, 0xffb347, 0, 2.9, 0, { emissive: 0xff8a00, transparent: true, opacity: 0.18 }));
    return g;
  }
  BUILDERS.lantern_red = function () { return lanternColored(0xff3b30, 0x992200); };
  BUILDERS.lantern_yellow = function () { return lanternColored(0xffd94d, 0x8a6d1f); };
  BUILDERS.lantern_blue = function () { return lanternColored(0x3a7ab5, 0x1a3a6a); };

  BUILDERS.pagoda = function (o) {
    /* chùa 3 tầng mái cong — như tower nhưng rộng hơn, có đế đá 2 bậc */
    var g = new THREE.Group();
    g.add(box(9, 1, 9, 0x7a7264, 0, 0.5, 0));
    g.add(box(7.5, 0.8, 7.5, 0x8d8578, 0, 1.4, 0));
    var tiers = [[6.2, 3.0, 1.8], [5.0, 2.8, 6.4], [3.8, 2.6, 10.6]];
    tiers.forEach(function (t, i) {
      g.add(box(t[0], t[1], t[0], i % 2 ? 0x8a2f26 : 0x7a4a2e, 0, t[2] + t[1] / 2, 0));
      var roof = cone(t[0] * 0.82, 1.7, 0x1e4d3a, 0, t[2] + t[1] + 0.85, 0, 4);
      roof.rotation.y = Math.PI / 4; g.add(roof);
      var snow = cone(t[0] * 0.84, 0.28, 0xe8eef7, 0, t[2] + t[1] + 0.15, 0, 4);
      snow.rotation.y = Math.PI / 4; g.add(snow);
    });
    g.add(sphere(0.5, 0xffd94d, 0, 14.6, 0, { emissive: 0x8a6d1f }));
    g.add(cyl(0.12, 0.12, 1.4, 0xc9a94f, 0, 13.9, 0, 6));
    return g;
  };

  BUILDERS.torii_big = function (o) {
    /* torii đỏ lớn — gấp ~1.6 lần torii thường, trụ dày + xà cong */
    var g = new THREE.Group();
    [-4.2, 4.2].forEach(function (dx) { g.add(cyl(0.5, 0.6, 10, 0xb02020, dx, 5, 0, 10)); });
    g.add(box(12.2, 0.85, 1.1, 0x8a1414, 0, 10.4, 0));
    g.add(box(13.8, 0.7, 1.4, 0x1a1a1a, 0, 11.6, 0));
    g.add(box(10.2, 0.6, 0.8, 0xb02020, 0, 8.8, 0));
    g.add(box(0.8, 1.4, 0.8, 0xc9a94f, 0, 11.0, 0));
    g.add(box(6, 1.2, 0.2, 0x8a2f26, 0, 9.6, 0.9));
    return g;
  };

  BUILDERS.bridge_arch = function (o) {
    /* cầu gỗ cong (vòm) — ván cong theo sin, lan can 2 bên */
    var g = new THREE.Group();
    for (var i = 0; i < 9; i++) {
      var t = i / 8, z = -4.8 + t * 9.6;
      g.add(box(3.6, 0.18, 1.2, 0x7d5a34, 0, 0.4 + Math.sin(t * Math.PI) * 1.6, z));
    }
    [-1.9, 1.9].forEach(function (dx) {
      for (var j = 0; j < 9; j++) {
        var tj = j / 8, zj = -4.8 + tj * 9.6;
        g.add(box(0.14, 1.0, 1.1, 0x6b4a2a, dx, 0.9 + Math.sin(tj * Math.PI) * 1.6, zj));
      }
      g.add(box(0.12, 0.12, 9.8, 0x8a6a42, dx, 2.9, 0));
    });
    return g;
  };

  BUILDERS.well_stone = function (o) {
    /* giếng đá có mái ngói — thành giếng đá dày + 4 cột + mái 2 dốc */
    var g = new THREE.Group();
    var rim = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.75, 1.3, 12, 1, true), mat(0x7a7a82, { doubleSide: true }));
    rim.position.y = 0.65; rim.castShadow = true; rim.receiveShadow = true;
    g.add(rim);
    var water = new THREE.Mesh(new THREE.CircleGeometry(1.45, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a5a7a, roughness: 0.1, metalness: 0.2 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 1.0;
    g.add(water);
    [-1.4, 1.4].forEach(function (dx) {
      [-1.4, 1.4].forEach(function (dz) { g.add(box(0.2, 2.6, 0.2, 0x6b4a2a, dx, 1.3, dz)); });
    });
    var roof = cone(2.6, 1.4, 0x1e4d3a, 0, 3.4, 0, 4); roof.rotation.y = Math.PI / 4; g.add(roof);
    g.add(box(3.4, 0.18, 0.5, 0xc9a94f, 0, 2.75, 0));
    g.add(cyl(0.22, 0.22, 0.3, 0x6b4a2a, 0, 2.2, 0, 8));
    return g;
  };

  BUILDERS.fence_wood = function (o) {
    /* hàng rào gỗ dài — 7 cọc nhọn + 2 thanh ngang */
    var g = new THREE.Group();
    for (var i = 0; i < 7; i++) {
      var x = -4.2 + i * 1.4;
      g.add(box(0.16, 1.3, 0.16, 0x6b4a2a, x, 0.65, 0));
      g.add(cone(0.14, 0.35, 0x6b4a2a, x, 1.45, 0, 4));
    }
    g.add(box(8.6, 0.14, 0.14, 0x7d5a34, 0, 0.95, 0));
    g.add(box(8.6, 0.14, 0.14, 0x7d5a34, 0, 0.45, 0));
    return g;
  };

  BUILDERS.statue_dragon = function (o) {
    /* tượng rồng đá — thân uốn lượn (chuỗi cầu thu nhỏ) + đầu + sừng */
    var g = new THREE.Group();
    g.add(box(4, 1, 4, 0x7a7264, 0, 0.5, 0));
    var pts = [[-1.2, 1.6, 0.6, 0.7], [-0.4, 2.4, 0, 0.62], [0.5, 3.1, -0.4, 0.55], [1.2, 3.9, -0.2, 0.5], [1.5, 4.7, 0.4, 0.45]];
    pts.forEach(function (p) { g.add(sphere(p[3], 0x9aa4b5, p[0], p[1], p[2])); });
    g.add(sphere(0.55, 0x9aa4b5, 1.9, 5.4, 0.6));
    var snout = box(0.7, 0.4, 0.9, 0x9aa4b5, 2.4, 5.3, 0.6); g.add(snout);
    [-0.25, 0.25].forEach(function (dz) {
      var horn = cone(0.12, 0.9, 0xc9a94f, 1.7, 6.0, 0.6 + dz, 6);
      horn.rotation.z = -0.4; g.add(horn);
    });
    g.add(sphere(0.16, 0xff3b30, 2.15, 5.55, 0.35, { emissive: 0x992200 }));
    g.add(sphere(0.16, 0xff3b30, 2.15, 5.55, 0.85, { emissive: 0x992200 }));
    return g;
  };

  BUILDERS.stall = function (o) {
    /* quầy hàng chợ — bàn gỗ + mái vải sọc + hàng hoá */
    var g = new THREE.Group();
    g.add(box(3.4, 0.9, 1.6, 0x7d5a34, 0, 0.45, 0));
    g.add(box(3.6, 0.12, 1.8, 0x6b4a2a, 0, 0.95, 0));
    [-1.6, 1.6].forEach(function (dx) {
      [-0.7, 0.7].forEach(function (dz) { g.add(box(0.14, 2.4, 0.14, 0x6b4a2a, dx, 1.2, dz)); });
    });
    for (var i = 0; i < 6; i++) {
      g.add(box(0.62, 0.1, 1.9, i % 2 ? 0x8a2f26 : 0xe8e0c8, -1.55 + i * 0.62, 2.5, 0));
    }
    g.add(sphere(0.28, 0xff8a2a, -1, 1.15, 0.2));
    g.add(sphere(0.28, 0xff8a2a, -0.4, 1.15, -0.2));
    g.add(sphere(0.25, 0x9ab87a, 0.3, 1.12, 0.3));
    g.add(box(0.5, 0.4, 0.5, 0xc9a94f, 1.1, 1.2, 0));
    return g;
  };

  BUILDERS.house_tile = function (o) {
    /* nhà mái ngói cong — tường gạch + mái ngói xanh cong 2 đầu */
    var g = new THREE.Group();
    g.add(box(7.2, 3.2, 5.4, 0x9a7a5a, 0, 1.6, 0));
    var r = cone(5.8, 2.8, 0x2a4a6a, 0, 4.6, 0, 4); r.rotation.y = Math.PI / 4; g.add(r);
    var s = cone(5.9, 0.35, 0xdfe8f2, 0, 3.4, 0, 4); s.rotation.y = Math.PI / 4; g.add(s);
    [-3.4, 3.4].forEach(function (dx) { g.add(box(0.5, 0.5, 0.5, 0x2a4a6a, dx, 4.9, 0)); });
    g.add(box(1.4, 2.2, 0.2, 0x5e1f18, 0, 1.1, 2.75));
    var win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ color: 0xffc86e }));
    win.position.set(-2.2, 1.7, 2.75); g.add(win);
    var win2 = win.clone(); win2.position.set(2.2, 1.7, 2.75); g.add(win2);
    return g;
  };

  BUILDERS.house_thatch = function (o) {
    /* nhà mái rơm — tường đất + mái rơm vàng dày */
    var g = new THREE.Group();
    g.add(box(6.4, 2.8, 5, 0xb09a72, 0, 1.4, 0));
    var r = cone(5.2, 2.4, 0xd8b45a, 0, 4.0, 0, 4); r.rotation.y = Math.PI / 4; g.add(r);
    var r2 = cone(4.2, 1.6, 0xc9a94f, 0, 5.0, 0, 4); r2.rotation.y = Math.PI / 4; g.add(r2);
    g.add(box(5.6, 0.3, 0.6, 0xa8894a, 0, 5.6, 0));
    g.add(box(1.2, 2, 0.2, 0x4a3220, 0, 1.0, 2.55));
    return g;
  };

  BUILDERS.house_flat = function (o) {
    /* nhà mái bằng — hộp 2 tầng + sân thượng + ống khói */
    var g = new THREE.Group();
    g.add(box(6.8, 3, 5.2, 0x8a7a6a, 0, 1.5, 0));
    g.add(box(5, 2.4, 4, 0x7a6a5a, -0.6, 4.2, -0.4));
    g.add(box(7.0, 0.3, 5.4, 0x6a5a4a, 0, 3.15, 0));
    g.add(box(5.2, 0.25, 4.2, 0x6a5a4a, -0.6, 5.5, -0.4));
    g.add(box(0.6, 1.2, 0.6, 0x5e1f18, 2.4, 6.0, -1.2));
    var win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ color: 0xffc86e }));
    win.position.set(1.8, 1.6, 2.65); g.add(win);
    return g;
  };

  BUILDERS.pine_snow = function (o) {
    /* thông tuyết — tán xanh phủ tuyết trắng dày */
    var g = new THREE.Group();
    g.add(cyl(0.2, 0.26, 1.8, 0x4a3220, 0, 0.9, 0, 6));
    g.add(cone(1.6, 2.8, 0x1d4a2e, 0, 3.0, 0, 8));
    g.add(cone(1.7, 0.5, 0xe8eef7, 0, 3.4, 0, 8));
    g.add(cone(1.2, 2.4, 0x25603a, 0, 4.7, 0, 8));
    g.add(cone(1.3, 0.45, 0xe8eef7, 0, 5.1, 0, 8));
    g.add(cone(0.6, 1.2, 0xe8eef7, 0, 6.0, 0, 8));
    return g;
  };

  BUILDERS.pine_tall = function (o) {
    /* thông cao — thân dài + 4 tầng tán */
    var g = new THREE.Group();
    g.add(cyl(0.24, 0.32, 3.2, 0x4a3220, 0, 1.6, 0, 6));
    [[1.9, 3.2, 4.4], [1.6, 2.8, 6.0], [1.25, 2.4, 7.5], [0.85, 2.0, 8.9]].forEach(function (t) {
      g.add(cone(t[0], t[1], 0x1d4a2e, 0, t[2], 0, 8));
    });
    g.add(cone(0.5, 1.0, 0xe8eef7, 0, 10.0, 0, 8));
    return g;
  };

  BUILDERS.pine_short = function (o) {
    /* thông lùn — thân ngắn + 2 tầng tán tròn */
    var g = new THREE.Group();
    g.add(cyl(0.16, 0.2, 0.9, 0x4a3220, 0, 0.45, 0, 6));
    g.add(cone(1.3, 2.0, 0x25603a, 0, 1.9, 0, 8));
    g.add(cone(0.9, 1.6, 0x1d4a2e, 0, 3.1, 0, 8));
    g.add(cone(0.45, 0.9, 0xe8eef7, 0, 4.0, 0, 8));
    return g;
  };

  BUILDERS.sakura = function (o) {
    /* hoa anh đào — thân nâu + 3 cụm hoa hồng */
    var g = new THREE.Group();
    g.add(cyl(0.22, 0.3, 2.2, 0x5a3a28, 0, 1.1, 0, 6));
    g.add(cyl(0.1, 0.14, 1.4, 0x5a3a28, 0.7, 2.6, 0.3, 5));
    g.add(sphere(1.5, 0xf2a8c8, 0, 3.4, 0, { roughness: 1 }));
    g.add(sphere(1.0, 0xf27ab0, 1.2, 2.8, 0.5));
    g.add(sphere(0.9, 0xf7c8dc, -1.1, 2.9, -0.4));
    g.add(sphere(0.35, 0xffd94d, 0.4, 3.9, 0.6, { emissive: 0x8a6d1f }));
    return g;
  };

  BUILDERS.mushroom = function (o) {
    /* nấm — thân trắng + mũ đỏ chấm trắng */
    var g = new THREE.Group();
    g.add(cyl(0.28, 0.38, 0.9, 0xe8e0c8, 0, 0.45, 0, 8));
    var cap = sphere(0.75, 0xd83a2a, 0, 1.05, 0);
    cap.scale.set(1, 0.62, 1); g.add(cap);
    [[0.35, 1.35, 0.3], [-0.3, 1.4, 0.35], [0, 1.45, -0.4], [-0.45, 1.2, -0.2]].forEach(function (p) {
      g.add(sphere(0.12, 0xffffff, p[0], p[1], p[2]));
    });
    return g;
  };

  function crystal(color, glow) {
    var g = new THREE.Group();
    var c = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), mat(color, { emissive: glow, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.1 }));
    c.position.y = 1.1; c.castShadow = true; c.receiveShadow = true;
    g.add(c);
    var c2 = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), mat(color, { emissive: glow, emissiveIntensity: 0.9, roughness: 0.25 }));
    c2.position.set(0.8, 0.6, 0.3); c2.castShadow = true;
    g.add(c2);
    g.add(box(2.0, 0.4, 2.0, 0x6a6a74, 0, 0.2, 0));
    return g;
  }
  BUILDERS.crystal_red = function () { return crystal(0xd83a2a, 0x881111); };
  BUILDERS.crystal_blue = function () { return crystal(0x3a7ad8, 0x113388); };
  BUILDERS.crystal_purple = function () { return crystal(0x9d4edd, 0x551188); };

  BUILDERS.stone_stove = function (o) {
    /* bếp lửa đá — vòng đá + lửa + nồi */
    var g = new THREE.Group();
    for (var i = 0; i < 7; i++) {
      var a = i / 7 * Math.PI * 2;
      g.add(box(0.5, 0.5, 0.35, 0x7a7a82, Math.cos(a) * 0.85, 0.25, Math.sin(a) * 0.85));
    }
    var flame = cone(0.4, 1.0, 0xff8a2a, 0, 1.0, 0, 8, { emissive: 0xcc4400, emissiveIntensity: 1.4 });
    flame.name = 'flame';
    g.add(flame);
    g.add(cyl(0.55, 0.45, 0.4, 0x2a2a30, 0, 1.7, 0, 10));
    return g;
  };

  BUILDERS.stream = function (o) {
    /* suối — dải nước trong + đá 2 bờ */
    var g = new THREE.Group();
    var water = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 9),
      new THREE.MeshStandardMaterial({ color: 0x5ab8d8, transparent: true, opacity: 0.8, roughness: 0.15, metalness: 0.1 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.12;
    g.add(water);
    [-1.6, 1.6].forEach(function (dx) {
      for (var i = 0; i < 4; i++) {
        g.add(sphere(0.35 + (i % 2) * 0.15, 0x8a8a94, dx + (i % 2 - 0.5) * 0.3, 0.2, -3.4 + i * 2.3));
      }
    });
    return g;
  };

  BUILDERS.cloud = function (o) {
    /* mây bay — cụm cầu trắng, trôi trong updatePlay */
    var g = new THREE.Group();
    [[0, 0, 0, 1.6], [1.6, -0.2, 0.3, 1.2], [-1.5, -0.1, -0.2, 1.1], [0.5, 0.5, -0.4, 1.0]].forEach(function (p) {
      var s = sphere(p[3], 0xffffff, p[0], p[1], p[2], { transparent: true, opacity: 0.92, roughness: 1 });
      s.castShadow = false;
      g.add(s);
    });
    g.userData.cloud = true;
    return g;
  };

  function flyingCreature(o, opts) {
    /* chim/dơi: thân + 2 cánh là group riêng (userData.wings) để đập trong updatePlay */
    var g = new THREE.Group();
    var body = new THREE.Group(); g.add(body);
    var torso = sphere(0.42, opts.body, 0, 0, 0);
    torso.scale.set(1, 0.85, 1.5); body.add(torso);
    body.add(sphere(0.28, opts.body, 0, 0.15, 0.6));
    var beak = cone(0.12, 0.4, opts.beak || 0xffd94d, 0, 0.15, 1.0, 6);
    beak.rotation.x = Math.PI / 2; body.add(beak);
    var wingL = new THREE.Group(); wingL.position.set(-0.3, 0.15, 0);
    var wL = box(1.3, 0.08, 0.55, opts.wing, -0.65, 0, 0); wingL.add(wL);
    var wingR = new THREE.Group(); wingR.position.set(0.3, 0.15, 0);
    var wR = box(1.3, 0.08, 0.55, opts.wing, 0.65, 0, 0); wingR.add(wR);
    g.add(wingL); g.add(wingR);
    g.userData.wings = { wingL: wingL, wingR: wingR };
    return g;
  }
  BUILDERS.bird = function (o) {
    var g = flyingCreature(o, { body: 0xe8eef7, wing: 0x9db8d9, beak: 0xff8a2a });
    g.scale.setScalar(1.1);
    return g;
  };
  BUILDERS.bat = function (o) {
    var g = flyingCreature(o, { body: 0x2a2030, wing: 0x1a1220, beak: 0x2a2030 });
    g.add(sphere(0.1, 0xd83a2a, -0.12, 0.3, 0.62, { emissive: 0x881111 }));
    g.add(sphere(0.1, 0xd83a2a, 0.12, 0.3, 0.62, { emissive: 0x881111 }));
    g.scale.setScalar(1.2);
    return g;
  };

  BUILDERS.villager_blue = function (o) { return humanoid(o, { cloth: 0x2a4a6a, skin: 0xf2c89b, hair: 0x2a2018, pants: 0x2c3a58 }); };
  BUILDERS.villager_red = function (o) { return humanoid(o, { cloth: 0x8a2f26, skin: 0xe8b88a, hair: 0x1a1a1a, pants: 0x3a2a20 }); };
  BUILDERS.villager_yellow = function (o) { return humanoid(o, { cloth: 0xc9a94f, skin: 0xf2c89b, hair: 0x4a3220, pants: 0x5a4a2a }); };

  BUILDERS.wolf = function (o) {
    /* sói — thân 4 chân, đầu + tai nhọn + đuôi */
    var g = new THREE.Group();
    var body = box(1.5, 0.7, 0.6, 0x5a5a64, 0, 0.95, 0); g.add(body);
    g.add(sphere(0.42, 0x5a5a64, 0.85, 1.2, 0));
    g.add(cone(0.16, 0.4, 0x3a3a44, 0.7, 1.6, -0.2, 4));
    g.add(cone(0.16, 0.4, 0x3a3a44, 0.7, 1.6, 0.2, 4));
    var snout = box(0.45, 0.25, 0.3, 0x3a3a44, 1.3, 1.1, 0); g.add(snout);
    g.add(sphere(0.09, 0xd83a2a, 1.05, 1.35, -0.16, { emissive: 0x881111 }));
    g.add(sphere(0.09, 0xd83a2a, 1.05, 1.35, 0.16, { emissive: 0x881111 }));
    [[-0.55, -0.22], [-0.55, 0.22], [0.55, -0.22], [0.55, 0.22]].forEach(function (p) {
      g.add(box(0.18, 0.7, 0.18, 0x3a3a44, p[0], 0.35, p[1]));
    });
    var tail = box(0.7, 0.18, 0.18, 0x3a3a44, -1.0, 1.15, 0);
    tail.rotation.z = 0.6; g.add(tail);
    return g;
  };

  BUILDERS.chest = function (o) {
    /* rương kho báu — hộp gỗ + nắp vòm + viền vàng + khoá */
    var g = new THREE.Group();
    g.add(box(1.6, 0.9, 1.0, 0x6b4a2a, 0, 0.45, 0));
    var lid = cyl(0.5, 0.5, 1.6, 0x7d5a34, 0, 0.95, 0, 12);
    lid.rotation.z = Math.PI / 2; lid.scale.set(1, 1, 0.62); g.add(lid);
    g.add(box(1.66, 0.12, 0.2, 0xc9a94f, 0, 0.9, 0));
    g.add(box(0.2, 1.0, 1.06, 0xc9a94f, -0.5, 0.5, 0));
    g.add(box(0.2, 1.0, 1.06, 0xc9a94f, 0.5, 0.5, 0));
    g.add(box(0.3, 0.35, 0.1, 0xffd94d, 0, 0.75, 0.55, { emissive: 0x8a6d1f }));
    return g;
  };

  BUILDERS.coin = function (o) {
    /* xu vàng — đĩa vàng đứng, viền sáng */
    var g = new THREE.Group();
    var c = cyl(0.55, 0.55, 0.12, 0xffd94d, 0, 0.55, 0, 20, { metalness: 0.7, roughness: 0.3, emissive: 0x8a6d1f });
    c.rotation.x = Math.PI / 2; g.add(c);
    g.add(sphere(0.14, 0xfff2cc, 0, 0.55, 0.1, { emissive: 0x8a6d1f }));
    return g;
  };

  BUILDERS.banner = function (o) {
    /* cờ / băng rôn — cột + vải đỏ + huy hiệu vàng */
    var g = new THREE.Group();
    g.add(cyl(0.09, 0.11, 4.2, 0x4a3220, 0, 2.1, 0, 6));
    g.add(box(1.5, 2.2, 0.08, 0x8a2f26, 0.8, 3.0, 0, { doubleSide: true }));
    g.add(box(1.5, 0.25, 0.1, 0xc9a94f, 0.8, 4.0, 0));
    g.add(sphere(0.35, 0xffd94d, 0.8, 3.0, 0.08, { emissive: 0x8a6d1f }));
    return g;
  };

  BUILDERS.stone_steps = function (o) {
    /* bậc đá — 4 bậc thang đá lên đền */
    var g = new THREE.Group();
    for (var i = 0; i < 4; i++) {
      g.add(box(4 - i * 0.4, 0.35, 1.1, 0x8a8a94, 0, 0.18 + i * 0.35, -1.6 + i * 1.1));
    }
    return g;
  };

  BUILDERS.stone_path = function (o) {
    /* đường đá — 5 phiến đá lát nối nhau */
    var g = new THREE.Group();
    for (var i = 0; i < 5; i++) {
      var slab = box(2.0 + (i % 2) * 0.3, 0.14, 1.5, 0x9aa4b5, (i % 2 - 0.5) * 0.3, 0.07, -3.2 + i * 1.6);
      slab.rotation.y = (i % 2 - 0.5) * 0.2;
      g.add(slab);
    }
    return g;
  };

  /* primitives */
  BUILDERS.box = function () { var m = box(1, 1, 1, 0x7a7a94, 0, 0.5, 0); return wrapSingle(m); };
  BUILDERS.sphere = function () { return wrapSingle(sphere(0.6, 0x7a7a94, 0, 0.6, 0)); };
  BUILDERS.cylinder = function () { return wrapSingle(cyl(0.5, 0.5, 1.2, 0x7a7a94, 0, 0.6, 0, 20)); };
  BUILDERS.cone = function () { return wrapSingle(cone(0.6, 1.2, 0x7a7a94, 0, 0.6, 0, 20)); };
  BUILDERS.plane = function () {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat(0x7a7a94, { doubleSide: true }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.02;
    m.castShadow = true; m.receiveShadow = true;
    return wrapSingle(m);
  };
  function wrapSingle(mesh) {
    var g = new THREE.Group();
    g.add(mesh);
    return g;
  }

  /* model placeholder (GLB/FBX chưa load được hoặc từ studio) */
  BUILDERS.model = function (o) {
    var g = new THREE.Group();
    var m = box(1.2, 1.8, 1.2, 0x713bff, 0, 0.9, 0, { transparent: true, opacity: 0.65 });
    g.add(m);
    g.add(box(1.4, 0.15, 1.4, 0x4a2a8a, 0, 0.08, 0));
    return g;
  };

  /* ---------- API ---------- */
  var ASSET_LIST = [
    { type: 'temple', name: 'Đền chính', cat: 'Buildings' },
    { type: 'house', name: 'Nhà dân', cat: 'Buildings' },
    { type: 'gate', name: 'Cổng thành', cat: 'Buildings' },
    { type: 'torii', name: 'Cổng torii', cat: 'Buildings' },
    { type: 'tower', name: 'Tháp canh', cat: 'Buildings' },
    { type: 'bridge', name: 'Cầu gỗ', cat: 'Buildings' },
    { type: 'pine', name: 'Thông tuyết', cat: 'Vegetation' },
    { type: 'bamboo', name: 'Trúc', cat: 'Vegetation' },
    { type: 'rock', name: 'Đá', cat: 'Vegetation' },
    { type: 'lantern', name: 'Đèn lồng', cat: 'Props' },
    { type: 'campfire', name: 'Lửa trại', cat: 'Props' },
    { type: 'statue', name: 'Tượng đá', cat: 'Props' },
    { type: 'well', name: 'Giếng đá', cat: 'Props' },
    { type: 'fence', name: 'Hàng rào', cat: 'Props' },
    { type: 'portal', name: 'Cổng dungeon', cat: 'Props' },
    { type: 'waterfall', name: 'Thác nước', cat: 'Environment' },
    { type: 'hero', name: 'Nhân vật chính', cat: 'Characters' },
    { type: 'monster', name: 'Quái', cat: 'Characters' },
    { type: 'boss', name: 'Boss Long Ngâm', cat: 'Characters' },
    { type: 'light', name: 'Đèn điểm', cat: 'Lighting' },
    { type: 'patrol', name: 'Đường patrol', cat: 'Environment' },
    { type: 'box', name: 'Hộp', cat: 'Primitives' },
    { type: 'sphere', name: 'Cầu', cat: 'Primitives' },
    { type: 'cylinder', name: 'Trụ', cat: 'Primitives' },
    /* --- prefab mới đợt mở rộng viewport (2026-11-24): 35 loại --- */
    { type: 'pagoda', name: 'Chùa 3 tầng', cat: 'Buildings' },
    { type: 'torii_big', name: 'Cổng torii lớn', cat: 'Buildings' },
    { type: 'house_tile', name: 'Nhà mái ngói', cat: 'Buildings' },
    { type: 'house_thatch', name: 'Nhà mái rơm', cat: 'Buildings' },
    { type: 'house_flat', name: 'Nhà mái bằng', cat: 'Buildings' },
    { type: 'stall', name: 'Quầy hàng chợ', cat: 'Buildings' },
    { type: 'pine_snow', name: 'Thông tuyết dày', cat: 'Vegetation' },
    { type: 'pine_tall', name: 'Thông cao', cat: 'Vegetation' },
    { type: 'pine_short', name: 'Thông lùn', cat: 'Vegetation' },
    { type: 'sakura', name: 'Hoa anh đào', cat: 'Vegetation' },
    { type: 'mushroom', name: 'Nấm', cat: 'Vegetation' },
    { type: 'lantern_red', name: 'Đèn lồng đỏ', cat: 'Props' },
    { type: 'lantern_yellow', name: 'Đèn lồng vàng', cat: 'Props' },
    { type: 'lantern_blue', name: 'Đèn lồng xanh', cat: 'Props' },
    { type: 'bridge_arch', name: 'Cầu gỗ cong', cat: 'Props' },
    { type: 'well_stone', name: 'Giếng đá có mái', cat: 'Props' },
    { type: 'fence_wood', name: 'Hàng rào gỗ dài', cat: 'Props' },
    { type: 'statue_dragon', name: 'Tượng rồng', cat: 'Props' },
    { type: 'crystal_red', name: 'Tinh thể đỏ', cat: 'Props' },
    { type: 'crystal_blue', name: 'Tinh thể xanh', cat: 'Props' },
    { type: 'crystal_purple', name: 'Tinh thể tím', cat: 'Props' },
    { type: 'stone_stove', name: 'Bếp lửa đá', cat: 'Props' },
    { type: 'stream', name: 'Suối', cat: 'Props' },
    { type: 'cloud', name: 'Mây bay', cat: 'Props' },
    { type: 'chest', name: 'Rương kho báu', cat: 'Props' },
    { type: 'coin', name: 'Xu vàng', cat: 'Props' },
    { type: 'banner', name: 'Cờ / băng rôn', cat: 'Props' },
    { type: 'stone_steps', name: 'Bậc đá', cat: 'Props' },
    { type: 'stone_path', name: 'Đường đá', cat: 'Props' },
    { type: 'bird', name: 'Chim bay', cat: 'Characters' },
    { type: 'bat', name: 'Dơi', cat: 'Characters' },
    { type: 'wolf', name: 'Sói', cat: 'Characters' },
    { type: 'villager_blue', name: 'Dân làng áo xanh', cat: 'Characters' },
    { type: 'villager_red', name: 'Dân làng áo đỏ', cat: 'Characters' },
    { type: 'villager_yellow', name: 'Dân làng áo vàng', cat: 'Characters' }
  ];

  /* danh sách 35 prefab mới (để test đếm + AssetManager/thumbnail kiểm tra đủ) */
  var NEW_TYPES = ['pagoda', 'torii_big', 'house_tile', 'house_thatch', 'house_flat', 'stall',
    'pine_snow', 'pine_tall', 'pine_short', 'sakura', 'mushroom',
    'lantern_red', 'lantern_yellow', 'lantern_blue', 'bridge_arch', 'well_stone',
    'fence_wood', 'statue_dragon', 'crystal_red', 'crystal_blue', 'crystal_purple',
    'stone_stove', 'stream', 'cloud', 'chest', 'coin', 'banner', 'stone_steps', 'stone_path',
    'bird', 'bat', 'wolf', 'villager_blue', 'villager_red', 'villager_yellow'];

  function buildPrefab(dataObj) {
    var fn = BUILDERS[dataObj.type] || BUILDERS.box;
    var g = fn(dataObj);
    g.name = dataObj.name || dataObj.type;
    g.position.fromArray(dataObj.position || [0, 0, 0]);
    g.rotation.fromArray(dataObj.rotation || [0, 0, 0]);
    g.scale.fromArray(dataObj.scale || [1, 1, 1]);
    g.visible = dataObj.visible !== false;
    g.userData.mapId = dataObj.id;
    g.userData.mapType = dataObj.type;
    g.userData.mapName = dataObj.name;
    /* material override (màu tuỳ chỉnh từ Inspector) */
    if (dataObj.color !== null && dataObj.color !== undefined) {
      g.traverse(function (child) {
        if (child.isMesh && child.material && child.material.color) {
          child.material = child.material.clone();
          child.material.color.setHex(dataObj.color);
        }
      });
    }
    if (dataObj.material) {
      g.traverse(function (child) {
        if (child.isMesh && child.material && child.material.isMeshStandardMaterial) {
          /* material đang dùng chung qua cache → clone trước khi sửa riêng */
          child.material = child.material.clone();
          if (dataObj.material.roughness !== undefined) child.material.roughness = dataObj.material.roughness;
          if (dataObj.material.metalness !== undefined) child.material.metalness = dataObj.material.metalness;
          if (dataObj.material.opacity !== undefined) {
            child.material.transparent = dataObj.material.opacity < 1;
            child.material.opacity = dataObj.material.opacity;
          }
        }
      });
    }
    /* light override */
    if (dataObj.light && g.userData.pointLight) {
      var pl = g.userData.pointLight;
      pl.color.setHex(dataObj.light.color !== undefined ? dataObj.light.color : 0xfff2cc);
      pl.intensity = dataObj.light.intensity !== undefined ? dataObj.light.intensity : 1;
      pl.distance = dataObj.light.distance || 18;
    } else if (dataObj.light) {
      var pl2 = new THREE.PointLight(
        dataObj.light.color !== undefined ? dataObj.light.color : 0xffb347,
        dataObj.light.intensity !== undefined ? dataObj.light.intensity : 0.8,
        dataObj.light.distance || 16);
      pl2.position.set(0, 3, 0);
      g.add(pl2);
      g.userData.pointLight = pl2;
    }
    /* collider: vẽ khung debug khi bật (lưu trong userData, viewport vẽ) */
    g.userData.collider = dataObj.collider || null;
    g.userData.mapData = dataObj;
    return g;
  }

  /* hero animation procedural (Idle/Walk/Run) — dùng cho Play mode + preview */
  function animateHero(group, anim, t) {
    var limbs = group.userData.limbs;
    if (!limbs) return;
    if (anim === 'Walk' || anim === 'Run') {
      var sp = anim === 'Run' ? 9 : 5;
      var amp = anim === 'Run' ? 0.7 : 0.45;
      limbs.legL.rotation.x = Math.sin(t * sp) * amp;
      limbs.legR.rotation.x = -Math.sin(t * sp) * amp;
      limbs.armL.rotation.x = -Math.sin(t * sp) * amp * 0.8;
      limbs.armR.rotation.x = Math.sin(t * sp) * amp * 0.8;
      limbs.body.position.y = Math.abs(Math.sin(t * sp)) * 0.08;
    } else { /* Idle: thở */
      var b = Math.sin(t * 2) * 0.02;
      limbs.body.position.y = b;
      limbs.body.rotation.y = Math.sin(t * 0.7) * 0.05;
      limbs.armL.rotation.z = 0.08 + Math.sin(t * 2) * 0.02;
      limbs.armR.rotation.z = -0.08 - Math.sin(t * 2) * 0.02;
    }
  }

  /* chim/dơi bay: đập cánh + bay lượn nhẹ quanh độ cao gốc (gọi từ updatePlay) */
  function animateFlying(group, t) {
    var wings = group.userData.wings;
    if (!wings) return;
    var flap = Math.sin(t * 10 + group.position.x) * 0.65;
    wings.wingL.rotation.z = flap;
    wings.wingR.rotation.z = -flap;
    if (group.userData.baseY === undefined) group.userData.baseY = group.position.y;
    group.position.y = group.userData.baseY + Math.sin(t * 2 + group.position.z) * 0.35;
  }

  ME.Placement = {
    BUILDERS: BUILDERS, ASSET_LIST: ASSET_LIST, NEW_TYPES: NEW_TYPES,
    buildPrefab: buildPrefab, animateHero: animateHero, animateFlying: animateFlying,
    mat: mat, box: box, cone: cone, cyl: cyl, sphere: sphere
  };
})();
