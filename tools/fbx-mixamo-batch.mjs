/* tools/fbx-mixamo-batch.mjs — xuất NHIỀU biến thể "Mixamo-ready" từ 1 FBX nguồn
 *
 * Mỗi biến thể chỉ khác mức decimate, cùng một scene đã bake (đứng thẳng +Y, đáy y=0):
 *   A. 50k tam giác (giữ nguyên hình — bản chính)
 *   B. ~30k tam giác (nhẹ hơn, auto-rig nhanh)
 *   C. ~12k tam giác (siêu nhẹ — thử mapping/upload trước)
 *
 *   $env:QA_BASE='http://127.0.0.1:8099'
 *   node tools/fbx-mixamo-batch.mjs "Meshy_AI_tripo_convert_monter1_20261122_texture.fbx"
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const inFile = args.find(a => !a.startsWith('--')) || 'Meshy_AI_tripo_convert_monter1_20261122_texture.fbx';
const outDir = path.join(process.cwd(), 'exports');
fs.mkdirSync(outDir, { recursive: true });
const stem = path.basename(inFile, '.fbx').replace(/_?texture$/, '');

/* ngưỡng tam giác: 0 = giữ nguyên */
const variants = [
  { tag: 'A_full', decimate: 0 },
  { tag: 'B_dec25k', decimate: 25000 },
  { tag: 'C_dec12k', decimate: 12000 },
  { tag: 'D_ascii_dec25k', decimate: 25000, ascii: true }
];

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', (route) => route.continue({ headers: { ...route.request().headers(), 'cache-control': 'no-cache', pragma: 'no-cache' } }));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.FBXBinary && window.THREE && THREE.FBXLoader, { timeout: 90000 });

const buf = fs.readFileSync(inFile);
const R = await page.evaluate(async ({ b64, variants }) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const root = new THREE.FBXLoader().parse(bytes.buffer, '');
  root.updateMatrixWorld(true);

  /* ---- scene chuẩn bị 1 lần: gom mesh → non-indexed, uv/normal đầy đủ ---- */
  const base = new THREE.Group(); base.name = 'MixamoMesh';
  let meshIdx = 0, srcTris = 0;
  root.traverse(m => {
    if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const geo = g.index ? g.toNonIndexed() : g;
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    srcTris += geo.attributes.position.count / 3;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const nm = new THREE.Mesh(geo, mat ? mat.clone() : new THREE.MeshStandardMaterial({ name: 'mat_' + meshIdx }));
    nm.name = m.name || ('mesh_' + meshIdx);
    meshIdx++;
    base.add(nm);
  });
  if (!base.children.length) throw new Error('FBX không có mesh');

  /* ---- decimate: vertex clustering theo lưới cell, giữ seam UV bằng cách chỉ gộp khi trùng cả UV ---- */
  const decimate = (src, faces) => {
    const o = new THREE.Group(); o.name = src.name; o.position.copy(src.position);
    src.children.forEach(m => {
      const g = m.geometry;
      const pos = g.attributes.position, uv = g.attributes.uv, nor = g.attributes.normal;
      const tris = pos.count / 3;
      if (!faces || tris <= faces) { const c = new THREE.Mesh(g.clone(), m.material); c.name = m.name; o.add(c); return; }
      const bb = new THREE.Box3().setFromBufferAttribute(pos);
      const size = bb.getSize(new THREE.Vector3());
      const diag = size.length();
      const grid = Math.max(24, Math.round(Math.cbrt(faces)));
      const s = diag / grid;
      const keyOf = (i) => {
        const k = Math.floor(pos.getX(i) / s) + '_' + Math.floor(pos.getY(i) / s) + '_' + Math.floor(pos.getZ(i) / s) +
          '_' + Math.round(uv.getX(i) * 64) + '_' + Math.round(uv.getY(i) * 64);
        return k;
      };
      const rep = new Map(), mapIdx = new Int32Array(pos.count);
      for (let i = 0; i < pos.count; i++) { const k = keyOf(i); if (!rep.has(k)) rep.set(k, i); mapIdx[i] = rep.get(k); }
      const np = [], nu = [], nn = [];
      for (let t = 0; t < pos.count; t += 3) {
        const a = mapIdx[t], b2 = mapIdx[t + 1], c = mapIdx[t + 2];
        if (a === b2 || b2 === c || a === c) continue;
        /* bỏ tam giác suy biến về hình học (diện tích ~0) */
        const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
        const e1x = pos.getX(b2) - ax, e1y = pos.getY(b2) - ay, e1z = pos.getZ(b2) - az;
        const e2x = pos.getX(c) - ax, e2y = pos.getY(c) - ay, e2z = pos.getZ(c) - az;
        const crx = e1y * e2z - e1z * e2y, cry = e1z * e2x - e1x * e2z, crz = e1x * e2y - e1y * e2x;
        if (crx * crx + cry * cry + crz * crz < (s * s * s) * 1e-3) continue;
        [a, b2, c].forEach(vi => {
          np.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
          nu.push(uv.getX(vi), uv.getY(vi));
          nn.push(nor.getX(vi), nor.getY(vi), nor.getZ(vi));
        });
      }
      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
      ng.setAttribute('uv', new THREE.Float32BufferAttribute(nu, 2));
      ng.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
      const c = new THREE.Mesh(ng, m.material);
      c.name = m.name;
      o.add(c);
    });
    return o;
  };

  const out = [];
  for (const v of variants) {
    const src = decimate(base, v.decimate);
    src.updateMatrixWorld(true);
    let tris = 0, verts = 0;
    src.traverse(o => { if (o.isMesh) { tris += o.geometry.attributes.position.count / 3; verts += o.geometry.attributes.position.count; } });
    const res = PixiStudio.FBXBinary.write(src, {
      noSkeleton: true, prepareMixamo: true, upAxis: 'Y', autoScale: true, ascii: !!v.ascii
    });
    /* tự kiểm tra: đọc lại chính bytes vừa ghi */
    const chk = { ok: false };
    try {
      const txt = new TextDecoder().decode(res.bytes.subarray(0, 40));
      const isAscii = txt.trimStart().startsWith(';');
      if (!isAscii && !txt.startsWith('Kaydara FBX Binary')) throw new Error('header FBX không đúng: ' + JSON.stringify(txt.slice(0, 24)));
      const obj = new THREE.FBXLoader().parse(res.bytes.buffer.slice(res.bytes.byteOffset, res.bytes.byteOffset + res.bytes.byteLength), '');
      obj.updateMatrixWorld(true);
      let bones = 0, sk = 0, ms = 0, uw = 0;
      obj.traverse(o => { if (o.isBone) bones++; if (o.isSkinnedMesh) sk++; if (o.isMesh) { ms++; if (o.geometry.attributes.uv) uw++; } });
      const bb = new THREE.Box3().setFromObject(obj);
      chk.ok = true; chk.bones = bones; chk.skinned = sk; chk.meshes = ms; chk.uvMeshes = uw;
      chk.box = { min: bb.min.toArray().map(n => +n.toFixed(3)), max: bb.max.toArray().map(n => +n.toFixed(3)) };
    } catch (e) { chk.error = String(e && e.message || e); }
    let s = ''; const CH = 32768;
    for (let i = 0; i < res.bytes.length; i += CH) s += String.fromCharCode.apply(null, res.bytes.subarray(i, Math.min(i + CH, res.bytes.length)));
    out.push({ tag: v.tag, tris, verts, bytes: res.bytes.length, report: res.report, reload: chk, b64: btoa(s) });
  }
  return { srcTris, out };
}, { b64: buf.toString('base64'), variants });

console.log('source', inFile, '→ tris', R.srcTris, '| file', (buf.length / 1048576).toFixed(2), 'MB');
for (const v of R.out) {
  const f = path.join(outDir, stem + '_mixamo_' + v.tag + '.fbx');
  fs.writeFileSync(f, Buffer.from(v.b64, 'base64'));
  console.log('\n' + v.tag + ' → ' + path.basename(f));
  console.log('  tris ' + v.tris + ' verts ' + v.verts + ' size ' + (v.bytes / 1048576).toFixed(2) + ' MB  format ' + v.report.format + ' unitScale ' + v.report.unitScale);
  console.log('  reload: ' + JSON.stringify(v.reload));
}
if (errs.length) console.log('\npageErrors:', errs.slice(0, 5));
await browser.close();
