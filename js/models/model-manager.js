/* ============================================================
 * models/model-manager.js — Registry model, load GLB/GLTF chuẩn,
 * normalize scale, stats thật, load default kiemhiep.glb.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const CONFIG = {
    DEFAULT_MODEL_URL: 'assets/models/kiemhiep.glb',
    DEFAULT_MODEL_NAME: 'Hero_001',
    TARGET_HEIGHT: 2.0
  };

  const Manager = {
    models: {},          // id -> { id, name, object3D, stats, isGLB, fileSize, url }
    currentId: null,
    config: CONFIG
  };

  /* ---------- STATS THẬT từ geometry ---------- */
  Manager.computeStats = function (object3D) {
    let vertices = 0, triangles = 0, meshes = 0, materials = 0, textures = 0;
    const matSet = new Set(), texSet = new Set();

    object3D.traverse(function (o) {
      if (!o.isMesh) return;
      meshes++;
      const geo = o.geometry;
      if (geo && geo.attributes && geo.attributes.position) {
        vertices += geo.attributes.position.count;
        const index = geo.index;
        triangles += index ? index.count / 3 : geo.attributes.position.count / 3;
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m) return;
        materials += 1;
        matSet.add(m.uuid);
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'].forEach(function (k) {
          if (m[k]) { texSet.add(m[k].uuid); textures += 1; }
        });
      });
    });

    const box = new THREE.Box3().setFromObject(object3D);
    const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());

    return {
      vertices: Math.round(vertices),
      faces: Math.round(triangles),
      triangles: Math.round(triangles),
      meshes: meshes,
      materials: matSet.size,
      materialCount: materials,
      textures: texSet.size,
      size: [U.round(size.x, 2), U.round(size.y, 2), U.round(size.z, 2)],
      height: U.round(size.y, 2)
    };
  };

  /* ---------- NORMALIZE: height ≈ 2.0, đáy chạm grid, center XZ ---------- */
  Manager.normalize = function (object3D) {
    const box = new THREE.Box3().setFromObject(object3D);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const scale = CONFIG.TARGET_HEIGHT / Math.max(0.0001, size.y);
    object3D.scale.multiplyScalar(scale);

    /* Sau scale tính lại box để đặt vị trí */
    object3D.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(object3D);
    const center2 = box2.getCenter(new THREE.Vector3());
    object3D.position.x -= center2.x;
    object3D.position.z -= center2.z;
    object3D.position.y -= box2.min.y;   /* đáy chạm lưới */
    object3D.updateMatrixWorld(true);
  };

  /* ---------- LOADERS ---------- */
  function createGLTFLoader() {
    const loader = new THREE.GLTFLoader();
    /* Meshopt decoder — kiemhiep.glb dùng EXT_meshopt_compression */
    if (window.MeshoptDecoder && loader.setMeshoptDecoder) {
      loader.setMeshoptDecoder(window.MeshoptDecoder);
    }
    return loader;
  }

  function registerModel(object3D, opts) {
    const id = U.uid('model');
    const stats = Manager.computeStats(object3D);
    const entry = {
      id: id,
      name: opts.name || 'Model',
      object3D: object3D,
      stats: stats,
      isGLB: !!opts.isGLB,
      fileSize: opts.fileSize || 0,
      url: opts.url || null,
      clips: opts.clips || []        // AnimationClip từ GLB
    };
    object3D.name = entry.name;
    /* Lưu ý: KHÔNG gán trực tiếp userData.modelEntry = entry.
       entry.object3D trỏ ngược lại object3D → tham chiếu VÒNG, và
       Object3D.copy() của three dùng JSON.stringify(userData) nên clone()/
       duplicate() object sẽ tràn stack (Maximum call stack size exceeded).
       Dùng defineProperty non-enumerable: code đọc vẫn thấy, JSON bỏ qua. */
    Object.defineProperty(object3D.userData, 'modelEntry', {
      value: entry, enumerable: false, writable: true, configurable: true
    });
    Manager.models[id] = entry;
    Manager.currentId = id;

    PixiStudio.Viewport.addModel(object3D);

    if (PixiStudio.Scene) PixiStudio.Scene.register(object3D, 'model', entry.name);

    /* Chọn model vừa load */
    PixiStudio.State.select(object3D, { modelId: id });

    bus.emit('model:loaded', {
      id: id, name: entry.name, stats: stats, isGLB: entry.isGLB,
      fileSize: entry.fileSize, clips: entry.clips.map(function (c) { return { name: c.name, duration: c.duration }; })
    });

    return entry;
  }

  Manager.loadGLBFromBuffer = function (arrayBuffer, name, fileSize) {
    return new Promise(function (resolve, reject) {
      if (!window.THREE || !THREE.GLTFLoader) {
        reject(new Error('GLTFLoader chưa sẵn sàng (CDN lỗi?). Kiểm tra kết nối mạng.'));
        return;
      }
      const loader = createGLTFLoader();
      PixiStudio.Notifications.showLoading('Đang parse ' + (name || 'model') + '…');
      try {
        loader.parse(arrayBuffer, '', function (gltf) {
          PixiStudio.Notifications.hideLoading();
          const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
          if (!model) { reject(new Error('GLB không chứa scene')); return; }
          Manager.normalize(model);
          model.traverse(function (o) {
            if (o.isMesh) {
              o.castShadow = true;
              o.receiveShadow = false;
              /* GLTF texture encoding chuẩn hoá */
              if (o.material && o.material.map) o.material.map.encoding = THREE.sRGBEncoding;
            }
          });
          /* FIX IAB BLOCK: downscale texture display ≤1024 — giữ original cho export */
          if (PixiStudio.Textures) PixiStudio.Textures.optimizeDisplay(model, (PixiStudio.State.settings && PixiStudio.State.settings.displayTextureMax) || 512);
          const entry = registerModel(model, {
            name: name || 'GLB Model',
            isGLB: true,
            fileSize: fileSize || 0,
            clips: gltf.animations || []
          });
          resolve(entry);
        }, function (err) {
          PixiStudio.Notifications.hideLoading();
          console.error('[ModelManager] GLB parse lỗi:', err);
          reject(new Error('Parse GLB thất bại: ' + (err && err.message ? err.message : 'file lỗi hoặc dùng Draco compression chưa hỗ trợ')));
        });
      } catch (err) {
        PixiStudio.Notifications.hideLoading();
        reject(err);
      }
    });
  };

  Manager.loadURL = function (url, name) {
    return new Promise(function (resolve, reject) {
      if (!window.THREE || !THREE.GLTFLoader) {
        reject(new Error('GLTFLoader chưa sẵn sàng (CDN lỗi?).'));
        return;
      }
      PixiStudio.Notifications.showLoading('Đang tải model mẫu chuẩn…', 0);
      const loader = createGLTFLoader();
      loader.load(url, function (gltf) {
        PixiStudio.Notifications.hideLoading();
        const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (!model) { reject(new Error('GLB không chứa scene')); return; }
        Manager.normalize(model);
        model.traverse(function (o) {
          if (o.isMesh) {
            o.castShadow = true;
            if (o.material && o.material.map) o.material.map.encoding = THREE.sRGBEncoding;
          }
        });
        /* FIX IAB BLOCK: downscale texture display */
        if (PixiStudio.Textures) PixiStudio.Textures.optimizeDisplay(model, (PixiStudio.State.settings && PixiStudio.State.settings.displayTextureMax) || 512);
        resolve(registerModel(model, {
          name: name || (url.split('/').pop() || 'GLB Model'),
          isGLB: true,
          url: url,
          clips: gltf.animations || []
        }));
      }, function (progress) {
        if (progress.total) {
          const pct = Math.round(progress.loaded / progress.total * 100);
          PixiStudio.Notifications.updateLoading(pct, 'Đang tải model mẫu chuẩn… ' + pct + '%');
        } else {
          PixiStudio.Notifications.updateLoading(30, 'Đang tải model mẫu chuẩn… (' + U.formatBytes(progress.loaded) + ')');
        }
      }, function (err) {
        PixiStudio.Notifications.hideLoading();
        reject(err && err.target ? new Error('HTTP load thất bại') : err);
      });
    });
  };

  /* OBJ / STL loaders */
  Manager.loadOBJFromBuffer = function (arrayBuffer, name) {
    return new Promise(function (resolve, reject) {
      if (!THREE.OBJLoader) { reject(new Error('OBJLoader chưa load (CDN)')); return; }
      try {
        const text = new TextDecoder().decode(arrayBuffer);
        const obj = new THREE.OBJLoader().parse(text);
        Manager.normalize(obj);
        obj.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
        resolve(registerModel(obj, { name: name || 'OBJ Model', isGLB: false }));
      } catch (err) { reject(err); }
    });
  };

  Manager.loadSTLFromBuffer = function (arrayBuffer, name) {
    return new Promise(function (resolve, reject) {
      if (!THREE.STLLoader) { reject(new Error('STLLoader chưa load (CDN)')); return; }
      try {
        const geo = new THREE.STLLoader().parse(arrayBuffer);
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.5, metalness: 0.3 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        const obj = new THREE.Group();
        obj.add(mesh);
        Manager.normalize(obj);
        resolve(registerModel(obj, { name: name || 'STL Model', isGLB: false }));
      } catch (err) { reject(err); }
    });
  };

  /* ---------- LOAD DEFAULT — auto-detect GLB trong assets/models qua /api/models ---------- */
  Manager.loadDefault = function () {
    /* ưu tiên: kiemhiep* → tripo_* → Meshy_* → file mới nhất bất kỳ */
    return fetch('/api/models').then(function (r) { return r.json(); }).catch(function () { return { files: null }; }).then(function (list) {
      let url = CONFIG.DEFAULT_MODEL_URL;
      let name = CONFIG.DEFAULT_MODEL_NAME;
      if (list && list.files && list.files.length) {
        const files = list.files;
        /* Bỏ qua file do app xuất ra (_animated_/_opt/_hq…) khi chọn model NGUỒN —
           tránh app tự load file đã rig/animate thay vì model gốc của người dùng */
        const sources = files.filter(function (f) {
          return !/(_animated_|_anim_|_opt\.|_hq\.|_decimated|_export|_save|_lods?)/i.test(f.name);
        });
        const pool = sources.length ? sources : files;
        const pickBy = function (re) { return pool.find(function (f) { return re.test(f.name); }); };
        const chosen = pickBy(/^kiemhiep(?!\-full)/i) || pickBy(/^tripo_/i) || pickBy(/^meshy_/i) || pool.slice().sort(function (a, b) { return b.mtime - a.mtime; })[0];
        url = chosen.url;
        name = chosen.name.replace(/\.glb$/i, '').replace(/^tripo_convert_/i, '').replace(/^Meshy_AI_/i, '').slice(0, 24) || 'Hero_001';
        bus.emit('notify', { type: 'info', title: 'Model mẫu', message: 'Nạp ' + chosen.name + ' (' + (chosen.size / 1048576).toFixed(1) + ' MB)' });
      }
      return U.readFileViaFetch(url).then(function (buf) {
        return Manager.loadGLBFromBuffer(buf, name, buf.byteLength);
      });
    }).then(function (entry) {
      bus.emit('notify', {
        type: 'success', title: 'Đã tải model mẫu chuẩn',
        message: entry.name + ' — ' + U.formatNumber(entry.stats.triangles) + ' tris, ' + entry.stats.meshes + ' meshes, ' + U.formatBytes(entry.fileSize || 0)
      });
      /* Nạp clip GLB vào animation manager nếu có */
      if (entry.clips.length && PixiStudio.Anim) {
        PixiStudio.Anim.registerGLTFClips(entry.object3D, entry.clips);
      }
      return entry;
    }).catch(function (err) {
      console.warn('[ModelManager] Load default thất bại → fallback chibi:', err);
      /* FALLBACK: chibi procedural — vẫn có gì đó hiển thị */
      const fallback = PixiStudio.SampleModel.createChibiWuxia({ name: 'Hero_001' });
      const entry = registerModel(fallback, { name: 'Hero_001 (Sample)', isGLB: false });
      bus.emit('notify', {
        type: 'warning', title: 'Không tải được assets/models/kiemhiep.glb',
        message: 'File:// chặn fetch GLB. Nhấp đúp server.bat → mở http://localhost:8080. Tạm hiển thị nhân vật chibi mẫu. Hoặc kéo-thả file GLB vào đây để import.',
        sticky: false, duration: 9000
      });
      return entry;
    });
  };

  /* ---------- CRUD ---------- */
  Manager.remove = function (id) {
    const entry = Manager.models[id];
    if (!entry) return;
    PixiStudio.Viewport.removeModel(entry.object3D);
    if (PixiStudio.Scene) PixiStudio.Scene.unregister(entry.object3D);
    /* dispose geometries */
    entry.object3D.traverse(function (o) {
      if (o.isMesh) {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) { if (m) m.dispose(); });
      }
    });
    delete Manager.models[id];
    if (Manager.currentId === id) Manager.currentId = null;
    bus.emit('model:removed', { id: id, name: entry.name });
  };

  Manager.removeCurrent = function () {
    if (Manager.currentId) Manager.remove(Manager.currentId);
  };

  Manager.getCurrent = function () {
    return Manager.currentId ? Manager.models[Manager.currentId] : null;
  };

  Manager.getStats = function () {
    const cur = Manager.getCurrent();
    return cur ? cur.stats : null;
  };

  window.PixiStudio.Models = Manager;
})();
