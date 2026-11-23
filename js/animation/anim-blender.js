/* ============================================================
 * animation/anim-blender.js — Animation Blender (v21.0)
 *
 * Trộn clip thật bằng AnimationMixer của three r128:
 *  - Crossfade: chuyển mượt clip A -> B trong N giây (ramp weight).
 *  - Mask blend: clip overlay chỉ áp lên nhóm xương chọn (trên/dưới
 *    thân) — lọc track theo tên bone rồi phát song song với clip nền.
 *  - Additive: clip cộng thêm (đấm trong lúc chạy) — trừ pose gốc
 *    rồi phát với AdditiveAnimationBlendMode.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;

  const UPPER_BODY = ['Chest', 'Spine', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder',
    'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand'];
  const LOWER_BODY = ['Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg',
    'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];

  const AnimBlender = {
    fade: null,      // {from, to, t, duration, active}
    overlays: []     // {action, clipId, kind}
  };

  AnimBlender.UPPER_BODY = UPPER_BODY;
  AnimBlender.LOWER_BODY = LOWER_BODY;

  function rig() {
    return PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
  }
  function clipById(id) {
    const r = rig();
    if (!r || !r.clips) return null;
    return r.clips.find(function (c) { return c.id === id; }) || null;
  }
  function nodeOf(trackName) {
    // 'mixamorig:LeftArm.quaternion' | 'LeftArm.quaternion' -> 'LeftArm'
    const dot = trackName.indexOf('.');
    const node = dot >= 0 ? trackName.slice(0, dot) : trackName;
    return node.replace(/^mixamorig:/, '');
  }

  /* Lọc clip chỉ giữ track của nhóm xương cho trước. */
  AnimBlender.maskedClip = function (clip, boneNames) {
    const keep = clip.tracks.filter(function (tr) {
      return boneNames.indexOf(nodeOf(tr.name)) >= 0;
    });
    const out = clip.clone();
    out.tracks = keep;
    out.name = clip.name + '_masked';
    return { clip: out, kept: keep.length, removed: clip.tracks.length - keep.length };
  };

  /* Biến clip thành additive: trừ keyframe đầu (pose gốc) khỏi mọi keyframe.
     Quaternion: q' = q_ref^-1 * q ; Vector: v' = v - v_ref. */
  AnimBlender.makeAdditive = function (clip) {
    const out = clip.clone();
    out.tracks = out.tracks.map(function (tr) {
      const t = tr.clone();
      const n = t.values.length;
      const stride = t.getValueSize ? t.getValueSize() : (tr.name.indexOf('quaternion') >= 0 ? 4 : 3);
      if (tr.name.indexOf('quaternion') >= 0 && n >= 4) {
        const ref = new THREE.Quaternion(t.values[0], t.values[1], t.values[2], t.values[3]).invert();
        const q = new THREE.Quaternion();
        for (let i = 0; i < n; i += 4) {
          q.set(t.values[i], t.values[i + 1], t.values[i + 2], t.values[i + 3]);
          q.premultiply(ref);
          t.values[i] = q.x; t.values[i + 1] = q.y; t.values[i + 2] = q.z; t.values[i + 3] = q.w;
        }
      } else if (stride === 3 && n >= 3) {
        const rx = t.values[0], ry = t.values[1], rz = t.values[2];
        for (let i = 0; i < n; i += 3) {
          t.values[i] -= rx; t.values[i + 1] -= ry; t.values[i + 2] -= rz;
        }
      }
      return t;
    });
    out.name = clip.name + '_additive';
    return out;
  };

  function actionFor(entry, loop) {
    const r = rig();
    const mixer = r.mixer;
    if (!mixer._actions) mixer._actions = {};
    let action = mixer._actions['blend:' + entry.id];
    if (!action) {
      action = mixer.clipAction(entry.clip);
      mixer._actions['blend:' + entry.id] = action;
    }
    action.reset();
    action.setLoop(loop === undefined ? (entry.loop ? THREE.LoopRepeat : THREE.LoopOnce) : loop);
    action.clampWhenFinished = !entry.loop;
    return action;
  }

  /* Crossfade A -> B trong `duration` giây. */
  AnimBlender.blend = function (fromId, toId, duration) {
    const r = rig();
    if (!r || !r.mixer) { bus.emit('notify', { type: 'warning', title: 'Animation Blender', message: 'Chưa có rig — bấm Auto Rig Gen trước.' }); return false; }
    const from = clipById(fromId), to = clipById(toId);
    if (!from || !to) return false;
    const dur = Math.max(0.05, duration || 0.5);
    const aFrom = actionFor(from);
    const aTo = actionFor(to);
    aFrom.setEffectiveWeight(1); aFrom.play();
    aTo.setEffectiveWeight(0); aTo.play();
    AnimBlender.fade = { from: aFrom, to: aTo, fromId: fromId, toId: toId, t: 0, duration: dur, active: true };
    if (PixiStudio.AnimAutoGen) PixiStudio.AnimAutoGen.currentClip = toId;
    PixiStudio.RigAutoGen.playing = true;
    bus.emit('anim:blend-started', { from: fromId, to: toId, duration: dur });
    return true;
  };

  /* Mask blend: clip nền chạy đủ người, overlay chỉ chạy nhóm xương chọn. */
  AnimBlender.maskBlend = function (baseId, overlayId, maskName, weight) {
    const r = rig();
    if (!r || !r.mixer) return false;
    const base = clipById(baseId), over = clipById(overlayId);
    if (!base || !over) return false;
    const bones = maskName === 'lower' ? LOWER_BODY : UPPER_BODY;
    const masked = AnimBlender.maskedClip(over.clip, bones);
    if (!masked.kept) return false;
    const aBase = actionFor(base);
    aBase.setEffectiveWeight(1); aBase.play();
    const mixer = r.mixer;
    const aOver = mixer.clipAction(masked.clip);
    aOver.reset();
    aOver.setLoop(over.loop ? THREE.LoopRepeat : THREE.LoopOnce);
    aOver.setEffectiveWeight(Math.max(0, Math.min(1, weight === undefined ? 1 : weight)));
    aOver.play();
    AnimBlender.overlays.push({ action: aOver, clipId: overlayId, kind: 'mask:' + maskName });
    bus.emit('anim:mask-started', { base: baseId, overlay: overlayId, mask: maskName, kept: masked.kept });
    return true;
  };

  /* Additive: overlay cộng thêm lên clip nền (vd: vung tay trong lúc chạy). */
  AnimBlender.additive = function (baseId, addId, weight) {
    const r = rig();
    if (!r || !r.mixer) return false;
    const base = clipById(baseId), add = clipById(addId);
    if (!base || !add) return false;
    const addClip = AnimBlender.makeAdditive(add.clip);
    const aBase = actionFor(base);
    aBase.setEffectiveWeight(1); aBase.play();
    const mixer = r.mixer;
    const aAdd = mixer.clipAction(addClip);
    aAdd.reset();
    aAdd.setLoop(add.loop ? THREE.LoopRepeat : THREE.LoopOnce);
    if ('blendMode' in aAdd) aAdd.blendMode = THREE.AdditiveAnimationBlendMode;
    aAdd.setEffectiveWeight(Math.max(0, Math.min(1, weight === undefined ? 0.7 : weight)));
    aAdd.play();
    AnimBlender.overlays.push({ action: aAdd, clipId: addId, kind: 'additive' });
    return true;
  };

  AnimBlender.stopOverlays = function () {
    AnimBlender.overlays.forEach(function (o) { try { o.action.stop(); } catch (e) {} });
    AnimBlender.overlays = [];
  };

  /* Gọi mỗi frame từ App tick — ramp weight của crossfade. */
  AnimBlender.update = function (dt) {
    const f = AnimBlender.fade;
    if (!f || !f.active) return;
    f.t += dt;
    const k = Math.min(1, f.t / f.duration);
    f.from.setEffectiveWeight(1 - k);
    f.to.setEffectiveWeight(k);
    if (k >= 1) {
      try { f.from.stop(); } catch (e) {}
      f.active = false;
      AnimBlender.fade = null;
      bus.emit('anim:blend-done', { from: f.fromId, to: f.toId });
    }
  };

  window.PixiStudio.AnimBlender = AnimBlender;
})();
