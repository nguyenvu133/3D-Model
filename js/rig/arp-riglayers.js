/* ============================================================
 * rig/arp-riglayers.js — RIG LAYER KIỂU RIGIFY (NHÓM 5)
 *
 * Tách rig thành 3 layer (như Rigify trong Blender):
 *   • Deform    — xương skin thật, DUY NHẤT ảnh hưởng mesh.
 *                 = xương trong SkinnedMesh.skeleton.bones, hoặc
 *                 xương nối tới Hips (vd xương đầu ngón / Toe_End
 *                 không có skin weight nhưng vẫn là xương thật).
 *   • Control   — thứ user chạm khi animate: control Object3D của
 *                 Quick Rig (__arp_ctrl_*, __arp_pole_*), Master
 *                 Ctrl_Master của Mixamo Rig plugin, mọi Object3D
 *                 có userData.isArpControl / isArpPole.
 *   • Mechanism — xương trung gian: xương giả __proxy (không có
 *                 skin weight, không nằm trong skeleton.bones),
 *                 xương mồ côi không nối tới Hips và không được
 *                 skin, IK target / pole đã là Bone.
 *
 * Mỗi object chỉ thuộc ĐÚNG 1 layer. User có thể gán tay lại
 * (userData.rigLayer) — gán tay thắng phân loại tự động.
 *
 * EXPORT FBX: chỉ xuất layer Deform. stripNonDeformFromClone()
 * gỡ control group + xương mechanism khỏi bản clone trước khi
 * FBXBinary.write (được save-manager.js/cloneModelForExport gọi —
 * xem khối đánh dấu ARP-RIGLAYERS ở đó). Control là Object3D nên
 * vốn đã không thành xương FBX, nhưng xương __proxy LÀ Bone và
 * FBXBinary.write ghi MỌI Bone nó traverse được — không gỡ thì
 * proxy lọt vào file.
 *
 * BAKE control → deform: dùng QuickRig.bakeToSkeleton() khi có
 * control rig Quick Rig (ghi pose control xuống xương thật);
 * nếu không thì sample pose hiện tại: copy world quaternion của
 * control về local quaternion của xương đích (+ vị trí Hips).
 * GIỚI HẠN TRUNG THỰC: bake ở đây chỉ sample POSE HIỆN TẠI,
 * chưa bake cả clip theo thời gian — muốn bake clip thì dùng
 * bakeClipToDeform() (sample mixer theo frame) hoặc nút Bake
 * của Mixamo Rig plugin (bakeClip) khi clip là clip Mixamo.
 *
 * UI: tab riêng 'riglayers' ("Rig Layer") trong ARP — bật/tắt
 * hiển thị từng layer, preset "chỉ Control khi animate" /
 * "chỉ Deform khi export", màu riêng từng layer, gán tay,
 * nút Bake + nút "Xuất FBX chỉ Deform".
 * ============================================================ */
(function () {
  'use strict';

  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };
  var U = (window.PixiStudio && PixiStudio.Utils) || null;

  /* ---------- Chuẩn 41 xương Mixamo (đồng bộ arp-quickrig.js) ---------- */
  var FALLBACK_DEFS = [
    { name: 'Hips', parent: null }, { name: 'Spine', parent: 'Hips' },
    { name: 'Spine1', parent: 'Spine' }, { name: 'Spine2', parent: 'Spine1' },
    { name: 'Neck', parent: 'Spine2' }, { name: 'Head', parent: 'Neck' },
    { name: 'HeadTop_End', parent: 'Head' },
    { name: 'LeftShoulder', parent: 'Spine2' }, { name: 'LeftArm', parent: 'LeftShoulder' },
    { name: 'LeftForeArm', parent: 'LeftArm' }, { name: 'LeftHand', parent: 'LeftForeArm' },
    { name: 'LeftHandThumb1', parent: 'LeftHand' }, { name: 'LeftHandThumb2', parent: 'LeftHandThumb1' },
    { name: 'LeftHandIndex1', parent: 'LeftHand' }, { name: 'LeftHandIndex2', parent: 'LeftHandIndex1' },
    { name: 'LeftHandMiddle1', parent: 'LeftHand' }, { name: 'LeftHandMiddle2', parent: 'LeftHandMiddle1' },
    { name: 'LeftHandRing1', parent: 'LeftHand' }, { name: 'LeftHandRing2', parent: 'LeftHandRing1' },
    { name: 'LeftHandPinky1', parent: 'LeftHand' },
    { name: 'RightShoulder', parent: 'Spine2' }, { name: 'RightArm', parent: 'RightShoulder' },
    { name: 'RightForeArm', parent: 'RightArm' }, { name: 'RightHand', parent: 'RightForeArm' },
    { name: 'RightHandThumb1', parent: 'RightHand' }, { name: 'RightHandThumb2', parent: 'RightHandThumb1' },
    { name: 'RightHandIndex1', parent: 'RightHand' }, { name: 'RightHandIndex2', parent: 'RightHandIndex1' },
    { name: 'RightHandMiddle1', parent: 'RightHand' }, { name: 'RightHandMiddle2', parent: 'RightHandMiddle1' },
    { name: 'RightHandRing1', parent: 'RightHand' }, { name: 'RightHandRing2', parent: 'RightHandRing1' },
    { name: 'RightHandPinky1', parent: 'RightHand' },
    { name: 'LeftUpLeg', parent: 'Hips' }, { name: 'LeftLeg', parent: 'LeftUpLeg' },
    { name: 'LeftFoot', parent: 'LeftLeg' }, { name: 'LeftToeBase', parent: 'LeftFoot' },
    { name: 'RightUpLeg', parent: 'Hips' }, { name: 'RightLeg', parent: 'RightUpLeg' },
    { name: 'RightFoot', parent: 'RightLeg' }, { name: 'RightToeBase', parent: 'RightFoot' }
  ];
  function boneDefs() {
    var QR = window.PixiStudio && PixiStudio.ArpQuickRig;
    if (QR && QR.BONE_DEFS && QR.BONE_DEFS.length) return QR.BONE_DEFS;
    return FALLBACK_DEFS;
  }
  function standardNames() { return boneDefs().map(function (d) { return d.name; }); }

  var LAYERS = {
    deform: { id: 'deform', label: 'Deform', color: 0x33cc66, css: '#33cc66',
      desc: 'Xương skin thật — duy nhất ảnh hưởng mesh, duy nhất được xuất FBX.' },
    control: { id: 'control', label: 'Control', color: 0x33ccff, css: '#33ccff',
      desc: 'Control user chạm khi animate (Quick Rig + Mixamo Rig Master). Không xuất FBX.' },
    mechanism: { id: 'mechanism', label: 'Mechanism', color: 0xff5599, css: '#ff5599',
      desc: 'Xương trung gian: __proxy, IK target/pole, xương mồ côi. Không xuất FBX.' }
  };
  var LAYER_IDS = ['deform', 'control', 'mechanism'];

  var RigLayers = {
    LAYERS: LAYERS,
    LAYER_IDS: LAYER_IDS,
    visible: { deform: true, control: true, mechanism: true },
    manualOverrides: {}, /* object uuid -> layer (gán tay) */
    lastAnalysis: null
  };

  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message }); } catch (e) {}
  }
  function stripName(name) {
    var s = String(name == null ? '' : name);
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    s = s.replace(/__proxy$/i, '');
    return s;
  }
  RigLayers.stripName = stripName;

  /* Traverse có chống vòng lặp (rig bị phá có thể có cycle parent). */
  function traverseSafe(root, fn) {
    var seen = {};
    var stack = [root];
    while (stack.length) {
      var o = stack.pop();
      if (!o || seen[o.uuid]) continue;
      seen[o.uuid] = true;
      fn(o);
      var kids = o.children || [];
      for (var i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
  }
  function collectBones(root) {
    var out = [];
    if (!root) return out;
    if (root.isBone) return [root];
    if (root.traverse) traverseSafe(root, function (o) { if (o.isBone) out.push(o); });
    return out;
  }
  RigLayers.collectBones = collectBones;

  function getTarget(target) {
    if (target) return target;
    var QR = window.PixiStudio && PixiStudio.ArpQuickRig;
    if (QR && QR.current && QR.current.target) return QR.current.target;
    if (window.PixiStudio && PixiStudio.Viewport && PixiStudio.Viewport.getMainModel) {
      try { return PixiStudio.Viewport.getMainModel(); } catch (e) {}
    }
    return null;
  }

  /* Tập xương được skin + tập xương nối tới Hips (đi xuống theo con). */
  function rigContext(target) {
    var skinned = {}, skinnedList = [];
    traverseSafe(target, function (o) {
      if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones) {
        o.skeleton.bones.forEach(function (b) { if (b && !skinned[b.uuid]) { skinned[b.uuid] = true; skinnedList.push(b); } });
      }
    });
    var hips = null;
    collectBones(target).forEach(function (b) { if (!hips && stripName(b.name) === 'Hips') hips = b; });
    var reachable = {};
    if (hips) traverseSafe(hips, function (o) { if (o.isBone) reachable[o.uuid] = true; });
    return { skinned: skinned, skinnedList: skinnedList, hips: hips, reachable: reachable };
  }

  function isProxyBone(o) {
    if (!o) return false;
    if (o.userData && o.userData.isProxy) return true;
    return /__proxy$/i.test(String(o.name || ''));
  }
  function isControlObject(o) {
    if (!o || o.isBone) return false;
    var ud = o.userData || {};
    if (ud.isArpControl || ud.isArpPole || ud.isMixamoRigMaster) return true;
    var n = String(o.name || '');
    if (/^__arp_ctrl_/.test(n) || /^__arp_pole_/.test(n) || /^__arp_ctrl_rig__$/.test(n)) return true;
    if (n === 'Ctrl_Master') return true;
    var QR = window.PixiStudio && PixiStudio.ArpQuickRig;
    if (QR && QR.current) {
      var ctrls = QR.current.controls || {}, poles = QR.current.poles || {};
      var k;
      for (k in ctrls) if (ctrls[k] === o) return true;
      for (k in poles) if (poles[k] === o) return true;
      if (QR.current.controlGroup === o) return true;
    }
    return false;
  }

  /* Phân loại 1 object. Gán tay (userData.rigLayer) thắng tự động. */
  function classify(obj, ctx) {
    if (!obj) return null;
    var manual = (obj.userData && obj.userData.rigLayer) || RigLayers.manualOverrides[obj.uuid];
    if (manual && LAYERS[manual]) return { layer: manual, reason: 'manual' };
    if (obj.isBone) {
      if (isProxyBone(obj)) return { layer: 'mechanism', reason: 'proxy' };
      if (ctx && ctx.skinned[obj.uuid]) return { layer: 'deform', reason: 'skinned' };
      if (ctx && ctx.reachable[obj.uuid]) return { layer: 'deform', reason: 'connected-to-hips' };
      return { layer: 'mechanism', reason: 'orphan-bone' };
    }
    if (isControlObject(obj)) return { layer: 'control', reason: 'control-object' };
    return null; /* không phải thành phần rig (mesh, group thường...) */
  }
  RigLayers.classify = classify;

  /* Phân layer toàn bộ rig. Mỗi object tối đa 1 layer. */
  function analyze(target) {
    target = getTarget(target);
    var result = { ok: false, target: target, layers: { deform: [], control: [], mechanism: [] },
      entries: [], counts: { deform: 0, control: 0, mechanism: 0 }, errors: [] };
    if (!target || !target.traverse) { result.errors.push('Chưa có model nào để phân layer.'); return result; }
    var ctx = rigContext(target);
    var seen = {};
    traverseSafe(target, function (o) {
      if (seen[o.uuid]) return;
      seen[o.uuid] = true;
      /* Mesh trang trí của control / viewport (cầu control, skeleton
         display...) không phải thành phần rig — bỏ qua, chỉ lấy
         Object3D control và Bone. Group container __arp_ctrl_rig__
         cũng bỏ qua (18 control + 4 pole bên trong đã tính riêng). */
      if (o.isMesh) return;
      if (o.name === '__arp_ctrl_rig__') return;
      if (!o.isBone && !isControlObject(o)) return;
      var c = classify(o, ctx);
      if (!c) return;
      result.layers[c.layer].push(o);
      result.entries.push({ object: o, name: o.name, layer: c.layer, reason: c.reason });
      result.counts[c.layer]++;
    });
    result.ok = true;
    result.deformBones = result.layers.deform.slice();
    result.ctx = ctx;
    RigLayers.lastAnalysis = result;
    return result;
  }
  RigLayers.analyze = analyze;

  /* Gán tay 1 object sang layer khác (ghi userData.rigLayer). */
  function assignLayer(obj, layer) {
    if (!obj || !LAYERS[layer]) return { ok: false, error: 'Layer không hợp lệ: ' + layer };
    try { obj.userData = obj.userData || {}; obj.userData.rigLayer = layer; } catch (e) {}
    RigLayers.manualOverrides[obj.uuid] = layer;
    try { bus.emit('arp:riglayers-changed', { object: obj.name, layer: layer }); } catch (e) {}
    return { ok: true, object: obj.name, layer: layer };
  }
  RigLayers.assignLayer = assignLayer;

  function clearManualOverride(obj) {
    if (!obj) return false;
    try { if (obj.userData) delete obj.userData.rigLayer; } catch (e) {}
    delete RigLayers.manualOverrides[obj.uuid];
    return true;
  }
  RigLayers.clearManualOverride = clearManualOverride;

  /* ---------- Hiển thị từng layer trong viewport ---------- */
  function setLayerVisible(layer, visible, target) {
    if (!LAYERS[layer]) return { ok: false, error: 'Layer không hợp lệ: ' + layer };
    RigLayers.visible[layer] = !!visible;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('pixistudio.arp-riglayers-visible', JSON.stringify(RigLayers.visible));
      }
    } catch (e) {}
    target = getTarget(target);
    var changed = 0;
    if (target) {
      var a = analyze(target);
      a.layers[layer].forEach(function (o) {
        try {
          if (layer === 'deform') {
            /* Xương deform không có mesh riêng để ẩn — ẩn/hiện
               skeleton display đại diện cho layer này. */
            var SK = window.PixiStudio && PixiStudio.ArpVpSkeleton;
            if (SK && typeof SK.setVisible === 'function') { SK.setVisible(!!visible); changed++; }
          } else {
            o.visible = !!visible;
            changed++;
          }
        } catch (e) {}
      });
      /* Control group: ẩn/hiện cả nhóm cho chắc (control Object3D
         đã được set ở trên, nhưng group có thể chứa pole...). */
      var QR = window.PixiStudio && PixiStudio.ArpQuickRig;
      if (QR && QR.current && QR.current.controlGroup && layer === 'control') {
        try { QR.current.controlGroup.visible = !!visible; } catch (e) {}
      }
    }
    try { bus.emit('arp:riglayers-visibility', { layer: layer, visible: !!visible }); } catch (e) {}
    return { ok: true, layer: layer, visible: !!visible, changed: changed };
  }
  RigLayers.setLayerVisible = setLayerVisible;

  /* Preset hiển thị: 'animate' = chỉ Control; 'export' = chỉ Deform
     (display); 'full' = hiện tất cả. */
  function applyVisibilityPreset(preset, target) {
    var map = {
      animate: { deform: false, control: true, mechanism: false },
      export: { deform: true, control: false, mechanism: false },
      full: { deform: true, control: true, mechanism: true }
    };
    var m = map[preset];
    if (!m) return { ok: false, error: 'Preset không hợp lệ: ' + preset };
    var out = {};
    LAYER_IDS.forEach(function (id) { out[id] = setLayerVisible(id, m[id], target); });
    return { ok: true, preset: preset, results: out };
  }
  RigLayers.applyVisibilityPreset = applyVisibilityPreset;

  /* Tô màu control / pole theo màu layer (giữ màu gốc để khôi phục). */
  function applyLayerColors(target) {
    target = getTarget(target);
    if (!target) return { ok: false, error: 'Chưa có model.' };
    var a = analyze(target);
    var painted = 0;
    a.entries.forEach(function (e) {
      if (e.layer === 'deform') return;
      var color = LAYERS[e.layer].color;
      (e.object.children || []).forEach(function (child) {
        if (child.isMesh && child.material && child.material.color) {
          if (child.userData._origColor === undefined) child.userData._origColor = child.material.color.getHex();
          child.material.color.setHex(color);
          painted++;
        }
      });
    });
    return { ok: true, painted: painted };
  }
  RigLayers.applyLayerColors = applyLayerColors;

  /* ---------- Bake control → deform (pose hiện tại) ---------- */
  function bakeControlToDeform(target, opts) {
    opts = opts || {};
    target = getTarget(target);
    if (!target) return { ok: false, error: 'Chưa có model để bake.' };
    var QR = window.PixiStudio && PixiStudio.ArpQuickRig;
    if (QR && QR.current && QR.current.target === target && typeof QR.bakeToSkeleton === 'function' && !opts.forceSimple) {
      try {
        var r = QR.bakeToSkeleton();
        if (r && r.ok) { r.method = 'quickrig-bake'; return r; }
      } catch (e) { /* rơi xuống bake đơn giản bên dưới */ }
    }
    /* Bake đơn giản: sample pose hiện tại — copy world quaternion của
       từng control về local quaternion của xương đích (+ vị trí Hips).
       CHƯA bake cả clip theo thời gian (xem bakeClipToDeform). */
    if (!window.THREE) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    target.updateMatrixWorld(true);
    var a = analyze(target);
    var byDst = {};
    var cur = QR && QR.current && QR.current.target === target ? QR.current : null;
    if (cur) {
      Object.keys(cur.controls || {}).forEach(function (dst) { byDst[dst] = cur.controls[dst]; });
    } else {
      a.layers.control.forEach(function (o) {
        var dst = (o.userData && o.userData.dstBone) || stripName(String(o.name || '').replace(/^__arp_ctrl_/, ''));
        if (dst) byDst[dst] = o;
      });
    }
    var bonesByName = {};
    collectBones(target).forEach(function (b) { bonesByName[stripName(b.name)] = b; });
    var baked = [];
    var qWorld = new window.THREE.Quaternion(), qParent = new window.THREE.Quaternion(), qLocal = new window.THREE.Quaternion();
    var vWorld = new window.THREE.Vector3();
    Object.keys(byDst).forEach(function (dst) {
      var bone = bonesByName[dst], ctrl = byDst[dst];
      if (!bone || !ctrl) return;
      try {
        ctrl.getWorldQuaternion(qWorld);
        if (bone.parent) { bone.parent.getWorldQuaternion(qParent); qParent.invert(); qLocal.copy(qParent).multiply(qWorld); }
        else qLocal.copy(qWorld);
        bone.quaternion.copy(qLocal);
        if (dst === 'Hips') {
          ctrl.getWorldPosition(vWorld);
          if (bone.parent) bone.parent.worldToLocal(vWorld);
          bone.position.copy(vWorld);
        }
        baked.push(dst);
      } catch (e) {}
    });
    target.updateMatrixWorld(true);
    try { bus.emit('arp:riglayers-baked', { baked: baked, method: 'simple-pose-sample' }); } catch (e) {}
    return { ok: true, baked: baked, method: 'simple-pose-sample', note: 'Chỉ sample pose hiện tại, chưa bake cả clip.' };
  }
  RigLayers.bakeControlToDeform = bakeControlToDeform;

  /* Bake 1 clip xuống track xương deform bằng cách sample mixer theo
     từng frame. Dùng khi clip đang phát/điều khiển qua control rig:
     mỗi frame, pose xương deform hiện tại được ghi thành keyframe. */
  function bakeClipToDeform(target, clip, opts) {
    opts = opts || {};
    target = getTarget(target);
    if (!target || !clip) return { ok: false, error: 'Thiếu model hoặc clip để bake.' };
    var MR = window.PixiStudio && PixiStudio.ArpPluginMixamoRig;
    if (MR && typeof MR.bakeClip === 'function' && opts.preferMixamoRig !== false) {
      try {
        var mr = MR.bakeClip(clip.name, { fps: opts.fps || 30, name: (clip.name || 'Clip') + '_Baked' });
        if (mr && mr.ok) { mr.method = 'mixamorig-bakeClip'; return mr; }
      } catch (e) { /* rơi xuống sample mixer bên dưới */ }
    }
    if (!window.THREE) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var T = window.THREE;
    var fps = opts.fps || 30;
    var duration = clip.duration || 0;
    if (duration <= 0) return { ok: false, error: 'Clip không có độ dài.' };
    var frames = Math.max(2, Math.round(duration * fps) + 1);
    var a = analyze(target);
    var deformBones = a.layers.deform;
    if (!deformBones.length) return { ok: false, error: 'Không có xương Deform để bake.' };
    var mixer = new T.AnimationMixer(target);
    var action = mixer.clipAction(clip);
    action.play();
    mixer.update(0);
    var times = [], quatData = {}, posData = {};
    deformBones.forEach(function (b) { quatData[b.uuid] = []; posData[b.uuid] = []; });
    var dt = 1 / fps;
    for (var f = 0; f < frames; f++) {
      var t = Math.min(duration, f * dt);
      times.push(t);
      if (f > 0) mixer.update(dt);
      target.updateMatrixWorld(true);
      deformBones.forEach(function (b) {
        quatData[b.uuid].push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        posData[b.uuid].push(b.position.x, b.position.y, b.position.z);
      });
    }
    action.stop();
    try { mixer.uncacheClip(clip); } catch (e) {}
    var tracks = [];
    deformBones.forEach(function (b) {
      tracks.push(new T.QuaternionKeyframeTrack(b.name + '.quaternion',
        new Float32Array(times), new Float32Array(quatData[b.uuid])));
      /* Chỉ ghi track position cho Hips (root motion) — các xương
         khác giữ position bind để file gọn. */
      if (stripName(b.name) === 'Hips') {
        tracks.push(new T.VectorKeyframeTrack(b.name + '.position',
          new Float32Array(times), new Float32Array(posData[b.uuid])));
      }
    });
    var out = new T.AnimationClip((clip.name || 'Clip') + '_Baked', duration, tracks);
    return { ok: true, name: out.name, clip: out, fps: fps, frames: frames,
      trackCount: tracks.length, deformBones: deformBones.length, method: 'mixer-sample' };
  }
  RigLayers.bakeClipToDeform = bakeClipToDeform;

  /* ---------- Export chỉ Deform ---------- */
  function cloneForExport(root) {
    var SM = window.PixiStudio && PixiStudio.SaveManager;
    /* cloneModelForExport nằm ở SaveManager._optimizeFBX (khối expose
       cho test harness, save-manager.js ~dòng 1683), không nằm trực
       tiếp trên SaveManager. */
    var smClone = SM && (SM.cloneModelForExport ||
      (SM._optimizeFBX && SM._optimizeFBX.cloneModelForExport));
    if (typeof smClone === 'function') {
      try { return smClone(root); } catch (e) { /* fallback clone tay */ }
    }
    var THREE = window.THREE;
    var clone = root.clone(true);
    var origBones = collectBones(root), cloneBones = collectBones(clone);
    var byName = {};
    cloneBones.forEach(function (b) { byName[b.name] = b; });
    var boneMap = new Map();
    origBones.forEach(function (b) { if (byName[b.name]) boneMap.set(b, byName[b.name]); });
    clone.traverse(function (o) {
      if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones) {
        var nb = o.skeleton.bones.map(function (b) { return boneMap.get(b) || b; });
        o.skeleton = new THREE.Skeleton(nb, o.skeleton.boneInverses);
      }
    });
    return clone;
  }

  /* Gỡ khỏi clone mọi thứ không phải Deform: control group/pole,
     xương mechanism (__proxy / mồ côi), mesh hiển thị viewport.
     Được save-manager.js/cloneModelForExport gọi trên mọi bản clone
     xuất (xem khối ARP-RIGLAYERS ở đó) nên cả nút export thường
     cũng không lọt control/mechanism. An toàn: chỉ gỡ xương KHÔNG
     nằm trong skeleton.bones của SkinnedMesh — skin không đổi. */
  function stripNonDeformFromClone(clone) {
    if (!clone) return { ok: false, error: 'Không có clone.' };
    var removedBones = [], removedControls = [], removedMeshes = 0;
    var hasSkin = false;
    traverseSafe(clone, function (o) {
      if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones && o.skeleton.bones.length) hasSkin = true;
    });
    var ctx = rigContext(clone);
    var toRemove = [];
    traverseSafe(clone, function (o) {
      if (o.isMesh && o.userData && o.userData.isBoneVisual) { toRemove.push(o); removedMeshes++; return; }
      if (!o.isBone && isControlObject(o)) { toRemove.push(o); removedControls.push(o.name); return; }
      if (o.isBone && hasSkin) {
        if (isProxyBone(o)) { toRemove.push(o); removedBones.push(o.name + ' (proxy)'); return; }
        if (!ctx.skinned[o.uuid] && !ctx.reachable[o.uuid]) { toRemove.push(o); removedBones.push(o.name + ' (orphan)'); return; }
        var manual = (o.userData && o.userData.rigLayer) || RigLayers.manualOverrides[o.uuid];
        if (manual === 'mechanism' || manual === 'control') { toRemove.push(o); removedBones.push(o.name + ' (manual:' + manual + ')'); }
      }
    });
    toRemove.forEach(function (o) { try { if (o.parent) o.parent.remove(o); } catch (e) {} });
    return { ok: true, removedBones: removedBones, removedControls: removedControls, removedMeshes: removedMeshes };
  }
  RigLayers.stripNonDeformFromClone = stripNonDeformFromClone;

  function exportDeformOnly(target, opts) {
    opts = opts || {};
    target = getTarget(target);
    if (!target) return { ok: false, error: 'Chưa có model để xuất.' };
    var W = window.PixiStudio && PixiStudio.FBXBinary;
    if (!W || typeof W.write !== 'function') return { ok: false, error: 'FBXBinary.write chưa sẵn sàng.' };
    if (opts.bakeFirst) { try { bakeControlToDeform(target); } catch (e) {} }
    var before = analyze(target);
    var clone = cloneForExport(target);
    var strip = stripNonDeformFromClone(clone);
    var anims = opts.animations !== undefined ? opts.animations : (target.animations || []);
    var res = W.write(clone, {
      version: opts.version || 7300, upAxis: 'Y',
      animations: anims && anims.length ? anims : undefined
    });
    if (!res || !res.bytes) return { ok: false, error: 'FBXBinary.write không trả bytes.' };
    var exportedBones = res.report ? res.report.bones : collectBones(clone).length;
    return { ok: true, bytes: res.bytes, report: res.report || null,
      deformCount: before.counts.deform, exportedBoneCount: exportedBones,
      stripped: strip, method: 'deform-only-clone' };
  }
  RigLayers.exportDeformOnly = exportDeformOnly;

  /* ---------- UI: tab 'riglayers' ---------- */
  function el(tag, attrs, children) {
    if (U && typeof U.el === 'function') return U.el(tag, attrs, children);
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null) return;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    }
    return node;
  }

  function render(container) {
    if (!container) return;
    container.innerHTML = '';
    var msg = el('div', { class: 'arp-note', id: 'arp-rl-msg' });
    function say(t) { msg.textContent = t; }
    container.appendChild(el('div', { class: 'arp-note', html:
      '<b>Rig Layer (kiểu Rigify):</b> Deform = xương skin thật (duy nhất xuất FBX) · ' +
      'Control = thứ user chạm khi animate · Mechanism = xương trung gian (__proxy, pole). ' +
      'Mỗi object chỉ ở 1 layer.' }));
    var listEl = el('div', { id: 'arp-rl-list' });
    var refreshBtn = el('button', { class: 'arp-btn', text: '🔄 Phân layer lại', onclick: function () { refresh(); } });
    var presetRow = el('div', { class: 'arp-rl-row' });
    [['animate', '🎬 Chỉ Control (animate)'], ['export', '📦 Chỉ Deform (export)'], ['full', '👁 Hiện tất cả']].forEach(function (p) {
      presetRow.appendChild(el('button', { class: 'arp-btn', text: p[1], onclick: function () {
        var r = applyVisibilityPreset(p[0]);
        say(r.ok ? 'Đã áp preset hiển thị: ' + p[0] + '.' : 'Lỗi: ' + (r.error || ''));
        refresh();
      } }));
    });
    var colorBtn = el('button', { class: 'arp-btn', text: '🎨 Tô màu theo layer', onclick: function () {
      var r = applyLayerColors();
      say(r.ok ? ('Đã tô màu ' + r.painted + ' mesh control/pole theo layer.') : ('Lỗi: ' + (r.error || '')));
    } });
    var bakeBtn = el('button', { class: 'arp-btn', text: '🔥 Bake control → Deform (pose hiện tại)', onclick: function () {
      var r = bakeControlToDeform();
      say(r.ok ? ('Đã bake ' + (r.baked ? r.baked.length : 0) + ' mục xuống Deform (' + (r.method || '') + ').') : ('Lỗi bake: ' + (r.error || '')));
    } });
    var exportBtn = el('button', { class: 'arp-btn arp-btn-primary', text: '📦 Xuất FBX chỉ Deform', onclick: function () {
      say('Đang xuất FBX chỉ Deform...');
      var r = exportDeformOnly(null, { bakeFirst: true });
      if (!r.ok) { say('Lỗi xuất: ' + (r.error || '')); return; }
      try {
        if (U && typeof U.downloadBlob === 'function') {
          U.downloadBlob(new Blob([r.bytes], { type: 'application/octet-stream' }), 'model-deform-only.fbx');
        }
      } catch (e) {}
      say('Đã xuất FBX chỉ Deform: ' + r.exportedBoneCount + ' xương (Deform: ' + r.deformCount + ').' +
        (r.stripped ? (' Đã gỡ: ' + r.stripped.removedBones.length + ' xương mechanism, ' + r.stripped.removedControls.length + ' control.') : ''));
    } });
    function refresh() {
      listEl.innerHTML = '';
      var target = getTarget();
      if (!target) { listEl.appendChild(el('div', { class: 'arp-note', text: 'Chưa có model — load model đã rig trước.' })); return; }
      var a = analyze(target);
      if (!a.ok) { listEl.appendChild(el('div', { class: 'arp-note', text: 'Lỗi: ' + (a.errors[0] || '') })); return; }
      LAYER_IDS.forEach(function (id) {
        var L = LAYERS[id];
        var row = el('div', { class: 'arp-rl-row' });
        var dot = el('span', { style: 'display:inline-block;width:12px;height:12px;border-radius:50%;background:' + L.css + ';margin-right:6px;' });
        var cb = el('input', { type: 'checkbox' });
        cb.checked = RigLayers.visible[id] !== false;
        cb.addEventListener('change', function () { setLayerVisible(id, cb.checked, target); refresh(); });
        row.appendChild(dot);
        row.appendChild(cb);
        row.appendChild(el('span', { html: '<b>' + L.label + '</b> (' + a.counts[id] + ') — ' + L.desc }));
        listEl.appendChild(row);
      });
      /* Gán tay: chọn object trong rig rồi đổi layer. */
      var selObj = el('select', { class: 'arp-select' });
      a.entries.forEach(function (e) {
        var o = el('option', { value: e.object.uuid, text: e.name + '  [' + e.layer + ']' });
        selObj.appendChild(o);
      });
      var selLayer = el('select', { class: 'arp-select' });
      LAYER_IDS.forEach(function (id) { selLayer.appendChild(el('option', { value: id, text: LAYERS[id].label })); });
      var assignBtn = el('button', { class: 'arp-btn', text: 'Gán layer', onclick: function () {
        var entry = null;
        a.entries.forEach(function (e) { if (e.object.uuid === selObj.value) entry = e; });
        if (!entry) { say('Chưa chọn object.'); return; }
        var r = assignLayer(entry.object, selLayer.value);
        say(r.ok ? ('Đã gán ' + entry.name + ' → ' + LAYERS[selLayer.value].label + '.') : ('Lỗi: ' + (r.error || '')));
        refresh();
      } });
      var assignRow = el('div', { class: 'arp-rl-row' });
      assignRow.appendChild(el('span', { text: 'Gán tay: ' }));
      assignRow.appendChild(selObj);
      assignRow.appendChild(selLayer);
      assignRow.appendChild(assignBtn);
      listEl.appendChild(assignRow);
      say('Đã phân layer: Deform ' + a.counts.deform + ' · Control ' + a.counts.control + ' · Mechanism ' + a.counts.mechanism + '.');
    }
    container.appendChild(refreshBtn);
    container.appendChild(presetRow);
    container.appendChild(colorBtn);
    container.appendChild(bakeBtn);
    container.appendChild(exportBtn);
    container.appendChild(listEl);
    container.appendChild(msg);
    try { refresh(); } catch (e) { say('Lỗi dựng tab Rig Layer: ' + (e && e.message)); }
  }

  try {
    var Panel = window.PixiStudio && PixiStudio.ArpPanel;
    if (Panel && typeof Panel.registerTab === 'function') Panel.registerTab('riglayers', 'Rig Layer', render);
  } catch (e) {}

  RigLayers._test = {
    LAYERS: LAYERS, standardNames: standardNames, rigContext: rigContext,
    isProxyBone: isProxyBone, isControlObject: isControlObject,
    cloneForExport: cloneForExport, render: render
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpRigLayers = RigLayers;
})();
