/* tools/verify-v508.js — verify v5.0.8 full */
'use strict';
const fs = require('fs');
console.log('=== v5.0.8 FINAL VERIFY ===');
let jsCount = 0, jsErrors = 0;
(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) {
      jsCount++;
      try { new Function(fs.readFileSync(p, 'utf8')); } catch (err) { jsErrors++; console.log('SYNTAX ERR:', p); }
    }
  });
})('js');
console.log('1. JS files:', jsCount, '| errors:', jsErrors);

const checks = [
  ['js/textures/texture-manager.js', 'optimizeDisplay', 'Texture Safe Mode (IAB fix)'],
  ['js/textures/texture-manager.js', 'originalImage', 'original giữ cho export'],
  ['js/models/model-manager.js', 'optimizeDisplay', 'wire sau GLB parse'],
  ['js/models/model-manager.js', '|| 512)', 'SAFE MODE 512 default'],
  ['js/exporter/glb-writer.js', 'userData.originalImage', 'export dùng original full-res'],
  ['js/renderer/three-renderer.js', 'setPixelRatio(1)', 'pixelRatio 1 safe'],
  ['js/materials/material-manager.js', 'Auto-update scope', 'material scope select'],
  ['js/materials/material-manager.js', 'Kim loại', 'material presets'],
  ['js/materials/material-manager.js', 'invalidateShading', 'viewport live refresh'],
  ['js/rigging/rig-auto-gen.js', 'RE-USE', 'generate re-use (fix Idle đơ)'],
  ['js/rigging/rig-auto-gen.js', 'bindSkin(target)', 'bindSkin call sau current'],
  ['js/rigging/rig-auto-gen.js', 'THREE.SkinnedMesh', 'skin pipeline'],
  ['js/animation/anim-auto-gen.js', 'Rig AI Gen', 'Meshy Rig AI Gen button'],
  ['js/animation/anim-auto-gen.js', 'Animation AI Gen', 'Meshy Animation AI Gen button'],
  ['js/animation/fbx-rig-import.js', 'DEDUPE', 'addToViewport dedupe'],
  ['js/rigging/meshy-rigging.js', 'autoRig', 'Meshy Rigging Studio'],
  ['js/ui/topbar.js', 'rigging', 'Rigging nav tab'],
  ['js/ai/ai-panel.js', 'openQuickGenerate', 'Tripo Quick Generate'],
  ['js/ai/ai-panel.js', 'openConnectModal', 'Tripo Connect modal'],
  ['js/ai/ai-panel.js', 'startAutoUpdate', 'auto-update engine'],
  ['server.js', 'api/fbx-list', 'FBX list endpoint']
];
console.log('2. Feature checks:');
let pass = 0;
checks.forEach(c => {
  let content = '';
  try { content = fs.readFileSync(c[0], 'utf8'); } catch (e) { }
  const ok = content.indexOf(c[1]) !== -1;
  if (ok) pass++;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + c[1]);
});
console.log('3. Result:', pass + '/' + checks.length, 'features ✓');
