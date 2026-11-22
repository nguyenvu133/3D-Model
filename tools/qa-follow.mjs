import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(process.env.QA_BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => window.PixiStudio && PixiStudio.Interaction, { timeout: 90000 });
await p.waitForTimeout(900);
const out = await p.evaluate(async () => {
  const IX = PixiStudio.Interaction, o = PixiStudio.Viewport.orbit;
  const sel = PixiStudio.State.get('selection');
  IX.setSelection([sel], sel);
  IX.toggleFollow(true);
  const x0 = o.dTarget.x, sx0 = sel.position.x;
  sel.position.x += 7;
  const samples = [];
  let frames = 0; const t0 = performance.now();
  const tick = () => { frames++; };
  PixiStudio.bus.on('perf:tick', tick);
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 400));
    samples.push({ t: Math.round(performance.now() - t0), dTargetX: +o.dTarget.x.toFixed(2), selX: +sel.position.x.toFixed(2), gap: +Math.abs(o.dTarget.x - sel.position.x).toFixed(2) });
  }
  PixiStudio.bus.off && PixiStudio.bus.off('perf:tick', tick);
  const last = samples[samples.length - 1];
  return { x0: +x0.toFixed(2), sx0: +sx0.toFixed(2), samples, converged: last.gap < 1.0, frames };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
