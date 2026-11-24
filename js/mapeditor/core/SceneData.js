/* ============================================================
 * mapeditor/core/SceneData.js — Model dữ liệu map + templates
 * Định dạng scene của MapEditor (mapeditor-scene-1) và chuyển đổi
 * sang/đi từ định dạng chia sẻ 2 chiều pixistudio-shared-scene-1
 * (xem docs/MAP_EDITOR.md §3 — format là hợp đồng giữa MapEditor
 * và Studio; js/core/map-link.js implement cùng format).
 * Vanilla JS, không phụ thuộc DOM. THREE chỉ cần khi build mesh
 * (qua Placement.buildPrefab, gọi lúc deserialize).
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  /* ---------- tiện ích ---------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function vnoise(x, z) {
    /* value noise 2D xác định (không dùng Math.random) */
    var xi = Math.floor(x), zi = Math.floor(z);
    var xf = x - xi, zf = z - zi;
    function h(ix, iz) {
      var s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
      return s - Math.floor(s);
    }
    function sm(t) { return t * t * (3 - 2 * t); }
    var u = sm(xf), v = sm(zf);
    var a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------- layer sơn terrain ---------- */
  var LAYERS = [
    { id: 'grass', name: 'Cỏ', color: 0x4a7a3a },
    { id: 'snow', name: 'Tuyết', color: 0xe8eef7 },
    { id: 'rock', name: 'Đá', color: 0x8a8a94 },
    { id: 'dirt', name: 'Đất', color: 0x7a5a3a },
    { id: 'sand', name: 'Cát', color: 0xd8c89a },
    { id: 'stone', name: 'Đá phiến', color: 0x9aa4b5 },
    { id: 'water', name: 'Nước', color: 0x3a7ab5 }
  ];
  var LAYER_BY_ID = {};
  LAYERS.forEach(function (l, i) { LAYER_BY_ID[l.id] = i; });

  /* ---------- nhóm hierarchy ---------- */
  var GROUPS = ['Environment', 'Buildings', 'Vegetation', 'Props', 'Characters', 'Lighting', 'Particles', 'Camera'];

  /* ---------- kiểu object + nhóm mặc định ---------- */
  var TYPE_GROUP = {
    temple: 'Buildings', house: 'Buildings', gate: 'Buildings', bridge: 'Buildings',
    torii: 'Buildings', tower: 'Buildings',
    pagoda: 'Buildings', torii_big: 'Buildings',
    house_tile: 'Buildings', house_thatch: 'Buildings', house_flat: 'Buildings', stall: 'Buildings',
    pine: 'Vegetation', bamboo: 'Vegetation', rock: 'Vegetation',
    pine_snow: 'Vegetation', pine_tall: 'Vegetation', pine_short: 'Vegetation',
    sakura: 'Vegetation', mushroom: 'Vegetation',
    lantern: 'Props', campfire: 'Props', statue: 'Props', fence: 'Props', portal: 'Props',
    well: 'Props',
    lantern_red: 'Props', lantern_yellow: 'Props', lantern_blue: 'Props',
    bridge_arch: 'Props', well_stone: 'Props', fence_wood: 'Props', statue_dragon: 'Props',
    crystal_red: 'Props', crystal_blue: 'Props', crystal_purple: 'Props',
    stone_stove: 'Props', stream: 'Props', cloud: 'Props',
    chest: 'Props', coin: 'Props', banner: 'Props', stone_steps: 'Props', stone_path: 'Props',
    hero: 'Characters', monster: 'Characters', boss: 'Characters',
    bird: 'Characters', bat: 'Characters', wolf: 'Characters',
    villager_blue: 'Characters', villager_red: 'Characters', villager_yellow: 'Characters',
    light: 'Lighting', patrol: 'Environment', waterfall: 'Environment',
    box: 'Props', sphere: 'Props', cylinder: 'Props', cone: 'Props', plane: 'Props',
    model: 'Characters'
  };
  var PRIMITIVE_TYPES = ['box', 'sphere', 'cylinder', 'cone', 'plane'];

  var _idCounter = 0;
  function newId(prefix) {
    _idCounter++;
    return (prefix || 'me') + '_' + Date.now().toString(36) + '_' + (_idCounter) + '_' + Math.floor(Math.random() * 1296).toString(36);
  }

  /* ---------- terrain mặc định (Trường Bạch) ---------- */
  function defaultHeights(size, segments) {
    var n = segments + 1;
    var heights = new Float32Array(n * n);
    var half = size / 2;
    for (var j = 0; j < n; j++) {
      for (var i = 0; i < n; i++) {
        var x = -half + (i / segments) * size;
        var z = -half + (j / segments) * size;
        var h = 0;
        /* đồi lượn */
        h += (vnoise(x * 0.045 + 7.3, z * 0.045 + 2.1) - 0.5) * 2.4;
        h += (vnoise(x * 0.13 + 1.7, z * 0.13 + 8.4) - 0.5) * 0.9;
        /* vành núi quanh mép map */
        var d = Math.max(Math.abs(x), Math.abs(z)) / half;
        if (d > 0.72) h += (d - 0.72) * 46;
        /* mặt bằng đền (0,-45) */
        var dt = Math.sqrt(x * x + (z + 45) * (z + 45));
        if (dt < 12) h = lerp(2.6, h, clamp((dt - 6) / 6, 0, 1));
        /* quảng trường trung tâm */
        var dc = Math.sqrt(x * x + z * z);
        if (dc < 10) h = lerp(0.4, h, clamp((dc - 5) / 5, 0, 1));
        /* hồ băng (30,28): trũng xuống */
        var dl = Math.sqrt((x - 30) * (x - 30) + (z - 28) * (z - 28));
        if (dl < 11) h = lerp(-1.0, h, clamp((dl - 6) / 5, 0, 1));
        heights[j * n + i] = h;
      }
    }
    return heights;
  }

  function defaultPaint(size, segments, heights) {
    var n = segments + 1;
    var paint = new Uint8Array(n * n);
    var half = size / 2;
    for (var j = 0; j < n; j++) {
      for (var i = 0; i < n; i++) {
        var x = -half + (i / segments) * size;
        var z = -half + (j / segments) * size;
        var h = heights[j * n + i];
        /* đường đất giữa cổng → đền */
        var road = Math.abs(x) < 3 && z > -46 && z < 34;
        var idx;
        if (h < -0.2) idx = LAYER_BY_ID.water;
        else if (road) idx = LAYER_BY_ID.dirt;
        else if (h > 6) idx = LAYER_BY_ID.rock;
        else if (h > 2.2) idx = LAYER_BY_ID.snow;
        else if (h > 1.2) idx = LAYER_BY_ID.grass;
        else idx = (vnoise(x * 0.2, z * 0.2) > 0.55) ? LAYER_BY_ID.snow : LAYER_BY_ID.grass;
        /* tuyết phủ nhẹ trên cao */
        if (h > 3.2 && vnoise(x * 0.3 + 9, z * 0.3) > 0.45) idx = LAYER_BY_ID.snow;
        paint[j * n + i] = idx;
      }
    }
    return paint;
  }

  /* ---------- object mặc định (toạ độ world, map 112x112) ---------- */
  function defaultObjects() {
    var objs = [];
    var rnd = mulberry32(20261124);
    function add(type, name, x, z, opts) {
      opts = opts || {};
      objs.push({
        id: newId('obj'), type: type, name: name,
        group: opts.group || TYPE_GROUP[type] || 'Props',
        position: [x, opts.y !== undefined ? opts.y : 0, z],
        rotation: [0, opts.ry || 0, 0],
        scale: [opts.s || 1, opts.s || 1, opts.s || 1],
        color: opts.color !== undefined ? opts.color : null,
        material: opts.material || null,
        collider: opts.collider || null,
        light: opts.light || null,
        path: opts.path || null,
        anim: opts.anim || null,
        url: opts.url || null,
        placeholder: !!opts.placeholder,
        locked: false, visible: true
      });
    }
    /* Buildings */
    add('temple', 'Temple_Main', 0, -45, { collider: { shape: 'box', size: [15, 8, 8] }, light: { color: 0xffb347, intensity: 0.9, distance: 26 } });
    add('gate', 'Castle_Gate', 0, 33.6, { collider: { shape: 'box', size: [15, 8, 2] } });
    add('statue', 'Statue_KiemHiep', 0, -36, { collider: { shape: 'box', size: [3, 3, 3] } });
    var houses = [[-24, -24], [16, -28], [-28, 12], [24, 16], [-16, -12], [20, -12], [36, -20]];
    houses.forEach(function (p, i) {
      add('house', 'Village_House_0' + (i + 1), p[0], p[1], { ry: (rnd() - 0.5) * 0.6, collider: { shape: 'box', size: [7, 4, 5] } });
    });
    /* Vegetation: thông */
    var pineSpots = [];
    var tries = 0;
    while (pineSpots.length < 42 && tries++ < 400) {
      var x = -52 + rnd() * 104, z = -52 + rnd() * 104;
      if (Math.abs(x) < 12 && z > -50 && z < 38) continue; /* tránh đường chính */
      if (Math.sqrt(x * x + (z + 45) * (z + 45)) < 12) continue; /* tránh đền */
      if (Math.sqrt(x * x + z * z) < 9) continue; /* tránh quảng trường */
      if (Math.sqrt((x - 30) * (x - 30) + (z - 28) * (z - 28)) < 12) continue; /* tránh hồ */
      pineSpots.push([x, z]);
    }
    pineSpots.forEach(function (p, i) {
      add('pine', 'Pine_Tree_' + (i < 9 ? '0' + (i + 1) : (i + 1)), p[0], p[1], { s: 0.8 + rnd() * 0.55, ry: rnd() * Math.PI * 2 });
    });
    /* Đá */
    for (var r = 0; r < 14; r++) {
      add('rock', 'Rock_' + (r + 1), -50 + rnd() * 100, -50 + rnd() * 100, { s: 0.6 + rnd() * 1.1, ry: rnd() * Math.PI * 2 });
    }
    /* Props */
    add('bridge', 'Bridge_Wood', 0, 21, { collider: { shape: 'box', size: [4, 1, 10] } });
    add('waterfall', 'Waterfall', -46, 18, { group: 'Environment' });
    var lanterns = [[-8, -4], [8, -4], [-8, 8], [8, 8], [-4, -33], [4, -33], [-4, 28], [4, 28], [28, 0], [-28, 0]];
    lanterns.forEach(function (p, i) {
      add('lantern', 'Lantern_0' + (i + 1), p[0], p[1], { light: { color: 0xff5a3c, intensity: 0.5, distance: 10 } });
    });
    var fires = [[-20, 28], [28, 28], [-24, 4]];
    fires.forEach(function (p, i) {
      add('campfire', 'Campfire_0' + (i + 1), p[0], p[1], { light: { color: 0xff8a2a, intensity: 0.9, distance: 12 } });
    });
    add('portal', 'Dungeon_Entrance', 44, 4, { collider: { shape: 'box', size: [6, 5, 1] }, light: { color: 0x9d4edd, intensity: 1.2, distance: 18 } });
    /* --- MỞ RỘNG (2026-11-24): làng + rừng + chợ + sinh vật mới, map 91 → ~178 object.
     * Vị trí random dùng chung rnd() mulberry32(20261124) nên map mặc định
     * vẫn xác định (deterministic) mỗi lần load. --- */
    add('pagoda', 'Pagoda_BaTang', -38, -38, { collider: { shape: 'box', size: [9, 10, 9] } });
    add('torii_big', 'Torii_Lon', 0, -20, { collider: { shape: 'box', size: [13, 11, 2] } });
    add('statue_dragon', 'Statue_Dragon', 12, -38, { collider: { shape: 'box', size: [4, 5, 4] } });
    /* làng mới: 3 kiểu nhà */
    add('house_tile', 'Village_TileHouse_1', -32, 4, { ry: 0.3, collider: { shape: 'box', size: [7, 4, 5] } });
    add('house_tile', 'Village_TileHouse_2', 30, -8, { ry: -0.4, collider: { shape: 'box', size: [7, 4, 5] } });
    add('house_thatch', 'Village_ThatchHouse_1', -12, 24, { ry: 0.2, collider: { shape: 'box', size: [6, 4, 5] } });
    add('house_thatch', 'Village_ThatchHouse_2', 34, 24, { ry: -0.3, collider: { shape: 'box', size: [6, 4, 5] } });
    add('house_flat', 'Village_FlatHouse_1', -36, -8, { ry: 0.5, collider: { shape: 'box', size: [7, 4, 5] } });
    add('house_flat', 'Village_FlatHouse_2', 12, 28, { ry: -0.2, collider: { shape: 'box', size: [7, 4, 5] } });
    /* chợ */
    [[-6, 14], [6, 14], [-10, 18], [10, 18]].forEach(function (p, i) {
      add('stall', 'Market_Stall_0' + (i + 1), p[0], p[1], { ry: (rnd() - 0.5) * 0.5, collider: { shape: 'box', size: [3, 2, 2] } });
    });
    add('well_stone', 'Village_Well', -18, 18, { collider: { shape: 'box', size: [3, 2, 3] } });
    /* hàng rào quanh làng */
    [[-22, 8], [-22, 14], [26, 8], [26, 14]].forEach(function (p, i) {
      add('fence_wood', 'Village_Fence_0' + (i + 1), p[0], p[1], { ry: i < 2 ? 0 : Math.PI / 2 });
    });
    /* đèn lồng 3 màu */
    [[-14, -2, 'lantern_yellow'], [14, -2, 'lantern_yellow'], [-14, 26, 'lantern_yellow'],
     [-6, -14, 'lantern_red'], [6, -14, 'lantern_red'], [-20, -18, 'lantern_red'],
     [-28, 20, 'lantern_blue'], [28, 20, 'lantern_blue']].forEach(function (p, i) {
      add(p[2], 'Lantern_New_0' + (i + 1), p[0], p[1], { light: { color: 0xffb347, intensity: 0.5, distance: 10 } });
    });
    /* rừng mới: thông tuyết / cao / lùn — tránh đường chính, đền, quảng trường, hồ */
    function forestSpot() {
      var x, z, ok = false, t = 0;
      while (!ok && t++ < 100) {
        x = -52 + rnd() * 104; z = -52 + rnd() * 104;
        ok = !(Math.abs(x) < 12 && z > -50 && z < 38) &&
          Math.sqrt(x * x + (z + 45) * (z + 45)) >= 12 &&
          Math.sqrt(x * x + z * z) >= 9 &&
          Math.sqrt((x - 30) * (x - 30) + (z - 28) * (z - 28)) >= 12;
      }
      return [x, z];
    }
    var pineNew = [];
    for (var ps = 0; ps < 5; ps++) pineNew.push(['pine_snow', forestSpot()]);
    for (var pt = 0; pt < 5; pt++) pineNew.push(['pine_tall', forestSpot()]);
    for (var ph = 0; ph < 4; ph++) pineNew.push(['pine_short', forestSpot()]);
    pineNew.forEach(function (p, i) {
      add(p[0], 'PineNew_' + (i + 1), p[1][0], p[1][1], { s: 0.8 + rnd() * 0.55, ry: rnd() * Math.PI * 2 });
    });
    /* anh đào + nấm rải quanh rừng */
    for (var sk = 0; sk < 4; sk++) { var s1 = forestSpot(); add('sakura', 'Sakura_' + (sk + 1), s1[0], s1[1], { s: 0.9 + rnd() * 0.4, ry: rnd() * Math.PI * 2 }); }
    for (var mu = 0; mu < 4; mu++) { var s2 = forestSpot(); add('mushroom', 'Mushroom_' + (mu + 1), s2[0], s2[1], { s: 0.8 + rnd() * 0.7, ry: rnd() * Math.PI * 2 }); }
    /* tinh thể 3 màu gần hồ băng */
    add('crystal_red', 'Crystal_Red', 24, 34, {});
    add('crystal_blue', 'Crystal_Blue', 36, 30, {});
    add('crystal_purple', 'Crystal_Purple', 30, 40, {});
    /* bếp đá + suối + mây + chim + dơi + sói */
    add('stone_stove', 'StoneStove_1', -16, 30, { light: { color: 0xff8a2a, intensity: 0.8, distance: 10 } });
    add('stone_stove', 'StoneStove_2', 20, -20, { light: { color: 0xff8a2a, intensity: 0.8, distance: 10 } });
    add('stream', 'Stream_1', -44, -8, { ry: 0.4 });
    add('bridge_arch', 'Bridge_Arch_1', -44, 26, { ry: 0.4, collider: { shape: 'box', size: [4, 1, 10] } });
    add('cloud', 'Cloud_1', -20, -30, { y: 18 });
    add('cloud', 'Cloud_2', 10, 10, { y: 20 });
    add('cloud', 'Cloud_3', 30, -20, { y: 17 });
    add('bird', 'Bird_1', -10, -10, { y: 12, anim: 'Idle' });
    add('bird', 'Bird_2', 15, 5, { y: 14, anim: 'Idle' });
    add('bird', 'Bird_3', -25, 15, { y: 11, anim: 'Idle' });
    add('bat', 'Bat_1', 40, -2, { y: 8, anim: 'Idle' });
    add('bat', 'Bat_2', 44, 12, { y: 9, anim: 'Idle' });
    add('wolf', 'Wolf_1', -40, -20, { anim: 'Idle' });
    add('wolf', 'Wolf_2', -42, 30, { anim: 'Idle' });
    add('wolf', 'Wolf_3', 40, -30, { anim: 'Idle' });
    /* dân làng 3 kiểu áo */
    add('villager_blue', 'Villager_Blue_1', -8, 16, { anim: 'Idle' });
    add('villager_blue', 'Villager_Blue_2', 8, 20, { anim: 'Idle' });
    add('villager_red', 'Villager_Red_1', -4, 12, { anim: 'Idle' });
    add('villager_red', 'Villager_Red_2', 14, 16, { anim: 'Idle' });
    add('villager_yellow', 'Villager_Yellow_1', -14, 12, { anim: 'Idle' });
    add('villager_yellow', 'Villager_Yellow_2', 4, 24, { anim: 'Idle' });
    /* rương + xu + cờ + bậc đá + đường đá */
    add('chest', 'TreasureChest_1', -30, -36, {});
    add('chest', 'TreasureChest_2', 42, -12, {});
    [[-2, 4], [2, 6], [-4, 20], [8, 10]].forEach(function (p, i) {
      add('coin', 'GoldCoin_0' + (i + 1), p[0], p[1], {});
    });
    [[-10, 30], [10, 30], [-6, -30], [6, -30]].forEach(function (p, i) {
      add('banner', 'Banner_0' + (i + 1), p[0], p[1], { ry: rnd() * Math.PI });
    });
    add('stone_steps', 'StoneSteps_1', 0, -40, {});
    add('stone_steps', 'StoneSteps_2', 0, 30, {});
    add('stone_path', 'StonePath_1', -2, -10, {});
    add('stone_path', 'StonePath_2', 2, -24, {});
    add('stone_path', 'StonePath_3', -2, 6, {});
    add('stone_path', 'StonePath_4', 2, 24, {});
    /* Characters */
    add('hero', 'Hero_Character', 0, 0, { anim: 'Idle' });
    add('boss', 'Boss_LongNgam', 38, 8, { anim: 'Idle' });
    var monsters = [[-30, -30], [30, -34], [-36, 22], [24, 34]];
    monsters.forEach(function (p, i) {
      add('monster', 'Monster_0' + (i + 1), p[0], p[1], { anim: 'Idle' });
    });
    /* Patrol paths */
    add('patrol', 'AI_Patrol_Path', 0, 0, {
      group: 'Environment',
      path: [[-8, -8], [8, -8], [8, 8], [-8, 8]]
    });
    add('patrol', 'AI_Patrol_Path_Gate', 0, 28, {
      group: 'Environment',
      path: [[-4, 24], [4, 24], [4, 32], [-4, 32]]
    });
    /* Lights */
    add('light', 'Sun_Directional', 40, 20, { group: 'Lighting', light: { color: 0xfff2cc, intensity: 1.05, distance: 0 } });
    return objs;
  }

  /* ---------- templates ---------- */
  function newSceneData(name, template) {
    var size = 112, segments = 64;
    var heights = defaultHeights(size, segments);
    var paint = defaultPaint(size, segments, heights);
    var data = {
      format: 'mapeditor-scene-1',
      name: name || 'Truong Bach',
      version: '1.0',
      savedAt: new Date().toISOString(),
      template: template || 'snow',
      terrain: {
        size: size, segments: segments,
        heights: Array.from(heights),
        paint: Array.from(paint)
      },
      environment: {
        weather: template === 'dungeon' ? 'night' : 'snow',
        sky: template === 'dungeon' ? 0x0a0a14 : (template === 'bamboo' ? 0xa8c8a0 : 0x9db8d9),
        fog: { color: template === 'dungeon' ? 0x0a0a14 : 0x9db8d9, near: 60, far: 180 },
        sun: { color: 0xfff2cc, intensity: template === 'dungeon' ? 0.4 : 1.05 },
        timeOfDay: 10,
        snow: template !== 'dungeon'
      },
      objects: []
    };
    if (template === 'bamboo') {
      /* rừng trúc: giữ layout nhà/đền, đổi thông → trúc, tuyết → cỏ */
      data.objects = defaultObjects().map(function (o) {
        if (o.type === 'pine') { o.type = 'bamboo'; o.name = o.name.replace('Pine_Tree', 'Bamboo'); }
        if (o.type === 'temple') o.name = 'Temple_Bamboo';
        return o;
      });
      var n = segments + 1;
      for (var i = 0; i < paint.length; i++) {
        if (paint[i] === LAYER_BY_ID.snow) paint[i] = LAYER_BY_ID.grass;
        if (paint[i] === LAYER_BY_ID.water) paint[i] = LAYER_BY_ID.grass;
      }
      data.terrain.paint = Array.from(paint);
    } else if (template === 'dungeon') {
      data.objects = defaultObjects().filter(function (o) {
        return ['portal', 'statue', 'rock', 'campfire', 'boss', 'monster', 'patrol', 'light'].indexOf(o.type) >= 0;
      });
      data.objects.push({
        id: newId('obj'), type: 'temple', name: 'Dungeon_Hall', group: 'Buildings',
        position: [0, 0, -45], rotation: [0, 0, 0], scale: [1.2, 1, 1.2],
        color: 0x3a3a44, material: null, collider: { shape: 'box', size: [15, 8, 8] },
        light: null, path: null, anim: null, url: null, placeholder: false, locked: false, visible: true
      });
      var m = segments + 1;
      for (var k = 0; k < paint.length; k++) paint[k] = LAYER_BY_ID.stone;
      data.terrain.paint = Array.from(paint);
      /* san phẳng dungeon */
      for (var q = 0; q < heights.length; q++) heights[q] = Math.min(heights[q], 1.2);
      data.terrain.heights = Array.from(heights);
    } else {
      data.objects = defaultObjects();
    }
    return data;
  }

  /* ---------- serialize / validate ---------- */
  function cloneData(data) {
    return JSON.parse(JSON.stringify(data));
  }

  function validate(data) {
    var errs = [];
    if (!data || typeof data !== 'object') return ['scene không phải object'];
    if (!data.terrain || !Array.isArray(data.terrain.heights)) errs.push('thiếu terrain.heights');
    if (data.terrain && data.terrain.segments !== undefined) {
      var n = (data.terrain.segments + 1) * (data.terrain.segments + 1);
      if (data.terrain.heights && data.terrain.heights.length !== n) errs.push('heights sai độ dài (cần ' + n + ')');
      if (data.terrain.paint && data.terrain.paint.length !== n) errs.push('paint sai độ dài (cần ' + n + ')');
    }
    if (!Array.isArray(data.objects)) errs.push('thiếu objects');
    (data.objects || []).forEach(function (o, i) {
      if (!o.id) errs.push('object[' + i + '] thiếu id');
      if (!o.type) errs.push('object[' + i + '] thiếu type');
      if (!Array.isArray(o.position) || o.position.length !== 3) errs.push('object[' + i + '] position sai');
    });
    return errs;
  }

  /* ---------- chuyển đổi sang format chia sẻ ---------- */
  function toShared(data, source) {
    var shared = {
      format: 'pixistudio-shared-scene-1',
      name: data.name || 'Untitled Map',
      version: data.version || '1.0',
      savedAt: new Date().toISOString(),
      source: source || 'mapeditor',
      map: {
        terrain: data.terrain ? {
          size: data.terrain.size,
          segments: data.terrain.segments,
          heights: data.terrain.heights.slice(),
          paint: data.terrain.paint ? data.terrain.paint.slice() : null,
          waterLevel: (data.terrain.waterLevel !== undefined && data.terrain.waterLevel !== null) ? data.terrain.waterLevel : null
        } : null,
        environment: data.environment ? JSON.parse(JSON.stringify(data.environment)) : null,
        objects: (data.objects || []).map(function (o) {
          return {
            id: o.id, type: o.type, name: o.name, group: o.group,
            position: o.position.slice(), rotation: o.rotation.slice(), scale: o.scale.slice(),
            color: o.color, material: o.material ? JSON.parse(JSON.stringify(o.material)) : null,
            collider: o.collider ? JSON.parse(JSON.stringify(o.collider)) : null,
            light: o.light ? JSON.parse(JSON.stringify(o.light)) : null,
            path: o.path ? JSON.parse(JSON.stringify(o.path)) : null,
            anim: o.anim || null, url: o.url || null,
            veloId: o.veloId || null,
            placeholder: !!o.placeholder, locked: !!o.locked, visible: o.visible !== false
          };
        })
      },
      /* studio-compatible: chỉ primitive khôi phục được qua Scene.applySerializedObjects */
      objects: (data.objects || []).filter(function (o) {
        return PRIMITIVE_TYPES.indexOf(o.type) >= 0;
      }).map(function (o) {
        return {
          uuid: o.id, name: o.name, type: 'primitive', locked: !!o.locked, visible: o.visible !== false,
          position: o.position.slice(), rotation: o.rotation.slice(), scale: o.scale.slice(),
          isPrimitive: true, primKind: o.type
        };
      })
    };
    return shared;
  }

  function fromShared(doc) {
    /* trả {data, warnings[]} — không throw với object lạ, chỉ ghi warning */
    var warnings = [];
    if (!doc || doc.format !== 'pixistudio-shared-scene-1') {
      return { data: null, warnings: ['format không phải pixistudio-shared-scene-1'] };
    }
    var map = doc.map || {};
    var data = {
      format: 'mapeditor-scene-1',
      name: doc.name || 'Imported Scene',
      version: '1.0',
      savedAt: new Date().toISOString(),
      template: 'custom',
      terrain: null,
      environment: map.environment || {
        weather: 'snow', sky: 0x9db8d9,
        fog: { color: 0x9db8d9, near: 60, far: 180 },
        sun: { color: 0xfff2cc, intensity: 1.05 },
        timeOfDay: 10, snow: true
      },
      objects: []
    };
    if (map.terrain) {
      data.terrain = {
        size: map.terrain.size || 112,
        segments: map.terrain.segments || 64,
        heights: map.terrain.heights ? map.terrain.heights.slice() : null,
        paint: map.terrain.paint ? map.terrain.paint.slice() : null,
        waterLevel: (map.terrain.waterLevel !== undefined && map.terrain.waterLevel !== null) ? map.terrain.waterLevel : null
      };
      var n = (data.terrain.segments + 1) * (data.terrain.segments + 1);
      if (!data.terrain.heights || data.terrain.heights.length !== n) {
        warnings.push('terrain.heights sai độ dài — dùng terrain phẳng');
        data.terrain.heights = new Array(n).fill(0);
      }
      if (!data.terrain.paint || data.terrain.paint.length !== n) {
        data.terrain.paint = new Array(n).fill(LAYER_BY_ID.grass);
      }
    } else {
      /* studio không có terrain → tạo terrain phẳng */
      var seg = 64, nn = (seg + 1) * (seg + 1);
      data.terrain = { size: 112, segments: seg, heights: new Array(nn).fill(0), paint: new Array(nn).fill(LAYER_BY_ID.grass) };
      warnings.push('không có terrain trong shared doc — tạo terrain phẳng 112x112');
    }
    var known = Object.keys(TYPE_GROUP);
    (map.objects || []).forEach(function (o) {
      if (known.indexOf(o.type) < 0) {
        warnings.push('object lạ "' + (o.name || o.id) + '" type=' + o.type + ' → placeholder box');
        o = JSON.parse(JSON.stringify(o));
        o.type = 'box'; o.placeholder = true;
      } else if (o.placeholder) {
        warnings.push('object "' + (o.name || o.id) + '" là placeholder (model/unknown từ phía gửi)');
      }
      data.objects.push({
        id: o.id || newId('obj'), type: o.type, name: o.name || o.type,
        group: o.group || TYPE_GROUP[o.type] || 'Props',
        position: (o.position || [0, 0, 0]).slice(),
        rotation: (o.rotation || [0, 0, 0]).slice(),
        scale: (o.scale || [1, 1, 1]).slice(),
        color: o.color !== undefined ? o.color : null,
        material: o.material || null,
        collider: o.collider || null,
        light: o.light || null,
        path: o.path || null,
        anim: o.anim || null,
        url: o.url || null,
        veloId: o.veloId || null,
        placeholder: !!o.placeholder,
        locked: !!o.locked, visible: o.visible !== false
      });
    });
    /* studio objects (primitives) chưa có trong map.objects thì thêm vào */
    var haveIds = {};
    data.objects.forEach(function (o) { haveIds[o.id] = true; });
    (doc.objects || []).forEach(function (o) {
      if (o.isPrimitive && o.primKind && !haveIds[o.uuid]) {
        data.objects.push({
          id: o.uuid || newId('obj'), type: o.primKind, name: o.name || o.primKind,
          group: 'Props', position: (o.position || [0, 0, 0]).slice(),
          rotation: (o.rotation || [0, 0, 0]).slice(), scale: (o.scale || [1, 1, 1]).slice(),
          color: null, material: null, collider: null, light: null, path: null,
          anim: null, url: null, placeholder: false, locked: !!o.locked, visible: o.visible !== false
        });
      }
    });
    return { data: data, warnings: warnings };
  }

  /* ---------- studio project → map data (studio không có terrain) ---------- */
  function fromStudioProject(project) {
    var warnings = [];
    var doc = {
      format: 'pixistudio-shared-scene-1',
      name: (project && project.name) || 'Studio Scene',
      version: (project && project.version) || '21.0',
      savedAt: new Date().toISOString(),
      source: 'studio',
      map: {
        terrain: (project && project.map && project.map.terrain) || null,
        environment: (project && project.map && project.map.environment) || null,
        objects: []
      },
      objects: (project && project.objects) || []
    };
    /* map.objects: giữ nguyên nếu project đã có map (round-trip), không thì map từ objects */
    if (project && project.map && Array.isArray(project.map.objects)) {
      doc.map.objects = project.map.objects;
    } else {
      (doc.objects || []).forEach(function (o) {
        var mapped = null;
        if (o.isPrimitive && o.primKind) {
          mapped = {
            id: o.uuid, type: o.primKind, name: o.name, group: 'Props',
            position: o.position, rotation: o.rotation, scale: o.scale,
            color: null, material: null, collider: null, light: null, path: null,
            anim: null, url: null, placeholder: false, locked: !!o.locked, visible: o.visible !== false
          };
        } else if (o.type === 'model') {
          mapped = {
            id: o.uuid, type: 'model', name: o.name, group: 'Characters',
            position: o.position, rotation: o.rotation, scale: o.scale,
            color: null, material: null, collider: null, light: null, path: null,
            anim: null, url: null, placeholder: true, locked: !!o.locked, visible: o.visible !== false
          };
          warnings.push('model "' + o.name + '" → placeholder (studio model không có sẵn trong MapEditor)');
        } else if (o.type === 'light') {
          mapped = {
            id: o.uuid, type: 'light', name: o.name, group: 'Lighting',
            position: o.position, rotation: o.rotation, scale: o.scale,
            color: null, material: null, collider: null,
            light: { color: 0xfff2cc, intensity: 1, distance: 10 },
            path: null, anim: null, url: null, placeholder: false,
            locked: !!o.locked, visible: o.visible !== false
          };
        } else {
          mapped = {
            id: o.uuid, type: 'box', name: o.name || 'Object', group: 'Props',
            position: o.position, rotation: o.rotation, scale: o.scale,
            color: null, material: null, collider: null, light: null, path: null,
            anim: null, url: null, placeholder: true, locked: !!o.locked, visible: o.visible !== false
          };
          warnings.push('object "' + (o.name || o.uuid) + '" type=' + o.type + ' → placeholder box');
        }
        if (mapped) doc.map.objects.push(mapped);
      });
    }
    return { doc: doc, warnings: warnings };
  }

  ME.SceneData = {
    LAYERS: LAYERS, LAYER_BY_ID: LAYER_BY_ID, GROUPS: GROUPS,
    TYPE_GROUP: TYPE_GROUP, PRIMITIVE_TYPES: PRIMITIVE_TYPES,
    newId: newId, newSceneData: newSceneData,
    cloneData: cloneData, validate: validate,
    toShared: toShared, fromShared: fromShared,
    fromStudioProject: fromStudioProject,
    defaultHeights: defaultHeights, defaultPaint: defaultPaint
  };
})();
