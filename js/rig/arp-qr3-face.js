/* ============================================================
 * rig/arp-qr3-face.js — FACIAL CONTROLS (Auto Rig Pro Blend,
 * vòng mở rộng thứ 3 của Quick Rig — PHẦN 5)
 *
 * Điều khiển mặt cho control rig của Quick Rig:
 *   • detectFaceBones — phát hiện xương mặt theo tên (Jaw/Chin,
 *     mắt trái/phải, lông mày trái/phải, miệng/mép).
 *   • setBlink / setJawOpen / setBrowRaise / setSmile — xoay
 *     trực tiếp xương mặt (FK), giá trị 0..1, idempotent: mỗi
 *     lần set tính lại từ rotation gốc đã snapshot, không cộng
 *     dồn.
 *   • resetFace — trả toàn bộ mặt về 0.
 *   • renderSection — panel slider mặt (chỉ hiện control khi có
 *     xương mặt tương ứng; không có thì báo rõ + disable).
 *
 * QUAN TRỌNG — HÀNH VI ĐÚNG, KHÔNG PHẢI LỖI: rig Mixamo chuẩn
 * 41 xương (kể cả rig Thiếu Lâm do AutoRigPro sinh ra) KHÔNG có
 * xương mặt nào (không Jaw, không Eye, không Brow, không Mouth).
 * Với rig đó detectFaceBones trả hasFace=false, getFaceStatus
 * trả reason 'no-face-bones', panel chỉ hiện thông báo và mọi
 * setter trả {ok:false} mà không throw, không tạo control giả.
 * Muốn dùng panel mặt cần skeleton có xương mặt (xem
 * detectFaceBones — tên được nhận diện ở dưới).
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Chỉ xoay xương mặt có sẵn (FK) — không có shape key,
 *     blendshape, morph target hay driver. Chớp mắt ở đây là
 *     xoay nhẹ xương mắt quanh X (mắt nhìn xuống), không phải
 *     khép mí thật; muốn mí khép thật cần xương mí/blendshape.
 *   • Góc xoay là hằng số thủ công (BLINK_MAX, JAW_MAX, ...),
 *     không đo từ khuôn mặt thật.
 *   • Cười chỉ xoay xương mép miệng nếu có; không có xương
 *     miệng thì nút Cười bị disable kèm giải thích.
 *   • Base rotation được snapshot vào bone.userData ở lần set
 *     đầu tiên; resetFace khôi phục đúng snapshot đó.
 *
 * Tích hợp: coordinator nối tab sau. Lúc load, module thử gọi
 * PixiStudio.ArpQuickRig.registerSection('face', renderSection)
 * trong try/catch nếu hàm đó tồn tại; chạy bình thường cả khi
 * chưa có hook.
 * ============================================================ */
(function () {
  'use strict';

  var QR = (window.PixiStudio && PixiStudio.ArpQuickRig) || null;
  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };
  var U = (window.PixiStudio && PixiStudio.Utils) || null;

  /* Góc xoay tối đa (radian) khi giá trị = 1 */
  var BLINK_MAX = 0.45;  /* mắt xoay quanh X (nhìn xuống) */
  var JAW_MAX = 0.5;     /* khớp hàm xoay quanh X — khớp setJaw của Quick Rig */
  var BROW_MAX = 0.35;   /* lông mày nhướng lên (quanh X, chiều âm) */
  var SMILE_MAX = 0.3;   /* mép miệng kéo lên (quanh Z, đối xứng 2 bên) */

  /* Trạng thái mặt hiện tại của rig đang active (0..1) */
  var faceState = {
    blinkL: 0, blinkR: 0, jawOpen: 0,
    browL: 0, browR: 0, smile: 0
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function notify(type, title, message, duration) {
    try { bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 }); } catch (e) {}
  }

  /* ---------- Tên xương ---------- */
  function stripName(name) {
    /* Dùng stripName của Quick Rig nếu có (bóc Model: + mixamorig:
       + __proxy), không thì regex tương đương. */
    if (QR && typeof QR.stripName === 'function') return QR.stripName(name);
    var s = String(name == null ? '' : name);
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    s = s.replace(/__proxy$/i, '');
    return s;
  }
  /* Chuẩn hóa để so khớp: bỏ prefix, thường hóa, bỏ mọi ký tự
     không phải chữ/số (gạch dưới, gạch ngang, khoảng trắng). */
  function normName(name) {
    return stripName(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /* ---------- Thu thập xương từ nhiều dạng đầu vào ---------- */
  function collectBones(input) {
    var out = [];
    if (!input) {
      if (QR && QR.current) input = QR.current;
      else return out;
    }
    if (Array.isArray(input)) {
      return input.filter(function (b) { return b && b.isBone; });
    }
    if (input.isBone) return [input];
    if (input.allBones && Array.isArray(input.allBones)) {
      return input.allBones.filter(function (b) { return b && b.isBone; });
    }
    if (input.bones && Array.isArray(input.bones)) {
      return input.bones.filter(function (b) { return b && b.isBone; });
    }
    if (input.bones && typeof input.bones === 'object') {
      Object.keys(input.bones).forEach(function (k) {
        var b = input.bones[k];
        if (b && b.isBone && out.indexOf(b) < 0) out.push(b);
      });
      if (out.length) return out;
    }
    if (typeof input.traverse === 'function') {
      input.traverse(function (o) { if (o && o.isBone) out.push(o); });
      return out;
    }
    return out;
  }

  /* ---------- 1. Phát hiện xương mặt ---------- */
  /* Tên được nhận diện (sau normName):
   *   jaw: jaw, chin, lowerjaw, mandible, jawbone
   *   mắt trái: lefteye, eyel, eyeleft, leye
   *   mắt phải: righteye, eyer, eyeright, reye
   *   lông mày trái: leftbrow, left eyebrow, browl, lefteyebrow
   *   lông mày phải: tương tự bên phải
   *   miệng: mouth (chung), leftmouth/mouthl, rightmouth/mouthr
   * Ưu tiên khớp chính xác trước, khớp chứa sau (vd 'lefteye' chứa
   * 'eye' nhưng phải phân biệt trái/phải nên kiểm tra side trước). */
  var FACE_PATTERNS = {
    jaw: ['jaw', 'chin', 'lowerjaw', 'mandible', 'jawbone'],
    leftEye: ['lefteye', 'eyel', 'eyeleft', 'leye'],
    rightEye: ['righteye', 'eyer', 'eyeright', 'reye'],
    leftBrow: ['leftbrow', 'lefteyebrow', 'browl', 'leftbrowbone'],
    rightBrow: ['rightbrow', 'righteyebrow', 'browr', 'rightbrowbone'],
    leftMouth: ['leftmouth', 'mouthl', 'leftmouthcorner'],
    rightMouth: ['rightmouth', 'mouthr', 'rightmouthcorner'],
    mouth: ['mouth', 'mouthcorner', 'lip', 'lips']
  };

  function matchOne(bones, keys) {
    for (var k = 0; k < keys.length; k++) {
      for (var i = 0; i < bones.length; i++) {
        if (normName(bones[i].name) === keys[k]) return bones[i];
      }
    }
    /* Khớp chứa: vd 'leftupperlid' không khớp, nhưng 'jawjoint'
       chứa 'jaw' thì nhận. Chỉ áp dụng cho jaw/mouth để tránh
       nhầm mắt trái/phải. */
    for (var j = 0; j < keys.length; j++) {
      for (var m = 0; m < bones.length; m++) {
        var n = normName(bones[m].name);
        if (keys[j].length >= 3 && n.indexOf(keys[j]) >= 0) return bones[m];
      }
    }
    return null;
  }

  function detectFaceBones(input) {
    var bones = collectBones(input);
    var jaw = matchOne(bones, FACE_PATTERNS.jaw);
    var leftEye = matchOne(bones, FACE_PATTERNS.leftEye);
    var rightEye = matchOne(bones, FACE_PATTERNS.rightEye);
    var leftBrow = matchOne(bones, FACE_PATTERNS.leftBrow);
    var rightBrow = matchOne(bones, FACE_PATTERNS.rightBrow);
    var mouth = matchOne(bones, FACE_PATTERNS.mouth);
    /* Miệng chung (Mouth) dùng cho cả 2 bên nếu không có mép riêng. */
    var leftMouth = matchOne(bones, FACE_PATTERNS.leftMouth) || mouth;
    var rightMouth = matchOne(bones, FACE_PATTERNS.rightMouth) || mouth;
    var found = [jaw, leftEye, rightEye, leftBrow, rightBrow, leftMouth, rightMouth]
      .filter(function (b) { return !!b; });
    var missing = [];
    if (!jaw) missing.push('Jaw');
    if (!leftEye) missing.push('LeftEye');
    if (!rightEye) missing.push('RightEye');
    if (!leftBrow) missing.push('LeftEyebrow');
    if (!rightBrow) missing.push('RightEyebrow');
    if (!leftMouth && !rightMouth) missing.push('Mouth');
    return {
      jaw: jaw, leftEye: leftEye, rightEye: rightEye,
      leftBrow: leftBrow, rightBrow: rightBrow,
      leftMouth: leftMouth, rightMouth: rightMouth,
      mouth: mouth,
      hasFace: found.length > 0,
      foundCount: found.length,
      missing: missing,
      totalBones: bones.length
    };
  }

  /* ---------- Trạng thái mặt ---------- */
  function getFaceStatus(input) {
    var det = detectFaceBones(input === undefined ? null : input);
    if (!det.hasFace) {
      return {
        ok: false, hasFace: false, reason: 'no-face-bones',
        message: 'Rig này không có xương mặt (không có Jaw, mắt, lông mày hay miệng). Panel mặt bị tắt — đây là bình thường với rig Mixamo chuẩn 41 xương.',
        detected: det
      };
    }
    return {
      ok: true, hasFace: true, reason: null,
      message: 'Đã phát hiện ' + det.foundCount + ' xương mặt.' + (det.missing.length ? ' Thiếu: ' + det.missing.join(', ') + '.' : ''),
      detected: det,
      state: {
        blinkL: faceState.blinkL, blinkR: faceState.blinkR,
        jawOpen: faceState.jawOpen, browL: faceState.browL,
        browR: faceState.browR, smile: faceState.smile
      }
    };
  }

  /* ---------- Snapshot base rotation (idempotent) ---------- */
  function baseRot(bone) {
    if (!bone) return null;
    bone.userData = bone.userData || {};
    if (!bone.userData.__arp_face_base) {
      bone.userData.__arp_face_base = { x: bone.rotation.x, y: bone.rotation.y, z: bone.rotation.z };
    }
    return bone.userData.__arp_face_base;
  }
  function applyRot(bone, dx, dy, dz) {
    if (!bone) return false;
    var b = baseRot(bone);
    bone.rotation.x = b.x + (dx || 0);
    bone.rotation.y = b.y + (dy || 0);
    bone.rotation.z = b.z + (dz || 0);
    return true;
  }
  function updateWorld() {
    try {
      if (QR && QR.current && QR.current.target) QR.current.target.updateMatrixWorld(true);
    } catch (e) {}
  }
  function noRig() { return { ok: false, reason: 'no-rig', message: 'Chưa có control rig Quick Rig đang active.' }; }
  function noBone(which) {
    return { ok: false, reason: 'no-face-bone', message: 'Rig này không có xương ' + which + ' nên không áp được.' };
  }

  /* ---------- 2a. Chớp mắt ---------- */
  function setBlink(v, side) {
    if (!QR || !QR.current) return noRig();
    v = clamp(Number(v) || 0, 0, 1);
    var det = detectFaceBones(QR.current);
    var applied = [];
    var wantL = !side || side === 'left' || side === 'both' || side === 'all';
    var wantR = !side || side === 'right' || side === 'both' || side === 'all';
    if (wantL) {
      if (!det.leftEye) return noBone('mắt trái (LeftEye)');
      applyRot(det.leftEye, BLINK_MAX * v, 0, 0);
      faceState.blinkL = v;
      applied.push(det.leftEye.name);
    }
    if (wantR) {
      if (!det.rightEye) return noBone('mắt phải (RightEye)');
      applyRot(det.rightEye, BLINK_MAX * v, 0, 0);
      faceState.blinkR = v;
      applied.push(det.rightEye.name);
    }
    updateWorld();
    return { ok: true, applied: applied, value: v, side: side || 'both' };
  }

  /* ---------- 2b. Mở hàm ---------- */
  function setJawOpen(v) {
    if (!QR || !QR.current) return noRig();
    v = clamp(Number(v) || 0, 0, 1);
    var det = detectFaceBones(QR.current);
    if (!det.jaw) return noBone('hàm (Jaw)');
    /* Snapshot base TRƯỚC khi ủy quyền, để resetFace khôi phục được
       (setJaw của Quick Rig xoay trực tiếp, không qua applyRot). */
    baseRot(det.jaw);
    /* Ưu tiên setJaw của Quick Rig (nó giữ cur.jawOpen đồng bộ). */
    if (typeof QR.setJaw === 'function') {
      var r = QR.setJaw(v);
      if (r && r.ok) {
        faceState.jawOpen = v;
        return { ok: true, applied: [det.jaw.name], value: v, via: 'quickrig-setJaw' };
      }
      /* setJaw từ chối (vd mức Nhanh chặn jaw) → xoay trực tiếp. */
    }
    applyRot(det.jaw, JAW_MAX * v, 0, 0);
    if (QR.current) QR.current.jawOpen = v;
    faceState.jawOpen = v;
    updateWorld();
    return { ok: true, applied: [det.jaw.name], value: v, via: 'direct' };
  }

  /* ---------- 2c. Nhướng mày ---------- */
  function setBrowRaise(v, side) {
    if (!QR || !QR.current) return noRig();
    v = clamp(Number(v) || 0, 0, 1);
    var det = detectFaceBones(QR.current);
    var applied = [];
    var wantL = !side || side === 'left' || side === 'both' || side === 'all';
    var wantR = !side || side === 'right' || side === 'both' || side === 'all';
    if (wantL) {
      if (!det.leftBrow) return noBone('lông mày trái (LeftEyebrow)');
      applyRot(det.leftBrow, -BROW_MAX * v, 0, 0);
      faceState.browL = v;
      applied.push(det.leftBrow.name);
    }
    if (wantR) {
      if (!det.rightBrow) return noBone('lông mày phải (RightEyebrow)');
      applyRot(det.rightBrow, -BROW_MAX * v, 0, 0);
      faceState.browR = v;
      applied.push(det.rightBrow.name);
    }
    updateWorld();
    return { ok: true, applied: applied, value: v, side: side || 'both' };
  }

  /* ---------- 2d. Cười ---------- */
  function setSmile(v) {
    if (!QR || !QR.current) return noRig();
    v = clamp(Number(v) || 0, 0, 1);
    var det = detectFaceBones(QR.current);
    if (!det.leftMouth && !det.rightMouth) {
      return { ok: false, reason: 'no-mouth-bones', message: 'Rig này không có xương miệng/mép (Mouth) nên không cười được.' };
    }
    var applied = [];
    if (det.leftMouth && det.rightMouth && det.leftMouth === det.rightMouth) {
      /* Chỉ có 1 xương Mouth chung: kéo nhẹ quanh Z một lần. */
      applyRot(det.leftMouth, 0, 0, SMILE_MAX * v);
      applied.push(det.leftMouth.name);
    } else {
      if (det.leftMouth) { applyRot(det.leftMouth, 0, 0, SMILE_MAX * v); applied.push(det.leftMouth.name); }
      if (det.rightMouth) { applyRot(det.rightMouth, 0, 0, -SMILE_MAX * v); applied.push(det.rightMouth.name); }
    }
    faceState.smile = v;
    updateWorld();
    return { ok: true, applied: applied, value: v };
  }

  /* ---------- Reset mặt về 0 ---------- */
  function resetFace() {
    if (!QR || !QR.current) return noRig();
    var det = detectFaceBones(QR.current);
    var reset = [];
    var bones = [det.jaw, det.leftEye, det.rightEye, det.leftBrow, det.rightBrow, det.leftMouth, det.rightMouth];
    bones.forEach(function (b) {
      if (!b || reset.indexOf(b.name) >= 0) return;
      var base = b.userData && b.userData.__arp_face_base;
      if (base) {
        b.rotation.x = base.x; b.rotation.y = base.y; b.rotation.z = base.z;
      } else {
        /* Chưa từng set qua module: để nguyên rotation hiện tại. */
      }
      reset.push(b.name);
    });
    faceState.blinkL = 0; faceState.blinkR = 0; faceState.jawOpen = 0;
    faceState.browL = 0; faceState.browR = 0; faceState.smile = 0;
    if (QR.current) QR.current.jawOpen = 0;
    updateWorld();
    return { ok: true, reset: reset, hasFace: det.hasFace };
  }

  /* ---------- 4. UI: renderSection(container) ---------- */
  function mkEl(tag, text, style) {
    var el = document.createElement(tag);
    if (text != null) el.textContent = text;
    if (style) {
      Object.keys(style).forEach(function (k) { el.style[k] = style[k]; });
    }
    return el;
  }
  function mkSlider(label, value, disabled, onInput) {
    var wrap = mkEl('div', null, { margin: '6px 0' });
    var lab = mkEl('label', label + ': ', { fontSize: '12px', color: '#ddd' });
    var val = mkEl('span', Math.round(value * 100) + '%', { fontSize: '12px', color: '#9fd0ff', marginLeft: '4px' });
    var input = document.createElement('input');
    input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.05';
    input.value = String(value);
    input.disabled = !!disabled;
    input.style.width = '100%';
    input.addEventListener('input', function () {
      var v = parseFloat(input.value) || 0;
      val.textContent = Math.round(v * 100) + '%';
      onInput(v);
    });
    wrap.appendChild(lab); wrap.appendChild(val); wrap.appendChild(input);
    return wrap;
  }

  function renderSection(container) {
    if (!container) return;
    var box = mkEl('div', null, { border: '1px solid #444', borderRadius: '6px', padding: '10px', margin: '8px 0', background: '#1c1c22' });
    box.appendChild(mkEl('h4', 'Khuôn mặt (Facial)', { margin: '0 0 6px 0', color: '#fff', fontSize: '14px' }));
    var status = getFaceStatus();
    var det = status.detected;
    if (!status.ok) {
      var note = mkEl('div', status.message, { fontSize: '12px', color: '#f0b429', lineHeight: '1.5' });
      box.appendChild(note);
      var hint = mkEl('div', 'Muốn dùng điều khiển mặt, cần skeleton có xương mặt (Jaw, LeftEye/RightEye, LeftEyebrow/RightEyebrow, Mouth). Rig Mixamo chuẩn 41 xương không có các xương này.', { fontSize: '11px', color: '#999', marginTop: '6px', lineHeight: '1.5' });
      box.appendChild(hint);
      container.appendChild(box);
      return box;
    }
    var foundTxt = 'Xương mặt đã phát hiện: ' +
      [det.jaw && 'Jaw', det.leftEye && 'LeftEye', det.rightEye && 'RightEye',
       det.leftBrow && 'LeftEyebrow', det.rightBrow && 'RightEyebrow',
       det.leftMouth && 'LeftMouth', det.rightMouth && 'RightMouth']
      .filter(Boolean).join(', ') + '.';
    box.appendChild(mkEl('div', foundTxt, { fontSize: '11px', color: '#8f8', marginBottom: '4px' }));
    if (det.missing.length) {
      box.appendChild(mkEl('div', 'Thiếu: ' + det.missing.join(', ') + ' — control tương ứng sẽ bị tắt.', { fontSize: '11px', color: '#f0b429', marginBottom: '4px' }));
    }
    box.appendChild(mkSlider('Chớp mắt trái', faceState.blinkL, !det.leftEye, function (v) { setBlink(v, 'left'); }));
    box.appendChild(mkSlider('Chớp mắt phải', faceState.blinkR, !det.rightEye, function (v) { setBlink(v, 'right'); }));
    box.appendChild(mkSlider('Mở hàm', faceState.jawOpen, !det.jaw, function (v) { setJawOpen(v); }));
    box.appendChild(mkSlider('Nhướng mày trái', faceState.browL, !det.leftBrow, function (v) { setBrowRaise(v, 'left'); }));
    box.appendChild(mkSlider('Nhướng mày phải', faceState.browR, !det.rightBrow, function (v) { setBrowRaise(v, 'right'); }));
    var smileDisabled = !det.leftMouth && !det.rightMouth;
    box.appendChild(mkSlider('Cười', faceState.smile, smileDisabled, function (v) { setSmile(v); }));
    if (smileDisabled) {
      box.appendChild(mkEl('div', 'Nút Cười bị tắt: rig này không có xương miệng/mép (Mouth).', { fontSize: '11px', color: '#f0b429' }));
    }
    var resetBtn = mkEl('button', 'Reset mặt về 0', { marginTop: '8px', padding: '6px 12px', cursor: 'pointer' });
    resetBtn.addEventListener('click', function () {
      resetFace();
      /* Vẽ lại section để slider về 0. */
      var parent = box.parentNode;
      if (parent) { parent.removeChild(box); renderSection(parent); }
      notify('info', 'Facial', 'Đã reset khuôn mặt về 0.');
    });
    box.appendChild(resetBtn);
    container.appendChild(box);
    return box;
  }

  /* ---------- Expose ---------- */
  var Face = {
    detectFaceBones: detectFaceBones,
    getFaceStatus: getFaceStatus,
    setBlink: setBlink,
    setJawOpen: setJawOpen,
    setBrowRaise: setBrowRaise,
    setSmile: setSmile,
    resetFace: resetFace,
    renderSection: renderSection,
    BLINK_MAX: BLINK_MAX,
    JAW_MAX: JAW_MAX,
    BROW_MAX: BROW_MAX,
    SMILE_MAX: SMILE_MAX,
    getState: function () {
      return {
        blinkL: faceState.blinkL, blinkR: faceState.blinkR,
        jawOpen: faceState.jawOpen, browL: faceState.browL,
        browR: faceState.browR, smile: faceState.smile
      };
    },
    _test: {
      detectFaceBones: detectFaceBones,
      stripName: stripName,
      normName: normName,
      collectBones: collectBones
    }
  };

  window.PixiStudio = window.PixiStudio || {};
  if (!window.PixiStudio.ArpQuickRig) window.PixiStudio.ArpQuickRig = {};
  window.PixiStudio.ArpQuickRig.Face = Face;

  /* Đăng ký section vào Quick Rig nếu hook đã có (coordinator thêm
     sau); chạy bình thường cả khi chưa có hook. */
  try {
    if (QR && typeof QR.registerSection === 'function') QR.registerSection('face', renderSection);
  } catch (e) {}
})();
