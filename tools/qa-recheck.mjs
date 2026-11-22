/* tools/qa-recheck.mjs — re-measure the suspicious motions over a full cycle. */
import { chromium } from 'playwright-core';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.PixiStudio && PixiStudio.Models.loadGLBFromBuffer, { timeout: 90000 });
await page.waitForTimeout(700);

const out = await page.evaluate(async () => {
  const res = { rig: null, tests: [] };
  const buf = await (await fetch('assets/models/tripo_convert_monter1.glb')).arrayBuffer();
  const entry = await PixiStudio.Models.loadGLBFromBuffer(buf, 'RecheckCharacter', buf.byteLength);
  PixiStudio.RigAutoGen.generate(entry.object3D, 'Studio Humanoid');
  PixiStudio.RigAutoGen.playing = true;
  const M = PixiStudio.M2MMotion; await M.loadCatalog();
  res.rig = { bones: PixiStudio.RigAutoGen.current.boneCount, skinned: PixiStudio.RigAutoGen.current.skinnedCount };

  /* sample every animated bone over the whole clip, not just the probe bones */
  const measure = async (url) => {
    const t = { root: PixiStudio.RigAutoGen.current.target, mixer: PixiStudio.RigAutoGen.current.mixer };
    M.loop = true; M.useRootMotion = false;
    const info = await M.play(url, 'x');
    if (!info) return { error: 'play null' };
    const bones = [];
    t.root.traverse(o => { if (o.isBone) bones.push(o); });
    const read = () => { t.root.updateMatrixWorld(true); return bones.map(b => b.matrixWorld.elements.slice(12, 15)); };
    const first = read();
    let minY = Infinity, maxY = -Infinity, maxTravel = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 220));
      const now = read();
      first.forEach((a, k) => {
        const b = now[k];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d > maxTravel) maxTravel = d;
      });
      bones.forEach((b, k) => {
        const y = now[k][1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      });
    }
    return { tracks: info.tracks, duration: +info.duration.toFixed(2), maxTravel: +maxTravel.toFixed(4), heightSwing: +(maxY - minY).toFixed(4) };
  };

  const list = M.motions('human');
  for (const nm of ['Pistol_Reload_2', 'Pistol Walk', 'Idle_A', 'Walk', 'Run_Anime']) {
    const m = list.find(x => x.name === nm);
    if (!m) { res.tests.push({ name: nm, missing: true }); continue; }
    const r = await measure(m.url);
    res.tests.push(Object.assign({ name: nm }, r));
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
