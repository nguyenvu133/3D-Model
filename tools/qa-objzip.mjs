/* tools/qa-objzip.mjs — kiểm thử THẬT nút "Save OBJ ZIP"
 * 1) nạp model (GLB nguồn Meshy/Tripo) vào State.selection
 * 2) bấm #btn-save-objzip, bắt file ZIP tải về
 * 3) giải nén bằng Node: kiểm tra .obj / .mtl / ảnh, magic bytes ảnh, map_Kd
 * 4) dựng lại trong trình duyệt bằng OBJLoader + MTLLoader (từ chính file trong ZIP)
 *    rồi so màu với ảnh baseColor của GLB → chứng minh OBJ "có màu" và KHÔNG lộn chiều
 *
 *   node tools/qa-objzip.mjs [assets/models/tripo_convert_monter1.glb]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const glb = process.argv[2] || 'assets/models/tripo_convert_monter1.glb';
const outDir = path.join('_qa', 'dl-objzip');
fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto((process.env.QA_BASE || 'http://127.0.0.1:8099') + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.SaveManager && window.THREE && THREE.GLTFLoader, { timeout: 90000 });

/* nút tồn tại? */
console.log('nút:', JSON.stringify(await page.evaluate(() => {
  const b = document.getElementById('btn-save-objzip');
  const f = (PixiStudio.SaveManager.FORMATS || []).find(x => x.id === 'obj-color');
  return { exists: !!b, label: b ? (b.textContent || '').trim() : null, format: f ? f.name : null };
})));

/* đợi app load xong model mẫu để KHÔNG bị ghi đè selection giữa chừng */
await page.waitForTimeout(2500);

/* nạp model + chờ texture decode */
const info = await page.evaluate(async (url) => {
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(url, res, undefined, rej));
  const root = gltf.scene; root.name = 'monter1_glb'; root.updateMatrixWorld(true);
  const imgs = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    ['map', 'normalMap', 'roughnessMap', 'metalnessMap'].forEach(s => {
      const t = m && m[s]; if (t && t.image && !imgs.includes(t.image)) imgs.push(t.image);
    });
  });
  await Promise.race([
    Promise.all(imgs.map(im => im.decode ? im.decode().catch(() => 0) : 1)),
    new Promise(r => setTimeout(r, 5000))
  ]);
  PixiStudio.State.set('selection', root);
  const m0 = (function () { let r = null; root.traverse(o => { if (!r && o.isMesh) r = Array.isArray(o.material) ? o.material[0] : o.material; }); return r; })();
  return {
    meshes: (function () { let n = 0; root.traverse(o => { if (o.isMesh) n++; }); return n; })(),
    mapReady: !!(m0 && m0.map && m0.map.image && m0.map.image.width > 0),
    mapFlipY: m0 && m0.map ? m0.map.flipY : null
  };
}, glb);
console.log('model:', JSON.stringify(info));

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 300000 }),
  page.click('#btn-save-objzip')
]);
const selNow = await page.evaluate(() => {
  const s = PixiStudio.State.get('selection');
  const m = PixiStudio.Viewport.getMainModel ? PixiStudio.Viewport.getMainModel() : null;
  return { selection: s ? s.name : null, mainModel: m ? m.name : null };
});
console.log('target lúc bấm nút:', JSON.stringify(selNow));
const zipPath = path.join(outDir, download.suggestedFilename());
await download.saveAs(zipPath);
console.log('đã tải:', download.suggestedFilename(), (fs.statSync(zipPath).size / 1048576).toFixed(2), 'MB');
if (!/monter1/i.test(download.suggestedFilename())) {
  console.log('!! CẢNH BÁO: tên file không phải model test — app đã đổi target, kết quả so sánh không đáng tin.');
}

const notice = await page.evaluate(() => {
  const n = document.querySelector('.notify, .toast, .notification');
  return n ? (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 260) : null;
});
console.log('thông báo app:', notice);
console.log('pageErrors:', errs.length, errs.slice(0, 3));

/* ── giải nén ZIP (STORE, không nén) ── */
const buf = fs.readFileSync(zipPath);
const files = [];
let off = 0;
while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
  const method = buf.readUInt16LE(off + 8);
  const csize = buf.readUInt32LE(off + 18);
  const nlen = buf.readUInt16LE(off + 26);
  const elen = buf.readUInt16LE(off + 28);
  const name = buf.subarray(off + 30, off + 30 + nlen).toString('utf8');
  const d0 = off + 30 + nlen + elen;
  files.push({ name, method, data: buf.subarray(d0, d0 + csize) });
  off = d0 + csize;
}
console.log('\nZIP có ' + files.length + ' file:');
files.forEach(f => console.log('  ' + f.name + '  ' + (f.data.length / 1024).toFixed(1) + ' KB  method=' + f.method));

const objF = files.find(f => /\.obj$/i.test(f.name));
const mtlF = files.find(f => /\.mtl$/i.test(f.name));
const imgs = files.filter(f => /\.(png|jpe?g)$/i.test(f.name));
console.log('\n.obj: ' + !!objF + ' | .mtl: ' + !!mtlF + ' | ảnh: ' + imgs.length);

const mtlText = mtlF ? mtlF.data.toString('utf8') : '';
const objText = objF ? objF.data.toString('utf8') : '';
const mapKd = mtlText.split('\n').filter(l => /^\s*map_Kd\b/i.test(l)).map(l => l.trim().split(/\s+/).slice(1).join(' '));
console.log('map_Kd trong .mtl:', JSON.stringify(mapKd));
console.log('newmtl:', JSON.stringify(mtlText.split('\n').filter(l => /^\s*newmtl\b/i.test(l)).map(l => l.trim())));

const magic = b => (b.length > 8 && b[0] === 0x89 && b[1] === 0x50) ? 'PNG' : (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) ? 'JPEG' : 'UNKNOWN';
imgs.forEach(i => console.log('  ảnh ' + i.name + ' → ' + magic(i.data) + ' hợp lệ=' + (magic(i.data) !== 'UNKNOWN')));
console.log('map_Kd trỏ tới file CÓ trong ZIP:', mapKd.length > 0 && mapKd.every(m => files.some(f => f.name === m) || files.some(f => f.name === path.basename(m))));

/* đếm trong obj */
const vCount = (objText.match(/^v /gm) || []).length;
const vtCount = (objText.match(/^vt /gm) || []).length;
const vnCount = (objText.match(/^vn /gm) || []).length;
const fCount = (objText.match(/^f /gm) || []).length;
const usemtl = (objText.match(/^usemtl /gm) || []).length;
console.log('obj: v=' + vCount + ' vt=' + vtCount + ' vn=' + vnCount + ' f=' + fCount + ' usemtl=' + usemtl + ' mtllib=' + /^mtllib\s+(\S+)/m.exec(objText)?.[1]);

/* ── KIỂM CHỨNG MÀU: dựng lại OBJ+MTL từ ZIP bằng three.js, so với GLB ── */
const glbB64 = fs.readFileSync(glb).toString('base64');
const payloadFiles = files.map(f => ({ name: f.name, b64: Buffer.from(f.data).toString('base64') }));
const colorCheck = await page.evaluate(async ({ glbB64, payloadFiles, mapKdList, objText }) => {
  const loadImg = u => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
  /* GLB gốc */
  const b = atob(glbB64); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().parse(u.buffer, '', res, rej));
  let glbImg = null;
  gltf.scene.traverse(o => { if (!o.isMesh) return; const m = Array.isArray(o.material) ? o.material[0] : o.material; if (m && m.map) glbImg = m.map.image; });
  if (!glbImg) return { error: 'GLB không có baseColor' };
  await (glbImg.decode ? glbImg.decode().catch(() => 0) : 1);

  /* file từ ZIP → blob URL */
  const urls = {};
  payloadFiles.forEach(f => {
    const bb = atob(f.b64); const uu = new Uint8Array(bb.length); for (let i = 0; i < bb.length; i++) uu[i] = bb.charCodeAt(i);
    urls[f.name] = URL.createObjectURL(new Blob([uu]));
  });
  const objUrl = Object.keys(urls).find(n => /\.obj$/i.test(n));

  /* Không có MTLLoader trong trang → tự dựng material từ dòng map_Kd của .mtl
     (đúng cách mọi trình đọc MTL làm) và lấy ảnh NGAY TRONG ZIP. */
  let tex = null;
  if (mapKdList && mapKdList[0] && urls[mapKdList[0]]) {
    const img = await loadImg(urls[mapKdList[0]]);
    tex = new THREE.Texture(img);
    tex.flipY = false;              /* OBJ đã ghi v' = 1 - v nên ảnh không cần lật thêm */
    tex.needsUpdate = true;
  }

  /* so ảnh map_Kd (từ ZIP) với ảnh baseColor của GLB — phải TRÙNG (không lật) */
  let direct = 0, flipped = 0, n = 0;
  if (tex) {
    const A = tex.image;
    const cv = document.createElement('canvas'); const cx = cv.getContext('2d', { willReadFrequently: true });
    cv.width = A.width; cv.height = A.height; cx.drawImage(A, 0, 0);
    const da = cx.getImageData(0, 0, cv.width, cv.height).data;
    const cv2 = document.createElement('canvas'); const cx2 = cv2.getContext('2d', { willReadFrequently: true });
    cv2.width = glbImg.width; cv2.height = glbImg.height; cx2.drawImage(glbImg, 0, 0);
    const db = cx2.getImageData(0, 0, cv2.width, cv2.height).data;
    const W = Math.min(cv.width, cv2.width), H = Math.min(cv.height, cv2.height);
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4, jf = ((H - 1 - y) * W + x) * 4;
      n++;
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 36) direct++;
      if (Math.abs(da[i] - db[jf]) + Math.abs(da[i + 1] - db[jf + 1]) + Math.abs(da[i + 2] - db[jf + 2]) > 36) flipped++;
    }
  }

  /* parse OBJ đã xuất (nguyên văn text lấy từ ZIP) + gắn ảnh → chứng minh dựng lại được */
  const obj = new THREE.OBJLoader().parse(objText);
  let objMeshes = 0, objHasMap = 0, objUv = 0, objTris = 0;
  obj.traverse(o => {
    if (!o.isMesh) return; objMeshes++;
    if (o.geometry.attributes.uv) objUv++;
    objTris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    if (tex) { o.material.map = tex; o.material.needsUpdate = true; objHasMap++; }
  });
  Object.values(urls).forEach(URL.revokeObjectURL);
  return {
    mapKdImageLoaded: !!tex,
    objTextLen: objText.length, objLoaderChildren: obj.children ? obj.children.length : null,
    objMeshes, objMeshesWithUv: objUv, objMeshesWithMap: objHasMap, objTris: Math.round(objTris),
    px: n, directPct: n ? +(direct / n * 100).toFixed(2) : null, flippedPct: n ? +(flipped / n * 100).toFixed(2) : null
  };
}, { glbB64, payloadFiles, mapKdList: mapKd, objText: objText });

console.log('\n— kiểm chứng màu —');
console.log(JSON.stringify(colorCheck, null, 1));

/* ── render so sánh: GLB vs OBJ dựng lại (cả hai CÓ texture) ── */
const renderCmp = await page.evaluate(async ({ glbB64, payloadFiles, mapKdList, objText }) => {
  const loadImg = u => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
  const shoot = (root, basic) => {
    if (basic) {
      /* Chỉ giữ TEXTURE + UV, bỏ mọi ảnh hưởng của ánh sáng/material → cô lập chiều UV */
      root.traverse(o => {
        if (!o.isMesh) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        const map = m && m.map ? m.map : null;
        o.material = new THREE.MeshBasicMaterial({ map: map, side: THREE.DoubleSide });
      });
    }
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(400, 400); renderer.setClearColor(0x101014, 1);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const d = new THREE.DirectionalLight(0xffffff, 0.9); d.position.set(2, 4, 6); scene.add(d);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.45); d2.position.set(-5, 2, -4); scene.add(d2);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 500);
    cam.position.set(c.x, c.y, c.z + Math.max(size.x, size.y, size.z) * 2.6);
    cam.lookAt(c.x, c.y, c.z);
    scene.add(root);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/png');
    renderer.dispose();
    return url;
  };

  /* GLB */
  const b = atob(glbB64); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().parse(u.buffer, '', res, rej));
  const glbRoot = gltf.scene;
  const glbImgs = [];
  glbRoot.traverse(o => { if (!o.isMesh) return; (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m && m.map && m.map.image && !glbImgs.includes(m.map.image)) glbImgs.push(m.map.image); }); });
  await Promise.race([Promise.all(glbImgs.map(i => i.decode ? i.decode().catch(() => 0) : 1)), new Promise(r => setTimeout(r, 5000))]);

  /* Tạo blob URLs cho ảnh trong ZIP TRƯỚC, để dùng CÙNG một ảnh cho cả 2 phía
     (cô lập đúng phép so UV: chỉ khác quy ước UV + flipY, không khác dữ liệu ảnh). */
  const urls = {};
  payloadFiles.forEach(f => {
    const bb = atob(f.b64); const uu = new Uint8Array(bb.length); for (let i = 0; i < bb.length; i++) uu[i] = bb.charCodeAt(i);
    urls[f.name] = URL.createObjectURL(new Blob([uu]));
  });
  const sharedImg = await loadImg(urls[mapKdList[0]]);

  /* GLB: giữ UV gốc, ảnh quy ước glTF → flipY = false */
  const texGlb = new THREE.Texture(sharedImg); texGlb.flipY = false; texGlb.needsUpdate = true;
  glbRoot.traverse(o => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m && m.map) { m.map = texGlb; m.needsUpdate = true; }
  });
  const glbShot = shoot(glbRoot, true);
  const glbBox = new THREE.Box3().setFromObject(glbRoot);

  /* OBJ + ảnh từ ZIP: UV đã ghi v' = 1 - v (quy ước OBJ/Blender) → flipY mặc định (true) */
  const tex = new THREE.Texture(sharedImg); tex.flipY = true; tex.needsUpdate = true;
  const obj = new THREE.OBJLoader().parse(objText);
  obj.traverse(o => { if (!o.isMesh) return; o.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0 }); });
  const objShot = shoot(obj, true);
  const objBox = new THREE.Box3().setFromObject(obj);
  const fmtBox = (bx) => ({
    min: bx.min.toArray().map(function (v) { return +v.toFixed(3); }),
    max: bx.max.toArray().map(function (v) { return +v.toFixed(3); })
  });
  Object.values(urls).forEach(URL.revokeObjectURL);

  /* so pixel */
  const ia = await loadImg(glbShot), ib = await loadImg(objShot);
  const cv = document.createElement('canvas'); cv.width = ia.width; cv.height = ia.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(ia, 0, 0); const A = cx.getImageData(0, 0, cv.width, cv.height).data;
  cx.clearRect(0, 0, cv.width, cv.height); cx.drawImage(ib, 0, 0); const B = cx.getImageData(0, 0, cv.width, cv.height).data;
  let diff = 0, solid = 0, solidB = 0, both = 0;
  for (let i = 0; i < A.length; i += 4) {
    const bgA = Math.abs(A[i] - 16) < 6 && Math.abs(A[i + 1] - 16) < 6 && Math.abs(A[i + 2] - 20) < 6;
    const bgB = Math.abs(B[i] - 16) < 6 && Math.abs(B[i + 1] - 16) < 6 && Math.abs(B[i + 2] - 20) < 6;
    if (!bgA) solid++;
    if (!bgB) solidB++;
    if (!bgA && !bgB) both++;
    if (bgA) continue;
    if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 40) diff++;
  }
  return {
    px: solid, diffPct: solid ? +(diff / solid * 100).toFixed(2) : null,
    silhouettePct: solid ? +(solidB / solid * 100).toFixed(2) : null,
    silIoU: (solid + solidB - both) ? +(both / (solid + solidB - both) * 100).toFixed(2) : null,
    glbBox: fmtBox(glbBox), objBox: fmtBox(objBox),
    glbShot, objShot
  };
}, { glbB64, payloadFiles, mapKdList: mapKd, objText });

console.log('\n— render so sánh GLB vs OBJ (MeshBasic + texture, cùng góc, cùng đèn) —');
console.log('  bounding box GLB: ' + JSON.stringify(renderCmp.glbBox));
console.log('  bounding box OBJ: ' + JSON.stringify(renderCmp.objBox));
console.log('  silhouette trùng (IoU): ' + renderCmp.silIoU + '%  | diện tích OBJ/GLB: ' + renderCmp.silhouettePct + '%');
console.log('  pixel khác màu: ' + renderCmp.diffPct + '%  (' + renderCmp.px + ' pixel)');
console.log(renderCmp.diffPct !== null && renderCmp.diffPct <= 12
  ? '  => OBJ + MTL + ảnh hiển thị GIỐNG GLB gốc (màu đúng, không lộn) ✓'
  : '  => KHÁC nhiều — cần xem lại (chiều UV hoặc ánh xạ material) ✗');
const p1 = path.join(outDir, 'render-glb.png'), p2 = path.join(outDir, 'render-obj.png');
fs.writeFileSync(p1, Buffer.from(renderCmp.glbShot.split(',')[1], 'base64'));
fs.writeFileSync(p2, Buffer.from(renderCmp.objShot.split(',')[1], 'base64'));
console.log('  ảnh: ' + p1 + ' | ' + p2);

console.log('FILE=' + zipPath);
await browser.close();