import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.goto(process.env.QA_BASE + "/index.html", { waitUntil: "load", timeout: 60000 });
await p.waitForFunction(() => window.PixiStudio && PixiStudio.MixamoSkeleton && window.THREE && THREE.GLTFLoader, { timeout: 90000 });
await p.waitForTimeout(2500);
const r = await p.evaluate(async (url) => {
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(url, res, undefined, rej));
  const root = gltf.scene; root.updateMatrixWorld(true);
  PixiStudio.State.set("selection", root);
  const built = PixiStudio.MixamoSkeleton.build(root, { height: 1.8 });
  const sm = built.skinnedMeshes[0], sk = sm.skeleton;
  sm.updateMatrixWorld(true); sk.update();
  const pos = sm.geometry.attributes.position, si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight;
  let idx = -1; for (let i = 0; i < pos.count; i++) { if (pos.getX(i) > 0.5) { idx = i; break; } }
  const info = { idx, v: idx >= 0 ? [pos.getX(idx), pos.getY(idx), pos.getZ(idx)] : null,
    idx4: idx >= 0 ? [si.getX(idx), si.getY(idx), si.getZ(idx), si.getW(idx)] : null,
    w4: idx >= 0 ? [sw.getX(idx), sw.getY(idx), sw.getZ(idx), sw.getW(idx)] : null,
    skelBones: sk.bones.length, inv: sk.boneInverses.length, bm: sk.boneMatrices.length };
  const armIdx = sk.bones.findIndex(x => /RightArm$/.test(x.name));
  info.armBoneIndex = armIdx;
  const bmBefore = Array.from(sk.boneMatrices.slice(armIdx * 16, armIdx * 16 + 16)).map(v => +v.toFixed(3));
  const bone = sk.bones[armIdx];
  bone.rotation.z += Math.PI / 4;
  built.group.updateMatrixWorld(true);
  sk.update();
  const bmAfter = Array.from(sk.boneMatrices.slice(armIdx * 16, armIdx * 16 + 16)).map(v => +v.toFixed(3));
  info.boneMatrixChanged = JSON.stringify(bmBefore) !== JSON.stringify(bmAfter);
  if (idx >= 0) {
    const t1 = new THREE.Vector3().fromBufferAttribute(pos, idx); sm.boneTransform(idx, t1);
    info.afterSkinned = [t1.x, t1.y, t1.z].map(v => +v.toFixed(4));
  }
  return info;
}, "assets/models/tripo_convert_monter1.glb");
console.log(JSON.stringify(r, null, 1));
await b.close();
