/* ============================================================
 * mapeditor/viewport/CameraRig.js — Orbit camera rig
 * Spherical coords (target, radius, theta, phi). Views:
 * iso / perspective / top / front / back / left / right / bottom.
 * Học từ Studio OrbitCam (js/viewport/camera.js):
 *  - damping: theta/phi/radius/target có bản "desired" (dTheta...)
 *    và bản hiện tại; update(dt) lerp như OrbitCam (k = 1 - 0.0009^dt),
 *    update() không tham số = snap ngay (tương thích code cũ gọi
 *    rig.update() sau setView/focus).
 *  - focus-fit dùng đúng công thức Studio:
 *    fit = maxDim / (2*tan(fov/2)) * 1.35.
 *  - chế độ Ortho: rig giữ cả 2 camera (persp + ortho), đổi qua
 *    setCamera(); ortho frustum tỉ lệ theo radius (zoom đổi radius).
 *  - FOV 30–90° (chỉ có tác dụng ở Persp).
 * focus(obj) ôm object, frameAll() ôm cả map. Không phụ thuộc DOM.
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  var VIEWS = {
    iso: { theta: Math.PI / 4, phi: 0.955, radius: 95, target: [0, 0, 0] },
    perspective: { theta: 0.6, phi: 1.1, radius: 70, target: [0, 0, 0] },
    top: { theta: 0, phi: 0.06, radius: 95, target: [0, 0, 0] },
    bottom: { theta: 0, phi: Math.PI - 0.06, radius: 95, target: [0, 0, 0] },
    front: { theta: 0, phi: Math.PI / 2, radius: 85, target: [0, 0, 0] },
    back: { theta: Math.PI, phi: Math.PI / 2, radius: 85, target: [0, 0, 0] },
    left: { theta: -Math.PI / 2, phi: Math.PI / 2, radius: 85, target: [0, 0, 0] },
    right: { theta: Math.PI / 2, phi: Math.PI / 2, radius: 85, target: [0, 0, 0] },
    side: { theta: Math.PI / 2, phi: Math.PI / 2, radius: 85, target: [0, 0, 0] }
  };

  function CameraRig(camera) {
    this.camera = camera || null;
    this.target = new THREE.Vector3(0, 0, 0);
    this.radius = 95;
    this.theta = Math.PI / 4;
    this.phi = 0.955;
    /* damping targets (học OrbitCam Studio) */
    this.dTarget = this.target.clone();
    this.dRadius = this.radius;
    this.dTheta = this.theta;
    this.dPhi = this.phi;
    this.damping = true;
    this.minRadius = 8;
    this.maxRadius = 260;
    this.fov = 50;
    this.ortho = false;
    this.view = 'iso';
    this.bookmarks = [null, null, null, null, null];
    this.loadBookmarks();
  }

  /* Đổi camera đang điều khiển (persp <-> ortho). */
  CameraRig.prototype.setCamera = function (camera) {
    this.camera = camera;
    this._applyOrthoFrustum();
    this.update();
  };

  CameraRig.prototype._applyOrthoFrustum = function () {
    var cam = this.camera;
    if (!cam || !cam.isOrthographicCamera) return;
    var aspect = cam.aspect || 1;
    var halfH = Math.max(2, this.radius * 0.55);
    cam.left = -halfH * aspect; cam.right = halfH * aspect;
    cam.top = halfH; cam.bottom = -halfH;
    cam.near = -500; cam.far = 1000;
    cam.updateProjectionMatrix();
  };

  CameraRig.prototype.setOrtho = function (on) {
    this.ortho = !!on;
    if (this.camera) {
      if (this.camera.isPerspectiveCamera && this.ortho) {
        /* Viewport3D đổi camera thật qua rig.setCamera; ở đây chỉ ghi trạng thái */
      }
      this._applyOrthoFrustum();
    }
    this.update();
    return this.ortho;
  };

  CameraRig.prototype.setFov = function (deg) {
    deg = Math.max(30, Math.min(90, deg || 50));
    this.fov = deg;
    var cam = this.camera;
    if (cam && cam.isPerspectiveCamera) {
      cam.fov = deg;
      cam.updateProjectionMatrix();
    }
    return this.fov;
  };

  CameraRig.prototype._apply = function () {
    if (!this.camera) return;
    var phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.phi));
    this.phi = phi;
    var sp = Math.sin(phi), cp = Math.cos(phi);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * cp,
      this.target.z + this.radius * sp * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
    if (this.camera.isOrthographicCamera) this._applyOrthoFrustum();
  };

  /* update() không tham số: snap ngay về desired (tương thích code cũ).
   * update(dt): lerp mượt như OrbitCam Studio (k = 1 - 0.0009^dt). */
  CameraRig.prototype.update = function (dt) {
    if (dt === undefined || dt === null || !this.damping) {
      this.theta = this.dTheta; this.phi = this.dPhi;
      this.radius = this.dRadius; this.target.copy(this.dTarget);
      this._apply();
      return;
    }
    if (!isFinite(dt)) dt = 0.016;
    var k = 1 - Math.pow(0.0009, dt); /* damping độc lập fps, như Studio */
    function lerp(a, b, t) { return a + (b - a) * t; }
    this.theta = lerp(this.theta, this.dTheta, k);
    this.phi = lerp(this.phi, this.dPhi, k);
    this.radius = lerp(this.radius, this.dRadius, k);
    this.target.lerp(this.dTarget, k);
    this._apply();
  };

  /* Alias rõ nghĩa cho render loop gọi mỗi frame. */
  CameraRig.prototype.updateSmooth = function (dt) {
    this.update(dt === undefined ? 0.016 : dt);
  };

  /* Ép current = desired ngay (sau rotate/zoom bằng code cần hiệu lực tức thì). */
  CameraRig.prototype.snap = function () {
    this.update();
    return this;
  };

  CameraRig.prototype.setView = function (name) {
    var v = VIEWS[name];
    if (!v) return false;
    this.view = name;
    this.dTheta = v.theta; this.dPhi = v.phi; this.dRadius = v.radius;
    this.dTarget.set(v.target[0], v.target[1], v.target[2]);
    this.update(); /* view preset: nhảy ngay, không damp */
    return true;
  };

  CameraRig.prototype.rotate = function (dTheta, dPhi) {
    this.dTheta += dTheta;
    this.dPhi += dPhi;
    this.dPhi = Math.max(0.05, Math.min(Math.PI - 0.05, this.dPhi));
    /* không snap — render loop damp dần về desired */
  };

  CameraRig.prototype.zoom = function (factor) {
    this.dRadius = Math.max(this.minRadius, Math.min(this.maxRadius, this.dRadius * factor));
    /* không snap — render loop damp dần về desired */
  };

  CameraRig.prototype.pan = function (dx, dy) {
    /* dx,dy: world units trên mặt phẳng nhìn từ camera */
    if (!this.camera) return;
    var right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    var up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    right.y = 0; right.normalize();
    var fwd = new THREE.Vector3();
    fwd.crossVectors(up, right).normalize();
    fwd.y = 0; fwd.normalize();
    this.dTarget.addScaledVector(right, -dx);
    this.dTarget.addScaledVector(fwd, dy);
    this.dTarget.x = Math.max(-90, Math.min(90, this.dTarget.x));
    this.dTarget.z = Math.max(-90, Math.min(90, this.dTarget.z));
    this.dTarget.y = Math.max(0, Math.min(30, this.dTarget.y));
    /* không snap — render loop damp dần về desired */
  };

  /* Focus-fit đúng công thức Studio:
   * fit = maxDim / (2*tan(fov/2)) * 1.35 (persp); ortho: maxDim*1.1. */
  CameraRig.prototype.focus = function (obj) {
    if (!obj) return false;
    var box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) {
      this.dTarget.copy(obj.position);
      this.dRadius = 20;
    } else {
      var c = box.getCenter(new THREE.Vector3());
      var s = box.getSize(new THREE.Vector3());
      var maxDim = Math.max(s.x, s.y, s.z);
      this.dTarget.copy(c);
      if (this.ortho) {
        this.dRadius = Math.max(10, maxDim * 1.1);
      } else {
        var fov = (this.camera && this.camera.isPerspectiveCamera) ? this.camera.fov : this.fov;
        var fit = maxDim / (2 * Math.tan((fov * Math.PI / 180) / 2)) * 1.35;
        this.dRadius = Math.max(10, Math.min(this.maxRadius, fit));
      }
    }
    this.update(); /* focus: nhảy ngay */
    return true;
  };

  CameraRig.prototype.frameAll = function (size) {
    this.dTarget.set(0, 0, 0);
    this.dRadius = (size || 112) * 0.95;
    this.update();
  };

  CameraRig.prototype.reset = function () {
    return this.setView('iso');
  };

  /* ---------- camera bookmarks (5 vị trí, lưu localStorage) ---------- */
  CameraRig.prototype.loadBookmarks = function () {
    try {
      var all = JSON.parse(window.localStorage.getItem('mapeditor.bookmarks') || 'null');
      if (Array.isArray(all)) {
        for (var i = 0; i < 5; i++) this.bookmarks[i] = all[i] || null;
      }
    } catch (e) { /* localStorage chặn thì dùng bộ nhớ tạm */ }
    return this.bookmarks;
  };
  CameraRig.prototype.saveBookmark = function (slot) {
    slot = Math.max(0, Math.min(4, slot | 0));
    this.bookmarks[slot] = {
      theta: this.dTheta, phi: this.dPhi, radius: this.dRadius,
      target: [this.dTarget.x, this.dTarget.y, this.dTarget.z],
      ortho: this.ortho, fov: this.fov
    };
    try { window.localStorage.setItem('mapeditor.bookmarks', JSON.stringify(this.bookmarks)); } catch (e) { }
    return this.bookmarks[slot];
  };
  CameraRig.prototype.gotoBookmark = function (slot) {
    slot = Math.max(0, Math.min(4, slot | 0));
    var b = this.bookmarks[slot];
    if (!b) {
      this.loadBookmarks();
      b = this.bookmarks[slot];
    }
    if (!b) return false;
    this.dTheta = b.theta; this.dPhi = b.phi; this.dRadius = b.radius;
    this.dTarget.set(b.target[0], b.target[1], b.target[2]);
    if (b.ortho !== undefined && ME.Viewport3D && ME.Viewport3D.setOrthoMode) {
      ME.Viewport3D.setOrthoMode(!!b.ortho);
    }
    if (b.fov && ME.Viewport3D && ME.Viewport3D.setFov) ME.Viewport3D.setFov(b.fov);
    this.update();
    return true;
  };
  CameraRig.prototype.bookmarkLabel = function (slot) {
    var b = this.bookmarks[Math.max(0, Math.min(4, slot | 0))];
    if (!b) return '— trống —';
    return 'r=' + Math.round(b.radius) + ' · (' + Math.round(b.target[0]) + ', ' + Math.round(b.target[2]) + ')' + (b.ortho ? ' · ortho' : '');
  };

  ME.CameraRig = CameraRig;
  ME.CameraRig.VIEWS = VIEWS;
})();
