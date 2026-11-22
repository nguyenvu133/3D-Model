/* tools/qa-mixamo-compare.mjs — ảnh đầu-cuối (before/after) để kiểm tra hướng nhân vật
 * - "before": file FBX gốc (Meshy) như Mixamo sẽ thấy
 * - "after": các biến thể đã đổi (đứng Y, mặt +Z)
 * Ghi ảnh vào _qa/mixamo/<tên>_<hướng>.png và in bbox.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
if (!files.length) files.push('Meshy_AI_tripo_convert_monter1_20261122_texture.fbx');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const OUT = path.join(process.cwd(), '_qa', 'mixamo');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', (route) => route.continue({ headers: { ...route.request().headers(), 'cache-control': 'no-cache', pragma: 'no-cache' } }));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && window.THREE && PixiStudio.Viewport && PixiStudio.Viewport.scene, { timeout: 90000 });
await page.waitForTimeout(1000);

await page.evaluate(() => {
  const cur = PixiStudio.Models && PixiStudio.Models.getCurrent && PixiStudio.Models.getCurrent();
  if (cur && cur.object3D) cur.object3D.visible = false;
  if (PixiStudio.Gizmo && PixiStudio.Gizmo.transformControls) PixiStudio.Gizmo.transformControls.detach();
  ['toast-root', 'loading-overlay', 'perf-hud'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
  document.querySelectorAll('.toast, [class*=toast]').forEach(e => e.remove());
});

for (const file of files) {
  const tag = path.basename(file, '.fbx').replace(/_texture$/, '').replace(/^Meshy_AI_/, '');
  const info = await page.evaluate(async (b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const V = PixiStudio.Viewport;
    if (window.__qaObj && window.__qaObj.parent) window.__qaObj.parent.remove(window.__qaObj);
    const obj = new THREE.FBXLoader().parse(bytes.buffer, '');
    obj.traverse(o => {
      if (o.isMesh) { o.material = new THREE.MeshStandardMaterial({ color: 0x9b8bff, metalness: 0.1, roughness: 0.55, side: THREE.DoubleSide }); o.visible = true; }
      if (o.isLine || o.isPoints) o.visible = false;
    });
    V.scene.add(obj);
    obj.updateMatrixWorld(true);
    window.__qaObj = obj;
    const bb = new THREE.Box3().setFromObject(obj);
    const size = bb.getSize(new THREE.Vector3());
    const center = bb.getCenter(new THREE.Vector3());
    /* camera orbit: pos = target + (sinφsinθ, cosφ, sinφcosθ)·r */
    window.__qaView = (d) => {
      const v = new THREE.Vector3(d[0], d[1], d[2]).normalize();
      V.orbit.target.copy(center); V.orbit.dTarget.copy(center);
      V.orbit.theta = Math.atan2(v.x, v.z); V.orbit.phi = Math.acos(Math.max(-1, Math.min(1, v.y)));
      V.orbit.dTheta = V.orbit.theta; V.orbit.dPhi = V.orbit.phi;
      V.orbit.radius = size.length() * 1.05; V.orbit.dRadius = V.orbit.radius;
      if (V.orbit.update) V.orbit.update(1);
      V.orbit.camera.updateMatrixWorld(true);
      const cam = V.orbit.camera;
      const r = document.getElementById('viewport-canvas-wrap').getBoundingClientRect();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = 0; i < 8; i++) {
        const p = new THREE.Vector3((i & 1) ? bb.max.x : bb.min.x, (i & 2) ? bb.max.y : bb.min.y, (i & 4) ? bb.max.z : bb.min.z).project(cam);
        const sx = r.left + (p.x * 0.5 + 0.5) * r.width, sy = r.top + (-p.y * 0.5 + 0.5) * r.height;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      const pad = 16;
      return { x: Math.max(0, Math.round(x0 - pad)), y: Math.max(0, Math.round(y0 - pad)), width: Math.min(1000, Math.round(x1 - x0 + pad * 2)), height: Math.min(1000, Math.round(y1 - y0 + pad * 2)) };
    };
    return { min: bb.min.toArray().map(n => +n.toFixed(3)), max: bb.max.toArray().map(n => +n.toFixed(3)), size: size.toArray().map(n => +n.toFixed(3)) };
  }, fs.readFileSync(file).toString('base64'));
  console.log('\n' + file, 'bbox', JSON.stringify(info));
  for (const [name, dir] of [['front', [0, 0, 1]], ['side', [1, 0, 0]], ['back', [0, 0, -1]]]) {
    const clip = await page.evaluate((d) => window.__qaView(d), dir);
    await page.waitForTimeout(400);
    const f = path.join(OUT, tag + '_' + name + '.png');
    await page.screenshot({ path: f, clip });
    console.log('  shot', path.basename(f));
  }
}
if (errs.length) console.log('pageErrors', errs.slice(0, 5));
await browser.close();
