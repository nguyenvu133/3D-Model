/* arp-sync-control.js — ĐỒNG BỘ CONTROL 2 CHIỀU (Quick Rig ↔ Animator)
 * + MIXAMO RIG PLUGIN ĐỒNG BỘ VỚI ANIMATOR (vòng đồng bộ 2/4).
 *
 * File MỚI DUY NHẤT của vòng này. KHÔNG sửa file khác: chỉ đọc API
 * thật của ArpQuickRig / ArpQr3AdvIK / ArpKeyframe / ArpAnimator /
 * ArpPluginMixamoRig và gọi chúng, không viết lại solver, mixer hay bake.
 *
 *   namespace: PixiStudio.ArpSyncControl
 *
 * 1. CONTROL QUICK RIG ↔ ANIMATOR 2 CHIỀU
 *  (a) syncControlsFromClip(clip, time): đọc pose clip tại thời điểm t
 *      (Animator.sampleClipPose, fallback sampler nội bộ) rồi cập nhật
 *      GIÁ TRỊ HIỂN THỊ của control cho khớp: finger curl (từ góc xoay
 *      X các đốt ngón), foot roll (từ Foot/ToeBase), spine/head/neck/
 *      jaw (từ Euler của xương), IK/FK blend từng chi + vị trí control
 *      cuối chi và pole (đi theo pose clip). IK/FK blend là ƯỚC LƯỢNG
 *      heuristic, KHÔNG phải ground truth: clip chỉ lưu quaternion
 *      xương, không lưu chế độ IK/FK. Cách ước lượng: giải IK 2-bone
 *      (QuickRig.solveTwoBoneIK qua updateLimb) về đúng vị trí cuối
 *      chi của clip với pole hiện tại; nếu nghiệm IK khớp pose clip
 *      (tổng lệch quaternion root+mid nhỏ) thì coi như clip đi theo
 *      IK (blend → 1), ngược lại coi như FK (blend → 0), ngưỡng 0.6
 *      rad. Clip Mixamo vốn là FK nên thường đọc blend thấp — đúng
 *      bản chất, không phải lỗi.
 *  (b) Control THẮNG clip khi phát: wrapAnimatorTick() bọc Animator.tick
 *      (giữ nguyên hàm gốc, khôi phục được bằng unwrapAnimatorTick):
 *      sau mỗi tick mixer viết pose clip, applyControlState() áp lại
 *      control state hiện tại của Quick Rig lên xương. Chỉ áp những
 *      control user ĐÃ ĐỔI kể từ lúc phát (dirty tracking — xem dưới),
 *      nên phát clip bình thường không bị đóng băng. wrapQuickRigControls()
 *      bọc các setter Quick Rig/MixamoRig (setLimbMode, setFingerCurl,
 *      setFootRoll, setSpineRotation, setHeadRotation, setNeckRotation,
 *      setJaw, MixamoRig.setBlend): mỗi lần user đổi control giữa lúc
 *      phát thì đánh dấu dirty + phát bus 'arp:quickrig-control-changed'
 *      + áp ngay trong frame đó (không chờ tick sau). install() bật cả
 *      hai lớp bọc, uninstall() gỡ cả hai.
 *      LƯU Ý: control thắng clip chỉ đúng khi lớp bọc đang bật. Nếu
 *      coordinator chưa gọi install() (hoặc đã uninstall) thì Animator
 *      phát clip như cũ, control không thắng.
 *
 * 2. MIXAMO RIG PLUGIN ĐỒNG BỘ VỚI ANIMATOR
 *  (a) playClipOnMixamoRig(clip): phát clip Mixamo trên control rig —
 *      build bằng MixamoRig.buildMixamoRig (bên trong gọi
 *      detectMixamo/autoGenMixamo đã có), gắn clip lạ vào rig bằng
 *      QuickRig.attachMixamoClips, phát bằng MixamoRig.playClip
 *      (mixer của rig). tickMixamoRig(dt) tick mixer rồi gọi
 *      syncControlsFromClip(..., {applyToBones:false}) để control
 *      (state + vị trí control object) đi theo clip mà không đánh
 *      nhau với mixer (mixer viết xương, sync chỉ viết state).
 *  (b) bakeCurrentAnimatorClip({fps, trim, retime, name}): đọc clip
 *      ĐANG CHỌN trong Animator qua API thật (getClip(currentId)),
 *      áp trim/retime (Animator.trimClip/retimeClip) TRƯỚC khi bake
 *      nếu opts có yêu cầu — clip đã trim/retime bằng editCurrentClip
 *      thì bản thân entry.clip đã là clip mới nên bake đúng duration
 *      sau trim mà không cần opts. Bake: nếu clip đã gắn trên rig và
 *      không có transform thì dùng MixamoRig.bakeClip có sẵn; ngược
 *      lại sample bằng mixer riêng (cùng thuật toán: mixer.setTime
 *      từng frame, ghi quaternion xương + vị trí Hips, KHÔNG reset về
 *      bind pose — snapshot/restore pose thay vì restoreBindPose).
 *      Chỉ nhận fps 24/30/60 (như MixamoRig), mặc định 30. Clip bake
 *      sample theo fps nên ở frame lẻ có thể hơi khác clip gốc
 *      (nội suy tuyến tính/slerp giữa 2 key gốc gần nhất).
 *  (c) Sau khi bake, clip được đăng ký vào Animator bằng
 *      Animator.registerClip (xuất hiện trong listClips) và phát bus
 *      'arp:animator-clip-changed' {action:'baked', ...}.
 *
 * KHÔNG có UI/tab riêng, KHÔNG cần CSS mới. Coordinator chỉ cần append
 * 1 script tag (xem cuối file).
 */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined') ? window.PixiStudio : null;
  if (!PS) PS = (typeof PixiStudio !== 'undefined') ? PixiStudio : {};
  if (typeof window !== 'undefined') window.PixiStudio = PS;

  function getTHREE() {
    if (typeof window !== 'undefined' && window.THREE) return window.THREE;
    if (typeof THREE !== 'undefined') return THREE;
    return null;
  }
  function getQR() { return PS.ArpQuickRig || null; }
  function getAN() { return PS.ArpAnimator || null; }
  function getMR() { return PS.ArpPluginMixamoRig || null; }
  function getAdvIK() { var QR = getQR(); return (QR && QR.AdvIK) ? QR.AdvIK : null; }
  function getBus() {
    if (PS.bus && typeof PS.bus.emit === 'function') return PS.bus;
    return { emit: function () {}, on: function () {} };
  }
  function getTarget() {
    var QR = getQR(), MR = getMR(), AN = getAN();
    if (MR && typeof MR.getState === 'function') {
      try { var st = MR.getState(); if (st && st.target) return st.target; } catch (e) {}
    }
    if (QR && QR.current && QR.current.target) return QR.current.target;
    if (AN && AN._target) return AN._target;
    if (PS.Viewport && typeof PS.Viewport.getMainModel === 'function') {
      try { return PS.Viewport.getMainModel(); } catch (e) { return null; }
    }
    return null;
  }
  function clamp(v, lo, hi) { v = Number(v); if (!isFinite(v)) v = lo; return Math.max(lo, Math.min(hi, v)); }
  function round4(v) { return Math.round(v * 10000) / 10000; }
  function stripName(name) {
    var QR = getQR();
    if (QR && typeof QR.stripName === 'function') { try { return QR.stripName(name); } catch (e) {} }
    return String(name || '').replace(/^mixamorig:/i, '');
  }

  var LIMBS = ['LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'];
  var FINGER_CHAINS = {
    Left: ['LeftHandThumb1', 'LeftHandThumb2', 'LeftHandIndex1', 'LeftHandIndex2',
      'LeftHandMiddle1', 'LeftHandMiddle2', 'LeftHandRing1', 'LeftHandRing2', 'LeftHandPinky1'],
    Right: ['RightHandThumb1', 'RightHandThumb2', 'RightHandIndex1', 'RightHandIndex2',
      'RightHandMiddle1', 'RightHandMiddle2', 'RightHandRing1', 'RightHandRing2', 'RightHandPinky1']
  };
  var BLEND_IK_MATCH_RAD = 0.6; /* tổng lệch quat root+mid dưới ngưỡng này → coi như IK */

  /* Dirty tracking: control nào user đã đổi kể từ lúc phát (hoặc kể từ
     lần syncControlsFromClip gần nhất). applyControlState áp lại những
     control dirty ở MỌI frame trong lúc phát — dirty KHÔNG bị xóa khi
     áp (xóa mới làm tick sau mất tác dụng). Dirty chỉ được xóa khi:
     syncControlsFromClip đồng bộ lại từ clip, Animator.stop, hoặc
     uninstall(). */
  var dirty = { limbs: {}, fingers: {}, foot: {}, spine: {}, head: false, neck: false, jaw: false };
  function clearAllDirty() {
    dirty = { limbs: {}, fingers: {}, foot: {}, spine: {}, head: false, neck: false, jaw: false };
  }
  function markDirty(kind, key) {
    if (kind === 'limb') dirty.limbs[key] = true;
    else if (kind === 'finger') dirty.fingers[key] = true;
    else if (kind === 'foot') dirty.foot[key] = true;
    else if (kind === 'spine') dirty.spine[key] = true;
    else if (kind === 'head') dirty.head = true;
    else if (kind === 'neck') dirty.neck = true;
    else if (kind === 'jaw') dirty.jaw = true;
  }
  function clearDirty(kind, key) {
    if (kind === 'limb') delete dirty.limbs[key];
    else if (kind === 'finger') delete dirty.fingers[key];
    else if (kind === 'foot') delete dirty.foot[key];
    else if (kind === 'spine') delete dirty.spine[key];
    else if (kind === 'head') dirty.head = false;
    else if (kind === 'neck') dirty.neck = false;
    else if (kind === 'jaw') dirty.jaw = false;
  }
  function markAllControlsDirty() {
    LIMBS.forEach(function (l) { dirty.limbs[l] = true; });
    ['Left', 'Right', 'all'].forEach(function (k) { dirty.fingers[k] = true; });
    ['Left', 'Right'].forEach(function (s) { dirty.foot[s] = true; });
    ['Spine', 'Spine1', 'Spine2'].forEach(function (d) { dirty.spine[d] = true; });
    dirty.head = true; dirty.neck = true; dirty.jaw = true;
  }

  /* ============================================================
     SAMPLER DỰ PHÒNG (chỉ dùng khi Animator.sampleClipPose chưa có)
     ============================================================ */
  function sampleQuatTrack(track, t) {
    var T = getTHREE();
    var times = track.times, vals = track.values, n = times.length;
    if (!T || !n) return null;
    function at(i) { return new T.Quaternion(vals[i * 4], vals[i * 4 + 1], vals[i * 4 + 2], vals[i * 4 + 3]); }
    if (t <= times[0] || n === 1) return at(0);
    if (t >= times[n - 1]) return at(n - 1);
    for (var i = 0; i < n - 1; i++) {
      if (t >= times[i] && t <= times[i + 1]) {
        var span = times[i + 1] - times[i];
        var a = span > 1e-6 ? (t - times[i]) / span : 0;
        return at(i).slerp(at(i + 1), a);
      }
    }
    return at(0);
  }
  function sampleVecTrack(track, t) {
    var times = track.times, vals = track.values, n = times.length;
    function at(i) { return { x: vals[i * 3], y: vals[i * 3 + 1], z: vals[i * 3 + 2] }; }
    if (!n) return { x: 0, y: 0, z: 0 };
    if (t <= times[0] || n === 1) return at(0);
    if (t >= times[n - 1]) return at(n - 1);
    for (var i = 0; i < n - 1; i++) {
      if (t >= times[i] && t <= times[i + 1]) {
        var span = times[i + 1] - times[i];
        var a = span > 1e-6 ? (t - times[i]) / span : 0;
        var va = at(i), vb = at(i + 1);
        return { x: va.x + (vb.x - va.x) * a, y: va.y + (vb.y - va.y) * a, z: va.z + (vb.z - va.z) * a };
      }
    }
    return at(0);
  }
  /* Pose quaternion toàn clip tại t: {boneStripped: Quaternion} */
  function sampleClipPoseFallback(clip, t) {
    var pose = {};
    if (!clip || !clip.tracks) return pose;
    clip.tracks.forEach(function (tr) {
      if (/\.quaternion$/i.test(tr.name || '')) {
        var q = sampleQuatTrack(tr, t);
        if (q) pose[stripName(tr.name.slice(0, tr.name.lastIndexOf('.')))] = q;
      }
    });
    return pose;
  }
  function sampleClipPose(clip, t) {
    var AN = getAN();
    if (AN && typeof AN.sampleClipPose === 'function') {
      try { return AN.sampleClipPose(clip, t) || {}; } catch (e) {}
    }
    return sampleClipPoseFallback(clip, t);
  }
  function eulerFromQuat(q) {
    var T = getTHREE();
    if (!T) return { x: 0, y: 0, z: 0 };
    var e = new T.Euler().setFromQuaternion(q, 'XYZ');
    return { x: e.x, y: e.y, z: e.z };
  }
  function worldPosOf(o) {
    var T = getTHREE();
    return new T.Vector3().setFromMatrixPosition(o.matrixWorld);
  }

  /* Áp pose clip (quaternion + position track) lên xương, trả snapshot
     để khôi phục. Chỉ chạm xương có trong clip. */
  function applyPoseToBones(clip, t, bonesByDst) {
    var saved = [];
    if (!clip || !clip.tracks) return saved;
    var target = getTarget();
    clip.tracks.forEach(function (tr) {
      var name = tr.name || '';
      var dot = name.lastIndexOf('.');
      if (dot < 0) return;
      var dst = stripName(name.slice(0, dot));
      var bone = bonesByDst[dst];
      if (!bone) return;
      var kind = name.slice(dot + 1).toLowerCase();
      if (kind === 'quaternion') {
        var q = sampleQuatTrack(tr, t);
        if (!q) return;
        saved.push({ bone: bone, quat: bone.quaternion.clone(), pos: bone.position.clone() });
        bone.quaternion.copy(q);
      } else if (kind === 'position') {
        var v = sampleVecTrack(tr, t);
        var already = saved.some(function (s) { return s.bone === bone; });
        if (!already) saved.push({ bone: bone, quat: bone.quaternion.clone(), pos: bone.position.clone() });
        bone.position.set(v.x, v.y, v.z);
      }
    });
    if (target) { try { target.updateMatrixWorld(true); } catch (e) {} }
    return saved;
  }
  function restorePose(saved) {
    saved.forEach(function (s) {
      s.bone.quaternion.copy(s.quat);
      s.bone.position.copy(s.pos);
    });
    var target = getTarget();
    if (target) { try { target.updateMatrixWorld(true); } catch (e) {} }
  }

  /* ============================================================
     SNAPSHOT CONTROL STATE (để harness/UI so sánh trước–sau)
     ============================================================ */
  function snapshotControlState() {
    var QR = getQR();
    var cur = QR && QR.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    var AdvIK = getAdvIK();
    var blends = {};
    LIMBS.forEach(function (l) {
      var b = null;
      if (AdvIK && typeof AdvIK.getBlend === 'function') {
        try { var gb = AdvIK.getBlend(l); if (gb && typeof gb.t === 'number') b = gb.t; } catch (e) {}
      }
      if (b === null && cur.advik && cur.advik.blends && typeof cur.advik.blends[l] === 'number') b = cur.advik.blends[l];
      if (b === null) b = (cur.limbModes && cur.limbModes[l] === 'IK') ? 1 : 0;
      blends[l] = b;
    });
    var snap = {
      ok: true,
      limbModes: Object.assign({}, cur.limbModes || {}),
      blends: blends,
      fingerCurl: {
        Left: (typeof QR.getFingerCurl === 'function') ? QR.getFingerCurl('Left') : (cur.fingerCurl.Left || 0),
        Right: (typeof QR.getFingerCurl === 'function') ? QR.getFingerCurl('Right') : (cur.fingerCurl.Right || 0),
        all: (typeof QR.getFingerCurl === 'function') ? QR.getFingerCurl('all') : (cur.fingerCurlAll || 0)
      },
      footRoll: {
        Left: (typeof QR.getFootRoll === 'function') ? QR.getFootRoll('Left') : (cur.footRoll.Left || 0),
        Right: (typeof QR.getFootRoll === 'function') ? QR.getFootRoll('Right') : (cur.footRoll.Right || 0)
      },
      spineRotations: Object.assign({}, cur.spineRotations || {}),
      headRotation: Object.assign({}, cur.headRotation || { x: 0, y: 0, z: 0 }),
      neckRotation: Object.assign({}, cur.neckRotation || { x: 0, y: 0, z: 0 }),
      jawOpen: cur.jawOpen || 0
    };
    var MR = getMR();
    if (MR && typeof MR.isBuilt === 'function') {
      try {
        if (MR.isBuilt() && typeof MR.getBlends === 'function') snap.mixamoBlends = MR.getBlends();
        if (MR.isBuilt() && typeof MR.getSettings === 'function') {
          var s = MR.getSettings();
          snap.mixamoFootRoll = s.footRoll;
          snap.mixamoFingerCurl = s.fingerCurl;
          snap.mixamoMaster = s.master;
        }
      } catch (e) {}
    }
    return snap;
  }
  function diffSnapshots(a, b) {
    var diffs = {}, total = 0;
    function num(key, va, vb) {
      var d = Math.abs((va || 0) - (vb || 0));
      if (d > 1e-6) { diffs[key] = round4(d); total += d; }
    }
    if (!a || !b || !a.ok || !b.ok) return { changed: false, diffs: diffs, total: 0 };
    LIMBS.forEach(function (l) { num('blend.' + l, a.blends[l], b.blends[l]); });
    ['Left', 'Right', 'all'].forEach(function (k) { num('finger.' + k, a.fingerCurl[k], b.fingerCurl[k]); });
    ['Left', 'Right'].forEach(function (s) { num('foot.' + s, a.footRoll[s], b.footRoll[s]); });
    ['Spine', 'Spine1', 'Spine2'].forEach(function (d) {
      var ea = a.spineRotations[d] || { x: 0, y: 0, z: 0 }, eb = b.spineRotations[d] || { x: 0, y: 0, z: 0 };
      num('spine.' + d + '.x', ea.x, eb.x); num('spine.' + d + '.y', ea.y, eb.y); num('spine.' + d + '.z', ea.z, eb.z);
    });
    ['x', 'y', 'z'].forEach(function (ax) {
      num('head.' + ax, a.headRotation[ax], b.headRotation[ax]);
      num('neck.' + ax, a.neckRotation[ax], b.neckRotation[ax]);
    });
    num('jaw', a.jawOpen, b.jawOpen);
    LIMBS.forEach(function (l) {
      if (a.limbModes[l] !== b.limbModes[l]) { diffs['mode.' + l] = a.limbModes[l] + '->' + b.limbModes[l]; total += 1; }
    });
    return { changed: total > 1e-6, diffs: diffs, total: round4(total) };
  }

  /* ============================================================
     1a. SYNC CONTROLS FROM CLIP — control phản ánh pose clip
     ============================================================ */
  function resolveClipObject(clipInput) {
    var AN = getAN(), QR = getQR();
    if (!clipInput) return null;
    if (clipInput.tracks && clipInput.name) return { clip: clipInput, entry: null, name: clipInput.name };
    if (clipInput.clip && clipInput.clip.tracks) return { clip: clipInput.clip, entry: clipInput, name: clipInput.name || clipInput.clip.name };
    if (typeof clipInput === 'string') {
      if (AN && typeof AN.getClip === 'function') {
        var e = AN.getClip(clipInput);
        if (e && e.clip) return { clip: e.clip, entry: e, name: e.name };
      }
      if (AN && typeof AN.listClips === 'function') {
        var found = null;
        AN.listClips().forEach(function (c) { if (!found && (c.name === clipInput || c.id === clipInput) && c.clip) found = c; });
        if (found) return { clip: found.clip, entry: found, name: found.name };
      }
      if (QR && QR.current && QR.current.clipByName && QR.current.clipByName[clipInput]) {
        var c2 = QR.current.clipByName[clipInput];
        return { clip: c2, entry: null, name: c2.name };
      }
    }
    return null;
  }

  function syncControlsFromClip(clipInput, time, opts) {
    opts = opts || {};
    var QR = getQR();
    var cur = QR && QR.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig — rig model trước (Quick Rig / Mixamo Rig).' };
    var T = getTHREE();
    if (!T) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var resolved = resolveClipObject(clipInput);
    if (!resolved) return { ok: false, error: 'Không resolve được clip (cần THREE.AnimationClip, entry Animator, hoặc tên clip).' };
    var clip = resolved.clip;
    if (!(clip.duration > 0)) return { ok: false, error: 'Clip "' + resolved.name + '" không có độ dài > 0.' };
    var t = clamp(Number(time) || 0, 0, clip.duration);
    var before = snapshotControlState();
    var pose = sampleClipPose(clip, t);
    var applyToBones = opts.applyToBones !== false;
    var updateBlend = opts.updateBlend !== false;

    /* ---- finger curl / foot roll / spine / head / neck / jaw ---- */
    var values = { fingerCurl: {}, footRoll: {}, spine: {}, head: null, neck: null, jaw: null };
    ['Left', 'Right'].forEach(function (side) {
      var acc = 0, n = 0;
      FINGER_CHAINS[side].forEach(function (dst) {
        if (!pose[dst]) return;
        var e = eulerFromQuat(pose[dst]);
        var isSecond = /2$/.test(dst);
        acc += clamp(e.x / (isSecond ? 1.1 : 0.8), 0, 1); n++;
      });
      if (n > 0) values.fingerCurl[side] = clamp(acc / n, 0, 1);
      var f = pose[side + 'Foot'], tb = pose[side + 'ToeBase'];
      var rolls = [];
      if (f) rolls.push(clamp(-eulerFromQuat(f).x / 0.6, 0, 1));
      if (tb) rolls.push(clamp(-eulerFromQuat(tb).x / 0.9, 0, 1));
      if (rolls.length) values.footRoll[side] = clamp(rolls.reduce(function (a, b) { return a + b; }, 0) / rolls.length, 0, 1);
    });
    ['Spine', 'Spine1', 'Spine2'].forEach(function (dst) {
      if (pose[dst]) values.spine[dst] = eulerFromQuat(pose[dst]);
    });
    if (pose.Head) values.head = eulerFromQuat(pose.Head);
    if (pose.Neck) values.neck = eulerFromQuat(pose.Neck);
    var jawBone = null;
    if (typeof QR.findJawBone === 'function') { try { jawBone = QR.findJawBone(); } catch (e) {} }
    if (jawBone) {
      var jawDst = stripName(jawBone.name);
      if (pose[jawDst]) values.jaw = clamp(eulerFromQuat(pose[jawDst]).x / 0.5, 0, 1);
    }

    /* ---- IK/FK blend từng chi (heuristic: khớp nghiệm IK?) ---- */
    var blendEvidence = {};
    var saved = null;
    try {
      var target = cur.target;
      target.updateMatrixWorld(true);
      saved = applyPoseToBones(clip, t, cur.bones); /* xương = pose clip */
      LIMBS.forEach(function (limb) {
        var def = QR.LIMBS[limb];
        if (!def) return;
        var rootBone = cur.bones[def.root], midBone = cur.bones[def.mid], endBone = cur.bones[def.end];
        if (!rootBone || !midBone || !endBone) return;
        var qRootClip = new T.Quaternion(), qMidClip = new T.Quaternion();
        try { rootBone.getWorldQuaternion(qRootClip); midBone.getWorldQuaternion(qMidClip); } catch (e) { return; }
        var endW = worldPosOf(endBone);
        var midW = worldPosOf(midBone);
        /* Đưa control cuối chi về đúng pose clip (hiển thị + làm target
           cho phép đo IK). Pole KHÔNG đưa về pose clip ở đây: phép đo
           phải dùng pole HIỆN TẠI của user — lấy pole từ clip thì nghiệm
           IK khớp clip theo cách xây dựng, blend sẽ luôn ≈ 1 (sai). */
        var endCtrl = cur.controls ? cur.controls[def.end] : null;
        var poleObj = cur.poles ? cur.poles[limb] : null;
        if (endCtrl) {
          try { endCtrl.position.copy(cur.controlGroup.worldToLocal(endW.clone())); } catch (e) {}
        }
        target.updateMatrixWorld(true);
        /* Nghiệm IK về đúng target/pole của clip, đo lệch vs pose clip. */
        var dIK = null;
        var prevMode = cur.limbModes ? cur.limbModes[limb] : null;
        try {
          if (cur.limbModes) cur.limbModes[limb] = 'IK';
          var r = QR.updateLimb(limb);
          if (r && r.ok) {
            var qRootIK = new T.Quaternion(), qMidIK = new T.Quaternion();
            rootBone.getWorldQuaternion(qRootIK); midBone.getWorldQuaternion(qMidIK);
            dIK = qRootClip.angleTo(qRootIK) + qMidClip.angleTo(qMidIK);
          }
        } catch (e) { dIK = null; }
        if (cur.limbModes) cur.limbModes[limb] = prevMode;
        /* Khôi phục xương về pose clip (updateLimb vừa viết đè). */
        restorePose(saved);
        saved = applyPoseToBones(clip, t, cur.bones);
        var currentBlend = before.blends ? before.blends[limb] : (prevMode === 'IK' ? 1 : 0);
        var blend = currentBlend;
        if (updateBlend && dIK !== null) blend = clamp(1 - dIK / BLEND_IK_MATCH_RAD, 0, 1);
        blendEvidence[limb] = { dIK: dIK === null ? null : round4(dIK), blend: round4(blend), threshold: BLEND_IK_MATCH_RAD };
        if (updateBlend) {
          if (cur.limbModes) cur.limbModes[limb] = blend >= 0.5 ? 'IK' : 'FK';
          if (cur.advik && cur.advik.blends) cur.advik.blends[limb] = blend;
          clearDirty('limb', limb);
        }
      });
    } catch (e) {
      blendEvidence._error = String(e && e.message || e);
    } finally {
      if (saved) restorePose(saved);
      /* Kết thúc: xương giữ đúng pose clip tại t. */
      applyPoseToBones(clip, t, cur.bones);
    }

    /* ---- áp giá trị control (state + xương nếu applyToBones) ---- */
    var applied = { finger: [], foot: [], spine: [], head: false, neck: false, jaw: false };
    function applyFinger(side, v) {
      if (applyToBones && typeof QR.setFingerCurl === 'function') {
        try { var r = QR.setFingerCurl(side, v); if (r && r.ok) applied.finger.push(side); } catch (e) {}
      } else {
        cur.fingerCurl[side] = v;
        applied.finger.push(side + '(state)');
      }
      clearDirty('finger', side);
    }
    function applyFoot(side, v) {
      if (applyToBones && typeof QR.setFootRoll === 'function') {
        try { var r = QR.setFootRoll(side, v); if (r && r.ok) applied.foot.push(side); } catch (e) {}
      } else {
        cur.footRoll[side] = v;
        applied.foot.push(side + '(state)');
      }
      clearDirty('foot', side);
    }
    Object.keys(values.fingerCurl).forEach(function (side) { applyFinger(side, values.fingerCurl[side]); });
    Object.keys(values.footRoll).forEach(function (side) { applyFoot(side, values.footRoll[side]); });
    Object.keys(values.spine).forEach(function (dst) {
      var e = values.spine[dst];
      if (applyToBones && typeof QR.setSpineRotation === 'function') {
        try { var r = QR.setSpineRotation(dst, e); if (r && r.ok) applied.spine.push(dst); } catch (e) {}
      } else {
        cur.spineRotations[dst] = e;
        cur.fkRotations[dst] = e;
        if (cur.controls && cur.controls[dst]) { try { cur.controls[dst].rotation.set(e.x, e.y, e.z); } catch (e2) {} }
        applied.spine.push(dst + '(state)');
      }
      clearDirty('spine', dst);
    });
    if (values.head) {
      if (applyToBones && typeof QR.setHeadRotation === 'function') {
        try { var rh = QR.setHeadRotation(values.head); if (rh && rh.ok) applied.head = true; } catch (e) {}
      } else {
        cur.headRotation = values.head;
        cur.fkRotations.Head = values.head;
        if (cur.controls && cur.controls.Head) { try { cur.controls.Head.rotation.set(values.head.x, values.head.y, values.head.z); } catch (e2) {} }
        applied.head = true;
      }
      clearDirty('head');
    }
    if (values.neck) {
      if (applyToBones && typeof QR.setNeckRotation === 'function') {
        try { var rn = QR.setNeckRotation(values.neck); if (rn && rn.ok) applied.neck = true; } catch (e) {}
      } else {
        cur.neckRotation = values.neck;
        cur.fkRotations.Neck = values.neck;
        if (cur.controls && cur.controls.Neck) { try { cur.controls.Neck.rotation.set(values.neck.x, values.neck.y, values.neck.z); } catch (e2) {} }
        applied.neck = true;
      }
      clearDirty('neck');
    }
    if (values.jaw !== null && values.jaw !== undefined) {
      if (applyToBones && typeof QR.setJaw === 'function') {
        try { var rj = QR.setJaw(values.jaw); if (rj && rj.ok) applied.jaw = true; } catch (e) {}
      } else {
        cur.jawOpen = values.jaw;
        applied.jaw = true;
      }
      clearDirty('jaw');
    }
    /* Control cuối chi + pole về đúng vị trí clip (hiển thị).
       Pole chỉ đưa về pose clip SAU khi đã đo blend xong (xem trên). */
    try {
      cur.target.updateMatrixWorld(true);
      LIMBS.forEach(function (limb) {
        var def = QR.LIMBS[limb];
        var endBone = cur.bones[def.end];
        var endCtrl = cur.controls ? cur.controls[def.end] : null;
        if (endBone && endCtrl) endCtrl.position.copy(cur.controlGroup.worldToLocal(worldPosOf(endBone)));
        var poleObj = cur.poles ? cur.poles[limb] : null;
        var midBone = cur.bones[def.mid], rootBone = cur.bones[def.root];
        if (poleObj && midBone && rootBone && endBone) {
          var endW = worldPosOf(endBone), midW = worldPosOf(midBone), rootW = worldPosOf(rootBone);
          var midPoint = rootW.clone().add(endW).multiplyScalar(0.5);
          var bendDir = midW.clone().sub(midPoint);
          if (bendDir.lengthSq() < 1e-8) bendDir = new T.Vector3(0, 0, def.kind === 'arm' ? -1 : 1);
          bendDir.normalize();
          var polePos = midW.clone().add(bendDir.multiplyScalar(Math.max(0.08, (cur.height || 1.8) * 0.12)));
          poleObj.position.copy(cur.controlGroup.worldToLocal(polePos));
        }
      });
      cur.target.updateMatrixWorld(true);
    } catch (e) {}

    /* ---- mirror state-only sang Mixamo Rig (blends/finger/foot/master) ---- */
    var after = snapshotControlState();
    syncMixamoRigStateFromQuickRig(after);
    after = snapshotControlState();
    var diff = diffSnapshots(before, after);
    try { getBus().emit('arp:quickrig-control-changed', { source: 'clip', clip: resolved.name, time: round4(t), controls: after }); } catch (e) {}
    return {
      ok: true, clip: resolved.name, time: round4(t), duration: round4(clip.duration),
      controls: after, previous: before, diff: diff, changed: diff.changed,
      blendEvidence: blendEvidence, applied: applied, appliedToBones: applyToBones
    };
  }

  /* Mirror state-only QR → MixamoRig (không gọi setter để khỏi viết xương):
     blends từng chi, finger groups, foot roll/pivot, master đi theo Hips. */
  function syncMixamoRigStateFromQuickRig(snap) {
    var MR = getMR(), QR = getQR();
    if (!MR || typeof MR.isBuilt !== 'function') return { ok: false, reason: 'Mixamo Rig chưa load.' };
    try { if (!MR.isBuilt()) return { ok: false, reason: 'Mixamo Rig chưa build.' }; } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
    var st = null;
    try { st = MR.getState(); } catch (e) {}
    if (!st) return { ok: false, reason: 'Không đọc được state Mixamo Rig.' };
    var cur = QR && QR.current;
    if (snap && snap.blends) LIMBS.forEach(function (l) { st.blends[l] = snap.blends[l]; });
    if (snap && snap.footRoll) {
      st.footRoll.Left = snap.footRoll.Left;
      st.footRoll.Right = snap.footRoll.Right;
    }
    if (snap && snap.fingerCurl) {
      var avg = clamp(((snap.fingerCurl.Left || 0) + (snap.fingerCurl.Right || 0)) / 2, 0, 1);
      st.fingerCurl.all = avg;
      st.fingerCurl.thumb = avg;
      st.fingerCurl.indexMiddle = avg;
      st.fingerCurl.ringPinky = avg;
    }
    /* Master (hiển thị): Hips hiện tại so với bind Hips lúc build. */
    try {
      if (cur && cur.bones && cur.bones.Hips && st.bindHipsPos) {
        var h = cur.bones.Hips;
        st.master.position = [round4(h.position.x - st.bindHipsPos.x), round4(h.position.y - st.bindHipsPos.y), round4(h.position.z - st.bindHipsPos.z)];
        if (st.masterObj && cur.target) {
          var T = getTHREE();
          var hw = new T.Vector3().setFromMatrixPosition(h.matrixWorld);
          st.masterObj.position.copy(cur.target.worldToLocal(hw.clone()));
        }
      }
    } catch (e) {}
    return { ok: true };
  }

  /* ============================================================
     1b. CONTROL THẮNG CLIP — áp lại control state sau mỗi tick
     ============================================================ */
  var _applying = false;
  /* Áp lại control state lên xương (control thắng clip). Chỉ áp control
     dirty — và dirty ĐƯỢC GIỮ LẠI sau khi áp để tick sau áp tiếp; xóa
     dirty chỉ khi sync từ clip / stop / uninstall (xem clearDirty). */
  function applyControlState(opts) {
    opts = opts || {};
    var QR = getQR();
    var cur = QR && QR.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    var AdvIK = getAdvIK();
    var applied = { limbs: [], fingers: [], foot: [], spine: [], head: false, neck: false, jaw: false };
    _applying = true;
    try {
      var limbsToApply = opts.all ? LIMBS.slice() : Object.keys(dirty.limbs);
      limbsToApply.forEach(function (limb) {
        var def = QR.LIMBS[limb];
        if (!def) return;
        var advBlend = null;
        if (cur.advik && cur.advik.blends && typeof cur.advik.blends[limb] === 'number') advBlend = cur.advik.blends[limb];
        var mode = cur.limbModes ? cur.limbModes[limb] : null;
        var blend = advBlend !== null ? advBlend : (mode === 'IK' ? 1 : 0);
        var r = null;
        if (blend <= 0.01) {
          if (cur.limbModes) cur.limbModes[limb] = 'FK';
          r = QR.updateLimb(limb); /* FK: áp fkRotations đã lưu */
        } else if (blend >= 0.99) {
          if (cur.limbModes) cur.limbModes[limb] = 'IK';
          r = QR.updateLimb(limb); /* IK: giải về control target */
        } else if (AdvIK && typeof AdvIK.blendIKFK === 'function') {
          /* Blend giữa: đặt gốc FK từ fkRotations đã lưu rồi slerp → IK. */
          ['root', 'mid', 'end'].forEach(function (part) {
            var dst = def[part], rot = cur.fkRotations[dst], bone = cur.bones[dst];
            if (rot && bone) bone.rotation.set(rot.x, rot.y, rot.z);
          });
          try { cur.target.updateMatrixWorld(true); } catch (e) {}
          if (cur.limbModes) cur.limbModes[limb] = blend >= 0.5 ? 'IK' : 'FK';
          r = AdvIK.blendIKFK(limb, blend);
        } else {
          if (cur.limbModes) cur.limbModes[limb] = blend >= 0.5 ? 'IK' : 'FK';
          r = QR.updateLimb(limb);
        }
        if (r && r.ok) applied.limbs.push(limb + ':' + (blend <= 0.01 ? 'FK' : blend >= 0.99 ? 'IK' : 'blend' + blend));
      });
      Object.keys(dirty.fingers).forEach(function (key) {
        var v = (key === 'all') ? (cur.fingerCurlAll || 0) : (cur.fingerCurl[key] || 0);
        try { var r = QR.setFingerCurl(key, v); if (r && r.ok) applied.fingers.push(key + '=' + v); } catch (e) {}
      });
      Object.keys(dirty.foot).forEach(function (side) {
        try { var r = QR.setFootRoll(side, cur.footRoll[side] || 0); if (r && r.ok) applied.foot.push(side); } catch (e) {}
      });
      Object.keys(dirty.spine).forEach(function (dst) {
        try { var r = QR.setSpineRotation(dst, cur.spineRotations[dst] || { x: 0, y: 0, z: 0 }); if (r && r.ok) applied.spine.push(dst); } catch (e) {}
      });
      if (dirty.head) {
        try { var rh = QR.setHeadRotation(cur.headRotation || { x: 0, y: 0, z: 0 }); if (rh && rh.ok) applied.head = true; } catch (e) {}
      }
      if (dirty.neck) {
        try { var rn = QR.setNeckRotation(cur.neckRotation || { x: 0, y: 0, z: 0 }); if (rn && rn.ok) applied.neck = true; } catch (e) {}
      }
      if (dirty.jaw) {
        try { var rj = QR.setJaw(cur.jawOpen || 0); if (rj && rj.ok) applied.jaw = true; } catch (e) {}
      }
      try { cur.target.updateMatrixWorld(true); } catch (e) {}
    } finally {
      _applying = false;
    }
    return { ok: true, applied: applied };
  }

  /* ---- bọc Animator.tick: sau mixer viết pose clip thì áp lại control ---- */
  function wrapAnimatorTick() {
    var AN = getAN();
    if (!AN || typeof AN.tick !== 'function') return { ok: false, error: 'ArpAnimator chưa load.' };
    if (SyncControl._origAnimatorTick) return { ok: true, alreadyWrapped: true };
    var orig = AN.tick;
    SyncControl._origAnimatorTick = orig;
    /* CLIPBIND-B: forward frameId cho guard chống double-update trong Animator.tick. */
    AN.tick = function (dt, frameId) {
      var r = orig(dt, frameId);
      if (r && r.ok) {
        try { applyControlState(); } catch (e) {}
      }
      return r;
    };
    /* Dừng phát → control thôi thắng clip (xóa dirty; giá trị control
       trong fkRotations/fingerCurl... vẫn giữ nguyên). */
    if (typeof AN.stop === 'function' && !AN.stop._syncWrapped) {
      var origStop = AN.stop;
      SyncControl._origAnimatorStop = origStop;
      var wrappedStop = function () {
        var r = origStop.apply(AN, arguments);
        clearAllDirty();
        return r;
      };
      wrappedStop._syncWrapped = true;
      AN.stop = wrappedStop;
    }
    return { ok: true, wrapped: true };
  }
  function unwrapAnimatorTick() {
    var AN = getAN();
    if (!AN || !SyncControl._origAnimatorTick) return { ok: false, reason: 'Tick chưa được bọc.' };
    AN.tick = SyncControl._origAnimatorTick;
    SyncControl._origAnimatorTick = null;
    if (SyncControl._origAnimatorStop) {
      try { AN.stop = SyncControl._origAnimatorStop; } catch (e) {}
      SyncControl._origAnimatorStop = null;
    }
    clearAllDirty();
    return { ok: true, unwrapped: true };
  }
  function isAnimatorTickWrapped() { return !!SyncControl._origAnimatorTick; }

  /* ---- bọc setter Quick Rig / Mixamo Rig: đổi control → dirty + event + áp ngay ---- */
  function wrapQuickRigControls() {
    var QR = getQR(), MR = getMR();
    if (!QR) return { ok: false, error: 'ArpQuickRig chưa load.' };
    if (SyncControl._origSetters) return { ok: true, alreadyWrapped: true };
    var origs = {};
    var bus = getBus();
    function emitChange(fn, data) {
      if (_applying) return;
      try { bus.emit('arp:quickrig-control-changed', Object.assign({ source: 'quickrig', fn: fn }, data || {})); } catch (e) {}
    }
    function applyNowIfPlaying() {
      if (_applying) return;
      var AN = getAN();
      if (AN && AN.playing) { try { applyControlState(); } catch (e) {} }
    }
    function wrap(obj, name, dirtyKind, keyFn, postFn) {
      if (!obj || typeof obj[name] !== 'function' || obj[name]._syncWrapped) return;
      var orig = obj[name];
      origs[name] = { obj: obj, fn: orig };
      var wrapped = function () {
        var args = Array.prototype.slice.call(arguments);
        var r = orig.apply(obj, args);
        if (_applying) return r;
        if (r && r.ok !== false) {
          try {
            var k = keyFn ? keyFn(args, r) : null;
            if (k !== null && k !== undefined) markDirty(dirtyKind, k);
          } catch (e) {}
          try { if (postFn) postFn(args, r); } catch (e) {}
          emitChange(name, { args: args, result: r });
          applyNowIfPlaying();
        }
        return r;
      };
      wrapped._syncWrapped = true;
      wrapped._syncOrig = orig;
      obj[name] = wrapped;
    }
    /* setLimbMode: chế độ rời rạc của user phải thắng blend heuristic
       (syncControlsFromClip có thể đã đặt adv.blends ≈ 1) → đồng bộ
       adv.blends theo mode vừa chọn (FK→0, IK→1). */
    function syncAdvBlendToMode(args) {
      var QR2 = getQR();
      var cur = QR2 && QR2.current;
      if (!cur || !cur.advik || !cur.advik.blends) return;
      var mode = String(args[1] || '').toUpperCase();
      if (mode === 'IK' || mode === 'FK') cur.advik.blends[args[0]] = (mode === 'IK') ? 1 : 0;
    }
    /* setFKRotation xoay trực tiếp 1 khớp: đánh dấu dirty cho chi chứa
       khớp đó để tick sau áp lại (không thì mixer ghi đè). */
    function limbOfBone(dst) {
      var QR2 = getQR();
      if (!QR2 || !QR2.LIMBS) return null;
      var d = stripName(dst);
      var found = null;
      LIMBS.forEach(function (l) {
        var def = QR2.LIMBS[l];
        if (def && (def.root === d || def.mid === d || def.end === d)) found = l;
      });
      return found;
    }
    wrap(QR, 'setLimbMode', 'limb', function (args) { return args[0]; }, syncAdvBlendToMode);
    wrap(QR, 'setFKRotation', 'limb', function (args) { return limbOfBone(args[0]); });
    wrap(QR, 'setFingerCurl', 'finger', function (args) { return args[0]; });
    wrap(QR, 'setFootRoll', 'foot', function (args) { return args[0]; });
    wrap(QR, 'setSpineRotation', 'spine', function (args) { return args[0]; });
    wrap(QR, 'setHeadRotation', 'head', function () { return null; });
    wrap(QR, 'setNeckRotation', 'neck', function () { return null; });
    wrap(QR, 'setJaw', 'jaw', function () { return null; });
    if (MR && typeof MR.setBlend === 'function') {
      wrap(MR, 'setBlend', 'limb', function (args) { return args[0]; });
    }
    SyncControl._origSetters = origs;
    return { ok: true, wrapped: Object.keys(origs) };
  }
  function unwrapQuickRigControls() {
    if (!SyncControl._origSetters) return { ok: false, reason: 'Setter chưa được bọc.' };
    Object.keys(SyncControl._origSetters).forEach(function (name) {
      var rec = SyncControl._origSetters[name];
      try { rec.obj[name] = rec.fn; } catch (e) {}
    });
    SyncControl._origSetters = null;
    return { ok: true, unwrapped: true };
  }
  function isQuickRigControlsWrapped() { return !!SyncControl._origSetters; }

  function install() {
    var a = wrapAnimatorTick();
    var b = wrapQuickRigControls();
    return { ok: a.ok && b.ok, tick: a, controls: b };
  }
  function uninstall() {
    var a = unwrapAnimatorTick();
    var b = unwrapQuickRigControls();
    return { ok: a.ok && b.ok, tick: a, controls: b };
  }

  /* ============================================================
     2. MIXAMO RIG ↔ ANIMATOR
     ============================================================ */
  function getCurrentAnimatorClip() {
    var AN = getAN();
    if (!AN || typeof AN.getClip !== 'function') return { ok: false, error: 'ArpAnimator chưa load.' };
    if (!AN.currentId) return { ok: false, error: 'Animator chưa chọn clip nào.' };
    var entry = AN.getClip(AN.currentId);
    if (!entry) return { ok: false, error: 'Không tìm thấy clip "' + AN.currentId + '" trong Animator.' };
    return {
      ok: true, entry: entry, id: entry.id, name: entry.name,
      duration: entry.duration, fps: entry.fps || 30, loop: entry.loop,
      source: entry.source, clip: entry.clip || null, keys: entry.keys || null
    };
  }

  /* (2a) Phát clip Mixamo trên control rig. clipInput: THREE clip,
     entry Animator, tên clip, hoặc index trong rig. Trả Promise. */
  function playClipOnMixamoRig(clipInput, opts) {
    opts = opts || {};
    var MR = getMR(), QR = getQR();
    if (!MR) return Promise.resolve({ ok: false, error: 'ArpPluginMixamoRig chưa load.' });
    if (!QR) return Promise.resolve({ ok: false, error: 'ArpQuickRig chưa load.' });
    var target = opts.target || getTarget();
    if (!target) return Promise.resolve({ ok: false, error: 'Chưa có model target để build Mixamo Rig.' });
    var needBuild = false;
    try { needBuild = !MR.isBuilt(); } catch (e) { needBuild = true; }
    if (!needBuild) {
      try { var st = MR.getState(); if (st && st.target && st.target !== target) needBuild = true; } catch (e) {}
    }
    var buildP = needBuild
      ? MR.buildMixamoRig(target, { mode: opts.mode || 'keep' })
      : Promise.resolve({ ok: true, alreadyBuilt: true });
    return buildP.then(function (built) {
      if (!built || !built.ok) return { ok: false, error: 'Build Mixamo Rig thất bại: ' + ((built && built.error) || ''), build: built };
      var cur = QR.current;
      if (!cur) return { ok: false, error: 'Build xong nhưng chưa có control rig.' };
      var name = null, attached = null;
      if (typeof clipInput === 'string') {
        name = clipInput;
        var has = cur.clipByName && cur.clipByName[name];
        if (!has) {
          var resolved = resolveClipObject(name);
          if (resolved && resolved.clip) {
            var at = QR.attachMixamoClips(target, resolved.clip);
            if (at && at.ok) attached = at.attached;
            else return { ok: false, error: 'Không gắn được clip "' + name + '" vào rig: ' + ((at && at.error) || '') };
          } else {
            return { ok: false, error: 'Không tìm thấy clip "' + name + '" (không có trong rig lẫn Animator).' };
          }
        }
      } else {
        var res2 = resolveClipObject(clipInput);
        if (!res2) return { ok: false, error: 'Không resolve được clip để phát trên Mixamo Rig.' };
        name = res2.clip.name;
        if (!cur.clipByName || !cur.clipByName[name]) {
          var at2 = QR.attachMixamoClips(target, res2.clip);
          if (at2 && at2.ok) attached = at2.attached;
          else return { ok: false, error: 'Không gắn được clip "' + name + '" vào rig: ' + ((at2 && at2.error) || '') };
        }
      }
      var r = MR.playClip(name);
      if (!r || !r.ok) return { ok: false, error: 'MixamoRig.playClip lỗi: ' + ((r && r.error) || ''), play: r };
      SyncControl.playingMixamoRig = { clipName: name, time: 0, duration: r.duration || 0 };
      try { getBus().emit('arp:synccontrol-mixamorig-play', { clip: name, duration: r.duration || 0 }); } catch (e) {}
      return { ok: true, clip: name, duration: r.duration || 0, method: r.method || 'rig-mixer', via: 'mixamo-rig', attached: attached, built: built };
    });
  }

  /* Tick mixer của Mixamo Rig rồi đồng bộ control (state-only) theo clip. */
  function tickMixamoRig(dt) {
    var MR = getMR();
    if (!MR) return { ok: false, error: 'ArpPluginMixamoRig chưa load.' };
    if (!SyncControl.playingMixamoRig) return { ok: false, error: 'Chưa phát clip nào trên Mixamo Rig — gọi playClipOnMixamoRig trước.' };
    var r = MR.tick(dt);
    if (!r || !r.ok) return { ok: false, error: 'MixamoRig.tick lỗi: ' + ((r && r.error) || 'not-playing'), tick: r };
    var time = (typeof r.time === 'number') ? r.time : SyncControl.playingMixamoRig.time + (dt || 0);
    SyncControl.playingMixamoRig.time = time;
    var clipObj = null;
    var QR = getQR();
    if (QR && QR.current && QR.current.clipByName) clipObj = QR.current.clipByName[SyncControl.playingMixamoRig.clipName] || null;
    var sync = null;
    if (clipObj) sync = syncControlsFromClip(clipObj, time, { applyToBones: false });
    return { ok: true, clip: SyncControl.playingMixamoRig.clipName, time: round4(time), tick: r, sync: sync };
  }
  function stopMixamoRigClip() {
    var MR = getMR();
    if (!MR) return { ok: false, error: 'ArpPluginMixamoRig chưa load.' };
    var r = MR.stopClip();
    SyncControl.playingMixamoRig = null;
    return r || { ok: true };
  }

  /* (2b) Bake clip Animator đang chọn. Dùng MixamoRig.bakeClip có sẵn
     khi clip đã gắn trên rig; ngược lại sample bằng mixer riêng. */
  function bakeClipFromObject(clip, opts) {
    opts = opts || {};
    var T = getTHREE(), QR = getQR();
    if (!T || !T.AnimationMixer || !T.AnimationClip) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var target = opts.target || getTarget();
    if (!target) return { ok: false, error: 'Chưa có model target để bake.' };
    var cur = QR && QR.current;
    var bonesByDst = (cur && cur.bones) || null;
    if (!bonesByDst) {
      bonesByDst = {};
      target.traverse(function (o) { if (o.isBone && o.name) bonesByDst[stripName(o.name)] = o; });
    }
    var fps = opts.fps || 30;
    var duration = clip.duration || 0;
    if (!(duration > 0)) return { ok: false, error: 'Clip "' + clip.name + '" không có duration.' };
    var frames = Math.round(duration * fps) + 1;
    var times = [];
    for (var i = 0; i < frames; i++) times.push(+(i / fps).toFixed(4));
    var mixer = new T.AnimationMixer(target);
    var action = mixer.clipAction(clip);
    action.setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    var boneNames = Object.keys(bonesByDst);
    var quatVals = {}, posVals = {};
    boneNames.forEach(function (dst) { quatVals[dst] = []; posVals[dst] = []; });
    var hipsBone = bonesByDst.Hips || null;
    var saved = boneNames.map(function (dst) {
      var b = bonesByDst[dst];
      return { bone: b, quat: b.quaternion.clone(), pos: b.position.clone() };
    });
    try {
      for (var f = 0; f < frames; f++) {
        mixer.setTime(times[f]);
        target.updateMatrixWorld(true);
        boneNames.forEach(function (dst) {
          var b = bonesByDst[dst];
          if (!b) return;
          quatVals[dst].push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
          if (b === hipsBone) posVals[dst].push(b.position.x, b.position.y, b.position.z);
        });
      }
    } finally {
      try { action.stop(); } catch (e) {}
      try { mixer.uncacheClip(clip); } catch (e) {}
      saved.forEach(function (s) { s.bone.quaternion.copy(s.quat); s.bone.position.copy(s.pos); });
      try { target.updateMatrixWorld(true); } catch (e) {}
    }
    var tracks = [];
    boneNames.forEach(function (dst) {
      var b = bonesByDst[dst];
      if (!b || !quatVals[dst].length) return;
      tracks.push(new T.QuaternionKeyframeTrack(b.name + '.quaternion', times, quatVals[dst]));
      if (b === hipsBone) tracks.push(new T.VectorKeyframeTrack(b.name + '.position', times, posVals[dst]));
    });
    var bakedName = opts.name || (clip.name + '_SyncBaked');
    var baked = new T.AnimationClip(bakedName, duration, tracks);
    var bad = [];
    tracks.forEach(function (tr) {
      var size = /\.quaternion$/.test(tr.name) ? 4 : 3;
      if (tr.values.length !== tr.times.length * size) bad.push(tr.name + ' values=' + tr.values.length);
      else for (var i = 0; i < tr.values.length; i++) {
        if (!isFinite(tr.values[i])) { bad.push(tr.name + ' NaN/Inf'); break; }
      }
    });
    if (bad.length) return { ok: false, error: 'Clip bake ra không hợp lệ: ' + bad.join('; '), badTracks: bad };
    return { ok: true, name: bakedName, source: clip.name, fps: fps, frames: frames, duration: +duration.toFixed(4), trackCount: tracks.length, badTracks: [], clip: baked, via: 'synccontrol-sampler' };
  }

  function bakeCurrentAnimatorClip(opts) {
    opts = opts || {};
    var AN = getAN(), MR = getMR();
    if (!AN) return { ok: false, error: 'ArpAnimator chưa load.' };
    var cur = getCurrentAnimatorClip();
    if (!cur.ok) return cur;
    if (!cur.clip) {
      return { ok: false, error: 'Clip "' + cur.name + '" (source ' + cur.source + ') không có THREE.AnimationClip — keyframe/autogen không bake được ở đây.', entry: cur.entry };
    }
    var fps = [24, 30, 60].indexOf(Number(opts.fps)) >= 0 ? Number(opts.fps) : 30;
    var clip = cur.clip;
    var transforms = [];
    if (opts.trim) {
      if (typeof AN.trimClip !== 'function') return { ok: false, error: 'Animator.trimClip chưa có.' };
      var tr = AN.trimClip(clip, opts.trim.start, opts.trim.end);
      if (!tr.ok) return tr;
      clip = tr.clip; transforms.push('trim(' + opts.trim.start + '..' + opts.trim.end + ')');
    }
    if (opts.retime) {
      if (typeof AN.retimeClip !== 'function') return { ok: false, error: 'Animator.retimeClip chưa có.' };
      var rt = AN.retimeClip(clip, opts.retime);
      if (!rt.ok) return rt;
      clip = rt.clip; transforms.push('retime(x' + opts.retime + ')');
    }
    var baked = null, via = null;
    /* Ưu tiên bake có sẵn của Mixamo Rig khi clip đã gắn trên rig và
       không có transform (trim/retime làm clip mới chưa gắn). */
    if (MR && transforms.length === 0) {
      try {
        if (MR.isBuilt() && typeof MR.listClips === 'function' && typeof MR.bakeClip === 'function') {
          var attached = MR.listClips() || [];
          var found = attached.some(function (c) { return c === clip || (c && c.name === clip.name); });
          if (found) {
            var rb = MR.bakeClip(clip.name, { fps: fps, name: opts.name });
            if (rb && rb.ok) { baked = rb; via = 'mixamo-rig-bake'; }
          }
        }
      } catch (e) { baked = null; }
    }
    if (!baked) {
      var rs = bakeClipFromObject(clip, { fps: fps, name: opts.name });
      if (!rs.ok) return rs;
      baked = rs; via = rs.via;
    }
    /* Đăng ký vào Animator + phát event để clip xuất hiện trong list. */
    var bakedName = baked.name;
    var baseName = bakedName, suffix = 2;
    if (typeof AN.listClips === 'function') {
      while (AN.listClips().some(function (c) { return c.name === baseName; })) {
        baseName = bakedName + '_' + suffix; suffix++;
      }
    }
    if (baseName !== bakedName) {
      baked.clip.name = baseName;
      baked.name = baseName;
    }
    var reg = { ok: false };
    if (typeof AN.registerClip === 'function') {
      reg = AN.registerClip({ name: baseName, clip: baked.clip, source: 'user', userCreated: true, fps: fps });
    }
    var out = {
      ok: true, name: baseName, id: reg.ok ? reg.id : null,
      source: cur.name, sourceId: cur.id, duration: baked.duration,
      frames: baked.frames, trackCount: baked.trackCount, fps: fps,
      clip: baked.clip, via: via, transforms: transforms,
      registered: !!reg.ok, registerError: reg.ok ? null : (reg.error || 'registerClip không có')
    };
    SyncControl.lastBaked = out;
    try {
      getBus().emit('arp:animator-clip-changed', {
        action: 'baked', id: out.id, name: baseName,
        duration: baked.duration, fps: fps, source: cur.name, via: via
      });
    } catch (e) {}
    return out;
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  var SyncControl = {
    FORMAT: 'pixistudio-arp-sync-control-1',
    BLEND_IK_MATCH_RAD: BLEND_IK_MATCH_RAD,
    LIMBS: LIMBS.slice(),
    playingMixamoRig: null,
    lastBaked: null,
    _origAnimatorTick: null,
    _origAnimatorStop: null,
    _origSetters: null,

    syncControlsFromClip: syncControlsFromClip,
    snapshotControlState: snapshotControlState,
    diffSnapshots: diffSnapshots,
    applyControlState: applyControlState,
    markDirty: markDirty,
    clearDirty: clearDirty,
    clearDirtyState: clearAllDirty,
    markAllControlsDirty: markAllControlsDirty,
    wrapAnimatorTick: wrapAnimatorTick,
    unwrapAnimatorTick: unwrapAnimatorTick,
    isAnimatorTickWrapped: isAnimatorTickWrapped,
    wrapQuickRigControls: wrapQuickRigControls,
    unwrapQuickRigControls: unwrapQuickRigControls,
    isQuickRigControlsWrapped: isQuickRigControlsWrapped,
    install: install,
    uninstall: uninstall,

    getCurrentAnimatorClip: getCurrentAnimatorClip,
    resolveClipObject: resolveClipObject,
    playClipOnMixamoRig: playClipOnMixamoRig,
    tickMixamoRig: tickMixamoRig,
    stopMixamoRigClip: stopMixamoRigClip,
    bakeCurrentAnimatorClip: bakeCurrentAnimatorClip,
    bakeClipFromObject: bakeClipFromObject,
    syncMixamoRigStateFromQuickRig: syncMixamoRigStateFromQuickRig,

    _test: {
      sampleClipPoseFallback: sampleClipPoseFallback,
      sampleQuatTrack: sampleQuatTrack,
      sampleVecTrack: sampleVecTrack,
      eulerFromQuat: eulerFromQuat,
      stripName: stripName,
      applyPoseToBones: applyPoseToBones,
      restorePose: restorePose,
      getDirty: function () { return JSON.parse(JSON.stringify(dirty)); }
    }
  };

  PS.ArpSyncControl = SyncControl;
  if (typeof module !== 'undefined' && module.exports) module.exports = SyncControl;
})();

/* SCRIPT TAG CẦN APPEND LÚC GỘP (coordinator append, KHÔNG tự sửa index.html):
   <script src="js/rig/arp-sync-control.js"></script>
   — đặt SAU arp-animator.js và SAU arp-plugin-mixamorig.js (module chỉ
   đọc API của chúng lúc gọi hàm, nhưng load sau cho chắc chắn).
   KHÔNG cần CSS mới, KHÔNG cần tab/panel mới. Để bật control-thắng-clip
   trong studio, coordinator (hoặc UI Animator/QuickRig) gọi
   PixiStudio.ArpSyncControl.install() sau khi các module đã load;
   gọi .uninstall() để trả Animator.tick và các setter về gốc. */

/* GỘP (coordinator, vòng đồng bộ): tự bật control-thắng-clip khi module
   load xong (Animator + QuickRig đã load trước theo thứ tự script).
   install() đã guard chống bọc đúp (alreadyWrapped) nên gọi lại an toàn;
   nếu module gốc chưa load thì lần gọi này no-op, UI/coordinator gọi lại
   PixiStudio.ArpSyncControl.install() sau. */
try {
  var _sc = window.PixiStudio && window.PixiStudio.ArpSyncControl;
  if (_sc && typeof _sc.install === 'function') _sc.install();
} catch (e) {}
