/* tools/fbx-deep-diff.mjs — so sánh sâu FBX của mình với FBX chuẩn (Mixamo đã chấp nhận)
 * Đọc đủ mọi loại property FBX ('Y','C','I','F','D','L','S','R', arrays)
 */
import fs from 'node:fs';

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
    if (t === 'R') { const n = dv.getUint32(off + 1, true); off += 5 + n; return '<raw>'; }
    if ('fdlibc'.indexOf(t) >= 0 && t.length === 1) {
      const n = dv.getUint32(off + 1, true), enc = dv.getUint32(off + 5, true), clen = dv.getUint32(off + 9, true);
      const size = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 }[t] * n;
      off += 13 + (enc === 0 ? size : clen);
      return '<' + t + '[' + n + ']>';
    }
    off += 1; return null;
  };
  const readNode = () => {
    if (off + 13 > buf.length) return null;
    const end = dv.getUint32(off), nprops = dv.getUint32(off + 4), plen = dv.getUint32(off + 8), nlen = buf[off + 12];
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

function summarize(label, file) {
  const buf = fs.readFileSync(file);
  const nodes = parse(buf);
  const top = nodes.map(n => n.name);
  const objs = nodes.find(n => n.name === 'Objects');
  const byType = {};
  if (objs) objs.children.forEach(c => { (byType[c.name] = byType[c.name] || []).push(c); });
  const counts = {};
  Object.keys(byType).forEach(k => counts[k] = byType[k].length);

  const pick = (type, filter) => (byType[type] || []).filter(filter || (() => true))[0];

  const geom = pick('Geometry');
  const meshModel = (byType.Model || []).find(m => (m.props[2] || '') === 'Mesh');
  const boneModel = (byType.Model || []).find(m => (m.props[2] || '') === 'LimbNode');
  const skin = (byType.Deformer || []).find(d => (d.props[2] || '') === 'Skin');
  const cluster = (byType.Deformer || []).find(d => (d.props[2] || '') === 'Cluster');
  const pose = pick('Pose');
  const gs = nodes.find(n => n.name === 'GlobalSettings');

  const childNames = n => n ? n.children.map(c => c.name) : [];
  const pNames = n => {
    const p = n && n.children.find(c => c.name === 'Properties70');
    return p ? p.children.filter(c => c.name === 'P').map(c => c.props[0]) : [];
  };
  const gsProps = (() => {
    if (!gs) return {};
    const p = gs.children.find(c => c.name === 'Properties70');
    if (!p) return {};
    const o = {};
    p.children.filter(c => c.name === 'P').forEach(c => { o[c.props[0]] = c.props.slice(4); });
    return o;
  })();

  console.log('================ ' + label + ' ================');
  console.log('size', buf.length, '| version', buf.readUInt32LE(23));
  console.log('top nodes:', top.join(', '));
  console.log('Objects counts:', JSON.stringify(counts));
  console.log('GlobalSettings:', JSON.stringify(gsProps));
  console.log('Geometry children:', childNames(geom).join(', '));
  console.log('Geometry Properties70:', pNames(geom).join(', ') || '(none)');
  console.log('Mesh Model children:', childNames(meshModel).join(', '));
  console.log('Mesh Model Properties70:', pNames(meshModel).join(', '));
  console.log('Mesh Model props[1..2]:', meshModel ? [meshModel.props[1], meshModel.props[2]].join(' | ') : '-');
  console.log('Bone Model children:', childNames(boneModel).join(', '));
  console.log('Bone Model Properties70:', pNames(boneModel).join(', '));
  console.log('Bone Model props[1..2]:', boneModel ? [boneModel.props[1], boneModel.props[2]].join(' | ') : '-');
  console.log('Skin children:', childNames(skin).join(', '), '| props:', skin ? [skin.props[1], skin.props[2]].join(' | ') : '-');
  console.log('Cluster children:', childNames(cluster).join(', '), '| props:', cluster ? [cluster.props[1], cluster.props[2]].join(' | ') : '-');
  console.log('Pose children:', childNames(pose).join(', '), '| props:', pose ? pose.props.slice(0, 3).join(' | ') : '-');
  const poseNode = pose && pose.children.find(c => c.name === 'PoseNode');
  console.log('PoseNode children:', childNames(poseNode).join(', '));

  /* Connections: đếm theo cặp loại child→parent */
  const conn = nodes.find(n => n.name === 'Connections');
  const nameOf = {};
  if (objs) objs.children.forEach(c => { nameOf[c.props[0]] = c.name; });
  const pairs = {};
  if (conn) conn.children.filter(c => c.name === 'C').forEach(c => {
    const a = nameOf[c.props[1]] || (c.props[1] === 0 ? 'ROOT' : String(c.props[1]));
    const b = nameOf[c.props[2]] || (c.props[2] === 0 ? 'ROOT' : String(c.props[2]));
    const key = a + ' -> ' + b;
    pairs[key] = (pairs[key] || 0) + 1;
  });
  console.log('Connections:', conn ? conn.children.length : 0, JSON.stringify(pairs));
  return { nodes, counts, childNames, pNames, gsProps, nameOf, conn, byType };
}

const mineFile = process.argv[2] || 'docs/m2m-v10/sample-export.fbx';
const refFile = process.argv[3] || 'assets/models/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running.fbx';

const mine = summarize('MINE', mineFile);
const ref = summarize('REFERENCE (Mixamo-accepted)', refFile);

console.log('\n================ DIFF ================');
const missingTop = ref.nodes.map(n => n.name).filter(n => !mine.nodes.map(x => x.name).includes(n));
console.log('top node thiếu ở MINE:', missingTop.join(', ') || '(không)');
const missingObjs = Object.keys(ref.counts).filter(k => !mine.counts[k]);
console.log('object type thiếu ở MINE:', missingObjs.join(', ') || '(không)');
console.log('Geometry children thiếu:', mine.childNames(ref.byType.Geometry && ref.byType.Geometry[0]).filter(x => !mine.childNames(mine.byType.Geometry && mine.byType.Geometry[0]).includes(x)).join(', ') || '(không)');
console.log('Mesh Model children thiếu:', (() => {
  const rm = (ref.byType.Model || []).find(m => m.props[2] === 'Mesh');
  const mm = (mine.byType.Model || []).find(m => m.props[2] === 'Mesh');
  return ref.childNames(rm).filter(x => !mine.childNames(mm).includes(x)).join(', ') || '(không)';
})());
console.log('Mesh Model Properties70 thiếu:', (() => {
  const rm = (ref.byType.Model || []).find(m => m.props[2] === 'Mesh');
  const mm = (mine.byType.Model || []).find(m => m.props[2] === 'Mesh');
  return ref.pNames(rm).filter(x => !mine.pNames(mm).includes(x)).join(', ') || '(không)';
})());
console.log('Bone Model Properties70 thiếu:', (() => {
  const rb = (ref.byType.Model || []).find(m => m.props[2] === 'LimbNode');
  const mb = (mine.byType.Model || []).find(m => m.props[2] === 'LimbNode');
  return ref.pNames(rb).filter(x => !mine.pNames(mb).includes(x)).join(', ') || '(không)';
})());
console.log('Cluster children thiếu:', (() => {
  const rc = (ref.byType.Deformer || []).find(d => d.props[2] === 'Cluster');
  const mc = (mine.byType.Deformer || []).find(d => d.props[2] === 'Cluster');
  return ref.childNames(rc).filter(x => !mine.childNames(mc).includes(x)).join(', ') || '(không)';
})());
