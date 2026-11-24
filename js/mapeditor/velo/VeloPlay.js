/* ============================================================
 * mapeditor/velo/VeloPlay.js — "Run Velo" trong trình duyệt.
 *
 * BẢN PORT JS (three.js) của luật chơi demo3d Velo — KHÔNG chạy
 * engine V, KHÔNG biên dịch code V. Logic file .v (game.v /
 * combat.v / main.v, công khai trong repo velo-engine/velo)
 * chỉ được ĐỌC để port các con số + quy tắc sang JS; code dưới
 * đây viết lại hoàn toàn bằng JS/three.js. Xem docs/VELO_INTEGRATION.md
 * §9 để biết bảng port + giới hạn (không có Trail3D/Particles3D thật,
 * autopilot dash dùng xác suất 2%/frame như gốc...).
 *
 * Cấu trúc: `VeloPlay.Core` là logic thuần (không DOM, không THREE)
 * để test được bằng node; phần adapter bên dưới nối Core với
 * MapEditor/Viewport3D thật (object, camera rig, HUD DOM, joystick,
 * WebAudio). Nút ▶ Run Velo được thêm bằng JS (không sửa MapEditor.html).
 * ============================================================ */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  root.MapEditor = root.MapEditor || {};
  var ME = root.MapEditor;

  /* Prefab id demo3d (theo .meta trong repo Velo): orb/slime/drone/golem. */
  var PREFAB_KIND = { d3a10002: 'orb', d3a10003: 'slime', d3a10004: 'drone', d3a10005: 'golem' };
  var HERO_MODEL_ID = 'a3d0f8b1';

  /* ================= CORE — logic thuần, port từ game.v/combat.v ================= */
  var C = {
    /* HeroController (game.v) */
    HERO_SPEED: 5, DASH_SPEED: 12, DASH_TIME: 0.3, DASH_CD: 0.7,
    TURN_SPEED: 900 * Math.PI / 180, ARENA: 24, CLIP_SPEED: 3.6,
    AUTOPILOT_DELAY: 5, DUST_EVERY: 1.4, DASH_PUFFS: 14,
    /* FollowCamera (game.v; scene override 7.5/3.2, default V là 7/3) */
    CAM_DIST: 7.5, CAM_HEIGHT: 3.2, CAM_SMOOTH: 6, ORBIT_SPEED: 120 * Math.PI / 180,
    DRAG_DEG_PER_PX: 0.3,
    /* SlimeHop */
    SLIME_HOP: 0.55, SLIME_REST: 0.45, SLIME_HEIGHT: 0.9, SLIME_SPEED: 2.6, SLIME_SIGHT: 9,
    SLIME_BUMP_XZ: 0.9, SLIME_BUMP_Y: 0.6,
    /* DroneHover + DroneGun */
    DRONE_RADIUS: 3, DRONE_SPEED: 0.6, DRONE_BOB: 0.3, DRONE_TILT_DEG: -18,
    GUN_RANGE: 10, GUN_INTERVAL: 3.5, GUN_SPEED: 9,
    /* GolemWalk + GolemSlam */
    GOLEM_DIST: 8, GOLEM_SPEED: 1.3, GOLEM_SWING_DEG: 28,
    SLAM_RANGE: 3, SLAM_HIT: 2.4, SLAM_WINDUP: 0.7, SLAM_CD: 2.5,
    /* OrbPickup + OrbSpawner (default V là count 8/radius 14) */
    ORB_RADIUS: 1, ORB_RESPAWN_MIN: 3, ORB_RESPAWN_MAX: 16, ORB_ARMED: 0.5,
    /* Health */
    HERO_MAX_HP: 8, ENEMY_MAX_HP: 3, HERO_INVULN: 1, ENEMY_INVULN: 0.15,
    HERO_RESPAWN: 2, ENEMY_RESPAWN: 6,
    /* Projectile: bolt */
    BOLT_SPEED: 16, BOLT_LIFE: 2.5, BOLT_RADIUS: 0.7,
    /* HeroCombat */
    SLASH_DMG: 1, SLASH_RANGE: 2.4, SLASH_ARC_DEG: 120, SLASH_CD: 0.4,
    BOLT_DMG: 2, BOLT_CD: 0.7,
    /* HealZone */
    HEAL_RADIUS: 1.5, HEAL_RATE: 1,
    /* Thắng */
    WIN_ORBS: 20
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function angDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  }
  function dist2(ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function newState(opts) {
    opts = opts || {};
    return {
      time: 0, orbCount: 0, kills: 0, hp: C.HERO_MAX_HP, maxHp: C.HERO_MAX_HP,
      won: false, winTarget: C.WIN_ORBS, rng: opts.rng || Math.random,
      hero: {
        x: 0, z: 0, vx: 0, vz: 0, yaw: 0, kx: 0, kz: 0,
        hp: C.HERO_MAX_HP, maxHp: C.HERO_MAX_HP,
        dashT: 0, dashCd: 0, dashX: 0, dashZ: 1,
        lastInput: -99, idleT: 0, dustAcc: 0, deadT: 0, invulnT: 0,
        healAcc: 0, slashCd: 0, boltCd: 0, moving: false, speed: 0,
        homeX: 0, homeZ: 0, dead: false
      },
      enemies: [], orbs: [], bolts: [], heals: [],
      cam: { yaw: 0, x: 0, y: C.CAM_HEIGHT, z: -C.CAM_DIST, lx: 0, ly: 1.1, lz: 0 },
      events: []
    };
  }
  function pushEvent(st, ev) { st.events.push(ev); }

  function addEnemy(st, o) {
    o = o || {};
    var en = {
      id: o.id || ('en' + st.enemies.length), kind: o.kind || 'slime',
      x: o.x || 0, z: o.z || 0, y: o.y || 0, homeX: o.x || 0, homeZ: o.z || 0,
      scale: o.scale || 1, hp: o.hp || C.ENEMY_MAX_HP, maxHp: o.hp || C.ENEMY_MAX_HP,
      invulnT: 0, dead: false, deadT: 0, flashT: 0,
      kx: 0, kz: 0, cycle: o.cycle || 0, angle: o.angle || 0,
      orbitSpeed: o.orbitSpeed || C.DRONE_SPEED, orbitRadius: o.orbitRadius || C.DRONE_RADIUS,
      wanderX: null, wanderZ: null, sx: 1, sy: 1, tiltZ: 0, hipY: 0, swing: 0,
      gunCd: C.GUN_INTERVAL, slamCd: 0, slamWindup: -1, ph: 0, yaw: o.yaw || 0,
      facing: o.yaw || 0, r: o.r || 0.6, radius: o.radius || 0, speed: o.speed || 0
    };
    st.enemies.push(en);
    return en;
  }
  function addOrb(st, o) {
    o = o || {};
    var orb = { id: o.id || ('orb' + st.orbs.length), x: o.x || 0, z: o.z || 0, armed: o.armed !== undefined ? o.armed : 1 };
    st.orbs.push(orb);
    return orb;
  }
  function randomOrbPos(st) {
    var r = C.ORB_RESPAWN_MIN + st.rng() * (C.ORB_RESPAWN_MAX - C.ORB_RESPAWN_MIN);
    var a = st.rng() * Math.PI * 2;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }
  function nearestOrb(st) {
    var h = st.hero, best = null, bd = 1e9;
    st.orbs.forEach(function (o) {
      var d = dist2(h.x, h.z, o.x, o.z);
      if (d < bd) { bd = d; best = o; }
    });
    return best ? { orb: best, dist: bd } : null;
  }

  function doDash(st, auto) {
    var h = st.hero;
    if (h.dashCd > 0 || h.dashT > 0 || h.dead) return false;
    h.dashT = C.DASH_TIME;
    h.dashCd = auto ? C.DASH_CD * 3 : C.DASH_CD;
    pushEvent(st, { type: 'puff', n: C.DASH_PUFFS, x: h.x, z: h.z });
    return true;
  }
  function damageHero(st, dmg, fx, fz) {
    var h = st.hero;
    if (h.invulnT > 0 || h.dead) return false;
    h.hp -= dmg;
    h.invulnT = C.HERO_INVULN;
    var dx = h.x - (fx || h.x), dz = h.z - (fz || h.z);
    var len = Math.hypot(dx, dz) || 1;
    h.kx = dx / len * 9; h.kz = dz / len * 9;
    pushEvent(st, { type: 'hurt', hp: h.hp });
    if (h.hp <= 0) {
      h.hp = 0; h.dead = true; h.deadT = C.HERO_RESPAWN;
      st.orbCount = 0; /* hero chết reset orbs về 0 (game.v) */
      pushEvent(st, { type: 'heroDead' });
    }
    return true;
  }
  function damageEnemy(st, en, dmg, fx, fz) {
    if (en.dead || en.invulnT > 0) return false;
    en.hp -= dmg;
    en.invulnT = C.ENEMY_INVULN;
    en.flashT = 0.15;
    var dx = en.x - (fx !== undefined ? fx : en.x), dz = en.z - (fz !== undefined ? fz : en.z);
    var len = Math.hypot(dx, dz) || 1;
    en.kx = dx / len * 7; en.kz = dz / len * 7;
    pushEvent(st, { type: 'enemyHit', id: en.id, hp: en.hp });
    if (en.hp <= 0) {
      en.hp = 0; en.dead = true; en.deadT = C.ENEMY_RESPAWN;
      st.kills++;
      pushEvent(st, { type: 'enemyDead', id: en.id, kills: st.kills });
    }
    return true;
  }

  function stepHero(st, inp, dt) {
    var h = st.hero;
    if (h.slashCd > 0) h.slashCd -= dt;
    if (h.boltCd > 0) h.boltCd -= dt;
    if (h.dashCd > 0) h.dashCd -= dt;
    if (h.invulnT > 0) h.invulnT -= dt;
    if (h.dead) {
      h.deadT -= dt;
      if (h.deadT <= 0) {
        h.x = h.homeX; h.z = h.homeZ; h.vx = 0; h.vz = 0; h.kx = 0; h.kz = 0;
        h.hp = h.maxHp; h.invulnT = 1; h.dead = false;
        pushEvent(st, { type: 'respawn' });
      }
      return;
    }
    var mx = inp.mx || 0, mz = inp.mz || 0;
    var mag = inp.mag === undefined ? 1 : inp.mag;
    var hasInput = (mx !== 0 || mz !== 0);
    if (hasInput) {
      h.lastInput = st.time;
      var l = Math.hypot(mx, mz) || 1;
      mx /= l; mz /= l;
    }
    /* autopilot (game.v): sau 5s không nhập liệu → tự chạy tới orb gần nhất;
     * orb xa >9m thì dash (2% mỗi frame, cooldown x3); tự đánh bên dưới. */
    var auto = false;
    if (!hasInput && st.time - h.lastInput > C.AUTOPILOT_DELAY) {
      var near = nearestOrb(st);
      if (near) {
        auto = true;
        var d = near.dist || 0.001;
        mx = (near.orb.x - h.x) / d; mz = (near.orb.z - h.z) / d;
        if (near.dist > 9 && h.dashCd <= 0 && st.rng() < 0.02) {
          h.dashX = mx; h.dashZ = mz;
          doDash(st, true);
        }
      }
    }
    if (inp.dash) {
      h.dashX = hasInput ? mx : Math.sin(h.yaw);
      h.dashZ = hasInput ? mz : Math.cos(h.yaw);
      doDash(st, false);
    }
    var desVx = 0, desVz = 0;
    if (h.dashT > 0) {
      h.dashT -= dt;
      desVx = h.dashX * C.DASH_SPEED; desVz = h.dashZ * C.DASH_SPEED;
    } else if (hasInput || auto) {
      desVx = mx * C.HERO_SPEED * mag; desVz = mz * C.HERO_SPEED * mag;
    }
    /* velocity lerp k=min(1,dt*10) — dash dt*20 (game.v) */
    var k = Math.min(1, dt * (h.dashT > 0 ? 20 : 10));
    h.vx += (desVx - h.vx) * k;
    h.vz += (desVz - h.vz) * k;
    /* knockback decay (1-dt*6) */
    var kd = Math.max(0, 1 - dt * 6);
    h.kx *= kd; h.kz *= kd;
    h.x += (h.vx + h.kx) * dt;
    h.z += (h.vz + h.kz) * dt;
    /* arena clamp 24m */
    var r = Math.hypot(h.x, h.z);
    if (r > C.ARENA) { h.x *= C.ARENA / r; h.z *= C.ARENA / r; }
    if (hasInput || auto) h.yaw = Math.atan2(mx, mz);
    var sp = Math.hypot(h.vx, h.vz);
    h.speed = sp; h.moving = sp > 0.5;
    if (h.moving) {
      h.idleT = 0;
      h.dustAcc += sp * dt;
      if (h.dustAcc >= C.DUST_EVERY) { h.dustAcc -= C.DUST_EVERY; pushEvent(st, { type: 'puff', n: 2, x: h.x, z: h.z }); }
    } else {
      h.idleT += dt;
    }
    /* chém (J/click): slash range 2.4, arc 120°, cd 0.4s; lunge +4 vận tốc */
    if (inp.slash && h.slashCd <= 0) {
      h.slashCd = C.SLASH_CD;
      h.vx += Math.sin(h.yaw) * 4; h.vz += Math.cos(h.yaw) * 4;
      pushEvent(st, { type: 'slash' });
      var hitAny = false;
      st.enemies.forEach(function (en) {
        if (en.dead) return;
        var d = dist2(h.x, h.z, en.x, en.z);
        if (d > C.SLASH_RANGE) return;
        var ang = Math.atan2(en.x - h.x, en.z - h.z);
        if (angDiff(ang, h.yaw) > C.SLASH_ARC_DEG * Math.PI / 180 / 2) return;
        if (damageEnemy(st, en, C.SLASH_DMG, h.x, h.z)) hitAny = true;
      });
      if (hitAny) pushEvent(st, { type: 'slashHit', n: 18 });
    }
    /* phép (K): bolt damage 2, speed 16, cd 0.7s */
    if (inp.bolt && h.boltCd <= 0) {
      h.boltCd = C.BOLT_CD;
      st.bolts.push({
        x: h.x + Math.sin(h.yaw) * 0.6, z: h.z + Math.cos(h.yaw) * 0.6, y: 1.2,
        vx: Math.sin(h.yaw) * C.BOLT_SPEED, vz: Math.cos(h.yaw) * C.BOLT_SPEED,
        life: C.BOLT_LIFE, team: 'hero', dmg: C.BOLT_DMG
      });
      pushEvent(st, { type: 'bolt' });
    }
    /* autopilot tự đánh: slash nếu enemy < 2.16m, bolt nếu < 11m (3%/frame) */
    if (auto) {
      var nearEn = null, nd = 1e9;
      st.enemies.forEach(function (en) {
        if (en.dead) return;
        var d = dist2(h.x, h.z, en.x, en.z);
        if (d < nd) { nd = d; nearEn = en; }
      });
      if (nearEn) {
        if (nd < 2.16 && h.slashCd <= 0) {
          h.yaw = Math.atan2(nearEn.x - h.x, nearEn.z - h.z);
          stepHeroSlashOnly(st);
        } else if (nd < 11 && h.boltCd <= 0 && st.rng() < 0.03) {
          h.yaw = Math.atan2(nearEn.x - h.x, nearEn.z - h.z);
          h.boltCd = C.BOLT_CD;
          st.bolts.push({
            x: h.x + Math.sin(h.yaw) * 0.6, z: h.z + Math.cos(h.yaw) * 0.6, y: 1.2,
            vx: Math.sin(h.yaw) * C.BOLT_SPEED, vz: Math.cos(h.yaw) * C.BOLT_SPEED,
            life: C.BOLT_LIFE, team: 'hero', dmg: C.BOLT_DMG
          });
          pushEvent(st, { type: 'bolt' });
        }
      }
    }
  }
  /* slash dùng chung cho input + autopilot (tránh đệ quy stepHero) */
  function stepHeroSlashOnly(st) {
    var h = st.hero;
    h.slashCd = C.SLASH_CD;
    h.vx += Math.sin(h.yaw) * 4; h.vz += Math.cos(h.yaw) * 4;
    pushEvent(st, { type: 'slash' });
    var hitAny = false;
    st.enemies.forEach(function (en) {
      if (en.dead) return;
      var d = dist2(h.x, h.z, en.x, en.z);
      if (d > C.SLASH_RANGE) return;
      var ang = Math.atan2(en.x - h.x, en.z - h.z);
      if (angDiff(ang, h.yaw) > C.SLASH_ARC_DEG * Math.PI / 180 / 2) return;
      if (damageEnemy(st, en, C.SLASH_DMG, h.x, h.z)) hitAny = true;
    });
    if (hitAny) pushEvent(st, { type: 'slashHit', n: 18 });
  }

  function stepEnemies(st, dt) {
    var h = st.hero;
    st.enemies.forEach(function (en) {
      if (en.invulnT > 0) en.invulnT -= dt;
      if (en.flashT > 0) en.flashT -= dt;
      if (en.dead) {
        en.deadT -= dt;
        if (en.deadT <= 0) {
          en.x = en.homeX; en.z = en.homeZ; en.hp = en.maxHp;
          en.invulnT = 1; en.dead = false; en.cycle = 0; en.kx = 0; en.kz = 0;
          pushEvent(st, { type: 'enemyRespawn', id: en.id });
        }
        return;
      }
      /* component V đã đăng ký thì tự lái loại enemy này (VeloPlay chỉ
       * còn trừ invuln/flash + hồi sinh ở trên) — tránh chạy 2 lần */
      if (st._vSkip && st._vSkip[en.kind]) return;
      var kd = Math.max(0, 1 - dt * 6);
      en.kx *= kd; en.kz *= kd;
      en.x += en.kx * dt; en.z += en.kz * dt;
      if (en.kind === 'slime') {
        var prevCycle = en.cycle;
        en.cycle += dt;
        var cyc = en.cycle % (C.SLIME_HOP + C.SLIME_REST);
        var hopping = cyc < C.SLIME_HOP;
        if (hopping && prevCycle % 1.0 >= C.SLIME_HOP) {
          /* bắt đầu cú nhảy: chọn mục tiêu */
          var dHero = dist2(en.x, en.z, h.x, h.z);
          if (!h.dead && dHero < C.SLIME_SIGHT) { en.wanderX = h.x; en.wanderZ = h.z; }
          else if (en.wanderX === null || dist2(en.x, en.z, en.wanderX, en.wanderZ) < 0.5) {
            en.wanderX = en.homeX + (st.rng() * 2 - 1) * 3;
            en.wanderZ = en.homeZ + (st.rng() * 2 - 1) * 3;
          }
        }
        if (hopping) {
          var tx = en.wanderX !== null ? en.wanderX : en.homeX;
          var tz = en.wanderZ !== null ? en.wanderZ : en.homeZ;
          var dd = dist2(en.x, en.z, tx, tz);
          if (dd > 0.05) {
            en.x += (tx - en.x) / dd * C.SLIME_SPEED * dt;
            en.z += (tz - en.z) / dd * C.SLIME_SPEED * dt;
          }
          en.y = C.SLIME_HEIGHT * Math.sin(Math.PI * cyc / C.SLIME_HOP);
          en.sx = 0.9; en.sy = 1.15; /* stretch khi nhảy */
          en.yaw = Math.atan2(tx - en.x, tz - en.z);
        } else {
          en.y = 0;
          en.sx = 1.1; en.sy = 0.85; /* squash khi nghỉ */
        }
        /* chạm hero (XZ < 0.9*scale.x và y < 0.6) → damage 1, knock 9 */
        if (!h.dead && dist2(en.x, en.z, h.x, h.z) < C.SLIME_BUMP_XZ * en.scale && en.y < C.SLIME_BUMP_Y) {
          damageHero(st, 1, en.x, en.z);
        }
      } else if (en.kind === 'drone') {
        en.angle += en.orbitSpeed * dt;
        en.x = en.homeX + Math.sin(en.angle) * en.orbitRadius;
        en.z = en.homeZ + Math.cos(en.angle) * en.orbitRadius;
        en.y = 2.2 + C.DRONE_BOB * Math.sin(st.time * 2.1 + en.angle);
        en.tiltZ = C.DRONE_TILT_DEG * Math.PI / 180;
        en.yaw = Math.atan2(h.x - en.x, h.z - en.z);
        en.gunCd -= dt;
        if (en.gunCd <= 0 && !h.dead && dist2(en.x, en.z, h.x, h.z) < C.GUN_RANGE) {
          en.gunCd = C.GUN_INTERVAL;
          var d = dist2(en.x, en.z, h.x, h.z) || 1;
          st.bolts.push({
            x: en.x, z: en.z, y: en.y,
            vx: (h.x - en.x) / d * C.GUN_SPEED, vz: (h.z - en.z) / d * C.GUN_SPEED,
            life: 3, team: 'enemy', dmg: 1
          });
          pushEvent(st, { type: 'gun' });
        }
      } else if (en.kind === 'golem') {
        en.ph += dt * C.GOLEM_SPEED * 2.6;
        var off = (C.GOLEM_DIST / 2) * Math.sin(en.ph);
        en.x = en.homeX + Math.sin(en.facing) * off;
        en.z = en.homeZ + Math.cos(en.facing) * off;
        en.hipY = 1.15 + Math.abs(Math.cos(en.ph)) * 0.08;
        en.swing = C.GOLEM_SWING_DEG * Math.sin(en.ph);
        en.yaw = en.facing + (Math.cos(en.ph) >= 0 ? 0 : Math.PI);
        en.y = 0;
        if (en.slamWindup >= 0) {
          en.slamWindup -= dt;
          if (en.slamWindup <= 0) {
            en.slamWindup = -1;
            en.slamCd = C.SLAM_CD;
            var dh = dist2(en.x, en.z, h.x, h.z);
            var angH = Math.atan2(h.x - en.x, h.z - en.z);
            if (!h.dead && dh < C.SLAM_HIT && angDiff(angH, en.yaw) < Math.PI / 3) {
              damageHero(st, 2, en.x, en.z);
              var hk = Math.hypot(h.x - en.x, h.z - en.z) || 1;
              h.kx = (h.x - en.x) / hk * 12; h.kz = (h.z - en.z) / hk * 12;
            }
            pushEvent(st, { type: 'puff', n: 30, x: en.x, z: en.z });
          }
        } else {
          en.slamCd -= dt;
          if (en.slamCd <= 0 && !h.dead && dist2(en.x, en.z, h.x, h.z) < C.SLAM_RANGE) {
            en.slamWindup = C.SLAM_WINDUP;
            pushEvent(st, { type: 'slamWindup', id: en.id });
          }
        }
      } else if (en.kind === 'runner') {
        /* PathRunner: angle += speed/radius*dt, vị trí (sin*r, cos*r) */
        if (en.radius > 0) {
          en.angle += en.speed / en.radius * dt;
          en.x = Math.sin(en.angle) * en.radius;
          en.z = Math.cos(en.angle) * en.radius;
          en.yaw = Math.atan2(Math.cos(en.angle), -Math.sin(en.angle));
        }
      }
    });
  }

  function stepBolts(st, dt) {
    var h = st.hero;
    for (var i = st.bolts.length - 1; i >= 0; i--) {
      var b = st.bolts[i];
      b.x += b.vx * dt; b.z += b.vz * dt; b.life -= dt;
      var dead = false;
      if (b.team === 'hero') {
        for (var j = 0; j < st.enemies.length; j++) {
          var en = st.enemies[j];
          if (en.dead) continue;
          if (dist2(b.x, b.z, en.x, en.z) < C.BOLT_RADIUS + en.r) {
            damageEnemy(st, en, b.dmg, b.x - b.vx * 0.05, b.z - b.vz * 0.05);
            pushEvent(st, { type: 'boltHit', id: en.id });
            dead = true;
            break;
          }
        }
      } else {
        if (!h.dead && dist2(b.x, b.z, h.x, h.z) < C.BOLT_RADIUS) {
          damageHero(st, b.dmg, b.x - b.vx * 0.05, b.z - b.vz * 0.05);
          dead = true;
        }
      }
      if (!dead && b.life <= 0) {
        pushEvent(st, { type: 'burst', n: 40, x: b.x, z: b.z });
        dead = true;
      }
      if (dead) st.bolts.splice(i, 1);
    }
  }

  function stepOrbs(st, dt) {
    var h = st.hero;
    st.orbs.forEach(function (o) {
      if (o.armed < C.ORB_ARMED) { o.armed += dt; return; }
      if (h.dead) return;
      if (dist2(h.x, h.z, o.x, o.z) < C.ORB_RADIUS) {
        st.orbCount++;
        pushEvent(st, { type: 'orb', id: o.id, n: 60, x: o.x, z: o.z, orbs: st.orbCount });
        var p = randomOrbPos(st);
        o.x = p.x; o.z = p.z; o.armed = 0;
        if (st.orbCount >= st.winTarget && !st.won) {
          st.won = true;
          pushEvent(st, { type: 'win', orbs: st.orbCount, kills: st.kills });
        }
      }
    });
  }

  function stepHeals(st, dt) {
    var h = st.hero;
    if (h.dead || h.hp >= h.maxHp) return;
    st.heals.forEach(function (hz) {
      if (dist2(h.x, h.z, hz.x, hz.z) < hz.r) {
        h.healAcc += dt * C.HEAL_RATE;
        while (h.healAcc >= 1) {
          h.healAcc -= 1;
          h.hp = Math.min(h.maxHp, h.hp + 1);
          pushEvent(st, { type: 'heal', hp: h.hp });
        }
      }
    });
  }

  function stepCamera(st, dt, orbitRad) {
    var cam = st.cam, h = st.hero;
    if (orbitRad) cam.yaw += orbitRad;
    var fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
    var k = Math.min(1, dt * C.CAM_SMOOTH);
    cam.x += (h.x - fx * C.CAM_DIST - cam.x) * k;
    cam.y += (C.CAM_HEIGHT - cam.y) * k;
    cam.z += (h.z - fz * C.CAM_DIST - cam.z) * k;
    var k2 = Math.min(1, dt * C.CAM_SMOOTH * 1.5);
    cam.lx += (h.x - cam.lx) * k2;
    cam.ly += (1.1 - cam.ly) * k2;
    cam.lz += (h.z - cam.lz) * k2;
  }

  function step(st, inp, dt, orbitRad) {
    st.time += dt;
    stepHero(st, inp || {}, dt);
    stepEnemies(st, dt);
    stepBolts(st, dt);
    stepOrbs(st, dt);
    stepHeals(st, dt);
    stepCamera(st, dt, orbitRad || 0);
    /* đồng bộ số liệu tóm tắt ở top-level cho HUD/test */
    st.hp = st.hero.hp;
    st.maxHp = st.hero.maxHp;
    return st;
  }

  var Core = {
    C: C, newState: newState, addEnemy: addEnemy, addOrb: addOrb,
    step: step, stepHero: stepHero, stepEnemies: stepEnemies,
    stepBolts: stepBolts, stepOrbs: stepOrbs, stepHeals: stepHeals,
    stepCamera: stepCamera, damageHero: damageHero, damageEnemy: damageEnemy,
    nearestOrb: nearestOrb, randomOrbPos: randomOrbPos, doDash: doDash,
    drainEvents: function (st) { var e = st.events; st.events = []; return e; }
  };

  /* ================= AUDIO — WebAudio beep, pattern AudioMan (WUXIA3D.js) ================= */
  var AudioMan = {
    ctx: null, muted: false,
    init: function () {
      if (this.ctx) return;
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    },
    tone: function (freq0, freq1, dur, type, vol) {
      if (!this.ctx || this.muted) return;
      try {
        var ctx = this.ctx, t = ctx.currentTime;
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(freq0, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(1, freq1), t + dur);
        g.gain.setValueAtTime(vol || 0.07, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(t); o.stop(t + dur + 0.02);
      } catch (e) { }
    },
    sfx: function (type) {
      if (!this.ctx || this.muted) return;
      if (type === 'hit') this.tone(170, 60, 0.09, 'square', 0.08);
      else if (type === 'swing') this.tone(700, 220, 0.1, 'sine', 0.04);
      else if (type === 'skill') this.tone(220, 880, 0.28, 'sawtooth', 0.06);
      else if (type === 'pickup') this.tone(880, 1320, 0.14, 'sine', 0.05);
      else if (type === 'levelup') { this.tone(523, 523, 0.12, 'sine', 0.08); var s = this; setTimeout(function () { s.tone(784, 784, 0.18, 'sine', 0.08); }, 110); }
      else if (type === 'death') this.tone(300, 40, 0.35, 'sawtooth', 0.07);
      else if (type === 'quest') { this.tone(660, 660, 0.12, 'sine', 0.07); var s2 = this; setTimeout(function () { s2.tone(990, 990, 0.2, 'sine', 0.07); }, 120); }
    }
  };

  /* ================= ADAPTER — nối Core với MapEditor thật ================= */
  var VeloPlay = {
    Core: Core, Audio: AudioMan, CONST: C,
    _active: false, _state: null, _ents: null, _snapshot: null,
    _keys: {}, _edge: { dash: false, slash: false, bolt: false },
    _joy: { x: 0, y: 0, active: false },
    _drag: null, _dragOrbit: 0, _els: {}, _inited: false,
    _boltMeshes: [], _fx: [], _bars: {}, _statsT: 0, _lastMode: {},
    _best: null,
    /* --- cầu nối V Code (VCodeRunner): component V dịch ra --- */
    _vcompClasses: {}, _vcomps: [], _vVR: null,
    _vPressed: {}, _vMouse: { down: false, pressed: false, released: false, x: 0, y: 0 }
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function loadBest() {
    try {
      var b = JSON.parse(window.localStorage.getItem('velo-play-best') || 'null');
      if (b && typeof b.orbs === 'number') return b;
    } catch (e) { }
    return { orbs: 0, kills: 0 };
  }
  function saveBest(b) {
    try { window.localStorage.setItem('velo-play-best', JSON.stringify(b)); } catch (e) { }
  }

  VeloPlay.hasVeloScene = function () {
    if (!ME.MapEditor || !ME.MapEditor.data) return false;
    var objs = ME.MapEditor.data.objects || [];
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i], v = o.velo || {};
      /* chỉ tính dấu vết Velo (model/prefab/spawner/healZone) — hero
       * thường của scene mặc định không tính là scene Velo */
      if (v.modelId || v.prefabId || o.veloId || v.spawner || v.healZone) return true;
    }
    return /velo/i.test(ME.MapEditor.data.name || '');
  };

  VeloPlay.isActive = function () { return !!VeloPlay._active; };

  VeloPlay.toggleRunKey = function () {
    if (VeloPlay._active) return true;
    if (!VeloPlay.hasVeloScene()) {
      if (ME.MapEditor && ME.MapEditor.notify) {
        ME.MapEditor.notify('Run Velo', 'Chưa có scene Velo — import demo3d Velo trước (panel Velo → "Import demo3d Velo" hoặc mở thư mục project Velo), rồi bấm R để chạy game.', 'warning');
      }
      return false;
    }
    VeloPlay.start();
    return true;
  };

  /* ================= CẦU NỐI V CODE (VCodeRunner) =================
   * Component V dịch ra (class JS) được đăng ký bằng tên rồi gắn vào
   * node của scene đã import khi start(); mỗi frame update() của
   * VeloPlay gọi update(dt) của chúng SAU Core.step + _applyToScene,
   * rồi _syncVToCore đọc vị trí THREE object trả lại Core state để
   * 2 bên không lệch nhau. Component V được quyền ghi đè vị trí
   * (hero/enemy/orb) — Core nhường: hero thì bỏ input + autopilot,
   * enemy thì bỏ nhánh di chuyển của đúng loại đó (st._vSkip). */
  VeloPlay.registerComponent = function (name, CompClass, target) {
    if (!name || typeof CompClass !== 'function') return false;
    CompClass.__vname = name;
    VeloPlay._vcompClasses[name] = { Cls: CompClass, target: target || null };
    return true;
  };
  VeloPlay.unregisterComponent = function (name) {
    delete VeloPlay._vcompClasses[name];
    VeloPlay._vcomps = VeloPlay._vcomps.filter(function (c) { return c.name !== name; });
    return true;
  };
  VeloPlay.clearVComponents = function () {
    VeloPlay._vcompClasses = {};
    VeloPlay._clearVInstances();
    return true;
  };
  VeloPlay.getVRuntime = function () { return VeloPlay._vVR; };
  VeloPlay._hasVComp = function (name) {
    for (var i = 0; i < VeloPlay._vcomps.length; i++) if (VeloPlay._vcomps[i].name === name) return true;
    return false;
  };
  VeloPlay._clearVInstances = function () {
    if (VeloPlay._vVR && VeloPlay._vVR.dispose) { try { VeloPlay._vVR.dispose(); } catch (e) { } }
    VeloPlay._vVR = null;
    VeloPlay._vcomps = [];
    VeloPlay._vPressed = {};
  };

  /* Gắn component V vào node: target 'hero' | 'camera' | 'orbs' |
   * 'enemies:<kind>' | 'runners' | id node | đường dẫn 'World/Hero'.
   * Không có target thì đoán theo tên (bảng dưới). */
  VeloPlay._vTargetsFor = function (name, target, ents) {
    var out = [];
    function push(node, kind, core) { if (node) out.push({ node: node, kind: kind, core: core }); }
    var st = VeloPlay._state;
    if (target) {
      if (target === 'hero') push(ents.hero && ents.hero.obj, 'hero', st ? st.hero : null);
      else if (target === 'camera') push(VeloPlay._vCameraNode, 'camera', null);
      else if (target === 'orbs') (ents.orbs || []).forEach(function (o, i) { push(o.obj, 'orb', st && st.orbs[i]); });
      else if (target === 'runners') (ents.runners || []).forEach(function (r, i) {
        var c = null;
        if (st) for (var k = 0; k < st.enemies.length; k++) if (st.enemies[k].id === r.id) c = st.enemies[k];
        push(r.obj, 'runner', c);
      });
      else if (target.indexOf('enemies:') === 0) {
        var kind = target.slice(8);
        (ents.enemies || []).forEach(function (e) {
          if (e.kind !== kind) return;
          var c2 = null;
          if (st) for (var k2 = 0; k2 < st.enemies.length; k2++) if (st.enemies[k2].id === e.id) c2 = st.enemies[k2];
          push(e.obj, kind, c2);
        });
      } else {
        /* id node hoặc đường dẫn — tìm trong ents */
        var all = [];
        if (ents.hero) all.push(ents.hero.obj);
        (ents.enemies || []).forEach(function (e) { all.push(e.obj); });
        (ents.orbs || []).forEach(function (o) { all.push(o.obj); });
        for (var i = 0; i < all.length; i++) {
          if (all[i] && (all[i].name === target || (all[i].userData && all[i].userData.mapId === target))) { push(all[i], 'other', null); break; }
        }
      }
      return out;
    }
    if (name === 'HeroController' || name === 'HeroCombat') push(ents.hero && ents.hero.obj, 'hero', st ? st.hero : null);
    else if (name === 'FollowCamera') push(VeloPlay._vCameraNode, 'camera', null);
    else if (name === 'SlimeHop' || name === 'DroneHover' || name === 'DroneGun' || name === 'GolemWalk' || name === 'GolemSlam') {
      var kindMap = { SlimeHop: 'slime', DroneHover: 'drone', DroneGun: 'drone', GolemWalk: 'golem', GolemSlam: 'golem' };
      var kd = kindMap[name];
      (ents.enemies || []).forEach(function (e) {
        if (e.kind !== kd) return;
        var c3 = null;
        if (st) for (var k3 = 0; k3 < st.enemies.length; k3++) if (st.enemies[k3].id === e.id) c3 = st.enemies[k3];
        push(e.obj, kd, c3);
      });
    }
    else if (name === 'PathRunner') (ents.runners || []).forEach(function (r, i) {
      var c4 = null;
      if (st) for (var k4 = 0; k4 < st.enemies.length; k4++) if (st.enemies[k4].id === r.id) c4 = st.enemies[k4];
      push(r.obj, 'runner', c4);
    });
    else if (name === 'OrbPickup' || name === 'Bob3D' || name === 'Spin3D' || name === 'Pulse3D') {
      (ents.orbs || []).forEach(function (o, i) { push(o.obj, 'orb', st && st.orbs[i]); });
    }
    else if (name === 'Health') {
      /* hero: team hero; mỗi enemy: team enemy */
      push(ents.hero && ents.hero.obj, 'hero', st ? st.hero : null);
      (ents.enemies || []).forEach(function (e) {
        var c5 = null;
        if (st) for (var k5 = 0; k5 < st.enemies.length; k5++) if (st.enemies[k5].id === e.id) c5 = st.enemies[k5];
        push(e.obj, e.kind, c5);
      });
    }
    else if (name === 'OrbSpawner' || name === 'Projectile') {
      /* không gắn: OrbSpawner cần scene.instantiate() (chưa hỗ trợ),
       * Projectile chỉ được tạo qua spawn_bolt() */
    }
    else push(ents.hero && ents.hero.obj, 'hero', st ? st.hero : null);
    return out;
  };

  /* Tạo VR + cây node VR từ scene đã import + khởi tạo component V. */
  VeloPlay._attachVComponents = function () {
    if (!ME.VCodeRunner || !ME.VCodeRunner.makeRuntime) return 0;
    var names = Object.keys(VeloPlay._vcompClasses);
    if (!names.length) return 0;
    var ents = VeloPlay._ents, st = VeloPlay._state;
    if (!ents || !st) return 0;
    var VR = ME.VCodeRunner.makeRuntime({
      now: function () { return VeloPlay._state ? VeloPlay._state.time : 0; },
      inputState: function () { return VeloPlay._vInputState(); },
      getStore: function (k) {
        if (!VeloPlay._state) return undefined;
        if (k === 'orbs') return VeloPlay._state.orbCount;
        if (k === 'kills') return VeloPlay._state.kills;
        if (k === 'hp') return VeloPlay._state.hero.hp;
        if (k === 'max_hp') return VeloPlay._state.hero.maxHp;
        return undefined;
      },
      onStoreSet: function (k, v) { VeloPlay._vOnStoreSet(k, v); },
      createObject: function (name) {
        try {
          if (typeof THREE !== 'undefined') { var g = new THREE.Group(); g.name = name || ''; return g; }
        } catch (e) { }
        return null;
      },
      log: (typeof console !== 'undefined' ? console : null)
    });
    VeloPlay._vVR = VR;
    var NodeCls = VR.core.Node;
    var root = VR.scene.root;
    function wrap(obj3d, name) {
      var n = new NodeCls(name, obj3d, VR);
      root.add_child(n);
      return n;
    }
    function virtualChild(parent, name) {
      var n = new NodeCls(name, null, VR);
      parent.add_child(n);
      return n;
    }
    /* hero + con ảo (Trail/Dust cho child_component; Body không có) */
    var heroNode = null;
    if (ents.hero) {
      heroNode = wrap(ents.hero.obj, ents.hero.obj.name || 'Hero');
      virtualChild(heroNode, 'Trail');
      virtualChild(heroNode, 'Dust');
      /* SkinnedModel3D stub: HeroController V cần get_component này
       * khác null để chạy (MapEditor không có component này thật) */
      heroNode._comps.set('SkinnedModel3D', { data: null, speed: 0, playing: false, time: 0, hit_flash: function () { } });
    }
    /* camera ảo: transform của nó được _syncVToCore đọc về st.cam.yaw */
    VeloPlay._vCameraNode = new NodeCls('Camera', null, VR);
    root.add_child(VeloPlay._vCameraNode);
    /* orbs + container World/Orbs (nearest_orb tìm ở đây) */
    var orbsNode = new NodeCls('Orbs', null, VR);
    root.add_child(orbsNode);
    var orbNodes = {};
    (ents.orbs || []).forEach(function (o) {
      var n = new NodeCls(o.obj.name || o.id, o.obj, VR);
      orbsNode.add_child(n);
      orbNodes[o.id] = n;
    });
    /* enemies + con ảo (Body/Dust/Hips... để find() không return sớm) */
    var enemyNodes = {};
    (ents.enemies || []).forEach(function (e) {
      var n = new NodeCls(e.obj.name || e.id, e.obj, VR);
      root.add_child(n);
      virtualChild(n, 'Body');
      virtualChild(n, 'Dust');
      var hips = virtualChild(n, 'Hips');
      virtualChild(hips, 'LegL');
      virtualChild(hips, 'LegR');
      var torso = virtualChild(hips, 'Torso');
      virtualChild(torso, 'ArmL');
      virtualChild(torso, 'ArmR');
      enemyNodes[e.id] = n;
    });
    (ents.runners || []).forEach(function (r) {
      var n2 = new NodeCls(r.obj.name || r.id, r.obj, VR);
      root.add_child(n2);
      enemyNodes[r.id] = n2;
    });
    /* World node: find('World') trả về root; find('World/Hero') đi qua
     * children của root — đổi tên root cho khớp */
    root.name = 'World';
    /* gắn node VR vào đúng THREE object theo id (khớp theo object trước,
     * rồi mới theo mapId — tránh lệch id giữa data và userData) */
    function nodeFor(obj3d, kind, core) {
      if (kind === 'camera') return VeloPlay._vCameraNode;
      if (!obj3d) return null;
      var id;
      for (id in orbNodes) if (orbNodes[id]._obj === obj3d) return orbNodes[id];
      for (id in enemyNodes) if (enemyNodes[id]._obj === obj3d) return enemyNodes[id];
      if (heroNode && heroNode._obj === obj3d) return heroNode;
      var mapId = obj3d.userData && obj3d.userData.mapId;
      if (kind === 'orb' && mapId && orbNodes[mapId]) return orbNodes[mapId];
      if (mapId && enemyNodes[mapId]) return enemyNodes[mapId];
      if (kind === 'hero') return heroNode;
      return null;
    }
    var attached = 0;
    var skipKinds = {};
    names.forEach(function (cname) {
      var rec = VeloPlay._vcompClasses[cname];
      var targets = VeloPlay._vTargetsFor(cname, rec.target, ents);
      targets.forEach(function (tg) {
        var vnode = tg.kind === 'camera' ? VeloPlay._vCameraNode : nodeFor(tg.node, tg.kind, tg.core);
        if (!vnode) return;
        var inst;
        try {
          inst = new rec.Cls();
        } catch (e) {
          if (typeof console !== 'undefined') console.error('[VCode] không tạo được ' + cname + ':', e);
          return;
        }
        if (cname === 'Health' && tg.kind === 'hero') inst.team = 'hero';
        inst.__vr = VR;
        inst.node = vnode;
        try { vnode.add_component(inst); } catch (e) { }
        VeloPlay._vcomps.push({ name: cname, inst: inst, node: vnode, kind: tg.kind, core: tg.core || null, nodeId: tg.node && tg.node.userData ? tg.node.userData.mapId : null });
        if (tg.kind === 'slime' || tg.kind === 'drone' || tg.kind === 'golem' || tg.kind === 'runner') skipKinds[tg.kind] = true;
        try { if (typeof inst.start === 'function') inst.start(); } catch (e) {
          if (typeof console !== 'undefined') console.error('[VCode] ' + cname + '.start() lỗi:', e);
        }
        attached++;
      });
    });
    if (st) st._vSkip = skipKinds;
    return attached;
  };

  /* Input cho code V: trục thô + phím bấm trong frame (đã snapshot
   * từ _edge/_vMouse trước khi Core.step xóa _edge). */
  VeloPlay._vInputState = function () {
    var k = VeloPlay._keys;
    var ax = 0, ay = 0;
    if (k['KeyD'] || k['ArrowRight']) ax += 1;
    if (k['KeyA'] || k['ArrowLeft']) ax -= 1;
    if (k['KeyS'] || k['ArrowDown']) ay += 1;
    if (k['KeyW'] || k['ArrowUp']) ay -= 1;
    if (VeloPlay._joy.active) { ax += VeloPlay._joy.x; ay += VeloPlay._joy.y; }
    var m = VeloPlay._vMouse;
    return {
      ax: ax, ay: ay, keys: k, pressed: VeloPlay._vPressed,
      mouseDown: !!m.down, mousePressed: !!m.pressed, mouseReleased: !!m.released,
      mouseX: m.x || 0, mouseY: m.y || 0
    };
  };

  /* store V → Core: orbs/kills/hp đồng bộ sang HUD + thắng/thua */
  VeloPlay._vOnStoreSet = function (k, v) {
    var st = VeloPlay._state;
    if (!st) return;
    if (k === 'orbs') {
      st.orbCount = v;
      if (v >= st.winTarget && !st.won) {
        st.won = true;
        AudioMan.sfx('levelup'); AudioMan.sfx('quest');
        VeloPlay._showBanner('🏆 Thắng! Orbs: ' + v + ' · Kills: ' + st.kills +
          '<br><button class="velo-banner-btn" onclick="document.getElementById(\'velo-hud-stop\').click()">⏹ Về editor</button>');
      }
    } else if (k === 'kills') {
      st.kills = v;
    } else if (k === 'hp') {
      st.hero.hp = v; st.hp = v;
      if (v <= 0 && !st.hero.dead) {
        st.hero.dead = true; st.hero.deadT = C.HERO_RESPAWN; st.orbCount = 0;
      } else if (v > 0 && st.hero.dead) {
        st.hero.dead = false;
      }
    } else if (k === 'max_hp') {
      st.hero.maxHp = v; st.maxHp = v;
    }
  };

  /* Chạy component V mỗi frame (sau Core.step + _applyToScene) rồi
   * đồng bộ vị trí THREE object về Core state. */
  VeloPlay._updateVComponents = function (dt) {
    if (!VeloPlay._vcomps.length || !VeloPlay._vVR) return;
    if (VeloPlay._vVR.scene) VeloPlay._vVR.scene.unscaled_dt = dt;
    VeloPlay._vcomps.forEach(function (c) {
      if (c.__vErr) return;
      try {
        if (typeof c.inst.update === 'function') c.inst.update(dt);
      } catch (e) {
        c.__vErr = true;
        if (typeof console !== 'undefined') console.error('[VCode] ' + c.name + '.update() lỗi (đã dừng component này):', e);
        if (ME.MapEditor && ME.MapEditor.setStatus) ME.MapEditor.setStatus('[V Code] ' + c.name + '.update() lỗi: ' + (e && e.message ? e.message : e) + ' — component đã dừng, các component khác vẫn chạy.');
      }
    });
    VeloPlay._syncVToCore();
  };

  VeloPlay._syncVToCore = function () {
    var st = VeloPlay._state;
    if (!st) return;
    VeloPlay._vcomps.forEach(function (c) {
      if (c.kind === 'camera') {
        var cam = VeloPlay._vCameraNode;
        if (cam) {
          try {
            var yawDeg = cam.transform().rotation.y;
            st.cam.yaw = yawDeg * Math.PI / 180;
          } catch (e) { }
        }
        return;
      }
      if (!c.core || !c.node || !c.node._obj) return;
      var p = c.node._obj.position;
      if (!p) return;
      if (c.kind === 'hero') {
        c.core.x = p.x; c.core.z = p.z;
        c.core.yaw = c.node._obj.rotation ? c.node._obj.rotation.y : c.core.yaw;
      } else {
        c.core.x = p.x; c.core.z = p.z;
        if (c.node._obj.rotation) c.core.yaw = c.node._obj.rotation.y;
      }
    });
  };

  /* ---------- HUD + touch controls (tạo bằng JS) ---------- */
  VeloPlay._buildDom = function () {
    if (typeof document === 'undefined') return false;
    var wrap = document.getElementById('me-viewport-wrap') || document.body;
    var hud = el('div', 'velo-hidden');
    hud.id = 'velo-hud';
    var top = el('div', 'velo-hud-top');
    var orbs = el('span', null, 'Orbs: 0/20'); orbs.id = 'velo-hud-orbs';
    var hpWrap = el('span', 'velo-hp');
    var hpBar = el('span', null, ''); hpBar.id = 'velo-hud-hpbar';
    hpWrap.appendChild(hpBar);
    var hpText = el('span', null, 'HP 8/8'); hpText.id = 'velo-hud-hptext';
    var kills = el('span', null, 'Defeated: 0'); kills.id = 'velo-hud-kills';
    var stats = el('span', null, ''); stats.id = 'velo-hud-stats';
    var best = el('span', null, ''); best.id = 'velo-hud-best';
    var stop = el('button', 'velo-stop-btn', '⏹ Dừng'); stop.id = 'velo-hud-stop';
    stop.addEventListener('click', function () { VeloPlay.stop(); });
    top.appendChild(orbs); top.appendChild(hpWrap); top.appendChild(hpText);
    top.appendChild(kills); top.appendChild(stats); top.appendChild(best); top.appendChild(stop);
    var help = el('div', null, 'WASD / arrows: run, J or click: slash, K: magic bolt, Shift / Space: dash, Q / E or drag: orbit camera, Esc: quit');
    help.id = 'velo-hud-help';
    var banner = el('div', 'velo-hidden'); banner.id = 'velo-hud-banner';
    hud.appendChild(top); hud.appendChild(help); hud.appendChild(banner);
    wrap.appendChild(hud);

    var touch = el('div', 'velo-hidden'); touch.id = 'velo-touch';
    var joy = el('div', null, ''); joy.id = 'velo-joy';
    var knob = el('div', null, ''); knob.id = 'velo-joy-knob';
    joy.appendChild(knob);
    var btns = el('div', 'velo-btns');
    function mkBtn(id, label, edge) {
      var b = el('button', 'velo-touch-btn', label); b.id = id;
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); VeloPlay._edge[edge] = true; });
      return b;
    }
    btns.appendChild(mkBtn('velo-btn-dash', '💨 Dash', 'dash'));
    btns.appendChild(mkBtn('velo-btn-slash', '⚔️ Chém', 'slash'));
    btns.appendChild(mkBtn('velo-btn-bolt', '✨ Phép', 'bolt'));
    touch.appendChild(joy); touch.appendChild(btns);
    wrap.appendChild(touch);

    /* joystick — kiểu WUXIA3D.js: kéo knob trong vòng tròn, vector chuẩn hoá */
    var joyId = null;
    function joyMove(e) {
      var r = joy.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
      var len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; len = 1; }
      knob.style.transform = 'translate(' + dx * 34 + 'px,' + dy * 34 + 'px)';
      VeloPlay._joy.x = dx; VeloPlay._joy.y = dy; VeloPlay._joy.active = true;
    }
    joy.addEventListener('pointerdown', function (e) { joyId = e.pointerId; try { joy.setPointerCapture(e.pointerId); } catch (err) { } joyMove(e); });
    joy.addEventListener('pointermove', function (e) { if (e.pointerId === joyId) joyMove(e); });
    function joyEnd(e) {
      if (e.pointerId !== joyId) return;
      joyId = null; knob.style.transform = '';
      VeloPlay._joy.x = 0; VeloPlay._joy.y = 0; VeloPlay._joy.active = false;
    }
    joy.addEventListener('pointerup', joyEnd);
    joy.addEventListener('pointercancel', joyEnd);

    /* nút ▶ Run Velo trên toolbar (thêm bằng JS, không sửa MapEditor.html) */
    var tb = document.getElementById('me-toolbar') || document.getElementById('me-topbar');
    if (tb && !document.getElementById('me-velo-run-btn')) {
      var runBtn = el('button', 'tool-btn', '▶ Run Velo');
      runBtn.id = 'me-velo-run-btn';
      runBtn.title = 'Chạy game Velo trong trình duyệt (phím R) — không cần engine V';
      runBtn.addEventListener('click', function () { VeloPlay.toggleRunKey(); });
      tb.appendChild(runBtn);
    }
    VeloPlay._els = { hud: hud, orbs: orbs, hpBar: hpBar, hpText: hpText, kills: kills, stats: stats, best: best, banner: banner, touch: touch };
    return true;
  };

  VeloPlay._bindKeys = function () {
    if (typeof window === 'undefined' || VeloPlay._keysBound) return;
    VeloPlay._keysBound = true;
    window.addEventListener('keydown', function (e) {
      if (!VeloPlay._active) return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      /* jsdom/some browsers: e.code có thể rỗng → suy từ e.key */
      var code = e.code || '';
      if (!code && e.key) {
        var kk = e.key;
        if (kk === 'Escape') code = 'Escape';
        else if (kk === ' ') code = 'Space';
        else if (kk.length === 1) code = 'Key' + kk.toUpperCase();
        else if (kk === 'Shift') code = 'ShiftLeft';
        else if (/^Arrow/.test(kk)) code = kk;
      }
      if (code === 'Escape') { e.preventDefault(); VeloPlay.stop(); return; }
      if (code === 'Space' || code.indexOf('Arrow') === 0) e.preventDefault();
      VeloPlay._keys[code] = true;
      if (e.repeat) return;
      if (code === 'KeyJ') VeloPlay._edge.slash = true;
      else if (code === 'KeyK') VeloPlay._edge.bolt = true;
      else if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'Space') VeloPlay._edge.dash = true;
    });
    window.addEventListener('keyup', function (e) {
      var code = e.code || '';
      if (!code && e.key) {
        var kk = e.key;
        if (kk === ' ') code = 'Space';
        else if (kk.length === 1) code = 'Key' + kk.toUpperCase();
        else if (kk === 'Shift') code = 'ShiftLeft';
        else if (/^Arrow/.test(kk)) code = kk;
      }
      delete VeloPlay._keys[code];
      if (e.code) delete VeloPlay._keys[e.code];
    });
    window.addEventListener('blur', function () { VeloPlay._keys = {}; });
  };

  /* canvas drag = orbit camera; click (<6px) = chém — như game.v */
  VeloPlay._bindCanvas = function () {
    if (typeof document === 'undefined') return;
    var cv = document.getElementById('me-viewport');
    if (!cv || cv._veloPlayBound) return;
    cv._veloPlayBound = true;
    cv.addEventListener('pointerdown', function (e) {
      if (!VeloPlay._active) return;
      VeloPlay._drag = { x: e.clientX, y: e.clientY, moved: 0 };
      VeloPlay._vMouse.down = true; VeloPlay._vMouse.pressed = true;
      VeloPlay._vMouse.x = e.clientX; VeloPlay._vMouse.y = e.clientY;
    });
    cv.addEventListener('pointermove', function (e) {
      var d = VeloPlay._drag;
      VeloPlay._vMouse.x = e.clientX; VeloPlay._vMouse.y = e.clientY;
      if (!VeloPlay._active || !d) return;
      var dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.moved += Math.abs(dx) + Math.abs(dy);
      d.x = e.clientX; d.y = e.clientY;
      VeloPlay._dragOrbit += -dx * C.DRAG_DEG_PER_PX * Math.PI / 180;
    });
    cv.addEventListener('pointerup', function (e) {
      var d = VeloPlay._drag;
      VeloPlay._drag = null;
      VeloPlay._vMouse.down = false; VeloPlay._vMouse.released = true;
      VeloPlay._vMouse.x = e.clientX; VeloPlay._vMouse.y = e.clientY;
      if (!VeloPlay._active || !d) return;
      if (e.button === 0 && d.moved < 6) VeloPlay._edge.slash = true;
    });
  };

  VeloPlay.init = function () {
    if (VeloPlay._inited) return true;
    if (typeof document === 'undefined') return false;
    VeloPlay._inited = true;
    VeloPlay._best = loadBest();
    VeloPlay._buildDom();
    VeloPlay._bindKeys();
    VeloPlay._bindCanvas();
    return true;
  };

  /* ---------- thu thập entity từ scene đã import ---------- */
  VeloPlay._collect = function () {
    var ents = { hero: null, enemies: [], orbs: [], heals: [], runners: [] };
    var data = ME.MapEditor.data;
    (data.objects || []).forEach(function (o) {
      var o3 = ME.MapEditor.objects[o.id];
      if (!o3) return;
      var v = o.velo || {};
      var pid = v.prefabId || o.veloId || null;
      if (o.type === 'hero') {
        ents.hero = { id: o.id, obj: o3, data: o };
        return;
      }
      if (v.healZone) ents.heals.push({ id: o.id, obj: o3, data: o, r: v.healZone.radius || C.HEAL_RADIUS });
      if (pid === 'd3a10002' || v.spawner || /^Orb_/.test(o.name || '')) {
        if (v.prefabRoot || v.spawner || /^Orb_/.test(o.name || '')) ents.orbs.push({ id: o.id, obj: o3, data: o });
        return;
      }
      if (PREFAB_KIND[pid] && PREFAB_KIND[pid] !== 'orb') {
        /* chỉ object prefabRoot là entity (con trong prefab như mắt slime
         * cùng prefabId nhưng không phải enemy riêng) */
        if (v.prefabRoot) ents.enemies.push({ id: o.id, obj: o3, data: o, kind: PREFAB_KIND[pid] });
        return;
      }
      if ((o.type === 'monster' || o.type === 'boss') && !v.modelId) {
        var nm = (o.name || '').toLowerCase();
        var kind = nm.indexOf('golem') >= 0 ? 'golem' : (nm.indexOf('drone') >= 0 ? 'drone' : 'slime');
        ents.enemies.push({ id: o.id, obj: o3, data: o, kind: kind });
        return;
      }
      if (v.modelId === HERO_MODEL_ID && /runner/i.test(o.name || '')) {
        ents.runners.push({ id: o.id, obj: o3, data: o });
      }
    });
    return ents;
  };

  VeloPlay._takeSnapshot = function () {
    var snap = { objects: [], rig: null, orbs: 0, kills: 0 };
    ME.MapEditor.forEachObject(function (obj) {
      snap.objects.push({
        id: obj.userData.mapId, obj: obj,
        pos: [obj.position.x, obj.position.y, obj.position.z],
        rot: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        scale: [obj.scale.x, obj.scale.y, obj.scale.z],
        visible: obj.visible
      });
    });
    var rig = ME.Viewport3D && ME.Viewport3D.rig;
    if (rig) {
      snap.rig = {
        theta: rig.theta, phi: rig.phi, radius: rig.radius,
        dTheta: rig.dTheta, dPhi: rig.dPhi, dRadius: rig.dRadius,
        target: [rig.target.x, rig.target.y, rig.target.z],
        dTarget: [rig.dTarget.x, rig.dTarget.y, rig.dTarget.z]
      };
    }
    return snap;
  };
  VeloPlay._restoreSnapshot = function () {
    var snap = VeloPlay._snapshot;
    if (!snap) return;
    snap.objects.forEach(function (s) {
      if (!s.obj) return;
      s.obj.position.set(s.pos[0], s.pos[1], s.pos[2]);
      s.obj.rotation.set(s.rot[0], s.rot[1], s.rot[2]);
      s.obj.scale.set(s.scale[0], s.scale[1], s.scale[2]);
      s.obj.visible = s.visible;
    });
    var rig = ME.Viewport3D && ME.Viewport3D.rig;
    if (rig && snap.rig) {
      rig.theta = snap.rig.theta; rig.phi = snap.rig.phi; rig.radius = snap.rig.radius;
      rig.dTheta = snap.rig.dTheta; rig.dPhi = snap.rig.dPhi; rig.dRadius = snap.rig.dRadius;
      rig.target.set(snap.rig.target[0], snap.rig.target[1], snap.rig.target[2]);
      rig.dTarget.set(snap.rig.dTarget[0], snap.rig.dTarget[1], snap.rig.dTarget[2]);
      rig.update();
    }
  };

  /* ---------- thanh HP 3D trên đầu enemy ---------- */
  VeloPlay._makeBar = function () {
    if (typeof THREE === 'undefined') return null;
    var g = new THREE.Group();
    var bg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.14),
      new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.8, depthTest: false })
    );
    var fg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.14, 0.09),
      new THREE.MeshBasicMaterial({ color: 0x51d96a, transparent: true, opacity: 0.95, depthTest: false })
    );
    fg.position.z = 0.01;
    g.add(bg); g.add(fg);
    g.userData.fg = fg;
    return g;
  };
  VeloPlay._updateBar = function (bar, en, camPos) {
    if (!bar) return;
    var ratio = Math.max(0, en.hp / en.maxHp);
    bar.userData.fg.scale.x = Math.max(0.001, ratio);
    bar.userData.fg.position.x = -(1.14 * (1 - ratio)) / 2;
    bar.userData.fg.material.color.setHex(ratio > 0.6 ? 0x51d96a : (ratio > 0.3 ? 0xffd94d : 0xff5a4d));
    if (camPos) bar.lookAt(camPos.x, bar.position.y, camPos.z);
  };

  /* ---------- hiệu ứng nổ/burst đơn giản (sphere phình + mờ) ---------- */
  VeloPlay._spawnBurst = function (x, y, z, color) {
    if (typeof THREE === 'undefined' || !ME.Viewport3D || !ME.Viewport3D.scene) return;
    var m = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 8),
      new THREE.MeshBasicMaterial({ color: color || 0xffdc78, transparent: true, opacity: 0.9 })
    );
    m.position.set(x, y || 1, z);
    ME.Viewport3D.scene.add(m);
    VeloPlay._fx.push({ mesh: m, t: 0 });
  };
  VeloPlay._updateFx = function (dt) {
    for (var i = VeloPlay._fx.length - 1; i >= 0; i--) {
      var f = VeloPlay._fx[i];
      f.t += dt;
      var k = f.t / 0.4;
      if (k >= 1) {
        if (f.mesh.parent) f.mesh.parent.remove(f.mesh);
        VeloPlay._fx.splice(i, 1);
        continue;
      }
      f.mesh.scale.setScalar(1 + k * 4);
      f.mesh.material.opacity = 0.9 * (1 - k);
    }
  };

  VeloPlay._syncBolts = function () {
    if (typeof THREE === 'undefined' || !ME.Viewport3D || !ME.Viewport3D.scene) return;
    var st = VeloPlay._state;
    while (VeloPlay._boltMeshes.length < st.bolts.length) {
      var m = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffe066 })
      );
      ME.Viewport3D.scene.add(m);
      VeloPlay._boltMeshes.push(m);
    }
    while (VeloPlay._boltMeshes.length > st.bolts.length) {
      var old = VeloPlay._boltMeshes.pop();
      if (old.parent) old.parent.remove(old);
    }
    st.bolts.forEach(function (b, i) {
      var mesh = VeloPlay._boltMeshes[i];
      mesh.position.set(b.x, b.y || 1.2, b.z);
      mesh.material.color.setHex(b.team === 'enemy' ? 0xff4444 : 0xffe066);
    });
  };

  /* ---------- start / stop ---------- */
  VeloPlay.start = function () {
    if (VeloPlay._active) return true;
    if (typeof document !== 'undefined' && !VeloPlay._inited) VeloPlay.init();
    if (!VeloPlay.hasVeloScene()) {
      if (ME.MapEditor && ME.MapEditor.notify) ME.MapEditor.notify('Run Velo', 'Chưa có scene Velo — import demo3d Velo trước (panel Velo → "Import demo3d Velo").', 'warning');
      return false;
    }
    var ents = VeloPlay._collect();
    if (!ents.hero) {
      if (ME.MapEditor && ME.MapEditor.notify) ME.MapEditor.notify('Run Velo', 'Scene này không có Hero — import demo3d Velo để có Hero Thần Điêu.', 'warning');
      return false;
    }
    /* dừng play-mode patrol cũ nếu đang chạy */
    if (ME.Viewport3D && ME.Viewport3D.isPlaying()) ME.Viewport3D.setPlaying(false);
    VeloPlay._ents = ents;
    VeloPlay._snapshot = VeloPlay._takeSnapshot();
    var st = Core.newState({});
    var hp = ents.hero.obj.position;
    st.hero.homeX = hp.x; st.hero.homeZ = hp.z;
    st.hero.x = hp.x; st.hero.z = hp.z;
    st.hero.yaw = ents.hero.obj.rotation.y || 0;
    st.cam.yaw = st.hero.yaw + Math.PI; /* camera sau lưng hero */
    st.cam.x = hp.x - Math.sin(st.cam.yaw) * C.CAM_DIST;
    st.cam.z = hp.z - Math.cos(st.cam.yaw) * C.CAM_DIST;
    st.cam.lx = hp.x; st.cam.lz = hp.z;
    ents.enemies.forEach(function (e) {
      var p = e.obj.position;
      var pr = (e.data.velo && e.data.velo.pathRunner) || null;
      Core.addEnemy(st, {
        id: e.id, kind: e.kind, x: p.x, z: p.z, scale: e.obj.scale.x || 1,
        yaw: e.obj.rotation.y || 0, angle: 0
      });
    });
    ents.runners.forEach(function (r) {
      var pr = (r.data.velo && r.data.velo.pathRunner) || { radius: 10, speed: 5, phase: 0 };
      Core.addEnemy(st, {
        id: r.id, kind: 'runner', x: r.obj.position.x, z: r.obj.position.z,
        radius: pr.radius, speed: pr.speed, angle: pr.phase || 0
      });
    });
    ents.orbs.forEach(function (o) {
      Core.addOrb(st, { id: o.id, x: o.obj.position.x, z: o.obj.position.z, armed: 1 });
    });
    ents.heals.forEach(function (hz) {
      st.heals.push({ id: hz.id, x: hz.obj.position.x, z: hz.obj.position.z, r: hz.r });
    });
    VeloPlay._state = st;
    VeloPlay._keys = {};
    VeloPlay._edge = { dash: false, slash: false, bolt: false };
    VeloPlay._joy = { x: 0, y: 0, active: false };
    VeloPlay._dragOrbit = 0;
    VeloPlay._lastMode = {};
    VeloPlay._statsT = 0;
    /* thanh HP 3D cho enemy */
    VeloPlay._bars = {};
    ents.enemies.forEach(function (e) {
      var bar = VeloPlay._makeBar();
      if (bar && ME.Viewport3D && ME.Viewport3D.scene) {
        ME.Viewport3D.scene.add(bar);
        VeloPlay._bars[e.id] = bar;
      }
    });
    AudioMan.init();
    /* component V đã đăng ký (panel V Code): tạo VR + gắn vào node */
    try { VeloPlay._attachVComponents(); } catch (e) {
      if (typeof console !== 'undefined') console.error('[VCode] gắn component V lỗi:', e);
    }
    if (ME.Viewport3D) {
      try { ME.Viewport3D.attachGizmo(null); } catch (err) { }
    }
    VeloPlay._active = true;
    if (typeof document !== 'undefined') {
      document.body.classList.add('velo-playing');
      if (VeloPlay._els.hud) VeloPlay._els.hud.classList.remove('velo-hidden');
      if (VeloPlay._els.touch) VeloPlay._els.touch.classList.remove('velo-hidden');
      if (VeloPlay._els.banner) VeloPlay._els.banner.classList.add('velo-hidden');
    }
    if (ME.Viewport3D) ME.Viewport3D.setPlaying(true);
    if (ME.MapEditor && ME.MapEditor.setStatus) ME.MapEditor.setStatus('Đang chơi Velo — nhặt 20 orb để thắng! Esc để dừng.');
    VeloPlay._updateHud(true);
    return true;
  };

  VeloPlay.stop = function () {
    if (!VeloPlay._active) return false;
    VeloPlay._active = false;
    /* gỡ component V + hủy timer của VR */
    VeloPlay._clearVInstances();
    /* dọn mesh phụ */
    VeloPlay._boltMeshes.forEach(function (m) { if (m.parent) m.parent.remove(m); });
    VeloPlay._boltMeshes = [];
    VeloPlay._fx.forEach(function (f) { if (f.mesh.parent) f.mesh.parent.remove(f.mesh); });
    VeloPlay._fx = [];
    Object.keys(VeloPlay._bars).forEach(function (id) {
      var b = VeloPlay._bars[id];
      if (b && b.parent) b.parent.remove(b);
    });
    VeloPlay._bars = {};
    /* kỷ lục */
    if (VeloPlay._state && VeloPlay._best) {
      var b = VeloPlay._best;
      var changed = false;
      if (VeloPlay._state.orbCount > b.orbs) { b.orbs = VeloPlay._state.orbCount; changed = true; }
      if (VeloPlay._state.kills > b.kills) { b.kills = VeloPlay._state.kills; changed = true; }
      if (changed) saveBest(b);
    }
    /* khôi phục scene trước khi chạy — KHÔNG làm mất map đang sửa */
    VeloPlay._restoreSnapshot();
    if (typeof document !== 'undefined') {
      document.body.classList.remove('velo-playing');
      if (VeloPlay._els.hud) VeloPlay._els.hud.classList.add('velo-hidden');
      if (VeloPlay._els.touch) VeloPlay._els.touch.classList.add('velo-hidden');
    }
    VeloPlay._state = null;
    VeloPlay._ents = null;
    if (ME.Viewport3D && ME.Viewport3D._playing) ME.Viewport3D.setPlaying(false);
    if (ME.MapEditor && ME.MapEditor.setStatus) ME.MapEditor.setStatus('Đã dừng Run Velo — map được khôi phục.');
    return true;
  };

  /* ---------- HUD ---------- */
  VeloPlay._updateHud = function (force) {
    var E = VeloPlay._els, st = VeloPlay._state;
    if (!E.orbs || !st) return;
    E.orbs.textContent = 'Orbs: ' + st.orbCount + '/' + st.winTarget;
    var ratio = Math.max(0, st.hp / st.maxHp);
    E.hpBar.style.width = Math.round(ratio * 100) + '%';
    E.hpBar.style.background = ratio > 0.6 ? '#51d96a' : (ratio > 0.3 ? '#ffd94d' : '#ff5a4d');
    E.hpText.textContent = 'HP ' + st.hp + '/' + st.maxHp;
    E.kills.textContent = 'Defeated: ' + st.kills;
    if (VeloPlay._best) E.best.textContent = 'Best: ' + VeloPlay._best.orbs + ' orb · ' + VeloPlay._best.kills + ' kills';
    VeloPlay._statsT -= 0;
    if (force || VeloPlay._statsT <= 0) {
      VeloPlay._statsT = 0.25;
      var s = (ME.Viewport3D && ME.Viewport3D._stats) || { fps: 0, calls: 0, tris: 0 };
      E.stats.textContent = s.fps + ' fps 3D: ' + s.calls + ' draws, ' + (s.tris / 1000).toFixed(1) + 'k triangles';
    } else {
      VeloPlay._statsT -= 0.016;
    }
  };
  VeloPlay._showBanner = function (html) {
    var b = VeloPlay._els.banner;
    if (!b) return;
    b.innerHTML = html;
    b.classList.remove('velo-hidden');
  };

  /* ---------- update mỗi frame (gọi từ Viewport3D.updatePlay) ---------- */
  VeloPlay.update = function (dt) {
    if (!VeloPlay._active || !VeloPlay._state || !VeloPlay._ents) return;
    var st = VeloPlay._state, ents = VeloPlay._ents;
    dt = Math.min(0.1, dt || 0.016);
    /* --- input: bàn phím + joystick, chạy tương đối camera --- */
    var k = VeloPlay._keys;
    var ix = 0, iz = 0;
    if (k['KeyW'] || k['ArrowUp']) iz -= 1;
    if (k['KeyS'] || k['ArrowDown']) iz += 1;
    if (k['KeyA'] || k['ArrowLeft']) ix -= 1;
    if (k['KeyD'] || k['ArrowRight']) ix += 1;
    var mag = 1;
    if (VeloPlay._joy.active && (VeloPlay._joy.x !== 0 || VeloPlay._joy.y !== 0)) {
      ix = VeloPlay._joy.x; iz = VeloPlay._joy.y;
      mag = Math.min(1, Math.hypot(ix, iz)) || 1;
    }
    var yaw = st.cam.yaw;
    var mx = Math.sin(yaw) * (-iz) + Math.cos(yaw) * ix;
    var mz = Math.cos(yaw) * (-iz) - Math.sin(yaw) * ix;
    /* orbit: Q/E 120°/s + kéo chuột 0.3°/px */
    var orbit = 0;
    if (k['KeyQ']) orbit -= C.ORBIT_SPEED * dt;
    if (k['KeyE']) orbit += C.ORBIT_SPEED * dt;
    orbit += VeloPlay._dragOrbit;
    VeloPlay._dragOrbit = 0;
    /* snapshot phím bấm cho code V (Core.step xóa _edge ngay sau) */
    VeloPlay._vPressed = {};
    if (VeloPlay._edge.dash) { VeloPlay._vPressed['space'] = true; VeloPlay._vPressed['left_shift'] = true; }
    if (VeloPlay._edge.slash) { VeloPlay._vPressed['j'] = true; VeloPlay._vPressed['mouse'] = true; }
    if (VeloPlay._edge.bolt) VeloPlay._vPressed['k'] = true;
    var inp = {
      mx: mx, mz: mz, mag: mag,
      dash: VeloPlay._edge.dash, slash: VeloPlay._edge.slash, bolt: VeloPlay._edge.bolt
    };
    /* component V lái hero/combat thì Core nhường: bỏ input + autopilot
     * (lastInput = now) và bỏ dash/slash/bolt của Core */
    var vHero = VeloPlay._hasVComp('HeroController');
    var vCombat = VeloPlay._hasVComp('HeroCombat');
    if (vHero) { inp.mx = 0; inp.mz = 0; st.hero.lastInput = st.time; }
    if (vHero || vCombat) { inp.dash = false; inp.slash = false; inp.bolt = false; }
    VeloPlay._edge.dash = false; VeloPlay._edge.slash = false; VeloPlay._edge.bolt = false;
    Core.step(st, inp, dt, orbit);
    var events = Core.drainEvents(st);
    events.forEach(function (ev) {
      if (ev.type === 'orb') { AudioMan.sfx('pickup'); VeloPlay._spawnBurst(ev.x, 1, ev.z, 0xffdc78); }
      else if (ev.type === 'slash') AudioMan.sfx('swing');
      else if (ev.type === 'slashHit' || ev.type === 'enemyHit') AudioMan.sfx('hit');
      else if (ev.type === 'bolt' || ev.type === 'gun') AudioMan.sfx('skill');
      else if (ev.type === 'hurt') AudioMan.sfx('hit');
      else if (ev.type === 'heroDead') {
        AudioMan.sfx('death');
        VeloPlay._showBanner('💀 Chết! Orbs reset về 0 — hồi sinh sau 2s…');
        setTimeout(function () { if (VeloPlay._els.banner) VeloPlay._els.banner.classList.add('velo-hidden'); }, 2100);
      }
      else if (ev.type === 'enemyDead') { AudioMan.sfx('levelup'); }
      else if (ev.type === 'heal') AudioMan.sfx('pickup');
      else if (ev.type === 'win') {
        AudioMan.sfx('levelup'); AudioMan.sfx('quest');
        var b = VeloPlay._best || { orbs: 0, kills: 0 };
        VeloPlay._showBanner('🏆 Thắng! Orbs: ' + ev.orbs + ' · Kills: ' + ev.kills +
          ' · Best: ' + Math.max(b.orbs, ev.orbs) + ' orb / ' + Math.max(b.kills, ev.kills) + ' kills' +
          '<br><button class="velo-banner-btn" onclick="document.getElementById(\'velo-hud-stop\').click()">⏹ Về editor</button>');
      }
      else if (ev.type === 'burst') VeloPlay._spawnBurst(ev.x, 1, ev.z, 0xff8844);
      else if (ev.type === 'puff') { /* bụi chân/dash: chỉ âm thanh nhẹ, không mesh riêng */ }
    });
    VeloPlay._applyToScene(dt);
    VeloPlay._syncBolts();
    VeloPlay._updateFx(dt);
    VeloPlay._updateHud(false);
    /* component V chạy sau Core (được ghi đè vị trí), rồi đồng bộ về */
    VeloPlay._updateVComponents(dt);
    VeloPlay._vPressed = {};
    VeloPlay._vMouse.pressed = false; VeloPlay._vMouse.released = false;
  };

  VeloPlay._terrainY = function (x, z) {
    try {
      if (ME.TerrainEditor && ME.TerrainEditor.heightAt) return ME.TerrainEditor.heightAt(x, z);
    } catch (e) { }
    return 0;
  };
  VeloPlay._setThandieuMode = function (id, mode, ratio) {
    if (VeloPlay._lastMode[id] === mode + ':' + Math.round((ratio || 0) * 10)) return;
    VeloPlay._lastMode[id] = mode + ':' + Math.round((ratio || 0) * 10);
    if (ME.MapEditor && ME.MapEditor._thandieuSetMode) ME.MapEditor._thandieuSetMode(id, mode, ratio);
  };

  VeloPlay._applyToScene = function (dt) {
    var st = VeloPlay._state, ents = VeloPlay._ents;
    var h = st.hero;
    /* hero */
    var heroObj = ents.hero.obj;
    heroObj.position.set(h.x, VeloPlay._terrainY(h.x, h.z), h.z);
    heroObj.rotation.y = h.yaw;
    var snap = null;
    if (VeloPlay._snapshot) {
      for (var si = 0; si < VeloPlay._snapshot.objects.length; si++) {
        if (VeloPlay._snapshot.objects[si].id === ents.hero.id) { snap = VeloPlay._snapshot.objects[si]; break; }
      }
    }
    var baseSy = snap ? snap.scale[1] : 1;
    /* đứng yên ease về idle_frame + thở scale.y=1+sin(t*2.4)*0.008 (game.v) */
    if (!h.moving && !h.dead) heroObj.scale.y = baseSy * (1 + Math.sin(st.time * 2.4) * 0.008);
    else heroObj.scale.y = baseSy;
    heroObj.visible = !h.dead || (Math.floor(st.time * 4) % 2 === 0);
    if (h.dead) heroObj.visible = false;
    VeloPlay._setThandieuMode(ents.hero.id, h.moving && !h.dead ? 'run' : 'idle', h.moving ? h.speed / C.CLIP_SPEED : 0);
    /* enemies */
    st.enemies.forEach(function (en) {
      var ent = null;
      for (var i = 0; i < ents.enemies.length; i++) if (ents.enemies[i].id === en.id) { ent = ents.enemies[i]; break; }
      if (!ent) {
        for (var j = 0; j < ents.runners.length; j++) if (ents.runners[j].id === en.id) { ent = ents.runners[j]; break; }
      }
      if (!ent) return;
      var obj = ent.obj;
      var y = en.kind === 'drone' ? en.y : VeloPlay._terrainY(en.x, en.z) + en.y;
      obj.position.set(en.x, y, en.z);
      obj.rotation.y = en.yaw;
      if (en.kind === 'drone') obj.rotation.z = en.tiltZ || 0;
      if (en.kind === 'slime') {
        var bs = (ent.obj.scale.x || 1);
        obj.scale.set(bs * en.sx, bs * en.sy, bs * en.sx);
      }
      if (en.kind === 'runner') VeloPlay._setThandieuMode(en.id, 'run', 1);
      obj.visible = !en.dead;
      /* hit flash trắng: nhấp nháy material khi vừa trúng */
      if (en.flashT > 0) {
        obj.traverse(function (ch) {
          if (ch.isMesh && ch.material && ch.material.emissive) ch.material.emissive.setHex(0xffffff);
        });
      }
      var bar = VeloPlay._bars[en.id];
      if (bar) {
        bar.visible = !en.dead;
        bar.position.set(en.x, y + 1.8, en.z);
        var cam = ME.Viewport3D && ME.Viewport3D.camera;
        VeloPlay._updateBar(bar, en, cam ? cam.position : null);
      }
    });
    /* orbs: bob 0.2, tốc độ 2 (Bob3D) */
    st.orbs.forEach(function (o, idx) {
      for (var i = 0; i < ents.orbs.length; i++) {
        if (ents.orbs[i].id === o.id) {
          ents.orbs[i].obj.position.set(o.x, 1 + 0.2 * Math.sin(st.time * 2 + idx), o.z);
          break;
        }
      }
    });
    /* camera: FollowCamera — lái CameraRig (desired state, rig tự damping) */
    var rig = ME.Viewport3D && ME.Viewport3D.rig;
    if (rig) {
      var radius = Math.hypot(C.CAM_DIST, C.CAM_HEIGHT);
      rig.dTarget.set(st.cam.lx, st.cam.ly, st.cam.lz);
      rig.dTheta = st.cam.yaw;
      rig.dRadius = radius;
      rig.dPhi = Math.acos(C.CAM_HEIGHT / radius);
    }
  };

  ME.VeloPlay = VeloPlay;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = VeloPlay;
  }
})();
