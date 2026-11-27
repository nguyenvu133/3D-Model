/* ============================================================
 * rig/arp-remap.js — TAB REMAP (PHẦN B của "Auto Rig Pro Blend")
 *
 * Retarget clip animation sang rig đích (skeleton Mixamo 41 xương
 * do AutoRigPro dựng) bằng cách map track theo TÊN XƯƠNG CHUẨN:
 * strip prefix "mixamorig:" rồi so khớp không phân biệt hoa thường
 * (cùng logic compat của 3dTencent: compat = track khớp / tổng track;
 * từ chối khi < 80%).
 *
 *   • listClips()            — liệt kê clip có sẵn trong studio
 *   • retargetClip(clip, targetRig) — map track + report compat
 *   • previewRemapped(clip)  — phát thử clip đã remap trong viewport
 *   • exportClipJSON(clip)   — xuất clip đã remap ra JSON tải về
 *     (format "pixistudio-arp-clips-1", cùng dạng track {name, times,
 *     values} như pixistudio-coco-clips-1 / pixistudio-hy3d-clips-1)
 *   • renderRemapTab(container) — UI tab, đăng ký qua ArpPanel khi có
 *
 * ĐỊNH NGHĨA COMPAT (theo spec tab Remap, giống 3dTencent):
 *   compat = số xương ĐÍCH được clip phủ / tổng số xương rig đích.
 *   Clip đủ 41/41 xương → 100%; clip chỉ có 20/41 → ~49% → từ chối;
 *   35/41 → ~85% → cho qua, 6 xương rig không được phủ nằm trong
 *   report.missing. "skipped" = xương CỦA CLIP không có trong rig
 *   đích nên bị bỏ track.
 *   HỆ QUẢ: clip từng phần (vd AnimAutoGen Idle chỉ animate 7 xương)
 *   sẽ bị từ chối theo luật này dù track của nó khớp hết — luật đo
 *   độ phủ rig, không đo độ khớp của clip. Muốn cho clip từng phần
 *   qua thì phải hạ MIN_COMPAT hoặc đổi mẫu số (chưa làm).
 *   AUTO KHỚP (js/rig/arp-automatch.js, 2026-11-27): rig đích thiếu
 *   xương ngón (vd chibi không có Middle/Ring/Pinky) thì track clip
 *   của xương thiếu KHÔNG bị bỏ — nó được remap về xương nguồn mà
 *   AutoMatch đã khớp (gộp ngón → Index, hoặc xương cha → Hand) và
 *   tính vào compat như xương được phủ. Nhờ vậy clip Mixamo đủ 41
 *   xương không bị từ chối oan trên rig chibi 23–36 xương.
 *   result.autoMatched = [{clipBone, dstBone, method, confidence}]
 *   liệt kê các track đi qua auto khớp; xương đích thật vẫn ưu tiên
 *   khớp theo tên trước (boneMap), auto khớp chỉ là fallback.
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Chỉ map theo tên xương — KHÔNG xử lý khác tỉ lệ xương, khác
 *     hướng rest-pose, hay khác trục quay giữa 2 rig. Clip từ rig có
 *     tỉ lệ khác (vd chibi đầu to vs người thật) sẽ phát đúng tên
 *     xương nhưng tư thế có thể lệch.
 *   • Track .position của Hips được giữ nguyên giá trị gốc (root
 *     motion theo đúng clip nguồn); nếu 2 rig cao khác nhau thì nhân
 *     vật có thể trượt chân / lơ lửng — xem retargetClip opts.scaleRoot.
 *   • Không retarget morph target / blend shape, chỉ bone tracks.
 * ============================================================ */
(function () {
  'use strict';

  var bus = PixiStudio.bus;
  var U = PixiStudio.Utils;

  var MIN_COMPAT = 0.80;   /* < 80% → từ chối, giống 3dTencent */
  var FORMAT = 'pixistudio-arp-clips-1';

  var ArpRemap = {
    MIN_COMPAT: MIN_COMPAT,
    FORMAT: FORMAT,
    lastResult: null,      /* kết quả retarget gần nhất */
    lastRemapped: null,    /* THREE.AnimationClip đã remap gần nhất */
    lastReport: null,
    previewing: false
  };

  function notify(type, title, message, duration) {
    if (bus && bus.emit) bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 });
  }

  /* ---------- Tên xương chuẩn: strip "mixamorig:" + lowercase ---------- */
  function normalizeBoneName(name) {
    return String(name || '')
      .replace(/^mixamorig:?/i, '')
      .replace(/^model:?/i, '')
      .trim()
      .toLowerCase();
  }
  ArpRemap.normalizeBoneName = normalizeBoneName;

  /* Track name kiểu "mixamorig:Hips.position" / "Hips.quaternion" →
     { bone: 'mixamorig:Hips', prop: 'position' }. Tách ở dấu '.' CUỐI
     vì tên xương chứa ':' nhưng không chứa '.'. */
  function parseTrackName(trackName) {
    var name = String(trackName || '');
    var dot = name.lastIndexOf('.');
    if (dot <= 0) return null;
    var prop = name.slice(dot + 1);
    if (prop !== 'position' && prop !== 'quaternion' && prop !== 'scale') return null;
    return { bone: name.slice(0, dot), prop: prop };
  }
  ArpRemap.parseTrackName = parseTrackName;

  function getTarget(target) {
    if (target) return target;
    if (PixiStudio.State && PixiStudio.State.get) {
      var sel = PixiStudio.State.get('selection');
      if (sel) return sel;
    }
    if (PixiStudio.Viewport && PixiStudio.Viewport.getMainModel) return PixiStudio.Viewport.getMainModel();
    return null;
  }

  /* ---------- Tên xương của rig đích ----------
     targetRig chấp nhận: rig {bones:{Name:bone}} / {boneList:[bone]},
     THREE.Object3D (quét THREE.Bone), mảng tên, hoặc map tên→tên.
     Trả về map: normalizedName → tên đầy đủ dùng trong track đích
     (ưu tiên dạng "mixamorig:Name" nếu rig dùng prefix đó). */
  function targetBoneMap(targetRig) {
    var map = {};   /* normalized → full track bone name */
    var add = function (fullName) {
      if (!fullName) return;
      var norm = normalizeBoneName(fullName);
      if (!norm) return;
      if (!map[norm]) map[norm] = fullName;
      /* ưu tiên tên có prefix mixamorig: khi trùng normalized */
      if (/^mixamorig:/i.test(fullName)) map[norm] = fullName;
    };
    if (!targetRig) return map;
    if (Array.isArray(targetRig)) {
      targetRig.forEach(function (b) { add(typeof b === 'string' ? b : (b && b.name)); });
      return map;
    }
    if (targetRig.bones) {
      Object.keys(targetRig.bones).forEach(function (k) {
        var b = targetRig.bones[k];
        add(b && b.name ? b.name : ('mixamorig:' + k));
      });
      return map;
    }
    if (targetRig.boneList) {
      targetRig.boneList.forEach(function (b) { add(b && b.name); });
      return map;
    }
    if (targetRig.traverse) {
      targetRig.traverse(function (o) { if (o.isBone) add(o.name); });
      return map;
    }
    if (typeof targetRig === 'object') {
      Object.keys(targetRig).forEach(function (k) { add(targetRig[k]); });
      return map;
    }
    return map;
  }
  ArpRemap.targetBoneMap = targetBoneMap;

  function rigBoneNames(targetRig) {
    var map = targetBoneMap(targetRig);
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  /* ---------- Liệt kê clip có sẵn trong studio ----------
     Nguồn (theo thứ tự ưu tiên, khử trùng theo tên):
       1. RigAutoGen.current.clips (AnimAutoGen procedural, {id, clip})
       2. FbxRig.clips / .animations
       3. Coco / Hy3d / Thandieu .clips ({id, clip})
       4. AutoRigPro.lastResult.rig.clips (nếu có)
       5. Model đang chọn: target.animations (GLTF/FBX load kèm clip)
     Trả về [{ id, name, clip, source }] — clip là THREE.AnimationClip. */
  function listClips(target) {
    var out = [];
    var seen = {};
    var push = function (id, clip, source) {
      if (!clip || !clip.tracks || !clip.name) return;
      var key = String(clip.name);
      if (seen[key]) return;
      seen[key] = true;
      out.push({ id: id || key, name: key, clip: clip, source: source || 'studio' });
    };
    var pushEntries = function (entries, source) {
      if (!entries || !entries.forEach) return;
      entries.forEach(function (e) {
        if (!e) return;
        if (e.clip) push(e.id || e.name, e.clip, source);
        else if (e.tracks) push(e.id || e.name, e, source);
      });
    };
    var RAG = PixiStudio.RigAutoGen;
    if (RAG && RAG.current && RAG.current.clips) pushEntries(RAG.current.clips, 'AnimAutoGen');
    var AAG = PixiStudio.AnimAutoGen;
    if (AAG && AAG.currentClips) pushEntries(AAG.currentClips, 'AnimAutoGen');
    ['FbxRig', 'Coco', 'Hy3d', 'Thandieu'].forEach(function (ns) {
      var mod = PixiStudio[ns];
      if (!mod) return;
      if (mod.clips) pushEntries(mod.clips, ns);
      if (mod.animations) pushEntries(mod.animations, ns);
    });
    var ARP = PixiStudio.AutoRigPro;
    if (ARP && ARP.lastResult && ARP.lastResult.rig && ARP.lastResult.rig.clips) {
      pushEntries(ARP.lastResult.rig.clips, 'AutoRigPro');
    }
    var tgt = target || getTarget();
    if (tgt && tgt.animations) pushEntries(tgt.animations, 'model');
    if (tgt) {
      tgt.traverse(function (o) {
        if (o.animations) pushEntries(o.animations, 'model');
      });
    }
    return out;
  }
  ArpRemap.listClips = listClips;

  function resolveClip(clip) {
    if (!clip) return null;
    if (clip.tracks && clip.name) return clip;              /* AnimationClip */
    if (clip.clip && clip.clip.tracks) return clip.clip;    /* entry {clip} */
    if (typeof clip === 'string') {
      var found = listClips().filter(function (e) { return e.id === clip || e.name === clip; })[0];
      return found ? found.clip : null;
    }
    return null;
  }

  /* ============================================================
     RETARGET — map track xương theo tên chuẩn.
     clip: THREE.AnimationClip | entry {clip} | id string
     targetRig: rig đích (xem targetBoneMap) — mặc định model đang chọn
     opts: { name, scaleRoot } — scaleRoot: hệ số nhân track
       Hips.position (mặc định 1 = giữ nguyên; truyền Hđích/Hnguồn
       nếu 2 rig cao khác nhau để khỏi trượt chân).
     Trả về { ok, clip, compat, mapped, skipped, missing, total,
       reason } — compat < 80% → ok=false, clip=null + notify liệt
     kê xương thiếu.
     ============================================================ */
  function retargetClip(clip, targetRig, opts) {
    opts = opts || {};
    var src = resolveClip(clip);
    var result = { ok: false, clip: null, compat: 0, mapped: 0, skipped: [], missing: [], total: 0, rigBoneTotal: 0, matchedBones: 0, reason: '', autoMatched: [], autoMatchCount: 0 };
    if (!src) {
      result.reason = 'Không tìm thấy clip nguồn (clip rỗng hoặc id không có trong studio).';
      notify('error', 'Remap', result.reason);
      ArpRemap.lastResult = result;
      return result;
    }
    var rig = targetRig || getTarget();
    if (!rig) {
      result.reason = 'Chưa có rig đích — rig model bằng Auto Rig Pro trước, hoặc chọn model đã rig.';
      notify('warning', 'Remap', result.reason);
      ArpRemap.lastResult = result;
      return result;
    }
    var boneMap = targetBoneMap(rig);
    var rigBones = Object.keys(boneMap);
    if (!rigBones.length) {
      result.reason = 'Rig đích không có xương nào (model chưa rig?).';
      notify('warning', 'Remap', result.reason);
      ArpRemap.lastResult = result;
      return result;
    }
    result.rigBoneTotal = rigBones.length;
    /* --- AUTO KHỚP fallback: xương clip (chuẩn 41) không có trong rig
       đích → tra bảng auto khớp của rig đích (gộp ngón / xương cha).
       Chỉ chạy khi ArpAutoMatch đã load; tắt bằng opts.autoMatch=false.
       Tra theo tên đích CHUẨN (vd 'lefthandmiddle1'), đích đến là tên
       xương nguồn thật của rig (vd 'mixamorig:LeftHandIndex1'). --- */
    var amByDst = null;
    if (opts.autoMatch !== false) {
      try {
        var AM = (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.ArpAutoMatch) || null;
        if (AM && typeof AM.autoMatch === 'function') {
          var amRes = AM.autoMatch(rig);
          amByDst = {};
          amRes.mapped.forEach(function (e) {
            /* chỉ các entry tự khớp (không phải name) mới cần fallback —
               entry name đã có trong boneMap rồi */
            if (e.method && e.method !== 'name') {
              amByDst[normalizeBoneName(e.dst)] = { src: e.src, method: e.method, confidence: e.confidence, mergedFrom: e.mergedFrom || null };
            }
          });
        }
      } catch (e) { amByDst = null; }
    }
    var scaleRoot = (typeof opts.scaleRoot === 'number' && isFinite(opts.scaleRoot) && opts.scaleRoot > 0) ? opts.scaleRoot : 1;

    var totalBoneTracks = 0;
    var mappedTracks = 0;
    var skippedSet = {};
    var matchedSet = {};
    var newTracks = [];
    src.tracks.forEach(function (track) {
      var parsed = parseTrackName(track.name);
      if (!parsed) return;   /* track không phải bone (vd morph) → bỏ qua, không đếm */
      totalBoneTracks++;
      var destBone = boneMap[normalizeBoneName(parsed.bone)];
      var viaAuto = null;
      if (!destBone && amByDst) {
        viaAuto = amByDst[normalizeBoneName(parsed.bone)] || null;
        if (viaAuto) {
          destBone = viaAuto.src;
          result.autoMatched.push({ clipBone: parsed.bone, dstBone: destBone, method: viaAuto.method, confidence: viaAuto.confidence, mergedFrom: viaAuto.mergedFrom });
        }
      }
      if (!destBone) {
        skippedSet[parsed.bone] = true;   /* xương clip không có trong rig → bỏ track */
        return;
      }
      /* xương đích được phủ = xương nguồn thật nhận track (vd track
         Middle1 → Index1 thì Index1 được tính là phủ, không đếm
         Middle1 vốn không có trong rig). */
      matchedSet[normalizeBoneName(destBone)] = true;
      var nt = track.clone();
      nt.name = destBone + '.' + parsed.prop;
      /* scale root motion Hips.position nếu 2 rig cao khác nhau */
      if (scaleRoot !== 1 && normalizeBoneName(parsed.bone) === 'hips' && parsed.prop === 'position') {
        var vals = nt.values;
        for (var i = 0; i < vals.length; i++) vals[i] = vals[i] * scaleRoot;
      }
      newTracks.push(nt);
      mappedTracks++;
    });

    /* --- XƯƠNG THỪA ngoài chuẩn 41 (vd Thumb3/4, Index3/4, Toe_End
       của Thiếu Lâm): tính là phủ khi xương tổ tiên gần nhất của
       chúng được clip phủ — skin của chúng đi theo cha. CHỈ áp cho
       xương ngoài chuẩn 41 (không cascade sang xương chuẩn: clip
       thiếu Middle1 thật thì Middle1 vẫn tính là thiếu, từ chối
       đúng luật). Lặp tới fixpoint để Thumb4 theo Thumb3. --- */
    var extraCovered = [];
    try {
      var AM2 = (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.ArpAutoMatch) || null;
      if (AM2 && typeof AM2.collectBones === 'function' && AM2.DST_NAMES) {
        var stdSet = {};
        AM2.DST_NAMES.forEach(function (n) { stdSet[normalizeBoneName(n)] = true; });
        var rigBoneObjs = AM2.collectBones(rig);
        var boneByNorm = {};
        rigBoneObjs.forEach(function (b) { if (b && b.name) boneByNorm[normalizeBoneName(b.name)] = b; });
        var changed = true, guard = 0;
        while (changed && guard++ < 5) {
          changed = false;
          rigBones.forEach(function (norm) {
            if (matchedSet[norm] || stdSet[norm]) return;
            var bone = boneByNorm[norm];
            if (!bone) return;
            var p = bone.parent;
            while (p) {
              if (matchedSet[normalizeBoneName(p.name)]) {
                matchedSet[norm] = true;
                extraCovered.push(boneMap[norm] || bone.name);
                changed = true;
                break;
              }
              p = p.parent;
            }
          });
        }
      }
    } catch (e) {}
    result.extraCovered = extraCovered;

    result.total = totalBoneTracks;
    result.mapped = mappedTracks;
    result.autoMatchCount = result.autoMatched.length;
    result.skipped = Object.keys(skippedSet).sort();
    /* missing = xương RIG ĐÍCH không được clip phủ (để lý do từ chối liệt kê) */
    result.missing = rigBones.filter(function (norm) { return !matchedSet[norm]; })
      .map(function (norm) { return boneMap[norm]; }).sort();
    result.matchedBones = Object.keys(matchedSet).length;
    /* compat = độ phủ rig đích (xem header) */
    result.compat = rigBones.length ? result.matchedBones / rigBones.length : 0;

    if (!totalBoneTracks) {
      result.reason = 'Clip "' + src.name + '" không có track xương nào để remap.';
      notify('error', 'Remap', result.reason);
      ArpRemap.lastResult = result;
      return result;
    }
    if (result.compat < MIN_COMPAT) {
      var shown = result.missing.slice(0, 10);
      result.reason = 'Không tương thích: clip chỉ phủ ' + result.matchedBones + '/' + rigBones.length +
        ' xương rig đích (' + Math.round(result.compat * 100) + '% < 80%). Xương rig thiếu trong clip: ' +
        shown.join(', ') + (result.missing.length > 10 ? ' … +' + (result.missing.length - 10) + ' xương nữa' : '') +
        '. Clip này thuộc rig khác (vd rig 23 xương / skeleton khác tên) — cần clip phủ đủ khung Mixamo 41 xương.';
      notify('error', 'Remap — clip không tương thích', result.reason, 12000);
      ArpRemap.lastResult = result;
      ArpRemap.lastReport = result;
      if (bus && bus.emit) bus.emit('arpremap:rejected', { clip: src.name, compat: result.compat, missing: result.missing });
      return result;
    }

    var newName = opts.name || (src.name + '_remapped');
    var newClip = new THREE.AnimationClip(newName, src.duration, newTracks);
    newClip.userData = { sourceClip: src.name, compat: result.compat, remappedFrom: src.name };
    result.ok = true;
    result.clip = newClip;
    result.reason = '';
    ArpRemap.lastRemapped = newClip;
    ArpRemap.lastResult = result;
    ArpRemap.lastReport = result;
    notify('success', 'Remap xong',
      '"' + src.name + '" → "' + newName + '": phủ ' + result.matchedBones + '/' + rigBones.length +
      ' xương rig (' + Math.round(result.compat * 100) + '%), khớp ' + mappedTracks + '/' + totalBoneTracks + ' track' +
      (result.autoMatchCount ? ' · ' + result.autoMatchCount + ' track tự khớp (' + result.autoMatched.slice(0, 3).map(function (a) { return a.clipBone.split(':').pop() + '→' + a.dstBone.split(':').pop(); }).join(', ') + (result.autoMatchCount > 3 ? '…' : '') + ')' : '') +
      (result.extraCovered && result.extraCovered.length ? ' · ' + result.extraCovered.length + ' xương thừa theo cha (' + result.extraCovered.slice(0, 3).join(', ') + (result.extraCovered.length > 3 ? '…' : '') + ')' : '') +
      (result.missing.length ? ' · ' + result.missing.length + ' xương rig không có trong clip: ' + result.missing.slice(0, 5).join(', ') + (result.missing.length > 5 ? '…' : '') : ' · phủ 100% rig') +
      (result.skipped.length ? ' · bỏ ' + result.skipped.length + ' track xương clip không có trong rig' : ''),
      10000);
    if (bus && bus.emit) bus.emit('arpremap:done', { clip: newName, compat: result.compat, mapped: mappedTracks, skipped: result.skipped, missing: result.missing });
    return result;
  }
  ArpRemap.retargetClip = retargetClip;

  /* ---------- Mixer riêng cho preview (không đụng AnimAutoGen) ---------- */
  var _mixer = null;
  var _mixerRoot = null;
  var _previewAction = null;

  function previewRoot(target) {
    var tgt = target || getTarget();
    if (!tgt) return null;
    /* Ưu tiên rootBone của rig (để clip bind đúng xương) */
    var ARP = PixiStudio.AutoRigPro;
    if (ARP && ARP.lastResult && ARP.lastResult.rig && ARP.lastResult.rig.rootBone) {
      var rb = ARP.lastResult.rig.rootBone;
      var inside = false;
      tgt.traverse(function (o) { if (o === rb) inside = true; });
      if (inside) return rb;
    }
    return tgt;
  }

  /* Phát thử clip đã remap (AnimationClip hoặc kết quả retargetClip).
     Dùng mixer riêng; tick(dt) để chạy trong render loop của studio,
     hoặc gọi ArpRemap.tick(dt) thủ công trong harness. */
  function previewRemapped(clip, target) {
    var c = clip && clip.clip ? clip.clip : resolveClip(clip);
    if (!c) {
      notify('warning', 'Remap preview', 'Chưa có clip đã remap để phát — bấm Retarget trước.');
      return false;
    }
    var root = previewRoot(target);
    if (!root) {
      notify('warning', 'Remap preview', 'Chưa có model/rig để phát thử.');
      return false;
    }
    stopPreview();
    _mixerRoot = root;
    _mixer = new THREE.AnimationMixer(root);
    _previewAction = _mixer.clipAction(c);
    _previewAction.reset();
    _previewAction.setLoop(THREE.LoopRepeat);
    _previewAction.play();
    ArpRemap.previewing = true;
    ArpRemap._mixer = _mixer;
    if (bus && bus.emit) bus.emit('arpremap:preview', { clip: c.name });
    return true;
  }
  ArpRemap.previewRemapped = previewRemapped;

  function tick(dt) {
    if (_mixer && ArpRemap.previewing) _mixer.update(dt);
  }
  ArpRemap.tick = tick;

  function stopPreview() {
    if (_previewAction) { try { _previewAction.stop(); } catch (e) {} }
    if (_mixer) { try { _mixer.stopAllAction(); } catch (e) {} }
    _previewAction = null;
    _mixer = null;
    _mixerRoot = null;
    ArpRemap.previewing = false;
    ArpRemap._mixer = null;
    if (bus && bus.emit) bus.emit('arpremap:preview-stopped', {});
  }
  ArpRemap.stopPreview = stopPreview;

  /* ============================================================
     EXPORT CLIP JSON — cùng dạng track {name, times, values} như
     pixistudio-coco-clips-1 / pixistudio-hy3d-clips-1 (xem
     js/characters/coco.js exportClipsJSON). Một clip → clips[1].
     Trả về { json, text, filename } + tải về qua Utils.downloadText
     (khi chạy trong studio). clipFromJSON() đọc lại thành
     THREE.AnimationClip để kiểm tra round-trip.
     ============================================================ */
  function clipToJSON(clip) {
    var c = resolveClip(clip);
    if (!c) return null;
    return {
      id: c.name,
      name: c.name,
      duration: Math.round(c.duration * 1000) / 1000,
      loop: true,
      source: (c.userData && c.userData.sourceClip) ? ('remapped from ' + c.userData.sourceClip) : 'arpremap',
      tracks: c.tracks.map(function (t) {
        return {
          name: t.name,
          times: Array.from(t.times).map(function (x) { return Math.round(x * 1000) / 1000; }),
          values: Array.from(t.values).map(function (x) { return Math.round(x * 10000) / 10000; })
        };
      })
    };
  }
  ArpRemap.clipToJSON = clipToJSON;

  function clipsToJSON(clips, opts) {
    opts = opts || {};
    var list = Array.isArray(clips) ? clips : [clips];
    var data = list.map(clipToJSON).filter(Boolean);
    var boneNames = [];
    if (opts.boneNames) boneNames = opts.boneNames;
    else {
      var rig = opts.targetRig || getTarget();
      if (rig) boneNames = rigBoneNames(rig);
    }
    return {
      format: FORMAT,
      character: opts.character || 'arp-remap',
      skeleton: { boneNames: boneNames, boneCount: boneNames.length },
      compat: ArpRemap.lastReport ? ArpRemap.lastReport.compat : undefined,
      clips: data
    };
  }
  ArpRemap.clipsToJSON = clipsToJSON;

  function exportClipJSON(clip, opts) {
    opts = opts || {};
    var c = resolveClip(clip) || ArpRemap.lastRemapped;
    if (!c) {
      notify('warning', 'Remap export', 'Chưa có clip đã remap để xuất — bấm Retarget trước.');
      return null;
    }
    var json = clipsToJSON([c], opts);
    var text = JSON.stringify(json, null, 1);
    var filename = (opts.filename || (String(c.name).replace(/[^\w\-]+/g, '_') + '_remapped')) + '.json';
    if (!/\.json$/i.test(filename)) filename += '.json';
    var out = { json: json, text: text, filename: filename, trackCount: c.tracks.length };
    if (U && U.downloadText) U.downloadText(text, filename, 'application/json');
    notify('success', 'Remap export', filename + ' — ' + c.tracks.length + ' tracks · ' + text.length + ' B.');
    if (bus && bus.emit) bus.emit('arpremap:exported', { filename: filename, tracks: c.tracks.length });
    return out;
  }
  ArpRemap.exportClipJSON = exportClipJSON;

  function clipFromJSON(json) {
    var data = typeof json === 'string' ? JSON.parse(json) : json;
    var entry = (data.clips && data.clips[0]) || data;
    if (!entry || !entry.tracks) return null;
    var tracks = entry.tracks.map(function (t) {
      var prop = t.name.slice(t.name.lastIndexOf('.') + 1);
      var times = new Float32Array(t.times);
      var values = new Float32Array(t.values);
      if (prop === 'quaternion') return new THREE.QuaternionKeyframeTrack(t.name, times, values);
      return new THREE.VectorKeyframeTrack(t.name, times, values);
    });
    return new THREE.AnimationClip(entry.name || entry.id || 'clip', entry.duration || 0, tracks);
  }
  ArpRemap.clipFromJSON = clipFromJSON;

  /* ============================================================
     UI TAB — dựng bằng PixiStudio.Utils.el khi có, fallback DOM thuần.
     Đăng ký qua ArpPanel.registerTab('remap', ...) khi shell đã load;
     nếu chưa có shell thì tab vẫn dùng được qua ArpRemap.renderRemapTab.
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
      children.forEach(function (c) {
        if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function renderRemapTab(container) {
    if (!container) return;
    container.innerHTML = '';
    var state = { selectedId: '', result: null };

    var head = el('div', { class: 'dim small', style: 'line-height:1.6;margin-bottom:8px;', text: 'Retarget clip sang rig Auto Rig Pro (41 xương Mixamo) bằng tên xương chuẩn. Tương thích ≥ 80% mới cho phát/xuất; dưới 80% sẽ liệt kê xương thiếu. Chỉ map theo tên — chưa xử lý khác tỉ lệ xương.' });
    container.appendChild(head);

    var select = el('select', { class: 'arp-select', style: 'width:100%;margin-bottom:8px;' });
    var refreshList = function () {
      var clips = listClips();
      select.innerHTML = '';
      if (!clips.length) {
        var opt0 = document.createElement('option');
        opt0.textContent = '— Chưa có clip nào (rig AnimAutoGen / load FBX kèm clip trước) —';
        opt0.value = '';
        select.appendChild(opt0);
      } else {
        clips.forEach(function (e) {
          var opt = document.createElement('option');
          opt.value = e.id;
          opt.textContent = e.name + '  ·  ' + e.clip.tracks.length + ' tracks  ·  ' + e.source;
          select.appendChild(opt);
        });
      }
      state.selectedId = select.value;
    };
    select.addEventListener('change', function () { state.selectedId = select.value; });
    refreshList();
    container.appendChild(select);
    container.appendChild(el('button', {
      class: 'btn', style: 'margin-bottom:8px;',
      text: '↻ Làm mới danh sách clip',
      onclick: function () { refreshList(); renderResult(); }
    }));

    var resultBox = el('div', { class: 'arp-remap-result small', style: 'line-height:1.6;margin-bottom:8px;' });
    var renderResult = function () {
      var r = state.result;
      if (!r) { resultBox.textContent = 'Chưa retarget.'; return; }
      if (!r.ok) {
        resultBox.innerHTML = '';
        resultBox.appendChild(el('div', { style: 'color:var(--error,#f66);', html: '<b>✕ Từ chối:</b> tương thích ' + Math.round(r.compat * 100) + '% &lt; 80% (phủ ' + r.matchedBones + '/' + r.rigBoneTotal + ' xương rig).' }));
        resultBox.appendChild(el('div', { text: 'Xương rig thiếu trong clip (' + r.missing.length + '): ' + r.missing.join(', ') }));
        return;
      }
      resultBox.innerHTML = '';
      resultBox.appendChild(el('div', { style: 'color:var(--success,#4c4);', html: '<b>✓ Tương thích ' + Math.round(r.compat * 100) + '%</b> — phủ ' + r.matchedBones + '/' + r.rigBoneTotal + ' xương rig, khớp ' + r.mapped + '/' + r.total + ' track.' }));
      if (r.autoMatchCount) resultBox.appendChild(el('div', { text: 'Tự khớp ' + r.autoMatchCount + ' track: ' + r.autoMatched.map(function (a) { return a.clipBone + ' → ' + a.dstBone + ' (' + a.method + ' ' + a.confidence + '%)'; }).join(', ') }));
      if (r.missing.length) resultBox.appendChild(el('div', { text: 'Xương rig không có trong clip (' + r.missing.length + '): ' + r.missing.join(', ') }));
      else resultBox.appendChild(el('div', { text: 'Phủ 100% rig — không thiếu xương nào.' }));
      if (r.skipped.length) resultBox.appendChild(el('div', { text: 'Track xương clip bị bỏ (không có trong rig): ' + r.skipped.join(', ') }));
    };
    renderResult();
    container.appendChild(resultBox);

    var btnRow = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;' });
    btnRow.appendChild(el('button', {
      class: 'btn primary', text: '⇄ Retarget',
      onclick: function () {
        if (!state.selectedId) { notify('warning', 'Remap', 'Chưa chọn clip nguồn.'); return; }
        state.result = retargetClip(state.selectedId, null, {});
        renderResult();
      }
    }));
    btnRow.appendChild(el('button', {
      class: 'btn', text: '▶ Phát thử',
      onclick: function () {
        var c = state.result && state.result.clip;
        if (!c) { notify('warning', 'Remap preview', 'Bấm Retarget trước rồi mới phát thử.'); return; }
        previewRemapped(c);
      }
    }));
    btnRow.appendChild(el('button', {
      class: 'btn', text: '■ Dừng',
      onclick: function () { stopPreview(); }
    }));
    btnRow.appendChild(el('button', {
      class: 'btn', text: '⬇ Xuất JSON',
      onclick: function () {
        var c = state.result && state.result.clip;
        if (!c) { notify('warning', 'Remap export', 'Bấm Retarget trước rồi mới xuất JSON.'); return; }
        exportClipJSON(c);
      }
    }));
    container.appendChild(btnRow);
  }
  ArpRemap.renderRemapTab = renderRemapTab;

  /* Đăng ký tab khi shell đã có (agent khác xây ArpPanel); guard để
     module vẫn chạy độc lập khi shell chưa load. */
  if (window.PixiStudio && PixiStudio.ArpPanel && typeof PixiStudio.ArpPanel.registerTab === 'function') {
    PixiStudio.ArpPanel.registerTab('remap', 'Remap', renderRemapTab);
  }

  ArpRemap._test = {
    normalizeBoneName: normalizeBoneName,
    parseTrackName: parseTrackName,
    targetBoneMap: targetBoneMap,
    rigBoneNames: rigBoneNames,
    listClips: listClips,
    retargetClip: retargetClip,
    clipToJSON: clipToJSON,
    clipFromJSON: clipFromJSON,
    previewRoot: previewRoot
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpRemap = ArpRemap;
})();
