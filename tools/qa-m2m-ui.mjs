/* tools/qa-m2m-ui.mjs — kiểm thử luồng UI thật (click) của mesh2motion.html */
import { chromium } from 'playwright-core';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/mesh2motion.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.M2MUI && PixiStudio.M2MMotion.catalog, { timeout: 90000 });
await page.waitForTimeout(900);

const R = {};
/* nạp model human base qua UI path (dùng engine nhưng UI cập nhật) */
await page.evaluate(async () => {
  const cat = PixiStudio.M2MMotion.catalog;
  const e = await window.M2MPage.loadModelUrl(cat.rigs.human.model, 'UI human');
  window.M2MPage.adoptExistingSkeleton(e.object3D, e.clips || []);
  PixiStudio.M2MMotion.setRig('human');
});

/* 1) click vào animation card đầu tiên để play */
const firstCard = page.locator('#m2m-anims .acard').first();
R.firstCardName = await firstCard.locator('.an').textContent();
await firstCard.click();
await page.waitForTimeout(900);
R.afterPlay = await page.evaluate(() => ({
  clipname: document.getElementById('m2m-clipname').textContent,
  timecode: document.getElementById('m2m-timecode').textContent,
  playBtn: document.getElementById('m2m-play').textContent.trim(),
  playhead: document.getElementById('m2m-playhead').style.left,
  playingClass: !!document.querySelector('#m2m-anims .acard.playing')
}));

/* 2) tick checkbox 4 card → selected rows */
R.tick = await page.evaluate(async () => {
  const cbs = Array.from(document.querySelectorAll('#m2m-anims .acard .cb')).slice(0, 4);
  cbs.forEach(cb => cb.click());
  document.querySelector('.tab[data-tab="selected"]').click();
  await new Promise(r => setTimeout(r, 120));
  return {
    selected: window.M2MUI.selected.length,
    rows: document.querySelectorAll('#m2m-selected .selrow').length,
    badge: document.getElementById('m2m-selcount').textContent
  };
});

/* 3) thêm vào remix từ tab selected */
R.remix = await page.evaluate(async () => {
  const btns = Array.from(document.querySelectorAll('#m2m-selected .selrow button')).filter(b => b.textContent === '＋');
  btns.slice(0, 3).forEach(b => b.click());
  document.querySelector('.tab[data-tab="remix"]').click();
  await new Promise(r => setTimeout(r, 150));
  return { steps: window.M2MPage.remix.list.length, rows: document.querySelectorAll('#m2m-remix .rstep').length };
});

/* 4) play remix 1 nhịp */
R.remixPlay = await page.evaluate(async () => {
  document.getElementById('m2m-remix-play').click();
  await new Promise(r => setTimeout(r, 900));
  return { playing: window.M2MPage.remix.playing, index: window.M2MPage.remix.index, activeRows: document.querySelectorAll('#m2m-remix .rstep.active').length };
});

/* 5) filter + sort + search */
R.filters = await page.evaluate(async () => {
  document.querySelector('.tab[data-tab="library"]').click();
  const s = document.getElementById('m2m-anim-search');
  s.value = 'sword'; s.dispatchEvent(new Event('input'));
  await new Promise(r => setTimeout(r, 150));
  const afterSearch = document.querySelectorAll('#m2m-anims .acard').length;
  s.value = ''; s.dispatchEvent(new Event('input'));
  const sort = document.getElementById('m2m-sort');
  sort.value = 'duration'; sort.dispatchEvent(new Event('change'));
  await new Promise(r => setTimeout(r, 120));
  const firstDur = document.querySelector('#m2m-anims .acard .am span:nth-child(2)').textContent;
  return { afterSearch, firstDurAfterSort: firstDur, count: document.getElementById('m2m-anim-count').textContent };
});

/* 6) chuyển rig category sang fox */
R.rigSwitch = await page.evaluate(async () => {
  const chips = Array.from(document.querySelectorAll('#m2m-categories .chip'));
  const fox = chips.find(c => c.textContent.trim() === 'Fox');
  fox.click();
  await new Promise(r => setTimeout(r, 400));
  return {
    animCards: document.querySelectorAll('#m2m-anims .acard').length,
    count: document.getElementById('m2m-anim-count').textContent,
    rig: PixiStudio.M2MMotion.rigId
  };
});

/* 7) viewport buttons */
R.vp = await page.evaluate(async () => {
  const out = {};
  const click = (k) => document.querySelector('[data-vp="' + k + '"]').click();
  click('wireframe'); out.wire = window.M2MPage.settings.wireframe;
  click('wireframe');
  click('skeleton'); out.skeleton = window.M2MPage.settings.skeleton;
  click('skeleton');
  click('grid'); out.grid = window.M2MPage.settings.grid; click('grid');
  click('ortho'); out.ortho = !!window.M2MPage.camera.isOrthographicCamera;
  click('ortho'); out.persp = !!window.M2MPage.camera.isPerspectiveCamera;
  click('focus'); out.radius = +window.M2MPage.orbit.dRadius.toFixed(2);
  return out;
});

R.pageErrors = errs;
console.log(JSON.stringify(R, null, 1));
await browser.close();