/* tools/qa-rig-deform.mjs — chứng minh skin hoạt động
 *  - A: chọn đỉnh xa nhất (đầu chi), xoay ĐÚNG xương mạnh nhất của đỉnh đó 45° → đỉnh phải dịch
 *  - B: xoay xương tay → đỉnh ĐẦU phải gần như đứng yên (weight không lem)
 *  - C: in bảng xương nào giữ bao nhiêu đỉnh
 *
 *   node tools/qa-rig-deform.mjs [assets/models/x.glb]
 */
import { chromium } from 'playwright-core';

const glb = process.argv[2] || 'assets/models/tripo_convert_monter1.glb';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto((process.env.QA_BASE || 'http://127.0.0.1:8099') + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.MixamoSkeleton && PixiStudio.MixamoSkeletonData && window.THREE && THREE.GLTFLoader, { timeout: 90000 });
await page.waitForTimeout(2000);

const r = await page.evaluate(async (url) => {
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(url, res, undefined, rej));
  const root = gltf.scene; root.name = 'probe'; root.updateMatrixWorld(true);
  PixiStudio.State.set('selection', root);

  const built = PixiStudio.MixamoSkeleton.build(root, { height: 1.8 });
  const sm = built.skinnedMeshes[0], sk = sm.skeleton;
  built.group.updateMatrixWorld(true); sk.update();

  const pos = sm.geometry.attributes.position, si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight;
  const skinAt = (i) => {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    sm.boneTransform(i, v);
    return v;
  };
  /* đỉnh xa nhất theo |x| = đầu chi; đỉnh cao nhất = đầu */
  let iFar = 0, maxAbsX = -1, iTop = 0, maxY = -1;
  for (let i = 0; i < pos.count; i++) {
    const x = Math.abs(pos.getX(i)), y = pos.getY(i);
    if (x > maxAbsX) { maxAbsX = x; iFar = i; }
    if (y > maxY) { maxY = y; iTop = i; }
  }
  const dominant = (i) => { let b = -1, w = 0; for (let k = 0; k < 4; k++) { const ww = sw.array[i * 4 + k]; if (ww > w) { w = ww; b = si.array[i * 4 + k]; } } return { bone: b, weight: w }; };

  const dFar = dominant(iFar);
  const before = skinAt(iFar);
  sk.bones[dFar.bone].rotation.z += Math.PI / 4;
  built.group.updateMatrixWorld(true); sk.update();
  const after = skinAt(iFar);
  const movedFar = +before.distanceTo(after).toFixed(4);

  /* B: xoay xương tay trái → đỉnh đầu không được lem */
  const headBefore = skinAt(iTop);
  const leftArm = sk.bones.findIndex(x => /LeftArm$/.test(x.name));
  if (leftArm >= 0) sk.bones[leftArm].rotation.z += Math.PI / 3;
  built.group.updateMatrixWorld(true); sk.update();
  const headAfter = skinAt(iTop);
  const movedHead = +headBefore.distanceTo(headAfter).toFixed(4);

  /* C: đếm đỉnh theo xương */
  const count = {};
  for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) {
    const w = sw.array[i * 4 + k]; if (w > 0.15) { const b = si.array[i * 4 + k]; count[b] = (count[b] || 0) + 1; }
  }
  const table = Object.keys(count).map(b => ({ bone: sk.bones[b] ? sk.bones[b].name : '?', verts: count[b] }))
    .sort((a, b) => b.verts - a.verts);
  let noWeight = 0;
  for (let i = 0; i < si.count; i++) { let w = 0; for (let k = 0; k < 4; k++) w += sw.array[i * 4 + k]; if (w < 0.001) noWeight++; }

  return {
    bones: built.stats.bones, bonesUsed: built.stats.bonesUsed, vertices: built.stats.vertices,
    farVertex: { idx: iFar, pos: [pos.getX(iFar), pos.getY(iFar), pos.getZ(iFar)].map(v => +v.toFixed(3)), bone: sk.bones[dFar.bone].name, weight: +dFar.weight.toFixed(3), moved: movedFar },
    headVertex: { idx: iTop, pos: [0, pos.getY(iTop), 0].map(v => +v.toFixed(3)), movedWhenArmRotated: movedHead },
    verticesWithoutWeight: noWeight,
    topBones: table.slice(0, 10), boneCount: table.length
  };
}, glb);

console.log(JSON.stringify(r, null, 1));
const okA = r.farVertex.moved > 0.02;
const okB = r.headVertex.movedWhenArmRotated < 0.02;
console.log(okA ? '=> A. Skin biến dạng ĐÚNG: xoay xương của đỉnh đầu chi → đỉnh dịch ' + r.farVertex.moved + ' ✓' : '=> A. LỖI: đỉnh không dịch ✗');
console.log(okB ? '=> B. Weight không lem: xoay tay, đỉnh đầu chỉ dịch ' + r.headVertex.movedWhenArmRotated + ' ✓' : '=> B. LỖI: weight lem sang đầu ✗');
console.log('pageErrors:', errs.length, errs.slice(0, 3));
await browser.close();