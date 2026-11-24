/* ============================================================
 * mapeditor/viewport/Viewport3D.js — Viewport 3D thật (three r128)
 * Renderer + scene + lights + grid + gizmo TransformControls +
 * picking (raycast) + HUD PixiJS v8 overlay (FPS/calls/tris/
 * objects, minimap, vòng cọ) — nếu PIXI không có thì HUD DOM.
 * Snowfall + play-mode animation hero/monster patrol ở đây.
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  var Viewport3D = {
    renderer: null,
    scene: null,
    camera: null,
    rig: null,
    canvas: null,
    root: null,          /* Group chứa mọi object map */
    grid: null,
    axes: null,
    gizmo: null,
    raycaster: null,
    sun: null,
    hemi: null,
    snowPts: null,
    snowVel: null,
    colliderHelpers: null,
    _stats: { fps: 0, calls: 0, tris: 0, objects: 0 },
    _frames: 0, _lastFpsT: 0,
    _pixi: null,
    _hudDom: null,
    _playing: false,
    _playT: 0,
    _patrolState: {},
    _followHero: false,
    _raf: 0,
    _disposed: false
  };

  /* ---------- init ---------- */
  Viewport3D.init = function (canvas, wrap) {
    if (!window.THREE) throw new Error('Three.js chưa load');
    Viewport3D.canvas = canvas;
    Viewport3D.scene = new THREE.Scene();
    Viewport3D.scene.background = new THREE.Color(0x9db8d9);
    Viewport3D.scene.fog = new THREE.Fog(0x9db8d9, 60, 180);
    Viewport3D.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
    /* camera trực giao riêng cho chế độ Ortho (học Studio QuadCameras) */
    Viewport3D.perspCamera = Viewport3D.camera;
    Viewport3D.orthoCamera = new THREE.OrthographicCamera(-50, 50, 50, -50, -500, 1000);
    Viewport3D.orthoCamera.aspect = 1;
    Viewport3D._ortho = false;
    Viewport3D.rig = new ME.CameraRig(Viewport3D.camera);
    Viewport3D.rig.update();

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    } catch (e) {
      /* môi trường không có WebGL (test) — dùng stub tối thiểu */
      renderer = {
        domElement: canvas, shadowMap: {},
        setSize: function () {}, setPixelRatio: function () {}, render: function () {},
        toneMapping: 0, outputEncoding: 0
      };
    }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    Viewport3D.renderer = renderer;

    Viewport3D.root = new THREE.Group();
    Viewport3D.root.name = 'MapRoot';
    Viewport3D.scene.add(Viewport3D.root);

    Viewport3D.colliderHelpers = new THREE.Group();
    Viewport3D.colliderHelpers.name = 'ColliderHelpers';
    Viewport3D.colliderHelpers.visible = false;
    Viewport3D.scene.add(Viewport3D.colliderHelpers);

    /* lights */
    Viewport3D.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2438, 0.85);
    Viewport3D.scene.add(Viewport3D.hemi);
    Viewport3D.sun = new THREE.DirectionalLight(0xfff2cc, 1.05);
    Viewport3D.sun.position.set(40, 60, 20);
    Viewport3D.sun.castShadow = true;
    Viewport3D.sun.shadow.mapSize.set(2048, 2048);
    Viewport3D.sun.shadow.camera.left = -70;
    Viewport3D.sun.shadow.camera.right = 70;
    Viewport3D.sun.shadow.camera.top = 70;
    Viewport3D.sun.shadow.camera.bottom = -70;
    Viewport3D.sun.shadow.camera.far = 180;
    Viewport3D.scene.add(Viewport3D.sun);

    /* grid + axes */
    Viewport3D.grid = new THREE.GridHelper(112, 28, 0x8a94a8, 0x5a6478);
    Viewport3D.grid.position.y = 0.05;
    Viewport3D.scene.add(Viewport3D.grid);
    Viewport3D.axes = new THREE.AxesHelper(6);
    Viewport3D.scene.add(Viewport3D.axes);

    /* gizmo */
    if (THREE.TransformControls) {
      Viewport3D.gizmo = new THREE.TransformControls(Viewport3D.camera, canvas);
      Viewport3D.gizmo.setSize(0.9);
      Viewport3D.scene.add(Viewport3D.gizmo);
      Viewport3D.gizmo.addEventListener('dragging-changed', function (e) {
        if (ME.MapEditor) ME.MapEditor.setOrbitEnabled(!e.value);
        if (!e.value && ME.MapEditor) ME.MapEditor.onGizmoChanged();
      });
      Viewport3D.gizmo.addEventListener('objectChange', function () {
        if (ME.MapEditor) ME.MapEditor.onGizmoChanged(true);
      });
    }

    Viewport3D.raycaster = new THREE.Raycaster();
    Viewport3D.resize();
    Viewport3D.initSnow();
    Viewport3D.initHud(wrap);
    return Viewport3D;
  };

  Viewport3D.resize = function () {
    var wrap = Viewport3D.canvas.parentElement;
    if (!wrap) return;
    var w = wrap.clientWidth || 800, h = wrap.clientHeight || 600;
    Viewport3D.camera.aspect = w / Math.max(1, h);
    Viewport3D.camera.updateProjectionMatrix();
    if (Viewport3D.orthoCamera) {
      Viewport3D.orthoCamera.aspect = w / Math.max(1, h);
      Viewport3D.orthoCamera.updateProjectionMatrix();
    }
    Viewport3D.renderer.setSize(w, h);
    if (Viewport3D.renderer.setPixelRatio) {
      Viewport3D.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
    if (Viewport3D._pixi && Viewport3D._pixi.resize) Viewport3D._pixi.resize(w, h);
  };

  /* ---------- chế độ Ortho / Persp + FOV (thống nhất với Studio) ---------- */
  Viewport3D.isOrtho = function () { return !!Viewport3D._ortho; };
  Viewport3D.setOrthoMode = function (on) {
    Viewport3D._ortho = !!on;
    var cam = Viewport3D._ortho ? Viewport3D.orthoCamera : Viewport3D.perspCamera;
    if (!cam) return false;
    /* đồng bộ vị trí camera đang dùng sang camera mới */
    cam.position.copy(Viewport3D.camera.position);
    Viewport3D.camera = cam;
    if (Viewport3D.rig) {
      Viewport3D.rig.setOrtho(Viewport3D._ortho);
      Viewport3D.rig.setCamera(cam);
    }
    if (Viewport3D.gizmo) Viewport3D.gizmo.camera = cam;
    Viewport3D.resize();
    return Viewport3D._ortho;
  };
  Viewport3D.setFov = function (deg) {
    if (Viewport3D.rig) return Viewport3D.rig.setFov(deg);
    return 50;
  };

  /* ---------- tuyết rơi ---------- */
  Viewport3D.initSnow = function () {
    var N = 900;
    var pos = new Float32Array(N * 3);
    for (var i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 112;
      pos[i * 3 + 1] = Math.random() * 30;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 112;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, transparent: true, opacity: 0.85, sizeAttenuation: true });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    Viewport3D.snowPts = pts;
    Viewport3D.snowVel = new Float32Array(N);
    for (var j = 0; j < N; j++) Viewport3D.snowVel[j] = 1.2 + Math.random() * 1.8;
    Viewport3D.scene.add(pts);
  };
  Viewport3D.setSnowVisible = function (v) {
    if (Viewport3D.snowPts) Viewport3D.snowPts.visible = !!v;
  };
  Viewport3D.updateSnow = function (dt) {
    var pts = Viewport3D.snowPts;
    if (!pts || !pts.visible) return;
    var p = pts.geometry.attributes.position.array;
    for (var i = 0; i < p.length; i += 3) {
      p[i + 1] -= Viewport3D.snowVel[i / 3] * dt;
      p[i] += Math.sin((p[i + 1] + i) * 0.2) * dt * 0.3;
      if (p[i + 1] < 0) { p[i + 1] = 28 + Math.random() * 2; p[i] = (Math.random() - 0.5) * 112; p[i + 2] = (Math.random() - 0.5) * 112; }
    }
    pts.geometry.attributes.position.needsUpdate = true;
  };

  /* ---------- picking ---------- */
  Viewport3D.screenToNDC = function (clientX, clientY) {
    var r = Viewport3D.canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / Math.max(1, r.width)) * 2 - 1,
      y: -((clientY - r.top) / Math.max(1, r.height)) * 2 + 1
    };
  };
  Viewport3D.raycast = function (ndc) {
    Viewport3D.raycaster.setFromCamera(ndc, Viewport3D.camera);
    var hits = Viewport3D.raycaster.intersectObjects(Viewport3D.root.children, true);
    return hits;
  };
  Viewport3D.pickObject = function (ndc) {
    var hits = Viewport3D.raycast(ndc);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o && o.parent !== Viewport3D.root && o.parent) o = o.parent;
      if (o && o.parent === Viewport3D.root) return { object: o, point: hits[i].point };
    }
    return null;
  };
  Viewport3D.terrainPoint = function (ndc, terrainMesh) {
    Viewport3D.raycaster.setFromCamera(ndc, Viewport3D.camera);
    var targets = terrainMesh ? [terrainMesh] : [];
    var hits = Viewport3D.raycaster.intersectObjects(targets, false);
    return hits.length ? hits[0].point : null;
  };

  /* ---------- gizmo ---------- */
  Viewport3D.attachGizmo = function (obj, mode) {
    if (!Viewport3D.gizmo) return;
    if (!obj) { Viewport3D.gizmo.detach(); return; }
    Viewport3D.gizmo.attach(obj);
    if (mode) Viewport3D.gizmo.setMode(mode);
  };
  Viewport3D.setGizmoMode = function (mode) {
    if (!Viewport3D.gizmo) return;
    Viewport3D.gizmo.setMode(mode === 'select' ? 'translate' : mode);
  };
  Viewport3D.gizmoDragging = function () {
    return !!(Viewport3D.gizmo && Viewport3D.gizmo.dragging);
  };

  /* ---------- collider debug ---------- */
  Viewport3D.refreshColliders = function (show) {
    var g = Viewport3D.colliderHelpers;
    if (!g) return;
    g.visible = !!show;
    while (g.children.length) {
      var c = g.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
    if (!show) return;
    Viewport3D.root.children.forEach(function (obj) {
      var col = obj.userData.collider;
      if (!col) return;
      var helper = null;
      if (col.shape === 'sphere') {
        helper = new THREE.Mesh(new THREE.SphereGeometry((col.size && col.size[0]) || 1, 12, 8),
          new THREE.MeshBasicMaterial({ color: 0xffd94d, wireframe: true, transparent: true, opacity: 0.6 }));
      } else {
        var s = col.size || [1, 1, 1];
        helper = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]),
          new THREE.MeshBasicMaterial({ color: 0xffd94d, wireframe: true, transparent: true, opacity: 0.6 }));
      }
      helper.position.copy(obj.position);
      helper.position.y += (col.shape === 'box' ? (col.size ? col.size[1] / 2 : 0.5) : 0);
      g.add(helper);
    });
  };

  /* ---------- HUD PixiJS overlay ---------- */
  Viewport3D.initHud = function (wrap) {
    if (!wrap) return;
    var hudCanvas = wrap.querySelector('#pixi-hud');
    if (!hudCanvas) return;
    if (window.PIXI && PIXI.Application) {
      try {
        var app = new PIXI.Application();
        var p = app.init({
          canvas: hudCanvas,
          width: wrap.clientWidth || 800, height: wrap.clientHeight || 600,
          backgroundAlpha: 0, antialias: true, resolution: 1
        });
        if (p && p.then) {
          p.then(function () { Viewport3D._pixi = app; }).catch(function () { Viewport3D._pixi = null; });
        } else {
          Viewport3D._pixi = app;
        }
      } catch (e) { Viewport3D._pixi = null; }
    }
    /* fallback DOM HUD */
    var dom = wrap.querySelector('#hud-dom');
    Viewport3D._hudDom = dom || null;
  };

  Viewport3D.drawHud = function (stats) {
    var app = Viewport3D._pixi;
    if (app && app.stage && PIXI.Graphics) {
      try {
        var stage = app.stage;
        while (stage.children.length) stage.removeChildAt(0);
        var g = new PIXI.Graphics();
        /* khung HUD trái trên */
        g.rect(8, 8, 250, 64).fill({ color: 0x0d1420, alpha: 0.72 });
        g.rect(8, 8, 250, 64).stroke({ color: 0x713bff, width: 1, alpha: 0.8 });
        stage.addChild(g);
        var t = new PIXI.Text({
          text: 'FPS: ' + stats.fps + '  Draw: ' + stats.calls + '\nTris: ' + stats.tris + '  Obj: ' + stats.objects,
          style: { fontFamily: 'monospace', fontSize: 12, fill: 0xffffff }
        });
        t.position.set(16, 16);
        stage.addChild(t);
        /* minimap phải trên: chấm object */
        var mm = new PIXI.Graphics();
        mm.rect(app.screen ? app.screen.width - 128 : 672, 8, 120, 120).fill({ color: 0x0d1420, alpha: 0.6 });
        mm.rect(app.screen ? app.screen.width - 128 : 672, 8, 120, 120).stroke({ color: 0x8a94a8, width: 1 });
        var ox = (app.screen ? app.screen.width - 128 : 672) + 60;
        var oy = 8 + 60;
        if (ME.MapEditor && ME.MapEditor.forEachObject) {
          ME.MapEditor.forEachObject(function (obj) {
            var dot = new PIXI.Graphics();
            dot.circle(ox + obj.position.x * 0.5, oy + obj.position.z * 0.5, 2).fill({ color: 0xffd94d });
            stage.addChild(dot);
          });
        }
        stage.addChild(mm);
        if (app.render) app.render();
      } catch (e) { /* HUD lỗi thì bỏ qua, không chặn render 3D */ }
    }
    if (Viewport3D._hudDom) {
      Viewport3D._hudDom.textContent = 'FPS: ' + stats.fps + ' · Draw: ' + stats.calls + ' · Tris: ' + stats.tris + ' · Obj: ' + stats.objects;
    }
  };

  /* ---------- stats ---------- */
  Viewport3D.computeStats = function () {
    var tris = 0, calls = 0, objects = 0;
    Viewport3D.scene.traverse(function (o) {
      if (o.isMesh) {
        objects++;
        calls++;
        var geo = o.geometry;
        if (geo && geo.index) tris += geo.index.count / 3;
        else if (geo && geo.attributes && geo.attributes.position) tris += geo.attributes.position.count / 3;
      }
    });
    Viewport3D._stats.tris = Math.round(tris);
    Viewport3D._stats.calls = calls;
    Viewport3D._stats.objects = objects;
    return Viewport3D._stats;
  };

  /* ---------- play mode ---------- */
  Viewport3D.setPlaying = function (v) {
    Viewport3D._playing = !!v;
    if (!v) Viewport3D.resetPlayState();
  };
  Viewport3D.isPlaying = function () { return Viewport3D._playing; };
  /* camera theo hero khi Play (bật/tắt từ panel Mở rộng) */
  Viewport3D.setFollowHero = function (v) { Viewport3D._followHero = !!v; };
  Viewport3D.isFollowHero = function () { return Viewport3D._followHero; };
  Viewport3D.resetPlayState = function () {
    /* trả hero/monster về vị trí gốc trong data */
    if (!ME.MapEditor) return;
    ME.MapEditor.forEachObject(function (obj) {
      var d = obj.userData.mapData;
      if (!d) return;
      obj.position.fromArray(d.position);
      obj.rotation.fromArray(d.rotation);
      if (obj.userData.limbs) {
        var L = obj.userData.limbs;
        [L.armL, L.armR, L.legL, L.legR].forEach(function (l) { if (l) l.rotation.set(0, 0, 0); });
        if (L.body) { L.body.position.y = 0; L.body.rotation.y = 0; }
      }
    });
    Viewport3D._patrolState = {};
  };

  Viewport3D.updatePlay = function (dt) {
    if (!Viewport3D._playing || !ME.MapEditor) return;
    Viewport3D._playT += dt;
    var t = Viewport3D._playT;
    ME.MapEditor.forEachObject(function (obj) {
      var type = obj.userData.mapType;
      if (type === 'hero' || type === 'monster' || type === 'boss') {
        var anim = 'Idle';
        var d = obj.userData.mapData;
        if (d && d.anim) anim = d.anim;
        /* hero/monster/boss đi patrol nếu có path gần (hero cũng đi patrol khi Play) */
        if ((type === 'monster' || type === 'boss' || type === 'hero') && ME.MapEditor.findPatrolNear) {
          var path = ME.MapEditor.findPatrolNear(obj.position);
          if (path) {
            var st = Viewport3D._patrolState[obj.userData.mapId] || { i: 0, prog: 0 };
            var pts = path.path || [];
            if (pts.length > 1) {
              var a = pts[st.i % pts.length], b = pts[(st.i + 1) % pts.length];
              st.prog += dt * 0.25;
              if (st.prog >= 1) { st.prog = 0; st.i++; a = pts[st.i % pts.length]; b = pts[(st.i + 1) % pts.length]; }
              var nx = a[0] + (b[0] - a[0]) * st.prog;
              var nz = a[1] + (b[1] - a[1]) * st.prog;
              obj.position.x = nx;
              obj.position.z = nz;
              obj.position.y = ME.TerrainEditor.heightAt(nx, nz);
              obj.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
              Viewport3D._patrolState[obj.userData.mapId] = st;
              anim = 'Walk';
            }
          }
        }
        if (ME.Placement) ME.Placement.animateHero(obj, anim, t);
      }
      if (type === 'campfire') {
        var flame = null;
        obj.traverse(function (c) { if (c.name === 'flame') flame = c; });
        if (flame) flame.scale.setScalar(1 + Math.sin(t * 9 + obj.position.x) * 0.15);
      }
      if (type === 'portal') {
        obj.children.forEach(function (c) {
          if (c.geometry && c.geometry.type === 'TorusGeometry') c.rotation.z += dt * 0.6;
        });
      }
    });
    /* camera follow hero */
    if (Viewport3D._followHero && Viewport3D.rig) {
      var hero = null;
      ME.MapEditor.forEachObject(function (o) {
        if (!hero && o.userData.mapType === 'hero') hero = o;
      });
      if (hero) {
        Viewport3D.rig.dTarget.set(hero.position.x, hero.position.y + 1, hero.position.z);
        Viewport3D.rig.update();
      }
    }
  };

  /* click lên minimap (góc phải trên, 120×120, offset 8px) → di chuyển camera.
   * Trả true nếu click nằm trong minimap (đã xử lý), false nếu không.
   * viewW/viewH: kích thước viewport (mặc định lấy từ canvas) — test truyền tay. */
  Viewport3D.minimapClick = function (clientX, clientY, viewW, viewH) {
    var r = Viewport3D.canvas ? Viewport3D.canvas.getBoundingClientRect() : null;
    var W = viewW || (r ? r.width : 0);
    if (!W) return false;
    var mx = clientX - (r ? r.left : 0);
    var my = clientY - (r ? r.top : 0);
    var x0 = W - 128, x1 = W - 8, y0 = 8, y1 = 128;
    if (mx < x0 || mx > x1 || my < y0 || my > y1) return false;
    var ox = x0 + 60, oy = y0 + 60;
    var half = (ME.TerrainEditor && ME.TerrainEditor.data ? ME.TerrainEditor.data.size : 112) / 2;
    var wx = Math.max(-half, Math.min(half, (mx - ox) / 0.5));
    var wz = Math.max(-half, Math.min(half, (my - oy) / 0.5));
    var wy = ME.TerrainEditor ? ME.TerrainEditor.heightAt(wx, wz) : 0;
    Viewport3D.rig.dTarget.set(wx, wy, wz);
    Viewport3D.rig.update();
    return true;
  };

  /* ---------- render loop ---------- */
  Viewport3D.render = function (dt) {
    /* damping camera: lerp về desired mỗi frame (học OrbitCam Studio) */
    if (Viewport3D.rig) Viewport3D.rig.updateSmooth(dt);
    Viewport3D.updateSnow(dt);
    Viewport3D.updatePlay(dt);
    Viewport3D.renderer.render(Viewport3D.scene, Viewport3D.camera);
    /* FPS */
    Viewport3D._frames++;
    var now = (typeof performance !== 'undefined') ? performance.now() : 0;
    if (!Viewport3D._lastFpsT) Viewport3D._lastFpsT = now;
    if (now - Viewport3D._lastFpsT >= 500) {
      Viewport3D._stats.fps = Math.round(Viewport3D._frames * 1000 / Math.max(1, now - Viewport3D._lastFpsT));
      Viewport3D._frames = 0;
      Viewport3D._lastFpsT = now;
      Viewport3D.computeStats();
      Viewport3D.drawHud(Viewport3D._stats);
    }
  };

  Viewport3D.dispose = function () {
    Viewport3D._disposed = true;
    if (Viewport3D._raf) cancelAnimationFrame(Viewport3D._raf);
  };

  ME.Viewport3D = Viewport3D;
})();
