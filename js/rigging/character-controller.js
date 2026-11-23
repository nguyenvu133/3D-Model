/* ============================================================
 * rigging/character-controller.js — Character Controller (v21.0)
 *
 * Điều khiển nhân vật đã rig đi lại ngay trong viewport để preview
 * animation: WASD / phím mũi tên di chuyển, Shift chạy, Space nhảy.
 * Tự đổi clip Idle / Walk / Run theo tốc độ và xoay nhân vật theo
 * hướng di chuyển. setInput() để test không cần bàn phím.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;

  const WALK_SPEED = 1.6;   // m/s
  const RUN_SPEED = 4.2;    // m/s
  const JUMP_VEL = 5.0;
  const GRAVITY = -12;

  const Controller = {
    enabled: false,
    rig: null,
    keys: {},
    input: { forward: false, back: false, left: false, right: false, run: false },
    velY: 0,
    grounded: true,
    groundY: 0,
    yaw: 0,
    currentClip: null,
    _bound: false
  };

  Controller.WALK_SPEED = WALK_SPEED;
  Controller.RUN_SPEED = RUN_SPEED;

  function onKey(e, down) {
    if (!Controller.enabled) return;
    const k = e.key ? e.key.toLowerCase() : '';
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'shift'].indexOf(k) < 0) return;
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0 && e.preventDefault) e.preventDefault();
    Controller.keys[k] = down;
    if (k === ' ' && down) Controller.jump();
  }

  Controller.attach = function (rig) {
    rig = rig || (PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current);
    if (!rig || !rig.target) return false;
    Controller.rig = rig;
    Controller.groundY = rig.target.position.y;
    Controller.yaw = rig.target.rotation.y || 0;
    Controller.velY = 0;
    Controller.grounded = true;
    if (typeof window !== 'undefined' && !Controller._bound) {
      Controller._bound = true;
      window.addEventListener('keydown', function (e) { onKey(e, true); });
      window.addEventListener('keyup', function (e) { onKey(e, false); });
    }
    return true;
  };

  Controller.detach = function () {
    Controller.rig = null;
    Controller.keys = {};
    Controller.input = { forward: false, back: false, left: false, right: false, run: false };
    Controller.currentClip = null;
  };

  Controller.setEnabled = function (on) {
    Controller.enabled = !!on;
    if (on && !Controller.rig) Controller.attach();
    if (!on) Controller.keys = {};
    return Controller.enabled;
  };

  /* Input lập trình (test + nút trên mobile): thay toàn bộ trạng thái. */
  Controller.setInput = function (inp) {
    Controller.input = { forward: false, back: false, left: false, right: false, run: false };
    for (const k in inp) Controller.input[k] = !!inp[k];
  };

  Controller.jump = function () {
    if (!Controller.grounded || !Controller.rig) return false;
    Controller.velY = JUMP_VEL;
    Controller.grounded = false;
    return true;
  };

  function readMove() {
    const k = Controller.keys, inp = Controller.input;
    const f = (k['w'] || k['arrowup'] || inp.forward) ? 1 : 0;
    const b = (k['s'] || k['arrowdown'] || inp.back) ? 1 : 0;
    const l = (k['a'] || k['arrowleft'] || inp.left) ? 1 : 0;
    const r = (k['d'] || k['arrowright'] || inp.right) ? 1 : 0;
    const run = !!(k['shift'] || inp.run);
    return { x: r - l, z: f - b, run: run };
  }

  function driveClip(want) {
    if (want === Controller.currentClip) return;
    Controller.currentClip = want;
    const AG = PixiStudio.AnimAutoGen;
    if (AG && AG.play && Controller.rig && Controller.rig.clips) {
      const has = Controller.rig.clips.some(function (c) { return c.id === want; });
      if (has) AG.play(want);
    }
    bus.emit('controller:clip', { clip: want });
  }

  /* Gọi mỗi frame từ App tick. */
  Controller.update = function (dt) {
    if (!Controller.enabled || !Controller.rig || !Controller.rig.target) return;
    const t = Controller.rig.target;
    const mv = readMove();
    const len = Math.hypot(mv.x, mv.z);
    const speed = mv.run ? RUN_SPEED : WALK_SPEED;
    if (len > 0) {
      const nx = mv.x / len, nz = mv.z / len;
      // hướng di chuyển theo yaw hiện tại của nhân vật
      const sin = Math.sin(Controller.yaw), cos = Math.cos(Controller.yaw);
      const wx = nx * cos + nz * sin;
      const wz = -nx * sin + nz * cos;
      t.position.x += wx * speed * dt;
      t.position.z += wz * speed * dt;
      // xoay nhân vật về hướng di chuyển
      const targetYaw = Math.atan2(wx, wz);
      let d = targetYaw - Controller.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      Controller.yaw += d * Math.min(1, dt * 10);
      t.rotation.y = Controller.yaw;
      driveClip(mv.run ? 'Run' : 'Walk');
    } else {
      driveClip('Idle');
    }
    // nhảy / trọng lực
    if (!Controller.grounded) {
      Controller.velY += GRAVITY * dt;
      t.position.y += Controller.velY * dt;
      if (t.position.y <= Controller.groundY) {
        t.position.y = Controller.groundY;
        Controller.velY = 0;
        Controller.grounded = true;
      }
    }
  };

  window.PixiStudio.CharacterController = Controller;
})();
