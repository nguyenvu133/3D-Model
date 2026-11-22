/* tools/fbx-ascii-analyze.mjs — phân tích file FBX ASCII (không cần three.js)
 *
 * Đọc cấu trúc text của FBX ASCII: header, GlobalSettings, Definitions,
 * Objects (Geometry/Model/NodeAttribute/Material/Deformer/Pose/Animation*),
 * Connections và đưa ra kết luận "file này có đúng dạng Mixamo nhận không".
 *
 *   node tools/fbx-ascii-analyze.mjs "X Bot.fbx"
 */
import fs from 'node:fs';

/* ---------- parser ASCII FBX ---------- */
function parseAscii(text) {
  const lines = text.split(/\r?\n/);
  const root = { name: 'ROOT', props: [], children: [], depth: -1 };
  let stack = [root];
  let pending = null;   // { name, props } chờ gặp '{'
  let depth = 0;
  const flat = [];

  const splitProps = (s) => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"') { inQ = !inQ; cur += ch; continue; }
      if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim() !== '') out.push(cur.trim());
    return out.map(p => p.replace(/^"(.*)"$/, '$1'));
  };

  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith(';')) return;
    if (line === '}') { if (stack.length > 1) stack.pop(); depth--; pending = null; return; }

    const ci = line.indexOf(':');
    if (ci < 0) return;
    const name = line.slice(0, ci).trim();
    let rest = line.slice(ci + 1).trim();
    const opens = /\{$/.test(rest);
    if (opens) rest = rest.replace(/\{$/, '').trim();

    /* mảng: Name: *count { a: v1,v2,... } */
    let arrCount = null, values = null;
    if (/^\*\d+$/.test(rest)) arrCount = parseInt(rest.slice(1), 10);
    else if (rest.length && rest !== '{') values = splitProps(rest);

    const node = { name, props: values || [], arrCount, depth, children: [] };
    flat.push(node);

    if (opens) {
      node.children = [];
      node.props = values || [];
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      depth++;
      pending = null;
    } else if (arrCount !== null) {
      /* node mảng: dòng "a: ..." theo sau thuộc node này */
      stack[stack.length - 1].children.push(node);
      pending = node;   // các dòng 'a:' sau sẽ gộp vào
    } else {
      pending = node;
      /* nếu dòng trước chưa đóng dấu "{" mà cùng tên → bỏ qua */
      stack[stack.length - 1].children.push(node);
    }
  });
  return { root, flat };
}

/* Gộp giá trị của node mảng (các dòng 'a: ...' được coi là con) */
function arrayValues(node) {
  const out = [];
  node.children.forEach((c) => { if (c.name === 'a') out.push(...c.props); });
  if (!out.length && node.props.length) out.push(...node.props);
  return out;
}

const file = process.argv[2];
if (!file) { console.error('thiếu file'); process.exit(2); }
const text = fs.readFileSync(file, 'utf8');
const isAscii = text.startsWith('; FBX') || /^\s*FBXHeaderExtension:/m.test(text.slice(0, 4096));
const { flat } = parseAscii(text);
const byName = (n) => flat.filter(x => x.name === n);

const pick1 = (n) => { const a = byName(n); return a.length ? (a[0].props[0] !== undefined ? a[0] : null) : null; };
const out = [];
const P = (s) => out.push(s);

P('=== ' + file + ' (' + (fs.statSync(file).size / 1048576).toFixed(2) + ' MB) ===');
P('ĐỊNH DẠNG: ' + (isAscii ? 'FBX ASCII (text)' : 'FBX Binary'));
P('Dòng đầu: ' + text.split(/\r?\n/)[0]);

const ver = pick1('FBXVersion');
P('FBXVersion: ' + (ver ? ver.props[0] : '?') + (ver && +ver.props[0] === 7400 ? '  (FBX 2013)' : ''));
const creator = pick1('Creator');
P('Creator: ' + (creator ? creator.props[0] : '?'));

/* GlobalSettings */
const gs = byName('GlobalSettings')[0];
if (gs) {
  const gsP = gs.children.filter(c => c.name === 'P');
  const want = ['UpAxis', 'UpAxisSign', 'FrontAxis', 'FrontAxisSign', 'CoordAxis', 'CoordAxisSign', 'UnitScaleFactor', 'OriginalUnitScaleFactor', 'TimeMode', 'TimeSpanStart', 'TimeSpanStop'];
  P('\nGlobalSettings:');
  gsP.forEach(p => { if (want.includes(p.props[0])) P('  ' + p.props[0] + ' = ' + p.props.slice(4).join(', ')); });
}

/* Definitions */
const defs = byName('Definitions')[0];
if (defs) {
  P('\nDefinitions (số lượng khai báo):');
  defs.children.filter(c => c.name === 'ObjectType').forEach(ot => {
    const cnt = ot.children.find(c => c.name === 'Count');
    P('  ' + ot.props[0] + ': ' + (cnt ? cnt.props[0] : '?'));
  });
}

/* Objects */
const objs = byName('Objects')[0];
if (objs) {
  const groups = {};
  objs.children.forEach(c => { (groups[c.name] = groups[c.name] || []).push(c); });
  P('\nObjects:');
  Object.keys(groups).forEach(k => P('  ' + k + ': ' + groups[k].length));

  /* Geometry */
  (groups.Geometry || []).forEach((g, i) => {
    const verts = g.children.find(c => c.name === 'Vertices');
    const pvi = g.children.find(c => c.name === 'PolygonVertexIndex');
    const uv = g.children.find(c => c.name === 'LayerElementUV');
    const nor = g.children.find(c => c.name === 'LayerElementNormal');
    const mat = g.children.find(c => c.name === 'LayerElementMaterial');
    const vCount = verts ? verts.arrCount / 3 : 0;
    const idx = pvi ? pvi.arrCount : 0;
    const uvArr = uv ? uv.children.find(c => c.name === 'UV') : null;
    const norArr = nor ? nor.children.find(c => c.name === 'Normals') : null;
    P(`  Geometry[${i}] ${g.props[1] || ''}: ${vCount} đỉnh, ${idx} polygon-vertex (≈${Math.round(idx / 3)} tam giác)` +
      `, UV ${uvArr ? uvArr.arrCount / 2 + ' cặp' : 'KHÔNG'}, normal ${norArr ? norArr.arrCount / 3 : 'KHÔNG'}` +
      `, LayerElementMaterial ${mat ? 'có (' + (mat.children.find(c => c.name === 'Materials') || {}).arrCount + ' material)' : 'không'}`);
    if (uv) {
      const mi = uv.children.find(c => c.name === 'MappingInformationType');
      const ri = uv.children.find(c => c.name === 'ReferenceInformationType');
      P('       UV mapping=' + (mi ? mi.props[0] : '?') + ' reference=' + (ri ? ri.props[0] : '?'));
    }
  });

  /* Model + NodeAttribute */
  const models = groups.Model || [];
  const bones = models.filter(m => m.props[2] === 'LimbNode');
  const meshes = models.filter(m => m.props[2] === 'Mesh');
  const nulls = models.filter(m => m.props[2] === 'Null');
  P(`\n  Model: tổng ${models.length} = Mesh ${meshes.length} + LimbNode ${bones.length} + Null ${nulls.length} + khác ${models.length - meshes.length - bones.length - nulls.length}`);
  P('  Model::Mesh  ' + meshes.map(m => m.props[1]).join(', '));
  if (bones.length) {
    const nm = bones.map(b => String(b.props[1]).replace(/^Model::/, ''));
    P('  Bone đầu: ' + nm.slice(0, 8).join(', '));
    P('  Prefix bone: ' + (/^([a-zA-Z0-9_]+):/.exec(nm[0]) ? RegExp.$1 : '(không có prefix)'));
    P('  Có mixamorig: ' + (nm.some(x => /mixamorig/i.test(x)) ? 'CÓ' : 'không'));
  }
  const nas = groups.NodeAttribute || [];
  const naTypes = {};
  nas.forEach(n => { const t = n.children.find(c => c.name === 'TypeFlags'); const k = t ? t.props[0] : '?'; naTypes[k] = (naTypes[k] || 0) + 1; });
  P('  NodeAttribute TypeFlags: ' + JSON.stringify(naTypes));

  /* Material */
  (groups.Material || []).forEach((m, i) => {
    const props70 = m.children.find(c => c.name === 'Properties70');
    const get = (key) => {
      const p = props70 && props70.children.find(c => c.name === 'P' && c.props[0] === key);
      return p ? p.props.slice(4).join(', ') : null;
    };
    P(`  Material[${i}] ${m.props[1]}: ShadingModel=${get('ShadingModel')} Diffuse=${get('DiffuseColor')} Emissive=${get('EmissiveColor')}`);
  });

  /* Deformer */
  const defs2 = groups.Deformer || [];
  const skin = defs2.filter(d => d.props[2] === 'Skin');
  const clusters = defs2.filter(d => d.props[2] === 'Cluster');
  P(`  Deformer: Skin ${skin.length} + Cluster ${clusters.length}`);
  if (clusters.length) {
    const idx = clusters[0].children.find(c => c.name === 'Indexes');
    P('       cluster[0] có ' + (idx ? idx.arrCount : 0) + ' index ảnh hưởng');
  }

  /* Pose */
  const poses = groups.Pose || [];
  poses.forEach(p => {
    const n = p.children.find(c => c.name === 'NbPoseNodes');
    P('  Pose ' + p.props[1] + ': ' + (n ? n.props[0] : '?') + ' node');
  });

  /* Animation */
  const stacks = groups.AnimationStack || [];
  const layers = groups.AnimationLayer || [];
  const cns = groups.AnimationCurveNode || [];
  const curves = groups.AnimationCurve || [];
  P(`  Animation: Stack ${stacks.length}, Layer ${layers.length}, CurveNode ${cns.length}, Curve ${curves.length}`);
  stacks.forEach(s => {
    const l = s.children.find(c => c.name === 'LocalStop');
    const len = s.children.find(c => c.name === 'LocalStart');
    P('       ' + s.props[1] + (l ? '  ' + (len ? len.props[0] : 0) + ' → ' + l.props[0] : ''));
  });
  if (curves.length) {
    const k = curves[0].children.find(c => c.name === 'KeyTime');
    P('       curve[0] ' + curves[0].props[1] + ' có ' + (k ? k.arrCount : 0) + ' key');
  }

  /* Texture / Video */
  P('  Texture: ' + ((groups.Texture || []).length) + ' | Video: ' + ((groups.Video || []).length) +
    '  → ' + (((groups.Texture || []).length || (groups.Video || []).length) ? 'CÓ ảnh' : 'KHÔNG có ảnh (model sẽ không có màu)'));
}

/* Connections tóm tắt */
const conns = byName('Connections')[0];
if (conns) {
  const cs = conns.children.filter(c => c.name === 'C');
  const kinds = {};
  cs.forEach(c => { kinds[c.props[0]] = (kinds[c.props[0]] || 0) + 1; });
  P('\nConnections: ' + cs.length + ' ' + JSON.stringify(kinds));
  const idToName = {};
  flat.filter(x => ['Geometry', 'Model', 'Material', 'Deformer', 'NodeAttribute', 'AnimationStack', 'AnimationLayer', 'AnimationCurveNode', 'Pose', 'Texture'].includes(x.name))
    .forEach(x => { idToName[x.props[0]] = x.name + '::' + String(x.props[1] || ''); });
  const shown = cs.filter(c => /Geometry|Material|Deformer|Skin|Pose|AnimStack/.test(String(idToName[c.props[1]] || '') + String(idToName[c.props[2]] || ''))).slice(0, 14);
  shown.forEach(c => P('  ' + c.props[0] + ': ' + (idToName[c.props[1]] || c.props[1]) + '  ->  ' + (idToName[c.props[2]] || c.props[2]) + (c.props[3] !== undefined ? '  [' + c.props[3] + ']' : '')));
  /* mẫu quan hệ Model→Model (xương) */
  const mm = cs.filter(c => c.props[0] === 'OO' && String(idToName[c.props[1]] || '').startsWith('Model') && String(idToName[c.props[2]] || '').startsWith('Model')).slice(0, 5);
  P('  Model→Model (xương) mẫu: ' + mm.map(c => (idToName[c.props[1]] || '?').replace('Model::', '') + '→' + (idToName[c.props[2]] || '?').replace('Model::', '')).join(', '));
}

console.log(out.join('\n'));