/* ============================================================
 * rig/arp-vp-skeleton.js — PHẦN 1: Hiển thị Skeleton/Bones
 * trong viewport, MẶC ĐỊNH BẬT sau khi rig
 * (vòng mở rộng Viewport của Auto Rig Pro Blend)
 *
 * VẤN ĐỀ GỐC (đo được, không đoán):
 *  • AutoRigPro.buildSkeleton() CÓ tạo THREE.SkeletonHelper và
 *    add vào target — nhưng đó chỉ là LineSegments 1px, màu
 *    xanh lá/xanh dương theo vertexColors, depthTest=false.
 *    Helper KHÔNG tự cập nhật theo pose: nó chỉ đổi đỉnh khi
 *    updateMatrixWorld() của chính nó chạy, và viewport KHÔNG
 *    gọi helper.update() mỗi frame — khi phát clip, đường xương
 *    đứng yên ở T-pose trong lúc nhân vật đã cử động.
 *  • Quick Rig tạo SkeletonHelper nhưng KHÔNG add vào scene:
 *    helper chỉ nằm trong RigAutoGen.current.helper
 *    (js/rig/arp-quickrig.js ~dòng 724) → user không thấy gì.
 *  • THREE.LineBasicMaterial.linewidth bị WebGL bỏ qua (luôn
 *    1px) nên không thể "làm xương dày" bằng linewidth.
 *
 * CÁCH MODULE NÀY HIỂN THỊ (đã chọn, ghi rõ giới hạn):
 *  • Xương = CYLINDER MỎNG (Mesh, MeshBasicMaterial,
 *    depthTest:false, renderOrder cao) nối từng cặp xương
 *    cha → con. Cylinder là CON của xương cha, đặt theo
 *    offset local (không đổi) của xương con nên TỰ ĐI THEO
 *    pose/animation mà KHÔNG cần update mỗi frame.
 *  • Khớp = HÌNH CẦU NHỎ (SphereGeometry) đặt tại gốc mỗi
 *    xương, cũng là con của xương đó nên tự đi theo pose.
 *  • ĐỒNG BỘ BONE SHAPE (vòng Bone Shape 2026-11-27): khi tạo hình,
 *    module đọc PixiStudio.ArpBoneShape.getShapeForBone() — xương nào
 *    đã custom trong tab Bone Shape thì dùng đúng hình/màu/opacity/
 *    khớp đó, xương chưa custom thì giữ nguyên cylinder + khớp cầu
 *    mặc định trên; event 'boneshape:changed' → refresh() dựng lại.
 *    Chỉ phần TẠO HÌNH đọc Bone Shape; logic update/event/visibility
 *    của module này không đổi.
 *  • SkeletonHelper có sẵn (nếu có) sẽ bị ẨN khi layer này
 *    BẬT — tránh đường 1px đứng yên ở T-pose gây rối — và
 *    được KHÔI PHỤC đúng trạng thái cũ khi layer TẮT.
 *  • Giới hạn: cylinder là hình trụ thẳng giữa 2 khớp, không
 *    cong theo xương (xương người vốn thẳng từng đoạn nên
 *    chấp nhận được); độ dày là bán kính tuyệt đối theo mét,
 *    không scale theo độ dài xương; với skeleton cực lớn/nhỏ
 *    thì chỉnh jointSize/thickness cho hợp mắt.
 *
 * HÀNH VI MẶC ĐỊNH (yêu cầu bắt buộc):
 *  • Sau khi rig xong (Smart Rig now / Quick Rig convert /
 *    Auto Gen / Auto Gen Mixamo), skeleton TỰ HIỆN — module
 *    lắng nghe event thống nhất 'arp:rig-complete' (được emit
 *    thêm 1 dòng tại 4 điểm rig xong) + 4 event cũ
 *    ('autorigpro:done', 'arpquickrig:converted',
 *    'arpquickrig:autogen-done', 'arpquickrig:mixamo-done')
 *    để tương thích file cũ. Không cần user bật tay.
 *
 * TÙY CHỌN: độ dày xương (thin/medium/thick), màu theo nhóm
 * (cột sống / trái / phải), kích thước khớp cầu, bật/tắt nhanh
 * bằng 1 nút (viewport toolbar + hàng trạng thái trong panel
 * ARP) và phím tắt 'B'. Phím 'B' còn trống: kiểm tra trong
 * js/ui/shortcuts.js + js/viewport/interaction.js — 'K' đã
 * dùng (add keyframe), 'W/E/R/Q' gizmo, 'F' focus, 'G' grid,
 * 'X' wireframe, 'O' ortho, 'C' follow, 'S' chỉ dùng ở trang
 * mesh2motion (m2m-ui.js), không dùng ở studio chính.
 * Khi chưa có rig: show() trả {ok:false, reason:'no-skeleton'}
 * + notify + statusText() = "chưa có skeleton — hãy rig trước".
 *
 * DEFENSIVE: bus / Viewport / ArpViewport (registry, PHẦN 5)
 * đều resolve LAZY tại thời điểm gọi; thiếu cái nào thì bỏ qua
 * êm, không throw. Registry chưa có lúc load thì chỉ expose
 * API PixiStudio.ArpVpSkeleton.show()/hide()/isVisible() để
 * toolbar/preset gọi; khi registry xuất hiện thì tự đăng ký
 * layer 'skeleton' ở lần gọi sau. Module KHÔNG tự sửa
 * index.html — coordinator gộp script tag sau.
 *
 * API: PixiStudio.ArpVpSkeleton
 *   show(target?) / hide() / toggle() / isVisible()
 *   autoShow(target?) — tự hiện sau rig/load, tôn trọng cờ tắt-tay
 *     trong-phiên-cho-đúng-model (xem _manualHiddenFor)
 *   hideManual() / refresh() / clear() / getStatus() / getState()
 *   (alias getStatus) / statusText()
 *   renderStatus(el) / syncPanelRow() / syncToolbarButton()
 *   setThickness(v) / setJointSize(v) / setColor(group, hex)
 *   setAutoShow(b) / getSettings() / getBoneCount() / init()
 *   VIEW2: setGroupVisible(g, on) / getGroupVisibility() / getGroups()
 *   setXrayEnabled(on) / toggleXray() / isXrayEnabled() / getXrayState()
 *
 * SỬA VÒNG 1 (2026-11-27, nhóm Target resolution): _findSkeleton hợp
 * nhất skeleton.bones + traverse (FBX Mixamo thật: 34 → 41 xương);
 * _resolveTarget ưu tiên selection → Models.current → Anim.target
 * thay vì getMainModel() đầu tiên; autoShow() + cờ _manualHiddenFor
 * tách "tắt tay trong phiên" khỏi "visible:false đã lưu".
 *
 * MỞ RỘNG VIEW2 (2026-11-27, ưu tiên 4 — nhóm xương + X-ray):
 *  • Nhóm xương: mỗi part (khớp cầu / đoạn xương) mang
 *    userData.vpGroup ∈ spine|head|arm-left|arm-right|leg-left|
 *    leg-right|fingers|other (xem _groupOf); setGroupVisible()
 *    ẩn/hiện từng nhóm, trạng thái nhóm lưu localStorage cùng
 *    _settings.groups; _setPartsVisible(true) tôn trọng nhóm.
 *  • X-ray: KHÔNG tự làm mờ mesh — dùng sẵn chế độ shading 'xray'
 *    của viewport.js (State 'shading' + Viewport.applyShading, vốn
 *    đã bỏ qua mesh isBoneVisual): setXrayEnabled(true) chuyển
 *    shading sang 'xray' (nhớ chế độ cũ để khôi phục), false thì
 *    trả về chế độ cũ (mặc định 'lit' khi không nhớ được). Layer
 *    'xray' do toolbar đăng ký (adapter, theo mẫu markers/ghost/
 *    grid/helpers) — module này chỉ expose setXrayEnabled /
 *    isXrayEnabled, KHÔNG tự đăng ký layer (để harness skeleton
 *    đếm đúng 1 lần registerLayer 'skeleton').
 *    GIỚI HẠN: applyShading không trả material.transparent về
 *    false khi rời xray (chỉ opacity khôi phục) — mesh vẫn hiển thị
 *    đúng (opacity 1) nhưng cờ transparent còn true; không sửa
 *    viewport.js ở vòng này.
 * ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'pixistudio.arp-vp-skeleton';
  var NO_SKELETON_MSG = 'chưa có skeleton — hãy rig trước';
  var SHORTCUT_KEY = 'b'; /* 'B' — đã kiểm tra còn trống ở studio chính */

  /* Độ dày xương (bán kính cylinder, mét) + khớp cầu mặc định.
     FIX2 — đo thật trên trình duyệt (Thiếu Lâm 41 xương, FOV 38°,
     cam 4.99m, canvas 880×548: 159 px/m): mặc định cũ medium
     0.0055 → thân xương chỉ 1.5px, khớp 0.012 → 3.9px — thấy được
     nhưng chìm giữa mesh có texture. Chuẩn đích: ở khoảng cách
     fit ~3.5m, viewport cao 720px (299 px/m) thì thân ≥5px, khớp
     ≥12px → thick 0.011 (đường kính 6.6px) + khớp 0.022 (13.1px),
     và mặc định dùng 'thick'. */
  var THICKNESS_RADIUS = { thin: 0.004, medium: 0.007, thick: 0.011 };
  var DEFAULT_COLORS = { spine: 0xffb020, left: 0x2fa8ff, right: 0xff4d6d };
  var SPINE_NAMES = {
    Hips: 1, Spine: 1, Spine1: 1, Spine2: 1, Chest: 1,
    Neck: 1, Neck1: 1, Head: 1, HeadTopEnd: 1
  };

  /* VIEW2 — nhóm xương hiển thị (thứ tự kiểm tra trong _groupOf
     quan trọng: ngón trước (tên ngón chứa Thumb/Index/...), đầu
     trước cột sống (Head/Neck), rồi trái/phải theo chi. */
  var GROUP_ORDER = ['spine', 'head', 'arm-left', 'arm-right', 'leg-left', 'leg-right', 'fingers', 'other'];
  var GROUP_LABELS = {
    spine: 'Cột sống', head: 'Đầu', 'arm-left': 'Tay trái', 'arm-right': 'Tay phải',
    'leg-left': 'Chân trái', 'leg-right': 'Chân phải', fingers: 'Ngón tay/chân', other: 'Khác'
  };

  var _settings = {
    visible: true,      /* mặc định BẬT sau khi rig */
    autoShow: true,     /* tự hiện khi nhận event rig-complete */
    thickness: 'thick', /* FIX2: mặc định dày nhất cho dễ thấy (xem THICKNESS_RADIUS) */
    jointSize: 0.022,   /* bán kính khớp cầu, mét — FIX2: 0.012 → 0.022 (≥12px ở fit 3.5m / cao 720px) */
    colors: { spine: DEFAULT_COLORS.spine, left: DEFAULT_COLORS.left, right: DEFAULT_COLORS.right },
    groups: { spine: true, head: true, 'arm-left': true, 'arm-right': true, 'leg-left': true, 'leg-right': true, fingers: true, other: true }
  };

  var _state = {
    target: null,       /* model group đang hiển thị skeleton */
    rootBone: null,
    bones: [],          /* Bone[] */
    parts: [],          /* Mesh (cylinder + sphere) đã tạo */
    helpers: [],        /* { helper, wasVisible } — SkeletonHelper có sẵn, bị ẩn tạm */
    boneCount: 0,
    visible: false,
    height: 1.8
  };

  var _busBound = false;
  var _keyBound = false;
  var _registered = false;
  var _toolbarBtn = null;
  var _panelRow = null;
  var _fingerBtn = null; /* VÒNG ĐỒNG BỘ: nút sửa ngón lệch trong file gốc */
  /* FIX persisted-state (ARP View vòng 1): "user đã tắt tay" được tách
   * khỏi "state khôi phục từ lần trước" bằng cờ IN-MEMORY này — uuid
   * của model mà user đã tắt skeleton BẰNG TAY (nút toolbar / phím B /
   * nút panel, tức qua toggle()) TRONG PHIÊN HIỆN TẠI. Chỉ hide()
   * manual mới ghi cờ; hide() từ preset/registry/Animator (vd nút
   * "Ẩn tất cả") KHÔNG ghi — nên rig lại / load model mới sau "Ẩn
   * tất cả" vẫn tự hiện lại. _settings.visible đã lưu ở localStorage
   * từ phiên trước KHÔNG còn chặn auto-show (reload trang → cờ trống
   * → model mới load auto-show như mặc định). */
  var _manualHiddenFor = null; /* uuid model đã tắt tay trong phiên, hoặc null */
  var _nextHideManual = false; /* toggle() đặt trước khi gọi hide() */
  /* VIEW2 — X-ray: chế độ shading trước khi bật xray (để khôi phục
     khi tắt); enabled là cờ của module, trạng thái thật đọc từ
     State.get('shading') === 'xray' (xem _isXrayEnabled). */
  var _xray = { enabled: false, prevShading: null };

  /* ---------- helpers ---------- */
  function _PS() {
    try {
      if (typeof window !== 'undefined' && window.PixiStudio) return window.PixiStudio;
      if (typeof PixiStudio !== 'undefined') return PixiStudio;
    } catch (e) {}
    return null;
  }
  function _bus() {
    var PS = _PS();
    return (PS && PS.bus) || null;
  }
  function _THREE() {
    try {
      if (typeof window !== 'undefined' && window.THREE) return window.THREE;
      if (typeof THREE !== 'undefined') return THREE;
    } catch (e) {}
    return null;
  }
  function _ls() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) {}
    return null;
  }
  function _notify(type, title, message) {
    try {
      var bus = _bus();
      if (bus && bus.emit) bus.emit('notify', { type: type, title: title, message: message });
    } catch (e) {}
  }
  function _loadSettings() {
    var ls = _ls();
    if (!ls) return;
    try {
      var raw = ls.getItem(STORAGE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return;
      if (typeof s.visible === 'boolean') _settings.visible = s.visible;
      if (typeof s.autoShow === 'boolean') _settings.autoShow = s.autoShow;
      if (THICKNESS_RADIUS[s.thickness] !== undefined) _settings.thickness = s.thickness;
      if (typeof s.jointSize === 'number' && s.jointSize > 0.001 && s.jointSize < 0.1) _settings.jointSize = s.jointSize;
      if (s.colors && typeof s.colors === 'object') {
        ['spine', 'left', 'right'].forEach(function (g) {
          if (typeof s.colors[g] === 'number') _settings.colors[g] = s.colors[g];
        });
      }
      if (s.groups && typeof s.groups === 'object') {
        GROUP_ORDER.forEach(function (g) {
          if (typeof s.groups[g] === 'boolean') _settings.groups[g] = s.groups[g];
        });
      }
    } catch (e) {}
  }
  function _saveSettings() {
    var ls = _ls();
    if (!ls) return;
    try {
      ls.setItem(STORAGE_KEY, JSON.stringify({
        visible: _settings.visible, autoShow: _settings.autoShow,
        thickness: _settings.thickness, jointSize: _settings.jointSize,
        colors: _settings.colors, groups: _settings.groups
      }));
    } catch (e) {}
  }
  _loadSettings();

  /* Bóc prefix tên xương: 'mixamorig:LeftArm', 'Model:mixamorig:Hips',
   * 'mixamorigHips' (FBXLoader làm mất ':'), '__proxy' (xương giả Mixamo). */
  function _stripName(name) {
    var n = String(name || '');
    n = n.replace(/^.*:/, '');                 /* bóc mọi prefix 'X:' */
    n = n.replace(/^mixamorig/i, '');          /* 'mixamorigHips' */
    n = n.replace(/__proxy.*$/i, '');
    return n;
  }
  /* Nhóm màu của 1 xương: 'spine' | 'left' | 'right'. */
  function _classifyBone(bone) {
    var n = _stripName(bone && bone.name);
    if (SPINE_NAMES[n]) return 'spine';
    if (/^left/i.test(n) || /left/i.test(n)) return 'left';
    if (/^right/i.test(n) || /right/i.test(n)) return 'right';
    return 'spine'; /* xương giữa không tên trái/phải → màu cột sống */
  }
  function _colorOf(group) {
    var c = _settings.colors[group];
    return (typeof c === 'number') ? c : DEFAULT_COLORS[group] || 0xffffff;
  }
  /* VIEW2 — nhóm hiển thị của 1 xương (tên đã strip). Thứ tự:
     ngón (Thumb/Index/Middle/Ring/Pinky/Finger) → đầu (Head/Neck)
     → cột sống (Hips/Spine/Chest) → chi trái/phải (chân trước tay
     sau trong mỗi bên) → other (twist/prop/xương lạ). */
  function _groupOf(bone) {
    var n = _stripName(bone && bone.name);
    if (/thumb|index|middle|ring|pinky|finger/i.test(n)) return 'fingers';
    if (/^(head|neck)/i.test(n)) return 'head';
    if (/^(hips|spine|chest)/i.test(n)) return 'spine';
    if (/^left/i.test(n)) {
      if (/^(leftupleg|leftleg|leftfoot|lefttoebase|lefttoe_end|leftankle)/i.test(n)) return 'leg-left';
      return 'arm-left';
    }
    if (/^right/i.test(n)) {
      if (/^(rightupleg|rightleg|rightfoot|righttoebase|righttoe_end|rightankle)/i.test(n)) return 'leg-right';
      return 'arm-right';
    }
    return 'other';
  }
  function _isGroupVisible(g) {
    return _settings.groups[g] !== false; /* nhóm lạ chưa lưu → hiện */
  }

  /* ---------- đồng bộ hình xương với Bone Shape (vòng Bone Shape) ----------
   * VP skeleton KHÔNG vẽ riêng 1 bộ hình khác: khi tạo hình xương, đọc
   * spec từ PixiStudio.ArpBoneShape.getShapeForBone(boneName) — chỉ
   * dùng khi xương đó đã được custom trong Bone Shape (customized),
   * còn không thì fallback đúng hình mặc định cũ của VP (cylinder +
   * khớp cầu theo nhóm màu). Chỉ chạm phần TẠO HÌNH (geometry/
   * material); logic update/event/visibility giữ nguyên. */
  function _boneShapeSpec(bone) {
    try {
      var PS = _PS();
      var BS = PS && PS.ArpBoneShape;
      if (!BS || typeof BS.getShapeForBone !== 'function') return null;
      var spec = BS.getShapeForBone(bone && bone.name);
      if (!spec || !spec.customized) return null;
      return spec;
    } catch (e) { return null; }
  }
  function _segmentGeometry(type, radius, len) {
    var THREE = _THREE();
    if (!THREE) return null;
    if (type === 'box') return new THREE.BoxGeometry(radius * 2, len, radius * 2);
    if (type === 'sphere') return new THREE.SphereGeometry(1, 12, 10);
    if (type === 'octahedron' || type === 'diamond') return new THREE.OctahedronGeometry(1, 0);
    if (type === 'cone') return new THREE.ConeGeometry(radius, len, 10);
    return new THREE.CylinderGeometry(radius, radius, len, 8, 1);
  }
  function _jointGeometry(style, r) {
    var THREE = _THREE();
    if (!THREE) return null;
    if (style === 'box') return new THREE.BoxGeometry(r * 2, r * 2, r * 2);
    if (style === 'octahedron') return new THREE.OctahedronGeometry(r, 0);
    return new THREE.SphereGeometry(r, 12, 10);
  }

  /* ---------- tìm skeleton trong target ---------- */
  function _collectBones(target) {
    var bones = [];
    if (!target || !target.traverse) return bones;
    target.traverse(function (o) { if (o && o.isBone) bones.push(o); });
    return bones;
  }
  /* Leo từ 1 object bất kỳ lên ancestor gần nhất có xương (chính nó
   * nếu đã có; vd selection đang là 1 SkinnedMesh — xương là sibling,
   * traverse từ mesh không thấy — hoặc 1 xương con). DỪNG ở modelRoot:
   * không bao giờ leo lên modelRoot/scene (traverse từ đó sẽ thấy
   * xương của model KHÁC). Trả null nếu leo tới đỉnh model vẫn
   * không thấy xương nào. */
  function _climbToRigged(obj) {
    var PS = _PS();
    var root = null;
    try { root = PS && PS.Viewport && PS.Viewport.modelRoot; } catch (e) {}
    var o = obj, guard = 0;
    while (o && guard < 64) {
      if (o.isScene || (root && o === root)) return null; /* đã leo khỏi model */
      if (_collectBones(o).length) return o;
      o = o.parent;
      guard++;
    }
    return null;
  }
  function _findSkeleton(target) {
    if (!target) return null;
    var THREE = _THREE();
    if (!THREE) return null;
    /* FIX (ARP View vòng 1, 2026-11-27): trước đây ƯU TIÊN
     * SkinnedMesh.skeleton.bones — với FBX Mixamo/Thiếu Lâm thật,
     * skeleton.bones chỉ có 34 xương (thiếu 3 *_End + 4 đầu ngón tay
     * không có skin weight nên FBXLoader không đưa vào skeleton),
     * trong khi traverse thấy đủ 41. Nay HỢP NHẤT cả 2 nguồn (khử
     * trùng theo uuid): xương nào chỉ có ở 1 nguồn vẫn được hiển thị.
     * Đo trên trình duyệt thật: show(fbxObject) 34 → 41 xương. */
    var skel = null;
    target.traverse(function (o) {
      if (!skel && o && o.isSkinnedMesh && o.skeleton && o.skeleton.bones && o.skeleton.bones.length) {
        skel = o.skeleton;
      }
    });
    var bones = [];
    var seen = {};
    function _push(b) {
      if (b && b.isBone && !seen[b.uuid]) { seen[b.uuid] = true; bones.push(b); }
    }
    if (skel && skel.bones) skel.bones.forEach(_push);
    _collectBones(target).forEach(_push);
    if (!bones.length) return null;
    /* Root = xương có tên Hips, nếu không thì xương không có cha là Bone. */
    var root = null;
    for (var i = 0; i < bones.length; i++) {
      if (_stripName(bones[i].name) === 'Hips') { root = bones[i]; break; }
    }
    if (!root) {
      for (var j = 0; j < bones.length; j++) {
        if (!bones[j].parent || !bones[j].parent.isBone) { root = bones[j]; break; }
      }
    }
    if (!root) root = bones[0];
    return { rootBone: root, bones: bones, skeleton: skel };
  }
  /* Đo chiều cao model (cho stub xương lá) — Box3, fallback 1.8m. */
  function _measureHeight(target) {
    var THREE = _THREE();
    if (!THREE || !target) return 1.8;
    try {
      var box = new THREE.Box3().setFromObject(target);
      var h = box.max.y - box.min.y;
      if (isFinite(h) && h > 0.05 && h < 50) return h;
    } catch (e) {}
    return 1.8;
  }
  /* Resolve target hiển thị.
   * FIX (ARP View vòng 1): thứ tự cũ đặt Viewport.getMainModel() ĐẦU
   * TIÊN — mà getMainModel() trả về child visible đầu tiên của
   * modelRoot (model mẫu Hero_001 Sample, 0 xương) nên show() không
   * đối số luôn báo 'no-skeleton' sau khi import FBX rigged. Thứ tự
   * mới: đối số → target đã lưu (đã rig thành công) → State.selection
   * (model vừa import được registerModel chọn sẵn; leo lên ancestor
   * có xương khi selection là mesh/xương con) → Models.current
   * (mới import nhất) → Anim.targetObject (FBX vừa load, app.js set)
   * → RigAutoGen/QuickRig current → AutoRigPro lastResult →
   * getMainModel() (nay đã sửa tập trung ở viewport.js, chỉ còn là
   * fallback cuối). QUY TẮC: ứng viên ĐẦU TIÊN có mặt thì thắng (leo
   * lên ancestor có xương; leo không được thì trả chính nó để show()
   * báo "chưa có rig" trung thực) — CHỈ ứng viên vắng (null) mới rơi
   * xuống ứng viên sau; nếu không, khi user chọn model chưa rig thì
   * skeleton sẽ bám nhầm vào rig cũ của model khác. */
  function _resolveTarget(arg) {
    if (arg && arg.traverse) { var c0 = _climbToRigged(arg); if (c0) return c0; return arg; }
    if (arg && arg.isBone) return arg; /* truyền thẳng rootBone cũng được */
    /* VÒNG ĐỒNG BỘ SKELETON (2026-11-27): 1 thứ tự resolve duy nhất
       cho mọi module (ArpSharedSkeleton.resolveTarget) — selection →
       Models.current → Anim.targetObject → QuickRig/RigAutoGen →
       getMainModel() → AutoRigPro.lastResult. Chỉ khi module chia sẻ
       vắng mới rơi xuống chain cũ của module này. */
    try {
      var PS0 = _PS();
      var SH0 = PS0 && PS0.ArpSharedSkeleton;
      if (SH0 && typeof SH0.resolveTarget === 'function') {
        var shared = SH0.resolveTarget(null);
        if (shared) { var cS = _climbToRigged(shared); return cS || shared; }
      }
    } catch (e) {}
    if (_state.target && _state.target.traverse) return _state.target;
    var PS = _PS();
    if (PS) {
      try {
        if (PS.State && PS.State.get) {
          var sel = PS.State.get('selection');
          if (sel) { var cSel = _climbToRigged(sel); return cSel || sel; }
        }
      } catch (e) {}
      try {
        if (PS.Models && typeof PS.Models.getCurrent === 'function') {
          var cur = PS.Models.getCurrent();
          if (cur && cur.object3D) { var cCur = _climbToRigged(cur.object3D); return cCur || cur.object3D; }
        }
      } catch (e) {}
      try {
        if (PS.Anim && PS.Anim.targetObject) {
          var cAnim = _climbToRigged(PS.Anim.targetObject);
          return cAnim || PS.Anim.targetObject;
        }
      } catch (e) {}
      try {
        if (PS.Viewport && PS.Viewport.getMainModel) {
          var m = PS.Viewport.getMainModel();
          if (m && m.traverse) { var cMain = _climbToRigged(m); return cMain || m; }
        }
      } catch (e) {}
      try {
        if (PS.RigAutoGen && PS.RigAutoGen.current && PS.RigAutoGen.current.target) return PS.RigAutoGen.current.target;
      } catch (e) {}
      try {
        if (PS.ArpQuickRig && PS.ArpQuickRig.current && PS.ArpQuickRig.current.target) return PS.ArpQuickRig.current.target;
      } catch (e) {}
      try {
        if (PS.AutoRigPro && PS.AutoRigPro.lastResult && PS.AutoRigPro.lastResult.rig &&
            PS.AutoRigPro.lastResult.rig.rootBone) return PS.AutoRigPro.lastResult.rig.rootBone;
      } catch (e) {}
    }
    return null;
  }

  /* ---------- dựng / dọn display ---------- */
  function _clearParts() {
    _state.parts.forEach(function (p) {
      try { if (p.parent) p.parent.remove(p); } catch (e) {}
      try { if (p.geometry) p.geometry.dispose(); } catch (e) {}
      try { if (p.material) p.material.dispose(); } catch (e) {}
    });
    _state.parts = [];
    /* Khôi phục SkeletonHelper có sẵn về trạng thái cũ. */
    _restoreHelpers();
    _state.helpers = [];
  }
  /* Ẩn SkeletonHelper có sẵn trong target (đường 1px đứng yên ở
   * T-pose khi phát clip) — ghi lại trạng thái để khôi phục. */
  function _hideExistingHelpers(target) {
    if (!target || !target.traverse) return;
    target.traverse(function (o) {
      if (o && o.isSkeletonHelper) {
        _state.helpers.push({ helper: o, wasVisible: !!o.visible });
        try { o.visible = false; } catch (e) {}
      }
    });
  }
  /* Ẩn lại các helper đã ghi (khi show() dùng lại part cũ, không dựng lại). */
  function _hideRecordedHelpers() {
    _state.helpers.forEach(function (h) {
      try { h.helper.visible = false; } catch (e) {}
    });
  }
  /* Khôi phục helper về trạng thái trước khi layer bật (khi hide()/clear()). */
  function _restoreHelpers() {
    _state.helpers.forEach(function (h) {
      try { h.helper.visible = h.wasVisible; } catch (e) {}
    });
  }
  /* VÒNG ĐỒNG BỘ SKELETON (2026-11-27): tập hiển thị = KHỚP CHUẨN
   * (canonical — bộ trái/ghost làm chuẩn, đã mirror + căn Hips về
   * Hips thật) thay vì xương thật. Nhờ đó VP skeleton / select /
   * labels / IK / Animator đều hiện CÙNG 1 hierarchy, gắn vào model
   * root qua attach() nên tự theo model (dời/xoay/scale), pose sync
   * mỗi frame theo xương thật cùng tên. Fallback xương thật khi
   * module chia sẻ chưa load hoặc chưa có khớp chuẩn. */
  function _displayFound(target) {
    try {
      var PS = _PS();
      var SH = PS && PS.ArpSharedSkeleton;
      if (SH && typeof SH.ensureCanonicalJoints === 'function') {
        var r = SH.ensureCanonicalJoints(target);
        if (r && r.ok && r.joints) {
          var names = Object.keys(r.joints);
          if (names.length) {
            var list = names.map(function (n) { return r.joints[n]; });
            var root = r.joints.Hips || list[0];
            return { rootBone: root, bones: list, skeleton: null, canonical: true, mode: r.mode };
          }
        }
      }
    } catch (e) {}
    return _findSkeleton(target);
  }
  function _buildDisplay(target, found) {
    var THREE = _THREE();
    if (!THREE) return { ok: false, reason: 'no-three' };
    _clearParts();
    _state.target = target;
    _state.rootBone = found.rootBone;
    _state.bones = found.bones;
    _state.boneCount = found.bones.length;
    _state.height = _measureHeight(target);
    _hideExistingHelpers(target);

    var radius = THICKNESS_RADIUS[_settings.thickness] || THICKNESS_RADIUS.medium;
    var jointR = _settings.jointSize;
    var stubLen = Math.max(0.03, _state.height * 0.03);
    var up = new THREE.Vector3(0, 1, 0);
    var cylCount = 0, jointCount = 0;

    var boneSet = {};
    found.bones.forEach(function (b) { boneSet[b.uuid] = b; });

    found.bones.forEach(function (bone) {
      var group = _classifyBone(bone);
      var vpGroup = _groupOf(bone); /* VIEW2: nhóm hiển thị của xương này */
      var color = _colorOf(group);
      var spec = _boneShapeSpec(bone); /* null = chưa custom → mặc định VP */
      /* --- khớp cầu tại gốc xương (hình/cỡ/màu theo Bone Shape nếu có) --- */
      var jointColor = color;
      var jointR2 = jointR;
      var jointGeo = null;
      if (spec) {
        if (typeof spec.jointColor === 'number') jointColor = spec.jointColor;
        else if (typeof spec.color === 'number') jointColor = spec.color;
        if (spec.jointSize) jointR2 = jointR * spec.jointSize;
        jointGeo = _jointGeometry(spec.jointStyle, jointR2);
      }
      try {
        var jm = new THREE.Mesh(
          jointGeo || new THREE.SphereGeometry(jointR, 12, 10),
          new THREE.MeshBasicMaterial({ color: jointColor, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false })
        );
        jm.name = '__arp_vp_joint_' + _stripName(bone.name);
        jm.userData.isArpVpSkeleton = true;
        jm.userData.vpGroup = vpGroup; /* VIEW2: nhóm hiển thị */
        /* Quy ước repo: mesh trang trí của xương PHẢI có isBoneVisual để
           FBXBinary.write / GLBWriter / MixamoSafeExport bỏ qua — nếu không
           file FBX export sẽ chứa 94 mesh cầu/trụ thừa (đã đo: report.meshes
           95 thay vì 1). Xem test-arp-vp-export-clean.js. */
        jm.userData.isBoneVisual = true;
        jm.frustumCulled = false;
        jm.renderOrder = 999;
        bone.add(jm);
        _state.parts.push(jm);
        jointCount++;
      } catch (e) {}
      /* --- cylinder tới từng xương con (hoặc stub nếu là lá) ---
         VÒNG ĐỒNG BỘ: con của khớp chuẩn là Object3D thường
         (userData.isCanonicalJoint), không phải isBone — chấp nhận cả 2. */
      var kids = (bone.children || []).filter(function (c) { return c && (c.isBone || (c.userData && c.userData.isCanonicalJoint)); });
      var segs = [];
      kids.forEach(function (kid) {
        segs.push({ dir: kid.position.clone(), len: kid.position.length(), child: kid });
      });
      if (!segs.length) segs.push({ dir: new THREE.Vector3(0, -1, 0), len: stubLen });
      segs.forEach(function (seg) {
        if (!seg.len || seg.len < 1e-6) return;
        try {
          var dirN = seg.dir.clone().normalize();
          /* Hình/màu/opacity đoạn xương theo Bone Shape nếu xương đã
             custom; chưa custom → cylinder mặc định như trước. */
          var segColor = (spec && typeof spec.color === 'number') ? spec.color : color;
          var segOpacity = (spec && typeof spec.opacity === 'number') ? spec.opacity : 0.9;
          var segRadius = radius * ((spec && spec.thickness) ? spec.thickness : 1);
          var segType = spec ? spec.type : 'cylinder';
          var cm = new THREE.Mesh(
            _segmentGeometry(segType, segRadius, seg.len),
            new THREE.MeshBasicMaterial({ color: segColor, depthTest: false, transparent: true, opacity: segOpacity, toneMapped: false })
          );
          /* Geometry unit (sphere/octahedron/diamond) thì scale theo
             đoạn xương; geometry đã sized sẵn thì chỉ áp width. */
          if (segType === 'sphere' || segType === 'octahedron' || segType === 'diamond') {
            cm.scale.set(segRadius, seg.len / 2, segRadius);
          } else if (spec && spec.width && spec.width !== 1) {
            cm.scale.set(spec.width, 1, 1);
          }
          cm.name = '__arp_vp_bone_' + _stripName(bone.name);
          cm.userData.isArpVpSkeleton = true;
          /* VIEW2: đoạn tới xương ngón thuộc nhóm fingers, đoạn khác
             thuộc nhóm của xương cha; stub lá thuộc nhóm xương lá. */
          cm.userData.vpGroup = (seg.child && _groupOf(seg.child) === 'fingers') ? 'fingers' : vpGroup;
          cm.userData.isBoneVisual = true; /* xem ghi chú ở khớp cầu trên */
          cm.frustumCulled = false;
          cm.renderOrder = 998;
          cm.position.copy(seg.dir).multiplyScalar(0.5);
          cm.quaternion.setFromUnitVectors(up, dirN);
          bone.add(cm);
          _state.parts.push(cm);
          cylCount++;
        } catch (e) {}
      });
    });
    return { ok: true, boneCount: found.bones.length, cylinders: cylCount, joints: jointCount };
  }

  /* ---------- registry chung (PHẦN 5) — defensive, lazy ---------- */
  function _tryRegister() {
    if (_registered) return true;
    try {
      var PS = _PS();
      var reg = PS && PS.ArpViewport;
      if (reg && typeof reg.registerLayer === 'function') {
        reg.registerLayer('skeleton', {
          show: function () { return ArpVpSkeleton.show(); },
          hide: function () { return ArpVpSkeleton.hide(); },
          isVisible: function () { return ArpVpSkeleton.isVisible(); },
          label: 'Skeleton'
        });
        _registered = true;
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* ---------- UI: nút toolbar + hàng trạng thái panel ARP ---------- */
  function _syncToolbarButton() {
    try {
      if (typeof document === 'undefined') return;
      var bar = document.getElementById('viewport-tools');
      if (!bar) return;
      if (!_toolbarBtn) {
        var b = document.createElement('button');
        b.id = 'vp-skeleton-btn';
        b.className = 'vtool';
        b.type = 'button';
        b.textContent = 'Xương';
        b.title = 'Hiện/ẩn skeleton (phím B)';
        b.addEventListener('click', function () { ArpVpSkeleton.toggle(); });
        bar.appendChild(b);
        _toolbarBtn = b;
      }
      var on = _state.visible && _state.boneCount > 0;
      _toolbarBtn.classList.toggle('active', on);
      _toolbarBtn.title = on ? 'Ẩn skeleton (phím B)' : 'Hiện skeleton (phím B) — ' + (_state.boneCount > 0 ? _state.boneCount + ' xương' : NO_SKELETON_MSG);
    } catch (e) {}
  }
  function _syncPanelRow() {
    try {
      if (typeof document === 'undefined') return;
      var body = document.getElementById('arp-tab-body');
      if (!body) return;
      if (!_panelRow || !_panelRow.parentNode) {
        var row = document.createElement('div');
        row.id = 'arp-vp-skeleton-row';
        row.className = 'arp-vp-skeleton-row';
        var span = document.createElement('span');
        span.id = 'arp-vp-skeleton-status';
        var btn = document.createElement('button');
        btn.id = 'arp-vp-skeleton-toggle';
        btn.type = 'button';
        btn.textContent = 'Hiện/ẩn xương (B)';
        btn.addEventListener('click', function () { ArpVpSkeleton.toggle(); });
        row.appendChild(span);
        row.appendChild(btn);
        /* VÒNG ĐỒNG BỘ: nút sửa ngón lệch trong file gốc (hiện chỉ
           khi có cảnh báo) — mặc định giữ nguyên, bấm mới sửa. */
        var fbtn = document.createElement('button');
        fbtn.id = 'arp-vp-skeleton-fix-fingers';
        fbtn.type = 'button';
        fbtn.textContent = 'Sửa ngón phải lệch';
        fbtn.title = 'Đưa xương ngón lệch về gần tay (mirror ngón tay trái) — mặc định file gốc được giữ nguyên.';
        fbtn.addEventListener('click', function () {
          try {
            var SH = _PS() && _PS().ArpSharedSkeleton;
            if (!SH || typeof SH.fixMisplacedFingers !== 'function') return;
            var res = SH.fixMisplacedFingers(_state.target);
            if (res && res.ok && res.fixed && res.fixed.length) {
              _notify('success', 'Sửa ngón lệch', 'Đã đưa ' + res.fixed.length + ' xương ngón về gần tay (mirror ngón trái). Mesh không đổi (đã tính lại boneInverses).');
              ArpVpSkeleton.refresh();
            } else if (res && res.ok) {
              _notify('info', 'Sửa ngón lệch', 'Không có xương ngón lệch.');
            }
          } catch (e) {}
          _syncPanelRow();
        });
        row.appendChild(fbtn);
        _fingerBtn = fbtn;
        body.insertBefore(row, body.firstChild);
        _panelRow = row;
      }
      var st = document.getElementById('arp-vp-skeleton-status');
      if (st) st.textContent = ArpVpSkeleton.statusText();
      var tb = document.getElementById('arp-vp-skeleton-toggle');
      if (tb) tb.disabled = _state.boneCount === 0 && !_state.rootBone;
      /* Hiện nút sửa ngón chỉ khi có cảnh báo ngón lệch. */
      if (_fingerBtn) {
        var showFix = false;
        try {
          var SH2 = _PS() && _PS().ArpSharedSkeleton;
          if (SH2 && typeof SH2.detectMisplacedFingers === 'function' && _state.target) {
            var det = SH2.detectMisplacedFingers(_state.target);
            showFix = !!(det && det.ok && det.warnings && det.warnings.length);
            if (showFix) _fingerBtn.textContent = 'Sửa ' + det.warnings.length + ' ngón lệch';
          }
        } catch (e) {}
        _fingerBtn.style.display = showFix ? '' : 'none';
      }
    } catch (e) {}
  }
  /* Toolbar ARP View (#arp-vp-toolbar) chỉ tự refresh khi layer đổi QUA
     registry (onLayerChange); auto-show/show()/hide() trực tiếp bypass
     registry nên nút kẹt ở "off" dù xương đang hiện (thấy trong screenshot
     vp-fix1-b.png). Refresh kèm ở đây để nút luôn đúng trạng thái thật —
     core.isLayerVisible() đọc live layer.isVisible() nên chỉ cần gọi
     refresh, không cần đụng registry. Guarded: toolbar có thể chưa load. */
  function _refreshVpToolbar() {
    try {
      var T = window.PixiStudio && window.PixiStudio.ArpVpToolbar;
      if (T && typeof T.refresh === 'function') T.refresh();
    } catch (e) {}
  }
  function _syncUI() {
    _syncToolbarButton();
    _syncPanelRow();
    _refreshVpToolbar();
  }

  /* ---------- bus: tự hiện khi rig xong ---------- */
  function _onRigComplete(data) {
    try {
      data = data || {};
      var target = data.target || null;
      if (!target && data.rootBone) target = data.rootBone;
      if (!target && data.rig && data.rig.rootBone) target = data.rig.rootBone;
      var resolved = _resolveTarget(target);
      if (!resolved) return;
      if (_settings.autoShow) {
        /* autoShow() tự tôn trọng cờ tắt-tay-trong-phiên: model đã bị
           user tắt tay thì chỉ dựng display ở trạng thái ẩn. */
        var r = ArpVpSkeleton.autoShow(resolved);
        if (!r.ok && r.reason === 'manual-hidden') {
          var found = _displayFound(resolved) || _findSkeleton(resolved);
          if (found) { _buildDisplay(resolved, found); _setPartsVisible(false); _state.visible = false; _syncUI(); }
        }
      } else {
        /* autoShow tắt: chỉ dựng display ở trạng thái ẩn để toggle sau có sẵn. */
        var found2 = _displayFound(resolved) || _findSkeleton(resolved);
        if (found2) { _buildDisplay(resolved, found2); _setPartsVisible(false); _state.visible = false; _syncUI(); }
      }
      _tryRegister();
    } catch (e) {}
  }
  function _bindBus() {
    if (_busBound) return true;
    var bus = _bus();
    if (!bus || typeof bus.on !== 'function') return false;
    try {
      bus.on('arp:rig-complete', _onRigComplete);
      bus.on('autorigpro:done', _onRigComplete);
      bus.on('arpquickrig:converted', _onRigComplete);
      bus.on('arpquickrig:autogen-done', _onRigComplete);
      bus.on('arpquickrig:mixamo-done', _onRigComplete);
      /* VÒNG ĐỒNG BỘ: tự hiện khi load model mới (app.js cũng gọi
         autoShow — gọi 2 lần là idempotent, show() cùng rootBone chỉ
         bật lại part). Trước đây module này KHÔNG nghe model:loaded. */
      bus.on('model:loaded', function (data) {
        try {
          var t = null;
          var PSm = _PS();
          if (data && data.id && PSm && PSm.Models && PSm.Models.models) {
            var entry = PSm.Models.models[data.id];
            if (entry && entry.object3D) t = entry.object3D;
          }
          var r = ArpVpSkeleton.autoShow(t);
          if (!r.ok && r.reason === 'manual-hidden') {
            var found = _displayFound(t) || _findSkeleton(t);
            if (found) { _buildDisplay(t, found); _setPartsVisible(false); _state.visible = false; _syncUI(); }
          }
        } catch (e) {}
      });
      /* Đồng bộ Bone Shape → viewport: đổi hình trong panel Bone Shape
         thì dựng lại hình VP ngay (chỉ gọi refresh() có sẵn; không
         sửa logic update/event/visibility của module này). */
      bus.on('boneshape:changed', function () {
        try { if (_state.rootBone && _state.visible) ArpVpSkeleton.refresh(); } catch (e) {}
      });
      _busBound = true;
      return true;
    } catch (e) { return false; }
  }
  function _bindKeys() {
    if (_keyBound) return;
    try {
      if (typeof document === 'undefined') return;
      document.addEventListener('keydown', function (e) {
        try {
          if (!e || e.ctrlKey || e.metaKey || e.altKey) return;
          var t = e.target;
          var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
          if (typing) return;
          if (e.key === SHORTCUT_KEY || e.key === SHORTCUT_KEY.toUpperCase()) {
            ArpVpSkeleton.toggle();
          }
        } catch (err) {}
      });
      _keyBound = true;
    } catch (e) {}
  }
  function _setPartsVisible(v) {
    _state.parts.forEach(function (p) {
      try {
        /* VIEW2 nhóm xương: bật lại chỉ hiện part thuộc nhóm đang
           bật; tắt thì ẩn hết bất kể nhóm. Part không có vpGroup
           (dựng trước vòng VIEW2) luôn hiện khi bật. */
        p.visible = !!v && (!p.userData || !p.userData.vpGroup || _isGroupVisible(p.userData.vpGroup));
      } catch (e) {}
    });
  }

  /* ---------- VIEW2: X-ray (dùng shading có sẵn của viewport) ----------
   * Bật: State 'shading' → 'xray' (nhớ chế độ cũ để khôi phục);
   * Viewport.applyShading() làm mờ mesh thường còn 0.35, mesh
   * isBoneVisual (xương/khớp/IK/trails...) giữ nguyên 0.9–0.95 nên
   * xương hiện xuyên qua mesh. Tắt: trả shading về chế độ cũ
   * (mặc định 'lit' — giá trị mặc định trong js/core/state.js —
   * khi không nhớ được vì xray được bật từ dropdown shading).
   * Trả `true` khi thành công (quy ước FIX2 cho layer show/hide),
   * {ok:false} khi State chưa sẵn sàng. Không đụng viewport.js. */
  function _setXrayEnabled(on) {
    var PS = _PS();
    var st = PS && PS.State;
    if (!st || typeof st.get !== 'function' || typeof st.set !== 'function') {
      return { ok: false, reason: 'no-state', message: 'PixiStudio.State chưa sẵn sàng — không đổi được chế độ shading.' };
    }
    var cur = null;
    try { cur = st.get('shading'); } catch (e) { cur = null; }
    var shading = 'lit';
    if (on) {
      if (cur !== 'xray') _xray.prevShading = cur;
      _xray.enabled = true;
      shading = 'xray';
      try { st.set('shading', 'xray'); } catch (e) { return { ok: false, reason: 'set-failed' }; }
    } else {
      _xray.enabled = false;
      shading = _xray.prevShading || 'lit';
      _xray.prevShading = null;
      try { st.set('shading', shading); } catch (e) { return { ok: false, reason: 'set-failed' }; }
    }
    /* Ép Viewport áp shading ngay (render loop cũng gọi
       applyShading() mỗi frame, nhưng invalidate để chắc chắn đổi
       ngay cả khi render đang tạm dừng). */
    try {
      var VP = PS && PS.Viewport;
      if (VP) {
        if (typeof VP.invalidateShading === 'function') VP.invalidateShading();
        else VP._shadingDirty = true;
        if (typeof VP.applyShading === 'function') VP.applyShading();
      }
    } catch (e) {}
    _refreshVpToolbar();
    return { ok: true, xray: !!on, shading: shading };
  }
  /* Trạng thái thật: ưu tiên State (user có thể bật xray từ
     dropdown shading ở toolbar chính); State không trả được thì
     dùng cờ của module. */
  function _isXrayEnabled() {
    try {
      var PS = _PS();
      if (PS && PS.State && typeof PS.State.get === 'function') {
        var cur = PS.State.get('shading');
        if (cur === 'xray') return true;
        if (typeof cur === 'string') return false;
      }
    } catch (e) {}
    return !!_xray.enabled;
  }

  /* ---------- API ---------- */
  var ArpVpSkeleton = {};

  ArpVpSkeleton.init = function () {
    _bindBus();
    _bindKeys();
    _tryRegister();
    _syncUI();
    return { ok: true, busBound: _busBound, registered: _registered };
  };

  ArpVpSkeleton.show = function (target) {
    _bindBus();
    _tryRegister();
    var THREE = _THREE();
    if (!THREE) return { ok: false, reason: 'no-three' };
    var resolved = _resolveTarget(target);
    if (!resolved) {
      _syncUI();
      return { ok: false, reason: 'no-target', message: NO_SKELETON_MSG };
    }
    /* Kiểm tra xương THẬT tồn tại (không có rig thì báo trung thực),
       nhưng hiển thị KHỚP CHUẨN (canonical) — xem _displayFound. */
    var realFound = _findSkeleton(resolved);
    if (!realFound || !realFound.bones.length) {
      _notify('warning', 'Skeleton', NO_SKELETON_MSG + ' — model hiện tại chưa có xương.');
      _syncUI();
      return { ok: false, reason: 'no-skeleton', message: NO_SKELETON_MSG };
    }
    var found = _displayFound(resolved) || realFound;
    if (!found || !found.bones.length) found = realFound;
    /* Dựng lại nếu đổi model/root, hoặc lần đầu. */
    if (_state.rootBone !== found.rootBone || !_state.parts.length) {
      var built = _buildDisplay(resolved, found);
      if (!built.ok) return built;
    } else {
      /* Cùng skeleton: chỉ bật lại các part (tránh dựng trùng). */
      _state.target = resolved;
      _hideRecordedHelpers(); /* helper cũ đã khôi phục ở hide() trước đó → ẩn lại */
    }
    _settings.visible = true;
    _state.visible = true;
    /* VÒNG ĐỒNG BỘ: giữ cờ ghost của Smart tab đồng bộ với display
       (nút Ghost trên toolbar đọc ghost.visible; phím B / nút Xương
       đi qua show()/hide() này). Chỉ mirror ở mode ghost. */
    try {
      var PSm = _PS();
      var SHm = PSm && PSm.ArpSharedSkeleton;
      var SMm = PSm && PSm.ArpSmart;
      if (SHm && SMm && SMm.ghost && typeof SHm.getCanonicalInfo === 'function') {
        var infoM = SHm.getCanonicalInfo();
        if (infoM && infoM.mode === 'ghost') SMm.ghost.visible = true;
      }
    } catch (e) {}
    /* Hiện tay (toolbar/B/preset-show) → xóa cờ tắt-tay của model này. */
    if (resolved && resolved.uuid && _manualHiddenFor === resolved.uuid) _manualHiddenFor = null;
    _setPartsVisible(true);
    _saveSettings();
    _syncUI();
    return { ok: true, boneCount: _state.boneCount, target: resolved, rootBone: _state.rootBone };
  };

  /* Tự hiện sau rig/load — KHÁC show(): tôn trọng "user đã tắt tay
   * trong phiên hiện tại" cho ĐÚNG model đó (uuid), nhưng model MỚI
   * (uuid khác) hoặc phiên mới (cờ trống) thì luôn hiện bất chấp
   * _settings.visible đã lưu ở localStorage. app.js (model:loaded)
   * và _onRigComplete dùng hàm này; toolbar/B dùng show()/toggle(). */
  ArpVpSkeleton.autoShow = function (target) {
    _bindBus();
    _tryRegister();
    var resolved = _resolveTarget(target);
    if (!resolved) return { ok: false, reason: 'no-target', message: NO_SKELETON_MSG };
    if (resolved.uuid && _manualHiddenFor === resolved.uuid) {
      return { ok: false, reason: 'manual-hidden', target: resolved };
    }
    return ArpVpSkeleton.show(resolved);
  };

  ArpVpSkeleton.hide = function (opts) {
    /* Chỉ hide() MANUAL (qua toggle() / hideManual()) mới ghi cờ tắt
       tay — hide() từ registry (preset Clean / "Ẩn tất cả") hay từ
       Animator.setDisplay KHÔNG ghi, để rig/load sau vẫn auto-show. */
    var manual = !!((opts && opts.manual) || _nextHideManual);
    _nextHideManual = false;
    if (manual && _state.target && _state.target.uuid) _manualHiddenFor = _state.target.uuid;
    _settings.visible = false;
    _state.visible = false;
    /* VÒNG ĐỒNG BỘ: mirror cờ ghost (chỉ mode ghost) — xem show(). */
    try {
      var PSh = _PS();
      var SHh = PSh && PSh.ArpSharedSkeleton;
      var SMh = PSh && PSh.ArpSmart;
      if (SHh && SMh && SMh.ghost && typeof SHh.getCanonicalInfo === 'function') {
        var infoH = SHh.getCanonicalInfo();
        if (infoH && infoH.mode === 'ghost') SMh.ghost.visible = false;
      }
    } catch (e) {}
    _setPartsVisible(false);
    _restoreHelpers(); /* trả lại SkeletonHelper có sẵn cho user */
    _saveSettings();
    _syncUI();
    return { ok: true, visible: false };
  };

  /* Ẩn tay tường minh (ghi cờ tắt-tay) — dùng khi cần hide() manual
   * mà không qua toggle(). */
  ArpVpSkeleton.hideManual = function () {
    return ArpVpSkeleton.hide({ manual: true });
  };

  ArpVpSkeleton.toggle = function (target) {
    if (ArpVpSkeleton.isVisible()) {
      _nextHideManual = true; /* tắt tay → ghi cờ cho model hiện tại */
      return ArpVpSkeleton.hide();
    }
    return ArpVpSkeleton.show(target);
  };

  ArpVpSkeleton.isVisible = function () {
    return !!(_state.visible && _state.parts.length);
  };

  /* Dựng lại display cho skeleton hiện tại (sau khi đổi màu/dày/khớp). */
  ArpVpSkeleton.refresh = function () {
    if (!_state.rootBone) return { ok: false, reason: 'no-skeleton', message: NO_SKELETON_MSG };
    var wasVisible = _state.visible;
    /* VÒNG ĐỒNG BỘ: dựng lại từ khớp chuẩn hiện tại (canonical có
       thể đã rebuild sau khi đổi model / regenerate ghost). */
    var found = _displayFound(_state.target) || { rootBone: _state.rootBone, bones: _state.bones };
    var built = _buildDisplay(_state.target, found);
    if (!built.ok) return built;
    _setPartsVisible(wasVisible);
    _syncUI();
    return { ok: true, boneCount: _state.boneCount, visible: wasVisible };
  };

  ArpVpSkeleton.clear = function () {
    _clearParts();
    _state.target = null;
    _state.rootBone = null;
    _state.bones = [];
    _state.boneCount = 0;
    _state.visible = false;
    _manualHiddenFor = null;
    _syncUI();
    return { ok: true };
  };

  ArpVpSkeleton.getStatus = function () {
    return {
      hasSkeleton: _state.boneCount > 0,
      boneCount: _state.boneCount,
      visible: ArpVpSkeleton.isVisible(),
      autoShow: !!_settings.autoShow,
      thickness: _settings.thickness,
      jointSize: _settings.jointSize,
      colors: { spine: _settings.colors.spine, left: _settings.colors.left, right: _settings.colors.right },
      registered: _registered,
      busBound: _busBound,
      target: _state.target ? (_state.target.name || '(model)') : null,
      message: _state.boneCount > 0
        ? ('Skeleton: ' + _state.boneCount + ' xương · ' + (ArpVpSkeleton.isVisible() ? 'ĐANG HIỆN' : 'đang ẩn') + ' (phím B để bật/tắt)')
        : NO_SKELETON_MSG
    };
  };

  /* Alias getState (tên mà arp-sync-viewport.js vẫn gọi) — cùng nội
   * dung getStatus(), tránh refreshOverlaysForTime đọc boneCount null. */
  ArpVpSkeleton.getState = ArpVpSkeleton.getStatus;

  ArpVpSkeleton.statusText = function () {
    return ArpVpSkeleton.getStatus().message;
  };

  ArpVpSkeleton.renderStatus = function (el) {
    if (!el) return ArpVpSkeleton.statusText();
    try { el.textContent = ArpVpSkeleton.statusText(); } catch (e) {}
    return ArpVpSkeleton.statusText();
  };

  ArpVpSkeleton.syncPanelRow = function () { _syncPanelRow(); return ArpVpSkeleton.statusText(); };
  ArpVpSkeleton.syncToolbarButton = function () { _syncToolbarButton(); return ArpVpSkeleton.isVisible(); };

  ArpVpSkeleton.setThickness = function (v) {
    if (THICKNESS_RADIUS[v] === undefined) return { ok: false, reason: 'bad-thickness', allowed: Object.keys(THICKNESS_RADIUS) };
    _settings.thickness = v;
    _saveSettings();
    if (_state.rootBone) return ArpVpSkeleton.refresh();
    return { ok: true, thickness: v };
  };

  ArpVpSkeleton.setJointSize = function (v) {
    v = Number(v);
    if (!isFinite(v) || v <= 0.001 || v >= 0.1) return { ok: false, reason: 'bad-joint-size' };
    _settings.jointSize = v;
    _saveSettings();
    if (_state.rootBone) return ArpVpSkeleton.refresh();
    return { ok: true, jointSize: v };
  };

  ArpVpSkeleton.setColor = function (group, hex) {
    if (['spine', 'left', 'right'].indexOf(group) === -1) return { ok: false, reason: 'bad-group' };
    var n = (typeof hex === 'string') ? parseInt(hex.replace(/^#/, ''), 16) : Number(hex);
    if (!isFinite(n) || n < 0 || n > 0xffffff) return { ok: false, reason: 'bad-color' };
    _settings.colors[group] = n;
    _saveSettings();
    if (_state.rootBone) return ArpVpSkeleton.refresh();
    return { ok: true, group: group, color: n };
  };

  ArpVpSkeleton.setAutoShow = function (b) {
    _settings.autoShow = !!b;
    _saveSettings();
    return { ok: true, autoShow: _settings.autoShow };
  };

  ArpVpSkeleton.getSettings = function () {
    return {
      visible: _settings.visible, autoShow: _settings.autoShow,
      thickness: _settings.thickness, jointSize: _settings.jointSize,
      colors: { spine: _settings.colors.spine, left: _settings.colors.left, right: _settings.colors.right }
    };
  };

  ArpVpSkeleton.getBoneCount = function () { return _state.boneCount; };

  /* ---------- VIEW2: nhóm xương + X-ray ---------- */

  /* Ẩn/hiện 1 nhóm xương (spine/head/arm-left/arm-right/leg-left/
     leg-right/fingers/other). Nhóm sai → {ok:false, allowed}. */
  ArpVpSkeleton.setGroupVisible = function (group, on) {
    if (GROUP_ORDER.indexOf(group) === -1) {
      return { ok: false, reason: 'bad-group', allowed: GROUP_ORDER.slice() };
    }
    _settings.groups[group] = !!on;
    _saveSettings();
    if (_state.visible) _setPartsVisible(true);
    _syncUI();
    return { ok: true, group: group, visible: !!on };
  };

  ArpVpSkeleton.getGroupVisibility = function () {
    var out = {};
    GROUP_ORDER.forEach(function (g) { out[g] = !!_settings.groups[g]; });
    return out;
  };

  /* Thống kê từng nhóm: số xương, số part, số part đang hiện. */
  ArpVpSkeleton.getGroups = function () {
    var counts = {};
    GROUP_ORDER.forEach(function (g) { counts[g] = { bones: 0, parts: 0, visibleParts: 0, visible: !!_settings.groups[g] }; });
    _state.bones.forEach(function (b) {
      var g = _groupOf(b);
      if (counts[g]) counts[g].bones++;
    });
    _state.parts.forEach(function (p) {
      var g = (p.userData && p.userData.vpGroup) || 'other';
      if (counts[g]) {
        counts[g].parts++;
        if (p.visible) counts[g].visibleParts++;
      }
    });
    return GROUP_ORDER.map(function (g) {
      return { key: g, label: GROUP_LABELS[g], visible: counts[g].visible, bones: counts[g].bones, parts: counts[g].parts, visibleParts: counts[g].visibleParts };
    });
  };

  ArpVpSkeleton.setXrayEnabled = function (on) {
    var r = _setXrayEnabled(!!on);
    /* Quy ước FIX2: layer show/hide trả true khi thành công. */
    return (r && r.ok === true) ? true : r;
  };

  ArpVpSkeleton.toggleXray = function () {
    return ArpVpSkeleton.setXrayEnabled(!ArpVpSkeleton.isXrayEnabled());
  };

  ArpVpSkeleton.isXrayEnabled = function () { return _isXrayEnabled(); };

  ArpVpSkeleton.getXrayState = function () {
    var shading = null;
    try {
      var PS = _PS();
      if (PS && PS.State && typeof PS.State.get === 'function') shading = PS.State.get('shading');
    } catch (e) {}
    return { xray: _isXrayEnabled(), shading: shading, prevShading: _xray.prevShading };
  };

  /* Test hooks */
  ArpVpSkeleton._test = {
    classifyBone: _classifyBone,
    stripName: _stripName,
    groupOf: _groupOf,
    GROUP_ORDER: GROUP_ORDER,
    GROUP_LABELS: GROUP_LABELS,
    setXrayEnabled: _setXrayEnabled,
    isXrayEnabled: _isXrayEnabled,
    findSkeleton: _findSkeleton,
    buildDisplay: _buildDisplay,
    onRigComplete: _onRigComplete,
    climbToRigged: _climbToRigged,
    resolveTarget: _resolveTarget,
    getManualHiddenFor: function () { return _manualHiddenFor; },
    state: _state,
    settings: _settings,
    THICKNESS_RADIUS: THICKNESS_RADIUS,
    NO_SKELETON_MSG: NO_SKELETON_MSG,
    bindBus: _bindBus,
    tryRegister: _tryRegister
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpVpSkeleton = ArpVpSkeleton;

  /* Tự init khi load được (defensive: thiếu document/bus thì init()
   * lần sau qua show()/toggle() sẽ bind lại). */
  try { ArpVpSkeleton.init(); } catch (e) {}
})();
