/* ============================================================
 * scene/scene-director.js — Smart Scene Director (v21.0)
 *
 * Đạo diễn cảnh thông minh, chạy local không cần AI cloud:
 *  - Ground snap: đặt model đứng đúng mặt đất (bbox min.y = 0).
 *  - Layout: xếp nhiều model thành hàng / vòng tròn / lưới, tự
 *    tính khoảng cách từ kích thước thật của từng model.
 *  - Frame camera: đặt camera vừa khung model (tính từ bbox + FOV).
 *  - Stage: 1 click — snap + layout + frame camera.
 * ============================================================ */
(function () {
  'use strict';

  const Director = {};

  function boxOf(obj) {
    return new THREE.Box3().setFromObject(obj);
  }

  /* Đặt obj đứng trên mặt đất (y=0). Trả độ cao đã dịch. */
  Director.groundSnap = function (obj, groundY) {
    if (!obj) return 0;
    const gy = (groundY === undefined) ? 0 : groundY;
    const box = boxOf(obj);
    const dy = gy - box.min.y;
    obj.position.y += dy;
    return dy;
  };

  /* Xếp nhiều object: 'row' | 'circle' | 'grid'. Trả vị trí đã đặt. */
  Director.layout = function (objects, mode, gap) {
    objects = (objects || []).filter(Boolean);
    if (!objects.length) return [];
    gap = (gap === undefined) ? 0.4 : gap;
    const sizes = objects.map(function (o) {
      const b = boxOf(o);
      return { w: b.max.x - b.min.x, d: b.max.z - b.min.z, cx: (b.max.x + b.min.x) / 2, cz: (b.max.z + b.min.z) / 2 };
    });
    const placed = [];
    if (mode === 'circle') {
      const totalW = sizes.reduce(function (s, x) { return s + x.w + gap; }, 0);
      const radius = Math.max(1.2, totalW / (2 * Math.PI));
      objects.forEach(function (o, i) {
        const a = (Math.PI * 2 * i) / objects.length;
        o.position.x = Math.cos(a) * radius;
        o.position.z = Math.sin(a) * radius;
        o.rotation.y = -a + Math.PI; // quay mặt vào tâm
        placed.push({ x: o.position.x, z: o.position.z });
      });
    } else if (mode === 'grid') {
      const cols = Math.ceil(Math.sqrt(objects.length));
      let x = 0, z = 0, rowDepth = 0;
      objects.forEach(function (o, i) {
        const s = sizes[i];
        if (i % cols === 0 && i > 0) { x = 0; z += rowDepth + gap; rowDepth = 0; }
        o.position.x = x + s.w / 2 - s.cx;
        o.position.z = z + s.d / 2 - s.cz;
        placed.push({ x: o.position.x, z: o.position.z });
        x += s.w + gap;
        rowDepth = Math.max(rowDepth, s.d);
      });
    } else { // 'row'
      let x = 0;
      objects.forEach(function (o, i) {
        const s = sizes[i];
        o.position.x = x + s.w / 2 - s.cx;
        o.position.z = -s.cz;
        placed.push({ x: o.position.x, z: o.position.z });
        x += s.w + gap;
      });
    }
    return placed;
  };

  /* Đặt camera vừa khung target. Trả {position, target, distance}. */
  Director.frameCamera = function (camera, target, fovDeg) {
    if (!camera || !target) return null;
    const box = boxOf(target);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const fov = THREE.MathUtils.degToRad(fovDeg || (camera.fov || 50));
    const radius = size.length() / 2;
    const distance = Math.max(0.5, (radius / Math.tan(fov / 2)) * 1.35);
    const dir = new THREE.Vector3(1, 0.55, 1).normalize();
    const pos = center.clone().addScaledVector(dir, distance);
    camera.position.copy(pos);
    if (camera.lookAt) camera.lookAt(center);
    if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();
    return { position: [pos.x, pos.y, pos.z], target: [center.x, center.y, center.z], distance: distance };
  };

  /* Frame bằng OrbitCam của studio (đặt dTarget/dRadius để damping chạy).
     Nhận OrbitCam hoặc mảng object; trả {target, distance}. */
  Director.frameOrbit = function (orbit, objects) {
    if (!orbit) return null;
    const list = Array.isArray(objects) ? objects.filter(Boolean) : [objects].filter(Boolean);
    if (!list.length) return null;
    const box = new THREE.Box3();
    list.forEach(function (o) { box.union(boxOf(o)); });
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = THREE.MathUtils.degToRad((orbit.camera && orbit.camera.fov) || 38);
    const fit = (maxDim / (2 * Math.tan(fov / 2))) * 1.35;
    if (orbit.dTarget) orbit.dTarget.copy(center);
    if (typeof orbit.dRadius === 'number') orbit.dRadius = Math.max(orbit.minRadius || 1.2, Math.min(orbit.maxRadius || 30, fit));
    return { target: [center.x, center.y, center.z], distance: fit };
  };

  /* 1 click dựng sân khấu: snap đất + xếp layout + frame camera.
     `view` có thể là OrbitCam (Viewport.orbit) hoặc THREE camera. */
  Director.stage = function (objects, view, mode, gap) {
    objects = (objects || []).filter(Boolean);
    if (!objects.length) return null;
    objects.forEach(function (o) { Director.groundSnap(o); });
    const placed = Director.layout(objects, mode || 'row', gap);
    let framed = null;
    if (view) {
      if (view.dTarget || view.focus) {
        framed = Director.frameOrbit(view, objects);
      } else if (view.isCamera) {
        // frame theo bbox chung bằng camera thường
        const box = new THREE.Box3();
        objects.forEach(function (o) { box.union(boxOf(o)); });
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const fov = THREE.MathUtils.degToRad(view.fov || 50);
        const distance = Math.max(0.5, ((size.length() / 2) / Math.tan(fov / 2)) * 1.35);
        const dir = new THREE.Vector3(1, 0.55, 1).normalize();
        const pos = center.clone().addScaledVector(dir, distance);
        view.position.copy(pos);
        if (view.lookAt) view.lookAt(center);
        if (view.updateProjectionMatrix) view.updateProjectionMatrix();
        framed = { position: [pos.x, pos.y, pos.z], target: [center.x, center.y, center.z], distance: distance };
      }
    }
    return { placed: placed, framed: framed, count: objects.length };
  };

  window.PixiStudio.SceneDirector = Director;
})();
