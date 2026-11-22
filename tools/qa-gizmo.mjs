/* tools/qa-gizmo.mjs — kiểm tra gizmo bằng CHUỘT THẬT: quét tìm trục, rồi kéo */
import { chromium } from 'playwright-core';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.Interaction && PixiStudio.Models.getCurrent(), { timeout: 90000 });
await page.waitForTimeout(900);

const setup = await page.evaluate(() => {
  const sel = PixiStudio.Models.getCurrent().object3D;
  PixiStudio.State.select(sel);
  PixiStudio.Interaction.setSelection([sel], sel);
  PixiStudio.Shortcuts.setGizmoMode('move');
  PixiStudio.Gizmo.attach(sel);
  PixiStudio.Gizmo.refreshVisible();
  const cam = PixiStudio.Viewport.orbit.camera;
  sel.updateMatrixWorld(true);
  const p = new THREE.Vector3().setFromMatrixPosition(sel.matrixWorld).project(cam);
  const r = document.getElementById('viewport-canvas-wrap').getBoundingClientRect();
  return {
    attached: PixiStudio.Gizmo.transformControls.object ? PixiStudio.Gizmo.transformControls.object.name : null,
    visible: PixiStudio.Gizmo.transformControls.visible,
    mode: PixiStudio.Gizmo.transformControls.mode,
    center: { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height },
    pos0: sel.position.toArray().map(n => +n.toFixed(3))
  };
});

/* quét quanh tâm để tìm tay cầm gizmo */
let hit = null;
const offsets = [];
for (let d = 28; d <= 150; d += 6) { offsets.push([d, 0]); offsets.push([-d, 0]); offsets.push([0, -d]); offsets.push([0, d]); }
for (const [dx, dy] of offsets) {
  await page.mouse.move(setup.center.x + dx, setup.center.y + dy);
  const axis = await page.evaluate(() => {
    const tc = PixiStudio.Gizmo.transformControls;
    return tc.axis;
  });
  if (axis) { hit = { axis, dx, dy, x: setup.center.x + dx, y: setup.center.y + dy }; break; }
}

let drag = null;
if (hit) {
  const before = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(hit.x + i * 14, hit.y, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  drag = { before, after, delta: [after[0] - before[0], after[1] - before[1], after[2] - before[2]].map(n => +n.toFixed(3)) };
}

/* gizmo rotate/scale cũng phải bật được */
const modes = await page.evaluate(() => {
  const tc = PixiStudio.Gizmo.transformControls;
  const out = {};
  ['move', 'rotate', 'scale', 'select'].forEach(m => {
    PixiStudio.Shortcuts.setGizmoMode(m);
    out[m] = { mode: tc.mode, visible: tc.visible, enabled: tc.enabled };
  });
  PixiStudio.Shortcuts.setGizmoMode('move');
  return out;
});

console.log(JSON.stringify({ setup, gizmoHit: hit ? { axis: hit.axis, at: { dx: hit.dx, dy: hit.dy } } : null, drag, modes, pageErrors: errs }, null, 1));
await browser.close();
