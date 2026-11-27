/* ============================================================
 * rig/arp-vp-trails.js — MOTION TRAILS + ONION SKINNING TRONG
 * VIEWPORT (PHẦN 6, vòng mở rộng Viewport của Auto Rig Pro Blend)
 *
 * Vẽ vệt chuyển động của 2 cổ tay + 2 cổ chân + đầu khi clip đang
 * phát, và bóng mờ (ghost) pose ở keyframe/thời điểm trước/sau
 * TRONG LÚC clip đang phát.
 *
 * KHÔNG sửa arp-qr3-keyframe.js / arp-qr3-liveretarget.js / bất kỳ
 * module phát clip nào: module này chỉ ĐỌC trạng thái phát qua API
 * public + bus event của chúng, và tự sample pose từ clip (không
 * đụng vào mixer/action đang chạy).
 *
 * NGUỒN PHÁT ĐƯỢC HOOK (theo thứ tự ưu tiên, poll mỗi update):
 *   1. LiveRetarget (ArpQuickRig.LiveRetarget): isPlaying/getTime/
 *      getDuration; clip giải quyết theo tên qua listClips().
 *   2. Keyframe (ArpQuickRig.Keyframe): isPlaying/getTime; onion
 *      dùng đúng keyframe trước/sau qua KF._test.poseAt +
 *      KF._test.snapshotJoints (tái dùng ghost của keyframe).
 *   3. Anim (PixiStudio.Anim): Anim.current + action chưa pause;
 *      clip = entry.clip của Anim.clips.
 *   4. AnimAutoGen (PixiStudio.AnimAutoGen): currentClip + mixer
 *      action của RigAutoGen.current.
 * Ngoài ra bus event (nếu bus.on có): 'animation:played',
 * 'animation:stopped', 'anim:autogen-played', 'arpqr3:play',
 * 'arpliveretarget:play/stop/ended' — chỉ để ghi nhớ tên clip +
 * gợi ý phát/dừng, poll vẫn là nguồn chân lý.
 * Host cũng có thể điều khiển xác định bằng notePlay({clip,
 * getTime}) / noteStop() khi không muốn dựa vào poll.
 *
 * TRAILS:
 *   • 5 khớp tối đa: LeftHand/RightHand (cổ tay), LeftFoot/
 *     RightFoot (cổ chân), Head (đầu); fallback LeftWrist/
 *     RightWrist, LeftAnkle/RightAnkle nếu rig dùng tên đó.
 *   • Mỗi khớp 1 THREE.Line, N điểm gần nhất (mặc định 30, chỉnh
 *     được 2..120 — MAX_TRAIL_LENGTH=120, cap cứng chống nặng máy).
 *   • Màu theo chi, thống nhất màu gizmo (arp-qr3-gizmo.js):
 *     trái = Gizmo.COLORS.left (0x3388ff xanh dương), phải =
 *     Gizmo.COLORS.right (0xff3344 đỏ), giữa = COLORS.center
 *     (0x33cc66 xanh lá); đọc Gizmo khi có, fallback đúng 3 giá trị đó.
 *   • Gradient mờ dần về đuôi vệt bằng vertexColors (điểm mới
 *     nhất sáng nhất); điểm trùng (<0.5mm so với điểm cuối) không
 *     ghi thêm để vệt không phình khi pose đứng yên.
 *   • Dừng clip → giữ vệt fadeHold giây (mặc định 2s), rồi mờ dần
 *     trong fadeDuration (mặc định 1s), rồi xóa; setKeepOnStop(true)
 *     thì giữ nguyên tới lần phát sau / clearTrails().
 *
 * ONION SKINNING (ghost = bóng khớp, KHÔNG phải mesh mờ):
 *   • 17 khớp chính (GHOST_JOINTS, giống keyframe): sphere nhỏ mờ
 *     opacity ghostOpacity (mặc định 0.35), prev xanh dương
 *     0x33ccff / next hồng 0xff5599 (giống keyframe).
 *   • Nguồn Keyframe: ghost đúng pose key TRƯỚC / key SAU thời
 *     gian hiện tại (không phải offset cố định).
 *   • Nguồn clip THREE (LiveRetarget/Anim/AutoGen): sample clip tại
 *     t ∓ onionOffset (mặc định 0.15s mỗi bên, loop thì wrap, không
 *     loop thì kẹp) bằng slerp/lerp tự viết, áp tạm lên xương, đọc
 *     world, trả pose cũ về — không chạm mixer đang chạy.
 *   • Ghost group tạo 1 lần (17 sphere/group, geometry dùng chung),
 *     mỗi frame chỉ DỜI vị trí sphere — không tạo lại geometry.
 *
 * ĐĂNG KÝ LAYER (defensive): nếu window.PixiStudio.ArpViewport có
 * registerLayer thì gọi registerLayer('trails', layer) +
 * registerLayer('onion', layer); nếu chưa có (repo hiện tại chưa
 * có ArpViewport) thì module vẫn chạy độc lập qua API
 * showTrails()/hideTrails()/showOnion()/hideOnion()/update() để
 * toolbar/preset gọi. registerLayers() thử lại được bất cứ lúc nào
 * (ArpViewport load sau vẫn đăng ký được).
 *
 * HIỆU NĂNG: tối đa 5 trail × 120 điểm, geometry tiền cấp phát
 * (Float32Array), không tạo object mỗi frame (tái dùng temp
 * Vector3/Quaternion), ghost chỉ đổi position. update(dt) đồng bộ,
 * không dùng timer thật — host gọi mỗi frame (rAF) hoặc harness
 * gọi trực tiếp.
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Trail/onion cần rig: không có QuickRig.current hay model có
 *     xương thì update() trả {ok:false} và không crash.
 *   • Onion với clip THREE chỉ sample được track xương có tên map
 *     được về rig; track morph / tên lạ bị bỏ qua.
 *   • Ghost là bóng 17 khớp, không phải mesh nhân vật mờ; trail là
 *     THREE.Line (độ dày 1px, WebGL không hỗ trợ lineWidth > 1).
 *   • Màu gradient đuôi vệt là độ sáng vertex color, không phải
 *     alpha từng điểm (LineBasicMaterial không có alpha/điểm).
 * ============================================================ */
(function () {
  'use strict';

  var PS = window.PixiStudio || (window.PixiStudio = {});
  var bus = PS.bus || { emit: function () {}, on: function () {} };
  var U = PS.Utils || null;

  /* 5 khớp trail: cổ tay = Hand, cổ chân = Foot (Mixamo), đầu = Head */
  var TRAIL_JOINTS = ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'Head'];
  var TRAIL_FALLBACKS = {
    LeftHand: ['LeftWrist', 'LeftHand'],
    RightHand: ['RightWrist', 'RightHand'],
    LeftFoot: ['LeftAnkle', 'LeftFoot'],
    RightFoot: ['RightAnkle', 'RightFoot'],
    Head: ['Head']
  };
  /* 17 khớp ghost — giống arp-qr3-keyframe.js GHOST_JOINTS */
  var GHOST_JOINTS = ['Hips', 'Spine', 'Spine2', 'Neck', 'Head',
    'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
  var MAX_TRAIL_LENGTH = 120;
  var MIN_TRAIL_LENGTH = 2;
  var DEFAULT_TRAIL_LENGTH = 30;
  var COLOR_FALLBACK = { left: 0x3388ff, right: 0xff3344, center: 0x33cc66 };
  var GHOST_COLOR_PREV = 0x33ccff;
  var GHOST_COLOR_NEXT = 0xff5599;
  var DEDUP_EPS = 0.0005; /* <0.5mm so với điểm cuối → bỏ qua */

  var state = {
    trailsEnabled: true,
    onionEnabled: false,
    trailLength: DEFAULT_TRAIL_LENGTH,
    trailOpacity: 0.9,
    ghostOpacity: 0.35,
    onionOffset: 0.15,      /* giây mỗi bên (nguồn clip THREE) */
    onionOffsetPrev: null,  /* null = dùng onionOffset */
    onionOffsetNext: null,
    fadeHold: 2,            /* giữ vệt sau khi dừng, giây */
    fadeDuration: 1,        /* thời gian mờ dần, giây */
    keepOnStop: false,
    playing: false,
    paused: false,
    source: '',             /* 'liveretarget'|'keyframe'|'anim'|'autogen'|'manual' */
    time: 0,
    duration: 0,
    clipName: '',
    fadePhase: 'none',      /* 'none'|'hold'|'fading' */
    fadeT: 0,
    registered: false,
    registerError: ''
  };

  /* buffers + THREE objects (tạo lười khi có THREE + rig) */
  var trailPoints = {};    /* joint -> [[x,y,z],...] cũ -> mới */
  var trailLines = {};     /* joint -> {line, geometry, positions, colors, material, color} */
  var trailGroup = null;   /* THREE.Group chứa các line, gắn vào scene */
  var trailParent = null;  /* parent hiện tại của trailGroup */
  var ghostPrev = null;    /* {group, meshes:{joint:mesh}, material, joints} */
  var ghostNext = null;
  var ghostTarget = null;  /* rig target mà ghost đang gắn vào */
  var ghostJoints = { prev: null, next: null }; /* joints sample gần nhất */
  var lastGhostKey = '';   /* khóa sample ghost gần nhất, tránh làm lại */
  var wasPlaying = false;
  var hint = null;         /* {clip, getTime, duration, source} từ notePlay() */
  var hintClipName = '';   /* tên clip nhớ từ bus event (để giải quyết LR clip) */
  var cachedClip = null;   /* {name, clip} THREE clip đã giải quyết */
  var busSubscribed = false;
  var _tmpV = null, _tmpV2 = null, _tmpQ1 = null, _tmpQ2 = null;

  TRAIL_JOINTS.forEach(function (j) { trailPoints[j] = []; });

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round4(v) { return Math.round(v * 10000) / 10000; }
  function notify(type, title, message, duration) {
    try { bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 }); } catch (e) {}
  }
  function emit(ev, data) {
    try { if (bus && typeof bus.emit === 'function') bus.emit(ev, data); } catch (e) {}
  }
  function temps() {
    var T = window.THREE;
    if (!T) return false;
    if (!_tmpV) {
      _tmpV = new T.Vector3(); _tmpV2 = new T.Vector3();
      _tmpQ1 = new T.Quaternion(); _tmpQ2 = new T.Quaternion();
    }
    return true;
  }

  /* ---------- getters: rig / gizmo colors / scene ---------- */
  function getQR() { return (PS && PS.ArpQuickRig) || null; }
  function getKF() { var QR = getQR(); return (QR && QR.Keyframe) || null; }
  function getLR() { var QR = getQR(); return (QR && QR.LiveRetarget) || null; }
  function getRig() { var QR = getQR(); return (QR && QR.current) || null; }
  function getGizmoColors() {
    try {
      var QR = getQR();
      if (QR && QR.Gizmo && QR.Gizmo.COLORS) {
        var c = QR.Gizmo.COLORS;
        return { left: c.left, right: c.right, center: c.center };
      }
    } catch (e) {}
    return { left: COLOR_FALLBACK.left, right: COLOR_FALLBACK.right, center: COLOR_FALLBACK.center };
  }
  function colorForJoint(joint) {
    var c = getGizmoColors();
    if (/^Left/i.test(joint)) return c.left;
    if (/^Right/i.test(joint)) return c.right;
    return c.center;
  }
  function stripName(name) {
    var QR = getQR();
    if (QR && typeof QR.stripName === 'function') return QR.stripName(name);
    var s = String(name == null ? '' : name);
    return s.replace(/^(model:{1,2})+/i, '').replace(/^mixamorig:?/i, '').replace(/__proxy$/i, '');
  }
  function getTarget() {
    var rig = getRig();
    if (rig && rig.target) return rig.target;
    try {
      if (PS.Viewport && typeof PS.Viewport.getMainModel === 'function') return PS.Viewport.getMainModel();
    } catch (e) {}
    try {
      if (PS.Anim && PS.Anim.targetObject) return PS.Anim.targetObject;
    } catch (e) {}
    return null;
  }
  function getScene() {
    try {
      if (PS.Viewport && PS.Viewport.scene) return PS.Viewport.scene;
    } catch (e) {}
    return null;
  }
  function rigHeight() {
    var rig = getRig();
    if (rig && rig.height > 0.01) return rig.height;
    var t = getTarget();
    if (t && window.THREE) {
      try {
        var box = new window.THREE.Box3().setFromObject(t);
        var s = box.getSize(new window.THREE.Vector3());
        if (s.y > 0.01) return s.y;
      } catch (e) {}
    }
    return 1.8;
  }

  /* ---------- bone map ---------- */
  /* Trả {map:{dstLower: bone}, target} — ưu tiên QuickRig.current.bones,
     fallback duyệt target tìm Bone theo tên đã strip. */
  function buildBoneMap() {
    var rig = getRig();
    var target = getTarget();
    var map = {};
    if (rig && rig.bones) {
      Object.keys(rig.bones).forEach(function (dst) {
        if (rig.bones[dst]) map[stripName(dst).toLowerCase()] = rig.bones[dst];
      });
    }
    if (target && target.traverse) {
      target.traverse(function (o) {
        if (!o.isBone) return;
        var k = stripName(o.name).toLowerCase();
        if (!map[k]) map[k] = o;
      });
    }
    return { map: map, target: target };
  }
  function resolveTrailBones() {
    var bm = buildBoneMap();
    var out = {};
    TRAIL_JOINTS.forEach(function (joint) {
      var cands = TRAIL_FALLBACKS[joint] || [joint];
      for (var i = 0; i < cands.length; i++) {
        var b = bm.map[cands[i].toLowerCase()];
        if (b) { out[joint] = b; break; }
      }
    });
    return { bones: out, target: bm.target, found: Object.keys(out).length };
  }
  function worldPosOf(bone) {
    return new window.THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
  }

  /* ---------- trail THREE objects ---------- */
  function ensureTrailGroup() {
    if (!window.THREE) return null;
    var parent = getScene();
    if (!parent) {
      var t = getTarget();
      parent = (t && t.parent) || t || null;
    }
    if (!parent) return null;
    if (!trailGroup) {
      trailGroup = new window.THREE.Group();
      trailGroup.name = '__arp_vp_trails__';
    }
    if (trailParent !== parent) {
      try { if (trailGroup.parent) trailGroup.parent.remove(trailGroup); } catch (e) {}
      try { parent.add(trailGroup); } catch (e) { return null; }
      trailParent = parent;
    }
    return trailGroup;
  }
  function toTrailLocal(v) {
    /* điểm world -> local của parent chứa trailGroup */
    if (!trailParent || !trailParent.matrixWorld) return v;
    try {
      trailParent.updateMatrixWorld(true);
      var inv = trailParent.matrixWorld.clone().invert();
      v.applyMatrix4(inv);
    } catch (e) {}
    return v;
  }
  function ensureTrailLine(joint) {
    if (trailLines[joint]) return trailLines[joint];
    if (!window.THREE) return null;
    var T = window.THREE;
    var hex = colorForJoint(joint);
    var geo = new T.BufferGeometry();
    var positions = new Float32Array(MAX_TRAIL_LENGTH * 3);
    var colors = new Float32Array(MAX_TRAIL_LENGTH * 3);
    geo.setAttribute('position', new T.BufferAttribute(positions, 3));
    geo.setAttribute('color', new T.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);
    var mat = new T.LineBasicMaterial({
      color: 0xffffff, vertexColors: true,
      transparent: true, opacity: state.trailOpacity, depthTest: true
    });
    var line = new T.Line(geo, mat);
    line.name = '__arp_vp_trail_' + joint;
    line.userData.isBoneVisual = true; /* không nướng vào FBX/GLB export */
    line.visible = false;
    line.frustumCulled = false;
    trailLines[joint] = { line: line, geometry: geo, positions: positions, colors: colors, material: mat, hex: hex };
    return trailLines[joint];
  }
  function updateTrailLine(joint) {
    var tl = ensureTrailLine(joint);
    if (!tl) return;
    var pts = trailPoints[joint];
    var n = pts.length;
    var col = new window.THREE.Color(tl.hex);
    for (var i = 0; i < n; i++) {
      var p = pts[i];
      tl.positions[i * 3] = p[0]; tl.positions[i * 3 + 1] = p[1]; tl.positions[i * 3 + 2] = p[2];
      /* đuôi mờ (0.25) → đầu sáng (1.0) */
      var f = n <= 1 ? 1 : (0.25 + 0.75 * (i / (n - 1)));
      tl.colors[i * 3] = col.r * f; tl.colors[i * 3 + 1] = col.g * f; tl.colors[i * 3 + 2] = col.b * f;
    }
    tl.geometry.attributes.position.needsUpdate = true;
    tl.geometry.attributes.color.needsUpdate = true;
    tl.geometry.setDrawRange(0, n);
    tl.geometry.computeBoundingSphere();
    tl.line.visible = state.trailsEnabled && n >= 2 && (state.playing || state.fadePhase !== 'none');
    tl.material.opacity = state.trailOpacity * fadeOpacityFactor();
  }
  function fadeOpacityFactor() {
    if (state.fadePhase === 'fading' && state.fadeDuration > 0) {
      return clamp(1 - state.fadeT / state.fadeDuration, 0, 1);
    }
    if (state.fadePhase === 'none' && !state.playing && !state.keepOnStop) return 0;
    return 1;
  }
  function attachTrailLines() {
    var g = ensureTrailGroup();
    if (!g) return false;
    TRAIL_JOINTS.forEach(function (j) {
      var tl = ensureTrailLine(j);
      if (tl && tl.line.parent !== g) { try { g.add(tl.line); } catch (e) {} }
    });
    return true;
  }

  /* ---------- ghost THREE objects ---------- */
  function makeGhostSide(colorHex) {
    var T = window.THREE;
    var group = new T.Group();
    group.name = '__arp_vp_ghost__';
    var r = Math.max(0.012, rigHeight() * 0.012);
    var geo = new T.SphereGeometry(r, 8, 6);
    var mat = new T.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: state.ghostOpacity, depthTest: false });
    var meshes = {};
    GHOST_JOINTS.forEach(function (dst) {
      var m = new T.Mesh(geo, mat);
      m.userData.isVpTrailGhost = true;
      m.userData.isBoneVisual = true; /* không nướng vào FBX/GLB export */
      m.userData.joint = dst;
      m.visible = false;
      group.add(m);
      meshes[dst] = m;
    });
    group.visible = false;
    return { group: group, meshes: meshes, material: mat, geometry: geo };
  }
  function ensureGhosts() {
    if (!window.THREE) return false;
    if (!ghostPrev) ghostPrev = makeGhostSide(GHOST_COLOR_PREV);
    if (!ghostNext) ghostNext = makeGhostSide(GHOST_COLOR_NEXT);
    var target = getTarget();
    if (!target) return false;
    if (ghostTarget !== target) {
      [ghostPrev, ghostNext].forEach(function (g) {
        try { if (g.group.parent) g.group.parent.remove(g.group); } catch (e) {}
        try { target.add(g.group); } catch (e) {}
      });
      ghostTarget = target;
    }
    return true;
  }
  function placeGhostSide(side, joints) {
    var g = side === 'prev' ? ghostPrev : ghostNext;
    if (!g || !joints) return 0;
    var target = getTarget();
    if (!target) return 0;
    var n = 0;
    try { target.updateMatrixWorld(true); } catch (e) {}
    GHOST_JOINTS.forEach(function (dst) {
      var m = g.meshes[dst];
      if (!m) return;
      var p = joints[dst];
      if (!p) { m.visible = false; return; }
      var v = new window.THREE.Vector3(p[0], p[1], p[2]);
      try {
        var inv = target.matrixWorld.clone().invert();
        v.applyMatrix4(inv);
      } catch (e) {}
      m.position.copy(v);
      m.visible = true;
      n++;
    });
    g.material.opacity = state.ghostOpacity;
    g.group.visible = state.onionEnabled && n > 0 && state.playing;
    return n;
  }
  function hideGhosts() {
    [ghostPrev, ghostNext].forEach(function (g) {
      if (g) g.group.visible = false;
    });
    ghostJoints.prev = null;
    ghostJoints.next = null;
    lastGhostKey = '';
    return { ok: true };
  }

  /* ---------- sample clip THREE tại thời gian t ---------- */
  function parseTrackName(trackName) {
    var name = String(trackName || '');
    var dot = name.lastIndexOf('.');
    if (dot <= 0) return null;
    var prop = name.slice(dot + 1);
    if (prop !== 'position' && prop !== 'quaternion' && prop !== 'scale') return null;
    return { bone: name.slice(0, dot), prop: prop };
  }
  function sampleTrackQuat(track, t) {
    var times = track.times, vals = track.values;
    var n = times.length;
    if (!n) return new window.THREE.Quaternion();
    if (n === 1 || t <= times[0]) return new window.THREE.Quaternion(vals[0], vals[1], vals[2], vals[3]);
    if (t >= times[n - 1]) {
      var o = (n - 1) * 4;
      return new window.THREE.Quaternion(vals[o], vals[o + 1], vals[o + 2], vals[o + 3]);
    }
    for (var i = 0; i < n - 1; i++) {
      if (t >= times[i] && t <= times[i + 1]) {
        var span = times[i + 1] - times[i];
        var a = span > 1e-6 ? (t - times[i]) / span : 0;
        _tmpQ1.set(vals[i * 4], vals[i * 4 + 1], vals[i * 4 + 2], vals[i * 4 + 3]);
        _tmpQ2.set(vals[(i + 1) * 4], vals[(i + 1) * 4 + 1], vals[(i + 1) * 4 + 2], vals[(i + 1) * 4 + 3]);
        return _tmpQ1.clone().slerp(_tmpQ2, a);
      }
    }
    return new window.THREE.Quaternion();
  }
  function sampleTrackVec(track, t) {
    var times = track.times, vals = track.values;
    var n = times.length;
    if (!n) return new window.THREE.Vector3();
    var at = function (i) { return new window.THREE.Vector3(vals[i * 3], vals[i * 3 + 1], vals[i * 3 + 2]); };
    if (n === 1 || t <= times[0]) return at(0);
    if (t >= times[n - 1]) return at(n - 1);
    for (var i = 0; i < n - 1; i++) {
      if (t >= times[i] && t <= times[i + 1]) {
        var span = times[i + 1] - times[i];
        var a = span > 1e-6 ? (t - times[i]) / span : 0;
        return at(i).lerp(at(i + 1), a);
      }
    }
    return at(0);
  }
  /* Sample 1 THREE.AnimationClip tại t: áp tạm lên xương, đọc world
     của 17 khớp ghost, trả pose về. Không chạm mixer/action. */
  function sampleClipPoseAt(clip, t, boneMap) {
    if (!clip || !clip.tracks || !window.THREE) return null;
    if (!temps()) return null;
    boneMap = boneMap || buildBoneMap();
    var target = boneMap.target;
    if (!target) return null;
    var dur = clip.duration || 0;
    if (dur > 0) {
      /* loop mặc định wrap, clip 1 lần thì kẹp — host truyền t đã xử
         lý; ở đây wrap khi t vượt duration để onion "sau" cuối clip
         vẫn có pose (vòng lặp xem trước). */
      t = ((t % dur) + dur) % dur;
    } else t = Math.max(0, t);
    /* lưu pose hiện tại của mọi xương sẽ bị sample chạm tới */
    var saved = {};
    clip.tracks.forEach(function (track) {
      var parsed = parseTrackName(track.name);
      if (!parsed) return;
      var bone = boneMap.map[stripName(parsed.bone).toLowerCase()];
      if (!bone || saved[parsed.bone]) return;
      saved[parsed.bone] = {
        bone: bone,
        q: bone.quaternion.clone(), p: bone.position.clone(), s: bone.scale.clone()
      };
    });
    clip.tracks.forEach(function (track) {
      var parsed = parseTrackName(track.name);
      if (!parsed) return;
      var bone = boneMap.map[stripName(parsed.bone).toLowerCase()];
      if (!bone) return;
      if (parsed.prop === 'quaternion') bone.quaternion.copy(sampleTrackQuat(track, t));
      else if (parsed.prop === 'position') bone.position.copy(sampleTrackVec(track, t));
      else if (parsed.prop === 'scale') bone.scale.copy(sampleTrackVec(track, t));
    });
    try { target.updateMatrixWorld(true); } catch (e) {}
    var joints = {};
    GHOST_JOINTS.forEach(function (dst) {
      var b = boneMap.map[dst.toLowerCase()];
      if (!b) return;
      var wp = worldPosOf(b);
      joints[dst] = [round4(wp.x), round4(wp.y), round4(wp.z)];
    });
    Object.keys(saved).forEach(function (k) {
      var s = saved[k];
      s.bone.quaternion.copy(s.q);
      s.bone.position.copy(s.p);
      s.bone.scale.copy(s.s);
    });
    try { target.updateMatrixWorld(true); } catch (e) {}
    return { joints: joints, time: t, jointCount: Object.keys(joints).length };
  }

  /* ---------- phát hiện nguồn phát (poll, chỉ đọc) ---------- */
  /* Giải quyết clip THREE đang phát của LiveRetarget theo tên.
     ArpRemap đổi tên clip khi phát (vd 'FullA' -> 'FullA_remapped')
     nhưng listClips() chỉ liệt kê clip GỐC, nên thử lần lượt:
     clipName (remapped) -> sourceClipName (gốc) -> clipName bỏ hậu
     tố _remapped. Clip gốc sample ra cùng pose (remap chỉ đổi tên
     track), nên dùng clip gốc để sample onion là đúng. */
  function resolveLiveRetargetClip() {
    var LR = getLR();
    if (!LR) return null;
    var names = [];
    try {
      var stt = LR.getState ? LR.getState() : null;
      if (stt) {
        if (stt.clipName) names.push(stt.clipName);
        if (stt.sourceClipName) names.push(stt.sourceClipName);
        if (stt.clipName) names.push(stt.clipName.replace(/_remapped$/i, ''));
      }
    } catch (e) {}
    if (hintClipName) names.push(hintClipName);
    if (!names.length) return null;
    if (cachedClip && names.indexOf(cachedClip.name) >= 0) return cachedClip.clip;
    try {
      var list = LR.listClips ? LR.listClips() : [];
      for (var i = 0; i < list.length; i++) {
        for (var k = 0; k < names.length; k++) {
          if (list[i].name === names[k] || list[i].id === names[k]) {
            cachedClip = { name: names[k], clip: list[i].clip };
            return list[i].clip;
          }
        }
      }
    } catch (e) {}
    return null;
  }
  function detectPlayback() {
    /* 1. LiveRetarget */
    try {
      var LR = getLR();
      if (LR && typeof LR.isPlaying === 'function' && LR.isPlaying()) {
        return {
          playing: true, paused: false, source: 'liveretarget',
          time: LR.getTime(), duration: LR.getDuration() || 0,
          clip: resolveLiveRetargetClip(), clipName: (LR.getState && LR.getState().clipName) || hintClipName || '',
          kind: 'three'
        };
      }
      if (LR && typeof LR.isPaused === 'function' && LR.isPaused()) {
        return { playing: false, paused: true, source: 'liveretarget', time: LR.getTime(), duration: LR.getDuration() || 0, clip: resolveLiveRetargetClip(), clipName: '', kind: 'three' };
      }
    } catch (e) {}
    /* 2. Keyframe */
    try {
      var KF = getKF();
      if (KF && typeof KF.isPlaying === 'function' && KF.isPlaying()) {
        var kc = KF.getClip ? KF.getClip() : null;
        return {
          playing: true, paused: false, source: 'keyframe',
          time: KF.getTime(), duration: (kc && kc.duration) || 0,
          clip: kc, clipName: (kc && kc.name) || '', kind: 'keyframe'
        };
      }
    } catch (e) {}
    /* 3. Anim (mixer studio) */
    try {
      var Anim = PS.Anim;
      if (Anim && Anim.current && Anim.actions && Anim.actions[Anim.current]) {
        var act = Anim.actions[Anim.current];
        var paused = !!Anim._paused || !!act.paused;
        var running = true;
        try { if (typeof act.isRunning === 'function') running = act.isRunning(); } catch (e2) {}
        if (!paused && running) {
          var entry = null;
          (Anim.clips || []).forEach(function (c) { if (c.name === Anim.current) entry = c; });
          return {
            playing: true, paused: false, source: 'anim',
            time: (typeof act.time === 'number' ? act.time : 0),
            duration: (entry && entry.duration) || (entry && entry.clip && entry.clip.duration) || 0,
            clip: entry ? entry.clip : null, clipName: Anim.current, kind: 'three'
          };
        }
        return { playing: false, paused: paused, source: 'anim', time: (typeof act.time === 'number' ? act.time : 0), duration: 0, clip: null, clipName: Anim.current, kind: 'three' };
      }
    } catch (e) {}
    /* 4. AnimAutoGen */
    try {
      var AAG = PS.AnimAutoGen;
      var RAG = PS.RigAutoGen;
      if (AAG && AAG.currentClip && RAG && RAG.current && RAG.current.mixer) {
        var mixer = RAG.current.mixer;
        var a2 = mixer._actions && mixer._actions[AAG.currentClip];
        if (a2 && !a2.paused) {
          var e2 = null;
          (RAG.current.clips || []).forEach(function (c) { if (c.id === AAG.currentClip) e2 = c; });
          return {
            playing: true, paused: false, source: 'autogen',
            time: (typeof a2.time === 'number' ? a2.time : 0),
            duration: (e2 && e2.duration) || (e2 && e2.clip && e2.clip.duration) || 0,
            clip: e2 ? e2.clip : null, clipName: AAG.currentClip, kind: 'three'
          };
        }
      }
    } catch (e) {}
    /* 5. Hint thủ công từ notePlay() */
    if (hint && typeof hint.getTime === 'function') {
      try {
        return {
          playing: true, paused: false, source: hint.source || 'manual',
          time: hint.getTime(), duration: hint.duration || 0,
          clip: hint.clip || null, clipName: hint.clipName || '', kind: hint.kind || 'three'
        };
      } catch (e) {}
    }
    if (hint && hint.playing) {
      return { playing: true, paused: false, source: hint.source || 'manual', time: hint.time || 0, duration: hint.duration || 0, clip: hint.clip || null, clipName: hint.clipName || '', kind: hint.kind || 'three' };
    }
    return { playing: false, paused: false, source: '', time: state.time, duration: 0, clip: null, clipName: '', kind: '' };
  }

  /* ---------- bus subscribe (chỉ ghi nhớ, không điều khiển) ---------- */
  function subscribeBus() {
    if (busSubscribed) return;
    if (!bus || typeof bus.on !== 'function') return;
    try {
      bus.on('animation:played', function (d) { if (d && d.name) hintClipName = d.name; });
      bus.on('anim:autogen-played', function (d) { if (d && d.clip) hintClipName = d.clip; });
      bus.on('arpliveretarget:play', function (d) { if (d && d.clip) hintClipName = d.clip; });
      bus.on('arpqr3:play', function () {});
      busSubscribed = true;
    } catch (e) {}
  }
  subscribeBus();

  /* ---------- ghi điểm trail ---------- */
  function sampleTrails() {
    if (!window.THREE) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var res = resolveTrailBones();
    if (!res.target) return { ok: false, error: 'Chưa có model/rig để theo dõi (cần QuickRig.current hoặc model có xương).' };
    if (!res.found) return { ok: false, error: 'Không tìm được khớp trail nào (cần LeftHand/RightHand/LeftFoot/RightFoot/Head).' };
    if (!ensureTrailGroup()) return { ok: false, error: 'Không gắn được trail group vào scene (chưa có Viewport.scene hay model parent).' };
    attachTrailLines();
    try { res.target.updateMatrixWorld(true); } catch (e) {}
    var added = 0;
    TRAIL_JOINTS.forEach(function (joint) {
      var bone = res.bones[joint];
      if (!bone) return;
      var wp = toTrailLocal(worldPosOf(bone));
      var pts = trailPoints[joint];
      var last = pts.length ? pts[pts.length - 1] : null;
      if (last) {
        var dx = wp.x - last[0], dy = wp.y - last[1], dz = wp.z - last[2];
        if (dx * dx + dy * dy + dz * dz < DEDUP_EPS * DEDUP_EPS) return;
      }
      pts.push([round4(wp.x), round4(wp.y), round4(wp.z)]);
      while (pts.length > state.trailLength) pts.shift();
      added++;
    });
    TRAIL_JOINTS.forEach(function (j) { updateTrailLine(j); });
    return { ok: true, added: added, counts: trailCounts() };
  }
  function trailCounts() {
    var out = {};
    TRAIL_JOINTS.forEach(function (j) { out[j] = trailPoints[j].length; });
    return out;
  }
  function clearTrails() {
    TRAIL_JOINTS.forEach(function (j) {
      trailPoints[j] = [];
      var tl = trailLines[j];
      if (tl) {
        tl.geometry.setDrawRange(0, 0);
        tl.line.visible = false;
      }
    });
    state.fadePhase = 'none';
    state.fadeT = 0;
    return { ok: true, cleared: true };
  }

  /* ---------- onion update ---------- */
  function updateOnion(info) {
    if (!state.onionEnabled || !info.playing) return { ok: false, reason: 'onion tắt hoặc không phát' };
    if (!window.THREE) return { ok: false, reason: 'THREE chưa sẵn sàng' };
    if (!ensureGhosts()) return { ok: false, reason: 'không có rig target để gắn ghost' };
    var t = info.time, dur = info.duration || 0;
    var key = info.source + '|' + t.toFixed(3) + '|' + state.onionOffset + '|' + state.ghostOpacity;
    if (info.kind === 'keyframe') {
      var KF = getKF();
      var clip = info.clip;
      if (!KF || !clip || !clip.keys || !clip.keys.length) return { ok: false, reason: 'keyframe clip rỗng' };
      var prevT = null, nextT = null;
      clip.keys.forEach(function (k) {
        if (k.t < t - 1e-6 && (prevT === null || k.t > prevT)) prevT = k.t;
        if (k.t > t + 1e-6 && (nextT === null || k.t < nextT)) nextT = k.t;
      });
      key = 'kf|' + (prevT === null ? 'x' : prevT) + '|' + (nextT === null ? 'x' : nextT);
      if (key === lastGhostKey) {
        ghostPrev.group.visible = state.onionEnabled && !!ghostJoints.prev;
        ghostNext.group.visible = state.onionEnabled && !!ghostJoints.next;
        return { ok: true, cached: true, prev: !!ghostJoints.prev, next: !!ghostJoints.next };
      }
      var out = { ok: true, prev: false, next: false };
      if (prevT !== null && KF._test && KF._test.poseAt && KF._test.snapshotJoints) {
        var pp = KF._test.poseAt(prevT);
        var pj = pp ? KF._test.snapshotJoints(pp.pose, pp.hips) : null;
        if (pj) { ghostJoints.prev = pj; placeGhostSide('prev', pj); out.prev = true; }
      }
      if (nextT !== null && KF._test && KF._test.poseAt && KF._test.snapshotJoints) {
        var np = KF._test.poseAt(nextT);
        var nj = np ? KF._test.snapshotJoints(np.pose, np.hips) : null;
        if (nj) { ghostJoints.next = nj; placeGhostSide('next', nj); out.next = true; }
      }
      /* ở đúng đầu/cuối clip không có key trước/sau → ẩn phía đó */
      if (prevT === null) { ghostPrev.group.visible = false; ghostJoints.prev = null; }
      if (nextT === null) { ghostNext.group.visible = false; ghostJoints.next = null; }
      lastGhostKey = key;
      return out;
    }
    /* nguồn clip THREE: sample tại t ∓ offset */
    var clip3 = info.clip;
    if (!clip3 || !clip3.tracks) return { ok: false, reason: 'không có THREE clip để sample onion' };
    if (key === lastGhostKey) {
      ghostPrev.group.visible = state.onionEnabled && !!ghostJoints.prev;
      ghostNext.group.visible = state.onionEnabled && !!ghostJoints.next;
      return { ok: true, cached: true, prev: !!ghostJoints.prev, next: !!ghostJoints.next };
    }
    var offP = state.onionOffsetPrev !== null ? state.onionOffsetPrev : state.onionOffset;
    var offN = state.onionOffsetNext !== null ? state.onionOffsetNext : state.onionOffset;
    var bm = buildBoneMap();
    var out3 = { ok: true, prev: false, next: false };
    var sp = sampleClipPoseAt(clip3, t - offP, bm);
    if (sp && sp.jointCount) { ghostJoints.prev = sp.joints; placeGhostSide('prev', sp.joints); out3.prev = true; }
    else { ghostPrev.group.visible = false; ghostJoints.prev = null; }
    var sn = sampleClipPoseAt(clip3, t + offN, bm);
    if (sn && sn.jointCount) { ghostJoints.next = sn.joints; placeGhostSide('next', sn.joints); out3.next = true; }
    else { ghostNext.group.visible = false; ghostJoints.next = null; }
    lastGhostKey = key;
    return out3;
  }

  /* ============================================================
     UPDATE — driver mỗi frame (host gọi bằng rAF / harness trực tiếp)
     ============================================================ */
  function update(dt) {
    dt = (typeof dt === 'number' && isFinite(dt) && dt >= 0) ? dt : (1 / 60);
    subscribeBus();
    var info = detectPlayback();
    var nowPlaying = !!info.playing;
    var prevPlaying = wasPlaying;

    state.playing = nowPlaying;
    state.paused = !!info.paused;
    if (nowPlaying) {
      state.source = info.source;
      state.time = info.time;
      state.duration = info.duration || 0;
      state.clipName = info.clipName || '';
    }

    /* chuyển phát -> dừng: bắt đầu fade (trừ khi keepOnStop).
       Tạm dừng (paused) thì ĐÓNG BĂNG vệt + ghost, không fade. */
    var activeOrPaused = nowPlaying || !!info.paused;
    if (prevPlaying && !nowPlaying && !info.paused) {
      if (state.keepOnStop) {
        state.fadePhase = 'none';
      } else if (trailCountsTotal() > 0) {
        state.fadePhase = 'hold';
        state.fadeT = 0;
      }
      hideGhosts();
      emit('arpvptrails:stop', { source: state.source, time: state.time });
    }
    if (!prevPlaying && nowPlaying) {
      /* phát mới: vệt cũ (nếu keepOnStop giữ lại) xóa để vệt mới sạch */
      if (state.fadePhase !== 'none' || state.keepOnStop) clearTrails();
      state.fadePhase = 'none';
      state.fadeT = 0;
      lastGhostKey = '';
      emit('arpvptrails:play', { source: info.source, clip: info.clipName });
    }
    wasPlaying = activeOrPaused;

    /* fade khi đã dừng (không chạy khi đang tạm dừng) */
    if (!nowPlaying && !info.paused && state.fadePhase !== 'none') {
      state.fadeT += dt;
      if (state.fadePhase === 'hold' && state.fadeT >= state.fadeHold) {
        state.fadePhase = 'fading';
        state.fadeT = 0;
      } else if (state.fadePhase === 'fading' && state.fadeT >= state.fadeDuration) {
        clearTrails();
      }
      TRAIL_JOINTS.forEach(function (j) { updateTrailLine(j); });
      return {
        ok: true, playing: false, source: state.source, time: state.time,
        fading: state.fadePhase, trailCounts: trailCounts(),
        onion: { prev: false, next: false }
      };
    }

    if (!nowPlaying) {
      return {
        ok: true, playing: false, paused: state.paused, source: state.source,
        time: state.time, fading: state.fadePhase, trailCounts: trailCounts(),
        onion: { prev: false, next: false }
      };
    }

    var sampled = null;
    if (state.trailsEnabled) sampled = sampleTrails();
    var onionRes = updateOnion(info);
    return {
      ok: true, playing: true, source: info.source, time: info.time,
      duration: info.duration, clip: info.clipName,
      fading: 'none', trailCounts: trailCounts(),
      trailSampled: sampled ? sampled.ok : false,
      trailError: sampled && !sampled.ok ? sampled.error : '',
      onion: { prev: !!(onionRes && onionRes.prev), next: !!(onionRes && onionRes.next), cached: !!(onionRes && onionRes.cached) }
    };
  }
  function trailCountsTotal() {
    var n = 0;
    TRAIL_JOINTS.forEach(function (j) { n += trailPoints[j].length; });
    return n;
  }

  /* ---------- bật/tắt + chỉnh thông số ---------- */
  function setTrailsEnabled(v) {
    state.trailsEnabled = !!v;
    if (!state.trailsEnabled) {
      TRAIL_JOINTS.forEach(function (j) { var tl = trailLines[j]; if (tl) tl.line.visible = false; });
    } else {
      TRAIL_JOINTS.forEach(function (j) { updateTrailLine(j); });
    }
    tryRegisterLayers();
    return { ok: true, trailsEnabled: state.trailsEnabled };
  }
  function setOnionEnabled(v) {
    state.onionEnabled = !!v;
    if (!state.onionEnabled) hideGhosts();
    tryRegisterLayers();
    return { ok: true, onionEnabled: state.onionEnabled };
  }
  function setTrailLength(n) {
    n = Math.round(Number(n));
    if (!isFinite(n)) return { ok: false, error: 'Độ dài trail phải là số.' };
    state.trailLength = clamp(n, MIN_TRAIL_LENGTH, MAX_TRAIL_LENGTH);
    TRAIL_JOINTS.forEach(function (j) {
      while (trailPoints[j].length > state.trailLength) trailPoints[j].shift();
      updateTrailLine(j);
    });
    return { ok: true, trailLength: state.trailLength, max: MAX_TRAIL_LENGTH };
  }
  function setTrailOpacity(v) {
    v = Number(v);
    if (!isFinite(v)) return { ok: false, error: 'Opacity phải là số.' };
    state.trailOpacity = clamp(v, 0, 1);
    TRAIL_JOINTS.forEach(function (j) { var tl = trailLines[j]; if (tl) tl.material.opacity = state.trailOpacity * fadeOpacityFactor(); });
    return { ok: true, trailOpacity: state.trailOpacity };
  }
  function setGhostOpacity(v) {
    v = Number(v);
    if (!isFinite(v)) return { ok: false, error: 'Opacity phải là số.' };
    state.ghostOpacity = clamp(v, 0.05, 1);
    [ghostPrev, ghostNext].forEach(function (g) { if (g) g.material.opacity = state.ghostOpacity; });
    return { ok: true, ghostOpacity: state.ghostOpacity };
  }
  function setOnionOffset(s) {
    s = Number(s);
    if (!isFinite(s) || s < 0) return { ok: false, error: 'Onion offset phải >= 0 (giây).' };
    state.onionOffset = clamp(s, 0, 2);
    state.onionOffsetPrev = null;
    state.onionOffsetNext = null;
    lastGhostKey = '';
    return { ok: true, onionOffset: state.onionOffset };
  }
  function setOnionOffsets(prev, next) {
    prev = Number(prev); next = Number(next);
    if (!isFinite(prev) || !isFinite(next) || prev < 0 || next < 0) {
      return { ok: false, error: 'Onion offset phải >= 0 (giây).' };
    }
    state.onionOffsetPrev = clamp(prev, 0, 2);
    state.onionOffsetNext = clamp(next, 0, 2);
    lastGhostKey = '';
    return { ok: true, prev: state.onionOffsetPrev, next: state.onionOffsetNext };
  }
  function setFadeHold(s) {
    s = Number(s);
    if (!isFinite(s) || s < 0) return { ok: false, error: 'Fade hold phải >= 0 (giây).' };
    state.fadeHold = clamp(s, 0, 30);
    return { ok: true, fadeHold: state.fadeHold };
  }
  function setFadeDuration(s) {
    s = Number(s);
    if (!isFinite(s) || s < 0) return { ok: false, error: 'Fade duration phải >= 0 (giây).' };
    state.fadeDuration = clamp(s, 0, 10);
    return { ok: true, fadeDuration: state.fadeDuration };
  }
  function setKeepOnStop(v) {
    state.keepOnStop = !!v;
    return { ok: true, keepOnStop: state.keepOnStop };
  }

  /* ---------- điều khiển thủ công (host/toolbar) ---------- */
  function notePlay(opts) {
    opts = opts || {};
    hint = {
      clip: opts.clip || null,
      clipName: opts.clipName || (opts.clip && opts.clip.name) || '',
      getTime: (typeof opts.getTime === 'function') ? opts.getTime : null,
      time: (typeof opts.time === 'number') ? opts.time : 0,
      duration: opts.duration || 0,
      source: opts.source || 'manual',
      kind: opts.kind || 'three',
      playing: true
    };
    if (opts.clipName) hintClipName = opts.clipName;
    return { ok: true, source: hint.source };
  }
  function noteStop() {
    hint = null;
    if (wasPlaying && trailCountsTotal() > 0 && !state.keepOnStop) {
      state.fadePhase = 'hold';
      state.fadeT = 0;
    }
    hideGhosts();
    return { ok: true };
  }
  function sampleNow() {
    var s = sampleTrails();
    if (!s.ok) return s;
    var info = detectPlayback();
    var o = { ok: false, reason: 'không phát' };
    if (info.playing) o = updateOnion(info);
    return { ok: true, trailCounts: trailCounts(), onion: o };
  }
  function getState() {
    return {
      trailsEnabled: state.trailsEnabled,
      onionEnabled: state.onionEnabled,
      trailLength: state.trailLength,
      maxTrailLength: MAX_TRAIL_LENGTH,
      trailOpacity: state.trailOpacity,
      ghostOpacity: state.ghostOpacity,
      onionOffset: state.onionOffset,
      onionOffsetPrev: state.onionOffsetPrev,
      onionOffsetNext: state.onionOffsetNext,
      fadeHold: state.fadeHold,
      fadeDuration: state.fadeDuration,
      keepOnStop: state.keepOnStop,
      playing: state.playing,
      paused: state.paused,
      source: state.source,
      time: state.time,
      duration: state.duration,
      clipName: state.clipName,
      fadePhase: state.fadePhase,
      fadeT: state.fadeT,
      trailCounts: trailCounts(),
      trailJoints: TRAIL_JOINTS.slice(),
      ghostJoints: GHOST_JOINTS.slice(),
      registered: state.registered,
      registerError: state.registerError,
      trailGroupAttached: !!(trailGroup && trailGroup.parent),
      ghostAttached: !!(ghostTarget && ghostPrev && ghostPrev.group.parent)
    };
  }
  function getTrailPoints(joint) {
    if (!trailPoints[joint]) return null;
    return trailPoints[joint].map(function (p) { return [p[0], p[1], p[2]]; });
  }
  function getGhostJoints(side) {
    var j = side === 'next' ? ghostJoints.next : ghostJoints.prev;
    return j ? JSON.parse(JSON.stringify(j)) : null;
  }

  /* ---------- đăng ký layer vào registry chung (defensive) ---------- */
  function layerObject(kind) {
    return {
      id: kind,
      show: function () { return kind === 'trails' ? setTrailsEnabled(true) : setOnionEnabled(true); },
      hide: function () { return kind === 'trails' ? setTrailsEnabled(false) : setOnionEnabled(false); },
      setVisible: function (v) { return kind === 'trails' ? setTrailsEnabled(v) : setOnionEnabled(v); },
      isVisible: function () { return kind === 'trails' ? state.trailsEnabled : state.onionEnabled; },
      update: update,
      getState: getState
    };
  }
  function tryRegisterLayers() {
    var AV = PS.ArpViewport;
    if (!AV || typeof AV.registerLayer !== 'function') {
      state.registered = false;
      return { ok: false, reason: 'ArpViewport.registerLayer chưa có — dùng API trực tiếp (showTrails/hideTrails/showOnion/hideOnion/update).' };
    }
    try {
      AV.registerLayer('trails', layerObject('trails'));
      AV.registerLayer('onion', layerObject('onion'));
      state.registered = true;
      state.registerError = '';
      return { ok: true, registered: true, layers: ['trails', 'onion'] };
    } catch (e) {
      state.registered = false;
      state.registerError = e && e.message ? e.message : String(e);
      return { ok: false, error: state.registerError };
    }
  }

  /* ---------- UI section ---------- */
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
    var wrap = el('div', { class: 'arp-vp-trails', style: { border: '1px solid #888', borderRadius: '6px', padding: '8px', margin: '6px 0' } });
    wrap.appendChild(el('div', { html: '<b>〰 Motion Trails + Onion Skinning</b> — vệt chuyển động 5 khớp (2 cổ tay, 2 cổ chân, đầu) + bóng mờ pose trước/sau trong lúc clip đang phát. Hook qua Anim / AnimAutoGen / Keyframe / LiveRetarget, không sửa logic phát clip.' }));

    var row1 = el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' } });
    var trailsChk = el('input', { type: 'checkbox' });
    trailsChk.checked = state.trailsEnabled;
    trailsChk.addEventListener('change', function () { setTrailsEnabled(trailsChk.checked); });
    row1.appendChild(el('label', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, [trailsChk, el('span', { text: 'Hiện trails' })]));
    var onionChk = el('input', { type: 'checkbox' });
    onionChk.checked = state.onionEnabled;
    onionChk.addEventListener('change', function () { setOnionEnabled(onionChk.checked); });
    row1.appendChild(el('label', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, [onionChk, el('span', { text: 'Onion skinning' })]));
    row1.appendChild(el('button', { class: 'btn sm', text: 'Xóa vệt', onclick: function () { clearTrails(); } }));
    wrap.appendChild(row1);

    var mkSlider = function (label, min, max, step, val, oninput) {
      var row = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '4px 0' } });
      row.appendChild(el('span', { text: label, style: { width: '130px', fontSize: '13px' } }));
      var s = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(val), style: { flex: '1' } });
      var v = el('span', { text: String(val), style: { width: '44px', fontFamily: 'monospace', fontSize: '12px' } });
      s.addEventListener('input', function () { v.textContent = s.value; oninput(parseFloat(s.value)); });
      row.appendChild(s);
      row.appendChild(v);
      return row;
    };
    wrap.appendChild(mkSlider('Độ dài trail (điểm):', MIN_TRAIL_LENGTH, MAX_TRAIL_LENGTH, 1, state.trailLength, function (v) { setTrailLength(v); }));
    wrap.appendChild(mkSlider('Độ mờ ghost:', 0.05, 1, 0.05, state.ghostOpacity, function (v) { setGhostOpacity(v); }));
    wrap.appendChild(mkSlider('Onion offset (s):', 0, 1, 0.05, state.onionOffset, function (v) { setOnionOffset(v); }));
    wrap.appendChild(mkSlider('Giữ vệt sau dừng (s):', 0, 10, 0.5, state.fadeHold, function (v) { setFadeHold(v); }));
    wrap.appendChild(el('div', { style: { fontSize: '12px', color: '#555', marginTop: '4px' },
      text: 'Màu vệt theo chi, giống màu gizmo: trái xanh dương, phải đỏ, đầu xanh lá. Ghost là bóng 17 khớp (prev xanh dương / next hồng), không phải mesh mờ. Dừng clip: vệt giữ ' + state.fadeHold + 's rồi mờ dần trong ' + state.fadeDuration + 's rồi xóa (bật Giữ vệt để giữ lại).' }));
    container.appendChild(wrap);
  }

  /* ---------- public API ---------- */
  var ArpVpTrails = {
    TRAIL_JOINTS: TRAIL_JOINTS,
    GHOST_JOINTS: GHOST_JOINTS,
    MAX_TRAIL_LENGTH: MAX_TRAIL_LENGTH,
    DEFAULT_TRAIL_LENGTH: DEFAULT_TRAIL_LENGTH,
    showTrails: function () { return setTrailsEnabled(true); },
    hideTrails: function () { return setTrailsEnabled(false); },
    setTrailsEnabled: setTrailsEnabled,
    isTrailsEnabled: function () { return state.trailsEnabled; },
    showOnion: function () { return setOnionEnabled(true); },
    hideOnion: function () { return setOnionEnabled(false); },
    setOnionEnabled: setOnionEnabled,
    isOnionEnabled: function () { return state.onionEnabled; },
    update: update,
    sampleNow: sampleNow,
    setTrailLength: setTrailLength,
    getTrailLength: function () { return state.trailLength; },
    setTrailOpacity: setTrailOpacity,
    setGhostOpacity: setGhostOpacity,
    setOnionOffset: setOnionOffset,
    setOnionOffsets: setOnionOffsets,
    setFadeHold: setFadeHold,
    setFadeDuration: setFadeDuration,
    setKeepOnStop: setKeepOnStop,
    clearTrails: clearTrails,
    hideGhosts: hideGhosts,
    clearGhosts: hideGhosts,
    notePlay: notePlay,
    noteStop: noteStop,
    getState: getState,
    getTrailPoints: getTrailPoints,
    getGhostJoints: getGhostJoints,
    registerLayers: tryRegisterLayers,
    attachToViewport: tryRegisterLayers,
    renderSection: renderSection,
    _test: {
      TRAIL_JOINTS: TRAIL_JOINTS,
      GHOST_JOINTS: GHOST_JOINTS,
      resolveTrailBones: resolveTrailBones,
      sampleClipPoseAt: sampleClipPoseAt,
      detectPlayback: detectPlayback,
      trailCounts: trailCounts,
      getGizmoColors: getGizmoColors,
      colorForJoint: colorForJoint,
      buildBoneMap: buildBoneMap
    }
  };

  PS.ArpVpTrails = ArpVpTrails;
  tryRegisterLayers();
  try {
    var QR = getQR();
    if (QR && typeof QR.registerSection === 'function') QR.registerSection('vp-trails', renderSection);
  } catch (e) {}
})();
