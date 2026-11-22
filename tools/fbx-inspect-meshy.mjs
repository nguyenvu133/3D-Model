/* tools/fbx-inspect-meshy.mjs — liệt kê toàn bộ node cấp 0/1 + objects của 1 file FBX binary */
import fs from 'node:fs';

function parse(buf, opts = {}) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 27;
  const problems = [];
  const readProp = () => {
    if (off >= buf.length) { problems.push('prop past EOF at ' + off); return null; }
    const t = String.fromCharCode(buf[off]);
    if (t === 'Y') { const v = dv.getInt16(off + 1, true); off += 3; return v; }
    if (t === 'C') { const v = buf[off + 1]; off += 2; return v; }
    if (t === 'I') { const v = dv.getInt32(off + 1, true); off += 5; return v; }
    if (t === 'F') { const v = dv.getFloat32(off + 1, true); off += 5; return v; }
    if (t === 'D') { const v = dv.getFloat64(off + 1, true); off += 9; return v; }
    if (t === 'L') { const v = Number(dv.getBigInt64(off + 1, true)); off += 9; return v; }
    if (t === 'S') { const n = dv.getUint32(off + 1, true); const s = buf.subarray(off + 5, off + 5 + n).toString('utf8'); off += 5 + n; return s; }
    if (t === 'R') { const n = dv.getUint32(off + 1, true); off += 5 + n; return '<raw ' + n + '>'; }
    if ('fdlibc'.indexOf(t) >= 0) {
      const n = dv.getUint32(off + 1, true), enc = dv.getUint32(off + 5, true), clen = dv.getUint32(off + 9, true);
      const size = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 }[t] * n;
      const dataOff = off + 13;
      off += 13 + (enc === 0 ? size : clen);
      if (opts.keepArrays) return { t, n, enc, clen, dataOff };
      return '<' + t + '[' + n + ']>';
    }
    problems.push('UNKNOWN prop type ' + JSON.stringify(t) + ' at ' + off);
    off += 1;
    return null;
  };
  const readNode = () => {
    if (off + 13 > buf.length) return null;
    const start = off;
    const end = dv.getUint32(off, true), nprops = dv.getUint32(off + 4, true), plen = dv.getUint32(off + 8, true), nlen = buf[off + 12];
    if (end === 0 && nprops === 0 && plen === 0 && nlen === 0) { off += 13; return null; }
    if (end > buf.length) { problems.push('node end past EOF at ' + start + ' end=' + end); return null; }
    const name = buf.subarray(off + 13, off + 13 + nlen).toString('utf8');
    off += 13 + nlen;
    const props = [];
    for (let i = 0; i < nprops; i++) props.push(readProp());
    const children = [];
    while (off < end) { const c = readNode(); if (!c) break; children.push(c); }
    if (off < end) { problems.push("end mismatch '" + name + "' expected=" + end + ' got=' + off); off = end; }
    if (off > end) { problems.push("overflow '" + name + "' expected=" + end + ' got=' + off); off = end; }
    return { name, start, end, props, children };
  };
  const nodes = [];
  while (off < buf.length - 16) { const n = readNode(); if (!n) break; nodes.push(n); }
  return { nodes, problems, finalOff: off };
}

const file = process.argv[2];
const buf = fs.readFileSync(file);
const R = parse(buf);
console.log('file', file, 'size', buf.length);
console.log('top nodes:', R.nodes.map(n => n.name + '[' + n.children.length + ']').join(', '));
console.log('finalOff', R.finalOff, 'problems', R.problems.slice(0, 20));
const objs = R.nodes.find(n => n.name === 'Objects');
if (objs) {
  const counts = {};
  objs.children.forEach(c => counts[c.name] = (counts[c.name] || 0) + 1);
  console.log('Objects:', JSON.stringify(counts));
  objs.children.slice(0, 400).forEach(c => console.log('  ', c.name, JSON.stringify(c.props.slice(0, 3))));
}
const conn = R.nodes.find(n => n.name === 'Connections');
if (conn) console.log('Connections:', conn.children.length, JSON.stringify(conn.children.slice(0, 5).map(c => c.props)));
const gs = R.nodes.find(n => n.name === 'GlobalSettings');
if (gs) {
  const p = gs.children.find(c => c.name === 'Properties70');
  console.log('GlobalSettings:', JSON.stringify(p ? p.children.filter(c => c.name === 'P').map(c => [c.props[0], ...c.props.slice(4)]) : []));
}
const takes = R.nodes.find(n => n.name === 'Takes');
if (takes) console.log('Takes children:', takes.children.map(c => c.name + ':' + JSON.stringify(c.props)));
