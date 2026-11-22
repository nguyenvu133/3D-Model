/* tools/qa-creature-rigs.mjs — dựng rig cho từng họ + phát animation của chính họ */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const MODEL = 'assets/models/tripo_convert_monter1.glb';
const OUT = path.join(process.cwd(), '_qa');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.CreatureRigs && PixiStudio.Models.loadGLBFromBuffer, { timeout: 90000 });
await page.waitForTimeout(700);

const results = await page.evaluate(async ({ modelUrl }) => {
  const C = PixiStudio.CreatureRigs;
  const M = PixiStudio.M2MMotion;
  await M.loadCatalog();
  const out = { rigs: [], pageErrorsLocal: [] };
  const rigIds = ['fox', 'horse', 'kaiju', 'dragon', 'bird', 'snake', 'shark', 'spider'];

  const measureAll = async () => {
    const root = PixiStudio.RigAutoGen.current.target;
    const bones = [];
    root.traverse(o => { if (o.isBone) bones.push(o); });
    const read = () => { root.updateMatrixWorld(true); return bones.map(b => b.matrixWorld.elements.slice(12, 15)); };
    const first = read();
    let maxTravel = 0;
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 200));
      const now = read();
      first.forEach((a, k) => {
        const b = now[k];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d > maxTravel) maxTravel = d;
      });
    }
    return +maxTravel.toFixed(4);
  };

  for (const rigId of rigIds) {
    const rec = { rigId, family: C.familyOf(rigId) };
    try {
      const buf = await (await fetch(modelUrl)).arrayBuffer();
      const entry = await PixiStudio.Models.loadGLBFromBuffer(buf, 'Test_' + rigId, buf.byteLength);
      const target = entry.object3D;
      const t0 = performance.now();
      const rig = await C.build(target, rigId);
      rec.buildMs = Math.round(performance.now() - t0);
      if (!rig) { rec.error = 'build returned null'; out.rigs.push(rec); PixiStudio.Models.remove(entry.id); continue; }
      rec.bones = rig.boneCount;
      rec.skinned = rig.skinnedCount;
      rec.mode = M.isIdentityRig(rigId) ? 'identity-by-name' : 'humanoid';
      const anims = M.motions(rigId);
      rec.animations = anims.length;
      rec.tests = [];
      const picks = anims.slice(0, 3);
      for (const a of picks) {
        M.loop = true; M.useRootMotion = false;
        const info = await M.play(a.url, a.name);
        const travel = await measureAll();
        rec.tests.push({ name: a.name, tracks: info ? info.tracks : 0, dur: info ? +info.duration.toFixed(2) : 0, travel });
      }
      rec.avgTravel = +(rec.tests.reduce((s, t) => s + (t.travel || 0), 0) / Math.max(1, rec.tests.length)).toFixed(4);
      rec.ok = rec.tests.every(t => t.tracks > 0 && t.travel > 0.002);
      PixiStudio.Models.remove(entry.id);
      await new Promise(r => setTimeout(r, 120));
    } catch (e) {
      rec.error = String(e && e.message || e);
    }
    out.rigs.push(rec);
    console.log('  ' + rigId + ' → ' + JSON.stringify({ bones: rec.bones, skinned: rec.skinned, avgTravel: rec.avgTravel, ok: rec.ok, err: rec.error }));
  }

  /* nạp model gốc của rig (skeleton khớp) */
  try {
    const e = await C.loadRigModel('fox');
    out.rigModel = e ? { name: e.name, meshes: e.stats.meshes, tris: e.stats.triangles } : null;
  } catch (err) { out.rigModel = { error: String(err.message) }; }
  return out;
}, { modelUrl: MODEL });

const summary = {
  testedAt: new Date().toISOString(),
  model: MODEL,
  rigCount: results.rigs.length,
  okCount: results.rigs.filter(r => r.ok).length,
  rigs: results.rigs.map(r => ({ rigId: r.rigId, family: r.family, bones: r.bones, skinned: r.skinned, mode: r.mode, animations: r.animations, avgTravel: r.avgTravel, ok: r.ok, error: r.error, tests: r.tests })),
  rigModel: results.rigModel,
  pageErrors
};
fs.writeFileSync(path.join(OUT, 'creature-rigs.json'), JSON.stringify(summary, null, 1));
console.log('SUMMARY', JSON.stringify({ rigCount: summary.rigCount, ok: summary.okCount, pageErrors: pageErrors.length, rigModel: summary.rigModel }, null, 1));
await browser.close();
