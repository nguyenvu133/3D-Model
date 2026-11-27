/* ============================================================
 * rig/arp-vp-select.js — PHẦN 4 (vòng mở rộng Viewport):
 * BẤM CHỌN XƯƠNG TRONG VIEWPORT (Auto Rig Pro Blend).
 *
 * - Bấm trực tiếp lên khớp cầu / đoạn xương trong viewport để chọn
 *   xương đó (raycast lên mesh phụ riêng, KHÔNG sửa skeleton/skin).
 * - Xương đang chọn sáng rõ: khớp cầu màu vàng cam + to hơn 1.6x,
 *   đoạn xương cùng màu.
 * - Panel nhỏ nổi trong viewport hiện: tên xương (bỏ prefix
 *   mixamorig:), xương cha, xương con, độ dài, góc xoay hiện tại (°).
 * - Bấm xương khác đổi lựa chọn; bấm chỗ trống bỏ chọn.
 * - Đồng bộ 2 chiều với bảng map xương tab Quick Rig:
 *     viewport -> map: highlight dòng tương ứng trong .arp-map-table
 *     map -> viewport: bấm vào 1 dòng trong bảng map (không bấm vào
 *       dropdown) thì chọn xương đó trong viewport.
 * - Phân biệt bấm vs kéo xoay camera: chỉ chọn khi pointerdown ->
 *   pointerup di chuyển <= ngưỡng (mặc định 8px) và < 600ms; kéo
 *   OrbitCam / pinch 2 ngón / kéo gizmo thì KHÔNG chọn. Mobile:
 *   tap 1 ngón để chọn.
 * - Chưa có rig: bấm chọn không làm gì, không lỗi.
 *
 * KHÔNG phá tính năng hiện có: module chỉ nghe pointer trên khung
 * viewport (bubble phase, không stopPropagation/preventDefault),
 * không tắt OrbitCam, không sửa Interaction/Controls/Gizmo; khi
 * TransformControls đang kéo (tc.dragging hoặc tc.axis) thì bỏ qua.
 * Overlay là group '__arp_vpselect__' đặt trong SCENE (không gắn vào
 * model — như THREE.SkeletonHelper): khớp cầu/đoạn xương được đồng bộ
 * vị trí theo xương mỗi frame (syncOverlay) và ngay trước mỗi lần
 * pick, nên luôn đi theo pose/animation mà KHÔNG chạm vào cây model.
 * Điều này quan trọng: nếu overlay là con của xương, bus
 * 'autorigpro:done' bắn ra giữa ARP.run() (trước bước export FBX)
 * sẽ khiến FBX writer nướng cả 162 mesh overlay vào file export —
 * đã bắt được bằng harness, nên overlay nhất quyết ở scene-level.
 *
 * Expose: window.PixiStudio.ArpVpSelect
 *   select(name) / deselect() / getSelected() / getInfo(name) /
 *   pick(ndcX, ndcY) / pickAtClient(x, y) / buildOverlay(target) /
 *   refreshOverlay() / refreshPanel() / highlightMapRow(dst) /
 *   onSelect(fn) / setEnabled(on) / setClickThreshold(px) / getState()
 *   + bus 'arpvpselect:select' / 'arpvpselect:deselect'.
 * ============================================================ */
(function () {
  'use strict';

  var PS = window.PixiStudio || (window.PixiStudio = {});
  var bus = (PS && PS.bus) || { emit: function () {}, on: function () {} };
  var U = (PS && PS.Utils) || null;

  var COLOR_DEFAULT = 0x4da3ff;  /* khớp/đoạn xương thường: xanh dương */
  var COLOR_SELECTED = 0xffb300; /* xương đang chọn: vàng cam */
  var SELECT_SCALE = 1.6;        /* khớp đang chọn to hơn */
  var PANEL_ID = 'arp-vpselect-panel';
  var GROUP_NAME = '__arp_vpselect__';

  var VpSelect = {
    enabled: true,
    clickThreshold: 8,   /* px: di chuyển quá ngưỡng = kéo, không chọn */
    maxClickMs: 600,     /* ms: bấm giữ quá lâu = không tính là click */
    selected: null,      /* tên xương gọn (đã bóc prefix) đang chọn */
    selectedBone: null,
    boneCount: 0
  };

  var state = {
    target: null,
    group: null,
    entries: {},         /* stripped -> {bone, joint, jointHit, seg, segHit, childName, baseLength, baseJointScale} */
    callbacks: [],
    panelEl: null,
    highlightedRow: null,
    down: null,          /* {x, y, time, pointerId, type, moved} */
    pointers: {},        /* pointerId -> true (đếm ngón đang chạm) */
    pointerCount: 0,
    listeners: null,     /* {wrap, down, move, up, cancel, docClick} */
    prevRender: null,
    renderWrapped: false,
    lastPanelRefresh: 0
  };

  /* ---------------- helpers ---------------- */
  function stripName(name) {
    var QR = PS.ArpQuickRig;
    if (QR && typeof QR.stripName === 'function') {
      try { return QR.stripName(name); } catch (e) {}
    }
    var s = String(name == null ? '' : name);
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    s = s.replace(/__proxy$/i, '');
    return s;
  }
  VpSelect.stripName = stripName;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function rad2deg(r) { return r * 180 / Math.PI; }

  function emit(ev, data) {
    try { if (bus && typeof bus.emit === 'function') bus.emit(ev, data); } catch (e) {}
  }
  function notify(type, title, message) {
    try { emit('notify', { type: type, title: title, message: message }); } catch (e) {}
  }

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
      children.forEach(function (c) { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    }
    return node;
  }

  function getViewport() { return (PS && PS.Viewport) || null; }
  function getCamera() {
    var V = getViewport();
    if (V && V.orbit && V.orbit.camera) return V.orbit.camera;
    return null;
  }
  function isQuadMode() {
    try {
      var V = getViewport();
      if (V && PS.State && typeof PS.State.get === 'function') return PS.State.get('viewMode') === 'quad';
    } catch (e) {}
    return false;
  }
  function getWrap() {
    try {
      if (typeof document === 'undefined') return null;
      return document.getElementById('viewport-canvas-wrap') ||
        document.getElementById('three-canvas') || null;
    } catch (e) { return null; }
  }
  function gizmoBusy() {
    try {
      var tc = PS.Gizmo && PS.Gizmo.transformControls;
      if (tc && (tc.dragging || tc.axis)) return true;
      var GZ = PS.ArpQuickRig && PS.ArpQuickRig.Gizmo;
      if (GZ && GZ._test && GZ._test.state && GZ._test.state.drag) return true;
    } catch (e) {}
    return false;
  }

  /* ---------------- tìm rig / xương ---------------- */
  function collectBones(root) {
    var out = [];
    if (!root || !root.traverse) return out;
    root.traverse(function (o) { if (o.isBone) out.push(o); });
    return out;
  }

  function resolveTarget(explicit) {
    if (explicit && explicit.traverse) return explicit;
    try {
      var QR = PS.ArpQuickRig;
      if (QR && QR.current && QR.current.target) return QR.current.target;
    } catch (e) {}
    try {
      var RAG = PS.RigAutoGen;
      if (RAG && RAG.current && RAG.current.target) return RAG.current.target;
      if (RAG && RAG.current && RAG.current.root) return RAG.current.root;
    } catch (e) {}
    try {
      if (PS.State && typeof PS.State.get === 'function') {
        var sel = PS.State.get('selection');
        if (sel && sel.traverse && collectBones(sel).length) return sel;
      }
    } catch (e) {}
    try {
      var V = getViewport();
      if (V && typeof V.getMainModel === 'function') {
        var m = V.getMainModel();
        if (m) return m;
      }
      if (V && V.modelRoot) {
        var kids = V.modelRoot.children || [];
        for (var i = 0; i < kids.length; i++) {
          if (collectBones(kids[i]).length) return kids[i];
        }
      }
    } catch (e) {}
    return null;
  }

  function findBone(name) {
    if (!name) return null;
    if (name.isBone) return name;
    var want = stripName(name).toLowerCase();
    var entry = state.entries[stripName(name)] || state.entries[name];
    if (entry && entry.bone) return entry.bone;
    try {
      var QR = PS.ArpQuickRig;
      if (QR && QR.current && QR.current.bones) {
        var b = QR.current.bones[stripName(name)] || QR.current.bones[name];
        if (b && b.isBone) return b;
      }
    } catch (e) {}
    if (state.target) {
      var found = null;
      state.target.traverse(function (o) {
        if (!found && o.isBone && stripName(o.name).toLowerCase() === want) found = o;
      });
      if (found) return found;
    }
    return null;
  }

  /* ---------------- overlay: khớp cầu + đoạn xương ---------------- */
  /* Overlay ở SCENE-level (xem ghi chú đầu file): clearOverlay chỉ gỡ
     group khỏi scene — KHÔNG bao giờ đụng vào cây model (không xóa
     mesh nào trong model, kể cả mesh lạ trùng tên do file FBX cũ
     mang theo). */
  function clearOverlay() {
    if (state.group) {
      try {
        state.group.traverse(function (o) {
          if (o.isMesh) {
            if (o.geometry && o.geometry.dispose) o.geometry.dispose();
            if (o.material && o.material.dispose) o.material.dispose();
          }
        });
      } catch (e) {}
      try { if (state.group.parent) state.group.parent.remove(state.group); } catch (e) {}
    }
    state.group = null;
    state.entries = {};
    state.target = null;
    VpSelect.boneCount = 0;
  }
  VpSelect.clearOverlay = clearOverlay;

  /* Nơi đặt group overlay: scene của viewport (ưu tiên) để model tree
     giữ sạch cho export; fallback: cha của target, rồi chính target. */
  function overlayParent(target) {
    var V = getViewport();
    if (V && V.scene) return V.scene;
    if (target && target.parent) return target.parent;
    return target;
  }

  /* Đồng bộ vị trí khớp/đoạn theo pose xương hiện tại (world).
     Gọi mỗi frame (qua Viewport.render) và ngay trước mỗi lần pick. */
  function syncOverlay() {
    var group = state.group;
    if (!group || !state.target) return { ok: false, error: 'Chưa có overlay.' };
    /* model đã bị gỡ khỏi scene (parent null) -> ẩn overlay nhưng vẫn
       định vị mesh (để pick/select qua API vẫn chạy trên model rời). */
    var targetAttached = !!state.target.parent;
    group.visible = targetAttached;
    try { state.target.updateMatrixWorld(true); } catch (e) {}
    var up = new window.THREE.Vector3(0, 1, 0);
    var seen = {};
    Object.keys(state.entries).forEach(function (k) {
      var e = state.entries[k];
      if (seen[e.bone.name]) return;
      seen[e.bone.name] = true;
      try {
        var a = new window.THREE.Vector3().setFromMatrixPosition(e.bone.matrixWorld);
        var aLocal = group.worldToLocal(a.clone());
        if (e.joint) e.joint.position.copy(aLocal);
        if (e.jointHit) e.jointHit.position.copy(aLocal);
        if (e.seg || e.segHit) {
          var childEntry = e.childName ? state.entries[stripName(e.childName)] : null;
          var childBone = childEntry ? childEntry.bone : null;
          if (childBone) {
            var b = new window.THREE.Vector3().setFromMatrixPosition(childBone.matrixWorld);
            var len = Math.max(0.01, a.distanceTo(b));
            var dir = b.clone().sub(a).normalize();
            var mid = group.worldToLocal(a.clone().add(b).multiplyScalar(0.5));
            var q = new window.THREE.Quaternion().setFromUnitVectors(up, dir);
            if (e.seg) {
              e.seg.position.copy(mid);
              e.seg.quaternion.copy(q);
              e.seg.scale.set(e.segRadius, len, e.segRadius);
            }
            if (e.segHit) {
              e.segHit.position.copy(mid);
              e.segHit.quaternion.copy(q);
              e.segHit.scale.set(e.segHitRadius, len, e.segHitRadius);
            }
            e.baseLength = len;
          }
        }
      } catch (err) {}
    });
    try { group.updateMatrixWorld(true); } catch (e) {}
    return { ok: true, visible: targetAttached };
  }
  VpSelect.syncOverlay = syncOverlay;

  function buildOverlay(target) {
    target = resolveTarget(target);
    if (!target || !target.traverse) return { ok: false, error: 'Chưa có model nào.' };
    if (!window.THREE) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var bones = collectBones(target);
    if (!bones.length) return { ok: false, error: 'Model chưa có skeleton — bấm chọn xương cần model đã rig.' };
    var prevSelected = VpSelect.selected;
    clearOverlay();
    state.target = target;
    target.updateMatrixWorld(true);
    var H = 1.8;
    try {
      var box = new window.THREE.Box3().setFromObject(target);
      var s = box.getSize(new window.THREE.Vector3());
      if (s.y > 0.01) H = s.y;
    } catch (e) {}
    var group = new window.THREE.Group();
    group.name = GROUP_NAME;
    var parent = overlayParent(target);
    if (parent && parent.add) parent.add(group);
    else target.add(group);
    state.group = group;
    var entries = {};
    bones.forEach(function (bone) {
      var kids = bone.children.filter(function (c) { return c.isBone; });
      var child = kids.length ? kids[0] : null;
      /* độ dài đoạn xương: khoảng cách tới xương con (world); lá = 3% chiều cao */
      var segLen = H * 0.03;
      if (child) {
        try {
          var a = new window.THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
          var b = new window.THREE.Vector3().setFromMatrixPosition(child.matrixWorld);
          segLen = Math.max(0.01, a.distanceTo(b));
        } catch (e) {}
      }
      var rJoint = clamp(segLen * 0.16, 0.006, 0.028);
      /* vùng bấm to hơn khớp vẽ để dễ tap trên mobile, nhưng CAP ở
         0.04m: khớp ngón tay/ngón chân chỉ cách nhau 6–9cm, vùng bấm
         quá to sẽ nuốt tia nhắm vào khớp bên cạnh. */
      var rHit = clamp(rJoint * 2.5, 0.022, 0.04);
      var rSeg = child ? clamp(segLen * 0.05, 0.004, 0.012) : 0;
      var rSegHit = clamp(rSeg * 2.5, 0.014, 0.03);
      var stripped = stripName(bone.name);
      /* --- khớp cầu (vị trí thật do syncOverlay đặt mỗi frame) --- */
      var jointMat = new window.THREE.MeshBasicMaterial({
        color: COLOR_DEFAULT, transparent: true, opacity: 0.95, depthTest: false });
      var joint = new window.THREE.Mesh(new window.THREE.SphereGeometry(1, 12, 10), jointMat);
      joint.name = '__arp_vpselect_joint_' + stripped;
      joint.scale.setScalar(rJoint);
      joint.renderOrder = 999;
      joint.frustumCulled = false;
      joint.userData.isArpVpSelect = true;
      joint.userData.isBoneVisual = true; /* không nướng vào FBX/GLB export */
      joint.userData.boneName = bone.name;
      joint.userData.stripped = stripped;
      joint.userData.kind = 'joint';
      group.add(joint);
      /* vùng bấm khớp: cầu vô hình (opacity 0) to hơn, vẫn raycast được */
      var jointHit = new window.THREE.Mesh(
        new window.THREE.SphereGeometry(1, 12, 8),
        new window.THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      jointHit.name = '__arp_vpselect_hit_' + stripped;
      jointHit.scale.setScalar(rHit);
      jointHit.renderOrder = 999;
      jointHit.frustumCulled = false;
      jointHit.userData.isArpVpSelect = true;
      jointHit.userData.isBoneVisual = true; /* không nướng vào FBX/GLB export */
      jointHit.userData.boneName = bone.name;
      jointHit.userData.stripped = stripped;
      jointHit.userData.kind = 'joint';
      group.add(jointHit);
      /* --- đoạn xương tới xương con (vị trí thật do syncOverlay đặt) --- */
      var seg = null, segHit = null;
      if (child) {
        var segMat = new window.THREE.MeshBasicMaterial({
          color: COLOR_DEFAULT, transparent: true, opacity: 0.5, depthTest: false });
        seg = new window.THREE.Mesh(new window.THREE.CylinderGeometry(1, 1, 1, 8), segMat);
        seg.name = '__arp_vpselect_seg_' + stripped;
        seg.scale.set(rSeg, segLen, rSeg);
        seg.renderOrder = 998;
        seg.frustumCulled = false;
        seg.userData.isArpVpSelect = true;
        seg.userData.isBoneVisual = true; /* không nướng vào FBX/GLB export */
        seg.userData.boneName = bone.name;
        seg.userData.stripped = stripped;
        seg.userData.kind = 'segment';
        group.add(seg);
        segHit = new window.THREE.Mesh(
          new window.THREE.CylinderGeometry(1, 1, 1, 8),
          new window.THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        segHit.name = '__arp_vpselect_seghit_' + stripped;
        segHit.scale.set(rSegHit, segLen, rSegHit);
        segHit.renderOrder = 998;
        segHit.frustumCulled = false;
        segHit.userData.isArpVpSelect = true;
        segHit.userData.isBoneVisual = true; /* không nướng vào FBX/GLB export */
        segHit.userData.boneName = bone.name;
        segHit.userData.stripped = stripped;
        segHit.userData.kind = 'segment';
        group.add(segHit);
      }
      var entry = {
        bone: bone, joint: joint, jointHit: jointHit, seg: seg, segHit: segHit,
        childName: child ? child.name : null, baseLength: segLen,
        baseJointRadius: rJoint, segRadius: rSeg, segHitRadius: rSegHit,
        isLeaf: !child
      };
      entries[stripped] = entry;
      entries[bone.name] = entry;
    });
    state.entries = entries;
    VpSelect.boneCount = bones.length;
    syncOverlay();
    /* giữ lựa chọn cũ nếu xương đó vẫn còn sau khi dựng lại */
    if (prevSelected) {
      var keep = findBone(prevSelected);
      if (keep) applyHighlight(stripName(keep.name));
      else { VpSelect.selected = null; VpSelect.selectedBone = null; }
    }
    return { ok: true, boneCount: bones.length, target: target };
  }
  VpSelect.buildOverlay = buildOverlay;
  VpSelect.build = buildOverlay;

  function refreshOverlay() {
    var r = buildOverlay(state.target || undefined);
    if (r.ok) refreshPanel();
    return r;
  }
  VpSelect.refreshOverlay = refreshOverlay;

  function pickTargets() {
    var list = [];
    var seen = {};
    Object.keys(state.entries).forEach(function (k) {
      var e = state.entries[k];
      if (seen[e.bone.name]) return;
      seen[e.bone.name] = true;
      if (e.jointHit) list.push(e.jointHit);
      if (e.segHit) list.push(e.segHit);
    });
    return list;
  }

  /* ---------------- thông tin xương ---------------- */
  function getInfo(nameOrBone) {
    var bone = findBone(nameOrBone);
    if (!bone) return null;
    var stripped = stripName(bone.name);
    var entry = state.entries[stripped];
    var parent = bone.parent && bone.parent.isBone ? stripName(bone.parent.name) : null;
    var children = [];
    bone.children.forEach(function (c) { if (c.isBone) children.push(stripName(c.name)); });
    var lengthM = null;
    if (entry) {
      if (!entry.isLeaf) {
        try {
          bone.updateWorldMatrix(true, false);
          var a = new window.THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
          var kid = bone.children.filter(function (c) { return c.isBone; })[0];
          var b = new window.THREE.Vector3().setFromMatrixPosition(kid.matrixWorld);
          lengthM = a.distanceTo(b);
        } catch (e) { lengthM = entry.baseLength; }
      }
    }
    var wp = new window.THREE.Vector3();
    try { wp.setFromMatrixPosition(bone.matrixWorld); } catch (e) {}
    return {
      name: bone.name,
      stripped: stripped,
      parent: parent,
      children: children,
      lengthM: lengthM,
      lengthCm: lengthM == null ? null : lengthM * 100,
      isLeaf: children.length === 0,
      rotationDeg: {
        x: rad2deg(bone.rotation.x),
        y: rad2deg(bone.rotation.y),
        z: rad2deg(bone.rotation.z)
      },
      worldPos: { x: wp.x, y: wp.y, z: wp.z }
    };
  }
  VpSelect.getInfo = getInfo;

  /* ---------------- highlight ---------------- */
  function restoreEntry(entry) {
    if (!entry) return;
    try {
      if (entry.joint) {
        entry.joint.material.color.setHex(COLOR_DEFAULT);
        entry.joint.scale.setScalar(entry.baseJointRadius);
      }
      if (entry.seg) entry.seg.material.color.setHex(COLOR_DEFAULT);
    } catch (e) {}
  }
  function applyHighlight(stripped) {
    var entry = state.entries[stripped];
    if (!entry) return false;
    try {
      if (entry.joint) {
        entry.joint.material.color.setHex(COLOR_SELECTED);
        entry.joint.scale.setScalar(entry.baseJointRadius * SELECT_SCALE);
      }
      if (entry.seg) entry.seg.material.color.setHex(COLOR_SELECTED);
    } catch (e) {}
    return true;
  }
  function clearHighlight() {
    var seen = {};
    Object.keys(state.entries).forEach(function (k) {
      var e = state.entries[k];
      if (seen[e.bone.name]) return;
      seen[e.bone.name] = true;
      restoreEntry(e);
    });
  }

  /* ---------------- panel thông tin ---------------- */
  function buildPanel() {
    if (state.panelEl) return state.panelEl;
    var wrap = getWrap();
    if (!wrap || typeof document === 'undefined') return null;
    var panel = el('div', { id: PANEL_ID, class: 'vp-hud arp-vpselect-panel' });
    panel.style.cssText = 'position:absolute;right:10px;top:10px;width:236px;z-index:30;' +
      'background:rgba(10,18,32,0.93);color:#e8f0ff;border:1px solid #ffb300;border-radius:8px;' +
      'padding:8px 10px;font-size:12px;line-height:1.55;display:none;pointer-events:auto;' +
      'box-shadow:0 2px 10px rgba(0,0,0,0.45);';
    var head = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' } });
    head.appendChild(el('span', { html: '🦴 <b>Xương đang chọn</b>' }));
    var closeBtn = el('button', {
      text: '✕', title: 'Bỏ chọn',
      style: { background: 'transparent', border: 'none', color: '#e8f0ff', cursor: 'pointer', fontSize: '13px', padding: '0 2px' },
      onclick: function () { VpSelect.deselect(); }
    });
    head.appendChild(closeBtn);
    panel.appendChild(head);
    panel.appendChild(el('div', { id: 'arp-vpselect-body' }));
    panel.appendChild(el('div', {
      style: { marginTop: '6px', color: '#9db6d8', fontSize: '11px' },
      text: 'Bấm xương khác để đổi · bấm chỗ trống để bỏ chọn'
    }));
    try { wrap.appendChild(panel); } catch (e) { return null; }
    state.panelEl = panel;
    return panel;
  }

  function refreshPanel() {
    var panel = state.panelEl;
    if (!VpSelect.selected) {
      if (panel) panel.style.display = 'none';
      return { ok: true, visible: false };
    }
    panel = panel || buildPanel();
    if (!panel) return { ok: false, error: 'Không tạo được panel (chưa có khung viewport).' };
    var info = getInfo(VpSelect.selectedBone || VpSelect.selected);
    if (!info) { panel.style.display = 'none'; return { ok: false, error: 'Không còn xương đang chọn.' }; }
    var body = panel.querySelector('#arp-vpselect-body');
    if (body) {
      var r = info.rotationDeg;
      body.innerHTML =
        '<div style="font-size:14px;margin-bottom:2px"><b>' + info.stripped + '</b></div>' +
        '<div><span style="color:#9db6d8">Cha:</span> ' + (info.parent || '— (gốc)') + '</div>' +
        '<div><span style="color:#9db6d8">Con:</span> ' + (info.children.length ? info.children.join(', ') : '— (lá)') + '</div>' +
        '<div><span style="color:#9db6d8">Dài:</span> ' + (info.lengthCm == null ? '— (xương lá)' : info.lengthCm.toFixed(1) + ' cm') + '</div>' +
        '<div><span style="color:#9db6d8">Xoay°:</span> X ' + r.x.toFixed(1) + ' · Y ' + r.y.toFixed(1) + ' · Z ' + r.z.toFixed(1) + '</div>';
    }
    panel.style.display = 'block';
    state.lastPanelRefresh = Date.now();
    return { ok: true, visible: true, info: info };
  }
  VpSelect.refreshPanel = refreshPanel;
  VpSelect.showPanel = refreshPanel;

  /* ---------------- đồng bộ bảng map Quick Rig ---------------- */
  function clearMapHighlight() {
    if (state.highlightedRow) {
      try {
        state.highlightedRow.classList.remove('arp-vpselect-row');
        state.highlightedRow.style.background = '';
        state.highlightedRow.style.outline = '';
      } catch (e) {}
      state.highlightedRow = null;
    }
  }

  function highlightMapRow(dst) {
    dst = stripName(dst);
    clearMapHighlight();
    if (typeof document === 'undefined') return { ok: false, error: 'Không có document.' };
    var rows = document.querySelectorAll('.arp-map-table tr');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var first = row.querySelector('td');
      if (!first) continue;
      if (stripName(first.textContent.trim()) === dst) {
        try {
          row.classList.add('arp-vpselect-row');
          row.style.background = '#ffe9a8';
          row.style.outline = '2px solid #ffb300';
          if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
        } catch (e) {}
        state.highlightedRow = row;
        return { ok: true, found: true, dst: dst };
      }
    }
    return { ok: true, found: false, dst: dst };
  }
  VpSelect.highlightMapRow = highlightMapRow;

  /* ---------------- chọn / bỏ chọn ---------------- */
  function select(name, opts) {
    opts = opts || {};
    var bone = findBone(name);
    if (!bone) {
      /* chưa dựng overlay (vd rig vừa convert xong) → thử dựng rồi tìm lại */
      var built = buildOverlay();
      if (built.ok) bone = findBone(name);
      if (!bone) return { ok: false, error: 'Không tìm thấy xương: ' + name + (built.ok ? '' : ' (' + (built.error || 'chưa có rig') + ')') };
    }
    var stripped = stripName(bone.name);
    /* đảm bảo overlay đã dựng (xương tìm được qua QR.current.bones
       nhưng overlay chưa có thì highlight sẽ không có gì để đổi màu) */
    if (!state.group || !state.entries[stripped]) {
      var b2 = buildOverlay();
      if (b2.ok) { var again = findBone(name); if (again) bone = again; }
    }
    var prev = VpSelect.selected;
    if (prev === stripped && VpSelect.selectedBone === bone && !opts.force) {
      refreshPanel();
      return { ok: true, bone: stripped, info: getInfo(bone), alreadySelected: true };
    }
    clearHighlight();
    VpSelect.selected = stripped;
    VpSelect.selectedBone = bone;
    applyHighlight(stripped);
    refreshPanel();
    if (!opts.skipMap) highlightMapRow(stripped);
    var info = getInfo(bone);
    emit('arpvpselect:select', { bone: stripped, fullName: bone.name, prev: prev, info: info });
    state.callbacks.slice().forEach(function (fn) {
      try { fn(stripped, info, prev); } catch (e) {}
    });
    return { ok: true, bone: stripped, info: info, prev: prev };
  }
  VpSelect.select = select;
  VpSelect.selectFromMap = function (dst) { return select(dst); };

  function deselect(opts) {
    opts = opts || {};
    var prev = VpSelect.selected;
    if (!prev && !VpSelect.selectedBone) {
      clearMapHighlight();
      refreshPanel();
      return { ok: true, prev: null, alreadyEmpty: true };
    }
    clearHighlight();
    VpSelect.selected = null;
    VpSelect.selectedBone = null;
    clearMapHighlight();
    refreshPanel();
    emit('arpvpselect:deselect', { prev: prev });
    state.callbacks.slice().forEach(function (fn) {
      try { fn(null, null, prev); } catch (e) {}
    });
    return { ok: true, prev: prev };
  }
  VpSelect.deselect = deselect;

  function getSelected() { return VpSelect.selected; }
  VpSelect.getSelected = getSelected;

  function onSelect(fn) {
    if (typeof fn !== 'function') return function () {};
    state.callbacks.push(fn);
    return function () {
      var i = state.callbacks.indexOf(fn);
      if (i >= 0) state.callbacks.splice(i, 1);
    };
  }
  VpSelect.onSelect = onSelect;

  /* ---------------- raycast pick ---------------- */
  var _raycaster = null;
  function getRaycaster() {
    if (!_raycaster && window.THREE) _raycaster = new window.THREE.Raycaster();
    return _raycaster;
  }

  /* Chấm điểm hit: KHÔNG lấy hit gần camera nhất — khớp ngón tay /
     ngón chân nằm gần như thẳng hàng với tia nhìn (cách tay 6.5cm,
     chân 9.1cm) nên vùng bấm của nó dễ bị tia nhắm vào khớp bên cạnh
     quét trúng trước. Thay vào đó, trong các hit, ưu tiên hit có
     "điểm ngắm" gần tia nhất: tâm khớp (hit khớp) hoặc điểm giữa
     đoạn xương (hit đoạn). Chỉ khi mọi điểm ngắm đều lệch > 0.08m
     mới rơi về hit gần nhất (bấm trúng mép vùng bấm). */
  var AIM_TOLERANCE = 0.08;
  function aimErrorOf(hit) {
    try {
      var ud = hit.object.userData || {};
      var entry = state.entries[ud.stripped] || state.entries[ud.boneName];
      if (!entry || !entry.bone) return 1e9;
      var ray = getRaycaster().ray;
      var p = new window.THREE.Vector3().setFromMatrixPosition(entry.bone.matrixWorld);
      if (ud.kind === 'segment' && entry.childName) {
        var childEntry = state.entries[stripName(entry.childName)];
        if (childEntry && childEntry.bone) {
          var q = new window.THREE.Vector3().setFromMatrixPosition(childEntry.bone.matrixWorld);
          p.add(q).multiplyScalar(0.5); /* giữa đoạn xương */
        }
      }
      return ray.distanceToPoint(p);
    } catch (e) { return 1e9; }
  }

  function pick(ndcX, ndcY, camera) {
    if (!VpSelect.enabled) return null;
    if (isQuadMode()) return null; /* Quad View: 4 ô ortho, NDC toàn khung không khớp ô nào — không pick */
    if (!state.group || !VpSelect.boneCount) {
      var built = buildOverlay();
      if (!built.ok) return null;
    }
    camera = camera || getCamera();
    if (!camera) return null;
    var rc = getRaycaster();
    if (!rc) return null;
    try {
      state.target.updateMatrixWorld(true);
      syncOverlay(); /* đặt khớp/đoạn đúng pose hiện tại trước khi raycast */
      rc.setFromCamera({ x: ndcX, y: ndcY }, camera);
      var hits = rc.intersectObjects(pickTargets(), false);
      if (!hits.length) return null;
      var best = hits[0], bestAim = aimErrorOf(hits[0]);
      for (var i = 1; i < hits.length; i++) {
        var a = aimErrorOf(hits[i]);
        if (a < bestAim - 1e-6 || (Math.abs(a - bestAim) <= 1e-6 && hits[i].distance < best.distance)) {
          best = hits[i]; bestAim = a;
        }
      }
      /* điểm ngắm tốt nhất vẫn lệch quá xa -> bấm trúng mép vùng bấm,
         lấy hit gần camera nhất như raycast thường. */
      if (bestAim > AIM_TOLERANCE) best = hits[0];
      var hit = best.object;
      if (hit.userData && hit.userData.stripped) return hit.userData.stripped;
      return null;
    } catch (e) { return null; }
  }
  VpSelect.pick = pick;

  function pickAtClient(clientX, clientY) {
    var wrap = getWrap();
    var rect = null;
    try { if (wrap && wrap.getBoundingClientRect) rect = wrap.getBoundingClientRect(); } catch (e) {}
    if (!rect || !rect.width || !rect.height) return null;
    var ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    var ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    return pick(ndcX, ndcY);
  }
  VpSelect.pickAtClient = pickAtClient;

  /* ---------------- bấm vs kéo (click / drag / tap) ---------------- */
  function handlePointerDown(e) {
    if (!VpSelect.enabled) return;
    try {
      var t = e.target;
      if (t && t.closest) {
        /* bấm lên panel/UI trong viewport (panel camera, panel xương...) thì không phải chọn xương */
        if (t.closest('#' + PANEL_ID) || t.closest('.vp-hud') || t.closest('button') || t.closest('input') || t.closest('select') || t.closest('textarea')) return;
      }
    } catch (err) {}
    if (e.pointerId !== undefined) {
      if (!state.pointers[e.pointerId]) { state.pointers[e.pointerId] = true; state.pointerCount++; }
      if (state.pointerCount > 1) { state.down = null; return; } /* pinch 2 ngón: không chọn */
    }
    if (e.button !== undefined && e.button !== 0) return; /* chỉ chuột trái / tap */
    if (gizmoBusy()) { state.down = null; return; }
    state.down = {
      x: e.clientX, y: e.clientY,
      time: (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0,
      pointerId: e.pointerId, type: e.pointerType || 'mouse',
      moved: false
    };
  }

  function handlePointerMove(e) {
    if (e.pointerId !== undefined && state.pointers[e.pointerId] === undefined && state.down) {
      /* ngón thứ 2 xuất hiện giữa chừng */
      state.pointerCount++;
      state.down = null;
      return;
    }
    if (!state.down) return;
    var dx = (e.clientX || 0) - state.down.x;
    var dy = (e.clientY || 0) - state.down.y;
    if (Math.hypot(dx, dy) > VpSelect.clickThreshold) state.down.moved = true;
  }

  function handlePointerUp(e) {
    if (e.pointerId !== undefined) {
      if (state.pointers[e.pointerId]) { delete state.pointers[e.pointerId]; state.pointerCount = Math.max(0, state.pointerCount - 1); }
    }
    var down = state.down;
    state.down = null;
    if (!VpSelect.enabled || !down) return;
    if (down.pointerId !== undefined && e.pointerId !== undefined && down.pointerId !== e.pointerId) return;
    if (state.pointerCount > 0) return; /* còn ngón khác đang chạm (pinch) */
    if (down.moved) return; /* đã kéo -> OrbitCam xoay, không chọn */
    var moved = Math.hypot((e.clientX || 0) - down.x, (e.clientY || 0) - down.y);
    if (moved > VpSelect.clickThreshold) return;
    var now = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    if (now - down.time > VpSelect.maxClickMs) return;
    if (gizmoBusy()) return;
    var hit = pickAtClient(e.clientX, e.clientY);
    if (hit) select(hit);
    else deselect();
  }

  function handlePointerCancel(e) {
    if (e && e.pointerId !== undefined && state.pointers[e.pointerId]) {
      delete state.pointers[e.pointerId];
      state.pointerCount = Math.max(0, state.pointerCount - 1);
    }
    state.down = null;
  }

  /* bấm dòng trong bảng map Quick Rig -> chọn xương trong viewport.
     Bỏ qua khi bấm vào dropdown/input/nút trong dòng (đó là sửa map). */
  function handleDocClick(e) {
    if (!VpSelect.enabled) return;
    try {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('select') || t.closest('input') || t.closest('button') || t.closest('a')) return;
      var row = t.closest('.arp-map-table tr');
      if (!row) return;
      var first = row.querySelector('td');
      if (!first) return;
      var dst = stripName(first.textContent.trim());
      if (!dst) return;
      var r = select(dst);
      if (r.ok) {
        /* mở panel ARP tab Quick Rig nếu đang đóng? Không tự mở cửa sổ —
           chỉ highlight trong viewport + panel xương. */
      }
    } catch (err) {}
  }

  /* ---------------- enabled / threshold ---------------- */
  VpSelect.setEnabled = function (on) {
    VpSelect.enabled = !!on;
    if (!VpSelect.enabled) { state.down = null; }
    return VpSelect.enabled;
  };
  VpSelect.isEnabled = function () { return !!VpSelect.enabled; };
  VpSelect.setClickThreshold = function (px) {
    var v = Number(px);
    if (isFinite(v) && v > 0) VpSelect.clickThreshold = v;
    return VpSelect.clickThreshold;
  };
  VpSelect.getClickThreshold = function () { return VpSelect.clickThreshold; };
  VpSelect.getState = function () {
    return {
      enabled: VpSelect.enabled,
      selected: VpSelect.selected,
      boneCount: VpSelect.boneCount,
      hasOverlay: !!state.group,
      targetName: state.target ? (state.target.name || '') : null,
      clickThreshold: VpSelect.clickThreshold,
      maxClickMs: VpSelect.maxClickMs,
      panelVisible: !!(state.panelEl && state.panelEl.style.display !== 'none')
    };
  };

  /* ---------------- init / destroy ---------------- */
  VpSelect.init = function () {
    if (state.listeners) return { ok: true, alreadyInit: true };
    var wrap = getWrap();
    var L = { wrap: wrap, down: handlePointerDown, move: handlePointerMove, up: handlePointerUp, cancel: handlePointerCancel, docClick: handleDocClick };
    try {
      if (wrap && wrap.addEventListener) {
        wrap.addEventListener('pointerdown', L.down);
        wrap.addEventListener('pointermove', L.move);
        wrap.addEventListener('pointerup', L.up);
        wrap.addEventListener('pointercancel', L.cancel);
      }
    } catch (e) {}
    try {
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('click', L.docClick);
      }
    } catch (e) {}
    state.listeners = L;
    /* rig xong / model mới -> dựng lại overlay (giữ lựa chọn nếu còn) */
    try {
      if (bus && typeof bus.on === 'function') {
        var rebuild = function () { try { buildOverlay(); refreshPanel(); } catch (e) {} };
        bus.on('arpquickrig:converted', rebuild);
        bus.on('arpquickrig:autogen-done', rebuild);
        bus.on('arpquickrig:mixamo-done', rebuild);
        bus.on('autorigpro:done', rebuild);
        bus.on('model:loaded', rebuild);
        /* chọn control trong gizmo -> highlight xương đó trong viewport */
        bus.on('arpqr3gizmo:select', function (d) {
          try { if (d && d.dst) select(d.dst, { skipMap: false }); } catch (e) {}
        });
      }
    } catch (e) {}
    /* cập nhật góc xoay trong panel theo pose hiện tại (throttle 200ms) */
    try {
      var V = getViewport();
      if (V && typeof V.render === 'function' && !state.renderWrapped) {
        var prev = V.render;
        state.prevRender = prev;
        V.render = function (dt) {
          prev.call(V, dt);
          try {
            /* đồng bộ overlay theo pose mỗi frame + cập nhật góc xoay
               trong panel (throttle 200ms) */
            syncOverlay();
            if (VpSelect.selected && Date.now() - state.lastPanelRefresh > 200) refreshPanel();
          } catch (e) {}
        };
        state.renderWrapped = true;
      }
    } catch (e) {}
    /* thử dựng overlay ngay nếu đã có rig */
    try { buildOverlay(); } catch (e) {}
    return { ok: true, boneCount: VpSelect.boneCount };
  };

  VpSelect.destroy = function () {
    var L = state.listeners;
    if (L) {
      try {
        if (L.wrap && L.wrap.removeEventListener) {
          L.wrap.removeEventListener('pointerdown', L.down);
          L.wrap.removeEventListener('pointermove', L.move);
          L.wrap.removeEventListener('pointerup', L.up);
          L.wrap.removeEventListener('pointercancel', L.cancel);
        }
        if (typeof document !== 'undefined' && document.removeEventListener) {
          document.removeEventListener('click', L.docClick);
        }
      } catch (e) {}
      state.listeners = null;
    }
    try {
      var V = getViewport();
      if (state.renderWrapped && V && state.prevRender) { V.render = state.prevRender; state.renderWrapped = false; state.prevRender = null; }
    } catch (e) {}
    try { if (state.panelEl && state.panelEl.parentNode) state.panelEl.parentNode.removeChild(state.panelEl); } catch (e) {}
    state.panelEl = null;
    clearOverlay();
    VpSelect.selected = null;
    VpSelect.selectedBone = null;
    state.callbacks = [];
    return { ok: true };
  };

  VpSelect._test = {
    state: state,
    handlePointerDown: handlePointerDown,
    handlePointerMove: handlePointerMove,
    handlePointerUp: handlePointerUp,
    handlePointerCancel: handlePointerCancel,
    handleDocClick: handleDocClick,
    pickTargets: pickTargets,
    findBone: findBone,
    resolveTarget: resolveTarget,
    applyHighlight: applyHighlight,
    clearHighlight: clearHighlight,
    buildPanel: buildPanel,
    syncOverlay: syncOverlay,
    aimErrorOf: aimErrorOf,
    COLOR_DEFAULT: COLOR_DEFAULT,
    COLOR_SELECTED: COLOR_SELECTED,
    SELECT_SCALE: SELECT_SCALE
  };

  PS.ArpVpSelect = VpSelect;
})();
