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
    segments: 64,
    waterLevel: null,  /* null = không hiện mặt nước */
    _waterMesh: null
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
    if (TerrainEditor._waterMesh) TerrainEditor._waterMesh.visible = false;
    TerrainEditor.waterLevel = null;
    TerrainEditor.data = null;
  };

  /* ---------- mực nước (mặt phẳng nước trong suốt) ---------- */
  TerrainEditor.setWaterLevel = function (y) {
    y = parseFloat(y);
    if (!isFinite(y)) return false;
    TerrainEditor.waterLevel = y;
    if (window.THREE) {
      if (!TerrainEditor._waterMesh) {
        var geo = new THREE.PlaneGeometry(1, 1);
        geo.rotateX(-Math.PI / 2);
        var m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
          color: 0x3a7ab5, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.1
        }));
        m.name = 'WaterLevel';
        TerrainEditor._waterMesh = m;
      }
      var size = TerrainEditor.size || 112;
      TerrainEditor._waterMesh.scale.set(size, 1, size);
      TerrainEditor._waterMesh.position.set(0, y, 0);
      TerrainEditor._waterMesh.visible = true;
      if (ME.Viewport3D && ME.Viewport3D.scene && !TerrainEditor._waterMesh.parent) {
        ME.Viewport3D.scene.add(TerrainEditor._waterMesh);
      }
    }
    if (ME.MapEditor && ME.MapEditor.data && ME.MapEditor.data.terrain) {
      ME.MapEditor.data.terrain.waterLevel = y;
    }
    return true;
  };
  TerrainEditor.hideWater = function () {
    TerrainEditor.waterLevel = null;
    if (TerrainEditor._waterMesh) TerrainEditor._waterMesh.visible = false;
    if (ME.MapEditor && ME.MapEditor.data && ME.MapEditor.data.terrain) {
      ME.MapEditor.data.terrain.waterLevel = null;
    }
  };

  /* ---------- import/export heightmap JSON ---------- */
  function downloadText(text, filename, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 100);
      return true;
    } catch (e) { return false; }
  }
  TerrainEditor.exportHeightmap = function () {
    if (!TerrainEditor.data) return null;
    var doc = {
      format: 'mapeditor-heightmap-1',
      size: TerrainEditor.data.size,
      segments: TerrainEditor.data.segments,
      heights: TerrainEditor.data.heights.slice ? TerrainEditor.data.heights.slice() : TerrainEditor.data.heights,
      paint: TerrainEditor.data.paint ? (TerrainEditor.data.paint.slice ? TerrainEditor.data.paint.slice() : TerrainEditor.data.paint) : null,
      waterLevel: TerrainEditor.waterLevel
    };
    var json = JSON.stringify(doc);
    var name = 'heightmap-' + (TerrainEditor.data.size || 112) + 'x' + (TerrainEditor.data.segments || 64) + '.json';
    downloadText(json, name, 'application/json');
    return doc;
  };
  TerrainEditor.importHeightmap = function (doc) {
    /* trả {ok, error?} — không throw */
    if (!doc || doc.format !== 'mapeditor-heightmap-1') {
      return { ok: false, error: 'format không phải mapeditor-heightmap-1' };
    }
    var size = doc.size || 112, seg = doc.segments || 64;
    var n = (seg + 1) * (seg + 1);
    if (!Array.isArray(doc.heights) || doc.heights.length !== n) {
      return { ok: false, error: 'heights sai độ dài (cần ' + n + ')' };
    }
    if (doc.paint && (!Array.isArray(doc.paint) || doc.paint.length !== n)) {
      return { ok: false, error: 'paint sai độ dài (cần ' + n + ')' };
    }
    var nd = {
      size: size, segments: seg,
      heights: doc.heights.slice(),
      paint: doc.paint ? doc.paint.slice() : new Array(n).fill(0),
      waterLevel: (doc.waterLevel !== undefined && doc.waterLevel !== null) ? doc.waterLevel : null
    };
    var oldParent = TerrainEditor.mesh ? TerrainEditor.mesh.parent : null;
    if (oldParent) oldParent.remove(TerrainEditor.mesh);
    TerrainEditor.dispose();
    var mesh = TerrainEditor.create(nd);
    if (oldParent) oldParent.add(mesh);
    else if (ME.Viewport3D && ME.Viewport3D.scene) ME.Viewport3D.scene.add(mesh);
    if (nd.waterLevel !== null) TerrainEditor.setWaterLevel(nd.waterLevel);
    if (ME.MapEditor && ME.MapEditor.data) {
      ME.MapEditor.data.terrain = nd;
      if (ME.MapEditor.emitChange) ME.MapEditor.emitChange('terrain-import');
    }
    return { ok: true };
  };

  ME.TerrainEditor = TerrainEditor;
})();
