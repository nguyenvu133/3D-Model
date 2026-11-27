/* ============================================================
 * rig/arp-restpose.js — RETARGET BÙ REST POSE + MIRROR ĐÚNG
 * (Nhóm B, vòng Mở rộng Hệ thống Animation, 2026-11-27)
 *
 * 2 namespace trong 1 file (1 script tag duy nhất):
 *   • PixiStudio.ArpRestPose  — bù rest pose khi retarget
 *   • PixiStudio.ArpAnimMirror — mirror clip trái/phải đúng
 *
 * ---------- 1. BÙ REST POSE (ArpRestPose) ----------
 * Vấn đề: ArpRemap.retargetClip chỉ map track theo TÊN xương.
 * Nếu rest pose nguồn và đích khác nhau (vd nguồn tay xuôi, đích
 * tay ngang 45°) thì clip retarget giữ nguyên local rotation của
 * nguồn → tay đích bị xoay lệch đúng bằng độ chênh rest pose.
 *
 * Luật bù (per-bone, local space):
 *   delta(t) = qSrcRest⁻¹ × qClip(t)        (pose so với rest nguồn)
 *   qDst(t)  = qDstRest × delta(t)
 *            = (qDstRest × qSrcRest⁻¹) × qClip(t)
 *            = qOffset × qClip(t),  với qOffset = qDstRest × qSrcRest⁻¹
 *   Kiểm chứng: clip đang ở rest nguồn (qClip = qSrcRest) → qDst =
 *   qDstRest (đúng rest đích); rest 2 rig giống nhau → qOffset = I.
 *   Position: pDst(t) = pDstRest + s × (pClip(t) − pSrcRest),
 *   s = positionScale (mặc định 1).
 *
 * PHỐI HỢP VỚI COORDINATOR RIG (retarget SCALE-AWARE) — ĐÃ ĐỌC CODE
 * THẬT (js/rig/arp-retarget-scale.js, 2026-11-27):
 *   • Nhóm Rig đã tính bù rest pose BÊN TRONG scale context của họ:
 *     createContext() đo restOffsets[norm] = qDstRest × qSrcRest⁻¹
 *     (ĐÚNG công thức §1) và transformQuaternionValue() áp
 *     qDstRest × slerp(I, qSrcRest⁻¹·q, k) — với k=1 (không scale
 *     góc chi) thì giống hệt qOffset × q của module này.
 *   • Vì vậy KHÔNG được áp offset 2 lần: retargetClipWithRestPose
 *     có guard — nếu đường scale-aware đã chạy (opts.scaleAware +
 *     srcRig, hoặc kết quả đã có scaleReport.restPoseComp=true) thì
 *     KHÔNG áp thêm offset của module này; nó chỉ đính kèm BẢNG
 *     offset (cùng số đo, tính lại bằng computeRestOffsets) để UI
 *     hiển thị. Đường standalone (không scaleAware) mới áp offset.
 *   • Scale (tỉ lệ 1.8m vs 2.2m) hoàn toàn thuộc nhóm Rig:
 *     scaleRootMotion / scaleHipsY / scaleLimbAngles trong ctx của
 *     họ. Module này KHÔNG scale góc, KHÔNG scale root motion;
 *     opts.positionScale chỉ dùng cho đường standalone (nhân vào
 *     delta position) và KHÔNG được truyền đồng thời với đường
 *     scale-aware.
 *   • Không sửa cùng hàm với họ: hàm mới retargetClipWithRestPose
 *     (không đụng retargetClip), chỉ ĐỌC kết quả của nó rồi (khi
 *     cần) áp offset lên clip đã map tên.
 *
 * Xương thiếu: retargetClip đã dùng ArpAutoMatch/proxy (ghi trong
 * result.autoMatched) — hàm này giữ nguyên danh sách đó, chỉ áp
 * offset cho track nào có xương đích tương ứng; track qua proxy
 * cũng được bù theo rest pose của xương đích THẬT (proxy target).
 *
 * Rest pose nguồn lấy từ đâu (theo thứ tự):
 *   1. opts.srcRig (object rig/skeleton) / opts.srcRest (map đã chụp)
 *   2. ArpRestPose.setSourceRest(rigOrMap) — UI/studio đặt khi mở
 *      model nguồn (vd lúc load FBX kèm clip)
 *   3. Không có → restCompensated=false + lý do rõ (clip vẫn
 *      retarget theo tên như cũ, không chặn). KHÔNG đoán rest pose
 *      từ frame đầu của clip (frame đầu thường không phải rest).
 *
 * ---------- 2. MIRROR ĐÚNG (ArpAnimMirror) ----------
 * Luật mirror qua mặt phẳng dọc YZ (x → −x), chứng minh bằng ma
 * trận: với M = diag(−1,1,1), rotation R mirrored là R' = M·R·M.
 * Với R có quaternion (x,y,z,w) thì R' có quaternion (x,−y,−z,w)
 * (trục quay (ax,ay,az) → (ax,−ay,−az), cùng góc). Tương đương:
 * Euler XYZ (ex,ey,ez) → (ex,−ey,−ez) — khớp luật mirrorEuler
 * đã đúng sẵn trong arp-sync-clips.js.
 *   ⚠ LUẬT CŨ SAI: Animator + Sync dùng (−x, y, −z, w) — đó là
 *   mirror qua mặt phẳng NGANG XZ (lật y), không phải dọc YZ:
 *   quay quanh Y (xoay người) không bị mirror, quay quanh X bị
 *   đảo ngược. Đã sửa ở cả 3 chỗ (module này, arp-animator.js,
 *   arp-sync-clips.js) + test cũ (4d) khẳng định luật sai.
 * Vì R'local = M·Rlocal·M độc lập với parent (chứng minh: parent
 * cũng bị mirror nên M triệt tiêu dọc chain), luật per-track này
 * là CHÍNH XÁC cho rig đối xứng (Mixamo), không cần skeleton:
 *   • quaternion track: (x,−y,−z,w), đổi xương Left↔Right
 *   • position track: (−x, y, z), đổi xương Left↔Right
 *   • xương giữa (Hips/Spine/Head...): giữ tên, chỉ lật dấu
 *   • xương chỉ có 1 bên trong clip → TẠO track bên kia (luật cũ
 *     nuốt mất track này: LeftArm mirror xong không có RightArm)
 * Keyframe keys (Euler): pose/fk (x,−y,−z) + đổi tên, hips x→−x,
 * fingerCurl/footRoll đổi bên, jawOpen/fingerCurlAll giữ nguyên.
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Rest pose khác quá nhiều (vd Thiếu Lâm vs Thần Điêu: tay
 *     lệch tới ~180° — 2 rig khác quy ước trục bind) thì bù vẫn
 *     đúng về delta pose, nhưng tư thế tuyệt đối phụ thuộc rest
 *     đích có phải bind pose hợp lệ không; không tự sửa được
 *     skeleton sai quy ước.
 *   • Mirror chính xác khi rig đối xứng qua YZ; rig bất đối xứng
 *     (vd tay trái to hơn tay phải) thì mirror chỉ đúng về pose,
 *     không sửa được hình dạng mesh.
 *   • Clip chỉ có định nghĩa procedural (AnimAutoGen, không có
 *     THREE.AnimationClip) thì không mirror được — cần clip thật
 *     hoặc keys (giới hạn có sẵn, giống trim/reverse).
 * ============================================================ */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined' && window.PixiStudio) || {};
  var T = (typeof window !== 'undefined' && window.THREE) ||
    (typeof THREE !== 'undefined' ? THREE : null);

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round3(v) { return Math.round(v * 1000) / 1000; }
  function round4(v) { return Math.round(v * 10000) / 10000; }

  /* 'mixamorig:LeftArm' / 'mixamorigLeftArm' / 'model:Hips' → 'leftarm' */
  function norm(name) {
    return String(name || '')
      .replace(/^(mixamorig:?|model:?)/i, '')
      .trim()
      .toLowerCase();
  }
  /* Bỏ prefix + bỏ '.quaternion'/'.position', giữ nguyên case. */
  function stripName(full) {
    var s = String(full || '').trim();
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    s = s.replace(/\.(quaternion|position|scale)$/i, '');
    return s;
  }
  function parseTrackName(trackName) {
    var name = String(trackName || '');
    var dot = name.lastIndexOf('.');
    if (dot <= 0) return null;
    var prop = name.slice(dot + 1);
    if (prop !== 'position' && prop !== 'quaternion' && prop !== 'scale') return null;
    return { bone: name.slice(0, dot), prop: prop };
  }
  function quatFromArr(a) {
    a = a || [0, 0, 0, 1];
    if (T) return new T.Quaternion(a[0], a[1], a[2], a[3]);
    return { x: a[0], y: a[1], z: a[2], w: a[3] };
  }
  function quatToArr(q) { return [q.x, q.y, q.z, q.w]; }
  function quatMulArr(a, b) {
    /* a × b (áp b trước, rồi a) — dùng THREE khi có, fallback tay. */
    if (T) {
      var qa = quatFromArr(a), qb = quatFromArr(b);
      qa.multiply(qb);
      return quatToArr(qa);
    }
    var ax = a[0], ay = a[1], az = a[2], aw = a[3];
    var bx = b[0], by = b[1], bz = b[2], bw = b[3];
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz
    ];
  }
  function quatInvArr(a) {
    if (T) { var q = quatFromArr(a); q.invert(); return quatToArr(q); }
    return [-a[0], -a[1], -a[2], a[3]];
  }
  function quatAngleDeg(a, b) {
    /* Góc giữa 2 quaternion (dùng |dot| để q ≡ −q), ra độ. */
    var d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    return 2 * Math.acos(clamp(d, 0, 1)) * 180 / Math.PI;
  }
  function normQuatArr(a) {
    var l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l, a[3] / l];
  }
  function cloneDeep(o) {
    if (!o || typeof o !== 'object') return o;
    if (Array.isArray(o)) return o.map(cloneDeep);
    var out = {};
    Object.keys(o).forEach(function (k) { out[k] = cloneDeep(o[k]); });
    return out;
  }

  /* ============================================================
     ARPRESTPOSE — BÙ REST POSE
     ============================================================ */
  var ArpRestPose = {
    lastResult: null,
    _sourceRest: null,   /* rest pose nguồn đặt trước (setSourceRest) */
    _sourceLabel: ''
  };

  /* Chụp rest pose từ rig. Chấp nhận:
     • THREE.Object3D (quét THREE.Bone) — rest = position/quaternion
       local lúc load (bind pose của FBX/GLB)
     • rig {bones:{Name:bone}} / {boneList:[bone]} / mảng bone
     • map rest đã chụp (passthrough: {bones:{...}, count})
     Trả về {bones:{norm:{name,fullName,parent,position,quaternion}},
     order:[norm...], count, source}. */
  function captureRestPose(rig) {
    var out = { bones: {}, order: [], count: 0, source: 'none' };
    if (!rig) return out;
    if (rig.bones && typeof rig.bones === 'object' && !Array.isArray(rig.bones) &&
      rig.count !== undefined && rig.order) return rig;   /* đã là map */
    var add = function (fullName, parentName, pos, quat) {
      var n = norm(fullName);
      if (!n || out.bones[n]) return;
      out.bones[n] = {
        name: stripName(fullName),
        fullName: fullName,
        parent: parentName ? stripName(parentName) : null,
        position: pos ? [pos.x || pos[0] || 0, pos.y || pos[1] || 0, pos.z || pos[2] || 0] : [0, 0, 0],
        quaternion: quat ? [quat.x !== undefined ? quat.x : quat[0], quat.y !== undefined ? quat.y : quat[1], quat.z !== undefined ? quat.z : quat[2], quat.w !== undefined ? quat.w : quat[3]] : [0, 0, 0, 1]
      };
      out.order.push(n);
    };
    if (rig.traverse) {
      rig.traverse(function (o) {
        if (!o.isBone) return;
        var p = o.parent && o.parent.isBone ? o.parent.name : null;
        add(o.name, p, o.position, o.quaternion);
      });
      out.source = 'object3d';
    } else if (Array.isArray(rig)) {
      rig.forEach(function (b) {
        if (!b) return;
        add(b.name || '', b.parent ? b.parent.name : null, b.position, b.quaternion);
      });
      out.source = 'array';
    } else if (rig.bones) {
      Object.keys(rig.bones).forEach(function (k) {
        var b = rig.bones[k];
        if (!b) return;
        if (typeof b === 'string') { add(b, null, null, null); return; }
        add(b.name || ('mixamorig:' + k), b.parent ? b.parent.name : null, b.position, b.quaternion);
      });
      out.source = 'rig-bones';
    } else if (rig.boneList) {
      rig.boneList.forEach(function (b) {
        if (b) add(b.name || '', b.parent ? b.parent.name : null, b.position, b.quaternion);
      });
      out.source = 'boneList';
    }
    out.count = out.order.length;
    return out;
  }
  ArpRestPose.captureRestPose = captureRestPose;

  function setSourceRest(rigOrMap, label) {
    if (!rigOrMap) { ArpRestPose._sourceRest = null; ArpRestPose._sourceLabel = ''; return { ok: true, cleared: true }; }
    var map = (rigOrMap.bones && rigOrMap.order) ? rigOrMap : captureRestPose(rigOrMap);
    ArpRestPose._sourceRest = map;
    ArpRestPose._sourceLabel = label || '';
    return { ok: true, count: map.count, label: ArpRestPose._sourceLabel };
  }
  ArpRestPose.setSourceRest = setSourceRest;
  ArpRestPose.clearSourceRest = function () { return setSourceRest(null); };

  /* Tính offset rest pose nguồn → đích cho từng xương đích.
     offset.quat = qDstRest × qSrcRest⁻¹ (premultiply vào key clip).
     offset.angleDeg = góc chênh rest (độ). offset.pos = pDst − pSrc. */
  function computeRestOffsets(srcRest, dstRest, opts) {
    opts = opts || {};
    var src = srcRest && srcRest.bones ? srcRest : captureRestPose(srcRest);
    var dst = dstRest && dstRest.bones ? dstRest : captureRestPose(dstRest);
    var offsets = {};
    var missingSrc = [];
    var missingDst = [];
    var maxAngle = 0, maxBone = null, sumAngle = 0, n = 0;
    dst.order.forEach(function (dn) {
      var d = dst.bones[dn];
      var s = src.bones[dn];
      if (!s) {
        missingSrc.push(d.name);
        offsets[dn] = { bone: d.name, fullName: d.fullName, quat: [0, 0, 0, 1], angleDeg: 0, srcPos: null, dstPos: d.position.slice(), pos: [0, 0, 0], missingSrc: true };
        return;
      }
      var qOff = normQuatArr(quatMulArr(d.quaternion, quatInvArr(s.quaternion)));
      var ang = quatAngleDeg(d.quaternion, s.quaternion);
      offsets[dn] = {
        bone: d.name, fullName: d.fullName, quat: qOff, angleDeg: round3(ang),
        srcPos: s.position.slice(), dstPos: d.position.slice(),
        pos: [round4(d.position[0] - s.position[0]), round4(d.position[1] - s.position[1]), round4(d.position[2] - s.position[2])],
        missingSrc: false
      };
      if (ang > maxAngle) { maxAngle = ang; maxBone = d.name; }
      sumAngle += ang; n++;
    });
    src.order.forEach(function (sn) {
      if (!dst.bones[sn]) missingDst.push(src.bones[sn].name);
    });
    return {
      offsets: offsets, count: dst.count, compared: n,
      maxAngleDeg: round3(maxAngle), maxBone: maxBone,
      meanAngleDeg: n ? round3(sumAngle / n) : 0,
      missingSrc: missingSrc, missingDst: missingDst
    };
  }
  ArpRestPose.computeRestOffsets = computeRestOffsets;

  /* Áp offset rest pose lên clip (THREE.AnimationClip hoặc plain
     {name,duration,tracks:[{name,times,values}]}). Trả về clip MỚI.
     opts.positionScale (mặc định 1) — hệ số tỉ lệ của coordinator
     Rig, nhân vào delta position (pClip − pSrcRest). */
  function applyRestOffsetsToClip(clip, offsetsInput, opts) {
    opts = opts || {};
    if (!clip || !clip.tracks) return { ok: false, error: 'Clip không có tracks.' };
    var off = offsetsInput && offsetsInput.offsets ? offsetsInput : { offsets: offsetsInput || {} };
    var offsets = off.offsets;
    var s = (typeof opts.positionScale === 'number' && isFinite(opts.positionScale) && opts.positionScale > 0) ? opts.positionScale : 1;
    var isThree = !!(clip.tracks[0] && typeof clip.tracks[0].createInterpolant === 'function');
    var applied = [], skipped = [];
    var newTracks = clip.tracks.map(function (tr) {
      var parsed = parseTrackName(tr.name);
      if (!parsed) return tr.clone ? tr.clone() : { name: tr.name, times: tr.times.slice(), values: tr.values.slice() };
      var entry = offsets[norm(parsed.bone)];
      if (!entry || entry.missingSrc) {
        skipped.push(parsed.bone);
        return tr.clone ? tr.clone() : { name: tr.name, times: tr.times.slice(), values: tr.values.slice() };
      }
      var size = parsed.prop === 'quaternion' ? 4 : 3;
      var nk = tr.times.length;
      var values = new Array(nk * size);
      if (parsed.prop === 'quaternion') {
        for (var i = 0; i < nk; i++) {
          var q = normQuatArr(quatMulArr(entry.quat, [tr.values[i * 4], tr.values[i * 4 + 1], tr.values[i * 4 + 2], tr.values[i * 4 + 3]]));
          values[i * 4] = q[0]; values[i * 4 + 1] = q[1]; values[i * 4 + 2] = q[2]; values[i * 4 + 3] = q[3];
        }
        applied.push({ bone: entry.bone, angleDeg: entry.angleDeg, posMm: 0 });
      } else if (parsed.prop === 'position') {
        for (var j = 0; j < nk; j++) {
          var px = tr.values[j * 3], py = tr.values[j * 3 + 1], pz = tr.values[j * 3 + 2];
          if (entry.srcPos) {
            values[j * 3] = entry.dstPos[0] + s * (px - entry.srcPos[0]);
            values[j * 3 + 1] = entry.dstPos[1] + s * (py - entry.srcPos[1]);
            values[j * 3 + 2] = entry.dstPos[2] + s * (pz - entry.srcPos[2]);
          } else {
            values[j * 3] = px + entry.pos[0]; values[j * 3 + 1] = py + entry.pos[1]; values[j * 3 + 2] = pz + entry.pos[2];
          }
        }
        var posLen = Math.sqrt(entry.pos[0] * entry.pos[0] + entry.pos[1] * entry.pos[1] + entry.pos[2] * entry.pos[2]);
        applied.push({ bone: entry.bone, angleDeg: 0, posMm: round3(posLen * 1000) });
      } else {
        return tr.clone ? tr.clone() : { name: tr.name, times: tr.times.slice(), values: tr.values.slice() };
      }
      if (isThree && tr.clone) {
        var nt = tr.clone();
        nt.values = new Float32Array(values);
        return nt;
      }
      return { name: tr.name, times: Array.prototype.slice.call(tr.times), values: values };
    });
    var outClip;
    if (isThree && T) outClip = new T.AnimationClip((clip.name || 'clip') + '_restpose', clip.duration, newTracks);
    else outClip = { name: (clip.name || 'clip') + '_restpose', duration: clip.duration, tracks: newTracks };
    return { ok: true, clip: outClip, applied: applied, appliedCount: applied.length, skipped: skipped, positionScale: s };
  }
  ArpRestPose.applyRestOffsetsToClip = applyRestOffsetsToClip;

  /* Retarget + bù rest pose. 2 đường, KHÔNG bao giờ áp offset 2 lần:
     (A) Scale-aware (opts.scaleAware + srcRig): nhóm Rig đã bù rest
         pose bên trong transform của họ (restPoseComp) — hàm này chỉ
         delegate cho RM.retargetClip với đúng opts đó, rồi đính kèm
         BẢNG offset (tính lại bằng computeRestOffsets — cùng số đo
         với ctx.restOffsets của họ) để UI hiển thị. restCompSource =
         'scale-aware'.
     (B) Standalone (mặc định): RM.retargetClip map tên (scaleRoot
         ép =1 để Hips.position không bị nhân scale 2 lần — scale
         nằm trong positionScale của bước bù), rồi áp offset của
         module này lên clip đã map. restCompSource = 'restpose'.
     opts: {srcRig, srcRest, dstRest, compensate=true, positionScale=1,
       name, autoMatch, scaleAware, scaleRootMotion, scaleHipsY,
       restPoseComp, scaleLimbAngles, scaleRoot (chỉ khi comp=false)}.
     Guard: nếu kết quả đã có scaleReport.restPoseComp=true thì
     không áp thêm offset dù gọi đường nào. */
  function retargetClipWithRestPose(clip, targetRig, opts) {
    opts = opts || {};
    var RM = (PS && PS.ArpRemap) || null;
    var result = { ok: false, clip: null, restCompensated: false, restReason: '', restOffsets: null, restMaxAngleDeg: 0, restMeanAngleDeg: 0, restMissingSrc: [], restMissingDst: [], restCompSource: 'none' };
    if (!RM || typeof RM.retargetClip !== 'function') {
      result.restReason = 'ArpRemap chưa load — không retarget được.';
      ArpRestPose.lastResult = result;
      return result;
    }
    var compensate = opts.compensate !== false;
    var useScalePath = !!(opts.scaleAware && opts.srcRig);
    var baseOpts = { name: opts.name, autoMatch: opts.autoMatch };
    if (useScalePath) {
      baseOpts.scaleAware = true;
      baseOpts.srcRig = opts.srcRig;
      baseOpts.scaleRootMotion = opts.scaleRootMotion;
      baseOpts.scaleHipsY = opts.scaleHipsY;
      baseOpts.restPoseComp = opts.restPoseComp;
      baseOpts.scaleLimbAngles = opts.scaleLimbAngles;
    } else {
      baseOpts.scaleRoot = compensate ? 1 : opts.scaleRoot;
    }
    var base = RM.retargetClip(clip, targetRig, baseOpts);
    Object.keys(base).forEach(function (k) { result[k] = base[k]; });
    result.restCompensated = false;
    result.restCompSource = 'none';
    if (!base.ok) {
      result.restReason = 'Retarget gốc đã từ chối (compat ' + Math.round((base.compat || 0) * 100) + '% < 80%) — chưa tới bước bù rest pose.';
      ArpRestPose.lastResult = result;
      return result;
    }
    if (!compensate) {
      result.restReason = 'Bù rest pose đã tắt (opts.compensate=false) — clip chỉ map tên.';
      ArpRestPose.lastResult = result;
      return result;
    }
    /* Rig đích (để đo/chụp rest): opts.dstRest > targetRig >
       Viewport model chính > selection. */
    var dstRig = targetRig || null;
    if (!dstRig && PS.Viewport && typeof PS.Viewport.getMainModel === 'function') {
      try { dstRig = PS.Viewport.getMainModel(); } catch (e) {}
    }
    if (!dstRig && PS.State && typeof PS.State.get === 'function') {
      try { dstRig = PS.State.get('selection'); } catch (e) {}
    }
    var dstRest = opts.dstRest || (dstRig ? captureRestPose(dstRig) : null);
    var srcRest = opts.srcRest || null;
    if (!srcRest && opts.srcRig) srcRest = captureRestPose(opts.srcRig);
    if (!srcRest && ArpRestPose._sourceRest) srcRest = ArpRestPose._sourceRest;
    if (!srcRest || !dstRest || !dstRest.count) {
      result.restReason = 'Không có rest pose nguồn/đích (cần opts.srcRig/srcRest hoặc ArpRestPose.setSourceRest(modelNguon)) — clip đã map tên, chưa bù offset.';
      ArpRestPose.lastResult = result;
      return result;
    }
    var off = computeRestOffsets(srcRest, dstRest);
    result.restOffsets = off;
    result.restMaxAngleDeg = off.maxAngleDeg;
    result.restMeanAngleDeg = off.meanAngleDeg;
    result.restMissingSrc = off.missingSrc;
    result.restMissingDst = off.missingDst;
    /* Đường (A): scale-aware đã bù rest pose rồi — chỉ đính bảng. */
    if (useScalePath || (base.scaleReport && base.scaleReport.restPoseComp)) {
      result.restCompensated = !!(base.scaleReport && base.scaleReport.restPoseComp);
      result.restCompSource = 'scale-aware';
      result.restReason = result.restCompensated
        ? 'Bù rest pose đã áp bên trong đường scale-aware (không áp thêm lần 2).'
        : 'Đường scale-aware chạy nhưng restPoseComp tắt — rest pose chưa bù.';
      ArpRestPose.lastResult = result;
      return result;
    }
    /* Đường (B): standalone — áp offset của module này. */
    var applied = applyRestOffsetsToClip(base.clip, off, { positionScale: opts.positionScale });
    if (!applied.ok) {
      result.restReason = 'Áp offset lỗi: ' + applied.error;
      ArpRestPose.lastResult = result;
      return result;
    }
    result.clip = applied.clip;
    result.restCompensated = true;
    result.restCompSource = 'restpose';
    result.restAppliedCount = applied.appliedCount;
    result.restPositionScale = applied.positionScale;
    result.restSourceLabel = ArpRestPose._sourceLabel || '';
    result.reason = '';
    ArpRestPose.lastResult = result;
    if (RM) RM.lastRemapped = applied.clip;
    return result;
  }
  ArpRestPose.retargetClipWithRestPose = retargetClipWithRestPose;

  /* Bảng offset (dữ liệu thuần) cho UI tab Remap: xếp theo góc giảm
     dần, giới hạn limit dòng. */
  function restOffsetsTable(offsetsInput, limit) {
    var off = offsetsInput && offsetsInput.offsets ? offsetsInput.offsets : (offsetsInput || {});
    var rows = Object.keys(off).map(function (k) {
      var e = off[k];
      var posLen = e.pos ? Math.sqrt(e.pos[0] * e.pos[0] + e.pos[1] * e.pos[1] + e.pos[2] * e.pos[2]) : 0;
      return { bone: e.bone, angleDeg: e.angleDeg || 0, posMm: round3(posLen * 1000), missingSrc: !!e.missingSrc };
    });
    rows.sort(function (a, b) { return b.angleDeg - a.angleDeg; });
    return rows.slice(0, limit || 10);
  }
  ArpRestPose.restOffsetsTable = restOffsetsTable;

  /* ============================================================
     ARPANIMMIRROR — MIRROR CLIP ĐÚNG (xem header §2)
     ============================================================ */
  var ArpAnimMirror = {
    /* Luật quat mirror đúng: (x, −y, −z, w). Luật cũ (−x, y, −z, w)
       là mirror qua mặt phẳng ngang — SAI, xem header. */
    LAW: 'quat (x,-y,-z,w) + pos (-x,y,z) + Left<->Right, qua YZ'
  };

  /* 'LeftArm' ↔ 'RightArm'; 'LeftHandMiddle1' ↔ 'RightHandMiddle1';
     hậu tố '_L'/'_R', '.L'/'.R' cũng đổi. Xương giữa giữ nguyên. */
  function counterpart(bone) {
    var b = String(bone || '');
    if (/^Left/i.test(b)) return b.replace(/^Left/i, 'Right');
    if (/^Right/i.test(b)) return b.replace(/^Right/i, 'Left');
    if (/_L$/i.test(b)) return b.replace(/_L$/i, '_R');
    if (/_R$/i.test(b)) return b.replace(/_R$/i, '_L');
    if (/\.L$/i.test(b)) return b.replace(/\.L$/i, '.R');
    if (/\.R$/i.test(b)) return b.replace(/\.R$/i, '.L');
    return b;
  }
  ArpAnimMirror.counterpart = counterpart;

  /* 'mixamorig:LeftArm.quaternion' → 'mixamorig:RightArm.quaternion'
     (giữ prefix + hậu tố .prop; tên không prefix cũng đổi được). */
  function mirrorTrackName(trackName) {
    var parsed = parseTrackName(trackName);
    if (!parsed) return trackName;
    var bonePart = parsed.bone;
    var m = bonePart.match(/^(mixamorig:?|model:?)(.*)$/i);
    var core = m ? m[2] : bonePart;
    var twin = counterpart(core);
    var twinPart = m ? (m[1] + twin) : twin;
    return twinPart + '.' + parsed.prop;
  }
  ArpAnimMirror.mirrorTrackName = mirrorTrackName;

  function mirrorQuatArr(q) {
    var out = [q[0], -q[1], -q[2], q[3]];
    return normQuatArr(out);
  }
  ArpAnimMirror.mirrorQuatArr = mirrorQuatArr;
  function mirrorPosArr(p) { return [-p[0], p[1], p[2]]; }
  ArpAnimMirror.mirrorPosArr = mirrorPosArr;

  /* Euler XYZ (ex,ey,ez) → (ex,−ey,−ez) — khớp luật quat trên. */
  function mirrorEuler(e) {
    e = e || {};
    return { x: +(e.x || 0), y: -(e.y || 0), z: -(e.z || 0) };
  }
  ArpAnimMirror.mirrorEuler = mirrorEuler;

  function mirrorPoseMap(pose) {
    var out = {};
    Object.keys(pose || {}).forEach(function (dst) {
      out[counterpart(dst)] = mirrorEuler(pose[dst]);
    });
    return out;
  }
  ArpAnimMirror.mirrorPoseMap = mirrorPoseMap;

  function swapSideMap(map) {
    var out = {};
    Object.keys(map || {}).forEach(function (k) { out[counterpart(k)] = map[k]; });
    return out;
  }

  /* Mirror keys keyframe (giữ nguyên cấu trúc FK: fingerCurl đổi
     bên theo tên, footRoll đổi giá trị Left↔Right, jawOpen giữ). */
  function mirrorKey(key) {
    var c = cloneDeep(key);
    c.pose = mirrorPoseMap(c.pose);
    if (c.hips) c.hips = { x: -(c.hips.x || 0), y: c.hips.y || 0, z: c.hips.z || 0 };
    if (c.fk) {
      c.fk.fkRotations = mirrorPoseMap(c.fk.fkRotations);
      c.fk.fingerCurl = swapSideMap(c.fk.fingerCurl);
      c.fk.footRoll = swapSideMap(c.fk.footRoll);
      c.fk.spineRotations = mirrorPoseMap(c.fk.spineRotations);
      if (c.fk.headRotation) c.fk.headRotation = mirrorEuler(c.fk.headRotation);
      if (c.fk.neckRotation) c.fk.neckRotation = mirrorEuler(c.fk.neckRotation);
    }
    return c;
  }
  ArpAnimMirror.mirrorKey = mirrorKey;

  function mirrorKeys(keys) {
    if (!Array.isArray(keys)) return { ok: false, error: 'Keys không phải mảng.' };
    return { ok: true, keys: keys.map(mirrorKey), keyCount: keys.length };
  }
  ArpAnimMirror.mirrorKeys = mirrorKeys;

  function mirrorKeyframeClip(clip) {
    if (!clip || !Array.isArray(clip.keys)) return { ok: false, error: 'Clip không có keys.' };
    var r = mirrorKeys(clip.keys);
    if (!r.ok) return r;
    var out = {
      name: (clip.name || 'clip') + '_mirror',
      duration: clip.duration || 0,
      fps: clip.fps || 30,
      loop: !!clip.loop,
      keys: r.keys
    };
    return { ok: true, kind: 'keyframe', clip: out, duration: out.duration, keyCount: r.keyCount };
  }
  ArpAnimMirror.mirrorKeyframeClip = mirrorKeyframeClip;

  /* Mirror 1 clip tracks (THREE.AnimationClip hoặc plain tracks).
     Phát track theo cặp L/R: mỗi bên lấy giá trị từ bên kia đã lật
     dấu; xương chỉ có 1 bên → TẠO track bên kia (không nuốt mất). */
  function mirrorClip(clip) {
    if (!clip || !clip.tracks) return { ok: false, error: 'Clip không có tracks.' };
    var isThree = !!(clip.tracks[0] && typeof clip.tracks[0].createInterpolant === 'function');
    var byKey = {};
    var order = [];
    clip.tracks.forEach(function (tr) {
      var parsed = parseTrackName(tr.name);
      if (!parsed) return;
      var key = norm(parsed.bone) + '|' + parsed.prop;
      if (!byKey[key]) { byKey[key] = tr; order.push(key); }
    });
    function mirrorValues(srcTr, isQuat) {
      var n = srcTr.times.length;
      var size = isQuat ? 4 : 3;
      var vals = new Array(n * size);
      for (var i = 0; i < n; i++) {
        if (isQuat) {
          var q = mirrorQuatArr([srcTr.values[i * 4], srcTr.values[i * 4 + 1], srcTr.values[i * 4 + 2], srcTr.values[i * 4 + 3]]);
          vals[i * 4] = q[0]; vals[i * 4 + 1] = q[1]; vals[i * 4 + 2] = q[2]; vals[i * 4 + 3] = q[3];
        } else {
          vals[i * 3] = -srcTr.values[i * 3]; vals[i * 3 + 1] = srcTr.values[i * 3 + 1]; vals[i * 3 + 2] = srcTr.values[i * 3 + 2];
        }
      }
      return vals;
    }
    function makeTrack(srcTr, name, values) {
      if (isThree && srcTr.clone) {
        var nt = srcTr.clone();
        nt.name = name;
        nt.values = new Float32Array(values);
        return nt;
      }
      return { name: name, times: Array.prototype.slice.call(srcTr.times), values: values };
    }
    var done = {};
    var tracks = [];
    var synthesized = [];
    var mirroredBones = [];
    order.forEach(function (key) {
      if (done[key]) return;
      var tr = byKey[key];
      var parsed = parseTrackName(tr.name);
      var bone = stripName(parsed.bone);
      var twinBone = counterpart(bone);
      var twinKey = norm(twinBone) + '|' + parsed.prop;
      var twinTr = byKey[twinKey] || null;
      var isQuat = parsed.prop === 'quaternion';
      done[key] = true;
      done[twinKey] = true;
      /* Track cho xương này: lấy giá trị từ track twin (nếu có)
         đã mirror; nếu không có twin thì mirror chính nó. */
      var srcA = twinTr || tr;
      tracks.push(makeTrack(tr, tr.name, mirrorValues(srcA, isQuat)));
      mirroredBones.push(bone);
      if (twinBone !== bone) {
        var srcB = tr;
        var twinName = twinTr ? twinTr.name : mirrorTrackName(tr.name);
        tracks.push(makeTrack(twinTr || tr, twinName, mirrorValues(srcB, isQuat)));
        mirroredBones.push(twinBone);
        if (!twinTr) synthesized.push(twinName);
      }
    });
    /* Track không phải bone (morph...) giữ nguyên, không mirror. */
    clip.tracks.forEach(function (tr) {
      if (!parseTrackName(tr.name)) tracks.push(tr.clone ? tr.clone() : { name: tr.name, times: tr.times.slice(), values: tr.values.slice() });
    });
    var out;
    if (isThree && T) out = new T.AnimationClip((clip.name || 'clip') + '_mirror', clip.duration, tracks);
    else out = { name: (clip.name || 'clip') + '_mirror', duration: clip.duration, tracks: tracks };
    return {
      ok: true, kind: 'three', clip: out, duration: round3(clip.duration),
      trackCount: tracks.length, mirroredBones: mirroredBones,
      synthesizedTwins: synthesized,
      note: 'Mirror đúng qua YZ: đổi cặp Left/Right + quat (x,−y,−z,w) / vị trí (−x,y,z).' + (synthesized.length ? ' Tạo thêm ' + synthesized.length + ' track bên kia: ' + synthesized.join(', ') : '')
    };
  }
  ArpAnimMirror.mirrorClip = mirrorClip;

  /* Mirror mọi dạng clip: keys keyframe / tracks THREE / plain. */
  function mirrorClipAny(clip) {
    if (!clip || typeof clip !== 'object') return { ok: false, error: 'Clip rỗng.' };
    if (Array.isArray(clip.keys)) return mirrorKeyframeClip(clip);
    if (Array.isArray(clip.tracks)) return mirrorClip(clip);
    return { ok: false, error: 'Clip không nhận dạng được (cần .keys hoặc .tracks).' };
  }
  ArpAnimMirror.mirrorClipAny = mirrorClipAny;

  /* ============================================================
     EXPORTS
     ============================================================ */
  ArpRestPose._test = {
    norm: norm, stripName: stripName, parseTrackName: parseTrackName,
    quatMulArr: quatMulArr, quatInvArr: quatInvArr, quatAngleDeg: quatAngleDeg,
    captureRestPose: captureRestPose, computeRestOffsets: computeRestOffsets,
    applyRestOffsetsToClip: applyRestOffsetsToClip,
    retargetClipWithRestPose: retargetClipWithRestPose
  };
  ArpAnimMirror._test = {
    norm: norm, stripName: stripName, parseTrackName: parseTrackName,
    counterpart: counterpart, mirrorTrackName: mirrorTrackName,
    mirrorQuatArr: mirrorQuatArr, mirrorPosArr: mirrorPosArr,
    mirrorEuler: mirrorEuler, mirrorPoseMap: mirrorPoseMap,
    mirrorKey: mirrorKey, mirrorKeys: mirrorKeys,
    mirrorClip: mirrorClip, mirrorKeyframeClip: mirrorKeyframeClip,
    mirrorClipAny: mirrorClipAny
  };

  PS.ArpRestPose = ArpRestPose;
  PS.ArpAnimMirror = ArpAnimMirror;
  if (typeof window !== 'undefined') {
    window.PixiStudio = window.PixiStudio || {};
    window.PixiStudio.ArpRestPose = ArpRestPose;
    window.PixiStudio.ArpAnimMirror = ArpAnimMirror;
  }
})();
