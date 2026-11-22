/* ============================================================
 * models/sample-model.js — Chibi võ hiệp procedural
 * Đầu to / thân nhỏ / robe / khăn đỏ / búi tóc / kiếm sau lưng.
 * Dùng làm fallback khi GLB chưa load + 9 variant thumbnail.
 * ============================================================ */
(function () {
  'use strict';

  const Sample = {};

  /* Palette mặc định — giống ảnh tham chiếu: robe xám than, khăn đỏ */
  const DEFAULT_VARIANT = {
    name: 'Hero_001',
    robe: 0x3a3a4a,
    robeTrim: 0x2a2a38,
    sash: 0xc8383f,
    scarf: 0xc8383f,
    hair: 0x3d2b1f,
    skin: 0xffdcc0,
    boots: 0x241a12,
    weapon: 'sword',        // sword | staff | spear | none
    hat: 'none',            // none | straw | helmet
    hairStyle: 'bun',       // bun | twin | long
    pants: 0x2c2c3a
  };

  function mat(color, opts) {
    const m = new THREE.MeshStandardMaterial(Object.assign({
      color: color,
      roughness: 0.65,
      metalness: 0.05
    }, opts || {}));
    return m;
  }

  function mesh(geo, material, x, y, z, name) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    m.receiveShadow = false;
    if (name) m.name = name;
    return m;
  }

  /* ============================================================
     createChibiWuxia(variant) → THREE.Group hoàn chỉnh
     Tỷ lệ chibi: đầu ~52% chiều cao, thân ngắn, chân ngắn.
     Tổng chiều cao ≈ 2.0 unit.
     ============================================================ */
  Sample.createChibiWuxia = function (variant) {
    const v = Object.assign({}, DEFAULT_VARIANT, variant || {});
    const g = new THREE.Group();
    g.name = v.name || 'Hero_001';

    /* ---------- Materials ---------- */
    const robeMat = mat(v.robe, { roughness: 0.72 });
    const robeTrimMat = mat(v.robeTrim, { roughness: 0.75 });
    const sashMat = mat(v.sash, { roughness: 0.55 });
    const scarfMat = mat(v.scarf, { roughness: 0.6 });
    const hairMat = mat(v.hair, { roughness: 0.5 });
    const skinMat = mat(v.skin, { roughness: 0.5 });
    const bootMat = mat(v.boots, { roughness: 0.7 });
    const pantsMat = mat(v.pants, { roughness: 0.7 });
    const metalMat = mat(0xb9c2cc, { roughness: 0.25, metalness: 0.85 });
    const darkMetal = mat(0x4a4a58, { roughness: 0.4, metalness: 0.7 });
    const whiteMat = mat(0xf5f5f5, { roughness: 0.35 });
    const eyeMat = mat(0x1c1410, { roughness: 0.3 });
    const browMat = mat(0x241a12, { roughness: 0.5 });

    /* ---------- HEAD (to — đặc trưng chibi) ---------- */
    const headGroup = new THREE.Group();
    headGroup.name = 'Head';
    const head = mesh(new THREE.SphereGeometry(0.56, 32, 28), skinMat, 0, 1.46, 0, 'Head');
    head.scale.set(1, 0.94, 0.96);
    headGroup.add(head);

    /* Mặt phẳng nhẹ phía trước (nose bump) */
    const nose = mesh(new THREE.SphereGeometry(0.055, 10, 8), skinMat, 0, 1.4, 0.54, 'Nose');
    headGroup.add(nose);

    /* Mắt: mắt trắng + đồng tử — nhìn hơi dữ (võ hiệp) */
    const eyeGeo = new THREE.SphereGeometry(0.09, 14, 12);
    const pupilGeo = new THREE.SphereGeometry(0.048, 10, 8);
    [-0.21, 0.21].forEach(function (x, i) {
      const eye = mesh(eyeGeo, whiteMat, x, 1.5, 0.46, i === 0 ? 'EyeL' : 'EyeR');
      eye.scale.set(1, 0.82, 0.6);
      headGroup.add(eye);
      const pupil = mesh(pupilGeo, eyeMat, x, 1.5, 0.5, i === 0 ? 'PupilL' : 'PupilR');
      headGroup.add(pupil);
      /* Chân mày hơi hếch — phong cách thủ lĩnh võ lâm */
      const brow = mesh(new THREE.BoxGeometry(0.15, 0.028, 0.03), browMat, x, 1.63, 0.5, i === 0 ? 'BrowL' : 'BrowR');
      brow.rotation.z = x > 0 ? -0.28 : 0.28;
      headGroup.add(brow);
    });

    /* Miệng nhẹ nhàng */
    const mouth = mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), mat(0x8a5a50, { roughness: 0.4 }), 0, 1.3, 0.53, 'Mouth');
    headGroup.add(mouth);

    /* ---------- HAIR ---------- */
    const hairCap = mesh(new THREE.SphereGeometry(0.585, 30, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat, 0, 1.5, -0.02, 'HairCap');
    headGroup.add(hairCap);

    /* Mái tóc trước */
    const fringe = mesh(new THREE.BoxGeometry(0.72, 0.16, 0.14), hairMat, 0, 1.78, 0.44, 'HairFringe');
    fringe.rotation.x = -0.12;
    headGroup.add(fringe);

    /* Tóc hai bên */
    [-0.5, 0.5].forEach(function (x, i) {
      const side = mesh(new THREE.SphereGeometry(0.16, 12, 10), hairMat, x, 1.32, 0.06, i === 0 ? 'HairSideL' : 'HairSideR');
      side.scale.set(0.8, 1.5, 0.7);
      headGroup.add(side);
    });

    /* Kiểu tóc */
    if (v.hairStyle === 'bun') {
      const bun = mesh(new THREE.SphereGeometry(0.24, 18, 14), hairMat, 0, 2.08, -0.16, 'HairBun');
      bun.scale.set(1.05, 0.85, 1.05);
      headGroup.add(bun);
      const ribbon = mesh(new THREE.TorusGeometry(0.16, 0.045, 10, 20), sashMat, 0, 1.98, -0.16, 'HairRibbon');
      ribbon.rotation.x = Math.PI / 2.4;
      headGroup.add(ribbon);
    } else if (v.hairStyle === 'twin') {
      [-0.5, 0.5].forEach(function (x, i) {
        const tail = mesh(new THREE.SphereGeometry(0.2, 14, 12), hairMat, x * 1.15, 1.9, -0.22, i === 0 ? 'HairTailL' : 'HairTailR');
        tail.scale.set(0.9, 1.6, 0.9);
        tail.rotation.z = x > 0 ? -0.25 : 0.25;
        headGroup.add(tail);
      });
    } else { /* long */
      const long = mesh(new THREE.SphereGeometry(0.52, 20, 16), hairMat, 0, 1.25, -0.24, 'HairLong');
      long.scale.set(0.95, 1.35, 0.62);
      headGroup.add(long);
    }

    /* Mũ (tuỳ variant) */
    if (v.hat === 'straw') {
      const brim = mesh(new THREE.CylinderGeometry(0.82, 0.88, 0.045, 28), mat(0xc9a15a, { roughness: 0.8 }), 0, 1.92, 0, 'StrawBrim');
      const dome = mesh(new THREE.ConeGeometry(0.55, 0.42, 24), mat(0xc9a15a, { roughness: 0.8 }), 0, 2.14, 0, 'StrawDome');
      headGroup.add(brim, dome);
    } else if (v.hat === 'helmet') {
      const helm = mesh(new THREE.SphereGeometry(0.6, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.52), darkMetal, 0, 1.52, 0, 'Helmet');
      const crest = mesh(new THREE.BoxGeometry(0.05, 0.3, 0.5), sashMat, 0, 2.06, -0.05, 'HelmetCrest');
      headGroup.add(helm, crest);
    }

    /* ---------- BODY (nhỏ — chibi) ---------- */
    const bodyGroup = new THREE.Group();
    bodyGroup.name = 'Body';
    const torso = mesh(new THREE.CylinderGeometry(0.30, 0.42, 0.62, 20), robeMat, 0, 0.78, 0, 'Torso');
    bodyGroup.add(torso);

    /* Robe váy nở dưới */
    const skirt = mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.42, 22), robeMat, 0, 0.38, 0, 'RobeSkirt');
    bodyGroup.add(skirt);
    /* Trim dưới váy */
    const trim = mesh(new THREE.TorusGeometry(0.54, 0.035, 8, 28), robeTrimMat, 0, 0.18, 0, 'RobeTrim');
    trim.rotation.x = Math.PI / 2;
    bodyGroup.add(trim);

    /* Đai lưng đỏ */
    const sash = mesh(new THREE.TorusGeometry(0.335, 0.07, 10, 26), sashMat, 0, 0.82, 0, 'Sash');
    sash.rotation.x = Math.PI / 2;
    bodyGroup.add(sash);
    /* Nơ đai */
    const knot = mesh(new THREE.SphereGeometry(0.085, 10, 8), sashMat, 0, 0.82, -0.33, 'SashKnot');
    bodyGroup.add(knot);

    /* Vạt áo chữ Y — trim trắng nhỏ */
    const collar = mesh(new THREE.BoxGeometry(0.1, 0.34, 0.05), robeTrimMat, 0.02, 1.0, 0.36, 'Collar');
    collar.rotation.z = 0.5;
    bodyGroup.add(collar);

    /* ---------- KHĂN ĐỎ (scarf quàng cổ) ---------- */
    const scarf = mesh(new THREE.TorusGeometry(0.30, 0.1, 10, 24), scarfMat, 0, 1.12, 0.02, 'Scarf');
    scarf.rotation.x = Math.PI / 2 + 0.12;
    bodyGroup.add(scarf);
    /* đuôi khăn bay */
    const tail1 = mesh(new THREE.BoxGeometry(0.13, 0.3, 0.04), scarfMat, 0.18, 0.86, -0.16, 'ScarfTail1');
    tail1.rotation.z = 0.3; tail1.rotation.x = -0.15;
    bodyGroup.add(tail1);
    const tail2 = mesh(new THREE.BoxGeometry(0.11, 0.24, 0.04), scarfMat, -0.2, 0.9, -0.14, 'ScarfTail2');
    tail2.rotation.z = -0.35; tail2.rotation.x = -0.2;
    bodyGroup.add(tail2);

    /* ---------- ARMS ---------- */
    [-1, 1].forEach(function (side, i) {
      const armGroup = new THREE.Group();
      armGroup.name = side < 0 ? 'ArmL' : 'ArmR';
      const sx = side * 0.34;
      const upper = mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.34, 12), robeMat, sx, 0.92, 0, side < 0 ? 'UpperArmL' : 'UpperArmR');
      upper.rotation.z = side * 0.5;
      armGroup.add(upper);
      /* Tay áo */
      const sleeve = mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.2, 12), robeTrimMat, sx + side * 0.13, 0.82, 0, side < 0 ? 'SleeveL' : 'SleeveR');
      sleeve.rotation.z = side * 0.5;
      armGroup.add(sleeve);
      /* Bàn tay */
      const hand = mesh(new THREE.SphereGeometry(0.075, 10, 8), skinMat, sx + side * 0.24, 0.7, 0.02, side < 0 ? 'HandL' : 'HandR');
      armGroup.add(hand);
      bodyGroup.add(armGroup);
    });

    /* ---------- LEGS + BOOTS ---------- */
    [-1, 1].forEach(function (side, i) {
      const legGroup = new THREE.Group();
      legGroup.name = side < 0 ? 'LegL' : 'LegR';
      const lx = side * 0.18;
      const leg = mesh(new THREE.CylinderGeometry(0.09, 0.085, 0.26, 12), pantsMat, lx, 0.15, 0, side < 0 ? 'LowerLegL' : 'LowerLegR');
      legGroup.add(leg);
      const boot = mesh(new THREE.BoxGeometry(0.16, 0.1, 0.24), bootMat, lx, 0.05, 0.03, side < 0 ? 'FootL' : 'FootR');
      legGroup.add(boot);
      bodyGroup.add(legGroup);
    });

    /* ---------- WEAPON sau lưng ---------- */
    if (v.weapon === 'sword') {
      const swordGroup = new THREE.Group();
      swordGroup.name = 'Sword';
      swordGroup.rotation.z = -0.5;
      swordGroup.rotation.x = 0.12;
      /* Chuôi */
      const grip = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 10), mat(0x6b3f2a, { roughness: 0.6 }), 0, 0, 0, 'SwordGrip');
      swordGroup.add(grip);
      /* Bọc chuôi đỏ */
      const wrap = mesh(new THREE.TorusGeometry(0.045, 0.018, 8, 16), sashMat, 0, 0.06, 0, 'SwordWrap');
      wrap.rotation.x = Math.PI / 2;
      swordGroup.add(wrap);
      /* Guard */
      const guard = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.035, 16), darkMetal, 0, -0.14, 0, 'SwordGuard');
      swordGroup.add(guard);
      /* Thân kiếm vỏ */
      const sheath = mesh(new THREE.CylinderGeometry(0.05, 0.04, 1.05, 12), mat(0x241a2a, { roughness: 0.45 }), 0, -0.7, 0, 'SwordSheath');
      swordGroup.add(sheath);
      /* Mũi vỏ */
      const tip = mesh(new THREE.ConeGeometry(0.05, 0.14, 12), mat(0x241a2a, { roughness: 0.45 }), 0, -1.29, 0, 'SwordTip');
      tip.rotation.x = Math.PI;
      swordGroup.add(tip);
      /* Đầu chuôi */
      const pommel = mesh(new THREE.SphereGeometry(0.05, 10, 8), darkMetal, 0, 0.14, 0, 'SwordPommel');
      swordGroup.add(pommel);

      swordGroup.position.set(-0.24, 1.0, -0.34);
      swordGroup.rotation.z = 0.55;
      bodyGroup.add(swordGroup);
    } else if (v.weapon === 'staff') {
      const staff = mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.7, 10), mat(0x7a4a2a, { roughness: 0.7 }), -0.4, 0.75, -0.18, 'Staff');
      staff.rotation.z = 0.1;
      const orb = mesh(new THREE.SphereGeometry(0.09, 12, 10), mat(0x27bfff, { roughness: 0.2, emissive: 0x113344, emissiveIntensity: 0.6 }), -0.31, 1.62, -0.18, 'StaffOrb');
      bodyGroup.add(staff, orb);
    } else if (v.weapon === 'spear') {
      const shaft = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 10), mat(0x6b3f2a, { roughness: 0.7 }), -0.4, 0.8, -0.2, 'SpearShaft');
      shaft.rotation.z = 0.12;
      const head = mesh(new THREE.ConeGeometry(0.06, 0.3, 10), metalMat, -0.29, 1.83, -0.2, 'SpearHead');
      bodyGroup.add(shaft, head);
    }

    g.add(headGroup, bodyGroup);

    /* Lưu meta để inspector hiển thị */
    g.userData.isSample = true;
    g.userData.variant = v;
    g.userData.boneNames = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'ShoulderL', 'ShoulderR',
      'UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR', 'HandL', 'HandR',
      'UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'FootL', 'FootR'];

    return g;
  };

  /* 9 variant giống ảnh tham chiếu Asset Library */
  Sample.VARIANTS = [
    { name: 'Hero_001', weapon: 'sword', hairStyle: 'bun', robe: 0x3a3a4a, sash: 0xc8383f, scarf: 0xc8383f },
    { name: 'Ling Ling', weapon: 'none', hairStyle: 'twin', robe: 0x3f5f9f, sash: 0xe8d27a, scarf: 0xf0f0f0, pants: 0x2a3550 },
    { name: 'Mei Hua', weapon: 'none', hairStyle: 'twin', robe: 0xd77fa1, sash: 0x9f3f6f, scarf: 0xffe0ec, hair: 0x5a3423 },
    { name: 'Po The Panda', weapon: 'none', hairStyle: 'none' /* -> dùng bun mặc định */, robe: 0xf2f2ee, sash: 0xc8383f, scarf: 0xc8383f, skin: 0xf2f2ee, hair: 0xf2f2ee, pants: 0x1c1c24 },
    { name: 'Monk Hui', weapon: 'staff', hairStyle: 'bun', robe: 0xd9903a, sash: 0xa86a1f, scarf: 0x8a4a1a, skin: 0xe8b88a, pants: 0xb07030 },
    { name: 'Elder Bai', weapon: 'none', hairStyle: 'long', robe: 0xe8e8e4, sash: 0x7f9fdf, scarf: 0xdfe8ff, hair: 0xdedede },
    { name: 'Nomad Kid', weapon: 'sword', hairStyle: 'bun', hat: 'straw', robe: 0x7fae5a, sash: 0xc8983f, scarf: 0x5a8a3a, hair: 0x2a1f16 },
    { name: 'Yu Lan', weapon: 'none', hairStyle: 'twin', robe: 0x5f5f9f, sash: 0x8f4fae, scarf: 0xbfbfff, hair: 0x5a3f8a, pants: 0x4a4a7a },
    { name: 'General Wu', weapon: 'sword', hairStyle: 'bun', hat: 'helmet', robe: 0x8a6f2f, sash: 0xc8383f, scarf: 0x8a2f2f, hair: 0x241a12, pants: 0x5a4a1f }
  ];

  /* Sửa variant panda: tóc trắng không hợp lý → cap trắng mặc định vẫn ok */

  window.PixiStudio.SampleModel = Sample;
})();
