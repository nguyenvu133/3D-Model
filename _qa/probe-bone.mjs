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
  const sm = built.skinnedMeshes[0];
  const pos = sm.geometry.attributes.position, si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight;
  let idx = -1; for (let i = 0; i < pos.count; i++) { if (pos.getX(i) > 0.5 && pos.getY(i) > 0.6) { idx = i; break; } }
  const names = built.boneList.map((x, k) => k + ':' + x.name);
  const w = idx >= 0 ? [0,1,2,3].map(k => ({ i: si.array[idx*4+k], w: +sw.array[idx*4+k].toFixed(3), name: built.boneList[si.array[idx*4+k]] ? built.boneList[si.array[idx*4+k]].name : '?' })) : null;
  return { idx, v: idx>=0 ? [pos.getX(idx), pos.getY(idx), pos.getZ(idx)].map(v=>+v.toFixed(3)) : null, w,
    tail: names.slice(56), boneCount: names.length,
    usedBones: Array.from(new Set(Array.from(si.array).filter((_,i)=>sw.array[i]>0.05))).length };
}, "assets/models/tripo_convert_monter1.glb");
console.log(JSON.stringify(r, null, 1));
await b.close();
