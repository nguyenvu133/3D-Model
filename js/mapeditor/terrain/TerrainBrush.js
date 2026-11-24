/* ============================================================
 * mapeditor/terrain/TerrainBrush.js — Cọ sculpt + cọ sơn terrain
 * Tools: raise / lower / smooth / flatten / noise / mountain
 * (sculpt) và paint (sơn layer). Mỗi stroke push 1 undo snapshot
 * lúc bắt đầu (MapEditor.pushUndo). Vòng preview là ring mesh
 * trên terrain. Có thể gọi applyAt(x, z) trực tiếp từ test.
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  var TOOLS = ['raise', 'lower', 'smooth', 'flatten', 'noise', 'mountain', 'plateau', 'terrace', 'erode'];
  var PAINT_TOOLS = ['paint'];

  var Brush = {
    tool: 'raise',          /* sculpt tool đang chọn */
    mode: 'sculpt',         /* 'sculpt' | 'paint' */
    paintLayer: 1,          /* snow mặc định */
    size: 6,                /* bán kính world */
    strength: 0.5,          /* 0..1 */
    falloff: 'smooth',      /* smooth | linear | hard */
    flattenHeight: 0,
    _painting: false,
    _strokeStarted: false,
    _previewRing: null,
    _seed: 1337
  };

  function falloffFactor(d, radius) {
    if (d >= radius) return 0;
    var t = d / radius;
    if (Brush.falloff === 'hard') return 1;
    if (Brush.falloff === 'linear') return 1 - t;
    return 0.5 + 0.5 * Math.cos(t * Math.PI); /* smooth */
  }
  function rand01() {
    Brush._seed = (Brush._seed * 1664525 + 1013904223) >>> 0;
    return Brush._seed / 4294967296;
  }

  function verticesInRadius(cx, cz) {
    var TE = ME.TerrainEditor;
    var d = TE.data;
    if (!d) return [];
    var out = [];
    var n = d.segments + 1;
    var r = Brush.size;
    /* giới hạn vùng duyệt theo bán kính */
    var i0 = Math.max(0, Math.floor(((cx - r) + d.size / 2) / d.size * d.segments));
    var i1 = Math.min(d.segments, Math.ceil(((cx + r) + d.size / 2) / d.size * d.segments));
    var j0 = Math.max(0, Math.floor(((cz - r) + d.size / 2) / d.size * d.segments));
    var j1 = Math.min(d.segments, Math.ceil(((cz + r) + d.size / 2) / d.size * d.segments));
    for (var j = j0; j <= j1; j++) {
      for (var i = i0; i <= i1; i++) {
        var p = TE.vertexPos(j * n + i);
        var dx = p.x - cx, dz = p.z - cz;
        var dist = Math.sqrt(dx * dx + dz * dz);
        if (dist <= r) out.push({ idx: j * n + i, x: p.x, z: p.z, dist: dist });
      }
    }
    return out;
  }

  function smoothHeightAt(idx) {
    var TE = ME.TerrainEditor;
    var d = TE.data;
    var n = d.segments + 1;
    var ix = idx % n, iz = Math.floor(idx / n);
    var sum = 0, cnt = 0;
    for (var dj = -1; dj <= 1; dj++) {
      for (var di = -1; di <= 1; di++) {
        var ii = ix + di, jj = iz + dj;
        if (ii < 0 || jj < 0 || ii > d.segments || jj > d.segments) continue;
        sum += d.heights[jj * n + ii]; cnt++;
      }
    }
    return cnt ? sum / cnt : d.heights[idx];
  }

  /* áp 1 lần cọ tại điểm world (x,z) — trả số vertex đã đổi */
  Brush.applyAt = function (x, z) {
    var TE = ME.TerrainEditor;
    if (!TE.data || !TE.mesh) return 0;
    var verts = verticesInRadius(x, z);
    if (!verts.length) return 0;
    var changed = 0;
    if (Brush.mode === 'paint') {
      verts.forEach(function (v) {
        var f = falloffFactor(v.dist, Brush.size);
        if (f <= 0) return;
        TE.setPaintAtIndex(v.idx, Brush.paintLayer, f * Brush.strength + 0.35);
        changed++;
      });
      return changed;
    }
    var tool = Brush.tool;
    var s = Brush.strength;
    verts.forEach(function (v) {
      var f = falloffFactor(v.dist, Brush.size);
      if (f <= 0) return;
      var h = TE.data.heights[v.idx];
      var nh = h;
      if (tool === 'raise') nh = h + s * f * 1.2;
      else if (tool === 'lower') nh = h - s * f * 1.2;
      else if (tool === 'mountain') nh = h + s * f * f * 2.4;
      else if (tool === 'smooth') nh = h + (smoothHeightAt(v.idx) - h) * f * s;
      else if (tool === 'flatten') nh = h + (Brush.flattenHeight - h) * f * s;
      else if (tool === 'noise') nh = h + (rand01() - 0.5) * 2 * s * f;
      else if (tool === 'plateau') {
        /* chỉ nâng lên mặt bằng (đỉnh bằng), không hạ chỗ cao hơn */
        if (h < Brush.flattenHeight) nh = h + (Brush.flattenHeight - h) * f * s;
      }
      else if (tool === 'terrace') {
        /* bậc thang: lượng tử hoá độ cao theo bước 1m */
        var step = 1;
        var q = Math.round(h / step) * step;
        nh = h + (q - h) * f * s;
      }
      else if (tool === 'erode') {
        /* xói mòn: làm mịn mạnh + hạ chỗ nhô cao hơn vùng quanh */
        var sm = smoothHeightAt(v.idx);
        nh = h + (sm - h) * f * s;
        var slope = h - sm;
        if (slope > 0) nh -= slope * f * s * 0.4;
      }
      if (nh !== h) {
        TE.setHeightAtIndex(v.idx, nh);
        changed++;
      }
    });
    if (changed) TE.recomputeNormals();
    return changed;
  };

  /* stroke: bắt đầu (push undo) / áp / kết thúc */
  Brush.beginStroke = function (x, z) {
    if (Brush._painting) return;
    Brush._painting = true;
    Brush._strokeStarted = true;
    if (ME.MapEditor && ME.MapEditor.pushUndo) {
      ME.MapEditor.pushUndo(Brush.mode === 'paint' ? 'Paint terrain' : 'Sculpt terrain');
    }
    if (Brush.tool === 'flatten' && x !== undefined) {
      Brush.flattenHeight = ME.TerrainEditor.heightAt(x, z);
    }
    if (Brush.tool === 'plateau' && x !== undefined) {
      /* plateau lấy mặt bằng = độ cao tại điểm bắt đầu + 1.5m */
      Brush.flattenHeight = ME.TerrainEditor.heightAt(x, z) + 1.5;
    }
    if (x !== undefined && z !== undefined) Brush.applyAt(x, z);
  };
  Brush.strokeTo = function (x, z) {
    if (!Brush._painting) return 0;
    return Brush.applyAt(x, z);
  };
  Brush.endStroke = function () {
    Brush._painting = false;
    Brush._strokeStarted = false;
    if (ME.MapEditor && ME.MapEditor.refreshAfterTerrain) ME.MapEditor.refreshAfterTerrain();
  };

  /* vòng preview */
  Brush.getPreviewRing = function (scene) {
    if (!Brush._previewRing) {
      var geo = new THREE.RingGeometry(0.96, 1, 48);
      geo.rotateX(-Math.PI / 2);
      var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffd94d, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false
      }));
      m.renderOrder = 999;
      m.visible = false;
      Brush._previewRing = m;
      if (scene) scene.add(m);
    }
    return Brush._previewRing;
  };
  Brush.movePreview = function (x, z) {
    var ring = Brush._previewRing;
    if (!ring) return;
    var y = ME.TerrainEditor.heightAt(x, z) + 0.15;
    ring.position.set(x, y, z);
    ring.scale.setScalar(Math.max(0.1, Brush.size));
    ring.visible = true;
  };
  Brush.hidePreview = function () {
    if (Brush._previewRing) Brush._previewRing.visible = false;
  };

  /* scatter: rải prefab ngẫu nhiên trong bán kính cọ */
  Brush.scatter = function (x, z, type, count) {
    var placed = 0;
    for (var i = 0; i < count; i++) {
      var a = rand01() * Math.PI * 2;
      var r = Math.sqrt(rand01()) * Brush.size;
      var px = x + Math.cos(a) * r;
      var pz = z + Math.sin(a) * r;
      var half = (ME.TerrainEditor.data ? ME.TerrainEditor.data.size : 112) / 2;
      if (Math.abs(px) > half - 2 || Math.abs(pz) > half - 2) continue;
      if (ME.MapEditor && ME.MapEditor.placeObject) {
        ME.MapEditor.placeObject(type, px, pz, { randomRot: true, randomScale: true });
        placed++;
      }
    }
    return placed;
  };

  /* scatter có seed: cùng seed + cùng vị trí/loại → cùng vị trí rải */
  Brush.setSeed = function (seed) {
    Brush._seed = (parseInt(seed, 10) >>> 0) || 1;
  };
  Brush.scatterSeeded = function (x, z, type, count, seed) {
    if (seed !== undefined && seed !== null) Brush.setSeed(seed);
    return Brush.scatter(x, z, type, count);
  };

  /* ---------- preset scatter "Lấp đầy map" (2026-11-24) ----------
   * Mỗi preset là danh sách zone {type, count, cx, cz, r, sMin, sMax}.
   * Seed cố định cho mỗi preset (xem PRESET_SEEDS) → bấm lại cùng seed
   * trên cùng map → cùng vị trí/quay/scale. Dùng RNG mulberry32 riêng,
   * KHÔNG dùng Math.random, để fill là deterministic. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var PRESET_SEEDS = { forest: 11, village: 22, market: 33, battlefield: 44, full: 20261124 };
  var PRESETS = {
    /* Rừng: chủ yếu cây (thông 3 kiểu + anh đào + nấm + trúc + đá) */
    forest: [
      { type: 'pine_snow', count: 14, cx: 0, cz: 0, r: 48, sMin: 0.8, sMax: 1.4 },
      { type: 'pine_tall', count: 10, cx: 0, cz: 0, r: 48, sMin: 0.9, sMax: 1.3 },
      { type: 'pine_short', count: 10, cx: 0, cz: 0, r: 48, sMin: 0.8, sMax: 1.2 },
      { type: 'pine', count: 8, cx: 0, cz: 0, r: 48, sMin: 0.8, sMax: 1.3 },
      { type: 'sakura', count: 4, cx: 0, cz: 0, r: 40, sMin: 0.9, sMax: 1.2 },
      { type: 'mushroom', count: 8, cx: 0, cz: 0, r: 44, sMin: 0.7, sMax: 1.4 },
      { type: 'bamboo', count: 6, cx: -30, cz: -20, r: 16, sMin: 0.8, sMax: 1.2 },
      { type: 'rock', count: 6, cx: 0, cz: 0, r: 48, sMin: 0.6, sMax: 1.6 }
    ],
    /* Làng: nhà 3 kiểu + giếng + hàng rào + đèn + dân làng + cờ + đường đá */
    village: [
      { type: 'house_tile', count: 3, cx: -20, cz: 10, r: 20, sMin: 0.9, sMax: 1.1 },
      { type: 'house_thatch', count: 3, cx: -20, cz: 10, r: 20, sMin: 0.9, sMax: 1.1 },
      { type: 'house_flat', count: 2, cx: -20, cz: 10, r: 20, sMin: 0.9, sMax: 1.1 },
      { type: 'house', count: 2, cx: -20, cz: 10, r: 20, sMin: 0.9, sMax: 1.1 },
      { type: 'stall', count: 2, cx: -20, cz: 10, r: 12, sMin: 0.9, sMax: 1.1 },
      { type: 'well_stone', count: 1, cx: -20, cz: 10, r: 8, sMin: 1, sMax: 1 },
      { type: 'fence_wood', count: 8, cx: -20, cz: 10, r: 22, sMin: 0.9, sMax: 1.1 },
      { type: 'lantern_yellow', count: 6, cx: -20, cz: 10, r: 18, sMin: 0.9, sMax: 1.1 },
      { type: 'lantern_red', count: 4, cx: -20, cz: 10, r: 18, sMin: 0.9, sMax: 1.1 },
      { type: 'villager_blue', count: 2, cx: -20, cz: 10, r: 12, sMin: 0.9, sMax: 1.1 },
      { type: 'villager_red', count: 2, cx: -20, cz: 10, r: 12, sMin: 0.9, sMax: 1.1 },
      { type: 'villager_yellow', count: 2, cx: -20, cz: 10, r: 12, sMin: 0.9, sMax: 1.1 },
      { type: 'banner', count: 4, cx: -20, cz: 10, r: 20, sMin: 0.9, sMax: 1.1 },
      { type: 'stone_path', count: 4, cx: -20, cz: 10, r: 14, sMin: 0.9, sMax: 1.1 },
      { type: 'stone_steps', count: 2, cx: -20, cz: 10, r: 10, sMin: 0.9, sMax: 1.1 },
      { type: 'pagoda', count: 1, cx: -20, cz: 10, r: 20, sMin: 1, sMax: 1 }
    ],
    /* Chợ: quầy hàng + đèn + rương/xu + dân làng + cờ */
    market: [
      { type: 'stall', count: 6, cx: 0, cz: 10, r: 12, sMin: 0.9, sMax: 1.1 },
      { type: 'lantern_red', count: 4, cx: 0, cz: 10, r: 12, sMin: 0.9, sMax: 1.1 },
      { type: 'lantern_yellow', count: 4, cx: 0, cz: 10, r: 12, sMin: 0.9, sMax: 1.1 },
      { type: 'chest', count: 2, cx: 0, cz: 10, r: 10, sMin: 0.9, sMax: 1.1 },
      { type: 'coin', count: 8, cx: 0, cz: 10, r: 10, sMin: 0.8, sMax: 1.2 },
      { type: 'villager_blue', count: 1, cx: 0, cz: 10, r: 10, sMin: 1, sMax: 1 },
      { type: 'villager_red', count: 1, cx: 0, cz: 10, r: 10, sMin: 1, sMax: 1 },
      { type: 'villager_yellow', count: 1, cx: 0, cz: 10, r: 10, sMin: 1, sMax: 1 },
      { type: 'banner', count: 4, cx: 0, cz: 10, r: 12, sMin: 0.9, sMax: 1.1 },
      { type: 'fence_wood', count: 4, cx: 0, cz: 10, r: 14, sMin: 0.9, sMax: 1.1 },
      { type: 'stone_path', count: 3, cx: 0, cz: 10, r: 10, sMin: 0.9, sMax: 1.1 }
    ],
    /* Chiến trường: quái (sói/dơi/boss) + đá + bếp lửa + cờ */
    battlefield: [
      { type: 'wolf', count: 5, cx: 30, cz: -10, r: 18, sMin: 0.9, sMax: 1.2 },
      { type: 'monster', count: 4, cx: 30, cz: -10, r: 18, sMin: 0.9, sMax: 1.2 },
      { type: 'bat', count: 3, cx: 30, cz: -10, r: 16, sMin: 0.9, sMax: 1.1 },
      { type: 'boss', count: 1, cx: 30, cz: -10, r: 8, sMin: 1, sMax: 1 },
      { type: 'rock', count: 8, cx: 30, cz: -10, r: 20, sMin: 0.6, sMax: 1.6 },
      { type: 'stone_stove', count: 2, cx: 30, cz: -10, r: 14, sMin: 0.9, sMax: 1.1 },
      { type: 'banner', count: 4, cx: 30, cz: -10, r: 18, sMin: 0.9, sMax: 1.1 },
      { type: 'pine_short', count: 4, cx: 30, cz: -10, r: 20, sMin: 0.8, sMax: 1.2 },
      { type: 'chest', count: 1, cx: 30, cz: -10, r: 10, sMin: 1, sMax: 1 }
    ]
  };
  PRESETS.full = PRESETS.forest.concat(PRESETS.village);

  /* Rải 1 preset có seed. Trả {preset, seed, added, byType}.
   * Dùng MapEditor.placeObjectsBulk (1 undo + 1 emit) nếu có, để deterministic
   * và không spam undo; fallback: placeObject từng cái với ry/scale rõ ràng. */
  Brush.fillPreset = function (name, seed) {
    var list = PRESETS[name];
    if (!list) return { preset: name, seed: seed, added: 0, byType: {}, error: 'preset không có: ' + name };
    if (seed === undefined || seed === null || seed === '') seed = PRESET_SEEDS[name] || 1337;
    seed = parseInt(seed, 10) || 1337;
    var rng = mulberry32(seed);
    var half = (ME.TerrainEditor.data ? ME.TerrainEditor.data.size : 112) / 2;
    var items = [], byType = {};
    list.forEach(function (zone) {
      for (var i = 0; i < zone.count; i++) {
        var a = rng() * Math.PI * 2;
        var r = Math.sqrt(rng()) * zone.r;
        var x = Math.round((zone.cx + Math.cos(a) * r) * 100) / 100;
        var z = Math.round((zone.cz + Math.sin(a) * r) * 100) / 100;
        if (Math.abs(x) > half - 2 || Math.abs(z) > half - 2) continue;
        var s = Math.round((zone.sMin + rng() * (zone.sMax - zone.sMin)) * 100) / 100;
        var ry = Math.round(rng() * Math.PI * 2 * 100) / 100;
        items.push({ type: zone.type, x: x, z: z, ry: ry, s: s });
        byType[zone.type] = (byType[zone.type] || 0) + 1;
      }
    });
    var added = 0;
    if (ME.MapEditor && ME.MapEditor.placeObjectsBulk) {
      added = ME.MapEditor.placeObjectsBulk(items, 'Fill ' + name).added;
    } else if (ME.MapEditor && ME.MapEditor.placeObject) {
      items.forEach(function (it) {
        if (ME.MapEditor.placeObject(it.type, it.x, it.z, { ry: it.ry, scale: it.s })) added++;
      });
    }
    return { preset: name, seed: seed, added: added, byType: byType };
  };
  Brush.fillMap = Brush.fillPreset; /* alias cho nút "🌲 Lấp đầy map" */
  Brush.presetNames = function () { return Object.keys(PRESETS); };

  Brush.TOOLS = TOOLS;
  Brush.PAINT_TOOLS = PAINT_TOOLS;
  Brush.PRESETS = PRESETS;
  Brush.PRESET_SEEDS = PRESET_SEEDS;
  ME.TerrainBrush = Brush;
})();
