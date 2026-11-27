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
    _panelEl: null
  };
  ArpVpLabels.MAIN_BONES = MAIN_BONES;
  ArpVpLabels.MODES = MODES;
  ArpVpLabels.FONT_SIZES = FONT_SIZES;

  function notify(type, title, message, duration) {
    try { bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 }); } catch (e) {}
  }
  function emitChanged() {
    try { bus.emit('arp-vp-labels:changed', ArpVpLabels.getStatus()); } catch (e) {}
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

  function getTarget(target) {
    if (target) return target;
    /* Ưu tiên model ĐANG chọn / đang hiện trong viewport trước — model
       rig ở lần chạy AutoRigPro trước (lastResult) chỉ là fallback cuối,
       nếu không sau khi rig xong rồi chuyển sang model chưa rig khác,
       nhãn sẽ bám nhầm vào model cũ. */
    if (PixiStudio.State && PixiStudio.State.get) {
      var sel = PixiStudio.State.get('selection');
      if (sel) return sel;
    }
    if (PixiStudio.Viewport && PixiStudio.Viewport.getMainModel) {
      var main = PixiStudio.Viewport.getMainModel();
      if (main) return main;
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

  function measureHeight(target) {
    var H = 1.8;
    try {
      if (window.THREE && THREE.Box3) {
        var box = new THREE.Box3();
        box.setFromObject(target);
        var s = box.getSize(new THREE.Vector3());
        if (isFinite(s.y) && s.y > 0.01) H = s.y;
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
        texture: made.texture, canvas: made.canvas, height: labelH
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
    ArpVpLabels._visible = true;
    if (ArpVpLabels._group) ArpVpLabels._group.visible = true;
    updatePositions();
    emitChanged();
    refreshPanel();
    return { ok: true, boneCount: bones.length, labelCount: ArpVpLabels._labels.length, visibleCount: visibleCount(), mode: ArpVpLabels._mode, fontSize: ArpVpLabels._fontSize };
  };

  ArpVpLabels.hide = function () {
    ArpVpLabels._visible = false;
    if (ArpVpLabels._group) ArpVpLabels._group.visible = false;
    emitChanged();
    refreshPanel();
    return true;
  };

  ArpVpLabels.isVisible = function () { return !!ArpVpLabels._visible; };

  ArpVpLabels.toggle = function (target) {
    if (ArpVpLabels._visible) { ArpVpLabels.hide(); return { ok: true, visible: false }; }
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

  /* Đặt sprite đúng vị trí khớp (world + nhích lên trên 1 chút).
     Group gắn vào scene → dùng trực tiếp world position; nếu group
     gắn vào target (fallback khi chưa có scene) thì đổi về local. */
  function updatePositions() {
    if (!ArpVpLabels._group || !ArpVpLabels._labels.length) return 0;
    var v = tmpVec();
    if (!v) return 0;
    var n = 0;
    ArpVpLabels._labels.forEach(function (L) {
      if (!L.sprite.visible) return;
      L.bone.getWorldPosition(v);
      v.y += L.height * 0.55;
      if (ArpVpLabels._group.parent === ArpVpLabels._target && ArpVpLabels._target.worldToLocal) {
        L.sprite.position.copy(ArpVpLabels._target.worldToLocal(v.clone()));
      } else {
        L.sprite.position.copy(v);
      }
      n++;
    });
    return n;
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
