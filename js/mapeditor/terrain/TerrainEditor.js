/* ============================================================
 * mapeditor/terrain/TerrainEditor.js — Terrain heightmap thật
 * PlaneGeometry (size x size, segments x segments), heights lưu
 * trong data.terrain.heights (Float32), paint trong
 * data.terrain.paint (layer index / vertex). Vertex color hiển
 * thị layer. heightAt(x,z) nội suy song tuyến cho placement.
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  var TerrainEditor = {
    mesh: null,
    data: null,        /* data.terrain */
    size: 112,
    segments: 64
  };

  function layerColor(idx) {
    var L = ME.SceneData.LAYERS[idx] || ME.SceneData.LAYERS[0];
    return new THREE.Color(L.color);
  }

  TerrainEditor.create = function (terrainData) {
    if (!window.THREE) return null;
    TerrainEditor.data = terrainData;
    TerrainEditor.size = terrainData.size || 112;
    TerrainEditor.segments = terrainData.segments || 64;
    var seg = TerrainEditor.segments;
    var size = TerrainEditor.size;
    var geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    /* vertex colors */
    var n = (seg + 1) * (seg + 1);
    var colors = new Float32Array(n * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    var mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'Terrain';
    mesh.userData.mapType = 'terrain';
    TerrainEditor.mesh = mesh;
    TerrainEditor.applyHeights();
    TerrainEditor.applyPaint();
    return mesh;
  };

  TerrainEditor.applyHeights = function () {
    var mesh = TerrainEditor.mesh;
    if (!mesh || !TerrainEditor.data) return;
    var pos = mesh.geometry.attributes.position;
    var h = TerrainEditor.data.heights;
    for (var i = 0; i < pos.count; i++) {
      pos.array[i * 3 + 1] = h[i] || 0;
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  };

  TerrainEditor.applyPaint = function () {
    var mesh = TerrainEditor.mesh;
    if (!mesh || !TerrainEditor.data) return;
    var col = mesh.geometry.attributes.color;
    var paint = TerrainEditor.data.paint;
    for (var i = 0; i < col.count; i++) {
      var c = layerColor(paint ? paint[i] : 0);
      col.array[i * 3] = c.r; col.array[i * 3 + 1] = c.g; col.array[i * 3 + 2] = c.b;
    }
    col.needsUpdate = true;
  };

  /* đặt chiều cao 1 vertex (index) rồi cập nhật geometry */
  TerrainEditor.setHeightAtIndex = function (idx, h) {
    if (!TerrainEditor.data) return;
    TerrainEditor.data.heights[idx] = h;
    var pos = TerrainEditor.mesh.geometry.attributes.position;
    pos.array[idx * 3 + 1] = h;
    pos.needsUpdate = true;
  };

  TerrainEditor.setPaintAtIndex = function (idx, layerIdx, blend) {
    if (!TerrainEditor.data) return;
    var paint = TerrainEditor.data.paint;
    var col = TerrainEditor.mesh.geometry.attributes.color;
    var target = layerColor(layerIdx);
    if (blend === undefined || blend >= 1) {
      paint[idx] = layerIdx;
      col.array[idx * 3] = target.r; col.array[idx * 3 + 1] = target.g; col.array[idx * 3 + 2] = target.b;
    } else {
      /* blend màu về phía layer mới, giữ paint cũ nếu blend nhỏ */
      col.array[idx * 3] += (target.r - col.array[idx * 3]) * blend;
      col.array[idx * 3 + 1] += (target.g - col.array[idx * 3 + 1]) * blend;
      col.array[idx * 3 + 2] += (target.b - col.array[idx * 3 + 2]) * blend;
      if (blend > 0.6) paint[idx] = layerIdx;
    }
    col.needsUpdate = true;
  };

  TerrainEditor.recomputeNormals = function () {
    if (TerrainEditor.mesh) TerrainEditor.mesh.geometry.computeVertexNormals();
  };

  /* nội suy song tuyến — dùng cho đặt object lên mặt đất */
  TerrainEditor.heightAt = function (x, z) {
    var d = TerrainEditor.data;
    if (!d) return 0;
    var size = d.size, seg = d.segments, n = seg + 1;
    var gx = (x + size / 2) / size * seg;
    var gz = (z + size / 2) / size * seg;
    gx = Math.max(0, Math.min(seg - 0.001, gx));
    gz = Math.max(0, Math.min(seg - 0.001, gz));
    var ix = Math.floor(gx), iz = Math.floor(gz);
    var fx = gx - ix, fz = gz - iz;
    var h = d.heights;
    function at(i, j) { return h[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))] || 0; }
    var a = at(ix, iz), b = at(ix + 1, iz), c = at(ix, iz + 1), e = at(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + e) * fx * fz;
  };

  /* toạ độ world → chỉ số vertex gần nhất */
  TerrainEditor.vertexIndexAt = function (x, z) {
    var d = TerrainEditor.data;
    if (!d) return -1;
    var size = d.size, seg = d.segments, n = seg + 1;
    var ix = Math.round((x + size / 2) / size * seg);
    var iz = Math.round((z + size / 2) / size * seg);
    ix = Math.max(0, Math.min(seg, ix));
    iz = Math.max(0, Math.min(seg, iz));
    return iz * n + ix;
  };

  TerrainEditor.vertexPos = function (idx) {
    var d = TerrainEditor.data;
    if (!d) return null;
    var n = d.segments + 1;
    var ix = idx % n, iz = Math.floor(idx / n);
    return {
      x: -d.size / 2 + (ix / d.segments) * d.size,
      z: -d.size / 2 + (iz / d.segments) * d.size
    };
  };

  /* đổi kích thước / độ phân giải — resample heights + paint */
  TerrainEditor.resize = function (newSize, newSegments) {
    var old = TerrainEditor.data;
    if (!old) return null;
    newSize = newSize || old.size;
    newSegments = newSegments || old.segments;
    var n = newSegments + 1;
    var heights = new Float32Array(n * n);
    var paint = new Uint8Array(n * n);
    for (var j = 0; j < n; j++) {
      for (var i = 0; i < n; i++) {
        var x = -newSize / 2 + (i / newSegments) * newSize;
        var z = -newSize / 2 + (j / newSegments) * newSize;
        heights[j * n + i] = TerrainEditor.heightAt(x, z);
        /* paint: lấy layer của vertex gần nhất cũ */
        var vi = TerrainEditor.vertexIndexAt(x, z);
        paint[j * n + i] = (old.paint && old.paint[vi] !== undefined) ? old.paint[vi] : 0;
      }
    }
    var nd = { size: newSize, segments: newSegments, heights: Array.from(heights), paint: Array.from(paint) };
    TerrainEditor.data = nd;
    /* rebuild mesh */
    var parent = TerrainEditor.mesh ? TerrainEditor.mesh.parent : null;
    if (parent) parent.remove(TerrainEditor.mesh);
    var mesh = TerrainEditor.create(nd);
    if (parent) parent.add(mesh);
    return nd;
  };

  TerrainEditor.dispose = function () {
    if (TerrainEditor.mesh) {
      TerrainEditor.mesh.geometry.dispose();
      TerrainEditor.mesh.material.dispose();
      TerrainEditor.mesh = null;
    }
    TerrainEditor.data = null;
  };

  ME.TerrainEditor = TerrainEditor;
})();
