/* ============================================================
 * rig/arp-roll.js — BONE ROLL EDITOR (Nhóm 4, 2026-11-27)
 *
 * Roll = góc xoay quanh TRỤC DÀI của xương (trục từ đầu xương tới
 * xương con — với rig Mixamo/FBX, trục này ≈ +Y local của xương,
 * đo được trên Thiếu Lâm thật: LeftForeArm nằm ở (0, 0.053, 0)
 * trong hệ local của LeftArm). Chỉnh roll KHÔNG đổi vị trí khớp,
 * chỉ xoay "mặt" của xương quanh trục của nó.
 *
 * Cách áp: lưu quaternion gốc của xương (lần chỉnh đầu tiên),
 * rồi đặt q = qGốc · rotXoay(trụcDài, roll). Nhân BÊN PHẢI =
 * xoay trong hệ local của xương ⇒ đúng là roll quanh trục dài,
 * và vị trí world của xương con không đổi (chỉ hướng xoay đổi).
 *
 * Đo xoắn (twist): phân rã swing-twist của (qHiệnTại · qGốc⁻¹)
 * quanh trục dài → góc twist (độ). Cảnh báo khi |twist| > 30°
 * (ngưỡng mặc định, chỉnh được qua Roll.TWIST_WARN_DEG) vì xoắn
 * lớn làm mesh quanh xương vặn theo. Twist đo theo pose lúc bắt
 * đầu chỉnh roll (qGốc), KHÔNG phải bind pose tuyệt đối — ghi rõ
 * để không hiểu lầm; muốn đo theo bind pose thì bấm "Chụp bind"
 * khi model đang ở bind/T-pose rồi mới chỉnh.
 *
 * PRESET (ghi rõ quy ước):
 *   • 'mixamo-zero' (mặc định, duy nhất có sẵn): roll = 0° cho MỌI
 *     xương. Đây là quy ước của rig Mixamo: roll KHÔNG lưu riêng mà
 *     nằm sẵn trong hướng local frame của xương (xương Mixamo có
 *     local frame xoay sẵn, vd LeftArm quat ≈ (0.84, -0.15, -0.30,
 *     -0.42) ở bind pose) — nên "chuẩn Mixamo" nghĩa là roll bổ
 *     sung bằng 0, không phải đặt frame về trục thế giới. Preset
 *     này = reset toàn rig về 0.
 *   • Preset tự lưu: user chỉnh roll rồi lưu tên preset vào
 *     localStorage (Roll.saveCustomPreset) — áp lại sau này.
 *   • KHÔNG bịa preset "tay/chân ±N°" theo cảm tính giải phẫu:
 *     không có nguồn đo nào cho các số đó trên rig này.
 *
 * API:
 *   getBoneAxis(bone) → Vector3 trục dài (local, đã normalize).
 *   applyRoll(boneOrName, deg, opts) → { ok, rollDeg, twistDeg,
 *     warning, axis } — xem trước ngay (áp liền lên xương).
 *   getRoll(bone) / getRollDeg(name, target) — roll hiện tại.
 *   measureTwist(bone) → { ok, twistDeg, warning }.
 *   resetRoll(boneOrName) / resetAllRig(target) → về 0.
 *   captureBind(target) — chụp pose hiện tại làm gốc đo twist.
 *   applyPreset(target, 'mixamo-zero') / saveCustomPreset(name,
 *     target) / listCustomPresets() / applyCustomPreset(name, target).
 *   TWIST_WARN_DEG = 30 (ngưỡng cảnh báo, chỉnh được).
 *
 * UI: 1 section 'roll' trong tab Quick Rig (registerSection):
 *   chọn xương (dropdown), slider -180..180° + nhập số, twist
 *   hiện tại + cảnh báo, preset Mixamo-zero, reset 1 xương / toàn
 *   rig, lưu preset tự đặt tên. Kéo slider là pose đổi ngay trên
 *   viewport (applyRoll áp trực tiếp lên bone).
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Roll chỉ đổi quaternion local của xương — mesh skin theo
 *     xương nên sẽ xoay theo; roll lớn (>30°) vặn mesh thật, đã
 *     cảnh báo nhưng KHÔNG ngăn (user tự quyết).
 *   • Xương lá (không có con: ngón tay cuối, Toe_End...) không có
 *     hướng con để đo trục → fallback trục +Y local (quy ước
 *     three.js/FBX). Harness đo và ghi rõ xương nào dùng fallback.
 *   • Roll KHÔNG được xuất kèm FBX riêng (nằm trong quaternion
 *     của xương nên file FBX xuất từ pose hiện tại sẽ giữ roll —
 *     nhưng export lúc phát clip sẽ lấy từ clip, không phải pose).
 * ============================================================ */
(function () {
  'use strict';

  var PS = window.PixiStudio || (window.PixiStudio = {});
  var bus = (PS && PS.bus) || { emit: function () {}, on: function () {} };
  var U = (PS && PS.Utils) || null;
  var T = window.THREE || null;

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
      else if (k === 'type') node.type = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    }
    return node;
  }
  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message }); } catch (e) {}
  }
  function deg2rad(d) { return d * Math.PI / 180; }
  function rad2deg(r) { return r * 180 / Math.PI; }

  var Roll = { TWIST_WARN_DEG: 30 };
  var STORAGE_KEY = 'pixistudio-arp-roll-presets-1';

  function stripName(full) {
    var s = String(full || '').trim();
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    s = s.replace(/\.(quaternion|position|scale)$/i, '');
    return s;
  }
  function getTarget(target) {
    if (target) return target;
    try {
      if (PS.State && PS.State.get) { var sel = PS.State.get('selection'); if (sel) return sel; }
    } catch (e) {}
    try {
      if (PS.Viewport && PS.Viewport.getMainModel) { var m = PS.Viewport.getMainModel(); if (m) return m; }
    } catch (e) {}
    try {
      var AN = PS.ArpAnimator;
      if (AN && AN._target) return AN._target;
    } catch (e) {}
    return null;
  }
  function findBone(target, name) {
    if (!target || !name) return null;
    var want = stripName(name).toLowerCase();
    var found = null;
    target.traverse(function (o) {
      if (!found && o.isBone && stripName(o.name).toLowerCase() === want) found = o;
    });
    return found;
  }
  function collectBones(target) {
    var list = [];
    if (target && target.traverse) target.traverse(function (o) { if (o.isBone) list.push(o); });
    return list;
  }
  function resolveBone(boneOrName, target) {
    if (!boneOrName) return null;
    if (typeof boneOrName === 'object' && boneOrName.isBone) return boneOrName;
    return findBone(getTarget(target), boneOrName);
  }

  /* Trục dài của xương (hệ local): hướng tới xương con đầu tiên.
     Không có con → fallback +Y local (quy ước three.js/FBX). */
  function getBoneAxis(bone) {
    if (!bone || !T) return null;
    var child = null;
    for (var i = 0; i < bone.children.length; i++) {
      if (bone.children[i].isBone) { child = bone.children[i]; break; }
    }
    if (child && child.position.lengthSq() > 1e-12) {
      return { axis: child.position.clone().normalize(), source: 'child:' + stripName(child.name) };
    }
    return { axis: new T.Vector3(0, 1, 0), source: 'fallback:+Y (xương lá, không có con)' };
  }
  Roll.getBoneAxis = getBoneAxis;

  /* Phân rã swing-twist: góc twist (độ) của q quanh `axis`. */
  function swingTwist(q, axis) {
    var v = new T.Vector3(q.x, q.y, q.z);
    var d = axis.x * v.x + axis.y * v.y + axis.z * v.z;
    var angle = 2 * Math.atan2(d, q.w);
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return { angleDeg: rad2deg(angle), twistQuat: new T.Quaternion(axis.x * d, axis.y * d, axis.z * d, q.w).normalize() };
  }
  Roll.swingTwist = swingTwist;

  function ensureBase(bone) {
    if (!bone.userData) bone.userData = {};
    if (!bone.userData.arpRollBase) {
      bone.userData.arpRollBase = bone.quaternion.clone();
      bone.userData.arpRollDeg = 0;
    }
    return bone.userData.arpRollBase;
  }
  /* Chụp pose hiện tại của toàn rig làm gốc đo twist (bind/T-pose). */
  function captureBind(target) {
    target = getTarget(target);
    if (!target) return { ok: false, error: 'Chưa có model/rig.' };
    var n = 0;
    collectBones(target).forEach(function (b) {
      if (!b.userData) b.userData = {};
      b.userData.arpRollBase = b.quaternion.clone();
      b.userData.arpRollDeg = 0;
      n++;
    });
    return { ok: true, bones: n };
  }
  Roll.captureBind = captureBind;

  function applyRoll(boneOrName, deg, opts) {
    opts = opts || {};
    var bone = resolveBone(boneOrName, opts.target);
    if (!bone || !T) return { ok: false, error: bone ? 'THREE chưa load.' : 'Không tìm thấy xương: ' + boneOrName };
    deg = parseFloat(deg);
    if (!isFinite(deg)) return { ok: false, error: 'Roll phải là số (độ).' };
    deg = Math.max(-180, Math.min(180, deg));
    var base = ensureBase(bone);
    var ax = getBoneAxis(bone);
    var twist = new T.Quaternion().setFromAxisAngle(ax.axis, deg2rad(deg));
    bone.quaternion.copy(base).multiply(twist);
    bone.userData.arpRollDeg = deg;
    if (bone.parent) bone.updateMatrixWorld(true);
    else bone.updateMatrixWorld(true);
    var m = measureTwist(bone);
    try {
      bus.emit('arp:roll-changed', { bone: stripName(bone.name), rollDeg: deg, twistDeg: m.twistDeg, warning: m.warning, axis: ax.source });
    } catch (e) {}
    return {
      ok: true, bone: stripName(bone.name), rollDeg: deg,
      twistDeg: m.twistDeg, warning: m.warning, axis: ax.source,
      warnText: m.warning ? ('CẢNH BÁO: xoắn ' + m.twistDeg.toFixed(1) + '° > ngưỡng ' + Roll.TWIST_WARN_DEG + '° — mesh quanh xương sẽ vặn.') : ''
    };
  }
  Roll.applyRoll = applyRoll;

  function getRoll(boneOrName, target) {
    var bone = resolveBone(boneOrName, target);
    if (!bone) return null;
    return (bone.userData && typeof bone.userData.arpRollDeg === 'number') ? bone.userData.arpRollDeg : 0;
  }
  Roll.getRoll = getRoll;

  function measureTwist(boneOrName, target) {
    var bone = resolveBone(boneOrName, target);
    if (!bone || !T) return { ok: false, error: bone ? 'THREE chưa load.' : 'Không tìm thấy xương.' };
    var base = ensureBase(bone);
    /* Xoay tương đối TRONG hệ local của xương: base⁻¹·q (không phải
       q·base⁻¹ — cái đó là xoay trong hệ của xương cha, đo twist
       quanh trục local sẽ sai). Với q = base·rot(trục, roll) thì
       base⁻¹·q = rot(trục, roll) đúng bằng góc roll. */
    var rel = base.clone().invert().multiply(bone.quaternion);
    var ax = getBoneAxis(bone);
    var st = swingTwist(rel, ax.axis);
    var warn = Math.abs(st.angleDeg) > Roll.TWIST_WARN_DEG;
    return {
      ok: true, bone: stripName(bone.name), twistDeg: st.angleDeg,
      warning: warn, threshold: Roll.TWIST_WARN_DEG, axis: ax.source
    };
  }
  Roll.measureTwist = measureTwist;

  function resetRoll(boneOrName, target) {
    var bone = resolveBone(boneOrName, target);
    if (!bone) return { ok: false, error: 'Không tìm thấy xương: ' + boneOrName };
    if (bone.userData && bone.userData.arpRollBase) bone.quaternion.copy(bone.userData.arpRollBase);
    if (bone.userData) bone.userData.arpRollDeg = 0;
    bone.updateMatrixWorld(true);
    try { bus.emit('arp:roll-changed', { bone: stripName(bone.name), rollDeg: 0, twistDeg: 0, warning: false }); } catch (e) {}
    return { ok: true, bone: stripName(bone.name), rollDeg: 0 };
  }
  Roll.resetRoll = resetRoll;

  function resetAllRig(target) {
    target = getTarget(target);
    if (!target) return { ok: false, error: 'Chưa có model/rig.' };
    var n = 0;
    collectBones(target).forEach(function (b) {
      if (b.userData && (typeof b.userData.arpRollDeg === 'number') && b.userData.arpRollDeg !== 0) {
        resetRoll(b);
        n++;
      }
    });
    return { ok: true, reset: n };
  }
  Roll.resetAllRig = resetAllRig;

  /* ---------- Preset ---------- */
  var PRESETS = {
    'mixamo-zero': {
      id: 'mixamo-zero',
      label: 'Mixamo chuẩn (roll = 0 mọi xương)',
      desc: 'Quy ước Mixamo: roll không lưu riêng mà nằm sẵn trong local frame của xương (bind pose đã xoay sẵn). Preset này = reset toàn rig về roll bổ sung 0°.'
    }
  };
  Roll.PRESETS = PRESETS;
  function applyPreset(target, presetId) {
    presetId = presetId || 'mixamo-zero';
    if (presetId === 'mixamo-zero') {
      var r = resetAllRig(target);
      if (!r.ok) return r;
      return { ok: true, preset: 'mixamo-zero', reset: r.reset, note: PRESETS['mixamo-zero'].desc };
    }
    return applyCustomPreset(presetId, target);
  }
  Roll.applyPreset = applyPreset;
  function loadCustomPresets() {
    try {
      if (!window.localStorage) return {};
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveCustomPreset(name, target) {
    name = String(name || '').trim();
    if (!name) return { ok: false, error: 'Cần tên preset.' };
    target = getTarget(target);
    if (!target) return { ok: false, error: 'Chưa có model/rig.' };
    var rolls = {};
    collectBones(target).forEach(function (b) {
      var d = getRoll(b);
      if (d) rolls[stripName(b.name)] = d;
    });
    var all = loadCustomPresets();
    all[name] = { rolls: rolls, savedAt: new Date().toISOString() };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (e) { return { ok: false, error: 'Không lưu được localStorage: ' + e.message }; }
    return { ok: true, name: name, bones: Object.keys(rolls).length };
  }
  Roll.saveCustomPreset = saveCustomPreset;
  function listCustomPresets() { return Object.keys(loadCustomPresets()); }
  Roll.listCustomPresets = listCustomPresets;
  function applyCustomPreset(name, target) {
    var all = loadCustomPresets();
    var p = all[name];
    if (!p) return { ok: false, error: 'Không có preset tên "' + name + '".' };
    target = getTarget(target);
    if (!target) return { ok: false, error: 'Chưa có model/rig.' };
    var applied = 0, missing = [];
    Object.keys(p.rolls || {}).forEach(function (boneName) {
      var r = applyRoll(boneName, p.rolls[boneName], { target: target });
      if (r.ok) applied++;
      else missing.push(boneName);
    });
    return { ok: true, preset: name, applied: applied, missing: missing };
  }
  Roll.applyCustomPreset = applyCustomPreset;

  /* ---------- UI: section trong tab Quick Rig ---------- */
  function renderRollSection(container) {
    var wrap = el('div', { style: { borderTop: '1px solid #888', marginTop: '10px', paddingTop: '6px' } });
    wrap.appendChild(el('div', { html: '<b>🌀 Bone Roll Editor</b> — xoay xương quanh trục dài của nó (roll). Kéo slider là pose đổi ngay trên viewport.', style: { marginBottom: '6px' } }));
    var row1 = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } });
    row1.appendChild(el('span', { text: 'Xương:' }));
    var sel = el('select', { class: 'arp-select' });
    var slider = el('input', { type: 'range' });
    slider.min = '-180'; slider.max = '180'; slider.step = '1'; slider.value = '0';
    slider.style.flex = '1';
    var num = el('input', { type: 'number' });
    num.min = '-180'; num.max = '180'; num.step = '1'; num.value = '0';
    num.style.width = '70px';
    var twistLine = el('div', { style: { fontSize: '12px', color: '#555', margin: '6px 0' } });
    function boneNames() {
      var t = getTarget();
      if (!t) return [];
      return collectBones(t).map(function (b) { return stripName(b.name); });
    }
    function refreshBoneList() {
      var names = boneNames();
      while (sel.firstChild) sel.removeChild(sel.firstChild);
      if (!names.length) {
        sel.appendChild(el('option', { text: '(chưa có model/rig)', value: '' }));
        return;
      }
      names.forEach(function (n) { sel.appendChild(el('option', { text: n, value: n })); });
      var pref = names.indexOf('LeftForeArm') >= 0 ? 'LeftForeArm' : names[0];
      sel.value = pref;
      refreshRollReadout();
    }
    function refreshRollReadout() {
      var name = sel.value;
      if (!name) { twistLine.textContent = 'Chưa có model/rig — load 1 model đã rig rồi mở lại tab.'; return; }
      var bone = findBone(getTarget(), name);
      if (!bone) { twistLine.textContent = 'Không tìm thấy xương ' + name; return; }
      var ax = getBoneAxis(bone);
      var m = measureTwist(bone);
      var cur = getRoll(bone) || 0;
      if (document.activeElement !== slider) slider.value = String(Math.round(cur));
      if (document.activeElement !== num) num.value = String(Math.round(cur));
      twistLine.textContent = 'Trục dài: ' + ax.source + ' · Roll: ' + cur.toFixed(1) + '° · Xoắn đo được: ' +
        m.twistDeg.toFixed(1) + '° (ngưỡng cảnh báo ' + Roll.TWIST_WARN_DEG + '°)' +
        (m.warning ? ' — ⚠ XOẮN LỚN, mesh sẽ vặn!' : '');
      twistLine.style.color = m.warning ? '#b00020' : '#555';
    }
    function applyFromUI(deg) {
      var name = sel.value;
      if (!name) return;
      var r = applyRoll(name, deg, { target: getTarget() });
      if (!r.ok) { twistLine.textContent = 'Lỗi: ' + (r.error || 'không rõ'); return; }
      slider.value = String(Math.round(r.rollDeg));
      num.value = String(Math.round(r.rollDeg));
      refreshRollReadout();
    }
    slider.addEventListener('input', function () { applyFromUI(parseFloat(slider.value)); });
    num.addEventListener('change', function () { applyFromUI(parseFloat(num.value)); });
    sel.addEventListener('change', function () { refreshRollReadout(); });
    row1.appendChild(sel);
    wrap.appendChild(row1);
    var row2 = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' } });
    row2.appendChild(el('span', { text: 'Roll:' }));
    row2.appendChild(slider);
    row2.appendChild(num);
    row2.appendChild(el('span', { text: '°' }));
    wrap.appendChild(row2);
    wrap.appendChild(twistLine);
    var row3 = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' } });
    row3.appendChild(el('button', {
      class: 'btn sm', text: 'Preset: Mixamo chuẩn (0°)', onclick: function () {
        var r = applyPreset(getTarget(), 'mixamo-zero');
        twistLine.textContent = r.ok ? ('Đã áp preset Mixamo chuẩn — reset ' + r.reset + ' xương về roll 0°.' + ' ' + (r.note || '')) : ('Lỗi: ' + (r.error || ''));
        refreshRollReadout();
      }
    }));
    row3.appendChild(el('button', {
      class: 'btn sm', text: 'Chụp bind (gốc đo xoắn)', onclick: function () {
        var r = captureBind(getTarget());
        twistLine.textContent = r.ok ? ('Đã chụp pose hiện tại làm gốc đo xoắn (' + r.bones + ' xương). Chỉnh roll rồi xem số xoắn.') : ('Lỗi: ' + (r.error || ''));
        refreshRollReadout();
      }
    }));
    row3.appendChild(el('button', {
      class: 'btn sm', text: 'Reset xương này', onclick: function () {
        var r = resetRoll(sel.value, getTarget());
        twistLine.textContent = r.ok ? ('Đã reset roll ' + r.bone + ' về 0°.') : ('Lỗi: ' + (r.error || ''));
        refreshRollReadout();
      }
    }));
    row3.appendChild(el('button', {
      class: 'btn sm', text: 'Reset toàn rig', onclick: function () {
        var r = resetAllRig(getTarget());
        twistLine.textContent = r.ok ? ('Đã reset ' + r.reset + ' xương về roll 0°.') : ('Lỗi: ' + (r.error || ''));
        refreshRollReadout();
      }
    }));
    var presetName = el('input', { type: 'text', placeholder: 'Tên preset riêng...' });
    presetName.style.width = '140px';
    row3.appendChild(presetName);
    row3.appendChild(el('button', {
      class: 'btn sm', text: 'Lưu preset', onclick: function () {
        var r = saveCustomPreset(presetName.value, getTarget());
        twistLine.textContent = r.ok ? ('Đã lưu preset "' + r.name + '" (' + r.bones + ' xương có roll ≠ 0).') : ('Lỗi: ' + (r.error || ''));
        notify(r.ok ? 'ok' : 'error', 'Roll preset', twistLine.textContent);
      }
    }));
    wrap.appendChild(row3);
    wrap.appendChild(el('div', {
      html: 'Preset Mixamo chuẩn = roll 0° mọi xương (roll nằm sẵn trong local frame của xương Mixamo, không lưu riêng). Ngưỡng cảnh báo xoắn mặc định 30°.',
      style: { fontSize: '12px', color: '#555', marginTop: '4px' }
    }));
    container.appendChild(wrap);
    refreshBoneList();
  }
  try {
    var QR = PS.ArpQuickRig;
    if (QR && typeof QR.registerSection === 'function') QR.registerSection('roll', renderRollSection);
  } catch (e) {}
  Roll.renderSection = renderRollSection;
  Roll.getTarget = getTarget;
  Roll.stripName = stripName;

  Roll._test = {
    stripName: stripName,
    findBone: findBone,
    collectBones: collectBones,
    resolveBone: resolveBone,
    ensureBase: ensureBase
  };

  PS.ArpRoll = Roll;
})();
