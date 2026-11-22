/* tools/qa-zmove.mjs — kiểm thử thật di chuyển TRỤC Z trên web:
 * 1) gizmo kéo Z, 2) ô nhập Z, 3) nút nudge Z, 4) kéo object trực tiếp
 * Mở index.html với model mặc định, chọn object, thao tác bằng chuột thật.
 */
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

/* chọn model + bật gizmo move */
const ctx = await page.evaluate(() => {
  const sel = PixiStudio.Models.getCurrent().object3D;
  PixiStudio.State.select(sel);
  PixiStudio.Interaction.setSelection([sel], sel);
  PixiStudio.Shortcuts.setGizmoMode('move');
  PixiStudio.Gizmo.attach(sel);
  PixiStudio.Gizmo.refreshVisible();
  sel.position.set(0, 0, 0);
  const cam = PixiStudio.Viewport.orbit.camera;
  sel.updateMatrixWorld(true);
  const r = document.getElementById('viewport-canvas-wrap').getBoundingClientRect();
  const p = new THREE.Vector3().setFromMatrixPosition(sel.matrixWorld).project(cam);
  const cx = r.left + (p.x * 0.5 + 0.5) * r.width;
  const cy = r.top + (-p.y * 0.5 + 0.5) * r.height;
  return { cx, cy, modelName: sel.name };
});

/* 1) Gizmo kéo trục Z: quét tìm tay cầm Z (synthetic pointermove trong trang) rồi kéo thật */
R.gizmoZ = await page.evaluate(async ({ cx, cy }) => {
  const canvas = document.getElementById('three-canvas');
  const tc = PixiStudio.Gizmo.transformControls;
  const out = { hit: null };
  const move = (x, y) => canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', buttons: 0 }));
  for (let d = 12; d <= 180 && !out.hit; d += 2) {
    for (let a = 0; a < 360; a += 4) {
      const rad = a * Math.PI / 180;
      const x = cx + Math.cos(rad) * d, y = cy + Math.sin(rad) * d;
      move(x, y);
      if (tc.axis === 'Z') { out.hit = { x, y, d, a }; break; }
    }
  }
  move(cx + 900, cy + 900);
  return out;
}, { cx: ctx.cx, cy: ctx.cy });

if (R.gizmoZ.hit) {
  const h = R.gizmoZ.hit;
  const sel = await page.evaluate(() => PixiStudio.State.get('selection'));
  /* hướng kéo trục Z trên màn hình: chiếu (obj + 0.5Z) - obj */
  const dir = await page.evaluate(() => {
    const cam = PixiStudio.Viewport.orbit.camera;
    const sel2 = PixiStudio.State.get('selection');
    const r = document.getElementById('viewport-canvas-wrap').getBoundingClientRect();
    const proj = (v) => { const p = v.clone().project(cam); return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; };
    const pos = new THREE.Vector3().setFromMatrixPosition(sel2.matrixWorld);
    const z = proj(pos.clone().add(new THREE.Vector3(0, 0, 0.5)));
    const c = proj(pos);
    let dx = z.x - c.x, dy = z.y - c.y;
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    return { dx, dy };
  });
  const before = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(h.x + dir.dx * i * 16, h.y + dir.dy * i * 16, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  R.gizmoZ.delta = [after[0] - before[0], after[1] - before[1], after[2] - before[2]].map(n => +n.toFixed(3));
  R.gizmoZ.movedZ = Math.abs(R.gizmoZ.delta[2]) > 0.05;
}

/* 2) Ô nhập Z trong panel */
R.inputZ = await page.evaluate(() => {
  const sel = PixiStudio.State.get('selection');
  const nums = Array.from(document.querySelectorAll('#ix-camera-panel .ix-num'));
  const out = { numInputs: nums.length, before: sel.position.z };
  if (nums[2]) { nums[2].value = '1.25'; nums[2].dispatchEvent(new Event('change')); }
  out.after = +sel.position.z.toFixed(3);
  out.moved = out.after !== out.before;
  return out;
});

/* 3) Nút nudge Z▲ / Z▼ */
R.nudgeZ = await page.evaluate(() => {
  const sel = PixiStudio.State.get('selection');
  const btns = Array.from(document.querySelectorAll('#ix-camera-panel .ix-btn'));
  const b = t => btns.find(x => x.textContent.trim() === t);
  const out = {};
  sel.position.set(0, 0, 0);
  b('Z ▲').click();
  out.afterUp = +sel.position.z.toFixed(3);
  b('Z ▼').click();
  out.afterDown = +sel.position.z.toFixed(3);
  return out;
});

/* 4) Kéo object trực tiếp (select mode) — kéo dọc phải đổi Z, ngang đổi X */
R.dragObj = await page.evaluate(async () => {
  const sel = PixiStudio.State.get('selection');
  const out = {};
  sel.position.set(0, 0, 0);
  PixiStudio.Shortcuts.setGizmoMode('select');
  /* cần một điểm trên model trong viewport */
  const cam = PixiStudio.Viewport.orbit.camera;
  sel.updateMatrixWorld(true);
  const r = document.getElementById('viewport-canvas-wrap').getBoundingClientRect();
  const p = new THREE.Vector3().setFromMatrixPosition(sel.matrixWorld).project(cam);
  const cx = r.left + (p.x * 0.5 + 0.5) * r.width;
  const cy = r.top + (-p.y * 0.5 + 0.5) * r.height;
  return { cx, cy };
});
/* kéo thật: từ tâm model, kéo dọc xuống (thay đổi Z), rồi ngang (thay đổi X) */
{
  const { cx, cy } = R.dragObj;
  const before = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(cx + i * 2, cy + i * 10, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  R.dragObj.verticalDrag = { before, after, delta: [after[0] - before[0], after[1] - before[1], after[2] - before[2]].map(n => +n.toFixed(3)) };
}
/* kéo ngang đổi X */
{
  const before = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  const { cx, cy } = R.dragObj;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(cx + i * 10, cy, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => PixiStudio.State.get('selection').position.toArray().map(n => +n.toFixed(3)));
  R.dragObj.horizontalDrag = { before, after, delta: [after[0] - before[0], after[1] - before[1], after[2] - before[2]].map(n => +n.toFixed(3)) };
}

R.pageErrors = errs;
console.log(JSON.stringify(R, null, 1));
await browser.close();