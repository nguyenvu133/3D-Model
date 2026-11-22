/* tools/qa-skin-deform.mjs — đo biến dạng THẬT bằng công thức skinning trên CPU
 * skinned = Σ w_k · (boneMatrix_k · bindMatrix · v) rồi so bbox với lúc nghỉ.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const OUT = path.join(process.cwd(), '_qa');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.CreatureRigs, { timeout: 90000 });
await page.waitForTimeout(600);

const res = await page.evaluate(async () => {
  const C = PixiStudio.CreatureRigs, M = PixiStudio.M2MMotion;
  await M.loadCatalog();
  const out = [];

  const skinBox = (mesh) => {
    mesh.skeleton.update();
    const g = mesh.geometry, pos = g.attributes.position, sw = g.attributes.skinWeight, si = g.attributes.skinIndex;
    const p = new THREE.Vector3(), acc = new THREE.Vector3(), t = new THREE.Vector3(), mat = new THREE.Matrix4();
    const b = new THREE.Box3();
    const step = Math.max(1, Math.floor(pos.count / 800));
    for (let i = 0; i < pos.count; i += step) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
      acc.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = sw.array[i * 4 + k]; if (!w) continue;
        mat.fromArray(mesh.skeleton.boneMatrices, si.array[i * 4 + k] * 16);
        t.copy(p).applyMatrix4(mat); acc.addScaledVector(t, w);
      }
      acc.applyMatrix4(mesh.matrixWorld);
      b.expandByPoint(acc);
    }
    return b;
  };

  for (const rigId of ['fox', 'horse', 'kaiju', 'dragon', 'bird', 'snake', 'shark', 'spider']) {
    const buf = await (await fetch('assets/models/tripo_convert_monter1.glb')).arrayBuffer();
    const entry = await PixiStudio.Models.loadGLBFromBuffer(buf, 'S_' + rigId, buf.byteLength);
    const target = entry.object3D;
    const rig = await C.build(target, rigId);
    if (!rig) { out.push({ rigId, error: 'build null' }); PixiStudio.Models.remove(entry.id); continue; }
    let mesh = null; target.traverse(o => { if (!mesh && o.isSkinnedMesh) mesh = o; });
    const anims = M.motions(rigId);
    const a = anims[0];
    M.loop = true; M.useRootMotion = false;
    /* nghỉ: tắt hết action */
    rig.mixer.stopAllAction();
    target.updateMatrixWorld(true);
    const restBox = skinBox(mesh);
    const info = await M.play(a.url, a.name);
    let maxRatio = 1, worst = null;
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 180));
      target.updateMatrixWorld(true);
      const bb = skinBox(mesh);
      const s1 = restBox.getSize(new THREE.Vector3()), s2 = bb.getSize(new THREE.Vector3());
      const ratio = Math.max(s2.x / Math.max(1e-4, s1.x), s2.y / Math.max(1e-4, s1.y), s2.z / Math.max(1e-4, s1.z));
      if (ratio > maxRatio) { maxRatio = ratio; worst = { rest: s1.toArray().map(v => +v.toFixed(2)), now: s2.toArray().map(v => +v.toFixed(2)) }; }
    }
    out.push({ rigId, anim: a.name, tracks: info ? info.tracks : 0, maxRatio: +maxRatio.toFixed(2), worst, sane: maxRatio < 1.8 });
    PixiStudio.Models.remove(entry.id);
    await new Promise(r => setTimeout(r, 100));
  }
  return out;
});
res.forEach(r => console.log(r.rigId.padEnd(8), 'anim=' + (r.anim || '-').padEnd(10), 'tracks=' + String(r.tracks).padEnd(4), 'bboxRatio=' + r.maxRatio, r.sane ? 'SANE' : '⚠ LỚN BẤT THƯỜNG', r.worst ? JSON.stringify(r.worst) : '', r.error || ''));
fs.writeFileSync(path.join(OUT, 'skin-deform.json'), JSON.stringify(res, null, 1));
await browser.close();
