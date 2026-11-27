/* ============================================================
 * physics/physics-engine.js — Physics engine đầy đủ (v5.1):
 * broadphase Sweep-and-Prune + narrowphase (sphere/box/capsule),
 * solver xung lực tuần tự (restitution + friction Coulomb),
 * joint constraint (ball / hinge / fixed / spring / distance),
 * sàn + tường bao, stacking (sleep + hiệu chỉnh vị trí),
 * raycast xuống đất / vào vật.
 *
 * Đơn vị: mét / kg / giây. Không cần WebGL — chỉ dùng THREE.Vector3 /
 * Quaternion nên chạy được cả trong jsdom harness.
 * API cũ của physics-manager.js (rigidbody props, collider box,
 * visualize __phys_collider__, startSim/stopSim/step) được GIỮ NGUYÊN;
 * manager sẽ ủy thác sang engine khi engine đã load.
 * ============================================================ */
(function () {
  'use strict';

  var V3 = THREE.Vector3;
  var QT = THREE.Quaternion;

  /* ---------- temp (tránh cấp phát trong vòng lặp) ---------- */
  var _t1 = new V3(), _t2 = new V3(), _t3 = new V3(), _t4 = new V3();
  var _q1 = new QT();

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ============================================================
     BODY
     shape: { type:'sphere', radius } |
            { type:'box', half: Vector3 } |
            { type:'capsule', radius, halfLen, axis: Vector3(local, đơn vị) }
     ============================================================ */
  var _bodySeq = 0;
  function makeBody(opts) {
    opts = opts || {};
    var shape = opts.shape || { type: 'sphere', radius: 0.5 };
    if (shape.type === 'box' && !(shape.half instanceof V3)) {
      var s = opts.size || shape.size || [1, 1, 1];
      shape.half = new V3(s[0] / 2, s[1] / 2, s[2] / 2);
    }
    if (shape.type === 'capsule') {
      shape.radius = shape.radius || 0.2;
      shape.halfLen = shape.halfLen || 0.3;
      shape.axis = shape.axis || new V3(0, 1, 0);
    }
    if (shape.type === 'sphere') shape.radius = shape.radius || 0.5;
    var mass = (opts.isStatic || opts.mass === 0) ? 0 : (opts.mass != null ? opts.mass : 1);
    var b = {
      id: 'phys_' + (++_bodySeq),
      label: opts.label || opts.name || null,
      object3D: opts.object3D || null,
      shape: shape,
      position: (opts.position ? opts.position.clone() : new V3(0, 1, 0)),
      quaternion: (opts.quaternion ? opts.quaternion.clone() : new QT()),
      velocity: (opts.velocity ? opts.velocity.clone() : new V3()),
      angularVelocity: (opts.angularVelocity ? opts.angularVelocity.clone() : new V3()),
      mass: mass,
      invMass: mass > 0 ? 1 / mass : 0,
      isStatic: mass === 0 || !!opts.isStatic,
      isKinematic: !!opts.isKinematic,
      restitution: opts.restitution != null ? opts.restitution : (opts.bounciness != null ? opts.bounciness : 0.3),
      friction: opts.friction != null ? opts.friction : 0.6,
      linearDamping: opts.linearDamping != null ? opts.linearDamping : 0.01,
      angularDamping: opts.angularDamping != null ? opts.angularDamping : 0.05,
      gravityScale: opts.gravityScale != null ? opts.gravityScale : 1,
      useGravity: opts.useGravity !== false,
      /* ngủ: giúp stacking đứng yên, không rung */
      sleeping: false,
      _sleepTime: 0,
      _force: new V3(),
      _torque: new V3(),
      invInertia: new V3(1, 1, 1), /* local, đường chéo */
      aabbMin: new V3(),
      aabbMax: new V3(),
      userData: opts.userData || {},
      _restPos: null, _restQuat: null
    };
    if (opts.object3D) {
      b.label = b.label || opts.object3D.name || opts.object3D.uuid.slice(0, 8);
      b.position.copy(opts.object3D.position);
      b.quaternion.copy(opts.object3D.quaternion);
    }
    computeInertia(b);
    if (b.object3D) { b._restPos = b.position.clone(); b._restQuat = b.quaternion.clone(); }
    updateAABB(b);
    return b;
  }

  function computeInertia(b) {
    var m = b.mass, s = b.shape, ix, iy, iz;
    if (m <= 0) { b.invInertia.set(0, 0, 0); return; }
    if (s.type === 'sphere') {
      var i = 0.4 * m * s.radius * s.radius; ix = iy = iz = i;
    } else if (s.type === 'box') {
      var hx = s.half.x, hy = s.half.y, hz = s.half.z;
      ix = m / 12 * (4 * hy * hy + 4 * hz * hz);
      iy = m / 12 * (4 * hx * hx + 4 * hz * hz);
      iz = m / 12 * (4 * hx * hx + 4 * hy * hy);
    } else { /* capsule: xấp xỉ hình trụ + 2 nửa cầu */
      var L = 2 * s.halfLen, r = s.radius;
      var iAx = 0.5 * m * r * r;
      var iTr = m / 12 * (3 * r * r + L * L);
      /* trục capsule là local Y */
      ix = iTr; iy = iAx; iz = iTr;
    }
    /* clamp: body rất nhỏ (ngón tay r=2cm, m=0.1kg) có inertia thật
     * ~1.6e-5 → invI ~62500, 1 xung lực nhỏ cũng quay 60 rad/s và
     * cả ragdoll rung mãi không lắng (từng đo LeftHandThumb1 |w|=60).
     * Kẹp invI tối đa 2000 — ngón tay quay "nặng" hơn thật một chút
     * nhưng solver ổn định. */
    b.invInertia.set(
      ix > 0 ? Math.min(1 / ix, 2000) : 0,
      iy > 0 ? Math.min(1 / iy, 2000) : 0,
      iz > 0 ? Math.min(1 / iz, 2000) : 0);
  }

  /* invInertia thế giới * v : q * (invI_local ⊙ (q^-1 * v)) */
  function applyInvInertia(b, v, out) {
    out.copy(v).applyQuaternion(_q1.copy(b.quaternion).invert());
    out.set(out.x * b.invInertia.x, out.y * b.invInertia.y, out.z * b.invInertia.z);
    out.applyQuaternion(b.quaternion);
    return out;
  }

  /* ---------- support point / AABB ---------- */
  function supportPoint(b, dir, out) {
    var s = b.shape;
    if (s.type === 'sphere') {
      return out.copy(b.position).addScaledVector(dir, s.radius);
    }
    if (s.type === 'box') {
      _t1.copy(dir).applyQuaternion(_q1.copy(b.quaternion).invert());
      _t2.set(
        _t1.x >= 0 ? s.half.x : -s.half.x,
        _t1.y >= 0 ? s.half.y : -s.half.y,
        _t1.z >= 0 ? s.half.z : -s.half.z);
      _t2.applyQuaternion(b.quaternion);
      return out.copy(b.position).add(_t2);
    }
    /* capsule: đầu gần hướng dir nhất + dir * r.
     * LƯU Ý: dir có thể alias temp _t1/_t2 của caller nên phải copy
     * sang vector riêng trước khi tính (từng gây bug xuyên sàn). */
    var axW = new V3().copy(s.axis).applyQuaternion(b.quaternion).multiplyScalar(s.halfLen);
    var dot = axW.dot(dir);
    out.copy(b.position).addScaledVector(axW, dot >= 0 ? 1 : -1).addScaledVector(dir, s.radius);
    return out;
  }
  function capsuleEndpoints(b, outA, outB) {
    _t1.copy(b.shape.axis).applyQuaternion(b.quaternion).multiplyScalar(b.shape.halfLen);
    outA.copy(b.position).sub(_t1);
    outB.copy(b.position).add(_t1);
    return { a: outA, b: outB };
  }
  function updateAABB(b) {
    var s = b.shape, mn = b.aabbMin, mx = b.aabbMax;
    if (s.type === 'sphere') {
      mn.set(b.position.x - s.radius, b.position.y - s.radius, b.position.z - s.radius);
      mx.set(b.position.x + s.radius, b.position.y + s.radius, b.position.z + s.radius);
    } else if (s.type === 'box') {
      /* |R| * half */
      var q = b.quaternion, x = q.x, y = q.y, z = q.z, w = q.w;
      var r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
      var r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
      var r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
      var ex = Math.abs(r00) * s.half.x + Math.abs(r01) * s.half.y + Math.abs(r02) * s.half.z;
      var ey = Math.abs(r10) * s.half.x + Math.abs(r11) * s.half.y + Math.abs(r12) * s.half.z;
      var ez = Math.abs(r20) * s.half.x + Math.abs(r21) * s.half.y + Math.abs(r22) * s.half.z;
      mn.set(b.position.x - ex, b.position.y - ey, b.position.z - ez);
      mx.set(b.position.x + ex, b.position.y + ey, b.position.z + ez);
    } else {
      var ep = capsuleEndpoints(b, _t3, _t4);
      var r = s.radius;
      mn.set(Math.min(ep.a.x, ep.b.x) - r, Math.min(ep.a.y, ep.b.y) - r, Math.min(ep.a.z, ep.b.z) - r);
      mx.set(Math.max(ep.a.x, ep.b.x) + r, Math.max(ep.a.y, ep.b.y) + r, Math.max(ep.a.z, ep.b.z) + r);
    }
  }

  /* ---------- NARROWPHASE ---------- */
  /* contact: { a, b, point, normal (A→B), pen } */
  function contact(a, b, point, normal, pen) {
    return { a: a, b: b, point: point.clone(), normal: normal.clone().normalize(), pen: pen };
  }

  function collideSphereSphere(a, b) {
    _t1.subVectors(b.position, a.position);
    var d2 = _t1.lengthSq(), r = a.shape.radius + b.shape.radius + Engine._margin;
    if (d2 >= r * r) return null;
    var d = Math.sqrt(d2);
    var n = d > 1e-6 ? _t1.clone().multiplyScalar(1 / d) : new V3(0, 1, 0);
    var p = a.position.clone().addScaledVector(n, a.shape.radius - (r - d) / 2);
    return contact(a, b, p, n, r - d);
  }

  function collideSphereBox(s, bx) {
    /* đưa tâm sphere về local của box, clamp, đo khoảng cách */
    _t1.copy(s.position).sub(bx.position).applyQuaternion(_q1.copy(bx.quaternion).invert());
    var h = bx.shape.half;
    _t2.set(clamp(_t1.x, -h.x, h.x), clamp(_t1.y, -h.y, h.y), clamp(_t1.z, -h.z, h.z));
    _t3.subVectors(_t1, _t2);
    var d2 = _t3.lengthSq(), r = s.shape.radius + Engine._margin;
    var inside = d2 < 1e-12;
    if (!inside && d2 >= r * r) return null;
    var nLocal, pen;
    if (inside) {
      /* tâm nằm trong box: đẩy ra theo mặt gần nhất */
      var dx = h.x - Math.abs(_t1.x), dy = h.y - Math.abs(_t1.y), dz = h.z - Math.abs(_t1.z);
      if (dx <= dy && dx <= dz) { nLocal = new V3(_t1.x >= 0 ? 1 : -1, 0, 0); pen = dx + r; }
      else if (dy <= dz) { nLocal = new V3(0, _t1.y >= 0 ? 1 : -1, 0); pen = dy + r; }
      else { nLocal = new V3(0, 0, _t1.z >= 0 ? 1 : -1); pen = dz + r; }
    } else {
      var d = Math.sqrt(d2);
      nLocal = _t3.clone().multiplyScalar(1 / d);
      pen = r - d;
    }
    var nWorld = nLocal.clone().applyQuaternion(bx.quaternion);
    /* normal phải hướng từ A(sphere) sang B(box): nLocal đang hướng từ box ra sphere → đảo */
    nWorld.negate();
    var p = s.position.clone().addScaledVector(nWorld, -r + pen / 2);
    /* điểm tiếp xúc: điểm gần nhất trên box */
    p.copy(_t2).applyQuaternion(bx.quaternion).add(bx.position);
    return contact(s, bx, p, nWorld, pen);
  }

  function boxAxes(b, out) {
    out[0].set(1, 0, 0).applyQuaternion(b.quaternion);
    out[1].set(0, 1, 0).applyQuaternion(b.quaternion);
    out[2].set(0, 0, 1).applyQuaternion(b.quaternion);
    return out;
  }
  var _axA = [new V3(), new V3(), new V3()], _axB = [new V3(), new V3(), new V3()];

  function collideBoxBox(a, b) {
    boxAxes(a, _axA); boxAxes(b, _axB);
    _t1.subVectors(b.position, a.position);
    var axes = [];
    for (var i = 0; i < 3; i++) axes.push(_axA[i].clone());
    for (var j = 0; j < 3; j++) axes.push(_axB[j].clone());
    for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) {
      _t2.crossVectors(_axA[i], _axB[j]);
      if (_t2.lengthSq() > 1e-8) axes.push(_t2.clone().normalize());
    }
    var minPen = Infinity, minAxis = null;
    for (var k = 0; k < axes.length; k++) {
      var ax = axes[k];
      var ra = a.shape.half.x * Math.abs(ax.dot(_axA[0])) + a.shape.half.y * Math.abs(ax.dot(_axA[1])) + a.shape.half.z * Math.abs(ax.dot(_axA[2]));
      var rb = b.shape.half.x * Math.abs(ax.dot(_axB[0])) + b.shape.half.y * Math.abs(ax.dot(_axB[1])) + b.shape.half.z * Math.abs(ax.dot(_axB[2]));
      var dist = Math.abs(_t1.dot(ax));
      var pen = ra + rb - dist + Engine._margin;
      if (pen <= 0) return null;
      if (pen < minPen) { minPen = pen; minAxis = ax; }
    }
    var n = minAxis.clone();
    if (_t1.dot(n) < 0) n.negate();
    /* Điểm tiếp xúc: GIỮA MẶT tiếp xúc, không lấy góc — lấy 1 góc làm
     * điểm đặt lực sẽ sinh torque lớn, hộp chồng bị xoay/bật lên thay
     * vì đứng yên (từng đo hộp 2 bay lên y=1.79). Tính bằng trung điểm
     * 2 tâm rồi chiếu lên mặt phẳng tiếp xúc (trung bình 2 support). */
    var mid = new V3().addVectors(a.position, b.position).multiplyScalar(0.5);
    var pA = supportPoint(a, n, new V3());
    var pB = supportPoint(b, _t2.copy(n).negate(), new V3());
    var planeD = (pA.dot(n) + pB.dot(n)) / 2;
    var p = mid.addScaledVector(n, planeD - mid.dot(n));
    return contact(a, b, p, n, minPen);
  }

  function closestSegSeg(p1, q1, p2, q2, out1, out2) {
    /* Ericson 5.1.9 — khoảng cách gần nhất giữa 2 đoạn thẳng */
    var d1 = new V3().subVectors(q1, p1), d2 = new V3().subVectors(q2, p2);
    var r = new V3().subVectors(p1, p2);
    var a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2);
    var denom = a * e - b * b, s = denom > 1e-12 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
    var t = e > 1e-12 ? (b * s + f) / e : 0;
    if (t < 0) { t = 0; s = clamp(-c / (a || 1e-12), 0, 1); }
    else if (t > 1) { t = 1; s = clamp((b - c) / (a || 1e-12), 0, 1); }
    out1.copy(p1).addScaledVector(d1, s);
    out2.copy(p2).addScaledVector(d2, t);
    return out1.distanceTo(out2);
  }

  function collideSphereCapsule(s, c) {
    var ep = capsuleEndpoints(c, new V3(), new V3());
    /* điểm gần nhất trên đoạn capsule tới tâm sphere */
    _t1.subVectors(ep.b, ep.a);
    var len2 = _t1.lengthSq();
    var t = len2 > 1e-12 ? clamp(_t2.subVectors(s.position, ep.a).dot(_t1) / len2, 0, 1) : 0;
    _t3.copy(ep.a).addScaledVector(_t1, t);
    _t4.subVectors(s.position, _t3);
    var d = _t4.length(), r = s.shape.radius + c.shape.radius + Engine._margin;
    if (d >= r) return null;
    var n = d > 1e-6 ? _t4.clone().multiplyScalar(1 / d) : new V3(0, 1, 0);
    var p = _t3.clone().addScaledVector(n, c.shape.radius - (r - d) / 2);
    return contact(s, c, p, n, r - d);
  }

  function collideCapsuleCapsule(a, b) {
    var ea = capsuleEndpoints(a, new V3(), new V3()), eb = capsuleEndpoints(b, new V3(), new V3());
    var c1 = new V3(), c2 = new V3();
    var d = closestSegSeg(ea.a, ea.b, eb.a, eb.b, c1, c2);
    var r = a.shape.radius + b.shape.radius + Engine._margin;
    if (d >= r) return null;
    _t1.subVectors(c2, c1);
    var n = d > 1e-6 ? _t1.clone().multiplyScalar(1 / d) : new V3(0, 1, 0);
    var p = c1.clone().addScaledVector(n, a.shape.radius - (r - d) / 2);
    return contact(a, b, p, n, r - d);
  }

  function collideCapsuleBox(c, bx) {
    var ep = capsuleEndpoints(c, new V3(), new V3());
    /* điểm gần nhất trên đoạn capsule tới box (xấp xỉ: thử 2 đầu + trung điểm) */
    var best = null, bestD = Infinity;
    [ep.a, ep.b, new V3().addVectors(ep.a, ep.b).multiplyScalar(0.5)].forEach(function (pt) {
      _t1.copy(pt).sub(bx.position).applyQuaternion(_q1.copy(bx.quaternion).invert());
      var h = bx.shape.half;
      _t2.set(clamp(_t1.x, -h.x, h.x), clamp(_t1.y, -h.y, h.y), clamp(_t1.z, -h.z, h.z));
      _t3.copy(_t2).applyQuaternion(bx.quaternion).add(bx.position);
      var d = pt.distanceTo(_t3);
      if (d < bestD) { bestD = d; best = { pt: pt.clone(), closest: _t3.clone() }; }
    });
    var r = c.shape.radius + Engine._margin;
    if (bestD >= r) return null;
    _t1.subVectors(best.pt, best.closest);
    var n = bestD > 1e-6 ? _t1.clone().multiplyScalar(1 / bestD) : new V3(0, 1, 0);
    var p = best.closest.clone().addScaledVector(n, (r - bestD) / 2);
    return contact(c, bx, p, n, r - bestD);
  }

  function collidePair(a, b) {
    var ta = a.shape.type, tb = b.shape.type;
    if (ta === 'sphere' && tb === 'sphere') return collideSphereSphere(a, b);
    if (ta === 'sphere' && tb === 'box') return collideSphereBox(a, b);
    if (ta === 'box' && tb === 'sphere') { var c = collideSphereBox(b, a); if (c) { c.normal.negate(); var t = c.a; c.a = c.b; c.b = t; } return c; }
    if (ta === 'box' && tb === 'box') return collideBoxBox(a, b);
    if (ta === 'sphere' && tb === 'capsule') return collideSphereCapsule(a, b);
    if (ta === 'capsule' && tb === 'sphere') { var c2 = collideSphereCapsule(b, a); if (c2) { c2.normal.negate(); var t2 = c2.a; c2.a = c2.b; c2.b = t2; } return c2; }
    if (ta === 'capsule' && tb === 'capsule') return collideCapsuleCapsule(a, b);
    if (ta === 'capsule' && tb === 'box') return collideCapsuleBox(a, b);
    if (ta === 'box' && tb === 'capsule') { var c3 = collideCapsuleBox(b, a); if (c3) { c3.normal.negate(); var t3 = c3.a; c3.a = c3.b; c3.b = t3; } return c3; }
    return null;
  }

  /* ---------- BROADPHASE: sweep-and-prune theo trục X ---------- */
  function broadphasePairs(bodies) {
    var sorted = bodies.slice().sort(function (x, y) { return x.aabbMin.x - y.aabbMin.x; });
    var pairs = [], active = [];
    for (var i = 0; i < sorted.length; i++) {
      var b = sorted[i];
      for (var j = active.length - 1; j >= 0; j--) {
        var o = active[j];
        if (o.aabbMax.x < b.aabbMin.x) { active.splice(j, 1); continue; }
        if (o.aabbMax.y < b.aabbMin.y || o.aabbMin.y > b.aabbMax.y) continue;
        if (o.aabbMax.z < b.aabbMin.z || o.aabbMin.z > b.aabbMax.z) continue;
        if (o.isStatic && b.isStatic) continue;
        pairs.push([o, b]);
      }
      active.push(b);
    }
    return pairs;
  }

  /* ============================================================
     JOINTS — constraint nối 2 body.
     anchorA/anchorB: điểm neo LOCAL (mặc định gốc body).
     hinge: axisA/axisB local + minAngle/maxAngle (rad, quanh trục).
     spring: stiffness (N/m), damping, restLength.
     ============================================================ */
  var _jointSeq = 0;
  function makeJoint(type, a, b, opts) {
    opts = opts || {};
    var j = {
      id: 'joint_' + (++_jointSeq),
      type: type,
      a: a, b: b,
      anchorA: (opts.anchorA ? opts.anchorA.clone() : new V3()),
      anchorB: (opts.anchorB ? opts.anchorB.clone() : new V3()),
      axisA: (opts.axisA ? opts.axisA.clone().normalize() : new V3(1, 0, 0)),
      axisB: (opts.axisB ? opts.axisB.clone().normalize() : new V3(1, 0, 0)),
      refA: (opts.refA ? opts.refA.clone().normalize() : new V3(0, 1, 0)),
      refB: (opts.refB ? opts.refB.clone().normalize() : new V3(0, 1, 0)),
      minAngle: opts.minAngle != null ? opts.minAngle : -Math.PI,
      maxAngle: opts.maxAngle != null ? opts.maxAngle : Math.PI,
      stiffness: opts.stiffness != null ? opts.stiffness : 100,
      damping: opts.damping != null ? opts.damping : 5,
      restLength: opts.restLength,
      enabled: opts.enabled !== false,
      label: opts.label || type
    };
    if (j.restLength == null) {
      var wa = worldAnchor(a, j.anchorA, new V3()), wb = worldAnchor(b, j.anchorB, new V3());
      j.restLength = wa.distanceTo(wb);
    }
    return j;
  }
  function worldAnchor(body, local, out) {
    return out.copy(local).applyQuaternion(body.quaternion).add(body.position);
  }
  function pointVelocity(body, point, out) {
    _t1.subVectors(point, body.position);
    out.copy(body.velocity).add(_t2.crossVectors(body.angularVelocity, _t1));
    return out;
  }
  function applyImpulse(body, impulse, point) {
    if (body.isStatic || body.invMass === 0) return;
    /* BUG CŨ (đã sửa): từng return sớm khi body.sleeping → body đang ngủ
     * không bao giờ nhận xung lực, solver cứ nện mãi vào vật còn thức
     * (cầu nặng 4kg vs cầu nhẹ 1kg cùng về 0.13 m/s). Giờ wake trước. */
    wake(body);
    body.velocity.addScaledVector(impulse, body.invMass);
    if (point) {
      _t1.subVectors(point, body.position);
      _t2.crossVectors(_t1, impulse);
      applyInvInertia(body, _t2, _t3);
      body.angularVelocity.add(_t3);
    }
  }
  function wake(body) {
    if (body.sleeping) { body.sleeping = false; body._sleepTime = 0; }
  }
  /* xoay body quanh trục thế giới 1 góc nhỏ (hiệu chỉnh vị trí joint) */
  function rotateBody(body, axisWorld, angle) {
    if (body.isStatic || body.invMass === 0) return;
    wake(body);
    _q1.setFromAxisAngle(axisWorld, angle);
    body.quaternion.premultiply(_q1).normalize();
  }

  /* ---------- JOINT SOLVE (vận tốc + vị trí) ---------- */
  var _wa = new V3(), _wb = new V3(), _va = new V3(), _vb = new V3(), _imp = new V3(), _rv = new V3();
  function solveJointVelocity(j) {
    if (!j.enabled) return;
    var a = j.a, b = j.b;
    if (j.type === 'spring') {
      worldAnchor(a, j.anchorA, _wa); worldAnchor(b, j.anchorB, _wb);
      _rv.subVectors(_wb, _wa);
      var len = _rv.length();
      if (len < 1e-6) return;
      var dir = _rv.clone().multiplyScalar(1 / len);
      pointVelocity(a, _wa, _va); pointVelocity(b, _wb, _vb);
      var relV = _rv.copy(_vb).sub(_va).dot(dir);
      var f = -j.stiffness * (len - j.restLength) - j.damping * relV;
      /* lò xo là LỰC: áp dụng trong solveVelocity bằng xung F*dt — dt lấy từ Engine._dt */
      _imp.copy(dir).multiplyScalar(f * Engine._dt);
      applyImpulse(a, _imp.clone().negate(), _wa);
      applyImpulse(b, _imp, _wb);
      return;
    }
    if (j.type === 'distance') {
      worldAnchor(a, j.anchorA, _wa); worldAnchor(b, j.anchorB, _wb);
      _rv.subVectors(_wb, _wa);
      var L = _rv.length();
      if (L < 1e-6) return;
      var d = _rv.clone().multiplyScalar(1 / L);
      pointVelocity(a, _wa, _va); pointVelocity(b, _wb, _vb);
      var rvn = _rv.copy(_vb).sub(_va).dot(d);
      var eff = a.invMass + b.invMass;
      if (eff <= 0) return;
      var lambda = -rvn / eff;
      _imp.copy(d).multiplyScalar(lambda);
      applyImpulse(a, _imp.clone().negate(), _wa);
      applyImpulse(b, _imp, _wb);
      return;
    }
    /* ball / hinge / fixed: neo trùng nhau (3 trục, Gauss-Seidel từng trục) */
    worldAnchor(a, j.anchorA, _wa); worldAnchor(b, j.anchorB, _wb);
    var axes = [new V3(1, 0, 0), new V3(0, 1, 0), new V3(0, 0, 1)];
    for (var k = 0; k < 3; k++) {
      var ax = axes[k];
      pointVelocity(a, _wa, _va); pointVelocity(b, _wb, _vb);
      var rvn2 = _rv.copy(_vb).sub(_va).dot(ax);
      /* effective mass dọc trục (kể cả góc) */
      _t1.subVectors(_wa, a.position); _t2.subVectors(_wb, b.position);
      var rnA = new V3().crossVectors(_t1, ax), rnB = new V3().crossVectors(_t2, ax);
      var eA = a.invMass + applyInvInertia(a, rnA, new V3()).dot(rnA);
      var eB = b.invMass + applyInvInertia(b, rnB, new V3()).dot(rnB);
      var eff2 = eA + eB;
      if (eff2 <= 1e-9) continue;
      var lam = -rvn2 / eff2;
      _imp.copy(ax).multiplyScalar(lam);
      applyImpulse(a, _imp.clone().negate(), _wa);
      applyImpulse(b, _imp, _wb);
    }
    /* hinge / fixed: khóa hướng */
    if (j.type === 'hinge') solveHingeAngular(j);
    if (j.type === 'fixed') solveFixedAngular(j);
  }
  function solveHingeAngular(j) {
    var a = j.a, b = j.b;
    var axA = j.axisA.clone().applyQuaternion(a.quaternion);
    var axB = j.axisB.clone().applyQuaternion(b.quaternion);
    /* 2 trục vuông góc với trục hinge phải song song → vận tốc góc tương đối theo 2 trục đó = 0 */
    var perp = new V3(0, 1, 0);
    if (Math.abs(axA.y) > 0.9) perp.set(1, 0, 0);
    var u = new V3().crossVectors(axA, perp).normalize();
    var v = new V3().crossVectors(axA, u).normalize();
    [u, v].forEach(function (axis) {
      var relW = _rv.copy(b.angularVelocity).sub(a.angularVelocity).dot(axis);
      var eA = applyInvInertia(a, axis, new V3()).dot(axis);
      var eB = applyInvInertia(b, axis, new V3()).dot(axis);
      var eff = eA + eB;
      if (eff <= 1e-9) return;
      var lam = -relW / eff;
      if (!a.isStatic) { wake(a); a.angularVelocity.addScaledVector(applyInvInertia(a, axis, new V3()), -lam); }
      if (!b.isStatic) { wake(b); b.angularVelocity.addScaledVector(applyInvInertia(b, axis, new V3()), lam); }
    });
    /* giới hạn góc: đo góc quanh trục hinge giữa refA và refB */
    var rA = j.refA.clone().applyQuaternion(a.quaternion);
    var rB = j.refB.clone().applyQuaternion(b.quaternion);
    /* chiếu ref lên mặt phẳng ⊥ trục hinge */
    rA.addScaledVector(axA, -rA.dot(axA)).normalize();
    rB.addScaledVector(axA, -rB.dot(axA)).normalize();
    if (rA.lengthSq() < 1e-6 || rB.lengthSq() < 1e-6) return;
    var ang = Math.atan2(new V3().crossVectors(rA, rB).dot(axA), clamp(rA.dot(rB), -1, 1));
    /* Giới hạn góc được xử lý bằng hiệu chỉnh VỊ TRÍ trong
     * solveJointPosition (ổn định hơn sửa vận tốc mỗi vòng lặp). */
    return;
  }
  function solveFixedAngular(j) {
    var a = j.a, b = j.b;
    /* khóa mọi vận tốc góc tương đối */
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(function (arr) {
      var axis = new V3(arr[0], arr[1], arr[2]);
      var relW = _rv.copy(b.angularVelocity).sub(a.angularVelocity).dot(axis);
      var eA = applyInvInertia(a, axis, new V3()).dot(axis);
      var eB = applyInvInertia(b, axis, new V3()).dot(axis);
      var eff = eA + eB;
      if (eff <= 1e-9) return;
      var lam = -relW / eff;
      if (!a.isStatic) { wake(a); a.angularVelocity.addScaledVector(applyInvInertia(a, axis, new V3()), -lam); }
      if (!b.isStatic) { wake(b); b.angularVelocity.addScaledVector(applyInvInertia(b, axis, new V3()), lam); }
    });
  }
  function solveJointPosition(j) {
    if (!j.enabled || j.type === 'spring' || j.type === 'distance') return;
    var a = j.a, b = j.b;
    worldAnchor(a, j.anchorA, _wa); worldAnchor(b, j.anchorB, _wb);
    _rv.subVectors(_wb, _wa);
    var err = _rv.length();
    if (err < 1e-4) return;
    var invSum = a.invMass + b.invMass;
    if (invSum <= 0) return;
    var corr = _rv.clone().multiplyScalar(0.35 / invSum); /* 0.35 (từng 0.5):
      joint mềm hơn để sàn thắng khi neo khớp bị kéo xuống dưới sàn */
    if (!a.isStatic) { wake(a); a.position.addScaledVector(corr, a.invMass); }
    if (!b.isStatic) { wake(b); b.position.addScaledVector(corr, -b.invMass); }
    updateAABB(a); updateAABB(b);
    if (j.type === 'hinge') {
      /* căn lại trục hinge (vị trí): xoay B về phía trục A */
      var axA = j.axisA.clone().applyQuaternion(a.quaternion);
      var axB = j.axisB.clone().applyQuaternion(b.quaternion);
      var cross = new V3().crossVectors(axB, axA);
      var s = cross.length();
      if (s > 1e-4) {
        var ang = Math.asin(clamp(s, -1, 1)) * 0.5;
        rotateBody(b, cross.normalize(), ang);
        rotateBody(a, cross, -ang * 0.5);
      }
      /* giới hạn góc quanh trục hinge (vị trí): kẹp về [min,max] */
      var rA = j.refA.clone().applyQuaternion(a.quaternion);
      var rB = j.refB.clone().applyQuaternion(b.quaternion);
      rA.addScaledVector(axA, -rA.dot(axA));
      rB.addScaledVector(axA, -rB.dot(axA));
      if (rA.lengthSq() > 1e-6 && rB.lengthSq() > 1e-6) {
        rA.normalize(); rB.normalize();
        var cur = Math.atan2(new V3().crossVectors(rA, rB).dot(axA), clamp(rA.dot(rB), -1, 1));
        var cl = clamp(cur, j.minAngle, j.maxAngle);
        var errA = cl - cur;
        if (Math.abs(errA) > 1e-3) {
          rotateBody(b, axA, errA * 0.5);
          rotateBody(a, axA, -errA * 0.5);
        }
      }
    }
    if (j.type === 'fixed') {
      /* căn lại hướng: xoay B theo quaternion sai lệch (một nửa) */
      var qErr = a.quaternion.clone().invert().multiply(b.quaternion);
      var ang2 = 2 * Math.acos(clamp(Math.abs(qErr.w), -1, 1));
      if (ang2 > 1e-3) {
        var axis2 = new V3(qErr.x, qErr.y, qErr.z);
        if (axis2.lengthSq() < 1e-8) axis2.set(1, 0, 0); else axis2.normalize();
        axis2.applyQuaternion(a.quaternion);
        rotateBody(b, axis2, -ang2 * 0.5);
      }
    }
  }

  /* ============================================================
     ENGINE
     ============================================================ */
  var Engine = {
    bodies: [],
    joints: [],
    gravity: new V3(0, -9.8, 0),
    floorY: 0,
    floorEnabled: true,
    bounds: null, /* { minX,maxX,minZ,maxZ } — null = không tường */
    iterations: 10,
    maxAngularSpeed: 25, /* rad/s — kẹp chống nổ solver */
    maxSpeed: 50, /* m/s — kẹp chống nổ solver */
    fixedDt: 1 / 120, /* substep 120Hz: xuyên sàn thoáng qua ≈ v×dt
      (rơi 10 m/s → ~8cm ở 60Hz, ~4cm ở 120Hz); harness đo bằng
      stepFixed(1/120) để khớp vòng lặp thật */
    simulating: false,
    _acc: 0,
    _dt: 1 / 60,
    _stats: { steps: 0, broadphasePairs: 0, narrowphaseTests: 0, contacts: 0 },
    _restitutionThreshold: 1.5, /* |vn| dưới ngưỡng → không nảy. 1.0 cũ tạo
      chu trình giới hạn: nảy nhỏ (vn≈1.1) được Euler bán-ẩn bơm lại đúng
      bằng năng lượng mất do restitution → bóng nảy mãi không dừng
      (đo được 30 cú nảy/12s, tỉ lệ hiệu dụng 0.918 thay vì 0.8).
      1.5 m/s ≈ rơi từ 11cm — nảy nhỏ hơn thế thì dừng, đúng cảm nhận. */
    _margin: 0.004 /* speculative contact: cặp shape cách nhau < 4mm vẫn
      tính là contact (chỉ để hủy vận tốc rơi, không đẩy vị trí) — nếu
      không, vật đứng yên cứ rơi 2.7mm/step rồi mới chạm lại, timer ngủ
      reset mãi và hộp chồng không bao giờ ngủ */
  };

  Engine.createBody = function (opts) {
    var b = makeBody(opts);
    Engine.bodies.push(b);
    return b;
  };
  Engine.removeBody = function (body) {
    var i = Engine.bodies.indexOf(body);
    if (i >= 0) Engine.bodies.splice(i, 1);
    Engine.joints = Engine.joints.filter(function (j) {
      if (j.a !== body && j.b !== body) return true;
      Engine._jointPairs.delete(Engine._pairKey(j.a, j.b));
      return false;
    });
    return i >= 0;
  };
  Engine.getBody = function (id) {
    for (var i = 0; i < Engine.bodies.length; i++) if (Engine.bodies[i].id === id) return Engine.bodies[i];
    return null;
  };
  Engine.clear = function () { Engine.bodies.length = 0; Engine.joints.length = 0; Engine._jointPairs.clear(); Engine._acc = 0; };
  Engine._jointPairs = new Set(); /* "idA|idB" — 2 body nối joint thì KHÔNG va chạm nhau */
  Engine._pairKey = function (a, b) { return a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id; };
  Engine.addJoint = function (type, a, b, opts) {
    var j = makeJoint(type, a, b, opts);
    Engine.joints.push(j);
    Engine._jointPairs.add(Engine._pairKey(a, b));
    return j;
  };
  Engine.removeJoint = function (j) {
    var i = Engine.joints.indexOf(j);
    if (i >= 0) Engine.joints.splice(i, 1);
    if (i >= 0) Engine._jointPairs.delete(Engine._pairKey(j.a, j.b));
    return i >= 0;
  };
  Engine.setBounds = function (bounds) { Engine.bounds = bounds || null; };
  Engine.stats = function () { return Object.assign({}, Engine._stats); };

  /* ---------- contact với sàn + tường (mặt phẳng tĩnh) ---------- */
  /* Điểm thấp nhất của body + độ xuyên: với box lấy TRUNG BÌNH các góc
   * thấp nhất (mặt đáy) thay vì 1 góc — 1 góc sẽ sinh torque làm hộp
   * nghiêng rồi kẹt ở vy≈-0.17 không ngủ được (từng đo). */
  function lowestPoint(b, out) {
    var s = b.shape;
    if (s.type === 'sphere') {
      out.copy(b.position); out.y -= s.radius;
      return { point: out, minY: out.y };
    }
    if (s.type === 'capsule') {
      var ep = capsuleEndpoints(b, new V3(), new V3());
      var lo = ep.a.y <= ep.b.y ? ep.a : ep.b;
      var hi = ep.a.y <= ep.b.y ? ep.b : ep.a;
      out.copy(lo); out.y -= s.radius;
      if (Math.abs(hi.y - lo.y) < 0.02) { /* nằm ngang: trung bình 2 đầu */
        out.x = (ep.a.x + ep.b.x) / 2; out.z = (ep.a.z + ep.b.z) / 2;
      }
      return { point: out, minY: out.y };
    }
    /* box: 8 góc */
    var h = s.half, minY = Infinity, corners = [];
    var q = b.quaternion;
    for (var i = 0; i < 8; i++) {
      var cx = (i & 1) ? h.x : -h.x, cy = (i & 2) ? h.y : -h.y, cz = (i & 4) ? h.z : -h.z;
      var c = new V3(cx, cy, cz).applyQuaternion(q).add(b.position);
      corners.push(c);
      if (c.y < minY) minY = c.y;
    }
    var n2 = 0;
    out.set(0, 0, 0);
    corners.forEach(function (c) {
      if (c.y <= minY + 0.02) { out.add(c); n2++; }
    });
    out.multiplyScalar(1 / Math.max(n2, 1));
    return { point: out, minY: minY };
  }
  function planeContacts(b, out) {
    if (b.isStatic) return;
    var n;
    if (Engine.floorEnabled) {
      var low = lowestPoint(b, new V3());
      var pen = Engine.floorY - low.minY;
      if (pen > -Engine._margin) { /* speculative: cách sàn < 4mm vẫn contact */
        out.push({ a: null, b: b, point: low.point.clone(), normal: new V3(0, 1, 0), pen: pen, isPlane: true });
      }
    }
    if (Engine.bounds) {
      var bd = Engine.bounds;
      var planes = [
        { n: new V3(1, 0, 0), d: bd.minX },   /* tường trái: x >= minX */
        { n: new V3(-1, 0, 0), d: -bd.maxX }, /* tường phải */
        { n: new V3(0, 0, 1), d: bd.minZ },
        { n: new V3(0, 0, -1), d: -bd.maxZ }
      ];
      planes.forEach(function (pl) {
        var sp = supportPoint(b, _t2.copy(pl.n).negate(), new V3());
        var dist = sp.dot(pl.n);
        var p2 = pl.d - dist;
        if (p2 > -Engine._margin) out.push({ a: null, b: b, point: sp.clone(), normal: pl.n.clone(), pen: p2, isPlane: true });
      });
    }
  }

  /* ---------- giải 1 contact (xung lực + ma sát) ---------- */
  function solveContactVelocity(c) {
    var b = c.b, a = c.a;
    var n = c.normal;
    /* vận tốc tại điểm tiếp xúc của B trừ A (A null = mặt phẳng tĩnh) */
    pointVelocity(b, c.point, _vb);
    var vRel = _vb;
    if (a) { pointVelocity(a, c.point, _va); vRel = _t3.copy(_vb).sub(_va); } else { vRel = _t3.copy(_vb); }
    var vn = vRel.dot(n);
    if (vn >= 0) return 0;
    /* va chạm mới đánh thức body đang ngủ — CHỈ khi va chạm thật
     * (vn < -0.05). Wake vô điều kiện ở đây từng phá sleep: contact
     * speculative của vật đang đứng yên cũng đánh thức nó dậy. */
    if (vn < -0.05) { if (a) wake(a); wake(b); }
    var e = a ? Math.max(a.restitution, b.restitution) : b.restitution;
    if (vn > -Engine._restitutionThreshold) e = 0; /* va chạm chậm → không nảy */
    /* KHÔNG dùng Baumgarte bias nữa (từng bơm năng lượng: body bị đè
     * với pen>0.01 nhận cú hất lên tới +1 m/s MỖI step → ragdoll giữ
     * động năng 6–18J mãi không lắng, wMax dính clamp 25 rad/s).
     * Xuyên được xử lý bằng hiệu chỉnh vị trí 0.6/step + contact
     * speculative — đủ cho stacking đứng yên (đã đo 4/4 ngủ). */
    var bias = 0;
    var rB = _t1.subVectors(c.point, b.position);
    var rnB = new V3().crossVectors(rB, n);
    var effB = b.invMass + applyInvInertia(b, rnB, new V3()).dot(rnB);
    var eff = effB;
    if (a) {
      var rA = _t2.subVectors(c.point, a.position);
      var rnA = new V3().crossVectors(rA, n);
      eff += a.invMass + applyInvInertia(a, rnA, new V3()).dot(rnA);
    }
    if (eff <= 1e-9) return 0;
    var targetVn = -e * vn + bias; /* vận tốc pháp tuyến mong muốn sau xung lực */
    var jn = (targetVn - vn) / eff;
    _imp.copy(n).multiplyScalar(jn);
    applyImpulse(b, _imp, c.point);
    if (a) applyImpulse(a, _imp.clone().negate(), c.point);
    /* ma sát Coulomb */
    pointVelocity(b, c.point, _vb);
    if (a) { pointVelocity(a, c.point, _va); _rv.copy(_vb).sub(_va); } else _rv.copy(_vb);
    var vt = _rv.clone().addScaledVector(n, -_rv.dot(n));
    var vtLen = vt.length();
    if (vtLen > 1e-6) {
      var tdir = vt.multiplyScalar(1 / vtLen);
      var effT = eff; /* xấp xỉ bằng eff pháp tuyến */
      var jt = clamp(-_rv.dot(tdir) / effT, -jn * Math.max(a ? a.friction : 0, b.friction), jn * Math.max(a ? a.friction : 0, b.friction));
      _imp.copy(tdir).multiplyScalar(jt);
      applyImpulse(b, _imp, c.point);
      if (a) applyImpulse(a, _imp.clone().negate(), c.point);
    }
    return jn;
  }
  function solveContactPosition(c) {
    var percent = 0.6, slop = 0.002;
    var corrMag = Math.max(c.pen - slop, 0) * percent;
    if (corrMag <= 0) return;
    var b = c.b, a = c.a;
    var invSum = b.invMass + (a ? a.invMass : 0);
    if (invSum <= 0) return;
    /* chỉ wake khi xuyên thật (> 1cm) — hiệu chỉnh margin 4mm của
     * contact speculative không được đánh thức body đang ngủ */
    if (c.pen > 0.01) { if (a) wake(a); wake(b); }
    if (a) {
      a.position.addScaledVector(c.normal, -corrMag * (a.invMass / invSum));
      updateAABB(a);
    }
    b.position.addScaledVector(c.normal, corrMag * (b.invMass / invSum));
    updateAABB(b);
  }
  Engine.stepFixed = function (dt) {
    Engine._dt = dt;
    var i, b;
    /* lực: trọng lực + lò xo được tính trong solveJointVelocity */
    Engine.bodies.forEach(function (bd) {
      if (bd.isStatic || bd.isKinematic || bd.sleeping) return;
      if (bd.useGravity) bd.velocity.addScaledVector(Engine.gravity, dt * bd.gravityScale);
      bd.velocity.multiplyScalar(Math.max(0, 1 - bd.linearDamping * dt));
      bd.angularVelocity.multiplyScalar(Math.max(0, 1 - bd.angularDamping * dt));
    });
    /* broadphase + narrowphase */
    Engine.bodies.forEach(updateAABB);
    var pairs = broadphasePairs(Engine.bodies);
    var contacts = [];
    Engine._stats.broadphasePairs = pairs.length;
    Engine._stats.narrowphaseTests = pairs.length;
    pairs.forEach(function (pr) {
      if (Engine._jointPairs.has(Engine._pairKey(pr[0], pr[1]))) return; /* nối joint → không va chạm */
      var c = collidePair(pr[0], pr[1]);
      if (c) contacts.push(c);
    });
    Engine.bodies.forEach(function (bd) { planeContacts(bd, contacts); });
    Engine._stats.contacts = contacts.length;
    /* solver lặp */
    for (var it = 0; it < Engine.iterations; it++) {
      Engine.joints.forEach(solveJointVelocity);
      contacts.forEach(solveContactVelocity);
    }
    Engine.joints.forEach(solveJointPosition);
    contacts.forEach(solveContactPosition);
    /* kẹp vận tốc (chống nổ solver khi joint kéo body nhẹ): */
    var maxW = Engine.maxAngularSpeed || 25, maxV = Engine.maxSpeed || 50;
    Engine.bodies.forEach(function (bd) {
      if (bd.isStatic) return;
      if (bd.angularVelocity.lengthSq() > maxW * maxW) bd.angularVelocity.setLength(maxW);
      if (bd.velocity.lengthSq() > maxV * maxV) bd.velocity.setLength(maxV);
    });
    /* tích phân vị trí */
    Engine.bodies.forEach(function (bd) {
      if (bd.isStatic || bd.isKinematic || bd.sleeping) return;
      bd.position.addScaledVector(bd.velocity, dt);
      var w = bd.angularVelocity;
      if (w.lengthSq() > 1e-12) {
        var half = w.clone().multiplyScalar(dt / 2);
        var dq = new QT(half.x, half.y, half.z, 0).multiply(bd.quaternion);
        bd.quaternion.set(
          bd.quaternion.x + dq.x, bd.quaternion.y + dq.y,
          bd.quaternion.z + dq.z, bd.quaternion.w + dq.w).normalize();
      }
      updateAABB(bd);
    });
    /* ngủ / thức */
    Engine.bodies.forEach(function (bd) {
      if (bd.isStatic || bd.isKinematic) return;
      var sp = bd.velocity.lengthSq() + bd.angularVelocity.lengthSq();
      if (sp < 0.0064) { /* |v| < ~0.08 */
        bd._sleepTime += dt;
        if (bd._sleepTime > 0.6) {
          bd.sleeping = true;
          bd.velocity.set(0, 0, 0); bd.angularVelocity.set(0, 0, 0);
        }
      } else bd._sleepTime = 0;
    });
    /* KẸP SÀN (safety net, mặc định BẬT): joint có thể kéo body xuống
     * dưới sàn (từng đo ngón chân chìm 8cm sau khi lắng: neo khớp nằm
     * dưới sàn, joint thắng contact mỗi step). Contacts vẫn làm vật lý
     * chính; kẹp chỉ đảm bảo cuối step không body nào nằm dưới sàn.
     * CHỈ zero vận tốc khi chìm CHẬM (|vy|<1, kiểu joint kéo): va chạm
     * nhanh mà zero vy sẽ ăn mất cú nảy (từng làm bóng rơi 7 m/s dừng
     * chết trên sàn thay vì nảy 0.8) — va chạm nhanh chỉ nâng vị trí,
     * solver nảy ở step sau. */
    if (Engine.floorEnabled && Engine.floorClamp !== false) {
      Engine.bodies.forEach(function (bd) {
        if (bd.isStatic || bd.isKinematic) return;
        var low = lowestPoint(bd, new V3());
        if (low.minY < Engine.floorY) {
          bd.position.y += (Engine.floorY - low.minY);
          if (bd.velocity.y < 0 && bd.velocity.y > -1.0) bd.velocity.y = 0;
          updateAABB(bd);
        }
      });
    }
    /* đồng bộ ra Object3D */
    Engine.bodies.forEach(function (bd) {
      if (bd.object3D) {
        bd.object3D.position.copy(bd.position);
        bd.object3D.quaternion.copy(bd.quaternion);
      }
    });
    Engine._stats.steps++;
  };

  /* ---------- step(dt) với accumulator (gọi từ render loop) ---------- */
  Engine.step = function (dt) {
    if (!Engine.simulating) return;
    dt = Math.min(dt || 0, 0.1);
    Engine._acc += dt;
    var n = 0;
    while (Engine._acc >= Engine.fixedDt && n < 8) {
      Engine.stepFixed(Engine.fixedDt);
      Engine._acc -= Engine.fixedDt;
      n++;
    }
    if (n === 8) Engine._acc = 0; /* tránh xoắn ốc khi tab lag */
  };
  Engine.start = function () { Engine.simulating = true; };
  Engine.stop = function (restore) {
    Engine.simulating = false;
    if (restore) Engine.bodies.forEach(function (b) {
      if (b._restPos) { b.position.copy(b._restPos); b.quaternion.copy(b._restQuat); b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0); b.sleeping = false; if (b.object3D) { b.object3D.position.copy(b.position); b.object3D.quaternion.copy(b.quaternion); } }
    });
  };

  /* ---------- RAYCAST ---------- */
  function raySphere(o, d, c, r) {
    _t1.subVectors(c, o);
    var tca = _t1.dot(d);
    if (tca < 0) return -1;
    var d2 = _t1.lengthSq() - tca * tca;
    if (d2 > r * r) return -1;
    return tca - Math.sqrt(r * r - d2);
  }
  Engine.raycast = function (origin, dir, maxDist) {
    maxDist = maxDist || 100;
    var d = dir.clone().normalize();
    var hits = [];
    if (Engine.floorEnabled) {
      if (d.y < -1e-6) {
        var t = (Engine.floorY - origin.y) / d.y;
        if (t >= 0 && t <= maxDist) hits.push({ body: null, point: origin.clone().addScaledVector(d, t), normal: new V3(0, 1, 0), distance: t, what: 'floor' });
      }
    }
    Engine.bodies.forEach(function (b) {
      var tHit = -1, normal = null;
      if (b.shape.type === 'sphere') {
        tHit = raySphere(origin, d, b.position, b.shape.radius);
        if (tHit >= 0) normal = origin.clone().addScaledVector(d, tHit).sub(b.position).normalize();
      } else if (b.shape.type === 'box') {
        /* slab test trong local space */
        var inv = b.quaternion.clone().invert();
        var lo = origin.clone().sub(b.position).applyQuaternion(inv);
        var ld = d.clone().applyQuaternion(inv);
        var h = b.shape.half, tmin = 0, tmax = maxDist, axis = -1;
        var ok = true;
        [['x', 0], ['y', 1], ['z', 2]].forEach(function (ax) {
          var o = lo[ax[0]], dd = ld[ax[0]], hh = h[ax[0]];
          if (Math.abs(dd) < 1e-9) { if (Math.abs(o) > hh) ok = false; return; }
          var t1 = (-hh - o) / dd, t2 = (hh - o) / dd;
          if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
          if (t1 > tmin) { tmin = t1; axis = ax[1]; }
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) ok = false;
        });
        if (ok && tmin >= 0 && tmin <= maxDist) {
          tHit = tmin;
          normal = new V3(); normal.setComponent(axis, ld.getComponent(axis) > 0 ? -1 : 1);
          normal.applyQuaternion(b.quaternion);
        }
      } else if (b.shape.type === 'capsule') {
        var ep = capsuleEndpoints(b, new V3(), new V3());
        /* xấp xỉ: 2 đầu cầu + thân trụ → thử 2 sphere đầu + khoảng cách đoạn */
        var tA = raySphere(origin, d, ep.a, b.shape.radius);
        var tB = raySphere(origin, d, ep.b, b.shape.radius);
        tHit = -1;
        if (tA >= 0) tHit = tA;
        if (tB >= 0 && (tHit < 0 || tB < tHit)) tHit = tB;
        if (tHit >= 0) {
          var p = origin.clone().addScaledVector(d, tHit);
          var near = p.distanceTo(ep.a) < p.distanceTo(ep.b) ? ep.a : ep.b;
          normal = p.clone().sub(near).normalize();
        }
      }
      if (tHit >= 0 && tHit <= maxDist) {
        hits.push({ body: b, point: origin.clone().addScaledVector(d, tHit), normal: normal || new V3(0, 1, 0), distance: tHit, what: 'body' });
      }
    });
    hits.sort(function (x, y) { return x.distance - y.distance; });
    return hits;
  };
  Engine.raycastDown = function (origin, maxDist) {
    return Engine.raycast(origin, new V3(0, -1, 0), maxDist || 100);
  };

  /* ---------- tiện ích ---------- */
  Engine.bodyCount = function () { return Engine.bodies.length; };
  Engine.dynamicCount = function () { return Engine.bodies.filter(function (b) { return !b.isStatic; }).length; };
  Engine.listBodies = function () {
    return Engine.bodies.map(function (b) {
      return { id: b.id, label: b.label, shape: b.shape.type, mass: b.mass, restitution: b.restitution, friction: b.friction, isStatic: b.isStatic, sleeping: b.sleeping, pos: [b.position.x, b.position.y, b.position.z] };
    });
  };
  Engine.wakeAll = function () { Engine.bodies.forEach(function (b) { b.sleeping = false; b._sleepTime = 0; }); };

  /* test hooks */
  Engine._test = {
    collidePair: collidePair,
    broadphasePairs: broadphasePairs,
    supportPoint: supportPoint,
    updateAABB: updateAABB,
    makeBody: makeBody
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.PhysicsEngine = Engine;
})();
