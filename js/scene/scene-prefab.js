/* ============================================================
 * scene/scene-prefab.js — Prefab: lưu object + component thành
 * định nghĩa dùng chung, spawn nhiều instance, sửa prefab gốc
 * propagate tới mọi instance, override riêng từng instance
 * (override wins), prefab lồng nhau, thư viện prefab.
 *
 * Định dạng JSON versioned: { format: 'pixistudio-prefab-1', ... }
 * Lưu localStorage (key pixistudio.prefabs.v1) + xuất/nhập .json.
 *
 * Cơ chế override: mỗi instance giữ userData.prefabOverrides =
 * { "<path>": { material: {...}, transform: {...} } }, path là
 * chuỗi chỉ số con ("0/2" = con 0 → cháu 2). Khi prefab gốc đổi,
 * instance được rebuild lại từ định nghĩa rồi áp overrides lên
 * trên — nên override luôn thắng thay đổi từ gốc. Transform của
 * ROOT instance là vị trí đặt riêng (placement), KHÔNG bị gốc
 * ghi đè khi propagate.
 *
 * Tích hợp: Scene registry type 'prefab-instance' (serialize qua
 * scene-manager.js — xem khối PREFAB ở đó), nút "Save as Prefab…"
 * trong context menu (panels.js, có guard khi Prefab chưa load).
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const FORMAT = 'pixistudio-prefab-1';
  const LS_KEY = 'pixistudio.prefabs.v1';
  const MAX_NEST_DEPTH = 8;

  const Prefab = {
    FORMAT: FORMAT,
    library: [],          // [{format,id,name,createdAt,updatedAt,root}]
    instances: {},        // prefabId -> [instanceRoot, ...] (runtime)
    _byId: {}             // id -> def
  };

  /* ---------- helpers ---------- */
  function uid() {
    return 'pf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function vec3(v) { return [v.x, v.y, v.z]; }
  function num(n, d) { return (typeof n === 'number' && isFinite(n)) ? n : (d || 0); }

  function jsonSafeUserData(ud) {
    const out = {};
    if (!ud) return out;
    const skip = { modelEntry: 1, prefabInstanceId: 1, prefabId: 1, prefabOverrides: 1 };
    Object.keys(ud).forEach(function (k) {
      if (skip[k]) return;
      try {
        const v = ud[k];
        if (v === undefined || typeof v === 'function') return;
        out[k] = JSON.parse(JSON.stringify(v));
      } catch (e) { /* bỏ giá trị không JSON được */ }
    });
    return out;
  }

  /* Geometry params đủ để rebuild lại đúng loại primitive/model đơn giản.
     Model phức tạp (SkinnedMesh...) không rebuild được geometry → lưu
     modelRef + transform, lúc spawn sẽ clone từ model gốc (xem buildNode). */
  function captureGeometry(mesh) {
    const g = mesh.geometry;
    if (!g) return null;
    const p = g.parameters || {};
    const map = {
      BoxGeometry: ['width', 'height', 'depth'],
      SphereGeometry: ['radius', 'widthSegments', 'heightSegments'],
      PlaneGeometry: ['width', 'height'],
      CylinderGeometry: ['radiusTop', 'radiusBottom', 'height', 'radialSegments'],
      ConeGeometry: ['radius', 'height', 'radialSegments'],
      TorusGeometry: ['radius', 'tube', 'radialSegments', 'tubularSegments'],
      CircleGeometry: ['radius', 'segments'],
      RingGeometry: ['innerRadius', 'outerRadius', 'thetaSegments']
    };
    const keys = map[g.type];
    if (!keys) return { type: g.type, params: [], unsupported: true };
    return { type: g.type, params: keys.map(function (k) { return num(p[k], 1); }) };
  }

  function captureMaterial(mesh) {
    const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!m) return null;
    const out = {};
    if (m.color) out.color = '#' + m.color.getHexString();
    if (typeof m.roughness === 'number') out.roughness = m.roughness;
    if (typeof m.metalness === 'number') out.metalness = m.metalness;
    if (typeof m.transparent === 'boolean') out.transparent = m.transparent;
    if (typeof m.opacity === 'number') out.opacity = m.opacity;
    if (m.emissive) out.emissive = '#' + m.emissive.getHexString();
    if (typeof m.emissiveIntensity === 'number') out.emissiveIntensity = m.emissiveIntensity;
    return out;
  }

  function readPhysics(object3D) {
    try {
      const P = window.PixiStudio && PixiStudio.Physics;
      if (!P || !P.bodies || !P.bodies[object3D.uuid]) return null;
      const b = P.bodies[object3D.uuid];
      return {
        mass: num(b.mass, 1), gravity: !!b.gravity, friction: num(b.friction, 0.6),
        bounciness: num(b.bounciness, 0.3), collider: b.collider || 'box',
        colliderSize: Array.isArray(b.colliderSize) ? b.colliderSize.slice() : [1, 1, 1]
      };
    } catch (e) { return null; }
  }

  function readClips(object3D) {
    const ud = object3D.userData || {};
    const list = ud.animationClips || ud.clips || ud.clipNames;
    if (Array.isArray(list)) return list.filter(function (c) { return typeof c === 'string'; }).slice(0, 32);
    if (typeof ud.clipName === 'string') return [ud.clipName];
    return [];
  }

  /* ---------- CAPTURE ---------- */
  Prefab.captureNode = function (object3D) {
    if (!object3D) return null;
    const ud = object3D.userData || {};

    /* Prefab lồng nhau: node là instance của prefab khác → chỉ lưu tham chiếu */
    if (ud.prefabInstanceId && ud.prefabId) {
      return {
        kind: 'prefabRef', name: object3D.name || 'PrefabRef',
        prefabId: ud.prefabId,
        transform: { position: vec3(object3D.position), rotation: vec3(object3D.rotation), scale: vec3(object3D.scale) },
        overrides: clone(ud.prefabOverrides || {}),
        children: []
      };
    }

    const def = {
      kind: object3D.isMesh ? 'mesh' : (object3D.isLight ? 'light' : (object3D.isCamera ? 'camera' : 'group')),
      name: object3D.name || 'Object',
      transform: { position: vec3(object3D.position), rotation: vec3(object3D.rotation), scale: vec3(object3D.scale) },
      userData: jsonSafeUserData(ud),
      children: []
    };

    if (object3D.isMesh) {
      def.geometry = captureGeometry(object3D);
      def.material = captureMaterial(object3D);
      def.primKind = ud.primKind || null;
      /* Model đã import: giữ tham chiếu để spawn clone từ model gốc */
      if (ud.modelEntry && ud.modelEntry.id) def.modelRef = { id: ud.modelEntry.id, name: ud.modelEntry.name || '' };
      def.castShadow = !!object3D.castShadow;
      def.receiveShadow = !!object3D.receiveShadow;
    }
    if (object3D.isLight) {
      def.light = { type: object3D.type, color: object3D.color ? '#' + object3D.color.getHexString() : '#ffffff', intensity: num(object3D.intensity, 1) };
    }
    const phys = readPhysics(object3D);
    if (phys) def.physics = phys;
    const clips = readClips(object3D);
    if (clips.length) def.clips = clips;

    (object3D.children || []).forEach(function (child) {
      /* Bỏ qua helper/visual của viewport (skeleton, IK, trails...) */
      if (child.userData && child.userData.isBoneVisual) return;
      const cd = Prefab.captureNode(child);
      if (cd) def.children.push(cd);
    });
    return def;
  };

  /* ---------- BUILD ---------- */
  function buildGeometry(gdef) {
    if (!gdef || !window.THREE) return null;
    const T = window.THREE;
    const p = gdef.params || [];
    try {
      switch (gdef.type) {
        case 'BoxGeometry': return new T.BoxGeometry(p[0] || 1, p[1] || 1, p[2] || 1);
        case 'SphereGeometry': return new T.SphereGeometry(p[0] || 0.5, p[1] || 16, p[2] || 12);
        case 'PlaneGeometry': return new T.PlaneGeometry(p[0] || 1, p[1] || 1);
        case 'CylinderGeometry': return new T.CylinderGeometry(p[0] || 0.5, p[1] || 0.5, p[2] || 1, p[3] || 16);
        case 'ConeGeometry': return new T.ConeGeometry(p[0] || 0.5, p[1] || 1, p[2] || 16);
        case 'TorusGeometry': return new T.TorusGeometry(p[0] || 0.5, p[1] || 0.18, p[2] || 12, p[3] || 24);
        case 'CircleGeometry': return new T.CircleGeometry(p[0] || 0.5, p[1] || 24);
        case 'RingGeometry': return new T.RingGeometry(p[0] || 0.4, p[1] || 0.5, p[2] || 24);
        default: return new T.BoxGeometry(1, 1, 1);
      }
    } catch (e) { return new T.BoxGeometry(1, 1, 1); }
  }

  function buildMaterial(mdef) {
    if (!window.THREE) return null;
    const T = window.THREE;
    const m = new T.MeshStandardMaterial({ color: 0x7a7a94, roughness: 0.55, metalness: 0.15 });
    if (mdef) {
      if (mdef.color) m.color.set(mdef.color);
      if (typeof mdef.roughness === 'number') m.roughness = mdef.roughness;
      if (typeof mdef.metalness === 'number') m.metalness = mdef.metalness;
      if (typeof mdef.transparent === 'boolean') m.transparent = mdef.transparent;
      if (typeof mdef.opacity === 'number') m.opacity = mdef.opacity;
      if (mdef.emissive) m.emissive.set(mdef.emissive);
      if (typeof mdef.emissiveIntensity === 'number') m.emissiveIntensity = mdef.emissiveIntensity;
    }
    return m;
  }

  function applyTransform(obj, t) {
    if (!t) return;
    if (t.position) obj.position.fromArray(t.position);
    if (t.rotation) obj.rotation.fromArray(t.rotation);
    if (t.scale) obj.scale.fromArray(t.scale);
  }

  function applyMaterialPatch(mesh, mdef) {
    if (!mesh || !mesh.material || !mdef) return;
    const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!m) return;
    if (mdef.color && m.color) m.color.set(mdef.color);
    if (typeof mdef.roughness === 'number') m.roughness = mdef.roughness;
    if (typeof mdef.metalness === 'number') m.metalness = mdef.metalness;
    if (typeof mdef.transparent === 'boolean') m.transparent = mdef.transparent;
    if (typeof mdef.opacity === 'number') m.opacity = mdef.opacity;
    if (mdef.emissive && m.emissive) m.emissive.set(mdef.emissive);
    if (typeof mdef.emissiveIntensity === 'number') m.emissiveIntensity = mdef.emissiveIntensity;
  }

  Prefab.buildNode = function (def, depth) {
    depth = depth || 0;
    if (!def || !window.THREE) return null;
    const T = window.THREE;

    /* Nested prefab: spawn instance của prefab con (đệ quy, có giới hạn sâu) */
    if (def.kind === 'prefabRef') {
      if (depth >= MAX_NEST_DEPTH) return new T.Group();
      const child = Prefab.instantiate(def.prefabId, { silent: true, _nested: true, _depth: depth + 1 });
      if (!child) { const g = new T.Group(); g.name = (def.name || 'MissingPrefab') + ' (missing)'; return g; }
      applyTransform(child, def.transform);
      if (def.overrides) { child.userData.prefabOverrides = clone(def.overrides); Prefab.applyOverrides(child); }
      return child;
    }

    let obj;
    if (def.kind === 'mesh') {
      /* Model đã import: clone từ model gốc nếu còn trong Models registry */
      if (def.modelRef && PixiStudio.Models && PixiStudio.Models.models && PixiStudio.Models.models[def.modelRef.id]) {
        try {
          obj = PixiStudio.Models.models[def.modelRef.id].object3D.clone();
          obj.name = def.name;
        } catch (e) { obj = null; }
      }
      if (!obj) {
        obj = new T.Mesh(buildGeometry(def.geometry), buildMaterial(def.material));
        obj.name = def.name;
        obj.castShadow = !!def.castShadow;
        obj.receiveShadow = !!def.receiveShadow;
      }
      if (def.primKind) obj.userData.primKind = def.primKind;
    } else if (def.kind === 'light' && def.light) {
      const L = def.light;
      if (L.type === 'DirectionalLight') obj = new T.DirectionalLight(L.color, L.intensity);
      else if (L.type === 'PointLight') obj = new T.PointLight(L.color, L.intensity);
      else if (L.type === 'AmbientLight') obj = new T.AmbientLight(L.color, L.intensity);
      else obj = new T.PointLight(L.color, L.intensity);
      obj.name = def.name;
    } else if (def.kind === 'camera') {
      obj = new T.PerspectiveCamera(55, 1, 0.1, 1000);
      obj.name = def.name;
    } else {
      obj = new T.Group();
      obj.name = def.name;
    }

    applyTransform(obj, def.transform);
    if (def.userData) {
      Object.keys(def.userData).forEach(function (k) { obj.userData[k] = clone(def.userData[k]); });
    }
    if (def.clips) obj.userData.animationClips = def.clips.slice();
    if (def.physics) obj.userData.prefabPhysics = clone(def.physics);
    (def.children || []).forEach(function (cd) {
      const c = Prefab.buildNode(cd, depth);
      if (c) obj.add(c);
    });
    return obj;
  };

  /* ---------- LIBRARY CRUD ---------- */
  Prefab.createFromObject = function (object3D, name) {
    if (!object3D) return null;
    const root = Prefab.captureNode(object3D);
    if (!root) return null;
    const def = {
      format: FORMAT, id: uid(),
      name: name || (object3D.name ? object3D.name + '_Prefab' : 'Prefab'),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      root: root
    };
    Prefab.library.push(def);
    Prefab._byId[def.id] = def;
    Prefab.saveLibrary();
    bus.emit('prefab:created', { id: def.id, name: def.name });
    bus.emit('notify', { type: 'success', title: 'Prefab', message: 'Đã lưu prefab "' + def.name + '"' });
    return def;
  };

  Prefab.createFromObjectInteractive = function (object3D) {
    if (!object3D) return null;
    if (PixiStudio.Modals && PixiStudio.Modals.prompt) {
      PixiStudio.Modals.prompt({
        title: 'Save as Prefab', label: 'Tên prefab:',
        value: (object3D.name || 'Object') + '_Prefab',
        onOk: function (v) { if (v && v.trim()) Prefab.createFromObject(object3D, v.trim()); }
      });
      return 'prompt';
    }
    return Prefab.createFromObject(object3D);
  };

  Prefab.get = function (id) { return Prefab._byId[id] || null; };
  Prefab.list = function () { return Prefab.library.slice(); };

  Prefab.rename = function (id, newName) {
    const d = Prefab.get(id);
    if (!d || !newName || !newName.trim()) return false;
    d.name = newName.trim();
    d.updatedAt = new Date().toISOString();
    Prefab.saveLibrary();
    bus.emit('prefab:renamed', { id: id, name: d.name });
    return true;
  };

  Prefab.duplicate = function (id) {
    const d = Prefab.get(id);
    if (!d) return null;
    const copy = clone(d);
    copy.id = uid();
    copy.name = d.name + '_copy';
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    Prefab.library.push(copy);
    Prefab._byId[copy.id] = copy;
    Prefab.saveLibrary();
    bus.emit('prefab:duplicated', { id: copy.id, name: copy.name });
    return copy;
  };

  Prefab.remove = function (id) {
    const d = Prefab.get(id);
    if (!d) return false;
    Prefab.library = Prefab.library.filter(function (x) { return x.id !== id; });
    delete Prefab._byId[id];
    /* instance đang chạy vẫn ở lại scene (đã là object độc lập) */
    Prefab.saveLibrary();
    bus.emit('prefab:removed', { id: id });
    return true;
  };

  Prefab.instanceCount = function (id) {
    return (Prefab.instances[id] || []).filter(function (o) { return o.parent; }).length;
  };

  /* ---------- SPAWN / PROPAGATE / OVERRIDE ---------- */
  Prefab.instantiate = function (id, opts) {
    opts = opts || {};
    const def = typeof id === 'object' ? id : Prefab.get(id);
    if (!def || !def.root) return null;
    if (!PixiStudio.Viewport || !PixiStudio.Viewport.scene) return null;
    const root = Prefab.buildNode(def.root, opts._depth || 0);
    if (!root) return null;
    root.userData.prefabId = def.id;
    root.userData.prefabInstanceId = uid();
    root.userData.prefabOverrides = clone(opts.overrides || {});
    /* Root transform = placement riêng của instance (không lấy từ def) */
    if (opts.position) root.position.fromArray(opts.position);
    else if (!opts.silent) root.position.set(0, 0, 0);
    if (opts.rotation) root.rotation.fromArray(opts.rotation);
    if (opts.scale) root.scale.fromArray(opts.scale);
    if (opts.name) root.name = opts.name;
    if (!opts._nested) PixiStudio.Viewport.scene.add(root);
    if (PixiStudio.Scene && !opts._nested) PixiStudio.Scene.register(root, 'prefab-instance', root.name);
    if (opts.overrides) Prefab.applyOverrides(root);
    (Prefab.instances[def.id] = Prefab.instances[def.id] || []).push(root);
    if (!opts.silent) {
      if (PixiStudio.History) PixiStudio.History.push('Spawn prefab ' + def.name);
      if (PixiStudio.State) PixiStudio.State.select(root);
      bus.emit('prefab:spawned', { prefabId: def.id, instanceId: root.userData.prefabInstanceId });
      bus.emit('scene:changed', { action: 'prefab-spawn', id: root.uuid });
    }
    return root;
  };

  /* Tìm node trong instance theo path chỉ số ("0/2") */
  Prefab.nodeByPath = function (root, path) {
    if (!path) return root;
    let node = root;
    const parts = String(path).split('/').filter(function (s) { return s !== ''; });
    for (let i = 0; i < parts.length; i++) {
      const idx = parseInt(parts[i], 10);
      if (isNaN(idx) || !node.children || !node.children[idx]) return null;
      node = node.children[idx];
    }
    return node;
  };

  /* Path của 1 node con tính từ root instance */
  Prefab.pathOf = function (root, target) {
    if (target === root) return '';
    const path = [];
    let node = target;
    while (node && node !== root) {
      const parent = node.parent;
      if (!parent) return null;
      path.unshift(String(parent.children.indexOf(node)));
      node = parent;
    }
    return node === root ? path.join('/') : null;
  };

  Prefab.applyOverrides = function (root) {
    const ov = (root.userData && root.userData.prefabOverrides) || {};
    Object.keys(ov).forEach(function (path) {
      const node = Prefab.nodeByPath(root, path);
      if (!node) return;
      const patch = ov[path];
      if (patch.material && node.isMesh) applyMaterialPatch(node, patch.material);
      if (patch.transform) applyTransform(node, patch.transform);
      if (patch.visible !== undefined) node.visible = !!patch.visible;
    });
  };

  /* Đặt override riêng cho 1 node trong instance (override wins khi propagate) */
  Prefab.setOverride = function (instanceRoot, targetOrPath, patch) {
    if (!instanceRoot || !patch) return false;
    const path = typeof targetOrPath === 'string' ? targetOrPath : Prefab.pathOf(instanceRoot, targetOrPath);
    if (path === null || path === undefined) return false;
    instanceRoot.userData.prefabOverrides = instanceRoot.userData.prefabOverrides || {};
    const cur = instanceRoot.userData.prefabOverrides[path] || {};
    if (patch.material) cur.material = Object.assign({}, cur.material || {}, patch.material);
    if (patch.transform) cur.transform = Object.assign({}, cur.transform || {}, patch.transform);
    if (patch.visible !== undefined) cur.visible = patch.visible;
    instanceRoot.userData.prefabOverrides[path] = cur;
    const node = Prefab.nodeByPath(instanceRoot, path);
    if (node) {
      if (patch.material && node.isMesh) applyMaterialPatch(node, patch.material);
      if (patch.transform) applyTransform(node, patch.transform);
      if (patch.visible !== undefined) node.visible = !!patch.visible;
    }
    bus.emit('prefab:override', { instanceId: instanceRoot.userData.prefabInstanceId, path: path });
    return true;
  };

  Prefab.clearOverride = function (instanceRoot, path) {
    if (!instanceRoot || !instanceRoot.userData.prefabOverrides) return false;
    if (path === undefined) { instanceRoot.userData.prefabOverrides = {}; }
    else delete instanceRoot.userData.prefabOverrides[path];
    Prefab.propagate(instanceRoot.userData.prefabId);
    return true;
  };

  Prefab.getOverrides = function (instanceRoot) {
    return clone((instanceRoot && instanceRoot.userData && instanceRoot.userData.prefabOverrides) || {});
  };

  /* Sửa prefab gốc (mutator nhận deep-clone của root def) rồi propagate */
  Prefab.editDefinition = function (id, mutator) {
    const def = Prefab.get(id);
    if (!def || typeof mutator !== 'function') return false;
    const rootCopy = clone(def.root);
    mutator(rootCopy);
    def.root = rootCopy;
    def.updatedAt = new Date().toISOString();
    Prefab.saveLibrary();
    Prefab.propagate(id);
    bus.emit('prefab:updated', { id: id, name: def.name });
    return true;
  };

  /* Ghi đè định nghĩa gốc bằng object đang chọn (vd sau khi sửa 1 instance) */
  Prefab.updateFromObject = function (id, object3D) {
    const def = Prefab.get(id);
    if (!def || !object3D) return false;
    const root = Prefab.captureNode(object3D);
    if (!root) return false;
    def.root = root;
    def.updatedAt = new Date().toISOString();
    Prefab.saveLibrary();
    Prefab.propagate(id);
    bus.emit('prefab:updated', { id: id, name: def.name });
    return true;
  };

  /* Rebuild mọi instance từ định nghĩa mới, giữ placement + overrides */
  Prefab.propagate = function (id) {
    const def = Prefab.get(id);
    if (!def) return 0;
    const list = (Prefab.instances[id] || []).filter(function (o) { return o.parent; });
    let count = 0;
    list.forEach(function (root) {
      const placement = { position: vec3(root.position), rotation: vec3(root.rotation), scale: vec3(root.scale) };
      const overrides = clone(root.userData.prefabOverrides || {});
      const name = root.name;
      /* tháo children cũ (dispose geometry/material do prefab tạo) */
      while (root.children.length) {
        const c = root.children[0];
        root.remove(c);
        c.traverse(function (o) {
          if (o.isMesh) { if (o.geometry) o.geometry.dispose(); }
        });
      }
      const fresh = Prefab.buildNode(def.root, 0);
      if (!fresh) return;
      /* Root là mesh/light: nội dung nằm ở CHÍNH root (không phải children)
         → swap geometry/material/light tại chỗ; root là group: gắn children mới. */
      if (fresh.isMesh && root.isMesh) {
        if (root.geometry && root.geometry !== fresh.geometry) root.geometry.dispose();
        root.geometry = fresh.geometry;
        root.material = fresh.material;
        root.castShadow = fresh.castShadow;
        root.receiveShadow = fresh.receiveShadow;
      } else if (fresh.isLight && root.isLight) {
        if (root.color && fresh.color) root.color.copy(fresh.color);
        root.intensity = fresh.intensity;
      }
      /* buildNode trả về root mới — lấy children của nó gắn vào instance cũ */
      while (fresh.children.length) root.add(fresh.children[0]);
      if (fresh.userData) {
        Object.keys(fresh.userData).forEach(function (k) {
          if (k !== 'prefabId' && k !== 'prefabInstanceId' && k !== 'prefabOverrides') root.userData[k] = fresh.userData[k];
        });
      }
      root.position.fromArray(placement.position);
      root.rotation.fromArray(placement.rotation);
      root.scale.fromArray(placement.scale);
      root.name = name;
      root.userData.prefabOverrides = overrides;
      Prefab.applyOverrides(root);
      count++;
    });
    bus.emit('prefab:propagated', { id: id, count: count });
    bus.emit('scene:changed', { action: 'prefab-propagate', id: id });
    return count;
  };

  /* ---------- SERIALIZE / FILE / STORAGE ---------- */
  Prefab.toJSON = function (def) { return clone(def); };

  Prefab.fromJSON = function (data) {
    if (!data || data.format !== FORMAT || !data.root || !data.id) return null;
    const def = clone(data);
    if (Prefab.get(def.id)) def.id = uid(); /* tránh trùng id */
    def.updatedAt = new Date().toISOString();
    Prefab.library.push(def);
    Prefab._byId[def.id] = def;
    Prefab.saveLibrary();
    bus.emit('prefab:imported', { id: def.id, name: def.name });
    return def;
  };

  Prefab.exportFile = function (id) {
    const def = Prefab.get(id);
    if (!def) return false;
    if (U.downloadText) U.downloadText(JSON.stringify(def, null, 2), (def.name || 'prefab') + '.prefab.json', 'application/json');
    return true;
  };

  Prefab.importFile = function (file) {
    const read = U.readFileAsText
      ? U.readFileAsText(file)
      : new Promise(function (res, rej) {
          const r = new FileReader();
          r.onload = function () { res(r.result); };
          r.onerror = rej;
          r.readAsText(file);
        });
    return read.then(function (text) {
      let data;
      try { data = JSON.parse(text); } catch (e) { return null; }
      return Prefab.fromJSON(data);
    });
  };

  Prefab.saveLibrary = function () {
    try { localStorage.setItem(LS_KEY, JSON.stringify(Prefab.library)); return true; }
    catch (e) { return false; }
  };

  Prefab.loadLibrary = function () {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return 0;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return 0;
      Prefab.library = [];
      Prefab._byId = {};
      arr.forEach(function (d) {
        if (d && d.format === FORMAT && d.id && d.root) {
          Prefab.library.push(d);
          Prefab._byId[d.id] = d;
        }
      });
      return Prefab.library.length;
    } catch (e) { return 0; }
  };

  /* ---------- PANEL UI ---------- */
  Prefab.renderPanel = function (container) {
    const wrap = container || document.getElementById('prefab-panel-body');
    if (!wrap || !U.el) return null;
    wrap.innerHTML = '';
    const list = Prefab.list();
    if (!list.length) {
      wrap.appendChild(U.el('div', { class: 'muted', style: 'font-size:12px;padding:6px 2px;', text: 'Chưa có prefab nào. Chọn 1 object rồi chuột phải → "Save as Prefab…" để tạo.' }));
    }
    list.forEach(function (def) {
      const row = U.el('div', {
        class: 'prefab-row',
        draggable: 'true',
        style: 'display:flex;align-items:center;gap:8px;padding:6px;border:1px solid var(--border, #333);border-radius:8px;margin-bottom:6px;'
      });
      row.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('application/x-pixistudio-prefab', def.id);
        e.dataTransfer.setData('text/plain', def.id);
      });
      row.appendChild(U.el('span', { html: U.icon ? U.icon('cube') : '▣', style: 'font-size:16px;' }));
      const info = U.el('div', { style: 'flex:1;min-width:0;' }, [
        U.el('div', { text: def.name, style: 'font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }),
        U.el('div', { text: '×' + Prefab.instanceCount(def.id) + ' instance · ' + (def.root.children ? def.root.children.length : 0) + ' node con', style: 'font-size:11px;opacity:0.7;' })
      ]);
      row.appendChild(info);
      const mkBtn = function (label, title, fn) {
        return U.el('button', { class: 'btn sm', text: label, title: title, onclick: function (e) { e.stopPropagation(); fn(); Prefab.renderPanel(wrap); } });
      };
      row.appendChild(mkBtn('Spawn', 'Tạo instance vào scene', function () { Prefab.instantiate(def.id); }));
      row.appendChild(mkBtn('⧉', 'Nhân bản prefab', function () { Prefab.duplicate(def.id); }));
      row.appendChild(mkBtn('✎', 'Đổi tên', function () {
        if (PixiStudio.Modals) PixiStudio.Modals.prompt({ title: 'Rename Prefab', label: 'Tên mới:', value: def.name, onOk: function (v) { if (v.trim()) Prefab.rename(def.id, v.trim()); Prefab.renderPanel(wrap); } });
      }));
      row.appendChild(mkBtn('↓', 'Xuất file .json', function () { Prefab.exportFile(def.id); }));
      row.appendChild(mkBtn('✕', 'Xoá prefab', function () { Prefab.remove(def.id); }));
      wrap.appendChild(row);
    });
    /* Import */
    const imp = U.el('div', { style: 'display:flex;gap:6px;margin-top:4px;' }, [
      U.el('button', {
        class: 'btn sm', text: 'Import prefab (.json)',
        onclick: function () {
          const input = document.createElement('input');
          input.type = 'file'; input.accept = '.json,application/json';
          input.onchange = function () { if (input.files[0]) Prefab.importFile(input.files[0]).then(function () { Prefab.renderPanel(wrap); }); };
          input.click();
        }
      })
    ]);
    wrap.appendChild(imp);
    return wrap;
  };

  /* Gắn section Prefab vào Scene page (#scene-page-body). renderPage của
     scene-manager wipe body mỗi lần mở nên re-attach khi scene:changed. */
  Prefab.attachToScenePage = function () {
    const body = document.getElementById('scene-page-body');
    if (!body || !U.el || document.getElementById('prefab-page-section')) return false;
    const section = U.el('div', { class: 'page-block', id: 'prefab-page-section' }, [
      U.el('h4', { text: 'Prefabs' }),
      U.el('div', { id: 'prefab-panel-body' })
    ]);
    body.appendChild(section);
    Prefab.renderPanel(section.querySelector('#prefab-panel-body'));
    return true;
  };

  /* Thumbnail: dùng Asset Library nếu có API công khai, không thì null
     (panel dùng icon + tên). Không sửa asset-library. */
  Prefab.thumbnailFor = function (def) {
    try {
      const AL = PixiStudio.AssetLibrary;
      if (AL && typeof AL.generateThumbnail === 'function' && def && def.root) return null; /* prefab chưa phải asset — không ép API */
    } catch (e) { /* ignore */ }
    return null;
  };

  Prefab.loadLibrary();
  if (bus && bus.on) {
    bus.on('scene:changed', function () { Prefab.attachToScenePage(); });
  }

  window.PixiStudio.Prefab = Prefab;
})();
