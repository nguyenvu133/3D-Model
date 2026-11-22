/* tools/xbot-extract-skeleton.mjs — trích KHUNG XƯƠNG CHUẨN MIXAMO từ "X Bot.fbx" (ASCII)
 * Xuất JSON: { bones:[{name, parent, pos:[x,y,z]}], heightRaw } — pos chuẩn hoá:
 * gốc tại Hips, đơn vị = 1 chiều cao nhân vật.
 *
 *   node tools/xbot-extract-skeleton.mjs "X Bot.fbx" [out.json]
 */
import fs from 'node:fs';

/* ---- parser ASCII FBX (giống tools/fbx-ascii-analyze.mjs) ---- */
function parseAscii(text) {
  const lines = text.split(/\r?\n/);
  const root = { name: 'ROOT', props: [], children: [] };
  const stack = [root];
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
    if (line === '}') { if (stack.length > 1) stack.pop(); return; }
    const ci = line.indexOf(':');
    if (ci < 0) return;
    const name = line.slice(0, ci).trim();
    let rest = line.slice(ci + 1).trim();
    const opens = /\{$/.test(rest);
    if (opens) rest = rest.replace(/\{$/, '').trim();
    let arrCount = null, props = [];
    if (/^\*\d+$/.test(rest)) arrCount = parseInt(rest.slice(1), 10);
    else if (rest.length) props = splitProps(rest);
    const node = { name, props, arrCount, children: [] };
    flat.push(node);
    if (opens) { stack[stack.length - 1].children.push(node); stack.push(node); }
    else { stack[stack.length - 1].children.push(node); }
  });
  return { root, flat };
}
const arrVals = (node) => {
  if (!node) return [];
  const a = node.children.find(c => c.name === 'a');
  const src = a ? a.props : node.props;
  return src.map(v => parseFloat(v)).filter(v => !isNaN(v));
};

const file = process.argv[2] || 'X Bot.fbx';
const outFile = process.argv[3] || 'js/rigging/mixamo-skeleton.json';
const { flat } = parseAscii(fs.readFileSync(file, 'utf8'));

/* Model: props = [id, "Model::name", "LimbNode"] */
const models = flat.filter(n => n.name === 'Model');
const nameOf = {}, clsOf = {};
models.forEach(m => {
  const id = parseInt(m.props[0], 10);
  if (!nameOf[id]) {
    nameOf[id] = String(m.props[1] || '').replace(/^Model::/, '');
    clsOf[id] = String(m.props[2] || '');
  }
});

/* Pose → PoseNode { Node: id, Matrix: *16 }  (ma trận bind = world) */
const world = {};
flat.filter(n => n.name === 'Pose').forEach(p => {
  p.children.filter(c => c.name === 'PoseNode').forEach(pn => {
    const n = pn.children.find(c => c.name === 'Node');
    const mt = pn.children.find(c => c.name === 'Matrix');
    if (!n || !mt) return;
    const id = parseInt(n.props[0], 10);
    const a = arrVals(mt);
    if (a.length >= 16 && nameOf[id]) world[nameOf[id]] = [a[12], a[13], a[14]];
  });
});

/* Connections: C: "OO", child, parent */
const parentOf = {};
flat.filter(n => n.name === 'Connections').forEach(cb => {
  cb.children.filter(c => c.name === 'C').forEach(c => {
    if (String(c.props[0]) !== 'OO') return;
    const child = parseInt(c.props[1], 10), parent = parseInt(c.props[2], 10);
    if (nameOf[child] && nameOf[parent]) parentOf[nameOf[child]] = nameOf[parent];
  });
});

const limb = Object.keys(nameOf).filter(id => clsOf[id] === 'LimbNode').map(id => nameOf[id]);
const uniq = [...new Set(limb)];
const bones = uniq.map(n => ({ name: n, parent: parentOf[n] || null, world: world[n] || null }));

const withPos = bones.filter(b => b.world);
if (!withPos.length) { console.error('KHÔNG đọc được toạ độ — dừng'); process.exit(1); }
const ys = withPos.map(b => b.world[1]);
const heightRaw = Math.max(...ys) - Math.min(...ys);
const hips = bones.find(b => /Hips$/.test(b.name));
const origin = hips && hips.world ? hips.world : [0, Math.min(...ys), 0];

const out = {
  source: file,
  count: bones.length,
  heightRaw: +heightRaw.toFixed(4),
  bones: bones.map(b => ({
    name: b.name.replace(/^mixamorig:?/, ''),
    parent: b.parent ? b.parent.replace(/^mixamorig:?/, '') : null,
    pos: b.world ? [
      +((b.world[0] - origin[0]) / heightRaw).toFixed(5),
      +((b.world[1] - origin[1]) / heightRaw).toFixed(5),
      +((b.world[2] - origin[2]) / heightRaw).toFixed(5)
    ] : null
  }))
};
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));

console.log('xương:', bones.length, '| có toạ độ:', withPos.length, '| heightRaw:', out.heightRaw);
console.log('không toạ độ:', bones.filter(b => !b.world).map(b => b.name).join(', ') || '(không)');
console.log('không rõ parent (gốc):', bones.filter(b => !b.parent).map(b => b.name).join(', '));
console.log('đã ghi', outFile);
console.log('\n6 xương đầu:');
bones.slice(0, 6).forEach(b => console.log('  ' + b.name + (b.parent ? '  ← ' + b.parent : '  (root)') +
  (b.world ? '  world=' + b.world.map(v => v.toFixed(3)).join(',') : '')));