#!/usr/bin/env node
/* ============================================================
 * tools/bump-version.js — Bump build version trước mỗi lần đẩy
 *
 * Dùng:  node tools/bump-version.js <sha-ngắn> [--commit <sha-đầy-đủ>]
 *        vd: node tools/bump-version.js 937937bc
 *
 * Làm 4 việc theo quy ước BUILD VERSION (xem comment ở đầu
 * index.html — quên 1 bước là bộ tự kiểm tra bản mới mất tác dụng):
 *   1. version.json: version / commit / updated
 *   2. index.html: window.__PIXISTUDIO_BUILD
 *   3. index.html: toàn bộ ?v=<cũ> → ?v=<mới> (script + CSS)
 *   4. js/core/version.js: window.PixiStudio.BUILD
 *
 * Chỉ sửa 3 file trên, không chạy git, không đẩy gì. Chạy xong in
 * tóm tắt số chỗ đã đổi để bên đẩy kiểm tra trước khi push.
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const sha = (args[0] || '').trim();
if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
  console.error('Dùng: node tools/bump-version.js <sha-ngắn> [--commit <sha-đầy-đủ>]');
  console.error('  vd: node tools/bump-version.js 937937bc');
  process.exit(1);
}
const short = sha.slice(0, 8).toLowerCase();
let full = short;
const ci = args.indexOf('--commit');
if (ci !== -1 && args[ci + 1]) full = args[ci + 1].trim().toLowerCase();
if (!/^[0-9a-f]{40}$/.test(full)) full = short; /* không có SHA đầy đủ thì để ngắn */

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, 'utf8');
}

/* 1. version.json */
const vjPath = path.join(root, 'version.json');
let vj = {};
try { vj = JSON.parse(fs.readFileSync(vjPath, 'utf8')); } catch (e) { vj = {}; }
vj.version = short;
vj.commit = full;
vj.updated = new Date().toISOString();
if (!vj.app) vj.app = '21.0.0';
fs.writeFileSync(vjPath, JSON.stringify(vj, null, 2) + '\n', 'utf8');
console.log('[1] version.json → version=' + short + ' commit=' + full);

/* 2 + 3. index.html: marker + toàn bộ ?v= */
let html = read('index.html');
const markerRe = /window\.__PIXISTUDIO_BUILD\s*=\s*'[^']*'/;
if (!markerRe.test(html)) {
  console.error('KHÔNG TÌM THẤY __PIXISTUDIO_BUILD trong index.html — dừng lại, kiểm tra tay.');
  process.exit(1);
}
html = html.replace(markerRe, "window.__PIXISTUDIO_BUILD = '" + short + "'");
const vMatches = html.match(/\?v=[0-9A-Za-z]+/g) || [];
const vOld = vMatches.length ? vMatches[0] : '(không có)';
html = html.replace(/\?v=[0-9A-Za-z]+/g, '?v=' + short);
write('index.html', html);
console.log('[2] index.html __PIXISTUDIO_BUILD → ' + short);
console.log('[3] index.html ?v=: ' + vMatches.length + ' chỗ (' + vOld + ' → ?v=' + short + ')');

/* 4. js/core/version.js: PixiStudio.BUILD */
let vjs = read('js/core/version.js');
const buildRe = /window\.PixiStudio\.BUILD\s*=\s*'[^']*'/;
if (!buildRe.test(vjs)) {
  console.error('KHÔNG TÌM THẤY PixiStudio.BUILD trong js/core/version.js — dừng lại, kiểm tra tay.');
  process.exit(1);
}
vjs = vjs.replace(buildRe, "window.PixiStudio.BUILD = '" + short + "'");
write('js/core/version.js', vjs);
console.log('[4] js/core/version.js PixiStudio.BUILD → ' + short);
console.log('Xong. Kiểm tra lại bằng: git diff --stat (nếu dùng git) rồi mới đẩy.');
