/* ============================================================
 * rigging/rig-auto-gen.js — RIG AUTO GEN v2 (v5.1)
 * Sinh skeleton THREE.Bone hierarchy THẬT từ bounding box model:
 *   • Tên bone chuẩn Mixamo (mixamorig:Hips…) — retarget sẵn
 *   • Tỷ lệ tự tính từ bbox (height/width) — đúng từng model
 *   • Visual: joint sphere + octahedron bone gắn TRONG bone tree
 *     → animate bone = visual di chuyển thật (không phải mesh tĩnh)
 *   • THREE.SkeletonHelper sẵn sàng cho preview
 * Khác autoRig (visual tĩnh theo bbox) — Auto Gen là rig động.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const RigAutoGen = {
    current: null,        // { name, rootBone, bones, helper, mixer, target, visualGroup }
    visible: true,
    playing: true,
    speed: 1.0
  };

  /* ---------- Bone factory ---------- */
  const _anchors = {};   /* name → world anchor — tính local position từ dict (không phụ thuộc matrixWorld stale) */

  function makeBone(name, worldPos) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.userData.targetWorld = worldPos.clone();
    _anchors[name] = worldPos.clone();
    return bone;
  }

  /* Gắn bone vào parent — position LOCAL = childWorld − parentWorld (từ dict anchors) */
  function attach(parent, bone) {
    parent.add(bone);
    const parentWorld = parent.userData.targetWorld || new THREE.Vector3(0, 0, 0);
    bone.position.copy(bone.userData.targetWorld).sub(parentWorld);
  }

  /* Visual cho 1 bone: joint sphere + octahedron nối về parent */
  function decorate(bone, parent, size, boneMat, jointMat) {
    if (parent) {
      const worldFrom = bone.userData.targetWorld;
      const worldTo = parent.userData.targetWorld;
      const dir = worldFrom.clone().sub(worldTo);
      const len = Math.max(0.001, dir.length());
      const oct = new THREE.Mesh(new THREE.OctahedronGeometry(1), boneMat);
      oct.scale.set(size * 0.55, len * 0.5, size * 0.55);
      oct.position.set(0, len / 2, 0);           /* dọc trục +Y của bone */
      oct.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      oct.userData.isBoneVisual = true;
      bone.add(oct);
    }
    const joint = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), jointMat);
    joint.userData.isBoneVisual = true;
    bone.add(joint);
  }

  /* ============================================================
     AUTO RIG GEN — sinh bone hierarchy từ bbox + BACKEND ANALYZE
     Backend /api/rig-analyze phân tích vertex distribution thật
     (histogram Y, tay giơ, spread chân) — anchors chuẩn như Tripo.
     ============================================================ */
  RigAutoGen.generate = function (targetObject, presetName, useBackend) {
    const target = targetObject || PixiStudio.Viewport.getMainModel();
    if (!target || !window.THREE) {
      bus.emit('notify', { type: 'warning', title: 'Auto Rig Gen', message: 'Chưa có model nào.' });
      return null;
    }

    /* RE-USE: chỉ dùng lại nếu preset cũng giống; đổi Studio ↔ Mixamo phải
       tháo rig/skin cũ trước, nếu không hai bộ bone chồng lên nhau. */
    if (RigAutoGen.current && RigAutoGen.current.target === target && RigAutoGen.current.preset === (presetName || 'Studio Humanoid')) {
      const existing = RigAutoGen.current;
      if (PixiStudio.AnimAutoGen) existing.clips = PixiStudio.AnimAutoGen.generateAll(existing);
      PixiStudio.RigAutoGen.playing = true;
      bus.emit('rig:created', { boneCount: existing.boneCount || Object.keys(existing.bones).length, preset: existing.preset, reused: true });
      /* vẫn trả rig để caller play clips */
      RigAutoGen.current.reused = true;
      return RigAutoGen.current;
    }
    if (RigAutoGen.current) RigAutoGen.clearTarget(RigAutoGen.current.target);

    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) {
      bus.emit('notify', { type: 'warning', title: 'Auto Rig Gen', message: 'Bounding box rỗng.' });
      return null;
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const H = size.y;                          // chiều cao chuẩn
    const W = Math.max(size.x, size.z);
    const groundY = box.min.y;
    const cx = center.x, cz = center.z;
    const mixamo = (presetName === 'Mixamo Compatible');
    const pre = mixamo ? 'mixamorig:' : '';

    /* Materials */
    const boneMat = new THREE.MeshBasicMaterial({ color: 0x713bff, transparent: true, opacity: 0.85, depthTest: false });
    const jointMat = new THREE.MeshBasicMaterial({ color: 0x27bfff, depthTest: false });
    const J = H * 0.022 + 0.008;               // joint size

    /* Helper: world position anchor */
    const wp = function (x, y, z) {
      return new THREE.Vector3(cx + x * W, groundY + y * H, cz + z * W);
    };

    /* ---------- Build hierarchy ---------- */
    const root = new THREE.Group();
    root.name = '__autogen_rig__';
    const rootBone = makeBone(pre + 'Root', wp(0, 0.50, 0));

    const hips = makeBone(pre + 'Hips', wp(0, 0.52, 0));
    attach(rootBone, hips);

    const spine = makeBone(pre + 'Spine', wp(0, 0.60, 0));
    attach(hips, spine);
    const chest = makeBone(pre + 'Chest', wp(0, 0.68, 0));
    attach(spine, chest);
    const neck = makeBone(pre + 'Neck', wp(0, 0.76, 0));
    attach(chest, neck);
    const head = makeBone(pre + 'Head', wp(0, 0.80, 0));
    attach(neck, head);
    const headTop = makeBone(pre + 'HeadTop_End', wp(0, 0.95, 0));
    attach(head, headTop);

    /* Arms */
    const shL = makeBone(pre + 'LeftShoulder', wp(-0.10, 0.72, 0));
    attach(chest, shL);
    const armL = makeBone(pre + 'LeftArm', wp(-0.20, 0.70, 0));
    attach(shL, armL);
    const foreL = makeBone(pre + 'LeftForeArm', wp(-0.34, 0.69, 0.01));
    attach(armL, foreL);
    const handL = makeBone(pre + 'LeftHand', wp(-0.44, 0.68, 0.02));
    attach(foreL, handL);

    const shR = makeBone(pre + 'RightShoulder', wp(0.10, 0.72, 0));
    attach(chest, shR);
    const armR = makeBone(pre + 'RightArm', wp(0.20, 0.70, 0));
    attach(shR, armR);
    const foreR = makeBone(pre + 'RightForeArm', wp(0.34, 0.69, 0.01));
    attach(armR, foreR);
    const handR = makeBone(pre + 'RightHand', wp(0.44, 0.68, 0.02));
    attach(foreR, handR);

    /* Legs */
    const upL = makeBone(pre + 'LeftUpLeg', wp(-0.09, 0.44, 0));
    attach(hips, upL);
    const legL = makeBone(pre + 'LeftLeg', wp(-0.09, 0.24, 0.01));
    attach(upL, legL);
    const footL = makeBone(pre + 'LeftFoot', wp(-0.09, 0.045, 0.02));
    attach(legL, footL);
    const toeL = makeBone(pre + 'LeftToeBase', wp(-0.09, 0.02, 0.10));
    attach(footL, toeL);

    const upR = makeBone(pre + 'RightUpLeg', wp(0.09, 0.44, 0));
    attach(hips, upR);
    const legR = makeBone(pre + 'RightLeg', wp(0.09, 0.24, 0.01));
    attach(upR, legR);
    const footR = makeBone(pre + 'RightFoot', wp(0.09, 0.045, 0.02));
    attach(legR, footR);
    const toeR = makeBone(pre + 'RightToeBase', wp(0.09, 0.02, 0.10));
    attach(footR, toeR);

    /* Visual decorate (joint + bone octahedron) */
    const bones = {
      Root: rootBone, Hips: hips, Spine: spine, Chest: chest, Neck: neck, Head: head, HeadTop_End: headTop,
      LeftShoulder: shL, LeftArm: armL, LeftForeArm: foreL, LeftHand: handL,
      RightShoulder: shR, RightArm: armR, RightForeArm: foreR, RightHand: handR,
      LeftUpLeg: upL, LeftLeg: legL, LeftFoot: footL, LeftToeBase: toeL,
      RightUpLeg: upR, RightLeg: legR, RightFoot: footR, RightToeBase: toeR
    };
    const parents = {
      Hips: null, Spine: hips, Chest: spine, Neck: chest, Head: neck, HeadTop_End: head,
      LeftShoulder: chest, LeftArm: shL, LeftForeArm: armL, LeftHand: foreL,
      RightShoulder: chest, RightArm: shR, RightForeArm: armR, RightHand: foreR,
      LeftUpLeg: hips, LeftLeg: upL, LeftFoot: legL, LeftToeBase: footL,
      RightUpLeg: hips, RightLeg: upR, RightFoot: legR, RightToeBase: footR
    };
    Object.keys(bones).forEach(function (name) {
      decorate(bones[name], parents[name] || null, J, boneMat, jointMat);
    });

    root.add(rootBone);
    /* Đặt root vào world: bone positions đã tính theo world target của model,
       root bone local = targetWorld (vì root có parent = group ở origin) */
    rootBone.position.copy(rootBone.userData.targetWorld);

    target.updateMatrixWorld(true);
    /* Rig là CON của target. Nếu target có scale (model được chuẩn hoá height≈2) thì
       bone/anchor đang tính theo toạ độ WORLD sẽ bị nhân thêm scale đó → rig to hơn
       nhân vật (lỗi user báo: "rig bị to hơn nhân vật"). Bù bằng scale nghịch đảo để
       mọi thứ bên trong rig vẫn giữ đơn vị WORLD đúng. */
    const _ws = new THREE.Vector3();
    target.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), _ws);
    const invScale = 1 / (Math.abs(_ws.x) > 1e-6 ? _ws.x : 1);
    if (Math.abs(invScale - 1) > 1e-6) root.scale.setScalar(invScale);

    target.add(root);
    root.visible = RigAutoGen.visible;

    /* SkeletonHelper — preview chuẩn three */
    let helper = null;
    try {
      helper = new THREE.SkeletonHelper(rootBone);
      helper.material.linewidth = 2;
      helper.material.depthTest = false;
      target.add(helper);
    } catch (e) { /* SkeletonHelper optional */ }

    /* Mixer cho auto animation */
    const mixer = new THREE.AnimationMixer(rootBone);

    RigAutoGen.current = {
      name: 'AutoGen (' + (mixamo ? 'Mixamo' : 'Studio') + ')',
      preset: mixamo ? 'Mixamo Compatible' : 'Studio Humanoid',
      rootBone: rootBone,
      root: root,
      bones: bones,
      helper: helper,
      mixer: mixer,
      target: target,
      boneCount: Object.keys(bones).length
    };

    /* AUTO-SKINNING — bind mesh vào skeleton (mesh sẽ cử động theo bones)
       GỌI SAU khi current được gán — bindSkin cần rig.bones */
    try {
      RigAutoGen.bindSkin(target);
    } catch (skinErr) {
      console.warn('[RigAutoGen] skinning lỗi (mesh giữ rigid):', skinErr.message);
    }

    /* FIX: three.js r128 PropertyBinding KHÔNG parse được ':' trong tên track
       ('mixamorig:Hips.quaternion' → nodeName 'Hips') nên clip AutoGen trên rig
       Mixamo không bind được bone nào — preview báo "đang chạy" nhưng nhân vật
       đứng im (rig Studio không prefix thì chạy bình thường). Gắn skeleton lên
       rootBone với getBoneByName khớp theo tên đã bỏ prefix để mixer tìm đúng
       bone mà vẫn giữ tên 'mixamorig:*' cho export Mixamo. */
    if (RigAutoGen.current.skeleton) {
      const stripPre = function (s) { return String(s == null ? '' : s).replace(/^mixamorig:?/i, ''); };
      RigAutoGen.current.skeleton.getBoneByName = function (name) {
        for (let i = 0; i < this.bones.length; i++) {
          if (this.bones[i].name === name || stripPre(this.bones[i].name) === stripPre(name)) return this.bones[i];
        }
        return undefined;
      };
      RigAutoGen.current.rootBone.skeleton = RigAutoGen.current.skeleton;
    }

    /* Đồng bộ toggle với Rig cũ */
    PixiStudio.Rig.current = {
      name: 'AutoGen',
      preset: RigAutoGen.current.preset,
      bones: {},       /* map name → { name, children: [] } cho UI Bone Editor đọc nhẹ */
      target: target,
      visualGroup: root,
      isAutoGen: true
    };
    /* FIX: ghi parentName cho từng bone — trước đây entry không có parentName
       nên BoneEditor coi MỌI bone là root và vẽ cây trùng nhau (23 bone → 94 dòng). */
    const parentNameOf = {};
    Object.keys(parents).forEach(function (child) {
      const p = parents[child];
      parentNameOf[child] = p ? (Object.keys(bones).find(function (k) { return bones[k] === p; }) || null) : null;
    });
    Object.keys(bones).forEach(function (n) {
      PixiStudio.Rig.current.bones[n] = {
        name: n,
        parentName: parentNameOf[n] || null,
        children: [],
        worldPos: bones[n].userData.targetWorld
      };
    });
    /* nối children cho Bone Editor */
    Object.keys(parents).forEach(function (child) {
      const pName = parentNameOf[child];
      if (pName && PixiStudio.Rig.current.bones[pName]) {
        PixiStudio.Rig.current.bones[pName].children.push(PixiStudio.Rig.current.bones[child]);
      }
    });

    /* Sinh animation auto ngay sau khi rig */
    if (PixiStudio.AnimAutoGen) {
      const clips = PixiStudio.AnimAutoGen.generateAll(RigAutoGen.current);
      RigAutoGen.current.clips = clips;
    }

    bus.emit('rig:autogen', {
      boneCount: RigAutoGen.current.boneCount,
      preset: RigAutoGen.current.preset,
      clips: RigAutoGen.current.clips ? RigAutoGen.current.clips.map(function (c) { return c.clip.name; }) : []
    });
    bus.emit('notify', {
      type: 'success', title: '⚡ Auto Rig Gen hoàn tất',
      message: RigAutoGen.current.boneCount + ' bones (' + RigAutoGen.current.preset + ') + ' +
        (RigAutoGen.current.clips ? RigAutoGen.current.clips.length : 0) + ' auto clips đang chạy preview. Bone tree động — animate thật.'
    });

    /* Render panel nếu mở */
    RigAutoGen.renderPanel();
    if (PixiStudio.Viewport && PixiStudio.Viewport.focusSelected) PixiStudio.Viewport.focusSelected();
    return RigAutoGen.current;
  };

  /* ============================================================
     GENERATE ASYNC — dùng backend /api/rig-analyze khi có server:
     trích positions thật từ model → server phân tích histogram Y +
     tay giơ + spread chân → anchors chính xác từng phần thân.
     Fallback: bbox ratio như cũ khi không có server.
     ============================================================ */
  RigAutoGen.generateAsync = function (targetObject, presetName) {
    const target = targetObject || PixiStudio.Viewport.getMainModel();
    if (!target) return Promise.resolve(null);

    /* Trích positions thật (world space) */
    const posArr = [];
    const v = new THREE.Vector3();
    target.updateMatrixWorld(true);
    target.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const pa = o.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
        posArr.push(v.x, v.y, v.z);
      }
    });
    if (!posArr.length) return Promise.resolve(null);

    const posF32 = new Float32Array(posArr);
    let idxB64 = '';
    /* indices nếu có — gửi kèm để server phân tích có trọng số tam giác */
    target.traverse(function (o) {
      if (!idxB64 && o.isMesh && o.geometry && o.geometry.index) {
        const idx = o.geometry.index;
        const u32 = new Uint32Array(idx.count);
        for (let i = 0; i < idx.count; i++) u32[i] = idx.getX(i);
        let s = ''; const CH = 32768;
        const bytes = new Uint8Array(u32.buffer, 0, u32.length * 4);
        for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
        idxB64 = btoa(s);
      }
    });

    let b64 = '';
    const bytes = new Uint8Array(posF32.buffer, 0, posF32.length * 4);
    const CH = 32768;
    for (let i = 0; i < bytes.length; i += CH) {
      b64 += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
    }
    const posB64 = btoa(b64);

    return fetch('/api/rig-analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions: posB64, indices: idxB64 || undefined })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res.ok || !res.skeleton) return null;
      return res.skeleton;
    }).catch(function () { return null; });
  };

  /* Áp backend skeleton anchors vào rig đang có — di chuyển bones theo phân tích */
  RigAutoGen.applyBackendAnchors = function (skeleton) {
    const rig = RigAutoGen.current;
    if (!rig || !skeleton || !skeleton.bones) return false;
    let applied = 0;
    Object.keys(skeleton.bones).forEach(function (boneKey) {
      const bone = rig.bones[boneKey];
      if (!bone) return;
      const p = skeleton.bones[boneKey];
      const world = new THREE.Vector3(p[0], p[1], p[2]);
      bone.userData.targetWorld = world.clone();
      _anchors[bone.name] = world.clone();
      const parent = bone.parent;
      const parentWorld = (parent && parent.userData && parent.userData.targetWorld)
        ? parent.userData.targetWorld.clone()
        : new THREE.Vector3(0, 0, 0);
      bone.position.copy(world).sub(parentWorld);
      applied++;
    });
    /* cập nhật visual octahedron theo vị trí mới */
    rig.rootBone.updateMatrixWorld(true);
    rig.rootBone.traverse(function (o) {
      if (o.userData && o.userData.isBoneVisual && o.type === 'Bone') return;
    });
    /* bones di chuyển → bind pose đổi → tính lại inverse bind + bindMatrix,
       nếu không skin sẽ bị lệch/như đứng yên */
    const rebound = RigAutoGen.rebindSkin();

    bus.emit('notify', {
      type: 'success', title: 'Backend anchors áp dụng',
      message: applied + ' bones đặt theo phân tích vertex distribution thật (tay ' +
        (skeleton.stats.armsRaised ? 'giơ' : 'thả') + ', armY ' + skeleton.stats.armY + ')' +
        (rebound ? ' · re-bind ' + rebound + ' mesh' : '')
    });
    return true;
  };

  /* ============================================================
     RE-BIND — tính lại bind pose cho mesh đã skin
     (gọi sau khi bones bị di chuyển: backend anchors, chỉnh tay…)
     ============================================================ */
  RigAutoGen.rebindSkin = function () {
    const rig = RigAutoGen.current;
    if (!rig || !rig.skeleton || !rig.target) return 0;
    rig.rootBone.updateMatrixWorld(true);
    rig.skeleton.calculateInverses();
    let n = 0;
    rig.target.traverse(function (o) {
      if (!o.isSkinnedMesh) return;
      o.updateMatrixWorld(true);
      o.bind(rig.skeleton, o.matrixWorld);
      n++;
    });
    return n;
  };

  /* ============================================================
     AUTO-SKINNING (giống Meshy Rigging) — BIND MESH VÀO SKELETON
     Trước: bones animate nhưng mesh rigid đứng im → "không cử động".
     Sau: mỗi mesh → SkinnedMesh với skinIndex/skinWeight computed
     từ khoảng cách vertex → bone segments. Mixer animate → MESH CỬ ĐỘNG.
     ============================================================ */
  RigAutoGen.bindSkin = function (target) {
    const rig = RigAutoGen.current;
    if (!rig || !rig.bones || !target) return 0;

    /* Thu thập bone segments (world): [boneName, startVec, endVec] */
    const segs = [];
    const boneAnchors = {};
    rig.rootBone.updateMatrixWorld(true);
    Object.keys(rig.bones).forEach(function (name) {
      const bone = rig.bones[name];
      boneAnchors[name] = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
    });
    /* FIX: tên bone Mixamo có prefix 'mixamorig:' nhưng key trong rig.bones
       là tên trần ('Hips') — trước đây childrenOf tra theo tên có prefix nên
       mọi bone đều bị coi là leaf → skin weight tính theo điểm (stub) thay vì
       theo đoạn xương, đùi/cẳng tay dính weight 50/50 thay vì xương chính. */
    const stripPrefix = function (s) { return String(s == null ? '' : s).replace(/^mixamorig:?/i, ''); };
    /* children map từ hierarchy thực tế */
    const childrenOf = {};
    Object.keys(rig.bones).forEach(function (name) {
      const bone = rig.bones[name];
      const pName = bone.parent && bone.parent.isBone ? stripPrefix(bone.parent.name) : null;
      childrenOf[name] = [];
      if (pName) {
        if (!childrenOf[pName]) childrenOf[pName] = [];
        childrenOf[pName].push(name);
      }
    });
    Object.keys(rig.bones).forEach(function (name) {
      const start = boneAnchors[name];
      const kids = childrenOf[name] || [];
      if (kids.length) {
        /* segment tới con đầu tiên (không phải finger chain sâu) */
        const end = boneAnchors[kids[0]];
        segs.push({ name: name, bone: rig.bones[name], a: start, b: end });
      } else {
        /* leaf bone — segment ngắn hướng xuống */
        segs.push({ name: name, bone: rig.bones[name], a: start, b: start.clone().add(new THREE.Vector3(0, -H(0.04), 0)) });
      }
    });
    function H(f) { return f; } /* placeholder — thay bởi height scale */

    const box = new THREE.Box3().setFromObject(target);
    const height = Math.max(0.001, box.max.y - box.min.y);
    segs.forEach(function (s) {
      if (s.name.indexOf('Toe') === -1 && s.name.indexOf('Hand') === -1 && s.name.indexOf('Head') === -1) return;
      s.b = s.a.clone().add(new THREE.Vector3(0, -height * 0.04, 0));
    });

    /* helper: khoảng cách điểm → đoạn thẳng */
    function distToSegment(p, a, b) {
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
      const len2 = abx * abx + aby * aby + abz * abz;
      let t = len2 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /* Build skeleton cho THREE.SkinnedMesh */
    const boneList = [];
    const collect = function (bone) {
      boneList.push(bone);
      bone.children.forEach(function (c) { if (c.isBone) collect(c); });
    };
    collect(rig.rootBone);
    rig.rootBone.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(boneList);

    /* FIX QUAN TRỌNG: khoá của rig.bones là tên TRẦN ('Hips') nhưng THREE.Bone
       mang tên có prefix ('mixamorig:Hips') ⇒ trước đây findIndex theo tên luôn
       trả -1 → MỌI skinIndex thành 0 → cả mesh chỉ dính vào xương 0 (Root),
       và FBX xuất ra chỉ có 1 Cluster thay vì 1 cluster/xương như X Bot.fbx.
       Nay tra index theo ĐỐI TƯỢNG bone (khớp chính xác), fallback theo tên đã
       bỏ prefix. */
    const boneIndexOf = function (bone) {
      if (!bone) return -1;
      const byObj = boneList.indexOf(bone);
      if (byObj >= 0) return byObj;
      const want = stripPrefix(bone.name);
      for (let k = 0; k < boneList.length; k++) if (stripPrefix(boneList[k].name) === want) return k;
      return -1;
    };

    /* Thay mỗi rigid mesh bằng SkinnedMesh */
    let boundCount = 0;
    const replacements = [];
    target.traverse(function (o) {
      if (o.isMesh && !o.isSkinnedMesh && !o.userData.isBoneVisual && !o.userData.skipSkin) {
        replacements.push(o);
      }
    });

    replacements.forEach(function (mesh) {
      const geometry = mesh.geometry.clone();
      /* matrixWorld chỉ dùng để ĐO khoảng cách vertex→bone trong world space */
      mesh.updateMatrixWorld(true);
      const m = mesh.matrixWorld.clone();
      const pos = geometry.attributes.position;   /* giữ nguyên toạ độ LOCAL của mesh */
      const v = new THREE.Vector3();
      const skinIndices = new Uint16Array(pos.count * 4);
      const skinWeights = new Float32Array(pos.count * 4);

      for (let i = 0; i < pos.count; i++) {
        /* vertex → world (chỉ để tính weight, KHÔNG ghi lại vào geometry) */
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        /* tìm 2 bone segments gần nhất */
        const dists = segs.map(function (s) {
          return { name: s.name, bone: s.bone, d: distToSegment(v, s.a, s.b) };
        }).sort(function (a, b) { return a.d - b.d; });

        const b0 = dists[0], b1 = dists[1] || { name: b0.name, bone: b0.bone, d: b0.d + 0.001 };
        /* weight theo inverse distance falloff */
        const w0 = 1 / (b0.d + 0.0001), w1 = 1 / (b1.d + 0.0001);
        const total = w0 + w1;
        const i0 = boneIndexOf(b0.bone);
        const i1 = boneIndexOf(b1.bone);

        skinIndices[i * 4] = i0 >= 0 ? i0 : 0;
        skinIndices[i * 4 + 1] = i1 >= 0 ? i1 : 0;
        skinWeights[i * 4] = w0 / total;
        skinWeights[i * 4 + 1] = w1 / total;
        skinWeights[i * 4 + 2] = 0;
        skinWeights[i * 4 + 3] = 0;
      }

      /* QUAN TRỌNG: KHÔNG bake world vào geometry và KHÔNG đổi normal.
         Trước đây bake world + bind(bindMatrix = identity) nhưng SkinnedMesh vẫn bị
         nhân matrixWorld (model scale 2) → nhân đôi transform: model to gấp 2 và
         biến dạng sai (animation như đứng yên). Chuẩn three.js: giữ toạ độ local +
         bind(skeleton, mesh.matrixWorld). */
      geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
      geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();

      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const skinned = new THREE.SkinnedMesh(geometry, material);
      skinned.name = mesh.name;
      skinned.castShadow = mesh.castShadow;
      skinned.frustumCulled = false;
      skinned.userData = Object.assign({}, mesh.userData, { skipSkin: true, __sourceMesh: mesh });

      /* thay thế trong parent */
      const parent = mesh.parent;
      const index = parent ? parent.children.indexOf(mesh) : -1;
      if (parent) {
        parent.remove(mesh);
        parent.add(skinned);
        if (index >= 0) { parent.children.splice(parent.children.indexOf(skinned), 1); parent.children.splice(index, 0, skinned); }
      }

      /* bind đúng chuẩn: bindMatrix = matrixWorld của chính mesh (vertices là local) */
      skinned.updateMatrixWorld(true);
      skinned.bind(skeleton, skinned.matrixWorld);
      boundCount++;
    });

    /* mixer root đổi thành rootBone vẫn hợp lệ — bones là con của root trong target */
    rig.skeleton = skeleton;
    rig.skinnedCount = boundCount;
    bus.emit('notify', {
      type: 'success', title: '🧌 Auto-Skinning hoàn tất',
      message: boundCount + ' mesh đã BIND vào skeleton (' + boneList.length + ' bones) — mesh sẽ CỬ ĐỘNG theo animation. Trước đây mesh đứng im vì rigid.'
    });
    bus.emit('skin:bound', { count: boundCount, bones: boneList.length });
    return boundCount;
  };

  /* Tháo rig + khôi phục mesh rigid ban đầu. Dùng khi đổi Studio/Mixamo/Creature,
     tránh để nhiều skeleton và nhiều SkinnedMesh chồng lên nhau. */
  RigAutoGen.clearTarget = function (target) {
    const cur = RigAutoGen.current;
    if (cur && cur.target === target) {
      if (cur.mixer) cur.mixer.stopAllAction();
      if (cur.helper && cur.helper.parent) cur.helper.parent.remove(cur.helper);
      if (cur.root && cur.root.parent) cur.root.parent.remove(cur.root);
    }
    const restore = [];
    if (target) target.traverse(function (o) {
      if (o.isSkinnedMesh && o.userData && o.userData.__sourceMesh) restore.push({ skinned: o, source: o.userData.__sourceMesh, parent: o.parent, index: o.parent ? o.parent.children.indexOf(o) : -1 });
    });
    restore.forEach(function (r) {
      if (!r.parent) return;
      r.parent.remove(r.skinned);
      r.parent.add(r.source);
      if (r.index >= 0) { r.parent.children.splice(r.parent.children.indexOf(r.source), 1); r.parent.children.splice(r.index, 0, r.source); }
      if (r.skinned.geometry && r.skinned.geometry !== r.source.geometry) r.skinned.geometry.dispose();
    });
    if (cur && cur.target === target) RigAutoGen.current = null;
    if (PixiStudio.Rig && PixiStudio.Rig.current && (PixiStudio.Rig.current.isAutoGen || PixiStudio.Rig.current.creature)) PixiStudio.Rig.current = null;
    if (target) target.updateMatrixWorld(true);
  };

  RigAutoGen.destroy = function (target) { RigAutoGen.clearTarget(target); };

  RigAutoGen.toggleVisibility = function (on) {
    RigAutoGen.visible = on === undefined ? !RigAutoGen.visible : !!on;
    if (RigAutoGen.current && RigAutoGen.current.root) {
      RigAutoGen.current.root.visible = RigAutoGen.visible;
      if (RigAutoGen.current.helper) RigAutoGen.current.helper.visible = RigAutoGen.visible;
    }
    return RigAutoGen.visible;
  };

  /* Mỗi frame — gọi từ app loop */
  RigAutoGen.update = function (dt) {
    const cur = RigAutoGen.current;
    if (cur && cur.mixer && RigAutoGen.playing) {
      cur.mixer.update(dt * RigAutoGen.speed);
    }
  };

  /* ---------- UI trong Rig panel ---------- */
  RigAutoGen.renderPanel = function () {
    const body = document.getElementById('rig-page-body');
    if (!body) return;
    /* Luôn dựng lại để nhãn Active rig/trạng thái cập nhật sau generate */
    const oldSection = document.getElementById('rig-autogen-section');
    if (oldSection) oldSection.remove();

    const section = U.el('div', { class: 'section-block', id: 'rig-autogen-section' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('wand') }),
        U.el('span', { text: '⚡ Rig Auto Gen — bone tree động' })
      ])
    ]);
    const sc = U.el('div', { class: 'section-content' });

    /* ==== Hai rig độc lập: Studio và Mixamo/Meshy ==== */
    const rigBtns = U.el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;' });
    rigBtns.appendChild(U.el('button', {
      class: 'btn primary grow',
      html: U.icon('wand') + '&nbsp; Studio Humanoid · 23 bone',
      onclick: function () { RigAutoGen.generate(null, 'Studio Humanoid'); }
    }));
    rigBtns.appendChild(U.el('button', {
      class: 'btn success grow',
      html: U.icon('rig') + '&nbsp; Mixamo/Meshy · 23 bone',
      onclick: function () { RigAutoGen.generate(null, 'Mixamo Compatible'); }
    }));
    sc.appendChild(rigBtns);

    const activeRow = U.el('div', { class: 'info-row', style: 'margin:4px 0 8px;' }, [
      U.el('span', { class: 'i-label', text: 'Active rig' }),
      U.el('span', { class: 'i-value', id: 'rig-active-label', text: RigAutoGen.current ? (RigAutoGen.current.preset || RigAutoGen.current.name) : '—' })
    ]);
    sc.appendChild(activeRow);

    /* Tripo refine — chạy trên rig đang active, KHÔNG tạo rig thứ hai */
    sc.appendChild(U.el('button', {
      class: 'btn sm block',
      style: 'margin-bottom:10px;',
      html: U.icon('target') + '&nbsp; 🧠 Refine active rig — Backend Analyze (Tripo)',
      onclick: function () {
        const preset = RigAutoGen.current && RigAutoGen.current.preset ? RigAutoGen.current.preset : 'Studio Humanoid';
        PixiStudio.Notifications.showLoading('Backend analyze — refine ' + preset + '…', 30);
        RigAutoGen.generateAsync(null, preset).then(function (skeleton) {
          PixiStudio.Notifications.hideLoading();
          if (!skeleton) { bus.emit('notify', { type: 'warning', title: 'Backend', message: 'Backend không trả skeleton — giữ rig hiện tại.' }); return; }
          RigAutoGen.applyBackendAnchors(skeleton);
          PixiStudio.Viewport.focusSelected();
          RigAutoGen.renderPanel();
        });
      }
    }));

    function P_Animation_playIdle() {
      if (PixiStudio.AnimAutoGen) PixiStudio.AnimAutoGen.play('Idle');
    }

    /* Preset chọn */
    const pw = U.el('div', { class: 'select-wrap', style: 'margin-bottom:8px;' });
    const sel = U.el('select', { class: 'select', id: 'rig-autogen-preset' });
    [['Studio Humanoid', 'Studio Humanoid'], ['Mixamo Compatible', 'Mixamo Compatible']].forEach(function (o) {
      sel.appendChild(U.el('option', { value: o[0], text: o[1] }));
    });
    pw.appendChild(sel);
    sc.appendChild(pw);

    /* Trạng thái */
    const info = U.el('div', { id: 'rig-autogen-info', class: 'dim small', style: 'line-height:1.5;margin-bottom:8px;' });
    if (RigAutoGen.current) {
      info.innerHTML = '<b style="color:var(--success)">Đang rig:</b> ' + RigAutoGen.current.boneCount +
        ' bones · ' + (RigAutoGen.current.clips ? RigAutoGen.current.clips.length : 0) + ' auto clips · preview ' +
        (RigAutoGen.playing ? '<span style="color:var(--success)">đang chạy</span>' : 'tạm dừng');
    } else {
      info.textContent = 'Chưa rig — bấm nút trên để sinh bone tree từ bounding box model.';
    }
    sc.appendChild(info);

    /* Nút play/pause + speed */
    const row = U.el('div', { style: 'display:flex;gap:6px;' }, [
      U.el('button', {
        class: 'btn sm grow', html: U.icon(RigAutoGen.playing ? 'pause' : 'play') + (RigAutoGen.playing ? ' Pause' : ' Play'),
        id: 'rig-autogen-play',
        onclick: function () {
          RigAutoGen.playing = !RigAutoGen.playing;
          this.innerHTML = U.icon(RigAutoGen.playing ? 'pause' : 'play') + (RigAutoGen.playing ? ' Pause' : ' Play');
          RigAutoGen.renderPanel();
        }
      }),
      U.el('button', {
        class: 'btn sm grow', html: U.icon('eye') + ' Ẩn/Hiện',
        onclick: function () { RigAutoGen.toggleVisibility(); }
      })
    ]);
    sc.appendChild(row);

    const sliderRow = U.el('div', { class: 'slider-row', style: 'margin-top:8px;' }, [
      U.el('span', { class: 's-label', text: 'Speed' })
    ]);
    const slider = U.el('input', { type: 'range', class: 'slider', min: '0.2', max: '2.5', step: '0.1', value: String(RigAutoGen.speed) });
    const val = U.el('span', { class: 's-val', text: RigAutoGen.speed.toFixed(1) + 'x' });
    slider.addEventListener('input', function () {
      RigAutoGen.speed = parseFloat(slider.value);
      val.textContent = RigAutoGen.speed.toFixed(1) + 'x';
    });
    sliderRow.appendChild(slider); sliderRow.appendChild(val);
    sc.appendChild(sliderRow);

    section.appendChild(sc);
    /* chèn lên đầu panel (sau header page) */
    body.insertBefore(section, body.firstChild);
  };

  window.PixiStudio.RigAutoGen = RigAutoGen;
})();
