/* tools/qa-mixamo-snapshot.mjs — nhìn tận mắt file "Mixamo-ready" vừa xuất
 * Nạp file FBX vào scene của studio, ẩn model mặc định, chiếu sáng đơn giản, chụp 4 hướng
 * vào _qa/mixamo/. Ảnh được crop theo bbox của model để thấy rõ.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2] || 'exports/Meshy_AI_tripo_convert_monter1_20261122_mixamo_A_full.fbx';
const tag = path.basename(file, '.fbx').replace(/_texture$/, '');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const OUT = path.join(process.cwd(), '_qa', 'mixamo');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', (route) => route.continue({ headers: { ...route.request().headers(), 'cache-control': 'no-cache', pragma: 'no-cache' } }));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && window.THREE && PixiStudio.Viewport && PixiStudio.Viewport.scene, { timeout: 90000 });
await page.waitForTimeout(1200);

const info = await page.evaluate(async (b64) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const V = PixiStudio.Viewport;
  const scene = V.scene;
  /* ẩn model hiện tại + tắt gizmo/helper để ảnh chỉ có model của ta */
  if (PixiStudio.Models && PixiStudio.Models.getCurrent) {
    const cur = PixiStudio.Models.getCurrent();
    if (cur && cur.object3D) cur.object3D.visible = false;
  }
  if (PixiStudio.Gizmo && PixiStudio.Gizmo.transformControls) PixiStudio.Gizmo.transformControls.detach();
  /* tắt overlay UI để ảnh sạch */
  ['toast-root', 'loading-overlay', 'perf-hud'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
  document.querySelectorAll('.toast, .notification, [class*=toast]').forEach(e => e.remove());
  const orientEl = document.getElementById('viewport-axis-labels') || document.querySelector('.axis-labels');
  if (orientEl) orientEl.style.display = 'none';
  if (PixiStudio.Viewport.orbit && PixiStudio.Viewport.orbit.autoRotate !== undefined) PixiStudio.Viewport.orbit.autoRotate = false;

  const obj = new THREE.FBXLoader().parse(bytes.buffer, '');
  obj.name = 'MixamoQA';
  obj.traverse(o => {
    if (o.isMesh) {
      o.material = new THREE.MeshStandardMaterial({ color: 0x8b7dff, metalness: 0.1, roughness: 0.55, side: THREE.DoubleSide });
      o.visible = true;
    }
    if (o.isLine || o.isPoints) o.visible = false;   /* grid/trục của file không cần */
  });
  scene.add(obj);
  obj.updateMatrixWorld(true);
  obj.traverse(o => { if (o.isMesh) o.geometry.computeBoundingBox(); });
  const bb = new THREE.Box3().setFromObject(obj);
  const size = bb.getSize(new THREE.Vector3());
  const center = bb.getCenter(new THREE.Vector3());

  const cam = V.orbit.camera;
  /* OrbitCam.update() mỗi frame tính lại camera từ theta/phi/radius → phải đặt ĐÚNG orbiter
   * (không set cam.position trực tiếp, sẽ bị frame sau ghi đè).
   * theta=0 nhìn từ +Z, theta=90° nhìn từ -X, phi=90° = ngang tầm mắt. */
  const setView = (dir) => {
    const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    V.orbit.dTarget.copy(center);
    V.orbit.target.copy(center);
    /* camera đứng ở hướng d: pos = target + (sinφ·sinθ, cosφ, sinφ·cosθ)·r */
    V.orbit.theta = Math.atan2(d.x, d.z);
    V.orbit.phi = Math.acos(THREE.MathUtils.clamp(d.y, -1, 1));
    V.orbit.dTheta = V.orbit.theta;
    V.orbit.dPhi = V.orbit.phi;
    V.orbit.radius = size.length() * 0.95;
    V.orbit.dRadius = V.orbit.radius;
    if (V.orbit.update) V.orbit.update(1);
    cam.updateMatrixWorld(true);
    /* chiếu bbox ra màn hình để crop ảnh */
    const r = document.getElementById('viewport-canvas-wrap').getBoundingClientRect();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(
        (i & 1) ? bb.max.x : bb.min.x,
        (i & 2) ? bb.max.y : bb.min.y,
        (i & 4) ? bb.max.z : bb.min.z
      ).project(cam);
      const sx = r.left + (p.x * 0.5 + 0.5) * r.width;
      const sy = r.top + (-p.y * 0.5 + 0.5) * r.height;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    const pad = 20;
    return {
      x: Math.max(0, Math.round(x0 - pad)), y: Math.max(0, Math.round(y0 - pad)),
      width: Math.min(1000, Math.round(x1 - x0 + pad * 2)), height: Math.min(1000, Math.round(y1 - y0 + pad * 2))
    };
  };
  window.__mixamoSetView = setView;
  return {
    min: bb.min.toArray().map(v => +v.toFixed(3)), max: bb.max.toArray().map(v => +v.toFixed(3)),
    size: size.toArray().map(v => +v.toFixed(3)), center: center.toArray().map(v => +v.toFixed(3))
  };
}, fs.readFileSync(file).toString('base64'));

for (const [name, dir] of [['front', [0, 0, 1]], ['right', [1, 0, 0]], ['back', [0, 0, -1]], ['below', [0.35, -0.3, 1]]]) {
  const clip = await page.evaluate((d) => window.__mixamoSetView(d), dir);
  await page.waitForTimeout(400);
  const f = path.join(OUT, tag + '_' + name + '.png');
  await page.screenshot({ path: f, clip });
  console.log('shot', path.basename(f), JSON.stringify(clip));
}
console.log('bbox', JSON.stringify(info));
if (errs.length) console.log('pageErrors', errs.slice(0, 5));
await browser.close();
