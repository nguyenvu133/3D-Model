/* ============================================================
 * mapeditor/core/MapEditor.js — Core: boot, loop, input, undo,
 * selection, CRUD object, placement, shortcuts, status.
 * Trang MapEditor.html gọi MapEditor.boot() khi DOM sẵn sàng.
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  var MapEditor = {
    data: null,
    objects: {},          /* id -> THREE.Group */
    _selectedId: null,
    tool: 'select',       /* select | move | rotate | scale | raise | lower | smooth | flatten | noise | mountain | paint | scatter | patrol */
    _undo: [],
    _redo: [],
    _undoLock: false,
    _orbitEnabled: true,
    _placementType: null,
    _ghost: null,
    _addWaypointFor: null,
    _dragging: null,      /* {button, x, y, moved, mode} */
    _thandieu: null,      /* {mixer, clips, objectId} */
    _dirty: false,
    _typeCount: {},
    booted: false
  };

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  MapEditor.setStatus = function (msg) {
    var s = $('me-status');
    if (s) s.textContent = msg;
  };
  MapEditor.notify = function (title, message, type) {
    MapEditor.setStatus(title + ': ' + message);
    var root = $('me-toast-root');
    if (!root) return;
    var t = document.createElement('div');
    t.className = 'me-toast ' + (type || 'info');
    t.innerHTML = '<b></b><span></span>';
    t.querySelector('b').textContent = title;
    t.querySelector('span').textContent = message;
    root.appendChild(t);
    setTimeout(function () { t.remove(); }, 5000);
  };

  /* ---------- undo / redo ---------- */
  MapEditor.pushUndo = function (label) {
    if (MapEditor._undoLock || !MapEditor.data) return;
    MapEditor._undo.push(JSON.stringify(MapEditor.data));
    if (MapEditor._undo.length > 40) MapEditor._undo.shift();
    MapEditor._redo.length = 0;
    MapEditor._dirty = true;
    MapEditor.refreshUndoButtons();
  };
  MapEditor.undo = function () {
    if (!MapEditor._undo.length) return false;
    MapEditor._redo.push(JSON.stringify(MapEditor.data));
    var snap = MapEditor._undo.pop();
    MapEditor._undoLock = true;
    MapEditor.loadData(JSON.parse(snap), { noUndo: true });
    MapEditor._undoLock = false;
    MapEditor.refreshUndoButtons();
    return true;
  };
  MapEditor.redo = function () {
    if (!MapEditor._redo.length) return false;
    MapEditor._undo.push(JSON.stringify(MapEditor.data));
    var snap = MapEditor._redo.pop();
    MapEditor._undoLock = true;
    MapEditor.loadData(JSON.parse(snap), { noUndo: true });
    MapEditor._undoLock = false;
    MapEditor.refreshUndoButtons();
    return true;
  };
  MapEditor.refreshUndoButtons = function () {
    var u = $('me-undo'), r = $('me-redo');
    if (u) u.disabled = !MapEditor._undo.length;
    if (r) r.disabled = !MapEditor._redo.length;
  };

  /* ---------- scene build / load ---------- */
  MapEditor.loadData = function (data, opts) {
    opts = opts || {};
    var errs = ME.SceneData.validate(data);
    if (errs.length) {
      MapEditor.notify('Load scene lỗi', errs.join('; '), 'error');
      return false;
    }
    /* dọn scene cũ */
    Object.keys(MapEditor.objects).forEach(function (id) {
      var o = MapEditor.objects[id];
      if (o.parent) o.parent.remove(o);
    });
    MapEditor.objects = {};
    MapEditor._selectedId = null;
    if (ME.TerrainEditor.mesh && ME.TerrainEditor.mesh.parent) {
      ME.TerrainEditor.mesh.parent.remove(ME.TerrainEditor.mesh);
    }
    ME.TerrainEditor.dispose();
    MapEditor.data = data;
    /* terrain */
    var terrain = ME.TerrainEditor.create(data.terrain);
    ME.Viewport3D.scene.add(terrain);
    /* environment */
    if (data.environment) ME.Environment.apply(data.environment);
    /* objects */
    data.objects.forEach(function (o) {
      MapEditor._addObjectMesh(o);
    });
    MapEditor._typeCount = {};
    data.objects.forEach(function (o) {
      var base = o.type;
      MapEditor._typeCount[base] = (MapEditor._typeCount[base] || 0) + 1;
    });
    if (ME.Hierarchy) ME.Hierarchy.render();
    if (ME.Inspector) ME.Inspector.render();
    MapEditor.refreshUndoButtons();
    MapEditor.setStatus('Scene "' + data.name + '" — ' + data.objects.length + ' objects');
    return true;
  };

  MapEditor._addObjectMesh = function (dataObj) {
    var g = ME.Placement.buildPrefab(dataObj);
    ME.Viewport3D.root.add(g);
    MapEditor.objects[dataObj.id] = g;
    /* y theo terrain nếu chưa set (object mới) */
    return g;
  };

  MapEditor.newScene = function (template) {
    var name = template === 'bamboo' ? 'Bamboo Forest' : (template === 'dungeon' ? 'Dungeon' : 'Truong Bach');
    MapEditor.pushUndo('New scene');
    MapEditor.loadData(ME.SceneData.newSceneData(name, template || 'snow'));
    MapEditor.notify('New scene', 'Đã tạo map "' + name + '"', 'success');
  };

  /* ---------- selection ---------- */
  MapEditor.selectedId = function () { return MapEditor._selectedId; };
  MapEditor.select = function (id) {
    MapEditor._selectedId = id;
    var obj = id ? MapEditor.objects[id] : null;
    if (ME.Viewport3D) {
      ME.Viewport3D.attachGizmo(obj, MapEditor.tool === 'move' ? 'translate' : (MapEditor.tool === 'rotate' ? 'rotate' : (MapEditor.tool === 'scale' ? 'scale' : null)));
    }
    if (ME.Hierarchy) ME.Hierarchy.render();
    if (ME.Inspector) ME.Inspector.render();
  };
  MapEditor.getObjectData = function (id) {
    if (!MapEditor.data) return null;
    for (var i = 0; i < MapEditor.data.objects.length; i++) {
      if (MapEditor.data.objects[i].id === id) return MapEditor.data.objects[i];
    }
    return null;
  };
  MapEditor.getObject3D = function (id) { return MapEditor.objects[id] || null; };
  MapEditor.forEachObject = function (fn) {
    Object.keys(MapEditor.objects).forEach(function (id) { fn(MapEditor.objects[id]); });
  };
  MapEditor.focusSelected = function () {
    var obj = MapEditor._selectedId ? MapEditor.objects[MapEditor._selectedId] : null;
    if (obj && ME.Viewport3D.rig) ME.Viewport3D.rig.focus(obj);
    else if (ME.Viewport3D.rig) ME.Viewport3D.rig.frameAll(112);
  };

  /* ---------- CRUD ---------- */
  MapEditor._nextName = function (type) {
    var base = type.charAt(0).toUpperCase() + type.slice(1);
    MapEditor._typeCount[type] = (MapEditor._typeCount[type] || 0) + 1;
    return base + '_' + MapEditor._typeCount[type];
  };

  MapEditor.placeObject = function (type, x, z, opts) {
    opts = opts || {};
    if (!MapEditor.data) return null;
    MapEditor.pushUndo('Place ' + type);
    var y = ME.TerrainEditor.heightAt(x, z);
    var dataObj = {
      id: ME.SceneData.newId('obj'), type: type,
      name: opts.name || MapEditor._nextName(type),
      group: opts.group || ME.SceneData.TYPE_GROUP[type] || 'Props',
      position: [x, y, z],
      rotation: [0, opts.randomRot ? Math.random() * Math.PI * 2 : (opts.ry || 0), 0],
      scale: [1, 1, 1],
      color: null, material: null,
      collider: (type === 'temple' || type === 'house' || type === 'gate') ? { shape: 'box', size: [6, 4, 5] } : null,
      light: (type === 'lantern' || type === 'campfire' || type === 'portal') ? { color: type === 'portal' ? 0x9d4edd : 0xff8a2a, intensity: 0.8, distance: 12 } : null,
      path: type === 'patrol' ? [[x - 6, z - 6], [x + 6, z - 6], [x + 6, z + 6], [x - 6, z + 6]] : null,
      anim: (type === 'hero' || type === 'monster' || type === 'boss') ? 'Idle' : null,
      url: null, placeholder: false, locked: false, visible: true
    };
    if (opts.randomScale) {
      var s = 0.8 + Math.random() * 0.5;
      dataObj.scale = [s, s, s];
    }
    if (opts.scale) dataObj.scale = [opts.scale, opts.scale, opts.scale];
    MapEditor.data.objects.push(dataObj);
    var g = MapEditor._addObjectMesh(dataObj);
    if (ME.Hierarchy) ME.Hierarchy.render();
    MapEditor.select(dataObj.id);
    return g;
  };

  MapEditor.deleteObject = function (id) {
    if (!id) return false;
    var d = MapEditor.getObjectData(id);
    if (!d || d.locked) {
      if (d && d.locked) MapEditor.notify('Delete', 'Object đang khoá — mở khoá trước.', 'warning');
      return false;
    }
    MapEditor.pushUndo('Delete ' + d.name);
    MapEditor.data.objects = MapEditor.data.objects.filter(function (o) { return o.id !== id; });
    var o3 = MapEditor.objects[id];
    if (o3 && o3.parent) o3.parent.remove(o3);
    delete MapEditor.objects[id];
    MapEditor.select(null);
    return true;
  };
  MapEditor.deleteSelected = function () {
    if (MapEditor._selectedId) MapEditor.deleteObject(MapEditor._selectedId);
  };

  MapEditor.duplicateSelected = function () {
    var id = MapEditor._selectedId;
    if (!id) return null;
    var d = MapEditor.getObjectData(id);
    if (!d) return null;
    MapEditor.pushUndo('Duplicate ' + d.name);
    var copy = JSON.parse(JSON.stringify(d));
    copy.id = ME.SceneData.newId('obj');
    copy.name = d.name + '_copy';
    copy.position = [d.position[0] + 2, d.position[1], d.position[2] + 2];
    MapEditor.data.objects.push(copy);
    MapEditor._addObjectMesh(copy);
    if (ME.Hierarchy) ME.Hierarchy.render();
    MapEditor.select(copy.id);
    return copy;
  };

  MapEditor.rename = function (id, name) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    MapEditor.pushUndo('Rename');
    d.name = name;
    var o3 = MapEditor.objects[id];
    if (o3) o3.name = name;
    if (ME.Hierarchy) ME.Hierarchy.render();
    if (ME.Inspector) ME.Inspector.render();
  };

  MapEditor.setGroup = function (id, group) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    MapEditor.pushUndo('Move to group');
    d.group = group;
    if (ME.Hierarchy) ME.Hierarchy.render();
  };

  MapEditor.toggleVisible = function (id) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    d.visible = d.visible === false ? true : false;
    var o3 = MapEditor.objects[id];
    if (o3) o3.visible = d.visible;
    if (ME.Hierarchy) ME.Hierarchy.render();
    if (ME.Inspector) ME.Inspector.render();
  };

  MapEditor.toggleLock = function (id) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    d.locked = !d.locked;
    if (ME.Hierarchy) ME.Hierarchy.render();
    if (ME.Inspector) ME.Inspector.render();
  };

  /* ---------- transform / material / light / collider ---------- */
  MapEditor.setTransform = function (id, kind, idx, value) {
    var d = MapEditor.getObjectData(id);
    var o3 = MapEditor.objects[id];
    if (!d || !o3) return;
    d[kind][idx] = value;
    o3[kind].fromArray(d[kind]);
    MapEditor._dirty = true;
    if (ME.Viewport3D) ME.Viewport3D.refreshColliders(ME.Viewport3D.colliderHelpers.visible);
  };
  MapEditor.applyTransform = function (id, t) {
    var d = MapEditor.getObjectData(id);
    var o3 = MapEditor.objects[id];
    if (!d || !o3) return;
    MapEditor.pushUndo('Paste transform');
    d.position = t.p.slice(); d.rotation = t.r.slice(); d.scale = t.s.slice();
    o3.position.fromArray(d.position);
    o3.rotation.fromArray(d.rotation);
    o3.scale.fromArray(d.scale);
    if (ME.Inspector) ME.Inspector.render();
  };
  MapEditor.resetTransform = function (id) {
    var d = MapEditor.getObjectData(id);
    var o3 = MapEditor.objects[id];
    if (!d || !o3) return;
    MapEditor.pushUndo('Reset transform');
    d.rotation = [0, 0, 0]; d.scale = [1, 1, 1];
    d.position[1] = ME.TerrainEditor.heightAt(d.position[0], d.position[2]);
    o3.rotation.set(0, 0, 0); o3.scale.set(1, 1, 1);
    o3.position.fromArray(d.position);
    if (ME.Inspector) ME.Inspector.render();
  };
  MapEditor.setColor = function (id, hex) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    MapEditor.pushUndo('Set color');
    d.color = hex;
    var o3 = MapEditor.objects[id];
    if (o3) {
      o3.traverse(function (ch) {
        if (ch.isMesh && ch.material && ch.material.color) {
          ch.material = ch.material.clone();
          ch.material.color.setHex(hex);
        }
      });
    }
    if (ME.Inspector) ME.Inspector.render();
  };
  MapEditor.setMaterial = function (id, key, value) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    if (!d.material) d.material = {};
    d.material[key] = value;
    var o3 = MapEditor.objects[id];
    if (o3) {
      o3.traverse(function (ch) {
        if (ch.isMesh && ch.material && ch.material.isMeshStandardMaterial) {
          if (key === 'opacity') { ch.material.transparent = value < 1; }
          ch.material[key] = value;
        }
      });
    }
    MapEditor._dirty = true;
  };
  MapEditor.setLight = function (id, key, value) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    if (!d.light) d.light = { color: 0xffb347, intensity: 0.8, distance: 16 };
    d.light[key] = value;
    var o3 = MapEditor.objects[id];
    if (o3 && o3.userData.pointLight) {
      var pl = o3.userData.pointLight;
      if (key === 'color') pl.color.setHex(value);
      else pl[key] = value;
    }
    MapEditor._dirty = true;
  };
  MapEditor.setCollider = function (id, collider) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    MapEditor.pushUndo('Set collider');
    d.collider = collider;
    var o3 = MapEditor.objects[id];
    if (o3) o3.userData.collider = collider;
    if (ME.Viewport3D) ME.Viewport3D.refreshColliders(ME.Viewport3D.colliderHelpers.visible);
    if (ME.Inspector) ME.Inspector.render();
  };
  MapEditor.setPath = function (id, path) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    MapEditor.pushUndo('Set patrol path');
    d.path = path;
    var o3 = MapEditor.objects[id];
    if (o3 && o3.parent) {
      o3.parent.remove(o3);
      delete MapEditor.objects[id];
      MapEditor._addObjectMesh(d);
    }
    if (ME.Hierarchy) ME.Hierarchy.render();
    if (ME.Inspector) ME.Inspector.render();
  };
  MapEditor.startAddWaypoint = function (id) {
    MapEditor._addWaypointFor = id;
    MapEditor.setTool('select');
    MapEditor.notify('Patrol', 'Click lên terrain để thêm điểm vào path. Esc để xong.', 'info');
  };
  MapEditor.setAnim = function (id, anim) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    d.anim = anim;
    MapEditor._dirty = true;
  };
  MapEditor.findPatrolNear = function (pos) {
    if (!MapEditor.data) return null;
    for (var i = 0; i < MapEditor.data.objects.length; i++) {
      var o = MapEditor.data.objects[i];
      if (o.type !== 'patrol' || !o.path) continue;
      for (var j = 0; j < o.path.length; j++) {
        var dx = o.path[j][0] - pos.x, dz = o.path[j][1] - pos.z;
        if (dx * dx + dz * dz < 225) return o;
      }
    }
    return null;
  };

  /* ---------- Thần Điêu FBX (nếu có file trong repo) ---------- */
  MapEditor.loadThandieuFor = function (heroId) {
    if (!window.THREE || !THREE.FBXLoader) {
      MapEditor.notify('Thần Điêu', 'FBXLoader chưa load (cần mạng CDN).', 'error');
      return Promise.resolve(false);
    }
    var base = 'models/thandieu/thandieu-Mixamo.fbx';
    return fetch(base, { method: 'HEAD' }).then(function (r) {
      if (!r.ok) throw new Error('not-found');
      return MapEditor._loadThandieuFBX(heroId, base);
    }).catch(function () {
      MapEditor.notify('Thần Điêu', 'Chưa có ' + base + ' trong repo — giữ hero chibi. Upload 3 file FBX vào models/thandieu/ rồi thử lại.', 'warning');
      return false;
    });
  };
  MapEditor._loadThandieuFBX = function (heroId, baseUrl) {
    var hero = MapEditor.objects[heroId];
    if (!hero) return Promise.resolve(false);
    var loader = new THREE.FBXLoader();
    function loadOne(url) {
      return new Promise(function (resolve, reject) {
        loader.load(url, resolve, undefined, function (e) { reject(e || new Error('load fail ' + url)); });
      });
    }
    return loadOne(baseUrl).then(function (fbx) {
      var clips = {};
      var animFiles = ['models/thandieu/Neutral_Idle.fbx', 'models/thandieu/Than_dieu_Fast_Run.fbx'];
      var jobs = animFiles.map(function (u) {
        return loadOne(u).then(function (o) {
          (o.animations || []).forEach(function (c) { clips[c.name === 'mixamo.com' ? u : c.name] = c; });
        }).catch(function () { /* animation thiếu thì bỏ qua */ });
      });
      return Promise.all(jobs).then(function () {
        /* thay hero chibi bằng FBX (giữ transform) */
        var parent = hero.parent;
        var idx = parent ? parent.children.indexOf(hero) : -1;
        if (parent) parent.remove(hero);
        fbx.scale.setScalar(1.3);
        fbx.position.copy(hero.position);
        fbx.rotation.copy(hero.rotation);
        fbx.userData.mapId = heroId;
        fbx.userData.mapType = 'hero';
        fbx.userData.mapName = hero.name;
        fbx.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        if (parent) parent.add(fbx);
        MapEditor.objects[heroId] = fbx;
        var mixer = new THREE.AnimationMixer(fbx);
        var clipList = Object.keys(clips).map(function (k) { return clips[k]; });
        MapEditor._thandieu = { mixer: mixer, clips: clipList, objectId: heroId, current: null };
        if (clipList.length) MapEditor._thandieuPlay(0);
        MapEditor.notify('Thần Điêu', 'Đã load Thần Điêu FBX (' + clipList.length + ' clip animation).', 'success');
        if (ME.Hierarchy) ME.Hierarchy.render();
        return true;
      });
    }).catch(function (e) {
      MapEditor.notify('Thần Điêu', 'Load FBX lỗi: ' + (e && e.message || e), 'error');
      return false;
    });
  };
  MapEditor._thandieuPlay = function (clipIdx) {
    var t = MapEditor._thandieu;
    if (!t || !t.clips.length) return;
    var clip = t.clips[clipIdx % t.clips.length];
    if (t.current) t.current.stop();
    var action = t.mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat);
    action.play();
    t.current = action;
  };

  /* ---------- tool / gizmo ---------- */
  MapEditor.setTool = function (tool) {
    MapEditor.tool = tool;
    var B = ME.TerrainBrush;
    if (['raise', 'lower', 'smooth', 'flatten', 'noise', 'mountain'].indexOf(tool) >= 0) {
      B.mode = 'sculpt'; B.tool = tool;
    } else if (tool === 'paint') {
      B.mode = 'paint';
    } else if (tool === 'scatter') {
      B.mode = 'sculpt';
    } else {
      B.mode = 'sculpt';
    }
    MapEditor.cancelPlacement();
    if (ME.Viewport3D) {
      var mode = tool === 'move' ? 'translate' : (tool === 'rotate' ? 'rotate' : (tool === 'scale' ? 'scale' : null));
      var sel = MapEditor._selectedId ? MapEditor.objects[MapEditor._selectedId] : null;
      if (sel && mode) ME.Viewport3D.attachGizmo(sel, mode);
      else if (mode) ME.Viewport3D.attachGizmo(null);
    }
    MapEditor.refreshToolButtons();
  };
  MapEditor.refreshToolButtons = function () {
    document.querySelectorAll('[data-me-tool]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.meTool === MapEditor.tool);
    });
  };
  MapEditor.setOrbitEnabled = function (v) { MapEditor._orbitEnabled = v; };
  MapEditor.onGizmoDragStart = function () {
    MapEditor.pushUndo('Move object');
  };
  MapEditor.onGizmoChanged = function (live) {
    var id = MapEditor._selectedId;
    if (!id) return;
    var d = MapEditor.getObjectData(id);
    var o3 = MapEditor.objects[id];
    if (!d || !o3) return;
    d.position = [o3.position.x, o3.position.y, o3.position.z];
    d.rotation = [o3.rotation.x, o3.rotation.y, o3.rotation.z];
    d.scale = [o3.scale.x, o3.scale.y, o3.scale.z];
    if (!live && ME.Inspector) ME.Inspector.render();
  };
  MapEditor.refreshAfterTerrain = function () {
    MapEditor._dirty = true;
  };

  /* ---------- placement mode ---------- */
  MapEditor.startPlacement = function (type) {
    MapEditor._placementType = type;
    MapEditor.setStatus('Đặt ' + type + ' — click lên terrain để đặt, Esc để huỷ');
    var cv = $('me-viewport');
    if (cv) cv.style.cursor = 'crosshair';
  };
  MapEditor.cancelPlacement = function () {
    MapEditor._placementType = null;
    if (MapEditor._ghost) {
      if (MapEditor._ghost.parent) MapEditor._ghost.parent.remove(MapEditor._ghost);
      MapEditor._ghost = null;
    }
    var cv = $('me-viewport');
    if (cv) cv.style.cursor = '';
  };
  MapEditor._updateGhost = function (point) {
    if (!MapEditor._placementType || !point) return;
    if (!MapEditor._ghost || MapEditor._ghost.userData.ghostType !== MapEditor._placementType) {
      if (MapEditor._ghost && MapEditor._ghost.parent) MapEditor._ghost.parent.remove(MapEditor._ghost);
      var tmp = {
        id: 'ghost', type: MapEditor._placementType, name: 'ghost',
        position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
        color: null, material: null, collider: null, light: null, path: null, anim: null, url: null
      };
      var g = ME.Placement.buildPrefab(tmp);
      g.userData.ghostType = MapEditor._placementType;
      g.traverse(function (ch) {
        if (ch.isMesh) {
          ch.material = ch.material.clone();
          ch.material.transparent = true;
          ch.material.opacity = 0.55;
        }
      });
      MapEditor._ghost = g;
      ME.Viewport3D.scene.add(g);
    }
    MapEditor._ghost.position.set(point.x, ME.TerrainEditor.heightAt(point.x, point.z), point.z);
    MapEditor._ghost.visible = true;
  };

  /* ---------- input: chuột ---------- */
  MapEditor._bindPointer = function () {
    var cv = $('me-viewport');
    if (!cv) return;
    var wrap = $('me-viewport-wrap');

    function ndcFromEvent(e) {
      return ME.Viewport3D.screenToNDC(e.clientX, e.clientY);
    }
    function terrainPointFromEvent(e) {
      return ME.Viewport3D.terrainPoint(ndcFromEvent(e), ME.TerrainEditor.mesh);
    }

    cv.addEventListener('pointerdown', function (e) {
      cv.setPointerCapture(e.pointerId);
      MapEditor._dragging = { button: e.button, x: e.clientX, y: e.clientY, moved: 0, mode: null };
      var ndc = ndcFromEvent(e);
      /* thêm waypoint patrol */
      if (MapEditor._addWaypointFor && e.button === 0) {
        var tp = terrainPointFromEvent(e);
        if (tp) {
          var d = MapEditor.getObjectData(MapEditor._addWaypointFor);
          if (d) {
            MapEditor.pushUndo('Add waypoint');
            d.path = (d.path || []).concat([[Math.round(tp.x * 10) / 10, Math.round(tp.z * 10) / 10]]);
            MapEditor.setPath(MapEditor._addWaypointFor, d.path);
          }
        }
        return;
      }
      /* placement */
      if (MapEditor._placementType && e.button === 0) {
        var pp = terrainPointFromEvent(e);
        if (pp) MapEditor.placeObject(MapEditor._placementType, pp.x, pp.z, {});
        return;
      }
      if (e.button === 0) {
        var tool = MapEditor.tool;
        if (['raise', 'lower', 'smooth', 'flatten', 'noise', 'mountain', 'paint', 'scatter'].indexOf(tool) >= 0) {
          var p = terrainPointFromEvent(e);
          if (p) {
            if (tool === 'scatter') {
              MapEditor.pushUndo('Scatter');
              ME.TerrainBrush.scatter(p.x, p.z, MapEditor._scatterType || 'pine', 5);
            } else {
              ME.TerrainBrush.beginStroke(p.x, p.z);
            }
            MapEditor._dragging.mode = 'brush';
          }
          return;
        }
        MapEditor._dragging.mode = 'orbit';
      } else if (e.button === 2) {
        MapEditor._dragging.mode = 'pan';
      } else if (e.button === 1) {
        MapEditor._dragging.mode = 'pan';
        e.preventDefault();
      }
    });

    cv.addEventListener('pointermove', function (e) {
      var dr = MapEditor._dragging;
      var ndc = ndcFromEvent(e);
      /* ghost placement */
      if (MapEditor._placementType) {
        var gp = terrainPointFromEvent(e);
        if (gp) MapEditor._updateGhost(gp);
        return;
      }
      /* brush preview + stroke */
      var tool = MapEditor.tool;
      var isBrush = ['raise', 'lower', 'smooth', 'flatten', 'noise', 'mountain', 'paint', 'scatter'].indexOf(tool) >= 0;
      if (isBrush) {
        var bp = terrainPointFromEvent(e);
        if (bp) {
          ME.TerrainBrush.movePreview(bp.x, bp.z);
          if (dr && dr.mode === 'brush') ME.TerrainBrush.strokeTo(bp.x, bp.z);
        }
        return;
      }
      if (!dr) return;
      var dx = e.clientX - dr.x, dy = e.clientY - dr.y;
      dr.moved += Math.abs(dx) + Math.abs(dy);
      dr.x = e.clientX; dr.y = e.clientY;
      if (!MapEditor._orbitEnabled) return;
      if (dr.mode === 'orbit') {
        ME.Viewport3D.rig.rotate(-dx * 0.005, -dy * 0.005);
      } else if (dr.mode === 'pan') {
        var k = ME.Viewport3D.rig.radius * 0.0016;
        ME.Viewport3D.rig.pan(dx * k, dy * k);
      }
    });

    cv.addEventListener('pointerup', function (e) {
      var dr = MapEditor._dragging;
      MapEditor._dragging = null;
      if (ME.TerrainBrush._painting) ME.TerrainBrush.endStroke();
      if (!dr) return;
      /* click (không kéo) với tool select → chọn object */
      if (e.button === 0 && dr.mode === 'orbit' && dr.moved < 6) {
        var pick = ME.Viewport3D.pickObject(ndcFromEvent(e));
        if (pick) {
          MapEditor.select(pick.object.userData.mapId);
          if (MapEditor._addWaypointFor) { /* đã xử lý ở pointerdown */ }
        } else {
          MapEditor.select(null);
        }
      }
    });

    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      ME.Viewport3D.rig.zoom(e.deltaY > 0 ? 1.1 : 0.9);
    }, { passive: false });

    cv.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      MapEditor.cancelPlacement();
      MapEditor._addWaypointFor = null;
    });

    /* drag-drop asset từ Asset Manager */
    cv.addEventListener('dragover', function (e) { e.preventDefault(); });
    cv.addEventListener('drop', function (e) {
      e.preventDefault();
      var data = e.dataTransfer.getData('text/plain');
      if (data && data.indexOf('asset:') === 0) {
        var type = data.slice(6);
        var p = ME.Viewport3D.terrainPoint(ndcFromEvent(e), ME.TerrainEditor.mesh);
        if (p) MapEditor.placeObject(type, p.x, p.z, { randomRot: true });
      }
    });
  };

  /* ---------- input: bàn phím ---------- */
  MapEditor._bindKeys = function () {
    window.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      var k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); MapEditor.undo(); }
        else if ((k === 'y') || (k === 'z' && e.shiftKey)) { e.preventDefault(); MapEditor.redo(); }
        else if (k === 's') { e.preventDefault(); ME.MapExport.save(); MapEditor.notify('Save', 'Đã lưu project "' + ME.MapExport.currentName + '"', 'success'); }
        else if (k === 'd') { e.preventDefault(); MapEditor.duplicateSelected(); }
        return;
      }
      if (k === 'escape') {
        MapEditor.cancelPlacement();
        MapEditor._addWaypointFor = null;
        MapEditor.select(null);
      } else if (k === 'q') MapEditor.setTool('select');
      else if (k === 'w') MapEditor.setTool('move');
      else if (k === 'e') MapEditor.setTool('rotate');
      else if (k === 'r') MapEditor.setTool('scale');
      else if (k === 'f') MapEditor.focusSelected();
      else if (k === 'g') MapEditor.toggleGrid();
      else if (k === 'delete' || k === 'backspace') MapEditor.deleteSelected();
      else if (k === ' ') { e.preventDefault(); MapEditor.togglePlay(); }
    });
  };

  MapEditor.toggleGrid = function () {
    if (!ME.Viewport3D.grid) return;
    ME.Viewport3D.grid.visible = !ME.Viewport3D.grid.visible;
    var b = $('me-grid-btn');
    if (b) b.classList.toggle('active', ME.Viewport3D.grid.visible);
  };

  MapEditor.togglePlay = function () {
    var playing = !ME.Viewport3D.isPlaying();
    ME.Viewport3D.setPlaying(playing);
    var b = $('me-play-btn');
    if (b) b.textContent = playing ? '⏸ Pause' : '▶ Play';
    MapEditor.setStatus(playing ? 'Đang Play — hero/quái di chuyển theo patrol' : 'Đã dừng Play');
  };

  /* ---------- toolbar / panel wiring ---------- */
  MapEditor._bindToolbar = function () {
    function on(id, fn) {
      var b = $(id);
      if (b) b.addEventListener('click', fn);
    }
    on('me-new-btn', function () {
      var t = window.prompt('Template: snow (Trường Bạch) / bamboo / dungeon', 'snow') || 'snow';
      MapEditor.newScene(['snow', 'bamboo', 'dungeon'].indexOf(t) >= 0 ? t : 'snow');
    });
    on('me-save-btn', function () {
      var name = window.prompt('Tên project:', ME.MapExport.currentName) || ME.MapExport.currentName;
      if (ME.MapExport.save(name)) MapEditor.notify('Save', 'Đã lưu "' + name + '"', 'success');
    });
    on('me-open-btn', function () { MapEditor.showOpenDialog(); });
    on('me-export-btn', function () { ME.MapExport.exportFile(); });
    on('me-import-btn', function () { var f = $('me-file-input'); if (f) f.click(); });
    on('me-studio-btn', function () { ME.MapExport.openInStudio(); });
    on('me-undo', function () { MapEditor.undo(); });
    on('me-redo', function () { MapEditor.redo(); });
    on('me-play-btn', function () { MapEditor.togglePlay(); });
    on('me-stop-btn', function () {
      ME.Viewport3D.setPlaying(false);
      var b = $('me-play-btn');
      if (b) b.textContent = '▶ Play';
    });
    on('me-focus-btn', function () { MapEditor.focusSelected(); });
    on('me-frame-btn', function () { ME.Viewport3D.rig.frameAll(112); });
    on('me-grid-btn', function () { MapEditor.toggleGrid(); });
    on('me-collision-btn', function () {
      var v = !ME.Viewport3D.colliderHelpers.visible;
      ME.Viewport3D.refreshColliders(v);
      var b = $('me-collision-btn');
      if (b) b.classList.toggle('active', v);
    });
    var fi = $('me-file-input');
    if (fi) {
      fi.addEventListener('change', function () {
        var file = fi.files && fi.files[0];
        if (!file) return;
        if (file.name.indexOf('.shared-scene.json') >= 0) {
          ME.MapExport.importSharedFile(file).catch(function (e) { MapEditor.notify('Import lỗi', e.message, 'error'); });
        } else {
          ME.MapExport.importFile(file).catch(function (e) { MapEditor.notify('Import lỗi', e.message, 'error'); });
        }
        fi.value = '';
      });
    }
    /* view buttons */
    document.querySelectorAll('[data-me-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        ME.Viewport3D.rig.setView(b.dataset.meView);
        document.querySelectorAll('[data-me-view]').forEach(function (x) { x.classList.toggle('active', x === b); });
      });
    });
    /* tool buttons */
    document.querySelectorAll('[data-me-tool]').forEach(function (b) {
      b.addEventListener('click', function () {
        MapEditor.setTool(b.dataset.meTool);
      });
    });
    /* brush controls */
    var bs = $('me-brush-size'), bst = $('me-brush-strength'), bf = $('me-brush-falloff');
    if (bs) bs.addEventListener('input', function () { ME.TerrainBrush.size = parseFloat(bs.value) || 6; });
    if (bst) bst.addEventListener('input', function () { ME.TerrainBrush.strength = parseFloat(bst.value) || 0.5; });
    if (bf) bf.addEventListener('change', function () { ME.TerrainBrush.falloff = bf.value; });
    var pl = $('me-paint-layer');
    if (pl) {
      ME.SceneData.LAYERS.forEach(function (layer, i) {
        var op = document.createElement('option');
        op.value = i; op.textContent = layer.name;
        pl.appendChild(op);
      });
      pl.value = '1';
      pl.addEventListener('change', function () { ME.TerrainBrush.paintLayer = parseInt(pl.value, 10); });
    }
    /* terrain resize */
    on('me-terrain-resize', function () {
      var size = parseFloat(($('me-terrain-size') || {}).value) || 112;
      var seg = parseInt(($('me-terrain-seg') || {}).value, 10) || 64;
      MapEditor.pushUndo('Resize terrain');
      var nd = ME.TerrainEditor.resize(size, seg);
      if (nd && MapEditor.data) {
        MapEditor.data.terrain = nd;
        ME.TerrainEditor.create(nd);
        if (ME.TerrainEditor.mesh.parent) ME.TerrainEditor.mesh.parent.remove(ME.TerrainEditor.mesh);
        ME.Viewport3D.scene.add(ME.TerrainEditor.mesh);
        MapEditor.notify('Terrain', 'Đã đổi terrain ' + size + '×' + size + ', ' + seg + ' segments', 'success');
      }
    });
    /* environment */
    var wsel = $('me-weather');
    if (wsel) {
      Object.keys(ME.Environment.PRESETS).forEach(function (k) {
        var op = document.createElement('option');
        op.value = k; op.textContent = ME.Environment.PRESETS[k].name;
        wsel.appendChild(op);
      });
      wsel.value = 'snow';
      wsel.addEventListener('change', function () {
        MapEditor.pushUndo('Weather');
        ME.Environment.applyPreset(wsel.value);
      });
    }
    var tod = $('me-timeofday');
    if (tod) tod.addEventListener('input', function () {
      ME.Environment.setTimeOfDay(parseFloat(tod.value));
    });
    var fogN = $('me-fog-near'), fogF = $('me-fog-far');
    function fogChange() {
      ME.Environment.setFog(parseFloat(fogN.value) || 60, parseFloat(fogF.value) || 180);
    }
    if (fogN) fogN.addEventListener('input', fogChange);
    if (fogF) fogF.addEventListener('input', fogChange);
    var snowT = $('me-snow-toggle');
    if (snowT) snowT.addEventListener('change', function () {
      ME.Viewport3D.setSnowVisible(snowT.checked);
      if (MapEditor.data && MapEditor.data.environment) MapEditor.data.environment.snow = snowT.checked;
    });
    /* scatter type */
    var sc = $('me-scatter-type');
    if (sc) sc.addEventListener('change', function () { MapEditor._scatterType = sc.value; });
    MapEditor._scatterType = 'pine';
  };

  MapEditor.showOpenDialog = function () {
    var list = ME.MapExport.list();
    var names = list.map(function (p) { return p.name + ' (' + p.savedAt + ')'; });
    var msg = names.length ? 'Project đã lưu:\n' + names.join('\n') + '\n\nNhập tên project để mở:' : 'Chưa có project nào lưu. Nhập tên để tạo mới:';
    var name = window.prompt(msg, list.length ? list[0].name : 'Truong Bach');
    if (!name) return;
    if (ME.MapExport.load(name)) {
      MapEditor.notify('Open', 'Đã mở project "' + name + '"', 'success');
    } else {
      MapEditor.notify('Open', 'Không tìm thấy project "' + name + '"', 'error');
    }
  };

  /* ---------- boot ---------- */
  MapEditor.boot = function () {
    if (MapEditor.booted) return;
    MapEditor.booted = true;
    try {
      var canvas = $('me-viewport');
      var wrap = $('me-viewport-wrap');
      ME.Viewport3D.init(canvas, wrap);
      ME.TerrainBrush.getPreviewRing(ME.Viewport3D.scene);
      ME.Hierarchy.init($('me-hierarchy'), $('me-hierarchy-search'));
      ME.Inspector.init($('me-inspector'));
      ME.AssetManager.init($('me-asset-grid'), $('me-asset-filter'), $('me-asset-search'));
      MapEditor._bindToolbar();
      MapEditor._bindPointer();
      MapEditor._bindKeys();
      /* gizmo drag start → push undo 1 lần */
      if (ME.Viewport3D.gizmo) {
        ME.Viewport3D.gizmo.addEventListener('dragging-changed', function (e) {
          if (e.value) MapEditor.onGizmoDragStart();
        });
      }
      /* load scene: ?scene= → autosave → default */
      var loaded = false;
      try { loaded = ME.MapExport.checkIncomingShared(); } catch (e) { console.warn('[MapEditor] incoming shared lỗi:', e); }
      if (!loaded) {
        var auto = null;
        try { auto = ME.SharedScene.loadAutosave(); } catch (e) { }
        if (auto && auto.objects) {
          MapEditor.loadData(auto);
          MapEditor.notify('Autosave', 'Đã khôi phục autosave.', 'info');
        } else {
          MapEditor.loadData(ME.SceneData.newSceneData('Truong Bach', 'snow'));
        }
      }
      ME.Viewport3D.rig.setView('iso');
      /* autosave 60s */
      setInterval(function () {
        if (MapEditor._dirty && MapEditor.data) {
          ME.SharedScene.saveAutosave(MapEditor.data);
          MapEditor._dirty = false;
        }
      }, 60000);
      /* resize */
      window.addEventListener('resize', function () { ME.Viewport3D.resize(); });
      /* render loop */
      var last = performance.now();
      (function loop(now) {
        if (MapEditor._disposed) return;
        requestAnimationFrame(loop);
        var dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (MapEditor._thandieu && MapEditor._thandieu.mixer) {
          MapEditor._thandieu.mixer.update(dt);
        }
        ME.Viewport3D.render(dt);
      })(last);
      MapEditor.setStatus('Map Editor sẵn sàng — Trường Bạch, ' + MapEditor.data.objects.length + ' objects');
    } catch (err) {
      console.error('[MapEditor] boot lỗi:', err);
      var st = $('me-status');
      if (st) st.textContent = 'Boot lỗi: ' + err.message;
    }
  };

  ME.MapEditor = MapEditor;
})();
