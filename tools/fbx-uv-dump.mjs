/* tools/fbx-uv-dump.mjs — in UV RAW trong file FBX (không qua three.js) để so chiều texture
 *   node tools/fbx-uv-dump.mjs a.fbx b.fbx
 */
import fs from 'node:fs';

function parse(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const SZ = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 };
  const readProp = (p) => {
    const t = String.fromCharCode(buf[p]);
    if (t === 'Y') return { v: dv.getInt16(p + 1, true), next: p + 3 };
    if (t === 'C') return { v: buf[p + 1], next: p + 2 };
    if (t === 'I') return { v: dv.getInt32(p + 1, true), next: p + 5 };
    if (t === 'F') return { v: dv.getFloat32(p + 1, true), next: p + 5 };
    if (t === 'D') return { v: dv.getFloat64(p + 1, true), next: p + 9 };
    if (t === 'L') return { v: Number(dv.getBigInt64(p + 1, true)), next: p + 9 };
    if (t === 'S') { const n = dv.getUint32(p + 1, true); return { v: buf.subarray(p + 5, p + 5 + n).toString('utf8'), next: p + 5 + n }; }
    if (t === 'R') { const n = dv.getUint32(p + 1, true); return { v: buf.subarray(p + 5, p + 5 + n), next: p + 5 + n }; }
    const n = dv.getUint32(p + 1, true), enc = dv.getUint32(p + 5, true), clen = dv.getUint32(p + 9, true);
    const d0 = p + 13, bytes = enc === 0 ? SZ[t] * n : clen;
    return { v: { arr: t, n, enc, off: d0, len: bytes }, next: d0 + bytes };
  };
  const rd = (start) => {
    const nend = dv.getUint32(start, true), nprops = dv.getUint32(start + 4, true), plen = dv.getUint32(start + 8, true), nlen = buf[start + 12];
    if (nend === 0 && nprops === 0 && plen === 0 && nlen === 0) return null;
    const name = buf.subarray(start + 13, start + 13 + nlen).toString('utf8');
    let p = start + 13 + nlen; const props = [];
    for (let i = 0; i < nprops; i++) { const r = readProp(p); props.push(r.v); p = r.next; }
    const children = []; let off = start + 13 + nlen + plen;
    while (off < nend) { const c = rd(off); if (!c) { off += 13; continue; } children.push(c); off = c.end; }
    return { name, end: nend, props, children };
  };
  const top = []; let off = 27;
  while (off < buf.length - 16) { const n = rd(off); if (!n) break; top.push(n); off = n.end; }
  return { top, buf, dv };
}
function arrF(p, buf, dv) {
  if (!p) return null;
  const t = p.arr, n = p.n, off = p.off, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (t === 'd') out[i] = dv.getFloat64(off + i * 8, true);
    else if (t === 'f') out[i] = dv.getFloat32(off + i * 4, true);
    else if (t === 'i') out[i] = dv.getInt32(off + i * 4, true);
    else if (t === 'l') out[i] = Number(dv.getBigInt64(off + i * 8, true));
    else out[i] = NaN;
  }
  return out;
}
function geoInfo(file) {
  const { top, buf, dv } = parse(fs.readFileSync(file));
  const objs = top.find(n => n.name === 'Objects');
  const g = objs.children.find(c => c.name === 'Geometry');
  const uvNode = g.children.find(c => c.name === 'LayerElementUV');
  const verts = arrF(g.children.find(c => c.name === 'Vertices').props[0], buf, dv);
  const uv = uvNode ? arrF(uvNode.children.find(c => c.name === 'UV').props[0], buf, dv) : null;
  const uvi = uvNode ? arrF(uvNode.children.find(c => c.name === 'UVIndex').props[0], buf, dv) : null;
  let vmin = 9, vmax = -9, umin = 9, umax = -9;
  if (uv) for (let i = 0; i < uv.length; i += 2) { const u = uv[i], v = uv[i + 1]; if (u < umin) umin = u; if (u > umax) umax = u; if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
  return {
    file, verts: verts.length / 3, uvPairs: uv ? uv.length / 2 : 0, uvIdx: uvi ? uvi.length : 0,
    uRange: [+umin.toFixed(4), +umax.toFixed(4)], vRange: [+vmin.toFixed(4), +vmax.toFixed(4)],
    v0: uv ? [+uv[0].toFixed(4), +uv[1].toFixed(4)] : null,
    v1: uv ? [+uv[2].toFixed(4), +uv[3].toFixed(4)] : null,
    y0: [+verts[1].toFixed(4), +verts[4].toFixed(4)]
  };
}
const files = process.argv.slice(2);
const infos = files.map(geoInfo);
infos.forEach(i => console.log(`${i.file}\n  verts ${i.verts} | uvPairs ${i.uvPairs} | uvIndex ${i.uvIdx} | U ${JSON.stringify(i.uRange)} | V ${JSON.stringify(i.vRange)}\n  uv[0] ${JSON.stringify(i.v0)}  uv[1] ${JSON.stringify(i.v1)}  | y của vertex 0,1: ${JSON.stringify(i.y0)}`));
if (infos.length >= 2) {
  const [a, b] = infos;
  const same = JSON.stringify(a.uRange) === JSON.stringify(b.uRange) && JSON.stringify(a.vRange) === JSON.stringify(b.vRange) && JSON.stringify(a.v0) === JSON.stringify(b.v0);
  console.log(`\nUV giống nhau giữa 2 file: ${same ? 'CÓ ✓ (không bị đảo chiều)' : 'KHÁC — UV đã đổi, texture sẽ lệch'}`);
}