/* ============================================================
 * rig/arp-sync-viewport.js — ĐỒNG BỘ 4/4 (Auto Rig Pro Blend):
 * VIEWPORT ĐỒNG BỘ khi Animator phát clip.
 *
 * File MỚI DUY NHẤT của vòng này. CHỈ ĐỌC các module khác, KHÔNG
 * sửa: arp-animator.js, arp-qr3-gizmo.js, arp-vp-*.js,
 * arp-qr3-keyframe.js, arp-quickrig.js, arp-panel.js.
 *
 * Namespace: window.PixiStudio.ArpSyncViewport
 *
 * 1. GIZMO / CONTROL QUICK RIG KHI PHÁT CLIP
 *    Animator KHÔNG có event bus riêng cho play/stop/tick — module
 *    này wrap (mỏng, try/catch, giữ nguyên giá trị trả về) các hàm
 *    ArpAnimator.play / stop / pause / resume / tick, và có poll()
 *    để host rAF tự gọi (bắt cả trường hợp bấm Play trong tab —
 *    tab gọi hàm play() nội bộ, không qua ArpAnimator.play).
 *    Khi đang kéo 1 control (Gizmo._test.state.drag — TransformControls
 *    'dragging-changed' và fallback raycast-drag đều đi qua
 *    beginDragSnapshot nên cờ này đúng cho cả 2 đường kéo), sau mỗi
 *    Animator.tick (mixer đã viết lại pose clip) module gọi lại
 *    Gizmo.applyControlChange(dst, kind) để áp lại pose tay user
 *    đang kéo — cùng frame, clip không ghi đè được chi đang kéo.
 *    Khi thả (dragend → state.drag = null) thì thôi áp lại: clip
 *    tiếp quản chi đó từ frame sau.
 *
 * 2. OVERLAYS THEO CLIP — refreshOverlaysForTime(t, dt)
 *    Gọi API THẬT của từng module vp (feature-detect, thiếu module
 *    nào thì bỏ qua êm + ghi vào summary.missing):
 *      skeleton: ArpVpSkeleton.show(target) nếu layer đang bật
 *        (mesh xương gắn vào xương nên tự theo pose; ở đây chỉ
 *        bảo đảm đã build + updateMatrixWorld).
 *      ik:       ArpVpIk.update(dt) nếu layer đang bật.
 *      trails:   ArpVpTrails.update(dt) — Trails tự detectPlayback;
 *        module này notePlay() cho Trails biết nguồn 'animator'
 *        (clip THREE + getTime) vì detectPlayback chưa biết Animator.
 *      onion:    nằm trong Trails.update (sampleClipPoseAt tại
 *        t ∓ offset); clip keyframe thì Trails dùng KF._test.poseAt /
 *        snapshotJoints, module này gọi thêm KF.renderGhost cho key
 *        gần nhất khi key đổi.
 *      labels:   ArpVpLabels.update(dt) nếu có.
 *      readout:  overlay #arp-anim-readout trong viewport (frame +
 *        thời gian) — Animator KHÔNG expose updateReadout nên module
 *        này tự vẽ từ getFrameInfo() (public), cùng vị trí/format.
 *
 * 3. PRESET TỰ THEO ANIMATOR
 *    Khi bắt đầu phát: nếu preset hiện tại là "Rigging" hoặc "Clean"
 *    thì tự áp preset "Animation". Khi dừng phát: GIỮ NGUYÊN preset,
 *    không tự đổi về. Xác định preset hiện tại bằng
 *    Presets.getActive() sau refreshActive(); nếu getActive() ra
 *    'Custom'/null (vd layer markers/ghost chưa đăng ký nên snapshot
 *    không khớp hẳn preset gốc) thì so tolerant: các layer ĐÃ ĐĂNG KÝ
 *    trong map preset phải khớp, layer chưa đăng ký thì bỏ qua.
 *    FIX (vòng 1): preset Animation tắt labels (map labels:false) nên
 *    sau khi áp phải KHÔI PHỤC skeleton/labels nếu chúng đang hiện
 *    trước đó (gọi trực tiếp module, xem maybeSwitchPresetToAnimation)
 *    — bấm Play không được làm xương/nhãn biến mất.
 *
 * THỨ TỰ LOAD (coordinator append script tag — KHÔNG sửa index.html
 * ở đây): sau arp-animator.js, arp-qr3-gizmo.js, arp-vp-*.js,
 * arp-qr3-keyframe.js; rồi gọi PixiStudio.ArpSyncViewport.init()
 * (init tự wrap lại nếu Animator load sau — gọi init() lần nữa
 * cũng an toàn, wrap chỉ làm 1 lần).
 *
 * GIỚI HẠN TRUNG THỰC:
 *  - "Đang kéo" chỉ áp cho đúng chi đang kéo (dst trong
 *    state.drag); các chi khác vẫn theo clip bình thường.
 *  - Trails là đường 1px như vòng Viewport (LineSegments); onion
 *    ghost chỉ 17 quả cầu khớp (GHOST_JOINTS của vp-trails /
 *    qr3-keyframe); skeleton là mesh gắn xương (tự theo pose).
 *  - Clip thật Thiếu Lâm / Punch KHÔNG có track LeftHand/RightHand
 *    (chỉ 16 track) — tay chỉ di chuyển qua xương cha; test kéo
 *    dùng RightArm (có track trong clip) mới kiểm được "không bị
 *    clip ghi đè" thật.
 *  - Trails.detectPlayback ưu tiên LiveRetarget / Keyframe / Anim
 *    (mixer studio) / autogen TRƯỚC hint 'animator': nếu 1 nguồn
 *    khác đang phát cùng lúc thì trails/onion theo nguồn đó, không
 *    theo Animator.
 *  - Khi tạm dừng (pause): trails/onion đóng băng (không sample
 *    thêm), chỉ readout + skeleton matrix vẫn cập nhật.
 *  - Kéo Hips trong lúc rootMotion đang khóa: restore sau tick thắng
 *    khóa root trong frame đó, nhưng mỗi tick khóa root lại áp —
 *    Hips vẫn giữ pose kéo nhờ restore, song đường root có thể
 *    lệch khỏi clip trong lúc kéo.
 * ============================================================ */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined' && window.PixiStudio) || {};
  var bus = (PS && PS.bus) || { emit: function () {}, on: function () {} };

  var state = {
    initialized: false,
    wrapped: false,
    playing: false,       /* Animator.playing lần cuối module thấy */
    paused: false,
    tickCount: 0,
    lastPresetFrom: null, /* preset trước lần tự đổi gần nhất */
    lastAutoSwitch: null, /* {from, to, clipId, at} */
    lastAppliedPreset: null, /* {name, skipped:[key], at} — preset áp gần nhất (bus arp:vp-preset-applied) */
    _presetTrackingBound: false,
    _layerListenerBound: false,
    presetSwitches: 0,
    dragHeld: null,       /* {dst, kind, frames, lastApply} */
    lastRefresh: null,
    lastGhostKeyIndex: null,
    missing: [],
    lastError: null
  };

  /* ---------------- helpers ---------------- */

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round3(v) { return Math.round(v * 1000) / 1000; }
  function round4(v) { return Math.round(v * 10000) / 10000; }

  function emit(ev, data) {
    try { if (bus && typeof bus.emit === 'function') bus.emit(ev, data); } catch (e) {}
  }
  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message }); } catch (e) {}
  }
  function stripName(name) {
    return String(name == null ? '' : name).replace(/^mixamorig:?/i, '');
  }

  function getAnimator() { return (PS && PS.ArpAnimator) || null; }
  function getGizmo() {
    var QR = (PS && PS.ArpQuickRig) || null;
    return (QR && QR.Gizmo) || null;
  }
  function getQR() { return (PS && PS.ArpQuickRig) || null; }
  function getKeyframe() {
    var QR = getQR();
    return (QR && QR.Keyframe) || null;
  }
  function getTrails() { return (PS && PS.ArpVpTrails) || null; }
  function getSkeleton() { return (PS && PS.ArpVpSkeleton) || null; }
  function getIk() { return (PS && PS.ArpVpIk) || null; }
  function getLabels() { return (PS && PS.ArpVpLabels) || null; }
  function getPresets() { return (PS && PS.ArpVpPresets) || null; }
  function getRegistry() { return (PS && PS.ArpViewport) || null; }

  function layerVisible(key) {
    var reg = getRegistry();
    if (reg && typeof reg.isLayerVisible === 'function') {
      try {
        var r = reg.isLayerVisible(key);
        if (r !== null && r !== undefined) return !!r;
      } catch (e) {}
    }
    return null; /* không biết — caller tự quyết bằng API module */
  }

  function getTarget() {
    var AN = getAnimator();
    if (AN) {
      try {
        if (AN._target) return AN._target;
      } catch (e) {}
    }
    /* FIX (vòng 1): trước đây bám getMainModel() ngay sau Animator —
       model mẫu thắng. Ưu tiên selection / model hiện tại trước. */
    try {
      if (PS.State && typeof PS.State.get === 'function') {
        var sel = PS.State.get('selection');
        if (sel) return sel;
      }
    } catch (e) {}
    try {
      if (PS.Models && typeof PS.Models.getCurrent === 'function') {
        var cur = PS.Models.getCurrent();
        if (cur && cur.object3D) return cur.object3D;
      }
    } catch (e) {}
    if (PS.Viewport && typeof PS.Viewport.getMainModel === 'function') {
      try { return PS.Viewport.getMainModel(); } catch (e) { return null; }
    }
    var QR = getQR();
    if (QR && QR.current && QR.current.target) return QR.current.target;
    return null;
  }

  function currentClipEntry() {
    var AN = getAnimator();
    if (!AN || !AN.currentId || typeof AN.getClip !== 'function') return null;
    try { return AN.getClip(AN.currentId) || null; } catch (e) { return null; }
  }

  /* ---------------- 1. Gizmo / control khi đang kéo ---------------- */

  /* Chi đang kéo (nếu có): {dst, isPole} hoặc null. Đọc từ
   * Gizmo._test.state.drag — cả TransformControls lẫn fallback
   * raycast-drag đều set qua beginDragSnapshot. */
  function getDragInfo() {
    var G = getGizmo();
    if (!G || !G._test || !G._test.state) return null;
    var drag = G._test.state.drag;
    if (!drag || !drag.dst) return null;
    return { dst: drag.dst, isPole: !!drag.isPole };
  }

  /* Áp lại pose tay user đang kéo sau khi mixer viết đè pose clip.
   * Dùng đúng đường áp của Gizmo (đọc rotation/position hiện tại của
   * control object) nên FK, translate lẫn IK end đều được xử lý lại
   * (IK solve chạy lại từ control). Trả {ok, dst, kind} hoặc lý do. */
  function reapplyDraggedControl() {
    var info = getDragInfo();
    if (!info) { state.dragHeld = null; return { ok: false, reason: 'not-dragging' }; }
    var G = getGizmo();
    if (!G || typeof G.applyControlChange !== 'function') {
      return { ok: false, reason: 'gizmo-apply-missing', dst: info.dst };
    }
    var mode = 'translate';
    try { if (typeof G.getMode === 'function') mode = G.getMode() || 'translate'; } catch (e) {}
    var kind = (mode === 'rotate') ? 'rotate' : 'translate';
    var r = null;
    try { r = G.applyControlChange(info.dst, kind); } catch (e) {
      return { ok: false, reason: 'apply-threw', dst: info.dst, error: e && e.message };
    }
    if (r && r.ok === false) {
      return { ok: false, reason: 'apply-failed', dst: info.dst, error: r.error || '' };
    }
    var held = state.dragHeld && state.dragHeld.dst === info.dst ? state.dragHeld : { dst: info.dst, kind: kind, frames: 0 };
    held.frames++;
    held.kind = kind;
    held.lastApply = r || { ok: true };
    state.dragHeld = held;
    return { ok: true, dst: info.dst, kind: kind, frames: held.frames };
  }

  /* Gizmo + control helpers vẫn hiện khi phát: nếu có control đang
   * gắn (attached) thì bảo đảm nhóm của nó đang hiện và (đường
   * TransformControls) gizmo còn nằm trong scene; thiếu thì gắn lại.
   * Không động vào các nhóm khác (tôn trọng toggle tay của user). */
  function ensureGizmoVisible() {
    var G = getGizmo();
    if (!G || typeof G.getState !== 'function') return { ok: false, reason: 'gizmo-missing' };
    var st = null;
    try { st = G.getState(); } catch (e) { return { ok: false, reason: 'gizmo-state-error' }; }
    if (!st || !st.attached) return { ok: true, attached: null, note: 'Không có control đang gắn — không có gì để giữ.' };
    var out = { ok: true, attached: st.attached, kind: st.gizmoKind || null, groupShown: null, reattached: false };
    /* Nhóm chứa control đang gắn phải hiện. */
    try {
      if (typeof G.groupOf === 'function' && typeof G.getGroupVisible === 'function' && typeof G.setGroupVisible === 'function') {
        var grp = G.groupOf(st.attached);
        if (grp && G.getGroupVisible(grp) === false) {
          G.setGroupVisible(grp, true);
          out.groupShown = grp;
        }
      }
    } catch (e) { out.groupError = e && e.message; }
    /* TransformControls bị gỡ khỏi scene (vd module khác dọn) → gắn lại. */
    try {
      var tst = (G._test && G._test.state) || null;
      if (tst && tst.gizmo) {
        var inScene = !!(tst.gizmo.parent);
        if (!inScene && typeof G.attachGizmo === 'function') {
          var r = G.attachGizmo(st.attached, st.mode);
          out.reattached = !!(r && r.ok);
        }
      }
    } catch (e) { out.reattachError = e && e.message; }
    return out;
  }

  /* ---------------- 3. Preset tự theo Animator ---------------- */

  /* Preset hiện tại: ưu tiên getActive() sau refreshActive(); nếu ra
   * 'Custom'/null thì so tolerant theo snapshot (layer chưa đăng ký
   * thì bỏ qua, không coi là lệch). Trả tên preset hoặc null. */
  /* Preset hiện tại: ưu tiên getActive() TRƯỚC (apply() đã set
   * _active đúng; refreshActive() tính lại từ snapshot có thể ra
   * 'Custom' oan khi 1 layer không show được — vd markers chưa có
   * marker nào, grid chưa có GridEnv — đó là hành vi có sẵn của
   * presets/toolbar, không phải lỗi của module này). Chỉ khi
   * getActive() ra 'Custom'/null mới refreshActive + so tolerant
   * theo snapshot (layer chưa đăng ký thì bỏ qua). */
  /* FIX (vòng 1): presets.apply() từ FIX2 (nhóm 2) chỉ set active =
   * tên preset khi KHÔNG layer nào skip; còn layer nào skip (vd
   * markers chưa có marker nào để hiện, ghost chưa build) thì active
   * tính lại = 'Custom' — dù user vừa áp Rigging. Nếu chỉ tin
   * getActive()/snapshot, detectCurrentPreset() sẽ trả null và tính
   * năng tự chuyển preset khi phát sẽ CHẾT hẳn mỗi khi có layer
   * optional chưa show được. Vì thế module còn nhớ preset ÁP GẦN
   * NHẤT (bus 'arp:vp-preset-applied' kèm danh sách skipped) và khi
   * so tolerant thì BỎ QUA đúng các layer đã skip ở lần áp đó: preset
   * đã áp vẫn là mode xem hiện tại của user. Layer nào user đổi tay
   * sau đó (registry onLayerChange ngoài lần apply) sẽ xóa trí nhớ
   * này — xem _bindPresetTracking(). */
  function detectCurrentPreset() {
    var P = getPresets();
    if (!P) return null;
    _bindPresetTracking(); /* registry có thể xuất hiện sau init() */
    try {
      if (typeof P.getActive === 'function') {
        var active = P.getActive();
        if (active && active !== 'Custom') return active;
      }
    } catch (e) {}
    try {
      if (typeof P.refreshActive === 'function') P.refreshActive();
      if (typeof P.getActive === 'function') {
        var active2 = P.getActive();
        if (active2 && active2 !== 'Custom') return active2;
      }
    } catch (e) {}
    /* Tolerant: khớp preset nào theo các layer đã đăng ký thì là preset đó. */
    try {
      if (typeof P.getPreset === 'function' && typeof P.snapshot === 'function') {
        var snap = P.snapshot() || {};
        var names = ['Rigging', 'Animation', 'Clean', 'Full'];
        var lap = state.lastAppliedPreset;
        for (var i = 0; i < names.length; i++) {
          var map = P.getPreset(names[i]);
          if (!map) continue;
          var keys = Object.keys(map);
          var checked = 0, matched = true;
          for (var k = 0; k < keys.length; k++) {
            var cur = snap[keys[k]];
            if (cur === null || cur === undefined) continue; /* layer chưa đăng ký: bỏ qua */
            /* Layer đã skip ở lần áp preset này (không show được vì
               chưa có gì để hiện) thì không tính là lệch. */
            if (lap && lap.name === names[i] && lap.skipped && lap.skipped.indexOf(keys[k]) >= 0) continue;
            checked++;
            if (!!cur !== !!map[keys[k]]) { matched = false; break; }
          }
          if (matched && checked > 0) return names[i];
        }
      }
    } catch (e) {}
    return null;
  }

  /* Nhớ preset áp gần nhất + xóa trí nhớ khi user đổi layer tay.
   * Thứ tự sự kiện trong 1 lần apply(): các layer-changed phát TRƯỚC,
   * 'arp:vp-preset-applied' phát SAU — nên listener layer-changed
   * xóa trí nhớ cũ rồi preset-applied ghi trí nhớ mới; đổi layer tay
   * (toolbar gọi registry trực tiếp, không qua apply) chỉ phát
   * layer-changed nên xóa trí nhớ đúng như ý. */
  function _bindPresetTracking() {
    try {
      if (bus && typeof bus.on === 'function' && !state._presetTrackingBound) {
        bus.on('arp:vp-preset-applied', function (d) {
          try {
            if (!d || !d.name) return;
            var sk = [];
            (d.skipped || []).forEach(function (s) { sk.push(typeof s === 'string' ? s : s.key); });
            state.lastAppliedPreset = { name: d.name, skipped: sk, at: (new Date()).toISOString() };
          } catch (e) {}
        });
        state._presetTrackingBound = true;
      }
    } catch (e) {}
    try {
      var reg = getRegistry();
      if (reg && typeof reg.onLayerChange === 'function' && !state._layerListenerBound) {
        reg.onLayerChange(function () { state.lastAppliedPreset = null; });
        state._layerListenerBound = true;
      }
    } catch (e) {}
  }

  function maybeSwitchPresetToAnimation() {
    var P = getPresets();
    if (!P || typeof P.apply !== 'function') {
      return { ok: false, reason: 'no-presets' };
    }
    var cur = detectCurrentPreset();
    if (cur !== 'Rigging' && cur !== 'Clean') {
      return { ok: false, reason: 'preset-kept', current: cur };
    }
    /* FIX (ARP View vòng 1): preset Animation có map labels:false
       (markers:false) và KHÔNG có skeleton — áp preset này khi user
       bấm Play sẽ TẮT nhãn ngay lúc phát (đúng lỗi "bấm Play thì
       skeleton/labels biến mất"). Ghi lại trạng thái skeleton/labels
       TRƯỚC khi áp, rồi khôi phục lại sau khi áp bằng gọi TRỰC TIẾP
       module (không qua registry — qua registry sẽ kích
       onLayerChange → presets.refreshActive() → active nhảy sang
       'Custom' ngay, trong khi preset vừa áp vẫn là Animation; gọi
       trực tiếp thì preset hiển thị giữ 'Animation' cho tới lần
       refresh sau, và toolbar vẫn đồng bộ vì isLayerVisible đọc từ
       module). Sửa đúng trong presets.js (thêm skeleton/labels vào
       map Animation) thuộc nhóm 2 — không sửa ở đây. */
    var skBefore = null, lbBefore = null;
    try {
      var Sk0 = getSkeleton();
      if (Sk0 && typeof Sk0.isVisible === 'function') skBefore = !!Sk0.isVisible();
    } catch (e) {}
    try {
      var Lb0 = getLabels();
      if (Lb0 && typeof Lb0.isVisible === 'function') lbBefore = !!Lb0.isVisible();
    } catch (e) {}
    var r = null;
    try { r = P.apply('Animation', { source: 'animator-play' }); } catch (e) {
      return { ok: false, reason: 'apply-threw', from: cur, error: e && e.message };
    }
    if (!r || r.ok === false) {
      return { ok: false, reason: 'apply-failed', from: cur, detail: r };
    }
    var restored = { skeleton: null, labels: null };
    if (skBefore) {
      try {
        var Sk = getSkeleton();
        var tgt = getTarget();
        if (Sk && typeof Sk.show === 'function') {
          var rs = Sk.show(tgt);
          restored.skeleton = !!(rs && rs.ok);
        }
      } catch (e) { restored.skeleton = false; }
    }
    if (lbBefore) {
      try {
        var Lb = getLabels();
        var tgt2 = getTarget();
        if (Lb && typeof Lb.show === 'function') {
          var rl = Lb.show(tgt2);
          restored.labels = !!(rl && rl.ok);
        }
      } catch (e) { restored.labels = false; }
    }
    state.lastPresetFrom = cur;
    state.lastAutoSwitch = { from: cur, to: 'Animation', clipId: null, at: (new Date()).toISOString(), restored: restored };
    try {
      var AN = getAnimator();
      if (AN && AN.currentId) state.lastAutoSwitch.clipId = AN.currentId;
    } catch (e) {}
    state.presetSwitches++;
    return { ok: true, from: cur, to: 'Animation', applied: r.applied || {}, skipped: r.skipped || [], restored: restored };
  }

  /* ---------------- 2. Trails: báo nguồn 'animator' ---------------- */

  function notePlayToTrails() {
    var Tr = getTrails();
    if (!Tr || typeof Tr.notePlay !== 'function') return { ok: false, reason: 'trails-missing' };
    var entry = currentClipEntry();
    if (!entry) return { ok: false, reason: 'no-clip' };
    /* Clip THREE (anim/preset/coco/hy3d): Trails.sampleClipPoseAt cần
     * clip thật + getTime. Keyframe/autogen: Trails.detectPlayback
     * đã tự nhận ra KF / AnimAutoGen nên không cần hint (hint cũng
     * không đè được vì detectPlayback kiểm tra KF trước). */
    if (!entry.clip || !entry.clip.tracks) {
      return { ok: false, reason: 'no-three-clip', source: entry.source || '' };
    }
    var AN = getAnimator();
    var r = null;
    try {
      r = Tr.notePlay({
        clip: entry.clip,
        clipName: entry.name || entry.id,
        getTime: function () { return AN ? (AN.time || 0) : 0; },
        duration: entry.duration || 0,
        source: 'animator',
        kind: 'three'
      });
    } catch (e) { return { ok: false, reason: 'notePlay-threw', error: e && e.message }; }
    return { ok: true, clip: entry.name || entry.id, source: 'animator' };
  }

  function noteStopToTrails() {
    var Tr = getTrails();
    if (!Tr || typeof Tr.noteStop !== 'function') return { ok: false, reason: 'trails-missing' };
    try { Tr.noteStop(); } catch (e) { return { ok: false, reason: 'noteStop-threw', error: e && e.message }; }
    return { ok: true };
  }

  /* ---------------- 2. refreshOverlaysForTime ---------------- */

  function refreshOverlaysForTime(t, dt) {
    var AN = getAnimator();
    var time = (typeof t === 'number' && isFinite(t)) ? t : (AN ? (AN.time || 0) : 0);
    dt = (typeof dt === 'number' && isFinite(dt) && dt > 0) ? dt : (1 / 60);
    var paused = !!(AN && AN.paused);
    var playing = !!(AN && AN.playing);
    var missing = [];
    var out = {
      ok: true, time: round3(time), playing: playing, paused: paused,
      skeleton: null, ik: null, trails: null, onion: null,
      keyframeGhost: null, labels: null, readout: null, missing: missing
    };

    var target = null;
    try { target = getTarget(); } catch (e) {}
    if (target && target.updateMatrixWorld) {
      try { target.updateMatrixWorld(true); } catch (e) {}
    }

    /* --- skeleton: mesh gắn vào xương nên tự theo pose; chỉ bảo đảm
     * đã build/hiện khi layer đang bật. --- */
    var Sk = getSkeleton();
    if (!Sk) missing.push('ArpVpSkeleton chưa load');
    else {
      var skVisible = layerVisible('skeleton');
      if (skVisible === false) {
        out.skeleton = { ok: true, visible: false, note: 'Layer skeleton đang tắt — không ép hiện.' };
      } else {
        var skShown = null;
        try {
          if (typeof Sk.isVisible === 'function' && Sk.isVisible()) skShown = { ok: true, alreadyVisible: true };
          else if (typeof Sk.show === 'function') skShown = Sk.show(target);
        } catch (e) { skShown = { ok: false, error: e && e.message }; }
        var boneCount = null;
        /* FIX (vòng 1): skeleton expose getStatus(), KHÔNG có getState()
           (nay đã thêm alias getState = getStatus trong skeleton.js) —
           đọc getStatus() trước, fallback getState() để boneCount không
           còn null. */
        try {
          if (Sk.getStatus) { var sst = Sk.getStatus(); boneCount = (sst && sst.boneCount) || null; }
          else if (Sk.getState) { var sst2 = Sk.getState(); boneCount = (sst2 && (sst2.boneCount || (sst2.bones && sst2.bones.length))) || null; }
        } catch (e) {}
        out.skeleton = { ok: !!(skShown && skShown.ok !== false), visible: true, boneCount: boneCount, detail: skShown };
        if (!out.skeleton.ok) missing.push('ArpVpSkeleton.show lỗi');
      }
    }

    /* --- IK overlay: cập nhật theo IK state hiện tại. --- */
    var Ik = getIk();
    if (!Ik) missing.push('ArpVpIk chưa load');
    else {
      var ikVisible = layerVisible('ik');
      if (ikVisible === false) {
        out.ik = { ok: true, visible: false, note: 'Layer IK đang tắt — không ép hiện.' };
      } else {
        var ikRes = null;
        try {
          if (typeof Ik.update === 'function') ikRes = Ik.update(dt);
          else if (typeof Ik.show === 'function') ikRes = Ik.show();
        } catch (e) { ikRes = { ok: false, error: e && e.message }; }
        out.ik = { ok: !!(ikRes && ikRes.ok !== false), detail: ikRes };
        if (!out.ik.ok) missing.push('ArpVpIk.update lỗi');
      }
    }

    /* --- trails + onion (vp-trails): chỉ sample khi đang phát và
     * không tạm dừng; tạm dừng thì đóng băng vệt + ghost. --- */
    var Tr = getTrails();
    if (!Tr) missing.push('ArpVpTrails chưa load');
    else if (!playing || paused) {
      out.trails = { ok: true, skipped: true, reason: paused ? 'paused' : 'not-playing' };
      out.onion = { ok: true, skipped: true, reason: paused ? 'paused' : 'not-playing' };
    } else {
      var trRes = null;
      try {
        if (typeof Tr.update === 'function') trRes = Tr.update(dt);
        else if (typeof Tr.sampleNow === 'function') trRes = Tr.sampleNow();
      } catch (e) { trRes = { ok: false, error: e && e.message }; }
      if (trRes && trRes.ok !== false) {
        out.trails = { ok: true, counts: trRes.trailCounts || null, sampled: !!trRes.trailSampled, source: trRes.source || null, time: (trRes.time !== undefined ? round3(trRes.time) : null) };
        out.onion = { ok: true, prev: !!(trRes.onion && trRes.onion.prev), next: !!(trRes.onion && trRes.onion.next), cached: !!(trRes.onion && trRes.onion.cached) };
      } else {
        out.trails = { ok: false, detail: trRes };
        out.onion = { ok: false, detail: trRes };
        missing.push('ArpVpTrails.update lỗi: ' + ((trRes && trRes.error) || (trRes && trRes.trailError) || 'không rõ'));
      }
    }

    /* --- onion keyframe: ghost QR3-keyframe cho clip keyframe. Chỉ
     * render lại khi key gần nhất đổi (renderGhost tự hide + dựng
     * lại nên gọi mỗi frame sẽ tốn). --- */
    var entry = currentClipEntry();
    if (entry && entry.source === 'keyframe') {
      var KF = getKeyframe();
      if (!KF || typeof KF.renderGhost !== 'function') {
        missing.push('Keyframe.renderGhost chưa có (onion keyframe)');
        out.keyframeGhost = { ok: false, reason: 'keyframe-missing' };
      } else {
        var keys = entry.keys || (KF.clip && KF.clip.keys) || [];
        var idx = -1;
        for (var i = 0; i < keys.length; i++) {
          if (keys[i] && typeof keys[i].t === 'number' && keys[i].t <= time + 1e-6) idx = i;
        }
        if (idx < 0 && keys.length) idx = 0;
        if (idx >= 0 && idx !== state.lastGhostKeyIndex) {
          var g = null;
          try { g = KF.renderGhost(idx, { which: 'both' }); } catch (e) { g = { ok: false, error: e && e.message }; }
          state.lastGhostKeyIndex = idx;
          out.keyframeGhost = { ok: !!(g && g.ok !== false), keyIndex: idx, made: (g && g.made) || 0, detail: g };
        } else {
          out.keyframeGhost = { ok: true, cached: true, keyIndex: idx };
        }
      }
    } else {
      state.lastGhostKeyIndex = null;
      out.keyframeGhost = { ok: true, skipped: true, reason: entry ? ('clip nguồn ' + (entry.source || '?') + ' — onion do vp-trails') : 'no-clip' };
    }

    /* --- labels: sprite tên xương (nếu module có update). --- */
    var Lb = getLabels();
    if (!Lb) missing.push('ArpVpLabels chưa load');
    else if (typeof Lb.update === 'function') {
      try { Lb.update(dt); out.labels = { ok: true }; }
      catch (e) { out.labels = { ok: false, error: e && e.message }; }
    } else {
      out.labels = { ok: true, skipped: true, reason: 'không có update(dt)' };
    }

    /* --- frame readout trong viewport (frame + thời gian).
     * LƯU Ý: ArpAnimator.updateReadout KHÔNG expose ra public API
     * (chỉ dùng nội bộ trong animator) nên module này tự vẽ overlay
     * #arp-anim-readout từ getFrameInfo() (public) — cùng vị trí
     * (#viewport-canvas-wrap) và cùng format text của Animator. --- */
    if (AN && typeof AN.getFrameInfo === 'function') {
      try {
        var fi = AN.getFrameInfo();
        var text = fi.text || '';
        try {
          var top = '';
          if (AN.display && AN.display.boneAngles && AN.topBones && AN.topBones.length) {
            top = AN.topBones.map(function (b) { return b.bone + ' ' + (b.deg || 0).toFixed(1) + '°'; }).join(' · ');
          }
          if (top) text += ' · ' + top;
        } catch (e2) {}
        if (typeof document !== 'undefined') {
          try {
            var wrap = document.getElementById('viewport-canvas-wrap') || document.getElementById('viewport-wrap');
            var ov = document.getElementById('arp-anim-readout');
            var showReadout = !AN.display || AN.display.readout !== false;
            if (showReadout) {
              if (!ov && wrap) {
                ov = document.createElement('div');
                ov.id = 'arp-anim-readout';
                ov.className = 'arp-anim-readout';
                wrap.appendChild(ov);
              }
              if (ov) ov.textContent = (AN.currentId ? '▶ ' : '') + text;
            } else if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
            var panelSpan = document.getElementById('arp-anim-readout-line');
            if (panelSpan) panelSpan.textContent = text;
          } catch (e2) {}
        }
        out.readout = { ok: true, text: text, frame: fi.frame, totalFrames: fi.totalFrames };
      } catch (e) { out.readout = { ok: false, error: e && e.message }; }
    } else {
      missing.push('ArpAnimator.getFrameInfo chưa có');
      out.readout = { ok: false, reason: 'animator-missing' };
    }

    out.missing = missing;
    state.missing = missing.slice();
    state.lastRefresh = out;
    return out;
  }

  /* ---------------- play/stop/pause hooks ---------------- */

  function onPlayStart() {
    state.playing = true;
    state.paused = false;
    var preset = maybeSwitchPresetToAnimation();
    var trails = notePlayToTrails();
    var gizmo = ensureGizmoVisible();
    var AN = getAnimator();
    var info = {
      clipId: AN ? AN.currentId : null,
      clipName: null,
      preset: preset, trails: trails, gizmo: gizmo
    };
    try {
      var e = currentClipEntry();
      if (e) info.clipName = e.name || e.id;
    } catch (err) {}
    emit('arp:sync-viewport:play', info);
    return info;
  }

  function onPlayStop() {
    state.playing = false;
    state.paused = false;
    state.dragHeld = null;
    var trails = noteStopToTrails();
    var P = getPresets();
    var kept = null;
    try { if (P && typeof P.getActive === 'function') kept = P.getActive(); } catch (e) {}
    if (!kept) kept = detectCurrentPreset();
    var info = { presetKept: kept, trails: trails };
    emit('arp:sync-viewport:stop', info);
    return info;
  }

  function onPauseChange(paused) {
    state.paused = !!paused;
    emit('arp:sync-viewport:pause', { paused: state.paused });
    return { ok: true, paused: state.paused };
  }

  /* Bắt transition playing mà wrapper play() bỏ lỡ (vd bấm Play
   * trong tab Animator — tab gọi hàm play() nội bộ). */
  function pollPlaying() {
    var AN = getAnimator();
    if (!AN) return { ok: false, reason: 'no-animator' };
    var now = !!AN.playing;
    if (now && !state.playing) return onPlayStart();
    if (!now && state.playing) return onPlayStop();
    if (AN.paused !== state.paused && now) onPauseChange(!!AN.paused);
    return { ok: true, playing: state.playing, changed: false };
  }

  /* Chạy sau mỗi Animator.tick: giữ pose chi đang kéo + refresh overlays. */
  function afterTick(dt, tickResult) {
    state.tickCount++;
    var held = reapplyDraggedControl();
    var AN = getAnimator();
    var time = AN ? (AN.time || 0) : 0;
    var refreshed = null;
    if (tickResult && tickResult.ok !== false) {
      try { refreshed = refreshOverlaysForTime(time, dt); } catch (e) {
        state.lastError = e && e.message;
        refreshed = { ok: false, error: state.lastError };
      }
    }
    return { dragHeld: held, refreshed: refreshed };
  }

  /* ---------------- wrap Animator (mỏng, idempotent) ---------------- */

  function wrapAnimator() {
    var AN = getAnimator();
    if (!AN) return { ok: false, reason: 'no-animator' };
    /* Đã wrap và wrapper còn nguyên → không làm lại. Nếu có ai thay
     * AN.play/stop/tick bằng hàm gốc (vd test gỡ wrapper) thì wrap
     * lại từ bản gốc đã lưu — wrapper được đánh dấu để nhận ra. */
    if (AN.play && AN.play.__arpSyncViewportWrapped &&
        AN.stop && AN.stop.__arpSyncViewportWrapped &&
        AN.tick && AN.tick.__arpSyncViewportWrapped) {
      state.wrapped = true;
      return { ok: true, alreadyWrapped: true };
    }
    var orig = AN.__arpSyncViewportOrig;
    if (!orig) {
      if (typeof AN.play !== 'function' || typeof AN.stop !== 'function' || typeof AN.tick !== 'function') {
        return { ok: false, reason: 'animator-api-incomplete' };
      }
      orig = {
        play: AN.play, stop: AN.stop, tick: AN.tick,
        pause: (typeof AN.pause === 'function') ? AN.pause : null,
        resume: (typeof AN.resume === 'function') ? AN.resume : null
      };
    }
    AN.play = function (id) {
      var r = orig.play(id);
      try { pollPlaying(); } catch (e) {}
      return r;
    };
    AN.stop = function (opts) {
      var r = orig.stop(opts);
      try { pollPlaying(); } catch (e) {}
      return r;
    };
    if (orig.pause) {
      AN.pause = function () {
        var r = orig.pause();
        try { if (r && r.ok) onPauseChange(true); } catch (e) {}
        return r;
      };
      AN.pause.__arpSyncViewportWrapped = true;
    }
    if (orig.resume) {
      AN.resume = function () {
        var r = orig.resume();
        try { if (r && r.ok) onPauseChange(false); } catch (e) {}
        return r;
      };
      AN.resume.__arpSyncViewportWrapped = true;
    }
    AN.tick = function (dt) {
      /* poll trước: bắt play qua tab (nút Play nội bộ) ngay frame đầu. */
      try { pollPlaying(); } catch (e) {}
      var r = orig.tick(dt);
      /* Sync hooks KHÔNG được làm hỏng phát lại: mọi lỗi đã được
       * chặn trong reapply/refresh; ở đây chỉ chặn thêm 1 lớp. */
      try { afterTick(dt, r); } catch (e) { state.lastError = e && e.message; }
      return r;
    };
    AN.play.__arpSyncViewportWrapped = true;
    AN.stop.__arpSyncViewportWrapped = true;
    AN.tick.__arpSyncViewportWrapped = true;
    AN.__arpSyncViewportOrig = orig;
    AN.__arpSyncViewportWrapped = true;
    state.wrapped = true;
    return { ok: true, wrapped: true };
  }

  /* ---------------- init / public API ---------------- */

  function init() {
    var w = wrapAnimator();
    _bindPresetTracking();
    /* Lắng nghe rig-complete để lần phát sau có target mới vẫn đúng
     * (không làm gì ngay — skeleton/IK tự resolve target mỗi lần). */
    try {
      if (bus && typeof bus.on === 'function' && !state._busBound) {
        bus.on('arp:rig-complete', function () {
          state.lastGhostKeyIndex = null;
          state.dragHeld = null;
        });
        state._busBound = true;
      }
    } catch (e) {}
    state.initialized = true;
    return { ok: true, wrap: w };
  }

  function getState() {
    return {
      initialized: state.initialized,
      wrapped: state.wrapped,
      playing: state.playing,
      paused: state.paused,
      tickCount: state.tickCount,
      presetSwitches: state.presetSwitches,
      lastPresetFrom: state.lastPresetFrom,
      lastAutoSwitch: state.lastAutoSwitch,
      lastAppliedPreset: state.lastAppliedPreset,
      dragHeld: state.dragHeld,
      lastRefresh: state.lastRefresh,
      lastGhostKeyIndex: state.lastGhostKeyIndex,
      missing: state.missing.slice(),
      lastError: state.lastError
    };
  }

  var ArpSyncViewport = {
    init: init,
    wrapAnimator: wrapAnimator,
    poll: pollPlaying,
    refreshOverlaysForTime: refreshOverlaysForTime,
    reapplyDraggedControl: reapplyDraggedControl,
    getDragInfo: getDragInfo,
    ensureGizmoVisible: ensureGizmoVisible,
    maybeSwitchPresetToAnimation: maybeSwitchPresetToAnimation,
    detectCurrentPreset: detectCurrentPreset,
    notePlayToTrails: notePlayToTrails,
    noteStopToTrails: noteStopToTrails,
    onPlayStart: onPlayStart,
    onPlayStop: onPlayStop,
    getState: getState,
    _test: {
      state: state,
      getAnimator: getAnimator,
      getGizmo: getGizmo,
      getTrails: getTrails,
      getPresets: getPresets,
      afterTick: afterTick,
      pollPlaying: pollPlaying,
      stripName: stripName
    }
  };

  PS.ArpSyncViewport = ArpSyncViewport;
  if (typeof module !== 'undefined' && module.exports) module.exports = ArpSyncViewport;

  /* Tự init khi load (Animator thường load trước file này theo thứ tự
   * script tag). Nếu Animator chưa có thì init() lần nữa sau — an toàn. */
  try { init(); } catch (e) { state.lastError = e && e.message; }
})();
