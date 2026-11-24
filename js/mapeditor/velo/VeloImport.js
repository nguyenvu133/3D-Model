/* ============================================================
 * mapeditor/velo/VeloImport.js — Parser + importer định dạng
 * .scene của Velo (game engine ngôn ngữ V, kiến trúc Node +
 * Component kiểu Unity). CHỈ parse định dạng .scene công khai,
 * KHÔNG copy source code Velo.
 *
 * Định dạng .scene (text): node lồng nhau, component
 * `Tên { key = value ... }`, giá trị: số, chuỗi "...",
 * [r, g, b(, a)], @asset("id"), true/false. Comment bắt đầu
 * bằng `#`. Prefab instance: `node Tên from @asset("id") { ... }`.
 * Đơn vị mét, y-up, model quay mặt +z. Transform3D:
 * position/rotation (euler ĐỘ)/scale.
 *
 * Vanilla JS, parser thuần (không cần THREE/DOM) để test được
 * bằng node. Phần dựng vào MapEditor chỉ chạy trong browser.
 * ============================================================ */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  root.MapEditor = root.MapEditor || {};
  var ME = root.MapEditor;

  var DEMO_URL = 'https://raw.githubusercontent.com/velo-engine/velo/3d/examples/demo3d/assets/scenes/main.scene';
  var HERO_MODEL_ID = 'a3d0f8b1'; /* assets/models/than_dieu_run.fbx — Thần Điêu Fast Run */
  var HERO_FBX_LOCAL = 'models/thandieu/Than_dieu_Fast_Run.fbx';

  /* 2D-only: import thì bỏ qua cả subtree, chỉ ghi log. */
  var HUD_COMPONENTS = ['Canvas', 'Label', 'Widget', 'UITransform', 'ProgressBar', 'StatsLabel'];
  /* Component chỉ là game logic V — không có đối tượng 3D tương đương. */
  var LOGIC_COMPONENTS = ['HeroController', 'HeroCombat', 'Health', 'FollowCamera', 'SlimeHop',
    'DroneHover', 'DroneGun', 'GolemWalk', 'GolemSlam', 'HealZone', 'OrbPickup',
    'Spin3D', 'Bob3D', 'Pulse3D', 'Trail3D'];

  /* ---------- tokenizer ---------- */
  function VeloParseError(message, line) {
    this.name = 'VeloParseError';
    this.message = 'Velo .scene lỗi dòng ' + line + ': ' + message;
    this.line = line;
  }
  VeloParseError.prototype = Object.create(Error.prototype);

  function tokenize(text) {
    var tokens = [];
    var i = 0, line = 1;
    while (i < text.length) {
      var ch = text[i];
      if (ch === '\n') { line++; i++; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
      if (ch === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
      if (ch === '"') {
        var j = i + 1, s = '';
        while (j < text.length && text[j] !== '"') {
          if (text[j] === '\\' && j + 1 < text.length) { s += text[j + 1]; j += 2; }
          else { s += text[j]; j++; }
        }
        if (j >= text.length) throw new VeloParseError('chuỗi không đóng ngoặc kép', line);
        tokens.push({ t: 'string', v: s, line: line });
        i = j + 1;
        continue;
      }
      if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === '=' || ch === ',') {
        tokens.push({ t: 'punct', v: ch, line: line });
        i++;
        continue;
      }
      if (text.slice(i, i + 6) === '@asset') {
        var k = i + 6;
        while (k < text.length && /\s/.test(text[k])) k++;
        if (text[k] !== '(') throw new VeloParseError('@asset thiếu "("', line);
        k++;
        while (k < text.length && /\s/.test(text[k])) k++;
        if (text[k] !== '"') throw new VeloParseError('@asset cần id dạng "..."', line);
        var m = k + 1, id = '';
        while (m < text.length && text[m] !== '"') { id += text[m]; m++; }
        if (m >= text.length) throw new VeloParseError('@asset thiếu dấu " đóng', line);
        m++;
        while (m < text.length && /\s/.test(text[m])) m++;
        if (text[m] !== ')') throw new VeloParseError('@asset thiếu ")"', line);
        tokens.push({ t: 'asset', v: id, line: line });
        i = m + 1;
        continue;
      }
      if (/[0-9\-]/.test(ch)) {
        var num = text.slice(i).match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/);
        if (num) { tokens.push({ t: 'number', v: parseFloat(num[0]), line: line }); i += num[0].length; continue; }
      }
      if (/[A-Za-z_]/.test(ch)) {
        var idm = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
        tokens.push({ t: 'ident', v: idm[0], line: line });
        i += idm[0].length;
        continue;
      }
      throw new VeloParseError('ký tự lạ "' + ch + '"', line);
    }
    tokens.push({ t: 'eof', v: null, line: line });
    return tokens;
  }

  /* ---------- parser ---------- */
  function Parser(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  Parser.prototype.peek = function (n) { return this.tokens[Math.min(this.pos + (n || 0), this.tokens.length - 1)]; };
  Parser.prototype.next = function () { return this.tokens[this.pos++]; };
  Parser.prototype.err = function (msg, tok) {
    throw new VeloParseError(msg, (tok || this.peek()).line);
  };
  Parser.prototype.expectPunct = function (ch) {
    var tok = this.next();
    if (tok.t !== 'punct' || tok.v !== ch) this.err('cần "' + ch + '" nhưng gặp ' + (tok.v === null ? 'hết file' : '"' + tok.v + '"'), tok);
  };
  Parser.prototype.parseValue = function () {
    var tok = this.next();
    if (tok.t === 'number' || tok.t === 'string') return tok.v;
    if (tok.t === 'asset') return { asset: tok.v };
    if (tok.t === 'ident') {
      if (tok.v === 'true') return true;
      if (tok.v === 'false') return false;
      return tok.v;
    }
    if (tok.t === 'punct' && tok.v === '[') {
      var arr = [];
      while (true) {
        var p = this.peek();
        if (p.t === 'punct' && p.v === ']') { this.next(); break; }
        if (p.t === 'eof') this.err('mảng [...] không đóng', p);
        arr.push(this.parseValue());
        var sep = this.peek();
        if (sep.t === 'punct' && sep.v === ',') this.next();
      }
      return arr;
    }
    this.err('giá trị không hợp lệ', tok);
    return null;
  };
  /* props trong component: key = value (phân tách bằng khoảng trắng) */
  Parser.prototype.parseProps = function () {
    var props = {};
    while (true) {
      var tok = this.peek();
      if (tok.t === 'punct' && tok.v === '}') return props;
      if (tok.t === 'eof') this.err('component { ... } không đóng', tok);
      if (tok.t !== 'ident') this.err('cần tên key, gặp "' + tok.v + '"', tok);
      var key = this.next().v;
      var eq = this.next();
      if (eq.t !== 'punct' || eq.v !== '=') this.err('sau key "' + key + '" cần "="', eq);
      props[key] = this.parseValue();
    }
  };
  Parser.prototype.parseNode = function () {
    var kw = this.next();
    if (kw.t !== 'ident' || kw.v !== 'node') this.err('cần từ khoá "node"', kw);
    var nameTok = this.next();
    if (nameTok.t !== 'ident') this.err('sau "node" cần tên node', nameTok);
    var node = { name: nameTok.v, from: null, props: {}, components: [], children: [], line: nameTok.line };
    var tok = this.peek();
    if (tok.t === 'ident' && tok.v === 'from') {
      this.next();
      var assetTok = this.next();
      if (assetTok.t !== 'asset') this.err('sau "from" cần @asset("id")', assetTok);
      node.from = assetTok.v;
    }
    this.expectPunct('{');
    while (true) {
      var it = this.peek();
      if (it.t === 'punct' && it.v === '}') { this.next(); break; }
      if (it.t === 'eof') this.err('node "' + node.name + '" thiếu "}" đóng', it);
      if (it.t === 'ident' && it.v === 'node') {
        node.children.push(this.parseNode());
        continue;
      }
      if (it.t === 'ident') {
        var n2 = this.peek(1);
        if (n2.t === 'punct' && n2.v === '{') {
          var compName = this.next().v;
          this.next(); /* '{' */
          node.components.push({ name: compName, props: this.parseProps() });
          this.expectPunct('}');
          continue;
        }
        if (n2.t === 'punct' && n2.v === '=') {
          var key = this.next().v;
          this.next(); /* '=' */
          node.props[key] = this.parseValue();
          continue;
        }
        this.err('trong node "' + node.name + '": sau "' + it.v + '" cần "{" (component) hoặc "=" (prop)', it);
      }
      this.err('nội dung node "' + node.name + '" không hợp lệ', it);
    }
    return node;
  };
  Parser.prototype.parseDocument = function () {
    var nodes = [];
    while (this.peek().t !== 'eof') {
      nodes.push(this.parseNode());
    }
    return nodes;
  };

  function parse(text) {
    if (typeof text !== 'string' || !text.trim()) throw new VeloParseError('file .scene rỗng', 1);
    return new Parser(tokenize(text)).parseDocument();
  }

  /* ---------- tiện ích cây ---------- */
  function countNodes(node) {
    var n = 1;
    node.children.forEach(function (c) { n += countNodes(c); });
    return n;
  }
  function walkNodes(node, fn) {
    fn(node);
    node.children.forEach(function (c) { walkNodes(c, fn); });
  }
  function findNodes(nodes, pred) {
    var out = [];
    nodes.forEach(function (n) { walkNodes(n, function (x) { if (pred(x)) out.push(x); }); });
    return out;
  }
  function comp(node, name) {
    for (var i = 0; i < node.components.length; i++) {
      if (node.components[i].name === name) return node.components[i].props;
    }
    return null;
  }
  function isHUDSubtree(node) {
    if (node.name === 'HUD') return true;
    return node.components.some(function (c) { return HUD_COMPONENTS.indexOf(c.name) >= 0; });
  }

  /* ---------- chuyển đổi số ---------- */
  function rgbToHex(arr) {
    if (!Array.isArray(arr) || arr.length < 3) return null;
    var r = Math.max(0, Math.min(255, Math.round(arr[0])));
    var g = Math.max(0, Math.min(255, Math.round(arr[1])));
    var b = Math.max(0, Math.min(255, Math.round(arr[2])));
    return (r << 16) | (g << 8) | b;
  }
  function hexToRgb(hex) {
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  }
  function degToRad(d) { return d * Math.PI / 180; }
  function num(v, def) { return typeof v === 'number' && isFinite(v) ? v : def; }
  function vec3(arr, def) {
    if (!Array.isArray(arr)) return def.slice();
    return [num(arr[0], def[0]), num(arr[1], def[1]), num(arr[2], def[2])];
  }

  /* MapEditor primitive 1 đơn vị khác kích thước mesh gốc Velo:
   * box 1x1x1, sphere r=0.6 (đk 1.2), cylinder h=1.2 r=0.5,
   * cone r=0.6 h=1.2, plane 2x2, portal torus r=2.6. */
  var MESH_MAP = {
    cube: { type: 'box', s: [1, 1, 1] },
    sphere: { type: 'sphere', s: [1 / 1.2, 1 / 1.2, 1 / 1.2] },
    cylinder: { type: 'cylinder', s: [1, 1 / 1.2, 1] },
    cone: { type: 'cone', s: [1 / 1.2, 1 / 1.2, 1 / 1.2] },
    plane: { type: 'plane', s: [1 / 2, 1, 1 / 2] },
    grid: { type: 'plane', s: [1 / 2, 1, 1 / 2] },
    disc: { type: 'plane', s: [1 / 2, 1, 1 / 2] },
    ring: { type: 'plane', s: [1 / 2, 1, 1 / 2] },
    torus: { type: 'portal', s: [1 / 2.6, 1 / 2.6, 1 / 2.6] },
    capsule: { type: 'cylinder', s: [1, 1 / 1.2, 1] }
  };

  /* Particles3D preset → type MapEditor hiển thị được (xem docs). */
  var PARTICLE_TYPE = {
    fire: 'campfire', embers: 'campfire', portal: 'portal', heal: 'sphere',
    sparkle: 'sphere', magic: 'sphere', dust: 'box', smoke: 'box',
    fireflies: 'lantern', snow: 'box', rain: 'box', explosion: 'sphere'
  };
  var PARTICLE_COLOR = {
    fire: 0xff8a2a, embers: 0xff6a1a, portal: 0x9d4edd, heal: 0x78e696,
    sparkle: 0xffdc78, magic: 0xaa55ff, dust: 0xccbb99, smoke: 0x888888,
    fireflies: 0xffe9a0, snow: 0xffffff, rain: 0x7ac8e8, explosion: 0xff5522
  };

  /* ---------- chuyển cây .scene → SceneData ---------- */
  function treeToSceneData(nodes, opts) {
    opts = opts || {};
    var name = opts.name || 'Velo demo3d';
    var out = {
      data: null, objects: [], warnings: [], skipped: 0, skippedNames: [],
      env: null, camera: null, terrainSize: 112, heroId: null,
      prefabIds: [], spawnerCount: 0
    };
    var usedNames = {};
    var idCounter = 0;
    function newId() {
      idCounter++;
      if (ME.SceneData && ME.SceneData.newId) return ME.SceneData.newId('velo');
      return 'velo_' + Date.now().toString(36) + '_' + idCounter;
    }
    function uniqueName(base) {
      var n = base;
      var k = 2;
      while (usedNames[n]) { n = base + '_' + k; k++; }
      usedNames[n] = true;
      return n;
    }
    function groupFor(type) {
      if (ME.SceneData && ME.SceneData.TYPE_GROUP) return ME.SceneData.TYPE_GROUP[type] || 'Props';
      return { hero: 'Characters', monster: 'Characters', boss: 'Characters', light: 'Lighting' }[type] || 'Props';
    }
    function makeObj(name, type, t, extra) {
      var o = {
        id: newId(), type: type, name: uniqueName(name),
        group: groupFor(type),
        position: [round3(t.pos[0]), round3(t.pos[1]), round3(t.pos[2])],
        rotation: [degToRad(t.rot[0]), degToRad(t.rot[1]), degToRad(t.rot[2])],
        scale: [round3(t.scale[0]), round3(t.scale[1]), round3(t.scale[2])],
        color: null, material: null, collider: null, light: null,
        path: null, anim: null, url: null, placeholder: false,
        locked: false, visible: true,
        /* Velo asset id top-level để Inspector + SceneData.toShared/
         * fromShared nhận diện: model SkinnedModel3D (extra.modelId) hoặc
         * prefab instance/placeholder (extra.prefabId). */
        veloId: (extra && (extra.veloId || extra.prefabId || extra.modelId)) || null,
        velo: extra || {}
      };
      out.objects.push(o);
      return o;
    }
    function round3(v) { return Math.round(v * 1000) / 1000; }

    function getTransform(node) {
      var tr = comp(node, 'Transform3D') || {};
      return {
        pos: vec3(tr.position, [0, 0, 0]),
        rot: vec3(tr.rotation, [0, 0, 0]),
        scale: vec3(tr.scale, [1, 1, 1])
      };
    }
    function compose(parent, child) {
      return {
        pos: [parent.pos[0] + parent.scale[0] * child.pos[0],
              parent.pos[1] + parent.scale[1] * child.pos[1],
              parent.pos[2] + parent.scale[2] * child.pos[2]],
        rot: [parent.rot[0] + child.rot[0], parent.rot[1] + child.rot[1], parent.rot[2] + child.rot[2]],
        scale: [parent.scale[0] * child.scale[0], parent.scale[1] * child.scale[1], parent.scale[2] * child.scale[2]]
      };
    }
    function lightFrom(props) {
      return {
        color: rgbToHex(props.color) !== null ? rgbToHex(props.color) : 0xfff2cc,
        intensity: num(props.intensity, 1),
        distance: num(props.range, 10)
      };
    }
    function applyColor(obj, meshProps) {
      if (!meshProps) return;
      var hex = rgbToHex(meshProps.color);
      if (hex !== null) obj.color = hex;
      if (Array.isArray(meshProps.color) && meshProps.color.length >= 4) {
        var a = Math.max(0, Math.min(255, meshProps.color[3])) / 255;
        if (a < 1) obj.material = { opacity: Math.round(a * 100) / 100 };
      }
      if (meshProps.emissive) obj.velo.emissive = hexToRgb(rgbToHex(meshProps.emissive) || 0);
      if (meshProps.blend) obj.velo.blend = meshProps.blend;
      if (meshProps.pattern) obj.velo.pattern = meshProps.pattern;
    }

    /* walk là async vì prefab resolve có thể fetch. */
    function walk(node, ctx, instance) {
      if (isHUDSubtree(node)) {
        var n = countNodes(node);
        out.skipped += n;
        out.skippedNames.push(node.name + ' (' + n + ' node 2D)');
        return Promise.resolve([]);
      }
      var t = compose(ctx, getTransform(node));
      var created = [];

      /* --- prefab instance: mở rộng cây prefab, áp override --- */
      if (node.from) {
        if (out.prefabIds.indexOf(node.from) < 0) out.prefabIds.push(node.from);
        var lib = ME.VeloPrefabLibrary;
        if (!lib || !lib.resolve) {
          out.warnings.push('không có VeloPrefabLibrary — prefab ' + node.name + ' (' + node.from + ') thành placeholder box');
          var ph = makeObj(node.name, 'box', t, { prefabId: node.from, prefabMissing: true });
          ph.placeholder = true;
          return Promise.resolve([ph]);
        }
        return lib.resolve(node.from).then(function (prefabTree) {
          if (!prefabTree) {
            out.warnings.push('không resolve được prefab ' + node.from + ' cho ' + node.name + ' — placeholder box');
            var ph2 = makeObj(node.name, 'box', t, { prefabId: node.from, prefabMissing: true });
            ph2.placeholder = true;
            return [ph2];
          }
          var instKey = node.name + '@' + node.from;
          var inst = { key: instKey, prefabId: node.from, name: node.name, transform: t };
          /* Transform3D ở root prefab (VD Drone [0,2.2,0], Orb [0,1,0])
           * cộng vào transform của instance; riêng prefabTransform
           * lưu cho export vẫn là override của instance. */
          var tRoot = compose(t, getTransform(prefabTree));
          var before = out.objects.length;
          /* components ở root prefab (VD Crystal PointLight, Drone PointLight) */
          return walkComponentsAsObjects(prefabTree, tRoot, inst).then(function (rootObjs) {
            rootObjs.forEach(function (o) { created.push(o); });
            var childJobs = prefabTree.children.map(function (ch) { return walk(ch, tRoot, inst); });
            return Promise.all(childJobs);
          }).then(function (childLists) {
            childLists.forEach(function (list) { list.forEach(function (o) { created.push(o); }); });
            /* override của instance: node con cùng tên trong `node X from ...` */
            node.children.forEach(function (ov) {
              var target = null;
              created.forEach(function (o) {
                if (o.velo && o.velo.prefabChild === ov.name && o.velo.prefabInstance === instKey) target = o;
              });
              if (!target) return;
              var ovMesh = comp(ov, 'MeshRenderer3D');
              if (ovMesh) {
                if (!target.velo.prefabDefault) target.velo.prefabDefault = {};
                if (target.color !== null && target.color !== undefined) target.velo.prefabDefault.color = target.color;
                applyColor(target, ovMesh);
                target.velo.overridden = true;
              }
            });
            if (created.length) {
              created[0].velo.prefabRoot = true;
              created[0].velo.prefabTransform = {
                position: [round3(t.pos[0]), round3(t.pos[1]), round3(t.pos[2])],
                rotation: [round3(t.rot[0]), round3(t.rot[1]), round3(t.rot[2])],
                scale: [round3(t.scale[0]), round3(t.scale[1]), round3(t.scale[2])]
              };
              created[0].velo.prefabInstanceName = node.name;
            }
            /* gắn Velo asset id lên mọi object của instance (cả con trong
             * prefab) để Inspector + shared format nhận diện. */
            created.forEach(function (o) { if (!o.veloId) o.veloId = node.from; });
            return created;
          });
        });
      }

      /* --- Environment / Sun / Camera: không thành object --- */
      var envProps = comp(node, 'Environment3D');
      if (envProps) {
        out.env = out.env || {};
        if (envProps.sky) out.env.sky = rgbToHex(envProps.sky);
        if (envProps.fog_color) out.env.fogColor = rgbToHex(envProps.fog_color);
        if (envProps.fog_density !== undefined) out.env.fogDensity = num(envProps.fog_density, 0.028);
        if (envProps.ambient !== undefined) out.env.ambient = num(envProps.ambient, 0.85);
        if (envProps.ground) out.env.ground = rgbToHex(envProps.ground);
      }
      var dirProps = comp(node, 'DirectionalLight3D');
      if (dirProps) {
        out.env = out.env || {};
        out.env.sun = {
          color: rgbToHex(dirProps.color) !== null ? rgbToHex(dirProps.color) : 0xfff2cc,
          intensity: num(dirProps.intensity, 1),
          direction: vec3(dirProps.direction, [-0.5, -1, -0.35])
        };
      }
      var camProps = comp(node, 'Camera3D');
      var followProps = comp(node, 'FollowCamera');
      if (camProps || followProps) {
        out.camera = {
          fov: camProps ? num(camProps.fov, 55) : 55,
          target: followProps ? followProps.target : null,
          distance: followProps ? num(followProps.distance, 7.5) : 7.5,
          height: followProps ? num(followProps.height, 3.2) : 3.2,
          position: [round3(t.pos[0]), round3(t.pos[1]), round3(t.pos[2])]
        };
      }

      var mesh = comp(node, 'MeshRenderer3D');
      var skinned = comp(node, 'SkinnedModel3D');
      var parts = comp(node, 'Particles3D');
      var plight = comp(node, 'PointLight3D');
      var spawner = comp(node, 'OrbSpawner');
      var pathRunner = comp(node, 'PathRunner');

      /* Ground grid → terrain, không thành object. */
      if (node.name === 'Ground' && mesh && mesh.mesh === 'grid') {
        out.terrainSize = Math.max(Math.round(t.scale[0]), Math.round(t.scale[2]), 32);
        out.env = out.env || {};
        if (mesh.color) out.env.groundColor = rgbToHex(mesh.color);
        var groundJobs = node.children.map(function (ch) { return walk(ch, t, instance); });
        return Promise.all(groundJobs).then(function (lists) {
          var created = [];
          lists.forEach(function (list) { list.forEach(function (o) { created.push(o); }); });
          return created;
        });
      }

      var jobs = [];
      if (spawner) {
        var count = Math.max(1, Math.min(50, Math.round(num(spawner.count, 10))));
        var radius = num(spawner.radius, 15);
        var prefabId = spawner.prefab && spawner.prefab.asset ? spawner.prefab.asset : 'd3a10002';
        if (out.prefabIds.indexOf(prefabId) < 0) out.prefabIds.push(prefabId);
        out.spawnerCount += count;
        for (var i = 0; i < count; i++) {
          var ang = (i / count) * Math.PI * 2;
          var o = makeObj('Orb_' + (i + 1), 'sphere', {
            pos: [t.pos[0] + radius * Math.cos(ang), 1, t.pos[2] + radius * Math.sin(ang)],
            rot: [0, 0, 0], scale: [0.35, 0.35, 0.35]
          }, {
            prefabId: prefabId, spawnerKey: node.name,
            spawner: { prefabId: prefabId, count: count, radius: radius, center: [round3(t.pos[0]), round3(t.pos[2])] }
          });
          o.color = 0xffdc78;
          created.push(o);
        }
      } else if (skinned) {
        var modelId = skinned.model && skinned.model.asset ? skinned.model.asset : null;
        var isHero = /hero/i.test(node.name);
        var o2 = makeObj(node.name, isHero ? 'hero' : 'monster', t, {
          modelId: modelId, clip: skinned.clip || 'mixamo.com',
          skinned: true, speed: num(skinned.speed, 1)
        });
        if (modelId === HERO_MODEL_ID && isHero) out.heroId = o2.id;
        if (skinned.color) o2.color = rgbToHex(skinned.color);
        if (skinned.rim !== undefined) o2.velo.rim = num(skinned.rim, 0);
        o2.anim = 'Idle';
        if (pathRunner) {
          var pr = { radius: num(pathRunner.radius, 10), speed: num(pathRunner.speed, 5), phase: num(pathRunner.phase, 0) };
          o2.velo.pathRunner = pr;
          var pts = [];
          for (var k = 0; k < 8; k++) {
            var a2 = pr.phase + (k / 8) * Math.PI * 2;
            pts.push([Math.round((t.pos[0] + pr.radius * Math.cos(a2)) * 10) / 10, Math.round((t.pos[2] + pr.radius * Math.sin(a2)) * 10) / 10]);
          }
          o2.path = pts;
        }
        if (plight) o2.light = lightFrom(plight);
        created.push(o2);
      } else if (mesh || parts || plight) {
        var obj = null;
        if (mesh) {
          var mm = MESH_MAP[mesh.mesh] || MESH_MAP.cube;
          if (!MESH_MAP[mesh.mesh]) out.warnings.push('mesh lạ "' + mesh.mesh + '" ở ' + node.name + ' → box');
          var mt = {
            pos: t.pos, rot: t.rot,
            scale: [t.scale[0] * mm.s[0], t.scale[1] * mm.s[1], t.scale[2] * mm.s[2]]
          };
          obj = makeObj(node.name, mm.type, mt, { mesh: mesh.mesh });
          if (mesh.mesh === 'grid' || mesh.mesh === 'plane' || mesh.mesh === 'disc') obj.velo.groundPlane = true;
          applyColor(obj, mesh);
          if (parts) obj.velo.particles = { preset: parts.preset || 'sparkle', rate: num(parts.rate, 0), radius: num(parts.radius, 0) };
        } else if (parts) {
          var preset = parts.preset || 'sparkle';
          var ptype = PARTICLE_TYPE[preset] || 'sphere';
          obj = makeObj(node.name, ptype, {
            pos: t.pos, rot: t.rot, scale: [0.5, 0.5, 0.5]
          }, {
            component: 'Particles3D', preset: preset, rate: num(parts.rate, 0),
            radius: num(parts.radius, 0), box: parts.box || null
          });
          obj.color = PARTICLE_COLOR[preset] !== undefined ? PARTICLE_COLOR[preset] : 0xffffff;
          if (preset === 'fire' || preset === 'embers') obj.scale = [1, 1, 1];
        } else {
          obj = makeObj(node.name, 'light', t, { component: 'PointLight3D' });
        }
        if (plight) obj.light = lightFrom(plight);
        if (instance) {
          obj.velo.prefabInstance = instance.key;
          obj.velo.prefabId = instance.prefabId;
          obj.velo.prefabChild = node.name;
          obj.velo.prefabInstanceName = instance.name;
          if (mesh && mesh.color) {
            obj.velo.prefabDefault = { color: rgbToHex(mesh.color) };
          }
        }
        created.push(obj);
      } else if (node.children.length === 0) {
        /* node lá chỉ có logic V (Health, HeroController...) → bỏ qua, ghi log */
        var logicNames = node.components.map(function (c) { return c.name; }).filter(function (n) { return LOGIC_COMPONENTS.indexOf(n) >= 0; });
        if (logicNames.length || node.components.length) {
          out.skipped += 1;
          out.skippedNames.push(node.name + ' (' + (logicNames.join(',') || 'logic-only') + ')');
        }
      }
      /* logic đính kèm object (Health, PathRunner...) thì giữ lại trong velo meta */
      if (created.length) {
        var health = comp(node, 'Health');
        if (health) created[0].velo.health = { max: num(health.max, 0) };
        if (pathRunner && !skinned) created[0].velo.pathRunner = { radius: num(pathRunner.radius, 10), speed: num(pathRunner.speed, 5), phase: num(pathRunner.phase, 0) };
        var spin = comp(node, 'Spin3D');
        if (spin) created[0].velo.spin = true;
      }

      node.children.forEach(function (ch) {
        jobs.push(walk(ch, t, instance));
      });
      return Promise.all(jobs).then(function (lists) {
        lists.forEach(function (list) { list.forEach(function (o) { created.push(o); }); });
        return created;
      });
    }

    /* Components ở root của prefab (không có mesh con): VD PointLight3D
     * ở root Crystal/Drone, Particles3D ở root HealSpring. */
    function walkComponentsAsObjects(prefabRoot, t, instance) {
      var fake = {
        name: prefabRoot.name, from: null, props: {},
        components: prefabRoot.components.filter(function (c) {
          return c.name === 'PointLight3D' || c.name === 'Particles3D';
        }),
        children: [], line: prefabRoot.line
      };
      if (!fake.components.length) return Promise.resolve([]);
      return walk(fake, t, instance);
    }

    var roots = nodes.slice();
    var jobs = roots.map(function (r) {
      return walk(r, { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] }, null);
    });
    return Promise.all(jobs).then(function () {
      var seg = 64;
      var n = (seg + 1) * (seg + 1);
      var heights = new Array(n).fill(0);
      var paint = new Array(n).fill(0); /* layer grass */
      var env = {
        weather: 'snow',
        sky: out.env && out.env.sky !== undefined ? out.env.sky : 0x96a5dc,
        fog: {
          color: out.env && out.env.fogColor !== undefined ? out.env.fogColor : 0x6e74a0,
          near: 60,
          far: out.env && out.env.fogDensity ? Math.max(60, Math.min(400, Math.round(3 / out.env.fogDensity))) : 180
        },
        sun: (out.env && out.env.sun) ? out.env.sun : { color: 0xffe2c8, intensity: 1.05 },
        timeOfDay: 18,
        snow: false
      };
      out.data = {
        format: 'mapeditor-scene-1',
        name: name,
        version: '1.0',
        savedAt: new Date().toISOString(),
        template: 'custom',
        terrain: { size: out.terrainSize, segments: seg, heights: heights, paint: paint },
        environment: env,
        objects: out.objects
      };
      return out;
    });
  }

  /* ---------- dựng vào MapEditor (browser) ---------- */
  function refreshPanels() {
    try { if (ME.Hierarchy && ME.Hierarchy.render) ME.Hierarchy.render(); } catch (e) { }
    try { if (ME.Inspector && ME.Inspector.render) ME.Inspector.render(); } catch (e) { }
    try { if (ME.AssetManager && ME.AssetManager.render) ME.AssetManager.render(); } catch (e) { }
  }

  function importScene(text, opts) {
    opts = opts || {};
    var nodes;
    try {
      nodes = parse(text);
    } catch (e) {
      if (ME.MapEditor && ME.MapEditor.notify) ME.MapEditor.notify('Import Velo lỗi', e.message, 'error');
      return Promise.reject(e);
    }
    return treeToSceneData(nodes, { name: opts.name || 'Velo demo3d' }).then(function (res) {
      if (!ME.MapEditor || !ME.MapEditor.loadData) {
        return res; /* môi trường test: chỉ trả data, không dựng scene */
      }
      if (ME.MapEditor.data) {
        try { ME.MapEditor.pushUndo('Import Velo'); } catch (e) { }
      }
      var ok = ME.MapEditor.loadData(res.data);
      if (!ok) return Promise.reject(new Error('loadData từ chối scene đã convert'));
      /* đăng ký prefab Velo vào AssetManager nếu có */
      if (ME.VeloPrefabLibrary && ME.VeloPrefabLibrary.registerAsset) {
        res.prefabIds.forEach(function (id) { ME.VeloPrefabLibrary.registerAsset(id); });
      }
      refreshPanels();
      /* Thần Điêu FBX thật nếu có file local, không thì giữ hero chibi + ghi rõ */
      var heroObj = null;
      if (res.heroId) heroObj = ME.MapEditor.getObjectData(res.heroId);
      if (heroObj && ME.MapEditor._loadThandieuFBX) {
        fetch(HERO_FBX_LOCAL, { method: 'HEAD' }).then(function (r) {
          if (r.ok) return ME.MapEditor._loadThandieuFBX(heroObj.id, HERO_FBX_LOCAL);
          res.warnings.push('chưa có ' + HERO_FBX_LOCAL + ' trong repo — Hero giữ dạng chibi, upload file FBX rồi import lại để có Thần Điêu thật');
          ME.MapEditor.notify('Thần Điêu', 'Chưa có ' + HERO_FBX_LOCAL + ' — Hero giữ dạng chibi.', 'warning');
          return false;
        }).catch(function () { /* đã notify ở trên hoặc bỏ qua */ });
      }
      if (res.heroId) {
        try {
          ME.MapEditor.select(res.heroId);
          ME.MapEditor.focusSelected();
        } catch (e) { }
      } else if (res.camera) {
        try { ME.MapEditor.focusSelected(); } catch (e) { }
      }
      var msg = 'Đã import ' + res.objects.length + ' object' +
        (res.skipped ? ', bỏ qua ' + res.skipped + ' node (' + res.skippedNames.slice(0, 6).join('; ') + (res.skippedNames.length > 6 ? '…' : '') + ')' : '');
      if (res.warnings.length) msg += ' · ' + res.warnings.length + ' cảnh báo (xem console)';
      res.warnings.forEach(function (w) { if (typeof console !== 'undefined') console.warn('[VeloImport]', w); });
      ME.MapEditor.notify('Import Velo', msg, 'success');
      res.message = msg;
      return res;
    });
  }

  function importDemo3d(opts) {
    opts = opts || {};
    if (typeof fetch === 'undefined') {
      return Promise.reject(new Error('trình duyệt này không có fetch'));
    }
    if (ME.MapEditor && ME.MapEditor.setStatus) ME.MapEditor.setStatus('Đang tải demo3d Velo từ GitHub…');
    return fetch(DEMO_URL).then(function (r) {
      if (!r.ok) throw new Error('tải main.scene lỗi HTTP ' + r.status + ' — thử chọn file .scene local');
      return r.text();
    }).then(function (text) {
      return importScene(text, { name: opts.name || 'Velo demo3d' });
    }).catch(function (e) {
      if (ME.MapEditor && ME.MapEditor.notify) ME.MapEditor.notify('Import demo3d lỗi', e.message, 'error');
      throw e;
    });
  }

  function importFile(file) {
    if (!file) return Promise.reject(new Error('chưa chọn file'));
    if (typeof file.text === 'function') {
      return file.text().then(function (text) {
        return importScene(text, { name: file.name.replace(/\.scene$/i, '') });
      });
    }
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onload = function () { resolve(importScene(String(rd.result), { name: file.name.replace(/\.scene$/i, '') })); };
      rd.onerror = function () { reject(new Error('đọc file lỗi')); };
      rd.readAsText(file);
    });
  }

  ME.VeloImport = {
    DEMO_URL: DEMO_URL, HERO_MODEL_ID: HERO_MODEL_ID, HERO_FBX_LOCAL: HERO_FBX_LOCAL,
    parse: parse, tokenize: tokenize, countNodes: countNodes, walkNodes: walkNodes,
    findNodes: findNodes, comp: comp, rgbToHex: rgbToHex, hexToRgb: hexToRgb,
    treeToSceneData: treeToSceneData,
    importScene: importScene, importDemo3d: importDemo3d, importFile: importFile,
    refreshPanels: refreshPanels
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ME.VeloImport;
  }
})();
