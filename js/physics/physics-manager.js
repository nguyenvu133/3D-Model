/* ============================================================
 * physics/physics-manager.js — Rigidbody props, collider visualize,
 * mini gravity sim THẬT (rơi + nảy restitution). Full engine → v5.1.
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
  };

  Physics.get = function (uuid) {
    return Physics.ensure(uuid);
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
    }
    bus.emit('notify', { type: 'info', title: 'Physics Sim STOP', message: restore ? 'Đã reset vị trí object.' : 'Simulation dừng.' });
  };

  Physics.step = function (dt) {
    if (!Physics.simulating) return;
    Object.keys(Physics.bodies).forEach(function (uuid) {
      const body = Physics.bodies[uuid];
      if (!body.sim) return;
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
      srow.appendChild(s); srow.appendChild(val);
      container.appendChild(srow);
    });

    /* Sim buttons */
    const btns = U.el('div', { style: 'display:flex;gap:6px;margin-top:10px;' }, [
      U.el('button', { class: 'btn sm primary grow', html: U.icon('physics') + ' Simulate', onclick: function () { Physics.startSim(); } }),
      U.el('button', { class: 'btn sm grow', html: U.icon('stop') + ' Reset', onclick: function () { Physics.stopSim(true); } })
    ]);
    container.appendChild(btns);

    container.appendChild(U.el('div', { class: 'empty-state', style: 'padding:8px;' }, [
      U.el('span', { class: 'state-badge pending', text: 'Mini sim (gravity + bounce) — engine đầy đủ (Rapier) ở v5.1' })
    ]));
  };

  window.PixiStudio.Physics = Physics;
})();
