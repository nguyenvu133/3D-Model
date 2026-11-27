/* ============================================================
 * PixiStudio.ArpExportSync — Đồng bộ Export ↔ Animator
 * (Vòng Export-sync, 2026-11-27 — user cho phép làm lại sau khi
 *  vòng Viewport bị chặn, chưa có code.)
 *
 * VẤN ĐỀ GỐC (phân tích agent D, vòng Viewport — P3):
 *  - Export.listClipsForExport() chỉ lấy clip từ Remap / AnimAutoGen /
 *    FbxRig / Coco / Hy3d / Thandieu + target.animations — KHÔNG gọi
 *    ArpSyncClips / ArpAnimator, nên clip Keyframe, clip đã trim /
 *    retime / reverse / mirror, clip retarget đều VÔ HÌNH với Export.
 *  - Animator.exportClipFBX() gọi FBXBinary.write trực tiếp (hardcode
 *    7300), bypass pipeline Export (preflight / bake / preset /
 *    version / texture / history) — 2 đường xuất FBX riêng.
 *  - Export không subscribe 'arp:animator-clip-changed'; Animator
 *    không emit khi editCurrentClip / deleteClip (chỉ wrapper sync
 *    emit). Event 'arp:animator-clip-edited' KHÔNG tồn tại — chỉ có
 *    'arp:animator-clip-changed'.
 *  - Export dedupe theo TÊN clip, Animator dùng id có prefix
 *    (anim: / autogen: / keyframe: / user: / retarget: / mixamo: /
 *    coco: / hy3d: ...) — entry Export cần syncId / animatorId.
 *
 * MODULE NÀY:
 *  - listAnimatorClips(): 1 nguồn duy nhất qua
 *    ArpSyncClips.listAllClips() — Keyframe / trim / retime /
 *    reverse / mirror / retarget / autogen / user / mixamo / coco /
 *    hy3d. Mỗi entry: {syncId, animatorId, name, source, duration,
 *    fps, loop, trackCount, clip, keys, exportable, reason, note}.
 *  - exportAnimatorClip(syncId|animatorId, opts): delegate sang
 *    ArpExport.exportFile() — đi đủ pipeline (preflight / bake /
 *    preset / version / texture / history), KHÔNG gọi FBXBinary.write
 *    trực tiếp.
 *  - subscribe bus 'arp:animator-clip-changed' (chống đăng ký kép,
 *    cùng mẫu Animator.subscribeClipChanged) + onChange/offChange để
 *    tab Export tự cập nhật khi Animator thêm / sửa / xóa clip.
 *
 * GIỚI HẠN NÓI THẲNG (không bịa):
 *  - Live Retarget preview (ArpLiveRetarget.preview) áp retarget
 *    trực tiếp lên xương theo thời gian thực, KHÔNG tạo clip object
 *    nào — nên KHÔNG xuất được. Muốn xuất: bake thành clip retarget
 *    trước (tab Remap → Retarget) rồi xuất clip đó.
 *  - Clip AnimAutoGen dạng định nghĩa (chỉ phát, chưa sinh clip THREE
 *    thật) cũng không xuất được — entry có exportable:false + reason.
 *  - Mọi file FBX xuất ra đều 0 clip khi đọc bằng FBXLoader r128
 *    (giới hạn đã biết của FBXBinary.write — không ghi animation
 *    channels; clip kiểm chứng bằng JSON / THREE clip, không phải
 *    bằng file FBX xuất).
 * ============================================================ */
(function () {
  'use strict';

  var PS = window.PixiStudio || {};
  var bus = (PS && PS.bus) || { emit: function () {}, on: function () {} };
  var EVENT_CLIP_CHANGED = 'arp:animator-clip-changed';

  function getSync() { return PS.ArpSyncClips || null; }
  function getExport() { return PS.ArpExport || null; }
  function getAnimator() { return PS.ArpAnimator || null; }
  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message }); } catch (e) {}
  }

  /* ============================================================
     1. DANH SÁCH CLIP ANIMATOR — 1 NGUỒN DUY NHẤT
     ============================================================ */
  function listAnimatorClips(filter) {
    var SC = getSync();
    if (!SC || typeof SC.listAllClips !== 'function') return [];
    var out = [];
    var all = [];
    try { all = SC.listAllClips(filter) || []; } catch (e) { return []; }
    all.forEach(function (e) {
      if (!e || !e.id) return;
      var clip = e.clipObject || null;
      var hasTracks = !!(clip && clip.tracks && clip.tracks.length);
      var animatorId = e.id;
      try {
        if (typeof SC.animatorIdFor === 'function') animatorId = SC.animatorIdFor(e) || e.id;
      } catch (err) {}
      var reason = '';
      if (!hasTracks) {
        if (e.source === 'studio' && !clip) {
          reason = 'AnimAutoGen — chỉ phát, không có clip THREE riêng (không xuất FBX được).';
        } else if (e.source === 'keyframe') {
          reason = 'Clip Keyframe chưa build được THREE.AnimationClip từ keys (không xuất FBX được).';
        } else {
          reason = 'Clip chưa có THREE.AnimationClip (chỉ phát/preview, không xuất FBX được).';
        }
      }
      out.push({
        syncId: e.id,
        animatorId: animatorId,
        name: e.name || e.id,
        source: e.source || 'user',
        duration: (typeof e.duration === 'number') ? e.duration : 0,
        fps: e.fps || 30,
        loop: e.loop !== false,
        trackCount: e.trackCount || (hasTracks ? clip.tracks.length : 0),
        clip: clip,
        keys: e.keys || null,
        exportable: hasTracks,
        reason: reason,
        note: e.note || ''
      });
    });
    return out;
  }

  /* Tìm entry theo syncId HOẶC animatorId (Animator.currentId là
     animatorId, vd 'anim:Run' / 'keyframe:Clip 1' / 'user:Run_trim'). */
  function getClip(id) {
    if (!id) return null;
    if (id && typeof id === 'object') return id;
    var list = listAnimatorClips();
    for (var i = 0; i < list.length; i++) {
      if (list[i].syncId === id || list[i].animatorId === id) return list[i];
    }
    return null;
  }

  /* Thống kê nhanh cho UI tab Export. */
  function getStats() {
    var all = listAnimatorClips();
    var exp = 0;
    all.forEach(function (e) { if (e.exportable) exp++; });
    return { total: all.length, exportable: exp, playOnly: all.length - exp };
  }

  /* ============================================================
     2. XUẤT 1 CLIP ANIMATOR QUA PIPELINE EXPORT ĐẦY ĐỦ
     ============================================================ */
  function exportAnimatorClip(id, opts) {
    opts = opts || {};
    var entry = (id && typeof id === 'object') ? id : getClip(id);
    if (!entry) {
      return Promise.resolve({ ok: false, error: 'Không tìm thấy clip Animator "' + id + '" trong danh sách dùng chung.' });
    }
    if (!entry.exportable || !entry.clip) {
      return Promise.resolve({
        ok: false, notExportable: true, syncId: entry.syncId, animatorId: entry.animatorId, name: entry.name,
        error: 'Clip "' + entry.name + '" không xuất được: ' + (entry.reason || 'không có THREE.AnimationClip.')
      });
    }
    var EX = getExport();
    if (!EX || typeof EX.exportFile !== 'function') {
      return Promise.resolve({ ok: false, error: 'ArpExport chưa load — hard-refresh trang.' });
    }
    /* Delegate qua exportFile với selectedClipIds = [syncId]: Export
       đã gộp clip Animator vào listClipsForExport (dedupe bằng syncId)
       nên resolveClipsForExport tìm đúng clip này — đi đủ preflight /
       bake / preset / version / texture / history. */
    var o2 = Object.assign({}, opts);
    delete o2.clips;
    o2.animationSelection = 'selected';
    o2.selectedClipIds = [entry.syncId];
    var r;
    try {
      r = EX.exportFile(null, o2);
    } catch (e) {
      return Promise.resolve({ ok: false, error: 'ArpExport.exportFile lỗi: ' + (e && e.message || e) });
    }
    return Promise.resolve(r);
  }

  /* Xuất clip Animator ĐANG CHỌN (Animator.currentId là animatorId). */
  function exportCurrentAnimatorClip(opts) {
    var AN = getAnimator();
    var cur = AN && AN.currentId;
    if (!cur) {
      return Promise.resolve({ ok: false, error: 'Chưa chọn clip nào trong Animator — chọn 1 clip ở tab Animator trước.' });
    }
    return exportAnimatorClip(cur, opts);
  }

  /* ============================================================
     3. SUBSCRIBE BUS — CHỐNG ĐĂNG KÝ KÉP
     (cùng mẫu Animator.subscribeClipChanged)
     ============================================================ */
  var _subscribed = false;
  var _listeners = [];

  function subscribe() {
    if (_subscribed) return { ok: true, already: true };
    var b = (window.PixiStudio && window.PixiStudio.bus) || null;
    if (!b || typeof b.on !== 'function') return { ok: false, error: 'bus chưa có.' };
    _subscribed = true;
    try {
      b.on(EVENT_CLIP_CHANGED, function (data) {
        _listeners.slice().forEach(function (fn) {
          try { fn(data); } catch (e) {}
        });
      });
    } catch (e) {
      _subscribed = false;
      return { ok: false, error: (e && e.message) || String(e) };
    }
    return { ok: true };
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return _listeners.length;
    subscribe();
    if (_listeners.indexOf(fn) < 0) _listeners.push(fn);
    return _listeners.length;
  }

  function offChange(fn) {
    var i = _listeners.indexOf(fn);
    if (i >= 0) _listeners.splice(i, 1);
    return _listeners.length;
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  var ArpExportSync = {
    EVENT_CLIP_CHANGED: EVENT_CLIP_CHANGED,
    listAnimatorClips: listAnimatorClips,
    getClip: getClip,
    getStats: getStats,
    exportAnimatorClip: exportAnimatorClip,
    exportCurrentAnimatorClip: exportCurrentAnimatorClip,
    subscribe: subscribe,
    onChange: onChange,
    offChange: offChange,
    notify: notify
  };

  ArpExportSync._test = {
    listAnimatorClips: listAnimatorClips,
    getClip: getClip,
    getStats: getStats,
    exportAnimatorClip: exportAnimatorClip,
    exportCurrentAnimatorClip: exportCurrentAnimatorClip,
    subscribe: subscribe,
    onChange: onChange,
    offChange: offChange,
    isSubscribed: function () { return _subscribed; },
    listenerCount: function () { return _listeners.length; }
  };

  PS.ArpExportSync = ArpExportSync;

  /* Đăng ký bus ngay khi load (module load sau arp-sync-clips.js nên
     bus đã có; nếu chưa có, onChange() sẽ subscribe lại lúc cần). */
  try { subscribe(); } catch (e) {}
})();
