/* ============================================================================
 * js/rig/arp-animal-presets.js — NHÓM 6: Rig preset cho động vật (phi-humanoid)
 * ----------------------------------------------------------------------------
 * Preset rig cho model KHÔNG phải humanoid, dùng chung với tab Smart
 * (marker + boneDefs) và Quick Rig (map xương theo preset thay vì ép
 * 41 xương Mixamo humanoid).
 *
 *   PixiStudio.ArpAnimalPresets
 *     .PRESETS            { humanoid, quadruped, robot, bird }
 *     .listIds() / .listPresets() / .getPreset(id)
 *     .boneDefs(id)       [{ name, parent, role, side, required, positionFrom?, match? }]
 *     .markerDefs(id)     marker Smart gợi ý cho preset
 *     .controls(id)       { ikChains, fkBones }
 *     .normalizeSrcName(name)  chuẩn hóa tên xương nguồn (b_, mixamorig:, .L/.R, _015, _end)
 *     .mapBones(skeleton, presetId)  map xương nguồn → xương đích preset
 *         trả về cùng shape với QuickRig.mapBones:
 *         { preset, mapped:[{src,dst,method:'animal-name',bone}], unmapped,
 *           missing, coverage (% đích), sourceCoverage (% nguồn),
 *           mappedCount, total, method, bones }
 *     .detectPreset(skeleton)  đoán preset phù hợp nhất theo tên xương
 *     .resolvePositions(pos, presetId)  suy vị trí khớp preset từ vị trí
 *         humanoid (boneWorldPositions) — dùng cho ghost preview trong Smart.
 *     .KNOWN_MAPS         bảng map đã kiểm chứng trên model thật (Fox.glb …)
 *
 * QUY TẮC MAP: khớp theo TÊN đã chuẩn hóa (regex theo từng xương đích,
 * duyệt xương nguồn theo thứ tự scene-graph, xương đích nào khớp trước
 * thì giữ — không ghi đè). Không đoán theo vị trí/hierarchy: động vật
 * nằm ngang, heuristic humanoid (Hips ≈ 0.52H, tay = nhánh Spine2…)
 * không áp dụng được.
 *
 * GIỚI HẠN THẬT (ghi rõ, không giấu):
 *   • Preset chỉ cung cấp boneDefs + marker + quy tắc map + vị trí ghost
 *     ước lượng từ bbox/landmark humanoid. AutoRigPro.run() (variantBoneDefs
 *     + buildSkeleton) hiện chỉ biết humanoid — rig TỰ ĐỘNG qua tab Smart
 *     với preset động vật CHƯA làm được trong vòng này (cần sửa
 *     auto-rig-pro.js, ngoài phạm vi file được phép sửa); ArpSmart.rig()
 *     chặn lại kèm cảnh báo thay vì rig lén 41 xương humanoid lên thú.
 *   • Quick Rig map được xương có sẵn của model (Fox/XBot…); control
 *     IK/FK cho preset động vật mới ở mức khai báo chuỗi IK + danh sách
 *     FK — chưa có control rig chuyên biệt (pole chân trước/sau, IK đuôi)
 *     như humanoid.
 *   • Vị trí ghost của quadruped/bird là ƯỚC LƯỢNG từ bbox (lưng ngang,
 *     chân thẳng xuống đất) — cần chỉnh marker tay trước khi rig thật.
 * ========================================================================== */
(function (global) {
  'use strict';
  var PS = global.PixiStudio = global.PixiStudio || {};
  var AP = {};
  PS.ArpAnimalPresets = AP;

  /* ---------- Chuẩn hóa tên xương nguồn ----------
     "b_LeftLeg01_015" → "leftleg01"   (Fox.glb)
     "mixamorig:LeftArm" → "leftarm"   (XBot.fbx)
     "UpperArm.L" → "leftupperarm"     (RobotExpressive.glb, Blender .L/.R)
     "Head_end" → "head"               (đuôi _end)
     "Model:mixamorig:Hips" → "hips"   (FBXLoader parse lại) */
  function normalizeSrcName(name) {
    var s = String(name == null ? '' : name);
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    s = s.replace(/^b_/, '');                 /* tiền tố Fox b_ */
    var side = '';
    var m = s.match(/\.([LRlr])$/);
    if (m) { side = (m[1].toLowerCase() === 'l') ? 'left' : 'right'; s = s.slice(0, -2); }
    s = s.replace(/_end$/i, '');
    s = s.replace(/_+\d+$/, '');              /* hậu tố số thứ tự Fox _015,
                                                 hậu tố đổi tên trùng của
                                                 GLTFLoader _1 (Torso_1) */
    /* GLTFLoader r128 bỏ dấu '.' trong tên: "Shoulder.L" → "ShoulderL",
       "Foot.L" → "FootL". Chữ L/R HOA cuối tên là phía trái/phải kiểu
       Blender (chỉ khi ký tự trước là chữ thường/số — "Tail" chữ l
       thường không dính). */
    var m2 = s.match(/([LR])$/);
    if (m2 && s.length > 1 && /[a-z0-9]/.test(s.charAt(s.length - 2))) {
      side = (m2[1] === 'L') ? 'left' : 'right';
      s = s.slice(0, -1);
    }
    s = s.replace(/[^A-Za-z0-9]/g, '');
    s = s.toLowerCase();
    if (side && s.indexOf('left') !== 0 && s.indexOf('right') !== 0) s = side + s;
    return s;
  }
  AP.normalizeSrcName = normalizeSrcName;

  function rx(list) {
    return (list || []).map(function (p) { return new RegExp(p, 'i'); });
  }
  function B(name, parent, role, side, required, extra) {
    var d = { name: name, parent: parent, role: role, side: side || null, required: !!required };
    if (extra) Object.keys(extra).forEach(function (k) { d[k] = extra[k]; });
    return d;
  }

  /* ==================================================================
     PRESET 1 — HUMANOID (tham chiếu, 41 xương Mixamo — y như QuickRig)
     ================================================================== */
  var HUMANOID_BONES = [
    B('Hips', null, 'root', null, true), B('Spine', 'Hips', 'spine', null, true),
    B('Spine1', 'Spine', 'spine', null, true), B('Spine2', 'Spine1', 'spine', null, true),
    B('Neck', 'Spine2', 'neck', null, true), B('Head', 'Neck', 'head', null, true),
    B('HeadTop_End', 'Head', 'head', null, false),
    B('LeftShoulder', 'Spine2', 'shoulder', 'L', true), B('LeftArm', 'LeftShoulder', 'arm', 'L', true),
    B('LeftForeArm', 'LeftArm', 'arm', 'L', true), B('LeftHand', 'LeftForeArm', 'hand', 'L', true),
    B('LeftHandThumb1', 'LeftHand', 'finger', 'L', false), B('LeftHandThumb2', 'LeftHandThumb1', 'finger', 'L', false),
    B('LeftHandIndex1', 'LeftHand', 'finger', 'L', false), B('LeftHandIndex2', 'LeftHandIndex1', 'finger', 'L', false),
    B('LeftHandMiddle1', 'LeftHand', 'finger', 'L', false), B('LeftHandMiddle2', 'LeftHandMiddle1', 'finger', 'L', false),
    B('LeftHandRing1', 'LeftHand', 'finger', 'L', false), B('LeftHandRing2', 'LeftHandRing1', 'finger', 'L', false),
    B('LeftHandPinky1', 'LeftHand', 'finger', 'L', false),
    B('RightShoulder', 'Spine2', 'shoulder', 'R', true), B('RightArm', 'RightShoulder', 'arm', 'R', true),
    B('RightForeArm', 'RightArm', 'arm', 'R', true), B('RightHand', 'RightForeArm', 'hand', 'R', true),
    B('RightHandThumb1', 'RightHand', 'finger', 'R', false), B('RightHandThumb2', 'RightHandThumb1', 'finger', 'R', false),
    B('RightHandIndex1', 'RightHand', 'finger', 'R', false), B('RightHandIndex2', 'RightHandIndex1', 'finger', 'R', false),
    B('RightHandMiddle1', 'RightHand', 'finger', 'R', false), B('RightHandMiddle2', 'RightHandMiddle1', 'finger', 'R', false),
    B('RightHandRing1', 'RightHand', 'finger', 'R', false), B('RightHandRing2', 'RightHandRing1', 'finger', 'R', false),
    B('RightHandPinky1', 'RightHand', 'finger', 'R', false),
    B('LeftUpLeg', 'Hips', 'leg', 'L', true), B('LeftLeg', 'LeftUpLeg', 'leg', 'L', true),
    B('LeftFoot', 'LeftLeg', 'foot', 'L', true), B('LeftToeBase', 'LeftFoot', 'toe', 'L', false),
    B('RightUpLeg', 'Hips', 'leg', 'R', true), B('RightLeg', 'RightUpLeg', 'leg', 'R', true),
    B('RightFoot', 'RightLeg', 'foot', 'R', true), B('RightToeBase', 'RightFoot', 'toe', 'R', false)
  ];

  /* ==================================================================
     PRESET 2 — QUADRUPED (4 chân: chó/mèo/ngựa) — 26 xương
     Cột sống dài 3 đốt (Spine1/2/3, hơn humanoid 3 đốt → 3 đốt + Hips),
     4 chân, cổ + đầu, đuôi 3 đốt. KHÔNG có xương tay/ngón tay.
     Chân trước = vai→khuỷu→cổ chân (UpperArm/ForeArm/Hand của Fox),
     chân sau = hông→gối→cổ chân→bàn chân (Leg01/Leg02/Foot01/Foot02).
     ================================================================== */
  function quadLeg(side, front) {
    var S = side === 'L' ? 'Left' : 'Right';
    var s = side === 'L' ? 'left' : 'right';
    if (front) {
      return [
        B(S + 'FrontShoulder', 'Spine3', 'front-leg', side, true,
          { match: rx(['^' + s + 'upperarm$', '^' + s + 'shoulder$', '^' + s + 'frontleg0?1$', '^' + s + 'frontleg$', '^' + s + 'foreleg0?1$']) }),
        B(S + 'FrontElbow', S + 'FrontShoulder', 'front-leg', side, true,
          { match: rx(['^' + s + 'forearm$', '^' + s + 'frontleg0?2$', '^' + s + 'elbow$', '^' + s + 'foreleg0?2$']) }),
        B(S + 'FrontWrist', S + 'FrontElbow', 'front-leg', side, true,
          { match: rx(['^' + s + 'hand$', '^' + s + 'frontleg0?3$', '^' + s + 'frontpaw$', '^' + s + 'wrist$', '^' + s + 'foreleg0?3$']) }),
        B(S + 'FrontPaw', S + 'FrontWrist', 'front-paw', side, false,
          { match: rx(['^' + s + 'frontpaw0?2$', '^' + s + 'hand0?2$', '^' + s + 'fronttoe']) })
      ];
    }
    return [
      B(S + 'Hip', 'Hips', 'hind-leg', side, true,
        { match: rx(['^' + s + 'leg0?1$', '^' + s + 'hindleg0?1$', '^' + s + 'hip$', '^' + s + 'thigh$']) }),
      B(S + 'Knee', S + 'Hip', 'hind-leg', side, true,
        { match: rx(['^' + s + 'leg0?2$', '^' + s + 'hindleg0?2$', '^' + s + 'knee$']) }),
      B(S + 'Ankle', S + 'Knee', 'hind-leg', side, true,
        { match: rx(['^' + s + 'foot0?1$', '^' + s + 'foot$', '^' + s + 'ankle$', '^' + s + 'hindleg0?3$']) }),
      B(S + 'HindPaw', S + 'Ankle', 'hind-paw', side, false,
        { match: rx(['^' + s + 'foot0?2$', '^' + s + 'hindpaw$', '^' + s + 'toe']) })
    ];
  }
  var QUADRUPED_BONES = [
    B('Root', null, 'root', null, true, { match: rx(['^_?rootjoint$', '^root$', '^rootnode$']) }),
    B('Hips', 'Root', 'pelvis', null, true, { match: rx(['^hips?$', '^pelvis$']) }),
    B('Spine1', 'Hips', 'spine', null, true, { match: rx(['^spine01$', '^spine$', '^chest$']) }),
    B('Spine2', 'Spine1', 'spine', null, true, { match: rx(['^spine02$', '^spine1$']) }),
    B('Spine3', 'Spine2', 'spine', null, false, { match: rx(['^spine03$', '^spine2$', '^withers$']) }),
    B('Neck', 'Spine3', 'neck', null, true, { match: rx(['^neck$']) }),
    B('Head', 'Neck', 'head', null, true, { match: rx(['^head$']) })
  ].concat(quadLeg('L', true), quadLeg('R', true), quadLeg('L', false), quadLeg('R', false), [
    B('Tail1', 'Hips', 'tail', null, true, { match: rx(['^tail0?1$']) }),
    B('Tail2', 'Tail1', 'tail', null, true, { match: rx(['^tail0?2$']) }),
    B('Tail3', 'Tail2', 'tail', null, false, { match: rx(['^tail0?3$']) })
  ]);

  /* ==================================================================
     PRESET 3 — ROBOT (khớp cứng) — 17 xương
     Ít xương, khớp bản lề 1 trục chính (joint:'hinge'), KHÔNG twist,
     KHÔNG ngón tay. Vai/hông dạng bản lề. Tên chuẩn robot:
     Base/Shoulder/Elbow/Wrist/Hip/Knee/Ankle.
     ================================================================== */
  function robotArm(side) {
    var S = side === 'L' ? 'Left' : 'Right';
    var s = side === 'L' ? 'left' : 'right';
    return [
      B(S + 'Shoulder', 'Spine', 'arm-hinge', side, true,
        { joint: 'hinge', axes: ['x'], match: rx(['^' + s + 'shoulder$', '^' + s + 'upperarm$']) }),
      B(S + 'Elbow', S + 'Shoulder', 'arm-hinge', side, true,
        { joint: 'hinge', axes: ['x'], match: rx(['^' + s + 'forearm$', '^' + s + 'lowerarm$', '^' + s + 'elbow$']) }),
      B(S + 'Wrist', S + 'Elbow', 'arm-hinge', side, true,
        { joint: 'hinge', axes: ['x'], match: rx(['^' + s + 'hand$', '^' + s + 'wrist$', '^' + s + 'palm', '^' + s + 'gripper$', '^' + s + 'claw$']) })
    ];
  }
  function robotLeg(side) {
    var S = side === 'L' ? 'Left' : 'Right';
    var s = side === 'L' ? 'left' : 'right';
    return [
      B(S + 'Hip', 'Hips', 'leg-hinge', side, true,
        { joint: 'hinge', axes: ['x'], match: rx(['^' + s + 'upleg$', '^' + s + 'upperleg$', '^' + s + 'hip$', '^' + s + 'thigh$']) }),
      B(S + 'Knee', S + 'Hip', 'leg-hinge', side, true,
        { joint: 'hinge', axes: ['x'], match: rx(['^' + s + 'leg$', '^' + s + 'lowerleg$', '^' + s + 'knee$', '^' + s + 'shin$']) }),
      B(S + 'Ankle', S + 'Knee', 'leg-hinge', side, true,
        { joint: 'hinge', axes: ['x'], match: rx(['^' + s + 'foot$', '^' + s + 'ankle$']) })
    ];
  }
  var ROBOT_BONES = [
    B('Base', null, 'root', null, true, { match: rx(['^_?rootjoint$', '^root$', '^bone$', '^base$', '^rootnode$']) }),
    B('Hips', 'Base', 'pelvis', null, true, { match: rx(['^hips?$', '^pelvis$']) }),
    B('Spine', 'Hips', 'spine', null, true,
      { positionFrom: 'Spine1', match: rx(['^spine$', '^torso$', '^abdomen$', '^chest$']) }),
    B('Neck', 'Spine', 'neck', null, true, { match: rx(['^neck$']) }),
    B('Head', 'Neck', 'head', null, true, { match: rx(['^head$']) })
  ].concat(robotArm('L'), robotArm('R'), robotLeg('L'), robotLeg('R'));
  /* Vị trí ghost robot lấy từ vị trí humanoid tương đương. */
  { var _rp = { Base: 'Hips', Hips: 'Hips', Neck: 'Neck', Head: 'Head' };
    ROBOT_BONES.forEach(function (d) {
      if (d.name === 'LeftShoulder') d.positionFrom = 'LeftShoulder';
      else if (d.name === 'RightShoulder') d.positionFrom = 'RightShoulder';
      else if (d.name === 'LeftElbow') d.positionFrom = 'LeftForeArm';
      else if (d.name === 'RightElbow') d.positionFrom = 'RightForeArm';
      else if (d.name === 'LeftWrist') d.positionFrom = 'LeftHand';
      else if (d.name === 'RightWrist') d.positionFrom = 'RightHand';
      else if (d.name === 'LeftHip') d.positionFrom = 'LeftUpLeg';
      else if (d.name === 'RightHip') d.positionFrom = 'RightUpLeg';
      else if (d.name === 'LeftKnee') d.positionFrom = 'LeftLeg';
      else if (d.name === 'RightKnee') d.positionFrom = 'RightLeg';
      else if (d.name === 'LeftAnkle') d.positionFrom = 'LeftFoot';
      else if (d.name === 'RightAnkle') d.positionFrom = 'RightFoot';
      else if (_rp[d.name]) d.positionFrom = _rp[d.name];
    });
  }

  /* ==================================================================
     PRESET 4 — BIRD / WINGED (chim/cánh) — 23 xương
     Thân + cổ + đầu, 2 cánh (shoulder→elbow→wrist + đầu lông cánh),
     2 chân, đuôi 2 đốt.
     ================================================================== */
  function birdWing(side) {
    var S = side === 'L' ? 'Left' : 'Right';
    var s = side === 'L' ? 'left' : 'right';
    return [
      B(S + 'WingShoulder', 'Spine', 'wing', side, true,
        { match: rx(['^' + s + 'wing0?1$', '^' + s + 'shoulder$', '^' + s + 'upperarm$']) }),
      B(S + 'WingElbow', S + 'WingShoulder', 'wing', side, true,
        { match: rx(['^' + s + 'wing0?2$', '^' + s + 'forearm$', '^' + s + 'elbow$']) }),
      B(S + 'WingWrist', S + 'WingElbow', 'wing', side, true,
        { match: rx(['^' + s + 'wing0?3$', '^' + s + 'hand$', '^' + s + 'wrist$']) }),
      B(S + 'WingTip', S + 'WingWrist', 'wing-tip', side, false,
        { match: rx(['^' + s + 'wingtip$', '^' + s + 'wing0?4$', '^' + s + 'feather']) })
    ];
  }
  function birdLeg(side) {
    var S = side === 'L' ? 'Left' : 'Right';
    var s = side === 'L' ? 'left' : 'right';
    return [
      B(S + 'Hip', 'Hips', 'leg', side, true,
        { match: rx(['^' + s + 'upleg$', '^' + s + 'upperleg$', '^' + s + 'hip$', '^' + s + 'thigh$']) }),
      B(S + 'Knee', S + 'Hip', 'leg', side, true,
        { match: rx(['^' + s + 'leg$', '^' + s + 'lowerleg$', '^' + s + 'knee$']) }),
      B(S + 'Ankle', S + 'Knee', 'leg', side, true,
        { match: rx(['^' + s + 'foot$', '^' + s + 'ankle$']) }),
      B(S + 'Foot', S + 'Ankle', 'foot', side, false,
        { match: rx(['^' + s + 'toe', '^' + s + 'foot0?2$']) })
    ];
  }
  var BIRD_BONES = [
    B('Root', null, 'root', null, true, { match: rx(['^_?rootjoint$', '^root$', '^rootnode$']) }),
    B('Hips', 'Root', 'pelvis', null, true, { match: rx(['^hips?$', '^pelvis$']) }),
    B('Spine', 'Hips', 'spine', null, true,
      { positionFrom: 'Spine1', match: rx(['^spine$', '^torso$', '^chest$']) }),
    B('Neck', 'Spine', 'neck', null, true, { match: rx(['^neck$']) }),
    B('Head', 'Neck', 'head', null, true, { match: rx(['^head$']) })
  ].concat(birdWing('L'), birdWing('R'), birdLeg('L'), birdLeg('R'), [
    B('Tail1', 'Hips', 'tail', null, true, { match: rx(['^tail0?1$']) }),
    B('Tail2', 'Tail1', 'tail', null, false, { match: rx(['^tail0?2$']) })
  ]);
  { var _bp = { Root: 'Hips', Hips: 'Hips', Neck: 'Neck', Head: 'Head',
      LeftWingShoulder: 'LeftShoulder', RightWingShoulder: 'RightShoulder',
      LeftWingElbow: 'LeftForeArm', RightWingElbow: 'RightForeArm',
      LeftWingWrist: 'LeftHand', RightWingWrist: 'RightHand',
      LeftHip: 'LeftUpLeg', RightHip: 'RightUpLeg',
      LeftKnee: 'LeftLeg', RightKnee: 'RightLeg',
      LeftAnkle: 'LeftFoot', RightAnkle: 'RightFoot' };
    BIRD_BONES.forEach(function (d) { if (_bp[d.name]) d.positionFrom = _bp[d.name]; });
  }

  /* ---------- Marker Smart gợi ý cho từng preset ----------
     Dùng lại landmarkKey/xKey của hệ humanoid (chinY, shoulderY,
     groinY, kneeY, ankleY, shoulderWidth, hipX…) để không phải sửa
     code đo landmark; yOff/zOff là tỉ lệ theo H. */
  var MARKERS = {
    humanoid: null, /* dùng ALL_MARKER_DEFS sẵn có của arp-smart.js */
    quadruped: [
      { id: 'head', label: 'Đầu (head)', landmarkKey: 'chinY', xKey: null, yOff: 0, zOff: 0.02, mirror: null, color: 0xffd166 },
      { id: 'neck', label: 'Cổ (neck)', landmarkKey: 'chinY', xKey: null, yOff: -0.05, zOff: 0, mirror: null, color: 0xffc300 },
      { id: 'back', label: 'Lưng giữa (back)', landmarkKey: 'shoulderY', xKey: null, yOff: -0.02, zOff: 0, mirror: null, color: 0x118ab2 },
      { id: 'hips', label: 'Hông (hips)', landmarkKey: 'groinY', xKey: null, yOff: 0, zOff: 0, mirror: null, color: 0x06d6a0 },
      { id: 'LeftFrontShoulder', label: 'Vai trước trái', landmarkKey: 'shoulderY', xKey: 'shoulderWidth', yOff: 0, zOff: 0.01, mirror: 'RightFrontShoulder', color: 0x118ab2 },
      { id: 'RightFrontShoulder', label: 'Vai trước phải', landmarkKey: 'shoulderY', xKey: 'shoulderWidth', yOff: 0, zOff: 0.01, mirror: 'LeftFrontShoulder', color: 0x118ab2 },
      { id: 'LeftFrontPaw', label: 'Bàn chân trước trái', landmarkKey: 'ankleY', xKey: 'hipX', yOff: 0, zOff: 0.02, mirror: 'RightFrontPaw', color: 0xef476f },
      { id: 'RightFrontPaw', label: 'Bàn chân trước phải', landmarkKey: 'ankleY', xKey: 'hipX', yOff: 0, zOff: 0.02, mirror: 'LeftFrontPaw', color: 0xef476f },
      { id: 'LeftHindPaw', label: 'Bàn chân sau trái', landmarkKey: 'ankleY', xKey: 'hipX', yOff: 0, zOff: -0.02, mirror: 'RightHindPaw', color: 0x7b61ff },
      { id: 'RightHindPaw', label: 'Bàn chân sau phải', landmarkKey: 'ankleY', xKey: 'hipX', yOff: 0, zOff: -0.02, mirror: 'LeftHindPaw', color: 0x7b61ff },
      { id: 'tailTip', label: 'Chóp đuôi (tail)', landmarkKey: 'groinY', xKey: null, yOff: 0.02, zOff: -0.06, mirror: null, color: 0x06d6a0 }
    ],
    robot: [
      { id: 'chin', label: 'Đầu (head)', landmarkKey: 'chinY', xKey: null, yOff: 0, zOff: 0, mirror: null, color: 0xffd166 },
      { id: 'neck', label: 'Cổ (neck)', landmarkKey: 'chinY', xKey: null, yOff: -0.05, zOff: 0, mirror: null, color: 0xffc300 },
      { id: 'chest', label: 'Thân (spine)', landmarkKey: 'shoulderY', xKey: null, yOff: -0.08, zOff: 0.005, mirror: null, color: 0x118ab2 },
      { id: 'groin', label: 'Hông (hips)', landmarkKey: 'groinY', xKey: null, yOff: 0, zOff: 0, mirror: null, color: 0x06d6a0 },
      { id: 'LeftShoulder', label: 'Vai trái', landmarkKey: 'shoulderY', xKey: 'shoulderWidth', yOff: 0, zOff: 0, mirror: 'RightShoulder', color: 0x118ab2 },
      { id: 'RightShoulder', label: 'Vai phải', landmarkKey: 'shoulderY', xKey: 'shoulderWidth', yOff: 0, zOff: 0, mirror: 'LeftShoulder', color: 0x118ab2 },
      { id: 'LeftElbow', label: 'Khuỷu trái', landmarkKey: 'elbowY', xKey: 'foreX', yOff: 0, zOff: 0.005, mirror: 'RightElbow', color: 0xef476f },
      { id: 'RightElbow', label: 'Khuỷu phải', landmarkKey: 'elbowY', xKey: 'foreX', yOff: 0, zOff: 0.005, mirror: 'LeftElbow', color: 0xef476f },
      { id: 'LeftWrist', label: 'Cổ tay trái', landmarkKey: 'wristY', xKey: 'handX', yOff: 0, zOff: 0.01, mirror: 'RightWrist', color: 0xef476f },
      { id: 'RightWrist', label: 'Cổ tay phải', landmarkKey: 'wristY', xKey: 'handX', yOff: 0, zOff: 0.01, mirror: 'LeftWrist', color: 0xef476f },
      { id: 'LeftHip', label: 'Hông trái', landmarkKey: 'groinY', xKey: 'hipX', yOff: 0, zOff: 0, mirror: 'RightHip', color: 0x7b61ff },
      { id: 'RightHip', label: 'Hông phải', landmarkKey: 'groinY', xKey: 'hipX', yOff: 0, zOff: 0, mirror: 'LeftHip', color: 0x7b61ff },
      { id: 'LeftKnee', label: 'Gối trái', landmarkKey: 'kneeY', xKey: 'hipX', yOff: 0, zOff: 0.005, mirror: 'RightKnee', color: 0x7b61ff },
      { id: 'RightKnee', label: 'Gối phải', landmarkKey: 'kneeY', xKey: 'hipX', yOff: 0, zOff: 0.005, mirror: 'LeftKnee', color: 0x7b61ff },
      { id: 'LeftAnkle', label: 'Mắt cá trái', landmarkKey: 'ankleY', xKey: 'hipX', yOff: 0, zOff: 0.01, mirror: 'RightAnkle', color: 0x4cc9f0 },
      { id: 'RightAnkle', label: 'Mắt cá phải', landmarkKey: 'ankleY', xKey: 'hipX', yOff: 0, zOff: 0.01, mirror: 'LeftAnkle', color: 0x4cc9f0 }
    ],
    bird: [
      { id: 'head', label: 'Đầu (head)', landmarkKey: 'chinY', xKey: null, yOff: 0, zOff: 0.02, mirror: null, color: 0xffd166 },
      { id: 'neck', label: 'Cổ (neck)', landmarkKey: 'chinY', xKey: null, yOff: -0.05, zOff: 0, mirror: null, color: 0xffc300 },
      { id: 'back', label: 'Lưng (back)', landmarkKey: 'shoulderY', xKey: null, yOff: -0.02, zOff: 0, mirror: null, color: 0x118ab2 },
      { id: 'hips', label: 'Hông (hips)', landmarkKey: 'groinY', xKey: null, yOff: 0, zOff: 0, mirror: null, color: 0x06d6a0 },
      { id: 'LeftWingTip', label: 'Đầu cánh trái', landmarkKey: 'wristY', xKey: 'handX', yOff: 0, zOff: 0.01, mirror: 'RightWingTip', color: 0xef476f },
      { id: 'RightWingTip', label: 'Đầu cánh phải', landmarkKey: 'wristY', xKey: 'handX', yOff: 0, zOff: 0.01, mirror: 'LeftWingTip', color: 0xef476f },
      { id: 'LeftFoot', label: 'Chân trái', landmarkKey: 'ankleY', xKey: 'hipX', yOff: 0, zOff: 0.01, mirror: 'RightFoot', color: 0x7b61ff },
      { id: 'RightFoot', label: 'Chân phải', landmarkKey: 'ankleY', xKey: 'hipX', yOff: 0, zOff: 0.01, mirror: 'LeftFoot', color: 0x7b61ff },
      { id: 'tailTip', label: 'Chóp đuôi (tail)', landmarkKey: 'groinY', xKey: null, yOff: 0.02, zOff: -0.06, mirror: null, color: 0x06d6a0 }
    ]
  };

  /* ---------- Control Quick Rig phù hợp từng preset ----------
     ikChains: chuỗi 2-bone IK (root/mid/end + pole). FK: khớp điều
     khiển trực tiếp. Lưu ý: đây mới là KHAI BÁO chuỗi — control rig
     chuyên biệt (pole chân trước/sau, IK đuôi, hinge 1 trục) chưa có. */
  var CONTROLS = {
    humanoid: {
      ikChains: [
        { name: 'LeftArm', root: 'LeftArm', mid: 'LeftForeArm', end: 'LeftHand', pole: 'LeftArm', kind: 'arm' },
        { name: 'RightArm', root: 'RightArm', mid: 'RightForeArm', end: 'RightHand', pole: 'RightArm', kind: 'arm' },
        { name: 'LeftLeg', root: 'LeftUpLeg', mid: 'LeftLeg', end: 'LeftFoot', pole: 'LeftLeg', kind: 'leg' },
        { name: 'RightLeg', root: 'RightUpLeg', mid: 'RightLeg', end: 'RightFoot', pole: 'RightLeg', kind: 'leg' }
      ],
      fkBones: ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
        'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
        'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']
    },
    quadruped: {
      ikChains: [
        { name: 'LeftFrontLeg', root: 'LeftFrontShoulder', mid: 'LeftFrontElbow', end: 'LeftFrontWrist', pole: 'LeftFrontLeg', kind: 'front-leg' },
        { name: 'RightFrontLeg', root: 'RightFrontShoulder', mid: 'RightFrontElbow', end: 'RightFrontWrist', pole: 'RightFrontLeg', kind: 'front-leg' },
        { name: 'LeftHindLeg', root: 'LeftHip', mid: 'LeftKnee', end: 'LeftAnkle', pole: 'LeftHindLeg', kind: 'hind-leg' },
        { name: 'RightHindLeg', root: 'RightHip', mid: 'RightKnee', end: 'RightAnkle', pole: 'RightHindLeg', kind: 'hind-leg' }
      ],
      fkBones: ['Hips', 'Spine1', 'Spine2', 'Spine3', 'Neck', 'Head', 'Tail1', 'Tail2', 'Tail3',
        'LeftFrontShoulder', 'LeftFrontElbow', 'LeftFrontWrist',
        'RightFrontShoulder', 'RightFrontElbow', 'RightFrontWrist',
        'LeftHip', 'LeftKnee', 'LeftAnkle', 'RightHip', 'RightKnee', 'RightAnkle']
    },
    robot: {
      ikChains: [
        { name: 'LeftArm', root: 'LeftShoulder', mid: 'LeftElbow', end: 'LeftWrist', pole: 'LeftArm', kind: 'arm-hinge' },
        { name: 'RightArm', root: 'RightShoulder', mid: 'RightElbow', end: 'RightWrist', pole: 'RightArm', kind: 'arm-hinge' },
        { name: 'LeftLeg', root: 'LeftHip', mid: 'LeftKnee', end: 'LeftAnkle', pole: 'LeftLeg', kind: 'leg-hinge' },
        { name: 'RightLeg', root: 'RightHip', mid: 'RightKnee', end: 'RightAnkle', pole: 'RightLeg', kind: 'leg-hinge' }
      ],
      fkBones: ['Hips', 'Spine', 'Neck', 'Head',
        'LeftShoulder', 'LeftElbow', 'LeftWrist', 'RightShoulder', 'RightElbow', 'RightWrist',
        'LeftHip', 'LeftKnee', 'LeftAnkle', 'RightHip', 'RightKnee', 'RightAnkle']
    },
    bird: {
      ikChains: [
        { name: 'LeftWing', root: 'LeftWingShoulder', mid: 'LeftWingElbow', end: 'LeftWingWrist', pole: 'LeftWing', kind: 'wing' },
        { name: 'RightWing', root: 'RightWingShoulder', mid: 'RightWingElbow', end: 'RightWingWrist', pole: 'RightWing', kind: 'wing' },
        { name: 'LeftLeg', root: 'LeftHip', mid: 'LeftKnee', end: 'LeftAnkle', pole: 'LeftLeg', kind: 'leg' },
        { name: 'RightLeg', root: 'RightHip', mid: 'RightKnee', end: 'RightAnkle', pole: 'RightLeg', kind: 'leg' }
      ],
      fkBones: ['Hips', 'Spine', 'Neck', 'Head', 'Tail1', 'Tail2',
        'LeftWingShoulder', 'LeftWingElbow', 'LeftWingWrist', 'RightWingShoulder', 'RightWingElbow', 'RightWingWrist',
        'LeftHip', 'LeftKnee', 'LeftAnkle', 'RightHip', 'RightKnee', 'RightAnkle']
    }
  };

  var PRESETS = {
    humanoid: {
      id: 'humanoid', label: 'Humanoid — 2 chân, 41 xương Mixamo',
      kind: 'humanoid', bones: HUMANOID_BONES, markers: MARKERS.humanoid,
      controls: CONTROLS.humanoid,
      description: 'Preset gốc của studio (41 xương Mixamo). Dùng khi model là người.'
    },
    quadruped: {
      id: 'quadruped', label: 'Quadruped — 4 chân (chó/mèo/ngựa)',
      kind: 'quadruped', bones: QUADRUPED_BONES, markers: MARKERS.quadruped,
      controls: CONTROLS.quadruped,
      description: 'Cột sống dài 3 đốt, 4 chân (trước: vai→khuỷu→cổ chân; sau: hông→gối→cổ chân→bàn chân), cổ + đầu, đuôi 3 đốt. Không có xương tay/ngón.'
    },
    robot: {
      id: 'robot', label: 'Robot — khớp cứng bản lề',
      kind: 'robot', bones: ROBOT_BONES, markers: MARKERS.robot,
      controls: CONTROLS.robot,
      description: '17 xương, khớp bản lề 1 trục chính, không twist, không ngón tay. Tên chuẩn Base/Shoulder/Elbow/Wrist/Hip/Knee/Ankle.'
    },
    bird: {
      id: 'bird', label: 'Bird / Winged — chim, có cánh',
      kind: 'bird', bones: BIRD_BONES, markers: MARKERS.bird,
      controls: CONTROLS.bird,
      description: 'Thân + cổ + đầu, 2 cánh (vai→khuỷu→cổ tay→đầu lông), 2 chân, đuôi 2 đốt.'
    }
  };

  AP.PRESETS = PRESETS;
  AP.listIds = function () { return ['humanoid', 'quadruped', 'robot', 'bird']; };
  AP.listPresets = function () {
    return AP.listIds().map(function (id) {
      var p = PRESETS[id];
      return { id: p.id, label: p.label, kind: p.kind, boneCount: p.bones.length, description: p.description };
    });
  };
  AP.getPreset = function (id) { return PRESETS[id] || null; };
  AP.isAnimalPreset = function (id) { return id === 'quadruped' || id === 'robot' || id === 'bird'; };
  AP.boneDefs = function (id) {
    var p = PRESETS[id];
    return p ? p.bones.map(function (d) { return { name: d.name, parent: d.parent }; }) : [];
  };
  AP.boneDefList = function (id) { var p = PRESETS[id]; return p ? p.bones : []; };
  AP.markerDefs = function (id) { var p = PRESETS[id]; return p ? p.markers : null; };
  AP.controls = function (id) { var p = PRESETS[id]; return p ? p.controls : null; };

  /* ---------- Bảng map đã kiểm chứng trên model thật ----------
     Fox.glb (models/Fox.glb, 24 xương khớp da) → preset quadruped:
       _rootJoint      → Root            b_Root_00       → (thừa, không map)
       b_Hip_01        → Hips            b_Spine01_02    → Spine1
       b_Spine02_03    → Spine2          (Spine3: Fox không có đốt sống thứ 3)
       b_Neck_04       → Neck            b_Head_05       → Head
       b_LeftUpperArm_09  → LeftFrontShoulder   b_LeftForeArm_010 → LeftFrontElbow
       b_LeftHand_011     → LeftFrontWrist      (LeftFrontPaw: Fox không có)
       b_RightUpperArm_06 → RightFrontShoulder  b_RightForeArm_07 → RightFrontElbow
       b_RightHand_08     → RightFrontWrist
       b_LeftLeg01_015 → LeftHip         b_LeftLeg02_016 → LeftKnee
       b_LeftFoot01_017 → LeftAnkle      b_LeftFoot02_018 → LeftHindPaw
       b_RightLeg01_019 → RightHip       b_RightLeg02_020 → RightKnee
       b_RightFoot01_021 → RightAnkle    b_RightFoot02_022 → RightHindPaw
       b_Tail01_012 → Tail1  b_Tail02_013 → Tail2  b_Tail03_014 → Tail3
     → 23/24 xương nguồn map được (95.8%), 23/26 xương đích (Spine3,
     Left/RightFrontPaw thiếu vì Fox không có).
     XBot.fbx (mixamorig:, 65 xương) → preset robot: 16/17 xương đích
     (chỉ thiếu Base — XBot không có xương gốc riêng; LeftArm không map
     vì robot không có xương "cánh tay trên" riêng ngoài Shoulder).
     RobotExpressive.glb (43 khớp da, tên Blender .L/.R) → preset robot:
     17/17 xương đích (Bone→Base, Torso→Spine, Shoulder.L→Shoulder,
     LowerArm.L→Elbow, Palm2.L→Wrist, UpperLeg.L→Hip, LowerLeg.L→Knee,
     Foot.L→Ankle, …). */
  AP.KNOWN_MAPS = {
    foxQuadruped: {
      model: 'models/Fox.glb', preset: 'quadruped',
      map: {
        '_rootJoint': 'Root', 'b_Hip_01': 'Hips', 'b_Spine01_02': 'Spine1',
        'b_Spine02_03': 'Spine2', 'b_Neck_04': 'Neck', 'b_Head_05': 'Head',
        'b_LeftUpperArm_09': 'LeftFrontShoulder', 'b_LeftForeArm_010': 'LeftFrontElbow',
        'b_LeftHand_011': 'LeftFrontWrist', 'b_RightUpperArm_06': 'RightFrontShoulder',
        'b_RightForeArm_07': 'RightFrontElbow', 'b_RightHand_08': 'RightFrontWrist',
        'b_LeftLeg01_015': 'LeftHip', 'b_LeftLeg02_016': 'LeftKnee',
        'b_LeftFoot01_017': 'LeftAnkle', 'b_LeftFoot02_018': 'LeftHindPaw',
        'b_RightLeg01_019': 'RightHip', 'b_RightLeg02_020': 'RightKnee',
        'b_RightFoot01_021': 'RightAnkle', 'b_RightFoot02_022': 'RightHindPaw',
        'b_Tail01_012': 'Tail1', 'b_Tail02_013': 'Tail2', 'b_Tail03_014': 'Tail3'
      },
      unmapped: ['b_Root_00'],
      sourceCoverage: 23 / 24, dstCoverage: 23 / 26
    }
  };

  /* ---------- Thu thập xương (giống QuickRig.collectBones) ---------- */
  function collectBones(skeleton) {
    var out = [];
    if (!skeleton) return out;
    if (Array.isArray(skeleton)) return skeleton.filter(function (b) { return b && b.isBone; });
    if (skeleton.isBone) return [skeleton];
    if (skeleton.bones && Array.isArray(skeleton.bones)) {
      return skeleton.bones.filter(function (b) { return b && b.isBone; });
    }
    if (skeleton.traverse) {
      skeleton.traverse(function (o) { if (o.isBone) out.push(o); });
      return out;
    }
    return out;
  }
  AP.collectBones = collectBones;

  /* ---------- Map xương nguồn → xương đích preset ----------
     Humanoid: khớp tên chính xác (strip prefix, không phân biệt hoa/thường).
     Động vật: khớp regex theo từng xương đích (xem match[] ở trên),
     duyệt xương nguồn theo thứ tự scene-graph, đích nào khớp trước giữ. */
  function mapBones(skeleton, presetId) {
    presetId = presetId || 'humanoid';
    var preset = PRESETS[presetId] || PRESETS.humanoid;
    var dstDefs = preset.bones;
    var bones = collectBones(skeleton);
    var used = {};
    var mapped = [], unmapped = [];
    bones.forEach(function (b) {
      var n = normalizeSrcName(b.name);
      var dst = null;
      if (presetId === 'humanoid') {
        /* Humanoid: khớp tên chính xác kiểu QuickRig.stripName — KHÔNG
           dùng normalizeSrcName (nó bóc "_end" nên HeadTop_End → head). */
        var hn = String(b.name == null ? '' : b.name)
          .replace(/^(model:{1,2})+/i, '').replace(/^mixamorig:?/i, '')
          .replace(/__proxy$/i, '').toLowerCase();
        for (var i = 0; i < dstDefs.length; i++) {
          if (dstDefs[i].name.toLowerCase() === hn) { dst = dstDefs[i].name; break; }
        }
      } else {
        for (var j = 0; j < dstDefs.length; j++) {
          var pats = dstDefs[j].match;
          if (!pats || used[dstDefs[j].name]) continue;
          for (var k = 0; k < pats.length; k++) {
            if (pats[k].test(n)) { dst = dstDefs[j].name; break; }
          }
          if (dst) break;
        }
      }
      if (dst && !used[dst]) {
        used[dst] = true;
        mapped.push({ src: b.name, dst: dst, method: presetId === 'humanoid' ? 'name' : 'animal-name', bone: b });
      } else unmapped.push(b.name);
    });
    var missing = dstDefs.map(function (d) { return d.name; }).filter(function (d) { return !used[d]; });
    return {
      preset: presetId, mapped: mapped, unmapped: unmapped, extra: unmapped.slice(),
      missing: missing, coverage: dstDefs.length ? mapped.length / dstDefs.length * 100 : 0,
      sourceCoverage: bones.length ? mapped.length / bones.length * 100 : 0,
      mappedCount: mapped.length, total: dstDefs.length, sourceTotal: bones.length,
      method: presetId === 'humanoid' ? 'name' : 'animal:' + presetId, bones: bones
    };
  }
  AP.mapBones = mapBones;

  /* Đoán preset theo tên xương: preset nào khớp được NHIỀU xương đích
     nhất (số tuyệt đối — tỉ lệ % thiên vị preset ít xương: robot 16/17
     sẽ thắng humanoid 31/41 dù model là người thiếu ngón). Hòa → tỉ lệ
     cao hơn thắng. <50% đích và <5 xương → humanoid. */
  AP.detectPreset = function (skeleton) {
    var best = 'humanoid', bestCount = -1, bestScore = 0;
    AP.listIds().forEach(function (id) {
      var r = mapBones(skeleton, id);
      var score = r.total ? r.mappedCount / r.total : 0;
      if (r.mappedCount > bestCount || (r.mappedCount === bestCount && score > bestScore)) {
        bestCount = r.mappedCount; bestScore = score; best = id;
      }
    });
    return (bestCount >= 5 && bestScore >= 0.5) ? best : 'humanoid';
  };

  /* ---------- Vị trí khớp preset từ vị trí humanoid ----------
     pos: dict tên xương humanoid → {x,y,z} (boneWorldPositions).
     Robot/bird: positionFrom trỏ thẳng sang tên humanoid tương đương
     (LeftElbow ← LeftForeArm…); Base ← Hips nhưng hạ xuống đất.
     Quadruped: lưng NẰM NGANG — suy từ bbox của pos: backY = cao vai,
     groundY = cao bàn chân, chiều dài thân = độ trải Z của pos.
     Trả về dict mới (không sửa pos gốc); vị trí là ƯỚC LƯỢNG bbox. */
  function resolvePositions(pos, presetId) {
    presetId = presetId || 'humanoid';
    if (!pos || presetId === 'humanoid') return pos;
    var out = {};
    Object.keys(pos).forEach(function (k) { out[k] = { x: pos[k].x, y: pos[k].y, z: pos[k].z }; });
    var preset = PRESETS[presetId];
    if (!preset) return out;
    var xs = [], ys = [], zs = [];
    Object.keys(pos).forEach(function (k) { xs.push(pos[k].x); ys.push(pos[k].y); zs.push(pos[k].z); });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var minZ = Math.min.apply(null, zs), maxZ = Math.max.apply(null, zs);
    var cx = (minX + maxX) / 2, H = Math.max(1e-6, maxY - minY);
    var groundY = (pos.LeftFoot && pos.LeftFoot.y != null) ? pos.LeftFoot.y : minY;
    var cz = (pos.Hips && pos.Hips.z != null) ? pos.Hips.z : (minZ + maxZ) / 2;
    if (presetId === 'quadruped') {
      var backY = (pos.LeftShoulder && pos.LeftShoulder.y != null) ? pos.LeftShoulder.y : maxY * 0.55;
      var zBack = minZ, zFront = maxZ, L = Math.max(0.3 * H, zFront - zBack);
      /* Độ trải Z của vị trí humanoid thường rất nhỏ (gần như cùng mặt
         phẳng) — thân quadruped dài L phải được căn giữa theo cz, nếu
         không Spine3 sẽ chạy quá đầu (Head.z < Spine3.z). */
      if (zFront - zBack < 0.5 * L) { zBack = cz - L / 2; zFront = cz + L / 2; }
      var shHalf = pos.LeftShoulder ? Math.abs(pos.LeftShoulder.x - cx) * 0.5 : 0.08 * H;
      var hipHalf = pos.LeftUpLeg ? Math.abs(pos.LeftUpLeg.x - cx) : 0.08 * H;
      var zF = zBack + 0.80 * L, zH = zBack + 0.15 * L;
      var midY = groundY + (backY - groundY) * 0.5;
      var q = {
        Root: { x: cx, y: backY, z: zBack + 0.10 * L },
        Hips: { x: cx, y: backY, z: zH },
        Spine1: { x: cx, y: backY, z: zBack + 0.38 * L },
        Spine2: { x: cx, y: backY, z: zBack + 0.62 * L },
        Spine3: { x: cx, y: backY, z: zBack + 0.85 * L },
        Neck: { x: cx, y: backY + 0.06 * H, z: zFront - 0.04 * L },
        Head: { x: cx, y: backY + 0.12 * H, z: zFront + 0.02 * L },
        LeftFrontShoulder: { x: cx - shHalf, y: backY, z: zF },
        RightFrontShoulder: { x: cx + shHalf, y: backY, z: zF },
        LeftFrontElbow: { x: cx - shHalf, y: midY, z: zF },
        RightFrontElbow: { x: cx + shHalf, y: midY, z: zF },
        LeftFrontWrist: { x: cx - shHalf, y: groundY + 0.02 * H, z: zF },
        RightFrontWrist: { x: cx + shHalf, y: groundY + 0.02 * H, z: zF },
        LeftFrontPaw: { x: cx - shHalf, y: groundY, z: zF + 0.03 * L },
        RightFrontPaw: { x: cx + shHalf, y: groundY, z: zF + 0.03 * L },
        LeftHip: { x: cx - hipHalf, y: backY, z: zH },
        RightHip: { x: cx + hipHalf, y: backY, z: zH },
        LeftKnee: { x: cx - hipHalf, y: midY, z: zH },
        RightKnee: { x: cx + hipHalf, y: midY, z: zH },
        LeftAnkle: { x: cx - hipHalf, y: groundY + 0.03 * H, z: zH },
        RightAnkle: { x: cx + hipHalf, y: groundY + 0.03 * H, z: zH },
        LeftHindPaw: { x: cx - hipHalf, y: groundY, z: zH + 0.03 * L },
        RightHindPaw: { x: cx + hipHalf, y: groundY, z: zH + 0.03 * L },
        Tail1: { x: cx, y: backY, z: zBack },
        Tail2: { x: cx, y: backY + 0.02 * H, z: zBack - 0.08 * L },
        Tail3: { x: cx, y: backY + 0.05 * H, z: zBack - 0.16 * L }
      };
      Object.keys(q).forEach(function (k) { out[k] = q[k]; });
      return out;
    }
    /* robot / bird: positionFrom + vài vị trí suy ra. */
    preset.bones.forEach(function (d) {
      if (d.positionFrom && pos[d.positionFrom]) {
        out[d.name] = { x: pos[d.positionFrom].x, y: pos[d.positionFrom].y, z: pos[d.positionFrom].z };
      }
    });
    if (presetId === 'robot' && pos.Hips) {
      out.Base = { x: cx, y: groundY, z: cz };
    }
    if (presetId === 'bird') {
      var wristL = out.LeftWingWrist || pos.LeftHand, wristR = out.RightWingWrist || pos.RightHand;
      if (wristL) out.LeftWingTip = { x: wristL.x - 0.15 * H, y: wristL.y + 0.05 * H, z: wristL.z };
      if (wristR) out.RightWingTip = { x: wristR.x + 0.15 * H, y: wristR.y + 0.05 * H, z: wristR.z };
      if (pos.Hips) {
        out.Tail1 = { x: cx, y: pos.Hips.y, z: pos.Hips.z - 0.10 * H };
        out.Tail2 = { x: cx, y: pos.Hips.y + 0.02 * H, z: pos.Hips.z - 0.20 * H };
      }
      if (pos.LeftFoot) out.LeftFoot = { x: pos.LeftFoot.x, y: pos.LeftFoot.y, z: pos.LeftFoot.z };
      if (pos.RightFoot) out.RightFoot = { x: pos.RightFoot.x, y: pos.RightFoot.y, z: pos.RightFoot.z };
    }
    return out;
  }
  AP.resolvePositions = resolvePositions;

  AP._test = { normalizeSrcName: normalizeSrcName, collectBones: collectBones };
})(typeof window !== 'undefined' ? window : global);
