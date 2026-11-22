/* tools/qa-mixamo-tex-orient.mjs — kiểm chứng CHIỀU texture khi ghi FBX từ nguồn GLB
 *
 * QUY TẮC ĐÚNG (đã đối chiếu mã three.js r128):
 *   - GLTFLoader: texture.flipY = false, UV gốc TRÊN-TRÁI  → hiển thị đúng khi ảnh top-down.
 *   - FBXLoader : texture.flipY = true (mặc định), giữ UV RAW (parseUVs không đảo),
 *                 UV gốc DƯỚI-TRÁI.
 *   Suy ra: khi ghi UV của glTF vào FBX (giữ nguyên số), ảnh PHẢI ĐƯỢC LẬT DỌC thì
 *   FBX viewer mới hiển thị giống GLB. Vậy "ảnh trong FBX = ảnh GLB lật dọc" là ĐÚNG,
 *   không phải lỗi.
 *
 *   node tools/qa-mixamo-tex-orient.mjs assets/models/x.glb out.fbx
 *
 * Kết quả mong đợi: directPct CAO (khác) và flippedPct ≈ 0 (trùng khi lật) → ĐÚNG.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

/* ── trích Video.Content đầu tiên (diffuse) từ FBX ── */
function firstVideoBytes(file) {
  const buf = fs.readFileSync(file);
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
  const objs = top.find(n => n.name === 'Objects');
  const v = objs.children.filter(c => c.name === 'Video')[0];
  const content = v.children.find(x => x.name === 'Content');
  return { bytes: content.props[0], name: String(v.props[1]).replace(/\0.*$/, '') };
}

const [glbPath, fbxPath] = process.argv.slice(2);
const vid = firstVideoBytes(fbxPath);
const b64 = Buffer.from(vid.bytes).toString('base64');
const GLB = fs.readFileSync(glbPath).toString('base64');
console.log('ảnh diffuse trong FBX:', vid.name, (vid.bytes.length / 1024).toFixed(1), 'KB');

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto((process.env.QA_BASE || 'http://127.0.0.1:8099') + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.THREE && THREE.GLTFLoader, { timeout: 90000 });

const r = await page.evaluate(async ({ GLB, texB64 }) => {
  const bin = atob(GLB); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().parse(u.buffer, '', res, rej));
  let mapImg = null, flipY = null;
  gltf.scene.traverse(o => { if (!o.isMesh) return; const m = Array.isArray(o.material) ? o.material[0] : o.material; if (m && m.map) { mapImg = m.map.image; flipY = m.map.flipY; } });
  if (!mapImg) return { error: 'GLB không có baseColor' };
  await (mapImg.decode ? mapImg.decode().catch(() => 0) : Promise.resolve());
  const cv = document.createElement('canvas'); const cx = cv.getContext('2d', { willReadFrequently: true });
  cv.width = mapImg.width; cv.height = mapImg.height; cx.drawImage(mapImg, 0, 0, cv.width, cv.height);
  const A = cx.getImageData(0, 0, cv.width, cv.height).data;

  const tb = atob(texB64); const tu = new Uint8Array(tb.length); for (let i = 0; i < tb.length; i++) tu[i] = tb.charCodeAt(i);
  const blob = new Blob([tu], { type: tu[0] === 0x89 ? 'image/png' : 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const cv2 = document.createElement('canvas'); const cx2 = cv2.getContext('2d', { willReadFrequently: true });
  cv2.width = cv2.width = img.width; cv2.height = img.height;
  if (img.width !== cv.width || img.height !== cv.height) return { error: 'kích thước ảnh khác nhau', a: [cv.width, cv.height], b: [img.width, img.height] };
  cx2.drawImage(img, 0, 0);
  const B = cx2.getImageData(0, 0, cv2.width, cv2.height).data;
  URL.revokeObjectURL(url);

  const W = cv.width, H = cv.height;
  let direct = 0, flipped = 0, n = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      const jf = ((H - 1 - y) * W + x) * 4;
      n++;
      const d1 = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      const d2 = Math.abs(A[i] - B[jf]) + Math.abs(A[i + 1] - B[jf + 1]) + Math.abs(A[i + 2] - B[jf + 2]);
      if (d1 > 36) direct++;
      if (d2 > 36) flipped++;
    }
  }
  return { size: [W, H], glbFlipY: flipY, px: n, directPct: +(direct / n * 100).toFixed(2), flippedPct: +(flipped / n * 100).toFixed(2) };
}, { GLB, texB64: b64 });

console.log(JSON.stringify(r, null, 1));
if (!r.error) {
  /* Với nguồn GLB, ĐÚNG = ảnh FBX trùng ảnh GLB khi lật dọc (flippedPct thấp),
     vì FBX dùng UV gốc dưới-trái còn glTF dùng gốc trên-trái. */
  if (r.flippedPct <= 8 && r.directPct > 30) console.log('=> ĐÚNG: ảnh trong FBX = ảnh GLB lật dọc (đúng quy tắc UV glTF→FBX) ✓');
  else if (r.directPct <= 8) console.log('=> ĐÚNG chiều khi nguồn đã là FBX (ảnh giữ nguyên) ✓');
  else console.log('=> BẤT THƯỜNG: khác cả hai chiều — cần xem lại encode (nén JPEG hay lật sai?)');
}
await browser.close();