/* ============================================================
 * viewport/grid.js — Grid 3D, trục màu, vòng sáng dưới chân,
 * mặt đất nhận shadow (như ảnh tham chiếu).
 * ============================================================ */
(function () {
  'use strict';

  const Grid = { group: null, glowRings: [], shadowPlane: null, visible: true };

  Grid.create = function () {
    if (!window.THREE) return null;
    const group = new THREE.Group();
    group.name = '__environment__';

    /* --- Grid lưới chính --- */
    const gridHelper = new THREE.GridHelper(24, 24, 0x3d3d55, 0x27273a);
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.85;
    gridHelper.name = 'grid-helper';
    group.add(gridHelper);

    /* Grid phụ mờ hơn quanh gốc */
    const gridFine = new THREE.GridHelper(24, 96, 0x23233a, 0x1e1e30);
    gridFine.material.transparent = true;
    gridFine.material.opacity = 0.35;
    gridFine.position.y = -0.002;
    gridFine.name = 'grid-fine';
    group.add(gridFine);

    /* --- Trục X (đỏ) / Z (xanh) --- */
    const axisMatX = new THREE.LineBasicMaterial({ color: 0xff4d5e, transparent: true, opacity: 0.9 });
    const axisMatZ = new THREE.LineBasicMaterial({ color: 0x27bfff, transparent: true, opacity: 0.9 });
    const gx = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-12, 0.001, 0), new THREE.Vector3(12, 0.001, 0)
    ]);
    const gz = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.001, -12), new THREE.Vector3(0, 0.001, 12)
    ]);
    const axisX = new THREE.Line(gx, axisMatX);
    const axisZ = new THREE.Line(gz, axisMatZ);
    axisX.name = 'axis-x'; axisZ.name = 'axis-z';
    group.add(axisX, axisZ);

    /* --- Vòng sáng tím dưới chân (glow ring, giống ảnh) --- */
    Grid.glowGroup = new THREE.Group();
    Grid.glowGroup.name = 'glow-rings';
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x713bff, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
    });
    const ring1 = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 64), ringMat);
    ring1.rotation.x = -Math.PI / 2; ring1.position.y = 0.012;
    ring1.name = 'glow-ring-outer';
    const ringMat2 = ringMat.clone();
    ringMat2.opacity = 0.85;
    ringMat2.color = new THREE.Color(0x9d6bff);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.5, 64), ringMat2);
    ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.014;
    ring2.name = 'glow-ring-inner';
    Grid.glowGroup.add(ring1, ring2);
    Grid._pulse = { ring1: ring1, ring2: ring2, mat1: ringMat, mat2: ringMat2 };
    group.add(Grid.glowGroup);

    /* --- Mặt đất nhận shadow (ShadowMaterial nhìn xuyên suốt) --- */
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.42 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), shadowMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.001;
    ground.receiveShadow = true;
    ground.name = 'shadow-ground';
    Grid.shadowPlane = ground;
    group.add(ground);

    /* --- Đĩa mờ sáng nhẹ dưới nhân vật --- */
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x2a2350, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.05, 48), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.008;
    disc.name = 'glow-disc';
    Grid.glowDisc = disc;
    group.add(disc);

    Grid.group = group;
    return group;
  };

  Grid.setGlowPosition = function (x, z) {
    if (Grid.glowGroup) Grid.glowGroup.position.set(x, 0, z);
    if (Grid.glowDisc) Grid.glowDisc.position.set(x, 0.008, z);
  };

  Grid.pulse = function (time) {
    if (!Grid._pulse) return;
    const p = Grid._pulse;
    const s = 1 + Math.sin(time * 1.6) * 0.045;
    p.ring1.scale.set(s, s, 1);
    p.ring2.scale.set(1 / s, 1 / s, 1);
    p.mat1.opacity = 0.42 + Math.sin(time * 1.6) * 0.14;
    p.mat2.opacity = 0.72 + Math.sin(time * 1.6 + 1) * 0.16;
  };

  Grid.setVisible = function (on) {
    Grid.visible = !!on;
    if (Grid.group) {
      /* ẩn grid nhưng giữ glow ring + shadow */
      Grid.group.children.forEach(function (c) {
        if (c.name === 'grid-helper' || c.name === 'grid-fine' || c.name === 'axis-x' || c.name === 'axis-z') {
          c.visible = !!on;
        }
      });
    }
  };

  window.PixiStudio.GridEnv = Grid;
})();
