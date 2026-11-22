/* viewport/interaction.js — tương tác scene nâng cao
 *  • Click chọn object, Ctrl/Shift+click chọn nhiều, hover highlight
 *  • Outline quanh object đang chọn (nhiều object cùng lúc)
 *  • Kéo trực tiếp object trong viewport (X/Z trên mặt đất, Shift = trục Y)
 *  • Snap theo lưới, drop-to-floor, reset transform, duplicate, delete
 *  • Camera: FOV, tốc độ orbit, follow object đang chọn, ortho/persp, reset
 *  • Bảng điều khiển nổi trong viewport + HUD thông số object
 */
(function () {
  'use strict';
  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const IX = {
    enabled: true,
    multi: [],              // Object3D[] đang chọn (kể cả object chính)
    hovering: null,
    dragging: false,
    follow: false,
    snap: false,
    snapSize: 0.25,
    orbitSpeed: 1,
    _outlines: null,
    _plane: new THREE.Plane(),
    _ray: new THREE.Raycaster(),
    _pointerNDC: new THREE.Vector2(),
    _dragOffset: new THREE.Vector3(),
    _lastHoverCheck: 0,
    _savedEmissive: new Map()
  };

  /* ---------------- helpers ---------------- */
  function wrap() { return document.getElementById('viewport-canvas-wrap'); }
  function canvas() { return document.getElementById('three-canvas'); }

  function topLevelOf(obj) {
    const root = PixiStudio.Viewport.modelRoot;
    let o = obj;
    while (o) {
      if (PixiStudio.Scene && PixiStudio.Scene.registry[o.uuid]) return o;
      if (o.parent === root) return o;
      o = o.parent;
    }
    return null;
  }

  function ndcFrom(e) {
    const w = wrap(); if (!w) return null;
    const r = w.getBoundingClientRect();
    IX._pointerNDC.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return IX._pointerNDC;
  }

  function pick(e) {
    const cam = PixiStudio.Viewport.orbit && PixiStudio.Viewport.orbit.camera;
    if (!cam) return null;
    const n = ndcFrom(e); if (!n) return null;
    IX._ray.setFromCamera(n, cam);
    const targets = [];
    PixiStudio.Viewport.modelRoot.children.forEach(function (c) { if (c.visible) targets.push(c); });
    if (PixiStudio.Scene) PixiStudio.Scene.forEachPrimitive(function (o) { if (o.visible) targets.push(o); });
    const hits = IX._ray.intersectObjects(targets, true);
    if (!hits.length) return null;
    return topLevelOf(hits[0].object);
  }

  /* ---------------- outline ---------------- */
  function ensureOutlineGroup() {
    if (IX._outlines) return IX._outlines;
    const g = new THREE.Group();
    g.name = '__selection_outline__';
    if (PixiStudio.Viewport.scene) PixiStudio.Viewport.scene.add(g);
    IX._outlines = g;
    return g;
  }

  IX.refreshOutline = function () {
    const g = ensureOutlineGroup();
    while (g.children.length) {
      const c = g.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
    const list = IX.multi.length ? IX.multi : (PixiStudio.State.get('selection') ? [PixiStudio.State.get('selection')] : []);
    list.forEach(function (obj, i) {
      if (!obj || !obj.isObject3D) return;
      let helper = null;
      try { helper = new THREE.BoxHelper(obj, i === 0 ? 0x9a6bff : 0x27bfff); } catch (e) { return; }
      helper.material.depthTest = false;
      helper.material.transparent = true;
      helper.material.opacity = 0.95;
      helper.userData.outlineFor = obj.uuid;
      g.add(helper);
    });
    updateHud();
  };

  IX.updateOutline = function () {
    if (!IX._outlines) return;
    IX._outlines.children.forEach(function (h) { try { h.update(); } catch (e) { } });
  };

  /* ---------------- hover ---------------- */
  function clearHover() {
    if (!IX.hovering) return;
    const saved = IX._savedEmissive.get(IX.hovering.uuid);
    if (saved) {
      IX.hovering.traverse(function (o) {
        if (o.isMesh && o.material && o.material.emissive) {
          const key = o.uuid;
          const v = saved[key];
          if (v) { o.material.emissive.setHex(v.hex); o.material.emissiveIntensity = v.int; }
        }
      });
      IX._savedEmissive.delete(IX.hovering.uuid);
    }
    IX.hovering = null;
    canvas() && (canvas().style.cursor = '');
  }

  function setHover(obj) {
    if (IX.hovering === obj) return;
    clearHover();
    if (!obj) return;
    IX.hovering = obj;
    const rec = {};
    obj.traverse(function (o) {
      if (o.isMesh && o.material && o.material.emissive) {
        rec[o.uuid] = { hex: o.material.emissive.getHex(), int: o.material.emissiveIntensity };
        o.material.emissive.setHex(0x3a2a6a);
        o.material.emissiveIntensity = 0.65;
      }
    });
    IX._savedEmissive.set(obj.uuid, rec);
    if (canvas()) canvas().style.cursor = 'move';
  }

  /* ---------------- selection ---------------- */
  IX.setSelection = function (list, primary) {
    IX.multi = list.filter(Boolean);
    const p = primary || IX.multi[0] || null;
    PixiStudio.State.select(p, { multiCount: IX.multi.length });
    IX.refreshOutline();
    bus.emit('ix:selection', { count: IX.multi.length, name: p ? p.name : null });
  };

  IX.toggleInSelection = function (obj) {
    const i = IX.multi.indexOf(obj);
    if (i >= 0) IX.multi.splice(i, 1);
    else IX.multi.push(obj);
    IX.setSelection(IX.multi, IX.multi[0] || null);
  };

  IX.selectAll = function () {
    const all = [];
    PixiStudio.Viewport.modelRoot.children.forEach(function (c) { if (c.visible) all.push(c); });
    if (PixiStudio.Scene) PixiStudio.Scene.forEachPrimitive(function (o) { if (o.visible) all.push(o); });
    IX.setSelection(all, all[0] || null);
    bus.emit('notify', { type: 'info', title: 'Chọn tất cả', message: all.length + ' object' });
  };

  IX.clearSelection = function () { IX.setSelection([], null); };

  /* ---------------- drag object ---------------- */
  function computeDragPlane(obj) {
    const cam = PixiStudio.Viewport.orbit.camera;
    const worldPos = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
    if (IX.dragAxisLock === 'Y') {
      const normal = cam.getWorldDirection(new THREE.Vector3()).negate();
      normal.y = 0; normal.normalize();
      if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1);
      IX._plane.setFromNormalAndCoplanarPoint(normal, worldPos);
      IX.dragAxis = 'Y';
    } else if (IX.dragAxisLock === 'Z' || IX.dragAxisLock === 'X') {
      const dir = new THREE.Vector3();
      if (IX.dragAxisLock === 'Z') dir.set(0, 0, 1); else dir.set(1, 0, 0);
      const camDir = cam.getWorldDirection(new THREE.Vector3());
      const normal = dir.clone().cross(camDir);
      if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0);
      normal.normalize();
      IX._plane.setFromNormalAndCoplanarPoint(normal, worldPos);
      IX.dragAxis = IX.dragAxisLock;
    } else {
      IX._plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), worldPos);
      IX.dragAxis = 'XZ';
    }
  }

  function startDrag(e, obj) {
    const cam = PixiStudio.Viewport.orbit.camera;
    const n = ndcFrom(e);
    IX._ray.setFromCamera(n, cam);
    const worldPos = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);

    /* AXIS-LOCK: phím X/Y/Z khóa trục kéo (giống Blender/Tripo) */
    if (e.shiftKey) IX.dragAxisLock = 'Y';
    else if (IX._pendingAxisLock) { IX.dragAxisLock = IX._pendingAxisLock; IX._pendingAxisLock = null; }
    else IX.dragAxisLock = null;

    computeDragPlane(obj);

    const hit = new THREE.Vector3();
    if (!IX._ray.ray.intersectPlane(IX._plane, hit)) return false;
    IX._dragOffset.copy(worldPos).sub(hit);
    IX._dragStart = worldPos.clone();
    IX._dragParents = IX.multi.map(function (o) {
      return { obj: o, pos: o.position.clone() };
    });
    IX.dragging = true;
    bus.emit('ix:dragstart', { axis: IX.dragAxis, name: obj.name });
    return true;
  }

  function moveDrag(e) {
    if (!IX.dragging) return;
    /* nếu người dùng bấm X/Y/Z giữa lúc kéo → tái tính mặt phẳng theo trục mới */
    if (IX.dragAxisLock && IX.dragAxisLock !== IX.dragAxis) {
      const anchorObj = IX._dragParents.find(function (r) { return r.obj === (PixiStudio.State.get('selection')); });
      computeDragPlane(anchorObj ? anchorObj.obj : PixiStudio.State.get('selection'));
    }
    const cam = PixiStudio.Viewport.orbit.camera;
    const n = ndcFrom(e);
    IX._ray.setFromCamera(n, cam);
    const hit = new THREE.Vector3();
    if (!IX._ray.ray.intersectPlane(IX._plane, hit)) return;
    const target = hit.add(IX._dragOffset);
    const anchor = (PixiStudio.State.get('selection') || {}).uuid;
    IX._dragParents.forEach(function (rec) {
      const obj = rec.obj;
      if (obj.uuid === anchor) {
        let nx = target.x, ny = target.y, nz = target.z;
        if (IX.dragAxis === 'XZ') { ny = rec.pos.y; }
        else if (IX.dragAxis === 'Y') { nx = rec.pos.x; nz = rec.pos.z; }
        else if (IX.dragAxis === 'Z') { nx = rec.pos.x; ny = rec.pos.y; }
        else if (IX.dragAxis === 'X') { ny = rec.pos.y; nz = rec.pos.z; }
        if (IX.snap) {
          nx = Math.round(nx / IX.snapSize) * IX.snapSize;
          nz = Math.round(nz / IX.snapSize) * IX.snapSize;
          ny = Math.round(ny / IX.snapSize) * IX.snapSize;
        }
        obj.position.set(nx, ny, nz);
      } else if (IX._dragStart) {
        const d = target.clone().sub(IX._dragStart);
        if (IX.dragAxis === 'XZ') d.y = 0;
        else if (IX.dragAxis === 'Y') { d.x = 0; d.z = 0; }
        else if (IX.dragAxis === 'Z') { d.x = 0; d.y = 0; }
        else if (IX.dragAxis === 'X') { d.y = 0; d.z = 0; }
        obj.position.copy(rec.pos).add(d);
      }
    });
    bus.emit('transform:changing', { source: 'viewport-drag', axis: IX.dragAxis });
  }

  function endDrag() {
    if (!IX.dragging) return;
    IX.dragging = false;
    PixiStudio.History.push('Move object');
    bus.emit('transform:changed', { source: 'viewport-drag' });
    bus.emit('ix:dragend', {});
    updateHud();
  }

  /* ---------------- object actions ---------------- */
  IX.dropToFloor = function () {
    const list = IX.multi.length ? IX.multi : (PixiStudio.State.get('selection') ? [PixiStudio.State.get('selection')] : []);
    let n = 0;
    list.forEach(function (obj) {
      if (!obj) return;
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) return;
      obj.position.y -= (box.min.y - 0);
      n++;
    });
    if (n) { PixiStudio.History.push('Drop to floor'); IX.refreshOutline(); bus.emit('notify', { type: 'success', title: 'Drop to floor', message: n + ' object đặt lên mặt lưới' }); }
  };

  IX.resetTransform = function () {
    const list = IX.multi.length ? IX.multi : (PixiStudio.State.get('selection') ? [PixiStudio.State.get('selection')] : []);
    list.forEach(function (obj) {
      if (!obj) return;
      obj.position.set(0, obj.position.y, 0);
      obj.rotation.set(0, 0, 0);
      obj.scale.set(1, 1, 1);
    });
    if (list.length) { PixiStudio.History.push('Reset transform'); IX.refreshOutline(); }
  };

  IX.focusSelected = function () { PixiStudio.Viewport.focusSelected(); };

  IX.frameAll = function () {
    const orbit = PixiStudio.Viewport.orbit;
    const box = new THREE.Box3();
    const list = [];
    PixiStudio.Viewport.modelRoot.children.forEach(function (c) { if (c.visible) list.push(c); });
    if (PixiStudio.Scene) PixiStudio.Scene.forEachPrimitive(function (o) { if (o.visible) list.push(o); });
    if (!list.length) return;
    list.forEach(function (o) { box.expandByObject(o); });
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    orbit.dTarget.copy(center);
    orbit.dRadius = U.clamp(maxDim / (2 * Math.tan((orbit.camera.fov * Math.PI / 180) / 2)) * 1.5, orbit.minRadius, orbit.maxRadius);
    bus.emit('notify', { type: 'info', title: 'Frame all', message: list.length + ' object · bán kính ' + orbit.dRadius.toFixed(1) });
  };

  IX.duplicateSelected = function () {
    const sel = PixiStudio.State.get('selection');
    if (!sel) { bus.emit('notify', { type: 'warning', title: 'Duplicate', message: 'Chưa chọn object.' }); return; }
    PixiStudio.Scene.duplicate(sel);
    bus.emit('notify', { type: 'success', title: 'Duplicate', message: sel.name + ' → bản sao' });
  };

  IX.deleteSelected = function () {
    const sel = PixiStudio.State.get('selection');
    if (!sel) { bus.emit('notify', { type: 'warning', title: 'Delete', message: 'Chưa chọn object.' }); return; }
    PixiStudio.Scene.deleteObject(sel);
    IX.multi = IX.multi.filter(function (o) { return o !== sel; });
    IX.refreshOutline();
  };

  IX.setFov = function (v) {
    const cam = PixiStudio.Viewport.orbit.camera;
    cam.fov = U.clamp(v, 12, 100);
    cam.updateProjectionMatrix();
    bus.emit('ix:camera', { fov: cam.fov });
  };

  IX.setOrbitSpeed = function (v) {
    IX.orbitSpeed = U.clamp(v, 0.2, 3);
    const cam = PixiStudio.Viewport.orbit;
    if (cam) cam.__speed = IX.orbitSpeed;
    bus.emit('ix:camera', { orbitSpeed: IX.orbitSpeed });
  };

  IX.toggleFollow = function (on) {
    IX.follow = on === undefined ? !IX.follow : !!on;
    bus.emit('ix:camera', { follow: IX.follow });
    return IX.follow;
  };

  IX.resetCamera = function () {
    const o = PixiStudio.Viewport.orbit;
    o.dTarget.set(0, 0.9, 0);
    o.dRadius = 5.2;
    o.dTheta = THREE.MathUtils.degToRad(28);
    o.dPhi = THREE.MathUtils.degToRad(72);
    bus.emit('ix:camera', { reset: true });
  };

  IX.toggleOrtho = function () {
    const o = PixiStudio.Viewport.orbit;
    const cam = o.camera;
    if (cam.isOrthographicCamera) {
      const p = new THREE.PerspectiveCamera(38, cam.aspect || 1, 0.1, 500);
      p.position.copy(cam.position);
      p.lookAt(o.target);
      o.camera = p;
    } else {
      const half = Math.max(1, o.radius * 0.4);
      const oc = new THREE.OrthographicCamera(-half * (cam.aspect || 1), half * (cam.aspect || 1), half, -half, 0.1, 500);
      oc.position.copy(cam.position);
      oc.lookAt(o.target);
      o.camera = oc;
    }
    if (PixiStudio.Gizmo && PixiStudio.Gizmo.transformControls) PixiStudio.Gizmo.transformControls.camera = o.camera;
    if (PixiStudio.Controls) PixiStudio.Controls._orbitCam = o;
    bus.emit('ix:camera', { ortho: !!o.camera.isOrthographicCamera });
    bus.emit('notify', { type: 'info', title: 'Camera', message: o.camera.isOrthographicCamera ? 'Orthographic' : 'Perspective' });
  };

  /* ---------------- HUD ---------------- */
  function updateHud() {
    const el = document.getElementById('ix-hud');
    if (!el) return;
    const sel = PixiStudio.State.get('selection');
    if (!sel) { el.innerHTML = '<span class="ix-dim">Chưa chọn object — click vào nhân vật/object trong viewport</span>'; return; }
    sel.updateMatrixWorld(true);
    const p = new THREE.Vector3().setFromMatrixPosition(sel.matrixWorld);
    let tris = 0, meshes = 0, bones = 0;
    sel.traverse(function (o) {
      if (o.isBone) bones++;
      if (o.isMesh && o.geometry) {
        meshes++;
        const g = o.geometry;
        tris += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
      }
    });
    el.innerHTML =
      '<b>' + (sel.name || 'Object') + '</b>' +
      (IX.multi.length > 1 ? ' <span class="ix-badge">+' + (IX.multi.length - 1) + '</span>' : '') +
      '<br><span class="ix-dim">pos</span> ' + p.x.toFixed(2) + ', ' + p.y.toFixed(2) + ', ' + p.z.toFixed(2) +
      '<br><span class="ix-dim">' + meshes + ' mesh · ' + Math.round(tris).toLocaleString('en-US') + ' tris' + (bones ? ' · ' + bones + ' bone' : '') + '</span>';
  }

  /* ---------------- camera panel ---------------- */
  function buildPanel() {
    const w = wrap();
    if (!w || document.getElementById('ix-camera-panel')) return;

    const panel = U.el('div', { id: 'ix-camera-panel', class: 'vp-hud' });
    const head = U.el('div', { class: 'ix-head' }, [
      U.el('span', { text: '🎥 Camera & Scene' })
    ]);
    const toggle = U.el('button', { class: 'ix-tgl', text: '▾' });
    head.appendChild(toggle);
    panel.appendChild(head);
    const body = U.el('div', { class: 'ix-body' });
    /* badge trục khóa khi kéo */
    const lockBadge = U.el('div', { id: 'ix-lock-badge', style: 'display:none;margin-bottom:5px;padding:2px 7px;border-radius:6px;background:#16385f;color:#9fd0ff;font-size:10.5px;font-weight:700;' });
    body.appendChild(lockBadge);
    bus.on('ix:axislock', function (d) {
      if (!lockBadge) return;
      lockBadge.style.display = 'block';
      lockBadge.textContent = '🔒 Trục ' + d.axis.toUpperCase() + ' — kéo chuột để di chuyển dọc trục';
    });
    bus.on('ix:dragend', function () { if (lockBadge) lockBadge.style.display = 'none'; });

    /* row helpers */
    const sliderRow = function (label, min, max, step, value, onInput) {
      const row = U.el('div', { class: 'ix-row' });
      row.appendChild(U.el('span', { class: 'ix-label', text: label }));
      const s = U.el('input', { type: 'range', class: 'ix-range', min: String(min), max: String(max), step: String(step), value: String(value) });
      const v = U.el('span', { class: 'ix-val', text: String(value) });
      s.addEventListener('input', function () { v.textContent = (+s.value).toFixed(2); onInput(parseFloat(s.value)); });
      row.appendChild(s); row.appendChild(v);
      return row;
    };
    const btn = function (label, tip, fn, cls) {
      return U.el('button', { class: 'ix-btn' + (cls ? ' ' + cls : ''), text: label, title: tip || label, onclick: fn });
    };

    body.appendChild(sliderRow('FOV', 15, 90, 1, PixiStudio.Viewport.orbit.camera.fov || 38, function (v) { IX.setFov(v); }));
    body.appendChild(sliderRow('Orbit speed', 0.2, 3, 0.05, IX.orbitSpeed, function (v) { IX.setOrbitSpeed(v); }));
    body.appendChild(sliderRow('Snap size', 0.05, 2, 0.05, IX.snapSize, function (v) { IX.snapSize = v; }));

    const togRow = U.el('div', { class: 'ix-toggles' });
    const mkToggle = function (label, get, set) {
      const b = U.el('button', { class: 'ix-chip' + (get() ? ' on' : ''), text: label });
      b.addEventListener('click', function () {
        const on = !get();
        set(on);
        b.classList.toggle('on', on);
      });
      return b;
    };
    togRow.appendChild(mkToggle('Snap', function () { return IX.snap; }, function (v) { IX.snap = v; PixiStudio.State.set('snapTransform', v); }));
    togRow.appendChild(mkToggle('Follow', function () { return IX.follow; }, function (v) { IX.toggleFollow(v); }));
    body.appendChild(togRow);

    const grid = U.el('div', { class: 'ix-grid' });
    grid.appendChild(btn('Focus (F)', 'Zoom vào object chọn', function () { IX.focusSelected(); }));
    grid.appendChild(btn('Frame all', 'Fit toàn bộ scene (Shift+F)', function () { IX.frameAll(); }));
    grid.appendChild(btn('Ortho/Persp', 'Đổi loại camera', function () { IX.toggleOrtho(); }));
    grid.appendChild(btn('Reset view', 'Về góc nhìn mặc định', function () { IX.resetCamera(); }));
    grid.appendChild(btn('Drop floor', 'Đặt object lên mặt lưới', function () { IX.dropToFloor(); }));
    grid.appendChild(btn('Reset T/R/S', 'Xoá transform object chọn', function () { IX.resetTransform(); }));
    grid.appendChild(btn('Duplicate', 'Nhân bản (Ctrl+D)', function () { IX.duplicateSelected(); }));
    grid.appendChild(btn('Delete', 'Xoá object (Del)', function () { IX.deleteSelected(); }));
    grid.appendChild(btn('Select all', 'Chọn mọi object (Ctrl+A)', function () { IX.selectAll(); }));
    grid.appendChild(btn('Clear', 'Bỏ chọn (Esc)', function () { IX.clearSelection(); }));
    body.appendChild(grid);

    /* ---- Transform đầy đủ: Position / Rotation / Scale + World-Local + Align ---- */
    body.appendChild(U.el('div', { class: 'ix-label', style: 'margin:8px 0 4px;font-weight:700;color:#9db6d8', text: 'OBJECT TRANSFORM' }));
    const readSel = function () { return IX.multi.length ? IX.multi[0] : PixiStudio.State.get('selection'); };
    const makeInputs = function (label, getArr, apply) {
      const row = U.el('div', { class: 'ix-row' });
      row.appendChild(U.el('span', { class: 'ix-label', text: label }));
      ['x', 'y', 'z'].forEach(function (ax, i) {
        const inp = U.el('input', { type: 'number', step: '0.1', class: 'ix-num', value: '' });
        const refresh = function () {
          const s = readSel();
          inp.value = s ? String(Math.round(getArr(s)[i] * 100) / 100) : '';
        };
        inp.addEventListener('focus', refresh);
        inp.addEventListener('change', function () {
          const s = readSel();
          if (!s) return;
          const v = parseFloat(inp.value);
          if (!isFinite(v)) return;
          apply(s, i, v);
          s.updateMatrixWorld(true);
          bus.emit('transform:changed', { source: 'numinput' });
          IX.refreshOutline(); updateHud(); rebuildPanel();
          PixiStudio.History.push(label + ' ' + ax.toUpperCase());
        });
        inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') inp.dispatchEvent(new Event('change')); });
        row.appendChild(inp);
      });
      body.appendChild(row);
    };
    /* Pos: dùng object.position (luôn world) */
    makeInputs('Pos', function (s) { return [s.position.x, s.position.y, s.position.z]; },
      function (s, i, v) { s.position.setComponent(i, v); });
    /* Rot: hiển thị độ, ghi vào euler theo trục (THREE.Euler không có setComponent) */
    makeInputs('Rot°', function (s) { return [THREE.MathUtils.radToDeg(s.rotation.x), THREE.MathUtils.radToDeg(s.rotation.y), THREE.MathUtils.radToDeg(s.rotation.z)]; },
      function (s, i, v) {
        const rad = THREE.MathUtils.degToRad(v);
        if (i === 0) s.rotation.x = rad;
        else if (i === 1) s.rotation.y = rad;
        else s.rotation.z = rad;
      });
    /* Scale */
    makeInputs('Scale', function (s) { return [s.scale.x, s.scale.y, s.scale.z]; },
      function (s, i, v) { s.scale.setComponent(i, Math.max(0.001, v)); });

    /* World/Local toggle cho gizmo */
    const wlRow = U.el('div', { class: 'ix-toggles' });
    const space = function () { return PixiStudio.State.get('gizmoSpace') || 'local'; };
    wlRow.appendChild(mkToggle('World', function () { return space() === 'world'; }, function (v) {
      PixiStudio.State.set('gizmoSpace', v ? 'world' : 'local');
      if (PixiStudio.Gizmo && PixiStudio.Gizmo.setSpace) PixiStudio.Gizmo.setSpace(v ? 'world' : 'local');
      rebuildPanel();
    }));
    wlRow.appendChild(mkToggle('Local', function () { return space() === 'local'; }, function (v) {
      PixiStudio.State.set('gizmoSpace', v ? 'local' : 'world');
      if (PixiStudio.Gizmo && PixiStudio.Gizmo.setSpace) PixiStudio.Gizmo.setSpace(v ? 'local' : 'world');
      rebuildPanel();
    }));
    body.appendChild(wlRow);

    /* Nudge 6 hướng + Align */
    const nRow = U.el('div', { class: 'ix-grid' });
    const mkNudge = function (label, axis, delta, tip) {
      const b = U.el('button', { class: 'ix-btn', text: label, title: tip });
      b.addEventListener('click', function () {
        const list = IX.multi.length ? IX.multi : (PixiStudio.State.get('selection') ? [PixiStudio.State.get('selection')] : []);
        if (!list.length) return;
        list.forEach(function (o) { o.position[axis] += delta; o.updateMatrixWorld(true); });
        bus.emit('transform:changed', { source: 'nudge' });
        PixiStudio.History.push('Nudge ' + axis.toUpperCase());
        IX.refreshOutline(); updateHud(); rebuildPanel();
      });
      return b;
    };
    nRow.appendChild(mkNudge('Y ▲', 'y', 0.25, 'Lên 0.25 (trục Y)'));
    nRow.appendChild(mkNudge('Y ▼', 'y', -0.25, 'Xuống 0.25 (trục Y)'));
    nRow.appendChild(mkNudge('Z ▲', 'z', 0.25, 'Tới 0.25 (trục Z)'));
    nRow.appendChild(mkNudge('Z ▼', 'z', -0.25, 'Lùi 0.25 (trục Z)'));
    nRow.appendChild(mkNudge('X ▲', 'x', 0.25, 'Phải 0.25 (trục X)'));
    nRow.appendChild(mkNudge('X ▼', 'x', -0.25, 'Trái 0.25 (trục X)'));
    body.appendChild(nRow);

    /* Align — đặt nhanh theo bbox/trục */
    const alignRow = U.el('div', { class: 'ix-grid' });
    const align = function (mode) {
      const sel = readSel();
      if (!sel) return;
      sel.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(sel);
      if (b.isEmpty()) return;
      const c = b.getCenter(new THREE.Vector3());
      if (mode === 'floor') sel.position.y -= b.min.y;
      if (mode === 'centerX') sel.position.x -= c.x;
      if (mode === 'centerZ') sel.position.z -= c.z;
      if (mode === 'origin') { sel.position.set(0, sel.position.y - b.min.y, 0); }
      sel.updateMatrixWorld(true);
      bus.emit('transform:changed', { source: 'align' });
      PixiStudio.History.push('Align ' + mode);
      IX.refreshOutline(); updateHud(); rebuildPanel();
    };
    [['Floor', 'floor'], ['Cen X', 'centerX'], ['Cen Z', 'centerZ'], ['Origin', 'origin']].forEach(function (a) {
      alignRow.appendChild(U.el('button', { class: 'ix-btn', text: a[0], title: 'Align: ' + a[0], onclick: function () { align(a[1]); } }));
    });
    body.appendChild(alignRow);

    body.appendChild(U.el('div', { id: 'ix-hud', class: 'ix-hud' }, [U.el('span', { class: 'ix-dim', text: 'Chưa chọn object' })]));
    body.appendChild(U.el('div', { class: 'ix-tip', text: 'Kéo object để di chuyển · X/Y/Z trong lúc kéo = khóa trục · Shift+kéo = trục Y · Ctrl/Shift+click = chọn nhiều' }));

    toggle.addEventListener('click', function () {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      toggle.textContent = hidden ? '▾' : '▸';
    });

    panel.appendChild(body);
    w.appendChild(panel);
  }

  function rebuildPanel() {
    const old = document.getElementById('ix-camera-panel');
    if (old) old.remove();
    buildPanel();
  }

  /* ---------------- events ---------------- */
  IX.init = function () {
    const w = wrap();
    if (!w || !window.THREE) return;

    /* capture phase để giành quyền kéo object trước Controls (orbit) */
    w.addEventListener('pointerdown', function (e) {
      if (!IX.enabled || e.button !== 0) return;
      const mode = PixiStudio.State.get('gizmoMode');
      const tc = PixiStudio.Gizmo && PixiStudio.Gizmo.transformControls;
      /* Gizmo transform ưu tiên tuyệt đối: nếu con trỏ đang trên một trục của
         gizmo (tc.axis) hoặc gizmo đang kéo thì KHÔNG được stopPropagation,
         nếu không TransformControls không nhận được pointerdown và object
         không di chuyển được theo trục X/Y/Z. */
      if (tc && (tc.dragging || tc.axis)) return;
      if (e.altKey) return;
      const hit = pick(e);
      if (!hit) {
        if (mode === 'select') { /* click nền → bỏ chọn do Controls xử lý */ }
        return;
      }
      const multi = e.ctrlKey || e.metaKey;
      if (multi) { IX.toggleInSelection(hit); }
      else {
        if (IX.multi.indexOf(hit) < 0) IX.setSelection([hit], hit);
      }
      if (mode !== 'select') { IX.refreshOutline(); return; }
      if (startDrag(e, hit)) {
        e.stopPropagation();
        e.preventDefault();
      }
    }, { capture: true });

    w.addEventListener('pointermove', function (e) {
      if (IX.dragging) { moveDrag(e); e.stopPropagation(); return; }
      const tc = PixiStudio.Gizmo && PixiStudio.Gizmo.transformControls;
      if (tc && (tc.dragging || tc.axis)) { clearHover(); return; }
      const now = performance.now();
      if (now - IX._lastHoverCheck < 70) return;
      IX._lastHoverCheck = now;
      setHover(pick(e));
    }, { capture: true });

    w.addEventListener('pointerup', function (e) {
      if (IX.dragging) { endDrag(); e.stopPropagation(); }
    }, { capture: true });
    w.addEventListener('pointercancel', function () { endDrag(); }, { capture: true });

    /* follow camera + outline refresh + HUD */
    const prevRender = PixiStudio.Viewport.render;
    PixiStudio.Viewport.render = function (dt) {
      prevRender.call(PixiStudio.Viewport, dt);
      IX.updateOutline();
      if (IX.follow) {
        const sel = PixiStudio.State.get('selection');
        if (sel && PixiStudio.Viewport.orbit) {
          sel.updateMatrixWorld(true);
          const p = new THREE.Vector3().setFromMatrixPosition(sel.matrixWorld);
          PixiStudio.Viewport.orbit.dTarget.lerp(p, 0.25);
        }
      }
    };

    bus.on('selection:changed', function () {
      if (!IX.multi.length || IX.multi.indexOf(PixiStudio.State.get('selection')) < 0) {
        const sel = PixiStudio.State.get('selection');
        IX.multi = sel ? [sel] : [];
      }
      IX.refreshOutline();
      updateHud();
    });
    bus.on('transform:changed', function () { IX.refreshOutline(); updateHud(); });
    bus.on('model:loaded', function () { IX.refreshOutline(); updateHud(); });
    bus.on('scene:changed', function () { IX.refreshOutline(); });

    /* keyboard bổ sung */
    document.addEventListener('keydown', function (e) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      /* AXIS-LOCK trong lúc kéo: X/Y/Z khóa trục di chuyển (giống Blender/Tripo) */
      if (IX.dragging && (e.key === 'x' || e.key === 'X')) { IX.dragAxisLock = 'X'; bus.emit('ix:axislock', { axis: 'X' }); return; }
      if (IX.dragging && (e.key === 'y' || e.key === 'Y')) { IX.dragAxisLock = 'Y'; bus.emit('ix:axislock', { axis: 'Y' }); return; }
      if (IX.dragging && (e.key === 'z' || e.key === 'Z')) { IX.dragAxisLock = 'Z'; bus.emit('ix:axislock', { axis: 'Z' }); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); IX.selectAll(); return; }
      if (e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); IX.frameAll(); return; }
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === 'Backspace') { /* đã xử lý ở shortcuts */ return; }
      if (e.key === ']') { IX.snapSize = Math.min(2, IX.snapSize + 0.05); rebuildPanelValue(); }
      if (e.key === '[') { IX.snapSize = Math.max(0.05, IX.snapSize - 0.05); rebuildPanelValue(); }
      if (e.key === 'o' || e.key === 'O') IX.toggleOrtho();
      if (e.key === 'c' || e.key === 'C') { IX.toggleFollow(); }
    });

    buildPanel();
    IX.refreshOutline();
    updateHud();
  };

  function rebuildPanelValue() {
    const rows = document.querySelectorAll('#ix-camera-panel .ix-row');
    if (rows[2]) {
      const range = rows[2].querySelector('input');
      const val = rows[2].querySelector('.ix-val');
      if (range) range.value = String(IX.snapSize);
      if (val) val.textContent = IX.snapSize.toFixed(2);
    }
  }

  IX.hudRefresh = updateHud;
  window.PixiStudio.Interaction = IX;
  window.PixiStudio.IX = IX;
})();
