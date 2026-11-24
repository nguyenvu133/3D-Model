/* ============================================================
 * mapeditor/velo/VeloExport.js — Serialize scene Map Editor
 * hiện tại → text .scene đúng cú pháp Velo + .meta cho mỗi
 * asset + cấu trúc project + README.
 *
 * Quy ước xuất (xem docs/VELO_INTEGRATION.md):
 * - Transform3D: position mét, rotation euler ĐỘ, scale.
 * - Primitive → MeshRenderer3D (box→cube, sphere, cylinder,
 *   cone, plane; torus→portal type xuất lại mesh="torus").
 * - Hero/monster/boss hoặc object có velo.modelId →
 *   SkinnedModel3D model=@asset("a3d0f8b1") (Thần Điêu).
 * - Object có velo.prefabInstance → gộp thành 1 node
 *   `from @asset("id")` + override con nếu màu khác prefab gốc.
 * - Object có velo.prefabId nhưng không thuộc instance →
 *   1 node `from @asset("id")` riêng.
 * - Object có velo.spawnerKey → gộp thành 1 node OrbSpawner.
 * - Particles3D / PointLight3D xuất từ velo meta + light.
 * - HUD không export. Patrol (đường path MapEditor) không có
 *   tương đương Velo → bỏ qua + ghi warning.
 * - Model FBX là binary, KHÔNG kèm trong text export — user
 *   tự copy file FBX vào assets/models/ (ghi rõ trong README).
 *
 * Export phải parse lại được bằng chính VeloImport.parse
 * (xem VeloExport.validate + test round-trip).
 * ============================================================ */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  root.MapEditor = root.MapEditor || {};
  var ME = root.MapEditor;

  var HERO_MODEL_ID = 'a3d0f8b1';

  /* ---------- hash ổn định → id 8-hex ---------- */
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function assetIdFor(name) { return fnv1a(name); }

  function metaText(filename, kind) {
    return 'id: ' + assetIdFor(filename) + '\nkind: ' + kind + '\nversion: 1\n';
  }

  /* ---------- format số / tên / màu ---------- */
  function fmt(v) {
    var r = Math.round(v * 1000) / 1000;
    if (Object.is(r, -0)) r = 0;
    return String(r);
  }
  function fmtDeg(rad) { return fmt(rad * 180 / Math.PI); }
  function rgbArr(hex) {
    return '[' + ((hex >> 16) & 255) + ', ' + ((hex >> 8) & 255) + ', ' + (hex & 255) + ']';
  }
  function sanitizeName(name, used) {
    var n = String(name || 'Object').replace(/[^A-Za-z0-9_]/g, '_');
    if (/^[0-9]/.test(n)) n = 'Node_' + n;
    if (!n) n = 'Object';
    var base = n, k = 2;
    while (used[n]) { n = base + '_' + k; k++; }
    used[n] = true;
    return n;
  }
  function indent(lines, level) {
    var pad = '';
    for (var i = 0; i < level; i++) pad += '  ';
    return lines.map(function (l) { return l ? pad + l : l; }).join('\n');
  }

  /* MapEditor primitive → mesh Velo + hệ số scale ngược với import
   * (plane 2x2, sphere đk 1.2, cylinder/cone cao 1.2, portal r 2.6). */
  var EXPORT_MESH = {
    box: { mesh: 'cube', s: [1, 1, 1] },
    sphere: { mesh: 'sphere', s: [1.2, 1.2, 1.2] },
    cylinder: { mesh: 'cylinder', s: [1, 1.2, 1] },
    cone: { mesh: 'cone', s: [1.2, 1.2, 1.2] },
    plane: { mesh: 'plane', s: [2, 1, 2] },
    portal: { mesh: 'torus', s: [2.6, 2.6, 2.6] },
    model: { mesh: 'cube', s: [1, 1, 1] }
  };
  /* Type wuxia native → primitive gần đúng (ghi chú trong docs). */
  var NATIVE_MESH = {
    temple: 'cube', house: 'cube', gate: 'cube', bridge: 'cube',
    pine: 'cone', bamboo: 'cone', rock: 'sphere', lantern: 'sphere',
    campfire: 'cube', statue: 'cube', fence: 'cube', waterfall: 'plane'
  };

  function transformLines(o, opts) {
    opts = opts || {};
    var pos = o.position || [0, 0, 0];
    var rot = o.rotation || [0, 0, 0];
    var sc = o.scale || [1, 1, 1];
    var parts = [];
    parts.push('position = [' + fmt(pos[0]) + ', ' + fmt(pos[1]) + ', ' + fmt(pos[2]) + ']');
    if (rot[0] || rot[1] || rot[2]) {
      parts.push('rotation = [' + fmtDeg(rot[0]) + ', ' + fmtDeg(rot[1]) + ', ' + fmtDeg(rot[2]) + ']');
    }
    if (opts.scale) {
      var s = opts.scale;
      if (s[0] !== 1 || s[1] !== 1 || s[2] !== 1) {
        parts.push('scale = [' + fmt(s[0]) + ', ' + fmt(s[1]) + ', ' + fmt(s[2]) + ']');
      }
    } else if (sc[0] !== 1 || sc[1] !== 1 || sc[2] !== 1) {
      parts.push('scale = [' + fmt(sc[0]) + ', ' + fmt(sc[1]) + ', ' + fmt(sc[2]) + ']');
    }
    if (!parts.length) return 'Transform3D { }';
    return 'Transform3D { ' + parts.join('  ') + ' }';
  }

  function meshLines(o, meshName, scaleMul) {
    var props = ['mesh = "' + meshName + '"'];
    if (o.color !== null && o.color !== undefined) {
      var c = rgbArr(o.color);
      if (o.material && o.material.opacity !== undefined && o.material.opacity < 1) {
        c = c.slice(0, -1) + ', ' + Math.round(o.material.opacity * 255) + ']';
      }
      props.push('color = ' + c);
    }
    if (o.velo) {
      if (o.velo.emissive) props.push('emissive = [' + o.velo.emissive.join(', ') + ']');
      if (o.velo.rim) props.push('rim = ' + fmt(o.velo.rim));
      if (o.velo.blend) props.push('blend = "' + o.velo.blend + '"');
      if (o.velo.pattern) props.push('pattern = "' + o.velo.pattern + '"');
    }
    return 'MeshRenderer3D { ' + props.join('  ') + ' }';
  }

  function lightLines(o) {
    if (!o.light) return null;
    var l = o.light;
    var color = l.color !== undefined ? l.color : 0xfff2cc;
    return 'PointLight3D { color = ' + rgbArr(color) +
      '  intensity = ' + fmt(num(l.intensity, 1)) +
      '  range = ' + fmt(num(l.distance, 10)) + ' }';
  }
  function num(v, def) { return typeof v === 'number' && isFinite(v) ? v : def; }

  function particleLines(o) {
    var v = o.velo || {};
    var props = ['preset = "' + (v.preset || 'sparkle') + '"'];
    if (v.rate) props.push('rate = ' + fmt(v.rate));
    if (v.radius) props.push('radius = ' + fmt(v.radius));
    return 'Particles3D { ' + props.join('  ') + ' }';
  }

  function skinnedLines(o) {
    var v = o.velo || {};
    var props = ['model = @asset("' + (v.modelId || HERO_MODEL_ID) + '")'];
    props.push('clip = "' + (v.clip || 'mixamo.com') + '"');
    if (v.speed && v.speed !== 1) props.push('speed = ' + fmt(v.speed));
    if (o.color !== null && o.color !== undefined) props.push('color = ' + rgbArr(o.color));
    if (v.rim) props.push('rim = ' + fmt(v.rim));
    return 'SkinnedModel3D { ' + props.join('  ') + ' }';
  }

  /* ---------- 1 object thường → các dòng node ---------- */
  function objectNodeLines(o, used, level) {
    var name = sanitizeName(o.name, used);
    var lines = [];
    var v = o.velo || {};
    var isSkinned = v.skinned || v.modelId || o.type === 'hero' || o.type === 'monster' || o.type === 'boss';
    var scaleMul = null;
    var meshName = null;
    if (!isSkinned && v.component !== 'Particles3D' && o.type !== 'light') {
      var em = EXPORT_MESH[o.type];
      if (em) { meshName = em.mesh; scaleMul = em.s; }
      else if (NATIVE_MESH[o.type]) { meshName = NATIVE_MESH[o.type]; scaleMul = [1, 1, 1]; }
      else { meshName = 'cube'; scaleMul = [1, 1, 1]; }
    }
    var sc = o.scale || [1, 1, 1];
    var exportScale = scaleMul ? [sc[0] * scaleMul[0], sc[1] * scaleMul[1], sc[2] * scaleMul[2]] : sc;
    lines.push('node ' + name + ' {');
    lines.push(indent([transformLines(o, { scale: exportScale })], 1));
    if (isSkinned) {
      lines.push(indent([skinnedLines(o)], 1));
      if (v.pathRunner) {
        lines.push(indent(['PathRunner { radius = ' + fmt(v.pathRunner.radius) +
          '  speed = ' + fmt(v.pathRunner.speed) +
          (v.pathRunner.phase ? '  phase = ' + fmt(v.pathRunner.phase) : '') + ' }'], 1));
      }
      if (v.health) lines.push(indent(['Health { max = ' + fmt(v.health.max) + ' }'], 1));
    } else if (v.component === 'Particles3D') {
      lines.push(indent([particleLines(o)], 1));
    } else if (o.type === 'light') {
      var ll = lightLines(o);
      if (ll) lines.push(indent([ll], 1));
    } else if (meshName) {
      lines.push(indent([meshLines(o, meshName, scaleMul)], 1));
      if (v.particles) {
        lines.push(indent(['Particles3D { preset = "' + (v.particles.preset || 'sparkle') + '" }'], 1));
      }
    }
    var light = lightLines(o);
    if (light && o.type !== 'light') lines.push(indent([light], 1));
    lines.push('}');
    return lines;
  }

  /* ---------- generate ---------- */
  function generate(data, opts) {
    opts = opts || {};
    if (!data || !Array.isArray(data.objects)) throw new Error('VeloExport: data không có objects');
    var used = {};
    var warnings = [];
    var stats = { objects: 0, prefabInstances: 0, spawners: 0, skipped: 0, lights: 0 };
    var env = data.environment || {};
    var terrain = data.terrain || { size: 112 };

    var body = [];
    body.push('# Export từ Map Editor — ' + (data.name || 'Untitled Map') + ' (' + new Date().toISOString().slice(0, 10) + ')');
    body.push('# Xem docs/VELO_INTEGRATION.md: game logic V không export, model FBX tự copy.');
    body.push('node Main {');

    /* Environment */
    var skyHex = env.sky !== undefined ? env.sky : 0x96a5dc;
    var fogHex = env.fog && env.fog.color !== undefined ? env.fog.color : 0x6e74a0;
    var fogDensity = env.fog && env.fog.far ? Math.round((3 / env.fog.far) * 1000) / 1000 : 0.028;
    body.push(indent([
      'Environment3D { sky = ' + rgbArr(skyHex) +
      '  ground = [95, 85, 90]  ambient = 0.85  fog_color = ' + rgbArr(fogHex) +
      '  fog_density = ' + fmt(fogDensity) + ' }'
    ], 1));
    var sun = env.sun || { color: 0xffe2c8, intensity: 1.05 };
    body.push(indent(['node Sun {'], 1));
    body.push(indent([
      'DirectionalLight3D { direction = [-0.5, -1, -0.35]  color = ' + rgbArr(sun.color) +
      '  intensity = ' + fmt(num(sun.intensity, 1.05)) + ' }'
    ], 2));
    body.push(indent(['}'], 1));

    /* World */
    body.push(indent(['node World {'], 1));
    var size = terrain.size || 112;
    body.push(indent(['node Ground {'], 2));
    body.push(indent(['Transform3D { scale = [' + fmt(size) + ', 1, ' + fmt(size) + '] }'], 3));
    body.push(indent(['MeshRenderer3D { mesh = "grid"  grid_cells = ' + Math.round(size / 2) + '  color = [92, 150, 92]  pattern = "noise" }'], 3));
    body.push(indent(['}'], 2));

    /* Gom nhóm: prefab instance / spawner */
    var instances = {};   /* key -> {root, children[], prefabId, name} */
    var spawners = {};    /* key -> {representative} */
    var singles = [];
    data.objects.forEach(function (o) {
      if (o.visible === false) { stats.skipped++; warnings.push('bỏ qua object ẩn "' + o.name + '"'); return; }
      if (o.type === 'patrol') { stats.skipped++; warnings.push('bỏ qua patrol "' + o.name + '" (Velo không có patrol)'); return; }
      var v = o.velo || {};
      if (v.prefabInstance) {
        var inst = instances[v.prefabInstance];
        if (!inst) inst = instances[v.prefabInstance] = { root: null, children: [], prefabId: v.prefabId, name: v.prefabInstanceName || 'Prefab' };
        if (v.prefabRoot) inst.root = o;
        else inst.children.push(o);
        return;
      }
      if (v.spawnerKey) {
        if (!spawners[v.spawnerKey]) spawners[v.spawnerKey] = o;
        return;
      }
      singles.push(o);
    });

    function prefabInstanceLines(inst) {
      var lines = [];
      var root = inst.root;
      var name = sanitizeName(inst.name, used);
      lines.push('node ' + name + ' from @asset("' + inst.prefabId + '") {');
      var t = (root && root.velo && root.velo.prefabTransform) || null;
      var fake = t ? { position: t.position, rotation: [t.rotation[0] * Math.PI / 180, t.rotation[1] * Math.PI / 180, t.rotation[2] * Math.PI / 180], scale: t.scale }
        : (root || { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
      lines.push(indent([transformLines(fake, {})], 1));
      /* override con: màu khác prefab gốc (kể cả khi object bị
       * override chính là root carrier của instance, VD Slime2 Body) */
      var overrideCandidates = root ? [root].concat(inst.children) : inst.children.slice();
      overrideCandidates.forEach(function (ch) {
        var cv = ch.velo || {};
        var defColor = cv.prefabDefault && cv.prefabDefault.color;
        if (cv.overridden && defColor !== undefined && ch.color !== null && ch.color !== undefined && ch.color !== defColor) {
          lines.push(indent(['node ' + sanitizeName(cv.prefabChild || ch.name, used) + ' {'], 1));
          lines.push(indent(['MeshRenderer3D { color = ' + rgbArr(ch.color) + ' }'], 2));
          lines.push(indent(['}'], 1));
        }
      });
      lines.push('}');
      stats.prefabInstances++;
      return lines;
    }

    Object.keys(instances).forEach(function (key) {
      var inst = instances[key];
      if (!inst.root && !inst.children.length) return;
      if (!inst.root) {
        warnings.push('prefab instance "' + key + '" thiếu root — xuất từng object riêng');
        inst.children.forEach(function (o) { singles.push(o); });
        return;
      }
      prefabInstanceLines(inst).forEach(function (l) { body.push(indent([l], 2)); });
      stats.objects += 1 + inst.children.length;
    });

    Object.keys(spawners).forEach(function (key) {
      var o = spawners[key];
      var v = o.velo || {};
      var sp = v.spawner || { prefabId: v.prefabId || 'd3a10002', count: 10, radius: 15, center: [0, 0] };
      var name = sanitizeName(key, used);
      body.push(indent(['node ' + name + ' {'], 2));
      body.push(indent(['OrbSpawner { prefab = @asset("' + sp.prefabId + '")  count = ' + sp.count + '  radius = ' + fmt(sp.radius) + ' }'], 3));
      body.push(indent(['}'], 2));
      stats.spawners++;
      stats.objects += sp.count;
    });

    singles.forEach(function (o) {
      if (o.velo && o.velo.prefabId && !o.velo.prefabInstance) {
        /* 1 instance prefab lẻ (không thuộc nhóm) */
        var name = sanitizeName(o.name, used);
        body.push(indent(['node ' + name + ' from @asset("' + o.velo.prefabId + '") {'], 2));
        body.push(indent([transformLines(o, {})], 3));
        body.push(indent(['}'], 2));
        stats.prefabInstances++;
        stats.objects++;
        return;
      }
      objectNodeLines(o, used, 2).forEach(function (l) { body.push(indent([l], 2)); });
      stats.objects++;
      if (o.light) stats.lights++;
    });

    body.push(indent(['}'], 1)); /* /World */
    body.push('}'); /* /Main */

    return { text: body.join('\n') + '\n', warnings: warnings, stats: stats };
  }

  /* ---------- .meta + project files ---------- */
  function buildProjectFiles(data, opts) {
    opts = opts || {};
    var gen = generate(data, opts);
    var files = [];
    var sceneText = gen.text;
    files.push({ path: 'assets/scenes/main.scene', text: sceneText });
    files.push({ path: 'assets/scenes/main.scene.meta', text: metaText('main.scene', 'scene') });
    /* .meta cho từng prefab đã dùng + .scene prefab nếu đã cache */
    var prefabIds = [];
    (data.objects || []).forEach(function (o) {
      var id = o.velo && o.velo.prefabId;
      if (id && prefabIds.indexOf(id) < 0) prefabIds.push(id);
      var sp = o.velo && o.velo.spawner && o.velo.spawner.prefabId;
      if (sp && prefabIds.indexOf(sp) < 0) prefabIds.push(sp);
    });
    var lib = ME.VeloPrefabLibrary;
    prefabIds.forEach(function (id) {
      var info = lib && lib.get ? lib.get(id) : null;
      var fname = info ? info.file : (id + '.scene');
      files.push({ path: 'assets/prefabs/' + fname + '.meta', text: metaText(fname, 'scene') });
      var cachedText = lib && lib.getCachedText ? lib.getCachedText(id) : null;
      if (cachedText) files.push({ path: 'assets/prefabs/' + fname, text: cachedText });
    });
    /* .meta cho model Thần Điêu (file FBX user tự copy) */
    files.push({ path: 'assets/models/than_dieu_run.fbx.meta', text: metaText('than_dieu_run.fbx', 'model') });

    /* .meta cho model đã import vào map trong phiên này (VeloProject
     * theo dõi, mục "Chưa lưu" trong cây project): Export Velo bao
     * gồm cả các asset này — user tự copy file gốc vào assets/models/. */
    var unsaved = (ME.VeloProject && ME.VeloProject.getUnsavedModelAssets)
      ? ME.VeloProject.getUnsavedModelAssets() : [];
    unsaved.forEach(function (a) {
      files.push({ path: 'assets/models/' + a.fileName + '.meta', text: metaText(a.fileName, 'model') });
    });

    var readme = [
      '# Velo project — export từ Map Editor',
      '',
      'Copy các file này vào project Velo của bạn:',
      '  assets/scenes/main.scene        (scene chính, đã export)',
      '  assets/scenes/main.scene.meta',
      '  assets/prefabs/*.scene[.meta]   (prefab đã dùng; file .scene chỉ kèm khi đã tải về lúc export,',
      '                                   nếu thiếu thì copy từ examples/demo3d/assets/prefabs/ của repo velo)',
      '  assets/models/than_dieu_run.fbx.meta',
      '',
      'BẮT BUỘC tự copy file model (binary, không kèm trong text export):',
      '  assets/models/than_dieu_run.fbx  <- models/thandieu/Than_dieu_Fast_Run.fbx trong repo 3D-Model',
      '',
      'Model đã import trong phiên Map Editor (mục "Chưa lưu" trong cây Velo Project):',
      '  - Đã kèm file .meta cho từng model (ID ổn định theo tên file).',
      '  - Tự copy file gốc (.fbx/.glb/.obj) vào assets/models/ với đúng tên trong .meta.',
      '',
      'KHÔNG export được (viết bằng V trong project Velo):',
      '  - Game logic: main.v / game.v / combat.v (HeroController, Health, HeroCombat,',
      '    OrbSpawner behaviour, PathRunner, SlimeHop, DroneHover...)',
      '  - HUD 2D (Canvas/Label/ProgressBar).',
      '',
      'Kiểm tra: mở main.scene bằng VeloImport.parse — export này đã được',
      'tự kiểm tra round-trip (export → parse → import lại, số object khớp).',
      ''
    ].join('\n');
    files.push({ path: 'README-VELO.md', text: readme });
    return { sceneText: sceneText, files: files, warnings: gen.warnings, stats: gen.stats, readme: readme };
  }

  function projectStructure(data) {
    var files = buildProjectFiles(data).files;
    return files.map(function (f) { return f.path; });
  }

  /* ---------- validate: export parse lại được bằng chính importer ---------- */
  function validate(text) {
    if (!ME.VeloImport || !ME.VeloImport.parse) return { ok: false, errors: ['VeloImport chưa load'] };
    try {
      var nodes = ME.VeloImport.parse(text);
      var total = 0;
      nodes.forEach(function (n) { total += ME.VeloImport.countNodes(n); });
      return { ok: true, errors: [], rootNodes: nodes.map(function (n) { return n.name; }), totalNodes: total };
    } catch (e) {
      return { ok: false, errors: [e.message] };
    }
  }

  /* ---------- download (browser) ---------- */
  function downloadText(text, filename, mime) {
    if (ME.SharedScene && typeof ME.SharedScene.downloadText === 'function') {
      ME.SharedScene.downloadText(text, filename, mime || 'text/plain');
      return;
    }
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function currentData() {
    if (ME.MapEditor && ME.MapEditor.data) return ME.MapEditor.data;
    return null;
  }

  function downloadScene(data) {
    data = data || currentData();
    if (!data) throw new Error('chưa có scene Map Editor');
    var gen = generate(data);
    downloadText(gen.text, 'main.scene', 'text/plain');
    return gen;
  }
  function downloadMetas(data) {
    data = data || currentData();
    if (!data) return Promise.reject(new Error('chưa có scene Map Editor'));
    var proj = buildProjectFiles(data);
    var metas = proj.files.filter(function (f) { return /\.meta$/.test(f.path); });
    var chain = Promise.resolve();
    metas.forEach(function (f) {
      chain = chain.then(function () {
        downloadText(f.text, f.path.split('/').pop(), 'text/plain');
        return sleep(350);
      });
    });
    return chain.then(function () { return proj; });
  }
  function downloadAll(data) {
    data = data || currentData();
    if (!data) return Promise.reject(new Error('chưa có scene Map Editor'));
    var proj = buildProjectFiles(data);
    var chain = Promise.resolve();
    proj.files.forEach(function (f) {
      chain = chain.then(function () {
        downloadText(f.text, f.path.split('/').pop(), 'text/plain');
        return sleep(350);
      });
    });
    return chain.then(function () { return proj; });
  }

  ME.VeloExport = {
    HERO_MODEL_ID: HERO_MODEL_ID,
    generate: generate, buildProjectFiles: buildProjectFiles,
    projectStructure: projectStructure, metaText: metaText, assetIdFor: assetIdFor,
    validate: validate, downloadText: downloadText,
    downloadScene: downloadScene, downloadMetas: downloadMetas, downloadAll: downloadAll,
    currentData: currentData
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ME.VeloExport;
  }
})();
