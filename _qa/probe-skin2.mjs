import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.goto(process.env.QA_BASE + "/index.html", { waitUntil: "load", timeout: 60000 });
await p.waitForFunction(() => window.PixiStudio && PixiStudio.MixamoSkeleton && window.THREE && THREE.GLTFLoader, { timeout: 90000 });
await p.waitForTimeout(2000);
const r = await p.evaluate(async (url) => {
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(url, res, undefined, rej));
  const root = gltf.scene; root.updateMatrixWorld(true);
  PixiStudio.State.set("selection", root);
  const built = PixiStudio.MixamoSkeleton.build(root, { height: 1.8 });
  const sm = built.skinnedMeshes[0], sk = sm.skeleton;
  built.group.updateMatrixWorld(true); sk.update();
  const pos = sm.geometry.attributes.position, si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight;
  /* chọn đỉnh có weight lớn nhất vào 1 xương, lấy xương đó làm mục tiêu */
  let best = -1, bestW = 0, bestBone = -1;
  for (let i = 0; i < pos.count; i += 7) {
    for (let k = 0; k < 4; k++) {
      const w = sw.array[i*4+k];
      if (w > bestW) { bestW = w; best = i; bestBone = si.array[i*4+k]; }
    }
  }
  const bone = sk.bones[bestBone];
  const name = bone.name;
  const v0 = new THREE.Vector3().fromBufferAttribute(pos, best);
  const t1 = v0.clone(); sm.boneTransform(best, t1);
  const bp0 = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
  bone.rotation.z += Math.PI / 3;
  built.group.updateMatrixWorld(true); sk.update();
  const bp1 = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
  const t2 = v0.clone(); sm.boneTransform(best, t2);
  return { pickedIndex: best, boneIndex: bestBone, boneName: name, weight: +bestW.toFixed(3),
    vertex: [v0.x, v0.y, v0.z].map(x=>+x.toFixed(3)),
    skinnedBefore: [t1.x,t1.y,t1.z].map(x=>+x.toFixed(3)),
    skinnedAfter: [t2.x,t2.y,t2.z].map(x=>+x.toFixed(3)),
    moved: +t1.distanceTo(t2).toFixed(4),
    boneMoved: +bp0.distanceTo(bp1).toFixed(4),
    bonePos: [bp1.x,bp1.y,bp1.z].map(x=>+x.toFixed(3)) };
}, "assets/models/tripo_convert_monter1.glb");
console.log(JSON.stringify(r, null, 1));
await b.close();
