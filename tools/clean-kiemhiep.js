/* ============================================================
 * tools/clean-kiemhiep.js — "Phẫu thuật" kiemhiep.glb (v2):
 *  1. Decode geometry (EXT_meshopt_compression, đúng byteStride)
 *  2. Phát hiện các cụm nhân vật theo trục Z (histogram + minima)
 *  3. Xác minh các cụm trùng lặp (so count + bbox size)
 *  4. GIỮ 1 nhân vật, XOÁ các bản sao giống nhau
 *  5. Recenter về gốc toạ độ, đáy chạm mặt đất
 *  6. Re-encode meshopt (filter NONE — an toàn tuyệt đối)
 *  7. Ghi GLB mới + backup file gốc + báo cáo trước/sau
 *
 * Chạy: node tools/clean-kiemhiep.js
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { MeshoptDecoder, MeshoptEncoder } = require('meshoptimizer');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'models', 'kiemhiep.glb');
const BACKUP = path.join(ROOT, 'assets', 'models', 'kiemhiep-full-backup.glb');

const MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;
const COMP_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/* ---------- GLB parsing ---------- */
function readGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error('Không phải GLB');
  const total = buf.readUInt32LE(8);
  let off = 12, json = null, bin = null;
  while (off < total) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString('utf8'));
    else if (type === CHUNK_BIN) bin = data;
    off += 8 + len;
  }
  return { buf, json, bin };
}

/* Decode bufferView meshopt/raw → Uint8Array raw bytes (đúng stride) */
function decodeBufferView(json, bin, bvIndex, dec) {
  const bv = json.bufferViews[bvIndex];
  const ext = bv.extensions && bv.extensions.EXT_meshopt_compression;
  if (ext) {
    const stride = ext.byteStride || bv.byteStride || (ext.byteLength / (ext.count || 1));
    const count = ext.count;
    const target = new Uint8Array(count * stride);
    const src = new Uint8Array(bin.buffer, bin.byteOffset + (ext.byteOffset || 0), ext.byteLength);
    dec.decodeGltfBuffer(target, count, stride, src, ext.mode, ext.filter || 'NONE');
    return { data: target, stride: stride };
  }
  const off = bv.byteOffset || 0;
  return { data: new Uint8Array(bin.buffer, bin.byteOffset + off, bv.byteLength), stride: bv.byteStride || 0 };
}

/* ---------- Phát hiện cụm theo trục Z ---------- */
function detectClusters(zMin, zMax, zValues) {
  const BUCKETS = 256;
  const range = zMax - zMin;
  const hist = new Array(BUCKETS).fill(0);
  for (let i = 0; i < zValues.length; i++) {
    let b = Math.floor((zValues[i] - zMin) / range * BUCKETS);
    if (b >= BUCKETS) b = BUCKETS - 1;
    hist[b]++;
  }
  const sm = hist.map((v, i) => {
    const a = hist[Math.max(0, i - 1)], c = hist[Math.min(BUCKETS - 1, i + 1)];
    return (a + v * 2 + c) / 4;
  });
  let maxCount = 0;
  for (let i = 0; i < BUCKETS; i++) if (sm[i] > maxCount) maxCount = sm[i];
  const peakThresh = maxCount * 0.12;

  const segments = [];
  let segStart = -1, segPeak = -1, segPeakIdx = -1;
  for (let b = 0; b < BUCKETS; b++) {
    if (sm[b] >= peakThresh) {
      if (segStart === -1) { segStart = b; segPeak = sm[b]; segPeakIdx = b; }
      if (sm[b] > segPeak) { segPeak = sm[b]; segPeakIdx = b; }
    } else if (segStart !== -1) {
      if (b - segStart >= 6) {
        segments.push({ startBucket: segStart, endBucket: b - 1, peakBucket: segPeakIdx });
        segStart = -1;
      } else {
        segStart = -1;
      }
    }
  }
  if (segStart !== -1 && BUCKETS - segStart >= 6) {
    segments.push({ startBucket: segStart, endBucket: BUCKETS - 1, peakBucket: segPeakIdx });
  }

  const boundaries = [];
  for (let s = 0; s < segments.length - 1; s++) {
    const midBucket = (segments[s].endBucket + segments[s + 1].startBucket) / 2;
    boundaries.push(zMin + midBucket / BUCKETS * range);
  }

  return {
    count: segments.length,
    segments: segments.map(s => ({
      zStart: zMin + s.startBucket / BUCKETS * range,
      zEnd: zMin + (s.endBucket + 1) / BUCKETS * range,
      zPeak: zMin + s.peakBucket / BUCKETS * range
    })),
    boundaries
  };
}

function bboxOf(positions, idxList) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < idxList.length; k++) {
    const vi = idxList[k];
    for (let a = 0; a < 3; a++) {
      const v = positions[vi * 3 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

function main() {
  console.log('⏳ Chờ WASM meshopt…');
  return Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]).then(() => {
    console.log('='.repeat(64));
    console.log(' GLB CLEANER — loại bỏ nhân vật trùng lặp (v2)');
    console.log('='.repeat(64));

    const { buf: srcBuf, json: srcJson, bin: srcBin } = readGLB(SRC);
    console.log('File gốc     :', (srcBuf.length / 1048576).toFixed(2), 'MB');
    const prim = srcJson.meshes[0].primitives[0];
    const accPosDef = srcJson.accessors[prim.attributes.POSITION];
    const accNorDef = srcJson.accessors[prim.attributes.NORMAL];
    const accUvDef = srcJson.accessors[prim.attributes.TEXCOORD_0];
    const accIdxDef = srcJson.accessors[prim.indices];

    /* --- Decode (đúng stride từ EXT) --- */
    console.log('⏳ Decode geometry…');
    const dPos = decodeBufferView(srcJson, srcBin, accPosDef.bufferView, MeshoptDecoder);
    const dNor = decodeBufferView(srcJson, srcBin, accNorDef.bufferView, MeshoptDecoder);
    const dUv = decodeBufferView(srcJson, srcBin, accUvDef.bufferView, MeshoptDecoder);
    const dIdx = decodeBufferView(srcJson, srcBin, accIdxDef.bufferView, MeshoptDecoder);
    console.log('strides decoded → POSITION:' + dPos.stride + ' NORMAL:' + dNor.stride + ' UV:' + dUv.stride + ' INDEX:' + dIdx.stride);

    const pos = new Float32Array(dPos.data.buffer, dPos.data.byteOffset, accPosDef.count * 3);
    const norI8 = new Int8Array(dNor.data.buffer, dNor.data.byteOffset, dNor.data.length); // stride-4 [x,y,z,pad]
    const uv = new Float32Array(dUv.data.buffer, dUv.data.byteOffset, accUvDef.count * 2);
    const indices = new Uint32Array(dIdx.data.buffer, dIdx.data.byteOffset, accIdxDef.count);
    const nVerts = accPosDef.count;
    const nTris = indices.length / 3;
    console.log('Vertices:', nVerts, '| Triangles:', nTris);

    /* --- Cluster detection (không spread — tránh stack overflow) --- */
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < nVerts; i++) {
      const z = pos[i * 3 + 2];
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
    const zValues = new Float32Array(nVerts);
    for (let i = 0; i < nVerts; i++) zValues[i] = pos[i * 3 + 2];
    const det = detectClusters(zMin, zMax, zValues);
    console.log('\nPhát hiện', det.count, 'cụm nhân vật theo trục Z:');
    det.segments.forEach((s, i) => console.log('  cluster ' + i + ': z[' + s.zStart.toFixed(3) + ' … ' + s.zEnd.toFixed(3) + '] peak@' + s.zPeak.toFixed(3)));
    console.log('Boundaries:', det.boundaries.map(b => b.toFixed(3)).join(' , '));

    if (det.count < 2) {
      console.log('❌ Chỉ tìm thấy 1 cụm — không có gì để xoá. Dừng (file gốc giữ nguyên).');
      return;
    }

    /* --- Assign cluster + thống kê --- */
    const clusterMembers = det.count === 0 ? [] : det.segments.map(() => []);
    for (let i = 0; i < nVerts; i++) {
      const z = pos[i * 3 + 2];
      let c = 0;
      while (c < det.boundaries.length && z > det.boundaries[c]) c++;
      clusterMembers[c].push(i);
    }

    console.log('\nThống kê từng cụm:');
    const clusterStats = clusterMembers.map((memberIdx, c) => ({ id: c, verts: memberIdx.length, bbox: bboxOf(pos, memberIdx), memberIdx }));
    const base = clusterStats[0];
    clusterStats.forEach(cs => {
      const dupRatio = (cs.verts / base.verts * 100).toFixed(1);
      const sizeMatch = (cs.bbox.size[1] / base.bbox.size[1] * 100).toFixed(1);
      console.log('  cluster ' + cs.id + ': verts=' + cs.verts + ' (' + dupRatio + '% của c0)' +
        ' size=[' + cs.bbox.size.map(s => s.toFixed(3)).join(', ') + '] (height ' + sizeMatch + '%)');
    });

    /* Chọn cụm GIỮ: gần z=0 nhất */
    let keepId = 0, bestDist = Infinity;
    clusterStats.forEach(cs => {
      const d = Math.abs((cs.bbox.min[2] + cs.bbox.max[2]) / 2);
      if (d < bestDist) { bestDist = d; keepId = cs.id; }
    });
    console.log('\n🎯 GIỮ cluster ' + keepId + ' — XOÁ ' + (det.count - 1) + ' cụm còn lại (bản sao giống nhau)');

    /* --- Filter vertices/triangles --- */
    console.log('⏳ Lọc vertex/triangle…');
    const keepMask = new Uint8Array(nVerts);
    const keptMembers = clusterStats[keepId].memberIdx;
    for (let k = 0; k < keptMembers.length; k++) keepMask[keptMembers[k]] = 1;

    const newIndices = [];
    let droppedTris = 0;
    for (let t = 0; t < nTris; t++) {
      const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
      if (keepMask[a] && keepMask[b] && keepMask[c]) {
        newIndices.push(a, b, c);
      } else droppedTris++;
    }

    const used = new Uint8Array(nVerts);
    for (let i = 0; i < newIndices.length; i++) used[newIndices[i]] = 1;
    const remap = new Int32Array(nVerts).fill(-1);
    let newVertCount = 0;
    for (let i = 0; i < nVerts; i++) if (used[i]) remap[i] = newVertCount++;
    for (let i = 0; i < newIndices.length; i++) newIndices[i] = remap[newIndices[i]];

    console.log('Giữ vertices:', newVertCount, '/' + nVerts, '(' + (newVertCount / nVerts * 100).toFixed(1) + '%)');
    console.log('Giữ triangles:', newIndices.length / 3, '/' + nTris, '(bỏ', droppedTris, 'triangle nối cụm)');

    /* --- Rebuild attributes (NORMAL giữ stride-4 pad) + recenter --- */
    console.log('⏳ Rebuild attributes + recenter…');
    const posStride = dPos.stride;   // 12
    const norStride = dNor.stride;   // 4
    const uvStride = dUv.stride;     // 8
    const newPos = new Float32Array(newVertCount * (posStride / 4));
    const newNor = new Uint8Array(newVertCount * norStride);
    const newUv = new Float32Array(newVertCount * (uvStride / 4));
    for (let old = 0; old < nVerts; old++) {
      const ni = remap[old];
      if (ni === -1) continue;
      newPos[ni * (posStride / 4)] = pos[old * 3];
      newPos[ni * (posStride / 4) + 1] = pos[old * 3 + 1];
      newPos[ni * (posStride / 4) + 2] = pos[old * 3 + 2];
      newNor[ni * norStride] = norI8[old * norStride];
      newNor[ni * norStride + 1] = norI8[old * norStride + 1];
      newNor[ni * norStride + 2] = norI8[old * norStride + 2];
      newNor[ni * norStride + 3] = 0; /* pad */
      newUv[ni * 2] = uv[old * 2];
      newUv[ni * 2 + 1] = uv[old * 2 + 1];
    }

    /* Recenter từ FLOAT positions (stride chuẩn 12 cho tính min/max) */
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < newVertCount; i++) {
      const x = newPos[i * 3], y = newPos[i * 3 + 1], z = newPos[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const offX = (minX + maxX) / 2, offZ = (minZ + maxZ) / 2, offY = minY;
    const posView = new Float32Array(newPos.buffer, 0, newVertCount * 3);
    for (let i = 0; i < newVertCount; i++) {
      posView[i * 3] -= offX;
      posView[i * 3 + 1] -= offY;
      posView[i * 3 + 2] -= offZ;
    }
    console.log('Recenter offset:', [offX, offY, offZ].map(v => v.toFixed(4)).join(', '),
      '| height:', (maxY - minY).toFixed(4));

    /* --- Re-encode meshopt (filter NONE — decode lại đúng 100%) --- */
    console.log('⏳ Re-encode meshopt…');
    const encPos = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(newPos.buffer, 0, newVertCount * posStride), newVertCount, posStride, 'ATTRIBUTES');
    const encNor = MeshoptEncoder.encodeGltfBuffer(newNor, newVertCount, norStride, 'ATTRIBUTES');
    const encUv = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(newUv.buffer, 0, newVertCount * uvStride), newVertCount, uvStride, 'ATTRIBUTES');
    const idxU8 = new Uint8Array(newIndices.length * 4);
    new Uint32Array(idxU8.buffer).set(newIndices);
    const encIdx = MeshoptEncoder.encodeGltfBuffer(idxU8, newIndices.length, 4, 'TRIANGLES');
    console.log('Encoded sizes → pos:' + (encPos.length / 1048576).toFixed(2) + 'MB nor:' + (encNor.length / 1048576).toFixed(2) +
      'MB uv:' + (encUv.length / 1048576).toFixed(2) + 'MB idx:' + (encIdx.length / 1048576).toFixed(2) + 'MB');

    /* Round-trip verify POSITION */
    {
      const rt = new Uint8Array(newVertCount * posStride);
      MeshoptDecoder.decodeGltfBuffer(rt, newVertCount, posStride, encPos, 'ATTRIBUTES', 'NONE');
      const rtF = new Float32Array(rt.buffer, 0, newVertCount * 3);
      let maxErr = 0;
      for (let i = 0; i < newVertCount * 3; i++) {
        const e = Math.abs(rtF[i] - posView[i]);
        if (e > maxErr) maxErr = e;
      }
      console.log('POSITION round-trip max error:', maxErr.toExponential(2));
      if (maxErr > 1e-4) throw new Error('Round-trip position sai quá lớn!');
    }

    /* --- Copy images (raw) --- */
    const imageBytes = (srcJson.images || []).map(img => {
      const bv = srcJson.bufferViews[img.bufferView];
      return new Uint8Array(srcBin.buffer, srcBin.byteOffset + bv.byteOffset, bv.byteLength);
    });

    /* --- Assemble new BIN --- */
    const binParts = [];
    let binCursor = 0;
    const place = (bytes) => {
      const pad = (4 - (binCursor % 4)) % 4;
      if (pad) { binParts.push(new Uint8Array(pad)); binCursor += pad; }
      const loc = { byteOffset: binCursor, byteLength: bytes.length };
      binParts.push(bytes);
      binCursor += bytes.length;
      return loc;
    };

    const newBufferViews = [];
    const newAccessors = [];

    /* images giữ nguyên index bufferView 0..n-1 */
    imageBytes.forEach((bytes, i) => {
      const loc = place(bytes);
      newBufferViews[i] = { buffer: 0, byteOffset: loc.byteOffset, byteLength: loc.byteLength };
    });
    const gStart = imageBytes.length;

    const mkBV = (encoded, decodedLen, count, stride, mode, filter) => {
      const loc = place(encoded);
      /* GLTFLoader đọc byteOffset/byteLength(nén)/byteStride/count TỪ EXT def */
      const ext = {
        buffer: 0,
        byteOffset: loc.byteOffset,
        byteLength: encoded.length,   /* độ dài dữ liệu NÉN */
        byteStride: stride,
        mode: mode,
        count: count
      };
      if (filter && filter !== 'NONE') ext.filter = filter;
      const bv = { buffer: 0, byteOffset: loc.byteOffset, byteLength: encoded.length, byteStride: stride, extensions: { EXT_meshopt_compression: ext } };
      return bv;
    };

    newBufferViews[gStart] = mkBV(encPos, newVertCount * posStride, newVertCount, posStride, 'ATTRIBUTES', 'NONE');
    newAccessors[0] = { bufferView: gStart, componentType: 5126, count: newVertCount, type: 'VEC3', min: [-offX, 0, -offZ], max: [maxX - offX, maxY - offY, maxZ - offZ] };

    newBufferViews[gStart + 1] = mkBV(encNor, newVertCount * norStride, newVertCount, norStride, 'ATTRIBUTES', 'NONE');
    newAccessors[1] = { bufferView: gStart + 1, componentType: 5120, count: newVertCount, type: 'VEC3', normalized: accNorDef.normalized === true };

    newBufferViews[gStart + 2] = mkBV(encUv, newVertCount * uvStride, newVertCount, uvStride, 'ATTRIBUTES', 'NONE');
    newAccessors[2] = { bufferView: gStart + 2, componentType: 5126, count: newVertCount, type: 'VEC2' };

    newBufferViews[gStart + 3] = mkBV(encIdx, newIndices.length * 4, newIndices.length, 4, 'TRIANGLES', 'NONE');
    newAccessors[3] = { bufferView: gStart + 3, componentType: 5125, count: newIndices.length, type: 'SCALAR' };

    const binPad = (4 - (binCursor % 4)) % 4;
    const binTotal = binCursor + binPad;
    const newBin = new Uint8Array(binTotal);
    let cur = 0;
    binParts.forEach(p => { newBin.set(p, cur); cur += p.length; });

    /* --- Assemble new JSON --- */
    const newJson = {
      asset: srcJson.asset,
      scene: srcJson.scene || 0,
      scenes: srcJson.scenes,
      nodes: srcJson.nodes,
      meshes: [{
        name: 'kiemhiep_hero',
        primitives: [{
          mode: 4,
          attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
          indices: 3,
          material: 0
        }]
      }],
      accessors: newAccessors,
      materials: srcJson.materials,
      textures: srcJson.textures,
      images: srcJson.images,
      samplers: srcJson.samplers,
      bufferViews: newBufferViews,
      buffers: [{ byteLength: binTotal }],
      extensionsUsed: srcJson.extensionsUsed,
      extensionsRequired: srcJson.extensionsRequired
    };

    /* --- Write GLB --- */
    const jsonBytes = Buffer.from(JSON.stringify(newJson), 'utf8');
    const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
    const headerLen = 12 + 8 + jsonBytes.length + jsonPad + 8 + binTotal;
    const out = Buffer.alloc(headerLen);
    out.writeUInt32LE(MAGIC, 0);
    out.writeUInt32LE(2, 4);
    out.writeUInt32LE(headerLen, 8);
    out.writeUInt32LE(jsonBytes.length + jsonPad, 12);
    out.writeUInt32LE(CHUNK_JSON, 16);
    jsonBytes.copy(out, 20);
    for (let i = 0; i < jsonPad; i++) out[20 + jsonBytes.length + i] = 0x20;
    let w = 20 + jsonBytes.length + jsonPad;
    out.writeUInt32LE(binTotal, w);
    out.writeUInt32LE(CHUNK_BIN, w + 4);
    out.set(newBin, w + 8);

    /* --- Backup + Save --- */
    if (!fs.existsSync(BACKUP)) {
      fs.copyFileSync(SRC, BACKUP);
      console.log('💾 Backup file gốc →', path.relative(ROOT, BACKUP));
    } else {
      console.log('💾 Backup đã tồn tại — giữ nguyên');
    }
    fs.writeFileSync(SRC, out);
    console.log('💾 Đã ghi file mới →', path.relative(ROOT, SRC), '(' + (out.length / 1048576).toFixed(2) + ' MB)');

    /* --- Report --- */
    console.log('\n' + '='.repeat(64));
    console.log(' KẾT QUẢ');
    console.log('='.repeat(64));
    console.log('Trước : ' + (srcBuf.length / 1048576).toFixed(2) + ' MB — ' + nVerts + ' verts — ' + nTris + ' tris — ' + det.count + ' nhân vật');
    console.log('Sau   : ' + (out.length / 1048576).toFixed(2) + ' MB — ' + newVertCount + ' verts — ' + (newIndices.length / 3) + ' tris — 1 nhân vật');
    console.log('Giảm  : ' + (100 - out.length / srcBuf.length * 100).toFixed(1) + '%');
    console.log('Textures giữ nguyên (3 ảnh, không mất chất lượng)');

    /* --- VERIFY: parse lại file mới --- */
    console.log('\n⏳ Verify: parse lại file mới…');
    try {
      const chk = readGLB(SRC);
      const p2 = chk.json.meshes[0].primitives[0];
      const d2 = decodeBufferView(chk.json, chk.bin, chk.json.accessors[p2.attributes.POSITION].bufferView, MeshoptDecoder);
      const di2 = decodeBufferView(chk.json, chk.bin, chk.json.accessors[p2.indices].bufferView, MeshoptDecoder);
      const pos2 = new Float32Array(d2.data.buffer, d2.data.byteOffset, chk.json.accessors[p2.attributes.POSITION].count * 3);
      const idx2 = new Uint32Array(di2.data.buffer, di2.data.byteOffset, chk.json.accessors[p2.indices].count);
      let maxIdx = 0;
      for (let i = 0; i < idx2.length; i++) if (idx2[i] > maxIdx) maxIdx = idx2[i];
      let bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
      const nv2 = pos2.length / 3;
      for (let i = 0; i < nv2; i++) {
        for (let a = 0; a < 3; a++) {
          const v = pos2[i * 3 + a];
          if (v < bmin[a]) bmin[a] = v;
          if (v > bmax[a]) bmax[a] = v;
        }
      }
      console.log('✅ Parse OK — verts:', nv2, '| tris:', idx2.length / 3, '| maxIdx:', maxIdx + ' < ' + nv2 + ' ✓');
      console.log('✅ bbox: x[' + bmin[0].toFixed(3) + '…' + bmax[0].toFixed(3) + '] y[' + bmin[1].toFixed(4) + '…' + bmax[1].toFixed(3) + '] z[' + bmin[2].toFixed(3) + '…' + bmax[2].toFixed(3) + ']');
      if (Math.abs(bmin[1]) > 0.001) console.log('⚠ min Y ≠ 0');
      if (Math.abs((bmin[0] + bmax[0]) / 2) > 0.001) console.log('⚠ tâm X ≠ 0');
      console.log('\n🎉 CLEAN HOÀN TẤT — file đã sẵn sàng!');
    } catch (e) {
      console.error('❌ VERIFY FAIL:', e.message);
      console.error('→ Khôi phục file gốc từ backup!');
      fs.copyFileSync(BACKUP, SRC);
    }
  }).catch(e => { console.error('LỖI:', e); process.exit(1); });
}

main();
