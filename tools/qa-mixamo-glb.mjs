/* tools/qa-mixamo-glb.mjs — import GLB (nguồn Meshy/Tripo) → bấm "Save Mixamo" → tải FBX
 * Dùng để kiểm chứng texture có bị lộn chiều khi nguồn là GLB không.
 *   node tools/qa-mixamo-glb.mjs assets/models/tripo_convert_monter1.glb
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const glb = process.argv[2] || 'assets/models/tripo_convert_monter1.glb';
const outDir = path.join('_qa', 'dl-mixamo-glb');
fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto((process.env.QA_BASE || 'http://127.0.0.1:8099') + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.SaveManager && window.THREE && THREE.GLTFLoader, { timeout: 90000 });

const info = await page.evaluate(async (url) => {
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(url, res, undefined, rej));
  const root = gltf.scene; root.name = 'monter1_glb'; root.updateMatrixWorld(true);
  const imgs = [];
  let meshes = 0, tris = 0, maps = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    ['map', 'normalMap', 'roughnessMap', 'metalnessMap'].forEach(s => {
      const t = m && m[s];
      if (t && t.image && !imgs.includes(t.image)) imgs.push(t.image);
      if (s === 'map' && t && t.image) maps++;
    });
  });
  await Promise.race([
    Promise.all(imgs.map(im => im.decode ? im.decode().catch(() => 0) : 1)),
    new Promise(r => setTimeout(r, 4000))
  ]);
  const meta = imgs.map(im => ({ w: im.width, h: im.height, flipY: undefined }));
  let flipY = null;
  root.traverse(o => { if (!o.isMesh) return; const m = Array.isArray(o.material) ? o.material[0] : o.material; if (m && m.map) flipY = m.map.flipY; });
  PixiStudio.State.set('selection', root);
  return { meshes, tris: Math.round(tris), maps, images: imgs.length, meta, mapFlipY: flipY };
}, glb);
console.log('GLB nạp:', JSON.stringify(info));

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 300000 }),
  page.click('#btn-save-mixamo')
]);
const out = path.join(outDir, download.suggestedFilename());
await download.saveAs(out);
console.log('đã tải:', download.suggestedFilename(), (fs.statSync(out).size / 1048576).toFixed(2), 'MB');
console.log('pageErrors:', errs.length, errs.slice(0, 3));
console.log('FILE=' + out);
await browser.close();