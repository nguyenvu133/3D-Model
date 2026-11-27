/* ============================================================
 * rig/arp-boneshape.js — BONE SHAPE EDITOR (Auto Rig Pro Blend, PHẦN C)
 * MỞ RỘNG TỐI ĐA (vòng ARP View, 2026-11-27):
 *
 * Hiển thị xương bằng bone mesh RIÊNG (không sửa SkeletonHelper gốc):
 * mỗi xương có một mesh hình kéo dài theo đoạn xương (từ bone tới
 * bone con), đặt trong group `__arp_boneshape__` gắn vào model/scene.
 * Bật/tắt hiển thị được.
 *
 * API CŨ (giữ nguyên, harness cũ 38 checks vẫn PASS):
 *   setShape(boneName, {length, thickness, style}) — length/thickness
 *     là hệ số (mặc định 1), style 'octahedron' | 'box' | 'sphere'.
 *   Mirror (mặc định BẬT): setShape cho xương Left thì tự áp cùng
 *     shape sang xương Right tương ứng, và ngược lại.
 *   Reset: trả mọi xương về shape mặc định.
 *
 * MỞ RỘNG:
 *  (1) Từng xương: 6 loại hình (octahedron/box/sphere/cylinder/cone/
 *      diamond), dài/rộng/dày riêng, màu riêng từng xương/nhóm, độ
 *      trong suốt. Bấm chọn xương trong viewport (event
 *      'arpvpselect:select' từ arp-vp-select.js) → panel nhảy tới
 *      đúng xương đó (selectBone + _uiJump).
 *  (2) Preset phong cách: mixamo / blender / stick / chibi /
 *      realistic — áp 1 lần cho cả rig; preset riêng của user lưu
 *      localStorage + xuất/nhập JSON.
 *  (3) Thư viện hình xương: lưu/tải theo từng xương hoặc cả rig,
 *      đặt tên, xóa, áp lại (localStorage).
 *  (4) Mirror mở rộng: mirror theo nhóm, kiểm tra đối xứng
 *      (checkSymmetry), copy hình L↔R (copyShape).
 *  (5) Khớp (joint): hình khớp riêng (sphere/box/octahedron),
 *      cỡ khớp, màu khớp theo nhóm/xương.
 *  (6) Hàng loạt: áp hình cho cả nhóm (tay/chân/cột sống/ngón...),
 *      reset 1 xương / 1 nhóm / toàn bộ, copy hình giữa các xương.
 *  (7) Đồng bộ viewport: getShapeForBone(boneName) trả spec đầy đủ
 *      + event 'boneshape:changed' khi đổi hình; module VP skeleton
 *      (arp-vp-skeleton.js) đọc API này khi tạo hình xương thay vì
 *      tự vẽ cylinder/khớp cầu riêng (fallback về mặc định VP khi
 *      Bone Shape chưa load/chưa custom).
 *  (8) Xuất/lưu: cấu hình hình xương ra JSON (tải xuống + nhập lại).
 *      FBX: KHÔNG xuất kèm được — FBXBinary.write (js/exporter/
 *      fbx-binary.js, collect()) bỏ qua MỌI mesh có
 *      userData.isBoneVisual, và arp-export.js cũng bỏ qua chúng;
 *      đó là hành vi CỐ Ý để file FBX rig không chứa 41+ mesh rác.
 *      Không có writer nào hỗ trợ nhúng "bone shape" vào FBX nên
 *      JSON sidecar là cách duy nhất (ghi rõ, không bịa).
 *  (9) Giao diện: tìm kiếm/lọc xương theo tên/nhóm, xem trước hình
 *      đang chọn (canvas 2D), slider nhanh, hoàn tác. Undo RIÊNG
 *      (stack snapshot shape, tối đa 25 bước) — KHÔNG dùng chung
 *      QR3 History (arp-qr3-history.js): History đó snapshot
 *      ROTATION của xương trong control rig (cần ArpQuickRig.current,
 *      restorePose đặt lại rotation xương → sẽ phá pose), không
 *      snapshot được shape/màu/joint. Dùng chung là sai loại dữ liệu.
 *
 * GIỚI HẠN TRUNG THỰC: bone shape chỉ đổi HIỂN THỊ (mesh phụ trong
 * viewport), không đổi skeleton, không đổi skin, không đổi export.
 * ============================================================ */
(function () {
  'use strict';

  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };
  var U = (window.PixiStudio && PixiStudio.Utils) || null;

  var BoneShape = {
    current: null,   /* { target, group, entries:{dst->{bone,mesh,jointMesh,baseLength,baseThickness,shape,joint,customized}}, visible } */
    mirror: true,    /* mặc định BẬT */
    DEFAULT_SHAPE: { length: 1, thickness: 1, width: 1, style: 'octahedron', color: null, opacity: null },
    DEFAULT_JOINT: { style: 'sphere', size: 1, color: null }
  };

  /* 6 loại hình: 3 cũ (octahedron/box/sphere — giữ nguyên geometry cũ
     để không phá harness cũ) + 3 mới (cylinder/cone/diamond). */
  var STYLES = ['octahedron', 'box', 'sphere', 'cylinder', 'cone', 'diamond'];
  BoneShape.STYLES = STYLES;
  var JOINT_STYLES = ['sphere', 'box', 'octahedron'];
  BoneShape.JOINT_STYLES = JOINT_STYLES;

  var DEFAULT_COLOR = 0x66ff99;   /* màu mặc định của mesh xương */
  var DEFAULT_OPACITY = 0.55;
  var PRESET_KEY = 'pixistudio.arp-boneshape-presets';
  var LIB_KEY = 'pixistudio.arp-boneshape-library';
  var MAX_HISTORY = 25;

  /* ---------- nhóm xương ---------- */
  var GROUPS = ['spine', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'fingers', 'other'];
  var GROUP_LABELS = {
    spine: 'Cột sống', head: 'Đầu', leftArm: 'Tay trái', rightArm: 'Tay phải',
    leftLeg: 'Chân trái', rightLeg: 'Chân phải', fingers: 'Ngón tay/chân', other: 'Khác'
  };
  BoneShape.GROUPS = GROUPS;
  BoneShape.GROUP_LABELS = GROUP_LABELS;

  function groupOfBone(name) {
    var s = stripName(name);
    if (/^(Hips|Spine|Spine1|Spine2|Chest|Neck|Neck1)$/i.test(s)) return 'spine';
    if (/^(Head|HeadTopEnd|Jaw|Eye)/i.test(s)) return 'head';
    if (/Thumb|Index|Middle|Ring|Pinky|Toe/i.test(s)) return 'fingers';
    if (/^Left(UpLeg|Leg|Foot)/i.test(s)) return 'leftLeg';
    if (/^Right(UpLeg|Leg|Foot)/i.test(s)) return 'rightLeg';
    if (/^Left/i.test(s)) return 'leftArm';
    if (/^Right/i.test(s)) return 'rightArm';
    return 'other';
  }
  BoneShape.groupOfBone = groupOfBone;

  function notify(type, title, message, duration) {
    try { bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 }); } catch (e) {}
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function stripName(name) {
    var s = String(name == null ? '' : name);
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    return s;
  }
  BoneShape.stripName = stripName;

  /* localStorage an toàn (jsdom/node/test đều không throw). */
  function _ls() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) {}
    return null;
  }
  function _lsGet(key) {
    var ls = _ls();
    if (!ls) return null;
    try { return ls.getItem(key); } catch (e) { return null; }
  }
  function _lsSet(key, val) {
    var ls = _ls();
    if (!ls) return false;
    try { ls.setItem(key, val); return true; } catch (e) { return false; }
  }
  function _lsRemove(key) {
    var ls = _ls();
    if (!ls) return;
    try { ls.removeItem(key); } catch (e) {}
  }
  function parseColor(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number' && isFinite(v)) return clamp(Math.floor(v), 0, 0xffffff);
    if (typeof v === 'string') {
      var h = v.replace(/^#/, '').trim();
      if (/^[0-9a-fA-F]{6}$/.test(h)) return parseInt(h, 16);
      if (/^[0-9a-fA-F]{3}$/.test(h)) return parseInt(h.split('').map(function (c) { return c + c; }).join(''), 16);
    }
    return null;
  }
  function colorCss(hex) {
    if (hex === null || hex === undefined) return '#66ff99';
    var n = parseColor(hex);
    if (n === null) return '#66ff99';
    return '#' + ('000000' + n.toString(16)).slice(-6);
  }
  BoneShape._test = {};

  /* mirrorName: LeftArm ↔ RightArm, giữ nguyên prefix mixamorig: nếu có.
     Xương không có cặp (Hips/Spine/Head...) → null. */
  function mirrorName(name) {
    var s = String(name == null ? '' : name);
    var base = stripName(s);
    var prefix = s.slice(0, s.length - base.length);
    if (/^Left/i.test(base)) return prefix + 'Right' + base.slice(4);
    if (/^Right/i.test(base)) return prefix + 'Left' + base.slice(5);
    return null;
  }
  BoneShape.mirrorName = mirrorName;

  function collectBones(root) {
    var out = [];
    if (!root || !root.traverse) return out;
    root.traverse(function (o) { if (o.isBone) out.push(o); });
    return out;
  }

  function makeGeometry(style) {
    var T = window.THREE;
    if (style === 'box') return new T.BoxGeometry(1, 1, 1);
    if (style === 'sphere') return new T.SphereGeometry(1, 10, 8);
    if (style === 'cylinder') return new T.CylinderGeometry(1, 1, 2, 12, 1);
    if (style === 'cone') return new T.ConeGeometry(1, 2, 12, 1);
    if (style === 'diamond') return new T.OctahedronGeometry(1, 0);
    return new T.OctahedronGeometry(1, 0);
  }
  function makeJointGeometry(style, r) {
    var T = window.THREE;
    r = r || 1;
    if (style === 'box') return new T.BoxGeometry(r * 2, r * 2, r * 2);
    if (style === 'octahedron') return new T.OctahedronGeometry(r, 0);
    return new T.SphereGeometry(r, 12, 10);
  }

  /* ---------- event đồng bộ viewport ---------- */
  function emitChanged(bones, kind) {
    try {
      bus.emit('boneshape:changed', {
        bones: bones || [],
        kind: kind || 'shape',
        at: Date.now()
      });
    } catch (e) {}
  }
  BoneShape.emitChanged = emitChanged;

  /* ---------- undo riêng cho Bone Shape (xem ghi chú đầu file) ---------- */
  var _history = { stack: [], index: -1 };
  function _captureAll() {
    var cur = BoneShape.current;
    var snap = { shapes: {}, joints: {}, customized: {} };
    if (!cur) return snap;
    var seen = {};
    Object.keys(cur.entries).forEach(function (k) {
      var e = cur.entries[k];
      if (!e || seen[e.bone.name]) return;
      seen[e.bone.name] = true;
      var s = stripName(e.bone.name);
      snap.shapes[s] = Object.assign({}, e.shape);
      snap.joints[s] = Object.assign({}, e.joint);
      snap.customized[s] = !!e.customized;
    });
    return snap;
  }
  function _restoreAll(snap) {
    var cur = BoneShape.current;
    if (!cur || !snap) return 0;
    var n = 0;
    Object.keys(snap.shapes || {}).forEach(function (s) {
      var e = lookupEntry(s);
      if (!e) return;
      applyShapeToEntry(e, snap.shapes[s], true);
      if (snap.joints && snap.joints[s]) applyJointToEntry(e, snap.joints[s]);
      e.customized = !!(snap.customized && snap.customized[s]);
      n++;
    });
    return n;
  }
  function _pushHistory(label) {
    var snap = _captureAll();
    snap.label = String(label || 'Thay đổi');
    snap.at = Date.now();
    if (_history.index < _history.stack.length - 1) _history.stack.length = _history.index + 1;
    _history.stack.push(snap);
    while (_history.stack.length > MAX_HISTORY) _history.stack.shift();
    _history.index = _history.stack.length - 1;
  }
  function undo() {
    if (_history.index <= 0) return { ok: false, error: 'Không còn bước nào để hoàn tác.' };
    _history.index--;
    var n = _restoreAll(_history.stack[_history.index]);
    emitChanged(null, 'undo');
    return { ok: true, index: _history.index, restored: n, label: _history.stack[_history.index].label };
  }
  BoneShape.undo = undo;
  function redo() {
    if (_history.index < 0 || _history.index >= _history.stack.length - 1) return { ok: false, error: 'Không còn bước nào để làm lại.' };
    _history.index++;
    var n = _restoreAll(_history.stack[_history.index]);
    emitChanged(null, 'redo');
    return { ok: true, index: _history.index, restored: n, label: _history.stack[_history.index].label };
  }
  BoneShape.redo = redo;
  BoneShape.canUndo = function () { return _history.index > 0; };
  BoneShape.canRedo = function () { return _history.index >= 0 && _history.index < _history.stack.length - 1; };
  BoneShape.getHistoryLabels = function () {
    return _history.stack.map(function (s, i) { return { label: s.label, at: s.at, index: i, current: i === _history.index }; });
  };

  /* Dựng bone mesh cho toàn bộ skeleton của target. */
  function buildBoneShapes(target, opts) {
    opts = opts || {};
    target = target || getTarget();
    if (!target || !target.traverse) return { ok: false, error: 'Chưa có model nào.' };
    if (!window.THREE) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var bones = collectBones(target);
    if (!bones.length) return { ok: false, error: 'Model chưa có skeleton — Bone Shape cần model đã rig.' };
    /* Dựng lại trên cùng target: giữ lại shape đã chỉnh (không mất
       khi refresh/rebuild), và reset undo vì snapshot cũ thuộc
       bộ mesh cũ. */
    var prevSnap = (BoneShape.current && BoneShape.current.target === target) ? _captureAll() : null;
    _history.stack = []; _history.index = -1;
    clearBoneShapes(target, true);
    target.updateMatrixWorld(true);
    var group = new window.THREE.Group();
    group.name = '__arp_boneshape__';
    target.add(group);
    var box = new window.THREE.Box3();
    try { box.setFromObject(target); } catch (e) {}
    var H = 1.8;
    try { var s = box.getSize(new window.THREE.Vector3()); if (s.y > 0.01) H = s.y; } catch (e) {}
    var entries = {};
    var up = new window.THREE.Vector3(0, 1, 0);
    bones.forEach(function (bone) {
      var kids = bone.children.filter(function (c) { return c.isBone; });
      var startW = new window.THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
      var endW, childName = null;
      if (kids.length) {
        endW = new window.THREE.Vector3().setFromMatrixPosition(kids[0].matrixWorld);
        childName = kids[0].name;
      } else {
        /* leaf: đoạn ngắn hướng xuống, dài 3% chiều cao */
        endW = startW.clone().add(new window.THREE.Vector3(0, -H * 0.03, 0));
      }
      var segLen = Math.max(0.01, startW.distanceTo(endW));
      var dir = endW.clone().sub(startW).normalize();
      var midW = startW.clone().add(endW).multiplyScalar(0.5);
      var mesh = new window.THREE.Mesh(
        makeGeometry('octahedron'),
        new window.THREE.MeshBasicMaterial({ color: DEFAULT_COLOR, transparent: true, opacity: DEFAULT_OPACITY, depthTest: false }));
      mesh.name = '__arp_boneshape_' + stripName(bone.name);
      mesh.userData.isBoneShapeVisual = true;
      /* Quy ước repo: mesh trang trí của xương PHẢI có isBoneVisual để
         FBXBinary.write / GLBWriter bỏ qua — nếu không file FBX export sẽ
         chứa thêm 41 mesh xương (cùng lỗi đã sửa ở các module arp-vp-*). */
      mesh.userData.isBoneVisual = true;
      mesh.userData.boneName = bone.name;
      mesh.userData.kind = 'segment';
      mesh.position.copy(group.worldToLocal(midW.clone()));
      mesh.quaternion.setFromUnitVectors(up, dir);
      /* OctahedronGeometry(1) cao 2 đơn vị theo Y → scale.y = segLen/2;
         dày mặc định 8% độ dài đoạn xương. */
      var baseThickness = Math.max(0.004, segLen * 0.08);
      mesh.scale.set(baseThickness, segLen / 2, baseThickness);
      mesh.userData.baseScale = { x: baseThickness, y: segLen / 2, z: baseThickness };
      group.add(mesh);
      /* --- khớp riêng tại gốc xương (mục 5) --- */
      var jointBase = baseThickness * 2.2;
      var jointMesh = new window.THREE.Mesh(
        makeJointGeometry('sphere', 1),
        new window.THREE.MeshBasicMaterial({ color: DEFAULT_COLOR, transparent: true, opacity: DEFAULT_OPACITY, depthTest: false }));
      jointMesh.name = '__arp_boneshape_joint_' + stripName(bone.name);
      /* CHÚ Ý: joint KHÔNG mang isBoneShapeVisual — harness cũ đếm đúng
         41 mesh segment qua cờ đó; joint dùng cờ riêng isBoneShapeJoint
         (vẫn có isBoneVisual nên FBX writer bỏ qua). */
      jointMesh.userData.isBoneVisual = true;
      jointMesh.userData.isBoneShapeJoint = true;
      jointMesh.userData.boneName = bone.name;
      jointMesh.userData.kind = 'joint';
      jointMesh.position.copy(group.worldToLocal(startW.clone()));
      jointMesh.scale.setScalar(jointBase);
      jointMesh.userData.baseScale = jointBase;
      group.add(jointMesh);
      entries[stripName(bone.name)] = {
        bone: bone, mesh: mesh, jointMesh: jointMesh, childName: childName,
        baseLength: segLen, baseThickness: baseThickness, jointBase: jointBase,
        shape: { length: 1, thickness: 1, width: 1, style: 'octahedron', color: null, opacity: null },
        joint: { style: 'sphere', size: 1, color: null },
        customized: false
      };
      /* key đầy đủ tên gốc để tra cứu linh hoạt */
      entries[bone.name] = entries[stripName(bone.name)];
    });
    BoneShape.current = {
      target: target, group: group, entries: entries, height: H,
      visible: opts.visible !== undefined ? !!opts.visible : true,
      boneCount: bones.length
    };
    group.visible = BoneShape.current.visible;
    if (prevSnap) _restoreAll(prevSnap);
    _pushHistory('Ban đầu');
    return { ok: true, boneCount: bones.length, group: group };
  }
  BoneShape.buildBoneShapes = buildBoneShapes;
  BoneShape.build = buildBoneShapes;

  function getTarget() {
    if (window.PixiStudio && PixiStudio.State && PixiStudio.State.get) {
      try { var sel = PixiStudio.State.get('selection'); if (sel) return sel; } catch (e) {}
    }
    if (window.PixiStudio && PixiStudio.Viewport && PixiStudio.Viewport.getMainModel) {
      try { return PixiStudio.Viewport.getMainModel(); } catch (e) {}
    }
    if (window.PixiStudio && PixiStudio.ArpQuickRig && PixiStudio.ArpQuickRig.current) {
      return PixiStudio.ArpQuickRig.current.target;
    }
    return null;
  }

  function lookupEntry(name) {
    var cur = BoneShape.current;
    if (!cur) return null;
    var s = stripName(name);
    return cur.entries[s] || cur.entries[name] || null;
  }

  function applyShapeToEntry(entry, shape, silent) {
    if (!entry || !entry.mesh) return false;
    var mesh = entry.mesh;
    shape = shape || {};
    if (shape.style && STYLES.indexOf(shape.style) >= 0 && shape.style !== entry.shape.style) {
      try {
        var old = mesh.geometry;
        mesh.geometry = makeGeometry(shape.style);
        if (old && old.dispose) old.dispose();
      } catch (e) {}
    }
    if (shape.length !== undefined) entry.shape.length = clamp(Number(shape.length) || 1, 0.1, 4);
    if (shape.thickness !== undefined) entry.shape.thickness = clamp(Number(shape.thickness) || 1, 0.1, 5);
    if (shape.width !== undefined) entry.shape.width = clamp(Number(shape.width) || 1, 0.1, 5);
    if (shape.style && STYLES.indexOf(shape.style) >= 0) entry.shape.style = shape.style;
    if (shape.color !== undefined) entry.shape.color = parseColor(shape.color);
    if (shape.opacity !== undefined) {
      var op = (shape.opacity === null) ? null : clamp(Number(shape.opacity), 0.05, 1);
      entry.shape.opacity = (shape.opacity === null || isNaN(op)) ? null : op;
    }
    var bs = mesh.userData.baseScale;
    mesh.scale.set(
      bs.x * entry.shape.thickness * entry.shape.width,
      bs.y * entry.shape.length,
      bs.z * entry.shape.thickness);
    try {
      mesh.material.color.setHex(entry.shape.color === null ? DEFAULT_COLOR : entry.shape.color);
      mesh.material.opacity = entry.shape.opacity === null ? DEFAULT_OPACITY : entry.shape.opacity;
    } catch (e) {}
    if (!silent) entry.customized = true;
    return true;
  }

  function applyJointToEntry(entry, joint) {
    if (!entry || !entry.jointMesh) return false;
    joint = joint || {};
    var jm = entry.jointMesh;
    if (joint.style && JOINT_STYLES.indexOf(joint.style) >= 0 && joint.style !== entry.joint.style) {
      try {
        var old = jm.geometry;
        jm.geometry = makeJointGeometry(joint.style, 1);
        if (old && old.dispose) old.dispose();
      } catch (e) {}
    }
    if (joint.style && JOINT_STYLES.indexOf(joint.style) >= 0) entry.joint.style = joint.style;
    if (joint.size !== undefined) entry.joint.size = clamp(Number(joint.size) || 1, 0.2, 4);
    if (joint.color !== undefined) entry.joint.color = parseColor(joint.color);
    var base = entry.jointBase || jm.userData.baseScale || 0.02;
    jm.scale.setScalar(base * entry.joint.size);
    try {
      var c = entry.joint.color !== null && entry.joint.color !== undefined ? entry.joint.color
        : (entry.shape.color !== null ? entry.shape.color : DEFAULT_COLOR);
      jm.material.color.setHex(c);
      jm.material.opacity = entry.shape.opacity === null ? DEFAULT_OPACITY : entry.shape.opacity;
    } catch (e) {}
    entry.customized = true;
    return true;
  }

  /* setShape: chỉnh 1 xương; Mirror BẬT → áp cùng shape sang phía đối xứng. */
  function setShape(boneName, shape) {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape — bấm "Hiện xương" / chọn model đã rig trước.' };
    shape = shape || {};
    var entry = lookupEntry(boneName);
    if (!entry) return { ok: false, error: 'Không tìm thấy xương: ' + boneName };
    applyShapeToEntry(entry, shape);
    var mirrored = null;
    if (BoneShape.mirror) {
      var twin = mirrorName(boneName);
      if (twin) {
        var twinEntry = lookupEntry(twin);
        if (twinEntry && twinEntry !== entry) {
          applyShapeToEntry(twinEntry, entry.shape);
          mirrored = twin;
        }
      }
    }
    _pushHistory('Đổi hình ' + stripName(boneName));
    emitChanged([stripName(boneName)].concat(mirrored ? [stripName(mirrored)] : []), 'shape');
    return { ok: true, bone: stripName(boneName), shape: Object.assign({}, entry.shape), mirrored: mirrored };
  }
  BoneShape.setShape = setShape;

  function getShape(boneName) {
    var entry = lookupEntry(boneName);
    return entry ? Object.assign({}, entry.shape) : null;
  }
  BoneShape.getShape = getShape;

  /* API ĐỒNG BỘ VIEWPORT (mục 7): VP skeleton đọc spec này khi tạo
     hình xương. color/opacity = null nghĩa là "chưa custom → VP dùng
     màu nhóm/opacity mặc định của nó"; customized=false nghĩa là
     xương chưa từng được chỉnh → VP dùng hẳn hình mặc định của nó
     (cylinder + khớp cầu theo nhóm màu). */
  function getShapeForBone(boneName) {
    var entry = lookupEntry(boneName);
    if (!entry) return null;
    return {
      type: entry.shape.style,
      length: entry.shape.length,
      thickness: entry.shape.thickness,
      width: entry.shape.width,
      color: entry.shape.color,
      opacity: entry.shape.opacity,
      jointStyle: entry.joint.style,
      jointSize: entry.joint.size,
      jointColor: entry.joint.color,
      customized: !!entry.customized
    };
  }
  BoneShape.getShapeForBone = getShapeForBone;

  /* ---------- khớp (mục 5) ---------- */
  function setJoint(boneName, joint) {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    var entry = lookupEntry(boneName);
    if (!entry) return { ok: false, error: 'Không tìm thấy xương: ' + boneName };
    applyJointToEntry(entry, joint || {});
    var mirrored = null;
    if (BoneShape.mirror) {
      var twin = mirrorName(boneName);
      if (twin) {
        var te = lookupEntry(twin);
        if (te && te !== entry) { applyJointToEntry(te, entry.joint); mirrored = twin; }
      }
    }
    _pushHistory('Đổi khớp ' + stripName(boneName));
    emitChanged([stripName(boneName)].concat(mirrored ? [stripName(mirrored)] : []), 'joint');
    return { ok: true, bone: stripName(boneName), joint: Object.assign({}, entry.joint), mirrored: mirrored };
  }
  BoneShape.setJoint = setJoint;
  function getJoint(boneName) {
    var entry = lookupEntry(boneName);
    return entry ? Object.assign({}, entry.joint) : null;
  }
  BoneShape.getJoint = getJoint;

  BoneShape.listBones = function () {
    var cur = BoneShape.current;
    if (!cur) return [];
    var seen = {}, out = [];
    Object.keys(cur.entries).forEach(function (k) {
      var s = stripName(k);
      if (!seen[s]) { seen[s] = true; out.push(s); }
    });
    return out;
  };
  BoneShape.listGroupBones = function (group) {
    return BoneShape.listBones().filter(function (n) { return groupOfBone(n) === group; });
  };

  /* ---------- thao tác hàng loạt (mục 6) ---------- */
  function applyToGroup(group, shape) {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    var names = BoneShape.listGroupBones(group);
    if (!names.length) return { ok: false, error: 'Nhóm "' + group + '" không có xương nào.' };
    var applied = [];
    names.forEach(function (n) {
      var e = lookupEntry(n);
      if (e) { applyShapeToEntry(e, shape || {}); applied.push(n); }
    });
    _pushHistory('Áp hình cho nhóm ' + (GROUP_LABELS[group] || group));
    emitChanged(applied, 'group');
    return { ok: true, group: group, applied: applied.length, bones: applied };
  }
  BoneShape.applyToGroup = applyToGroup;

  function applyToAll(shape) {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    var applied = [];
    var seen = {};
    Object.keys(cur.entries).forEach(function (k) {
      var e = cur.entries[k];
      if (!e || seen[e.bone.name]) return;
      seen[e.bone.name] = true;
      applyShapeToEntry(e, shape || {});
      applied.push(stripName(e.bone.name));
    });
    _pushHistory('Áp hình cho toàn bộ');
    emitChanged(applied, 'all');
    return { ok: true, applied: applied.length, bones: applied };
  }
  BoneShape.applyToAll = applyToAll;

  function setGroupColor(group, hex) {
    var c = parseColor(hex);
    if (c === null) return { ok: false, error: 'Màu không hợp lệ: ' + hex };
    return applyToGroup(group, { color: c });
  }
  BoneShape.setGroupColor = setGroupColor;

  function setJointGroup(group, joint) {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    var names = BoneShape.listGroupBones(group);
    if (!names.length) return { ok: false, error: 'Nhóm "' + group + '" không có xương nào.' };
    var applied = [];
    names.forEach(function (n) {
      var e = lookupEntry(n);
      if (e) { applyJointToEntry(e, joint || {}); applied.push(n); }
    });
    _pushHistory('Đổi khớp nhóm ' + (GROUP_LABELS[group] || group));
    emitChanged(applied, 'joint-group');
    return { ok: true, group: group, applied: applied.length, bones: applied };
  }
  BoneShape.setJointGroup = setJointGroup;

  function copyShape(fromName, toName, opts) {
    opts = opts || {};
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    var from = lookupEntry(fromName);
    var to = lookupEntry(toName);
    if (!from) return { ok: false, error: 'Không tìm thấy xương nguồn: ' + fromName };
    if (!to) return { ok: false, error: 'Không tìm thấy xương đích: ' + toName };
    applyShapeToEntry(to, from.shape);
    if (opts.withJoint !== false) applyJointToEntry(to, from.joint);
    _pushHistory('Copy hình ' + stripName(fromName) + ' → ' + stripName(toName));
    emitChanged([stripName(toName)], 'copy');
    return { ok: true, from: stripName(fromName), to: stripName(toName), shape: Object.assign({}, to.shape) };
  }
  BoneShape.copyShape = copyShape;

  /* Mirror theo nhóm: copy toàn bộ shape phía L sang phía R của nhóm
     (hoặc R→L nếu direction='R2L'). */
  function mirrorGroup(group, direction) {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    direction = direction || 'L2R';
    var names = BoneShape.listGroupBones(group);
    var mirrored = [];
    names.forEach(function (n) {
      var srcName = (direction === 'R2L') ? mirrorName(n) : n;
      var dstName = (direction === 'R2L') ? n : mirrorName(n);
      if (!srcName || !dstName) return;
      var src = lookupEntry(srcName), dst = lookupEntry(dstName);
      if (!src || !dst || src === dst) return;
      applyShapeToEntry(dst, src.shape);
      applyJointToEntry(dst, src.joint);
      mirrored.push(stripName(dstName));
    });
    _pushHistory('Mirror nhóm ' + (GROUP_LABELS[group] || group) + ' (' + direction + ')');
    emitChanged(mirrored, 'mirror-group');
    return { ok: true, group: group, direction: direction, mirrored: mirrored.length, bones: mirrored };
  }
  BoneShape.mirrorGroup = mirrorGroup;

  /* Kiểm tra đối xứng: so shape + joint từng cặp L/R có trong rig. */
  function checkSymmetry() {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    var pairs = [], mismatched = [];
    var seen = {};
    BoneShape.listBones().forEach(function (n) {
      var twin = mirrorName(n);
      if (!twin) return;
      var key = [stripName(n), stripName(twin)].sort().join('|');
      if (seen[key]) return;
      seen[key] = true;
      var a = lookupEntry(n), b = lookupEntry(twin);
      if (!a || !b) return;
      pairs.push({ left: /Left/i.test(stripName(n)) ? stripName(n) : stripName(twin), right: /Right/i.test(stripName(n)) ? stripName(n) : stripName(twin) });
      var fields = [];
      ['length', 'thickness', 'width', 'style', 'color', 'opacity'].forEach(function (f) {
        if (a.shape[f] !== b.shape[f]) fields.push('shape.' + f);
      });
      ['style', 'size', 'color'].forEach(function (f) {
        if (a.joint[f] !== b.joint[f]) fields.push('joint.' + f);
      });
      if (fields.length) mismatched.push({ left: pairs[pairs.length - 1].left, right: pairs[pairs.length - 1].right, fields: fields });
    });
    var score = pairs.length ? Math.round((pairs.length - mismatched.length) / pairs.length * 100) : 100;
    return { ok: true, pairs: pairs.length, matched: pairs.length - mismatched.length, mismatched: mismatched, score: score };
  }
  BoneShape.checkSymmetry = checkSymmetry;

  function resetBone(boneName) {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    var entry = lookupEntry(boneName);
    if (!entry) return { ok: false, error: 'Không tìm thấy xương: ' + boneName };
    applyShapeToEntry(entry, { length: 1, thickness: 1, width: 1, style: 'octahedron', color: null, opacity: null });
    applyJointToEntry(entry, { style: 'sphere', size: 1, color: null });
    entry.customized = false;
    _pushHistory('Reset xương ' + stripName(boneName));
    emitChanged([stripName(boneName)], 'reset-bone');
    return { ok: true, bone: stripName(boneName) };
  }
  BoneShape.resetBone = resetBone;

  function resetGroup(group) {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    var names = BoneShape.listGroupBones(group);
    if (!names.length) return { ok: false, error: 'Nhóm "' + group + '" không có xương nào.' };
    names.forEach(function (n) {
      var e = lookupEntry(n);
      if (!e) return;
      applyShapeToEntry(e, { length: 1, thickness: 1, width: 1, style: 'octahedron', color: null, opacity: null });
      applyJointToEntry(e, { style: 'sphere', size: 1, color: null });
      e.customized = false;
    });
    _pushHistory('Reset nhóm ' + (GROUP_LABELS[group] || group));
    emitChanged(names, 'reset-group');
    return { ok: true, group: group, resetCount: names.length };
  }
  BoneShape.resetGroup = resetGroup;

  function reset() {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    var count = 0;
    var seen = {};
    var names = [];
    Object.keys(cur.entries).forEach(function (k) {
      var entry = cur.entries[k];
      if (seen[entry.bone.name]) return;
      seen[entry.bone.name] = true;
      applyShapeToEntry(entry, { length: 1, thickness: 1, width: 1, style: 'octahedron', color: null, opacity: null });
      applyJointToEntry(entry, { style: 'sphere', size: 1, color: null });
      entry.customized = false;
      count++;
      names.push(stripName(entry.bone.name));
    });
    _pushHistory('Reset toàn bộ');
    emitChanged(names, 'reset-all');
    notify('info', 'Bone Shape', 'Đã reset ' + count + ' xương về shape mặc định.');
    return { ok: true, resetCount: count };
  }
  BoneShape.reset = reset;

  function setVisible(visible) {
    var cur = BoneShape.current;
    if (!cur) {
      /* chưa dựng: thử dựng từ model hiện tại rồi áp visibility */
      var r = buildBoneShapes(getTarget());
      if (!r.ok) return false;
      cur = BoneShape.current;
    }
    cur.visible = visible === undefined ? !cur.visible : !!visible;
    cur.group.visible = cur.visible;
    return cur.visible;
  }
  BoneShape.setVisible = setVisible;
  BoneShape.toggleVisible = setVisible;

  function clearBoneShapes(target, silent) {
    target = target || (BoneShape.current && BoneShape.current.target);
    if (!target) return false;
    var removed = false;
    (target.children || []).slice().forEach(function (c) {
      if (c.name === '__arp_boneshape__') { target.remove(c); removed = true; }
    });
    if (BoneShape.current && BoneShape.current.target === target) BoneShape.current = null;
    if (!silent && removed) notify('info', 'Bone Shape', 'Đã gỡ bone shape khỏi model.');
    return removed;
  }
  BoneShape.clearBoneShapes = clearBoneShapes;

  /* Cập nhật lại vị trí/hướng mesh theo pose xương hiện tại. */
  function refresh() {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    cur.target.updateMatrixWorld(true);
    var up = new window.THREE.Vector3(0, 1, 0);
    var seen = {};
    Object.keys(cur.entries).forEach(function (k) {
      var entry = cur.entries[k];
      if (seen[entry.bone.name]) return;
      seen[entry.bone.name] = true;
      var bone = entry.bone;
      var kids = bone.children.filter(function (c) { return c.isBone; });
      var startW = new window.THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
      var endW = kids.length
        ? new window.THREE.Vector3().setFromMatrixPosition(kids[0].matrixWorld)
        : startW.clone().add(new window.THREE.Vector3(0, -cur.height * 0.03, 0));
      var midW = startW.clone().add(endW).multiplyScalar(0.5);
      var dir = endW.clone().sub(startW);
      var len = Math.max(0.01, dir.length());
      dir.normalize();
      entry.mesh.position.copy(cur.group.worldToLocal(midW.clone()));
      entry.mesh.quaternion.setFromUnitVectors(up, dir);
      if (entry.jointMesh) entry.jointMesh.position.copy(cur.group.worldToLocal(startW.clone()));
      entry.baseLength = len;
      var bs = entry.mesh.userData.baseScale;
      bs.y = len / 2;
      entry.mesh.scale.set(bs.x * entry.shape.thickness * entry.shape.width, bs.y * entry.shape.length, bs.z * entry.shape.thickness);
    });
    return { ok: true };
  }
  BoneShape.refresh = refresh;

  /* ---------- preset phong cách (mục 2) ---------- */
  var BUILTIN_PRESETS = {
    mixamo: { label: 'Mixamo (octahedron)', shape: { length: 1, thickness: 1, width: 1, style: 'octahedron', color: null, opacity: null }, joint: { style: 'sphere', size: 1, color: null } },
    blender: { label: 'Blender (box)', shape: { length: 1, thickness: 1.1, width: 1, style: 'box', color: 0x33aaff, opacity: 0.8 }, joint: { style: 'box', size: 0.9, color: null } },
    stick: { label: 'Stick figure (mảnh)', shape: { length: 1, thickness: 0.45, width: 0.45, style: 'cylinder', color: null, opacity: 0.9 }, joint: { style: 'sphere', size: 0.7, color: null } },
    chibi: { label: 'Chibi (tròn, mập)', shape: { length: 0.9, thickness: 1.7, width: 1.7, style: 'sphere', color: null, opacity: 0.7 }, joint: { style: 'sphere', size: 1.6, color: null } },
    realistic: { label: 'Realistic (trụ mảnh)', shape: { length: 1, thickness: 0.8, width: 0.8, style: 'cylinder', color: 0xd8d8d8, opacity: 0.85 }, joint: { style: 'octahedron', size: 0.9, color: null } }
  };
  BoneShape.BUILTIN_PRESETS = BUILTIN_PRESETS;

  function _loadCustomPresets() {
    try {
      var raw = _lsGet(PRESET_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }
  function _saveCustomPresets(obj) {
    return _lsSet(PRESET_KEY, JSON.stringify(obj || {}));
  }
  function listPresets() {
    var out = [];
    Object.keys(BUILTIN_PRESETS).forEach(function (k) {
      out.push({ name: k, label: BUILTIN_PRESETS[k].label, builtin: true });
    });
    var custom = _loadCustomPresets();
    Object.keys(custom).forEach(function (k) {
      out.push({ name: k, label: custom[k].label || k, builtin: false });
    });
    return out;
  }
  BoneShape.listPresets = listPresets;
  function getPreset(name) {
    if (BUILTIN_PRESETS[name]) return { name: name, builtin: true, label: BUILTIN_PRESETS[name].label, shape: Object.assign({}, BUILTIN_PRESETS[name].shape), joint: Object.assign({}, BUILTIN_PRESETS[name].joint) };
    var custom = _loadCustomPresets();
    if (custom[name]) {
      var c = custom[name];
      return { name: name, builtin: false, label: c.label || name, shape: Object.assign({}, c.shape || {}), joint: Object.assign({}, c.joint || {}) };
    }
    return null;
  }
  BoneShape.getPreset = getPreset;
  function applyPreset(name) {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    var p = getPreset(name);
    if (!p) return { ok: false, error: 'Không có preset: ' + name };
    var applied = [];
    var seen = {};
    Object.keys(cur.entries).forEach(function (k) {
      var e = cur.entries[k];
      if (!e || seen[e.bone.name]) return;
      seen[e.bone.name] = true;
      applyShapeToEntry(e, p.shape);
      if (p.joint) applyJointToEntry(e, p.joint);
      applied.push(stripName(e.bone.name));
    });
    _pushHistory('Áp preset ' + p.label);
    emitChanged(applied, 'preset');
    return { ok: true, preset: name, label: p.label, applied: applied.length };
  }
  BoneShape.applyPreset = applyPreset;
  function savePreset(name, opts) {
    opts = opts || {};
    name = String(name || '').trim();
    if (!name) return { ok: false, error: 'Tên preset không được để trống.' };
    if (BUILTIN_PRESETS[name]) return { ok: false, error: 'Tên "' + name + '" trùng preset có sẵn.' };
    var shape = opts.shape || (opts.bone ? getShape(opts.bone) : null) || Object.assign({}, BoneShape.DEFAULT_SHAPE);
    var joint = opts.joint || (opts.bone ? getJoint(opts.bone) : null) || Object.assign({}, BoneShape.DEFAULT_JOINT);
    var custom = _loadCustomPresets();
    custom[name] = { label: opts.label || name, shape: shape, joint: joint, at: Date.now() };
    _saveCustomPresets(custom);
    return { ok: true, name: name, label: custom[name].label };
  }
  BoneShape.savePreset = savePreset;
  function deletePreset(name) {
    if (BUILTIN_PRESETS[name]) return { ok: false, error: 'Không xóa được preset có sẵn.' };
    var custom = _loadCustomPresets();
    if (!custom[name]) return { ok: false, error: 'Không có preset: ' + name };
    delete custom[name];
    _saveCustomPresets(custom);
    return { ok: true, name: name };
  }
  BoneShape.deletePreset = deletePreset;

  /* ---------- thư viện hình xương (mục 3) ---------- */
  function _loadLibrary() {
    try {
      var raw = _lsGet(LIB_KEY);
      if (!raw) return [];
      var a = JSON.parse(raw);
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function _saveLibrary(arr) { return _lsSet(LIB_KEY, JSON.stringify(arr || [])); }
  function listLibrary() { return _loadLibrary(); }
  BoneShape.listLibrary = listLibrary;
  function saveToLibrary(name, scope, boneName) {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    name = String(name || '').trim();
    if (!name) return { ok: false, error: 'Tên thư viện không được để trống.' };
    scope = scope === 'bone' ? 'bone' : 'rig';
    var lib = _loadLibrary();
    var item = { id: 'lib_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36), name: name, scope: scope, at: Date.now(), shapes: {}, joints: {} };
    if (scope === 'bone') {
      var e = lookupEntry(boneName || BoneShape.getSelectedBone() || 'Hips');
      if (!e) return { ok: false, error: 'Không tìm thấy xương: ' + (boneName || '') };
      item.bone = stripName(e.bone.name);
      item.shapes[item.bone] = Object.assign({}, e.shape);
      item.joints[item.bone] = Object.assign({}, e.joint);
    } else {
      var snap = _captureAll();
      item.shapes = snap.shapes;
      item.joints = snap.joints;
    }
    lib.push(item);
    _saveLibrary(lib);
    return { ok: true, id: item.id, name: name, scope: scope, bones: Object.keys(item.shapes).length };
  }
  BoneShape.saveToLibrary = saveToLibrary;
  function applyLibrary(id, targetBone) {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    var lib = _loadLibrary();
    var item = null;
    lib.forEach(function (x) { if (x.id === id || x.name === id) item = x; });
    if (!item) return { ok: false, error: 'Không có mục thư viện: ' + id };
    var applied = [];
    if (item.scope === 'bone') {
      var bone = targetBone || item.bone;
      var e = lookupEntry(bone);
      if (!e) return { ok: false, error: 'Không tìm thấy xương đích: ' + bone };
      var s = item.shapes[item.bone] || item.shapes[Object.keys(item.shapes)[0]];
      var j = item.joints[item.bone] || item.joints[Object.keys(item.joints)[0]];
      if (s) applyShapeToEntry(e, s);
      if (j) applyJointToEntry(e, j);
      applied.push(stripName(e.bone.name));
    } else {
      Object.keys(item.shapes || {}).forEach(function (n) {
        var en = lookupEntry(n);
        if (!en) return;
        applyShapeToEntry(en, item.shapes[n]);
        if (item.joints && item.joints[n]) applyJointToEntry(en, item.joints[n]);
        applied.push(stripName(n));
      });
    }
    _pushHistory('Áp thư viện ' + item.name);
    emitChanged(applied, 'library');
    return { ok: true, name: item.name, scope: item.scope, applied: applied.length, bones: applied };
  }
  BoneShape.applyLibrary = applyLibrary;
  function deleteLibrary(id) {
    var lib = _loadLibrary();
    var before = lib.length;
    lib = lib.filter(function (x) { return x.id !== id && x.name !== id; });
    if (lib.length === before) return { ok: false, error: 'Không có mục thư viện: ' + id };
    _saveLibrary(lib);
    return { ok: true, removed: before - lib.length };
  }
  BoneShape.deleteLibrary = deleteLibrary;

  /* ---------- xuất / nhập JSON (mục 8) ---------- */
  function toJSON() {
    var cur = BoneShape.current;
    var snap = _captureAll();
    return {
      format: 'pixistudio-boneshape',
      version: 1,
      at: new Date().toISOString(),
      boneCount: cur ? cur.boneCount : 0,
      mirror: !!BoneShape.mirror,
      shapes: snap.shapes,
      joints: snap.joints
    };
  }
  BoneShape.toJSON = toJSON;
  function fromJSON(data) {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    try {
      if (typeof data === 'string') data = JSON.parse(data);
    } catch (e) {
      return { ok: false, error: 'JSON không hợp lệ: ' + (e && e.message) };
    }
    if (!data || typeof data !== 'object') return { ok: false, error: 'Dữ liệu JSON không hợp lệ.' };
    if (data.format && data.format !== 'pixistudio-boneshape') return { ok: false, error: 'Không phải file cấu hình Bone Shape.' };
    if (!data.shapes || typeof data.shapes !== 'object') return { ok: false, error: 'JSON thiếu mục "shapes".' };
    var applied = 0, skipped = [];
    Object.keys(data.shapes).forEach(function (n) {
      var e = lookupEntry(n);
      if (!e) { skipped.push(n); return; }
      applyShapeToEntry(e, data.shapes[n]);
      if (data.joints && data.joints[n]) applyJointToEntry(e, data.joints[n]);
      applied++;
    });
    if (typeof data.mirror === 'boolean') BoneShape.mirror = data.mirror;
    _pushHistory('Nhập JSON Bone Shape');
    emitChanged(Object.keys(data.shapes), 'import-json');
    return { ok: true, applied: applied, skipped: skipped };
  }
  BoneShape.fromJSON = fromJSON;
  function downloadJSON(filename) {
    var text = JSON.stringify(toJSON(), null, 2);
    filename = filename || 'boneshape-config.json';
    try {
      if (U && typeof U.downloadText === 'function') { U.downloadText(filename, text); return { ok: true, via: 'utils', filename: filename, bytes: text.length }; }
    } catch (e) {}
    try {
      if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
        var blob = new Blob([text], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (err) {} }, 500);
        return { ok: true, via: 'blob', filename: filename, bytes: text.length };
      }
    } catch (e) { return { ok: false, error: 'Không tải được file: ' + (e && e.message) }; }
    return { ok: false, error: 'Môi trường không hỗ trợ tải file.' };
  }
  BoneShape.downloadJSON = downloadJSON;
  /* FBX: xem ghi chú đầu file — writer bỏ qua mesh isBoneVisual nên
     KHÔNG thể xuất hình xương kèm FBX. Hàm này trả rõ giới hạn để
     UI hiển thị, không bịa ra file FBX chứa bone shape. */
  BoneShape.exportFBXNote = function () {
    return {
      ok: false,
      supported: false,
      reason: 'FBXBinary.write bỏ qua mọi mesh có userData.isBoneVisual (js/exporter/fbx-binary.js collect()), và arp-export.js cũng bỏ qua chúng — đó là hành vi cố ý để file FBX rig không chứa mesh trang trí. Không có writer nào trong repo hỗ trợ nhúng "bone shape" vào FBX. Dùng xuất JSON để lưu/tải lại cấu hình hình xương.'
    };
  };

  /* ---------- chọn xương từ viewport (mục 1 + 9) ---------- */
  var _selectedBone = null;
  var _uiJump = null;
  BoneShape.getSelectedBone = function () { return _selectedBone; };
  function selectBone(name) {
    var entry = lookupEntry(name);
    if (!entry && BoneShape.current) return { ok: false, error: 'Không tìm thấy xương: ' + name };
    _selectedBone = entry ? stripName(entry.bone.name) : stripName(name);
    if (typeof _uiJump === 'function') {
      try { _uiJump(_selectedBone); } catch (e) {}
    }
    return { ok: true, bone: _selectedBone };
  }
  BoneShape.selectBone = selectBone;
  BoneShape._setUiJump = function (fn) { _uiJump = (typeof fn === 'function') ? fn : null; };
  /* Panel tự làm mới khi hình đổi từ nơi khác (preset/API/khác tab):
     đăng ký 1 lần ở module scope; renderTab gán _panelRefresh. */
  var _panelRefresh = null;
  try {
    if (bus && typeof bus.on === 'function') {
      bus.on('boneshape:changed', function (d) {
        try { if (typeof _panelRefresh === 'function') _panelRefresh(d); } catch (e) {}
      });
    }
  } catch (e) {}
  /* Nghe bấm chọn xương trong viewport (arp-vp-select.js phát
     'arpvpselect:select' — chỉ nghe, không sửa logic chọn của VP). */
  try {
    if (bus && typeof bus.on === 'function') {
      bus.on('arpvpselect:select', function (d) {
        try {
          if (d && d.bone) selectBone(d.bone);
        } catch (e) {}
      });
    }
  } catch (e) {}

  /* ---------- UI — tab Bone Shape (mục 9) ---------- */
  function el(tag, attrs, children) {
    if (U && U.el) return U.el(tag, attrs, children);
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null) return;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    }
    return node;
  }

  /* Xem trước hình đang chọn: vẽ silhouette 2D lên canvas (không cần
     WebGL nên chạy được cả trên điện thoại và trong test jsdom). */
  function drawPreview(canvas, shape, joint) {
    if (!canvas) return false;
    try {
      var ctx = canvas.getContext('2d');
      if (!ctx || typeof ctx.clearRect !== 'function') return false;
      var W = canvas.width || 120, H = canvas.height || 90;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#101828';
      ctx.fillRect(0, 0, W, H);
      var color = colorCss(shape && shape.color !== null && shape.color !== undefined ? shape.color : DEFAULT_COLOR);
      var alpha = (shape && shape.opacity !== null && shape.opacity !== undefined) ? shape.opacity : DEFAULT_OPACITY;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      var cx = W / 2, cy = H / 2, rw = 14, rh = 34;
      var style = (shape && shape.style) || 'octahedron';
      ctx.beginPath();
      if (style === 'box') ctx.rect(cx - rw, cy - rh, rw * 2, rh * 2);
      else if (style === 'sphere') { ctx.arc(cx, cy, 24, 0, Math.PI * 2); }
      else if (style === 'cylinder') ctx.rect(cx - rw, cy - rh, rw * 2, rh * 2);
      else if (style === 'cone') { ctx.moveTo(cx, cy - rh); ctx.lineTo(cx + rw, cy + rh); ctx.lineTo(cx - rw, cy + rh); ctx.closePath(); }
      else { /* octahedron / diamond: hình thoi */
        ctx.moveTo(cx, cy - rh); ctx.lineTo(cx + rw, cy); ctx.lineTo(cx, cy + rh); ctx.lineTo(cx - rw, cy); ctx.closePath();
      }
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      /* khớp: chấm tròn ở 2 đầu đoạn xương */
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = colorCss(joint && joint.color !== null && joint.color !== undefined ? joint.color : (shape && shape.color !== null ? shape.color : DEFAULT_COLOR));
      ctx.beginPath(); ctx.arc(cx, cy - rh, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy + rh, 5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      return true;
    } catch (e) { return false; }
  }

  function renderBoneShapeTab(container) {
    if (!container) return;
    container.innerHTML = '';
    var wrap = el('div', { class: 'arp-boneshape-tab' });
    wrap.appendChild(el('div', { class: 'arp-note', html:
      '<b>Bone Shape Editor</b> — chỉnh hình dạng hiển thị của xương (mesh phụ, không đổi skeleton/skin/export). ' +
      'Mirror mặc định BẬT: đổi xương trái thì xương phải đổi theo. ' +
      'Đổi hình ở đây thì viewport (VP Skeleton) cập nhật ngay qua event boneshape:changed.' }));
    var state = {
      bone: _selectedBone || 'LeftArm', length: 1, thickness: 1, width: 1,
      style: 'octahedron', color: null, opacity: null,
      jointStyle: 'sphere', jointSize: 1, jointColor: null,
      query: '', groupFilter: 'all'
    };
    var previewCanvas = null, previewLabel = null, symResult = null, libListEl = null;
    var boneListEl = null, countEl = null;
    var selBone = null, selStyle = null, selJointStyle = null;
    var inpLen = null, inpThick = null, inpWidth = null, inpOp = null;
    var inpColor = null, inpJointColor = null, inpJointSize = null;
    var valLen = null, valThick = null, valWidth = null, valOp = null, valJointSize = null;

    function currentShape() {
      return { length: state.length, thickness: state.thickness, width: state.width, style: state.style, color: state.color, opacity: state.opacity };
    }
    function refreshPreview() {
      if (previewCanvas) drawPreview(previewCanvas, currentShape(), { style: state.jointStyle, size: state.jointSize, color: state.jointColor });
      if (previewLabel) previewLabel.textContent = state.bone + ' · ' + state.style + ' · dài ' + state.length + ' · rộng ' + state.width + ' · dày ' + state.thickness +
        (state.color !== null ? ' · ' + colorCss(state.color) : '') + ' · khớp ' + state.jointStyle + ' ×' + state.jointSize;
    }
    function loadBoneIntoControls(skipList) {
      var s = getShape(state.bone);
      var j = getJoint(state.bone);
      if (s) {
        state.length = s.length; state.thickness = s.thickness; state.width = (s.width === undefined ? 1 : s.width);
        state.style = s.style; state.color = s.color; state.opacity = s.opacity;
      }
      if (j) { state.jointStyle = j.style; state.jointSize = j.size; state.jointColor = j.color; }
      if (inpLen) inpLen.value = String(state.length);
      if (valLen) valLen.textContent = String(state.length);
      if (inpThick) inpThick.value = String(state.thickness);
      if (valThick) valThick.textContent = String(state.thickness);
      if (inpWidth) inpWidth.value = String(state.width);
      if (valWidth) valWidth.textContent = String(state.width);
      if (inpOp) inpOp.value = String(state.opacity === null ? DEFAULT_OPACITY : state.opacity);
      if (valOp) valOp.textContent = state.opacity === null ? 'mặc định' : String(state.opacity);
      if (selStyle) selStyle.value = state.style;
      if (inpColor) inpColor.value = colorCss(state.color);
      if (selJointStyle) selJointStyle.value = state.jointStyle;
      if (inpJointSize) inpJointSize.value = String(state.jointSize);
      if (valJointSize) valJointSize.textContent = String(state.jointSize);
      if (inpJointColor) inpJointColor.value = colorCss(state.jointColor !== null && state.jointColor !== undefined ? state.jointColor : state.color);
      if (selBone) selBone.value = state.bone;
      refreshPreview();
      /* Đổi 1 xương: chỉ đồng bộ control, không dựng lại danh sách
         (tránh giật khi đang kéo slider); đổi hàng loạt thì dựng lại
         để cập nhật dấu ● customized. */
      if (!skipList) fillBoneList();
    }
    function applyCurrent() {
      var r = setShape(state.bone, currentShape());
      if (!r.ok) notify('warning', 'Bone Shape', r.error);
      refreshPreview();
      fillBoneList();
    }
    function applyJointCurrent() {
      var r = setJoint(state.bone, { style: state.jointStyle, size: state.jointSize, color: state.jointColor });
      if (!r.ok) notify('warning', 'Bone Shape', r.error);
      refreshPreview();
    }
    function fillBones() {
      if (!selBone) return;
      selBone.innerHTML = '';
      var names = BoneShape.listBones();
      if (!names.length) {
        var QR = window.PixiStudio && PixiStudio.ArpQuickRig;
        if (QR && QR.BONE_DEFS) names = QR.BONE_DEFS.map(function (d) { return d.name; });
        else names = ['Hips', 'Spine', 'LeftArm', 'RightArm'];
      }
      names.forEach(function (n) {
        var opt = el('option', { value: n, text: n });
        if (n === state.bone) opt.selected = true;
        selBone.appendChild(opt);
      });
    }
    function fillBoneList() {
      if (!boneListEl) return;
      boneListEl.innerHTML = '';
      var q = state.query.trim().toLowerCase();
      var names = BoneShape.listBones().filter(function (n) {
        if (state.groupFilter !== 'all' && groupOfBone(n) !== state.groupFilter) return false;
        if (q && n.toLowerCase().indexOf(q) === -1 && (GROUP_LABELS[groupOfBone(n)] || '').toLowerCase().indexOf(q) === -1) return false;
        return true;
      });
      if (countEl) countEl.textContent = names.length + ' xương' + (BoneShape.listBones().length ? ' / ' + BoneShape.listBones().length : '');
      if (!names.length) {
        boneListEl.appendChild(el('div', { text: 'Không khớp xương nào — thử đổi từ khóa/nhóm.', style: { color: '#888', fontSize: '12px', padding: '4px' } }));
        return;
      }
      names.forEach(function (n) {
        var e = lookupEntry(n);
        var dot = (e && e.customized) ? ' ●' : '';
        var b = el('button', {
          class: 'btn sm', text: n + ' · ' + (GROUP_LABELS[groupOfBone(n)] || '') + dot,
          style: { margin: '2px', background: n === state.bone ? '#ffe9a8' : '' },
          onclick: function () { state.bone = n; _selectedBone = n; loadBoneIntoControls(); }
        });
        boneListEl.appendChild(b);
      });
    }
    function fillPresetSelect(sel) {
      if (!sel) return;
      var cur = sel.value;
      sel.innerHTML = '';
      listPresets().forEach(function (p) {
        var opt = el('option', { value: p.name, text: p.label + (p.builtin ? '' : ' (riêng)') });
        sel.appendChild(opt);
      });
      if (cur) sel.value = cur;
    }
    function fillLibraryList() {
      if (!libListEl) return;
      libListEl.innerHTML = '';
      var items = listLibrary();
      if (!items.length) {
        libListEl.appendChild(el('div', { text: 'Chưa có mục nào trong thư viện.', style: { color: '#888', fontSize: '12px' } }));
        return;
      }
      items.forEach(function (it) {
        var row = el('div', { style: { display: 'flex', gap: '4px', alignItems: 'center', margin: '2px 0' } });
        row.appendChild(el('span', { text: it.name + ' (' + (it.scope === 'bone' ? 'xương ' + (it.bone || '') : Object.keys(it.shapes || {}).length + ' xương') + ')', style: { flex: '1', fontSize: '12px' } }));
        row.appendChild(el('button', { class: 'btn sm', text: 'Áp', onclick: function () {
          var r = applyLibrary(it.id);
          if (r.ok) { notify('success', 'Bone Shape', 'Đã áp thư viện "' + it.name + '" cho ' + r.applied + ' xương.'); loadBoneIntoControls(); }
          else notify('warning', 'Bone Shape', r.error);
        } }));
        row.appendChild(el('button', { class: 'btn sm', text: 'Xóa', onclick: function () { deleteLibrary(it.id); fillLibraryList(); } }));
        libListEl.appendChild(row);
      });
    }

    /* --- tìm kiếm / lọc --- */
    var rowSearch = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0' } });
    var inpSearch = el('input', { type: 'text', placeholder: 'Tìm xương… (tên/nhóm)', style: { flex: '1' } });
    inpSearch.addEventListener('input', function () { state.query = inpSearch.value; fillBoneList(); });
    var selGroup = el('select', { style: { width: '130px' } });
    selGroup.appendChild(el('option', { value: 'all', text: 'Tất cả nhóm' }));
    GROUPS.forEach(function (g) { selGroup.appendChild(el('option', { value: g, text: GROUP_LABELS[g] })); });
    selGroup.addEventListener('change', function () { state.groupFilter = selGroup.value; fillBoneList(); });
    rowSearch.appendChild(inpSearch);
    rowSearch.appendChild(selGroup);
    wrap.appendChild(rowSearch);
    boneListEl = el('div', { style: { maxHeight: '140px', overflow: 'auto', border: '1px solid #ccc', borderRadius: '6px', padding: '4px', margin: '4px 0' } });
    countEl = el('div', { text: '', style: { fontSize: '12px', color: '#888' } });
    wrap.appendChild(countEl);
    wrap.appendChild(boneListEl);

    /* --- xem trước --- */
    var rowPrev = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '6px 0' } });
    previewCanvas = el('canvas', { width: '120', height: '90', style: { border: '1px solid #ccc', borderRadius: '6px', background: '#101828' } });
    previewCanvas.width = 120; previewCanvas.height = 90;
    rowPrev.appendChild(previewCanvas);
    previewLabel = el('div', { text: '', style: { flex: '1', fontSize: '12px' } });
    rowPrev.appendChild(previewLabel);
    wrap.appendChild(rowPrev);

    /* dropdown xương + nút Hiện xương */
    var rowBone = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0' } });
    rowBone.appendChild(el('span', { text: 'Xương', style: { width: '90px' } }));
    selBone = el('select', { style: { flex: '1' } });
    selBone.addEventListener('change', function () { state.bone = selBone.value; _selectedBone = state.bone; loadBoneIntoControls(); });
    rowBone.appendChild(selBone);
    rowBone.appendChild(el('button', { class: 'btn sm', text: 'Hiện xương', onclick: function () {
      var r = buildBoneShapes(getTarget());
      if (!r.ok) notify('warning', 'Bone Shape', r.error);
      else { fillBones(); loadBoneIntoControls(); notify('success', 'Bone Shape', 'Đã hiện ' + r.boneCount + ' xương (mesh riêng, SkeletonHelper gốc không đổi).'); }
    } }));
    wrap.appendChild(rowBone);

    var mkSlider = function (label, min, max, step, get, set, fmt) {
      var row = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0' } });
      row.appendChild(el('span', { text: label, style: { width: '90px' } }));
      var inp = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()), style: { flex: '1' } });
      var valEl = el('span', { text: fmt ? fmt(get()) : String(get()), style: { width: '52px', fontSize: '12px' } });
      inp.addEventListener('input', function () { var v = parseFloat(inp.value); set(v); valEl.textContent = fmt ? fmt(v) : String(v); refreshPreview(); });
      inp.addEventListener('change', function () { applyCurrent(); });
      row.appendChild(inp); row.appendChild(valEl);
      return { row: row, inp: inp, valEl: valEl };
    };
    var sLen = mkSlider('Length', 0.1, 4, 0.05, function () { return state.length; }, function (v) { state.length = v; });
    inpLen = sLen.inp; valLen = sLen.valEl; wrap.appendChild(sLen.row);
    var sThick = mkSlider('Thickness', 0.1, 5, 0.05, function () { return state.thickness; }, function (v) { state.thickness = v; });
    inpThick = sThick.inp; valThick = sThick.valEl; wrap.appendChild(sThick.row);
    var sWidth = mkSlider('Width (rộng)', 0.1, 5, 0.05, function () { return state.width; }, function (v) { state.width = v; });
    inpWidth = sWidth.inp; valWidth = sWidth.valEl; wrap.appendChild(sWidth.row);
    var sOp = mkSlider('Opacity', 0.05, 1, 0.05,
      function () { return state.opacity === null ? DEFAULT_OPACITY : state.opacity; },
      function (v) { state.opacity = v; },
      function (v) { return state.opacity === null ? 'mặc định' : String(v); });
    inpOp = sOp.inp; valOp = sOp.valEl; wrap.appendChild(sOp.row);

    /* style + màu */
    var rowStyle = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0' } });
    rowStyle.appendChild(el('span', { text: 'Style', style: { width: '90px' } }));
    selStyle = el('select', { style: { flex: '1' } });
    STYLES.forEach(function (s) {
      var opt = el('option', { value: s, text: s });
      if (s === state.style) opt.selected = true;
      selStyle.appendChild(opt);
    });
    selStyle.addEventListener('change', function () { state.style = selStyle.value; applyCurrent(); });
    rowStyle.appendChild(selStyle);
    wrap.appendChild(rowStyle);
    var rowColor = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0' } });
    rowColor.appendChild(el('span', { text: 'Màu xương', style: { width: '90px' } }));
    inpColor = el('input', { type: 'color', value: '#66ff99', style: { width: '48px', height: '28px', padding: '0' } });
    inpColor.addEventListener('input', function () { state.color = parseColor(inpColor.value); refreshPreview(); });
    inpColor.addEventListener('change', function () { applyCurrent(); });
    rowColor.appendChild(inpColor);
    rowColor.appendChild(el('button', { class: 'btn sm', text: 'Mặc định', onclick: function () { state.color = null; state.opacity = null; inpColor.value = '#66ff99'; applyCurrent(); loadBoneIntoControls(); } }));
    rowColor.appendChild(el('span', { text: 'Màu/opacity riêng từng xương; màu nhóm ở mục Hàng loạt.', style: { fontSize: '11px', color: '#888', flex: '1' } }));
    wrap.appendChild(rowColor);

    /* khớp */
    wrap.appendChild(el('div', { html: '<b>Khớp (joint)</b>', style: { margin: '8px 0 2px' } }));
    var rowJoint = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0' } });
    rowJoint.appendChild(el('span', { text: 'Hình khớp', style: { width: '90px' } }));
    selJointStyle = el('select', { style: { flex: '1' } });
    JOINT_STYLES.forEach(function (s) { selJointStyle.appendChild(el('option', { value: s, text: s })); });
    selJointStyle.addEventListener('change', function () { state.jointStyle = selJointStyle.value; applyJointCurrent(); });
    rowJoint.appendChild(selJointStyle);
    inpJointColor = el('input', { type: 'color', value: '#66ff99', style: { width: '48px', height: '28px', padding: '0' } });
    inpJointColor.addEventListener('input', function () { state.jointColor = parseColor(inpJointColor.value); refreshPreview(); });
    inpJointColor.addEventListener('change', function () { applyJointCurrent(); });
    rowJoint.appendChild(inpJointColor);
    wrap.appendChild(rowJoint);
    var sJoint = mkSlider('Cỡ khớp', 0.2, 4, 0.1, function () { return state.jointSize; }, function (v) { state.jointSize = v; });
    inpJointSize = sJoint.inp; valJointSize = sJoint.valEl;
    sJoint.inp.addEventListener('change', function () { applyJointCurrent(); });
    wrap.appendChild(sJoint.row);

    /* mirror */
    var rowMirror = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' } });
    var mirrorChk = el('input', { type: 'checkbox' });
    mirrorChk.checked = BoneShape.mirror;
    mirrorChk.addEventListener('change', function () { BoneShape.mirror = !!mirrorChk.checked; });
    rowMirror.appendChild(mirrorChk);
    rowMirror.appendChild(el('span', { text: 'Mirror (trái ↔ phải)' }));
    var selMirrorGroup = el('select', {});
    GROUPS.forEach(function (g) { selMirrorGroup.appendChild(el('option', { value: g, text: GROUP_LABELS[g] })); });
    rowMirror.appendChild(selMirrorGroup);
    rowMirror.appendChild(el('button', { class: 'btn sm', text: 'Mirror nhóm L→R', onclick: function () {
      var r = mirrorGroup(selMirrorGroup.value, 'L2R');
      if (r.ok) notify('success', 'Bone Shape', 'Đã mirror ' + r.mirrored + ' xương nhóm ' + (GROUP_LABELS[selMirrorGroup.value] || ''));
      else notify('warning', 'Bone Shape', r.error);
      loadBoneIntoControls();
    } }));
    rowMirror.appendChild(el('button', { class: 'btn sm', text: 'Kiểm tra đối xứng', onclick: function () {
      var r = checkSymmetry();
      if (!r.ok) { if (symResult) symResult.textContent = r.error; return; }
      if (symResult) symResult.textContent = 'Đối xứng: ' + r.matched + '/' + r.pairs + ' cặp khớp (' + r.score + '%)' +
        (r.mismatched.length ? ' — lệch: ' + r.mismatched.slice(0, 5).map(function (m) { return m.left + '↔' + m.right + ' (' + m.fields.join(',') + ')'; }).join('; ') : ' — mọi cặp đều khớp.');
    } }));
    wrap.appendChild(rowMirror);
    symResult = el('div', { text: '', style: { fontSize: '12px', color: '#555' } });
    wrap.appendChild(symResult);

    /* preset */
    wrap.appendChild(el('div', { html: '<b>Preset phong cách</b>', style: { margin: '8px 0 2px' } }));
    var rowPreset = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0', flexWrap: 'wrap' } });
    var selPreset = el('select', { style: { flex: '1', minWidth: '140px' } });
    fillPresetSelect(selPreset);
    rowPreset.appendChild(selPreset);
    rowPreset.appendChild(el('button', { class: 'btn sm', text: 'Áp preset', onclick: function () {
      var r = applyPreset(selPreset.value);
      if (r.ok) { notify('success', 'Bone Shape', 'Đã áp preset "' + r.label + '" cho ' + r.applied + ' xương.'); loadBoneIntoControls(); }
      else notify('warning', 'Bone Shape', r.error);
    } }));
    var inpPresetName = el('input', { type: 'text', placeholder: 'Tên preset riêng…', style: { width: '130px' } });
    rowPreset.appendChild(inpPresetName);
    rowPreset.appendChild(el('button', { class: 'btn sm', text: 'Lưu preset', onclick: function () {
      var r = savePreset(inpPresetName.value, { shape: currentShape(), joint: { style: state.jointStyle, size: state.jointSize, color: state.jointColor } });
      if (r.ok) { notify('success', 'Bone Shape', 'Đã lưu preset "' + r.name + '".'); fillPresetSelect(selPreset); selPreset.value = r.name; }
      else notify('warning', 'Bone Shape', r.error);
    } }));
    rowPreset.appendChild(el('button', { class: 'btn sm', text: 'Xóa preset', onclick: function () {
      var r = deletePreset(selPreset.value);
      if (r.ok) { notify('info', 'Bone Shape', 'Đã xóa preset.'); fillPresetSelect(selPreset); }
      else notify('warning', 'Bone Shape', r.error);
    } }));
    wrap.appendChild(rowPreset);

    /* thư viện */
    wrap.appendChild(el('div', { html: '<b>Thư viện hình xương</b>', style: { margin: '8px 0 2px' } }));
    var rowLib = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0', flexWrap: 'wrap' } });
    var inpLibName = el('input', { type: 'text', placeholder: 'Tên hình…', style: { flex: '1', minWidth: '110px' } });
    var selLibScope = el('select', {});
    selLibScope.appendChild(el('option', { value: 'bone', text: 'Xương đang chọn' }));
    selLibScope.appendChild(el('option', { value: 'rig', text: 'Cả rig' }));
    rowLib.appendChild(inpLibName);
    rowLib.appendChild(selLibScope);
    rowLib.appendChild(el('button', { class: 'btn sm', text: 'Lưu vào thư viện', onclick: function () {
      var r = saveToLibrary(inpLibName.value, selLibScope.value, state.bone);
      if (r.ok) { notify('success', 'Bone Shape', 'Đã lưu "' + r.name + '" (' + r.bones + ' xương).'); fillLibraryList(); }
      else notify('warning', 'Bone Shape', r.error);
    } }));
    wrap.appendChild(rowLib);
    libListEl = el('div', { style: { margin: '2px 0' } });
    wrap.appendChild(libListEl);
    fillLibraryList();

    /* hàng loạt */
    wrap.appendChild(el('div', { html: '<b>Hàng loạt</b>', style: { margin: '8px 0 2px' } }));
    var rowBatch = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0', flexWrap: 'wrap' } });
    var selBatchGroup = el('select', {});
    GROUPS.forEach(function (g) { selBatchGroup.appendChild(el('option', { value: g, text: GROUP_LABELS[g] })); });
    rowBatch.appendChild(selBatchGroup);
    rowBatch.appendChild(el('button', { class: 'btn sm', text: 'Áp hình hiện tại cho nhóm', onclick: function () {
      var r = applyToGroup(selBatchGroup.value, currentShape());
      if (r.ok) { notify('success', 'Bone Shape', 'Đã áp cho ' + r.applied + ' xương nhóm ' + (GROUP_LABELS[selBatchGroup.value] || '')); loadBoneIntoControls(); }
      else notify('warning', 'Bone Shape', r.error);
    } }));
    rowBatch.appendChild(el('button', { class: 'btn sm', text: 'Màu nhóm', onclick: function () {
      var r = setGroupColor(selBatchGroup.value, inpColor.value);
      if (r.ok) { notify('success', 'Bone Shape', 'Đã đổi màu ' + r.applied + ' xương.'); loadBoneIntoControls(); }
      else notify('warning', 'Bone Shape', r.error);
    } }));
    rowBatch.appendChild(el('button', { class: 'btn sm', text: 'Reset nhóm', onclick: function () {
      var r = resetGroup(selBatchGroup.value);
      if (r.ok) loadBoneIntoControls();
      else notify('warning', 'Bone Shape', r.error);
    } }));
    wrap.appendChild(rowBatch);
    var rowCopy = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0', flexWrap: 'wrap' } });
    rowCopy.appendChild(el('span', { text: 'Copy hình:', style: { fontSize: '12px' } }));
    var selCopyFrom = el('select', { style: { flex: '1' } });
    var selCopyTo = el('select', { style: { flex: '1' } });
    [selCopyFrom, selCopyTo].forEach(function (sel) {
      BoneShape.listBones().forEach(function (n) { sel.appendChild(el('option', { value: n, text: n })); });
    });
    rowCopy.appendChild(selCopyFrom);
    rowCopy.appendChild(el('span', { text: '→' }));
    rowCopy.appendChild(selCopyTo);
    rowCopy.appendChild(el('button', { class: 'btn sm', text: 'Copy', onclick: function () {
      var r = copyShape(selCopyFrom.value, selCopyTo.value);
      if (r.ok) { notify('success', 'Bone Shape', 'Đã copy hình ' + r.from + ' → ' + r.to + '.'); loadBoneIntoControls(); }
      else notify('warning', 'Bone Shape', r.error);
    } }));
    wrap.appendChild(rowCopy);

    /* xuất / nhập JSON + undo */
    wrap.appendChild(el('div', { html: '<b>Lưu / Xuất</b>', style: { margin: '8px 0 2px' } }));
    var rowIO = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '3px 0' } });
    rowIO.appendChild(el('button', { class: 'btn sm', text: 'Tải JSON', onclick: function () {
      var r = downloadJSON();
      if (!r.ok) notify('warning', 'Bone Shape', r.error);
    } }));
    var fileInput = el('input', { type: 'file', accept: '.json,application/json', style: { fontSize: '12px' } });
    fileInput.addEventListener('change', function () {
      try {
        var f = fileInput.files && fileInput.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          var r = fromJSON(String(reader.result || ''));
          if (r.ok) { notify('success', 'Bone Shape', 'Đã nhập JSON: ' + r.applied + ' xương' + (r.skipped.length ? ', bỏ qua ' + r.skipped.length : '') + '.'); loadBoneIntoControls(); }
          else notify('warning', 'Bone Shape', r.error);
        };
        reader.readAsText(f);
      } catch (e) { notify('warning', 'Bone Shape', 'Không đọc được file: ' + (e && e.message)); }
    });
    rowIO.appendChild(fileInput);
    rowIO.appendChild(el('span', { text: 'FBX: không xuất kèm hình xương được (writer bỏ qua mesh isBoneVisual) — xem ghi chú đầu file.', style: { fontSize: '11px', color: '#888', flex: '1' } }));
    wrap.appendChild(rowIO);
    var rowUndo = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '6px 0' } });
    var btnUndo = el('button', { class: 'btn sm', text: '⟲ Hoàn tác', onclick: function () { var r = undo(); if (r.ok) loadBoneIntoControls(); else notify('info', 'Bone Shape', r.error); } });
    var btnRedo = el('button', { class: 'btn sm', text: '⟳ Làm lại', onclick: function () { var r = redo(); if (r.ok) loadBoneIntoControls(); else notify('info', 'Bone Shape', r.error); } });
    rowUndo.appendChild(btnUndo);
    rowUndo.appendChild(btnRedo);
    rowUndo.appendChild(el('span', { text: 'Hoàn tác riêng cho Bone Shape (25 bước) — không dùng chung History pose của Quick Rig.', style: { fontSize: '11px', color: '#888', flex: '1' } }));
    wrap.appendChild(rowUndo);

    /* nút cũ */
    var btnRow = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '6px 0' } });
    btnRow.appendChild(el('button', { class: 'btn sm', text: 'Reset', onclick: function () { reset(); loadBoneIntoControls(); } }));
    btnRow.appendChild(el('button', { class: 'btn sm', text: 'Reset xương này', onclick: function () { resetBone(state.bone); loadBoneIntoControls(); } }));
    btnRow.appendChild(el('button', { class: 'btn sm', text: 'Bật/tắt hiển thị xương', onclick: function () { setVisible(); } }));
    btnRow.appendChild(el('button', { class: 'btn sm', text: 'Cập nhật vị trí xương', onclick: function () { refresh(); } }));
    wrap.appendChild(btnRow);
    container.appendChild(wrap);
    fillBones();
    loadBoneIntoControls();
    /* Bấm chọn xương trong viewport → panel nhảy tới xương đó. */
    BoneShape._setUiJump(function (boneName) {
      state.bone = boneName;
      _selectedBone = boneName;
      loadBoneIntoControls();
    });
    /* Hình đổi từ API/preset/module khác → panel tự đồng bộ control. */
    _panelRefresh = function (d) {
      if (!d) return;
      var bulk = ['preset', 'all', 'group', 'reset-all', 'reset-group', 'library', 'import-json', 'undo', 'redo', 'mirror-group', 'joint-group'].indexOf(d.kind) >= 0;
      loadBoneIntoControls(!bulk);
    };
  }
  BoneShape.renderTab = renderBoneShapeTab;

  BoneShape._test = {
    mirrorName: mirrorName, makeGeometry: makeGeometry, makeJointGeometry: makeJointGeometry,
    STYLES: STYLES, JOINT_STYLES: JOINT_STYLES, stripName: stripName,
    groupOfBone: groupOfBone, parseColor: parseColor, colorCss: colorCss,
    drawPreview: drawPreview, captureAll: _captureAll, restoreAll: _restoreAll,
    loadCustomPresets: _loadCustomPresets, loadLibrary: _loadLibrary,
    DEFAULT_COLOR: DEFAULT_COLOR, DEFAULT_OPACITY: DEFAULT_OPACITY
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpBoneShape = BoneShape;
  if (window.PixiStudio.ArpPanel && typeof PixiStudio.ArpPanel.registerTab === 'function') {
    try { PixiStudio.ArpPanel.registerTab('boneshape', 'Bone Shape', renderBoneShapeTab); } catch (e) {}
  }
})();
