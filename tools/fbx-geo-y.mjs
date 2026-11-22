import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
const buf = fs.readFileSync(process.argv[2]);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const at = (nodeStart) => {
  const nlen = buf[nodeStart + 12];
  const name = buf.subarray(nodeStart + 13, nodeStart + 13 + nlen).toString();
  const p = nodeStart + 13 + nlen;
  const nend = dv.getUint32(nodeStart, true);
  return { name, p, nend };
};
const nv = buf.readUInt32LE(0);
console.log('???');
/* scan for "Vertices" node header by searching name bytes */
function findNode(name) {
  for (let i = 27; i < buf.length - 32; i++) {
    if (buf[i + 12] === name.length && buf.subarray(i + 13, i + 13 + name.length).toString() === name) {
      const nend = dv.getUint32(i, true), nprops = dv.getUint32(i + 4, true), plen = dv.getUint32(i + 8, true);
      if (nprops === 1 && nend > i) return { start: i, nend, p: i + 13 + name.length, plen };
    }
  }
  return null;
}
for (const nm of ['Vertices', 'PolygonVertexIndex', 'Normals', 'NormalsIndex', 'UV', 'UVIndex', 'Edges', 'Materials']) {
  const f = findNode(nm);
  if (!f) { console.log(nm, 'NOT FOUND'); continue; }
  const t = String.fromCharCode(buf[f.p]);
  const n = dv.getUint32(f.p + 1, true), enc = dv.getUint32(f.p + 5, true), clen = dv.getUint32(f.p + 9, true);
  console.log(nm, 'type', t, 'n', n, 'enc', enc, 'clen', clen, 'plen', f.plen);
  const raw = inflateSync(buf.subarray(f.p + 13, f.p + 13 + clen));
  const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (nm === 'PolygonVertexIndex') { let k = 0; for (let i = 0; i < 6; i++) { k = rv.getInt32(i * 4, true); process.stdout.write(k + ' '); } console.log(); }
  if (nm === 'UVIndex') { for (let i = 0; i < 6; i++) process.stdout.write(rv.getInt32(i * 4, true) + ' '); console.log(); }
  if (nm === 'NormalsIndex') { for (let i = 0; i < 6; i++) process.stdout.write(rv.getInt32(i * 4, true) + ' '); console.log(); }
  if (nm === 'Vertices') { for (let i = 0; i < 9; i++) process.stdout.write(rv.getFloat64(i * 8, true).toFixed(4) + ' '); console.log(); }
  if (nm === 'UV') { for (let i = 0; i < 8; i++) process.stdout.write(rv.getFloat64(i * 8, true).toFixed(4) + ' '); console.log(); }
  if (nm === 'Normals') { for (let i = 0; i < 9; i++) process.stdout.write(rv.getFloat64(i * 8, true).toFixed(4) + ' '); console.log(); }
  if (nm === 'Edges') { for (let i = 0; i < 8; i++) process.stdout.write(rv.getInt32(i * 4, true) + ' '); console.log(); }
  if (nm === 'Materials') { for (let i = 0; i < Math.min(n, 6); i++) process.stdout.write(rv.getInt32(i * 4, true) + ' '); console.log(); }
}
