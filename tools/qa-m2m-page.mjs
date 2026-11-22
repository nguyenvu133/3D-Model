/* tools/qa-m2m-page.mjs — kiểm thử mesh2motion.html */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const OUT = path.join(process.cwd(), '_qa'); fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(BASE + '/mesh2motion.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.M2MPage && window.PixiStudio && PixiStudio.M2MMotion && PixiStudio.M2MMotion.catalog, { timeout: 90000 });
await page.waitForTimeout(1200);

const R = {};
R.catalog = await page.evaluate(() => ({
  badge: document.getElementById('m2m-catalog-badge').textContent,
  rigChips: document.querySelectorAll('#m2m-categories .chip').length,
  modelCards: document.querySelectorAll('#m2m-models .mcard').length,
  animCards: document.querySelectorAll('#m2m-anims .acard').length,
  animCount: document.getElementById('m2m-anim-count').textContent
}));

/* nạp model base của rig human (có skeleton sẵn) */
R.loadModel = await page.evaluate(async () => {
  const cat = PixiStudio.M2MMotion.catalog;
  const url = cat.rigs.human.model;
  const e = await window.M2MPage.loadModelUrl(url, 'QA human');
  const rig = window.M2MPage.adoptExistingSkeleton(e.object3D, e.clips || []);
  PixiStudio.M2MMotion.setRig('human');
  return { name: e.name, tris: e.stats.tris, bones: rig ? rig.boneCount : 0, clips: (e.clips || []).length };
});

/* phát 3 animation + đo bone travel */
R.play = await page.evaluate(async () => {
  const M = PixiStudio.M2MMotion;
  const out = [];
  const list = M.motions('human');
  for (const nm of ['Run_Anime', 'Sword_Regular_A', 'Dance_Simple']) {
    const a = list.find(x => x.name === nm);
    if (!a) { out.push({ name: nm, missing: true }); continue; }
    const info = await window.M2MPage.play(a.url, a.name);
    const probe = await M.probe(600);
    out.push({ name: nm, tracks: info ? info.tracks : 0, dur: info ? +info.duration.toFixed(2) : 0, travel: probe ? probe.maxTravel : null,
      clipName: document.getElementById('m2m-clipname').textContent, timecode: document.getElementById('m2m-timecode').textContent });
  }
  return out;
});

/* chọn nhiều + selected tab */
R.select = await page.evaluate(() => {
  const ui = window.M2MUI;
  ui.filtered.slice(0, 5).forEach(a => { if (!ui.selected.some(s => s.url === a.url)) ui.selected.push({ url: a.url, name: a.name, duration: a.duration, loop: a.loop, rootMotion: a.rootMotion }); });
  document.querySelector('.tab[data-tab="selected"]').click();
  return { selected: ui.selected.length, rows: document.querySelectorAll('#m2m-selected .selrow').length, tabOn: !!document.querySelector('#m2m-tab-selected.on') };
});

/* remix */
R.remix = await page.evaluate(() => {
  const ui = window.M2MUI;
  ui.selected.slice(0, 3).forEach(s => window.M2MPage.remixAdd(s));
  document.querySelector('.tab[data-tab="remix"]').click();
  return { steps: window.M2MPage.remix.list.length, rows: document.querySelectorAll('#m2m-remix .rstep').length };
});

/* export JSON (nhẹ) */
R.exportJson = await page.evaluate(async () => {
  const ui = window.M2MUI;
  let bytes = 0;
  const orig = PixiStudio.Utils.downloadText;
  PixiStudio.Utils.downloadText = (t) => { bytes = t.length; };
  const n = await window.M2MPage.exportClipJSON({ clips: ui.selected.slice(0, 2), filename: 'qa' });
  PixiStudio.Utils.downloadText = orig;
  return { clips: n, jsonBytes: bytes };
});

/* settings modal + retarget diagnostics */
R.settings = await page.evaluate(() => {
  document.querySelector('[data-nav="settings"]').click();
  const open = document.getElementById('m2m-modal').classList.contains('on');
  const fieldsets = document.querySelectorAll('#m2m-modal-body .fieldset').length;
  return { open, fieldsets };
});
R.diag = await page.evaluate(async () => {
  document.getElementById('m2m-modal-x').click();
  const a = PixiStudio.M2MMotion.motions('human')[0];
  const d = await window.M2MPage.retargetDiagnostics(a.url);
  return d ? { clip: d.clipName, mode: d.mode, src: d.srcBones, tgt: d.targetBones, match: d.directMatch, out: d.outTracks } : null;
});

/* AI tab */
R.ai = await page.evaluate(() => {
  document.querySelector('.tab[data-tab="ai"]').click();
  return {
    tabOn: !!document.querySelector('#m2m-tab-ai.on'),
    state: document.getElementById('m2m-ai-state').textContent,
    prompt: !!document.getElementById('m2m-ai-prompt'),
    tasks: document.querySelectorAll('#m2m-ai-tasks > *').length
  };
});

R.perf = await page.evaluate(() => window.M2MPage.stats());
R.pageErrors = errs;
await page.screenshot({ path: path.join(OUT, 'mesh2motion-page.png') });
fs.writeFileSync(path.join(OUT, 'mesh2motion-page.json'), JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1));
await browser.close();