/* tools/final-verify.js — Node-side final verification */
'use strict';
const fs = require('fs');

console.log('=== FINAL VERIFICATION ===');
let jsCount = 0, jsErrors = 0;
(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) {
      jsCount++;
      try { new Function(fs.readFileSync(p, 'utf8')); } catch (err) { jsErrors++; console.log('SYNTAX ERR:', p, err.message); }
    }
  });
})('js');
console.log('1. JS files:', jsCount, '| errors:', jsErrors);

const models = fs.readdirSync('assets/models').filter(f => f.endsWith('.glb'));
console.log('2. GLB files:', models.join(', '));

const checks = [
  ['js/rigging/rig-auto-gen.js', 'generateAsync', 'backend rig analyze client'],
  ['js/rigging/rig-auto-gen.js', 'applyBackendAnchors', 'backend anchors apply'],
  ['js/rigging/rig-auto-gen.js', '_anchors', 'anchor dict (matrixWorld fix)'],
  ['js/animation/anim-auto-gen.js', 'const U = PixiStudio.Utils', 'U bug fixed'],
  ['js/animation/anim-auto-gen.js', 'generateAll', '6 clips generator'],
  ['js/exporter/save-manager.js', 'applySimplifyFromServer', 'simplify client pipeline'],
  ['js/exporter/save-manager.js', 'tripo-glb', 'TripoGLB format'],
  ['js/exporter/save-manager.js', 'blend-kit', 'Blender Import Kit'],
  ['js/exporter/save-manager.js', 'glb-hq', 'High Quality preset'],
  ['js/exporter/save-manager.js', 'simplifyRatio', 'simplify option'],
  ['js/ai/tripo-adapter.js', 'textureModel', 'Tripo Texturing'],
  ['js/ai/tripo-adapter.js', 'upscaleModel', 'Tripo Upscale'],
  ['js/ai/tripo-adapter.js', 'rigModel', 'Tripo Auto Rig'],
  ['js/ai/tripo-adapter.js', 'animateModel', 'Tripo Auto Animate'],
  ['js/ai/tripo-adapter.js', 'lastCreatedModelId', 'model id chain'],
  ['server.js', 'api/rig-analyze', 'backend rig analyze endpoint'],
  ['server.js', 'api/meshopt-simplify', 'simplify endpoint'],
  ['server.js', 'api/models', 'auto-detect models endpoint']
];
console.log('3. Feature checks:');
checks.forEach(c => {
  let content = '';
  try { content = fs.readFileSync(c[0], 'utf8'); } catch (e) { }
  const found = content.indexOf(c[1]) !== -1;
  console.log('  ' + (found ? '✓' : '✗ MISSING') + ' ' + c[1] + (found ? '' : ' ← ' + c[2]));
});

const gw = fs.readFileSync('js/exporter/glb-writer.js', 'utf8');
console.log('4. GLBWriter tripoFormat:');
[['tripoFormat', 'option'], ['tripo_mesh_', 'mesh naming'], ['tripo_mat_', 'material naming'],
 ['KHR_materials_specular', 'specular ext'], ['force16bitIndices', 'force16bit'],
 ['tripoUUID', 'tripo UUID']].forEach(c => {
  console.log('  ' + (gw.indexOf(c[0]) !== -1 ? '✓' : '✗') + ' ' + c[1]);
});

/* 5. Server endpoints */
const srv = fs.readFileSync('server.js', 'utf8');
console.log('5. Server endpoints:');
['api/meshopt-ping', 'api/meshopt-encode', 'api/meshopt-simplify', 'api/rig-analyze', 'api/models'].forEach(e => {
  console.log('  ' + (srv.indexOf(e) !== -1 ? '✓' : '✗') + ' /' + e);
});
