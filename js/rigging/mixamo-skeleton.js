/* ============================================================
 * rigging/mixamo-skeleton.js — dựng KHUNG XƯƠNG CHUẨN MIXAMO (65 xương)
 *
 * Vì sao cần: rig auto của studio dùng tên tự đặt (`Root`, `Chest`) — Mixamo
 * KHÔNG có hai tên đó nên bước "mapping character" không khớp xương.
 * File X Bot.fbx của Mixamo dùng: Hips (gốc) → Spine → Spine1 → Spine2 →
 * Neck/Head/HeadTop_End + 2 tay (Shoulder/Arm/ForeArm/Hand + 4 đốt mỗi ngón)
 * + 2 chân (UpLeg/Leg/Foot/ToeBase/Toe_End) = 65 xương.
 *
 * Module này dựng lại ĐÚNG khung xương đó (dữ liệu trích từ X Bot.fbx bằng
 * tools/xbot-extract-skeleton.mjs) và tự skin, TRÊN MỘT BẢN SAO của model —
 * không sửa scene của bạn. Dùng cho nút "Save Mixamo Rig".
 *
 *   const out = PixiStudio.MixamoSkeleton.build(model, { height: 1.8 });
 *   out.group   // Object3D chứa SkinnedMesh + xương, sẵn sàng cho FBXBinary.write
 * ============================================================ */
(function () {
  'use strict';

  const MixamoSkeleton = {};

  function readData() {
    const d = window.PixiStudio && window.PixiStudio.MixamoSkeletonData;
    if (!d || !d.bones || !d.bones.length) throw new Error('Thiếu mixamo-skeleton-data.js — không có khung xương chuẩn Mixamo.');
    return d;
  }

  /* Chuẩn hoá dữ liệu: sắp theo thứ tự cha-trước-con để tạo Bone đúng thứ tự */
  function orderedBones(data) {
    const by = {};
    data.bones.forEach(b => { by[b.name] = b; });
    const out = [];
    const seen = {};
    const walk = (name) => {
      if (seen[name] || !by[name]) return;
      seen[name] = 1;
      out.push(by[name]);
      data.bones.filter(b => b.parent === name).forEach(b => walk(b.name));
    };
    data.bones.filter(b => !b.parent).forEach(b => walk(b.name));
    data.bones.forEach(b => walk(b.name));   /* phòng dữ liệu rời */
    return out;
  }

  function collectMeshes(root) {
    const meshes = [];
    root.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.userData && (o.userData.isBoneVisual || o.userData.skipSkin)) return;
      if (o.isSkinnedMesh) return;      /* bỏ skin cũ, ta skin lại từ đầu */
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      meshes.push(o);
    });
    return meshes;
  }

  const distToSeg = function (p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = len2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  /* ============================================================
     build(target, opts)
       height  : chiều cao mong muốn (mặc định 1.8 cho chuẩn Mixamo)
       pose    : 'tpose' (mặc định, dùng đúng dữ liệu X Bot)
       fitWidth: co giãn trục X theo bề rộng model (mặc định true)
     Trả về { group, bones, skeleton, stats }
     ============================================================ */
  MixamoSkeleton.build = function (target, opts) {
    opts = opts || {};
    if (!window.THREE) throw new Error('THREE chưa sẵn sàng');
    if (!target) throw new Error('Chưa có model');
    const data = readData();
    const list = orderedBones(data);
    const wantH = opts.height || 1.8;

    target.updateMatrixWorld(true);
    const srcMeshes = collectMeshes(target);
    if (!srcMeshes.length) throw new Error('Không có mesh nào để rig');

    /* --- 1) gom geometry về WORLD vào group riêng (không đụng scene gốc) --- */
    const group = new THREE.Group();
    group.name = 'MixamoCharacter';
    const worldBox = new THREE.Box3();
    const cloned = [];
    srcMeshes.forEach(function (m) {
      const geo = m.geometry.clone();
      geo.applyMatrix4(m.matrixWorld);          /* world space → skin trong world */
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = m.name || 'mesh';
      group.add(mesh);
      cloned.push(mesh);
      geo.computeBoundingBox();
      worldBox.union(geo.boundingBox);
    });
    if (worldBox.isEmpty()) throw new Error('Bounding box rỗng');

    const size = worldBox.getSize(new THREE.Vector3());
    const center = worldBox.getCenter(new THREE.Vector3());

    /* --- 2) CHUẨN HOÁ geometry: cao = height, đáy y=0, giữa x/z = 0.
       Phải làm TRƯỚC khi dựng xương — nếu không khung xương cao 1.8 còn
       mesh chỉ cao 1.0 → xương nằm ngoài mesh, weight dồn vào vài xương ở gần. */
    const kNorm = wantH / Math.max(1e-6, size.y);
    const norm = new THREE.Matrix4().set(
      kNorm, 0, 0, 0,
      0, kNorm, 0, 0,
      0, 0, kNorm, 0,
      -center.x * kNorm, -worldBox.min.y * kNorm, -center.z * kNorm, 1
    );
    const geomsBox = new THREE.Box3();
    cloned.forEach(function (mesh) {
      mesh.geometry.applyMatrix4(norm);
      mesh.geometry.computeBoundingBox();
      geomsBox.union(mesh.geometry.boundingBox);
    });
    const gSize = geomsBox.getSize(new THREE.Vector3());
    const gCenter = geomsBox.getCenter(new THREE.Vector3());

    /* --- 3) ánh xạ toạ độ chuẩn hoá → world (đã chuẩn hoá) --- */
    const ys = list.map(b => (b.pos ? b.pos[1] : 0));
    const minNy = Math.min.apply(null, ys), maxNy = Math.max.apply(null, ys);
    const s = wantH / Math.max(1e-6, (maxNy - minNy));      /* scale dọc */
    const mapY = ny => (ny - minNy) * s;

    let scaleX = s;
    if (opts.fitWidth !== false) {
      const canonHalfX = Math.max.apply(null, list.map(b => Math.abs(b.pos ? b.pos[0] : 0))) || 0.5;
      const modelHalfX = Math.max(0.001, gSize.x / 2);
      const kk = modelHalfX / (canonHalfX * s);
      scaleX = s * Math.max(0.55, Math.min(1.6, kk));
    }
    const mapPos = (b) => new THREE.Vector3(
      gCenter.x + (b.pos ? b.pos[0] : 0) * scaleX,
      mapY(b.pos ? b.pos[1] : 0),
      gCenter.z + (b.pos ? b.pos[2] : 0) * s
    );

    /* --- 3b) BÁM TAY THEO MODEL: khung X Bot là T-POSE (tay ngang), model
       Tripo/Meshy thường A-POSE (tay xuôi) ⇒ xương tay nằm ngoài mesh, weight
       dồn vào xương chân. Đo bàn tay thật của mesh rồi kéo chuỗi tay xuống theo. */
    const samples = [];
    {
      let stride = 1;
      const totalVerts = cloned.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
      if (totalVerts > 9000) stride = Math.ceil(totalVerts / 9000);
      cloned.forEach(function (m) {
        const pa = m.geometry.attributes.position;
        for (let i = 0; i < pa.count; i += stride) samples.push(new THREE.Vector3().fromBufferAttribute(pa, i));
      });
    }
    const halfX = Math.max(0.001, gSize.x / 2);
    const armFit = { left: null, right: null };
    [['left', 1], ['right', -1]].forEach(function (side) {
      const sign = side[1];
      const near = samples.filter(v => v.x * sign > halfX * 0.80 && v.y > wantH * 0.22 && v.y < wantH * 0.92);
      if (near.length < 20) return;
      const tip = new THREE.Vector3();
      near.forEach(v => tip.add(v));
      tip.multiplyScalar(1 / near.length);
      /* chọn đỉnh XA NHẤT (đầu ngón) thay vì trung bình để không bị kéo vào trong */
      let far = near[0];
      near.forEach(v => { if (Math.abs(v.x) > Math.abs(far.x)) far = v; });
      tip.copy(far).lerp(tip, 0.35);
      armFit[side[0]] = tip.clone();
    });

    /* ghi đè vị trí chuỗi tay nếu phát hiện tay khác hướng T-pose */
    const overridePos = {};
    [['left', 1], ['right', -1]].forEach(function (side) {
      const tip = armFit[side[0]];
      if (!tip) return;
      const shReal = new THREE.Vector3(gCenter.x + (side[1] > 0 ? 0.10 : -0.10) * scaleX, mapY(0.222), gCenter.z);
      const d = tip.clone().sub(shReal);
      if (d.length() < wantH * 0.12) return;                        /* tay ngắn quá → giữ T-pose */
      const horizontal = Math.abs(d.x) / Math.max(1e-6, d.length());
      if (horizontal > 0.82) return;                                /* vẫn gần T-pose → không cần sửa */
      const P = side[1] > 0 ? 'Left' : 'Right';
      overridePos[P + 'Arm'] = shReal.clone().addScaledVector(d, 0.34);
      overridePos[P + 'ForeArm'] = shReal.clone().addScaledVector(d, 0.66);
      overridePos[P + 'Hand'] = tip.clone();
      /* ngón: rải quanh bàn tay theo hướng cẳng tay → bàn tay */
      const dir = tip.clone().sub(shReal).normalize();
      ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].forEach(function (fname, fi) {
        for (let k = 1; k <= 4; k++) {
          overridePos[P + 'Hand' + fname + k] = tip.clone()
            .addScaledVector(dir, 0.012 * wantH * k)
            .add(new THREE.Vector3(0, -0.004 * wantH * fi, 0));
        }
      });
    });

    /* --- 4) tạo Bone hierarchy (local = world − parent world) --- */
    const boneBy = {}, worldBy = {}, parentBy = {};
    list.forEach(function (b) {
      const bone = new THREE.Bone();
      bone.name = /^mixamorig:/i.test(b.name) ? b.name : ('mixamorig:' + b.name);
      boneBy[b.name] = bone;
      worldBy[b.name] = mapPos(b);
      parentBy[b.name] = b.parent || null;
    });
    /* áp vị trí tay đã bám theo model (trước khi tính vị trí local) */
    Object.keys(overridePos).forEach(function (nm) {
      if (worldBy[nm]) worldBy[nm].copy(overridePos[nm]);
    });
    list.forEach(function (b) {
      const bone = boneBy[b.name];
      const pn = parentBy[b.name];
      if (pn && boneBy[pn]) {
        boneBy[pn].add(bone);
        bone.position.copy(worldBy[b.name]).sub(worldBy[pn]);
      } else {
        bone.position.copy(worldBy[b.name]);
        group.add(bone);                       /* gốc: Hips */
      }
    });
    group.updateMatrixWorld(true);

    const boneList = list.map(b => boneBy[b.name]);
    const skeleton = new THREE.Skeleton(boneList);

    /* --- 5) đoạn xương để tính weight ---
       LOẠI xương ngón tay/ngón chân/đầu mút khỏi skin: chúng là đoạn rất ngắn nằm
       sát bàn tay nên "gần nhất" sẽ hút weight của cả cẳng tay (đã đo: đỉnh cẳng tay
       dính vào xương ngón, xoay RightArm thì đỉnh KHÔNG dịch). Vẫn GIỮ các xương
       này trong khung xương để Mixamo map đúng chuẩn. */
    const TIP_BONE = /Hand(Thumb|Index|Middle|Ring|Pinky)\d+$|^Toe_End$|^HeadTop_End$/;
    const cands = [];
    list.forEach(function (b, idx) {
      if (TIP_BONE.test(b.name)) return;
      const kids = list.filter(k => k.parent === b.name && !TIP_BONE.test(k.name));
      const a = worldBy[b.name];
      const end = kids.length ? worldBy[kids[0].name] : a.clone().add(new THREE.Vector3(0, -0.03 * wantH, 0));
      cands.push({ name: b.name, idx: idx, a: a, b: end });
    });

    /* --- 6) skin: 2 xương gần nhất theo khoảng cách tới đoạn xương --- */
    const stats = { meshes: cloned.length, bones: boneList.length, vertices: 0, bonesUsed: 0, noWeight: 0 };
    const usedBones = {};
    cloned.forEach(function (mesh) {
      const geo = mesh.geometry;
      const pos = geo.attributes.position;
      const skinIndex = new Uint16Array(pos.count * 4);
      const skinWeight = new Float32Array(pos.count * 4);
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        let i0 = 0, i1 = 0, d0 = Infinity, d1 = Infinity;
        for (let k = 0; k < cands.length; k++) {
          const d = distToSeg(v, cands[k].a, cands[k].b);
          if (d < d0) { d1 = d0; i1 = i0; d0 = d; i0 = cands[k].idx; }
          else if (d < d1) { d1 = d; i1 = cands[k].idx; }
        }
        const w0 = 1 / (d0 + 0.0001), w1 = 1 / (d1 + 0.0001);
        const tot = w0 + w1;
        skinIndex[i * 4] = i0;
        skinIndex[i * 4 + 1] = i1;
        skinWeight[i * 4] = w0 / tot;
        skinWeight[i * 4 + 1] = w1 / tot;
        usedBones[i0] = 1; usedBones[i1] = 1;
        stats.vertices++;
      }
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
      geo.computeBoundingSphere();
    });
    stats.bonesUsed = Object.keys(usedBones).length;

    /* --- 7) đổi Mesh thành SkinnedMesh, bind với ma trận world của chính nó --- */
    const skinned = [];
    cloned.forEach(function (mesh) {
      const sm = new THREE.SkinnedMesh(mesh.geometry, mesh.material);
      sm.name = mesh.name;
      sm.frustumCulled = false;
      group.remove(mesh);
      group.add(sm);
      sm.updateMatrixWorld(true);
      sm.bind(skeleton, sm.matrixWorld);
      skinned.push(sm);
    });
    group.updateMatrixWorld(true);

    return {
      group: group,
      bones: boneBy,
      boneList: boneList,
      skeleton: skeleton,
      skinnedMeshes: skinned,
      stats: stats,
      height: wantH,
      box: { min: geomsBox.min.toArray(), max: geomsBox.max.toArray() }
    };
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.MixamoSkeleton = MixamoSkeleton;
})();