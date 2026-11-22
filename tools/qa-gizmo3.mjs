/* tools/qa-gizmo3.mjs — kiểm tra gizmo translate theo từng trục X/Y/Z bằng chuột thật */
import { chromium } from 'playwright-core';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.Models.getCurrent(), { timeout: 90000 });
await page.waitForTimeout(900);

const info = await page.evaluate(() => {
  const sel = PixiStudio.Models.getCurrent().object3D;
  PixiStudio.State.select(sel); PixiStudio.Interaction.setSelection([sel], sel);
  PixiStudio.Shortcuts.setGizmoMode('move'); PixiStudio.Gizmo.attach(sel); PixiStudio.Gizmo.refreshVisible();
  const cam = PixiStudio.Viewport.orbit.camera;
  sel.updateMatrixWorld(true);
  const r = document.getElementById('viewport-canvas-wrap').getBoundingClientRect();
  const toScreen = (v) => { const p = v.clone().project(cam); return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; };
  const pos = new THREE.Vector3().setFromMatrixPosition(sel.matrixWorld);
  return {
    center: toScreen(pos),
    dir: {
      X: toScreen(pos.clone().add(new THREE.Vector3(0.5, 0, 0))),
      Y: toScreen(pos.clone().add(new THREE.Vector3(0, 0.5, 0))),
      Z: toScreen(pos.clone().add(new THREE.Vector3(0, 0, 0.5)))
    }
  };
});

const result = {};
for (const axis of ['X', 'Y', 'Z']) {
  /* quét tìm tay cầm của trục này */
  let found = null;
  for (let d = 24; d <= 130; d += 4) {
    for (const [sx, sy] of [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1]]) {
      const px = info.center.x + sx * d, py = info.center.y + sy * d;
      await page.mouse.move(px, py);
      const a = await page.evaluate(() => PixiStudio.Gizmo.transformControls.axis);
      if (a === axis) { found = { x: px, y: py }; break; }
    }
    if (found) break;
  }
  if (!found) { result[axis] = { hit: false }; continue; }
  /* hướng kéo trên màn hình = hướng chiếu của trục đó */
  const dir = info.dir[axis];
  let dx = dir.x - info.center.x, dy = dir.y - info.center.y;
  const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
  const before = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  await page.mouse.move(found.x, found.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(found.x + dx * i * 16, found.y + dy * i * 16, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  const delta = [after[0] - before[0], after[1] - before[1], after[2] - before[2]].map(n => +n.toFixed(3));
  result[axis] = { hit: true, at: found, before, after, delta, moved: Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]) > 0.05 };
  /* đưa object về 0 để trục sau đo độc lập */
  await page.evaluate(() => { PixiStudio.State.get('selection').position.set(0, 0, 0); });
  await page.waitForTimeout(120);
}
console.log(JSON.stringify({ result, pageErrors: errs }, null, 1));
await browser.close();
