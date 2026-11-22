/* tools/fbx-mixamo-fix.mjs — đọc FBX → xuất FBX "Mixamo-ready" CÓ MÀU (texture nhúng)
 *
 * FBXLoader giải mã ảnh BẤT ĐỒNG BỘ (trong headless ảnh có thể không bao giờ decode),
 * nên tool này KHÔNG dựa vào ảnh: nó tự trích `Video.Content` (bytes ảnh) + quan hệ
 * Texture→Material (connection OP) từ chính FBX nguồn, rồi truyền bytes đó cho
 * FBXBinary.write qua opts.textureBytes. Kết quả: FBX có skeleton/mesh đã sửa
 * hướng Mixamo VÀ giữ nguyên màu.
 *
 *   node tools/fbx-mixamo-fix.mjs "in.fbx" [--out exports/x.fbx] [--decimate 50000]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const SIZE = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 };
function readProp(buf, dv, p) {
  const t = String.fromCharCode(buf[p]);
  if (t === 'Y') return { v: dv.getInt16(p + 1, true), next: p + 3 };
  if (t === 'C') return { v: buf[p + 1], next: p + 2 };
  if (t === 'I') return { v: dv.getInt32(p + 1, true), next: p + 5 };
  if (t === 'F') return { v: dv.getFloat32(p + 1, true), next: p + 5 };
  if (t === 'D') return { v: dv.getFloat64(p + 1, true), next: p + 9 };
  if (t === 'L') return { v: Number(dv.getBigInt64(p + 1, true)), next: p + 9 };
  if (t === 'S') { const n = dv.getUint32(p + 1, true); return { v: buf.subarray(p + 5, p + 5 + n).toString('utf8'), next: p + 5 + n }; }
  if (t === 'R') { const n = dv.getUint32(p + 1, true); return { v: buf.subarray(p + 5, p + 5 + n), next: p + 5 + n }; }
  if ('fdlibc'.indexOf(t) >= 0) {
    const n = dv.getUint32(p + 1, true), enc = dv.getUint32(p + 5, true), clen = dv.getUint32(p + 9, true);
    const d0 = p + 13;
    const next = d0 + (enc === 0 ? SIZE[t] * n : clen);
    return { v: { arr: t, n, enc, off: d0, len: enc === 0 ? SIZE[t] * n : clen }, next };
  }
  throw new Error('unknown prop ' + t);
}
function parseFBX(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const rd = (start) => {
    const nend = dv.getUint32(start, true), nprops = dv.getUint32(start + 4, true), plen = dv.getUint32(start + 8, true), nlen = buf[start + 12];
    if (nend === 0 && nprops === 0 && plen === 0 && nlen === 0) return null;
    const name = buf.subarray(start + 13, start + 13 + nlen).toString('utf8');
    let p = start + 13 + nlen;
    const props = [];
    for (let i = 0; i < nprops; i++) { const r = readProp(buf, dv, p); props.push(r.v); p = r.next; }
    const children = [];
    let off = start + 13 + nlen + plen;
    while (off < nend) { const c = rd(off); if (!c) { off += 13; continue; } children.push(c); off = c.end; }
    return { name, start, end: nend, props, children };
  };
  const top = [];
  let off = 27;
  while (off < buf.length - 16) { const n = rd(off); if (!n) break; top.push(n); off = n.end; }
  return top;
}

/* ── trích texture từ FBX nguồn: { materialName: { slot: { b64, mime } } } ── */
function extractTextures(file) {
  const buf = fs.readFileSync(file);
  if (buf.slice(0, 20).toString('latin1') !== 'Kaydara FBX Binary  ') return { map: {}, note: 'FBX ASCII — không trích được' };
  const top = parseFBX(buf);
  const objs = top.find(n => n.name === 'Objects');
  const conn = top.find(n => n.name === 'Connections');
  if (!objs) return { map: {}, note: 'không có Objects' };

  const clean = s => String(s || '').replace(/\u0000.*$/, '');
  const videos = {}, textures = {}, materials = {};
  objs.children.forEach(c => {
    const id = c.props[0];
    if (c.name === 'Video') {
      const content = c.children.find(x => x.name === 'Content');
      const fname = c.children.find(x => x.name === 'FileName');
      videos[id] = {
        name: clean(c.props[1]),
        file: fname ? String(fname.props[0]) : '',
        bytes: content && content.props[0] && content.props[0].length !== undefined ? content.props[0] : null
      };
    } else if (c.name === 'Texture') {
      const media = c.children.find(x => x.name === 'Media');
      textures[id] = { name: clean(c.props[1]), media: media ? clean(media.props[0]) : '' };
    } else if (c.name === 'Material') {
      materials[id] = clean(c.props[1]);
    }
  });

  const SLOT_BY_PROP = {
    'DiffuseColor': 'map', 'Maya|DiffuseColor': 'map',
    'NormalMap': 'normalMap', 'Maya|NormalMap': 'normalMap',
    'ShininessExponent': 'roughnessMap', 'ReflectionFactor': 'metalnessMap',
    'AmbientColor': 'aoMap', 'EmissiveColor': 'emissiveMap'
  };
  const vidByName = {};
  Object.keys(videos).forEach(k => { vidByName[videos[k].name] = videos[k]; });

  const out = {};
  let count = 0;
  (conn ? conn.children : []).filter(c => c.name === 'C').forEach(c => {
    if (c.props[0] !== 'OP') return;
    const tex = textures[c.props[1]];
    const matId = c.props[2];
    const propName = String(c.props[3] || '');
    if (!tex || !materials[matId]) return;
    const slot = SLOT_BY_PROP[propName];
    if (!slot) return;
    const vid = vidByName[tex.media];
    if (!vid || !vid.bytes || !vid.bytes.length) return;
    const b = vid.bytes;
    const isPng = b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const isJpg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
    const mime = isPng ? 'image/png' : (isJpg ? 'image/jpeg' : 'image/png');
    const matName = materials[matId];
    out[matName] = out[matName] || {};
    out[matName][slot] = { b64: Buffer.from(vid.bytes).toString('base64'), mime, name: tex.name };
    count++;
  });
  return { map: out, count, materials: Object.keys(out), note: 'ok' };
}

const args = process.argv.slice(2);
const inFile = args.find(a => !a.startsWith('--'));
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const decimate = args.includes('--decimate') ? parseInt(args[args.indexOf('--decimate') + 1], 10) : 0;
if (!inFile) { console.error('thiếu file nguồn'); process.exit(2); }

const tex = extractTextures(inFile);
console.log('trích texture từ nguồn:', tex.note, '| slots:', Object.keys(tex.map).map(m => m + ':' + Object.keys(tex.map[m]).join('+')).join(', ') || '(không có)');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const outFile = outArg || path.join('exports', path.basename(inFile).replace(/\.fbx$/i, '') + '_mixamo_color.fbx');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const srcB64 = fs.readFileSync(inFile).toString('base64');

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.FBXBinary && window.THREE && THREE.FBXLoader, { timeout: 90000 });

const R = await page.evaluate(async ({ b64, decimate, textureBytes }) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const root = new THREE.FBXLoader().parse(bytes.buffer, '');
  root.updateMatrixWorld(true);

  const base = new THREE.Group(); base.name = 'MixamoMesh';
  let srcTris = 0; const matInfo = [];
  root.traverse(m => {
    if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const geo = g.index ? g.toNonIndexed() : g;
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    srcTris += geo.attributes.position.count / 3;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    matInfo.push({ name: mat && mat.name, hasMap: !!(mat && mat.map), hasNormal: !!(mat && mat.normalMap) });
    base.add(new THREE.Mesh(geo, mat || new THREE.MeshStandardMaterial({ name: 'mixamo_mat' })));
  });
  base.updateMatrixWorld(true);

  const dec = (src, faces) => {
    if (!faces) return src;
    const o = new THREE.Group(); o.name = src.name;
    src.children.forEach(m => {
      const g = m.geometry, pos = g.attributes.position, uv = g.attributes.uv, nor = g.attributes.normal;
      if (pos.count / 3 <= faces) { o.add(new THREE.Mesh(g.clone(), m.material)); return; }
      const bb = new THREE.Box3().setFromBufferAttribute(pos);
      const s = bb.getSize(new THREE.Vector3()).length() / Math.max(24, Math.round(Math.cbrt(faces * 2)));
      const keyOf = i => Math.floor(pos.getX(i) / s) + '_' + Math.floor(pos.getY(i) / s) + '_' + Math.floor(pos.getZ(i) / s) + '_' + Math.round(uv.getX(i) * 64) + '_' + Math.round(uv.getY(i) * 64);
      const rep = new Map(), mapIdx = new Int32Array(pos.count);
      for (let i = 0; i < pos.count; i++) { const k = keyOf(i); if (!rep.has(k)) rep.set(k, i); mapIdx[i] = rep.get(k); }
      const np = [], nu = [], nn = [];
      for (let t = 0; t < pos.count; t += 3) {
        const a = mapIdx[t], b = mapIdx[t + 1], c = mapIdx[t + 2];
        if (a === b || b === c || a === c) continue;
        [a, b, c].forEach(vi => { np.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi)); nu.push(uv.getX(vi), uv.getY(vi)); nn.push(nor.getX(vi), nor.getY(vi), nor.getZ(vi)); });
      }
      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
      ng.setAttribute('uv', new THREE.Float32BufferAttribute(nu, 2));
      ng.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
      o.add(new THREE.Mesh(ng, m.material));
    });
    return o;
  };
  const finalMesh = dec(base, decimate);
  finalMesh.updateMatrixWorld(true);

  const res = PixiStudio.FBXBinary.write(finalMesh, {
    prepareMixamo: true, noSkeleton: true, embedTextures: true,
    textureBytes: textureBytes, upAxis: 'Y', autoScale: true
  });
  let s = ''; const CH = 32768;
  for (let i = 0; i < res.bytes.length; i += CH) s += String.fromCharCode.apply(null, res.bytes.subarray(i, Math.min(i + CH, res.bytes.length)));

  const chk = {};
  try {
    const obj = new THREE.FBXLoader().parse(res.bytes.buffer.slice(res.bytes.byteOffset, res.bytes.byteOffset + res.bytes.byteLength), '');
    obj.updateMatrixWorld(true);
    let meshes = 0, uw = 0, withMap = 0;
    obj.traverse(o => {
      if (!o.isMesh) return;
      meshes++; if (o.geometry.attributes.uv) uw++;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && m.map) withMap++;
    });
    const bb = new THREE.Box3().setFromObject(obj);
    chk.ok = true; chk.meshes = meshes; chk.uvMeshes = uw; chk.materialsWithMap = withMap;
    chk.box = { min: bb.min.toArray().map(n => +n.toFixed(3)), max: bb.max.toArray().map(n => +n.toFixed(3)) };
  } catch (e) { chk.ok = false; chk.error = String(e && e.message || e); }

  return { srcTris, matInfo, report: res.report, fileBytes: res.bytes.length, chk, b64: btoa(s) };
}, { b64: srcB64, decimate, textureBytes: tex.map });

fs.writeFileSync(outFile, Buffer.from(R.b64, 'base64'));
console.log('nguồn  :', inFile, '| tris gốc', Math.round(R.srcTris));
console.log('ghi    :', outFile, (R.fileBytes / 1048576).toFixed(2), 'MB');
console.log('report :', JSON.stringify({ textures: R.report.textures, meshes: R.report.meshes, bones: R.report.bones, upAxis: R.report.upAxis }));
(R.report.textureReport || []).forEach(t => console.log('   texture:', t));
console.log('reload :', JSON.stringify(R.chk));
console.log('pageErrors:', errs.length, errs.slice(0, 3));
await browser.close();