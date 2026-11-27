/* ============================================================
 * ai/local-autogen.js — Local Auto Gen (v1.0.0)
 *
 * Tạo model 3D procedural NGAY TRÊN MÁY — không API key, không
 * gọi mạng. Dùng THREE primitive + MeshStandardMaterial
 * (three.js r128, plain script tag).
 *
 * Ngoài generate, module còn có 2 tính năng local (không cloud):
 *   .upscaleModel(target, opts) — subdivide mesh (midpoint, x4
 *     tris/lần) + upscale texture bằng canvas 2D (nội suy
 *     bilinear, KHÔNG tạo thêm chi tiết thật như AI cloud).
 *   .textureModel(target, opts) — gán 1 trong 10 chất liệu
 *     procedural (map + normalMap + roughnessMap vẽ bằng canvas
 *     2D / pixel buffer, họa tiết lặp, KHÔNG vẽ theo hình dạng
 *     model như AI texturing).
 * Canvas 2D dùng đúng pattern js/exporter/save-manager.js
 * (document.createElement('canvas') + drawImage). Môi trường
 * không có canvas 2D (vd jsdom harness) thì dùng DataTexture
 * từ cùng pixel buffer — cùng nội dung pixel, chỉ khác loại
 * texture; trình duyệt thật luôn ra THREE.CanvasTexture.
 *
 * API (giữ nguyên — panel AI gọi đúng các tên này):
 *   PixiStudio.AI.LocalAutoGen.VERSION / TYPES / TYPE_LABELS
 *   .detectType(prompt) -> { type, matched, keyword }
 *   .generate(opts)    -> { group, type, name, seed, meshCount,
 *                           triCount, durationMs }
 *   .generateBatch(opts, count) -> [generate-result...]
 *   .randomType(rng)   -> 1 type ngẫu nhiên
 *   .MATERIALS         -> 10 chất liệu procedural
 *   .upscaleModel(target, opts) -> { ok, before, after, message }
 *   .textureModel(target, opts) -> { ok, material, size, maps, message }
 *
 * Ràng buộc:
 * - RNG có seed (mulberry32): cùng seed + type + complexity ->
 *   hình dạng/kích thước/màu giống hệt nhau.
 * - KHÔNG dùng CapsuleGeometry (r128 chưa có): tay/chân bằng
 *   cylinder + sphere đầu khớp.
 * - Mọi model đứng trên mặt đất (minY = 0 sau khi dựng).
 * - Mọi truy cập PixiStudio.Viewport/Scene/bus/State đều có
 *   guard: thiếu thì vẫn tạo được group, chỉ bỏ qua đăng ký
 *   (để chạy được trong jsdom harness).
 * - Humanoid là các mesh RỜI đặt tên theo chuẩn mixamorig
 *   (KHÔNG có THREE.Bone / SkinnedMesh / skeleton thật) — Quick
 *   Rig có rig được hay không do agent tích hợp kết luận; module
 *   này chỉ cung cấp mesh đã đặt tên + tỉ lệ đúng chuẩn Coco.
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- môi trường (lazy, có guard) ---------- */
  function getPS() {
    try { if (typeof window !== 'undefined' && window.PixiStudio) return window.PixiStudio; } catch (e) {}
    try { if (typeof PixiStudio !== 'undefined' && PixiStudio) return PixiStudio; } catch (e) {}
    return null;
  }
  function getTHREE() {
    try { if (typeof window !== 'undefined' && window.THREE) return window.THREE; } catch (e) {}
    try { if (typeof THREE !== 'undefined' && THREE) return THREE; } catch (e) {}
    return null;
  }
  function nowMs() {
    try { if (typeof performance !== 'undefined' && performance.now) return performance.now(); } catch (e) {}
    return Date.now();
  }

  /* ---------- RNG có seed: mulberry32 ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function normalizeSeed(seed) {
    if (seed === null || seed === undefined || seed === '') return Math.floor(Math.random() * 1000000000) + 1;
    if (typeof seed === 'number' && isFinite(seed)) return Math.floor(Math.abs(seed)) || 1;
    var s = String(seed).trim();
    if (/^-?\d+$/.test(s)) return Math.floor(Math.abs(parseInt(s, 10))) || 1;
    return (hashSeed(s) % 1000000000) + 1;
  }
  function clampComplexity(c) {
    c = parseInt(c, 10);
    if (isNaN(c)) return 2;
    return Math.max(1, Math.min(3, c));
  }

  /* ---------- bảng màu (trầm/đẹp, không neon chói) ---------- */
  var PALETTES = {
    humanoid: [0x3f6d8e, 0x7a4a3a, 0x4a6b4f, 0x6b5b8e, 0x8e6b3f, 0x5b7a7a],
    sword:    [0xb8c0c8, 0x8a94a0, 0xc9a227, 0x7d8590],
    shield:   [0x7a4a3a, 0x3f6d8e, 0x5b6b3f, 0x8e6b3f],
    house:    [0xc9b18a, 0xa88a6a, 0x8a6a4a, 0x9a7a5a],
    tree:     [0x4a6b3f, 0x5b7a45, 0x3f5b35, 0x6b8e4a],
    table:    [0x8a6a4a, 0x6b4a2f, 0x9a7a5a, 0x7a5a3a],
    chair:    [0x8a6a4a, 0x6b4a2f, 0x7a4a3a, 0x5b6b7a],
    car:      [0x8e2f2f, 0x2f4a6b, 0x3f6d5b, 0x6b6b6b, 0x7a6b3f],
    animal:   [0x8a6a4a, 0x6b4a2f, 0x9a9a9a, 0xc9b18a, 0x5b4a3a],
    dragon:   [0x3f6d5b, 0x6b3f5b, 0x8e2f2f, 0x2f4a6b],
    pillar:   [0xb8b0a0, 0xa89a88, 0x9a8a7a, 0xc9c0b0],
    bridge:   [0x8a6a4a, 0x7a5a3a, 0x9a7a5a, 0x6b4a2f]
  };
  var SKIN_TONES = [0xe8c39a, 0xd9a878, 0xc98e5f, 0xf0d0b0];
  var DARK = 0x2f2a26;

  function parseColor(str, fallback) {
    if (typeof str === 'string') {
      var s = str.trim().replace(/^#/, '');
      if (/^[0-9a-fA-F]{6}$/.test(s)) return parseInt(s, 16);
      if (/^[0-9a-fA-F]{3}$/.test(s)) {
        return parseInt(s[0] + s[0] + s[1] + s[1] + s[2] + s[2], 16);
      }
    }
    return fallback;
  }

  /* ---------- detectType: keyword VI + EN, không dấu ---------- */
  var KEYWORDS = [
    /* humanoid TRƯỚC car/animal: "character" chứa "car", "kiem khach" chứa "kiem" */
    { type: 'humanoid', words: ['nhan vat', 'character', 'warrior', 'hero', 'chien binh', 'hiep khach', 'kiem khach', 'vo si', 'anh hung', 'knight', 'ninja', 'samurai', 'soldier', 'humanoid', 'human', 'nguoi', 'man', 'woman', 'boy', 'girl', 'co gai', 'chang trai'] },
    { type: 'dragon', words: ['rong', 'phuong', 'dragon', 'phoenix', 'phuong hoang'] },
    { type: 'sword', words: ['kiem', 'sword', 'katana', 'guom', 'blade', 'dao kiem'] },
    { type: 'shield', words: ['khien', 'shield'] },
    { type: 'house', words: ['nha', 'house', 'biet thu', 'cottage', 'nha o', 'can nha'] },
    /* bridge TRƯỚC tree: "cay cau" là cầu, không phải cây */
    { type: 'bridge', words: ['cau', 'bridge'] },
    { type: 'pillar', words: ['cot', 'pillar', 'column', 'tru da'] },
    { type: 'tree', words: ['cay', 'tree', 'cay xanh', 'cay co'] },
    { type: 'table', words: ['ban', 'table', 'desk'] },
    { type: 'chair', words: ['ghe', 'chair', 'armchair', 'sofa'] },
    { type: 'animal', words: ['thu', 'animal', 'cho', 'meo', 'dog', 'cat', 'ngua', 'horse', 'chim', 'bird', 'voi', 'elephant', 'su tu', 'lion', 'ho', 'tiger', 'ga', 'ran', 'snake', 'ca', 'fish'] },
    { type: 'car', words: ['xe', 'car', 'oto', 'o to', 'xe hoi', 'automobile', 'vehicle'] }
  ];

  function stripDiacritics(s) {
    try {
      s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) { /* môi trường cũ: giữ nguyên chuỗi */ }
    return s.replace(/đ/g, 'd').replace(/Đ/g, 'D');
  }

  function matchWord(text, word) {
    if (word.length <= 3) {
      /* từ ngắn: khớp đúng từ (tránh "car" trong "character", "ho" trong "cho") */
      var re = new RegExp('(^|[^a-z0-9])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)');
      return re.test(text);
    }
    return text.indexOf(word) !== -1;
  }

  /* ---------- API chính ---------- */
  var LocalAutoGen = {};

  LocalAutoGen.VERSION = '1.0.0';

  LocalAutoGen.TYPES = ['humanoid', 'sword', 'shield', 'house', 'tree', 'table', 'chair', 'car', 'animal', 'dragon', 'pillar', 'bridge'];

  LocalAutoGen.TYPE_LABELS = {
    humanoid: 'Nhân vật',
    sword: 'Kiếm',
    shield: 'Khiên',
    house: 'Ngôi nhà',
    tree: 'Cây',
    table: 'Bàn',
    chair: 'Ghế',
    car: 'Xe',
    animal: 'Thú',
    dragon: 'Rồng / Phượng',
    pillar: 'Cột đá',
    bridge: 'Cây cầu'
  };

  LocalAutoGen.randomType = function (rng) {
    var r = (typeof rng === 'function') ? rng() : Math.random();
    return LocalAutoGen.TYPES[Math.floor(r * LocalAutoGen.TYPES.length) % LocalAutoGen.TYPES.length];
  };

  LocalAutoGen.detectType = function (prompt) {
    var raw = (prompt === null || prompt === undefined) ? '' : String(prompt);
    var text = ' ' + stripDiacritics(raw.toLowerCase()) + ' ';
    var i, j, entry, word;
    for (i = 0; i < KEYWORDS.length; i++) {
      entry = KEYWORDS[i];
      for (j = 0; j < entry.words.length; j++) {
        word = entry.words[j];
        if (matchWord(text, word)) return { type: entry.type, matched: true, keyword: word };
      }
    }
    return { type: LocalAutoGen.randomType(), matched: false, keyword: '' };
  };

  /* ---------- helpers dựng hình (r128-safe) ---------- */
  function R(rng, a, b) { return a + rng() * (b - a); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

  function mat(color, metalness, roughness) {
    var THREE = getTHREE();
    return new THREE.MeshStandardMaterial({
      color: color,
      metalness: (metalness === undefined ? 0.08 : metalness),
      roughness: (roughness === undefined ? 0.85 : roughness)
    });
  }
  function addMesh(group, geo, material, name, x, y, z) {
    var THREE = getTHREE();
    var m = new THREE.Mesh(geo, material);
    m.name = name || '';
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }
  function box(w, h, d) { var T = getTHREE(); return new T.BoxGeometry(w, h, d); }
  function cyl(rt, rb, h, seg) { var T = getTHREE(); return new T.CylinderGeometry(rt, rb, h, seg || 12); }
  function sph(r, ws, hs) { var T = getTHREE(); return new T.SphereGeometry(r, ws || 16, hs || 12); }
  function cone(r, h, seg) { var T = getTHREE(); return new T.ConeGeometry(r, h, seg || 12); }
  function torus(r, tube, seg) { var T = getTHREE(); return new T.TorusGeometry(r, tube, 8, seg || 20); }

  /* cylinder nối 2 điểm (dùng cho tay/chân/dragon/đuôi...) */
  function limb(group, ax, ay, az, bx, by, bz, rTop, rBottom, material, name) {
    var THREE = getTHREE();
    var a = new THREE.Vector3(ax, ay, az);
    var b = new THREE.Vector3(bx, by, bz);
    var dir = new THREE.Vector3().subVectors(b, a);
    var len = dir.length();
    if (len < 0.001) return null;
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, len, 10), material);
    m.name = name || '';
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }

  /* ---------- 12 GENERATOR ----------
     Mỗi generator nhận (rng, complexity, colors) và trả về
     THREE.Group dựng ở gốc tọa độ, chân/đáy chạm y=0 (ground()
     sẽ căn lại chính xác bằng bounding box). Kích thước/màu sắc
     chỉ phụ thuộc rng -> cùng seed cho cùng kết quả. ---------- */
  var GENERATORS = {};

  /* 1. humanoid — cao ~1.8m, A-pose, tỉ lệ theo Coco thật:
     đầu y 0.85–1.00H, vai 0.78, khuỷu 0.63, cổ tay 0.49,
     háng 0.52, gối 0.28, mắt cá 0.06, chân y=0. */
  GENERATORS.humanoid = function (rng, cx, C) {
    var THREE = getTHREE();
    var g = new THREE.Group();
    var H = R(rng, 1.72, 1.88);
    var skin = mat(pick(rng, SKIN_TONES), 0.0, 0.7);
    var cloth = mat(C.main, 0.05, 0.9);
    var cloth2 = mat(C.accent, 0.05, 0.9);
    var dark = mat(DARK, 0.1, 0.9);
    var y = function (f) { return f * H; };
    var hipX = 0.11, shX = 0.24;

    /* chân: háng 0.52H -> mắt cá 0.06H, bàn chân y=0 */
    [-1, 1].forEach(function (s) {
      var side = s < 0 ? 'Left' : 'Right';
      limb(g, s * hipX, y(0.52), 0, s * hipX, y(0.28), 0, 0.055, 0.05, cloth, 'mixamorig:' + side + 'UpLeg');
      limb(g, s * hipX, y(0.28), 0, s * hipX, y(0.06), 0, 0.045, 0.04, skin, 'mixamorig:' + side + 'Leg');
      addMesh(g, sph(0.045, 10, 8), skin, 'mixamorig:' + side + 'Foot', s * hipX, y(0.06), 0);
      addMesh(g, box(0.09, 0.05, 0.22), dark, 'mixamorig:' + side + 'Foot', s * hipX, 0.025, 0.05);
      addMesh(g, sph(0.06, 10, 8), cloth, 'mixamorig:' + side + 'Knee', s * hipX, y(0.28), 0);
    });
    /* hông + thân */
    addMesh(g, box(0.34, 0.16, 0.2), cloth2, 'mixamorig:Hips', 0, y(0.56), 0);
    addMesh(g, cyl(0.19, 0.17, 0.34, 12), cloth, 'mixamorig:Spine', 0, y(0.68), 0);
    addMesh(g, box(0.44, 0.2, 0.24), cloth, 'mixamorig:Spine1', 0, y(0.74), 0);
    /* tay A-pose: vai 0.78H -> khuỷu 0.63H -> cổ tay 0.49H, hơi dang ra */
    [-1, 1].forEach(function (s) {
      var side = s < 0 ? 'Left' : 'Right';
      var sh = { x: s * shX, y: y(0.78), z: 0 };
      var el = { x: s * (shX + 0.07), y: y(0.63), z: 0 };
      var wr = { x: s * (shX + 0.13), y: y(0.49), z: 0 };
      limb(g, sh.x, sh.y, 0, el.x, el.y, 0, 0.05, 0.045, cloth, 'mixamorig:' + side + 'Arm');
      limb(g, el.x, el.y, 0, wr.x, wr.y, 0, 0.042, 0.038, skin, 'mixamorig:' + side + 'ForeArm');
      addMesh(g, sph(0.055, 10, 8), cloth, 'mixamorig:' + side + 'Shoulder', sh.x, sh.y, 0);
      addMesh(g, sph(0.05, 10, 8), skin, 'mixamorig:' + side + 'Elbow', el.x, el.y, 0);
      addMesh(g, sph(0.05, 10, 8), skin, 'mixamorig:' + side + 'Hand', wr.x, wr.y - 0.03, 0);
    });
    /* cổ + đầu (đầu y 0.85–1.00H) */
    addMesh(g, cyl(0.05, 0.06, 0.08, 10), skin, 'mixamorig:Neck', 0, y(0.83), 0);
    addMesh(g, sph(0.13, 18, 14), skin, 'mixamorig:Head', 0, y(0.92), 0);
    if (cx >= 2) {
      /* mắt + tóc + thắt lưng */
      addMesh(g, sph(0.016, 8, 6), dark, 'mixamorig:LeftEye', -0.048, y(0.93), 0.115);
      addMesh(g, sph(0.016, 8, 6), dark, 'mixamorig:RightEye', 0.048, y(0.93), 0.115);
      var hair = addMesh(g, sph(0.135, 16, 12), mat(C.accent, 0.0, 0.95), 'mixamorig:Hair', 0, y(0.95), -0.015);
      hair.scale.set(1, 0.75, 1);
      addMesh(g, box(0.36, 0.05, 0.22), cloth2, 'mixamorig:Belt', 0, y(0.60), 0);
    }
    if (cx >= 3) {
      /* áo choàng sau lưng + cầu vai + bao tay chân */
      var cloak = addMesh(g, box(0.4, 0.62, 0.03), cloth2, 'mixamorig:Cloak', 0, y(0.52), -0.14);
      cloak.rotation.x = 0.06;
      addMesh(g, sph(0.075, 10, 8), cloth2, 'mixamorig:LeftShoulderPad', -shX, y(0.79), 0);
      addMesh(g, sph(0.075, 10, 8), cloth2, 'mixamorig:RightShoulderPad', shX, y(0.79), 0);
      [-1, 1].forEach(function (s) {
        addMesh(g, cyl(0.055, 0.06, 0.12, 10), cloth2, 'mixamorig:' + (s < 0 ? 'Left' : 'Right') + 'Bracer', s * (shX + 0.10), y(0.56), 0);
        addMesh(g, box(0.11, 0.16, 0.24), dark, 'mixamorig:' + (s < 0 ? 'Left' : 'Right') + 'Boot', s * hipX, 0.08, 0.04);
      });
    }
    return g;
  };

  /* 2. sword — đứng thẳng, mũi lên */
  GENERATORS.sword = function (rng, cx, C) {
    var g = new THREE.Group();
    var steel = mat(C.main, 0.85, 0.3);
    var gold = mat(0xc9a227, 0.9, 0.35);
    var gripM = mat(C.accent, 0.1, 0.9);
    var bladeW = R(rng, 0.08, 0.11), bladeH = R(rng, 0.75, 0.9);
    var guardY = 0.34, tipY = guardY + bladeH;
    addMesh(g, box(bladeW, bladeH, 0.022), steel, 'Blade', 0, guardY + bladeH / 2, 0);
    var tip = addMesh(g, cone(bladeW * 0.72, 0.14, 4), steel, 'BladeTip', 0, tipY + 0.07, 0);
    tip.rotation.y = Math.PI / 4;
    addMesh(g, box(0.3, 0.045, 0.07), gold, 'Guard', 0, guardY, 0);
    addMesh(g, cyl(0.026, 0.03, 0.22, 10), gripM, 'Grip', 0, guardY - 0.13, 0);
    addMesh(g, sph(0.042, 12, 10), gold, 'Pommel', 0, guardY - 0.25, 0);
    if (cx >= 2) {
      addMesh(g, sph(0.028, 10, 8), mat(0x8e2f2f, 0.3, 0.4), 'GuardGem', 0, guardY, 0.045);
      var ring = addMesh(g, torus(0.032, 0.008, 16), gold, 'GripRing', 0, guardY - 0.06, 0);
      ring.rotation.x = Math.PI / 2;
    }
    if (cx >= 3) {
      addMesh(g, box(bladeW * 0.28, bladeH * 0.92, 0.026), mat(0xd8dde2, 0.9, 0.25), 'Fuller', 0, guardY + bladeH / 2, 0);
      addMesh(g, sph(0.03, 10, 8), gold, 'GuardEndLeft', -0.16, guardY, 0);
      addMesh(g, sph(0.03, 10, 8), gold, 'GuardEndRight', 0.16, guardY, 0);
      var ring2 = addMesh(g, torus(0.032, 0.008, 16), gold, 'GripRing2', 0, guardY - 0.18, 0);
      ring2.rotation.x = Math.PI / 2;
    }
    return g;
  };

  /* 3. shield */
  GENERATORS.shield = function (rng, cx, C) {
    var g = new THREE.Group();
    var body = mat(C.main, 0.25, 0.6);
    var trim = mat(C.accent, 0.7, 0.4);
    var r = R(rng, 0.32, 0.42), cy = R(rng, 0.55, 0.65);
    var plate = addMesh(g, cyl(r, r * 0.92, 0.06, 24), body, 'ShieldPlate', 0, cy, 0);
    plate.rotation.x = Math.PI / 2;
    addMesh(g, sph(0.09, 12, 10), trim, 'Boss', 0, cy, 0.06);
    addMesh(g, box(0.05, 0.3, 0.04), mat(DARK, 0.1, 0.9), 'Handle', 0, cy, -0.06);
    if (cx >= 2) {
      var rim = addMesh(g, torus(r, 0.018, 24), trim, 'Rim', 0, cy, 0);
      rim.position.z = 0.01;
      addMesh(g, box(0.06, r * 1.2, 0.02), trim, 'EmblemV', 0, cy, 0.035);
      addMesh(g, box(r * 0.9, 0.06, 0.02), trim, 'EmblemH', 0, cy, 0.035);
    }
    if (cx >= 3) {
      for (var i = 0; i < 4; i++) {
        var a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        addMesh(g, sph(0.022, 8, 6), trim, 'Stud' + i, Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, 0.035);
      }
      addMesh(g, box(0.05, 0.34, 0.03), mat(DARK, 0.1, 0.9), 'HandleStrap', 0, cy, -0.075);
    }
    return g;
  };

  /* 4. house */
  GENERATORS.house = function (rng, cx, C) {
    var g = new THREE.Group();
    var wall = mat(C.main, 0.0, 0.95);
    var roofM = mat(C.accent, 0.05, 0.9);
    var wood = mat(0x6b4a2f, 0.1, 0.9);
    var w = R(rng, 1.8, 2.4), d = R(rng, 1.5, 1.9), h = R(rng, 1.1, 1.4);
    addMesh(g, box(w, h, d), wall, 'Walls', 0, h / 2, 0);
    var roof = addMesh(g, cone(Math.max(w, d) * 0.72, R(rng, 0.7, 0.95), 4), roofM, 'Roof', 0, h + 0.4, 0);
    roof.rotation.y = Math.PI / 4;
    addMesh(g, box(0.45, 0.75, 0.06), wood, 'Door', 0, 0.375, d / 2 + 0.01);
    addMesh(g, box(0.35, 0.35, 0.05), mat(0x9fc4d8, 0.1, 0.3), 'WindowLeft', -w * 0.28, h * 0.6, d / 2 + 0.01);
    addMesh(g, box(0.35, 0.35, 0.05), mat(0x9fc4d8, 0.1, 0.3), 'WindowRight', w * 0.28, h * 0.6, d / 2 + 0.01);
    if (cx >= 2) {
      addMesh(g, box(0.25, 0.6, 0.25), mat(0x8a6a5a, 0.0, 0.95), 'Chimney', w * 0.3, h + 0.55, -d * 0.2);
      addMesh(g, box(0.6, 0.08, 0.3), mat(0x9a9a9a, 0.0, 0.95), 'Step', 0, 0.04, d / 2 + 0.16);
    }
    if (cx >= 3) {
      addMesh(g, box(0.3, 0.3, 0.05), mat(0x9fc4d8, 0.1, 0.3), 'WindowBack', 0, h * 0.6, -d / 2 - 0.01);
      addMesh(g, box(w + 0.15, 0.07, d + 0.15), wood, 'RoofTrim', 0, h + 0.03, 0);
      addMesh(g, box(0.08, 0.5, 0.08), wood, 'FencePost1', -w * 0.5, 0.25, d / 2 + 0.45);
      addMesh(g, box(0.08, 0.5, 0.08), wood, 'FencePost2', w * 0.5, 0.25, d / 2 + 0.45);
      addMesh(g, box(w, 0.06, 0.06), wood, 'FenceRail', 0, 0.42, d / 2 + 0.45);
    }
    return g;
  };

  /* 5. tree */
  GENERATORS.tree = function (rng, cx, C) {
    var g = new THREE.Group();
    var trunkM = mat(0x6b4a2f, 0.0, 0.95);
    var leafM = mat(C.main, 0.0, 0.95);
    var th = R(rng, 1.0, 1.4);
    addMesh(g, cyl(0.10, 0.16, th, 10), trunkM, 'Trunk', 0, th / 2, 0);
    var layers = cx === 1 ? 1 : (cx === 2 ? 2 : 3);
    var y = th, r = R(rng, 0.55, 0.7);
    for (var i = 0; i < layers; i++) {
      addMesh(g, sph(r, 14, 12), leafM, 'Canopy' + (i + 1), 0, y + r * 0.7, 0);
      y += r * 0.75;
      r *= 0.72;
    }
    if (cx >= 2) limb(g, 0, th * 0.7, 0, 0.35, th * 0.95, 0, 0.03, 0.05, trunkM, 'BranchRight');
    if (cx >= 3) {
      limb(g, 0, th * 0.6, 0, -0.32, th * 0.9, 0, 0.03, 0.05, trunkM, 'BranchLeft');
      for (var j = 0; j < 4; j++) {
        var a = (j / 4) * Math.PI * 2;
        addMesh(g, sph(0.05, 8, 6), mat(0x8e2f2f, 0.1, 0.6), 'Fruit' + j, Math.cos(a) * 0.4, th + 0.35, Math.sin(a) * 0.4);
      }
    }
    return g;
  };

  /* 6. table */
  GENERATORS.table = function (rng, cx, C) {
    var g = new THREE.Group();
    var wood = mat(C.main, 0.05, 0.85);
    var dark = mat(C.accent, 0.05, 0.9);
    var w = R(rng, 1.4, 1.8), d = R(rng, 0.8, 1.0), topY = R(rng, 0.7, 0.78);
    addMesh(g, box(w, 0.08, d), wood, 'TableTop', 0, topY, 0);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s, i) {
      addMesh(g, box(0.09, topY, 0.09), dark, 'Leg' + (i + 1), s[0] * (w / 2 - 0.1), topY / 2, s[1] * (d / 2 - 0.1));
    });
    if (cx >= 2) addMesh(g, box(w - 0.3, 0.05, d - 0.3), dark, 'Shelf', 0, topY * 0.3, 0);
    if (cx >= 3) {
      addMesh(g, box(0.5, 0.18, 0.05), dark, 'Drawer', -w * 0.2, topY - 0.14, d / 2 + 0.01);
      addMesh(g, box(w + 0.06, 0.03, d + 0.06), mat(C.accent, 0.05, 0.85), 'TopTrim', 0, topY + 0.05, 0);
    }
    return g;
  };

  /* 7. chair */
  GENERATORS.chair = function (rng, cx, C) {
    var g = new THREE.Group();
    var wood = mat(C.main, 0.05, 0.85);
    var dark = mat(C.accent, 0.05, 0.9);
    var seatY = R(rng, 0.42, 0.48);
    addMesh(g, box(0.5, 0.06, 0.5), wood, 'Seat', 0, seatY, 0);
    var back = addMesh(g, box(0.5, 0.62, 0.05), wood, 'Backrest', 0, seatY + 0.33, -0.235);
    back.rotation.x = -0.08;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s, i) {
      addMesh(g, box(0.06, seatY, 0.06), dark, 'Leg' + (i + 1), s[0] * 0.2, seatY / 2, s[1] * 0.2);
    });
    if (cx >= 2) addMesh(g, box(0.44, 0.05, 0.44), mat(C.accent, 0.0, 0.95), 'Cushion', 0, seatY + 0.055, 0);
    if (cx >= 3) {
      [-1, 1].forEach(function (s, i) {
        addMesh(g, box(0.05, 0.05, 0.42), dark, 'Armrest' + (i + 1), s * 0.24, seatY + 0.24, 0);
        addMesh(g, box(0.05, 0.2, 0.05), dark, 'ArmPost' + (i + 1), s * 0.24, seatY + 0.13, 0.18);
      });
    }
    return g;
  };

  /* 8. car */
  GENERATORS.car = function (rng, cx, C) {
    var g = new THREE.Group();
    var paint = mat(C.main, 0.6, 0.35);
    var glass = mat(0x2f3a45, 0.4, 0.15);
    var tire = mat(0x1a1a1a, 0.0, 0.95);
    var hub = mat(0xb8c0c8, 0.9, 0.3);
    var L = R(rng, 1.9, 2.3);
    addMesh(g, box(L, 0.42, 0.92), paint, 'Body', 0, 0.44, 0);
    addMesh(g, box(L * 0.55, 0.36, 0.82), glass, 'Cabin', -L * 0.05, 0.83, 0);
    var wheelR = 0.23;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s, i) {
      var w = addMesh(g, cyl(wheelR, wheelR, 0.14, 16), tire, 'Wheel' + (i + 1), s[0] * L * 0.32, wheelR, s[1] * 0.46);
      w.rotation.x = Math.PI / 2;
      var h = addMesh(g, cyl(0.11, 0.11, 0.15, 12), hub, 'Hub' + (i + 1), s[0] * L * 0.32, wheelR, s[1] * 0.46);
      h.rotation.x = Math.PI / 2;
    });
    if (cx >= 2) {
      addMesh(g, sph(0.06, 10, 8), mat(0xf5e6a0, 0.2, 0.2), 'HeadlightLeft', L / 2 + 0.01, 0.5, 0.28);
      addMesh(g, sph(0.06, 10, 8), mat(0xf5e6a0, 0.2, 0.2), 'HeadlightRight', L / 2 + 0.01, 0.5, -0.28);
      addMesh(g, box(0.04, 0.1, 0.5), mat(0x3a3a3a, 0.4, 0.6), 'Grille', L / 2 + 0.01, 0.38, 0);
    }
    if (cx >= 3) {
      addMesh(g, box(0.3, 0.04, 0.8), paint, 'Spoiler', -L / 2 + 0.08, 0.78, 0);
      addMesh(g, box(0.08, 0.05, 0.1), dark_mirror(), 'MirrorLeft', -L * 0.05, 0.72, 0.48);
      addMesh(g, box(0.08, 0.05, 0.1), dark_mirror(), 'MirrorRight', -L * 0.05, 0.72, -0.48);
      addMesh(g, box(L * 0.5, 0.03, 0.7), mat(0x1a1a1a, 0.3, 0.5), 'RoofPanel', -L * 0.05, 1.02, 0);
    }
    return g;
    function dark_mirror() { return mat(0x2f2a26, 0.5, 0.4); }
  };

  /* 9. animal — thú 4 chân */
  GENERATORS.animal = function (rng, cx, C) {
    var g = new THREE.Group();
    var fur = mat(C.main, 0.0, 0.95);
    var dark = mat(C.accent, 0.0, 0.95);
    var L = R(rng, 0.8, 1.0), bodyY = R(rng, 0.52, 0.6);
    addMesh(g, box(L, 0.42, 0.4), fur, 'Body', 0, bodyY, 0);
    addMesh(g, sph(0.21, 14, 12), fur, 'Head', L / 2 + 0.16, bodyY + 0.22, 0);
    addMesh(g, box(0.16, 0.12, 0.18), fur, 'Muzzle', L / 2 + 0.32, bodyY + 0.16, 0);
    addMesh(g, cone(0.06, 0.14, 8), fur, 'EarLeft', L / 2 + 0.1, bodyY + 0.42, 0.1);
    addMesh(g, cone(0.06, 0.14, 8), fur, 'EarRight', L / 2 + 0.1, bodyY + 0.42, -0.1);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s, i) {
      limb(g, s[0] * L * 0.32, bodyY - 0.15, s[1] * 0.13, s[0] * L * 0.32, 0.05, s[1] * 0.13, 0.05, 0.045, fur, 'Leg' + (i + 1));
    });
    limb(g, -L / 2, bodyY + 0.05, 0, -L / 2 - 0.32, bodyY + 0.3, 0, 0.02, 0.045, fur, 'Tail');
    if (cx >= 2) {
      addMesh(g, sph(0.02, 8, 6), mat(0x1a1a1a, 0.0, 0.5), 'EyeLeft', L / 2 + 0.3, bodyY + 0.28, 0.1);
      addMesh(g, sph(0.02, 8, 6), mat(0x1a1a1a, 0.0, 0.5), 'EyeRight', L / 2 + 0.3, bodyY + 0.28, -0.1);
      addMesh(g, sph(0.035, 8, 6), mat(0x1a1a1a, 0.0, 0.5), 'Nose', L / 2 + 0.41, bodyY + 0.17, 0);
    }
    if (cx >= 3) {
      for (var i = 0; i < 4; i++) {
        addMesh(g, sph(0.06, 8, 6), dark, 'Spot' + i, R(rng, -L * 0.3, L * 0.3), bodyY + 0.2, (rng() > 0.5 ? 0.19 : -0.19));
      }
      addMesh(g, box(0.4, 0.06, 0.44), dark, 'Saddle', 0, bodyY + 0.23, 0);
    }
    return g;
  };

  /* 10. dragon — thân dài uốn bằng nhiều sphere nối tiếp + cánh */
  GENERATORS.dragon = function (rng, cx, C) {
    var g = new THREE.Group();
    var scale = mat(C.main, 0.25, 0.6);
    var belly = mat(C.accent, 0.1, 0.8);
    var hornM = mat(0xd8c9a0, 0.3, 0.6);
    var segs = cx === 1 ? 4 : (cx === 2 ? 6 : 8);
    var prev = null, i;
    for (i = 0; i < segs; i++) {
      var t = i / (segs - 1);
      var x = -1.1 + t * 2.2;
      var y = 0.85 + Math.sin(t * Math.PI) * 0.25 + R(rng, -0.03, 0.03);
      var r = 0.22 * (1 - t * 0.45);
      var m = addMesh(g, sph(r, 14, 12), i % 2 ? belly : scale, 'BodySeg' + (i + 1), x, y, 0);
      m.scale.set(1.25, 1, 1);
      if (prev) limb(g, prev.x, prev.y, 0, x, y, 0, r * 0.9, r * 0.9, scale, 'BodyLink' + i);
      prev = { x: x, y: y };
    }
    /* đầu + sừng */
    var hx = 1.25, hy = 1.05;
    addMesh(g, sph(0.2, 14, 12), scale, 'Head', hx, hy, 0);
    addMesh(g, box(0.22, 0.12, 0.14), belly, 'Snout', hx + 0.2, hy - 0.02, 0);
    addMesh(g, cone(0.045, 0.3, 8), hornM, 'HornLeft', hx - 0.05, hy + 0.22, 0.09);
    addMesh(g, cone(0.045, 0.3, 8), hornM, 'HornRight', hx - 0.05, hy + 0.22, -0.09);
    /* cánh: 2 tấm dẹt gắn giữa thân */
    [-1, 1].forEach(function (s, idx) {
      var wing = addMesh(g, box(0.7, 0.03, 0.9), mat(C.accent, 0.1, 0.8), 'Wing' + (idx + 1), 0.1, 1.35, s * 0.5);
      wing.rotation.x = s * 0.5;
      wing.rotation.z = 0.25;
    });
    /* chân nhỏ + đuôi nhọn */
    [[-0.5, 1], [0.4, -1]].forEach(function (p, idx) {
      limb(g, p[0], 0.75, p[1] * 0.15, p[0], 0.25, p[1] * 0.2, 0.04, 0.035, belly, 'Leg' + (idx + 1));
    });
    var tail = addMesh(g, cone(0.09, 0.55, 10), scale, 'TailTip', -1.35, 0.85, 0);
    tail.rotation.z = Math.PI / 2 - 0.25;
    if (cx >= 2) {
      for (i = 0; i < 5; i++) {
        var tx = -0.9 + i * 0.45;
        addMesh(g, cone(0.05, 0.16, 6), hornM, 'Spike' + i, tx, 1.05 + Math.sin((i / 4) * Math.PI) * 0.22, 0);
      }
      addMesh(g, sph(0.025, 8, 6), mat(0x1a1a1a, 0.0, 0.5), 'EyeLeft', hx + 0.12, hy + 0.06, 0.12);
      addMesh(g, sph(0.025, 8, 6), mat(0x1a1a1a, 0.0, 0.5), 'EyeRight', hx + 0.12, hy + 0.06, -0.12);
    }
    if (cx >= 3) {
      for (i = 0; i < 3; i++) {
        addMesh(g, cone(0.03, 0.1, 6), hornM, 'Claw' + i, -0.5 + i * 0.45, 0.22, 0.2);
        addMesh(g, cone(0.03, 0.1, 6), hornM, 'ClawB' + i, -0.5 + i * 0.45, 0.22, -0.2);
      }
      var wingTip = addMesh(g, cone(0.12, 0.4, 4), belly, 'WingTip', 0.45, 1.6, 0.85);
      wingTip.rotation.z = -0.5;
    }
    return g;
  };

  /* 11. pillar */
  GENERATORS.pillar = function (rng, cx, C) {
    var g = new THREE.Group();
    var stone = mat(C.main, 0.05, 0.95);
    var trim = mat(C.accent, 0.05, 0.9);
    var h = R(rng, 1.6, 2.0);
    addMesh(g, box(0.75, 0.14, 0.75), trim, 'Base', 0, 0.07, 0);
    addMesh(g, box(0.6, 0.1, 0.6), stone, 'BaseTop', 0, 0.19, 0);
    addMesh(g, cyl(0.22, 0.26, h, 16), stone, 'Shaft', 0, 0.24 + h / 2, 0);
    addMesh(g, box(0.62, 0.12, 0.62), trim, 'Capital', 0, 0.24 + h + 0.06, 0);
    addMesh(g, box(0.72, 0.08, 0.72), stone, 'TopSlab', 0, 0.24 + h + 0.16, 0);
    if (cx >= 2) {
      var ring = addMesh(g, torus(0.24, 0.025, 20), trim, 'RingBottom', 0, 0.32, 0);
      ring.rotation.x = Math.PI / 2;
      var ring2 = addMesh(g, torus(0.24, 0.025, 20), trim, 'RingTop', 0, 0.24 + h - 0.08, 0);
      ring2.rotation.x = Math.PI / 2;
    }
    if (cx >= 3) {
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * Math.PI * 2;
        addMesh(g, box(0.03, h * 0.9, 0.03), trim, 'Flute' + i, Math.cos(a) * 0.235, 0.24 + h / 2, Math.sin(a) * 0.235);
      }
    }
    return g;
  };

  /* 12. bridge — mặt cầu cong nhẹ bằng nhiều box + trụ + lan can */
  GENERATORS.bridge = function (rng, cx, C) {
    var g = new THREE.Group();
    var wood = mat(C.main, 0.05, 0.85);
    var dark = mat(C.accent, 0.05, 0.9);
    var L = R(rng, 3.6, 4.4), W = 1.2, arch = R(rng, 0.3, 0.45);
    var n = cx === 1 ? 3 : (cx === 2 ? 5 : 7);
    var segW = L / n;
    var deckY = function (x) { return 0.55 + arch * (1 - Math.pow(x / (L / 2), 2)); };
    var i, x;
    for (i = 0; i < n; i++) {
      x = -L / 2 + segW * (i + 0.5);
      var plank = addMesh(g, box(segW + 0.02, 0.09, W), wood, 'Deck' + (i + 1), x, deckY(x), 0);
      plank.rotation.z = (deckY(x + segW / 2) - deckY(x - segW / 2)) / segW * 0.7;
    }
    [-1, 1].forEach(function (s) {
      addMesh(g, box(0.3, deckY(s * L * 0.32), 0.3), dark, 'Pier' + (s < 0 ? 'Left' : 'Right'), s * L * 0.32, deckY(s * L * 0.32) / 2, 0);
    });
    if (cx >= 2) {
      for (i = 0; i < n; i++) {
        x = -L / 2 + segW * (i + 0.5);
        [-1, 1].forEach(function (s) {
          addMesh(g, box(0.05, 0.5, 0.05), dark, 'Post' + i + (s < 0 ? 'L' : 'R'), x, deckY(x) + 0.3, s * (W / 2 - 0.03));
        });
      }
      [-1, 1].forEach(function (s) {
        var rail = addMesh(g, box(L, 0.06, 0.06), wood, 'Rail' + (s < 0 ? 'Left' : 'Right'), 0, 0.55 + arch + 0.5, s * (W / 2 - 0.03));
        rail.rotation.z = 0;
      });
    }
    if (cx >= 3) {
      [-1, 1].forEach(function (s) {
        addMesh(g, sph(0.07, 10, 8), mat(0xf5e6a0, 0.2, 0.3), 'Lamp' + (s < 0 ? 'Left' : 'Right'), s * L * 0.42, deckY(s * L * 0.42) + 0.62, W / 2 - 0.03);
        addMesh(g, box(0.05, 0.12, 0.05), dark, 'LampPost' + (s < 0 ? 'Left' : 'Right'), s * L * 0.42, deckY(s * L * 0.42) + 0.55, W / 2 - 0.03);
      });
    }
    return g;
  };

  /* ---------- đo + căn đất ---------- */
  function measure(group) {
    var THREE = getTHREE();
    var meshCount = 0, triCount = 0;
    group.traverse(function (o) {
      if (o.isMesh && o.geometry) {
        meshCount++;
        var geo = o.geometry;
        if (geo.index) triCount += geo.index.count / 3;
        else if (geo.attributes && geo.attributes.position) triCount += geo.attributes.position.count / 3;
      }
    });
    group.updateMatrixWorld(true);
    var bb = new THREE.Box3().setFromObject(group);
    return { meshCount: meshCount, triCount: Math.round(triCount), minY: bb.min.y };
  }

  function ground(group) {
    var m = measure(group);
    if (isFinite(m.minY)) group.position.y -= m.minY;
    group.updateMatrixWorld(true);
    return measure(group);
  }

  /* Làm mới stats của entry Models.models sau khi upscale/texture đổi
     geometry/texture: entry.stats là snapshot lúc generate — không refresh
     thì Asset Library + Export manifest hiện tris/texture cũ (đo thật:
     upscale sword 688 -> 2752 tris nhưng entry vẫn 688). Chỉ chạy khi
     target chính là group đã đăng ký (có userData.modelEntry); mọi lỗi
     đều bỏ qua, không phá kết quả tool. */
  function refreshEntryStats(target) {
    try {
      if (!target || !target.userData || !target.userData.modelEntry) return;
      var entry = target.userData.modelEntry;
      if (!entry || !entry.stats) return;
      var m = measure(target);
      var verts = 0, texSet = {};
      target.traverse(function (o) {
        if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
          verts += o.geometry.attributes.position.count;
        }
        if (o.isMesh && o.material) {
          var ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach(function (mat) {
            if (!mat) return;
            ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'].forEach(function (k) {
              if (mat[k]) texSet[mat[k].uuid] = true;
            });
          });
        }
      });
      entry.stats.triangles = m.triCount;
      entry.stats.faces = m.triCount;
      entry.stats.vertices = verts;
      entry.stats.meshes = m.meshCount;
      entry.stats.textures = Object.keys(texSet).length;
    } catch (e) {}
  }

  /* ---------- generate / generateBatch ---------- */
  LocalAutoGen.generate = function (opts) {
    opts = opts || {};
    var t0 = nowMs();
    var THREE = getTHREE();
    if (!THREE) throw new Error('LocalAutoGen: THREE chưa load.');
    var prompt = (opts.prompt === null || opts.prompt === undefined) ? '' : String(opts.prompt);
    var detected = LocalAutoGen.detectType(prompt);
    var type = (opts.type && GENERATORS[opts.type]) ? opts.type : detected.type;
    var seed = normalizeSeed(opts.seed);
    var cx = clampComplexity(opts.complexity);
    var rng = mulberry32(seed);
    var mainFallback = pick(rng, PALETTES[type]);
    var main = parseColor(opts.color, mainFallback);
    var accent = pick(rng, PALETTES[type]);
    if (accent === main) accent = pick(rng, PALETTES[type]);
    var colors = { main: main, accent: accent };

    var group = GENERATORS[type](rng, cx, colors);
    group.name = 'LocalGen_' + type + '_' + seed;
    group.userData.localGen = { type: type, seed: seed, prompt: prompt };
    var stats = ground(group);

    var name = LocalAutoGen.TYPE_LABELS[type] + ' #' + seed;
    var result = {
      group: group, type: type, name: name, seed: seed,
      meshCount: stats.meshCount, triCount: stats.triCount,
      durationMs: Math.round((nowMs() - t0) * 100) / 100
    };

    /* tích hợp studio — tất cả đều có guard, lỗi ở đây không phá model */
    try {
      var PS = getPS();
      if (PS) {
        if (PS.Viewport) {
          if (PS.Viewport.scene && PS.Viewport.scene.add) PS.Viewport.scene.add(group);
          else if (PS.Viewport.addModel) PS.Viewport.addModel(group);
          else if (PS.Viewport.modelRoot && PS.Viewport.modelRoot.add) PS.Viewport.modelRoot.add(group);
        }
        if (PS.Scene && PS.Scene.register) PS.Scene.register(group, 'model', name);
        /* Đăng ký vào Models.models (cùng shape với model-manager.registerModel):
           Asset Library.syncImportedModels CHỈ quét Models.models nên trước đây
           model local emit 'model:loaded' vẫn không hiện trong library; Export
           (SaveManager) cũng lấy model hiện tại qua Models.getCurrent(). Dùng
           id = group.uuid để khớp với model:loaded + State.select ở trên.
           modelEntry để non-enumerable như model-manager (tránh vòng tham chiếu
           làm Object3D.copy()/clone() tràn stack khi stringify userData). */
        if (PS.Models && PS.Models.models) {
          var verts = 0, matSet = {};
          group.traverse(function (o) {
            if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
              verts += o.geometry.attributes.position.count;
            }
            if (o.isMesh && o.material) {
              var ms = Array.isArray(o.material) ? o.material : [o.material];
              ms.forEach(function (m) { if (m) matSet[m.uuid] = true; });
            }
          });
          var bb2 = new THREE.Box3().setFromObject(group);
          var sz2 = bb2.isEmpty() ? new THREE.Vector3(1, 1, 1) : bb2.getSize(new THREE.Vector3());
          var entry = {
            id: group.uuid, name: name, object3D: group,
            stats: {
              vertices: verts, faces: stats.triCount, triangles: stats.triCount,
              meshes: stats.meshCount, materials: Object.keys(matSet).length,
              materialCount: Object.keys(matSet).length, textures: 0,
              size: [Math.round(sz2.x * 100) / 100, Math.round(sz2.y * 100) / 100, Math.round(sz2.z * 100) / 100],
              height: Math.round(sz2.y * 100) / 100
            },
            isGLB: false, isFBX: false, fileSize: 0, url: null, clips: []
          };
          try {
            Object.defineProperty(group.userData, 'modelEntry', { value: entry, enumerable: false, writable: true, configurable: true });
          } catch (e0) { group.userData.modelEntry = entry; }
          PS.Models.models[group.uuid] = entry;
          PS.Models.currentId = group.uuid;
        }
        if (PS.State && PS.State.select) PS.State.select(group, { modelId: group.uuid });
        if (PS.bus && PS.bus.emit) {
          try { PS.bus.emit('model:loaded', { id: group.uuid, name: name, stats: { tris: stats.triCount, meshes: stats.meshCount }, isGLB: false, fileSize: 0, clips: [] }); } catch (e1) {}
          try { PS.bus.emit('ai:local-generated', { type: type, name: name, seed: seed }); } catch (e2) {}
        }
      }
    } catch (e) { /* bỏ qua: model vẫn dùng được standalone */ }

    return result;
  };

  LocalAutoGen.generateBatch = function (opts, count) {
    opts = opts || {};
    var n = parseInt(count, 10);
    if (isNaN(n)) n = parseInt(opts.batch, 10);
    if (isNaN(n) || n < 1) n = 1;
    if (n > 10) n = 10;
    var baseSeed = normalizeSeed(opts.seed);
    var out = [];
    for (var i = 0; i < n; i++) {
      var o2 = {};
      for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o2[k] = opts[k];
      o2.seed = baseSeed + i * 7919; /* seed khác nhau mỗi model */
      var r = LocalAutoGen.generate(o2);
      r.group.position.x = (i - (n - 1) / 2) * 2.5;
      out.push(r);
    }
    return out;
  };

  /* ================= UPSCALE + TEXTURING (LOCAL) =================
     Tính năng MỚI, không có bản cloud để đối chiếu (Tripo v3 đã
     bỏ upscale_model). Giới hạn chung, ghi rõ cho UI hiển thị:
     upscale local là nội suy/làm mịn — KHÔNG tạo thêm chi tiết
     thật như AI cloud; texture procedural là họa tiết lặp theo
     chất liệu — KHÔNG vẽ theo hình dạng model như AI texturing
     (không biết đâu là mặt, đâu là áo). */

  function getDoc() {
    try { if (typeof document !== 'undefined' && document) return document; } catch (e) {}
    return null;
  }

  /* Canvas 2D có thật không? Cache 1 lần (jsdom không có gói
     canvas -> getContext('2d') trả null; trình duyệt thật -> có). */
  var _canvas2dOK = null;
  function canvas2dAvailable() {
    if (_canvas2dOK !== null) return _canvas2dOK;
    _canvas2dOK = false;
    try {
      var doc = getDoc();
      if (doc) {
        var c = doc.createElement('canvas');
        c.width = 1; c.height = 1;
        if (c.getContext && c.getContext('2d')) _canvas2dOK = true;
      }
    } catch (e) {}
    return _canvas2dOK;
  }
  function makeCanvas(w, h) {
    var doc = getDoc();
    if (!doc || !canvas2dAvailable()) return null;
    try {
      var c = doc.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      return { canvas: c, ctx: ctx };
    } catch (e) { return null; }
  }

  function hexToRgb(hex) {
    var s = String(hex).replace(/^#/, '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    if (isNaN(n)) n = 0x888888;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

  /* Value noise: lưới ngẫu nhiên + nội suy smoothstep, nhiều octave.
     Dùng cho vân gỗ/đá/vải... và heightfield của normal map. */
  function noiseField(w, h, rng, cell, octaves) {
    var out = new Float32Array(w * h);
    var amp = 1, total = 0, o, x, y;
    for (o = 0; o < (octaves || 1); o++) {
      var cs = Math.max(2, Math.round(cell / Math.pow(2, o)));
      var gw = Math.ceil(w / cs) + 2, gh = Math.ceil(h / cs) + 2;
      var grid = new Float32Array(gw * gh);
      var i;
      for (i = 0; i < grid.length; i++) grid[i] = rng();
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          var gx = x / cs, gy = y / cs;
          var x0 = Math.floor(gx), y0 = Math.floor(gy);
          var fx = gx - x0, fy = gy - y0;
          var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
          var v00 = grid[y0 * gw + x0], v10 = grid[y0 * gw + x0 + 1];
          var v01 = grid[(y0 + 1) * gw + x0], v11 = grid[(y0 + 1) * gw + x0 + 1];
          var v = (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
          out[y * w + x] += v * amp;
        }
      }
      total += amp; amp *= 0.5;
    }
    for (var k = 0; k < out.length; k++) out[k] /= total;
    return out;
  }

  /* Pixel buffer RGBA -> THREE texture. Có canvas 2D thì ra
     THREE.CanvasTexture (đúng pattern save-manager.js); không thì
     THREE.DataTexture từ cùng pixel buffer (jsdom harness). */
  function bufferToTexture(w, h, rgba, repeat) {
    var THREE = getTHREE();
    var tex = null;
    var mc = makeCanvas(w, h);
    if (mc) {
      var img = mc.ctx.createImageData(w, h);
      img.data.set(rgba);
      mc.ctx.putImageData(img, 0, 0);
      tex = new THREE.CanvasTexture(mc.canvas);
    } else {
      tex = new THREE.DataTexture(new Uint8Array(rgba), w, h, THREE.RGBAFormat);
      tex.needsUpdate = true;
    }
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (repeat) tex.repeat.set(repeat, repeat);
    tex.userData = tex.userData || {};
    tex.userData.localGenPixels = { w: w, h: h, data: new Uint8Array(rgba) };
    return tex;
  }

  /* ---------- vẽ map theo chất liệu (pixel buffer, seed cố định) ---------- */
  function paintMap(matId, size, rng, base) {
    var w = size, h = size;
    var buf = new Uint8ClampedArray(w * h * 4);
    var n1 = noiseField(w, h, rng, matId === 'fabric' ? 8 : (matId === 'leather' ? 12 : 32), 2);
    var n2 = noiseField(w, h, rng, matId === 'wood' ? 64 : 48, 1);
    var x, y, idx, v, a, b;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        idx = (y * w + x) * 4;
        a = n1[y * w + x]; b = n2[y * w + x];
        if (matId === 'wood') {
          /* sọc dọc uốn lượn theo vân */
          v = 0.82 + 0.16 * Math.sin(x * 0.11 + 6 * a + 2 * Math.sin(y * 0.02)) + (b - 0.5) * 0.10;
        } else if (matId === 'metal') {
          /* xước ngang + gradient nhẹ */
          v = 0.92 + 0.08 * a + 0.05 * Math.sin(y * 0.35 + b * 4) + (((x + y * 3) % 29 === 0) ? 0.08 : 0);
        } else if (matId === 'stone') {
          /* đốm noise + vết nứt tối */
          v = 0.78 + 0.42 * a;
          if (b < 0.10) v *= 0.62;
        } else if (matId === 'fabric') {
          /* lưới dệt ngang/dọc */
          var wx = ((x >> 2) & 1), wy = ((y >> 2) & 1);
          v = ((wx ^ wy) ? 1.05 : 0.90) + (a - 0.5) * 0.08;
        } else if (matId === 'leather') {
          /* đốm mịn + vết loang */
          v = (0.88 + 0.22 * a) * (0.85 + 0.3 * b);
        } else if (matId === 'dirt') {
          /* đất + sỏi sáng */
          v = 0.72 + 0.5 * a;
          if (b > 0.86) v *= 1.22;
        } else if (matId === 'grass') {
          /* lá cỏ: xanh đậm/nhạt xen kẽ theo chiều dọc */
          v = 0.80 + 0.4 * a + 0.05 * Math.sin(x * 0.9);
        } else if (matId === 'ceramic') {
          /* gần như phẳng, noise rất nhẹ */
          v = 0.96 + 0.07 * a;
        } else if (matId === 'gold') {
          /* chải ngang + lấp lánh */
          v = 0.90 + 0.10 * a + 0.07 * Math.sin(y * 0.5 + b * 3);
          if (a > 0.93) v = 1.12;
        } else { /* skin */
          /* da: mịn + tàn nhang thưa */
          v = 0.93 + 0.12 * a;
          if (b > 0.94) v *= 0.86;
        }
        buf[idx] = clamp255(base.r * v);
        buf[idx + 1] = clamp255(base.g * v);
        buf[idx + 2] = clamp255(base.b * v);
        buf[idx + 3] = 255;
      }
    }
    return buf;
  }

  /* Normal map: heightfield = noise -> Sobel -> RGB. Lấy mẫu
     wrap-around để texture lặp (RepeatWrapping) không lộ đường nối. */
  function paintNormal(size, rng, strength) {
    var w = size, h = size;
    var hf = noiseField(w, h, rng, 16, 2);
    var buf = new Uint8ClampedArray(w * h * 4);
    var s = strength || 2.0;
    var x, y, idx;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        idx = (y * w + x) * 4;
        var xl = hf[y * w + ((x - 1 + w) % w)], xr = hf[y * w + ((x + 1) % w)];
        var yt = hf[((y - 1 + h) % h) * w + x], yb = hf[((y + 1) % h) * w + x];
        var nx = -(xr - xl) * s, ny = -(yb - yt) * s, nz = 1;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        buf[idx] = clamp255((nx / len * 0.5 + 0.5) * 255);
        buf[idx + 1] = clamp255((ny / len * 0.5 + 0.5) * 255);
        buf[idx + 2] = clamp255((nz / len * 0.5 + 0.5) * 255);
        buf[idx + 3] = 255;
      }
    }
    return buf;
  }

  /* Roughness map: grayscale theo độ nhám (tối = bóng, sáng = nhám). */
  function paintRough(size, rng, rough, matId) {
    var w = size, h = size;
    var base = clamp255(rough * 255);
    var n = noiseField(w, h, rng, 24, 2);
    var buf = new Uint8ClampedArray(w * h * 4);
    var x, y, idx, v;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        idx = (y * w + x) * 4;
        v = base + (n[y * w + x] - 0.5) * 44;
        if (matId === 'metal' || matId === 'gold') v -= Math.abs(Math.sin(y * 0.4)) * 18;
        v = clamp255(v);
        buf[idx] = v; buf[idx + 1] = v; buf[idx + 2] = v; buf[idx + 3] = 255;
      }
    }
    return buf;
  }

  /* ---------- 10 chất liệu ---------- */
  LocalAutoGen.MATERIALS = [
    { id: 'wood',    label: 'Gỗ',         baseColor: '#8a5a2b', roughness: 0.85, metalness: 0.0 },
    { id: 'metal',   label: 'Kim loại',   baseColor: '#9aa2ad', roughness: 0.35, metalness: 0.9 },
    { id: 'stone',   label: 'Đá',         baseColor: '#8d8d8d', roughness: 0.95, metalness: 0.0 },
    { id: 'fabric',  label: 'Vải',        baseColor: '#7a6a9a', roughness: 0.95, metalness: 0.0 },
    { id: 'leather', label: 'Da',         baseColor: '#6b4226', roughness: 0.70, metalness: 0.05 },
    { id: 'dirt',    label: 'Đất',        baseColor: '#6e5233', roughness: 1.00, metalness: 0.0 },
    { id: 'grass',   label: 'Cỏ',         baseColor: '#4d8a3a', roughness: 1.00, metalness: 0.0 },
    { id: 'ceramic', label: 'Gốm',        baseColor: '#c8b8a0', roughness: 0.25, metalness: 0.0 },
    { id: 'gold',    label: 'Vàng',       baseColor: '#d4af37', roughness: 0.25, metalness: 1.0 },
    { id: 'skin',    label: 'Da nhân vật', baseColor: '#e8b98a', roughness: 0.60, metalness: 0.0 }
  ];

  /* ---------- textureModel ---------- */
  LocalAutoGen.textureModel = function (target, opts) {
    opts = opts || {};
    var THREE = getTHREE();
    if (!THREE) return { ok: false, material: '', size: 0, maps: [], message: 'textureModel: THREE chưa load.' };
    if (!target || !target.isObject3D) return { ok: false, material: '', size: 0, maps: [], message: 'textureModel: target không phải Object3D.' };
    var def = null, i;
    for (i = 0; i < LocalAutoGen.MATERIALS.length; i++) {
      if (LocalAutoGen.MATERIALS[i].id === opts.material) { def = LocalAutoGen.MATERIALS[i]; break; }
    }
    if (!def) {
      return { ok: false, material: String(opts.material || ''), size: 0, maps: [],
        message: 'Chất liệu không hợp lệ: "' + String(opts.material || '') + '". Chọn 1 trong: wood, metal, stone, fabric, leather, dirt, grass, ceramic, gold, skin.' };
    }
    var size = (opts.size === 256 || opts.size === 512 || opts.size === 1024) ? opts.size : 512;
    var repeat = (typeof opts.repeat === 'number' && isFinite(opts.repeat) && opts.repeat > 0) ? opts.repeat : 1;
    var rough = (typeof opts.roughness === 'number' && isFinite(opts.roughness)) ? Math.max(0, Math.min(1, opts.roughness)) : def.roughness;
    var metal = (typeof opts.metalness === 'number' && isFinite(opts.metalness)) ? Math.max(0, Math.min(1, opts.metalness)) : def.metalness;
    var baseInt = parseColor(opts.color, parseInt(def.baseColor.slice(1), 16));
    var base = hexToRgb('#' + ('000000' + baseInt.toString(16)).slice(-6));

    /* seed cố định theo chất liệu + size -> cùng chất liệu cho cùng texture */
    var seed = hashSeed('localgen-tex-' + def.id + '-' + size);
    var mapTex = bufferToTexture(size, size, paintMap(def.id, size, mulberry32(seed), base), repeat);
    var nrmTex = bufferToTexture(size, size, paintNormal(size, mulberry32(seed + 11), 2.0), repeat);
    var rghTex = bufferToTexture(size, size, paintRough(size, mulberry32(seed + 23), rough, def.id), repeat);

    var meshes = [];
    if (opts.scope === 'selection') {
      /* 'selection': chỉ mesh target trực tiếp; target là Group thì
         coi như 'all' (ghi chú trong message). */
      if (target.isMesh) meshes.push(target);
      else target.traverse(function (o) { if (o.isMesh) meshes.push(o); });
    } else {
      target.traverse(function (o) { if (o.isMesh) meshes.push(o); });
    }
    if (!meshes.length) return { ok: false, material: def.id, size: size, maps: [], message: 'textureModel: không tìm thấy mesh nào trong target.' };

    var mats = [];
    meshes.forEach(function (m) {
      var arr = Array.isArray(m.material) ? m.material : [m.material];
      arr.forEach(function (mat) {
        if (!mat) return;
        mat.map = mapTex;
        if ('normalMap' in mat) mat.normalMap = nrmTex;
        if ('roughnessMap' in mat) mat.roughnessMap = rghTex;
        if (mat.color && mat.color.setHex) mat.color.setHex(baseInt);
        if ('roughness' in mat) mat.roughness = rough;
        if ('metalness' in mat) mat.metalness = metal;
        if (mat.normalScale && mat.normalScale.set) mat.normalScale.set(1, 1);
        mat.needsUpdate = true;
        if (mats.indexOf(mat) === -1) mats.push(mat);
      });
    });
    var maps = ['map'];
    if (mats.some(function (m) { return 'normalMap' in m; })) maps.push('normalMap');
    if (mats.some(function (m) { return 'roughnessMap' in m; })) maps.push('roughnessMap');
    var msg = 'Đã gán chất liệu "' + def.label + '" (' + size + '², ' + maps.join('+') + ') cho ' +
      mats.length + ' material / ' + meshes.length + ' mesh' +
      (opts.scope === 'selection' && !target.isMesh ? ' (target là Group nên gán hết như scope all)' : '') +
      '. Texture procedural là họa tiết lặp theo chất liệu, KHÔNG vẽ theo hình dạng model như AI texturing (không biết đâu là mặt, đâu là áo).';
    if (mats.length > 0) refreshEntryStats(target);
    return { ok: mats.length > 0, material: def.id, size: size, maps: maps,
      materialsUpdated: mats.length, meshesUpdated: meshes.length, message: msg };
  };

  /* ---------- upscale: đếm tris / texture ---------- */
  function countTris(target) {
    var t = 0;
    target.traverse(function (o) {
      if (o.isMesh && o.geometry) {
        var g = o.geometry;
        if (g.index) t += g.index.count / 3;
        else if (g.attributes && g.attributes.position) t += g.attributes.position.count / 3;
      }
    });
    return Math.round(t);
  }
  function maxTextureSize(target) {
    var m = 0;
    target.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var arr = Array.isArray(o.material) ? o.material : [o.material];
      arr.forEach(function (mat) {
        if (!mat) return;
        ['map', 'normalMap', 'roughnessMap', 'bumpMap', 'emissiveMap'].forEach(function (slot) {
          var tex = mat[slot];
          if (tex && tex.image) m = Math.max(m, tex.image.width || 0, tex.image.height || 0);
        });
      });
    });
    return m;
  }

  /* Midpoint subdivide: mỗi tam giác -> 4 tam giác con (thêm đỉnh
     giữa mỗi cạnh, nối lại). Chuyển về non-indexed trước cho đơn
     giản (ghi rõ: geometry sau upscale là non-indexed). Giữ nguyên
     groups (multi-material) với count x4, nội suy cả UV, xong
     computeVertexNormals() để shading mịn. Bỏ qua morph (sẽ lệch
     morph target) — caller đếm vào skipped. */
  function subdivideOnce(geo) {
    var THREE = getTHREE();
    var src = geo.index ? geo.toNonIndexed() : geo;
    var pos = src.attributes.position;
    var uv = src.attributes.uv;
    var hasUV = !!uv;
    var p = pos.array, u = hasUV ? uv.array : null;
    var triCount = pos.count / 3;
    var outPos = new Float32Array(triCount * 36); /* 4 tris x 3 verts x 3 */
    var outUv = hasUV ? new Float32Array(triCount * 24) : null; /* 4 x 3 x 2 */
    var groups = (src.groups && src.groups.length) ? src.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
    var newGroups = [];
    var W = { p: 0, u: 0 };
    var putV = function (arr, vi) {
      outPos[W.p] = arr[vi * 3]; outPos[W.p + 1] = arr[vi * 3 + 1]; outPos[W.p + 2] = arr[vi * 3 + 2];
      W.p += 3;
    };
    var putM = function (arr, vi, vj) {
      outPos[W.p] = (arr[vi * 3] + arr[vj * 3]) / 2;
      outPos[W.p + 1] = (arr[vi * 3 + 1] + arr[vj * 3 + 1]) / 2;
      outPos[W.p + 2] = (arr[vi * 3 + 2] + arr[vj * 3 + 2]) / 2;
      W.p += 3;
    };
    var putUvV = function (arr, vi) {
      outUv[W.u] = arr[vi * 2]; outUv[W.u + 1] = arr[vi * 2 + 1];
      W.u += 2;
    };
    var putUvM = function (arr, vi, vj) {
      outUv[W.u] = (arr[vi * 2] + arr[vj * 2]) / 2;
      outUv[W.u + 1] = (arr[vi * 2 + 1] + arr[vj * 2 + 1]) / 2;
      W.u += 2;
    };
    groups.forEach(function (gr) {
      var gTris = gr.count / 3;
      var newStart = W.p / 3;
      for (var t = 0; t < gTris; t++) {
        var a = gr.start + t * 3, b = a + 1, c = a + 2;
        /* T1: a, ab, ca */
        putV(p, a); putM(p, a, b); putM(p, c, a);
        /* T2: ab, b, bc */
        putM(p, a, b); putV(p, b); putM(p, b, c);
        /* T3: ab, bc, ca */
        putM(p, a, b); putM(p, b, c); putM(p, c, a);
        /* T4: ca, bc, c */
        putM(p, c, a); putM(p, b, c); putV(p, c);
        if (hasUV) {
          putUvV(u, a); putUvM(u, a, b); putUvM(u, c, a);
          putUvM(u, a, b); putUvV(u, b); putUvM(u, b, c);
          putUvM(u, a, b); putUvM(u, b, c); putUvM(u, c, a);
          putUvM(u, c, a); putUvM(u, b, c); putUvV(u, c);
        }
      }
      newGroups.push({ start: newStart, count: gTris * 12, materialIndex: gr.materialIndex });
    });
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
    if (hasUV) out.setAttribute('uv', new THREE.BufferAttribute(outUv, 2));
    newGroups.forEach(function (gr) { out.addGroup(gr.start, gr.count, gr.materialIndex); });
    out.computeVertexNormals();
    out.computeBoundingSphere();
    return out;
  }

  /* Nội suy bilinear thuần JS (dùng khi không có canvas 2D). */
  function bilinearUpscale(src, w1, h1) {
    var w0 = src.w, h0 = src.h, s = src.data;
    var out = new Uint8ClampedArray(w1 * h1 * 4);
    var x, y, c;
    for (y = 0; y < h1; y++) {
      var sy = (y + 0.5) * h0 / h1 - 0.5;
      var y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(h0 - 1, y0 + 1);
      var fy = Math.max(0, Math.min(1, sy - y0));
      for (x = 0; x < w1; x++) {
        var sx = (x + 0.5) * w0 / w1 - 0.5;
        var x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(w0 - 1, x0 + 1);
        var fx = Math.max(0, Math.min(1, sx - x0));
        for (c = 0; c < 4; c++) {
          var v00 = s[(y0 * w0 + x0) * 4 + c], v10 = s[(y0 * w0 + x1) * 4 + c];
          var v01 = s[(y1 * w0 + x0) * 4 + c], v11 = s[(y1 * w0 + x1) * 4 + c];
          out[(y * w1 + x) * 4 + c] = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
        }
      }
    }
    return out;
  }
  /* Unsharp mask nhẹ (3x3) cho đường pixel path. */
  function unsharp(buf, w, h, amount) {
    var orig = new Uint8ClampedArray(buf);
    var x, y, c;
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        for (c = 0; c < 3; c++) {
          var i = (y * w + x) * 4 + c;
          var avg = (orig[i - 4] + orig[i + 4] + orig[i - w * 4] + orig[i + w * 4] + orig[i] * 4) / 8;
          buf[i] = clamp255(orig[i] + amount * (orig[i] - avg));
        }
      }
    }
  }

  /* Upscale 1 texture: canvas 2D drawImage (nội suy bilinear, đúng
     pattern save-manager.js) khi có canvas; không thì bilinear +
     unsharp thuần JS từ pixel đã lưu (userData.localGenPixels) hoặc
     DataTexture. Trả { ok, w, h } hoặc { ok:false, reason }. */
  function upscaleTexture(tex, factor) {
    if (!tex || !tex.image) return { ok: false, reason: 'no-image' };
    var img = tex.image;
    var w0 = img.width || 0, h0 = img.height || 0;
    if (!w0 || !h0) return { ok: false, reason: 'no-size' };
    var w1 = Math.min(2048, Math.round(w0 * factor));
    var h1 = Math.min(2048, Math.round(h0 * factor));
    if (w1 === w0 && h1 === h0) return { ok: false, reason: 'max-size' };
    var mc = makeCanvas(w1, h1);
    if (mc) {
      try {
        if (tex.flipY === false) { mc.ctx.translate(0, h1); mc.ctx.scale(1, -1); }
        mc.ctx.drawImage(img, 0, 0, w1, h1);
        tex.image = mc.canvas;
        tex.userData = tex.userData || {};
        tex.userData.localGenPixels = null; /* canvas giờ là nguồn thật */
        tex.needsUpdate = true;
        return { ok: true, w: w1, h: h1 };
      } catch (e) { /* rơi xuống pixel path */ }
    }
    var src = null;
    if (tex.userData && tex.userData.localGenPixels) src = tex.userData.localGenPixels;
    else if (img.data && img.width && img.height) src = { w: img.width, h: img.height, data: img.data };
    if (!src || !src.data) return { ok: false, reason: 'no-pixels' };
    var out = bilinearUpscale(src, w1, h1);
    unsharp(out, w1, h1, 0.5);
    tex.image = { data: out, width: w1, height: h1 };
    tex.userData = tex.userData || {};
    tex.userData.localGenPixels = { w: w1, h: h1, data: new Uint8Array(out) };
    tex.needsUpdate = true;
    return { ok: true, w: w1, h: h1 };
  }

  /* ---------- upscaleModel ---------- */
  LocalAutoGen.upscaleModel = function (target, opts) {
    opts = opts || {};
    var THREE = getTHREE();
    var empty = { tris: 0, textureSize: 0 };
    if (!THREE) return { ok: false, before: empty, after: empty, message: 'upscaleModel: THREE chưa load.' };
    if (!target || !target.isObject3D) return { ok: false, before: empty, after: empty, message: 'upscaleModel: target không phải Object3D.' };
    var level = (opts.level === 4) ? 4 : 2;
    var scope = (opts.scope === 'mesh' || opts.scope === 'texture') ? opts.scope : 'both';
    var factor = level; /* level 2 -> x2 (256->512), level 4 -> x4 (256->1024) */
    var passes = (level === 4) ? 2 : 1;
    var before = { tris: countTris(target), textureSize: maxTextureSize(target) };
    var meshesUp = 0, texUp = 0, skipped = 0, skinned = false;
    if (scope !== 'texture') {
      var meshes = [];
      target.traverse(function (o) { if (o.isMesh) meshes.push(o); });
      meshes.forEach(function (m) {
        if (m.isSkinnedMesh) {
          /* KHÔNG subdivide geometry của SkinnedMesh (sẽ vỡ skin):
             chỉ recompute normals + upscale texture, ghi rõ lý do. */
          skinned = true; skipped++;
          try { if (m.geometry) m.geometry.computeVertexNormals(); } catch (e) {}
          return;
        }
        var g = m.geometry;
        if (!g || !g.attributes || !g.attributes.position) { skipped++; return; }
        if (g.attributes.skinIndex || g.attributes.skinWeight) { skinned = true; skipped++; return; }
        if (g.morphAttributes && Object.keys(g.morphAttributes).length) { skipped++; return; }
        try {
          var ng = g;
          for (var p = 0; p < passes; p++) ng = subdivideOnce(ng);
          m.geometry = ng;
          meshesUp++;
        } catch (e) { skipped++; }
      });
    }
    if (scope !== 'mesh') {
      var seen = [];
      target.traverse(function (o) {
        if (!o.isMesh || !o.material) return;
        var arr = Array.isArray(o.material) ? o.material : [o.material];
        arr.forEach(function (mat) {
          if (!mat) return;
          ['map', 'normalMap', 'roughnessMap'].forEach(function (slot) {
            var tex = mat[slot];
            if (!tex || seen.indexOf(tex) !== -1) return;
            seen.push(tex);
            var r = upscaleTexture(tex, factor);
            if (r.ok) texUp++; else skipped++;
          });
        });
      });
    }
    var after = { tris: countTris(target), textureSize: maxTextureSize(target) };
    var msg = 'Upscale local level ' + level + ' (' + scope + '): tris ' + before.tris + ' -> ' + after.tris +
      ', texture lớn nhất ' + before.textureSize + ' -> ' + after.textureSize + '. ';
    if (meshesUp) msg += meshesUp + ' mesh đã subdivide (x' + Math.pow(4, passes) + ' tris, non-indexed). ';
    if (texUp) msg += texUp + ' texture đã upscale (nội suy bilinear, KHÔNG thêm chi tiết thật). ';
    if (skinned) msg += 'SkinnedMesh KHÔNG subdivide geometry (sẽ vỡ skin) — chỉ recompute normals + upscale texture. ';
    if (skipped) msg += skipped + ' mục bỏ qua (không có image / morph / đã max 2048). ';
    msg += 'Giới hạn: upscale local là nội suy/làm mịn, KHÔNG tạo thêm chi tiết thật như AI cloud.';
    refreshEntryStats(target);
    return { ok: true, before: before, after: after, message: msg,
      meshesUpgraded: meshesUp, texturesUpgraded: texUp, skipped: skipped, skinnedSkipped: skinned };
  };

  /* ---------- export ---------- */
  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  try {
    root.PixiStudio = root.PixiStudio || {};
    root.PixiStudio.AI = root.PixiStudio.AI || {};
    root.PixiStudio.AI.LocalAutoGen = LocalAutoGen;
  } catch (e) {}
})();
