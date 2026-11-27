/* ============================================================
 * rig/arp-retarget-scale.js — RETARGET SCALE-AWARE (NHÓM 2,
 * 2026-11-27). Mở rộng ArpRemap: retarget clip giữa 2 rig khác
 * TỶ LỆ và khác REST POSE, thay vì chỉ map theo tên xương.
 *
 * VẤN ĐỀ (Remap cũ): compat chỉ đo theo tên; track Hips.position
 * giữ nguyên giá trị nguồn. Rig đích cao 1,2× thì Hips vẫn ở độ
 * cao rig nguồn → bàn chân chìm ~0,15–0,20m dưới đất; rest pose
 * đích xoay khác nguồn thì tay/chân retarget lệch theo đúng góc đó.
 *
 * CÔNG THỨC (ghi rõ để kiểm chứng, xem header từng hàm):
 *   Đo:  H = HeadTop_End.worldY − min(Toe_End/ToeBase/Foot).worldY
 *        L_leg = |Hips→UpLeg| + |UpLeg→Leg| + |Leg→Foot| (trung bình
 *                2 chân, |.| = độ dài đoạn xương = |position| local)
 *        L_arm = |Shoulder→Arm| + |Arm→ForeArm| + |ForeArm→Hand|
 *   Tỷ lệ: s_leg = L_leg(đích)/L_leg(nguồn), s_H = H(đích)/H(nguồn).
 *        Tỷ lệ dùng chung s = s_leg (ưu tiên, vì chân quyết định
 *        chạm đất); không đo được chân thì s = s_H.
 *   (a) Root motion X/Z:  p' = r_đích + (p − r_nguồn)·s
 *       (r = vị trí Hips lúc nghỉ, local; p = key Hips.position).
 *   (b) Hips Y (giữ chân chạm đất):
 *       y' = r_đích.y + (y − r_nguồn.y)·s_leg
 *       → lúc nghỉ Hips đích đúng độ cao nghỉ của nó; biên độ
 *       nhún/chạy scale theo chân. Chân chạm đất vì ở tư thế nghỉ
 *       bàn chân đích đã ở mặt đất (ground = min Toe worldY) và
 *       độ dài chân đích = s_leg × chân nguồn.
 *   (c) Biên độ góc theo chiều dài chi — cùng một bước chân dài S,
 *       góc cần quay θ ≈ S/L (cung tròn S = L·θ, góc nhỏ). Chi đích
 *       dài hơn thì góc nhỏ hơn:  θ_đích = θ_nguồn · (L_nguồn/L_đích)
 *       = θ_nguồn / s_chi. Áp cho xương chân (k = 1/s_leg) và xương
 *       tay (k = 1/s_arm), KHÔNG áp cho Hips/Spine/Neck/Head (k=1).
 *       Thực hiện trên quay TƯƠNG ĐỐI so với rest pose:
 *         q_rel  = q_rest(nguồn)⁻¹ · q_clip
 *         q_rel' = slerp(I, q_rel, k)   (góc của q_rel' = k·góc q_rel)
 *         q_đích = q_base · q_rel'  với q_base = q_rest(đích) nếu bù
 *         rest pose, ngược lại q_base = q_rest(nguồn).
 *       Khi s=1 và không bù rest pose: q_đích = q_clip CHÍNH XÁC
 *       (không hồi quy — kiểm chứng ở test (e)).
 *   (2) Bù rest pose: offset từng xương
 *         q_off = q_rest(đích) · q_rest(nguồn)⁻¹
 *       rồi q_đích = q_off · q_clip (trường hợp k=1). Nghĩa là:
 *       nguồn ở tư thế nghỉ → đích ở tư thế nghỉ của ĐÍCH; nguồn
 *       xoay thêm Δ so với nghỉ → đích xoay thêm Δ so với nghỉ
 *       của đích. Đo bằng góc lệch quaternion world sau khi phát.
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Scale chỉ theo MỘT tỷ lệ tổng thể (chân, hoặc chiều cao khi
 *     không đo được chân) — KHÔNG scale từng đoạn xương riêng
 *     (vd đùi dài nhưng cẳng ngắn thì vẫn dùng chung s_leg).
 *   • Không xử lý khác trục quay / khác hướng xương giữa 2 rig
 *     ngoài offset rest pose (giả định 2 rig cùng quy ước trục
 *     Mixamo: local +Y của xương chân hướng xuống dưới... — offset
 *     rest pose đã bao hàm khác hướng nghỉ, nhưng rig xoay 90° hệ
 *     trục toàn cục thì không sửa).
 *   • Không retarget morph/blend shape, chỉ bone tracks.
 *   • Đo chiều cao/chân từ VỊ TRÍ XƯƠNG (world), không từ mesh:
 *     mesh skinned có thể lệch bind pose; chiều cao xương dùng
 *     HeadTop_End→Toe_End nên thấp hơn chiều cao mesh thật một chút
 *     (Thiếu Lâm: xương ~1,36m — dùng NHẤT QUÁN cho cả 2 rig nên
 *     tỷ lệ vẫn đúng).
 *
 * API: PixiStudio.ArpRetargetScale
 *   measureRig(rig) → đo rig (chiều cao, chân, tay, rest pose)
 *   computeScale(srcM, dstM) → { scale, scaleLeg, scaleHeight, ... }
 *   createContext(srcRig, dstRig, opts) → ctx cho Remap dùng
 *   retargetScaled(clip, srcRig, dstRig, opts) → retarget độc lập
 *     (KHÔNG ép compat ≥80% — đó là luật của ArpRemap; hàm này
 *     chỉ biến đổi track và báo cáo, để clip thật ít track như
 *     Run 16 track vẫn đo được lệch chân)
 *   measureFootGroundError(rigRoot, clip, opts) → phát clip bằng
 *     mixer, đo bàn chân chìm dưới đất bao nhiêu (m)
 * ============================================================ */
(function () {
  'use strict';

  var LEG_CHAINS = {
    Left: ['LeftUpLeg', 'LeftLeg', 'LeftFoot'],
    Right: ['RightUpLeg', 'RightLeg', 'RightFoot']
  };
  /* segment: xương con mà |position| của nó = độ dài đoạn từ cha.
     Chân: Hips→UpLeg (|UpLeg.pos|), UpLeg→Leg, Leg→Foot. */
  var LEG_SEGMENTS = { Left: ['LeftUpLeg', 'LeftLeg', 'LeftFoot'], Right: ['RightUpLeg', 'RightLeg', 'RightFoot'] };
  var ARM_SEGMENTS = { Left: ['LeftArm', 'LeftForeArm', 'LeftHand'], Right: ['RightArm', 'RightForeArm', 'RightHand'] };
  var LEG_BONES = ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'];
  var ARM_BONES = ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    'LeftHandThumb1', 'LeftHandThumb2', 'LeftHandIndex1', 'LeftHandIndex2',
    'LeftHandMiddle1', 'LeftHandMiddle2', 'LeftHandRing1', 'LeftHandRing2',
    'LeftHandPinky1', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    'RightHandThumb1', 'RightHandThumb2', 'RightHandIndex1', 'RightHandIndex2',
    'RightHandMiddle1', 'RightHandMiddle2', 'RightHandRing1', 'RightHandRing2',
    'RightHandPinky1'];
  var FOOT_BONES = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase', 'LeftToe_End', 'RightToe_End'];

  function normalizeBoneName(name) {
    return String(name || '')
      .replace(/^mixamorig:?/i, '')
      .replace(/^model:?/i, '')
      .trim()
      .toLowerCase();
  }
  function denorm(norm) {
    /* 'lefthand' → 'LeftHand' (chỉ để tra bảng LEG/ARM viết CamelCase) */
    var map = {};
    LEG_BONES.concat(ARM_BONES, ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End'])
      .forEach(function (n) { map[n.toLowerCase()] = n; });
    return map[norm] || norm;
  }

  /* ---------- Thu thập xương (Object3D / {bones} / {boneList} / mảng) ---------- */
  function collectBones(input) {
    var out = [];
    if (!input) return out;
    if (Array.isArray(input)) {
      input.forEach(function (b) { if (b && (b.isBone || b.name)) out.push(b); });
      return out;
    }
    if (input.isBone) return [input];
    if (input.bones && typeof input.bones === 'object' && !Array.isArray(input.bones)) {
      Object.keys(input.bones).forEach(function (k) {
        var b = input.bones[k];
        if (b && b.name) out.push(b);
      });
      return out;
    }
    if (input.bones && Array.isArray(input.bones)) return input.bones.filter(function (b) { return b && (b.isBone || b.name); });
    if (input.boneList && Array.isArray(input.boneList)) return input.boneList.filter(function (b) { return b && (b.isBone || b.name); });
    if (input.traverse) {
      input.traverse(function (o) { if (o.isBone) out.push(o); });
      return out;
    }
    if (typeof input === 'object') {
      Object.keys(input).forEach(function (k) {
        var b = input[k];
        if (b && b.name) out.push(b);
      });
      return out;
    }
    return out;
  }

  /* Vị trí world của xương: dùng matrixWorld nếu root là Object3D
     (đã updateMatrixWorld), ngược lại leo chuỗi parent bằng tay. */
  function boneWorldPos(bone, byNorm) {
    if (bone.getWorldPosition) {
      try {
        var v = new THREE.Vector3();
        bone.getWorldPosition(v);
        return v;
      } catch (e) { /* rơi xuống leo tay */ }
    }
    var m = new THREE.Matrix4().compose(
      bone.position || new THREE.Vector3(),
      bone.quaternion || new THREE.Quaternion(),
      bone.scale || new THREE.Vector3(1, 1, 1));
    var p = bone.parent;
    var guard = 0;
    while (p && guard++ < 64) {
      if (p.isBone || p.position) {
        var pm = new THREE.Matrix4().compose(
          p.position || new THREE.Vector3(),
          p.quaternion || new THREE.Quaternion(),
          p.scale || new THREE.Vector3(1, 1, 1));
        m.premultiply(pm);
      }
      p = p.parent;
    }
    return new THREE.Vector3().setFromMatrixPosition(m);
  }

  /* ---------- Đo rig ---------- */
  function measureRig(rig) {
    var res = {
      ok: false, boneCount: 0, height: NaN, heightMethod: '',
      legLength: NaN, armLength: NaN,
      hipsRestLocal: null, hipsRestWorldY: NaN,
      footGroundY: NaN, ankleHeight: NaN, headTopY: NaN,
      bones: {}, /* norm → { bone, restQuat, restPos, worldPos } */
      meshHeight: NaN
    };
    if (!rig) return res;
    if (rig.updateMatrixWorld) { try { rig.updateMatrixWorld(true); } catch (e) {} }
    var bones = collectBones(rig);
    if (!bones.length) return res;
    res.boneCount = bones.length;
    var byNorm = {};
    bones.forEach(function (b) {
      if (!b || !b.name) return;
      var norm = normalizeBoneName(b.name);
      var entry = {
        bone: b,
        restQuat: (b.quaternion ? b.quaternion.clone() : new THREE.Quaternion()),
        restPos: (b.position ? b.position.clone() : new THREE.Vector3()),
        worldPos: boneWorldPos(b, byNorm)
      };
      byNorm[norm] = entry;
      res.bones[norm] = entry;
    });
    /* Chiều cao xương: HeadTop_End (fallback Head) − Toe_End/ToeBase/Foot thấp nhất */
    var top = byNorm['headtop_end'] || byNorm['head'];
    var footYs = [];
    FOOT_BONES.forEach(function (n) {
      var e = byNorm[n.toLowerCase()];
      if (e) footYs.push(e.worldPos.y);
    });
    if (top) res.headTopY = top.worldPos.y;
    if (footYs.length) res.footGroundY = Math.min.apply(null, footYs);
    if (top && footYs.length) {
      res.height = res.headTopY - res.footGroundY;
      res.heightMethod = 'bone:HeadTop_End−Toe';
    }
    /* Chiều dài chân/tay: tổng |position| local từng đoạn, trung bình 2 bên */
    var chainLen = function (segments) {
      var lens = [];
      ['Left', 'Right'].forEach(function (side) {
        var names = segments[side];
        var sum = 0, n = 0;
        names.forEach(function (nm) {
          var e = byNorm[nm.toLowerCase()];
          if (e && e.restPos) { sum += e.restPos.length(); n++; }
        });
        if (n === names.length && sum > 0) lens.push(sum);
      });
      if (!lens.length) return NaN;
      return lens.reduce(function (a, b) { return a + b; }, 0) / lens.length;
    };
    res.legLength = chainLen(LEG_SEGMENTS);
    res.armLength = chainLen(ARM_SEGMENTS);
    var hips = byNorm['hips'];
    if (hips) {
      res.hipsRestLocal = hips.restPos.clone();
      res.hipsRestWorldY = hips.worldPos.y;
    }
    var foot = byNorm['leftfoot'] || byNorm['rightfoot'];
    if (foot && isFinite(res.footGroundY)) res.ankleHeight = foot.worldPos.y - res.footGroundY;
    /* Mesh bbox (tham khảo): chiều cao mesh nếu có SkinnedMesh */
    try {
      var mesh = null;
      if (rig.traverse) rig.traverse(function (o) { if (!mesh && o.isSkinnedMesh) mesh = o; });
      if (mesh && mesh.geometry && mesh.geometry.computeBoundingBox) {
        mesh.geometry.computeBoundingBox();
        var bb = mesh.geometry.boundingBox;
        if (bb) res.meshHeight = bb.max.y - bb.min.y;
      }
    } catch (e) {}
    res.ok = isFinite(res.height) || isFinite(res.legLength);
    return res;
  }

  /* ---------- Tỷ lệ ---------- */
  function computeScale(srcM, dstM) {
    var out = {
      scale: 1, scaleHeight: NaN, scaleLeg: NaN, scaleArm: NaN,
      method: 'none', srcHeight: NaN, dstHeight: NaN,
      srcLeg: NaN, dstLeg: NaN, srcArm: NaN, dstArm: NaN
    };
    if (!srcM || !dstM) return out;
    out.srcHeight = srcM.height; out.dstHeight = dstM.height;
    out.srcLeg = srcM.legLength; out.dstLeg = dstM.legLength;
    out.srcArm = srcM.armLength; out.dstArm = dstM.armLength;
    if (isFinite(srcM.height) && isFinite(dstM.height) && srcM.height > 0) {
      out.scaleHeight = dstM.height / srcM.height;
    }
    if (isFinite(srcM.legLength) && isFinite(dstM.legLength) && srcM.legLength > 0) {
      out.scaleLeg = dstM.legLength / srcM.legLength;
    }
    if (isFinite(srcM.armLength) && isFinite(dstM.armLength) && srcM.armLength > 0) {
      out.scaleArm = dstM.armLength / srcM.armLength;
    }
    if (isFinite(out.scaleLeg)) { out.scale = out.scaleLeg; out.method = 'leg'; }
    else if (isFinite(out.scaleHeight)) { out.scale = out.scaleHeight; out.method = 'height'; }
    return out;
  }

  /* ---------- Context: đo 1 lần, dùng cho mọi track ---------- */
  function createContext(srcRig, dstRig, opts) {
    opts = opts || {};
    var srcM = measureRig(srcRig);
    var dstM = measureRig(dstRig);
    var sc = computeScale(srcM, dstM);
    var ctx = {
      srcMeasure: srcM, dstMeasure: dstM,
      scale: sc.scale, scaleHeight: sc.scaleHeight, scaleLeg: sc.scaleLeg,
      scaleArm: sc.scaleArm, scaleMethod: sc.method,
      scaleRootMotion: opts.scaleRootMotion !== false,
      scaleHipsY: opts.scaleHipsY !== false,
      restPoseComp: opts.restPoseComp !== false,
      scaleLimbAngles: opts.scaleLimbAngles !== false,
      restOffsets: {}, /* norm → Quaternion q_off = q_dstRest · q_srcRest⁻¹ */
      report: null
    };
    /* offset rest pose từng xương có ở cả 2 rig */
    Object.keys(srcM.bones).forEach(function (norm) {
      var s = srcM.bones[norm], d = dstM.bones[norm];
      if (!s || !d) return;
      var off = d.restQuat.clone().multiply(s.restQuat.clone().invert());
      ctx.restOffsets[norm] = off;
    });
    ctx.report = {
      srcHeight: sc.srcHeight, dstHeight: sc.dstHeight,
      srcLeg: sc.srcLeg, dstLeg: sc.dstLeg,
      srcArm: sc.srcArm, dstArm: sc.dstArm,
      scale: sc.scale, scaleHeight: sc.scaleHeight, scaleLeg: sc.scaleLeg,
      scaleArm: sc.scaleArm, scaleMethod: sc.method,
      scaleRootMotion: ctx.scaleRootMotion, scaleHipsY: ctx.scaleHipsY,
      restPoseComp: ctx.restPoseComp, scaleLimbAngles: ctx.scaleLimbAngles,
      srcHipsRestY: srcM.hipsRestLocal ? srcM.hipsRestLocal.y : NaN,
      dstHipsRestY: dstM.hipsRestLocal ? dstM.hipsRestLocal.y : NaN,
      restOffsetCount: Object.keys(ctx.restOffsets).length
    };
    return ctx;
  }

  /* Hệ số biên độ góc cho xương: chân k=1/s_leg, tay k=1/s_arm, còn lại 1.
     (Cùng bước chân S: θ ≈ S/L → θ_đích = θ_nguồn·L_nguồn/L_đích.) */
  function limbAngleFactor(norm, ctx) {
    if (!ctx || !ctx.scaleLimbAngles) return 1;
    var n = String(norm || '').toLowerCase();
    var leg = LEG_BONES.some(function (b) { return b.toLowerCase() === n; });
    if (leg && isFinite(ctx.scaleLeg) && ctx.scaleLeg > 0) return 1 / ctx.scaleLeg;
    var arm = ARM_BONES.some(function (b) { return b.toLowerCase() === n; });
    if (arm && isFinite(ctx.scaleArm) && ctx.scaleArm > 0) return 1 / ctx.scaleArm;
    return 1;
  }

  var _IDENTITY = null;
  function identityQuat() {
    if (!_IDENTITY) _IDENTITY = new THREE.Quaternion(0, 0, 0, 1);
    return _IDENTITY;
  }

  /* Biến đổi 1 key quaternion (local, tuyệt đối) → đích.
     q_rel = q_srcRest⁻¹·q ; q_rel' = slerp(I, q_rel, k) ;
     q_out = q_base·q_rel' (q_base = q_dstRest nếu bù rest, else q_srcRest). */
  function transformQuaternionValue(qx, qy, qz, qw, boneNorm, ctx) {
    var q = new THREE.Quaternion(qx, qy, qz, qw);
    if (!ctx) return q;
    var src = ctx.srcMeasure.bones[boneNorm];
    var dst = ctx.dstMeasure.bones[boneNorm];
    var qSrcRest = src ? src.restQuat : identityQuat();
    var qBase = qSrcRest;
    if (ctx.restPoseComp && dst) qBase = dst.restQuat;
    var qRel = qSrcRest.clone().invert().multiply(q);
    var k = limbAngleFactor(boneNorm, ctx);
    var qRelScaled;
    if (k === 1) qRelScaled = qRel;
    else {
      qRelScaled = identityQuat().clone().slerp(qRel, k);
    }
    return qBase.clone().multiply(qRelScaled);
  }

  function transformQuaternionTrackValues(values, boneNorm, ctx) {
    var out = new Float32Array(values.length);
    for (var i = 0; i + 3 < values.length + 1 && i < values.length; i += 4) {
      var q = transformQuaternionValue(values[i], values[i + 1], values[i + 2], values[i + 3], boneNorm, ctx);
      out[i] = q.x; out[i + 1] = q.y; out[i + 2] = q.z; out[i + 3] = q.w;
    }
    return out;
  }

  /* Biến đổi track Hips.position (local, tuyệt đối):
     X/Z: r_đích + (p − r_nguồn)·s   (nếu scaleRootMotion, else giữ offset)
     Y:   r_đích.y + (y − r_nguồn.y)·s_leg (nếu scaleHipsY, else giữ offset) */
  function transformHipsTrackValues(values, ctx) {
    var out = new Float32Array(values);
    if (!ctx) return out;
    var s = ctx.scale;
    var rS = ctx.srcMeasure.hipsRestLocal;
    var rD = ctx.dstMeasure.hipsRestLocal;
    if (!rS || !rD) return out;
    for (var i = 0; i + 2 < values.length + 1 && i < values.length; i += 3) {
      out[i] = ctx.scaleRootMotion ? (rD.x + (values[i] - rS.x) * s) : (rD.x + (values[i] - rS.x));
      out[i + 1] = ctx.scaleHipsY ? (rD.y + (values[i + 1] - rS.y) * (isFinite(ctx.scaleLeg) ? ctx.scaleLeg : s)) : (rD.y + (values[i + 1] - rS.y));
      out[i + 2] = ctx.scaleRootMotion ? (rD.z + (values[i + 2] - rS.z) * s) : (rD.z + (values[i + 2] - rS.z));
    }
    return out;
  }

  function parseTrackName(trackName) {
    var name = String(trackName || '');
    var dot = name.lastIndexOf('.');
    if (dot <= 0) return null;
    var prop = name.slice(dot + 1);
    if (prop !== 'position' && prop !== 'quaternion' && prop !== 'scale') return null;
    return { bone: name.slice(0, dot), prop: prop };
  }

  /* ---------- Retarget độc lập (không ép compat) ---------- */
  function retargetScaled(clip, srcRig, dstRig, opts) {
    opts = opts || {};
    var result = {
      ok: false, clip: null, reason: '',
      scaleReport: null, mapped: 0, skipped: [], total: 0
    };
    var src = clip && clip.tracks ? clip : (clip && clip.clip ? clip.clip : null);
    if (!src) { result.reason = 'Không có clip nguồn.'; return result; }
    var ctx = createContext(srcRig, dstRig, opts);
    result.scaleReport = ctx.report;
    result.scale = ctx.scale;
    /* Map tên xương đích: ưu tiên ArpRemap.targetBoneMap nếu có. */
    var boneMap = {};
    try {
      var RM = (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.ArpRemap) || null;
      if (RM && typeof RM.targetBoneMap === 'function') boneMap = RM.targetBoneMap(dstRig);
    } catch (e) {}
    if (!Object.keys(boneMap).length) {
      collectBones(dstRig).forEach(function (b) {
        if (b && b.name) {
          var n = normalizeBoneName(b.name);
          if (!boneMap[n]) boneMap[n] = b.name;
          if (/^mixamorig:/i.test(b.name)) boneMap[n] = b.name;
        }
      });
    }
    var newTracks = [];
    src.tracks.forEach(function (track) {
      var parsed = parseTrackName(track.name);
      if (!parsed) return;
      result.total++;
      var destBone = boneMap[normalizeBoneName(parsed.bone)];
      if (!destBone) { result.skipped.push(parsed.bone); return; }
      var nt = track.clone();
      nt.name = destBone + '.' + parsed.prop;
      var norm = normalizeBoneName(parsed.bone);
      if (parsed.prop === 'quaternion') {
        nt.values = transformQuaternionTrackValues(track.values, norm, ctx);
      } else if (parsed.prop === 'position' && norm === 'hips') {
        nt.values = transformHipsTrackValues(track.values, ctx);
      }
      newTracks.push(nt);
      result.mapped++;
    });
    if (!newTracks.length) { result.reason = 'Clip không có track xương nào map được.'; return result; }
    var newClip = new THREE.AnimationClip(opts.name || (src.name + '_scaled'), src.duration, newTracks);
    newClip.userData = { sourceClip: src.name, scale: ctx.scale, scaleMethod: ctx.scaleMethod };
    result.ok = true;
    result.clip = newClip;
    result.context = ctx;
    return result;
  }

  /* ---------- Đo lệch chân sau khi phát clip thật ----------
     Phát clip bằng AnimationMixer trên rigRoot, quét theo bước dt,
     lấy Y thấp nhất của xương bàn chân so với mặt đất nghỉ
     (groundY = min Toe worldY lúc nghỉ). Trả về:
       { minFootY, penetration (m chìm dưới đất, ≥0 nếu chìm),
         maxFootY, groundY, samples }
     penetration ≤ 0,02m là đạt (task a/b). Rig gốc không được sửa:
     mixer chỉ đổi pose trong lúc đo rồi stop + reset về rest. */
  function measureFootGroundError(rigRoot, clip, opts) {
    opts = opts || {};
    var out = { minFootY: NaN, maxFootY: NaN, penetration: NaN, groundY: NaN, samples: 0 };
    if (!rigRoot || !clip) return out;
    var m = measureRig(rigRoot);
    out.groundY = m.footGroundY;
    if (!isFinite(out.groundY)) return out;
    var footBones = [];
    rigRoot.traverse ? rigRoot.traverse(function (o) {
      if (o.isBone && FOOT_BONES.indexOf(denorm(normalizeBoneName(o.name))) >= 0) footBones.push(o);
    }) : null;
    if (!footBones.length) {
      collectBones(rigRoot).forEach(function (b) {
        if (FOOT_BONES.indexOf(denorm(normalizeBoneName(b.name))) >= 0) footBones.push(b);
      });
    }
    if (!footBones.length) return out;
    var mixer = new THREE.AnimationMixer(rigRoot);
    var action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce);
    action.clampWhenFinished = true;
    action.play();
    var dt = opts.dt || 1 / 60;
    var minY = Infinity, maxY = -Infinity, n = 0;
    var v = new THREE.Vector3();
    var steps = Math.max(1, Math.ceil(clip.duration / dt));
    for (var i = 0; i <= steps; i++) {
      if (i > 0) mixer.update(dt);
      rigRoot.updateMatrixWorld(true);
      footBones.forEach(function (b) {
        b.getWorldPosition(v);
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      });
      n++;
    }
    try { action.stop(); mixer.stopAllAction(); mixer.uncacheClip(clip); } catch (e) {}
    /* trả rig về rest: mixer đã stop, nhưng pose cuối còn dính — đặt
       lại quaternion/position từng xương về rest đã đo. */
    try {
      Object.keys(m.bones).forEach(function (norm) {
        var e = m.bones[norm];
        if (e && e.bone) {
          e.bone.quaternion.copy(e.restQuat);
          e.bone.position.copy(e.restPos);
        }
      });
      rigRoot.updateMatrixWorld(true);
    } catch (e) {}
    out.minFootY = minY;
    out.maxFootY = maxY;
    out.penetration = Math.max(0, out.groundY - minY);
    out.samples = n;
    return out;
  }

  /* Góc lệch (độ) giữa 2 quaternion — dùng cho test bù rest pose. */
  function quatAngleDeg(a, b) {
    if (!a || !b) return NaN;
    var d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
    if (d > 1) d = 1;
    return 2 * Math.acos(d) * 180 / Math.PI;
  }

  var ArpRetargetScale = {
    LEG_BONES: LEG_BONES,
    ARM_BONES: ARM_BONES,
    normalizeBoneName: normalizeBoneName,
    collectBones: collectBones,
    measureRig: measureRig,
    computeScale: computeScale,
    createContext: createContext,
    limbAngleFactor: limbAngleFactor,
    transformQuaternionValue: transformQuaternionValue,
    transformQuaternionTrackValues: transformQuaternionTrackValues,
    transformHipsTrackValues: transformHipsTrackValues,
    parseTrackName: parseTrackName,
    retargetScaled: retargetScaled,
    measureFootGroundError: measureFootGroundError,
    quatAngleDeg: quatAngleDeg
  };

  ArpRetargetScale._test = {
    normalizeBoneName: normalizeBoneName,
    collectBones: collectBones,
    measureRig: measureRig,
    computeScale: computeScale,
    createContext: createContext,
    limbAngleFactor: limbAngleFactor,
    transformQuaternionValue: transformQuaternionValue,
    transformQuaternionTrackValues: transformQuaternionTrackValues,
    transformHipsTrackValues: transformHipsTrackValues,
    retargetScaled: retargetScaled,
    measureFootGroundError: measureFootGroundError,
    quatAngleDeg: quatAngleDeg
  };

  if (typeof window !== 'undefined') {
    window.PixiStudio = window.PixiStudio || {};
    window.PixiStudio.ArpRetargetScale = ArpRetargetScale;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = ArpRetargetScale;
})();
