/* ============================================================
 * rig/arp-automatch.js — AUTO KHỚP XƯƠNG (Auto Rig Pro Blend)
 *
 * Vấn đề (ảnh user 2026-11-27 ~10:15, tab Quick Rig): model chibi
 * tay đơn giản, thiếu nhiều xương ngón so với chuẩn 41 xương Mixamo
 * (vd LeftHandMiddle1/2, LeftHandRing1/2, LeftHandPinky1 hiện
 * '— (không map)' + 'KHÔNG KHỚP'). Trước đây map chỉ khớp theo tên
 * (+ đoán theo vị trí), xương thiếu là bỏ trống — finger curl / IK /
 * retarget / export chạm vào xương đó thì hoặc không chạy, hoặc
 * Remap từ chối clip vì compat < 80%.
 *
 * Module này TỰ KHỚP mọi xương chuẩn còn thiếu, theo thứ tự ưu tiên:
 *   (A) khớp theo tên chính xác (strip 'mixamorig:'/'Model:', không
 *       phân biệt hoa/thường) — độ tin cậy 100%.
 *   (B) khớp MỜ theo tên: bỏ dấu phân cách, Levenshtein + khớp token
 *       (vd 'LeftHand_Middle_1', 'L_Middle1', 'middle_finger_01' →
 *       LeftHandMiddle1). Chỉ nhận khi đủ ngưỡng, và KHÔNG nhận khi
 *       lệch phía (Left ≠ Right). Độ tin cậy 70–95%.
 *   (C) fallback theo HIERARCHY: xương cha đã khớp có đúng MỘT con
 *       chưa dùng thì lấy con đó (vd đốt 2 chỉ có 1 con của đốt 1).
 *       Độ tin cậy 60%.
 *   (D) GỘP NGÓN: xương ngón thiếu → map về xương ngón CÙNG ĐOẠN của
 *       ngón còn lại cùng bàn tay (ưu tiên Index → Middle → Ring →
 *       Pinky → Thumb), để finger curl vẫn gập được — các ngón gập
 *       cùng nhau qua xương donor. Độ tin cậy 50%.
 *   (E) fallback XƯƠNG CHA: map về chính xương nguồn của xương cha
 *       chuẩn (vd Middle1 thiếu hoàn toàn → LeftHand; HeadTop_End →
 *       Head; Spine1 → Spine). Xương đích và xương cha DÙNG CHUNG
 *       một xương nguồn (shared:true) — xoay xương nguồn thì cả hai
 *       cùng cử động, không crash, không mất clip. Độ tin cậy 55%.
 *
 * QUY TẮC AN TOÀN:
 *   • Không bao giờ "đoạt" xương nguồn đã khớp theo tên: xương đã
 *     dùng bị loại khỏi mọi ứng viên ở (B)–(E), trừ trường hợp dùng
 *     chung có chủ đích ở (D)/(E) (shared:true, ghi rõ mergedFrom).
 *   • Không tạo xương giả (proxy bone): proxy '__proxy' như chế độ
 *     Mixamo chỉ là placeholder tư thế, KHÔNG có skin weight nên
 *     finger curl xoay proxy cũng không làm mesh cử động — tự khớp
 *     dùng chung xương thật luôn cho kết quả nhìn thấy được. Xương
 *     nào không có fallback hợp lý (vd Hips thiếu, cả cha lẫn donor
 *     đều không có) thì để lại trong `unresolved` kèm lý do + đề
 *     xuất, KHÔNG bịa map.
 *   • applyToMap() chỉ LẤP xương đang thiếu của một map có sẵn
 *     (name+position) — không ghi đè entry 'name'/'position'/
 *     'manual' nào, không đổi method của entry đã khớp đúng.
 *
 * DÙNG CHUNG: QuickRig.mapBones() (bảng map), ArpRemap.retargetClip()
 * (compat tính cả xương tự khớp), ArpSmart.rig() (rig hy3d28 /
 * minimal15 thiếu ngón vẫn chạy, kèm báo cáo automatch).
 *
 * API chính:
 *   ArpAutoMatch.autoMatch(skeletonOrBones, opts)
 *     → { mapped:[{src,dst,method,confidence,bone,shared,mergedFrom}],
 *         unmapped, missing, coverage, mappedCount, total:41,
 *         method:'automatch', autoMatchedCount, byMethod, unresolved,
 *         sharedCount, bones }
 *   ArpAutoMatch.applyToMap(map, skeletonOrBones, opts)
 *     → { map, added, unresolved, autoMatchedCount } (map sửa tại chỗ)
 *   ArpAutoMatch.labelFor(entry) → { badge, confidence, cssClass }
 *   ArpAutoMatch.normalizeName / levenshtein / nameSimilarity
 * ============================================================ */
(function () {
  'use strict';

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
  var DST_NAMES = BONE_DEFS.map(function (d) { return d.name; });
  var PARENT_OF = {};
  BONE_DEFS.forEach(function (d) { PARENT_OF[d.name] = d.parent; });

  /* Ngón tay: { side, finger, segment } — segment 1 = đốt gốc, 2 = đốt 2. */
  var FINGER_RE = /^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)(1|2)$/;
  var FINGER_DONOR_ORDER = ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'];

  var CONF = { name: 100, fuzzyMin: 70, fuzzyMax: 95, hierarchy: 60, parent: 55, fingerMerge: 50 };
  var FUZZY_LEV_MIN = 0.80;      /* chỉ Levenshtein cũng đủ nhận */
  var FUZZY_TOKEN_MIN = 0.75;    /* khớp token: ≥75% token đích (cần lev ≥ 0.40 làm sanity) */
  var FUZZY_LEV_SANITY = 0.40;

  /* ---------- Chuẩn hoá tên ---------- */
  function stripPrefix(name) {
    var s = String(name == null ? '' : name);
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    s = s.replace(/__proxy$/i, '');
    return s;
  }
  function normalizeName(name) {
    return stripPrefix(name).toLowerCase().replace(/[_\-\s.]+/g, '');
  }
  /* Tách token theo CamelCase + dấu phân cách, vd 'LeftHand_Middle_1' →
     ['left','hand','middle','1']; 'L_Middle1' → ['l','middle','1']. */
  function tokens(name) {
    /* Tách CamelCase + chữ↔số ('Middle1' → 'middle','1') + dấu phân cách. */
    var s = stripPrefix(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([a-zA-Z])([0-9])/g, '$1 $2').replace(/[_\-\s.]+/g, ' ');
    return s.toLowerCase().split(' ').filter(function (t) { return !!t; });
  }
  var SIDE_ALIAS = { l: 'left', r: 'right', left: 'left', right: 'right' };
  var FINGER_ALIAS = { idx: 'index', mid: 'middle', thumb: 'thumb', index: 'index', middle: 'middle', ring: 'ring', pinky: 'pinky' };
  function canonToken(t) {
    if (SIDE_ALIAS[t]) return SIDE_ALIAS[t];
    if (FINGER_ALIAS[t]) return FINGER_ALIAS[t];
    if (/^\d+$/.test(t)) return String(parseInt(t, 10)); /* '01' → '1' */
    return t;
  }
  function sideOf(name) {
    var n = normalizeName(name);
    if (n.indexOf('left') === 0 || /(^|_)l(?=hand|arm|leg|foot|shoulder|upleg)/.test(n)) return 'Left';
    if (n.indexOf('right') === 0 || /(^|_)r(?=hand|arm|leg|foot|shoulder|upleg)/.test(n)) return 'Right';
    var toks = tokens(name).map(canonToken);
    if (toks.indexOf('left') >= 0) return 'Left';
    if (toks.indexOf('right') >= 0) return 'Right';
    return null;
  }

  /* ---------- Levenshtein + độ tương tự tên ---------- */
  function levenshtein(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[n];
  }
  function levSimilarity(a, b) {
    var na = normalizeName(a), nb = normalizeName(b);
    var max = Math.max(na.length, nb.length);
    if (!max) return 0;
    return 1 - levenshtein(na, nb) / max;
  }
  /* tokenCoverage: tỉ lệ token của tên đích được tên nguồn phủ (sau khi
     chuẩn hoá alias l→left, idx→index...). */
  function tokenCoverage(srcName, dstName) {
    var srcToks = tokens(srcName).map(canonToken);
    var dstToks = tokens(dstName).map(canonToken);
    if (!dstToks.length) return 0;
    var hit = 0;
    dstToks.forEach(function (t) { if (srcToks.indexOf(t) >= 0) hit++; });
    return hit / dstToks.length;
  }
  function fingerWord(name) {
    var toks = tokens(name).map(canonToken);
    var fingers = ['thumb', 'index', 'middle', 'ring', 'pinky'];
    for (var i = 0; i < toks.length; i++) if (fingers.indexOf(toks[i]) >= 0) return toks[i];
    return null;
  }
  /* nameSimilarity(src, dst) → { lev, token, score, accept, reason }.
     accept khi: lev ≥ 0.80, hoặc (token ≥ 0.75 và lev ≥ 0.40).
     Lệch phía (Left/Right) → luôn từ chối. Ngón khác loại (Index ≠
     Middle) → luôn từ chối: nếu không, 'LeftHandIndex3' thừa của
     Thiếu Lâm sẽ bị khớp mờ nhầm thành Middle1 (token 3/4). */
  function nameSimilarity(srcName, dstName) {
    var out = { lev: 0, token: 0, score: 0, accept: false, reason: '' };
    var sSide = sideOf(srcName), dSide = sideOf(dstName);
    if (sSide && dSide && sSide !== dSide) {
      out.reason = 'lệch phía (' + sSide + ' ≠ ' + dSide + ')';
      return out;
    }
    var sFinger = fingerWord(srcName), dFinger = fingerWord(dstName);
    if (sFinger && dFinger && sFinger !== dFinger) {
      out.reason = 'khác ngón (' + sFinger + ' ≠ ' + dFinger + ')';
      return out;
    }
    out.lev = levSimilarity(srcName, dstName);
    out.token = tokenCoverage(srcName, dstName);
    if (out.lev >= FUZZY_LEV_MIN) {
      out.accept = true;
      out.score = out.lev;
      out.reason = 'lev ' + out.lev.toFixed(2);
    } else if (out.token >= FUZZY_TOKEN_MIN && out.lev >= FUZZY_LEV_SANITY) {
      out.accept = true;
      out.score = out.token;
      out.reason = 'token ' + out.token.toFixed(2) + ' + lev ' + out.lev.toFixed(2);
    } else {
      out.reason = 'lev ' + out.lev.toFixed(2) + ', token ' + out.token.toFixed(2) + ' < ngưỡng';
    }
    return out;
  }

  /* ---------- Thu thập xương từ nhiều dạng đầu vào ---------- */
  function collectBones(input) {
    var out = [];
    if (!input) return out;
    if (typeof input === 'string') return [{ name: input, parent: null, children: [], _pseudo: true }];
    if (Array.isArray(input)) {
      input.forEach(function (b) {
        if (!b) return;
        if (typeof b === 'string') out.push({ name: b, parent: null, children: [], _pseudo: true });
        else if (b.isBone || b.name) out.push(b);
      });
      return out;
    }
    if (input.isBone) return [input];
    if (input.bones && typeof input.bones === 'object' && !Array.isArray(input.bones)) {
      /* rig { bones: { Name: bone } } — key là tên đích chuẩn, value là bone */
      Object.keys(input.bones).forEach(function (k) {
        var b = input.bones[k];
        if (b && b.name) out.push(b);
        else if (b) out.push({ name: k, parent: null, children: [], _pseudo: true });
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
  /* Nối parent/children theo tên khi entry chỉ có parent dạng string
     (harness tổng hợp), và dựng children[] cho xương THREE khi thiếu. */
  function linkHierarchy(bones) {
    var byName = {};
    bones.forEach(function (b) { byName[normalizeName(b.name)] = b; });
    bones.forEach(function (b) {
      var p = b.parent;
      if (typeof p === 'string' && p) {
        var pb = byName[normalizeName(p)] || null;
        b.parent = pb;
        if (pb) {
          pb.children = pb.children || [];
          if (pb.children.indexOf(b) < 0) pb.children.push(b);
        }
      }
      if (!b.children) b.children = [];
    });
    return bones;
  }
  function boneChildren(bone, bones) {
    if (!bone) return [];
    var kids = (bone.children || []).filter(function (c) { return c && (c.isBone || c.name) && bones.indexOf(c) >= 0; });
    return kids;
  }
  function fingerInfo(dst) {
    var m = FINGER_RE.exec(dst);
    if (!m) return null;
    return { side: m[1], finger: m[2], segment: parseInt(m[3], 10) };
  }

  /* ============================================================
     autoMatch — chạy đủ 5 bước (A)–(E) trên tập xương nguồn.
     opts: { excludeSrc: [tên xương nguồn đã dùng ở map ngoài — không
       được đoạt], onlyDst: [chỉ trả entry cho các đích này],
       seed: [{dst, src, bone, method, confidence}] — entry ĐÃ khớp
       ở map ngoài (vd name/position): dùng làm cha/donor cho bước
       (C)/(D)/(E) và cấm bước (B) khớp mờ trộm xương giống tên của
       chúng (vd Index3 bị khớp mờ thành Index1 khi Index1 đã có chủ
       — lỗi gặp ở Thiếu Lâm trước khi có seed). }
     ============================================================ */
  function autoMatch(input, opts) {
    opts = opts || {};
    var bones = linkHierarchy(collectBones(input));
    var excludeSrc = {};
    (opts.excludeSrc || []).forEach(function (n) { excludeSrc[normalizeName(n)] = true; });
    var onlyDst = opts.onlyDst ? opts.onlyDst.slice() : null;
    /* LƯU Ý: luôn tính đủ 41 đích rồi mới lọc theo onlyDst ở cuối —
       vì bước (C)/(D)/(E) cần tra xương cha / donor (vd Middle1 gộp
       về Index1 thì Index1 phải có trong bảng dù Index1 không nằm
       trong onlyDst). Lọc sớm làm mất cha/donor → không khớp được gì. */
    var dstList = DST_NAMES.slice();

    var result = {
      mapped: [], unmapped: [], extra: [], missing: dstList.slice(),
      coverage: 0, mappedCount: 0, total: DST_NAMES.length,
      method: 'automatch', autoMatchedCount: 0, sharedCount: 0,
      byMethod: { name: 0, fuzzy: 0, hierarchy: 0, parent: 0, 'finger-merge': 0 },
      unresolved: [], bones: bones
    };
    var usedSrc = {};      /* normalized src name → true (đã có chủ, trừ dùng chung) */
    var dstToEntry = {};   /* dst → entry */
    var put = function (bone, dst, method, confidence, extra) {
      var e = { src: bone.name, dst: dst, method: method, confidence: confidence, bone: bone, shared: false, guessed: false };
      if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
      if (e.shared) result.sharedCount++;
      result.mapped.push(e);
      dstToEntry[dst] = e;
      var mi = result.missing.indexOf(dst);
      if (mi >= 0) result.missing.splice(mi, 1);
      if (result.byMethod[method] !== undefined) result.byMethod[method]++;
      if (method !== 'name') result.autoMatchedCount++;
      return e;
    };

    /* --- SEED: entry đã khớp ở map ngoài — làm cha/donor, không đếm
       vào autoMatchedCount, không cho bước (B) đoạt xương của chúng. --- */
    (opts.seed || []).forEach(function (s) {
      if (!s || !s.dst || !s.bone || dstToEntry[s.dst]) return;
      var se = {
        src: s.src || s.bone.name, dst: s.dst, method: s.method || 'name',
        confidence: (typeof s.confidence === 'number' ? s.confidence : 100),
        bone: s.bone, shared: !!s.shared, guessed: false
      };
      if (s.mergedFrom) se.mergedFrom = s.mergedFrom;
      if (s.viaParent) se.viaParent = s.viaParent;
      result.mapped.push(se);
      dstToEntry[s.dst] = se;
      usedSrc[normalizeName(se.src)] = true;
      var smi = result.missing.indexOf(s.dst);
      if (smi >= 0) result.missing.splice(smi, 1);
    });

    /* --- (A) khớp theo tên chính xác --- */
    dstList.forEach(function (dst) {
      if (dstToEntry[dst]) return; /* đã seed */
      var dn = normalizeName(dst);
      for (var i = 0; i < bones.length; i++) {
        var bn = normalizeName(bones[i].name);
        if (bn === dn && !usedSrc[bn] && !excludeSrc[bn]) {
          usedSrc[bn] = true;
          put(bones[i], dst, 'name', CONF.name);
          break;
        }
      }
    });

    /* --- (B) khớp mờ theo tên (chỉ xương nguồn CHƯA dùng) --- */
    dstList.forEach(function (dst) {
      if (dstToEntry[dst]) return;
      var best = null, bestSim = null;
      bones.forEach(function (b) {
        var bn = normalizeName(b.name);
        if (usedSrc[bn] || excludeSrc[bn]) return;
        var sim = nameSimilarity(b.name, dst);
        if (!sim.accept) return;
        if (!bestSim || sim.score > bestSim.score ||
            (sim.score === bestSim.score && sim.lev > bestSim.lev)) {
          best = b; bestSim = sim;
        }
      });
      if (best) {
        usedSrc[normalizeName(best.name)] = true;
        var conf = Math.max(CONF.fuzzyMin, Math.min(CONF.fuzzyMax, Math.round(bestSim.score * 100)));
        put(best, dst, 'fuzzy', conf, { fuzzyScore: +bestSim.score.toFixed(2), fuzzyReason: bestSim.reason });
      }
    });

    /* --- (C) fallback hierarchy: cha đã khớp, đúng 1 con chưa dùng --- */
    dstList.forEach(function (dst) {
      if (dstToEntry[dst]) return;
      var parentDst = PARENT_OF[dst];
      if (!parentDst || !dstToEntry[parentDst]) return;
      var parentBone = dstToEntry[parentDst].bone;
      var kids = boneChildren(parentBone, bones).filter(function (k) {
        var kn = normalizeName(k.name);
        return !usedSrc[kn] && !excludeSrc[kn];
      });
      if (kids.length === 1) {
        usedSrc[normalizeName(kids[0].name)] = true;
        put(kids[0], dst, 'hierarchy', CONF.hierarchy, { viaParent: parentDst });
      }
    });

    /* --- (D) gộp ngón: cùng đoạn, ngón donor cùng bàn tay --- */
    dstList.forEach(function (dst) {
      if (dstToEntry[dst]) return;
      var fi = fingerInfo(dst);
      if (!fi) return;
      for (var i = 0; i < FINGER_DONOR_ORDER.length; i++) {
        var donorFinger = FINGER_DONOR_ORDER[i];
        if (donorFinger === fi.finger) continue;
        var donorDst = fi.side + 'Hand' + donorFinger + fi.segment;
        var donor = dstToEntry[donorDst];
        if (donor && donor.bone) {
          put(donor.bone, dst, 'finger-merge', CONF.fingerMerge,
            { shared: true, mergedFrom: donorDst });
          break;
        }
      }
    });

    /* --- (E) fallback xương cha: dùng chung xương nguồn của cha --- */
    dstList.forEach(function (dst) {
      if (dstToEntry[dst]) return;
      var parentDst = PARENT_OF[dst];
      if (!parentDst || !dstToEntry[parentDst]) return;
      put(dstToEntry[parentDst].bone, dst, 'parent', CONF.parent,
        { shared: true, viaParent: parentDst });
    });

    /* --- còn lại: unresolved + lý do + đề xuất --- */
    result.missing.forEach(function (dst) {
      var parentDst = PARENT_OF[dst];
      var reason, suggestion;
      if (!parentDst) {
        reason = 'Không có xương nguồn tên gần đúng và không có xương cha để fallback (đây là xương gốc của cây xương).';
        suggestion = 'Rig lại model bằng Auto Rig Pro (Smart) để tạo đủ xương, hoặc map tay xương Hips trong bảng map.';
      } else if (!dstToEntry[parentDst]) {
        reason = 'Không có xương nguồn tên gần đúng; xương cha ' + parentDst + ' cũng chưa khớp nên không fallback được.';
        suggestion = 'Khớp tay ' + parentDst + ' trước (bảng map), rồi chạy lại Auto Khớp; hoặc rig lại bằng Smart.';
      } else {
        reason = 'Không có xương nguồn tên gần đúng và không có donor gộp ngón / xương cha phù hợp.';
        suggestion = 'Map tay trong bảng map, hoặc dùng chế độ Mixamo FBX để tạo xương giả (proxy) cho ' + dst + ' khi xuất FBX.';
      }
      result.unresolved.push({ dst: dst, reason: reason, suggestion: suggestion });
    });

    var usedSet = {};
    result.mapped.forEach(function (m) { usedSet[normalizeName(m.src)] = true; });
    result.unmapped = bones.filter(function (b) { return !usedSet[normalizeName(b.name)] && !excludeSrc[normalizeName(b.name)]; }).map(function (b) { return b.name; });
    result.extra = result.unmapped.slice();
    result.mappedCount = result.mapped.length;
    result.coverage = result.total ? result.mappedCount / result.total * 100 : 0;
    /* onlyDst: chỉ trả entry thuộc danh sách đích yêu cầu (dùng cho
       applyToMap) — nhưng cha/donor đã được tính đủ ở trên. */
    if (onlyDst) {
      var keep = {};
      onlyDst.forEach(function (d) { keep[d] = true; });
      result.mapped = result.mapped.filter(function (m) { return keep[m.dst]; });
      result.missing = onlyDst.filter(function (d) { return result.missing.indexOf(d) >= 0; });
      result.unresolved = result.unresolved.filter(function (u) { return keep[u.dst]; });
      result.byMethod = { name: 0, fuzzy: 0, hierarchy: 0, parent: 0, 'finger-merge': 0 };
      result.autoMatchedCount = 0;
      result.sharedCount = 0;
      result.mapped.forEach(function (m) {
        if (result.byMethod[m.method] !== undefined) result.byMethod[m.method]++;
        if (m.method !== 'name') result.autoMatchedCount++;
        if (m.shared) result.sharedCount++;
      });
      result.total = onlyDst.length;
      result.mappedCount = result.mapped.length;
      result.coverage = result.total ? result.mappedCount / result.total * 100 : 0;
    }
    return result;
  }

  /* ============================================================
     applyToMap(map, skeletonOrBones, opts) — lấp xương thiếu của
     map QuickRig có sẵn (name+position). Không ghi đè entry nào
     đã có; xương nguồn đã dùng trong map được loại khỏi ứng viên.
     Trả về { map, added, unresolved, autoMatchedCount }.
     ============================================================ */
  function applyToMap(map, input, opts) {
    opts = opts || {};
    var out = { map: map, added: [], unresolved: [], autoMatchedCount: 0 };
    if (!map || !map.mapped) return out;
    var missingBefore = (map.missing || []).slice();
    if (!missingBefore.length) return out;
    var usedSrc = [];
    map.mapped.forEach(function (m) { if (m.src) usedSrc.push(m.src); });
    /* seed = entry đã khớp của map ngoài: cha/donor cho (C)/(D)/(E),
       và chặn (B) khớp mờ trộm xương giống tên chúng (vd Index3). */
    var seed = [];
    map.mapped.forEach(function (m) {
      if (m.bone) seed.push({
        dst: m.dst, src: m.src, bone: m.bone, method: m.method,
        confidence: m.confidence, shared: m.shared,
        mergedFrom: m.mergedFrom, viaParent: m.viaParent
      });
    });
    var am = null;
    try {
      am = autoMatch(input, { excludeSrc: usedSrc, onlyDst: missingBefore, seed: seed });
    } catch (e) {
      out.error = 'AutoMatch lỗi: ' + (e && e.message);
      return out;
    }
    am.mapped.forEach(function (e) {
      if (missingBefore.indexOf(e.dst) < 0) return;
      var already = false;
      map.mapped.forEach(function (m) { if (m.dst === e.dst) already = true; });
      if (already) return;
      var entry = {
        src: e.src, dst: e.dst, method: e.method, confidence: e.confidence,
        bone: e.bone, shared: !!e.shared, guessed: false
      };
      if (e.mergedFrom) entry.mergedFrom = e.mergedFrom;
      if (e.viaParent) entry.viaParent = e.viaParent;
      if (e.fuzzyReason) entry.fuzzyReason = e.fuzzyReason;
      map.mapped.push(entry);
      out.added.push(entry);
      var mi = map.missing.indexOf(e.dst);
      if (mi >= 0) map.missing.splice(mi, 1);
    });
    /* unmapped nguồn: bỏ xương đã dùng chung (shared) khỏi danh sách thừa */
    var usedNow = {};
    map.mapped.forEach(function (m) { usedNow[normalizeName(m.src)] = true; });
    var bones = am.bones || [];
    map.unmapped = bones.filter(function (b) { return !usedNow[normalizeName(b.name)]; }).map(function (b) { return b.name; });
    map.extra = map.unmapped.slice();
    map.mappedCount = map.mapped.length;
    map.coverage = map.total ? map.mappedCount / map.total * 100 : map.coverage;
    map.autoMatchedCount = (map.autoMatchedCount || 0) + out.added.length;
    map.autoMatched = (map.autoMatched || []).concat(out.added.map(function (e) {
      return { src: e.src, dst: e.dst, method: e.method, confidence: e.confidence, shared: !!e.shared, mergedFrom: e.mergedFrom || null };
    }));
    map.unresolved = am.unresolved.filter(function (u) { return map.missing.indexOf(u.dst) >= 0; });
    if (out.added.length && map.method && map.method.indexOf('automatch') < 0) map.method = map.method + '+automatch';
    else if (out.added.length && !map.method) map.method = 'automatch';
    out.unresolved = map.unresolved.slice();
    out.autoMatchedCount = out.added.length;
    return out;
  }

  /* ---------- Nhãn badge cho UI bảng map ---------- */
  var BADGE_TEXT = {
    name: 'map theo tên',
    manual: 'sửa tay',
    position: 'đoán theo vị trí',
    proxy: 'xương giả (proxy)',
    fuzzy: 'tự khớp (mờ)',
    hierarchy: 'tự khớp (hierarchy)',
    parent: 'tự khớp (xương cha)',
    'finger-merge': 'tự khớp (gộp ngón)'
  };
  function labelFor(entry) {
    if (!entry) return { badge: 'KHÔNG KHỚP', confidence: null, cssClass: 'arp-map-unmatched', isAutoMatch: false };
    if (entry.bone && entry.bone.userData && entry.bone.userData.isProxy) {
      return { badge: 'xương giả (proxy)', confidence: null, cssClass: 'arp-map-proxy', isAutoMatch: false };
    }
    var method = entry.method || (entry.guessed ? 'position' : 'name');
    var isAuto = (method === 'fuzzy' || method === 'hierarchy' || method === 'parent' || method === 'finger-merge');
    var badge = BADGE_TEXT[method] || method;
    var conf = null;
    if (method === 'name') conf = 100;
    else if (typeof entry.confidence === 'number') conf = entry.confidence;
    else if (CONF[method] !== undefined) conf = CONF[method];
    var text = badge + (conf !== null && method !== 'name' && method !== 'manual' && method !== 'position' ? ' ' + conf + '%' : '');
    return { badge: text, confidence: conf, cssClass: isAuto ? 'arp-automatch-badge' : 'arp-map-' + method, isAutoMatch: isAuto, method: method };
  }
  function summarize(result) {
    if (!result) return 'Chưa có kết quả auto khớp.';
    var parts = [result.mappedCount + '/' + result.total + ' xương (' + result.coverage.toFixed(0) + '%)'];
    if (result.autoMatchedCount) {
      var bits = [];
      Object.keys(result.byMethod || {}).forEach(function (k) {
        if (k !== 'name' && result.byMethod[k]) bits.push(result.byMethod[k] + ' ' + (BADGE_TEXT[k] || k));
      });
      parts.push('tự khớp ' + result.autoMatchedCount + (bits.length ? ' (' + bits.join(', ') + ')' : ''));
    }
    if (result.missing && result.missing.length) parts.push('còn thiếu ' + result.missing.length + ': ' + result.missing.join(', '));
    return parts.join(' · ');
  }

  var ArpAutoMatch = {
    BONE_DEFS: BONE_DEFS,
    DST_NAMES: DST_NAMES,
    PARENT_OF: PARENT_OF,
    CONF: CONF,
    stripPrefix: stripPrefix,
    normalizeName: normalizeName,
    tokens: tokens,
    levenshtein: levenshtein,
    nameSimilarity: nameSimilarity,
    tokenCoverage: tokenCoverage,
    collectBones: collectBones,
    fingerInfo: fingerInfo,
    autoMatch: autoMatch,
    applyToMap: applyToMap,
    labelFor: labelFor,
    summarize: summarize
  };

  ArpAutoMatch._test = {
    stripPrefix: stripPrefix,
    normalizeName: normalizeName,
    fingerWord: fingerWord,
    tokens: tokens,
    levenshtein: levenshtein,
    nameSimilarity: nameSimilarity,
    tokenCoverage: tokenCoverage,
    collectBones: collectBones,
    autoMatch: autoMatch,
    applyToMap: applyToMap,
    labelFor: labelFor,
    summarize: summarize
  };

  if (typeof window !== 'undefined') {
    window.PixiStudio = window.PixiStudio || {};
    window.PixiStudio.ArpAutoMatch = ArpAutoMatch;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = ArpAutoMatch;
})();
