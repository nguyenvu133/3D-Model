/* ============================================================
 * rig/arp-qr3-pose.js — POSE LIBRARY (Auto Rig Pro Blend, PHẦN 1
 * vòng mở rộng thứ 3 của Quick Rig)
 *
 * Thư viện tư thế cho control rig (window.PixiStudio.ArpQuickRig):
 *   • 8 pose preset sẵn (T-pose, A-pose, Idle, Ngồi, Vẫy tay,
 *     Chỉ tay, Cúi chào, Thế tấn công).
 *   • Lưu / tải pose tự đặt (localStorage) + xuất / nhập file JSON.
 *   • Mirror trái <-> phải (đổi xương Left<->Right + đảo dấu góc).
 *   • Blend giữa 2 pose bằng thanh trượt 0–100%.
 *   • UI section renderSection(container) để coordinator nối vào
 *     tab Quick Rig (qua ArpQuickRig.registerSection nếu có).
 *
 * Mỗi pose = map tên xương đích (chuẩn Mixamo 41 xương, KHÔNG prefix
 * mixamorig:, vd 'Hips', 'LeftArm') -> góc Euler local {x,y,z} (radian).
 * Góc trong pose là TUYỆT ĐỐI (local rotation ghi thẳng lên xương),
 * không phải offset cộng dồn: xương nào pose không liệt kê thì về 0
 * khi áp qua applyPose (reset toàn bộ rig về bind trước rồi mới áp).
 * T-pose = gần như zero rotation — đúng bind pose của skeleton do
 * AutoRigPro / Mixamo xuất ra (đo thật trên FBX rigged: mọi xương
 * bind rotation = 0).
 *
 * MIRROR (quy tắc): nhân vật đối xứng qua mặt phẳng giữa (trục X).
 * Với phép phản xạ M = diag(-1,1,1), rotation R bị mirror thành
 * M·R·M⁻¹. Với Euler order XYZ của three.js, điều này tương đương:
 * đổi xương Left <-> Right, giữ nguyên x, đảo dấu y và z.
 * Mirror 2 lần trả về đúng pose gốc (đã kiểm chứng bằng harness).
 *
 * BLEND: nội suy tuyến tính từng thành phần Euler trên hợp các
 * xương của 2 pose (xương vắng trong 1 pose được coi là 0).
 * t=0 ra đúng pose A, t=1 ra đúng pose B, t=0.5 là trung điểm.
 * Lưu ý: nội suy Euler có thể đi đường vòng với góc lớn (>180°)
 * — đủ dùng cho pose library, không phải slerp quaternion.
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Pose áp bằng FK (xoay trực tiếp xương + đồng bộ control).
 *     Nếu một chi đang ở chế độ IK, lần updateLimb IK tiếp theo
 *     có thể ghi đè tư thế của chi đó — muốn giữ pose thì chuyển
 *     chi sang FK trước khi áp pose.
 *   • Pose không chứa vị trí (chỉ rotation): Hips không dịch
 *     chuyển (vd pose Ngồi hạ thấp hông thì thân vẫn ở cao độ cũ,
 *     chỉ gập khớp). Muốn ngồi hẳn xuống cần chỉnh Hips.position
 *     riêng — ngoài phạm vi phần này.
 *   • Pose lưu ở localStorage của trình duyệt — không theo file,
 *     không đồng bộ qua GitHub (giống preset của Quick Rig).
 *   • Không làm Kilt limb, không làm 3-bone IK (ngoài phạm vi).
 * ============================================================ */
(function () {
  'use strict';

  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };
  var U = (window.PixiStudio && PixiStudio.Utils) || null;
  var QR = (window.PixiStudio && PixiStudio.ArpQuickRig) || null;
  /* Đọc lazy mỗi lần dùng: module pose có thể load trước quickrig. */
  function curQR() { return (window.PixiStudio && PixiStudio.ArpQuickRig) || QR; }

  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message }); } catch (e) {}
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* ---------- Pose preset sẵn (8 pose) ---------- */
  var PRESETS = {
    't-pose': {
      id: 't-pose', name: 'T-pose',
      desc: 'Tư thế bind: hai tay dang ngang, mọi khớp về 0.',
      bones: {}
    },
    'a-pose': {
      id: 'a-pose', name: 'A-pose',
      desc: 'Hai tay xuôi chéo xuống ~35° so với ngang.',
      bones: {
        LeftArm: { x: 0, y: 0, z: 0.6 }, RightArm: { x: 0, y: 0, z: -0.6 },
        LeftForeArm: { x: 0, y: 0, z: 0.08 }, RightForeArm: { x: 0, y: 0, z: -0.08 }
      }
    },
    'idle': {
      id: 'idle', name: 'Idle',
      desc: 'Đứng thả lỏng: tay xuôi nhẹ, khuỷu gập nhẹ, gối hơi chùng.',
      bones: {
        LeftArm: { x: 0.06, y: 0, z: 0.14 }, RightArm: { x: 0.06, y: 0, z: -0.14 },
        LeftForeArm: { x: -0.28, y: 0, z: 0 }, RightForeArm: { x: -0.28, y: 0, z: 0 },
        LeftShoulder: { x: 0, y: 0, z: 0.05 }, RightShoulder: { x: 0, y: 0, z: -0.05 },
        Spine: { x: 0.04, y: 0, z: 0 },
        LeftUpLeg: { x: -0.04, y: 0, z: 0 }, RightUpLeg: { x: -0.04, y: 0, z: 0 },
        LeftLeg: { x: 0.06, y: 0, z: 0 }, RightLeg: { x: 0.06, y: 0, z: 0 },
        Head: { x: 0.03, y: 0, z: 0 }
      }
    },
    'ngoi': {
      id: 'ngoi', name: 'Ngồi',
      desc: 'Ngồi: đùi gập ~77° về trước, gối gập ~83°, lưng hơi cúi.',
      bones: {
        Hips: { x: -0.12, y: 0, z: 0 },
        Spine: { x: 0.2, y: 0, z: 0 }, Spine1: { x: 0.14, y: 0, z: 0 },
        LeftUpLeg: { x: -1.35, y: 0, z: 0 }, RightUpLeg: { x: -1.35, y: 0, z: 0 },
        LeftLeg: { x: 1.45, y: 0, z: 0 }, RightLeg: { x: 1.45, y: 0, z: 0 },
        LeftFoot: { x: -0.35, y: 0, z: 0 }, RightFoot: { x: -0.35, y: 0, z: 0 },
        LeftArm: { x: -0.4, y: 0, z: 0.28 }, RightArm: { x: -0.4, y: 0, z: -0.28 },
        LeftForeArm: { x: -0.55, y: 0, z: 0 }, RightForeArm: { x: -0.55, y: 0, z: 0 },
        Neck: { x: -0.05, y: 0, z: 0 }, Head: { x: -0.12, y: 0, z: 0 }
      }
    },
    'vay-tay': {
      id: 'vay-tay', name: 'Vẫy tay',
      desc: 'Tay phải giơ cao vẫy, tay trái thả lỏng, đầu hơi nghiêng.',
      bones: {
        RightArm: { x: 0, y: 0, z: -2.5 },
        RightForeArm: { x: -0.55, y: 0, z: 0 },
        RightHand: { x: 0, y: 0, z: 0.35 },
        LeftArm: { x: 0.06, y: 0, z: 0.16 }, LeftForeArm: { x: -0.28, y: 0, z: 0 },
        Spine: { x: 0.03, y: 0.12, z: 0 },
        Neck: { x: 0, y: -0.05, z: 0 }, Head: { x: 0, y: -0.12, z: 0 }
      }
    },
    'chi-tay': {
      id: 'chi-tay', name: 'Chỉ tay',
      desc: 'Tay phải duỗi thẳng chỉ về phía trước, thân hơi xoay theo.',
      bones: {
        RightArm: { x: -1.5, y: 0, z: 0 },
        RightForeArm: { x: -0.05, y: 0, z: 0 },
        RightHand: { x: -0.05, y: 0, z: 0 },
        LeftArm: { x: 0.06, y: 0, z: 0.16 }, LeftForeArm: { x: -0.3, y: 0, z: 0 },
        Spine: { x: 0, y: -0.16, z: 0 },
        Neck: { x: 0, y: -0.08, z: 0 }, Head: { x: 0, y: -0.22, z: 0 }
      }
    },
    'cui-chao': {
      id: 'cui-chao', name: 'Cúi chào',
      desc: 'Cúi người: cột sống gập ~50°, cổ + đầu cúi theo, tay xuôi.',
      bones: {
        Hips: { x: 0.06, y: 0, z: 0 },
        Spine: { x: 0.55, y: 0, z: 0 }, Spine1: { x: 0.32, y: 0, z: 0 },
        Neck: { x: 0.28, y: 0, z: 0 }, Head: { x: 0.22, y: 0, z: 0 },
        LeftArm: { x: 0.18, y: 0, z: 0.12 }, RightArm: { x: 0.18, y: 0, z: -0.12 },
        LeftForeArm: { x: -0.18, y: 0, z: 0 }, RightForeArm: { x: -0.18, y: 0, z: 0 },
        LeftUpLeg: { x: -0.08, y: 0, z: 0 }, RightUpLeg: { x: -0.08, y: 0, z: 0 },
        LeftLeg: { x: 0.12, y: 0, z: 0 }, RightLeg: { x: 0.12, y: 0, z: 0 }
      }
    },
    'tan-cong': {
      id: 'tan-cong', name: 'Thế tấn công',
      desc: 'Tấn: chân trước gập, chân sau duỗi, tay phải đấm thẳng, thân xoay.',
      bones: {
        Hips: { x: 0, y: 0.15, z: 0 },
        Spine: { x: 0.12, y: 0.35, z: 0 }, Spine1: { x: 0, y: 0.15, z: 0 },
        LeftUpLeg: { x: -0.85, y: 0, z: 0 }, RightUpLeg: { x: 0.45, y: 0, z: 0 },
        LeftLeg: { x: 0.9, y: 0, z: 0 }, RightLeg: { x: 0.5, y: 0, z: 0 },
        LeftFoot: { x: -0.2, y: 0, z: 0 }, RightFoot: { x: -0.2, y: 0, z: 0 },
        RightArm: { x: -1.45, y: 0, z: 0 }, RightForeArm: { x: -0.12, y: 0, z: 0 },
        LeftArm: { x: 0.35, y: 0, z: 0.6 }, LeftForeArm: { x: -0.9, y: 0, z: 0 },
        Neck: { x: 0, y: 0.1, z: 0 }, Head: { x: 0, y: 0.25, z: 0 }
      }
    }
  };
  var PRESET_ORDER = ['t-pose', 'a-pose', 'idle', 'ngoi', 'vay-tay', 'chi-tay', 'cui-chao', 'tan-cong'];

  var POSES_KEY = 'pixistudio.arp-qr3-poses';
  var FORMAT = 'pixistudio-arp-qr3-poses-1';
  var EXPORT_FILENAME = 'pixistudio-arp-qr3-poses.json';

  var Pose = {
    presets: PRESETS,
    presetOrder: PRESET_ORDER,
    POSES_KEY: POSES_KEY,
    FORMAT: FORMAT,
    lastApplied: null,   /* {name, at} của pose áp gần nhất */
    lastBlend: null      /* {a, b, t} của blend gần nhất */
  };

  /* ---------- Pure helpers (không chạm DOM / rig) ---------- */
  function cloneEuler(e) {
    e = e || {};
    return { x: num(e.x), y: num(e.y), z: num(e.z) };
  }
  function clonePoseBones(bones) {
    var out = {};
    if (!bones) return out;
    Object.keys(bones).forEach(function (k) { out[k] = cloneEuler(bones[k]); });
    return out;
  }
  function clonePose(pose) {
    if (!pose) return null;
    return { id: pose.id || undefined, name: pose.name || '', bones: clonePoseBones(pose.bones), createdAt: pose.createdAt };
  }
  /* Đổi tên xương sang phía đối diện: Left* <-> Right*. */
  function swapSide(name) {
    if (name.indexOf('Left') === 0) return 'Right' + name.slice(4);
    if (name.indexOf('Right') === 0) return 'Left' + name.slice(5);
    return name;
  }
  /* Mirror 1 góc Euler: giữ x, đảo dấu y và z (xem chú thích đầu file). */
  function mirrorEuler(e) {
    e = cloneEuler(e);
    return { x: e.x, y: -e.y, z: -e.z };
  }
  function mirrorPoseData(pose) {
    var src = (pose && pose.bones) || {};
    var out = {};
    Object.keys(src).forEach(function (dst) {
      out[swapSide(dst)] = mirrorEuler(src[dst]);
    });
    return {
      id: pose && pose.id ? pose.id + '-mirrored' : undefined,
      name: (pose && pose.name ? pose.name : 'Pose') + ' (mirror)',
      bones: out
    };
  }
  function blendPoseData(poseA, poseB, t) {
    t = clamp(num(t), 0, 1);
    var a = (poseA && poseA.bones) || {};
    var b = (poseB && poseB.bones) || {};
    var keys = {};
    Object.keys(a).forEach(function (k) { keys[k] = true; });
    Object.keys(b).forEach(function (k) { keys[k] = true; });
    var out = {};
    Object.keys(keys).forEach(function (dst) {
      var ea = cloneEuler(a[dst]), eb = cloneEuler(b[dst]);
      out[dst] = {
        x: ea.x + (eb.x - ea.x) * t,
        y: ea.y + (eb.y - ea.y) * t,
        z: ea.z + (eb.z - ea.z) * t
      };
    });
    return {
      name: (poseA && poseA.name || 'A') + ' → ' + (poseB && poseB.name || 'B') + ' (' + Math.round(t * 100) + '%)',
      bones: out
    };
  }
  function normalizePoseData(pose) {
    if (!pose || typeof pose !== 'object') return null;
    var bones = pose.bones;
    if (!bones || typeof bones !== 'object') return null;
    var out = {};
    var ok = false;
    Object.keys(bones).forEach(function (dst) {
      var e = bones[dst];
      if (!e || typeof e !== 'object') return;
      if (!isFinite(Number(e.x)) && !isFinite(Number(e.y)) && !isFinite(Number(e.z))) return;
      out[dst] = cloneEuler(e);
      ok = true;
    });
    if (!ok) return null;
    return { name: String(pose.name || 'Pose'), bones: out, createdAt: isFinite(Number(pose.createdAt)) ? Number(pose.createdAt) : Date.now() };
  }
  /* Kiểm tra 1 pose set JSON import: trả {ok, poses:[đã chuẩn hóa], skipped:[{name, reason}]} */
  function validatePoseSet(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'Dữ liệu không phải object JSON.' };
    if (obj.format !== FORMAT) return { ok: false, error: 'Sai format: cần "' + FORMAT + '", nhận "' + (obj.format || '(không có)') + '".' };
    if (!Array.isArray(obj.poses)) return { ok: false, error: 'Thiếu mảng "poses".' };
    var poses = [], skipped = [];
    obj.poses.forEach(function (p, i) {
      var n = normalizePoseData(p);
      if (!n) skipped.push({ name: (p && p.name) || ('#' + i), reason: 'pose không hợp lệ (thiếu tên hoặc bones)' });
      else poses.push(n);
    });
    return { ok: true, poses: poses, skipped: skipped };
  }

  /* ---------- Lưu trữ pose tự đặt (localStorage + fallback RAM) ---------- */
  var memStore = null; /* fallback khi localStorage không dùng được */
  function storageGet() {
    try {
      if (typeof window.localStorage !== 'undefined' && window.localStorage) return window.localStorage;
    } catch (e) {}
    return null;
  }
  function loadSavedRaw() {
    var ls = storageGet();
    var raw = null;
    try { raw = ls ? ls.getItem(POSES_KEY) : memStore; } catch (e) { raw = memStore; }
    if (!raw) return { format: FORMAT, poses: [] };
    try {
      var obj = JSON.parse(raw);
      if (obj && Array.isArray(obj.poses)) return obj;
    } catch (e) {}
    return { format: FORMAT, poses: [] };
  }
  function saveSavedRaw(set) {
    var raw = JSON.stringify(set);
    var ls = storageGet();
    try {
      if (ls) ls.setItem(POSES_KEY, raw);
      else memStore = raw;
    } catch (e) { memStore = raw; }
  }
  function listPoses() {
    return loadSavedRaw().poses.map(function (p) { return clonePose(p); });
  }
  Pose.listPoses = listPoses;
  function presetList() {
    return PRESET_ORDER.map(function (id) { return clonePose(PRESETS[id]); });
  }
  Pose.presetList = presetList;

  /* Tìm pose theo id preset, tên preset, hoặc tên pose đã lưu. */
  function resolvePose(input) {
    if (!input) return null;
    if (typeof input === 'object' && input.bones) return clonePose(input);
    var key = String(input);
    if (PRESETS[key]) return clonePose(PRESETS[key]);
    var found = null;
    PRESET_ORDER.forEach(function (id) { if (PRESETS[id].name === key) found = clonePose(PRESETS[id]); });
    if (found) return found;
    listPoses().forEach(function (p) { if (p.name === key) found = p; });
    return found;
  }
  Pose.resolvePose = resolvePose;
  function getPose(name) { return resolvePose(name); }
  Pose.getPose = getPose;

  /* ---------- Áp pose ---------- */
  /* Áp trực tiếp lên 1 map xương (dst -> THREE.Bone): chỉ chạm các
   * xương có trong pose, không reset xương khác, không đụng fkRotations.
   * Dùng khi muốn áp pose lên skeleton bất kỳ (không qua control rig). */
  function applyPoseToBones(bones, pose, opts) {
    if (!bones || typeof bones !== 'object') return { ok: false, error: 'Không có map xương.' };
    var p = resolvePose(pose);
    if (!p) return { ok: false, error: 'Không tìm thấy pose: ' + pose };
    var applied = 0, missing = [];
    Object.keys(p.bones).forEach(function (dst) {
      var bone = bones[dst];
      if (!bone) { missing.push(dst); return; }
      var e = p.bones[dst];
      bone.rotation.set(e.x, e.y, e.z);
      applied++;
    });
    return { ok: true, pose: p.name, applied: applied, missing: missing };
  }
  Pose.applyPoseToBones = applyPoseToBones;

  /* Áp pose lên control rig đang active: reset toàn bộ xương map về 0
   * (bind) rồi áp pose, cập nhật fkRotations + control tương ứng. */
  function applyPose(pose, opts) {
    opts = opts || {};
    var cur = curQR() && curQR().current;
    if (!cur) return { ok: false, error: 'Chưa có control rig — bấm Auto Gen / Convert trước.' };
    var p = resolvePose(pose);
    if (!p) return { ok: false, error: 'Không tìm thấy pose: ' + pose };
    var reset = opts.reset !== false;
    if (reset) {
      Object.keys(cur.bones).forEach(function (dst) {
        var bone = cur.bones[dst];
        if (bone) bone.rotation.set(0, 0, 0);
      });
    }
    var r = applyPoseToBones(cur.bones, p);
    if (!r.ok) return r;
    /* Đồng bộ fkRotations + control với tư thế cuối cùng của mọi xương. */
    Object.keys(cur.bones).forEach(function (dst) {
      var bone = cur.bones[dst];
      if (!bone) return;
      var rot = { x: bone.rotation.x, y: bone.rotation.y, z: bone.rotation.z };
      cur.fkRotations[dst] = rot;
      if (cur.controls && cur.controls[dst]) cur.controls[dst].rotation.set(rot.x, rot.y, rot.z);
    });
    try { if (cur.target) cur.target.updateMatrixWorld(true); } catch (e) {}
    Pose.lastApplied = { name: p.name, at: Date.now() };
    return { ok: true, pose: p.name, applied: r.applied, missing: r.missing, reset: reset };
  }
  Pose.applyPose = applyPose;

  /* Chụp tư thế hiện tại của control rig thành 1 pose (mọi xương map). */
  function captureCurrentPose(name) {
    var cur = curQR() && curQR().current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    var bones = {};
    Object.keys(cur.bones).forEach(function (dst) {
      var bone = cur.bones[dst];
      if (bone) bones[dst] = { x: bone.rotation.x, y: bone.rotation.y, z: bone.rotation.z };
    });
    return { ok: true, pose: { name: name || 'Pose hiện tại', bones: bones, createdAt: Date.now() } };
  }
  Pose.captureCurrentPose = captureCurrentPose;

  /* ---------- Mirror ---------- */
  function mirrorPose(pose) {
    var p = resolvePose(pose);
    if (!p) return null;
    return mirrorPoseData(p);
  }
  Pose.mirrorPose = mirrorPose;
  function applyMirroredPose(pose) {
    var m = mirrorPose(pose);
    if (!m) return { ok: false, error: 'Không tìm thấy pose: ' + pose };
    return applyPose(m);
  }
  Pose.applyMirroredPose = applyMirroredPose;
  /* Mirror tư thế ĐANG ở trên rig (chụp hiện tại -> mirror -> áp). */
  function mirrorCurrentPose() {
    var cap = captureCurrentPose('Pose hiện tại (mirror)');
    if (!cap.ok) return cap;
    return applyPose(mirrorPoseData(cap.pose));
  }
  Pose.mirrorCurrentPose = mirrorCurrentPose;

  /* ---------- Blend ---------- */
  function blendPose(poseA, poseB, t) {
    var a = resolvePose(poseA), b = resolvePose(poseB);
    if (!a) return { ok: false, error: 'Không tìm thấy pose A: ' + poseA };
    if (!b) return { ok: false, error: 'Không tìm thấy pose B: ' + poseB };
    t = clamp(num(t), 0, 1);
    var blended = blendPoseData(a, b, t);
    var r = applyPose(blended);
    if (!r.ok) return r;
    Pose.lastBlend = { a: a.name, b: b.name, t: t };
    return { ok: true, pose: blended.name, t: t, applied: r.applied, missing: r.missing };
  }
  Pose.blendPose = blendPose;

  /* ---------- Lưu / tải / xóa pose tự đặt ---------- */
  function savePose(name, pose) {
    if (!name || !String(name).trim()) return { ok: false, error: 'Chưa nhập tên pose.' };
    name = String(name).trim();
    var toSave = null;
    if (pose) {
      toSave = normalizePoseData(resolvePose(pose) || pose);
      if (!toSave) return { ok: false, error: 'Pose cần lưu không hợp lệ.' };
      toSave.name = name;
    } else {
      var cap = captureCurrentPose(name);
      if (!cap.ok) return cap;
      toSave = cap.pose;
    }
    toSave.createdAt = Date.now();
    var set = loadSavedRaw();
    var replaced = false;
    set.poses = set.poses.map(function (p) {
      if (p.name === name) { replaced = true; return toSave; }
      return p;
    });
    if (!replaced) set.poses.push(toSave);
    set.format = FORMAT;
    saveSavedRaw(set);
    return { ok: true, name: name, bones: Object.keys(toSave.bones).length, replaced: replaced, total: set.poses.length };
  }
  Pose.savePose = savePose;

  function loadPose(name) {
    if (!name) return { ok: false, error: 'Chưa nhập tên pose.' };
    var saved = null;
    listPoses().forEach(function (p) { if (p.name === String(name)) saved = p; });
    if (saved) {
      var r = applyPose(saved);
      if (r.ok) r.source = 'saved';
      return r;
    }
    if (PRESETS[String(name)] || PRESET_ORDER.some(function (id) { return PRESETS[id].name === String(name); })) {
      var rp = applyPose(String(name));
      if (rp.ok) rp.source = 'preset';
      return rp;
    }
    return { ok: false, error: 'Không tìm thấy pose đã lưu hay preset: ' + name };
  }
  Pose.loadPose = loadPose;

  function deletePose(name) {
    if (!name) return { ok: false, error: 'Chưa nhập tên pose.' };
    var set = loadSavedRaw();
    var before = set.poses.length;
    set.poses = set.poses.filter(function (p) { return p.name !== String(name); });
    if (set.poses.length === before) return { ok: false, error: 'Không có pose đã lưu tên: ' + name };
    saveSavedRaw(set);
    return { ok: true, name: String(name), total: set.poses.length };
  }
  Pose.deletePose = deletePose;

  /* ---------- Xuất / nhập pose set JSON ---------- */
  function exportPoses() {
    var poses = listPoses();
    var obj = { format: FORMAT, exportedAt: new Date().toISOString(), poses: poses };
    var json = JSON.stringify(obj, null, 2);
    if (U && typeof U.downloadText === 'function') {
      try { U.downloadText(json, EXPORT_FILENAME, 'application/json'); } catch (e) {}
    }
    return { ok: true, json: json, count: poses.length, filename: EXPORT_FILENAME };
  }
  Pose.exportPoses = exportPoses;

  function importPoses(input) {
    var obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); }
      catch (e) { return { ok: false, error: 'JSON không parse được: ' + (e && e.message) }; }
    }
    var v = validatePoseSet(obj);
    if (!v.ok) return v;
    var set = loadSavedRaw();
    var imported = 0;
    v.poses.forEach(function (p) {
      var replaced = false;
      set.poses = set.poses.map(function (old) {
        if (old.name === p.name) { replaced = true; return p; }
        return old;
      });
      if (!replaced) set.poses.push(p);
      imported++;
    });
    set.format = FORMAT;
    saveSavedRaw(set);
    return { ok: true, imported: imported, skipped: v.skipped, total: set.poses.length };
  }
  Pose.importPoses = importPoses;

  /* ---------- UI ---------- */
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

  function renderSection(container) {
    if (!container) return;
    container.innerHTML = '';
    var wrap = el('div', { class: 'arp-qr3-pose-section', style: { border: '1px solid #888', borderRadius: '6px', padding: '8px', margin: '6px 0' } });
    wrap.appendChild(el('div', { html: '<b>Pose Library</b> — thư viện tư thế cho control rig (FK). Pose chỉ chứa góc xoay khớp, không chứa vị trí.' }));
    var noRigNote = el('div', { class: 'arp-note', style: { fontSize: '12px', color: '#c00', margin: '4px 0' },
      text: 'Chưa có control rig — bấm Auto Gen / Convert ở trên trước khi áp pose.' });
    wrap.appendChild(noRigNote);
    var refreshRigNote = function () {
      noRigNote.style.display = (curQR() && curQR().current) ? 'none' : 'block';
    };
    refreshRigNote();

    /* --- Pose preset sẵn --- */
    wrap.appendChild(el('div', { html: '<b>Pose có sẵn</b>', style: { marginTop: '6px' } }));
    var presetBox = el('div', {});
    presetList().forEach(function (preset) {
      var row = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0' } });
      row.appendChild(el('span', { text: preset.name + ' (' + Object.keys(preset.bones).length + ' khớp)', style: { flex: '1' } }));
      row.appendChild(el('span', { text: preset.desc, style: { flex: '2', fontSize: '12px', color: '#555' } }));
      row.appendChild(el('button', { class: 'btn sm', text: 'Áp dụng', onclick: function () {
        refreshRigNote();
        var r = applyPose(preset.id);
        if (!r.ok) notify('warning', 'Pose Library', r.error);
        else notify('info', 'Pose Library', 'Đã áp pose "' + preset.name + '" (' + r.applied + ' khớp).');
      } }));
      row.appendChild(el('button', { class: 'btn sm', text: 'Mirror', onclick: function () {
        refreshRigNote();
        var r = applyMirroredPose(preset.id);
        if (!r.ok) notify('warning', 'Pose Library', r.error);
        else notify('info', 'Pose Library', 'Đã áp mirror của "' + preset.name + '".');
      } }));
      presetBox.appendChild(row);
    });
    wrap.appendChild(presetBox);

    /* --- Pose đã lưu --- */
    wrap.appendChild(el('div', { html: '<b>Pose đã lưu</b>', style: { marginTop: '8px' } }));
    var savedBox = el('div', {});
    var refreshSaved = function () {
      savedBox.innerHTML = '';
      var saved = listPoses();
      if (!saved.length) {
        savedBox.appendChild(el('div', { class: 'arp-note', style: { fontSize: '12px', color: '#555' }, text: 'Chưa có pose nào lưu — áp 1 pose rồi đặt tên lưu lại ở dưới.' }));
        return;
      }
      saved.forEach(function (p) {
        var row = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0' } });
        row.appendChild(el('span', { text: p.name + ' (' + Object.keys(p.bones).length + ' khớp)', style: { flex: '1' } }));
        row.appendChild(el('button', { class: 'btn sm', text: 'Áp dụng', onclick: function () {
          var r = loadPose(p.name);
          if (!r.ok) notify('warning', 'Pose Library', r.error);
        } }));
        row.appendChild(el('button', { class: 'btn sm', text: 'Mirror', onclick: function () {
          var m = mirrorPose(p);
          var r = applyPose(m);
          if (!r.ok) notify('warning', 'Pose Library', r.error);
        } }));
        row.appendChild(el('button', { class: 'btn sm', text: 'Xóa', onclick: function () {
          deletePose(p.name);
          refreshSaved();
        } }));
        savedBox.appendChild(row);
      });
    };
    wrap.appendChild(savedBox);
    refreshSaved();

    /* --- Lưu pose hiện tại / Xuất / Nhập --- */
    var saveRow = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' } });
    var nameInput = el('input', { type: 'text', placeholder: 'Tên pose mới…', style: { flex: '1', minWidth: '120px' } });
    saveRow.appendChild(nameInput);
    saveRow.appendChild(el('button', { class: 'btn sm', text: 'Lưu pose hiện tại', style: { fontWeight: 'bold' }, onclick: function () {
      var r = savePose(nameInput.value);
      if (!r.ok) notify('warning', 'Pose Library', r.error);
      else { notify('info', 'Pose Library', 'Đã lưu pose "' + r.name + '" (' + r.bones + ' khớp).'); nameInput.value = ''; refreshSaved(); refreshBlendOptions(); }
    } }));
    saveRow.appendChild(el('button', { class: 'btn sm', text: 'Mirror pose hiện tại', onclick: function () {
      var r = mirrorCurrentPose();
      if (!r.ok) notify('warning', 'Pose Library', r.error);
      else notify('info', 'Pose Library', 'Đã mirror tư thế hiện tại.');
    } }));
    saveRow.appendChild(el('button', { class: 'btn sm', text: 'Về T-pose', onclick: function () {
      var r = applyPose('t-pose');
      if (!r.ok) notify('warning', 'Pose Library', r.error);
    } }));
    wrap.appendChild(saveRow);
    var ioRow = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' } });
    ioRow.appendChild(el('button', { class: 'btn sm', text: 'Xuất pose ra JSON', onclick: function () {
      var r = exportPoses();
      notify('info', 'Pose Library', 'Đã xuất ' + r.count + ' pose ra file ' + r.filename + '.');
    } }));
    var fileInput = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (typeof FileReader === 'undefined') { notify('error', 'Pose Library', 'Trình duyệt này không hỗ trợ đọc file.'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var r = importPoses(reader.result);
        if (!r.ok) notify('error', 'Pose Library', r.error);
        else { notify('info', 'Pose Library', 'Đã nhập ' + r.imported + ' pose' + (r.skipped.length ? ' (bỏ ' + r.skipped.length + ' pose lỗi)' : '') + '.'); refreshSaved(); refreshBlendOptions(); }
      };
      reader.readAsText(f);
    });
    wrap.appendChild(fileInput);
    ioRow.appendChild(el('button', { class: 'btn sm', text: 'Nhập pose từ JSON', onclick: function () { fileInput.click(); } }));
    wrap.appendChild(ioRow);

    /* --- Blend giữa 2 pose --- */
    wrap.appendChild(el('div', { html: '<b>Blend 2 pose</b>', style: { marginTop: '8px' } }));
    var blendRow = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', margin: '3px 0' } });
    var selA = el('select', { style: { flex: '1' } });
    var selB = el('select', { style: { flex: '1' } });
    var refreshBlendOptions = function () {
      [selA, selB].forEach(function (sel, idx) {
        var prev = sel.value;
        sel.innerHTML = '';
        presetList().forEach(function (p) {
          var opt = el('option', { value: 'preset:' + p.id, text: p.name });
          sel.appendChild(opt);
        });
        listPoses().forEach(function (p) {
          sel.appendChild(el('option', { value: 'saved:' + p.name, text: p.name + ' (đã lưu)' }));
        });
        if (prev) sel.value = prev;
        if (!sel.value) sel.value = idx === 0 ? 'preset:t-pose' : 'preset:idle';
      });
    };
    var resolveBlendValue = function (v) {
      if (!v) return null;
      if (v.indexOf('preset:') === 0) return PRESETS[v.slice(7)] || null;
      if (v.indexOf('saved:') === 0) {
        var found = null;
        listPoses().forEach(function (p) { if (p.name === v.slice(6)) found = p; });
        return found;
      }
      return resolvePose(v);
    };
    refreshBlendOptions();
    blendRow.appendChild(el('span', { text: 'A:' }));
    blendRow.appendChild(selA);
    blendRow.appendChild(el('span', { text: 'B:' }));
    blendRow.appendChild(selB);
    wrap.appendChild(blendRow);
    var sliderRow = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0' } });
    sliderRow.appendChild(el('span', { text: 'Blend:', style: { width: '48px' } }));
    var slider = el('input', { type: 'range', min: '0', max: '100', step: '1', value: '0', style: { flex: '1' } });
    var pct = el('span', { text: '0%', style: { width: '40px' } });
    var doBlend = function () {
      var t = parseFloat(slider.value) / 100;
      pct.textContent = slider.value + '%';
      var a = resolveBlendValue(selA.value), b = resolveBlendValue(selB.value);
      if (!a || !b) return;
      var r = blendPose(a, b, t);
      if (!r.ok) notify('warning', 'Pose Library', r.error);
    };
    slider.addEventListener('input', doBlend);
    selA.addEventListener('change', doBlend);
    selB.addEventListener('change', doBlend);
    sliderRow.appendChild(slider);
    sliderRow.appendChild(pct);
    wrap.appendChild(sliderRow);
    wrap.appendChild(el('div', { style: { fontSize: '12px', color: '#555' },
      text: 'Kéo thanh trượt để blend trực tiếp trên rig: 0% = pose A, 100% = pose B.' }));

    container.appendChild(wrap);
  }
  Pose.renderSection = renderSection;

  /* ---------- Test hooks (pure functions) ---------- */
  Pose._test = {
    PRESETS: PRESETS,
    PRESET_ORDER: PRESET_ORDER,
    FORMAT: FORMAT,
    POSES_KEY: POSES_KEY,
    cloneEuler: cloneEuler,
    clonePoseBones: clonePoseBones,
    swapSide: swapSide,
    mirrorEuler: mirrorEuler,
    mirrorPoseData: mirrorPoseData,
    blendPoseData: blendPoseData,
    normalizePoseData: normalizePoseData,
    validatePoseSet: validatePoseSet,
    resolvePose: resolvePose
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpQuickRig = window.PixiStudio.ArpQuickRig || {};
  window.PixiStudio.ArpQuickRig.Pose = Pose;

  /* Hook để coordinator nối section vào tab Quick Rig (nếu đã có). */
  try {
    var Q = window.PixiStudio.ArpQuickRig;
    if (Q && typeof Q.registerSection === 'function') Q.registerSection('pose', renderSection);
  } catch (e) {}
})();
