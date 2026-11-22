/* tools/download-m2m-previews.mjs — tải ảnh preview model variation + rig reference (nhỏ)
 * node tools/download-m2m-previews.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'assets', 'animations', 'mesh2motion');

const MANIFEST = 'https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-app/main/static/assets/manifest.json';
const BASES = [
  'https://cdn.jsdelivr.net/gh/Mesh2Motion/mesh2motion-app@main/',
  'https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-app/main/'
];

async function tryFetch(rel) {
  for (const b of BASES) {
    try { const r = await fetch(b + rel); if (r.ok) return Buffer.from(await r.arrayBuffer()); } catch { }
  }
  return null;
}

async function pool(items, limit, fn) {
  let i = 0, ok = 0; const miss = [];
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const it = items[i++];
      const r = await fn(it);
      if (r) ok++; else miss.push(it);
    }
  }));
  return { ok, miss };
}

const manifest = await (await fetch(MANIFEST)).json();
const jobs = [];
for (const [rigId, rig] of Object.entries(manifest.rigs)) {
  jobs.push({ rel: 'static/rig-reference/' + rigId + '.png', out: path.join('rig-reference', rigId + '.png') });
  (rig.variations || []).forEach(v => {
    jobs.push({ rel: 'static/variation-previews/' + rigId + '/' + v.name + '.png', out: path.join('variation-previews', rigId, v.name + '.png') });
  });
}
console.log('preview files:', jobs.length);
const res = await pool(jobs, 8, async (job) => {
  const out = path.join(DEST, job.out);
  if (fs.existsSync(out)) return true;
  const buf = await tryFetch(job.rel);
  if (!buf || buf.length < 100) return false;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  return true;
});
console.log('previews ok=' + res.ok + ' missing=' + res.miss.length);
res.miss.slice(0, 10).forEach(m => console.log('  · thiếu: ' + m.rel));
