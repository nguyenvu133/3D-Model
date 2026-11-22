/* tools/fbx-dump-geo.mjs — đọc Geometry của file FBX binary: vertices, polygon index, UV và in thống kê */
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';

function parse(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 27;
  const readProp = () => {
    const t = String.fromCharCode(buf[off]);
    if (t === 'Y') { const v = dv.getInt16(off + 1, true); off += 3; return v; }
    if (t === 'C') { const v = buf[off + 1]; off += 2; return v; }
    if (t === 'I') { const v = dv.getInt32(off + 1, true); off += 5; return v; }
    if (t === 'F') { const v = dv.getFloat32(off + 1, true); off += 5; return v; }
    if (t === 'D') { const v = dv.getFloat64(off + 1, true); off += 9; return v; }
    if (t === 'L') { const v = Number(dv.getBigInt64(off + 1, true)); off += 9; return v; }
    if (t === 'S') { const n = dv.getUint32(off + 1, true); const s = buf.subarray(off + 5, off + 5 + n).toString('utf8'); off += 5 + n; return s; }
    if (t === 'R') { const n = dv.getUint32(off + 1, true); const s = buf.subarray(off + 5, off + 5 + n); off += 5 + n; return s; }
    if ('fdlibc'.indexOf(t) >= 0) {
      const n = dv.getUint32(off + 1, true), enc = dv.getUint32(off + 5, true), clen = dv.getUint32(off + 9, true);
      const size = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 }[t];
      const dataOff = off + 13;
      if (enc === 0) {
        off += 13 + (size === undefined ? clen : size * n);
        if (t === 'd') { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = dv.getFloat64(dataOff + i * 8, true); return a; }
        if (t === 'f') { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = dv.getFloat32(dataOff + i * 4, true); return a; }
        if (t === 'i') { const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = dv.getInt32(dataOff + i * 4, true); return a; }
        if (t === 'l') { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = Number(dv.getBigInt64(dataOff + i * 8, true)); return a; }
        return { t, n, enc };
      }
      /* deflate/zlib */
      const raw = inflateSync(buf.subarray(dataOff, dataOff + clen));
      const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      if (t === 'd') { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = rv.getFloat64(i * 8, true); return a; }
      if (t === 'i') { const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = rv.getInt32(i * 4, true); return a; }
      throw new Error('compressed type ' + t + ' enc=' + enc);
    }
    throw new Error('unknown prop ' + t + ' at ' + off + ' ctx=' + JSON.stringify(String.fromCharCode.apply(null, buf.subarray(off, off + 16))));
  };
  const readNode = () => {
    if (off + 13 > buf.length) return null;
    const end = dv.getUint32(off, true), nprops = dv.getUint32(off + 4, true), plen = dv.getUint32(off + 8, true), nlen = buf[off + 12];
    if (end === 0 && nprops === 0 && plen === 0 && nlen === 0) { off += 13; return null; }
    const name = buf.subarray(off + 13, off + 13 + nlen).toString('utf8');
    off += 13 + nlen;
    const props = [];
    for (let i = 0; i < nprops; i++) props.push(readProp());
    const children = [];
    while (off < end) { const c = readNode(); if (!c) break; children.push(c); }
    if (off < end) off = end;
    return { name, props, children };
  };
  const nodes = [];
  while (off < buf.length - 16) { const n = readNode(); if (!n) break; nodes.push(n); }
  return nodes;
}



const file = process.argv[2];
const buf = fs.readFileSync(file);
const nodes = parse(buf);
const objs = nodes.find(n => n.name === 'Objects');
const geom = objs.children.find(c => c.name === 'Geometry');
const model = objs.children.find(c => c.name === 'Model');
console.log('--- file', file, 'size', buf.length);
console.log('top:', nodes.map(n => n.name).join(', '));
console.log('Geometry children:');
for (const c of geom.children) console.log('  ', c.name, Array.isArray(c.props[0]) || ArrayBuffer.isView(c.props[0]) ? '(' + c.props[0].length + ' items, ' + c.props[0].constructor.name + ')' : JSON.stringify(c.props.slice(0, 3)));
console.log('Model children:');
for (const c of model.children) {
  if (c.name === 'Properties70') { console.log('   Properties70:'); for (const p of c.children) console.log('     ', p.name, JSON.stringify(p.props)); }
  else console.log('   ', c.name, JSON.stringify(c.props).slice(0, 200));
}
const V = geom.children.find(c => c.name === 'Vertices').props[0];
const PVI = geom.children.find(c => c.name === 'PolygonVertexIndex').props[0];
let nv = V.length / 3;
let tris = 0, quads = 0, ngons = 0, cur = 0;
const hist = {};
for (let i = 0; i < PVI.length; i++) { cur++; if (PVI[i] < 0) { if (cur === 3) tris++; else if (cur === 4) quads++; else { ngons++; hist[cur] = (hist[cur] || 0) + 1; } cur = 0; } }
console.log('verts', nv, 'indexCount', PVI.length, 'tris', tris, 'quads', quads, 'ngons', ngons, JSON.stringify(hist).slice(0, 200));
/* orientation: project onto dominant axis, signed area */
const pv = new Float64Array(V.length); for (let i = 0; i < V.length; i++) pv[i] = V[i];
let minA = [1e9, 1e9, 1e9], maxA = [-1e9, -1e9, -1e9];
for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const v = pv[i * 3 + k]; if (v < minA[k]) minA[k] = v; if (v > maxA[k]) maxA[k] = v; }
console.log('bbox', minA.map(v => +v.toFixed(3)), maxA.map(v => +v.toFixed(3)));
const axis = minA.map((v, k) => maxA[k] - v).indexOf(Math.max(...minA.map((v, k) => maxA[k] - v)));
const ax = [0, 1, 2].filter(k => k !== axis);
let area = 0, areaFront = 0, areaBack = 0;
const areas = [];
for (let i = 0; i < PVI.length; i++) {
  if (PVI[i] >= 0) continue;
  /* tam giác: i-2, i-1, i ; i là index cuối (đảo bit) */
  const ia = PVI[i - 2] >>> 0, ib = PVI[i - 1] >>> 0, ic = (PVI[i] ^ -1) >>> 0;
  const ax0 = pv[ia * 3 + ax[0]], ay0 = pv[ia * 3 + ax[1]];
  const bx0 = pv[ib * 3 + ax[0]], by0 = pv[ib * 3 + ax[1]];
  const cx0 = pv[ic * 3 + ax[0]], cy0 = pv[ic * 3 + ax[1]];
  const a2 = (bx0 - ax0) * (cy0 - ay0) - (cx0 - ax0) * (by0 - ay0);
  area += a2 / 2; if (a2 > 0) areaFront += a2 / 2; else areaBack += -a2 / 2;
  areas.push(a2 / 2);
}
console.log('dominant axis', 'XYZ'[axis], 'signed2D area sum', area.toExponential(3), 'pos', areaFront.toExponential(3), 'neg', areaBack.toExponential(3));
const UV = geom.children.find(c => c.name === 'LayerElementUV');
if (UV) { const u = UV.children.find(c => c.name === 'UV').props[0]; let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9; for (let i = 0; i < u.length; i += 2) { umin = Math.min(umin, u[i]); umax = Math.max(umax, u[i]); vmin = Math.min(vmin, u[i + 1]); vmax = Math.max(vmax, u[i + 1]); } console.log('UV range', [umin, umax, vmin, vmax].map(v => +v.toFixed(3)), 'count', u.length / 2); }
const UVidx = geom.children.find(c => c.name === 'LayerElementUVIndex');
console.log('LayerElement names:', geom.children.map(c => c.name).join(', '));
