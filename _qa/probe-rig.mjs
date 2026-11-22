import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.goto(process.env.QA_BASE + "/index.html", { waitUntil: "load", timeout: 60000 });
await p.waitForFunction(() => window.PixiStudio && PixiStudio.RigAutoGen && window.THREE && THREE.GLTFLoader, { timeout: 90000 });
await p.waitForTimeout(2500);
const r = await p.evaluate(async (url) => {
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(url, res, undefined, rej));
  const root = gltf.scene; root.name = "probe"; root.updateMatrixWorld(true);
  PixiStudio.State.set("selection", root);
  const rig = PixiStudio.AnimGLBExport.ensureRig(root, "Mixamo Compatible");
  const mapKeys = Object.keys(rig.bones || {});
  const sampleVals = mapKeys.slice(0, 4).map(k => ({ k, isBone: !!(rig.bones[k] && rig.bones[k].isBone), hasMW: !!(rig.bones[k] && rig.bones[k].matrixWorld) }));
  const trav = []; (function walk(o){ trav.push(o.name + (o.isBone ? "(bone)" : "")); (o.children||[]).forEach(walk); })(rig.rootBone);
  let sk = null; root.traverse(o => { if (o.isSkinnedMesh && !sk) sk = o; });
  const skelNames = sk && sk.skeleton ? sk.skeleton.bones.map(x => x.name) : [];
  return {
    mapKeyCount: mapKeys.length, mapKeys: mapKeys.slice(0, 8), sampleVals,
    rootBoneName: rig.rootBone && rig.rootBone.name,
    travCount: trav.length, trav: trav.slice(0, 8),
    skelCount: skelNames.length, skelNames: skelNames.slice(0, 8),
    matchFirst: mapKeys.length && skelNames.length ? (mapKeys[0] === skelNames[0]) : null,
    rigBoneCountProp: rig.boneCount
  };
}, "assets/models/tripo_convert_monter1.glb");
console.log(JSON.stringify(r, null, 1));
await b.close();
