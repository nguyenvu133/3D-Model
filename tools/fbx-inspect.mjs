/* tools/fbx-inspect.mjs — soi FBX (binary 7.x hoặc ASCII): version, mesh, tris, UV, material, texture, bone */
import fs from 'node:fs';

function isBinary(buf) { return buf.slice(0, 20).toString('latin1') === 'Kaydara FBX Binary  '; }

function parseBinary(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 27; const len = buf.length;
  const rp = (end) => {
    if (off >= end) return null;
    const t = String.fromCharCode(buf[off]);
    if (t === 'Y') { const v = dv.getInt16(off + 1, true); off += 3; return v; }
    if (t === 'C') { const v = buf[off + 1]; off += 2; return v; }
    if (t === 'I') { const v = dv.getInt32(off + 1, true); off += 5; return v; }
    if (t === 'F') { const v = dv.getFloat32(off + 1, true); off += 5; return v; }
    if (t === 'D') { const v = dv.getFloat64(off + 1, true); off += 9; return v; }
    if (t === 'L') { const v = Number(dv.getBigInt64(off + 1, true)); off += 9; return v; }
    if (t === 'S') { const n = dv.getUint32(off + 1, true); const s = buf.subarray(off + 5, off + 5 + n).toString('utf8'); off += 5 + n; return s; }
    if (t === 'R') { const n = dv.getUint32(off + 1, true); off += 5 + n; return '<raw ' + n + 'B>'; }
    if ('fdlibc'.indexOf(t) >= 0) {
      const n = dv.getUint32(off + 1, true), enc = dv.getUint32(off + 5, true), clen = dv.getUint32(off + 9, true);
      const size = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 }[t] * n;
      const arr = { k: t, n, enc, clen, off: off + 13, size: enc === 0 ? size : clen };
      off += 13 + (enc === 0 ? size : clen);
      return arr;
    }
    off += 1; return '<' + t + '>';
  };
  const rn = (limit) => {
    if (off + 13 > limit) return null;
    const start = off, end = dv.getUint32(off, true), nprops = dv.getUint32(off + 4, true), plen = dv.getUint32(off + 8, true), nlen = buf[off + 12];
    if (end === 0 && nprops === 0 && plen === 0 && nlen === 0) { off += 13; return null; }
    if (end < start || end > limit) return null;
    const name = buf.subarray(off + 13, off + 13 + nlen).toString('utf8');
    off += 13 + nlen;
    const propsEnd = off + plen;
    const props = [];
    for (let i = 0; i < nprops && off < propsEnd; i++) props.push(rp(propsEnd));
    off = propsEnd;
    const children = [];
    while (off < end) { const c = rn(end); if (!c) break; children.push(c); }
    if (off < end) off = end;
    return { name, props, children };
  };
  const nodes = [];
  while (off < len - 16) { const n = rn(len - 16); if (!n) break; nodes.push(n); }
  return { kind: 'binary', version: buf.readUInt32LE(23), nodes };
}

function parseAscii(text) {
  /* ASCII FBX: chỉ cần đếm node/khối */
  const lines = text.split(/\r?\n/);
  const counts = {};
  lines.forEach(l => {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\d]+)?\s*,?\s*"?([^"]*)?"?/);
    if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
  });
  return { kind: 'ascii', counts, text };
}

const file = process.argv[2];
const buf = fs.readFileSync(file);
console.log('=== ' + file + ' (' + (buf.length / 1048576).toFixed(2) + ' MB) ===');

if (!isBinary(buf)) {
  const a = parseAscii(buf.toString('utf8'));
  console.log('LOẠI: FBX ASCII ⚠️  (Mixamo cần BINARY)');
  console.log('node counts:', JSON.stringify(a.counts));
  ['Objects', 'Geometry', 'Model', 'Material', 'Texture', 'Video', 'Deformer', 'Pose', 'AnimationStack', 'Connections'].forEach(k => {
    if (a.counts[k]) console.log('  ' + k + ': ' + a.counts[k]);
  });
  process.exit(0);
}

const g = parseBinary(buf);
console.log('LOẠI: FBX Binary, version', g.version, (g.version <= 7300 ? '(FBX 2013 hoặc cũ hơn - Mixamo CHẤP NHẬN ✓)' : g.version === 7400 ? '(FBX 2014 - Mixamo TỪ CHỐI "use FBX files 2013 or earlier")' : '(FBX mới hơn 2013 - Mixamo từ chối)'));
const objs = g.nodes.find(n => n.name === 'Objects');
const byType = {};
if (objs) objs.children.forEach(c => { (byType[c.name] = byType[c.name] || []).push(c); });
console.log('top:', g.nodes.map(n => n.name).join(', '));
console.log('objects:', JSON.stringify(Object.keys(byType).reduce((o, k) => (o[k] = byType[k].length, o), {})));

/* geometry: đếm tris + UV + normals */
(byType.Geometry || []).forEach((geom, i) => {
  const kids = geom.children.map(c => c.name);
  const piv = geom.children.find(c => c.name === 'PolygonVertexIndex');
  const verts = geom.children.find(c => c.name === 'Vertices');
  const tris = piv && piv.props[0] && piv.props[0].n ? Math.round(piv.props[0].n / 3) : '?';
  const vcount = verts && verts.props[0] && verts.props[0].n ? verts.props[0].n / 3 : '?';
  console.log('geometry[' + i + '] verts=' + vcount + ' tris=' + tris + ' children=' + kids.join(','));
  console.log('   có UV: ' + (kids.includes('LayerElementUV') ? 'CÓ ✓' : 'KHÔNG ✗') + ' | normal: ' + (kids.includes('LayerElementNormal') ? 'CÓ' : 'KHÔNG'));
});

/* material + texture */
(byType.Material || []).forEach((m, i) => {
  const p70 = m.children.find(c => c.name === 'Properties70');
  const props = p70 ? p70.children.filter(c => c.name === 'P').map(c => c.props[0] + '=' + JSON.stringify(c.props.slice(4, 7))) : [];
  console.log('material[' + i + ']', m.props[1], '->', props.join(' '));
});
console.log('Texture nodes:', (byType.Texture || []).length, '| Video nodes:', (byType.Video || []).length);
(byType.Video || []).forEach((v, i) => {
  const c = v.children.find(x => x.name === 'Content');
  console.log('  video[' + i + ']', v.props[1], '| embedded bytes:', c && c.props[0] ? String(c.props[0]).length : 0);
});
/* connections material -> model */
const conn = g.nodes.find(n => n.name === 'Connections');
const nameOf = {};
if (objs) objs.children.forEach(c => { nameOf[c.props[0]] = c.name + ':' + String(c.props[1] || '').replace(/\u0000.*$/, ''); });
if (conn) {
  const texLinks = conn.children.filter(c => c.name === 'C' && /Texture|Material/.test(nameOf[c.props[1]] || ''));
  texLinks.slice(0, 8).forEach(c => console.log('  connect:', nameOf[c.props[1]] || c.props[1], '->', nameOf[c.props[2]] || c.props[2]));
}
/* bone */
console.log('Model Mesh:', (byType.Model || []).filter(m => m.props[2] === 'Mesh').length,
  '| LimbNode:', (byType.Model || []).filter(m => m.props[2] === 'LimbNode').length);
console.log('Deformer:', (byType.Deformer || []).length, '| Pose:', (byType.Pose || []).length);
console.log('AnimationStack:', (byType.AnimationStack || []).length);