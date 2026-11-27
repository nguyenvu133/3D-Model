/* ============================================================
 * viewport/viewport.js — Sở hữu scene, 9 view mode + Quad View,
 * picking, focus, screenshot, shading modes, animation tick.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Viewport = {
    scene: null,
    orbit: null,
    quad: null,
    modelRoot: null,        // mọi model đặt trong đây
    wireframe: false,
    xray: false,
    _raycaster: null,
    _shadingMaterials: {}
  };

  /* ---------- INIT ---------- */
  Viewport.init = function (canvasWrap) {
    if (!window.THREE) return;

    Viewport.scene = new THREE.Scene();
    Viewport._raycaster = new THREE.Raycaster();

    /* Environment + lighting */
    const grid = PixiStudio.GridEnv.create();
    if (grid) Viewport.scene.add(grid);
    const lights = PixiStudio.Lighting.create();
    if (lights) Viewport.scene.add(lights);

    /* Model root */
    Viewport.modelRoot = new THREE.Group();
    Viewport.modelRoot.name = 'Models';
    Viewport.scene.add(Viewport.modelRoot);

    /* Cameras */
    const aspect = canvasWrap.clientWidth / Math.max(1, canvasWrap.clientHeight);
    Viewport.orbit = new PixiStudio.OrbitCam(aspect);
    Viewport.quad = new PixiStudio.QuadCameras();
    Viewport.quad.fit(null, 1.5);

    /* Gizmo: TransformControls + axis triad */
    const tc = PixiStudio.Gizmo.createTransformControls(Viewport.orbit.camera, canvasWrap.querySelector('#three-canvas') || canvasWrap);
    if (tc) Viewport.scene.add(tc);
    PixiStudio.Gizmo.createAxisGizmo();

    /* Input */
    PixiStudio.Controls.init(canvasWrap, Viewport.orbit);

    /* Mặc định Perspective (yêu cầu user) — camera sẵn sàng nhìn model */
    Viewport.setView('perspective');

    bus.emit('viewport:ready', {});
  };

  /* ---------- RENDER LOOP ---------- */
  const QUAD_RECTS = [
    { x: 0, y: 0, w: 1, h: 1 },               // placeholder — set trong render()
    { x: 0, y: 0, w: 1, h: 1 },
    { x: 0, y: 0, w: 1, h: 1 },
    { x: 0, y: 0, w: 1, h: 1 }
  ];

  Viewport.render = function (dt) {
    /* cache DOM lookup — trước đây getElementById mỗi frame */
    const wrap = Viewport._wrap || (Viewport._wrap = document.getElementById('viewport-canvas-wrap'));
    if (!Viewport.scene || !wrap) return;

    const W = wrap.clientWidth || 1;
    const H = wrap.clientHeight || 1;
    const mode = PixiStudio.State.get('viewMode');
    const time = performance.now() / 1000;

    /* Camera + glow update */
    const aspect = W / Math.max(1, H);
    if (Math.abs(Viewport.orbit.camera.aspect - aspect) > 1e-4) {
      Viewport.orbit.camera.aspect = aspect;
      Viewport.orbit.camera.updateProjectionMatrix();
    }
    Viewport.orbit.update(dt);

    PixiStudio.GridEnv.pulse(time);

    /* Quad fit theo model chính */
    const mainModel = Viewport.getMainModel();
    if (mode === 'quad') {
      Viewport.quad.fit(mainModel, 1.5);
      const cw = Math.floor(W / 2), ch = Math.floor(H / 2);
      Viewport.quad.updateAspect(cw, ch);
    }

    /* Shading mode áp lên mọi mesh của model */
    Viewport.applyShading();

    const r = PixiStudio.ThreeRenderer.renderer;

    if (mode === 'quad') {
      /* 4 ô: Front TL, Right TR, Left BL, Back BR */
      const halfW = Math.floor(W / 2), halfH = Math.floor(H / 2);
      /* Lưu ý: hệ toạ độ viewport của WebGL: gốc dưới-trái */
      const rects = [
        { x: 0, y: H - halfH, w: halfW, h: halfH },        // Front (trên-trái)
        { x: W - halfW, y: H - halfH, w: halfW, h: halfH }, // Right (trên-phải)
        { x: 0, y: 0, w: halfW, h: halfH },                 // Left (dưới-trái)
        { x: W - halfW, y: 0, w: halfW, h: halfH }          // Back (dưới-phải)
      ];
      PixiStudio.ThreeRenderer.renderQuad(Viewport.scene, Viewport.quad.list, rects);
    } else {
      PixiStudio.ThreeRenderer.render(Viewport.scene, Viewport.orbit.camera);
    }

    /* Chụp stats scene chính NGAY sau khi vẽ — render axis gizmo bên dưới sẽ
       reset renderer.info nên đọc sau sẽ ra số liệu của gizmo. */
    PixiStudio.RendererManager.captureInfo();

    /* Axis gizmo mini view (chỉ single view, tránh rối) */
    if (mode !== 'quad') {
      PixiStudio.Gizmo.syncAxisToCamera(Viewport.orbit.camera);
      const gs = PixiStudio.Gizmo.axisScene, gc = PixiStudio.Gizmo.axisCamera;
      if (gs && gc && r) {
        const s = 92;
        r.setScissorTest(true);
        r.setViewport(W - s - 10, H - s - 10, s, s);
        r.setScissor(W - s - 10, H - s - 10, s, s);
        r.render(gs, gc);
        r.setScissorTest(false);
      }
    }
  };

  /* ---------- SHADING MODES ---------- */
  Viewport.applyShading = function () {
    const shading = PixiStudio.State.get('shading');
    if (Viewport._lastShading === shading && !Viewport._shadingDirty) return;
    Viewport._lastShading = shading;
    Viewport._shadingDirty = false;

    const wire = shading === 'wireframe';
    const xray = shading === 'xray';
    const solid = shading === 'solid';

    Viewport.modelRoot.traverse(function (o) {
      if (!o.isMesh) return;
      /* FIX2: mesh trang trí của xương (cylinder/khớp cầu skeleton,
         IK target/pole, trails...) PHẢI giữ nguyên material của nó —
         trước đây chế độ xray ép opacity=0.35 lên cả xương hiển thị
         (xương mờ đi ngay lúc cần thấy rõ nhất) và wireframe bật
         wireframe lên cả khớp cầu. Nhãn sprite (isArpBoneLabel) vốn
         không phải Mesh nên đã được loại; ghi rõ ở đây cho chắc. */
      if (o.userData && (o.userData.isBoneVisual || o.userData.isArpBoneLabel)) return;
      const mat = o.material;
      if (!mat) return;

      if (wire) {
        o.userData._origMat = o.userData._origMat || mat;
        if (Array.isArray(mat)) {
          mat.forEach(function (m) { m.wireframe = true; });
        } else {
          mat.wireframe = true;
        }
        return;
      }

      if (o.userData._origMat && o.userData._origMat !== mat) {
        o.material = o.userData._origMat;
      }

      if (Array.isArray(o.material)) {
        o.material.forEach(function (m) {
          m.wireframe = false;
          m.transparent = xray || m.transparent;
          m.opacity = xray ? 0.35 : (m.userData && m.userData._origOpacity !== undefined ? m.userData._origOpacity : m.opacity);
          if (solid && m.userData && m.userData._origMap) { /* giữ nguyên */ }
        });
      } else {
        const m = o.material;
        if (m.userData && m.userData._origOpacity === undefined) m.userData._origOpacity = m.opacity;
        m.wireframe = false;
        m.transparent = xray || m.transparent;
        m.opacity = xray ? 0.35 : m.userData._origOpacity;
      }
    });
  };

  Viewport.invalidateShading = function () { Viewport._shadingDirty = true; };

  /* ---------- PICKING ---------- */
  Viewport.pick = function (ndcX, ndcY) {
    if (!Viewport._raycaster || !Viewport.orbit) return null;
    const mode = PixiStudio.State.get('viewMode');

    Viewport._raycaster.setFromCamera(
      { x: ndcX, y: ndcY },
      mode === 'quad' ? Viewport.quad.front : Viewport.orbit.camera
    );

    const targets = [];
    Viewport.modelRoot.children.forEach(function (c) {
      if (c.visible) targets.push(c);
    });
    /* thêm primitive objects từ scene manager */
    if (PixiStudio.Scene) {
      PixiStudio.Scene.forEachPrimitive(function (obj) { targets.push(obj); });
    }

    const hits = Viewport._raycaster.intersectObjects(targets, true);
    if (!hits.length) return null;

    /* Leo lên ancestor top-level đã đăng ký */
    let obj = hits[0].object;
    while (obj) {
      if (PixiStudio.Scene && PixiStudio.Scene.registry[obj.uuid]) return obj;
      if (obj.parent === Viewport.modelRoot) return obj;
      obj = obj.parent;
    }
    return null;
  };

  /* ---------- HELPERS ---------- */
  /* Leo từ 1 object bất kỳ (mesh, xương, con cháu model) lên child
   * trực tiếp của modelRoot; trả null nếu object không nằm trong
   * modelRoot (vd primitive của Scene, gizmo). Dùng cho getMainModel
   * để selection/current trỏ tới model đúng dù user đang chọn 1 mesh
   * hay 1 xương bên trong model đó. */
  function topLevelChildOfModelRoot(obj) {
    if (!obj || !Viewport.modelRoot) return null;
    let o = obj;
    let guard = 0;
    while (o && o.parent && o.parent !== Viewport.modelRoot && guard < 64) {
      o = o.parent;
      guard++;
    }
    if (o && o.parent === Viewport.modelRoot) return o;
    return null;
  }
  Viewport.getMainModel = function () {
    if (!Viewport.modelRoot) return null;
    const kids = Viewport.modelRoot.children;
    if (!kids.length) return null;
    /* FIX (ARP View vòng 1, 2026-11-27): trước đây trả về child VISIBLE
     * ĐẦU TIÊN của modelRoot — studio tự nạp model mẫu Hero_001 (Sample)
     * lúc mở trang nên sau khi import FBX rigged, getMainModel() vẫn trả
     * về Sample (0 xương) và mọi đường resolve target không đối số của
     * ARP View (skeleton/labels/trails) đều báo "không có skeleton".
     * Nay ưu tiên model ĐANG CHỌN / model HIỆN TẠI (mới import nhất —
     * registerModel set cả State.selection lẫn Models.currentId), chỉ
     * rơi về child visible đầu tiên khi không xác định được model nào.
     * Các caller cũ (exporter, rig, animation...) đều đã dùng mẫu
     * `selection || getMainModel()` nên thứ tự này khớp đúng ngữ nghĩa
     * "model chính" của chúng; Quad fit / glow cũng fit đúng model user
     * đang làm việc thay vì model mẫu. */
    let sel = null;
    try { sel = PixiStudio.State.get('selection'); } catch (e) { sel = null; }
    const fromSel = topLevelChildOfModelRoot(sel);
    if (fromSel && fromSel.visible) return fromSel;
    let cur = null;
    try {
      cur = (PixiStudio.Models && typeof PixiStudio.Models.getCurrent === 'function')
        ? PixiStudio.Models.getCurrent() : null;
    } catch (e) { cur = null; }
    if (cur && cur.object3D) {
      const fromCur = topLevelChildOfModelRoot(cur.object3D);
      if (fromCur && fromCur.visible) return fromCur;
    }
    return kids.find(function (c) { return c.visible; }) || null;
  };

  Viewport.focusSelected = function () {
    const sel = PixiStudio.State.get('selection');
    const target = sel || Viewport.getMainModel();
    Viewport.orbit.focus(target);
  };

  /* Frame All (học MapEditor): khung toàn bộ modelRoot — nếu trống thì
   * về góc nhìn mặc định. */
  Viewport.frameAll = function () {
    if (!Viewport.modelRoot || !Viewport.modelRoot.children.length) {
      Viewport.resetCamera();
      return false;
    }
    Viewport.orbit.focus(Viewport.modelRoot);
    return true;
  };

  /* Camera bookmarks (học MapEditor): Alt+1..5 nhảy, Alt+Shift+1..5 lưu. */
  Viewport.saveCameraBookmark = function (slot) {
    if (!Viewport.orbit || !Viewport.orbit.saveBookmark) return false;
    Viewport.orbit.saveBookmark(slot);
    return true;
  };
  Viewport.gotoCameraBookmark = function (slot) {
    if (!Viewport.orbit || !Viewport.orbit.gotoBookmark) return false;
    return Viewport.orbit.gotoBookmark(slot);
  };
  Viewport.cameraBookmarkLabel = function (slot) {
    if (!Viewport.orbit || !Viewport.orbit.bookmarkLabel) return '— trống —';
    return Viewport.orbit.bookmarkLabel(slot);
  };

  Viewport.resetCamera = function () {
    Viewport.orbit.setView('perspective');
  };

  Viewport.addModel = function (object3D) {
    Viewport.modelRoot.add(object3D);
    PixiStudio.GridEnv.setGlowPosition(object3D.position.x, object3D.position.z);
    Viewport._shadingDirty = true;
  };

  Viewport.removeModel = function (object3D) {
    Viewport.modelRoot.remove(object3D);
    const next = Viewport.getMainModel();
    if (next) PixiStudio.GridEnv.setGlowPosition(next.position.x, next.position.z);
  };

  Viewport.setView = function (mode) {
    if (mode === 'quad') {
      PixiStudio.State.set('viewMode', 'quad');
      if (PixiStudio.Gizmo.transformControls) PixiStudio.Gizmo.transformControls.enabled = false;
    } else {
      PixiStudio.State.set('viewMode', mode);
      Viewport.orbit.setView(mode);
      PixiStudio.Gizmo.refreshVisible();
    }
    /* FIX2: chip Front/Right/Left/Back (#quad-labels) CHỈ hiện ở chế
       độ quad-view (kèm setting showQuadLabels) — trước đây setting
       mặc định true nên chip "BACK" (.br ở giữa màn hình) rò sang
       cả single-view. Viewport.init() gọi setView('perspective')
       nên trạng thái đúng ngay từ lúc boot. */
    try {
      const ql = document.getElementById('quad-labels');
      if (ql) ql.classList.toggle('hidden', !(mode === 'quad' && PixiStudio.State.get('showQuadLabels')));
    } catch (e) { /* HUD chưa có trong DOM: bỏ qua */ }
    /* Gizmo chỉ dùng được single view */
    if (PixiStudio.Gizmo.transformControls) {
      const gizOk = mode !== 'quad';
      PixiStudio.Gizmo.transformControls.enabled = gizOk && PixiStudio.State.get('gizmoMode') !== 'select';
      PixiStudio.Gizmo.transformControls.visible = gizOk && PixiStudio.Gizmo.transformControls.visible;
    }
    bus.emit('viewport:view', { mode: mode });
  };

  Viewport.screenshot = function (width, height, format) {
    const mode = PixiStudio.State.get('viewMode');
    /* Screenshot luôn dùng perspective camera full-frame */
    const cam = mode === 'quad' ? Viewport.orbit.camera : Viewport.orbit.camera;
    const w = width || 1920, h = height || 1080;
    /* giữ aspect hiện tại */
    const wrap = document.getElementById('viewport-canvas-wrap');
    const aspect = (wrap ? wrap.clientWidth : 16) / Math.max(1, wrap ? wrap.clientHeight : 9);
    const oldAspect = cam.aspect;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const url = PixiStudio.ThreeRenderer.renderToImage(Viewport.scene, cam, w, h, format || 'png');
    cam.aspect = oldAspect;
    cam.updateProjectionMatrix();
    return url;
  };

  window.PixiStudio.Viewport = Viewport;
})();
