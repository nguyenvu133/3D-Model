/* ============================================================
 * viewport/gizmo.js — TransformControls wrapper + Axis Triad 3D
 * (góc phải trên, quay theo camera như Blender).
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Gizmo = {
    transformControls: null,
    axisScene: null,
    axisCamera: null,
    axisGroup: null,
    available: false
  };

  /* ---------- Transform Gizmo (move/rotate/scale) ---------- */
  Gizmo.createTransformControls = function (camera, domElement) {
    if (!window.THREE || !THREE.TransformControls) {
      console.warn('[Gizmo] TransformControls chưa load — dùng Inspector input để transform.');
      return null;
    }
    try {
      const tc = new THREE.TransformControls(camera, domElement);
      tc.setSize(0.85);
      tc.visible = false;   /* chỉ hiện khi attach + mode != select */
      /* Snap góc đã lưu (Object Tools): kéo vòng xoay dính theo bội số */
      const savedSnap = PixiStudio.State.get('rotateSnap');
      if (savedSnap > 0) tc.rotationSnap = THREE.MathUtils.degToRad(savedSnap);

      tc.addEventListener('dragging-changed', function (e) {
        bus.emit('gizmo:dragging', { dragging: e.value });
        if (!e.value) {
          /* kết thúc drag → lịch sử + inspector refresh */
          PixiStudio.History.push('Transform ' + (PixiStudio.State.get('gizmoMode') || ''));
          bus.emit('transform:changed', { source: 'gizmo' });
        }
      });

      tc.addEventListener('objectChange', function () {
        bus.emit('transform:changing', { source: 'gizmo' });
      });

      Gizmo.transformControls = tc;
      Gizmo.available = true;
      return tc;
    } catch (err) {
      console.warn('[Gizmo] TransformControls init lỗi:', err);
      return null;
    }
  };

  Gizmo.attach = function (object3D) {
    if (Gizmo.transformControls) {
      if (object3D) Gizmo.transformControls.attach(object3D);
      else Gizmo.transformControls.detach();
      Gizmo.refreshVisible();
    }
  };

  Gizmo.setMode = function (mode) {
    if (!Gizmo.transformControls) return;
    if (mode === 'select') {
      Gizmo.transformControls.visible = false;
      Gizmo.transformControls.enabled = false;
    } else {
      const m = mode === 'move' ? 'translate' : mode === 'rotate' ? 'rotate' : 'scale';
      Gizmo.transformControls.setMode(m);
      Gizmo.transformControls.enabled = true;
      Gizmo.transformControls.visible = !!Gizmo.transformControls.object;
    }
  };

  Gizmo.setSpace = function (space) {
    if (Gizmo.transformControls) {
      Gizmo.transformControls.setSpace(space === 'world' ? 'world' : 'local');
    }
  };

  /* Snap góc cho kéo vòng xoay (độ; 0 = tắt). */
  Gizmo.setRotationSnap = function (deg) {
    if (!Gizmo.transformControls) return;
    Gizmo.transformControls.rotationSnap = deg > 0 ? THREE.MathUtils.degToRad(deg) : null;
  };

  Gizmo.refreshVisible = function () {
    if (!Gizmo.transformControls) return;
    const mode = PixiStudio.State.get('gizmoMode');
    Gizmo.transformControls.visible = mode !== 'select' && !!Gizmo.transformControls.object;
  };

  /* ---------- Axis Triad mini-scene ---------- */
  Gizmo.createAxisGizmo = function () {
    if (!window.THREE) return;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
    camera.position.set(0, 0, 3);

    const group = new THREE.Group();

    const makeAxis = function (dir, color, label) {
      const mat = new THREE.MeshBasicMaterial({ color: color });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.95, 12), mat);
      shaft.position.copy(dir).multiplyScalar(0.5);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 12), mat);
      tip.position.copy(dir).multiplyScalar(1.05);
      /* hướng tip theo trục */
      if (dir.y === 1) { /* mặc định hướng lên — ok */ }
      else if (dir.x === 1) { tip.rotation.z = -Math.PI / 2; }
      else if (dir.z === 1) { tip.rotation.x = Math.PI / 2; }
      const g = new THREE.Group();
      g.add(shaft, tip);
      g.userData.label = label;
      return g;
    };

    group.add(makeAxis(new THREE.Vector3(1, 0, 0), 0xff4d5e, 'X'));
    group.add(makeAxis(new THREE.Vector3(0, 1, 0), 0x42df75, 'Y'));
    group.add(makeAxis(new THREE.Vector3(0, 0, 1), 0x27bfff, 'Z'));

    /* vòng tròn nhỏ quanh tâm */
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.02, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x55556a, transparent: true, opacity: 0.6 })
    );
    group.add(ring);

    scene.add(group);
    Gizmo.axisScene = scene;
    Gizmo.axisCamera = camera;
    Gizmo.axisGroup = group;
  };

  /* Đồng bộ hướng triad với camera chính */
  Gizmo.syncAxisToCamera = function (camera) {
    if (!Gizmo.axisGroup || !camera) return;
    const v = camera.position.clone().normalize();
    const theta = Math.atan2(v.x, v.z);
    const phi = Math.acos(U.clamp(v.y / Math.max(0.0001, v.length()), -1, 1));
    Gizmo.axisGroup.rotation.set(0, theta, 0);
    Gizmo.axisGroup.rotation.x = phi - Math.PI / 2;
    /* Đặt camera nhìn từ hướng camera chính để triad phản chiếu đúng */
    Gizmo.axisCamera.position.set(v.x * 3, v.y * 3, v.z * 3);
    Gizmo.axisCamera.lookAt(0, 0, 0);
  };

  window.PixiStudio.Gizmo = Gizmo;
})();
