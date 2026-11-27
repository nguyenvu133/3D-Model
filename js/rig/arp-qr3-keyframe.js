/* ============================================================
 * rig/arp-qr3-keyframe.js — KEYFRAME ANIMATION trên control rig
 * (Auto Rig Pro Blend, vòng mở rộng thứ 3 của Quick Rig — PHẦN 2)
 *
 * Ghi keyframe pose của control rig (QuickRig.current) theo thời
 * gian, phát lại bằng nội suy Euler, xuất/nhập clip JSON đúng
 * format clip của studio, onion skinning bằng ghost snapshot.
 *
 * KHÔNG sửa arp-quickrig.js: module này chỉ ĐỌC QuickRig.current
 * (.bones, .fkRotations, .fingerCurl, .footRoll, .headRotation,
 * .neckRotation, .jawOpen, .target) và dùng các setter sẵn có
 * (setFKRotation / setFingerCurl / setFootRoll / setHeadRotation /
 * setJaw) khi cần — không đụng vào IK solver hay map xương.
 *
 * CLIP NỘI BỘ:
 *   { name, duration, fps:30, loop:false,
 *     keys:[{ t, pose:{<dstBone>:{x,y,z}},   // Euler local tuyệt đối
 *             hips:{x,y,z},                  // vị trí local của Hips
 *             fk:{ fkRotations:{}, fingerCurl:{}, fingerCurlAll,
 *                  footRoll:{Left,Right}, spineRotations:{},
 *                  headRotation:{}, neckRotation:{}, jawOpen } }]}
 *
 * FORMAT XUẤT (khớp coco.js / hy3d.js — "pixistudio-*-clips-1"):
 *   { format:'pixistudio-arp-keyframe-clips-1', character:'quickrig',
 *     skeleton:{boneNames, boneCount},
 *     clips:[{ id, name, duration, loop, source:'arp-keyframe', fps,
 *              keys:[...clip nội bộ...],   // giữ nguyên để round-trip
 *              tracks:[{name:'<BoneFullName>.quaternion', times, values},
 *                      {name:'<HipsFullName>.position', times, values}] }]}
 *   Track quaternion: 4 giá trị/key (x,y,z,w) từ Euler pose;
 *   track position Hips: 3 giá trị/key. Đúng Anim.validateClip
 *   (values.length == times.length * size, không NaN).
 *   Import chấp nhận cả format này lẫn pixistudio-coco-clips-1 /
 *   pixistudio-hy3d-clips-1 (chỉ có tracks, không có keys).
 *
 * PHÁT LẠI: tick(dt) đồng bộ — UI trình duyệt gọi bằng
 * requestAnimationFrame, harness gọi trực tiếp. KHÔNG dùng timer
 * thật trong module (không setInterval/setTimeout cho playback).
 * Nội suy = lerp tuyến tính từng thành phần Euler giữa 2 key kề.
 *
 * ONION SKINNING: ghost = snapshot vị trí world của 17 khớp chính
 * ở pose của key trước/sau + 1 THREE.Group mờ (sphere nhỏ,
 * opacity 0.35) gắn vào target. Harness kiểm tra giá trị snapshot
 * (không cần render thật).
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Lerp Euler (không slerp quaternion): pose gần nhau thì mượt,
 *     pose xoay lớn / qua ±π có thể đi đường vòng — ghi key dày
 *     hơn nếu thấy xoay lạ.
 *   • Pose ghi là rotation local TUYỆT ĐỐI của xương lúc ghi; phát
 *     lại ghi đè rotation hiện tại (không cộng dồn với clip Mixamo
 *     đang phát — dừng clip Mixamo trước khi phát keyframe).
 *   • FK state (fingerCurl/footRoll/...) được khôi phục theo key
 *     khi gotoKey/tick; riêng jaw chỉ áp khi rig có xương hàm.
 *   • Ghost là bóng mờ vị trí khớp, không phải mesh nhân vật mờ.
 *   • Import clip coco/hy3d: FK state không có trong file → mặc
 *     định 0; pose chỉ gồm xương có trong tracks.
 * ============================================================ */
(function () {
  'use strict';

  var QR = (window.PixiStudio && PixiStudio.ArpQuickRig) || null;
  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };
  var U = (window.PixiStudio && PixiStudio.Utils) || null;

  var FORMAT = 'pixistudio-arp-keyframe-clips-1';
  var EPS = 1e-6;

  /* 17 khớp chính dùng cho ghost snapshot */
  var GHOST_JOINTS = ['Hips', 'Spine', 'Spine2', 'Neck', 'Head',
    'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];

  var Keyframe = {
    clip: null,           /* clip nội bộ đang biên tập */
    time: 0,              /* thời gian phát hiện tại (s) */
    playing: false,
    loop: false,
    ghosts: [],           /* [{keyIndex, side, joints:{name:[x,y,z]}, group}] */
    FORMAT: FORMAT
  };

  function notify(type, title, message, duration) {
    try { bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 }); } catch (e) {}
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round3(v) { return Math.round(v * 1000) / 1000; }
  function round4(v) { return Math.round(v * 10000) / 10000; }
  function cloneEuler(e) { return { x: e.x || 0, y: e.y || 0, z: e.z || 0 }; }
  function cloneObj(o) {
    var out = {};
    if (!o) return out;
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      out[k] = (v && typeof v === 'object') ? cloneObj(v) : v;
    });
    return out;
  }
  function getRig() { return QR ? QR.current : null; }
  function needRig() {
    var cur = getRig();
    if (!cur) return { ok: false, error: 'Chưa có control rig — convert/auto-gen một model đã rig trước (tab Quick Rig).' };
    return { ok: true, rig: cur };
  }
  function ensureClip() {
    if (!Keyframe.clip) Keyframe.clip = { name: 'Clip 1', duration: 0, fps: 30, loop: false, keys: [] };
    return Keyframe.clip;
  }

  /* ---------- el helper (như arp-quickrig.js) ---------- */
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

  /* ============================================================
     CAPTURE / APPLY POSE
     ============================================================ */
  /* Chụp pose hiện tại của rig: rotation local mọi xương trong map
     + vị trí Hips + toàn bộ FK state. */
  function capturePose() {
    var cur = getRig();
    if (!cur) return null;
    var pose = {};
    Object.keys(cur.bones || {}).forEach(function (dst) {
      var b = cur.bones[dst];
      if (b) pose[dst] = cloneEuler(b.rotation);
    });
    var hips = null;
    if (cur.bones.Hips) hips = { x: cur.bones.Hips.position.x, y: cur.bones.Hips.position.y, z: cur.bones.Hips.position.z };
    var fk = {
      fkRotations: cloneObj(cur.fkRotations || {}),
      fingerCurl: cloneObj(cur.fingerCurl || {}),
      fingerCurlAll: cur.fingerCurlAll || 0,
      footRoll: cloneObj(cur.footRoll || { Left: 0, Right: 0 }),
      spineRotations: cloneObj(cur.spineRotations || {}),
      headRotation: cloneEuler(cur.headRotation || { x: 0, y: 0, z: 0 }),
      neckRotation: cloneEuler(cur.neckRotation || { x: 0, y: 0, z: 0 }),
      jawOpen: cur.jawOpen || 0
    };
    return { pose: pose, hips: hips, fk: fk };
  }
  Keyframe._capturePose = capturePose;

  /* Áp 1 pose đã chụp (hoặc nội suy) lên rig: set rotation từng
     xương + Hips position + khôi phục FK state (chỉ ghi field, không
     chạy lại setter — tránh setter ghi đè rotation ngón/chân vừa áp
     từ pose; riêng jaw không nằm trong pose nên áp qua setJaw). */
  function applyPose(pose, hips, fk) {
    var cur = getRig();
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    if (pose) Object.keys(pose).forEach(function (dst) {
      var b = cur.bones[dst];
      if (!b) return;
      var e = pose[dst];
      b.rotation.set(e.x || 0, e.y || 0, e.z || 0);
      if (cur.controls && cur.controls[dst]) cur.controls[dst].rotation.set(e.x || 0, e.y || 0, e.z || 0);
    });
    if (hips && cur.bones.Hips) cur.bones.Hips.position.set(hips.x || 0, hips.y || 0, hips.z || 0);
    if (fk) {
      cur.fkRotations = cloneObj(fk.fkRotations || {});
      cur.fingerCurl = cloneObj(fk.fingerCurl || {});
      cur.fingerCurlAll = fk.fingerCurlAll || 0;
      cur.footRoll = cloneObj(fk.footRoll || { Left: 0, Right: 0 });
      cur.spineRotations = cloneObj(fk.spineRotations || {});
      cur.headRotation = cloneEuler(fk.headRotation || { x: 0, y: 0, z: 0 });
      cur.neckRotation = cloneEuler(fk.neckRotation || { x: 0, y: 0, z: 0 });
      cur.jawOpen = fk.jawOpen || 0;
      if (fk.jawOpen && QR && typeof QR.setJaw === 'function') {
        try { QR.setJaw(fk.jawOpen); } catch (e) {}
      }
    }
    try { if (cur.target) cur.target.updateMatrixWorld(true); } catch (e) {}
    return { ok: true };
  }

  /* Lerp Euler từng xương giữa 2 pose (a → b, alpha 0..1). */
  function lerpPose(poseA, poseB, alpha) {
    var out = {};
    var names = {};
    Object.keys(poseA || {}).forEach(function (n) { names[n] = true; });
    Object.keys(poseB || {}).forEach(function (n) { names[n] = true; });
    Object.keys(names).forEach(function (n) {
      var a = poseA[n] || poseB[n] || { x: 0, y: 0, z: 0 };
      var b = poseB[n] || poseA[n] || { x: 0, y: 0, z: 0 };
      out[n] = {
        x: a.x + (b.x - a.x) * alpha,
        y: a.y + (b.y - a.y) * alpha,
        z: a.z + (b.z - a.z) * alpha
      };
    });
    return out;
  }
  function lerpVec3(a, b, alpha) {
    if (!a) return b ? { x: b.x, y: b.y, z: b.z } : null;
    if (!b) return { x: a.x, y: a.y, z: a.z };
    return { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha, z: a.z + (b.z - a.z) * alpha };
  }
  /* Nội suy FK state: số thì lerp, object Euler thì lerp từng trục. */
  function lerpFk(fkA, fkB, alpha) {
    fkA = fkA || {}; fkB = fkB || {};
    var lerpNum = function (a, b) { return (a || 0) + ((b || 0) - (a || 0)) * alpha; };
    var lerpE = function (a, b) {
      a = a || { x: 0, y: 0, z: 0 }; b = b || { x: 0, y: 0, z: 0 };
      return { x: lerpNum(a.x, b.x), y: lerpNum(a.y, b.y), z: lerpNum(a.z, b.z) };
    };
    var lerpMap = function (a, b) {
      var out = {}, names = {};
      Object.keys(a || {}).forEach(function (k) { names[k] = true; });
      Object.keys(b || {}).forEach(function (k) { names[k] = true; });
      Object.keys(names).forEach(function (k) {
        var va = (a || {})[k], vb = (b || {})[k];
        out[k] = (va && typeof va === 'object') || (vb && typeof vb === 'object') ? lerpE(va, vb) : lerpNum(va, vb);
      });
      return out;
    };
    return {
      fkRotations: lerpMap(fkA.fkRotations, fkB.fkRotations),
      fingerCurl: lerpMap(fkA.fingerCurl, fkB.fingerCurl),
      fingerCurlAll: lerpNum(fkA.fingerCurlAll, fkB.fingerCurlAll),
      footRoll: lerpMap(fkA.footRoll, fkB.footRoll),
      spineRotations: lerpMap(fkA.spineRotations, fkB.spineRotations),
      headRotation: lerpE(fkA.headRotation, fkB.headRotation),
      neckRotation: lerpE(fkA.neckRotation, fkB.neckRotation),
      jawOpen: lerpNum(fkA.jawOpen, fkB.jawOpen)
    };
  }

  /* Pose nội suy tại thời gian t (dùng cho tick + ghost kiểm tra). */
  function poseAt(t) {
    var clip = Keyframe.clip;
    if (!clip || !clip.keys.length) return null;
    var keys = clip.keys;
    if (t <= keys[0].t) return { pose: cloneObj(keys[0].pose), hips: cloneObj(keys[0].hips), fk: cloneObj(keys[0].fk) };
    if (t >= keys[keys.length - 1].t) {
      var last = keys[keys.length - 1];
      return { pose: cloneObj(last.pose), hips: cloneObj(last.hips), fk: cloneObj(last.fk) };
    }
    for (var i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].t && t <= keys[i + 1].t) {
        var span = keys[i + 1].t - keys[i].t;
        var alpha = span > EPS ? (t - keys[i].t) / span : 0;
        return {
          pose: lerpPose(keys[i].pose, keys[i + 1].pose, alpha),
          hips: lerpVec3(keys[i].hips, keys[i + 1].hips, alpha),
          fk: lerpFk(keys[i].fk, keys[i + 1].fk, alpha)
        };
      }
    }
    return null;
  }

  /* ============================================================
     CLIP / KEYFRAME CRUD
     ============================================================ */
  function newClip(name) {
    Keyframe.clip = { name: name || 'Clip 1', duration: 0, fps: 30, loop: false, keys: [] };
    Keyframe.time = 0;
    Keyframe.playing = false;
    Keyframe.loop = false;
    hideGhost();
    try { bus.emit('arpqr3:clip-new', { name: Keyframe.clip.name }); } catch (e) {}
    return { ok: true, name: Keyframe.clip.name, keys: 0 };
  }
  function setClipName(name) {
    var clip = ensureClip();
    clip.name = String(name || clip.name);
    return { ok: true, name: clip.name };
  }
  function setDuration(d) {
    var clip = ensureClip();
    clip.duration = Math.max(0, Number(d) || 0);
    return { ok: true, duration: clip.duration };
  }
  function setFps(fps) {
    var clip = ensureClip();
    clip.fps = clamp(Math.round(Number(fps) || 30), 1, 120);
    return { ok: true, fps: clip.fps };
  }
  function getClip() { return Keyframe.clip; }

  /* Ghi key tại thời gian t (mặc định = thời gian phát hiện tại).
     Key đã có ở đúng t (±1e-6) thì GHI ĐÈ, không nhân đôi. */
  function recordKey(t) {
    var chk = needRig();
    if (!chk.ok) return chk;
    var clip = ensureClip();
    if (t === undefined || t === null) t = Keyframe.time;
    t = Math.max(0, Number(t) || 0);
    var snap = capturePose();
    if (!snap) return { ok: false, error: 'Không chụp được pose của rig.' };
    var key = { t: round3(t), pose: snap.pose, hips: snap.hips, fk: snap.fk };
    var idx = -1, replaced = false;
    for (var i = 0; i < clip.keys.length; i++) {
      if (Math.abs(clip.keys[i].t - key.t) < 1e-6) { idx = i; replaced = true; break; }
    }
    if (idx >= 0) clip.keys[idx] = key;
    else {
      clip.keys.push(key);
      clip.keys.sort(function (a, b) { return a.t - b.t; });
      idx = clip.keys.indexOf(key);
    }
    if (key.t > clip.duration) clip.duration = key.t;
    try { bus.emit('arpqr3:key-recorded', { t: key.t, index: idx, keyCount: clip.keys.length }); } catch (e) {}
    return { ok: true, t: key.t, index: idx, keyCount: clip.keys.length, duration: clip.duration, replaced: replaced };
  }

  /* Tìm key: số nguyên trong [0, keys.length) → theo INDEX (ưu tiên,
     vì index và thời gian nguyên trùng nhau không phân biệt được —
     vd gotoKey(1) với 3 keys luôn là key #1, không phải t=1.0s).
     Muốn truy cập chắc chắn theo THỜI GIAN thì dùng gotoKeyAt /
     deleteKeyAt. Còn lại → theo thời gian (khớp ±1ms, không có thì
     key gần nhất trong 0.05s, xa hơn thì lỗi). */
  function resolveKey(indexOrT) {
    var clip = Keyframe.clip;
    if (!clip || !clip.keys.length) return { ok: false, error: 'Clip chưa có keyframe nào — bấm "Ghi key" trước.' };
    var n = Number(indexOrT);
    if (isFinite(n) && Math.floor(n) === n && n >= 0 && n < clip.keys.length) {
      return { ok: true, index: n, key: clip.keys[n] };
    }
    if (isFinite(n)) {
      var best = -1, bestD = Infinity;
      for (var i = 0; i < clip.keys.length; i++) {
        var d = Math.abs(clip.keys[i].t - n);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (bestD <= 0.05) return { ok: true, index: best, key: clip.keys[best] };
      return { ok: false, error: 'Không có key ở t=' + n + 's (key gần nhất lệch ' + bestD.toFixed(3) + 's).' };
    }
    return { ok: false, error: 'Tham số key không hợp lệ: ' + indexOrT };
  }

  function deleteKey(indexOrT) {
    var clip = ensureClip();
    var r = resolveKey(indexOrT);
    if (!r.ok) return r;
    var removed = clip.keys.splice(r.index, 1)[0];
    if (clip.keys.length) clip.duration = Math.max(clip.duration, clip.keys[clip.keys.length - 1].t);
    if (Keyframe.time > clip.duration && !Keyframe.loop) Keyframe.time = clip.duration;
    return { ok: true, removedT: removed.t, index: r.index, keyCount: clip.keys.length, duration: clip.duration };
  }

  function gotoKey(indexOrT) {
    var chk = needRig();
    if (!chk.ok) return chk;
    var r = resolveKey(indexOrT);
    if (!r.ok) return r;
    var res = applyPose(r.key.pose, r.key.hips, r.key.fk);
    if (!res.ok) return res;
    Keyframe.time = r.key.t;
    return { ok: true, index: r.index, t: r.key.t, time: Keyframe.time };
  }
  /* Truy cập chắc chắn theo THỜI GIAN (không lẫn với index). */
  function resolveKeyAt(t) {
    var clip = Keyframe.clip;
    if (!clip || !clip.keys.length) return { ok: false, error: 'Clip chưa có keyframe nào — bấm "Ghi key" trước.' };
    var n = Number(t);
    if (!isFinite(n)) return { ok: false, error: 'Thời gian không hợp lệ: ' + t };
    var best = -1, bestD = Infinity;
    for (var i = 0; i < clip.keys.length; i++) {
      var d = Math.abs(clip.keys[i].t - n);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (bestD <= 0.05) return { ok: true, index: best, key: clip.keys[best] };
    return { ok: false, error: 'Không có key ở t=' + n + 's (key gần nhất lệch ' + bestD.toFixed(3) + 's).' };
  }
  function gotoKeyAt(t) {
    var chk = needRig();
    if (!chk.ok) return chk;
    var r = resolveKeyAt(t);
    if (!r.ok) return r;
    var res = applyPose(r.key.pose, r.key.hips, r.key.fk);
    if (!res.ok) return res;
    Keyframe.time = r.key.t;
    return { ok: true, index: r.index, t: r.key.t, time: Keyframe.time };
  }
  function deleteKeyAt(t) {
    var clip = ensureClip();
    var r = resolveKeyAt(t);
    if (!r.ok) return r;
    var removed = clip.keys.splice(r.index, 1)[0];
    if (clip.keys.length) clip.duration = Math.max(clip.duration, clip.keys[clip.keys.length - 1].t);
    if (Keyframe.time > clip.duration && !Keyframe.loop) Keyframe.time = clip.duration;
    return { ok: true, removedT: removed.t, index: r.index, keyCount: clip.keys.length, duration: clip.duration };
  }

  /* ============================================================
     PHÁT LẠI — tick(dt) đồng bộ, không timer thật
     ============================================================ */
  function play() {
    var chk = needRig();
    if (!chk.ok) return chk;
    var clip = Keyframe.clip;
    if (!clip || clip.keys.length < 1) return { ok: false, error: 'Clip chưa có keyframe nào — bấm "Ghi key" trước.' };
    if (clip.keys.length < 2) {
      /* 1 key: giữ nguyên pose đó, vẫn cho time chạy để UI thấy */
      notify('info', 'Keyframe', 'Clip chỉ có 1 key — phát giữ nguyên pose đó. Ghi thêm key để có chuyển động.');
    }
    if (Keyframe.time >= clip.duration && clip.duration > 0) Keyframe.time = 0;
    Keyframe.playing = true;
    var p = poseAt(Keyframe.time);
    if (p) applyPose(p.pose, p.hips, p.fk);
    try { bus.emit('arpqr3:play', { name: clip.name, time: Keyframe.time }); } catch (e) {}
    return { ok: true, playing: true, time: Keyframe.time, duration: clip.duration };
  }
  function pause() {
    Keyframe.playing = false;
    return { ok: true, playing: false, time: Keyframe.time };
  }
  function stop() {
    Keyframe.playing = false;
    Keyframe.time = 0;
    var clip = Keyframe.clip;
    if (clip && clip.keys.length) {
      var p = poseAt(0);
      if (p) applyPose(p.pose, p.hips, p.fk);
    }
    return { ok: true, playing: false, time: 0 };
  }
  function setLoop(v) {
    Keyframe.loop = !!v;
    if (Keyframe.clip) Keyframe.clip.loop = Keyframe.loop;
    return { ok: true, loop: Keyframe.loop };
  }
  function getTime() { return Keyframe.time; }
  function getProgress() {
    var clip = Keyframe.clip;
    if (!clip || !clip.duration) return 0;
    return clamp(Keyframe.time / clip.duration, 0, 1);
  }
  function isPlaying() { return Keyframe.playing; }

  function tick(dt) {
    if (!Keyframe.playing) return { ok: true, playing: false, time: Keyframe.time, applied: false };
    var clip = Keyframe.clip;
    if (!clip || !clip.keys.length) { Keyframe.playing = false; return { ok: false, error: 'Clip chưa có key.', playing: false, time: Keyframe.time }; }
    dt = Number(dt) || 0;
    if (dt < 0) dt = 0;
    Keyframe.time += dt;
    var dur = clip.duration;
    if (dur <= 0) { Keyframe.time = 0; }
    else if (Keyframe.time >= dur) {
      if (Keyframe.loop) {
        Keyframe.time = Keyframe.time % dur;
        if (Keyframe.time < 0) Keyframe.time = 0;
      } else {
        Keyframe.time = dur;
        Keyframe.playing = false;
      }
    }
    var p = poseAt(Keyframe.time);
    if (p) applyPose(p.pose, p.hips, p.fk);
    return { ok: true, playing: Keyframe.playing, time: Keyframe.time, progress: getProgress(), applied: !!p, looped: Keyframe.loop && Keyframe.time < dt };
  }

  /* ============================================================
     XUẤT / NHẬP CLIP JSON (format studio)
     ============================================================ */
  function eulerToQuat(e) {
    var q = new window.THREE.Quaternion();
    q.setFromEuler(new window.THREE.Euler(e.x || 0, e.y || 0, e.z || 0, 'XYZ'));
    return q;
  }
  function quatToEuler(q) {
    var e = new window.THREE.Euler();
    e.setFromQuaternion(q, 'XYZ');
    return { x: e.x, y: e.y, z: e.z };
  }
  function boneFullName(dst) {
    var cur = getRig();
    if (cur && cur.bones && cur.bones[dst]) return cur.bones[dst].name;
    return dst;
  }

  /* Dựng tracks THREE từ keys nội bộ (dùng chung cho export JSON
     và buildAnimationClip). Mọi track dùng chung mảng times = thời
     gian các key, nên import lại khớp đúng từng key. */
  function tracksFromKeys(keys) {
    var times = keys.map(function (k) { return round3(k.t); });
    var tracks = [];
    if (!keys.length) return tracks;
    var boneNames = {};
    keys.forEach(function (k) { Object.keys(k.pose || {}).forEach(function (n) { boneNames[n] = true; }); });
    Object.keys(boneNames).forEach(function (dst) {
      var values = [];
      keys.forEach(function (k) {
        var e = (k.pose && k.pose[dst]) || { x: 0, y: 0, z: 0 };
        var q = eulerToQuat(e);
        values.push(round4(q.x), round4(q.y), round4(q.z), round4(q.w));
      });
      tracks.push({ name: boneFullName(dst) + '.quaternion', times: times.slice(), values: values });
    });
    var hasHips = keys.some(function (k) { return !!k.hips; });
    if (hasHips) {
      var vals = [];
      keys.forEach(function (k) {
        var h = k.hips || { x: 0, y: 0, z: 0 };
        vals.push(round4(h.x), round4(h.y), round4(h.z));
      });
      tracks.push({ name: boneFullName('Hips') + '.position', times: times.slice(), values: vals });
    }
    return tracks;
  }

  function buildAnimationClip(name, keys) {
    if (!window.THREE) return null;
    keys = keys || (Keyframe.clip ? Keyframe.clip.keys : []);
    if (!keys.length) return null;
    var dur = keys[keys.length - 1].t;
    var tracks = [];
    tracksFromKeys(keys).forEach(function (t) {
      if (/\.quaternion$/.test(t.name)) tracks.push(new window.THREE.QuaternionKeyframeTrack(t.name, t.times, t.values));
      else if (/\.position$/.test(t.name)) tracks.push(new window.THREE.VectorKeyframeTrack(t.name, t.times, t.values));
    });
    return new window.THREE.AnimationClip(name || (Keyframe.clip && Keyframe.clip.name) || 'Clip 1', Math.max(dur, 0.001), tracks);
  }

  function exportClip(opts) {
    opts = opts || {};
    var clip = Keyframe.clip;
    if (!clip || !clip.keys.length) return { ok: false, error: 'Clip chưa có keyframe nào — bấm "Ghi key" trước.' };
    var cur = getRig();
    var boneNames = cur ? Object.keys(cur.bones || {}).map(function (dst) { return cur.bones[dst] ? cur.bones[dst].name : dst; }) : [];
    var id = (clip.name || 'Clip 1').replace(/[^A-Za-z0-9_]+/g, '_');
    var data = {
      format: FORMAT,
      character: 'quickrig',
      skeleton: { boneNames: boneNames, boneCount: boneNames.length },
      clips: [{
        id: id, name: clip.name, duration: clip.duration, loop: !!clip.loop,
        source: 'arp-keyframe', fps: clip.fps || 30,
        keys: JSON.parse(JSON.stringify(clip.keys)),
        tracks: tracksFromKeys(clip.keys)
      }]
    };
    var text = JSON.stringify(data, null, 1);
    var filename = 'quickrig_' + id + '_clips.json';
    if (opts.download !== false && U && typeof U.downloadText === 'function') {
      try { U.downloadText(text, filename, 'application/json'); } catch (e) {}
    }
    try { bus.emit('notify', { type: 'success', title: 'Keyframe', message: filename + ' — ' + clip.keys.length + ' keys, ' + data.clips[0].tracks.length + ' tracks.' }); } catch (e) {}
    return { ok: true, json: data, text: text, filename: filename, format: FORMAT, trackCount: data.clips[0].tracks.length, keyCount: clip.keys.length };
  }

  /* Lấy mẫu quaternion tại thời gian t từ 1 track (slerp giữa 2 key
     kề; ngoài khoảng thì kẹp đầu/cuối). Track coco/hy3d có thể có
     times khác nhau giữa các xương nên phải sample, không giả định
     times chung. */
  function sampleQuatTrack(track, t) {
    var times = track.times, vals = track.values;
    var n = times.length;
    if (!n) return new window.THREE.Quaternion();
    if (t <= times[0] || n === 1) return new window.THREE.Quaternion(vals[0], vals[1], vals[2], vals[3]);
    if (t >= times[n - 1]) {
      var o = (n - 1) * 4;
      return new window.THREE.Quaternion(vals[o], vals[o + 1], vals[o + 2], vals[o + 3]);
    }
    for (var i = 0; i < n - 1; i++) {
      if (t >= times[i] && t <= times[i + 1]) {
        var span = times[i + 1] - times[i];
        var a = span > EPS ? (t - times[i]) / span : 0;
        var qa = new window.THREE.Quaternion(vals[i * 4], vals[i * 4 + 1], vals[i * 4 + 2], vals[i * 4 + 3]);
        var qb = new window.THREE.Quaternion(vals[(i + 1) * 4], vals[(i + 1) * 4 + 1], vals[(i + 1) * 4 + 2], vals[(i + 1) * 4 + 3]);
        return qa.slerp(qb, a);
      }
    }
    return new window.THREE.Quaternion();
  }
  function sampleVecTrack(track, t) {
    var times = track.times, vals = track.values;
    var n = times.length;
    if (!n) return { x: 0, y: 0, z: 0 };
    var at = function (i) { return { x: vals[i * 3], y: vals[i * 3 + 1], z: vals[i * 3 + 2] }; };
    if (t <= times[0] || n === 1) return at(0);
    if (t >= times[n - 1]) return at(n - 1);
    for (var i = 0; i < n - 1; i++) {
      if (t >= times[i] && t <= times[i + 1]) {
        var span = times[i + 1] - times[i];
        var a = span > EPS ? (t - times[i]) / span : 0;
        var va = at(i), vb = at(i + 1);
        return { x: va.x + (vb.x - va.x) * a, y: va.y + (vb.y - va.y) * a, z: va.z + (vb.z - va.z) * a };
      }
    }
    return at(0);
  }
  function stripBoneName(full) {
    var s = String(full || '');
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    s = s.replace(/\.(quaternion|position|scale)$/i, '');
    return s;
  }
  function validateTracks(tracks) {
    var bad = [];
    (tracks || []).forEach(function (t) {
      var size = /\.quaternion$/.test(t.name) ? 4 : 3;
      var need = (t.times || []).length * size;
      if ((t.values || []).length !== need) bad.push(t.name + ' values=' + (t.values || []).length + ' cần=' + need);
      else (t.values || []).forEach(function (v) { if (!isFinite(v)) { bad.push(t.name + ' có giá trị NaN/Inf'); return; } });
    });
    return bad;
  }

  /* Nhập clip JSON: object hoặc chuỗi JSON. Chấp nhận format của
     module này (có keys → khôi phục nguyên vẹn cả FK state),
     format coco/hy3d (chỉ tracks → dựng keys bằng sample slerp).
     opts.clipIndex / opts.clipId để chọn clip khi file có nhiều. */
  function importClip(json, opts) {
    opts = opts || {};
    var data = json;
    if (typeof json === 'string') {
      try { data = JSON.parse(json); } catch (e) { return { ok: false, error: 'JSON không parse được: ' + (e && e.message) }; }
    }
    if (!data || !data.clips || !data.clips.length) return { ok: false, error: 'File không có clips — cần format pixistudio-*-clips-1 (coco/hy3d/keyframe).' };
    var entry = data.clips[0];
    if (opts.clipId) {
      for (var ci = 0; ci < data.clips.length; ci++) {
        if (data.clips[ci].id === opts.clipId || data.clips[ci].name === opts.clipId) { entry = data.clips[ci]; break; }
      }
    } else if (typeof opts.clipIndex === 'number' && data.clips[opts.clipIndex]) entry = data.clips[opts.clipIndex];
    var bad = validateTracks(entry.tracks || []);
    if (bad.length) return { ok: false, error: 'Clip lỗi track: ' + bad[0] };
    var keys = [];
    if (entry.keys && entry.keys.length) {
      /* round-trip nội bộ: giữ nguyên pose + FK state */
      keys = JSON.parse(JSON.stringify(entry.keys));
      keys.sort(function (a, b) { return a.t - b.t; });
    } else {
      /* chỉ có tracks (coco/hy3d): gom mọi mốc thời gian, sample */
      var timeSet = {};
      (entry.tracks || []).forEach(function (t) {
        (t.times || []).forEach(function (tt) { timeSet[round3(tt)] = true; });
      });
      var allTimes = Object.keys(timeSet).map(function (x) { return parseFloat(x); }).sort(function (a, b) { return a - b; });
      if (!allTimes.length) return { ok: false, error: 'Clip không có keyframe nào trong tracks.' };
      var qTracks = [], posTrack = null;
      (entry.tracks || []).forEach(function (t) {
        if (/\.quaternion$/.test(t.name)) qTracks.push(t);
        else if (/\.position$/.test(t.name) && stripBoneName(t.name) === 'Hips') posTrack = t;
      });
      allTimes.forEach(function (tt) {
        var pose = {};
        qTracks.forEach(function (tr) {
          var dst = stripBoneName(tr.name);
          pose[dst] = quatToEuler(sampleQuatTrack(tr, tt));
        });
        keys.push({
          t: round3(tt), pose: pose,
          hips: posTrack ? sampleVecTrack(posTrack, tt) : null,
          fk: { fkRotations: cloneObj(pose), fingerCurl: {}, fingerCurlAll: 0,
            footRoll: { Left: 0, Right: 0 }, spineRotations: {},
            headRotation: cloneEuler(pose.Head || { x: 0, y: 0, z: 0 }),
            neckRotation: cloneEuler(pose.Neck || { x: 0, y: 0, z: 0 }), jawOpen: 0 }
        });
      });
    }
    Keyframe.clip = {
      name: entry.name || entry.id || 'Clip nhập',
      duration: entry.duration !== undefined ? entry.duration : (keys.length ? keys[keys.length - 1].t : 0),
      fps: entry.fps || 30,
      loop: !!entry.loop,
      keys: keys
    };
    Keyframe.time = 0;
    Keyframe.playing = false;
    Keyframe.loop = Keyframe.clip.loop;
    return { ok: true, name: Keyframe.clip.name, keyCount: keys.length, duration: Keyframe.clip.duration, format: data.format || 'unknown', sourceFormat: data.format || 'unknown' };
  }

  /* ============================================================
     ONION SKINNING (GHOST)
     ============================================================ */
  function snapshotJoints(pose, hips) {
    var cur = getRig();
    if (!cur) return null;
    /* lưu pose hiện tại, áp pose cần snapshot, đọc world, trả lại */
    var saved = capturePose();
    applyPose(pose, hips, null);
    var joints = {};
    GHOST_JOINTS.forEach(function (dst) {
      var b = cur.bones[dst];
      if (!b) return;
      try {
        var wp = new window.THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
        joints[dst] = [round4(wp.x), round4(wp.y), round4(wp.z)];
      } catch (e) {}
    });
    if (saved) applyPose(saved.pose, saved.hips, saved.fk);
    return joints;
  }

  function makeGhostGroup(joints, color) {
    var cur = getRig();
    if (!cur || !window.THREE) return null;
    var group = new window.THREE.Group();
    group.name = '__arp_kf_ghost__';
    var r = Math.max(0.012, (cur.height || 1.8) * 0.012);
    Object.keys(joints).forEach(function (dst) {
      var p = joints[dst];
      var m = null;
      try {
        m = new window.THREE.Mesh(
          new window.THREE.SphereGeometry(r, 8, 6),
          new window.THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.35, depthTest: false }));
        m.userData.isKeyframeGhost = true;
        m.userData.joint = dst;
      } catch (e) { return; }
      /* joints là world → đổi về local của target */
      var v = new window.THREE.Vector3(p[0], p[1], p[2]);
      try {
        cur.target.updateMatrixWorld(true);
        var inv = cur.target.matrixWorld.clone().invert();
        v.applyMatrix4(inv);
      } catch (e) {}
      m.position.copy(v);
      group.add(m);
    });
    return group;
  }

  /* renderGhost(keyIndex, {which:'prev'|'next'|'both'}):
     ghost của key TRƯỚC / SAU key đã cho (mặc định 'both').
     Trả về snapshot khớp pose từng key (harness kiểm tra số). */
  function renderGhost(keyIndex, opts) {
    opts = opts || {};
    var which = opts.which || 'both';
    var chk = needRig();
    if (!chk.ok) return chk;
    var clip = Keyframe.clip;
    if (!clip || !clip.keys.length) return { ok: false, error: 'Clip chưa có keyframe nào.' };
    var idx = Number(keyIndex);
    if (!isFinite(idx) || Math.floor(idx) !== idx || idx < 0 || idx >= clip.keys.length) {
      return { ok: false, error: 'keyIndex không hợp lệ: ' + keyIndex + ' (clip có ' + clip.keys.length + ' keys).' };
    }
    hideGhost();
    var out = { ok: true, keyIndex: idx, ghosts: [] };
    var sides = [];
    if (which === 'prev' || which === 'both') sides.push({ side: 'prev', keyIdx: idx - 1, color: 0x33ccff });
    if (which === 'next' || which === 'both') sides.push({ side: 'next', keyIdx: idx + 1, color: 0xff5599 });
    if (which !== 'prev' && which !== 'next' && which !== 'both') {
      return { ok: false, error: "which phải là 'prev' | 'next' | 'both', nhận: " + which };
    }
    var made = 0;
    sides.forEach(function (s) {
      if (s.keyIdx < 0 || s.keyIdx >= clip.keys.length) return;
      var k = clip.keys[s.keyIdx];
      var joints = snapshotJoints(k.pose, k.hips);
      if (!joints) return;
      var group = null;
      try {
        group = makeGhostGroup(joints, s.color);
        if (group && chk.rig.target) chk.rig.target.add(group);
      } catch (e) { group = null; }
      Keyframe.ghosts.push({ keyIndex: s.keyIdx, side: s.side, joints: joints, group: group, visible: true });
      out.ghosts.push({ keyIndex: s.keyIdx, side: s.side, joints: joints, jointCount: Object.keys(joints).length });
      made++;
    });
    out.made = made;
    if (!made) return { ok: false, error: 'Không có key trước/sau key ' + idx + ' để hiện ghost.', ghosts: out.ghosts };
    try { bus.emit('arpqr3:ghost', { keyIndex: idx, which: which, made: made }); } catch (e) {}
    return out;
  }
  function showGhost() {
    var n = 0;
    Keyframe.ghosts.forEach(function (g) { if (g.group) { g.group.visible = true; g.visible = true; n++; } });
    return { ok: true, shown: n };
  }
  function hideGhost() {
    var n = 0;
    Keyframe.ghosts.forEach(function (g) {
      if (g.group) {
        g.group.visible = false;
        try { if (g.group.parent) g.group.parent.remove(g.group); } catch (e) {}
        n++;
      }
    });
    Keyframe.ghosts = [];
    return { ok: true, hidden: n };
  }
  Keyframe.clearGhosts = hideGhost;

  /* ============================================================
     UI — renderSection(container)
     DOM thuần + inline style, không sửa CSS. UI tự refresh sau
     mỗi thao tác; lúc đang phát, vòng requestAnimationFrame gọi
     tick(dt) rồi cập nhật time readout (jsdom không có rAF thì
     nút Play chỉ đổi trạng thái, harness gọi tick trực tiếp).
     ============================================================ */
  function renderSection(container) {
    if (!container) return;
    container.innerHTML = '';
    var wrap = el('div', { class: 'arp-qr3-keyframe', style: { border: '1px solid #888', borderRadius: '6px', padding: '8px', margin: '6px 0' } });
    wrap.appendChild(el('div', { html: '<b>🎬 Keyframe Animation</b> — ghi pose control rig theo thời gian rồi phát lại (lerp Euler). Không dùng timer thật: tick(dt) đồng bộ.' }));

    /* --- hàng tên clip + fps --- */
    var nameRow = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' } });
    nameRow.appendChild(el('span', { text: 'Tên clip:' }));
    var nameInput = el('input', { type: 'text', value: (Keyframe.clip && Keyframe.clip.name) || 'Clip 1', style: { flex: '1', minWidth: '120px' } });
    nameInput.addEventListener('change', function () { setClipName(nameInput.value); refresh(); });
    nameRow.appendChild(nameInput);
    nameRow.appendChild(el('span', { text: 'FPS:' }));
    var fpsInput = el('input', { type: 'number', min: '1', max: '120', value: String((Keyframe.clip && Keyframe.clip.fps) || 30), style: { width: '60px' } });
    fpsInput.addEventListener('change', function () { setFps(parseInt(fpsInput.value, 10)); refresh(); });
    nameRow.appendChild(fpsInput);
    wrap.appendChild(nameRow);

    /* --- hàng ghi key --- */
    var recRow = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' } });
    recRow.appendChild(el('span', { text: 't (s):' }));
    var tInput = el('input', { type: 'number', min: '0', step: '0.1', value: '0', style: { width: '70px' } });
    recRow.appendChild(tInput);
    var recMsg = el('span', { style: { fontSize: '12px', color: '#555' }, text: 'Chưa ghi key nào.' });
    recRow.appendChild(el('button', { class: 'btn sm', text: '● Ghi key', style: { fontWeight: 'bold' }, onclick: function () {
      var r = recordKey(parseFloat(tInput.value));
      recMsg.textContent = r.ok ? ('Đã ghi key t=' + r.t + 's (' + r.keyCount + ' keys).') : ('Lỗi: ' + r.error);
      refresh();
    } }));
    recRow.appendChild(el('button', { class: 'btn sm', text: 'Clip mới', onclick: function () { newClip(nameInput.value || 'Clip 1'); recMsg.textContent = 'Clip mới — chưa có key.'; refresh(); } }));
    wrap.appendChild(recRow);
    wrap.appendChild(recMsg);

    /* --- danh sách key --- */
    var keyList = el('div', { class: 'arp-qr3-keylist', style: { margin: '6px 0' } });
    wrap.appendChild(keyList);

    /* --- hàng phát lại --- */
    var playRow = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' } });
    var timeRead = el('span', { style: { fontFamily: 'monospace' }, text: 't = 0.00s / 0.00s · 0%' });
    var loopChk = el('input', { type: 'checkbox' });
    loopChk.checked = !!Keyframe.loop;
    loopChk.addEventListener('change', function () { setLoop(loopChk.checked); });
    var rafId = null;
    var lastTs = 0;
    var stopRaf = function () {
      if (rafId !== null) {
        try {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
          else if (typeof window !== 'undefined' && window.cancelAnimationFrame) window.cancelAnimationFrame(rafId);
        } catch (e) {}
        rafId = null;
      }
    };
    var rafStep = function (ts) {
      if (!Keyframe.playing) { rafId = null; return; }
      var dt = lastTs ? (ts - lastTs) / 1000 : 0;
      lastTs = ts;
      tick(dt);
      refreshTime();
      if (Keyframe.playing) {
        var raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (typeof window !== 'undefined' ? window.requestAnimationFrame : null);
        if (raf) rafId = raf(rafStep);
        else rafId = null;
      } else rafId = null;
    };
    var startRaf = function () {
      stopRaf();
      var raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (typeof window !== 'undefined' ? window.requestAnimationFrame : null);
      if (!raf) return;
      lastTs = 0;
      rafId = raf(rafStep);
    };
    playRow.appendChild(el('button', { class: 'btn sm', text: '▶ Phát', onclick: function () {
      var r = play();
      if (!r.ok) { recMsg.textContent = 'Lỗi: ' + r.error; return; }
      startRaf(); refresh();
    } }));
    playRow.appendChild(el('button', { class: 'btn sm', text: '⏸ Tạm dừng', onclick: function () { pause(); stopRaf(); refresh(); } }));
    playRow.appendChild(el('button', { class: 'btn sm', text: '⏹ Dừng', onclick: function () { stop(); stopRaf(); refresh(); } }));
    playRow.appendChild(el('label', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, [loopChk, el('span', { text: 'Lặp' })]));
    playRow.appendChild(timeRead);
    wrap.appendChild(playRow);

    /* --- xuất / nhập --- */
    var ioRow = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' } });
    ioRow.appendChild(el('button', { class: 'btn sm', text: '⬇ Xuất clip JSON', onclick: function () {
      var r = exportClip();
      recMsg.textContent = r.ok ? ('Đã xuất ' + r.filename + ' (' + r.keyCount + ' keys, ' + r.trackCount + ' tracks).') : ('Lỗi: ' + r.error);
    } }));
    var fileInput = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var r = importClip(reader.result);
        recMsg.textContent = r.ok ? ('Đã nhập "' + r.name + '" (' + r.keyCount + ' keys, format ' + r.sourceFormat + ').') : ('Lỗi nhập: ' + r.error);
        refresh();
      };
      reader.readAsText(f);
    });
    ioRow.appendChild(el('button', { class: 'btn sm', text: '⬆ Nhập clip JSON', onclick: function () { fileInput.click(); } }));
    wrap.appendChild(ioRow);
    wrap.appendChild(fileInput);

    /* --- onion skinning --- */
    var ghostRow = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' } });
    ghostRow.appendChild(el('span', { text: 'Onion skin:' }));
    var ghostSel = el('select', {});
    [['both', 'Trước + sau'], ['prev', 'Key trước'], ['next', 'Key sau']].forEach(function (p) {
      ghostSel.appendChild(el('option', { value: p[0], text: p[1] }));
    });
    ghostRow.appendChild(ghostSel);
    var ghostChk = el('input', { type: 'checkbox' });
    ghostChk.addEventListener('change', function () {
      if (!ghostChk.checked) { hideGhost(); return; }
      var clip = Keyframe.clip;
      if (!clip || !clip.keys.length) { recMsg.textContent = 'Chưa có key để hiện ghost.'; ghostChk.checked = false; return; }
      var cur = 0;
      for (var i = 0; i < clip.keys.length; i++) { if (clip.keys[i].t <= Keyframe.time) cur = i; }
      var r = renderGhost(cur, { which: ghostSel.value });
      recMsg.textContent = r.ok ? ('Ghost: ' + r.made + ' bóng mờ (key ' + r.ghosts.map(function (g) { return g.side + ':' + g.keyIndex; }).join(', ') + ').') : ('Lỗi ghost: ' + r.error);
      if (!r.ok) ghostChk.checked = false;
    });
    ghostRow.appendChild(el('label', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, [ghostChk, el('span', { text: 'Hiện bóng mờ' })]));
    wrap.appendChild(ghostRow);

    var refreshTime = function () {
      var clip = Keyframe.clip;
      var dur = clip ? clip.duration : 0;
      timeRead.textContent = 't = ' + Keyframe.time.toFixed(2) + 's / ' + dur.toFixed(2) + 's · ' + Math.round(getProgress() * 100) + '%';
    };
    var refresh = function () {
      var clip = Keyframe.clip;
      refreshTime();
      keyList.innerHTML = '';
      if (!clip || !clip.keys.length) {
        keyList.appendChild(el('div', { style: { fontSize: '12px', color: '#555' }, text: 'Chưa có keyframe — chỉnh pose rồi bấm "Ghi key".' }));
        return;
      }
      clip.keys.forEach(function (k, i) {
        var row = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '2px 0', fontSize: '13px' } });
        row.appendChild(el('span', { text: '#' + i + ' · t=' + k.t.toFixed(2) + 's · ' + Object.keys(k.pose || {}).length + ' xương', style: { flex: '1' } }));
        row.appendChild(el('button', { class: 'btn sm', text: 'Nhảy tới', onclick: function () { gotoKey(i); refresh(); } }));
        row.appendChild(el('button', { class: 'btn sm', text: 'Ghost', onclick: function () {
          var r = renderGhost(i, { which: ghostSel.value });
          recMsg.textContent = r.ok ? ('Ghost key #' + i + ': ' + r.made + ' bóng mờ.') : ('Lỗi ghost: ' + r.error);
        } }));
        row.appendChild(el('button', { class: 'btn sm', text: '✕ Xóa', onclick: function () { deleteKey(i); refresh(); } }));
        keyList.appendChild(row);
      });
    };
    wrap.appendChild(el('div', { style: { fontSize: '12px', color: '#555', marginTop: '4px' },
      text: 'Ghi key chụp rotation hiện tại của mọi xương + trạng thái FK (ngón, bàn chân, đầu, hàm). Xuất JSON đúng format clip studio (pixistudio-arp-keyframe-clips-1, track .quaternion/.position) — nhập lại được cả file coco/hy3d.' }));
    container.appendChild(wrap);
    refresh();
  }

  /* ---------- public API ---------- */
  Keyframe.newClip = newClip;
  Keyframe.setClipName = setClipName;
  Keyframe.setDuration = setDuration;
  Keyframe.setFps = setFps;
  Keyframe.getClip = getClip;
  Keyframe.recordKey = recordKey;
  Keyframe.deleteKey = deleteKey;
  Keyframe.deleteKeyAt = deleteKeyAt;
  Keyframe.gotoKey = gotoKey;
  Keyframe.gotoKeyAt = gotoKeyAt;
  Keyframe.play = play;
  Keyframe.pause = pause;
  Keyframe.stop = stop;
  Keyframe.tick = tick;
  Keyframe.setLoop = setLoop;
  Keyframe.getTime = getTime;
  Keyframe.getProgress = getProgress;
  Keyframe.isPlaying = isPlaying;
  Keyframe.exportClip = exportClip;
  Keyframe.importClip = importClip;
  Keyframe.buildAnimationClip = buildAnimationClip;
  Keyframe.renderGhost = renderGhost;
  Keyframe.showGhost = showGhost;
  Keyframe.hideGhost = hideGhost;
  Keyframe.renderSection = renderSection;
  Keyframe._test = {
    capturePose: capturePose,
    applyPose: applyPose,
    lerpPose: lerpPose,
    lerpFk: lerpFk,
    poseAt: poseAt,
    tracksFromKeys: tracksFromKeys,
    validateTracks: validateTracks,
    sampleQuatTrack: sampleQuatTrack,
    sampleVecTrack: sampleVecTrack,
    snapshotJoints: snapshotJoints,
    eulerToQuat: eulerToQuat,
    quatToEuler: quatToEuler,
    resolveKey: resolveKey,
    GHOST_JOINTS: GHOST_JOINTS
  };

  window.PixiStudio = window.PixiStudio || {};
  if (QR) QR.Keyframe = Keyframe;
  else {
    /* ArpQuickRig chưa nạp trước: giữ chỗ để coordinator nối sau. */
    window.PixiStudio.ArpQuickRig = window.PixiStudio.ArpQuickRig || {};
    window.PixiStudio.ArpQuickRig.Keyframe = Keyframe;
  }
  /* Hook đăng ký section vào tab Quick Rig — coordinator sẽ thêm
     registerSection sau; module chạy được cả khi chưa có hook. */
  try {
    if (QR && typeof QR.registerSection === 'function') QR.registerSection('keyframe', renderSection);
  } catch (e) {}
})();
