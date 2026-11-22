/* tools/extract-rigs.mjs — trích cấu trúc xương gốc từng rig Mesh2Motion
 * Đọc assets/animations/mesh2motion/<rig>/skeleton.glb (hoặc animation đầu tiên),
 * ghi assets/animations/mesh2motion/rigs/<rig>.json:
 *   { rig, height, bones:[{name,parent,pos}], order:[...] }
 * Dùng để dựng rig đúng tỉ lệ trên nhân vật import.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const M2M = path.join(ROOT, 'assets', 'animations', 'mesh2motion');
const OUT = path.join(M2M, 'rigs');
fs.mkdirSync(OUT, { recursive: true });

function parseGLB(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const total = dv.getUint32(8, true);
  let off = 12, json = null;
  while (off < total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf.buffer, buf.byteOffset + off + 8, len)));
    off += 8 + len;
  }
  return json;
}

const catalog = JSON.parse(fs.readFileSync(path.join(M2M, 'catalog.json'), 'utf8'));
const summary = [];

for (const [rigId, rig] of Object.entries(catalog.rigs)) {
  let src = null;
  const skel = path.join(M2M, rigId, 'skeleton.glb');
  if (fs.existsSync(skel)) src = skel;
  else {
    const a = rig.animations[0];
    if (a) src = path.join(M2M, a.file.split('/').join(path.sep));
  }
  if (!src || !fs.existsSync(src)) { console.log('skip', rigId, '(no file)'); continue; }

  const j = parseGLB(fs.readFileSync(src));
  const nodes = j.nodes || [];
  const parentOf = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children || []).forEach(c => { parentOf[c] = i; }));

  const bones = [];
  const nameOf = function (i) {
    return (i >= 0 && nodes[i] && nodes[i].name) ? nodes[i].name : null;
  };
  /* Parent = tổ tiên CÓ TÊN gần nhất (bỏ qua node không tên / Armature).
     Nếu giữ nguyên parent là Armature thì builder coi là root → toàn bộ rig bị
     gắn phẳng vào group, xoay bone không kéo theo chuỗi → animation đứng yên. */
  const namedParentOf = function (i) {
    let p = parentOf[i];
    let guard = 0;
    while (p >= 0 && guard++ < 64) {
      const nm = nameOf(p);
      if (nm && !/^Armature$/i.test(nm)) return nm;
      p = parentOf[p];
    }
    return null;
  };

  nodes.forEach((n, i) => {
    if (!n.name) return;
    if (/^Armature$/i.test(n.name)) return;
    bones.push({
      name: n.name,
      parent: namedParentOf(i),
      pos: (n.translation || [0, 0, 0]).map(v => +v.toFixed(6))
    });
  });

  /* chiều cao xương = tổng dọc trục dài nhất của chuỗi (ước lượng từ rest local) */
  let maxY = 0, minY = 0, maxX = 0, maxZ = 0;
  const world = {};
  const compute = (b) => {
    if (world[b.name]) return world[b.name];
    const p = b.parent ? (bones.find(x => x.name === b.parent)) : null;
    const base = p ? compute(p) : [0, 0, 0];
    const w = [base[0] + b.pos[0], base[1] + b.pos[1], base[2] + b.pos[2]];
    world[b.name] = w;
    maxY = Math.max(maxY, w[1]); minY = Math.min(minY, w[1]);
    maxX = Math.max(maxX, Math.abs(w[0])); maxZ = Math.max(maxZ, Math.abs(w[2]));
    return w;
  };
  bones.forEach(compute);

  const out = {
    rig: rigId,
    source: path.relative(ROOT, src).split(path.sep).join('/'),
    count: bones.length,
    height: +(maxY - minY).toFixed(4),
    spread: { x: +(maxX * 2).toFixed(4), z: +(maxZ * 2).toFixed(4) },
    bones
  };
  fs.writeFileSync(path.join(OUT, rigId + '.json'), JSON.stringify(out));
  summary.push(rigId + ':' + bones.length + ' bones, h=' + out.height + ' spread=' + out.spread.x + 'x' + out.spread.z);
}

console.log('rigs extracted:');
summary.forEach(s => console.log('  ' + s));
