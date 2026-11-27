/* ============================================================
 * rig/auto-rig-pro.js — AUTO RIG PRO BLEND (mô phỏng Auto Rig Pro)
 *
 * Mô phỏng quy trình Auto Rig Pro (Blender add-on) nhưng chạy
 * HOÀN TOÀN LOCAL trong studio, không cần Blender hay add-on:
 *   1. Đo landmark trên mesh THẬT (đỉnh đầu, cằm, vai, khuỷu, cổ tay,
 *      hông, gối, cổ chân, gót) bằng phân bố đỉnh + bbox — KHÔNG dùng
 *      tỉ lệ cố định của mẫu khác (xem measureLandmarks).
 *   2. Dựng skeleton humanoid kiểu Mixamo — 41 xương, tên mixamorig: —
 *      khớp đúng tỉ lệ mesh đó (fit bone chain vào landmark).
 *   3. Skin tự động kiểu ARP: weight theo khoảng cách đỉnh → đoạn xương
 *      (2 xương gần nhất, inverse-distance, tổng = 1.0) + gắn mesh thành
 *      SkinnedMesh, hiện skeleton trong viewport (SkeletonHelper).
 *   4. Xuất FBX rigged (FBXBinary.write, keepSkeleton) + sinh script
 *      Blender Python (.py) đi kèm: mở .py trong Blender là import FBX
 *      vừa xuất rồi lưu thành .blend. Nút tải về CẢ 2 file.
 *
 * Khác "Rig 1 Lượt" (RigOneClick):
 *   • Rig 1 Lượt: rig viewport 23 xương (Spine/Chest) + export MESH-ONLY
 *     cho Mixamo tự auto-rig; khung 65 xương chỉ giữ trong scene.
 *   • Auto Rig Pro Blend: skeleton Mixamo 41 xương (Spine/Spine1/Spine2
 *     + ngón tay) gắn TRỰC TIẾP vào model trong scene, export FBX RIGGED
 *     (có skeleton + skin) để mở trong Blender/Unity/Unreal — KHÔNG dùng
 *     cho Mixamo (file có xương bị Mixamo từ chối ở bước map-skeleton).
 *
 * LƯU Ý TRUNG THỰC (khác Auto Rig Pro thật):
 *   • Không có bộ control IK/FK + widget như ARP (chỉ có skeleton +
 *     skin, đủ để animate/retarget). Không có corrective shape key.
 *   • Ngón út chỉ 1 đốt (Pinky1) vì ngắn — đủ cho skin + pose cơ bản.
 *   • Chỉ chạy trên model CHƯA có rig; model đã rig thì báo và dừng,
 *     không ghi đè (xem hasRig).
 * ============================================================ */
(function () {
  'use strict';

  var bus = PixiStudio.bus;
  var U = PixiStudio.Utils;

  var AutoRigPro = {
    lastResult: null,
    running: false
  };

  /* ---------- Skeleton 41 xương kiểu Mixamo ----------
     Core 23: Hips → Spine → Spine1 → Spine2 → Neck → Head → HeadTop_End,
     2 tay (Shoulder/Arm/ForeArm/Hand), 2 chân (UpLeg/Leg/Foot/ToeBase).
     Ngón tay 18 (9/tay): Thumb/Index/Middle/Ring 2 đốt, Pinky 1 đốt. */
  var BONE_DEFS = [
    { name: 'Hips', parent: null },
    { name: 'Spine', parent: 'Hips' },
    { name: 'Spine1', parent: 'Spine' },
    { name: 'Spine2', parent: 'Spine1' },
    { name: 'Neck', parent: 'Spine2' },
    { name: 'Head', parent: 'Neck' },
    { name: 'HeadTop_End', parent: 'Head' },
    { name: 'LeftShoulder', parent: 'Spine2' },
    { name: 'LeftArm', parent: 'LeftShoulder' },
    { name: 'LeftForeArm', parent: 'LeftArm' },
    { name: 'LeftHand', parent: 'LeftForeArm' },
    { name: 'LeftHandThumb1', parent: 'LeftHand' },
    { name: 'LeftHandThumb2', parent: 'LeftHandThumb1' },
    { name: 'LeftHandIndex1', parent: 'LeftHand' },
    { name: 'LeftHandIndex2', parent: 'LeftHandIndex1' },
    { name: 'LeftHandMiddle1', parent: 'LeftHand' },
    { name: 'LeftHandMiddle2', parent: 'LeftHandMiddle1' },
    { name: 'LeftHandRing1', parent: 'LeftHand' },
    { name: 'LeftHandRing2', parent: 'LeftHandRing1' },
    { name: 'LeftHandPinky1', parent: 'LeftHand' },
    { name: 'RightShoulder', parent: 'Spine2' },
    { name: 'RightArm', parent: 'RightShoulder' },
    { name: 'RightForeArm', parent: 'RightArm' },
    { name: 'RightHand', parent: 'RightForeArm' },
    { name: 'RightHandThumb1', parent: 'RightHand' },
    { name: 'RightHandThumb2', parent: 'RightHandThumb1' },
    { name: 'RightHandIndex1', parent: 'RightHand' },
    { name: 'RightHandIndex2', parent: 'RightHandIndex1' },
    { name: 'RightHandMiddle1', parent: 'RightHand' },
    { name: 'RightHandMiddle2', parent: 'RightHandMiddle1' },
    { name: 'RightHandRing1', parent: 'RightHand' },
    { name: 'RightHandRing2', parent: 'RightHandRing1' },
    { name: 'RightHandPinky1', parent: 'RightHand' },
    { name: 'LeftUpLeg', parent: 'Hips' },
    { name: 'LeftLeg', parent: 'LeftUpLeg' },
    { name: 'LeftFoot', parent: 'LeftLeg' },
    { name: 'LeftToeBase', parent: 'LeftFoot' },
    { name: 'RightUpLeg', parent: 'Hips' },
    { name: 'RightLeg', parent: 'RightUpLeg' },
    { name: 'RightFoot', parent: 'RightLeg' },
    { name: 'RightToeBase', parent: 'RightFoot' }
  ];
  AutoRigPro.BONE_COUNT = BONE_DEFS.length;   /* 41 */
  AutoRigPro.BONE_DEFS = BONE_DEFS;

  /* Tỉ lệ Y mặc định (đã kiểm chứng trên Coco/Lenhhosung Tripo, A-pose) —
     chỉ dùng làm FALLBACK khi đo từ mesh thất bại. */
  var RATIO_Y = {
    chin: 0.85, shoulder: 0.78, elbow: 0.63, wrist: 0.49,
    groin: 0.52, knee: 0.28, ankle: 0.06
  };
  var RATIO_X = {
    shoulderWidth: 0.13, armX: 0.22, foreX: 0.35, handX: 0.50, hipX: 0.09
  };

  function notify(type, title, message, duration) {
    bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 });
  }

  function sanitizeName(name) {
    return String(name || 'model').replace(/\.(glb|gltf|fbx|obj|stl)$/i, '')
      .replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'model';
  }

  function getTarget(target) {
    if (target) return target;
    if (PixiStudio.State && PixiStudio.State.get) {
      var sel = PixiStudio.State.get('selection');
      if (sel) return sel;
    }
    if (PixiStudio.Viewport && PixiStudio.Viewport.getMainModel) return PixiStudio.Viewport.getMainModel();
    return null;
  }

  function collectMeshes(root) {
    var out = [];
    if (!root || !root.traverse) return out;
    root.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.userData && (o.userData.isBoneVisual || o.userData.skipSkin)) return;
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      out.push(o);
    });
    return out;
  }

  /* Model đã có rig chưa? (SkinnedMesh hoặc bất kỳ THREE.Bone nào) */
  function hasRig(target) {
    var found = false;
    if (!target || !target.traverse) return false;
    target.traverse(function (o) {
      if (o.isSkinnedMesh || o.isBone) found = true;
    });
    return found;
  }
  AutoRigPro.hasRig = hasRig;

  /* ============================================================
     ĐO LANDMARK — từ phân bố đỉnh thật của mesh.
     Trả về { H, W, cx, cz, groundY, headTopY, chinY, shoulderY,
     elbowY, wristY, groinY, kneeY, ankleY, shoulderWidth, armX,
     foreX, handX, hipX, measured: {k: true/false} }.
     Y theo tỉ lệ đã kiểm chứng; X ĐO từ mesh (cực trị |x| theo dải Y
     và tâm 2 cụm chân ở dải gối); groin ĐO bằng điểm tách 1 thân → 2 chân.
     ============================================================ */
  function measureLandmarks(target) {
    var meshes = collectMeshes(target);
    if (!meshes.length) return null;
    target.updateMatrixWorld(true);

    /* bbox tổng (chỉ mesh thật) */
    var box = new THREE.Box3();
    meshes.forEach(function (m) { box.expandByObject(m); });
    if (box.isEmpty()) return null;
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var H = Math.max(1e-6, size.y);
    var W = Math.max(size.x, size.z);
    var cx = center.x, cz = center.z;
    var groundY = box.min.y;
    var headTopY = box.max.y;
    var yAt = function (r) { return groundY + r * H; };

    /* Gom đỉnh về world space (mẫu tối đa 60k đỉnh cho nhanh) */
    var pts = [];
    var tmp = new THREE.Vector3();
    meshes.forEach(function (m) {
      var pos = m.geometry.attributes.position;
      var step = Math.max(1, Math.floor(pos.count / 30000));
      for (var i = 0; i < pos.count; i += step) {
        tmp.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        pts.push([tmp.x, tmp.y, tmp.z]);
      }
    });
    if (!pts.length) return null;

    /* Độ sâu Z đo từ mesh (trung bình Z của đỉnh mẫu) — dùng khi
       opts.useDepth bật; mặc định xương vẫn dùng cz của bbox center. */
    var depthCz = 0;
    for (var zi = 0; zi < pts.length; zi++) depthCz += pts[zi][2];
    depthCz = depthCz / pts.length;

    var measured = {};
    measured.depthCz = true;
    var maxAbsXInBand = function (y0, y1) {
      var mx = 0;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (p[1] >= y0 && p[1] < y1) {
          var ax = Math.abs(p[0] - cx);
          if (ax > mx) mx = ax;
        }
      }
      return mx;
    };
    /* X-spread của thân (50% đỉnh gần tâm nhất) trong dải Y — loại tay */
    var torsoHalfWidthInBand = function (y0, y1) {
      var xs = [];
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (p[1] >= y0 && p[1] < y1) xs.push(Math.abs(p[0] - cx));
      }
      if (!xs.length) return 0;
      xs.sort(function (a, b) { return a - b; });
      return xs[Math.floor(xs.length * 0.5)] || 0;
    };
    /* Tâm 2 cụm chân ở dải Y: tách đỉnh thành x<0 / x>0, lấy trung bình |x| */
    var legCentersInBand = function (y0, y1) {
      var l = [], r = [];
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (p[1] >= y0 && p[1] < y1) {
          if (p[0] < cx) l.push(cx - p[0]); else r.push(p[0] - cx);
        }
      }
      if (!l.length || !r.length) return null;
      var avg = function (a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; };
      return { left: avg(l), right: avg(r) };
    };
    /* Có khoảng trống ở giữa thân không (thân 1 khối → không, 2 chân → có)? */
    var hasCenterGap = function (y0, y1) {
      var near = 0, total = 0;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (p[1] >= y0 && p[1] < y1) {
          total++;
          if (Math.abs(p[0] - cx) < 0.015 * H) near++;
        }
      }
      return total > 20 && near / total < 0.15;
    };

    /* --- groin: quét từ giữa thân xuống, điểm đầu tiên tách 2 chân --- */
    var groinY = yAt(RATIO_Y.groin);
    var bands = 40, bandH = H / bands;
    for (var b = Math.floor(bands * 0.55); b >= Math.floor(bands * 0.30); b--) {
      var y0 = groundY + b * bandH, y1 = y0 + bandH;
      if (hasCenterGap(y0, y1)) { groinY = y0 + bandH / 2; measured.groin = true; break; }
    }

    /* --- chin: tìm dải rộng nhất của đầu rồi quét XUỐNG từ đó để tìm
       cổ thắt (spread < 55% spread đầu). Quét từ đỉnh đầu sẽ chạm ngay
       chóp sọ (hẹp tự nhiên) nên chin đo sai lên ~0.99H. --- */
    var chinY = yAt(RATIO_Y.chin);
    var headWidestY = groundY + 0.92 * H, headMaxSpread = 0;
    for (var y = groundY + 0.80 * H; y < headTopY; y += 0.01 * H) {
      var sp = maxAbsXInBand(y, y + 0.02 * H);
      if (sp > headMaxSpread) { headMaxSpread = sp; headWidestY = y; }
    }
    if (headMaxSpread > 1e-6) {
      for (var y2 = headWidestY; y2 > groundY + 0.70 * H; y2 -= 0.01 * H) {
        var sp2 = maxAbsXInBand(y2, y2 + 0.02 * H);
        if (sp2 > 0 && sp2 < 0.55 * headMaxSpread) { chinY = y2 + 0.01 * H; measured.chin = true; break; }
      }
    }

    /* --- X: cực trị tay theo dải Y + tâm 2 chân ở dải gối --- */
    var shoulderY = yAt(RATIO_Y.shoulder);
    var elbowY = yAt(RATIO_Y.elbow);
    var wristY = yAt(RATIO_Y.wrist);
    var kneeY = yAt(RATIO_Y.knee);
    var ankleY = yAt(RATIO_Y.ankle);
    var shoulderWidth = torsoHalfWidthInBand(shoulderY - 0.03 * H, shoulderY + 0.03 * H);
    if (shoulderWidth > 0.02 * H) measured.shoulderWidth = true;
    else shoulderWidth = RATIO_X.shoulderWidth * H;
    var armX = maxAbsXInBand(shoulderY - 0.03 * H, shoulderY + 0.03 * H);
    if (armX > shoulderWidth) measured.armX = true; else armX = RATIO_X.armX * H;
    var foreX = maxAbsXInBand(elbowY - 0.03 * H, elbowY + 0.03 * H);
    if (foreX > 0.05 * H) measured.foreX = true; else foreX = RATIO_X.foreX * H;
    var handX = maxAbsXInBand(wristY - 0.03 * H, wristY + 0.03 * H);
    if (handX > 0.05 * H) measured.handX = true; else handX = RATIO_X.handX * H;
    var legs = legCentersInBand(kneeY - 0.03 * H, kneeY + 0.03 * H);
    var hipX = RATIO_X.hipX * H;
    if (legs) { hipX = (legs.left + legs.right) / 2; measured.hipX = true; }

    return {
      H: H, W: W, cx: cx, cz: cz, depthCz: depthCz, groundY: groundY, headTopY: headTopY,
      chinY: chinY, shoulderY: shoulderY, elbowY: elbowY, wristY: wristY,
      groinY: groinY, kneeY: kneeY, ankleY: ankleY,
      shoulderWidth: shoulderWidth, armX: armX, foreX: foreX, handX: handX, hipX: hipX,
      measured: measured, sampleCount: pts.length
    };
  }
  AutoRigPro.measureLandmarks = measureLandmarks;

  /* ---------- Vị trí world của từng xương, từ landmark ----------
     opts (mới, tab Smart — toàn bộ mặc định giữ hành vi cũ):
       symmetrical (default true): ép tay/chân trái/phải đối xứng qua
         trục X (cx): mỗi cặp dùng chung |x-cx| trung bình 2 bên.
       useDepth (default false): dùng lm.depthCz (Z đo từ mesh) làm
         tâm Z thay vì lm.cz (tâm Z của bbox). */
  var SYMM_PAIRS = [
    ['LeftShoulder', 'RightShoulder'], ['LeftArm', 'RightArm'],
    ['LeftForeArm', 'RightForeArm'], ['LeftHand', 'RightHand'],
    ['LeftHandThumb1', 'RightHandThumb1'], ['LeftHandThumb2', 'RightHandThumb2'],
    ['LeftHandIndex1', 'RightHandIndex1'], ['LeftHandIndex2', 'RightHandIndex2'],
    ['LeftHandMiddle1', 'RightHandMiddle1'], ['LeftHandMiddle2', 'RightHandMiddle2'],
    ['LeftHandRing1', 'RightHandRing1'], ['LeftHandRing2', 'RightHandRing2'],
    ['LeftHandPinky1', 'RightHandPinky1'],
    ['LeftUpLeg', 'RightUpLeg'], ['LeftLeg', 'RightLeg'],
    ['LeftFoot', 'RightFoot'], ['LeftToeBase', 'RightToeBase'],
    ['LeftForeArmTwist', 'RightForeArmTwist'], ['LeftLegTwist', 'RightLegTwist']
  ];
  /* ---------- Biến thể skeleton (tab Smart — chỉ cộng thêm, mặc định
     giữ nguyên 41 xương) ----------
     boneSet: 'full41' (mặc định, đủ 41 Mixamo) | 'hy3d28' (gọn kiểu
       HY3D: core 23 - HeadTop_End + 6 đốt ngón tay Thumb/Index/Middle
       = 28) | 'minimal15' (tối giản: Hips/Spine/Head + 2 tay
       Arm/ForeArm/Hand + 2 chân UpLeg/Leg/Foot = 15, không Neck).
     fingers (default true): tắt → bỏ mọi xương ngón tay.
     toes (default true): tắt → bỏ ToeBase.
     twist (default false): bật → chèn xương twist giữa ForeArm/Hand
       và Leg/Foot (LeftForeArmTwist, RightForeArmTwist, LeftLegTwist,
       RightLegTwist); Hand/Foot đổi parent sang xương twist.
     spineSegments (1/2/3, default 3): 1 → chỉ Spine (Neck + vai móc
       vào Spine); 2 → Spine + Spine1 (bỏ Spine2).
     neckSegments (1/2, default 1): 2 → chèn Neck1 giữa Neck và Head.
     Xương nào bị bỏ thì con của nó được móc lại vào tổ tiên gần nhất
     còn giữ (rewire) để cây xương không đứt. */
  var FINGER_RE = /Hand(Thumb|Index|Middle|Ring|Pinky)/;
  function variantBoneDefs(opts) {
    opts = opts || {};
    var base;
    if (opts.boneSet === 'hy3d28') {
      base = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
        'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
        'LeftHandThumb1', 'LeftHandIndex1', 'LeftHandMiddle1',
        'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
        'RightHandThumb1', 'RightHandIndex1', 'RightHandMiddle1',
        'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
        'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'];
    } else if (opts.boneSet === 'minimal15') {
      base = ['Hips', 'Spine', 'Head',
        'LeftArm', 'LeftForeArm', 'LeftHand',
        'RightArm', 'RightForeArm', 'RightHand',
        'LeftUpLeg', 'LeftLeg', 'LeftFoot',
        'RightUpLeg', 'RightLeg', 'RightFoot'];
    } else {
      base = BONE_DEFS.map(function (d) { return d.name; });
    }
    var kept = {};
    base.forEach(function (n) { kept[n] = true; });
    var spineSegs = opts.spineSegments == null ? 3 : opts.spineSegments;
    if (spineSegs <= 2) delete kept.Spine2;
    if (spineSegs <= 1) delete kept.Spine1;
    if (opts.fingers === false) {
      Object.keys(kept).forEach(function (n) { if (FINGER_RE.test(n)) delete kept[n]; });
    }
    if (opts.toes === false) { delete kept.LeftToeBase; delete kept.RightToeBase; }
    var parentOf = {};
    BONE_DEFS.forEach(function (d) { parentOf[d.name] = d.parent; });
    var defs = BONE_DEFS.filter(function (d) { return kept[d.name]; })
      .map(function (d) { return { name: d.name, parent: d.parent }; });
    /* Rewire: parent bị bỏ → tổ tiên gần nhất còn giữ (hoặc null). */
    defs.forEach(function (d) {
      var p = d.parent;
      while (p && !kept[p]) p = parentOf[p];
      d.parent = p || null;
    });
    /* Neck 2 đốt: chèn Neck1, Head móc sang Neck1. */
    if (opts.neckSegments === 2 && kept.Neck && kept.Head) {
      defs.push({ name: 'Neck1', parent: 'Neck' });
      defs.forEach(function (d) { if (d.name === 'Head') d.parent = 'Neck1'; });
    }
    /* Twist bones: chèn sau ForeArm/Leg, Hand/Foot móc sang twist. */
    if (opts.twist) {
      [['LeftForeArmTwist', 'LeftForeArm', 'LeftHand'],
       ['RightForeArmTwist', 'RightForeArm', 'RightHand'],
       ['LeftLegTwist', 'LeftLeg', 'LeftFoot'],
       ['RightLegTwist', 'RightLeg', 'RightFoot']].forEach(function (t) {
        if (kept[t[1]] && kept[t[2]]) {
          defs.push({ name: t[0], parent: t[1] });
          defs.forEach(function (d) { if (d.name === t[2]) d.parent = t[0]; });
        }
      });
    }
    /* Giữ thứ tự duyệt: cha trước con (BONE_DEFS gốc đã đúng thứ tự;
       Neck1/twist chèn cuối vẫn sau cha của chúng). */
    return defs;
  }
  AutoRigPro.variantBoneDefs = variantBoneDefs;
  function boneWorldPositions(lm, opts) {
    opts = opts || {};
    var H = lm.H, cx = lm.cx;
    /* useDepth: tâm Z đo từ mesh; mặc định cz của bbox center (như cũ) */
    var cz = (opts.useDepth && lm.depthCz != null) ? lm.depthCz : lm.cz;
    var groin = lm.groinY, shoulder = lm.shoulderY, chin = lm.chinY;
    var elbow = lm.elbowY, wrist = lm.wristY, knee = lm.kneeY, ankle = lm.ankleY;
    var sw = lm.shoulderWidth, ax = lm.armX, fx = lm.foreX, hx = lm.handX, hipX = lm.hipX;
    var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    var fingerLen = Math.max(0.02, H * 0.035);
    var fwd = 0.02 * H;   /* ngón tay hơi chếch về trước (+Z) */
    var pos = {};
    pos.Hips = V(cx, groin, cz);
    pos.Spine = V(cx, groin + 0.06 * H, cz);
    pos.Spine1 = V(cx, groin + 0.12 * H, cz);
    pos.Spine2 = V(cx, shoulder - 0.03 * H, cz);
    pos.Neck = V(cx, chin - 0.02 * H, cz);
    pos.Head = V(cx, chin + 0.03 * H, cz);
    pos.HeadTop_End = V(cx, lm.headTopY, cz);
    /* tay trái (-X) / phải (+X) — mặt nhân vật hướng +Z */
    pos.LeftShoulder = V(cx - sw, shoulder, cz);
    pos.LeftArm = V(cx - ax, shoulder - 0.02 * H, cz);
    pos.LeftForeArm = V(cx - fx, elbow, cz + 0.005 * H);
    pos.LeftHand = V(cx - hx, wrist, cz + 0.01 * H);
    pos.RightShoulder = V(cx + sw, shoulder, cz);
    pos.RightArm = V(cx + ax, shoulder - 0.02 * H, cz);
    pos.RightForeArm = V(cx + fx, elbow, cz + 0.005 * H);
    pos.RightHand = V(cx + hx, wrist, cz + 0.01 * H);
    /* ngón tay: từ bàn tay đi xuống + hơi ra ngoài */
    var fingers = function (side, handPos, sgn) {
      var base = handPos;
      var spread = fingerLen * 0.35;
      var defs = [
        ['Thumb', 0.30, 0.015, 0.020], ['Index', 0.10, 0.000, 0.010],
        ['Middle', 0.00, -0.010, 0.010], ['Ring', -0.10, -0.005, 0.010],
        ['Pinky', -0.20, -0.010, 0.005]
      ];
      var out = {};
      defs.forEach(function (d) {
        var key = d[0];
        var dirx = sgn * (0.35 + d[1]);
        var p1 = V(base.x + dirx * spread, base.y - fingerLen * 0.55, base.z + fwd + d[3] * H);
        var p2 = V(p1.x + dirx * spread * 0.5, p1.y - fingerLen * 0.45, p1.z + fwd * 0.5);
        out[side + 'Hand' + key + '1'] = p1;
        if (key !== 'Pinky') out[side + 'Hand' + key + '2'] = p2;
      });
      return out;
    };
    var fl = fingers('Left', pos.LeftHand, -1);
    var fr = fingers('Right', pos.RightHand, 1);
    Object.keys(fl).forEach(function (k) { pos[k] = fl[k]; });
    Object.keys(fr).forEach(function (k) { pos[k] = fr[k]; });
    /* chân */
    pos.LeftUpLeg = V(cx - hipX, groin - 0.03 * H, cz);
    pos.LeftLeg = V(cx - hipX, knee, cz + 0.005 * H);
    pos.LeftFoot = V(cx - hipX, ankle, cz + 0.01 * H);
    pos.LeftToeBase = V(cx - hipX, ankle - 0.008 * H, cz + 0.06 * H);
    pos.RightUpLeg = V(cx + hipX, groin - 0.03 * H, cz);
    pos.RightLeg = V(cx + hipX, knee, cz + 0.005 * H);
    pos.RightFoot = V(cx + hipX, ankle, cz + 0.01 * H);
    pos.RightToeBase = V(cx + hipX, ankle - 0.008 * H, cz + 0.06 * H);
    /* Vị trí twist bones: luôn tính (dù opts.twist tắt thì skeleton
       không dùng tới) để SYMM_PAIRS (có cặp twist) không chạm phải
       vị trí undefined khi đối xứng hoá. */
    var mid = function (a, b) { return V((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); };
    pos.LeftForeArmTwist = mid(pos.LeftForeArm, pos.LeftHand);
    pos.RightForeArmTwist = mid(pos.RightForeArm, pos.RightHand);
    pos.LeftLegTwist = mid(pos.LeftLeg, pos.LeftFoot);
    pos.RightLegTwist = mid(pos.RightLeg, pos.RightFoot);
    /* Neck 2 đốt (opts.neckSegments === 2): Neck1 giữa Neck và Head. */
    if (opts.neckSegments === 2) {
      pos.Neck1 = V(cx, (pos.Neck.y + pos.Head.y) / 2, cz);
    }
    /* Tư thế gốc (opts.pose, default 'T'):
       'A' — tay chếch ~45° so với thân (A-pose theo marker tay):
       tay khép vào gần thân + hạ thấp hơn so với T-pose ngang 90°.
       Chỉ là xấp xỉ hình học từ landmark tay, không phải đo lại mesh. */
    if (opts.pose === 'A') {
      var aPoseArm = function (side, sgn) {
        var sh = pos[side + 'Shoulder'], arm = pos[side + 'Arm'],
            fore = pos[side + 'ForeArm'], hand = pos[side + 'Hand'];
        arm.x = cx + sgn * (sw + (Math.abs(arm.x - cx) - sw) * 0.8);
        fore.x = cx + sgn * (sw + (Math.abs(fore.x - cx) - sw) * 0.65);
        fore.y = fore.y - 0.04 * H;
        hand.x = cx + sgn * (sw + (Math.abs(hand.x - cx) - sw) * 0.55);
        hand.y = hand.y - 0.08 * H;
        if (pos[side + 'ForeArmTwist']) {
          var tw = pos[side + 'ForeArmTwist'];
          tw.x = (fore.x + hand.x) / 2; tw.y = (fore.y + hand.y) / 2; tw.z = (fore.z + hand.z) / 2;
        }
      };
      aPoseArm('Left', -1);
      aPoseArm('Right', 1);
    }
    /* Symmetrical (mặc định BẬT): ép cặp trái/phải đối xứng qua cx.
       |x-cx| dùng trung bình 2 bên để giữ đúng độ rộng đo được. */
    if (opts.symmetrical !== false) {
      SYMM_PAIRS.forEach(function (pair) {
        var L = pos[pair[0]], R = pos[pair[1]];
        if (!L || !R) return;
        var d = (Math.abs(L.x - cx) + Math.abs(R.x - cx)) / 2;
        L.x = cx - d;
        R.x = cx + d;
      });
    }
    return pos;
  }

  /* ============================================================
     SMART OPTIONS (tab Smart) — áp landmark overrides + Add Neck
     lên landmark ĐÃ ĐO, trước khi dựng skeleton. Không đổi landmark
     gốc ngoài các key được ghi đè. Trả về { lm, neckForced,
     overridesApplied }.
       landmarkOverrides: { chinY, groinY, shoulderY, elbowY, wristY,
         kneeY, ankleY, headTopY, groundY, shoulderWidth, armX, foreX,
         handX, hipX, cx, cz, depthCz } — chỉ key nào lm đã có mới nhận.
       addNeck: khi đo cằm yếu (measured.chin falsy) thì reset chinY
         về fallback tỉ lệ 0.85H để xương Neck luôn có đoạn cổ rõ
         (Neck = chin - 0.02H, Head = chin + 0.03H); neckForced=true.
         Khi chin đo tốt thì không làm gì (neckForced=false).
     ============================================================ */
  var OVERRIDE_KEYS = ['chinY', 'groinY', 'shoulderY', 'elbowY', 'wristY',
    'kneeY', 'ankleY', 'headTopY', 'groundY', 'shoulderWidth', 'armX',
    'foreX', 'handX', 'hipX', 'cx', 'cz', 'depthCz'];
  function applySmartOptions(lm, opts) {
    opts = opts || {};
    var out = { lm: lm, neckForced: false, overridesApplied: [] };
    if (!lm) return out;
    var ov = opts.landmarkOverrides;
    if (ov) {
      OVERRIDE_KEYS.forEach(function (k) {
        if (ov[k] != null && isFinite(+ov[k]) && lm[k] != null) {
          lm[k] = +ov[k];
          out.overridesApplied.push(k);
        }
      });
    }
    if (opts.addNeck && lm.measured && !lm.measured.chin) {
      lm.chinY = lm.groundY + RATIO_Y.chin * lm.H;
      out.neckForced = true;
    }
    return out;
  }
  AutoRigPro.applySmartOptions = applySmartOptions;

  /* ============================================================
     GUESS MARKERS (tab Smart) — đo landmark rồi trả về vị trí
     marker để hiện lên viewport. Trả về { landmarks, markers } hoặc
     null khi không đo được. Mỗi marker: { id, label, landmarkKey
     (key Y nó chỉnh), xKey (key X nó chỉnh, nếu có), position,
     color }.
     ============================================================ */
  var MARKER_COLORS = {
    chin: 0xffd166, groin: 0x06d6a0, shoulder: 0x118ab2,
    LeftHand: 0xef476f, RightHand: 0xf78c6b,
    LeftFoot: 0x7b61ff, RightFoot: 0x4cc9f0
  };
  function guessMarkers(target) {
    target = getTarget(target);
    if (!target) return null;
    var lm = measureLandmarks(target);
    if (!lm) return null;
    var H = lm.H, cx = lm.cx, cz = lm.cz;
    var P = function (x, y, z) { return { x: x, y: y, z: z }; };
    var defs = [
      { id: 'chin', label: 'Cằm (chin)', landmarkKey: 'chinY', xKey: null, position: P(cx, lm.chinY, cz) },
      { id: 'groin', label: 'Háng (groin)', landmarkKey: 'groinY', xKey: null, position: P(cx, lm.groinY, cz) },
      { id: 'shoulder', label: 'Vai (shoulder)', landmarkKey: 'shoulderY', xKey: null, position: P(cx, lm.shoulderY, cz) },
      { id: 'LeftHand', label: 'Tay trái', landmarkKey: 'wristY', xKey: 'handX', position: P(cx - lm.handX, lm.wristY, cz + 0.01 * H) },
      { id: 'RightHand', label: 'Tay phải', landmarkKey: 'wristY', xKey: 'handX', position: P(cx + lm.handX, lm.wristY, cz + 0.01 * H) },
      { id: 'LeftFoot', label: 'Chân trái', landmarkKey: 'ankleY', xKey: 'hipX', position: P(cx - lm.hipX, lm.ankleY, cz + 0.01 * H) },
      { id: 'RightFoot', label: 'Chân phải', landmarkKey: 'ankleY', xKey: 'hipX', position: P(cx + lm.hipX, lm.ankleY, cz + 0.01 * H) }
    ];
    var markers = defs.map(function (d) {
      return {
        id: d.id, label: d.label, landmarkKey: d.landmarkKey, xKey: d.xKey,
        position: d.position, color: MARKER_COLORS[d.id]
      };
    });
    return { landmarks: lm, markers: markers };
  }
  AutoRigPro.guessMarkers = guessMarkers;

  /* ============================================================
     DỰNG SKELETON — 41 xương THREE.Bone, tên mixamorig:*,
     vị trí khớp landmark (đã đổi về local của target).
     Trả về { rootBone, bones, boneList, helper, group }.
     ============================================================ */
  function buildSkeleton(target, lm, opts) {
    opts = opts || {};
    var worldPos = boneWorldPositions(lm, opts);
    /* Biến thể skeleton theo opts (mặc định đủ 41 — xem variantBoneDefs).
       BONE_DEFS gốc không đổi; defs lọc chỉ dùng trong lần build này. */
    var defs = variantBoneDefs(opts);
    /* world → local của target (target có thể đã scale/rotate) */
    target.updateMatrixWorld(true);
    var inv = target.matrixWorld.clone().invert();
    var localPos = {};
    Object.keys(worldPos).forEach(function (k) {
      localPos[k] = worldPos[k].clone().applyMatrix4(inv);
    });
    var bones = {};
    var group = new THREE.Group();
    group.name = '__autorigpro_rig__';
    defs.forEach(function (def) {
      var b = new THREE.Bone();
      b.name = 'mixamorig:' + def.name;
      b.userData.targetWorld = worldPos[def.name].clone();
      b.userData.targetLocal = localPos[def.name].clone();
      bones[def.name] = b;
    });
    defs.forEach(function (def) {
      var b = bones[def.name];
      if (def.parent) {
        var p = bones[def.parent];
        p.add(b);
        b.position.copy(localPos[def.name]).sub(localPos[def.parent]);
      } else {
        group.add(b);
        b.position.copy(localPos[def.name]);
      }
    });
    target.add(group);
    target.updateMatrixWorld(true);
    /* boneList theo thứ tự duyệt từ Hips (cho THREE.Skeleton + skinIndex) */
    var boneList = [];
    var walk = function (b) {
      boneList.push(b);
      b.children.forEach(function (c) { if (c.isBone) walk(c); });
    };
    walk(bones.Hips);
    var helper = null;
    try {
      helper = new THREE.SkeletonHelper(bones.Hips);
      helper.material.linewidth = 2;
      helper.material.depthTest = false;
      target.add(helper);
    } catch (e) { helper = null; }
    return { rootBone: bones.Hips, bones: bones, boneList: boneList, helper: helper, group: group, boneDefs: defs };
  }
  AutoRigPro.buildSkeleton = buildSkeleton;

  /* ---------- khoảng cách điểm → đoạn thẳng ---------- */
  function distToSegment(p, a, b) {
    var abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    var apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
    var len2 = abx * abx + aby * aby + abz * abz;
    var t = len2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /* ============================================================
     SKIN TỰ ĐỘNG — kiểu ARP: mỗi đỉnh lấy 2 đoạn xương gần nhất,
     weight = inverse-distance, chuẩn hoá tổng = 1.0.
     Thay mesh rigid bằng SkinnedMesh (giữ nguyên transform + geometry
     gốc trong __sourceMesh để khôi phục). Trả về số mesh đã bind.
     ============================================================ */
  function bindSkin(target, rig) {
    if (!rig || !rig.bones || !rig.boneList || !target) return 0;
    rig.rootBone.updateMatrixWorld(true);
    /* segments: [bone, a, b] theo world */
    var anchors = {};
    Object.keys(rig.bones).forEach(function (name) {
      anchors[name] = new THREE.Vector3().setFromMatrixPosition(rig.bones[name].matrixWorld);
    });
    var childrenOf = {};
    var skinDefs = (rig && rig.boneDefs) || BONE_DEFS;
    skinDefs.forEach(function (def) {
      if (def.parent) {
        if (!childrenOf[def.parent]) childrenOf[def.parent] = [];
        childrenOf[def.parent].push(def.name);
      }
    });
    var segs = [];
    skinDefs.forEach(function (def) {
      var a = anchors[def.name];
      var kids = childrenOf[def.name] || [];
      var b;
      if (kids.length) b = anchors[kids[0]];
      else {
        /* leaf: đoạn ngắn hướng xuống (ngón tay/chân) */
        var H = rig.landmarks ? rig.landmarks.H : 1.8;
        b = a.clone().add(new THREE.Vector3(0, -H * 0.03, 0));
      }
      segs.push({ name: def.name, bone: rig.bones[def.name], a: a, b: b });
    });
    var skeleton = new THREE.Skeleton(rig.boneList);
    var boneIndexOf = function (bone) {
      var i = rig.boneList.indexOf(bone);
      return i >= 0 ? i : 0;
    };
    var meshes = collectMeshes(target);
    var bound = 0;
    var v = new THREE.Vector3();
    meshes.forEach(function (mesh) {
      var geometry = mesh.geometry.clone();
      mesh.updateMatrixWorld(true);
      var m = mesh.matrixWorld.clone();
      var pos = geometry.attributes.position;
      var skinIndices = new Uint16Array(pos.count * 4);
      var skinWeights = new Float32Array(pos.count * 4);
      for (var i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        var d0 = null, d1 = null;
        for (var s = 0; s < segs.length; s++) {
          var d = distToSegment(v, segs[s].a, segs[s].b);
          if (!d0 || d < d0.d) { d1 = d0; d0 = { bone: segs[s].bone, d: d }; }
          else if (!d1 || d < d1.d) { d1 = { bone: segs[s].bone, d: d }; }
        }
        if (!d1) d1 = { bone: d0.bone, d: d0.d + 0.001 };
        var w0 = 1 / (d0.d + 0.0001), w1 = 1 / (d1.d + 0.0001);
        var total = w0 + w1;
        skinIndices[i * 4] = boneIndexOf(d0.bone);
        skinIndices[i * 4 + 1] = boneIndexOf(d1.bone);
        skinWeights[i * 4] = w0 / total;
        skinWeights[i * 4 + 1] = w1 / total;
        skinWeights[i * 4 + 2] = 0;
        skinWeights[i * 4 + 3] = 0;
      }
      /* Đảm bảo MỌI xương đều có ít nhất 1 đỉnh (nếu không FBX skin sẽ
         thiếu joint — vd ngón tay đặt hơi lệch khỏi mesh). Gán đỉnh gần
         nhất của xương đó làm influence thứ 3 với weight 0.01 rồi chuẩn
         hoá lại — biến dạng gần như không đổi (đổi ~1%). */
      var boneTotals = new Array(rig.boneList.length);
      for (var bt = 0; bt < boneTotals.length; bt++) boneTotals[bt] = 0;
      for (var wi = 0; wi < pos.count; wi++) {
        for (var wk = 0; wk < 4; wk++) boneTotals[skinIndices[wi * 4 + wk]] += skinWeights[wi * 4 + wk];
      }
      var usedGuaranteeVerts = {};
      for (var bi = 0; bi < rig.boneList.length; bi++) {
        if (boneTotals[bi] > 0) continue;
        var segB = null;
        for (var sb = 0; sb < segs.length; sb++) {
          if (segs[sb].bone === rig.boneList[bi]) { segB = segs[sb]; break; }
        }
        if (!segB) continue;
        /* đỉnh gần nhất CHƯA dùng cho guarantee — 2 xương không đè nhau */
        var bestI = -1, bestD = Infinity;
        for (var vi = 0; vi < pos.count; vi++) {
          if (usedGuaranteeVerts[vi]) continue;
          v.fromBufferAttribute(pos, vi).applyMatrix4(m);
          var dd = distToSegment(v, segB.a, segB.b);
          if (dd < bestD) { bestD = dd; bestI = vi; }
        }
        if (bestI < 0) continue;
        usedGuaranteeVerts[bestI] = 1;
        skinIndices[bestI * 4 + 2] = bi;
        skinWeights[bestI * 4 + 2] = 0.01;
        var s0 = skinWeights[bestI * 4] + skinWeights[bestI * 4 + 1] + 0.01;
        skinWeights[bestI * 4] /= s0;
        skinWeights[bestI * 4 + 1] /= s0;
        skinWeights[bestI * 4 + 2] /= s0;
        boneTotals[bi] += 0.01 / s0;
      }
      geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
      geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
      var material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      var skinned = new THREE.SkinnedMesh(geometry, material);
      skinned.name = mesh.name;
      skinned.position.copy(mesh.position);
      skinned.rotation.copy(mesh.rotation);
      skinned.scale.copy(mesh.scale);
      skinned.castShadow = mesh.castShadow;
      skinned.frustumCulled = false;
      skinned.userData = Object.assign({}, mesh.userData, { skipSkin: true, __sourceMesh: mesh });
      var parent = mesh.parent;
      var index = parent ? parent.children.indexOf(mesh) : -1;
      if (parent) {
        parent.remove(mesh);
        parent.add(skinned);
        if (index >= 0) { parent.children.splice(parent.children.indexOf(skinned), 1); parent.children.splice(index, 0, skinned); }
      }
      skinned.updateMatrixWorld(true);
      skinned.bind(skeleton, skinned.matrixWorld);
      bound++;
    });
    rig.skeleton = skeleton;
    rig.skinnedCount = bound;
    return bound;
  }
  AutoRigPro.bindSkin = bindSkin;

  /* ---------- QA skin: tổng weight ≈ 1.0, index hợp lệ ---------- */
  function qaSkin(target, boneCount) {
    var bad = 0, minSum = 2, maxSum = -2, bonesUsed = {};
    var checked = 0;
    target.traverse(function (o) {
      if (!o.isSkinnedMesh) return;
      var w = o.geometry.attributes.skinWeight, idx = o.geometry.attributes.skinIndex;
      if (!w || !idx) return;
      for (var i = 0; i < w.count; i++) {
        var s = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
        if (s < minSum) minSum = s;
        if (s > maxSum) maxSum = s;
        if (Math.abs(s - 1) > 0.01) bad++;
        for (var k = 0; k < 4; k++) {
          var bi = idx.array[i * 4 + k];
          if (bi >= boneCount) bad++;
          else if (w.array[i * 4 + k] > 0) bonesUsed[bi] = 1;
        }
        checked++;
      }
    });
    return { bad: bad, checked: checked, minSum: minSum, maxSum: maxSum, bonesUsed: Object.keys(bonesUsed).length };
  }
  AutoRigPro.qaSkin = qaSkin;

  /* ============================================================
     SCRIPT BLENDER (.py) — import FBX vừa xuất, lưu thành .blend.
     Đặt file .py CÙNG THƯ MỤC với file .fbx rồi chạy trong Blender
     (Scripting → Open → Run) hoặc: blender --background --python file.py
     ============================================================ */
  function buildBlenderScript(fbxFilename, blendFilename, modelName) {
    var lines = [
      '# Auto Rig Pro Blend — import FBX rigged + save .blend',
      '# Model: ' + (modelName || 'model'),
      '# Cach dung:',
      '#   1. Dat file .py nay CUNG THU MUC voi file ' + fbxFilename,
      '#   2. Blender -> Scripting -> Open -> chon file .py nay -> Run Script',
      '#      (hoac chay: blender --background --python ' + fbxFilename.replace(/\.fbx$/i, '') + '.py)',
      '#   3. File .blend se duoc luu cung thu muc: ' + blendFilename,
      'import bpy',
      'import os',
      '',
      'HERE = os.path.dirname(os.path.abspath(__file__))',
      'FBX_FILE = os.path.join(HERE, ' + JSON.stringify(fbxFilename) + ')',
      'BLEND_FILE = os.path.join(HERE, ' + JSON.stringify(blendFilename) + ')',
      '',
      '# Xoá scene mặc định',
      'bpy.ops.wm.read_factory_settings(use_empty=True)',
      '',
      '# Import FBX rigged (41 xương Mixamo + skin)',
      'bpy.ops.import_scene.fbx(filepath=FBX_FILE)',
      '',
      '# Lưu thành .blend',
      'bpy.ops.wm.save_as_mainfile(filepath=BLEND_FILE)',
      'print("AutoRigPro: imported", FBX_FILE)',
      'print("AutoRigPro: saved .blend ->", BLEND_FILE)'
    ];
    return lines.join('\n') + '\n';
  }
  AutoRigPro.buildBlenderScript = buildBlenderScript;

  /* ============================================================
     BUILD EXPORT — FBX rigged + script .py (không tải về, cho harness).
     Trả về { bytes, filename, report, pyText, pyFilename, blendFilename,
     boneCount, landmarks } hoặc null khi lỗi.
     ============================================================ */
  function buildExport(target, modelName) {
    target = getTarget(target);
    if (!target) return null;
    var W = PixiStudio.FBXBinary;
    if (!W || !W.write) return null;
    var name = sanitizeName(modelName || (PixiStudio.Models && PixiStudio.Models.current && PixiStudio.Models.current.name) || target.name || 'model');
    var fbxFilename = name + '_AutoRigPro.fbx';
    var blendFilename = name + '_AutoRigPro.blend';
    var pyFilename = name + '_AutoRigPro.py';
    var res;
    try {
      res = W.write(target, {
        version: 7300,
        keepSkeleton: true,
        noSkeleton: false,
        upAxis: 'Y',
        autoScale: true,
        embedTextures: true
      });
    } catch (e) {
      return null;
    }
    var pyText = buildBlenderScript(fbxFilename, blendFilename, name);
    return {
      bytes: res.bytes, filename: fbxFilename, report: res.report,
      pyText: pyText, pyFilename: pyFilename, blendFilename: blendFilename,
      boneCount: res.report.bones, hasSkin: res.report.hasSkin
    };
  }
  AutoRigPro.buildExport = buildExport;

  /* Tải cả 2 file về (FBX rigged + .py). */
  function exportBlend(target, modelName) {
    var r = buildExport(target, modelName);
    if (!r) {
      notify('error', 'Auto Rig Pro Blend', 'Không xuất được FBX rigged — kiểm tra model đã rig chưa.');
      return null;
    }
    U.downloadBlob(new Blob([r.bytes], { type: 'application/octet-stream' }), r.filename);
    U.downloadText(r.pyText, r.pyFilename, 'text/x-python');
    notify('success', 'Auto Rig Pro Blend xong',
      r.report.meshes + ' mesh · ' + r.boneCount + ' xương Mixamo · skin ' + (r.hasSkin ? 'có' : 'không') + ' · ' +
      r.report.textures + ' texture nhúng · ' + U.formatBytes(r.bytes.length) +
      ' — đã tải ' + r.filename + ' + ' + r.pyFilename + '. Mở .py trong Blender để lưu thành ' + r.blendFilename + '.', 15000);
    bus.emit('autorigpro:exported', { filename: r.filename, pyFilename: r.pyFilename, bytes: r.bytes.length, bones: r.boneCount });
    return r;
  }
  AutoRigPro.exportBlend = exportBlend;

  /* ============================================================
     RUN — pipeline đầy đủ: đo landmark → dựng skeleton → skin →
     QA → xuất FBX rigged + .py. Chỉ chạy trên model CHƯA có rig.
     Trả về result { ok, alreadyRigged, boneCount, landmarks, ... }.
     opts mới (tab Smart, mặc định giữ hành vi cũ):
       symmetrical (default true), addNeck (default false),
       useDepth (default false), landmarkOverrides (default null),
       export (default true), modelName.
     opts biến thể skeleton (tab Smart, mặc định = 41 xương đủ):
       boneSet ('full41' | 'hy3d28' | 'minimal15'), fingers (default
       true), toes (default true), twist (default false),
       spineSegments (1/2/3, default 3), neckSegments (1/2, default 1),
       pose ('T' | 'A', default 'T').
     ============================================================ */
  AutoRigPro.run = function (target, opts) {
    opts = opts || {};
    target = getTarget(target);
    var result = { ok: false, alreadyRigged: false, boneCount: 0, skinnedMeshes: 0, errors: [], warnings: [] };
    if (AutoRigPro.running) {
      notify('warning', 'Auto Rig Pro Blend', 'Đang rig dở một model khác — chờ xong rồi bấm lại.');
      result.errors.push('Đang rig dở một model khác');
      return result;
    }
    if (!target) {
      notify('warning', 'Auto Rig Pro Blend', 'Chưa có model nào để rig. Load model trước.');
      result.errors.push('Chưa có model nào');
      AutoRigPro.lastResult = result;
      return result;
    }
    if (hasRig(target)) {
      notify('warning', 'Auto Rig Pro Blend', 'Model đã có rig — không rig lại để tránh ghi đè skeleton. Muốn rig lại thì tháo rig cũ trước.');
      result.errors.push('Model đã có rig');
      result.alreadyRigged = true;
      AutoRigPro.lastResult = result;
      return result;
    }
    if (!window.THREE) {
      notify('error', 'Auto Rig Pro Blend', 'THREE chưa sẵn sàng — tải lại trang.');
      result.errors.push('THREE chưa sẵn sàng');
      AutoRigPro.lastResult = result;
      return result;
    }
    AutoRigPro.running = true;
    try {
      /* 1. Đo landmark */
      var lm = measureLandmarks(target);
      if (!lm) throw new Error('Không đo được landmark — model rỗng hoặc không có mesh.');
      /* 1b. Smart options (tab Smart): landmark overrides + Add Neck.
         Không truyền opts mới → lm giữ nguyên như cũ. */
      var smart = applySmartOptions(lm, opts);
      result.landmarks = lm;
      result.neckForced = smart.neckForced;
      result.overridesApplied = smart.overridesApplied;
      /* 2. Dựng skeleton 41 xương (symmetrical/useDepth qua opts) */
      var rig = buildSkeleton(target, lm, opts);
      rig.landmarks = lm;
      rig.smartOpts = {
        symmetrical: opts.symmetrical !== false,
        addNeck: !!opts.addNeck,
        useDepth: !!opts.useDepth
      };
      result.rig = rig;
      result.boneCount = rig.boneList.length;
      result.boneSet = opts.boneSet || 'full41';
      result.rigOptions = {
        boneSet: result.boneSet, fingers: opts.fingers !== false,
        toes: opts.toes !== false, twist: !!opts.twist,
        spineSegments: opts.spineSegments == null ? 3 : opts.spineSegments,
        neckSegments: opts.neckSegments == null ? 1 : opts.neckSegments,
        pose: opts.pose || 'T'
      };
      /* 3. Skin tự động */
      var bound = bindSkin(target, rig);
      result.skinnedMeshes = bound;
      if (!bound) throw new Error('Không bind được mesh nào vào skeleton.');
      /* 4. QA skin */
      var qa = qaSkin(target, rig.boneList.length);
      result.qa = qa;
      if (qa.bad > 0) result.warnings.push('Skin có ' + qa.bad + ' đỉnh weight lệch (tổng ≠ 1.0 hoặc index sai).');
      if (qa.bonesUsed < 10) result.warnings.push('Chỉ ' + qa.bonesUsed + '/' + rig.boneList.length + ' xương có weight — kiểm tra lại tư thế model (A/T-pose?).');
      result.ok = true;
      AutoRigPro.lastResult = result;
      notify('success', 'Auto Rig Pro Blend — rig xong',
        rig.boneList.length + ' xương Mixamo · ' + bound + ' mesh đã skin · cao ' + lm.H.toFixed(2) + 'm · ' +
        'landmark đo từ mesh (' + Object.keys(lm.measured).join(', ') + ')' +
        (result.warnings.length ? ' — LƯU Ý: ' + result.warnings.join('; ') : ''), 12000);
      bus.emit('autorigpro:done', { ok: true, boneCount: rig.boneList.length, skinnedMeshes: bound });
      try { bus.emit('arp:rig-complete', { source: 'autorigpro', target: target, rootBone: rig.rootBone, boneCount: rig.boneList.length, helper: rig.helper || null }); } catch (e) {} /* PHẦN 1 Viewport: tự hiện skeleton sau khi rig */
      /* 5. Xuất FBX rigged + .py (trừ khi opts.export === false) */
      if (opts.export !== false) {
        var exp = exportBlend(target, opts.modelName);
        result.export = exp || null;
        if (!exp) result.warnings.push('Rig xong nhưng xuất FBX thất bại.');
      }
    } catch (e) {
      result.errors.push(e && e.message || String(e));
      notify('error', 'Auto Rig Pro Blend lỗi', result.errors.join('; '));
      AutoRigPro.lastResult = result;
    }
    AutoRigPro.running = false;
    return result;
  };

  /* Test hooks */
  AutoRigPro._test = {
    measureLandmarks: measureLandmarks,
    buildSkeleton: buildSkeleton,
    bindSkin: bindSkin,
    hasRig: hasRig,
    qaSkin: qaSkin,
    buildBlenderScript: buildBlenderScript,
    boneWorldPositions: boneWorldPositions,
    guessMarkers: guessMarkers,
    applySmartOptions: applySmartOptions,
    OVERRIDE_KEYS: OVERRIDE_KEYS,
    SYMM_PAIRS: SYMM_PAIRS,
    BONE_DEFS: BONE_DEFS,
    variantBoneDefs: variantBoneDefs
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.AutoRigPro = AutoRigPro;
})();
