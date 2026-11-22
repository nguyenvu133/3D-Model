/* animation/m2m-motion.js — play Mesh2Motion (CC0) animation GLB on a local rig.
 *
 * Source rig (Mesh2Motion human, UE-like naming) → target rig bones
 * (Mixamo `mixamorig*`, Studio `Hips/Spine/...`).
 *
 * Retarget uses rest-pose compensation:
 *   q_target_local = q_target_rest * (q_source_rest^-1 * q_source_local)
 * Translation is retargeted only for the pelvis/hips and scaled by the ratio of
 * hip world height, so a Mixamo cm rig and a metre rig both land correctly.
 *
 * Assets: Mesh2Motion (MIT code / CC0 art) — mesh2motion.org
 */
(function () {
  'use strict';
  const bus = PixiStudio.bus;
  const CATALOG_URL = 'assets/animations/mesh2motion/catalog.json';

  const Motion = {
    catalog: null,
    rigId: 'human',
    current: null,
    _cache: {},          // url -> AnimationClip (source naming)
    _actions: {},
    mixer: null,
    target: null,
    offset: 0,
    loop: true,
    speed: 1
  };

  /* ------------------------------------------------------------------
     MAP BONE THEO RIG
     human : rig nguồn (pelvis/spine_01/upperarm_l...) → rig đích Mixamo/Studio
     khác  : rig phi humanoid (fox/horse/dragon/bird/snake/shark/spider/kaiju) —
             dựng bone đúng tên gốc nên map 1:1 theo TÊN (identity).
     ------------------------------------------------------------------ */
  const IDENTITY_RIGS = ['fox', 'horse', 'dragon', 'bird', 'snake', 'shark', 'spider', 'kaiju'];

  Motion.setRig = function (rigId) {
    Motion.rigId = rigId || 'human';
    Motion._actions = {};
    bus.emit('m2m:rig', { rigId: Motion.rigId, mode: IDENTITY_RIGS.indexOf(Motion.rigId) >= 0 ? 'identity-by-name' : 'humanoid-retarget' });
    return Motion.rigId;
  };

  Motion.isIdentityRig = function (rigId) { return IDENTITY_RIGS.indexOf(rigId || Motion.rigId) >= 0; };

  /* Mesh2Motion human bone → canonical body part */
  const SRC_MAP = {
    root: 'root', pelvis: 'hips',
    spine_01: 'spine', spine_02: 'spine1', spine_03: 'chest',
    neck_01: 'neck', head: 'head',
    clavicle_l: 'shoulderL', upperarm_l: 'armL', lowerarm_l: 'forearmL', hand_l: 'handL',
    clavicle_r: 'shoulderR', upperarm_r: 'armR', lowerarm_r: 'forearmR', hand_r: 'handR',
    thigh_l: 'uplegL', calf_l: 'legL', foot_l: 'footL', ball_l: 'toeL',
    thigh_r: 'uplegR', calf_r: 'legR', foot_r: 'footR', ball_r: 'toeR',
    index_01_l: 'fingerL', index_02_l: 'fingerL', index_03_l: 'fingerL',
    middle_01_l: 'fingerL', middle_02_l: 'fingerL', middle_03_l: 'fingerL',
    ring_01_l: 'fingerL', ring_02_l: 'fingerL', ring_03_l: 'fingerL',
    pinky_01_l: 'fingerL', pinky_02_l: 'fingerL', pinky_03_l: 'fingerL',
    thumb_01_l: 'fingerL', thumb_02_l: 'fingerL', thumb_03_l: 'fingerL',
    index_01_r: 'fingerR', index_02_r: 'fingerR', index_03_r: 'fingerR',
    middle_01_r: 'fingerR', middle_02_r: 'fingerR', middle_03_r: 'fingerR',
    ring_01_r: 'fingerR', ring_02_r: 'fingerR', ring_03_r: 'fingerR',
    pinky_01_r: 'fingerR', pinky_02_r: 'fingerR', pinky_03_r: 'fingerR',
    thumb_01_r: 'fingerR', thumb_02_r: 'fingerR', thumb_03_r: 'fingerR'
  };

  /* Canonical part → candidate bone names on the target rig, in priority order.
     First match wins, so Mixamo naming is preferred when present. */
  const TGT_NAMES = {
    root: ['mixamorigRoot', 'Root', 'root', 'mixamorigHips', 'Hips', 'pelvis'],
    hips: ['mixamorigHips', 'Hips', 'pelvis', 'mixamorigPelvis'],
    spine: ['mixamorigSpine', 'Spine', 'spine_01'],
    spine1: ['mixamorigSpine1', 'Spine1', 'mixamorigChest', 'Chest'],
    chest: ['mixamorigSpine2', 'Spine2', 'Chest', 'mixamorigChest', 'mixamorigSpine1', 'Spine1'],
    neck: ['mixamorigNeck', 'Neck'],
    head: ['mixamorigHead', 'Head'],
    shoulderL: ['mixamorigLeftShoulder', 'LeftShoulder'],
    armL: ['mixamorigLeftArm', 'LeftArm'],
    forearmL: ['mixamorigLeftForeArm', 'LeftForeArm'],
    handL: ['mixamorigLeftHand', 'LeftHand'],
    shoulderR: ['mixamorigRightShoulder', 'RightShoulder'],
    armR: ['mixamorigRightArm', 'RightArm'],
    forearmR: ['mixamorigRightForeArm', 'RightForeArm'],
    handR: ['mixamorigRightHand', 'RightHand'],
    uplegL: ['mixamorigLeftUpLeg', 'LeftUpLeg'],
    legL: ['mixamorigLeftLeg', 'LeftLeg'],
    footL: ['mixamorigLeftFoot', 'LeftFoot'],
    toeL: ['mixamorigLeftToeBase', 'LeftToeBase'],
    uplegR: ['mixamorigRightUpLeg', 'RightUpLeg'],
    legR: ['mixamorigRightLeg', 'RightLeg'],
    footR: ['mixamorigRightFoot', 'RightFoot'],
    toeR: ['mixamorigRightToeBase', 'RightToeBase']
  };

  Motion.loadCatalog = function () {
    if (Motion.catalog) return Promise.resolve(Motion.catalog);
    return fetch(CATALOG_URL).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { Motion.catalog = j; bus.emit('m2m:catalog', { rigs: Object.keys(j.rigs) }); return j; })
      .catch(function (e) { bus.emit('notify', { type: 'error', title: 'Motion catalog', message: 'Không tải được catalog: ' + e.message }); return null; });
  };

  Motion.motions = function (rig) {
    const r = Motion.catalog && Motion.catalog.rigs[rig || Motion.rigId];
    return r ? r.animations : [];
  };

  Motion.variations = function (rig) {
    const r = Motion.catalog && Motion.catalog.rigs[rig || Motion.rigId];
    return r ? (r.variations || []) : [];
  };

  /* đường dẫn ảnh preview đã tải kèm (nếu có) */
  Motion.previewUrl = function (rig, name) {
    if (name === 'base-model') return 'assets/animations/mesh2motion/rig-reference/' + rig + '.png';
    return 'assets/animations/mesh2motion/variation-previews/' + rig + '/' + name + '.png';
  };

  /* ---------- load source clip (cached) ---------- */
  Motion.loadClip = function (url) {
    if (Motion._cache[url]) return Promise.resolve(Motion._cache[url]);
    return new Promise(function (resolve, reject) {
      const loader = new THREE.GLTFLoader();
      /* asset Mesh2Motion dùng EXT_meshopt_compression → phải gắn decoder trước khi load */
      if (window.MeshoptDecoder && loader.setMeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
      loader.load(url, function (g) {
        const clip = (g.animations && g.animations[0]) || null;
        if (!clip) { reject(new Error('GLB không có animation')); return; }
        /* rest pose của rig nguồn (node lúc chưa phát animation) */
        const rest = {};
        g.scene.updateMatrixWorld(true);
        g.scene.traverse(function (o) { if (o.name) rest[o.name] = o.quaternion.clone(); });
        Motion._cache[url] = { clip: clip, rest: rest, scene: g.scene };
        resolve(Motion._cache[url]);
      }, undefined, function (e) { reject(new Error('Load lỗi: ' + (e && e.message || e))); });
    });
  };

  /* ---------- build target bone map ---------- */
  function targetBones(root) {
    const byName = {};
    const list = [];
    root.traverse(function (o) { if (o.isBone) { byName[o.name] = o; list.push(o); } });
    const out = {};
    Object.keys(TGT_NAMES).forEach(function (part) {
      const cands = TGT_NAMES[part];
      for (let i = 0; i < cands.length; i++) {
        if (byName[cands[i]]) { out[part] = byName[cands[i]]; return; }
      }
      /* fallback: so khớp không phân biệt hoa/thường, bỏ tiền tố mixamorig */
      for (let i = 0; i < cands.length; i++) {
        const want = cands[i].replace(/^mixamorig/i, '').toLowerCase();
        const hit = list.find(function (b) { return b.name.replace(/^mixamorig:?/i, '').toLowerCase() === want; });
        if (hit) { out[part] = hit; return; }
      }
    });
    return out;
  }

  /* Tự nhận dạng: nếu rig đích dùng ĐÚNG hệ tên bone của clip nguồn (ví dụ rig
     dựng từ skeleton.glb của Mesh2Motion) thì map 1:1 theo tên; ngược lại dùng
     bảng map humanoid (Mixamo mixamorig* / Studio Hips-Spine...). */
  function detectIdentity(src, root) {
    const names = {};
    root.traverse(function (o) { if (o.isBone && o.name) names[o.name] = 1; });
    const nodes = {};
    src.clip.tracks.forEach(function (t) {
      const dot = t.name.lastIndexOf('.');
      const n = dot > 0 ? t.name.slice(0, dot) : t.name;
      if (/_(tip|leaf)$/i.test(n)) return;
      nodes[n] = 1;
    });
    const keys = Object.keys(nodes);
    if (!keys.length) return false;
    let hit = 0;
    keys.forEach(function (n) { if (names[n]) hit++; });
    return hit / keys.length >= 0.4;
  }

  /* ---------- retarget ---------- */
  Motion.retarget = function (src, root) {
    /* Nhánh rig phi humanoid: bone đích trùng TÊN bone gốc → map 1:1, chỉ bỏ
       bone trang trí cuối chuỗi (_tip/_leaf) cho sạch track. */
    if (Motion.isIdentityRig() || detectIdentity(src, root)) return Motion.retargetIdentity(src, root);
    const map = targetBones(root);
    const tracks = [];
    const rest = {};
    Object.keys(map).forEach(function (p) { rest[p] = map[p].quaternion.clone(); });
    let srcRest = src.rest;

    /* tỷ lệ chiều cao hông nguồn/đích để scale root motion */
    let scale = 1;
    const srcHip = src.scene.getObjectByName && (src.scene.getObjectByName('pelvis') || src.scene.getObjectByName('hips'));
    root.updateMatrixWorld(true);
    if (srcHip && map.hips) {
      src.scene.updateMatrixWorld(true);
      const a = new THREE.Vector3().setFromMatrixPosition(srcHip.matrixWorld).y;
      const b = new THREE.Vector3().setFromMatrixPosition(map.hips.matrixWorld).y;
      if (isFinite(a) && isFinite(b) && a > 1e-6) scale = b / a;
    }

    const byName = {};
    Object.keys(map).forEach(function (p) { byName[p] = map[p].name; });

    src.clip.tracks.forEach(function (t) {
      const dot = t.name.lastIndexOf('.');
      const node = dot > 0 ? t.name.slice(0, dot) : t.name;
      const path = dot > 0 ? t.name.slice(dot + 1) : '';
      const part = SRC_MAP[node];
      if (!part || !map[part]) return;
      const boneName = byName[part];

      if (path === 'rotation' || path === 'quaternion') {
        const qs = srcRest[node];
        const qt = rest[part];
        if (!qs || !qt) return;
        const inv = qs.clone().invert();
        const vals = new Float32Array(t.values.length);
        const tmp = new THREE.Quaternion();
        for (let i = 0; i < t.values.length; i += 4) {
          tmp.set(t.values[i], t.values[i + 1], t.values[i + 2], t.values[i + 3]);
          tmp.premultiply(inv).premultiply(qt);
          vals[i] = tmp.x; vals[i + 1] = tmp.y; vals[i + 2] = tmp.z; vals[i + 3] = tmp.w;
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(boneName + '.quaternion', Array.from(t.times), Array.from(vals)));
        return;
      }

      if (path === 'translation' && (part === 'hips' || part === 'root') && Motion.useRootMotion) {
        const vals = new Float32Array(t.values.length);
        for (let i = 0; i < t.values.length; i++) vals[i] = t.values[i] * scale;
        tracks.push(new THREE.VectorKeyframeTrack(boneName + '.position', Array.from(t.times), Array.from(vals)));
      }
    });

    if (!tracks.length) return null;
    return new THREE.AnimationClip(src.clip.name || 'Motion', src.clip.duration, tracks);
  };

  /* Map 1:1 theo tên bone — dùng cho rig creature dựng từ skeleton gốc Mesh2Motion */
  Motion.retargetIdentity = function (src, root) {
    const names = {};
    root.traverse(function (o) { if (o.isBone && o.name) names[o.name] = o; });
    const isDeco = function (n) { return /_(tip|leaf)$/i.test(n); };
    const tracks = [];
    const rest = {};
    src.clip.tracks.forEach(function (t) {
      const dot = t.name.lastIndexOf('.');
      const node = dot > 0 ? t.name.slice(0, dot) : t.name;
      const path = dot > 0 ? t.name.slice(dot + 1) : '';
      if (isDeco(node)) return;                 /* bone đầu mút trang trí */
      const bone = names[node];
      if (!bone) return;                        /* rig đích không có bone này */
      if (path === 'rotation' || path === 'quaternion') {
        const qs = src.rest[node];
        if (!qs) return;
        if (!rest[node]) rest[node] = bone.quaternion.clone();
        const inv = qs.clone().invert();
        const qt = rest[node];
        const vals = new Float32Array(t.values.length);
        const tmp = new THREE.Quaternion();
        for (let i = 0; i < t.values.length; i += 4) {
          tmp.set(t.values[i], t.values[i + 1], t.values[i + 2], t.values[i + 3]);
          tmp.premultiply(inv).premultiply(qt);
          vals[i] = tmp.x; vals[i + 1] = tmp.y; vals[i + 2] = tmp.z; vals[i + 3] = tmp.w;
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(node + '.quaternion', Array.from(t.times), Array.from(vals)));
        return;
      }
      if (path === 'translation' && Motion.useRootMotion && /^(root|hips|pelvis)$/i.test(node)) {
        const vals = new Float32Array(t.values.length);
        vals.set(t.values);
        tracks.push(new THREE.VectorKeyframeTrack(node + '.position', Array.from(t.times), Array.from(vals)));
      }
    });
    if (!tracks.length) return null;
    return new THREE.AnimationClip(src.clip.name || 'Motion', src.clip.duration, tracks);
  };

  /* ---------- playback ---------- */
  function resolveTarget() {
    if (PixiStudio.FbxRig && PixiStudio.FbxRig.loaded && PixiStudio.FbxRig.fbxRoot) return { root: PixiStudio.FbxRig.fbxRoot, mixer: PixiStudio.FbxRig.mixer };
    const rig = PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
    if (rig && rig.rootBone) return { root: rig.target, mixer: rig.mixer };
    return null;
  }

  /* Áp clip đã load sẵn (không qua URL) — dùng cho clip FBX Text to Motion
     của Meshy (FBXLoader.parse) hoặc bất kỳ clip nguồn nào: src = {clip, rest, scene}. */
  Motion.playClip = function (src, label) {
    var t = resolveTarget();
    if (!t) { bus.emit('notify', { type: 'warning', title: 'Motion', message: 'Chưa có rig: hãy Load FBX hoặc Auto-Rig trước.' }); return Promise.resolve(null); }
    if (!src || !src.clip) return Promise.resolve(null);
    var clip = Motion.retarget(src, t.root);
    if (!clip) { bus.emit('notify', { type: 'warning', title: 'Retarget', message: 'Không map được bone nào cho rig hiện tại.' }); return null; }
    if (Motion.mixer !== t.mixer) { Motion.mixer = t.mixer; Motion._actions = {}; }
    Motion.mixer.stopAllAction();
    var action = Motion.mixer.clipAction(clip);
    action.reset();
    action.setLoop(Motion.loop ? THREE.LoopRepeat : THREE.LoopOnce);
    action.clampWhenFinished = !Motion.loop;
    action.setEffectiveTimeScale(Motion.speed);
    action.setEffectiveWeight(1);
    action.play();
    Motion.current = { url: null, label: label || clip.name, duration: clip.duration, tracks: clip.tracks.length };
    bus.emit('m2m:played', Motion.current);
    return Promise.resolve(Motion.current);
  };

  Motion.play = function (url, label) {
    const t = resolveTarget();
    if (!t) { bus.emit('notify', { type: 'warning', title: 'Motion', message: 'Chưa có rig: hãy Load FBX hoặc Auto-Rig trước.' }); return Promise.resolve(null); }
    return Motion.loadClip(url).then(function (src) {
      const clip = Motion.retarget(src, t.root);
      if (!clip) { bus.emit('notify', { type: 'warning', title: 'Retarget', message: 'Không map được bone nào cho rig hiện tại.' }); return null; }
      if (Motion.mixer !== t.mixer) { Motion.mixer = t.mixer; Motion._actions = {}; }
      Motion.mixer.stopAllAction();
      const action = Motion.mixer.clipAction(clip);
      action.reset();
      action.setLoop(Motion.loop ? THREE.LoopRepeat : THREE.LoopOnce);
      action.clampWhenFinished = !Motion.loop;
      action.setEffectiveTimeScale(Motion.speed);
      action.setEffectiveWeight(1);
      action.play();
      Motion._actions[url] = action;
      Motion.current = { url: url, label: label || clip.name, duration: clip.duration, tracks: clip.tracks.length };
      bus.emit('m2m:played', Motion.current);
      return Motion.current;
    }).catch(function (e) {
      bus.emit('notify', { type: 'error', title: 'Motion lỗi', message: e.message });
      return null;
    });
  };

  Motion.stop = function () { if (Motion.mixer) Motion.mixer.stopAllAction(); Motion.current = null; };
  Motion.setSpeed = function (v) { Motion.speed = v; Object.keys(Motion._actions).forEach(function (k) { Motion._actions[k].setEffectiveTimeScale(v); }); };
  Motion.setLoop = function (on) { Motion.loop = !!on; };
  Motion.useRootMotion = true;

  /* verify: đo chuyển động bone thật sau khi phát */
  Motion.probe = function (ms) {
    const t = resolveTarget();
    if (!t) return Promise.resolve(null);
    const probes = [];
    t.root.traverse(function (o) { if (o.isBone && /hand|foot|head|forearm/i.test(o.name) && probes.length < 5) probes.push(o); });
    if (!probes.length) return Promise.resolve(null);
    const read = function () { t.root.updateMatrixWorld(true); return probes.map(function (b) { return b.matrixWorld.elements.slice(12, 15); }); };
    const before = read();
    return new Promise(function (res) {
      setTimeout(function () {
        const after = read();
        let max = 0;
        before.forEach(function (a, i) {
          const b = after[i];
          max = Math.max(max, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
        });
        res({ bones: probes.map(function (b) { return b.name; }), maxTravel: +max.toFixed(4) });
      }, ms || 500);
    });
  };

  window.PixiStudio.M2MMotion = Motion;
})();
