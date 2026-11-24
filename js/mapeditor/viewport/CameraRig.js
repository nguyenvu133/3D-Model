/* ============================================================
 * mapeditor/viewport/CameraRig.js — Orbit camera rig
 * Spherical coords (target, radius, theta, phi). Views:
 * iso / perspective / top / front / side. focus(obj) ôm object,
 * frameAll() ôm cả map. Không phụ thuộc DOM.
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  var VIEWS = {
    iso: { theta: Math.PI / 4, phi: 0.955, radius: 95 },
    perspective: { theta: 0.6, phi: 1.1, radius: 70 },
    top: { theta: 0, phi: 0.06, radius: 95 },
    front: { theta: 0, phi: Math.PI / 2, radius: 85 },
    side: { theta: Math.PI / 2, phi: Math.PI / 2, radius: 85 }
  };

  function CameraRig(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(0, 0, 0);
    this.radius = 95;
    this.theta = Math.PI / 4;
    this.phi = 0.955;
    this.minRadius = 8;
    this.maxRadius = 260;
    this.view = 'iso';
    this.bookmarks = [null, null, null, null, null];
    this.loadBookmarks();
  }

  CameraRig.prototype.update = function () {
    var phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.phi));
    this.phi = phi;
    var sp = Math.sin(phi), cp = Math.cos(phi);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * cp,
      this.target.z + this.radius * sp * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  };

  CameraRig.prototype.setView = function (name) {
    var v = VIEWS[name];
    if (!v) return false;
    this.view = name;
    this.theta = v.theta;
    this.phi = v.phi;
    this.radius = v.radius;
    this.update();
    return true;
  };

  CameraRig.prototype.rotate = function (dTheta, dPhi) {
    this.theta += dTheta;
    this.phi += dPhi;
    this.update();
  };

  CameraRig.prototype.zoom = function (factor) {
    this.radius = Math.max(this.minRadius, Math.min(this.maxRadius, this.radius * factor));
    this.update();
  };

  CameraRig.prototype.pan = function (dx, dy) {
    /* dx,dy: world units trên mặt phẳng nhìn từ camera */
    var right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    var up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    right.y = 0; right.normalize();
    var fwd = new THREE.Vector3();
    fwd.crossVectors(up, right).normalize();
    fwd.y = 0; fwd.normalize();
    this.target.addScaledVector(right, -dx);
    this.target.addScaledVector(fwd, dy);
    this.target.x = Math.max(-90, Math.min(90, this.target.x));
    this.target.z = Math.max(-90, Math.min(90, this.target.z));
    this.target.y = Math.max(0, Math.min(30, this.target.y));
    this.update();
  };

  CameraRig.prototype.focus = function (obj) {
    if (!obj) return false;
    var box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) {
      this.target.copy(obj.position);
      this.radius = 20;
    } else {
      var c = box.getCenter(new THREE.Vector3());
      var s = box.getSize(new THREE.Vector3());
      this.target.copy(c);
      this.radius = Math.max(10, s.length() * 1.6);
    }
    this.update();
    return true;
  };

  CameraRig.prototype.frameAll = function (size) {
    this.target.set(0, 0, 0);
    this.radius = (size || 112) * 0.95;
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
      theta: this.theta, phi: this.phi, radius: this.radius,
      target: [this.target.x, this.target.y, this.target.z]
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
    this.theta = b.theta; this.phi = b.phi; this.radius = b.radius;
    this.target.set(b.target[0], b.target[1], b.target[2]);
    this.update();
    return true;
  };
  CameraRig.prototype.bookmarkLabel = function (slot) {
    var b = this.bookmarks[Math.max(0, Math.min(4, slot | 0))];
    if (!b) return '— trống —';
    return 'r=' + Math.round(b.radius) + ' · (' + Math.round(b.target[0]) + ', ' + Math.round(b.target[2]) + ')';
  };

  ME.CameraRig = CameraRig;
  ME.CameraRig.VIEWS = VIEWS;
})();
