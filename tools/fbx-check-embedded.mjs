/* tools/fbx-check-embedded.mjs — xác nhận Video.Content trong FBX đúng là ảnh thật
 * (đọc magic bytes + kích thước, so với file nguồn nếu có)
 *   node tools/fbx-check-embedded.mjs out.fbx [nguồn.fbx]
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
    return { v: { n, enc }, next: p + 13 + (enc === 0 ? SZ[t] * n : clen) };
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
const magic = b => (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ? 'PNG'
  : (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) ? 'JPEG'
    : (b.length > 2 && b[0] === 0x42 && b[1] === 0x4d) ? 'BMP' : 'unknown(' + b.slice(0, 4).toString('hex') + ')';
const dims = b => {
  if (magic(b) === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (magic(b) === 'JPEG') { let i = 2; while (i < b.length - 9) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + b.readUInt16BE(i + 2); } }
  return [0, 0];
};

function listVideos(file) {
  const buf = fs.readFileSync(file);
  const top = parse(buf);
  const objs = top.find(n => n.name === 'Objects');
  const out = [];
  objs.children.filter(c => c.name === 'Video').forEach(c => {
    const content = c.children.find(x => x.name === 'Content');
    const raw = content && content.props[0];
    if (!raw || raw.length === undefined) { out.push({ name: c.props[1], bytes: 0 }); return; }
    const d = dims(raw);
    out.push({ name: String(c.props[1]).replace(/\0.*$/, ''), bytes: raw.length, type: magic(raw), w: d[0], h: d[1] });
  });
  return { file, videos: out };
}

const A = listVideos(process.argv[2]);
console.log('=== ' + A.file);
A.videos.forEach(v => console.log(`  ${v.name}  ${v.type} ${v.w}x${v.h}  ${(v.bytes / 1024).toFixed(1)} KB`));
if (process.argv[3] && fs.existsSync(process.argv[3])) {
  const B = listVideos(process.argv[3]);
  console.log('=== ' + B.file + ' (nguồn)');
  B.videos.forEach(v => console.log(`  ${v.name}  ${v.type} ${v.w}x${v.h}  ${(v.bytes / 1024).toFixed(1)} KB`));
  const dA = A.videos.filter(v => v.type !== 'unknown').length, dB = B.videos.filter(v => v.type !== 'unknown').length;
  const bytesA = A.videos.reduce((s, v) => s + v.bytes, 0), bytesB = B.videos.reduce((s, v) => s + v.bytes, 0);
  console.log(`\nảnh hợp lệ: ${dA}/${A.videos.length}  |  tổng bytes ảnh: ${(bytesA / 1024).toFixed(1)} KB vs nguồn ${(bytesB / 1024).toFixed(1)} KB  |  khớp byte: ${bytesA === bytesB ? 'CÓ ✓' : 'khác'}`);
}