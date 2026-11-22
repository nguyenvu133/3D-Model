/* ============================================================
 * animation/presets.js — 16 preset animation procedural THẬT
 * Sinh THREE.AnimationClip keyframe tracks (position/rotation).
 * ============================================================ */
(function () {
  'use strict';

  /* Helper: tạo VectorKeyframeTrack/QuaternionKeyframeTrack nhanh.
     QUAN TRỌNG: three.js cần mảng SỐ PHẲNG (Vector 3×n, Quaternion 4×n).
     Nếu truyền mảng LỒNG [quat, quat, …] thì `new Float32Array(values)` sẽ cho
     toàn NaN với length = số quaternion → KeyframeTrack.getValueSize() =
     values.length/times.length = 1 (thay vì 4) → vòng lặp trong
     QuaternionLinearInterpolant.interpolate_ (offset += 4 vs end = offset + 1)
     KHÔNG BAO GIỜ KẾT THÚC → treo cứng cả app. Vì vậy mọi giá trị đều đi qua
     fitValues() để làm phẳng + bảo đảm độ dài = times.length × size. */
  function fitValues(times, values, size) {
    const need = times.length * size;
    const def = function (k) { return (size === 4 && k === 3) ? 1 : 0; };
    let flat = values;
    if (values.length && Array.isArray(values[0])) {
      flat = [];
      values.forEach(function (v) { for (let i = 0; i < size; i++) flat.push(v[i]); });
    }
    /* loại bỏ mọi giá trị không hữu hạn — NaN làm three.js lặp vô hạn */
    flat = Array.prototype.map.call(flat, function (x, i) {
      return (typeof x === 'number' && isFinite(x)) ? x : def(i % size);
    });
    if (flat.length === need) return flat;
    const out = flat.slice(0, need);
    /* thiếu → lặp lại frame cuối, TỪNG THÀNH PHẦN MỘT (không vượt quá need) */
    const lastFrame = flat.length >= size ? flat.slice(flat.length - size) : null;
    while (out.length < need) {
      const k = out.length % size;
      out.push(lastFrame ? lastFrame[k] : def(k));
    }
    return out;
  }
  function posTrack(times, values) {
    return new THREE.VectorKeyframeTrack('.position', times, fitValues(times, values, 3));
  }
  function rotTrack(times, values) {
    return new THREE.QuaternionKeyframeTrack('.quaternion', times, fitValues(times, values, 4));
  }

  function quat(x, y, z, deg) {
    const q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z)));
    return q.toArray();
  }

  /* Sinh chuỗi time đều đặn cho n keyframe trong duration giây */
  function times(n, duration) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(duration * i / (n - 1));
    return out;
  }

  const Presets = {};

  /* Mỗi generator trả về THREE.AnimationClip cho object đích */
  const GEN = {
    idle: function () {
      const d = 2.4, t = times(5, d);
      return new THREE.AnimationClip('Idle', d, [
        posTrack(t, [0, 0, 0, 0, 0.045, 0, 0, 0, 0, 0, 0.045, 0, 0, 0, 0]),
        rotTrack(t, [
          quat(0, 0, 0), quat(0, 2.2, 0), quat(0, 0, 0), quat(0, -2.2, 0), quat(0, 0, 0)
        ])
      ]);
    },
    walk: function () {
      const d = 1.0, t = times(9, d);
      return new THREE.AnimationClip('Walk', d, [
        posTrack(t, [0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0, 0.05, 0, 0, 0, 0]),
        rotTrack(t, [
          quat(0, 0, 0), quat(0, 6, 0), quat(0, 0, 0), quat(0, -6, 0), quat(0, 0, 0),
          quat(0, 6, 0), quat(0, 0, 0), quat(0, -6, 0), quat(0, 0, 0)
        ])
      ]);
    },
    run: function () {
      const d = 0.7, t = times(7, d);
      return new THREE.AnimationClip('Run', d, [
        posTrack(t, [0, 0, 0, 0, 0.12, 0, 0, 0, 0, 0, 0.12, 0, 0, 0, 0, 0, 0.12, 0, 0, 0, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(4, 14, 0), quat(0, 0, 0), quat(-4, -14, 0), quat(0, 0, 0), quat(4, 14, 0), quat(0, 0, 0)])
      ]);
    },
    jump: function () {
      const d = 0.9, t = times(7, d);
      return new THREE.AnimationClip('Jump', d, [
        posTrack(t, [0, 0, 0, 0, 0.02, 0, 0, 0.6, 0, 0, 1.1, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(0, 0, 6), quat(-8, 0, 0), quat(-8, 0, 0), quat(6, 0, 0), quat(0, 0, 0), quat(0, 0, 0)])
      ]);
    },
    attack: function () {
      const d = 0.8, t = times(6, d);
      return new THREE.AnimationClip('Attack', d, [
        posTrack(t, [0, 0, 0, 0, 0, 0, 0, 0.1, 0.12, 0, 0, 0.16, 0, 0, 0, 0, 0, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(0, -30, 0), quat(0, 60, 0), quat(0, 25, 0), quat(0, 0, 0), quat(0, 0, 0)])
      ]);
    },
    heavyAttack: function () {
      const d = 1.3, t = times(7, d);
      return new THREE.AnimationClip('Heavy Attack', d, [
        posTrack(t, [0, 0, 0, 0, -0.05, 0, 0, 0.2, 0.3, 0, 0, 0.4, 0, 0, 0.1, 0, 0, 0, 0, 0, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(0, -55, 8), quat(0, 80, -6), quat(0, 30, 0), quat(0, 8, 0), quat(0, 0, 0), quat(0, 0, 0)])
      ]);
    },
    combo: function () {
      const d = 1.6, t = times(9, d);
      return new THREE.AnimationClip('Combo Attack', d, [
        posTrack(t, [0, 0, 0, 0, 0.08, 0.1, 0, 0, 0.12, 0, 0, 0, 0, 0.1, -0.12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(0, -35, 0), quat(0, 45, 0), quat(0, -10, 0), quat(0, 50, 0), quat(0, -45, 0), quat(0, 10, 0), quat(0, 0, 0), quat(0, 0, 0)])
      ]);
    },
    block: function () {
      const d = 1.0, t = times(4, d);
      return new THREE.AnimationClip('Block', d, [
        posTrack(t, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(0, 18, 0), quat(0, 18, 0), quat(0, 0, 0)])
      ]);
    },
    dodge: function () {
      const d = 0.7, t = times(5, d);
      return new THREE.AnimationClip('Dodge', d, [
        posTrack(t, [0, 0, 0, -0.5, 0, 0, -0.7, 0, 0, -0.4, 0, 0, 0, 0, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(0, 0, -14), quat(0, 0, -18), quat(0, 0, -6), quat(0, 0, 0)])
      ]);
    },
    roll: function () {
      const d = 0.8, t = times(6, d);
      return new THREE.AnimationClip('Roll', d, [
        posTrack(t, [0, 0, 0, 0, 0.35, 0.2, 0, 0.1, 0.45, 0, 0.2, 0.25, 0, 0, 0, 0, 0, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(-90, 0, 0), quat(-180, 0, 0), quat(-270, 0, 0), quat(-360, 0, 0), quat(-360, 0, 0)])
      ]);
    },
    hit: function () {
      const d = 0.6, t = times(4, d);
      return new THREE.AnimationClip('Hit Reaction', d, [
        posTrack(t, [0, 0, 0, 0, -0.04, -0.12, 0, 0, 0.06, 0, 0, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(-14, 0, 6), quat(-6, 0, 3), quat(0, 0, 0)])
      ]);
    },
    death: function () {
      const d = 1.6, t = times(6, d);
      return new THREE.AnimationClip('Death', d, [
        posTrack(t, [0, 0, 0, 0, -0.3, 0, 0, -0.8, 0, 0, -0.95, 0, 0, -0.95, 0, 0, -0.95, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(-30, 0, 10), quat(-70, 0, 40), quat(-86, 0, 60), quat(-90, 0, 60), quat(-90, 0, 60)])
      ]);
    },
    victory: function () {
      const d = 1.8, t = times(6, d);
      return new THREE.AnimationClip('Victory', d, [
        posTrack(t, [0, 0, 0, 0, 0.18, 0, 0, 0.05, 0, 0, 0.18, 0, 0, 0.05, 0, 0, 0, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(0, 0, -8), quat(0, 0, 8), quat(0, 0, -8), quat(0, 0, 8), quat(0, 0, 0)])
      ]);
    },
    dance: function () {
      const d = 2.0, t = times(9, d);
      return new THREE.AnimationClip('Dance', d, [
        posTrack(t, [0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0, 0.1, 0, 0, 0, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(0, 15, -6), quat(0, -15, 6), quat(0, 15, -6), quat(0, -15, 6), quat(0, 15, -6), quat(0, -15, 6), quat(0, 15, -6), quat(0, 0, 0)])
      ]);
    },
    skill: function () {
      const d = 1.4, t = times(6, d);
      return new THREE.AnimationClip('Skill', d, [
        posTrack(t, [0, 0, 0, 0, 0.35, 0, 0, 0.5, 0, 0, 0.5, 0, 0, 0.2, 0, 0, 0, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(0, 0, 10), quat(0, 360, 0), quat(0, 720, 0), quat(0, 720, 0), quat(0, 720, 0)])
      ]);
    },
    magic: function () {
      const d = 1.5, t = times(6, d);
      return new THREE.AnimationClip('Magic Attack', d, [
        posTrack(t, [0, 0, 0, 0, 0, 0, 0, 0.15, 0.08, 0, 0.25, 0.1, 0, 0, 0, 0, 0, 0]),
        rotTrack(t, [quat(0, 0, 0), quat(0, -20, 0), quat(-10, -35, 0), quat(10, 20, 0), quat(0, 0, 0), quat(0, 0, 0)])
      ]);
    }
  };

  const META = [
    { id: 'idle', name: 'Idle', icon: 'character', loop: true },
    { id: 'walk', name: 'Walk', icon: 'character', loop: true },
    { id: 'run', name: 'Run', icon: 'character', loop: true },
    { id: 'jump', name: 'Jump', icon: 'character', loop: false },
    { id: 'attack', name: 'Attack', icon: 'swords', loop: false },
    { id: 'heavyAttack', name: 'Heavy Attack', icon: 'swords', loop: false },
    { id: 'combo', name: 'Combo Attack', icon: 'swords', loop: false },
    { id: 'block', name: 'Block', icon: 'collider', loop: true },
    { id: 'dodge', name: 'Dodge', icon: 'cursor', loop: false },
    { id: 'roll', name: 'Roll', icon: 'rotate', loop: false },
    { id: 'hit', name: 'Hit Reaction', icon: 'warning', loop: false },
    { id: 'death', name: 'Death', icon: 'ghost', loop: false },
    { id: 'victory', name: 'Victory', icon: 'crown', loop: true },
    { id: 'dance', name: 'Dance', icon: 'flower', loop: true },
    { id: 'skill', name: 'Skill', icon: 'wand', loop: false },
    { id: 'magic', name: 'Magic Attack', icon: 'fx', loop: false }
  ];

  Presets.META = META;
  Presets.generate = function (id) { return GEN[id] ? GEN[id]() : null; };
  Presets.list = function () { return META.slice(); };

  /* Retarget: khớp tên bone phổ biến (mixamorig, Unreal-style, Unity-style) */
  Presets.RETARGET_MAP = [
    'mixamorig:Hips', 'Hips', 'pelvis', 'Bip01_Pelvis', 'root',
    'mixamorig:Spine', 'Spine', 'spine_01', 'Bip01_Spine',
    'mixamorig:Head', 'Head', 'head', 'Bip01_Head'
  ];

  window.PixiStudio.AnimPresets = Presets;
})();
