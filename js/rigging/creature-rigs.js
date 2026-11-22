/* rigging/creature-rigs.js — dựng rig cho các họ nhân vật phi humanoid
 * dựa trên cấu trúc xương GỐC của Mesh2Motion (assets/animations/mesh2motion/rigs/*.json),
 * để animation của chính họ đó retarget 1:1 theo TÊN BONE.
 *
 * Vì sao cần: bảng map bone cũ chỉ có humanoid (pelvis/spine_01/upperarm_l...).
 * Với fox/horse/dragon/bird/snake/shark/spider, tên bone khác hoàn toàn
 * (back_leg_upper_l, wing_3_l, tail_12, leg_b_2_r...), nên phải dựng bone
 * ĐÚNG TÊN của rig gốc thì clip mới bind được.
 *
 * Cách dựng: lấy vị trí rest của xương gốc, trừ offset trục thân (centroid X/Z của
 * chuỗi cột sống), scale theo chiều cao mesh đích, rồi bind skin theo 2 segment gần nhất.
 */
(function () {
  'use strict';
  const bus = PixiStudio.bus;
  const RIG_JSON = function (rigId) { return 'assets/animations/mesh2motion/rigs/' + rigId + '.json'; };

  /* Họ nhân vật: rig nào thuộc họ nào + nhãn hiển thị + chuỗi cột sống để tính trục thân */
  const FAMILIES = {
    humanoid: {
      label: 'Humanoid (2 chân)', rigs: ['human'],
      chain: ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head']
    },
    quadruped: {
      label: 'Quadruped (4 chân)', rigs: ['fox', 'horse', 'kaiju'],
      chain: ['root', 'hips', 'spine_1', 'spine_2', 'spine_3', 'spine_4', 'head']
    },
    dragon: {
      label: 'Dragon (4 chân + cánh)', rigs: ['dragon'],
      chain: ['root', 'hips', 'spine_0', 'spine_1', 'spine_2', 'spine_3', 'spine_4', 'head']
    },
    bird: {
      label: 'Bird (chim)', rigs: ['bird'],
      chain: ['root', 'hips', 'spine_0', 'spine_1', 'spine_2', 'spine_3', 'head']
    },
    serpent: {
      label: 'Serpent (rắn)', rigs: ['snake'],
      chain: ['root', 'neck', 'head']
    },
    fish: {
      label: 'Fish (cá/mập)', rigs: ['shark'],
      chain: ['root', 'pelvis', 'neck', 'head']
    },
    arachnid: {
      label: 'Arachnid (nhện)', rigs: ['spider'],
      chain: ['root', 'hips', 'spine_1', 'spine_2', 'head']
    }
  };

  const Creature = { cache: {}, families: FAMILIES, current: null, _skeletonCache: {} };

  /* Nạp skeleton.glb gốc của rig (đã tải về) — hierarchy + rest rotation CHÍNH XÁC,
     gồm cả transform của node Armature. Đây là cơ sở để điều chỉnh rig khớp nguồn. */
  Creature.loadSkeletonTemplate = function (rigId) {
    if (Creature._skeletonCache[rigId]) return Promise.resolve(Creature._skeletonCache[rigId]);
    const url = 'assets/animations/mesh2motion/' + rigId + '/skeleton.glb';
    return new Promise(function (resolve, reject) {
      const loader = new THREE.GLTFLoader();
      if (window.MeshoptDecoder && loader.setMeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
      loader.load(url, function (g) {
        Creature._skeletonCache[rigId] = g.scene;
        resolve(g.scene);
      }, undefined, function (e) { reject(new Error('skeleton.glb: ' + (e && e.message || e))); });
    });
  };

  Creature.familyOf = function (rigId) {
    const k = Object.keys(FAMILIES).find(f => FAMILIES[f].rigs.indexOf(rigId) >= 0);
    return k || null;
  };

  Creature.loadRig = function (rigId) {
    if (Creature.cache[rigId]) return Promise.resolve(Creature.cache[rigId]);
    return fetch(RIG_JSON(rigId)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' — thiếu ' + RIG_JSON(rigId) + ' (chạy tools/extract-rigs.mjs)');
      return r.json();
    }).then(function (j) {
      /* world rest position của từng bone (cộng dồn translation theo parent) */
      const byName = {};
      j.bones.forEach(function (b) { byName[b.name] = b; });
      const world = {};
      const compute = function (name) {
        if (world[name]) return world[name];
        const b = byName[name];
        if (!b) return [0, 0, 0];
        const base = (b.parent && byName[b.parent]) ? compute(b.parent) : [0, 0, 0];
        const v = [base[0] + b.pos[0], base[1] + b.pos[1], base[2] + b.pos[2]];
        world[name] = v;
        return v;
      };
      j.bones.forEach(function (b) { compute(b.name); });

      /* trục thân: centroid X/Z của chuỗi cột sống; gốc Y: min Y của toàn bộ xương */
      const fam = Creature.familyOf(rigId);
      const chain = (fam && FAMILIES[fam].chain) || ['root'];
      const chainPts = chain.map(function (n) { return world[n]; }).filter(Boolean);
      let axX = 0, axZ = 0;
      if (chainPts.length) {
        axX = chainPts.reduce(function (s, p) { return s + p[0]; }, 0) / chainPts.length;
        axZ = chainPts.reduce(function (s, p) { return s + p[2]; }, 0) / chainPts.length;
      }
      let minY = Infinity, maxY = -Infinity;
      Object.keys(world).forEach(function (k) {
        minY = Math.min(minY, world[k][1]);
        maxY = Math.max(maxY, world[k][1]);
      });
      const height = Math.max(1e-4, maxY - minY);

      const info = { rig: rigId, family: fam, bones: j.bones, world: world, axis: [axX, 0, axZ], minY: minY, height: height, count: j.bones.length };
      Creature.cache[rigId] = info;
      return info;
    });
  };

  /* Dựng rig lên mesh đích.
     Dùng skeleton.glb gốc → bone có ĐÚNG tên + ĐÚNG rest rotation của nguồn,
     nên clip của rig đó áp trực tiếp (retarget bù rest pose cho ra chính pose gốc). */
  Creature.build = function (target, rigId) {
    if (!target) return Promise.resolve(null);
    /* đổi họ rig phải tháo skeleton/skin cũ trước */
    if (PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current && PixiStudio.RigAutoGen.current.target === target && PixiStudio.RigAutoGen.clearTarget) {
      PixiStudio.RigAutoGen.clearTarget(target);
    }
    return Creature.loadSkeletonTemplate(rigId).then(function (template) {
      const box = new THREE.Box3().setFromObject(target);
      if (box.isEmpty()) throw new Error('Mesh đích rỗng');
      const targetH = Math.max(1e-4, box.max.y - box.min.y);
      const targetCenter = box.getCenter(new THREE.Vector3());

      /* clone để mỗi lần build có instance riêng */
      const rigScene = template.clone(true);
      rigScene.name = '__creature_rig__';
      rigScene.userData.rigId = rigId;

      const wrapper = new THREE.Group();
      wrapper.name = '__creature_rig_wrapper__';
      wrapper.add(rigScene);
      target.add(wrapper);
      target.updateMatrixWorld(true);

      const bones = [];
      rigScene.traverse(function (o) { if (o.isBone) bones.push(o); });
      if (!bones.length) throw new Error('skeleton.glb không có bone');

      /* scale theo chiều cao mesh đích rồi canh đáy + tâm XZ */
      const boneBox = function () {
        target.updateMatrixWorld(true);
        const b = new THREE.Box3();
        const v = new THREE.Vector3();
        bones.forEach(function (bn) { v.setFromMatrixPosition(bn.matrixWorld); b.expandByPoint(v); });
        return b;
      };
      let bb = boneBox();
      const rigH = Math.max(1e-4, bb.max.y - bb.min.y);
      const scale = targetH / rigH;
      wrapper.scale.setScalar(scale);
      bb = boneBox();
      const c = bb.getCenter(new THREE.Vector3());
      wrapper.position.x += targetCenter.x - c.x;
      wrapper.position.z += targetCenter.z - c.z;
      wrapper.position.y += box.min.y - bb.min.y;   /* đáy xương trùng đáy mesh */
      target.updateMatrixWorld(true);

      /* skeleton + bind skin (2 segment gần nhất) */
      const skeleton = new THREE.Skeleton(bones);
      const segs = [];
      bones.forEach(function (bone) {
        const kids = bone.children.filter(function (k) { return k.isBone; });
        const a = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
        if (kids.length) {
          segs.push({ bone: bone, a: a, b: new THREE.Vector3().setFromMatrixPosition(kids[0].matrixWorld) });
        } else {
          const parent = bone.parent && bone.parent.isBone ? bone.parent : null;
          const b2 = parent
            ? a.clone().add(a.clone().sub(new THREE.Vector3().setFromMatrixPosition(parent.matrixWorld)))
            : a.clone().add(new THREE.Vector3(0, -targetH * 0.03, 0));
          segs.push({ bone: bone, a: a, b: b2 });
        }
      });

      const distToSegment = function (p, a, b) {
        const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
        const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
        const len2 = abx * abx + aby * aby + abz * abz;
        let t = len2 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      };

      const indexOfBone = {};
      bones.forEach(function (b, i) { indexOfBone[b.uuid] = i; });

      let boundCount = 0;
      const meshes = [];
      target.traverse(function (o) {
        if (o.isMesh && !o.isSkinnedMesh && !(o.userData && o.userData.isBoneVisual)) meshes.push(o);
      });

      meshes.forEach(function (mesh) {
        const geometry = mesh.geometry.clone();
        mesh.updateMatrixWorld(true);
        const m = mesh.matrixWorld.clone();
        const pos = geometry.attributes.position;
        const v = new THREE.Vector3();
        const skinIndices = new Uint16Array(pos.count * 4);
        const skinWeights = new Float32Array(pos.count * 4);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          let b0 = null, b1 = null, d0 = Infinity, d1 = Infinity;
          for (let s = 0; s < segs.length; s++) {
            const d = distToSegment(v, segs[s].a, segs[s].b);
            if (d < d0) { d1 = d0; b1 = b0; d0 = d; b0 = segs[s].bone; }
            else if (d < d1) { d1 = d; b1 = segs[s].bone; }
          }
          const w0 = 1 / (d0 + 0.0001), w1 = 1 / ((b1 ? d1 : d0 + 0.001) + 0.0001);
          const tot = w0 + w1;
          skinIndices[i * 4] = b0 ? indexOfBone[b0.uuid] : 0;
          skinIndices[i * 4 + 1] = b1 ? indexOfBone[b1.uuid] : (b0 ? indexOfBone[b0.uuid] : 0);
          skinWeights[i * 4] = w0 / tot;
          skinWeights[i * 4 + 1] = w1 / tot;
        }
        geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
        geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const skinned = new THREE.SkinnedMesh(geometry, material);
        skinned.name = mesh.name;
        skinned.frustumCulled = false;
        skinned.castShadow = mesh.castShadow;
        skinned.userData = Object.assign({}, mesh.userData, { skipSkin: true, __sourceMesh: mesh });
        const parent = mesh.parent;
        if (parent) {
          const idx = parent.children.indexOf(mesh);
          parent.remove(mesh);
          parent.add(skinned);
          if (idx >= 0) { parent.children.splice(parent.children.indexOf(skinned), 1); parent.children.splice(idx, 0, skinned); }
        }
        skinned.updateMatrixWorld(true);
        skinned.bind(skeleton, skinned.matrixWorld);
        boundCount++;
      });

      const boneMap = {};
      bones.forEach(function (b) { boneMap[b.name] = b; });
      const mixer = new THREE.AnimationMixer(rigScene);

      const rig = {
        name: 'CreatureRig (' + rigId + ')',
        preset: rigId,
        creature: true,
        rigId: rigId,
        family: Creature.familyOf(rigId),
        rootBone: bones[0],
        root: wrapper,
        bones: boneMap,
        boneCount: bones.length,
        mixer: mixer,
        target: target,
        skeleton: skeleton,
        skinnedCount: boundCount,
        rigHeight: targetH
      };
      if (PixiStudio.RigAutoGen) {
        PixiStudio.RigAutoGen.current = rig;
        PixiStudio.RigAutoGen.playing = true;
        PixiStudio.RigAutoGen.visible = true;
      }
      if (PixiStudio.Rig) PixiStudio.Rig.current = { name: 'CreatureRig', preset: rigId, bones: {}, target: target, visualGroup: wrapper, isAutoGen: true, creature: true };
      if (PixiStudio.M2MMotion) PixiStudio.M2MMotion.setRig(rigId);
      Creature.current = rig;

      if (PixiStudio.Viewport && PixiStudio.Viewport.focusSelected) PixiStudio.Viewport.focusSelected();

      bus.emit('notify', {
        type: 'success', title: '🧬 Rig họ ' + rigId,
        message: bones.length + ' bone (' + (rig.family || '?') + ') · ' + boundCount + ' mesh đã bind · clip của rig này phát theo tên bone'
      });
      return rig;
    }).catch(function (e) {
      bus.emit('notify', { type: 'error', title: 'Rig creature lỗi', message: e.message });
      return null;
    });
  };

  /* Nạp model gốc của rig trong thư viện (đã tải) — skeleton khớp nên animation chạy 1:1 */
  Creature.loadRigModel = function (rigId, variationName) {
    return (PixiStudio.M2MMotion ? PixiStudio.M2MMotion.loadCatalog() : Promise.resolve(null)).then(function (cat) {
      if (!cat) throw new Error('Catalog chưa tải');
      const rig = cat.rigs[rigId];
      if (!rig) throw new Error('Không có rig ' + rigId);
      let url = rig.model;
      if (variationName) {
        const v = (rig.variations || []).find(function (x) { return x.name === variationName; });
        if (v) url = v.url;
      }
      return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
        .then(function (buf) { return PixiStudio.Models.loadGLBFromBuffer(buf, 'M2M_' + rigId, buf.byteLength); })
        .then(function (entry) {
          if (PixiStudio.M2MMotion) PixiStudio.M2MMotion.setRig(rigId);
          bus.emit('notify', { type: 'success', title: 'Đã nạp model rig ' + rigId, message: 'Skeleton gốc khớp tên bone — animation của rig này phát trực tiếp.' });
          return entry;
        });
    }).catch(function (e) {
      bus.emit('notify', { type: 'error', title: 'Nạp model rig lỗi', message: e.message });
      return null;
    });
  };

  Creature.familyList = function () {
    return Object.keys(FAMILIES).map(function (k) {
      return { id: k, label: FAMILIES[k].label, rigs: FAMILIES[k].rigs };
    });
  };

  window.PixiStudio.CreatureRigs = Creature;
})();
