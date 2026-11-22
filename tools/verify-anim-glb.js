/* ============================================================
 * tools/verify-anim-glb.js — kiểm tra file .glb có rig + animation
 * (dùng cho tính năng "Export GLB + Animation" — giống Meshy Animate)
 *
 * Chạy: node tools/verify-anim-glb.js exports/model_animated_6clips.glb
 *
 * Kiểm tra:
 *   • header GLB (magic/version/length) + 2 chunk JSON/BIN
 *   • animations: tên clip, số channel/sampler, thời lượng (accessor max)
 *   • skins: số joint, node skeleton, và mọi channel phải trỏ vào node thật
 *   • mesh: có JOINTS_0 + WEIGHTS_0 (mesh thật sự skinned)
 *   • không lọt mesh visual của bone (octahedron/joint sphere/skeleton helper)
 * ============================================================ */
'use strict';

const fs = require('fs');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Dùng: node tools/verify-anim-glb.js <file.glb>');
  process.exit(2);
}

const buf = fs.readFileSync(file);
let fails = 0;
const pass = (s) => console.log('  \u2713 ' + s);
const fail = (s) => { fails++; console.log('  \u2717 ' + s); };
const info = (s) => console.log('    · ' + s);

console.log('File: ' + file + ' (' + buf.length.toLocaleString('en-US') + ' bytes)');

/* ---------- header ---------- */
if (buf.readUInt32LE(0) !== 0x46546C67) { fail('magic không phải "glTF"'); process.exit(1); }
const version = buf.readUInt32LE(4);
const total = buf.readUInt32LE(8);
console.log('\n[1] Header GLB');
if (version === 2) pass('version 2');
else fail('version = ' + version);
if (total === buf.length) pass('length khớp file (' + total + ')');
else fail('length trong header (' + total + ') ≠ kích thước file (' + buf.length + ')');

/* ---------- chunks ---------- */
let off = 12, json = null, binLen = 0;
while (off + 8 <= buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4E4F534A) json = JSON.parse(data.toString('utf8'));
  else if (type === 0x004E4942) binLen = len;
  off += 8 + len;
}
console.log('\n[2] Chunks');
if (json) pass('JSON chunk OK'); else { fail('thiếu JSON chunk'); process.exit(1); }
if (binLen) pass('BIN chunk: ' + binLen.toLocaleString('en-US') + ' bytes');
else fail('thiếu BIN chunk (file không phải binary GLB)');

const nodes = json.nodes || [];
const nodeName = (i) => (nodes[i] && nodes[i].name) || ('node' + i);

/* ---------- accessor max (đọc thời lượng clip) ---------- */
const accMax = (i) => {
  const a = (json.accessors || [])[i];
  if (!a) return null;
  if (a.max) return a.max[0];
  /* nếu thiếu max: đọc trực tiếp từ bufferView */
  if (a.bufferView === undefined) return null;
  const bv = json.bufferViews[a.bufferView];
  const binStart = 12 + 8 + buf.readUInt32LE(12) + 8;   /* header + json chunk + bin chunk prefix */
  const base = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0);
  if (a.componentType !== 5126) return null;
  let m = -Infinity;
  for (let k = 0; k < a.count; k++) m = Math.max(m, buf.readFloatLE(base + k * 4));
  return m;
};

/* ---------- animations ---------- */
console.log('\n[3] Animations');
const anims = json.animations || [];
if (!anims.length) {
  fail('KHÔNG có animation nào trong file');
} else {
  pass(anims.length + ' clip: ' + anims.map((a) => a.name).join(', '));
  anims.forEach((a) => {
    let dur = 0, badTarget = 0, jointHits = 0;
    const jointSet = new Set();
    (json.skins || []).forEach((s) => s.joints.forEach((j) => jointSet.add(j)));
    a.channels.forEach((ch) => {
      const t = ch.target;
      if (t.node === undefined || !nodes[t.node]) badTarget++;
      else if (jointSet.has(t.node)) jointHits++;
    });
    a.samplers.forEach((s) => {
      const m = accMax(s.input);
      if (m !== null && m > dur) dur = m;
    });
    if (badTarget) fail('clip "' + a.name + '": ' + badTarget + ' channel trỏ vào node không tồn tại');
    else pass('clip "' + a.name + '": ' + a.channels.length + ' channel · ' + a.samplers.length + ' sampler · ' +
      Math.round(dur * 100) / 100 + 's · ' + jointHits + '/' + a.channels.length + ' channel nhắm vào joint');
  });
}

/* ---------- skins ---------- */
console.log('\n[4] Skins / skeleton');
const skins = json.skins || [];
if (!skins.length) fail('KHÔNG có skin → mesh không cử động được');
skins.forEach((s, i) => {
  pass('skin#' + i + ': ' + s.joints.length + ' joint' + (s.skeleton !== undefined ? ' · skeleton=' + nodeName(s.skeleton) : ''));
  const named = s.joints.filter((j) => nodes[j] && nodes[j].name).length;
  info(named + ' joint có tên · ví dụ: ' + s.joints.slice(0, 6).map(nodeName).join(', '));
});

/* ---------- mesh + skin attributes ---------- */
console.log('\n[5] Mesh & skin attributes');
const meshes = json.meshes || [];
let skinnedPrims = 0, prims = 0, leaked = [];
meshes.forEach((m) => {
  m.primitives.forEach((p) => {
    prims++;
    if (p.attributes.JOINTS_0 !== undefined && p.attributes.WEIGHTS_0 !== undefined) skinnedPrims++;
  });
});
if (skinnedPrims) pass(skinnedPrims + '/' + prims + ' primitive có JOINTS_0 + WEIGHTS_0 (mesh skinned thật)');
else fail('không primitive nào có JOINTS_0/WEIGHTS_0');
const weighted = nodes.filter((n) => n.mesh !== undefined && n.skin !== undefined).length;
if (weighted) pass(weighted + ' node mesh có skin binding');
else fail('không node nào vừa có mesh vừa có skin');

leaked = nodes.filter((n) => /octa|sphere|joint|skeleton|helper|bonevisual/i.test(n.name || ''));
if (leaked.length) fail(leaked.length + ' node visual của bone lọt vào file: ' + leaked.slice(0, 5).map((n) => n.name).join(', '));
else pass('không có mesh visual bone/skeleton helper trong file');

/* ---------- materials / textures ---------- */
console.log('\n[6] Materials & textures');
info((json.materials || []).length + ' material · ' + (json.images || []).length + ' image · ' +
  (json.textures || []).length + ' texture · ' + (json.extensionsRequired || []).length + ' extension bắt buộc');
if ((json.extensionsRequired || []).length) {
  info('extensionsRequired: ' + (json.extensionsRequired || []).join(', '));
} else {
  pass('0 extension bắt buộc — Blender/Unity/Meshy đọc trực tiếp');
}

console.log('\n' + (fails === 0 ? 'KẾT QUẢ: \u2713 PASS — GLB có skeleton + skin + animation' : 'KẾT QUẢ: \u2717 ' + fails + ' lỗi'));
process.exit(fails === 0 ? 0 : 1);
