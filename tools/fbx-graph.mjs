/* tools/fbx-graph.mjs — dựng ĐỒ THỊ liên kết của FBX BINARY (Model tree, NodeAttribute,
 * Geometry/Material, Skin/Cluster, BindPose) để soi lỗi rig/skeleton.
 *
 *   node tools/fbx-graph.mjs <file.fbx> [--full]
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
    const d0 = p + 13, len = enc === 0 ? SZ[t] * n : clen;
    return { v: { arr: t, n, enc, off: d0, len, size: SZ[t] }, next: d0 + len };
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
  return top;
}
const arr = (p, buf, dv) => {
  if (!p || p.arr === undefined) return null;
  const out = new Float64Array(p.n);
  for (let i = 0; i < p.n; i++) {
    if (p.arr === 'd') out[i] = dv.getFloat64(p.off + i * 8, true);
    else if (p.arr === 'f') out[i] = dv.getFloat32(p.off + i * 4, true);
    else if (p.arr === 'i') out[i] = dv.getInt32(p.off + i * 4, true);
    else if (p.arr === 'l') out[i] = Number(dv.getBigInt64(p.off + i * 8, true));
    else out[i] = NaN;
  }
  return out;
};

const file = process.argv[2];
const full = process.argv.includes('--full');
const buf = fs.readFileSync(file);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const top = parse(buf);
const version = buf.readUInt32LE(23);
const objs = top.find(n => n.name === 'Objects');
const conns = top.find(n => n.name === 'Connections');
const gs = top.find(n => n.name === 'GlobalSettings');

const clean = s => String(s == null ? '' : s).replace(/\u0000[\s\S]*$/, '');

P0();
function P0() {}
const out = [];
const P = s => out.push(s);

P('=== ' + file + ' — version ' + version + ' (' + (version === 7300 ? 'FBX 2013' : version === 7400 ? 'FBX 2014' : '?') + ') ===');

/* GlobalSettings */
if (gs) {
  const p70 = gs.children.find(c => c.name === 'Properties70');
  const keys = ['UpAxis', 'UpAxisSign', 'FrontAxis', 'FrontAxisSign', 'CoordAxis', 'CoordAxisSign', 'UnitScaleFactor', 'OriginalUnitScaleFactor'];
  P('\nGlobalSettings:');
  keys.forEach(k => {
    const p = p70 && p70.children.find(c => c.name === 'P' && clean(c.props[0]) === k);
    if (p) P('  ' + k + ' = ' + clean(p.props[4]));
  });
}

/* objects */
const rec = {};
const order = [];
objs.children.forEach(c => {
  const id = c.props[0];
  if (typeof id !== 'number') return;
  rec[id] = { id, kind: c.name, name: clean(c.props[1]).replace(/^[A-Za-z]+::/, ''), cls: clean(c.props[2]), node: c };
  order.push(rec[id]);
});

/* connections */
const cs = (conns ? conns.children : []).filter(c => c.name === 'C').map(c => ({
  type: clean(c.props[0]), child: c.props[1], parent: c.props[2], prop: clean(c.props[3])
}));
const models = order.filter(r => r.kind === 'Model');
const geoById = {}; order.filter(r => r.kind === 'Geometry').forEach(r => geoById[r.id] = r);

const parentOf = {}, childrenOf = {}, nodeAttrOf = {}, geoOf = {}, matOf = {}, skinOf = {}, clustersOf = {}, boneOfCluster = {}, attrOfModel = {};
cs.forEach(c => {
  const ch = rec[c.child], pa = rec[c.parent];
  if (!ch || !pa) return;
  if (c.type === 'OO') {
    if (ch.kind === 'Model' && pa.kind === 'Model') { parentOf[ch.id] = pa.id; (childrenOf[pa.id] = childrenOf[pa.id] || []).push(ch.id); }
    if (ch.kind === 'NodeAttribute' && pa.kind === 'Model') { nodeAttrOf[pa.id] = ch; attrOfModel[ch.id] = pa.id; }
    if (ch.kind === 'Geometry' && pa.kind === 'Model') geoOf[pa.id] = ch.id;
    if (ch.kind === 'Material' && pa.kind === 'Model') matOf[pa.id] = ch.id;
    if (ch.kind === 'Deformer' && ch.cls === 'Skin' && pa.kind === 'Geometry') skinOf[pa.id] = ch.id;
    if (ch.kind === 'Deformer' && ch.cls === 'Cluster' && pa.kind === 'Deformer') (clustersOf[pa.id] = clustersOf[pa.id] || []).push(ch.id);
    if (ch.kind === 'Model' && pa.kind === 'Deformer' && pa.cls === 'Cluster') boneOfCluster[pa.id] = ch.id;
  }
});

/* Model tree */
const roots = models.filter(m => !parentOf[m.id]);
const meshModels = models.filter(m => m.cls === 'Mesh');
const limbModels = models.filter(m => m.cls === 'LimbNode');
const nullModels = models.filter(m => m.cls === 'Null');

P('\nModel: ' + models.length + ' (Mesh ' + meshModels.length + ', LimbNode ' + limbModels.length + ', Null ' + nullModels.length + ', khác ' + (models.length - meshModels.length - limbModels.length - nullModels.length) + ')');
P('Gốc (không có parent Model): ' + roots.map(r => r.name + ' [' + r.cls + ']').join(', '));

function props70(r, key) {
  const p70 = r.node.children.find(c => c.name === 'Properties70');
  if (!p70) return null;
  const p = p70.children.find(c => c.name === 'P' && clean(c.props[0]) === key);
  return p ? [4, 5, 6].map(i => clean(p.props[i])).filter(x => x !== '').join(',') : null;
}

P('\n— cây xương (Model → Model) —');
const printTree = (id, depth) => {
  const m = rec[id];
  const attr = nodeAttrOf[id];
  const t = props70(m, 'Lcl Translation');
  const geo = geoOf[id] ? ' +Geometry' : '';
  const mat = matOf[id] ? ' +Material' : '';
  const flag = attr ? '' : '  ⚠ KHÔNG có NodeAttribute';
  if (!full && depth > 2 && m.cls === 'LimbNode' && limbModels.length > 26) return;
  P('  '.repeat(depth + 1) + (m.cls === 'LimbNode' ? '🦴 ' : '') + m.name + ' [' + m.cls + ']' +
    (t ? ' T=' + t : '') + geo + mat + (attr ? ' NA=' + attr.cls : '') + flag);
  (childrenOf[id] || []).forEach(c => printTree(c, depth + 1));
};
roots.forEach(r => printTree(r.id, 0));

/* stats / problems */
const problems = [];
const bonesWithAttr = limbModels.filter(m => nodeAttrOf[m.id]).length;
if (limbModels.length && bonesWithAttr !== limbModels.length) problems.push(bonesWithAttr + '/' + limbModels.length + ' xương có NodeAttribute');
const meshNoGeo = meshModels.filter(m => !geoOf[m.id]);
if (meshNoGeo.length) problems.push(meshNoGeo.length + ' Model::Mesh không có Geometry');

P('\n— skin / cluster —');
Object.keys(skinOf).forEach(gid => {
  const skin = skinOf[gid];
  const cls = clustersOf[skin] || [];
  let totalIdx = 0, bonesLinked = 0;
  const perBone = [];
  cls.forEach(cid => {
    const cnode = rec[cid].node;
    const idx = cnode.children.find(c => c.name === 'Indexes');
    const w = cnode.children.find(c => c.name === 'Weights');
    const n = idx ? idx.props[0].n : 0;
    totalIdx += n;
    const b = boneOfCluster[cid];
    if (b) bonesLinked++;
    perBone.push({ bone: b ? rec[b].name : '(KHÔNG nối xương)', verts: n, weights: w ? w.props[0].n : 0 });
  });
  P('  Skin cho Geometry ' + gid + ': ' + cls.length + ' cluster, ' + bonesLinked + ' cluster có nối xương, tổng ' + totalIdx + ' index');
  perBone.slice(0, full ? 200 : 6).forEach(p2 => P('    - ' + p2.bone + ': ' + p2.verts + ' đỉnh, ' + p2.weights + ' weight'));
  if (bonesLinked !== cls.length) problems.push('có ' + (cls.length - bonesLinked) + ' cluster KHÔNG nối vào xương');
});

/* bind pose */
const poses = order.filter(r => r.kind === 'Pose');
P('\n— bind pose —');
poses.forEach(p => {
  const nb = p.node.children.find(c => c.name === 'NbPoseNodes');
  const nodes = p.node.children.filter(c => c.name === 'PoseNode');
  const linked = nodes.map(n => { const nn = n.children.find(c => c.name === 'Node'); return nn ? nn.props[0] : null; }).filter(x => typeof x === 'number');
  const missing = linked.filter(id => !rec[id]);
  P('  ' + p.name + ': NbPoseNodes=' + (nb ? clean(nb.props[0]) : '?') + ', PoseNode=' + nodes.length + ', link tới object: ' + (linked.length - missing.length) + '/' + linked.length + (missing.length ? ' ⚠ ' + missing.length + ' id không tồn tại' : ''));
  if (linked.length !== limbModels.length) problems.push('PoseNode ' + linked.length + ' ≠ số xương ' + limbModels.length);
});

P('\n— kiểm tra —');
const noParentBone = limbModels.filter(m => !parentOf[m.id]);
if (noParentBone.length) P('  xương gốc: ' + noParentBone.map(m => m.name).join(', '));
P('  Cluster: ' + Object.keys(boneOfCluster).length + ' có xương / ' + order.filter(r => r.kind === 'Deformer' && r.cls === 'Cluster').length + ' tổng');
P(problems.length ? '  ⚠ VẤN ĐỀ: ' + problems.join(' | ') : '  ✓ không thấy vấn đề cấu trúc');

console.log(out.join('\n'));