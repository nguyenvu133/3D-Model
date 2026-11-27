/* ============================================================
 * rig/arp-vp-labels.js — NHÃN TÊN XƯƠNG TRONG VIEWPORT
 * (Auto Rig Pro Blend, vòng mở rộng Viewport — PHẦN 2)
 *
 * Hiện tên từng khớp xương ngay tại khớp trong viewport, dưới dạng
 * THREE.Sprite + canvas texture.
 *
 *   ⚠️ GHI RÕ: đây là TEXT 2D LUÔN QUAY VỀ CAMERA (billboard sprite),
 *   KHÔNG phải text 3D thật (không phải geometry chữ đứng trong
 *   không gian 3D, không bị che khuất theo góc nhìn như mesh chữ).
 *   Sprite tự quay về camera nên đọc được từ mọi góc — đúng thứ
 *   người dùng cần khi rig (xem tên khớp nhanh), và rẻ hơn text 3D
 *   thật rất nhiều (1 texture / nhãn, không cần font loader).
 *
 * Cách dùng:
 *   ArpVpLabels.show(target?)            — hiện nhãn (mặc định mode 'main')
 *   ArpVpLabels.hide() / isVisible()
 *   ArpVpLabels.setMode('all'|'main'|'selected')
 *   ArpVpLabels.setFontSize('small'|'medium'|'large')
 *   ArpVpLabels.setSelectedBone('LeftArm' | bone | null)
 *   ArpVpLabels.update(dt)               — app loop gọi mỗi frame;
 *     chỉ làm việc khi đang hiện (rẻ: chỉ getWorldPosition từng
 *     xương đang hiện, không traverse lại model mỗi frame)
 *   ArpVpLabels.renderPanel(container)   — dựng control vào panel
 *   ArpVpLabels.getStatus()              — trạng thái cho panel liên quan
 *   ArpVpLabels.dispose()                — gỡ hết nhãn, giải phóng texture
 *
 * Đăng ký layer hiển thị (defensive, theo contract chung):
 *   nếu window.PixiStudio.ArpViewport tồn tại thì gọi
 *   ArpViewport.registerLayer('labels', {show, hide, isVisible,
 *   label: 'Nhãn xương'}); nếu chưa có thì chỉ expose API trên
 *   (toolbar/preset gọi trực tiếp ArpVpLabels.*).
 *   LƯU Ý: tại thời điểm viết file này repo CHƯA có ArpViewport
 *   (grep không thấy) nên nhánh fallback là nhánh đang chạy thật;
 *   nhánh register chỉ kích hoạt khi module đó xuất hiện sau.
 *
 * Nguồn xương: traverse target tìm Object3D isBone — nhận mọi rig:
 *   skeleton 41 xương AutoRigPro (mixamorig:*), FBX/GLB rigged sẵn
 *   (Thiếu Lâm, Mixamo), QuickRig.current.target. KHÔNG phụ thuộc
 *   AutoRigPro.lastResult nên vẫn chạy với model rig sẵn từ file.
 *   Model chưa rig (vd lenhhosung Tripo GLB mesh-only) → show()
 *   trả {ok:false} và KHÔNG hiện nhãn; panel báo rõ (xem renderPanel).
 *
 * Tên hiển thị: bỏ prefix mixamorig: bằng regex /^mixamorig:?/i
 *   (cùng regex đã dùng sẵn trong repo: arp-boneshape.js,
 *   arp-export.js, arp-qr3-face.js...).
 *
 * GIỚI HẠN TRUNG THỰC:
 *  - Text 2D billboard, không phải text 3D thật (xem đầu file).
 *  - Nhãn có depthTest:false nên luôn vẽ đè lên mesh — cố ý để đọc
 *    được khớp bị khuất, nhưng nhãn của khớp sau lưng vẫn hiện.
 *  - Cỡ chữ theo % chiều cao model (H đo bằng Box3 lúc build) nên
 *    model scale cực lạ vẫn đọc được; đổi scale model sau khi build
 *    thì gọi refresh() để đo lại H.
 *  - FIX2: H đo từ mesh nhân vật thật (loại mesh trang trí xương —
 *    xem measureHeight); nhãn được bù cỡ theo khoảng cách camera
 *    (giữ đọc được khi zoom ra) và dời chồng chéo dọc hướng lên
 *    của camera (tối đa 4 nấc, không ẩn nhãn nào) trong updatePositions().
 *  - Mode 'selected' cần xương đang chọn: setSelectedBone() hoặc
 *    PixiStudio.State.get('selectedBone'); chưa chọn xương nào thì
 *    không hiện nhãn nào (báo rõ trong status).
 *  - Không tự gọi trong app loop: coordinator cần thêm 1 dòng
 *    `if (PixiStudio.ArpVpLabels) PixiStudio.ArpVpLabels.update(dt);`
 *    vào App.startLoop (file này KHÔNG sửa app.js / index.html).
 * ============================================================ */
(function () {
  'use strict';

  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };
  var LABEL_GROUP_NAME = '__arp_vp_labels__';

  /* Xương chính: Hips, Spine, Neck, Head + 2 tay (Arm/ForeArm/Hand)
     + 2 chân (UpLeg/Leg/Foot) = 16 xương (≈15 theo yêu cầu). */
  var MAIN_BONES = [
    'Hips', 'Spine', 'Neck', 'Head',
    'LeftArm', 'LeftForeArm', 'LeftHand',
    'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot',
    'RightUpLeg', 'RightLeg', 'RightFoot'
  ];
  var MODES = ['all', 'main', 'selected'];
  var MODE_LABELS = { all: 'Tất cả xương', main: 'Chỉ xương chính', selected: 'Chỉ xương đang chọn' };
  /* Cỡ chữ: px = font trên canvas texture; scale = chiều cao nhãn
     trong world = scale * H (chiều cao model). */
  var FONT_SIZES = {
    small: { px: 28, scale: 0.035, label: 'Nhỏ' },
    medium: { px: 40, scale: 0.05, label: 'Vừa' },
    large: { px: 56, scale: 0.07, label: 'Lớn' }
  };

  var ArpVpLabels = {
    _visible: false,
    _mode: 'main',
    _fontSize: 'medium',
    _target: null,
    _group: null,       /* THREE.Group chứa các sprite, gắn vào scene */
    _labels: [],        /* [{bone, shortName, sprite, texture, canvas, height}] */
    _fingerprint: '',
    _modelHeight: 1.8,
    _selected: null,    /* tên gọn (đã strip) của xương đang chọn, hoặc null */
    _registered: false,
    _panelEl: null,
    _manualHiddenFor: null, /* uuid model user đã tắt nhãn BẰNG TAY trong phiên (qua toggle) */
    _nextHideManual: false  /* toggle() đặt trước khi gọi hide() */
  };
  ArpVpLabels.MAIN_BONES = MAIN_BONES;
  ArpVpLabels.MODES = MODES;
  ArpVpLabels.FONT_SIZES = FONT_SIZES;

  function notify(type, title, message, duration) {
    try { bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 }); } catch (e) {}
  }
  function emitChanged() {
    try { bus.emit('arp-vp-labels:changed', ArpVpLabels.getStatus()); } catch (e) {}
    /* Như skeleton._syncUI: toolbar ARP View chỉ tự refresh khi layer đổi
       QUA registry; auto-show/show()/hide() trực tiếp bypass registry nên
       nút "Nhãn xương" kẹt ở "off" dù nhãn đang hiện. Refresh kèm ở đây —
       core.isLayerVisible() đọc live layer.isVisible() nên chỉ cần gọi
       refresh. Guarded: toolbar có thể chưa load. */
    try {
      var T = window.PixiStudio && window.PixiStudio.ArpVpToolbar;
      if (T && typeof T.refresh === 'function') T.refresh();
    } catch (e) {}
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* Bỏ prefix mixamorig: — cùng regex đã dùng sẵn trong repo. */
  function stripName(name) {
    return String(name == null ? '' : name).replace(/^mixamorig:?/i, '');
  }
  ArpVpLabels.stripName = stripName;

  /* ---------- Thu thập xương ---------- */

  function collectBones(root) {
    var out = [];
    if (!root) return out;
    if (Array.isArray(root)) return root.filter(function (b) { return b && b.isBone; });
    if (root.isBone) return [root];
    if (root.bones && Array.isArray(root.bones)) {
      return root.bones.filter(function (b) { return b && b.isBone; });
    }
    if (root.traverse) root.traverse(function (o) { if (o.isBone) out.push(o); });
    return out;
  }
  ArpVpLabels.collectBones = collectBones;

  /* Leo từ 1 object bất kỳ lên ancestor gần nhất có xương (vd
   * selection đang là 1 SkinnedMesh — xương là sibling, traverse từ
   * mesh không thấy). DỪNG ở modelRoot/Scene: không leo sang model
   * khác. Trả null nếu tới đỉnh model vẫn không thấy xương nào. */
  function climbToRigged(obj) {
    var o = obj, guard = 0;
    var root = null;
    try { root = (PixiStudio.Viewport && PixiStudio.Viewport.modelRoot) || null; } catch (e) {}
    while (o && guard < 64) {
      if (o.isScene || (root && o === root)) return null;
      if (collectBones(o).length) return o;
      o = o.parent;
      guard++;
    }
    return null;
  }
  ArpVpLabels.climbToRigged = climbToRigged;

  function getTarget(target) {
    if (target) {
      var c0 = climbToRigged(target);
      return c0 || target; /* target truyền thẳng thì thắng, dù không xương (báo rõ) */
    }
    /* FIX (ARP View vòng 1): thứ tự cũ đặt State.selection ĐẦU TIÊN và
       TRẢ NGAY cả khi selection là 1 SkinnedMesh trần (xương là
       sibling → collectBones = 0) nên nhãn không bao giờ hiện; đồng
       thời getMainModel() bám model mẫu. Thứ tự mới: selection →
       Models.current (mới import nhất) → Anim.targetObject (FBX vừa
       load) → getMainModel() (đã sửa tập trung) → QuickRig →
       AutoRigPro. QUY TẮC: ứng viên ĐẦU TIÊN có mặt thì thắng (leo
       lên ancestor có xương; leo không được thì trả chính nó để
       show()/getStatus() báo "chưa có rig" trung thực) — CHỈ ứng viên
       vắng (null) mới rơi xuống ứng viên sau; nếu không, khi user
       chọn model chưa rig thì nhãn sẽ bám nhầm vào rig cũ. */
    if (PixiStudio.State && PixiStudio.State.get) {
      var sel = PixiStudio.State.get('selection');
      if (sel) { var cs = climbToRigged(sel); return cs || sel; }
    }
    if (PixiStudio.Models && typeof PixiStudio.Models.getCurrent === 'function') {
      try {
        var cur = PixiStudio.Models.getCurrent();
        if (cur && cur.object3D) { var cc = climbToRigged(cur.object3D); return cc || cur.object3D; }
      } catch (e) {}
    }
    if (PixiStudio.Anim && PixiStudio.Anim.targetObject) {
      var ca = climbToRigged(PixiStudio.Anim.targetObject);
      return ca || PixiStudio.Anim.targetObject;
    }
    if (PixiStudio.Viewport && PixiStudio.Viewport.getMainModel) {
      var main = PixiStudio.Viewport.getMainModel();
      if (main) { var cm = climbToRigged(main); return cm || main; }
    }
    if (PixiStudio.ArpQuickRig && PixiStudio.ArpQuickRig.current && PixiStudio.ArpQuickRig.current.target) {
      return PixiStudio.ArpQuickRig.current.target;
    }
    if (PixiStudio.AutoRigPro && PixiStudio.AutoRigPro.lastResult &&
        PixiStudio.AutoRigPro.lastResult.rig && PixiStudio.AutoRigPro.lastResult.rig.group) {
      var g = PixiStudio.AutoRigPro.lastResult.rig.group;
      if (g.parent) return g.parent;
    }
    return null;
  }
  ArpVpLabels.getTargetFn = getTarget;

  function hasRig(target) {
    return collectBones(target || getTarget()).length > 0;
  }
  ArpVpLabels.hasRig = hasRig;

  function fingerprint(target, bones) {
    return (target && target.uuid ? target.uuid : 'notarget') + '|' +
      bones.map(function (b) { return b.name; }).join(',');
  }

  /* ---------- Canvas texture cho 1 nhãn ---------- */

  function makeLabelTexture(text, fontPx) {
    var padX = 12, padY = 8;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    var font = 'bold ' + fontPx + 'px Arial, sans-serif';
    ctx.font = font;
    var tw = 0;
    try { tw = ctx.measureText(text).width || text.length * fontPx * 0.6; } catch (e) { tw = text.length * fontPx * 0.6; }
    canvas.width = Math.ceil(tw) + padX * 2;
    canvas.height = fontPx + padY * 2;
    /* Vẽ lại sau khi đổi width/height (canvas reset context state). */
    ctx = canvas.getContext('2d');
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    var w = canvas.width, h = canvas.height, r = Math.min(10, h / 2 - 1);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 12, 20, 0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, padX, h / 2 + 1);
    var tex = null;
    try {
      if (window.THREE && THREE.CanvasTexture) tex = new THREE.CanvasTexture(canvas);
    } catch (e) { tex = null; }
    return { texture: tex, canvas: canvas, aspect: w / Math.max(1, h), text: text };
  }

  /* ---------- Build / rebuild ---------- */

  /* Đo chiều cao model để scale nhãn (H × FONT_SIZES.scale).
     FIX2: chỉ đo MESH NHÂN VẬT THẬT — loại mesh trang trí xương
     (isBoneVisual: cylinder/khớp cầu skeleton, IK, trails...) và
     overlay đo đạc. Trước đây Box3.setFromObject(target) gồm cả
     chúng: stub xương lá chĩa xuống đất làm đáy bbox lún ~4cm,
     khớp cầu đội đỉnh bbox lên ~1cm → H nhãn phình ~5–7cm so với
     mesh thật, và lệch với số "Cao" của ArpVpMeasure (vốn đã loại
     isBoneVisual trong collectMeshes). Sau sửa, H nhãn = chiều cao
     bbox mesh thật (đo thật Thiếu Lâm: 2.00m, khớp 2 cách đo).
     Phần chênh còn lại với measure (2.404m) là khác biệt ĐỊNH NGHĨA
     thật, không phải bug: nhãn dùng đỉnh mesh, measure dùng xương
     HeadTop_End − mặt đất — và trên model này HeadTop_End nằm
     0.40m TRÊN đỉnh mesh (2.404 so với 2.00), nên hai số không thể
     trùng nhau; H nhãn chỉ dùng để scale nhãn, không hiển thị
     số "Cao" cho user. */
  function measureHeight(target) {
    var H = 1.8;
    try {
      if (window.THREE && THREE.Box3) {
        var box = new THREE.Box3();
        var found = false;
        target.traverse(function (o) {
          if (!o.isMesh || !o.geometry) return;
          if (o.userData && (o.userData.isBoneVisual || o.userData.isArpBoneLabel ||
              o.userData.isArpMeasure || o.userData.isArpReference)) return;
          try { box.expandByObject(o); found = true; } catch (e) {}
        });
        if (found && !box.isEmpty()) {
          var s = box.getSize(new THREE.Vector3());
          if (isFinite(s.y) && s.y > 0.01) H = s.y;
        }
      }
    } catch (e) { /* giữ fallback 1.8m */ }
    return H;
  }

  function disposeLabels() {
    ArpVpLabels._labels.forEach(function (L) {
      if (L.texture && L.texture.dispose) { try { L.texture.dispose(); } catch (e) {} }
      if (L.sprite && L.sprite.material) {
        if (L.sprite.material.map && L.sprite.material.map !== L.texture && L.sprite.material.map.dispose) {
          try { L.sprite.material.map.dispose(); } catch (e) {}
        }
        try { L.sprite.material.dispose(); } catch (e) {}
      }
    });
    ArpVpLabels._labels = [];
    if (ArpVpLabels._group) {
      if (ArpVpLabels._group.parent) ArpVpLabels._group.parent.remove(ArpVpLabels._group);
      ArpVpLabels._group = null;
    }
  }

  /* Dựng lại toàn bộ nhãn cho target. Trả {ok, boneCount} hoặc {ok:false, error}. */
  function build(target) {
    var bones = collectBones(target);
    if (!bones.length) return { ok: false, error: 'Model chưa có rig — chưa có skeleton để gắn nhãn. Rig model trước (Auto Rig Pro Blend) hoặc load model đã rig (FBX/GLB).' };
    if (!window.THREE || !THREE.Sprite) return { ok: false, error: 'THREE chưa sẵn sàng — tải lại trang.' };
    disposeLabels();
    var H = measureHeight(target);
    ArpVpLabels._modelHeight = H;
    var spec = FONT_SIZES[ArpVpLabels._fontSize] || FONT_SIZES.medium;
    var labelH = H * spec.scale;
    var scene = (PixiStudio.Viewport && PixiStudio.Viewport.scene) || null;
    var group = new THREE.Group();
    group.name = LABEL_GROUP_NAME;
    var parent = scene || target.parent || target;
    parent.add(group);
    ArpVpLabels._group = group;
    var built = 0;
    bones.forEach(function (bone) {
      var shortName = stripName(bone.name);
      if (!shortName) return;
      var made = makeLabelTexture(shortName, spec.px);
      if (!made || !made.texture) return;
      var mat = new THREE.SpriteMaterial({
        map: made.texture, transparent: true,
        depthTest: false, depthWrite: false
      });
      var sprite = new THREE.Sprite(mat);
      sprite.name = '__arp_label_' + shortName;
      sprite.renderOrder = 999;
      sprite.scale.set(labelH * made.aspect, labelH, 1);
      sprite.userData.isArpBoneLabel = true;
      sprite.userData.boneName = bone.name;
      sprite.userData.shortName = shortName;
      group.add(sprite);
      ArpVpLabels._labels.push({
        bone: bone, shortName: shortName, sprite: sprite,
        texture: made.texture, canvas: made.canvas, height: labelH,
        baseW: labelH * made.aspect, baseH: labelH, stackOffset: 0
      });
      built++;
    });
    if (!built) {
      disposeLabels();
      return { ok: false, error: 'Không tạo được texture nhãn (canvas 2D không khả dụng).' };
    }
    ArpVpLabels._target = target;
    ArpVpLabels._fingerprint = fingerprint(target, bones);
    applyModeVisibility();
    return { ok: true, boneCount: bones.length, labelCount: built, modelHeight: H };
  }

  /* ---------- Chế độ hiển thị ---------- */

  function getSelectedBone() {
    if (ArpVpLabels._selected) return ArpVpLabels._selected;
    try {
      if (PixiStudio.State && PixiStudio.State.get) {
        var s = PixiStudio.State.get('selectedBone');
        if (s) return stripName(typeof s === 'string' ? s : s.name);
      }
    } catch (e) {}
    return null;
  }
  ArpVpLabels.getSelectedBone = getSelectedBone;

  function isLabelVisibleInMode(L) {
    if (ArpVpLabels._mode === 'all') return true;
    if (ArpVpLabels._mode === 'main') return MAIN_BONES.indexOf(L.shortName) >= 0;
    /* selected */
    var sel = getSelectedBone();
    return !!sel && L.shortName === sel;
  }

  function applyModeVisibility() {
    var n = 0;
    ArpVpLabels._labels.forEach(function (L) {
      var v = isLabelVisibleInMode(L);
      L.sprite.visible = v;
      if (v) n++;
    });
    return n;
  }

  function visibleCount() {
    var n = 0;
    ArpVpLabels._labels.forEach(function (L) { if (L.sprite.visible) n++; });
    return n;
  }

  /* ---------- API chính ---------- */

  ArpVpLabels.show = function (target, opts) {
    opts = opts || {};
    if (opts.mode && MODES.indexOf(opts.mode) >= 0) ArpVpLabels._mode = opts.mode;
    if (opts.fontSize && FONT_SIZES[opts.fontSize]) ArpVpLabels._fontSize = opts.fontSize;
    target = target || ArpVpLabels._target || getTarget();
    /* Target truyền thẳng là SkinnedMesh/xương con → leo lên ancestor
       có xương (xương là sibling của mesh, traverse từ mesh không thấy). */
    if (target) target = climbToRigged(target) || target;
    if (!target) {
      var msg0 = 'Chưa có model nào — load model trước rồi bật nhãn xương.';
      notify('warning', 'Nhãn xương', msg0);
      return { ok: false, error: msg0 };
    }
    var bones = collectBones(target);
    if (!bones.length) {
      var msg1 = 'Model chưa có rig — chưa có skeleton để gắn nhãn. Rig model trước (Auto Rig Pro Blend) hoặc load model đã rig (FBX/GLB).';
      notify('warning', 'Nhãn xương', msg1);
      return { ok: false, error: msg1 };
    }
    var fp = fingerprint(target, bones);
    var needBuild = !ArpVpLabels._group || ArpVpLabels._target !== target ||
      ArpVpLabels._fingerprint !== fp || !ArpVpLabels._labels.length;
    if (needBuild) {
      var r = build(target);
      if (!r.ok) { notify('warning', 'Nhãn xương', r.error); return r; }
    } else {
      applyModeVisibility();
    }
    /* Hiện tay → xóa cờ tắt-tay của model này. */
    if (target.uuid && ArpVpLabels._manualHiddenFor === target.uuid) ArpVpLabels._manualHiddenFor = null;
    ArpVpLabels._visible = true;
    if (ArpVpLabels._group) ArpVpLabels._group.visible = true;
    updatePositions();
    emitChanged();
    refreshPanel();
    return { ok: true, boneCount: bones.length, labelCount: ArpVpLabels._labels.length, visibleCount: visibleCount(), mode: ArpVpLabels._mode, fontSize: ArpVpLabels._fontSize };
  };

  ArpVpLabels.hide = function (opts) {
    /* Chỉ hide() MANUAL (qua toggle()) mới ghi cờ tắt-tay trong phiên
       (xem ArpVpLabels.autoShow) — hide() từ preset/registry KHÔNG ghi,
       để rig/load sau vẫn auto-show nhãn lại. */
    var manual = !!((opts && opts.manual) || ArpVpLabels._nextHideManual);
    ArpVpLabels._nextHideManual = false;
    if (manual && ArpVpLabels._target && ArpVpLabels._target.uuid) ArpVpLabels._manualHiddenFor = ArpVpLabels._target.uuid;
    ArpVpLabels._visible = false;
    if (ArpVpLabels._group) ArpVpLabels._group.visible = false;
    emitChanged();
    refreshPanel();
    return true;
  };

  ArpVpLabels.hideManual = function () {
    return ArpVpLabels.hide({ manual: true });
  };

  /* Tự hiện sau rig/load — KHÁC show(): tôn trọng "user đã tắt tay
   * trong phiên hiện tại" cho ĐÚNG model đó (uuid); model MỚI (uuid
   * khác) hoặc phiên mới (cờ trống) thì luôn hiện. Listener
   * 'arp:rig-complete' và app.js (model:loaded) dùng hàm này. */
  ArpVpLabels.autoShow = function (target) {
    target = target || ArpVpLabels._target || getTarget();
    if (target) target = climbToRigged(target) || target;
    if (!target) return { ok: false, error: 'Chưa có model nào.' };
    if (target.uuid && ArpVpLabels._manualHiddenFor === target.uuid) {
      return { ok: false, reason: 'manual-hidden', target: target };
    }
    return ArpVpLabels.show(target);
  };

  ArpVpLabels.isVisible = function () { return !!ArpVpLabels._visible; };

  ArpVpLabels.toggle = function (target) {
    if (ArpVpLabels._visible) {
      ArpVpLabels._nextHideManual = true; /* tắt tay → ghi cờ cho model hiện tại */
      ArpVpLabels.hide();
      return { ok: true, visible: false };
    }
    return ArpVpLabels.show(target);
  };

  ArpVpLabels.setMode = function (mode) {
    if (MODES.indexOf(mode) < 0) return { ok: false, error: 'Mode không hợp lệ: ' + mode + ' (all | main | selected).' };
    ArpVpLabels._mode = mode;
    if (ArpVpLabels._labels.length) applyModeVisibility();
    emitChanged();
    refreshPanel();
    return { ok: true, mode: mode, visibleCount: visibleCount() };
  };

  /* Cỡ chữ: 'small' | 'medium' | 'large', hoặc số px canvas (24–96). */
  ArpVpLabels.setFontSize = function (size) {
    var key = null;
    if (typeof size === 'string' && FONT_SIZES[size]) key = size;
    else if (typeof size === 'number' && isFinite(size)) {
      var px = clamp(Math.round(size), 24, 96);
      key = px <= 32 ? 'small' : (px <= 48 ? 'medium' : 'large');
    }
    if (!key) return { ok: false, error: 'Cỡ chữ không hợp lệ: ' + size + ' (small | medium | large).' };
    var changed = key !== ArpVpLabels._fontSize;
    ArpVpLabels._fontSize = key;
    /* Đổi cỡ chữ phải vẽ lại texture + scale sprite → build lại. */
    if (changed && ArpVpLabels._target && ArpVpLabels._labels.length) {
      var wasVisible = ArpVpLabels._visible;
      var r = build(ArpVpLabels._target);
      if (!r.ok) return r;
      ArpVpLabels._visible = wasVisible;
      if (ArpVpLabels._group) ArpVpLabels._group.visible = wasVisible;
      updatePositions();
    }
    emitChanged();
    refreshPanel();
    return { ok: true, fontSize: key };
  };

  ArpVpLabels.setSelectedBone = function (bone) {
    if (!bone) { ArpVpLabels._selected = null; }
    else if (typeof bone === 'string') { ArpVpLabels._selected = stripName(bone) || null; }
    else if (bone.name) { ArpVpLabels._selected = stripName(bone.name) || null; }
    else { return { ok: false, error: 'Xương đang chọn không hợp lệ.' }; }
    if (ArpVpLabels._mode === 'selected' && ArpVpLabels._labels.length) applyModeVisibility();
    emitChanged();
    refreshPanel();
    return { ok: true, selected: ArpVpLabels._selected };
  };

  /* Dựng lại nhãn (vd sau khi đổi scale model, rig lại, load model mới). */
  ArpVpLabels.refresh = function (target) {
    target = target || ArpVpLabels._target || getTarget();
    if (!target) return { ok: false, error: 'Chưa có model nào.' };
    if (!ArpVpLabels._visible && !ArpVpLabels._labels.length) return ArpVpLabels.show(target);
    var r = build(target);
    if (!r.ok) return r;
    if (ArpVpLabels._group) ArpVpLabels._group.visible = ArpVpLabels._visible;
    updatePositions();
    emitChanged();
    refreshPanel();
    return { ok: true, boneCount: r.boneCount, labelCount: r.labelCount, visibleCount: visibleCount() };
  };

  ArpVpLabels.dispose = function () {
    disposeLabels();
    ArpVpLabels._visible = false;
    ArpVpLabels._target = null;
    ArpVpLabels._fingerprint = '';
    ArpVpLabels._selected = null;
    ArpVpLabels._manualHiddenFor = null;
    emitChanged();
    refreshPanel();
    return true;
  };

  ArpVpLabels.getStatus = function () {
    var target = ArpVpLabels._target || getTarget();
    var rig = hasRig(target);
    var sel = getSelectedBone();
    var message;
    if (!target) message = 'Chưa có model nào — load model trước rồi bật nhãn xương.';
    else if (!rig) message = 'Model chưa có rig — chưa có skeleton để gắn nhãn. Rig model trước (Auto Rig Pro Blend) hoặc load model đã rig (FBX/GLB).';
    else if (ArpVpLabels._mode === 'selected' && !sel) message = 'Chưa chọn xương nào — chọn 1 xương (hoặc gọi setSelectedBone) để hiện nhãn.';
    else if (ArpVpLabels._visible) message = 'Đang hiện ' + visibleCount() + '/' + ArpVpLabels._labels.length + ' nhãn (' + MODE_LABELS[ArpVpLabels._mode] + ', cỡ ' + (FONT_SIZES[ArpVpLabels._fontSize] || {}).label + ').';
    else message = 'Đã tắt — có ' + collectBones(target).length + ' xương sẵn sàng gắn nhãn.';
    return {
      visible: ArpVpLabels._visible,
      mode: ArpVpLabels._mode,
      fontSize: ArpVpLabels._fontSize,
      hasRig: rig,
      hasTarget: !!target,
      boneCount: rig ? collectBones(target).length : 0,
      labelCount: ArpVpLabels._labels.length,
      visibleCount: ArpVpLabels._visible ? visibleCount() : 0,
      selected: sel,
      modelHeight: ArpVpLabels._modelHeight,
      message: message
    };
  };

  /* ---------- update() mỗi frame — PHẢI RẺ ---------- */

  var _tmpV = null;
  function tmpVec() {
    if (!_tmpV && window.THREE) _tmpV = new THREE.Vector3();
    return _tmpV;
  }

  /* Camera chính của viewport (để bù cỡ nhãn theo khoảng cách +
     chống chồng chéo trên màn hình). Thiếu camera → updatePositions
     chạy kiểu cũ (không bù, không chống chồng). */
  function getCamera() {
    try {
      var PS = (typeof window !== 'undefined' && window.PixiStudio) || (typeof PixiStudio !== 'undefined' ? PixiStudio : null);
      if (PS && PS.Viewport && PS.Viewport.orbit && PS.Viewport.orbit.camera) return PS.Viewport.orbit.camera;
    } catch (e) {}
    return null;
  }
  function getCanvasSize() {
    try {
      if (typeof document === 'undefined') return null;
      var c = document.getElementById('three-canvas') || document.getElementById('viewport-canvas-wrap');
      if (!c) return null;
      var w = c.clientWidth, h = c.clientHeight;
      if (w > 0 && h > 0) return { w: w, h: h };
    } catch (e) {}
    return null;
  }
  /* Thứ tự ưu tiên khi nhãn chồng nhau: xương chính theo MAIN_BONES
     trước, xương phụ sau. */
  function labelPriority(L) {
    var i = MAIN_BONES.indexOf(L.shortName);
    return i >= 0 ? i : 99;
  }

  /* Đặt sprite đúng vị trí khớp (world + nhích lên trên 1 chút).
     Group gắn vào scene → dùng trực tiếp world position; nếu group
     gắn vào target (fallback khi chưa có scene) thì đổi về local.
     FIX2 — 2 cải thiện hiển thị:
     (a) Bù cỡ theo khoảng cách camera: SpriteMaterial
         sizeAttenuation:true làm nhãn nhỏ dần khi zoom ra (đo thật:
         nhãn Hips chỉ còn ~19px ở cam 4.99m). Nay scale sprite theo
         dist/(H*1.5) (kẹp 0.6–2.5) để nhãn giữ cỡ đọc được khi zoom
         ra, và không phình quá khi zoom sát.
     (b) Chống chồng chéo: ở mode 'main', tay khép làm 12 cặp nhãn
         chồng nhau (Hips~Spine, LeftArm~LeftHand...). Nay chiếu vị
         trí nhãn lên màn hình, nhãn ưu tiên thấp bị chồng thì dời
         lên dọc theo hướng "lên" của camera từng nấc 1 chiều cao
         nhãn (tối đa 4 nấc), không ẩn nhãn nào. */
  function updatePositions() {
    if (!ArpVpLabels._group || !ArpVpLabels._labels.length) return 0;
    var v = tmpVec();
    if (!v) return 0;
    var cam = getCamera();
    var canvas = cam ? getCanvasSize() : null;
    var H = ArpVpLabels._modelHeight || 1.8;
    var refDist = H * 1.5; /* khoảng cách fit điển hình ≈ 1.5 × chiều cao */
    var camUp = null;
    if (cam && window.THREE) {
      try { camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion); } catch (e) { camUp = null; }
    }
    /* Pass 1: vị trí world gốc + hệ số bù cỡ của từng nhãn đang hiện. */
    var items = [];
    ArpVpLabels._labels.forEach(function (L, idx) {
      if (!L.sprite.visible) { L.stackOffset = 0; return; }
      L.bone.getWorldPosition(v);
      var wp = v.clone();
      wp.y += L.height * 0.55;
      var dist = cam ? cam.position.distanceTo(wp) : refDist;
      var factor = clamp(dist / refDist, 0.6, 2.5);
      L._factor = factor;
      /* Bù cỡ: scale sprite theo khoảng cách (giữ nguyên tỉ lệ). */
      var bw = L.baseW || (L.height * 1.5), bh = L.baseH || L.height;
      L.sprite.scale.set(bw * factor, bh * factor, 1);
      items.push({ L: L, idx: idx, wp: wp, stack: 0 });
    });
    /* Pass 2: chống chồng chéo trên màn hình (chỉ khi chiếu được). */
    if (cam && canvas && camUp && items.length > 1) {
      var placed = [];
      items.sort(function (a, b) {
        var pa = labelPriority(a.L), pb = labelPriority(b.L);
        return (pa - pb) || (a.idx - b.idx);
      });
      items.forEach(function (it) {
        var stepH = (it.L.baseH || it.L.height) * (it.L._factor || 1);
        var tries = 0;
        while (tries < 4) {
          var p = it.wp.clone();
          if (it.stack > 0) p.addScaledVector(camUp, it.stack * stepH);
          var s = screenOf(p, cam, canvas);
          if (!s) break;
          var clash = false;
          for (var i = 0; i < placed.length; i++) {
            if (Math.abs(s.x - placed[i].x) < 48 && Math.abs(s.y - placed[i].y) < 22) { clash = true; break; }
          }
          if (!clash) { placed.push(s); break; }
          it.stack++;
          tries++;
        }
        it.L.stackOffset = it.stack * stepH;
      });
    } else {
      items.forEach(function (it) { it.L.stackOffset = 0; });
    }
    /* Pass 3: đặt vị trí cuối (world → local nếu group là con target). */
    var n = 0;
    var inTarget = ArpVpLabels._group.parent === ArpVpLabels._target && ArpVpLabels._target && ArpVpLabels._target.worldToLocal;
    items.forEach(function (it) {
      var p = it.wp.clone();
      if (it.stack > 0 && camUp) p.addScaledVector(camUp, it.stack * ((it.L.baseH || it.L.height) * (it.L._factor || 1)));
      if (inTarget) it.L.sprite.position.copy(ArpVpLabels._target.worldToLocal(p));
      else it.L.sprite.position.copy(p);
      n++;
    });
    return n;
  }

  function screenOf(worldPos, cam, canvas) {
    try {
      var v = worldPos.clone().project(cam);
      if (!isFinite(v.x) || !isFinite(v.y) || v.z > 1) return null;
      return { x: (v.x * 0.5 + 0.5) * canvas.w, y: (-v.y * 0.5 + 0.5) * canvas.h };
    } catch (e) { return null; }
  }

  ArpVpLabels.update = function (dt) {
    /* Rẻ: không hiện thì không làm gì cả (không traverse, không
       getWorldPosition). dt không dùng để nội suy — vị trí bám
       khớp tuyệt đối mỗi frame nên animation nào cũng theo kịp. */
    if (!ArpVpLabels._visible || !ArpVpLabels._group || !ArpVpLabels._labels.length) return 0;
    /* Rig bị gỡ / model bị thay thì build lại 1 lần, thất bại thì ẩn. */
    var root = ArpVpLabels._labels.length ? ArpVpLabels._labels[0].bone : null;
    var detached = false;
    if (root) {
      var o = root, depth = 0;
      while (o && depth < 64) { if (o === ArpVpLabels._target) break; o = o.parent; depth++; }
      if (!o) detached = true;
    }
    if (detached) {
      var r = ArpVpLabels.refresh();
      if (!r.ok) { ArpVpLabels.hide(); return 0; }
    }
    return updatePositions();
  };

  /* ---------- Panel control (cho coordinator gắn vào tab) ---------- */

  function refreshPanel() {
    var el = ArpVpLabels._panelEl;
    if (!el || !el.isConnected) return;
    var st = el.querySelector('[data-arp-labels-status]');
    if (st) st.textContent = ArpVpLabels.getStatus().message;
    var btn = el.querySelector('[data-arp-labels-toggle]');
    if (btn) btn.textContent = ArpVpLabels._visible ? 'Ẩn nhãn xương' : 'Hiện nhãn xương';
    var cnt = el.querySelector('[data-arp-labels-count]');
    if (cnt) cnt.textContent = ArpVpLabels._visible ? (visibleCount() + '/' + ArpVpLabels._labels.length + ' nhãn') : '';
  }

  ArpVpLabels.renderPanel = function (container) {
    if (!container) return false;
    ArpVpLabels._panelEl = container;
    var st = ArpVpLabels.getStatus();
    container.innerHTML =
      '<div class="arp-labels">' +
      '<p class="arp-note" data-arp-labels-status></p>' +
      '<p class="arp-note" data-arp-labels-count></p>' +
      '<div class="arp-row">' +
      '<button class="arp-btn arp-btn-primary" data-arp-labels-toggle>Hiện nhãn xương</button>' +
      '<button class="arp-btn" data-arp-labels-refresh>↻ Làm mới</button>' +
      '</div>' +
      '<div class="arp-row"><label>Nhóm xương: </label>' +
      '<label><input type="radio" name="arp-labels-mode" value="all"> Tất cả</label>' +
      '<label><input type="radio" name="arp-labels-mode" value="main" checked> Chính (16)</label>' +
      '<label><input type="radio" name="arp-labels-mode" value="selected"> Đang chọn</label>' +
      '</div>' +
      '<div class="arp-row"><label>Cỡ chữ: </label>' +
      '<select data-arp-labels-size>' +
      '<option value="small">Nhỏ</option>' +
      '<option value="medium" selected>Vừa</option>' +
      '<option value="large">Lớn</option>' +
      '</select></div>' +
      '<p class="arp-note">Nhãn là text 2D luôn quay về camera (sprite), không phải text 3D thật. ' +
      'Nhãn bám theo khớp mỗi frame khi đang hiện.</p>' +
      '</div>';
    var toggleBtn = container.querySelector('[data-arp-labels-toggle]');
    if (toggleBtn) toggleBtn.addEventListener('click', function () {
      if (ArpVpLabels._visible) ArpVpLabels.hide();
      else {
        var r = ArpVpLabels.show();
        if (!r.ok) notify('warning', 'Nhãn xương', r.error);
      }
      refreshPanel();
    });
    var refreshBtn = container.querySelector('[data-arp-labels-refresh]');
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
      var r = ArpVpLabels.refresh();
      if (!r.ok) notify('warning', 'Nhãn xương', r.error);
      refreshPanel();
    });
    var radios = container.querySelectorAll('input[name="arp-labels-mode"]');
    radios.forEach(function (radio) {
      if (radio.value === ArpVpLabels._mode) radio.checked = true;
      radio.addEventListener('change', function () { ArpVpLabels.setMode(radio.value); });
    });
    var sel = container.querySelector('[data-arp-labels-size]');
    if (sel) {
      sel.value = ArpVpLabels._fontSize;
      sel.addEventListener('change', function () { ArpVpLabels.setFontSize(sel.value); });
    }
    refreshPanel();
    return true;
  };

  /* ---------- Đăng ký layer (defensive) ---------- */

  if (PixiStudio.ArpViewport && typeof PixiStudio.ArpViewport.registerLayer === 'function') {
    try {
      PixiStudio.ArpViewport.registerLayer('labels', {
        show: function (t, o) { return ArpVpLabels.show(t, o); },
        hide: function () { return ArpVpLabels.hide(); },
        isVisible: function () { return ArpVpLabels.isVisible(); },
        label: 'Nhãn xương'
      });
      ArpVpLabels._registered = true;
    } catch (e) { ArpVpLabels._registered = false; }
  }

  /* ---------- Nối chọn xương trong viewport -> mode 'selected' ---------- */
  /* ArpVpSelect phát bus 'arpvpselect:select' {bone: tên gọn, fullName} khi
     user bấm chọn 1 xương trong viewport; nhãn ở mode 'selected' theo đó để
     chỉ hiện tên xương đang chọn. Bỏ chọn thì setSelectedBone(null). */
  try {
    var _bus = PixiStudio.bus;
    if (_bus && typeof _bus.on === 'function') {
      _bus.on('arpvpselect:select', function (d) {
        try { ArpVpLabels.setSelectedBone(d && (d.bone || d.fullName || d.name) || null); } catch (e) {}
      });
      _bus.on('arpvpselect:deselect', function () {
        try { ArpVpLabels.setSelectedBone(null); } catch (e) {}
      });
      /* FIX (ARP View vòng 1): nhãn TỰ HIỆN sau mọi đường rig (Smart +
         QuickRig Convert/AutoGen/Mixamo) — trước đây labels KHÔNG
         listen 'arp:rig-complete'; đường duy nhất là preset Rigging
         auto-áp, mà preset này cố tình bỏ qua mọi rig từ QuickRig nên
         nhãn không bao giờ tự hiện sau QuickRig. Dùng autoShow() để
         vẫn tôn trọng cờ tắt-tay-trong-phiên của đúng model đó. */
      var _onRigComplete = function (d) {
        try {
          d = d || {};
          var target = d.target || null;
          if (!target && d.rootBone) target = d.rootBone;
          if (!target && d.rig && d.rig.rootBone) target = d.rig.rootBone;
          if (!target && d.rig && d.rig.group) target = d.rig.group;
          ArpVpLabels.autoShow(target || undefined);
        } catch (e) {}
      };
      _bus.on('arp:rig-complete', _onRigComplete);
      _bus.on('autorigpro:done', _onRigComplete);
      _bus.on('arpquickrig:converted', _onRigComplete);
      _bus.on('arpquickrig:autogen-done', _onRigComplete);
      _bus.on('arpquickrig:mixamo-done', _onRigComplete);
      ArpVpLabels._onRigComplete = _onRigComplete;
    }
  } catch (e) {}

  /* Test hooks */
  ArpVpLabels._test = {
    stripName: stripName,
    MAIN_BONES: MAIN_BONES,
    MODES: MODES,
    MODE_LABELS: MODE_LABELS,
    FONT_SIZES: FONT_SIZES,
    collectBones: collectBones,
    climbToRigged: climbToRigged,
    getTargetFn: getTarget,
    makeLabelTexture: makeLabelTexture,
    getLabels: function () { return ArpVpLabels._labels; },
    getGroup: function () { return ArpVpLabels._group; },
    getTarget: function () { return ArpVpLabels._target; },
    getFingerprint: function () { return ArpVpLabels._fingerprint; },
    getModelHeight: function () { return ArpVpLabels._modelHeight; }
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpVpLabels = ArpVpLabels;
})();
