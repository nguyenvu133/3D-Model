/* tools/qa-transform-ext.mjs — kiểm thử mở rộng transform:
 * axis-lock Z/X/Y khi kéo, ô Rot/Scale, World/Local, Align */
import { chromium } from 'playwright-core';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.Models.getCurrent(), { timeout: 90000 });
await page.waitForTimeout(1000);

const R = {};

/* chọn model, về gốc, bật select mode để kéo */
const center = async () => {
  const c = await page.evaluate(() => {
    const sel = PixiStudio.Models.getCurrent().object3D;
    PixiStudio.State.select(sel);
    PixiStudio.Interaction.setSelection([sel], sel);
    PixiStudio.Shortcuts.setGizmoMode('select');
    sel.position.set(0, 0, 0); sel.rotation.set(0, 0, 0); sel.scale.set(1, 1, 1);
    sel.updateMatrixWorld(true);
    const cam = PixiStudio.Viewport.orbit.camera;
    const r = document.getElementById('viewport-canvas-wrap').getBoundingClientRect();
    const p = new THREE.Vector3().setFromMatrixPosition(sel.matrixWorld).project(cam);
    return { cx: r.left + (p.x * 0.5 + 0.5) * r.width, cy: r.top + (-p.y * 0.5 + 0.5) * r.height };
  });
  return c;
};
const ctx = await center();

/* 1) axis-lock Z khi kéo: mousedown → nhấn Z → kéo bất kỳ hướng → CHỈ Z đổi */
R.axisLockZ = await (async () => {
  const before = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  await page.mouse.move(ctx.cx, ctx.cy);
  await page.mouse.down();
  await page.keyboard.press('z');
  await page.waitForTimeout(60);
  await page.mouse.move(ctx.cx + 60, ctx.cy + 40, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  const d = [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
  return { before, after, delta: d.map(n => +n.toFixed(3)), onlyZ: Math.abs(d[0]) < 0.001 && Math.abs(d[1]) < 0.001 && Math.abs(d[2]) > 0.01 };
})();

/* 2) axis-lock X khi kéo */
R.axisLockX = await (async () => {
  const c = await center();
  const before = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  await page.mouse.move(c.cx, c.cy);
  await page.mouse.down();
  await page.keyboard.press('x');
  await page.waitForTimeout(60);
  await page.mouse.move(c.cx + 60, c.cy + 40, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  const d = [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
  return { delta: d.map(n => +n.toFixed(3)), onlyX: Math.abs(d[1]) < 0.001 && Math.abs(d[2]) < 0.001 && Math.abs(d[0]) > 0.01 };
})();

/* 3) axis-lock Y khi kéo */
R.axisLockY = await (async () => {
  const c = await center();
  const before = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  await page.mouse.move(c.cx, c.cy);
  await page.mouse.down();
  await page.keyboard.press('y');
  await page.waitForTimeout(60);
  await page.mouse.move(c.cx + 60, c.cy + 60, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  const d = [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
  return { delta: d.map(n => +n.toFixed(3)), onlyY: Math.abs(d[0]) < 0.001 && Math.abs(d[2]) < 0.001 && Math.abs(d[1]) > 0.01 };
})();

/* 4) ô nhập Rot và Scale */
R.inputs = await page.evaluate(() => {
  const sel = PixiStudio.State.get('selection');
  sel.position.set(0, 0, 0); sel.rotation.set(0, 0, 0); sel.scale.set(1, 1, 1);
  const rows = Array.from(document.querySelectorAll('#ix-camera-panel .ix-row'));
  const out = { rowLabels: [] };
  rows.forEach(r => out.rowLabels.push((r.querySelector('.ix-label') || {}).textContent || ''));
  const getInputs = (label) => {
    const row = rows.find(r => (r.querySelector('.ix-label') || {}).textContent === label);
    return row ? Array.from(row.querySelectorAll('.ix-num')) : [];
  };
  const rot = getInputs('Rot°');
  if (rot[2]) { rot[2].value = '45'; rot[2].dispatchEvent(new Event('change')); }
  out.rotZdeg = +(THREE.MathUtils.radToDeg(sel.rotation.z)).toFixed(1);
  const scl = getInputs('Scale');
  if (scl[0]) { scl[0].value = '2'; scl[0].dispatchEvent(new Event('change')); }
  out.scaleX = +sel.scale.x.toFixed(2);
  return out;
});

/* 5) World/Local toggle */
R.worldLocal = await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('#ix-camera-panel .ix-chip'));
  const world = chips.find(c => c.textContent.trim() === 'World');
  const local = chips.find(c => c.textContent.trim() === 'Local');
  const before = PixiStudio.State.get('gizmoSpace');
  world.click();
  const afterWorld = PixiStudio.State.get('gizmoSpace');
  local.click();
  const afterLocal = PixiStudio.State.get('gizmoSpace');
  return { before, afterWorld, afterLocal };
});

/* 6) Align */
R.align = await page.evaluate(() => {
  const sel = PixiStudio.State.get('selection');
  sel.position.set(0, 3, 0);
  const out = {};
  const click = (t) => {
    const b = Array.from(document.querySelectorAll('#ix-camera-panel .ix-btn')).find(x => x.textContent.trim() === t);
    if (b) b.click();
  };
  click('Floor');
  sel.updateMatrixWorld(true);
  out.floorY = +new THREE.Box3().setFromObject(sel).min.y.toFixed(3);
  click('Cen X');
  sel.updateMatrixWorld(true);
  out.centerX = +new THREE.Box3().setFromObject(sel).getCenter(new THREE.Vector3()).x.toFixed(3);
  click('Cen Z');
  sel.updateMatrixWorld(true);
  out.centerZ = +new THREE.Box3().setFromObject(sel).getCenter(new THREE.Vector3()).z.toFixed(3);
  click('Origin');
  sel.updateMatrixWorld(true);
  out.originPos = sel.position.toArray().map(n => +n.toFixed(3));
  return out;
});

R.pageErrors = errs;
console.log(JSON.stringify(R, null, 1));
await browser.close();