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

  function mat(color, opts) {
    opts = opts || {};
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: opts.roughness !== undefined ? opts.roughness : 0.85,
      metalness: opts.metalness || 0,
      transparent: !!opts.transparent,
      opacity: opts.opacity !== undefined ? opts.opacity : 1,
      emissive: opts.emissive || 0x000000,
      emissiveIntensity: opts.emissiveIntensity !== undefined ? opts.emissiveIntensity : 1,
      side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide
    });
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
    { type: 'bridge', name: 'Cầu gỗ', cat: 'Buildings' },
    { type: 'pine', name: 'Thông tuyết', cat: 'Vegetation' },
    { type: 'bamboo', name: 'Trúc', cat: 'Vegetation' },
    { type: 'rock', name: 'Đá', cat: 'Vegetation' },
    { type: 'lantern', name: 'Đèn lồng', cat: 'Props' },
    { type: 'campfire', name: 'Lửa trại', cat: 'Props' },
    { type: 'statue', name: 'Tượng đá', cat: 'Props' },
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
    { type: 'cylinder', name: 'Trụ', cat: 'Primitives' }
  ];

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

  ME.Placement = {
    BUILDERS: BUILDERS, ASSET_LIST: ASSET_LIST,
    buildPrefab: buildPrefab, animateHero: animateHero,
    mat: mat, box: box, cone: cone, cyl: cyl, sphere: sphere
  };
})();
