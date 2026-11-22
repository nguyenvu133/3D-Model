/* tools/dbg-page-errors.mjs — in lỗi JS của trang studio khi khởi động */
import { chromium } from 'playwright-core';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8099';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const logs = [];
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') logs.push('CONSOLE: ' + m.text()); });
page.on('requestfailed', r => logs.push('REQFAIL: ' + r.url()));
await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(6000);
const state = await page.evaluate(() => ({
  THREE: !!window.THREE,
  PixiStudio: !!window.PixiStudio,
  FBXBinary: !!(window.PixiStudio && PixiStudio.FBXBinary),
  FBXLoader: !!(window.THREE && THREE.FBXLoader)
}));
console.log(JSON.stringify(state));
console.log(logs.slice(0, 15).join('\n'));
await browser.close();
