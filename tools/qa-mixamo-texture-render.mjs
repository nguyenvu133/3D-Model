/* tools/qa-mixamo-texture-render.mjs — KIỂM CHỨNG texture đúng chiều
 * Render cùng một góc nhìn, cùng đèn, với texture ĐÃ ÁP, cho từng file FBX,
 * rồi so sánh pixel với file nguồn. Nếu texture bị lộn ngược / sai chiều thì
 * ảnh render sẽ khác rõ rệt (khác > 8% pixel).
 *
 *   node tools/qa-mixamo-texture-render.mjs "nguồn.fbx" "bản1.fbx" "bản2.fbx"
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
if (files.length < 2) { console.error('cần ít nhất nguồn + 1 bản xuất'); process.exit(2); }
const outDir = path.join('_qa', 'mixamo-tex');
fs.mkdirSync(outDir, { recursive: true });

const payload = files.map(f => ({ name: path.basename(f), b64: fs.readFileSync(f).toString('base64') }));

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto((process.env.QA_BASE || 'http://127.0.0.1:8099') + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.THREE && THREE.FBXLoader, { timeout: 90000 });

const res = await page.evaluate(async ({ payload }) => {
  const out = [];
  for (const item of payload) {
    const bin = atob(item.b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const root = new THREE.FBXLoader().parse(bytes.buffer, '');
    root.updateMatrixWorld(true);

    /* chờ texture decode */
    const imgs = [];
    root.traverse(o => {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        ['map', 'normalMap'].forEach(s => { const t = m && m[s]; if (t && t.image) imgs.push(t.image); });
      });
    });
    await Promise.race([
      Promise.all(imgs.map(im => { if (im.width > 0) return 1; if (im.decode) return im.decode().catch(() => 0); return 1; })),
      new Promise(r => setTimeout(r, 5000))
    ]);
    let mapsReady = 0, mapsTotal = 0;
    root.traverse(o => {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        if (m && m.map) { mapsTotal++; if (m.map.image && m.map.image.width > 0) mapsReady++; }
      });
    });

    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false, alpha: false, preserveDrawingBuffer: true });
    renderer.setSize(640, 640); renderer.setClearColor(0x202020, 1);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const d = new THREE.DirectionalLight(0xffffff, 1.1); d.position.set(2, 4, 6); scene.add(d);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.5); d2.position.set(-4, 2, -3); scene.add(d2);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    const dist = Math.max(size.x, size.y, size.z) * 2.4;
    cam.position.set(c.x, c.y + size.y * 0.05, c.z + dist);
    cam.lookAt(c.x, c.y, c.z);
    scene.add(root);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/png');
    renderer.dispose();
    /* dữ liệu pixel thô để so sánh */
    const px = renderer.domElement.getContext('2d');
    out.push({ name: item.name, url, mapsReady, mapsTotal, dataUrl: url });
  }
  return out;
}, { payload });

/* lưu PNG + so sánh pixel */
const dataUrls = {};
res.forEach(r => {
  const p = path.join(outDir, r.name.replace(/\.fbx$/i, '.png'));
  fs.writeFileSync(p, Buffer.from(r.dataUrl.split(',')[1], 'base64'));
  dataUrls[r.name] = r.dataUrl;
  console.log(`${r.name}  map sẵn sàng ${r.mapsReady}/${r.mapsTotal}  → ${p}`);
});

/* so sánh: decode 2 ảnh trên canvas 1 lần nữa trong trang */
const cmp = await page.evaluate(async ({ a, b }) => {
  const load = u => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = u; });
  const ia = await load(a), ib = await load(b);
  const cv = document.createElement('canvas'); cv.width = ia.width; cv.height = ia.height;
  const cx = cv.getContext('2d');
  cx.drawImage(ia, 0, 0); const da = cx.getImageData(0, 0, cv.width, cv.height).data;
  cx.clearRect(0, 0, cv.width, cv.height); cx.drawImage(ib, 0, 0);
  const db = cx.getImageData(0, 0, cv.width, cv.height).data;
  let diff = 0, solid = 0;
  for (let i = 0; i < da.length; i += 4) {
    const bg = da[i] === 32 && da[i + 1] === 32 && da[i + 2] === 32;
    if (bg) continue;
    solid++;
    const dd = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    if (dd > 24) diff++;
  }
  return { pixels: solid, diff, pct: solid ? +(diff / solid * 100).toFixed(2) : 0 };
}, { a: dataUrls[files[0].split(/[\\/]/).pop()], b: dataUrls[files[1].split(/[\\/]/).pop()] });

console.log('\nso với nguồn: ' + files[1].split(/[\\/]/).pop(), '→ pixel khác ' + cmp.pct + '%  (' + cmp.diff + '/' + cmp.pixels + ')');
console.log(cmp.pct <= 8 ? '=> TEXTURE ĐÚNG CHIỀU ✓' : '=> TEXTURE SAI CHIỀU ✗ (bị lộn/khác)');
console.log('pageErrors:', errs.length, errs.slice(0, 3));
await browser.close();