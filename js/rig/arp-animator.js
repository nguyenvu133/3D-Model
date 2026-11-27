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
 * PHÁT LẠI: Animator.tick(dt) đồng bộ — vòng lặp chính của studio
 * (App.startLoop trong js/core/app.js) gọi tick(dt, frameId) ĐÚNG 1 LẦN
 * mỗi frame, ngay sau PixiStudio.Anim.update(dt), trước render;
 * harness gọi trực tiếp tick(dt) (không kèm frameId). KHÔNG dùng timer
 * thật trong module. (CLIPBIND-B — bug b: trước vòng này KHÔNG AI gọi
 * tick() mỗi frame nên _mixer kẹt ở time 0 dù play() đã tạo action;
 * Anim.mixer thì được tick nhưng có 0 action. Không gộp vào Anim.mixer:
 * Animator có registry/layers/blend/root-motion/events riêng gắn với
 * _mixer, còn Anim.mixer bị setTarget() tạo lại mỗi lần load model.)
 * Guard chống double-update: tick(dt, frameId) bỏ qua lần gọi thứ 2
 * trong cùng 1 frameId (trả reason 'already-ticked-this-frame'). Clip THREE.AnimationClip phát qua
 * THREE.AnimationMixer riêng của tab (không đụng Anim.mixer);
 * clip keyframe ủy thác cho Keyframe.tick; clip autogen ủy thác
 * cho AnimAutoGen.play (chỉ phát, không scrub/step được).
 *
 * CHỈNH SỬA CLIP (thuần, làm trên THREE.AnimationClip):
 *   trim (cắt + nội suy biên), retime (đổi tốc độ, giữ số key),
 *   reverse (đảo thời gian), mirror (đổi cặp Left/Right + lật dấu
 *   quay y,z / vị trí x — mirror đúng qua mặt phẳng dọc YZ;
 *   keyframe cũng mirror được qua editCurrentClip).
 *   Lưu thành clip MỚI, không ghi đè clip gốc.
 *
 * LAYERS (v2 — Animation Layers, js/animation/anim-layers.js):
 *   Base = clip đang phát + N layer (Animator.layers), mỗi layer có
 *   clip riêng, weight 0–1, mask nhóm xương, mode override/additive.
 *   Phát qua mixer hiện có: layer override = maskedClip phát song
 *   song (action riêng, weight của layer); additive = maskedClip →
 *   makeAdditive + AdditiveAnimationBlendMode. Scrub (setTime) áp
 *   pose layer bằng sampling trực tiếp (applyLayerPoseAtTime) vì
 *   applyPoseAtTime ghi đè quaternion xương.
 *   Lớp Additive cũ (Animator.additive, 1 clip) vẫn giữ nguyên để
 *   tương thích — layer mới là hệ riêng, chạy sau additive.
 *   Lưu: format 'pixistudio-animator-clips-2' (exportLayersJSON /
 *   importLayersJSON), đọc được cả format v1 (không có layers).
 *
 * CURVE EDITOR (v2 — js/animation/anim-curves.js): chỉnh
 *   interpolation từng đoạn key (linear/bezier/ease-in/ease-out/
 *   ease-in-out/step), preview canvas, áp thành clip mới bằng cách
 *   bake easing thành key dày (THREE track không lưu interp/key).
 *   Mở từ clip đang chọn (Animator.openCurveEditor) hoặc từ clip
 *   keyframe (AnimCurves.fromKeyframeClip).
 *
 * ROOT MOTION (THẬT — di chuyển model trong world):
 *   bật = sau mỗi mixer.update, lấy delta XZ của track Hips giữa
 *   2 frame (sampling track, xoay theo hướng mặt của model), cộng
 *   dồn vào vị trí model root (target.position) rồi khóa Hips XZ
 *   về bind (giữ Y của clip để nhân vật vẫn nhún); nhân vật ĐI
 *   trong scene thay vì chạy tại chỗ. Tắt = Hips khóa hoàn toàn ở
 *   bind, model đứng yên (hành vi cũ).
 *   Loop: qua vòng mới thì đồng bộ lại baseline, không nhảy về.
 *   Đổi clip: giữ vị trí hiện tại. Reset vị trí: về điểm bắt đầu
 *   phiên phát (hoặc gốc tuyệt đối với {absolute:true}).
 *   ĐO THẬT trên clip Thiếu Lâm (Idle/Run/Attack/Punch): track
 *   Hips.position CHỈ đổi Y, X/Z hằng số → clip tại chỗ, model
 *   root dịch 0.000m là ĐÚNG (không có root motion ngang trong
 *   dữ liệu). Muốn nhân vật đi tới cần clip có Hips XZ di chuyển
 *   thật (vd Mixamo xuất KHÔNG tick "in place").
 *
 * EVENT CÓ ACTION: marker gắn action thật — sound (WebAudio beep
 *   hoặc file mp3/wav), damage (trừ HP demo + bus animator:event
 *   kèm damage/target), effect (flash 3D tại xương + burst 2D qua
 *   PixiEffects nếu có), custom (ArpAnimator.onEvent(name, fn)).
 *   Event CHỈ kích hoạt khi PHÁT qua frame đó; scrub/step không
 *   kích hoạt (hành vi đã chọn, ghi rõ).
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
 *   • Mirror ĐÚNG qua mặt phẳng dọc YZ (Nhóm B, arp-restpose.js):
 *     đổi cặp L/R + quaternion (x,−y,−z,w) / vị trí (−x,y,z);
 *     xương chỉ có 1 bên được tạo track bên kia; mirror 2 lần =
 *     clip gốc. Áp được cho clip THREE (Mixamo/studio/retarget/
 *     bake) + clip keyframe (keys Euler + FK). Clip AnimAutoGen
 *     chỉ có định nghĩa (không có clip THREE) thì vẫn không
 *     mirror được.
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
 *   • Root motion thật chỉ trích được từ clip THREE có track
 *     Hips.position với XZ di chuyển (clip tại chỗ như Thiếu Lâm
 *     Idle/Run/Attack/Punch cho 0.000m là ĐÚNG); clip keyframe/
 *     autogen không trích root motion. Delta lấy theo world nên
 *     đúng cả khi model đã xoay hướng.
 *   • Sound event: trình duyệt thật cần user gesture (bấm Play)
 *     mới mở được AudioContext; file âm thanh dùng object URL nên
 *     tải lại trang phải chọn lại (chỉ beep + tham số lưu trong
 *     JSON). Event chỉ kích hoạt khi phát qua frame — scrub/step
 *     không kích hoạt (hành vi đã chọn).
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
    layers: [],                /* [{id, clipId, weight, mask, mode, enabled}] — Base + N layer */
    _layerSeq: 0,
    _layerActions: {},         /* layerId -> {action, clipKey, effClip} */
    _curveEdit: null,          /* edit đang mở trong Curve Editor */
    FORMAT2: 'pixistudio-animator-clips-2',
    display: { skeleton: false, ik: false, trails: false, onion: false, readout: true, boneAngles: true, rootPath: false },
    events: {},                /* clipId -> [{id, t, name, action, params, bone}] */
    firedLog: [],              /* [{name, t, at, action, result}] trong lần phát này */
    topBones: [],              /* [{bone, deg}] 3 xương chuyển động mạnh nhất */
    rootPos: { x: 0, y: 0, z: 0 },   /* Hips local (giữ nguyên ngữ nghĩa cũ) */
    modelRootPos: { x: 0, y: 0, z: 0 }, /* vị trí WORLD của model root */
    rootMotionTravelled: 0,    /* quãng đường XZ model root đã đi (m) */
    demoHp: 100,               /* HP demo cho action damage */
    demoHpMax: 100,
    rootPath: [],              /* [{t, x, y, z}] */
    _clips: [],                /* registry đã chuẩn hóa (không gồm user) */
    _userClips: [],            /* clip do user tạo bằng chỉnh sửa — xóa được */
    _extraClips: [],           /* clip đăng ký ngoài (harness/nguồn khác) có
                                 userCreated:false — KHÔNG xóa được */
    _mixer: null,
    /* CLIPBIND-B: frame id của lần tick() gần nhất (app.js truyền App._frame).
       Guard chống double-update: tick 2 lần cùng frameId thì lần 2 bỏ qua. */
    _lastTickFrame: null,
    _target: null,
    _actions: {},              /* clipId -> THREE.AnimationAction */
    _currentAction: null,
    _blendAction: null,
    _bindHips: null,
    _firedIds: {},
    _addLastKey: null,         /* guard chống additive cộng dồn */
    _evSeq: 0,
    _rootPathLine: null,
    _rootMarker: null,         /* sphere đánh dấu vị trí model root hiện tại */
    /* --- root motion thật --- */
    _rmPrevWorld: null,        /* {x,y,z} world của Hips sau tick trước (đã khóa XZ) */
    _rmOrigin: null,           /* {x,y,z} vị trí model root lúc bắt đầu phiên phát */
    _rmHasTrack: false,        /* clip hiện tại có track Hips.position không */
    _rmNeedResync: true,       /* tick tới phải đồng bộ lại baseline trước */
    /* --- event action --- */
    _customHandlers: {},       /* name -> [fn] (onEvent) */
    _activeEffects: [],        /* [{mesh, age, ttl}] flash 3D đang chạy */
    _soundCache: {},           /* url -> AudioBuffer đã decode */
    _audioCtx: null
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
    /* VÒNG ĐỒNG BỘ SKELETON (2026-11-27): 1 thứ tự resolve duy nhất
       cho mọi module (ArpSharedSkeleton.resolveTarget). */
    try {
      var SH = PS.ArpSharedSkeleton;
      if (SH && typeof SH.resolveTarget === 'function') {
        var shared = SH.resolveTarget(null);
        if (shared) return shared;
      }
    } catch (e) {}
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
  /* Model root = object mà mixer phát lên (Anim.targetObject, con
     trực tiếp của Viewport.modelRoot 'Models'). Di chuyển
     target.position là di chuyển cả nhân vật trong world. */
  function getModelRoot() { return getTarget(); }
  /* Vị trí world hiện tại của model root ({x,y,z} hoặc null). */
  function modelRootWorldPos() {
    var root = getModelRoot();
    if (!root) return null;
    try {
      if (root.parent) root.updateWorldMatrix(true, false);
      var v = new window.THREE.Vector3();
      root.getWorldPosition(v);
      return { x: round4(v.x), y: round4(v.y), z: round4(v.z) };
    } catch (e) { return { x: round4(root.position.x), y: round4(root.position.y), z: round4(root.position.z) }; }
  }
  /* Vị trí world hiện tại của Hips (cần updateWorldMatrix vì mixer
     vừa đổi pose nhưng matrixWorld chưa kịp cập nhật tới lúc render). */
  function hipsWorldPos() {
    var hips = findHipsBone();
    if (!hips || !window.THREE) return null;
    try {
      hips.updateWorldMatrix(true, false);
      var v = new window.THREE.Vector3();
      hips.getWorldPosition(v);
      return { x: v.x, y: v.y, z: v.z };
    } catch (e) { return null; }
  }
  /* Đồng bộ baseline root motion với pose hiện tại (không di chuyển
     model). Gọi khi bắt đầu phát / đổi clip / scrub / toggle. */
  function syncRmBaseline() {
    var p = hipsWorldPos();
    Animator._rmPrevWorld = p ? { x: p.x, y: p.y, z: p.z } : null;
    Animator._rmNeedResync = false;
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    Animator._rmHasTrack = !!(entry && entry.clip && findHipsTrack(entry.clip));
    return Animator._rmPrevWorld;
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

  /* VÒNG ĐỒNG BỘ SKELETON (2026-11-27): wire setTarget vào model đổi /
     selection đổi — TRƯỚC ĐÂY setTarget KHÔNG CÓ caller nào trong repo
     (phát hiện vòng clip-binding): đổi model ngoài mà không gọi
     setTarget thì mixer vẫn bám model cũ; live đo được Animator._target
     = null, _mixer không tồn tại trong khi Rigging giữ xương thật.
     Đăng ký 1 lần duy nhất (gọi lúc load module + lúc mở tab, vì bus
     có thể chưa sẵn lúc load). setTarget() đã có CLIPBIND-FIX reset
     AN.time/playing/paused/firedLog/_firedIds — giữ nguyên, không
     chạm play(). */
  function _bindTargetSync() {
    if (Animator._targetSyncBound) return;
    var b = (window.PixiStudio && window.PixiStudio.bus) || null;
    if (!b || typeof b.on !== 'function') return;
    Animator._targetSyncBound = true;
    b.on('model:loaded', function (data) {
      try {
        var t = null;
        var P = window.PixiStudio || {};
        if (data && data.id && P.Models && P.Models.models) {
          var entry = P.Models.models[data.id];
          if (entry && entry.object3D) t = entry.object3D;
        }
        if (!t) {
          var SH = P.ArpSharedSkeleton;
          if (SH && typeof SH.resolveTarget === 'function') t = SH.resolveTarget(null);
        }
        if (t && t !== Animator._target) Animator.setTarget(t);
      } catch (e) {}
    });
    b.on('arp:shared-skeleton-changed', function (data) {
      try {
        if (data && data.target && data.target !== Animator._target) Animator.setTarget(data.target);
      } catch (e) {}
    });
    b.on('state:changed', function (data) {
      try {
        if (!data || data.key !== 'selection') return;
        var SH2 = (window.PixiStudio || {}).ArpSharedSkeleton;
        var t2 = null;
        if (SH2 && typeof SH2.resolveTarget === 'function') t2 = SH2.resolveTarget(null);
        if (t2 && t2 !== Animator._target) Animator.setTarget(t2);
      } catch (e) {}
    });
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
    /* CLIPBIND-A: cài lớp 1 (vá THREE.PropertyBinding.findNode) trước
       khi tạo mixer — mọi clipAction sau đó đều bind đúng xương
       'mixamorig:' (xem js/rig/arp-clipbind.js). Idempotent. */
    try { if (window.PixiStudio && PixiStudio.ArpClipBind) PixiStudio.ArpClipBind.install(); } catch (e) {}
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

  /* CLIPBIND-A: lấy module bind + clip đã chuẩn hóa tên track cho 1
     entry / 1 clip (lớp 2 — prepareClip clone, cache theo clip gốc;
     clip gốc không bao giờ bị sửa). Lớp 1 (findNode) đã cài ở
     ensureMixer nên cả clip chưa chuẩn hóa cũng bind đúng. */
  function getClipBind() {
    try { return (window.PixiStudio && window.PixiStudio.ArpClipBind) || null; } catch (e) { return null; }
  }
  function boundClipFor(entry) {
    if (!entry || !entry.clip) return entry ? entry.clip : null;
    var CB = getClipBind();
    if (!CB || typeof CB.prepareClip !== 'function') return entry.clip;
    try { return CB.prepareClip(entry.clip).clip; } catch (e) { return entry.clip; }
  }
  function boundClipOf(clip) {
    if (!clip) return clip;
    var CB = getClipBind();
    if (!CB || typeof CB.prepareClip !== 'function') return clip;
    try { return CB.prepareClip(clip).clip; } catch (e) { return clip; }
  }

  function captureBindHips() {
    var hips = findHipsBone();
    var entry0 = Animator.currentId ? getClip(Animator.currentId) : null;
    var ht0 = (entry0 && entry0.clip) ? findHipsTrack(entry0.clip) : null;
    if (hips) {
      /* "Bind" cho root motion = mẫu Hips tại t=0 của clip (pose mà
         clip quay về mỗi vòng loop), KHÔNG phải pose hiện tại lúc
         bấm Play — nếu không, phát lại clip đang dở (Hips XZ đã
         lệch) sẽ khóa nhầm Hips ở vị trí lệch đó. Không có track
         Hips thì giữ hành vi cũ (pose hiện tại). */
      if (ht0) {
        var b0 = sampleVecTrack(ht0, 0);
        Animator._bindHips = { x: b0.x, y: b0.y, z: b0.z };
      } else Animator._bindHips = { x: hips.position.x, y: hips.position.y, z: hips.position.z };
    }
    else Animator._bindHips = null;
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (entry && entry.clip) {
      Animator.rootPath = rootPathFor(entry.clip, 33);
      var p0 = rootPosAt(entry.clip, Animator.time);
      if (p0) Animator.rootPos = { x: round4(p0.x), y: round4(p0.y), z: round4(p0.z) };
    } else Animator.rootPath = [];
    /* Root motion: ghi điểm bắt đầu phiên phát (chỉ lần đầu — đổi
       clip giữ vị trí, Reset mới về đây) + đồng bộ baseline. */
    var root = getModelRoot();
    if (root && !Animator._rmOrigin) {
      Animator._rmOrigin = { x: root.position.x, y: root.position.y, z: root.position.z };
    }
    var mp = modelRootWorldPos();
    if (mp) Animator.modelRootPos = mp;
    Animator._rmNeedResync = true;
    syncRmBaseline();
  }

  /* Khóa Hips XZ về bind, GIỮ Y của clip (nhân vật vẫn nhún theo
     clip, không trượt ngang trong model space). Dùng chung cho cả
     root motion BẬT (sau khi đã trích delta XZ ra model root) và
     chế độ scrub (pose hiển thị nhất quán với lúc phát). */
  function lockHipsXZ() {
    var hips = findHipsBone();
    if (hips && Animator._bindHips) {
      hips.position.x = Animator._bindHips.x;
      hips.position.z = Animator._bindHips.z;
      return true;
    }
    return false;
  }

  /* Trích root motion THẬT sau 1 mixer.update (chỉ gọi từ tick):
     delta XZ world của Hips giữa 2 frame → cộng vào model root,
     rồi khóa Hips XZ về bind. Y KHÔNG đụng (model đi trên mặt đất,
     feet vẫn chạm grid). Qua biên loop: tính delta qua biên bằng
     sampling track để nhân vật đi tiếp, không nhảy về. */
  function applyRootMotionTick(prevTime, newTime, wrapped) {
    var hips = findHipsBone();
    if (!Animator.rootMotion) return applyRootMotion();
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (!entry || !entry.clip || !hips) {
      return { ok: false, error: 'Không có clip THREE / xương Hips để trích root motion.' };
    }
    if (!findHipsTrack(entry.clip)) {
      Animator._rmHasTrack = false;
      return { ok: false, error: 'Clip "' + entry.name + '" không có track Hips.position — không trích được root motion, nhân vật phát tại chỗ.', reason: 'no-hips-track' };
    }
    Animator._rmHasTrack = true;
    var hipsTrack = findHipsTrack(entry.clip);
    if (wrapped) {
      /* Clip vừa loop: Hips nhảy từ cuối clip về đầu — KHÔNG lấy
         delta world trực tiếp (sẽ giật lùi). Tính đúng quãng đường
         qua biên bằng sampling track: (cuối − prevTime) + (newTime
         − đầu), xoay theo hướng mặt của model. Hỏng sampling thì
         chỉ đồng bộ baseline (mất tối đa 1 bước tick/vòng). */
      var movedWrap = 0;
      try {
        var rootW = getModelRoot();
        if (rootW && window.THREE) {
          var sEnd = sampleVecTrack(hipsTrack, entry.duration);
          var sPrev = sampleVecTrack(hipsTrack, prevTime);
          var sNew = sampleVecTrack(hipsTrack, newTime);
          var s0 = sampleVecTrack(hipsTrack, 0);
          var lx = (sEnd.x - sPrev.x) + (sNew.x - s0.x);
          var lz = (sEnd.z - sPrev.z) + (sNew.z - s0.z);
          var q = new window.THREE.Quaternion();
          rootW.getWorldQuaternion(q);
          var wv = new window.THREE.Vector3(lx, 0, lz).applyQuaternion(q);
          if (Math.abs(wv.x) > 1e-9 || Math.abs(wv.z) > 1e-9) {
            rootW.position.x += wv.x;
            rootW.position.z += wv.z;
            movedWrap = Math.sqrt(wv.x * wv.x + wv.z * wv.z);
            Animator.rootMotionTravelled += movedWrap;
          }
        }
      } catch (e) {}
      lockHipsXZ();
      syncRmBaseline();
      var mpW = modelRootWorldPos();
      if (mpW) Animator.modelRootPos = mpW;
      return { ok: true, applied: true, wrapped: true, moved: round4(movedWrap) };
    }
    if (!Animator._rmPrevWorld) { syncRmBaseline(); lockHipsXZ(); return { ok: true, applied: true, wrapped: false, moved: 0 }; }
    /* Delta XZ lấy bằng SAMPLING track Hips (prevTime → newTime),
       xoay theo hướng mặt của model rồi cộng vào model root.
       (Không đo bằng world pos live: sau tick trước Hips đã bị
       khóa XZ về bind nên world pos live tại prevTime không còn
       là pose clip — đo live sẽ cộng dồn sai thành Σ pose tuyệt
       đối, đã bắt được bằng harness: 15.25m thay vì 0.5m.)
       Giới hạn: khi blend/crossfade 2 clip, delta lấy theo clip
       Base (clip đang chọn), không theo pose blend. */
    var sPrev = sampleVecTrack(hipsTrack, prevTime);
    var sNew = sampleVecTrack(hipsTrack, newTime);
    var lx = sNew.x - sPrev.x;
    var lz = sNew.z - sPrev.z;
    var moved = 0;
    var root = getModelRoot();
    if (root && window.THREE && (Math.abs(lx) > 1e-9 || Math.abs(lz) > 1e-9)) {
      var q2 = new window.THREE.Quaternion();
      try { root.getWorldQuaternion(q2); } catch (e) {}
      var wv2 = new window.THREE.Vector3(lx, 0, lz).applyQuaternion(q2);
      wv2.y = 0;
      root.position.x += wv2.x;
      root.position.z += wv2.z;
      moved = Math.sqrt(wv2.x * wv2.x + wv2.z * wv2.z);
      Animator.rootMotionTravelled += moved;
    }
    lockHipsXZ();
    syncRmBaseline();
    var p = rootPosAt(entry.clip, newTime);
    if (p) Animator.rootPos = { x: round4(p.x), y: round4(p.y), z: round4(p.z) };
    var mp = modelRootWorldPos();
    if (mp) Animator.modelRootPos = mp;
    return { ok: true, applied: true, moved: round4(moved), dx: round4(sNew.x - sPrev.x), dz: round4(sNew.z - sPrev.z) };
  }

  function applyRootMotion() {
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (Animator.rootMotion) {
      if (entry && entry.clip) {
        var p = rootPosAt(entry.clip, Animator.time);
        if (p) Animator.rootPos = { x: round4(p.x), y: round4(p.y), z: round4(p.z) };
      }
      /* BẬT (scrub/toggle — KHÔNG di chuyển model): khóa Hips XZ về
         bind để pose hiển thị khớp lúc phát, giữ Y clip. */
      if (entry && entry.clip && findHipsTrack(entry.clip)) lockHipsXZ();
      syncRmBaseline();
      var mp = modelRootWorldPos();
      if (mp) Animator.modelRootPos = mp;
      return { ok: true, applied: true };
    }
    var hips = findHipsBone();
    if (hips && Animator._bindHips) {
      hips.position.set(Animator._bindHips.x, Animator._bindHips.y, Animator._bindHips.z);
      Animator.rootPos = { x: round4(Animator._bindHips.x), y: round4(Animator._bindHips.y), z: round4(Animator._bindHips.z) };
      syncRmBaseline();
      var mp2 = modelRootWorldPos();
      if (mp2) Animator.modelRootPos = mp2;
      return { ok: true, applied: false };
    }
    return { ok: false, error: 'Không tìm thấy xương Hips để khóa root.' };
  }

  /* Đưa nhân vật về điểm bắt đầu phiên phát (mặc định) hoặc gốc
     tuyệt đối (0,0,0) với {absolute:true}. Không đụng pose/clip. */
  function resetRootPosition(opts) {
    opts = opts || {};
    var root = getModelRoot();
    if (!root) return { ok: false, error: 'Chưa có model.' };
    var dest = opts.absolute ? { x: 0, y: 0, z: 0 }
      : (Animator._rmOrigin || { x: 0, y: 0, z: 0 });
    root.position.set(dest.x, dest.y, dest.z);
    Animator.rootMotionTravelled = 0;
    if (opts.absolute) Animator._rmOrigin = { x: 0, y: 0, z: 0 };
    syncRmBaseline();
    Animator.modelRootPos = { x: round4(dest.x), y: round4(dest.y), z: round4(dest.z) };
    if (Animator.display.rootPath) drawRootPath();
    return { ok: true, position: Animator.modelRootPos, absolute: !!opts.absolute };
  }

  /* Thông tin root motion cho UI/harness. */
  function getRootMotionInfo() {
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    return {
      enabled: Animator.rootMotion,
      hasTrack: Animator._rmHasTrack,
      clip: entry ? entry.name : null,
      modelRootPos: { x: Animator.modelRootPos.x, y: Animator.modelRootPos.y, z: Animator.modelRootPos.z },
      hipsLocal: { x: Animator.rootPos.x, y: Animator.rootPos.y, z: Animator.rootPos.z },
      travelled: round4(Animator.rootMotionTravelled),
      origin: Animator._rmOrigin ? { x: Animator._rmOrigin.x, y: Animator._rmOrigin.y, z: Animator._rmOrigin.z } : null
    };
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

  /* ============================================================
     2b. ANIMATION LAYERS — Base + N layer (vòng Animation mở rộng)
     Logic mask/additive thuần nằm ở PixiStudio.AnimLayers
     (js/animation/anim-layers.js); đây chỉ quản lý layer + action
     trên mixer hiện có của Animator.
     ============================================================ */
  function getAnimLayers() { return PS.AnimLayers || null; }

  function listLayers() {
    return Animator.layers.map(function (l) {
      return { id: l.id, clipId: l.clipId, weight: l.weight, mask: l.mask, mode: l.mode, enabled: l.enabled };
    });
  }

  function addLayer(clipId, opts) {
    opts = opts || {};
    var entry = getClip(clipId);
    if (!entry) return { ok: false, error: 'Không tìm thấy clip "' + clipId + '".' };
    if (!entry.clip) return { ok: false, error: 'Layer chỉ dùng clip THREE (autogen/keyframe không làm layer được).' };
    var AL = getAnimLayers();
    var layer;
    if (AL && typeof AL.createLayer === 'function') {
      var c = AL.createLayer({ clipId: clipId, weight: opts.weight, mask: opts.mask, mode: opts.mode, enabled: opts.enabled });
      if (!c.ok) return c;
      layer = c.layer;
    } else {
      layer = {
        id: 'layer_' + (++Animator._layerSeq),
        clipId: clipId, weight: clamp(opts.weight === undefined ? 1 : parseFloat(opts.weight) || 0, 0, 1),
        mask: opts.mask || 'ALL', mode: opts.mode || 'override', enabled: opts.enabled !== false
      };
    }
    Animator.layers.push(layer);
    syncLayerActions();
    try { bus.emit('animator:layers-changed', { layers: listLayers() }); } catch (e) {}
    return { ok: true, layer: { id: layer.id, clipId: layer.clipId, weight: layer.weight, mask: layer.mask, mode: layer.mode, enabled: layer.enabled }, count: Animator.layers.length };
  }

  function removeLayer(id) {
    var idx = -1;
    Animator.layers.forEach(function (l, i) { if (l.id === id) idx = i; });
    if (idx < 0) return { ok: false, error: 'Không tìm thấy layer "' + id + '".' };
    var rec = Animator._layerActions[id];
    if (rec && rec.action) { try { rec.action.stop(); } catch (e) {} }
    delete Animator._layerActions[id];
    var removed = Animator.layers.splice(idx, 1)[0];
    try { bus.emit('animator:layers-changed', { layers: listLayers() }); } catch (e) {}
    return { ok: true, id: id, clipId: removed.clipId, count: Animator.layers.length };
  }

  function updateLayer(id, patch) {
    patch = patch || {};
    var layer = null;
    Animator.layers.forEach(function (l) { if (l.id === id) layer = l; });
    if (!layer) return { ok: false, error: 'Không tìm thấy layer "' + id + '".' };
    if (patch.clipId !== undefined) {
      var entry = getClip(patch.clipId);
      if (!entry) return { ok: false, error: 'Không tìm thấy clip "' + patch.clipId + '".' };
      if (!entry.clip) return { ok: false, error: 'Layer chỉ dùng clip THREE.' };
      layer.clipId = patch.clipId;
    }
    if (patch.weight !== undefined) layer.weight = clamp(parseFloat(patch.weight) || 0, 0, 1);
    if (patch.mask !== undefined) layer.mask = patch.mask;
    if (patch.mode !== undefined) {
      if (patch.mode !== 'override' && patch.mode !== 'additive') return { ok: false, error: 'mode phải là "override" hoặc "additive".' };
      layer.mode = patch.mode;
    }
    if (patch.enabled !== undefined) layer.enabled = !!patch.enabled;
    syncLayerActions();
    try { bus.emit('animator:layers-changed', { layers: listLayers() }); } catch (e) {}
    return { ok: true, layer: { id: layer.id, clipId: layer.clipId, weight: layer.weight, mask: layer.mask, mode: layer.mode, enabled: layer.enabled } };
  }

  function moveLayer(id, dir) {
    var idx = -1;
    Animator.layers.forEach(function (l, i) { if (l.id === id) idx = i; });
    if (idx < 0) return { ok: false, error: 'Không tìm thấy layer "' + id + '".' };
    var to = idx + (dir >= 0 ? 1 : -1);
    if (to < 0 || to >= Animator.layers.length) return { ok: false, error: 'Layer đã ở đầu/cuối.' };
    var tmp = Animator.layers[idx];
    Animator.layers[idx] = Animator.layers[to];
    Animator.layers[to] = tmp;
    try { bus.emit('animator:layers-changed', { layers: listLayers() }); } catch (e) {}
    return { ok: true, id: id, index: to };
  }

  function clearLayers() {
    Object.keys(Animator._layerActions).forEach(function (id) {
      var rec = Animator._layerActions[id];
      if (rec && rec.action) { try { rec.action.stop(); } catch (e) {} }
    });
    Animator._layerActions = {};
    Animator.layers = [];
    return { ok: true, count: 0 };
  }

  /* Clip hiệu dụng của layer (mask → additive), dùng AnimLayers khi
     có, fallback lọc tay khi chưa load module. */
  function effectiveLayerClip(layer, entry) {
    var AL = getAnimLayers();
    if (AL && typeof AL.layerClipFor === 'function') return AL.layerClipFor(layer, entry.clip);
    var clip = entry.clip;
    /* Fallback khi AnimLayers chưa load: không lọc mask (ghi rõ ở
       kết quả) — index.html load anim-layers.js trước blendtree nên
       trường hợp này chỉ xảy ra ở trang cũ cache. */
    return { ok: true, clip: clip, kept: clip.tracks.length, removed: 0, masked: false, mode: layer.mode || 'override' };
  }

  /* Tạo/cập nhật action cho mọi layer trên mixer hiện có. Layer tắt
     hoặc weight 0 vẫn giữ action với weight 0 (đổi lại không cần
     tạo mới). Đổi clip/mask/mode → dừng action cũ, tạo clip mới. */
  function syncLayerActions() {
    if (!Animator._mixer || !window.THREE) return { ok: false, reason: 'no-mixer' };
    var synced = 0, skipped = [];
    Animator.layers.forEach(function (layer) {
      var entry = getClip(layer.clipId);
      if (!entry || !entry.clip) { skipped.push(layer.id + ':no-clip'); return; }
      var clipKey = layer.clipId + '|' + (layer.mask || 'ALL') + '|' + (layer.mode || 'override');
      var rec = Animator._layerActions[layer.id];
      if (!rec || rec.clipKey !== clipKey) {
        if (rec && rec.action) { try { rec.action.stop(); } catch (e) {} }
        var eff = effectiveLayerClip(layer, entry);
        if (!eff.ok) { skipped.push(layer.id + ':' + (eff.error || 'eff-fail')); return; }
        var action;
        try {
          /* CLIPBIND-A: layer clip qua lớp 2 (chuẩn hóa tên track);
             lớp 1 (findNode) đã cài ở ensureMixer. */
          action = Animator._mixer.clipAction(boundClipOf(eff.clip));
          action.reset();
          action.setLoop(window.THREE.LoopRepeat);
          action.setEffectiveTimeScale(1);
          if (layer.mode === 'additive' && 'blendMode' in action) {
            action.blendMode = window.THREE.AdditiveAnimationBlendMode;
          }
          action.time = Animator.time % entry.clip.duration;
          action.play();
        } catch (e) { skipped.push(layer.id + ':' + (e && e.message)); return; }
        Animator._layerActions[layer.id] = { action: action, clipKey: clipKey, effClip: eff.clip };
        rec = Animator._layerActions[layer.id];
      }
      try {
        rec.action.setEffectiveWeight(layer.enabled ? clamp(layer.weight, 0, 1) : 0);
        if (layer.enabled && Animator.playing && !Animator.paused) rec.action.paused = false;
        synced++;
      } catch (e) { skipped.push(layer.id + ':' + (e && e.message)); }
    });
    return { ok: true, synced: synced, skipped: skipped };
  }

  /* Nhẹ cho tick(): chỉ cập nhật weight/paused của action layer đã
     có (không resolve clip lại, không tạo action mới). */
  function syncLayerWeights() {
    var n = 0;
    Object.keys(Animator._layerActions).forEach(function (id) {
      var rec = Animator._layerActions[id];
      var layer = null;
      Animator.layers.forEach(function (l) { if (l.id === id) layer = l; });
      if (!rec || !rec.action || !layer) return;
      try {
        rec.action.setEffectiveWeight(layer.enabled ? clamp(layer.weight, 0, 1) : 0);
        rec.action.paused = !(Animator.playing && !Animator.paused);
        n++;
      } catch (e) {}
    });
    return { ok: true, synced: n };
  }

  /* Áp pose layer tại thời điểm t (dùng khi scrub — mixer không áp
     lại pose khi setTime ghi đè trực tiếp). Override: slerp xương
     mask từ pose base về pose layer theo weight. Additive: cộng
     delta quaternion (pose layer − pose frame đầu) nhân weight. */
  function applyLayerPoseAtTime(t) {
    if (!Animator.layers.length || !window.THREE) return { ok: true, applied: 0 };
    var map = getBoneMap();
    var ident = new window.THREE.Quaternion();
    var applied = 0;
    Animator.layers.forEach(function (layer) {
      if (!layer.enabled || !(layer.weight > 0)) return;
      var entry = getClip(layer.clipId);
      if (!entry || !entry.clip) return;
      var AL = getAnimLayers();
      var bones = null;
      if (AL && typeof AL.maskBones === 'function') bones = AL.maskBones(layer.mask);
      var tL = entry.clip.duration > 0 ? (t % entry.clip.duration) : 0;
      var poseNow = sampleClipPose(entry.clip, tL);
      var poseBase = sampleClipPose(entry.clip, 0);
      Object.keys(poseNow).forEach(function (bone) {
        if (bones && bones.indexOf(bone) < 0) {
          /* Xương ngón tay theo tiền tố tay (LEFT_ARM/RIGHT_ARM). */
          if (layer.mask === 'LEFT_ARM' && !/^LeftHand/.test(bone)) return;
          if (layer.mask === 'RIGHT_ARM' && !/^RightHand/.test(bone)) return;
          if (layer.mask !== 'LEFT_ARM' && layer.mask !== 'RIGHT_ARM') return;
        }
        var b = map[bone];
        if (!b) return;
        if ((layer.mode || 'override') === 'additive') {
          var q0 = poseBase[bone] || ident;
          var delta = poseNow[bone].clone().multiply(q0.clone().invert());
          var wDelta = ident.clone().slerp(delta, clamp(layer.weight, 0, 1));
          b.quaternion.multiply(wDelta);
        } else {
          b.quaternion.slerp(poseNow[bone], clamp(layer.weight, 0, 1));
        }
        applied++;
      });
    });
    return { ok: true, applied: applied };
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

  /* ============================================================
     EVENT ACTION (nhóm C)
     action: 'none' | 'sound' | 'damage' | 'effect' | 'custom'.
     Event file cũ (chỉ {id,t,name}) → action 'none' (notify + log +
     bus như trước). Sound cần user gesture trên trình duyệt thật
     (AudioContext có thể suspended tới lần bấm Play đầu tiên);
     trong jsdom (không có AudioContext) thì ghi skipped, không lỗi.
     ============================================================ */
  var EVENT_ACTIONS = ['none', 'sound', 'damage', 'effect', 'custom'];
  function normalizeEvent(ev) {
    if (!ev) return null;
    var action = EVENT_ACTIONS.indexOf(ev.action) >= 0 ? ev.action : 'none';
    var params = (ev.params && typeof ev.params === 'object') ? ev.params : {};
    return {
      id: ev.id, t: ev.t, name: ev.name, action: action,
      params: params, bone: ev.bone || params.bone || null
    };
  }
  function onEvent(name, fn) {
    if (typeof fn !== 'function') return { ok: false, error: 'Callback phải là function.' };
    name = String(name || '').trim();
    if (!name) return { ok: false, error: 'Cần tên event để đăng ký.' };
    if (!Animator._customHandlers[name]) Animator._customHandlers[name] = [];
    if (Animator._customHandlers[name].indexOf(fn) < 0) Animator._customHandlers[name].push(fn);
    return { ok: true, name: name, count: Animator._customHandlers[name].length };
  }
  function offEvent(name, fn) {
    name = String(name || '').trim();
    var list = Animator._customHandlers[name];
    if (!list) return { ok: false, error: 'Không có handler cho "' + name + '".' };
    if (typeof fn === 'function') {
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    } else Animator._customHandlers[name] = [];
    return { ok: true, name: name, count: (Animator._customHandlers[name] || []).length };
  }
  function setDemoHp(v) {
    Animator.demoHp = clamp(Math.round(parseFloat(v) || 0), 0, Animator.demoHpMax);
    updateDemoHpUI();
    return { ok: true, hp: Animator.demoHp };
  }
  function resetDemoHp() {
    Animator.demoHp = Animator.demoHpMax;
    updateDemoHpUI();
    return { ok: true, hp: Animator.demoHp };
  }
  function updateDemoHpUI() {
    if (typeof document === 'undefined') return;
    try {
      var s = document.getElementById('arp-anim-demo-hp');
      if (s) s.textContent = 'HP demo: ' + Animator.demoHp + '/' + Animator.demoHpMax;
    } catch (e) {}
  }
  function getAudioCtx() {
    if (Animator._audioCtx) return Animator._audioCtx;
    try {
      var AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
      if (!AC) return null;
      Animator._audioCtx = new AC();
    } catch (e) { return null; }
    return Animator._audioCtx;
  }
  function playBeep(ctx, freq, dur, volume) {
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq || 880, ctx.currentTime);
      gain.gain.setValueAtTime(volume || 0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (dur || 0.15));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (dur || 0.15));
      return true;
    } catch (e) { return false; }
  }
  /* Phát sound cho event: file url (mp3/wav, đã decode thì phát ngay,
     chưa thì tải async rồi phát) hoặc beep mặc định. Trả result đồng
     bộ; trường hợp async thì cập nhật lại rec.result khi xong. */
  function playEventSound(ev, rec) {
    var params = ev.params || {};
    var ctx = getAudioCtx();
    if (!ctx) return { via: 'skipped-no-audio', note: 'Không có AudioContext (jsdom / trình duyệt chặn) — event vẫn log + bus.' };
    try { if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume(); } catch (e) {}
    if (params.url) {
      var cached = Animator._soundCache[params.url];
      if (cached) {
        try {
          var src = ctx.createBufferSource();
          src.buffer = cached;
          var g = ctx.createGain();
          g.gain.setValueAtTime(params.volume || 0.5, ctx.currentTime);
          src.connect(g); g.connect(ctx.destination);
          src.start();
          return { via: 'file', url: params.url };
        } catch (e) { return { via: 'file-error', error: e && e.message }; }
      }
      /* Tải async: beep KHÔNG phát kèm (tránh 2 tiếng chồng nhau). */
      try {
        fetch(params.url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) {
          return ctx.decodeAudioData(ab);
        }).then(function (buf) {
          Animator._soundCache[params.url] = buf;
          var s2 = ctx.createBufferSource(); s2.buffer = buf;
          var g2 = ctx.createGain(); g2.gain.setValueAtTime(params.volume || 0.5, ctx.currentTime);
          s2.connect(g2); g2.connect(ctx.destination); s2.start();
          if (rec) rec.result = { via: 'file', url: params.url, status: 'played-after-load' };
        }).catch(function (err) {
          playBeep(ctx, params.freq || 880, params.dur || 0.15, params.volume || 0.2);
          if (rec) rec.result = { via: 'beep-fallback', error: 'Không tải được file âm thanh: ' + (err && err.message) };
        });
      } catch (e) { playBeep(ctx, params.freq || 880, params.dur || 0.15, params.volume || 0.2); return { via: 'beep-fallback', error: e && e.message }; }
      return { via: 'file', url: params.url, status: 'loading' };
    }
    var ok = playBeep(ctx, params.freq || 880, params.dur || 0.15, params.volume || 0.2);
    return { via: ok ? 'beep' : 'beep-failed', freq: params.freq || 880, dur: params.dur || 0.15 };
  }
  /* Flash 3D tại vị trí world của xương (SphereGeometry, mờ + nở
     trong ~0.5s, tự gỡ). Nếu PixiEffects + camera có sẵn thì bắn
     thêm burst 2D tại vị trí chiếu lên màn hình (guarded). */
  function spawnFlash(pos, opts) {
    opts = opts || {};
    if (!window.THREE || !pos) return { ok: false, error: 'Không có THREE / vị trí.' };
    var scene = getScene();
    if (!scene) return { ok: false, error: 'Không tìm thấy scene viewport.' };
    try {
      var size = parseFloat(opts.size) || 0.08;
      var color = (opts.color !== undefined && opts.color !== null) ? opts.color : 0xffd23e;
      var mesh = new window.THREE.Mesh(
        new window.THREE.SphereGeometry(size, 12, 8),
        new window.THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.95 })
      );
      mesh.name = '__arp_anim_event_flash__';
      mesh.userData.isBoneVisual = true; /* không nướng vào FBX xuất */
      mesh.position.set(pos.x, pos.y, pos.z);
      scene.add(mesh);
      var ttl = parseFloat(opts.ttl) || 0.5;
      Animator._activeEffects.push({ mesh: mesh, age: 0, ttl: ttl });
      /* Burst 2D phụ qua PixiEffects (nếu studio đã init Pixi app). */
      var via2d = false;
      try {
        var PE = PS.PixiEffects;
        var cam = (PS.Viewport && PS.Viewport.camera) || null;
        if (PE && typeof PE.emit === 'function' && PE.app && cam && typeof cam.project === 'function') {
          var v = new window.THREE.Vector3(pos.x, pos.y, pos.z).project(cam);
          var w = (typeof window !== 'undefined' && window.innerWidth) || 800;
          var h = (typeof window !== 'undefined' && window.innerHeight) || 600;
          PE.emit(opts.kind === 'smoke' ? 'smoke' : 'burst', (v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h, {});
          via2d = true;
        }
      } catch (e) {}
      return { ok: true, position: { x: round4(pos.x), y: round4(pos.y), z: round4(pos.z) }, ttl: ttl, via2d: via2d };
    } catch (e) {
      return { ok: false, error: 'Spawn flash lỗi: ' + (e && e.message) };
    }
  }
  function updateEffects(dt) {
    if (!Animator._activeEffects.length) return;
    var keep = [];
    Animator._activeEffects.forEach(function (fx) {
      fx.age += dt || 0;
      var k = fx.ttl > 0 ? Math.min(1, fx.age / fx.ttl) : 1;
      try {
        var s = 1 + k * 2;
        fx.mesh.scale.set(s, s, s);
        if (fx.mesh.material) fx.mesh.material.opacity = Math.max(0, 0.95 * (1 - k));
      } catch (e) {}
      if (k < 1) keep.push(fx);
      else { try { if (fx.mesh.parent) fx.mesh.parent.remove(fx.mesh); } catch (e) {} try { if (fx.mesh.geometry) fx.mesh.geometry.dispose(); } catch (e) {} try { if (fx.mesh.material) fx.mesh.material.dispose(); } catch (e) {} }
    });
    Animator._activeEffects = keep;
  }
  function clearEffects() {
    Animator._activeEffects.forEach(function (fx) {
      try { if (fx.mesh.parent) fx.mesh.parent.remove(fx.mesh); } catch (e) {}
    });
    Animator._activeEffects = [];
  }
  function boneWorldPos(boneName) {
    var map = getBoneMap();
    var b = (boneName && (map[boneName] || map[String(boneName).replace(/^mixamorig:?/i, '')])) || findHipsBone();
    if (!b || !window.THREE) return null;
    try {
      b.updateWorldMatrix(true, false);
      var v = new window.THREE.Vector3();
      b.getWorldPosition(v);
      return { x: v.x, y: v.y, z: v.z };
    } catch (e) { return null; }
  }
  function executeEventAction(ev, rec) {
    ev = normalizeEvent(ev);
    if (ev.action === 'sound') {
      return playEventSound(ev, rec);
    }
    if (ev.action === 'damage') {
      var amount = Math.max(0, parseFloat((ev.params || {}).amount) || 0);
      var target = (ev.params || {}).target || 'enemy';
      Animator.demoHp = Math.max(0, Animator.demoHp - amount);
      rec.damage = amount;
      rec.target = target;
      rec.hpAfter = Animator.demoHp;
      updateDemoHpUI();
      return { via: 'damage', applied: amount, target: target, hpAfter: Animator.demoHp };
    }
    if (ev.action === 'effect') {
      var bone = ev.bone || (ev.params || {}).bone || 'Hips';
      var pos = boneWorldPos(bone) || modelRootWorldPos();
      var r = spawnFlash(pos, {
        kind: (ev.params || {}).kind || 'flash',
        color: (ev.params || {}).color, size: (ev.params || {}).size
      });
      return { via: r.ok ? 'flash-3d' : 'effect-failed', bone: bone, position: r.position || null, via2d: !!r.via2d, error: r.error || null };
    }
    if (ev.action === 'custom') {
      var handlers = [];
      (Animator._customHandlers[ev.name] || []).forEach(function (fn) { handlers.push(fn); });
      (Animator._customHandlers['*'] || []).forEach(function (fn) { handlers.push(fn); });
      var called = 0, errors = [], returns = [];
      handlers.forEach(function (fn) {
        try { returns.push(fn(rec, ev)); called++; } catch (e) { errors.push(e && e.message || String(e)); }
      });
      return { via: 'custom', called: called, errors: errors, returns: returns };
    }
    return { via: 'none' };
  }

  function fireEventsInRange(from, to) {
    var fired = [];
    if (!Animator.currentId) return fired;
    var list = Animator.events[Animator.currentId] || [];
    list.forEach(function (evRaw) {
      var ev = normalizeEvent(evRaw);
      if (ev.t > from && ev.t <= to && !Animator._firedIds[ev.id]) {
        Animator._firedIds[ev.id] = true;
        var rec = { id: ev.id, name: ev.name, t: round3(ev.t), at: round3(Animator.time), action: ev.action };
        rec.result = executeEventAction(ev, rec);
        Animator.firedLog.push(rec);
        fired.push(rec);
        notify('info', 'Animator event', '"' + ev.name + '" @ ' + ev.t.toFixed(2) + 's' + (ev.action !== 'none' ? ' [' + ev.action + ']' : ''));
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
      /* CLIPBIND-A: bind clip đã chuẩn hóa tên track (lớp 2);
         lớp 1 (findNode) đã cài ở ensureMixer. */
      try { action = mx.mixer.clipAction(boundClipFor(entry)); } catch (err) { return { ok: false, error: 'clipAction lỗi: ' + (err && err.message) }; }
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
    Animator.time = 0; /* CLIPBIND-FIX: đồng bộ AN.time với action.reset() */
    Animator._firedIds = {};
    Animator.playing = true;
    Animator.paused = false;
    captureBindHips();
    if (Animator.blend.clipBId) syncBlendAction();
    syncLayerActions();
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
    Object.keys(Animator._layerActions).forEach(function (id) {
      var rec = Animator._layerActions[id];
      if (rec && rec.action) { try { rec.action.stop(); } catch (e) {} }
    });
    Animator._layerActions = {};
    clearEffects();
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
            /* CLIPBIND-A: scrub tạo action trên clip đã chuẩn hóa
               tên track (lớp 2); lớp 1 đã cài ở ensureMixer. */
            var a0 = mx2.mixer.clipAction(boundClipFor(entry));
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
    /* Scrub/step KHÔNG kích hoạt event (hành vi đã chọn): event chỉ
       kích hoạt khi PHÁT qua frame đó (tick). Kéo timeline qua nhanh
       không bắn sound/damage/effect. */
    applyRootMotion();
    applyAdditive();
    applyLayerPoseAtTime(t);
    /* Đồng bộ thời gian action layer để tick tiếp theo chạy đúng. */
    Object.keys(Animator._layerActions).forEach(function (id) {
      var rec = Animator._layerActions[id];
      var layer = null;
      Animator.layers.forEach(function (l) { if (l.id === id) layer = l; });
      if (!rec || !rec.action || !layer) return;
      var le = getClip(layer.clipId);
      if (le && le.clip && le.clip.duration > 0) {
        try { rec.action.time = t % le.clip.duration; } catch (e) {}
      }
    });
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

  function tick(dt, frameId) {
    if (!Animator.playing || Animator.paused) return { ok: false, reason: 'not-playing' };
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (!entry) return { ok: false, error: 'Chưa chọn clip.' };
    /* CLIPBIND-B: guard chống double-update — cùng 1 frameId chỉ tick 1 lần
       (tick 2 lần/frame sẽ làm clip chạy nhanh gấp đôi). tick(dt) không kèm
       frameId (harness / gọi tay) thì không bị guard, gọi bao nhiêu lần cũng
       được. Wrapper sync (arp-sync-control / arp-sync-viewport) phải forward
       frameId thì guard mới có tác dụng qua chúng. */
    if (frameId !== undefined && frameId !== null) {
      if (Animator._lastTickFrame === frameId) return { ok: false, reason: 'already-ticked-this-frame', time: round3(Animator.time) };
      Animator._lastTickFrame = frameId;
    }
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
      /* Root motion thật: đồng bộ baseline với pose tại prevTime
         TRƯỚC khi mixer nhảy tới frame mới (pose lúc này vẫn là
         pose sau tick trước, đã khóa XZ). */
      if (Animator._rmNeedResync || !Animator._rmPrevWorld) syncRmBaseline();
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
      applyRootMotionTick(prevTime, Animator.time, wrapped);
      applyAdditive();
      updateEffects(dtEff);
      if (Animator.display.rootPath) drawRootPath();
      syncLayerWeights();
    }
    /* Base keyframe không qua mixer: layer áp bằng sampling trực
       tiếp sau KF.tick (scrub đã làm tương tự trong setTime). */
    if (entry.source === 'keyframe') applyLayerPoseAtTime(Animator.time);
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
      /* CLIPBIND-A: clip B qua lớp 2 (chuẩn hóa tên track). */
      try { action = Animator._mixer.clipAction(boundClipFor(bEntry)); } catch (e) { return { ok: false, error: 'clipAction B lỗi: ' + (e && e.message) }; }
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

  /* Mirror clip qua mặt phẳng dọc YZ — LUẬT ĐÚNG (Nhóm B,
     js/rig/arp-restpose.js, ArpAnimMirror): đổi cặp Left/Right +
     quaternion (x,−y,−z,w) / vị trí (−x,y,z). Luật cũ (−x,y,−z,w)
     là mirror qua mặt phẳng NGANG XZ — SAI (quay quanh Y không bị
     mirror, quay quanh X bị đảo). Delegate cho ArpAnimMirror khi
     module đã load; fallback inline dưới đây dùng ĐÚNG luật mới
     (kèm tạo track bên kia khi clip chỉ có 1 bên). */
  function mirrorClip(clip) {
    if (!clip || !clip.tracks) return { ok: false, error: 'Clip không có tracks.' };
    var AM = (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.ArpAnimMirror) || null;
    if (AM && typeof AM.mirrorClip === 'function') {
      try {
        var r = AM.mirrorClip(clip);
        if (r && r.ok) return r;
      } catch (e) {}
    }
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
    function mirrorTrackName(name) {
      var dot = name.lastIndexOf('.');
      if (dot <= 0) return name;
      var bonePart = name.slice(0, dot);
      var prop = name.slice(dot);
      var m = bonePart.match(/^(mixamorig:?|model:?)(.*)$/i);
      var core = m ? m[2] : bonePart;
      return (m ? m[1] : '') + counterpart(core) + prop;
    }
    function mirrorValues(src, isQuat) {
      var values = [];
      var n = src.times.length;
      for (var i = 0; i < n; i++) {
        if (isQuat) {
          /* Luật đúng: (x,−y,−z,w) — xem header § Mirror. */
          values.push(src.values[i * 4], -src.values[i * 4 + 1], -src.values[i * 4 + 2], src.values[i * 4 + 3]);
        } else {
          /* Vị trí: lật dấu x */
          values.push(-src.values[i * 3], src.values[i * 3 + 1], src.values[i * 3 + 2]);
        }
      }
      return values;
    }
    var done = {};
    var tracks = [];
    var synthesized = [];
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
      tracks.push(cloneTrackOfType(tr, Array.prototype.slice.call(src.times), mirrorValues(src, isQuatTrack(src))));
      /* Track twin: giữ tên gốc nếu có, lấy giá trị từ track này
         (đã lật dấu); nếu clip chỉ có 1 bên thì TẠO track bên kia. */
      if (twin !== bone) {
        var twinTr = byBone[twinKey];
        if (twinTr) tracks.push(cloneTrackOfType(twinTr, Array.prototype.slice.call(tr.times), mirrorValues(tr, isQuatTrack(tr))));
        else {
          tracks.push(cloneTrackOfType(tr, Array.prototype.slice.call(tr.times), mirrorValues(tr, isQuatTrack(tr))));
          tracks[tracks.length - 1].name = mirrorTrackName(tr.name);
          synthesized.push(mirrorTrackName(tr.name));
        }
      }
    });
    var out = buildClip((clip.name || 'clip') + '_mirror', clip.duration, tracks);
    return { ok: true, clip: out, duration: round3(clip.duration), trackCount: tracks.length, synthesizedTwins: synthesized, note: 'Mirror đúng qua YZ: đổi cặp Left/Right + quat (x,−y,−z,w) / vị trí (−x,y,z).' + (synthesized.length ? ' Tạo thêm ' + synthesized.length + ' track bên kia.' : '') };
  }

  /* Phát 'arp:animator-clip-changed' khi Animator tự tạo/xóa clip
     (vòng Export-sync): sync module chỉ bọc editClip (keyframe) /
     retargetClip, còn editCurrentClip / deleteClip trực tiếp thì
     không ai emit — tab Export không biết để cập nhật danh sách.
     Ưu tiên ArpSyncClips.emitClipChanged, fallback bus trực tiếp.
     KHÔNG tạo event mới 'arp:animator-clip-edited' (nó không tồn tại). */
  function emitAnimatorClipChanged(kind, detail) {
    var SC = (window.PixiStudio && window.PixiStudio.ArpSyncClips) || null;
    if (SC && typeof SC.emitClipChanged === 'function') {
      try { SC.emitClipChanged(kind, detail); return true; } catch (e) {}
    }
    var b = (window.PixiStudio && window.PixiStudio.bus) || null;
    if (b && typeof b.emit === 'function') {
      try {
        var data = { kind: kind, at: Date.now() };
        if (detail) Object.keys(detail).forEach(function (k) { data[k] = detail[k]; });
        b.emit('arp:animator-clip-changed', data);
        return true;
      } catch (e) {}
    }
    return false;
  }

  /* Áp 1 phép chỉnh sửa lên clip đang chọn, lưu thành clip MỚI. */
  function editCurrentClip(op, opts) {
    opts = opts || {};
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (!entry) return { ok: false, error: 'Chưa chọn clip.' };
    /* [NHÓM B] Mirror clip keyframe (keys Euler + FK): ArpSyncClips
       đã xử lý mirror keyframe qua editClip — dùng nó khi có; nếu
       chưa load sync thì dùng ArpAnimMirror.mirrorKeys trực tiếp và
       đăng ký keys đã mirror (phát được qua Keyframe.tick). Các phép
       khác trên keyframe vẫn từ chối như cũ. */
    if (op === 'mirror' && (entry.source === 'keyframe' || (entry.keys && entry.keys.length))) {
      var SC = (window.PixiStudio && window.PixiStudio.ArpSyncClips) || null;
      if (SC && typeof SC.editClip === 'function') {
        try {
          var sr = SC.editClip(entry.id, 'mirror', { name: (opts.name || (entry.name + '_mirror')).trim() });
          if (sr && sr.ok) return { ok: true, id: sr.id, name: sr.name, duration: sr.duration, op: op, note: 'Mirror keyframe (Euler + FK giữ nguyên).', via: 'sync' };
        } catch (e) {}
      }
      var AM2 = (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.ArpAnimMirror) || null;
      var keys = entry.keys || (getKeyframe() && getKeyframe().clip && getKeyframe().clip.keys) || null;
      if (AM2 && keys) {
        var kr = AM2.mirrorKeyframeClip({ name: entry.name, duration: entry.duration, fps: entry.fps || DEFAULT_FPS, loop: entry.loop, keys: keys });
        if (kr.ok) {
          var kname = (opts.name || (entry.name + '_mirror')).trim();
          var ksaved = registerClip({ name: kname, keys: kr.clip.keys, duration: kr.clip.duration, fps: kr.clip.fps, loop: kr.clip.loop, source: 'user', userCreated: true });
          if (!ksaved.ok) return ksaved;
          emitAnimatorClipChanged('clip-edited', { name: kname, op: op, source: 'keyframe', duration: ksaved.duration, id: ksaved.id });
          return { ok: true, id: ksaved.id, name: kname, duration: ksaved.duration, op: op, note: 'Mirror keyframe (Euler + FK giữ nguyên).', via: 'anim-mirror' };
        }
        return kr;
      }
      return { ok: false, error: 'Clip keyframe chưa mirror được — cần ArpSyncClips hoặc ArpAnimMirror.' };
    }
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
    emitAnimatorClipChanged('clip-edited', { name: name, op: op, source: entry.source, duration: saved.duration, id: saved.id });
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
    emitAnimatorClipChanged('clip-deleted', { name: name, id: id });
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
  function addEvent(name, t, clipId, opts) {
    clipId = clipId || Animator.currentId;
    if (!clipId) return { ok: false, error: 'Chưa chọn clip.' };
    name = String(name || '').trim();
    if (!name) return { ok: false, error: 'Nhập tên event (vd "bước chân").' };
    var entry = getClip(clipId);
    if (!entry) return { ok: false, error: 'Không tìm thấy clip.' };
    if (t === undefined || t === null) t = Animator.time;
    t = clamp(parseFloat(t) || 0, 0, entry.duration);
    opts = opts || {};
    var action = EVENT_ACTIONS.indexOf(opts.action) >= 0 ? opts.action : 'none';
    var params = (opts.params && typeof opts.params === 'object') ? opts.params : {};
    if (action === 'damage' && !(parseFloat(params.amount) > 0)) params = Object.assign({}, params, { amount: 10 });
    if (action === 'sound' && !params.url && !(parseFloat(params.freq) > 0)) params = Object.assign({}, params, { freq: 880, dur: 0.15 });
    if (!Animator.events[clipId]) Animator.events[clipId] = [];
    var ev = { id: 'ev_' + (++Animator._evSeq), t: round3(t), name: name, action: action, params: params, bone: opts.bone || params.bone || null };
    Animator.events[clipId].push(ev);
    Animator.events[clipId].sort(function (a, b) { return a.t - b.t; });
    return { ok: true, event: ev, clipId: clipId };
  }
  /* Sửa event đã có (đổi tên/thời gian/action/tham số). patch.params
     được merge vào params cũ (không ghi đè hẳn). */
  function updateEvent(clipId, eventId, patch) {
    var list = Animator.events[clipId] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === eventId) {
        var ev = normalizeEvent(list[i]);
        patch = patch || {};
        if (patch.name !== undefined) {
          var nm = String(patch.name || '').trim();
          if (!nm) return { ok: false, error: 'Tên event không được rỗng.' };
          ev.name = nm;
        }
        if (patch.t !== undefined) {
          var entry = getClip(clipId);
          ev.t = clamp(parseFloat(patch.t) || 0, 0, entry ? entry.duration : ev.t);
          ev.t = round3(ev.t);
        }
        if (patch.action !== undefined) {
          if (EVENT_ACTIONS.indexOf(patch.action) < 0) return { ok: false, error: 'Action không biết: ' + patch.action };
          ev.action = patch.action;
        }
        if (patch.params && typeof patch.params === 'object') {
          ev.params = Object.assign({}, ev.params, patch.params);
        }
        if (patch.bone !== undefined) ev.bone = patch.bone || null;
        list[i] = ev;
        list.sort(function (a, b) { return a.t - b.t; });
        return { ok: true, event: ev, clipId: clipId };
      }
    }
    return { ok: false, error: 'Không tìm thấy event.' };
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
    return (Animator.events[clipId || Animator.currentId] || []).map(function (ev) { return normalizeEvent(ev); });
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
    /* Clip keyframe: dùng exporter có sẵn của Keyframe (đúng format).
       Chuyển tiếp tuỳ chọn nén từ UI Animator (checkbox nén). */
    if (entry.source === 'keyframe') {
      var KF = getKeyframe();
      if (!KF || typeof KF.exportClip !== 'function') return { ok: false, error: 'Keyframe chưa load.' };
      var kr = KF.exportClip({ download: false, compress: opts.compress, posEpsMm: opts.posEpsMm, rotEpsDeg: opts.rotEpsDeg, quantize: opts.quantize });
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
    /* NÉN (nhóm D — arp-anim-compression.js): chỉ khi opts.compress
       === true (UI Animator truyền rõ từ checkbox, mặc định BẬT;
       gọi API không truyền gì thì KHÔNG nén để file cũ byte-identical).
       Format JSON giữ nguyên v1 + cờ compressed + khối compression
       (không dùng '-2' — đã bị Animation Layers chiếm cho layers). */
    var compStats = null, bytesBefore = null, bytesAfter = null;
    if (opts.compress === true) {
      var AC = PS.ArpAnimCompression;
      if (AC && typeof AC.compressPlainTracks === 'function') {
        var cOpts = { posEpsMm: opts.posEpsMm, rotEpsDeg: opts.rotEpsDeg, posEps: opts.posEps, quantize: opts.quantize };
        var origTracks = tracks;
        bytesBefore = AC.bytesOfJSON(origTracks);
        var c = AC.compressPlainTracks(tracks, cOpts);
        bytesAfter = AC.bytesOfJSON(c.tracks);
        var dev = AC.measureDeviation({ duration: entry.duration, tracks: origTracks }, { duration: entry.duration, tracks: c.tracks }, cOpts);
        tracks = c.tracks;
        compStats = {
          keysBefore: c.keysBefore, keysAfter: c.keysAfter, dropped: c.dropped,
          keySavedPct: c.keysBefore ? Math.round((1 - c.keysAfter / c.keysBefore) * 1000) / 10 : 0,
          bytesBefore: bytesBefore, bytesAfter: bytesAfter,
          savedPct: bytesBefore ? Math.round((1 - bytesAfter / bytesBefore) * 1000) / 10 : 0,
          maxPosMm: dev.maxPosMm, maxRotDeg: dev.maxRotDeg, samples: dev.samples,
          eps: { posEpsMm: (cOpts.posEpsMm !== undefined ? cOpts.posEpsMm : null), rotEpsDeg: cOpts.rotEpsDeg }
        };
        try { console.info('[Animator] Nén JSON: ' + AC.formatStats(compStats)); } catch (e) {}
      }
    }
    var data = {
      format: FORMAT, character: 'animator',
      skeleton: { boneNames: Object.keys(getBoneMap()), boneCount: Object.keys(getBoneMap()).length },
      clips: [{
        id: slug(entry.name), name: entry.name, duration: entry.duration,
        loop: !!entry.loop, source: 'animator-' + entry.source, fps: entry.fps || DEFAULT_FPS,
        tracks: tracks,
        /* Event markers kèm action (nhóm C): file cũ không có key này
           vẫn đọc được (import coi như không có event). */
        events: listEvents(entry.id)
      }]
    };
    if (compStats) {
      data.compressed = true;
      data.compression = compStats;
      data.clips[0].compressed = true;
      data.clips[0].compression = compStats;
    }
    var text = JSON.stringify(data, null, 1);
    var filename = 'animator_' + slug(entry.name) + '_clips.json';
    if (opts.download !== false && U && typeof U.downloadText === 'function') {
      try { U.downloadText(text, filename, 'application/json'); } catch (e) {}
    }
    return { ok: true, json: data, text: text, filename: filename, format: FORMAT, trackCount: tracks.length, keyCount: tracks.length ? tracks[0].times.length : 0, compression: compStats, bytesBefore: bytesBefore, bytesAfter: bytesAfter, savedPct: compStats ? compStats.savedPct : null };
  }

  /* Nén thử clip đang chọn (chỉ tính toán, không ghi đè clip gốc):
     dùng cho nút "Nén thử" ở mục Xuất + harness đo độ lệch. */
  function compressCurrentClip(opts) {
    opts = opts || {};
    var entry = getClip(Animator.currentId);
    if (!entry) return { ok: false, error: 'Chưa chọn clip.' };
    var AC = PS.ArpAnimCompression;
    if (!AC) return { ok: false, error: 'Module nén chưa load (js/rig/arp-anim-compression.js).' };
    if (entry.source === 'keyframe') {
      var KF = getKeyframe();
      if (!KF || typeof KF.exportClip !== 'function') return { ok: false, error: 'Keyframe chưa load.' };
      var kr = KF.exportClip({ download: false, compress: true, posEpsMm: opts.posEpsMm, rotEpsDeg: opts.rotEpsDeg, quantize: opts.quantize });
      if (kr && kr.ok) Animator._lastCompression = kr.compression || null;
      return kr || { ok: false, error: 'Keyframe.exportClip không trả kết quả.' };
    }
    if (!entry.clip) return { ok: false, error: 'Clip "' + entry.name + '" không có THREE.AnimationClip để nén.' };
    var r = AC.compressClip(entry.clip, { posEpsMm: opts.posEpsMm, rotEpsDeg: opts.rotEpsDeg, posEps: opts.posEps, quantize: opts.quantize });
    if (r.ok) Animator._lastCompression = r.stats;
    return r.ok ? { ok: true, name: entry.name, stats: r.stats, clip: r.clip } : r;
  }

  /* ---------- Xuất / nhập Animation Layers (format v2) ----------
     v2 = v1 + trường layers[] + version:2. Đọc được file v1 cũ
     (không có layers → layers=[]). Clip trong file chỉ là tham
     chiếu theo tên/id — import không tự tạo clip, chỉ khôi phục
     layer nào trỏ tới clip đã có trong Animator. */
  function exportLayersJSON(opts) {
    opts = opts || {};
    var base = exportClipJSON(Animator.currentId, { download: false });
    if (!base.ok) return base;
    var AL = getAnimLayers();
    var layers = AL && typeof AL.serializeLayers === 'function'
      ? AL.serializeLayers(Animator.layers)
      : Animator.layers.map(function (l) {
          return { id: l.id, clipId: l.clipId, weight: l.weight, mask: l.mask, mode: l.mode, enabled: l.enabled };
        });
    var data = base.json;
    data.format = Animator.FORMAT2;
    data.version = 2;
    data.baseClipId = Animator.currentId;
    data.layers = layers;
    var text = JSON.stringify(data, null, 1);
    var filename = 'animator_' + slug((Animator.currentId && getClip(Animator.currentId) || {}).name || 'layers') + '_layers.json';
    if (opts.download !== false && U && typeof U.downloadText === 'function') {
      try { U.downloadText(text, filename, 'application/json'); } catch (e) {}
    }
    return { ok: true, json: data, text: text, filename: filename, format: Animator.FORMAT2, version: 2, layerCount: layers.length, trackCount: base.trackCount };
  }

  function importLayersJSON(textOrObj) {
    var data = textOrObj;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { return { ok: false, error: 'JSON không parse được: ' + (e && e.message) }; }
    }
    if (!data || typeof data !== 'object') return { ok: false, error: 'Dữ liệu import không phải object JSON.' };
    if (data.format === FORMAT) {
      /* Format cũ v1: không có layers — tương thích ngược. */
      return { ok: true, format: FORMAT, version: 1, layers: [], count: 0, note: 'File format v1 cũ (không có layers) — giữ nguyên layers hiện tại.' };
    }
    if (data.format !== Animator.FORMAT2) {
      return { ok: false, error: 'Format không nhận: ' + (data.format || '(trống)') + ' — cần ' + Animator.FORMAT2 + ' hoặc ' + FORMAT + '.' };
    }
    var AL = getAnimLayers();
    var parsed = AL && typeof AL.parseLayers === 'function'
      ? AL.parseLayers(data.layers || [])
      : { ok: true, layers: (data.layers || []).filter(function (l) { return l && l.clipId; }), skipped: [] };
    if (!parsed.ok) return parsed;
    var kept = [], dropped = [];
    parsed.layers.forEach(function (l) {
      var entry = getClip(l.clipId);
      if (!entry || !entry.clip) { dropped.push(l.clipId); return; }
      kept.push(l);
    });
    clearLayers();
    kept.forEach(function (l) { Animator.layers.push(l); });
    syncLayerActions();
    return { ok: true, format: Animator.FORMAT2, version: 2, layers: listLayers(), count: kept.length,
      dropped: dropped, note: dropped.length ? ('Bỏ ' + dropped.length + ' layer vì clip không có trong Animator: ' + dropped.join(', ')) : '' };
  }

  /* ---------- Curve Editor: mở từ clip đang chọn ---------- */
  function openCurveEditor(container, opts) {
    opts = opts || {};
    var AC = PS.AnimCurves;
    if (!AC || typeof AC.openEditor !== 'function') {
      return { ok: false, error: 'AnimCurves chưa load (js/animation/anim-curves.js).' };
    }
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (!entry) return { ok: false, error: 'Chưa chọn clip.' };
    if (!entry.clip) return { ok: false, error: 'Clip "' + entry.name + '" không có THREE.AnimationClip — autogen/keyframe mở bằng AnimCurves.fromKeyframeClip trước.' };
    var target = container || Animator._bodyEl;
    if (!target) return { ok: false, error: 'Không có container để mở Curve Editor.' };
    var box = document.createElement('div');
    box.className = 'arp-anim-sec arp-curve-box';
    target.appendChild(box);
    var r = AC.openEditor(box, {
      clip: entry.clip,
      trackName: opts.trackName, axis: opts.axis,
      onApply: function (applied) {
        var saved = registerClip({ name: (entry.name || 'clip') + '_curve', clip: applied.clip, loop: entry.loop, source: 'user', userCreated: true });
        Animator._curveEdit = null;
        if (opts.onApply) opts.onApply(applied, saved);
        return saved;
      },
      onError: opts.onError
    });
    if (!r.ok) return r;
    Animator._curveEdit = r.edit;
    return { ok: true, clip: entry.name, trackCount: entry.clip.tracks.length, edit: r.edit };
  }

  /* Mở Curve Editor từ clip keyframe đã ghi: đổi sang THREE clip
     rồi chỉnh curve như clip thường (clip gốc keyframe không đổi). */
  function openCurveEditorFromKeyframe(opts) {
    opts = opts || {};
    var AC = PS.AnimCurves;
    if (!AC || typeof AC.fromKeyframeClip !== 'function') {
      return { ok: false, error: 'AnimCurves chưa load (js/animation/anim-curves.js).' };
    }
    var KF = getKeyframe();
    var kfClip = (KF && typeof KF.getClip === 'function') ? KF.getClip() : null;
    if (!kfClip || !kfClip.keys || !kfClip.keys.length) {
      return { ok: false, error: 'Chưa có clip keyframe nào được ghi.' };
    }
    var conv = AC.fromKeyframeClip(kfClip);
    if (!conv.ok) return conv;
    var saved = registerClip({ name: (kfClip.name || 'keyframe') + '_curve_src', clip: conv.clip, loop: !!kfClip.loop, source: 'user', userCreated: true });
    if (!saved.ok) return saved;
    Animator.currentId = saved.id;
    return openCurveEditor(opts.container, opts);
  }

  /* Nhập clip từ JSON do exportClipJSON xuất (nhóm C): đọc được file
     cũ (không có events, không có layers) — event thiếu action thì
     coi là 'none'. Track nén (compressed) thì giải nén trước khi
     dựng clip (qua ArpAnimCompression nếu có). */
  function importClipJSON(text, opts) {
    opts = opts || {};
    if (!window.THREE) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var data;
    try { data = typeof text === 'string' ? JSON.parse(text) : text; }
    catch (e) { return { ok: false, error: 'JSON không parse được: ' + (e && e.message) }; }
    if (!data || typeof data.format !== 'string' || data.format.indexOf('pixistudio-animator-clips-') !== 0) {
      return { ok: false, error: 'Không phải file clip Animator (format pixistudio-animator-clips-*).' };
    }
    if (!Array.isArray(data.clips) || !data.clips.length) return { ok: false, error: 'File không có clip nào.' };
    var imported = [];
    for (var ci = 0; ci < data.clips.length; ci++) {
      var c = data.clips[ci];
      if (!c || !Array.isArray(c.tracks) || !c.tracks.length) continue;
      var plainTracks = c.tracks;
      if (c.compressed && PS.ArpAnimCompression && typeof PS.ArpAnimCompression.decompressPlainTracks === 'function') {
        try { plainTracks = PS.ArpAnimCompression.decompressPlainTracks(c.tracks, c.compression); } catch (e) {}
      }
      var tracks = [];
      var bad = false;
      for (var ti = 0; ti < plainTracks.length; ti++) {
        var t = plainTracks[ti];
        if (!t || !t.name || !Array.isArray(t.times) || !Array.isArray(t.values)) { bad = true; break; }
        try {
          if (/\.quaternion$/i.test(t.name)) tracks.push(new window.THREE.QuaternionKeyframeTrack(t.name, t.times, t.values));
          else tracks.push(new window.THREE.VectorKeyframeTrack(t.name, t.times, t.values));
        } catch (e) { bad = true; break; }
      }
      if (bad || !tracks.length) continue;
      var clip = new window.THREE.AnimationClip(c.name || ('imported_' + ci), c.duration || 0, tracks);
      var saved = registerClip({ name: clip.name, clip: clip, fps: c.fps || DEFAULT_FPS, loop: c.loop !== false, source: 'user', userCreated: true });
      if (!saved.ok) continue;
      /* Nhập lại cùng clip thì events cũ bị thay bằng events trong
         file (không cộng dồn với lần nhập trước). */
      Animator.events[saved.id] = [];
      var nEv = 0;
      (c.events || []).forEach(function (evRaw) {
        if (!evRaw || !evRaw.name) return;
        var r = addEvent(evRaw.name, evRaw.t || 0, saved.id, { action: evRaw.action, params: evRaw.params, bone: evRaw.bone });
        if (r.ok) {
          nEv++;
          if (evRaw.id) { /* giữ id gốc để file export lại ổn định */
            var list = Animator.events[saved.id];
            for (var k = 0; k < list.length; k++) if (list[k].id === r.event.id) list[k].id = evRaw.id;
            var m = /^ev_(\d+)$/.exec(evRaw.id);
            if (m) Animator._evSeq = Math.max(Animator._evSeq, parseInt(m[1], 10));
          }
        }
      });
      imported.push({ id: saved.id, name: clip.name, duration: round3(clip.duration), events: nEv });
    }
    if (!imported.length) return { ok: false, error: 'Không nhập được clip nào (track lỗi?).' };
    return { ok: true, imported: imported, count: imported.length, format: data.format };
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
  /* Đường root motion WORLD (nhóm C): toàn bộ quỹ đạo XZ của clip
     (65 mẫu), bắt đầu tại vị trí model root HIỆN TẠI, delta Hips
     xoay theo hướng mặt hiện tại của model. Vẽ lại mỗi tick khi
     đang phát để đường đi theo nhân vật. + marker vàng = vị trí
     model root hiện tại. Clip không có track Hips → báo rõ. */
  function drawRootPath() {
    var line = Animator._rootPathLine;
    var marker = Animator._rootMarker;
    function removeAll() {
      if (line && line.parent) { try { line.parent.remove(line); } catch (e) {} }
      if (marker && marker.parent) { try { marker.parent.remove(marker); } catch (e) {} }
      Animator._rootPathLine = null;
      Animator._rootMarker = null;
    }
    if (!Animator.display.rootPath) { removeAll(); return { ok: true, shown: false }; }
    if (!window.THREE) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var scene = getScene();
    if (!scene) return { ok: false, error: 'Không tìm thấy scene viewport.' };
    var entry = Animator.currentId ? getClip(Animator.currentId) : null;
    if (!entry || !entry.clip || !findHipsTrack(entry.clip)) {
      removeAll();
      return { ok: false, error: 'Clip hiện tại không có track Hips.position — không vẽ được đường root.' };
    }
    try {
      var root = getModelRoot();
      var origin = modelRootWorldPos() || { x: 0, y: 0, z: 0 };
      /* Hướng mặt của model (yaw world) để xoay delta Hips. */
      var yawQ = new window.THREE.Quaternion();
      if (root) { try { root.getWorldQuaternion(yawQ); } catch (e) {} }
      var full = rootPathFor(entry.clip, 65);
      var pts = [];
      var px = 0, pz = 0;
      var p0 = full.length ? full[0] : { x: 0, z: 0 };
      full.forEach(function (p, i) {
        var dx = p.x - p0.x, dz = p.z - p0.z;
        if (i === 0) { px = 0; pz = 0; }
        else {
          var v = new window.THREE.Vector3(dx, 0, dz).applyQuaternion(yawQ);
          px = v.x; pz = v.z;
        }
        pts.push(new window.THREE.Vector3(origin.x + px, origin.y, origin.z + pz));
      });
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
      /* Marker vị trí hiện tại (cập nhật mỗi lần vẽ). */
      if (!marker) {
        marker = new window.THREE.Mesh(
          new window.THREE.SphereGeometry(0.05, 12, 8),
          new window.THREE.MeshBasicMaterial({ color: 0xffd23e })
        );
        marker.name = '__arp_anim_rootmarker__';
        marker.userData.isBoneVisual = true;
        Animator._rootMarker = marker;
      }
      marker.position.set(origin.x, origin.y + 0.05, origin.z);
      if (!marker.parent) scene.add(marker);
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
        /* Nhóm C: vị trí world của model root + quãng đường đã đi. */
        var mrSpan = document.getElementById('arp-anim-modelroot-pos');
        if (mrSpan) mrSpan.textContent = 'Model root (world): (' + Animator.modelRootPos.x.toFixed(3) + ', ' + Animator.modelRootPos.y.toFixed(3) + ', ' + Animator.modelRootPos.z.toFixed(3) + ') · đã đi ' + Animator.rootMotionTravelled.toFixed(3) + 'm';
        updateDemoHpUI();
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
    _bindTargetSync(); /* VÒNG ĐỒNG BỘ: wire setTarget (bus có thể chưa sẵn lúc load) */
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
      el('div', { class: 'arp-note', text: 'Retiming giữ nguyên số key gốc. Mirror đúng qua YZ: đổi cặp Left/Right + quat (x,−y,−z,w) / vị trí (−x,y,z); clip keyframe cũng mirror được.' })
    ]));

    /* --- 5. Root motion (THẬT — di chuyển model trong world) --- */
    var rmChk = el('input', { type: 'checkbox' });
    rmChk.checked = Animator.rootMotion;
    rmChk.addEventListener('change', function () {
      setRootMotion(rmChk.checked);
      say(rmChk.checked ? 'Root motion BẬT — nhân vật ĐI trong scene theo Hips XZ của clip (Hips XZ khóa về bind, Y giữ theo clip).' : 'Root motion TẮT — Hips khóa ở vị trí bind, nhân vật chạy tại chỗ.');
      updateReadout();
    });
    var rootPosSpan = el('span', { id: 'arp-anim-rootpos', text: 'Root: (0, 0, 0)' });
    var modelRootSpan = el('span', { id: 'arp-anim-modelroot-pos', text: 'Model root (world): (0, 0, 0) · đã đi 0.000m' });
    var rmResetBtn = el('button', { class: 'arp-btn arp-btn-sm', text: '↺ Reset vị trí' });
    rmResetBtn.addEventListener('click', function () {
      var r = resetRootPosition();
      say(r.ok ? ('Đã đưa nhân vật về điểm bắt đầu phiên phát (' + r.position.x.toFixed(2) + ', ' + r.position.y.toFixed(2) + ', ' + r.position.z.toFixed(2) + ').') : ('Lỗi: ' + r.error), r.ok);
      updateReadout();
    });
    var rmResetAbsBtn = el('button', { class: 'arp-btn arp-btn-sm', text: '⌂ Về gốc (0,0,0)' });
    rmResetAbsBtn.addEventListener('click', function () {
      var r = resetRootPosition({ absolute: true });
      say(r.ok ? 'Đã đưa nhân vật về gốc tuyệt đối (0, 0, 0).' : ('Lỗi: ' + r.error), r.ok);
      updateReadout();
    });
    container.appendChild(el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '5 · Root motion' }),
      el('div', { class: 'arp-row' }, [rmChk, el('span', { text: 'Di chuyển nhân vật trong world theo Hips của clip' })]),
      el('div', { class: 'arp-row' }, [rootPosSpan]),
      el('div', { class: 'arp-row' }, [modelRootSpan]),
      el('div', { class: 'arp-row' }, [rmResetBtn, rmResetAbsBtn]),
      el('div', { class: 'arp-note', text: 'BẬT: delta XZ của Hips cộng dồn vào model root, loop tiếp tục đi, đổi clip giữ vị trí. TẮT: chạy tại chỗ. Đường root: bật "Đường root" ở mục 9 (vẽ toàn bộ quỹ đạo từ vị trí hiện tại + marker vàng). Lưu ý: clip Thiếu Lâm (Idle/Run/Attack/Punch) là clip tại chỗ — Hips XZ không đổi nên model đứng yên là đúng; cần clip có Hips XZ di chuyển thật mới thấy nhân vật đi tới.' })
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

    /* --- 6b. Animation Layers (Base + N layer) --- */
    var AL = (window.PixiStudio && window.PixiStudio.AnimLayers) || null;
    var maskNames = (AL && AL.MASK_NAMES) || ['ALL', 'UPPER_BODY', 'LOWER_BODY', 'LEFT_ARM', 'RIGHT_ARM', 'TORSO', 'LEGS', 'HEAD'];
    var maskLabels = (AL && AL.MASK_LABELS) || {};
    var layersBox = el('div', { class: 'arp-anim-layers' });
    var layerClipSel = el('select', { class: 'arp-select' });
    var layerMaskSel = el('select', { class: 'arp-select' });
    maskNames.forEach(function (m) {
      layerMaskSel.appendChild(el('option', { value: m, text: (maskLabels[m] || m) }));
    });
    layerMaskSel.value = 'RIGHT_ARM';
    var layerModeSel = el('select', { class: 'arp-select' });
    layerModeSel.appendChild(el('option', { value: 'override', text: 'Override (ghi đè mask)' }));
    layerModeSel.appendChild(el('option', { value: 'additive', text: 'Additive (cộng thêm)' }));
    listClips().forEach(function (c) {
      if (c.clip) layerClipSel.appendChild(el('option', { value: c.id, text: c.name }));
    });
    function renderLayers() {
      layersBox.innerHTML = '';
      var layers = listLayers();
      if (!layers.length) {
        layersBox.appendChild(el('div', { class: 'arp-note', text: 'Chưa có layer — thêm layer để phát nhiều clip cùng lúc (vd Base Run + layer Attack mask tay phải).' }));
        return;
      }
      layers.forEach(function (l, idx) {
        var clipName = (getClip(l.clipId) || {}).name || l.clipId;
        var row = el('div', { class: 'arp-anim-layer' });
        var chk = el('input', { type: 'checkbox' });
        chk.checked = l.enabled !== false;
        chk.addEventListener('change', function () { updateLayer(l.id, { enabled: chk.checked }); render(container); });
        var wSlider = el('input', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(l.weight * 100)), style: { flex: '1' } });
        var wVal = el('span', { text: Math.round(l.weight * 100) + '%' });
        wSlider.addEventListener('input', function () {
          wVal.textContent = wSlider.value + '%';
          updateLayer(l.id, { weight: parseInt(wSlider.value, 10) / 100 });
        });
        var mSel = el('select', { class: 'arp-select' });
        maskNames.forEach(function (m) { mSel.appendChild(el('option', { value: m, text: (maskLabels[m] || m) })); });
        mSel.value = l.mask;
        mSel.addEventListener('change', function () { updateLayer(l.id, { mask: mSel.value }); });
        var modeSel = el('select', { class: 'arp-select' });
        modeSel.appendChild(el('option', { value: 'override', text: 'Override' }));
        modeSel.appendChild(el('option', { value: 'additive', text: 'Additive' }));
        modeSel.value = l.mode;
        modeSel.addEventListener('change', function () { updateLayer(l.id, { mode: modeSel.value }); });
        var upBtn = el('button', { class: 'arp-btn arp-btn-sm', text: '↑' });
        upBtn.addEventListener('click', function () { moveLayer(l.id, -1); render(container); });
        var dnBtn = el('button', { class: 'arp-btn arp-btn-sm', text: '↓' });
        dnBtn.addEventListener('click', function () { moveLayer(l.id, 1); render(container); });
        var delL = el('button', { class: 'arp-btn arp-btn-sm', text: '✕' });
        delL.addEventListener('click', function () { removeLayer(l.id); render(container); });
        row.appendChild(chk);
        row.appendChild(el('b', { text: (idx + 1) + '. ' + clipName }));
        row.appendChild(mSel);
        row.appendChild(modeSel);
        row.appendChild(wSlider);
        row.appendChild(wVal);
        row.appendChild(upBtn);
        row.appendChild(dnBtn);
        row.appendChild(delL);
        layersBox.appendChild(row);
      });
    }
    var addLayerBtn = el('button', { class: 'arp-btn', text: '+ Thêm layer' });
    addLayerBtn.addEventListener('click', function () {
      var r = addLayer(layerClipSel.value, { mask: layerMaskSel.value, mode: layerModeSel.value, weight: 1 });
      say(r.ok ? ('Đã thêm layer "' + (getClip(layerClipSel.value) || {}).name + '" mask ' + layerMaskSel.value + ' (' + layerModeSel.value + ').') : ('Lỗi: ' + r.error), r.ok);
      render(container);
    });
    var expLayersBtn = el('button', { class: 'arp-btn', text: '⬇ Xuất layers JSON (v2)' });
    expLayersBtn.addEventListener('click', function () {
      var r = exportLayersJSON();
      say(r.ok ? ('Đã xuất layers JSON v2: ' + r.filename + ' (' + r.layerCount + ' layer).') : ('Lỗi: ' + r.error), r.ok);
    });
    var impLayersInput = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    impLayersInput.addEventListener('change', function () {
      var f = impLayersInput.files && impLayersInput.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var r = importLayersJSON(String(rd.result || ''));
        say(r.ok ? ('Đã nhập ' + r.count + ' layer (format ' + r.format + ').' + (r.note ? ' ' + r.note : '')) : ('Lỗi: ' + r.error), r.ok);
        render(container);
      };
      rd.readAsText(f);
    });
    var impLayersBtn = el('button', { class: 'arp-btn', text: '⬆ Nhập layers JSON' });
    impLayersBtn.addEventListener('click', function () { impLayersInput.click(); });
    container.appendChild(el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '6b · Animation Layers — Base + N layer' }),
      el('div', { class: 'arp-row' }, [el('span', { text: 'Base: ' }), el('b', { text: (Animator.currentId && getClip(Animator.currentId) ? getClip(Animator.currentId).name : '—') })]),
      layersBox,
      el('div', { class: 'arp-row' }, [layerClipSel, layerMaskSel, layerModeSel, addLayerBtn]),
      el('div', { class: 'arp-row' }, [expLayersBtn, impLayersBtn, impLayersInput]),
      el('div', { class: 'arp-note', text: 'Override: layer ghi đè xương trong mask (vd Run + Attack mask tay phải = vừa chạy vừa vung tay). Additive: cộng delta rotation. Weight 0 = layer không ảnh hưởng. Đọc được cả file JSON v1 cũ.' })
    ]));
    renderLayers();

    /* --- 6c. Curve Editor --- */
    var curveBox = el('div', { class: 'arp-anim-curvebox' });
    var curveOpenBtn = el('button', { class: 'arp-btn', text: '📈 Mở Curve Editor cho clip đang chọn' });
    curveOpenBtn.addEventListener('click', function () {
      var r = openCurveEditor(curveBox);
      say(r.ok ? ('Curve Editor đã mở cho "' + r.clip + '" (' + r.trackCount + ' tracks) — chọn track/trục, đổi interp từng đoạn, bấm Áp dụng để lưu clip mới.') : ('Lỗi: ' + r.error), r.ok);
    });
    var curveKfBtn = el('button', { class: 'arp-btn', text: '📈 Curve Editor từ clip keyframe' });
    curveKfBtn.addEventListener('click', function () {
      var r = openCurveEditorFromKeyframe({ container: curveBox });
      say(r.ok ? ('Curve Editor đã mở từ clip keyframe ("' + r.clip + '").') : ('Lỗi: ' + r.error), r.ok);
    });
    container.appendChild(el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '6c · Curve Editor (đường cong keyframe)' }),
      el('div', { class: 'arp-row' }, [curveOpenBtn, curveKfBtn]),
      curveBox,
      el('div', { class: 'arp-note', text: 'Mỗi đoạn key có interpolation riêng: linear / bezier (handle kéo được) / ease-in / ease-out / ease-in-out / step. Áp dụng bake easing thành clip mới — clip gốc không đổi.' })
    ]));

    /* --- 7. Event markers (CÓ ACTION THẬT) --- */
    var evName = el('input', { type: 'text', class: 'arp-input', placeholder: 'Tên event, vd "bước chân", "đánh"' });
    var evTime = el('input', { type: 'number', class: 'arp-input', min: '0', step: '0.05', value: Animator.time.toFixed(2), style: { width: '80px' } });
    var evActionSel = el('select', { class: 'arp-select' });
    [['none', 'Chỉ báo (notify + log)'], ['sound', '🔊 Phát sound'], ['damage', '💥 Gây damage'], ['effect', '✨ Hiệu ứng tại xương'], ['custom', '⚙ Custom callback']].forEach(function (pair) {
      evActionSel.appendChild(el('option', { value: pair[0], text: pair[1] }));
    });
    /* Tham số theo từng loại action. */
    var evParamBox = el('div', { class: 'arp-row' });
    var evSoundFile = el('input', { type: 'file', accept: 'audio/*', class: 'arp-input', style: { flex: '1' } });
    var evSoundFreq = el('input', { type: 'number', class: 'arp-input', min: '100', max: '4000', step: '10', value: '880', style: { width: '80px' } });
    var evSoundDur = el('input', { type: 'number', class: 'arp-input', min: '0.05', max: '2', step: '0.05', value: '0.15', style: { width: '70px' } });
    var evSoundUrl = null; /* object URL của file user chọn (không lưu qua lần tải trang) */
    evSoundFile.addEventListener('change', function () {
      var f = evSoundFile.files && evSoundFile.files[0];
      if (f && typeof URL !== 'undefined' && URL.createObjectURL) {
        try { if (evSoundUrl) URL.revokeObjectURL(evSoundUrl); } catch (e) {}
        evSoundUrl = URL.createObjectURL(f);
        say('Đã chọn file âm thanh "' + f.name + '" — sẽ phát khi event kích hoạt.');
      }
    });
    var evDmgAmount = el('input', { type: 'number', class: 'arp-input', min: '1', max: '999', step: '1', value: '10', style: { width: '70px' } });
    var evDmgTarget = el('input', { type: 'text', class: 'arp-input', placeholder: 'Mục tiêu, vd "enemy"', value: 'enemy', style: { width: '110px' } });
    var evFxBone = el('input', { type: 'text', class: 'arp-input', placeholder: 'Xương, vd RightHand', value: 'RightHand', style: { width: '110px' } });
    var evFxColor = el('input', { type: 'color', class: 'arp-input', value: '#ffd23e', style: { width: '50px' } });
    var evFxKind = el('select', { class: 'arp-select' });
    [['flash', 'Flash (chớp sáng)'], ['burst', 'Burst (nổ hạt 2D nếu có)']].forEach(function (pair) {
      evFxKind.appendChild(el('option', { value: pair[0], text: pair[1] }));
    });
    function renderEvParams() {
      evParamBox.innerHTML = '';
      var a = evActionSel.value;
      if (a === 'sound') {
        evParamBox.appendChild(el('span', { text: 'File mp3/wav (không chọn = beep):' }));
        evParamBox.appendChild(evSoundFile);
        evParamBox.appendChild(el('span', { text: 'Beep Hz:' }));
        evParamBox.appendChild(evSoundFreq);
        evParamBox.appendChild(el('span', { text: 'giây:' }));
        evParamBox.appendChild(evSoundDur);
      } else if (a === 'damage') {
        evParamBox.appendChild(el('span', { text: 'Damage:' }));
        evParamBox.appendChild(evDmgAmount);
        evParamBox.appendChild(el('span', { text: 'Mục tiêu:' }));
        evParamBox.appendChild(evDmgTarget);
      } else if (a === 'effect') {
        evParamBox.appendChild(el('span', { text: 'Xương:' }));
        evParamBox.appendChild(evFxBone);
        evParamBox.appendChild(evFxKind);
        evParamBox.appendChild(evFxColor);
      } else if (a === 'custom') {
        evParamBox.appendChild(el('div', { class: 'arp-note', text: 'Đăng ký hàm bằng API: ArpAnimator.onEvent("tên event", function (rec, ev) { … }) — gọi khi event kích hoạt.' }));
      } else {
        evParamBox.appendChild(el('div', { class: 'arp-note', text: 'Chỉ notify + ghi log + phát bus animator:event (hành vi cũ).' }));
      }
    }
    evActionSel.addEventListener('change', renderEvParams);
    renderEvParams();
    var evList = el('div', { class: 'arp-anim-evlist' });
    var firedList = el('div', { class: 'arp-anim-evlist' });
    var hpSpan = el('span', { id: 'arp-anim-demo-hp', text: 'HP demo: ' + Animator.demoHp + '/' + Animator.demoHpMax });
    var evEditingId = null;
    function evParamsFromForm() {
      var a = evActionSel.value;
      if (a === 'sound') return { url: evSoundUrl || undefined, freq: parseFloat(evSoundFreq.value) || 880, dur: parseFloat(evSoundDur.value) || 0.15 };
      if (a === 'damage') return { amount: parseFloat(evDmgAmount.value) || 10, target: evDmgTarget.value || 'enemy' };
      if (a === 'effect') return { bone: evFxBone.value || 'Hips', kind: evFxKind.value, color: parseInt(String(evFxColor.value || '#ffd23e').replace('#', ''), 16) };
      return {};
    }
    function evActionLabel(ev) {
      if (ev.action === 'sound') return '🔊 ' + (ev.params.url ? 'file' : 'beep ' + (ev.params.freq || 880) + 'Hz');
      if (ev.action === 'damage') return '💥 −' + (ev.params.amount || 0) + ' → ' + (ev.params.target || 'enemy');
      if (ev.action === 'effect') return '✨ ' + (ev.params.kind || 'flash') + ' @ ' + (ev.bone || ev.params.bone || 'Hips');
      if (ev.action === 'custom') return '⚙ onEvent("' + ev.name + '")';
      return '· notify';
    }
    function renderEvents() {
      evList.innerHTML = '';
      var evs = listEvents();
      if (!evs.length) evList.appendChild(el('div', { class: 'arp-note', text: 'Chưa có event cho clip này.' }));
      evs.forEach(function (ev) {
        var row = el('div', { class: 'arp-row' }, [
          el('span', { text: '● ' + ev.t.toFixed(2) + 's — ' + ev.name + '  [' + evActionLabel(ev) + ']' }),
          el('button', { class: 'arp-btn arp-btn-sm', text: '✎', onclick: function () {
            evEditingId = ev.id;
            evName.value = ev.name;
            evTime.value = String(ev.t);
            evActionSel.value = ev.action || 'none';
            if (ev.action === 'damage') { evDmgAmount.value = String((ev.params || {}).amount || 10); evDmgTarget.value = (ev.params || {}).target || 'enemy'; }
            if (ev.action === 'effect') { evFxBone.value = ev.bone || (ev.params || {}).bone || 'Hips'; }
            if (ev.action === 'sound') { evSoundFreq.value = String((ev.params || {}).freq || 880); evSoundDur.value = String((ev.params || {}).dur || 0.15); }
            renderEvParams();
            evAddBtn.textContent = '💾 Lưu thay đổi';
            say('Đang sửa event "' + ev.name + '" — đổi xong bấm "Lưu thay đổi".');
          } }),
          el('button', { class: 'arp-btn arp-btn-sm', text: '✕', onclick: function () { deleteEvent(Animator.currentId, ev.id); renderEvents(); } })
        ]);
        evList.appendChild(row);
      });
      firedList.innerHTML = '';
      if (!Animator.firedLog.length) firedList.appendChild(el('div', { class: 'arp-note', text: 'Chưa event nào kích hoạt trong lần phát này.' }));
      Animator.firedLog.forEach(function (f) {
        var res = '';
        if (f.result) {
          if (f.action === 'damage') res = ' → HP ' + f.hpAfter;
          else if (f.action === 'sound') res = ' → ' + (f.result.via || '');
          else if (f.action === 'effect') res = ' → ' + (f.result.via || '') + (f.result.via2d ? ' +2D' : '');
          else if (f.action === 'custom') res = ' → ' + (f.result.called || 0) + ' handler' + ((f.result.errors || []).length ? ' (' + f.result.errors.length + ' lỗi)' : '');
        }
        firedList.appendChild(el('div', { text: '✓ "' + f.name + '" @ ' + f.t.toFixed(2) + 's (phát tới ' + f.at.toFixed(2) + 's) [' + (f.action || 'none') + ']' + res }));
      });
      updateDemoHpUI();
    }
    var evAddBtn = el('button', { class: 'arp-btn', text: '+ Thêm event' });
    evAddBtn.addEventListener('click', function () {
      var t = parseFloat(evTime.value);
      if (isNaN(t)) t = Animator.time;
      if (evEditingId) {
        var r = updateEvent(Animator.currentId, evEditingId, { name: evName.value, t: t, action: evActionSel.value, params: evParamsFromForm() });
        say(r.ok ? ('Đã sửa event "' + r.event.name + '" @ ' + r.event.t.toFixed(2) + 's [' + r.event.action + '].') : ('Lỗi: ' + r.error), r.ok);
        if (r.ok) { evEditingId = null; evAddBtn.textContent = '+ Thêm event'; evName.value = ''; }
      } else {
        var r2 = addEvent(evName.value, t, undefined, { action: evActionSel.value, params: evParamsFromForm() });
        say(r2.ok ? ('Đã thêm event "' + r2.event.name + '" @ ' + r2.event.t.toFixed(2) + 's [' + r2.event.action + '].') : ('Lỗi: ' + r2.error), r2.ok);
        if (r2.ok) evName.value = '';
      }
      renderEvents();
    });
    var evClearBtn = el('button', { class: 'arp-btn', text: 'Xóa log đã kích hoạt' });
    evClearBtn.addEventListener('click', function () { clearFiredLog(); renderEvents(); });
    var hpResetBtn = el('button', { class: 'arp-btn arp-btn-sm', text: '↺ Reset HP' });
    hpResetBtn.addEventListener('click', function () { resetDemoHp(); renderEvents(); say('HP demo đã về ' + Animator.demoHpMax + '.'); });
    container.appendChild(el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '7 · Event markers (có action thật)' }),
      el('div', { class: 'arp-row' }, [evName, evTime, el('span', { text: 'giây' })]),
      el('div', { class: 'arp-row' }, [el('span', { text: 'Action:' }), evActionSel]),
      evParamBox,
      el('div', { class: 'arp-row' }, [evAddBtn]),
      evList,
      el('div', { class: 'arp-row' }, [hpSpan, hpResetBtn]),
      el('div', { class: 'arp-note', text: 'Event chỉ kích hoạt khi PHÁT qua frame đó — kéo scrub/step qua nhanh không kích hoạt. Damage trừ HP demo + phát bus animator:event {damage, target} để game logic bắt. Sound cần bấm Play 1 lần trên trình duyệt (user gesture) mới nghe được; file âm thanh chọn bằng object URL, tải lại trang thì phải chọn lại. Event lưu cùng clip khi xuất JSON (mục 8).' }),
      el('div', { class: 'arp-sec-title', text: 'Đã kích hoạt trong lần phát này' }),
      firedList, evClearBtn
    ]));
    renderEvents();

    /* --- 8. Xuất clip --- */
    var cmpDef = (PS.ArpAnimCompression && typeof PS.ArpAnimCompression.getSettings === 'function')
      ? PS.ArpAnimCompression.getSettings() : { enabled: true, posEps: 0.001, rotEpsDeg: 0.1 };
    var cmpChk = el('input', { type: 'checkbox' });
    cmpChk.checked = cmpDef.enabled !== false;   /* UI mặc định BẬT nén */
    cmpChk.title = 'Bật = xuất JSON đã nén (loại key thừa + quantize). Tắt = file gốc không nén.';
    var cmpPos = el('input', { type: 'number', min: '0.1', max: '10', step: '0.1', value: String(Math.round((cmpDef.posEps || 0.001) * 1000 * 10) / 10), style: 'width:56px;', title: 'Ngưỡng vị trí (mm) — key lệch dưới ngưỡng này thì bỏ' });
    var cmpRot = el('input', { type: 'number', min: '0.01', max: '2', step: '0.05', value: String(cmpDef.rotEpsDeg || 0.1), style: 'width:56px;', title: 'Ngưỡng xoay (độ) — key lệch dưới ngưỡng này thì bỏ' });
    var cmpStats = el('div', { class: 'arp-note', text: 'Chưa nén thử — bấm "🗜 Nén thử" để xem tỷ lệ trước khi xuất.' });
    function cmpOpts() {
      return { compress: cmpChk.checked, posEpsMm: parseFloat(cmpPos.value) || 1, rotEpsDeg: parseFloat(cmpRot.value) || 0.1 };
    }
    function cmpStatsText(r) {
      var AC = PS.ArpAnimCompression;
      if (r && r.compression && AC && typeof AC.formatStats === 'function') return 'Nén: ' + AC.formatStats(r.compression);
      if (r && r.stats && AC && typeof AC.formatStats === 'function') return 'Nén thử: ' + AC.formatStats(r.stats);
      return 'Không nén (module nén chưa load hoặc clip không nén được).';
    }
    var expJsonBtn = el('button', { class: 'arp-btn', text: '⬇ Xuất JSON' });
    expJsonBtn.addEventListener('click', function () {
      var r = exportClipJSON(undefined, cmpOpts());
      if (r.ok) cmpStats.textContent = r.compression ? cmpStatsText(r) : 'Đã xuất JSON không nén (' + r.filename + ').';
      say(r.ok ? ('Đã xuất JSON: ' + r.filename + ' (' + r.trackCount + ' tracks).' + (r.compression ? ' ' + cmpStatsText(r) : '')) : ('Lỗi: ' + r.error), r.ok);
    });
    var cmpTryBtn = el('button', { class: 'arp-btn', text: '🗜 Nén thử' });
    cmpTryBtn.addEventListener('click', function () {
      var r = compressCurrentClip(cmpOpts());
      cmpStats.textContent = r.ok ? cmpStatsText(r) : ('Nén thử lỗi: ' + r.error);
      say(r.ok ? cmpStatsText(r) : ('Nén thử lỗi: ' + r.error), r.ok);
    });
    var expFbxBtn = el('button', { class: 'arp-btn', text: '⬇ Xuất FBX (kèm skeleton)' });
    expFbxBtn.addEventListener('click', function () {
      var r = exportClipFBX();
      say(r.ok ? ('Đã xuất FBX: ' + r.filename + ' (' + r.bytes + ' B). ' + (r.note || '')) : ('Lỗi: ' + r.error), r.ok);
    });
    /* Xuất qua Export (vòng Export-sync): xuất clip đang chọn qua
       pipeline Export đầy đủ (preflight / preset / version / texture /
       lịch sử) thay vì ghi FBX trực tiếp như nút trên. */
    var expSyncBtn = el('button', { class: 'arp-btn', text: '⬇ Xuất qua Export' });
    expSyncBtn.addEventListener('click', function () {
      var ES = (window.PixiStudio && window.PixiStudio.ArpExportSync) || null;
      if (!ES || typeof ES.exportCurrentAnimatorClip !== 'function') { say('ArpExportSync chưa load — hard-refresh trang.', false); return; }
      say('Đang xuất qua pipeline Export…', true);
      ES.exportCurrentAnimatorClip().then(function (r) {
        say(r.ok ? ('Đã xuất qua Export: ' + r.filename + ' (' + (r.sizeBytes || 0) + ' B) — preflight/preset/version/texture/lịch sử đầy đủ.') : ('Lỗi: ' + (r.error || 'lỗi không rõ.')), r.ok);
      });
    });
    container.appendChild(el('div', { class: 'arp-anim-sec' }, [
      el('div', { class: 'arp-sec-title', text: '8 · Xuất clip đang chọn' }),
      el('div', { class: 'arp-row' }, [expJsonBtn, expFbxBtn, expSyncBtn, cmpTryBtn]),
      el('div', { class: 'arp-row' }, [cmpChk, el('span', { text: 'Nén khi xuất JSON' }), el('span', { text: 'ngưỡng vị trí (mm):' }), cmpPos, el('span', { text: 'xoay (°):' }), cmpRot]),
      cmpStats,
      el('div', { class: 'arp-note', text: 'JSON đúng format clip studio (tracks .quaternion/.position). FBX qua FBXBinary.write, version 7300 — FBX luôn dùng clip gốc (không nén). Nén: loại key thừa + quantize quaternion float16 / vị trí theo mm; file nén vẫn đọc được bằng import cũ (cờ compressed:true). Nút "Xuất qua Export" đi qua pipeline Export đầy đủ (preflight/preset/version/texture/lịch sử, mặc định preset Unity + FBX 7300) thay vì ghi FBX trực tiếp.' })
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
  Animator.getEntries = function(){ return Animator._clips || []; };
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
  Animator.listLayers = listLayers;
  Animator.addLayer = addLayer;
  Animator.removeLayer = removeLayer;
  Animator.updateLayer = updateLayer;
  Animator.moveLayer = moveLayer;
  Animator.clearLayers = clearLayers;
  Animator.syncLayerActions = syncLayerActions;
  Animator.syncLayerWeights = syncLayerWeights;
  Animator.applyLayerPoseAtTime = applyLayerPoseAtTime;
  Animator.exportLayersJSON = exportLayersJSON;
  Animator.importLayersJSON = importLayersJSON;
  Animator.openCurveEditor = openCurveEditor;
  Animator.openCurveEditorFromKeyframe = openCurveEditorFromKeyframe;
  Animator.trimClip = trimClip;
  Animator.retimeClip = retimeClip;
  Animator.reverseClip = reverseClip;
  Animator.mirrorClip = mirrorClip;
  Animator.editCurrentClip = editCurrentClip;
  Animator.setRootMotion = setRootMotion;
  Animator.rootPathFor = rootPathFor;
  Animator.rootPosAt = rootPosAt;
  /* Nhóm C: root motion thật + event có action */
  Animator.resetRootPosition = resetRootPosition;
  Animator.getRootMotionInfo = getRootMotionInfo;
  Animator.onEvent = onEvent;
  Animator.offEvent = offEvent;
  Animator.updateEvent = updateEvent;
  Animator.setDemoHp = setDemoHp;
  Animator.resetDemoHp = resetDemoHp;
  Animator.importClipJSON = importClipJSON;
  Animator.spawnFlash = spawnFlash;
  Animator.updateEffects = updateEffects;
  Animator.clearEffects = clearEffects;
  Animator.addEvent = addEvent;
  Animator.deleteEvent = deleteEvent;
  Animator.listEvents = listEvents;
  Animator.clearFiredLog = clearFiredLog;
  Animator.exportClipJSON = exportClipJSON;
  Animator.exportClipFBX = exportClipFBX;
  Animator.compressCurrentClip = compressCurrentClip;
  Animator.getCompressionSettings = function () {
    var AC = PS.ArpAnimCompression;
    return AC && typeof AC.getSettings === 'function' ? AC.getSettings() : null;
  };
  Animator.setCompressionSettings = function (patch) {
    var AC = PS.ArpAnimCompression;
    return AC && typeof AC.setSettings === 'function' ? AC.setSettings(patch) : null;
  };
  Animator.setDisplay = setDisplay;
  Animator.applyDisplayOnPlay = applyDisplayOnPlay;
  Animator.updateTopBones = updateTopBones;
  Animator.sampleClipPose = sampleClipPose;
  Animator.render = render;
  Animator.setTarget = function (root) {
    Animator._target = root || null;
    Animator._mixer = null;
    Animator._lastTickFrame = null; /* CLIPBIND-B: đổi model thì reset guard frame */
    Animator.time = 0; Animator.playing = false; Animator.paused = false;
    Animator.firedLog = []; Animator._firedIds = {};
    Animator._actions = {};
    Animator._currentAction = null;
    Animator._blendAction = null;
    Animator._layerActions = {};
    /* Nhóm C: đổi model thì root motion làm lại từ đầu. */
    Animator._rmOrigin = null;
    Animator._rmPrevWorld = null;
    Animator._rmNeedResync = true;
    Animator._rmHasTrack = false;
    Animator.rootMotionTravelled = 0;
    Animator.modelRootPos = { x: 0, y: 0, z: 0 };
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
    applyRootMotionTick: applyRootMotionTick,
    drawRootPath: drawRootPath,
    getBoneMap: getBoneMap,
    findHipsBone: findHipsBone,
    getModelRoot: getModelRoot,
    hipsWorldPos: hipsWorldPos,
    modelRootWorldPos: modelRootWorldPos,
    normalizeEvent: normalizeEvent,
    executeEventAction: executeEventAction
  };

  PS.ArpAnimator = Animator;

  /* VÒNG ĐỒNG BỘ SKELETON (2026-11-27): wire setTarget vào model:loaded
     / selection change ngay lúc load (render() gọi lại để chắc chắn
     khi bus chưa sẵn lúc load). */
  try { _bindTargetSync(); } catch (e) {}

  /* Đăng ký tab Animator (sau 'plugins' — panel liệt kê tab ngoài
     TAB_ORDER theo thứ tự đăng ký). Không sửa arp-panel.js. */
  try {
    var Panel = PS.ArpPanel;
    if (Panel && typeof Panel.registerTab === 'function') {
      Panel.registerTab('animator', 'Animator', render);
    }
  } catch (e) {}
})();
