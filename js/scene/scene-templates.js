/* ============================================================
 * scene/scene-templates.js — Scene template dạng DỮ LIỆU (JSON):
 * mỗi template là 1 object mô tả danh sách object + camera preset,
 * không hard-code rời rạc — thêm template mới chỉ cần thêm 1 entry
 * vào TEMPLATES. 3 template có sẵn: Platformer / RPG / FPS.
 *
 * Object spec: { kind, name, pos:[x,y,z], rot, size/scale, color,
 *   lightType, intensity, ... } — kind được build bởi buildObject()
 * (dùng THREE trực tiếp, không qua Scene.createPrimitive để tránh
 * vị trí random + History thừa; đăng ký vào Scene registry type
 * 'template' để serialize project khôi phục được — xem khối
 * TEMPLATE trong scene-manager.js).
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const TEMPLATES = {
    platformer: {
      key: 'platformer', name: 'Platformer', icon: 'game',
      desc: 'Sàn đất + 5 platform bậc thang + nhân vật mẫu + camera follow.',
      camera: { position: [0, 5.5, 11], lookAt: [0, 1.5, 0] },
      objects: [
        { kind: 'ground', name: 'Ground', pos: [0, 0, 0], size: [24, 1, 10], color: '#6a8f5a' },
        { kind: 'platform', name: 'Platform_1', pos: [-7, 1, 0], size: [4, 0.6, 3], color: '#8a6f4d' },
        { kind: 'platform', name: 'Platform_2', pos: [-3.5, 2, 0], size: [4, 0.6, 3], color: '#8a6f4d' },
        { kind: 'platform', name: 'Platform_3', pos: [0, 3, 0], size: [4, 0.6, 3], color: '#8a6f4d' },
        { kind: 'platform', name: 'Platform_4', pos: [3.5, 4, 0], size: [4, 0.6, 3], color: '#8a6f4d' },
        { kind: 'platform', name: 'Platform_5', pos: [7, 5, 0], size: [4, 0.6, 3], color: '#c9a227' },
        { kind: 'player', name: 'Player', pos: [-7, 2.5, 0], color: '#3b82f6' },
        { kind: 'light', lightType: 'directional', name: 'Sun', pos: [6, 12, 6], color: '#fff2d9', intensity: 1.1 }
      ]
    },
    rpg: {
      key: 'rpg', name: 'RPG Village', icon: 'home',
      desc: 'Mặt đất + 3 nhà + 3 cây + 2 NPC + đèn, camera góc rộng.',
      camera: { position: [0, 14, 18], lookAt: [0, 0, 0] },
      objects: [
        { kind: 'ground', name: 'Ground', pos: [0, 0, 0], size: [30, 1, 30], color: '#5d7d4a' },
        { kind: 'house', name: 'House_1', pos: [-8, 0, -6], color: '#b08968', roofColor: '#8b3a2a' },
        { kind: 'house', name: 'House_2', pos: [7, 0, -8], color: '#c2a878', roofColor: '#5a3a6b' },
        { kind: 'house', name: 'House_3', pos: [8, 0, 6], color: '#a8b8c8', roofColor: '#2a4a6b' },
        { kind: 'tree', name: 'Tree_1', pos: [-4, 0, 2], color: '#2f6b2f' },
        { kind: 'tree', name: 'Tree_2', pos: [0, 0, 8], color: '#3a7d33' },
        { kind: 'tree', name: 'Tree_3', pos: [-10, 0, 6], color: '#2f6b2f' },
        { kind: 'npc', name: 'NPC_Villager', pos: [-2, 0, -2], color: '#e07a5f' },
        { kind: 'npc', name: 'NPC_Guard', pos: [3, 0, 3], color: '#81b29a' },
        { kind: 'light', lightType: 'directional', name: 'Sun', pos: [8, 14, 4], color: '#fff2d9', intensity: 1.0 },
        { kind: 'light', lightType: 'point', name: 'Lantern', pos: [0, 3, 0], color: '#ffb347', intensity: 0.9 }
      ]
    },
    fps: {
      key: 'fps', name: 'FPS Corridor', icon: 'target',
      desc: 'Sàn + hành lang 8 tường + 3 bia tập bắn + spawn point, camera FPS tại spawn.',
      camera: { position: [0, 1.7, 9], lookAt: [0, 1.5, 0] },
      objects: [
        { kind: 'ground', name: 'Floor', pos: [0, 0, 0], size: [16, 1, 22], color: '#5a5a66' },
        { kind: 'wall', name: 'Wall_North', pos: [0, 1.5, -11], size: [16, 3, 0.5], color: '#7a7a88' },
        { kind: 'wall', name: 'Wall_South', pos: [0, 1.5, 11], size: [16, 3, 0.5], color: '#7a7a88' },
        { kind: 'wall', name: 'Wall_West', pos: [-8, 1.5, 0], size: [0.5, 3, 22], color: '#7a7a88' },
        { kind: 'wall', name: 'Wall_East', pos: [8, 1.5, 0], size: [0.5, 3, 22], color: '#7a7a88' },
        { kind: 'wall', name: 'Wall_Mid_1', pos: [-4, 1.5, -4], size: [7, 3, 0.5], color: '#8a8a98' },
        { kind: 'wall', name: 'Wall_Mid_2', pos: [4, 1.5, 2], size: [7, 3, 0.5], color: '#8a8a98' },
        { kind: 'wall', name: 'Wall_Cover_1', pos: [-3, 1, 5], size: [3, 2, 1], color: '#9a8a6a' },
        { kind: 'wall', name: 'Wall_Cover_2', pos: [3, 1, -6], size: [3, 2, 1], color: '#9a8a6a' },
        { kind: 'target', name: 'Target_1', pos: [-4, 1.2, -9], color: '#e63946' },
        { kind: 'target', name: 'Target_2', pos: [0, 1.2, -9], color: '#e63946' },
        { kind: 'target', name: 'Target_3', pos: [4, 1.2, -9], color: '#e63946' },
        { kind: 'marker', name: 'SpawnPoint', pos: [0, 0.2, 9], color: '#2ec4b6' },
        { kind: 'light', lightType: 'directional', name: 'Sun', pos: [4, 10, 4], color: '#ffffff', intensity: 0.9 }
      ]
    }
  };

  const SceneTemplates = {
    TEMPLATES: TEMPLATES,
    lastCameraPreset: null
  };

  /* ---------- builders ---------- */
  function mat(color, opts) {
    const m = new window.THREE.MeshStandardMaterial({ color: color || 0x7a7a94, roughness: 0.6, metalness: 0.1 });
    if (opts) Object.keys(opts).forEach(function (k) { m[k] = opts[k]; });
    return m;
  }
  function boxMesh(name, size, color, pos) {
    const T = window.THREE;
    const m = new T.Mesh(new T.BoxGeometry(size[0], size[1], size[2]), mat(color));
    m.name = name;
    m.position.fromArray(pos || [0, 0, 0]);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function capsule(name, color, pos, height) {
    /* r128 chưa có CapsuleGeometry → cylinder + 2 sphere */
    const T = window.THREE;
    const g = new T.Group();
    g.name = name;
    const h = height || 1.8, r = 0.35;
    const body = new T.Mesh(new T.CylinderGeometry(r, r, h - 2 * r, 16), mat(color));
    body.position.y = h / 2;
    body.castShadow = true;
    const head = new T.Mesh(new T.SphereGeometry(r, 16, 12), mat(color));
    head.position.y = h - r;
    head.castShadow = true;
    const feet = new T.Mesh(new T.SphereGeometry(r, 16, 12), mat(color));
    feet.position.y = r;
    feet.castShadow = true;
    g.add(body); g.add(head); g.add(feet);
    g.position.fromArray(pos || [0, 0, 0]);
    g.userData.capsuleHeight = h;
    return g;
  }

  SceneTemplates.buildObject = function (spec) {
    if (!spec || !spec.kind || !window.THREE) return null;
    const T = window.THREE;
    let obj = null;
    const pos = spec.pos || [0, 0, 0];
    switch (spec.kind) {
      case 'ground':
      case 'platform':
      case 'wall': {
        const size = spec.size || [2, 1, 2];
        obj = boxMesh(spec.name || spec.kind, size, spec.color, pos);
        if (spec.kind === 'ground') obj.position.y = (pos[1] || 0) - size[1] / 2 + (spec.groundTop !== undefined ? spec.groundTop : 0);
        break;
      }
      case 'player':
      case 'npc':
        obj = capsule(spec.name || spec.kind, spec.color, pos, 1.8);
        break;
      case 'tree': {
        obj = new T.Group();
        obj.name = spec.name || 'Tree';
        const trunk = new T.Mesh(new T.CylinderGeometry(0.25, 0.35, 1.6, 10), mat('#6b4a2f'));
        trunk.position.y = 0.8; trunk.castShadow = true;
        const top = new T.Mesh(new T.SphereGeometry(1.2, 16, 12), mat(spec.color || '#2f6b2f'));
        top.position.y = 2.4; top.castShadow = true;
        obj.add(trunk); obj.add(top);
        obj.position.fromArray(pos);
        break;
      }
      case 'house': {
        obj = new T.Group();
        obj.name = spec.name || 'House';
        const base = new T.Mesh(new T.BoxGeometry(4, 2.6, 3.4), mat(spec.color || '#b08968'));
        base.position.y = 1.3; base.castShadow = true; base.receiveShadow = true;
        const roof = new T.Mesh(new T.ConeGeometry(3.2, 1.6, 4), mat(spec.roofColor || '#8b3a2a'));
        roof.position.y = 3.4; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
        obj.add(base); obj.add(roof);
        obj.position.fromArray(pos);
        break;
      }
      case 'target': {
        obj = new T.Group();
        obj.name = spec.name || 'Target';
        const pole = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 1.2, 8), mat('#555555'));
        pole.position.y = 0.6;
        const disc = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 0.12, 24), mat(spec.color || '#e63946'));
        disc.rotation.x = Math.PI / 2; disc.position.y = 1.5; disc.castShadow = true;
        const inner = new T.Mesh(new T.CylinderGeometry(0.28, 0.28, 0.14, 24), mat('#ffffff'));
        inner.rotation.x = Math.PI / 2; inner.position.y = 1.5; inner.position.z = 0.02;
        obj.add(pole); obj.add(disc); obj.add(inner);
        obj.position.fromArray(pos);
        break;
      }
      case 'marker': {
        obj = new T.Group();
        obj.name = spec.name || 'Marker';
        const ball = new T.Mesh(new T.SphereGeometry(0.3, 16, 12), mat(spec.color || '#2ec4b6', { emissive: 0x1a7a70, emissiveIntensity: 0.8 }));
        ball.position.y = 0.3;
        const ring = new T.Mesh(new T.TorusGeometry(0.6, 0.06, 10, 24), mat(spec.color || '#2ec4b6'));
        ring.rotation.x = Math.PI / 2; ring.position.y = 0.05;
        obj.add(ball); obj.add(ring);
        obj.position.fromArray(pos);
        break;
      }
      case 'light': {
        if (spec.lightType === 'directional') obj = new T.DirectionalLight(spec.color || '#ffffff', spec.intensity !== undefined ? spec.intensity : 1);
        else if (spec.lightType === 'ambient') obj = new T.AmbientLight(spec.color || '#ffffff', spec.intensity !== undefined ? spec.intensity : 0.6);
        else obj = new T.PointLight(spec.color || '#ffffff', spec.intensity !== undefined ? spec.intensity : 1);
        obj.name = spec.name || 'Light';
        obj.position.fromArray(pos);
        break;
      }
      default:
        return null;
    }
    if (!obj) return null;
    if (spec.rot) obj.rotation.fromArray(spec.rot);
    if (spec.scale) obj.scale.fromArray(spec.scale);
    /* Lưu spec tối thiểu để serialize project khôi phục được */
    obj.userData.templateKind = spec.kind;
    obj.userData.templateColor = spec.color || null;
    if (spec.size) obj.userData.templateSize = spec.size.slice();
    if (spec.lightType) obj.userData.templateLightType = spec.lightType;
    if (spec.intensity !== undefined) obj.userData.templateIntensity = spec.intensity;
    if (spec.roofColor) obj.userData.templateRoofColor = spec.roofColor;
    return obj;
  };

  /* ---------- API ---------- */
  SceneTemplates.list = function () {
    return Object.keys(TEMPLATES).map(function (k) {
      const t = TEMPLATES[k];
      return { key: t.key, name: t.name, desc: t.desc, icon: t.icon, objectCount: t.objects.length };
    });
  };

  SceneTemplates.get = function (key) { return TEMPLATES[key] || null; };

  /* Thêm template mới lúc chạy (dạng dữ liệu như TEMPLATES) */
  SceneTemplates.registerTemplate = function (key, tpl) {
    if (!key || !tpl || !Array.isArray(tpl.objects)) return false;
    tpl.key = key;
    TEMPLATES[key] = tpl;
    return true;
  };

  SceneTemplates.applyCameraPreset = function (tpl) {
    if (!tpl || !tpl.camera) return false;
    SceneTemplates.lastCameraPreset = { position: tpl.camera.position.slice(), lookAt: tpl.camera.lookAt.slice() };
    try {
      const V = PixiStudio.Viewport;
      if (V && V.camera) {
        V.camera.position.fromArray(tpl.camera.position);
        if (V.orbit && V.orbit.target) {
          V.orbit.target.fromArray(tpl.camera.lookAt);
          if (typeof V.orbit.update === 'function') V.orbit.update();
        } else if (typeof V.camera.lookAt === 'function') {
          V.camera.lookAt(tpl.camera.lookAt[0], tpl.camera.lookAt[1], tpl.camera.lookAt[2]);
        }
        return true;
      }
    } catch (e) { /* viewport chưa sẵn — preset vẫn lưu ở lastCameraPreset */ }
    return false;
  };

  SceneTemplates.createFromTemplate = function (key, opts) {
    opts = opts || {};
    const tpl = TEMPLATES[key];
    if (!tpl) return null;
    if (!PixiStudio.Viewport || !PixiStudio.Viewport.scene) return null;
    const scene = PixiStudio.Viewport.scene;

    if (opts.clear) SceneTemplates.clearTemplateObjects();

    const built = [];
    const counts = {};
    tpl.objects.forEach(function (spec) {
      const obj = SceneTemplates.buildObject(spec);
      if (!obj) return;
      scene.add(obj);
      if (PixiStudio.Scene) PixiStudio.Scene.register(obj, 'template', obj.name);
      built.push(obj);
      counts[spec.kind] = (counts[spec.kind] || 0) + 1;
    });
    SceneTemplates.applyCameraPreset(tpl);
    if (PixiStudio.History) PixiStudio.History.push('Template: ' + tpl.name);
    bus.emit('scene:template-created', { key: key, name: tpl.name, count: built.length });
    bus.emit('scene:changed', { action: 'template', key: key, count: built.length });
    bus.emit('notify', { type: 'success', title: 'Scene Template', message: 'Đã tạo "' + tpl.name + '" — ' + built.length + ' object. Sửa tiếp thoải mái.' });
    return { key: key, name: tpl.name, objects: built, counts: counts, camera: SceneTemplates.lastCameraPreset };
  };

  SceneTemplates.clearTemplateObjects = function () {
    if (!PixiStudio.Scene) return 0;
    let n = 0;
    Object.keys(PixiStudio.Scene.registry).forEach(function (uuid) {
      const reg = PixiStudio.Scene.registry[uuid];
      if (reg && reg.type === 'template' && reg.object3D) {
        PixiStudio.Scene.deleteObject(reg.object3D);
        n++;
      }
    });
    return n;
  };

  /* ---------- UI ---------- */
  SceneTemplates.renderPicker = function (container) {
    const wrap = container || document.getElementById('template-picker-body');
    if (!wrap || !U.el) return null;
    wrap.innerHTML = '';
    SceneTemplates.list().forEach(function (t) {
      const card = U.el('div', {
        class: 'template-card',
        style: 'border:1px solid var(--border, #333);border-radius:10px;padding:10px;margin-bottom:8px;'
      }, [
        U.el('div', { text: (U.icon ? '' : '') + t.name, style: 'font-weight:700;font-size:14px;' }),
        U.el('div', { text: t.desc, style: 'font-size:12px;opacity:0.8;margin:4px 0;' }),
        U.el('div', { text: t.objectCount + ' object · camera đặt sẵn', style: 'font-size:11px;opacity:0.6;margin-bottom:6px;' }),
        U.el('button', {
          class: 'btn sm primary', text: 'Tạo scene từ template',
          onclick: function () { SceneTemplates.createFromTemplate(t.key); }
        })
      ]);
      wrap.appendChild(card);
    });
    return wrap;
  };

  SceneTemplates.openPicker = function () {
    if (PixiStudio.Modals && PixiStudio.Modals.open && U.el) {
      const body = U.el('div', { id: 'template-picker-body' });
      PixiStudio.Modals.open({ title: 'Scene Template', body: body, buttons: [{ label: 'Đóng', class: 'btn' }] });
      SceneTemplates.renderPicker(body);
      return true;
    }
    return SceneTemplates.attachToScenePage();
  };

  /* Gắn section Template vào Scene page (#scene-page-body). */
  SceneTemplates.attachToScenePage = function () {
    const body = document.getElementById('scene-page-body');
    if (!body || !U.el || document.getElementById('template-page-section')) return false;
    const section = U.el('div', { class: 'page-block', id: 'template-page-section' }, [
      U.el('h4', { text: 'Scene Templates' }),
      U.el('div', { id: 'template-picker-body' })
    ]);
    body.appendChild(section);
    SceneTemplates.renderPicker(section.querySelector('#template-picker-body'));
    return true;
  };

  if (bus && bus.on) {
    bus.on('scene:changed', function () { SceneTemplates.attachToScenePage(); });
  }

  window.PixiStudio.SceneTemplates = SceneTemplates;
})();
