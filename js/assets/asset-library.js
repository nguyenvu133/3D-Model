/* ============================================================
 * assets/asset-library.js — Asset Library UI:
 * dữ liệu mẫu 9 chibi + props/env/fx, thumbnail render 3D THẬT
 * (offscreen), search, filter chips, Model Tools.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const CATEGORIES = ['All', 'Imported', 'Characters', 'Props', 'Environments', 'Effects'];

  /* ---------- Dữ liệu mẫu ---------- */
  const SAMPLE_ASSETS = [
    { id: 'char-1', name: 'Hero_001', cat: 'Characters', variant: PixiStudio.SampleModel.VARIANTS[0], type: 'character' },
    { id: 'char-2', name: 'Ling Ling', cat: 'Characters', variant: PixiStudio.SampleModel.VARIANTS[1], type: 'character' },
    { id: 'char-3', name: 'Mei Hua', cat: 'Characters', variant: PixiStudio.SampleModel.VARIANTS[2], type: 'character' },
    { id: 'char-4', name: 'Po The Panda', cat: 'Characters', variant: PixiStudio.SampleModel.VARIANTS[3], type: 'character' },
    { id: 'char-5', name: 'Monk Hui', cat: 'Characters', variant: PixiStudio.SampleModel.VARIANTS[4], type: 'character' },
    { id: 'char-6', name: 'Elder Bai', cat: 'Characters', variant: PixiStudio.SampleModel.VARIANTS[5], type: 'character' },
    { id: 'char-7', name: 'Nomad Kid', cat: 'Characters', variant: PixiStudio.SampleModel.VARIANTS[6], type: 'character' },
    { id: 'char-8', name: 'Yu Lan', cat: 'Characters', variant: PixiStudio.SampleModel.VARIANTS[7], type: 'character' },
    { id: 'char-9', name: 'General Wu', cat: 'Characters', variant: PixiStudio.SampleModel.VARIANTS[8], type: 'character' },

    { id: 'prop-1', name: 'Dao Kiếm Vũ Lâm', cat: 'Props', type: 'sword', icon: 'weapon' },
    { id: 'prop-2', name: 'Đèn Lồng Đỏ', cat: 'Props', type: 'lantern', icon: 'bulb' },
    { id: 'prop-3', name: 'Cuộn Bí Kíp', cat: 'Props', type: 'scroll', icon: 'file' },
    { id: 'prop-4', name: 'Bình Linh Dược', cat: 'Props', type: 'potion', icon: 'flask' },
    { id: 'env-1', name: 'Rừng Trúc Sâu', cat: 'Environments', type: 'bamboo', icon: 'env' },
    { id: 'env-2', name: 'Đại Sảnh Võ Đường', cat: 'Environments', type: 'dojo', icon: 'cube' },
    { id: 'env-3', name: 'Cầu Tre Sương Mù', cat: 'Environments', type: 'bridge', icon: 'link' },
    { id: 'fx-1', name: 'Kiếm Khí Tán', cat: 'Effects', type: 'slash', icon: 'fx' },
    { id: 'fx-2', name: 'Đom Đóm Linh', cat: 'Effects', type: 'fireflies', icon: 'fx' },
    { id: 'fx-3', name: 'Trận Pháp Tím', cat: 'Effects', type: 'runes', icon: 'target' }
  ];

  /* ---------- Model Tools ---------- */
  const MODEL_TOOLS = [
    { id: 'autoRig', name: 'Auto Rig', icon: 'rig', action: 'autoRig' },
    { id: 'autoAnim', name: 'Auto Animate', icon: 'animation', action: 'autoAnimate' },
    { id: 'optimize', name: 'Optimize', icon: 'optimize', action: 'optimize' },
    { id: 'textureBake', name: 'Texture Bake', icon: 'bake', action: 'textureBake' },
    { id: 'retopo', name: 'Retopology', icon: 'retopo', action: 'retopo' },
    { id: 'lod', name: 'LOD', icon: 'lod', action: 'lod' },
    { id: 'collider', name: 'Collider', icon: 'collider', action: 'collider' },
    { id: 'uvunwrap', name: 'UVUnwrap', icon: 'uv', action: 'uvunwrap' }
  ];

  const Library = {
    assets: SAMPLE_ASSETS.slice(),
    category: 'All',
    search: '',
    selectedAssetId: 'char-1',
    _thumbs: {}
  };

  /* ============================================================
     THUMBNAIL 3D THẬT — render variant chibi vào canvas 128px
     DÙNG MỘT offscreen renderer dùng chung (tránh tạo 19 GL context
     — gây crash tab trên trình duyệt giới hạn bộ nhớ).
     ============================================================ */
  Library._thumbRenderer = null;
  Library._getThumbRenderer = function () {
    if (Library._thumbRenderer) return Library._thumbRenderer;
    try {
      const tmp = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      tmp.setSize(128, 136, false);
      tmp.setPixelRatio(1);
      tmp.outputEncoding = THREE.sRGBEncoding;
      Library._thumbRenderer = tmp;
      return tmp;
    } catch (err) {
      console.warn('[AssetLibrary] thumbnail renderer lỗi:', err);
      return null;
    }
  };

  Library._thumbScene = null;
  Library._thumbCam = null;

  Library.generateThumbnail = function (asset) {
    if (Library._thumbs[asset.id]) return Library._thumbs[asset.id];
    if (!window.THREE) return null;

    let object3D = null;
    let disposable = false;      /* chỉ dispose geometry/material do mình TẠO RA */
    if (asset.type === 'character') {
      const v = Object.assign({}, asset.variant);
      if (v.hairStyle === 'none') v.hairStyle = 'bun';
      object3D = PixiStudio.SampleModel.createChibiWuxia(v);
      disposable = true;
    } else if (asset.type === 'model') {
      /* model người dùng import/đang mở — CLONE để không đụng vào object đang sống
         (geometry/material dùng chung nên KHÔNG được dispose) */
      const entry = asset.entry || PixiStudio.Models.models[asset.modelId];
      if (!entry || !entry.object3D) return null;
      try { object3D = entry.object3D.clone(true); } catch (e) { return null; }
    } else {
      object3D = Library._buildPropPlaceholder(asset);
      disposable = true;
    }
    if (!object3D) return null;

    /* Scene dùng chung — clear mỗi lần */
    if (!Library._thumbScene) {
      Library._thumbScene = new THREE.Scene();
      const light1 = new THREE.DirectionalLight(0xffffff, 1.0);
      light1.position.set(3, 5, 4);
      const light2 = new THREE.DirectionalLight(0x9d8fff, 0.5);
      light2.position.set(-4, 3, -3);
      const hemi = new THREE.HemisphereLight(0x8a8aff, 0x2a2233, 0.7);
      Library._thumbScene.add(light1, light2, hemi);
      Library._thumbCam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    }
    const scene = Library._thumbScene;
    const cam = Library._thumbCam;

    const box = new THREE.Box3().setFromObject(object3D);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    scene.add(object3D);
    object3D.position.sub(center);

    const dist = Math.max(size.x, size.y, size.z) * 1.5 + 0.5;
    cam.position.set(dist * 0.55, dist * 0.35, dist);
    cam.lookAt(0, 0, 0);

    const tmp = Library._getThumbRenderer();
    if (!tmp) return null;
    tmp.render(scene, cam);
    scene.remove(object3D);
    /* dispose geometry của object preview để không tích tụ GPU memory
       (chỉ với object do mình tạo — KHÔNG dispose asset clone của model thật) */
    if (disposable) {
      object3D.traverse(function (o) {
        if (o.isMesh) {
          if (o.geometry) o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(function (m) { if (m) m.dispose(); });
        }
      });
    }

    /* Vẽ lên canvas 2D với nền gradient đẹp */
    const out = document.createElement('canvas');
    out.width = 128; out.height = 136;
    const ctx = out.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 128, 136);
    grad.addColorStop(0, '#2c2c44');
    grad.addColorStop(1, '#191926');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 136);
    const glow = ctx.createRadialGradient(64, 112, 4, 64, 112, 46);
    glow.addColorStop(0, 'rgba(113,59,255,.4)');
    glow.addColorStop(1, 'rgba(113,59,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(18, 66, 92, 92);
    ctx.drawImage(tmp.domElement, 0, 0, 128, 136);

    const dataUrl = out.toDataURL('image/png');
    Library._thumbs[asset.id] = dataUrl;
    return dataUrl;
  };

  /* Prop/env/fx placeholder 3D đơn giản (đủ nhìn thumbnail) */
  Library._buildPropPlaceholder = function (asset) {
    const g = new THREE.Group();
    const col = { sword: 0x9fb3c8, lantern: 0xff8a4a, scroll: 0xd9c48f, potion: 0x7fb3ff, bamboo: 0x5aae5f, dojo: 0x8a5f3a, bridge: 0x7a5f3f, slash: 0x27bfff, fireflies: 0xffe07a, runes: 0x9d6bff }[asset.type] || 0x8a8aa0;
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: asset.type === 'sword' ? 0.8 : 0.1 });

    if (asset.type === 'sword') {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.03), mat);
      blade.position.y = 0.3;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.08), new THREE.MeshStandardMaterial({ color: 0x6a5a3f, roughness: 0.5, metalness: 0.6 }));
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 10), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.7 }));
      grip.position.y = -0.4;
      g.add(blade, guard, grip);
    } else if (asset.type === 'lantern' || asset.type === 'potion') {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 14), new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, emissive: col, emissiveIntensity: 0.25, transparent: asset.type === 'potion', opacity: 0.92 }));
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x3a3a48, roughness: 0.6 }));
      top.position.y = 0.45;
      body.scale.y = 1.25;
      g.add(body, top);
    } else if (asset.type === 'scroll') {
      const paper = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.03), new THREE.MeshStandardMaterial({ color: 0xd9c48f, roughness: 0.9 }));
      const rod1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 10), mat);
      rod1.rotation.z = Math.PI / 2; rod1.position.y = 0.28;
      const rod2 = rod1.clone(); rod2.position.y = -0.28;
      g.add(paper, rod1, rod2);
    } else if (asset.type === 'bamboo') {
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.5, 8), mat);
        b.position.set((i - 1) * 0.3, 0, i * 0.12 - 0.1);
        b.rotation.z = (i - 1) * 0.08;
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), mat);
        leaf.scale.set(1.6, 0.4, 0.7);
        leaf.position.set(b.position.x + 0.15, 0.6, b.position.z);
        g.add(b, leaf);
      }
    } else if (asset.type === 'dojo' || asset.type === 'bridge') {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.35, 4), mat);
      roof.position.y = 0.5; roof.rotation.y = Math.PI / 4;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.8 }));
      body.position.y = 0.1;
      g.add(roof, body);
    } else { /* fx */
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.7, roughness: 0.2, transparent: true, opacity: 0.85 }));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.035, 8, 30), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, transparent: true, opacity: 0.7 }));
      ring.rotation.x = Math.PI / 2.4;
      g.add(core, ring);
    }
    return g;
  };

  /* ============================================================
     UI RENDER
     ============================================================ */
  Library.renderChips = function () {
    const row = U.$('#asset-chip-row');
    if (!row) return;
    row.innerHTML = '';
    CATEGORIES.forEach(function (cat) {
      const chip = U.el('div', {
        class: 'chip' + (Library.category === cat ? ' active' : ''),
        text: cat,
        onclick: function () {
          Library.category = cat;
          Library.renderChips();
          Library.renderGrid();
        }
      });
      row.appendChild(chip);
    });
  };

  Library.filtered = function () {
    const q = Library.search.trim().toLowerCase();
    return Library.assets.filter(function (a) {
      const catOk = Library.category === 'All' || a.cat === Library.category;
      const qOk = !q || a.name.toLowerCase().indexOf(q) !== -1 || a.cat.toLowerCase().indexOf(q) !== -1;
      return catOk && qOk;
    });
  };

  Library.renderGrid = function () {
    const grid = U.$('#asset-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const items = Library.filtered();

    if (!items.length) {
      grid.appendChild(U.el('div', { class: 'empty-state', style: 'grid-column:1/-1;' }, [
        U.el('div', { class: 'es-icon', text: '🔍' }),
        U.el('b', { text: 'Không tìm thấy asset' }),
        U.el('span', { text: 'Thử từ khoá khác hoặc import file mới.' })
      ]));
      return;
    }

    items.forEach(function (asset) {
      const thumb = Library.generateThumbnail(asset);
      const card = U.el('div', {
        class: 'asset-card' + (Library.selectedAssetId === asset.id ? ' selected' : ''),
        dataset: { id: asset.id },
        draggable: 'false',
        onclick: function () { Library.selectAsset(asset.id); },
        oncontextmenu: function (e) {
          e.preventDefault();
          bus.emit('ui:contextmenu', { x: e.clientX, y: e.clientY, zone: 'asset', asset: asset });
        }
      });
      if (thumb) {
        card.appendChild(U.el('img', { src: thumb, alt: asset.name, draggable: 'false' }));
      } else {
        const ph = U.el('div', { style: 'height:76%;display:grid;place-items:center;color:var(--text-3);' });
        ph.innerHTML = U.icon(asset.icon || 'cube', 'ic-lg');
        card.appendChild(ph);
      }
      card.appendChild(U.el('div', { class: 'a-name', text: asset.name }));
      card.appendChild(U.el('div', { class: 'a-cat', text: asset.cat }));
      grid.appendChild(card);
    });
  };

  Library.selectAsset = function (id) {
    Library.selectedAssetId = id;
    const asset = Library.assets.find(function (a) { return a.id === id; });
    if (!asset) return;

    /* Model người dùng import → chỉ chọn + focus (model đã ở trong scene) */
    if (asset.type === 'model') {
      const entry = asset.entry || PixiStudio.Models.models[asset.modelId];
      if (!entry) return;
      PixiStudio.Models.currentId = entry.id;
      PixiStudio.State.select(entry.object3D, { modelId: entry.id });
      if (PixiStudio.Viewport.orbit && PixiStudio.Viewport.orbit.focus) PixiStudio.Viewport.orbit.focus(entry.object3D);
      bus.emit('notify', { type: 'info', title: 'Asset', message: 'Đã chọn model “' + asset.name + '”' });
      Library.renderGrid();
      return;
    }

    /* Load asset thật vào viewport */
    if (asset.type === 'character') {
      const v = Object.assign({}, asset.variant);
      if (v.hairStyle === 'none') v.hairStyle = 'bun';
      const model = PixiStudio.SampleModel.createChibiWuxia(v);
      const entry = PixiStudio.Models.loadGLBFromBuffer ? null : null;
      /* register qua model manager path riêng cho sample */
      PixiStudio.Models.normalize(model);
      const stats = PixiStudio.Models.computeStats(model);
      const regId = U.uid('model');
      model.userData.modelEntry = { id: regId, name: v.name, object3D: model, stats: stats, isGLB: false, clips: [] };
      PixiStudio.Models.models[regId] = model.userData.modelEntry;
      PixiStudio.Models.currentId = regId;
      PixiStudio.Viewport.addModel(model);
      if (PixiStudio.Scene) PixiStudio.Scene.register(model, 'model', v.name);
      PixiStudio.State.select(model, { modelId: regId });
      bus.emit('model:loaded', { id: regId, name: v.name, stats: stats, isGLB: false, fileSize: 0, clips: [] });
      bus.emit('notify', { type: 'info', title: 'Đã load asset', message: v.name + ' (sample variant)' });
    } else {
      bus.emit('notify', {
        type: 'warning', title: asset.name,
        message: 'Asset ' + asset.cat + ' mẫu — cần backend AI (Tripo) hoặc import file để tạo model thật.'
      });
    }

    Library.renderGrid();
  };

  /* ---------- Model Tools ---------- */
  Library.renderModelTools = function () {
    const grid = U.$('#model-tools-grid');
    if (!grid) return;
    grid.innerHTML = '';
    MODEL_TOOLS.forEach(function (tool) {
      grid.appendChild(U.el('button', {
        class: 'mt-btn' + (tool.id === 'autoRig' || tool.id === 'autoAnim' ? ' primary' : ''),
        html: U.icon(tool.icon) + '<span>' + tool.name + '</span>',
        onclick: function () { Library.runTool(tool.action, tool.name); }
      }));
    });
  };

  Library.runTool = function (action, label) {
    const sel = PixiStudio.State.get('selection');
    switch (action) {
      case 'autoRig':
        if (PixiStudio.Rig) PixiStudio.Rig.autoRig(sel);
        break;
      case 'autoAnimate':
        if (PixiStudio.Anim) PixiStudio.Anim.autoAnimate(sel);
        break;
      case 'optimize':
        Library._optimize(sel);
        break;
      case 'textureBake':
        Library._textureBake(sel);
        break;
      case 'retopo':
        bus.emit('notify', {
          type: 'warning', title: 'Retopology — cần backend AI',
          message: 'Retopo thật cần AI backend (Tripo/MeshAnything). Adapter đã sẵn sàng — kết nối API key trong AI Tools.',
          duration: 6000
        });
        break;
      case 'lod':
        Library._lod(sel);
        break;
      case 'collider':
        Library._collider(sel);
        break;
      case 'uvunwrap':
        Library._uvunwrap(sel);
        break;
    }
  };

  Library._optimize = function (sel) {
    const target = sel || PixiStudio.Viewport.getMainModel();
    if (!target) { bus.emit('notify', { type: 'warning', title: 'Chưa có model để optimize' }); return; }
    const before = PixiStudio.Models.computeStats(target);
    let merged = 0;
    try {
      if (window.THREE && THREE.BufferGeometryUtils) {
        /* Merge geometry có cùng material trong từng mesh con — demo thật */
        target.traverse(function (o) {
          if (o.isMesh && o.geometry && !o.geometry.index) {
            o.geometry = THREE.BufferGeometryUtils.mergeVertices(o.geometry, 1e-4);
            merged++;
          }
        });
      }
    } catch (e) { /* một số geometry không merge được — bỏ qua */ }
    const after = PixiStudio.Models.computeStats(target);
    const saved = before.vertices - after.vertices;
    bus.emit('notify', {
      type: 'success', title: 'Mesh Optimize hoàn tất',
      message: saved > 0
        ? 'Giảm ' + U.formatNumber(saved) + ' vertices (merge ' + merged + ' mesh). ' + U.formatNumber(before.vertices) + ' → ' + U.formatNumber(after.vertices)
        : 'Đã quét ' + before.meshes + ' mesh — geometry đã tối ưu.'
    });
    bus.emit('model:stats-updated', {});
  };

  Library._textureBake = function (sel) {
    const target = sel || PixiStudio.Viewport.getMainModel();
    if (!target) return;
    const url = PixiStudio.Viewport.screenshot(512, 512, 'png');
    if (url) {
      bus.emit('asset:baked', { name: target.name, url: url });
      bus.emit('notify', {
        type: 'info', title: 'Texture Bake (preview)',
        message: 'Đã bake preview 512px cho ' + target.name + '. Bake PBR full cần backend.'
      });
    }
  };

  Library._lod = function (sel) {
    const target = sel || PixiStudio.Viewport.getMainModel();
    if (!target) return;
    bus.emit('notify', {
      type: 'info', title: 'LOD Generator',
      message: 'Đã tạo cấu hình 3 mức LOD (0: 100% / 1: 50% / 2: 25%) cho ' + target.name + '. Decimate thật cần backend — config xuất kèm Game Build.'
    });
    target.userData.lodConfig = { levels: [100, 50, 25], distances: [0, 10, 25] };
  };

  Library._collider = function (sel) {
    const target = sel || PixiStudio.Viewport.getMainModel();
    if (!target) return;
    /* Xoá collider cũ */
    const old = target.getObjectByName('__collider__');
    if (old) target.remove(old);
    const box = new THREE.Box3().setFromObject(target);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const edges = new THREE.EdgesGeometry(geo);
    const collider = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x42df75, transparent: true, opacity: 0.9 }));
    collider.name = '__collider__';
    collider.position.copy(center).sub(target.position);
    target.add(collider);
    if (PixiStudio.Physics) PixiStudio.Physics.setCollider(target.uuid, 'box', [size.x, size.y, size.z]);
    bus.emit('notify', { type: 'success', title: 'Collider Generator', message: 'Box collider ' + size.x.toFixed(1) + '×' + size.y.toFixed(1) + '×' + size.z.toFixed(1) + ' đã thêm cho ' + target.name });
  };

  Library._uvunwrap = function (sel) {
    const target = sel || PixiStudio.Viewport.getMainModel();
    if (!target) return;
    let withUV = 0, without = 0;
    target.traverse(function (o) {
      if (o.isMesh && o.geometry) {
        if (o.geometry.attributes.uv) withUV++; else without++;
      }
    });
    bus.emit('notify', {
      type: withUV ? 'info' : 'warning', title: 'UV Unwrap',
      message: withUV
        ? withUV + ' mesh có UV sẵn, ' + without + ' mesh không UV. UV unwrap sâu cần backend — hiện dùng UV gốc của model.'
        : 'Không tìm thấy UV nào — model cần unwrap trước khi texture.'
    });
  };

  /* ============================================================
     AUTO UPDATE — model import/load xong là hiện ngay trong library
     ============================================================ */
  Library.syncImportedModels = function (silent) {
    const models = (PixiStudio.Models && PixiStudio.Models.models) || {};
    let added = 0;
    Object.keys(models).forEach(function (id) {
      const entry = models[id];
      if (!entry || !entry.object3D) return;
      const assetId = 'model-' + id;
      const existing = Library.assets.find(function (a) { return a.id === assetId; });
      if (existing) {
        existing.name = entry.name || existing.name;
        existing.entry = entry;
        return;
      }
      Library.assets.push({
        id: assetId,
        modelId: id,
        name: entry.name || 'Imported',
        cat: 'Imported',
        type: 'model',
        entry: entry,
        icon: 'model'
      });
      added++;
    });
    /* bỏ entry của model đã bị xoá khỏi scene */
    Library.assets = Library.assets.filter(function (a) {
      if (a.type !== 'model') return true;
      return !!(a.entry && a.entry.object3D && a.entry.object3D.parent);
    });
    if (added) {
      Library.renderChips();
      Library.renderGrid();
      if (!silent) {
        bus.emit('notify', {
          type: 'success', title: 'Asset Library đã cập nhật',
          message: added + ' model mới được thêm vào thư viện (tab “Imported”).'
        });
      }
    }
    return added;
  };

  /* Xoá thumbnail cache để vẽ lại (model đổi rig/mesh) */
  Library.invalidateThumb = function (modelId) {
    delete Library._thumbs['model-' + modelId];
  };

  Library._wireAutoUpdate = function () {
    if (Library._wired) return;
    Library._wired = true;
    bus.on('model:loaded', function () { setTimeout(function () { Library.syncImportedModels(true); }, 60); });
    bus.on('asset:imported', function (d) {
      if (d && d.type === 'model') setTimeout(function () { Library.syncImportedModels(false); }, 60);
    });
    bus.on('model:removed', function (d) {
      if (d && d.id) Library.invalidateThumb(d.id);
      setTimeout(function () { Library.syncImportedModels(true); }, 60);
    });
    /* model đổi mesh (rig/skin/optimize) → vẽ lại thumbnail */
    ['rig:created', 'rig:autogen', 'model:stats-updated'].forEach(function (ev) {
      bus.on(ev, function () {
        const cur = PixiStudio.Models.getCurrent && PixiStudio.Models.getCurrent();
        if (cur) Library.invalidateThumb(cur.id);
      });
    });
  };

  /* ---------- INIT ---------- */
  Library.init = function () {
    Library._wireAutoUpdate();
    Library.syncImportedModels(true);
    Library.renderChips();
    Library.renderModelTools();
    Library.renderGrid();

    /* Search */
    const search = U.$('#asset-search');
    if (search) {
      search.addEventListener('input', U.debounce(function () {
        Library.search = search.value;
        Library.renderGrid();
      }, 200));
    }

    /* Filter button → mở rộng chips (all categories) */
    const filterBtn = U.$('#asset-filter-btn');
    if (filterBtn) {
      filterBtn.addEventListener('click', function () {
        Library.category = 'All';
        Library.renderChips();
        Library.renderGrid();
        bus.emit('notify', { type: 'info', title: 'Filter', message: 'Hiển thị tất cả danh mục' });
      });
    }

    /* Refresh thumbnails */
    const refreshBtn = U.$('#asset-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        Library._thumbs = {};
        Library.renderGrid();
        bus.emit('notify', { type: 'success', title: 'Asset Library', message: 'Đã render lại toàn bộ thumbnail 3D' });
      });
    }

    /* Import button */
    const importBtn = U.$('#btn-import');
    if (importBtn) {
      importBtn.addEventListener('click', function () {
        PixiStudio.Importers.openFileDialog();
      });
    }

    /* Click asset ngoài → highlight card tương ứng */
    bus.on('model:loaded', function (data) {
      const match = Library.assets.find(function (a) { return a.name === data.name; });
      if (match) {
        Library.selectedAssetId = match.id;
        Library.renderGrid();
      }
    });
  };

  window.PixiStudio.AssetLibrary = Library;
})();
