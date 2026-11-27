/* ============================================================
 * rig/arp-validate.js — RIG VALIDATION (NHÓM 5)
 *
 * Kiểm tra tự động rig hiện tại, báo lỗi / cảnh báo + nút sửa
 * tự động cho lỗi đơn giản. 9 rule:
 *   1. orientation        (cảnh báo) — trục chính của xương (local
 *                            +Y) có hướng theo xương con không;
 *                            đo góc lệch, cảnh báo nếu > 30°.
 *                            Đo theo local +Y nên KHÔNG phụ thuộc
 *                            tư thế (A-pose/T-pose đều đúng).
 *   2. naming-prefix      (lỗi) — thiếu prefix mixamorig.
 *                            Chấp nhận cả 2 dạng 'mixamorig:' và
 *                            'mixamorig' (FBXLoader r128 bóc dấu
 *                            ':' khi parse lại — rig thật parse ra
 *                            dạng không dấu ':').
 *   3. naming-standard    (lỗi) — tên không thuộc chuẩn 41 xương
 *                            nhưng bắt đầu bằng 1 tên chuẩn + hậu
 *                            tố lạ (vd RightFoot_Bad) → nghi đổi
 *                            tên nhầm, gợi ý tên chuẩn để sửa.
 *                            Hậu tố số (_2, _1) là dạng Blender
 *                            khử trùng tên → chỉ cảnh báo.
 *   4. naming-chars       (lỗi) — ký tự lạ / khoảng trắng trong tên.
 *   5. hierarchy-parent   (lỗi) — cha của xương chuẩn không đúng
 *                            cha chuẩn (vd LeftFoot phải là con
 *                            của LeftLeg).
 *   6. hierarchy-orphan   (lỗi) — xương không nối tới Hips.
 *   7. hierarchy-cycle    (lỗi) — vòng lặp cha-con.
 *   8. duplicate-name     (lỗi) — 2 xương trở lên trùng tên.
 *   9. missing-bones      (cảnh báo) — thiếu xương cho preset đã
 *                            chọn (vd preset humanoid thiếu
 *                            LeftHandMiddle1). Mức cảnh báo vì
 *                            nhiều rig hợp lệ vốn thiếu xương ngón
 *                            (tay chibi / tay đơn giản).
 *
 * "Xương thừa" (tên không thuộc chuẩn 41 và không bắt đầu bằng
 * tên chuẩn — vd Thumb3/Thumb4, Toe_End): cảnh báo, không phải
 * lỗi — rig thật có thêm đốt ngón là hợp lệ.
 *
 * Mỗi issue: { id, rule, severity: 'error'|'warning', bone,
 *   message, fixId, suggestedName, fixable }. Auto-fix:
 *   add-prefix, sanitize-name, rename-to-standard,
 *   rename-duplicate, reparent-expected. Orientation /
 *   missing-bones / cycle / extra-bone KHÔNG có auto-fix.
 *
 * UI: tab riêng 'validation' ("Kiểm chứng Rig") trong ARP — nút
 * "Kiểm tra", chọn preset, danh sách kết quả + nút "Sửa" từng
 * lỗi + nút "Sửa tất cả".
 * ============================================================ */
(function () {
  'use strict';

  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };
  var U = (window.PixiStudio && PixiStudio.Utils) || null;

  var FALLBACK_DEFS = [
    { name: 'Hips', parent: null }, { name: 'Spine', parent: 'Hips' },
    { name: 'Spine1', parent: 'Spine' }, { name: 'Spine2', parent: 'Spine1' },
    { name: 'Neck', parent: 'Spine2' }, { name: 'Head', parent: 'Neck' },
    { name: 'HeadTop_End', parent: 'Head' },
    { name: 'LeftShoulder', parent: 'Spine2' }, { name: 'LeftArm', parent: 'LeftShoulder' },
    { name: 'LeftForeArm', parent: 'LeftArm' }, { name: 'LeftHand', parent: 'LeftForeArm' },
    { name: 'LeftHandThumb1', parent: 'LeftHand' }, { name: 'LeftHandThumb2', parent: 'LeftHandThumb1' },
    { name: 'LeftHandIndex1', parent: 'LeftHand' }, { name: 'LeftHandIndex2', parent: 'LeftHandIndex1' },
    { name: 'LeftHandMiddle1', parent: 'LeftHand' }, { name: 'LeftHandMiddle2', parent: 'LeftHandMiddle1' },
    { name: 'LeftHandRing1', parent: 'LeftHand' }, { name: 'LeftHandRing2', parent: 'LeftHandRing1' },
    { name: 'LeftHandPinky1', parent: 'LeftHand' },
    { name: 'RightShoulder', parent: 'Spine2' }, { name: 'RightArm', parent: 'RightShoulder' },
    { name: 'RightForeArm', parent: 'RightArm' }, { name: 'RightHand', parent: 'RightForeArm' },
    { name: 'RightHandThumb1', parent: 'RightHand' }, { name: 'RightHandThumb2', parent: 'RightHandThumb1' },
    { name: 'RightHandIndex1', parent: 'RightHand' }, { name: 'RightHandIndex2', parent: 'RightHandIndex1' },
    { name: 'RightHandMiddle1', parent: 'RightHand' }, { name: 'RightHandMiddle2', parent: 'RightHandMiddle1' },
    { name: 'RightHandRing1', parent: 'RightHand' }, { name: 'RightHandRing2', parent: 'RightHandRing1' },
    { name: 'RightHandPinky1', parent: 'RightHand' },
    { name: 'LeftUpLeg', parent: 'Hips' }, { name: 'LeftLeg', parent: 'LeftUpLeg' },
    { name: 'LeftFoot', parent: 'LeftLeg' }, { name: 'LeftToeBase', parent: 'LeftFoot' },
    { name: 'RightUpLeg', parent: 'Hips' }, { name: 'RightLeg', parent: 'RightUpLeg' },
    { name: 'RightFoot', parent: 'RightLeg' }, { name: 'RightToeBase', parent: 'RightFoot' }
  ];
  function boneDefs() {
    var QR = window.PixiStudio && PixiStudio.ArpQuickRig;
    if (QR && QR.BONE_DEFS && QR.BONE_DEFS.length) return QR.BONE_DEFS;
    return FALLBACK_DEFS;
  }

  var RULES = [
    { id: 'orientation', label: 'Hướng xương', severity: 'warning' },
    { id: 'naming-prefix', label: 'Prefix tên xương', severity: 'error' },
    { id: 'naming-standard', label: 'Tên chuẩn 41 xương', severity: 'error' },
    { id: 'naming-chars', label: 'Ký tự lạ trong tên', severity: 'error' },
    { id: 'hierarchy-parent', label: 'Cha-con đúng chuẩn', severity: 'error' },
    { id: 'hierarchy-orphan', label: 'Xương mồ côi', severity: 'error' },
    { id: 'hierarchy-cycle', label: 'Vòng lặp cha-con', severity: 'error' },
    { id: 'duplicate-name', label: 'Trùng tên xương', severity: 'error' },
    { id: 'missing-bones', label: 'Xương thiếu cho preset', severity: 'warning' }
  ];
  var RULE_BY_ID = {};
  RULES.forEach(function (r) { RULE_BY_ID[r.id] = r; });

  var PRESETS = {
    humanoid: { label: 'Humanoid (41 xương Mixamo)', bones: null /* = chuẩn 41 */ },
    minimal: { label: 'Tối thiểu (15 xương chính)', bones: ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
      'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
      'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'] }
  };

  var ArpValidate = { RULES: RULES, PRESETS: PRESETS, lastResult: null };
  var _issueSeq = 0;

  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message }); } catch (e) {}
  }
  function stripName(name) {
    var s = String(name == null ? '' : name);
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    s = s.replace(/__proxy$/i, '');
    return s;
  }
  ArpValidate.stripName = stripName;
  function prefixOf(name) {
    var m = String(name == null ? '' : name).match(/^(model:{1,2})*(mixamorig:?)/i);
    return m ? (m[1] || '') + (m[2] || '') : '';
  }
  function hasPrefix(name) { return /^mixamorig:?/i.test(String(name || '').replace(/^(model:{1,2})+/i, '')); }

  function traverseSafe(root, fn) {
    var seen = {}, stack = [root];
    while (stack.length) {
      var o = stack.pop();
      if (!o || seen[o.uuid]) continue;
      seen[o.uuid] = true;
      fn(o);
      var kids = o.children || [];
      for (var i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
  }
  function collectBones(root) {
    var out = [];
    if (!root) return out;
    if (root.isBone) return [root];
    if (root.traverse) traverseSafe(root, function (o) { if (o.isBone) out.push(o); });
    return out;
  }
  ArpValidate.collectBones = collectBones;

  function getTarget(target) {
    if (target) return target;
    var QR = window.PixiStudio && PixiStudio.ArpQuickRig;
    if (QR && QR.current && QR.current.target) return QR.current.target;
    if (window.PixiStudio && PixiStudio.Viewport && PixiStudio.Viewport.getMainModel) {
      try { return PixiStudio.Viewport.getMainModel(); } catch (e) {}
    }
    return null;
  }
  function findBone(bones, strippedName) {
    for (var i = 0; i < bones.length; i++) if (stripName(bones[i].name) === strippedName) return bones[i];
    return null;
  }

  function newIssue(rule, severity, bone, message, fix) {
    var issue = { id: 'val-' + (++_issueSeq), rule: rule, severity: severity || RULE_BY_ID[rule].severity,
      bone: bone ? bone.name : null, boneRef: bone || null, message: message,
      fixId: (fix && fix.fixId) || null, suggestedName: (fix && fix.suggestedName) || null,
      fixable: !!(fix && fix.fixId) };
    return issue;
  }

  /* ============================================================
     VALIDATE — chạy đủ 9 rule trên rig hiện tại.
     ============================================================ */
  function validate(target, opts) {
    opts = opts || {};
    target = getTarget(target);
    var t0 = Date.now();
    var defs = boneDefs();
    var stdNames = defs.map(function (d) { return d.name; });
    var stdSet = {};
    stdNames.forEach(function (n) { stdSet[n] = true; });
    var parentOf = {};
    defs.forEach(function (d) { parentOf[d.name] = d.parent; });
    var preset = PRESETS[opts.preset] || PRESETS.humanoid;
    var presetBones = preset.bones || stdNames;
    var threshold = opts.orientationThreshold !== undefined ? opts.orientationThreshold : 30;

    var result = { ok: false, target: target, preset: opts.preset || 'humanoid',
      issues: [], errors: 0, warnings: 0, counts: {}, checkedBones: 0, durationMs: 0 };
    if (!target || !target.traverse) { result.error = 'Chưa có model nào để kiểm chứng.'; return result; }
    var bones = collectBones(target);
    result.checkedBones = bones.length;
    if (!bones.length) { result.error = 'Model chưa có skeleton.'; return result; }
    var issues = result.issues;
    function push(issue) {
      issues.push(issue);
      result.counts[issue.rule] = (result.counts[issue.rule] || 0) + 1;
      if (issue.severity === 'error') result.errors++; else result.warnings++;
    }

    /* --- (8) duplicate-name: đếm tên đầy đủ (kể cả prefix) --- */
    var nameCount = {}, firstOfName = {};
    bones.forEach(function (b) {
      nameCount[b.name] = (nameCount[b.name] || 0) + 1;
      if (!firstOfName[b.name]) firstOfName[b.name] = b;
    });
    var dupSeen = {};
    bones.forEach(function (b) {
      if (nameCount[b.name] > 1 && !dupSeen[b.name]) {
        dupSeen[b.name] = true;
        /* Xương trùng thứ 2 trở đi mới là "bản trùng" cần sửa. */
        var dups = bones.filter(function (x) { return x.name === b.name; });
        for (var i = 1; i < dups.length; i++) {
          push(newIssue('duplicate-name', 'error', dups[i],
            'Trùng tên với ' + (dups.length - 1) + ' xương khác: "' + b.name + '".',
            { fixId: 'rename-duplicate', suggestedName: b.name + '_' + (i + 1) }));
        }
      }
    });

    /* --- (7) hierarchy-cycle: đi lên theo parent, gặp lại = vòng lặp --- */
    bones.forEach(function (b) {
      var seen = {}, w = b, cycled = false;
      while (w) {
        if (seen[w.uuid]) { cycled = true; break; }
        seen[w.uuid] = true;
        w = w.parent;
      }
      if (cycled) push(newIssue('hierarchy-cycle', 'error', b,
        'Vòng lặp cha-con: đi lên từ "' + b.name + '" gặp lại chính nó.', null));
    });

    /* --- Hips + tập xương nối tới Hips (đi xuống theo con xương) --- */
    var hips = findBone(bones, 'Hips');
    var reachable = {};
    if (hips) traverseSafe(hips, function (o) { if (o.isBone) reachable[o.uuid] = true; });

    /* --- (2)(3)(4) naming + (5)(6) hierarchy + (1) orientation --- */
    var T = window.THREE;
    var posOf = null, quatOf = null;
    if (T) {
      try { target.updateMatrixWorld(true); } catch (e) {}
      posOf = function (b) { return new T.Vector3().setFromMatrixPosition(b.matrixWorld); };
      quatOf = function (b) { var q = new T.Quaternion(); b.getWorldQuaternion(q); return q; };
    }
    bones.forEach(function (b) {
      var stripped = stripName(b.name);
      var isProxy = /__proxy$/i.test(String(b.name || '')) || (b.userData && b.userData.isProxy);
      var baseName = isProxy ? stripped : stripped;

      /* (2) naming-prefix — xương __proxy vẫn phải có prefix. */
      if (!hasPrefix(b.name)) {
        push(newIssue('naming-prefix', 'error', b,
          'Thiếu prefix "mixamorig:" — tên hiện tại: "' + b.name + '".',
          { fixId: 'add-prefix', suggestedName: 'mixamorig:' + baseName }));
      }
      /* (4) naming-chars — ký tự lạ / khoảng trắng (cho phép chữ,
         số, ':', '_' và '-'). */
      if (/[^A-Za-z0-9_:\-]/.test(String(b.name || ''))) {
        var clean = String(b.name || '').replace(/[^A-Za-z0-9_:\-]/g, '');
        push(newIssue('naming-chars', 'error', b,
          'Tên chứa ký tự lạ / khoảng trắng: "' + b.name + '".',
          { fixId: 'sanitize-name', suggestedName: clean || 'Bone' }));
      }
      /* (3) naming-standard. */
      if (!stdSet[baseName] && !isProxy) {
        var longest = null;
        stdNames.forEach(function (s) {
          if (baseName.indexOf(s) === 0 && (!longest || s.length > longest.length)) longest = s;
        });
        if (longest) {
          var suffix = baseName.slice(longest.length);
          if (/^_\d+$/.test(suffix)) {
            /* _2, _1: hậu tố khử trùng kiểu Blender — chỉ cảnh báo. */
            push(newIssue('naming-standard', 'warning', b,
              'Tên "' + b.name + '" là bản trùng đã khử (' + longest + suffix + '), không thuộc chuẩn 41.', null));
          } else if (/^[_-]/.test(suffix)) {
            /* Hậu tố bắt đầu bằng _ / - (vd RightFoot_Bad): gần như
               chắc chắn là tên chuẩn bị đổi nhầm → lỗi + gợi ý sửa.
               Ngược lại (vd LeftHandThumb3 — hậu tố 'Thumb3' dính
               liền, là đốt ngón thật) thì chỉ là xương thừa. */
            var taken = !!findBone(bones, longest);
            push(newIssue('naming-standard', 'error', b,
              'Tên "' + b.name + '" không thuộc chuẩn 41 xương — có vẻ là "' + longest + '" bị đổi tên.',
              taken ? null : { fixId: 'rename-to-standard', suggestedName: (prefixOf(b.name) || 'mixamorig:') + longest }));
          } else {
            push(newIssue('naming-standard', 'warning', b,
              'Xương thừa ngoài chuẩn 41: "' + b.name + '" (vd đốt ngón thêm / Toe_End) — vẫn hợp lệ, chỉ báo để biết.', null));
          }
        } else {
          push(newIssue('naming-standard', 'warning', b,
            'Xương thừa ngoài chuẩn 41: "' + b.name + '" (vd đốt ngón thêm / Toe_End) — vẫn hợp lệ, chỉ báo để biết.', null));
        }
      }
      /* (5) hierarchy-parent — chỉ xét xương chuẩn có cha là xương. */
      if (stdSet[baseName] && parentOf[baseName] && b.parent && b.parent.isBone) {
        var actualParent = stripName(b.parent.name);
        if (actualParent !== parentOf[baseName]) {
          var expected = findBone(bones, parentOf[baseName]);
          push(newIssue('hierarchy-parent', 'error', b,
            'Cha sai: "' + b.name + '" đang là con của "' + b.parent.name +
            '", theo chuẩn phải là con của "' + parentOf[baseName] + '".',
            expected ? { fixId: 'reparent-expected', suggestedName: parentOf[baseName] } : null));
        }
      }
      /* (6) hierarchy-orphan — không nối tới Hips (trừ chính Hips). */
      if (b !== hips && !reachable[b.uuid]) {
        var expParent = stdSet[baseName] ? parentOf[baseName] : null;
        var expBone = expParent ? findBone(bones, expParent) : null;
        push(newIssue('hierarchy-orphan', 'error', b,
          'Xương mồ côi: "' + b.name + '" không nối tới Hips.' +
          (expParent ? (' Theo chuẩn phải là con của "' + expParent + '".') : ''),
          expBone ? { fixId: 'reparent-expected', suggestedName: expParent }
                  : (hips ? { fixId: 'reparent-expected', suggestedName: 'Hips' } : null)));
      }
      /* (1) orientation — local +Y so với hướng tới (các) xương con:
         lấy góc NHỎ NHẤT (Hips có cả chân + spine, Hand có cả ngón). */
      if (T && posOf && quatOf && !isProxy) {
        var kids = (b.children || []).filter(function (c) { return c && c.isBone; });
        if (kids.length) {
          var yAxis = new T.Vector3(0, 1, 0).applyQuaternion(quatOf(b));
          var bp = posOf(b), minAngle = 180;
          kids.forEach(function (k) {
            var d = posOf(k).sub(bp);
            if (d.lengthSq() < 1e-12) return;
            d.normalize();
            var ang = Math.acos(Math.max(-1, Math.min(1, d.dot(yAxis)))) * 180 / Math.PI;
            if (ang < minAngle) minAngle = ang;
          });
          if (minAngle > threshold) {
            push(newIssue('orientation', 'warning', b,
              'Trục chính lệch ' + minAngle.toFixed(1) + '° so với hướng xương con (ngưỡng ' + threshold +
              '°) — kiểm tra lại hướng xương "' + b.name + '".', null));
          }
        }
      }
    });

    /* --- (9) missing-bones cho preset --- */
    presetBones.forEach(function (std) {
      if (!findBone(bones, std)) {
        push(newIssue('missing-bones', 'warning', null,
          'Thiếu xương "' + std + '" cho preset ' + (opts.preset || 'humanoid') + '.', null));
      }
    });

    result.ok = true;
    result.durationMs = Date.now() - t0;
    ArpValidate.lastResult = result;
    return result;
  }
  ArpValidate.validate = validate;

  function issuesByRule(result, rule) {
    return (result.issues || []).filter(function (i) { return i.rule === rule; });
  }
  ArpValidate.issuesByRule = issuesByRule;

  /* ============================================================
     AUTO-FIX — sửa 1 issue (đổi tên / gắn lại parent).
     ============================================================ */
  function applyFix(issue, target) {
    if (!issue || !issue.fixId) return { ok: false, error: 'Issue này không có cách sửa tự động.' };
    target = getTarget(target);
    var bone = issue.boneRef;
    if (!bone) {
      /* Tìm lại xương theo tên (issue từ lần validate trước). */
      var bones = collectBones(target);
      for (var i = 0; i < bones.length; i++) if (bones[i].name === issue.bone) { bone = bones[i]; break; }
    }
    if (!bone) return { ok: false, error: 'Không tìm thấy xương "' + issue.bone + '" để sửa.' };
    try {
      if (issue.fixId === 'add-prefix' || issue.fixId === 'sanitize-name' ||
          issue.fixId === 'rename-to-standard' || issue.fixId === 'rename-duplicate') {
        var newName = issue.suggestedName;
        if (!newName) return { ok: false, error: 'Không có tên gợi ý.' };
        /* Không đổi tên thành tên đã có xương khác dùng (trừ chính nó). */
        var clash = collectBones(target).some(function (x) { return x !== bone && x.name === newName; });
        if (clash) return { ok: false, error: 'Tên "' + newName + '" đã có xương khác dùng — bỏ qua để tránh trùng.' };
        var oldName = bone.name;
        bone.name = newName;
        /* Đổi tên track clip theo để clip không mất xương. */
        renameClipTracks(target, oldName, newName);
        return { ok: true, fixId: issue.fixId, bone: newName, detail: oldName + ' → ' + newName };
      }
      if (issue.fixId === 'reparent-expected') {
        var dest = null;
        if (issue.suggestedName) {
          var all = collectBones(target);
          dest = findBone(all, issue.suggestedName);
        }
        if (!dest) {
          var hips = findBone(collectBones(target), 'Hips');
          dest = hips || target;
        }
        if (bone === dest || bone.parent === dest) return { ok: true, fixId: issue.fixId, bone: bone.name, detail: 'Đã đúng parent, không cần gắn lại.' };
        if (typeof bone.attach === 'function' && dest && dest.attach) {
          /* attach() giữ nguyên world transform — xương không nhảy. */
          try { dest.attach(bone); }
          catch (e) { dest.add(bone); }
        } else if (dest && dest.add) {
          dest.add(bone);
        } else {
          return { ok: false, error: 'Không gắn được "' + bone.name + '" vào "' + (dest && dest.name) + '".' };
        }
        return { ok: true, fixId: issue.fixId, bone: bone.name, detail: bone.name + ' → con của ' + dest.name };
      }
      return { ok: false, error: 'Fix chưa hỗ trợ: ' + issue.fixId };
    } catch (e) {
      return { ok: false, error: 'Sửa lỗi: ' + (e && e.message) };
    }
  }
  ArpValidate.applyFix = applyFix;

  /* Đổi tên xương trong track clip (tên track dạng 'xương.quaternion'). */
  function renameClipTracks(target, oldName, newName) {
    if (!target) return 0;
    var clips = target.animations || [];
    if ((!clips || !clips.length) && target.userData && target.userData.clips) clips = target.userData.clips;
    var changed = 0;
    (clips || []).forEach(function (clip) {
      (clip.tracks || []).forEach(function (track) {
        if (track.name && track.name.indexOf(oldName + '.') === 0) {
          track.name = newName + track.name.slice(oldName.length);
          changed++;
        }
      });
    });
    return changed;
  }

  /* Sửa tất cả lỗi sửa được, rồi validate lại để báo cáo còn lại. */
  function autoFixAll(result, target, opts) {
    opts = opts || {};
    target = getTarget(target);
    if (!result || !result.issues) return { ok: false, error: 'Chưa có kết quả kiểm chứng.' };
    var applied = [], failed = [];
    /* Sửa tên trước, gắn parent sau (đổi tên có thể làm parent tìm
       đúng hơn ở bước sau). */
    var order = { 'add-prefix': 1, 'sanitize-name': 2, 'rename-to-standard': 3, 'rename-duplicate': 4, 'reparent-expected': 5 };
    var fixable = result.issues.filter(function (i) { return i.fixable; }).slice();
    fixable.sort(function (a, b) { return (order[a.fixId] || 9) - (order[b.fixId] || 9); });
    fixable.forEach(function (issue) {
      var r = applyFix(issue, target);
      if (r.ok) applied.push({ issue: issue, result: r });
      else failed.push({ issue: issue, error: r.error });
    });
    var revalidated = null;
    try { revalidated = validate(target, { preset: result.preset, orientationThreshold: opts.orientationThreshold }); } catch (e) {}
    try { bus.emit('arp:validate-fixed', { applied: applied.length, failed: failed.length }); } catch (e) {}
    return { ok: true, applied: applied, failed: failed,
      appliedCount: applied.length, failedCount: failed.length, revalidated: revalidated };
  }
  ArpValidate.autoFixAll = autoFixAll;

  /* ---------- UI: tab 'validation' ---------- */
  function el(tag, attrs, children) {
    if (U && typeof U.el === 'function') return U.el(tag, attrs, children);
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null) return;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    }
    return node;
  }

  function render(container) {
    if (!container) return;
    container.innerHTML = '';
    var msg = el('div', { class: 'arp-note', id: 'arp-val-msg' });
    function say(t) { msg.textContent = t; }
    container.appendChild(el('div', { class: 'arp-note', html:
      '<b>Kiểm chứng Rig (9 rule):</b> hướng xương · prefix · tên chuẩn 41 · ký tự lạ · ' +
      'cha-con · mồ côi · vòng lặp · trùng tên · xương thiếu cho preset. ' +
      'Lỗi (đỏ) cần sửa — cảnh báo (vàng) chỉ để biết (vd rig thiếu xương ngón là hợp lệ).' }));
    var presetSel = el('select', { class: 'arp-select' });
    Object.keys(PRESETS).forEach(function (k) {
      presetSel.appendChild(el('option', { value: k, text: PRESETS[k].label }));
    });
    var listEl = el('div', { id: 'arp-val-list' });
    var current = null;
    function showResult(r) {
      current = r;
      listEl.innerHTML = '';
      if (!r.ok) { listEl.appendChild(el('div', { class: 'arp-note', text: 'Lỗi: ' + (r.error || '') })); return; }
      listEl.appendChild(el('div', { class: 'arp-note', html:
        '<b>Kết quả:</b> ' + r.checkedBones + ' xương đã kiểm · ' +
        '<span style="color:#e5484d"><b>' + r.errors + ' lỗi</b></span> · ' +
        '<span style="color:#f5a524"><b>' + r.warnings + ' cảnh báo</b></span> · ' + r.durationMs + 'ms.' }));
      if (!r.issues.length) {
        listEl.appendChild(el('div', { class: 'arp-note', text: '✅ Rig sạch — 0 lỗi, 0 cảnh báo.' }));
        return;
      }
      r.issues.forEach(function (issue) {
        var row = el('div', { class: 'arp-val-row' });
        var badge = el('span', { text: issue.severity === 'error' ? '❌ LỖI' : '⚠️ CẢNH BÁO',
          style: 'color:' + (issue.severity === 'error' ? '#e5484d' : '#f5a524') + ';font-weight:bold;margin-right:6px;' });
        row.appendChild(badge);
        row.appendChild(el('span', { text: '[' + (RULE_BY_ID[issue.rule] ? RULE_BY_ID[issue.rule].label : issue.rule) + '] ' + issue.message + ' ' }));
        if (issue.fixable) {
          row.appendChild(el('button', { class: 'arp-btn', text: '🛠 Sửa tự động' + (issue.suggestedName ? ' → ' + issue.suggestedName : ''),
            onclick: function () {
              var fr = applyFix(issue);
              say(fr.ok ? ('Đã sửa: ' + (fr.detail || issue.bone)) : ('Không sửa được: ' + (fr.error || '')));
              runCheck();
            } }));
        }
        listEl.appendChild(row);
      });
    }
    function runCheck() {
      var r = validate(null, { preset: presetSel.value });
      showResult(r);
      say(r.ok ? ('Đã kiểm tra ' + r.checkedBones + ' xương: ' + r.errors + ' lỗi, ' + r.warnings + ' cảnh báo.') : ('Lỗi: ' + (r.error || '')));
    }
    var checkBtn = el('button', { class: 'arp-btn arp-btn-primary', text: '🔍 Kiểm tra', onclick: runCheck });
    var fixAllBtn = el('button', { class: 'arp-btn', text: '🛠 Sửa tất cả lỗi sửa được', onclick: function () {
      if (!current || !current.ok) { say('Bấm "Kiểm tra" trước.'); return; }
      var r = autoFixAll(current);
      if (r.revalidated) showResult(r.revalidated);
      say('Đã sửa ' + r.appliedCount + ' lỗi' + (r.failedCount ? (', ' + r.failedCount + ' lỗi không sửa được.') : '.') +
        (r.revalidated ? (' Còn lại: ' + r.revalidated.errors + ' lỗi, ' + r.revalidated.warnings + ' cảnh báo.') : ''));
    } });
    var topRow = el('div', { class: 'arp-val-row' });
    topRow.appendChild(el('span', { text: 'Preset: ' }));
    topRow.appendChild(presetSel);
    topRow.appendChild(checkBtn);
    topRow.appendChild(fixAllBtn);
    container.appendChild(topRow);
    container.appendChild(listEl);
    container.appendChild(msg);
    try { runCheck(); } catch (e) { say('Lỗi dựng tab Kiểm chứng: ' + (e && e.message)); }
  }

  try {
    var Panel = window.PixiStudio && PixiStudio.ArpPanel;
    if (Panel && typeof Panel.registerTab === 'function') Panel.registerTab('validation', 'Kiểm chứng Rig', render);
  } catch (e) {}

  ArpValidate._test = { RULES: RULES, PRESETS: PRESETS, prefixOf: prefixOf, hasPrefix: hasPrefix,
    findBone: findBone, renameClipTracks: renameClipTracks, render: render };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpValidate = ArpValidate;
})();
