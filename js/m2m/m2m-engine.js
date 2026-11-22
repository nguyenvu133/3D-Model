/* m2m/m2m-engine.js — engine 3D cho mesh2motion.html
 * Viewport (Three.js) + nạp model + rig + playback + timeline + remix + export + import.
 * Dùng lại: PixiStudio.M2MMotion (catalog + retarget) và PixiStudio.CreatureRigs (dựng rig theo họ).
 */
(function () {
  'use strict';
  const P = window.PixiStudio;
  const U = P.Utils;
  const bus = P.bus;

  const Page = {
    scene: null, camera: null, renderer: null, wrap: null, canvas: null,
    modelRoot: null, gridGroup: null, lightGroup: null, skeletonHelper: null,
    orbit: { theta: 0.5, phi: 1.25, radius: 4.2, target: null, dTheta: 0.5, dPhi: 1.25, dRadius: 4.2, dTarget: null },
    action: null, clip: null, clipName: '', duration: 0, time: 0,
    speed: 1, loop: true, paused: false,
    playing: false, fps: 60, lastT: 0, frames: 0, fpsNow: 0,
    settings: { background: '#0a1020', grid: true, shadows: true, wireframe: false, skeleton: false, uiScale: 1, cameraSpeed: 1, fov: 38 },
    currentEntry: null,
    remix: { list: [], index: 0, playing: false, actionA: null, actionB: null, transition: 0.25, timer: 0 },
    _cache: {}
  };

  /* ============================ VIEWPORT ============================ */
  Page.init = function (wrapEl) {
    Page.wrap = wrapEl;
    Page.canvas = document.getElementById('m2m-canvas');
    const w = Page.wrap.clientWidth || 900, h = Page.wrap.clientHeight || 600;

    Page.scene = new THREE.Scene();
    Page.camera = new THREE.PerspectiveCamera(Page.settings.fov, w / h, 0.05, 500);
    Page.orbit.target = new THREE.Vector3(0, 1, 0);
    Page.orbit.dTarget = new THREE.Vector3(0, 1, 0);

    Page.renderer = new THREE.WebGLRenderer({ canvas: Page.canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    Page.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    Page.renderer.setSize(w, h, false);
    Page.renderer.shadowMap.enabled = true;
    Page.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (Page.renderer.outputEncoding !== undefined) Page.renderer.outputEncoding = THREE.sRGBEncoding;
    Page.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    Page.renderer.toneMappingExposure = 1.05;

    /* model root */
    Page.modelRoot = new THREE.Group();
    Page.modelRoot.name = 'Models';
    Page.scene.add(Page.modelRoot);
    P.Viewport.modelRoot = Page.modelRoot;

    /* lights */
    const lights = new THREE.Group();
    lights.name = 'Lights';
    const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x1a2233, 0.85);
    lights.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(3.2, 5.6, 3.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 24;
    key.shadow.camera.left = -4; key.shadow.camera.right = 4;
    key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
    lights.add(key);
    const fill = new THREE.DirectionalLight(0x6ea8ff, 0.55);
    fill.position.set(-3.5, 2.4, -2.6);
    lights.add(fill);
    const rim = new THREE.DirectionalLight(0xb28bff, 0.5);
    rim.position.set(0, 2.2, -4.2);
    lights.add(rim);
    Page.lightGroup = lights;
    Page.scene.add(lights);

    /* grid + ground */
    const grid = new THREE.Group();
    grid.name = 'Grid';
    const gridHelper = new THREE.GridHelper(20, 40, 0x2f4a7a, 0x1b2c47);
    gridHelper.position.y = 0.001;
    grid.add(gridHelper);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(6, 64),
      new THREE.MeshStandardMaterial({ color: 0x101a2c, roughness: 0.95, metalness: 0.05 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    grid.add(ground);
    Page.gridGroup = grid;
    Page.scene.add(grid);

    Page.scene.background = new THREE.Color(Page.settings.background);

    Page._bindInput();
    Page.initGizmo();
    Page.applySettings(Page.settings);
    Page.startLoop();
    window.addEventListener('resize', Page.resize);
    Page.resize();
    return Page;
  };

  Page.resize = function () {
    if (!Page.wrap || !Page.renderer) return;
    const w = Page.wrap.clientWidth || 900, h = Page.wrap.clientHeight || 600;
    Page.renderer.setSize(w, h, false);
    Page.camera.aspect = w / Math.max(1, h);
    Page.camera.updateProjectionMatrix();
  };

  Page.applySettings = function (s) {
    Page.settings = Object.assign(Page.settings, s || {});
    if (Page.scene) Page.scene.background = new THREE.Color(Page.settings.background);
    if (Page.gridGroup) Page.gridGroup.visible = !!Page.settings.grid;
    if (Page.renderer) Page.renderer.shadowMap.enabled = !!Page.settings.shadows;
    if (Page.camera) { Page.camera.fov = Page.settings.fov; Page.camera.updateProjectionMatrix(); }
    Page.setWireframe(!!Page.settings.wireframe);
    Page.setSkeletonVisible(!!Page.settings.skeleton);
    document.documentElement.style.setProperty('--m2m-scale', String(Page.settings.uiScale || 1));
    try { localStorage.setItem('m2m.settings.v1', JSON.stringify(Page.settings)); } catch (e) { }
  };

  Page.loadSettings = function () {
    try {
      const raw = localStorage.getItem('m2m.settings.v1');
      if (raw) Page.settings = Object.assign(Page.settings, JSON.parse(raw));
    } catch (e) { }
    return Page.settings;
  };

  Page.setWireframe = function (on) {
    if (!Page.modelRoot) return;
    Page.modelRoot.traverse(function (o) {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { if (m) m.wireframe = !!on; });
    });
  };

  Page.setSkeletonVisible = function (on) {
    Page.settings.skeleton = !!on;
    const rig = P.RigAutoGen.current;
    if (!rig || !rig.rootBone) {
      if (Page.skeletonHelper) Page.skeletonHelper.visible = false;
      return;
    }
    if (!Page.skeletonHelper) {
      try {
        Page.skeletonHelper = new THREE.SkeletonHelper(rig.rootBone);
        Page.skeletonHelper.material.depthTest = false;
        Page.skeletonHelper.material.linewidth = 2;
        Page.scene.add(Page.skeletonHelper);
      } catch (e) { return; }
    }
    Page.skeletonHelper.root = rig.rootBone;
    Page.skeletonHelper.visible = !!on;
  };

  /* ---------------- camera input ---------------- */
  Page._bindInput = function () {
    const dom = Page.wrap;
    let drag = null;
    dom.addEventListener('pointerdown', function (e) {
      if (e.target !== Page.canvas) return;
      /* để gizmo xử lý trước — không chiếm quyền khi đang hover/kéo tay cầm */
      const tc = Page.gizmo;
      if (tc && (tc.dragging || tc.axis)) { drag = null; return; }
      drag = { x: e.clientX, y: e.clientY, button: e.button };
      dom.setPointerCapture && dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', function (e) {
      if (!drag) return;
      const tc = Page.gizmo;
      if (tc && (tc.dragging || tc.axis)) { drag = null; return; }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      const sp = 0.005 * (Page.settings.cameraSpeed || 1);
      if (drag.button === 0) {
        Page.orbit.dTheta -= dx * sp;
        Page.orbit.dPhi = U.clamp(Page.orbit.dPhi - dy * sp, 0.12, Math.PI - 0.12);
      } else {
        const scale = Page.orbit.radius * 0.0016;
        const right = new THREE.Vector3().setFromMatrixColumn(Page.camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(Page.camera.matrix, 1);
        Page.orbit.dTarget.addScaledVector(right, -dx * scale);
        Page.orbit.dTarget.addScaledVector(up, dy * scale);
      }
    });
    const end = function () { drag = null; };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', function (e) {
      e.preventDefault();
      Page.orbit.dRadius = U.clamp(Page.orbit.dRadius * Math.pow(0.9992, e.deltaY), 0.6, 40);
    }, { passive: false });
    dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };

  /* ---------------- render loop ---------------- */
  Page.startLoop = function () {
    const tick = function (now) {
      requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - (Page.lastT || now)) / 1000);
      Page.lastT = now;
      Page.frames++;
      if (Page.frames % 20 === 0) Page.fpsNow = Math.round(20 / Math.max(0.0001, dt * 20) * 1) || Page.fpsNow;
      if (Page.frames % 30 === 0) Page.fpsNow = Math.round(1 / Math.max(0.0001, dt));
      /* mixer */
      P.RigAutoGen.update(dt);
      if (Page.playing && Page.action) {
        Page.time = Page.action.time;
        if (Page.duration) {
          if (!Page.loop && Page.time >= Page.duration - 0.001) { Page.playing = false; }
        }
        bus.emit('m2m:time', { time: Page.time, duration: Page.duration, playing: Page.playing });
      }
      if (Page.remix.playing) Page._tickRemix(dt);
      /* camera damping */
      const k = 1 - Math.pow(0.0009, dt);
      const o = Page.orbit;
      o.theta = U.lerp(o.theta, o.dTheta, k);
      o.phi = U.lerp(o.phi, o.dPhi, k);
      o.radius = U.lerp(o.radius, o.dRadius, k);
      o.target.lerp(o.dTarget, k);
      const sinPhi = Math.sin(o.phi);
      Page.camera.position.set(
        o.target.x + o.radius * sinPhi * Math.sin(o.theta),
        o.target.y + o.radius * Math.cos(o.phi),
        o.target.z + o.radius * sinPhi * Math.cos(o.theta)
      );
      Page.camera.lookAt(o.target);
      if (Page.skeletonHelper && Page.skeletonHelper.visible) Page.skeletonHelper.update();
      Page.renderer.render(Page.scene, Page.camera);
      if (Page.frames % 8 === 0) bus.emit('m2m:perf', Page.stats());
    };
    requestAnimationFrame(tick);
  };

  Page.stats = function () {
    let tris = 0, meshes = 0, bones = 0;
    if (Page.modelRoot) Page.modelRoot.traverse(function (o) {
      if (o.isBone) bones++;
      if (o.isMesh && o.geometry) {
        meshes++;
        const g = o.geometry;
        tris += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
      }
    });
    return { fps: Page.fpsNow || 0, tris: Math.round(tris), meshes: meshes, bones: bones, calls: Page.renderer ? Page.renderer.info.render.calls : 0 };
  };

  Page.setView = function (v) {
    const map = {
      perspective: [0.5, 1.25], front: [0, Math.PI / 2], back: [Math.PI, Math.PI / 2],
      left: [-Math.PI / 2, Math.PI / 2], right: [Math.PI / 2, Math.PI / 2],
      top: [0.4, 0.14], bottom: [0.4, Math.PI - 0.14]
    };
    const m = map[v] || map.perspective;
    Page.orbit.dTheta = m[0]; Page.orbit.dPhi = m[1];
    if (v === 'perspective') Page.orbit.dRadius = 4.2;
  };

  Page.focus = function () {
    const target = P.Viewport.getMainModel();
    if (!target) return;
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(s.x, s.y, s.z);
    Page.orbit.dTarget.copy(c);
    Page.orbit.dRadius = U.clamp(maxDim / (2 * Math.tan((Page.camera.fov * Math.PI / 180) / 2)) * 1.6, 0.6, 40);
  };

  Page.screenshot = function (w, h) {
    if (!Page.renderer) return null;
    Page.renderer.render(Page.scene, Page.camera);
    return Page.renderer.domElement.toDataURL('image/png');
  };

  /* ============================ MODEL ============================ */
  Page._registerModel = function (object3D, name, extra) {
    const id = 'm2m-' + Date.now() + '-' + Math.floor(Math.random() * 999);
    let tris = 0, bones = 0, skinned = 0;
    object3D.traverse(function (o) {
      if (o.isBone) bones++;
      if (o.isSkinnedMesh) skinned++;
      if (o.isMesh && o.geometry) {
        const g = o.geometry;
        tris += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
      }
    });
    const entry = Object.assign({
      id: id, name: name || 'Model', object3D: object3D,
      stats: { tris: Math.round(tris), bones: bones, skinned: skinned, meshes: 0, clips: 0 },
      clips: (object3D.animations || [])
    }, extra || {});
    P.Models.models[id] = entry;
    P.Models.currentId = id;
    Page.currentEntry = entry;
    bus.emit('m2m:model', entry);
    return entry;
  };

  Page.clearModels = function () {
    if (!Page.modelRoot) return;
    while (Page.modelRoot.children.length) Page.modelRoot.remove(Page.modelRoot.children[0]);
    P.Models.models = {};
    P.Models.currentId = null;
    Page.currentEntry = null;
    if (Page.skeletonHelper) { Page.scene.remove(Page.skeletonHelper); Page.skeletonHelper = null; }
    P.RigAutoGen.current = null;
  };

  Page.removeModel = function (object3D) {
    if (Page.modelRoot && object3D && object3D.parent === Page.modelRoot) Page.modelRoot.remove(object3D);
  };

  Page.loadModelBuffer = function (buf, name, size) {
    return new Promise(function (resolve, reject) {
      const loader = new THREE.GLTFLoader();
      if (window.MeshoptDecoder && loader.setMeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
      loader.parse(buf, '', function (gltf) {
        const scene = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (!scene) { reject(new Error('GLB không có scene')); return; }
        Page.clearModels();
        Page._normalize(scene, 2.0);
        scene.name = name || 'Model';
        scene.animations = gltf.animations || [];
        Page.modelRoot.add(scene);
        Page._prepareMaterials(scene);
        Page.attachGizmo(scene);
        const entry = Page._registerModel(scene, name, { clips: gltf.animations || [], fileSize: size || 0 });
        entry.stats.clips = (gltf.animations || []).length;
        Page.focus();
        resolve(entry);
      }, function (err) { reject(new Error('Parse GLB lỗi: ' + (err && err.message || err))); });
    });
  };

  Page.loadModelUrl = function (url, name) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) { return Page.loadModelBuffer(buf, name || url.split('/').pop(), buf.byteLength); });
  };

  Page._normalize = function (object3D, targetHeight) {
    const box = new THREE.Box3().setFromObject(object3D);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const scale = (targetHeight || 2) / Math.max(1e-4, size.y);
    object3D.scale.multiplyScalar(scale);
    object3D.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(object3D);
    const c2 = box2.getCenter(new THREE.Vector3());
    object3D.position.x -= c2.x;
    object3D.position.z -= c2.z;
    object3D.position.y -= box2.min.y;
    object3D.updateMatrixWorld(true);
  };

  Page._prepareMaterials = function (root) {
    root.traverse(function (o) {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
        if (!m) return;
        if (m.map && THREE.sRGBEncoding !== undefined) m.map.encoding = THREE.sRGBEncoding;
        m.side = THREE.DoubleSide;
      });
    });
  };

  /* ---------------- rig ---------------- */
  Page.buildRig = function (rigId) {
    const target = P.Viewport.getMainModel();
    if (!target) return Promise.reject(new Error('Chưa có model trong viewport'));
    if (!P.CreatureRigs) return Promise.reject(new Error('CreatureRigs chưa nạp'));
    return P.CreatureRigs.build(target, rigId).then(function (rig) {
      if (rig) {
        Page.setSkeletonVisible(Page.settings.skeleton);
        bus.emit('m2m:rig', { rigId: rigId, bones: rig.boneCount, skinned: rig.skinnedCount });
      }
      return rig;
    });
  };

  /* ============================ PLAYBACK ============================ */
  Page.loadClip = function (url) {
    if (Page._cache[url]) return Promise.resolve(Page._cache[url]);
    return P.M2MMotion.loadClip(url).then(function (c) { Page._cache[url] = c; return c; });
  };

  Page.play = function (url, name) {
    const rig = P.RigAutoGen.current;
    if (!rig || !rig.mixer) {
      bus.emit('notify', { type: 'warning', title: 'Chưa có rig', message: 'Chọn model rồi bấm "Rig" (hoặc model đã có skeleton).' });
      return Promise.resolve(null);
    }
    return Page.loadClip(url).then(function (src) {
      const clip = P.M2MMotion.retarget(src, rig.target);
      if (!clip) { bus.emit('notify', { type: 'warning', title: 'Retarget rỗng', message: 'Không map được bone nào.' }); return null; }
      rig.mixer.stopAllAction();
      const action = rig.mixer.clipAction(clip);
      action.reset();
      action.setLoop(Page.loop ? THREE.LoopRepeat : THREE.LoopOnce);
      action.clampWhenFinished = !Page.loop;
      action.setEffectiveTimeScale(Page.speed);
      action.setEffectiveWeight(1);
      action.play();
      Page.action = action;
      Page.clip = clip;
      Page.clipName = name || clip.name;
      Page.duration = clip.duration;
      Page.time = 0;
      Page.paused = false;
      Page.playing = true;
      P.RigAutoGen.playing = true;
      bus.emit('m2m:play', { name: Page.clipName, duration: Page.duration, tracks: clip.tracks.length });
      return { name: Page.clipName, duration: Page.duration, tracks: clip.tracks.length };
    }).catch(function (e) {
      bus.emit('notify', { type: 'error', title: 'Play lỗi', message: e.message });
      return null;
    });
  };

  Page.toggle = function () {
    if (!Page.action) { if (Page.playing) { Page.pause(); } return; }
    if (Page.paused) { Page.action.paused = false; Page.paused = false; Page.playing = true; }
    else { Page.action.paused = true; Page.paused = true; Page.playing = false; }
    bus.emit('m2m:playstate', { playing: Page.playing });
  };
  Page.pause = function () { if (Page.action) { Page.action.paused = true; Page.paused = true; } Page.playing = false; };
  Page.stop = function () {
    const rig = P.RigAutoGen.current;
    if (rig && rig.mixer) rig.mixer.stopAllAction();
    Page.action = null; Page.playing = false; Page.paused = false; Page.time = 0;
    bus.emit('m2m:playstate', { playing: false });
  };
  Page.restart = function () {
    if (!Page.action) return;
    Page.action.reset(); Page.action.play();
    Page.paused = false; Page.playing = true; Page.time = 0;
  };
  Page.setSpeed = function (v) {
    Page.speed = U.clamp(v, 0.05, 4);
    if (Page.action) Page.action.setEffectiveTimeScale(Page.speed);
    bus.emit('m2m:speed', { speed: Page.speed });
  };
  Page.setLoop = function (on) {
    Page.loop = !!on;
    if (Page.action) Page.action.setLoop(Page.loop ? THREE.LoopRepeat : THREE.LoopOnce);
  };
  Page.seek = function (t) {
    if (!Page.action) return;
    Page.action.time = U.clamp(t, 0, Page.duration || 0);
    Page.time = Page.action.time;
    if (P.RigAutoGen.current && P.RigAutoGen.current.mixer) P.RigAutoGen.current.mixer.update(0);
    bus.emit('m2m:time', { time: Page.time, duration: Page.duration, playing: Page.playing });
  };
  Page.stepFrame = function (dir) {
    const step = 1 / (Page.fps || 30);
    Page.seek((Page.time || 0) + dir * step);
    Page.pause();
  };

  /* ============================ REMIX ============================ */
  Page.remixAdd = function (item) {
    Page.remix.list.push({ url: item.url, name: item.name, duration: item.duration || 1, hold: item.duration || 1, transition: Page.remix.transition });
    bus.emit('m2m:remix', { list: Page.remix.list });
  };
  Page.remixRemove = function (i) { Page.remix.list.splice(i, 1); bus.emit('m2m:remix', { list: Page.remix.list }); };
  Page.remixMove = function (i, dir) {
    const j = i + dir;
    if (j < 0 || j >= Page.remix.list.length) return;
    const t = Page.remix.list[i];
    Page.remix.list[i] = Page.remix.list[j];
    Page.remix.list[j] = t;
    bus.emit('m2m:remix', { list: Page.remix.list });
  };
  Page.remixSave = function (name) {
    try {
      const all = JSON.parse(localStorage.getItem('m2m.remix.v1') || '{}');
      all[name || ('remix-' + Object.keys(all).length)] = { list: Page.remix.list, at: Date.now() };
      localStorage.setItem('m2m.remix.v1', JSON.stringify(all));
      return true;
    } catch (e) { return false; }
  };
  Page.remixLoad = function (name) {
    try {
      const all = JSON.parse(localStorage.getItem('m2m.remix.v1') || '{}');
      if (all[name]) { Page.remix.list = all[name].list || []; bus.emit('m2m:remix', { list: Page.remix.list }); return true; }
    } catch (e) { }
    return false;
  };
  Page.remixList = function () {
    try { return Object.keys(JSON.parse(localStorage.getItem('m2m.remix.v1') || '{}')); } catch (e) { return []; }
  };

  Page.remixPlay = function () {
    if (!Page.remix.list.length) return;
    Page.remix.playing = true;
    Page.remix.index = 0;
    Page._playRemixStep(0);
  };
  Page.remixStop = function () {
    Page.remix.playing = false;
    const rig = P.RigAutoGen.current;
    if (rig && rig.mixer) rig.mixer.stopAllAction();
  };
  Page._playRemixStep = function (i) {
    const step = Page.remix.list[i];
    if (!step) { Page.remix.playing = false; bus.emit('m2m:remixstep', { index: -1 }); return; }
    Page.loadClip(step.url).then(function (src) {
      const rig = P.RigAutoGen.current;
      if (!rig) return;
      const clip = P.M2MMotion.retarget(src, rig.target);
      if (!clip) return;
      const next = rig.mixer.clipAction(clip);
      next.reset();
      next.setLoop(THREE.LoopOnce);
      next.clampWhenFinished = true;
      next.setEffectiveTimeScale(Page.speed);
      next.setEffectiveWeight(1);
      next.play();
      if (Page.remix.actionA) {
        Page.remix.actionA.crossFadeTo(next, step.transition || Page.remix.transition, false);
      }
      Page.remix.actionA = next;
      Page.remix.timer = Math.max(0.2, (step.hold || clip.duration));
      Page.remix.index = i;
      Page.clip = clip; Page.clipName = step.name; Page.duration = clip.duration; Page.time = 0;
      Page.action = next; Page.playing = true; Page.paused = false;
      bus.emit('m2m:remixstep', { index: i, name: step.name });
    });
  };
  Page._tickRemix = function (dt) {
    Page.remix.timer -= dt;
    if (Page.remix.timer <= 0) {
      const nextIndex = Page.remix.index + 1;
      if (nextIndex >= Page.remix.list.length) { Page.remix.playing = false; bus.emit('m2m:remixstep', { index: -1 }); return; }
      Page._playRemixStep(nextIndex);
    }
  };

  /* ============================ IMPORT ============================ */
  Page.importFile = function (file) {
    const name = file.name || 'import';
    const ext = name.toLowerCase().split('.').pop();
    return U.readFileAsArrayBuffer(file).then(function (buf) {
      if (ext === 'glb' || ext === 'gltf') return Page.loadModelBuffer(buf, name, file.size).then(function (e) {
        /* nếu GLB có sẵn skeleton + animation → dùng trực tiếp */
        if (e.stats.skinned > 0 && e.clips.length) {
          const rigLike = Page.adoptExistingSkeleton(e.object3D, e.clips);
          if (rigLike) bus.emit('notify', { type: 'success', title: 'Model có sẵn rig', message: e.stats.bones + ' bone · ' + e.clips.length + ' clip có sẵn' });
        }
        return e;
      });
      if (ext === 'fbx') return Page._importFBX(buf, name, file.size);
      throw new Error('Chỉ hỗ trợ GLB / GLTF / FBX');
    });
  };

  Page._importFBX = function (buf, name, size) {
    return new Promise(function (resolve, reject) {
      if (!THREE.FBXLoader) { reject(new Error('FBXLoader chưa load')); return; }
      try {
        const obj = new THREE.FBXLoader().parse(buf, '');
        Page.clearModels();
        Page._normalize(obj, 2.0);
        obj.name = name;
        Page.modelRoot.add(obj);
        Page._prepareMaterials(obj);
        /* dùng skeleton có sẵn của FBX nếu có */
        let mixer = null, bones = 0;
        obj.traverse(function (o) { if (o.isBone) bones++; });
        if (bones) {
          mixer = new THREE.AnimationMixer(obj);
          P.RigAutoGen.current = {
            name: 'FBX rig', target: obj, root: obj, mixer: mixer,
            rootBone: (function () { let b = null; obj.traverse(function (o) { if (!b && o.isBone) b = o; }); return b; })(),
            bones: {}, boneCount: bones, skeleton: null, skinnedCount: 0, creature: true
          };
          P.RigAutoGen.playing = true;
        }
        const entry = Page._registerModel(obj, name, { clips: obj.animations || [], fileSize: size || 0 });
        entry.stats.bones = bones;
        entry.stats.clips = (obj.animations || []).length;
        Page.focus();
        bus.emit('m2m:model', entry);
        resolve(entry);
      } catch (e) { reject(new Error('Parse FBX lỗi: ' + e.message)); }
    });
  };

  /* Nhận skeleton có sẵn của model (GLB rigged) làm rig hiện hành */
  Page.adoptExistingSkeleton = function (target, clips) {
    let bones = 0, skinned = 0, root = null;
    target.traverse(function (o) {
      if (o.isBone) { bones++; if (!root) root = o; }
      if (o.isSkinnedMesh) skinned++;
    });
    if (!bones) return null;
    const mixer = new THREE.AnimationMixer(target);
    P.RigAutoGen.current = {
      name: 'Existing skeleton', target: target, root: target, mixer: mixer,
      rootBone: root, bones: {}, boneCount: bones, skeleton: null, skinnedCount: skinned, creature: true
    };
    P.RigAutoGen.playing = true;
    Page.setSkeletonVisible(Page.settings.skeleton);
    return P.RigAutoGen.current;
  };

  /* Nạp animation từ file GLB riêng (không thay model) */
  Page.importAnimationFile = function (file) {
    return U.readFileAsArrayBuffer(file).then(function (buf) {
      return new Promise(function (resolve, reject) {
        const loader = new THREE.GLTFLoader();
        if (window.MeshoptDecoder && loader.setMeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
        loader.parse(buf, '', function (g) {
          const clips = g.animations || [];
          if (!clips.length) { reject(new Error('File không có animation')); return; }
          /* lưu tạm vào cache theo tên file để dùng lại */
          const url = 'local:' + file.name;
          Page._cache[url] = { clip: clips[0], rest: (function () {
            const rest = {};
            g.scene.updateMatrixWorld(true);
            g.scene.traverse(function (o) { if (o.name) rest[o.name] = o.quaternion.clone(); });
            return rest;
          })(), scene: g.scene };
          bus.emit('m2m:importedanim', { url: url, name: file.name, duration: clips[0].duration });
          resolve({ url: url, name: file.name, duration: clips[0].duration });
        }, function (e) { reject(new Error('Parse lỗi: ' + (e && e.message || e))); });
      });
    });
  };

  /* ============================ EXPORT ============================ */
  /* ============================ OBJECT TRANSFORM ============================ */
  Page.gizmo = null;
  Page.gizmoMode = 'move';

  Page.initGizmo = function () {
    if (!THREE.TransformControls || Page.gizmo) return;
    try {
      const tc = new THREE.TransformControls(Page.camera, Page.canvas);
      tc.setSize(0.9);
      tc.addEventListener('dragging-changed', function (e) {
        Page._gizmoDragging = e.value;
        if (!e.value) bus.emit('m2m:transform', { source: 'gizmo' });
      });
      tc.addEventListener('objectChange', function () { bus.emit('m2m:transform', { source: 'gizmo' }); });
      Page.scene.add(tc);
      Page.gizmo = tc;
      Page.setGizmoMode(Page.gizmoMode);
    } catch (e) { console.warn('[m2m] TransformControls lỗi', e); }
  };

  Page.setGizmoMode = function (mode) {
    Page.gizmoMode = mode || 'move';
    if (!Page.gizmo) return Page.gizmoMode;
    const map = { move: 'translate', rotate: 'rotate', scale: 'scale', select: 'select' };
    const m = map[Page.gizmoMode] || 'translate';
    if (m === 'select') { Page.gizmo.visible = false; Page.gizmo.enabled = false; return Page.gizmoMode; }
    Page.gizmo.setMode(m);
    Page.gizmo.enabled = true;
    Page.gizmo.visible = !!Page.gizmo.object;
    bus.emit('m2m:gizmo', { mode: Page.gizmoMode });
    return Page.gizmoMode;
  };

  Page.attachGizmo = function (obj) {
    if (!Page.gizmo) return;
    if (obj) Page.gizmo.attach(obj); else Page.gizmo.detach();
    Page.gizmo.visible = Page.gizmoMode !== 'select' && !!Page.gizmo.object;
  };

  Page.object = function () { return P.Viewport.getMainModel(); };

  /* di chuyển object theo trục (world) — nút mũi tên trong UI */
  Page.nudge = function (axis, delta) {
    const o = Page.object();
    if (!o) return null;
    if (axis === 'x') o.position.x += delta;
    if (axis === 'y') o.position.y += delta;
    if (axis === 'z') o.position.z += delta;
    o.updateMatrixWorld(true);
    if (Page.gizmo) Page.gizmo.visible = Page.gizmoMode !== 'select';
    bus.emit('m2m:transform', { source: 'nudge', axis: axis, delta: delta });
    return o.position.toArray().map(function (v) { return +v.toFixed(3); });
  };

  Page.applyTransform = function (patch) {
    const o = Page.object();
    if (!o) return null;
    if (patch.position) o.position.set(patch.position[0], patch.position[1], patch.position[2]);
    if (patch.rotation) o.rotation.set(patch.rotation[0], patch.rotation[1], patch.rotation[2]);
    if (patch.scale) o.scale.set(patch.scale[0], patch.scale[1], patch.scale[2]);
    o.updateMatrixWorld(true);
    bus.emit('m2m:transform', { source: 'input' });
    return true;
  };

  Page.dropToFloor = function () {
    const o = Page.object();
    if (!o) return null;
    o.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(o);
    if (b.isEmpty()) return null;
    o.position.y -= b.min.y;
    bus.emit('m2m:transform', { source: 'floor' });
    return +o.position.y.toFixed(3);
  };

  Page.resetTransform = function () {
    const o = Page.object();
    if (!o) return null;
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.scale.set(1, 1, 1);
    bus.emit('m2m:transform', { source: 'reset' });
    return true;
  };

  Page.transformState = function () {
    const o = Page.object();
    if (!o) return null;
    return {
      position: o.position.toArray().map(function (v) { return +v.toFixed(3); }),
      rotation: [o.rotation.x, o.rotation.y, o.rotation.z].map(function (v) { return +(v * 180 / Math.PI).toFixed(1); }),
      scale: o.scale.toArray().map(function (v) { return +v.toFixed(3); })
    };
  };

  Page.exportGLB = function (opts) {
    opts = opts || {};
    const target = P.Viewport.getMainModel();
    if (!target) return Promise.reject(new Error('Chưa có model'));
    const rig = P.RigAutoGen.current;
    const clips = [];
    const jobs = (opts.clips || []).map(function (c) {
      return Page.loadClip(c.url).then(function (src) {
        const clip = rig ? P.M2MMotion.retarget(src, rig.target) : null;
        if (clip) { clip.name = c.name || src.clip.name || 'Clip'; clips.push(clip); }
      });
    });
    return Promise.all(jobs).then(function () {
      return new Promise(function (resolve, reject) {
        const exporter = new THREE.GLTFExporter();
        exporter.parse(target, function (result) {
          const blob = new Blob([result], { type: 'model/gltf-binary' });
          U.downloadBlob(blob, (opts.filename || 'mesh2motion-export') + '.glb');
          resolve({ blob: blob, clips: clips.length });
        }, {
          binary: true, animations: clips, onlyVisible: true, embedImages: true, includeCustomExtensions: true
        });
      });
    });
  };

  Page.exportClipJSON = function (opts) {
    opts = opts || {};
    const rig = P.RigAutoGen.current;
    const out = [];
    const jobs = (opts.clips || []).map(function (c) {
      return Page.loadClip(c.url).then(function (src) {
        const clip = rig ? P.M2MMotion.retarget(src, rig.target) : null;
        if (!clip) return;
        out.push({
          name: c.name || clip.name, duration: clip.duration,
          tracks: clip.tracks.map(function (t) {
            return { name: t.name, times: Array.from(t.times).map(function (x) { return Math.round(x * 1e3) / 1e3; }), values: Array.from(t.values).map(function (x) { return Math.round(x * 1e4) / 1e4; }) };
          })
        });
      });
    });
    return Promise.all(jobs).then(function () {
      U.downloadText(JSON.stringify({ format: 'mesh2motion-clips-1', exportedAt: new Date().toISOString(), clips: out }, null, 1), (opts.filename || 'mesh2motion-clips') + '.json', 'application/json');
      return out.length;
    });
  };

  /* ============================ RETARGET DIAGNOSTICS ============================ */
  Page.retargetDiagnostics = function (url) {
    const rig = P.RigAutoGen.current;
    if (!rig) return Promise.resolve(null);
    return Page.loadClip(url).then(function (src) {
      const names = {};
      const bones = [];
      rig.target.traverse(function (o) { if (o.isBone && o.name) { names[o.name] = o; bones.push(o.name); } });
      const srcNodes = {};
      src.clip.tracks.forEach(function (t) {
        const dot = t.name.lastIndexOf('.');
        const n = dot > 0 ? t.name.slice(0, dot) : t.name;
        if (/_(tip|leaf)$/i.test(n)) return;
        srcNodes[n] = 1;
      });
      const srcList = Object.keys(srcNodes);
      const matched = srcList.filter(function (n) { return names[n]; });
      const clip = P.M2MMotion.retarget(src, rig.target);
      return {
        clipName: src.clip.name, srcBones: srcList.length, targetBones: bones.length,
        directMatch: matched.length, mode: matched.length / Math.max(1, srcList.length) >= 0.4 ? 'identity-by-name' : 'humanoid-map',
        outTracks: clip ? clip.tracks.length : 0,
        missing: srcList.filter(function (n) { return !names[n]; }).slice(0, 24)
      };
    });
  };

  window.M2MPage = Page;
})();