/* tools/fbx-convert-mixamo.mjs — nhận FBX bất kỳ (Meshy/Tripo/Blender), xuất bản "Mixamo-ready"
 *
 * Vì sao cần: file Meshy AI (Tripo convert) là FBX 7400 nhưng:
 *   - geometry nằm NGANG (chiều cao theo trục Z, node Model xoay -90°),
 *   - Model không có NodeAttribute (mesh không có Attribute node),
 *   - 150k/50k tam giác, texture nhúng dạng Video.
 * Khi upload Mixamo hay báo "Unsupported FBX type" hoặc auto-mapper không thấy khớp.
 *
 * Công cụ này bake đúng những gì Mixamo cần và ghi lại bằng FBX writer của studio
 * (js/exporter/fbx-binary.js) qua Chrome/THREE.FBXLoader:
 *   1) bake -90° quanh X  → cao theo +Y, mặt hướng +Z, đáy ở y=0  (upAxis: 'Y')
 *   2) giữ UV + normal, ghi UV theo kiểu Direct (giống file Mixamo đã chấp nhận)
 *   3) giữ 1 material + 1 UV set; tùy chọn decimate về ngưỡng tam giác an toàn
 *   4) mesh-only (không skin/cluster/pose) → Mixamo tự auto-rig
 *
 * Cách dùng:
 *   $env:QA_BASE='http://127.0.0.1:8099'
 *   node tools/fbx-convert-mixamo.mjs "Meshy_AI_tripo_convert_monter1_20261122_texture.fbx" [--faces 35000] [--keep-up] [--ascii]
 * Kết quả: exports/<tên>_mixamo.fbx
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const inFile = args.find(a => !a.startsWith('--')) || 'Meshy_AI_tripo_convert_monter1_20261122_texture.fbx';
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes('--' + name);
const maxFaces = parseInt(opt('faces', '0'), 10) || 0;
const keepUp = flag('keep-up');
const ascii = flag('ascii');
const outDir = path.join(process.cwd(), 'exports');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, path.basename(inFile, '.fbx') + (ascii ? '_mixamo_ascii' : '_mixamo') + '.fbx');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', (route) => route.continue({ headers: { ...route.request().headers(), 'cache-control': 'no-cache', pragma: 'no-cache' } }));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.FBXBinary && window.THREE && THREE.FBXLoader, { timeout: 90000 });

/* cache-bust: server.js không đặt Cache-Control → Chrome có thể dùng bản script cũ */
const srcVer = await page.evaluate(async () => {
  const txt = await (await fetch('js/exporter/fbx-binary.js?' + Date.now())).text();
  return { hasUpAxis: txt.includes('opts.upAxis'), len: txt.length };
});
console.log('fbx-binary.js served:', srcVer);

const buf = fs.readFileSync(inFile);
const R = await page.evaluate(async ({ b64, maxFaces, keepUp, ascii }) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const root = new THREE.FBXLoader().parse(bytes.buffer, '');
  root.updateMatrixWorld(true);

  /* gom mesh, bỏ vật thể trang trí */
  const meshes = [];
  root.traverse(o => { if (o.isMesh && o.geometry && o.geometry.attributes.position) meshes.push(o); });
  if (!meshes.length) throw new Error('FBX không có mesh');

  const out = new THREE.Group();
  out.name = 'MixamoMesh';
  const info = { src: { meshes: meshes.length, verts: 0, tris: 0 }, baked: null };
  meshes.forEach((m, i) => {
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);                 /* đưa về cùng không gian */
    const geo = g.index ? g.toNonIndexed() : g;    /* Mixamo đọc tốt với PolygonVertexIndex liền 3 */
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.computeBoundingBox();
    info.src.verts += geo.attributes.position.count;
    info.src.tris += geo.attributes.position.count / 3;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const nm = new THREE.Mesh(geo, mat ? mat.clone() : new THREE.MeshStandardMaterial({ name: 'mat_' + i }));
    nm.name = (m.name || 'mesh') + (i ? '_' + i : '');
    out.add(nm);
  });

  /* decimate (edge collapse đơn giản, giữ UV — đủ để Mixamo rig) nếu quá ngưỡng */
  if (maxFaces) {
    out.traverse(o => {
      if (!o.isMesh) return;
      const p = o.geometry.attributes.position.count / 3;
      if (p <= maxFaces) return;
      const g = o.geometry;
      const pos = g.attributes.position, uv = g.attributes.uv, nor = g.attributes.normal;
      const cell = Math.cbrt((p / maxFaces)) * 0.002;   /* kích thước cell theo bbox tương đối */
      const bb = new THREE.Box3().setFromBufferAttribute(pos);
      const size = bb.getSize(new THREE.Vector3());
      const s = Math.max(size.x, size.y, size.z) * cell;
      const key = (i) => Math.floor(pos.getX(i) / s) + '_' + Math.floor(pos.getY(i) / s) + '_' + Math.floor(pos.getZ(i) / s);
      const rep = new Map();
      const mapIdx = new Int32Array(pos.count);
      for (let i = 0; i < pos.count; i++) { const k = key(i); if (!rep.has(k)) rep.set(k, i); mapIdx[i] = rep.get(k); }
      const np = [], nu = [], nn = [];
      for (let t = 0; t < pos.count; t += 3) {
        const a = mapIdx[t], b2 = mapIdx[t + 1], c = mapIdx[t + 2];
        if (a === b2 || b2 === c || a === c) continue;
        [a, b2, c].forEach(vi => {
          np.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
          nu.push(uv.getX(vi), uv.getY(vi));
          nn.push(nor.getX(vi), nor.getY(vi), nor.getZ(vi));
        });
      }
      o.geometry = new THREE.BufferGeometry();
      o.geometry.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
      o.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(nu, 2));
      o.geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
      o.geometry.computeBoundingBox();
    });
  }

  out.updateMatrixWorld(true);
  const res = PixiStudio.FBXBinary.write(out, { noSkeleton: true, prepareMixamo: true, upAxis: keepUp ? 'keep' : 'Y', ascii: !!ascii });

  /* ----- tự kiểm tra: đọc lại chính file vừa ghi ----- */
  const chk = { reload: null, bytes: res.bytes.length, report: res.report };
  try {
    const obj = new THREE.FBXLoader().parse(res.bytes.buffer.slice(0), '');
    obj.updateMatrixWorld(true);
    let bones = 0, sk = 0, ms = 0, uvs = 0, tris = 0;
    obj.traverse(o => {
      if (o.isBone) bones++;
      if (o.isSkinnedMesh) sk++;
      if (o.isMesh) {
        ms++;
        tris += o.geometry.attributes.position.count / 3;
        if (o.geometry.attributes.uv) uvs++;
      }
    });
    const bb = new THREE.Box3().setFromObject(obj);
    chk.reload = { bones, skinned: sk, meshes: ms, meshesWithUV: uvs, tris, box: { min: bb.min.toArray().map(v => +v.toFixed(3)), max: bb.max.toArray().map(v => +v.toFixed(3)) } };
  } catch (e) { chk.reload = { error: String(e && e.message || e) }; }

  let s = ''; const CH = 32768;
  for (let i = 0; i < res.bytes.length; i += CH) s += String.fromCharCode.apply(null, res.bytes.subarray(i, Math.min(i + CH, res.bytes.length)));
  info.baked = chk;
  return { b64: btoa(s), info };
}, { b64: buf.toString('base64'), maxFaces, keepUp, ascii: flag('ascii') });

fs.writeFileSync(outFile, Buffer.from(R.b64, 'base64'));
console.log('IN  :', inFile, '(' + (buf.length / 1048576).toFixed(2) + ' MB)');
const outSize = fs.statSync(outFile).size;
console.log('OUT :', outFile, '(' + (outSize / 1048576).toFixed(2) + ' MB)');
console.log(JSON.stringify(R.info, null, 1));
if (errs.length) console.log('pageErrors:', errs.slice(0, 5));
await browser.close();
