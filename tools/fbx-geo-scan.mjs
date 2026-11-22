/* tools/fbx-geo-scan.mjs — in header props của mọi node trong Geometry để debug parse */
import fs from 'node:fs';
const file = process.argv[2];
const buf = fs.readFileSync(file);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

function walk(start, end, depth, path) {
  let off = start;
  while (off < end) {
    const nend = dv.getUint32(off, true), nprops = dv.getUint32(off + 4, true), plen = dv.getUint32(off + 8, true), nlen = buf[off + 12];
    if (nend === 0 && nprops === 0 && plen === 0 && nlen === 0) { off += 13; continue; }
    const name = buf.subarray(off + 13, off + 13 + nlen).toString('utf8');
    const p = off + 13 + nlen;
    let info = '';
    for (let i = 0; i < nprops; i++) {
      const t = String.fromCharCode(buf[p]);
      if (t === 'Y' || t === 'C' || t === 'I' || t === 'F' || t === 'D' || t === 'L' || t === 'S' || t === 'R') { info += t + ' '; break; }
      if ('fdlibc'.indexOf(t) >= 0) {
        const n = dv.getUint32(p + 1, true), enc = dv.getUint32(p + 5, true), clen = dv.getUint32(p + 9, true);
        info += t + '(' + n + ',enc' + enc + ',clen' + clen + ') '; break;
      }
      info += '?(' + JSON.stringify(t) + ') ';
      break;
    }
    console.log('  '.repeat(depth) + name + ' [' + off + '..' + nend + '] nprops=' + nprops + ' plen=' + plen + ' ' + info);
    if (nend > end) { console.log('  BAD END'); return; }
    if (depth < 3) walk(p + plen, nend, depth + 1, path + '/' + name);
    off = nend;
  }
}

/* tìm node Geometry cấp 1: quét tuyến tính các node top-level */
let off = 27;
const topNodes = [];
while (off < buf.length - 16) {
  const nend = dv.getUint32(off, true), nprops = dv.getUint32(off + 4, true), plen = dv.getUint32(off + 8, true), nlen = buf[off + 12];
  if (nend === 0) { off += 13; continue; }
  const name = buf.subarray(off + 13, off + 13 + nlen).toString('utf8');
  topNodes.push({ name, off, nend, nprops, plen });
  off = nend;
}
const objs = topNodes.find(n => n.name === 'Objects');
console.log('top:', topNodes.map(n => n.name + '@' + n.off).join(', '));
walk(objs.off + 13 + 'Objects'.length + objs.plen, objs.nend, 1);
