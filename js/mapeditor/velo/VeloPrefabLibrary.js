/* ============================================================
 * mapeditor/velo/VeloPrefabLibrary.js — Registry 7 prefab của
 * Velo demo3d (examples/demo3d/assets/prefabs/*.scene).
 * Prefab là `node Tên { ... }`; instance trong main.scene dùng
 * `node Tên from @asset("id") { Transform3D { ...override } }`.
 * Fetch .scene gốc lúc chạy (raw.githubusercontent), cache trong
 * bộ nhớ; fetch lỗi → dùng định nghĩa fallback nhúng sẵn
 * (torch/tree đúng file gốc đã đọc; các prefab còn lại là
 * primitive tương đương) + log warning, không crash.
 * ============================================================ */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  root.MapEditor = root.MapEditor || {};
  var ME = root.MapEditor;

  var RAW_BASE = 'https://raw.githubusercontent.com/velo-engine/velo/3d/examples/demo3d/assets/prefabs/';

  var REGISTRY = [
    { id: 'd3a10002', name: 'Orb', file: 'orb.scene', kind: 'scene' },
    { id: 'd3a10003', name: 'Slime', file: 'slime.scene', kind: 'scene' },
    { id: 'd3a10004', name: 'Drone', file: 'drone.scene', kind: 'scene' },
    { id: 'd3a10005', name: 'Golem', file: 'golem.scene', kind: 'scene' },
    { id: 'd3a10006', name: 'Torch', file: 'torch.scene', kind: 'scene' },
    { id: 'd3a10007', name: 'Tree', file: 'tree.scene', kind: 'scene' },
    { id: 'd3a10008', name: 'Crystal', file: 'crystal.scene', kind: 'scene' }
  ];
  var BY_ID = {};
  REGISTRY.forEach(function (r) { BY_ID[r.id] = r; });

  /* Fallback nhúng sẵn. Torch/Tree: đúng nội dung file gốc đã đọc.
   * Orb/Slime/Drone/Golem/Crystal: primitive tương đương (đủ để
   * import không crash khi mất mạng; có ghi source=fallback). */
  var FALLBACK_TEXT = {
    d3a10006: [
      '# A brazier: a stone post with fire, embers, smoke and a flickering light.',
      'node Torch {',
      '  Transform3D { }',
      '  node Post {',
      '    Transform3D { position = [0, 0.6, 0]  scale = [0.35, 1.2, 0.35] }',
      '    MeshRenderer3D { mesh = "cylinder"  color = [110, 100, 95]  pattern = "noise"  shadow = true  shadow_size = 0.4 }',
      '  }',
      '  node Bowl {',
      '    Transform3D { position = [0, 1.25, 0]  rotation = [180, 0, 0]  scale = [0.7, 0.3, 0.7] }',
      '    MeshRenderer3D { mesh = "cone"  color = [70, 60, 55] }',
      '  }',
      '  node Fire {',
      '    Transform3D { position = [0, 1.4, 0] }',
      '    Particles3D { preset = "fire" }',
      '    PointLight3D { color = [255, 150, 60]  intensity = 2.2  range = 7  flicker = 0.6 }',
      '  }',
      '  node Embers {',
      '    Transform3D { position = [0, 1.5, 0] }',
      '    Particles3D { preset = "embers" }',
      '  }',
      '  node Smoke {',
      '    Transform3D { position = [0, 2.3, 0] }',
      '    Particles3D { preset = "smoke"  rate = 5 }',
      '  }',
      '}'
    ].join('\n'),
    d3a10007: [
      '# A low-poly pine: a trunk and three stacked cones.',
      'node Tree {',
      '  Transform3D { }',
      '  node Trunk {',
      '    Transform3D { position = [0, 0.6, 0]  scale = [0.35, 1.2, 0.35] }',
      '    MeshRenderer3D { mesh = "cylinder"  color = [110, 75, 50]  shadow = true  shadow_size = 1.4 }',
      '  }',
      '  node Low {',
      '    Transform3D { position = [0, 1.6, 0]  scale = [2.2, 1.6, 2.2] }',
      '    MeshRenderer3D { mesh = "cone"  color = [50, 120, 70] }',
      '  }',
      '  node Mid {',
      '    Transform3D { position = [0, 2.5, 0]  scale = [1.7, 1.4, 1.7] }',
      '    MeshRenderer3D { mesh = "cone"  color = [60, 140, 80] }',
      '  }',
      '  node Top {',
      '    Transform3D { position = [0, 3.3, 0]  scale = [1.1, 1.2, 1.1] }',
      '    MeshRenderer3D { mesh = "cone"  color = [75, 160, 90] }',
      '  }',
      '}'
    ].join('\n'),
    d3a10002: [
      '# Fallback Orb (đơn giản hoá từ orb.scene gốc — chỉ dùng khi fetch lỗi).',
      'node Orb {',
      '  Transform3D { position = [0, 1, 0] }',
      '  PointLight3D { color = [255, 210, 90]  intensity = 1.2  range = 3.5 }',
      '  node Core {',
      '    Transform3D { scale = [0.35, 0.35, 0.35] }',
      '    MeshRenderer3D { mesh = "sphere"  color = [255, 220, 120]  emissive = [255, 170, 40]  unlit = true }',
      '  }',
      '  node Shell {',
      '    Transform3D { scale = [0.62, 0.62, 0.62] }',
      '    MeshRenderer3D { mesh = "sphere"  color = [255, 170, 60, 60]  blend = "additive"  unlit = true }',
      '  }',
      '  node Sparkles {',
      '    Particles3D { preset = "sparkle"  rate = 8  radius = 0.5 }',
      '  }',
      '}'
    ].join('\n'),
    d3a10003: [
      '# Fallback Slime (đơn giản hoá từ slime.scene gốc — chỉ dùng khi fetch lỗi).',
      'node Slime {',
      '  Transform3D { }',
      '  node Body {',
      '    Transform3D { position = [0, 0.45, 0]  scale = [0.9, 0.9, 0.9] }',
      '    MeshRenderer3D { mesh = "sphere"  color = [90, 220, 120]  emissive = [10, 50, 20]  rim = 0.5 }',
      '    node EyeL {',
      '      Transform3D { position = [-0.17, 0.12, 0.42]  scale = [0.16, 0.2, 0.1] }',
      '      MeshRenderer3D { mesh = "sphere"  color = [20, 20, 30] }',
      '    }',
      '    node EyeR {',
      '      Transform3D { position = [0.17, 0.12, 0.42]  scale = [0.16, 0.2, 0.1] }',
      '      MeshRenderer3D { mesh = "sphere"  color = [20, 20, 30] }',
      '    }',
      '  }',
      '  node Dust {',
      '    Particles3D { preset = "dust" }',
      '  }',
      '}'
    ].join('\n'),
    d3a10004: [
      '# Fallback Drone (đơn giản hoá từ drone.scene gốc — chỉ dùng khi fetch lỗi).',
      'node Drone {',
      '  Transform3D { position = [0, 2.2, 0] }',
      '  PointLight3D { color = [90, 180, 255]  intensity = 1.6  range = 5 }',
      '  node Body {',
      '    Transform3D { scale = [0.6, 0.45, 0.6] }',
      '    MeshRenderer3D { mesh = "sphere"  color = [170, 180, 200]  rim = 0.25 }',
      '  }',
      '  node Eye {',
      '    Transform3D { position = [0, 0, 0.27]  scale = [0.22, 0.22, 0.08] }',
      '    MeshRenderer3D { mesh = "sphere"  color = [120, 220, 255]  emissive = [60, 160, 255]  unlit = true }',
      '  }',
      '  node Rotor {',
      '    Transform3D { position = [0, 0.3, 0] }',
      '    MeshRenderer3D { mesh = "ring"  color = [120, 200, 255, 200]  blend = "additive"  unlit = true }',
      '  }',
      '  node Exhaust {',
      '    Transform3D { position = [0, -0.25, 0] }',
      '    Particles3D { preset = "sparkle"  rate = 30 }',
      '  }',
      '}'
    ].join('\n'),
    d3a10005: [
      '# Fallback Golem (đơn giản hoá từ golem.scene gốc — chỉ dùng khi fetch lỗi).',
      'node Golem {',
      '  Transform3D { }',
      '  node Hips {',
      '    Transform3D { position = [0, 1.15, 0] }',
      '    node Torso {',
      '      Transform3D { position = [0, 0.55, 0]  scale = [1.1, 1, 0.75] }',
      '      MeshRenderer3D { mesh = "cube"  color = [140, 130, 120]  pattern = "noise" }',
      '      node Head {',
      '        Transform3D { position = [0, 0.75, 0.05]  scale = [0.55, 0.45, 0.5] }',
      '        MeshRenderer3D { mesh = "cube"  color = [120, 112, 105] }',
      '      }',
      '    }',
      '    node LegL {',
      '      Transform3D { position = [-0.3, 0, 0] }',
      '      node Mesh {',
      '        Transform3D { position = [0, -0.55, 0]  scale = [0.42, 1.1, 0.42] }',
      '        MeshRenderer3D { mesh = "cube"  color = [110, 102, 96] }',
      '      }',
      '    }',
      '    node LegR {',
      '      Transform3D { position = [0.3, 0, 0] }',
      '      node Mesh {',
      '        Transform3D { position = [0, -0.55, 0]  scale = [0.42, 1.1, 0.42] }',
      '        MeshRenderer3D { mesh = "cube"  color = [110, 102, 96] }',
      '      }',
      '    }',
      '  }',
      '  node Dust {',
      '    Particles3D { preset = "dust" }',
      '  }',
      '}'
    ].join('\n'),
    d3a10008: [
      '# Fallback Crystal (đơn giản hoá từ crystal.scene gốc — chỉ dùng khi fetch lỗi).',
      'node Crystal {',
      '  Transform3D { }',
      '  PointLight3D { color = [150, 110, 255]  intensity = 1.4  range = 5 }',
      '  node A {',
      '    Transform3D { position = [0, 0.8, 0]  rotation = [0, 0, 8]  scale = [0.45, 1.6, 0.45] }',
      '    MeshRenderer3D { mesh = "cone"  color = [170, 130, 255]  emissive = [70, 30, 160]  rim = 0.8 }',
      '  }',
      '  node B {',
      '    Transform3D { position = [0.35, 0.5, 0.15]  rotation = [10, 0, -25]  scale = [0.3, 1, 0.3] }',
      '    MeshRenderer3D { mesh = "cone"  color = [150, 160, 255]  emissive = [40, 50, 160]  rim = 0.8 }',
      '  }',
      '  node C {',
      '    Transform3D { position = [-0.3, 0.45, -0.1]  rotation = [-12, 0, 22]  scale = [0.28, 0.9, 0.28] }',
      '    MeshRenderer3D { mesh = "cone"  color = [200, 140, 255]  emissive = [80, 40, 170]  rim = 0.8 }',
      '  }',
      '  node Glow {',
      '    Particles3D { preset = "sparkle"  rate = 4  radius = 0.8 }',
      '  }',
      '}'
    ].join('\n')
  };

  var cache = {}; /* id -> {tree, text, source} */

  function rawUrl(id) {
    var r = BY_ID[id];
    return r ? RAW_BASE + r.file : null;
  }

  function parseText(text) {
    if (!ME.VeloImport || !ME.VeloImport.parse) {
      throw new Error('VeloImport chưa load — không parse được prefab');
    }
    var nodes = ME.VeloImport.parse(text);
    if (!nodes.length) throw new Error('prefab .scene rỗng');
    return nodes[0];
  }

  /* resolve(id, opts) -> Promise<node|null>. opts.text: ép dùng text
   * cho sẵn (dùng trong test với fixture local). opts.noFetch: chỉ fallback. */
  function resolve(id, opts) {
    opts = opts || {};
    if (cache[id]) return Promise.resolve(cache[id].tree);
    if (opts.text) {
      try {
        var tree0 = parseText(opts.text);
        cache[id] = { tree: tree0, text: opts.text, source: 'provided' };
        return Promise.resolve(tree0);
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[VeloPrefabLibrary] text cho sẵn lỗi, dùng fallback:', e.message);
      }
    }
    var url = rawUrl(id);
    var useFallback = function (reason) {
      var fb = FALLBACK_TEXT[id];
      if (!fb) {
        if (typeof console !== 'undefined') console.warn('[VeloPrefabLibrary] prefab ' + id + ' không có fallback (' + reason + ')');
        return null;
      }
      if (typeof console !== 'undefined') console.warn('[VeloPrefabLibrary] prefab ' + id + ' dùng fallback (' + reason + ')');
      try {
        var tree = parseText(fb);
        cache[id] = { tree: tree, text: fb, source: 'fallback' };
        return tree;
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[VeloPrefabLibrary] fallback ' + id + ' cũng lỗi:', e.message);
        return null;
      }
    };
    if (opts.noFetch || !url || typeof fetch === 'undefined') {
      return Promise.resolve(useFallback(opts.noFetch ? 'noFetch' : 'không có fetch/URL'));
    }
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (text) {
      var tree = parseText(text);
      cache[id] = { tree: tree, text: text, source: 'fetch' };
      return tree;
    }).catch(function (e) {
      return useFallback('fetch lỗi: ' + e.message);
    });
  }

  function getCached(id) { return cache[id] || null; }
  function getCachedText(id) { return cache[id] ? cache[id].text : null; }
  function list() {
    return REGISTRY.map(function (r) {
      return { id: r.id, name: r.name, file: r.file, url: RAW_BASE + r.file, cached: !!cache[r.id], source: cache[r.id] ? cache[r.id].source : null };
    });
  }
  function get(id) { return BY_ID[id] || null; }

  /* Đăng ký prefab vào AssetManager NẾU nó có registerAsset
   * (agent khác đang sửa AssetManager — không giả định nó có). */
  function registerAsset(id) {
    var r = BY_ID[id];
    if (!r) return false;
    try {
      if (ME.AssetManager && typeof ME.AssetManager.registerAsset === 'function') {
        /* Theo quy ước AssetManager: id 'velo:<assetId>', source 'velo',
         * veloId là asset id gốc — để lọc Velo + Inspector hiện ID. */
        ME.AssetManager.registerAsset({
          id: 'velo:' + id, name: 'Velo ' + r.name, kind: 'velo-prefab',
          source: 'velo', veloId: id, file: r.file, url: RAW_BASE + r.file
        });
        return true;
      }
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[VeloPrefabLibrary] registerAsset lỗi:', e.message);
    }
    return false;
  }
  function registerAll() {
    var n = 0;
    REGISTRY.forEach(function (r) { if (registerAsset(r.id)) n++; });
    return n;
  }

  ME.VeloPrefabLibrary = {
    RAW_BASE: RAW_BASE, REGISTRY: REGISTRY,
    resolve: resolve, get: get, list: list,
    getCached: getCached, getCachedText: getCachedText,
    registerAsset: registerAsset, registerAll: registerAll,
    _fallbackText: FALLBACK_TEXT
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ME.VeloPrefabLibrary;
  }
})();
