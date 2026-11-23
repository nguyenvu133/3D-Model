/* ============================================================
 * mesh/lod-generator.js — Auto-LOD local (v21.0)
 *
 * Giảm đa giác bằng vertex clustering (gom đỉnh vào ô lưới rồi
 * trung bình vị trí, bỏ tam giác suy biến). Không cần cloud, chạy
 * ngay trong trình duyệt. Sinh LOD0 (gốc) / LOD1 (~50%) / LOD2
 * (~25%) + báo cáo số tam giác từng mức.
 * ============================================================ */
(function () {
  'use strict';

  const LODGenerator = {};

  function bboxDiag(geo) {
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    return Math.max(1e-6, Math.sqrt(
      Math.pow(b.max.x - b.min.x, 2) +
      Math.pow(b.max.y - b.min.y, 2) +
      Math.pow(b.max.z - b.min.z, 2)));
  }

  /* Giảm 1 BufferGeometry theo tỉ lệ mục tiêu (0..1).
     cellSize càng lớn -> càng ít đỉnh. */
  LODGenerator.decimate = function (geometry, ratio) {
    ratio = Math.max(0.05, Math.min(1, ratio === undefined ? 0.5 : ratio));
    const pos = geometry.attributes.position;
    if (!pos) return null;
    const diag = bboxDiag(geometry);
    const cell = diag * 0.02 / ratio;
    const index = geometry.index;
    const vertCount = pos.count;

    const map = {};       // 'ix,iy,iz' -> newIndex
    const sums = [];      // [sx, sy, sz, n]
    const remap = new Int32Array(vertCount);
    for (let i = 0; i < vertCount; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const key = Math.floor(x / cell) + ',' + Math.floor(y / cell) + ',' + Math.floor(z / cell);
      let ni = map[key];
      if (ni === undefined) {
        ni = sums.length;
        map[key] = ni;
        sums.push([x, y, z, 1]);
      } else {
        const s = sums[ni];
        s[0] += x; s[1] += y; s[2] += z; s[3]++;
      }
      remap[i] = ni;
    }

    const newPos = new Float32Array(sums.length * 3);
    for (let i = 0; i < sums.length; i++) {
      const s = sums[i];
      newPos[i * 3] = s[0] / s[3];
      newPos[i * 3 + 1] = s[1] / s[3];
      newPos[i * 3 + 2] = s[2] / s[3];
    }

    const triCount = index ? index.count / 3 : vertCount / 3;
    const newIndex = [];
    for (let t = 0; t < triCount; t++) {
      const a = index ? remap[index.getX(t * 3)] : remap[t * 3];
      const b = index ? remap[index.getX(t * 3 + 1)] : remap[t * 3 + 1];
      const c = index ? remap[index.getX(t * 3 + 2)] : remap[t * 3 + 2];
      if (a === b || b === c || a === c) continue; // tam giác suy biến
      newIndex.push(a, b, c);
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
    out.setIndex(newIndex);
    out.computeVertexNormals();
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return {
      geometry: out,
      verticesBefore: vertCount,
      verticesAfter: sums.length,
      trisBefore: Math.floor(triCount),
      trisAfter: newIndex.length / 3,
      ratio: ratio
    };
  };

  function triCountOf(geo) {
    const pos = geo.attributes.position;
    if (!pos) return 0;
    return Math.floor((geo.index ? geo.index.count : pos.count) / 3);
  }
  LODGenerator.triCountOf = triCountOf;

  /* Sinh các mức LOD cho 1 mesh. ratios vd [1, 0.5, 0.25]. */
  LODGenerator.generateLODs = function (mesh, ratios) {
    if (!mesh || !mesh.geometry) return null;
    ratios = ratios || [1, 0.5, 0.25];
    const levels = [];
    for (let i = 0; i < ratios.length; i++) {
      if (ratios[i] >= 1) {
        levels.push({ level: i, ratio: 1, geometry: mesh.geometry, tris: triCountOf(mesh.geometry), vertices: mesh.geometry.attributes.position.count });
      } else {
        const r = LODGenerator.decimate(mesh.geometry, ratios[i]);
        if (!r) continue;
        levels.push({ level: i, ratio: ratios[i], geometry: r.geometry, tris: r.trisAfter, vertices: r.verticesAfter });
      }
    }
    return levels;
  };

  /* Áp 1 mức LOD lên mesh (giữ gốc trong userData để khôi phục). */
  LODGenerator.applyLOD = function (mesh, levelIndex, levels) {
    if (!mesh || !mesh.geometry || !levels || !levels[levelIndex]) return false;
    if (!mesh.userData.__lodOriginal) mesh.userData.__lodOriginal = mesh.geometry;
    if (!mesh.userData.__lods) mesh.userData.__lods = levels;
    mesh.geometry = levels[levelIndex].geometry;
    mesh.userData.__lodLevel = levelIndex;
    return true;
  };
  LODGenerator.restoreLOD = function (mesh) {
    if (!mesh || !mesh.userData.__lodOriginal) return false;
    mesh.geometry = mesh.userData.__lodOriginal;
    mesh.userData.__lodLevel = 0;
    return true;
  };
  LODGenerator.report = function (mesh, levels) {
    if (!mesh || !levels) return null;
    return {
      name: mesh.name || 'mesh',
      originalTris: triCountOf(mesh.userData.__lodOriginal || mesh.geometry),
      levels: levels.map(function (l) { return { level: l.level, ratio: l.ratio, tris: l.tris, vertices: l.vertices }; })
    };
  };

  window.PixiStudio.LODGenerator = LODGenerator;
})();
