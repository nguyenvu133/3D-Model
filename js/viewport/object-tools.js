/* ============================================================
 * viewport/object-tools.js — Object Tools: xoay theo góc số +
 * mọi thao tác object trong viewport (nhân bản, xoá, ẩn/hiện,
 * khoá, focus, đặt xuống đất, snap lưới, copy/paste transform,
 * đổi tên, lật/mirror, scale đều, đặt pivot).
 *
 * Mọi thao tác đổi transform đều: guard khoá → đổi → updateMatrixWorld
 * → emit 'transform:changed' → History.push() SAU khi đổi (state-stack
 * v2 của js/core/history.js — push chụp state SAU thao tác).
 * Xoay: góc tính bằng ĐỘ ở mọi API/UI (radian chỉ tồn tại bên trong
 * THREE.Euler). Snap góc làm tròn góc ĐÍCH về bội số snap.
 * Pivot 'feet'/'origin' quay bằng quaternion thế giới quanh điểm pivot
 * (giả định parent là modelRoot/scene — rotation identity; đúng với
 * mọi model/primitive của studio).
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const OT = {
    _clipboard: null   /* { p:[x,y,z], r:[x,y,z] (rad), s:[x,y,z] } */
  };

  OT.sel = function () { return PixiStudio.State.get('selection'); };

  /* ---------- khoá ---------- */
  OT.isLocked = function (obj) {
    obj = obj || OT.sel();
    if (!obj) return false;
    let reg = null;
    try {
      if (PixiStudio.Scene && typeof PixiStudio.Scene._findReg === 'function') reg = PixiStudio.Scene._findReg(obj.uuid);
    } catch (e) { reg = null; }
    if (!reg && PixiStudio.Scene && PixiStudio.Scene.registry) reg = PixiStudio.Scene.registry[obj.uuid];
    return !!(reg && reg.locked);
  };

  OT._guard = function (obj, action) {
    if (!obj) {
      bus.emit('notify', { type: 'warning', title: 'Object', message: 'Chưa chọn object nào.' });
      return false;
    }
    if (OT.isLocked(obj)) {
      bus.emit('notify', { type: 'warning', title: 'Object đang khoá', message: (obj.name || 'Object') + ' đang khoá — mở khoá trước khi ' + (action || 'chỉnh sửa') + '.' });
      return false;
    }
    return true;
  };

  /* Commit chuẩn sau mọi lần đổi transform. */
  OT._commit = function (obj, label, source) {
    obj.updateMatrixWorld(true);
    bus.emit('transform:changed', { id: obj.uuid, source: source || 'object-tools' });
    if (PixiStudio.History) PixiStudio.History.push(label);
    if (PixiStudio.Interaction && PixiStudio.Interaction.refreshOutline) PixiStudio.Interaction.refreshOutline();
  };

  /* ---------- gizmo mode / space / snap / pivot ---------- */
  OT.setGizmoMode = function (mode) {
    if (PixiStudio.Shortcuts && PixiStudio.Shortcuts.setGizmoMode) {
      PixiStudio.Shortcuts.setGizmoMode(mode);
    } else {
      PixiStudio.State.set('gizmoMode', mode);
      if (PixiStudio.Gizmo) PixiStudio.Gizmo.setMode(mode);
    }
    return PixiStudio.State.get('gizmoMode');
  };

  OT.getSpace = function () { return PixiStudio.State.get('gizmoSpace') || 'local'; };
  OT.setSpace = function (space) {
    space = space === 'world' ? 'world' : 'local';
    PixiStudio.State.set('gizmoSpace', space);
    if (PixiStudio.Gizmo && PixiStudio.Gizmo.setSpace) PixiStudio.Gizmo.setSpace(space);
    return space;
  };

  OT.getSnapAngle = function () { return PixiStudio.State.get('rotateSnap') || 0; };
  OT.setSnapAngle = function (deg) {
    deg = deg | 0;
    if ([0, 15, 45, 90].indexOf(deg) < 0) deg = 0;
    PixiStudio.State.set('rotateSnap', deg);
    if (PixiStudio.Gizmo && PixiStudio.Gizmo.setRotationSnap) PixiStudio.Gizmo.setRotationSnap(deg);
    return deg;
  };

  OT.getPivot = function () { return PixiStudio.State.get('rotatePivot') || 'object'; };
  OT.setPivot = function (pivot) {
    if (['object', 'feet', 'origin'].indexOf(pivot) < 0) pivot = 'object';
    PixiStudio.State.set('rotatePivot', pivot);
    return pivot;
  };

  /* Điểm pivot (toạ độ thế giới) theo chế độ đã chọn. */
  OT.pivotPoint = function (obj, pivot) {
    obj = obj || OT.sel();
    pivot = pivot || OT.getPivot();
    if (!obj) return new THREE.Vector3(0, 0, 0);
    if (pivot === 'origin') return new THREE.Vector3(0, 0, 0);
    if (pivot === 'feet') {
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      if (!box.isEmpty()) {
        const c = box.getCenter(new THREE.Vector3());
        return new THREE.Vector3(c.x, box.min.y, c.z);
      }
    }
    return new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
  };

  /* ---------- xoay ---------- */
  /* Xoay thêm `deg` độ quanh 1 trục. Pivot 'object' + Local: cộng trực
   * tiếp vào euler (số Inspector khớp). Pivot feet/origin hoặc World:
   * quay quaternion thế giới quanh điểm pivot. Snap làm tròn góc đích. */
  OT.rotateBy = function (obj, axis, deg, opts) {
    obj = obj || OT.sel();
    if (!OT._guard(obj, 'xoay')) return false;
    opts = opts || {};
    const snap = opts.snap === undefined ? OT.getSnapAngle() : opts.snap;
    const pivot = opts.pivot || OT.getPivot();
    const space = opts.space || OT.getSpace();
    let d = deg;
    if (pivot === 'object' && space === 'local') {
      const cur = THREE.MathUtils.radToDeg(obj.rotation[axis]);
      let next = cur + d;
      if (snap > 0) next = Math.round(next / snap) * snap;
      obj.rotation[axis] = THREE.MathUtils.degToRad(next);
      OT._commit(obj, 'Xoay ' + axis.toUpperCase() + ' ' + (next - cur >= 0 ? '+' : '') + U.round(next - cur, 1) + '°');
      return true;
    }
    if (snap > 0) d = Math.round(d / snap) * snap;
    if (!d) return true;
    const deltaQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      axis === 'x' ? THREE.MathUtils.degToRad(d) : 0,
      axis === 'y' ? THREE.MathUtils.degToRad(d) : 0,
      axis === 'z' ? THREE.MathUtils.degToRad(d) : 0));
    const P = OT.pivotPoint(obj, pivot);
    obj.position.copy(obj.position.clone().sub(P).applyQuaternion(deltaQ).add(P));
    obj.quaternion.premultiply(deltaQ);
    OT._commit(obj, 'Xoay ' + axis.toUpperCase() + ' ' + (d >= 0 ? '+' : '') + d + '° (' + pivot + ')');
    return true;
  };

  /* Đặt góc tuyệt đối (độ) cho 1 trục. */
  OT.setRotationDeg = function (obj, axis, deg, opts) {
    obj = obj || OT.sel();
    if (!OT._guard(obj, 'xoay')) return false;
    opts = opts || {};
    const snap = opts.snap === undefined ? OT.getSnapAngle() : opts.snap;
    const pivot = opts.pivot || OT.getPivot();
    let target = deg;
    if (snap > 0) target = Math.round(target / snap) * snap;
    if (pivot === 'object') {
      obj.rotation[axis] = THREE.MathUtils.degToRad(target);
    } else {
      const e = obj.rotation.clone();
      e[axis] = THREE.MathUtils.degToRad(target);
      const qT = new THREE.Quaternion().setFromEuler(e);
      const deltaQ = qT.clone().multiply(obj.quaternion.clone().invert());
      const P = OT.pivotPoint(obj, pivot);
      obj.position.copy(obj.position.clone().sub(P).applyQuaternion(deltaQ).add(P));
      obj.quaternion.copy(qT);
    }
    OT._commit(obj, 'Đặt xoay ' + axis.toUpperCase() + ' = ' + target + '°');
    return true;
  };

  OT.getRotationDeg = function (obj, axis) {
    obj = obj || OT.sel();
    if (!obj) return 0;
    return THREE.MathUtils.radToDeg(obj.rotation[axis]);
  };

  OT.resetRotation = function (obj) {
    obj = obj || OT.sel();
    if (!OT._guard(obj, 'reset rotation')) return false;
    obj.rotation.set(0, 0, 0);
    OT._commit(obj, 'Reset rotation');
    return true;
  };

  OT.resetTransform = function (obj) {
    obj = obj || OT.sel();
    if (!OT._guard(obj, 'reset transform')) return false;
    obj.position.set(0, obj.position.y, 0);
    obj.rotation.set(0, 0, 0);
    obj.scale.set(1, 1, 1);
    OT._commit(obj, 'Reset transform');
    return true;
  };

  /* ---------- object actions ---------- */
  OT.duplicate = function (obj) {
    obj = obj || OT.sel();
    if (!obj) { bus.emit('notify', { type: 'warning', title: 'Duplicate', message: 'Chưa chọn object.' }); return null; }
    if (!PixiStudio.Scene || !PixiStudio.Scene.duplicate) return null;
    const clone = PixiStudio.Scene.duplicate(obj);
    if (!clone) return null;
    /* Scene.duplicate gắn clone vào Viewport.scene — đưa về modelRoot
       khi bản gốc ở đó để picking/getMainModel/export thấy bản sao. */
    try {
      if (obj.parent === PixiStudio.Viewport.modelRoot && clone.parent !== PixiStudio.Viewport.modelRoot) {
        PixiStudio.Viewport.modelRoot.add(clone);
      }
    } catch (e) { /* giữ nguyên vị trí clone */ }
    return clone;
  };

  OT.deleteObj = function (obj) {
    obj = obj || OT.sel();
    if (!OT._guard(obj, 'xoá')) return false;
    if (PixiStudio.Scene && PixiStudio.Scene.deleteObject) PixiStudio.Scene.deleteObject(obj);
    if (PixiStudio.Interaction) PixiStudio.Interaction.refreshOutline();
    return true;
  };

  OT.toggleVisible = function (obj) {
    obj = obj || OT.sel();
    if (!obj) { bus.emit('notify', { type: 'warning', title: 'Object', message: 'Chưa chọn object nào.' }); return false; }
    if (PixiStudio.Scene && PixiStudio.Scene.toggleVisible) PixiStudio.Scene.toggleVisible(obj);
    else {
      obj.visible = !obj.visible;
      if (PixiStudio.History) PixiStudio.History.push((obj.visible ? 'Show ' : 'Hide ') + (obj.name || 'object'));
    }
    bus.emit('transform:changed', { id: obj.uuid, source: 'object-tools' });
    return obj.visible;
  };

  OT.setLocked = function (obj, locked) {
    obj = obj || OT.sel();
    if (!obj) return false;
    if (OT.isLocked(obj) === !!locked) return !!locked;
    if (PixiStudio.Scene && PixiStudio.Scene.toggleLock) PixiStudio.Scene.toggleLock(obj);
    /* Khoá → tháo gizmo ngay (không cho kéo/xoay); mở khoá → gắn lại
       theo mode hiện tại. */
    if (PixiStudio.Gizmo) {
      if (locked) PixiStudio.Gizmo.attach(null);
      else if (PixiStudio.State.get('selection') === obj && PixiStudio.State.get('gizmoMode') !== 'select') PixiStudio.Gizmo.attach(obj);
    }
    bus.emit('notify', { type: 'info', title: locked ? 'Đã khoá' : 'Đã mở khoá', message: obj.name || 'Object' });
    return !!locked;
  };

  OT.focus = function (obj) {
    if (obj && obj !== OT.sel()) PixiStudio.State.select(obj);
    if (PixiStudio.Viewport) PixiStudio.Viewport.focusSelected();
    return true;
  };

  OT.alignToGround = function (obj) {
    obj = obj || OT.sel();
    if (!OT._guard(obj, 'đặt xuống đất')) return false;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return false;
    obj.position.y -= box.min.y;
    OT._commit(obj, 'Align to ground');
    bus.emit('notify', { type: 'success', title: 'Align to ground', message: (obj.name || 'Object') + ' đã chạm đất' });
    return true;
  };

  OT.snapToGrid = function (obj, size) {
    obj = obj || OT.sel();
    if (!OT._guard(obj, 'snap lưới')) return false;
    size = size || (PixiStudio.Interaction && PixiStudio.Interaction.snapSize) || 0.25;
    obj.position.set(
      Math.round(obj.position.x / size) * size,
      Math.round(obj.position.y / size) * size,
      Math.round(obj.position.z / size) * size);
    OT._commit(obj, 'Snap to grid ' + size);
    return true;
  };

  OT.copyTransform = function (obj) {
    obj = obj || OT.sel();
    if (!obj) { bus.emit('notify', { type: 'warning', title: 'Copy transform', message: 'Chưa chọn object nào.' }); return false; }
    OT._clipboard = {
      p: [obj.position.x, obj.position.y, obj.position.z],
      r: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      s: [obj.scale.x, obj.scale.y, obj.scale.z]
    };
    bus.emit('notify', { type: 'success', title: 'Copy transform', message: 'Đã copy transform của ' + (obj.name || 'Object') });
    return true;
  };

  OT.pasteTransform = function (obj) {
    obj = obj || OT.sel();
    if (!OT._guard(obj, 'paste transform')) return false;
    if (!OT._clipboard) { bus.emit('notify', { type: 'warning', title: 'Paste transform', message: 'Chưa copy transform nào.' }); return false; }
    const c = OT._clipboard;
    obj.position.set(c.p[0], c.p[1], c.p[2]);
    obj.rotation.set(c.r[0], c.r[1], c.r[2]);
    obj.scale.set(c.s[0], c.s[1], c.s[2]);
    OT._commit(obj, 'Paste transform');
    return true;
  };

  OT.rename = function (obj, newName) {
    obj = obj || OT.sel();
    if (!obj || !newName || !String(newName).trim()) return false;
    if (PixiStudio.Scene && PixiStudio.Scene.rename) PixiStudio.Scene.rename(obj, String(newName).trim());
    else {
      obj.name = String(newName).trim();
      if (PixiStudio.History) PixiStudio.History.push('Rename ' + obj.name);
    }
    bus.emit('transform:changed', { id: obj.uuid, source: 'object-tools' });
    return true;
  };

  /* Lật/mirror quanh 1 trục (đảo dấu scale). Lưu ý: scale âm đảo mặt
   * winding — model 1 mặt có thể hiện mặt trong; dùng khi cần mirror. */
  OT.flip = function (obj, axis) {
    obj = obj || OT.sel();
    axis = axis || 'x';
    if (!OT._guard(obj, 'lật')) return false;
    obj.scale[axis] = -obj.scale[axis] || -1;
    if (obj.scale[axis] === 0) obj.scale[axis] = -1;
    OT._commit(obj, 'Flip ' + axis.toUpperCase());
    return true;
  };

  OT.setUniformScale = function (obj, v) {
    obj = obj || OT.sel();
    if (!OT._guard(obj, 'scale')) return false;
    v = Math.max(0.001, parseFloat(v) || 1);
    obj.scale.set(v, v, v);
    OT._commit(obj, 'Scale đều ' + v);
    return true;
  };

  window.PixiStudio.ObjectTools = OT;
})();
