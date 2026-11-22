/* tools/qa-fbx.mjs — xuất FBX binary từ model đã rig rồi nạp lại bằng FBXLoader */
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

const R = {};
R.moduleLoaded = await page.evaluate(() => !!(window.PixiStudio && PixiStudio.FBXBinary));

const out = await page.evaluate(async () => {
  const r = {};
  /* 1) nạp nhân vật tĩnh rồi auto-rig (có skin) */
  const buf = await (await fetch('assets/models/tripo_convert_monter1.glb')).arrayBuffer();
  const entry = await PixiStudio.Models.loadGLBFromBuffer(buf, 'FBXTest', buf.byteLength);
  const rig = PixiStudio.RigAutoGen.generate(entry.object3D, 'Studio Humanoid');
  r.rig = rig ? { bones: rig.boneCount, skinned: rig.skinnedCount } : null;
  const target = entry.object3D;

  /* 2) ghi FBX binary */
  const res = PixiStudio.FBXBinary.write(target, { fps: 30 });
  r.report = res.report;
  const bytes = res.bytes;
  /* lưu ra base64 để Node kiểm tra thêm */
  let s = '';
  const CH = 32768;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
  r.b64 = btoa(s);
  r.header = String.fromCharCode.apply(null, bytes.subarray(0, 21));
  r.version = new DataView(bytes.buffer, bytes.byteOffset).getUint32(23, true);

  /* 3) đọc lại cấu trúc node bằng reader của mình */
  const tree = PixiStudio.FBXBinary.read(bytes);
  r.topNodes = tree.map(n => n.name);
  const find = (nodes, name) => nodes.some(n => n.name === name);
  const objectsNode = tree.find(n => n.name === 'Objects');
  r.objectTypes = objectsNode ? Array.from(new Set(objectsNode.children.map(c => c.name))) : [];
  r.counts = {};
  if (objectsNode) objectsNode.children.forEach(c => { r.counts[c.name] = (r.counts[c.name] || 0) + 1; });
  const connNode = tree.find(n => n.name === 'Connections');
  r.connections = connNode ? connNode.children.length : 0;
  r.hasPose = objectsNode ? objectsNode.children.some(c => c.name === 'Pose') : false;

  /* 4) nạp lại bằng FBXLoader (giống Mixamo/Blender sẽ đọc) */
  try {
    const obj = new THREE.FBXLoader().parse(bytes.buffer.slice(0), '');
    let bones = 0, skinned = 0, meshes = 0;
    obj.traverse(o => { if (o.isBone) bones++; if (o.isSkinnedMesh) skinned++; if (o.isMesh) meshes++; });
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    r.reload = { ok: true, bones: bones, skinned: skinned, meshes: meshes, size: size.toArray().map(v => +v.toFixed(3)), animations: (obj.animations || []).length };
  } catch (e) {
    r.reload = { ok: false, error: String(e && e.message || e) };
  }
  return r;
});

const file = path.join(OUT, 'qa-export.fbx');
fs.writeFileSync(file, Buffer.from(out.b64, 'base64'));
delete out.b64;
out.fileBytes = fs.statSync(file).size;
out.pageErrors = errs;
console.log(JSON.stringify(out, null, 1));
await browser.close();