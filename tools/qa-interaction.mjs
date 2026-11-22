/* tools/qa-interaction.mjs — kiểm thử chọn/kéo object + camera trong viewport */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const OUT = path.join(process.cwd(), '_qa');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.Interaction && PixiStudio.Models.getCurrent(), { timeout: 90000 });
await page.waitForTimeout(900);

const R = {};
R.panelExists = await page.locator('#ix-camera-panel').count() === 1;
R.hudExists = await page.locator('#ix-hud').count() === 1;

/* tâm viewport để click */
const box = await page.evaluate(() => {
  const w = document.getElementById('viewport-canvas-wrap');
  const r = w.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});

/* 1) click để chọn object giữa màn hình */
await page.mouse.click(box.x, box.y);
await page.waitForTimeout(250);
R.afterClickSelected = await page.evaluate(() => {
  const s = PixiStudio.State.get('selection');
  return s ? { name: s.name || '(unnamed)', type: s.type } : null;
});

/* 2) kéo object để di chuyển */
R.beforeDrag = await page.evaluate(() => {
  const s = PixiStudio.State.get('selection');
  return s ? [s.position.x, s.position.y, s.position.z].map(v => +v.toFixed(3)) : null;
});
await page.mouse.move(box.x, box.y);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + i * 12, box.y + i * 3);
await page.mouse.up();
await page.waitForTimeout(300);
R.afterDrag = await page.evaluate(() => {
  const s = PixiStudio.State.get('selection');
  return s ? [s.position.x, s.position.y, s.position.z].map(v => +v.toFixed(3)) : null;
});
R.dragMoved = !!(R.beforeDrag && R.afterDrag && (Math.abs(R.afterDrag[0] - R.beforeDrag[0]) > 0.01 || Math.abs(R.afterDrag[2] - R.beforeDrag[2]) > 0.01));

/* 3) multi-select + outline */
R.multi = await page.evaluate(() => {
  const IX = PixiStudio.Interaction;
  PixiStudio.Scene.createPrimitive('box');
  PixiStudio.Scene.createPrimitive('sphere');
  const list = [];
  PixiStudio.Viewport.modelRoot.children.forEach(c => list.push(c));
  if (PixiStudio.Scene) PixiStudio.Scene.forEachPrimitive(o => list.push(o));
  IX.setSelection(list.slice(0, 3), list[0]);
  const outline = PixiStudio.Viewport.scene.getObjectByName('__selection_outline__');
  return { selected: IX.multi.length, outlineChildren: outline ? outline.children.length : 0 };
});

/* 4) camera: FOV, ortho, follow, reset */
R.camera = await page.evaluate(async () => {
  const IX = PixiStudio.Interaction;
  const o = PixiStudio.Viewport.orbit;
  const before = o.camera.fov;
  IX.setFov(64);
  const afterFov = o.camera.fov;
  IX.toggleOrtho();
  const isOrtho = !!o.camera.isOrthographicCamera;
  IX.toggleOrtho();
  const backPersp = !!o.camera.isPerspectiveCamera;
  IX.toggleFollow(true);
  const followOn = IX.follow;
  const sel = PixiStudio.State.get('selection');
  sel.position.x += 6;
  await new Promise(r => setTimeout(r, 700));
  const targetNear = Math.abs(o.dTarget.x - sel.position.x) < 3.0;
  IX.toggleFollow(false);
  IX.setOrbitSpeed(1.8);
  const speed = IX.orbitSpeed;
  IX.resetCamera();
  return { before, afterFov, isOrtho, backPersp, followOn, targetNear, speed };
});

/* 5) object actions: focus, drop floor, reset transform, duplicate, delete */
R.actions = await page.evaluate(async () => {
  const IX = PixiStudio.Interaction;
  const count = () => {
    let n = 0;
    PixiStudio.Viewport.modelRoot.children.forEach(() => n++);
    if (PixiStudio.Scene) PixiStudio.Scene.forEachPrimitive(() => n++);
    return n;
  };
  const sel = PixiStudio.State.get('selection');
  sel.position.y += 4;
  const c0 = count();
  IX.dropToFloor();
  sel.updateMatrixWorld(true);
  const floorMinY = +new THREE.Box3().setFromObject(sel).min.y.toFixed(3);
  IX.resetTransform();
  const posAfterReset = [sel.position.x, sel.position.z].map(v => +v.toFixed(3));
  IX.setSelection([sel], sel);
  IX.duplicateSelected();
  await new Promise(r => setTimeout(r, 150));
  const c1 = count();
  IX.deleteSelected();
  await new Promise(r => setTimeout(r, 150));
  const c2 = count();
  IX.focusSelected();
  await new Promise(r => setTimeout(r, 400));
  const radius = +PixiStudio.Viewport.orbit.dRadius.toFixed(2);
  return { c0, c1, c2, floorMinY, posAfterReset, radius };
});

/* 6) phím tắt: F focus, ] tăng snap */
R.keys = await page.evaluate(() => {
  const IX = PixiStudio.Interaction;
  const s0 = IX.snapSize;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
  const s1 = IX.snapSize;
  return { snapBefore: s0, snapAfter: s1 };
});
await page.keyboard.press('f');
await page.waitForTimeout(200);

R.pageErrors = pageErrors;
fs.writeFileSync(path.join(OUT, 'interaction.json'), JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1));
await browser.close();
