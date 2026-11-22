/* tools/qa-rig-skin-probe.mjs — đo dữ liệu skin sau auto-rig: bao nhiêu xương thực sự có weight
 *   node tools/qa-rig-skin-probe.mjs [assets/models/x.glb]
 */
import { chromium } from 'playwright-core';

const glb = process.argv[2] || 'assets/models/tripo_convert_monter1.glb';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto((process.env.QA_BASE || 'http://127.0.0.1:8099') + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.RigAutoGen && window.THREE && THREE.GLTFLoader, { timeout: 90000 });
await page.waitForTimeout(2500);

const r = await page.evaluate(async (url) => {
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(url, res, undefined, rej));
  const root = gltf.scene; root.name = 'probe'; root.updateMatrixWorld(true);
  PixiStudio.State.set('selection', root);

  const rig = PixiStudio.AnimGLBExport && PixiStudio.AnimGLBExport.ensureRig
    ? PixiStudio.AnimGLBExport.ensureRig(root, 'Mixamo Compatible')
    : PixiStudio.RigAutoGen.generate(root, 'Mixamo Compatible');
  root.updateMatrixWorld(true);

  const out = { rigPreset: rig && rig.preset, rigBones: rig && Object.keys(rig.bones || {}).length, meshes: [] };
  root.traverse(o => {
    if (!o.isMesh) return;
    const rec = { name: o.name, isSkinned: !!o.isSkinnedMesh, hasSkinAttrs: !!(o.geometry.attributes.skinIndex && o.geometry.attributes.skinWeight) };
    if (o.geometry.attributes.skinIndex) {
      const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
      const used = new Set();
      let zeroW = 0, maxBonesPerVert = 0;
      for (let i = 0; i < si.count; i++) {
        let n = 0;
        for (let k = 0; k < 4; k++) {
          const w = sw.array[i * 4 + k];
          if (w > 0.0001) { used.add(si.array[i * 4 + k]); n++; }
        }
        if (n === 0) zeroW++;
        if (n > maxBonesPerVert) maxBonesPerVert = n;
      }
      rec.bonesUsed = used.size;
      rec.boneIndexRange = [Math.min(...used), Math.max(...used)];
      rec.skeletonBones = o.skeleton ? o.skeleton.bones.length : 0;
      rec.vertexNoWeight = zeroW;
      rec.maxInfluences = maxBonesPerVert;
      rec.sampleBoneNames = [...used].slice(0, 6).map(i2 => o.skeleton && o.skeleton.bones[i2] ? o.skeleton.bones[i2].name : '?');
    }
    out.meshes.push(rec);
  });
  return out;
}, glb);

console.log(JSON.stringify(r, null, 1));
console.log('pageErrors:', errs.length, errs.slice(0, 3));
await browser.close();