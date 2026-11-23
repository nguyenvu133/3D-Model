/* ============================================================
 * animation/pose-library.js — Pose Library (v21.0)
 *
 * Lưu / khôi phục / nội suy tư thế xương (pose) của rig hiện tại.
 * Pose = quaternion từng bone + vị trí root. Lưu localStorage, dùng
 * lại giữa các lần mở studio. Kèm 3 pose mẫu dạng delta xoay tương
 * đối (T-Pose / A-Pose / Crouch) — áp lên pose hiện tại.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const KEY = 'pixiStudio.poses.v21';

  /* Delta xoay tương đối cho pose mẫu (trục local, radian). */
  const BUILTINS = {
    'T-Pose': {
      LeftShoulder: { axis: [0, 0, 1], angle: -1.35 },
      RightShoulder: { axis: [0, 0, 1], angle: 1.35 }
    },
    'A-Pose': {
      LeftShoulder: { axis: [0, 0, 1], angle: -0.6 },
      RightShoulder: { axis: [0, 0, 1], angle: 0.6 }
    },
    'Crouch': {
      Hips: { axis: [1, 0, 0], angle: 0.35 },
      LeftUpLeg: { axis: [1, 0, 0], angle: -0.6 },
      RightUpLeg: { axis: [1, 0, 0], angle: -0.6 },
      LeftLeg: { axis: [1, 0, 0], angle: 0.9 },
      RightLeg: { axis: [1, 0, 0], angle: 0.9 }
    }
  };

  const PoseLibrary = { BUILTINS: BUILTINS };

  function rig() {
    return PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
  }
  function findBone(r, name) {
    if (!r || !r.bones) return null;
    if (r.bones[name]) return r.bones[name];
    if (r.bones['mixamorig:' + name]) return r.bones['mixamorig:' + name];
    for (const k in r.bones) {
      if (k.replace(/^mixamorig:/, '') === name) return r.bones[k];
    }
    return null;
  }
  function readStore() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function writeStore(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch (e) { return false; }
  }

  /* Chụp pose hiện tại: {bones: {name:[x,y,z,w]}, root:[x,y,z]}. */
  PoseLibrary.capture = function (r) {
    r = r || rig();
    if (!r || !r.bones) return null;
    const bones = {};
    for (const name in r.bones) {
      const b = r.bones[name];
      if (!b || !b.quaternion) continue;
      bones[name] = [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w];
    }
    const root = r.rootBone ? [r.rootBone.position.x, r.rootBone.position.y, r.rootBone.position.z] : [0, 0, 0];
    return { bones: bones, root: root, at: Date.now() };
  };

  /* Áp pose lên rig (ghi đè quaternion từng bone). */
  PoseLibrary.apply = function (pose, r) {
    r = r || rig();
    if (!r || !pose || !pose.bones) return false;
    let n = 0;
    for (const name in pose.bones) {
      const b = findBone(r, name.replace(/^mixamorig:/, ''));
      if (!b) continue;
      const q = pose.bones[name];
      b.quaternion.set(q[0], q[1], q[2], q[3]);
      n++;
    }
    if (pose.root && r.rootBone) r.rootBone.position.set(pose.root[0], pose.root[1], pose.root[2]);
    if (r.target) r.target.updateMatrixWorld(true);
    return n > 0;
  };

  /* Nội suy 2 pose: slerp từng quaternion, lerp vị trí root. */
  PoseLibrary.interpolate = function (a, b, t) {
    t = Math.max(0, Math.min(1, t));
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    const out = { bones: {}, root: [0, 0, 0] };
    const names = {};
    [a, b].forEach(function (p) { if (p && p.bones) for (const n in p.bones) names[n] = true; });
    for (const name in names) {
      const av = a.bones && a.bones[name], bv = b.bones && b.bones[name];
      if (av && bv) {
        qa.set(av[0], av[1], av[2], av[3]);
        qb.set(bv[0], bv[1], bv[2], bv[3]);
        qa.slerp(qb, t);
        out.bones[name] = [qa.x, qa.y, qa.z, qa.w];
      } else if (av) out.bones[name] = av.slice();
      else if (bv) out.bones[name] = bv.slice();
    }
    if (a.root && b.root) {
      out.root = [0, 1, 2].map(function (i) { return a.root[i] + (b.root[i] - a.root[i]) * t; });
    }
    return out;
  };

  /* Áp delta xoay tương đối lên từng bone (dùng cho pose mẫu). */
  PoseLibrary.applyDelta = function (deltas, r) {
    r = r || rig();
    if (!r) return false;
    let n = 0;
    for (const name in deltas) {
      const b = findBone(r, name);
      if (!b) continue;
      const d = deltas[name];
      const dq = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(d.axis[0], d.axis[1], d.axis[2]).normalize(), d.angle);
      b.quaternion.multiply(dq);
      n++;
    }
    if (n && r.target) r.target.updateMatrixWorld(true);
    return n > 0;
  };

  PoseLibrary.applyBuiltin = function (name) {
    const d = BUILTINS[name];
    if (!d) return false;
    return PoseLibrary.applyDelta(d);
  };

  PoseLibrary.save = function (name, pose) {
    if (!name) return false;
    pose = pose || PoseLibrary.capture();
    if (!pose) return false;
    const all = readStore();
    all[name] = pose;
    return writeStore(all);
  };
  PoseLibrary.load = function (name) {
    const all = readStore();
    return all[name] || null;
  };
  PoseLibrary.list = function () {
    const all = readStore();
    return Object.keys(all).sort();
  };
  PoseLibrary.delete = function (name) {
    const all = readStore();
    if (!all[name]) return false;
    delete all[name];
    return writeStore(all);
  };
  PoseLibrary.applySaved = function (name) {
    const p = PoseLibrary.load(name);
    if (!p) return false;
    return PoseLibrary.apply(p);
  };

  window.PixiStudio.PoseLibrary = PoseLibrary;
})();
