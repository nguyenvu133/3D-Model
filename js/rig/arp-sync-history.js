/* ============================================================
 * rig/arp-sync-history.js — HISTORY DÙNG CHUNG + EVENT BUS
 * (Auto Rig Pro Blend — đồng bộ Quick Rig ↔ Animator, phần 3/4)
 *
 * Namespace: window.PixiStudio.ArpSyncHistory
 *
 * MỤC ĐÍCH
 *   • MỘT stack History duy nhất: mọi thao tác Animator (trim /
 *     retime / reverse / mirror, thêm-xóa event marker, đổi layer,
 *     đổi clip) đều ghi vào CÙNG stack của ArpQuickRig.History
 *     (js/rig/arp-qr3-history.js). Module này KHÔNG tạo stack
 *     riêng, KHÔNG sửa file nào khác — chỉ bọc (wrap) các hàm
 *     public của Animator / QuickRig / Pose ở runtime.
 *   • Cầu nối event bus: định nghĩa + tập trung các event đồng bộ
 *     trên PixiStudio.bus; 2 panel không gọi trực tiếp lẫn nhau.
 *     1 clip object, 1 control state — cả 2 panel cùng đọc/ghi
 *     qua API public + bus; module này chỉ làm cầu nối + ghi history.
 *
 * CÁCH HOẠT ĐỘNG (History dùng chung)
 *   • Mỗi thao tác Animator được ghi thành ĐÚNG 1 entry trên stack
 *     QR3, mang snapshot trạng thái Animator SAU thao tác. Riêng
 *     thao tác Animator ĐẦU TIÊN (khi stack chưa có entry _sync
 *     nào) ghi thêm 1 entry baseline mang snapshot TRƯỚC thao tác,
 *     để undo của nó có chỗ đáp xuống. Vì undo() của QR3 khôi phục
 *     đúng entry nó đáp xuống, nên quy tắc khôi phục là thống nhất:
 *     sau mỗi undo/redo/jumpTo, áp trạng thái Animator của entry
 *     _sync GẦN NHẤT tại hoặc trước index hiện tại (entry pose
 *     thuần của Quick Rig xen giữa không mang _sync nên được bỏ
 *     qua — clip không đổi trong các thao tác pose đó nên trạng
 *     thái _sync gần nhất vẫn đúng).
 *   • Pose snapshot trong mỗi entry vẫn do History.pushState chụp
 *     (clip edit không làm xương di chuyển nên pose trước = pose
 *     sau; push sau khi sửa vẫn đúng). Trạng thái Animator được
 *     gắn thêm vào entry qua History._test.getStack()[i]._sync
 *     (không sửa file history — chỉ gắn 1 field lên object entry).
 *   • undo()/redo()/jumpTo() được bọc: sau khi QR3 khôi phục pose,
 *     wrapper áp trạng thái Animator theo quy tắc trên. Các hàm
 *     layer của History (createLayer/deleteLayer/setLayerEnabled/
 *     setLayerStrength/captureLayerDelta/captureBasePose) cũng
 *     được bọc để thao tác layer qua UI cũng ghi vào stack chung.
 *     Các nút Undo/Redo trong UI của History gọi closure nội bộ
 *     của history.js nên không qua wrapper — bù lại module subscribe
 *     'arpqr-history:undone/redone/jumped' trên bus (history.js
 *     emit các event này) để áp trạng thái Animator cho cả đường UI.
 *   • Snapshot Animator là dữ liệu thuần, TRỪ tham chiếu tới object
 *     THREE.AnimationClip: các phép trim/retime/reverse/mirror của
 *     Animator là hàm THUẦN (trả clip MỚI, không sửa clip gốc) và
 *     không có code nào sửa tracks của clip đã đăng ký tại chỗ, nên
 *     giữ tham chiếu clip là khôi phục CHÍNH XÁC (không lỗi làm
 *     tròn do serialize). Events / additive / blend / layers được
 *     deep-clone vì chúng bị sửa tại chỗ (push/splice/gán).
 *
 * BẢNG CONTRACT EVENT (tên | ai emit | ai nghe | payload)
 *   • arp:animator-clip-changed
 *       Emit: ArpSyncHistory (khi registry clip đổi: đăng ký/xóa
 *         clip user, keyframe clip mới) | Nghe: Animator (render
 *         lại danh sách clip), panel khác cần refresh clip list.
 *       Payload: { clipId, change: 'added'|'deleted', op?, source? }
 *   • arp:animator-clip-edited
 *       Emit: ArpSyncHistory (wrap editCurrentClip/addEvent/
 *         deleteEvent) | Nghe: Animator (render lại), History UI.
 *       Payload: { clipId, op: 'trim'|'retime'|'reverse'|'mirror'|
 *         'add-event'|'delete-event', eventId?, id? }
 *   • arp:quickrig-control-changed
 *       Emit: ArpSyncHistory (bridge từ 'arpquickrig:limb-mode',
 *         'arpquickrig:advik-*', 'arpquickrig:map-changed' + wrap
 *         các setter QuickRig) | Nghe: Animator (đồng bộ control
 *         khi phát clip), viewport.
 *       Payload: { limb, mode, value, prev? }
 *   • arp:pose-applied
 *       Emit: ArpSyncHistory (wrap Pose.applyPose / applyMirroredPose
 *         / blendPose, hoặc gọi tay notifyPoseApplied) | Nghe:
 *         Animator (đồng bộ pose 2 chiều), History UI.
 *       Payload: { poseId, name?, mirrored?, blend? }
 *   • arp:history-changed
 *       Emit: ArpSyncHistory (sau mọi push/undo/redo/jumpTo/clear
 *         trên stack dùng chung) | Nghe: panel Animator + Quick Rig
 *         (bật/tắt nút Undo/Redo, refresh danh sách lịch sử).
 *       Payload: { canUndo, canRedo, depth, index, maxSteps }
 *
 * LOAD ORDER (coordinator append script tag, KHÔNG sửa file khác):
 *   js/core/events.js → js/rig/arp-quickrig.js →
 *   js/rig/arp-qr3-history.js → js/rig/arp-animator.js →
 *   js/rig/arp-qr3-pose.js → js/rig/arp-sync-history.js (file này,
 *   SAU animator.js để wrap được hàm gốc).
 *   Module tự thử install() lúc load; nếu Animator/History chưa có
 *   (load sai thứ tự), gọi lại PixiStudio.ArpSyncHistory.install().
 *
 * GIỚI HẠN TRUNG THỰC — ĐỌC KỸ:
 *   • Cần 1 control rig đang mở (QR.current) để History.pushState
 *     hoạt động: thao tác Animator khi chưa convert/autoGen model
 *     vẫn chạy bình thường nhưng KHÔNG được ghi history (console.warn,
 *     thao tác không undo được). Đây là giới hạn của stack QR3, không
 *     phải của module này — tạo stack riêng cho Animator sẽ vi phạm
 *     yêu cầu "1 stack duy nhất" nên module chọn fail-open có cảnh báo.
 *   • Undo khôi phục clip object / registry / events / layer state,
 *     KHÔNG khôi phục file đã xuất (JSON/FBX đã download) và không
 *     khôi phục clip keyframe đang ghi dở của Keyframe module (clip
 *     keyframe là nguồn do Keyframe sở hữu; Animator chỉ đọc).
 *   • Event bus là fire-and-forget (EventBus.emit catch lỗi từng
 *     listener): subscriber lỗi không chặn được thao tác, và emit
 *     không báo có bao nhiêu subscriber đã nhận.
 *   • Wrap runtime chỉ có hiệu lực khi file này load SAU animator.js
 *     (và sau qr3-history.js / qr3-pose.js). Nếu Animator được eval
 *     lại sau đó, wrap mất — gọi lại install().
 *   • Thao tác Animator đầu tiên sau khi stack trống (hoặc sau
 *     khi đổi rig làm stack reset) ghi 2 entry (baseline + sau);
 *     các thao tác sau ghi 1 entry. Giới hạn stack
 *     (History.getMaxSteps(), mặc định 50) tính theo entry.
 * ============================================================ */
(function () {
  'use strict';

  var PS = window.PixiStudio || (window.PixiStudio = {});

  /* ---------- truy cập module khác (defensive, resolve mỗi lần) ---------- */
  function getBus() { return (window.PixiStudio && PixiStudio.bus) || null; }
  function getQR() { return (window.PixiStudio && PixiStudio.ArpQuickRig) || null; }
  function getHistory() {
    var QR = getQR();
    return (QR && QR.History) || null;
  }
  function getAnimator() { return (window.PixiStudio && PixiStudio.ArpAnimator) || null; }
  function getPose() {
    var QR = getQR();
    return (QR && QR.Pose) || null;
  }

  /* ---------- clone dữ liệu thuần ---------- */
  function clonePlain(v) {
    if (v === null || v === undefined) return v;
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    if (Array.isArray(v)) return v.map(function (x) { return clonePlain(x); });
    if (typeof v === 'object') {
      var out = {};
      Object.keys(v).forEach(function (k) { out[k] = clonePlain(v[k]); });
      return out;
    }
    return v;
  }
  function cloneVec(v) {
    if (!v) return v;
    return { x: v.x || 0, y: v.y || 0, z: v.z || 0 };
  }

  /* ============================================================
     SNAPSHOT / RESTORE — trạng thái Animator (+ QR3 layers)
     ============================================================ */
  function cloneClipEntry(e) {
    if (!e) return null;
    /* Entry là object do registerClip tạo; clip (THREE.AnimationClip)
       và keys được giữ tham chiếu — xem ghi chú ở đầu file. */
    return {
      id: e.id, name: e.name, duration: e.duration, fps: e.fps,
      loop: e.loop, source: e.source, clip: e.clip || null,
      keys: e.keys || null, userCreated: e.userCreated
    };
  }
  function snapshotAnimator() {
    var AN = getAnimator();
    if (!AN) return null;
    var H = getHistory();
    var snap = {
      userClips: (AN._userClips || []).map(cloneClipEntry),
      extraClips: (AN._extraClips || []).map(cloneClipEntry),
      currentId: AN.currentId || null,
      events: clonePlain(AN.events || {}),
      additive: clonePlain(AN.additive || { clipId: null, weight: 0.5, enabled: false }),
      blend: clonePlain(AN.blend || { clipBId: null, weight: 0 }),
      rootMotion: !!AN.rootMotion,
      evSeq: AN._evSeq || 0,
      qr3Layers: null,
      qr3BasePose: null
    };
    /* Layers QR3 (nếu có rig + History): delta/enabled/strength + Base. */
    try {
      if (H && H._test) {
        var layers = H._test.getLayers ? H._test.getLayers() : null;
        if (layers) snap.qr3Layers = clonePlain(layers);
        var base = H._test.getBasePose ? H._test.getBasePose() : null;
        if (base) snap.qr3BasePose = clonePlain(base);
      }
    } catch (e) {}
    return snap;
  }

  function applyAnimatorState(snap) {
    var AN = getAnimator();
    if (!AN || !snap) return { ok: false, error: 'Không có Animator hoặc snapshot.' };
    AN._userClips = (snap.userClips || []).map(cloneClipEntry);
    AN._extraClips = (snap.extraClips || []).map(cloneClipEntry);
    AN.events = clonePlain(snap.events || {});
    AN.additive = clonePlain(snap.additive || { clipId: null, weight: 0.5, enabled: false });
    AN.blend = clonePlain(snap.blend || { clipBId: null, weight: 0 });
    AN.rootMotion = !!snap.rootMotion;
    /* _evSeq chỉ tăng, không lùi — tránh trùng id event đã xóa rồi
       tạo lại sau khi undo (id cũ có thể vẫn còn trong firedLog). */
    if (typeof AN._evSeq === 'number') AN._evSeq = Math.max(AN._evSeq, snap.evSeq || 0);
    AN._firedIds = {};
    AN.firedLog = [];
    /* currentId: chỉ giữ nếu clip còn tồn tại sau khi refresh. */
    var wantId = snap.currentId || null;
    try { if (typeof AN.refreshClips === 'function') AN.refreshClips(); } catch (e) {}
    if (wantId) {
      var stillThere = false;
      try { stillThere = !!AN.getClip(wantId); } catch (e) {}
      if (stillThere) {
        AN.currentId = wantId;
      } else {
        if (AN.playing) { try { if (typeof AN.stop === 'function') AN.stop(); } catch (e) {} }
        AN.currentId = null;
      }
    } else {
      AN.currentId = null;
    }
    /* Khôi phục layers QR3 (nếu snapshot có + History còn rig). */
    var H = getHistory();
    try {
      if (H && H._test && snap.qr3Layers) {
        var live = H._test.getLayers ? H._test.getLayers() : null;
        if (live) {
          live.length = 0;
          snap.qr3Layers.forEach(function (l) { live.push(clonePlain(l)); });
        }
        var liveBase = H._test.getBasePose ? H._test.getBasePose() : null;
        if (liveBase && snap.qr3BasePose) {
          Object.keys(liveBase).forEach(function (k) { delete liveBase[k]; });
          var nb = clonePlain(snap.qr3BasePose);
          Object.keys(nb).forEach(function (k) { liveBase[k] = nb[k]; });
        }
        var QR = getQR();
        if (QR && QR.current && typeof H.applyLayers === 'function') H.applyLayers();
      }
    } catch (e) {}
    return { ok: true, currentId: AN.currentId };
  }

  /* Tìm entry _sync gần nhất tại hoặc trước index i trên stack dùng
     chung rồi áp trạng thái Animator của nó. Entry pose thuần của
     Quick Rig (không có _sync) được bỏ qua — clip không đổi trong
     các thao tác pose đó nên trạng thái _sync gần nhất vẫn đúng. */
  function applySyncForIndex(i) {
    var H = getHistory();
    if (!H || !H._test || typeof H._test.getStack !== 'function') {
      return { ok: false, error: 'Không có stack History.' };
    }
    var stack = H._test.getStack();
    i = Math.floor(Number(i));
    if (isNaN(i) || i < 0) i = stack.length - 1;
    for (var j = i; j >= 0; j--) {
      var entry = stack[j];
      if (entry && entry._sync && entry._sync.state) {
        var r = applyAnimatorState(entry._sync.state);
        return { ok: r.ok, index: j, label: entry._sync.label, op: entry._sync.op, applied: r.ok };
      }
    }
    return { ok: false, reason: 'no-sync-entry', applied: false };
  }

  /* ============================================================
     EVENT BUS — emit / on (wrapper quanh PixiStudio.bus)
     ============================================================ */
  function emit(event, data) {
    var bus = getBus();
    if (!bus || typeof bus.emit !== 'function') {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[ArpSyncHistory] bus chưa sẵn — bỏ event "' + event + '".');
      }
      return { ok: false, error: 'bus chưa sẵn' };
    }
    try {
      bus.emit(event, data);
      return { ok: true, event: event };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }
  function on(event, fn) {
    var bus = getBus();
    if (!bus || typeof bus.on !== 'function') {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[ArpSyncHistory] bus chưa sẵn — không đăng ký được "' + event + '".');
      }
      return { ok: false, error: 'bus chưa sẵn' };
    }
    try {
      bus.on(event, fn);
      state.subscriptions++;
      return { ok: true, event: event };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  /* ============================================================
     HISTORY DÙNG CHUNG
     ============================================================ */
  var state = {
    installed: false,
    subscriptions: 0,
    wrappedAnimator: [],
    wrappedQuickRig: [],
    wrappedPose: [],
    historyWrapped: false,
    insideWrappedHistoryCall: false, /* chặn áp-sync 2 lần (wrapper + bus) */
    missedRecords: 0
  };
  var _orig = {}; /* giữ hàm gốc để uninstall() khôi phục */

  function historyStatus() {
    var H = getHistory();
    if (!H) return { ok: false, hasHistory: false, depth: 0, index: -1, canUndo: false, canRedo: false, maxSteps: 0 };
    var depth = 0, index = -1, maxSteps = 0;
    try {
      if (H._test && typeof H._test.getStack === 'function') depth = H._test.getStack().length;
      if (H._test && typeof H._test.getIndex === 'function') index = H._test.getIndex();
      if (typeof H.getMaxSteps === 'function') maxSteps = H.getMaxSteps();
    } catch (e) {}
    return {
      ok: true, hasHistory: true, hasAnimator: !!getAnimator(),
      installed: state.installed, depth: depth, index: index,
      canUndo: (typeof H.canUndo === 'function') ? H.canUndo() : false,
      canRedo: (typeof H.canRedo === 'function') ? H.canRedo() : false,
      maxSteps: maxSteps
    };
  }

  function emitHistoryChanged() {
    var st = historyStatus();
    emit('arp:history-changed', {
      canUndo: st.canUndo, canRedo: st.canRedo,
      depth: st.depth, index: st.index, maxSteps: st.maxSteps
    });
    return st;
  }

  /* Ghi 1 thao tác Animator (đã xảy ra) vào stack dùng chung:
     1 entry mang snapshot AFTER. Nếu stack chưa có entry _sync nào
     (thao tác Animator đầu tiên / sau khi đổi rig reset stack), ghi
     thêm 1 entry baseline mang snapshot BEFORE để undo có chỗ đáp.
     Trả {ok:false} khi chưa có rig (thao tác vẫn đã xảy ra, chỉ
     không undo được — xem giới hạn ở đầu file). */
  function pushAnimatorAction(label, before, after, op) {
    var H = getHistory();
    if (!H) return { ok: false, error: 'Chưa có ArpQuickRig.History — load arp-qr3-history.js trước.' };
    if (!before || !after) return { ok: false, error: 'pushAnimatorAction cần cả before và after (snapshotAnimator).' };
    label = String(label || 'Thao tác Animator');
    var hasSync = false;
    try {
      if (H._test && typeof H._test.getStack === 'function') {
        var st = H._test.getStack();
        for (var i = 0; i < st.length; i++) { if (st[i] && st[i]._sync) { hasSync = true; break; } }
      }
    } catch (e) {}
    if (!hasSync) {
      var r0 = H.pushState(label + ' (trước)');
      if (!r0.ok) {
        state.missedRecords++;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[ArpSyncHistory] không ghi được history cho "' + label + '": ' + r0.error);
        }
        return { ok: false, error: r0.error, recorded: false };
      }
      attachSync(op, label + ' (trước)', before);
    }
    var r = H.pushState(label);
    if (!r.ok) {
      state.missedRecords++;
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[ArpSyncHistory] không ghi được history cho "' + label + '": ' + r.error);
      }
      return { ok: false, error: r.error, recorded: false };
    }
    attachSync(op, label, after);
    emitHistoryChanged();
    return { ok: true, label: label, op: op || null, depth: r.count, index: r.index };
  }

  function attachSync(op, label, snap) {
    try {
      var H = getHistory();
      if (!H || !H._test || typeof H._test.getStack !== 'function') return false;
      if (typeof H._test.getIndex !== 'function') return false;
      var idx = H._test.getIndex();
      var stack = H._test.getStack();
      if (stack[idx]) stack[idx]._sync = { kind: 'animator', op: op || null, label: label, state: snap };
      return true;
    } catch (e) { return false; }
  }

  /* API tay cho Animator / code khác tự ghi 1 thao tác:
     const before = Sync.snapshotAnimator(); ...sửa...;
     Sync.pushAnimatorAction('Tên thao tác', before, Sync.snapshotAnimator());
     Dùng cho các thao tác không qua wrapper (vd Mixamo Rig bake). */
  function recordMutator(label, fn, op) {
    var before = snapshotAnimator();
    var r = (typeof fn === 'function') ? fn() : undefined;
    var after = snapshotAnimator();
    var rec = pushAnimatorAction(label, before, after, op || null);
    return { result: r, recorded: rec };
  }

  /* Đổi layer (Animator additive hoặc QR3 control layer) có ghi history.
     fn là hàm tự sửa layer (vd () => History.setLayerEnabled('X', false));
     before/after snapshot cả additive + QR3 layers nên undo về đúng. */
  function recordLayerChange(label, fn) {
    return recordMutator(label, fn, 'layer');
  }

  /* Đổi lớp Additive của Animator (Animator không có setter public —
     UI gán trực tiếp Animator.additive.* nên module này cung cấp
     1 đường đổi duy nhất có ghi history). */
  function setAdditive(clipId, weight, enabled) {
    var AN = getAnimator();
    if (!AN) return { ok: false, error: 'Chưa có ArpAnimator.' };
    var before = snapshotAnimator();
    if (clipId !== undefined) AN.additive.clipId = clipId || null;
    if (weight !== undefined && weight !== null) AN.additive.weight = Math.max(0, Math.min(1, Number(weight) || 0));
    if (enabled !== undefined && enabled !== null) AN.additive.enabled = !!enabled;
    var after = snapshotAnimator();
    var rec = pushAnimatorAction(
      'Additive layer: ' + (AN.additive.clipId || '(không clip)') + ' ' +
      Math.round(AN.additive.weight * 100) + '% ' + (AN.additive.enabled ? 'BẬT' : 'TẮT'),
      before, after, 'layer');
    return { ok: true, additive: clonePlain(AN.additive), recorded: rec.ok };
  }

  function notifyPoseApplied(poseId, extra) {
    var data = { poseId: poseId === undefined ? null : poseId };
    if (extra && typeof extra === 'object') {
      Object.keys(extra).forEach(function (k) { data[k] = extra[k]; });
    }
    return emit('arp:pose-applied', data);
  }

  /* ---------- bọc History.undo/redo/jumpTo/clear/resetAll ---------- */
  function wrapHistory() {
    var H = getHistory();
    if (!H || state.historyWrapped) return { ok: false, reason: state.historyWrapped ? 'already-wrapped' : 'no-history' };
    ['undo', 'redo', 'jumpTo'].forEach(function (name) {
      if (typeof H[name] !== 'function') return;
      _orig['History.' + name] = H[name];
      H[name] = (function (orig, n) {
        return function () {
          state.insideWrappedHistoryCall = true;
          var r;
          try { r = orig.apply(H, arguments); }
          finally { state.insideWrappedHistoryCall = false; }
          if (r && r.ok) {
            try { applySyncForIndex(H._test.getIndex()); } catch (e) {}
            emitHistoryChanged();
          }
          return r;
        };
      })(H[name], name);
    });
    ['clear', 'resetAll'].forEach(function (name) {
      if (typeof H[name] !== 'function') return;
      _orig['History.' + name] = H[name];
      H[name] = (function (orig) {
        return function () {
          var r = orig.apply(H, arguments);
          emitHistoryChanged();
          return r;
        };
      })(H[name]);
    });
    state.historyWrapped = true;
    return { ok: true };
  }

  /* ---------- bọc các hàm layer của History → ghi vào stack chung
     (để thao tác layer qua UI cũng undo được; snapshot đã gồm cả
     QR3 layers nên undo về đúng trạng thái layer trước đó). ---------- */
  function wrapHistoryLayers() {
    var H = getHistory();
    if (!H) return { ok: false, error: 'Chưa có ArpQuickRig.History.' };
    var names = ['createLayer', 'deleteLayer', 'setLayerEnabled', 'setLayerStrength', 'captureLayerDelta', 'captureBasePose'];
    var n = 0;
    names.forEach(function (name) {
      if (typeof H[name] !== 'function' || H[name].__arpSyncWrapped) return;
      var orig = H[name];
      _orig['History.' + name] = orig;
      H[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        var before = snapshotAnimator();
        var r = orig.apply(H, args);
        if (r && r.ok) {
          var after = snapshotAnimator();
          pushAnimatorAction('Layer: ' + name + '(' + args.map(function (a) { return String(a); }).join(', ') + ')', before, after, 'layer');
        }
        return r;
      };
      H[name].__arpSyncWrapped = true;
      n++;
    });
    return { ok: true, wrapped: n };
  }

  /* ---------- bọc Animator (trim/retime/reverse/mirror/event/layer) ---------- */
  function wrapAnimator() {
    var AN = getAnimator();
    if (!AN) return { ok: false, error: 'Chưa có ArpAnimator.' };
    function wrapOne(name, labelOf, emitAfter) {
      if (typeof AN[name] !== 'function') return false;
      if (AN[name].__arpSyncWrapped) return true;
      var orig = AN[name];
      _orig['Animator.' + name] = orig;
      AN[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        var before = snapshotAnimator();
        var r = orig.apply(AN, args);
        if (r && r.ok) {
          var after = snapshotAnimator();
          var label = labelOf(args, r);
          pushAnimatorAction(label, before, after, opForAnimatorFn(name, args));
          if (typeof emitAfter === 'function') emitAfter(args, r);
        }
        return r;
      };
      AN[name].__arpSyncWrapped = true;
      state.wrappedAnimator.push(name);
      return true;
    }
    wrapOne('editCurrentClip', function (args, r) {
      var op = args[0];
      var entry = null;
      try { entry = AN.getClip(AN.currentId); } catch (e) {}
      var label = 'Animator ' + op + ' clip "' + ((entry && entry.name) || AN.currentId || '?') + '"' +
        (op === 'trim' && args[1] ? ' ' + args[1].start + 's–' + args[1].end + 's' : '') +
        (op === 'retime' && args[1] ? ' ×' + args[1].factor : '');
      return label;
    }, function (args, r) {
      emit('arp:animator-clip-edited', { clipId: r.id, op: args[0], sourceClipId: AN.currentId });
      emit('arp:animator-clip-changed', { clipId: r.id, change: 'added', op: args[0] });
    });
    wrapOne('addEvent', function (args, r) {
      return 'Thêm event "' + (args[0] || '') + '" @' + (r.event ? r.event.t : '?') + 's';
    }, function (args, r) {
      emit('arp:animator-clip-edited', { clipId: r.clipId, op: 'add-event', eventId: r.event && r.event.id });
    });
    wrapOne('deleteEvent', function (args) {
      return 'Xóa event ' + (args[1] || '') + ' (clip ' + (args[0] || AN.currentId || '?') + ')';
    }, function (args, r) {
      emit('arp:animator-clip-edited', { clipId: args[0], op: 'delete-event', eventId: args[1] });
    });
    wrapOne('deleteClip', function (args, r) {
      return 'Xóa clip "' + (r.name || args[0] || '?') + '"';
    }, function (args, r) {
      emit('arp:animator-clip-changed', { clipId: args[0], change: 'deleted' });
    });
    wrapOne('registerClip', function (args, r) {
      return 'Đăng ký clip "' + (r.name || (args[0] && args[0].name) || '?') + '"';
    }, function (args, r) {
      emit('arp:animator-clip-changed', { clipId: r.id, change: 'added', source: (args[0] && args[0].source) || 'user' });
    });
    wrapOne('setBlend', function (args) {
      return 'Blend 2 clip (' + (args[0] || '?') + ', ' + Math.round((Number(args[1]) || 0) * 100) + '%)';
    }, null);
    wrapOne('clearBlend', function () { return 'Xóa blend 2 clip'; }, null);
    wrapOne('setRootMotion', function (args) {
      return 'Root motion ' + (args[0] ? 'BẬT' : 'TẮT');
    }, null);
    /* Ghi op đúng cho từng wrapper (labelOf là hàm — lấy op từ tên). */
    return { ok: true, wrapped: state.wrappedAnimator.slice() };
  }

  /* Op cho pushAnimatorAction: suy từ tên hàm bọc (editCurrentClip lấy
     op từ args[0]; các hàm còn lại map theo tên). */
  function opForAnimatorFn(name, args) {
    if (name === 'editCurrentClip') return args[0];
    if (name === 'addEvent') return 'add-event';
    if (name === 'deleteEvent') return 'delete-event';
    if (name === 'deleteClip') return 'delete-clip';
    if (name === 'registerClip') return 'register-clip';
    if (name === 'setBlend') return 'blend';
    if (name === 'clearBlend') return 'blend';
    if (name === 'setRootMotion') return 'root-motion';
    return name;
  }

  /* ---------- bọc setter QuickRig → chỉ phát event, KHÔNG push history
     (history pose của Quick Rig đã có histPush ở tab Quick Rig gốc;
     push thêm ở đây sẽ ghi đúp 1 thao tác thành 2 entry pose). ---------- */
  function wrapQuickRig() {
    var QR = getQR();
    if (!QR) return { ok: false, error: 'Chưa có ArpQuickRig.' };
    var table = [
      { fn: 'setFKRotation', mode: 'fk', limb: 0, value: 1 },
      { fn: 'moveIKTarget', mode: 'ik', limb: 0, value: 1 },
      { fn: 'setPolePosition', mode: 'pole', limb: 0, value: 1 },
      { fn: 'setFingerCurl', mode: 'finger', limb: 0, value: 1 },
      { fn: 'setFootRoll', mode: 'foot', limb: 0, value: 1 },
      { fn: 'setSpineRotation', mode: 'spine', limb: 0, value: 1 },
      { fn: 'setHeadRotation', mode: 'head', limb: null, value: 0 },
      { fn: 'setNeckRotation', mode: 'neck', limb: null, value: 0 },
      { fn: 'setJaw', mode: 'jaw', limb: null, value: 0 }
    ];
    var n = 0;
    table.forEach(function (t) {
      if (typeof QR[t.fn] !== 'function' || QR[t.fn].__arpSyncWrapped) return;
      var orig = QR[t.fn];
      _orig['QuickRig.' + t.fn] = orig;
      QR[t.fn] = (function (origFn, spec) {
        return function () {
          var args = Array.prototype.slice.call(arguments);
          var r = origFn.apply(QR, args);
          try {
            var v = spec.value !== null && spec.value !== undefined ? args[spec.value] : args[0];
            emit('arp:quickrig-control-changed', {
              limb: (spec.limb !== null && spec.limb !== undefined) ? args[spec.limb] : null,
              mode: spec.mode,
              value: (v && typeof v === 'object') ? clonePlain(v) : v
            });
          } catch (e) {}
          return r;
        };
      })(orig, t);
      QR[t.fn].__arpSyncWrapped = true;
      state.wrappedQuickRig.push(t.fn);
      n++;
    });
    return { ok: true, wrapped: n };
  }

  /* ---------- bọc Pose → phát arp:pose-applied (Pose không emit bus) ---------- */
  function wrapPose() {
    var P = getPose();
    if (!P) return { ok: false, error: 'Chưa có ArpQuickRig.Pose.' };
    function poseName(p) {
      if (!p) return null;
      if (typeof p === 'string') return p;
      return p.name || p.id || null;
    }
    function wrapOne(name, extra) {
      if (typeof P[name] !== 'function' || P[name].__arpSyncWrapped) return false;
      var orig = P[name];
      _orig['Pose.' + name] = orig;
      P[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        var r = orig.apply(P, args);
        if (!r || r.ok !== false) {
          try {
            var data = { poseId: poseName(args[0]) };
            if (extra) Object.keys(extra).forEach(function (k) { data[k] = extra[k]; });
            if (name === 'blendPose') {
              data.poseId = poseName(args[0]) + '+' + poseName(args[1]);
              data.blend = true;
            }
            emit('arp:pose-applied', data);
          } catch (e) {}
        }
        return r;
      };
      P[name].__arpSyncWrapped = true;
      state.wrappedPose.push(name);
      return true;
    }
    wrapOne('applyPose');
    wrapOne('applyMirroredPose', { mirrored: true });
    wrapOne('blendPose');
    return { ok: true, wrapped: state.wrappedPose.slice() };
  }

  /* ---------- bridge: event có sẵn → event đồng bộ ---------- */
  function subscribeBridges() {
    var bus = getBus();
    if (!bus || typeof bus.on !== 'function') return { ok: false, error: 'bus chưa sẵn' };
    function sub(evt, fn) {
      if (bus.__arpSyncSubs && bus.__arpSyncSubs[evt]) return false;
      bus.__arpSyncSubs = bus.__arpSyncSubs || {};
      var wrapped = fn;
      bus.__arpSyncSubs[evt] = wrapped;
      bus.on(evt, wrapped);
      state.subscriptions++;
      return true;
    }
    /* QuickRig control → arp:quickrig-control-changed */
    sub('arpquickrig:limb-mode', function (d) {
      if (!d) return;
      emit('arp:quickrig-control-changed', { limb: d.limb, mode: d.mode, value: d.mode, prev: d.prev });
    });
    sub('arpquickrig:advik-solve', function (d) {
      if (!d) return;
      emit('arp:quickrig-control-changed', { limb: d.limb, mode: 'ik', value: { stretch: d.stretch, reached: d.reached } });
    });
    sub('arpquickrig:advik-blend', function (d) {
      if (!d) return;
      emit('arp:quickrig-control-changed', { limb: d.limb, mode: 'ikfk', value: d.t });
    });
    sub('arpquickrig:advik-pole', function (d) {
      if (!d) return;
      emit('arp:quickrig-control-changed', { limb: (d && d.limb) || null, mode: 'pole', value: clonePlain(d) });
    });
    sub('arpquickrig:map-changed', function (d) {
      if (!d) return;
      emit('arp:quickrig-control-changed', { limb: d.dst, mode: 'remap', value: d.src });
    });
    /* Keyframe clip mới → Animator refresh clip list */
    sub('arpqr3:clip-new', function (d) {
      emit('arp:animator-clip-changed', { clipId: 'keyframe:' + ((d && d.name) || ''), change: 'added', source: 'keyframe' });
    });
    /* Undo/Redo UI nội bộ của History (không qua wrapper) → áp sync. */
    function onHistoryNav(d) {
      if (state.insideWrappedHistoryCall) return; /* wrapper sẽ áp sau */
      var idx = (d && typeof d.index === 'number') ? d.index : -1;
      try {
        if (idx >= 0) applySyncForIndex(idx);
        else {
          var H = getHistory();
          if (H && H._test) applySyncForIndex(H._test.getIndex());
        }
      } catch (e) {}
      emitHistoryChanged();
    }
    sub('arpqr-history:undone', onHistoryNav);
    sub('arpqr-history:redone', onHistoryNav);
    sub('arpqr-history:jumped', onHistoryNav);
    return { ok: true, subscriptions: state.subscriptions };
  }

  /* ============================================================
     INSTALL / UNINSTALL
     ============================================================ */
  function install() {
    var warnings = [];
    var H = getHistory();
    var AN = getAnimator();
    if (!H) warnings.push('Chưa có ArpQuickRig.History (load arp-qr3-history.js trước).');
    if (!AN) warnings.push('Chưa có ArpAnimator (load arp-animator.js trước).');
    var wH = wrapHistory();
    if (!wH.ok && wH.reason !== 'already-wrapped') warnings.push('wrap History: ' + (wH.reason || wH.error || '?'));
    var wHL = wrapHistoryLayers();
    if (!wHL.ok) warnings.push('wrap History layers: ' + (wHL.error || '?'));
    var wA = wrapAnimator();
    if (!wA.ok) warnings.push('wrap Animator: ' + (wA.error || '?'));
    var wQ = wrapQuickRig();
    if (!wQ.ok) warnings.push('wrap QuickRig: ' + (wQ.error || '?'));
    var wP = wrapPose();
    if (!wP.ok) warnings.push('wrap Pose: ' + (wP.error || '?'));
    var sub = subscribeBridges();
    if (!sub.ok) warnings.push('subscribe bridge: ' + (sub.error || '?'));
    state.installed = !!(H && AN);
    return {
      ok: state.installed, installed: state.installed, warnings: warnings,
      historyWrapped: state.historyWrapped,
      historyLayersWrapped: (wHL && wHL.wrapped) || 0,
      wrappedAnimator: state.wrappedAnimator.slice(),
      wrappedQuickRig: state.wrappedQuickRig.slice(),
      wrappedPose: state.wrappedPose.slice(),
      subscriptions: state.subscriptions
    };
  }

  function uninstall() {
    var QR = getQR();
    var AN = getAnimator();
    var P = getPose();
    Object.keys(_orig).forEach(function (key) {
      var parts = key.split('.');
      var target = null;
      if (parts[0] === 'Animator') target = AN;
      else if (parts[0] === 'QuickRig') target = QR;
      else if (parts[0] === 'Pose') target = P;
      else if (parts[0] === 'History') target = getHistory();
      if (target && parts[1]) target[parts[1]] = _orig[key];
    });
    state.installed = false;
    state.historyWrapped = false;
    state.wrappedAnimator = [];
    state.wrappedQuickRig = [];
    state.wrappedPose = [];
    return { ok: true };
  }

  var Sync = {
    install: install,
    uninstall: uninstall,
    emit: emit,
    on: on,
    getHistory: getHistory,
    getAnimator: getAnimator,
    getStatus: historyStatus,
    snapshotAnimator: snapshotAnimator,
    applyAnimatorState: applyAnimatorState,
    applySyncForIndex: applySyncForIndex,
    pushAnimatorAction: pushAnimatorAction,
    recordMutator: recordMutator,
    recordLayerChange: recordLayerChange,
    setAdditive: setAdditive,
    notifyPoseApplied: notifyPoseApplied,
    emitHistoryChanged: emitHistoryChanged,
    _test: {
      clonePlain: clonePlain,
      getStack: function () {
        var H = getHistory();
        return (H && H._test && typeof H._test.getStack === 'function') ? H._test.getStack() : null;
      },
      getState: function () { return state; },
      opForAnimatorFn: opForAnimatorFn
    }
  };

  PS.ArpSyncHistory = Sync;

  /* Tự install lúc load (đúng thứ tự script); nếu thiếu dep, coordinator
     gọi lại install() sau khi load đủ module. */
  try { install(); } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[ArpSyncHistory] auto-install lỗi: ' + ((e && e.message) || e));
    }
  }
})();
