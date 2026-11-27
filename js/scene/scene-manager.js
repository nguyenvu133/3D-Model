/* ============================================================
 * scene/scene-manager.js — Hierarchy registry, CRUD object,
 * re-parent, serialize cho save project, scene tree UI.
 *
 * MULTI-SCENE (v2, 2026-11-27): quản lý NHIỀU scene thật.
 *  - Scene.scenes: map id -> { id, name, registry, createdAt };
 *    mỗi scene có registry riêng (uuid -> reg).
 *  - Scene.activeSceneId: scene đang mở trong Viewport.
 *  - Scene.additiveSceneIds: các scene phụ đang load thêm cùng
 *    lúc với scene active trong cùng Viewport.scene.
 *  - BACKWARD COMPAT: Scene.registry LUÔN trỏ tới registry của
 *    scene active (gán lại mỗi lần switchScene), nên mọi code cũ
 *    gọi Scene.register / serializeObjects / renderTree / ... vẫn
 *    chạy, thao tác trên scene active. Scene.lookup(uuid) tìm
 *    object ở cả scene active + scene phụ (registry không thấy).
 *  - Object của scene không active được GIỮ trong bộ nhớ dưới
 *    dạng object3D detached (không serialize lại): switchScene
 *    chỉ remove khỏi Viewport.scene / add lại, không dispose,
 *    nên chuyển qua lại không mất object, giữ nguyên cả rig,
 *    material, animation.
 *  - Scene Director (scene-director.js) là các hàm THUẦN, không
 *    giữ state, không gắn với scene nào: nó chỉ thao tác trên
 *    object mà caller truyền vào — thực tế là object của scene
 *    active (smart-panel gom từ Scene.registry). Multi-scene
 *    KHÔNG cần sửa Director; mỗi lần gọi stage() cứ truyền object
 *    của scene đang mở là đúng.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Scene = {
    registry: {},        // uuid -> { object3D, type, name, locked, parentId } — LUÔN là registry của scene active (compat)
    root: null,
    /* ---- multi-scene store ---- */
    scenes: {},          // id -> { id, name, registry, createdAt }
    activeSceneId: null, // id scene đang mở trong Viewport
    additiveSceneIds: [],// id các scene phụ đang load thêm cùng Viewport.scene
    _sceneSeq: 0
  };

  /* ============================================================
     MULTI-SCENE — kho scene + attach/detach viewport
     ============================================================ */
  Scene._newSceneId = function () {
    Scene._sceneSeq++;
    if (U.uid) return U.uid('scene');
    return 'scene-' + Scene._sceneSeq + '-' + Date.now().toString(36);
  };

  Scene._createSceneEntry = function (id, name) {
    const entry = { id: id, name: name || 'Scene', registry: {}, createdAt: new Date().toISOString() };
    Scene.scenes[id] = entry;
    return entry;
  };

  /* Scene active; chưa có scene nào thì tạo "Main Scene" mặc định
     (đây là đường migrate project cũ 1 scene). */
  Scene._activeEntry = function () {
    if (Scene.activeSceneId && Scene.scenes[Scene.activeSceneId]) {
      const e = Scene.scenes[Scene.activeSceneId];
      if (Scene.registry !== e.registry) Scene.registry = e.registry;
      return e;
    }
    const ids = Object.keys(Scene.scenes);
    if (!ids.length) {
      const d = Scene._createSceneEntry(Scene._newSceneId(), 'Main Scene');
      Scene.activeSceneId = d.id;
      Scene.registry = d.registry;
      return d;
    }
    const first = Scene.scenes[ids[0]];
    Scene.activeSceneId = first.id;
    Scene.registry = first.registry;
    return first;
  };

  Scene.activeScene = function () { return Scene._activeEntry(); };

  Scene.getScene = function (id) { return Scene.scenes[id] || null; };

  Scene._viewportScene = function () {
    return (PixiStudio.Viewport && PixiStudio.Viewport.scene) || null;
  };

  /* Các scene đang hiển thị trong viewport: active + additive. */
  Scene._loadedEntries = function () {
    const out = [];
    const active = Scene._activeEntry();
    if (active) out.push(active);
    Scene.additiveSceneIds.forEach(function (id) {
      const e = Scene.scenes[id];
      if (e && out.indexOf(e) < 0) out.push(e);
    });
    return out;
  };

  /* Tìm registry entry theo uuid: active trước, rồi additive, rồi mọi scene. */
  Scene._findReg = function (uuid, withEntry) {
    const order = Scene._loadedEntries();
    Object.keys(Scene.scenes).forEach(function (id) {
      const e = Scene.scenes[id];
      if (order.indexOf(e) < 0) order.push(e);
    });
    for (let i = 0; i < order.length; i++) {
      const reg = order[i].registry[uuid];
      if (reg) return withEntry ? { entry: order[i], reg: reg } : reg;
    }
    return null;
  };

  /* Tìm registry entry theo uuid CHỈ trong các scene đang load
     (active + additive) — dùng để quyết định object có hiện trong
     viewport/cây hay không. */
  Scene._loadedReg = function (uuid) {
    const loaded = Scene._loadedEntries();
    for (let i = 0; i < loaded.length; i++) {
      const reg = loaded[i].registry[uuid];
      if (reg) return reg;
    }
    return null;
  };

  /* Tìm object theo uuid ở mọi scene (kể cả scene phụ / scene chưa mở). */
  Scene.lookup = function (uuid) {
    const reg = Scene._findReg(uuid);
    return reg ? reg.object3D : null;
  };

  /* Scene nào đang sở hữu object này (id hoặc null). */
  Scene.getSceneIdOf = function (uuid) {
    const found = Scene._findReg(uuid, true);
    return found ? found.entry.id : null;
  };

  Scene.isAdditive = function (id) { return Scene.additiveSceneIds.indexOf(id) >= 0; };

  Scene.objectCount = function (id) {
    const e = id ? Scene.scenes[id] : Scene._activeEntry();
    if (!e) return 0;
    return Object.keys(e.registry).filter(function (u) {
      const r = e.registry[u];
      return r && r.object3D;
    }).length;
  };

  Scene.listScenes = function () {
    Scene._activeEntry(); /* đảm bảo có ít nhất Main Scene */
    return Object.keys(Scene.scenes).map(function (id) {
      const e = Scene.scenes[id];
      return {
        id: id,
        name: e.name,
        objectCount: Scene.objectCount(id),
        active: id === Scene.activeSceneId,
        additive: Scene.isAdditive(id)
      };
    });
  };

  /* Object top-level của 1 scene: object trong registry mà parent của
     nó KHÔNG phải 1 object khác trong cùng registry (con đi theo cha
     khi cha detach/attach, không cần xử lý riêng). */
  Scene._topLevelObjects = function (entry) {
    const out = [];
    Object.keys(entry.registry).forEach(function (uuid) {
      const reg = entry.registry[uuid];
      const o = reg && reg.object3D;
      if (!o) return;
      if (o.parent && entry.registry[o.parent.uuid]) return; /* con của object cùng scene */
      out.push(o);
    });
    return out;
  };

  /* Gỡ object của 1 scene khỏi viewport, GIỮ object3D trong bộ nhớ
     (registry giữ nguyên) + nhớ parent cũ để gắn lại. */
  Scene._detachSceneObjects = function (entry) {
    Scene._topLevelObjects(entry).forEach(function (o) {
      if (o.parent) {
        const reg = entry.registry[o.uuid];
        if (reg) reg._detachedFrom = o.parent;
        o.parent.remove(o);
      }
    });
  };

  /* Gắn lại object của 1 scene vào viewport (về đúng parent cũ:
     Viewport.scene với primitive, modelRoot với model). */
  Scene._attachSceneObjects = function (entry) {
    const vp = Scene._viewportScene();
    Scene._topLevelObjects(entry).forEach(function (o) {
      if (o.parent) return; /* đã gắn rồi */
      const reg = entry.registry[o.uuid];
      const parent = (reg && reg._detachedFrom) || null;
      if (parent && typeof parent.add === 'function') parent.add(o);
      else if (vp) vp.add(o);
      if (o.userData) o.userData.sceneId = entry.id;
    });
  };

  /* ---------- SCENE CRUD ---------- */
  Scene.createScene = function (name, opts) {
    opts = opts || {};
    const entry = Scene._createSceneEntry(Scene._newSceneId(),
      (name && String(name).trim()) || ('Scene ' + (Object.keys(Scene.scenes).length + 1)));
    if (opts.activate !== false) {
      Scene.switchScene(entry.id);
    } else {
      bus.emit('scene:changed', { action: 'create-scene', id: entry.id, name: entry.name });
      Scene.renderTree();
      Scene.renderPage();
    }
    return entry.id;
  };

  Scene.renameScene = function (id, name) {
    const e = Scene.scenes[id];
    if (!e || !name || !String(name).trim()) return false;
    e.name = String(name).trim();
    if (PixiStudio.History) PixiStudio.History.push('Rename scene ' + e.name);
    bus.emit('scene:changed', { action: 'rename-scene', id: id, name: e.name });
    Scene.renderTree();
    Scene.renderPage();
    return true;
  };

  Scene.deleteScene = function (id, opts) {
    opts = opts || {};
    const e = Scene.scenes[id];
    if (!e) return false;
    const ids = Object.keys(Scene.scenes);
    if (ids.length <= 1) {
      bus.emit('notify', { type: 'warning', title: 'Delete Scene', message: 'Không thể xoá scene cuối cùng.' });
      return false;
    }
    /* Xác nhận ở UI: trình duyệt có window.confirm; harness/node không
       có confirm thì cho qua (test truyền skipConfirm). */
    if (!opts.skipConfirm && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm('Xoá scene "' + e.name + '" (' + Scene.objectCount(id) + ' object)?')) return false;
    }
    Scene.unloadAdditive(id);
    if (id === Scene.activeSceneId) {
      const next = ids.filter(function (x) { return x !== id; })[0];
      Scene.switchScene(next);
    }
    /* Model trong scene bị xoá: gỡ khỏi Models.models như deleteObject. */
    Object.keys(e.registry).forEach(function (uuid) {
      const reg = e.registry[uuid];
      const o = reg && reg.object3D;
      if (!o) return;
      const modelEntry = o.userData && o.userData.modelEntry;
      if (reg.type === 'model' && modelEntry && PixiStudio.Models && PixiStudio.Models.models &&
          PixiStudio.Models.models[modelEntry.id] && PixiStudio.Models.remove) {
        try { PixiStudio.Models.remove(modelEntry.id); } catch (err) { /* bỏ qua */ }
      }
    });
    Scene._detachSceneObjects(e);
    /* dispose geometry của primitive (model đã xử lý qua Models.remove). */
    Object.keys(e.registry).forEach(function (uuid) {
      const reg = e.registry[uuid];
      const o = reg && reg.object3D;
      if (!o || reg.type !== 'primitive') return;
      o.traverse(function (c) { if (c.isMesh && c.geometry) c.geometry.dispose(); });
    });
    delete Scene.scenes[id];
    if (PixiStudio.History) PixiStudio.History.push('Delete scene ' + e.name);
    bus.emit('scene:changed', { action: 'delete-scene', id: id, name: e.name });
    Scene.renderTree();
    Scene.renderPage();
    return true;
  };

  /* Nhân bản 1 scene (kể cả scene chưa mở — clone từ object detached). */
  Scene.duplicateScene = function (id) {
    const src = Scene.scenes[id];
    if (!src) return null;
    const newId = Scene.createScene(src.name + ' copy', { activate: false });
    const dst = Scene.scenes[newId];
    Scene._topLevelObjects(src).forEach(function (o) {
      const clone = Scene._safeClone(o);
      if (!clone) return;
      clone.name = (o.name || 'Object') + '_copy';
      const srcReg = src.registry[o.uuid];
      Scene._registerInto(dst, clone, srcReg ? srcReg.type : 'primitive', clone.name, srcReg ? srcReg.parentId : null);
      const dstReg = dst.registry[clone.uuid];
      if (dstReg) {
        dstReg.locked = !!(srcReg && srcReg.locked);
        clone.visible = o.visible;
      }
      /* Con đã đăng ký trong scene gốc: đăng ký bản clone tương ứng
         (chỉ khi clone giữ đúng cấu trúc — traverse cùng số node). */
      const srcNodes = [];
      const dstNodes = [];
      o.traverse(function (n) { srcNodes.push(n); });
      clone.traverse(function (n) { dstNodes.push(n); });
      if (srcNodes.length === dstNodes.length) {
        srcNodes.forEach(function (sn, i) {
          if (i === 0) return; /* top-level đã đăng ký ở trên */
          const sreg = src.registry[sn.uuid];
          if (!sreg) return;
          const dn = dstNodes[i];
          dn.name = (dn.name || sreg.name) + '_copy'; /* đồng bộ Object3D.name với registry */
          Scene._registerInto(dst, dn, sreg.type, dn.name, sreg.parentId);
          const dreg = dst.registry[dn.uuid];
          if (dreg) dreg.locked = !!sreg.locked;
        });
      }
    });
    Scene.switchScene(newId);
    return newId;
  };

  /* ---------- CHUYỂN SCENE / ADDITIVE ---------- */
  Scene.switchScene = function (id) {
    const target = Scene.scenes[id];
    if (!target) return false;
    if (id === Scene.activeSceneId) return true;
    const fromId = Scene.activeSceneId;
    const from = fromId ? Scene.scenes[fromId] : null;
    if (Scene.isAdditive(id)) Scene.unloadAdditive(id); /* đích đang là scene phụ → gỡ additive rồi mở chính */
    if (from) Scene._detachSceneObjects(from);
    Scene.activeSceneId = id;
    Scene.registry = target.registry; /* đồng bộ con trỏ compat */
    Scene._attachSceneObjects(target);
    if (PixiStudio.State) PixiStudio.State.select(null);
    bus.emit('scene:switched', { from: fromId || null, to: id, name: target.name });
    bus.emit('scene:changed', { action: 'switch', id: id, name: target.name });
    Scene.renderTree();
    Scene.renderPage();
    return true;
  };

  /* Mở thêm 1 scene phụ cùng lúc với scene active (vd scene ánh sáng/décor). */
  Scene.loadAdditive = function (id) {
    const e = Scene.scenes[id];
    if (!e) return false;
    if (id === Scene.activeSceneId) return false;
    if (Scene.isAdditive(id)) return false;
    Scene._attachSceneObjects(e);
    Scene.additiveSceneIds.push(id);
    bus.emit('scene:additive-loaded', { id: id, name: e.name });
    bus.emit('scene:changed', { action: 'additive-load', id: id, name: e.name });
    Scene.renderTree();
    Scene.renderPage();
    return true;
  };

  Scene.unloadAdditive = function (id) {
    const i = Scene.additiveSceneIds.indexOf(id);
    if (i < 0) return false;
    const e = Scene.scenes[id];
    if (e) Scene._detachSceneObjects(e);
    Scene.additiveSceneIds.splice(i, 1);
    bus.emit('scene:additive-unloaded', { id: id, name: e ? e.name : '' });
    bus.emit('scene:changed', { action: 'additive-unload', id: id });
    Scene.renderTree();
    Scene.renderPage();
    return true;
  };

  Scene.toggleAdditive = function (id) {
    if (Scene.isAdditive(id)) return Scene.unloadAdditive(id);
    return Scene.loadAdditive(id);
  };

  /* Xoá toàn bộ scene khỏi bộ nhớ (dùng khi load project nhiều scene):
     detach khỏi viewport, dispose geometry primitive, reset map. */
  Scene._clearAllScenes = function () {
    Object.keys(Scene.scenes).forEach(function (id) {
      const entry = Scene.scenes[id];
      Scene._detachSceneObjects(entry);
      Object.keys(entry.registry).forEach(function (uuid) {
        const reg = entry.registry[uuid];
        const o = reg && reg.object3D;
        if (!o || reg.type !== 'primitive') return;
        o.traverse(function (c) { if (c.isMesh && c.geometry) c.geometry.dispose(); });
      });
    });
    Scene.scenes = {};
    Scene.activeSceneId = null;
    Scene.additiveSceneIds = [];
    Scene.registry = {};
    if (PixiStudio.State) PixiStudio.State.select(null);
  };

  /* ---------- REGISTER / UNREGISTER ---------- */
  /* Ghi vào registry của 1 scene cụ thể (mặc định: scene active). */
  Scene._registerInto = function (entry, object3D, type, name, parentId) {
    if (!object3D || !entry) return;
    entry.registry[object3D.uuid] = {
      object3D: object3D,
      type: type || 'object',      // model | light | camera | primitive | environment | effects
      name: name || object3D.name || 'Object',
      locked: false,
      parentId: parentId || null
    };
    if (!object3D.name) object3D.name = name || 'Object';
    if (object3D.userData) object3D.userData.sceneId = entry.id; /* đánh dấu object thuộc scene nào */
    bus.emit('scene:changed', { action: 'register', id: object3D.uuid });
  };

  Scene.register = function (object3D, type, name, parentId) {
    if (!object3D) return;
    Scene._registerInto(Scene._activeEntry(), object3D, type, name, parentId);
  };

  Scene.unregister = function (object3D) {
    if (!object3D) return;
    const found = Scene._findReg(object3D.uuid, true);
    if (found) delete found.entry.registry[object3D.uuid];
    else delete Scene.registry[object3D.uuid]; /* fallback: scene active */
    bus.emit('scene:changed', { action: 'unregister', id: object3D.uuid });
  };

  Scene.rename = function (object3D, newName) {
    const reg = Scene._findReg(object3D.uuid);
    if (!reg) return;
    reg.name = newName;
    object3D.name = newName;
    /* Undo/Redo toàn diện (v2): đổi tên cũng là 1 bước */
    if (PixiStudio.History) PixiStudio.History.push('Rename ' + newName);
    bus.emit('scene:changed', { action: 'rename', id: object3D.uuid, name: newName });
  };

  Scene.toggleLock = function (object3D) {
    const reg = Scene._findReg(object3D.uuid);
    if (!reg) return;
    reg.locked = !reg.locked;
    bus.emit('scene:changed', { action: 'lock', id: object3D.uuid, locked: reg.locked });
  };

  Scene.toggleVisible = function (object3D) {
    if (!object3D) return;
    object3D.visible = !object3D.visible;
    /* Undo/Redo toàn diện (v2): ẩn/hiện khôi phục qua snapshot visible */
    if (PixiStudio.History) PixiStudio.History.push((object3D.visible ? 'Show ' : 'Hide ') + (object3D.name || 'object'));
    bus.emit('scene:changed', { action: 'visible', id: object3D.uuid, visible: object3D.visible });
  };

  /* ---------- PRIMITIVE FACTORY (thật) ---------- */
  const PRIMITIVES = {
    box: function () { return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), Scene._defaultMat()); },
    sphere: function () { return new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 20), Scene._defaultMat()); },
    plane: function () {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), Scene._defaultMat());
      m.rotation.x = -Math.PI / 2;
      return m;
    },
    cylinder: function () { return new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 20), Scene._defaultMat()); },
    cone: function () { return new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.2, 20), Scene._defaultMat()); },
    torus: function () { return new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.18, 14, 30), Scene._defaultMat()); }
  };

  Scene._defaultMat = function () {
    return new THREE.MeshStandardMaterial({ color: 0x7a7a94, roughness: 0.55, metalness: 0.15 });
  };

  Scene.createPrimitive = function (kind) {
    if (!window.THREE || !PRIMITIVES[kind]) return null;
    const obj = PRIMITIVES[kind]();
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.userData.primKind = kind; /* serialize/restore đúng loại (trước đây sphere/box đều lưu thành 'box') */
    obj.name = kind.charAt(0).toUpperCase() + kind.slice(1) + '_' + (Scene._primCount[kind] = (Scene._primCount[kind] || 0) + 1);
    obj.position.set(U.random(-1.5, 1.5), kind === 'plane' ? 0.01 : 0.6, U.random(-1.5, 1.5));
    PixiStudio.Viewport.scene.add(obj);
    Scene.register(obj, 'primitive', obj.name);
    PixiStudio.History.push('Create ' + obj.name);
    PixiStudio.State.select(obj);
    bus.emit('scene:changed', { action: 'create', id: obj.uuid });
    return obj;
  };

  Scene._primCount = {};

  /* Primitive của các scene ĐANG HIỂN THỊ (active + additive) — để
     viewport picking chọn được cả object của scene phụ. */
  Scene.forEachPrimitive = function (fn) {
    Scene._loadedEntries().forEach(function (entry) {
      Object.keys(entry.registry).forEach(function (uuid) {
        const reg = entry.registry[uuid];
        if (reg.type === 'primitive' && reg.object3D.parent) fn(reg.object3D);
      });
    });
  };

  /* Nhân bản 1 object: thử clone() thật, lỗi (SkinnedMesh phức tạp,
     tham chiếu vòng trong userData) thì fallback an toàn: chỉ copy
     transform + geometry/material. Dùng chung cho duplicate() và
     duplicateScene(). */
  Scene._safeClone = function (object3D) {
    let clone = null;
    try {
      clone = object3D.clone();
    } catch (e) {
      clone = new THREE.Group();
      object3D.traverse(function (o) {
        if (!o.isMesh || !o.geometry) return;
        const m = new THREE.Mesh(o.geometry, Array.isArray(o.material) ? o.material[0] : o.material);
        m.name = o.name;
        const wp = new THREE.Vector3();
        o.getWorldPosition(wp);
        m.position.copy(wp);
        clone.add(m);
      });
      bus.emit('notify', { type: 'info', title: 'Duplicate', message: 'Nhân bản ở chế độ an toàn (giữ geometry + vị trí, bỏ rig).' });
    }
    return clone;
  };

  /* ---------- OPERATIONS ---------- */
  Scene.duplicate = function (object3D) {
    if (!object3D) return null;
    const clone = Scene._safeClone(object3D);
    if (!clone) return null;
    clone.name = (object3D.name || 'Object') + '_copy';
    clone.position.x += 0.8;
    PixiStudio.Viewport.scene.add(clone);
    Scene.register(clone, 'primitive', clone.name);
    PixiStudio.History.push('Duplicate ' + object3D.name);
    PixiStudio.State.select(clone);
    bus.emit('scene:changed', { action: 'duplicate' });
    return clone;
  };

  Scene.deleteObject = function (object3D) {
    if (!object3D) return;
    /* không cho xoá model chính? cho phép — remove cả khỏi model registry */
    const entry = object3D.userData && object3D.userData.modelEntry;
    if (entry && PixiStudio.Models.models[entry.id]) {
      PixiStudio.Models.remove(entry.id);
    } else {
      if (object3D.parent) object3D.parent.remove(object3D);
      Scene.unregister(object3D);
      /* dispose */
      object3D.traverse(function (o) {
        if (o.isMesh && o.geometry) o.geometry.dispose();
      });
    }
    PixiStudio.History.push('Delete ' + (object3D.name || 'object'));
    PixiStudio.State.select(null);
    bus.emit('scene:changed', { action: 'delete', name: object3D.name });
  };

  /* ---------- SERIALIZE cho save project ---------- */
  /* Serialize 1 scene (mặc định: scene active). Registry là nguồn
     truth: object còn trong registry là còn sống — kể cả khi nó đang
     detached (scene chưa mở), nên KHÔNG lọc theo o.parent nữa (lọc
     này làm serialize scene chưa mở trả về rỗng). */
  Scene.serializeObjects = function (sceneId) {
    const entry = sceneId ? Scene.scenes[sceneId] : Scene._activeEntry();
    const out = [];
    if (!entry) return out;
    Object.keys(entry.registry).forEach(function (uuid) {
      const reg = entry.registry[uuid];
      const o = reg.object3D;
      if (!o) return;
      out.push({
        uuid: uuid,
        name: reg.name,
        type: reg.type,
        locked: reg.locked,
        visible: o.visible,
        position: [o.position.x, o.position.y, o.position.z],
        rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
        scale: [o.scale.x, o.scale.y, o.scale.z],
        isPrimitive: reg.type === 'primitive',
        primKind: o.userData.primKind || (reg.type === 'primitive' ? 'box' : null),
        /* PREFAB (scene-prefab.js) + TEMPLATE (scene-templates.js): giữ đủ
           dữ liệu để applySerializedObjects khôi phục instance/template. */
        prefabId: o.userData.prefabId || null,
        prefabOverrides: o.userData.prefabOverrides || null,
        templateKind: o.userData.templateKind || null,
        templateSize: o.userData.templateSize || null,
        templateColor: o.userData.templateColor || null,
        templateLightType: o.userData.templateLightType || null,
        templateIntensity: o.userData.templateIntensity,
        templateRoofColor: o.userData.templateRoofColor || null
      });
    });
    return out;
  };

  Scene.serializeScene = function (id) {
    const e = id ? Scene.scenes[id] : Scene._activeEntry();
    if (!e) return null;
    return { id: e.id, name: e.name, objects: Scene.serializeObjects(e.id) };
  };

  /* Toàn bộ project nhiều scene (storage.serializeProject dùng). */
  Scene.serializeAllScenes = function () {
    Scene._activeEntry(); /* đảm bảo có ít nhất Main Scene */
    return {
      scenes: Object.keys(Scene.scenes).map(function (id) { return Scene.serializeScene(id); }),
      activeSceneId: Scene.activeSceneId,
      additiveSceneIds: Scene.additiveSceneIds.slice()
    };
  };

  Scene.applySerializedObjects = function (list, opts) {
    if (!list) return;
    /* opts: { sceneId (mặc định active), attach (mặc định true —
       false khi khôi phục scene chưa mở: object tạo ra nhưng không
       add vào viewport) }. Không tham số → hành vi cũ. */
    opts = opts || {};
    const entry = (opts.sceneId && Scene.scenes[opts.sceneId]) ? Scene.scenes[opts.sceneId] : Scene._activeEntry();
    const attach = opts.attach !== false;
    /* primitives khôi phục thật; model transform áp lên model hiện có */
    list.forEach(function (d) {
      /* PREFAB (scene-prefab.js): khôi phục instance từ định nghĩa prefab */
      if (d.type === 'prefab-instance' && d.prefabId && PixiStudio.Prefab) {
        const inst = PixiStudio.Prefab.instantiate(d.prefabId, {
          position: d.position, rotation: d.rotation, scale: d.scale,
          overrides: d.prefabOverrides || {}, name: d.name
        });
        if (inst) { const reg = entry.registry[inst.uuid]; if (reg) reg.name = d.name; }
        return;
      }
      /* TEMPLATE (scene-templates.js): rebuild object từ templateKind đã lưu */
      if (d.type === 'template' && d.templateKind && PixiStudio.SceneTemplates) {
        const spec = { kind: d.templateKind, name: d.name, pos: d.position, rot: d.rotation, scale: d.scale, color: d.templateColor, size: d.templateSize, lightType: d.templateLightType, intensity: d.templateIntensity, roofColor: d.templateRoofColor };
        const obj = PixiStudio.SceneTemplates.buildObject(spec);
        if (obj) {
          obj.visible = d.visible !== false;
          if (attach && Scene._viewportScene()) Scene._viewportScene().add(obj);
          Scene._registerInto(entry, obj, 'template', d.name);
        }
        return;
      }
      if (d.type === 'primitive' && d.isPrimitive) {
        const obj = Scene.createPrimitiveByName(d.primKind || 'box', attach, entry.id);
        if (obj) {
          obj.name = d.name;
          obj.visible = d.visible !== false;
          obj.position.fromArray(d.position);
          obj.rotation.fromArray(d.rotation);
          obj.scale.fromArray(d.scale);
          const reg = entry.registry[obj.uuid];
          if (reg) {
            reg.name = d.name;
            reg.locked = !!d.locked;
          }
        }
      }
    });
    bus.emit('scene:changed', { action: 'restore' });
  };

  /* Load toàn bộ project nhiều scene (storage.deserializeProject dùng
     khi data.scenes tồn tại): xoá các scene hiện tại, dựng lại đủ
     scene, mở scene active (+ load lại scene phụ nếu có). */
  Scene.loadSerializedScenes = function (payload) {
    if (!payload || !payload.scenes || !payload.scenes.length) return false;
    Scene._clearAllScenes();
    let activeId = payload.activeSceneId;
    let firstId = null;
    payload.scenes.forEach(function (sd) {
      const entry = Scene._createSceneEntry(sd.id || Scene._newSceneId(), sd.name || 'Scene');
      if (!firstId) firstId = entry.id;
      const isActive = sd.id === activeId;
      Scene.applySerializedObjects(sd.objects || [], { sceneId: entry.id, attach: isActive });
    });
    if (!activeId || !Scene.scenes[activeId]) activeId = firstId;
    Scene.activeSceneId = activeId;
    Scene.registry = Scene.scenes[activeId].registry;
    Scene._attachSceneObjects(Scene.scenes[activeId]);
    (payload.additiveSceneIds || []).forEach(function (id) {
      if (id !== activeId && Scene.scenes[id]) {
        Scene._attachSceneObjects(Scene.scenes[id]);
        Scene.additiveSceneIds.push(id);
      }
    });
    if (PixiStudio.State) PixiStudio.State.select(null);
    bus.emit('scene:switched', { from: null, to: activeId, name: Scene.scenes[activeId].name });
    bus.emit('scene:changed', { action: 'load-scenes' });
    Scene.renderTree();
    Scene.renderPage();
    return true;
  };

  Scene.createPrimitiveByName = function (kind, attach, sceneId) {
    if (!PRIMITIVES[kind]) return null;
    const obj = PRIMITIVES[kind]();
    obj.castShadow = true;
    obj.userData.primKind = kind;
    const entry = (sceneId && Scene.scenes[sceneId]) ? Scene.scenes[sceneId] : Scene._activeEntry();
    if (attach !== false && Scene._viewportScene()) Scene._viewportScene().add(obj);
    Scene._registerInto(entry, obj, 'primitive', obj.name);
    return obj;
  };

  /* ============================================================
     SCENE TREE UI (right panel tab Scene + page-scene)
     ============================================================ */
  Scene.renderTree = function (container) {
    const wrap = container || document.getElementById('scene-tree');
    if (!wrap) return;
    wrap.innerHTML = '';

    /* Root entry: Scene */
    const makeRow = function (iconName, label, depth, object3D, opts) {
      opts = opts || {};
      const selected = PixiStudio.State.get('selection') === object3D;
      const row = U.el('div', {
        class: 'tree-row' + (selected ? ' selected' : '') + (opts.locked ? ' locked' : ''),
        style: depth ? 'margin-left:' + (depth * 14) + 'px;' : '',
        draggable: object3D ? 'true' : 'false',
        onclick: function () {
          if (object3D) PixiStudio.State.select(object3D, { fromScene: true });
        },
        oncontextmenu: function (e) {
          e.preventDefault();
          bus.emit('ui:contextmenu', { x: e.clientX, y: e.clientY, zone: 'tree', target: object3D });
        }
      });

      row.appendChild(U.el('span', { class: 't-caret' + (opts.open ? ' open' : ''), text: opts.hasChildren ? '▶' : '' }));
      row.appendChild(U.el('span', { class: 't-icon', html: U.icon(iconName, 'ic-sm') }));
      row.appendChild(U.el('span', { class: 't-name', text: label }));

      if (object3D) {
        const actions = U.el('div', { class: 't-actions' });
        /* eye */
        actions.appendChild(U.el('button', {
          html: U.icon(object3D.visible ? 'eye' : 'eye-off', 'ic-sm'),
          class: object3D.visible ? '' : 'off-active',
          'data-tooltip': 'Show / Hide',
          onclick: function (e) { e.stopPropagation(); Scene.toggleVisible(object3D); Scene.renderTree(wrap); }
        }));
        /* lock */
        const reg = Scene._findReg(object3D.uuid); /* tìm cả scene phụ, không chỉ scene active */
        actions.appendChild(U.el('button', {
          html: U.icon(reg && reg.locked ? 'lock' : 'unlock', 'ic-sm'),
          onclick: function (e) { e.stopPropagation(); Scene.toggleLock(object3D); Scene.renderTree(wrap); }
        }));
        row.appendChild(actions);
      }

      if (object3D) {
        row.addEventListener('dragstart', function (e) {
          e.dataTransfer.setData('text/plain', object3D.uuid);
        });
        row.addEventListener('dragover', function (e) { e.preventDefault(); row.classList.add('drag-over'); });
        row.addEventListener('dragleave', function () { row.classList.remove('drag-over'); });
        row.addEventListener('drop', function (e) {
          e.preventDefault();
          row.classList.remove('drag-over');
          const srcUuid = e.dataTransfer.getData('text/plain');
          const src = Scene._findReg(srcUuid);
          if (src && src.object3D && src.object3D !== object3D) {
            /* re-parent primitive vào object khác */
            const o = src.object3D;
            if (o.parent) o.parent.remove(o);
            object3D.add(o);
            src.parentId = object3D.uuid;
            bus.emit('notify', { type: 'success', title: 'Re-parent', message: src.name + ' → child of ' + object3D.name });
            Scene.renderTree(wrap);
          }
        });
      }
      return row;
    };

    wrap.appendChild(makeRow('scene', 'Scene', 0, null));

    /* MULTI-SCENE: danh sách scene — click để chuyển scene, nút Add/Unload
       để load/gỡ scene phụ (additive). Scene active tô đậm + badge ACTIVE. */
    Scene.listScenes().forEach(function (s) {
      const srow = U.el('div', {
        class: 'tree-row' + (s.active ? ' selected' : ''),
        style: 'margin-left:14px;'
      });
      srow.appendChild(U.el('span', { class: 't-icon', html: U.icon('scene', 'ic-sm') }));
      srow.appendChild(U.el('span', { class: 't-name', text: s.name + ' (' + s.objectCount + ')' }));
      if (s.active) {
        srow.appendChild(U.el('span', { text: 'ACTIVE', style: 'margin-left:6px;font-size:9px;padding:1px 5px;border-radius:3px;background:#713BFF;color:#fff;' }));
      } else if (s.additive) {
        srow.appendChild(U.el('span', { text: 'ADD', style: 'margin-left:6px;font-size:9px;padding:1px 5px;border-radius:3px;background:#0e7a5f;color:#fff;' }));
      }
      if (!s.active) {
        const sacts = U.el('div', { class: 't-actions' });
        sacts.appendChild(U.el('button', {
          text: s.additive ? 'Unload' : 'Add',
          'data-tooltip': s.additive ? 'Gỡ scene phụ khỏi viewport' : 'Load thêm scene này cùng scene chính',
          onclick: function (e) { e.stopPropagation(); Scene.toggleAdditive(s.id); }
        }));
        srow.appendChild(sacts);
      }
      srow.addEventListener('click', function () { Scene.switchScene(s.id); });
      wrap.appendChild(srow);
    });

    /* Main Camera */
    if (PixiStudio.Viewport.orbit) {
      wrap.appendChild(makeRow('camera', 'Main Camera (Orbit)', 1, null));
    }

    /* Lights từ Lighting module */
    if (PixiStudio.Lighting && PixiStudio.Lighting.group) {
      PixiStudio.Lighting.group.children.forEach(function (light, i) {
        const isLight = light.isLight;
        if (!isLight) return;
        wrap.appendChild(makeRow('sun', light.name + (light.visible ? '' : ' (off)'), 1, null, { locked: !light.visible }));
      });
    }

    /* Models — chỉ model thuộc scene ĐANG LOAD (active + additive);
       model của scene chưa mở đã detach khỏi viewport nên ẩn khỏi cây. */
    Object.keys(PixiStudio.Models.models).forEach(function (id) {
      const entry = PixiStudio.Models.models[id];
      if (!entry.object3D || !Scene._loadedReg(entry.object3D.uuid)) return;
      const row = makeRow('character', entry.name, 1, entry.object3D);
      wrap.appendChild(row);
      /* children của model (body parts) */
      entry.object3D.children.slice(0, 8).forEach(function (child) {
        wrap.appendChild(makeRow('cube', child.name || 'Part', 2, null, { locked: true }));
      });
      if (entry.object3D.children.length > 8) {
        wrap.appendChild(U.el('div', { class: 'tree-row', style: 'margin-left:28px;color:var(--text-4);font-size:10px;', text: '… +' + (entry.object3D.children.length - 8) + ' parts' }));
      }
      /* skeleton visual nếu có */
      if (PixiStudio.Rig.current && PixiStudio.Rig.current.target === entry.object3D) {
        wrap.appendChild(makeRow('rig', 'Armature (' + Object.keys(PixiStudio.Rig.current.bones).length + ' bones)', 2, null, { locked: true }));
      }
    });

    /* Primitives — của các scene ĐANG LOAD; primitive thuộc scene phụ
       ghi rõ tên scene để phân biệt với scene chính. */
    Scene._loadedEntries().forEach(function (entry) {
      const isAdditive = entry.id !== Scene.activeSceneId;
      if (isAdditive) {
        wrap.appendChild(U.el('div', { class: 'tree-row', style: 'margin-left:14px;color:var(--text-4);font-size:10px;', text: '— scene phụ: ' + entry.name + ' —' }));
      }
      Object.keys(entry.registry).forEach(function (uuid) {
        const reg = entry.registry[uuid];
        if (reg.type !== 'primitive') return;
        if (!reg.object3D.parent) return;
        wrap.appendChild(makeRow('cube', reg.name + (isAdditive ? '  [' + entry.name + ']' : ''), 1, reg.object3D, { locked: reg.locked }));
      });
    });

    /* PREFAB instances + TEMPLATE objects (scene-prefab.js / scene-templates.js) */
    Scene._loadedEntries().forEach(function (entry) {
      Object.keys(entry.registry).forEach(function (uuid) {
        const reg = entry.registry[uuid];
        if (reg.type !== 'prefab-instance' && reg.type !== 'template') return;
        if (!reg.object3D.parent) return;
        wrap.appendChild(makeRow(reg.type === 'prefab-instance' ? 'cube' : 'scene', reg.name + (reg.type === 'prefab-instance' ? ' (prefab)' : ' (template)'), 1, reg.object3D, { locked: reg.locked }));
      });
    });

    /* Environment + Effects */
    wrap.appendChild(makeRow('env', 'Environment (Grid / Glow)', 1, null, { locked: true }));
    wrap.appendChild(makeRow('fx', 'Effects (PixiJS Particles)', 1, null, { locked: true }));
  };

  Scene.renderPage = function () {
    const body = document.getElementById('scene-page-body');
    if (!body) return;
    body.innerHTML = '';

    /* MULTI-SCENE: quản lý scene — danh sách + tạo/đổi tên/xóa/nhân bản/
       chuyển/additive. Đổi tên dùng Modals.prompt, fallback window.prompt. */
    const promptSceneName = function (current, onOk) {
      if (PixiStudio.Modals && PixiStudio.Modals.prompt) {
        PixiStudio.Modals.prompt({ title: 'Rename scene', label: 'Tên mới:', value: current, onOk: onOk });
      } else if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        const v = window.prompt('Tên scene mới:', current);
        if (v && v.trim()) onOk(v.trim());
      }
    };
    const scenesBlock = U.el('div', { class: 'page-block' }, [
      U.el('h4', { text: 'Scenes' })
    ]);
    Scene.listScenes().forEach(function (s) {
      const row = U.el('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:6px;' });
      const label = U.el('span', {
        text: s.name + '  (' + s.objectCount + ' object)' + (s.active ? '  ● ACTIVE' : '') + (s.additive ? '  + ADDITIVE' : ''),
        style: 'flex:1;font-size:12px;' + (s.active ? 'font-weight:700;' : '')
      });
      row.appendChild(label);
      const mkBtn = function (text, title, fn) {
        return U.el('button', { class: 'btn sm', text: text, title: title, onclick: fn });
      };
      if (!s.active) {
        row.appendChild(mkBtn('Mở', 'Chuyển sang scene này', function () { Scene.switchScene(s.id); }));
        row.appendChild(mkBtn(s.additive ? 'Gỡ phụ' : '+ Phụ', s.additive ? 'Gỡ scene phụ khỏi viewport' : 'Load thêm scene này cùng scene chính', function () { Scene.toggleAdditive(s.id); }));
      }
      row.appendChild(mkBtn('Đổi tên', 'Đổi tên scene', function () {
        promptSceneName(s.name, function (v) { Scene.renameScene(s.id, v); });
      }));
      row.appendChild(mkBtn('Nhân bản', 'Nhân bản toàn bộ scene', function () { Scene.duplicateScene(s.id); }));
      row.appendChild(mkBtn('Xoá', 'Xoá scene (không xoá được scene cuối cùng)', function () { Scene.deleteScene(s.id); }));
      scenesBlock.appendChild(row);
    });
    scenesBlock.appendChild(U.el('button', {
      class: 'btn sm', html: U.icon('plus') + ' New Scene',
      onclick: function () { Scene.createScene(); }
    }));
    body.appendChild(scenesBlock);

    /* Create object grid */
    const kinds = [['box', 'Box'], ['sphere', 'Sphere'], ['plane', 'Plane'], ['cylinder', 'Cylinder'], ['cone', 'Cone'], ['torus', 'Torus']];
    const grid = U.el('div', { class: 'mt-grid', style: 'grid-template-columns:repeat(3,1fr);' });
    kinds.forEach(function (k) {
      grid.appendChild(U.el('button', {
        class: 'mt-btn',
        html: U.icon('cube') + '<span>' + k[1] + '</span>',
        onclick: function () {
          Scene.createPrimitive(k[0]);
          Scene.renderPage();
        }
      }));
    });
    body.appendChild(U.el('div', { class: 'page-block' }, [
      U.el('h4', { text: 'Create Object' }),
      grid
    ]));

    /* Quick operations */
    const ops = U.el('div', { class: 'page-block' }, [
      U.el('h4', { text: 'Operations' }),
      U.el('div', { style: 'display:flex;flex-direction:column;gap:6px;' }, [
        U.el('button', { class: 'btn sm', html: U.icon('duplicate') + ' Duplicate selection (Ctrl+D)', onclick: function () { Scene.duplicate(PixiStudio.State.get('selection')); } }),
        U.el('button', { class: 'btn sm', html: U.icon('trash') + ' Delete selection (Del)', onclick: function () { Scene.deleteObject(PixiStudio.State.get('selection')); } }),
        U.el('button', { class: 'btn sm', html: U.icon('group') + ' Open Scene Hierarchy tab', onclick: function () { PixiStudio.Inspector.showTab('scene'); } })
      ])
    ]);
    body.appendChild(ops);

    /* Stats */
    const stats = U.el('div', { class: 'stat-grid' });
    const primCount = Scene._loadedEntries().reduce(function (n, entry) {
      return n + Object.keys(entry.registry).filter(function (u) { return entry.registry[u].type === 'primitive' && entry.registry[u].object3D.parent; }).length;
    }, 0);
    const modelCount = Object.keys(PixiStudio.Models.models).length;
    stats.appendChild(U.el('div', { class: 'stat-cell' }, [U.el('div', { class: 'sc-label', text: 'Scenes' }), U.el('div', { class: 'sc-value', text: String(Scene.listScenes().length) })]));
    stats.appendChild(U.el('div', { class: 'stat-cell' }, [U.el('div', { class: 'sc-label', text: 'Models' }), U.el('div', { class: 'sc-value', text: String(modelCount) })]));
    stats.appendChild(U.el('div', { class: 'stat-cell' }, [U.el('div', { class: 'sc-label', text: 'Primitives' }), U.el('div', { class: 'sc-value', text: String(primCount) })]));
    body.appendChild(stats);

    /* Lighting Bake + Occlusion Culling (vòng Prefab/Scene): panel riêng,
       guard khi module chưa load — không ảnh hưởng phần trên. */
    try { if (PixiStudio.LightBake) PixiStudio.LightBake.renderPanel(body); } catch (e) { /* panel bake lỗi: bỏ qua */ }
    try { if (PixiStudio.OcclusionCulling) PixiStudio.OcclusionCulling.renderPanel(body); } catch (e) { /* panel culling lỗi: bỏ qua */ }
  };

  window.PixiStudio.Scene = Scene;
})();
