/* arp-qr3-prop.js — PHẦN 6 vòng mở rộng 3 của Quick Rig (Auto Rig Pro Blend):
 * Prop attachment — gắn đạo cụ procedural vào tay control.
 *
 * LỰA CHỌN GẮN (ghi rõ): prop được parent TRỰC TIẾP vào xương bàn tay
 * (bones['LeftHand' | 'RightHand'], THREE.Bone) — KHÔNG gắn vào control
 * Object3D '__arp_ctrl_LeftHand'. Lý do: control chỉ là helper Object3D
 * nằm trong group '__arp_ctrl_rig__' (con của model root), được ĐẶT VỊ TRÍ
 * theo xương lúc convert/match chứ không parent vào xương; khi IK/FK xoay
 * xương thì control không tự đi theo (chỉ đồng bộ khi gọi match/bake).
 * Gắn vào bone thì prop đi theo tay trong mọi trường hợp: FK, IK 2-bone,
 * preset, clip — vì bone là mắt xích thật của skeleton/skin.
 *
 * Tư thế cầm mặc định: gốc của prop Group đặt tại điểm nắm (grip) trong
 * lòng bàn tay, lưỡi kiếm / thân gậy dọc theo +Y cục bộ của xương tay.
 * movePropToHand() reset về đúng tư thế cầm mặc định này ở tay mới
 * (không giữ world transform cũ — giữ world transform sẽ để đạo cụ lơ
 * lửng ở vị trí tay cũ trong khi tay mới ở chỗ khác).
 *
 * Đạo cụ procedural bằng THREE primitives, KHÔNG cần file ngoài.
 * Kích thước tỉ lệ theo chiều cao nhân vật H (mặc định QuickRig.current.height,
 * fallback 1.8m): kiếm dài ~0.85m, gậy dài ~1.40m, hộp cạnh ~0.22m ở H=1.8m.
 *
 * KHÔNG sửa arp-quickrig.js / arp-panel.js / index.html / css.
 * Đăng ký section: thử gọi ArpQuickRig.registerSection('prop', renderSection)
 * trong try/catch — chạy được cả khi coordinator chưa thêm hook đó.
 *
 * IIFE, 'use strict', ES5 (var/function), three.js r128,
 * expose window.PixiStudio.ArpQuickRig.Prop.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.PixiStudio) return;
  var THREE = window.THREE;
  if (!THREE) return;
  var QR = window.PixiStudio.ArpQuickRig;
  if (!QR) return; /* Quick Rig chưa load thì module này không làm gì được */

  /* ---------------- hằng số ---------------- */
  var FALLBACK_HEIGHT = 1.8;
  var PROP_DEFS = {
    sword: { label: 'Kiếm', builder: 'buildSword' },
    staff: { label: 'Gậy', builder: 'buildStaff' },
    box: { label: 'Hộp', builder: 'buildBox' }
  };

  /* ---------------- state ---------------- */
  /* attachment hiện tại, hoặc null:
   * { prop, propName, side ('Left'|'Right'), handBone, handBoneName, attachedAt } */
  var attachment = null;

  /* ---------------- helpers ---------------- */
  function notify(type, title, msg) {
    try {
      var bus = window.PixiStudio.bus;
      if (bus && typeof bus.emit === 'function') bus.emit('notify', { type: type, title: title, message: msg });
    } catch (e) {}
    try {
      var bus2 = window.PixiStudio.bus;
      if (bus2 && typeof bus2.emit === 'function') bus2.emit('arpqrprop:changed', { type: type, title: title, message: msg });
    } catch (e) {}
  }

  /* Chiều cao nhân vật (m). Ưu tiên: tham số truyền vào > QuickRig.current.height > 1.8. */
  function resolveHeight(scaleH) {
    if (typeof scaleH === 'number' && isFinite(scaleH) && scaleH > 0.1 && scaleH < 5) return scaleH;
    try {
      var cur = QR.current;
      if (cur && typeof cur.height === 'number' && isFinite(cur.height) && cur.height > 0.1) return cur.height;
    } catch (e) {}
    return FALLBACK_HEIGHT;
  }

  function mat(color, opts) {
    opts = opts || {};
    try {
      return new THREE.MeshStandardMaterial({
        color: color, metalness: opts.metalness || 0, roughness: opts.roughness === undefined ? 0.7 : opts.roughness
      });
    } catch (e) {
      return new THREE.MeshBasicMaterial({ color: color });
    }
  }

  function part(group, mesh, name, partName) {
    mesh.name = '__arp_prop_part_' + name;
    mesh.userData.part = partName;
    mesh.userData.isArpPropPart = true;
    group.add(mesh);
    return mesh;
  }

  function findPart(group, partName) {
    var found = null;
    group.traverse(function (o) { if (o.userData && o.userData.part === partName) found = o; });
    return found;
  }

  /* Tư thế cầm mặc định: gốc prop tại điểm nắm, lưỡi/thân dọc +Y tay. */
  function defaultGrip(prop) {
    prop.position.set(0, 0, 0);
    prop.rotation.set(0, 0, 0);
    prop.scale.set(1, 1, 1);
  }

  /* ---------------- builders (procedural) ---------------- */
  /* Kiếm: tổng dài ~0.47*H (≈0.85m ở H=1.8m). Gốc tại điểm nắm trên chuôi,
   * lưỡi vươn +Y, chuôi/pommel ở -Y. */
  function buildSword(scaleH) {
    var H = resolveHeight(scaleH);
    var s = H / FALLBACK_HEIGHT; /* tỉ lệ so với nhân vật 1.8m */
    var g = new THREE.Group();
    g.name = '__arp_prop_sword';
    g.userData.propName = 'sword';
    g.userData.isArpProp = true;
    var bladeLen = 0.60 * s, bladeW = 0.05 * s, bladeT = 0.012 * s;
    var guardW = 0.18 * s, handleLen = 0.16 * s;
    var blade = new THREE.Mesh(new THREE.BoxGeometry(bladeW, bladeLen, bladeT), mat(0xc0c8d0, { metalness: 0.8, roughness: 0.3 }));
    blade.position.set(0, 0.03 * s + bladeLen / 2, 0); /* chuôi nắm ở gốc, lưỡi bắt đầu sau chắn tay */
    part(g, blade, 'blade', 'blade');
    var guard = new THREE.Mesh(new THREE.BoxGeometry(guardW, 0.03 * s, 0.04 * s), mat(0xc9a227, { metalness: 0.7, roughness: 0.35 }));
    guard.position.set(0, 0.015 * s, 0);
    part(g, guard, 'guard', 'guard');
    var handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * s, 0.02 * s, handleLen, 10), mat(0x5a3a22, { roughness: 0.9 }));
    handle.position.set(0, -handleLen / 2, 0);
    part(g, handle, 'handle', 'handle');
    var pommel = new THREE.Mesh(new THREE.SphereGeometry(0.025 * s, 10, 8), mat(0xc9a227, { metalness: 0.7, roughness: 0.35 }));
    pommel.position.set(0, -handleLen - 0.01 * s, 0);
    part(g, pommel, 'pommel', 'pommel');
    g.userData.length = bladeLen + 0.03 * s + handleLen + 0.02 * s;
    return g;
  }

  /* Gậy: tổng dài ~0.78*H (≈1.40m ở H=1.8m). Gốc tại điểm nắm (~35% từ
   * đáy), đầu gậy (orb) ở đỉnh +Y, mũi gậy ở đáy -Y. */
  function buildStaff(scaleH) {
    var H = resolveHeight(scaleH);
    var s = H / FALLBACK_HEIGHT;
    var g = new THREE.Group();
    g.name = '__arp_prop_staff';
    g.userData.propName = 'staff';
    g.userData.isArpProp = true;
    var len = 1.40 * s, r = 0.018 * s;
    var gripFromBottom = 0.35 * len; /* điểm nắm cách đáy 35% chiều dài */
    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat(0x7a5230, { roughness: 0.85 }));
    shaft.position.set(0, len / 2 - gripFromBottom, 0);
    part(g, shaft, 'shaft', 'shaft');
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.05 * s, 12, 10), mat(0x33aaff, { metalness: 0.2, roughness: 0.3 }));
    head.position.set(0, len - gripFromBottom + 0.05 * s, 0);
    part(g, head, 'head', 'head');
    var tip = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 0.7, 0.05 * s, 10), mat(0x888888, { metalness: 0.6, roughness: 0.4 }));
    tip.position.set(0, -gripFromBottom - 0.01 * s, 0);
    part(g, tip, 'tip', 'tip');
    g.userData.length = len + 0.1 * s;
    return g;
  }

  /* Hộp: khối lập phương cạnh ~0.12*H (≈0.22m ở H=1.8m), nắp mỏng trên đỉnh.
   * Gốc tại tâm hộp (tay ôm giữa hộp). */
  function buildBox(scaleH) {
    var H = resolveHeight(scaleH);
    var s = H / FALLBACK_HEIGHT;
    var g = new THREE.Group();
    g.name = '__arp_prop_box';
    g.userData.propName = 'box';
    g.userData.isArpProp = true;
    var side = 0.22 * s;
    var body = new THREE.Mesh(new THREE.BoxGeometry(side, side * 0.8, side), mat(0xb5651d, { roughness: 0.8 }));
    body.position.set(0, 0, 0);
    part(g, body, 'body', 'body');
    var lid = new THREE.Mesh(new THREE.BoxGeometry(side * 1.05, side * 0.2, side * 1.05), mat(0x8a4a12, { roughness: 0.8 }));
    lid.position.set(0, side * 0.5, 0);
    part(g, lid, 'lid', 'lid');
    g.userData.length = side;
    return g;
  }

  var BUILDERS = { sword: buildSword, staff: buildStaff, box: buildBox };

  /* ---------------- attach / move / detach ---------------- */
  function normSide(side) {
    if (typeof side !== 'string') return null;
    var s = side.toLowerCase();
    if (s === 'left' || s === 'l' || s === 'trái' || s === 'trai') return 'Left';
    if (s === 'right' || s === 'r' || s === 'phải' || s === 'phai') return 'Right';
    return null;
  }

  function handBoneFor(side) {
    var cur = QR.current;
    if (!cur || !cur.bones) return null;
    return cur.bones[side + 'Hand'] || null;
  }

  function clearStaleState() {
    /* Control rig đã bị gỡ (clearControlRig đặt QR.current = null) mà prop
     * vẫn còn treo trên xương cũ: gỡ prop khỏi scene graph, xóa state. */
    if (attachment) {
      try { if (attachment.prop && attachment.prop.parent) attachment.prop.parent.remove(attachment.prop); } catch (e) {}
      attachment = null;
    }
    try { if (QR.current) QR.current.propAttachment = null; } catch (e) {}
  }

  function attachProp(propName, side) {
    var res = { ok: false };
    if (!PROP_DEFS[propName]) {
      res.error = 'Không biết đạo cụ "' + propName + '" — chọn kiếm (sword), gậy (staff) hoặc hộp (box).';
      return res;
    }
    var sideN = normSide(side);
    if (!sideN) {
      res.error = 'Tay gắn không hợp lệ: "' + side + '" — dùng "Left" (trái) hoặc "Right" (phải).';
      return res;
    }
    var cur = QR.current;
    if (!cur || !cur.target) {
      res.error = 'Chưa có control rig — convert model đã rig sang Quick Rig trước (Convert / Auto Gen).';
      return res;
    }
    var bone = handBoneFor(sideN);
    if (!bone) {
      res.error = 'Không có xương tay ' + (sideN === 'Left' ? 'trái (LeftHand)' : 'phải (RightHand)') + ' trong rig hiện tại.';
      return res;
    }
    /* đã gắn đạo cụ khác thì tháo cái cũ trước (mỗi rig chỉ giữ 1 prop) */
    if (attachment) detachProp();
    var prop;
    try { prop = BUILDERS[propName](cur.height); } catch (e) {
      res.error = 'Không tạo được đạo cụ ' + propName + ': ' + (e && e.message);
      return res;
    }
    defaultGrip(prop);
    try { bone.add(prop); } catch (e) {
      res.error = 'Không gắn được vào xương tay: ' + (e && e.message);
      return res;
    }
    try { cur.target.updateMatrixWorld(true); } catch (e) {}
    attachment = {
      prop: prop, propName: propName, side: sideN,
      handBone: bone, handBoneName: bone.name, attachedAt: Date.now()
    };
    try { cur.propAttachment = attachment; } catch (e) {}
    res.ok = true;
    res.propName = propName;
    res.side = sideN;
    res.handBone = bone.name;
    res.prop = prop;
    notify('success', 'Đã gắn đạo cụ', PROP_DEFS[propName].label + ' đã gắn vào tay ' + (sideN === 'Left' ? 'trái' : 'phải') + '.');
    try { var bus = window.PixiStudio.bus; if (bus && bus.emit) bus.emit('arpqrprop:attached', { propName: propName, side: sideN, handBone: bone.name }); } catch (e) {}
    return res;
  }

  function movePropToHand(side) {
    var res = { ok: false };
    var cur = getAttachedProp();
    if (!cur) {
      res.error = 'Chưa gắn đạo cụ nào — gắn đạo cụ trước rồi mới đổi tay.';
      return res;
    }
    var sideN = normSide(side);
    if (!sideN) {
      res.error = 'Tay đích không hợp lệ: "' + side + '" — dùng "Left" hoặc "Right".';
      return res;
    }
    if (sideN === cur.side) {
      res.ok = true; res.moved = false;
      res.propName = cur.propName; res.side = sideN; res.handBone = cur.handBoneName; res.prop = cur.prop;
      return res;
    }
    var newBone = handBoneFor(sideN);
    if (!newBone) {
      res.error = 'Không có xương tay ' + (sideN === 'Left' ? 'trái (LeftHand)' : 'phải (RightHand)') + ' trong rig hiện tại.';
      return res;
    }
    /* Re-parent + RESET về tư thế cầm mặc định ở tay mới (xem ghi chú đầu file:
     * giữ world transform cũ sẽ để đạo cụ lơ lửng ở chỗ tay cũ). */
    try {
      if (cur.prop.parent) cur.prop.parent.remove(cur.prop);
      defaultGrip(cur.prop);
      newBone.add(cur.prop);
    } catch (e) {
      res.error = 'Không đổi tay được: ' + (e && e.message);
      return res;
    }
    try { if (QR.current && QR.current.target) QR.current.target.updateMatrixWorld(true); } catch (e) {}
    cur.side = sideN;
    cur.handBone = newBone;
    cur.handBoneName = newBone.name;
    res.ok = true; res.moved = true;
    res.propName = cur.propName; res.side = sideN; res.handBone = newBone.name; res.prop = cur.prop;
    notify('success', 'Đã đổi tay', PROP_DEFS[cur.propName].label + ' chuyển sang tay ' + (sideN === 'Left' ? 'trái' : 'phải') + '.');
    try { var bus = window.PixiStudio.bus; if (bus && bus.emit) bus.emit('arpqrprop:moved', { propName: cur.propName, side: sideN, handBone: newBone.name }); } catch (e) {}
    return res;
  }

  function detachProp() {
    var res = { ok: false };
    if (!attachment) {
      res.error = 'Chưa gắn đạo cụ nào.';
      return res;
    }
    var name = attachment.propName;
    try { if (attachment.prop && attachment.prop.parent) attachment.prop.parent.remove(attachment.prop); } catch (e) {}
    attachment = null;
    try { if (QR.current) QR.current.propAttachment = null; } catch (e) {}
    res.ok = true; res.detached = true; res.propName = name;
    notify('info', 'Đã tháo đạo cụ', (PROP_DEFS[name] ? PROP_DEFS[name].label : name) + ' đã tháo khỏi tay.');
    try { var bus = window.PixiStudio.bus; if (bus && bus.emit) bus.emit('arpqrprop:detached', { propName: name }); } catch (e) {}
    return res;
  }

  function getAttachedProp() {
    if (!attachment) return null;
    /* state cũ: control rig đã bị gỡ, hoặc prop bị gỡ khỏi graph từ bên ngoài */
    if (!QR.current || !QR.current.target) { clearStaleState(); return null; }
    if (!attachment.prop || !attachment.prop.parent) { clearStaleState(); return null; }
    return attachment;
  }

  /* ---------------- UI ---------------- */
  function renderSection(container) {
    if (!container) return null;
    var doc = container.ownerDocument || document;
    var wrap = doc.createElement('div');
    wrap.style.cssText = 'border:1px solid #ccc;border-radius:6px;padding:10px;margin:8px 0;font-size:13px;';
    var title = doc.createElement('div');
    title.textContent = 'Đạo cụ (Prop attachment)';
    title.style.cssText = 'font-weight:bold;margin-bottom:6px;';
    wrap.appendChild(title);
    var hint = doc.createElement('div');
    hint.textContent = 'Đạo cụ gắn vào xương bàn tay nên đi theo tay khi xoay IK/FK.';
    hint.style.cssText = 'color:#666;margin-bottom:8px;';
    wrap.appendChild(hint);

    var row1 = doc.createElement('div');
    row1.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap;';
    var lab1 = doc.createElement('label');
    lab1.textContent = 'Đạo cụ: ';
    var selProp = doc.createElement('select');
    ['sword', 'staff', 'box'].forEach(function (k) {
      var o = doc.createElement('option');
      o.value = k; o.textContent = PROP_DEFS[k].label;
      selProp.appendChild(o);
    });
    lab1.appendChild(selProp);
    var lab2 = doc.createElement('label');
    lab2.textContent = 'Tay: ';
    var selSide = doc.createElement('select');
    [['Right', 'Phải'], ['Left', 'Trái']].forEach(function (pair) {
      var o = doc.createElement('option');
      o.value = pair[0]; o.textContent = pair[1];
      selSide.appendChild(o);
    });
    lab2.appendChild(selSide);
    row1.appendChild(lab1);
    row1.appendChild(lab2);
    wrap.appendChild(row1);

    var status = doc.createElement('div');
    status.style.cssText = 'margin:6px 0;color:#333;';
    function refreshStatus() {
      var a = getAttachedProp();
      status.textContent = a
        ? 'Đang gắn: ' + PROP_DEFS[a.propName].label + ' — tay ' + (a.side === 'Left' ? 'trái' : 'phải') + ' (' + a.handBoneName + ')'
        : 'Chưa gắn đạo cụ nào.';
      try { selProp.value = a ? a.propName : selProp.value; selSide.value = a ? a.side : selSide.value; } catch (e) {}
    }
    var row2 = doc.createElement('div');
    row2.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    function mkBtn(text, fn) {
      var b = doc.createElement('button');
      b.textContent = text;
      b.style.cssText = 'padding:4px 10px;cursor:pointer;';
      b.addEventListener('click', function () { fn(); refreshStatus(); });
      row2.appendChild(b);
      return b;
    }
    mkBtn('Gắn', function () {
      var r = attachProp(selProp.value, selSide.value);
      if (!r.ok) status.textContent = 'Lỗi: ' + r.error;
    });
    mkBtn('Đổi tay', function () {
      var other = selSide.value === 'Left' ? 'Right' : 'Left';
      var r = movePropToHand(other);
      if (!r.ok) status.textContent = 'Lỗi: ' + r.error;
      else selSide.value = r.side;
    });
    mkBtn('Tháo', function () {
      var r = detachProp();
      if (!r.ok) status.textContent = 'Lỗi: ' + r.error;
    });
    wrap.appendChild(row2);
    wrap.appendChild(status);
    refreshStatus();
    container.appendChild(wrap);
    return wrap;
  }

  /* ---------------- expose ---------------- */
  var Prop = {
    PROP_DEFS: PROP_DEFS,
    buildSword: buildSword,
    buildStaff: buildStaff,
    buildBox: buildBox,
    attachProp: attachProp,
    movePropToHand: movePropToHand,
    detachProp: detachProp,
    getAttachedProp: getAttachedProp,
    renderSection: renderSection,
    _test: {
      buildSword: buildSword, buildStaff: buildStaff, buildBox: buildBox,
      resolveHeight: resolveHeight, defaultGrip: defaultGrip,
      findPart: findPart, normSide: normSide
    }
  };
  QR.Prop = Prop;
  window.PixiStudio.ArpQuickRig.Prop = Prop;

  /* Hook coordinator sẽ thêm sau: đăng ký section 'prop' vào Quick Rig.
   * Chưa có hook thì module vẫn chạy bình thường (try/catch). */
  try {
    if (typeof QR.registerSection === 'function') QR.registerSection('prop', renderSection);
  } catch (e) {}
})();
