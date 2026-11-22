/* tools/dbg-orient.mjs — tại sao "view right" lại ra ảnh giống "view front"? in vị trí camera thật */
import { chromium } from 'playwright-core';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.route('**/*', (r) => r.continue());
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.Viewport && PixiStudio.Viewport.scene, { timeout: 90000 });
await page.waitForTimeout(800);
const r = await page.evaluate(() => {
  const V = PixiStudio.Viewport;
  const out = {};
  const cam = V.orbit.camera;
  out.orbitKeys = Object.keys(V.orbit);
  out.camStart = cam.position.toArray().map(n => +n.toFixed(2));
  cam.position.set(10, 0, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true);
  out.camAfterSet = cam.position.toArray().map(n => +n.toFixed(2));
  out.controls = { hasControls: !!V.controls, hasOrbitControls: !!V.orbit.controls, damping: V.orbit.damping };
  out.renderCam = V.renderer && V.renderer.camera ? V.renderer.camera.position.toArray().map(n => +n.toFixed(2)) : null;
  out.viewNames = V.views ? Object.keys(V.views) : null;
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
