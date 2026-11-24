/* ============================================================
 * characters/thandieu.js — NHÂN VẬT THẦN ĐIÊU (Mixamo rig)
 * 1 nhân vật hoàn chỉnh dùng trong Studio, theo đúng mẫu FbxRig:
 *   1. Load 3 file FBX thật (cùng 1 nhân vật, đã kiểm chứng):
 *      • thandieu-Mixamo.fbx  — T-pose (base mesh + skeleton)
 *      • Neutral_Idle.fbx     — Idle thật 8.767s
 *      • Than_dieu_Fast_Run.fbx — Fast Run thật 0.533s
 *   2. Chuẩn hoá bone mixamorig* (no-colon) → tên chuẩn Hips/Spine/...
 *   3. Đăng ký skeleton vào RigAutoGen.current để IK/Pose/AnimAutoGen
 *      nhận nhân vật (cánh = tay LeftArm/RightArm của rig humanoid).
 *   4. 11 clips: 3 thật từ FBX + 8 sinh procedural từ rest pose
 *      và data Fast Run (mẫu FbxRig.generateIdle/generateAttack).
 *
 * SỐ LIỆU ĐÃ KIỂM CHỨNG (three r128 FBXLoader + fbx2gltf 0.9.7):
 *   SkinnedMesh than_dieu · 129,399 verts · 43,133 tris · skin weights
 *   hợp lệ (tổng 1.0, 0 bad) · bbox 1.28 x 1.80 x 1.06 · chân y=0
 *   Skeleton 41 bones (34 có skin), root mixamorigHips, material
 *   tripo_mat_b362476f-... · Clip "mixamo.com": Idle 8.767s (35 tracks),
 *   Fast Run 0.533s (35 tracks), T-pose 0.033s (1 frame tĩnh).
 *   FBXLoader cảnh báo "Vertex has more than 4 skinning weights" —
 *   three.js chỉ giữ 4, VÔ HẠI, không sửa mesh.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;
  const stripPre = function (s) { return String(s == null ? '' : s).replace(/^mixamorig:?/i, ''); };

  const REPO_DIR = 'models/thandieu/';
  const FILES = {
    base: REPO_DIR + 'thandieu-Mixamo.fbx',
    idle: REPO_DIR + 'Neutral_Idle.fbx',
    run: REPO_DIR + 'Than_dieu_Fast_Run.fbx'
  };

  /* 11 clips: id · tên hiển thị · icon · loop · nguồn · thời lượng mục tiêu
     (clip thật lấy duration từ FBX; clip sinh lấy đúng duration này) */
  const CLIP_DEFS = [
    { id: 'Idle',    name: 'Idle',       icon: 'character', loop: true,  source: 'fbx',       dur: 8.767 },
    { id: 'FastRun', name: 'Chạy nhanh', icon: 'character', loop: true,  source: 'fbx',       dur: 0.533 },
    { id: 'TPose',   name: 'T-Pose',     icon: 'character', loop: false, source: 'fbx',       dur: 0.033 },
    { id: 'WingFlap', name: 'Vỗ cánh',   icon: 'character', loop: true,  source: 'generated', dur: 1.6 },
    { id: 'Peck',    name: 'Mổ',        icon: 'character', loop: false, source: 'generated', dur: 1.0 },
    { id: 'Jump',    name: 'Nhảy',      icon: 'character', loop: false, source: 'generated', dur: 0.7 },
    { id: 'Attack',  name: 'Quạt cánh', icon: 'swords',    loop: false, source: 'generated', dur: 0.85 },
    { id: 'Turn',    name: 'Xoay 360°', icon: 'character', loop: false, source: 'generated', dur: 1.2 },
    { id: 'Bow',     name: 'Cúi chào',  icon: 'character', loop: false, source: 'generated', dur: 1.4 },
    { id: 'Walk',    name: 'Đi chậm',   icon: 'character', loop: true,  source: 'generated', dur: 1.4 },
    { id: 'Death',   name: 'Ngã xuống', icon: 'swords',    loop: false, source: 'generated', dur: 1.5 }
  ];

  const Thandieu = {
    root: null,            // THREE.Group từ FBX base
    skinnedMesh: null,
    skeleton: null,
    rootBone: null,
    boneMap: {},           // canonical → THREE.Bone
    fullName: {},          // canonical → tên đầy đủ trong FBX (mixamorigLeftArm)
    rest: {},              // canonical → { q: Quaternion, p: Vector3 } lúc T-pose
    boneNames: [],         // tên đầy đủ của 41 bones
    mixer: null,
    actions: {},
    current: null,
    clips: [],             // [{id, name, duration, clip, icon, loop, source}]
    loaded: false,
    fileName: '',
    speed: 1,
    paused: false,
    _hiddenPreview: [],
    _registeredRig: null,
    _statusT: 0,
    stats: { verts: 0, tris: 0, bones: 0, skinnedBones: 0 }
  };

  /* ============================================================
     TRACK HELPERS — theo mẫu anim-auto-gen.js (fitValues chống NaN,
     tránh treo app khi track sai số lượng giá trị)
     ============================================================ */
  function fitValues(times, values, size) {
    const need = times.length * size;
    const def = function (k) { return (size === 4 && k === 3) ? 1 : 0; };
    let flat = values;
    if (values.length && Array.isArray(values[0])) {
      flat = [];
      values.forEach(function (v) { for (let i = 0; i < size; i++) flat.push(v[i]); });
    }
    flat = Array.prototype.map.call(flat, function (x, i) {
      return (typeof x === 'number' && isFinite(x)) ? x : def(i % size);
    });
    if (flat.length === need) return flat;
    const out = flat.slice(0, need);
    const lastFrame = flat.length >= size ? flat.slice(flat.length - size) : null;
    while (out.length < need) {
      const k = out.length % size;
      out.push(lastFrame ? lastFrame[k] : def(k));
    }
    return out;
  }
  function qTrack(name, times, quats) {
    /* delta() trả THREE.Quaternion — fitValues chỉ hiểu mảng số phẳng
       (anim-auto-gen dùng quat() → toArray()). Không chuyển → mọi giá trị
       thành identity (0,0,0,1), clip procedural mất tác dụng. */
    const arrs = quats.map(function (q) {
      return (q && typeof q.toArray === 'function') ? q.toArray() : q;
    });
    return new THREE.QuaternionKeyframeTrack(name + '.quaternion', times, fitValues(times, arrs, 4));
  }
  function vTrack(name, times, vecs) {
    return new THREE.VectorKeyframeTrack(name + '.position', times, fitValues(times, vecs, 3));
  }
  function times(n, dur) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(dur * i / (n - 1));
    return out;
  }
  /* rest-relative delta: rest * Euler(x,y,z) — BẮT BUỘC vì bone FBX có
     bind rotation khác identity (không dùng quaternion tuyệt đối). */
  function delta(canonical, x, y, z) {
    const r = Thandieu.rest[canonical];
    if (!r) return new THREE.Quaternion();
    const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z)
    ));
    return r.q.clone().multiply(dq);
  }
  function deltaY(canonical, angleDeg) {
    const r = Thandieu.rest[canonical];
    if (!r) return new THREE.Quaternion();
    const dq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(angleDeg));
    return r.q.clone().multiply(dq);
  }
  function restPos(canonical) {
    const r = Thandieu.rest[canonical];
    return r ? [r.p.x, r.p.y, r.p.z] : [0, 0, 0];
  }
  function hipsPos(timesArr, dys) {
    const rp = restPos('Hips');
    return dys.map(function (dy) { return [rp[0], rp[1] + dy, rp[2]]; });
  }
  function boneTrackName(canonical) {
    return Thandieu.fullName[canonical] || ('mixamorig' + canonical);
  }

  /* ============================================================
     LOAD — từ repo (models/thandieu/) hoặc 3 file do user chọn
     ============================================================ */
  Thandieu.loadFromUrl = function (url) {
    return new Promise(function (resolve, reject) {
      if (!window.THREE || !THREE.FBXLoader) { reject(new Error('FBXLoader chưa load (CDN)')); return; }
      if (typeof fflate === 'undefined') { reject(new Error('fflate chưa load (CDN)')); return; }
      const loader = new THREE.FBXLoader();
      loader.load(url, resolve, undefined, function (err) {
        reject(new Error('FBX load fail: ' + url + ' — ' + String(err && err.message || err)));
      });
    });
  };

  Thandieu.loadFromRepo = function () {
    return Thandieu.loadFromUrl(FILES.base).then(function (baseObj) {
      /* Idle + Run load song song; thiếu 1 file thì vẫn dùng được phần còn lại */
      const idleP = Thandieu.loadFromUrl(FILES.idle).catch(function (e) { console.warn('[Thandieu] thiếu Idle:', e.message); return null; });
      const runP = Thandieu.loadFromUrl(FILES.run).catch(function (e) { console.warn('[Thandieu] thiếu Fast Run:', e.message); return null; });
      return Promise.all([idleP, runP]).then(function (pair) {
        Thandieu.fileName = 'models/thandieu/ (3 file FBX)';
        return Thandieu._process(baseObj, {
          idle: pair[0] ? (pair[0].animations || [])[0] || null : null,
          run: pair[1] ? (pair[1].animations || [])[0] || null : null
        });
      });
    });
  };

  Thandieu.loadFromFiles = function (fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return Promise.reject(new Error('Chưa chọn file nào.'));
    /* Phân loại theo tên file */
    const pick = { base: null, idle: null, run: null };
    files.forEach(function (f) {
      const n = (f.name || '').toLowerCase();
      if (/fast.?run/.test(n)) pick.run = f;
      else if (/idle/.test(n)) pick.idle = f;
      else if (/mixamo|thandieu/i.test(f.name || '')) pick.base = f;
    });
    if (!pick.base) {
      return Promise.reject(new Error('Thiếu file base thandieu-Mixamo.fbx — chọn đủ 3 file: thandieu-Mixamo.fbx, Neutral_Idle.fbx, Than_dieu_Fast_Run.fbx.'));
    }
    const loader = new THREE.FBXLoader();
    const parseOne = function (file) {
      return U.readFileAsArrayBuffer(file).then(function (ab) {
        return loader.parse(ab, '');
      });
    };
    return parseOne(pick.base).then(function (baseObj) {
      const jobs = [
        pick.idle ? parseOne(pick.idle).catch(function (e) { console.warn('[Thandieu] Idle parse fail:', e.message); return null; }) : Promise.resolve(null),
        pick.run ? parseOne(pick.run).catch(function (e) { console.warn('[Thandieu] Fast Run parse fail:', e.message); return null; }) : Promise.resolve(null)
      ];
      return Promise.all(jobs).then(function (pair) {
        Thandieu.fileName = pick.base.name + ' (+ ' + files.length + ' file)';
        return Thandieu._process(baseObj, {
          idle: pair[0] ? (pair[0].animations || [])[0] || null : null,
          run: pair[1] ? (pair[1].animations || [])[0] || null : null
        });
      });
    });
  };

  /* ============================================================
     _process — skeleton + rest pose + 11 clips + đăng ký rig
     ============================================================ */
  Thandieu._process = function (baseObj, realClips) {
    Thandieu.root = baseObj;
    Thandieu.loaded = true;

    /* Skeleton + rest pose snapshot (TRƯỚC khi phát clip nào) */
    const bones = [];
    let skinned = null;
    baseObj.traverse(function (o) {
      if (o.isBone) bones.push(o);
      if (o.isSkinnedMesh && !skinned) skinned = o;
      if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    });
    if (!bones.length || !skinned) throw new Error('FBX không có skeleton/skinned mesh — không phải file thần điêu Mixamo.');
    Thandieu.skinnedMesh = skinned;
    Thandieu.skeleton = skinned.skeleton || null;
    Thandieu.boneNames = bones.map(function (b) { return b.name; });
    Thandieu.rootBone = bones.find(function (b) { return /Hips/i.test(b.name); }) || bones[0];
    bones.forEach(function (b) {
      const canon = stripPre(b.name);
      Thandieu.boneMap[canon] = b;
      Thandieu.fullName[canon] = b.name;
      Thandieu.rest[canon] = { q: b.quaternion.clone(), p: b.position.clone() };
    });
    const pos = skinned.geometry.attributes.position;
    Thandieu.stats = {
      verts: pos.count,
      tris: Math.round((skinned.geometry.index ? skinned.geometry.index.count : pos.count) / 3),
      bones: bones.length,
      skinnedBones: (skinned.skeleton && skinned.skeleton.bones.length) || 0
    };

    /* Mixer trên root (track FBX dùng tên đầy đủ mixamorig* nên bind đúng) */
    if (Thandieu.mixer) Thandieu.mixer.stopAllAction();
    Thandieu.mixer = new THREE.AnimationMixer(baseObj);
    Thandieu.actions = {};
    Thandieu.current = null;

    /* ---------- Build 11 clips ---------- */
    const entries = [];
    const addEntry = function (def, clip) {
      if (!clip) return;
      clip.name = def.id;
      const bad = PixiStudio.Anim && PixiStudio.Anim.validateClip ? PixiStudio.Anim.validateClip(clip) : [];
      if (bad.length) {
        console.warn('[Thandieu] clip lỗi, bỏ qua:', def.id, bad[0]);
        bus.emit('notify', { type: 'warning', title: 'Clip lỗi đã bỏ qua', message: def.id + ': ' + bad[0] });
        return;
      }
      entries.push({ id: def.id, name: def.name, duration: clip.duration, clip: clip, icon: def.icon, loop: def.loop, source: def.source });
    };
    const defById = function (id) { return CLIP_DEFS.find(function (d) { return d.id === id; }); };

    /* 3 clip THẬT từ FBX */
    if (realClips.idle) addEntry(defById('Idle'), realClips.idle);
    else bus.emit('notify', { type: 'warning', title: 'Thiếu Neutral_Idle.fbx', message: 'Clip Idle thật chưa có — các clip khác vẫn dùng được.' });
    if (realClips.run) addEntry(defById('FastRun'), realClips.run);
    else bus.emit('notify', { type: 'warning', title: 'Thiếu Than_dieu_Fast_Run.fbx', message: 'Clip FastRun + Attack chưa có — các clip khác vẫn dùng được.' });
    const baseClip = (baseObj.animations || [])[0];
    if (baseClip) addEntry(defById('TPose'), baseClip);

    /* 8 clip SINH procedural */
    addEntry(defById('WingFlap'), Thandieu._genWingFlap());
    addEntry(defById('Peck'), Thandieu._genPeck());
    addEntry(defById('Jump'), Thandieu._genJump());
    if (realClips.run) addEntry(defById('Attack'), Thandieu._genAttack(realClips.run));
    addEntry(defById('Turn'), Thandieu._genTurn());
    addEntry(defById('Bow'), Thandieu._genBow());
    addEntry(defById('Walk'), Thandieu._genWalk());
    addEntry(defById('Death'), Thandieu._genDeath());
    Thandieu.clips = entries;

    /* Đăng ký vào RigAutoGen để IK/Pose/AnimAutoGen nhận nhân vật */
    Thandieu._registerRig();

    bus.emit('thandieu:loaded', {
      boneCount: Thandieu.stats.bones, tris: Thandieu.stats.tris,
      clips: entries.map(function (c) { return { id: c.id, duration: c.duration, source: c.source }; })
    });
    bus.emit('notify', {
      type: 'success', title: '🦅 Thần Điêu đã sẵn sàng',
      message: Thandieu.stats.bones + ' bones · ' + Thandieu.stats.tris.toLocaleString() + ' tris · ' +
        entries.length + ' clips (' + entries.filter(function (c) { return c.source === 'fbx'; }).length +
        ' thật từ FBX + ' + entries.filter(function (c) { return c.source === 'generated'; }).length + ' sinh procedural)'
    });

    /* AUTO-PREVIEW: thêm vào viewport + phát Idle ngay */
    setTimeout(function () {
      Thandieu.addToViewport();
      if (PixiStudio.Viewport && PixiStudio.Viewport.orbit) {
        PixiStudio.Viewport.setView('perspective');
        PixiStudio.Viewport.orbit.dTarget.set(0, 1.0, 0);
        PixiStudio.Viewport.orbit.dRadius = 3.6;
        PixiStudio.Viewport.orbit.dTheta = 0.6;
        PixiStudio.Viewport.orbit.dPhi = 1.25;
      }
      if (Thandieu.clips.find(function (c) { return c.id === 'Idle'; })) Thandieu.play('Idle');
      else if (Thandieu.clips.length) Thandieu.play(Thandieu.clips[0].id);
      Thandieu.renderPanel();
    }, 120);

    Thandieu.renderPanel();
    return { object: baseObj, skeleton: Thandieu.skeleton, clips: entries };
  };

  /* ============================================================
     ĐĂNG KÝ RIG — đúng hình dạng RigAutoGen.current
     (name/preset/rootBone/root/bones/helper/mixer/target/boneCount/
     skeleton/clips) + đồng bộ PixiStudio.Rig.current cho Bone Editor.
     ============================================================ */
  Thandieu._registerRig = function () {
    try {
      if (!PixiStudio.RigAutoGen) return false;
      const bones = {};
      Object.keys(Thandieu.boneMap).forEach(function (k) { bones[k] = Thandieu.boneMap[k]; });

      /* prefix-tolerant getBoneByName — cùng regex rig-auto-gen.js:321 */
      if (Thandieu.skeleton) {
        Thandieu.skeleton.getBoneByName = function (name) {
          for (let i = 0; i < this.bones.length; i++) {
            if (this.bones[i].name === name || stripPre(this.bones[i].name) === stripPre(name)) return this.bones[i];
          }
          return undefined;
        };
        Thandieu.rootBone.skeleton = Thandieu.skeleton;
      }
      let helper = null;
      try {
        helper = new THREE.SkeletonHelper(Thandieu.rootBone);
        helper.material.linewidth = 2;
        Thandieu.root.add(helper);
      } catch (e) { /* helper optional */ }

      const rig = {
        name: 'Thần Điêu (Mixamo)',
        preset: 'Mixamo Compatible',
        rootBone: Thandieu.rootBone,
        root: Thandieu.root,
        bones: bones,
        helper: helper,
        mixer: Thandieu.mixer,
        target: Thandieu.root,
        boneCount: Thandieu.boneNames.length,
        skeleton: Thandieu.skeleton,
        clips: Thandieu.clips
      };
      PixiStudio.RigAutoGen.current = rig;
      Thandieu._registeredRig = rig;

      /* Đồng bộ Rig cũ (Bone Editor đọc map name → {name, parentName, children, worldPos}) */
      if (PixiStudio.Rig) {
        Thandieu.root.updateMatrixWorld(true);
        const rc = { name: 'Thần Điêu', preset: 'Mixamo Compatible', bones: {}, target: Thandieu.root, visualGroup: Thandieu.root, isAutoGen: true };
        Object.keys(bones).forEach(function (n) {
          const b = bones[n];
          const wp = new THREE.Vector3();
          b.getWorldPosition(wp);
          rc.bones[n] = {
            name: n,
            parentName: (b.parent && b.parent.isBone) ? stripPre(b.parent.name) : null,
            children: [],
            worldPos: wp
          };
        });
        Object.keys(rc.bones).forEach(function (n) {
          const p = rc.bones[n].parentName;
          if (p && rc.bones[p]) rc.bones[p].children.push(rc.bones[n]);
        });
        PixiStudio.Rig.current = rc;
      }
      return true;
    } catch (e) {
      console.warn('[Thandieu] đăng ký rig thất bại (IK/Pose sẽ không thấy nhân vật):', e.message);
      bus.emit('notify', { type: 'warning', title: 'Đăng ký rig thất bại', message: e.message + ' — nhân vật vẫn phát clip bình thường.' });
      return false;
    }
  };

  /* ============================================================
     8 CLIP SINH PROCEDURAL — rest-relative, theo mẫu
     FbxRig.generateIdle/generateAttack + GEN pattern anim-auto-gen
     (cánh = tay: LeftArm/RightArm; chân = UpLeg/Leg)
     ============================================================ */
  Thandieu._genWingFlap = function () {
    const dur = 1.6, t = times(5, dur);
    const L = boneTrackName('LeftArm'), R = boneTrackName('RightArm');
    const LF = boneTrackName('LeftForeArm'), RF = boneTrackName('RightForeArm');
    return new THREE.AnimationClip('WingFlap', dur, [
      qTrack(L, t, [delta('LeftArm', 0, 0, 0), delta('LeftArm', 0, 0, 50), delta('LeftArm', 0, 0, 0), delta('LeftArm', 0, 0, -30), delta('LeftArm', 0, 0, 0)]),
      qTrack(R, t, [delta('RightArm', 0, 0, 0), delta('RightArm', 0, 0, -50), delta('RightArm', 0, 0, 0), delta('RightArm', 0, 0, 30), delta('RightArm', 0, 0, 0)]),
      qTrack(LF, t, [delta('LeftForeArm', 0, 0, 0), delta('LeftForeArm', 0, 0, 20), delta('LeftForeArm', 0, 0, 0), delta('LeftForeArm', 0, 0, -10), delta('LeftForeArm', 0, 0, 0)]),
      qTrack(RF, t, [delta('RightForeArm', 0, 0, 0), delta('RightForeArm', 0, 0, -20), delta('RightForeArm', 0, 0, 0), delta('RightForeArm', 0, 0, 10), delta('RightForeArm', 0, 0, 0)]),
      qTrack(boneTrackName('Spine'), t, [delta('Spine', 0, 0, 0), delta('Spine', -4, 0, 0), delta('Spine', 0, 0, 0), delta('Spine', 4, 0, 0), delta('Spine', 0, 0, 0)]),
      vTrack(boneTrackName('Hips'), t, hipsPos(t, [0, 0.02, 0, 0.01, 0]))
    ]);
  };

  Thandieu._genPeck = function () {
    const dur = 1.0, t = [0, 0.25, 0.45, 0.7, 1.0];
    return new THREE.AnimationClip('Peck', dur, [
      qTrack(boneTrackName('Head'), t, [delta('Head', 0, 0, 0), delta('Head', 18, 0, 0), delta('Head', 38, 0, 0), delta('Head', 12, 0, 0), delta('Head', 0, 0, 0)]),
      qTrack(boneTrackName('Neck'), t, [delta('Neck', 0, 0, 0), delta('Neck', 8, 0, 0), delta('Neck', 18, 0, 0), delta('Neck', 6, 0, 0), delta('Neck', 0, 0, 0)]),
      qTrack(boneTrackName('Spine'), t, [delta('Spine', 0, 0, 0), delta('Spine', 5, 0, 0), delta('Spine', 12, 0, 0), delta('Spine', 4, 0, 0), delta('Spine', 0, 0, 0)]),
      qTrack(boneTrackName('LeftArm'), t, [delta('LeftArm', 0, 0, 0), delta('LeftArm', 0, 0, 8), delta('LeftArm', 0, 0, 12), delta('LeftArm', 0, 0, 6), delta('LeftArm', 0, 0, 0)]),
      qTrack(boneTrackName('RightArm'), t, [delta('RightArm', 0, 0, 0), delta('RightArm', 0, 0, -8), delta('RightArm', 0, 0, -12), delta('RightArm', 0, 0, -6), delta('RightArm', 0, 0, 0)]),
      vTrack(boneTrackName('Hips'), t, hipsPos(t, [0, -0.01, -0.02, -0.01, 0]))
    ]);
  };

  Thandieu._genJump = function () {
    const dur = 0.7, t = times(5, dur);
    return new THREE.AnimationClip('Jump', dur, [
      vTrack(boneTrackName('Hips'), t, hipsPos(t, [0, -0.06, 0.25, 0.02, 0])),
      qTrack(boneTrackName('LeftUpLeg'), t, [delta('LeftUpLeg', 0, 0, 0), delta('LeftUpLeg', -25, 0, 0), delta('LeftUpLeg', -45, 0, 0), delta('LeftUpLeg', -15, 0, 0), delta('LeftUpLeg', 0, 0, 0)]),
      qTrack(boneTrackName('RightUpLeg'), t, [delta('RightUpLeg', 0, 0, 0), delta('RightUpLeg', -25, 0, 0), delta('RightUpLeg', -45, 0, 0), delta('RightUpLeg', -15, 0, 0), delta('RightUpLeg', 0, 0, 0)]),
      qTrack(boneTrackName('LeftLeg'), t, [delta('LeftLeg', 0, 0, 0), delta('LeftLeg', 30, 0, 0), delta('LeftLeg', 55, 0, 0), delta('LeftLeg', 20, 0, 0), delta('LeftLeg', 0, 0, 0)]),
      qTrack(boneTrackName('RightLeg'), t, [delta('RightLeg', 0, 0, 0), delta('RightLeg', 30, 0, 0), delta('RightLeg', 55, 0, 0), delta('RightLeg', 20, 0, 0), delta('RightLeg', 0, 0, 0)]),
      qTrack(boneTrackName('LeftArm'), t, [delta('LeftArm', 0, 0, 0), delta('LeftArm', 0, 0, 30), delta('LeftArm', 0, 0, 60), delta('LeftArm', 0, 0, 20), delta('LeftArm', 0, 0, 0)]),
      qTrack(boneTrackName('RightArm'), t, [delta('RightArm', 0, 0, 0), delta('RightArm', 0, 0, -30), delta('RightArm', 0, 0, -60), delta('RightArm', 0, 0, -20), delta('RightArm', 0, 0, 0)]),
      qTrack(boneTrackName('Spine'), t, [delta('Spine', 0, 0, 0), delta('Spine', 6, 0, 0), delta('Spine', 10, 0, 0), delta('Spine', 4, 0, 0), delta('Spine', 0, 0, 0)])
    ]);
  };

  /* Attack — y hệt FbxRig.generateAttack: tìm frame RightArm deviation
     max trong Fast Run → wind-up → strike (tăng biên độ cánh) → rest. */
  Thandieu._genAttack = function (runClip) {
    const dur = 0.85;
    const t = [0, dur * 0.18, dur * 0.38, dur * 0.58, dur];
    const restQ = {};
    runClip.tracks.forEach(function (track) {
      if (track.name.indexOf('.quaternion') !== -1) {
        restQ[track.name] = new THREE.Quaternion().fromArray(track.values, 0);
      }
    });
    let strikeFrameIdx = 0, maxDev = -1;
    runClip.tracks.forEach(function (track) {
      if (track.name.indexOf('RightArm.quaternion') !== -1) {
        const rest = restQ[track.name];
        const count = track.times.length;
        for (let i = 0; i < count; i++) {
          const q = new THREE.Quaternion().fromArray(track.values, i * 4);
          const dev = Math.abs(q.x - rest.x) + Math.abs(q.y - rest.y) + Math.abs(q.z - rest.z) + Math.abs(q.w - rest.w);
          if (dev > maxDev) { maxDev = dev; strikeFrameIdx = i; }
        }
      }
    });
    const strikeQ = {};
    runClip.tracks.forEach(function (track) {
      if (track.name.indexOf('.quaternion') !== -1) {
        const count = track.times.length;
        const si = Math.min(strikeFrameIdx, count - 1);
        strikeQ[track.name] = new THREE.Quaternion().fromArray(track.values, si * 4);
      }
    });
    const windUpQ = {};
    Object.keys(strikeQ).forEach(function (name) {
      const q = strikeQ[name].clone();
      const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.55);
      windUpQ[name] = q.slerp(flip.multiply(q), 0.4);
    });
    const tracks = [];
    runClip.tracks.forEach(function (track) {
      if (track.name.indexOf('.quaternion') !== -1) {
        const rest = restQ[track.name] || new THREE.Quaternion();
        const strike = strikeQ[track.name] || rest;
        const windUp = windUpQ[track.name] || strike;
        const isArm = track.name.indexOf('Arm') !== -1 || track.name.indexOf('Shoulder') !== -1;
        const boost = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), isArm ? -0.35 : -0.12);
        const strikeBoost = strike.clone().multiply(boost);
        tracks.push(new THREE.QuaternionKeyframeTrack(track.name, t, [
          rest.x, rest.y, rest.z, rest.w,
          windUp.x, windUp.y, windUp.z, windUp.w,
          strikeBoost.x, strikeBoost.y, strikeBoost.z, strikeBoost.w,
          strike.x, strike.y, strike.z, strike.w,
          rest.x, rest.y, rest.z, rest.w
        ]));
      } else if (track.name.indexOf('.position') !== -1 && track.name.indexOf('Hips') !== -1) {
        const rest = [track.values[0], track.values[1], track.values[2]];
        tracks.push(new THREE.VectorKeyframeTrack(track.name, t, [
          rest[0], rest[1], rest[2],
          rest[0], rest[1] - 0.015, rest[2],
          rest[0], rest[1] + 0.02, rest[2] + 0.03,
          rest[0], rest[1], rest[2],
          rest[0], rest[1], rest[2]
        ]));
      }
    });
    return new THREE.AnimationClip('Attack', dur, tracks);
  };

  Thandieu._genTurn = function () {
    const dur = 1.2, t = times(5, dur);
    return new THREE.AnimationClip('Turn', dur, [
      qTrack(boneTrackName('Hips'), t, [deltaY('Hips', 0), deltaY('Hips', 90), deltaY('Hips', 180), deltaY('Hips', 270), deltaY('Hips', 360)]),
      qTrack(boneTrackName('LeftArm'), t, [delta('LeftArm', 0, 0, 0), delta('LeftArm', 0, 0, 20), delta('LeftArm', 0, 0, 20), delta('LeftArm', 0, 0, 20), delta('LeftArm', 0, 0, 0)]),
      qTrack(boneTrackName('RightArm'), t, [delta('RightArm', 0, 0, 0), delta('RightArm', 0, 0, -20), delta('RightArm', 0, 0, -20), delta('RightArm', 0, 0, -20), delta('RightArm', 0, 0, 0)]),
      qTrack(boneTrackName('Spine'), t, [delta('Spine', 0, 0, 0), delta('Spine', 0, 5, 0), delta('Spine', 0, 0, 0), delta('Spine', 0, -5, 0), delta('Spine', 0, 0, 0)])
    ]);
  };

  /* Cúi chào — theo mẫu GEN.Bow (anim-auto-gen), chuyển sang rest-relative */
  Thandieu._genBow = function () {
    const dur = 1.4, t = times(5, dur);
    return new THREE.AnimationClip('Bow', dur, [
      qTrack(boneTrackName('Spine'), t, [delta('Spine', 0, 0, 0), delta('Spine', 12, 0, 0), delta('Spine', 28, 0, 0), delta('Spine', 14, 0, 0), delta('Spine', 0, 0, 0)]),
      qTrack(boneTrackName('Spine2'), t, [delta('Spine2', 0, 0, 0), delta('Spine2', 10, 0, 0), delta('Spine2', 22, 0, 0), delta('Spine2', 10, 0, 0), delta('Spine2', 0, 0, 0)]),
      qTrack(boneTrackName('Head'), t, [delta('Head', 0, 0, 0), delta('Head', 8, 0, 0), delta('Head', 18, 0, 0), delta('Head', 8, 0, 0), delta('Head', 0, 0, 0)]),
      qTrack(boneTrackName('LeftArm'), t, [delta('LeftArm', 0, 0, 0), delta('LeftArm', 8, 0, 12), delta('LeftArm', 14, 0, 18), delta('LeftArm', 8, 0, 12), delta('LeftArm', 0, 0, 0)]),
      qTrack(boneTrackName('RightArm'), t, [delta('RightArm', 0, 0, 0), delta('RightArm', 8, 0, -12), delta('RightArm', 14, 0, -18), delta('RightArm', 8, 0, -12), delta('RightArm', 0, 0, 0)]),
      vTrack(boneTrackName('Hips'), t, hipsPos(t, [0, -0.02, -0.04, -0.02, 0]))
    ]);
  };

  Thandieu._genWalk = function () {
    const dur = 1.4, t = times(9, dur);
    const s = [0, 1, 2, 3, 4, 3, 2, 1, 0];
    const legL = [26, 10, -14, -26, -10, 14, 26, 10, 0];
    const legR = [-10, -26, -10, 26, 10, -14, -10, -26, 0];
    const kneeL = [-8, -30, -12, 0, -8, -6, -8, -30, 0];
    const kneeR = [-6, -8, -30, -12, 0, -8, -6, -8, 0];
    const armL = [-18, 0, 18, 0, -18, 0, -18, 0, 0];
    const armR = [18, 0, -18, 0, 18, 0, 18, 0, 0];
    return new THREE.AnimationClip('Walk', dur, [
      vTrack(boneTrackName('Hips'), t, s.map(function (_, i) { const rp = restPos('Hips'); return [rp[0], rp[1] + (i % 2 === 0 ? 0.018 : 0), rp[2]]; })),
      qTrack(boneTrackName('LeftUpLeg'), t, s.map(function (_, i) { return delta('LeftUpLeg', legL[i], 0, 0); })),
      qTrack(boneTrackName('RightUpLeg'), t, s.map(function (_, i) { return delta('RightUpLeg', legR[i], 0, 0); })),
      qTrack(boneTrackName('LeftLeg'), t, s.map(function (_, i) { return delta('LeftLeg', kneeL[i], 0, 0); })),
      qTrack(boneTrackName('RightLeg'), t, s.map(function (_, i) { return delta('RightLeg', kneeR[i], 0, 0); })),
      qTrack(boneTrackName('LeftArm'), t, s.map(function (_, i) { return delta('LeftArm', armL[i], 0, 10); })),
      qTrack(boneTrackName('RightArm'), t, s.map(function (_, i) { return delta('RightArm', armR[i], 0, -10); })),
      qTrack(boneTrackName('Spine'), t, s.map(function (_, i) { return delta('Spine', i % 2 === 0 ? 3 : 0, i % 2 ? 3 : -3, 0); }))
    ]);
  };

  Thandieu._genDeath = function () {
    const dur = 1.5, t = times(5, dur);
    return new THREE.AnimationClip('Death', dur, [
      vTrack(boneTrackName('Hips'), t, hipsPos(t, [0, -0.1, -0.45, -0.7, -0.72])),
      qTrack(boneTrackName('Spine'), t, [delta('Spine', 0, 0, 0), delta('Spine', -15, 0, 0), delta('Spine', -40, 0, 0), delta('Spine', -60, 0, 0), delta('Spine', -65, 0, 0)]),
      qTrack(boneTrackName('Head'), t, [delta('Head', 0, 0, 0), delta('Head', -8, 0, 0), delta('Head', -18, 0, 0), delta('Head', -25, 0, 0), delta('Head', -25, 0, 0)]),
      qTrack(boneTrackName('LeftArm'), t, [delta('LeftArm', 0, 0, 0), delta('LeftArm', 0, 0, 30), delta('LeftArm', 0, 0, 55), delta('LeftArm', 0, 0, 70), delta('LeftArm', 0, 0, 70)]),
      qTrack(boneTrackName('RightArm'), t, [delta('RightArm', 0, 0, 0), delta('RightArm', 0, 0, -30), delta('RightArm', 0, 0, -55), delta('RightArm', 0, 0, -70), delta('RightArm', 0, 0, -70)]),
      qTrack(boneTrackName('LeftUpLeg'), t, [delta('LeftUpLeg', 0, 0, 0), delta('LeftUpLeg', -5, 0, 0), delta('LeftUpLeg', -10, 0, 0), delta('LeftUpLeg', -10, 0, 0), delta('LeftUpLeg', -10, 0, 0)]),
      qTrack(boneTrackName('RightUpLeg'), t, [delta('RightUpLeg', 0, 0, 0), delta('RightUpLeg', -5, 0, 0), delta('RightUpLeg', -10, 0, 0), delta('RightUpLeg', -10, 0, 0), delta('RightUpLeg', -10, 0, 0)])
    ]);
  };

  /* ============================================================
     PLAYBACK — crossfade 0.25s (mẫu FbxRig.play)
     ============================================================ */
  Thandieu.play = function (clipId) {
    if (!Thandieu.mixer || !Thandieu.clips.length) {
      bus.emit('notify', { type: 'warning', title: 'Thần Điêu', message: 'Load nhân vật trước (nút Load từ models/thandieu/ hoặc chọn 3 file FBX).' });
      return;
    }
    const entry = Thandieu.clips.find(function (c) { return c.id === clipId; });
    if (!entry) return;
    const bad = PixiStudio.Anim && PixiStudio.Anim.validateClip ? PixiStudio.Anim.validateClip(entry.clip) : [];
    if (bad.length) {
      bus.emit('notify', { type: 'error', title: 'Clip Thần Điêu không hợp lệ', message: entry.id + ': ' + bad[0] + ' — đã chặn phát.' });
      return;
    }
    const action = Thandieu.mixer.clipAction(entry.clip);
    action.reset();
    action.setLoop(entry.loop ? THREE.LoopRepeat : THREE.LoopOnce);
    action.clampWhenFinished = !entry.loop;
    action.setEffectiveTimeScale(Thandieu.speed);
    action.paused = false;
    action.play();
    if (Thandieu.current && Thandieu.actions[Thandieu.current] && Thandieu.current !== clipId) {
      Thandieu.actions[Thandieu.current].crossFadeTo(action, 0.25, false);
    }
    Thandieu.actions[clipId] = action;
    Thandieu.current = clipId;
    Thandieu.paused = false;
    if (PixiStudio.RigAutoGen) PixiStudio.RigAutoGen.playing = true;
    bus.emit('thandieu:clip-played', { clip: clipId, duration: entry.duration });
    Thandieu.renderPanel();
  };

  Thandieu.pause = function () {
    const a = Thandieu.current && Thandieu.actions[Thandieu.current];
    if (a) a.paused = true;
    Thandieu.paused = true;
    if (PixiStudio.RigAutoGen && Thandieu._registeredRig && PixiStudio.RigAutoGen.current === Thandieu._registeredRig) {
      PixiStudio.RigAutoGen.playing = false;
    }
    Thandieu.renderPanel();
  };

  Thandieu.resume = function () {
    const a = Thandieu.current && Thandieu.actions[Thandieu.current];
    if (a) a.paused = false;
    Thandieu.paused = false;
    if (PixiStudio.RigAutoGen) PixiStudio.RigAutoGen.playing = true;
    Thandieu.renderPanel();
  };

  Thandieu.stop = function () {
    /* Về đúng T-Pose = bind pose lúc mới load (snapshot rest).
       LƯU Ý ĐÃ KIỂM CHỨNG: frame-0 của clip T-pose trong file Mixamo LỆCH
       bind pose (tay 0.51 rad, chân 0.18–0.37 rad, ngón tay tới 0.87 rad
       ở LeftHandIndex1 — do pre-rotation của skeleton trong file), nên
       phát clip TPose KHÔNG đưa nhân vật về đúng pose lúc load. Vì vậy
       stop() dừng mixer và khôi phục trực tiếp snapshot rest; clip TPose
       vẫn phát được như dữ liệu gốc của file (xem docs/THANDIEU_CHARACTER.md). */
    if (Thandieu.mixer) Thandieu.mixer.stopAllAction();
    Object.keys(Thandieu.rest).forEach(function (canon) {
      const b = Thandieu.boneMap[canon];
      if (b) { b.quaternion.copy(Thandieu.rest[canon].q); b.position.copy(Thandieu.rest[canon].p); }
    });
    Thandieu.current = null;
    Thandieu.paused = false;
    Thandieu.renderPanel();
  };

  Thandieu.setSpeed = function (s) {
    /* parseFloat(0) || 1 → 1 (0 là falsy) nên setSpeed(0) trước đây ra 1x.
       Dùng isFinite thay cho || để 0 clamp đúng về 0.25x. */
    let v = parseFloat(s);
    if (!isFinite(v)) v = 1;
    s = Math.max(0.25, Math.min(2, v));
    Thandieu.speed = s;
    const a = Thandieu.current && Thandieu.actions[Thandieu.current];
    if (a) a.setEffectiveTimeScale(s);
  };

  Thandieu.update = function (dt) {
    if (!Thandieu.mixer || !Thandieu.loaded || Thandieu.paused) return;
    /* RigAutoGen.update đã đẩy mixer này (khi rig Thần Điêu đang là
       current và playing) → tránh cập nhật 2 lần trong 1 frame. */
    if (PixiStudio.RigAutoGen && Thandieu._registeredRig &&
        PixiStudio.RigAutoGen.current === Thandieu._registeredRig && PixiStudio.RigAutoGen.playing) {
      /* vẫn cập nhật dòng trạng thái bên dưới */
    } else {
      Thandieu.mixer.update(dt);
    }
    Thandieu._statusT += dt;
    if (Thandieu._statusT > 0.25) {
      Thandieu._statusT = 0;
      const st = document.getElementById('thandieu-status');
      if (st && Thandieu.current) {
        const entry = Thandieu.clips.find(function (c) { return c.id === Thandieu.current; });
        const t = Thandieu.actions[Thandieu.current] ? Thandieu.actions[Thandieu.current].time : 0;
        st.textContent = 'Đang phát: ' + Thandieu.current + ' · ' + t.toFixed(2) + 's / ' +
          (entry ? entry.duration.toFixed(2) : '?') + 's · tốc độ ' + Thandieu.speed.toFixed(2) + 'x';
      }
    }
  };

  /* ============================================================
     VIEWPORT — theo mẫu FbxRig.addToViewport/removeFromViewport
     ============================================================ */
  Thandieu.addToViewport = function () {
    if (!Thandieu.root || !PixiStudio.Viewport || !PixiStudio.Viewport.modelRoot) return;
    Thandieu._hiddenPreview = [];
    PixiStudio.Viewport.modelRoot.children.forEach(function (child) {
      if (child !== Thandieu.root && child.visible) {
        Thandieu._hiddenPreview.push(child);
        child.visible = false;
      }
    });
    if (Thandieu.root.parent) Thandieu.root.parent.remove(Thandieu.root);
    PixiStudio.Viewport.modelRoot.add(Thandieu.root);
    const box = new THREE.Box3().setFromObject(Thandieu.root);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const scale = 2.0 / Math.max(0.001, size.y);
      Thandieu.root.scale.setScalar(scale);
      Thandieu.root.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(Thandieu.root);
      const c2 = box2.getCenter(new THREE.Vector3());
      Thandieu.root.position.x -= c2.x;
      Thandieu.root.position.z -= c2.z;
      Thandieu.root.position.y -= box2.min.y;
    }
    if (PixiStudio.State && PixiStudio.State.select) PixiStudio.State.select(Thandieu.root);
    if (PixiStudio.Viewport.orbit) {
      PixiStudio.Viewport.orbit.focus(Thandieu.root, true);
      PixiStudio.Viewport.setView('perspective');
    }
  };

  Thandieu.removeFromViewport = function () {
    if (Thandieu.mixer) Thandieu.mixer.stopAllAction();
    Thandieu.current = null;
    if (Thandieu.root && Thandieu.root.parent) Thandieu.root.parent.remove(Thandieu.root);
    (Thandieu._hiddenPreview || []).forEach(function (child) { child.visible = true; });
    Thandieu._hiddenPreview = [];
    Thandieu.renderPanel();
  };

  /* ============================================================
     EXPORT CLIPS JSON — format riêng, mẫu FbxRig.exportClipsJSON
     ============================================================ */
  Thandieu.exportClipsJSON = function () {
    if (!Thandieu.clips.length) {
      bus.emit('notify', { type: 'warning', title: 'Thần Điêu', message: 'Chưa có clip nào để export — load nhân vật trước.' });
      return;
    }
    const data = Thandieu.clips.map(function (c) {
      return {
        id: c.id, name: c.name, duration: c.duration, loop: c.loop, source: c.source,
        tracks: c.clip.tracks.map(function (t) {
          return { name: t.name, times: Array.from(t.times).map(function (x) { return Math.round(x * 1000) / 1000; }), values: Array.from(t.values).map(function (x) { return Math.round(x * 10000) / 10000; }) };
        })
      };
    });
    U.downloadText(JSON.stringify({
      format: 'pixistudio-thandieu-clips-1',
      character: 'than_dieu',
      skeleton: { boneNames: Thandieu.boneNames, boneCount: Thandieu.stats.bones },
      stats: Thandieu.stats,
      clips: data
    }, null, 1), 'thandieu_clips.json', 'application/json');
    bus.emit('notify', { type: 'success', title: 'Thần Điêu clips exported', message: 'thandieu_clips.json — ' + data.length + ' clips' });
  };

  /* ============================================================
     UI — section trong Animation panel, chèn sau fbx-rig-section
     ============================================================ */
  Thandieu.renderPanel = function () {
    const body = document.getElementById('animation-page-body');
    if (!body) return;
    const old = document.getElementById('thandieu-section');
    if (old) old.remove();

    const section = U.el('div', { class: 'section-block', id: 'thandieu-section' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('character') }),
        U.el('span', { text: '🦅 Thần Điêu — nhân vật Mixamo · 11 clips' })
      ])
    ]);
    const sc = U.el('div', { class: 'section-content' });

    if (!Thandieu.loaded) {
      sc.appendChild(U.el('div', { class: 'dim small', style: 'line-height:1.6;margin-bottom:8px;', text: 'Nhân vật Thần Điêu (Mixamo rig, 41 bones, 43.133 tris). Load 3 file FBX từ thư mục models/thandieu/ trong repo, hoặc chọn 3 file từ máy của bạn.' }));
      sc.appendChild(U.el('button', {
        class: 'btn primary lg block', style: 'margin-bottom:8px;',
        html: U.icon('import') + '&nbsp; Load từ models/thandieu/',
        onclick: function () {
          if (PixiStudio.Notifications) PixiStudio.Notifications.showLoading('Đang load Thần Điêu (3 file FBX)…', 30);
          Thandieu.loadFromRepo().then(function () {
            if (PixiStudio.Notifications) PixiStudio.Notifications.hideLoading();
          }).catch(function (e) {
            if (PixiStudio.Notifications) PixiStudio.Notifications.hideLoading();
            bus.emit('notify', { type: 'error', title: 'Load Thần Điêu thất bại', message: e.message + ' — kiểm tra 3 file FBX đã upload lên models/thandieu/ chưa, hoặc dùng nút chọn file bên dưới.' });
          });
        }
      }));
      /* File picker */
      const fileInput = U.el('input', { type: 'file', accept: '.fbx', multiple: 'multiple', style: 'display:none;' });
      fileInput.addEventListener('change', function () {
        if (!fileInput.files.length) return;
        if (PixiStudio.Notifications) PixiStudio.Notifications.showLoading('Đang parse 3 file FBX…', 30);
        Thandieu.loadFromFiles(fileInput.files).then(function () {
          if (PixiStudio.Notifications) PixiStudio.Notifications.hideLoading();
        }).catch(function (e) {
          if (PixiStudio.Notifications) PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'Load Thần Điêu thất bại', message: e.message });
        });
        fileInput.value = '';
      });
      sc.appendChild(fileInput);
      sc.appendChild(U.el('button', {
        class: 'btn lg block', style: 'margin-bottom:8px;',
        html: U.icon('import') + '&nbsp; Chọn 3 file FBX từ máy…',
        onclick: function () { fileInput.click(); }
      }));
      /* Drop zone */
      const drop = U.el('div', {
        class: 'dim small', style: 'border:1px dashed var(--border);border-radius:6px;padding:10px;text-align:center;line-height:1.5;',
        text: '…hoặc kéo-thả 3 file FBX vào đây: thandieu-Mixamo.fbx · Neutral_Idle.fbx · Than_dieu_Fast_Run.fbx'
      });
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.style.borderColor = 'var(--accent)'; });
      drop.addEventListener('dragleave', function () { drop.style.borderColor = ''; });
      drop.addEventListener('drop', function (e) {
        e.preventDefault(); drop.style.borderColor = '';
        if (!e.dataTransfer.files.length) return;
        Thandieu.loadFromFiles(e.dataTransfer.files).catch(function (err) {
          bus.emit('notify', { type: 'error', title: 'Load Thần Điêu thất bại', message: err.message });
        });
      });
      sc.appendChild(drop);
      sc.appendChild(U.el('div', { class: 'dim small', style: 'margin-top:8px;line-height:1.5;', text: 'File FBX là binary nên không đẩy lên GitHub qua connector — upload 3 file vào models/thandieu/ bằng GitHub web UI (xem docs/THANDIEU_CHARACTER.md).' }));
      section.appendChild(sc);
      const fbxSection = document.getElementById('fbx-rig-section');
      if (fbxSection && fbxSection.parentNode === body) body.insertBefore(section, fbxSection.nextSibling);
      else body.insertBefore(section, body.firstChild);
      return;
    }

    /* Loaded state — thông tin nhân vật */
    const realCount = Thandieu.clips.filter(function (c) { return c.source === 'fbx'; }).length;
    const genCount = Thandieu.clips.length - realCount;
    sc.appendChild(U.el('div', { class: 'info-row' }, [
      U.el('span', { class: 'i-label', text: 'Nhân vật' }),
      U.el('span', { class: 'i-value', text: 'Thần Điêu · ' + Thandieu.stats.bones + ' bones · ' + Thandieu.stats.tris.toLocaleString() + ' tris' })
    ]));
    sc.appendChild(U.el('div', { class: 'info-row' }, [
      U.el('span', { class: 'i-label', text: 'Mesh' }),
      U.el('span', { class: 'i-value', text: Thandieu.stats.verts.toLocaleString() + ' verts · chân y=0' })
    ]));
    sc.appendChild(U.el('div', { class: 'info-row', style: 'margin-bottom:8px;' }, [
      U.el('span', { class: 'i-label', text: 'Clips' }),
      U.el('span', { class: 'i-value', text: Thandieu.clips.length + ' (' + realCount + ' thật · ' + genCount + ' sinh)' })
    ]));

    /* Lưới 11 nút clip */
    const grid = U.el('div', { class: 'mt-grid', style: 'grid-template-columns:repeat(3,1fr);gap:5px;' });
    Thandieu.clips.forEach(function (c) {
      grid.appendChild(U.el('button', {
        class: 'mt-btn' + (Thandieu.current === c.id ? ' primary' : ''),
        html: U.icon(c.icon) + '<span>' + c.name + '</span><small style="display:block;font-size:10px;opacity:.75;">' +
          c.duration.toFixed(2) + 's · ' + (c.loop ? 'loop' : 'once') + ' · ' + (c.source === 'fbx' ? 'FBX thật' : 'sinh') + '</small>',
        onclick: function () { Thandieu.play(c.id); }
      }));
    });
    sc.appendChild(grid);

    /* Trạng thái phát */
    sc.appendChild(U.el('div', {
      id: 'thandieu-status', class: 'dim small', style: 'margin-top:8px;line-height:1.5;',
      text: Thandieu.current ? ('Đang phát: ' + Thandieu.current) : 'Chưa phát clip nào — bấm 1 clip ở trên.'
    }));

    /* Điều khiển phát */
    const ctl = U.el('div', { style: 'display:flex;gap:6px;margin-top:8px;' }, [
      U.el('button', {
        class: 'btn sm grow', html: U.icon(Thandieu.paused ? 'play' : 'pause') + (Thandieu.paused ? ' Resume' : ' Pause'),
        onclick: function () { if (Thandieu.paused) Thandieu.resume(); else Thandieu.pause(); }
      }),
      U.el('button', { class: 'btn sm grow', html: U.icon('stop') + ' Stop (về T-Pose)', onclick: function () { Thandieu.stop(); } })
    ]);
    sc.appendChild(ctl);

    /* Thanh trượt tốc độ */
    const speedRow = U.el('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:8px;' });
    const speedLabel = U.el('span', { class: 'dim small', text: 'Tốc độ: ' + Thandieu.speed.toFixed(2) + 'x' });
    const speedInput = U.el('input', { type: 'range', min: '0.25', max: '2', step: '0.25', value: String(Thandieu.speed), style: 'flex:1;' });
    speedInput.addEventListener('input', function () {
      Thandieu.setSpeed(speedInput.value);
      speedLabel.textContent = 'Tốc độ: ' + Thandieu.speed.toFixed(2) + 'x';
    });
    speedRow.appendChild(speedLabel);
    speedRow.appendChild(speedInput);
    sc.appendChild(speedRow);

    /* Viewport + export + remove */
    const row = U.el('div', { style: 'display:flex;gap:6px;margin-top:8px;' }, [
      U.el('button', { class: 'btn sm grow', html: U.icon('eye') + ' Preview', onclick: function () { Thandieu.addToViewport(); } }),
      U.el('button', { class: 'btn sm grow', html: U.icon('export') + ' Clips JSON', onclick: function () { Thandieu.exportClipsJSON(); } }),
      U.el('button', { class: 'btn sm ghost', html: U.icon('x') + ' Remove', onclick: function () { Thandieu.removeFromViewport(); } })
    ]);
    sc.appendChild(row);
    sc.appendChild(U.el('div', { class: 'dim small', style: 'margin-top:8px;line-height:1.5;', text: 'Rig Mixamo dạng humanoid — cánh = tay (LeftArm/RightArm). IK/Pose/AnimAutoGen nhận nhân vật qua RigAutoGen.current. Clip once dừng ở frame cuối (clamp); Stop trở về T-Pose.' }));

    section.appendChild(sc);
    const fbxSection = document.getElementById('fbx-rig-section');
    if (fbxSection && fbxSection.parentNode === body) body.insertBefore(section, fbxSection.nextSibling);
    else body.insertBefore(section, body.firstChild);
  };

  /* Gắn panel vào luồng render của Animation tab: toolbar.js gọi
     FbxRig.renderPanel() mỗi lần mở tab Animation — bọc lại để panel
     Thần Điêu luôn render ngay sau fbx-rig-section (không sửa toolbar.js). */
  if (PixiStudio.FbxRig && PixiStudio.FbxRig.renderPanel && !PixiStudio.FbxRig._thandieuWrapped) {
    const origRenderPanel = PixiStudio.FbxRig.renderPanel;
    PixiStudio.FbxRig.renderPanel = function () {
      origRenderPanel();
      Thandieu.renderPanel();
    };
    PixiStudio.FbxRig._thandieuWrapped = true;
  }

  window.PixiStudio.Thandieu = Thandieu;
})();
