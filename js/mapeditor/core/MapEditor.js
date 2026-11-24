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
    _selectedIds: [],     /* multi-select: danh sách id đang chọn */
    tool: 'select',       /* select | move | rotate | scale | raise | lower | smooth | flatten | noise | mountain | paint | scatter | patrol */
    _undo: [],
    _redo: [],
    _undoLock: false,
    _orbitEnabled: true,
    _placementType: null,
    _placementOpts: {},
    _ghost: null,
    _addWaypointFor: null,
    _dragging: null,      /* {button, x, y, moved, mode} */
    _thandieu: null,      /* {mixer, clips, objectId} */
    _dirty: false,
    _typeCount: {},
    _emitTimer: null,     /* debounce auto-update */
    _emitPending: null,
    _clipboard: null,     /* copy/paste object */
    snapGrid: 0,          /* 0 = tắt, 0.5/1/2 m */
    snapAngle: 0,         /* 0 = tắt, 15/45 độ */
    _measuring: false,
    _measurePoints: [],
    _measureLine: null,
    _marquee: null,       /* {x0,y0,div} khung kéo chọn */
    _layerHidden: {},     /* layer -> true nếu đang ẩn */
    booted: false
  };

  /* ---------- section thu gọn 2 panel (fix Inspector bị khuất) ----------
   * Bọc từng cặp .panel-head + .panel-body trong #me-left/#me-right thành
   * .me-section có thể thu/mở. Inspector + Hierarchy luôn có min-height
   * (CSS .me-section-inspector 220px / .me-section-hierarchy 160px) nên
   * không bao giờ co về 0. Trạng thái lưu localStorage `mapeditor.panels`.
   * Lần mở đầu tiên: chỉ Inspector + Hierarchy mở, còn lại thu gọn. */
  MapEditor._panelStateKey = 'mapeditor.panels';
  MapEditor._panelState = null;
  MapEditor._loadPanelState = function () {
    if (MapEditor._panelState) return MapEditor._panelState;
    var st = {};
    try { st = JSON.parse(window.localStorage.getItem(MapEditor._panelStateKey) || '{}') || {}; } catch (e) { st = {}; }
    MapEditor._panelState = st;
    return st;
  };
  MapEditor._savePanelState = function () {
    try { window.localStorage.setItem(MapEditor._panelStateKey, JSON.stringify(MapEditor._panelState || {})); } catch (e) { }
  };
  MapEditor._sectionKeyFor = function (headText) {
    var t = (headText || '').toLowerCase();
    if (t.indexOf('inspector') >= 0) return 'inspector';
    if (t.indexOf('hierarchy') >= 0) return 'hierarchy';
    if (t.indexOf('environment') >= 0) return 'environment';
    if (t.indexOf('terrain thêm') >= 0) return 'terrain-extra';
    if (t.indexOf('terrain') >= 0) return 'terrain';
    if (t.indexOf('velo project') >= 0) return 'velo-project';
    if (t.indexOf('velo') >= 0) return 'velo';
    if (t.indexOf('snap') >= 0) return 'snap';
    if (t.indexOf('bookmark') >= 0) return 'bookmarks';
    if (t.indexOf('layer') >= 0) return 'layers';
    if (t.indexOf('đo') >= 0 || t.indexOf('thống kê') >= 0) return 'measure';
    if (t.indexOf('bầu trời') >= 0) return 'sky';
    if (t.indexOf('play') >= 0) return 'play';
    if (t.indexOf('chỉnh sửa') >= 0) return 'edit';
    return 'sec_' + t.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);
  };
  /* Bọc 1 cặp head+body đã có sẵn trong DOM thành section thu gọn. */
  MapEditor.wrapPanelSection = function (headEl, bodyEl, key, defaultOpen) {
    if (!headEl || !bodyEl || headEl.parentNode !== bodyEl.parentNode) return null;
    if (headEl.parentNode.classList.contains('me-section')) return headEl.parentNode;
    var parent = headEl.parentNode;
    var sec = document.createElement('div');
    sec.className = 'me-section';
    if (key === 'inspector') sec.classList.add('me-section-inspector');
    if (key === 'hierarchy') sec.classList.add('me-section-hierarchy');
    sec.setAttribute('data-section', key);
    parent.insertBefore(sec, headEl);
    sec.appendChild(headEl);
    sec.appendChild(bodyEl);
    var arrow = document.createElement('span');
    arrow.className = 'me-collapse-arrow';
    arrow.textContent = '▾';
    headEl.appendChild(arrow);
    var st = MapEditor._loadPanelState();
    var open = (key in st) ? !!st[key] : !!defaultOpen;
    sec.classList.toggle('collapsed', !open);
    headEl.addEventListener('click', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
      var nowCollapsed = sec.classList.toggle('collapsed');
      MapEditor._loadPanelState()[key] = !nowCollapsed;
      MapEditor._savePanelState();
    });
    /* section thường: giới hạn chiều cao để không bóp Inspector */
    if (key !== 'inspector' && key !== 'hierarchy' && !bodyEl.style.maxHeight) {
      bodyEl.style.maxHeight = '320px';
    }
    return sec;
  };
  MapEditor._initCollapsiblePanels = function () {
    ['me-left', 'me-right'].forEach(function (pid) {
      var panel = $(pid);
      if (!panel) return;
      /* snapshot cặp head+body (bỏ qua node đã bọc) */
      var pairs = [];
      var kids = Array.prototype.slice.call(panel.children);
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].classList && kids[i].classList.contains('panel-head') &&
            kids[i + 1] && kids[i + 1].classList && kids[i + 1].classList.contains('panel-body')) {
          pairs.push([kids[i], kids[i + 1]]);
          i++;
        }
      }
      pairs.forEach(function (p) {
        var key = MapEditor._sectionKeyFor(p[0].textContent);
        var defaultOpen = (key === 'inspector' || key === 'hierarchy');
        MapEditor.wrapPanelSection(p[0], p[1], key, defaultOpen);
      });
    });
  };
  MapEditor.toggleSection = function (key, open) {
    var sec = document.querySelector('.me-section[data-section="' + key + '"]');
    if (!sec) return false;
    var wantOpen = open === undefined ? sec.classList.contains('collapsed') : !!open;
    sec.classList.toggle('collapsed', !wantOpen);
    MapEditor._loadPanelState()[key] = wantOpen;
    MapEditor._savePanelState();
    return wantOpen;
  };

  /* ---------- drawer điện thoại (<700px) ---------- */
  MapEditor.toggleDrawer = function (side) {
    var cls = side === 'left' ? 'me-left-open' : 'me-right-open';
    var other = side === 'left' ? 'me-right-open' : 'me-left-open';
    document.body.classList.remove(other);
    document.body.classList.toggle(cls);
    /* mở drawer phải thì chắc chắn Inspector đang mở */
    if (side === 'right' && document.body.classList.contains(cls)) {
      MapEditor.toggleSection('inspector', true);
    }
    return document.body.classList.contains(cls);
  };
  MapEditor.closeDrawers = function () {
    document.body.classList.remove('me-left-open', 'me-right-open');
  };

  /* ---------- trạng thái nối Studio ---------- */
  MapEditor._updateLinkStatus = function (receivedName) {
    var el = $('me-link-status');
    if (!el) return;
    var fromStudio = false;
    try { fromStudio = /[?&]from=studio/.test(window.location.search); } catch (e) { }
    if (receivedName) {
      el.textContent = '✓ Đã nhận scene từ Studio: ' + receivedName;
      el.classList.remove('warn');
    } else if (fromStudio) {
      el.textContent = '✓ Đã nối Studio';
      el.classList.remove('warn');
    } else {
      el.textContent = '';
    }
  };

  /* ---------- auto-update trung tâm (debounce ~80ms) ---------- */
  /* Mọi mutation đi qua emitChange; emitChange refresh Hierarchy +
   * Inspector + AssetManager + HUD minimap + panel thống kê cùng lúc.
   * kind 'live' (kéo slider / sửa số đang gõ) thì không render lại
   * Inspector để khỏi mất focus. */
  MapEditor.emitChange = function (kind, detail) {
    MapEditor._emitPending = { kind: kind || 'change', detail: detail || null };
    if (MapEditor._emitTimer) return;
    MapEditor._emitTimer = setTimeout(function () {
      MapEditor._emitTimer = null;
      MapEditor._emitNow();
    }, 80);
  };
  MapEditor.emitChangeNow = function (kind, detail) {
    if (MapEditor._emitTimer) { clearTimeout(MapEditor._emitTimer); MapEditor._emitTimer = null; }
    MapEditor._emitPending = { kind: kind || 'change', detail: detail || null };
    MapEditor._emitNow();
  };
  MapEditor._emitNow = function () {
    var p = MapEditor._emitPending;
    MapEditor._emitPending = null;
    var kind = p ? p.kind : 'change';
    if (ME.Hierarchy) ME.Hierarchy.render();
    if (kind !== 'live' && ME.Inspector) ME.Inspector.render();
    if (ME.AssetManager) ME.AssetManager.render();
    if (ME.Viewport3D && ME.Viewport3D.scene) {
      var st = ME.Viewport3D.computeStats();
      ME.Viewport3D.drawHud(st);
    }
    if (MapEditor.refreshStatsPanel) MapEditor.refreshStatsPanel();
    MapEditor._dirty = true;
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
    MapEditor.emitChange('undo');
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
    MapEditor.emitChange('redo');
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
    MapEditor._selectedIds = [];
    if (ME.TerrainEditor.mesh && ME.TerrainEditor.mesh.parent) {
      ME.TerrainEditor.mesh.parent.remove(ME.TerrainEditor.mesh);
    }
    ME.TerrainEditor.dispose();
    MapEditor.data = data;
    /* terrain */
    var terrain = ME.TerrainEditor.create(data.terrain);
    ME.Viewport3D.scene.add(terrain);
    /* mực nước (nếu scene có lưu) */
    if (data.terrain && data.terrain.waterLevel !== null && data.terrain.waterLevel !== undefined) {
      ME.TerrainEditor.setWaterLevel(data.terrain.waterLevel);
    } else {
      ME.TerrainEditor.hideWater();
    }
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
    MapEditor.emitChangeNow('load');
    MapEditor.refreshUndoButtons();
    MapEditor.setStatus('Scene "' + data.name + '" — ' + data.objects.length + ' objects');
    return true;
  };

  MapEditor._addObjectMesh = function (dataObj) {
    /* model import (GLB/FBX/OBJ đã load): clone từ cache của AssetManager.
     * url là id asset đầy đủ, dạng 'import:<tên file>_<hash>'. */
    if (dataObj.url && dataObj.url.indexOf('import:') === 0 && ME.AssetManager) {
      var cached = ME.AssetManager.getLoadedModel(dataObj.url);
      if (cached) {
        var g2 = cached.clone();
        g2.name = dataObj.name || dataObj.type;
        g2.position.fromArray(dataObj.position || [0, 0, 0]);
        g2.rotation.fromArray(dataObj.rotation || [0, 0, 0]);
        g2.scale.fromArray(dataObj.scale || [1, 1, 1]);
        g2.visible = dataObj.visible !== false;
        g2.userData.mapId = dataObj.id;
        g2.userData.mapType = dataObj.type;
        g2.userData.mapName = dataObj.name;
        g2.userData.collider = dataObj.collider || null;
        g2.userData.mapData = dataObj;
        ME.Viewport3D.root.add(g2);
        MapEditor.objects[dataObj.id] = g2;
        return g2;
      }
      /* chưa load được (mở lại project sau khi reload trang) → placeholder */
    }
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

  /* ---------- selection (đơn + multi-select) ---------- */
  MapEditor.selectedId = function () { return MapEditor._selectedId; };
  MapEditor.selectedIds = function () { return MapEditor._selectedIds.slice(); };
  MapEditor.select = function (id, opts) {
    opts = opts || {};
    if (opts.additive && id) {
      if (MapEditor._selectedIds.indexOf(id) < 0) MapEditor._selectedIds.push(id);
    } else if (opts.toggle && id) {
      MapEditor.toggleSelect(id);
      return;
    } else {
      MapEditor._selectedIds = id ? [id] : [];
    }
    MapEditor._selectedId = MapEditor._selectedIds.length ? MapEditor._selectedIds[0] : null;
    var obj = MapEditor._selectedId ? MapEditor.objects[MapEditor._selectedId] : null;
    if (ME.Viewport3D) {
      ME.Viewport3D.attachGizmo(obj, MapEditor.tool === 'move' ? 'translate' : (MapEditor.tool === 'rotate' ? 'rotate' : (MapEditor.tool === 'scale' ? 'scale' : null)));
    }
    /* select cập nhật ngay (không qua debounce) */
    if (ME.Hierarchy) ME.Hierarchy.render();
    if (ME.Inspector) ME.Inspector.render();
  };
  MapEditor.toggleSelect = function (id) {
    if (!id) return;
    var i = MapEditor._selectedIds.indexOf(id);
    if (i >= 0) MapEditor._selectedIds.splice(i, 1);
    else MapEditor._selectedIds.push(id);
    MapEditor._selectedId = MapEditor._selectedIds.length ? MapEditor._selectedIds[0] : null;
    if (ME.Hierarchy) ME.Hierarchy.render();
    if (ME.Inspector) ME.Inspector.render();
  };
  MapEditor.selectMany = function (ids) {
    MapEditor._selectedIds = (ids || []).filter(function (id) { return !!MapEditor.objects[id]; });
    MapEditor._selectedId = MapEditor._selectedIds.length ? MapEditor._selectedIds[0] : null;
    if (ME.Hierarchy) ME.Hierarchy.render();
    if (ME.Inspector) ME.Inspector.render();
  };
  /* chọn mọi object nằm trong hình chữ nhật màn hình (px, toạ độ canvas).
   * viewW/viewH: kích thước viewport (mặc định lấy từ canvas) — test truyền tay. */
  MapEditor.selectInRect = function (x0, y0, x1, y1, viewW, viewH) {
    if (!ME.Viewport3D || !ME.Viewport3D.camera || !MapEditor.data) return [];
    var minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    var minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    var canvas = ME.Viewport3D.canvas;
    var rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: 800, height: 600 };
    var W = Math.max(1, viewW || rect.width || 800), H = Math.max(1, viewH || rect.height || 600);
    ME.Viewport3D.camera.updateMatrixWorld();
    var ids = [];
    MapEditor.data.objects.forEach(function (d) {
      var o3 = MapEditor.objects[d.id];
      if (!o3) return;
      var v = new THREE.Vector3(o3.position.x, o3.position.y + 1, o3.position.z).project(ME.Viewport3D.camera);
      if (v.z > 1) return; /* sau camera */
      var sx = (v.x * 0.5 + 0.5) * W;
      var sy = (-v.y * 0.5 + 0.5) * H;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) ids.push(d.id);
    });
    MapEditor.selectMany(ids);
    return ids;
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
      collider: (type === 'temple' || type === 'house' || type === 'gate' || type === 'tower' || type === 'torii' ||
        type === 'pagoda' || type === 'torii_big' || type === 'house_tile' || type === 'house_thatch' ||
        type === 'house_flat' || type === 'stall') ? { shape: 'box', size: type === 'tower' ? [6, 8, 6] : (type === 'torii' || type === 'torii_big' ? [8, 7, 1] : (type === 'pagoda' ? [9, 10, 9] : [6, 4, 5])) } : null,
      light: (type === 'lantern' || type === 'campfire' || type === 'portal' || type === 'stone_stove' ||
        type === 'lantern_red' || type === 'lantern_yellow' || type === 'lantern_blue') ? { color: type === 'portal' ? 0x9d4edd : 0xff8a2a, intensity: 0.8, distance: 12 } : null,
      path: type === 'patrol' ? [[x - 6, z - 6], [x + 6, z - 6], [x + 6, z + 6], [x - 6, z + 6]] : null,
      anim: (type === 'hero' || type === 'monster' || type === 'boss' || type === 'villager_blue' ||
        type === 'villager_red' || type === 'villager_yellow' || type === 'wolf' || type === 'bat' || type === 'bird') ? 'Idle' : null,
      url: opts.url || null, veloId: opts.veloId || null,
      placeholder: false, locked: false, visible: true
    };
    if (opts.randomScale) {
      var s = 0.8 + Math.random() * 0.5;
      dataObj.scale = [s, s, s];
    }
    if (opts.scale) dataObj.scale = [opts.scale, opts.scale, opts.scale];
    MapEditor.data.objects.push(dataObj);
    var g = MapEditor._addObjectMesh(dataObj);
    MapEditor.select(dataObj.id);
    MapEditor.emitChange('place', { id: dataObj.id, type: type });
    return g;
  };

  /* đặt nhiều object 1 lần: 1 undo + 1 emit (dùng cho "Lấp đầy map").
   * items: [{type, x, z, ry, s, y?}] — ry/s đã tính sẵn từ seed nên deterministic,
   * không dùng Math.random ở đây. Trả {added, byType}. */
  MapEditor.placeObjectsBulk = function (items, label) {
    if (!MapEditor.data || !items || !items.length) return { added: 0, byType: {} };
    MapEditor.pushUndo(label || 'Place nhiều object');
    var byType = {}, added = 0;
    items.forEach(function (it) {
      var y = it.y !== undefined ? it.y : ME.TerrainEditor.heightAt(it.x, it.z);
      var dataObj = {
        id: ME.SceneData.newId('obj'), type: it.type,
        name: it.name || MapEditor._nextName(it.type),
        group: ME.SceneData.TYPE_GROUP[it.type] || 'Props',
        position: [it.x, y, it.z],
        rotation: [0, it.ry || 0, 0],
        scale: [it.s || 1, it.s || 1, it.s || 1],
        color: null, material: null,
        collider: (it.type === 'pagoda' || it.type === 'house_tile' || it.type === 'house_thatch' ||
          it.type === 'house_flat' || it.type === 'stall') ? { shape: 'box', size: it.type === 'pagoda' ? [9, 10, 9] : [6, 4, 5] } : null,
        light: (it.type === 'lantern_red' || it.type === 'lantern_yellow' || it.type === 'lantern_blue' ||
          it.type === 'stone_stove') ? { color: 0xff8a2a, intensity: 0.8, distance: 12 } : null,
        path: null,
        anim: (it.type === 'villager_blue' || it.type === 'villager_red' || it.type === 'villager_yellow' ||
          it.type === 'wolf' || it.type === 'bat' || it.type === 'bird') ? 'Idle' : null,
        url: null, veloId: null, placeholder: false, locked: false, visible: true
      };
      MapEditor.data.objects.push(dataObj);
      MapEditor._addObjectMesh(dataObj);
      byType[it.type] = (byType[it.type] || 0) + 1;
      added++;
    });
    MapEditor.emitChange('fill', { added: added, byType: byType });
    return { added: added, byType: byType };
  };

  /* "🌲 Lấp đầy map": rải 1 preset có seed lên map hiện tại, báo số object trước/sau. */
  MapEditor.fillMap = function (preset, seed) {
    if (!MapEditor.data || !ME.TerrainBrush || !ME.TerrainBrush.fillPreset) return null;
    var before = MapEditor.data.objects.length;
    var res = ME.TerrainBrush.fillPreset(preset || 'full', seed);
    if (res.error) { MapEditor.notify('Lấp đầy map', res.error, 'error'); return res; }
    var after = MapEditor.data.objects.length;
    res.before = before; res.after = after;
    var st = ME.Viewport3D ? ME.Viewport3D.computeStats() : null;
    var statTxt = st ? ' · Draw ~' + st.calls + ' · Tris ~' + st.tris.toLocaleString() : '';
    MapEditor.notify('🌲 Lấp đầy map',
      'Preset "' + res.preset + '" (seed ' + res.seed + '): +' + res.added + ' object — ' +
      before + ' → ' + after + ' object' + statTxt, 'success');
    return res;
  };

  /* UI nút "🌲 Lấp đầy map" — thêm bằng JS vào toolbar (không sửa MapEditor.html) */
  MapEditor._buildFillMapUI = function () {
    var bar = document.getElementById('me-toolbar');
    if (!bar || document.getElementById('me-fill-btn')) return;
    var grp = document.createElement('div');
    grp.className = 'tool-group';
    grp.id = 'me-fill-group';
    var label = document.createElement('span');
    label.className = 'tool-label';
    label.textContent = 'Lấp đầy:';
    grp.appendChild(label);
    var sel = document.createElement('select');
    sel.id = 'me-fill-preset';
    sel.title = 'Preset lấp đầy map (Rừng + Làng = đầy đủ nhất)';
    [['full', '🌲 Rừng + Làng'], ['forest', '🌲 Rừng'], ['village', '🏠 Làng'],
     ['market', '🏪 Chợ'], ['battlefield', '⚔️ Chiến trường']].forEach(function (p) {
      var op = document.createElement('option');
      op.value = p[0]; op.textContent = p[1];
      sel.appendChild(op);
    });
    grp.appendChild(sel);
    var seedInp = document.createElement('input');
    seedInp.id = 'me-fill-seed';
    seedInp.type = 'number';
    seedInp.value = '20261124';
    seedInp.title = 'Seed — cùng seed + cùng map → cùng kết quả';
    seedInp.style.width = '90px';
    grp.appendChild(seedInp);
    var btn = document.createElement('button');
    btn.id = 'me-fill-btn';
    btn.className = 'tool-btn';
    btn.textContent = '🌲 Lấp đầy map';
    btn.title = 'Rải preset đã chọn (có seed) lên map hiện tại — 1 click';
    btn.addEventListener('click', function () {
      var preset = sel.value || 'full';
      var seed = parseInt(seedInp.value, 10) || 20261124;
      MapEditor.fillMap(preset, seed);
    });
    grp.appendChild(btn);
    bar.appendChild(grp);
  };

  /* đặt 1 model đã import (GLB/FBX/OBJ) — click thẻ Import hoặc kéo-thả */
  MapEditor.placeImportedModel = function (assetId, x, z) {
    if (!ME.AssetManager) return null;
    var asset = ME.AssetManager.getAsset(assetId);
    if (!asset || !ME.AssetManager.getLoadedModel(assetId)) {
      MapEditor.notify('Đặt model', 'Model chưa load xong — import lại file.', 'warning');
      return null;
    }
    if (x === undefined || z === undefined) {
      /* chưa có vị trí: đặt ở giữa map, vào chế độ placement để click chọn chỗ */
      MapEditor.startPlacement('model', { url: assetId, name: asset.name });
      MapEditor.setStatus('Đặt ' + asset.name + ' — click lên terrain để đặt, Esc để huỷ');
      return null;
    }
    return MapEditor.placeObject('model', x, z, { url: assetId, name: asset.name });
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
    MapEditor._selectedIds = MapEditor._selectedIds.filter(function (s) { return s !== id; });
    if (MapEditor._selectedId === id) MapEditor._selectedId = MapEditor._selectedIds.length ? MapEditor._selectedIds[0] : null;
    MapEditor.select(MapEditor._selectedId);
    MapEditor.emitChange('delete', { id: id });
    return true;
  };
  MapEditor.deleteSelected = function () {
    var ids = MapEditor.selectedIds();
    if (!ids.length && MapEditor._selectedId) ids = [MapEditor._selectedId];
    var ok = false;
    ids.slice().forEach(function (id) { if (MapEditor.deleteObject(id)) ok = true; });
    return ok;
  };

  MapEditor.duplicateSelected = function () {
    var ids = MapEditor.selectedIds();
    if (!ids.length) return null;
    MapEditor.pushUndo('Duplicate ' + ids.length + ' object');
    var copies = [];
    ids.forEach(function (id, k) {
      var d = MapEditor.getObjectData(id);
      if (!d) return;
      var copy = JSON.parse(JSON.stringify(d));
      copy.id = ME.SceneData.newId('obj');
      copy.name = d.name + '_copy';
      copy.position = [d.position[0] + 2 + k * 2, d.position[1], d.position[2] + 2];
      MapEditor.data.objects.push(copy);
      MapEditor._addObjectMesh(copy);
      copies.push(copy);
    });
    if (copies.length) MapEditor.selectMany(copies.map(function (c) { return c.id; }));
    MapEditor.emitChange('duplicate', { count: copies.length });
    return copies.length === 1 ? copies[0] : copies;
  };

  /* ---------- copy / paste (Ctrl+C / Ctrl+V) ---------- */
  MapEditor.copySelected = function () {
    var ids = MapEditor.selectedIds();
    if (!ids.length) return false;
    MapEditor._clipboard = ids.map(function (id) {
      return JSON.parse(JSON.stringify(MapEditor.getObjectData(id)));
    }).filter(function (d) { return !!d; });
    MapEditor.setStatus('Đã copy ' + MapEditor._clipboard.length + ' object — Ctrl+V để paste');
    return MapEditor._clipboard.length > 0;
  };
  MapEditor.pasteClipboard = function () {
    if (!MapEditor._clipboard || !MapEditor._clipboard.length || !MapEditor.data) return null;
    MapEditor.pushUndo('Paste ' + MapEditor._clipboard.length + ' object');
    var copies = [];
    MapEditor._clipboard.forEach(function (d, k) {
      var copy = JSON.parse(JSON.stringify(d));
      copy.id = ME.SceneData.newId('obj');
      copy.name = d.name + '_paste';
      copy.position = [d.position[0] + 2 + k * 2, d.position[1], d.position[2] + 2];
      MapEditor.data.objects.push(copy);
      MapEditor._addObjectMesh(copy);
      copies.push(copy);
    });
    MapEditor.selectMany(copies.map(function (c) { return c.id; }));
    MapEditor.emitChange('paste', { count: copies.length });
    return copies;
  };

  /* ---------- align / distribute (multi-select) ---------- */
  MapEditor.alignSelected = function (mode) {
    /* mode: 'x-min' | 'x-center' | 'x-max' | 'z-min' | 'z-center' | 'z-max' */
    var ids = MapEditor.selectedIds();
    if (ids.length < 2) { MapEditor.notify('Align', 'Chọn ít nhất 2 object.', 'warning'); return false; }
    var axis = mode.charAt(0) === 'x' ? 0 : 2;
    var part = mode.split('-')[1];
    var vals = ids.map(function (id) { return MapEditor.getObjectData(id).position[axis]; });
    var target = part === 'min' ? Math.min.apply(null, vals)
      : part === 'max' ? Math.max.apply(null, vals)
      : vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    MapEditor.pushUndo('Align ' + mode);
    ids.forEach(function (id) {
      var d = MapEditor.getObjectData(id);
      var o3 = MapEditor.objects[id];
      if (!d || !o3) return;
      d.position[axis] = target;
      o3.position.fromArray(d.position);
    });
    MapEditor.emitChange('align', { mode: mode });
    return true;
  };
  MapEditor.distributeSelected = function (axis) {
    /* đều khoảng cách dọc trục x hoặc z (sắp theo vị trí hiện tại) */
    var ids = MapEditor.selectedIds();
    if (ids.length < 3) { MapEditor.notify('Distribute', 'Chọn ít nhất 3 object.', 'warning'); return false; }
    var ax = axis === 'z' ? 2 : 0;
    var sorted = ids.map(function (id) { return MapEditor.getObjectData(id); })
      .filter(function (d) { return !!d; })
      .sort(function (a, b) { return a.position[ax] - b.position[ax]; });
    var lo = sorted[0].position[ax], hi = sorted[sorted.length - 1].position[ax];
    var step = (hi - lo) / (sorted.length - 1);
    MapEditor.pushUndo('Distribute ' + axis);
    sorted.forEach(function (d, i) {
      d.position[ax] = lo + step * i;
      var o3 = MapEditor.objects[d.id];
      if (o3) o3.position.fromArray(d.position);
    });
    MapEditor.emitChange('distribute', { axis: axis });
    return true;
  };

  /* ---------- gom nhóm (group) ---------- */
  MapEditor.groupSelected = function (name) {
    var ids = MapEditor.selectedIds();
    if (!ids.length) { MapEditor.notify('Gom nhóm', 'Chọn ít nhất 1 object.', 'warning'); return false; }
    name = (name || '').trim();
    if (!name) return false;
    if (ME.SceneData.GROUPS.indexOf(name) < 0) ME.SceneData.GROUPS.push(name);
    MapEditor.pushUndo('Group ' + ids.length + ' object -> ' + name);
    ids.forEach(function (id) {
      var d = MapEditor.getObjectData(id);
      if (d) d.group = name;
    });
    MapEditor.emitChange('group', { name: name, count: ids.length });
    return true;
  };

  /* ---------- layers (ẩn/hiện từng layer) ---------- */
  MapEditor.LAYER_GROUPS = {
    Environment: ['Environment'],
    Buildings: ['Buildings'],
    Props: ['Props'],
    Characters: ['Characters'],
    Effects: ['Lighting', 'Particles']
  };
  MapEditor.setLayerVisible = function (layer, visible) {
    var groups = MapEditor.LAYER_GROUPS[layer];
    if (!groups || !MapEditor.data) return false;
    MapEditor._layerHidden[layer] = !visible;
    MapEditor.data.objects.forEach(function (d) {
      if (groups.indexOf(d.group) < 0) return;
      d.visible = visible;
      var o3 = MapEditor.objects[d.id];
      if (o3) o3.visible = visible;
    });
    MapEditor.emitChange('layer', { layer: layer, visible: visible });
    return true;
  };
  MapEditor.isLayerVisible = function (layer) {
    return !MapEditor._layerHidden[layer];
  };

  /* ---------- duplicate dọc path ---------- */
  MapEditor.duplicateAlongPath = function () {
    var ids = MapEditor.selectedIds();
    if (!ids.length) { MapEditor.notify('Duplicate dọc path', 'Chọn 1 object để nhân dọc path.', 'warning'); return null; }
    var srcId = ids[0];
    var src = MapEditor.getObjectData(srcId);
    if (!src) return null;
    /* path: từ object patrol đang chọn, hoặc patrol gần object nhất */
    var pathObj = null;
    if (src.type === 'patrol' && src.path && src.path.length) {
      pathObj = src;
      srcId = null;
    } else {
      var near = MapEditor.findPatrolNear ? MapEditor.findPatrolNear(new THREE.Vector3(src.position[0], 0, src.position[2])) : null;
      if (near) pathObj = near;
    }
    if (!pathObj || !pathObj.path || !pathObj.path.length) {
      MapEditor.notify('Duplicate dọc path', 'Không tìm thấy patrol path gần object đang chọn.', 'warning');
      return null;
    }
    if (!srcId) {
      /* đang chọn chính patrol → nhân bản object đầu tiên trong scene? không: cần 1 object nguồn */
      MapEditor.notify('Duplicate dọc path', 'Chọn 1 object (không phải patrol) rồi bấm lại — sẽ nhân nó dọc path gần nhất.', 'warning');
      return null;
    }
    MapEditor.pushUndo('Duplicate along path');
    var copies = [];
    pathObj.path.forEach(function (p) {
      var copy = JSON.parse(JSON.stringify(src));
      copy.id = ME.SceneData.newId('obj');
      copy.name = src.name + '_path';
      copy.position = [p[0], ME.TerrainEditor.heightAt(p[0], p[1]), p[1]];
      MapEditor.data.objects.push(copy);
      MapEditor._addObjectMesh(copy);
      copies.push(copy);
    });
    MapEditor.selectMany(copies.map(function (c) { return c.id; }));
    MapEditor.emitChange('duplicate-path', { count: copies.length });
    return copies;
  };

  MapEditor.rename = function (id, name) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    MapEditor.pushUndo('Rename');
    d.name = name;
    var o3 = MapEditor.objects[id];
    if (o3) o3.name = name;
    MapEditor.emitChange('rename', { id: id });
  };

  MapEditor.setGroup = function (id, group) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    MapEditor.pushUndo('Move to group');
    d.group = group;
    MapEditor.emitChange('group', { id: id, group: group });
  };

  MapEditor.toggleVisible = function (id) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    d.visible = d.visible === false ? true : false;
    var o3 = MapEditor.objects[id];
    if (o3) o3.visible = d.visible;
    MapEditor.emitChange('visibility', { id: id });
  };

  MapEditor.toggleLock = function (id) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    d.locked = !d.locked;
    MapEditor.emitChange('lock', { id: id });
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
    MapEditor.emitChange('live', { id: id });
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
    MapEditor.emitChange('transform', { id: id });
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
    MapEditor.emitChange('transform', { id: id });
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
    MapEditor.emitChange('material', { id: id });
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
    MapEditor.emitChange('live', { id: id });
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
    MapEditor.emitChange('live', { id: id });
  };
  MapEditor.setCollider = function (id, collider) {
    var d = MapEditor.getObjectData(id);
    if (!d) return;
    MapEditor.pushUndo('Set collider');
    d.collider = collider;
    var o3 = MapEditor.objects[id];
    if (o3) o3.userData.collider = collider;
    if (ME.Viewport3D) ME.Viewport3D.refreshColliders(ME.Viewport3D.colliderHelpers.visible);
    MapEditor.emitChange('collider', { id: id });
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
    MapEditor.emitChange('path', { id: id });
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
    MapEditor.emitChange('live', { id: id });
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
  /* _loadThandieuFBX(heroId, source, opts): source là URL string HOẶC
   * ArrayBuffer/Uint8Array đã fetch (FBXLoader.parse). BUG CŨ ĐÃ SỬA:
   * trước đây chỉ gom clip từ 2 file anim phụ, bỏ qua clip của chính
   * file base — file than_dieu_run.fbx chứa sẵn clip "mixamo.com"
   * (Fast Run 0.533s) nên giờ gom cả fbx.animations của base.
   * opts.tint {color:[r,g,b], emissive:[r,g,b]} (0–255) — tô màu runner
   * Gold/Shadow như main.scene. Mỗi object FBX có entry riêng trong
   * _thandieuById {mixer, clips, runClip, idleClip, idleFrame, fbx};
   * _thandieu giữ entry của hero để tương thích code cũ. */
  MapEditor._thandieuById = {};
  MapEditor._loadThandieuFBX = function (heroId, source, opts) {
    opts = opts || {};
    var hero = MapEditor.objects[heroId];
    if (!hero) return Promise.resolve(false);
    var loader = new THREE.FBXLoader();
    function loadOne(url) {
      return new Promise(function (resolve, reject) {
        loader.load(url, resolve, undefined, function (e) { reject(e || new Error('load fail ' + url)); });
      });
    }
    function parseBuffer(ab) {
      return new Promise(function (resolve, reject) {
        try { resolve(loader.parse(ab, '')); }
        catch (e) { reject(e); }
      });
    }
    var baseP;
    if (typeof source === 'string') {
      baseP = loadOne(source);
    } else if (source && typeof source.byteLength === 'number') {
      /* ArrayBuffer/Uint8Array — nhận cả buffer khác realm (test Node vs jsdom) */
      var ab = null;
      if (source instanceof ArrayBuffer) ab = source;
      else if (source.buffer && source.buffer !== source && typeof source.buffer.slice === 'function') {
        ab = source.buffer.slice(source.byteOffset || 0, (source.byteOffset || 0) + source.byteLength);
      } else ab = source;
      baseP = parseBuffer(ab);
    } else {
      return Promise.resolve(false);
    }
    return baseP.then(function (fbx) {
      /* gom clip: base trước (clip "mixamo.com" Fast Run 0.533s),
       * rồi 2 file anim phụ (mỗi file cũng có clip "mixamo.com" riêng
       * nên lưu theo tên file để khỏi đè nhau). */
      var clipList = [];
      (fbx.animations || []).forEach(function (c) {
        clipList.push({ name: c.name, clip: c, source: 'base' });
      });
      var animFiles = ['models/thandieu/Neutral_Idle.fbx', 'models/thandieu/Than_dieu_Fast_Run.fbx'];
      var jobs = animFiles.filter(function (u) { return u !== source; }).map(function (u) {
        return loadOne(u).then(function (o) {
          (o.animations || []).forEach(function (c) {
            clipList.push({ name: c.name + ' (' + u.split('/').pop() + ')', clip: c, source: u });
          });
        }).catch(function () { /* animation thiếu thì bỏ qua */ });
      });
      return Promise.all(jobs).then(function () {
        /* thay hero chibi bằng FBX (giữ transform) */
        var parent = hero.parent;
        if (parent) parent.remove(hero);
        fbx.scale.setScalar(1.3);
        fbx.position.copy(hero.position);
        fbx.rotation.copy(hero.rotation);
        fbx.userData.mapId = heroId;
        fbx.userData.mapType = hero.userData.mapType || 'hero';
        fbx.userData.mapName = hero.name;
        fbx.userData.mapData = hero.userData.mapData;
        /* tô màu runner (Gold/Shadow) */
        if (opts.tint) {
          var col = opts.tint.color, em = opts.tint.emissive;
          fbx.traverse(function (o) {
            if (o.isMesh && o.material) {
              o.material = o.material.clone();
              if (col && o.material.color) o.material.color.setRGB(col[0] / 255, col[1] / 255, col[2] / 255);
              if (em && o.material.emissive) o.material.emissive.setRGB(em[0] / 255, em[1] / 255, em[2] / 255);
            }
          });
        }
        fbx.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        if (parent) parent.add(fbx);
        MapEditor.objects[heroId] = fbx;
        var mixer = new THREE.AnimationMixer(fbx);
        var runClip = (clipList[0] && clipList[0].clip) || null;
        var idleEntry = null;
        clipList.forEach(function (e) {
          if (!idleEntry && /Neutral_Idle/i.test(e.source || '')) idleEntry = e;
        });
        var entry = {
          mixer: mixer, clips: clipList, objectId: heroId, fbx: fbx,
          runClip: runClip, idleClip: (idleEntry && idleEntry.clip) || runClip,
          idleFrame: null, current: null, mode: null
        };
        MapEditor._thandieuById[heroId] = entry;
        if (fbx.userData.mapType === 'hero' || !MapEditor._thandieu) MapEditor._thandieu = entry;
        if (runClip) MapEditor._thandieuPlayFor(heroId, runClip.name);
        MapEditor.notify('Thần Điêu', 'Đã load Thần Điêu FBX (' + clipList.length + ' clip animation' +
          (opts.tint ? ', màu ' + (hero.name || heroId) : '') + ').', 'success');
        MapEditor.emitChange('import-model', { id: heroId });
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
    var e = t.clips[clipIdx % t.clips.length];
    MapEditor._thandieuPlayFor(t.objectId, e.name);
  };
  /* phát clip theo tên (hoặc index số) cho 1 object FBX */
  MapEditor._thandieuPlayFor = function (objectId, nameOrIdx) {
    var t = MapEditor._thandieuById[objectId];
    if (!t || !t.clips.length) return false;
    var entry = null;
    if (typeof nameOrIdx === 'number') entry = t.clips[nameOrIdx % t.clips.length];
    else {
      for (var i = 0; i < t.clips.length; i++) {
        if (t.clips[i].name === nameOrIdx) { entry = t.clips[i]; break; }
      }
      if (!entry) entry = t.clips[0];
    }
    if (!entry) return false;
    if (t.current) t.current.stop();
    var action = t.mixer.clipAction(entry.clip);
    action.setLoop(THREE.LoopRepeat);
    action.paused = false;
    action.timeScale = 1;
    action.play();
    t.current = action;
    t.mode = 'play:' + entry.name;
    return true;
  };
  /* 'run': chạy clip Fast Run, tốc độ = speed/3.6 (clip_speed game.v).
   * 'idle': đứng yên — clip Idle nếu có, không thì dừng clip Run tại
   * idle_frame (frame mà 2 bàn chân gần nhau nhất, xem computeThandieuIdleFrame). */
  MapEditor._thandieuSetMode = function (objectId, mode, speedRatio) {
    var t = MapEditor._thandieuById[objectId];
    if (!t) return false;
    var want = mode + ':' + (mode === 'run' ? Math.round((speedRatio || 0) * 4) : 0);
    if (t.mode === want) return true;
    var clip = mode === 'run' ? t.runClip : t.idleClip;
    if (!clip) return false;
    if (t.current) t.current.stop();
    var action = t.mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat);
    if (mode === 'idle' && clip === t.runClip) {
      /* không có clip Idle riêng: freeze tại idle_frame + thở bằng scale (VeloPlay) */
      if (t.idleFrame === null) t.idleFrame = MapEditor.computeThandieuIdleFrame(objectId);
      action.time = t.idleFrame || 0;
      action.play();
      action.paused = true;
    } else {
      action.paused = false;
      action.timeScale = mode === 'run' ? Math.max(0.2, Math.min(2.5, speedRatio || 1)) : 1;
      action.play();
    }
    t.current = action;
    t.mode = want;
    return true;
  };
  /* idle_frame (game.v): sample clip Run từng frame bằng AnimationMixer,
   * đo khoảng cách world của 2 bone mixamorigLeftFoot/mixamorigRightFoot
   * (tên Velo KHÔNG dấu hai chấm), lấy frame khoảng cách nhỏ nhất.
   * Trả về giây trong [0, duration], hoặc null nếu không đo được. */
  MapEditor.computeThandieuIdleFrame = function (objectId) {
    var t = MapEditor._thandieuById[objectId];
    if (!t || !t.runClip || !t.fbx) return null;
    var L = t.fbx.getObjectByName('mixamorigLeftFoot');
    var R = t.fbx.getObjectByName('mixamorigRightFoot');
    if (!L || !R) return null;
    var mixer = t.mixer;
    var action = mixer.clipAction(t.runClip);
    action.play();
    var v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    var best = { t: 0, d: Infinity };
    var N = 24, dur = t.runClip.duration;
    for (var i = 0; i <= N; i++) {
      var tt = dur * i / N;
      action.time = tt;
      mixer.update(0);
      t.fbx.updateMatrixWorld(true);
      L.getWorldPosition(v1);
      R.getWorldPosition(v2);
      var d = v1.distanceTo(v2);
      if (d < best.d) best = { t: tt, d: d };
    }
    action.stop();
    t.idleFrame = best.t;
    /* trả mixer về trạng thái trước khi đo */
    if (t.current) { t.current.play(); t.current.paused = (t.mode || '').indexOf('idle') === 0; }
    return best.t;
  };
  MapEditor._thandieuUpdateAll = function (dt) {
    Object.keys(MapEditor._thandieuById).forEach(function (id) {
      var e = MapEditor._thandieuById[id];
      if (e && e.mixer) e.mixer.update(dt);
    });
  };

  /* ---------- tool / gizmo ---------- */
  MapEditor.setTool = function (tool) {
    MapEditor.tool = tool;
    var B = ME.TerrainBrush;
    if (['raise', 'lower', 'smooth', 'flatten', 'noise', 'mountain', 'plateau', 'terrace', 'erode'].indexOf(tool) >= 0) {
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
    if (!live) MapEditor.emitChange('transform', { id: id });
  };
  MapEditor.refreshAfterTerrain = function () {
    MapEditor._dirty = true;
    MapEditor.emitChange('terrain');
  };

  /* ---------- snap (lưới + góc) ---------- */
  MapEditor.setSnap = function (grid, angleDeg) {
    MapEditor.snapGrid = grid || 0;
    MapEditor.snapAngle = angleDeg || 0;
    if (ME.Viewport3D && ME.Viewport3D.gizmo) {
      ME.Viewport3D.gizmo.translationSnap = MapEditor.snapGrid || null;
      ME.Viewport3D.gizmo.rotationSnap = MapEditor.snapAngle ? MapEditor.snapAngle * Math.PI / 180 : null;
    }
  };
  MapEditor.snapValue = function (v) {
    if (!MapEditor.snapGrid) return v;
    return Math.round(v / MapEditor.snapGrid) * MapEditor.snapGrid;
  };

  /* ---------- đo khoảng cách (2 điểm trên terrain) ---------- */
  MapEditor.toggleMeasure = function () {
    MapEditor._measuring = !MapEditor._measuring;
    MapEditor.clearMeasure();
    MapEditor.setStatus(MapEditor._measuring ? 'Đo khoảng cách — click 2 điểm trên terrain (Esc để huỷ)' : 'Đã tắt đo khoảng cách');
    return MapEditor._measuring;
  };
  MapEditor.measureDistance = function (p1, p2) {
    var dx = p2.x - p1.x, dy = (p2.y || 0) - (p1.y || 0), dz = p2.z - p1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  MapEditor.addMeasurePoint = function (point) {
    MapEditor._measurePoints.push({ x: point.x, y: point.y, z: point.z });
    if (MapEditor._measurePoints.length === 2) {
      var d = MapEditor.measureDistance(MapEditor._measurePoints[0], MapEditor._measurePoints[1]);
      MapEditor._drawMeasureLine();
      MapEditor.setStatus('Khoảng cách: ' + d.toFixed(2) + ' m — click tiếp để đo lại');
      var out = $('me-measure-out');
      if (out) out.textContent = 'Khoảng cách: ' + d.toFixed(2) + ' m';
      return d;
    }
    return null;
  };
  MapEditor._drawMeasureLine = function () {
    if (!window.THREE || !ME.Viewport3D || !ME.Viewport3D.scene) return;
    MapEditor.clearMeasureLine();
    var pts = MapEditor._measurePoints;
    if (pts.length < 2) return;
    var geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(pts[0].x, pts[0].y + 0.3, pts[0].z),
      new THREE.Vector3(pts[1].x, pts[1].y + 0.3, pts[1].z)
    ]);
    var line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd94d }));
    ME.Viewport3D.scene.add(line);
    MapEditor._measureLine = line;
  };
  MapEditor.clearMeasureLine = function () {
    if (MapEditor._measureLine && MapEditor._measureLine.parent) {
      MapEditor._measureLine.parent.remove(MapEditor._measureLine);
      if (MapEditor._measureLine.geometry) MapEditor._measureLine.geometry.dispose();
    }
    MapEditor._measureLine = null;
  };
  MapEditor.clearMeasure = function () {
    MapEditor._measurePoints = [];
    MapEditor.clearMeasureLine();
    var out = $('me-measure-out');
    if (out) out.textContent = '';
  };

  /* ---------- thống kê scene thật (theo loại) ---------- */
  MapEditor.computeSceneStats = function () {
    var byType = {};
    var totalVerts = 0, totalTris = 0;
    (MapEditor.data ? MapEditor.data.objects : []).forEach(function (d) {
      var o3 = MapEditor.objects[d.id];
      var st = (ME.Inspector && ME.Inspector.meshStats) ? ME.Inspector.meshStats(o3) : { verts: 0, tris: 0 };
      if (!byType[d.type]) byType[d.type] = { count: 0, verts: 0, tris: 0 };
      byType[d.type].count++;
      byType[d.type].verts += st.verts;
      byType[d.type].tris += Math.round(st.tris);
      totalVerts += st.verts;
      totalTris += Math.round(st.tris);
    });
    return {
      totalObjects: MapEditor.data ? MapEditor.data.objects.length : 0,
      totalVerts: totalVerts, totalTris: totalTris, byType: byType
    };
  };

  /* ---------- placement mode ---------- */
  MapEditor.startPlacement = function (type, opts) {
    MapEditor._placementType = type;
    MapEditor._placementOpts = opts || {};
    MapEditor.setStatus('Đặt ' + type + ' — click lên terrain để đặt, Esc để huỷ');
    var cv = $('me-viewport');
    if (cv) cv.style.cursor = 'crosshair';
  };
  MapEditor.cancelPlacement = function () {
    MapEditor._placementType = null;
    MapEditor._placementOpts = {};
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
      /* bấm ra ngoài panel (điện thoại): đóng drawer */
      MapEditor.closeDrawers();
      MapEditor._dragging = { button: e.button, x: e.clientX, y: e.clientY, moved: 0, mode: null };
      var ndc = ndcFromEvent(e);
      /* đo khoảng cách: click 2 điểm terrain */
      if (MapEditor._measuring && e.button === 0) {
        var mp = terrainPointFromEvent(e);
        if (mp) {
          if (MapEditor._measurePoints.length >= 2) MapEditor.clearMeasure();
          MapEditor.addMeasurePoint(mp);
        }
        return;
      }
      /* khung kéo chọn: Shift + kéo với tool select */
      if (e.button === 0 && e.shiftKey && MapEditor.tool === 'select' && !MapEditor._placementType) {
        MapEditor._dragging.mode = 'marquee';
        MapEditor._marquee = { x0: e.clientX, y0: e.clientY };
        return;
      }
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
        if (pp) {
          var px = MapEditor.snapValue(pp.x), pz = MapEditor.snapValue(pp.z);
          MapEditor.placeObject(MapEditor._placementType, px, pz, MapEditor._placementOpts || {});
        }
        return;
      }
      if (e.button === 0) {
        var tool = MapEditor.tool;
        if (['raise', 'lower', 'smooth', 'flatten', 'noise', 'mountain', 'plateau', 'terrace', 'erode', 'paint', 'scatter'].indexOf(tool) >= 0) {
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
      /* khung kéo chọn: vẽ hình chữ nhật */
      if (dr && dr.mode === 'marquee' && MapEditor._marquee) {
        var wrapEl = $('me-viewport-wrap');
        var div = MapEditor._marquee.div;
        if (!div) {
          div = document.createElement('div');
          div.style.cssText = 'position:absolute;border:1px dashed #ffd94d;background:rgba(255,217,77,0.12);pointer-events:none;z-index:5;';
          if (wrapEl) wrapEl.appendChild(div);
          MapEditor._marquee.div = div;
        }
        var wr = wrapEl ? wrapEl.getBoundingClientRect() : { left: 0, top: 0 };
        var mx0 = MapEditor._marquee.x0 - wr.left, my0 = MapEditor._marquee.y0 - wr.top;
        var mx1 = e.clientX - wr.left, my1 = e.clientY - wr.top;
        div.style.left = Math.min(mx0, mx1) + 'px';
        div.style.top = Math.min(my0, my1) + 'px';
        div.style.width = Math.abs(mx1 - mx0) + 'px';
        div.style.height = Math.abs(my1 - my0) + 'px';
        return;
      }
      /* ghost placement */
      if (MapEditor._placementType) {
        var gp = terrainPointFromEvent(e);
        if (gp) MapEditor._updateGhost(gp);
        return;
      }
      /* brush preview + stroke */
      var tool = MapEditor.tool;
      var isBrush = ['raise', 'lower', 'smooth', 'flatten', 'noise', 'mountain', 'plateau', 'terrace', 'erode', 'paint', 'scatter'].indexOf(tool) >= 0;
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
      /* kết thúc khung kéo chọn */
      if (dr.mode === 'marquee' && MapEditor._marquee) {
        var mq = MapEditor._marquee;
        MapEditor._marquee = null;
        if (mq.div && mq.div.parentNode) mq.div.parentNode.removeChild(mq.div);
        var wrapEl2 = $('me-viewport-wrap');
        var wr2 = wrapEl2 ? wrapEl2.getBoundingClientRect() : { left: 0, top: 0 };
        MapEditor.selectInRect(mq.x0 - wr2.left, mq.y0 - wr2.top, e.clientX - wr2.left, e.clientY - wr2.top);
        return;
      }
      /* click (không kéo) với tool select → chọn object */
      if (e.button === 0 && dr.mode === 'orbit' && dr.moved < 6) {
        /* click lên minimap (góc phải trên) → di chuyển camera */
        if (ME.Viewport3D.minimapClick && ME.Viewport3D.minimapClick(e.clientX, e.clientY)) return;
        var pick = ME.Viewport3D.pickObject(ndcFromEvent(e));
        if (pick) {
          if (e.ctrlKey || e.metaKey || e.shiftKey) MapEditor.toggleSelect(pick.object.userData.mapId);
          else MapEditor.select(pick.object.userData.mapId);
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
      if (data && data.indexOf('asset:import:') === 0) {
        var assetId = data.slice('asset:import:'.length);
        var p2 = ME.Viewport3D.terrainPoint(ndcFromEvent(e), ME.TerrainEditor.mesh);
        if (p2) MapEditor.placeImportedModel(assetId, p2.x, p2.z);
      } else if (data && data.indexOf('asset:') === 0) {
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
        else if (k === 'c') { e.preventDefault(); MapEditor.copySelected(); }
        else if (k === 'v') { e.preventDefault(); MapEditor.pasteClipboard(); }
        else if (k === 'a') {
          e.preventDefault();
          MapEditor.selectMany(MapEditor.data ? MapEditor.data.objects.map(function (o) { return o.id; }) : []);
        }
        return;
      }
      /* đang Run Velo: MapEditor không xử lý phím (VeloPlay xử lý riêng
       * WASD/J/K/Space/Q/E/Esc) — tránh Space toggle Play, Q/E/R đổi tool. */
      if (ME.VeloPlay && ME.VeloPlay.isActive && ME.VeloPlay.isActive()) return;
      if (k === 'escape') {
        MapEditor.cancelPlacement();
        MapEditor._addWaypointFor = null;
        if (MapEditor._measuring) { MapEditor._measuring = false; MapEditor.clearMeasure(); }
        MapEditor.closeDrawers();
        MapEditor.select(null);
      } else if (k >= '1' && k <= '5' && !e.altKey) {
        /* camera bookmarks: 1–5 nhảy tới, Shift+1–5 lưu vị trí hiện tại */
        var slot = parseInt(k, 10) - 1;
        if (e.shiftKey) {
          if (ME.Viewport3D.rig) {
            ME.Viewport3D.rig.saveBookmark(slot);
            if (MapEditor._refreshBookmarkLabels) MapEditor._refreshBookmarkLabels();
            MapEditor.notify('Bookmark', 'Đã lưu vị trí camera ' + (slot + 1) + '.', 'success');
          }
        } else {
          if (ME.Viewport3D.rig && !ME.Viewport3D.rig.gotoBookmark(slot)) {
            MapEditor.notify('Bookmark', 'Vị trí ' + (slot + 1) + ' chưa lưu (Shift+' + (slot + 1) + ' để lưu).', 'warning');
          }
        }
      } else if (k === 'q') MapEditor.setTool('select');
      else if (k === 'w') MapEditor.setTool('move');
      else if (k === 'e') MapEditor.setTool('rotate');
      else if (k === 'r') {
        /* R = Run Velo khi có scene Velo; chưa có thì notify + giữ tool Scale */
        if (!(ME.VeloPlay && ME.VeloPlay.toggleRunKey && ME.VeloPlay.toggleRunKey())) MapEditor.setTool('scale');
      }
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
        var lname = file.name.toLowerCase();
        if (lname.indexOf('.shared-scene.json') >= 0) {
          ME.MapExport.importSharedFile(file).catch(function (e) { MapEditor.notify('Import lỗi', e.message, 'error'); });
        } else if (/\.(glb|gltf|fbx|obj)$/.test(lname) && ME.AssetManager) {
          /* file model 3D → route sang AssetManager.importModelFile */
          ME.AssetManager.importModelFile(file).catch(function (e) { MapEditor.notify('Import model lỗi', e.message, 'error'); });
        } else {
          ME.MapExport.importFile(file).catch(function (e) { MapEditor.notify('Import lỗi', e.message, 'error'); });
        }
        fi.value = '';
      });
    }
    /* drawer điện thoại + thu gọn Asset strip */
    on('me-drawer-left-btn', function () { MapEditor.toggleDrawer('left'); });
    on('me-drawer-right-btn', function () { MapEditor.toggleDrawer('right'); });
    var bHead = $('me-bottom-head');
    if (bHead) {
      bHead.addEventListener('click', function (e) {
        var tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
        var b = $('me-bottom');
        if (b) b.classList.toggle('collapsed');
      });
      var bArrow = document.createElement('span');
      bArrow.className = 'me-collapse-arrow';
      bArrow.textContent = '▾';
      bHead.appendChild(bArrow);
    }
    /* view buttons */
    document.querySelectorAll('[data-me-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        ME.Viewport3D.rig.setView(b.dataset.meView);
        document.querySelectorAll('[data-me-view]').forEach(function (x) { x.classList.toggle('active', x === b); });
      });
    });
    /* Ortho / Persp + FOV (thống nhất với Studio) */
    on('me-ortho-btn', function () {
      var on2 = ME.Viewport3D.setOrthoMode(!ME.Viewport3D.isOrtho());
      var btn = $('me-ortho-btn');
      if (btn) btn.classList.toggle('active', on2);
      var fov = $('me-fov-range');
      if (fov) fov.disabled = on2;
      MapEditor.setStatus(on2 ? 'Camera: Orthographic' : 'Camera: Perspective');
    });
    var fovRange = $('me-fov-range');
    if (fovRange) {
      fovRange.addEventListener('input', function () {
        var v = parseInt(fovRange.value, 10) || 50;
        ME.Viewport3D.setFov(v);
        var val = $('me-fov-val');
        if (val) val.textContent = v + '°';
      });
    }
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

  /* ---------- panel mở rộng (thêm bằng JS, không sửa MapEditor.html) ---------- */
  function mkPanelHead(title) {
    var h = document.createElement('div');
    h.className = 'panel-head';
    h.textContent = title;
    return h;
  }
  function mkPanelBody() {
    var b = document.createElement('div');
    b.className = 'panel-body';
    b.style.cssText = 'flex:none;';
    return b;
  }
  function mkBtn(label, title, fn) {
    var b = document.createElement('button');
    b.className = 'btn sm';
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', fn);
    return b;
  }
  function mkRow(label, child) {
    var r = document.createElement('div');
    r.className = 'ins-row';
    var s = document.createElement('span');
    s.className = 'ins-label';
    s.textContent = label;
    r.appendChild(s);
    if (child) r.appendChild(child);
    return r;
  }

  MapEditor._buildExtraUI = function () {
    /* --- cột trái: Chỉnh sửa (multi-select, align, copy/paste, nhóm) --- */
    var left = $('me-left');
    if (left) {
      left.appendChild(mkPanelHead('✏️ Chỉnh sửa'));
      var lb = mkPanelBody();
      var hint = document.createElement('div');
      hint.className = 'ins-hint';
      hint.textContent = 'Shift/Ctrl+click chọn nhiều · Shift+kéo khung chọn · Ctrl+C/V copy/paste · Ctrl+A chọn hết';
      lb.appendChild(hint);
      var row1 = document.createElement('div');
      row1.className = 'ins-btnrow';
      row1.appendChild(mkBtn('⧉ Copy', 'Ctrl+C', function () { MapEditor.copySelected(); }));
      row1.appendChild(mkBtn('⎘ Paste', 'Ctrl+V', function () { MapEditor.pasteClipboard(); }));
      row1.appendChild(mkBtn('⧉ Duplicate dọc path', 'Nhân object đang chọn dọc patrol path gần nhất', function () { MapEditor.duplicateAlongPath(); }));
      lb.appendChild(row1);
      var row2 = document.createElement('div');
      row2.className = 'ins-btnrow';
      row2.appendChild(mkBtn('⇤ Align X min', '', function () { MapEditor.alignSelected('x-min'); }));
      row2.appendChild(mkBtn('⇔ Align X giữa', '', function () { MapEditor.alignSelected('x-center'); }));
      row2.appendChild(mkBtn('⇥ Align X max', '', function () { MapEditor.alignSelected('x-max'); }));
      lb.appendChild(row2);
      var row3 = document.createElement('div');
      row3.className = 'ins-btnrow';
      row3.appendChild(mkBtn('⇤ Align Z min', '', function () { MapEditor.alignSelected('z-min'); }));
      row3.appendChild(mkBtn('⇔ Align Z giữa', '', function () { MapEditor.alignSelected('z-center'); }));
      row3.appendChild(mkBtn('⇥ Align Z max', '', function () { MapEditor.alignSelected('z-max'); }));
      lb.appendChild(row3);
      var row4 = document.createElement('div');
      row4.className = 'ins-btnrow';
      row4.appendChild(mkBtn('↔ Đều khoảng X', 'Cần ≥3 object', function () { MapEditor.distributeSelected('x'); }));
      row4.appendChild(mkBtn('↕ Đều khoảng Z', 'Cần ≥3 object', function () { MapEditor.distributeSelected('z'); }));
      row4.appendChild(mkBtn('🗂 Gom nhóm…', 'Gom các object đang chọn vào 1 nhóm', function () {
        var name = window.prompt('Tên nhóm (nhóm mới sẽ được tạo):', 'MyGroup');
        if (name) MapEditor.groupSelected(name);
      }));
      lb.appendChild(row4);
      left.appendChild(lb);
    }

    /* --- cột phải: Snap / Bookmarks / Layers / Đo & Thống kê / Terrain thêm / Bầu trời / Play --- */
    var right = $('me-right');
    if (!right) return;

    /* Snap */
    right.appendChild(mkPanelHead('🧲 Snap'));
    var sb = mkPanelBody();
    var gridSel = document.createElement('select');
    gridSel.className = 'in-select';
    [['0', 'Lưới: tắt'], ['0.5', 'Lưới 0.5 m'], ['1', 'Lưới 1 m'], ['2', 'Lưới 2 m']].forEach(function (o) {
      var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; gridSel.appendChild(op);
    });
    var angSel = document.createElement('select');
    angSel.className = 'in-select';
    [['0', 'Góc: tắt'], ['15', 'Góc 15°'], ['45', 'Góc 45°']].forEach(function (o) {
      var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; angSel.appendChild(op);
    });
    function snapApply() { MapEditor.setSnap(parseFloat(gridSel.value), parseFloat(angSel.value)); }
    gridSel.addEventListener('change', snapApply);
    angSel.addEventListener('change', snapApply);
    sb.appendChild(mkRow('Snap lưới', gridSel));
    sb.appendChild(mkRow('Snap góc', angSel));
    right.appendChild(sb);

    /* Bookmarks */
    right.appendChild(mkPanelHead('📷 Camera Bookmarks'));
    var bb = mkPanelBody();
    var bmLabels = [];
    for (var bi = 0; bi < 5; bi++) {
      (function (slot) {
        var row = document.createElement('div');
        row.className = 'ins-row';
        var lab = document.createElement('span');
        lab.className = 'ins-label';
        lab.textContent = 'Vị trí ' + (slot + 1) + ': ';
        var val = document.createElement('span');
        val.id = 'me-bm-' + slot;
        val.className = 'ins-val';
        bmLabels.push(val);
        row.appendChild(lab);
        row.appendChild(val);
        row.appendChild(mkBtn('Lưu', 'Lưu vị trí camera hiện tại', function () {
          if (ME.Viewport3D.rig) { ME.Viewport3D.rig.saveBookmark(slot); MapEditor._refreshBookmarkLabels(); }
        }));
        row.appendChild(mkBtn('Đi', 'Chuyển camera tới vị trí đã lưu', function () {
          if (ME.Viewport3D.rig && !ME.Viewport3D.rig.gotoBookmark(slot)) {
            MapEditor.notify('Bookmark', 'Vị trí ' + (slot + 1) + ' chưa lưu.', 'warning');
          }
        }));
        bb.appendChild(row);
      })(bi);
    }
    right.appendChild(bb);
    MapEditor._refreshBookmarkLabels = function () {
      for (var i = 0; i < 5; i++) {
        var elx = $('me-bm-' + i);
        if (elx && ME.Viewport3D.rig) elx.textContent = ME.Viewport3D.rig.bookmarkLabel(i);
      }
    };
    MapEditor._refreshBookmarkLabels();

    /* Layers */
    right.appendChild(mkPanelHead('🗂 Layers'));
    var lyb = mkPanelBody();
    Object.keys(MapEditor.LAYER_GROUPS).forEach(function (layer) {
      var lab = document.createElement('label');
      lab.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 4px;';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.addEventListener('change', function () { MapEditor.setLayerVisible(layer, cb.checked); });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(layer + (layer === 'Effects' ? ' (Lighting + Particles)' : '')));
      lyb.appendChild(lab);
    });
    right.appendChild(lyb);

    /* Đo & Thống kê */
    right.appendChild(mkPanelHead('📏 Đo & Thống kê'));
    var mb = mkPanelBody();
    var mrow = document.createElement('div');
    mrow.className = 'ins-btnrow';
    var measureBtn = mkBtn('📏 Đo khoảng cách', 'Click 2 điểm trên terrain', function () {
      var on = MapEditor.toggleMeasure();
      measureBtn.classList.toggle('active', on);
    });
    mrow.appendChild(measureBtn);
    mb.appendChild(mrow);
    var mout = document.createElement('div');
    mout.id = 'me-measure-out';
    mout.className = 'ins-info';
    mb.appendChild(mout);
    var sout = document.createElement('div');
    sout.id = 'me-stats-out';
    sout.className = 'ins-info';
    mb.appendChild(sout);
    right.appendChild(mb);

    /* Terrain thêm */
    right.appendChild(mkPanelHead('⛰ Terrain thêm'));
    var tb = mkPanelBody();
    var trow = document.createElement('div');
    trow.className = 'ins-btnrow';
    [['Plateau', 'plateau'], ['Terrace', 'terrace'], ['Erode', 'erode']].forEach(function (t) {
      trow.appendChild(mkBtn(t[0], 'Cọ ' + t[0] + ' — dùng như Raise/Lower', function () { MapEditor.setTool(t[1]); }));
    });
    tb.appendChild(trow);
    var seedRow = document.createElement('div');
    seedRow.className = 'ins-row';
    var seedInp = document.createElement('input');
    seedInp.type = 'number';
    seedInp.className = 'in-num';
    seedInp.value = '1337';
    seedInp.title = 'Seed scatter';
    seedInp.style.width = '80px';
    seedRow.appendChild(document.createTextNode('Seed scatter: '));
    seedRow.appendChild(seedInp);
    seedRow.appendChild(mkBtn('🌲 Scatter có seed', 'Rải 5 object (loại đang chọn) quanh tâm camera, seed cố định', function () {
      var seed = parseInt(seedInp.value, 10) || 1337;
      var cx = ME.Viewport3D.rig ? ME.Viewport3D.rig.target.x : 0;
      var cz = ME.Viewport3D.rig ? ME.Viewport3D.rig.target.z : 0;
      MapEditor.pushUndo('Scatter seeded');
      var n = ME.TerrainBrush.scatterSeeded(cx, cz, MapEditor._scatterType || 'pine', 5, seed);
      MapEditor.notify('Scatter', 'Đã rải ' + n + ' object (seed ' + seed + ')', 'success');
      MapEditor.emitChange('scatter');
    }));
    tb.appendChild(seedRow);
    var hmRow = document.createElement('div');
    hmRow.className = 'ins-btnrow';
    hmRow.appendChild(mkBtn('⬇ Export heightmap', 'Tải heightmap JSON (heights + paint + mực nước)', function () {
      var doc = ME.TerrainEditor.exportHeightmap();
      if (doc) MapEditor.notify('Heightmap', 'Đã export heightmap ' + doc.size + '×' + doc.segments, 'success');
    }));
    var hmInput = document.createElement('input');
    hmInput.type = 'file';
    hmInput.accept = '.json';
    hmInput.style.display = 'none';
    hmInput.addEventListener('change', function () {
      var f = hmInput.files && hmInput.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var res = ME.TerrainEditor.importHeightmap(JSON.parse(r.result));
          if (res.ok) MapEditor.notify('Heightmap', 'Đã import heightmap.', 'success');
          else MapEditor.notify('Heightmap lỗi', res.error, 'error');
        } catch (e) { MapEditor.notify('Heightmap lỗi', 'File JSON không hợp lệ', 'error'); }
      };
      r.readAsText(f);
      hmInput.value = '';
    });
    tb.appendChild(hmInput);
    hmRow.appendChild(mkBtn('⬆ Import heightmap', 'Đọc heightmap JSON', function () { hmInput.click(); }));
    tb.appendChild(hmRow);
    var wRow = document.createElement('div');
    wRow.className = 'ins-row';
    var wCb = document.createElement('input');
    wCb.type = 'checkbox';
    wCb.addEventListener('change', function () {
      if (wCb.checked) ME.TerrainEditor.setWaterLevel(parseFloat(wRange.value) || 0);
      else ME.TerrainEditor.hideWater();
      MapEditor.emitChange('water');
    });
    var wRange = document.createElement('input');
    wRange.type = 'range';
    wRange.min = '-2'; wRange.max = '4'; wRange.step = '0.1'; wRange.value = '0';
    wRange.style.width = '110px';
    var wVal = document.createElement('span');
    wVal.className = 'ins-val';
    wVal.textContent = '0 m';
    wRange.addEventListener('input', function () {
      wVal.textContent = parseFloat(wRange.value).toFixed(1) + ' m';
      if (wCb.checked) ME.TerrainEditor.setWaterLevel(parseFloat(wRange.value));
    });
    wRow.appendChild(wCb);
    wRow.appendChild(document.createTextNode('Mực nước: '));
    wRow.appendChild(wRange);
    wRow.appendChild(wVal);
    tb.appendChild(wRow);
    right.appendChild(tb);

    /* Bầu trời & sương mù */
    right.appendChild(mkPanelHead('🌤 Bầu trời & Sương mù'));
    var fb = mkPanelBody();
    fb.appendChild((function () {
      var d = document.createElement('div');
      d.className = 'ins-hint';
      d.textContent = 'Preset thời tiết mới: Bình minh, Bão tố, Sương mù dày (chọn trong ô Thời tiết ở panel Environment).';
      return d;
    })());
    var frow = document.createElement('div');
    frow.className = 'ins-btnrow';
    [['Sương mỏng', 'clear'], ['Mặc định', 'normal'], ['Sương dày', 'dense']].forEach(function (f) {
      frow.appendChild(mkBtn(f[0], 'Preset fog: ' + f[0], function () {
        if (ME.Environment.applyFogPreset(f[1])) {
          var fn = $('me-fog-near'), ff = $('me-fog-far');
          if (fn && ME.Viewport3D.scene.fog) fn.value = ME.Viewport3D.scene.fog.near;
          if (ff && ME.Viewport3D.scene.fog) ff.value = ME.Viewport3D.scene.fog.far;
        }
      }));
    });
    fb.appendChild(frow);
    right.appendChild(fb);

    /* Play */
    right.appendChild(mkPanelHead('▶ Play'));
    var pb = mkPanelBody();
    var followLab = document.createElement('label');
    followLab.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 4px;';
    var followCb = document.createElement('input');
    followCb.type = 'checkbox';
    followCb.addEventListener('change', function () {
      if (ME.Viewport3D) ME.Viewport3D.setFollowHero(followCb.checked);
    });
    followLab.appendChild(followCb);
    followLab.appendChild(document.createTextNode('Camera theo hero khi Play'));
    pb.appendChild(followLab);
    pb.appendChild((function () {
      var d = document.createElement('div');
      d.className = 'ins-hint';
      d.textContent = 'Khi Play, hero cũng đi theo patrol path gần nhất (như quái/boss).';
      return d;
    })());
    right.appendChild(pb);

    MapEditor.refreshStatsPanel();
  };

  /* thống kê scene (số liệu thật) — refresh theo emitChange */
  MapEditor.refreshStatsPanel = function () {
    var out = $('me-stats-out');
    if (!out) return;
    var cs = MapEditor.computeSceneStats();
    var lines = [
      'Objects: <b>' + cs.totalObjects + '</b> · Verts: <b>' + cs.totalVerts.toLocaleString() + '</b> · Tris: <b>' + cs.totalTris.toLocaleString() + '</b>'
    ];
    var types = Object.keys(cs.byType).sort(function (a, b) { return cs.byType[b].count - cs.byType[a].count; });
    types.slice(0, 8).forEach(function (t) {
      var v = cs.byType[t];
      lines.push(t + ': <b>' + v.count + '</b> · ' + v.verts.toLocaleString() + ' verts · ' + v.tris.toLocaleString() + ' tris');
    });
    if (types.length > 8) lines.push('… +' + (types.length - 8) + ' loại khác');
    out.innerHTML = lines.join('<br>');
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
      /* panel mở rộng (thêm bằng JS: chỉnh sửa, snap, bookmarks, layers, đo, terrain, play) */
      try { MapEditor._buildExtraUI(); } catch (e) { console.warn('[MapEditor] extra UI lỗi:', e); }
      /* nút "🌲 Lấp đầy map" (thêm bằng JS vào toolbar) */
      try { MapEditor._buildFillMapUI(); } catch (e) { console.warn('[MapEditor] fill UI lỗi:', e); }
      /* bọc các section thành thu gọn — Inspector luôn hiện, không bị khuất */
      try { MapEditor._initCollapsiblePanels(); } catch (e) { console.warn('[MapEditor] collapsible lỗi:', e); }
      /* trạng thái nối Studio (?from=studio / vừa nhận scene) */
      try {
        var receivedName = null;
        if (loaded && MapEditor.data) receivedName = MapEditor.data.name;
        MapEditor._updateLinkStatus(receivedName);
      } catch (e) { }
      /* mở từ Studio bằng file fallback: ?import=shared → nhắc chọn file */
      try {
        if (/[?&]import=shared/.test(window.location.search) && ME.MapExport && ME.MapExport.showImportSharedPrompt) {
          ME.MapExport.showImportSharedPrompt();
        }
      } catch (e) { }
      /* Velo Project: import cả thư mục + cây project */
      try { if (ME.VeloProject) ME.VeloProject.init(); } catch (e) { console.warn('[MapEditor] VeloProject lỗi:', e); }
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
        /* update mixer Thần Điêu cho mọi object FBX (hero + runners) */
        MapEditor._thandieuUpdateAll(dt);
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
