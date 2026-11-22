/* ============================================================
 * tools/verify-anim.js — Verify clip animation (presets + Auto Gen)
 * bằng three.js THẬT chạy trong Node:
 *   1) mọi track phải có values.length = times.length × size (3 vector / 4 quaternion)
 *   2) mọi giá trị phải hữu hạn (NaN làm hỏng interpolant)
 *   3) chạy AnimationMixer N update cho từng clip — nếu track sai, three.js
 *      sẽ lặp vô hạn trong Interpolant.evaluate → test treo/không in DONE
 *
 * Chạy: node tools/verify-anim.js [đường-dẫn-three.min.js]
 * Mặc định: $TEMP/three-r128.min.js hoặc js/vendor/three.min.js
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const candidates = [
  process.argv[2],
  process.env.THREE_PATH,
  path.join(process.env.TEMP || '/tmp', 'three-r128.min.js'),
  path.join(root, 'js', 'vendor', 'three.min.js')
].filter(Boolean);

const threePath = candidates.find(function (p) { return fs.existsSync(p); });
if (!threePath) {
  console.error('Không tìm thấy three.min.js. Truyền đường dẫn: node tools/verify-anim.js <three.min.js>');
  process.exit(2);
}

global.window = global;
global.THREE = require(threePath);
global.PixiStudio = { bus: { emit: function () { } }, Utils: {} };

/* nạp 2 module sinh clip của app (chúng gắn vào window.PixiStudio) */
require(path.join(root, 'js', 'animation', 'presets.js'));
require(path.join(root, 'js', 'animation', 'anim-auto-gen.js'));

const Presets = global.PixiStudio.AnimPresets;
const AutoGen = global.PixiStudio.AnimAutoGen;

let fails = 0;
const pass = function (s) { console.log('  \u2713 ' + s); };
const fail = function (s) { fails++; console.log('  \u2717 ' + s); };

function checkTracks(label, clip) {
  let bad = 0;
  clip.tracks.forEach(function (t) {
    const size = t.name.indexOf('quaternion') !== -1 ? 4 : 3;
    const need = t.times.length * size;
    if (t.values.length !== need) {
      bad++;
      fail(label + ' ' + t.name + ': values=' + t.values.length + ' cần=' + need);
      return;
    }
    for (let i = 0; i < t.values.length; i++) {
      if (!isFinite(t.values[i])) {
        bad++;
        fail(label + ' ' + t.name + ': có giá trị NaN/Inf tại index ' + i);
        return;
      }
    }
    if (!(clip.duration > 0)) { bad++; fail(label + ': duration không hợp lệ (' + clip.duration + ')'); }
  });
  if (!bad) pass(label + ' — ' + clip.tracks.length + ' track hợp lệ · ' + clip.duration + 's');
  return bad;
}

/* Chạy mixer thật: 120 update (~2s @60fps) */
function runMixer(label, clip, loop) {
  const obj = new global.THREE.Object3D();
  const mixer = new global.THREE.AnimationMixer(obj);
  const action = mixer.clipAction(clip);
  action.setLoop(loop ? global.THREE.LoopRepeat : global.THREE.LoopOnce);
  action.clampWhenFinished = !loop;
  action.play();
  const t0 = Date.now();
  for (let i = 0; i < 120; i++) mixer.update(0.016);
  const ms = Date.now() - t0;
  const nan = !isFinite(obj.position.x) || !isFinite(obj.position.y) || !isFinite(obj.position.z) ||
    !isFinite(obj.quaternion.x) || !isFinite(obj.quaternion.w);
  if (nan) fail(label + ': mixer cho NaN sau 120 update');
  return { ms: ms, nan: nan, moved: obj.position.length() > 1e-9 };
}

console.log('three.js r' + global.THREE.REVISION + ' — ' + threePath);
console.log('\n[1] 16 preset procedural (presets.js)');
Presets.META.forEach(function (m) {
  const clip = Presets.generate(m.id);
  const bad = checkTracks(m.id, clip);
  if (!bad) {
    const r = runMixer(m.id, clip, m.loop);
    if (!r.nan) pass('    mixer 120 update: ' + r.ms + 'ms · ' + (r.moved ? 'có chuyển động' : 'đứng yên (chỉ rotation)'));
  }
});

console.log('\n[2] 6 clip Animation Auto Gen (anim-auto-gen.js)');
const bones = new Proxy({}, { get: function (t, k) { return 'Bone_' + String(k); } });
const autoClips = AutoGen.generateAll({ bones: bones });
if (!autoClips.length) fail('generateAll trả về rỗng');
autoClips.forEach(function (c) {
  const bad = checkTracks(c.id, c.clip);
  if (!bad) {
    const r = runMixer(c.id, c.clip, c.loop);
    if (!r.nan) pass('    mixer 120 update: ' + r.ms + 'ms');
  }
});

console.log('\n' + (fails === 0 ? 'KẾT QUẢ: ✓ TẤT CẢ PASS — không track nào gây treo' : 'KẾT QUẢ: ✗ ' + fails + ' lỗi'));
process.exit(fails === 0 ? 0 : 1);
