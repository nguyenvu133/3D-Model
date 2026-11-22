import { chromium } from 'playwright-core';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const b = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => window.PixiStudio && PixiStudio.Models.getCurrent(), { timeout: 90000 });
await p.waitForTimeout(900);
const base = await p.evaluate(() => {
  const sel = PixiStudio.Models.getCurrent().object3D;
  PixiStudio.State.select(sel); PixiStudio.Interaction.setSelection([sel], sel);
  PixiStudio.Shortcuts.setGizmoMode('move'); PixiStudio.Gizmo.attach(sel); PixiStudio.Gizmo.refreshVisible();
  const cam = PixiStudio.Viewport.orbit.camera; sel.updateMatrixWorld(true);
  const canvas = document.getElementById('three-canvas'); const r = canvas.getBoundingClientRect();
  const pr = new THREE.Vector3().setFromMatrixPosition(sel.matrixWorld).project(cam);
  return { cx: r.left + (pr.x*0.5+0.5)*r.width, cy: r.top + (-pr.y*0.5+0.5)*r.height };
});
const hit = await p.evaluate(({ cx, cy }) => {
  const canvas = document.getElementById('three-canvas'); const tc = PixiStudio.Gizmo.transformControls;
  const move = (x, y) => canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', buttons: 0 }));
  for (let d = 12; d <= 170; d += 2) {
    for (let a = 0; a < 360; a += 5) {
      const rad = a * Math.PI / 180;
      const x = cx + Math.cos(rad) * d, y = cy + Math.sin(rad) * d;
      move(x, y);
      if (tc.axis === 'Z') { move(cx + 900, cy + 900); return { x, y, d, a }; }
    }
  }
  move(cx + 900, cy + 900); return null;
}, base);
let res = { hit: hit ? true : false };
if (hit) {
  await p.evaluate(() => PixiStudio.State.get('selection').position.set(0,0,0));
  await p.waitForTimeout(100);
  let dx = hit.x - base.cx, dy = hit.y - base.cy; const L = Math.hypot(dx,dy)||1; dx/=L; dy/=L;
  const before = await p.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n=>+n.toFixed(3)));
  await p.mouse.move(hit.x, hit.y); await p.mouse.down();
  for (let i = 1; i <= 6; i++) await p.mouse.move(hit.x + dx*i*16, hit.y + dy*i*16, { steps: 2 });
  await p.mouse.up(); await p.waitForTimeout(200);
  const after = await p.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n=>+n.toFixed(3)));
  res = { hit: true, at: hit, before, after, delta: [0,1,2].map(i=>+(after[i]-before[i]).toFixed(3)) };
}
console.log(JSON.stringify({ z: res, pageErrors: errs }, null, 1));
await b.close();
