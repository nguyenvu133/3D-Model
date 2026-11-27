/* ============================================================
 * animation/anim-layers.js — ANIMATION LAYERS (nhiều layer)
 * Nhóm A, vòng Mở rộng Hệ thống Animation.
 *
 * Mở rộng Animator từ Base + 1 Additive thành Base + N layer:
 * mỗi layer có clip riêng, weight (0–1), mask theo nhóm xương,
 * blend mode (override / additive), bật/tắt, thứ tự.
 *
 * CÁCH PHÁT (dùng AnimationMixer hiện có, không viết lại hệ phát):
 *   • override: clip được lọc chỉ còn track của nhóm mask
 *     (maskedClip) rồi phát song song bằng 1 AnimationAction với
 *     weight của layer — xương ngoài mask không bị đụng tới.
 *   • additive: maskedClip → makeAdditive (trừ pose frame đầu)
 *     rồi phát với THREE.AdditiveAnimationBlendMode.
 * Việc tạo/đồng bộ action nằm ở Animator.syncLayerActions()
 * (arp-animator.js); module này chỉ chứa logic thuần + mask.
 *
 * MASK: dùng lại UPPER_BODY/LOWER_BODY của AnimBlender khi có,
 * mở rộng thêm LEFT_ARM / RIGHT_ARM / TORSO / LEGS / HEAD.
 * Tên xương đã strip 'mixamorig:' (vd 'LeftArm'); xương ngón tay
 * khớp theo tiền tố LeftHand/RightHand.
 *
 * LƯU: format mới 'pixistudio-animator-clips-2' (xem Animator
 * .exportLayersJSON/.importLayersJSON) — đọc được cả format cũ
 * 'pixistudio-animator-clips-1' (không có layers → layers=[]).
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • three r128 PropertyMixer chuẩn hóa trọng số các action cùng
 *     track: weight layer không phải tỉ lệ slerp tuyệt đối mà là
 *     tỉ lệ tương đối so với Base (w=1 → layer chiếm ưu thế gần
 *     như hoàn toàn trên xương mask, w=0 → không ảnh hưởng).
 *   • Mask lọc theo tên track, không theo hierarchy: xương con
 *     của xương mask (vd ngón tay của LeftHand) chỉ được tính khi
 *     tên khớp tiền tố tay; xương không có trong nhóm nào (vd xương
 *     phụ custom) không thuộc mask nào ngoài ALL.
 * ============================================================ */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined' && window.PixiStudio) || {};
  var THREE_REF = (typeof window !== 'undefined' && window.THREE) || (typeof THREE !== 'undefined' ? THREE : null);

  var MASKS = {
    ALL: null, /* null = giữ toàn bộ track */
    UPPER_BODY: ['Chest', 'Spine', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder',
      'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand'],
    LOWER_BODY: ['Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg',
      'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'],
    LEFT_ARM: ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'],
    RIGHT_ARM: ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'],
    TORSO: ['Spine', 'Chest'],
    LEGS: ['Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg',
      'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'],
    HEAD: ['Neck', 'Head']
  };
  var MASK_NAMES = ['ALL', 'UPPER_BODY', 'LOWER_BODY', 'LEFT_ARM', 'RIGHT_ARM', 'TORSO', 'LEGS', 'HEAD'];
  var MASK_LABELS = {
    ALL: 'Toàn thân', UPPER_BODY: 'Thân trên', LOWER_BODY: 'Thân dưới',
    LEFT_ARM: 'Tay trái', RIGHT_ARM: 'Tay phải', TORSO: 'Thân (Spine/Chest)',
    LEGS: 'Chân', HEAD: 'Đầu (Neck/Head)'
  };
  var MODES = ['override', 'additive'];
  var _seq = 0;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* 'mixamorig:LeftArm.quaternion' | 'mixamorigLeftArm.quaternion'
     | 'LeftArm.quaternion' → 'LeftArm' (giống AnimBlender.nodeOf). */
  function nodeOf(trackName) {
    var dot = String(trackName || '').indexOf('.');
    var node = dot >= 0 ? String(trackName).slice(0, dot) : String(trackName || '');
    return node.replace(/^mixamorig:?/i, '');
  }

  function boneInMask(bone, maskName) {
    if (!maskName || maskName === 'ALL') return true;
    var list = MASKS[maskName];
    if (!list) return false;
    if (list.indexOf(bone) >= 0) return true;
    /* Xương ngón tay: LeftHandMiddle1… khớp theo tiền tố tay. */
    if (maskName === 'LEFT_ARM' && /^LeftHand/.test(bone)) return true;
    if (maskName === 'RIGHT_ARM' && /^RightHand/.test(bone)) return true;
    if (maskName === 'UPPER_BODY' && (/^LeftHand/.test(bone) || /^RightHand/.test(bone))) return true;
    return false;
  }

  function maskBones(maskName) {
    if (!maskName || maskName === 'ALL') return null;
    var AB = PS.AnimBlender;
    if (maskName === 'UPPER_BODY' && AB && AB.UPPER_BODY) return AB.UPPER_BODY.slice();
    if (maskName === 'LOWER_BODY' && AB && AB.LOWER_BODY) return AB.LOWER_BODY.slice();
    return (MASKS[maskName] || []).slice();
  }

  /* Lọc clip chỉ giữ track của mask. Dùng AnimBlender.maskedClip khi
     mask là upper/lower và module đó đã load; còn lại tự lọc. */
  function maskedClip(clip, maskName) {
    if (!clip || !clip.tracks) return { ok: false, error: 'Clip không có tracks.' };
    if (!maskName || maskName === 'ALL') {
      return { ok: true, clip: clip, kept: clip.tracks.length, removed: 0, masked: false };
    }
    var AB = PS.AnimBlender;
    if (AB && typeof AB.maskedClip === 'function' &&
        (maskName === 'UPPER_BODY' || maskName === 'LOWER_BODY')) {
      var bones = maskName === 'UPPER_BODY' ? AB.UPPER_BODY : AB.LOWER_BODY;
      var r = AB.maskedClip(clip, bones);
      return { ok: true, clip: r.clip, kept: r.kept, removed: r.removed, masked: true };
    }
    var keep = clip.tracks.filter(function (tr) { return boneInMask(nodeOf(tr.name), maskName); });
    var out = clip.clone();
    out.tracks = keep;
    out.name = clip.name + '_masked_' + String(maskName).toLowerCase();
    return { ok: true, clip: out, kept: keep.length, removed: clip.tracks.length - keep.length, masked: true };
  }

  /* Biến clip thành additive (trừ pose frame đầu). Dùng
     AnimBlender.makeAdditive khi có, còn lại tự làm. */
  function makeAdditiveClip(clip) {
    if (!clip || !clip.tracks) return { ok: false, error: 'Clip không có tracks.' };
    var AB = PS.AnimBlender;
    if (AB && typeof AB.makeAdditive === 'function') {
      return { ok: true, clip: AB.makeAdditive(clip) };
    }
    var T = THREE_REF;
    if (!T) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    var out = clip.clone();
    out.tracks = out.tracks.map(function (tr) {
      var t = tr.clone();
      var n = t.values.length;
      var stride = t.getValueSize ? t.getValueSize() : (/quaternion/i.test(tr.name) ? 4 : 3);
      if (/quaternion/i.test(tr.name) && n >= 4) {
        var ref = new T.Quaternion(t.values[0], t.values[1], t.values[2], t.values[3]).invert();
        var q = new T.Quaternion();
        for (var i = 0; i < n; i += 4) {
          q.set(t.values[i], t.values[i + 1], t.values[i + 2], t.values[i + 3]);
          q.premultiply(ref);
          t.values[i] = q.x; t.values[i + 1] = q.y; t.values[i + 2] = q.z; t.values[i + 3] = q.w;
        }
      } else if (stride === 3 && n >= 3) {
        var rx = t.values[0], ry = t.values[1], rz = t.values[2];
        for (var j = 0; j < n; j += 3) {
          t.values[j] -= rx; t.values[j + 1] -= ry; t.values[j + 2] -= rz;
        }
      }
      return t;
    });
    out.name = clip.name + '_additive';
    return { ok: true, clip: out };
  }

  /* Clip hiệu dụng của 1 layer: mask trước, additive sau. */
  function layerClipFor(layer, clip) {
    if (!layer || !clip) return { ok: false, error: 'Thiếu layer hoặc clip.' };
    var m = maskedClip(clip, layer.mask || 'ALL');
    if (!m.ok) return m;
    if ((layer.mode || 'override') === 'additive') {
      var a = makeAdditiveClip(m.clip);
      if (!a.ok) return a;
      return { ok: true, clip: a.clip, kept: m.kept, removed: m.removed, masked: m.masked, mode: 'additive' };
    }
    return { ok: true, clip: m.clip, kept: m.kept, removed: m.removed, masked: m.masked, mode: 'override' };
  }

  /* ---------- Layer thuần (không đụng mixer) ---------- */
  function createLayer(opts) {
    opts = opts || {};
    if (!opts.clipId) return { ok: false, error: 'Layer cần clipId.' };
    var layer = {
      id: opts.id || ('layer_' + (++_seq) + '_' + Date.now().toString(36)),
      clipId: opts.clipId,
      weight: clamp(parseFloat(opts.weight) || 0, 0, 1),
      mask: MASK_NAMES.indexOf(opts.mask) >= 0 ? opts.mask : 'ALL',
      mode: MODES.indexOf(opts.mode) >= 0 ? opts.mode : 'override',
      enabled: opts.enabled !== false
    };
    if (opts.weight === undefined) layer.weight = 1;
    return { ok: true, layer: layer };
  }

  function validateLayer(layer, clipExists) {
    if (!layer || typeof layer !== 'object') return { ok: false, error: 'Layer không phải object.' };
    if (!layer.clipId) return { ok: false, error: 'Layer thiếu clipId.' };
    if (typeof clipExists === 'function' && !clipExists(layer.clipId)) {
      return { ok: false, error: 'Layer trỏ tới clip không tồn tại: ' + layer.clipId };
    }
    if (MASK_NAMES.indexOf(layer.mask) < 0) return { ok: false, error: 'Mask không biết: ' + layer.mask };
    if (MODES.indexOf(layer.mode) < 0) return { ok: false, error: 'Blend mode không biết: ' + layer.mode };
    if (!(layer.weight >= 0 && layer.weight <= 1)) return { ok: false, error: 'Weight phải trong 0–1.' };
    return { ok: true };
  }

  function normalizeLayer(raw) {
    if (!raw || !raw.clipId) return null;
    var c = createLayer(raw);
    if (!c.ok) return null;
    /* Giữ id gốc khi import (để action đang chạy không đứt). */
    if (raw.id) c.layer.id = String(raw.id);
    return c.layer;
  }

  function serializeLayers(layers) {
    return (layers || []).map(function (l) {
      return { id: l.id, clipId: l.clipId, weight: clamp(+l.weight || 0, 0, 1),
        mask: l.mask || 'ALL', mode: l.mode || 'override', enabled: l.enabled !== false };
    });
  }

  function parseLayers(raw) {
    if (!Array.isArray(raw)) return { ok: false, error: 'layers phải là array.', layers: [] };
    var out = [], skipped = [];
    raw.forEach(function (r) {
      var l = normalizeLayer(r);
      if (l) out.push(l);
      else skipped.push(r && r.clipId ? r.clipId : '?');
    });
    return { ok: true, layers: out, skipped: skipped };
  }

  var AnimLayers = {
    MASKS: MASKS,
    MASK_NAMES: MASK_NAMES,
    MASK_LABELS: MASK_LABELS,
    MODES: MODES,
    nodeOf: nodeOf,
    boneInMask: boneInMask,
    maskBones: maskBones,
    maskedClip: maskedClip,
    makeAdditiveClip: makeAdditiveClip,
    layerClipFor: layerClipFor,
    createLayer: createLayer,
    validateLayer: validateLayer,
    normalizeLayer: normalizeLayer,
    serializeLayers: serializeLayers,
    parseLayers: parseLayers
  };

  PS.AnimLayers = AnimLayers;
})();
