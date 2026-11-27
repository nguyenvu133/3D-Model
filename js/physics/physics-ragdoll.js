/* ============================================================
 * physics/physics-ragdoll.js — Ragdoll tự build từ rig nhân vật.
 * Mỗi xương → 1 rigidbody (capsule cho chi, sphere cho đầu,
 * box cho thân) + joint nối theo hierarchy (hinge khuỷu/gối,
 * ball-and-socket vai/hông/cột sống).
 *
 * enable(root): nhân vật đổ theo vật lý (xương bám theo body).
 * disable(root): trả pose đã snapshot, animation tiếp tục.
 * Cặp body nối trực tiếp bằng joint KHÔNG va chạm nhau (engine
 * bỏ qua — xem PhysicsEngine._jointPairs) để khớp không tự đẩy.
 * Giới hạn thật: chưa có self-collision giữa các chi không kề,
 * chưa có giới hạn góc 1 chiều kiểu giải phẫu cho khuỷu/gối
 * (hinge đang kẹp đối xứng ±2.4 rad), chưa pause mixer tự động —
 * module chỉ emit bus 'physics:ragdoll-on/off' để Anim tự dừng.
 * ============================================================ */
(function () {
  'use strict';

  var V3 = THREE.Vector3;
  var QT = THREE.Quaternion;

  function engine() { return window.PixiStudio && window.PixiStudio.PhysicsEngine; }
  function bus() { return window.PixiStudio && window.PixiStudio.bus; }

  /* ---------- phân loại xương → shape ---------- */
  function classifyBone(name) {
    var n = (name || '').toLowerCase();
    if (/(head)/.test(n)) return { part: 'head', shape: 'sphere', radius: 0.11, mass: 6 };
    if (/(neck)/.test(n)) return { part: 'neck', shape: 'capsule', radius: 0.05, mass: 1.5 };
    if (/(hips|pelvis)/.test(n)) return { part: 'pelvis', shape: 'box', size: [0.34, 0.22, 0.22], mass: 12 };
    if (/(spine|chest)/.test(n)) return { part: 'spine', shape: 'box', size: [0.30, 0.22, 0.20], mass: 9 };
    /* Mixamo: LeftForeArm / LeftArm / LeftUpLeg / LeftLeg — thứ tự quan
     * trọng: forearm trước arm, upleg trước leg (từng khớp sai: LeftArm
     * và LeftUpLeg rơi về 'other' vì regex cần 'upperarm'/'upperleg'). */
    if (/(forearm|lowerarm|lower_arm|elbow)/.test(n)) return { part: 'forearm', shape: 'capsule', radius: 0.045, mass: 2 };
    if (/(upperarm|upper_arm|shoulder|arm)/.test(n)) return { part: 'upperarm', shape: 'capsule', radius: 0.055, mass: 2.5 };
    if (/(hand)/.test(n) && !/(finger|thumb)/.test(n)) return { part: 'hand', shape: 'box', size: [0.09, 0.12, 0.05], mass: 0.8 };
    if (/(finger|thumb)/.test(n)) return { part: 'finger', shape: 'sphere', radius: 0.02, mass: 0.15 };
    if (/(thigh|upperleg|upper_leg|upleg)/.test(n)) return { part: 'thigh', shape: 'capsule', radius: 0.075, mass: 5 };
    if (/(calf|shin|lowerleg|lower_leg|knee|leg)/.test(n)) return { part: 'shin', shape: 'capsule', radius: 0.06, mass: 4 };
    if (/(foot|toe)/.test(n)) return { part: 'foot', shape: 'box', size: [0.10, 0.06, 0.24], mass: 1.5 };
    return { part: 'other', shape: 'sphere', radius: 0.06, mass: 1 };
  }
  function isHingeBone(name) {
    var n = (name || '').toLowerCase();
    if (/(forearm|lowerarm|elbow|calf|shin|lowerleg|knee)/.test(n)) return true;
    /* LeftLeg (cẳng chân) là hinge gối; LeftUpLeg (đùi) thì không */
    return /leg/.test(n) && !/upleg|upperleg/.test(n);
  }

  function findBones(root) {
    /* HỢP NHẤT skeleton.bones + traverse: FBX Thiếu Lâm thật có 41 xương
     * traverse nhưng skeleton.bones chỉ 34 (7 xương không nằm trong
     * skeleton — từng build thiếu 7 body). Thứ tự: skeleton trước, rồi
     * xương traverse chưa có (giữ thứ tự cha-trước-con của traverse). */
    var skel = null;
    root.traverse(function (o) {
      if (o && o.isSkinnedMesh && o.skeleton && o.skeleton.bones && o.skeleton.bones.length) {
        skel = o.skeleton.bones.slice();
      }
    });
    var trav = [];
    root.traverse(function (o) { if (o && o.isBone) trav.push(o); });
    if (!skel) return trav;
    var seen = {};
    skel.forEach(function (b) { seen[b.uuid] = true; });
    trav.forEach(function (b) { if (!seen[b.uuid]) skel.push(b); });
    return skel;
  }
  function firstBoneChild(bone) {
    var kids = (bone.children || []).filter(function (c) { return c && c.isBone; });
    return kids.length ? kids[0] : null;
  }
  function boneDepth(bone) {
    var d = 0, p = bone.parent;
    while (p) { if (p.isBone) d++; p = p.parent; }
    return d;
  }
  function boneWorld(bone, pos, quat) {
    bone.getWorldPosition(pos);
    bone.getWorldQuaternion(quat);
    return { pos: pos, quat: quat };
  }

  var Ragdoll = {
    active: false,
    root: null,
    bones: [],       /* xương theo thứ tự traverse (cha trước con) */
    bodies: {},      /* bone.uuid -> engine body */
    joints: [],
    _snapshot: null /* [{bone, pos, quat}] */
  };

  Ragdoll.findBones = findBones;
  Ragdoll.classifyBone = classifyBone;

  /* ---------- build: tạo body + joint từ rig (chưa bật sim) ---------- */
  Ragdoll.build = function (root, opts) {
    opts = opts || {};
    var E = engine();
    if (!E) return { ok: false, reason: 'no-engine' };
    if (!root) return { ok: false, reason: 'no-root' };
    Ragdoll.dispose();
    root.updateMatrixWorld(true);
    var bones = findBones(root);
    if (!bones.length) return { ok: false, reason: 'no-skeleton', boneCount: 0 };

    var totalMass = opts.totalMass || 70;
    var rawMass = 0;
    var defs = bones.map(function (bone) {
      var cls = classifyBone(bone.name);
      rawMass += cls.mass;
      return { bone: bone, cls: cls };
    });
    var massScale = totalMass / Math.max(rawMass, 1);
    var up = new V3(0, 1, 0);

    defs.forEach(function (def) {
      var bone = def.bone, cls = def.cls;
      var wPos = new V3(), wQuat = new QT();
      boneWorld(bone, wPos, wQuat);
      var child = firstBoneChild(bone);
      var len = 0.15, axisLocal = new V3(0, 1, 0);
      if (child) {
        var cPos = new V3();
        child.getWorldPosition(cPos);
        var dirW = cPos.sub(wPos);
        len = Math.max(dirW.length(), 0.05);
        axisLocal.copy(dirW.normalize()).applyQuaternion(_q.copy(wQuat).invert());
      }
      var shape;
      if (cls.shape === 'sphere') shape = { type: 'sphere', radius: cls.radius };
      else if (cls.shape === 'box') shape = { type: 'box', size: cls.size };
      else shape = { type: 'capsule', radius: cls.radius, halfLen: Math.max(len / 2, 0.03), axis: axisLocal };
      var body = E.createBody({
        label: 'ragdoll:' + bone.name,
        shape: shape,
        position: wPos,
        quaternion: wQuat,
        mass: Math.max(cls.mass * massScale, 0.05),
        restitution: 0.1,
        friction: 0.8,
        linearDamping: 0.1,
        angularDamping: 0.25,
        userData: { boneName: bone.name, isRagdoll: true, part: cls.part }
      });
      Ragdoll.bodies[bone.uuid] = body;
    });

    /* joints theo hierarchy */
    defs.forEach(function (def) {
      var bone = def.bone, parent = bone.parent;
      if (!parent || !parent.isBone) return;
      var bodyA = Ragdoll.bodies[parent.uuid], bodyB = Ragdoll.bodies[bone.uuid];
      if (!bodyA || !bodyB) return;
      var wPosP = new V3(), wQuatP = new QT(), wPosB = new V3(), wQuatB = new QT();
      boneWorld(parent, wPosP, wQuatP);
      boneWorld(bone, wPosB, wQuatB);
      /* anchorA: vị trí khớp (gốc xương con) trong local của xương cha */
      var anchorA = wPosB.clone().sub(wPosP).applyQuaternion(_q.copy(wQuatP).invert());
      var joint;
      /* Chỉ xương NGÓN TAY nối bằng FIXED: khớp ball để chúng quay tự do
       * — với inertia nhỏ chúng quay tới 60 rad/s và cả ragdoll rung mãi
       * không lắng (từng đo 0/41 ngủ sau 3.5s). Xương lá KHÁC (ngón chân,
       * đỉnh đầu...) vẫn dùng ball/hinge: fixed kéo cứng theo xương cha
       * nên khi bàn chân xoắn lại, neo khớp nằm dưới sàn và kéo cả ngón
       * chân chìm 12cm dưới sàn (từng đo LeftToe_End y=-0.06). */
      if (def.cls.part === 'finger') {
        joint = E.addJoint('fixed', bodyA, bodyB, {
          anchorA: anchorA, anchorB: new V3(0, 0, 0),
          label: 'fixed:' + bone.name
        });
      } else if (isHingeBone(bone.name)) {
        /* trục hinge ⊥ hướng chi: cross(hướng chi, up) */
        var dirW = wPosB.clone().sub(wPosP);
        var axisW = new V3().crossVectors(dirW, up);
        if (axisW.lengthSq() < 1e-6) axisW.set(1, 0, 0); else axisW.normalize();
        var refW = dirW.clone().normalize();
        joint = E.addJoint('hinge', bodyA, bodyB, {
          anchorA: anchorA, anchorB: new V3(0, 0, 0),
          axisA: axisW.clone().applyQuaternion(_q.copy(wQuatP).invert()),
          axisB: axisW.clone().applyQuaternion(_q.copy(wQuatB).invert()),
          refA: refW.clone().applyQuaternion(_q.copy(wQuatP).invert()),
          refB: refW.clone().applyQuaternion(_q.copy(wQuatB).invert()),
          minAngle: -2.4, maxAngle: 2.4,
          label: 'hinge:' + bone.name
        });
      } else {
        joint = E.addJoint('ball', bodyA, bodyB, {
          anchorA: anchorA, anchorB: new V3(0, 0, 0),
          label: 'ball:' + bone.name
        });
      }
      Ragdoll.joints.push(joint);
    });

    Ragdoll.root = root;
    Ragdoll.bones = bones;
    /* thứ tự đồng bộ: cha trước con (theo độ sâu trong hierarchy) */
    Ragdoll._depthOrder = bones.slice().sort(function (a, b) {
      return boneDepth(a) - boneDepth(b);
    });
    return {
      ok: true,
      boneCount: bones.length,
      bodyCount: Object.keys(Ragdoll.bodies).length,
      jointCount: Ragdoll.joints.length,
      parts: defs.map(function (d) { return d.bone.name + ':' + d.cls.part + ':' + d.cls.shape; })
    };
  };
  var _q = new QT();

  /* ---------- bật / tắt ---------- */
  Ragdoll.enable = function (root) {
    var E = engine();
    if (!E) return { ok: false, reason: 'no-engine' };
    if (Ragdoll.active) return { ok: true, already: true, boneCount: Ragdoll.bones.length };
    var built = Ragdoll.build(root || Ragdoll.root);
    if (!built.ok) return built;
    /* snapshot pose hiện tại để disable() trả lại */
    Ragdoll._snapshot = Ragdoll.bones.map(function (bone) {
      return { bone: bone, pos: bone.position.clone(), quat: bone.quaternion.clone() };
    });
    /* đồng bộ body từ xương (pose lúc bật) */
    Ragdoll.syncBodiesFromBones();
    E.wakeAll();
    E.start();
    Ragdoll.active = true;
    if (bus()) bus().emit('physics:ragdoll-on', { boneCount: Ragdoll.bones.length, bodyCount: built.bodyCount });
    return { ok: true, boneCount: Ragdoll.bones.length, bodyCount: built.bodyCount, jointCount: built.jointCount };
  };

  Ragdoll.disable = function () {
    var E = engine();
    if (!Ragdoll.active) return { ok: true, already: true };
    if (E) {
      Object.keys(Ragdoll.bodies).forEach(function (k) { E.removeBody(Ragdoll.bodies[k]); });
    }
    Ragdoll.bodies = {};
    Ragdoll.joints = [];
    if (Ragdoll._snapshot) {
      Ragdoll._snapshot.forEach(function (s) {
        s.bone.position.copy(s.pos);
        s.bone.quaternion.copy(s.quat);
      });
      Ragdoll._snapshot = null;
    }
    if (Ragdoll.root) Ragdoll.root.updateMatrixWorld(true);
    Ragdoll.active = false;
    if (bus()) bus().emit('physics:ragdoll-off', {});
    return { ok: true };
  };

  Ragdoll.dispose = function () {
    if (Ragdoll.active) Ragdoll.disable();
    var E = engine();
    if (E) Object.keys(Ragdoll.bodies).forEach(function (k) { E.removeBody(Ragdoll.bodies[k]); });
    Ragdoll.bodies = {};
    Ragdoll.joints = [];
    Ragdoll.bones = [];
    Ragdoll.root = null;
    Ragdoll._snapshot = null;
    Ragdoll._depthOrder = null;
  };

  /* ---------- đồng bộ 2 chiều ---------- */
  Ragdoll.syncBodiesFromBones = function () {
    if (!Ragdoll.root) return;
    Ragdoll.root.updateMatrixWorld(true);
    Ragdoll.bones.forEach(function (bone) {
      var body = Ragdoll.bodies[bone.uuid];
      if (!body) return;
      bone.getWorldPosition(body.position);
      bone.getWorldQuaternion(body.quaternion);
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
      body.sleeping = false;
    });
  };

  Ragdoll.syncBonesFromBodies = function () {
    if (!Ragdoll.active || !Ragdoll.root) return;
    /* ĐỒNG BỘ THEO ĐỘ SÂU (cha trước con): skeleton.bones của FBX
     * KHÔNG đảm bảo thứ tự cha-trước-con — từng đo xương thấp nhất
     * -0.34m trong khi body thấp nhất chỉ -0.03m (local của con tính
     * theo matrixWorld CŨ của cha, sai tới 0.3m khi cha đang rơi). */
    var order = Ragdoll._depthOrder || Ragdoll.bones;
    var inv = new THREE.Matrix4();
    order.forEach(function (bone) {
      var body = Ragdoll.bodies[bone.uuid];
      if (!body) return;
      var parent = bone.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        inv.copy(parent.matrixWorld).invert();
        var lp = body.position.clone().applyMatrix4(inv);
        bone.position.copy(lp);
        var pq = new QT().setFromRotationMatrix(parent.matrixWorld);
        bone.quaternion.copy(pq.invert().multiply(body.quaternion));
      } else {
        bone.position.copy(body.position);
        bone.quaternion.copy(body.quaternion);
      }
      bone.updateMatrix();
    });
    Ragdoll.root.updateMatrixWorld(true);
  };

  /* mỗi frame (manager gọi sau Engine.step) */
  Ragdoll.update = function () {
    if (!Ragdoll.active) return;
    Ragdoll.syncBonesFromBodies();
  };

  /* Y thấp nhất của xương (world) — kiểm tra xuyên sàn */
  Ragdoll.minBoneY = function () {
    if (!Ragdoll.root) return null;
    Ragdoll.root.updateMatrixWorld(true);
    var min = Infinity, v = new V3();
    Ragdoll.bones.forEach(function (bone) {
      bone.getWorldPosition(v);
      if (v.y < min) min = v.y;
    });
    return min;
  };

  Ragdoll.getState = function () {
    return {
      active: Ragdoll.active,
      boneCount: Ragdoll.bones.length,
      bodyCount: Object.keys(Ragdoll.bodies).length,
      jointCount: Ragdoll.joints.length,
      minBoneY: Ragdoll.minBoneY()
    };
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.PhysicsRagdoll = Ragdoll;
})();
