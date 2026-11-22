/* tools/qa-fbx-mixamo.mjs — xuất FBX 2 loại (có skeleton + mesh-only), kiểm tra FBXLoader */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const OUT = path.join(process.cwd(), '_qa'); fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.Models.loadGLBFromBuffer && PixiStudio.FBXBinary, { timeout: 90000 });
await page.waitForTimeout(700);

const R = await page.evaluate(async () => {
  const out = {};
  const buf = await (await fetch('assets/models/tripo_convert_monter1.glb')).arrayBuffer();
  const entry = await PixiStudio.Models.loadGLBFromBuffer(buf, 'MIX', buf.byteLength);
  const target = entry.object3D;
  PixiStudio.RigAutoGen.generate(target, 'Studio Humanoid');

  const makeFBX = async (opts, label) => {
    const res = PixiStudio.FBXBinary.write(target, opts);
    let s = ''; const CH = 32768;
    for (let i = 0; i < res.bytes.length; i += CH) s += String.fromCharCode.apply(null, res.bytes.subarray(i, Math.min(i + CH, res.bytes.length)));
    let reload = null;
    try {
      const obj = new THREE.FBXLoader().parse(res.bytes.buffer.slice(0), '');
      let bones = 0, skinned = 0, meshes = 0;
      obj.traverse(o => { if (o.isBone) bones++; if (o.isSkinnedMesh) skinned++; if (o.isMesh) meshes++; });
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      reload = { ok: true, bones, skinned, meshes, size: size.toArray().map(v => +v.toFixed(3)) };
    } catch (e) { reload = { ok: false, error: String(e && e.message || e) }; }
    out[label] = { bytes: res.bytes.length, report: res.report, reload, b64: btoa(s) };
  };

  await makeFBX({}, 'withSkeleton');
  await makeFBX({ noSkeleton: true }, 'meshOnly');
  return out;
});

for (const k of ['withSkeleton', 'meshOnly']) {
  const f = path.join(OUT, 'fbx-' + k + '.fbx');
  fs.writeFileSync(f, Buffer.from(R[k].b64, 'base64'));
  console.log(k, 'bytes=', R[k].bytes, 'report=', JSON.stringify(R[k].report), 'reload=', JSON.stringify(R[k].reload));
}
R.pageErrors = errs;
console.log('PAGE ERRORS', errs.length, errs.slice(0, 3));
await browser.close();