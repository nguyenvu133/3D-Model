/* ============================================================
 * physics/physics-panel.js — Panel Physics đầy đủ.
 * Đăng ký tab "Physics" vào ArpPanel (nếu có) + render được gọi
 * từ Inspector qua PixiStudio.Physics.renderSection (nút mở panel).
 * Nội dung: bật/tắt sim, cài đặt thế giới (trọng lực, sàn, tường
 * bao, số vòng lặp solver), danh sách body (sửa mass/friction/
 * bounce/collider từng body, hiện/ẩn collider, xóa), danh sách
 * joint, Ragdoll (build/bật/tắt từ model đang chọn).
 * Mọi thao tác đều guard khi engine chưa load (chỉ hiện mini-sim).
 * ============================================================ */
(function () {
  'use strict';

  var U = (window.PixiStudio && window.PixiStudio.Utils) || null;
  var bus = (window.PixiStudio && window.PixiStudio.bus) || null;
  function engine() { return window.PixiStudio && window.PixiStudio.PhysicsEngine; }
  function ragdoll() { return window.PixiStudio && window.PixiStudio.PhysicsRagdoll; }
  function physics() { return window.PixiStudio && window.PixiStudio.Physics; }
  function notify(type, title, message) {
    if (bus) bus.emit('notify', { type: type, title: title, message: message });
  }

  var Panel = {
    _container: null,
    _showColliders: false
  };

  function el(tag, attrs, children) {
    if (U && U.el) return U.el(tag, attrs, children);
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null) return;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    }
    return n;
  }
  function row(label, control) {
    return el('div', { class: 'toggle-row' }, [
      el('span', { class: 't-label', text: label }), control
    ]);
  }
  function numInput(value, step, min, max, onChange) {
    var inp = el('input', { type: 'number', class: 'phys-num', value: String(value), step: String(step == null ? 0.1 : step) });
    if (min != null) inp.min = String(min);
    if (max != null) inp.max = String(max);
    inp.addEventListener('change', function () {
      var v = parseFloat(inp.value);
      if (isFinite(v)) onChange(v);
    });
    return inp;
  }
  function sliderRow(label, value, min, max, step, onChange) {
    var srow = el('div', { class: 'slider-row' }, [el('span', { class: 's-label', text: label })]);
    var s = el('input', { type: 'range', class: 'slider', min: String(min), max: String(max), step: String(step), value: String(value) });
    var val = el('span', { class: 's-val', text: String(value) });
    s.addEventListener('input', function () { val.textContent = s.value; onChange(parseFloat(s.value)); });
    srow.appendChild(s); srow.appendChild(val);
    return srow;
  }

  Panel.render = function (container) {
    Panel._container = container || Panel._container;
    var c = Panel._container;
    if (!c) return;
    c.innerHTML = '';
    var E = engine(), P = physics();

    /* ---- header: sim on/off ---- */
    var simOn = (E && E.simulating) || (P && P.simulating);
    var head = el('div', { class: 'phys-head' }, [
      el('span', { class: 'phys-title', text: 'Physics Engine' }),
      el('button', {
        class: 'btn sm ' + (simOn ? 'danger' : 'primary'),
        text: simOn ? '■ Dừng sim' : '▶ Chạy sim',
        onclick: function () {
          if (E) { if (E.simulating) { E.stop(); } else { E.start(); } }
          if (P) { if (simOn) P.stopSim(false); else P.startSim(); }
          Panel.refresh();
        }
      })
    ]);
    c.appendChild(head);

    if (!E) {
      c.appendChild(el('div', { class: 'empty-state', style: 'padding:10px;' }, [
        el('span', { text: 'Engine đầy đủ chưa load (thiếu js/physics/physics-engine.js) — đang dùng mini-sim (rơi + nảy).' })
      ]));
      return;
    }

    /* ---- cài đặt thế giới ---- */
    var world = el('div', { class: 'section-block' }, [
      el('div', { class: 'section-head' }, [el('span', { text: 'Thế giới' })])
    ]);
    var wc = el('div', { class: 'section-content' });
    wc.appendChild(sliderRow('Trọng lực', -E.gravity.y, 0, 30, 0.5, function (v) { E.gravity.y = -v; }));
    wc.appendChild(sliderRow('Solver lặp', E.iterations, 1, 30, 1, function (v) { E.iterations = Math.round(v); }));
    var floorT = el('div', { class: 'toggle' + (E.floorEnabled ? ' on' : '') });
    floorT.addEventListener('click', function () { E.floorEnabled = !E.floorEnabled; floorT.classList.toggle('on', E.floorEnabled); });
    wc.appendChild(row('Sàn (y = ' + E.floorY + ')', floorT));
    var bT = el('div', { class: 'toggle' + (E.bounds ? ' on' : '') });
    bT.addEventListener('click', function () {
      E.bounds = E.bounds ? null : { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
      bT.classList.toggle('on', !!E.bounds);
      Panel.refresh();
    });
    wc.appendChild(row('Tường bao (±5m)', bT));
    if (E.bounds) {
      wc.appendChild(row('Nửa rộng tường (m)', numInput(E.bounds.maxX, 0.5, 1, 50, function (v) {
        E.bounds = { minX: -v, maxX: v, minZ: -v, maxZ: v };
      })));
    }
    world.appendChild(wc);
    c.appendChild(world);

    /* ---- danh sách body ---- */
    var bodies = el('div', { class: 'section-block' }, [
      el('div', { class: 'section-head' }, [el('span', { text: 'Bodies trong scene (' + E.bodies.length + ')' })])
    ]);
    var bc = el('div', { class: 'section-content' });
    var addBtns = el('div', { style: 'display:flex;gap:6px;margin-bottom:8px;' }, [
      el('button', {
        class: 'btn sm primary grow', text: '+ Thêm body từ object đang chọn',
        onclick: function () {
          var sel = null;
          try { sel = window.PixiStudio.State.get('selection') || (window.PixiStudio.Viewport && window.PixiStudio.Viewport.getMainModel()); } catch (e) { sel = null; }
          if (!sel) { notify('warning', 'Physics', 'Chưa chọn object nào.'); return; }
          var P2 = physics();
          var legacy = P2 ? P2.get(sel.uuid) : null;
          var b = E.createBody({
            object3D: sel,
            mass: legacy ? legacy.mass : 1,
            restitution: legacy ? legacy.bounciness : 0.3,
            friction: legacy ? legacy.friction : 0.6,
            shape: { type: legacy ? legacy.collider : 'box', size: legacy ? legacy.colliderSize : [1, 1, 1] }
          });
          if (P2) P2.showCollider(sel, true);
          notify('info', 'Physics', 'Đã thêm body: ' + (b.label || b.id));
          Panel.refresh();
        }
      })
    ]);
    bc.appendChild(addBtns);
    if (!E.bodies.length) {
      bc.appendChild(el('div', { class: 'empty-state', style: 'padding:8px;' }, [
        el('span', { text: 'Chưa có body. Bấm nút trên để thêm object đang chọn, hoặc bấm Simulate trong Inspector.' })
      ]));
    }
    E.bodies.forEach(function (b) {
      var item = el('div', { class: 'phys-body' });
      var title = el('div', { class: 'phys-body-title' }, [
        el('span', { text: (b.label || b.id) + ' · ' + b.shape.type + (b.isStatic ? ' · tĩnh' : '') + (b.sleeping ? ' · ngủ' : '') })
      ]);
      var del = el('button', {
        class: 'btn sm', text: '✕',
        onclick: function () { E.removeBody(b); Panel.refresh(); }
      });
      title.appendChild(del);
      item.appendChild(title);
      item.appendChild(sliderRow('Mass', b.mass, 0, 20, 0.1, function (v) {
        b.mass = v; b.invMass = v > 0 ? 1 / v : 0; b.isStatic = v <= 0;
      }));
      item.appendChild(sliderRow('Friction', b.friction, 0, 1, 0.05, function (v) { b.friction = v; }));
      item.appendChild(sliderRow('Bounciness', b.restitution, 0, 1, 0.05, function (v) { b.restitution = v; }));
      var pos = el('div', { class: 'phys-pos', text: 'pos (' + b.position.x.toFixed(2) + ', ' + b.position.y.toFixed(2) + ', ' + b.position.z.toFixed(2) + ') · v ' + b.velocity.length().toFixed(2) + ' m/s' });
      item.appendChild(pos);
      var shapeSel = el('select', { class: 'select', style: 'height:26px;font-size:11px;width:110px;' });
      ['box', 'sphere', 'capsule'].forEach(function (t) {
        var o = el('option', { value: t, text: t });
        if (t === b.shape.type) o.selected = true;
        shapeSel.appendChild(o);
      });
      shapeSel.addEventListener('change', function () {
        var t = shapeSel.value;
        if (t === 'sphere') b.shape = { type: 'sphere', radius: 0.5 };
        else if (t === 'capsule') b.shape = { type: 'capsule', radius: 0.2, halfLen: 0.3, axis: new THREE.Vector3(0, 1, 0) };
        else b.shape = { type: 'box', half: new THREE.Vector3(0.5, 0.5, 0.5) };
        if (b.object3D && physics()) physics().showCollider(b.object3D, true);
        Panel.refresh();
      });
      var stT = el('div', { class: 'toggle' + (b.isStatic ? ' on' : '') });
      stT.addEventListener('click', function () {
        b.isStatic = !b.isStatic; b.invMass = b.isStatic ? 0 : (b.mass > 0 ? 1 / b.mass : 0);
        stT.classList.toggle('on', b.isStatic); Panel.refresh();
      });
      item.appendChild(row('Collider', shapeSel));
      item.appendChild(row('Tĩnh (không rơi)', stT));
      bc.appendChild(item);
    });
    bodies.appendChild(bc);
    c.appendChild(bodies);

    /* ---- joints ---- */
    var joints = el('div', { class: 'section-block' }, [
      el('div', { class: 'section-head' }, [el('span', { text: 'Joints (' + E.joints.length + ')' })])
    ]);
    var jc = el('div', { class: 'section-content' });
    if (!E.joints.length) {
      jc.appendChild(el('div', { class: 'empty-state', style: 'padding:8px;' }, [
        el('span', { text: 'Chưa có joint. Ragdoll tự tạo joint; hoặc nối 2 body bằng API PhysicsEngine.addJoint(type, bodyA, bodyB, opts).' })
      ]));
    }
    E.joints.slice(0, 30).forEach(function (j) {
      jc.appendChild(el('div', { class: 'phys-joint' }, [
        el('span', { text: j.type + ' · ' + (j.a.label || j.a.id) + ' ↔ ' + (j.b.label || j.b.id) + (j.type === 'spring' ? ' · k=' + j.stiffness : '') }),
        el('button', {
          class: 'btn sm', text: '✕',
          onclick: function () { E.removeJoint(j); Panel.refresh(); }
        })
      ]));
    });
    if (E.joints.length > 30) jc.appendChild(el('div', { class: 'empty-state' }, [el('span', { text: '…và ' + (E.joints.length - 30) + ' joint nữa' })]));
    joints.appendChild(jc);
    c.appendChild(joints);

    /* ---- collider hiển thị ---- */
    var vis = el('div', { class: 'section-block' }, [
      el('div', { class: 'section-head' }, [el('span', { text: 'Hiển thị' })])
    ]);
    var vc = el('div', { class: 'section-content' });
    var cvT = el('div', { class: 'toggle' + (Panel._showColliders ? ' on' : '') });
    cvT.addEventListener('click', function () {
      Panel._showColliders = !Panel._showColliders;
      cvT.classList.toggle('on', Panel._showColliders);
      var P2 = physics();
      E.bodies.forEach(function (b) { if (b.object3D && P2) P2.showCollider(b.object3D, Panel._showColliders); });
    });
    vc.appendChild(row('Hiện collider tất cả body', cvT));
    vis.appendChild(vc);
    c.appendChild(vis);

    /* ---- ragdoll ---- */
    var R = ragdoll();
    if (R) {
      var rg = el('div', { class: 'section-block' }, [
        el('div', { class: 'section-head' }, [el('span', { text: 'Ragdoll' })])
      ]);
      var rc = el('div', { class: 'section-content' });
      var st = R.getState();
      rc.appendChild(el('div', { class: 'phys-pos', text: st.active ? ('ĐANG BẬT · ' + st.boneCount + ' xương · ' + st.bodyCount + ' body · ' + st.jointCount + ' joint') : 'Đang tắt — animation điều khiển nhân vật.' }));
      var rgBtns = el('div', { style: 'display:flex;gap:6px;margin-top:6px;' }, [
        el('button', {
          class: 'btn sm primary grow', text: 'Bật ragdoll (model đang chọn)',
          onclick: function () {
            var sel = null;
            try { sel = window.PixiStudio.State.get('selection') || (window.PixiStudio.Viewport && window.PixiStudio.Viewport.getMainModel()); } catch (e) { sel = null; }
            if (!sel) { notify('warning', 'Ragdoll', 'Chưa chọn model nào.'); return; }
            var r = R.enable(sel);
            notify(r.ok ? 'info' : 'warning', 'Ragdoll', r.ok ? ('Đã bật: ' + r.boneCount + ' xương, ' + r.jointCount + ' joint.') : ('Không bật được: ' + (r.reason || '?')));
            Panel.refresh();
          }
        }),
        el('button', {
          class: 'btn sm grow', text: 'Tắt (trả pose)',
          onclick: function () { R.disable(); notify('info', 'Ragdoll', 'Đã tắt ragdoll, trả về pose cũ.'); Panel.refresh(); }
        })
      ]);
      rc.appendChild(rgBtns);
      rc.appendChild(el('div', { class: 'empty-state', style: 'padding:8px;' }, [
        el('span', { text: 'Mỗi xương = 1 body (capsule chi, sphere đầu, box thân). Bật → nhân vật đổ theo vật lý; tắt → trả pose, animation chạy lại.' })
      ]));
      rg.appendChild(rc);
      c.appendChild(rg);
    }

    /* ---- stats ---- */
    var s = E.stats();
    c.appendChild(el('div', { class: 'phys-stats', text:
      'step ' + s.steps + ' · cặp broadphase ' + s.broadphasePairs + ' · contact ' + s.contacts +
      ' · bodies ' + E.bodies.length + ' · joints ' + E.joints.length }));
  };

  Panel.refresh = function () {
    if (Panel._container) Panel.render(Panel._container);
  };

  Panel.open = function () {
    var AP = window.PixiStudio && window.PixiStudio.ArpPanel;
    if (AP && typeof AP.open === 'function') { AP.open('physics'); return true; }
    if (bus) bus.emit('notify', { type: 'info', title: 'Physics', message: 'Panel Physics đã đăng ký tab trong ARP — mở ARP rồi chọn tab Physics.' });
    return false;
  };

  Panel.register = function () {
    var AP = window.PixiStudio && window.PixiStudio.ArpPanel;
    if (AP && typeof AP.registerTab === 'function') {
      try { AP.registerTab('physics', 'Physics', function (container) { Panel.render(container); }); return true; } catch (e) { return false; }
    }
    return false;
  };

  Panel._test = { render: Panel.render };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.PhysicsPanel = Panel;
  /* tự đăng ký khi ArpPanel đã load trước; nếu load sau, app/coordinator gọi lại register() */
  Panel.register();
})();
