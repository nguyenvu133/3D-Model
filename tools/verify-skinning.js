/* tools/verify-skinning.js — verify skinning pipeline elements */
'use strict';
const fs = require('fs');
const rag = fs.readFileSync('js/rigging/rig-auto-gen.js', 'utf8');
console.log('=== RIG AUTO GEN — skinning pipeline ===');
[
  ['bindSkin', 'AUTO-SKINNING function'],
  ['THREE.SkinnedMesh', 'SkinnedMesh creation'],
  ['THREE.Skeleton(', 'Skeleton constructor'],
  ['skinIndex', 'skin indices attribute'],
  ['skinWeight', 'skin weights attribute'],
  ['skinned.bind(skeleton', 'bind mesh→skeleton'],
  ['distToSegment', 'bone segment distance'],
  ['_anchors', 'anchor dict fix'],
  ['bake mesh transform', 'world-space bake'],
  ['generateAsync', 'backend analyze client'],
  ['applyBackendAnchors', 'backend anchors']
].forEach(c => console.log((rag.indexOf(c[0]) !== -1 ? '✓' : '✗ MISSING') + ' ' + c[1]));

const srv = fs.readFileSync('server.js', 'utf8');
console.log('=== SERVER rig-analyze ===');
['handleRigAnalyze', 'armsRaised', 'bandMeanAX', 'skeleton.bones'].forEach(c => console.log((srv.indexOf(c) !== -1 ? '✓' : '✗') + ' ' + c));

const st = fs.readFileSync('js/core/state.js', 'utf8');
console.log('=== Perspective default ===');
console.log((st.indexOf("viewMode: 'perspective'") !== -1 ? '✓' : '✗') + ' state.js default');
const idx = fs.readFileSync('index.html', 'utf8');
console.log((idx.indexOf('<option value="perspective" selected>') !== -1 ? '✓' : '✗') + ' select default');
const vp = fs.readFileSync('js/viewport/viewport.js', 'utf8');
console.log((vp.indexOf("Viewport.setView('perspective')") !== -1 ? '✓' : '✗') + ' viewport init');

const aag = fs.readFileSync('js/animation/anim-auto-gen.js', 'utf8');
console.log('=== Meshy-style buttons ===');
console.log((aag.indexOf('Rig AI Gen') !== -1 ? '✓' : '✗') + ' Rig AI Gen button');
console.log((aag.indexOf('Animation AI Gen') !== -1 ? '✓' : '✗') + ' Animation AI Gen button');
const fbx = fs.readFileSync('js/animation/fbx-rig-import.js', 'utf8');
console.log((fbx.indexOf('DEDUPE: remove existing') !== -1 ? '✓' : '✗') + ' addToViewport dedupe');
