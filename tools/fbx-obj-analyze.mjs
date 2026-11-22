/* tools/fbx-obj-analyze.mjs — phân tích mesh (winding/normal/degenerate/holes) từ FBX binary
 * Đọc trực tiếp: Vertices / PolygonVertexIndex / LayerElementNormal / LayerElementUV. Không in mảng lớn.
 */
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';

const SIZE = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 };

function readProp(buf, dv, p) {
  const t = String.fromCharCode(buf[p]);
  if (t === 'Y') return { v: dv.getInt16(p + 1, true), next: p + 3 };
  if (t === 'C') return { v: buf[p + 1], next: p + 2 };
  if (t === 'I') return { v: dv.getInt32(p + 1, true), next: p + 5 };
  if (t === 'F') return { v: dv.getFloat32(p + 1, true), next: p + 5 };
  if (t === 'D') return { v: dv.getFloat64(p + 1, true), next: p + 9 };
  if (t === 'L') return { v: Number(dv.getBigInt64(p + 1, true)), next: p + 9 };
  if (t === 'S') { const n = dv.getUint32(p + 1, true); return { v: buf.subarray(p + 5, p + 5 + n).toString('utf8'), next: p + 5 + n }; }
  if (t === 'R') { const n = dv.getUint32(p + 1, true); return { v: buf.subarray(p + 5, p + 5 + n), next: p + 5 + n }; }
  if ('fdlibc'.indexOf(t) >= 0) {
    const n = dv.getUint32(p + 1, true), enc = dv.getUint32(p + 5, true), clen = dv.getUint32(p + 9, true);
    const dataOff = p + 13;
    const raw = enc === 0 ? buf.subarray(dataOff, dataOff + SIZE[t] * n) : inflateSync(buf.subarray(dataOff, dataOff + clen));
    const next = dataOff + (enc === 0 ? SIZE[t] * n : clen);
    const out = new Array(n);
    const rdv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let i = 0; i < n; i++) {
      if (t === 'd') out[i] = rdv.getFloat64(i * 8, true);
      else if (t === 'l') out[i] = Number(rdv.getBigInt64(i * 8, true));
      else if (t === 'f') out[i] = rdv.getFloat32(i * 4, true);
      else if (t === 'i') out[i] = rdv.getInt32(i * 4, true);
      else out[i] = raw[i];
    }
    return { v: out, next };
  }
  throw new Error('unknown prop ' + t);
}

function parse(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const rd = (start) => {
    const nend = dv.getUint32(start, true), nprops = dv.getUint32(start + 4, true), plen = dv.getUint32(start + 8, true), nlen = buf[start + 12];
    if (nend === 0 && nprops === 0 && plen === 0 && nlen === 0) return null;
    const name = buf.subarray(start + 13, start + 13 + nlen).toString('utf8');
    let p = start + 13 + nlen;
    const props = [];
    for (let i = 0; i < nprops; i++) { const r = readProp(buf, dv, p); props.push(r.v); p = r.next; }
    const children = [];
    let off = start + 13 + nlen + plen;
    while (off < nend) { const c = rd(off); if (!c) { off += 13; continue; } children.push(c); off = c.end; }
    return { name, start, end: nend, props, children };
  };
  const top = [];
  let off = 27;
  while (off < buf.length - 16) {
    const nend = dv.getUint32(off, true), nlen = buf[off + 12];
    if (nend < off + 13 || nend > buf.length || nlen > 64) break;
    const n = rd(off);
    if (!n) { off += 13; continue; }
    top.push(n); off = n.end;
  }
  return top;
}

const file = process.argv[2];
const buf = fs.readFileSync(file);
const top = parse(buf);
const objs = top.find(n => n.name === 'Objects');
const geom = objs.children.find(c => c.name === 'Geometry');
const G = {};
const layers = {};
for (const c of geom.children) {
  if (c.name.startsWith('LayerElement')) { layers[c.name] = {}; c.children.forEach(x => layers[c.name][x.name] = x.props[0]); }
  else G[c.name] = c.props[0];
}
const V = G.Vertices, PVI = G.PolygonVertexIndex;
const nv = V.length / 3;
const N = layers.LayerElementNormal || {}, U = layers.LayerElementUV || {}, M = layers.LayerElementMaterial || {};
const nInfo = {};
for (const k of ['MappingInformationType', 'ReferenceInformationType']) nInfo[k] = N[k];
console.log('file', file);
console.log('verts', nv, 'polyVerts', PVI.length, 'normalLayer', JSON.stringify(nInfo), 'normal count', N.Normals ? N.Normals.length / 3 : 0, 'UV layer', JSON.stringify({ m: U.MappingInformationType, r: U.ReferenceInformationType, n: U.UV ? U.UV.length / 2 : 0 }), 'Mat', JSON.stringify({ m: M.MappingInformationType, r: M.ReferenceInformationType, v: M.Materials }));

/* triangles with polygon-vertex index (pv) for each corner */
const tris = [];
let cur = [];
for (let i = 0; i < PVI.length; i++) {
  const pvIdx = PVI[i] < 0 ? PVI[i] ^ -1 : PVI[i];
  cur.push([pvIdx, i]);
  if (PVI[i] < 0) { if (cur.length === 3) tris.push(cur); cur = []; }
}
console.log('tris', tris.length);

/* bbox by dominant axis */
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const v = V[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
const dims = mn.map((v, k) => mx[k] - v);
const axis = dims.indexOf(Math.max(...dims));
console.log('bbox', mn.map(v => +v.toFixed(3)), '->', mx.map(v => +v.toFixed(3)), 'dims', dims.map(v => +v.toFixed(3)), 'axis', 'XYZ'[axis]);
const u1 = (axis + 1) % 3, u2 = (axis + 2) % 3;

/* signed area & normal agreement; normal mapping: ByPolygonVertex+IndexToDirect → normal = Normals[NormalsIndex[pv]] if index present, else per-pv */
let pos = 0, neg = 0, areaPos = 0, areaNeg = 0;
let agree = 0, disagree = 0, missing = 0;
const hasNIdx = !!N.NormalsIndex;
for (const tri of tris) {
  const [a, b2, c] = tri.map(x => x[0]);
  const ux = V[b2 * 3] - V[a * 3], uy = V[b2 * 3 + 1] - V[a * 3 + 1], uz = V[b2 * 3 + 2] - V[a * 3 + 2];
  const vx = V[c * 3] - V[a * 3], vy = V[c * 3 + 1] - V[a * 3 + 1], vz = V[c * 3 + 2] - V[a * 3 + 2];
  /* 3D face normal (u × v) */
  const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
  const s2 = (V[b2 * 3 + u1] - V[a * 3 + u1]) * (V[c * 3 + u2] - V[a * 3 + u2]) - (V[c * 3 + u1] - V[a * 3 + u1]) * (V[b2 * 3 + u2] - V[a * 3 + u2]);
  const ar = Math.hypot(fx, fy, fz) / 2;
  if (s2 >= 0) { pos++; areaPos += ar; } else { neg++; areaNeg += ar; }
  if (N.Normals) {
    let dot = 0;
    for (const [vi, pv] of tri) {
      const k = hasNIdx ? N.NormalsIndex[pv] : pv;
      if (k === undefined || k * 3 + 2 >= N.Normals.length) { missing++; continue; }
      dot += fx * N.Normals[k * 3] + fy * N.Normals[k * 3 + 1] + fz * N.Normals[k * 3 + 2];
    }
    if (dot > 0) agree++; else disagree++;
  }
}
console.log('proj area (plane', 'XYZ'[u1] + 'XYZ'[u2] + ') positive-sign tris', pos, 'area', areaPos.toFixed(4), '| negative-sign tris', neg, 'area', areaNeg.toFixed(4), '=> net', (areaPos - areaNeg).toFixed(4));
console.log('face-normal vs layer-normal: agree', agree, 'disagree', disagree, 'missing', missing);

/* UV winding (flip V for FBX) */
if (U.UV && U.UVIndex) {
  let uvPos = 0, uvNeg = 0;
  for (const tri of tris) {
    const p = tri.map(([vi, pv]) => { const k = U.UVIndex[pv] ?? pv; return [U.UV[k * 2], U.UV[k * 2 + 1]]; });
    const s2 = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (s2 > 0) uvPos++; else if (s2 < 0) uvNeg++;
  }
  console.log('UV signed area: positive(counter-clockwise in uv) tris', uvPos, 'negative', uvNeg, '(FBX UV origin bottom-left; three.js flips V)');
}

/* degenerate & duplicate verts */
let degen = 0;
for (const tri of tris) { const [a, b2, c] = tri.map(x => x[0]); if (a === b2 || b2 === c || a === c) degen++; }
console.log('degenerate (repeated index) tris', degen);
const key = new Map(); let dup = 0;
for (let i = 0; i < nv; i++) {
  const k = V[i * 3].toFixed(5) + ',' + V[i * 3 + 1].toFixed(5) + ',' + V[i * 3 + 2].toFixed(5);
  if (key.has(k)) dup++; key.set(k, i);
}
console.log('duplicate positions', dup, 'unique', key.size);

/* edges / manifold check */
const edge = new Map();
for (let i = 0; i < PVI.length; i++) {
  const a = PVI[i] < 0 ? PVI[i] ^ -1 : PVI[i];
  const j = i + 1; let b2;
  if (j < PVI.length) { const nb = PVI[j]; if (nb < 0 && j % 3 === 0) { /* next tri */ } b2 = nb < 0 ? nb ^ -1 : nb; } else continue;
  /* skip if crossing triangle boundary */
  const k = Math.min(a, b2) + '_' + Math.max(a, b2);
  /* only count edges inside triangle: corner index i and i+1 where i%3 != 2 */
  if (i % 3 !== 2) edge.set(k, (edge.get(k) || 0) + 1);
}
let bCount = 0, nbCount = 0;
for (const v of edge.values()) { if (v === 1) bCount++; else if (v > 2) nbCount++; }
console.log('edges', edge.size, 'boundary(1 tri)', bCount, 'non-manifold(>2 tri)', nbCount);

/* component count via union-find on vertices joined by edges */
const par = new Int32Array(nv); for (let i = 0; i < nv; i++) par[i] = i;
const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
for (const k of edge.keys()) { const [a, b2] = k.split('_').map(Number); const ra = find(a), rb = find(b2); if (ra !== rb) par[ra] = rb; }
const comps = new Map();
for (let i = 0; i < nv; i++) { const r = find(i); comps.set(r, (comps.get(r) || 0) + 1); }
const sorted = [...comps.values()].sort((a, b2) => b2 - a);
console.log('connected components', sorted.length, 'sizes(top10)', sorted.slice(0, 10));
