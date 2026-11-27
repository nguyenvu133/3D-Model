/* ============================================================
 * rig/arp-anim-video.js — VIDEO → ANIMATION (nhóm E, stretch goal)
 *
 * Trích xuất pose người từ video bằng MediaPipe Pose Landmarker
 * rồi dựng thành clip animation phát được trong Animator/Keyframe.
 *
 * ĐƯỜNG ĐI DỮ LIỆU:
 *   video file → PoseLandmarker.detectForVideo (từng frame, theo fps
 *   trích) → 33 landmarks 3D (worldLandmarks, mét) + 33 landmarks
 *   2D (image, chuẩn hoá) → map landmark → 14 xương rig → keys
 *   (quaternion local từng xương + vị trí Hips) → clip JSON đúng
 *   format 'pixistudio-arp-keyframe-clips-1' → Keyframe.importClip
 *   (hiện trong Animator qua sync 'keyframe:…') hoặc
 *   Animator.registerClip (THREE.AnimationClip) nếu Keyframe vắng.
 *
 * MEDIAPIPE — KẾT QUẢ KIỂM CHỨNG THẬT (Chromium headless, VM):
 *   • @mediapipe/tasks-vision CHỈ CÓ BẢN ES MODULE (vision_bundle.mjs)
 *     + bản CJS cho Node — KHÔNG CÓ bản UMD/global script tag. Vì vậy
 *     module này nạp bằng dynamic import() từ script thường (Chrome /
 *     Android chạy được), KHÔNG dùng <script src> cho bundle.
 *   • Đã kiểm chứng: tasks-vision@0.10.14, file vision_bundle.mjs trên
 *     jsdelivr == unpkg == npm (sha256 khớp), wasm + model lite tải
 *     được, PoseLandmarker(lite, CPU) tạo trong ~5.8s, detectForVideo
 *     trả 33 landmarks + 33 world landmarks, visibility ~0.999 trên
 *     video mẫu thật 1280x720 (người thật, toàn thân).
 *   • Hạn chế môi trường VM: Chromium trong VM KHÔNG ra được CDN qua
 *     proxy (ERR_TUNNEL_CONNECTION_FAILED với mọi host ngoài) nên
 *     KHÔNG kiểm chứng được bước "nạp từ CDN" trong VM — đã kiểm
 *     chứng bằng đúng byte của bundle (phục vụ từ localhost) thay thế.
 *     Trên điện thoại có mạng, CDN jsdelivr/unpkg là đường chuẩn theo
 *     docs Google; vẫn cần test thật trên điện thoại.
 *   • Tốc độ trong VM rất chậm (~1.9s/frame, CPU headless-shell, không
 *     GPU) — trên điện thoại dùng delegate GPU sẽ nhanh hơn nhiều;
 *     mặc định trích 10fps + chạy nền theo thời gian phát video.
 *
 * TOÁN MAP LANDMARK → XƯƠNG (thuần, không cần THREE):
 *   • Hệ toạ độ MediaPipe world (đo thật trên video mẫu): gốc tại
 *     giữa 2 hông MỖI FRAME (wHips ≈ (0,0,0) không đổi dù người di
 *     chuyển), +x = bên TRÁI của người, +y = XUỐNG, +z = RA SAU lưng.
 *     → three.js: (x, -y, -z) — phép quay 180° quanh X, không mirror.
 *   • Mỗi xương có hướng đoạn (rest dir) ở tư thế T-pose và hướng
 *     quan sát (từ landmark). delta = quay tối thiểu rest→quan sát;
 *     worldQuat(xương) = delta * bindWorldQuat(xương); localQuat =
 *     parentWorldQuat⁻¹ * worldQuat (tính từ gốc xuống ngọn).
 *   • Bind pose: (a) có snapshot từ skeleton thật (khuyên dùng —
 *     nút "Chụp bind pose" khi model đang ở T-pose) thì dùng đúng
 *     quaternion/position bind của model, xương trung gian (Spine1,
 *     Spine2, Shoulder…) kế thừa delta của cha; (b) không có thì
 *     dựng bind ảo theo quy ước "trục Y local dọc theo xương" +
 *     hướng T-pose cố định (tay ±X, chân -Y, cột sống +Y…).
 *   • Vị trí Hips: world landmarks KHÔNG chứa chuyển động tịnh tiến
 *     (gốc recenter mỗi frame) nên lấy từ IMAGE landmarks (điểm giữa
 *     2 hông, đổi pixel→mét theo tỉ lệ thân người), z giữ nguyên.
 *
 * GIỚI HẠN TRUNG THỰC (hiện cả trong UI):
 *   • Chỉ 1 người trong khung hình (numPoses=1); người khác lọt vào
 *     khung có thể làm pose nhảy.
 *   • Pose 3D thô: độ sâu world landmark không chính xác như mocap;
 *     KHÔNG bắt được xoay trục (twist) của xương — chỉ hướng đoạn.
 *   • Không bắt ngón tay / mặt chi tiết (Pose Landmarker chỉ có 33
 *     điểm thân; bàn tay chỉ 1 hướng cổ tay→ngón trỏ).
 *   • Cần video rõ nét, đủ sáng, toàn thân trong khung; xoay người
 *     lớn / che khuất thì landmark sai, frame đó giữ pose cũ.
 *   • Không chính xác như Rokoko/Plask chuyên nghiệp; clip cần
 *     làm sạch tay (smoothing có sẵn, mặc định bật).
 *   • Trích bằng cách phát video theo thời gian thực (VIDEO mode
 *     yêu cầu timestamp tăng đơn điệu) — video 60s trích ~60s.
 * ============================================================ */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined' && window.PixiStudio) || {};
  var bus = (PS && PS.bus) || { emit: function () {}, on: function () {} };
  var U = (PS && PS.Utils) || null;

  var TASKS_VISION_VERSION = '0.10.14';
  var CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + TASKS_VISION_VERSION;
  var CDN_FALLBACK_BASE = 'https://unpkg.com/@mediapipe/tasks-vision@' + TASKS_VISION_VERSION;
  var MODEL_LITE_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  var MODEL_FULL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
  var MODEL_HEAVY_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task';
  var FORMAT = 'pixistudio-arp-keyframe-clips-1';
  var MIN_VISIBILITY = 0.5;

  /* 33 landmark MediaPipe Pose (chỉ số chuẩn BlazePose). */
  var LANDMARK_NAMES = ['nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
    'right_eye_inner', 'right_eye', 'right_eye_outer', 'left_ear', 'right_ear',
    'mouth_left', 'mouth_right', 'left_shoulder', 'right_shoulder',
    'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
    'left_pinky', 'right_pinky', 'left_index', 'right_index',
    'left_thumb', 'right_thumb', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
    'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index'];
  var POSE_CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
    [9, 10], [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
    [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
    [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
    [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32]];

  /* mid:[a,b] = điểm giữa 2 landmark. rest = hướng đoạn ở T-pose
     (three.js, người quay mặt +Z: tay trái +X, tay phải -X…). */
  var BONE_SEGMENTS = [
    { bone: 'Spine', parent: 'Hips', from: 'mid:23,24', to: 'mid:11,12', rest: [0, 1, 0] },
    { bone: 'Neck', parent: 'Spine', from: 'mid:11,12', to: 'mid:7,8', rest: [0, 1, 0] },
    { bone: 'Head', parent: 'Neck', from: 'mid:7,8', to: 0, rest: [0, 1, 0] },
    { bone: 'LeftArm', parent: 'Spine', from: 11, to: 13, rest: [1, 0, 0] },
    { bone: 'LeftForeArm', parent: 'LeftArm', from: 13, to: 15, rest: [1, 0, 0] },
    { bone: 'LeftHand', parent: 'LeftForeArm', from: 15, to: 19, rest: [1, 0, 0] },
    { bone: 'RightArm', parent: 'Spine', from: 12, to: 14, rest: [-1, 0, 0] },
    { bone: 'RightForeArm', parent: 'RightArm', from: 14, to: 16, rest: [-1, 0, 0] },
    { bone: 'RightHand', parent: 'RightForeArm', from: 16, to: 20, rest: [-1, 0, 0] },
    { bone: 'LeftUpLeg', parent: 'Hips', from: 23, to: 25, rest: [0, -1, 0] },
    { bone: 'LeftLeg', parent: 'LeftUpLeg', from: 25, to: 27, rest: [0, -1, 0] },
    { bone: 'LeftFoot', parent: 'LeftLeg', from: 27, to: 31, rest: [0, 0, 1] },
    { bone: 'RightUpLeg', parent: 'Hips', from: 24, to: 26, rest: [0, -1, 0] },
    { bone: 'RightLeg', parent: 'RightUpLeg', from: 26, to: 28, rest: [0, -1, 0] },
    { bone: 'RightFoot', parent: 'RightLeg', from: 28, to: 32, rest: [0, 0, 1] }
  ];
  /* Xương trung gian trong rig Mixamo không có trong map: kế thừa delta
     của xương cha gần nhất có trong map (đi qua Spine/Hips). */
  var BONE_CHAIN_PARENTS = { Spine: 'Hips', Neck: 'Spine', Head: 'Neck',
    LeftArm: 'Spine', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm',
    RightArm: 'Spine', RightForeArm: 'RightArm', RightHand: 'RightForeArm',
    LeftUpLeg: 'Hips', LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg',
    RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg' };

  var LIMITS_TEXT = 'Giới hạn: chỉ 1 người trong khung hình; pose 3D thô ' +
    '(độ sâu không chính xác như mocap); không bắt được xoay trục xương, ' +
    'ngón tay hay mặt chi tiết; cần video rõ nét, đủ sáng, toàn thân; ' +
    'xoay người lớn hoặc che khuất thì landmark sai (frame đó giữ pose cũ); ' +
    'không chính xác như Rokoko/Plask. Vị trí Hips chỉ theo mặt phẳng ảnh ' +
    '(tiến/lùi theo chiều sâu camera không track được).';

  /* ================= toán vector/quaternion thuần ================= */
  function v3(x, y, z) { return [x || 0, y || 0, z || 0]; }
  function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function v3scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function v3len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function v3norm(a) { var l = v3len(a); return l > 1e-9 ? v3scale(a, 1 / l) : [0, 0, 0]; }
  function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round4(v) { return Math.round(v * 10000) / 10000; }
  function round3(v) { return Math.round(v * 1000) / 1000; }
  function quatIdentity() { return [0, 0, 0, 1]; }
  function quatNorm(q) {
    var l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    return l > 1e-9 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : quatIdentity();
  }
  /* Giống hệt THREE.Quaternion.setFromUnitVectors (r128), kể cả nhánh
     2 vector ngược chiều — để harness so khớp được với THREE. */
  function quatFromUnitVectors(a, b) {
    var vFrom = v3norm(a), vTo = v3norm(b);
    var r = v3dot(vFrom, vTo) + 1, q;
    if (r < 1e-9) {
      r = 0;
      if (Math.abs(vFrom[0]) > Math.abs(vFrom[2])) q = [-vFrom[1], vFrom[0], 0, r];
      else q = [0, -vFrom[2], vFrom[1], r];
    } else {
      q = [vFrom[1] * vTo[2] - vFrom[2] * vTo[1],
        vFrom[2] * vTo[0] - vFrom[0] * vTo[2],
        vFrom[0] * vTo[1] - vFrom[1] * vTo[0], r];
    }
    return quatNorm(q);
  }
  function quatMul(a, b) { /* a * b (áp b trước, rồi a) */
    return quatNorm([
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]);
  }
  function quatInv(q) { return [-q[0], -q[1], -q[2], q[3]]; }
  function quatSlerp(a, b, t) {
    var dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], -1, 1);
    var b2 = b;
    if (dot < 0) { dot = -dot; b2 = [-b[0], -b[1], -b[2], -b[3]]; }
    if (dot > 0.9995) {
      return quatNorm([a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t,
        a[2] + (b2[2] - a[2]) * t, a[3] + (b2[3] - a[3]) * t]);
    }
    var theta = Math.acos(dot), s = Math.sin(theta);
    var wa = Math.sin((1 - t) * theta) / s, wb = Math.sin(t * theta) / s;
    return [a[0] * wa + b2[0] * wb, a[1] * wa + b2[1] * wb,
      a[2] * wa + b2[2] * wb, a[3] * wa + b2[3] * wb];
  }
  function quatApply(q, v) { /* xoay vector v bằng quaternion q */
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  }
  /* Quaternion → Euler XYZ, KHỚP THREE.Euler 'XYZ' (setFromRotationMatrix
     order XYZ: y=asin(m13), x=atan2(-m23,m33), z=atan2(-m12,m11)).
     Công thức aerospace thường gặp (x=atan2(2(wx+yz),…)) là thứ tự
     khác — dùng nó làm clip phát sai (đã bắt được ở harness: chân
     lệch dấu z). eulerToQuat bên dưới đã khớp THREE XYZ. */
  function quatToEuler(q) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var m13 = 2 * (x * z + y * w);
    var ex = Math.atan2(2 * (x * w - y * z), 1 - 2 * (x * x + y * y));
    var ey = Math.asin(clamp(m13, -1, 1));
    var ez = Math.atan2(2 * (z * w - x * y), 1 - 2 * (y * y + z * z));
    /* Gimbal lock (|m13|≈1): THREE đặt z=0, x=atan2(m32,m22). */
    if (Math.abs(m13) >= 0.9999999) {
      ex = Math.atan2(2 * (y * z + x * w), 1 - 2 * (x * x + z * z));
      ez = 0;
    }
    return { x: ex, y: ey, z: ez };
  }
  function eulerToQuat(e) {
    var cx = Math.cos((e.x || 0) / 2), sx = Math.sin((e.x || 0) / 2);
    var cy = Math.cos((e.y || 0) / 2), sy = Math.sin((e.y || 0) / 2);
    var cz = Math.cos((e.z || 0) / 2), sz = Math.sin((e.z || 0) / 2);
    return quatNorm([
      sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz + sx * sy * cz,
      cx * cy * cz - sx * sy * sz]);
  }

  /* ================= trạng thái module ================= */
  var Video = {
    state: 'idle',           /* idle|loading|ready|extracting|done|error */
    error: null,
    landmarker: null,        /* PoseLandmarker thật (sau loadVision) */
    visionModule: null,      /* module tasks-vision đã import */
    modelName: 'lite',
    delegate: 'CPU',
    frames: [],              /* [{t, world:[33x{x,y,z,visibility}], image:[33x...], ok}] */
    clipJson: null,
    clipName: 'VideoClip',
    bindSnapshot: null,      /* snapshot bind pose từ skeleton thật */
    lastStats: null,
    _cancel: false,
    _loader: null            /* inject loader cho test: fn(url)->Promise<module> */
  };

  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message }); } catch (e) {}
  }
  function setState(s, err) {
    Video.state = s;
    Video.error = err || null;
    try { bus.emit('arp:anim-video-state', { state: s, error: Video.error }); } catch (e) {}
  }

  /* ================= landmark → three.js ================= */
  /* MediaPipe world: gốc giữa 2 hông mỗi frame, +x trái người, +y
     XUỐNG, +z ra SAU lưng → three: (x, -y, -z). */
  function mapWorldLandmark(lm) {
    return [lm.x || 0, -(lm.y || 0), -(lm.z || 0)];
  }
  function landmarkPoint(world, spec) {
    if (typeof spec === 'string' && spec.indexOf('mid:') === 0) {
      var parts = spec.slice(4).split(',');
      var a = mapWorldLandmark(world[parseInt(parts[0], 10)]);
      var b = mapWorldLandmark(world[parseInt(parts[1], 10)]);
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    }
    return mapWorldLandmark(world[spec]);
  }
  function landmarkVisibility(world, spec) {
    function vis(i) { var l = world[i]; return (l && l.visibility !== undefined) ? l.visibility : 1; }
    if (typeof spec === 'string' && spec.indexOf('mid:') === 0) {
      var p = spec.slice(4).split(',');
      return Math.min(vis(parseInt(p[0], 10)), vis(parseInt(p[1], 10)));
    }
    return vis(spec);
  }
  /* Hướng đoạn xương quan sát được + độ tin cậy thấp nhất của 2 đầu. */
  function segmentDir(world, seg) {
    var a = landmarkPoint(world, seg.from), b = landmarkPoint(world, seg.to);
    var d = v3sub(b, a), len = v3len(d);
    return {
      dir: len > 1e-6 ? v3scale(d, 1 / len) : null,
      len: len,
      visibility: Math.min(landmarkVisibility(world, seg.from), landmarkVisibility(world, seg.to))
    };
  }

  /* ================= bind pose ================= */
  /* Bind ảo (không có skeleton thật): trục Y local dọc xương. */
  function virtualBind() {
    var bones = {};
    BONE_SEGMENTS.forEach(function (seg) {
      bones[seg.bone] = {
        world: quatFromUnitVectors([0, 1, 0], seg.rest),
        local: quatIdentity(), pos: [0, 0, 0], parent: BONE_CHAIN_PARENTS[seg.bone] || null
      };
    });
    bones.Hips = { world: quatIdentity(), local: quatIdentity(), pos: [0, 0.95, 0], parent: null };
    /* local ảo: cha→con theo đúng chuỗi (Spine cha là Hips…). */
    var order = ['Spine', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand',
      'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot',
      'RightUpLeg', 'RightLeg', 'RightFoot'];
    order.forEach(function (name) {
      var b = bones[name], p = bones[b.parent];
      var pw = p ? p.world : quatIdentity();
      b.local = quatMul(quatInv(pw), b.world);
    });
    return { bones: bones, source: 'virtual', hipsPos: [0, 0.95, 0] };
  }
  /* Chụp bind pose từ skeleton THREE thật (model đang ở T-pose).
     root: Object3D gốc của model (hoặc 1 bone). Trả snapshot
     {bones:{name:{world,local,pos,parent}}, hipsPos, source:'skeleton'}.
     pos/world lấy bằng getWorldQuaternion/getWorldPosition của THREE. */
  function captureBind(root) {
    if (!root) return { ok: false, error: 'Chưa có model/skeleton để chụp bind pose.' };
    try { if (typeof root.updateWorldMatrix === 'function') root.updateWorldMatrix(true, true); } catch (e) {}
    var bones = {};
    var hipsPos = null;
    function walk(obj, parentName) {
      if (!obj) return;
      var name = obj.name || '';
      var short = name.replace(/^mixamorig:?/i, '');
      var wq = quatIdentity(), pos = [0, 0, 0];
      try {
        if (obj.getWorldQuaternion && typeof THREE !== 'undefined' && THREE.Quaternion) {
          var tq = new THREE.Quaternion();
          obj.getWorldQuaternion(tq);
          wq = [tq.x, tq.y, tq.z, tq.w];
        } else if (obj.quaternion) wq = [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w];
        if (obj.getWorldPosition && typeof THREE !== 'undefined' && THREE.Vector3) {
          var tv = new THREE.Vector3();
          obj.getWorldPosition(tv);
          pos = [tv.x, tv.y, tv.z];
        } else if (obj.position) pos = [obj.position.x, obj.position.y, obj.position.z];
      } catch (e) {}
      var local = [0, 0, 0, 1];
      try {
        if (obj.quaternion) local = [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w];
      } catch (e) {}
      bones[short] = { world: wq, local: local, pos: pos, parent: parentName || null, fullName: name };
      if (short === 'Hips') hipsPos = pos;
      (obj.children || []).forEach(function (c) { walk(c, short); });
    }
    walk(root, null);
    if (!bones.Hips) return { ok: false, error: 'Skeleton không có xương Hips — không chụp được bind pose.' };
    return { ok: true, bind: { bones: bones, source: 'skeleton', hipsPos: hipsPos || [0, 0.95, 0] } };
  }
  /* Hướng đoạn lúc bind của 1 xương: từ vị trí khớp con − vị trí khớp
     (snapshot thật); không có con thì dùng rest T-pose cố định. */
  function bindRestDir(bind, seg) {
    var b = bind.bones[seg.bone];
    if (bind.source === 'skeleton' && b) {
      var childName = null;
      Object.keys(bind.bones).forEach(function (n) {
        if (bind.bones[n].parent === seg.bone) {
          if (seg.bone === 'Spine') { if (n === 'Spine1' || n === 'Neck') childName = childName || n; }
          else if (!childName) childName = n;
        }
      });
      if (childName && bind.bones[childName]) {
        var d = v3sub(bind.bones[childName].pos, b.pos);
        if (v3len(d) > 1e-6) return v3norm(d);
      }
      /* End bone (Hand/Foot/Head): hướng đoạn bind = trục Y local của
         xương quay ra world — tức bind world quat áp lên +Y. */
      return quatApply(b.world, [0, 1, 0]);
    }
    return seg.rest.slice();
  }

  /* ================= 1 frame → quats xương ================= */
  /* frame: {world:[33 lm], image:[33 lm]}. opts: {bind, smooth, prevDirs,
     prevQuats}. Trả {quats:{bone:[x,y,z,w]}, dirs, visibility, okCount}. */
  function computeFrameQuats(frame, opts) {
    opts = opts || {};
    var bind = opts.bind || Video.bindSnapshot || virtualBind();
    var world = frame.world || [];
    var smooth = opts.smooth !== false;
    var prevDirs = opts.prevDirs || {};
    var out = { quats: {}, dirs: {}, visibility: {}, okCount: 0, heldCount: 0 };
    var worldQuats = {};   /* world quat quan sát được, tính từ gốc xuống */
    var deltas = {};
    /* Hips đi theo thân (delta của Spine). */
    var spineSeg = BONE_SEGMENTS[0];
    var spineObs = segmentDir(world, spineSeg);
    var spineRest = bindRestDir(bind, spineSeg);
    var spineDelta = null;
    if (spineObs.dir && spineObs.visibility >= MIN_VISIBILITY) {
      spineDelta = quatFromUnitVectors(spineRest, spineObs.dir);
    } else if (opts.prevDeltas && opts.prevDeltas.Spine) {
      spineDelta = opts.prevDeltas.Spine;
      out.heldCount++;
    } else spineDelta = quatIdentity();
    deltas.Hips = spineDelta;
    deltas.Spine = spineDelta;
    /* Tính delta từng xương (làm mượt hướng đoạn trước khi quay). */
    BONE_SEGMENTS.forEach(function (seg) {
      var obs = segmentDir(world, seg);
      out.visibility[seg.bone] = obs.visibility;
      var dir = obs.dir;
      if (!dir || obs.visibility < MIN_VISIBILITY) {
        if (prevDirs[seg.bone]) { dir = prevDirs[seg.bone]; out.heldCount++; }
        else { out.dirs[seg.bone] = null; return; }
      } else if (smooth && prevDirs[seg.bone]) {
        var mixed = v3norm(v3add(v3scale(prevDirs[seg.bone], 0.45), v3scale(dir, 0.55)));
        if (v3len(mixed) > 1e-6) dir = mixed;
      }
      out.dirs[seg.bone] = dir;
      var rest = bindRestDir(bind, seg);
      deltas[seg.bone] = quatFromUnitVectors(rest, dir);
      out.okCount++;
    });
    /* World quat: xương trong map dùng delta của chính nó; xương trung
       gian trong rig (Spine1, Spine2, Shoulder…) kế thừa delta của
       xương map gần nhất phía trên — đệ quy theo đúng cây rig. */
    function deltaOf(name, guard) {
      if (deltas[name]) return deltas[name];
      if ((guard || 0) > 40) return quatIdentity();
      var b = bind.bones[name];
      var pName = (b && b.parent) || BONE_CHAIN_PARENTS[name] || null;
      if (!pName) return quatIdentity();
      return deltaOf(pName, (guard || 0) + 1);
    }
    function worldQuatOf(name) {
      if (worldQuats[name]) return worldQuats[name];
      var b = bind.bones[name];
      if (!b) { worldQuats[name] = quatIdentity(); return worldQuats[name]; }
      worldQuats[name] = quatMul(deltaOf(name, 0), b.world);
      return worldQuats[name];
    }
    /* Local quat cho từng xương trong map: parentWorld⁻¹ * world. */
    BONE_SEGMENTS.forEach(function (seg) {
      if (!out.dirs[seg.bone] && seg.bone !== 'Spine') {
        if (opts.prevQuats && opts.prevQuats[seg.bone]) out.quats[seg.bone] = opts.prevQuats[seg.bone];
        return;
      }
      var w = worldQuatOf(seg.bone, 0);
      var parentName = null;
      var b = bind.bones[seg.bone];
      if (bind.source === 'skeleton' && b && b.parent) parentName = b.parent;
      else parentName = BONE_CHAIN_PARENTS[seg.bone];
      var pw = parentName ? worldQuatOf(parentName, 0) : quatIdentity();
      out.quats[seg.bone] = quatMul(quatInv(pw), w);
    });
    /* Hips local = world (Hips là gốc) — đi theo delta thân. */
    var hipsBind = bind.bones.Hips;
    out.quats.Hips = hipsBind ? quatMul(deltas.Hips, hipsBind.world) : deltas.Hips;
    return out;
  }

  /* ================= vị trí Hips (từ image landmarks) ================= */
  function hipsPosition(frame, ref, opts) {
    opts = opts || {};
    var bind = opts.bind || Video.bindSnapshot || virtualBind();
    var base = bind.hipsPos || [0, 0.95, 0];
    var img = frame.image || [];
    function mid2(a, b) {
      if (!img[a] || !img[b]) return null;
      return [(img[a].x + img[b].x) / 2, (img[a].y + img[b].y) / 2];
    }
    var hips = mid2(23, 24), sh = mid2(11, 12);
    if (!hips || !ref || !ref.hips0 || !ref.sh0) return { pos: base.slice(), ok: false };
    var vw = opts.videoWidth || 1280, vh = opts.videoHeight || 720;
    var torsoPx = Math.hypot((sh[0] - hips[0]) * vw, (sh[1] - hips[1]) * vh);
    var torsoPx0 = ref.torsoPx0;
    if (!torsoPx || !torsoPx0) return { pos: base.slice(), ok: false };
    var mPerPx = ref.torsoWorldLen / torsoPx0; /* mét / pixel ở frame 0 */
    var dx = (hips[0] - ref.hips0[0]) * vw * mPerPx;
    var dy = (hips[1] - ref.hips0[1]) * vh * mPerPx;
    if (opts.rootMotion === false) return { pos: [base[0], base[1] - dy, base[2]], ok: true };
    return { pos: [base[0] + dx, base[1] - dy, base[2]], ok: true };
  }
  function hipsReference(firstFrame, opts) {
    opts = opts || {};
    var world = firstFrame.world || [];
    var img = firstFrame.image || [];
    if (!world[23] || !world[24] || !world[11] || !world[12]) return null;
    var hipsW = landmarkPoint(world, 'mid:23,24'), shW = landmarkPoint(world, 'mid:11,12');
    var torsoWorldLen = v3len(v3sub(shW, hipsW));
    var vw = opts.videoWidth || 1280, vh = opts.videoHeight || 720;
    var hips0 = [(img[23].x + img[24].x) / 2, (img[23].y + img[24].y) / 2];
    var sh0 = [(img[11].x + img[12].x) / 2, (img[11].y + img[12].y) / 2];
    var torsoPx0 = Math.hypot((sh0[0] - hips0[0]) * vw, (sh0[1] - hips0[1]) * vh);
    /* Chiều cao hông ước lượng = độ dài chân (hông→cổ chân) lúc bind. */
    var ankleW = landmarkPoint(world, 'mid:27,28');
    var legLen = v3len(v3sub(ankleW, hipsW));
    return { hips0: hips0, sh0: sh0, torsoPx0: torsoPx0, torsoWorldLen: torsoWorldLen, legLen: legLen };
  }

  /* ================= frames → clip ================= */
  function buildClipFromFrames(frames, opts) {
    opts = opts || {};
    var fps = opts.fps || 15;
    if (!frames || !frames.length) return { ok: false, error: 'Chưa có frame pose nào.' };
    var bind = opts.bind || Video.bindSnapshot || virtualBind();
    var good = frames.filter(function (f) { return f && f.world && f.world.length >= 33; });
    if (!good.length) return { ok: false, error: 'Không có frame nào trích được pose.' };
    var ref = hipsReference(good[0], opts);
    if (ref && bind.source === 'virtual') {
      bind = JSON.parse(JSON.stringify(bind));
      bind.hipsPos = [0, ref.legLen > 0.3 ? ref.legLen : 0.95, 0];
    }
    var keys = [], prevDirs = {}, prevQuats = {}, prevDeltas = {};
    var heldTotal = 0;
    good.forEach(function (f, i) {
      var r = computeFrameQuats(f, { bind: bind, prevDirs: prevDirs, prevQuats: prevQuats, prevDeltas: prevDeltas, smooth: opts.smooth !== false });
      prevDirs = {};
      Object.keys(r.dirs).forEach(function (k) { if (r.dirs[k]) prevDirs[k] = r.dirs[k]; });
      prevQuats = r.quats;
      prevDeltas = {};
      BONE_SEGMENTS.forEach(function (seg) {
        if (r.dirs[seg.bone]) prevDeltas[seg.bone] = quatFromUnitVectors(bindRestDir(bind, seg), r.dirs[seg.bone]);
      });
      prevDeltas.Spine = prevDeltas.Spine || quatIdentity();
      heldTotal += r.heldCount;
      var pose = {};
      Object.keys(r.quats).forEach(function (bone) {
        var e = quatToEuler(r.quats[bone]);
        pose[bone] = { x: round4(e.x), y: round4(e.y), z: round4(e.z) };
      });
      var hp = hipsPosition(f, ref, { bind: bind, videoWidth: opts.videoWidth, videoHeight: opts.videoHeight, rootMotion: opts.rootMotion !== false });
      keys.push({
        t: round3(i / fps), pose: pose,
        hips: { x: round4(hp.pos[0]), y: round4(hp.pos[1]), z: round4(hp.pos[2]) },
        fk: { fkRotations: JSON.parse(JSON.stringify(pose)), fingerCurl: {}, fingerCurlAll: 0,
          footRoll: { Left: 0, Right: 0 }, spineRotations: {},
          headRotation: JSON.parse(JSON.stringify(pose.Head || { x: 0, y: 0, z: 0 })),
          neckRotation: JSON.parse(JSON.stringify(pose.Neck || { x: 0, y: 0, z: 0 })), jawOpen: 0 }
      });
    });
    var duration = keys.length > 1 ? keys[keys.length - 1].t : 0;
    return {
      ok: true, keys: keys, duration: duration, fps: fps,
      frameCount: frames.length, goodCount: good.length,
      heldSegments: heldTotal,
      boneCount: BONE_SEGMENTS.length + 1,
      bindSource: bind.source
    };
  }
  function tracksFromKeys(keys, boneFullName) {
    /* Mặc định: tên xương đã sanitize kiểu FBXLoader r128
       ('mixamorigHips', KHÔNG có ':') — vì PropertyBinding r128 coi
       ':' là phân cách thư mục: track 'mixamorig:Hips.quaternion'
       sẽ parse thành node 'Hips', không khớp bone 'mixamorig:Hips'
       rồi rơi về root (xoay cả model!). Khi có rig thật thì dùng
       đúng tên bone của rig (opts.boneFullName / snapshot). */
    boneFullName = boneFullName || function (b) { return 'mixamorig' + b; };
    var times = keys.map(function (k) { return round3(k.t); });
    var tracks = [];
    if (!keys.length) return tracks;
    var boneNames = {};
    keys.forEach(function (k) { Object.keys(k.pose || {}).forEach(function (n) { boneNames[n] = true; }); });
    Object.keys(boneNames).forEach(function (dst) {
      var values = [];
      keys.forEach(function (k) {
        var e = (k.pose && k.pose[dst]) || { x: 0, y: 0, z: 0 };
        var q = eulerToQuat(e); /* eulerToQuat nội bộ trả MẢNG [x,y,z,w] */
        values.push(round4(q[0]), round4(q[1]), round4(q[2]), round4(q[3]));
      });
      tracks.push({ name: boneFullName(dst) + '.quaternion', times: times.slice(), values: values });
    });
    if (keys.some(function (k) { return !!k.hips; })) {
      var vals = [];
      keys.forEach(function (k) {
        var h = k.hips || { x: 0, y: 0, z: 0 };
        vals.push(round4(h.x), round4(h.y), round4(h.z));
      });
      tracks.push({ name: boneFullName('Hips') + '.position', times: times.slice(), values: vals });
    }
    return tracks;
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
  function buildKeyframeJson(name, frames, opts) {
    opts = opts || {};
    var built = buildClipFromFrames(frames, opts);
    if (!built.ok) return built;
    var boneFullName = opts.boneFullName;
    if (!boneFullName) {
      var bind = opts.bind || Video.bindSnapshot;
      boneFullName = function (b) {
        if (bind && bind.bones && bind.bones[b] && bind.bones[b].fullName) return bind.bones[b].fullName;
        return 'mixamorig' + b; /* sanitize kiểu FBXLoader r128, xem tracksFromKeys */
      };
    }
    var tracks = tracksFromKeys(built.keys, boneFullName);
    var bad = validateTracks(tracks);
    if (bad.length) return { ok: false, error: 'Track lỗi: ' + bad[0] };
    var id = String(name || 'VideoClip').replace(/[^A-Za-z0-9_]+/g, '_') || 'VideoClip';
    var data = {
      format: FORMAT, character: 'video',
      skeleton: { boneNames: Object.keys(built.keys[0].pose), boneCount: Object.keys(built.keys[0].pose).length },
      clips: [{
        id: id, name: name || 'VideoClip', duration: built.duration, loop: false,
        source: 'arp-anim-video', fps: built.fps, keys: built.keys, tracks: tracks
      }]
    };
    return {
      ok: true, json: data, text: JSON.stringify(data, null, 1),
      filename: 'video_' + id + '_clips.json',
      keyCount: built.keys.length, duration: built.duration, fps: built.fps,
      trackCount: tracks.length, frameCount: built.frameCount,
      goodCount: built.goodCount, heldSegments: built.heldSegments,
      bindSource: built.bindSource
    };
  }
  function buildAnimationClip(name, frames, opts) {
    opts = opts || {};
    if (typeof window === 'undefined' || !window.THREE) return null;
    var r = buildKeyframeJson(name, frames, opts);
    if (!r.ok) return null;
    var tracks = [];
    r.json.clips[0].tracks.forEach(function (t) {
      if (/\.quaternion$/.test(t.name)) tracks.push(new window.THREE.QuaternionKeyframeTrack(t.name, t.times, t.values));
      else if (/\.position$/.test(t.name)) tracks.push(new window.THREE.VectorKeyframeTrack(t.name, t.times, t.values));
    });
    return new window.THREE.AnimationClip(name || 'VideoClip', Math.max(r.duration, 0.001), tracks);
  }
  /* Đưa clip vào Animator: ưu tiên Keyframe.importClip (sync sẽ hiện
     entry 'keyframe:<tên>' trong Animator); fallback registerClip. */
  function sendToAnimator(name, frames, opts) {
    opts = opts || {};
    var r = buildKeyframeJson(name, frames, opts);
    if (!r.ok) return r;
    var KF = (PS.ArpQuickRig && PS.ArpQuickRig.Keyframe) || null;
    if (KF && typeof KF.importClip === 'function') {
      var imp = KF.importClip(r.json);
      if (imp && imp.ok) {
        Video.clipJson = r.json;
        Video.clipName = name || 'VideoClip';
        try { bus.emit('arp:animator-clip-changed', { kind: 'video-imported', name: Video.clipName, at: Date.now() }); } catch (e) {}
        notify('success', 'Video → Animation', 'Clip "' + Video.clipName + '" đã vào Keyframe/Animator — mở tab Animator để phát.');
        return { ok: true, via: 'keyframe', name: Video.clipName, keyCount: r.keyCount, duration: r.duration, trackCount: r.trackCount };
      }
      return { ok: false, error: 'Keyframe.importClip lỗi: ' + (imp && imp.error) };
    }
    var AN = PS.ArpAnimator || null;
    if (AN && typeof AN.registerClip === 'function') {
      var clip = buildAnimationClip(name, frames, opts);
      if (!clip) return { ok: false, error: 'Không dựng được THREE.AnimationClip (thiếu THREE?).' };
      var reg = AN.registerClip({ name: name || 'VideoClip', clip: clip, source: 'user', fps: r.fps });
      if (reg && reg.ok === false) return { ok: false, error: reg.error || 'registerClip lỗi.' };
      Video.clipJson = r.json;
      Video.clipName = name || 'VideoClip';
      return { ok: true, via: 'animator', name: Video.clipName, keyCount: r.keyCount, duration: r.duration, trackCount: r.trackCount };
    }
    /* Không có Keyframe/Animator: trả JSON để user tải về nhập tay. */
    Video.clipJson = r.json;
    Video.clipName = name || 'VideoClip';
    return { ok: true, via: 'json-only', name: Video.clipName, keyCount: r.keyCount, duration: r.duration, trackCount: r.trackCount,
      warning: 'Không thấy Keyframe/Animator — clip chỉ lưu dạng JSON, dùng nút "Tải JSON" rồi nhập lại.' };
  }

  /* ================= nạp MediaPipe ================= */
  function defaultLoader(url) { return import(url); } /* dynamic import ESM */
  /* Nạp MediaPipe: dynamic import() bundle ESM (tasks-vision KHÔNG có
     bản UMD). opts.bundleUrl/wasmUrl/modelUrl cho phép tự host bundle
     (khi CDN bị chặn) — mặc định dùng CDN jsdelivr, fallback unpkg. */
  function loadVision(opts) {
    opts = opts || {};
    var model = opts.model || Video.modelName || 'lite';
    var delegate = opts.delegate || Video.delegate || 'CPU';
    var modelUrl = opts.modelUrl || (model === 'full' ? MODEL_FULL_URL : (model === 'heavy' ? MODEL_HEAVY_URL : MODEL_LITE_URL));
    var loader = Video._loader || defaultLoader;
    setState('loading');
    var bases = opts.bundleUrl ? [null] : [CDN_BASE, CDN_FALLBACK_BASE];
    var lastErr = null;
    function tryBase(i) {
      if (i >= bases.length) {
        setState('error', 'Không nạp được @mediapipe/tasks-vision từ CDN (jsdelivr + unpkg đều lỗi: ' + (lastErr || '?') + '). Kiểm tra mạng rồi bấm "Nạp lại".');
        return Promise.resolve({ ok: false, error: Video.error });
      }
      var base = bases[i];
      var bundleUrl = opts.bundleUrl || (base + '/vision_bundle.mjs');
      var wasmUrl = opts.wasmUrl || (base + '/wasm');
      return loader(bundleUrl).then(function (vision) {
        Video.visionModule = vision;
        return vision.FilesetResolver.forVisionTasks(wasmUrl);
      }).then(function (fileset) {
        return Video.visionModule.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelUrl, delegate: delegate },
          runningMode: 'VIDEO', numPoses: 1,
          minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5
        });
      }).then(function (lm) {
        Video.landmarker = lm;
        Video.modelName = model;
        Video.delegate = delegate;
        setState('ready');
        notify('success', 'Video → Animation', 'Đã nạp MediaPipe Pose Landmarker (' + model + ', ' + delegate + ').');
        return { ok: true, model: model, delegate: delegate };
      }).catch(function (e) {
        lastErr = e && e.message ? e.message : String(e);
        return tryBase(i + 1);
      });
    }
    return tryBase(0);
  }
  /* Trích pose từ <video> đang phát: lấy mẫu theo fps trích, timestamp
     tăng đơn điệu (VIDEO mode bắt buộc). onProgress({done,total,frames}). */
  function extractFromVideo(videoEl, opts, onProgress) {
    opts = opts || {};
    var fps = opts.fps || 15;
    if (!Video.landmarker) return Promise.resolve({ ok: false, error: 'Chưa nạp MediaPipe — bấm "Nạp MediaPipe" trước.' });
    if (!videoEl || !videoEl.duration) return Promise.resolve({ ok: false, error: 'Chưa có video.' });
    setState('extracting');
    Video._cancel = false;
    var frames = [];
    var step = 1 / fps, lastT = -1, lastTs = 0, t0 = Date.now();
    var duration = videoEl.duration;
    return new Promise(function (resolve) {
      function tick() {
        if (Video._cancel) {
          try { videoEl.pause(); } catch (e) {}
          setState('ready');
          resolve({ ok: false, cancelled: true, frames: frames });
          return;
        }
        var ct = videoEl.currentTime || 0;
        if (ct >= duration - 0.05 || videoEl.ended) {
          try { videoEl.pause(); } catch (e) {}
          finish();
          return;
        }
        if (ct - lastT >= step - 1e-6) {
          lastT = ct;
          var ts = Math.round(ct * 1000);
          if (ts <= lastTs) ts = lastTs + 1;
          lastTs = ts;
          var res = null;
          try { res = Video.landmarker.detectForVideo(videoEl, ts); } catch (e) {
            setState('error', 'detectForVideo lỗi: ' + (e && e.message));
            resolve({ ok: false, error: Video.error, frames: frames });
            return;
          }
          var w = res && res.worldLandmarks && res.worldLandmarks[0];
          var im = res && res.landmarks && res.landmarks[0];
          frames.push({ t: ct, world: w ? w.map(function (l) { return { x: l.x, y: l.y, z: l.z, visibility: l.visibility }; }) : null,
            image: im ? im.map(function (l) { return { x: l.x, y: l.y, z: l.z, visibility: l.visibility }; }) : null,
            ok: !!(w && w.length >= 33) });
          if (typeof onProgress === 'function') {
            try { onProgress({ done: ct, total: duration, frames: frames.length, ok: frames[frames.length - 1].ok, videoEl: videoEl, lastFrame: frames[frames.length - 1] }); } catch (e) {}
          }
        } else if (typeof onProgress === 'function') {
          try { onProgress({ done: ct, total: duration, frames: frames.length, ok: null, videoEl: videoEl, lastFrame: frames[frames.length - 1] || null }); } catch (e) {}
        }
        setTimeout(tick, 30);
      }
      function finish() {
        var good = frames.filter(function (f) { return f.ok; }).length;
        Video.frames = frames;
        Video.lastStats = { frames: frames.length, good: good, fps: fps,
          seconds: Math.round((Date.now() - t0) / 100) / 10, duration: duration };
        setState('done');
        resolve({ ok: good > 0, frames: frames, good: good, stats: Video.lastStats,
          error: good ? null : 'Không trích được pose ở frame nào — kiểm tra video có người toàn thân, đủ sáng không.' });
      }
      try {
        var p = videoEl.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (e) {}
      setTimeout(tick, 50);
    });
  }
  function cancelExtract() { Video._cancel = true; }

  /* ================= overlay skeleton 2D ================= */
  function drawOverlay(canvas, imageLandmarks, opts) {
    opts = opts || {};
    if (!canvas || !imageLandmarks) return { ok: false, error: 'Thiếu canvas/landmarks.' };
    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) {}
    if (!ctx) return { ok: false, error: 'Canvas 2D không khả dụng.' };
    var W = canvas.width || 640, H = canvas.height || 360;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = opts.lineWidth || 2;
    ctx.strokeStyle = opts.color || '#22d3ee';
    ctx.fillStyle = opts.color || '#22d3ee';
    var drawn = 0, lowVis = 0;
    POSE_CONNECTIONS.forEach(function (c) {
      var a = imageLandmarks[c[0]], b = imageLandmarks[c[1]];
      if (!a || !b) return;
      if ((a.visibility !== undefined && a.visibility < MIN_VISIBILITY) ||
        (b.visibility !== undefined && b.visibility < MIN_VISIBILITY)) { lowVis++; return; }
      ctx.beginPath();
      ctx.moveTo(a.x * W, a.y * H);
      ctx.lineTo(b.x * W, b.y * H);
      ctx.stroke();
      drawn++;
    });
    imageLandmarks.forEach(function (l) {
      if (!l) return;
      ctx.beginPath();
      ctx.arc(l.x * W, l.y * H, opts.pointRadius || 3, 0, Math.PI * 2);
      ctx.fill();
    });
    return { ok: true, lines: drawn, lowVis: lowVis };
  }

  /* ================= UI — tab ARP ================= */
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
    var wrap = el('div', { class: 'avv-wrap' });
    wrap.appendChild(el('div', { class: 'arp-note', text: 'Video → Animation (stretch goal): trích pose người từ video bằng MediaPipe Pose Landmarker rồi dựng clip phát trong Animator. ' + LIMITS_TEXT }));
    var videoWrap = el('div', { class: 'avv-video-wrap' });
    var video = el('video', { class: 'avv-video', controls: true, muted: true, playsinline: true, preload: 'auto' });
    var overlay = el('canvas', { class: 'avv-overlay' });
    videoWrap.appendChild(video);
    videoWrap.appendChild(overlay);
    wrap.appendChild(videoWrap);
    var row1 = el('div', { class: 'arp-row' });
    var fileInput = el('input', { type: 'file', accept: 'video/*', class: 'arp-input', style: { flex: '1' } });
    row1.appendChild(fileInput);
    wrap.appendChild(row1);
    var row2 = el('div', { class: 'arp-row' });
    var fpsSel = el('select', { class: 'arp-select', title: 'FPS trích xuất' });
    [10, 15, 24].forEach(function (f) {
      var o = el('option', { value: String(f), text: 'Trích ' + f + ' fps' });
      if (f === 15) o.selected = true;
      fpsSel.appendChild(o);
    });
    var modelSel = el('select', { class: 'arp-select', title: 'Model MediaPipe' });
    [['lite', 'Model Lite (nhanh)'], ['full', 'Model Full'], ['heavy', 'Model Heavy (nặng)']].forEach(function (m) {
      var o = el('option', { value: m[0], text: m[1] });
      if (m[0] === 'lite') o.selected = true;
      modelSel.appendChild(o);
    });
    var delSel = el('select', { class: 'arp-select', title: 'Delegate' });
    [['CPU', 'CPU'], ['GPU', 'GPU (nhanh hơn nếu máy hỗ trợ)']].forEach(function (m) {
      var o = el('option', { value: m[0], text: m[1] });
      if (m[0] === 'CPU') o.selected = true;
      delSel.appendChild(o);
    });
    row2.appendChild(fpsSel); row2.appendChild(modelSel); row2.appendChild(delSel);
    wrap.appendChild(row2);
    var row3 = el('div', { class: 'arp-row' });
    var btnLoad = el('button', { class: 'arp-btn', text: '1. Nạp MediaPipe' });
    var btnExtract = el('button', { class: 'arp-btn arp-btn-primary', text: '2. Trích xuất pose' });
    var btnClip = el('button', { class: 'arp-btn arp-btn-primary', text: '3. Tạo clip → Animator' });
    var btnBind = el('button', { class: 'arp-btn', text: 'Chụp bind pose (T-pose)' });
    row3.appendChild(btnLoad); row3.appendChild(btnExtract); row3.appendChild(btnClip); row3.appendChild(btnBind);
    wrap.appendChild(row3);
    var row4 = el('div', { class: 'arp-row' });
    var btnJson = el('button', { class: 'arp-btn', text: 'Tải clip JSON' });
    var btnCancel = el('button', { class: 'arp-btn', text: 'Hủy trích xuất' });
    var rootChk = el('label', { class: 'avv-check' }, [
      el('input', { type: 'checkbox', checked: true }), document.createTextNode(' Root motion (Hips di chuyển theo video)')
    ]);
    row4.appendChild(btnJson); row4.appendChild(btnCancel); row4.appendChild(rootChk);
    wrap.appendChild(row4);
    var prog = el('div', { class: 'avv-progress' }, [el('div', { class: 'avv-progress-bar', style: { width: '0%' } })]);
    var status = el('div', { class: 'arp-note avv-status', text: 'Trạng thái: chưa nạp MediaPipe. Chọn video rồi bấm (1) — cần mạng để tải model (~6MB) lần đầu.' });
    var stats = el('div', { class: 'arp-note avv-stats', text: '' });
    wrap.appendChild(prog); wrap.appendChild(status); wrap.appendChild(stats);
    container.appendChild(wrap);

    var bar = prog.firstChild;
    var videoUrl = null;
    function setStatus(t) { status.textContent = t; }
    function setBar(p) { bar.style.width = clamp(Math.round(p * 100), 0, 100) + '%'; }
    function sizeOverlay() {
      try {
        overlay.width = video.videoWidth || 640;
        overlay.height = video.videoHeight || 360;
      } catch (e) {}
    }
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (videoUrl) { try { URL.revokeObjectURL(videoUrl); } catch (e) {} }
      videoUrl = URL.createObjectURL(f);
      video.src = videoUrl;
      video.load();
      setStatus('Đã chọn video: ' + f.name + ' (' + Math.round(f.size / 1024) + ' KB). Bấm (1) nạp MediaPipe rồi (2) trích xuất.');
    });
    video.addEventListener('loadedmetadata', sizeOverlay);
    btnLoad.addEventListener('click', function () {
      setStatus('Đang nạp MediaPipe tasks-vision@' + TASKS_VISION_VERSION + ' từ CDN (jsdelivr, fallback unpkg) + model ' + modelSel.value + '…');
      loadVision({ model: modelSel.value, delegate: delSel.value }).then(function (r) {
        setStatus(r.ok ? 'Đã nạp xong MediaPipe (' + r.model + ', ' + r.delegate + '). Bấm (2) để trích xuất.'
          : 'Lỗi nạp MediaPipe: ' + (r.error || '?'));
      });
    });
    btnBind.addEventListener('click', function () {
      var target = null;
      try { target = (PS.Viewport && typeof PS.Viewport.getMainModel === 'function') ? PS.Viewport.getMainModel() : null; } catch (e) {}
      if (!target) { setStatus('Chưa có model trong viewport — nạp/rig 1 model, đưa về T-pose rồi bấm lại. (Không bắt buộc: không có bind thì dùng bind ảo.)'); return; }
      var r = captureBind(target);
      if (!r.ok) { setStatus('Chụp bind pose lỗi: ' + r.error); return; }
      Video.bindSnapshot = r.bind;
      setStatus('Đã chụp bind pose từ model (' + Object.keys(r.bind.bones).length + ' xương, nguồn: skeleton). Clip trích ra sẽ khớp đúng rig này.');
    });
    btnExtract.addEventListener('click', function () {
      if (!video.src) { setStatus('Chưa chọn video — bấm "Choose file" trước.'); return; }
      if (!Video.landmarker) { setStatus('Chưa nạp MediaPipe — bấm (1) trước.'); return; }
      sizeOverlay();
      setStatus('Đang trích xuất… (phát video theo thời gian thực)');
      extractFromVideo(video, { fps: parseInt(fpsSel.value, 10) || 15 }, function (p) {
        setBar(p.total ? p.done / p.total : 0);
        if (p.lastFrame && p.lastFrame.image) drawOverlay(overlay, p.lastFrame.image);
        setStatus('Đang trích: ' + p.done.toFixed(1) + 's / ' + p.total.toFixed(1) + 's — ' + p.frames + ' frame' +
          (p.ok === false ? ' (frame này không thấy người — giữ pose cũ)' : ''));
      }).then(function (r) {
        setBar(r.ok ? 1 : 0);
        if (r.ok) {
          stats.textContent = 'Trích xong: ' + r.stats.frames + ' frame, ' + r.stats.good + ' frame có pose (' +
            Math.round(100 * r.stats.good / Math.max(1, r.stats.frames)) + '%), ' + r.stats.seconds + 's. Bấm (3) để tạo clip.';
          setStatus('Trích xong — bấm (3) Tạo clip → Animator.');
        } else setStatus('Trích xuất lỗi: ' + (r.error || 'đã hủy') + ' (' + (r.frames || []).length + ' frame đã trích).');
      });
    });
    btnCancel.addEventListener('click', function () { cancelExtract(); setStatus('Đã yêu cầu hủy trích xuất.'); });
    btnClip.addEventListener('click', function () {
      if (!Video.frames.length) { setStatus('Chưa có frame nào — trích xuất (2) trước.'); return; }
      var name = (Video.clipName || 'VideoClip');
      var rootMotion = true;
      try { rootMotion = rootChk.querySelector('input').checked; } catch (e) {}
      var r = sendToAnimator(name, Video.frames, {
        fps: parseInt(fpsSel.value, 10) || 15,
        rootMotion: rootMotion,
        videoWidth: video.videoWidth || 1280, videoHeight: video.videoHeight || 720
      });
      if (r.ok) {
        stats.textContent = 'Clip "' + r.name + '": ' + r.keyCount + ' keys, ' + r.duration.toFixed(2) + 's, ' +
          r.trackCount + ' tracks — qua đường ' + r.via + '. Mở tab Animator để phát thử.' + (r.warning ? ' ' + r.warning : '');
        setStatus('Đã tạo clip "' + r.name + '" (' + r.via + '). Mở tab Animator → tìm clip để phát.');
      } else setStatus('Tạo clip lỗi: ' + (r.error || '?'));
    });
    btnJson.addEventListener('click', function () {
      if (!Video.clipJson) { setStatus('Chưa có clip — bấm (3) trước.'); return; }
      if (U && typeof U.downloadText === 'function') {
        U.downloadText(JSON.stringify(Video.clipJson, null, 1), 'video_' + (Video.clipName || 'VideoClip') + '_clips.json', 'application/json');
        setStatus('Đã tải clip JSON.');
      } else setStatus('Không có hàm tải file trong studio.');
    });
  }

  var AnimVideo = {
    VERSION: '1.0.0',
    TASKS_VISION_VERSION: TASKS_VISION_VERSION,
    CDN_BASE: CDN_BASE, CDN_FALLBACK_BASE: CDN_FALLBACK_BASE,
    MODEL_LITE_URL: MODEL_LITE_URL, MODEL_FULL_URL: MODEL_FULL_URL, MODEL_HEAVY_URL: MODEL_HEAVY_URL,
    FORMAT: FORMAT, LIMITS_TEXT: LIMITS_TEXT,
    LANDMARK_NAMES: LANDMARK_NAMES, POSE_CONNECTIONS: POSE_CONNECTIONS,
    BONE_SEGMENTS: BONE_SEGMENTS,
    Video: Video, /* trạng thái chạy: Video.state / .frames / .lastStats */
    getState: function () { return Video.state; },
    mapWorldLandmark: mapWorldLandmark,
    segmentDir: segmentDir,
    virtualBind: virtualBind,
    captureBind: captureBind,
    bindRestDir: bindRestDir,
    computeFrameQuats: computeFrameQuats,
    hipsPosition: hipsPosition,
    hipsReference: hipsReference,
    buildClipFromFrames: buildClipFromFrames,
    buildKeyframeJson: buildKeyframeJson,
    buildAnimationClip: buildAnimationClip,
    sendToAnimator: sendToAnimator,
    loadVision: loadVision,
    extractFromVideo: extractFromVideo,
    cancelExtract: cancelExtract,
    drawOverlay: drawOverlay,
    renderSection: renderSection,
    setVisionModule: function (mod) { Video.visionModule = mod; },
    setLoader: function (fn) { Video._loader = fn; },
    _test: {
      quatFromUnitVectors: quatFromUnitVectors, quatMul: quatMul, quatInv: quatInv,
      quatSlerp: quatSlerp, quatApply: quatApply, quatToEuler: quatToEuler,
      eulerToQuat: eulerToQuat, v3norm: v3norm, v3sub: v3sub, validateTracks: validateTracks,
      tracksFromKeys: tracksFromKeys, MIN_VISIBILITY: MIN_VISIBILITY
    }
  };

  if (typeof window !== 'undefined') {
    window.PixiStudio = window.PixiStudio || {};
    window.PixiStudio.ArpAnimVideo = AnimVideo;
    try {
      var Panel = window.PixiStudio.ArpPanel;
      if (Panel && typeof Panel.registerTab === 'function') {
        Panel.registerTab('anim-video', 'Video → Anim', renderSection);
      }
    } catch (e) {}
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = AnimVideo;
})();
