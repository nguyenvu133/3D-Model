/* ============================================================
 * animation/ik-solver.js — Two-bone IK + Foot Planting (v21.0)
 *
 * Giải IK hai xương (vai→khuỷu→tay, hông→gối→chân) bằng luật cosin,
 * có pole vector để điều hướng khuỷu/gối, và foot planting giữ bàn
 * chân chạm đất. Chạy local, không cần key.
 *
 * Cách dùng:
 *   IKSolver.solveLimb(rig, 'LeftArm', {x,y,z}, {x,y,z})  // 1 lần
 *   IKSolver.setTarget('LeftArm', x, y, z)                 // giữ mỗi frame
 *   IKSolver.plantFeet(rig)                                // chân chạm đất
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;

  /* Chuỗi xương theo tên chuẩn (canonical). Rig Mixamo có prefix
     'mixamorig:' — findBone tự bỏ prefix khi so khớp. */
  const CHAINS = {
    LeftArm: { bones: ['LeftShoulder', 'LeftArm', 'LeftForeArm'], tip: 'LeftHand' },
    RightArm: { bones: ['RightShoulder', 'RightArm', 'RightForeArm'], tip: 'RightHand' },
    LeftLeg: { bones: ['LeftUpLeg', 'LeftLeg', 'LeftFoot'], tip: 'LeftToeBase' },
    RightLeg: { bones: ['RightUpLeg', 'RightLeg', 'RightFoot'], tip: 'RightToeBase' }
  };

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _q1 = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();

  const IKSolver = {
    enabled: true,
    targets: {},   // limb -> { target: Vector3, pole: Vector3|null }
    footPlant: false,
    groundY: 0
  };

  /* Tìm bone theo tên chuẩn, khớp cả tên có prefix 'mixamorig:'. */
  IKSolver.findBone = function (rig, canonical) {
    if (!rig || !rig.bones) return null;
    const b = rig.bones;
    if (b[canonical]) return b[canonical];
    if (b['mixamorig:' + canonical]) return b['mixamorig:' + canonical];
    for (const k in b) {
      if (k.replace(/^mixamorig:/, '') === canonical) return b[k];
    }
    return null;
  };

  IKSolver.chainBones = function (rig, limb) {
    const def = CHAINS[limb];
    if (!def) return null;
    const bones = def.bones.map(function (n) { return IKSolver.findBone(rig, n); });
    const tip = IKSolver.findBone(rig, def.tip);
    if (bones.some(function (x) { return !x; }) || !tip) return null;
    return { root: bones[0], mid: bones[1], end: bones[2], tip: tip };
  };

  /* Xoay 1 bone sao cho hướng tới child hiện tại (world) trùng hướng muốn.
     Dùng vị trí world thật của child, không giả định trục local nào.
     (Dùng vector tạm riêng — không đụng _a/_b/_c/_d của caller.) */
  function aimBone(bone, fromWorld, desiredDir, rigTarget) {
    const bonePos = bone.getWorldPosition(new THREE.Vector3());
    const curDir = new THREE.Vector3().copy(fromWorld).sub(bonePos).normalize();
    if (curDir.lengthSq() < 1e-8) return false;
    if (curDir.dot(desiredDir) > 0.999999) return true;
    const dq = new THREE.Quaternion().setFromUnitVectors(curDir, desiredDir);
    const wq = bone.getWorldQuaternion(new THREE.Quaternion());
    wq.premultiply(dq);
    if (bone.parent) {
      const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      pq.invert();
      wq.premultiply(pq);
    }
    bone.quaternion.copy(wq);
    if (rigTarget) rigTarget.updateMatrixWorld(true);
    return true;
  }

  /* Giải IK hai xương cho 1 chuỗi {root, mid, end, tip}.
     Trả về {ok, reached, distance} — reached=false khi target ngoài tầm
     (tay/chân duỗi thẳng hết cỡ về phía target). */
  IKSolver.solveChain = function (chain, target, pole, rigTarget) {
    if (!chain || !target) return { ok: false, reached: false, distance: -1 };
    const R = chain.root.getWorldPosition(new THREE.Vector3());
    const M = chain.mid.getWorldPosition(new THREE.Vector3());
    const T = chain.tip.getWorldPosition(new THREE.Vector3());
    const a = R.distanceTo(M);            // xương trên
    const b = M.distanceTo(T);            // xương dưới (+ bàn tay/chân)
    if (a < 1e-6 || b < 1e-6) return { ok: false, reached: false, distance: -1 };

    _c.copy(target).sub(R);
    let c = _c.length();
    const maxReach = a + b - 1e-4;
    const minReach = Math.abs(a - b) + 1e-4;
    const clamped = THREE.MathUtils.clamp(c, minReach, maxReach);
    const reached = Math.abs(c - clamped) < 1e-3;
    c = clamped;
    const dirRT = _c.normalize();         // R -> target (đã chuẩn hoá)

    /* Góc tại khớp gốc theo luật cosin. */
    const cosA = THREE.MathUtils.clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));

    /* Hướng gập (bend): thành phần của pole vuông góc với dirRT.
       Không có pole / pole song song -> giữ hướng gập hiện tại. */
    let bend = _d.copy(M).sub(R);
    bend.addScaledVector(dirRT, -bend.dot(dirRT)); // loại thành phần dọc dirRT
    if (pole) {
      _a.copy(pole).sub(R);
      _a.addScaledVector(dirRT, -_a.dot(dirRT));
      if (_a.lengthSq() > 1e-8) bend.copy(_a);
    }
    if (bend.lengthSq() < 1e-8) {
      // dự phòng: trục vuông góc bất kỳ với dirRT
      bend.set(0, 1, 0).addScaledVector(dirRT, -dirRT.y);
      if (bend.lengthSq() < 1e-8) bend.set(1, 0, 0).addScaledVector(dirRT, -dirRT.x);
    }
    bend.normalize();

    /* Vị trí khớp giữa muốn đạt. */
    const midTarget = new THREE.Vector3()
      .copy(R).addScaledVector(dirRT, a * cosA).addScaledVector(bend, a * sinA);

    /* B1: xoay root để khớp giữa tới midTarget. */
    _a.copy(midTarget).sub(R).normalize();
    aimBone(chain.root, M, _a, rigTarget);

    /* B2: xoay mid để đầu chi tới target (đọc lại vị trí sau B1). */
    const M2 = chain.mid.getWorldPosition(new THREE.Vector3());
    const T2 = chain.tip.getWorldPosition(new THREE.Vector3());
    _b.copy(target).sub(M2).normalize();
    aimBone(chain.mid, T2, _b, rigTarget);

    const dist = chain.tip.getWorldPosition(new THREE.Vector3()).distanceTo(target);
    return { ok: true, reached: reached, distance: dist };
  };

  /* Giải 1 chi của rig hiện tại. target/pole là {x,y,z} hoặc Vector3. */
  IKSolver.solveLimb = function (rig, limb, target, pole) {
    if (!rig) rig = PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
    if (!rig) return { ok: false, reached: false, distance: -1 };
    const chain = IKSolver.chainBones(rig, limb);
    if (!chain) return { ok: false, reached: false, distance: -1 };
    const t = target instanceof THREE.Vector3 ? target : new THREE.Vector3(target.x, target.y, target.z);
    const p = pole ? (pole instanceof THREE.Vector3 ? pole : new THREE.Vector3(pole.x, pole.y, pole.z)) : null;
    return IKSolver.solveChain(chain, t, p, rig.target);
  };

  /* Đặt target giữ mỗi frame (update gọi lại). */
  IKSolver.setTarget = function (limb, x, y, z, pole) {
    IKSolver.targets[limb] = {
      target: new THREE.Vector3(x, y, z),
      pole: pole ? new THREE.Vector3(pole.x, pole.y, pole.z) : null
    };
    return true;
  };
  IKSolver.clearTarget = function (limb) {
    if (limb) delete IKSolver.targets[limb];
    else IKSolver.targets = {};
  };

  /* Foot planting: nâng toàn bộ model sao cho bàn chân thấp nhất chạm đất,
     rồi IK từng chân về đúng mặt đất (giữ x/z). */
  IKSolver.plantFeet = function (rig, groundY) {
    if (!rig) rig = PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
    if (!rig || !rig.target) return { ok: false, lifted: 0 };
    const gy = (groundY === undefined) ? IKSolver.groundY : groundY;
    const feet = ['LeftLeg', 'RightLeg'].map(function (limb) {
      return { limb: limb, chain: IKSolver.chainBones(rig, limb) };
    }).filter(function (f) { return f.chain; });
    if (!feet.length) return { ok: false, lifted: 0 };
    let minY = Infinity;
    feet.forEach(function (f) {
      const y = f.chain.tip.getWorldPosition(new THREE.Vector3()).y;
      if (y < minY) minY = y;
    });
    let lifted = 0;
    if (minY < gy) {
      lifted = gy - minY;
      rig.target.position.y += lifted;
      rig.target.updateMatrixWorld(true);
    }
    // IK từng chân xuống đúng mặt đất
    feet.forEach(function (f) {
      const tip = f.chain.tip.getWorldPosition(new THREE.Vector3());
      tip.y = gy;
      IKSolver.solveChain(f.chain, tip, null, rig.target);
    });
    return { ok: true, lifted: lifted };
  };

  /* Gọi mỗi frame từ App tick. */
  IKSolver.update = function (dt) {
    if (!IKSolver.enabled) return;
    const rig = PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
    if (!rig) return;
    let any = false;
    for (const limb in IKSolver.targets) {
      const t = IKSolver.targets[limb];
      IKSolver.solveLimb(rig, limb, t.target, t.pole);
      any = true;
    }
    if (IKSolver.footPlant) IKSolver.plantFeet(rig);
    if (any && rig.mixer) { /* mixer vẫn chạy clip nền; IK ghi đè sau */ }
  };

  window.PixiStudio.IKSolver = IKSolver;
})();
