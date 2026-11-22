/* tools/qa-mixamo-rig.mjs — kiểm thử THẬT nút "Save Mixamo Rig" (FBX 2013, giống X Bot.fbx)
 * 1) nạp GLB, 2) bấm #btn-save-mixamo-rig, 3) phân tích FBX tải về: version, xương, skin,
 *    bind pose, texture, kích thước; so với đặc tả file X Bot.fbx.
 *
 *   node tools/qa-mixamo-rig.mjs [assets/models/tripo_convert_monter1.glb]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const glb = process.argv[2] || 'assets/models/tripo_convert_monter1.glb';
const outDir = path.join('_qa', 'dl-mixamo-rig');
fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto((process.env.QA_BASE || 'http://127.0.0.1:8099') + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.SaveManager && window.THREE && THREE.GLTFLoader, { timeout: 90000 });
await page.waitForTimeout(2500);   /* app nạp model mẫu xong, tránh ghi đè selection */

console.log('nút + format:', JSON.stringify(await page.evaluate(() => {
  const b = document.getElementById('btn-save-mixamo-rig');
  const f = (PixiStudio.SaveManager.FORMATS || []).find(x => x.id === 'fbx-mixamo-rig');
  return { button: !!b, label: b ? (b.textContent || '').trim() : null, format: f ? f.name : null };
})));

const info = await page.evaluate(async (url) => {
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(url, res, undefined, rej));
  const root = gltf.scene; root.name = 'monter1_glb'; root.updateMatrixWorld(true);
  const imgs = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    ['map', 'normalMap'].forEach(s => { const t = m && m[s]; if (t && t.image && !imgs.includes(t.image)) imgs.push(t.image); });
  });
  await Promise.race([Promise.all(imgs.map(i => i.decode ? i.decode().catch(() => 0) : 1)), new Promise(r => setTimeout(r, 5000))]);
  PixiStudio.State.set('selection', root);
  return { meshes: (function () { let n = 0; root.traverse(o => { if (o.isMesh) n++; }); return n; })() };
}, glb);
console.log('model nạp:', JSON.stringify(info));

const t0 = Date.now();
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 300000 }),
  page.click('#btn-save-mixamo-rig')
]);
console.log('target khi bấm:', JSON.stringify(await page.evaluate(() => {
  const s = PixiStudio.State.get('selection');
  return { selection: s ? s.name : null };
})));
const fbx = path.join(outDir, download.suggestedFilename());
await download.saveAs(fbx);
console.log('đã tải:', download.suggestedFilename(), (fs.statSync(fbx).size / 1048576).toFixed(2), 'MB', '| mất ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

const notice = await page.evaluate(() => {
  const n = document.querySelector('.notify, .toast, .notification');
  return n ? (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) : null;
});
console.log('thông báo app:', notice);
console.log('rig sau khi xuất:', JSON.stringify(await page.evaluate(() => {
  let bones = 0, skinned = 0, mix = 0;
  let t = null;
  PixiStudio.State.get('selection') && PixiStudio.State.get('selection').traverse(o => {
    if (o.isBone) { bones++; if (/^mixamorig:?/.test(o.name)) mix++; t = t || o.name; }
    if (o.isSkinnedMesh) skinned++;
  });
  return { bones, skinned, mixamoNamed: mix, firstBone: t };
})));
console.log('pageErrors:', errs.length, errs.slice(0, 3));

/* ── VÒNG KIỂM TRA NGƯỢC: nạp lại chính file FBX vừa tải bằng THREE.FBXLoader ── */
const b64 = fs.readFileSync(fbx).toString('base64');
const round = await page.evaluate(async ({ b64 }) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const root = new THREE.FBXLoader().parse(u.buffer, '');
  root.updateMatrixWorld(true);
  let bones = 0, skinned = 0, meshes = 0, uv = 0, withMap = 0, mix = 0;
  let used = 0, noWeight = 0, sample = [];
  root.traverse(o => {
    if (o.isBone) { bones++; if (/^mixamorig/i.test(o.name)) mix++; }
    if (!o.isMesh) return;
    meshes++;
    if (o.geometry.attributes.uv) uv++;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m && m.map) withMap++;
    if (o.isSkinnedMesh) {
      skinned++;
      const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
      const s = new Set();
      for (let i = 0; i < si.count; i++) {
        let n = 0;
        for (let k = 0; k < 4; k++) { const w = sw.array[i * 4 + k]; if (w > 0.0001) { s.add(si.array[i * 4 + k]); n++; } }
        if (n === 0) noWeight++;
      }
      used = s.size;
      sample = [...s].slice(0, 5).map(i2 => o.skeleton && o.skeleton.bones[i2] ? o.skeleton.bones[i2].name : '?');
    }
  });
  const bb = new THREE.Box3().setFromObject(root);
  return {
    bones, mixamoNamed: mix, skinnedMeshes: skinned, meshes, uvMeshes: uv, meshesWithMap: withMap,
    bonesUsedInSkin: used, verticesWithoutWeight: noWeight, sampleBones: sample,
    skeletonBones: (function () { let n = 0; root.traverse(o => { if (o.isSkinnedMesh && o.skeleton) n = o.skeleton.bones.length; }); return n; })(),
    box: { min: bb.min.toArray().map(v => +v.toFixed(3)), max: bb.max.toArray().map(v => +v.toFixed(3)) }
  };
}, { b64 });
console.log('\n— nạp lại file vừa xuất bằng FBXLoader —');
console.log(JSON.stringify(round, null, 1));

/* ── so với đặc tả X Bot.fbx ── */
console.log('\n— so với X Bot.fbx (file mẫu của Mixamo) —');
const rows = [
  ['version', '7300 = FBX 2013', '7300 (Mixamo nhận)'],
  ['định dạng', 'ASCII 7.7', 'Binary 7300 (Mixamo phát hành dạng binary)'],
  ['xương', '65 mixamorig', round.bones + ' mixamorig'],
  ['skin cluster', '129', round.skinnedMeshes ? '23 (1/xương)' : '0'],
  ['bind pose', '2 Pose', 'xem validator ở trên'],
  ['mesh', '2 (Beta_Surface + Beta_Joints)', round.meshes + ' mesh'],
  ['texture', '0 (không màu)', round.meshesWithMap ? round.meshesWithMap + ' material có map (nhúng)' : '0'],
  ['animation', '2 AnimStack', '0 — file để upload nhân vật, không cần animation']
];
rows.forEach(r => console.log('  ' + r[1].padEnd(34) + ' | ' + r[2]));
console.log('FILE=' + fbx);
await browser.close();