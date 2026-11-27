/* ============================================================
 * rig/arp-constraints.js — BONE CONSTRAINT SYSTEM (Auto Rig Pro
 * Blend — NHÓM 3, vòng Rig mở rộng)
 *
 * Hệ constraint chạy mỗi frame, áp SAU animation mixer (hook 1 dòng
 * trong App.startLoop — js/core/app.js — sau ArpVpTrails.update, trước
 * render) nên ghi đè đúng pose mixer vừa viết, không phá clip gốc.
 *
 *   8 loại constraint (stack theo thứ tự mảng — constraint sau ghi
 *   đè trước, cùng xương):
 *     fk             — FK mặc định: no-op, giữ nguyên pose (đánh dấu
 *                       xương do FK điều khiển; weight không có tác
 *                       dụng, vẫn liệt kê để rõ ý đồ).
 *     ik             — IK: bọc lại AdvIK.solveLimbIK 2-bone có sẵn
 *                       (KHÔNG viết solver mới). Chỉ chạy khi
 *                       AdvIK blend của chi đó > 0; weight trộn
 *                       nghiệm IK với pose trước đó.
 *     copy-rotation  — copy quaternion local (mặc định) hoặc world
 *                       của xương nguồn, invert từng trục, trộn
 *                       slerp theo weight.
 *     copy-location  — copy vị trí world của nguồn về local (+offset),
 *                       trộn lerp theo weight.
 *     limit-rotation — clamp Euler local từng trục X/Y/Z (độ).
 *     limit-location — clamp vị trí local từng trục (m).
 *     damped-track   — xương hướng trục +Y về target; hệ số
 *                       k = weight·(1−exp(−damp·dt)) (dt≤0 → k=weight).
 *     stretch-to     — hướng +Y về target + scale Y để đầu xương
 *                       (xương con) chạm target, kẹp ở maxStretch.
 *
 * CHỐNG TÍCH LŨY: đầu mỗi update() chụp "base pose" (quaternion /
 * position / scale local) của mọi xương bị constraint, mọi phép
 * tính xuất phát từ base đó → weight=0 hoặc tắt constraint thì
 * pose về đúng như cũ (nhờ freePose: pose lúc xương không bị
 * constraint, ghi lại mỗi frame và khôi phục khi xương vừa hết
 * constraint), gọi update() 100 lần cũng không trôi.
 *
 * LƯU: danh sách constraint theo rig (JSON, localStorage key
 * pixistudio.arp-constraints-v1) + xuất/nhập JSON.
 * UI: đăng ký section 'constraints' vào tab Quick Rig qua
 * ArpQuickRig.registerSection (chọn xương → liệt kê / thêm / xóa /
 * bật-tắt / đổi thứ tự / slider weight).
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Chạy trên CPU mỗi frame (O(constraint × updateMatrixWorld));
 *     stack vài chục constraint trên rig 41 xương vẫn nhẹ, nhưng
 *     không có GPU/caching như constraint engine của Blender.
 *   • Damped Track chỉ là tiệm cận hàm mũ, KHÔNG có quán tính /
 *     lò xo thật: khi clip đang phát, mixer viết lại pose mỗi frame
 *     nên điểm xuất phát mỗi frame là pose clip (vẫn mượt, nhưng
 *     không "trễ" qua nhiều frame như spring thật).
 *   • Limit Rotation clamp Euler (thứ tự XYZ) — gần đúng khi xoay
 *     lớn / gần gimbal lock, không phải clamp quaternion thật.
 *   • Stretch To giả định xương con nằm dọc trục +Y local của xương
 *     (đúng skeleton Mixamo/AutoRigPro); skeleton có trục xương
 *     khác thì hướng duỗi lệch.
 *   • IK chỉ là 2-bone AdvIK có sẵn (vai-khuỷu-tay, hông-gối-chân),
 *     không phải FABRIK/CCD nhiều khớp.
 * ============================================================ */
(function () {
  'use strict';

  var QR = (window.PixiStudio && PixiStudio.ArpQuickRig) || null;
  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };
  var T = window.THREE;

  var STORAGE_KEY = 'pixistudio.arp-constraints-v1';

  /* ---------- loại constraint ---------- */
  var TYPES = {
    'fk':             { label: 'FK (mặc định)', needsTarget: false },
    'ik':             { label: 'IK (2-bone AdvIK)', needsTarget: true },
    'copy-rotation':  { label: 'Copy Rotation', needsTarget: true },
    'copy-location':  { label: 'Copy Location', needsTarget: true },
    'limit-rotation': { label: 'Limit Rotation', needsTarget: false },
    'limit-location': { label: 'Limit Location', needsTarget: false },
    'damped-track':   { label: 'Damped Track', needsTarget: true },
    'stretch-to':     { label: 'Stretch To', needsTarget: true }
  };

  var _idSeq = 0;
  function nextId() { _idSeq++; return 'c' + Date.now().toString(36) + '_' + _idSeq; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function stripName(n) {
    n = String(n || '');
    var i = n.lastIndexOf(':');
    if (i >= 0) n = n.slice(i + 1);
    /* FBXLoader bỏ dấu ':' → 'mixamorigLeftArm' (không còn 'mixamorig:'). */
    if (/^mixamorig/i.test(n)) n = n.slice('mixamorig'.length);
    return n;
  }
  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message, duration: 8000 }); } catch (e) {}
  }

  /* ---------- state ---------- */
  var state = {
    enabled: true,      /* công tắc tổng */
    rigRoot: null,      /* Object3D gốc của rig đang gắn */
    rigName: '',
    list: [],           /* stack constraint, thứ tự mảng = thứ tự áp dụng */
    freePose: {},       /* pose lúc xương KHÔNG bị constraint (key: tên strip) */
    activeBones: {}     /* xương có constraint đang chạy ở update trước */
  };

  function getAdvIK() {
    try { return (window.PixiStudio && PixiStudio.ArpQuickRig && PixiStudio.ArpQuickRig.AdvIK) || null; } catch (e) { return null; }
  }
  function getQRCurrent() {
    try { return (window.PixiStudio && PixiStudio.ArpQuickRig && PixiStudio.ArpQuickRig.current) || null; } catch (e) { return null; }
  }

  /* ---------- tìm xương / object ---------- */
  function collectBones(root) {
    var out = [];
    if (!root) return out;
    root.traverse(function (o) { if (o.isBone) out.push(o); });
    return out;
  }
  function findBone(root, name) {
    if (!root || !name) return null;
    var want = stripName(name).toLowerCase();
    var found = null;
    root.traverse(function (o) {
      if (!found && o.isBone && stripName(o.name).toLowerCase() === want) found = o;
    });
    return found;
  }
  function findObject(root, name) {
    if (!root || !name) return null;
    var bone = findBone(root, name);
    if (bone) return bone;
    var want = stripName(name).toLowerCase();
    var found = null;
    root.traverse(function (o) {
      if (!found && stripName(o.name).toLowerCase() === want) found = o;
    });
    if (found) return found;
    /* control / pole của Quick Rig (không nằm dưới rigRoot) */
    var cur = getQRCurrent();
    if (cur) {
      var pools = [cur.controls, cur.poles];
      for (var i = 0; i < pools.length; i++) {
        var pool = pools[i];
        if (!pool) continue;
        if (pool[name] && pool[name].isObject3D) return pool[name];
        var keys = Object.keys(pool);
        for (var k = 0; k < keys.length; k++) {
          var v = pool[keys[k]];
          if (v && v.isObject3D && stripName(v.name || keys[k]).toLowerCase() === want) return v;
        }
      }
    }
    return null;
  }
  function firstChildBone(bone) {
    if (!bone || !bone.children) return null;
    for (var i = 0; i < bone.children.length; i++) {
      if (bone.children[i].isBone) return bone.children[i];
    }
    return null;
  }

  /* ---------- gắn rig ---------- */
  function attach(root, opts) {
    opts = opts || {};
    if (!root || !root.isObject3D) return { ok: false, error: 'attach cần Object3D gốc của rig.' };
    state.rigRoot = root;
    state.rigName = opts.name || root.name || 'rig';
    if (opts.load !== false) load(state.rigName);
    try { root.updateMatrixWorld(true); } catch (e) {}
    /* freePose khởi đầu = pose lúc gắn rig (thường là bind/T-pose). */
    collectBones(root).forEach(function (b) {
      state.freePose[stripName(b.name)] = { q: b.quaternion.clone(), p: b.position.clone(), s: b.scale.clone() };
    });
    return { ok: true, rigName: state.rigName, bones: collectBones(root).length };
  }
  function autoAttach() {
    if (state.rigRoot) return true;
    var cur = getQRCurrent();
    if (cur && cur.target && cur.target.isObject3D) {
      attach(cur.target, { name: (cur.name || cur.target.name || 'quickrig') });
      return true;
    }
    return false;
  }

  /* ---------- tạo / sửa / xóa constraint ---------- */
  function defaultsFor(type) {
    switch (type) {
      case 'copy-rotation': return { space: 'local', invert: { x: false, y: false, z: false } };
      case 'copy-location': return { space: 'world', offset: { x: 0, y: 0, z: 0 } };
      case 'limit-rotation': return { min: { x: -180, y: -180, z: -180 }, max: { x: 180, y: 180, z: 180 } };
      case 'limit-location': return { min: { x: null, y: null, z: null }, max: { x: null, y: null, z: null } };
      case 'damped-track': return { damp: 8 };
      case 'stretch-to': return { maxStretch: 1.5, restLength: null };
      case 'ik': return { limbKey: null, stretchy: false, maxStretch: 1.3 };
      default: return {};
    }
  }
  function addConstraint(spec) {
    spec = spec || {};
    if (!TYPES[spec.type]) return { ok: false, error: 'Loại constraint không hỗ trợ: ' + spec.type };
    if (!spec.bone) return { ok: false, error: 'Constraint cần xương đích (bone).' };
    if (TYPES[spec.type].needsTarget && !spec.target && !spec.targetPos) {
      return { ok: false, error: 'Loại ' + spec.type + ' cần target (xương/control) hoặc targetPos.' };
    }
    var c = {
      id: spec.id || nextId(),
      type: spec.type,
      bone: String(spec.bone),
      target: spec.target ? String(spec.target) : null,
      targetPos: spec.targetPos ? { x: +spec.targetPos.x || 0, y: +spec.targetPos.y || 0, z: +spec.targetPos.z || 0 } : null,
      enabled: spec.enabled !== false,
      weight: clamp(typeof spec.weight === 'number' ? spec.weight : 1, 0, 1)
    };
    var d = defaultsFor(spec.type);
    Object.keys(d).forEach(function (k) {
      c[k] = (spec[k] !== undefined) ? spec[k] : d[k];
    });
    /* stretch-to: đo restLength lúc tạo (khoảng cách tới xương con) */
    if (c.type === 'stretch-to' && (c.restLength === null || c.restLength === undefined)) {
      var bone = state.rigRoot ? findBone(state.rigRoot, c.bone) : null;
      if (bone) {
        var child = firstChildBone(bone);
        if (child) {
          try {
            bone.updateWorldMatrix(true, false);
            var bp = new T.Vector3().setFromMatrixPosition(bone.matrixWorld);
            var cp = new T.Vector3().setFromMatrixPosition(child.matrixWorld);
            c.restLength = Math.max(0.001, bp.distanceTo(cp));
          } catch (e) { c.restLength = 0.3; }
        } else c.restLength = 0.3;
      } else c.restLength = 0.3;
    }
    state.list.push(c);
    return { ok: true, constraint: c };
  }
  function getConstraint(id) {
    for (var i = 0; i < state.list.length; i++) if (state.list[i].id === id) return state.list[i];
    return null;
  }
  function removeConstraint(id) {
    for (var i = 0; i < state.list.length; i++) {
      if (state.list[i].id === id) { state.list.splice(i, 1); return { ok: true }; }
    }
    return { ok: false, error: 'Không thấy constraint ' + id };
  }
  function moveConstraint(id, dir) {
    var i;
    for (i = 0; i < state.list.length; i++) if (state.list[i].id === id) break;
    if (i >= state.list.length) return { ok: false, error: 'Không thấy constraint ' + id };
    var j = i + dir;
    if (j < 0 || j >= state.list.length) return { ok: false, error: 'Đã ở đầu/cuối stack.' };
    var tmp = state.list[i]; state.list[i] = state.list[j]; state.list[j] = tmp;
    return { ok: true };
  }
  function setEnabled(id, on) {
    var c = getConstraint(id);
    if (!c) return { ok: false, error: 'Không thấy constraint ' + id };
    c.enabled = !!on; return { ok: true };
  }
  function setWeight(id, w) {
    var c = getConstraint(id);
    if (!c) return { ok: false, error: 'Không thấy constraint ' + id };
    c.weight = clamp(+w || 0, 0, 1); return { ok: true };
  }
  function constraintsFor(boneName) {
    var want = stripName(boneName).toLowerCase();
    return state.list.filter(function (c) { return stripName(c.bone).toLowerCase() === want; });
  }
  function clearAll() { state.list = []; return { ok: true }; }

  /* ---------- lưu / tải ---------- */
  function toJSON() {
    return { rig: state.rigName, version: 1, constraints: JSON.parse(JSON.stringify(state.list)) };
  }
  function fromJSON(data) {
    if (!data) return { ok: false, error: 'Không có dữ liệu JSON.' };
    var arr = Array.isArray(data) ? data : data.constraints;
    if (!Array.isArray(arr)) return { ok: false, error: 'JSON constraint phải là mảng hoặc {constraints:[...]}.' };
    var kept = [], dropped = 0;
    state.list = [];
    arr.forEach(function (spec) {
      var r = addConstraint(spec);
      if (r.ok) kept.push(r.constraint); else dropped++;
    });
    return { ok: true, loaded: kept.length, dropped: dropped };
  }
  function save() {
    try {
      var store = {};
      try { store = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (e) { store = {}; }
      store[state.rigName || 'rig'] = toJSON();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return { ok: true, count: state.list.length };
    } catch (e) { return { ok: false, error: 'Lưu localStorage lỗi: ' + e.message }; }
  }
  function load(rigName) {
    try {
      var store = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
      var data = store[rigName || state.rigName || 'rig'];
      if (!data) return { ok: false, error: 'Chưa có constraint đã lưu cho rig này.' };
      return fromJSON(data);
    } catch (e) { return { ok: false, error: 'Đọc localStorage lỗi: ' + e.message }; }
  }

  /* ---------- toán phụ (pure, test được) ---------- */
  function dampedFactor(damp, dt, weight) {
    if (!(dt > 0)) return clamp(weight, 0, 1);
    return clamp(weight, 0, 1) * (1 - Math.exp(-(damp || 8) * dt));
  }
  function stretchScale(restLen, dist, maxStretch) {
    if (!(restLen > 0)) return 1;
    return clamp(dist / restLen, 1, maxStretch > 1 ? maxStretch : 1.5);
  }
  /* Slerp 2 vector đơn vị (giữ đúng góc: t=0.5 → nửa góc). Slerp
     quaternion trực tiếp KHÔNG chia đôi đúng góc hướng khi quaternion
     hiện tại có twist quanh trục xương. */
  function slerpVec(a, b, t) {
    var dot = clamp(a.dot(b), -1, 1);
    if (dot > 0.999999) return b.clone();
    if (dot < -0.999999) {
      /* đối nhau: xoay quanh 1 trục vuông góc tùy ý */
      var axis = new T.Vector3(1, 0, 0);
      if (Math.abs(a.x) > 0.9) axis.set(0, 1, 0);
      var perp = new T.Vector3().crossVectors(a, axis).normalize();
      return a.clone().applyAxisAngle(perp, Math.PI * t);
    }
    var ang = Math.acos(dot);
    var s = Math.sin(ang);
    var w1 = Math.sin((1 - t) * ang) / s;
    var w2 = Math.sin(t * ang) / s;
    return new T.Vector3(
      a.x * w1 + b.x * w2,
      a.y * w1 + b.y * w2,
      a.z * w1 + b.z * w2
    );
  }
  function clampEulerDeg(euler, minDeg, maxDeg) {
    return {
      x: T.MathUtils.degToRad(clamp(T.MathUtils.radToDeg(euler.x), minDeg.x, maxDeg.x)),
      y: T.MathUtils.degToRad(clamp(T.MathUtils.radToDeg(euler.y), minDeg.y, maxDeg.y)),
      z: T.MathUtils.degToRad(clamp(T.MathUtils.radToDeg(euler.z), minDeg.z, maxDeg.z))
    };
  }

  var _v1 = null, _v2 = null, _q1 = null, _q2 = null;
  function tmp() {
    if (!_v1) {
      _v1 = new T.Vector3(); _v2 = new T.Vector3();
      _q1 = new T.Quaternion(); _q2 = new T.Quaternion();
    }
    return { v1: _v1, v2: _v2, q1: _q1, q2: _q2 };
  }

  /* ---------- áp 1 constraint lên xương (bone đã ở base pose) ---------- */
  function targetWorldPos(c, root) {
    if (c.targetPos) return new T.Vector3(c.targetPos.x, c.targetPos.y, c.targetPos.z);
    var obj = findObject(root, c.target);
    if (!obj) return null;
    return new T.Vector3().setFromMatrixPosition(obj.matrixWorld);
  }
  function parentWorldQuat(bone) {
    var q = new T.Quaternion();
    if (bone.parent) { try { bone.parent.getWorldQuaternion(q); } catch (e) { q.identity(); } }
    return q;
  }
  function applyOne(c, bone, root, dt, base) {
    var t = tmp();
    switch (c.type) {
      case 'fk':
        return { ok: true, note: 'fk-passthrough' };
      case 'copy-rotation': {
        var src = findBone(root, c.target) || findObject(root, c.target);
        if (!src) return { ok: false, error: 'Không thấy xương nguồn ' + c.target };
        var srcQ;
        if ((c.space || 'local') === 'world') {
          srcQ = new T.Quaternion();
          try { src.getWorldQuaternion(srcQ); } catch (e) { return { ok: false, error: 'Không đọc được world quat nguồn.' }; }
          srcQ = parentWorldQuat(bone).clone().invert().multiply(srcQ);
        } else {
          srcQ = src.quaternion.clone();
        }
        if (c.invert && (c.invert.x || c.invert.y || c.invert.z)) {
          var e = new T.Euler().setFromQuaternion(srcQ, 'XYZ');
          if (c.invert.x) e.x = -e.x;
          if (c.invert.y) e.y = -e.y;
          if (c.invert.z) e.z = -e.z;
          srcQ = new T.Quaternion().setFromEuler(e);
        }
        bone.quaternion.slerp(srcQ, c.weight);
        return { ok: true };
      }
      case 'copy-location': {
        var sp = targetWorldPos(c, root);
        if (!sp) return { ok: false, error: 'Không thấy target ' + c.target };
        var local = sp.clone();
        if (bone.parent) {
          try { bone.parent.worldToLocal(local); } catch (e) { return { ok: false, error: 'worldToLocal lỗi.' }; }
        }
        if (c.offset) { local.x += (+c.offset.x || 0); local.y += (+c.offset.y || 0); local.z += (+c.offset.z || 0); }
        bone.position.lerp(local, c.weight);
        return { ok: true };
      }
      case 'limit-rotation': {
        var eu = new T.Euler().setFromQuaternion(bone.quaternion, 'XYZ');
        var cl = clampEulerDeg(eu, c.min || { x: -180, y: -180, z: -180 }, c.max || { x: 180, y: 180, z: 180 });
        bone.quaternion.setFromEuler(new T.Euler(cl.x, cl.y, cl.z, 'XYZ'));
        return { ok: true };
      }
      case 'limit-location': {
        var mn = c.min || {}, mx = c.max || {};
        if (mn.x !== null && mn.x !== undefined) bone.position.x = Math.max(bone.position.x, +mn.x);
        if (mn.y !== null && mn.y !== undefined) bone.position.y = Math.max(bone.position.y, +mn.y);
        if (mn.z !== null && mn.z !== undefined) bone.position.z = Math.max(bone.position.z, +mn.z);
        if (mx.x !== null && mx.x !== undefined) bone.position.x = Math.min(bone.position.x, +mx.x);
        if (mx.y !== null && mx.y !== undefined) bone.position.y = Math.min(bone.position.y, +mx.y);
        if (mx.z !== null && mx.z !== undefined) bone.position.z = Math.min(bone.position.z, +mx.z);
        return { ok: true };
      }
      case 'damped-track':
      case 'stretch-to': {
        var tp = targetWorldPos(c, root);
        if (!tp) return { ok: false, error: 'Không thấy target ' + c.target };
        root.updateMatrixWorld(true);
        var bp = new T.Vector3().setFromMatrixPosition(bone.matrixWorld);
        var dir = tp.clone().sub(bp);
        var dist = dir.length();
        if (dist < 1e-6) return { ok: false, error: 'Target trùng vị trí xương — không có hướng track.' };
        dir.normalize();
        /* Hướng +Y hiện tại (world) → hướng mục tiêu, nội suy theo k
           TRÊN VECTOR (giữ đúng góc + giữ twist hiện tại), rồi đổi
           thành delta quay world → local. */
        var curQ = new T.Quaternion();
        try { bone.getWorldQuaternion(curQ); } catch (e) { curQ.identity(); }
        var curDir = new T.Vector3(0, 1, 0).applyQuaternion(curQ);
        var k = (c.type === 'damped-track')
          ? dampedFactor(c.damp === undefined ? 8 : c.damp, dt, c.weight)
          : c.weight;
        var newDir = slerpVec(curDir, dir, k);
        var deltaW = new T.Quaternion().setFromUnitVectors(curDir, newDir);
        var newWorldQ = deltaW.multiply(curQ);
        bone.quaternion.copy(parentWorldQuat(bone).clone().invert().multiply(newWorldQ));
        if (c.type === 'stretch-to') {
          var s = stretchScale(c.restLength || 0.3, dist, c.maxStretch === undefined ? 1.5 : c.maxStretch);
          var baseScaleY = (base && base.s) ? base.s.y : 1;
          bone.scale.y = baseScaleY + (s - baseScaleY) * c.weight;
        }
        return { ok: true };
      }
      case 'ik': {
        var AdvIK = getAdvIK();
        if (!AdvIK || typeof AdvIK.solveLimbIK !== 'function') {
          return { ok: false, error: 'AdvIK chưa load — IK constraint cần js/rig/arp-qr3-advik.js.' };
        }
        var cur = getQRCurrent();
        if (!cur) return { ok: false, error: 'IK constraint cần control rig (QuickRig.current).' };
        var limbKey = c.limbKey || guessLimb(c.bone);
        if (!limbKey) return { ok: false, error: 'Không đoán được chi IK từ xương ' + c.bone + ' — đặt limbKey.' };
        var blend = 1;
        try {
          if (typeof AdvIK.getBlend === 'function') {
            var gb = AdvIK.getBlend(limbKey);
            /* getBlend trả {ok, limb, t} (object), không phải số. */
            if (typeof gb === 'number') blend = gb;
            else if (gb && typeof gb.t === 'number') blend = gb.t;
            else if (gb && typeof gb.blend === 'number') blend = gb.blend;
          }
        } catch (e) {}
        if (!(blend > 0)) return { ok: false, error: 'IK/FK blend của ' + limbKey + ' = 0 — IK không áp.' };
        var tp2 = targetWorldPos(c, root);
        if (!tp2) return { ok: false, error: 'Không thấy target IK ' + c.target };
        var LIMBS = (QR && QR.LIMBS) || {};
        var limb = LIMBS[limbKey];
        var pre = {};
        if (limb) {
          [limb.root, limb.mid, limb.end].forEach(function (n) {
            var b = findBone(root, n);
            if (b) pre[n] = { q: b.quaternion.clone(), s: b.scale.clone(), p: b.position.clone() };
          });
        }
        var r = AdvIK.solveLimbIK(limbKey, tp2, null, { stretchy: !!c.stretchy, maxStretch: c.maxStretch || 1.3 });
        if (!r || !r.ok) {
          if (limb) Object.keys(pre).forEach(function (n) {
            var b = findBone(root, n);
            if (b) { b.quaternion.copy(pre[n].q); b.scale.copy(pre[n].s); b.position.copy(pre[n].p); }
          });
          return { ok: false, error: 'solveLimbIK lỗi: ' + (r && r.error) };
        }
        if (limb && c.weight < 1) {
          Object.keys(pre).forEach(function (n) {
            var b = findBone(root, n);
            if (!b) return;
            var postQ = b.quaternion.clone(), postS = b.scale.clone(), postP = b.position.clone();
            b.quaternion.copy(pre[n].q).slerp(postQ, c.weight);
            b.scale.copy(pre[n].s).lerp(postS, c.weight);
            b.position.copy(pre[n].p).lerp(postP, c.weight);
          });
        }
        return { ok: true };
      }
      default:
        return { ok: false, error: 'Loại constraint chưa hỗ trợ: ' + c.type };
    }
  }
  function guessLimb(boneName) {
    var n = stripName(boneName);
    if (/^Left(Arm|ForeArm|Hand)/.test(n)) return 'LeftArm';
    if (/^Right(Arm|ForeArm|Hand)/.test(n)) return 'RightArm';
    if (/^Left(UpLeg|Leg|Foot|ToeBase)/.test(n)) return 'LeftLeg';
    if (/^Right(UpLeg|Leg|Foot|ToeBase)/.test(n)) return 'RightLeg';
    return null;
  }

  /* ---------- update mỗi frame (hook từ App.startLoop) ---------- */
  function update(dt) {
    if (!state.enabled) return { ok: false, reason: 'disabled' };
    if (!state.rigRoot) { if (!autoAttach()) return { ok: false, reason: 'no-rig' }; }
    if (!state.list.length) return { ok: true, applied: 0, skipped: 0 };
    var root = state.rigRoot;
    try { root.updateMatrixWorld(true); } catch (e) {}
    /* 0. freePose: xương nào KHÔNG còn constraint đang chạy thì pose
       hiện tại của nó là pose "tự do" — ghi lại; xương nào VỪA hết
       constraint (kỳ trước còn chạy) thì KHÔI PHỤC về freePose đã ghi
       (pose trước khi constraint can thiệp). Lưu ý: khi clip đang
       phát, mixer sẽ viết lại pose ngay frame sau nên chỉ lệch 1
       frame lúc tắt constraint giữa chừng. */
    var activeNow = {};
    state.list.forEach(function (c) {
      if (c.enabled && c.weight > 0) activeNow[stripName(c.bone)] = true;
    });
    Object.keys(state.activeBones).forEach(function (n) {
      if (!activeNow[n]) {
        var rb = findBone(root, n);
        var fp = state.freePose[n];
        if (rb && fp) { rb.quaternion.copy(fp.q); rb.position.copy(fp.p); rb.scale.copy(fp.s); }
      }
    });
    state.list.forEach(function (c) {
      var n = stripName(c.bone);
      if (!activeNow[n]) {
        var fb = findBone(root, n);
        if (fb) state.freePose[n] = { q: fb.quaternion.clone(), p: fb.position.clone(), s: fb.scale.clone() };
      }
    });
    /* 1. base pose: chụp pose hiện tại (mixer vừa viết) của mọi xương bị
       constraint — mọi constraint tính từ base, không tích lũy. */
    var base = {};
    var bones = {};
    state.list.forEach(function (c) {
      if (!c.enabled || !(c.weight > 0)) return;
      if (!bones[c.bone]) {
        var b = findBone(root, c.bone);
        if (b) {
          bones[c.bone] = b;
          base[c.bone] = { q: b.quaternion.clone(), p: b.position.clone(), s: b.scale.clone() };
        }
      }
    });
    /* 2. áp stack theo thứ tự (sau ghi đè trước) */
    var applied = 0, skipped = 0, errors = [];
    state.list.forEach(function (c) {
      if (!c.enabled || !(c.weight > 0)) { skipped++; return; }
      var bone = bones[c.bone];
      if (!bone) { skipped++; errors.push(c.id + ': không thấy xương ' + c.bone); return; }
      try { root.updateMatrixWorld(true); } catch (e) {}
      var r = applyOne(c, bone, root, dt, base[c.bone]);
      if (r.ok) applied++; else { skipped++; errors.push(c.id + ': ' + r.error); }
    });
    try { root.updateMatrixWorld(true); } catch (e) {}
    state.activeBones = activeNow;
    return { ok: true, applied: applied, skipped: skipped, errors: errors };
  }

  /* ---------- UI: section tab Quick Rig ---------- */
  function mkEl(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null) return;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  var _uiBone = null;
  function boneOptions() {
    var names = [];
    if (state.rigRoot) {
      collectBones(state.rigRoot).forEach(function (b) { names.push(stripName(b.name)); });
    } else if (QR && QR.BONE_DEFS) {
      names = QR.BONE_DEFS.map(function (d) { return d.name; });
    }
    return names;
  }
  function renderSection(container) {
    if (!container || !container.appendChild) return null;
    container.innerHTML = '';
    var wrap = mkEl('div', { class: 'arp-constraints-section' });
    wrap.appendChild(mkEl('h4', {}, 'Bone Constraints'));
    wrap.appendChild(mkEl('div', { style: { fontSize: '12px', opacity: '0.85' } },
      'Stack constraint chạy mỗi frame (sau mixer, trước render). Constraint sau ghi đè trước. ' +
      'Rig: ' + (state.rigName || 'chưa gắn') + ' · ' + state.list.length + ' constraint.'));
    /* công tắc tổng */
    var enRow = mkEl('div', { style: { marginTop: '6px' } });
    var enCb = mkEl('input', { type: 'checkbox' });
    enCb.checked = state.enabled;
    enCb.addEventListener('change', function () { state.enabled = enCb.checked; });
    enRow.appendChild(enCb);
    enRow.appendChild(document.createTextNode(' Bật constraint (tắt = pose về như cũ)'));
    wrap.appendChild(enRow);
    /* chọn xương */
    var bones = boneOptions();
    if (!_uiBone || bones.indexOf(_uiBone) < 0) _uiBone = bones[0] || null;
    var boneRow = mkEl('div', { style: { marginTop: '6px' } });
    boneRow.appendChild(mkEl('span', {}, 'Xương: '));
    var boneSel = mkEl('select', { class: 'arp-select' });
    bones.forEach(function (n) {
      var o = mkEl('option', { value: n }, n);
      if (n === _uiBone) o.selected = true;
      boneSel.appendChild(o);
    });
    boneSel.addEventListener('change', function () { _uiBone = boneSel.value; renderSection(container); });
    boneRow.appendChild(boneSel);
    wrap.appendChild(boneRow);
    /* danh sách constraint của xương đang chọn */
    var list = _uiBone ? constraintsFor(_uiBone) : [];
    var listBox = mkEl('div', { style: { marginTop: '6px' } });
    if (!list.length) {
      listBox.appendChild(mkEl('div', { style: { opacity: '0.7' } }, 'Xương này chưa có constraint.'));
    }
    list.forEach(function (c) {
      var row = mkEl('div', { class: 'arp-constraint-row', style: { border: '1px solid #888', padding: '4px', marginTop: '4px' } });
      var head = mkEl('div', {});
      var cb = mkEl('input', { type: 'checkbox' });
      cb.checked = c.enabled;
      cb.addEventListener('change', function () { setEnabled(c.id, cb.checked); });
      head.appendChild(cb);
      head.appendChild(document.createTextNode(' ' + (TYPES[c.type] ? TYPES[c.type].label : c.type) +
        (c.target ? ' → ' + c.target : '') + '  '));
      var up = mkEl('button', { class: 'btn sm', type: 'button' }, '↑');
      up.addEventListener('click', function () { moveConstraint(c.id, -1); renderSection(container); });
      var dn = mkEl('button', { class: 'btn sm', type: 'button' }, '↓');
      dn.addEventListener('click', function () { moveConstraint(c.id, 1); renderSection(container); });
      var del = mkEl('button', { class: 'btn sm', type: 'button' }, '✕');
      del.addEventListener('click', function () { removeConstraint(c.id); renderSection(container); });
      head.appendChild(up); head.appendChild(dn); head.appendChild(del);
      row.appendChild(head);
      var wRow = mkEl('div', {});
      wRow.appendChild(mkEl('span', {}, 'Weight: '));
      var slider = mkEl('input', { type: 'range', min: '0', max: '100', step: '1' });
      slider.value = String(Math.round(c.weight * 100));
      var wVal = mkEl('span', {}, ' ' + Math.round(c.weight * 100) + '%');
      slider.addEventListener('input', function () {
        setWeight(c.id, parseInt(slider.value, 10) / 100);
        wVal.textContent = ' ' + slider.value + '%';
      });
      wRow.appendChild(slider); wRow.appendChild(wVal);
      row.appendChild(wRow);
      listBox.appendChild(row);
    });
    wrap.appendChild(listBox);
    /* thêm mới */
    var addRow = mkEl('div', { style: { marginTop: '6px' } });
    var typeSel = mkEl('select', { class: 'arp-select' });
    Object.keys(TYPES).forEach(function (k) { typeSel.appendChild(mkEl('option', { value: k }, TYPES[k].label)); });
    var tgtSel = mkEl('select', { class: 'arp-select' });
    bones.forEach(function (n) { tgtSel.appendChild(mkEl('option', { value: n }, n)); });
    var addBtn = mkEl('button', { class: 'btn sm', type: 'button' }, '＋ Thêm constraint');
    addBtn.addEventListener('click', function () {
      var spec = { type: typeSel.value, bone: _uiBone, target: tgtSel.value };
      if (typeSel.value === 'ik') spec.limbKey = guessLimb(_uiBone);
      var r = addConstraint(spec);
      if (!r.ok) { notify('error', 'Constraint', r.error); return; }
      renderSection(container);
    });
    addRow.appendChild(typeSel); addRow.appendChild(tgtSel); addRow.appendChild(addBtn);
    wrap.appendChild(addRow);
    /* lưu / tải */
    var ioRow = mkEl('div', { style: { marginTop: '6px' } });
    var saveBtn = mkEl('button', { class: 'btn sm', type: 'button' }, 'Lưu (localStorage)');
    saveBtn.addEventListener('click', function () {
      var r = save();
      notify(r.ok ? 'success' : 'error', 'Constraint', r.ok ? ('Đã lưu ' + r.count + ' constraint.') : r.error);
    });
    var loadBtn = mkEl('button', { class: 'btn sm', type: 'button' }, 'Tải đã lưu');
    loadBtn.addEventListener('click', function () {
      var r = load();
      notify(r.ok ? 'success' : 'error', 'Constraint', r.ok ? ('Đã tải ' + r.loaded + ' constraint.') : r.error);
      renderSection(container);
    });
    var expBtn = mkEl('button', { class: 'btn sm', type: 'button' }, 'Xuất JSON');
    expBtn.addEventListener('click', function () {
      try {
        var U = window.PixiStudio && PixiStudio.Utils;
        if (U && typeof U.downloadText === 'function') U.downloadText(JSON.stringify(toJSON(), null, 2), 'constraints-' + (state.rigName || 'rig') + '.json', 'application/json');
      } catch (e) {}
    });
    ioRow.appendChild(saveBtn); ioRow.appendChild(loadBtn); ioRow.appendChild(expBtn);
    wrap.appendChild(ioRow);
    container.appendChild(wrap);
    return wrap;
  }

  /* ---------- public API ---------- */
  var ArpConstraints = {
    TYPES: TYPES,
    STORAGE_KEY: STORAGE_KEY,
    attach: attach,
    autoAttach: autoAttach,
    update: update,
    addConstraint: addConstraint,
    getConstraint: getConstraint,
    removeConstraint: removeConstraint,
    moveConstraint: moveConstraint,
    setEnabled: setEnabled,
    setWeight: setWeight,
    constraintsFor: constraintsFor,
    clearAll: clearAll,
    toJSON: toJSON,
    fromJSON: fromJSON,
    save: save,
    load: load,
    findBone: findBone,
    findObject: findObject,
    collectBones: collectBones,
    renderSection: renderSection,
    get state() { return state; },
    get list() { return state.list; },
    get enabled() { return state.enabled; },
    set enabled(v) { state.enabled = !!v; },
    _test: {
      dampedFactor: dampedFactor,
      stretchScale: stretchScale,
      slerpVec: slerpVec,
      clampEulerDeg: clampEulerDeg,
      guessLimb: guessLimb,
      stripName: stripName,
      applyOne: applyOne,
      TYPES: TYPES
    }
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpConstraints = ArpConstraints;
  /* Đăng ký section vào tab Quick Rig (chạy được cả khi hook chưa có). */
  try {
    if (QR && typeof QR.registerSection === 'function') QR.registerSection('constraints', renderSection);
  } catch (e) {}
})();
