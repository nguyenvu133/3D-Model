/* tools/fbx-geo-analyze.mjs — đọc geometry (nén zlib) + material của FBX binary, báo cáo vấn đề cho Mixamo */
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';

const SIZE = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 };
const ARR = { d: Float64Array, f: Float32Array, i: Int32Array, l: Float64Array, b: Uint8Array };

function decode(sEnt, clen, n, t) {
  if (sEnt === 0) {
    const body = sEnt; /* đọc trực tiếp bên dưới */
  }
}
function arrFromBytes(bytes, n, t) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const A = ARR[t];
  const out = new A(n);
  const step = SIZE[t];
  for (let i = 0; i < n; i++) {
    if (t === 'd' || t === 'l') out[i] = t === 'l' ? Number(dv.getBigInt64(i * 8, true)) : dv.getFloat64(i * 8, true);
    else if (t === 'f') out[i] = dv.getFloat32(i * 4, true);
    else if (t === 'i') out[i] = dv.getInt32(i * 4, true);
    else out[i] = bytes[i];
  }
  void step;
  return out;
}

function readProp(buf, dv, p, log) {
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
    let bytes;
    if (enc === 0) bytes = buf.subarray(dataOff, dataOff + SIZE[t] * n);
    else bytes = inflateSync(buf.subarray(dataOff, dataOff + clen));
    const next = dataOff + (enc === 0 ? SIZE[t] * n : clen);
    return { v: arrFromBytes(bytes, n, t), next };
  }
  throw new Error('unknown prop type ' + t + ' at ' + p);
}

function parse(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const readNode = (start, end) => {
    const nend = dv.getUint32(start, true), nprops = dv.getUint32(start + 4, true), plen = dv.getUint32(start + 8, true), nlen = buf[start + 12];
    if (nend === 0 && nprops === 0 && plen === 0 && nlen === 0) return null;
    const name = buf.subarray(start + 13, start + 13 + nlen).toString('utf8');
    let p = start + 13 + nlen;
    const props = [];
    for (let i = 0; i < nprops; i++) { const r = readProp(buf, dv, p, null); props.push(r.v); p = r.next; }
    const children = [];
    let off = start + 13 + nlen + plen;
    while (off < nend) {
      const c = readNode(off, nend);
      if (!c) { off += 13; continue; }
      children.push(c); off = c.end;
    }
    return { name, start, end: nend, props, children };
  };
  const top = [];
  let off = 27;
  while (off < buf.length - 16) {
    const nend = dv.getUint32(off, true), nprops = dv.getUint32(off + 4, true), plen = dv.getUint32(off + 8, true), nlen = buf[off + 12];
    if (nend < off + 13 || nend > buf.length || nlen > 64) break;
    const n = readNode(off, buf.length);
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
const cnt = {};
objs.children.forEach(c => cnt[c.name] = (cnt[c.name] || 0) + 1);
console.log('file', file, 'size', buf.length, 'Objects', JSON.stringify(cnt));

const g = {};
for (const c of geom.children) {
  if (c.name === 'Properties70') { g.Properties70 = c.children.filter(x => x.name === 'P').map(x => x.props); continue; }
  if (['Vertices', 'PolygonVertexIndex', 'Edges', 'Normals', 'NormalsIndex', 'UV', 'UVIndex', 'Materials'].includes(c.name)) g[c.name] = c.props[0];
  else g[c.name] = c.props[0];
}
/* mapping info types */
function mappingOf(layerName) {
  const L = geom.children.find(c => c.name === layerName);
  if (!L) return null;
  const o = {};
  L.children.forEach(c => o[c.name] = c.props[0]);
  return o;
}
['LayerElementNormal', 'LayerElementUV', 'LayerElementMaterial'].forEach(l => { const m = mappingOf(l); console.log(l, m ? JSON.stringify({ Version: m.Version, Name: m.Name, MappingInformationType: m.MappingInformationType, ReferenceInformationType: m.ReferenceInformationType }) : 'none'); });
const model = objs.children.find(c => c.name === 'Model');
console.log('Geometry Properties70:', JSON.stringify(g.Properties70));
console.log('GeometryVersion', g.GeometryVersion);
console.log('Model', JSON.stringify(model.props.slice(1)), '| children:', model.children.filter(c => c.name !== 'Properties70').map(c => c.name + '=' + JSON.stringify(c.props)).join(' '));
console.log('Model Properties70:', JSON.stringify(model.children.find(c => c.name === 'Properties70').children.map(c => c.props)));
const mat = objs.children.find(c => c.name === 'Material');
console.log('Material', JSON.stringify(mat.props.slice(1)), 'ShadingModel=', mat.children.find(c => c.name === 'ShadingModel').props[0]);
console.log('Material Properties70:', JSON.stringify(mat.children.find(c => c.name === 'Properties70').children.map(c => c.props)));
const conn = top.find(n => n.name === 'Connections');
console.log('Connections:', JSON.stringify(conn.children.map(c => c.props)));
const defs = top.find(n => n.name === 'Definitions');
console.log('Definitions:', JSON.stringify(defs.children.filter(c => c.name === 'Count' || c.name.endsWith('Type')).map(c => c.name + ':' + JSON.stringify(c.props))));
const gs = top.find(n => n.name === 'GlobalSettings');
console.log('GlobalSettings:', JSON.stringify(gs.children.find(c => c.name === 'Properties70').children.map(c => c.props)));

/* ---- geometry stats ---- */
const V = g.Vertices, PVI = g.PolygonVertexIndex, E = g.Edges;
const nv = V.length / 3;
console.log('------- geometry');
console.log('verts', nv, 'polyIndexCount', PVI.length, 'edges', E.length, 'uvs', g.UV ? g.UV.length / 2 : 0, 'normals', g.Normals ? g.Normals.length / 3 : 0);
let tris = 0, quads = 0, ngons = 0, cur = 0; const hist = {}; const triList = [];
for (let i = 0; i < PVI.length; i++) {
  cur++;
  if (PVI[i] < 0) {
    if (cur === 3) tris++; else if (cur === 4) quads++; else { ngons++; hist[cur] = (hist[cur] || 0) + 1; }
    if (cur === 3) triList.push([PVI[i - 2], PVI[i - 1], PVI[i] ^ -1]);
    cur = 0;
  }
}
console.log('polys: tris', tris, 'quads', quads, 'ngons', ngons, JSON.stringify(hist));
/* degenerate */
let degen = 0, zeroArea = 0;
const ax = [];
for (let t = 0; t < triList.length; t++) {
  const [a, b2, c] = triList[t];
  if (a === b2 || b2 === c || a === c) degen++;
  const ax0 = V[a * 3], ay0 = V[a * 3 + 1], az0 = V[a * 3 + 2];
  const ux = V[b2 * 3] - ax0, uy = V[b2 * 3 + 1] - ay0, uz = V[b2 * 3 + 2] - az0;
  const vx = V[c * 3] - ax0, vy = V[c * 3 + 1] - ay0, vz = V[c * 3 + 2] - az0;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const area2 = Math.hypot(nx, ny, nz);
  if (area2 < 1e-12) zeroArea++;
  ax.push(area2);
}
console.log('degenerate index tris', degen, 'zero-area tris', zeroArea, 'of', triList.length);
/* winding consistency: compare geometric normal with vertex normals of layer (IndexToDirect) */
let agreeIdx = 0, disagreeIdx = 0, nIdxMissing = 0;
if (g.Normals && g.NormalsIndex) {
  for (const [a, b2, c] of triList) {
    const ux = V[b2 * 3] - V[a * 3], uy = V[b2 * 3 + 1] - V[a * 3 + 1], uz = V[b2 * 3 + 2] - V[a * 3 + 2];
    const vx = V[c * 3] - V[a * 3], vy = V[c * 3 + 1] - V[a * 3 + 1], vz = V[c * 3 + 2] - V[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const n = g.Normals, ni = g.NormalsIndex;
    const ia = ni[triList.indexOf !== undefined ? 0 : 0]; void ia;
    let dot = 0, got = 0;
    for (const vi of [a, b2, c]) {
      /* normals index theo cùng thứ tự polygon-vertex; ở đây map theo vertex index (phải kiểm lại) */
      const k = ni[vi];
      if (k === undefined) { nIdxMissing++; continue; }
      dot += nx * n[k * 3] + ny * n[k * 3 + 1] + nz * n[k * 3 + 2]; got++;
    }
    if (got && dot >= 0) agreeIdx++; else disagreeIdx++;
  }
}
console.log('winding vs normals (index by vertex id): agree', agreeIdx, 'disagree', disagreeIdx);

/* bbox + signed area theo trục chi phối */
let minA = [1e9, 1e9, 1e9], maxA = [-1e9, -1e9, -1e9];
for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const v = V[i * 3 + k]; if (v < minA[k]) minA[k] = v; if (v > maxA[k]) maxA[k] = v; }
console.log('bbox', minA.map(v => +v.toFixed(4)), maxA.map(v => +v.toFixed(4)));
const dims = minA.map((v, k) => maxA[k] - v);
const axis = dims.indexOf(Math.max(...dims));
const [u1, u2] = [0, 1, 2].filter(k => k !== axis);
let total = 0;
for (const [a, b2, c] of triList) {
  const a2 = (V[b2 * 3 + u1] - V[a * 3 + u1]) * (V[c * 3 + u2] - V[a * 3 + u2]) - (V[c * 3 + u1] - V[a * 3 + u1]) * (V[b2 * 3 + u2] - V[a * 3 + u2]);
  total += a2 / 2;
}
console.log('dominant axis', 'XYZ'[axis], 'signed projected area', total.toExponential(3), total >= 0 ? '(CCW / outward if axis-negative view)' : '(CW)');
