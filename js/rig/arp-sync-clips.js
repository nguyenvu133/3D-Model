/* ============================================================
 * rig/arp-sync-clips.js — ĐỒNG BỘ CLIP + POSE DÙNG CHUNG
 * (Auto Rig Pro Blend, vòng đồng bộ Quick Rig <-> Animator — PHẦN 1/4)
 *
 * MỘT NGUỒN CLIP DUY NHẤT cho cả Quick Rig và Animator:
 *   PixiStudio.ArpSyncClips.listAllClips() liệt kê TẤT CẢ clip
 *   từ mọi nguồn thật trong studio (xem §1). Animator PHẢI dùng
 *   hàm này làm nguồn danh sách (qua animatorEntries() — map sang
 *   đúng shape/id mà Animator.refreshClips() đang dùng) thay vì
 *   tự liệt kê riêng từng module. File này KHÔNG sửa Animator:
 *   coordinator gộp sẽ đổi Animator.refreshClips() sang gọi
 *   ArpSyncClips.listAllClips() (xem §"CẦN COORDINATOR GỘP" cuối file).
 *
 *   1. DANH SÁCH CLIP (§1):
 *      • mixamo   — clip đã gắn vào QuickRig.current.clips
 *        (attachMixamoClips) + clip file FBX/GLB trong Anim.clips
 *        (không phải preset).
 *      • studio   — preset procedural Anim.clips (isPreset) +
 *        10 định nghĩa AnimAutoGen (chỉ phát, không có clip THREE
 *        riêng — clipObject=null trừ khi RigAutoGen.current.clips
 *        đã sinh) + ArpRemap.listClips() nguồn AnimAutoGen.
 *      • keyframe — clip QR3 đang ghi trong Keyframe.clip (keys) +
 *        THREE.AnimationClip dựng bằng Keyframe.buildAnimationClip().
 *      • retarget — clip đã remap thành công (ArpRemap.lastRemapped
 *        + registry của module này, xem registerRetargetClip).
 *        Live Retarget preview KHÔNG có clip object expose ra
 *        ngoài (chỉ getState().clipName) nên không liệt kê được
 *        clip đang preview — xem GIỚI HẠN.
 *      • coco / hy3d — PS.Coco.clips / PS.Hy3d.clips sau khi nhân
 *        vật đã load (trước lúc đó nguồn vắng, không bịa clip).
 *      Mỗi entry: {id, name, source, duration, fps, loop,
 *        clipObject (THREE.AnimationClip|null), keys (keyframe raw
 *        hoặc null), trackCount, note}. id có prefix theo nguồn.
 *
 *   2. PHÁT CHUNG (§2): playClip(id) phát qua Animator (mixer
 *      riêng của Animator trên đúng target đó, hoặc ủy thác
 *      Keyframe.tick cho clip keyframe) — KHÔNG tạo skeleton hay
 *      clip copy riêng: clipObject gốc được đăng ký vào Animator
 *      bằng registerClip(userCreated:false) rồi phát; xương đọc
 *      sau khi phát là xương thật của model/QuickRig.current.target.
 *
 *   3. KEYFRAME → ANIMATOR TỨC THÌ (§3): installWrappers() bọc
 *      (wrap) runtime Keyframe.recordKey / exportClip / importClip /
 *      newClip và ArpRemap.retargetClip: gọi hàm gốc rồi emit bus
 *      'arp:animator-clip-changed' {kind, name, keyCount, duration}.
 *      KHÔNG sửa file keyframe.js / remap.js. listAllClips() đọc
 *      trực tiếp Keyframe.clip mỗi lần gọi nên clip mới xuất hiện
 *      ngay, không cần tải lại trang/tab. Wrap chỉ hoạt động khi
 *      module này load SAU module gốc (gọi lại installWrappers()
 *      nếu module gốc load muộn); wrap 2 lần không nhân đôi event.
 *
 *   4. SỬA CLIP KEYFRAME (§4): 4 hàm pure trimClip / retimeClip /
 *      reverseClip / mirrorClip nhận clip object (THREE clip, clip
 *      plain {tracks} hoặc clip keyframe {keys}), trả clip MỚI
 *      cùng dạng, KHÔNG ghi đè clip gốc. Clip keyframe được sửa
 *      trực tiếp trên keys (giữ nguyên FK state); clip THREE sửa
 *      trên tracks (sample/slerp như Animator). editClip() là cầu
 *      nối cho Animator: sửa clip keyframe đang chọn rồi đăng ký
 *      kết quả vào Animator (user clip) để phát ngay.
 *
 *   5. POSE DÙNG CHUNG (§5): Pose Library (QR3-pose: 8 preset +
 *      pose tự lưu ở localStorage) gọi được từ Animator:
 *      applyPoseFromLibrary(poseId) áp pose lên frame hiện tại
 *      (tạm dừng clip đang phát để pose không bị tick ghi đè),
 *      saveCurrentPoseToLibrary(name) lưu pose hiện tại của
 *      Animator vào Pose Library, mirrorPose / mirrorCurrentPose
 *      (áp → mirror → mirror lại = về pose gốc, theo đúng luật
 *      mirror của Pose: đổi Left<->Right + giữ x, đảo dấu y,z).
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Wrap runtime chỉ bọc được hàm đã tồn tại lúc installWrappers
 *     chạy; module gốc load SAU sync thì phải gọi lại installWrappers().
 *   • Animator hiện tại vẫn có refreshClips() riêng (chưa đổi sang
 *     listAllClips) — tới lúc coordinator gộp mới là 1 nguồn thật
 *     trong UI; module này đã cung cấp animatorEntries() + playClip()
 *     để việc đổi đó chỉ là thay nguồn liệt kê.
 *   • Clip keyframe đã sửa (trim/retime/reverse/mirror) giữ pose +
 *     hips nhưng FK state (fingerCurl/footRoll/head/neck/jaw) chỉ
 *     giữ khi sửa trực tiếp trên keys (trim/retime/reverse/mirror
 *     của module này làm vậy); bản THREE build từ keys không mang FK.
 *   • Mirror clip THREE đúng qua mặt phẳng dọc YZ (Nhóm B,
 *     arp-restpose.js): đổi cặp L/R + quat (x,−y,−z,w) / vị trí
 *     (−x,y,z); xương chỉ có 1 bên được tạo track bên kia.
 *   • Clip studio autogen chỉ phát được (không scrub/chỉnh sửa)
 *     vì AnimAutoGen không expose clip THREE (giới hạn của Animator).
 *   • Retarget chỉ liệt kê clip đã remap XONG (lastRemapped /
 *     registry); clip đang preview trong Live Retarget không có
 *     clip object để liệt kê. Clip phủ rig < 80% bị Remap từ chối
 *     nên không bao giờ vào danh sách retarget (vd clip Thiếu Lâm
 *     AttackRun chỉ phủ 15/41 xương).
 * ============================================================ */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined' && window.PixiStudio) || {};
  var bus = (PS && PS.bus) || { emit: function () {}, on: function () {} };
  var EPS = 1e-6;
  var DEFAULT_FPS = 30;

  var FORMAT = 'pixistudio-arp-sync-clips-1';
  var EVENT_CLIP_CHANGED = 'arp:animator-clip-changed';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round3(v) { return Math.round(v * 1000) / 1000; }
  function round4(v) { return Math.round(v * 10000) / 10000; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function cloneDeep(o) { return JSON.parse(JSON.stringify(o)); }
  function slug(name) {
    return String(name || 'clip').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'clip';
  }
  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message }); } catch (e) {}
  }

  /* 'mixamorig:Hips.position' / 'mixamorigLeftArm.quaternion' → 'Hips' / 'LeftArm' */
  function stripBoneName(full) {
    var s = String(full || '').trim();
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    s = s.replace(/\.(quaternion|position|scale)$/i, '');
    return s;
  }
  function propOfTrack(name) {
    var m = /\.([^.]+)$/.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }
  function isQuatTrackName(name) { return /\.quaternion$/i.test(String(name || '')); }
  function counterpart(bone) {
    if (/^Left/i.test(bone)) return bone.replace(/^Left/i, 'Right');
    if (/^Right/i.test(bone)) return bone.replace(/^Right/i, 'Left');
    return bone;
  }
  /* Mirror 1 góc Euler theo luật Pose (giữ x, đảo dấu y,z). */
  function mirrorEuler(e) {
    e = e || {};
    return { x: +(e.x || 0), y: -(e.y || 0), z: -(e.z || 0) };
  }
  /* Mirror 1 map pose dst->Euler: đổi Left<->Right + mirrorEuler. */
  function mirrorPoseMap(pose) {
    var out = {};
    Object.keys(pose || {}).forEach(function (dst) {
      out[counterpart(dst)] = mirrorEuler(pose[dst]);
    });
    return out;
  }
  function swapSideMap(map) {
    var out = {};
    Object.keys(map || {}).forEach(function (k) { out[counterpart(k)] = map[k]; });
    return out;
  }

  /* ---------- truy cập module khác (defensive, đọc lazy) ---------- */
  function getQR() { return (PS && PS.ArpQuickRig) || null; }
  function getKF() {
    var QR = getQR();
    return (QR && QR.Keyframe) || null;
  }
  function getPose() {
    var QR = getQR();
    return (QR && QR.Pose) || null;
  }
  function getLR() {
    var QR = getQR();
    return (QR && QR.LiveRetarget) || null;
  }
  function getRemap() { return (PS && PS.ArpRemap) || null; }
  function getAnim() { return (PS && PS.Anim) || null; }
  function getAutoGen() { return (PS && PS.AnimAutoGen) || null; }
  function getAnimator() { return (PS && PS.ArpAnimator) || null; }
  function getRig() {
    var QR = getQR();
    return (QR && QR.current) || null;
  }

  var Sync = {
    FORMAT: FORMAT,
    EVENT_CLIP_CHANGED: EVENT_CLIP_CHANGED,
    _retargetClips: [],   /* [{clip, name, sourceClip, compat, at}] */
    _wrapped: {},         /* cờ chống wrap 2 lần: 'kf:recordKey'... */
    _wrapWarnings: [],    /* hàm gốc chưa tồn tại lúc install */
    _lastPlay: null,      /* {id, via, at} lần phát gần nhất qua playClip */
    _lastPose: null       /* {name, at} pose áp gần nhất qua applyPoseFromLibrary */
  };

  /* ============================================================
     1. DANH SÁCH CLIP — 1 NGUỒN DUY NHẤT
     ============================================================ */
  function pushEntry(out, seen, e) {
    if (!e || !e.id || seen[e.id]) return;
    seen[e.id] = true;
    out.push(e);
  }
  function entryFromThreeClip(id, name, source, clip, note) {
    return {
      id: id, name: name, source: source,
      duration: (clip && isNum(clip.duration)) ? clip.duration : 0,
      fps: DEFAULT_FPS, loop: true,
      clipObject: clip || null, keys: null,
      trackCount: (clip && clip.tracks) ? clip.tracks.length : 0,
      note: note || ''
    };
  }

  function listAllClips(filter) {
    var out = [];
    var seen = {};

    /* --- mixamo: clip đã gắn vào control rig --- */
    var rig = getRig();
    if (rig && Array.isArray(rig.clips)) {
      rig.clips.forEach(function (c) {
        if (!c || !c.tracks) return;
        pushEntry(out, seen, entryFromThreeClip('mixamo:' + (c.name || 'Clip'), c.name || 'Clip', 'mixamo', c, 'Gắn vào QuickRig.current.clips'));
      });
    }
    /* --- mixamo (file): clip FBX/GLB trong Anim.clips, không phải preset --- */
    var Anim = getAnim();
    if (Anim && Array.isArray(Anim.clips)) {
      Anim.clips.forEach(function (c) {
        if (!c) return;
        if (c.isPreset) return; /* preset → nguồn studio, xem dưới */
        var clip = c.clip || null;
        pushEntry(out, seen, {
          id: 'mixamo:' + (c.name || 'Clip'), name: c.name || 'Clip',
          source: 'mixamo', duration: (clip && clip.duration) || c.duration || 0,
          fps: DEFAULT_FPS, loop: c.loop !== false,
          clipObject: clip, keys: null,
          trackCount: clip && clip.tracks ? clip.tracks.length : 0,
          note: 'Clip file trong Anim.clips'
        });
      });
    }
    /* --- studio: preset procedural + AnimAutoGen --- */
    if (Anim && Array.isArray(Anim.clips)) {
      Anim.clips.forEach(function (c) {
        if (!c || !c.isPreset) return;
        var clip = c.clip || null;
        pushEntry(out, seen, {
          id: 'studio:' + (c.name || 'Preset'), name: c.name || 'Preset',
          source: 'studio', duration: (clip && clip.duration) || c.duration || 0,
          fps: DEFAULT_FPS, loop: c.loop !== false,
          clipObject: clip, keys: null,
          trackCount: clip && clip.tracks ? clip.tracks.length : 0,
          note: 'Preset procedural (Anim.clips)'
        });
      });
    }
    var AG = getAutoGen();
    var autogenReal = {}; /* id -> THREE clip thật (nếu RigAutoGen đã sinh) */
    var RAG = PS && PS.RigAutoGen;
    if (RAG && RAG.current && Array.isArray(RAG.current.clips)) {
      RAG.current.clips.forEach(function (c) { if (c && c.id) autogenReal[c.id] = c.clip || null; });
    }
    if (AG && Array.isArray(AG.currentClips)) {
      AG.currentClips.forEach(function (c) { if (c && c.id) autogenReal[c.id] = c.clip || null; });
    }
    if (AG && Array.isArray(AG.definitions)) {
      AG.definitions.forEach(function (d) {
        pushEntry(out, seen, {
          id: 'studio:' + d.id, name: d.id, source: 'studio',
          duration: d.dur || 0, fps: DEFAULT_FPS, loop: true,
          clipObject: autogenReal[d.id] || null, keys: null, trackCount: 0,
          note: autogenReal[d.id] ? 'AnimAutoGen (đã sinh clip thật)' : 'AnimAutoGen — chỉ phát, không có clip THREE riêng'
        });
      });
    }
    /* Remap.listClips nguồn AnimAutoGen (clip thật đã sinh, nếu có) */
    var Remap = getRemap();
    if (Remap && typeof Remap.listClips === 'function') {
      try {
        Remap.listClips().forEach(function (e) {
          if (!e || !e.clip) return;
          if (String(e.source || '') !== 'AnimAutoGen') return;
          pushEntry(out, seen, entryFromThreeClip('studio:' + (e.name || e.id), e.name || e.id, 'studio', e.clip, 'AnimAutoGen qua ArpRemap.listClips'));
        });
      } catch (err) {}
    }
    /* --- keyframe: clip QR3 đang ghi --- */
    var KF = getKF();
    if (KF && KF.clip && Array.isArray(KF.clip.keys) && KF.clip.keys.length) {
      var kc = KF.clip;
      var built = null;
      if (typeof KF.buildAnimationClip === 'function') {
        try { built = KF.buildAnimationClip(); } catch (e) { built = null; }
      }
      pushEntry(out, seen, {
        id: 'keyframe:' + (kc.name || 'Clip 1'), name: kc.name || 'Clip 1',
        source: 'keyframe', duration: kc.duration || 0,
        fps: kc.fps || DEFAULT_FPS, loop: !!kc.loop,
        clipObject: built, keys: cloneDeep(kc.keys),
        trackCount: built && built.tracks ? built.tracks.length : 0,
        keyCount: kc.keys.length,
        note: 'Clip Keyframe đang ghi (' + kc.keys.length + ' keys)'
      });
    }
    /* --- retarget: clip đã remap xong --- */
    Sync._retargetClips.forEach(function (r) {
      if (!r || !r.clip) return;
      pushEntry(out, seen, entryFromThreeClip('retarget:' + (r.clip.name || r.name), r.clip.name || r.name, 'retarget', r.clip,
        'Remap từ "' + (r.sourceClip || '?') + '"' + (isNum(r.compat) ? ' · phủ ' + Math.round(r.compat * 100) + '%' : '')));
    });
    if (Remap && Remap.lastRemapped && Remap.lastRemapped.tracks) {
      var lr = Remap.lastRemapped;
      if (!seen['retarget:' + lr.name]) {
        pushEntry(out, seen, entryFromThreeClip('retarget:' + lr.name, lr.name, 'retarget', lr,
          'ArpRemap.lastRemapped' + (lr.userData && lr.userData.sourceClip ? ' từ "' + lr.userData.sourceClip + '"' : '')));
      }
    }
    /* --- coco / hy3d: clip nhân vật (chỉ khi đã load) --- */
    [['Coco', 'coco'], ['Hy3d', 'hy3d']].forEach(function (pair) {
      var mod = PS[pair[0]];
      if (mod && Array.isArray(mod.clips)) {
        mod.clips.forEach(function (c) {
          if (!c) return;
          var clip = c.clip || null;
          pushEntry(out, seen, {
            id: pair[1] + ':' + (c.id || c.name), name: c.name || c.id || 'Clip',
            source: pair[1], duration: (clip && clip.duration) || c.duration || 0,
            fps: DEFAULT_FPS, loop: c.loop !== false,
            clipObject: clip, keys: null,
            trackCount: clip && clip.tracks ? clip.tracks.length : 0,
            note: 'Clip nhân vật ' + pair[0]
          });
        });
      }
    });
    /* --- user: clip đã chỉnh sửa / đăng ký ngoài trong Animator --- */
    var AN = getAnimator();
    if (AN) {
      (AN._userClips || []).concat(AN._extraClips || []).forEach(function (c) {
        if (!c) return;
        pushEntry(out, seen, {
          id: c.id, name: c.name, source: c.source || 'user',
          duration: c.duration || 0, fps: c.fps || DEFAULT_FPS, loop: c.loop !== false,
          clipObject: c.clip || null, keys: c.keys || null,
          trackCount: c.clip && c.clip.tracks ? c.clip.tracks.length : 0,
          note: c.userCreated ? 'Clip user tạo bằng chỉnh sửa' : 'Clip đăng ký ngoài'
        });
      });
    }

    var q = String(filter || '').trim().toLowerCase();
    if (!q) return out;
    return out.filter(function (c) {
      return (c.name || '').toLowerCase().indexOf(q) >= 0 ||
        (c.source || '').toLowerCase().indexOf(q) >= 0 ||
        (c.id || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function getClip(id) {
    var all = listAllClips();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  /* Đếm clip theo nguồn + liệt kê nguồn đang vắng (để UI báo rõ). */
  function getSources() {
    var counts = { mixamo: 0, studio: 0, keyframe: 0, retarget: 0, coco: 0, hy3d: 0, user: 0 };
    listAllClips().forEach(function (c) {
      if (counts[c.source] !== undefined) counts[c.source]++;
      else counts[c.source] = 1;
    });
    var missing = [];
    ['mixamo', 'studio', 'keyframe', 'retarget', 'coco', 'hy3d'].forEach(function (s) {
      if (!counts[s]) missing.push(s);
    });
    return { counts: counts, total: listAllClips().length, missing: missing };
  }

  /* Map entry sync -> đúng shape/id mà Animator.refreshClips() dùng.
     Animator PHẢI dùng list này làm nguồn danh sách (coordinator gộp). */
  function animatorIdFor(entry) {
    if (!entry) return null;
    if (entry.source === 'mixamo') return 'anim:' + entry.name;
    if (entry.source === 'studio') return entry.clipObject ? ('anim:' + entry.name) : ('autogen:' + entry.name);
    if (entry.source === 'keyframe') return 'keyframe:' + entry.name;
    if (entry.source === 'coco' || entry.source === 'hy3d') return entry.id;
    if (entry.source === 'retarget') return 'retarget:' + entry.name;
    return entry.id;
  }
  function animatorEntries(filter) {
    return listAllClips(filter).map(function (e) {
      return {
        id: animatorIdFor(e), name: e.name,
        duration: e.duration, fps: e.fps, loop: e.loop,
        source: e.source === 'studio' && !e.clipObject ? 'autogen' :
          (e.source === 'mixamo' ? 'anim' : e.source),
        /* Keyframe: chỉ mang keys, KHÔNG mang clip THREE (đúng hợp đồng
           cũ của Animator — editCurrentClip từ chối keyframe, play/tick
           ủy thác cho Keyframe module theo keys; sửa keyframe thì qua
           cầu nối editClip() trên keys để giữ FK state). Clip THREE
           build từ keys vẫn nằm trong listAllClips (clipObject) cho
           consumer khác cần nó. */
        clip: (e.source === 'keyframe') ? null : e.clipObject, keys: e.keys || null,
        userCreated: e.source === 'user'
      };
    });
  }
  /* Đảm bảo Animator có entry này trong registry của nó (clip THREE
     thật) rồi trả animatorId — dùng cho playClip nguồn mixamo/retarget. */
  function ensureAnimatorHas(entry) {
    var AN = getAnimator();
    if (!AN || !entry || !entry.clipObject) return { ok: false, error: 'Không có Animator hoặc clip không có THREE.AnimationClip.' };
    var aid = animatorIdFor(entry);
    if (typeof AN.getClip === 'function') {
      try { if (AN.getClip(aid)) return { ok: true, id: aid, already: true }; } catch (e) {}
    }
    if (typeof AN.registerClip !== 'function') return { ok: false, error: 'Animator.registerClip chưa có.' };
    var r = AN.registerClip({ id: aid, name: entry.name, clip: entry.clipObject, source: entry.source, userCreated: false });
    if (!r || r.ok === false) return { ok: false, error: (r && r.error) || 'registerClip lỗi.' };
    return { ok: true, id: aid, already: false };
  }

  /* ============================================================
     2. PHÁT CHUNG — QUA ANIMATOR, TRÊN ĐÚNG SKELETON QUICK RIG
     ============================================================ */
  function playClip(id, opts) {
    opts = opts || {};
    var AN = getAnimator();
    if (!AN) return { ok: false, error: 'Animator chưa load.' };
    var entry = (typeof id === 'object' && id) ? id : getClip(id);
    if (!entry) return { ok: false, error: 'Không tìm thấy clip "' + id + '" trong danh sách dùng chung.' };
    var r;
    if (entry.source === 'keyframe') {
      /* Animator tự ủy thác cho Keyframe.tick trên QR.current — cùng skeleton. */
      r = AN.play('keyframe:' + entry.name);
      if (r) r.via = 'keyframe';
    } else if (entry.source === 'studio' && !entry.clipObject) {
      r = AN.play('autogen:' + entry.name);
      if (r) r.via = 'autogen';
    } else if (entry.source === 'coco' || entry.source === 'hy3d') {
      r = AN.play(entry.id); /* Animator đọc PS.Coco/Hy3d.clips trực tiếp */
      if (r) r.via = entry.source;
    } else {
      /* mixamo / studio có clip thật / retarget / user: đăng ký clip GỐC
         (không copy skeleton) vào Animator rồi phát bằng mixer của nó. */
      var ens = ensureAnimatorHas(entry);
      if (!ens.ok) return ens;
      r = AN.play(ens.id);
      if (r) r.via = 'mixer';
    }
    if (r && r.ok) Sync._lastPlay = { id: entry.id, animatorId: animatorIdFor(entry), via: r.via || '', at: Date.now() };
    if (r) r.syncId = entry.id;
    return r || { ok: false, error: 'Animator.play không trả kết quả.' };
  }
  function stopAll() {
    var out = {};
    var AN = getAnimator();
    var KF = getKF();
    var LR = getLR();
    try { if (AN && typeof AN.stop === 'function') out.animator = AN.stop(); } catch (e) { out.animator = { ok: false, error: String(e && e.message) }; }
    try { if (KF && typeof KF.stop === 'function') out.keyframe = KF.stop(); } catch (e) { out.keyframe = { ok: false, error: String(e && e.message) }; }
    try { if (LR && typeof LR.stop === 'function') out.liveRetarget = LR.stop(); } catch (e) { out.liveRetarget = { ok: false, error: String(e && e.message) }; }
    return { ok: true, stopped: out };
  }

  /* ============================================================
     3. KEYFRAME → ANIMATOR TỨC THÌ (WRAP RUNTIME)
     ============================================================ */
  function emitClipChanged(kind, detail) {
    var data = { kind: kind, at: Date.now() };
    if (detail) Object.keys(detail).forEach(function (k) { data[k] = detail[k]; });
    try { bus.emit(EVENT_CLIP_CHANGED, data); } catch (e) {}
    return data;
  }
  function wrapMethod(obj, name, flag, onOk) {
    if (!obj || typeof obj[name] !== 'function') {
      Sync._wrapWarnings.push(name + ' chưa tồn tại lúc install (module gốc chưa load?)');
      return { ok: false, missing: name };
    }
    if (Sync._wrapped[flag]) return { ok: true, already: true, method: name };
    var orig = obj[name];
    obj[name] = function () {
      var r = orig.apply(obj, arguments);
      if (r && r.ok !== false) {
        try { onOk(r); } catch (e) {}
      }
      return r;
    };
    obj[name]._syncWrapped = true;
    obj[name]._syncOriginal = orig;
    Sync._wrapped[flag] = true;
    return { ok: true, method: name };
  }
  function installWrappers() {
    var wrapped = [], missing = [];
    var KF = getKF();
    if (KF) {
      var kfDetail = function (kind) {
        return function (r) {
          var c = KF.clip || {};
          emitClipChanged(kind, {
            name: c.name || (r && r.name) || '',
            keyCount: (c.keys && c.keys.length) || (r && r.keyCount) || 0,
            duration: (c.duration !== undefined ? c.duration : (r && r.duration)) || 0
          });
        };
      };
      [['recordKey', 'kf:recordKey', 'keyframe-recorded'],
       ['exportClip', 'kf:exportClip', 'keyframe-exported'],
       ['importClip', 'kf:importClip', 'keyframe-imported'],
       ['newClip', 'kf:newClip', 'keyframe-new']].forEach(function (spec) {
        var res = wrapMethod(KF, spec[0], spec[1], kfDetail(spec[2]));
        if (res.ok) wrapped.push('Keyframe.' + spec[0]);
        else missing.push('Keyframe.' + spec[0]);
      });
    } else {
      missing.push('Keyframe (chưa load)');
      Sync._wrapWarnings.push('Keyframe chưa tồn tại lúc install');
    }
    var Remap = getRemap();
    if (Remap && typeof Remap.retargetClip === 'function') {
      var res = wrapMethod(Remap, 'retargetClip', 'remap:retargetClip', function (r) {
        if (r && r.ok && r.clip) {
          registerRetargetClip(r.clip, { sourceClip: (r.clip.userData && r.clip.userData.sourceClip) || r.clip.name, compat: r.compat });
        }
      });
      if (res.ok) wrapped.push('ArpRemap.retargetClip');
      else missing.push('ArpRemap.retargetClip');
    } else {
      missing.push('ArpRemap.retargetClip (chưa load)');
      Sync._wrapWarnings.push('ArpRemap.retargetClip chưa tồn tại lúc install');
    }
    return { ok: missing.length === 0, wrapped: wrapped, missing: missing, warnings: Sync._wrapWarnings.slice() };
  }
  /* Ghi 1 clip đã remap vào registry retarget (để listAllClips thấy). */
  function registerRetargetClip(clip, meta) {
    meta = meta || {};
    if (!clip || !clip.tracks || !clip.name) return { ok: false, error: 'Clip retarget cần có name + tracks.' };
    var name = clip.name;
    var found = null;
    Sync._retargetClips.forEach(function (r) { if (r.clip.name === name) found = r; });
    var rec = { clip: clip, name: name, sourceClip: meta.sourceClip || (clip.userData && clip.userData.sourceClip) || '', compat: meta.compat, at: Date.now() };
    if (found) {
      found.clip = clip; found.sourceClip = rec.sourceClip; found.compat = rec.compat; found.at = rec.at;
    } else Sync._retargetClips.push(rec);
    emitClipChanged('retarget-registered', { name: name, sourceClip: rec.sourceClip, compat: rec.compat });
    return { ok: true, id: 'retarget:' + name, name: name };
  }

  /* ============================================================
     4. SỬA CLIP — 4 HÀM PURE (KHÔNG GHI ĐÈ CLIP GỐC)
     ============================================================ */
  /* --- sample trên plain track {name, times:[], values:[]} --- */
  function sampleQuatPlain(track, t) {
    var times = track.times, vals = track.values, n = times.length;
    var T = (typeof window !== 'undefined') ? window.THREE : null;
    if (!T) return [0, 0, 0, 1];
    var Q = T.Quaternion;
    if (!n) return [0, 0, 0, 1];
    if (t <= times[0] || n === 1) return [vals[0], vals[1], vals[2], vals[3]];
    if (t >= times[n - 1]) { var o = (n - 1) * 4; return [vals[o], vals[o + 1], vals[o + 2], vals[o + 3]]; }
    for (var i = 0; i < n - 1; i++) {
      if (t >= times[i] && t <= times[i + 1]) {
        var span = times[i + 1] - times[i];
        var a = span > EPS ? (t - times[i]) / span : 0;
        var qa = new Q(vals[i * 4], vals[i * 4 + 1], vals[i * 4 + 2], vals[i * 4 + 3]);
        var qb = new Q(vals[(i + 1) * 4], vals[(i + 1) * 4 + 1], vals[(i + 1) * 4 + 2], vals[(i + 1) * 4 + 3]);
        var q = qa.slerp(qb, a);
        return [q.x, q.y, q.z, q.w];
      }
    }
    return [0, 0, 0, 1];
  }
  function sampleVecPlain(track, t) {
    var times = track.times, vals = track.values, n = times.length;
    function at(i) { return [vals[i * 3], vals[i * 3 + 1], vals[i * 3 + 2]]; }
    if (!n) return [0, 0, 0];
    if (t <= times[0] || n === 1) return at(0);
    if (t >= times[n - 1]) return at(n - 1);
    for (var i = 0; i < n - 1; i++) {
      if (t >= times[i] && t <= times[i + 1]) {
        var span = times[i + 1] - times[i];
        var a = span > EPS ? (t - times[i]) / span : 0;
        var va = at(i), vb = at(i + 1);
        return [va[0] + (vb[0] - va[0]) * a, va[1] + (vb[1] - va[1]) * a, va[2] + (vb[2] - va[2]) * a];
      }
    }
    return at(0);
  }
  function samplePlain(track, t) {
    return isQuatTrackName(track.name) ? sampleQuatPlain(track, t) : sampleVecPlain(track, t);
  }
  function eulerToQuatArr(e) {
    var T = (typeof window !== 'undefined') ? window.THREE : null;
    var q = new T.Quaternion();
    q.setFromEuler(new T.Euler(e.x || 0, e.y || 0, e.z || 0, 'XYZ'));
    return [q.x, q.y, q.z, q.w];
  }
  function quatArrToEuler(v) {
    var T = (typeof window !== 'undefined') ? window.THREE : null;
    var e = new T.Euler();
    e.setFromQuaternion(new T.Quaternion(v[0], v[1], v[2], v[3]), 'XYZ');
    return { x: round4(e.x), y: round4(e.y), z: round4(e.z) };
  }
  /* keys keyframe -> plain tracks (dùng tracksFromKeys của Keyframe nếu có). */
  function tracksFromKeys(keys) {
    var KF = getKF();
    if (KF && KF._test && typeof KF._test.tracksFromKeys === 'function') {
      try { return KF._test.tracksFromKeys(keys); } catch (e) {}
    }
    var times = keys.map(function (k) { return round3(k.t); });
    var tracks = [];
    if (!keys.length) return tracks;
    var boneNames = {};
    keys.forEach(function (k) { Object.keys(k.pose || {}).forEach(function (n) { boneNames[n] = true; }); });
    var rig = getRig();
    function fullName(dst) {
      if (rig && rig.bones && rig.bones[dst]) return rig.bones[dst].name;
      return dst;
    }
    Object.keys(boneNames).forEach(function (dst) {
      var values = [];
      keys.forEach(function (k) {
        var q = eulerToQuatArr((k.pose && k.pose[dst]) || { x: 0, y: 0, z: 0 });
        values.push(round4(q[0]), round4(q[1]), round4(q[2]), round4(q[3]));
      });
      tracks.push({ name: fullName(dst) + '.quaternion', times: times.slice(), values: values });
    });
    if (keys.some(function (k) { return !!k.hips; })) {
      var vals = [];
      keys.forEach(function (k) {
        var h = k.hips || { x: 0, y: 0, z: 0 };
        vals.push(round4(h.x), round4(h.y), round4(h.z));
      });
      tracks.push({ name: fullName('Hips') + '.position', times: times.slice(), values: vals });
    }
    return tracks;
  }
  /* plain tracks -> keys keyframe (fallback khi cần đổi dạng; FK mặc định). */
  function keysFromTracks(tracks, duration) {
    var timeSet = {};
    (tracks || []).forEach(function (t) { (t.times || []).forEach(function (tt) { timeSet[round3(tt)] = true; }); });
    var allTimes = Object.keys(timeSet).map(function (x) { return parseFloat(x); }).sort(function (a, b) { return a - b; });
    var keys = [];
    allTimes.forEach(function (tt) {
      var pose = {}, hips = null;
      tracks.forEach(function (tr) {
        var dst = stripBoneName(tr.name);
        if (isQuatTrackName(tr.name)) pose[dst] = quatArrToEuler(sampleQuatPlain(tr, tt));
        else if (propOfTrack(tr.name) === 'position' && dst === 'Hips') {
          var v = sampleVecPlain(tr, tt);
          hips = { x: round4(v[0]), y: round4(v[1]), z: round4(v[2]) };
        }
      });
      keys.push({
        t: round3(tt), pose: pose, hips: hips,
        fk: { fkRotations: cloneDeep(pose), fingerCurl: {}, fingerCurlAll: 0,
          footRoll: { Left: 0, Right: 0 }, spineRotations: {},
          headRotation: cloneDeep(pose.Head || { x: 0, y: 0, z: 0 }),
          neckRotation: cloneDeep(pose.Neck || { x: 0, y: 0, z: 0 }), jawOpen: 0 }
      });
    });
    return keys;
  }
  function detectKind(clip) {
    if (!clip || typeof clip !== 'object') return null;
    if (Array.isArray(clip.keys)) return 'keyframe';
    if (Array.isArray(clip.tracks) && clip.tracks.length) {
      var t0 = clip.tracks[0];
      if (t0 && typeof t0.createInterpolant === 'function') return 'three';
      if (t0 && t0.times !== undefined && t0.values !== undefined) {
        if (t0.values instanceof Float32Array) return 'three';
        return 'plain';
      }
    }
    if (Array.isArray(clip.tracks)) return 'plain';
    return null;
  }
  function toPlainTracks(clip, kind) {
    if (kind === 'keyframe') return tracksFromKeys(clip.keys);
    return (clip.tracks || []).map(function (tr) {
      return { name: tr.name, times: Array.prototype.slice.call(tr.times), values: Array.prototype.slice.call(tr.values) };
    });
  }
  function clipDuration(clip, kind) {
    if (kind === 'keyframe') {
      var d = clip.duration || 0;
      if (clip.keys && clip.keys.length) d = Math.max(d, clip.keys[clip.keys.length - 1].t);
      return d;
    }
    if (isNum(clip.duration)) return clip.duration;
    var m = 0;
    (clip.tracks || []).forEach(function (tr) {
      var ts = tr.times;
      if (ts && ts.length) m = Math.max(m, ts[ts.length - 1]);
    });
    return m;
  }
  function buildThreeClip(name, duration, plainTracks) {
    var T = (typeof window !== 'undefined') ? window.THREE : null;
    if (!T) return null;
    var tracks = plainTracks.map(function (tr) {
      if (isQuatTrackName(tr.name)) return new T.QuaternionKeyframeTrack(tr.name, tr.times, tr.values);
      return new T.VectorKeyframeTrack(tr.name, tr.times, tr.values);
    });
    return new T.AnimationClip(name, Math.max(duration, 0.001), tracks);
  }
  /* Đổi plain tracks đã sửa -> clip cùng dạng với clip gốc. */
  function denormalize(plainTracks, duration, name, kind, origClip) {
    if (kind === 'three') {
      var c = buildThreeClip(name, duration, plainTracks);
      if (!c) return { ok: false, error: 'THREE chưa sẵn sàng — không dựng được AnimationClip.' };
      return { ok: true, clip: c, duration: round3(duration), trackCount: plainTracks.length };
    }
    if (kind === 'plain') {
      return { ok: true, clip: { name: name, duration: round3(duration), tracks: plainTracks }, duration: round3(duration), trackCount: plainTracks.length };
    }
    if (kind === 'keyframe') {
      var fps = (origClip && origClip.fps) || DEFAULT_FPS;
      var loop = !!(origClip && origClip.loop);
      return { ok: true, clip: { name: name, duration: round3(duration), fps: fps, loop: loop, keys: keysFromTracks(plainTracks, duration) }, duration: round3(duration), keyCount: 0 };
    }
    return { ok: false, error: 'Không biết dạng clip.' };
  }

  /* --- sửa trực tiếp trên keys (giữ nguyên FK state) --- */
  function lerpEuler(a, b, alpha) {
    a = a || { x: 0, y: 0, z: 0 }; b = b || { x: 0, y: 0, z: 0 };
    return { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha, z: a.z + (b.z - a.z) * alpha };
  }
  function lerpMap(a, b, alpha) {
    var out = {}, names = {};
    Object.keys(a || {}).forEach(function (k) { names[k] = true; });
    Object.keys(b || {}).forEach(function (k) { names[k] = true; });
    Object.keys(names).forEach(function (k) {
      var va = (a || {})[k], vb = (b || {})[k];
      out[k] = (va && typeof va === 'object') || (vb && typeof vb === 'object') ? lerpEuler(va, vb, alpha) : ((va || 0) + ((vb || 0) - (va || 0)) * alpha);
    });
    return out;
  }
  function lerpFk(fkA, fkB, alpha) {
    fkA = fkA || {}; fkB = fkB || {};
    return {
      fkRotations: lerpMap(fkA.fkRotations, fkB.fkRotations, alpha),
      fingerCurl: lerpMap(fkA.fingerCurl, fkB.fingerCurl, alpha),
      fingerCurlAll: (fkA.fingerCurlAll || 0) + ((fkB.fingerCurlAll || 0) - (fkA.fingerCurlAll || 0)) * alpha,
      footRoll: lerpMap(fkA.footRoll, fkB.footRoll, alpha),
      spineRotations: lerpMap(fkA.spineRotations, fkB.spineRotations, alpha),
      headRotation: lerpEuler(fkA.headRotation, fkB.headRotation, alpha),
      neckRotation: lerpEuler(fkA.neckRotation, fkB.neckRotation, alpha),
      jawOpen: (fkA.jawOpen || 0) + ((fkB.jawOpen || 0) - (fkA.jawOpen || 0)) * alpha
    };
  }
  function poseAtKeys(keys, t) {
    if (!keys.length) return null;
    if (t <= keys[0].t) return cloneDeep(keys[0]);
    if (t >= keys[keys.length - 1].t) return cloneDeep(keys[keys.length - 1]);
    for (var i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].t && t <= keys[i + 1].t) {
        var span = keys[i + 1].t - keys[i].t;
        var alpha = span > EPS ? (t - keys[i].t) / span : 0;
        var a = keys[i], b = keys[i + 1];
        var hips = null;
        if (a.hips || b.hips) {
          var ha = a.hips || { x: 0, y: 0, z: 0 }, hb = b.hips || { x: 0, y: 0, z: 0 };
          hips = { x: ha.x + (hb.x - ha.x) * alpha, y: ha.y + (hb.y - ha.y) * alpha, z: ha.z + (hb.z - ha.z) * alpha };
        }
        return { t: round3(t), pose: lerpMap(a.pose, b.pose, alpha), hips: hips, fk: lerpFk(a.fk, b.fk, alpha) };
      }
    }
    return null;
  }
  function trimKeys(keys, start, end) {
    var out = [];
    var b0 = poseAtKeys(keys, start);
    if (b0) { b0.t = 0; out.push(b0); }
    keys.forEach(function (k) {
      if (k.t > start + EPS && k.t < end - EPS) {
        var c = cloneDeep(k);
        c.t = round3(k.t - start);
        out.push(c);
      }
    });
    var b1 = poseAtKeys(keys, end);
    if (b1) { b1.t = round3(end - start); out.push(b1); }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }
  function mirrorKey(key) {
    var c = cloneDeep(key);
    c.pose = mirrorPoseMap(c.pose);
    if (c.hips) c.hips = { x: -c.hips.x, y: c.hips.y, z: c.hips.z };
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

  /* --- sửa trên plain tracks --- */
  function trimTracks(tracks, start, end) {
    return tracks.map(function (tr) {
      var times = [], values = [];
      function pushSample(t) {
        times.push(round3(t - start));
        var s = samplePlain(tr, t);
        for (var k = 0; k < s.length; k++) values.push(round4(s[k]));
      }
      pushSample(start);
      for (var i = 0; i < tr.times.length; i++) {
        if (tr.times[i] > start + EPS && tr.times[i] < end - EPS) {
          times.push(round3(tr.times[i] - start));
          var size = isQuatTrackName(tr.name) ? 4 : 3;
          for (var k = 0; k < size; k++) values.push(tr.values[i * size + k]);
        }
      }
      pushSample(end);
      return { name: tr.name, times: times, values: values };
    });
  }
  function retimeTracks(tracks, factor) {
    return tracks.map(function (tr) {
      return { name: tr.name, times: tr.times.map(function (t) { return round3(t / factor); }), values: tr.values.slice() };
    });
  }
  function reverseTracks(tracks, duration) {
    return tracks.map(function (tr) {
      var size = isQuatTrackName(tr.name) ? 4 : 3;
      var n = tr.times.length;
      var times = [], values = [];
      for (var i = n - 1; i >= 0; i--) {
        times.push(round3(duration - tr.times[i]));
        for (var k = 0; k < size; k++) values.push(tr.values[i * size + k]);
      }
      return { name: tr.name, times: times, values: values };
    });
  }
  function mirrorTracks(tracks) {
    /* [NHÓM B] Luật đúng qua mặt phẳng dọc YZ: quat (x,−y,−z,w) /
       vị trí (−x,y,z) + đổi cặp L/R (xem arp-restpose.js).
       Luật cũ (−x,y,−z,w) là mirror qua mặt phẳng ngang — SAI.
       Xương chỉ có 1 bên trong clip → TẠO track bên kia. */
    var byKey = {};
    var order = [];
    tracks.forEach(function (tr) {
      var key = stripBoneName(tr.name) + '|' + (isQuatTrackName(tr.name) ? 'q' : 'v');
      if (!byKey[key]) { byKey[key] = tr; order.push(key); }
    });
    function mirrorTrackName(name) {
      var dot = String(name).lastIndexOf('.');
      if (dot <= 0) return name;
      var bonePart = name.slice(0, dot);
      var prop = name.slice(dot);
      var m = bonePart.match(/^(mixamorig:?|model:?)(.*)$/i);
      var core = m ? m[2] : bonePart;
      return (m ? m[1] : '') + counterpart(core) + prop;
    }
    function mirrorAt(srcTr, t, isQuat) {
      var s = samplePlain(srcTr, t);
      if (isQuat) return [s[0], -s[1], -s[2], s[3]];
      return [-s[0], s[1], s[2]];
    }
    var done = {};
    var out = [];
    order.forEach(function (key) {
      if (done[key]) return;
      var tr = byKey[key];
      var bone = stripBoneName(tr.name);
      var kind = isQuatTrackName(tr.name) ? 'q' : 'v';
      var isQuat = kind === 'q';
      var twinBone = counterpart(bone);
      var twinKey = twinBone + '|' + kind;
      var twinTr = byKey[twinKey] || null;
      done[key] = true;
      done[twinKey] = true;
      var srcA = twinTr || tr;
      var valuesA = [];
      tr.times.forEach(function (t) {
        /* KHÔNG round ở đây: mirror 2 lần phải về đúng giá trị gốc
           (eps 1e-6) — round4 (1e-4) làm vỡ hồi quy (5d). */
        mirrorAt(srcA, t, isQuat).forEach(function (v) { valuesA.push(v); });
      });
      out.push({ name: tr.name, times: tr.times.slice(), values: valuesA });
      if (twinBone !== bone) {
        var twinName = twinTr ? twinTr.name : mirrorTrackName(tr.name);
        var baseTr = twinTr || tr;
        var valuesB = [];
        baseTr.times.forEach(function (t) {
          mirrorAt(tr, t, isQuat).forEach(function (v) { valuesB.push(v); });
        });
        out.push({ name: twinName, times: baseTr.times.slice(), values: valuesB });
      }
    });
    return out;
  }

  /* --- 4 hàm pure public --- */
  function trimClip(clip, start, end) {
    var kind = detectKind(clip);
    if (!kind) return { ok: false, error: 'Clip không nhận dạng được (cần .keys hoặc .tracks).' };
    var D = clipDuration(clip, kind);
    start = parseFloat(start); end = parseFloat(end);
    if (!(start >= 0) || !(end > start) || end > D + EPS) {
      return { ok: false, error: 'Cắt không hợp lệ: cần 0 ≤ start < end ≤ ' + D.toFixed(2) + 's.' };
    }
    var name = (clip.name || 'clip') + '_trim';
    if (kind === 'keyframe') {
      var keys = trimKeys(cloneDeep(clip.keys), start, end);
      return { ok: true, kind: kind, clip: { name: name, duration: round3(end - start), fps: clip.fps || DEFAULT_FPS, loop: !!clip.loop, keys: keys }, duration: round3(end - start), keyCount: keys.length };
    }
    var tracks = trimTracks(toPlainTracks(clip, kind), start, end);
    var r = denormalize(tracks, end - start, name, kind, clip);
    if (!r.ok) return r;
    r.kind = kind;
    if (kind === 'keyframe') r.keyCount = r.clip.keys.length;
    return r;
  }
  function retimeClip(clip, factor) {
    var kind = detectKind(clip);
    if (!kind) return { ok: false, error: 'Clip không nhận dạng được (cần .keys hoặc .tracks).' };
    factor = parseFloat(factor);
    if (!(factor > 0)) return { ok: false, error: 'Hệ số retime phải > 0.' };
    var D = clipDuration(clip, kind);
    var name = (clip.name || 'clip') + '_x' + factor;
    if (kind === 'keyframe') {
      var keys = cloneDeep(clip.keys).map(function (k) {
        var c = cloneDeep(k);
        c.t = round3(k.t / factor);
        return c;
      });
      return { ok: true, kind: kind, clip: { name: name, duration: round3(D / factor), fps: clip.fps || DEFAULT_FPS, loop: !!clip.loop, keys: keys }, duration: round3(D / factor), keyCount: keys.length };
    }
    var tracks = retimeTracks(toPlainTracks(clip, kind), factor);
    var r = denormalize(tracks, D / factor, name, kind, clip);
    if (!r.ok) return r;
    r.kind = kind;
    return r;
  }
  function reverseClip(clip) {
    var kind = detectKind(clip);
    if (!kind) return { ok: false, error: 'Clip không nhận dạng được (cần .keys hoặc .tracks).' };
    var D = clipDuration(clip, kind);
    var name = (clip.name || 'clip') + '_rev';
    if (kind === 'keyframe') {
      var keys = cloneDeep(clip.keys).map(function (k) {
        var c = cloneDeep(k);
        c.t = round3(D - k.t);
        return c;
      }).reverse();
      keys.sort(function (a, b) { return a.t - b.t; });
      return { ok: true, kind: kind, clip: { name: name, duration: round3(D), fps: clip.fps || DEFAULT_FPS, loop: !!clip.loop, keys: keys }, duration: round3(D), keyCount: keys.length };
    }
    var tracks = reverseTracks(toPlainTracks(clip, kind), D);
    var r = denormalize(tracks, D, name, kind, clip);
    if (!r.ok) return r;
    r.kind = kind;
    return r;
  }
  function mirrorClip(clip) {
    var kind = detectKind(clip);
    if (!kind) return { ok: false, error: 'Clip không nhận dạng được (cần .keys hoặc .tracks).' };
    var D = clipDuration(clip, kind);
    var name = (clip.name || 'clip') + '_mirror';
    if (kind === 'keyframe') {
      var keys = cloneDeep(clip.keys).map(function (k) { return mirrorKey(k); });
      return { ok: true, kind: kind, clip: { name: name, duration: round3(D), fps: clip.fps || DEFAULT_FPS, loop: !!clip.loop, keys: keys }, duration: round3(D), keyCount: keys.length };
    }
    var tracks = mirrorTracks(toPlainTracks(clip, kind));
    var r = denormalize(tracks, D, name, kind, clip);
    if (!r.ok) return r;
    r.kind = kind;
    return r;
  }

  /* Sửa 1 clip keyframe (mặc định = Keyframe.clip đang ghi) -> clip MỚI,
     không ghi đè clip gốc. */
  function editKeyframeClip(op, opts) {
    opts = opts || {};
    var clip = opts.clip || (getKF() && getKF().clip) || null;
    if (!clip || !clip.keys || !clip.keys.length) return { ok: false, error: 'Không có clip Keyframe để sửa (chưa ghi key nào).' };
    var r;
    if (op === 'trim') r = trimClip(clip, opts.start, opts.end);
    else if (op === 'retime') r = retimeClip(clip, opts.factor);
    else if (op === 'reverse') r = reverseClip(clip);
    else if (op === 'mirror') r = mirrorClip(clip);
    else return { ok: false, error: 'Phép sửa không biết: ' + op };
    if (!r.ok) return r;
    if (opts.name) r.clip.name = String(opts.name);
    return r;
  }
  /* Cầu nối cho Animator: sửa clip trong danh sách dùng chung (kể cả
     keyframe — Animator.editCurrentClip từ chối loại này) rồi đăng ký
     kết quả vào Animator để phát ngay. Không ghi đè clip gốc. */
  function editClip(entryIdOrEntry, op, opts) {
    opts = opts || {};
    var AN = getAnimator();
    if (!AN) return { ok: false, error: 'Animator chưa load.' };
    var entry = (typeof entryIdOrEntry === 'object' && entryIdOrEntry) ? entryIdOrEntry : getClip(entryIdOrEntry);
    if (!entry) return { ok: false, error: 'Không tìm thấy clip "' + entryIdOrEntry + '".' };
    var r;
    if (entry.source === 'keyframe') {
      var kfClip = (getKF() && getKF().clip) || null;
      if (!kfClip) return { ok: false, error: 'Không có clip Keyframe đang ghi.' };
      r = editKeyframeClip(op, { clip: kfClip, start: opts.start, end: opts.end, factor: opts.factor, name: opts.name });
      if (!r.ok) return r;
      /* Đăng ký bản đã sửa vào Animator dưới dạng clip THREE để phát được. */
      var KF = getKF();
      var built = null;
      if (KF && typeof KF.buildAnimationClip === 'function') {
        try { built = KF.buildAnimationClip(r.clip.name, r.clip.keys); } catch (e) { built = null; }
      }
      if (!built) return { ok: false, error: 'Không dựng được THREE clip từ clip Keyframe đã sửa.' };
      var name = r.clip.name;
      var reg = AN.registerClip({ name: name, clip: built, source: 'user', userCreated: true });
      if (!reg.ok) return reg;
      emitClipChanged('clip-edited', { name: name, op: op, source: 'keyframe', duration: r.duration });
      return { ok: true, id: reg.id, name: name, duration: r.duration, op: op, source: 'keyframe', kind: 'keyframe', clipObject: built, keyframeClip: r.clip };
    }
    if (!entry.clipObject) return { ok: false, error: 'Clip "' + entry.name + '" không có THREE.AnimationClip để sửa (clip autogen chỉ phát).' };
    if (op === 'trim') r = trimClip(entry.clipObject, opts.start, opts.end);
    else if (op === 'retime') r = retimeClip(entry.clipObject, opts.factor);
    else if (op === 'reverse') r = reverseClip(entry.clipObject);
    else if (op === 'mirror') r = mirrorClip(entry.clipObject);
    else return { ok: false, error: 'Phép sửa không biết: ' + op };
    if (!r.ok) return r;
    var regName = opts.name || (entry.name + '_' + op);
    var reg2 = AN.registerClip({ name: regName, clip: r.clip, source: 'user', userCreated: true });
    if (!reg2.ok) return reg2;
    emitClipChanged('clip-edited', { name: regName, op: op, source: entry.source, duration: r.duration });
    return { ok: true, id: reg2.id, name: regName, duration: r.duration, op: op, source: entry.source, kind: 'three', clipObject: r.clip };
  }
  /* Sửa clip Animator đang chọn (tìm qua Animator.currentId). */
  function editCurrentAnimatorClip(op, opts) {
    var AN = getAnimator();
    if (!AN || !AN.currentId) return { ok: false, error: 'Animator chưa chọn clip nào.' };
    var syncEntry = null;
    listAllClips().forEach(function (e) {
      if (animatorIdFor(e) === AN.currentId || e.id === AN.currentId) syncEntry = e;
    });
    if (!syncEntry) {
      /* Clip user đã đăng ký trong Animator nhưng chưa có trong list? list đã gồm user. */
      return { ok: false, error: 'Clip đang chọn "' + AN.currentId + '" không có trong danh sách dùng chung.' };
    }
    return editClip(syncEntry, op, opts);
  }

  /* ============================================================
     5. POSE DÙNG CHUNG (POSE LIBRARY)
     ============================================================ */
  function listPoses() {
    var Pose = getPose();
    if (!Pose) return { ok: false, error: 'Pose Library chưa load.', presets: [], saved: [], all: [] };
    var presets = [];
    if (typeof Pose.presetList === 'function') {
      try {
        presets = Pose.presetList().map(function (p) {
          return { id: p.id, name: p.name, source: 'preset', boneCount: Object.keys(p.bones || {}).length, desc: p.desc || '' };
        });
      } catch (e) { presets = []; }
    }
    var saved = [];
    if (typeof Pose.listPoses === 'function') {
      try {
        saved = Pose.listPoses().map(function (p) {
          return { id: p.name, name: p.name, source: 'saved', boneCount: Object.keys(p.bones || {}).length };
        });
      } catch (e) { saved = []; }
    }
    var all = presets.concat(saved.filter(function (s) {
      return !presets.some(function (p) { return p.name === s.name; });
    }));
    return { ok: true, presets: presets, saved: saved, all: all };
  }
  function resolvePoseData(poseId) {
    var Pose = getPose();
    if (!Pose) return null;
    if (typeof Pose.resolvePose === 'function') {
      try { return Pose.resolvePose(poseId); } catch (e) { return null; }
    }
    if (Pose._test && typeof Pose._test.resolvePose === 'function') {
      try { return Pose._test.resolvePose(poseId); } catch (e) { return null; }
    }
    return null;
  }
  /* Chụp pose hiện tại: qua Pose.captureCurrentPose nếu có control rig,
     nếu không chụp trực tiếp từ bone map của Animator target. */
  function captureCurrentPoseData(name) {
    var Pose = getPose();
    var rig = getRig();
    if (Pose && rig && typeof Pose.captureCurrentPose === 'function') {
      try { return Pose.captureCurrentPose(name); } catch (e) {}
    }
    var AN = getAnimator();
    if (AN && AN._test && typeof AN._test.getBoneMap === 'function') {
      try {
        var map = AN._test.getBoneMap();
        var bones = {};
        Object.keys(map).forEach(function (dst) {
          var b = map[dst];
          if (b && b.rotation) bones[dst] = { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z };
        });
        if (!Object.keys(bones).length) return { ok: false, error: 'Không chụp được pose: bone map rỗng.' };
        return { ok: true, pose: { name: name || 'Pose hiện tại', bones: bones, createdAt: Date.now() } };
      } catch (e) { return { ok: false, error: 'Chụp pose lỗi: ' + (e && e.message) }; }
    }
    return { ok: false, error: 'Không có control rig hay Animator target để chụp pose.' };
  }
  /* Áp pose từ Pose Library lên frame hiện tại của Animator: tạm dừng
     clip đang phát trước để tick không ghi đè pose vừa áp. */
  function applyPoseFromLibrary(poseId, opts) {
    opts = opts || {};
    var Pose = getPose();
    if (!Pose) return { ok: false, error: 'Pose Library chưa load.' };
    var p = resolvePoseData(poseId);
    if (!p) return { ok: false, error: 'Không tìm thấy pose: ' + poseId };
    var paused = null;
    var AN = getAnimator();
    var KF = getKF();
    if (AN && AN.playing && !AN.paused) {
      var cur = AN.currentId ? AN.getClip(AN.currentId) : null;
      if (cur && cur.source === 'keyframe' && KF && typeof KF.pause === 'function') {
        try { KF.pause(); paused = 'keyframe'; } catch (e) {}
      } else if (typeof AN.pause === 'function') {
        try { AN.pause(); paused = 'animator'; } catch (e) {}
      }
    }
    var r;
    if (getRig() && typeof Pose.applyPose === 'function') {
      r = Pose.applyPose(p, opts);
    } else if (AN && AN._test && typeof AN._test.getBoneMap === 'function' && typeof Pose.applyPoseToBones === 'function') {
      var map = AN._test.getBoneMap();
      if (opts.reset !== false) {
        Object.keys(map).forEach(function (dst) { var b = map[dst]; if (b) b.rotation.set(0, 0, 0); });
      }
      r = Pose.applyPoseToBones(map, p);
    } else {
      return { ok: false, error: 'Không có control rig hay bone map để áp pose.' };
    }
    if (r && r.ok) {
      Sync._lastPose = { name: p.name, at: Date.now() };
      r.pausedPlayback = paused;
      r.pose = p.name;
    }
    return r || { ok: false, error: 'Áp pose không trả kết quả.' };
  }
  /* Lưu pose hiện tại của Animator vào Pose Library. */
  function saveCurrentPoseToLibrary(name) {
    var Pose = getPose();
    if (!Pose) return { ok: false, error: 'Pose Library chưa load.' };
    if (!name || !String(name).trim()) return { ok: false, error: 'Chưa nhập tên pose.' };
    name = String(name).trim();
    if (getRig() && typeof Pose.savePose === 'function') {
      /* savePose(name) không kèm pose = chụp pose hiện tại của rig. */
      return Pose.savePose(name);
    }
    var cap = captureCurrentPoseData(name);
    if (!cap.ok) return cap;
    if (typeof Pose.savePose !== 'function') return { ok: false, error: 'Pose.savePose chưa có.' };
    return Pose.savePose(name, cap.pose);
  }
  /* Mirror pose (pure, không áp): trả pose data đã mirror. */
  function mirrorPose(poseIdOrPose) {
    var Pose = getPose();
    var p = (poseIdOrPose && typeof poseIdOrPose === 'object' && poseIdOrPose.bones)
      ? poseIdOrPose : resolvePoseData(poseIdOrPose);
    if (!p) return null;
    if (Pose && typeof Pose.mirrorPose === 'function') {
      try { var m = Pose.mirrorPose(p); if (m) return m; } catch (e) {}
    }
    return { id: p.id ? p.id + '-mirrored' : undefined, name: (p.name || 'Pose') + ' (mirror)', bones: mirrorPoseMap(p.bones) };
  }
  /* Áp bản mirror của 1 pose trong Library. */
  function applyMirroredPose(poseId, opts) {
    var m = mirrorPose(poseId);
    if (!m) return { ok: false, error: 'Không tìm thấy pose: ' + poseId };
    return applyPoseFromLibrary(m, opts);
  }
  /* Mirror tư thế ĐANG ở trên rig (chụp hiện tại -> mirror -> áp). */
  function mirrorCurrentPose() {
    var Pose = getPose();
    if (getRig() && Pose && typeof Pose.mirrorCurrentPose === 'function') {
      return Pose.mirrorCurrentPose();
    }
    var cap = captureCurrentPoseData('Pose hiện tại (mirror)');
    if (!cap.ok) return cap;
    var m = { name: cap.pose.name + ' (mirror)', bones: mirrorPoseMap(cap.pose.bones) };
    return applyPoseFromLibrary(m);
  }

  /* ---------- public API ---------- */
  Sync.listAllClips = listAllClips;
  Sync.getClip = getClip;
  Sync.getSources = getSources;
  Sync.animatorEntries = animatorEntries;
  Sync.animatorIdFor = animatorIdFor;
  Sync.ensureAnimatorHas = ensureAnimatorHas;
  Sync.playClip = playClip;
  Sync.stopAll = stopAll;
  Sync.installWrappers = installWrappers;
  Sync.registerRetargetClip = registerRetargetClip;
  Sync.emitClipChanged = emitClipChanged;
  Sync.trimClip = trimClip;
  Sync.retimeClip = retimeClip;
  Sync.reverseClip = reverseClip;
  Sync.mirrorClip = mirrorClip;
  Sync.editKeyframeClip = editKeyframeClip;
  Sync.editClip = editClip;
  Sync.editCurrentAnimatorClip = editCurrentAnimatorClip;
  Sync.listPoses = listPoses;
  Sync.resolvePoseData = resolvePoseData;
  Sync.captureCurrentPoseData = captureCurrentPoseData;
  Sync.applyPoseFromLibrary = applyPoseFromLibrary;
  Sync.saveCurrentPoseToLibrary = saveCurrentPoseToLibrary;
  Sync.mirrorPose = mirrorPose;
  Sync.applyMirroredPose = applyMirroredPose;
  Sync.mirrorCurrentPose = mirrorCurrentPose;
  Sync._test = {
    stripBoneName: stripBoneName,
    counterpart: counterpart,
    mirrorEuler: mirrorEuler,
    mirrorPoseMap: mirrorPoseMap,
    detectKind: detectKind,
    toPlainTracks: toPlainTracks,
    tracksFromKeys: tracksFromKeys,
    keysFromTracks: keysFromTracks,
    sampleQuatPlain: sampleQuatPlain,
    sampleVecPlain: sampleVecPlain,
    trimKeys: trimKeys,
    mirrorKey: mirrorKey,
    poseAtKeys: poseAtKeys
  };

  PS.ArpSyncClips = Sync;

  /* Tự bọc các hàm gốc đã load sẵn; module gốc load muộn thì
     coordinator / UI gọi lại ArpSyncClips.installWrappers(). */
  try { installWrappers(); } catch (e) {}
})();

/* ============================================================
 * CẦN COORDINATOR GỘP (KHÔNG tự sửa file khác):
 * 1. index.html — thêm SAU arp-animator.js (và sau arp-qr3-keyframe.js,
 *    arp-qr3-pose.js, arp-qr3-liveretarget.js, arp-remap.js):
 *      <script src="js/rig/arp-sync-clips.js"></script>
 *    Thứ tự bắt buộc: keyframe/pose/liveretarget/remap/animator TRƯỚC,
 *    sync SAU — để installWrappers() bọc được hàm gốc ngay lúc load.
 *    Nếu thứ tự khác, gọi PixiStudio.ArpSyncClips.installWrappers()
 *    sau khi mọi module đã load (vd cuối app.js).
 * 2. js/rig/arp-animator.js — refreshClips(): thay phần liệt kê thủ
 *    công (Anim.clips / AnimAutoGen.definitions / Keyframe.clip /
 *    Coco / Hy3d) bằng:
 *      var sync = (window.PixiStudio && PixiStudio.ArpSyncClips);
 *      if (sync && sync.animatorEntries) { Animator._clips = sync.animatorEntries(); ... }
 *    (giữ _userClips/_extraClips như cũ; animatorEntries() đã gồm chúng).
 *    Đồng thời Animator.render() lắng nghe bus 'arp:animator-clip-changed'
 *    để refresh danh sách khi Keyframe ghi key mới (hiện Animator chỉ
 *    refresh khi listClips() được gọi).
 * 3. Không cần CSS mới (module không có UI riêng).
 * ============================================================ */
