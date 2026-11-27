/* ============================================================
 * rig/arp-vp-ik.js — HIỂN THỊ IK TRONG VIEWPORT (Auto Rig Pro
 * Blend, vòng mở rộng Viewport — PHẦN 3)
 *
 * Vẽ rõ IK chain của control rig Quick Rig ngay trong viewport:
 *   • Đường nối root→mid→end cho 4 chi (tay: Shoulder/Arm→Elbow/
 *     ForeArm→Wrist/Hand; chân: Hips/UpLeg→Knee/Leg→Ankle/Foot),
 *     cập nhật theo tư thế hiện tại của skeleton.
 *   • IK target: khối octahedron lớn hơn khớp thường, màu theo chi
 *     (trái xanh dương, phải đỏ — thống nhất màu gizmo Blender
 *     trong arp-qr3-gizmo.js).
 *   • Pole target: hình thoi (diamond = octahedron nhỏ) màu hồng
 *     riêng + đường nối tới khuỷu/gối.
 *   • Màu IK vs FK khác nhau rõ: chi ở chế độ IK = màu chi sáng/đậm,
 *     chi ở chế độ FK = màu xám mờ. Đọc trạng thái từ
 *     QuickRig.current.limbModes (+ blend IK/FK của AdvIK nếu có:
 *     blend 0..1 nội suy màu xám→màu chi).
 *   • Kéo IK target (qua gizmo có sẵn) → chain + đường nối cập nhật
 *     theo thời gian thực: app loop gọi update(dt) mỗi frame, hoặc
 *     hook vào sự kiện thay đổi control (xem bên dưới).
 *   • Mặc định sau khi rig + Auto Gen Quick Rig: IK HIỆN NGAY cùng
 *     skeleton — lắng nghe 'arpquickrig:converted' và
 *     'arpquickrig:autogen-done' (event THẬT của Quick Rig) + cả
 *     'arp:rig-complete' (event phần 1 / coordinator phát khi rig
 *     xong, nếu có) rồi tự build + show.
 *
 * CHỈ ĐỌC + GỌI API public của Quick Rig / AdvIK / Gizmo — KHÔNG
 * sửa solver IK (arp-qr3-advik.js), KHÔNG sửa arp-quickrig.js,
 * KHÔNG bind lại skin, KHÔNG đổi pose. Layer này là hiển thị thuần:
 * group '__arp_vp_ik__' con của model target, transform identity
 * nên mọi tọa độ vẽ = tọa độ local của target.
 *
 * Đăng ký layer vào registry chung (defensive): nếu
 * window.PixiStudio.ArpViewport tồn tại và có registerLayer thì gọi
 * ArpViewport.registerLayer('ik', {show, hide, isVisible, label}).
 * Nếu chưa có thì expose API PixiStudio.ArpVpIk.show()/hide()/
 * isVisible()/update() để toolbar/preset/coordinator gọi.
 * App loop gọi ArpVpIk.update(dt) mỗi frame (coordinator thêm dòng
 * này vào app.js — module KHÔNG tự sửa app.js/index.html).
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Chỉ vẽ 4 chi 2-bone của Quick Rig (LIMBS) — không vẽ ngón tay,
 *     spine hay xương mặt (phần skeleton thuộc phần 1).
 *   • Mức Nhanh của Auto Gen không sinh pole → chi đó không có
 *     diamond pole / đường pole (chain + IK target vẫn vẽ đủ).
 *   • LineBasicMaterial không điều khiển được độ dày đường (giới hạn
 *     WebGL) — chain vẽ bằng line mảnh + sphere nhỏ ở mỗi khớp để
 *     vẫn thấy rõ; IK target / pole dùng khối đặc để nổi bật.
 *   • Màu FK xám là quy ước hiển thị của layer này, không đổi màu
 *     sphere control gốc của Quick Rig (gizmo giữ màu của nó).
 *   • update() phải được gọi (app loop hoặc thủ công) thì chain mới
 *     theo kịp pose — module tự gọi update() khi nhận event rig /
 *     limb-mode / drag-end, còn kéo gizmo liên tục thì nhờ app loop.
 * ============================================================ */
(function () {
  'use strict';

  var PS = window.PixiStudio || (window.PixiStudio = {});

  function getQR() { return (window.PixiStudio && window.PixiStudio.ArpQuickRig) || null; }
  function getRig() { var QR = getQR(); return QR ? QR.current : null; }
  function bus() { return (window.PixiStudio && window.PixiStudio.bus) || null; }
  function emit(ev, data) {
    try { var b = bus(); if (b && typeof b.emit === 'function') b.emit(ev, data); } catch (e) {}
  }
  /* FIX2: phản hồi NHÌN THẤY ĐƯỢC khi IK không hiện được vì chưa có
     control rig — trước đây show() chỉ trả {ok:false} và registry
     chỉ ghi console.warn, user bấm nút IK không thấy gì xảy ra.
     Nay: toast warning (kèm nút "Mở tab Quick Rig" nhảy thẳng sang
     tab Quick Rig để Convert/Auto Gen) + bus event
     'arp:vp-ik-needs-rig'. Chống spam: tối đa 1 toast / 15s
     (show() còn được gọi bởi preset Full / khôi phục trạng thái). */
  var _lastNoRigNotify = 0;
  function notifyNoRig() {
    var now = Date.now();
    if (now - _lastNoRigNotify < 15000) return false;
    _lastNoRigNotify = now;
    try {
      var b = bus();
      if (b && typeof b.emit === 'function') {
        b.emit('notify', {
          type: 'warning', title: 'IK chưa hiện được',
          message: 'Chưa có control rig — mở tab Quick Rig, bấm Convert hoặc Auto Gen cho model đã rig rồi bật lại IK.',
          duration: 9000,
          actions: [{
            label: 'Mở tab Quick Rig',
            onClick: function () {
              try {
                var P = window.PixiStudio && window.PixiStudio.ArpPanel;
                if (P && typeof P.open === 'function') P.open('quickrig');
              } catch (e) {}
            }
          }]
        });
        b.emit('arp:vp-ik-needs-rig', { reason: 'no-control-rig' });
      }
    } catch (e) {}
    return true;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------- màu chuẩn — thống nhất gizmo (arp-qr3-gizmo.js) ---------- */
  var COLOR_LEFT = 0x3388ff;   /* trái  = xanh dương */
  var COLOR_RIGHT = 0xff3344;  /* phải = đỏ */
  var COLOR_CENTER = 0x33cc66; /* giữa = xanh lá (dự phòng) */
  var COLOR_POLE = 0xff5599;   /* pole = hồng (đúng màu sphere pole gốc) */
  var COLOR_FK = 0x8a8a8a;     /* FK = xám mờ */
  var OPACITY_IK_LINE = 0.95;
  var OPACITY_FK_LINE = 0.4;
  var OPACITY_IK_MARKER = 0.95;
  var OPACITY_FK_MARKER = 0.45;

  /* Chuỗi 2-bone IK — đồng bộ QuickRig.LIMBS; fallback cứng khi QR
     chưa load (module vẫn expose được màu / API, chỉ chưa build). */
  var LIMBS_FALLBACK = {
    LeftArm: { root: 'LeftArm', mid: 'LeftForeArm', end: 'LeftHand', kind: 'arm' },
    RightArm: { root: 'RightArm', mid: 'RightForeArm', end: 'RightHand', kind: 'arm' },
    LeftLeg: { root: 'LeftUpLeg', mid: 'LeftLeg', end: 'LeftFoot', kind: 'leg' },
    RightLeg: { root: 'RightUpLeg', mid: 'RightLeg', end: 'RightFoot', kind: 'leg' }
  };
  var LIMB_KEYS = ['LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'];

  function limbsDef() {
    var QR = getQR();
    if (QR && QR.LIMBS) return QR.LIMBS;
    return LIMBS_FALLBACK;
  }

  /* Màu theo bên (trái/phải), thống nhất gizmo. */
  function colorFor(limbKey) {
    if (/^Left/i.test(String(limbKey || ''))) return COLOR_LEFT;
    if (/^Right/i.test(String(limbKey || ''))) return COLOR_RIGHT;
    return COLOR_CENTER;
  }
  function isLeft(limbKey) { return /^Left/i.test(String(limbKey || '')); }

  var state = {
    visible: true,        /* user muốn hiện (mặc định hiện sau khi rig) */
    builtFor: null,       /* rig target đã build group cho */
    builtSig: null,       /* chữ ký rig (pole/control) của lần build gần nhất */
    group: null,          /* THREE.Group '__arp_vp_ik__' */
    limbs: {},            /* limbKey -> {line, lineMat, joints[], target, targetMat, pole, poleMat, poleLine, poleLineMat} */
    lastModes: {},        /* limbKey -> 'IK'|'FK' (để biết khi nào đổi màu) */
    builtAt: 0
  };

  function worldPosOf(obj) {
    return new window.THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
  }
  /* World -> local của target (group là con trực tiếp của target,
     transform identity nên local của group == local của target). */
  function toLocal(target, worldVec) {
    try { return target.worldToLocal(worldVec.clone()); }
    catch (e) { return worldVec.clone(); }
  }

  function limbMode(limbKey) {
    var cur = getRig();
    if (cur && cur.limbModes && cur.limbModes[limbKey]) return cur.limbModes[limbKey];
    return 'IK';
  }
  /* Blend IK/FK của AdvIK (0..1, 1 = IK hoàn toàn). Không có AdvIK
     hoặc lỗi → coi như 1 khi mode IK, 0 khi mode FK. */
  function limbBlend(limbKey) {
    var mode = limbMode(limbKey);
    if (mode !== 'IK') return 0;
    try {
      var QR = getQR();
      var AdvIK = QR && QR.AdvIK;
      if (AdvIK && typeof AdvIK.getBlend === 'function') {
        var r = AdvIK.getBlend(limbKey);
        if (r && typeof r.t === 'number') return clamp(r.t, 0, 1);
      }
    } catch (e) {}
    return 1;
  }
  /* Hệ số "độ IK" 0..1 của 1 chi: FK = 0, IK = blend (mặc định 1). */
  function ikFactor(limbKey) {
    return limbMode(limbKey) === 'IK' ? limbBlend(limbKey) : 0;
  }

  /* Màu hiển thị của 1 chi: nội suy xám (FK) -> màu chi (IK). */
  function colorForMode(limbKey) {
    var f = ikFactor(limbKey);
    var c = new window.THREE.Color(COLOR_FK);
    c.lerp(new window.THREE.Color(colorFor(limbKey)), f);
    return c;
  }
  function opacityFor(f, ikOp, fkOp) {
    return fkOp + (ikOp - fkOp) * f;
  }

  /* ---------- build / rebuild ---------- */
  function clearGroup() {
    if (!state.group) return;
    try {
      if (state.group.parent) state.group.parent.remove(state.group);
    } catch (e) {}
    /* dispose geometry/material của layer (không đụng control gốc) */
    Object.keys(state.limbs).forEach(function (k) {
      var L = state.limbs[k];
      [L.line, L.poleLine].forEach(function (ln) {
        if (ln && ln.geometry && ln.geometry.dispose) { try { ln.geometry.dispose(); } catch (e) {} }
      });
      L.joints.forEach(function (j) { if (j.geometry && j.geometry.dispose) { try { j.geometry.dispose(); } catch (e) {} } });
      if (L.target && L.target.geometry && L.target.geometry.dispose) { try { L.target.geometry.dispose(); } catch (e) {} }
      if (L.pole && L.pole.geometry && L.pole.geometry.dispose) { try { L.pole.geometry.dispose(); } catch (e) {} }
      [L.lineMat, L.jointMat, L.targetMat, L.poleMat, L.poleLineMat].forEach(function (m) {
        if (m && m.dispose) { try { m.dispose(); } catch (e) {} }
      });
    });
    state.group = null;
    state.limbs = {};
    state.builtFor = null;
    state.builtSig = null;
  }

  function heightOf(cur) {
    if (cur && typeof cur.height === 'number' && cur.height > 0.01) return cur.height;
    return 1.8;
  }

  /* Chữ ký rig: đổi khi đổi model, đổi số pole (Nhanh 0 pole /
     Đầy đủ 4 pole) hay đổi số control → build() phải build lại
     thay vì tái dùng group cũ (tránh pole cũ còn hiện sai). */
  function rigSig(cur) {
    if (!cur || !cur.target) return null;
    var poles = cur.poles ? Object.keys(cur.poles).sort().join(',') : '';
    var ctrls = cur.controls ? Object.keys(cur.controls).length : 0;
    return cur.target.uuid + '|' + poles + '|' + ctrls;
  }

  /* Build group hiển thị cho rig hiện tại. Trả {ok, limbs, poles, ...}. */
  function build() {
    var cur = getRig();
    if (!cur || !cur.target || !window.THREE) {
      return { ok: false, error: 'Chưa có control rig — convert/auto-gen một model đã rig trước.' };
    }
    if (state.builtFor === cur.target && state.group && state.builtSig === rigSig(cur)) return { ok: true, rebuilt: false, limbs: Object.keys(state.limbs).length };
    clearGroup();
    var T = window.THREE;
    var H = heightOf(cur);
    var rJoint = Math.max(0.012, H * 0.012);   /* sphere khớp: nhỏ hơn sphere control gốc (H*0.018) */
    var rTarget = Math.max(0.02, H * 0.032);   /* IK target: TO hơn khớp thường, dễ thấy */
    var rPole = Math.max(0.016, H * 0.024);    /* diamond pole */
    var group = new T.Group();
    group.name = '__arp_vp_ik__';
    group.renderOrder = 999;
    var defs = limbsDef();
    var built = 0, poles = 0, skipped = [];
    LIMB_KEYS.forEach(function (limbKey) {
      var def = defs[limbKey];
      if (!def) { skipped.push(limbKey + ':không có định nghĩa limb'); return; }
      var rootBone = cur.bones[def.root], midBone = cur.bones[def.mid], endBone = cur.bones[def.end];
      if (!rootBone || !midBone || !endBone) { skipped.push(limbKey + ':thiếu xương'); return; }
      var sideColor = colorFor(limbKey);
      /* --- đường chain root->mid->end --- */
      var lineMat = new T.LineBasicMaterial({ color: sideColor, transparent: true, opacity: OPACITY_IK_LINE, depthTest: false });
      var lineGeo = new T.BufferGeometry();
      lineGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(9), 3));
      var line = new T.Line(lineGeo, lineMat);
      line.name = '__arp_vp_ik_line_' + limbKey;
      line.userData.isBoneVisual = true; /* không nướng vào FBX/GLB export */
      line.renderOrder = 999;
      line.frustumCulled = false;
      group.add(line);
      /* --- sphere nhỏ ở mỗi khớp của chain --- */
      var jointMat = new T.MeshBasicMaterial({ color: sideColor, transparent: true, opacity: OPACITY_IK_MARKER, depthTest: false });
      var joints = [];
      for (var j = 0; j < 3; j++) {
        var jm = new T.Mesh(new T.SphereGeometry(rJoint, 10, 8), jointMat);
        jm.name = '__arp_vp_ik_joint_' + limbKey + '_' + j;
        jm.renderOrder = 999;
        jm.userData.isArpVpIk = true;
        jm.userData.isBoneVisual = true; /* không nướng vào FBX/GLB export */
        jm.userData.limb = limbKey;
        group.add(jm);
        joints.push(jm);
      }
      /* --- IK target: octahedron lớn, màu chi --- */
      var targetMat = new T.MeshBasicMaterial({ color: sideColor, transparent: true, opacity: OPACITY_IK_MARKER, depthTest: false });
      var targetMesh = new T.Mesh(new T.OctahedronGeometry(rTarget), targetMat);
      targetMesh.name = '__arp_vp_ik_target_' + limbKey;
      targetMesh.renderOrder = 1000;
      targetMesh.userData.isArpVpIk = true;
      targetMesh.userData.isBoneVisual = true; /* không nướng vào FBX/GLB export */
      targetMesh.userData.limb = limbKey;
      targetMesh.userData.isIkTarget = true;
      group.add(targetMesh);
      /* --- pole: diamond (octahedron nhỏ) màu hồng + đường tới mid --- */
      var poleMesh = null, poleLine = null, poleLineMat = null, poleMat = null;
      if (cur.poles && cur.poles[limbKey]) {
        poleMat = new T.MeshBasicMaterial({ color: COLOR_POLE, transparent: true, opacity: OPACITY_IK_MARKER, depthTest: false });
        poleMesh = new T.Mesh(new T.OctahedronGeometry(rPole), poleMat);
        poleMesh.name = '__arp_vp_ik_pole_' + limbKey;
        poleMesh.renderOrder = 1000;
        poleMesh.userData.isArpVpIk = true;
        poleMesh.userData.isBoneVisual = true; /* không nướng vào FBX/GLB export */
        poleMesh.userData.limb = limbKey;
        poleMesh.userData.isPole = true;
        group.add(poleMesh);
        poleLineMat = new T.LineBasicMaterial({ color: COLOR_POLE, transparent: true, opacity: 0.8, depthTest: false });
        var poleGeo = new T.BufferGeometry();
        poleGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
        poleLine = new T.Line(poleGeo, poleLineMat);
        poleLine.name = '__arp_vp_ik_poleline_' + limbKey;
        poleLine.userData.isBoneVisual = true; /* không nướng vào FBX/GLB export */
        poleLine.renderOrder = 999;
        poleLine.frustumCulled = false;
        group.add(poleLine);
        poles++;
      }
      state.limbs[limbKey] = {
        def: def, line: line, lineMat: lineMat, joints: joints, jointMat: jointMat,
        target: targetMesh, targetMat: targetMat,
        pole: poleMesh, poleMat: poleMat, poleLine: poleLine, poleLineMat: poleLineMat
      };
      built++;
    });
    cur.target.add(group);
    group.visible = state.visible;
    state.group = group;
    state.builtFor = cur.target;
    state.builtSig = rigSig(cur);
    state.builtAt = Date.now();
    cur.target.updateMatrixWorld(true);
    var res = update(0);
    res.ok = built > 0;
    res.rebuilt = true;
    res.limbs = built;
    res.poles = poles;
    res.skipped = skipped;
    res.height = H;
    if (!built) res.error = 'Không build được chi nào: ' + skipped.join('; ');
    return res;
  }

  /* ---------- update mỗi frame ---------- */
  function update(dt) {
    var cur = getRig();
    if (!cur || !cur.target) {
      /* rig đã gỡ: ẩn group cũ khỏi viewport, không crash */
      if (state.group) state.group.visible = false;
      return { ok: false, error: 'Chưa có control rig.', updated: 0 };
    }
    if (!state.group || state.builtFor !== cur.target || state.builtSig !== rigSig(cur)) {
      var b = build();
      if (!b.ok) return b;
      return b;
    }
    cur.target.updateMatrixWorld(true);
    var defs = limbsDef();
    var updated = 0, modes = {};
    LIMB_KEYS.forEach(function (limbKey) {
      var L = state.limbs[limbKey];
      if (!L) return;
      var def = L.def || defs[limbKey];
      var rootBone = cur.bones[def.root], midBone = cur.bones[def.mid], endBone = cur.bones[def.end];
      if (!rootBone || !midBone || !endBone) return;
      /* vị trí world -> local của target */
      var pRoot = toLocal(cur.target, worldPosOf(rootBone));
      var pMid = toLocal(cur.target, worldPosOf(midBone));
      var pEnd = toLocal(cur.target, worldPosOf(endBone));
      /* chain line + khớp */
      var pos = L.line.geometry.attributes.position;
      pos.array[0] = pRoot.x; pos.array[1] = pRoot.y; pos.array[2] = pRoot.z;
      pos.array[3] = pMid.x; pos.array[4] = pMid.y; pos.array[5] = pMid.z;
      pos.array[6] = pEnd.x; pos.array[7] = pEnd.y; pos.array[8] = pEnd.z;
      pos.needsUpdate = true;
      try { L.line.computeBoundingSphere(); } catch (e) {}
      L.joints[0].position.copy(pRoot);
      L.joints[1].position.copy(pMid);
      L.joints[2].position.copy(pEnd);
      /* IK target: tại vị trí control cuối chi (nếu có), fallback xương cuối */
      var ctrl = cur.controls && cur.controls[def.end];
      if (ctrl) {
        try { L.target.position.copy(toLocal(cur.target, worldPosOf(ctrl))); }
        catch (e) { L.target.position.copy(pEnd); }
      } else {
        L.target.position.copy(pEnd);
      }
      /* pole diamond + đường pole -> mid (khuỷu/gối) */
      if (L.pole && cur.poles && cur.poles[limbKey]) {
        var pPole = toLocal(cur.target, worldPosOf(cur.poles[limbKey]));
        L.pole.position.copy(pPole);
        var pp = L.poleLine.geometry.attributes.position;
        pp.array[0] = pPole.x; pp.array[1] = pPole.y; pp.array[2] = pPole.z;
        pp.array[3] = pMid.x; pp.array[4] = pMid.y; pp.array[5] = pMid.z;
        pp.needsUpdate = true;
        try { L.poleLine.computeBoundingSphere(); } catch (e) {}
      }
      /* màu theo IK/FK (+ blend AdvIK): áp mỗi frame, rẻ (4 chi) */
      var f = ikFactor(limbKey);
      var col = colorForMode(limbKey);
      var lineOp = opacityFor(f, OPACITY_IK_LINE, OPACITY_FK_LINE);
      var mkOp = opacityFor(f, OPACITY_IK_MARKER, OPACITY_FK_MARKER);
      try {
        L.lineMat.color.copy(col); L.lineMat.opacity = lineOp;
        L.jointMat.color.copy(col); L.jointMat.opacity = mkOp;
        L.targetMat.color.copy(col); L.targetMat.opacity = mkOp;
        /* pole giữ màu hồng riêng, chỉ mờ đi khi chi ở FK */
        if (L.poleMat) L.poleMat.opacity = mkOp;
        if (L.poleLineMat) L.poleLineMat.opacity = opacityFor(f, 0.8, 0.35);
      } catch (e) {}
      modes[limbKey] = limbMode(limbKey);
      state.lastModes[limbKey] = modes[limbKey];
      updated++;
    });
    if (state.group) state.group.visible = state.visible;
    return { ok: true, updated: updated, modes: modes, visible: state.visible };
  }

  /* ---------- show / hide / trạng thái ---------- */
  function show() {
    state.visible = true;
    var cur = getRig();
    if (!cur || !cur.target) {
      notifyNoRig(); /* FIX2: báo rõ + nút nhảy sang Quick Rig, không chỉ console.warn */
      return { ok: false, error: 'Chưa có control rig để hiện IK.', visible: true };
    }
    var b = build();
    if (state.group) state.group.visible = true;
    var r = update(0);
    r.ok = b.ok && r.ok;
    r.visible = true;
    r.limbs = b.limbs !== undefined ? b.limbs : r.updated;
    r.poles = b.poles;
    return r;
  }
  function hide() {
    state.visible = false;
    if (state.group) state.group.visible = false;
    return { ok: true, visible: false };
  }
  function isVisible() {
    if (!state.visible) return false;
    if (!state.group) return false;
    return !!state.group.visible;
  }
  function getState() {
    var cur = getRig();
    var limbs = {};
    LIMB_KEYS.forEach(function (k) {
      limbs[k] = {
        mode: limbMode(k), blend: limbBlend(k), ikFactor: ikFactor(k),
        hasPole: !!(cur && cur.poles && cur.poles[k]),
        drawn: !!state.limbs[k]
      };
    });
    return {
      visible: state.visible, isVisible: isVisible(),
      hasRig: !!cur, builtForCurrentRig: !!state.group && state.builtFor === (cur && cur.target),
      limbsDrawn: Object.keys(state.limbs).length,
      polesDrawn: Object.keys(state.limbs).filter(function (k) { return !!state.limbs[k].pole; }).length,
      limbs: limbs
    };
  }
  /* Thông tin 1 chi (vị trí world) — để debug / toolbar đọc. */
  function getLimbInfo(limbKey) {
    var cur = getRig();
    var defs = limbsDef();
    var def = defs[limbKey];
    if (!cur || !def) return { ok: false, error: 'Không có rig hoặc chi không hợp lệ: ' + limbKey };
    cur.target.updateMatrixWorld(true);
    var w = function (b) {
      if (!b) return null;
      var p = worldPosOf(b);
      return [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)];
    };
    var ctrl = cur.controls && cur.controls[def.end];
    var pole = cur.poles && cur.poles[limbKey];
    return {
      ok: true, limb: limbKey, kind: def.kind, mode: limbMode(limbKey),
      blend: limbBlend(limbKey), ikFactor: ikFactor(limbKey),
      root: w(cur.bones[def.root]), mid: w(cur.bones[def.mid]), end: w(cur.bones[def.end]),
      target: ctrl ? w(ctrl) : null,
      pole: pole ? w(pole) : null,
      drawn: !!state.limbs[limbKey]
    };
  }

  function dispose() {
    clearGroup();
    state.visible = false;
    return { ok: true };
  }

  /* ---------- UI section nhỏ cho tab Quick Rig (defensive) ---------- */
  function renderSection(container) {
    if (!container || typeof document === 'undefined') return { ok: false, error: 'Không có container.' };
    try { container.innerHTML = ''; } catch (e) {}
    var wrap = document.createElement('div');
    wrap.style.margin = '8px 0';
    var title = document.createElement('div');
    title.innerHTML = '<b>Viewport IK</b> — chain + IK target + pole trong viewport (màu trái xanh · phải đỏ · pole hồng · FK xám mờ).';
    wrap.appendChild(title);
    var cur = getRig();
    if (!cur) {
      var note = document.createElement('div');
      note.style.color = '#a33';
      note.textContent = 'Chưa có control rig — chạy Auto Gen / Convert trong tab Quick Rig trước, rồi quay lại đây.';
      wrap.appendChild(note);
      container.appendChild(wrap);
      return { ok: true, hasRig: false };
    }
    var row = document.createElement('div');
    row.style.display = 'flex'; row.style.gap = '6px'; row.style.alignItems = 'center'; row.style.margin = '6px 0'; row.style.flexWrap = 'wrap';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.visible;
    cb.setAttribute('data-vpik-visible', 'toggle');
    cb.addEventListener('change', function () {
      if (cb.checked) show(); else hide();
      refreshModes();
    });
    var lab = document.createElement('label');
    lab.style.fontSize = '13px';
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(' Hiện IK trong viewport'));
    row.appendChild(lab);
    var updBtn = document.createElement('button');
    updBtn.className = 'btn sm';
    updBtn.textContent = 'Cập nhật ngay';
    updBtn.addEventListener('click', function () { update(0); refreshModes(); });
    row.appendChild(updBtn);
    wrap.appendChild(row);
    var modesEl = document.createElement('div');
    modesEl.style.fontSize = '12px';
    modesEl.setAttribute('data-vpik-modes', 'list');
    wrap.appendChild(modesEl);
    var refreshModes = function () {
      var st = getState();
      var parts = LIMB_KEYS.map(function (k) {
        var L = st.limbs[k];
        return k + ': ' + L.mode + (L.mode === 'IK' && L.blend < 1 ? ' blend ' + Math.round(L.blend * 100) + '%' : '') + (L.hasPole ? '' : ' (không pole)');
      });
      modesEl.textContent = parts.join(' · ') + ' — đang vẽ ' + st.limbsDrawn + ' chain, ' + st.polesDrawn + ' pole.';
    };
    refreshModes();
    container.appendChild(wrap);
    return { ok: true, hasRig: true };
  }

  /* ---------- tự hiện sau khi rig xong ---------- */
  function onRigReady() {
    /* rig mới → hiện ngay (mặc định của layer là visible=true) */
    state.visible = true;
    try { show(); } catch (e) {}
  }
  function onControlChanged() {
    /* kéo gizmo / đổi mode / blend xong → vẽ lại ngay 1 frame */
    try { update(0); } catch (e) {}
  }
  try {
    var b = bus();
    if (b && typeof b.on === 'function') {
      b.on('arpquickrig:converted', onRigReady);
      b.on('arpquickrig:autogen-done', onRigReady);
      b.on('arp:rig-complete', onRigReady);
      b.on('arpquickrig:limb-mode', onControlChanged);
      b.on('arpqr3gizmo:drag-end', onControlChanged);
      b.on('arpquickrig:advik-blend', onControlChanged);
      b.on('arpquickrig:advik-solve', onControlChanged);
      b.on('arpquickrig:advik-pole', onControlChanged);
    }
  } catch (e) {}

  /* ---------- public API ---------- */
  var ArpVpIk = {
    COLORS: { left: COLOR_LEFT, right: COLOR_RIGHT, center: COLOR_CENTER, pole: COLOR_POLE, fk: COLOR_FK },
    LIMB_KEYS: LIMB_KEYS,
    colorFor: colorFor,
    limbMode: limbMode,
    limbBlend: limbBlend,
    ikFactor: ikFactor,
    colorForMode: colorForMode,
    build: build,
    update: update,
    show: show,
    hide: hide,
    isVisible: isVisible,
    getState: getState,
    getLimbInfo: getLimbInfo,
    dispose: dispose,
    renderSection: renderSection,
    _test: {
      colorFor: colorFor,
      limbMode: limbMode,
      limbBlend: limbBlend,
      ikFactor: ikFactor,
      colorForMode: colorForMode,
      build: build,
      update: update,
      show: show,
      hide: hide,
      isVisible: isVisible,
      getState: getState,
      getLimbInfo: getLimbInfo,
      state: state,
      notifyNoRig: notifyNoRig
    }
  };

  PS.ArpVpIk = ArpVpIk;

  /* Đăng ký vào registry chung của Viewport (phần 1) nếu đã có. */
  try {
    var AV = window.PixiStudio && window.PixiStudio.ArpViewport;
    if (AV && typeof AV.registerLayer === 'function') {
      AV.registerLayer('ik', { show: show, hide: hide, isVisible: isVisible, label: 'IK' });
    }
  } catch (e) {}

  /* Đăng ký section vào tab Quick Rig nếu hook đã có (như các module QR3). */
  try {
    var QR = getQR();
    if (QR && typeof QR.registerSection === 'function') QR.registerSection('vpik', renderSection);
  } catch (e) {}

  /* Nếu rig đã tồn tại sẵn lúc load (load lại module giữa chừng) → hiện ngay. */
  try { if (getRig()) onRigReady(); } catch (e) {}
})();
