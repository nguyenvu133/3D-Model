/* ============================================================
 * physics/physics-manager.js — Rigidbody props, collider visualize,
 * mini gravity sim THẬT (rơi + nảy restitution) + cầu nối sang
 * Physics Engine đầy đủ (js/physics/physics-engine.js: va chạm
 * vật-vật, joint, sàn + tường, stacking, raycast) và Ragdoll
 * (js/physics/physics-ragdoll.js). API cũ GIỮ NGUYÊN: khi engine
 * chưa load, step() vẫn chạy mini-sim như trước; khi engine đã
 * load, startSim() tạo engine body và engine điều khiển vật.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Physics = {
    bodies: {},         // uuid -> { mass, gravity, friction, bounciness, collider, colliderSize, sim }
    simulating: false,
    GRAVITY: -9.8
  };

  Physics.ensure = function (uuid) {
    if (!Physics.bodies[uuid]) {
      Physics.bodies[uuid] = {
        mass: 1,
        gravity: true,
        friction: 0.6,
        bounciness: 0.3,
        collider: 'box',
        colliderSize: [1, 1, 1],
        sim: false,
        _vel: [0, 0, 0],
        _rest: null
      };
    }
    return Physics.bodies[uuid];
  };

  Physics.setCollider = function (uuid, type, size) {
    const body = Physics.ensure(uuid);
    body.collider = type;
    if (size) body.colliderSize = size;
    /* Undo/Redo toàn diện (v2): collider nằm trong snapshot physics */
    if (window.PixiStudio && PixiStudio.History) PixiStudio.History.push('Physics: collider ' + type);
  };

  Physics.get = function (uuid) {
    return Physics.ensure(uuid);
  };

  /* ---------- CẦU NỐI SANG ENGINE ĐẦY ĐỦ (v5.1) ---------- */
  Physics.engine = function () {
    return (window.PixiStudio && window.PixiStudio.PhysicsEngine) || null;
  };
  Physics.ragdoll = function () {
    return (window.PixiStudio && window.PixiStudio.PhysicsRagdoll) || null;
  };
  /* tạo engine body từ props legacy của 1 object (collider box/sphere/capsule) */
  Physics.addBody = function (object3D, opts) {
    var E = Physics.engine();
    if (!E || !object3D) return null;
    var legacy = Physics.ensure(object3D.uuid);
    opts = opts || {};
    var shape;
    var type = opts.collider || legacy.collider || 'box';
    var size = opts.size || legacy.colliderSize || [1, 1, 1];
    if (type === 'sphere') shape = { type: 'sphere', radius: (size[0] || 1) / 2 };
    else if (type === 'capsule') shape = { type: 'capsule', radius: (size[0] || 0.4) / 2, halfLen: Math.max((size[1] || 1) / 2 - (size[0] || 0.4) / 2, 0.05), axis: new THREE.Vector3(0, 1, 0) };
    else shape = { type: 'box', size: size };
    var body = E.createBody({
      object3D: object3D,
      shape: shape,
      mass: opts.mass != null ? opts.mass : legacy.mass,
      restitution: opts.restitution != null ? opts.restitution : legacy.bounciness,
      friction: opts.friction != null ? opts.friction : legacy.friction,
      velocity: opts.velocity || new THREE.Vector3(0, 0, 0)
    });
    legacy._engineBodyId = body.id;
    legacy._inEngine = true;
    return body;
  };
  Physics.removeBody = function (object3D) {
    var E = Physics.engine();
    var legacy = object3D ? Physics.bodies[object3D.uuid] : null;
    if (E && legacy && legacy._engineBodyId) {
      var b = E.getBody(legacy._engineBodyId);
      if (b) E.removeBody(b);
    }
    if (legacy) { legacy._engineBodyId = null; legacy._inEngine = false; }
  };
  Physics.getEngineBody = function (object3D) {
    var E = Physics.engine();
    var legacy = object3D ? Physics.bodies[object3D.uuid] : null;
    if (!E || !legacy || !legacy._engineBodyId) return null;
    return E.getBody(legacy._engineBodyId);
  };
  Physics.addJoint = function (type, bodyA, bodyB, opts) {
    var E = Physics.engine();
    if (!E) return null;
    return E.addJoint(type, bodyA, bodyB, opts);
  };
  Physics.raycastDown = function (origin, maxDist) {
    var E = Physics.engine();
    if (!E) return [];
    return E.raycastDown(origin, maxDist);
  };
  Physics.setWorldBounds = function (bounds) {
    var E = Physics.engine();
    if (E) E.setBounds(bounds);
  };
  Physics.getStats = function () {
    var E = Physics.engine();
    return E ? E.stats() : { steps: 0, broadphasePairs: 0, narrowphaseTests: 0, contacts: 0 };
  };

  /* ---------- COLLIDER VISUALIZE (thật) ---------- */
  Physics.showCollider = function (object3D, on) {
    if (!object3D) return;
    const existing = object3D.getObjectByName('__phys_collider__');
    if (existing) object3D.remove(existing);
    if (!on) return;

    const box = new THREE.Box3().setFromObject(object3D);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const edges = new THREE.EdgesGeometry(geo);
    const collider = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x27bfff, transparent: true, opacity: 0.85 }));
    collider.name = '__phys_collider__';
    collider.position.copy(center).sub(object3D.position);
    object3D.add(collider);
    const body = Physics.ensure(object3D.uuid);
    body.colliderSize = [size.x, size.y, size.z];
  };

  /* ---------- MINI SIMULATION (thật: Euler integration) ---------- */
  Physics.startSim = function () {
    const sel = PixiStudio.State.get('selection');
    const target = sel || PixiStudio.Viewport.getMainModel();
    if (!target) {
      bus.emit('notify', { type: 'warning', title: 'Physics', message: 'Chưa có object nào để simulate.' });
      return;
    }
    const body = Physics.ensure(target.uuid);
    body.sim = true;
    body._vel = [0, 2.5, 0];
    body._rest = target.position.clone();
    Physics.simulating = true;
    Physics.showCollider(target, true);
    /* engine đầy đủ: tạo engine body (rơi/nảy/va chạm do engine xử lý) */
    var E = Physics.engine();
    if (E) {
      var eb = Physics.addBody(target, { velocity: new THREE.Vector3(0, 2.5, 0) });
      if (eb) { eb._restPos = target.position.clone(); eb._restQuat = target.quaternion.clone(); }
      E.start();
      bus.emit('notify', { type: 'info', title: 'Physics Sim START', message: 'Engine đầy đủ trên ' + target.name + ' — mass ' + body.mass + ', bounce ' + body.bounciness + ' (va chạm vật-vật, sàn + tường).' });
      return;
    }
    bus.emit('notify', { type: 'info', title: 'Physics Sim START', message: 'Mini gravity sim trên ' + target.name + ' — mass ' + body.mass + ', bounce ' + body.bounciness });
  };

  Physics.stopSim = function (restore) {
    Physics.simulating = false;
    const sel = PixiStudio.State.get('selection');
    const target = sel || PixiStudio.Viewport.getMainModel();
    if (target) {
      const body = Physics.bodies[target.uuid];
      if (body) body.sim = false;
      Physics.showCollider(target, false);
      if (restore && body && body._rest) {
        target.position.copy(body._rest);
      }
      /* gỡ engine body (nếu có) để không chạy ngầm */
      var E = Physics.engine();
      if (E && body && body._inEngine) {
        Physics.removeBody(target);
        if (!E.bodies.length) E.stop();
        if (restore && body._rest) target.position.copy(body._rest);
      }
    }
    bus.emit('notify', { type: 'info', title: 'Physics Sim STOP', message: restore ? 'Đã reset vị trí object.' : 'Simulation dừng.' });
  };

  Physics.step = function (dt) {
    if (!Physics.simulating) return;
    /* engine đầy đủ (nếu đã load và đang chạy): va chạm, joint, sàn/tường, stacking */
    var E = Physics.engine();
    if (E && E.simulating) {
      E.step(dt);
      /* đồng bộ vận tốc legacy để Inspector/panel đọc được */
      Object.keys(Physics.bodies).forEach(function (uuid) {
        var lb = Physics.bodies[uuid];
        if (!lb._inEngine || !lb._engineBodyId) return;
        var eb = E.getBody(lb._engineBodyId);
        if (eb) lb._vel = [eb.velocity.x, eb.velocity.y, eb.velocity.z];
      });
      var R = Physics.ragdoll();
      if (R && R.active) R.update();
      /* mini-sim cho body legacy chưa vào engine (nếu còn) — chạy tiếp bên dưới */
    }
    Object.keys(Physics.bodies).forEach(function (uuid) {
      const body = Physics.bodies[uuid];
      if (!body.sim || body._inEngine) return; /* body trong engine: engine đã xử lý */
      const reg = PixiStudio.Scene.registry[uuid];
      const obj = (reg && reg.object3D) || null;
      if (!obj || !obj.parent) return;

      const height = body.colliderSize[1] || 1;
      const halfH = height / 2;

      if (body.gravity) {
        body._vel[1] += Physics.GRAVITY * dt * Math.max(0.1, body.mass);
        obj.position.y += body._vel[1] * dt;

        /* chạm đất — restitution + friction */
        if (obj.position.y - halfH <= 0) {
          obj.position.y = halfH;
          if (Math.abs(body._vel[1]) > 0.4) {
            body._vel[1] = -body._vel[1] * body.bounciness;
            body._vel[1] *= (1 - body.friction * 0.3);
          } else {
            body._vel[1] = 0;
          }
        }
      }
    });
  };

  /* ============================================================
     UI: physics section trong Inspector (được inspector gọi)
     ============================================================ */
  Physics.renderSection = function (container, object3D) {
    container.innerHTML = '';
    if (!object3D) {
      container.appendChild(U.el('div', { class: 'empty-state', style: 'padding:14px;' }, [
        U.el('span', { text: 'Chọn object để xem Physics properties.' })
      ]));
      return;
    }
    const body = Physics.ensure(object3D.uuid);

    const row = function (label, control) {
      return U.el('div', { class: 'toggle-row' }, [
        U.el('span', { class: 't-label', text: label }),
        control
      ]);
    };

    /* Rigidbody */
    const rbToggle = U.el('div', { class: 'toggle' + (body.sim || body.gravity ? ' on' : '') });
    rbToggle.addEventListener('click', function () {
      body.gravity = !body.gravity;
      rbToggle.classList.toggle('on', body.gravity);
      /* Undo/Redo toàn diện (v2) */
      if (PixiStudio.History) PixiStudio.History.push('Physics: Rigidbody ' + (body.gravity ? 'on' : 'off'));
    });
    container.appendChild(row('Rigidbody (gravity)', rbToggle));

    /* Collider type */
    const cw = U.el('div', { class: 'select-wrap', style: 'width:120px;' });
    const cs = U.el('select', { class: 'select', style: 'height:26px;font-size:11px;' });
    ['box', 'sphere', 'capsule'].forEach(function (t) {
      const o = U.el('option', { value: t, text: t });
      if (t === body.collider) o.selected = true;
      cs.appendChild(o);
    });
    cs.addEventListener('change', function () {
      body.collider = cs.value;
      Physics.showCollider(object3D, true);
      /* Undo/Redo toàn diện (v2) */
      if (PixiStudio.History) PixiStudio.History.push('Physics: collider ' + cs.value);
    });
    cw.appendChild(cs);
    container.appendChild(row('Collider', cw));

    /* Sliders: mass / friction / bounciness */
    [['mass', 'Mass', 0.1, 10, 0.1], ['friction', 'Friction', 0, 1, 0.05], ['bounciness', 'Bounciness', 0, 1, 0.05]].forEach(function (sdef) {
      const srow = U.el('div', { class: 'slider-row' }, [
        U.el('span', { class: 's-label', text: sdef[1] })
      ]);
      const s = U.el('input', { type: 'range', class: 'slider', min: String(sdef[2]), max: String(sdef[3]), step: String(sdef[4]), value: String(body[sdef[0]]) });
      const val = U.el('span', { class: 's-val', text: String(body[sdef[0]]) });
      s.addEventListener('input', function () {
        body[sdef[0]] = parseFloat(s.value);
        val.textContent = s.value;
      });
      /* Undo/Redo toàn diện (v2): 'change' = thả slider, 1 lần kéo = 1 bước */
      s.addEventListener('change', function () {
        if (PixiStudio.History) PixiStudio.History.push('Physics: ' + sdef[1] + ' ' + s.value);
      });
      srow.appendChild(s); srow.appendChild(val);
      container.appendChild(srow);
    });

    /* Sim buttons */
    const btns = U.el('div', { style: 'display:flex;gap:6px;margin-top:10px;' }, [
      U.el('button', { class: 'btn sm primary grow', html: U.icon('physics') + ' Simulate', onclick: function () { Physics.startSim(); } }),
      U.el('button', { class: 'btn sm grow', html: U.icon('stop') + ' Reset', onclick: function () { Physics.stopSim(true); } })
    ]);
    container.appendChild(btns);

    /* Mở panel Physics đầy đủ (tab Physics trong ARP) */
    const panelBtn = U.el('button', {
      class: 'btn sm block', style: 'margin-top:6px;',
      html: U.icon('physics') + ' Mở Panel Physics (bodies / joints / ragdoll)',
      onclick: function () {
        const PP = window.PixiStudio && window.PixiStudio.PhysicsPanel;
        if (PP && PP.open) PP.open();
        else bus.emit('notify', { type: 'warning', title: 'Physics', message: 'Chưa load js/physics/physics-panel.js.' });
      }
    });
    container.appendChild(panelBtn);

    container.appendChild(U.el('div', { class: 'empty-state', style: 'padding:8px;' }, [
      U.el('span', { class: 'state-badge ok', text: Physics.engine() ? 'Engine đầy đủ: va chạm vật-vật + joint + ragdoll + stacking' : 'Mini sim (gravity + bounce) — engine đầy đủ chưa load' })
    ]));
  };

  window.PixiStudio.Physics = Physics;
})();
