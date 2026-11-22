/* tools/qa-rigdup.mjs — kiểm tra: 2 nút rig có tạo 2 bộ xương chồng nhau? + model có tràn màn hình? */
import { chromium } from 'playwright-core';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.Models.loadGLBFromBuffer && PixiStudio.RigAutoGen, { timeout: 90000 });
await page.waitForTimeout(700);

const R = await page.evaluate(async () => {
  const out = {};
  const buf = await (await fetch('assets/models/tripo_convert_monter1.glb')).arrayBuffer();
  const entry = await PixiStudio.Models.loadGLBFromBuffer(buf, 'DupTest', buf.byteLength);
  const target = entry.object3D;

  const countBones = () => { let n = 0; target.traverse(o => { if (o.isBone) n++; }); return n; };
  const countRigRoots = () => { let n = 0; target.traverse(o => { if (o.name === '__autogen_rig__' || o.name === '__creature_rig_wrapper__' || o.name === '__creature_rig__') n++; }); return n; };
  const countSkinned = () => { let n = 0; target.traverse(o => { if (o.isSkinnedMesh) n++; }); return n; };
  const countHelpers = () => { let n = 0; PixiStudio.Viewport.scene.traverse(o => { if (o.isSkeletonHelper) n++; }); return n; };

  out.start = { bones: countBones(), rigRoots: countRigRoots(), skinned: countSkinned(), helpers: countHelpers() };

  /* nút 1: Studio Humanoid (23 bone) */
  PixiStudio.RigAutoGen.generate(target, 'Studio Humanoid');
  await new Promise(r => setTimeout(r, 200));
  out.afterStudio = { bones: countBones(), rigRoots: countRigRoots(), skinned: countSkinned(), helpers: countHelpers(), current: PixiStudio.RigAutoGen.current ? PixiStudio.RigAutoGen.current.name : null };

  /* nút 2: Mixamo Compatible */
  PixiStudio.RigAutoGen.generate(target, 'Mixamo Compatible');
  await new Promise(r => setTimeout(r, 200));
  out.afterMixamo = { bones: countBones(), rigRoots: countRigRoots(), skinned: countSkinned(), helpers: countHelpers(), current: PixiStudio.RigAutoGen.current ? PixiStudio.RigAutoGen.current.name : null };

  /* CreatureRigs human (66 bone) */
  if (PixiStudio.CreatureRigs) {
    await PixiStudio.CreatureRigs.build(target, 'human');
    await new Promise(r => setTimeout(r, 300));
    out.afterCreature = { bones: countBones(), rigRoots: countRigRoots(), skinned: countSkinned(), helpers: countHelpers(), current: PixiStudio.RigAutoGen.current ? PixiStudio.RigAutoGen.current.name : null };
  }

  /* framing: bbox model vs khung hình camera */
  const cam = PixiStudio.Viewport.orbit.camera;
  const box = new THREE.Box3().setFromObject(target);
  const size = box.getSize(new THREE.Vector3());
  const pts = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).project(cam);
    pts.push([+p.x.toFixed(2), +p.y.toFixed(2)]);
  }
  out.frame = {
    bbox: size.toArray().map(v => +v.toFixed(2)),
    ndcMin: [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1]))],
    ndcMax: [Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))],
    radius: +PixiStudio.Viewport.orbit.dRadius.toFixed(2),
    overflow: Math.max(...pts.map(p => Math.max(Math.abs(p[0]), Math.abs(p[1]))))
  };
  return out;
});
console.log(JSON.stringify({ ...R, pageErrors: errs }, null, 1));
await browser.close();