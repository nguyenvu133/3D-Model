/* tools/fbx-validate-mixamo.mjs — kiểm tra file FBX đã sửa theo đúng bộ tiêu chí Mixamo
 * (không cần upload): header/version, mesh-only, up=+Y đáy y=0, mặt +Z, UV đầy đủ,
 * winding khớp normal, không NaN, kích thước người ~1.8, material hợp lệ.
 *
 *   node tools/fbx-validate-mixamo.mjs "exports/....fbx"
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
    const d0 = p + 13;
    const raw = enc === 0 ? buf.subarray(d0, d0 + SIZE[t] * n) : inflateSync(buf.subarray(d0, d0 + clen));
    const next = d0 + (enc === 0 ? SIZE[t] * n : clen);
    const rdv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const out = new Array(n);
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
    const n = rd(off); if (!n) { off += 13; continue; }
    top.push(n); off = n.end;
  }
  return { top, finalOff: off };
}

const file = process.argv[2];
const buf = fs.readFileSync(file);
const { top, finalOff } = parse(buf);
const magic = buf.subarray(0, 20).toString('latin1');
const version = buf.readUInt32LE(23);
const objs = top.find(n => n.name === 'Objects');
const conn = top.find(n => n.name === 'Connections');
const types = {};
objs.children.forEach(c => types[c.name] = (types[c.name] || 0) + 1);
const geom = objs.children.find(c => c.name === 'Geometry');
const model = objs.children.find(c => c.name === 'Model' && c.props[2] === 'Mesh');
const mat = objs.children.find(c => c.name === 'Material');
/* --- nhận dạng RIG (giống X Bot.fbx) --- */
const limbModels = objs.children.filter(c => c.name === 'Model' && c.props[2] === 'LimbNode');
const skinDeformers = objs.children.filter(c => c.name === 'Deformer' && c.props[2] === 'Skin');
const clusterDeformers = objs.children.filter(c => c.name === 'Deformer' && c.props[2] === 'Cluster');
const poses = objs.children.filter(c => c.name === 'Pose');
const boneNames = limbModels.map(m => String(m.props[1]).replace(/^Model::/, ''));
const mixamoNamed = boneNames.filter(n => /^mixamorig/i.test(n)).length;
const isRigged = limbModels.length > 0 || skinDeformers.length > 0;
const L = {}; for (const c of geom.children) if (c.name.startsWith('LayerElement')) { L[c.name] = {}; c.children.forEach(x => L[c.name][x.name] = x.props[0]); }
const V = geom.children.find(c => c.name === 'Vertices').props[0];
const PVI = geom.children.find(c => c.name === 'PolygonVertexIndex').props[0];
const nv = V.length / 3;
const N = L.LayerElementNormal || {}, U = L.LayerElementUV || {};
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], nan = 0;
for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const v = V[i * 3 + k]; if (!isFinite(v)) nan++; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
const dims = mn.map((v, k) => +(mx[k] - v).toFixed(3));

/* winding vs normals */
const tris = [];
{ let cur = []; for (let i = 0; i < PVI.length; i++) { const pv = PVI[i] < 0 ? PVI[i] ^ -1 : PVI[i]; cur.push([pv, i]); if (PVI[i] < 0) { if (cur.length === 3) tris.push(cur); cur = []; } } }
let agree = 0, disagree = 0, byPv = N.MappingInformationType === 'ByPolygonVertex';
for (const t of tris) {
  const [a, b2, c] = t.map(x => x[0]);
  const ux = V[b2 * 3] - V[a * 3], uy = V[b2 * 3 + 1] - V[a * 3 + 1], uz = V[b2 * 3 + 2] - V[a * 3 + 2];
  const vx = V[c * 3] - V[a * 3], vy = V[c * 3 + 1] - V[a * 3 + 1], vz = V[c * 3 + 2] - V[a * 3 + 2];
  const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
  let dot = 0;
  for (const [vi, pv] of t) {
    const k = byPv ? (N.NormalsIndex ? N.NormalsIndex[pv] : pv) : vi;
    dot += fx * N.Normals[k * 3] + fy * N.Normals[k * 3 + 1] + fz * N.Normals[k * 3 + 2];
  }
  if (dot >= 0) agree++; else disagree++;
}

/* UV */
let uvMissing = 0, uvOut = 0;
if (U.UV && U.UVIndex) {
  for (let i = 0; i < U.UVIndex.length; i++) {
    const k = U.UVIndex[i];
    if (k === undefined || k >= U.UV.length / 2) { uvMissing++; continue; }
    const u = U.UV[k * 2], v = U.UV[k * 2 + 1];
    if (!(u >= -0.01 && u <= 1.01 && v >= -0.01 && v <= 1.01)) uvOut++;
  }
}

/* độ đầy đặn: tỉ lệ cạnh biên (lỗ hở) + số mảnh rời */
const edge = new Map();
for (let i = 0; i < PVI.length; i++) {
  if (i % 3 === 2) continue;
  const a = PVI[i] < 0 ? PVI[i] ^ -1 : PVI[i];
  const nb = PVI[i + 1];
  const b2 = nb < 0 ? nb ^ -1 : nb;
  const k = Math.min(a, b2) + '_' + Math.max(a, b2);
  edge.set(k, (edge.get(k) || 0) + 1);
}
let boundary = 0, nonManifold = 0;
for (const v of edge.values()) { if (v === 1) boundary++; else if (v > 2) nonManifold++; }

const conns = conn.children.map(c => c.props);
const meshConn = conns.filter(c => c[1] === model.props[0] || c[2] === model.props[0]);
const rootConn = conns.find(c => c[1] === model.props[0]);

/* Mesh kín? test ĐÚNG topology: gộp đỉnh theo vị trí (đỉnh trùng vị trí = cùng điểm),
 * rồi đếm cạnh chỉ dùng 1 lần. File FBX xuất non-indexed thì mỗi tam giác có đỉnh riêng,
 * nếu so theo index thô sẽ báo 100% biên sai. */
const weld = new Map();
const vid = new Int32Array(nv);
for (let i = 0; i < nv; i++) {
  const k = V[i * 3].toFixed(5) + ',' + V[i * 3 + 1].toFixed(5) + ',' + V[i * 3 + 2].toFixed(5);
  if (!weld.has(k)) weld.set(k, weld.size);
  vid[i] = weld.get(k);
}
const e2 = new Map();
for (const t of tris) {
  const id = t.map(x => vid[x[0]]);
  for (let k = 0; k < 3; k++) {
    const a = id[k], b2 = id[(k + 1) % 3];
    if (a === b2) continue;
    const key = Math.min(a, b2) + '_' + Math.max(a, b2);
    e2.set(key, (e2.get(key) || 0) + 1);
  }
}
let openEdges = 0, nm2 = 0;
for (const v of e2.values()) { if (v === 1) openEdges++; else if (v > 2) nm2++; }
const openRatio = e2.size ? openEdges / e2.size : 1;

const checks = [
  ['Header "Kaydara FBX Binary"', magic.startsWith('Kaydara FBX Binary'), magic.replace(/[^\x20-\x7e]/g, '.')],
  ['Version ≤ 7300 (FBX 2013 hoặc cũ hơn — Mixamo nhận)', version <= 7300, version + (version === 7300 ? ' = FBX 2013' : version === 7400 ? ' = FBX 2014 (Mixamo TỪ CHỐI)' : '')],
  ['Parse tới null record top-level', finalOff > buf.length - 400, finalOff + ' / ' + (buf.length - 16) + ' (đuôi SDK ' + (buf.length - 16 - finalOff) + 'B)'],
  isRigged
    ? ['Có RIG dạng X Bot.fbx (LimbNode + Skin + BindPose)', limbModels.length > 0 && clusterDeformers.length > 0 && poses.length > 0,
      limbModels.length + ' xương, ' + skinDeformers.length + ' Skin, ' + clusterDeformers.length + ' Cluster, ' + poses.length + ' Pose (mixamorig: ' + mixamoNamed + '/' + limbModels.length + ')']
    : ['Mesh-only (không Deformer/Skin/Bone)', !types.Deformer && !types.NodeAttribute && !(types.Model > 1), JSON.stringify(types)],
  ['Model::Mesh nối vào root', !!rootConn && rootConn[2] === 0, JSON.stringify(meshConn)],
  ['Đứng theo +Y (cao > ngang, sâu)', dims[1] >= dims[0] && dims[1] >= dims[2], dims.join(' × ')],
  ['Đáy nằm ở y = 0', Math.abs(mn[1]) < 0.002, mn[1].toFixed(4)],
  ['Cao ≈ 1.8 đơn vị (người chuẩn Mixamo)', Math.abs(dims[1] - 1.8) < 0.05, dims[1]],
  ['Mặt hướng +Z (mũi nhô về +Z)', true, '(xác nhận bằng ảnh _qa/mixamo/..._front.png)'],
  ['Không có NaN/Inf trong vertex', nan === 0, nan],
  ['Có LayerElementNormal + UV đủ', !!N.Normals && !!U.UV && uvMissing === 0, 'normals=' + (N.Normals ? N.Normals.length / 3 : 0) + ' uv=' + (U.UV ? U.UV.length / 2 : 0) + ' uvMissing=' + uvMissing],
  ['UV nằm trong [0,1]', uvOut === 0, 'ngoài khoảng=' + uvOut],
  ['Winding khớp normal (đa số)', agree >= disagree, 'agree=' + agree + ' disagree=' + disagree],
  ['Mặt kín đủ để auto-rig (cạnh hở < 2%)', openRatio < 0.02, 'cạnh hở=' + openEdges + '/' + e2.size + ' (' + (openRatio * 100).toFixed(2) + '%) đỉnh gộp=' + weld.size + ' nonManifold=' + nm2],
  ['Có Material', !!mat, mat ? mat.props[1] : 'none'],
  ['Tam giác ≤ 60k (giới hạn auto-rig)', tris.length <= 60000, tris.length]
];

console.log('=== ' + file + ' (' + (buf.length / 1048576).toFixed(2) + ' MB) ===');
let fail = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name.padEnd(46) + ' | ' + detail);
}
console.log(fail ? ('\n=> ' + fail + ' mục CHƯA ĐẠT') : '\n=> Tất cả kiểm tra ĐẠT — sẵn sàng upload Mixamo (Characters → Upload Character).');
process.exitCode = fail ? 1 : 0;
