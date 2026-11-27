/* ============================================================
 * rig/arp-boneshape.js — BONE SHAPE EDITOR (Auto Rig Pro Blend, PHẦN C)
 *
 * Hiển thị xương bằng bone mesh RIÊNG (không sửa SkeletonHelper gốc):
 * mỗi xương có một mesh hình thoi/octahedron kéo dài theo đoạn xương
 * (từ bone tới bone con), đặt trong group `__arp_boneshape__` gắn
 * vào model/scene. Bật/tắt hiển thị được.
 *
 *   setShape(boneName, {length, thickness, style}) — length/thickness
 *     là hệ số (mặc định 1), style 'octahedron' | 'box' | 'sphere'.
 *   Mirror (mặc định BẬT): setShape cho xương Left thì tự áp cùng
 *     shape sang xương Right tương ứng, và ngược lại.
 *   Reset: trả mọi xương về shape mặc định.
 *
 * GIỚI HẠN TRUNG THỰC: bone shape chỉ đổi HIỂN THỊ (mesh phụ trong
 * viewport), không đổi skeleton, không đổi skin, không đổi export.
 * ============================================================ */
(function () {
  'use strict';

  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };
  var U = (window.PixiStudio && PixiStudio.Utils) || null;

  var BoneShape = {
    current: null,   /* { target, group, entries:{dst->{bone,mesh,baseLength,baseThickness,shape,childName}}, visible } */
    mirror: true,    /* mặc định BẬT */
    DEFAULT_SHAPE: { length: 1, thickness: 1, style: 'octahedron' }
  };

  var STYLES = ['octahedron', 'box', 'sphere'];
  BoneShape.STYLES = STYLES;

  function notify(type, title, message, duration) {
    try { bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 }); } catch (e) {}
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function stripName(name) {
    var s = String(name == null ? '' : name);
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    return s;
  }
  BoneShape.stripName = stripName;

  /* mirrorName: LeftArm ↔ RightArm, giữ nguyên prefix mixamorig: nếu có.
     Xương không có cặp (Hips/Spine/Head...) → null. */
  function mirrorName(name) {
    var s = String(name == null ? '' : name);
    var base = stripName(s);
    var prefix = s.slice(0, s.length - base.length);
    if (/^Left/i.test(base)) return prefix + 'Right' + base.slice(4);
    if (/^Right/i.test(base)) return prefix + 'Left' + base.slice(5);
    return null;
  }
  BoneShape.mirrorName = mirrorName;

  function collectBones(root) {
    var out = [];
    if (!root || !root.traverse) return out;
    root.traverse(function (o) { if (o.isBone) out.push(o); });
    return out;
  }

  function makeGeometry(style) {
    var T = window.THREE;
    if (style === 'box') return new T.BoxGeometry(1, 1, 1);
    if (style === 'sphere') return new T.SphereGeometry(1, 10, 8);
    return new T.OctahedronGeometry(1, 0);
  }

  /* Dựng bone mesh cho toàn bộ skeleton của target. */
  function buildBoneShapes(target, opts) {
    opts = opts || {};
    target = target || getTarget();
    if (!target || !target.traverse) return { ok: false, error: 'Chưa có model nào.' };
    if (!window.THREE) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var bones = collectBones(target);
    if (!bones.length) return { ok: false, error: 'Model chưa có skeleton — Bone Shape cần model đã rig.' };
    clearBoneShapes(target, true);
    target.updateMatrixWorld(true);
    var group = new window.THREE.Group();
    group.name = '__arp_boneshape__';
    target.add(group);
    var box = new window.THREE.Box3();
    try { box.setFromObject(target); } catch (e) {}
    var H = 1.8;
    try { var s = box.getSize(new window.THREE.Vector3()); if (s.y > 0.01) H = s.y; } catch (e) {}
    var entries = {};
    var up = new window.THREE.Vector3(0, 1, 0);
    bones.forEach(function (bone) {
      var kids = bone.children.filter(function (c) { return c.isBone; });
      var startW = new window.THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
      var endW, childName = null;
      if (kids.length) {
        endW = new window.THREE.Vector3().setFromMatrixPosition(kids[0].matrixWorld);
        childName = kids[0].name;
      } else {
        /* leaf: đoạn ngắn hướng xuống, dài 3% chiều cao */
        endW = startW.clone().add(new window.THREE.Vector3(0, -H * 0.03, 0));
      }
      var segLen = Math.max(0.01, startW.distanceTo(endW));
      var dir = endW.clone().sub(startW).normalize();
      var midW = startW.clone().add(endW).multiplyScalar(0.5);
      var mesh = new window.THREE.Mesh(
        makeGeometry('octahedron'),
        new window.THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.55, depthTest: false }));
      mesh.name = '__arp_boneshape_' + stripName(bone.name);
      mesh.userData.isBoneShapeVisual = true;
      /* Quy ước repo: mesh trang trí của xương PHẢI có isBoneVisual để
         FBXBinary.write / GLBWriter bỏ qua — nếu không file FBX export sẽ
         chứa thêm 41 mesh xương (cùng lỗi đã sửa ở các module arp-vp-*). */
      mesh.userData.isBoneVisual = true;
      mesh.userData.boneName = bone.name;
      mesh.position.copy(group.worldToLocal(midW.clone()));
      mesh.quaternion.setFromUnitVectors(up, dir);
      /* OctahedronGeometry(1) cao 2 đơn vị theo Y → scale.y = segLen/2;
         dày mặc định 8% độ dài đoạn xương. */
      var baseThickness = Math.max(0.004, segLen * 0.08);
      mesh.scale.set(baseThickness, segLen / 2, baseThickness);
      mesh.userData.baseScale = { x: baseThickness, y: segLen / 2, z: baseThickness };
      group.add(mesh);
      entries[stripName(bone.name)] = {
        bone: bone, mesh: mesh, childName: childName,
        baseLength: segLen, baseThickness: baseThickness,
        shape: { length: 1, thickness: 1, style: 'octahedron' }
      };
      /* key đầy đủ tên gốc để tra cứu linh hoạt */
      entries[bone.name] = entries[stripName(bone.name)];
    });
    BoneShape.current = {
      target: target, group: group, entries: entries, height: H,
      visible: opts.visible !== undefined ? !!opts.visible : true,
      boneCount: bones.length
    };
    group.visible = BoneShape.current.visible;
    return { ok: true, boneCount: bones.length, group: group };
  }
  BoneShape.buildBoneShapes = buildBoneShapes;
  BoneShape.build = buildBoneShapes;

  function getTarget() {
    if (window.PixiStudio && PixiStudio.State && PixiStudio.State.get) {
      try { var sel = PixiStudio.State.get('selection'); if (sel) return sel; } catch (e) {}
    }
    if (window.PixiStudio && PixiStudio.Viewport && PixiStudio.Viewport.getMainModel) {
      try { return PixiStudio.Viewport.getMainModel(); } catch (e) {}
    }
    if (window.PixiStudio && PixiStudio.ArpQuickRig && PixiStudio.ArpQuickRig.current) {
      return PixiStudio.ArpQuickRig.current.target;
    }
    return null;
  }

  function lookupEntry(name) {
    var cur = BoneShape.current;
    if (!cur) return null;
    var s = stripName(name);
    return cur.entries[s] || cur.entries[name] || null;
  }

  function applyShapeToEntry(entry, shape) {
    if (!entry || !entry.mesh) return false;
    var mesh = entry.mesh;
    if (shape.style && STYLES.indexOf(shape.style) >= 0 && shape.style !== entry.shape.style) {
      try {
        var old = mesh.geometry;
        mesh.geometry = makeGeometry(shape.style);
        if (old && old.dispose) old.dispose();
      } catch (e) {}
    }
    if (shape.length !== undefined) entry.shape.length = clamp(Number(shape.length) || 1, 0.1, 4);
    if (shape.thickness !== undefined) entry.shape.thickness = clamp(Number(shape.thickness) || 1, 0.1, 5);
    if (shape.style && STYLES.indexOf(shape.style) >= 0) entry.shape.style = shape.style;
    var bs = mesh.userData.baseScale;
    mesh.scale.set(
      bs.x * entry.shape.thickness,
      bs.y * entry.shape.length,
      bs.z * entry.shape.thickness);
    return true;
  }

  /* setShape: chỉnh 1 xương; Mirror BẬT → áp cùng shape sang phía đối xứng. */
  function setShape(boneName, shape) {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape — bấm "Hiện xương" / chọn model đã rig trước.' };
    shape = shape || {};
    var entry = lookupEntry(boneName);
    if (!entry) return { ok: false, error: 'Không tìm thấy xương: ' + boneName };
    applyShapeToEntry(entry, shape);
    var mirrored = null;
    if (BoneShape.mirror) {
      var twin = mirrorName(boneName);
      if (twin) {
        var twinEntry = lookupEntry(twin);
        if (twinEntry && twinEntry !== entry) {
          applyShapeToEntry(twinEntry, entry.shape);
          mirrored = twin;
        }
      }
    }
    return { ok: true, bone: stripName(boneName), shape: Object.assign({}, entry.shape), mirrored: mirrored };
  }
  BoneShape.setShape = setShape;

  function getShape(boneName) {
    var entry = lookupEntry(boneName);
    return entry ? Object.assign({}, entry.shape) : null;
  }
  BoneShape.getShape = getShape;

  BoneShape.listBones = function () {
    var cur = BoneShape.current;
    if (!cur) return [];
    var seen = {}, out = [];
    Object.keys(cur.entries).forEach(function (k) {
      var s = stripName(k);
      if (!seen[s]) { seen[s] = true; out.push(s); }
    });
    return out;
  };

  function reset() {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    var count = 0;
    var seen = {};
    Object.keys(cur.entries).forEach(function (k) {
      var entry = cur.entries[k];
      if (seen[entry.bone.name]) return;
      seen[entry.bone.name] = true;
      applyShapeToEntry(entry, { length: 1, thickness: 1, style: 'octahedron' });
      count++;
    });
    notify('info', 'Bone Shape', 'Đã reset ' + count + ' xương về shape mặc định.');
    return { ok: true, resetCount: count };
  }
  BoneShape.reset = reset;

  function setVisible(visible) {
    var cur = BoneShape.current;
    if (!cur) {
      /* chưa dựng: thử dựng từ model hiện tại rồi áp visibility */
      var r = buildBoneShapes(getTarget());
      if (!r.ok) return false;
      cur = BoneShape.current;
    }
    cur.visible = visible === undefined ? !cur.visible : !!visible;
    cur.group.visible = cur.visible;
    return cur.visible;
  }
  BoneShape.setVisible = setVisible;
  BoneShape.toggleVisible = setVisible;

  function clearBoneShapes(target, silent) {
    target = target || (BoneShape.current && BoneShape.current.target);
    if (!target) return false;
    var removed = false;
    (target.children || []).slice().forEach(function (c) {
      if (c.name === '__arp_boneshape__') { target.remove(c); removed = true; }
    });
    if (BoneShape.current && BoneShape.current.target === target) BoneShape.current = null;
    if (!silent && removed) notify('info', 'Bone Shape', 'Đã gỡ bone shape khỏi model.');
    return removed;
  }
  BoneShape.clearBoneShapes = clearBoneShapes;

  /* Cập nhật lại vị trí/hướng mesh theo pose xương hiện tại. */
  function refresh() {
    var cur = BoneShape.current;
    if (!cur) return { ok: false, error: 'Chưa dựng bone shape.' };
    cur.target.updateMatrixWorld(true);
    var up = new window.THREE.Vector3(0, 1, 0);
    var seen = {};
    Object.keys(cur.entries).forEach(function (k) {
      var entry = cur.entries[k];
      if (seen[entry.bone.name]) return;
      seen[entry.bone.name] = true;
      var bone = entry.bone;
      var kids = bone.children.filter(function (c) { return c.isBone; });
      var startW = new window.THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
      var endW = kids.length
        ? new window.THREE.Vector3().setFromMatrixPosition(kids[0].matrixWorld)
        : startW.clone().add(new window.THREE.Vector3(0, -cur.height * 0.03, 0));
      var midW = startW.clone().add(endW).multiplyScalar(0.5);
      var dir = endW.clone().sub(startW);
      var len = Math.max(0.01, dir.length());
      dir.normalize();
      entry.mesh.position.copy(cur.group.worldToLocal(midW.clone()));
      entry.mesh.quaternion.setFromUnitVectors(up, dir);
      entry.baseLength = len;
      var bs = entry.mesh.userData.baseScale;
      bs.y = len / 2;
      entry.mesh.scale.set(bs.x * entry.shape.thickness, bs.y * entry.shape.length, bs.z * entry.shape.thickness);
    });
    return { ok: true };
  }
  BoneShape.refresh = refresh;

  /* ---------- UI — tab Bone Shape ---------- */
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

  function renderBoneShapeTab(container) {
    if (!container) return;
    container.innerHTML = '';
    var wrap = el('div', { class: 'arp-boneshape-tab' });
    wrap.appendChild(el('div', { class: 'arp-note', html:
      '<b>Bone Shape Editor</b> — chỉnh hình dạng hiển thị của xương (mesh phụ, không đổi skeleton/skin/export). ' +
      'Mirror mặc định BẬT: đổi xương trái thì xương phải đổi theo.' }));
    var state = { bone: 'LeftArm', length: 1, thickness: 1, style: 'octahedron' };
    var applyCurrent = function () {
      var r = setShape(state.bone, { length: state.length, thickness: state.thickness, style: state.style });
      if (!r.ok) notify('warning', 'Bone Shape', r.error);
    };
    /* dropdown xương */
    var rowBone = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0' } });
    rowBone.appendChild(el('span', { text: 'Xương', style: { width: '90px' } }));
    var selBone = el('select', { style: { flex: '1' } });
    var fillBones = function () {
      selBone.innerHTML = '';
      var names = BoneShape.listBones();
      if (!names.length) {
        var QR = window.PixiStudio && PixiStudio.ArpQuickRig;
        if (QR && QR.BONE_DEFS) names = QR.BONE_DEFS.map(function (d) { return d.name; });
        else names = ['Hips', 'Spine', 'LeftArm', 'RightArm'];
      }
      names.forEach(function (n) {
        var opt = el('option', { value: n, text: n });
        if (n === state.bone) opt.selected = true;
        selBone.appendChild(opt);
      });
    };
    selBone.addEventListener('change', function () { state.bone = selBone.value; });
    rowBone.appendChild(selBone);
    rowBone.appendChild(el('button', { class: 'btn sm', text: 'Hiện xương', onclick: function () {
      var r = buildBoneShapes(getTarget());
      if (!r.ok) notify('warning', 'Bone Shape', r.error);
      else { fillBones(); notify('success', 'Bone Shape', 'Đã hiện ' + r.boneCount + ' xương (mesh riêng, SkeletonHelper gốc không đổi).'); }
    } }));
    wrap.appendChild(rowBone);
    var mkSlider = function (label, min, max, step, key) {
      var row = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0' } });
      row.appendChild(el('span', { text: label, style: { width: '90px' } }));
      var inp = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(state[key]), style: { flex: '1' } });
      var valEl = el('span', { text: String(state[key]), style: { width: '36px' } });
      inp.addEventListener('input', function () { valEl.textContent = inp.value; state[key] = parseFloat(inp.value); applyCurrent(); });
      row.appendChild(inp); row.appendChild(valEl);
      return row;
    };
    wrap.appendChild(mkSlider('Length', 0.5, 2, 0.05, 'length'));
    wrap.appendChild(mkSlider('Thickness', 0.5, 3, 0.05, 'thickness'));
    /* style */
    var rowStyle = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0' } });
    rowStyle.appendChild(el('span', { text: 'Style', style: { width: '90px' } }));
    var selStyle = el('select', { style: { flex: '1' } });
    STYLES.forEach(function (s) {
      var opt = el('option', { value: s, text: s });
      if (s === state.style) opt.selected = true;
      selStyle.appendChild(opt);
    });
    selStyle.addEventListener('change', function () { state.style = selStyle.value; applyCurrent(); });
    rowStyle.appendChild(selStyle);
    wrap.appendChild(rowStyle);
    /* mirror toggle */
    var rowMirror = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0' } });
    var mirrorChk = el('input', { type: 'checkbox' });
    mirrorChk.checked = BoneShape.mirror;
    mirrorChk.addEventListener('change', function () { BoneShape.mirror = !!mirrorChk.checked; });
    rowMirror.appendChild(mirrorChk);
    rowMirror.appendChild(el('span', { text: 'Mirror (trái ↔ phải)' }));
    wrap.appendChild(rowMirror);
    /* nút */
    var btnRow = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '6px 0' } });
    btnRow.appendChild(el('button', { class: 'btn sm', text: 'Reset', onclick: function () { reset(); } }));
    btnRow.appendChild(el('button', { class: 'btn sm', text: 'Bật/tắt hiển thị xương', onclick: function () { setVisible(); } }));
    btnRow.appendChild(el('button', { class: 'btn sm', text: 'Cập nhật vị trí xương', onclick: function () { refresh(); } }));
    wrap.appendChild(btnRow);
    container.appendChild(wrap);
    fillBones();
  }
  BoneShape.renderTab = renderBoneShapeTab;

  BoneShape._test = { mirrorName: mirrorName, makeGeometry: makeGeometry, STYLES: STYLES, stripName: stripName };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpBoneShape = BoneShape;
  if (window.PixiStudio.ArpPanel && typeof PixiStudio.ArpPanel.registerTab === 'function') {
    try { PixiStudio.ArpPanel.registerTab('boneshape', 'Bone Shape', renderBoneShapeTab); } catch (e) {}
  }
})();
