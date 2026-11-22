/* tools/qa-move.mjs — kiểm thử di chuyển object: gizmo X/Y/Z + nudge (index.html & mesh2motion.html) */
import { chromium } from 'playwright-core';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const R = {};

/* ---------- index.html ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.PixiStudio && PixiStudio.Interaction && PixiStudio.Models.getCurrent(), { timeout: 90000 });
  await page.waitForTimeout(900);

  R.index = await page.evaluate(async () => {
    const out = {};
    const sel = PixiStudio.Models.getCurrent().object3D;
    PixiStudio.State.select(sel);
    PixiStudio.Interaction.setSelection([sel], sel);
    sel.position.set(0, 0, 0);
    /* nút nudge trong panel */
    const btns = Array.from(document.querySelectorAll('#ix-camera-panel .ix-btn'));
    const label = t => btns.find(b => b.textContent.trim() === t);
    const clickN = (t) => { const b = label(t); if (!b) return null; b.click(); return [+sel.position.x.toFixed(3), +sel.position.y.toFixed(3), +sel.position.z.toFixed(3)]; };
    out.afterYup = clickN('Y ▲');
    out.afterYdown = clickN('Y ▼');
    out.afterZup = clickN('Z ▲');
    out.afterXup = clickN('X ▲');
    /* ô nhập số */
    const nums = Array.from(document.querySelectorAll('#ix-camera-panel .ix-num'));
    out.numInputs = nums.length;
    if (nums[1]) { nums[1].value = '1.5'; nums[1].dispatchEvent(new Event('change')); }
    out.afterInputY = +sel.position.y.toFixed(3);
    out.gizmo = { exists: !!PixiStudio.Gizmo.transformControls, visible: PixiStudio.Gizmo.transformControls ? PixiStudio.Gizmo.transformControls.visible : null };
    return out;
  });
  R.indexErrors = errs;
  await page.close();
}

/* ---------- mesh2motion.html ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/mesh2motion.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.M2MPage && PixiStudio.M2MMotion && PixiStudio.M2MMotion.catalog, { timeout: 90000 });
  await page.waitForTimeout(1000);

  R.m2m = await page.evaluate(async () => {
    const out = {};
    const cat = PixiStudio.M2MMotion.catalog;
    const e = await window.M2MPage.loadModelUrl(cat.rigs.human.model, 'MoveTest');
    const o = e.object3D;
    out.gizmo = { exists: !!window.M2MPage.gizmo, visible: window.M2MPage.gizmo ? window.M2MPage.gizmo.visible : null, mode: window.M2MPage.gizmoMode };
    window.M2MPage.resetTransform();
    out.afterReset = window.M2MPage.transformState().position;
    /* nudge qua API */
    window.M2MPage.nudge('y', 0.5);
    out.afterNudgeY = window.M2MPage.transformState().position;
    window.M2MPage.nudge('z', 0.3);
    out.afterNudgeZ = window.M2MPage.transformState().position;
    /* nút trong panel UI */
    const btns = Array.from(document.querySelectorAll('#m2m-object-panel .btn'));
    const yUp = btns.find(b => b.textContent.trim() === 'Y ▲');
    out.hasPanel = !!document.getElementById('m2m-object-panel');
    out.panelButtons = btns.length;
    if (yUp) { yUp.click(); }
    out.afterUiYup = window.M2MPage.transformState().position;
    /* đổi mode gizmo */
    const rot = btns.find(b => b.textContent.trim() === 'Rotate');
    if (rot) rot.click();
    out.gizmoModeAfterRotate = window.M2MPage.gizmo ? window.M2MPage.gizmo.mode : null;
    window.M2MPage.setGizmoMode('move');
    /* drop to floor */
    window.M2MPage.dropToFloor();
    out.afterDropY = window.M2MPage.transformState().position[1];
    return out;
  });
  R.m2mErrors = errs;
  await page.screenshot({ path: 'docs/m2m-v10/m2m-object-panel.png' }).catch(() => { });
  await page.close();
}

console.log(JSON.stringify(R, null, 1));
await browser.close();