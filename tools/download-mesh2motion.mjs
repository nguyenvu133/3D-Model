/* tools/download-mesh2motion.mjs — tải asset animation Mesh2Motion (CC0)
 * Nguồn: Mesh2Motion/mesh2motion-app (MIT code / CC0 art)
 * Ghi vào assets/animations/mesh2motion/<rig>/...
 * node tools/download-mesh2motion.mjs [--only human] [--no-models]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'assets', 'animations', 'mesh2motion');
const MANIFEST_SRC = 'https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-app/main/static/assets/manifest.json';

const CDNS = [
  (p) => 'https://cdn.jsdelivr.net/gh/Mesh2Motion/mesh2motion-app@main/static/assets/' + p,
  (p) => 'https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-app/main/static/assets/' + p,
  (p) => 'https://app.mesh2motion.org/assets/' + p
];

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const withModels = !args.includes('--no-models');

async function fetchBuf(rel) {
  let lastErr = null;
  for (const mk of CDNS) {
    try {
      const r = await fetch(mk(rel));
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status + ' ' + rel); continue; }
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('fetch failed ' + rel);
}

async function pool(items, limit, worker) {
  let i = 0, ok = 0, fail = 0;
  const failures = [];
  const runners = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      const it = items[idx];
      try { await worker(it); ok++; if (ok % 25 === 0) console.log('  ... ' + ok + '/' + items.length); }
      catch (e) { fail++; failures.push(it.file + ' :: ' + e.message); }
    }
  });
  await Promise.all(runners);
  return { ok, fail, failures };
}

async function main() {
  console.log('Manifest:', MANIFEST_SRC);
  const manifest = await (await fetch(MANIFEST_SRC)).json();
  fs.mkdirSync(DEST, { recursive: true });
  fs.writeFileSync(path.join(DEST, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log('Rigs:', Object.keys(manifest.rigs).join(', '));

  const jobs = [];
  for (const [rigId, rig] of Object.entries(manifest.rigs)) {
    if (only && rigId !== only) continue;
    if (withModels) {
      if (rig.model) jobs.push({ file: rig.model.file, kind: 'model', rig: rigId });
      if (rig.skeleton) jobs.push({ file: rig.skeleton.file, kind: 'skeleton', rig: rigId });
      (rig.variations || []).forEach(v => jobs.push({ file: v.file, kind: 'variation', rig: rigId }));
    }
    (rig.animations || []).forEach(a => jobs.push({ file: a.file, kind: 'animation', rig: rigId, name: a.name }));
  }
  console.log('Total files to download:', jobs.length);

  const res = await pool(jobs, 10, async (job) => {
    const out = path.join(DEST, job.file.split('/').join(path.sep));
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return;   // resume
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const buf = await fetchBuf(job.file);
    fs.writeFileSync(out, buf);
  });

  console.log('DONE ok=' + res.ok + ' fail=' + res.fail);
  res.failures.slice(0, 20).forEach(f => console.log('  ✖ ' + f));

  // local catalog for the app
  const catalog = { source: 'Mesh2Motion (CC0)', downloadedAt: new Date().toISOString(), rigs: {} };
  for (const [rigId, rig] of Object.entries(manifest.rigs)) {
    if (only && rigId !== only) continue;
    catalog.rigs[rigId] = {
      fps: rig.fps,
      model: rig.model ? 'assets/animations/mesh2motion/' + rig.model.file : null,
      skeleton: rig.skeleton ? 'assets/animations/mesh2motion/' + rig.skeleton.file : null,
      variations: (rig.variations || []).map(v => ({ name: v.name, url: 'assets/animations/mesh2motion/' + v.file })),
      animations: (rig.animations || []).map(a => ({
        name: a.name, file: a.file, url: 'assets/animations/mesh2motion/' + a.file,
        tags: a.tags || [], loop: !!a.loop, rootMotion: !!a.root_motion,
        frames: a.frame_count, duration: a.duration
      }))
    };
  }
  fs.writeFileSync(path.join(DEST, 'catalog.json'), JSON.stringify(catalog, null, 1));
  console.log('catalog.json written — rigs: ' + Object.keys(catalog.rigs).map(k => k + ':' + catalog.rigs[k].animations.length).join(', '));
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
