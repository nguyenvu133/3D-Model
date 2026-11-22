/* ============================================================
 * viewport/camera.js — OrbitCam tự viết (không phụ thuộc OrbitControls)
 * Orbit / Pan / Zoom / Focus / Damping + bộ ortho camera cho Quad View.
 * ============================================================ */
(function () {
  'use strict';

  const U = PixiStudio.Utils;

  function OrbitCam(aspect) {
    this.camera = new THREE.PerspectiveCamera(38, aspect || 1, 0.1, 500);
    this.target = new THREE.Vector3(0, 0.9, 0);

    this.radius = 5.2;
    this.theta = THREE.MathUtils.degToRad(28);   // azimuth quanh trục Y
    this.phi = THREE.MathUtils.degToRad(72);     // polar từ trục Y (90 = ngang)

    this.minRadius = 1.2;
    this.maxRadius = 30;
    this.minPhi = 0.12;
    this.maxPhi = Math.PI - 0.12;

    /* damping targets */
    this.dTheta = this.theta; this.dPhi = this.phi; this.dRadius = this.radius;
    this.dTarget = this.target.clone();

    this.enabled = true;
    this._updateCamera(1);
  }

  OrbitCam.prototype.orbit = function (dx, dy) {
    if (!this.enabled) return;
    const speed = 0.0052;
    this.dTheta -= dx * speed;
    this.dPhi -= dy * speed;
    this.dPhi = U.clamp(this.dPhi, this.minPhi, this.maxPhi);
  };

  OrbitCam.prototype.pan = function (dx, dy) {
    if (!this.enabled) return;
    const scale = this.radius * 0.0016;
    const xAxis = new THREE.Vector3(), yAxis = new THREE.Vector3();
    this.camera.matrix.extractBasis(xAxis, yAxis, new THREE.Vector3());
    /* pan ngược hướng kéo — cảm giác như Blender/Maya */
    this.dTarget.addScaledVector(xAxis, -dx * scale);
    this.dTarget.addScaledVector(yAxis, dy * scale);
  };

  OrbitCam.prototype.zoom = function (delta) {
    if (!this.enabled) return;
    /* expoential zoom mượt */
    const factor = Math.pow(0.998, delta);
    this.dRadius = U.clamp(this.dRadius * factor, this.minRadius, this.maxRadius);
  };

  OrbitCam.prototype.zoomBy = function (mult) {
    this.dRadius = U.clamp(this.dRadius * mult, this.minRadius, this.maxRadius);
  };

  OrbitCam.prototype.focus = function (object3D, immediate) {
    if (!object3D) { this.dTarget.set(0, 0.9, 0); this.dRadius = 5.2; return; }
    const box = new THREE.Box3().setFromObject(object3D);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fit = maxDim / (2 * Math.tan((this.camera.fov * Math.PI / 180) / 2)) * 1.35;
    this.dTarget.copy(center);
    this.dRadius = U.clamp(fit, this.minRadius, this.maxRadius);
    if (immediate) {
      this.target.copy(this.dTarget);
      this.radius = this.dRadius;
      this._updateCamera(1);
    }
  };

  /* ---------- View presets ---------- */
  const VIEWS = {
    perspective: { theta: THREE.MathUtils.degToRad(28), phi: THREE.MathUtils.degToRad(72), radius: 5.2, target: [0, 0.9, 0] },
    ortho: { theta: THREE.MathUtils.degToRad(35), phi: THREE.MathUtils.degToRad(70), radius: 5.2, target: [0, 0.9, 0] },
    front: { theta: 0, phi: THREE.MathUtils.degToRad(90), radius: 4.2, target: [0, 0.9, 0] },
    back: { theta: Math.PI, phi: THREE.MathUtils.degToRad(90), radius: 4.2, target: [0, 0.9, 0] },
    left: { theta: -Math.PI / 2, phi: THREE.MathUtils.degToRad(90), radius: 4.2, target: [0, 0.9, 0] },
    right: { theta: Math.PI / 2, phi: THREE.MathUtils.degToRad(90), radius: 4.2, target: [0, 0.9, 0] },
    top: { theta: THREE.MathUtils.degToRad(45), phi: 0.14, radius: 5.5, target: [0, 0.5, 0] },
    bottom: { theta: THREE.MathUtils.degToRad(45), phi: Math.PI - 0.14, radius: 5.5, target: [0, 0.5, 0] }
  };

  OrbitCam.prototype.setView = function (name) {
    const v = VIEWS[name];
    if (!v) return false;
    this.dTheta = v.theta; this.dPhi = v.phi; this.dRadius = v.radius;
    this.dTarget.set(v.target[0], v.target[1], v.target[2]);
    return true;
  };

  OrbitCam.prototype._updateCamera = function () {
    /* Đặt camera từ giá trị hiện tại (damping lerp đã chạy trong update) */
    if (!isFinite(this.theta) || !isFinite(this.phi) || !isFinite(this.radius)) return;

    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sinPhi * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sinPhi * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  };

  /* Mỗi frame: damp 12%/frame @60fps */
  OrbitCam.prototype.update = function (dt) {
    if (!isFinite(dt)) dt = 0.016;
    const k = 1 - Math.pow(0.0009, dt);  /* damping độc lập fps */
    this.theta = U.lerp(this.theta, this.dTheta, k);
    this.phi = U.lerp(this.phi, this.dPhi, k);
    this.radius = U.lerp(this.radius, this.dRadius, k);
    this.target.lerp(this.dTarget, k);
    this._updateCamera();
  };

  /* ============================================================
     QUAD VIEW — 4 ortho camera (Front / Right / Left / Back)
     ============================================================ */
  function QuadCameras() {
    this.front = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 100);
    this.back = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 100);
    this.left = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 100);
    this.right = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 100);
    this.list = [this.front, this.right, this.left, this.back];
    this.labels = ['Front', 'Right', 'Left', 'Back'];
  }

  QuadCameras.prototype.fit = function (object3D, margin) {
    /* fit TỪNG camera theo bbox chiếu lên mặt phẳng của hướng nhìn đó */
    const m = margin || 1.3;
    let box;
    if (object3D && !object3D.visible) object3D = null;
    if (object3D) {
      box = new THREE.Box3().setFromObject(object3D);
    } else {
      box = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 4;

    const set = function (cam, dir, halfW, halfH) {
      cam.position.set(center.x + dir[0] * dist, center.y + (dir[1] || 0), center.z + dir[2] * dist);
      cam.lookAt(center);
      cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
      cam.near = -100; cam.far = 400;
      cam.userData.baseHalfW = halfW;
      cam.userData.baseHalfH = halfH;
      cam.updateProjectionMatrix();
    };

    const hW = size.x / 2 * m;   /* width nhìn từ trước/sau */
    const dW = size.z / 2 * m;   /* width nhìn từ trái/phải */
    const vH = size.y / 2 * m + size.y * 0.05;

    set(this.front, [0, 0, 1], hW, vH);
    set(this.back, [0, 0, -1], hW, vH);
    set(this.left, [-1, 0, 0], dW, vH);
    set(this.right, [1, 0, 0], dW, vH);
  };

  QuadCameras.prototype.updateAspect = function (cellW, cellH) {
    const aspect = cellW / Math.max(1, cellH);
    this.list.forEach(function (c) {
      const bh = c.userData.baseHalfH || 1.5;
      const bw = c.userData.baseHalfW || 1.5;
      /* chiều cao giữ nguyên theo bbox; chiều rộng nhân aspect ô */
      c.left = -bw * aspect; c.right = bw * aspect;
      c.top = bh; c.bottom = -bh;
      c.updateProjectionMatrix();
    });
  };

  window.PixiStudio.OrbitCam = OrbitCam;
  window.PixiStudio.QuadCameras = QuadCameras;
})();
