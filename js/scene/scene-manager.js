/* ============================================================
 * scene/scene-manager.js — Hierarchy registry, CRUD object,
 * re-parent, serialize cho save project, scene tree UI.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Scene = {
    registry: {},        // uuid -> { object3D, type, name, locked, parentId }
    root: null
  };

  /* ---------- REGISTER / UNREGISTER ---------- */
  Scene.register = function (object3D, type, name, parentId) {
    if (!object3D) return;
    Scene.registry[object3D.uuid] = {
      object3D: object3D,
      type: type || 'object',      // model | light | camera | primitive | environment | effects
      name: name || object3D.name || 'Object',
      locked: false,
      parentId: parentId || null
    };
    if (!object3D.name) object3D.name = name || 'Object';
    bus.emit('scene:changed', { action: 'register', id: object3D.uuid });
  };

  Scene.unregister = function (object3D) {
    if (!object3D) return;
    delete Scene.registry[object3D.uuid];
    bus.emit('scene:changed', { action: 'unregister', id: object3D.uuid });
  };

  Scene.rename = function (object3D, newName) {
    const reg = Scene.registry[object3D.uuid];
    if (!reg) return;
    reg.name = newName;
    object3D.name = newName;
    bus.emit('scene:changed', { action: 'rename', id: object3D.uuid, name: newName });
  };

  Scene.toggleLock = function (object3D) {
    const reg = Scene.registry[object3D.uuid];
    if (!reg) return;
    reg.locked = !reg.locked;
    bus.emit('scene:changed', { action: 'lock', id: object3D.uuid, locked: reg.locked });
  };

  Scene.toggleVisible = function (object3D) {
    object3D.visible = !object3D.visible;
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

  Scene.forEachPrimitive = function (fn) {
    Object.keys(Scene.registry).forEach(function (uuid) {
      const reg = Scene.registry[uuid];
      if (reg.type === 'primitive' && reg.object3D.parent) fn(reg.object3D);
    });
  };

  /* ---------- OPERATIONS ---------- */
  Scene.duplicate = function (object3D) {
    if (!object3D) return null;
    let clone = null;
    try {
      clone = object3D.clone();
    } catch (e) {
      /* model có tham chiếu vòng trong userData, hoặc SkinnedMesh phức tạp →
         nhân bản theo cách an toàn: chỉ copy transform + geometry/material. */
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
  Scene.serializeObjects = function () {
    const out = [];
    Object.keys(Scene.registry).forEach(function (uuid) {
      const reg = Scene.registry[uuid];
      const o = reg.object3D;
      if (!o.parent) return; /* đã bị xoá khỏi scene */
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
        primKind: o.userData.primKind || (reg.type === 'primitive' ? 'box' : null)
      });
    });
    return out;
  };

  Scene.applySerializedObjects = function (list) {
    if (!list) return;
    /* primitives khôi phục thật; model transform áp lên model hiện có */
    list.forEach(function (d) {
      if (d.type === 'primitive' && d.isPrimitive) {
        const obj = Scene.createPrimitiveByName(d.primKind || 'box');
        if (obj) {
          obj.name = d.name;
          obj.visible = d.visible !== false;
          obj.position.fromArray(d.position);
          obj.rotation.fromArray(d.rotation);
          obj.scale.fromArray(d.scale);
          const reg = Scene.registry[obj.uuid];
          if (reg) reg.name = d.name;
        }
      }
    });
    bus.emit('scene:changed', { action: 'restore' });
  };

  Scene.createPrimitiveByName = function (kind) {
    if (!PRIMITIVES[kind]) return null;
    const obj = PRIMITIVES[kind]();
    obj.castShadow = true;
    obj.userData.primKind = kind;
    PixiStudio.Viewport.scene.add(obj);
    Scene.register(obj, 'primitive', obj.name);
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
        const reg = Scene.registry[object3D.uuid];
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
          const src = Scene.registry[srcUuid];
          if (src && src.object3D && src.object3D !== object3D) {
            /* re-parent primitive vào object khác */
            const o = src.object3D;
            if (o.parent) o.parent.remove(o);
            object3D.add(o);
            Scene.registry[srcUuid].parentId = object3D.uuid;
            bus.emit('notify', { type: 'success', title: 'Re-parent', message: src.name + ' → child of ' + object3D.name });
            Scene.renderTree(wrap);
          }
        });
      }
      return row;
    };

    wrap.appendChild(makeRow('scene', 'Scene', 0, null));

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

    /* Models */
    Object.keys(PixiStudio.Models.models).forEach(function (id) {
      const entry = PixiStudio.Models.models[id];
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

    /* Primitives */
    Object.keys(Scene.registry).forEach(function (uuid) {
      const reg = Scene.registry[uuid];
      if (reg.type !== 'primitive') return;
      if (!reg.object3D.parent) return;
      wrap.appendChild(makeRow('cube', reg.name, 1, reg.object3D, { locked: reg.locked }));
    });

    /* Environment + Effects */
    wrap.appendChild(makeRow('env', 'Environment (Grid / Glow)', 1, null, { locked: true }));
    wrap.appendChild(makeRow('fx', 'Effects (PixiJS Particles)', 1, null, { locked: true }));
  };

  Scene.renderPage = function () {
    const body = document.getElementById('scene-page-body');
    if (!body) return;
    body.innerHTML = '';

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
    const primCount = Object.keys(Scene.registry).filter(function (u) { return Scene.registry[u].type === 'primitive' && Scene.registry[u].object3D.parent; }).length;
    const modelCount = Object.keys(PixiStudio.Models.models).length;
    stats.appendChild(U.el('div', { class: 'stat-cell' }, [U.el('div', { class: 'sc-label', text: 'Models' }), U.el('div', { class: 'sc-value', text: String(modelCount) })]));
    stats.appendChild(U.el('div', { class: 'stat-cell' }, [U.el('div', { class: 'sc-label', text: 'Primitives' }), U.el('div', { class: 'sc-value', text: String(primCount) })]));
    body.appendChild(stats);
  };

  window.PixiStudio.Scene = Scene;
})();
