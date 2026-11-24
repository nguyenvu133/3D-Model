/* ============================================================
 * core/map-link.js — Cầu nối 2 chiều Studio ↔ MapEditor
 * - Studio → MapEditor: nút "Map Editor" trên topbar: serialize
 *   project hiện tại → shared key `pixistudio.sharedScene` →
 *   mở MapEditor.html?scene=pixistudio.sharedScene
 * - MapEditor → Studio: lúc boot, nếu URL có ?scene=... thì đọc
 *   shared key, import terrain + objects vào Viewport.modelRoot,
 *   rồi xoá key. Không có key / key lỗi → không đổi hành vi cũ.
 * Format: pixistudio-shared-scene-1 (xem docs/MAP_EDITOR.md §3).
 * Tái dùng window.MapEditor.SceneData / SharedScene / Placement
 * (được load trong index.html trước file này).
 * Mọi bước đều try/catch — lỗi không được crash Studio.
 * ============================================================ */
(function () {
  'use strict';

  var bus = PixiStudio.bus;

  var MapLink = {
    _lastMapDoc: null,
    _importedCount: 0
  };

  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message }); } catch (e) { }
  }

  function hasSharedParam() {
    try {
      return /[?&]scene=/.test(window.location.search) || /[?&]from=mapeditor/.test(window.location.search);
    } catch (e) { return false; }
  }

  /* ---------- Studio → MapEditor ---------- */
  MapLink.openMapEditor = function () {
    try {
      if (!window.MapEditor || !MapLink._hasDeps()) {
        notify('error', 'Map Editor', 'Thiếu module liên kết (SceneData/SharedScene). Kiểm tra lại script trong index.html.');
        return false;
      }
      var project = PixiStudio.Storage.serializeProject();
      var doc = MapLink.studioToShared(project);
      var ok = window.MapEditor.SharedScene.write(doc);
      if (!ok) {
        notify('error', 'Map Editor', 'Không ghi được shared key (localStorage đầy/bị chặn). Dùng Export Project rồi import trong Map Editor.');
        return false;
      }
      window.location.href = 'MapEditor.html?scene=pixistudio.sharedScene&from=studio';
      return true;
    } catch (err) {
      notify('error', 'Map Editor', 'Lỗi khi chuẩn bị scene: ' + err.message);
      return false;
    }
  };

  MapLink._hasDeps = function () {
    return !!(window.MapEditor && window.MapEditor.SceneData && window.MapEditor.SharedScene &&
      window.MapEditor.SceneData.fromStudioProject);
  };

  /* project studio → shared doc; giữ lại terrain/environment của map
   * đã import trước đó (round-trip) và cập nhật transform từ project. */
  MapLink.studioToShared = function (project) {
    var conv = window.MapEditor.SceneData.fromStudioProject(project || {});
    var doc = conv.doc;
    var old = MapLink._lastMapDoc && MapLink._lastMapDoc.map;
    if (old) {
      doc.map.terrain = old.terrain || null;
      doc.map.environment = old.environment || null;
      /* cập nhật transform của object cũ từ project.objects */
      var byUuid = {};
      (project.objects || []).forEach(function (o) { byUuid[o.uuid] = o; });
      var merged = old.objects.map(function (mo) {
        var so = byUuid[mo.id];
        if (so) {
          mo = JSON.parse(JSON.stringify(mo));
          mo.position = so.position.slice();
          mo.rotation = so.rotation.slice();
          mo.scale = so.scale.slice();
          mo.visible = so.visible !== false;
        }
        return mo;
      });
      var oldIds = {};
      merged.forEach(function (mo) { oldIds[mo.id] = true; });
      /* object mới tạo trong studio (chưa có trong map cũ) */
      conv.doc.map.objects.forEach(function (mo) {
        if (!oldIds[mo.id]) merged.push(mo);
      });
      doc.map.objects = merged;
    }
    return doc;
  };

  /* ---------- MapEditor → Studio ---------- */
  MapLink.checkIncoming = function () {
    try {
      if (!hasSharedParam()) return false;
      if (!MapLink._hasDeps()) return false;
      var doc = window.MapEditor.SharedScene.read();
      if (!doc || doc.format !== 'pixistudio-shared-scene-1') return false;
      if (doc.source === 'studio') return false; /* echo của chính mình */
      var ok = MapLink.importShared(doc);
      if (ok) window.MapEditor.SharedScene.clear();
      return ok;
    } catch (err) {
      console.error('[MapLink] checkIncoming lỗi:', err);
      return false;
    }
  };

  MapLink.importShared = function (doc) {
    try {
      if (!doc || !doc.map) return false;
      if (!PixiStudio.Viewport || !PixiStudio.Viewport.modelRoot || !PixiStudio.Scene) {
        notify('error', 'Map Editor', 'Studio chưa sẵn sàng để nhận map.');
        return false;
      }
      var warnings = [];
      var count = 0;

      /* terrain */
      if (doc.map.terrain) {
        try {
          var terrain = MapLink._buildTerrain(doc.map.terrain);
          if (terrain) {
            PixiStudio.Viewport.modelRoot.add(terrain);
            PixiStudio.Scene.register(terrain, 'environment', 'MapTerrain');
            count++;
          }
        } catch (e) { warnings.push('terrain lỗi: ' + e.message); }
      }
      /* environment: fog + nền trời */
      if (doc.map.environment) {
        try {
          var env = doc.map.environment;
          if (PixiStudio.Viewport.scene) {
            if (env.sky !== undefined) PixiStudio.Viewport.scene.background = new THREE.Color(env.sky);
            if (env.fog) PixiStudio.Viewport.scene.fog = new THREE.Fog(env.fog.color, env.fog.near, env.fog.far);
          }
        } catch (e) { warnings.push('environment lỗi: ' + e.message); }
      }
      /* objects */
      var primKinds = ['box', 'sphere', 'cylinder', 'cone', 'plane'];
      (doc.map.objects || []).forEach(function (o) {
        try {
          var obj = null;
          if (primKinds.indexOf(o.type) >= 0) {
            obj = PixiStudio.Scene.createPrimitiveByName(o.type);
            if (obj) {
              /* createPrimitiveByName thêm vào scene — chuyển sang modelRoot */
              if (obj.parent) obj.parent.remove(obj);
              PixiStudio.Viewport.modelRoot.add(obj);
            }
          } else if (o.type === 'light') {
            obj = MapLink._buildLight(o);
            if (obj) PixiStudio.Viewport.modelRoot.add(obj);
          } else if (window.MapEditor.Placement && window.MapEditor.Placement.buildPrefab) {
            obj = window.MapEditor.Placement.buildPrefab(o);
            PixiStudio.Viewport.modelRoot.add(obj);
          } else {
            obj = null;
          }
          if (!obj) {
            warnings.push('object "' + (o.name || o.id) + '" type=' + o.type + ' không build được');
            return;
          }
          obj.name = o.name || o.type;
          obj.position.fromArray(o.position || [0, 0, 0]);
          obj.rotation.fromArray(o.rotation || [0, 0, 0]);
          obj.scale.fromArray(o.scale || [1, 1, 1]);
          obj.visible = o.visible !== false;
          obj.userData.mapId = o.id;
          obj.userData.mapType = o.type;
          if (o.type === 'model' || o.placeholder) {
            warnings.push('"' + obj.name + '" là placeholder (model/unknown từ MapEditor)');
          }
          PixiStudio.Scene.register(obj, o.type === 'light' ? 'light' : (primKinds.indexOf(o.type) >= 0 ? 'primitive' : 'model'), obj.name);
          count++;
        } catch (e) {
          warnings.push('object "' + (o.name || o.id) + '" lỗi: ' + e.message);
        }
      });

      MapLink._lastMapDoc = JSON.parse(JSON.stringify(doc));
      MapLink._importedCount = count;
      var msg = 'Đã nhận map "' + (doc.name || 'Untitled') + '" từ Map Editor: ' + count + ' objects' +
        (doc.map.terrain ? ' + terrain' : '') + '.';
      if (warnings.length) msg += ' Lưu ý: ' + warnings.slice(0, 3).join(' | ') + (warnings.length > 3 ? ' (+' + (warnings.length - 3) + ' nữa)' : '');
      notify(warnings.length ? 'warning' : 'success', 'Map Editor → Studio', msg);
      bus.emit('scene:changed', { action: 'maplink-import', count: count });
      /* focus terrain nếu có */
      try {
        var terrainObj = PixiStudio.Viewport.modelRoot.children.find(function (c) { return c.name === 'MapTerrain'; });
        if (terrainObj && PixiStudio.Viewport.orbit) PixiStudio.Viewport.orbit.focus(terrainObj, true);
      } catch (e) { }
      return true;
    } catch (err) {
      console.error('[MapLink] importShared lỗi:', err);
      notify('error', 'Map Editor', 'Import map lỗi: ' + err.message);
      return false;
    }
  };

  MapLink._buildTerrain = function (t) {
    var seg = t.segments || 64;
    var size = t.size || 112;
    var geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    var n = (seg + 1) * (seg + 1);
    var colors = new Float32Array(n * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      pos.array[i * 3 + 1] = (t.heights && t.heights[i]) || 0;
      var layer = (t.paint && t.paint[i] !== undefined) ? t.paint[i] : 0;
      var L = (window.MapEditor.SceneData.LAYERS || [])[layer] || { color: 0x4a7a3a };
      var c = new THREE.Color(L.color);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    var mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    mesh.receiveShadow = true;
    mesh.name = 'MapTerrain';
    mesh.userData.mapType = 'terrain';
    return mesh;
  };

  MapLink._buildLight = function (o) {
    var g = new THREE.Group();
    var L = o.light || { color: 0xfff2cc, intensity: 1, distance: 18 };
    var pl = new THREE.PointLight(L.color, L.intensity, L.distance || 18);
    g.add(pl);
    var bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 8),
      new THREE.MeshBasicMaterial({ color: L.color })
    );
    g.add(bulb);
    g.userData.pointLight = pl;
    return g;
  };

  /* ---------- init (gọi từ App.boot sau Topbar.init) ---------- */
  MapLink.init = function () {
    try {
      var btn = document.getElementById('btn-map-editor');
      if (btn) {
        btn.addEventListener('click', function () { MapLink.openMapEditor(); });
      }
      MapLink.checkIncoming();
    } catch (err) {
      console.error('[MapLink] init lỗi:', err);
    }
  };

  window.PixiStudio.MapLink = MapLink;
})();
