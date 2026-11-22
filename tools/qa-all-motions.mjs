/* tools/qa-all-motions.mjs — import a character, auto-rig it, then run EVERY
 * downloaded Mesh2Motion motion through the retarget pipeline and measure real
 * bone deformation per motion.
 *
 * node tools/qa-all-motions.mjs [--model "assets/models/file.glb"] [--probe 350]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const args = process.argv.slice(2);
const MODEL = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'assets/models/tripo_convert_monter1.glb';
const PROBE = args.includes('--probe') ? parseInt(args[args.indexOf('--probe') + 1], 10) : 350;
const OUT = path.join(process.cwd(), '_qa');
fs.mkdirSync(OUT, { recursive: true });

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.Models && PixiStudio.Models.loadGLBFromBuffer, { timeout: 90000 });
await page.waitForTimeout(800);

/* ---------- 1. import the character ---------- */
const setup = await page.evaluate(async (modelUrl) => {
  const r = {};
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error('fetch model HTTP ' + res.status);
  const buf = await res.arrayBuffer();
  const entry = await PixiStudio.Models.loadGLBFromBuffer(buf, 'ImportedCharacter', buf.byteLength);
  r.model = { name: entry.name, tris: entry.stats.triangles, meshes: entry.stats.meshes, clips: entry.clips.length };
  const target = entry.object3D;
  r.skinnedBefore = (() => { let n = 0; target.traverse(o => { if (o.isSkinnedMesh) n++; }); return n; })();
  r.bonesBefore = (() => { let n = 0; target.traverse(o => { if (o.isBone) n++; }); return n; })();

  /* auto-rig (Studio humanoid, 23 bones) + auto skin binding */
  const rig = PixiStudio.RigAutoGen.generate(target, 'Studio Humanoid');
  r.rig = rig ? { bones: rig.boneCount, preset: rig.preset } : null;
  r.skinnedAfter = (() => { let n = 0; target.traverse(o => { if (o.isSkinnedMesh) n++; }); return n; })();
  r.bonesAfter = (() => { let n = 0; target.traverse(o => { if (o.isBone) n++; }); return n; })();
  r.skinnedCount = rig ? (rig.skinnedCount || 0) : 0;
  r.boneNames = rig ? Object.keys(rig.bones) : [];
  PixiStudio.RigAutoGen.playing = true;

  /* locate bound skinned mesh + which target bones the retarget can use */
  r.boundMesh = (() => { let nm = null; target.traverse(o => { if (!nm && o.isSkinnedMesh) nm = o.name || '(unnamed)'; }); return nm; })();

  await PixiStudio.M2MMotion.loadCatalog();
  r.catalogRigs = Object.keys(PixiStudio.M2MMotion.catalog.rigs).map(k => k + ':' + PixiStudio.M2MMotion.motions(k).length);
  return r;
}, MODEL);

console.log('SETUP', JSON.stringify(setup, null, 1));
fs.writeFileSync(path.join(OUT, 'motions-setup.json'), JSON.stringify(setup, null, 1));

/* ---------- 2. run every human motion in batches ---------- */
const motions = await page.evaluate(() => PixiStudio.M2MMotion.motions('human').map(m => ({ name: m.name, url: m.url, dur: m.duration, loop: !!m.loop })));
console.log('Motions to test:', motions.length);

const results = [];
const BATCH = 25;
for (let i = 0; i < motions.length; i += BATCH) {
  const slice = motions.slice(i, i + BATCH);
  const batch = await page.evaluate(async ({ list, probeMs }) => {
    const M = PixiStudio.M2MMotion;
    const out = [];
    for (const m of list) {
      const rec = { name: m.name, dur: m.dur };
      try {
        const src = await M.loadClip(m.url);
        rec.srcTracks = src.clip.tracks.length;
        const t = (PixiStudio.FbxRig && PixiStudio.FbxRig.loaded && PixiStudio.FbxRig.fbxRoot)
          ? { root: PixiStudio.FbxRig.fbxRoot, mixer: PixiStudio.FbxRig.mixer }
          : (PixiStudio.RigAutoGen.current ? { root: PixiStudio.RigAutoGen.current.target, mixer: PixiStudio.RigAutoGen.current.mixer } : null);
        if (!t) { rec.error = 'no rig'; out.push(rec); continue; }
        const clip = M.retarget(src, t.root);
        if (!clip) { rec.error = 'retarget produced 0 tracks'; out.push(rec); continue; }
        rec.outTracks = clip.tracks.length;
        rec.outDur = +clip.duration.toFixed(3);
        M.loop = !!m.loop; M.useRootMotion = false;
        const info = await M.play(m.url, m.name);
        if (!info) { rec.error = 'play returned null'; out.push(rec); continue; }
        const p = await M.probe(probeMs);
        rec.maxTravel = p ? p.maxTravel : null;
        rec.probeBones = p ? p.bones.length : 0;
        rec.ok = !!(p && p.maxTravel > 0.002);
        if (!rec.ok) rec.error = 'bone travel below threshold';
      } catch (e) {
        rec.error = String(e && e.message || e);
      }
      out.push(rec);
    }
    return out;
  }, { list: slice, probeMs: PROBE });
  results.push(...batch);
  const okSoFar = results.filter(r => r.ok).length;
  const bad = results.filter(r => !r.ok).length;
  console.log(`  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(motions.length / BATCH)} — done ${results.length}/${motions.length} · ok=${okSoFar} fail=${bad}`);
  fs.writeFileSync(path.join(OUT, 'motions-results.json'), JSON.stringify(results, null, 1));
}

/* ---------- 3. summary ---------- */
const ok = results.filter(r => r.ok);
const fail = results.filter(r => !r.ok);
const stats = {
  model: MODEL,
  rigBones: setup.rig ? setup.rig.bones : 0,
  rigPreset: setup.rig ? setup.rig.preset : null,
  skinnedMeshes: setup.skinnedAfter,
  boundCount: setup.skinnedCount,
  testedAt: new Date().toISOString(),
  total: results.length,
  passed: ok.length,
  failed: fail.length,
  avgTracks: +(results.filter(r => r.outTracks).reduce((s, r) => s + r.outTracks, 0) / Math.max(1, results.filter(r => r.outTracks).length)).toFixed(1),
  avgTravel: +(ok.reduce((s, r) => s + (r.maxTravel || 0), 0) / Math.max(1, ok.length)).toFixed(4),
  minTravel: ok.length ? +Math.min(...ok.map(r => r.maxTravel)).toFixed(4) : null,
  maxTravel: ok.length ? +Math.max(...ok.map(r => r.maxTravel)).toFixed(4) : null,
  failures: fail.map(r => ({ name: r.name, error: r.error, outTracks: r.outTracks || 0 })),
  pageErrors
};
fs.writeFileSync(path.join(OUT, 'motions-summary.json'), JSON.stringify(stats, null, 1));
console.log('SUMMARY', JSON.stringify({ total: stats.total, passed: stats.passed, failed: stats.failed, avgTracks: stats.avgTracks, avgTravel: stats.avgTravel, min: stats.minTravel, max: stats.maxTravel, pageErrors: pageErrors.length }, null, 1));

/* screenshot of the rigged character mid-motion for evidence */
await page.evaluate(() => {
  const list = PixiStudio.M2MMotion.motions('human');
  const m = list.find(x => x.name === 'Run_Anime') || list[0];
  PixiStudio.M2MMotion.loop = true;
  return PixiStudio.M2MMotion.play(m.url, m.name);
});
await page.waitForTimeout(700);
const shot = await page.evaluate(() => PixiStudio.Viewport.screenshot(560, 560, 'png'));
if (shot) fs.writeFileSync(path.join(OUT, 'rigged_character.png'), Buffer.from(shot.split(',')[1], 'base64'));

await browser.close();
console.log('report: _qa/motions-results.json, _qa/motions-summary.json');
