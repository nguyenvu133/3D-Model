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
  const pos = sm.geometry.attributes.position;
  let idx = -1; for (let i = 0; i < pos.count; i++) { if (pos.getX(i) > 0.5 && pos.getY(i) > 0.6) { idx = i; break; } }
  const v = new THREE.Vector3().fromBufferAttribute(pos, idx);
  const wp = {};
  built.boneList.forEach(bo => { const w = new THREE.Vector3().setFromMatrixPosition(bo.matrixWorld); wp[bo.name] = [+w.x.toFixed(3), +w.y.toFixed(3), +w.z.toFixed(3)]; });
  return { v: [v.x, v.y, v.z].map(x => +x.toFixed(3)),
    LeftArm: wp['mixamorig:LeftArm'], LeftForeArm: wp['mixamorig:LeftForeArm'], LeftHand: wp['mixamorig:LeftHand'],
    LeftUpLeg: wp['mixamorig:LeftUpLeg'], LeftLeg: wp['mixamorig:LeftLeg'], LeftFoot: wp['mixamorig:LeftFoot'],
    RightArm: wp['mixamorig:RightArm'], Hips: wp['mixamorig:Hips'], Head: wp['mixamorig:Head'],
    groupScale: built.group.scale.toArray(), meshWorld: sm.matrixWorld.elements.slice(12, 15)
  };
}, "assets/models/tripo_convert_monter1.glb");
console.log(JSON.stringify(r, null, 1));
await b.close();
