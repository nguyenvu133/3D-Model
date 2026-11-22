/* tools/qa-gizmo4.mjs — quét tay cầm X/Y/Z trong trang rồi kéo bằng chuột thật */
import { chromium } from 'playwright-core';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.Models.getCurrent(), { timeout: 90000 });
await page.waitForTimeout(900);

/* 1) xác nhận pointermove tổng hợp có cập nhật axis không */
const synth = await page.evaluate(() => {
  const sel = PixiStudio.Models.getCurrent().object3D;
  PixiStudio.State.select(sel); PixiStudio.Interaction.setSelection([sel], sel);
  PixiStudio.Shortcuts.setGizmoMode('move'); PixiStudio.Gizmo.attach(sel); PixiStudio.Gizmo.refreshVisible();
  const cam = PixiStudio.Viewport.orbit.camera;
  sel.updateMatrixWorld(true);
  const canvas = document.getElementById('three-canvas');
  const r = canvas.getBoundingClientRect();
  const p = new THREE.Vector3().setFromMatrixPosition(sel.matrixWorld).project(cam);
  const cx = r.left + (p.x * 0.5 + 0.5) * r.width, cy = r.top + (-p.y * 0.5 + 0.5) * r.height;
  const tc = PixiStudio.Gizmo.transformControls;
  const move = (x, y) => canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', buttons: 0 }));
  move(cx, cy - 28);
  const axisAtYHandle = tc.axis;
  move(cx + 999, cy + 999);
  const axisAway = tc.axis;
  return { cx, cy, rect: { left: r.left, top: r.top, w: r.width, h: r.height }, axisAtYHandle, axisAway };
});

/* 2) quét trong trang tìm toạ độ tay cầm từng trục */
const hits = await page.evaluate(({ cx, cy }) => {
  const canvas = document.getElementById('three-canvas');
  const tc = PixiStudio.Gizmo.transformControls;
  const found = {};
  const move = (x, y) => canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', buttons: 0 }));
  for (let d = 20; d <= 150 && Object.keys(found).length < 3; d += 3) {
    for (let a = 0; a < 360; a += 8) {
      const rad = a * Math.PI / 180;
      const x = cx + Math.cos(rad) * d, y = cy + Math.sin(rad) * d;
      move(x, y);
      const ax = tc.axis;
      if (ax && !found[ax]) found[ax] = { x, y, d, a };
      if (Object.keys(found).length >= 3) break;
    }
  }
  move(cx + 900, cy + 900);
  return found;
}, { cx: synth.cx, cy: synth.cy });

/* 3) kéo từng trục bằng chuột thật */
const result = {};
for (const axis of ['X', 'Y', 'Z']) {
  const h = hits[axis];
  if (!h) { result[axis] = { hit: false }; continue; }
  await page.evaluate(() => { PixiStudio.State.get('selection').position.set(0, 0, 0); });
  await page.waitForTimeout(100);
  /* hướng kéo: từ tâm ra tay cầm */
  let dx = h.x - synth.cx, dy = h.y - synth.cy;
  const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
  const before = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(h.x + dx * i * 16, h.y + dy * i * 16, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  const delta = [0, 1, 2].map(i => +(after[i] - before[i]).toFixed(3));
  result[axis] = { hit: true, at: { d: h.d, a: h.a }, before, after, delta, moved: Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]) > 0.05 };
}
console.log(JSON.stringify({ synth: { axisAtYHandle: synth.axisAtYHandle, axisAway: synth.axisAway }, hits, result, pageErrors: errs }, null, 1));
await browser.close();
