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

  Brush.TOOLS = TOOLS;
  Brush.PAINT_TOOLS = PAINT_TOOLS;
  ME.TerrainBrush = Brush;
})();
