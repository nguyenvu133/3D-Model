/* ============================================================
 * tools/inspect-glb.js — Inspect cấu trúc file GLB:
 * chunks, nodes, meshes, accessors, bufferViews, extensions,
 * và histogram vị trí đỉnh theo trục để tìm cụm nhân vật.
 *
 * Chạy:  node tools/inspect-glb.js [đường-dẫn-glb]
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const GLB_FILE = process.argv[2] || path.join(__dirname, '..', 'assets', 'models', 'kiemhiep.glb');

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error('Không phải file GLB (magic sai)');
  const version = buf.readUInt32LE(4);
  const totalLen = buf.readUInt32LE(8);
  let off = 12;
  let json = null, bin = null;
  while (off < totalLen) {
    const chunkLen = buf.readUInt32LE(off);
    const chunkType = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + chunkLen);
    if (chunkType === CHUNK_JSON) json = JSON.parse(data.toString('utf8'));
    else if (chunkType === CHUNK_BIN) bin = data;
    off += 8 + chunkLen;
  }
  return { buf, version, json, bin, totalLen };
}

/* Decode accessor → Float32Array/Uint32Array (hỗ trợ EXT_meshopt_compression) */
function decodeAccessor(gltf, bin, accessorIndex, meshoptDecoder) {
  const acc = gltf.accessors[accessorIndex];
  const bv = gltf.bufferViews[acc.bufferView];
  let raw;

  const ext = bv.extensions && bv.extensions.EXT_meshopt_compression;
  if (ext) {
    const src = new Uint8Array(bin.buffer, bin.byteOffset + (ext.byteOffset || 0), ext.byteLength);
    const compSize = COMPONENT_SIZE[acc.componentType];
    const numComp = TYPE_COUNT[acc.type];
    const count = acc.count;
    const target = new ArrayBuffer(count * numComp * compSize);
    const mode = ext.mode || 'ATTRIBUTES';
    const filter = ext.filter || 'NONE';
    const decoded = meshoptDecoder.decodeGltfBuffer(
      new Uint8Array(target), count, numComp * compSize, src, mode, filter
    );
    raw = new Uint8Array(target);
  } else {
    const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    raw = bin.subarray(byteOffset, byteOffset + acc.count * TYPE_COUNT[acc.type] * COMPONENT_SIZE[acc.componentType]);
  }

  if (acc.componentType === 5126) return new Float32Array(raw.buffer, raw.byteOffset, acc.count * TYPE_COUNT[acc.type]);
  if (acc.componentType === 5125) return new Uint32Array(raw.buffer, raw.byteOffset, acc.count * TYPE_COUNT[acc.type]);
  if (acc.componentType === 5123) return new Uint16Array(raw.buffer, raw.byteOffset, acc.count * TYPE_COUNT[acc.type]);
  if (acc.componentType === 5121) return new Uint8Array(raw.buffer, raw.byteOffset, acc.count * TYPE_COUNT[acc.type]);
  throw new Error('componentType chưa hỗ trợ: ' + acc.componentType);
}

function main() {
  console.log('='.repeat(64));
  console.log(' GLB INSPECT —', path.basename(GLB_FILE));
  console.log('='.repeat(64));
  const { buf, version, json, bin } = readGLB(GLB_FILE);
  console.log('File size  :', (buf.length / 1048576).toFixed(2), 'MB');
  console.log('GLB version:', version);
  console.log('BIN chunk  :', (bin ? bin.length / 1048576 : 0).toFixed(2), 'MB');
  console.log('extensionsUsed:', JSON.stringify(json.extensionsUsed || []));
  console.log('extensionsRequired:', JSON.stringify(json.extensionsRequired || []));
  console.log('');

  console.log('--- SCENE TREE ---');
  const scene = json.scenes[json.scene || 0];
  const dumpNode = (idx, depth) => {
    const n = json.nodes[idx];
    const label = [
      n.mesh !== undefined ? 'mesh#' + n.mesh : null,
      n.name ? '"' + n.name + '"' : null,
      n.translation ? 'T[' + n.translation.map(v => +v.toFixed(2)) + ']' : null,
      n.scale ? 'S[' + n.scale.map(v => +v.toFixed(2)) + ']' : null,
      n.rotation ? 'R[' + n.rotation.map(v => +v.toFixed(2)) + ']' : null,
      n.matrix ? 'matrix' : null,
      n.children ? 'children:' + n.children.length : null
    ].filter(Boolean).join(' ');
    console.log('  '.repeat(depth) + '• node[' + idx + '] ' + label);
    if (n.children) n.children.forEach(c => dumpNode(c, depth + 1));
  };
  scene.nodes.forEach(n => dumpNode(n, 0));
  console.log('');

  console.log('--- MESHES / PRIMITIVES ---');
  (json.meshes || []).forEach((m, mi) => {
    console.log('mesh[' + mi + '] "' + (m.name || '') + '" primitives:' + m.primitives.length);
    m.primitives.forEach((p, pi) => {
      const posAcc = json.accessors[p.attributes.POSITION];
      const idxAcc = p.indices !== undefined ? json.accessors[p.indices] : null;
      console.log('  prim[' + pi + '] mode:' + (p.mode === undefined ? 4 : p.mode) +
        ' verts:' + posAcc.count +
        (idxAcc ? ' indices:' + idxAcc.count : ' (non-indexed)'));
      console.log('    attrs: ' + Object.keys(p.attributes).join(', '));
      if (idxAcc) console.log('    index componentType:', idxAcc.componentType, '(5125=u32, 5123=u16)');
      Object.keys(p.attributes).forEach(k => {
        const a = json.accessors[p.attributes[k]];
        console.log('    ' + k + ': ' + a.type + '/' + a.componentType + ' count:' + a.count +
          ' bv:' + a.bufferView + (a.bufferView !== undefined && json.bufferViews[a.bufferView].extensions ? ' [MESHOPT]' : ''));
      });
      if (p.targets) console.log('    morph targets:', p.targets.length);
      if (p.material !== undefined) {
        const mat = json.materials[p.material];
        console.log('    material[' + p.material + '] "' + (mat.name || '') + '"' +
          (mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture ? ' baseColorTex✓' : '') +
          (mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.metallicRoughnessTexture ? ' mrTex✓' : '') +
          (mat.normalTexture ? ' normalTex✓' : ''));
      }
    });
  });
  console.log('');

  console.log('--- IMAGES / TEXTURES ---');
  (json.images || []).forEach((img, i) => {
    const bv = img.bufferView !== undefined ? json.bufferViews[img.bufferView] : null;
    console.log('image[' + i + '] mime:' + img.mimeType +
      (bv ? ' size:' + ((bv.byteLength / 1048576).toFixed(2)) + 'MB' : '') +
      (img.name ? ' "' + img.name + '"' : ''));
  });
  console.log('textures:', (json.textures || []).length, '| samplers:', (json.samplers || []).length, '| materials:', (json.materials || []).length);
  console.log('');

  /* --- PHÂN TÍCH CỤM NHÂN VẬT theo trục Z & X --- */
  console.log('--- VERTEX CLUSTER ANALYSIS (POSITION) ---');
  let MeshoptDecoder = null;
  try { MeshoptDecoder = require('meshoptimizer').MeshoptDecoder; } catch (e) {
    console.log('⚠ meshoptimizer chưa cài — npm install meshoptimizer');
    return;
  }

  const primInfo = [];
  (json.meshes || []).forEach((m, mi) => {
    m.primitives.forEach((p, pi) => {
      primInfo.push({ mesh: mi, prim: pi, posAcc: p.attributes.POSITION, idxAcc: p.indices });
    });
  });

  if (!MeshoptDecoder) {
    console.log('⚠ meshoptimizer chưa cài — bỏ qua phân tích cluster (chạy: npm install meshoptimizer)');
    return;
  }

  const ready = MeshoptDecoder.ready ? MeshoptDecoder.ready : Promise.resolve();
  ready.then(() => {
    primInfo.forEach(info => {
      const pos = decodeAccessor(json, bin, info.posAcc, MeshoptDecoder);
      const nVerts = pos.length / 3;
      console.log('prim mesh#' + info.mesh + '[' + info.prim + '] vertices: ' + nVerts);

      /* histogram theo trục Z (32 buckets) và X */
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < nVerts; i++) {
        for (let a = 0; a < 3; a++) {
          const v = pos[i * 3 + a];
          if (v < min[a]) min[a] = v;
          if (v > max[a]) max[a] = v;
        }
      }
      console.log('  bbox: x[' + min[0].toFixed(2) + ' … ' + max[0].toFixed(2) + '] y[' + min[1].toFixed(2) + ' … ' + max[1].toFixed(2) + '] z[' + min[2].toFixed(2) + ' … ' + max[2].toFixed(2) + ']');

      const hist = (axis, buckets) => {
        const h = new Array(buckets).fill(0);
        const range = max[axis] - min[axis];
        for (let i = 0; i < nVerts; i++) {
          let b = Math.floor((pos[i * 3 + axis] - min[axis]) / range * buckets);
          if (b >= buckets) b = buckets - 1;
          h[b]++;
        }
        return h.map(v => (v / nVerts * 100).toFixed(1) + '%');
      };
      console.log('  hist X (32 buckets):', hist(0, 32).join(' '));
      console.log('  hist Y (16 buckets):', hist(1, 16).join(' '));
      console.log('  hist Z (32 buckets):', hist(2, 32).join(' '));

      /* Đếm đỉnh theo vùng khoảng trống (gap detection) trên Z và X
         để tìm ranh giới giữa các nhân vật */
      const gaps = (axis, resolution) => {
        const steps = Math.ceil((max[axis] - min[axis]) * resolution) + 1;
        const occupied = new Array(steps).fill(0);
        for (let i = 0; i < nVerts; i++) {
          let s = Math.floor((pos[i * 3 + axis] - min[axis]) * resolution);
          if (s >= steps) s = steps - 1;
          if (s < 0) s = 0;
          occupied[s]++;
        }
        /* tìm vùng trống >= 5 bước liên tiếp */
        const emptyRanges = [];
        let start = -1;
        for (let s = 0; s < steps; s++) {
          if (occupied[s] === 0 && start === -1) start = s;
          if (occupied[s] !== 0 && start !== -1) {
            if (s - start >= 5) emptyRanges.push([min[axis] + start / resolution, min[axis] + s / resolution]);
            start = -1;
          }
        }
        if (start !== -1 && steps - start >= 5) emptyRanges.push([min[axis] + start / resolution, max[axis]]);
        return emptyRanges;
      };
      console.log('  gaps trên X:', JSON.stringify(gaps(0, 20).map(r => r.map(v => +v.toFixed(2)))));
      console.log('  gaps trên Z:', JSON.stringify(gaps(2, 20).map(r => r.map(v => +v.toFixed(2)))));
    });
  }).catch(e => console.error('Decode lỗi:', e));
}

main();
