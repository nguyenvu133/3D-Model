/* ============================================================
 * rig/arp-plugin-mixamorig.js — PLUGIN "Mixamo Rig"
 *
 * Đăng ký qua PixiStudio.ArpPlugins (tab riêng 'plugin:mixamo-rig')
 * như plugin Auto Fix (js/rig/arp-autofix.js).
 *
 * THIẾT KẾ HỌC TỪ repo tdw46/mixamo_blender4-main (Blender 4
 * extension dựa trên Adobe "Mixamo in Blender") — CHỈ THAM KHẢO
 * THIẾT KẾ, KHÔNG COPY CODE PYTHON (repo không có file LICENSE ở
 * root). Cài đặt lại bằng JS/three.js r128 trên nền Quick Rig có
 * sẵn của studio. Thiết kế lấy được (ghi rõ nguồn từng điểm):
 *
 *  - definitions/naming.py: prefix control "Ctrl_", master
 *    "Master" (→ 'Ctrl_Master'); control tay "Hand_IK"/"Hand_FK",
 *    "ArmPole_IK" (pole khuỷu), chân "Foot_IK"/"Foot_01"/
 *    "FootRoll_Cursor" (con trỏ lăn gót→mũi), "LegPole_IK" (pole
 *    gối), "Toe_IK"; xương Mixamo "UpLeg/Leg/Foot/ToeBase".
 *  - mixamo_rig_functions.py (đầu file): danh sách control từng
 *    chi — fk_leg [thigh_fk, calf_fk, foot_fk, toes_fk], ik_leg
 *    [thigh_ik, calf_ik, foot_ik, pole_ik, toes_ik, foot_01,
 *    foot_roll_cursor, foot_snap], fk_arm [arm_fk, forearm_fk,
 *    hand_fk], ik_arm [arm_ik, forearm_ik, hand_ik, pole_ik];
 *    custom prop "ik_fk_switch" 0..1 trên Hand_IK/Foot_IK (panel
 *    "Mixamo Rig Settings" hiện slider này + nút Snap IK/FK,
 *    Snap Frame IK/FK, Snap Anim IK-FK); operator bake FK→IK /
 *    IK→FK theo khoảng frame.
 *  - mixamo_rig_functions.py (cuối file, ~L2400–L2700): cảnh báo
 *    Visual Keying — "Visual Keying can make IK poles jump after
 *    keying. Use local transforms to preserve your control poses."
 *    + nút "Use Local Transform Keying" (tắt Visual Keying, chọn
 *    Location & Rotation); panel MR_PT_rig_ui "Mixamo Rig
 *    Settings" hiện box cảnh báo này khi Visual Keying đang bật.
 *  - lib/maths_geo.py get_ik_pole_pos(method=1): pole = vị trí
 *    khớp giữa + hướng gập, chiếu lên mặt phẳng vuông góc trục
 *    chi, cách khớp giữa 1.7× độ dài xương trên; method=2: dọc
 *    trục Z của xương giữa. lib/constraints.py: Copy Transforms
 *    (control → xương) — ở đây thay bằng áp quaternion trực tiếp.
 *  - lib/custom_props.py create_custom_prop(node, name, val,
 *    min=0, max=1, default): prop có min/max/soft limits/
 *    description — ở đây là các slider blend 0–100% + prop
 *    ik_fk_switch lưu trên state.
 *  - lib/bones_pose.py: màu control theo nhóm (cam master/head,
 *    xanh lá thân giữa, xanh dương trái/phải) — ở đây dùng màu
 *    line pole tím + master cam (chỉ ghi chú, không có bone group
 *    trong three.js).
 *
 * KHÁC BIỆT SO VỚI BLENDER ADDON (giới hạn thật, xem cuối file):
 *  - IK vẫn là solver 2-bone của Quick Rig (solveTwoBoneIK), không
 *    phải IK constraint của Blender; blend IK/FK bằng slerp
 *    quaternion như QR3 AdvIK (dùng lại AdvIK.blendIKFK khi có).
 *  - Không có constraint phức tạp (Copy Transforms / Child Of /
 *    driver): master chỉ cộng offset vị trí + nhân quaternion vào
 *    Hips; control tay/chân là helper Object3D của Quick Rig.
 *  - Không có shape control (cs.blend) hay bone group màu.
 *  - Bake: sample clip bằng THREE.AnimationMixer theo từng frame,
 *    không phải bake action của Blender.
 *
 * DÙNG CHUNG, KHÔNG VIẾT LẠI:
 *  - ArpQuickRig.detectMixamo / autoGenMixamo (nhận diện + map
 *    41 xương + proxy khi thiếu + 18 control + 4 pole).
 *  - ArpQuickRig.AdvIK.blendIKFK / autoPlacePole (blend slerp +
 *    auto pole khuỷu sau/gối trước) khi có; fallback JS riêng
 *    (cùng thuật toán) khi AdvIK chưa load.
 *  - ArpQuickRig.setFingerCurl / setFootRoll / setSpineRotation /
 *    setHeadRotation / setNeckRotation / matchToSource /
 *    playMixamoClip / tickMixamo / exportMixamoCompatible.
 *  - Anim.validateClip (format track) + format JSON của
 *    ArpKeyframe.exportClip ('pixistudio-arp-keyframe-clips-1').
 * ============================================================ */
(function () {
  'use strict';

  var PLUGIN_ID = 'mixamo-rig';
  var KEYFRAME_FORMAT = 'pixistudio-arp-keyframe-clips-1';
  var NOT_MIXAMO_MSG = 'Model này không phải rig Mixamo';
  var KEYING_WARN_MSG = 'IK pole có thể bị ghi sai vị trí — hãy Match to source trước khi ghi key';

  var LIMBS = ['LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'];
  var LIMB_LABEL = { LeftArm: 'Tay trái', RightArm: 'Tay phải', LeftLeg: 'Chân trái', RightLeg: 'Chân phải' };
  var LIMB_KIND = { LeftArm: 'arm', RightArm: 'arm', LeftLeg: 'leg', RightLeg: 'leg' };
  /* Mặc định như autoGenMixamo: tay FK (blend 0), chân IK (blend 1). */
  var DEFAULT_BLENDS = { LeftArm: 0, RightArm: 0, LeftLeg: 1, RightLeg: 1 };
  var FINGER_GROUPS = {
    thumb: ['LeftHandThumb', 'RightHandThumb'],
    indexMiddle: ['LeftHandIndex', 'RightHandIndex', 'LeftHandMiddle', 'RightHandMiddle'],
    ringPinky: ['LeftHandRing', 'RightHandRing', 'LeftHandPinky', 'RightHandPinky'],
    all: ['all']
  };
  var FINGER_LABEL = {
    thumb: 'Ngón cái', indexMiddle: 'Trỏ + giữa', ringPinky: 'Áp út + út', all: 'Tất cả ngón'
  };

  /* ---------- state ---------- */
  var state = {
    built: false,
    target: null,
    detection: null,
    blends: { LeftArm: 0, RightArm: 0, LeftLeg: 1, RightLeg: 1 },
    poleOffset: { LeftArm: 0, RightArm: 0, LeftLeg: 0, RightLeg: 0 },
    footPivot: { Left: 'heel', Right: 'heel' },
    footRoll: { Left: 0, Right: 0 },
    fingerCurl: { thumb: 0, indexMiddle: 0, ringPinky: 0, all: 0 },
    matchedToSource: false,
    master: { position: [0, 0, 0], rotation: [0, 0, 0] },
    bindHipsPos: null,   /* THREE.Vector3 (local của Hips lúc build) */
    bindHipsQuat: null,  /* THREE.Quaternion (local của Hips lúc build) */
    masterObj: null,
    poleLines: {},       /* limb -> THREE.Line */
    bakedClips: {}       /* name -> { clip, fps, frames, duration } */
  };

  function getQR() { return (typeof window !== 'undefined' && window.PixiStudio) ? window.PixiStudio.ArpQuickRig : null; }
  function getAdvIK() { var QR = getQR(); return (QR && QR.AdvIK) ? QR.AdvIK : null; }
  function getAnim() { return (typeof window !== 'undefined' && window.PixiStudio) ? window.PixiStudio.Anim : null; }
  function getKeyframe() { return (typeof window !== 'undefined' && window.PixiStudio) ? window.PixiStudio.ArpKeyframe : null; }
  function getTHREE() { return (typeof window !== 'undefined') ? window.THREE : (typeof THREE !== 'undefined' ? THREE : null); }
  function clamp(v, lo, hi) { v = Number(v); if (!isFinite(v)) v = lo; return Math.max(lo, Math.min(hi, v)); }
  function normLimb(limb) { return LIMBS.indexOf(limb) >= 0 ? limb : null; }
  function worldPosOf(o) { var T = getTHREE(); return new T.Vector3().setFromMatrixPosition(o.matrixWorld); }
  function vecToArr(v) { return [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]; }

  /* ---------- 0. Nhận diện (dùng chung Quick Rig) ---------- */
  function detect(target) {
    var QR = getQR();
    if (!QR || typeof QR.detectMixamo !== 'function') return { isMixamo: false, reasons: ['ArpQuickRig chưa load — không nhận diện được.'] };
    return QR.detectMixamo(target);
  }
  function isMixamo(target) { return !!detect(target).isMixamo; }
  function getNonMixamoAction(target) {
    var det = detect(target);
    return {
      isMixamo: false,
      message: NOT_MIXAMO_MSG + (det && det.reasons ? ' (' + det.reasons.join(' ') + ')' : ''),
      detection: det,
      suggestSmartTab: true,
      actions: ['smart', 'quickrig'],
      hint: 'Mở tab Smart để rig mới, hoặc tab Quick Rig để map thủ công.'
    };
  }
  function switchToSmartTab() {
    var P = (typeof window !== 'undefined' && window.PixiStudio) ? window.PixiStudio.ArpPanel : null;
    if (P && typeof P.showTab === 'function') { P.showTab('smart'); return { ok: true, tab: 'smart' }; }
    var QR = getQR();
    if (QR && typeof QR.switchToSmartTab === 'function') return QR.switchToSmartTab();
    return { ok: false, error: 'Không mở được tab Smart (ArpPanel chưa load).' };
  }
  function switchToQuickRigTab() {
    var P = (typeof window !== 'undefined' && window.PixiStudio) ? window.PixiStudio.ArpPanel : null;
    if (P && typeof P.showTab === 'function') { P.showTab('quickrig'); return { ok: true, tab: 'quickrig' }; }
    return { ok: false, error: 'Không mở được tab Quick Rig (ArpPanel chưa load).' };
  }

  /* ---------- 1a. Master control (Ctrl_Master — naming.py) ---------- */
  function createMaster(target) {
    var T = getTHREE();
    var QR = getQR();
    var cur = QR && QR.current;
    var hips = cur && cur.bones ? cur.bones.Hips : null;
    if (!hips) return null;
    target.updateMatrixWorld(true);
    var master = new T.Object3D();
    master.name = 'Ctrl_Master';
    master.userData.isMixamoRigMaster = true;
    master.userData.isArpControl = true;
    try {
      var wp = worldPosOf(hips);
      master.position.copy(target.worldToLocal(wp.clone()));
    } catch (e) { master.position.set(0, 0, 0); }
    target.add(master);
    state.masterObj = master;
    state.bindHipsPos = hips.position.clone();
    state.bindHipsQuat = hips.quaternion.clone();
    state.master = { position: [0, 0, 0], rotation: [0, 0, 0] };
    return master;
  }
  function applyMaster() {
    var QR = getQR();
    var cur = QR && QR.current;
    var hips = cur && cur.bones ? cur.bones.Hips : null;
    var T = getTHREE();
    if (!hips || !state.bindHipsPos || !state.bindHipsQuat || !T) return { ok: false, error: 'Chưa có master / bind Hips.' };
    hips.position.copy(state.bindHipsPos).add(new T.Vector3(state.master.position[0], state.master.position[1], state.master.position[2]));
    var eq = new T.Quaternion().setFromEuler(new T.Euler(state.master.rotation[0], state.master.rotation[1], state.master.rotation[2]));
    hips.quaternion.copy(state.bindHipsQuat).multiply(eq);
    if (state.masterObj) {
      try {
        var wp = worldPosOf(hips);
        state.masterObj.position.copy(state.target.worldToLocal(wp.clone()));
      } catch (e) {}
    }
    if (state.target) state.target.updateMatrixWorld(true);
    return { ok: true, position: state.master.position.slice(), rotation: state.master.rotation.slice() };
  }
  function setMasterPosition(x, y, z) {
    if (!state.built) return { ok: false, error: 'Chưa build Mixamo Rig.' };
    state.master.position = [Number(x) || 0, Number(y) || 0, Number(z) || 0];
    return applyMaster();
  }
  function setMasterRotation(x, y, z) {
    if (!state.built) return { ok: false, error: 'Chưa build Mixamo Rig.' };
    state.master.rotation = [Number(x) || 0, Number(y) || 0, Number(z) || 0];
    return applyMaster();
  }
  function resetMaster() {
    state.master = { position: [0, 0, 0], rotation: [0, 0, 0] };
    return applyMaster();
  }
  function getMaster() { return { position: state.master.position.slice(), rotation: state.master.rotation.slice(), built: state.built }; }

  /* ---------- 1b. Blend IK/FK từng chi (slerp, như AdvIK) ---------- */
  /* Fallback khi AdvIK chưa load: chụp FK, giải IK bằng
     QR.solveTwoBoneIK, slerp từng khớp — cùng thuật toán AdvIK. */
  function fallbackBlendIKFK(limbKey, t) {
    var QR = getQR();
    var T = getTHREE();
    var cur = QR && QR.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    var def = QR.LIMBS && QR.LIMBS[limbKey];
    if (!def) return { ok: false, error: 'Chi không hợp lệ: ' + limbKey };
    var rootBone = cur.bones[def.root], midBone = cur.bones[def.mid], endBone = cur.bones[def.end];
    if (!rootBone || !midBone || !endBone) return { ok: false, error: 'Thiếu xương cho ' + limbKey };
    if (typeof QR.solveTwoBoneIK !== 'function') return { ok: false, error: 'solveTwoBoneIK chưa có.' };
    cur.target.updateMatrixWorld(true);
    var fkRootQ = rootBone.quaternion.clone(), fkMidQ = midBone.quaternion.clone();
    var targetW = (cur.controls && cur.controls[def.end]) ? worldPosOf(cur.controls[def.end]) : worldPosOf(endBone);
    var poleW = (cur.poles && cur.poles[limbKey]) ? worldPosOf(cur.poles[limbKey]) : null;
    var sol = QR.solveTwoBoneIK(worldPosOf(rootBone), worldPosOf(midBone), worldPosOf(endBone), targetW, poleW);
    var applyWorldDelta = function (bone, worldDelta) {
      var pq = new T.Quaternion();
      try { bone.parent.getWorldQuaternion(pq); } catch (e) { pq.identity(); }
      var localDelta = pq.clone().invert().multiply(worldDelta).multiply(pq);
      bone.quaternion.premultiply(localDelta);
    };
    applyWorldDelta(rootBone, sol.rootQuaternion);
    applyWorldDelta(midBone, sol.midQuaternion);
    cur.target.updateMatrixWorld(true);
    var ikRootQ = rootBone.quaternion.clone(), ikMidQ = midBone.quaternion.clone();
    rootBone.quaternion.copy(fkRootQ.clone().slerp(ikRootQ, t));
    midBone.quaternion.copy(fkMidQ.clone().slerp(ikMidQ, t));
    cur.target.updateMatrixWorld(true);
    var endW = worldPosOf(endBone);
    return { ok: true, limb: limbKey, t: t, endPosition: vecToArr(endW), target: vecToArr(targetW), endError: +endW.distanceTo(targetW).toFixed(4), fallback: true };
  }
  /* Khôi phục tư thế FK đã lưu (cur.fkRotations) trước khi blend để
     blend là TUYỆT ĐỐI (t=0 = đúng FK đã lưu), không phải tương đối
     với pose hiện tại — nếu không, sau khi blend lên 1 thì blend về
     0.5 vẫn giữ nguyên pose IK. Trả lại mode cũ sau khi blend. */
  function restoreFKPose(limbKey) {
    var QR = getQR();
    var cur = QR && QR.current;
    if (!cur) return null;
    var prevMode = cur.limbModes ? cur.limbModes[limbKey] : null;
    try {
      if (typeof QR.setLimbMode === 'function') QR.setLimbMode(limbKey, 'FK');
      if (typeof QR.updateLimb === 'function') QR.updateLimb(limbKey);
    } catch (e) {}
    return prevMode;
  }
  function restoreLimbMode(limbKey, prevMode) {
    var QR = getQR();
    try {
      if (prevMode && typeof QR.setLimbMode === 'function') QR.setLimbMode(limbKey, prevMode);
    } catch (e) {}
  }
  function setBlend(limbKey, t) {
    limbKey = normLimb(limbKey);
    if (!limbKey) return { ok: false, error: 'Chi không hợp lệ: ' + limbKey };
    if (!state.built) return { ok: false, error: 'Chưa build Mixamo Rig.' };
    t = clamp(t, 0, 1);
    var AdvIK = getAdvIK();
    var prevMode = restoreFKPose(limbKey);
    var res;
    if (AdvIK && typeof AdvIK.blendIKFK === 'function') {
      res = AdvIK.blendIKFK(limbKey, t);
      if (!res || !res.ok) { restoreLimbMode(limbKey, prevMode); return res || { ok: false, error: 'blendIKFK lỗi.' }; }
    } else {
      res = fallbackBlendIKFK(limbKey, t);
      if (!res.ok) { restoreLimbMode(limbKey, prevMode); return res; }
    }
    restoreLimbMode(limbKey, prevMode);
    state.blends[limbKey] = t;
    return res;
  }
  function getBlend(limbKey) {
    limbKey = normLimb(limbKey);
    if (!limbKey) return { ok: false, error: 'Chi không hợp lệ: ' + limbKey, t: 0 };
    return { ok: true, limb: limbKey, t: (state.blends[limbKey] === undefined ? DEFAULT_BLENDS[limbKey] : state.blends[limbKey]) };
  }
  function getBlends() {
    var out = {};
    LIMBS.forEach(function (l) { out[l] = state.blends[l]; });
    return out;
  }

  /* ---------- 1c. Pole target (maths_geo.get_ik_pole_pos m1) ---------- */
  /* Hướng mặc định theo quy ước addon/AdvIK: khuỷu ra SAU (-Z),
     gối ra TRƯỚC (+Z); khi chi đã gập thì giữ hướng gập thật. */
  function computePoleDirection(limbKey, rootW, midW, endW) {
    var T = getTHREE();
    var kind = LIMB_KIND[limbKey];
    var midPoint = rootW.clone().add(endW).multiplyScalar(0.5);
    var bendDir = midW.clone().sub(midPoint);
    var limbLen = rootW.distanceTo(endW);
    if (bendDir.lengthSq() < Math.pow(Math.max(0.005, limbLen * 0.02), 2)) {
      return { dir: new T.Vector3(0, 0, kind === 'arm' ? -1 : 1), fromBend: false };
    }
    bendDir.normalize();
    if (kind === 'arm' && bendDir.z > 0) bendDir.z = -bendDir.z;
    if (kind === 'leg' && bendDir.z < 0) bendDir.z = -bendDir.z;
    if (bendDir.lengthSq() < 1e-8) bendDir = new T.Vector3(0, 0, kind === 'arm' ? -1 : 1);
    bendDir.normalize();
    return { dir: bendDir, fromBend: true };
  }
  function createPoleLines() {
    var T = getTHREE();
    var QR = getQR();
    var cur = QR && QR.current;
    if (!cur || !cur.poles || !T) return 0;
    LIMBS.forEach(function (limb) {
      var pole = cur.poles[limb];
      if (!pole) return;
      var geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
      var line = new T.Line(geo, new T.LineBasicMaterial({ color: 0x713BFF }));
      line.name = 'Ctrl_MixamoRig_PoleLine_' + limb;
      line.userData.isMixamoRigPoleLine = true;
      line.frustumCulled = false;
      state.target.add(line);
      state.poleLines[limb] = line;
    });
    updatePoleLines();
    return Object.keys(state.poleLines).length;
  }
  function updatePoleLines() {
    var T = getTHREE();
    var QR = getQR();
    var cur = QR && QR.current;
    if (!cur || !T || !state.target) return 0;
    var n = 0;
    LIMBS.forEach(function (limb) {
      var line = state.poleLines[limb];
      var pole = cur.poles && cur.poles[limb];
      var def = QR.LIMBS && QR.LIMBS[limb];
      var midBone = def && cur.bones ? cur.bones[def.mid] : null;
      if (!line || !pole || !midBone) return;
      state.target.updateMatrixWorld(true);
      var p = state.target.worldToLocal(worldPosOf(pole).clone());
      var m = state.target.worldToLocal(worldPosOf(midBone).clone());
      var attr = line.geometry.attributes.position;
      attr.setXYZ(0, p.x, p.y, p.z);
      attr.setXYZ(1, m.x, m.y, m.z);
      attr.needsUpdate = true;
      n++;
    });
    return n;
  }
  function autoPole(limbKey) {
    limbKey = normLimb(limbKey);
    if (!limbKey) return { ok: false, error: 'Chi không hợp lệ: ' + limbKey };
    if (!state.built) return { ok: false, error: 'Chưa build Mixamo Rig.' };
    var AdvIK = getAdvIK();
    var res;
    if (AdvIK && typeof AdvIK.autoPlacePole === 'function') {
      res = AdvIK.autoPlacePole(limbKey);
      if (!res || !res.ok) return res || { ok: false, error: 'autoPlacePole lỗi.' };
    } else {
      var QR = getQR();
      var cur = QR && QR.current;
      var def = QR.LIMBS[limbKey];
      var rootBone = cur.bones[def.root], midBone = cur.bones[def.mid], endBone = cur.bones[def.end];
      if (!rootBone || !midBone || !endBone || !cur.poles[limbKey]) return { ok: false, error: 'Thiếu xương/pole cho ' + limbKey };
      cur.target.updateMatrixWorld(true);
      var rootW = worldPosOf(rootBone), midW = worldPosOf(midBone), endW = worldPosOf(endBone);
      var d = computePoleDirection(limbKey, rootW, midW, endW);
      var dist = Math.max(0.08, (cur.height || 1.8) * 0.12);
      var polePos = midW.clone().add(d.dir.clone().multiplyScalar(dist));
      var r = QR.setPolePosition(limbKey, { x: polePos.x, y: polePos.y, z: polePos.z });
      if (!r.ok) return r;
      res = { ok: true, limb: limbKey, kind: LIMB_KIND[limbKey], polePosition: vecToArr(polePos), bendDir: vecToArr(d.dir), midPosition: vecToArr(midW), distance: +dist.toFixed(3), fallback: true };
    }
    var off = state.poleOffset[limbKey] || 0;
    if (off) {
      var QR2 = getQR();
      var cur2 = QR2 && QR2.current;
      if (cur2 && cur2.poles && cur2.poles[limbKey]) {
        try {
          var p = worldPosOf(cur2.poles[limbKey]);
          p.z += off;
          QR2.setPolePosition(limbKey, { x: p.x, y: p.y, z: p.z });
          res.polePosition = vecToArr(p);
        } catch (e) {}
      }
    }
    updatePoleLines();
    res.direction = LIMB_KIND[limbKey] === 'arm' ? 'sau (-Z)' : 'trước (+Z)';
    return res;
  }
  function autoPoleAll() {
    var out = {};
    LIMBS.forEach(function (l) { out[l] = autoPole(l); });
    return { ok: LIMBS.every(function (l) { return out[l].ok; }), poles: out };
  }
  function setPoleOffset(limbKey, offset) {
    limbKey = normLimb(limbKey);
    if (!limbKey) return { ok: false, error: 'Chi không hợp lệ: ' + limbKey };
    state.poleOffset[limbKey] = clamp(offset, -0.5, 0.5);
    if (state.built) return autoPole(limbKey);
    return { ok: true, limb: limbKey, poleOffset: state.poleOffset[limbKey] };
  }

  /* ---------- 1d. Hand control (nhóm ngón) ---------- */
  function setFingerCurlGroup(group, curl) {
    if (!FINGER_GROUPS[group]) return { ok: false, error: 'Nhóm ngón không hợp lệ: ' + group + ' (thumb/indexMiddle/ringPinky/all).' };
    if (!state.built) return { ok: false, error: 'Chưa build Mixamo Rig.' };
    var QR = getQR();
    curl = clamp(curl, 0, 1);
    var total = 0, errors = [];
    FINGER_GROUPS[group].forEach(function (key) {
      var r = QR.setFingerCurl(key, curl);
      if (r && r.ok) total += (r.bonesChanged || 0);
      else if (r) errors.push(key + ': ' + r.error);
    });
    state.fingerCurl[group] = curl;
    if (group === 'all') { Object.keys(state.fingerCurl).forEach(function (g) { state.fingerCurl[g] = curl; }); }
    return { ok: errors.length === 0, group: group, curl: curl, bonesChanged: total, errors: errors };
  }

  /* ---------- 1e. Foot control (heel/toe roll + pivot) ---------- */
  function setFootRoll(side, roll) {
    side = (side === 'Right' || side === 'right') ? 'Right' : 'Left';
    if (!state.built) return { ok: false, error: 'Chưa build Mixamo Rig.' };
    var QR = getQR();
    roll = clamp(roll, 0, 1);
    state.footRoll[side] = roll;
    if (state.footPivot[side] === 'toe') {
      /* Pivot ở mũi: chỉ xoay ToeBase, Foot giữ nguyên. */
      var r1 = QR.setFKRotation(side + 'Foot', { x: 0, y: 0, z: 0 });
      var r2 = QR.setFKRotation(side + 'ToeBase', { x: -0.9 * roll, y: 0, z: 0 });
      return { ok: !!(r1.ok && r2.ok), side: side, roll: roll, pivot: 'toe', bonesChanged: (r1.ok ? 1 : 0) + (r2.ok ? 1 : 0) };
    }
    var r = QR.setFootRoll(side, roll);
    if (r) r.pivot = 'heel';
    return r;
  }
  function setFootPivot(side, pivot) {
    side = (side === 'Right' || side === 'right') ? 'Right' : 'Left';
    if (pivot !== 'heel' && pivot !== 'toe') return { ok: false, error: 'Pivot phải là "heel" (gót) hoặc "toe" (mũi).' };
    state.footPivot[side] = pivot;
    if (!state.built) return { ok: true, side: side, pivot: pivot };
    return setFootRoll(side, state.footRoll[side] || 0);
  }

  /* ---------- 1f. Spine/head FK (dùng lại Quick Rig) ---------- */
  function setSpine(dst, euler) {
    if (!state.built) return { ok: false, error: 'Chưa build Mixamo Rig.' };
    var QR = getQR();
    return QR.setSpineRotation(dst, euler || { x: 0, y: 0, z: 0 });
  }
  function setHead(euler) {
    if (!state.built) return { ok: false, error: 'Chưa build Mixamo Rig.' };
    return getQR().setHeadRotation(euler || { x: 0, y: 0, z: 0 });
  }
  function setNeck(euler) {
    if (!state.built) return { ok: false, error: 'Chưa build Mixamo Rig.' };
    return getQR().setNeckRotation(euler || { x: 0, y: 0, z: 0 });
  }

  /* ---------- 1. Build Mixamo Rig ---------- */
  function buildMixamoRig(target, opts) {
    opts = opts || {};
    target = target || null;
    var QR = getQR();
    if (!QR || typeof QR.autoGenMixamo !== 'function') {
      return Promise.resolve({ ok: false, error: 'ArpQuickRig chưa load — không build được Mixamo Rig.' });
    }
    var det = detect(target);
    if (!det.isMixamo) {
      var na = getNonMixamoAction(target);
      return Promise.resolve({ ok: false, error: na.message, detection: det, suggestSmartTab: true, actions: na.actions });
    }
    return QR.autoGenMixamo(target, { mode: opts.mode || 'keep' }).then(function (ag) {
      if (!ag || !ag.ok) return { ok: false, error: (ag && ag.errors ? ag.errors.join('; ') : 'autoGenMixamo thất bại.'), detection: det, autoGen: ag };
      state.target = target;
      state.detection = det;
      state.built = true;
      state.matchedToSource = false;
      state.blends = { LeftArm: 0, RightArm: 0, LeftLeg: 1, RightLeg: 1 };
      state.poleOffset = { LeftArm: 0, RightArm: 0, LeftLeg: 0, RightLeg: 0 };
      state.footPivot = { Left: 'heel', Right: 'heel' };
      state.footRoll = { Left: 0, Right: 0 };
      state.fingerCurl = { thumb: 0, indexMiddle: 0, ringPinky: 0, all: 0 };
      createMaster(target);
      var lines = createPoleLines();
      autoPoleAll();
      /* Áp blend mặc định (tay FK 0, chân IK 1) để state khớp pose. */
      LIMBS.forEach(function (l) { try { setBlend(l, state.blends[l]); } catch (e) {} });
      try { matchToSource(); } catch (e) {}
      return {
        ok: true, detection: det, autoGen: ag,
        controls: {
          master: !!state.masterObj,
          limbs: LIMBS.slice(),
          blends: getBlends(),
          poles: Object.keys(state.poleLines).length,
          poleLines: lines,
          handGroups: Object.keys(FINGER_GROUPS),
          footPivots: ['heel', 'toe'],
          spine: ['Spine', 'Spine1', 'Spine2'],
          head: ['Neck', 'Head']
        },
        mappedCount: ag.mappedCount, proxyCount: ag.proxyCount || 0,
        clipNames: ag.clipNames || []
      };
    });
  }

  /* ---------- 2. Settings / Reset / Remove ---------- */
  function getSettings() {
    return {
      built: state.built,
      isMixamo: !!(state.detection && state.detection.isMixamo),
      blends: getBlends(),
      poleOffset: { LeftArm: state.poleOffset.LeftArm, RightArm: state.poleOffset.RightArm, LeftLeg: state.poleOffset.LeftLeg, RightLeg: state.poleOffset.RightLeg },
      footPivot: { Left: state.footPivot.Left, Right: state.footPivot.Right },
      footRoll: { Left: state.footRoll.Left, Right: state.footRoll.Right },
      fingerCurl: { thumb: state.fingerCurl.thumb, indexMiddle: state.fingerCurl.indexMiddle, ringPinky: state.fingerCurl.ringPinky, all: state.fingerCurl.all },
      master: getMaster(),
      matchedToSource: state.matchedToSource,
      clipNames: (state.detection && state.detection.clipNames) || []
    };
  }
  function restoreBindPose() {
    var QR = getQR();
    var cur = QR && QR.current;
    if (!cur || !cur.bones) return 0;
    var pose = cur.mixamoBindPose;
    var n = 0;
    if (pose) {
      Object.keys(pose).forEach(function (dst) {
        var b = cur.bones[dst];
        if (b && pose[dst]) { b.rotation.set(pose[dst][0], pose[dst][1], pose[dst][2]); n++; }
      });
    }
    if (cur.target) cur.target.updateMatrixWorld(true);
    return n;
  }
  function resetMixamoRig() {
    if (!state.built) return { ok: false, error: 'Chưa build Mixamo Rig.' };
    var restored = restoreBindPose();
    resetMaster();
    state.blends = { LeftArm: 0, RightArm: 0, LeftLeg: 1, RightLeg: 1 };
    state.footPivot = { Left: 'heel', Right: 'heel' };
    state.footRoll = { Left: 0, Right: 0 };
    state.fingerCurl = { thumb: 0, indexMiddle: 0, ringPinky: 0, all: 0 };
    state.matchedToSource = false;
    LIMBS.forEach(function (l) { try { setBlend(l, state.blends[l]); } catch (e) {} });
    try { getQR().setFingerCurl('all', 0); } catch (e) {}
    try { getQR().setFootRoll('Left', 0); getQR().setFootRoll('Right', 0); } catch (e) {}
    updatePoleLines();
    return { ok: true, restoredBones: restored, settings: getSettings() };
  }
  function removeMixamoRig() {
    if (!state.built && !state.target) return { ok: false, error: 'Chưa có Mixamo Rig để xóa.' };
    restoreBindPose();
    if (state.masterObj && state.masterObj.parent) state.masterObj.parent.remove(state.masterObj);
    Object.keys(state.poleLines).forEach(function (limb) {
      var line = state.poleLines[limb];
      if (line) {
        if (line.parent) line.parent.remove(line);
        if (line.geometry && line.geometry.dispose) line.geometry.dispose();
        if (line.material && line.material.dispose) line.material.dispose();
      }
    });
    state.masterObj = null;
    state.poleLines = {};
    state.built = false;
    state.matchedToSource = false;
    state.bakedClips = {};
    state.target = null;
    state.detection = null;
    return { ok: true, message: 'Đã gỡ Mixamo Rig, skeleton về tư thế gốc (bind pose).' };
  }

  /* ---------- 3. Cảnh báo kiểu Visual Keying ---------- */
  /* Addon: cảnh báo khi Visual Keying bật (pole nhảy sau khi ghi
     key). Ở studio không có Visual Keying của Blender, điều kiện
     tương đương: 1 chi đang ở IK (blend > 0) mà control chưa được
     Match to source → ghi key lúc này sẽ ghi pose IK chưa khớp,
     pole có thể lệch. */
  function checkKeyingWarning() {
    if (!state.built) return { show: false, limbs: [], message: '' };
    var ikLimbs = LIMBS.filter(function (l) { return (state.blends[l] || 0) > 0; });
    var show = ikLimbs.length > 0 && !state.matchedToSource;
    return {
      show: show,
      limbs: ikLimbs,
      message: show ? KEYING_WARN_MSG + ' (' + ikLimbs.map(function (l) { return LIMB_LABEL[l]; }).join(', ') + ' đang IK).' : '',
      fix: 'Match to source'
    };
  }
  function matchToSource() {
    var QR = getQR();
    var r = null;
    if (QR && typeof QR.matchToSource === 'function') {
      try { r = QR.matchToSource(); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    }
    if (r && r.ok === false) return r;
    state.matchedToSource = true;
    updatePoleLines();
    return { ok: true, matched: true, quickRig: r };
  }
  function recordKeyGuarded(t) {
    var w = checkKeyingWarning();
    if (w.show) return { ok: false, blockedByWarning: true, warning: w };
    var KF = getKeyframe();
    if (!KF || typeof KF.recordKey !== 'function') return { ok: false, error: 'ArpKeyframe chưa load — không ghi được key.' };
    return KF.recordKey(t);
  }

  /* ---------- 4. Animation: phát clip + bake + xuất ---------- */
  function listClips() {
    var QR = getQR();
    if (!QR || typeof QR.collectClips !== 'function' || !state.target) return [];
    return QR.collectClips(state.target);
  }
  function playClip(name) {
    var QR = getQR();
    if (!state.built) return { ok: false, error: 'Chưa build Mixamo Rig.' };
    if (!QR || typeof QR.playMixamoClip !== 'function') return { ok: false, error: 'playMixamoClip chưa có.' };
    return QR.playMixamoClip(name);
  }
  function tick(dt) {
    var QR = getQR();
    if (!QR || typeof QR.tickMixamo !== 'function') return { ok: false, error: 'tickMixamo chưa có.' };
    return QR.tickMixamo(dt);
  }
  function stopClip() {
    var QR = getQR();
    if (!QR || typeof QR.stopMixamoClip !== 'function') return { ok: false, error: 'stopMixamoClip chưa có.' };
    return QR.stopMixamoClip();
  }
  function validateClipLocal(clip) {
    var Anim = getAnim();
    if (Anim && typeof Anim.validateClip === 'function') return Anim.validateClip(clip);
    var bad = [];
    if (!clip || !clip.tracks) return bad;
    clip.tracks.forEach(function (t) {
      var size = t.name.indexOf('quaternion') !== -1 ? 4 : 3;
      var need = t.times.length * size;
      if (t.values.length !== need) bad.push(t.name + ' values=' + t.values.length + ' cần=' + need);
      else if (t.values.length) {
        for (var i = 0; i < t.values.length; i++) {
          if (!isFinite(t.values[i])) { bad.push(t.name + ' có giá trị NaN/Inf'); break; }
        }
      }
    });
    return bad;
  }
  function bakeClip(clipName, opts) {
    opts = opts || {};
    var T = getTHREE();
    if (!state.built) return { ok: false, error: 'Chưa build Mixamo Rig.' };
    if (!T || !T.AnimationMixer || !T.AnimationClip) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var fps = [24, 30, 60].indexOf(Number(opts.fps)) >= 0 ? Number(opts.fps) : 30;
    var clips = listClips();
    var src = null;
    if (clipName) clips.forEach(function (c) { if (c.name === clipName) src = c; });
    if (!src) src = clips[0] || null;
    if (!src) return { ok: false, error: 'Không có clip Mixamo nào để bake' + (clipName ? ' (' + clipName + ')' : '') + '.' };
    var QR = getQR();
    var cur = QR && QR.current;
    if (!cur || !cur.bones) return { ok: false, error: 'Chưa có control rig.' };
    var duration = src.duration || 0;
    if (!(duration > 0)) return { ok: false, error: 'Clip "' + src.name + '" không có duration.' };
    var frames = Math.round(duration * fps) + 1;
    var times = [];
    for (var i = 0; i < frames; i++) times.push(+(i / fps).toFixed(4));
    var mixer = new T.AnimationMixer(state.target);
    var action = mixer.clipAction(src);
    action.setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    var boneNames = Object.keys(cur.bones);
    var quatVals = {}, posVals = {};
    boneNames.forEach(function (dst) { quatVals[dst] = []; posVals[dst] = []; });
    var hipsBone = cur.bones.Hips;
    for (var f = 0; f < frames; f++) {
      mixer.setTime(times[f]);
      state.target.updateMatrixWorld(true);
      boneNames.forEach(function (dst) {
        var b = cur.bones[dst];
        if (!b) return;
        quatVals[dst].push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        if (b === hipsBone) posVals[dst].push(b.position.x, b.position.y, b.position.z);
      });
    }
    try { action.stop(); } catch (e) {}
    try { mixer.uncacheClip(src); } catch (e) {}
    var tracks = [];
    boneNames.forEach(function (dst) {
      var b = cur.bones[dst];
      if (!b || !quatVals[dst].length) return;
      tracks.push(new T.QuaternionKeyframeTrack(b.name + '.quaternion', times, quatVals[dst]));
      if (b === hipsBone) tracks.push(new T.VectorKeyframeTrack(b.name + '.position', times, posVals[dst]));
    });
    var bakedName = (opts.name || src.name + '_Baked');
    var clip = new T.AnimationClip(bakedName, duration, tracks);
    var bad = validateClipLocal(clip);
    if (bad.length) return { ok: false, error: 'Clip bake ra không hợp lệ: ' + bad.join('; '), badTracks: bad };
    state.bakedClips[bakedName] = { clip: clip, fps: fps, frames: frames, duration: duration, source: src.name };
    restoreBindPose();
    resetMaster();
    return { ok: true, name: bakedName, source: src.name, fps: fps, frames: frames, duration: +duration.toFixed(4), trackCount: tracks.length, badTracks: [], clip: clip };
  }
  function buildBakedJSON(bakedName) {
    var baked = state.bakedClips[bakedName];
    if (!baked) return { ok: false, error: 'Chưa bake clip "' + bakedName + '" — bấm Bake trước.' };
    var clip = baked.clip;
    var QR = getQR();
    var cur = QR && QR.current;
    var boneNames = cur ? Object.keys(cur.bones).map(function (dst) { return cur.bones[dst] ? cur.bones[dst].name : dst; }) : [];
    var id = bakedName.replace(/[^A-Za-z0-9_]+/g, '_');
    /* keys: 1 key/frame/bone — cùng shape với Keyframe.exportClip
       (keys[] + tracks[]), để studio đọc lại được. */
    var keys = [];
    var fps = baked.fps;
    for (var f = 0; f < baked.frames; f++) {
      var t = +(f / fps).toFixed(4);
      clip.tracks.forEach(function (tr) {
        if (/\.quaternion$/.test(tr.name)) {
          var o = f * 4;
          keys.push({ t: t, bone: tr.name.slice(0, tr.name.lastIndexOf('.')), quat: [tr.values[o], tr.values[o + 1], tr.values[o + 2], tr.values[o + 3]] });
        }
      });
    }
    var data = {
      format: KEYFRAME_FORMAT,
      character: 'mixamo-rig',
      skeleton: { boneNames: boneNames, boneCount: boneNames.length },
      clips: [{
        id: id, name: bakedName, duration: baked.duration, loop: false,
        source: 'arp-plugin-mixamorig', fps: fps,
        keys: keys,
        tracks: clip.tracks.map(function (tr) {
          return { name: tr.name, times: Array.prototype.slice.call(tr.times), values: Array.prototype.slice.call(tr.values) };
        })
      }]
    };
    var text = JSON.stringify(data, null, 1);
    return { ok: true, json: data, text: text, filename: 'mixamorig_' + id + '_clips.json', format: KEYFRAME_FORMAT, trackCount: clip.tracks.length, keyCount: keys.length };
  }
  function exportBakedJSON(bakedName, opts) {
    opts = opts || {};
    var r = buildBakedJSON(bakedName);
    if (!r.ok) return r;
    if (opts.download !== false) {
      try {
        var P = window.PixiStudio;
        if (P && P.Utils && typeof P.Utils.downloadText === 'function') P.Utils.downloadText(r.text, r.filename, 'application/json');
      } catch (e) {}
    }
    return r;
  }
  function exportBakedFBX(bakedName, opts) {
    opts = opts || {};
    var baked = state.bakedClips[bakedName];
    if (!baked) return { ok: false, error: 'Chưa bake clip "' + bakedName + '" — bấm Bake trước.' };
    var QR = getQR();
    if (!QR || typeof QR.exportMixamoCompatible !== 'function') return { ok: false, error: 'exportMixamoCompatible chưa có.' };
    var r = QR.exportMixamoCompatible(state.target, { animations: [{ name: baked.clip.name, clip: baked.clip }], download: false });
    if (!r) return { ok: false, error: 'Xuất FBX lỗi (không có kết quả).' };
    r.bakedClip = bakedName;
    return r;
  }

  /* ---------- UI (tab riêng plugin:mixamo-rig) ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function mkSlider(label, min, max, step, value, oninput) {
    var row = el('div', 'arp-mr-row');
    var lab = el('span', 'arp-mr-label', label + ': ');
    var val = el('b', 'arp-mr-val', String(value));
    var s = document.createElement('input');
    s.type = 'range'; s.min = String(min); s.max = String(max); s.step = String(step); s.value = String(value);
    s.className = 'arp-mr-slider';
    s.addEventListener('input', function () { val.textContent = s.value; oninput(Number(s.value)); });
    row.appendChild(lab); row.appendChild(s); row.appendChild(val);
    return row;
  }
  function renderSection(container, ctx) {
    if (!container) return;
    container.innerHTML = '';
    var wrap = el('div', 'arp-mr-wrap');
    wrap.appendChild(el('div', 'arp-mr-title', '🎛️ Mixamo Rig — control rig kiểu Blender addon (tdw46/mixamo_blender4-main)'));
    wrap.appendChild(el('div', 'arp-note', 'Thiết kế học từ addon: Master, IK/FK switch từng chi, pole, hand/foot, spine/head, panel Mixamo Rig Settings, cảnh báo Visual Keying, bake xuống skeleton. IK vẫn là solver 2-bone của Quick Rig.'));
    var status = el('div', 'arp-mr-status', '');
    wrap.appendChild(status);
    var setStatus = function (m) { status.textContent = m; };

    var model = null;
    try { model = ctx ? ctx.getModel() : null; } catch (e) { model = null; }
    if (!model) {
      wrap.appendChild(el('p', 'arp-note', 'Chưa có model — hãy load model trước.'));
      container.appendChild(wrap);
      return;
    }
    var det = detect(model);
    if (!det.isMixamo) {
      var na = getNonMixamoAction(model);
      var box = el('div', 'arp-mr-warn', na.message + '. ' + na.hint);
      wrap.appendChild(box);
      var row = el('div', 'arp-mr-row');
      var bSmart = el('button', 'arp-btn arp-btn-primary', '🧠 Mở tab Smart (rig mới)');
      bSmart.addEventListener('click', function () { switchToSmartTab(); });
      var bQR = el('button', 'arp-btn', '🦴 Mở tab Quick Rig (map thủ công)');
      bQR.addEventListener('click', function () { switchToQuickRigTab(); });
      row.appendChild(bSmart); row.appendChild(bQR);
      wrap.appendChild(row);
      wrap.appendChild(el('div', 'arp-note', det.reasons.join(' ')));
      container.appendChild(wrap);
      return;
    }

    /* --- Build --- */
    var buildRow = el('div', 'arp-mr-row');
    var buildBtn = el('button', 'arp-btn arp-btn-primary', state.built ? '✓ Đã build Mixamo Rig' : '🔧 Build Mixamo Rig');
    buildBtn.disabled = !!state.built;
    buildBtn.addEventListener('click', function () {
      setStatus('Đang build Mixamo Rig…');
      buildMixamoRig(model, { mode: 'keep' }).then(function (r) {
        if (r.ok) { setStatus('Build xong: ' + r.mappedCount + '/41 xương, master + 4 chi IK/FK + 4 pole + hand/foot + spine/head.'); renderSection(container, ctx); }
        else setStatus('Build lỗi: ' + (r.error || 'không rõ nguyên nhân.'));
      });
    });
    buildRow.appendChild(buildBtn);
    wrap.appendChild(buildRow);
    wrap.appendChild(el('div', 'arp-note', 'Rig Mixamo: ' + det.mappedCount + '/41 xương · ' + (det.clipNames || []).join(', ') + ' · ' + det.pose + '.'));
    if (!state.built) { container.appendChild(wrap); return; }

    /* --- Cảnh báo Visual Keying --- */
    var warnBox = el('div', 'arp-mr-warn');
    var refreshWarn = function () {
      var w = checkKeyingWarning();
      warnBox.style.display = w.show ? '' : 'none';
      warnBox.innerHTML = '';
      if (w.show) {
        warnBox.appendChild(el('b', '', '⚠️ ' + w.message));
        var mb = el('button', 'arp-btn', '🎯 Match to source');
        mb.style.marginLeft = '8px';
        mb.addEventListener('click', function () { matchToSource(); setStatus('Đã Match to source — có thể ghi key an toàn.'); renderSection(container, ctx); });
        warnBox.appendChild(mb);
      }
    };
    wrap.appendChild(warnBox);
    refreshWarn();

    /* --- Mixamo Rig Settings: 4 slider blend --- */
    wrap.appendChild(el('div', 'arp-mr-h', '⚙️ Mixamo Rig Settings — IK/FK blend (0 = FK, 100 = IK)'));
    LIMBS.forEach(function (limb) {
      wrap.appendChild(mkSlider(LIMB_LABEL[limb], 0, 100, 5, Math.round((state.blends[limb] || 0) * 100), function (v) {
        var r = setBlend(limb, v / 100);
        if (r.ok) { refreshWarn(); updatePoleLines(); } else setStatus('Blend lỗi: ' + (r.error || ''));
      }));
    });
    var poleRow = el('div', 'arp-mr-row');
    var autoPoleBtn = el('button', 'arp-btn', '🎯 Auto Pole (khuỷu sau / gối trước)');
    autoPoleBtn.addEventListener('click', function () { var r = autoPoleAll(); setStatus(r.ok ? 'Đã đặt lại 4 pole theo tư thế hiện tại.' : 'Auto Pole lỗi ở 1 chi — xem console.'); });
    poleRow.appendChild(autoPoleBtn);
    wrap.appendChild(poleRow);

    /* --- Master --- */
    wrap.appendChild(el('div', 'arp-mr-h', '👑 Master control (Ctrl_Master — điều khiển toàn thân qua Hips)'));
    var mRow = el('div', 'arp-mr-row');
    var mReset = el('button', 'arp-btn', '↺ Reset master về gốc');
    mReset.addEventListener('click', function () { resetMaster(); setStatus('Master đã về gốc.'); });
    mRow.appendChild(mReset);
    mRow.appendChild(el('span', 'arp-note', 'Vị trí master: ' + JSON.stringify(getMaster().position)));
    wrap.appendChild(mRow);

    /* --- Hand / Foot --- */
    wrap.appendChild(el('div', 'arp-mr-h', '✋ Hand control — finger curl theo nhóm ngón'));
    Object.keys(FINGER_GROUPS).forEach(function (g) {
      wrap.appendChild(mkSlider(FINGER_LABEL[g], 0, 100, 5, Math.round((state.fingerCurl[g] || 0) * 100), function (v) {
        var r = setFingerCurlGroup(g, v / 100);
        if (!r.ok) setStatus('Finger curl lỗi: ' + (r.errors || []).join('; '));
      }));
    });
    wrap.appendChild(el('div', 'arp-mr-h', '🦶 Foot control — heel/toe roll + pivot'));
    ['Left', 'Right'].forEach(function (side) {
      wrap.appendChild(mkSlider('Roll chân ' + (side === 'Left' ? 'trái' : 'phải') + ' (gót→mũi)', 0, 100, 5, Math.round((state.footRoll[side] || 0) * 100), function (v) {
        var r = setFootRoll(side, v / 100);
        if (!r.ok) setStatus('Foot roll lỗi: ' + (r.error || ''));
      }));
      var pivRow = el('div', 'arp-mr-row');
      pivRow.appendChild(el('span', 'arp-mr-label', 'Pivot chân ' + (side === 'Left' ? 'trái' : 'phải') + ': '));
      ['heel', 'toe'].forEach(function (p) {
        var pb = el('button', 'arp-btn' + (state.footPivot[side] === p ? ' arp-btn-primary' : ''), p === 'heel' ? 'Gót' : 'Mũi');
        pb.addEventListener('click', function () { setFootPivot(side, p); renderSection(container, ctx); });
        pivRow.appendChild(pb);
      });
      wrap.appendChild(pivRow);
    });

    /* --- Spine / Head --- */
    wrap.appendChild(el('div', 'arp-mr-h', '🧍 Spine / Head (FK từng đốt)'));
    ['Spine', 'Spine1', 'Spine2'].forEach(function (dst) {
      wrap.appendChild(mkSlider('Xoay ' + dst + ' (X°)', -45, 45, 5, 0, function (v) { setSpine(dst, { x: v * Math.PI / 180, y: 0, z: 0 }); }));
    });
    wrap.appendChild(mkSlider('Xoay Head (X°)', -45, 45, 5, 0, function (v) { setHead({ x: v * Math.PI / 180, y: 0, z: 0 }); }));
    wrap.appendChild(mkSlider('Xoay Neck (X°)', -45, 45, 5, 0, function (v) { setNeck({ x: v * Math.PI / 180, y: 0, z: 0 }); }));

    /* --- Animation + Bake --- */
    wrap.appendChild(el('div', 'arp-mr-h', '🎬 Animation với Mixamo Rig'));
    var clips = listClips();
    var animRow = el('div', 'arp-mr-row');
    clips.forEach(function (c) {
      var pb = el('button', 'arp-btn', '▶ ' + c.name + ' (' + c.duration.toFixed(2) + 's)');
      pb.addEventListener('click', function () { var r = playClip(c.name); setStatus(r.ok ? 'Đang phát ' + c.name + ' trên control rig.' : 'Phát lỗi: ' + (r.error || '')); });
      animRow.appendChild(pb);
    });
    if (!clips.length) animRow.appendChild(el('span', 'arp-note', 'Model không có clip nào.'));
    wrap.appendChild(animRow);
    var bakeRow = el('div', 'arp-mr-row');
    bakeRow.appendChild(el('span', 'arp-mr-label', 'Bake sample rate: '));
    var fpsSel = document.createElement('select');
    fpsSel.className = 'arp-select';
    [24, 30, 60].forEach(function (f) {
      var o = document.createElement('option');
      o.value = String(f); o.textContent = f + ' fps'; if (f === 30) o.selected = true;
      fpsSel.appendChild(o);
    });
    bakeRow.appendChild(fpsSel);
    var bakeBtn = el('button', 'arp-btn arp-btn-primary', '🔥 Bake clip xuống skeleton');
    bakeBtn.addEventListener('click', function () {
      var r = bakeClip(clips.length ? clips[0].name : null, { fps: Number(fpsSel.value) });
      setStatus(r.ok ? ('Đã bake "' + r.name + '": ' + r.frames + ' frames @' + r.fps + 'fps, ' + r.trackCount + ' tracks.') : ('Bake lỗi: ' + (r.error || '')));
      renderSection(container, ctx);
    });
    bakeRow.appendChild(bakeBtn);
    wrap.appendChild(bakeRow);
    var bakedNames = Object.keys(state.bakedClips);
    if (bakedNames.length) {
      var expRow = el('div', 'arp-mr-row');
      bakedNames.forEach(function (bn) {
        var jb = el('button', 'arp-btn', '⬇ JSON: ' + bn);
        jb.addEventListener('click', function () { var r = exportBakedJSON(bn); setStatus(r.ok ? 'Đã xuất ' + r.filename : 'Xuất JSON lỗi: ' + (r.error || '')); });
        var fb = el('button', 'arp-btn', '⬇ FBX: ' + bn);
        fb.addEventListener('click', function () { var r = exportBakedFBX(bn); setStatus(r.ok ? 'Đã xuất FBX kèm clip ' + bn + ' (' + (r.byteLength || 0) + ' B).' : 'Xuất FBX lỗi: ' + (r.error || '')); });
        expRow.appendChild(jb); expRow.appendChild(fb);
      });
      wrap.appendChild(expRow);
    }

    /* --- Ghi key (có guard cảnh báo) + Reset / Xóa --- */
    var keyRow = el('div', 'arp-mr-row');
    var keyBtn = el('button', 'arp-btn', '🔴 Ghi key (Keyframe)');
    keyBtn.addEventListener('click', function () {
      var r = recordKeyGuarded();
      if (r.ok) setStatus('Đã ghi key.');
      else if (r.blockedByWarning) { setStatus('⚠️ ' + r.warning.message); refreshWarn(); }
      else setStatus('Ghi key lỗi: ' + (r.error || ''));
    });
    keyRow.appendChild(keyBtn);
    var matchBtn = el('button', 'arp-btn', '🎯 Match to source');
    matchBtn.addEventListener('click', function () { matchToSource(); setStatus('Đã Match to source.'); refreshWarn(); });
    keyRow.appendChild(matchBtn);
    wrap.appendChild(keyRow);

    var footRow = el('div', 'arp-mr-row');
    var resetBtn = el('button', 'arp-btn', '↺ Reset Mixamo Rig');
    resetBtn.addEventListener('click', function () { var r = resetMixamoRig(); setStatus(r.ok ? 'Đã reset về mặc định.' : 'Reset lỗi: ' + (r.error || '')); renderSection(container, ctx); });
    var delBtn = el('button', 'arp-btn', '🗑 Xóa Mixamo Rig');
    delBtn.addEventListener('click', function () { var r = removeMixamoRig(); setStatus(r.ok ? r.message : 'Xóa lỗi: ' + (r.error || '')); renderSection(container, ctx); });
    footRow.appendChild(resetBtn); footRow.appendChild(delBtn);
    wrap.appendChild(footRow);

    container.appendChild(wrap);
  }

  /* ---------- Public API ---------- */
  var MixamoRig = {
    PLUGIN_ID: PLUGIN_ID,
    NOT_MIXAMO_MSG: NOT_MIXAMO_MSG,
    KEYING_WARN_MSG: KEYING_WARN_MSG,
    LIMBS: LIMBS,
    FINGER_GROUPS: Object.keys(FINGER_GROUPS),
    detect: detect,
    isMixamo: isMixamo,
    getNonMixamoAction: getNonMixamoAction,
    switchToSmartTab: switchToSmartTab,
    switchToQuickRigTab: switchToQuickRigTab,
    buildMixamoRig: buildMixamoRig,
    setBlend: setBlend,
    getBlend: getBlend,
    getBlends: getBlends,
    autoPole: autoPole,
    autoPoleAll: autoPoleAll,
    setPoleOffset: setPoleOffset,
    updatePoleLines: updatePoleLines,
    setFingerCurlGroup: setFingerCurlGroup,
    setFootRoll: setFootRoll,
    setFootPivot: setFootPivot,
    setSpine: setSpine,
    setHead: setHead,
    setNeck: setNeck,
    setMasterPosition: setMasterPosition,
    setMasterRotation: setMasterRotation,
    resetMaster: resetMaster,
    getMaster: getMaster,
    getSettings: getSettings,
    resetMixamoRig: resetMixamoRig,
    removeMixamoRig: removeMixamoRig,
    checkKeyingWarning: checkKeyingWarning,
    matchToSource: matchToSource,
    recordKeyGuarded: recordKeyGuarded,
    listClips: listClips,
    playClip: playClip,
    tick: tick,
    stopClip: stopClip,
    bakeClip: bakeClip,
    buildBakedJSON: buildBakedJSON,
    exportBakedJSON: exportBakedJSON,
    exportBakedFBX: exportBakedFBX,
    validateClip: validateClipLocal,
    isBuilt: function () { return state.built; },
    getState: function () { return state; },
    render: renderSection,
    renderSection: renderSection,
    onEnable: function () {
      var P = (typeof window !== 'undefined') ? window.PixiStudio : null;
      if (P && P.ArpPanel && typeof P.ArpPanel.open === 'function') P.ArpPanel.open('plugin:mixamo-rig');
    },
    onDisable: function () {
      var P = (typeof window !== 'undefined') ? window.PixiStudio : null;
      if (P && P.ArpPanel && P.ArpPanel.currentTab && P.ArpPanel.currentTab() === 'plugin:mixamo-rig' && typeof P.ArpPanel.showTab === 'function') P.ArpPanel.showTab('quickrig');
    }
  };
  MixamoRig._test = {
    computePoleDirection: computePoleDirection,
    fallbackBlendIKFK: fallbackBlendIKFK,
    restoreBindPose: restoreBindPose,
    KEYFRAME_FORMAT: KEYFRAME_FORMAT,
    state: state
  };

  if (typeof window !== 'undefined') {
    window.PixiStudio = window.PixiStudio || {};
    window.PixiStudio.ArpPluginMixamoRig = MixamoRig;
    try {
      if (window.PixiStudio.ArpPlugins && typeof window.PixiStudio.ArpPlugins.register === 'function') {
        window.PixiStudio.ArpPlugins.register('mixamo-rig', {
          name: 'Mixamo Rig',
          version: '1.0.0',
          description: 'Control rig kiểu Blender addon (tdw46/mixamo_blender4-main): Master, IK/FK blend từng chi, pole, hand/foot, spine/head, cảnh báo Visual Keying, bake xuống skeleton.',
          tab: true,
          enabled: true,
          render: renderSection,
          onEnable: MixamoRig.onEnable,
          onDisable: MixamoRig.onDisable
        });
      }
    } catch (e) { /* registry lỗi/trùng id: module vẫn dùng được qua namespace */ }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = MixamoRig;
})();
