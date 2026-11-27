/* ============================================================
 * rig/arp-qr3-advik.js — IK NÂNG CAO cho Quick Rig (Auto Rig Pro
 * Blend, PHẦN 3 — vòng mở rộng thứ 3 của Quick Rig)
 *
 * Mở rộng solver 2-bone CÓ SẴN của ArpQuickRig (solveTwoBoneIK /
 * computeTwoBoneAngles) — KHÔNG viết lại solver, KHÔNG sửa
 * arp-quickrig.js. Module này chỉ ĐỌC QuickRig.current và gọi lại
 * các hàm public của nó.
 *
 *   1. Foot lock / planting — khóa bàn chân tại 1 vị trí world,
 *      hông di chuyển thì giải lại IK chân để chân đứng yên.
 *   2. Full-body IK — moveHips(deltaWorld): dịch Hips, chân khóa
 *      giữ nguyên vị trí, chân không khóa đi theo hông.
 *   3. Stretchy IK — target ngoài tầm với (L1+L2) thì scale độ
 *      dài 2 xương (tối đa maxStretch, mặc định 1.3), có khôi phục
 *      khi target về lại trong tầm.
 *   4. Blend IK/FK 0–100% từng chi — slerp quaternion từng khớp
 *      giữa tư thế FK hiện tại và nghiệm IK.
 *   5. Auto-place pole — tính lại vị trí pole từ tư thế hiện tại
 *      (bendDir = khớp giữa − trung điểm root/end; khuỷu ra sau,
 *      gối ra trước).
 *   6. UI — renderSection(container): toggle foot lock, di chuyển
 *      hông, toggle stretchy + maxStretch, slider blend từng chi,
 *      nút auto-place pole từng chi.
 *
 * State lưu trên QuickRig.current.advik (tạo lười khi cần):
 *   { footLock: {Left:{on,pos}, Right:{on,pos}},
 *     stretchy: false, maxStretch: 1.3,
 *     blends: {LeftArm:1, RightArm:1, LeftLeg:1, RightLeg:1},
 *     stretchState: {limbKey:{stretch, origMidPos, origEndPos}} }
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Vẫn là IK 2-bone (vai-khuỷu-tay, hông-gối-chân) — không phải
 *     full-body IK thật kiểu FABRIK/CCD nhiều khớp: chỉ có Hips
 *     dịch chuyển + 2 chân giải lại; spine/tay không tự bù theo.
 *   • Foot lock chỉ được "giữ" khi moveHips() (hoặc solveLimbIK
 *     tay) chạy — kéo control hông bằng tay ngoài module này thì
 *     chân khóa không tự giữ (studio phải gọi moveHips / tick).
 *   • Stretchy IK scale vị trí local của xương mid/end nên mesh
 *     skin cũng duỗi theo — đúng bản chất stretchy IK, nhưng cần
 *     restoreStretch (tự động khi target về trong tầm) để không
 *     để skeleton bị duỗi vĩnh viễn.
 *   • Blend IK/FK lấy tư thế FK = tư thế xương TẠI LÚC GỌI: muốn
 *     so t=0 / t=0.5 / t=1 trên cùng 1 tư thế FK thì khôi phục lại
 *     tư thế FK đó trước mỗi lần gọi (harness làm vậy).
 *   • Pole auto-place ép dấu Z theo quy ước nhân vật mặt +Z
 *     (khuỷu sau −Z, gối trước +Z) — đúng với skeleton AutoRigPro /
 *     Mixamo; skeleton mặt hướng khác thì dấu Z không còn ý nghĩa.
 * ============================================================ */
(function () {
  'use strict';

  var QR = (window.PixiStudio && PixiStudio.ArpQuickRig) || null;
  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };

  function notify(type, title, message, duration) {
    try { bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 }); } catch (e) {}
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function toVec3(p) {
    var T = window.THREE;
    if (!p) return null;
    if (p.isVector3) return p.clone();
    return new T.Vector3(p.x || 0, p.y || 0, p.z || 0);
  }
  function vecToArr(v) { return v ? [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)] : null; }
  function worldPosOf(obj) {
    return new window.THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
  }
  function normSide(side) {
    side = String(side || '').toLowerCase();
    if (side === 'right' || side === 'r') return 'Right';
    return 'Left';
  }
  function normLimb(limbKey) {
    if (!limbKey) return null;
    var k = String(limbKey);
    if (QR && QR.LIMBS && QR.LIMBS[k]) return k;
    /* chấp nhận 'Left'/'Right' + 'Arm'/'Leg' viết tắt */
    var map = { LeftArm: 'LeftArm', RightArm: 'RightArm', LeftLeg: 'LeftLeg', RightLeg: 'RightLeg',
      leftarm: 'LeftArm', rightarm: 'RightArm', leftleg: 'LeftLeg', rightleg: 'RightLeg' };
    return map[k] || map[k.toLowerCase()] || null;
  }

  function getCur() {
    if (!QR) return { ok: false, error: 'ArpQuickRig chưa load — load js/rig/arp-quickrig.js trước arp-qr3-advik.js.' };
    var cur = QR.current;
    if (!cur) return { ok: false, error: 'Chưa có control rig — convert/auto-gen một model đã rig trước.' };
    return { ok: true, cur: cur };
  }

  /* Tạo state AdvIK trên rig hiện tại (lười, giữ nguyên nếu đã có). */
  function ensureAdvIK(cur) {
    if (!cur.advik) {
      cur.advik = {
        footLock: { Left: { on: false, pos: null }, Right: { on: false, pos: null } },
        stretchy: false,
        maxStretch: 1.3,
        blends: { LeftArm: 1, RightArm: 1, LeftLeg: 1, RightLeg: 1 },
        stretchState: {}
      };
    } else {
      cur.advik.footLock = cur.advik.footLock || { Left: { on: false, pos: null }, Right: { on: false, pos: null } };
      cur.advik.blends = cur.advik.blends || { LeftArm: 1, RightArm: 1, LeftLeg: 1, RightLeg: 1 };
      cur.advik.stretchState = cur.advik.stretchState || {};
      if (typeof cur.advik.maxStretch !== 'number') cur.advik.maxStretch = 1.3;
      if (typeof cur.advik.stretchy !== 'boolean') cur.advik.stretchy = false;
    }
    return cur.advik;
  }

  /* Áp delta quaternion world → bone local. Bản sao logic của
     QuickRig.updateLimb (hàm đó là private nên module này tự có
     một bản giống hệt, chỉ dùng để ÁP nghiệm của solveTwoBoneIK). */
  function applyWorldDelta(bone, worldDelta) {
    if (!bone) return;
    if (!bone.parent) { bone.quaternion.premultiply(worldDelta); return; }
    var parentWorldQ = new window.THREE.Quaternion();
    try { bone.parent.getWorldQuaternion(parentWorldQ); } catch (e) { parentWorldQ.identity(); }
    var localDelta = parentWorldQ.clone().invert().multiply(worldDelta).multiply(parentWorldQ);
    bone.quaternion.premultiply(localDelta);
  }

  /* Giải IK 1 chi về target world rồi áp lên xương (root rồi mid,
     đúng thứ tự như QuickRig.updateLimb). Trả về nghiệm thô của
     solveTwoBoneIK — KHÔNG đụng tới stretch, blend hay foot lock. */
  function applyIKSolution(cur, limbKey, targetPos, polePos) {
    var def = QR.LIMBS[limbKey];
    var rootBone = cur.bones[def.root], midBone = cur.bones[def.mid], endBone = cur.bones[def.end];
    if (!rootBone || !midBone || !endBone) return { ok: false, error: 'Thiếu xương cho ' + limbKey };
    cur.target.updateMatrixWorld(true);
    var sol = QR.solveTwoBoneIK(worldPosOf(rootBone), worldPosOf(midBone), worldPosOf(endBone),
      targetPos, polePos || null);
    applyWorldDelta(rootBone, sol.rootQuaternion);
    cur.target.updateMatrixWorld(true);
    applyWorldDelta(midBone, sol.midQuaternion);
    cur.target.updateMatrixWorld(true);
    return { ok: true, solution: sol };
  }

  function syncEndControl(cur, limbKey, worldPos) {
    var def = QR.LIMBS[limbKey];
    var ctrl = cur.controls && cur.controls[def.end];
    if (!ctrl) return;
    try { ctrl.position.copy(cur.controlGroup.worldToLocal(worldPos.clone())); } catch (e) {}
  }

  /* ============================================================
     3. STRETCHY IK — pure function (chỉ số, không cần THREE)
     ============================================================ */
  function computeStretchy(a, b, d, maxStretch) {
    a = Math.max(1e-6, Number(a) || 0);
    b = Math.max(1e-6, Number(b) || 0);
    d = Math.max(0, Number(d) || 0);
    maxStretch = maxStretch === undefined || maxStretch === null ? 1.3 : Number(maxStretch);
    if (!(maxStretch >= 1)) maxStretch = 1.3;
    var reach = a + b;
    if (d <= reach) {
      return { stretch: 1, clampedDistance: d, reach: reach, maxReach: reach * maxStretch,
        maxStretch: maxStretch, reached: true, inRange: true };
    }
    var stretch = Math.min(d / reach, maxStretch);
    return { stretch: stretch, clampedDistance: Math.min(d, reach * maxStretch),
      reach: reach, maxReach: reach * maxStretch, maxStretch: maxStretch,
      reached: d <= reach * maxStretch, inRange: false };
  }

  /* Khôi phục độ dài xương gốc sau khi đã stretch (nếu có). */
  function restoreStretch(cur, limbKey) {
    var adv = ensureAdvIK(cur);
    var st = adv.stretchState[limbKey];
    if (!st) return { ok: true, restored: false };
    var def = QR.LIMBS[limbKey];
    var midBone = cur.bones[def.mid], endBone = cur.bones[def.end];
    if (midBone && st.origMidPos) midBone.position.copy(st.origMidPos);
    if (endBone && st.origEndPos) endBone.position.copy(st.origEndPos);
    delete adv.stretchState[limbKey];
    cur.target.updateMatrixWorld(true);
    return { ok: true, restored: true, prevStretch: st.stretch };
  }

  function setStretchy(on, maxStretch) {
    var g = getCur();
    if (!g.ok) return g;
    var adv = ensureAdvIK(g.cur);
    adv.stretchy = !!on;
    if (maxStretch !== undefined && maxStretch !== null) {
      adv.maxStretch = clamp(Number(maxStretch) || 1.3, 1, 2);
    }
    if (!adv.stretchy) {
      /* tắt stretchy → trả mọi chi đã duỗi về độ dài gốc */
      Object.keys(QR.LIMBS).forEach(function (k) { restoreStretch(g.cur, k); });
    }
    try { bus.emit('arpquickrig:advik-stretchy', { on: adv.stretchy, maxStretch: adv.maxStretch }); } catch (e) {}
    return { ok: true, stretchy: adv.stretchy, maxStretch: adv.maxStretch };
  }
  function getStretchy() {
    var g = getCur();
    if (!g.ok) return { ok: false, error: g.error, stretchy: false, maxStretch: 1.3 };
    var adv = ensureAdvIK(g.cur);
    return { ok: true, stretchy: adv.stretchy, maxStretch: adv.maxStretch };
  }

  /* ============================================================
     solveLimbIK — giải IK 1 chi về target, có stretchy.
     opts: {stretchy?:bool (mặc định theo state), maxStretch?:number}
     ============================================================ */
  function solveLimbIK(limbKey, targetPos, polePos, opts) {
    var g = getCur();
    if (!g.ok) return g;
    limbKey = normLimb(limbKey);
    if (!limbKey) return { ok: false, error: 'Chi không hợp lệ: ' + limbKey };
    opts = opts || {};
    var cur = g.cur;
    var adv = ensureAdvIK(cur);
    var def = QR.LIMBS[limbKey];
    var rootBone = cur.bones[def.root], midBone = cur.bones[def.mid], endBone = cur.bones[def.end];
    if (!rootBone || !midBone || !endBone) return { ok: false, error: 'Thiếu xương cho ' + limbKey };
    var target = toVec3(targetPos);
    if (!target) return { ok: false, error: 'solveLimbIK cần targetPos (Vector3 hoặc {x,y,z}).' };
    var pole = polePos ? toVec3(polePos) : null;
    if (!pole && cur.poles && cur.poles[limbKey]) {
      try { pole = worldPosOf(cur.poles[limbKey]); } catch (e) { pole = null; }
    }
    var useStretchy = opts.stretchy !== undefined ? !!opts.stretchy : adv.stretchy;
    var maxStretch = opts.maxStretch !== undefined ? clamp(Number(opts.maxStretch) || 1.3, 1, 2) : adv.maxStretch;

    /* trả chi về độ dài gốc trước rồi mới đo lại — tránh cộng dồn */
    restoreStretch(cur, limbKey);
    cur.target.updateMatrixWorld(true);
    var a = worldPosOf(rootBone).distanceTo(worldPosOf(midBone));
    var b = worldPosOf(midBone).distanceTo(worldPosOf(endBone));
    var d = worldPosOf(rootBone).distanceTo(target);
    var st = computeStretchy(a, b, d, maxStretch);
    var stretchApplied = 1;
    if (useStretchy && st.stretch > 1) {
      /* scale độ dài 2 xương: mid.position (root→mid) và
         end.position (mid→end) cùng nhân stretch — hướng giữ nguyên */
      adv.stretchState[limbKey] = {
        stretch: st.stretch,
        origMidPos: midBone.position.clone(),
        origEndPos: endBone.position.clone()
      };
      midBone.position.multiplyScalar(st.stretch);
      endBone.position.multiplyScalar(st.stretch);
      stretchApplied = st.stretch;
      cur.target.updateMatrixWorld(true);
    }
    var applied = applyIKSolution(cur, limbKey, target, pole);
    if (!applied.ok) {
      restoreStretch(cur, limbKey);
      return applied;
    }
    syncEndControl(cur, limbKey, target);
    cur.target.updateMatrixWorld(true);
    var endW = worldPosOf(endBone);
    var err = endW.distanceTo(target);
    var res = {
      ok: true, limb: limbKey, stretch: stretchApplied,
      clampedDistance: st.clampedDistance, distance: d,
      upperLength: a, foreLength: b, maxStretch: maxStretch,
      reached: err < 0.02, endError: +err.toFixed(4),
      endPosition: vecToArr(endW), target: vecToArr(target),
      solution: applied.solution
    };
    try { bus.emit('arpquickrig:advik-solve', { limb: limbKey, stretch: stretchApplied, reached: res.reached }); } catch (e) {}
    return res;
  }

  /* ============================================================
     1. FOOT LOCK / PLANTING
     ============================================================ */
  function setFootLock(side, on) {
    var g = getCur();
    if (!g.ok) return g;
    side = normSide(side);
    var cur = g.cur;
    var adv = ensureAdvIK(cur);
    var limbKey = side + 'Leg';
    var def = QR.LIMBS[limbKey];
    var footBone = cur.bones[def.end];
    if (!footBone) return { ok: false, error: 'Không có xương bàn chân ' + side + '.' };
    on = !!on;
    if (on) {
      cur.target.updateMatrixWorld(true);
      var pos = worldPosOf(footBone);
      adv.footLock[side] = { on: true, pos: pos.clone() };
      syncEndControl(cur, limbKey, pos);
      try { bus.emit('arpquickrig:advik-footlock', { side: side, on: true, pos: vecToArr(pos) }); } catch (e) {}
      return { ok: true, side: side, on: true, position: vecToArr(pos) };
    }
    adv.footLock[side] = { on: false, pos: null };
    try { bus.emit('arpquickrig:advik-footlock', { side: side, on: false }); } catch (e) {}
    return { ok: true, side: side, on: false, position: null };
  }
  function getFootLock(side) {
    var g = getCur();
    if (!g.ok) return { ok: false, error: g.error, side: normSide(side), on: false, position: null };
    side = normSide(side);
    var adv = ensureAdvIK(g.cur);
    var lk = adv.footLock[side] || { on: false, pos: null };
    return { ok: true, side: side, on: !!lk.on, position: lk.pos ? vecToArr(lk.pos) : null };
  }
  function lockedFootPos(side) {
    var g = getCur();
    if (!g.ok) return null;
    side = normSide(side);
    var adv = ensureAdvIK(g.cur);
    var lk = adv.footLock[side];
    return lk && lk.on && lk.pos ? lk.pos.clone() : null;
  }

  /* ============================================================
     2. FULL-BODY IK — moveHips(deltaWorld)
     Dịch Hips theo delta world; chân khóa giữ nguyên vị trí world
     (giải lại IK chân về vị trí đã khóa), chân không khóa đi theo.
     ============================================================ */
  function moveHips(deltaWorld) {
    var g = getCur();
    if (!g.ok) return g;
    var cur = g.cur;
    var adv = ensureAdvIK(cur);
    var delta = toVec3(deltaWorld);
    if (!delta) return { ok: false, error: 'moveHips cần delta {x,y,z} (world).' };
    var hips = cur.bones.Hips;
    if (!hips) return { ok: false, error: 'Không có xương Hips.' };
    cur.target.updateMatrixWorld(true);
    var hipsBefore = worldPosOf(hips);
    /* dịch Hips theo world: đổi delta world → vị trí local mới qua cha */
    var newWorld = hipsBefore.clone().add(delta);
    if (hips.parent) {
      try { hips.position.copy(hips.parent.worldToLocal(newWorld.clone())); }
      catch (e) { hips.position.add(delta); }
    } else {
      hips.position.add(delta);
    }
    cur.target.updateMatrixWorld(true);
    var hipsAfter = worldPosOf(hips);
    /* chân khóa: giải lại IK về vị trí đã khóa; chân không khóa: đi
       theo hông (xương con của Hips tự di chuyển), chỉ đồng bộ control */
    var feet = {};
    ['Left', 'Right'].forEach(function (side) {
      var limbKey = side + 'Leg';
      var def = QR.LIMBS[limbKey];
      var lk = adv.footLock[side];
      if (lk && lk.on && lk.pos) {
        var pole = null;
        if (cur.poles && cur.poles[limbKey]) {
          try { pole = worldPosOf(cur.poles[limbKey]); } catch (e) {}
        }
        var r = applyIKSolution(cur, limbKey, lk.pos, pole);
        syncEndControl(cur, limbKey, lk.pos);
        cur.target.updateMatrixWorld(true);
        var footW = worldPosOf(cur.bones[def.end]);
        feet[side] = { locked: true, position: vecToArr(footW),
          error: +footW.distanceTo(lk.pos).toFixed(4), solved: !!(r && r.ok) };
      } else {
        cur.target.updateMatrixWorld(true);
        var fw = worldPosOf(cur.bones[def.end]);
        syncEndControl(cur, limbKey, fw);
        feet[side] = { locked: false, position: vecToArr(fw), error: 0, solved: false };
      }
    });
    cur.target.updateMatrixWorld(true);
    var res = {
      ok: true,
      hipsBefore: vecToArr(hipsBefore), hipsAfter: vecToArr(hipsAfter),
      hipsMoved: vecToArr(hipsAfter.clone().sub(hipsBefore)),
      delta: vecToArr(delta), feet: feet
    };
    try { bus.emit('arpquickrig:advik-movehips', res); } catch (e) {}
    return res;
  }

  /* ============================================================
     4. BLEND IK/FK 0–100% từng chi
     Tư thế FK = quaternion local hiện tại của root+mid; nghiệm IK =
     quaternion local sau khi áp solveTwoBoneIK. Slerp từng khớp.
     ============================================================ */
  function blendIKFK(limbKey, t) {
    var g = getCur();
    if (!g.ok) return g;
    limbKey = normLimb(limbKey);
    if (!limbKey) return { ok: false, error: 'Chi không hợp lệ: ' + limbKey };
    t = clamp(Number(t) || 0, 0, 1);
    var cur = g.cur;
    var adv = ensureAdvIK(cur);
    var def = QR.LIMBS[limbKey];
    var rootBone = cur.bones[def.root], midBone = cur.bones[def.mid], endBone = cur.bones[def.end];
    if (!rootBone || !midBone || !endBone) return { ok: false, error: 'Thiếu xương cho ' + limbKey };
    cur.target.updateMatrixWorld(true);
    /* (a) tư thế FK hiện tại */
    var fkRootQ = rootBone.quaternion.clone();
    var fkMidQ = midBone.quaternion.clone();
    /* target IK = vị trí control cuối chi (mặc định ở đúng bàn tay/
       bàn chân sau matchToSource; user kéo control ra xa để blend
       thấy rõ). Nếu không có control thì lấy vị trí xương cuối. */
    var targetW = null;
    if (cur.controls && cur.controls[def.end]) {
      try { targetW = worldPosOf(cur.controls[def.end]); } catch (e) { targetW = null; }
    }
    if (!targetW) targetW = worldPosOf(endBone);
    var pole = null;
    if (cur.poles && cur.poles[limbKey]) {
      try { pole = worldPosOf(cur.poles[limbKey]); } catch (e) {}
    }
    /* (b) nghiệm IK: áp lên xương rồi chụp lại quaternion local */
    var applied = applyIKSolution(cur, limbKey, targetW, pole);
    if (!applied.ok) return applied;
    var ikRootQ = rootBone.quaternion.clone();
    var ikMidQ = midBone.quaternion.clone();
    /* (c) nội suy: FK → IK theo t rồi đặt lại lên xương */
    rootBone.quaternion.copy(fkRootQ.clone().slerp(ikRootQ, t));
    midBone.quaternion.copy(fkMidQ.clone().slerp(ikMidQ, t));
    cur.target.updateMatrixWorld(true);
    adv.blends[limbKey] = t;
    var endW = worldPosOf(endBone);
    var res = {
      ok: true, limb: limbKey, t: t,
      fkRoot: [fkRootQ.x, fkRootQ.y, fkRootQ.z, fkRootQ.w],
      ikRoot: [ikRootQ.x, ikRootQ.y, ikRootQ.z, ikRootQ.w],
      endPosition: vecToArr(endW), target: vecToArr(targetW),
      endError: +endW.distanceTo(targetW).toFixed(4)
    };
    try { bus.emit('arpquickrig:advik-blend', { limb: limbKey, t: t }); } catch (e) {}
    return res;
  }
  function getBlend(limbKey) {
    var g = getCur();
    if (!g.ok) return { ok: false, error: g.error, limb: limbKey, t: 1 };
    limbKey = normLimb(limbKey);
    if (!limbKey) return { ok: false, error: 'Chi không hợp lệ: ' + limbKey, t: 1 };
    var adv = ensureAdvIK(g.cur);
    return { ok: true, limb: limbKey, t: adv.blends[limbKey] === undefined ? 1 : adv.blends[limbKey] };
  }

  /* ============================================================
     5. AUTO-PLACE POLE — vị trí pole hợp lý theo tư thế hiện tại
     ============================================================ */
  function autoPlacePole(limbKey) {
    var g = getCur();
    if (!g.ok) return g;
    limbKey = normLimb(limbKey);
    if (!limbKey) return { ok: false, error: 'Chi không hợp lệ: ' + limbKey };
    var cur = g.cur;
    var def = QR.LIMBS[limbKey];
    var rootBone = cur.bones[def.root], midBone = cur.bones[def.mid], endBone = cur.bones[def.end];
    if (!rootBone || !midBone || !endBone) return { ok: false, error: 'Thiếu xương cho ' + limbKey };
    if (!cur.poles || !cur.poles[limbKey]) {
      return { ok: false, error: 'Chi ' + limbKey + ' không có pole target — convert lại ở mức Đầy đủ (có pole).' };
    }
    cur.target.updateMatrixWorld(true);
    var rootW = worldPosOf(rootBone), midW = worldPosOf(midBone), endW = worldPosOf(endBone);
    var midPoint = rootW.clone().add(endW).multiplyScalar(0.5);
    var bendDir = midW.clone().sub(midPoint);
    var limbLen = rootW.distanceTo(endW);
    if (bendDir.lengthSq() < Math.pow(Math.max(0.005, limbLen * 0.02), 2)) {
      /* chi gần như thẳng: không đo được hướng gập → dùng hướng mặc
         định theo quy ước mặt +Z (khuỷu sau −Z, gối trước +Z) */
      bendDir = new window.THREE.Vector3(0, 0, def.kind === 'arm' ? -1 : 1);
    } else {
      bendDir.normalize();
      /* ép dấu Z theo quy ước: khuỷu luôn ra sau, gối luôn ra trước
         (giữ lại thành phần X/Y theo tư thế thật, chỉ lật dấu Z) */
      if (def.kind === 'arm' && bendDir.z > 0) bendDir.z = -bendDir.z;
      if (def.kind === 'leg' && bendDir.z < 0) bendDir.z = -bendDir.z;
      if (bendDir.lengthSq() < 1e-8) bendDir = new window.THREE.Vector3(0, 0, def.kind === 'arm' ? -1 : 1);
      bendDir.normalize();
    }
    var dist = Math.max(0.08, (cur.height || 1.8) * 0.12);
    var polePos = midW.clone().add(bendDir.clone().multiplyScalar(dist));
    try { cur.poles[limbKey].position.copy(cur.controlGroup.worldToLocal(polePos.clone())); } catch (e) {}
    cur.target.updateMatrixWorld(true);
    /* giải lại IK với pole mới nếu chi đang ở chế độ IK */
    if (cur.limbModes && cur.limbModes[limbKey] === 'IK' && QR.updateLimb) {
      try { QR.updateLimb(limbKey); } catch (e) {}
    }
    var res = { ok: true, limb: limbKey, kind: def.kind,
      polePosition: vecToArr(polePos), bendDir: vecToArr(bendDir),
      midPosition: vecToArr(midW), distance: +dist.toFixed(3) };
    try { bus.emit('arpquickrig:advik-pole', res); } catch (e) {}
    return res;
  }

  /* ============================================================
     6. UI — renderSection(container)
     DOM thuần + inline style, không sửa CSS, không phụ thuộc
     PixiStudio.Utils.el. Chạy được cả khi chưa có control rig
     (hiện ghi chú, nút bấm báo lỗi rõ ràng).
     ============================================================ */
  function mkEl(tag, text, style) {
    var n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    if (style) {
      Object.keys(style).forEach(function (k) { n.style[k] = style[k]; });
    }
    return n;
  }
  function mkRow() {
    return mkEl('div', null, { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0', flexWrap: 'wrap' });
  }
  function mkButton(text, onclick) {
    var b = mkEl('button', text, { padding: '4px 8px', cursor: 'pointer' });
    b.className = 'btn sm';
    b.addEventListener('click', onclick);
    return b;
  }

  function renderSection(container) {
    if (!container) return;
    container.innerHTML = '';
    var wrap = mkEl('div', null, { border: '1px solid #7a5fd0', borderRadius: '6px', padding: '8px', margin: '6px 0' });
    wrap.appendChild(mkEl('div', '🦿 IK nâng cao — foot lock · full-body IK (hông) · stretchy IK · blend IK/FK · auto pole',
      { fontWeight: 'bold', marginBottom: '4px' }));
    wrap.appendChild(mkEl('div',
      'Mở rộng solver 2-bone có sẵn của Quick Rig. Foot lock chỉ giữ chân khi hông di chuyển bằng nút bên dưới (moveHips).',
      { fontSize: '12px', color: '#555', marginBottom: '6px' }));
    var status = mkEl('div', 'Chưa có control rig — convert/auto-gen một model đã rig trước.',
      { fontSize: '12px', margin: '4px 0', minHeight: '16px' });
    var setStatus = function (msg) { status.textContent = msg; };
    var needRig = function () {
      var g = getCur();
      if (!g.ok) { setStatus(g.error); notify('warning', 'IK nâng cao', g.error); return null; }
      return g.cur;
    };

    /* --- 1. Foot lock --- */
    wrap.appendChild(mkEl('div', '1. Foot lock (khóa bàn chân)', { fontWeight: 'bold', marginTop: '6px' }));
    ['Left', 'Right'].forEach(function (side) {
      var row = mkRow();
      row.appendChild(mkEl('span', side === 'Left' ? 'Chân trái:' : 'Chân phải:', { width: '90px' }));
      var btn = mkButton('🔒 Khóa', function () {
        var cur = needRig(); if (!cur) return;
        var adv = ensureAdvIK(cur);
        var isOn = adv.footLock[side] && adv.footLock[side].on;
        var r = setFootLock(side, !isOn);
        if (r.ok) {
          btn.textContent = r.on ? '🔓 Mở khóa' : '🔒 Khóa';
          setStatus(r.on ? 'Đã khóa chân ' + (side === 'Left' ? 'trái' : 'phải') + ' tại ' + JSON.stringify(r.position) + ' — hông di chuyển chân vẫn đứng yên.'
            : 'Đã mở khóa chân ' + (side === 'Left' ? 'trái' : 'phải') + '.');
        } else setStatus(r.error);
      });
      btn.setAttribute('data-advik-footlock', side);
      var cur0 = QR && QR.current;
      if (cur0 && cur0.advik && cur0.advik.footLock[side] && cur0.advik.footLock[side].on) btn.textContent = '🔓 Mở khóa';
      row.appendChild(btn);
      row.appendChild(mkEl('span', 'Khóa vị trí world hiện tại của bàn chân; moveHips sẽ giải lại IK để giữ nguyên.',
        { fontSize: '12px', color: '#555' }));
      wrap.appendChild(row);
    });

    /* --- 2. Di chuyển hông (full-body IK) --- */
    wrap.appendChild(mkEl('div', '2. Full-body IK — di chuyển hông', { fontWeight: 'bold', marginTop: '8px' }));
    var hipRow = mkRow();
    hipRow.appendChild(mkEl('span', 'Bước (m):', { width: '90px' }));
    var stepInput = mkEl('input', null, { width: '70px' });
    stepInput.type = 'number'; stepInput.min = '0.01'; stepInput.max = '0.5'; stepInput.step = '0.01'; stepInput.value = '0.05';
    hipRow.appendChild(stepInput);
    var moveHip = function (dx, dy, dz) {
      var cur = needRig(); if (!cur) return;
      var r = moveHips({ x: dx, y: dy, z: dz });
      if (r.ok) setStatus('Hông → ' + JSON.stringify(r.hipsAfter) +
        ' · chân trái ' + (r.feet.Left.locked ? 'KHÓA, lệch ' + r.feet.Left.error + 'm' : 'đi theo hông') +
        ' · chân phải ' + (r.feet.Right.locked ? 'KHÓA, lệch ' + r.feet.Right.error + 'm' : 'đi theo hông') + '.');
      else setStatus(r.error);
    };
    var step = function () { return clamp(parseFloat(stepInput.value) || 0.05, 0.01, 0.5); };
    [['← Trái', -1, 0, 0], ['→ Phải', 1, 0, 0], ['↑ Lên', 0, 1, 0], ['↓ Xuống', 0, -1, 0],
     ['Tiến (+Z)', 0, 0, 1], ['Lùi (−Z)', 0, 0, -1]].forEach(function (spec) {
      hipRow.appendChild(mkButton(spec[0], function () {
        var s = step();
        moveHip(spec[1] * s, spec[2] * s, spec[3] * s);
      }));
    });
    wrap.appendChild(hipRow);

    /* --- 3. Stretchy IK --- */
    wrap.appendChild(mkEl('div', '3. Stretchy IK', { fontWeight: 'bold', marginTop: '8px' }));
    var stRow = mkRow();
    var stChk = mkEl('input', null, {});
    stChk.type = 'checkbox';
    stChk.setAttribute('data-advik-stretchy', 'toggle');
    var curS = QR && QR.current && QR.current.advik;
    stChk.checked = !!(curS && curS.stretchy);
    stChk.addEventListener('change', function () {
      var cur = needRig(); if (!cur) { stChk.checked = !stChk.checked; return; }
      var r = setStretchy(stChk.checked);
      setStatus(r.ok ? ('Stretchy IK ' + (r.stretchy ? 'BẬT' : 'TẮT') + ' (maxStretch ' + r.maxStretch + ').') : r.error);
    });
    stRow.appendChild(stChk);
    stRow.appendChild(mkEl('span', 'Bật stretchy IK (chi duỗi ra khi target ngoài tầm với)', {}));
    stRow.appendChild(mkEl('span', 'Giới hạn:', { marginLeft: '8px' }));
    var maxInput = mkEl('input', null, { flex: '1' });
    maxInput.type = 'range'; maxInput.min = '1'; maxInput.max = '1.6'; maxInput.step = '0.05';
    maxInput.value = String(curS && curS.maxStretch ? curS.maxStretch : 1.3);
    maxInput.setAttribute('data-advik-maxstretch', 'slider');
    var maxVal = mkEl('span', maxInput.value + '×', { width: '40px' });
    maxInput.addEventListener('input', function () {
      maxVal.textContent = maxInput.value + '×';
      var cur = needRig(); if (!cur) return;
      var r = setStretchy(true, parseFloat(maxInput.value));
      if (r.ok) { stChk.checked = true; setStatus('maxStretch = ' + r.maxStretch + '× (stretchy IK đang BẬT).'); }
    });
    stRow.appendChild(maxInput); stRow.appendChild(maxVal);
    wrap.appendChild(stRow);
    wrap.appendChild(mkEl('div', 'Khi target xa hơn L1+L2, 2 xương scale dài ra tối đa maxStretch; target về trong tầm thì tự khôi phục.',
      { fontSize: '12px', color: '#555' }));

    /* --- 4. Blend IK/FK từng chi --- */
    wrap.appendChild(mkEl('div', '4. Blend IK/FK từng chi (0% = FK hoàn toàn, 100% = IK hoàn toàn)', { fontWeight: 'bold', marginTop: '8px' }));
    ['LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'].forEach(function (limbKey) {
      var row = mkRow();
      row.appendChild(mkEl('span', limbKey, { width: '90px' }));
      var slider = mkEl('input', null, { flex: '1' });
      slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
      var curB = QR && QR.current && QR.current.advik && QR.current.advik.blends;
      slider.value = String(Math.round(((curB && curB[limbKey] !== undefined ? curB[limbKey] : 1)) * 100));
      slider.setAttribute('data-advik-blend', limbKey);
      var valEl = mkEl('span', slider.value + '%', { width: '44px' });
      slider.addEventListener('input', function () {
        valEl.textContent = slider.value + '%';
        var cur = needRig(); if (!cur) return;
        var r = blendIKFK(limbKey, parseInt(slider.value, 10) / 100);
        if (r.ok) setStatus(limbKey + ' blend ' + slider.value + '% (FK→IK).');
        else setStatus(r.error);
      });
      row.appendChild(slider); row.appendChild(valEl);
      wrap.appendChild(row);
    });

    /* --- 5. Auto-place pole --- */
    wrap.appendChild(mkEl('div', '5. Auto-place pole (khuỷu ra sau, gối ra trước)', { fontWeight: 'bold', marginTop: '8px' }));
    var poleRow = mkRow();
    ['LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'].forEach(function (limbKey) {
      poleRow.appendChild(mkButton('🎯 ' + limbKey, function () {
        var cur = needRig(); if (!cur) return;
        var r = autoPlacePole(limbKey);
        if (r.ok) setStatus('Pole ' + limbKey + ' → ' + JSON.stringify(r.polePosition) + ' (hướng gập ' + JSON.stringify(r.bendDir) + ').');
        else setStatus(r.error);
      }));
    });
    wrap.appendChild(poleRow);
    wrap.appendChild(status);
    container.appendChild(wrap);
    return wrap;
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  var AdvIK = {
    setFootLock: setFootLock,
    getFootLock: getFootLock,
    lockedFootPos: lockedFootPos,
    moveHips: moveHips,
    computeStretchy: computeStretchy,
    solveLimbIK: solveLimbIK,
    setStretchy: setStretchy,
    getStretchy: getStretchy,
    restoreStretch: restoreStretch,
    blendIKFK: blendIKFK,
    getBlend: getBlend,
    autoPlacePole: autoPlacePole,
    renderSection: renderSection,
    _test: {
      computeStretchy: computeStretchy,
      solveLimbIK: solveLimbIK,
      setFootLock: setFootLock,
      getFootLock: getFootLock,
      lockedFootPos: lockedFootPos,
      moveHips: moveHips,
      blendIKFK: blendIKFK,
      getBlend: getBlend,
      autoPlacePole: autoPlacePole,
      setStretchy: setStretchy,
      getStretchy: getStretchy,
      restoreStretch: restoreStretch,
      renderSection: renderSection,
      ensureAdvIK: ensureAdvIK,
      LIMBS: (QR && QR.LIMBS) || null
    }
  };

  window.PixiStudio = window.PixiStudio || {};
  if (window.PixiStudio.ArpQuickRig) {
    window.PixiStudio.ArpQuickRig.AdvIK = AdvIK;
    /* Coordinator sẽ thêm QuickRig.registerSection sau — module phải
       chạy được cả khi hook chưa có: thử trong try/catch. */
    try {
      if (typeof window.PixiStudio.ArpQuickRig.registerSection === 'function') {
        window.PixiStudio.ArpQuickRig.registerSection('advik', renderSection);
      }
    } catch (e) {}
  }
})();
