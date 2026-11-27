/* ============================================================
 * rig/arp-quickrig.js — QUICK RIG (Auto Rig Pro Blend, PHẦN C mở rộng)
 *
 * Nhập một model ĐÃ CÓ skeleton (FBX rigged hoặc GLB rigged) rồi
 * chuyển thành "control rig" của studio:
 *   • Map xương nguồn về chuẩn Mixamo 41 xương (tên + đoán theo
 *     vị trí/hierarchy khi tên không khớp + sửa map thủ công).
 *   • Control helpers trong viewport: IK target 2 tay + 2 chân,
 *     FK control cho spine/neck/head/khớp, pole target khuỷu/gối.
 *   • IK/FK switch riêng từng chi (IK = 2-bone analytic solver
 *     viết mới trong module, pure function để unit-test).
 *   • Finger curl, foot roll, spine FK, head/neck, jaw (nếu có).
 *   • Match to source / Bake to skeleton / Save-Load preset.
 *
 * GIỮ NGUYÊN skin + clip gốc: không bind lại, không xóa xương,
 * không sửa geometry. Control chỉ là Object3D phụ gắn thêm.
 *
 * GIỚI HẠN TRUNG THỰC (khác Blender / Auto Rig Pro thật):
 *   • Không có constraint nâng cao, driver, shape key, corrective
 *     shape key. IK chỉ là 2-bone analytic đơn giản (vai-khuỷu-tay,
 *     hông-gối-chân), không xử lý được chuỗi >2 xương hay giới hạn
 *     góc khớp thật của cơ thể.
 *   • Solver trả quaternion world-space rồi đổi về local; đúng nhất
 *     khi xương có local rotation ban đầu ≈ identity (đúng với
 *     skeleton do AutoRigPro / Mixamo xuất ra). Với skeleton có
 *     bind rotation lệch nhiều, IK vẫn chạy nhưng tay có thể lệch
 *     vài cm so với target — kiểm tra bằng mắt trong viewport.
 *   • Finger curl / foot roll là xoay trực tiếp khớp (FK), không
 *     phải IK ngón tay. Bake ghi pose control xuống bone rồi giữ
 *     control đồng bộ với pose đã bake (xem bakeToSkeleton).
 *   • Preset lưu ở localStorage của trình duyệt — không theo file,
 *     không đồng bộ qua GitHub.
 *
 * CHẾ ĐỘ MIXAMO FBX (mở rộng 2026-11-27):
 *   • detectMixamo(target) — nhận diện rig Mixamo chuẩn (prefix
 *     mixamorig:, ~41 xương chuẩn, T/A-pose, FBX 7300, có skin/clip).
 *   • autoGenMixamo(target, {mode:'keep'|'normalize'}) — một nút bấm:
 *     map thẳng 41 xương (không đoán như skeleton lạ), sinh đủ control
 *     IK 2 tay + 2 chân + pole + FK spine/head + finger + foot roll,
 *     match về đúng T-pose của Mixamo. 'keep' giữ nguyên skeleton
 *     Mixamo, chỉ thêm control; 'normalize' đổi tên xương về đúng
 *     'mixamorig:<Tên>' chuẩn (kèm đổi tên track clip theo).
 *   • attachMixamoClips / playMixamoClip — gắn clip Mixamo vào rig và
 *     phát thử bằng mixer riêng của rig (clip cùng skeleton nên KHÔNG
 *     cần remap; muốn chạy clip lên rig khác tên xương thì dùng
 *     retargetMixamoClip → ArpRemap.retargetClip + previewRemapped).
 *   • Xương thiếu được điền bằng xương GIẢ (proxy bone
 *     'mixamorig:<Tên>__proxy', userData.isProxy=true) — chỉ là
 *     placeholder tư thế, KHÔNG có skin weight (không nằm trong
 *     skeleton.bones của SkinnedMesh).
 *   • exportMixamoCompatible — xuất lại FBX RIGGED giữ xương
 *     mixamorig:, version 7300, về T-pose trước khi xuất. KHÁC preset
 *     Mixamo (mesh-only) của ArpExport: preset đó BỎ skeleton để
 *     upload Mixamo auto-rig, còn đây GIỮ skeleton để dùng tiếp ở
 *     Unity/Unreal hoặc tải lại Mixamo lấy animation mới.
 * GIỚI HẠN: chỉ hỗ trợ rig Mixamo chuẩn (humanoid, T/A-pose). Rig đã
 * đổi tên hết xương thì map bằng đoán vị trí, độ chính xác thấp hơn.
 * Không tải trực tiếp từ mixamo.com (cần đăng nhập Adobe) — user tải
 * file về rồi chọn file trong tab.
 * ============================================================ */
(function () {
  'use strict';

  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };
  var U = (window.PixiStudio && PixiStudio.Utils) || null;

  var QuickRig = {
    current: null,          /* control rig đang active */
    lastMap: null,          /* kết quả map gần nhất */
    mirrorDefault: true,
    PRESET_KEY: 'pixistudio.arp-quickrig-preset'
  };

  /* ---------- Chuẩn 41 xương Mixamo (đồng bộ auto-rig-pro.js) ---------- */
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
  QuickRig.BONE_COUNT = BONE_DEFS.length; /* 41 */
  QuickRig.BONE_DEFS = BONE_DEFS;
  var DST_NAMES = BONE_DEFS.map(function (d) { return d.name; });
  var PARENT_OF = {};
  BONE_DEFS.forEach(function (d) { PARENT_OF[d.name] = d.parent; });

  /* Chuỗi 2-bone IK: [rootBone, midBone, endBone, poleSide] */
  var LIMBS = {
    LeftArm: { root: 'LeftArm', mid: 'LeftForeArm', end: 'LeftHand', pole: 'LeftArm', kind: 'arm' },
    RightArm: { root: 'RightArm', mid: 'RightForeArm', end: 'RightHand', pole: 'RightArm', kind: 'arm' },
    LeftLeg: { root: 'LeftUpLeg', mid: 'LeftLeg', end: 'LeftFoot', pole: 'LeftLeg', kind: 'leg' },
    RightLeg: { root: 'RightUpLeg', mid: 'RightLeg', end: 'RightFoot', pole: 'RightLeg', kind: 'leg' }
  };
  QuickRig.LIMBS = LIMBS;

  /* FK control: mọi khớp chính (spine/neck/head/tay/chân) */
  var FK_BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
    'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
  QuickRig.FK_BONES = FK_BONES;
  /* Mức "Nhanh" của Auto Gen: chỉ control chính (IK tay/chân + spine/head) */
  var FK_BONES_FAST = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
    'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'];
  QuickRig.FK_BONES_FAST = FK_BONES_FAST;

  function notify(type, title, message, duration) {
    try { bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 }); } catch (e) {}
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function stripName(name) {
    /* FBXLoader parse lại FBX rigged có thể trả tên dạng
       "Model:mixamorig:Hips" hoặc "mixamorigHips" (mất dấu ':') —
       bóc cả prefix Model: lẫn mixamorig (có/không có ':').
       Hậu tố '__proxy' của xương giả (chế độ Mixamo) cũng được bóc để
       xương giả map về đúng xương đích chuẩn của nó. */
    var s = String(name == null ? '' : name);
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    s = s.replace(/__proxy$/i, '');
    return s;
  }
  QuickRig.stripName = stripName;
  function normName(name) { return stripName(name).toLowerCase(); }

  /* ---------- Thu thập xương từ nhiều dạng đầu vào ---------- */
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
  QuickRig.collectBones = collectBones;

  function findBone(bones, name) {
    var n = normName(name);
    for (var i = 0; i < bones.length; i++) {
      if (normName(bones[i].name) === n) return bones[i];
    }
    return null;
  }

  /* ============================================================
     MAP XƯƠNG THEO TÊN — strip prefix + không phân biệt hoa/thường.
     "Hips" khớp "mixamorig:Hips"; "hips"/"spine" kiểu Blender cũng khớp.
     Trả về { mapped:[{src,dst,method:'name'}], unmapped:[tên nguồn],
     extra:[tên nguồn] (alias của unmapped), missing:[tên đích chưa có
     nguồn], coverage, total:41, mappedCount, method:'name' }.
     ============================================================ */
  function mapBonesByName(skeleton) {
    var bones = collectBones(skeleton);
    var used = {};
    var mapped = [], unmapped = [];
    bones.forEach(function (b) {
      var n = normName(b.name);
      var dst = null;
      for (var i = 0; i < DST_NAMES.length; i++) {
        if (DST_NAMES[i].toLowerCase() === n) { dst = DST_NAMES[i]; break; }
      }
      if (dst && !used[dst]) { used[dst] = true; mapped.push({ src: b.name, dst: dst, method: 'name', bone: b }); }
      else unmapped.push(b.name);
    });
    var missing = DST_NAMES.filter(function (d) { return !used[d]; });
    return {
      mapped: mapped, unmapped: unmapped, extra: unmapped.slice(),
      missing: missing, coverage: mapped.length / DST_NAMES.length * 100,
      mappedCount: mapped.length, total: DST_NAMES.length, method: 'name', bones: bones
    };
  }

  /* ============================================================
     ĐOÁN MAP THEO VỊ TRÍ / HIERARCHY — khi tên không khớp.
     Giả định humanoid đứng thẳng, mặt hướng +Z (chuẩn AutoRigPro):
       Hips  = xương có nhiều hậu duệ nhất mà Y ≈ 0.52H, gần tâm X.
       Spine chain = đi lên từ Hips theo chuỗi con duy nhất (con có
         Y cao nhất / gần tâm X nhất) → Spine, Spine1, Spine2, Neck,
         Head, HeadTop_End.
       Tay   = 2 nhánh con của Spine2, trái/phải theo dấu X.
       Chân  = 2 nhánh con còn lại của Hips, trái/phải theo dấu X.
       Ngón  = con của Hand, gán theo thứ tự duyệt (Thumb, Index,
         Middle, Ring, Pinky — đúng thứ tự dựng của AutoRigPro).
     Trả về cùng shape như mapBonesByName, method:'position',
     mỗi entry có guessed:true.
     ============================================================ */
  function guessMapByPosition(skeleton) {
    var bones = collectBones(skeleton);
    var result = { mapped: [], unmapped: [], extra: [], missing: DST_NAMES.slice(),
      coverage: 0, mappedCount: 0, total: DST_NAMES.length, method: 'position', bones: bones };
    if (!bones.length || !window.THREE) return result;
    bones.forEach(function (b) { try { b.updateWorldMatrix(true, false); } catch (e) {} });
    var root = bones[0];
    try { if (root.parent) root.parent.updateMatrixWorld(true); else root.updateMatrixWorld(true); } catch (e) {}
    var V = window.THREE.Vector3;
    var posOf = function (b) { return new V().setFromMatrixPosition(b.matrixWorld); };
    var positions = {};
    bones.forEach(function (b) { positions[b.name] = posOf(b); });
    var minY = Infinity, maxY = -Infinity, cx = 0;
    bones.forEach(function (b) { var p = positions[b.name]; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; cx += p.x; });
    cx /= bones.length;
    var H = Math.max(1e-6, maxY - minY);
    var descendants = function (b) {
      var n = 0;
      (function walk(o) { o.children.forEach(function (c) { if (c.isBone && bones.indexOf(c) >= 0) { n++; walk(c); } }); })(b);
      return n;
    };
    /* Chỉ xét xương CÓ TRONG tập đầu vào — xương đã bị loại khỏi danh
       sách (vd test thiếu ngón) không được đoán lại qua children. */
    var boneChildren = function (b) { return b.children.filter(function (c) { return c.isBone && bones.indexOf(c) >= 0; }); };
    var usedSrc = {};
    var put = function (bone, dst) {
      if (!bone || usedSrc[bone.name]) return null;
      usedSrc[bone.name] = true;
      result.mapped.push({ src: bone.name, dst: dst, method: 'position', guessed: true, bone: bone });
      var mi = result.missing.indexOf(dst);
      if (mi >= 0) result.missing.splice(mi, 1);
      return bone;
    };
    /* --- Hips: nhiều hậu duệ nhất trong dải Y 0.40–0.65H, gần tâm X --- */
    var hips = null, bestScore = -Infinity;
    bones.forEach(function (b) {
      var p = positions[b.name];
      var yRel = (p.y - minY) / H;
      if (yRel < 0.35 || yRel > 0.70) return;
      var score = descendants(b) * 10 - Math.abs(p.x - cx) / H * 5 - Math.abs(yRel - 0.52) * 10;
      if (score > bestScore) { bestScore = score; hips = b; }
    });
    if (!hips) hips = bones[0];
    put(hips, 'Hips');
    /* --- Spine chain: từ Hips đi lên theo con có Y cao nhất --- */
    var spineNames = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End'];
    var cur = hips;
    for (var si = 0; si < spineNames.length; si++) {
      var kids = boneChildren(cur).filter(function (k) { return !usedSrc[k.name]; });
      if (!kids.length) break;
      kids.sort(function (a, b2) {
        var pa = positions[a.name], pb = positions[b2.name];
        var d = pb.y - pa.y; /* Y cao nhất trước */
        if (Math.abs(d) > 1e-6) return d;
        return Math.abs(pa.x - cx) - Math.abs(pb.x - cx);
      });
      cur = kids[0];
      put(cur, spineNames[si]);
    }
    var spine2 = findMappedBone(result, 'Spine2');
    var head = findMappedBone(result, 'Head');
    /* --- Tay: nhánh con của Spine2 (trừ Neck chain), trái/phải theo X --- */
    if (spine2) {
      var armRoots = boneChildren(spine2).filter(function (k) {
        return !usedSrc[k.name] && positions[k.name].y < positions[spine2.name].y + 0.05 * H;
      });
      /* Neck đã dùng nên nhánh còn lại là 2 vai; nếu còn lẫn, loại nhánh
         có Y cao nhất (đó là Neck nếu chưa map) */
      armRoots.sort(function (a, b2) { return positions[a.name].x - positions[b2.name].x; });
      var armDefs = [
        ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'],
        ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand']
      ];
      armRoots.slice(0, 2).forEach(function (shoulderBone, idx) {
        var defs = armDefs[idx];
        var node = shoulderBone;
        put(node, defs[0]);
        for (var j = 1; j < defs.length; j++) {
          var next = boneChildren(node).filter(function (k) { return !usedSrc[k.name]; });
          if (!next.length) break;
          /* tay đi ra ngoài + xuống: con xa tâm X nhất */
          next.sort(function (a, b2) {
            return Math.abs(positions[b2.name].x - cx) - Math.abs(positions[a.name].x - cx);
          });
          node = next[0];
          put(node, defs[j]);
        }
        /* Ngón tay: con của Hand, theo thứ tự duyệt */
        var hand = node;
        var fingerKids = boneChildren(hand).filter(function (k) { return !usedSrc[k.name]; });
        var side = idx === 0 ? 'Left' : 'Right';
        var fingerDefs = [side + 'HandThumb1', side + 'HandThumb2', side + 'HandIndex1', side + 'HandIndex2',
          side + 'HandMiddle1', side + 'HandMiddle2', side + 'HandRing1', side + 'HandRing2', side + 'HandPinky1'];
        fingerKids.forEach(function (fk, fi) {
          put(fk, fingerDefs[fi * 2] || fingerDefs[fingerDefs.length - 1]);
          /* đốt 2 của ngón: con duy nhất của đốt 1 */
          var second = boneChildren(fk).filter(function (k) { return !usedSrc[k.name]; })[0];
          if (second) {
            var base = fingerDefs[fi * 2];
            var secondName = base ? base.replace(/1$/, '2') : null;
            if (secondName && secondName !== base && fingerDefs.indexOf(secondName) >= 0) put(second, secondName);
          }
        });
      });
    }
    /* --- Chân: nhánh con còn lại của Hips, trái/phải theo X --- */
    var legRoots = boneChildren(hips).filter(function (k) { return !usedSrc[k.name]; });
    legRoots.sort(function (a, b2) { return positions[a.name].x - positions[b2.name].x; });
    var legDefs = [
      ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'],
      ['RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase']
    ];
    legRoots.slice(0, 2).forEach(function (upLeg, idx) {
      var defs = legDefs[idx];
      var node = upLeg;
      put(node, defs[0]);
      for (var j = 1; j < defs.length; j++) {
        var next = boneChildren(node).filter(function (k) { return !usedSrc[k.name]; });
        if (!next.length) break;
        next.sort(function (a, b2) { return positions[a.name].y - positions[b2.name].y; });
        node = next[0];
        put(node, defs[j]);
      }
    });
    result.unmapped = bones.filter(function (b) { return !usedSrc[b.name]; }).map(function (b) { return b.name; });
    result.extra = result.unmapped.slice();
    result.mappedCount = result.mapped.length;
    result.coverage = result.mappedCount / DST_NAMES.length * 100;
    result.headBone = head ? head.name : null;
    return result;
  }
  QuickRig.guessMapByPosition = guessMapByPosition;

  function findMappedBone(mapResult, dst) {
    for (var i = 0; i < mapResult.mapped.length; i++) {
      if (mapResult.mapped[i].dst === dst) return mapResult.mapped[i].bone || null;
    }
    return null;
  }

  /* mapBones: tên trước; thiếu thì đoán theo vị trí để bù. */
  function mapBones(skeleton) {
    var byName = mapBonesByName(skeleton);
    if (byName.mappedCount >= DST_NAMES.length) { QuickRig.lastMap = byName; return byName; }
    var guessed = guessMapByPosition(skeleton);
    var usedDst = {};
    byName.mapped.forEach(function (m) { usedDst[m.dst] = true; });
    var usedSrcByName = {};
    byName.mapped.forEach(function (m) { usedSrcByName[m.src] = true; });
    var merged = {
      mapped: byName.mapped.slice(), unmapped: [], extra: [],
      missing: [], coverage: 0, mappedCount: 0, total: DST_NAMES.length,
      method: byName.mappedCount > 0 ? 'name+position' : 'position', bones: byName.bones
    };
    guessed.mapped.forEach(function (g) {
      /* Chỉ lấp dst thiếu bằng xương nguồn CHƯA map theo tên — không
         được "đoạt" xương đã khớp tên (vd Index1 đã map theo tên thì
         không đoán lại thành Thumb1 để lấp chỗ Thumb1 thiếu). */
      if (!usedDst[g.dst] && !usedSrcByName[g.src]) {
        usedDst[g.dst] = true;
        merged.mapped.push(g);
      }
    });
    var usedSrc = {};
    merged.mapped.forEach(function (m) { usedSrc[m.src] = true; });
    merged.unmapped = byName.bones.filter(function (b) { return !usedSrc[b.name]; }).map(function (b) { return b.name; });
    merged.extra = merged.unmapped.slice();
    merged.missing = DST_NAMES.filter(function (d) { return !usedDst[d]; });
    merged.mappedCount = merged.mapped.length;
    merged.coverage = merged.mappedCount / DST_NAMES.length * 100;
    merged.guessedCount = merged.mapped.filter(function (m) { return m.guessed; }).length;
    /* --- AUTO KHỚP (js/rig/arp-automatch.js): lấp xương đích còn thiếu
       bằng khớp mờ / hierarchy / gộp ngón / xương cha. Chỉ lấp dst
       thiếu, không ghi đè entry name/position nào; xương nguồn đã
       dùng bị loại khỏi ứng viên (xem applyToMap). Nếu module chưa
       load thì map giữ nguyên như cũ — không crash. --- */
    merged.autoMatchedCount = 0;
    merged.unresolved = [];
    try {
      var AM = window.PixiStudio && PixiStudio.ArpAutoMatch;
      if (AM && typeof AM.applyToMap === 'function' && merged.missing.length) {
        var amRes = AM.applyToMap(merged, skeleton);
        merged.autoMatchedCount = amRes.autoMatchedCount || 0;
        merged.unresolved = amRes.unresolved || [];
      }
    } catch (e) { merged.autoMatchError = e && e.message; }
    QuickRig.lastMap = merged;
    return merged;
  }
  QuickRig.mapBones = mapBones;
  QuickRig.mapBonesByName = mapBonesByName;

  /* Sửa map thủ công: đổi xương nguồn của 1 xương đích chuẩn. */
  function setManualMap(dst, srcName) {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig — convert một model đã rig trước.' };
    dst = stripName(dst);
    if (DST_NAMES.indexOf(dst) < 0) return { ok: false, error: 'Tên đích không chuẩn: ' + dst };
    var bone = null;
    if (srcName) {
      bone = findBone(cur.allBones, srcName);
      if (!bone) return { ok: false, error: 'Không tìm thấy xương nguồn: ' + srcName };
    }
    var entry = null;
    for (var i = 0; i < cur.map.mapped.length; i++) {
      if (cur.map.mapped[i].dst === dst) { entry = cur.map.mapped[i]; break; }
    }
    if (bone) {
      /* Nếu dst đã map đúng xương này (vd entry tự khớp gộp ngón đã
         dùng chung xương Index1) thì chỉ đổi method → 'manual', KHÔNG
         gỡ gì thêm. */
      var alreadySameSrc = !!(entry && entry.src === bone.name);
      if (!alreadySameSrc) {
        /* gỡ src khỏi dst cũ nếu có — TRỪ entry "chủ" của xương đó
           (entry khớp theo tên mà tên đích trùng tên xương nguồn, vd
           LeftHandIndex1 → mixamorig:LeftHandIndex1): xương tự khớp
           dùng CHUNG xương chủ thì không được đoạt xương của chủ. */
        for (var j = 0; j < cur.map.mapped.length; j++) {
          var other = cur.map.mapped[j];
          if (other.src === bone.name && other.dst !== dst) {
            if (other.method === 'name' && normName(other.dst) === normName(bone.name)) continue;
            cur.map.mapped.splice(j, 1); break;
          }
        }
      }
      if (entry) { entry.src = bone.name; entry.bone = bone; entry.method = 'manual'; entry.guessed = false; entry.shared = false; delete entry.mergedFrom; delete entry.viaParent; }
      else cur.map.mapped.push({ src: bone.name, dst: dst, method: 'manual', bone: bone });
      cur.bones[dst] = bone;
    } else {
      if (entry) cur.map.mapped.splice(cur.map.mapped.indexOf(entry), 1);
      delete cur.bones[dst];
    }
    var usedSrc = {};
    cur.map.mapped.forEach(function (m) { usedSrc[m.src] = true; });
    cur.map.unmapped = cur.allBones.filter(function (b) { return !usedSrc[b.name]; }).map(function (b) { return b.name; });
    cur.map.extra = cur.map.unmapped.slice();
    cur.map.missing = DST_NAMES.filter(function (d) { return !cur.bones[d]; });
    cur.map.mappedCount = cur.map.mapped.length;
    cur.map.coverage = cur.map.mappedCount / DST_NAMES.length * 100;
    cur.manualOverrides = cur.manualOverrides || {};
    cur.manualOverrides[dst] = srcName || null;
    /* đồng bộ lại control của xương vừa đổi */
    if (bone && cur.controls[dst]) {
      try {
        var wp = new window.THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
        cur.controls[dst].position.copy(cur.controlGroup.worldToLocal(wp.clone()));
      } catch (e) {}
    }
    QuickRig.lastMap = cur.map;
    try { bus.emit('arpquickrig:map-changed', { dst: dst, src: srcName || null, coverage: cur.map.coverage }); } catch (e) {}
    return { ok: true, dst: dst, src: srcName || null, coverage: cur.map.coverage, mappedCount: cur.map.mappedCount };
  }
  QuickRig.setManualMap = setManualMap;
  QuickRig.getMap = function () { return QuickRig.current ? QuickRig.current.map : QuickRig.lastMap; };
  QuickRig.getMapEntry = function (dst) {
    var map = QuickRig.getMap();
    if (!map) return null;
    for (var i = 0; i < map.mapped.length; i++) if (map.mapped[i].dst === stripName(dst)) return map.mapped[i];
    return null;
  };

  /* ============================================================
     IK 2-BONE ANALYTIC — pure function (chỉ cần THREE.Vector3 /
     Quaternion). Cho root/mid/end hiện tại + target + pole →
     quaternion delta (world) cho root và mid, vị trí khuỷu/gối.
     computeTwoBoneAngles(a, b, d): góc (radian) ở root và ở mid,
     pure number, không cần THREE.
     ============================================================ */
  function computeTwoBoneAngles(a, b, d) {
    a = Math.max(1e-6, a); b = Math.max(1e-6, b);
    d = clamp(d, Math.abs(a - b) + 1e-4, a + b - 1e-4);
    var cosRoot = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    var cosMid = clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1);
    return { rootAngle: Math.acos(cosRoot), midAngle: Math.acos(cosMid), clampedDistance: d };
  }
  QuickRig.computeTwoBoneAngles = computeTwoBoneAngles;

  function solveTwoBoneIK(rootPos, midPos, endPos, targetPos, polePos) {
    var T = window.THREE;
    var root = rootPos.clone(), mid = midPos.clone(), end = endPos.clone();
    var target = targetPos.clone(), pole = polePos ? polePos.clone() : null;
    var a = root.distanceTo(mid), b = mid.distanceTo(end);
    var dRaw = root.distanceTo(target);
    var d = clamp(dRaw, Math.abs(a - b) + 1e-4, a + b - 1e-4);
    var dirT = dRaw > 1e-6 ? target.clone().sub(root).normalize()
      : mid.clone().sub(root).normalize();
    var targetClamped = root.clone().add(dirT.clone().multiplyScalar(d));
    /* Mặt phẳng gập: pháp tuyến = dirT × (pole - root); fallback +Z */
    var n = new T.Vector3(0, 0, 1);
    if (pole) {
      var poleDir = pole.clone().sub(root);
      n = new T.Vector3().crossVectors(dirT, poleDir);
      if (n.lengthSq() < 1e-8) n = new T.Vector3().crossVectors(dirT, new T.Vector3(0, 0, 1));
      if (n.lengthSq() < 1e-8) n = new T.Vector3().crossVectors(dirT, new T.Vector3(0, 1, 0));
    }
    n.normalize();
    var angles = computeTwoBoneAngles(a, b, d);
    /* Khuỷu: xoay dirT quanh n một góc rootAngle, chọn phía gần pole */
    var qPlus = new T.Quaternion().setFromAxisAngle(n, angles.rootAngle);
    var qMinus = new T.Quaternion().setFromAxisAngle(n, -angles.rootAngle);
    var dirPlus = dirT.clone().applyQuaternion(qPlus);
    var dirMinus = dirT.clone().applyQuaternion(qMinus);
    var elbowDir = dirPlus;
    if (pole) {
      var poleDirN = pole.clone().sub(root).normalize();
      if (dirMinus.dot(poleDirN) > dirPlus.dot(poleDirN)) elbowDir = dirMinus;
    }
    var elbowPos = root.clone().add(elbowDir.clone().multiplyScalar(a));
    var foreDir = targetClamped.clone().sub(elbowPos).normalize();
    var u0 = mid.clone().sub(root).normalize();
    var v0 = end.clone().sub(mid).normalize();
    var rootQuat = new T.Quaternion().setFromUnitVectors(u0, elbowDir.clone().normalize());
    var v0AfterRoot = v0.clone().applyQuaternion(rootQuat);
    var midQuat = new T.Quaternion().setFromUnitVectors(v0AfterRoot, foreDir);
    return {
      rootQuaternion: rootQuat, midQuaternion: midQuat,
      elbowPosition: elbowPos, targetClamped: targetClamped,
      reached: dRaw <= a + b + 1e-6, distance: dRaw,
      upperLength: a, foreLength: b, angles: angles
    };
  }
  QuickRig.solveTwoBoneIK = solveTwoBoneIK;

  /* Áp delta quaternion world → bone local (cha có thể đã xoay). */
  function applyWorldDelta(bone, worldDelta) {
    if (!bone || !bone.parent) { bone.quaternion.premultiply(worldDelta); return; }
    var parentWorldQ = new window.THREE.Quaternion();
    try { bone.parent.getWorldQuaternion(parentWorldQ); } catch (e) { parentWorldQ.identity(); }
    var localDelta = parentWorldQ.clone().invert().multiply(worldDelta).multiply(parentWorldQ);
    bone.quaternion.premultiply(localDelta);
  }

  function worldPosOf(obj) {
    return new window.THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
  }

  /* ---------- Storage (localStorage, fallback bộ nhớ) ---------- */
  var memStore = {};
  function getStorage() {
    try {
      if (window.localStorage) return window.localStorage;
    } catch (e) {}
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (e) {}
    return {
      getItem: function (k) { return memStore[k] || null; },
      setItem: function (k, v) { memStore[k] = String(v); },
      removeItem: function (k) { delete memStore[k]; }
    };
  }

  /* ============================================================
     CONVERT TO CONTROL RIG — model đã rig → control rig.
     (a) map xương; (b) tạo control helpers; (c) GIỮ NGUYÊN skin +
     clip (chỉ đếm để báo cáo, không bind lại); (d) đăng ký vào
     RigAutoGen.current nếu có (đúng shape của RigAutoGen.generate:
     {name, preset, rootBone, root, bones, helper, mixer, target,
     boneCount}) + PixiStudio.Rig.current; nếu RigAutoGen không có
     hoặc shape không khớp thì chỉ lưu ArpQuickRig.current và báo rõ.
     ============================================================ */
  function convertToControlRig(target, opts) {
    opts = opts || {};
    var level = opts.level === 'fast' ? 'fast' : 'full';
    var fkList = level === 'fast' ? FK_BONES_FAST : FK_BONES;
    var includePoles = opts.includePoles !== undefined ? !!opts.includePoles : (level === 'full');
    target = target || getTarget();
    var result = { ok: false, mappedCount: 0, unmapped: [], coverage: 0, controls: 0, poles: 0,
      skinnedMeshes: 0, clipsKept: 0, registeredRigAutoGen: false, errors: [] };
    if (!target || !target.traverse) {
      result.errors.push('Chưa có model nào để convert.');
      notify('warning', 'Quick Rig', 'Chưa có model nào để convert. Load model đã rig trước.');
      return result;
    }
    if (!window.THREE) { result.errors.push('THREE chưa sẵn sàng.'); return result; }
    var allBones = collectBones(target);
    if (!allBones.length) {
      result.errors.push('Model chưa có skeleton — Quick Rig chỉ nhận model ĐÃ rig (FBX/GLB rigged).');
      notify('warning', 'Quick Rig', 'Model chưa có skeleton. Dùng Auto Rig Pro Blend để rig model chưa rig trước.');
      return result;
    }
    /* snapshot skin + clip GỐC để chứng minh còn nguyên sau convert */
    var skinnedBefore = 0, skinSumBefore = 0, skinVerts = 0;
    target.traverse(function (o) {
      if (o.isSkinnedMesh) {
        skinnedBefore++;
        var w = o.geometry.attributes.skinWeight;
        if (w) for (var i = 0; i < w.count; i++) { skinSumBefore += w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i); skinVerts++; }
      }
    });
    var clipsBefore = (target.animations && target.animations.length) || 0;
    if (!clipsBefore && target.userData && target.userData.clips) clipsBefore = target.userData.clips.length;

    var map = mapBones(target);
    var bonesByDst = {};
    map.mapped.forEach(function (m) { if (m.bone) bonesByDst[m.dst] = m.bone; });
    if (!bonesByDst.Hips) {
      result.errors.push('Không xác định được Hips — skeleton quá lạ, map thủ công cũng không cứu được.');
      notify('error', 'Quick Rig', 'Không tìm được xương Hips. Thử map thủ công trong bảng map.');
      result.map = map;
      return result;
    }
    target.updateMatrixWorld(true);
    /* gỡ control rig cũ trên cùng model (nếu có) */
    clearControlRig(target, true);

    /* --- control group + helpers --- */
    var group = new window.THREE.Group();
    group.name = '__arp_ctrl_rig__';
    target.add(group);
    target.updateMatrixWorld(true);
    var H = 1.8;
    try {
      var box = new window.THREE.Box3().setFromObject(target);
      var s = box.getSize(new window.THREE.Vector3());
      if (s.y > 0.01) H = s.y;
    } catch (e) {}
    var controls = {}, poles = {};
    var sphereR = Math.max(0.015, H * 0.018);
    var mkCtrl = function (dst, color) {
      var bone = bonesByDst[dst];
      if (!bone) return null;
      var o = new window.THREE.Object3D();
      o.name = '__arp_ctrl_' + dst;
      var wp = worldPosOf(bone);
      o.position.copy(group.worldToLocal(wp.clone()));
      try { bone.getWorldQuaternion(o.quaternion); } catch (e) {}
      var mesh = null;
      try {
        mesh = new window.THREE.Mesh(
          new window.THREE.SphereGeometry(sphereR, 12, 10),
          new window.THREE.MeshBasicMaterial({ color: color || 0x33ccff, transparent: true, opacity: 0.85, depthTest: false }));
        mesh.name = '__arp_ctrl_mesh_' + dst;
        mesh.userData.isControlVisual = true;
        /* Quy ước repo: mesh trang trí PHẢI có isBoneVisual để FBXBinary.write /
           GLBWriter bỏ qua — nếu không file FBX export sau Auto Gen sẽ chứa
           thêm 18 mesh cầu control + 4 mesh pole (đã đo: report.meshes 23
           thay vì 1). Xem test-arp-vp-export-clean.js. */
        mesh.userData.isBoneVisual = true;
        o.add(mesh);
      } catch (e) {}
      o.userData.dstBone = dst;
      o.userData.isArpControl = true;
      group.add(o);
      controls[dst] = o;
      return o;
    };
    FK_BONES.forEach(function (dst) {
      if (fkList.indexOf(dst) < 0) return;
      var color = (dst === 'LeftHand' || dst === 'RightHand' || dst === 'LeftFoot' || dst === 'RightFoot') ? 0xffaa00 : 0x33ccff;
      mkCtrl(dst, color);
    });
    /* --- pole targets: khuỷu tay / đầu gối (chỉ mức Đầy đủ) --- */
    var mkPole = function (limbKey) {
      var limb = LIMBS[limbKey];
      var midBone = bonesByDst[limb.mid], rootBone = bonesByDst[limb.root], endBone = bonesByDst[limb.end];
      if (!midBone || !rootBone || !endBone) return null;
      var midW = worldPosOf(midBone), rootW = worldPosOf(rootBone), endW = worldPosOf(endBone);
      /* hướng gập = mid - midpoint(root,end), đẩy ra xa thân */
      var midPoint = rootW.clone().add(endW).multiplyScalar(0.5);
      var bendDir = midW.clone().sub(midPoint);
      if (bendDir.lengthSq() < 1e-8) bendDir = new window.THREE.Vector3(0, 0, limb.kind === 'arm' ? -1 : 1);
      bendDir.normalize();
      var polePos = midW.clone().add(bendDir.multiplyScalar(Math.max(0.08, H * 0.12)));
      var o = new window.THREE.Object3D();
      o.name = '__arp_pole_' + limbKey;
      o.position.copy(group.worldToLocal(polePos));
      try {
        var pm = new window.THREE.Mesh(
          new window.THREE.SphereGeometry(sphereR * 0.7, 10, 8),
          new window.THREE.MeshBasicMaterial({ color: 0xff5599, transparent: true, opacity: 0.85, depthTest: false }));
        pm.name = '__arp_pole_mesh_' + limbKey;
        pm.userData.isControlVisual = true;
        pm.userData.isBoneVisual = true; /* xem ghi chú ở control mesh trên */
        o.add(pm);
      } catch (e) {}
      o.userData.isArpPole = true;
      o.userData.limb = limbKey;
      group.add(o);
      poles[limbKey] = o;
      return o;
    };
    if (includePoles) Object.keys(LIMBS).forEach(function (k) { mkPole(k); });
    target.updateMatrixWorld(true);

    var cur = {
      target: target, map: map, bones: bonesByDst, allBones: allBones,
      controlGroup: group, controls: controls, poles: poles,
      level: level,
      features: { fingers: level === 'full', footRoll: level === 'full', jaw: level === 'full', poles: includePoles },
      height: H, skinnedBefore: skinnedBefore,
      clipsKept: clipsBefore,
      limbModes: { LeftArm: 'IK', RightArm: 'IK', LeftLeg: 'IK', RightLeg: 'IK' },
      fkRotations: {},           /* dst -> {x,y,z} */
      fingerCurl: {},            /* 'Left'/'Right'/fingerName -> 0..1 */
      fingerCurlAll: 0,
      footRoll: { Left: 0, Right: 0 },
      spineRotations: {},
      headRotation: { x: 0, y: 0, z: 0 },
      neckRotation: { x: 0, y: 0, z: 0 },
      jawOpen: 0,
      manualOverrides: {},
      controlsVisible: true,
      createdAt: Date.now()
    };
    QuickRig.current = cur;
    result.ok = true;
    result.level = level;
    result.mappedCount = map.mappedCount;
    result.unmapped = map.unmapped;
    result.missing = map.missing;
    result.coverage = map.coverage;
    result.guessedCount = map.guessedCount || 0;
    result.autoMatchedCount = map.autoMatchedCount || 0;
    result.autoMatched = map.autoMatched || [];
    result.unresolved = map.unresolved || [];
    result.controls = Object.keys(controls).length;
    result.poles = Object.keys(poles).length;
    result.skinnedMeshes = skinnedBefore;
    result.clipsKept = clipsBefore;
    result.skinVerts = skinVerts;
    result.skinSumBefore = skinSumBefore;
    result.map = map;

    /* (d) đăng ký RigAutoGen.current nếu có thể */
    var registered = false, regNote = '';
    try {
      var RAG = window.PixiStudio && PixiStudio.RigAutoGen;
      if (RAG && typeof RAG === 'object') {
        var helper = null;
        try { helper = new window.THREE.SkeletonHelper(bonesByDst.Hips); } catch (e) {}
        var mixer = null;
        try { mixer = new window.THREE.AnimationMixer(bonesByDst.Hips); } catch (e) {}
        RAG.current = {
          name: 'QuickRig (Mixamo)',
          preset: 'Mixamo Compatible',
          rootBone: bonesByDst.Hips,
          root: group,
          bones: bonesByDst,
          helper: helper,
          mixer: mixer,
          target: target,
          boneCount: map.mappedCount,
          isQuickRig: true
        };
        registered = true;
        if (window.PixiStudio.Rig) {
          PixiStudio.Rig.current = {
            name: 'QuickRig', preset: 'Mixamo Compatible', bones: {},
            target: target, visualGroup: group, isAutoGen: false, isQuickRig: true
          };
          Object.keys(bonesByDst).forEach(function (n) {
            PixiStudio.Rig.current.bones[n] = { name: n, parentName: PARENT_OF[n] || null, children: [] };
          });
        }
      } else regNote = 'RigAutoGen không có trong studio lúc này';
    } catch (e) { regNote = 'Không đăng ký được RigAutoGen: ' + (e && e.message); }
    result.registeredRigAutoGen = registered;
    result.registrationNote = registered ? '' : regNote;

    notify('success', 'Quick Rig xong',
      map.mappedCount + '/41 xương map được (' + map.coverage.toFixed(0) + '%)' +
      (map.guessedCount ? ', ' + map.guessedCount + ' xương đoán theo vị trí' : '') +
      (map.autoMatchedCount ? ', ' + map.autoMatchedCount + ' xương tự khớp (xem bảng map)' : '') +
      (map.unresolved && map.unresolved.length ? ', ' + map.unresolved.length + ' xương không tự khớp được: ' + map.unresolved.map(function (u) { return u.dst; }).join(', ') : '') +
      ' · ' + Object.keys(controls).length + ' control · ' + Object.keys(poles).length + ' pole target' +
      ' · skin ' + skinnedBefore + ' mesh + ' + clipsBefore + ' clip gốc giữ nguyên' +
      (map.unmapped.length ? ' · không khớp: ' + map.unmapped.slice(0, 5).join(', ') + (map.unmapped.length > 5 ? '…' : '') : '') +
      (registered ? '' : ' · (chỉ lưu trong ArpQuickRig.current: ' + regNote + ')'), 12000);
    try { bus.emit('arpquickrig:converted', { ok: true, mapped: map.mappedCount, coverage: map.coverage, controls: result.controls, poles: result.poles, skinnedMeshes: skinnedBefore, clipsKept: clipsBefore }); } catch (e) {}
    try { bus.emit('arp:rig-complete', { source: 'quickrig-convert', target: target, rootBone: bonesByDst.Hips || null, boneCount: map.mappedCount, helper: helper || null }); } catch (e) {} /* PHẦN 1 Viewport: tự hiện skeleton sau khi rig */
    return result;
  }
  QuickRig.convertToControlRig = convertToControlRig;

  function getTarget() {
    if (window.PixiStudio && PixiStudio.State && PixiStudio.State.get) {
      try { var sel = PixiStudio.State.get('selection'); if (sel) return sel; } catch (e) {}
    }
    if (window.PixiStudio && PixiStudio.Viewport && PixiStudio.Viewport.getMainModel) {
      try { return PixiStudio.Viewport.getMainModel(); } catch (e) {}
    }
    return null;
  }
  QuickRig.getTarget = getTarget;

  function clearControlRig(target, silent) {
    target = target || (QuickRig.current && QuickRig.current.target);
    if (!target) return false;
    var removed = false;
    var kids = (target.children || []).slice();
    kids.forEach(function (c) {
      if (c.name === '__arp_ctrl_rig__') { target.remove(c); removed = true; }
    });
    if (QuickRig.current && QuickRig.current.target === target) QuickRig.current = null;
    try {
      var RAG = window.PixiStudio && PixiStudio.RigAutoGen;
      if (RAG && RAG.current && RAG.current.isQuickRig) RAG.current = null;
    } catch (e) {}
    if (!silent && removed) notify('info', 'Quick Rig', 'Đã gỡ control rig khỏi model.');
    return removed;
  }
  QuickRig.clearControlRig = clearControlRig;

  function toggleControls(visible) {
    var cur = QuickRig.current;
    if (!cur) return false;
    cur.controlsVisible = visible === undefined ? !cur.controlsVisible : !!visible;
    cur.controlGroup.visible = cur.controlsVisible;
    return cur.controlsVisible;
  }
  QuickRig.toggleControls = toggleControls;
  QuickRig.setControlsVisible = toggleControls;

  /* ============================================================
     IK / FK — từng chi
     ============================================================ */
  function getLimbMode(limb) { var cur = QuickRig.current; return cur ? cur.limbModes[limb] : null; }
  QuickRig.getLimbMode = getLimbMode;

  function setLimbMode(limb, mode) {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    if (!LIMBS[limb]) return { ok: false, error: 'Chi không hợp lệ: ' + limb };
    mode = String(mode).toUpperCase();
    if (mode !== 'IK' && mode !== 'FK') return { ok: false, error: 'Mode phải là IK hoặc FK.' };
    var prev = cur.limbModes[limb];
    cur.limbModes[limb] = mode;
    /* snap để không giật pose khi đổi chế độ */
    if (mode === 'IK') {
      var endCtrl = cur.controls[LIMBS[limb].end];
      var endBone = cur.bones[LIMBS[limb].end];
      if (endCtrl && endBone) {
        try { endCtrl.position.copy(cur.controlGroup.worldToLocal(worldPosOf(endBone))); } catch (e) {}
      }
    } else {
      var b = cur.bones[LIMBS[limb].root];
      if (b) cur.fkRotations[LIMBS[limb].root] = { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z };
    }
    try { bus.emit('arpquickrig:limb-mode', { limb: limb, mode: mode, prev: prev }); } catch (e) {}
    return { ok: true, limb: limb, mode: mode, prev: prev };
  }
  QuickRig.setLimbMode = setLimbMode;

  function updateLimb(limb) {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    var def = LIMBS[limb];
    if (!def) return { ok: false, error: 'Chi không hợp lệ: ' + limb };
    cur.target.updateMatrixWorld(true);
    if (cur.limbModes[limb] === 'IK') {
      var rootBone = cur.bones[def.root], midBone = cur.bones[def.mid], endBone = cur.bones[def.end];
      var ctrl = cur.controls[def.end], pole = cur.poles[limb];
      if (!rootBone || !midBone || !endBone || !ctrl) return { ok: false, error: 'Thiếu xương/control cho ' + limb };
      var sol = solveTwoBoneIK(worldPosOf(rootBone), worldPosOf(midBone), worldPosOf(endBone),
        worldPosOf(ctrl), pole ? worldPosOf(pole) : null);
      applyWorldDelta(rootBone, sol.rootQuaternion);
      cur.target.updateMatrixWorld(true);
      applyWorldDelta(midBone, sol.midQuaternion);
      cur.target.updateMatrixWorld(true);
      return { ok: true, limb: limb, mode: 'IK', reached: sol.reached, distance: sol.distance, elbowPosition: sol.elbowPosition };
    }
    /* FK: áp rotation đã lưu của control xuống xương */
    [def.root, def.mid, def.end].forEach(function (dst) {
      var rot = cur.fkRotations[dst];
      var bone = cur.bones[dst];
      if (rot && bone) bone.rotation.set(rot.x, rot.y, rot.z);
    });
    cur.target.updateMatrixWorld(true);
    return { ok: true, limb: limb, mode: 'FK' };
  }
  QuickRig.updateLimb = updateLimb;
  QuickRig.updateAllLimbs = function () {
    var out = {};
    Object.keys(LIMBS).forEach(function (k) { out[k] = updateLimb(k); });
    return out;
  };

  /* Xoay FK trực tiếp 1 khớp (và đồng bộ control tương ứng). */
  function setFKRotation(dst, euler) {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    dst = stripName(dst);
    var bone = cur.bones[dst];
    if (!bone) return { ok: false, error: 'Không có xương ' + dst + ' trong map.' };
    var rot = { x: euler.x || 0, y: euler.y || 0, z: euler.z || 0 };
    bone.rotation.set(rot.x, rot.y, rot.z);
    cur.fkRotations[dst] = rot;
    if (cur.controls[dst]) cur.controls[dst].rotation.set(rot.x, rot.y, rot.z);
    cur.target.updateMatrixWorld(true);
    return { ok: true, bone: dst, rotation: rot };
  }
  QuickRig.setFKRotation = setFKRotation;
  QuickRig.rotateFKControl = setFKRotation;

  /* Di chuyển IK target (world) rồi giải IK ngay. */
  function moveIKTarget(dst, worldPos) {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    var ctrl = cur.controls[stripName(dst)];
    if (!ctrl) return { ok: false, error: 'Không có IK control ' + dst };
    cur.target.updateMatrixWorld(true);
    ctrl.position.copy(cur.controlGroup.worldToLocal(new window.THREE.Vector3(worldPos.x, worldPos.y, worldPos.z)));
    cur.target.updateMatrixWorld(true);
    var limb = null;
    Object.keys(LIMBS).forEach(function (k) { if (LIMBS[k].end === stripName(dst)) limb = k; });
    if (limb && cur.limbModes[limb] === 'IK') return updateLimb(limb);
    return { ok: true, limb: limb, mode: limb ? cur.limbModes[limb] : null };
  }
  QuickRig.moveIKTarget = moveIKTarget;

  function setPolePosition(limb, worldPos) {
    var cur = QuickRig.current;
    if (!cur || !cur.poles[limb]) return { ok: false, error: 'Không có pole ' + limb };
    cur.target.updateMatrixWorld(true);
    cur.poles[limb].position.copy(cur.controlGroup.worldToLocal(new window.THREE.Vector3(worldPos.x, worldPos.y, worldPos.z)));
    cur.target.updateMatrixWorld(true);
    if (cur.limbModes[limb] === 'IK') return updateLimb(limb);
    return { ok: true, limb: limb };
  }
  QuickRig.setPolePosition = setPolePosition;

  /* ============================================================
     FINGER CURL — 1 ngón hoặc tất cả. curl 0..1 → xoay mỗi đốt
     ngón quanh X (gập vào lòng bàn tay). Trả về số xương đã xoay.
     ============================================================ */
  var FINGER_CHAINS = {
    Left: ['LeftHandThumb1', 'LeftHandThumb2', 'LeftHandIndex1', 'LeftHandIndex2',
      'LeftHandMiddle1', 'LeftHandMiddle2', 'LeftHandRing1', 'LeftHandRing2', 'LeftHandPinky1'],
    Right: ['RightHandThumb1', 'RightHandThumb2', 'RightHandIndex1', 'RightHandIndex2',
      'RightHandMiddle1', 'RightHandMiddle2', 'RightHandRing1', 'RightHandRing2', 'RightHandPinky1']
  };
  function fingerBonesFor(key) {
    var cur = QuickRig.current;
    if (!cur) return [];
    var names = [];
    if (key === 'all' || key === 'All') names = FINGER_CHAINS.Left.concat(FINGER_CHAINS.Right);
    else if (key === 'Left' || key === 'Right') names = FINGER_CHAINS[key];
    else {
      /* tên 1 ngón: vd 'LeftHandIndex' → cả 2 đốt; hoặc tên xương cụ thể */
      var base = stripName(key);
      DST_NAMES.forEach(function (d) {
        if (d.indexOf(base) === 0 && /Hand(Thumb|Index|Middle|Ring|Pinky)/.test(d)) names.push(d);
      });
      if (!names.length && cur.bones[base]) names = [base];
    }
    return names.map(function (n) { return { name: n, bone: cur.bones[n] }; }).filter(function (e) { return !!e.bone; });
  }
  function setFingerCurl(key, curl) {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    if (cur.features && cur.features.fingers === false) return { ok: false, error: 'Finger curl chỉ có ở mức Đầy đủ — bấm Rig lại với mức Đầy đủ.' };
    curl = clamp(Number(curl) || 0, 0, 1);
    var list = fingerBonesFor(key);
    if (!list.length) return { ok: false, error: 'Không tìm thấy ngón: ' + key };
    list.forEach(function (e) {
      var isSecond = /2$/.test(e.name);
      var ang = curl * (isSecond ? 1.1 : 0.8);
      e.bone.rotation.x = ang;
      cur.fkRotations[e.name] = { x: ang, y: 0, z: 0 };
    });
    if (key === 'all' || key === 'All') cur.fingerCurlAll = curl;
    else cur.fingerCurl[String(key)] = curl;
    cur.target.updateMatrixWorld(true);
    return { ok: true, key: String(key), curl: curl, bonesChanged: list.length };
  }
  QuickRig.setFingerCurl = setFingerCurl;
  QuickRig.getFingerCurl = function (key) {
    var cur = QuickRig.current;
    if (!cur) return 0;
    if (key === 'all') return cur.fingerCurlAll || 0;
    return cur.fingerCurl[String(key)] || 0;
  };

  /* ============================================================
     FOOT ROLL — gót → mũi chân. roll 0..1: Foot xoay -0.6*roll,
     ToeBase xoay -0.9*roll (quanh X, gót nhấc lên).
     ============================================================ */
  function setFootRoll(side, roll) {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    if (cur.features && cur.features.footRoll === false) return { ok: false, error: 'Foot roll chỉ có ở mức Đầy đủ — bấm Rig lại với mức Đầy đủ.' };
    side = (side === 'Right' || side === 'right') ? 'Right' : 'Left';
    roll = clamp(Number(roll) || 0, 0, 1);
    var changed = 0;
    var foot = cur.bones[side + 'Foot'], toe = cur.bones[side + 'ToeBase'];
    if (foot) { foot.rotation.x = -0.6 * roll; cur.fkRotations[side + 'Foot'] = { x: -0.6 * roll, y: 0, z: 0 }; changed++; }
    if (toe) { toe.rotation.x = -0.9 * roll; cur.fkRotations[side + 'ToeBase'] = { x: -0.9 * roll, y: 0, z: 0 }; changed++; }
    cur.footRoll[side] = roll;
    cur.target.updateMatrixWorld(true);
    return { ok: true, side: side, roll: roll, bonesChanged: changed };
  }
  QuickRig.setFootRoll = setFootRoll;
  QuickRig.getFootRoll = function (side) {
    var cur = QuickRig.current;
    return cur ? (cur.footRoll[side === 'Right' ? 'Right' : 'Left'] || 0) : 0;
  };

  /* ---------- Spine FK / Head / Neck ---------- */
  function setSpineRotation(dst, euler) {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    dst = stripName(dst);
    if (['Spine', 'Spine1', 'Spine2'].indexOf(dst) < 0) return { ok: false, error: 'Chỉ Spine/Spine1/Spine2, nhận: ' + dst };
    var r = setFKRotation(dst, euler);
    if (r.ok) cur.spineRotations[dst] = r.rotation;
    return r;
  }
  QuickRig.setSpineRotation = setSpineRotation;
  function setHeadRotation(euler) {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    var r = setFKRotation('Head', euler);
    if (r.ok) cur.headRotation = r.rotation;
    return r;
  }
  QuickRig.setHeadRotation = setHeadRotation;
  function setNeckRotation(euler) {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    var r = setFKRotation('Neck', euler);
    if (r.ok) cur.neckRotation = r.rotation;
    return r;
  }
  QuickRig.setNeckRotation = setNeckRotation;

  /* ---------- Jaw: có xương hàm thì control, không thì báo rõ ---------- */
  function findJawBone() {
    var cur = QuickRig.current;
    if (!cur) return null;
    for (var i = 0; i < cur.allBones.length; i++) {
      var n = stripName(cur.allBones[i].name).toLowerCase();
      if (n.indexOf('jaw') >= 0 || n === 'chin' || n.indexOf('mouth') >= 0) return cur.allBones[i];
    }
    return null;
  }
  QuickRig.findJawBone = findJawBone;
  QuickRig.hasJaw = function () { return !!findJawBone(); };
  function setJaw(open) {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    if (cur.features && cur.features.jaw === false) return { ok: false, error: 'Jaw chỉ có ở mức Đầy đủ — bấm Rig lại với mức Đầy đủ.', hasJaw: !!findJawBone() };
    var jaw = findJawBone();
    if (!jaw) return { ok: false, hasJaw: false, reason: 'không có xương hàm' };
    open = clamp(Number(open) || 0, 0, 1);
    jaw.rotation.x = 0.5 * open;
    cur.jawOpen = open;
    cur.target.updateMatrixWorld(true);
    return { ok: true, hasJaw: true, open: open, bone: jaw.name };
  }
  QuickRig.setJaw = setJaw;

  /* ============================================================
     MATCH TO SOURCE — đồng bộ mọi control về đúng tư thế skeleton
     gốc hiện tại (đọc world pos/rot của xương nguồn).
     ============================================================ */
  function matchToSource() {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    cur.target.updateMatrixWorld(true);
    var count = 0;
    Object.keys(cur.controls).forEach(function (dst) {
      var bone = cur.bones[dst], ctrl = cur.controls[dst];
      if (!bone || !ctrl) return;
      try {
        ctrl.position.copy(cur.controlGroup.worldToLocal(worldPosOf(bone)));
        bone.getWorldQuaternion(ctrl.quaternion);
        cur.fkRotations[dst] = { x: bone.rotation.x, y: bone.rotation.y, z: bone.rotation.z };
        count++;
      } catch (e) {}
    });
    Object.keys(cur.poles).forEach(function (limb) {
      var def = LIMBS[limb];
      var midBone = cur.bones[def.mid], rootBone = cur.bones[def.root], endBone = cur.bones[def.end];
      if (!midBone || !rootBone || !endBone) return;
      var midW = worldPosOf(midBone), rootW = worldPosOf(rootBone), endW = worldPosOf(endBone);
      var midPoint = rootW.clone().add(endW).multiplyScalar(0.5);
      var bendDir = midW.clone().sub(midPoint);
      if (bendDir.lengthSq() < 1e-8) bendDir = new window.THREE.Vector3(0, 0, def.kind === 'arm' ? -1 : 1);
      bendDir.normalize();
      cur.poles[limb].position.copy(cur.controlGroup.worldToLocal(
        midW.clone().add(bendDir.multiplyScalar(Math.max(0.08, cur.height * 0.12)))));
      count++;
    });
    cur.target.updateMatrixWorld(true);
    notify('info', 'Quick Rig', 'Đã đồng bộ ' + count + ' control về tư thế skeleton gốc.');
    return { ok: true, synced: count };
  }
  QuickRig.matchToSource = matchToSource;

  /* ============================================================
     BAKE TO SKELETON — ghi pose hiện tại của control xuống skeleton
     thật, rồi GIỮ NGUYÊN control (re-sync control về pose vừa bake
     bằng matchToSource, để chỉnh tiếp từ pose đó — control không bị
     reset về trung tính, bone giữ pose đã bake).
     ============================================================ */
  function bakeToSkeleton() {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    var baked = [];
    Object.keys(LIMBS).forEach(function (limb) {
      var r = updateLimb(limb);
      if (r.ok) baked.push(limb + ':' + cur.limbModes[limb]);
    });
    /* FK spine/head/neck/finger/foot đã ghi trực tiếp vào bone khi set,
       nhưng ghi lại từ state để chắc chắn */
    Object.keys(cur.fkRotations).forEach(function (dst) {
      var bone = cur.bones[dst];
      if (bone) {
        var rot = cur.fkRotations[dst];
        bone.rotation.set(rot.x, rot.y, rot.z);
        if (baked.indexOf(dst) < 0) baked.push(dst);
      }
    });
    cur.target.updateMatrixWorld(true);
    /* Giữ nguyên control: re-sync về pose vừa bake */
    var m = matchToSource();
    notify('success', 'Quick Rig — Bake xong',
      'Đã ghi pose control xuống skeleton (' + baked.length + ' mục). Control giữ nguyên vị trí, chỉnh tiếp từ pose này.');
    try { bus.emit('arpquickrig:baked', { baked: baked }); } catch (e) {}
    return { ok: true, baked: baked, controlsKeptInPlace: true, synced: m.synced || 0 };
  }
  QuickRig.bakeToSkeleton = bakeToSkeleton;

  /* ============================================================
     SAVE / LOAD PRESET — localStorage key pixistudio.arp-quickrig-preset
     Lưu: IK/FK từng chi, finger curl, foot roll, spine/head/neck/jaw,
     vị trí + rotation của control. Load khôi phục lại lên rig hiện tại.
     ============================================================ */
  function savePreset() {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig để lưu preset.' };
    var ctrlPos = {}, ctrlRot = {};
    Object.keys(cur.controls).forEach(function (dst) {
      var c = cur.controls[dst];
      ctrlPos[dst] = [c.position.x, c.position.y, c.position.z];
      ctrlRot[dst] = [c.rotation.x, c.rotation.y, c.rotation.z];
    });
    var polePos = {};
    Object.keys(cur.poles).forEach(function (k) {
      polePos[k] = [cur.poles[k].position.x, cur.poles[k].position.y, cur.poles[k].position.z];
    });
    var preset = {
      version: 1, savedAt: Date.now(),
      limbModes: Object.assign({}, cur.limbModes),
      fkRotations: JSON.parse(JSON.stringify(cur.fkRotations)),
      fingerCurl: Object.assign({}, cur.fingerCurl), fingerCurlAll: cur.fingerCurlAll,
      footRoll: Object.assign({}, cur.footRoll),
      spineRotations: Object.assign({}, cur.spineRotations),
      headRotation: Object.assign({}, cur.headRotation),
      neckRotation: Object.assign({}, cur.neckRotation),
      jawOpen: cur.jawOpen,
      controlPositions: ctrlPos, controlRotations: ctrlRot, polePositions: polePos,
      controlsVisible: cur.controlsVisible
    };
    try { getStorage().setItem(QuickRig.PRESET_KEY, JSON.stringify(preset)); } catch (e) {
      return { ok: false, error: 'Không ghi được localStorage: ' + (e && e.message) };
    }
    notify('success', 'Quick Rig', 'Đã lưu preset control rig.');
    return { ok: true, preset: preset };
  }
  QuickRig.savePreset = savePreset;

  function loadPreset() {
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig — convert model đã rig trước rồi mới Load preset.' };
    var raw = null;
    try { raw = getStorage().getItem(QuickRig.PRESET_KEY); } catch (e) {}
    if (!raw) return { ok: false, error: 'Chưa có preset nào đã lưu.' };
    var preset;
    try { preset = JSON.parse(raw); } catch (e) { return { ok: false, error: 'Preset lưu bị hỏng (JSON lỗi).' }; }
    if (preset.limbModes) Object.keys(preset.limbModes).forEach(function (k) { if (LIMBS[k]) cur.limbModes[k] = preset.limbModes[k]; });
    if (preset.fkRotations) cur.fkRotations = preset.fkRotations;
    if (preset.fingerCurl) cur.fingerCurl = preset.fingerCurl;
    if (preset.fingerCurlAll !== undefined) cur.fingerCurlAll = preset.fingerCurlAll;
    if (preset.footRoll) cur.footRoll = preset.footRoll;
    if (preset.spineRotations) cur.spineRotations = preset.spineRotations;
    if (preset.headRotation) cur.headRotation = preset.headRotation;
    if (preset.neckRotation) cur.neckRotation = preset.neckRotation;
    if (preset.jawOpen !== undefined) cur.jawOpen = preset.jawOpen;
    if (preset.controlPositions) Object.keys(preset.controlPositions).forEach(function (dst) {
      if (cur.controls[dst]) cur.controls[dst].position.set(preset.controlPositions[dst][0], preset.controlPositions[dst][1], preset.controlPositions[dst][2]);
    });
    if (preset.controlRotations) Object.keys(preset.controlRotations).forEach(function (dst) {
      if (cur.controls[dst]) cur.controls[dst].rotation.set(preset.controlRotations[dst][0], preset.controlRotations[dst][1], preset.controlRotations[dst][2]);
    });
    if (preset.polePositions) Object.keys(preset.polePositions).forEach(function (k) {
      if (cur.poles[k]) cur.poles[k].position.set(preset.polePositions[k][0], preset.polePositions[k][1], preset.polePositions[k][2]);
    });
    if (preset.controlsVisible !== undefined) { cur.controlsVisible = !!preset.controlsVisible; cur.controlGroup.visible = cur.controlsVisible; }
    /* áp lại pose từ state đã khôi phục */
    Object.keys(LIMBS).forEach(function (k) { updateLimb(k); });
    Object.keys(cur.fkRotations).forEach(function (dst) {
      var bone = cur.bones[dst];
      if (bone) { var r = cur.fkRotations[dst]; bone.rotation.set(r.x, r.y, r.z); }
    });
    cur.target.updateMatrixWorld(true);
    notify('success', 'Quick Rig', 'Đã khôi phục preset control rig.');
    return { ok: true, preset: preset };
  }
  QuickRig.loadPreset = loadPreset;

  /* ============================================================
     LOAD FILE RIGGED — FBX (FBXLoader) hoặc GLB (GLTFLoader).
     Trả Promise<{ object, kind, animations }> — object là root
     đã parse (chưa gắn vào scene; UI sẽ gắn + convert).
     ============================================================ */
  function loadRiggedFile(arrayBuffer, filename) {
    return new Promise(function (resolve, reject) {
      var name = String(filename || '').toLowerCase();
      try {
        if (/\.fbx$/.test(name)) {
          if (!window.THREE.FBXLoader) return reject(new Error('FBXLoader chưa load trong studio.'));
          var obj = new window.THREE.FBXLoader().parse(arrayBuffer, '');
          resolve({ object: obj, kind: 'fbx', animations: obj.animations || [] });
        } else if (/\.(glb|gltf)$/.test(name)) {
          if (!window.THREE.GLTFLoader) return reject(new Error('GLTFLoader chưa load trong studio.'));
          new window.THREE.GLTFLoader().parse(arrayBuffer, '', function (g) {
            resolve({ object: g.scene, kind: 'glb', animations: g.animations || [] });
          }, function (e) { reject(e || new Error('GLTFLoader parse lỗi.')); });
        } else reject(new Error('Chỉ nhận .fbx hoặc .glb rigged.'));
      } catch (e) { reject(e); }
    });
  }
  QuickRig.loadRiggedFile = loadRiggedFile;

  /* ============================================================
     AUTO GEN QUICK RIG — một chạm, nhanh.
     Pipeline (async, hủy được giữa chừng bằng cancelAutoGen):
       1. Phát hiện skeleton + đo tỉ lệ cơ thể (cao, chân y, số mesh/clip)
       2. Map xương về chuẩn mixamorig: 41 (tên + đoán vị trí/hierarchy)
       3. Sinh control (mức Nhanh: IK tay/chân + spine/head, 10 control,
          0 pole; mức Đầy đủ: 18 control + 4 pole + finger/foot roll/jaw)
       4. Mặc định IK cho CHÂN + FK cho TAY (hợp lý nhất cho preview:
          chân bám đất bằng IK, tay pose tự do bằng FK)
       5. Match control về đúng tư thế skeleton hiện tại
       6. (Đầy đủ) tự lưu preset vào localStorage
     Sau khi xong, control rig được đăng ký làm rig hiện tại qua
     RigAutoGen.current (convertToControlRig đã làm) để user bấm phát
     clip là xem được ngay; nếu RigAutoGen không có thì rig hiện tại
     là ArpQuickRig.current.
     GIỚI HẠN: Auto Gen là heuristic — skeleton lạ quá thì map sai,
     user sửa lại bằng bảng map thủ công trong tab Quick Rig.
     ============================================================ */
  QuickRig.autoGenState = null;

  function measureBody(target) {
    var bones = collectBones(target);
    var skinned = 0, meshes = 0;
    target.traverse(function (o) { if (o.isSkinnedMesh) skinned++; if (o.isMesh) meshes++; });
    var height = 0, groundY = 0;
    try {
      target.updateMatrixWorld(true);
      var box = new window.THREE.Box3().setFromObject(target);
      var s = box.getSize(new window.THREE.Vector3());
      height = s.y; groundY = box.min.y;
    } catch (e) {}
    var clips = (target.animations && target.animations.length) || 0;
    return { boneCount: bones.length, skinnedMeshes: skinned, meshes: meshes,
      height: height, groundY: groundY, clips: clips, hasSkeleton: bones.length > 0 };
  }
  QuickRig.measureBody = measureBody;

  function autoGenProgress(state, stepIdx, total, message) {
    state.step = stepIdx;
    state.total = total;
    state.percent = Math.round(stepIdx / total * 100);
    state.log.push(message);
    try { bus.emit('arpquickrig:autogen-progress', { step: stepIdx, total: total, percent: state.percent, message: message, level: state.level }); } catch (e) {}
    if (typeof QuickRig.onAutoGenProgress === 'function') {
      try { QuickRig.onAutoGenProgress({ step: stepIdx, total: total, percent: state.percent, message: message, level: state.level, log: state.log.slice() }); } catch (e) {}
    }
  }

  function autoGen(target, opts) {
    opts = opts || {};
    var level = opts.level === 'full' ? 'full' : 'fast';
    var state = {
      running: true, cancelRequested: false, cancelled: false,
      level: level, step: 0, total: 6, percent: 0, log: [],
      startedAt: Date.now(), elapsedMs: 0
    };
    QuickRig.autoGenState = state;
    var onProgress = opts.onProgress || null;
    var stepDelay = opts.stepDelayMs || 0;
    var wait = function () {
      return new Promise(function (res) { setTimeout(res, stepDelay); });
    };
    var cancelled = function () { return state.cancelRequested; };
    var abort = function (targetForCleanup) {
      state.cancelled = true;
      state.running = false;
      state.elapsedMs = Date.now() - state.startedAt;
      if (targetForCleanup) clearControlRig(targetForCleanup, true);
      else if (QuickRig.current) clearControlRig(QuickRig.current.target, true);
      QuickRig.current = null;
      state.log.push('Đã hủy Auto Gen — đã dọn control sinh dở.');
      notify('info', 'Auto Gen Quick Rig', 'Đã hủy — control sinh dở đã được gỡ, skeleton gốc còn nguyên.');
      try { bus.emit('arpquickrig:autogen-cancelled', { level: level, elapsedMs: state.elapsedMs }); } catch (e) {}
      return { ok: false, cancelled: true, level: level, elapsedMs: state.elapsedMs, log: state.log.slice() };
    };
    var reportProgress = function (stepIdx, message) {
      autoGenProgress(state, stepIdx, state.total, message);
      if (onProgress) { try { onProgress({ step: stepIdx, total: state.total, percent: state.percent, message: message, level: level, log: state.log.slice() }); } catch (e) {} }
    };
    return (async function () {
      target = target || getTarget();
      /* Bước 1 — phát hiện skeleton + đo tỉ lệ */
      await wait();
      if (cancelled()) return abort(target);
      reportProgress(1, 'Đang đo skeleton + tỉ lệ cơ thể…');
      if (!target || !target.traverse) {
        state.running = false;
        notify('warning', 'Auto Gen Quick Rig', 'Chưa có model nào để Auto Gen.');
        return { ok: false, level: level, errors: ['Chưa có model nào.'], log: state.log.slice() };
      }
      var body = measureBody(target);
      if (!body.hasSkeleton) {
        state.running = false;
        notify('warning', 'Auto Gen Quick Rig', 'Model chưa có skeleton — Auto Gen chỉ nhận model ĐÃ rig.');
        return { ok: false, level: level, errors: ['Model chưa có skeleton.'], body: body, log: state.log.slice() };
      }
      state.log.push('Skeleton: ' + body.boneCount + ' xương · cao ' + body.height.toFixed(2) + 'm · ' + body.skinnedMeshes + ' mesh skin · ' + body.clips + ' clip.');
      /* Bước 2 — map xương */
      await wait();
      if (cancelled()) return abort(target);
      reportProgress(2, 'Đang map xương về chuẩn mixamorig: 41…');
      var map = mapBones(target);
      /* Bước 3 — sinh control */
      await wait();
      if (cancelled()) return abort(target);
      reportProgress(3, 'Đang sinh control (' + (level === 'fast' ? 'Nhanh' : 'Đầy đủ') + ')…');
      var conv = convertToControlRig(target, { level: level });
      if (!conv.ok) {
        state.running = false;
        return { ok: false, level: level, errors: conv.errors || ['Convert thất bại.'], map: map, log: state.log.slice() };
      }
      /* Bước 4 — mặc định IK chân + FK tay */
      await wait();
      if (cancelled()) return abort(target);
      reportProgress(4, 'Đang đặt mặc định: IK cho chân, FK cho tay…');
      setLimbMode('LeftArm', 'FK');
      setLimbMode('RightArm', 'FK');
      setLimbMode('LeftLeg', 'IK');
      setLimbMode('RightLeg', 'IK');
      /* Bước 5 — match về tư thế hiện tại */
      await wait();
      if (cancelled()) return abort(target);
      reportProgress(5, 'Đang match control về tư thế skeleton hiện tại…');
      matchToSource();
      /* Bước 6 — (Đầy đủ) tự lưu preset */
      await wait();
      if (cancelled()) return abort(target);
      var presetSaved = false;
      if (level === 'full') {
        reportProgress(6, 'Đang lưu preset tự động…');
        var sv = savePreset();
        presetSaved = !!(sv && sv.ok);
      } else {
        reportProgress(6, 'Xong — mức Nhanh không lưu preset.');
      }
      state.running = false;
      state.elapsedMs = Date.now() - state.startedAt;
      var warnings = [];
      if (map.unmapped.length) warnings.push('Không khớp: ' + map.unmapped.join(', '));
      if (map.missing.length) warnings.push('Thiếu xương đích: ' + map.missing.join(', '));
      if (map.guessedCount) warnings.push(map.guessedCount + ' xương đoán theo vị trí — kiểm tra lại bảng map.');
      var result = {
        ok: true, level: level, mappedCount: map.mappedCount, total: map.total,
        coverage: map.coverage, guessedCount: map.guessedCount || 0,
        controls: conv.controls, poles: conv.poles,
        limbModes: { LeftArm: 'FK', RightArm: 'FK', LeftLeg: 'IK', RightLeg: 'IK' },
        elapsedMs: state.elapsedMs, warnings: warnings,
        registeredRigAutoGen: conv.registeredRigAutoGen,
        registrationNote: conv.registrationNote || '',
        presetSaved: presetSaved, body: body, map: map,
        log: state.log.slice()
      };
      state.log.push('Xong: ' + map.mappedCount + '/41 xương · ' + conv.controls + ' control · ' + conv.poles + ' pole · ' + state.elapsedMs + 'ms.');
      notify('success', 'Auto Gen Quick Rig xong (' + (level === 'fast' ? 'Nhanh' : 'Đầy đủ') + ')',
        map.mappedCount + '/41 xương (' + map.coverage.toFixed(0) + '%) · ' + conv.controls + ' control · ' + conv.poles + ' pole · ' +
        state.elapsedMs + 'ms · IK chân + FK tay' +
        (warnings.length ? ' — LƯU Ý: ' + warnings.join('; ') : ''), 12000);
      try { bus.emit('arpquickrig:autogen-done', result); } catch (e) {}
      try { bus.emit('arp:rig-complete', { source: 'quickrig-autogen', target: target, boneCount: map.mappedCount }); } catch (e) {} /* PHẦN 1 Viewport: tự hiện skeleton sau khi rig */
      return result;
    })();
  }
  QuickRig.autoGen = autoGen;

  function cancelAutoGen() {
    var state = QuickRig.autoGenState;
    if (!state || !state.running) return { ok: false, error: 'Không có Auto Gen nào đang chạy.' };
    state.cancelRequested = true;
    return { ok: true, message: 'Đã yêu cầu hủy Auto Gen — pipeline sẽ dừng ở bước tiếp theo.' };
  }
  QuickRig.cancelAutoGen = cancelAutoGen;

  /* ============================================================
     CHẾ ĐỘ MIXAMO FBX
     ============================================================ */
  var MIXAMO_PREFIX_RE = /^mixamorig:?/i;
  QuickRig.MIXAMO_PREFIX_RE = MIXAMO_PREFIX_RE;

  /* Đọc FBX version từ bytes thô: binary → u32 little-endian ở offset
     23 (sau magic 20B + 00 1a 00); ASCII → dòng "FBXVersion: 7300".
     Không đọc được → null ("không xác định", KHÔNG đoán). */
  function readFbxVersion(arrayBuffer) {
    if (!arrayBuffer) return null;
    try {
      var bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
      if (bytes.length >= 27) {
        var magic = '';
        for (var i = 0; i < 20; i++) magic += String.fromCharCode(bytes[i]);
        if (magic.indexOf('Kaydara FBX Binary') === 0) {
          var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          var v = dv.getUint32(23, true);
          if (v >= 7000 && v <= 8000) return v;
          return null;
        }
      }
      /* ASCII: chỉ đọc 64KB đầu cho nhanh */
      var head = '';
      var n = Math.min(bytes.length, 65536);
      for (var j = 0; j < n; j++) head += String.fromCharCode(bytes[j]);
      var m = head.match(/FBXVersion\s*:\s*(\d{4})/);
      if (m) return parseInt(m[1], 10);
    } catch (e) {}
    return null;
  }
  QuickRig.readFbxVersion = readFbxVersion;

  /* Thu thập clip từ mọi chỗ có thể: target.animations, userData.clips,
     và animations của con (FBXLoader hay để clip ở root, GLTF ở scene). */
  function collectClips(target) {
    var out = [], seen = {};
    var push = function (clips) {
      (clips || []).forEach(function (c) {
        if (c && c.tracks && c.name && !seen[c.name]) { seen[c.name] = true; out.push(c); }
      });
    };
    if (!target) return out;
    push(target.animations);
    if (target.userData) push(target.userData.clips);
    if (target.traverse) target.traverse(function (o) { if (o !== target) push(o.animations); });
    return out;
  }
  QuickRig.collectClips = collectClips;

  /* Ước lượng tư thế từ góc tay so với trục thân (Hips→Head):
     góc giữa vector Vai→Tay và hướng lên trên của thân.
     T-pose ≈ 90° (tay ngang), A-pose ≈ 110–160° (tay chếch xuống
     ~45°), tay buông ≈ >160°. Chỉ dùng khi đủ xương vai/tay/đầu. */
  function estimatePose(target, bonesByDst) {
    if (!window.THREE || !target || !target.traverse) return { pose: 'unknown', armAngleDeg: null, reason: 'không đo được tư thế (thiếu THREE/target)' };
    try { target.updateMatrixWorld(true); } catch (e) {}
    var byDst = bonesByDst || {};
    if (!byDst.Hips || !byDst.Head) {
      var bones = collectBones(target);
      ['Hips', 'Head', 'LeftShoulder', 'LeftHand', 'RightShoulder', 'RightHand'].forEach(function (dst) {
        if (!byDst[dst]) byDst[dst] = findBone(bones, dst);
      });
    }
    if (!byDst.Hips || !byDst.Head) return { pose: 'unknown', armAngleDeg: null, reason: 'thiếu Hips/Head nên không đo được trục thân' };
    var up = worldPosOf(byDst.Head).sub(worldPosOf(byDst.Hips));
    if (up.lengthSq() < 1e-8) return { pose: 'unknown', armAngleDeg: null, reason: 'Hips và Head trùng vị trí' };
    up.normalize();
    var angles = [];
    [['LeftShoulder', 'LeftHand'], ['RightShoulder', 'RightHand']].forEach(function (pair) {
      var sh = byDst[pair[0]], hand = byDst[pair[1]];
      if (!sh || !hand) return;
      var v = worldPosOf(hand).sub(worldPosOf(sh));
      if (v.lengthSq() < 1e-8) return;
      v.normalize();
      angles.push(Math.acos(clamp(v.dot(up), -1, 1)) * 180 / Math.PI);
    });
    if (!angles.length) return { pose: 'unknown', armAngleDeg: null, reason: 'thiếu xương vai/tay nên không đo được góc tay' };
    var avg = angles.reduce(function (a, b) { return a + b; }, 0) / angles.length;
    var pose = 'unknown';
    if (avg >= 70 && avg <= 110) pose = 'T-pose';
    else if (avg > 110 && avg <= 160) pose = 'A-pose';
    else if (avg > 160) pose = 'arms-down';
    return { pose: pose, armAngleDeg: +avg.toFixed(1), armAnglesDeg: angles.map(function (a) { return +a.toFixed(1); }) };
  }
  QuickRig.estimatePose = estimatePose;

  /* NHẬN DIỆN FILE MIXAMO — kiểm tra: prefix mixamorig: (regex
     /^mixamorig:?/i, chấp nhận có/không có ':'), số xương chuẩn
     Mixamo 41 (map theo tên), tư thế T/A-pose (góc tay), FBX version
     7300 (chỉ khi đọc được từ bytes — opts.arrayBuffer / fbxVersion;
     không đọc được thì version=null, "không xác định", không đoán).
     Trả về {isMixamo, boneCount, prefixCount, prefixRatio,
     mappedCount, nameCoverage, hasSkin, hasClips, clipNames, heightM,
     pose, armAngleDeg, version, versionKnown, reasons[]}. */
  function detectMixamo(target, opts) {
    opts = opts || {};
    var result = {
      isMixamo: false, boneCount: 0, prefixCount: 0, prefixRatio: 0,
      mappedCount: 0, nameCoverage: 0, hasSkin: false, hasClips: false,
      clipNames: [], heightM: 0, pose: 'unknown', armAngleDeg: null,
      version: null, versionKnown: false, reasons: []
    };
    if (!target || !target.traverse) {
      result.reasons.push('Không có model nào để nhận diện.');
      return result;
    }
    var bones = collectBones(target);
    result.boneCount = bones.length;
    if (!bones.length) {
      result.reasons.push('File này chưa có rig (0 xương — mesh-only): đây là file chưa rig, KHÔNG phải file Mixamo rigged. Hãy dùng tab Smart để rig, hoặc tải file rigged từ Mixamo.');
      result.hasSkeleton = false;
      return result;
    }
    result.hasSkeleton = true;
    bones.forEach(function (b) { if (MIXAMO_PREFIX_RE.test(b.name || '')) result.prefixCount++; });
    result.prefixRatio = result.boneCount ? result.prefixCount / result.boneCount : 0;
    var byName = mapBonesByName(target);
    result.mappedCount = byName.mappedCount;
    result.nameCoverage = byName.coverage / 100;
    result.missing = byName.missing.slice();
    var skinned = 0;
    target.traverse(function (o) { if (o.isSkinnedMesh) skinned++; });
    result.hasSkin = skinned > 0;
    result.skinnedMeshes = skinned;
    var clips = collectClips(target);
    result.hasClips = clips.length > 0;
    result.clipNames = clips.map(function (c) { return c.name; });
    try {
      target.updateMatrixWorld(true);
      var box = new window.THREE.Box3().setFromObject(target);
      var s = box.getSize(new window.THREE.Vector3());
      result.heightM = +s.y.toFixed(3);
    } catch (e) {}
    var bonesByDst = {};
    byName.mapped.forEach(function (m) { if (m.bone) bonesByDst[m.dst] = m.bone; });
    var poseInfo = estimatePose(target, bonesByDst);
    result.pose = poseInfo.pose;
    result.armAngleDeg = poseInfo.armAngleDeg;
    if (poseInfo.reason) result.poseReason = poseInfo.reason;
    /* FBX version: ưu tiên opts, rồi bytes, rồi version đã lưu lần trước */
    var ver = (typeof opts.fbxVersion === 'number') ? opts.fbxVersion : null;
    if (ver == null && opts.arrayBuffer) ver = readFbxVersion(opts.arrayBuffer);
    if (ver == null && QuickRig.lastMixamoVersion) ver = QuickRig.lastMixamoVersion;
    if (ver != null) {
      result.version = ver;
      result.versionKnown = true;
      QuickRig.lastMixamoVersion = ver;
    }
    /* --- kết luận --- */
    var reasons = result.reasons;
    if (result.prefixCount >= 10 && result.prefixRatio >= 0.5) reasons.push('Có ' + result.prefixCount + '/' + result.boneCount + ' xương mang prefix mixamorig: (' + Math.round(result.prefixRatio * 100) + '%).');
    else reasons.push('Chỉ ' + result.prefixCount + '/' + result.boneCount + ' xương mang prefix mixamorig: — tên xương lạ, không giống rig Mixamo chuẩn.');
    if (result.mappedCount >= 36) reasons.push('Khớp ' + result.mappedCount + '/41 xương chuẩn Mixamo theo tên.');
    else reasons.push('Chỉ khớp ' + result.mappedCount + '/41 xương chuẩn Mixamo theo tên — thiếu: ' + result.missing.slice(0, 8).join(', ') + (result.missing.length > 8 ? ' …' : ''));
    reasons.push(result.hasSkin ? 'Có skin (' + skinned + ' SkinnedMesh).' : 'Không có skin (mesh chưa bind xương).');
    reasons.push(result.hasClips ? 'Có ' + clips.length + ' clip: ' + result.clipNames.join(', ') + '.' : 'Không có clip animation nào trong file.');
    reasons.push(result.heightM ? 'Cao ' + result.heightM + 'm.' : 'Không đo được chiều cao.');
    if (result.pose === 'T-pose' || result.pose === 'A-pose') reasons.push('Tư thế ' + result.pose + ' (góc tay ' + result.armAngleDeg + '° so với trục thân) — đúng chuẩn Mixamo.');
    else reasons.push('Tư thế ' + result.pose + (result.armAngleDeg != null ? ' (góc tay ' + result.armAngleDeg + '°)' : '') + ' — không phải T/A-pose chuẩn Mixamo' + (poseInfo.reason ? ': ' + poseInfo.reason : '.'));
    if (result.versionKnown) reasons.push(result.version === 7300 ? 'FBX version 7300 (FBX 2013) — đúng chuẩn Mixamo.' : 'FBX version ' + result.version + ' — Mixamo chỉ nhận 7300 trở xuống, file này có thể bị Mixamo từ chối khi upload lại.');
    else reasons.push('FBX version: không xác định (không đọc được từ file — không đoán).');
    result.isMixamo = result.prefixCount >= 10 && result.prefixRatio >= 0.5 && result.nameCoverage >= 0.6;
    QuickRig.lastMixamoDetection = result;
    return result;
  }
  QuickRig.detectMixamo = detectMixamo;

  /* XƯƠNG GIẢ (PROXY) — điền xương chuẩn còn thiếu bằng THREE.Bone đặt
     tại vị trí ước lượng: nếu có cả cha lẫn con thật (vd thiếu Spine1
     mà có Spine + Spine2) thì đặt ở điểm giữa; nếu không thì đi tiếp
     theo hướng xương cha (hướng cha→ông, hoặc +Y local của cha) một
     đoạn theo loại xương. Tên 'mixamorig:<Tên>__proxy',
     userData.isProxy=true, userData.proxyFor=<Tên>. Proxy KHÔNG nằm
     trong skeleton.bones của SkinnedMesh nên KHÔNG có skin weight —
     chỉ là placeholder tư thế để control rig đủ 41 xương; báo rõ trong
     report + UI, đừng kỳ vọng nó biến dạng mesh. */
  function createProxyBones(target, missing, bonesByDst) {
    var out = { created: [], failed: [] };
    if (!target || !target.traverse || !window.THREE) return out;
    missing = missing || [];
    bonesByDst = bonesByDst || {};
    if (!Object.keys(bonesByDst).length) {
      var bones = collectBones(target);
      bones.forEach(function (b) {
        var d = stripName(b.name);
        if (DST_NAMES.indexOf(d) >= 0 && !bonesByDst[d]) bonesByDst[d] = b;
      });
    }
    var height = 1.8;
    try {
      target.updateMatrixWorld(true);
      var box = new window.THREE.Box3().setFromObject(target);
      var s = box.getSize(new window.THREE.Vector3());
      if (s.y > 0.01) height = s.y;
    } catch (e) {}
    var FINGER_LEN = 0.025 * height, SPINE_LEN = 0.06 * height, OTHER_LEN = 0.04 * height;
    missing.forEach(function (dst) {
      var parentName = PARENT_OF[dst];
      var parent = parentName ? bonesByDst[parentName] : null;
      if (!parent) { out.failed.push({ dst: dst, reason: 'không có xương cha ' + (parentName || '?') + ' để gắn proxy' }); return; }
      /* con thật của xương thiếu (để lấy điểm giữa): con theo chuẩn mà đã có trong map */
      var childDst = null;
      DST_NAMES.forEach(function (d) { if (PARENT_OF[d] === dst && bonesByDst[d]) childDst = d; });
      var child = childDst ? bonesByDst[childDst] : null;
      var parentW = worldPosOf(parent);
      var worldPos;
      if (child) {
        worldPos = parentW.clone().add(worldPosOf(child)).multiplyScalar(0.5);
      } else {
        var dir = null;
        var grand = parent.parent && parent.parent.isBone ? parent.parent : null;
        if (grand) {
          dir = parentW.clone().sub(worldPosOf(grand));
          if (dir.lengthSq() < 1e-8) dir = null; else dir.normalize();
        }
        if (!dir) {
          dir = new window.THREE.Vector3(0, 1, 0);
          try { parent.getWorldQuaternion(new window.THREE.Quaternion()); var q = new window.THREE.Quaternion(); parent.getWorldQuaternion(q); dir = new window.THREE.Vector3(0, 1, 0).applyQuaternion(q); } catch (e) {}
        }
        var len = /Hand(Thumb|Index|Middle|Ring|Pinky)/.test(dst) ? FINGER_LEN : (/Spine|Neck/.test(dst) ? SPINE_LEN : OTHER_LEN);
        /* ngón tay đi tiếp theo hướng cẳng tay→bàn tay, không phải +Y của bàn tay */
        if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(dst)) {
          var hand = bonesByDst[dst.indexOf('Left') === 0 ? 'LeftHand' : 'RightHand'];
          var fore = bonesByDst[dst.indexOf('Left') === 0 ? 'LeftForeArm' : 'RightForeArm'];
          if (hand && fore) {
            dir = worldPosOf(hand).sub(worldPosOf(fore));
            if (dir.lengthSq() > 1e-8) dir.normalize();
          }
        }
        worldPos = parentW.clone().add(dir.multiplyScalar(len));
      }
      var proxy = new window.THREE.Bone();
      proxy.name = 'mixamorig:' + dst + '__proxy';
      proxy.userData.isProxy = true;
      proxy.userData.proxyFor = dst;
      parent.add(proxy);
      try { proxy.position.copy(parent.worldToLocal(worldPos.clone())); } catch (e) { proxy.position.set(0, 0.05, 0); }
      target.updateMatrixWorld(true);
      bonesByDst[dst] = proxy;
      out.created.push({ dst: dst, name: proxy.name, parent: parentName, childUsed: childDst, isProxy: true });
    });
    return out;
  }
  QuickRig.createProxyBones = createProxyBones;

  /* CHUẨN HÓA TÊN VỀ MIXAMO — đổi tên xương về đúng
     'mixamorig:<Tên>' (đúng chính tả chuẩn, vd 'hips' → 'mixamorig:Hips',
     'Model:mixamorig:Spine' → 'mixamorig:Spine'), kèm đổi tên node trong
     track clip theo ('Hips.quaternion' → 'mixamorig:Hips.quaternion').
     Xương giả (__proxy) không đổi tên. Giữ nguyên skin/clip (chỉ đổi
     tên, không bind lại). Trả về {renamed:[{from,to,dst}], clipsRenamed, tracksRenamed}. */
  function normalizeMixamoNames(target) {
    var out = { renamed: [], clipsRenamed: 0, tracksRenamed: 0 };
    if (!target || !target.traverse) return out;
    var bones = collectBones(target);
    var renameMap = {}; /* stripped lower -> 'mixamorig:<Canonical>' */
    bones.forEach(function (b) {
      if (b.userData && b.userData.isProxy) return;
      var s = stripName(b.name);
      var canon = null;
      for (var i = 0; i < DST_NAMES.length; i++) {
        if (DST_NAMES[i].toLowerCase() === s.toLowerCase()) { canon = DST_NAMES[i]; break; }
      }
      if (!canon) return;
      var want = 'mixamorig:' + canon;
      renameMap[s.toLowerCase()] = want;
      if (b.name !== want) {
        out.renamed.push({ from: b.name, to: want, dst: canon });
        b.name = want;
      }
    });
    /* đổi tên node trong track clip theo cùng bảng */
    collectClips(target).forEach(function (clip) {
      var changed = false;
      clip.tracks.forEach(function (tr) {
        if (!tr || typeof tr.name !== 'string') return;
        var dot = tr.name.lastIndexOf('.');
        if (dot < 0) return;
        var node = tr.name.slice(0, dot), prop = tr.name.slice(dot + 1);
        var key = stripName(node).toLowerCase();
        if (renameMap[key]) {
          var newName = renameMap[key] + '.' + prop;
          if (newName !== tr.name) { tr.name = newName; out.tracksRenamed++; changed = true; }
        }
      });
      if (changed) out.clipsRenamed++;
    });
    return out;
  }
  QuickRig.normalizeMixamoNames = normalizeMixamoNames;

  function captureBindPose(bonesByDst) {
    var pose = {};
    Object.keys(bonesByDst).forEach(function (dst) {
      var b = bonesByDst[dst];
      if (b) pose[dst] = [b.rotation.x, b.rotation.y, b.rotation.z];
    });
    return pose;
  }
  function applyBindPose(bonesByDst, pose) {
    if (!pose) return 0;
    var n = 0;
    Object.keys(pose).forEach(function (dst) {
      var b = bonesByDst[dst];
      if (b) { b.rotation.set(pose[dst][0], pose[dst][1], pose[dst][2]); n++; }
    });
    return n;
  }

  /* AUTO GEN TỪ RIG MIXAMO — một nút bấm. Vì skeleton Mixamo đã chuẩn
     nên map thẳng 41 xương theo tên (KHÔNG đoán như skeleton lạ; nếu
     map thiếu thì điền proxy rồi báo, chỉ đoán vị trí khi tên lạ hẳn).
     Sinh đủ control mức Đầy đủ (18 control + 4 pole + finger + foot
     roll), mặc định IK chân + FK tay, match về đúng T-pose của Mixamo,
     gắn clip có sẵn trong file. opts: {mode:'keep'|'normalize',
     normalize:boolean, onProgress, stepDelayMs}.
     Trả về {ok, mode, detection, mappedCount, realMapped, proxyCount,
     proxies, renamed, controls, poles, clipNames, elapsedMs, ...}. */
  function autoGenMixamo(target, opts) {
    opts = opts || {};
    var mode = (opts.normalize === true || opts.mode === 'normalize') ? 'normalize' : 'keep';
    var t0 = Date.now();
    var state = { running: true, step: 0, total: 5, log: [] };
    var onProgress = opts.onProgress || null;
    var reportProgress = function (step, message) {
      state.step = step;
      state.log.push(message);
      if (onProgress) { try { onProgress({ step: step, total: state.total, percent: Math.round(step / state.total * 100), message: message, log: state.log.slice() }); } catch (e) {} }
      try { bus.emit('arpquickrig:mixamo-progress', { step: step, total: state.total, message: message, mode: mode }); } catch (e) {}
    };
    var finish = function (r) {
      state.running = false;
      r.elapsedMs = Date.now() - t0;
      r.log = state.log.slice();
      return r;
    };
    return (async function () {
      target = target || getTarget();
      if (!target || !target.traverse) {
        return finish({ ok: false, mode: mode, errors: ['Chưa có model nào để Auto Gen Mixamo.'] });
      }
      /* Bước 1 — nhận diện Mixamo */
      reportProgress(1, 'Đang nhận diện rig Mixamo…');
      var det = detectMixamo(target, opts);
      if (!det.hasSkeleton) {
        notify('error', 'Quick Rig — Mixamo', 'File này chưa có rig — hãy dùng tab Smart để rig, hoặc tải file rigged từ Mixamo.');
        return finish({ ok: false, mode: mode, detection: det, suggestSmartTab: true,
          errors: ['File này chưa có rig (mesh-only). Hãy dùng tab Smart để rig, hoặc tải file rigged từ Mixamo.'] });
      }
      /* Bước 2 — map thẳng theo tên; thiếu thì điền proxy */
      reportProgress(2, 'Đang map 41 xương Mixamo theo tên…');
      var map = mapBones(target);
      var bonesByDst = {};
      map.mapped.forEach(function (m) { if (m.bone) bonesByDst[m.dst] = m.bone; });
      var proxyRes = { created: [], failed: [] };
      if (map.missing.length) {
        proxyRes = createProxyBones(target, map.missing, bonesByDst);
        map = mapBones(target); /* proxy map được nhờ stripName bóc '__proxy' */
        bonesByDst = {};
        map.mapped.forEach(function (m) { if (m.bone) bonesByDst[m.dst] = m.bone; });
      }
      var realMapped = map.mapped.filter(function (m) { return !(m.bone && m.bone.userData && m.bone.userData.isProxy); }).length;
      /* Bước 3 — chuẩn hóa tên (chỉ mode normalize) */
      var nz = { renamed: [], clipsRenamed: 0, tracksRenamed: 0 };
      if (mode === 'normalize') {
        reportProgress(3, 'Đang chuẩn hóa tên xương về mixamorig:…');
        nz = normalizeMixamoNames(target);
        map = mapBones(target);
        bonesByDst = {};
        map.mapped.forEach(function (m) { if (m.bone) bonesByDst[m.dst] = m.bone; });
      } else {
        reportProgress(3, 'Giữ nguyên rig Mixamo gốc (không đổi tên xương)…');
      }
      if (!bonesByDst.Hips) {
        return finish({ ok: false, mode: mode, detection: det, map: map,
          errors: ['Không xác định được Hips — skeleton quá lạ, map thủ công cũng không cứu được.'] });
      }
      /* Bước 4 — sinh control mức Đầy đủ + chụp bind pose (T-pose) */
      reportProgress(4, 'Đang sinh control đầy đủ (IK tay/chân + pole + finger + foot roll)…');
      var conv = convertToControlRig(target, { level: 'full' });
      if (!conv.ok) {
        return finish({ ok: false, mode: mode, detection: det, map: map, errors: conv.errors || ['Convert thất bại.'] });
      }
      var cur = QuickRig.current;
      cur.mixamoMode = mode;
      cur.mixamoDetection = det;
      cur.mixamoBindPose = captureBindPose(cur.bones); /* tư thế lúc load = T/A-pose của Mixamo */
      cur.mixamoBindPoseIsTPose = (det.pose === 'T-pose' || det.pose === 'A-pose');
      cur.mixamoBindPoseName = det.pose;
      setLimbMode('LeftArm', 'FK');
      setLimbMode('RightArm', 'FK');
      setLimbMode('LeftLeg', 'IK');
      setLimbMode('RightLeg', 'IK');
      /* Bước 5 — match về T-pose + gắn clip có sẵn */
      reportProgress(5, 'Đang match control về T-pose Mixamo + gắn clip…');
      matchToSource();
      var clips = collectClips(target);
      var attached = { ok: false, attached: [] };
      if (clips.length) attached = attachMixamoClips(target, clips);
      var warnings = [];
      if (!det.isMixamo) warnings.push('File không khớp đủ dấu hiệu rig Mixamo chuẩn (' + det.reasons.join(' ') + ') — map bằng tên + đoán vị trí, độ chính xác thấp hơn rig chuẩn.');
      if (proxyRes.created.length) warnings.push('Đã tạo ' + proxyRes.created.length + ' xương giả (proxy, không có skin): ' + proxyRes.created.map(function (p) { return p.dst; }).join(', ') + '.');
      if (proxyRes.failed.length) warnings.push('Không tạo được proxy cho: ' + proxyRes.failed.map(function (f) { return f.dst + ' (' + f.reason + ')'; }).join(', ') + '.');
      if (mode === 'normalize' && nz.renamed.length) warnings.push('Đã đổi tên ' + nz.renamed.length + ' xương về mixamorig: + ' + nz.tracksRenamed + ' track clip.');
      if (det.pose !== 'T-pose' && det.pose !== 'A-pose') warnings.push('Tư thế lúc load là ' + det.pose + ' — bind pose đã chụp có thể không phải T-pose chuẩn, export "về T-pose" sẽ về đúng tư thế lúc load này.');
      var result = finish({
        ok: true, mode: mode, detection: det,
        mappedCount: map.mappedCount, realMapped: realMapped,
        proxyCount: proxyRes.created.length, proxies: proxyRes.created,
        proxyFailed: proxyRes.failed,
        renamed: nz.renamed, clipsRenamed: nz.clipsRenamed, tracksRenamed: nz.tracksRenamed,
        controls: conv.controls, poles: conv.poles,
        clipNames: clips.map(function (c) { return c.name; }),
        clipsAttached: attached.ok ? attached.attached : [],
        limbModes: { LeftArm: 'FK', RightArm: 'FK', LeftLeg: 'IK', RightLeg: 'IK' },
        warnings: warnings, map: map, registeredRigAutoGen: conv.registeredRigAutoGen
      });
      notify('success', 'Auto Gen Mixamo xong (' + (mode === 'normalize' ? 'chuẩn hóa' : 'giữ rig gốc') + ')',
        map.mappedCount + '/41 xương (' + realMapped + ' thật + ' + proxyRes.created.length + ' proxy) · ' +
        conv.controls + ' control · ' + conv.poles + ' pole · ' + result.elapsedMs + 'ms' +
        (clips.length ? ' · ' + clips.length + ' clip đã gắn' : ' · không có clip') +
        (warnings.length ? ' — LƯU Ý: ' + warnings.join(' ') : ''), 12000);
      try { bus.emit('arpquickrig:mixamo-done', result); } catch (e) {}
      try { bus.emit('arp:rig-complete', { source: 'quickrig-mixamo', target: target, boneCount: map.mappedCount }); } catch (e) {} /* PHẦN 1 Viewport: tự hiện skeleton sau khi rig */
      return result;
    })();
  }
  QuickRig.autoGenMixamo = autoGenMixamo;

  /* GẮN CLIP MIXAMO VÀO CONTROL RIG — clips: AnimationClip | {clip} |
     {animations:[...]} | mảng các dạng trên | tên clip (string, tra qua
     ArpRemap.listClips nếu có). Lưu vào rig.clips + mixer riêng của rig.
     Phát thử dùng MIXER CỦA RIG (không qua ArpRemap): clip Mixamo cùng
     skeleton với rig nên track bind thẳng, không cần remap. Muốn chạy
     clip lên rig khác tên xương thì dùng retargetMixamoClip. */
  function normalizeClipInput(clips) {
    var out = [];
    if (!clips) return out;
    var list = Array.isArray(clips) ? clips : [clips];
    list.forEach(function (c) {
      if (!c) return;
      if (c.tracks && c.name) out.push(c);
      else if (c.clip && c.clip.tracks) out.push(c.clip);
      else if (Array.isArray(c.animations)) c.animations.forEach(function (a) { if (a && a.tracks) out.push(a); });
      else if (typeof c === 'string') {
        try {
          var R = window.PixiStudio && PixiStudio.ArpRemap;
          if (R && typeof R.listClips === 'function') {
            R.listClips().forEach(function (e) { if ((e.id === c || e.name === c) && e.clip) out.push(e.clip); });
          }
        } catch (e) {}
      }
    });
    return out;
  }
  function attachMixamoClips(target, clips, opts) {
    opts = opts || {};
    /* overload: attachMixamoClips(clips) — target là clip */
    if (target && (target.tracks || Array.isArray(target) || (target && target.clip))) {
      clips = target;
      target = QuickRig.current ? QuickRig.current.target : getTarget();
    }
    var cur = QuickRig.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig — chạy Auto Gen Mixamo trước rồi mới gắn clip.' };
    target = target || cur.target;
    var list = normalizeClipInput(clips);
    if (!list.length) return { ok: false, error: 'Không có clip nào để gắn (clips rỗng hoặc sai dạng).' };
    cur.clips = cur.clips || [];
    cur.clipByName = cur.clipByName || {};
    var attached = [];
    list.forEach(function (clip) {
      var existing = cur.clipByName[clip.name];
      if (existing) {
        var idx = cur.clips.indexOf(existing);
        if (idx >= 0) cur.clips[idx] = clip;
      } else cur.clips.push(clip);
      cur.clipByName[clip.name] = clip;
      attached.push(clip.name);
    });
    if (!cur.clipMixer || cur.clipMixerRoot !== target) {
      try {
        cur.clipMixer = new window.THREE.AnimationMixer(target);
        cur.clipMixerRoot = target;
      } catch (e) { return { ok: false, error: 'Không tạo được AnimationMixer: ' + (e && e.message) }; }
    }
    cur.currentClipName = cur.currentClipName || attached[0];
    try { bus.emit('arpquickrig:mixamo-clips', { attached: attached, total: cur.clips.length }); } catch (e) {}
    return { ok: true, attached: attached, total: cur.clips.length, clipNames: cur.clips.map(function (c) { return c.name; }) };
  }
  QuickRig.attachMixamoClips = attachMixamoClips;
  QuickRig.getMixamoClips = function () {
    var cur = QuickRig.current;
    return cur && cur.clips ? cur.clips.map(function (c) { return { name: c.name, duration: c.duration, tracks: c.tracks.length }; }) : [];
  };

  function playMixamoClip(nameOrIndex, opts) {
    opts = opts || {};
    var cur = QuickRig.current;
    if (!cur || !cur.clips || !cur.clips.length) return { ok: false, error: 'Chưa có clip Mixamo nào đã gắn — chạy Auto Gen Mixamo hoặc attachMixamoClips trước.' };
    if (!cur.clipMixer) return { ok: false, error: 'Chưa có mixer — gắn clip lại bằng attachMixamoClips.' };
    var clip = null;
    if (typeof nameOrIndex === 'number') clip = cur.clips[nameOrIndex] || null;
    else if (typeof nameOrIndex === 'string') clip = cur.clipByName[nameOrIndex] || null;
    if (!clip) clip = cur.clips[0];
    if (!clip) return { ok: false, error: 'Không tìm thấy clip: ' + nameOrIndex };
    try {
      if (cur.clipAction) { try { cur.clipAction.stop(); } catch (e) {} }
      cur.clipAction = cur.clipMixer.clipAction(clip);
      cur.clipAction.reset();
      cur.clipAction.setLoop(opts.loop === false ? window.THREE.LoopOnce : window.THREE.LoopRepeat);
      cur.clipAction.clampWhenFinished = opts.loop === false;
      cur.clipAction.play();
      cur.currentClipName = clip.name;
      cur.clipPlaying = true;
    } catch (e) { return { ok: false, error: 'Không phát được clip: ' + (e && e.message) }; }
    try { bus.emit('arpquickrig:mixamo-play', { clip: clip.name, duration: clip.duration }); } catch (e) {}
    return { ok: true, clip: clip.name, duration: clip.duration, tracks: clip.tracks.length,
      method: 'rig-mixer',
      note: 'Phát bằng mixer của rig (clip Mixamo cùng skeleton — không cần remap). Muốn chạy clip lên rig khác tên xương thì dùng retargetMixamoClip.' };
  }
  QuickRig.playMixamoClip = playMixamoClip;

  function stopMixamoClip() {
    var cur = QuickRig.current;
    if (!cur || !cur.clipAction) return { ok: false, error: 'Không có clip nào đang phát.' };
    try { cur.clipAction.stop(); } catch (e) {}
    cur.clipPlaying = false;
    try { bus.emit('arpquickrig:mixamo-stop', { clip: cur.currentClipName }); } catch (e) {}
    return { ok: true, clip: cur.currentClipName };
  }
  QuickRig.stopMixamoClip = stopMixamoClip;

  /* Tick mixer của rig (studio gọi trong render loop; harness gọi tay). */
  function tickMixamo(dt) {
    var cur = QuickRig.current;
    if (!cur || !cur.clipMixer || !cur.clipPlaying) return { ok: false, playing: !!(cur && cur.clipPlaying) };
    try { cur.clipMixer.update(dt); } catch (e) { return { ok: false, error: e && e.message }; }
    return { ok: true, clip: cur.currentClipName, time: cur.clipAction ? cur.clipAction.time : 0 };
  }
  QuickRig.tickMixamo = tickMixamo;

  /* RETARGET CLIP MIXAMO — gọi ArpRemap.retargetClip có sẵn rồi phát
     thử bằng ArpRemap.previewRemapped. Chỉ cần khi clip chạy trên rig
     đích khác tên xương / khác tỉ lệ; clip Mixamo cùng skeleton thì
     playMixamoClip (mixer rig) là đủ. */
  function retargetMixamoClip(nameOrIndex, opts) {
    opts = opts || {};
    var cur = QuickRig.current;
    if (!cur || !cur.clips || !cur.clips.length) return { ok: false, error: 'Chưa có clip Mixamo nào đã gắn.' };
    var R = window.PixiStudio && PixiStudio.ArpRemap;
    if (!R || typeof R.retargetClip !== 'function') return { ok: false, error: 'ArpRemap chưa load trong studio — không retarget được.' };
    var clip = null;
    if (typeof nameOrIndex === 'number') clip = cur.clips[nameOrIndex] || null;
    else if (typeof nameOrIndex === 'string') clip = cur.clipByName[nameOrIndex] || null;
    if (!clip) clip = cur.clips[0];
    var res = R.retargetClip(clip, cur.target, opts);
    if (!res.ok) return { ok: false, compat: res.compat, missing: res.missing, reason: res.reason, method: 'arpremap' };
    var played = false;
    try { played = R.previewRemapped(res.clip, cur.target); } catch (e) {}
    cur.retargetedClip = res.clip;
    return { ok: true, clip: res.clip.name, sourceClip: clip.name, compat: res.compat,
      mapped: res.mapped, skipped: res.skipped, missing: res.missing,
      previewPlaying: !!played, method: 'arpremap' };
  }
  QuickRig.retargetMixamoClip = retargetMixamoClip;

  /* Chuyển sang tab Smart (khi file mesh-only) — qua ArpPanel nếu có. */
  function switchToSmartTab() {
    var P = window.PixiStudio && PixiStudio.ArpPanel;
    if (P && typeof P.showTab === 'function') {
      try { P.showTab('smart'); return { ok: true }; } catch (e) { return { ok: false, error: e && e.message }; }
    }
    return { ok: false, error: 'ArpPanel.showTab không có trong studio lúc này.' };
  }
  QuickRig.switchToSmartTab = switchToSmartTab;

  /* XUẤT LẠI FBX MIXAMO-COMPATIBLE — FBX RIGGED giữ skeleton.
     KHÁC preset Mixamo (mesh-only) của ArpExport: preset đó BỎ xương/
     skin (noSkeleton) để upload mixamo.com tự auto-rig; hàm này GIỮ
     nguyên skeleton + skin + tên mixamorig:, version 7300, để dùng ở
     Unity/Unreal hoặc tải lại Mixamo lấy animation mới.
     Trước khi xuất: đặt pose về bind pose (T/A-pose) đã chụp lúc Auto Gen
     Mixamo (cur.mixamoBindPose); không có bind pose thì xuất nguyên tư thế
     hiện tại và báo rõ. Control helpers (__arp_ctrl_rig__) được gỡ
     tạm khỏi target rồi gắn lại — không xuất control ra file.
     opts: {filename, clipName (1 clip) | includeClips (tất cả clip đã
     gắn) | animations, download (mặc định true nếu có U.downloadBlob)}.
     Dùng FBXBinary.write trực tiếp, KHÔNG qua preset Mixamo mesh-only. */
  function exportMixamoCompatible(target, opts) {
    opts = opts || {};
    target = target || (QuickRig.current && QuickRig.current.target) || getTarget();
    var result = { ok: false, version: 7300, versionName: 'FBX 2013', keepSkeleton: true };
    if (!target || !target.traverse) {
      result.error = 'Chưa có model nào để xuất.';
      return result;
    }
    var W = window.PixiStudio && PixiStudio.FBXBinary;
    if (!W || typeof W.write !== 'function') {
      result.error = 'FBXBinary chưa load — không xuất được FBX.';
      return result;
    }
    var cur = (QuickRig.current && QuickRig.current.target === target) ? QuickRig.current : null;
    /* --- animations: clip hiện tại nếu có, hoặc theo opts --- */
    var animEntries = [];
    if (Array.isArray(opts.animations)) animEntries = opts.animations;
    else if (cur && cur.clips && cur.clips.length) {
      if (opts.clipName) {
        var one = cur.clipByName[opts.clipName] || cur.clips[0];
        if (one) animEntries = [{ name: one.name, clip: one }];
      } else if (opts.includeClips === true) {
        animEntries = cur.clips.map(function (c) { return { name: c.name, clip: c }; });
      } else if (cur.currentClipName && cur.clipByName[cur.currentClipName]) {
        animEntries = [{ name: cur.currentClipName, clip: cur.clipByName[cur.currentClipName] }];
      }
    } else if (target.animations && target.animations.length) {
      animEntries = target.animations.map(function (c) { return { name: c.name, clip: c }; });
    }
    /* --- về T-pose: snapshot pose hiện tại, áp bind pose, xuất, khôi phục --- */
    var savedRotations = null, poseApplied = false, poseNote = '';
    if (cur && cur.bones) {
      savedRotations = {};
      Object.keys(cur.bones).forEach(function (dst) {
        var b = cur.bones[dst];
        if (b) savedRotations[dst] = [b.rotation.x, b.rotation.y, b.rotation.z];
      });
      if (cur.mixamoBindPose) {
        applyBindPose(cur.bones, cur.mixamoBindPose);
        poseApplied = true;
        poseNote = 'Đã đặt về ' + (cur.mixamoBindPoseName || 'bind pose') + ' đã chụp lúc Auto Gen Mixamo' +
          (cur.mixamoBindPoseIsTPose ? '.' : ' (không phải T/A-pose chuẩn).');
      } else {
        poseNote = 'Không có bind pose đã chụp (chưa chạy Auto Gen Mixamo) — xuất nguyên tư thế hiện tại.';
      }
      target.updateMatrixWorld(true);
    } else {
      poseNote = 'Chưa có control rig — xuất nguyên tư thế hiện tại.';
    }
    result.poseApplied = poseApplied;
    result.poseNote = poseNote;
    /* --- gỡ tạm control helpers khỏi target (không xuất control) --- */
    var group = cur ? cur.controlGroup : null;
    var hadGroup = !!(group && group.parent === target);
    if (hadGroup) target.remove(group);
    var res;
    try {
      res = W.write(target, {
        version: 7300, keepSkeleton: true, upAxis: 'Y', autoScale: true,
        embedTextures: true, animations: animEntries, fps: opts.fps || 30
      });
    } catch (e) {
      if (hadGroup) { try { target.add(group); } catch (e2) {} }
      if (savedRotations && cur) { applyBindPose(cur.bones, savedRotations); target.updateMatrixWorld(true); }
      result.error = 'FBXBinary.write lỗi: ' + (e && e.message || e);
      return result;
    } finally {
      if (hadGroup) { try { target.add(group); } catch (e) {} }
      if (savedRotations && cur) { applyBindPose(cur.bones, savedRotations); target.updateMatrixWorld(true); }
    }
    var boneNames = [];
    target.traverse(function (o) { if (o.isBone) boneNames.push(o.name); });
    var modelName = 'model';
    try {
      if (target.name && target.name !== 'Scene') modelName = target.name.replace(/[^A-Za-z0-9_-]+/g, '_');
      else if (target.userData && target.userData.name) modelName = String(target.userData.name).replace(/[^A-Za-z0-9_-]+/g, '_');
    } catch (e) {}
    var filename = opts.filename || (modelName + '_MixamoRigged.fbx');
    result.ok = true;
    result.bytes = res.bytes;
    result.byteLength = res.bytes.length;
    result.filename = filename;
    result.bones = boneNames.length;
    result.boneNames = boneNames;
    result.mixamoBoneNames = boneNames.filter(function (n) { return MIXAMO_PREFIX_RE.test(n); }).length;
    result.proxyBones = boneNames.filter(function (n) { return /__proxy$/i.test(n); }).length;
    result.animations = animEntries.map(function (a) { return a.name; });
    result.writerReport = res.report || null;
    result.writerVersion = res.report ? res.report.version : 7300;
    /* --- tải về (UI); harness dùng U.downloadBlob stub để bắt --- */
    if (opts.download !== false && U && typeof U.downloadBlob === 'function') {
      try {
        var blob = new Blob([res.bytes], { type: 'application/octet-stream' });
        U.downloadBlob(blob, filename);
        result.downloaded = true;
      } catch (e) { result.downloaded = false; result.downloadError = e && e.message; }
    }
    notify('success', 'Xuất FBX Mixamo-compatible xong',
      filename + ' · ' + res.bytes.length + ' B · FBX 7300 · ' + boneNames.length + ' xương (' + result.mixamoBoneNames + ' mixamorig:)' +
      (result.proxyBones ? ' · ' + result.proxyBones + ' proxy' : '') +
      (animEntries.length ? ' · ' + animEntries.length + ' clip: ' + result.animations.join(', ') : ' · không kèm clip') +
      ' · ' + poseNote, 12000);
    try { bus.emit('arpquickrig:mixamo-exported', { filename: filename, bytes: res.bytes.length, bones: boneNames.length, version: 7300 }); } catch (e) {}
    return result;
  }
  QuickRig.exportMixamoCompatible = exportMixamoCompatible;

  /* ---------- Báo cáo chi tiết map (cho UI + test) ---------- */
  QuickRig.buildMapReport = function (map) {
    map = map || QuickRig.lastMap;
    if (!map) return null;
    return {
      total: map.total, mappedCount: map.mappedCount, coverage: +map.coverage.toFixed(1),
      method: map.method, guessedCount: map.guessedCount || 0,
      autoMatchedCount: map.autoMatchedCount || 0,
      unresolved: (map.unresolved || []).slice(),
      mapped: map.mapped.map(function (m) { return { src: m.src, dst: m.dst, method: m.method, guessed: !!m.guessed, confidence: (typeof m.confidence === 'number' ? m.confidence : (m.method === 'name' ? 100 : null)), shared: !!m.shared, mergedFrom: m.mergedFrom || null, viaParent: m.viaParent || null }; }),
      unmapped: map.unmapped.slice(), extra: (map.extra || []).slice(), missing: map.missing.slice()
    };
  };

  /* Nhãn trạng thái 1 dòng map: 'map theo tên' / 'tự khớp (gộp ngón)
     50%' / 'KHÔNG KHỚP'... — dùng ArpAutoMatch.labelFor khi có, nếu
     chưa load module thì fallback logic cũ (proxy/guessed/manual). */
  QuickRig.mapStatusLabel = function (entry) {
    var AM = window.PixiStudio && PixiStudio.ArpAutoMatch;
    if (AM && typeof AM.labelFor === 'function') {
      var lab = AM.labelFor(entry);
      return { text: lab.badge, cssClass: lab.cssClass, isAutoMatch: lab.isAutoMatch };
    }
    if (!entry) return { text: 'KHÔNG KHỚP', cssClass: 'arp-map-unmatched', isAutoMatch: false };
    var text = (entry.bone && entry.bone.userData && entry.bone.userData.isProxy) ? 'xương giả (proxy)'
      : entry.guessed ? 'đoán theo vị trí' : entry.method === 'manual' ? 'sửa tay' : 'map theo tên';
    return { text: text, cssClass: 'arp-map-' + (entry.method || 'name'), isAutoMatch: false };
  };

  /* ============================================================
     UI — tab Quick Rig (đăng ký qua ArpPanel nếu có).
     Dùng PixiStudio.Utils.el khi có, fallback createElement.
     ============================================================ */
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
  function renderMapTable(container) {
    container.innerHTML = '';
    var map = QuickRig.getMap();
    if (!map) {
      container.appendChild(el('div', { class: 'arp-note', text: 'Chưa convert model nào — bảng map sẽ hiện sau khi convert.' }));
      return;
    }
    var rep = QuickRig.buildMapReport(map);
    container.appendChild(el('div', { class: 'arp-note', html:
      '<b>' + rep.mappedCount + '/' + rep.total + ' xương map được (' + rep.coverage + '%)</b> · phương pháp: ' + rep.method +
      (rep.guessedCount ? ' · ' + rep.guessedCount + ' đoán theo vị trí' : '') +
      (rep.autoMatchedCount ? ' · <span class="arp-automatch-badge">' + rep.autoMatchedCount + ' tự khớp</span> (mờ / hierarchy / gộp ngón / xương cha — xem cột Trạng thái)' : '') +
      (rep.missing.length ? ' · thiếu: ' + rep.missing.join(', ') : '') }));
    var table = el('table', { class: 'arp-map-table', style: { width: '100%', fontSize: '12px', borderCollapse: 'collapse' } });
    var head = el('tr', {}, [
      el('th', { text: 'Xương đích (chuẩn)', style: { textAlign: 'left', borderBottom: '1px solid #888' } }),
      el('th', { text: 'Xương nguồn', style: { textAlign: 'left', borderBottom: '1px solid #888' } }),
      el('th', { text: 'Trạng thái', style: { textAlign: 'left', borderBottom: '1px solid #888' } })
    ]);
    table.appendChild(head);
    var srcNames = ['— (không map)'].concat((QuickRig.current ? QuickRig.current.allBones : []).map(function (b) { return b.name; }));
    DST_NAMES.forEach(function (dst) {
      var entry = QuickRig.getMapEntry(dst);
      var row = el('tr', { style: entry ? {} : { background: '#ffdddd' } });
      row.appendChild(el('td', { text: dst }));
      var sel = el('select', { style: { maxWidth: '180px' } });
      srcNames.forEach(function (s) {
        var opt = el('option', { value: s === '— (không map)' ? '' : s, text: s });
        if (entry && entry.src === s) opt.selected = true;
        if (!entry && s === '— (không map)') opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () {
        var r = setManualMap(dst, sel.value || null);
        if (!r.ok) notify('error', 'Quick Rig', r.error);
        else renderMapTable(container);
      });
      var tdSel = el('td', {}); tdSel.appendChild(sel); row.appendChild(tdSel);
      var status = QuickRig.mapStatusLabel(entry);
      var statusCell = el('td', { text: status.text,
        style: entry ? (status.isAutoMatch ? { color: '#7a5c00', fontWeight: 'bold' } : {}) : { color: '#c00', fontWeight: 'bold' } });
      if (status.cssClass) statusCell.className = status.cssClass;
      /* Ghi chú dùng chung: xương tự khớp gộp ngón / xương cha dùng
         chung 1 xương nguồn với xương khác (xoay cùng nhau). */
      if (entry && entry.shared) {
        statusCell.title = 'Dùng chung xương nguồn "' + entry.src + '"' +
          (entry.mergedFrom ? ' (gộp từ ' + entry.mergedFrom + ')' : '') +
          (entry.viaParent ? ' (qua xương cha ' + entry.viaParent + ')' : '') +
          ' — finger curl / IK vẫn chạy, các ngón gập cùng nhau.';
      }
      row.appendChild(statusCell);
      table.appendChild(row);
    });
    container.appendChild(table);
    if (rep.unmapped.length) {
      container.appendChild(el('div', { class: 'arp-note', style: { color: '#c00' },
        text: 'Xương nguồn thừa (không có đích): ' + rep.unmapped.join(', ') }));
    }
    if (rep.unresolved && rep.unresolved.length) {
      container.appendChild(el('div', { class: 'arp-note', style: { color: '#c00' },
        html: '<b>Không tự khớp được (' + rep.unresolved.length + '):</b><br>' + rep.unresolved.map(function (u) {
          return '• <b>' + u.dst + '</b> — ' + u.reason + ' Gợi ý: ' + u.suggestion;
        }).join('<br>') }));
    }
  }

  function renderQuickRigTab(container) {
    if (!container) return;
    container.innerHTML = '';
    var wrap = el('div', { class: 'arp-quickrig-tab' });
    wrap.appendChild(el('div', { class: 'arp-note', html:
      '<b>Quick Rig</b> — nhập model <b>đã rig</b> (.fbx/.glb) thành control rig. Giữ nguyên skin + clip gốc. ' +
      'IK 2-bone analytic, không phải IK đầy đủ như Blender.' }));
    /* ===== AUTO GEN QUICK RIG — một chạm ===== */
    var agState = { level: 'fast' };
    var agBox = el('div', { class: 'arp-autogen-box', style: { border: '1px solid #888', borderRadius: '6px', padding: '8px', margin: '6px 0' } });
    agBox.appendChild(el('div', { html: '<b>⚡ Auto Gen Quick Rig</b> — một chạm: đo skeleton → map xương → sinh control → IK chân + FK tay → match tư thế.' }));
    var agLevelRow = el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', margin: '6px 0' } });
    agLevelRow.appendChild(el('span', { text: 'Mức:' }));
    var agLevelSel = el('select', { style: { flex: '1' } });
    [['fast', 'Nhanh — map + control chính (IK tay/chân, spine, head)'], ['full', 'Đầy đủ — thêm finger, foot roll, jaw, pole target + tự lưu preset']].forEach(function (pair) {
      var opt = el('option', { value: pair[0], text: pair[1] });
      if (pair[0] === 'fast') opt.selected = true;
      agLevelSel.appendChild(opt);
    });
    agLevelSel.addEventListener('change', function () { agState.level = agLevelSel.value; });
    agLevelRow.appendChild(agLevelSel);
    agBox.appendChild(agLevelRow);
    var agBarOuter = el('div', { style: { height: '10px', background: '#ddd', borderRadius: '5px', overflow: 'hidden', margin: '4px 0' } });
    var agBar = el('div', { style: { height: '100%', width: '0%', background: '#33aa55' } });
    agBarOuter.appendChild(agBar);
    agBox.appendChild(agBarOuter);
    var agLog = el('div', { class: 'arp-autogen-log', style: { fontSize: '12px', maxHeight: '110px', overflowY: 'auto', whiteSpace: 'pre-wrap' }, text: 'Chưa chạy Auto Gen.' });
    agBox.appendChild(agLog);
    var agBtnRow = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' } });
    var agRunning = false;
    var agRun = function () {
      if (agRunning) { notify('warning', 'Auto Gen Quick Rig', 'Auto Gen đang chạy — bấm Hủy để dừng.'); return; }
      agRunning = true;
      agBar.style.width = '0%';
      agLog.textContent = 'Bắt đầu Auto Gen (' + (agState.level === 'fast' ? 'Nhanh' : 'Đầy đủ') + ')…';
      autoGen(getTarget(), { level: agState.level, onProgress: function (p) {
        agBar.style.width = p.percent + '%';
        agLog.textContent = p.log.join('\n');
      } }).then(function (r) {
        agRunning = false;
        if (r && r.ok) {
          agBar.style.width = '100%';
          agLog.textContent = (r.log || []).join('\n') + '\nXong: ' + r.mappedCount + '/41 xương · ' + r.controls + ' control · ' + r.poles + ' pole · ' + r.elapsedMs + 'ms.';
          renderMapTable(mapBox); refreshStatus();
          histPush('Ban đầu');
        } else if (r && r.cancelled) {
          agBar.style.width = '0%';
          agLog.textContent = (r.log || []).join('\n');
          renderMapTable(mapBox); refreshStatus();
        } else {
          agLog.textContent = 'Auto Gen thất bại: ' + ((r && r.errors || []).join('; '));
        }
      });
    };
    agBtnRow.appendChild(el('button', { class: 'btn sm', text: '⚡ Auto Gen Quick Rig', style: { fontWeight: 'bold' }, onclick: agRun }));
    agBtnRow.appendChild(el('button', { class: 'btn sm', text: 'Hủy', onclick: function () { cancelAutoGen(); } }));
    agBtnRow.appendChild(el('button', { class: 'btn sm', text: 'Rig lại', onclick: function () { agRun(); } }));
    agBtnRow.appendChild(el('button', { class: 'btn sm', text: 'Xóa control rig', onclick: function () { clearControlRig(); renderMapTable(mapBox); refreshStatus(); } }));
    agBox.appendChild(agBtnRow);
    wrap.appendChild(agBox);
    /* ===== CHẾ ĐỘ MIXAMO FBX ===== */
    var mxBox = el('div', { class: 'arp-mixamo-box', style: { border: '1px solid #2a9d8f', borderRadius: '6px', padding: '8px', margin: '6px 0' } });
    mxBox.appendChild(el('div', { html: '<b>🎭 Chế độ Mixamo FBX</b> — nhận diện rig Mixamo chuẩn (mixamorig: 41 xương, T/A-pose, FBX 7300) rồi Auto Gen một nút bấm. Mixamo cần đăng nhập Adobe nên <b>không tải trực tiếp từ mixamo.com</b> — tải file .fbx về rồi chọn file ở dưới.' }));
    var mxBadge = el('div', { class: 'arp-mixamo-badge', style: { margin: '6px 0', fontSize: '13px' }, text: 'Chưa nhận diện Mixamo — chọn file FBX/GLB rigged hoặc model trong scene rồi bấm "Nhận diện Mixamo".' });
    mxBox.appendChild(mxBadge);
    var mxError = el('div', { class: 'arp-mixamo-error', style: { display: 'none', margin: '6px 0', padding: '6px', background: '#ffe9e9', border: '1px solid #c00', borderRadius: '4px', fontSize: '13px' } });
    mxBox.appendChild(mxError);
    var refreshMxBadge = function (det) {
      det = det || QuickRig.lastMixamoDetection;
      if (!det) { mxBadge.textContent = 'Chưa nhận diện Mixamo.'; return; }
      mxBadge.innerHTML = '';
      var badge = el('span', { style: { fontWeight: 'bold', color: det.isMixamo ? '#0a7d4a' : '#c00' },
        text: det.isMixamo ? '✓ Mixamo Rig ✓' : '✗ Không phải rig Mixamo chuẩn' });
      mxBadge.appendChild(badge);
      mxBadge.appendChild(el('span', { text: ' · ' + det.boneCount + ' xương (' + det.mappedCount + '/41 chuẩn) · ' +
        (det.hasSkin ? 'có skin' : 'không skin') + ' · ' +
        (det.hasClips ? det.clipNames.length + ' clip: ' + det.clipNames.join(', ') : 'không có clip') + ' · cao ' + det.heightM + 'm · ' +
        det.pose + (det.versionKnown ? ' · FBX ' + det.version : ' · FBX version không xác định') }));
      mxBadge.appendChild(el('div', { style: { fontSize: '12px', color: '#555' }, text: det.reasons.join(' ') }));
      if (!det.hasSkeleton) {
        mxError.style.display = 'block';
        mxError.innerHTML = '';
        mxError.appendChild(el('div', { text: 'File này chưa có rig — hãy dùng tab Smart để rig, hoặc tải file rigged từ Mixamo.' }));
        var smartBtn = el('button', { class: 'btn sm', text: 'Mở tab Smart', style: { marginTop: '4px' }, onclick: function () {
          var r = switchToSmartTab();
          if (!r.ok) notify('warning', 'Quick Rig', r.error);
        } });
        mxError.appendChild(smartBtn);
      } else mxError.style.display = 'none';
    };
    var mxClipSel = el('select', { style: { flex: '1' } });
    var refreshMxClips = function () {
      mxClipSel.innerHTML = '';
      var clips = QuickRig.getMixamoClips();
      if (!clips.length) {
        mxClipSel.appendChild(el('option', { value: '', text: '— chưa có clip nào gắn —' }));
        return;
      }
      clips.forEach(function (c) {
        var opt = el('option', { value: c.name, text: c.name + ' (' + c.duration.toFixed(2) + 's · ' + c.tracks + ' track)' });
        if (QuickRig.current && QuickRig.current.currentClipName === c.name) opt.selected = true;
        mxClipSel.appendChild(opt);
      });
    };
    var mxBtnRow = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' } });
    mxBtnRow.appendChild(el('button', { class: 'btn sm', text: 'Nhận diện Mixamo', onclick: function () {
      var det = detectMixamo(getTarget());
      refreshMxBadge(det);
      if (!det.hasSkeleton) notify('error', 'Quick Rig — Mixamo', 'File này chưa có rig — hãy dùng tab Smart để rig, hoặc tải file rigged từ Mixamo.');
    } }));
    mxBtnRow.appendChild(el('button', { class: 'btn sm', text: '🎭 Auto Gen Mixamo — Dùng rig Mixamo gốc', style: { fontWeight: 'bold' }, onclick: function () {
      autoGenMixamo(getTarget(), { mode: 'keep', onProgress: function (p) { agLog.textContent = p.log.join('\n'); } }).then(function (r) {
        refreshMxBadge(r.detection); refreshMxClips(); renderMapTable(mapBox); refreshStatus();
        if (!r.ok && r.suggestSmartTab) refreshMxBadge(r.detection);
        if (!r.ok) notify('error', 'Quick Rig — Mixamo', (r.errors || []).join('; '));
        if (r.ok) histPush('Ban đầu');
      });
    } }));
    mxBtnRow.appendChild(el('button', { class: 'btn sm', text: '🎭 Auto Gen Mixamo — Chuẩn hóa về rig studio', onclick: function () {
      autoGenMixamo(getTarget(), { mode: 'normalize', onProgress: function (p) { agLog.textContent = p.log.join('\n'); } }).then(function (r) {
        refreshMxBadge(r.detection); refreshMxClips(); renderMapTable(mapBox); refreshStatus();
        if (!r.ok) notify('error', 'Quick Rig — Mixamo', (r.errors || []).join('; '));
        else if (r.renamed && r.renamed.length) notify('info', 'Quick Rig — Mixamo', 'Đã đổi tên ' + r.renamed.length + ' xương về mixamorig: + ' + r.tracksRenamed + ' track clip (skin/clip giữ nguyên).');
        if (r.ok) histPush('Ban đầu');
      });
    } }));
    mxBox.appendChild(mxBtnRow);
    mxBox.appendChild(el('div', { style: { fontSize: '12px', color: '#555', marginTop: '4px' },
      text: '“Dùng rig Mixamo gốc”: giữ nguyên skeleton Mixamo, chỉ thêm control. “Chuẩn hóa về rig studio”: đổi tên xương về đúng mixamorig:<Tên> chuẩn + đổi tên track clip theo — giữ nguyên skin/clip, không bind lại.' }));
    var mxClipRow = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px' } });
    mxClipRow.appendChild(el('span', { text: 'Clip Mixamo:' }));
    mxClipRow.appendChild(mxClipSel);
    mxClipRow.appendChild(el('button', { class: 'btn sm', text: '▶ Phát clip', onclick: function () {
      var r = playMixamoClip(mxClipSel.value || 0);
      if (!r.ok) notify('warning', 'Quick Rig — Mixamo', r.error);
    } }));
    mxClipRow.appendChild(el('button', { class: 'btn sm', text: '⏹ Dừng', onclick: function () { stopMixamoClip(); } }));
    mxClipRow.appendChild(el('button', { class: 'btn sm', text: 'Retarget clip Mixamo', onclick: function () {
      var r = retargetMixamoClip(mxClipSel.value || 0);
      if (!r.ok) notify('error', 'Quick Rig — Mixamo', r.reason || r.error);
      else notify('success', 'Quick Rig — Mixamo', 'Retarget xong: "' + r.clip + '" phủ ' + Math.round(r.compat * 100) + '% rig — đang phát thử.');
    } }));
    mxBox.appendChild(mxClipRow);
    var mxExpRow = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' } });
    mxExpRow.appendChild(el('button', { class: 'btn sm', text: '⬇ Tải FBX Mixamo-compatible (rigged, 7300)', style: { fontWeight: 'bold' }, onclick: function () {
      var r = exportMixamoCompatible(getTarget(), { clipName: mxClipSel.value || undefined });
      if (!r.ok) notify('error', 'Quick Rig — Mixamo', r.error || 'Xuất thất bại.');
      else refreshMxBadge();
    } }));
    mxBox.appendChild(mxExpRow);
    mxBox.appendChild(el('div', { style: { fontSize: '12px', color: '#555', marginTop: '4px' },
      text: 'File xuất ra GIỮ skeleton mixamorig: + skin, FBX 7300, về bind pose (T/A-pose) đã chụp trước khi xuất — dùng tiếp ở Unity/Unreal hoặc tải lại Mixamo lấy animation mới. KHÁC preset “Mixamo (mesh-only)” của tab Export (preset đó bỏ xương để Mixamo tự auto-rig).' }));
    wrap.appendChild(mxBox);
    /* file picker */
    var fileInput = el('input', { type: 'file', accept: '.fbx,.glb,.gltf', style: { display: 'none' } });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        loadRiggedFile(reader.result, f.name).then(function (loaded) {
          loaded.object.animations = loaded.animations;
          if (window.PixiStudio && PixiStudio.Viewport && PixiStudio.Viewport.addModel) {
            PixiStudio.Viewport.addModel(loaded.object);
          } else if (window.PixiStudio && PixiStudio.Models && PixiStudio.Models.add) {
            PixiStudio.Models.add(loaded.object);
          }
          /* Nhận diện Mixamo ngay khi file vào (đọc FBX version từ bytes thô) */
          var det = detectMixamo(loaded.object, { arrayBuffer: reader.result });
          refreshMxBadge(det);
          if (!det.hasSkeleton) {
            renderMapTable(mapBox);
            refreshStatus();
            notify('error', 'Quick Rig — Mixamo', 'File này chưa có rig — hãy dùng tab Smart để rig, hoặc tải file rigged từ Mixamo.');
            return;
          }
          var r = convertToControlRig(loaded.object);
          renderMapTable(mapBox);
          refreshStatus();
          refreshMxClips();
          if (!r.ok) notify('error', 'Quick Rig', (r.errors || []).join('; '));
          else histPush('Ban đầu');
        }).catch(function (e) { notify('error', 'Quick Rig', 'Không đọc được file: ' + (e && e.message)); });
      };
      reader.readAsArrayBuffer(f);
    });
    wrap.appendChild(fileInput);
    var btnRow = el('div', { class: 'arp-btn-row', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '6px 0' } });
    btnRow.appendChild(el('button', { class: 'btn sm', text: 'Chọn file FBX/GLB rigged', onclick: function () { fileInput.click(); } }));
    btnRow.appendChild(el('button', { class: 'btn sm', text: 'Chuyển từ model đang chọn trong scene', onclick: function () {
      var r = convertToControlRig(getTarget());
      renderMapTable(mapBox); refreshStatus();
      if (!r.ok) notify('error', 'Quick Rig', (r.errors || []).join('; '));
      else histPush('Ban đầu');
    } }));
    btnRow.appendChild(el('button', { class: 'btn sm', text: 'Áp dụng (map lại + đồng bộ control)', onclick: function () {
      var r = matchToSource();
      if (!r.ok) notify('warning', 'Quick Rig', r.error); else { renderMapTable(mapBox); histPush('Match to source'); }
    } }));
    wrap.appendChild(btnRow);
    var status = el('div', { class: 'arp-note', id: 'arp-qr-status', text: 'Chưa có control rig.' });
    var refreshStatus = function () {
      var cur = QuickRig.current;
      if (!cur) { status.textContent = 'Chưa có control rig.'; return; }
      status.textContent = 'Control rig: ' + cur.map.mappedCount + '/41 xương (' + cur.map.coverage.toFixed(0) + '%) · ' +
        Object.keys(cur.controls).length + ' control · ' + Object.keys(cur.poles).length + ' pole · skin ' +
        cur.skinnedBefore + ' mesh · ' + cur.clipsKept + ' clip gốc giữ nguyên.';
    };
    wrap.appendChild(status);
    /* IK/FK switch từng chi */
    var limbBox = el('div', { style: { margin: '8px 0' } });
    limbBox.appendChild(el('div', { html: '<b>IK / FK từng chi</b>' }));
    Object.keys(LIMBS).forEach(function (limb) {
      var row = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0' } });
      row.appendChild(el('span', { text: limb, style: { width: '90px' } }));
      ['IK', 'FK'].forEach(function (mode) {
        row.appendChild(el('button', { class: 'btn sm', text: mode, onclick: function () {
          var r = setLimbMode(limb, mode);
          if (!r.ok) notify('warning', 'Quick Rig', r.error);
          else { notify('info', 'Quick Rig', limb + ' → ' + mode); histPush(limb + ' → ' + mode); }
        } }));
      });
      row.appendChild(el('button', { class: 'btn sm', text: 'Cập nhật IK/FK', onclick: function () { updateLimb(limb); } }));
      limbBox.appendChild(row);
    });
    wrap.appendChild(limbBox);
    /* Finger + foot roll + spine/head/jaw */
    var ctrlBox = el('div', { style: { margin: '8px 0' } });
    ctrlBox.appendChild(el('div', { html: '<b>Ngón tay / Bàn chân / Thân / Đầu</b>' }));
    var mkSlider = function (label, min, max, step, val, oninput) {
      var row = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0' } });
      row.appendChild(el('span', { text: label, style: { width: '140px' } }));
      var inp = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(val), style: { flex: '1' } });
      var valEl = el('span', { text: String(val), style: { width: '36px' } });
      inp.addEventListener('input', function () { valEl.textContent = inp.value; oninput(parseFloat(inp.value)); });
      /* Ghi history 1 lần khi thả slider (pose đã chốt) — không ghi từng input để khỏi ngập stack. */
      inp.addEventListener('change', function () { histPush(label); });
      row.appendChild(inp); row.appendChild(valEl);
      return row;
    };
    ctrlBox.appendChild(mkSlider('Curl tất cả ngón', 0, 1, 0.05, 0, function (v) { setFingerCurl('all', v); }));
    ctrlBox.appendChild(mkSlider('Curl ngón trỏ trái', 0, 1, 0.05, 0, function (v) { setFingerCurl('LeftHandIndex', v); }));
    ctrlBox.appendChild(mkSlider('Foot roll trái', 0, 1, 0.05, 0, function (v) { setFootRoll('Left', v); }));
    ctrlBox.appendChild(mkSlider('Foot roll phải', 0, 1, 0.05, 0, function (v) { setFootRoll('Right', v); }));
    ctrlBox.appendChild(mkSlider('Xoay đầu (X)', -0.6, 0.6, 0.05, 0, function (v) { setHeadRotation({ x: v, y: 0, z: 0 }); }));
    ctrlBox.appendChild(mkSlider('Mở hàm', 0, 1, 0.05, 0, function (v) {
      var r = setJaw(v);
      if (!r.ok && r.reason) notify('info', 'Quick Rig', 'Không có xương hàm — control hàm không khả dụng.');
    }));
    wrap.appendChild(ctrlBox);
    /* Match / Bake / Preset / hiển thị */
    var actRow = el('div', { class: 'arp-btn-row', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '6px 0' } });
    actRow.appendChild(el('button', { class: 'btn sm', text: 'Match to source', onclick: function () { var r = matchToSource(); if (r && r.ok) histPush('Match to source'); } }));
    actRow.appendChild(el('button', { class: 'btn sm', text: 'Bake to skeleton', onclick: function () { var r = bakeToSkeleton(); if (r && r.ok) histPush('Bake to skeleton'); } }));
    actRow.appendChild(el('button', { class: 'btn sm', text: 'Lưu preset', onclick: function () { savePreset(); } }));
    actRow.appendChild(el('button', { class: 'btn sm', text: 'Load preset', onclick: function () { var r = loadPreset(); if (r && r.ok) histPush('Load preset'); } }));
    actRow.appendChild(el('button', { class: 'btn sm', text: 'Bật/tắt control', onclick: function () { toggleControls(); } }));
    actRow.appendChild(el('button', { class: 'btn sm', text: 'Gỡ control rig', onclick: function () { clearControlRig(); renderMapTable(mapBox); refreshStatus(); } }));
    wrap.appendChild(actRow);
    var mapBox = el('div', { class: 'arp-map-box' });
    wrap.appendChild(el('div', { html: '<b>Bảng map xương</b> — đổi dropdown để sửa map thủ công (áp dụng ngay).', style: { marginTop: '8px' } }));
    wrap.appendChild(mapBox);
    /* ===== QR3 sections (vòng mở rộng 3) — Pose / Keyframe / IK nâng cao /
       Gizmos / Facial / Prop / Undo-Layers / Live retarget ===== */
    QuickRig.sections.forEach(function (s) {
      try {
        var sec = el('div', { class: 'arp-qr3-section', style: { borderTop: '1px solid #888', marginTop: '10px', paddingTop: '6px' } });
        sec.setAttribute('data-qr3-section', s.key);
        s.renderFn(sec);
        wrap.appendChild(sec);
      } catch (e) { /* section lỗi: tab chính vẫn chạy */ }
    });
    container.appendChild(wrap);
    renderMapTable(mapBox);
    refreshStatus();
    refreshMxBadge();
    refreshMxClips();
  }
  /* ===== QR3 sections (vòng mở rộng 3, gộp 2026-11-27) =====
     Các module arp-qr3-*.js đăng ký section của mình vào tab Quick Rig
     qua registerSection(key, renderFn). Section render sau nội dung
     Quick Rig gốc, theo thứ tự đăng ký; section lỗi thì tab chính
     vẫn chạy (try/catch từng section trong renderQuickRigTab). */
  QuickRig.sections = [];
  QuickRig.registerSection = function (key, renderFn) {
    if (!key || typeof renderFn !== 'function') return false;
    var i;
    for (i = 0; i < QuickRig.sections.length; i++) {
      if (QuickRig.sections[i].key === key) { QuickRig.sections[i].renderFn = renderFn; return true; }
    }
    QuickRig.sections.push({ key: key, renderFn: renderFn });
    return true;
  };
  /* Ghi trạng thái vào History (arp-qr3-history.js) nếu đã load — dùng
     cho Undo/Redo tự động ở các thao tác trong tab. Không có History
     thì bỏ qua êm. pushState chụp pose HIỆN TẠI nên gọi SAU khi đổi
     pose xong (trừ Auto Gen/convert: push 'Ban đầu' sau khi rig mới
     tạo xong, vì History reset khi đổi rig). */
  function histPush(label) {
    try {
      var H = window.PixiStudio && PixiStudio.ArpQuickRig && PixiStudio.ArpQuickRig.History;
      if (H && typeof H.pushState === 'function') H.pushState(label);
    } catch (e) {}
  }
  QuickRig.renderTab = renderQuickRigTab;

  /* Test hooks */
  QuickRig._test = {
    mapBonesByName: mapBonesByName,
    guessMapByPosition: guessMapByPosition,
    collectBones: collectBones,
    computeTwoBoneAngles: computeTwoBoneAngles,
    solveTwoBoneIK: solveTwoBoneIK,
    BONE_DEFS: BONE_DEFS,
    LIMBS: LIMBS,
    stripName: stripName,
    /* Mixamo */
    detectMixamo: detectMixamo,
    estimatePose: estimatePose,
    readFbxVersion: readFbxVersion,
    collectClips: collectClips,
    createProxyBones: createProxyBones,
    normalizeMixamoNames: normalizeMixamoNames,
    autoGenMixamo: autoGenMixamo,
    attachMixamoClips: attachMixamoClips,
    playMixamoClip: playMixamoClip,
    stopMixamoClip: stopMixamoClip,
    tickMixamo: tickMixamo,
    retargetMixamoClip: retargetMixamoClip,
    exportMixamoCompatible: exportMixamoCompatible,
    switchToSmartTab: switchToSmartTab
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpQuickRig = QuickRig;
  if (window.PixiStudio.ArpPanel && typeof PixiStudio.ArpPanel.registerTab === 'function') {
    try { PixiStudio.ArpPanel.registerTab('quickrig', 'Quick Rig', renderQuickRigTab); } catch (e) {}
  }
})();
