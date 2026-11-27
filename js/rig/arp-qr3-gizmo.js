/* arp-qr3-gizmo.js — Vòng mở rộng 3, PHẦN 4: Viewport gizmos + panel điều khiển
 * cho Quick Rig (Auto Rig Pro Blend).
 *
 * - Tay cầm kéo 3D cho IK target / control trong viewport: dùng
 *   THREE.TransformControls khi có, fallback kéo bằng raycast + pointer
 *   events tự viết khi không có.
 * - Màu phân biệt control kiểu Blender: trái xanh dương, phải đỏ,
 *   giữa xanh lá.
 * - Panel slider xoay X/Y/Z (+ vị trí X/Y/Z cho IK target / pole) cho
 *   từng control; bật/tắt hiển thị từng nhóm control.
 *
 * Quy ước: IIFE, 'use strict', ES5 (var/function). KHÔNG sửa
 * arp-quickrig.js — chỉ gọi API public của nó (QuickRig.current,
 * setFKRotation / setSpineRotation / setHeadRotation / setNeckRotation /
 * moveIKTarget / setPolePosition / stripName).
 * Mọi chỗ dùng TransformControls / Viewport.orbit đều defensive.
 *
 * Expose: window.PixiStudio.ArpQuickRig.Gizmo
 */
(function () {
  'use strict';

  var PS = window.PixiStudio || (window.PixiStudio = {});
  var THREE = window.THREE;

  /* ---------------- màu chuẩn kiểu Blender ---------------- */
  var COLOR_LEFT = 0x3388ff;   /* trái  = xanh dương */
  var COLOR_RIGHT = 0xff3344;  /* phải = đỏ */
  var COLOR_CENTER = 0x33cc66; /* giữa = xanh lá */

  /* Nhóm control hiển thị (toggle từng nhóm) */
  var GROUPS = {
    arms: ['LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'],
    legs: ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'],
    spine: ['Hips', 'Spine', 'Spine1', 'Spine2'],
    head: ['Neck', 'Head'],
    poles: [] /* pole theo limb key, xử lý riêng */
  };
  var GROUP_LABELS = {
    arms: 'Tay (arms)', legs: 'Chân (legs)', spine: 'Thân (spine)',
    head: 'Đầu (head)', poles: 'Pole khuỷu/gối'
  };

  /* IK end theo chi — moveIKTarget chỉ có nghĩa với 4 đầu chi này */
  var LIMB_ENDS = { LeftHand: 'LeftArm', RightHand: 'RightArm', LeftFoot: 'LeftLeg', RightFoot: 'RightLeg' };

  var state = {
    selected: null,        /* dst control đang chọn, hoặc 'pole:<limbKey>' */
    mode: 'translate',     /* 'translate' | 'rotate' | 'scale' */
    gizmo: null,           /* THREE.TransformControls hoặc null */
    gizmoKind: null,       /* 'transform' | 'fallback' | null */
    attached: null,        /* { dst, object, isPole, limb } */
    groupVisible: { arms: true, legs: true, spine: true, head: true, poles: true },
    container: null,       /* container của renderSection (để refresh) */
    drag: null,            /* trạng thái kéo fallback / snapshot khi kéo gizmo */
    listeners: null        /* handler pointer fallback, để gỡ */
  };

  /* ---------------- helpers chung ---------------- */
  function getQR() { return (window.PixiStudio && window.PixiStudio.ArpQuickRig) || null; }
  function getRig() { var QR = getQR(); return QR ? QR.current : null; }
  function bus() { return (window.PixiStudio && window.PixiStudio.bus) || null; }
  function emit(ev, data) { try { var b = bus(); if (b && typeof b.emit === 'function') b.emit(ev, data); } catch (e) {} }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function deg2rad(d) { return d * Math.PI / 180; }
  function rad2deg(r) { return r * 180 / Math.PI; }
  function stripName(name) {
    var QR = getQR();
    if (QR && typeof QR.stripName === 'function') return QR.stripName(name);
    var s = String(name == null ? '' : name);
    s = s.replace(/^(model:{1,2})+/i, '').replace(/^mixamorig:?/i, '').replace(/__proxy$/i, '');
    return s;
  }
  function worldPosOf(o) {
    return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  }
  function getScene() {
    var V = window.PixiStudio && window.PixiStudio.Viewport;
    return (V && V.scene) || null;
  }
  function getCamera() {
    var V = window.PixiStudio && window.PixiStudio.Viewport;
    if (V && V.orbit && V.orbit.camera) return V.orbit.camera;
    return null;
  }
  function getDomElement() {
    try {
      if (typeof document !== 'undefined') {
        var c = document.getElementById('three-canvas');
        if (c) return c;
        if (document.body) return document.body;
        return document;
      }
    } catch (e) {}
    return null;
  }
  /* Quy ước Smart (arp-smart.js): khi đang kéo thì tắt OrbitCam. */
  function setOrbitEnabled(on) {
    try {
      var V = window.PixiStudio && window.PixiStudio.Viewport;
      if (V && V.orbit && typeof V.orbit.enabled !== 'undefined') V.orbit.enabled = !!on;
    } catch (e) {}
  }
  function getOrbitEnabled() {
    var V = window.PixiStudio && window.PixiStudio.Viewport;
    if (V && V.orbit && typeof V.orbit.enabled !== 'undefined') return !!V.orbit.enabled;
    return null;
  }

  /* ---------------- 1. màu phân biệt control ---------------- */
  function colorFor(dst) {
    var s = stripName(dst);
    if (/^Left/i.test(s)) return COLOR_LEFT;
    if (/^Right/i.test(s)) return COLOR_RIGHT;
    return COLOR_CENTER;
  }

  function controlSphereMesh(ctrl) {
    if (!ctrl) return null;
    for (var i = 0; i < ctrl.children.length; i++) {
      var c = ctrl.children[i];
      if (c.isMesh && (c.userData.isControlVisual || /^__arp_ctrl_mesh_/.test(c.name || ''))) return c;
    }
    return null;
  }
  function poleSphereMesh(pole) {
    if (!pole) return null;
    for (var i = 0; i < pole.children.length; i++) {
      var c = pole.children[i];
      if (c.isMesh && (c.userData.isControlVisual || /^__arp_pole_mesh_/.test(c.name || ''))) return c;
    }
    return null;
  }

  /* Đổi màu material của sphere theo màu chuẩn (trái/phải/giữa). */
  function applyControlColors() {
    var cur = getRig();
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    var changed = 0;
    Object.keys(cur.controls || {}).forEach(function (dst) {
      var mesh = controlSphereMesh(cur.controls[dst]);
      if (mesh && mesh.material && mesh.material.color) {
        mesh.material.color.setHex(colorFor(dst));
        changed++;
      }
    });
    highlightSelected();
    return { ok: true, changed: changed };
  }

  /* Control đang chọn nổi bật hơn: sphere to hơn + opacity 1. */
  function highlightSelected() {
    var cur = getRig();
    if (!cur) return;
    Object.keys(cur.controls || {}).forEach(function (dst) {
      var mesh = controlSphereMesh(cur.controls[dst]);
      if (!mesh) return;
      var sel = state.selected === dst;
      try {
        mesh.scale.setScalar(sel ? 1.35 : 1);
        if (mesh.material) mesh.material.opacity = sel ? 1 : 0.85;
      } catch (e) {}
    });
    Object.keys(cur.poles || {}).forEach(function (limb) {
      var mesh = poleSphereMesh(cur.poles[limb]);
      if (!mesh) return;
      var sel = state.selected === 'pole:' + limb;
      try {
        mesh.scale.setScalar(sel ? 1.35 : 1);
        if (mesh.material) mesh.material.opacity = sel ? 1 : 0.85;
      } catch (e) {}
    });
  }

  /* ---------------- nhóm control ---------------- */
  function groupOf(dst) {
    var s = stripName(dst);
    var g;
    for (g in GROUPS) {
      if (GROUPS[g].indexOf(s) >= 0) return g;
    }
    return null;
  }

  function setGroupVisible(group, on) {
    var cur = getRig();
    state.groupVisible[group] = !!on;
    if (!cur) return { ok: false, error: 'Chưa có control rig.', group: group, visible: !!on };
    var n = 0;
    if (group === 'poles') {
      Object.keys(cur.poles || {}).forEach(function (limb) {
        cur.poles[limb].visible = !!on;
        n++;
      });
    } else {
      (GROUPS[group] || []).forEach(function (dst) {
        var c = cur.controls[dst];
        if (c) { c.visible = !!on; n++; }
      });
    }
    return { ok: true, group: group, visible: !!on, changed: n };
  }
  function getGroupVisible(group) {
    if (state.groupVisible[group] === undefined) return true;
    return !!state.groupVisible[group];
  }

  /* ---------------- áp thay đổi control -> xương ---------------- */
  /* Xoay 1 control: đi qua đúng hàm Quick Rig (đồng bộ control + xương). */
  function setControlRotation(dst, euler) {
    var QR = getQR();
    var cur = getRig();
    if (!QR || !cur) return { ok: false, error: 'Chưa có control rig.' };
    dst = stripName(dst);
    if (dst.indexOf('pole:') === 0) return { ok: false, error: 'Pole không xoay — chỉ di chuyển vị trí.' };
    var e = { x: (euler && euler.x) || 0, y: (euler && euler.y) || 0, z: (euler && euler.z) || 0 };
    var r;
    if (dst === 'Spine' || dst === 'Spine1' || dst === 'Spine2') r = QR.setSpineRotation(dst, e);
    else if (dst === 'Head') r = QR.setHeadRotation(e);
    else if (dst === 'Neck') r = QR.setNeckRotation(e);
    else r = QR.setFKRotation(dst, e);
    return r;
  }

  /* Di chuyển 1 control tới vị trí world cho trước, áp lên xương. */
  function setControlPosition(dst, worldPos) {
    var QR = getQR();
    var cur = getRig();
    if (!QR || !cur) return { ok: false, error: 'Chưa có control rig.' };
    var wp = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z);
    if (String(dst).indexOf('pole:') === 0) {
      return QR.setPolePosition(String(dst).slice(5), { x: wp.x, y: wp.y, z: wp.z });
    }
    dst = stripName(dst);
    if (LIMB_ENDS[dst] && cur.limbModes && cur.limbModes[LIMB_ENDS[dst]] === 'IK') {
      return QR.moveIKTarget(dst, { x: wp.x, y: wp.y, z: wp.z });
    }
    /* Control không phải IK end: dịch xương theo delta world (giữ nguyên
       hướng). Khi đang kéo (có snapshot lúc bắt đầu kéo) thì giữ đúng
       offset lúc nắm (grab offset); khi gọi trực tiếp (slider / API)
       thì đặt xương đúng vị trí world yêu cầu — KHÔNG suy delta từ vị
       trí control, vì vị trí control có thể đã cũ sau khi xoay FK
       (xương con di chuyển mà control của nó không tự cập nhật). */
    var bone = cur.bones[dst];
    var ctrl = cur.controls[dst];
    if (!bone || !ctrl) return { ok: false, error: 'Không có control ' + dst };
    cur.target.updateMatrixWorld(true);
    var targetW;
    if (state.drag && state.drag.dst === dst && state.drag.startBoneWorld && state.drag.startControlWorld) {
      var delta = wp.clone().sub(state.drag.startControlWorld);
      targetW = state.drag.startBoneWorld.clone().add(delta);
    } else {
      targetW = wp.clone();
    }
    try {
      if (bone.parent) {
        bone.parent.updateWorldMatrix(true, false);
        bone.position.copy(bone.parent.worldToLocal(targetW.clone()));
      } else {
        bone.position.copy(targetW);
      }
      /* đồng bộ lại vị trí control theo xương (tránh lệch tích lũy) */
      cur.target.updateMatrixWorld(true);
      ctrl.position.copy(ctrl.parent.worldToLocal(worldPosOf(bone)));
      cur.target.updateMatrixWorld(true);
    } catch (e) { return { ok: false, error: 'Không dịch được xương ' + dst + ': ' + (e && e.message) }; }
    return { ok: true, bone: dst, mode: 'translate-bone' };
  }

  /* Áp thay đổi hiện tại của control (sau khi kéo gizmo / slider). */
  function applyControlChange(dst, kind) {
    var cur = getRig();
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    if (String(dst).indexOf('pole:') === 0) {
      var limb = String(dst).slice(5);
      var pole = cur.poles[limb];
      if (!pole) return { ok: false, error: 'Không có pole ' + limb };
      return getQR().setPolePosition(limb, worldPosOf(pole));
    }
    dst = stripName(dst);
    var ctrl = cur.controls[dst];
    if (!ctrl) return { ok: false, error: 'Không có control ' + dst };
    cur.target.updateMatrixWorld(true);
    if (kind === 'rotate') {
      return setControlRotation(dst, { x: ctrl.rotation.x, y: ctrl.rotation.y, z: ctrl.rotation.z });
    }
    if (kind === 'translate') {
      return setControlPosition(dst, worldPosOf(ctrl));
    }
    /* 'scale': không có ý nghĩa với xương — chỉ đổi kích thước hiển thị
       của control, không áp gì xuống skeleton. */
    return { ok: true, bone: dst, mode: 'scale', note: 'Scale chỉ đổi hiển thị control, không scale xương.' };
  }

  /* ---------------- gizmo: snapshot khi bắt đầu kéo ---------------- */
  function beginDragSnapshot(dst, isPole) {
    var cur = getRig();
    if (!cur) return null;
    cur.target.updateMatrixWorld(true);
    var snap = { dst: dst, isPole: !!isPole, startControlWorld: null, startBoneWorld: null };
    try {
      var obj = isPole ? cur.poles[String(dst).slice(5)] : cur.controls[stripName(dst)];
      if (obj) snap.startControlWorld = worldPosOf(obj);
      if (!isPole) {
        var bone = cur.bones[stripName(dst)];
        if (bone) snap.startBoneWorld = worldPosOf(bone);
      }
    } catch (e) {}
    state.drag = snap;
    setOrbitEnabled(false);
    return snap;
  }
  function endDragSnapshot() {
    var snap = state.drag;
    state.drag = null;
    setOrbitEnabled(true);
    return snap;
  }

  /* ---------------- gizmo: TransformControls ---------------- */
  function makeTransformGizmo(control, mode) {
    var camera = getCamera();
    var scene = getScene();
    if (!THREE || typeof THREE.TransformControls !== 'function') return null;
    if (!camera || !scene) return null;
    var domEl = getDomElement();
    var gizmo;
    try {
      gizmo = new THREE.TransformControls(camera, domEl || undefined);
    } catch (e) { return null; }
    try { gizmo.setMode(mode); } catch (e) {}
    try { gizmo.attach(control); } catch (e) { return null; }
    gizmo.addEventListener('dragging-changed', function (ev) {
      if (ev.value) {
        beginDragSnapshot(state.attached ? state.attached.dst : null,
          !!(state.attached && state.attached.isPole));
      } else {
        var snap = endDragSnapshot();
        if (snap && snap.dst) applyControlChange(snap.dst, state.mode === 'rotate' ? 'rotate' : 'translate');
        emit('arpqr3gizmo:drag-end', { dst: snap ? snap.dst : null, mode: state.mode });
      }
    });
    gizmo.addEventListener('objectChange', function () {
      /* Kéo trực tiếp: áp live để tay/chân đi theo ngay. */
      if (state.attached && state.attached.dst) {
        applyControlChange(state.attached.dst, state.mode === 'rotate' ? 'rotate' : 'translate');
      }
    });
    try { scene.add(gizmo); } catch (e) { return null; }
    return gizmo;
  }

  /* ---------------- gizmo: fallback raycast-drag ---------------- */
  var _raycaster = null;
  function getRaycaster() {
    if (!_raycaster && THREE) _raycaster = new THREE.Raycaster();
    return _raycaster;
  }
  function pickables() {
    var cur = getRig();
    var list = [];
    if (!cur) return list;
    Object.keys(cur.controls || {}).forEach(function (dst) {
      var m = controlSphereMesh(cur.controls[dst]);
      if (m) list.push(m);
    });
    Object.keys(cur.poles || {}).forEach(function (limb) {
      var m = poleSphereMesh(cur.poles[limb]);
      if (m) list.push(m);
    });
    return list;
  }
  function resolvePicked(mesh) {
    var o = mesh;
    while (o) {
      if (o.userData && o.userData.isArpControl) return { dst: o.userData.dstBone, isPole: false, object: o };
      if (o.userData && o.userData.isArpPole) return { dst: 'pole:' + o.userData.limb, isPole: true, object: o };
      o = o.parent;
    }
    return null;
  }
  function ndcFromEvent(e, domEl) {
    var rect = { left: 0, top: 0, width: 1, height: 1 };
    try { if (domEl && domEl.getBoundingClientRect) rect = domEl.getBoundingClientRect(); } catch (err) {}
    var w = rect.width || 1, h = rect.height || 1;
    var cx = (e.clientX !== undefined ? e.clientX : 0);
    var cy = (e.clientY !== undefined ? e.clientY : 0);
    return { x: ((cx - rect.left) / w) * 2 - 1, y: -((cy - rect.top) / h) * 2 + 1 };
  }

  /* Bắt đầu kéo fallback cho 1 control (đã biết control + camera). */
  function startFallbackDrag(dst, camera) {
    var cur = getRig();
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    var isPole = String(dst).indexOf('pole:') === 0;
    var obj = isPole ? cur.poles[String(dst).slice(5)] : cur.controls[stripName(dst)];
    if (!obj) return { ok: false, error: 'Không có control ' + dst };
    if (!camera) camera = getCamera();
    if (!camera) return { ok: false, error: 'Không có camera viewport.' };
    cur.target.updateMatrixWorld(true);
    var snap = beginDragSnapshot(dst, isPole);
    snap.camera = camera;
    /* Mặt phẳng kéo: vuông góc hướng nhìn camera, qua vị trí control. */
    var normal = new THREE.Vector3();
    try { camera.getWorldDirection(normal); } catch (e) { normal.set(0, 0, -1); }
    snap.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, snap.startControlWorld);
    snap.object = obj;
    return { ok: true, dst: dst, kind: 'fallback' };
  }
  /* Kéo fallback tới tọa độ NDC (-1..1) trên màn hình. */
  function moveFallbackDrag(ndcX, ndcY, camera) {
    var snap = state.drag;
    if (!snap || !snap.plane || !snap.object) return { ok: false, error: 'Chưa bắt đầu kéo.' };
    camera = camera || snap.camera || getCamera();
    if (!camera) return { ok: false, error: 'Không có camera viewport.' };
    var rc = getRaycaster();
    if (!rc) return { ok: false, error: 'Không có THREE.Raycaster.' };
    try {
      rc.setFromCamera({ x: ndcX, y: ndcY }, camera);
      var hit = new THREE.Vector3();
      var ok = rc.ray.intersectPlane(snap.plane, hit);
      if (!ok) return { ok: false, error: 'Tia kéo không cắt mặt phẳng kéo.' };
      var obj = snap.object;
      obj.position.copy(obj.parent.worldToLocal(hit.clone()));
      var cur = getRig();
      if (cur) cur.target.updateMatrixWorld(true);
      return applyControlChange(snap.dst, state.mode === 'rotate' ? 'rotate' : 'translate');
    } catch (e) {
      return { ok: false, error: 'Kéo fallback lỗi: ' + (e && e.message) };
    }
  }
  function endFallbackDrag() {
    var snap = endDragSnapshot();
    if (!snap) return { ok: false, error: 'Không đang kéo.' };
    var r = { ok: true, dst: snap.dst };
    if (snap.dst) {
      var ap = applyControlChange(snap.dst, state.mode === 'rotate' ? 'rotate' : 'translate');
      r.applied = ap;
    }
    emit('arpqr3gizmo:drag-end', { dst: snap.dst, mode: state.mode });
    return r;
  }

  function attachFallbackListeners() {
    var domEl = getDomElement();
    if (!domEl || !domEl.addEventListener) return false;
    var down = function (e) {
      var camera = getCamera();
      if (!camera || state.gizmoKind !== 'fallback') return;
      var ndc = ndcFromEvent(e, domEl);
      var rc = getRaycaster();
      if (!rc) return;
      try {
        rc.setFromCamera(ndc, camera);
        var hits = rc.intersectObjects(pickables(), false);
        if (!hits.length) return;
        var picked = resolvePicked(hits[0].object);
        if (!picked) return;
        if (e.preventDefault) e.preventDefault();
        selectControl(picked.dst, true);
        startFallbackDrag(picked.dst, camera);
      } catch (err) {}
    };
    var move = function (e) {
      if (!state.drag || state.gizmoKind !== 'fallback') return;
      var ndc = ndcFromEvent(e, domEl);
      moveFallbackDrag(ndc.x, ndc.y, null);
    };
    var up = function () {
      if (state.drag && state.gizmoKind !== 'transform') endFallbackDrag();
    };
    try {
      domEl.addEventListener('pointerdown', down);
      domEl.addEventListener('pointermove', move);
      domEl.addEventListener('pointerup', up);
      state.listeners = { domEl: domEl, down: down, move: move, up: up };
      return true;
    } catch (e) { return false; }
  }
  function removeFallbackListeners() {
    var L = state.listeners;
    if (!L) return;
    try {
      L.domEl.removeEventListener('pointerdown', L.down);
      L.domEl.removeEventListener('pointermove', L.move);
      L.domEl.removeEventListener('pointerup', L.up);
    } catch (e) {}
    state.listeners = null;
  }

  /* ---------------- attach / detach / select ---------------- */
  function resolveControl(input) {
    var cur = getRig();
    if (!cur) return null;
    if (input && typeof input === 'object' && (input.isObject3D || input.userData)) {
      if (input.userData.isArpPole) return { dst: 'pole:' + input.userData.limb, isPole: true, object: input };
      if (input.userData.isArpControl) return { dst: input.userData.dstBone, isPole: false, object: input };
      return null;
    }
    var s = String(input == null ? '' : input);
    if (s.indexOf('pole:') === 0) {
      var limb = s.slice(5);
      if (cur.poles[limb]) return { dst: s, isPole: true, object: cur.poles[limb], limb: limb };
      return null;
    }
    var dst = stripName(s);
    if (cur.controls[dst]) return { dst: dst, isPole: false, object: cur.controls[dst] };
    return null;
  }

  function attachGizmo(control, mode) {
    if (mode) {
      if (['translate', 'rotate', 'scale'].indexOf(mode) < 0) {
        return { ok: false, error: 'Mode gizmo phải là translate/rotate/scale, nhận: ' + mode };
      }
      state.mode = mode;
    }
    var target = resolveControl(control);
    if (!target) return { ok: false, error: 'Không tìm thấy control để gắn gizmo.' };
    detachGizmo(true);
    state.selected = target.dst;
    var gizmo = makeTransformGizmo(target.object, state.mode);
    if (gizmo) {
      state.gizmo = gizmo;
      state.gizmoKind = 'transform';
      state.attached = target;
      highlightSelected();
      return { ok: true, kind: 'transform', mode: state.mode, dst: target.dst };
    }
    /* Fallback: không có TransformControls / không có scene+camera —
       kéo bằng raycast + pointer events tự viết. */
    state.gizmoKind = 'fallback';
    state.attached = target;
    attachFallbackListeners();
    highlightSelected();
    return { ok: true, kind: 'fallback', mode: state.mode, dst: target.dst, note: 'Không có THREE.TransformControls hoặc scene/camera — dùng kéo raycast.' };
  }

  function detachGizmo(keepSelected) {
    if (state.gizmo) {
      try {
        if (typeof state.gizmo.detach === 'function') state.gizmo.detach();
        var scene = getScene();
        if (scene) scene.remove(state.gizmo);
        if (typeof state.gizmo.dispose === 'function') state.gizmo.dispose();
      } catch (e) {}
      state.gizmo = null;
    }
    removeFallbackListeners();
    if (state.drag) endDragSnapshot();
    state.gizmoKind = null;
    state.attached = null;
    if (!keepSelected) {
      state.selected = null;
      highlightSelected();
    }
    return { ok: true };
  }

  /* Chọn control để gắn gizmo (click trong list hoặc bấm lên mesh). */
  function selectControl(dst, skipRerender) {
    var target = resolveControl(dst);
    if (!target) return { ok: false, error: 'Không có control ' + dst };
    var prev = state.selected;
    state.selected = target.dst;
    if (state.gizmoKind) attachGizmo(target.object, state.mode);
    highlightSelected();
    emit('arpqr3gizmo:select', { dst: target.dst, prev: prev });
    if (!skipRerender && state.container) renderSection(state.container);
    return { ok: true, dst: target.dst, prev: prev, gizmoKind: state.gizmoKind };
  }
  function getSelected() { return state.selected; }

  function setMode(mode) {
    if (['translate', 'rotate', 'scale'].indexOf(mode) < 0) {
      return { ok: false, error: 'Mode gizmo phải là translate/rotate/scale.' };
    }
    state.mode = mode;
    if (state.gizmo) {
      try { state.gizmo.setMode(mode); } catch (e) {}
    }
    if (state.container) renderSection(state.container);
    return { ok: true, mode: mode };
  }
  function getMode() { return state.mode; }

  /* ---------------- UI: slider + section ---------------- */
  function el(tag, attrs, children) {
    var node;
    try { node = document.createElement(tag); } catch (e) { return null; }
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null) return;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (sk) { node.style[sk] = v[sk]; });
        } else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2), v);
        } else node.setAttribute(k, v);
      });
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  /* Helper slider — cùng kiểu dùng trong arp-quickrig.js (viết lại gọn). */
  function mkSlider(label, min, max, step, val, oninput, extra) {
    var row = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0' } });
    row.appendChild(el('span', { text: label, style: { width: '110px', fontSize: '12px' } }));
    var inp = el('input', {
      type: 'range', min: String(min), max: String(max), step: String(step),
      value: String(val), style: { flex: '1' }
    });
    if (extra && extra.dataSlider) inp.setAttribute('data-slider', extra.dataSlider);
    var valEl = el('span', { text: String(val), style: { width: '52px', fontSize: '12px', textAlign: 'right' } });
    inp.addEventListener('input', function () {
      valEl.textContent = inp.value;
      oninput(parseFloat(inp.value));
    });
    row.appendChild(inp);
    row.appendChild(valEl);
    return row;
  }

  function isIkEnd(dst) {
    var cur = getRig();
    return !!(cur && LIMB_ENDS[dst] && cur.limbModes && cur.limbModes[LIMB_ENDS[dst]] === 'IK');
  }

  function renderSection(container) {
    if (!container) return { ok: false, error: 'Không có container.' };
    state.container = container;
    try { container.innerHTML = ''; } catch (e) {}
    var wrap = el('div', { style: { margin: '8px 0' } });
    wrap.appendChild(el('div', { html: '<b>Viewport gizmos + Điều khiển</b> — bấm control để gắn tay cầm kéo 3D (TransformControls, fallback raycast khi thiếu).', style: { marginBottom: '6px' } }));
    var cur = getRig();
    if (!cur) {
      wrap.appendChild(el('div', { text: 'Chưa có control rig — chạy Auto Gen / Convert trong tab Quick Rig trước, rồi quay lại đây.', style: { color: '#a33' } }));
      container.appendChild(wrap);
      return { ok: true, hasRig: false };
    }
    var nCtrl = Object.keys(cur.controls || {}).length;
    wrap.appendChild(el('div', { text: 'Rig: ' + nCtrl + ' control, ' + Object.keys(cur.poles || {}).length + ' pole — đang chọn: ' + (state.selected || 'chưa chọn'), style: { fontSize: '12px', marginBottom: '6px' } }));

    /* --- nút chọn mode gizmo --- */
    var modeRow = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '6px 0' } });
    [['translate', 'Di chuyển'], ['rotate', 'Xoay'], ['scale', 'Tỉ lệ']].forEach(function (m) {
      var b = el('button', {
        class: 'btn sm', text: m[1],
        style: state.mode === m[0] ? { background: '#2b6cb0', color: '#fff' } : {},
        onclick: function () { setMode(m[0]); if (state.selected) attachGizmo(state.selected, m[0]); }
      });
      modeRow.appendChild(b);
    });
    modeRow.appendChild(el('button', {
      class: 'btn sm', text: 'Gỡ gizmo',
      onclick: function () { detachGizmo(); if (state.container) renderSection(state.container); }
    }));
    wrap.appendChild(modeRow);

    /* --- danh sách control theo nhóm --- */
    ['arms', 'legs', 'spine', 'head'].forEach(function (g) {
      var list = (GROUPS[g] || []).filter(function (dst) { return !!cur.controls[dst]; });
      if (!list.length) return;
      var box = el('div', { style: { margin: '4px 0' } });
      box.appendChild(el('span', { text: GROUP_LABELS[g] + ': ', style: { fontSize: '12px', fontWeight: 'bold' } }));
      list.forEach(function (dst) {
        var hex = '#' + ('000000' + colorFor(dst).toString(16)).slice(-6);
        var b = el('button', {
          class: 'btn sm', text: dst,
          style: {
            borderLeft: '4px solid ' + hex,
            background: state.selected === dst ? '#2b6cb0' : '',
            color: state.selected === dst ? '#fff' : ''
          },
          onclick: function () { selectControl(dst); }
        });
        box.appendChild(b);
      });
      wrap.appendChild(box);
    });
    /* pole */
    var poleKeys = Object.keys(cur.poles || {});
    if (poleKeys.length) {
      var pbox = el('div', { style: { margin: '4px 0' } });
      pbox.appendChild(el('span', { text: GROUP_LABELS.poles + ': ', style: { fontSize: '12px', fontWeight: 'bold' } }));
      poleKeys.forEach(function (limb) {
        var b = el('button', {
          class: 'btn sm', text: 'Pole ' + limb,
          style: {
            background: state.selected === 'pole:' + limb ? '#2b6cb0' : '',
            color: state.selected === 'pole:' + limb ? '#fff' : ''
          },
          onclick: function () { selectControl('pole:' + limb); }
        });
        pbox.appendChild(b);
      });
      wrap.appendChild(pbox);
    }

    /* --- slider panel cho control đang chọn --- */
    if (state.selected) {
      var selBox = el('div', { style: { margin: '8px 0', padding: '6px', border: '1px solid #888', borderRadius: '4px' } });
      selBox.appendChild(el('div', { html: '<b>' + state.selected + '</b> — slider điều khiển', style: { marginBottom: '4px' } }));
      var isPoleSel = state.selected.indexOf('pole:') === 0;
      var selDst = isPoleSel ? null : stripName(state.selected);
      var selCtrl = isPoleSel ? cur.poles[state.selected.slice(5)] : cur.controls[selDst];
      if (selCtrl) {
        if (!isPoleSel) {
          /* Xoay X/Y/Z — slider theo độ, đổi ra radian khi áp. */
          ['x', 'y', 'z'].forEach(function (axis) {
            var curDeg = Math.round(rad2deg(selCtrl.rotation[axis] || 0));
            selBox.appendChild(mkSlider('Xoay ' + axis.toUpperCase() + ' (°)', -180, 180, 1, curDeg, function (v) {
              var e = { x: selCtrl.rotation.x, y: selCtrl.rotation.y, z: selCtrl.rotation.z };
              e[axis] = deg2rad(v);
              setControlRotation(selDst, e);
            }, { dataSlider: 'rot-' + axis }));
          });
        }
        /* Vị trí X/Y/Z — chỉ cho IK target (đầu chi đang ở mode IK) và pole. */
        if (isPoleSel || isIkEnd(selDst)) {
          cur.target.updateMatrixWorld(true);
          var wp = worldPosOf(selCtrl);
          var range = Math.max(1, (cur.height || 1.8));
          var posInputs = {};
          ['x', 'y', 'z'].forEach(function (axis) {
            var row = mkSlider('Vị trí ' + axis.toUpperCase() + ' (m)', -range, range, 0.01,
              Math.round(wp[axis] * 100) / 100, function (v) {
                var p = { x: parseFloat(posInputs.x.value), y: parseFloat(posInputs.y.value), z: parseFloat(posInputs.z.value) };
                p[axis] = v;
                setControlPosition(state.selected, p);
              }, { dataSlider: 'pos-' + axis });
            var inp = row.querySelector('input');
            if (inp) posInputs[axis] = inp;
            selBox.appendChild(row);
          });
        } else if (!isPoleSel) {
          selBox.appendChild(el('div', { text: 'Control này không phải IK target — kéo gizmo ở mode Di chuyển để dịch xương trực tiếp, hoặc xoay bằng slider trên.', style: { fontSize: '12px', color: '#666' } }));
        }
      }
      wrap.appendChild(selBox);
    }

    /* --- toggle hiển thị từng nhóm --- */
    var togBox = el('div', { style: { margin: '8px 0' } });
    togBox.appendChild(el('div', { html: '<b>Hiện control theo nhóm</b>', style: { marginBottom: '4px' } }));
    Object.keys(GROUPS).forEach(function (g) {
      var lab = el('label', { style: { marginRight: '12px', fontSize: '13px' } });
      var cb = el('input', { type: 'checkbox' });
      cb.checked = getGroupVisible(g);
      cb.addEventListener('change', function () { setGroupVisible(g, cb.checked); });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + GROUP_LABELS[g]));
      togBox.appendChild(lab);
    });
    wrap.appendChild(togBox);

    /* --- áp màu chuẩn --- */
    var actRow = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '6px 0' } });
    actRow.appendChild(el('button', {
      class: 'btn sm', text: 'Áp màu chuẩn (Blender)',
      onclick: function () {
        var r = applyControlColors();
        if (state.container) renderSection(state.container);
        emit('arpqr3gizmo:colors', r);
      }
    }));
    actRow.appendChild(el('button', {
      class: 'btn sm', text: 'Hiện tất cả nhóm',
      onclick: function () {
        Object.keys(GROUPS).forEach(function (g) { setGroupVisible(g, true); });
        if (state.container) renderSection(state.container);
      }
    }));
    wrap.appendChild(actRow);
    wrap.appendChild(el('div', {
      text: 'Màu: trái xanh dương · phải đỏ · giữa xanh lá. Gizmo theo control đang chọn.',
      style: { fontSize: '12px', color: '#666' }
    }));
    container.appendChild(wrap);
    return { ok: true, hasRig: true, controls: nCtrl, selected: state.selected };
  }

  /* ---------------- expose ---------------- */
  var Gizmo = {
    COLORS: { left: COLOR_LEFT, right: COLOR_RIGHT, center: COLOR_CENTER },
    GROUPS: GROUPS,
    colorFor: colorFor,
    groupOf: groupOf,
    applyControlColors: applyControlColors,
    attachGizmo: attachGizmo,
    detachGizmo: detachGizmo,
    selectControl: selectControl,
    getSelected: getSelected,
    setMode: setMode,
    getMode: getMode,
    setGroupVisible: setGroupVisible,
    getGroupVisible: getGroupVisible,
    setControlRotation: setControlRotation,
    setControlPosition: setControlPosition,
    applyControlChange: applyControlChange,
    renderSection: renderSection,
    getState: function () {
      return { selected: state.selected, mode: state.mode, gizmoKind: state.gizmoKind,
        attached: state.attached ? state.attached.dst : null,
        groupVisible: JSON.parse(JSON.stringify(state.groupVisible)) };
    },
    _test: {
      colorFor: colorFor,
      groupOf: groupOf,
      startFallbackDrag: startFallbackDrag,
      moveFallbackDrag: moveFallbackDrag,
      endFallbackDrag: endFallbackDrag,
      getRaycaster: getRaycaster,
      pickables: pickables,
      resolvePicked: resolvePicked,
      beginDragSnapshot: beginDragSnapshot,
      endDragSnapshot: endDragSnapshot,
      getOrbitEnabled: getOrbitEnabled,
      controlSphereMesh: controlSphereMesh,
      poleSphereMesh: poleSphereMesh,
      state: state
    }
  };

  if (!PS.ArpQuickRig) PS.ArpQuickRig = {};
  PS.ArpQuickRig.Gizmo = Gizmo;

  /* Hook đăng ký section vào tab Quick Rig — coordinator thêm sau;
     module vẫn chạy được khi chưa có hook. */
  try {
    var QR = getQR();
    if (QR && typeof QR.registerSection === 'function') QR.registerSection('gizmo', renderSection);
  } catch (e) {}
})();
