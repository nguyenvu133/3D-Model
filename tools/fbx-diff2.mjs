/* tools/fbx-diff2.mjs — so sánh cấu trúc FBX (reader biên tuyệt đối, chịu mọi loại property) */
import fs from 'node:fs';

function parse(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = buf.length;
  let off = 27;
  const readProp = (end) => {
    if (off >= end) return null;
    const t = String.fromCharCode(buf[off]);
    if (t === 'Y') { off += 3; return '<Y>'; }
    if (t === 'C') { off += 2; return '<C>'; }
    if (t === 'I') { off += 5; return '<I>'; }
    if (t === 'F') { off += 5; return '<F>'; }
    if (t === 'D') { off += 9; return '<D>'; }
    if (t === 'L') { off += 9; return '<L>'; }
    if (t === 'S') { const n = dv.getUint32(off + 1, true); off += 5 + n; return '<S>'; }
    if (t === 'R') { const n = dv.getUint32(off + 1, true); off += 5 + n; return '<R>'; }
    if ('fdlibc'.indexOf(t) >= 0) {
      const n = dv.getUint32(off + 1, true), enc = dv.getUint32(off + 5, true), clen = dv.getUint32(off + 9, true);
      const size = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 }[t] * n;
      off += 13 + (enc === 0 ? size : clen);
      return '<' + t + '[' + n + ']>';
    }
    off += 1;
    return '<' + t + '>';
  };
  const readNode = (limit) => {
    if (off + 13 > limit) return null;
    const start = off;
    const end = dv.getUint32(off, true), nprops = dv.getUint32(off + 4, true), plen = dv.getUint32(off + 8, true), nlen = buf[off + 12];
    if (end === 0 && nprops === 0 && plen === 0 && nlen === 0) { off += 13; return null; }
    if (end < start || end > limit) return null;   /* lệch → dừng */
    const name = buf.subarray(off + 13, off + 13 + nlen).toString('utf8');
    const propsEnd = off + 13 + nlen + plen;
    off = off + 13 + nlen;
    const props = [];
    for (let i = 0; i < nprops && off < propsEnd; i++) props.push(readProp(propsEnd));
    off = propsEnd;
    const children = [];
    while (off < end) {
      const c = readNode(end);
      if (!c) break;
      children.push(c);
    }
    if (off < end) off = end;
    return { name, props, children, start, end };
  };
  const nodes = [];
  while (off < len - 16) {
    const n = readNode(len - 16);
    if (!n) break;
    nodes.push(n);
  }
  return nodes;
}

function dump(label, file) {
  const buf = fs.readFileSync(file);
  const nodes = parse(buf);
  const top = nodes.map(n => n.name);
  const objs = nodes.find(n => n.name === 'Objects');
  const byType = {};
  if (objs) objs.children.forEach(c => { (byType[c.name] = byType[c.name] || []).push(c); });
  const counts = {}; Object.keys(byType).forEach(k => counts[k] = byType[k].length);
  const conn = nodes.find(n => n.name === 'Connections');
  const nameOf = {};
  if (objs) objs.children.forEach(c => { nameOf[c.props[0]] = c.name; });
  const pairs = {};
  if (conn) conn.children.filter(c => c.name === 'C').forEach(c => {
    const a = nameOf[c.props[1]] || (c.props[1] === 0 ? 'ROOT' : String(c.props[1]));
    const b = nameOf[c.props[2]] || (c.props[2] === 0 ? 'ROOT' : String(c.props[2]));
    pairs[a + ' -> ' + b] = (pairs[a + ' -> ' + b] || 0) + 1;
  });
  const childNames = n => n ? n.children.map(c => c.name) : [];
  const pNames = n => {
    const p = n && n.children.find(c => c.name === 'Properties70');
    return p ? p.children.filter(c => c.name === 'P').map(c => c.props[0]) : [];
  };
  const gs = nodes.find(n => n.name === 'GlobalSettings');
  const gsProps = {};
  if (gs) {
    const p = gs.children.find(c => c.name === 'Properties70');
    if (p) p.children.filter(c => c.name === 'P').forEach(c => { gsProps[c.props[0]] = c.props.slice(4); });
  }
  const geom = byType.Geometry && byType.Geometry[0];
  const meshModel = (byType.Model || []).find(m => m.props[2] === 'Mesh');
  const boneModel = (byType.Model || []).find(m => m.props[2] === 'LimbNode');
  const skin = (byType.Deformer || []).find(d => d.props[2] === 'Skin');
  const cluster = (byType.Deformer || []).find(d => d.props[2] === 'Cluster');
  const pose = byType.Pose && byType.Pose[0];
  const poseNode = pose && pose.children.find(c => c.name === 'PoseNode');

  console.log('================ ' + label + ' ================');
  console.log('version', buf.readUInt32LE(23), '| top:', top.join(', '));
  console.log('counts:', JSON.stringify(counts));
  console.log('connections:', conn ? conn.children.length : 0, JSON.stringify(pairs));
  console.log('GlobalSettings:', JSON.stringify(gsProps));
  console.log('Geometry children:', childNames(geom).join(', '));
  console.log('Geometry P70:', pNames(geom).join(', ') || '(none)');
  console.log('Mesh Model children:', childNames(meshModel).join(', '));
  console.log('Mesh Model P70:', pNames(meshModel).join(', ') || '(none)');
  console.log('Mesh Model name/type:', meshModel ? [meshModel.props[1], meshModel.props[2]].join(' | ') : '-');
  console.log('Bone Model children:', childNames(boneModel).join(', '));
  console.log('Bone Model P70:', pNames(boneModel).join(', ') || '(none)');
  console.log('Skin children:', childNames(skin).join(', '), '|', skin ? [skin.props[1], skin.props[2]].join(' | ') : '-');
  console.log('Cluster children:', childNames(cluster).join(', '), '|', cluster ? [cluster.props[1], cluster.props[2]].join(' | ') : '-');
  console.log('Pose children:', childNames(pose).join(', '), '|', pose ? pose.props.slice(0, 3).join(' | ') : '-');
  console.log('PoseNode children:', childNames(poseNode).join(', '));
  return { nodes, counts, byType, childNames, pNames, gsProps };
}

const mineF = process.argv[2] || 'docs/m2m-v10/sample-export.fbx';
const refF = process.argv[3] || 'assets/models/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running.fbx';
const mine = dump('MINE', mineF);
const ref = dump('REFERENCE (Mixamo-accepted)', refF);

console.log('\n================ DIFF ================');
console.log('top node thiếu ở MINE:', ref.nodes.map(n => n.name).filter(n => !mine.nodes.map(x => x.name).includes(n)).join(', ') || '(không)');
console.log('object type thiếu:', Object.keys(ref.counts).filter(k => !mine.counts[k]).join(', ') || '(không)');
const rm = (ref.byType.Model || []).find(m => m.props[2] === 'Mesh');
const mm = (mine.byType.Model || []).find(m => m.props[2] === 'Mesh');
console.log('Mesh Model children thiếu:', ref.childNames(rm).filter(x => !mine.childNames(mm).includes(x)).join(', ') || '(không)');
console.log('Mesh Model P70 thiếu:', ref.pNames(rm).filter(x => !mine.pNames(mm).includes(x)).join(', ') || '(không)');
const rb = (ref.byType.Model || []).find(m => m.props[2] === 'LimbNode');
const mb = (mine.byType.Model || []).find(m => m.props[2] === 'LimbNode');
console.log('Bone Model P70 thiếu:', ref.pNames(rb).filter(x => !mine.pNames(mb).includes(x)).join(', ') || '(không)');
const rc = (ref.byType.Deformer || []).find(d => d.props[2] === 'Cluster');
const mc = (mine.byType.Deformer || []).find(d => d.props[2] === 'Cluster');
console.log('Cluster children thiếu:', ref.childNames(rc).filter(x => !mine.childNames(mc).includes(x)).join(', ') || '(không)');
console.log('Geometry children thiếu:', ref.childNames(ref.byType.Geometry && ref.byType.Geometry[0]).filter(x => !mine.childNames(mine.byType.Geometry && mine.byType.Geometry[0]).includes(x)).join(', ') || '(không)');
