/* ============================================================
 * rig/arp-qr3-history.js — UNDO/REDO + CONTROL LAYERS
 * (Auto Rig Pro Blend, PHẦN 7 — vòng mở rộng thứ 3 của Quick Rig)
 *
 * Lịch sử pose cho control rig (window.PixiStudio.ArpQuickRig):
 *   • pushState(label) / undo() / redo() / jumpTo(i) — snapshot
 *     toàn bộ pose: rotation local (Euler xyz) của mọi xương trong
 *     QuickRig.current.bones + trạng thái FK (fkRotations,
 *     fingerCurl, footRoll, spineRotations, headRotation,
 *     neckRotation, jawOpen) + vị trí/rotation các control Object3D
 *     (controls/poles). Snapshot là dữ liệu thuần (plain object,
 *     không giữ tham chiếu tới Object3D) nên restore luôn đúng kể
 *     cả khi pose đã đổi nhiều lần sau đó.
 *   • Control layers: layer Base (= pose gốc) + các layer Additive
 *     lưu DELTA rotation từng xương so với Base. applyLayers() tính
 *     pose cuối = base + strength * delta của từng layer đang bật
 *     (cộng Euler từng thành phần, clamp [-PI, PI]).
 *
 * GIỚI HẠN TRUNG THỰC — ĐỌC KỸ:
 *   • History CHỈ ghi khi code gọi pushState(label). Module này
 *     KHÔNG tự intercept được các setter của QuickRig
 *     (setFKRotation / setFingerCurl / setFootRoll / moveIKTarget /
 *     setSpineRotation / setHeadRotation / setJaw / matchToSource /
 *     bakeToSkeleton / loadPreset / autoGen) vì chúng là hàm độc lập
 *     trong arp-quickrig.js, module này không được sửa file đó.
 *     Coordinator cần nối pushState() vào các thao tác đó, ví dụ:
 *       - sau convertToControlRig / autoGen xong: pushState('Ban đầu')
 *       - TRƯỚC mỗi lần applyPose / setFingerCurl / setFootRoll /
 *         setFKRotation / setSpineRotation / setHeadRotation /
 *         setJaw / moveIKTarget / setPolePosition / matchToSource /
 *         bakeToSkeleton / loadPreset đổi pose: pushState('<tên thao tác>')
 *     (ghi TRƯỚC khi đổi để undo trả về đúng pose trước thao tác).
 *   • restorePose() đặt trực tiếp rotation local của xương + vị trí
 *     control, KHÔNG chạy lại IK solver (updateLimb). Pose khôi phục
 *     là đúng cho tới lần kéo IK target / đổi limb mode tiếp theo,
 *     lúc đó solver tính lại từ vị trí control đã khôi phục.
 *   • Layer delta chỉ lưu DELTA ROTATION từng xương (Euler), không
 *     lưu delta vị trí control/pole hay FK scalar (fingerCurl,
 *     footRoll, jawOpen): applyLayers() đưa vị trí control/pole về
 *     đúng Base pose, còn fingerCurl/footRoll/jawOpen giữ nguyên giá
 *     trị hiện tại. Delta Euler được wrap về [-PI, PI] khi chụp và
 *     clamp [-PI, PI] khi cộng dồn.
 *   • Đổi sang rig khác (convert/autoGen lại trên model khác) thì
 *     history + layers cũ tự reset, vì snapshot của rig cũ không còn
 *     ý nghĩa trên rig mới.
 *   • Không có Kilt limb, không có 3-bone IK (ngoài phạm vi phần 7).
 * ============================================================ */
(function () {
  'use strict';

  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };
  var QR = (window.PixiStudio && window.PixiStudio.ArpQuickRig) || null;

  var MAX_STEPS_DEFAULT = 50;
  var MAX_STEPS_MIN = 20;
  var MAX_STEPS_MAX = 200;
  var EPS = 1e-9;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function cloneEuler(e) {
    e = e || {};
    return { x: e.x || 0, y: e.y || 0, z: e.z || 0 };
  }
  /* Deep copy dữ liệu thuần (số / chuỗi / object / mảng). Không giữ
     tham chiếu tới Object3D hay bất kỳ object live nào. */
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
  function wrapAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  var state = {
    stack: [],        /* snapshots (plain object), cũ -> mới */
    index: -1,        /* vị trí snapshot HIỆN TẠI trong stack */
    maxSteps: MAX_STEPS_DEFAULT,
    rigTarget: null,  /* target của rig mà history/layers đang theo dõi */
    layers: [],       /* [{ name, enabled, strength, delta: {dst:{x,y,z}} }] */
    basePose: null    /* snapshot pose gốc cho layers (plain object) */
  };

  /* ---------- rig đang theo dõi ---------- */
  function ensureRig() {
    var cur = QR && QR.current;
    if (!cur || !cur.target) return null;
    if (state.rigTarget !== cur.target) {
      /* Rig khác (convert/autoGen lại): history + layers cũ vô nghĩa. */
      state.stack = [];
      state.index = -1;
      state.layers = [];
      state.basePose = null;
      state.rigTarget = cur.target;
      ensureBaseLayer();
    }
    return cur;
  }
  function ensureBaseLayer() {
    if (!findLayer('Base')) {
      state.layers.unshift({ name: 'Base', enabled: true, strength: 1, delta: {} });
    }
  }
  function findLayer(name) {
    for (var i = 0; i < state.layers.length; i++) {
      if (state.layers[i].name === name) return state.layers[i];
    }
    return null;
  }

  /* ============================================================
     SNAPSHOT / RESTORE — dữ liệu thuần, không giữ tham chiếu live
     ============================================================ */
  function snapshotPose(cur) {
    cur = cur || (QR && QR.current);
    if (!cur) return null;
    var snap = {
      label: '',
      at: Date.now(),
      bones: {},            /* dst -> {x,y,z} rotation local */
      fkRotations: {},
      fingerCurl: {},
      fingerCurlAll: 0,
      footRoll: {},
      spineRotations: {},
      headRotation: { x: 0, y: 0, z: 0 },
      neckRotation: { x: 0, y: 0, z: 0 },
      jawOpen: 0,
      jawRotation: 0,       /* rotation.x của xương hàm (nếu có) */
      limbModes: {},
      controls: {},         /* dst -> { p:[x,y,z], r:[x,y,z] } */
      poles: {}             /* limbKey -> { p:[x,y,z] } */
    };
    Object.keys(cur.bones || {}).forEach(function (dst) {
      var b = cur.bones[dst];
      if (b && b.rotation) snap.bones[dst] = { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z };
    });
    snap.fkRotations = clonePlain(cur.fkRotations || {});
    snap.fingerCurl = clonePlain(cur.fingerCurl || {});
    snap.fingerCurlAll = cur.fingerCurlAll || 0;
    snap.footRoll = clonePlain(cur.footRoll || {});
    snap.spineRotations = clonePlain(cur.spineRotations || {});
    snap.headRotation = cloneEuler(cur.headRotation);
    snap.neckRotation = cloneEuler(cur.neckRotation);
    snap.jawOpen = cur.jawOpen || 0;
    snap.limbModes = clonePlain(cur.limbModes || {});
    try {
      var jaw = (QR && typeof QR.findJawBone === 'function') ? QR.findJawBone() : null;
      if (jaw && jaw.rotation) snap.jawRotation = jaw.rotation.x;
    } catch (e) {}
    Object.keys(cur.controls || {}).forEach(function (dst) {
      var c = cur.controls[dst];
      if (!c) return;
      snap.controls[dst] = {
        p: [c.position.x, c.position.y, c.position.z],
        r: [c.rotation.x, c.rotation.y, c.rotation.z]
      };
    });
    Object.keys(cur.poles || {}).forEach(function (k) {
      var p = cur.poles[k];
      if (p) snap.poles[k] = { p: [p.position.x, p.position.y, p.position.z] };
    });
    return snap;
  }

  function restorePose(snap, cur) {
    cur = cur || (QR && QR.current);
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    if (!snap) return { ok: false, error: 'Không có snapshot để khôi phục.' };
    /* Xương: đặt trực tiếp rotation local (không chạy lại IK solver). */
    Object.keys(snap.bones || {}).forEach(function (dst) {
      var b = cur.bones && cur.bones[dst];
      if (!b) return;
      var r = snap.bones[dst];
      b.rotation.set(r.x, r.y, r.z);
    });
    /* Trạng thái FK — deep copy để không alias snapshot. */
    cur.fkRotations = clonePlain(snap.fkRotations || {});
    cur.fingerCurl = clonePlain(snap.fingerCurl || {});
    cur.fingerCurlAll = snap.fingerCurlAll || 0;
    cur.footRoll = clonePlain(snap.footRoll || {});
    cur.spineRotations = clonePlain(snap.spineRotations || {});
    cur.headRotation = cloneEuler(snap.headRotation);
    cur.neckRotation = cloneEuler(snap.neckRotation);
    cur.jawOpen = snap.jawOpen || 0;
    if (snap.limbModes) cur.limbModes = clonePlain(snap.limbModes);
    try {
      var jaw = (QR && typeof QR.findJawBone === 'function') ? QR.findJawBone() : null;
      if (jaw && jaw.rotation && snap.jawRotation !== undefined) jaw.rotation.x = snap.jawRotation;
    } catch (e) {}
    /* Control + pole: vị trí và rotation. */
    Object.keys(snap.controls || {}).forEach(function (dst) {
      var c = cur.controls && cur.controls[dst];
      if (!c) return;
      var s = snap.controls[dst];
      if (s.p) c.position.set(s.p[0], s.p[1], s.p[2]);
      if (s.r) c.rotation.set(s.r[0], s.r[1], s.r[2]);
    });
    Object.keys(snap.poles || {}).forEach(function (k) {
      var p = cur.poles && cur.poles[k];
      if (!p) return;
      var s = snap.poles[k];
      if (s.p) p.position.set(s.p[0], s.p[1], s.p[2]);
    });
    try { if (cur.target && cur.target.updateMatrixWorld) cur.target.updateMatrixWorld(true); } catch (e) {}
    return { ok: true };
  }

  /* Đưa vị trí control/pole về đúng snapshot base (layer chỉ có delta
     xoay nên vị trí lấy từ Base). */
  function restoreControlPositions(snap, cur) {
    Object.keys(snap.controls || {}).forEach(function (dst) {
      var c = cur.controls && cur.controls[dst];
      if (!c) return;
      var s = snap.controls[dst];
      if (s.p) c.position.set(s.p[0], s.p[1], s.p[2]);
    });
    Object.keys(snap.poles || {}).forEach(function (k) {
      var p = cur.poles && cur.poles[k];
      if (!p) return;
      var s = snap.poles[k];
      if (s.p) p.position.set(s.p[0], s.p[1], s.p[2]);
    });
  }

  /* ============================================================
     UNDO / REDO
     Quy ước: stack[index] = snapshot của pose HIỆN TẠI.
     pushState() chụp pose hiện tại rồi đẩy lên đỉnh. undo() lùi
     index và khôi phục snapshot đó; redo() tiến index và khôi phục.
     Push sau khi đã undo sẽ cắt bỏ nhánh redo.
     ============================================================ */
  function pushState(label) {
    var cur = ensureRig();
    if (!cur) return { ok: false, error: 'Chưa có control rig — convert/autoGen model đã rig trước.' };
    var snap = snapshotPose(cur);
    snap.label = String(label || ('Trạng thái ' + (state.stack.length + 1)));
    if (state.index < state.stack.length - 1) state.stack.length = state.index + 1;
    state.stack.push(snap);
    while (state.stack.length > state.maxSteps) state.stack.shift();
    state.index = state.stack.length - 1;
    try { bus.emit('arpqr-history:pushed', { label: snap.label, count: state.stack.length, index: state.index }); } catch (e) {}
    return { ok: true, label: snap.label, count: state.stack.length, index: state.index };
  }

  function canUndo() {
    if (QR && QR.current) ensureRig();
    return state.index > 0;
  }
  function canRedo() {
    if (QR && QR.current) ensureRig();
    return state.index >= 0 && state.index < state.stack.length - 1;
  }

  function undo() {
    var cur = ensureRig();
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    if (!canUndo()) return { ok: false, error: 'Không còn bước nào để undo.' };
    state.index--;
    var snap = state.stack[state.index];
    var r = restorePose(snap, cur);
    if (!r.ok) { state.index++; return r; }
    try { bus.emit('arpqr-history:undone', { label: snap.label, index: state.index }); } catch (e) {}
    return { ok: true, label: snap.label, index: state.index };
  }

  function redo() {
    var cur = ensureRig();
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    if (!canRedo()) return { ok: false, error: 'Không còn bước nào để redo.' };
    state.index++;
    var snap = state.stack[state.index];
    var r = restorePose(snap, cur);
    if (!r.ok) { state.index--; return r; }
    try { bus.emit('arpqr-history:redone', { label: snap.label, index: state.index }); } catch (e) {}
    return { ok: true, label: snap.label, index: state.index };
  }

  function jumpTo(i) {
    var cur = ensureRig();
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    i = Math.floor(Number(i));
    if (isNaN(i) || i < 0 || i >= state.stack.length) {
      return { ok: false, error: 'Vị trí lịch sử không hợp lệ: ' + i };
    }
    state.index = i;
    var r = restorePose(state.stack[i], cur);
    if (!r.ok) return r;
    try { bus.emit('arpqr-history:jumped', { label: state.stack[i].label, index: i }); } catch (e) {}
    return { ok: true, label: state.stack[i].label, index: i };
  }

  /* Chỉ xóa lịch sử undo/redo — layers + Base pose giữ nguyên. */
  function clear() {
    state.stack = [];
    state.index = -1;
    return { ok: true };
  }
  /* Xóa hết: lịch sử + layers + Base pose (lần dùng sau sẽ init lại). */
  function resetAll() {
    state.stack = [];
    state.index = -1;
    state.layers = [];
    state.basePose = null;
    state.rigTarget = null;
    return { ok: true };
  }

  function getHistoryLabels() {
    if (QR && QR.current) ensureRig();
    return state.stack.map(function (s, i) {
      return { label: s.label, at: s.at, index: i, current: i === state.index };
    });
  }

  function setMaxSteps(n) {
    n = Math.floor(Number(n));
    if (isNaN(n)) return { ok: false, error: 'maxSteps phải là số.' };
    n = clamp(n, MAX_STEPS_MIN, MAX_STEPS_MAX);
    state.maxSteps = n;
    var removed = 0;
    while (state.stack.length > n) { state.stack.shift(); removed++; }
    if (removed) {
      state.index -= removed;
      if (state.index < 0) state.index = state.stack.length ? 0 : -1;
    }
    return { ok: true, maxSteps: n };
  }
  function getMaxSteps() { return state.maxSteps; }

  /* ============================================================
     CONTROL LAYERS
     Base = pose gốc (snapshot lúc tạo layer đầu tiên, hoặc lúc gọi
     captureBasePose). Additive layer lưu DELTA Euler từng xương so
     với Base. applyLayers: pose cuối = base + Σ strength*delta
     (chỉ layer đang bật), cộng từng thành phần, clamp [-PI, PI].
     ============================================================ */
  function captureBasePose() {
    var cur = ensureRig();
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    ensureBaseLayer();
    state.basePose = snapshotPose(cur);
    state.basePose.label = 'Base';
    return { ok: true, bones: Object.keys(state.basePose.bones).length };
  }

  function createLayer(name) {
    var cur = ensureRig();
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    name = String(name || '').trim();
    if (!name) return { ok: false, error: 'Tên layer không được để trống.' };
    if (name === 'Base') return { ok: false, error: 'Đã có layer Base.' };
    if (findLayer(name)) return { ok: false, error: 'Đã có layer tên "' + name + '".' };
    if (!state.basePose) captureBasePose(); /* Base = pose hiện tại */
    ensureBaseLayer();
    state.layers.push({ name: name, enabled: true, strength: 1, delta: {} });
    try { bus.emit('arpqr-history:layer-created', { name: name }); } catch (e) {}
    return { ok: true, name: name, layers: listLayers() };
  }

  function deleteLayer(name) {
    if (name === 'Base') return { ok: false, error: 'Không xóa được layer Base.' };
    for (var i = 0; i < state.layers.length; i++) {
      if (state.layers[i].name === name) {
        state.layers.splice(i, 1);
        try { bus.emit('arpqr-history:layer-deleted', { name: name }); } catch (e) {}
        return { ok: true, name: name };
      }
    }
    return { ok: false, error: 'Không có layer "' + name + '".' };
  }

  function setLayerEnabled(name, on) {
    var l = findLayer(name);
    if (!l) return { ok: false, error: 'Không có layer "' + name + '".' };
    if (name === 'Base' && !on) return { ok: false, error: 'Layer Base luôn bật.' };
    l.enabled = !!on;
    var applied = applyLayers();
    return { ok: true, name: name, enabled: l.enabled, applied: applied };
  }

  function setLayerStrength(name, v) {
    var l = findLayer(name);
    if (!l) return { ok: false, error: 'Không có layer "' + name + '".' };
    v = clamp(Number(v) || 0, 0, 1);
    l.strength = v;
    var applied = applyLayers();
    return { ok: true, name: name, strength: v, applied: applied };
  }

  /* Chụp delta = pose hiện tại − Base pose (wrap về [-PI, PI]).
     Chỉ lưu xương nào lệch khỏi Base (>|1e-9| ở ít nhất 1 thành phần). */
  function captureLayerDelta(name) {
    var cur = ensureRig();
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    var l = findLayer(name);
    if (!l) return { ok: false, error: 'Không có layer "' + name + '".' };
    if (name === 'Base') return { ok: false, error: 'Layer Base không lưu delta — dùng "Đặt Base = pose hiện tại".' };
    if (!state.basePose) captureBasePose();
    var now = snapshotPose(cur);
    var delta = {};
    var changed = 0;
    Object.keys(now.bones).forEach(function (dst) {
      var b0 = state.basePose.bones[dst];
      if (!b0) return;
      var d = {
        x: wrapAngle(now.bones[dst].x - b0.x),
        y: wrapAngle(now.bones[dst].y - b0.y),
        z: wrapAngle(now.bones[dst].z - b0.z)
      };
      if (Math.abs(d.x) > EPS || Math.abs(d.y) > EPS || Math.abs(d.z) > EPS) {
        delta[dst] = d;
        changed++;
      }
    });
    l.delta = delta;
    try { bus.emit('arpqr-history:layer-delta', { name: name, bonesChanged: changed }); } catch (e) {}
    return { ok: true, name: name, bonesChanged: changed, delta: clonePlain(delta) };
  }

  function applyLayers() {
    var cur = ensureRig();
    if (!cur) return { ok: false, error: 'Chưa có control rig.' };
    if (!state.basePose) captureBasePose();
    var base = state.basePose;
    var finalPose = {};
    Object.keys(base.bones || {}).forEach(function (dst) {
      finalPose[dst] = cloneEuler(base.bones[dst]);
    });
    var appliedLayers = [];
    state.layers.forEach(function (l) {
      if (l.name === 'Base' || !l.enabled || !l.strength) return;
      Object.keys(l.delta || {}).forEach(function (dst) {
        if (!finalPose[dst]) finalPose[dst] = { x: 0, y: 0, z: 0 };
        var d = l.delta[dst];
        finalPose[dst].x = clamp(finalPose[dst].x + l.strength * d.x, -Math.PI, Math.PI);
        finalPose[dst].y = clamp(finalPose[dst].y + l.strength * d.y, -Math.PI, Math.PI);
        finalPose[dst].z = clamp(finalPose[dst].z + l.strength * d.z, -Math.PI, Math.PI);
      });
      appliedLayers.push(l.name);
    });
    /* Áp lên xương + đồng bộ fkRotations / rotation của control. */
    Object.keys(finalPose).forEach(function (dst) {
      var b = cur.bones && cur.bones[dst];
      var r = finalPose[dst];
      if (b) b.rotation.set(r.x, r.y, r.z);
      cur.fkRotations[dst] = cloneEuler(r);
      var c = cur.controls && cur.controls[dst];
      if (c) c.rotation.set(r.x, r.y, r.z);
    });
    /* Vị trí control/pole về đúng Base (layer chỉ lưu delta xoay). */
    restoreControlPositions(base, cur);
    if (finalPose.Head) cur.headRotation = cloneEuler(finalPose.Head);
    if (finalPose.Neck) cur.neckRotation = cloneEuler(finalPose.Neck);
    ['Spine', 'Spine1', 'Spine2'].forEach(function (s) {
      if (finalPose[s]) cur.spineRotations[s] = cloneEuler(finalPose[s]);
    });
    try { if (cur.target && cur.target.updateMatrixWorld) cur.target.updateMatrixWorld(true); } catch (e) {}
    try { bus.emit('arpqr-history:layers-applied', { layers: appliedLayers }); } catch (e) {}
    return { ok: true, appliedLayers: appliedLayers, bones: Object.keys(finalPose).length };
  }

  function listLayers() {
    if (QR && QR.current) ensureRig();
    ensureBaseLayer();
    return state.layers.map(function (l) {
      return {
        name: l.name,
        enabled: !!l.enabled,
        strength: l.strength,
        bones: Object.keys(l.delta || {}).length
      };
    });
  }

  /* ============================================================
     UI — renderSection(container): DOM thuần + inline style,
     không sửa CSS. Nút Undo/Redo disable khi không undo/redo được;
     click 1 mục lịch sử để nhảy tới; panel layers có checkbox,
     slider strength, nút chụp delta / xóa layer.
     ============================================================ */
  function el(tag, text, style) {
    var n = window.document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    if (style) n.setAttribute('style', style);
    return n;
  }

  function renderSection(container) {
    if (!container || !container.appendChild) return false;
    while (container.firstChild) container.removeChild(container.firstChild);
    var cur = (QR && QR.current) || null;
    var wrap = el('div', null, 'font-family:inherit;font-size:13px;line-height:1.5;');
    container.appendChild(wrap);
    function refresh() { renderSection(container); }

    /* --- Undo / Redo --- */
    wrap.appendChild(el('h3', 'Lịch sử — Undo / Redo', 'margin:6px 0;font-size:14px;'));
    if (!cur) {
      wrap.appendChild(el('div', 'Chưa có control rig — convert/autoGen model đã rig trước rồi quay lại đây.',
        'color:#c00;margin:4px 0;'));
    }
    var row = el('div', null, 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0;');
    var btnUndo = el('button', '⟲ Undo', 'padding:4px 10px;cursor:pointer;');
    btnUndo.disabled = !canUndo();
    btnUndo.addEventListener('click', function () { undo(); refresh(); });
    var btnRedo = el('button', '⟳ Redo', 'padding:4px 10px;cursor:pointer;');
    btnRedo.disabled = !canRedo();
    btnRedo.addEventListener('click', function () { redo(); refresh(); });
    row.appendChild(btnUndo);
    row.appendChild(btnRedo);
    var labelInput = window.document.createElement('input');
    labelInput.type = 'text';
    labelInput.placeholder = 'Tên trạng thái…';
    labelInput.setAttribute('style', 'padding:4px 6px;min-width:120px;');
    row.appendChild(labelInput);
    var btnSave = el('button', '+ Lưu trạng thái', 'padding:4px 10px;cursor:pointer;');
    btnSave.disabled = !cur;
    btnSave.addEventListener('click', function () {
      var r = pushState(labelInput.value || undefined);
      if (r.ok) labelInput.value = '';
      refresh();
    });
    row.appendChild(btnSave);
    wrap.appendChild(row);

    var labels = getHistoryLabels();
    var list = el('ol', null, 'margin:4px 0;padding-left:20px;max-height:160px;overflow:auto;');
    if (!labels.length) {
      list.appendChild(el('li', '(chưa có trạng thái nào — bấm Lưu trạng thái để bắt đầu)', 'color:#888;'));
    }
    labels.forEach(function (item) {
      var li = el('li',
        fmtTime(item.at) + ' — ' + item.label + (item.current ? '  ● hiện tại' : ''),
        'cursor:pointer;padding:2px 4px;' + (item.current ? 'background:#e8f4ff;font-weight:bold;' : ''));
      li.addEventListener('click', function () { jumpTo(item.index); refresh(); });
      list.appendChild(li);
    });
    wrap.appendChild(list);
    wrap.appendChild(el('div',
      'Lịch sử chỉ ghi khi bấm "Lưu trạng thái" hoặc code gọi History.pushState(label) — chưa tự bắt mọi thao tác pose.',
      'color:#888;font-size:12px;margin:4px 0;'));

    /* --- Control layers --- */
    wrap.appendChild(el('h3', 'Control Layers', 'margin:10px 0 6px;font-size:14px;'));
    var lrow = el('div', null, 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0;');
    var btnBase = el('button', 'Đặt Base = pose hiện tại', 'padding:4px 10px;cursor:pointer;');
    btnBase.disabled = !cur;
    btnBase.addEventListener('click', function () { captureBasePose(); refresh(); });
    lrow.appendChild(btnBase);
    var nameInput = window.document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Tên layer mới…';
    nameInput.setAttribute('style', 'padding:4px 6px;min-width:110px;');
    lrow.appendChild(nameInput);
    var btnAdd = el('button', '+ Thêm layer', 'padding:4px 10px;cursor:pointer;');
    btnAdd.disabled = !cur;
    btnAdd.addEventListener('click', function () {
      if (nameInput.value) { createLayer(nameInput.value); nameInput.value = ''; }
      refresh();
    });
    lrow.appendChild(btnAdd);
    wrap.appendChild(lrow);

    listLayers().forEach(function (l) {
      var box = el('div', null, 'border:1px solid #ccc;border-radius:6px;padding:6px 8px;margin:6px 0;');
      var top = el('div', null, 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;');
      var cb = window.document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!l.enabled;
      cb.disabled = (l.name === 'Base');
      cb.addEventListener('change', function () { setLayerEnabled(l.name, cb.checked); refresh(); });
      top.appendChild(cb);
      top.appendChild(el('b', l.name, ''));
      top.appendChild(el('span', '(' + l.bones + ' xương có delta)', 'color:#888;font-size:12px;'));
      if (l.name !== 'Base') {
        var btnCap = el('button', 'Chụp delta', 'padding:2px 8px;cursor:pointer;');
        btnCap.addEventListener('click', function () { captureLayerDelta(l.name); refresh(); });
        top.appendChild(btnCap);
        var btnDel = el('button', 'Xóa', 'padding:2px 8px;cursor:pointer;');
        btnDel.addEventListener('click', function () { deleteLayer(l.name); refresh(); });
        top.appendChild(btnDel);
      } else {
        top.appendChild(el('span', 'pose gốc', 'color:#888;font-size:12px;'));
      }
      box.appendChild(top);
      var srow = el('div', null, 'display:flex;gap:8px;align-items:center;margin-top:4px;');
      srow.appendChild(el('span', 'Strength', 'font-size:12px;'));
      var slider = window.document.createElement('input');
      slider.type = 'range';
      slider.min = '0'; slider.max = '1'; slider.step = '0.05';
      slider.value = String(l.strength);
      slider.disabled = (l.name === 'Base');
      slider.setAttribute('style', 'flex:1;');
      var val = el('span', Number(l.strength).toFixed(2), 'font-size:12px;min-width:32px;');
      slider.addEventListener('input', function () {
        var v = Number(slider.value);
        setLayerStrength(l.name, v);
        val.textContent = Number(slider.value).toFixed(2);
      });
      slider.addEventListener('change', function () { refresh(); });
      srow.appendChild(slider);
      srow.appendChild(val);
      box.appendChild(srow);
      wrap.appendChild(box);
    });
    return true;
  }

  /* ============================================================
     Expose
     ============================================================ */
  var History = {
    pushState: pushState,
    undo: undo,
    redo: redo,
    jumpTo: jumpTo,
    canUndo: canUndo,
    canRedo: canRedo,
    clear: clear,
    resetAll: resetAll,
    getHistoryLabels: getHistoryLabels,
    setMaxSteps: setMaxSteps,
    getMaxSteps: getMaxSteps,
    createLayer: createLayer,
    deleteLayer: deleteLayer,
    setLayerEnabled: setLayerEnabled,
    setLayerStrength: setLayerStrength,
    captureLayerDelta: captureLayerDelta,
    captureBasePose: captureBasePose,
    applyLayers: applyLayers,
    listLayers: listLayers,
    renderSection: renderSection,
    _test: {
      snapshotPose: snapshotPose,
      restorePose: restorePose,
      wrapAngle: wrapAngle,
      getStack: function () { return state.stack; },
      getIndex: function () { return state.index; },
      getLayers: function () { return state.layers; },
      getBasePose: function () { return state.basePose; }
    }
  };

  window.PixiStudio = window.PixiStudio || {};
  if (QR) {
    QR.History = History;
  } else {
    /* arp-quickrig.js chưa load trước: giữ History ở stub để không mất
       module; coordinator PHẢI load arp-qr3-history.js SAU arp-quickrig.js
       (lúc đó QR tồn tại và History gắn đúng chỗ). */
    window.PixiStudio.ArpQuickRig = { History: History };
  }
  /* Đăng ký section nếu coordinator đã thêm hook registerSection —
     chưa có hook thì module vẫn chạy bình thường. */
  try {
    if (QR && typeof QR.registerSection === 'function') QR.registerSection('history', renderSection);
  } catch (e) {}
})();
