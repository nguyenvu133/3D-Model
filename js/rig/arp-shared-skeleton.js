/* ============================================================
 * rig/arp-shared-skeleton.js — VÒNG ĐỒNG BỘ SKELETON (2026-11-27):
 * MỘT NGUỒN SỰ THẬT DUY NHẤT cho mọi nơi hiển thị xương.
 *
 * VẤN ĐỀ GỐC (đo được trên trình duyệt thật, 2 nhóm độc lập khớp):
 *  • Bộ TRÁI = Smart ghost (__arp_ghost__, arp-smart.js buildGhost):
 *    skeleton template từ landmark (41 khớp cyan + LineSegments),
 *    là CON CỦA SCENE, vị trí world NƯỚNG CỨNG lúc build — model dời
 *    đi (+1.5m X) thì ghost ĐỨNG YÊN tại gốc → "lơ lửng".
 *    Ghost lấy từ AutoRigPro.boneWorldPositions (tỉ lệ người thường):
 *    Hips Y=1.125 (thật 0.571), Head Y=1.76 (thật 1.17), tay TRÁI ở
 *    -X trong khi file Mixamo đặt tay trái ở +X (nhân vật hướng +Z).
 *  • Bộ PHẢI (1) = VP skeleton (arp-vp-skeleton.js): con của xương
 *    thật → bám đúng 0mm (nhóm A đo). Bộ PHẢI (2) = VpSelect overlay:
 *    sync mỗi frame → bám đúng từng mm khi dời/xoay model.
 *  • Tooltip "Head · dài 82.1 cm" KHỚP FILE: Head → con đầu tiên
 *    HeadTop_End = 82.06cm đo trong studio (HeadTop_End ở Y=1.953,
 *    đỉnh bbox, trong khi Head Y=1.170 — đoạn xương 0.78m toàn không
 *    khí phía trên đầu: LỖI DỮ LIỆU GỐC file Tripo/Mixamo, cùng họ
 *    với lỗi ngón trỏ phải RightHand→RightHandIndex1 = 41.3cm).
 *    Tooltip đó là hover trên bộ PHẢI (xương thật), KHÔNG phải ghost
 *    (Head của ghost chỉ dài 24.0cm).
 *  • ArpAnimator.setTarget KHÔNG CÓ caller nào trong repo → Animator
 *    không giữ skeleton nào (_target=null, _mixer không tồn tại)
 *    trong khi Rigging giữ xương thật; đổi model thì VP/VpSelect
 *    rebuild theo model:loaded còn Animator không đổi theo.
 *  • Mỗi module tự resolve target theo thứ tự RIÊNG (skeleton:
 *    selection→Models.current→Anim; select: QuickRig→RigAutoGen→
 *    selection→getMainModel; measure/boneshape: selection→
 *    getMainModel; animator: _target→Anim→getMainModel) nên khi có
 *    nhiều model / control rig, các lớp có thể bám 2 model khác nhau.
 *
 * QUYẾT ĐỊNH CỦA USER (2026-11-27 ~14:19, thay thế quyết định
 * 13:09 lấy ghost làm chuẩn): GIỮ NGUYÊN XƯƠNG GỐC KHI IMPORT —
 * chuẩn hiển thị = XƯƠNG THẬT trong file gốc, 0 biến dạng, không
 * mirror, không re-root, không template. Ghost KHÔNG còn làm chuẩn.
 *
 * BỔ SUNG (2026-11-27 ~14:20): "ko bỏ ghost mà tắt đi thôi" —
 * KHÔNG XÓA ghost: code + tính năng + group __arp_ghost__ + nút
 * bật/tắt giữ nguyên; ghost chỉ TẮT HIỂN THỊ mặc định khi model đã
 * có skeleton thật, user bật lại được bất cứ lúc nào bằng nút Ghost
 * có sẵn; ghost là lớp hiển thị RIÊNG, không lái canonical nữa.
 * CÁCH ĐO ĐÚNG (2026-11-27 ~14:19): khớp hiển thị so TRỰC TIẾP
 * với vị trí world của XƯƠNG THẬT cùng tên trong file gốc, ≤1mm.
 * Không mirror, không căn Hips: tay trái file ở +X thì hiển thị ở
 * +X; Hips thật Y=0,571 thì hiển thị Y=0,571 (không kéo về 1,125
 * của template). Dữ liệu gốc lỗi (HeadTop_End 82,06cm, ngón trỏ
 * phải bay) HIỂN THỊ ĐÚNG NHƯ FILE, chỉ cảnh báo.
 *
 * THIẾT KẾ:
 *  • getSharedSkeleton(): 1 bộ xương thật (bone set) cho mọi module
 *    (skin/clip vẫn dùng xương thật — không đụng skinning).
 *  • getCanonicalReference(): chuẩn = CHÍNH XƯƠNG THẬT (mode
 *    'bones' duy nhất): vị trí khớp = vị trí world xương thật cùng
 *    tên, residuals = 0, không mirror/re-root. Ghost template chỉ
 *    được ĐO để báo cáo độ lệch (minh bạch), không dùng làm chuẩn.
 *  • canonicalize(): IDENTITY đối với xương thật — giữ nguyên vị
 *    trí đầu vào, mirrorApplied=false, reRoot=0. Giữ lại hàm để
 *    harness/caller cũ không vỡ, nhưng không còn phép biến đổi nào.
 *  • ensureCanonicalJoints(): MỘT hierarchy Object3D duy nhất
 *    (__arp_canonical_skeleton__, con của model root qua attach()
 *    nên TỰ ĐI THEO model) — VP skeleton/select/labels/IK/trails
 *    đều đọc khớp từ đây; pose sync mỗi frame copy world quaternion
 *    của xương thật cùng tên (giữ đúng tư thế khi phát clip).
 *  • Ghost (Smart, __arp_ghost__): lớp hiển thị RIÊNG, mặc định ẨN
 *    khi model có xương thật (tắt ở model:loaded), bật lại bằng nút
 *    Ghost; KHÔNG lái canonical, KHÔNG đổi vị trí xương thật.
 *  • detectMisplacedFingers()/fixMisplacedFingers(): ngón lệch
 *    >0.2m Y so với tay (file này: RightHandIndex1/2/3 ở Y 1.055 /
 *    1.135 / 1.202 thay vì ~0.73) — báo UI, mặc định GIỮ NGUYÊN
 *    (không tự sửa dữ liệu gốc); sửa khi user bấm (mirror chuỗi
 *    ngón trái) + tính lại boneInverses để mesh không biến dạng.
 *
 * DEFENSIVE: mọi hàm lazy-resolve PS/THREE/bus; thiếu cái nào thì
 * trả {ok:false} êm, không throw. Không chạm DOM lúc load.
 * ============================================================ */
(function () {
  'use strict';

  var PS = window.PixiStudio || (window.PixiStudio = {});
  var GROUP_NAME = '__arp_canonical_skeleton__';
  var FINGER_DY_WARN_M = 0.2; /* ngón lệch Y >0.2m so với tay cùng bên */
  var EPS_MM = 0.001;         /* sai số đồng bộ cho phép: 1mm */

  var _cache = {
    targetUuid: null, target: null, bones: [], skeleton: null,
    rootBone: null, boneCount: 0, topLevel: null
  };
  var _canonical = {
    targetUuid: null, group: null, joints: {}, /* stripped -> Object3D */
    mode: null, /* 'bones' (duy nhất — chuẩn = xương thật) */
    mirrorApplied: false, reRoot: null, residuals: {}, warnings: []
  };
  var _changeListeners = [];
  var _busBound = false;
  var _renderWrapped = false;
  var _prevRender = null;
  var _fingerNotifiedFor = null; /* uuid model đã báo ngón lệch */

  /* ---------- helpers ---------- */
  function _THREE() {
    try {
      if (typeof window !== 'undefined' && window.THREE) return window.THREE;
      if (typeof THREE !== 'undefined') return THREE;
    } catch (e) {}
    return null;
  }
  function _bus() {
    var p = null;
    try { p = (typeof window !== 'undefined' && window.PixiStudio) || PS; } catch (e) {}
    return (p && p.bus) || null;
  }
  function _emit(ev, data) {
    try {
      var b = _bus();
      if (b && typeof b.emit === 'function') b.emit(ev, data);
    } catch (e) {}
  }
  function _notify(type, title, message, duration) {
    try { _emit('notify', { type: type, title: title, message: message, duration: duration || 12000 }); } catch (e) {}
  }
  /* Bóc prefix tên xương: 'mixamorig:LeftArm', 'mixamorigHips'. */
  function stripName(name) {
    var n = String(name == null ? '' : name);
    n = n.replace(/^.*:/, '');
    n = n.replace(/^mixamorig/i, '');
    n = n.replace(/__proxy.*$/i, '');
    return n;
  }
  function _isFingerName(stripped) {
    return /^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)\d+$/.test(stripped || '');
  }
  function _handOf(stripped) {
    if (/^LeftHand/.test(stripped || '')) return 'LeftHand';
    if (/^RightHand/.test(stripped || '')) return 'RightHand';
    return null;
  }
  function _climbToTop(obj) {
    /* Leo lên child trực tiếp của modelRoot (đỉnh model); dừng ở
       scene/modelRoot để không leo sang model khác. */
    var root = null;
    try { root = (PS.Viewport && PS.Viewport.modelRoot) || null; } catch (e) {}
    var o = obj, guard = 0;
    while (o && o.parent && guard < 64) {
      if (o.isScene || (root && o === root)) return null;
      if (root && o.parent === root) return o;
      if (!root && !o.parent.parent) return o;
      o = o.parent;
      guard++;
    }
    return o || obj;
  }
  function _collectBones(target) {
    var out = [];
    if (!target || !target.traverse) return out;
    target.traverse(function (o) { if (o && o.isBone) out.push(o); });
    return out;
  }
  function _findSkeleton(target) {
    if (!target) return null;
    var THREE = _THREE();
    if (!THREE) return null;
    var skel = null;
    target.traverse(function (o) {
      if (!skel && o && o.isSkinnedMesh && o.skeleton && o.skeleton.bones && o.skeleton.bones.length) skel = o.skeleton;
    });
    var bones = [], seen = {};
    function _push(b) { if (b && b.isBone && !seen[b.uuid]) { seen[b.uuid] = true; bones.push(b); } }
    if (skel && skel.bones) skel.bones.forEach(_push);
    _collectBones(target).forEach(_push);
    if (!bones.length) return null;
    var root = null;
    for (var i = 0; i < bones.length; i++) {
      if (stripName(bones[i].name) === 'Hips') { root = bones[i]; break; }
    }
    if (!root) {
      for (var j = 0; j < bones.length; j++) {
        if (!bones[j].parent || !bones[j].parent.isBone) { root = bones[j]; break; }
      }
    }
    if (!root) root = bones[0];
    return { rootBone: root, bones: bones, skeleton: skel };
  }

  /* ---------- resolve target: 1 thứ tự duy nhất cho mọi module ----------
   * selection → Models.current → Anim.targetObject → QuickRig/RigAutoGen
   * current → getMainModel() → AutoRigPro.lastResult. Ứng viên ĐẦU TIÊN
   * có mặt thì thắng; chỉ ứng viên vắng mới rơi xuống sau. */
  function resolveTarget(arg) {
    if (arg && arg.traverse) return arg;
    if (arg && arg.isBone) return arg;
    var p = null;
    try { p = (typeof window !== 'undefined' && window.PixiStudio) || PS; } catch (e) {}
    if (!p) return null;
    try {
      if (p.State && typeof p.State.get === 'function') {
        var sel = p.State.get('selection');
        if (sel && sel.traverse) return sel;
      }
    } catch (e) {}
    try {
      if (p.Models && typeof p.Models.getCurrent === 'function') {
        var cur = p.Models.getCurrent();
        if (cur && cur.object3D) return cur.object3D;
      }
    } catch (e) {}
    try { if (p.Anim && p.Anim.targetObject) return p.Anim.targetObject; } catch (e) {}
    try {
      if (p.ArpQuickRig && p.ArpQuickRig.current && p.ArpQuickRig.current.target) return p.ArpQuickRig.current.target;
    } catch (e) {}
    try {
      if (p.RigAutoGen && p.RigAutoGen.current && p.RigAutoGen.current.target) return p.RigAutoGen.current.target;
    } catch (e) {}
    try {
      if (p.Viewport && typeof p.Viewport.getMainModel === 'function') {
        var m = p.Viewport.getMainModel();
        if (m) return m;
      }
    } catch (e) {}
    try {
      if (p.AutoRigPro && p.AutoRigPro.lastResult && p.AutoRigPro.lastResult.rig &&
          p.AutoRigPro.lastResult.rig.rootBone) return p.AutoRigPro.lastResult.rig.rootBone;
    } catch (e) {}
    return null;
  }

  /* ---------- 1 bộ xương thật (shared) ---------- */
  function getSharedSkeleton(target) {
    var resolved = resolveTarget(target);
    if (!resolved) return { ok: false, reason: 'no-target' };
    if (_cache.targetUuid === resolved.uuid && _cache.bones.length) {
      return {
        ok: true, target: _cache.target, bones: _cache.bones,
        skeleton: _cache.skeleton, rootBone: _cache.rootBone,
        boneCount: _cache.boneCount, targetUuid: _cache.targetUuid,
        topLevel: _cache.topLevel, cached: true
      };
    }
    var found = _findSkeleton(resolved);
    if (!found || !found.bones.length) return { ok: false, reason: 'no-skeleton', target: resolved };
    var top = _climbToTop(resolved) || resolved;
    var changed = _cache.targetUuid !== resolved.uuid;
    _cache = {
      targetUuid: resolved.uuid, target: resolved, bones: found.bones,
      skeleton: found.skeleton, rootBone: found.rootBone,
      boneCount: found.bones.length, topLevel: top
    };
    if (changed) {
      _fingerNotifiedFor = null;
      _emit('arp:shared-skeleton-changed', { targetUuid: resolved.uuid, target: resolved, boneCount: found.bones.length });
      _changeListeners.slice().forEach(function (fn) {
        try { fn({ target: resolved, boneCount: found.bones.length }); } catch (e) {}
      });
    }
    return {
      ok: true, target: resolved, bones: found.bones, skeleton: found.skeleton,
      rootBone: found.rootBone, boneCount: found.bones.length,
      targetUuid: resolved.uuid, topLevel: top, cached: false
    };
  }

  function onSkeletonChange(cb) {
    if (typeof cb !== 'function') return function () {};
    _changeListeners.push(cb);
    return function () {
      var i = _changeListeners.indexOf(cb);
      if (i >= 0) _changeListeners.splice(i, 1);
    };
  }

  function invalidate() {
    _cache.targetUuid = null; _cache.target = null; _cache.bones = [];
    _cache.skeleton = null; _cache.rootBone = null; _cache.boneCount = 0;
    _cache.topLevel = null;
    return true;
  }

  /* ---------- dữ liệu ghost (chỉ để ĐO + BÁO CÁO độ lệch) ----------
   * VÒNG GIỮ XƯƠNG GỐC: ghost KHÔNG còn làm chuẩn — dữ liệu này chỉ
   * dùng để tính warning "template lệch bao nhiêu so với xương thật"
   * trong getCanonicalReference, và để Smart tab hiển thị ghost
   * riêng. Không dùng vị trí ghost để dựng/dời khớp chuẩn nữa. */
  function _ghostData(target) {
    var S = null;
    try { S = (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.ArpSmart) || PS.ArpSmart; } catch (e) {}
    if (!S) return null;
    try {
      if (typeof S._ghostPositions === 'function') {
        var r = S._ghostPositions(target);
        if (r && r.pos && Object.keys(r.pos).length >= 5) {
          return { pos: r.pos, pairs: r.pairs || [], source: 'ghost-fresh' };
        }
      }
    } catch (e) {}
    var pos = (S.ghost && S.ghost.jointPositions) || {};
    var pairs = (S.ghost && S.ghost.pairs) || [];
    var keys = Object.keys(pos);
    if (keys.length >= 5) return { pos: pos, pairs: pairs, source: 'ghost-cache' };
    return null;
  }

  /* ---------- phép biến đổi chuẩn (PURE — harness test trực tiếp)
   * VÒNG GIỮ XƯƠNG GỐC (2026-11-27 ~14:19): canonicalize() là
   * IDENTITY — trả lại đúng vị trí đầu vào, KHÔNG mirror X, KHÔNG
   * re-root Hips, KHÔNG đổi tỉ lệ. Đầu vào ở vòng này là vị trí
   * world của XƯƠNG THẬT (không phải template ghost), nên identity
   * = giữ nguyên xương gốc từng mm. Giữ nguyên chữ ký hàm (pos,
   * pairs, cx, realHipsWorld) để caller/harness cũ không vỡ; các
   * tham số cx/realHipsWorld được ghi nhận nhưng KHÔNG dùng để dời
   * khớp nữa (reRoot luôn 0, mirrorApplied luôn false).
   * Vào: positions {name:{x,y,z}} (world, xương thật), pairs.
   * Ra: joints {name:{x,y,z,parent,child,length,hasReal}},
   *   mirrorApplied=false, reRoot={0,0,0}, cx (chỉ để tham khảo). */
  function canonicalize(positions, pairs, cx, realHipsWorld) {
    var pos = positions || {};
    var out = { joints: {}, mirrorApplied: false, reRoot: { x: 0, y: 0, z: 0 }, cx: cx };
    var parentOf = {};
    var childOf = {};
    (pairs || []).forEach(function (pr) {
      if (pr && pr[0] && pr[1]) { parentOf[pr[1]] = pr[0]; if (!childOf[pr[0]]) childOf[pr[0]] = pr[1]; }
    });
    var names = Object.keys(pos);
    if (!names.length) return out;
    names.forEach(function (n) {
      var p = pos[n];
      if (!p) return;
      var j = {
        x: +p.x || 0, y: +p.y || 0, z: +p.z || 0,
        parent: parentOf[n] || null, child: childOf[n] || null, length: null, hasReal: true
      };
      if (j.child && pos[j.child]) {
        var c = pos[j.child];
        var dx = (+c.x || 0) - j.x, dy = (+c.y || 0) - j.y, dz = (+c.z || 0) - j.z;
        j.length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      out.joints[n] = j;
    });
    return out;
  }

  /* Tâm X model (world) để mirror: bbox center X của ĐỈNH model
     (SkinnedMesh nằm ở đó; đo từ Armature sẽ rỗng vì Armature chỉ
     chứa xương, không có mesh). */
  function _modelCenterX(target) {
    var THREE = _THREE();
    if (!THREE || !target) return 0;
    try {
      var top = _climbToTop(target) || target;
      var box = new THREE.Box3().setFromObject(top);
      if (!box.isEmpty()) {
        var c = box.getCenter(new THREE.Vector3());
        if (isFinite(c.x)) return c.x;
      }
    } catch (e) {}
    return 0;
  }
  function _worldPosOf(obj) {
    var THREE = _THREE();
    if (!THREE || !obj) return null;
    try {
      var v = new THREE.Vector3();
      obj.getWorldPosition(v);
      return { x: v.x, y: v.y, z: v.z };
    } catch (e) { return null; }
  }
  function _boneByStripped(bones, stripped) {
    if (!bones) return null;
    for (var i = 0; i < bones.length; i++) {
      if (stripName(bones[i].name) === stripped) return bones[i];
    }
    return null;
  }

  /* ---------- canonical reference: CHUẨN = XƯƠNG THẬT (duy nhất)
   * VÒNG GIỮ XƯƠNG GỐC (2026-11-27 ~14:19): không còn mode 'ghost'.
   * Khớp chuẩn = vị trí world của xương thật cùng tên trong file
   * gốc (không mirror, không re-root, không template): residuals
   * luôn 0, ghostOnly/realOnly luôn rỗng. Ghost template (nếu có)
   * chỉ được ĐO để báo cáo độ lệch cho minh bạch — KHÔNG dùng làm
   * chuẩn, KHÔNG hiện thay xương thật. */
  function getCanonicalReference(target) {
    var shared = getSharedSkeleton(target);
    var resolved = (shared && shared.target) || resolveTarget(target);
    if (!resolved) return { ok: false, reason: 'no-target' };
    var realBones = (shared && shared.ok) ? shared.bones : [];
    if (!realBones.length) return { ok: false, reason: 'no-skeleton', target: resolved };
    var cx = _modelCenterX(resolved);
    var joints = {};
    var residuals = {};
    realBones.forEach(function (b) {
      var s = stripName(b.name);
      var w = _worldPosOf(b);
      if (!w) return;
      var kids = (b.children || []).filter(function (c) { return c && c.isBone; });
      var len = null;
      if (kids.length) {
        var kw = _worldPosOf(kids[0]);
        if (kw) len = Math.sqrt(Math.pow(kw.x - w.x, 2) + Math.pow(kw.y - w.y, 2) + Math.pow(kw.z - w.z, 2));
      }
      joints[s] = {
        x: w.x, y: w.y, z: w.z,
        parent: (b.parent && b.parent.isBone) ? stripName(b.parent.name) : null,
        child: kids.length ? stripName(kids[0].name) : null,
        length: len, hasReal: true
      };
      /* Chuẩn = xương thật nên residual = 0 theo định nghĩa. */
      residuals[s] = { dx: 0, dy: 0, dz: 0, dist: 0, relDx: 0, relDy: 0, relDz: 0 };
    });
    var warnings = [];
    /* Đo ghost template (nếu có) CHỈ để báo cáo độ lệch — ghost
       không còn làm chuẩn nên lệch bao nhiêu cũng không dời xương. */
    var gd = null;
    try { gd = _ghostData(resolved); } catch (e) { gd = null; }
    if (gd && gd.pos) {
      var maxGhostDiff = 0, worstGhost = '';
      Object.keys(gd.pos).forEach(function (n) {
        var j = joints[n];
        var g = gd.pos[n];
        if (!j || !g) return;
        var d = Math.sqrt(Math.pow(g.x - j.x, 2) + Math.pow(g.y - j.y, 2) + Math.pow(g.z - j.z, 2));
        if (d > maxGhostDiff) { maxGhostDiff = d; worstGhost = n; }
      });
      if (maxGhostDiff > 0.001) {
        warnings.push('Ghost template lệch tối đa ' + (maxGhostDiff * 100).toFixed(1) + 'cm so với xương thật (@' + worstGhost +
          ') — ghost KHÔNG làm chuẩn nữa, đã tắt mặc định (bật lại bằng nút Ghost); xương hiển thị = xương thật trong file gốc.');
      }
    }
    return {
      ok: true, mode: 'bones', target: resolved, targetUuid: resolved.uuid,
      joints: joints, mirrorApplied: false, cx: cx, reRoot: { x: 0, y: 0, z: 0 },
      residuals: residuals, warnings: warnings, ghostOnly: [], realOnly: [],
      boneCount: Object.keys(joints).length
    };
  }
  function _boneChildLen(bone) {
    try {
      var kids = (bone.children || []).filter(function (c) { return c && c.isBone; });
      if (!kids.length) return '?';
      var a = _worldPosOf(bone), b = _worldPosOf(kids[0]);
      if (!a || !b) return '?';
      return (Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2) + Math.pow(b.z - a.z, 2)) * 100).toFixed(1) + 'cm';
    } catch (e) { return '?'; }
  }

  /* ---------- 1 hierarchy khớp chuẩn duy nhất (gắn vào model) ---------- */
  function _disposeCanonicalGroup() {
    if (_canonical.group) {
      try { if (_canonical.group.parent) _canonical.group.parent.remove(_canonical.group); } catch (e) {}
    }
    _canonical.group = null;
    _canonical.joints = {};
    _canonical.targetUuid = null;
    _canonical.mode = null;
  }
  function _topLevelOf(target) {
    var top = _climbToTop(target);
    return top || target;
  }

  /* Dựng (hoặc trả lại) hierarchy khớp chuẩn cho target.
   * Khớp là Object3D thường (KHÔNG isBone — tránh lọt vào export/
   * skeleton thật), userData.isCanonicalJoint=true, tên = tên chuẩn
   * (vd 'Head'). Vị trí local = offset cha→con theo canonical
   * (đơn vị world); group được attach() vào model root nên tự đi
   * theo model (dời/xoay/scale). Pose sync ở syncCanonicalPose(). */
  function ensureCanonicalJoints(target) {
    var THREE = _THREE();
    if (!THREE) return { ok: false, reason: 'no-three' };
    var ref = getCanonicalReference(target);
    if (!ref.ok) return ref;
    var resolved = ref.target;
    var top = _topLevelOf(resolved);
    /* Dùng lại nếu cùng model + cùng mode + group còn gắn. */
    if (_canonical.group && _canonical.targetUuid === resolved.uuid && _canonical.mode === ref.mode) {
      var stillThere = false;
      try { stillThere = !!(_canonical.group.parent); } catch (e) {}
      if (stillThere) {
        return {
          ok: true, target: resolved, group: _canonical.group, joints: _canonical.joints,
          mode: ref.mode, boneCount: Object.keys(_canonical.joints).length, cached: true, reference: ref
        };
      }
    }
    _disposeCanonicalGroup();
    var group = new THREE.Group();
    group.name = GROUP_NAME;
    var joints = {};
    var order = Object.keys(ref.joints);
    /* Thứ tự topo (cha trước con) — không phụ thuộc thứ tự chèn
       của dữ liệu ghost (BONE_DEFS thường đã đúng nhưng không chắc). */
    var depth = {};
    function _depth(n, guard) {
      if (depth[n] != null) return depth[n];
      var p = ref.joints[n] && ref.joints[n].parent;
      if (!p || !ref.joints[p] || guard > 64) return (depth[n] = 0);
      return (depth[n] = _depth(p, (guard || 0) + 1) + 1);
    }
    order.forEach(function (n) { _depth(n, 0); });
    order.sort(function (a, b) { return depth[a] - depth[b]; });
    /* Dựng khớp (chưa gắn cha — gắn sau theo parent để thứ tự không
       phụ thuộc thứ tự duyệt). */
    order.forEach(function (n) {
      var j = ref.joints[n];
      var o = new THREE.Object3D();
      o.name = n;
      o.userData.isCanonicalJoint = true;
      o.userData.canonicalName = n;
      o.userData.realBoneName = j.hasReal ? n : null;
      o.userData.isBoneVisual = true; /* không nướng vào FBX/GLB */
      joints[n] = o;
    });
    /* World quaternion từng khớp lúc bind: xương thật cùng tên; khớp
       không có đối tác thật thừa hưởng world quat của cha. */
    var worldQuat = {};
    try { resolved.updateMatrixWorld(true); } catch (e) {}
    var shared = getSharedSkeleton(resolved);
    order.forEach(function (n) {
      var rb = (shared && shared.ok) ? _boneByStripped(shared.bones, n) : null;
      if (rb) {
        var q = new THREE.Quaternion();
        rb.getWorldQuaternion(q);
        worldQuat[n] = q;
      } else if (ref.joints[n].parent && worldQuat[ref.joints[n].parent]) {
        worldQuat[n] = worldQuat[ref.joints[n].parent].clone();
      } else {
        worldQuat[n] = new THREE.Quaternion();
      }
    });
    /* Local position = offset cha→con BIỂU DIỄN TRONG FRAME LOCAL của
       cha: Lj = Qp⁻¹ · (Wj − Wp). Dùng trực tiếp hiệu world-axis sẽ
       SAI khi cha xoay (vd tay T-pose: xương cánh tay xoay ~90°).
       Root (Hips): local = world (group ở gốc scene lúc dựng).
       Local quaternion = Qp⁻¹ · Qj (root: cha là group, quat identity). */
    order.forEach(function (n) {
      var j = ref.joints[n];
      var o = joints[n];
      if (j.parent && joints[j.parent]) {
        var p = ref.joints[j.parent];
        var d = new THREE.Vector3(j.x - p.x, j.y - p.y, j.z - p.z);
        d.applyQuaternion(worldQuat[j.parent].clone().invert());
        o.position.copy(d);
      } else {
        o.position.set(j.x, j.y, j.z);
      }
      var pq = (j.parent && worldQuat[j.parent]) ? worldQuat[j.parent] : new THREE.Quaternion();
      o.quaternion.copy(pq.clone().invert().multiply(worldQuat[n]));
    });
    /* Gắn hierarchy: root(s) vào group, con vào cha. */
    order.forEach(function (n) {
      var j = ref.joints[n];
      var o = joints[n];
      if (j.parent && joints[j.parent]) joints[j.parent].add(o);
      else group.add(o);
    });
    /* Đặt group vào scene rồi attach vào model root: three.js tự
       đổi local transform để giữ nguyên vị trí world, sau đó group
       đi theo model (dời/xoay/scale). */
    try {
      var scene = null;
      try { scene = PS.Viewport && PS.Viewport.scene; } catch (e) {}
      if (scene) scene.add(group);
      else top.add(group);
      try { top.updateMatrixWorld(true); } catch (e) {}
      if (scene && top && top !== scene) {
        try { top.attach(group); } catch (e) { try { top.add(group); } catch (e2) {} }
      }
    } catch (e) {
      try { top.add(group); } catch (e2) {}
    }
    _canonical.group = group;
    _canonical.joints = joints;
    _canonical.targetUuid = resolved.uuid;
    _canonical.mode = ref.mode;
    _canonical.mirrorApplied = ref.mirrorApplied;
    _canonical.reRoot = ref.reRoot;
    _canonical.residuals = ref.residuals || {};
    _canonical.warnings = ref.warnings || [];
    return {
      ok: true, target: resolved, group: group, joints: joints,
      mode: ref.mode, boneCount: order.length, cached: false, reference: ref
    };
  }

  /* Cập nhật vị trí khớp chuẩn từ dữ liệu ghost — KHÔNG CÒN ÁP DỤNG:
   * VÒNG GIỮ XƯƠNG GỐC: ghost không lái canonical nữa nên hàm này
   * luôn từ chối (không dời khớp nào). Kéo marker / regenerate chỉ
   * đổi GHOST (lớp riêng của Smart, qua ArpSmart.updateGhost
   * fallback dời khớp cầu __arp_ghost__), xương thật giữ nguyên.
   * Giữ lại hàm + chữ ký để caller cũ không vỡ. */
  function updateCanonicalFromGhost(ghostPositions, pairs) {
    return { ok: false, reason: 'ghost-not-canonical' };
  }

  /* Đồng bộ tư thế: khớp chuẩn copy world quaternion của xương thật
   * cùng tên (khớp không có đối tác thật giữ nguyên — theo cha).
   * Gọi mỗi frame (render wrap bên dưới); rẻ: 41 quaternion. */
  function syncCanonicalPose() {
    if (!_canonical.group || !_canonical.joints) return 0;
    var THREE = _THREE();
    if (!THREE) return 0;
    var shared = getSharedSkeleton(_cache.target);
    if (!shared || !shared.ok) return 0;
    var n = 0;
    try { _cache.target.updateMatrixWorld(true); } catch (e) {}
    var q = new THREE.Quaternion(), pq = new THREE.Quaternion();
    Object.keys(_canonical.joints).forEach(function (name) {
      var o = _canonical.joints[name];
      var rb = _boneByStripped(shared.bones, name);
      if (!o || !rb) return;
      try {
        rb.getWorldQuaternion(q);
        if (o.parent) o.parent.getWorldQuaternion(pq);
        else pq.identity();
        o.quaternion.copy(pq.invert().multiply(q));
        n++;
      } catch (e) {}
    });
    /* Neo khớp gốc (Hips) vào vị trí world của xương gốc thật: ở tư
       thế nghỉ đã trùng (reRoot căn Hips về Hips thật); khi phát clip
       có root motion thì display đi theo nhân vật thay vì đứng yên. */
    try {
      var rootJoint = _canonical.joints.Hips || null;
      var rb0 = rootJoint ? _boneByStripped(shared.bones, 'Hips') : null;
      if (rootJoint && rb0) {
        var rw = new THREE.Vector3();
        rb0.getWorldPosition(rw);
        var lw = rootJoint.parent ? rootJoint.parent.worldToLocal(rw.clone()) : rw;
        rootJoint.position.copy(lw);
      }
    } catch (e) {}
    return n;
  }
  function update() {
    /* Chỉ sync khi group đang hiện (tiết kiệm frame khi ẩn). */
    try {
      if (_canonical.group && _canonical.group.visible) return syncCanonicalPose();
    } catch (e) {}
    return 0;
  }

  /* Lấy 1 khớp chuẩn theo tên (strip) — dùng cho select/labels/IK. */
  function getJoint(name, target) {
    if (!name) return null;
    var s = stripName(name);
    if (_canonical.joints && _canonical.joints[s]) return _canonical.joints[s];
    var r = ensureCanonicalJoints(target);
    if (r && r.ok && r.joints && r.joints[s]) return r.joints[s];
    return null;
  }
  function getCanonicalGroup() { return _canonical.group; }
  function getCanonicalInfo() {
    return {
      mode: _canonical.mode, targetUuid: _canonical.targetUuid,
      jointCount: _canonical.joints ? Object.keys(_canonical.joints).length : 0,
      mirrorApplied: !!_canonical.mirrorApplied, reRoot: _canonical.reRoot,
      residuals: _canonical.residuals || {}, warnings: _canonical.warnings || []
    };
  }

  /* ---------- ngón lệch (file gốc) ---------- */
  function detectMisplacedFingers(target) {
    var shared = getSharedSkeleton(target);
    if (!shared || !shared.ok) return { ok: false, reason: 'no-skeleton', warnings: [] };
    var THREE = _THREE();
    var byName = {};
    shared.bones.forEach(function (b) { byName[stripName(b.name)] = b; });
    var warnings = [];
    Object.keys(byName).forEach(function (s) {
      if (!_isFingerName(s)) return;
      var hand = _handOf(s);
      var hb = byName[hand];
      if (!hb) return;
      try {
        var a = new THREE.Vector3(), b = new THREE.Vector3();
        byName[s].getWorldPosition(a);
        hb.getWorldPosition(b);
        var dy = a.y - b.y;
        if (Math.abs(dy) > FINGER_DY_WARN_M) {
          warnings.push({
            bone: s, fullName: byName[s].name, hand: hand,
            dy: dy, y: a.y, handY: b.y,
            message: s + ' lệch Y ' + (dy >= 0 ? '+' : '') + dy.toFixed(2) + 'm so với ' + hand +
              ' (Y ' + a.y.toFixed(2) + 'm thay vì ~' + b.y.toFixed(2) + 'm)'
          });
        }
      } catch (e) {}
    });
    return { ok: true, target: shared.target, warnings: warnings, count: warnings.length };
  }
  function checkFingerWarnings(target) {
    var r = detectMisplacedFingers(target);
    if (!r.ok || !r.warnings.length) return r;
    var resolved = r.target;
    if (_fingerNotifiedFor === (resolved && resolved.uuid)) return r;
    _fingerNotifiedFor = resolved && resolved.uuid;
    var lines = r.warnings.map(function (w) { return w.message; }).join('; ');
    _notify('warning', 'Ngón tay lệch trong file gốc',
      r.warnings.length + ' xương ngón lệch vị trí trong file gốc — ' + lines +
      '. Mặc định GIỮ NGUYÊN (không tự sửa dữ liệu gốc). Bấm "Sửa ngón phải" ở hàng Skeleton để đưa về gần tay (mirror ngón trái).',
      15000);
    return r;
  }
  /* Sửa vị trí ngón lệch: mirror chuỗi ngón tay TRÁI sang PHẢI (và
   * ngược lại nếu tay trái lệch). Tính lại boneInverses để mesh
   * không biến dạng (bind pose mới = tư thế hiện tại). */
  function fixMisplacedFingers(target) {
    var THREE = _THREE();
    if (!THREE) return { ok: false, reason: 'no-three' };
    var det = detectMisplacedFingers(target);
    if (!det.ok) return det;
    if (!det.warnings.length) return { ok: true, fixed: [], message: 'Không có ngón lệch.' };
    var shared = getSharedSkeleton(det.target);
    var byName = {};
    shared.bones.forEach(function (b) { byName[stripName(b.name)] = b; });
    var fixed = [];
    try { det.target.updateMatrixWorld(true); } catch (e) {}
    det.warnings.forEach(function (w) {
      try {
        var bone = byName[w.bone];
        var hand = byName[w.hand];
        var otherHandName = w.hand === 'LeftHand' ? 'RightHand' : 'LeftHand';
        var otherHand = byName[otherHandName];
        /* Đối tác cùng tên phía bên kia, vd LeftHandIndex1. */
        var otherName = w.bone.replace(/^(Left|Right)Hand/, otherHandName === 'LeftHand' ? 'LeftHand' : 'RightHand');
        var otherBone = byName[otherName];
        var otherHandBone = otherHand;
        var targetWorld = null;
        if (otherBone && otherHandBone && hand) {
          /* offset đối tác so với tay đối tác (world) → mirror X qua
             cx → cộng vào tay bên này. */
          var ow = new THREE.Vector3(), oh = new THREE.Vector3(), hw = new THREE.Vector3();
          otherBone.getWorldPosition(ow);
          otherHandBone.getWorldPosition(oh);
          hand.getWorldPosition(hw);
          var off = ow.clone().sub(oh);
          off.x = -off.x; /* mirror qua mặt phẳng giữa (X → 2*cx - x) */
          targetWorld = hw.clone().add(off);
        } else if (hand) {
          /* Fallback: đặt ngay dưới tay (hướng xuống 7cm). */
          var hv = new THREE.Vector3();
          hand.getWorldPosition(hv);
          targetWorld = hv.clone().add(new THREE.Vector3(0, -0.07, 0.02));
        }
        if (!targetWorld || !bone.parent) return;
        /* Cập nhật matrixWorld sau mỗi xương đã dời: xương sau (vd
           Index4) có cha là xương vừa dời (Index3) — worldToLocal
           dùng matrixWorld cũ sẽ sai tới >1m. */
        try { det.target.updateMatrixWorld(true); } catch (e) {}
        var local = bone.parent.worldToLocal(targetWorld.clone());
        bone.position.copy(local);
        fixed.push({ bone: w.bone, fromY: w.y, toY: targetWorld.y });
      } catch (e) {}
    });
    try {
      det.target.updateMatrixWorld(true);
      if (shared.skeleton) shared.skeleton.calculateInverses();
      /* Re-bind để bind pose mới = tư thế hiện tại (mesh không đổi). */
      det.target.traverse(function (o) {
        if (o && o.isSkinnedMesh && o.skeleton) {
          try { o.bind(o.skeleton, o.matrixWorld); } catch (e) {}
        }
      });
    } catch (e) {}
    return { ok: true, fixed: fixed, count: fixed.length };
  }

  /* ---------- bus: model đổi / rig xong / dời model ----------
   * VÒNG GIỮ XƯƠNG GỐC: model mới có xương thật → TẮT ghost mặc
   * định (ArpSmart.hideGhost — chỉ ẩn group __arp_ghost__, KHÔNG
   * xóa group/code; user bật lại bằng nút Ghost bất cứ lúc nào). */
  function _hideSmartGhostIfReal() {
    try {
      var S = PS.ArpSmart;
      if (!S || typeof S.hideGhost !== 'function') return false;
      var shared = getSharedSkeleton();
      if (!shared || !shared.ok || !shared.bones.length) return false;
      S.hideGhost();
      return true;
    } catch (e) { return false; }
  }
  function _bindBus() {
    if (_busBound) return true;
    var b = _bus();
    if (!b || typeof b.on !== 'function') return false;
    try {
      b.on('model:loaded', function (data) {
        try {
          invalidate();
          _disposeCanonicalGroup();
          /* Đo lại landmark cho model mới (ghost không dùng số đo cũ). */
          var S = PS.ArpSmart;
          if (S && typeof S.refreshLandmarks === 'function') {
            var t = null;
            try {
              if (data && data.id && PS.Models && PS.Models.models) {
                var entry = PS.Models.models[data.id];
                if (entry && entry.object3D) t = entry.object3D;
              }
            } catch (e) {}
            if (!t) t = resolveTarget();
            if (t) S.refreshLandmarks(t);
          }
          /* Báo ngón lệch cho model mới (mặc định giữ nguyên). */
          try { checkFingerWarnings(resolveTarget()); } catch (e) {}
          /* Ghost tắt mặc định khi model có xương thật (giữ xương
             gốc làm chuẩn hiển thị duy nhất; ghost vẫn bật lại được). */
          try { _hideSmartGhostIfReal(); } catch (e) {}
          /* Animator wire ở arp-animator.js (nó tự nghe model:loaded);
             ở đây chỉ emit lại để các lớp VP rebuild. */
          _emit('arp:shared-skeleton-changed', { reason: 'model:loaded', data: data || null });
        } catch (e) {}
      });
      b.on('arp:rig-complete', function () {
        try { invalidate(); _emit('arp:shared-skeleton-changed', { reason: 'rig-complete' }); } catch (e) {}
      });
      /* Dời/xoay/scale model xong (kéo gizmo): canonical group đã
         là con của model nên tự theo; chỉ refresh landmark khi cần
         (đo lại cho lần build sau, không dựng lại group). */
      b.on('transform:changed', function () {
        try {
          var S = PS.ArpSmart;
          if (S && typeof S.refreshLandmarks === 'function') {
            var t = resolveTarget();
            if (t) S.refreshLandmarks(t);
          }
        } catch (e) {}
      });
      _busBound = true;
      return true;
    } catch (e) { return false; }
  }
  /* Wrap Viewport.render 1 lần để sync pose mỗi frame (theo mẫu
   * VpSelect — wrap chồng được, mỗi module wrap 1 lớp). */
  function _wrapRender() {
    if (_renderWrapped) return true;
    try {
      var V = PS.Viewport;
      if (!V || typeof V.render !== 'function') return false;
      var prev = V.render;
      _prevRender = prev;
      V.render = function (dt) {
        prev.call(V, dt);
        try { update(); } catch (e) {}
      };
      _renderWrapped = true;
      return true;
    } catch (e) { return false; }
  }

  var ArpSharedSkeleton = {
    stripName: stripName,
    resolveTarget: resolveTarget,
    getSharedSkeleton: getSharedSkeleton,
    onSkeletonChange: onSkeletonChange,
    invalidate: invalidate,
    canonicalize: canonicalize,
    getCanonicalReference: getCanonicalReference,
    ensureCanonicalJoints: ensureCanonicalJoints,
    updateCanonicalFromGhost: updateCanonicalFromGhost,
    syncCanonicalPose: syncCanonicalPose,
    update: update,
    getJoint: getJoint,
    getCanonicalGroup: getCanonicalGroup,
    getCanonicalInfo: getCanonicalInfo,
    detectMisplacedFingers: detectMisplacedFingers,
    checkFingerWarnings: checkFingerWarnings,
    fixMisplacedFingers: fixMisplacedFingers,
    GROUP_NAME: GROUP_NAME,
    FINGER_DY_WARN_M: FINGER_DY_WARN_M,
    EPS_MM: EPS_MM,
    _test: {
      stripName: stripName,
      findSkeleton: _findSkeleton,
      collectBones: _collectBones,
      canonicalize: canonicalize,
      ghostData: _ghostData,
      modelCenterX: _modelCenterX,
      cache: _cache,
      canonical: _canonical,
      bindBus: _bindBus,
      wrapRender: _wrapRender
    }
  };

  PS.ArpSharedSkeleton = ArpSharedSkeleton;

  try { _bindBus(); } catch (e) {}
  try { _wrapRender(); } catch (e) {}
  /* Bus/render có thể chưa sẵn lúc load (thứ tự script) — các API
     public tự bind lại khi gọi (xem getSharedSkeleton không bind;
     bind lại ở đây khi VP/bus xuất hiện muộn qua lần gọi sau). */
  try {
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () { _bindBus(); _wrapRender(); });
    }
  } catch (e) {}
})();
