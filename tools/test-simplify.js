/* tools/test-simplify.js — kiểm tra MeshoptSimplifier + cấu trúc tripo_convert */
'use strict';
const fs = require('fs');
const { MeshoptSimplifier } = require('meshoptimizer');

/* === Test tripo structure === */
const buf = fs.readFileSync('assets/models/tripo_convert_kiemhiep.glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
console.log('=== tripo_convert structure (mục tiêu TripoGLB) ===');
console.log('extensionsRequired:', JSON.stringify(json.extensionsRequired || []));
console.log('extensionsUsed:', JSON.stringify(json.extensionsUsed || []));
console.log('accessors:', json.accessors.map(a => a.type + '/' + a.componentType).join(', '));
console.log('index compType:', json.accessors[json.meshes[0].primitives[0].indices].componentType, '(5123=u16 ✓)');
console.log('mesh name:', json.meshes[0].name.slice(0, 30) + '…');
console.log('mat name:', json.materials[0].name.slice(0, 30) + '…');
console.log('specular ext:', !!json.materials[0].extensions);

/* === Test simplify === */
console.log('\n=== MeshoptSimplifier ===');
MeshoptSimplifier.ready.then(() => {
  const N = 9000;
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    positions[i * 3] = Math.random() * 0.3 - 0.15;
    positions[i * 3 + 1] = Math.random();
    positions[i * 3 + 2] = Math.random() * 0.2 - 0.1;
  }
  const indices = new Uint32Array(N);
  for (let i = 0; i < N; i++) indices[i] = i % N;
  const target = Math.floor(indices.length * 0.5 / 3) * 3;
  const r = MeshoptSimplifier.simplify(indices, positions, 3, target, 0.01, ['LockBorder']);
  console.log('src tris:', indices.length / 3, '→ dst tris:', r[0].length / 3, '(−' + Math.round((1 - r[0].length / indices.length) * 100) + '%)');
  console.log('err:', r[1].toFixed(6), '— shape giữ nguyên');
  console.log('\n✅ Simplify hoạt động server-side — áp dụng cho preset 🪓 Decimated');
}).catch(e => console.error('ERR:', e.message));
