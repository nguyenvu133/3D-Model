/* ============================================================
 * rig/arp-animator.js — TAB ANIMATOR (Auto Rig Pro Blend)
 *
 * Tab xem / phát / chỉnh sửa animation đầy đủ cho model hiện tại.
 * Đăng ký tab 'animator' SAU 'plugins' qua ArpPanel.registerTab
 * (panel liệt kê tab ngoài TAB_ORDER theo thứ tự đăng ký).
 *
 * NGUỒN CLIP (chỉ ĐỌC, không sửa module gốc):
 *   • PixiStudio.Anim.clips — clip GLB/FBX + preset procedural
 *   • PixiStudio.AnimAutoGen.definitions — 10 clip procedural
 *     (Idle/Walk/Run/Attack/Combo/Dodge/Wave/Punch/Kick/Bow);
 *     phát qua AnimAutoGen.play, không có mixer riêng để scrub.
 *   • PixiStudio.ArpQuickRig.Keyframe.clip — clip keyframe đã ghi
 *   • PixiStudio.Coco.clips / PixiStudio.Hy3d.clips — clip nhân vật
 *   • Clip user tạo bằng chỉnh sửa (trim/retime/reverse/mirror)
 *     lưu trong Animator._userClips, chỉ clip này mới xóa được.
 *
 * PHÁT LẠI: Animator.tick(dt) đồng bộ — UI trình duyệt gọi bằng
 * requestAnimationFrame, harness gọi trực tiếp. KHÔNG dùng timer
 * thật trong module. Clip THREE.AnimationClip phát qua
 * THREE.AnimationMixer riêng của tab (không đụng Anim.mixer);
 * clip keyframe ủy thác cho Keyframe.tick; clip autogen ủy thác
 * cho AnimAutoGen.play (chỉ phát, không scrub/step được).
 *
 * CHỈNH SỬA CLIP (thuần, làm trên THREE.AnimationClip):
 *   trim (cắt + nội suy biên), retime (đổi tốc độ, giữ số key),
 *   reverse (đảo thời gian), mirror (đổi cặp Left/Right + lật dấu
 *   quay x,z / vị trí x — mirror gần đúng qua mặt phẳng dọc).
 *   Lưu thành clip MỚI, không ghi đè clip gốc.
 *
 * LAYERS: lớp Base = clip đang phát. Lớp Additive = 1 clip cộng
 *   thêm rotation (delta quaternion so với frame đầu của clip
 *   additive, nhân trọng số) — KHÔNG cộng position root.
 *
 * ROOT MOTION: bật = Hips.position từ clip áp bình thường; tắt =
 *   sau mỗi mixer.update, Hips.position trả về vị trí bind đã chụp
 *   lúc bắt đầu phát. Đường root = mẫu Hips.position dọc clip.
 *
 * HIỂN THỊ VIEWPORT (dùng lại module arp-vp-* qua try/catch):
 *   skeleton → ArpVpSkeleton, IK overlay → ArpVpIk,
 *   trails/onion → ArpVpTrails (+ ghost Keyframe cho onion),
 *   frame readout → overlay #arp-anim-readout trong viewport,
 *   góc xương → top 3 xương có góc quay lớn nhất giữa 2 mẫu.
 *
 * XUẤT: JSON đúng format clip studio (tracks .quaternion/.position,
 *   kiểm qua Anim.validateClip khi có) + FBX qua FBXBinary.write
 *   (opts.animations, version 7300) kèm skeleton của model.
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Nội suy pose khi trim/mirror/additive dùng lerp Euler hoặc
 *     slerp quaternion theo track; pose xoay lớn qua ±π có thể đi
 *     đường vòng (giống Keyframe cũ).
 *   • Crossfade = THREE crossFadeTo giữa 2 AnimationAction; blend
 *     2 clip = đặt trọng số 2 action cùng chạy — không phải blend
 *     theo trọng số từng xương.
 *   • Mirror là gần đúng hình học (đổi cặp L/R + lật dấu), không
 *     phải mirror xương thật theo bind pose.
 *   • FBX export dùng writer tự viết của studio (FBXBinary.write);
 *     file ra cần kiểm chứng lại bằng FBXLoader/fbx2gltf, và writer
 *     yêu cầu model có mesh (ném lỗi nếu không có mesh).
 *   • Clip AnimAutoGen chỉ phát được (play), không scrub/step/
 *     trim/reverse/mirror được vì AnimAutoGen không expose clip
 *     THREE.AnimationClip ra ngoài.
 *   • three r128: mixer.update(0) là no-op (không áp lại pose) nên
 *     scrub dùng epsilon 0.0001s để ép áp lại pose (lệch ~0.1ms);
 *     thêm nữa PropertyMixer.apply() bỏ qua setValue khi accu0 ==
 *     accu1 (scrub 2 lần cùng 1 thời điểm) nên setTime tự áp pose
 *     bằng sampling trực tiếp để pose hiển thị luôn đúng.
 *   • Additive có guard chống cộng dồn khi áp 2 lần cùng 1 thời
 *     điểm mà mixer chưa viết lại pose base.
 *   • Additive cộng rotation lên pose sau mixer.update; nếu clip
 *     base là keyframe thì additive không áp được (Keyframe ghi đè
 *     rotation trực tiếp mỗi tick) — trả lỗi rõ.
 * ============================================================ */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined' && window.PixiStudio) || {};
  var bus = (PS && PS.bus) || { emit: function () {}, on: function () {} };
  var U = (PS && PS.Utils) || null;

  var FORMAT = 'pixistudio-animator-clips-1';
  var EPS = 1e-6;
  var DEFAULT_FPS = 30;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round3(v) { return Math.round(v * 1000) / 1000; }
  function round4(v) { return Math.round(v * 10000) / 10000; }
  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message }); } catch (e) {}
  }
  function slug(name) {
    return String(name || 'clip').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'clip';
  }
  /* ' mixamorigHips.position' → 'Hips'; 'mixamorig:LeftArm.quaternion' → 'LeftArm' */
  function stripBoneName(full) {
    var s = String(full || '').trim();
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    s = s.replace(/\.(quaternion|position|scale)$/i, '');
    return s;
  }
  function isQuatTrack(t) { return /\.quaternion$/i.test(t.name || ''); }
  function isPosTrack(t) { return /\.position$/i.test(t.name || ''); }

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
     STATE
     ============================================================ */
  var Animator = {
    FORMAT: FORMAT,
    currentId: null,
    time: 0,
    playing: false,
    paused: false,
    speed: 1,
    loopMode: 'loop',          /* 'loop' | 'once' */
    fadeDuration: 0.25,        /* giây, crossfade mặc định */
    rootMotion: true,
    blend: { clipBId: null, weight: 0 },
    additive: { clipId: null, weight: 0.5, enabled: false },
    display: { skeleton: false, ik: false, trails: false, onion: false, readout: true, boneAngles: true, rootPath: false },
    events: {},                /* clipId -> [{id, t, name}] */
    firedLog: [],              /* [{name, t, at}] trong lần phát này */
    topBones: [],              /* [{bone, deg}] 3 xương chuyển động mạnh nhất */
    rootPos: { x: 0, y: 0, z: 0 },
    rootPath: [],              /* [{t, x, y, z}] */
    _clips: [],                /* registry đã chuẩn hóa (không gồm user) */
    _userClips: [],            /* clip do user tạo bằng chỉnh sửa — xóa được */
    _extraClips: [],           /* clip đăng ký ngoài (harness/nguồn khác) có
                                 userCreated:false — KHÔNG xóa được */
    _mixer: null,
    _target: null,
    _actions: {},              /* clipId -> THREE.AnimationAction */
    _currentAction: null,
    _blendAction: null,
    _bindHips: null,
    _firedIds: {},
    _addLastKey: null,         /* guard chống additive cộng dồn */
    _evSeq: 0,
    _rootPathLine: null
  };

  /* ---------- truy cập module khác (defensive) ---------- */
  function getAnim() { return (PS && PS.Anim) || null; }
  function getAutoGen() { return (PS && PS.AnimAutoGen) || null; }
  function getKeyframe() {
    var QR = (PS && PS.ArpQuickRig) || null;
    return (QR && QR.Keyframe) || null;
  }
  function getTarget() {
    var t = Animator._target;
    if (t) return t;
    var Anim = getAnim();
    if (Anim && Anim.targetObject) return Anim.targetObject;
    if (PS.Viewport && typeof PS.Viewport.getMainModel === 'function') {
      try { return PS.Viewport.getMainModel(); } catch (e) { return null; }
    }
    return null;
  }
  function getScene() {
    if (PS.Viewport && PS.Viewport.scene) return PS.Viewport.scene;
    var t = getTarget();
    if (t) { var s = t; while (s && s.parent) s = s.parent; return s; }
    return null;
  }
  function getBoneMap() {
    var target = getTarget();
    var map = {};
    if (!target) return map;
    target.traverse(function (o) {
      if (o.isBone && o.name) map[stripBoneName(o.name)] = o;
    });
    return map;
  }
  function findHipsBone() {
    var map = getBoneMap();
    return map.Hips || map.hips || null;
  }

  /* ============================================================
     1. DANH SÁCH CLIP
     ============================================================ */
  function refreshClips() {
    var out = [];
    var seen = {};
    function push(e) {
      if (!e || !e.id || seen[e.id]) return;
      seen[e.id] = true;
      out.push(e);
    }
    /* Đồng bộ Quick Rig ↔ Animator (vòng sync): 1 nguồn clip duy nhất
       qua ArpSyncClips.animatorEntries() khi module sync đã load; nếu
       chưa load (vd trang cũ cache) thì liệt kê thủ công như trước. */
    var SC = (window.PixiStudio && window.PixiStudio.ArpSyncClips) || null;
    var usedSync = false;
    if (SC && typeof SC.animatorEntries === 'function') {
      try {
        SC.animatorEntries().forEach(function (e) { push(e); });
        usedSync = true;
      } catch (err) { usedSync = false; }
    }
    if (!usedSync) {
      /* Anim: clip GLB/FBX + preset procedural (THREE.AnimationClip thật) */
      var Anim = getAnim();
      if (Anim && Array.isArray(Anim.clips)) {
        Anim.clips.forEach(function (c) {
          if (!c) return;
          push({
            id: 'anim:' + (c.name || 'Clip'), name: c.name || 'Clip',
            duration: (c.clip && c.clip.duration) || c.duration || 0,
            fps: DEFAULT_FPS, loop: c.loop !== false, source: c.isPreset ? 'preset' : 'anim',
            clip: c.clip || null, keys: null, userCreated: false
          });
        });
      }
      /* AnimAutoGen: 10 clip procedural theo định nghĩa (chỉ phát) */
      var AG = getAutoGen();
      if (AG && Array.isArray(AG.definitions)) {
        AG.definitions.forEach(function (d) {
          push({
            id: 'autogen:' + d.id, name: d.id, duration: d.dur || 0,
            fps: DEFAULT_FPS, loop: true, source: 'autogen',
            clip: null, keys: null, userCreated: false
          });
        });
      }
      /* Keyframe: clip đã ghi bằng tab Quick Rig */
      var KF = getKeyframe();
      if (KF && KF.clip && KF.clip.keys && KF.clip.keys.length) {
        push({
          id: 'keyframe:' + (KF.clip.name || 'Clip 1'), name: KF.clip.name || 'Clip 1',
          duration: KF.clip.duration || 0, fps: KF.clip.fps || DEFAULT_FPS,
          loop: !!KF.clip.loop, source: 'keyframe',
          clip: null, keys: KF.clip.keys, userCreated: false
        });
      }
      /* Coco / HY3D: clip nhân vật (THREE.AnimationClip thật) */
      [['Coco', 'coco'], ['Hy3d', 'hy3d']].forEach(function (pair) {
        var mod = PS[pair[0]];
        if (mod && Array.isArray(mod.clips)) {
          mod.clips.forEach(function (c) {
            if (!c) return;
            push({
              id: pair[1] + ':' + (c.id || c.name), name: c.name || c.id || 'Clip',
              duration: (c.clip && c.clip.duration) || c.duration || 0,
              fps: DEFAULT_FPS, loop: c.loop !== false, source: pair[1],
              clip: c.clip || null, keys: null, userCreated: false
            });
          });
        }
      });
    }
    /* Clip user tạo bằng chỉnh sửa — ghi đè trùng id nếu có.
       Clip đăng ký ngoài (userCreated:false) vào _extraClips riêng
       để deleteClip không bao giờ xóa nhầm clip gốc. */
    Animator._extraClips.forEach(function (c) { push(c); });
    Animator._userClips.forEach(function (c) { push(c); });
    Animator._clips = out;
    return out;
  }

  /* Đồng bộ Quick Rig ↔ Animator (vòng sync): lắng nghe clip đổi
     (Keyframe ghi key mới / clip bake xong / clip bị xóa) để refresh
     danh sách. Đăng ký 1 lần duy nhất; handler chỉ re-render khi tab
     Animator đang mở (showTab render lại mỗi lần đổi tab nên danh
     sách vẫn đúng cả khi tab đang đóng). */
  function subscribeClipChanged() {
    if (Animator._clipChangedSubscribed) return;
    var bus = (window.PixiStudio && window.PixiStudio.bus) || null;
    if (!bus || typeof bus.on !== 'function') return;
    Animator._clipChangedSubscribed = true;
    try {
      bus.on('arp:animator-clip-changed', function () {
        refreshClips();
        try {
          var Panel = PS.ArpPanel;
          if (Panel && typeof Panel.currentTab === 'function' && Panel.currentTab() === 'animator' && Animator._bodyEl) {
            render(Animator._bodyEl);
          }
        } catch (e) {}
      });
    } catch (e) { Animator._clipChangedSubscribed = false; }
  }

  function listClips(filter) {
    refreshClips();
    var q = String(filter || '').trim().toLowerCase();
    if (!q) return Animator._clips.slice();
    return Animator._clips.filter(function (c) {
      return (c.name || '').toLowerCase().indexOf(q) >= 0 ||
        (c.source || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function getClip(id) {
    refreshClips();
    for (var i = 0; i < Animator._clips.length; i++) {
      if (Animator._clips[i].id === id) return Animator._clips[i];
    }
    return null;
  }

  /* Đăng ký 1 clip THREE.AnimationClip (hoặc keyframe-format) để phát/
     chỉnh sửa. Dùng cho harness + saveEditedClip. */
  function registerClip(entry) {
    if (!entry || !entry.name) return { ok: false, error: 'Clip cần có tên.' };
    var dur = 0;
    if (entry.clip && entry.clip.duration !== undefined) dur = entry.clip.duration;
    else if (entry.duration !== undefined) dur = entry.duration;
    else if (entry.keys && entry.keys.length) dur = entry.keys[entry.keys.length - 1].t || 0;
    if (!(dur > 0)) return { ok: false, error: 'Clip không có độ dài > 0.' };
    var e = {
      id: entry.id || ('user:' + slug(entry.name)),
      name: entry.name, duration: dur,
      fps: entry.fps || DEFAULT_FPS, loop: entry.loop !== false,
      source: entry.source || 'user',
      clip: entry.clip || null, keys: entry.keys || null,
      userCreated: entry.userCreated !== false
    };
    var idx = -1;
    var store = e.userCreated ? Animator._userClips : Animator._extraClips;
    var other = e.userCreated ? Animator._extraClips : Animator._userClips;
    other.forEach(function (c, i) { if (c.id === e.id) other.splice(i, 1); });
    store.forEach(function (c, i) { if (c.id === e.id) idx = i; });
    if (idx >= 0) store[idx] = e;
    else store.push(e);
    refreshClips();
    return { ok: true, id: e.id, name: e.name, duration: e.duration };
  }

  /* ============================================================
     LẤY MẪU TRACK (slerp quaternion / lerp vector)
     ============================================================ */
  function sampleQuatTrack(track, t) {
    var times = track.times, vals = track.values, n = times.length;
    var Q = window.THREE.Quaternion;
    if (!n) return new Q();
    if (t <= times[0] || n === 1) return new Q(vals[0], vals[1], vals[2], vals[3]);
    if (t >= times[n - 1]) {
      var o = (n - 1) * 4;
      return new Q(vals[o], vals[o + 1], vals[o + 2], vals[o + 3]);
    }
    for (var i = 0; i < n - 1; i++) {
      if (t >= times[i] && t <= times[i + 1]) {
        var span = times[i + 1] - times[i];
        var a = span > EPS ? (t - times[i]) / span : 0;
        var qa = new Q(vals[i * 4], vals[i * 4 + 1], vals[i * 4 + 2], vals[i * 4 + 3]);
        var qb = new Q(vals[(i + 1) * 4], vals[(i + 1) * 4 + 1], vals[(i + 1) * 4 + 2], vals[(i + 1) * 4 + 3]);
        return qa.slerp(qb, a);
      }
    }
    return new Q();
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
        var a = span > EPS ? (t - times[i]) / span : 0;
        var va = at(i), vb = at(i + 1);
        return { x: va.x + (vb.x - va.x) * a, y: va.y + (vb.y - va.y) * a, z: va.z + (vb.z - va.z) * a };
      }
    }
    return at(0);
  }
  /* Pose quaternion của toàn bộ clip tại t: {boneStripped: Quaternion} */
  function sampleClipPose(clip, t) {
    var pose = {};
    if (!clip || !clip.tracks) return pose;
    clip.tracks.forEach(function (tr) {
      if (isQuatTrack(tr)) pose[stripBoneName(tr.name)] = sampleQuatTrack(tr, t);
    });
    return pose;
  }
  function findHipsTrack(clip) {
    if (!clip || !clip.tracks) return null;
    for (var i = 0; i < clip.tracks.length; i++) {
      var tr = clip.tracks[i];
      if (isPosTrack(tr) && stripBoneName(tr.name) === 'Hips') return tr;
    }
    return null;
  }
  function rootPosAt(clip, t) {
    var tr = findHipsTrack(clip);
    if (!tr) return null;
    return sampleVecTrack(tr, t);
  }
  function rootPathFor(clip, samples) {
    samples = samples || 33;
    var out = [];
    if (!clip || !(clip.duration > 0)) return out;
    var tr = findHipsTrack(clip);
    if (!tr) return out;
    for (var i = 0; i < samples; i++) {
      var t = clip.duration * i / (samples - 1);
      var p = sampleVecTrack(tr, t);
      out.push({ t: round3(t), x: round4(p.x), y: round4(p.y), z: round4(p.z) });
    }
    return out;
  }

  /* ============================================================
     2. ĐIỀU KHIỂN PHÁT (play/pause/stop/scrub/step/tốc độ/loop)
     ============================================================ */
  function getFrameInfo() {
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    var dur = entry ? entry.duration : 0;
    var fps = entry ? (entry.fps || DEFAULT_FPS) : DEFAULT_FPS;
    var total = Math.max(1, Math.round(dur * fps));
    var frame = dur > 0 ? clamp(Math.floor(Animator.time * fps) + 1, 1, total) : 0;
    return {
      time: round3(Animator.time), duration: round3(dur), frame: frame,
      totalFrames: total, fps: fps,
      text: Animator.time.toFixed(2) + 's / ' + dur.toFixed(2) + 's · frame ' + frame + '/' + total
    };
  }

  function ensureMixer() {
    if (!window.THREE) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var target = getTarget();
    if (!target) return { ok: false, error: 'Chưa có model — load/rig model trước.' };
    if (!Animator._mixer || Animator._target !== target) {
      try { if (Animator._mixer) Animator._mixer.stopAllAction(); } catch (e) {}
      Animator._mixer = new window.THREE.AnimationMixer(target);
      Animator._target = target;
      Animator._actions = {};
      Animator._currentAction = null;
      Animator._blendAction = null;
    }
    return { ok: true, mixer: Animator._mixer };
  }

  function captureBindHips() {
    var hips = findHipsBone();
    if (hips) Animator._bindHips = { x: hips.position.x, y: hips.position.y, z: hips.position.z };
    else Animator._bindHips = null;
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (entry && entry.clip) {
      Animator.rootPath = rootPathFor(entry.clip, 33);
      var p0 = rootPosAt(entry.clip, Animator.time);
      if (p0) Animator.rootPos = { x: round4(p0.x), y: round4(p0.y), z: round4(p0.z) };
    } else Animator.rootPath = [];
  }

  function applyRootMotion() {
    if (Animator.rootMotion) {
      var entry = Animator.currentId ? getClip(Animator.currentId) : null;
      if (entry && entry.clip) {
        var p = rootPosAt(entry.clip, Animator.time);
        if (p) Animator.rootPos = { x: round4(p.x), y: round4(p.y), z: round4(p.z) };
      }
      return { ok: true, applied: true };
    }
    var hips = findHipsBone();
    if (hips && Animator._bindHips) {
      hips.position.set(Animator._bindHips.x, Animator._bindHips.y, Animator._bindHips.z);
      Animator.rootPos = { x: round4(Animator._bindHips.x), y: round4(Animator._bindHips.y), z: round4(Animator._bindHips.z) };
      return { ok: true, applied: false };
    }
    return { ok: false, error: 'Không tìm thấy xương Hips để khóa root.' };
  }

  /* Cộng rotation additive lên pose hiện tại (sau mixer.update).
     Chỉ cộng rotation — position root không đụng tới. */
  function applyAdditive() {
    var ad = Animator.additive;
    if (!ad.enabled || !ad.clipId || !(ad.weight > 0)) return { ok: false, reason: 'Additive chưa bật.' };
    var entry = getClip(ad.clipId);
    if (!entry || !entry.clip) return { ok: false, error: 'Clip additive không có THREE.AnimationClip.' };
    var cur = getClip(Animator.currentId);
    if (cur && cur.source === 'keyframe') return { ok: false, error: 'Clip base là keyframe — Keyframe ghi đè rotation mỗi tick nên additive không áp được.' };
    if (!window.THREE) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var tAdd = entry.duration > 0 ? (Animator.time % entry.duration) : 0;
    var poseNow = sampleClipPose(entry.clip, tAdd);
    var poseBase = sampleClipPose(entry.clip, 0);
    var map = getBoneMap();
    var ident = new window.THREE.Quaternion();
    /* Chống cộng dồn: nếu đã áp đúng (time, clip, weight) này rồi mà
       mixer chưa viết lại pose base thì bỏ qua lần áp thứ 2. */
    var key = round3(Animator.time) + '|' + ad.clipId + '|' + ad.weight;
    if (Animator._addLastKey === key) return { ok: true, applied: 0, skipped: true, reason: 'Đã áp additive ở thời điểm này rồi.' };
    var n = 0;
    Object.keys(poseNow).forEach(function (bone) {
      var b = map[bone];
      if (!b) return;
      var qNow = poseNow[bone];
      var q0 = poseBase[bone] || ident;
      var delta = qNow.clone().multiply(q0.clone().invert());
      var wDelta = ident.clone().slerp(delta, clamp(ad.weight, 0, 1));
      b.quaternion.multiply(wDelta);
      n++;
    });
    Animator._addLastKey = key;
    return { ok: true, applied: n, clipId: ad.clipId, weight: ad.weight };
  }

  function updateTopBones() {
    Animator.topBones = [];
    if (!Animator.display.boneAngles) return Animator.topBones;
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (!entry || !entry.clip) return Animator.topBones;
    var dt = 0.05;
    var t0 = Animator.time, t1 = Math.min(entry.duration, t0 + dt);
    if (t1 - t0 < 0.001) return Animator.topBones;
    var p0 = sampleClipPose(entry.clip, t0);
    var p1 = sampleClipPose(entry.clip, t1);
    var scored = [];
    Object.keys(p0).forEach(function (bone) {
      if (!p1[bone]) return;
      var deg = p0[bone].angleTo(p1[bone]) * 180 / Math.PI;
      scored.push({ bone: bone, deg: round3(deg) });
    });
    scored.sort(function (a, b) { return b.deg - a.deg; });
    Animator.topBones = scored.slice(0, 3);
    return Animator.topBones;
  }

  function fireEventsInRange(from, to) {
    var fired = [];
    if (!Animator.currentId) return fired;
    var list = Animator.events[Animator.currentId] || [];
    list.forEach(function (ev) {
      if (ev.t > from && ev.t <= to && !Animator._firedIds[ev.id]) {
        Animator._firedIds[ev.id] = true;
        var rec = { id: ev.id, name: ev.name, t: round3(ev.t), at: round3(Animator.time) };
        Animator.firedLog.push(rec);
        fired.push(rec);
        notify('info', 'Animator event', '"' + ev.name + '" @ ' + ev.t.toFixed(2) + 's');
        try { bus.emit('animator:event', rec); } catch (e) {}
      }
    });
    return fired;
  }

  function play(id) {
    /* Giữ action cũ để crossfade — KHÔNG stopAllAction ở đây (stop sẽ
       hủy action cũ trước khi fade). Chỉ dừng Keyframe cũ nếu có. */
    var prevAction = Animator._currentAction;
    var prevEntry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (id) {
      var e = getClip(id);
      if (!e) return { ok: false, error: 'Không tìm thấy clip "' + id + '".' };
      if (Animator.currentId !== id) {
        if (prevEntry && prevEntry.source === 'keyframe') {
          var KF0 = getKeyframe();
          if (KF0 && typeof KF0.stop === 'function') { try { KF0.stop(); } catch (err) {} }
        }
        Animator.currentId = id;
        Animator.time = 0;
        Animator.firedLog = [];
        Animator._firedIds = {};
        Animator.playing = false;
        Animator.paused = false;
      }
    }
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (!entry) return { ok: false, error: 'Chưa chọn clip nào — chọn 1 clip trong danh sách.' };
    if (!(entry.duration > 0)) return { ok: false, error: 'Clip "' + entry.name + '" không có độ dài.' };

    /* Clip autogen: chỉ phát qua AnimAutoGen (không mixer/scrub) */
    if (entry.source === 'autogen') {
      var AG = getAutoGen();
      if (!AG || typeof AG.play !== 'function') return { ok: false, error: 'AnimAutoGen chưa load — không phát được clip procedural.' };
      try { AG.play(entry.name); } catch (err) { return { ok: false, error: 'AnimAutoGen.play lỗi: ' + (err && err.message) }; }
      Animator.playing = true;
      Animator.paused = false;
      applyDisplayOnPlay();
      return { ok: true, id: entry.id, name: entry.name, via: 'autogen', note: 'Clip autogen chỉ phát — không scrub/step/chỉnh sửa được.' };
    }
    /* Clip keyframe: ủy thác Keyframe */
    if (entry.source === 'keyframe') {
      var KF = getKeyframe();
      if (!KF || typeof KF.play !== 'function') return { ok: false, error: 'Keyframe chưa load.' };
      if (typeof KF.setLoop === 'function') { try { KF.setLoop(Animator.loopMode === 'loop'); } catch (err) {} }
      var r = KF.play();
      if (r && r.ok === false) return r;
      Animator.playing = true;
      Animator.paused = false;
      Animator.time = (typeof KF.getTime === 'function') ? KF.getTime() : 0;
      applyDisplayOnPlay();
      return { ok: true, id: entry.id, name: entry.name, via: 'keyframe' };
    }
    /* Clip THREE: mixer riêng của tab */
    if (!entry.clip) return { ok: false, error: 'Clip "' + entry.name + '" không có THREE.AnimationClip để phát.' };
    var mx = ensureMixer();
    if (!mx.ok) return mx;
    var action = Animator._actions[entry.id];
    if (!action) {
      try { action = mx.mixer.clipAction(entry.clip); } catch (err) { return { ok: false, error: 'clipAction lỗi: ' + (err && err.message) }; }
      Animator._actions[entry.id] = action;
    }
    try {
      action.reset();
      action.setLoop(Animator.loopMode === 'loop' ? window.THREE.LoopRepeat : window.THREE.LoopOnce);
      action.clampWhenFinished = Animator.loopMode !== 'loop';
      action.setEffectiveTimeScale(1); /* Animator tự nhân dt*speed khi tick */
      action.setEffectiveWeight(Animator.blend.clipBId ? (1 - Animator.blend.weight) : 1);
      action.paused = false;
      action.play();
      if (prevAction && prevAction !== action) {
        if (Animator.fadeDuration > 0) prevAction.crossFadeTo(action, Animator.fadeDuration, false);
        else prevAction.stop();
      }
    } catch (err) { return { ok: false, error: 'Phát clip lỗi: ' + (err && err.message) }; }
    Animator._currentAction = action;
    Animator.playing = true;
    Animator.paused = false;
    captureBindHips();
    if (Animator.blend.clipBId) syncBlendAction();
    applyDisplayOnPlay();
    updateTopBones();
    return { ok: true, id: entry.id, name: entry.name, via: 'mixer', crossfadeFrom: prevAction && prevAction !== action ? true : false };
  }

  function pause() {
    if (!Animator.playing) return { ok: false, error: 'Đang không phát.' };
    Animator.paused = true;
    if (Animator._currentAction) { try { Animator._currentAction.paused = true; } catch (e) {} }
    var KF = getKeyframe();
    var cur = Animator.currentId ? getClip(Animator.currentId) : null;
    if (cur && cur.source === 'keyframe' && KF && typeof KF.pause === 'function') { try { KF.pause(); } catch (e) {} }
    return { ok: true, paused: true, time: round3(Animator.time) };
  }

  function resume() {
    if (!Animator.playing) return { ok: false, error: 'Đang không phát — bấm Play.' };
    Animator.paused = false;
    if (Animator._currentAction) { try { Animator._currentAction.paused = false; } catch (e) {} }
    var KF = getKeyframe();
    var cur = Animator.currentId ? getClip(Animator.currentId) : null;
    if (cur && cur.source === 'keyframe' && KF && typeof KF.resume === 'function') { try { KF.resume(); } catch (e) {} }
    else if (cur && cur.source === 'keyframe' && KF && typeof KF.play === 'function') { try { KF.play(); } catch (e) {} }
    return { ok: true, paused: false, time: round3(Animator.time) };
  }

  function stop(opts) {
    opts = opts || {};
    Animator.playing = false;
    Animator.paused = false;
    Animator.time = 0;
    try { if (Animator._mixer) Animator._mixer.stopAllAction(); } catch (e) {}
    var KF = getKeyframe();
    var cur = Animator.currentId ? getClip(Animator.currentId) : null;
    if (cur && cur.source === 'keyframe' && KF && typeof KF.stop === 'function') { try { KF.stop(); } catch (e) {} }
    Animator._currentAction = null;
    Animator._blendAction = null;
    Animator.blend = { clipBId: null, weight: 0 };
    if (!opts.silent) { Animator.firedLog = []; Animator._firedIds = {}; }
    return { ok: true, time: 0 };
  }

  /* Áp pose của clip tại t bằng sampling trực tiếp (slerp/lerp) thay vì
     chỉ trông chờ mixer: r128 PropertyMixer.apply() chỉ gọi setValue
     khi accu0 ≠ accu1 — scrub 2 lần cùng 1 thời điểm (hoặc đoạn clip
     phẳng) thì mixer cho là "không đổi" và bỏ qua, pose ngoài (do
     additive/manual sửa) không được viết lại. */
  function applyPoseAtTime(entry, t) {
    if (!entry || !entry.clip || !window.THREE) return { ok: false, reason: 'no-clip' };
    var map = getBoneMap();
    var pose = sampleClipPose(entry.clip, t);
    var n = 0;
    Object.keys(pose).forEach(function (bone) {
      var b = map[bone];
      if (!b) return;
      b.quaternion.copy(pose[bone]);
      n++;
    });
    var hips = findHipsBone();
    var p = rootPosAt(entry.clip, t);
    if (hips && p) hips.position.set(p.x, p.y, p.z);
    /* Đồng bộ thời gian cho action blend (nếu đang blend) */
    if (Animator._blendAction && Animator.blend.clipBId) {
      var bEntry = getClip(Animator.blend.clipBId);
      if (bEntry && bEntry.duration > 0) {
        try { Animator._blendAction.time = t % bEntry.duration; } catch (e) {}
      }
    }
    return { ok: true, applied: n };
  }

  function setTime(t) {
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (!entry) return { ok: false, error: 'Chưa chọn clip.' };
    if (entry.source === 'autogen') return { ok: false, error: 'Clip AnimAutoGen không scrub được — chỉ phát.' };
    t = clamp(t, 0, entry.duration);
    var prev = Animator.time;
    Animator.time = t;
    if (entry.source === 'keyframe') {
      var KF = getKeyframe();
      if (KF && typeof KF.gotoKeyAt === 'function') { try { KF.gotoKeyAt(t); } catch (e) {} }
    } else if (entry.clip) {
      /* Chưa có action (scrub trước khi Play) → tạo action, đặt thời
         gian rồi tạm dừng để pose hiện đúng trong viewport. */
      if (!Animator._currentAction) {
        var mx2 = ensureMixer();
        if (mx2.ok) {
          try {
            var a0 = mx2.mixer.clipAction(entry.clip);
            Animator._actions[entry.id] = a0;
            a0.reset();
            a0.setLoop(Animator.loopMode === 'loop' ? window.THREE.LoopRepeat : window.THREE.LoopOnce);
            a0.setEffectiveTimeScale(1);
            a0.play();
            Animator._currentAction = a0;
            captureBindHips();
          } catch (e) {}
        }
      }
      if (Animator._currentAction) {
        try {
          Animator._addLastKey = null; /* mixer sắp viết lại pose base */
          Animator._currentAction.time = t;
          /* r128: mixer.update(0) là no-op (không áp lại pose) và action
             đang paused có effective timeScale = 0 nên update cũng là
             no-op — phải để action CHẠY khi update epsilon 0.0001s để
             ép áp lại pose, rồi mới pause lại (lệch pose ~0.1ms). */
          Animator._currentAction.paused = false;
          if (Animator._mixer) Animator._mixer.update(0.0001);
          Animator._currentAction.time = t;
          if (!(Animator.playing && !Animator.paused)) Animator._currentAction.paused = true;
        } catch (e) {}
      }
      /* Áp pose trực tiếp (xem applyPoseAtTime): mixer có thể bỏ qua
         setValue khi scrub cùng 1 thời điểm 2 lần (accu0 == accu1). */
      applyPoseAtTime(entry, t);
    }
    fireEventsInRange(Math.min(prev, t), Math.max(prev, t));
    applyRootMotion();
    applyAdditive();
    updateTopBones();
    updateReadout();
    return { ok: true, time: round3(t), frame: getFrameInfo() };
  }

  function stepFrame(dir) {
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (!entry) return { ok: false, error: 'Chưa chọn clip.' };
    var fps = entry.fps || DEFAULT_FPS;
    var nt = Animator.time + (dir >= 0 ? 1 : -1) / fps;
    if (Animator.loopMode === 'loop') {
      nt = ((nt % entry.duration) + entry.duration) % entry.duration;
    }
    return setTime(nt);
  }

  function setSpeed(s) {
    s = clamp(parseFloat(s) || 1, 0.25, 2);
    Animator.speed = s;
    return { ok: true, speed: s };
  }

  function setLoopMode(mode) {
    if (mode !== 'loop' && mode !== 'once') return { ok: false, error: 'loopMode phải là "loop" hoặc "once".' };
    Animator.loopMode = mode;
    if (Animator._currentAction) {
      try {
        Animator._currentAction.setLoop(mode === 'loop' ? window.THREE.LoopRepeat : window.THREE.LoopOnce);
        Animator._currentAction.clampWhenFinished = mode !== 'loop';
      } catch (e) {}
    }
    return { ok: true, loopMode: mode };
  }

  function tick(dt) {
    if (!Animator.playing || Animator.paused) return { ok: false, reason: 'not-playing' };
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (!entry) return { ok: false, error: 'Chưa chọn clip.' };
    var dtEff = (dt || 0) * Animator.speed;
    var prevTime = Animator.time;
    var fired = [];
    if (entry.source === 'keyframe') {
      var KF = getKeyframe();
      if (!KF || typeof KF.tick !== 'function') return { ok: false, error: 'Keyframe chưa load.' };
      var kr = KF.tick(dtEff);
      Animator.time = (typeof KF.getTime === 'function') ? KF.getTime() : Animator.time;
      if (kr && kr.playing === false && Animator.loopMode !== 'loop') Animator.playing = false;
      if (Animator.time < prevTime && Animator.loopMode === 'loop') {
        fired = fired.concat(fireEventsInRange(prevTime, entry.duration));
        fired = fired.concat(fireEventsInRange(0, Animator.time));
        Animator._firedIds = {};
        (Animator.events[Animator.currentId] || []).forEach(function (ev) { if (ev.t <= Animator.time) Animator._firedIds[ev.id] = true; });
      } else {
        fired = fireEventsInRange(prevTime, Animator.time);
      }
    } else if (entry.source === 'autogen') {
      /* Autogen tự chạy bằng mixer riêng — Animator chỉ đếm thời gian */
      Animator.time += dtEff;
      if (Animator.time >= entry.duration) {
        if (Animator.loopMode === 'loop') {
          fired = fired.concat(fireEventsInRange(prevTime, entry.duration));
          Animator.time = Animator.time % entry.duration;
          Animator._firedIds = {};
          fired = fired.concat(fireEventsInRange(0, Animator.time));
        } else {
          Animator.time = entry.duration;
          Animator.playing = false;
          fired = fireEventsInRange(prevTime, Animator.time);
        }
      } else fired = fireEventsInRange(prevTime, Animator.time);
    } else {
      if (!Animator._mixer) return { ok: false, error: 'Mixer chưa có — bấm Play trước.' };
      var next = Animator.time + dtEff;
      var wrapped = false;
      if (next >= entry.duration) {
        if (Animator.loopMode === 'loop') {
          next = next % entry.duration;
          wrapped = true;
        } else {
          next = entry.duration;
        }
      }
      Animator._addLastKey = null; /* mixer sắp viết lại pose base */
      try { Animator._mixer.update(dtEff); } catch (e) {}
      /* Mixer tự loop action; đồng bộ Animator.time theo action */
      if (Animator._currentAction) {
        try { Animator.time = Animator._currentAction.time % entry.duration; } catch (e) { Animator.time = next; }
        if (Animator.loopMode !== 'loop' && Animator._currentAction.time >= entry.duration) {
          Animator.time = entry.duration;
          Animator.playing = false;
        }
      } else Animator.time = next;
      if (wrapped) {
        fired = fired.concat(fireEventsInRange(prevTime, entry.duration));
        Animator._firedIds = {};
        fired = fired.concat(fireEventsInRange(0, Animator.time));
      } else {
        fired = fireEventsInRange(prevTime, Animator.time);
      }
      applyRootMotion();
      applyAdditive();
    }
    updateTopBones();
    updateReadout();
    return { ok: true, time: round3(Animator.time), playing: Animator.playing, frame: getFrameInfo(), fired: fired };
  }

  /* ============================================================
     3. CROSSFADE / BLEND 2 CLIP
     ============================================================ */
  function crossfadeTo(id, fadeSec) {
    var target = getClip(id);
    if (!target) return { ok: false, error: 'Không tìm thấy clip "' + id + '".' };
    if (target.source !== 'anim' && target.source !== 'preset' && target.source !== 'coco' && target.source !== 'hy3d' && target.source !== 'user') {
      return { ok: false, error: 'Crossfade chỉ dùng cho clip THREE (không dùng cho autogen/keyframe).' };
    }
    var from = Animator.currentId;
    var prevFade = Animator.fadeDuration;
    if (fadeSec !== undefined && fadeSec !== null) Animator.fadeDuration = clamp(parseFloat(fadeSec) || 0, 0, 1);
    /* play() tự crossfade từ action cũ khi fadeDuration > 0 */
    var wasPlaying = Animator.playing;
    var r = play(id);
    if (!r.ok) { Animator.fadeDuration = prevFade; return r; }
    if (!wasPlaying) {
      /* Chưa phát gì trước đó → không có gì để fade, chỉ phát clip mới */
      return { ok: true, from: null, to: id, fade: Animator.fadeDuration, note: 'Chưa có clip đang phát nên phát thẳng clip mới.' };
    }
    return { ok: true, from: from, to: id, fade: Animator.fadeDuration };
  }

  function setFadeDuration(s) {
    Animator.fadeDuration = clamp(parseFloat(s) || 0, 0, 1);
    return { ok: true, fadeDuration: Animator.fadeDuration };
  }

  function syncBlendAction() {
    if (!Animator.blend.clipBId || !Animator._mixer) return { ok: false, reason: 'no-blend' };
    var bEntry = getClip(Animator.blend.clipBId);
    if (!bEntry || !bEntry.clip) return { ok: false, error: 'Clip B không có THREE.AnimationClip.' };
    var action = Animator._actions[bEntry.id];
    if (!action) {
      try { action = Animator._mixer.clipAction(bEntry.clip); } catch (e) { return { ok: false, error: 'clipAction B lỗi: ' + (e && e.message) }; }
      Animator._actions[bEntry.id] = action;
    }
    try {
      action.reset();
      action.setLoop(window.THREE.LoopRepeat);
      action.setEffectiveTimeScale(1);
      action.setEffectiveWeight(Animator.blend.weight);
      action.time = Animator.time % bEntry.duration;
      action.paused = false;
      action.play();
    } catch (e) { return { ok: false, error: 'Phát clip B lỗi: ' + (e && e.message) }; }
    Animator._blendAction = action;
    return { ok: true };
  }

  /* Blend 2 clip theo tỉ lệ: A chạy với trọng số (1-w), B với w. */
  function setBlend(clipBId, weight) {
    var bEntry = getClip(clipBId);
    if (!bEntry) return { ok: false, error: 'Không tìm thấy clip B "' + clipBId + '".' };
    if (!bEntry.clip) return { ok: false, error: 'Clip B không có THREE.AnimationClip (autogen/keyframe không blend được).' };
    var aEntry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (!aEntry || !aEntry.clip) return { ok: false, error: 'Chưa phát clip A (THREE) để blend.' };
    weight = clamp(parseFloat(weight) || 0, 0, 1);
    Animator.blend = { clipBId: clipBId, weight: weight };
    if (!Animator.playing) {
      var pr = play(aEntry.id);
      if (!pr.ok) return pr;
    }
    var sr = syncBlendAction();
    if (!sr.ok) return sr;
    try {
      if (Animator._currentAction) Animator._currentAction.setEffectiveWeight(1 - weight);
      if (Animator._blendAction) Animator._blendAction.setEffectiveWeight(weight);
    } catch (e) {}
    return { ok: true, clipA: aEntry.id, clipB: clipBId, weightA: round3(1 - weight), weightB: round3(weight) };
  }

  function clearBlend() {
    try { if (Animator._blendAction) { Animator._blendAction.setEffectiveWeight(0); Animator._blendAction.stop(); } } catch (e) {}
    try { if (Animator._currentAction) Animator._currentAction.setEffectiveWeight(1); } catch (e) {}
    Animator._blendAction = null;
    Animator.blend = { clipBId: null, weight: 0 };
    return { ok: true };
  }

  /* ============================================================
     4. CHỈNH SỬA CLIP (thuần — trả về THREE.AnimationClip mới)
     ============================================================ */
  function buildClip(name, duration, tracks) {
    if (!window.THREE) return null;
    return new window.THREE.AnimationClip(name, Math.max(duration, 0.001), tracks);
  }
  function cloneTrackOfType(track, times, values) {
    if (isQuatTrack(track)) return new window.THREE.QuaternionKeyframeTrack(track.name, times, values);
    if (isPosTrack(track)) return new window.THREE.VectorKeyframeTrack(track.name, times, values);
    /* track scale / khác: giữ nguyên kiểu Vector (3 giá trị/key) */
    return new window.THREE.VectorKeyframeTrack(track.name, times, values);
  }

  function trimClip(clip, start, end) {
    if (!clip || !clip.tracks) return { ok: false, error: 'Clip không có tracks.' };
    start = parseFloat(start); end = parseFloat(end);
    if (!(start >= 0) || !(end > start) || end > clip.duration + EPS) {
      return { ok: false, error: 'Cắt không hợp lệ: cần 0 ≤ start < end ≤ ' + clip.duration.toFixed(2) + 's.' };
    }
    var tracks = [];
    clip.tracks.forEach(function (tr) {
      var size = isQuatTrack(tr) ? 4 : 3;
      var times = [], values = [];
      function pushSample(t) {
        times.push(round3(t - start));
        if (isQuatTrack(tr)) {
          var q = sampleQuatTrack(tr, t);
          values.push(round4(q.x), round4(q.y), round4(q.z), round4(q.w));
        } else {
          var v = sampleVecTrack(tr, t);
          values.push(round4(v.x), round4(v.y), round4(v.z));
        }
      }
      pushSample(start);
      for (var i = 0; i < tr.times.length; i++) {
        if (tr.times[i] > start + EPS && tr.times[i] < end - EPS) {
          times.push(round3(tr.times[i] - start));
          for (var k = 0; k < size; k++) values.push(tr.values[i * size + k]);
        }
      }
      pushSample(end);
      tracks.push(cloneTrackOfType(tr, times, values));
    });
    var out = buildClip((clip.name || 'clip') + '_trim', end - start, tracks);
    return { ok: true, clip: out, duration: round3(end - start), trackCount: tracks.length };
  }

  function retimeClip(clip, factor) {
    if (!clip || !clip.tracks) return { ok: false, error: 'Clip không có tracks.' };
    factor = parseFloat(factor);
    if (!(factor > 0)) return { ok: false, error: 'Hệ số retime phải > 0.' };
    var tracks = clip.tracks.map(function (tr) {
      var times = [];
      for (var i = 0; i < tr.times.length; i++) times.push(round3(tr.times[i] / factor));
      return cloneTrackOfType(tr, times, Array.prototype.slice.call(tr.values));
    });
    var out = buildClip((clip.name || 'clip') + '_x' + factor, clip.duration / factor, tracks);
    var keyCount = clip.tracks.length ? clip.tracks[0].times.length : 0;
    return { ok: true, clip: out, duration: round3(clip.duration / factor), factor: factor, keyCount: keyCount, note: 'Giữ nguyên số key gốc (' + keyCount + '/track).' };
  }

  function reverseClip(clip) {
    if (!clip || !clip.tracks) return { ok: false, error: 'Clip không có tracks.' };
    var D = clip.duration;
    var tracks = clip.tracks.map(function (tr) {
      var size = isQuatTrack(tr) ? 4 : 3;
      var n = tr.times.length;
      var times = [], values = [];
      for (var i = n - 1; i >= 0; i--) {
        times.push(round3(D - tr.times[i]));
        for (var k = 0; k < size; k++) values.push(tr.values[i * size + k]);
      }
      return cloneTrackOfType(tr, times, values);
    });
    var out = buildClip((clip.name || 'clip') + '_rev', D, tracks);
    return { ok: true, clip: out, duration: round3(D) };
  }

  function mirrorClip(clip) {
    if (!clip || !clip.tracks) return { ok: false, error: 'Clip không có tracks.' };
    function counterpart(bone) {
      if (/^Left/i.test(bone)) return bone.replace(/^Left/i, 'Right');
      if (/^Right/i.test(bone)) return bone.replace(/^Right/i, 'Left');
      return bone;
    }
    /* Gom track theo xương + loại (quaternion/position): 1 xương có
       thể có cả 2 track (vd Hips .position + .quaternion) — key phải
       gồm cả loại, nếu không track thứ 2 của cùng xương bị nuốt mất. */
    var byBone = {};
    clip.tracks.forEach(function (tr) {
      byBone[stripBoneName(tr.name) + '|' + (isQuatTrack(tr) ? 'q' : 'v')] = tr;
    });
    var done = {};
    var tracks = [];
    clip.tracks.forEach(function (tr) {
      var bone = stripBoneName(tr.name);
      var kind = isQuatTrack(tr) ? 'q' : 'v';
      var key = bone + '|' + kind;
      if (done[key]) return;
      var twin = counterpart(bone);
      var twinKey = twin + '|' + kind;
      var src = byBone[twinKey] || tr;
      done[key] = true;
      done[twinKey] = true;
      var values = [];
      var n = src.times.length;
      for (var i = 0; i < n; i++) {
        if (isQuatTrack(src)) {
          /* Mirror qua mặt phẳng dọc YZ: lật dấu x,z của quaternion */
          values.push(-src.values[i * 4], src.values[i * 4 + 1], -src.values[i * 4 + 2], src.values[i * 4 + 3]);
        } else {
          /* Vị trí: lật dấu x */
          values.push(-src.values[i * 3], src.values[i * 3 + 1], src.values[i * 3 + 2]);
        }
      }
      tracks.push(cloneTrackOfType(tr, Array.prototype.slice.call(src.times), values));
      /* Nếu cặp L/R có 2 track khác tên gốc, track twin giữ nguyên tên
         của nó nhưng lấy giá trị từ track này (đã lật dấu). */
      if (twin !== bone && byBone[twinKey]) {
        var twinTr = byBone[twinKey];
        var values2 = [];
        for (var j = 0; j < tr.times.length; j++) {
          if (isQuatTrack(tr)) values2.push(-tr.values[j * 4], tr.values[j * 4 + 1], -tr.values[j * 4 + 2], tr.values[j * 4 + 3]);
          else values2.push(-tr.values[j * 3], tr.values[j * 3 + 1], tr.values[j * 3 + 2]);
        }
        tracks.push(cloneTrackOfType(twinTr, Array.prototype.slice.call(tr.times), values2));
      }
    });
    var out = buildClip((clip.name || 'clip') + '_mirror', clip.duration, tracks);
    return { ok: true, clip: out, duration: round3(clip.duration), trackCount: tracks.length, note: 'Mirror gần đúng: đổi cặp Left/Right + lật dấu quay x,z / vị trí x.' };
  }

  /* Áp 1 phép chỉnh sửa lên clip đang chọn, lưu thành clip MỚI. */
  function editCurrentClip(op, opts) {
    opts = opts || {};
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (!entry) return { ok: false, error: 'Chưa chọn clip.' };
    if (!entry.clip) return { ok: false, error: 'Clip "' + entry.name + '" không có THREE.AnimationClip — autogen/keyframe không chỉnh sửa được ở đây.' };
    var r;
    if (op === 'trim') r = trimClip(entry.clip, opts.start, opts.end);
    else if (op === 'retime') r = retimeClip(entry.clip, opts.factor);
    else if (op === 'reverse') r = reverseClip(entry.clip);
    else if (op === 'mirror') r = mirrorClip(entry.clip);
    else return { ok: false, error: 'Phép chỉnh sửa không biết: ' + op };
    if (!r.ok) return r;
    var name = (opts.name || (entry.name + '_' + op)).trim();
    var saved = registerClip({ name: name, clip: r.clip, loop: entry.loop, source: 'user', userCreated: true });
    if (!saved.ok) return saved;
    return { ok: true, id: saved.id, name: name, duration: saved.duration, op: op, note: r.note || '' };
  }

  function deleteClip(id) {
    var idx = -1;
    Animator._userClips.forEach(function (c, i) { if (c.id === id) idx = i; });
    if (idx < 0) return { ok: false, error: 'Chỉ xóa được clip do user tạo — clip gốc/autogen/keyframe không xóa được.' };
    var name = Animator._userClips[idx].name;
    if (Animator.currentId === id) stop();
    if (Animator._actions[id]) { try { Animator._actions[id].stop(); } catch (e) {} delete Animator._actions[id]; }
    Animator._userClips.splice(idx, 1);
    refreshClips();
    return { ok: true, id: id, name: name };
  }

  function setRootMotion(on) {
    Animator.rootMotion = !!on;
    applyRootMotion();
    return { ok: true, rootMotion: Animator.rootMotion };
  }

  /* ============================================================
     7. EVENT MARKERS
     ============================================================ */
  function addEvent(name, t, clipId) {
    clipId = clipId || Animator.currentId;
    if (!clipId) return { ok: false, error: 'Chưa chọn clip.' };
    name = String(name || '').trim();
    if (!name) return { ok: false, error: 'Nhập tên event (vd "bước chân").' };
    var entry = getClip(clipId);
    if (!entry) return { ok: false, error: 'Không tìm thấy clip.' };
    if (t === undefined || t === null) t = Animator.time;
    t = clamp(parseFloat(t) || 0, 0, entry.duration);
    if (!Animator.events[clipId]) Animator.events[clipId] = [];
    var ev = { id: 'ev_' + (++Animator._evSeq), t: round3(t), name: name };
    Animator.events[clipId].push(ev);
    Animator.events[clipId].sort(function (a, b) { return a.t - b.t; });
    return { ok: true, event: ev, clipId: clipId };
  }
  function deleteEvent(clipId, eventId) {
    var list = Animator.events[clipId] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === eventId) {
        list.splice(i, 1);
        delete Animator._firedIds[eventId];
        return { ok: true, id: eventId };
      }
    }
    return { ok: false, error: 'Không tìm thấy event.' };
  }
  function listEvents(clipId) {
    return (Animator.events[clipId || Animator.currentId] || []).slice();
  }
  function clearFiredLog() {
    Animator.firedLog = [];
    Animator._firedIds = {};
    return { ok: true };
  }

  /* ============================================================
     8. XUẤT CLIP
     ============================================================ */
  function validateTracksPlain(tracks) {
    var bad = [];
    (tracks || []).forEach(function (t) {
      var size = /\.quaternion$/.test(t.name) ? 4 : 3;
      var need = (t.times || []).length * size;
      if ((t.values || []).length !== need) bad.push(t.name + ' values=' + (t.values || []).length + ' cần=' + need);
      else (t.values || []).forEach(function (v) { if (!isFinite(v)) { bad.push(t.name + ' có giá trị NaN/Inf'); return; } });
    });
    return bad;
  }

  function exportClipJSON(id, opts) {
    opts = opts || {};
    var entry = getClip(id || Animator.currentId);
    if (!entry) return { ok: false, error: 'Chưa chọn clip.' };
    /* Clip keyframe: dùng exporter có sẵn của Keyframe (đúng format) */
    if (entry.source === 'keyframe') {
      var KF = getKeyframe();
      if (!KF || typeof KF.exportClip !== 'function') return { ok: false, error: 'Keyframe chưa load.' };
      var kr = KF.exportClip({ download: false });
      if (kr && kr.ok && opts.download !== false && U && typeof U.downloadText === 'function') {
        try { U.downloadText(kr.text, kr.filename, 'application/json'); } catch (e) {}
      }
      return kr || { ok: false, error: 'Keyframe.exportClip không trả kết quả.' };
    }
    if (!entry.clip) return { ok: false, error: 'Clip "' + entry.name + '" không có THREE.AnimationClip để xuất.' };
    var tracks = entry.clip.tracks.map(function (tr) {
      return { name: tr.name, times: Array.prototype.slice.call(tr.times), values: Array.prototype.slice.call(tr.values) };
    });
    var bad = validateTracksPlain(tracks);
    var Anim = getAnim();
    if (Anim && typeof Anim.validateClip === 'function') {
      var bad2 = Anim.validateClip(entry.clip);
      if (bad2.length) bad = bad.concat(bad2);
    }
    if (bad.length) return { ok: false, error: 'Clip lỗi track, không xuất: ' + bad[0] };
    var data = {
      format: FORMAT, character: 'animator',
      skeleton: { boneNames: Object.keys(getBoneMap()), boneCount: Object.keys(getBoneMap()).length },
      clips: [{
        id: slug(entry.name), name: entry.name, duration: entry.duration,
        loop: !!entry.loop, source: 'animator-' + entry.source, fps: entry.fps || DEFAULT_FPS,
        tracks: tracks
      }]
    };
    var text = JSON.stringify(data, null, 1);
    var filename = 'animator_' + slug(entry.name) + '_clips.json';
    if (opts.download !== false && U && typeof U.downloadText === 'function') {
      try { U.downloadText(text, filename, 'application/json'); } catch (e) {}
    }
    return { ok: true, json: data, text: text, filename: filename, format: FORMAT, trackCount: tracks.length, keyCount: tracks.length ? tracks[0].times.length : 0 };
  }

  function exportClipFBX(id, opts) {
    opts = opts || {};
    var entry = getClip(id || Animator.currentId);
    if (!entry) return { ok: false, error: 'Chưa chọn clip.' };
    if (!entry.clip) return { ok: false, error: 'Clip "' + entry.name + '" không có THREE.AnimationClip — autogen/keyframe không xuất FBX được.' };
    var FB = PS.FBXBinary;
    if (!FB || typeof FB.write !== 'function') {
      return { ok: false, error: 'FBXBinary.write chưa load — không xuất FBX được.', limit: 'writer-missing' };
    }
    var target = getTarget();
    if (!target) return { ok: false, error: 'Chưa có model — không có skeleton/mesh để xuất FBX.' };
    var res;
    try {
      res = FB.write(target, { animations: [{ name: entry.name, clip: entry.clip }], version: 7300 });
    } catch (e) {
      return { ok: false, error: 'FBXBinary.write lỗi: ' + (e && e.message || e), limit: 'writer-error' };
    }
    var bytes = res && res.bytes;
    if (!bytes || !bytes.length) {
      return { ok: false, error: 'FBXBinary.write không trả bytes.', limit: 'writer-no-bytes', report: res };
    }
    var filename = 'animator_' + slug(entry.name) + '.fbx';
    if (opts.download !== false && U && typeof U.downloadBlob === 'function') {
      try { U.downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), filename); } catch (e) {}
    }
    return { ok: true, bytes: bytes.length, filename: filename, format: 'fbx', version: 7300, report: res, note: 'Writer tự viết của studio — kiểm chứng lại bằng FBXLoader/fbx2gltf trước khi dùng.' };
  }

  /* ============================================================
     9. HIỂN THỊ VIEWPORT
     ============================================================ */
  function drawRootPath() {
    var line = Animator._rootPathLine;
    if (!Animator.display.rootPath || !Animator.rootPath.length) {
      if (line && line.parent) { try { line.parent.remove(line); } catch (e) {} }
      Animator._rootPathLine = null;
      return { ok: true, shown: false };
    }
    if (!window.THREE) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var scene = getScene();
    if (!scene) return { ok: false, error: 'Không tìm thấy scene viewport.' };
    try {
      var pts = Animator.rootPath.map(function (p) { return new window.THREE.Vector3(p.x, p.y, p.z); });
      var geo = new window.THREE.BufferGeometry().setFromPoints(pts);
      if (!line) {
        line = new window.THREE.Line(geo, new window.THREE.LineBasicMaterial({ color: 0x00e5ff }));
        line.name = '__arp_anim_rootpath__';
        line.userData.isBoneVisual = true;
        Animator._rootPathLine = line;
      } else {
        line.geometry.dispose();
        line.geometry = geo;
      }
      if (!line.parent) scene.add(line);
      return { ok: true, shown: true, points: pts.length };
    } catch (e) {
      return { ok: false, error: 'Vẽ đường root lỗi: ' + (e && e.message) };
    }
  }

  /* FIX (ARP View vòng 1): setDisplay đi qua registry ArpViewport
   * (showLayer/hideLayer) khi có — registry lưu localStorage + phát
   * 'arp-viewport:layer-changed' nên toolbar/preset đồng bộ trạng
   * thái; trước đây gọi trực tiếp Sk.show/hide nên toolbar lệch.
   * Trả true khi registry áp được, false khi layer chưa đăng ký
   * (caller rơi về gọi trực tiếp), null khi registry chưa có. */
  function applyViaRegistry(key, on) {
    var AV = PS.ArpViewport;
    if (!AV || typeof AV.showLayer !== 'function' || typeof AV.hideLayer !== 'function') return null;
    try { return on ? !!AV.showLayer(key) : !!AV.hideLayer(key); } catch (e) { return null; }
  }

  function setDisplay(key, on) {
    var valid = ['skeleton', 'ik', 'trails', 'onion', 'readout', 'boneAngles', 'rootPath'];
    if (valid.indexOf(key) < 0) return { ok: false, error: 'Lớp hiển thị không biết: ' + key };
    Animator.display[key] = !!on;
    var applied = [], missing = [];
    var target = getTarget();
    try {
      if (key === 'skeleton') {
        var Sk = PS.ArpVpSkeleton;
        if (Sk && typeof Sk.show === 'function' && typeof Sk.hide === 'function') {
          if (applyViaRegistry('skeleton', on) !== true) { if (on) Sk.show(target); else Sk.hide(); }
          applied.push('skeleton');
        } else missing.push('ArpVpSkeleton chưa load');
      } else if (key === 'ik') {
        var Ik = PS.ArpVpIk;
        if (Ik && typeof Ik.show === 'function' && typeof Ik.hide === 'function') {
          if (applyViaRegistry('ik', on) !== true) { if (on) Ik.show(); else Ik.hide(); }
          applied.push('ik');
        } else missing.push('ArpVpIk chưa load');
      } else if (key === 'trails') {
        var Tr = PS.ArpVpTrails;
        if (Tr && typeof Tr.setTrailsEnabled === 'function') {
          if (applyViaRegistry('trails', on) !== true) Tr.setTrailsEnabled(!!on);
          applied.push('trails');
        }
        else if (Tr && typeof Tr.showTrails === 'function') { if (on) Tr.showTrails(); else Tr.hideTrails(); applied.push('trails'); }
        else missing.push('ArpVpTrails chưa load');
      } else if (key === 'onion') {
        var Tr2 = PS.ArpVpTrails;
        if (Tr2 && typeof Tr2.setOnionEnabled === 'function') {
          if (applyViaRegistry('onion', on) !== true) Tr2.setOnionEnabled(!!on);
          applied.push('onion');
        }
        else if (Tr2 && typeof Tr2.showOnion === 'function') { if (on) Tr2.showOnion(); else Tr2.hideOnion(); applied.push('onion'); }
        else missing.push('ArpVpTrails chưa load');
        /* Onion cho clip keyframe: ghost của Keyframe */
        var KF = getKeyframe();
        if (KF && typeof KF.renderGhost === 'function' && on && Animator.currentId) {
          try { KF.renderGhost(); applied.push('onion-keyframe'); } catch (e) {}
        }
      } else if (key === 'rootPath') {
        var dr = drawRootPath();
        if (dr.ok && dr.shown) applied.push('rootPath'); else if (dr.ok) applied.push('rootPath-off');
        else missing.push(dr.error || 'không vẽ được đường root');
      } else if (key === 'readout') {
        updateReadout();
        applied.push('readout');
      } else if (key === 'boneAngles') {
        updateTopBones();
        applied.push('boneAngles');
      }
    } catch (e) {
      missing.push(key + ' lỗi: ' + (e && e.message));
    }
    return { ok: missing.length === 0, applied: applied, missing: missing, display: Animator.display };
  }

  function applyDisplayOnPlay() {
    var out = {};
    ['skeleton', 'ik', 'trails', 'onion', 'rootPath'].forEach(function (k) {
      if (Animator.display[k]) out[k] = setDisplay(k, true);
    });
    updateReadout();
    return out;
  }

  function updateReadout() {
    var info = getFrameInfo();
    var top = Animator.topBones.map(function (b) { return b.bone + ' ' + b.deg.toFixed(1) + '°'; }).join(' · ');
    var text = info.text + (Animator.display.boneAngles && top ? ' · ' + top : '');
    if (typeof document !== 'undefined') {
      try {
        var wrap = document.getElementById('viewport-canvas-wrap') || document.getElementById('viewport-wrap');
        var ov = document.getElementById('arp-anim-readout');
        if (Animator.display.readout) {
          if (!ov && wrap) {
            ov = document.createElement('div');
            ov.id = 'arp-anim-readout';
            ov.className = 'arp-anim-readout';
            wrap.appendChild(ov);
          }
          if (ov) ov.textContent = (Animator.currentId ? '▶ ' : '') + text;
        } else if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        var panelSpan = document.getElementById('arp-anim-readout-line');
        if (panelSpan) panelSpan.textContent = text;
        var rootSpan = document.getElementById('arp-anim-rootpos');
        if (rootSpan) rootSpan.textContent = 'Root: (' + Animator.rootPos.x.toFixed(3) + ', ' + Animator.rootPos.y.toFixed(3) + ', ' + Animator.rootPos.z.toFixed(3) + ')';
      } catch (e) {}
    }
    return text;
  }

  /* ============================================================
     UI — TAB ANIMATOR
     ============================================================ */
  function render(container) {
    if (!container) return;
    Animator._bodyEl = container;
    subscribeClipChanged();
    container.innerHTML = '';
    var msg = el('div', { class: 'arp-anim-msg', id: 'arp-anim-msg' });
    function say(text, ok) {
      msg.textContent = text;
      msg.style.color = ok === false ? '#ff7b7b' : '';
    }

    /* --- 1. Danh sách clip + tìm kiếm --- */
    var search = el('input', { type: 'text', class: 'arp-input arp-anim-search', placeholder: 'Tìm clip theo tên…' });
    var listBox = el('div', { class: 'arp-anim-list' });
    function renderList() {
      listBox.innerHTML = '';
      var clips = listClips(search.value);
      if (!clips.length) {
        listBox.appendChild(el('div', { class: 'arp-note', text: 'Chưa có clip nào — load model có animation, ghi keyframe, hoặc áp preset trong Animation panel.' }));
        return;
      }
      clips.forEach(function (c) {
        var row = el('div', { class: 'arp-anim-clip' + (Animator.currentId === c.id ? ' active' : '') });
        row.appendChild(el('div', { class: 'arp-anim-clip-info' }, [
          el('b', { text: c.name }),
          el('span', { text: c.duration.toFixed(2) + 's · ' + (c.fps || 30) + 'fps · ' + (c.loop ? 'loop' : 'once') + ' · ' + c.source + (c.userCreated ? ' · user' : '') })
        ]));
        var playBtn = el('button', { class: 'arp-btn arp-btn-sm', text: Animator.currentId === c.id && Animator.playing ? '⏸' : '▶' });
        playBtn.addEventListener('click', function () {
          if (Animator.currentId === c.id && Animator.playing) { pause(); }
          else { var r = play(c.id); say(r.ok ? ('Đang phát "' + c.name + '"' + (r.note ? ' — ' + r.note : '')) : ('Lỗi: ' + r.error), r.ok); }
          render(container);
        });
        row.appendChild(playBtn);
        listBox.appendChild(row);
      });
    }
    search.addEventListener('input', renderList);
    container.appendChild(el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '1 · Clips' }), search, listBox
    ]));

    /* --- 2. Điều khiển phát --- */
    var timeLabel = el('div', { class: 'arp-anim-readout', id: 'arp-anim-readout-line', text: getFrameInfo().text });
    var scrub = el('input', { type: 'range', class: 'arp-anim-scrub', min: '0', max: '100', step: '0.1', value: '0' });
    scrub.addEventListener('input', function () {
      var entry = Animator.currentId ? getClip(Animator.currentId) : null;
      if (!entry) return;
      var r = setTime(entry.duration * parseFloat(scrub.value) / 100);
      if (!r.ok) say('Lỗi: ' + r.error, false);
      timeLabel.textContent = getFrameInfo().text;
    });
    var speedSlider = el('input', { type: 'range', min: '0.25', max: '2', step: '0.05', value: String(Animator.speed), style: { flex: '1' } });
    var speedVal = el('span', { text: Animator.speed.toFixed(2) + 'x' });
    speedSlider.addEventListener('input', function () {
      setSpeed(parseFloat(speedSlider.value));
      speedVal.textContent = Animator.speed.toFixed(2) + 'x';
    });
    var speedPresets = el('div', { class: 'arp-row' });
    [0.25, 0.5, 1, 1.5, 2].forEach(function (s) {
      var b = el('button', { class: 'arp-btn arp-btn-sm', text: s + 'x' });
      b.addEventListener('click', function () { setSpeed(s); speedSlider.value = String(s); speedVal.textContent = s.toFixed(2) + 'x'; });
      speedPresets.appendChild(b);
    });
    var loopBtn = el('button', { class: 'arp-btn arp-btn-sm' + (Animator.loopMode === 'loop' ? ' arp-btn-primary' : ''), text: '🔁 Loop' });
    var onceBtn = el('button', { class: 'arp-btn arp-btn-sm' + (Animator.loopMode === 'once' ? ' arp-btn-primary' : ''), text: '⏹ Once' });
    loopBtn.addEventListener('click', function () { setLoopMode('loop'); render(container); });
    onceBtn.addEventListener('click', function () { setLoopMode('once'); render(container); });
    function transportBtn(label, fn) {
      var b = el('button', { class: 'arp-btn', text: label });
      b.addEventListener('click', function () {
        var r = fn();
        if (r && r.ok === false) say('Lỗi: ' + (r.error || r.reason || ''), false);
        timeLabel.textContent = getFrameInfo().text;
        renderList();
      });
      return b;
    }
    container.appendChild(el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '2 · Phát' }),
      el('div', { class: 'arp-row' }, [
        transportBtn('▶ Play', function () { return play(); }),
        transportBtn('⏸ Pause', function () { return pause(); }),
        transportBtn('⏹ Stop', function () { return stop(); }),
        transportBtn('⏮ −1f', function () { return stepFrame(-1); }),
        transportBtn('+1f ⏭', function () { return stepFrame(1); })
      ]),
      scrub, timeLabel,
      el('div', { class: 'arp-row' }, [el('span', { text: 'Tốc độ' }), speedSlider, speedVal]),
      speedPresets,
      el('div', { class: 'arp-row' }, [loopBtn, onceBtn])
    ]));

    /* --- 3. Crossfade / Blend --- */
    var fadeSlider = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(Animator.fadeDuration), style: { flex: '1' } });
    var fadeVal = el('span', { text: Animator.fadeDuration.toFixed(2) + 's' });
    fadeSlider.addEventListener('input', function () { setFadeDuration(parseFloat(fadeSlider.value)); fadeVal.textContent = Animator.fadeDuration.toFixed(2) + 's'; });
    var xfSelect = el('select', { class: 'arp-select' });
    var blendSelect = el('select', { class: 'arp-select' });
    listClips().forEach(function (c) {
      xfSelect.appendChild(el('option', { value: c.id, text: c.name }));
      blendSelect.appendChild(el('option', { value: c.id, text: c.name }));
    });
    var blendSlider = el('input', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(Animator.blend.weight * 100)), style: { flex: '1' } });
    var blendVal = el('span', { text: Math.round(Animator.blend.weight * 100) + '%' });
    blendSlider.addEventListener('input', function () {
      blendVal.textContent = blendSlider.value + '%';
      if (Animator.blend.clipBId) { var r = setBlend(Animator.blend.clipBId, parseInt(blendSlider.value, 10) / 100); if (!r.ok) say('Lỗi blend: ' + r.error, false); }
    });
    var xfBtn = el('button', { class: 'arp-btn', text: 'Crossfade →' });
    xfBtn.addEventListener('click', function () {
      var r = crossfadeTo(xfSelect.value);
      say(r.ok ? ('Crossfade → "' + (getClip(xfSelect.value) || {}).name + '" (' + r.fade.toFixed(2) + 's)') : ('Lỗi: ' + r.error), r.ok);
      render(container);
    });
    var blendBtn = el('button', { class: 'arp-btn', text: 'Blend' });
    blendBtn.addEventListener('click', function () {
      var r = setBlend(blendSelect.value, parseInt(blendSlider.value, 10) / 100);
      say(r.ok ? ('Blend A↔B: ' + Math.round(r.weightA * 100) + '% / ' + Math.round(r.weightB * 100) + '%') : ('Lỗi: ' + r.error), r.ok);
    });
    var blendClear = el('button', { class: 'arp-btn', text: 'Xóa blend' });
    blendClear.addEventListener('click', function () { clearBlend(); say('Đã xóa blend — clip A về 100%.'); });
    container.appendChild(el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '3 · Crossfade / Blend' }),
      el('div', { class: 'arp-row' }, [el('span', { text: 'Fade' }), fadeSlider, fadeVal]),
      el('div', { class: 'arp-row' }, [xfSelect, xfBtn]),
      el('div', { class: 'arp-row' }, [blendSelect, blendBtn, blendClear]),
      el('div', { class: 'arp-row' }, [el('span', { text: 'Tỉ lệ B' }), blendSlider, blendVal])
    ]));

    /* --- 4. Chỉnh sửa clip --- */
    var trimStart = el('input', { type: 'number', class: 'arp-input', min: '0', step: '0.05', value: '0', style: { width: '70px' } });
    var trimEnd = el('input', { type: 'number', class: 'arp-input', min: '0', step: '0.05', value: '1', style: { width: '70px' } });
    var editName = el('input', { type: 'text', class: 'arp-input', placeholder: 'Tên clip mới (để trống = tự đặt)' });
    function editBtn(label, op, optsFn) {
      var b = el('button', { class: 'arp-btn', text: label });
      b.addEventListener('click', function () {
        var r = editCurrentClip(op, Object.assign({ name: editName.value || undefined }, optsFn ? optsFn() : {}));
        say(r.ok ? ('Đã lưu clip mới "' + r.name + '" (' + r.duration.toFixed(2) + 's)' + (r.note ? ' — ' + r.note : '')) : ('Lỗi: ' + r.error), r.ok);
        render(container);
      });
      return b;
    }
    var delBtn = el('button', { class: 'arp-btn', text: '🗑 Xóa clip user đang chọn' });
    delBtn.addEventListener('click', function () {
      if (!Animator.currentId) { say('Chưa chọn clip.', false); return; }
      var r = deleteClip(Animator.currentId);
      say(r.ok ? ('Đã xóa "' + r.name + '".') : ('Lỗi: ' + r.error), r.ok);
      render(container);
    });
    container.appendChild(el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '4 · Chỉnh sửa clip (lưu thành clip mới)' }),
      el('div', { class: 'arp-row' }, [el('span', { text: 'Cắt từ' }), trimStart, el('span', { text: 'đến' }), trimEnd, el('span', { text: 'giây' })]),
      editName,
      el('div', { class: 'arp-row' }, [
        editBtn('✂ Cắt clip', 'trim', function () { return { start: parseFloat(trimStart.value), end: parseFloat(trimEnd.value) }; }),
        editBtn('⏩ Retiming 0.5x', 'retime', function () { return { factor: 0.5 }; }),
        editBtn('⏩ Retiming 2x', 'retime', function () { return { factor: 2 }; })
      ]),
      el('div', { class: 'arp-row' }, [
        editBtn('↩ Đảo ngược', 'reverse'),
        editBtn('🪞 Mirror L↔R', 'mirror'),
        delBtn
      ]),
      el('div', { class: 'arp-note', text: 'Retiming giữ nguyên số key gốc. Mirror là gần đúng (đổi cặp Left/Right + lật dấu).' })
    ]));

    /* --- 5. Root motion --- */
    var rmChk = el('input', { type: 'checkbox' });
    rmChk.checked = Animator.rootMotion;
    rmChk.addEventListener('change', function () {
      setRootMotion(rmChk.checked);
      say(rmChk.checked ? 'Root motion BẬT — Hips.position từ clip áp bình thường.' : 'Root motion TẮT — Hips khóa ở vị trí bind.');
    });
    var rootPosSpan = el('span', { id: 'arp-anim-rootpos', text: 'Root: (0, 0, 0)' });
    container.appendChild(el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '5 · Root motion' }),
      el('div', { class: 'arp-row' }, [rmChk, el('span', { text: 'Áp Hips.position của clip vào model' })]),
      el('div', { class: 'arp-row' }, [rootPosSpan]),
      el('div', { class: 'arp-note', text: 'Đường root motion: bật "Đường root" ở mục 9 để vẽ quỹ đạo Hips trong viewport.' })
    ]));

    /* --- 6. Layers --- */
    var addSelect = el('select', { class: 'arp-select' });
    listClips().forEach(function (c) { addSelect.appendChild(el('option', { value: c.id, text: c.name })); });
    if (Animator.additive.clipId) addSelect.value = Animator.additive.clipId;
    var addSlider = el('input', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(Animator.additive.weight * 100)), style: { flex: '1' } });
    var addVal = el('span', { text: Math.round(Animator.additive.weight * 100) + '%' });
    addSlider.addEventListener('input', function () {
      Animator.additive.weight = parseInt(addSlider.value, 10) / 100;
      addVal.textContent = addSlider.value + '%';
    });
    var addChk = el('input', { type: 'checkbox' });
    addChk.checked = Animator.additive.enabled;
    addChk.addEventListener('change', function () {
      Animator.additive.clipId = addSelect.value;
      Animator.additive.enabled = addChk.checked;
      say(addChk.checked ? 'Lớp Additive BẬT — cộng rotation từ "' + (getClip(addSelect.value) || {}).name + '" (' + Math.round(Animator.additive.weight * 100) + '%).' : 'Lớp Additive TẮT.');
    });
    container.appendChild(el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '6 · Layers (Base + Additive)' }),
      el('div', { class: 'arp-row' }, [el('span', { text: 'Base: ' }), el('b', { text: (Animator.currentId && getClip(Animator.currentId) ? getClip(Animator.currentId).name : '—') })]),
      el('div', { class: 'arp-row' }, [addChk, el('span', { text: 'Additive:' }), addSelect]),
      el('div', { class: 'arp-row' }, [el('span', { text: 'Độ mạnh' }), addSlider, addVal]),
      el('div', { class: 'arp-note', text: 'Additive chỉ cộng rotation (không cộng position root). Không áp được khi clip Base là keyframe.' })
    ]));

    /* --- 7. Event markers --- */
    var evName = el('input', { type: 'text', class: 'arp-input', placeholder: 'Tên event, vd "bước chân", "đánh"' });
    var evList = el('div', { class: 'arp-anim-evlist' });
    var firedList = el('div', { class: 'arp-anim-evlist' });
    function renderEvents() {
      evList.innerHTML = '';
      var evs = listEvents();
      if (!evs.length) evList.appendChild(el('div', { class: 'arp-note', text: 'Chưa có event cho clip này.' }));
      evs.forEach(function (ev) {
        var row = el('div', { class: 'arp-row' }, [
          el('span', { text: '● ' + ev.t.toFixed(2) + 's — ' + ev.name }),
          el('button', { class: 'arp-btn arp-btn-sm', text: '✕', onclick: function () { deleteEvent(Animator.currentId, ev.id); renderEvents(); } })
        ]);
        evList.appendChild(row);
      });
      firedList.innerHTML = '';
      if (!Animator.firedLog.length) firedList.appendChild(el('div', { class: 'arp-note', text: 'Chưa event nào kích hoạt trong lần phát này.' }));
      Animator.firedLog.forEach(function (f) {
        firedList.appendChild(el('div', { text: '✓ "' + f.name + '" @ ' + f.t.toFixed(2) + 's (phát tới ' + f.at.toFixed(2) + 's)' }));
      });
    }
    var evAddBtn = el('button', { class: 'arp-btn', text: '+ Thêm event tại thời điểm hiện tại' });
    evAddBtn.addEventListener('click', function () {
      var r = addEvent(evName.value, Animator.time);
      say(r.ok ? ('Đã thêm event "' + r.event.name + '" @ ' + r.event.t.toFixed(2) + 's.') : ('Lỗi: ' + r.error), r.ok);
      if (r.ok) evName.value = '';
      renderEvents();
    });
    var evClearBtn = el('button', { class: 'arp-btn', text: 'Xóa log đã kích hoạt' });
    evClearBtn.addEventListener('click', function () { clearFiredLog(); renderEvents(); });
    container.appendChild(el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '7 · Event markers' }),
      el('div', { class: 'arp-row' }, [evName, evAddBtn]),
      evList,
      el('div', { class: 'arp-sec-title', text: 'Đã kích hoạt trong lần phát này' }),
      firedList, evClearBtn
    ]));
    renderEvents();

    /* --- 8. Xuất clip --- */
    var expJsonBtn = el('button', { class: 'arp-btn', text: '⬇ Xuất JSON' });
    expJsonBtn.addEventListener('click', function () {
      var r = exportClipJSON();
      say(r.ok ? ('Đã xuất JSON: ' + r.filename + ' (' + r.trackCount + ' tracks).') : ('Lỗi: ' + r.error), r.ok);
    });
    var expFbxBtn = el('button', { class: 'arp-btn', text: '⬇ Xuất FBX (kèm skeleton)' });
    expFbxBtn.addEventListener('click', function () {
      var r = exportClipFBX();
      say(r.ok ? ('Đã xuất FBX: ' + r.filename + ' (' + r.bytes + ' B). ' + (r.note || '')) : ('Lỗi: ' + r.error), r.ok);
    });
    container.appendChild(el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '8 · Xuất clip đang chọn' }),
      el('div', { class: 'arp-row' }, [expJsonBtn, expFbxBtn]),
      el('div', { class: 'arp-note', text: 'JSON đúng format clip studio (tracks .quaternion/.position). FBX qua FBXBinary.write, version 7300.' })
    ]));

    /* --- 9. Hiển thị viewport --- */
    var dispBox = el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '9 · Hiển thị trên viewport' })
    ]);
    [
      ['skeleton', 'Skeleton (xương)'],
      ['ik', 'IK overlay'],
      ['trails', 'Motion trails (vệt tay/chân)'],
      ['onion', 'Onion skinning (bóng pose trước/sau)'],
      ['readout', 'Frame readout (frame + thời gian)'],
      ['boneAngles', 'Góc xương đang chuyển động (top 3)'],
      ['rootPath', 'Đường root motion']
    ].forEach(function (pair) {
      var chk = el('input', { type: 'checkbox' });
      chk.checked = !!Animator.display[pair[0]];
      chk.addEventListener('change', function () {
        var r = setDisplay(pair[0], chk.checked);
        say(r.ok ? ('Đã ' + (chk.checked ? 'bật' : 'tắt') + ' "' + pair[1] + '".') : ('"' + pair[1] + '": ' + (r.missing || []).join('; ')), r.ok);
      });
      dispBox.appendChild(el('div', { class: 'arp-row' }, [chk, el('span', { text: pair[1] })]));
    });
    container.appendChild(dispBox);

    container.appendChild(msg);
    renderList();
    updateReadout();
  }

  /* ---------- public API ---------- */
  Animator.listClips = listClips;
  Animator.getClip = getClip;
  Animator.refreshClips = refreshClips;
  Animator.registerClip = registerClip;
  Animator.deleteClip = deleteClip;
  Animator.play = play;
  Animator.pause = pause;
  Animator.resume = resume;
  Animator.stop = stop;
  Animator.tick = tick;
  Animator.setTime = setTime;
  Animator.stepFrame = stepFrame;
  Animator.setSpeed = setSpeed;
  Animator.setLoopMode = setLoopMode;
  Animator.getFrameInfo = getFrameInfo;
  Animator.crossfadeTo = crossfadeTo;
  Animator.setFadeDuration = setFadeDuration;
  Animator.setBlend = setBlend;
  Animator.clearBlend = clearBlend;
  Animator.trimClip = trimClip;
  Animator.retimeClip = retimeClip;
  Animator.reverseClip = reverseClip;
  Animator.mirrorClip = mirrorClip;
  Animator.editCurrentClip = editCurrentClip;
  Animator.setRootMotion = setRootMotion;
  Animator.rootPathFor = rootPathFor;
  Animator.rootPosAt = rootPosAt;
  Animator.addEvent = addEvent;
  Animator.deleteEvent = deleteEvent;
  Animator.listEvents = listEvents;
  Animator.clearFiredLog = clearFiredLog;
  Animator.exportClipJSON = exportClipJSON;
  Animator.exportClipFBX = exportClipFBX;
  Animator.setDisplay = setDisplay;
  Animator.applyDisplayOnPlay = applyDisplayOnPlay;
  Animator.updateTopBones = updateTopBones;
  Animator.sampleClipPose = sampleClipPose;
  Animator.render = render;
  Animator.setTarget = function (root) {
    Animator._target = root || null;
    Animator._mixer = null;
    Animator._actions = {};
    Animator._currentAction = null;
    Animator._blendAction = null;
    return { ok: true, hasTarget: !!Animator._target };
  };
  Animator._test = {
    stripBoneName: stripBoneName,
    sampleQuatTrack: sampleQuatTrack,
    sampleVecTrack: sampleVecTrack,
    validateTracksPlain: validateTracksPlain,
    findHipsTrack: findHipsTrack,
    applyAdditive: applyAdditive,
    applyRootMotion: applyRootMotion,
    drawRootPath: drawRootPath,
    getBoneMap: getBoneMap,
    findHipsBone: findHipsBone
  };

  PS.ArpAnimator = Animator;

  /* Đăng ký tab Animator (sau 'plugins' — panel liệt kê tab ngoài
     TAB_ORDER theo thứ tự đăng ký). Không sửa arp-panel.js. */
  try {
    var Panel = PS.ArpPanel;
    if (Panel && typeof Panel.registerTab === 'function') {
      Panel.registerTab('animator', 'Animator', render);
    }
  } catch (e) {}
})();
