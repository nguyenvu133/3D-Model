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

  /* ---------- Asset Library mở rộng (nhóm C) ---------- */
  const FILE_TYPES = ['All', 'FBX', 'GLB', 'OBJ', 'STL', 'Sample', 'Image'];
  const SORTS = [
    { id: 'default', label: 'Mặc định (★ ghim đầu)' },
    { id: 'name', label: 'Tên A–Z' },
    { id: 'newest', label: 'Mới nhất' },
    { id: 'size', label: 'Dung lượng ↓' },
    { id: 'tris', label: 'Tris nhiều nhất' }
  ];

  const Library = {
    assets: SAMPLE_ASSETS.slice(),
    category: 'All',
    search: '',
    selectedAssetId: 'char-1',
    _thumbs: {},
    /* --- trạng thái mở rộng --- */
    fileType: 'All',
    sort: 'default',
    tagFilter: null,
    collectionFilter: 'All',
    collections: [],          /* [{ id, name }] */
    viewMode: 'grid',         /* 'grid' | 'list' */
    multiSelect: false,
    selectedIds: {},          /* id -> true */
    _recent: []               /* tối đa 5 id, mới nhất đầu */
  };

  /* Chuẩn hoá metadata — asset cũ/thiếu field vẫn chạy, hiện "—" khi thiếu số liệu */
  Library._normalizeAsset = function (a) {
    if (!a) return a;
    if (!Array.isArray(a.tags)) a.tags = [];
    if (typeof a.favorite !== 'boolean') a.favorite = false;
    if (a.collectionId === undefined) a.collectionId = null;
    if (!a.addedAt) a.addedAt = new Date().toISOString();
    if (a.fileSize === undefined || a.fileSize === null) a.fileSize = 0;
    if (!a.fileExt) a.fileExt = Library._deriveExt(a);
    if (!a.stats) a.stats = null;
    return a;
  };

  Library._deriveExt = function (a) {
    if (a.type === 'model') {
      const entry = a.entry || (PixiStudio.Models && PixiStudio.Models.models && PixiStudio.Models.models[a.modelId]);
      const name = (entry && entry.name) || a.name || '';
      const m = /\.([a-z0-9]+)$/i.exec(name);
      if (m) return m[1].toLowerCase();
      if (entry && entry.isGLB) return 'glb';
      return '';
    }
    if (a.type === 'character') return 'sample';
    return '';
  };

  Library._assetStats = function (a) {
    if (a.stats) return a.stats;
    const entry = a.entry || (a.modelId && PixiStudio.Models && PixiStudio.Models.models && PixiStudio.Models.models[a.modelId]);
    if (entry && entry.stats) { a.stats = entry.stats; return entry.stats; }
    return null;
  };

  Library._assetSize = function (a) {
    if (a.fileSize) return a.fileSize;
    const entry = a.entry || (a.modelId && PixiStudio.Models && PixiStudio.Models.models && PixiStudio.Models.models[a.modelId]);
    if (entry && entry.fileSize) { a.fileSize = entry.fileSize; return entry.fileSize; }
    return 0;
  };

  Library._assetExt = function (a) {
    if (a.fileExt) return a.fileExt;
    a.fileExt = Library._deriveExt(a);
    return a.fileExt;
  };

  /* Persist an toàn — nhóm B có thể thêm Library._persist / AssetLibraryStore sau;
     chưa có thì chỉ bỏ qua, không chặn UI. */
  Library._persistSafe = function () {
    try {
      if (typeof Library._persist === 'function') { Library._persist(); return; }
      var Store = window.PixiStudio && PixiStudio.AssetLibraryStore;
      if (Store && typeof Store.saveLibrary === 'function') { Store.saveLibrary(Library); }
      else if (Store && typeof Store.save === 'function') { Store.save(Library); }
    } catch (e) { /* store chưa sẵn sàng — bỏ qua */ }
  };

  /* _persist "thật": ghi meta qua store nhóm B (asset-library-storage.js)
     nếu đã load. Lưu ý: script store CHƯA có trong index.html (nhóm A sở
     hữu) nên lúc này thường no-op — khi nhóm A thêm script tag, persist
     sẽ chạy mà không cần sửa lại code nhóm C. */
  Library._persist = function () {
    try {
      var Store = window.PixiStudio && PixiStudio.AssetLibraryStore;
      if (Store && typeof Store.saveMeta === 'function') {
        var meta = (typeof Store.collectMeta === 'function')
          ? Store.collectMeta()
          : Library.assets.map(function (a) { return Library._sanitizeAsset(a); });
        Store.saveMeta(meta);
      }
    } catch (e) { /* store chưa sẵn sàng — bỏ qua */ }
  };

  Library._touchRecent = function (id) {
    Library._recent = Library._recent.filter(function (x) { return x !== id; });
    Library._recent.unshift(id);
    if (Library._recent.length > 5) Library._recent.length = 5;
  };

  /* Gán metadata mặc định cho 20 sample asset (tags rỗng, addedAt xen kẽ để sort "Mới nhất" có nghĩa) */
  (function () {
    var base = Date.parse('2026-11-20T00:00:00Z');
    SAMPLE_ASSETS.forEach(function (a, i) {
      a.tags = [];
      a.favorite = false;
      a.collectionId = null;
      a.addedAt = new Date(base + i * 3600000).toISOString();
      a.fileSize = 0;
      a.fileExt = a.type === 'character' ? 'sample' : '';
      a.stats = null;
    });
  })();

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
    const list = Library.assets.filter(function (a) {
      Library._normalizeAsset(a);
      const catOk = Library.category === 'All' || a.cat === Library.category;
      /* search: tên + category + TAG */
      const qOk = !q || a.name.toLowerCase().indexOf(q) !== -1 || a.cat.toLowerCase().indexOf(q) !== -1 ||
        (a.tags || []).some(function (t) { return String(t).toLowerCase().indexOf(q) !== -1; });
      /* lọc theo loại file */
      let ftOk = true;
      if (Library.fileType !== 'All') {
        const ext = (Library._assetExt(a) || '').toLowerCase();
        if (Library.fileType === 'Sample') ftOk = ext === 'sample' || a.type === 'character';
        else if (Library.fileType === 'Image') ftOk = ext === 'png' || ext === 'jpg' || ext === 'jpeg' || a.type === 'image';
        else ftOk = ext === Library.fileType.toLowerCase();
      }
      /* lọc theo collection */
      const colOk = Library.collectionFilter === 'All' ||
        (Library.collectionFilter === '__none__' ? !a.collectionId : a.collectionId === Library.collectionFilter);
      /* lọc theo tag đã chọn (click tag trên card) */
      const tagOk = !Library.tagFilter || (a.tags || []).indexOf(Library.tagFilter) !== -1;
      return catOk && qOk && ftOk && colOk && tagOk;
    });
    /* sắp xếp */
    const byName = function (x, y) { return String(x.name).localeCompare(String(y.name)); };
    const byAdded = function (x, y) { return String(y.addedAt || '').localeCompare(String(x.addedAt || '')); };
    if (Library.sort === 'name') list.sort(byName);
    else if (Library.sort === 'newest') list.sort(byAdded);
    else if (Library.sort === 'size') list.sort(function (x, y) { return Library._assetSize(y) - Library._assetSize(x); });
    else if (Library.sort === 'tris') list.sort(function (x, y) {
      const sx = Library._assetStats(x), sy = Library._assetStats(y);
      return (sy && sy.triangles || 0) - (sx && sx.triangles || 0);
    });
    else { /* mặc định: favorite ghim đầu, còn lại giữ thứ tự gốc (sort ổn định) */
      list.sort(function (x, y) { return (y.favorite ? 1 : 0) - (x.favorite ? 1 : 0); });
    }
    return list;
  };

  /* Thẻ tag nhỏ trên card — click để lọc theo tag đó */
  Library._tagChipEl = function (asset, tag) {
    return U.el('span', {
      class: 'asset-tag',
      text: '#' + tag,
      onclick: function (e) {
        e.stopPropagation();
        Library.tagFilter = (Library.tagFilter === tag) ? null : tag;
        Library.renderGrid();
        bus.emit('notify', {
          type: 'info', title: 'Lọc theo tag',
          message: Library.tagFilter ? 'Đang lọc tag “' + tag + '” — click lại tag để bỏ lọc.' : 'Đã bỏ lọc tag.'
        });
      }
    });
  };

  Library._cardMetaText = function (asset) {
    const st = Library._assetStats(asset);
    const size = Library._assetSize(asset);
    const parts = [];
    if (st && st.triangles) parts.push(U.formatNumber(st.triangles) + ' tris');
    if (size) parts.push(U.formatBytes(size));
    return parts.join(' · ');
  };

  Library._buildCard = function (asset) {
    const thumb = Library.generateThumbnail(asset);
    const card = U.el('div', {
      class: 'asset-card' + (Library.selectedAssetId === asset.id ? ' selected' : '') + (asset.favorite ? ' fav' : ''),
      dataset: { id: asset.id },
      draggable: 'false',
      onclick: function () {
        if (Library.multiSelect) { Library.toggleSelect(asset.id); return; }
        Library.selectAsset(asset.id);
      },
      oncontextmenu: function (e) {
        e.preventDefault();
        bus.emit('ui:contextmenu', { x: e.clientX, y: e.clientY, zone: 'asset', asset: asset });
      }
    });
    if (Library.multiSelect) {
      card.appendChild(U.el('input', {
        type: 'checkbox', class: 'asset-check',
        onclick: function (e) { e.stopPropagation(); Library.toggleSelect(asset.id); }
      }));
      /* đồng bộ trạng thái check sau khi append (U.el set attribute) */
      var cb = card.querySelector('.asset-check');
      if (cb) cb.checked = !!Library.selectedIds[asset.id];
    }
    /* sao favorite */
    card.appendChild(U.el('span', {
      class: 'asset-fav' + (asset.favorite ? ' on' : ''),
      text: asset.favorite ? '★' : '☆',
      title: asset.favorite ? 'Bỏ favorite' : 'Đánh dấu favorite',
      onclick: function (e) { e.stopPropagation(); Library.toggleFavorite(asset.id); }
    }));
    /* badge loại file */
    const ext = Library._assetExt(asset);
    if (ext) card.appendChild(U.el('span', { class: 'asset-ext', text: ext.toUpperCase() }));
    if (thumb) {
      card.appendChild(U.el('img', { src: thumb, alt: asset.name, draggable: 'false' }));
    } else {
      const ph = U.el('div', { style: 'height:76%;display:grid;place-items:center;color:var(--text-3);' });
      ph.innerHTML = U.icon(asset.icon || 'cube', 'ic-lg');
      card.appendChild(ph);
    }
    card.appendChild(U.el('div', { class: 'a-name', text: asset.name }));
    card.appendChild(U.el('div', { class: 'a-cat', text: asset.cat }));
    const meta = Library._cardMetaText(asset);
    if (meta) card.appendChild(U.el('div', { class: 'a-meta', text: meta }));
    if ((asset.tags || []).length) {
      const tagRow = U.el('div', { class: 'asset-tags' });
      asset.tags.slice(0, 3).forEach(function (t) { tagRow.appendChild(Library._tagChipEl(asset, t)); });
      if (asset.tags.length > 3) tagRow.appendChild(U.el('span', { class: 'asset-tag-more', text: '+' + (asset.tags.length - 3) }));
      card.appendChild(tagRow);
    }
    return card;
  };

  /* Dòng list view: thumb nhỏ + tên + loại + tris + dung lượng + sao */
  Library._buildRow = function (asset) {
    const thumb = Library.generateThumbnail(asset);
    const st = Library._assetStats(asset);
    const row = U.el('div', {
      class: 'asset-row' + (Library.selectedAssetId === asset.id ? ' selected' : ''),
      dataset: { id: asset.id },
      onclick: function () {
        if (Library.multiSelect) { Library.toggleSelect(asset.id); return; }
        Library.selectAsset(asset.id);
      },
      oncontextmenu: function (e) {
        e.preventDefault();
        bus.emit('ui:contextmenu', { x: e.clientX, y: e.clientY, zone: 'asset', asset: asset });
      }
    });
    if (Library.multiSelect) {
      row.appendChild(U.el('input', {
        type: 'checkbox', class: 'asset-check',
        onclick: function (e) { e.stopPropagation(); Library.toggleSelect(asset.id); }
      }));
      var cb = row.querySelector('.asset-check');
      if (cb) cb.checked = !!Library.selectedIds[asset.id];
    }
    const th = U.el('div', { class: 'ar-thumb' });
    if (thumb) th.appendChild(U.el('img', { src: thumb, alt: asset.name }));
    else th.innerHTML = U.icon(asset.icon || 'cube', 'ic-lg');
    row.appendChild(th);
    row.appendChild(U.el('div', { class: 'ar-info' }, [
      U.el('b', { text: asset.name }),
      U.el('span', { text: asset.cat + ' · ' + (Library._assetExt(asset) || '—').toUpperCase() })
    ]));
    row.appendChild(U.el('div', { class: 'ar-stat', text: st && st.triangles ? U.formatNumber(st.triangles) + ' tris' : '—' }));
    row.appendChild(U.el('div', { class: 'ar-stat', text: Library._assetSize(asset) ? U.formatBytes(Library._assetSize(asset)) : '—' }));
    row.appendChild(U.el('span', {
      class: 'asset-fav' + (asset.favorite ? ' on' : ''),
      text: asset.favorite ? '★' : '☆',
      onclick: function (e) { e.stopPropagation(); Library.toggleFavorite(asset.id); }
    }));
    return row;
  };

  Library.renderGrid = function () {
    const grid = U.$('#asset-grid');
    if (!grid) return;
    grid.innerHTML = '';
    grid.classList.toggle('list-view', Library.viewMode === 'list');
    const items = Library.filtered();

    if (!items.length) {
      const empty = U.el('div', { class: 'empty-state', style: 'grid-column:1/-1;' }, [
        U.el('div', { class: 'es-icon', text: '🔍' }),
        U.el('b', { text: 'Không tìm thấy asset' }),
        U.el('span', { text: 'Thử từ khoá khác hoặc import file mới.' })
      ]);
      if (Library.tagFilter || Library.fileType !== 'All' || Library.collectionFilter !== 'All') {
        empty.appendChild(U.el('button', {
          class: 'btn sm', text: '✕ Xoá bộ lọc',
          onclick: function () {
            Library.tagFilter = null; Library.fileType = 'All'; Library.collectionFilter = 'All';
            Library.renderCollectionOptions(); Library.renderGrid();
          }
        }));
      }
      grid.appendChild(empty);
    } else {
      items.forEach(function (asset) {
        grid.appendChild(Library.viewMode === 'list' ? Library._buildRow(asset) : Library._buildCard(asset));
      });
    }
    Library.renderFooter();
    Library.renderRecent();
  };

  Library.selectAsset = function (id) {
    Library.selectedAssetId = id;
    const asset = Library.assets.find(function (a) { return a.id === id; });
    if (!asset) return;

    /* Gần đây: ghi dấu load + ghim vào top 5 */
    asset.lastLoadedAt = new Date().toISOString();
    Library._touchRecent(asset.id);
    Library._persistSafe();

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
        if (entry.stats) existing.stats = entry.stats;
        if (entry.fileSize) existing.fileSize = entry.fileSize;
        if (!existing.fileExt) existing.fileExt = Library._deriveExt(existing);
        return;
      }
      Library.assets.push(Library._normalizeAsset({
        id: assetId,
        modelId: id,
        name: entry.name || 'Imported',
        cat: 'Imported',
        type: 'model',
        entry: entry,
        icon: 'model',
        tags: [],
        favorite: false,
        collectionId: null,
        addedAt: new Date().toISOString(),
        fileSize: entry.fileSize || 0,
        fileExt: (function () { const m = /\.([a-z0-9]+)$/i.exec(entry.name || ''); return m ? m[1].toLowerCase() : (entry.isGLB ? 'glb' : ''); })(),
        stats: entry.stats || null
      }));
      added++;
    });
    /* bỏ entry của model đã bị xoá khỏi scene — TRỪ placeholder thiếu file
       (nhóm B: placeholder phải ở lại grid để user bấm "Load lại"). */
    Library.assets = Library.assets.filter(function (a) {
      if (a.type !== 'model') return true;
      if (a.missingFile) return true;
      return !!(a.entry && a.entry.object3D && a.entry.object3D.parent);
    });
    if (added) {
      Library.renderChips();
      Library.renderGrid();
      Library._persistSafe(); /* nhóm B+C: auto save meta sau khi thêm asset mới */
      if (!silent) {
        bus.emit('notify', {
          type: 'success', title: 'Asset Library đã cập nhật',
          message: added + ' model mới được thêm vào thư viện (tab “Imported”).'
        });
      }
    }
    return added;
  };

  /* ============================================================
     MỞ RỘNG (nhóm C) — thao tác asset, collection, bulk,
     xuất/nhập JSON, gần đây, footer, chế độ xem
     ============================================================ */
  Library._findAsset = function (id) {
    return Library.assets.find(function (a) { return a.id === id; }) || null;
  };

  Library._refresh = function () {
    Library.renderGrid();
    Library.renderFooter();
    Library.renderRecent();
    Library.renderCollectionOptions();
  };

  Library._afterChange = function () {
    Library._persistSafe();
    Library._refresh();
  };

  /* ---------- Đổi tên ---------- */
  Library.renameAsset = function (id) {
    const a = Library._findAsset(id);
    if (!a || !PixiStudio.Modals) return;
    PixiStudio.Modals.prompt({
      title: 'Đổi tên asset', label: 'Tên mới:', value: a.name,
      onOk: function (v) {
        const name = (v || '').trim();
        if (!name || name === a.name) return;
        a.name = name;
        if (a.entry) a.entry.name = name;   /* đồng bộ tên model trong scene */
        Library._afterChange();
        /* Undo/Redo toàn diện (v2): tên asset nằm trong snapshot assets */
        if (PixiStudio.History) PixiStudio.History.push('Rename asset ' + name);
        bus.emit('notify', { type: 'success', title: 'Đã đổi tên', message: '“' + name + '”' });
      }
    });
  };

  /* ---------- Xoá ---------- */
  Library.deleteAsset = function (id) {
    const a = Library._findAsset(id);
    if (!a || !PixiStudio.Modals) return;
    PixiStudio.Modals.confirm({
      title: 'Xoá asset', danger: true, okLabel: 'Xoá',
      message: 'Xoá “' + a.name + '” khỏi Asset Library?' + (a.type === 'model' ? ' Model cũng sẽ bị gỡ khỏi scene.' : ' (Sample — có thể tạo lại bằng cách load lại trang.)'),
      onOk: function () {
        Library.assets = Library.assets.filter(function (x) { return x.id !== id; });
        Library._recent = Library._recent.filter(function (x) { return x !== id; });
        delete Library.selectedIds[id];
        if (Library.selectedAssetId === id) Library.selectedAssetId = null;
        if (a.type === 'model' && a.entry && a.entry.object3D) {
          try {
            if (PixiStudio.Scene && typeof PixiStudio.Scene.deleteObject === 'function') PixiStudio.Scene.deleteObject(a.entry.object3D);
            else if (a.entry.object3D.parent) a.entry.object3D.parent.remove(a.entry.object3D);
          } catch (e) { /* gỡ scene thất bại — asset đã khỏi library */ }
          /* Xoá file thật trong store (nhóm B) nếu có — guard kỹ vì store làm song song.
             Dùng removeMeta (xoá cả meta + file) với id bền của store (_storeId || id);
             nếu chưa có removeMeta thì fallback deleteFile. */
          try {
            var Store = window.PixiStudio && PixiStudio.AssetLibraryStore;
            var storeId = a._storeId || a.id;
            if (Store && typeof Store.removeMeta === 'function') Store.removeMeta(storeId);
            else if (Store && typeof Store.deleteFile === 'function') Store.deleteFile(storeId);
          } catch (e) { /* store chưa sẵn sàng — file gốc có thể còn, báo trong notify dưới */ }
        }
        Library._afterChange();
        /* Undo/Redo toàn diện (v2): push SAU khi asset đã khỏi library
           để redo về đúng state cuối (model đã push 1 bước giữa trong
           deleteObject — undo cần 2 bước: asset → model, panel hiện rõ). */
        if (PixiStudio.History) PixiStudio.History.push('Delete asset ' + a.name);
        bus.emit('notify', { type: 'success', title: 'Đã xoá asset', message: '“' + a.name + '”' });
      }
    });
  };

  /* ---------- Nhân bản ----------
     Sample/prop: thêm entry mới cùng variant (không tốn thêm bộ nhớ model).
     Model: thêm entry mới TRỎ CÙNG file/entry — KHÔNG copy file nhị phân
     (copy file cần đọc lại ArrayBuffer từ store + ghi lại, tốn RAM/dung lượng
     IndexedDB; bản sao chỉ là shortcut). Hạn chế: xoá file gốc sẽ ảnh hưởng bản sao. */
  Library.duplicateAsset = function (id) {
    const a = Library._findAsset(id);
    if (!a) return;
    const copy = {};
    Object.keys(a).forEach(function (k) { if (k !== 'entry') copy[k] = a[k]; });
    copy.id = U.uid('asset');
    copy.name = a.name + ' (copy)';
    copy.tags = (a.tags || []).slice();
    copy.favorite = false;
    copy.addedAt = new Date().toISOString();
    copy.lastLoadedAt = undefined;
    if (a.variant) copy.variant = Object.assign({}, a.variant);
    if (a.entry) copy.entry = a.entry;   /* cùng file — xem ghi chú trên */
    Library.assets.push(Library._normalizeAsset(copy));
    Library._afterChange();
    /* Undo/Redo toàn diện (v2) */
    if (PixiStudio.History) PixiStudio.History.push('Duplicate asset ' + copy.name);
    bus.emit('notify', {
      type: 'success', title: 'Đã nhân bản',
      message: '“' + copy.name + '”' + (a.type === 'model' ? ' (trỏ cùng file gốc — xoá file gốc sẽ ảnh hưởng bản sao).' : '')
    });
    return copy.id;
  };

  /* ---------- Favorite / Tag ---------- */
  Library.toggleFavorite = function (id) {
    const a = Library._findAsset(id);
    if (!a) return;
    a.favorite = !a.favorite;
    Library._afterChange();
    /* Undo/Redo toàn diện (v2) */
    if (PixiStudio.History) PixiStudio.History.push((a.favorite ? 'Favorite ' : 'Unfavorite ') + a.name);
    bus.emit('notify', {
      type: 'info', title: a.favorite ? '★ Favorite' : 'Bỏ favorite',
      message: '“' + a.name + '”' + (a.favorite ? ' đã ghim lên đầu grid.' : '')
    });
  };

  Library.addTag = function (id) {
    const a = Library._findAsset(id);
    if (!a || !PixiStudio.Modals) return;
    PixiStudio.Modals.prompt({
      title: 'Thêm tag', label: 'Tag mới (phân tách bằng dấu phẩy nếu nhiều):', value: '',
      placeholder: 'vd: wuxia, kiếm',
      onOk: function (v) {
        const added = [];
        String(v || '').split(',').forEach(function (raw) {
          const t = raw.trim();
          if (t && a.tags.indexOf(t) === -1) { a.tags.push(t); added.push(t); }
        });
        if (!added.length) return;
        Library._afterChange();
        /* Undo/Redo toàn diện (v2) */
        if (PixiStudio.History) PixiStudio.History.push('Tag ' + a.name + ': ' + added.join(', '));
        bus.emit('notify', { type: 'success', title: 'Đã thêm tag', message: added.map(function (t) { return '#' + t; }).join(', ') + ' → “' + a.name + '”' });
      }
    });
  };

  Library.removeTag = function (id, tag) {
    const a = Library._findAsset(id);
    if (!a) return;
    a.tags = (a.tags || []).filter(function (t) { return t !== tag; });
    if (Library.tagFilter === tag) Library.tagFilter = null;
    Library._afterChange();
    /* Undo/Redo toàn diện (v2) */
    if (PixiStudio.History) PixiStudio.History.push('Remove tag ' + tag + ' (' + a.name + ')');
  };

  /* ---------- Collection ---------- */
  Library.createCollection = function () {
    if (!PixiStudio.Modals) return;
    PixiStudio.Modals.prompt({
      title: 'Collection mới', label: 'Tên collection:', value: '',
      placeholder: 'vd: Võ Lâm, Boss, Demo',
      onOk: function (v) {
        const name = (v || '').trim();
        if (!name) return;
        if (Library.collections.some(function (c) { return c.name === name; })) {
          bus.emit('notify', { type: 'warning', title: 'Collection đã có', message: '“' + name + '” đã tồn tại.' });
          return;
        }
        Library.collections.push({ id: U.uid('col'), name: name });
        Library._afterChange();
        bus.emit('notify', { type: 'success', title: 'Đã tạo collection', message: '“' + name + '”' });
      }
    });
  };

  Library.setCollection = function (id, collectionId) {
    const a = Library._findAsset(id);
    if (!a) return;
    a.collectionId = collectionId || null;
    Library._afterChange();
  };

  Library._collectionName = function (collectionId) {
    if (!collectionId) return 'Chưa phân loại';
    const c = Library.collections.find(function (x) { return x.id === collectionId; });
    return c ? c.name : 'Chưa phân loại';
  };

  /* ---------- Chi tiết asset ---------- */
  Library.showDetails = function (id) {
    const a = Library._findAsset(id);
    if (!a || !PixiStudio.Modals) return;
    const st = Library._assetStats(a);
    const clips = (a.entry && a.entry.clips) || [];
    const row = function (k, v) {
      return U.el('div', { class: 'info-row' }, [
        U.el('span', { class: 'i-label', text: k }),
        U.el('span', { class: 'i-value', text: v })
      ]);
    };
    const body = U.el('div', {}, [
      row('Tên', a.name),
      row('Loại', (a.type || '—') + (Library._assetExt(a) ? ' · ' + Library._assetExt(a).toUpperCase() : '')),
      row('Category', a.cat || '—'),
      row('Collection', Library._collectionName(a.collectionId)),
      row('Tris / Verts', st ? U.formatNumber(st.triangles) + ' / ' + U.formatNumber(st.vertices) : '—'),
      row('Bones', st && st.bones !== undefined ? String(st.bones) : '—'),
      row('Clips', clips.length ? clips.map(function (c) { return c.name || c; }).join(', ') : (st && st.animations ? String(st.animations) : '—')),
      row('Textures', st && st.textures !== undefined ? String(st.textures) : '—'),
      row('Dung lượng', Library._assetSize(a) ? U.formatBytes(Library._assetSize(a)) : '—'),
      row('Ngày thêm', a.addedAt ? new Date(a.addedAt).toLocaleString() : '—'),
      row('Load gần nhất', a.lastLoadedAt ? new Date(a.lastLoadedAt).toLocaleString() : '—')
    ]);
    /* tags: xem + xoá từng tag + thêm */
    const tagWrap = U.el('div', { class: 'form-row', style: 'margin-top:10px;' }, [
      U.el('label', { text: 'Tags (click ✕ để xoá):' })
    ]);
    const tagRow = U.el('div', { class: 'asset-tags', style: 'flex-wrap:wrap;' });
    const rebuildTags = function () {
      tagRow.innerHTML = '';
      (a.tags || []).forEach(function (t) {
        tagRow.appendChild(U.el('span', {
          class: 'asset-tag', text: '#' + t + ' ✕',
          onclick: function () { Library.removeTag(a.id, t); Library.showDetails(a.id); }
        }));
      });
      if (!(a.tags || []).length) tagRow.appendChild(U.el('span', { class: 'dim small', text: 'Chưa có tag.' }));
    };
    rebuildTags();
    tagWrap.appendChild(tagRow);
    tagWrap.appendChild(U.el('button', {
      class: 'btn sm', text: '+ Thêm tag', style: 'margin-top:6px;',
      onclick: function () { Library.addTag(a.id); setTimeout(function () { Library.showDetails(a.id); }, 50); }
    }));
    body.appendChild(tagWrap);
    /* đổi collection */
    const colWrap = U.el('div', { class: 'form-row' }, [U.el('label', { text: 'Collection:' })]);
    const colSel = U.el('select', { class: 'input' });
    colSel.appendChild(U.el('option', { value: '', text: 'Chưa phân loại' }));
    Library.collections.forEach(function (c) { colSel.appendChild(U.el('option', { value: c.id, text: c.name })); });
    colSel.value = a.collectionId || '';
    colSel.addEventListener('change', function () { Library.setCollection(a.id, colSel.value || null); });
    colWrap.appendChild(colSel);
    body.appendChild(colWrap);

    PixiStudio.Modals.open({
      title: 'Chi tiết asset',
      body: body,
      buttons: [
        { label: 'Load', class: 'btn primary', onClick: function () { Library.selectAsset(a.id); } },
        { label: 'Rename…', class: 'btn', onClick: function () { Library.renameAsset(a.id); } },
        { label: 'Delete', class: 'btn danger', onClick: function () { Library.deleteAsset(a.id); } },
        { label: 'Close', class: 'btn' }
      ]
    });
  };

  /* ---------- Chọn nhiều (bulk) ---------- */
  Library.toggleMultiSelect = function () {
    Library.multiSelect = !Library.multiSelect;
    if (!Library.multiSelect) Library.selectedIds = {};
    Library.renderGrid();
    Library.renderFooter();
  };

  Library.toggleSelect = function (id) {
    if (Library.selectedIds[id]) delete Library.selectedIds[id];
    else Library.selectedIds[id] = true;
    Library.renderGrid();
    Library.renderFooter();
  };

  Library._selectedAssets = function () {
    return Library.assets.filter(function (a) { return !!Library.selectedIds[a.id]; });
  };

  Library.selectAllFiltered = function () {
    Library.filtered().forEach(function (a) { Library.selectedIds[a.id] = true; });
    Library.renderGrid();
    Library.renderFooter();
  };

  Library.clearSelection = function () {
    Library.selectedIds = {};
    Library.renderGrid();
    Library.renderFooter();
  };

  Library.deleteSelected = function () {
    const sel = Library._selectedAssets();
    if (!sel.length || !PixiStudio.Modals) return;
    PixiStudio.Modals.confirm({
      title: 'Xoá ' + sel.length + ' asset đã chọn', danger: true, okLabel: 'Xoá tất cả',
      message: 'Xoá ' + sel.length + ' asset khỏi library? ' + sel.slice(0, 5).map(function (a) { return '“' + a.name + '”'; }).join(', ') + (sel.length > 5 ? '…' : ''),
      onOk: function () {
        const ids = sel.map(function (a) { return a.id; });
        ids.forEach(function (id) {
          const a = Library._findAsset(id);
          if (!a) return;
          if (a.type === 'model' && a.entry && a.entry.object3D) {
            try {
              if (PixiStudio.Scene && typeof PixiStudio.Scene.deleteObject === 'function') PixiStudio.Scene.deleteObject(a.entry.object3D);
              else if (a.entry.object3D.parent) a.entry.object3D.parent.remove(a.entry.object3D);
            } catch (e) { /* bỏ qua */ }
            try {
              var Store = window.PixiStudio && PixiStudio.AssetLibraryStore;
              var storeId = a._storeId || a.id;
              if (Store && typeof Store.removeMeta === 'function') Store.removeMeta(storeId);
              else if (Store && typeof Store.deleteFile === 'function') Store.deleteFile(storeId);
            } catch (e) { /* store chưa sẵn sàng */ }
          }
        });
        Library.assets = Library.assets.filter(function (a) { return ids.indexOf(a.id) === -1; });
        Library._recent = Library._recent.filter(function (x) { return ids.indexOf(x) === -1; });
        Library.selectedIds = {};
        if (Library.selectedAssetId && ids.indexOf(Library.selectedAssetId) !== -1) Library.selectedAssetId = null;
        Library._afterChange();
        /* Undo/Redo toàn diện (v2): bước cuối của batch (model đã push
           từng bước trong deleteObject ở trên). */
        if (PixiStudio.History) PixiStudio.History.push('Delete ' + ids.length + ' assets');
        bus.emit('notify', { type: 'success', title: 'Đã xoá', message: ids.length + ' asset đã xoá.' });
      }
    });
  };

  Library.tagSelected = function () {
    const sel = Library._selectedAssets();
    if (!sel.length || !PixiStudio.Modals) return;
    PixiStudio.Modals.prompt({
      title: 'Gắn tag hàng loạt', label: 'Tag (phân tách bằng dấu phẩy):', value: '',
      placeholder: 'vd: wuxia',
      onOk: function (v) {
        const tags = String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        if (!tags.length) return;
        sel.forEach(function (a) {
          Library._normalizeAsset(a);
          tags.forEach(function (t) { if (a.tags.indexOf(t) === -1) a.tags.push(t); });
        });
        Library._afterChange();
        bus.emit('notify', { type: 'success', title: 'Đã gắn tag', message: tags.map(function (t) { return '#' + t; }).join(', ') + ' → ' + sel.length + ' asset.' });
      }
    });
  };

  /* ---------- Xuất / nhập library JSON ----------
     CHỈ metadata (tên, loại, cat, tags, favorite, collection, addedAt,
     fileSize, fileExt, stats, variant sample, modelId). KHÔNG kèm file
     nhị phân — file JSON này chỉ khôi phục được metadata + sample;
     model import cần file gốc (FBX/GLB/OBJ/STL) để import lại. */
  Library._sanitizeAsset = function (a) {
    const out = {
      id: a.id, name: a.name, cat: a.cat, type: a.type, icon: a.icon || undefined,
      tags: (a.tags || []).slice(), favorite: !!a.favorite,
      collectionId: a.collectionId || null,
      addedAt: a.addedAt || null, lastLoadedAt: a.lastLoadedAt || null,
      fileSize: Library._assetSize(a), fileExt: Library._assetExt(a),
      stats: Library._assetStats(a) || null
    };
    if (a.variant) out.variant = a.variant;
    if (a.modelId) out.modelId = a.modelId;
    return out;
  };

  Library.exportLibraryJSON = function () {
    const data = {
      app: 'PixiStudio Asset Library', version: 1, exportedAt: new Date().toISOString(),
      note: 'Metadata-only export — model import cần file gốc, file JSON không chứa file nhị phân.',
      collections: Library.collections.slice(),
      assets: Library.assets.map(function (a) { return Library._sanitizeAsset(a); })
    };
    U.downloadText(JSON.stringify(data, null, 2), 'asset-library-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
    bus.emit('notify', { type: 'success', title: 'Đã xuất library', message: data.assets.length + ' asset (metadata) → file JSON.' });
  };

  Library.exportSelectedJSON = function () {
    const sel = Library._selectedAssets();
    if (!sel.length) return;
    const data = {
      app: 'PixiStudio Asset Library', version: 1, exportedAt: new Date().toISOString(),
      note: 'Metadata-only export — model import cần file gốc.',
      collections: Library.collections.slice(),
      assets: sel.map(function (a) { return Library._sanitizeAsset(a); })
    };
    U.downloadText(JSON.stringify(data, null, 2), 'asset-selected-' + sel.length + '.json', 'application/json');
    bus.emit('notify', { type: 'success', title: 'Đã xuất', message: sel.length + ' asset đã chọn → file JSON.' });
  };

  Library.importLibraryJSON = function (file) {
    if (!file) return;
    U.readFileAsText(file).then(function (text) {
      let data;
      try { data = JSON.parse(text); } catch (e) { throw new Error('File JSON không hợp lệ.'); }
      const incoming = Array.isArray(data) ? data : (data.assets || []);
      if (!Array.isArray(incoming)) throw new Error('File JSON không chứa danh sách asset.');
      let imported = 0, skipped = 0;
      incoming.forEach(function (raw) {
        if (!raw || !raw.id || !raw.name) { skipped++; return; }
        if (Library._findAsset(raw.id)) { skipped++; return; }   /* bỏ qua trùng id */
        const a = Library._normalizeAsset(Object.assign({}, raw));
        /* model import từ JSON không có entry/file thật → giữ metadata, load lại khi có file */
        if (a.type === 'model' && !a.entry) a.entry = null;
        Library.assets.push(a);
        imported++;
      });
      if (Array.isArray(data.collections)) {
        data.collections.forEach(function (c) {
          if (c && c.id && !Library.collections.some(function (x) { return x.id === c.id; })) Library.collections.push({ id: c.id, name: c.name || c.id });
        });
      }
      Library._afterChange();
      bus.emit('notify', {
        type: 'success', title: 'Đã nhập library',
        message: 'Đã nhập ' + imported + ' asset mới' + (skipped ? ' (bỏ qua ' + skipped + ' trùng/không hợp lệ)' : '') + '. Model import cần file gốc để load lại.'
      });
    }).catch(function (err) {
      bus.emit('notify', { type: 'error', title: 'Nhập library lỗi', message: err && err.message ? err.message : 'Không đọc được file.' });
    });
  };

  /* ---------- Footer: đếm asset + tổng dung lượng ---------- */
  Library.renderFooter = function () {
    const foot = U.$('#asset-lib-footer');
    if (!foot) return;
    const countEl = U.$('#asset-lib-count', foot);
    if (countEl) {
      const total = Library.assets.reduce(function (s, a) { return s + (Library._assetSize(a) || 0); }, 0);
      const selCount = Object.keys(Library.selectedIds).length;
      countEl.textContent = Library.assets.length + ' asset · ' + U.formatBytes(total) +
        (Library.multiSelect && selCount ? ' · đã chọn ' + selCount : '');
    }
    const tagNote = U.$('#asset-tag-filter-note');
    if (tagNote) {
      if (Library.tagFilter) {
        tagNote.style.display = '';
        tagNote.textContent = 'Lọc tag: #' + Library.tagFilter + ' ✕';
      } else tagNote.style.display = 'none';
    }
    const bulk = U.$('#asset-bulk-bar');
    if (bulk) {
      bulk.style.display = Library.multiSelect ? '' : 'none';
      const n = U.$('#asset-bulk-count', bulk);
      if (n) n.textContent = 'Đã chọn ' + Object.keys(Library.selectedIds).length + ' asset';
    }
    const multiBtn = U.$('#asset-multi-toggle');
    if (multiBtn) multiBtn.classList.toggle('active', Library.multiSelect);
    const viewBtn = U.$('#asset-view-toggle');
    if (viewBtn) viewBtn.textContent = Library.viewMode === 'list' ? '⊞ Lưới' : '☰ Danh sách';
  };

  /* ---------- Gần đây: 5 asset load gần nhất ---------- */
  Library.renderRecent = function () {
    const box = U.$('#asset-recent');
    if (!box) return;
    const filtersActive = Library.search.trim() || Library.tagFilter ||
      Library.fileType !== 'All' || Library.collectionFilter !== 'All' || Library.category !== 'All';
    box.innerHTML = '';
    if (Library.sort !== 'default' || filtersActive || !Library._recent.length) {
      box.style.display = 'none';
      return;
    }
    box.style.display = '';
    box.appendChild(U.el('div', { class: 'ar-title', text: '🕘 Gần đây' }));
    const row = U.el('div', { class: 'ar-row' });
    Library._recent.forEach(function (id) {
      const a = Library._findAsset(id);
      if (!a) return;
      const thumb = Library.generateThumbnail(a);
      const chip = U.el('div', {
        class: 'ar-chip',
        title: a.name,
        onclick: function () { Library.selectAsset(a.id); }
      });
      if (thumb) chip.appendChild(U.el('img', { src: thumb, alt: a.name }));
      else chip.innerHTML = U.icon(a.icon || 'cube', 'ic-lg');
      chip.appendChild(U.el('span', { text: a.name }));
      row.appendChild(chip);
    });
    box.appendChild(row);
  };

  /* ---------- Collection select (toolbar) ---------- */
  Library.renderCollectionOptions = function () {
    const sel = U.$('#asset-collection');
    if (!sel) return;
    const cur = Library.collectionFilter;
    sel.innerHTML = '';
    sel.appendChild(U.el('option', { value: 'All', text: 'Tất cả collection' }));
    sel.appendChild(U.el('option', { value: '__none__', text: 'Chưa phân loại' }));
    Library.collections.forEach(function (c) { sel.appendChild(U.el('option', { value: c.id, text: c.name })); });
    sel.value = Library.collections.some(function (c) { return c.id === cur; }) || cur === 'All' || cur === '__none__' ? cur : 'All';
    if (sel.value !== cur) Library.collectionFilter = sel.value;
  };

  Library.setViewMode = function (mode) {
    Library.viewMode = mode === 'list' ? 'list' : 'grid';
    Library._persistSafe();
    Library.renderGrid();
  };

  /* ---------- Toolbar + footer + recent: tạo động (không sửa index.html) ---------- */
  Library._buildExtraUI = function () {
    if (Library._extraBuilt) return;
    Library._extraBuilt = true;
    const grid = U.$('#asset-grid');
    const chips = U.$('#asset-filter-chips');
    if (!grid || !chips) return;

    /* Toolbar: loại file / sắp xếp / collection / view / chọn nhiều / +collection */
    const bar = U.el('div', { id: 'asset-lib-extra' });
    const mkSelect = function (id, options, cur, onChange) {
      const sel = U.el('select', { id: id, class: 'input al-select' });
      options.forEach(function (o) { sel.appendChild(U.el('option', { value: o.id || o.value, text: o.label || o.text })); });
      sel.value = cur;
      sel.addEventListener('change', function () { onChange(sel.value); });
      return sel;
    };
    bar.appendChild(mkSelect('asset-filetype', FILE_TYPES.map(function (f) { return { value: f, text: f === 'All' ? 'Tất cả loại file' : f }; }), Library.fileType, function (v) {
      Library.fileType = v; Library.renderGrid();
    }));
    bar.appendChild(mkSelect('asset-sort', SORTS, Library.sort, function (v) {
      Library.sort = v; Library.renderGrid();
    }));
    bar.appendChild(mkSelect('asset-collection', [{ value: 'All', text: 'Tất cả collection' }], Library.collectionFilter, function (v) {
      Library.collectionFilter = v; Library.renderGrid();
    }));
    bar.appendChild(U.el('button', {
      id: 'asset-view-toggle', class: 'btn sm', text: '☰ Danh sách',
      onclick: function () { Library.setViewMode(Library.viewMode === 'list' ? 'grid' : 'list'); }
    }));
    bar.appendChild(U.el('button', {
      id: 'asset-multi-toggle', class: 'btn sm', text: '☑ Chọn nhiều',
      onclick: function () { Library.toggleMultiSelect(); }
    }));
    bar.appendChild(U.el('button', {
      id: 'asset-new-collection', class: 'btn sm', text: '+ Collection',
      onclick: function () { Library.createCollection(); }
    }));
    const tagNote = U.el('span', {
      id: 'asset-tag-filter-note', class: 'asset-tag-filter-note', style: 'display:none;',
      onclick: function () { Library.tagFilter = null; Library.renderGrid(); }
    });
    bar.appendChild(tagNote);
    grid.parentNode.insertBefore(bar, grid);

    /* Bulk bar (chỉ hiện khi chọn nhiều) */
    const bulk = U.el('div', { id: 'asset-bulk-bar', style: 'display:none;' }, [
      U.el('span', { id: 'asset-bulk-count', class: 'dim small', text: 'Đã chọn 0 asset' }),
      U.el('button', { class: 'btn sm', text: 'Chọn tất cả', onclick: function () { Library.selectAllFiltered(); } }),
      U.el('button', { class: 'btn sm', text: 'Bỏ chọn', onclick: function () { Library.clearSelection(); } }),
      U.el('button', { class: 'btn sm', text: 'Gắn tag…', onclick: function () { Library.tagSelected(); } }),
      U.el('button', { class: 'btn sm', text: 'Xuất JSON đã chọn', onclick: function () { Library.exportSelectedJSON(); } }),
      U.el('button', { class: 'btn sm danger', text: 'Xoá đã chọn', onclick: function () { Library.deleteSelected(); } })
    ]);
    grid.parentNode.insertBefore(bulk, grid);

    /* Gần đây */
    const recent = U.el('div', { id: 'asset-recent', style: 'display:none;' });
    grid.parentNode.insertBefore(recent, grid);

    /* Footer: đếm + tổng dung lượng + xuất/nhập JSON */
    const foot = U.el('div', { id: 'asset-lib-footer' });
    foot.appendChild(U.el('span', { id: 'asset-lib-count', class: 'dim small', text: '' }));
    const footBtns = U.el('div', { class: 'al-foot-btns' });
    footBtns.appendChild(U.el('button', { class: 'btn sm', text: '⬇ Xuất JSON', onclick: function () { Library.exportLibraryJSON(); } }));
    footBtns.appendChild(U.el('button', {
      class: 'btn sm', text: '⬆ Nhập JSON',
      onclick: function () { const inp = U.$('#asset-import-json'); if (inp) inp.click(); }
    }));
    foot.appendChild(footBtns);
    const importZone = U.$('#import-btn-zone');
    /* FIX tích hợp (coordinator, sau nhóm A dời zone lên đầu #page-assets):
       insertBefore chỉ hợp lệ khi importZone cùng parent với grid; zone giờ
       nằm ngoài .panel-body nên phải appendChild thay vì insertBefore,
       nếu không sẽ ném NotFoundError và chết AssetLibrary.init() giữa chừng. */
    if (importZone && importZone.parentNode === grid.parentNode) grid.parentNode.insertBefore(foot, importZone);
    else grid.parentNode.appendChild(foot);

    /* input file ẩn cho nhập JSON */
    const inp = U.el('input', { type: 'file', id: 'asset-import-json', accept: '.json,application/json', style: 'display:none;' });
    inp.addEventListener('change', function () {
      if (inp.files && inp.files[0]) Library.importLibraryJSON(inp.files[0]);
      inp.value = '';
    });
    document.body.appendChild(inp);
  };

  /* Block dung lượng + xóa dữ liệu ở cuối panel Asset Library (nhóm B).
     Library._persist() đã có sẵn do nhóm C định nghĩa (dòng ~139) — dùng
     chung, không định nghĩa lại ở đây. */
  Library.renderStorageBlock = function () {
    var host = U.$('#page-assets .panel-body');
    if (!host || U.$('#asset-storage-block')) return;
    var block = U.el('div', { class: 'section-block', id: 'asset-storage-block', style: 'margin:10px 12px 14px;' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('i', { 'data-ic': 'save', class: 'ic' }),
        document.createTextNode(' Lưu trữ Library')
      ]),
      U.el('div', { class: 'section-content' }, [
        U.el('div', { id: 'asset-storage-usage', class: 'dim small', text: 'Đang tính…' }),
        U.el('button', {
          class: 'btn danger block', style: 'margin-top:8px;',
          html: U.icon('trash') + '<span>Xóa toàn bộ dữ liệu library</span>',
          onclick: function () {
            if (PixiStudio.Modals && PixiStudio.Modals.confirm) {
              PixiStudio.Modals.confirm({
                title: 'Xóa dữ liệu library?',
                message: 'Sẽ xóa metadata + toàn bộ file model đã lưu (localStorage + IndexedDB). Model đang mở vẫn còn trong scene, nhưng tắt trang sẽ không tự tải lại nữa.',
                danger: true, okLabel: 'Xóa hết',
                onOk: function () { if (PixiStudio.AssetLibraryStore) PixiStudio.AssetLibraryStore.clearAll(); }
              });
            } else if (PixiStudio.AssetLibraryStore) {
              PixiStudio.AssetLibraryStore.clearAll();
            }
          }
        })
      ])
    ]);
    host.appendChild(block);
    if (PixiStudio.AssetLibraryStore) PixiStudio.AssetLibraryStore.updateUsageUI();
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
    Library._buildExtraUI();
    Library.renderCollectionOptions();
    Library.renderGrid();
    Library.renderStorageBlock(); /* nhóm B: block dung lượng + xóa dữ liệu */

    /* AUTO LOAD (nhóm B): khôi phục library đã lưu — chạy async song song
       với loadDefault ở app.js, store tự guard chống chạy 2 lần. */
    if (PixiStudio.AssetLibraryStore) {
      PixiStudio.AssetLibraryStore.init();
      PixiStudio.AssetLibraryStore.restore();
    }

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
