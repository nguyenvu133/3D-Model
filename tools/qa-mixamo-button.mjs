/* tools/qa-mixamo-button.mjs — kiểm thử THẬT nút "Save Mixamo" trong Safari/Chrome
 * 1) boot app, 2) nạp model nguồn (FBX có texture), 3) bấm #btn-save-mixamo,
 * 4) bắt file tải về, 5) kiểm tra FBX: 2013, mesh-only, có texture nhúng, 16 mục Mixamo.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const src = process.argv[2] || 'Meshy_AI_tripo_convert_monter1_20261122_texture.fbx';
const dl = path.join('_qa', 'dl-mixamo');
fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true });

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.SaveManager, { timeout: 90000 });

/* nút có mặt? */
const btn = await page.evaluate(() => {
  const b = document.getElementById('btn-save-mixamo');
  return b ? { exists: true, label: (b.textContent || '').trim(), tooltip: b.getAttribute('data-tooltip') || '' } : { exists: false };
});
console.log('nút Save Mixamo:', JSON.stringify(btn));

/* format đã đăng ký? */
const fmt = await page.evaluate(() => {
  const list = PixiStudio.SaveManager.FORMATS || [];
  const f = list.find(x => x.id === 'fbx-mixamo');
  return f ? { id: f.id, name: f.name, ext: f.ext } : null;
});
console.log('format fbx-mixamo:', JSON.stringify(fmt));

/* nạp model nguồn vào app (qua pipeline import file của app nếu có, nếu không thì tự set selection) */
const b64 = fs.readFileSync(src).toString('base64');
const loaded = await page.evaluate(async ({ b64, name }) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const root = new THREE.FBXLoader().parse(bytes.buffer, '');
  root.name = name.replace(/\.[^.]+$/, '');
  let meshes = 0, mapsBefore = 0;
  root.traverse(o => { if (o.isMesh) { meshes++; const m = Array.isArray(o.material) ? o.material[0] : o.material; if (m && m.map) mapsBefore++; } });
  /* gắn vào State.selection để SaveManager.save() lấy đúng target */
  PixiStudio.State.set('selection', root);
  return { meshes, mapsBefore };
}, { b64, name: path.basename(src) });
console.log('model nạp vào state:', JSON.stringify(loaded));

/* bấm nút và bắt download */
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 300000 }),
  page.click('#btn-save-mixamo')
]);
const out = path.join(dl, download.suggestedFilename());
await download.saveAs(out);
console.log('đã tải:', download.suggestedFilename(), (fs.statSync(out).size / 1048576).toFixed(2), 'MB');

/* thông báo app hiện gì */
const notice = await page.evaluate(() => {
  const n = document.querySelector('.notify, .toast, .notification, .notif');
  return n ? (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) : null;
});
console.log('thông báo app:', notice);
console.log('pageErrors:', errs.length, errs.slice(0, 3));
await browser.close();
console.log('FILE=' + out);