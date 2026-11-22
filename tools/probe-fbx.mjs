/* tools/probe-fbx.mjs — đọc FBX bằng THREE.FBXLoader (qua trình duyệt) để xem mesh/bone/skin */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8100';
const file = process.argv[2] || 'Meshy_AI_tripo_convert_monter1_20261122_texture.fbx';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.THREE && THREE.FBXLoader, { timeout: 60000 });
const buf = fs.readFileSync(file);

const b64 = buf.toString('base64');
const R = await page.evaluate(async (b64) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const obj = new THREE.FBXLoader().parse(bytes.buffer, '');
  obj.updateMatrixWorld(true);
  const out = { children: obj.children.map(c => c.name + ':' + c.type), meshes: [], bones: [], skinned: 0, materials: [] };
  obj.traverse(o => {
    if (o.isMesh) {
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      out.meshes.push({
        name: o.name, type: o.type, verts: o.geometry.attributes.position.count, idx: o.geometry.index ? o.geometry.index.count : 0,
        uv: !!o.geometry.attributes.uv, normal: !!o.geometry.attributes.normal, color: !!o.geometry.attributes.color,
        skinIndex: !!o.geometry.attributes.skinIndex, skinWeight: !!o.geometry.attributes.skinWeight,
        worldPos: o.getWorldPosition(new THREE.Vector3()).toArray().map(n => +n.toFixed(3)),
        worldScale: o.getWorldScale(new THREE.Vector3()).toArray().map(n => +n.toFixed(3)),
        bboxMin: bb.min.toArray().map(n => +n.toFixed(3)), bboxMax: bb.max.toArray().map(n => +n.toFixed(3)),
        mat: o.material && o.material.map ? 'map' : (o.material ? o.material.type : 'none')
      });
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m && out.materials.push({ name: m.name, type: m.type, map: !!m.map, normalMap: !!m.normalMap, color: m.color && m.color.getHexString(), opacity: m.opacity, transparent: m.transparent, side: m.side, metalness: m.metalness, roughness: m.roughness }));
    }
    if (o.isSkinnedMesh) out.skinned++;
    if (o.isBone) out.bones.push(o.name + ' <' + (o.parent ? o.parent.name : '-') + '> pos=' + o.position.toArray().map(n => +n.toFixed(2)).join(','));
  });
  const box = new THREE.Box3().setFromObject(obj);
  out.worldBox = { min: box.min.toArray().map(n => +n.toFixed(3)), max: box.max.toArray().map(n => +n.toFixed(3)) };
  return out;
}, b64);
R.pageErrors = errs.slice(0, 10);
console.log(JSON.stringify(R, null, 1));
await browser.close();
