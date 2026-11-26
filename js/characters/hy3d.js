/* ============================================================
 * characters/hy3d.js — NHÂN VẬT HY3D (Tencent Hunyuan3D, Blender rig)
 * 1 nhân vật hoàn chỉnh dùng trong Studio, theo đúng mẫu Thandieu:
 *   1. Load 2 file FBX thật (cùng 1 nhân vật, đã kiểm chứng):
 *      • bonechar.fbx — T-pose sạch (base mesh + skeleton, 0 anim)
 *      • punch.fbx    — cùng mesh + skeleton + 1 clip đấm 2.333s
 *   2. Base = bonechar (bind T-pose sạch); clip Punch lấy từ punch.fbx
 *      (track khớp tên xương nên bind thẳng vào skeleton bonechar).
 *   3. Đăng ký skeleton vào RigAutoGen.current để IK/Pose/AnimAutoGen
 *      nhận nhân vật.
 *   4. 2 clips: Punch thật từ FBX (loop) + TPose tĩnh sinh từ bind pose.
 *
 * SỐ LIỆU ĐÃ KIỂM CHỨNG (three r128 FBXLoader + fbx2gltf 0.9.7):
 *   SkinnedMesh node_0001 · 150.000 verts (non-indexed) · 50.000 tris ·
 *   skin weights hợp lệ (tổng 1.0, 0 bad) · cao ~153cm (đơn vị cm của
 *   Blender) · chân y≈0 · mặt hướng +Z · bind T-pose.
 *   Skeleton 28 bones, tên kiểu Mixamo KHÔNG prefix mixamorig:
 *   (root, Hips, Spine, Spine1, Spine2, Neck, Head, Head_end,
 *   LeftShoulder/LeftArm/LeftForeArm/LeftHand/LeftHand_end,
 *   LeftUpLeg/LeftLeg/LeftFoot/LeftToeBase/LeftToeBase_end, bên phải
 *   tương tự). Skin dùng 23 xương (không *_end, không root — root có
 *   trong skin list nhưng *_end thì không).
 *   Tay ĐÚNG hướng: xương bàn tay lệch trục cẳng tay chỉ 3.7° (trái) /
 *   9.2° (phải) — gần Mixamo 0°, KHÔNG bị lỗi 147° như rig studio cũ.
 *   Tỉ lệ chibi: xương đầu ~50cm/153cm (~1/3 chiều cao), đùi 21.6cm,
 *   cẳng chân 21.5cm, cánh tay trên 14.9cm, cẳng tay 11.9cm, hông 52cm.
 *   Clip "Armature|39f5..._remap": 2.333s @60fps, 141 keys, 87 tracks,
 *   21 xương xoay (Spine1 + root + *_end đứng yên), KHÔNG root motion
 *   (Hips Y cố định 52.1cm), LOOP kín (key đầu = key cuối). Diễn biến:
 *   tay trái đấm thẳng ra trước ở t=0 → thu về → tay phải đấm thẳng
 *   ~0.83–1.17s (tay ra 44cm trước ngực, khuỷu 157°) → thu về.
 *   Tên clip "_remap" + hash = animation retarget trong Blender 3.6.14
 *   rồi mới xuất. Cả 2 file xuất từ Blender (bonechar: 4.0.0 FBX IO
 *   5.8.12; punch: 3.6.14 FBX IO 5.4.1), FBX 7400, đơn vị cm, Z-up gốc.
 *   3 texture nhúng: baseColor texture_pbr_20250901.png + normalMap +
 *   AO/metal/rough (kênh Green = roughness). Material.001.
 *
 * LƯU Ý ĐÃ KIỂM CHỨNG (đừng "sửa" lại):
 *   • Model nodes trong punch.fbx lưu tư thế FRAME-0 (tay trái đang
 *     đấm), KHÔNG phải bind pose — vì vậy base PHẢI là bonechar.fbx,
 *     và stop() khôi phục snapshot rest từ bonechar, đừng phát frame 0.
 *   • skeleton.boneInverses KHÔNG khôi phục được bind pose (đo trong
 *     chính bonechar đã lệch tới 16.8° so với hierarchy đã parse) —
 *     đừng dùng boneInverses làm rest.
 *   • Mesh node mang quaternion -90° X (Z-up Blender → Y-up), geometry
 *     local vẫn Z-up; Box3.setFromObject đo đúng cao 153.4cm.
 *   • FBXLoader cảnh báo "ShininessExponent / ReflectionFactor map is
 *     not supported" — VÔ HẠI, không sửa mesh.
 *   • KHÔNG upload 2 file này lên Mixamo: FBX 7400 > giới hạn 7300,
 *     và đã có skeleton nên Mixamo từ chối map.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;
  const stripPre = function (s) { return String(s == null ? '' : s).replace(/^mixamorig:?/i, ''); };

  const REPO_DIR = 'models/hy3d/';
  const FILES = {
    base: REPO_DIR + 'bonechar.fbx',
    punch: REPO_DIR + 'punch.fbx'
  };

  /* 2 clips: id · tên hiển thị · icon · loop · nguồn · thời lượng
     (Punch lấy duration thật từ FBX; TPose sinh tĩnh từ bind pose) */
  const CLIP_DEFS = [
    { id: 'Punch', name: 'Đấm thẳng', icon: 'swords',    loop: true,  source: 'fbx',       dur: 2.333 },
    { id: 'TPose', name: 'T-Pose',    icon: 'character', loop: false, source: 'generated', dur: 0.033 }
  ];

  const Hy3d = {
    root: null,            // THREE.Group từ FBX base (bonechar)
    skinnedMesh: null,
    skeleton: null,
    rootBone: null,
    boneMap: {},           // canonical → THREE.Bone
    fullName: {},          // canonical → tên đầy đủ trong FBX (vd 'LeftArm')
    rest: {},              // canonical → { q: Quaternion, p: Vector3 } lúc bind T-pose
    boneNames: [],         // tên đầy đủ của 28 bones
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
    _fallbackFrame0: false, // true khi base là punch.fbx (rest = frame 0)
    _statusT: 0,
    stats: { verts: 0, tris: 0, bones: 0, skinnedBones: 0, height: 0, heightCm: 0, feetY: 0, skinBad: 0, bonesUsed: 0 }
  };

  /* ============================================================
     LOAD — từ repo (models/hy3d/) hoặc file do user chọn
     ============================================================ */
  Hy3d.loadFromUrl = function (url) {
    return new Promise(function (resolve, reject) {
      if (!window.THREE || !THREE.FBXLoader) { reject(new Error('FBXLoader chưa load (CDN)')); return; }
      if (typeof fflate === 'undefined') { reject(new Error('fflate chưa load (CDN)')); return; }
      const loader = new THREE.FBXLoader();
      loader.load(url, resolve, undefined, function (err) {
        reject(new Error('FBX load fail: ' + url + ' — ' + String(err && err.message || err)));
      });
    });
  };

  Hy3d.loadFromRepo = function () {
    const baseP = Hy3d.loadFromUrl(FILES.base);
    const punchP = Hy3d.loadFromUrl(FILES.punch).catch(function (e) {
      console.warn('[Hy3d] thiếu punch.fbx:', e.message);
      return null;
    });
    return baseP.then(function (baseObj) {
      return punchP.then(function (punchObj) {
        Hy3d.fileName = 'models/hy3d/ (bonechar.fbx + punch.fbx)';
        const punchClip = punchObj ? (punchObj.animations || [])[0] || null : null;
        return Hy3d._process(baseObj, punchClip, { baseIsPunch: false });
      });
    }).catch(function (e) {
      /* Fallback: chỉ có punch.fbx — dùng nó làm base luôn. Rest lúc này
         là frame-0 (tay trái đang đấm), KHÔNG phải T-pose: báo rõ cho user. */
      console.warn('[Hy3d] bonechar.fbx không load được, thử punch.fbx làm base:', e.message);
      return Hy3d.loadFromUrl(FILES.punch).then(function (punchObj) {
        Hy3d.fileName = 'models/hy3d/punch.fbx (chỉ có punch — thiếu bonechar.fbx)';
        Hy3d._fallbackFrame0 = true;
        const punchClip = (punchObj.animations || [])[0] || null;
        return Hy3d._process(punchObj, punchClip, { baseIsPunch: true });
      });
    });
  };

  Hy3d.loadFromFiles = function (fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return Promise.reject(new Error('Chưa chọn file nào.'));
    const fbx = files.filter(function (f) { return /\.fbx$/i.test(f.name || ''); });
    if (!fbx.length) return Promise.reject(new Error('Chọn file bonechar.fbx và/hoặc punch.fbx.'));
    /* Phân loại theo tên file */
    const baseFile = fbx.find(function (f) { return /bonechar/i.test(f.name || ''); }) ||
      fbx.find(function (f) { return !/punch/i.test(f.name || ''); }) || fbx[0];
    const punchFile = fbx.find(function (f) { return /punch/i.test(f.name || ''); });
    const loader = new THREE.FBXLoader();
    const parseOne = function (file) {
      return U.readFileAsArrayBuffer(file).then(function (ab) {
        return loader.parse(ab, '');
      });
    };
    return parseOne(baseFile).then(function (baseObj) {
      const baseIsPunch = baseFile === punchFile;
      const jobs = [
        (punchFile && punchFile !== baseFile)
          ? parseOne(punchFile).catch(function (e) { console.warn('[Hy3d] punch parse fail:', e.message); return null; })
          : Promise.resolve(baseIsPunch ? baseObj : null)
      ];
      return Promise.all(jobs).then(function (pair) {
        Hy3d.fileName = baseFile.name + (punchFile && punchFile !== baseFile ? ' + ' + punchFile.name : '');
        if (baseIsPunch) Hy3d._fallbackFrame0 = true;
        const punchObj = pair[0];
        const punchClip = punchObj ? (punchObj.animations || [])[0] || null : null;
        return Hy3d._process(baseObj, punchClip, { baseIsPunch: baseIsPunch });
      });
    });
  };

  /* ============================================================
     _process — skeleton + rest pose + 2 clips + đăng ký rig
     ============================================================ */
  Hy3d._process = function (baseObj, punchClip, opts) {
    opts = opts || {};
    Hy3d.root = baseObj;
    Hy3d.loaded = false;

    /* Skeleton + rest pose snapshot (TRƯỚC khi phát clip nào).
       Base bonechar: parsed locals = bind T-pose sạch (đã kiểm chứng
       bằng world position: tay dang ngang, chân y≈0).
       Base punch (fallback): parsed locals = frame-0, xem _fallbackFrame0. */
    const bones = [];
    let skinned = null;
    baseObj.traverse(function (o) {
      if (o.isBone) bones.push(o);
      if (o.isSkinnedMesh && !skinned) skinned = o;
      if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    });
    if (!bones.length || !skinned) throw new Error('FBX không có skeleton/skinned mesh — không phải file HY3D bonechar/punch.');
    Hy3d.skinnedMesh = skinned;
    Hy3d.skeleton = skinned.skeleton || null;
    Hy3d.boneNames = bones.map(function (b) { return b.name; });
    Hy3d.rootBone = bones.find(function (b) { return /^Hips$/i.test(b.name); }) || bones[0];
    bones.forEach(function (b) {
      const canon = stripPre(b.name);
      Hy3d.boneMap[canon] = b;
      Hy3d.fullName[canon] = b.name;
      Hy3d.rest[canon] = { q: b.quaternion.clone(), p: b.position.clone() };
    });
    const pos = skinned.geometry.attributes.position;
    Hy3d.stats.verts = pos.count;
    Hy3d.stats.tris = Math.round((skinned.geometry.index ? skinned.geometry.index.count : pos.count) / 3);
    Hy3d.stats.bones = bones.length;
    Hy3d.stats.skinnedBones = (skinned.skeleton && skinned.skeleton.bones.length) || 0;

    /* Skin weights kiểm tra (đo lại từ geometry thật) */
    const sw = skinned.geometry.attributes.skinWeight;
    const si = skinned.geometry.attributes.skinIndex;
    let bad = 0; const used = {};
    if (sw) {
      for (let i = 0; i < sw.count; i++) {
        const s = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
        if (!isFinite(s) || Math.abs(s - 1) > 0.01) bad++;
        if (si) { used[si.getX(i)] = 1; used[si.getY(i)] = 1; used[si.getZ(i)] = 1; used[si.getW(i)] = 1; }
      }
    }
    Hy3d.stats.skinBad = bad;
    Hy3d.stats.bonesUsed = Object.keys(used).length;

    /* Chiều cao + chân (Box3 world — mesh node mang -90° X nên đo đúng
       theo Y-up; đơn vị cm của Blender → đổi ra mét để hiển thị) */
    try {
      const box = new THREE.Box3().setFromObject(baseObj);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        Hy3d.stats.heightCm = +size.y.toFixed(1);
        Hy3d.stats.height = +(size.y / 100).toFixed(2);
        Hy3d.stats.feetY = +(box.min.y / 100).toFixed(3);
      }
    } catch (e) { /* đo cao optional */ }

    /* Mixer trên root (track FBX dùng tên xương trần nên bind đúng) */
    if (Hy3d.mixer) Hy3d.mixer.stopAllAction();
    Hy3d.mixer = new THREE.AnimationMixer(baseObj);
    Hy3d.actions = {};
    Hy3d.current = null;

    /* ---------- Build 2 clips ---------- */
    const entries = [];
    const addEntry = function (def, clip) {
      if (!clip) return;
      clip.name = def.id;
      const bad = PixiStudio.Anim && PixiStudio.Anim.validateClip ? PixiStudio.Anim.validateClip(clip) : [];
      if (bad.length) {
        console.warn('[Hy3d] clip lỗi, bỏ qua:', def.id, bad[0]);
        bus.emit('notify', { type: 'warning', title: 'Clip lỗi đã bỏ qua', message: def.id + ': ' + bad[0] });
        return;
      }
      entries.push({ id: def.id, name: def.name, duration: clip.duration, clip: clip, icon: def.icon, loop: def.loop, source: def.source });
    };
    const defById = function (id) { return CLIP_DEFS.find(function (d) { return d.id === id; }); };

    /* Clip THẬT từ punch.fbx */
    if (punchClip) addEntry(defById('Punch'), punchClip);
    else bus.emit('notify', { type: 'warning', title: 'Thiếu punch.fbx', message: 'Clip Punch thật chưa có — chỉ còn T-Pose tĩnh. Upload punch.fbx vào models/hy3d/ để có clip đấm.' });

    /* TPose tĩnh sinh từ bind pose (không lấy frame 0 của clip) */
    addEntry(defById('TPose'), Hy3d._genTPose());
    Hy3d.clips = entries;
    Hy3d.loaded = true;

    /* Đăng ký vào RigAutoGen để IK/Pose/AnimAutoGen nhận nhân vật */
    Hy3d._registerRig();

    bus.emit('hy3d:loaded', {
      boneCount: Hy3d.stats.bones, tris: Hy3d.stats.tris, height: Hy3d.stats.height,
      clips: entries.map(function (c) { return { id: c.id, duration: c.duration, source: c.source }; })
    });
    bus.emit('notify', {
      type: 'success', title: '🥊 HY3D đã sẵn sàng',
      message: Hy3d.stats.bones + ' bones · ' + Hy3d.stats.tris.toLocaleString() + ' tris · cao ' +
        Hy3d.stats.height + 'm · ' + entries.length + ' clips (' +
        entries.filter(function (c) { return c.source === 'fbx'; }).length + ' thật từ FBX + ' +
        entries.filter(function (c) { return c.source === 'generated'; }).length + ' sinh)' +
        (opts.baseIsPunch ? ' — LƯU Ý: đang dùng punch.fbx làm base, Stop sẽ về frame-0 (tay trái đấm) chứ không phải T-pose. Upload bonechar.fbx để có T-pose đúng.' : '')
    });

    /* AUTO-PREVIEW: thêm vào viewport + phát Punch ngay (loop) */
    setTimeout(function () {
      Hy3d.addToViewport();
      if (PixiStudio.Viewport && PixiStudio.Viewport.orbit) {
        PixiStudio.Viewport.setView('perspective');
        PixiStudio.Viewport.orbit.dTarget.set(0, 1.0, 0);
        PixiStudio.Viewport.orbit.dRadius = 3.6;
        PixiStudio.Viewport.orbit.dTheta = 0.6;
        PixiStudio.Viewport.orbit.dPhi = 1.25;
      }
      if (Hy3d.clips.find(function (c) { return c.id === 'Punch'; })) Hy3d.play('Punch');
      else if (Hy3d.clips.length) Hy3d.play(Hy3d.clips[0].id);
      Hy3d.renderPanel();
    }, 120);

    Hy3d.renderPanel();
    return { object: baseObj, skeleton: Hy3d.skeleton, clips: entries };
  };

  /* ============================================================
     TPose tĩnh — sinh từ snapshot rest (bind pose), KHÔNG lấy frame 0
     của clip Punch (frame 0 là tay trái đang đấm, không phải T-pose).
     ============================================================ */
  Hy3d._genTPose = function () {
    const dur = 0.033, t = [0, dur];
    const tracks = [];
    Object.keys(Hy3d.rest).forEach(function (canon) {
      const name = Hy3d.fullName[canon] || canon;
      const r = Hy3d.rest[canon];
      tracks.push(new THREE.QuaternionKeyframeTrack(name + '.quaternion', t,
        [r.q.x, r.q.y, r.q.z, r.q.w, r.q.x, r.q.y, r.q.z, r.q.w]));
    });
    const hp = Hy3d.rest.Hips;
    if (hp) {
      tracks.push(new THREE.VectorKeyframeTrack((Hy3d.fullName.Hips || 'Hips') + '.position', t,
        [hp.p.x, hp.p.y, hp.p.z, hp.p.x, hp.p.y, hp.p.z]));
    }
    return new THREE.AnimationClip('TPose', dur, tracks);
  };

  /* ============================================================
     ĐĂNG KÝ RIG — đúng hình dạng RigAutoGen.current
     (name/preset/rootBone/root/bones/helper/mixer/target/boneCount/
     skeleton/clips) + đồng bộ PixiStudio.Rig.current cho Bone Editor.
     ============================================================ */
  Hy3d._registerRig = function () {
    try {
      if (!PixiStudio.RigAutoGen) return false;
      const bones = {};
      Object.keys(Hy3d.boneMap).forEach(function (k) { bones[k] = Hy3d.boneMap[k]; });

      /* prefix-tolerant getBoneByName — cùng regex rig-auto-gen.js:321.
         HY3D không có prefix, nhưng map vẫn chấp nhận cả 2 dạng tên. */
      if (Hy3d.skeleton) {
        Hy3d.skeleton.getBoneByName = function (name) {
          for (let i = 0; i < this.bones.length; i++) {
            if (this.bones[i].name === name || stripPre(this.bones[i].name) === stripPre(name)) return this.bones[i];
          }
          return undefined;
        };
        Hy3d.rootBone.skeleton = Hy3d.skeleton;
      }
      let helper = null;
      try {
        helper = new THREE.SkeletonHelper(Hy3d.rootBone);
        helper.material.linewidth = 2;
        Hy3d.root.add(helper);
      } catch (e) { /* helper optional */ }

      const rig = {
        name: 'HY3D (Blender)',
        preset: 'HY3D / Mixamo Compatible',
        rootBone: Hy3d.rootBone,
        root: Hy3d.root,
        bones: bones,
        helper: helper,
        mixer: Hy3d.mixer,
        target: Hy3d.root,
        boneCount: Hy3d.boneNames.length,
        skeleton: Hy3d.skeleton,
        clips: Hy3d.clips
      };
      PixiStudio.RigAutoGen.current = rig;
      Hy3d._registeredRig = rig;

      /* Đồng bộ Rig cũ (Bone Editor đọc map name → {name, parentName, children, worldPos}) */
      if (PixiStudio.Rig) {
        Hy3d.root.updateMatrixWorld(true);
        const rc = { name: 'HY3D', preset: 'HY3D / Mixamo Compatible', bones: {}, target: Hy3d.root, visualGroup: Hy3d.root, isAutoGen: true };
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
      console.warn('[Hy3d] đăng ký rig thất bại (IK/Pose sẽ không thấy nhân vật):', e.message);
      bus.emit('notify', { type: 'warning', title: 'Đăng ký rig thất bại', message: e.message + ' — nhân vật vẫn phát clip bình thường.' });
      return false;
    }
  };

  /* ============================================================
     PLAYBACK — crossfade 0.25s (mẫu FbxRig.play / Thandieu.play)
     ============================================================ */
  Hy3d.play = function (clipId) {
    if (!Hy3d.mixer || !Hy3d.clips.length) {
      bus.emit('notify', { type: 'warning', title: 'HY3D', message: 'Load nhân vật trước (nút Load từ models/hy3d/ hoặc chọn file bonechar.fbx / punch.fbx).' });
      return;
    }
    const entry = Hy3d.clips.find(function (c) { return c.id === clipId; });
    if (!entry) return;
    const bad = PixiStudio.Anim && PixiStudio.Anim.validateClip ? PixiStudio.Anim.validateClip(entry.clip) : [];
    if (bad.length) {
      bus.emit('notify', { type: 'error', title: 'Clip HY3D không hợp lệ', message: entry.id + ': ' + bad[0] + ' — đã chặn phát.' });
      return;
    }
    const action = Hy3d.mixer.clipAction(entry.clip);
    action.reset();
    action.setLoop(entry.loop ? THREE.LoopRepeat : THREE.LoopOnce);
    action.clampWhenFinished = !entry.loop;
    action.setEffectiveTimeScale(Hy3d.speed);
    action.paused = false;
    action.play();
    if (Hy3d.current && Hy3d.actions[Hy3d.current] && Hy3d.current !== clipId) {
      Hy3d.actions[Hy3d.current].crossFadeTo(action, 0.25, false);
    }
    Hy3d.actions[clipId] = action;
    Hy3d.current = clipId;
    Hy3d.paused = false;
    if (PixiStudio.RigAutoGen) PixiStudio.RigAutoGen.playing = true;
    bus.emit('hy3d:clip-played', { clip: clipId, duration: entry.duration });
    Hy3d.renderPanel();
  };

  Hy3d.pause = function () {
    const a = Hy3d.current && Hy3d.actions[Hy3d.current];
    if (a) a.paused = true;
    Hy3d.paused = true;
    if (PixiStudio.RigAutoGen && Hy3d._registeredRig && PixiStudio.RigAutoGen.current === Hy3d._registeredRig) {
      PixiStudio.RigAutoGen.playing = false;
    }
    Hy3d.renderPanel();
  };

  Hy3d.resume = function () {
    const a = Hy3d.current && Hy3d.actions[Hy3d.current];
    if (a) a.paused = false;
    Hy3d.paused = false;
    if (PixiStudio.RigAutoGen) PixiStudio.RigAutoGen.playing = true;
    Hy3d.renderPanel();
  };

  Hy3d.stop = function () {
    /* Về đúng bind T-pose = snapshot rest lúc mới load (base bonechar).
       Bài học Thần Điêu + HY3D: frame-0 của clip Punch là tay trái đang
       đấm (không phải T-pose), và boneInverses không khôi phục được bind
       pose — nên stop() dừng mixer và khôi phục trực tiếp snapshot rest.
       Ngoại lệ: khi base là punch.fbx (thiếu bonechar.fbx), rest chính là
       frame-0 — xem cảnh báo lúc load. */
    if (Hy3d.mixer) Hy3d.mixer.stopAllAction();
    Object.keys(Hy3d.rest).forEach(function (canon) {
      const b = Hy3d.boneMap[canon];
      if (b) { b.quaternion.copy(Hy3d.rest[canon].q); b.position.copy(Hy3d.rest[canon].p); }
    });
    Hy3d.current = null;
    Hy3d.paused = false;
    Hy3d.renderPanel();
  };

  Hy3d.setSpeed = function (s) {
    /* parseFloat(0) || 1 → 1 (0 là falsy) nên setSpeed(0) trước đây ra 1x.
       Dùng isFinite thay cho || để 0 clamp đúng về 0.25x. */
    let v = parseFloat(s);
    if (!isFinite(v)) v = 1;
    s = Math.max(0.25, Math.min(2, v));
    Hy3d.speed = s;
    const a = Hy3d.current && Hy3d.actions[Hy3d.current];
    if (a) a.setEffectiveTimeScale(s);
  };

  Hy3d.update = function (dt) {
    if (!Hy3d.mixer || !Hy3d.loaded || Hy3d.paused) return;
    /* RigAutoGen.update đã đẩy mixer này (khi rig HY3D đang là
       current và playing) → tránh cập nhật 2 lần trong 1 frame. */
    if (PixiStudio.RigAutoGen && Hy3d._registeredRig &&
        PixiStudio.RigAutoGen.current === Hy3d._registeredRig && PixiStudio.RigAutoGen.playing) {
      /* vẫn cập nhật dòng trạng thái bên dưới */
    } else {
      Hy3d.mixer.update(dt);
    }
    Hy3d._statusT += dt;
    if (Hy3d._statusT > 0.25) {
      Hy3d._statusT = 0;
      const st = document.getElementById('hy3d-status');
      if (st && Hy3d.current) {
        const entry = Hy3d.clips.find(function (c) { return c.id === Hy3d.current; });
        const t = Hy3d.actions[Hy3d.current] ? Hy3d.actions[Hy3d.current].time : 0;
        st.textContent = 'Đang phát: ' + Hy3d.current + ' · ' + t.toFixed(2) + 's / ' +
          (entry ? entry.duration.toFixed(2) : '?') + 's · tốc độ ' + Hy3d.speed.toFixed(2) + 'x';
      }
    }
  };

  /* ============================================================
     VIEWPORT — theo mẫu FbxRig.addToViewport/removeFromViewport.
     Model gốc cao ~153cm (đơn vị cm của Blender) nên scale về cao 2.0m
     như Thần Điêu (scale tuyệt đối, gọi lại vẫn đúng); chỉ căn giữa
     x/z + chân về y=0.
     ============================================================ */
  Hy3d.addToViewport = function () {
    if (!Hy3d.root || !PixiStudio.Viewport || !PixiStudio.Viewport.modelRoot) return;
    Hy3d._hiddenPreview = [];
    PixiStudio.Viewport.modelRoot.children.forEach(function (child) {
      if (child !== Hy3d.root && child.visible) {
        Hy3d._hiddenPreview.push(child);
        child.visible = false;
      }
    });
    if (Hy3d.root.parent) Hy3d.root.parent.remove(Hy3d.root);
    PixiStudio.Viewport.modelRoot.add(Hy3d.root);
    const box = new THREE.Box3().setFromObject(Hy3d.root);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const scale = 2.0 / Math.max(0.001, size.y);
      Hy3d.root.scale.setScalar(scale);
      Hy3d.root.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(Hy3d.root);
      const c2 = box2.getCenter(new THREE.Vector3());
      Hy3d.root.position.x -= c2.x;
      Hy3d.root.position.z -= c2.z;
      Hy3d.root.position.y -= box2.min.y;
    }
    if (PixiStudio.State && PixiStudio.State.select) PixiStudio.State.select(Hy3d.root);
    if (PixiStudio.Viewport.orbit) {
      PixiStudio.Viewport.orbit.focus(Hy3d.root, true);
      PixiStudio.Viewport.setView('perspective');
    }
  };

  Hy3d.removeFromViewport = function () {
    if (Hy3d.mixer) Hy3d.mixer.stopAllAction();
    Hy3d.current = null;
    if (Hy3d.root && Hy3d.root.parent) Hy3d.root.parent.remove(Hy3d.root);
    (Hy3d._hiddenPreview || []).forEach(function (child) { child.visible = true; });
    Hy3d._hiddenPreview = [];
    Hy3d.renderPanel();
  };

  /* ============================================================
     EXPORT CLIPS JSON — format riêng, mẫu FbxRig.exportClipsJSON
     ============================================================ */
  Hy3d.exportClipsJSON = function () {
    if (!Hy3d.clips.length) {
      bus.emit('notify', { type: 'warning', title: 'HY3D', message: 'Chưa có clip nào để export — load nhân vật trước.' });
      return;
    }
    const data = Hy3d.clips.map(function (c) {
      return {
        id: c.id, name: c.name, duration: c.duration, loop: c.loop, source: c.source,
        tracks: c.clip.tracks.map(function (t) {
          return { name: t.name, times: Array.from(t.times).map(function (x) { return Math.round(x * 1000) / 1000; }), values: Array.from(t.values).map(function (x) { return Math.round(x * 10000) / 10000; }) };
        })
      };
    });
    U.downloadText(JSON.stringify({
      format: 'pixistudio-hy3d-clips-1',
      character: 'hy3d',
      skeleton: { boneNames: Hy3d.boneNames, boneCount: Hy3d.stats.bones },
      stats: Hy3d.stats,
      rig: {
        source: 'Tencent Hunyuan3D (HY3D) / Blender',
        fbxVersion: 7400, units: 'cm',
        handAngleDeg: { left: 3.7, right: 9.2 },
        skinBones: 23, punchFps: 60, punchKeys: 141
      },
      clips: data
    }, null, 1), 'hy3d_clips.json', 'application/json');
    bus.emit('notify', { type: 'success', title: 'HY3D clips exported', message: 'hy3d_clips.json — ' + data.length + ' clips' });
  };

  /* ============================================================
     UI — section trong Animation panel, chèn sau coco-section
     ============================================================ */
  Hy3d.renderPanel = function () {
    const body = document.getElementById('animation-page-body');
    if (!body) return;
    const old = document.getElementById('hy3d-section');
    if (old) old.remove();

    const section = U.el('div', { class: 'section-block', id: 'hy3d-section' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('character') }),
        U.el('span', { text: '🥊 HY3D — nhân vật Blender · 2 clips' })
      ])
    ]);
    const sc = U.el('div', { class: 'section-content' });

    if (!Hy3d.loaded) {
      sc.appendChild(U.el('div', { class: 'dim small', style: 'line-height:1.6;margin-bottom:8px;', text: 'Nhân vật HY3D (Tencent Hunyuan3D, xuất từ Blender): 28 xương kiểu Mixamo không prefix, 50.000 tris, cao 1,53m, skin 23 xương, tay đúng hướng (3,7°/9,2°). Clip Punch thật 2,333s @60fps, loop kín, không root motion — xem docs/HY3D_RIG_ANIMATION.md để học cách rig + animation.' }));
      sc.appendChild(U.el('button', {
        class: 'btn primary lg block', style: 'margin-bottom:8px;',
        html: U.icon('import') + '&nbsp; Load từ models/hy3d/',
        onclick: function () {
          if (PixiStudio.Notifications) PixiStudio.Notifications.showLoading('Đang load HY3D (2 file FBX)…', 30);
          Hy3d.loadFromRepo().then(function () {
            if (PixiStudio.Notifications) PixiStudio.Notifications.hideLoading();
          }).catch(function (e) {
            if (PixiStudio.Notifications) PixiStudio.Notifications.hideLoading();
            bus.emit('notify', { type: 'error', title: 'Load HY3D thất bại', message: e.message + ' — kiểm tra 2 file FBX đã upload lên models/hy3d/ chưa, hoặc dùng nút chọn file bên dưới.' });
          });
        }
      }));
      /* File picker */
      const fileInput = U.el('input', { type: 'file', accept: '.fbx', multiple: 'multiple', style: 'display:none;' });
      fileInput.addEventListener('change', function () {
        if (!fileInput.files.length) return;
        if (PixiStudio.Notifications) PixiStudio.Notifications.showLoading('Đang parse file HY3D…', 30);
        Hy3d.loadFromFiles(fileInput.files).then(function () {
          if (PixiStudio.Notifications) PixiStudio.Notifications.hideLoading();
        }).catch(function (e) {
          if (PixiStudio.Notifications) PixiStudio.Notifications.hideLoading();
          bus.emit('notify', { type: 'error', title: 'Load HY3D thất bại', message: e.message });
        });
        fileInput.value = '';
      });
      sc.appendChild(fileInput);
      sc.appendChild(U.el('button', {
        class: 'btn lg block', style: 'margin-bottom:8px;',
        html: U.icon('import') + '&nbsp; Chọn file bonechar.fbx / punch.fbx từ máy…',
        onclick: function () { fileInput.click(); }
      }));
      /* Drop zone */
      const drop = U.el('div', {
        class: 'dim small', style: 'border:1px dashed var(--border);border-radius:6px;padding:10px;text-align:center;line-height:1.5;',
        text: '…hoặc kéo-thả file FBX vào đây: bonechar.fbx · punch.fbx'
      });
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.style.borderColor = 'var(--accent)'; });
      drop.addEventListener('dragleave', function () { drop.style.borderColor = ''; });
      drop.addEventListener('drop', function (e) {
        e.preventDefault(); drop.style.borderColor = '';
        if (!e.dataTransfer.files.length) return;
        Hy3d.loadFromFiles(e.dataTransfer.files).catch(function (err) {
          bus.emit('notify', { type: 'error', title: 'Load HY3D thất bại', message: err.message });
        });
      });
      sc.appendChild(drop);
      sc.appendChild(U.el('div', { class: 'dim small', style: 'margin-top:8px;line-height:1.5;', text: 'File FBX là binary nên không đẩy lên GitHub qua connector — upload 2 file vào models/hy3d/ bằng GitHub web UI (xem docs/HY3D_RIG_ANIMATION.md §6). KHÔNG upload 2 file này lên Mixamo (FBX 7400 > giới hạn 7300, đã có skeleton).' }));
      section.appendChild(sc);
      insertSection(body, section);
      return;
    }

    /* Loaded state — thông tin nhân vật */
    sc.appendChild(U.el('div', { class: 'info-row' }, [
      U.el('span', { class: 'i-label', text: 'Nhân vật' }),
      U.el('span', { class: 'i-value', text: 'HY3D · ' + Hy3d.stats.bones + ' bones · ' + Hy3d.stats.tris.toLocaleString() + ' tris' })
    ]));
    sc.appendChild(U.el('div', { class: 'info-row' }, [
      U.el('span', { class: 'i-label', text: 'Mesh' }),
      U.el('span', { class: 'i-value', text: Hy3d.stats.verts.toLocaleString() + ' verts · cao ' + Hy3d.stats.height + 'm · chân y≈0' })
    ]));
    sc.appendChild(U.el('div', { class: 'info-row' }, [
      U.el('span', { class: 'i-label', text: 'Skin' }),
      U.el('span', { class: 'i-value', text: Hy3d.stats.bonesUsed + ' xương có weight · ' + Hy3d.stats.skinBad + ' đỉnh lệch' })
    ]));
    sc.appendChild(U.el('div', { class: 'info-row' }, [
      U.el('span', { class: 'i-label', text: 'Học rig' }),
      U.el('span', { class: 'i-value', text: '28 xương / 23 skin · tay 3,7° · 9,2° · 60fps · loop' })
    ]));
    sc.appendChild(U.el('div', { class: 'info-row', style: 'margin-bottom:8px;' }, [
      U.el('span', { class: 'i-label', text: 'Clip' }),
      U.el('span', { class: 'i-value', text: 'Punch 2,33s · 141 keys · 21 xương xoay · không root motion' })
    ]));

    /* Lưới 2 nút clip */
    const grid = U.el('div', { class: 'mt-grid', style: 'grid-template-columns:repeat(2,1fr);gap:5px;' });
    Hy3d.clips.forEach(function (c) {
      grid.appendChild(U.el('button', {
        class: 'mt-btn' + (Hy3d.current === c.id ? ' primary' : ''),
        html: U.icon(c.icon) + '<span>' + c.name + '</span><small style="display:block;font-size:10px;opacity:.75;">' +
          c.duration.toFixed(2) + 's · ' + (c.loop ? 'loop' : 'once') + ' · ' + (c.source === 'fbx' ? 'FBX thật' : 'sinh') + '</small>',
        onclick: function () { Hy3d.play(c.id); }
      }));
    });
    sc.appendChild(grid);

    /* Trạng thái phát */
    sc.appendChild(U.el('div', {
      id: 'hy3d-status', class: 'dim small', style: 'margin-top:8px;line-height:1.5;',
      text: Hy3d.current ? ('Đang phát: ' + Hy3d.current) : 'Chưa phát clip nào — bấm 1 clip ở trên.'
    }));

    /* Điều khiển phát */
    const ctl = U.el('div', { style: 'display:flex;gap:6px;margin-top:8px;' }, [
      U.el('button', {
        class: 'btn sm grow', html: U.icon(Hy3d.paused ? 'play' : 'pause') + (Hy3d.paused ? ' Resume' : ' Pause'),
        onclick: function () { if (Hy3d.paused) Hy3d.resume(); else Hy3d.pause(); }
      }),
      U.el('button', { class: 'btn sm grow', html: U.icon('stop') + ' Stop (về T-Pose)', onclick: function () { Hy3d.stop(); } })
    ]);
    sc.appendChild(ctl);

    /* Thanh trượt tốc độ */
    const speedRow = U.el('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:8px;' });
    const speedLabel = U.el('span', { class: 'dim small', text: 'Tốc độ: ' + Hy3d.speed.toFixed(2) + 'x' });
    const speedInput = U.el('input', { type: 'range', min: '0.25', max: '2', step: '0.25', value: String(Hy3d.speed), style: 'flex:1;' });
    speedInput.addEventListener('input', function () {
      Hy3d.setSpeed(speedInput.value);
      speedLabel.textContent = 'Tốc độ: ' + Hy3d.speed.toFixed(2) + 'x';
    });
    speedRow.appendChild(speedLabel);
    speedRow.appendChild(speedInput);
    sc.appendChild(speedRow);

    /* Viewport + export + remove */
    const row = U.el('div', { style: 'display:flex;gap:6px;margin-top:8px;' }, [
      U.el('button', { class: 'btn sm grow', html: U.icon('eye') + ' Preview', onclick: function () { Hy3d.addToViewport(); } }),
      U.el('button', { class: 'btn sm grow', html: U.icon('export') + ' Clips JSON', onclick: function () { Hy3d.exportClipsJSON(); } }),
      U.el('button', { class: 'btn sm ghost', html: U.icon('x') + ' Remove', onclick: function () { Hy3d.removeFromViewport(); } })
    ]);
    sc.appendChild(row);
    sc.appendChild(U.el('div', { class: 'dim small', style: 'margin-top:8px;line-height:1.5;', text: 'Rig kiểu Mixamo (tên xương không prefix) — IK/Pose/AnimAutoGen nhận nhân vật qua RigAutoGen.current. Clip Punch loop kín (frame cuối = frame đầu); Stop trở về T-Pose từ bonechar.fbx. Bài học đầy đủ trong docs/HY3D_RIG_ANIMATION.md.' + (Hy3d._fallbackFrame0 ? ' LƯU Ý: đang dùng punch.fbx làm base — Stop sẽ về frame-0 (tay trái đấm), không phải T-pose.' : '') }));

    section.appendChild(sc);
    insertSection(body, section);
  };

  function insertSection(body, section) {
    const cocoSection = document.getElementById('coco-section');
    if (cocoSection && cocoSection.parentNode === body) body.insertBefore(section, cocoSection.nextSibling);
    else {
      const tdSection = document.getElementById('thandieu-section');
      if (tdSection && tdSection.parentNode === body) body.insertBefore(section, tdSection.nextSibling);
      else {
        const fbxSection = document.getElementById('fbx-rig-section');
        if (fbxSection && fbxSection.parentNode === body) body.insertBefore(section, fbxSection.nextSibling);
        else body.insertBefore(section, body.firstChild);
      }
    }
  }

  /* Gắn panel vào luồng render của Animation tab: Coco.renderPanel đã
     được bọc sau Thandieu.renderPanel — bọc tiếp để panel HY3D luôn
     render ngay sau coco-section (không sửa toolbar.js).
     Nếu Coco chưa nạp thì bọc thẳng Thandieu / FbxRig.renderPanel. */
  if (PixiStudio.Coco && PixiStudio.Coco.renderPanel && !PixiStudio.Coco._hy3dWrapped) {
    const origRenderPanel = PixiStudio.Coco.renderPanel;
    PixiStudio.Coco.renderPanel = function () {
      origRenderPanel();
      Hy3d.renderPanel();
    };
    PixiStudio.Coco._hy3dWrapped = true;
  } else if (PixiStudio.Thandieu && PixiStudio.Thandieu.renderPanel && !PixiStudio.Thandieu._hy3dWrapped) {
    const origRenderPanel = PixiStudio.Thandieu.renderPanel;
    PixiStudio.Thandieu.renderPanel = function () {
      origRenderPanel();
      Hy3d.renderPanel();
    };
    PixiStudio.Thandieu._hy3dWrapped = true;
  } else if (PixiStudio.FbxRig && PixiStudio.FbxRig.renderPanel && !PixiStudio.FbxRig._hy3dWrapped) {
    const origRenderPanel = PixiStudio.FbxRig.renderPanel;
    PixiStudio.FbxRig.renderPanel = function () {
      origRenderPanel();
      Hy3d.renderPanel();
    };
    PixiStudio.FbxRig._hy3dWrapped = true;
  }

  window.PixiStudio.Hy3d = Hy3d;
})();
