/* server.js — Static server + API meshopt-encode cho PixiJS Studio
 * Chạy: node server.js [port]  (mặc định 8080, tự +1 nếu bận)
 *
 * API:
 *   GET  /api/meshopt-ping          → { ok, encoder: true }  (probe khả dụng)
 *   POST /api/meshopt-encode        → nén geometry buffer qua MeshoptEncoder
 *       body: { jobs: [{ data: base64, count, stride, mode }] }
 *       trả về: { ok, results: [{ data: base64 (nén) }] }
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

let MeshoptEncoder = null, MeshoptSimplifier = null;
try {
  const mo = require('meshoptimizer');
  MeshoptEncoder = mo.MeshoptEncoder;
  MeshoptSimplifier = mo.MeshoptSimplifier;
} catch (e) {
  console.log('(meshoptimizer chưa cài — /api/meshopt-encode + simplify tắt. npm install meshoptimizer để bật)');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 200 * 1048576) { reject(new Error('Body quá lớn')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* Lưu file export (GLB/GLTF/ZIP) vào thư mục exports/ của project —
   dùng cho tính năng "Export GLB + Animation" (AnimGLBExport) */
async function handleSaveExport(req, res) {
  const rawName = req.headers['x-filename'] ? decodeURIComponent(String(req.headers['x-filename'])) : 'export.glb';
  const safe = rawName.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'export.glb';
  const body = await readBody(req);
  if (!body.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'body rỗng' })); return; }
  const dir = path.join(__dirname, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, safe);
  fs.writeFileSync(full, body);
  const rel = path.relative(__dirname, full).split(path.sep).join('/');
  console.log(' [export] ' + rel + ' — ' + body.length + ' bytes');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, path: rel, bytes: body.length }));
}

async function handleMeshoptEncode(req, res) {
  if (!MeshoptEncoder) { res.writeHead(501); res.end(JSON.stringify({ ok: false, error: 'meshoptimizer chưa cài trên server' })); return; }
  try {
    const body = JSON.parse((await readBody(req)).toString('utf8'));
    const jobs = body.jobs || [];
    const results = jobs.map((job) => {
      const src = Buffer.from(job.data, 'base64');
      let compressed;
      if (job.mode === 'TRIANGLES' || job.mode === 'INDEX') {
        compressed = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(src), job.count, job.stride, 'TRIANGLES');
      } else {
        compressed = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(src), job.count, job.stride, job.mode || 'ATTRIBUTES');
      }
      return { data: Buffer.from(compressed).toString('base64') };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, results: results }));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
  }
}

/* ============================================================
 * /api/meshopt-simplify — GIẢM TRIANGLES THẬT (lossy theo tỉ lệ
 * nhưng giữ shape + UV mapping → chất lượng ảnh không vỡ)
 * body: {
 *   indices: b64 (u32 LE), vertexCount,
 *   positions: b64 (f32 ×3/vert),
 *   uvs: b64 (f32 ×2/vert) | null,
 *   normals: b64 (f32 ×3/vert) | null,
 *   targetRatio: 0.25..1.0, errorPct: 0.001..0.1
 * }
 * trả: { ok, indices: b64 (u32), indexCount, droppedTris, err }
 * ============================================================ */
async function handleMeshoptSimplify(req, res) {
  if (!MeshoptSimplifier) { res.writeHead(501); res.end(JSON.stringify({ ok: false, error: 'meshoptimizer chưa cài trên server' })); return; }
  try {
    const body = JSON.parse((await readBody(req)).toString('utf8'));
    const indices = new Uint32Array(Buffer.from(body.indices, 'base64').buffer,
      Buffer.from(body.indices, 'base64').byteOffset,
      Math.floor(Buffer.from(body.indices, 'base64').length / 4));
    const positions = new Float32Array(Buffer.from(body.positions, 'base64').buffer,
      Buffer.from(body.positions, 'base64').byteOffset,
      Math.floor(Buffer.from(body.positions, 'base64').length / 4));
    const targetRatio = clamp01(body.targetRatio || 0.5);
    const targetError = clamp01(body.errorPct !== undefined ? body.errorPct : 0.01);

    const srcTris = indices.length / 3;
    const targetIdx = Math.max(3, Math.floor(srcTris * 3 * targetRatio / 3) * 3);

    let resultIndices, resultErr;
    if (body.uvs) {
      const uvs = new Float32Array(Buffer.from(body.uvs, 'base64').buffer,
        Buffer.from(body.uvs, 'base64').byteOffset,
        Math.floor(Buffer.from(body.uvs, 'base64').length / 4));
      /* attributes: uv (2/vert) — weight 1 để giữ uv seams */
      const attrs = uvs;
      const r = MeshoptSimplifier.simplifyWithAttributes(
        indices, positions, 3, attrs, 2, [1], null,
        targetIdx, targetError, ['LockBorder']
      );
      resultIndices = r[0]; resultErr = r[1];
    } else {
      const r = MeshoptSimplifier.simplify(indices, positions, 3, targetIdx, targetError, ['LockBorder']);
      resultIndices = r[0]; resultErr = r[1];
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      indices: Buffer.from(new Uint32Array(resultIndices).buffer).toString('base64'),
      indexCount: resultIndices.length,
      srcTris: srcTris, dstTris: resultIndices.length / 3,
      err: resultErr
    }));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
  }
}

function clamp01(v) { return Math.max(0.01, Math.min(1, v)); }

/* ============================================================
 * /api/rig-analyze — BACKEND RIG TOOL
 * Phân tích vertex distribution THẬT của model (f32 positions b64)
 * để đặt skeleton anchors chuẩn theo từng phần thân:
 *   • Quét profile theo Y (chiều cao) → tìm hông/vai/đầu qua histogram
 *   • Tâm X/Z mỗi band → vị trí cột sống
 *   • Cánh tay/tần suất phân bố X hai bên tại band vai
 * Trả JSON skeleton: { hips, spine, chest, neck, head, headTop,
 *   shoulder/arm/forearm/hand (L/R), upLeg/leg/foot/toe (L/R) } + stats
 * Client RigAutoGen dùng anchors này thay tỷ lệ bbox — rig chuẩn như Tripo.
 * ============================================================ */
async function handleRigAnalyze(req, res) {
  try {
    const body = JSON.parse((await readBody(req)).toString('utf8'));
    const positions = new Float32Array(Buffer.from(body.positions, 'base64').buffer,
      Buffer.from(body.positions, 'base64').byteOffset,
      Math.floor(Buffer.from(body.positions, 'base64').length / 4));
    const indices = body.indices ? new Uint32Array(Buffer.from(body.indices, 'base64').buffer,
      Buffer.from(body.indices, 'base64').byteOffset,
      Math.floor(Buffer.from(body.indices, 'base64').length / 4)) : null;

    const vCount = positions.length / 3;
    if (!vCount) throw new Error('positions rỗng');

    /* bbox */
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < vCount; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const H = maxY - minY, W = maxX - minX, D = maxZ - minZ;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

    /* Profile theo Y — 64 bands, tính: count + meanX + meanZ + meanAbsX mỗi band */
    const BANDS = 64;
    const bandCount = new Array(BANDS).fill(0);
    const bandSumX = new Array(BANDS).fill(0);
    const bandSumZ = new Array(BANDS).fill(0);
    const bandSumAX = new Array(BANDS).fill(0);
    for (let i = 0; i < vCount; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      let b = Math.floor((y - minY) / H * BANDS);
      if (b >= BANDS) b = BANDS - 1;
      bandCount[b]++;
      bandSumX[b] += x; bandSumZ[b] += z; bandSumAX[b] += Math.abs(x - cx);
    }
    const bandMeanAX = bandCount.map((c, i) => c ? bandSumAX[i] / c : 0);

    /* Phát hiện band TAY: band có meanAbsX cao bất thường (giơ tay) — tìm 2 đỉnh
       Còn lại chuẩn humanoid đứng: vai tại ~0.80H, hông ~0.52H (tỷ lệ chibi/chuẩn hoá) */
    const rel = function (h) { return minY + h * H; };   // h = tỷ lệ 0..1

    /* Đỉnh meanAbsX cao nhất trong khoảng torso (0.45H..0.95H) → tay giơ/nhấc */
    let armBandY = 0.72, armMaxAX = 0;
    for (let b = Math.floor(BANDS * 0.45); b < Math.floor(BANDS * 0.95); b++) {
      if (bandMeanAX[b] > armMaxAX) { armMaxAX = bandMeanAX[b]; armBandY = b / BANDS; }
    }
    /* Xu hướng tay: nếu bandMaxAX > 0.35W → tay giơ ngang (A-pose/T-pose) */
    const armsRaised = armMaxAX > W * 0.32;
    const armY = armsRaised ? armBandY : 0.72;

    const hipY = 0.52, kneeY = 0.28, ankleY = 0.05, shoulderY = Math.max(0.70, armY + 0.02);
    const legSpread = W * 0.10, armSpread = armsRaised ? W * 0.28 : W * 0.12;

    const skeleton = {
      rigging: 'backend-analyzed',
      stats: { verts: vCount, height: +H.toFixed(4), width: +W.toFixed(4), depth: +D.toFixed(4),
               armsRaised: armsRaised, armY: +armY.toFixed(3) },
      bones: {
        Root:      [cx, minY, cz],
        Hips:      [cx, rel(hipY), cz],
        Spine:     [cx, rel(hipY + 0.08), cz],
        Chest:     [cx, rel(hipY + 0.17), cz],
        Neck:      [cx, rel(shoulderY + 0.05), cz],
        Head:      [cx, rel(shoulderY + 0.10), cz],
        HeadTop_End: [cx, rel(0.98), cz],
        LeftShoulder:  [cx - W * 0.10, rel(shoulderY), cz],
        LeftArm:       [cx - armSpread, rel(armY), cz],
        LeftForeArm:   [cx - armSpread - W * 0.13, rel(armY - (armsRaised ? 0.03 : 0.01)), cz],
        LeftHand:      [cx - armSpread - W * 0.22, rel(armY - (armsRaised ? 0.05 : 0.03)), cz],
        RightShoulder: [cx + W * 0.10, rel(shoulderY), cz],
        RightArm:      [cx + armSpread, rel(armY), cz],
        RightForeArm:  [cx + armSpread + W * 0.13, rel(armY - (armsRaised ? 0.03 : 0.01)), cz],
        RightHand:     [cx + armSpread + W * 0.22, rel(armY - (armsRaised ? 0.05 : 0.03)), cz],
        LeftUpLeg:  [cx - legSpread, rel(hipY - 0.06), cz],
        LeftLeg:    [cx - legSpread, rel(kneeY), cz],
        LeftFoot:   [cx - legSpread, rel(ankleY), cz + D * 0.06],
        LeftToeBase:[cx - legSpread, rel(0.015), cz + D * 0.16],
        RightUpLeg: [cx + legSpread, rel(hipY - 0.06), cz],
        RightLeg:   [cx + legSpread, rel(kneeY), cz],
        RightFoot:  [cx + legSpread, rel(ankleY), cz + D * 0.06],
        RightToeBase:[cx + legSpread, rel(0.015), cz + D * 0.16]
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, skeleton: skeleton }));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
  }
}

function start(port) {
  const srv = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);

    /* ---------- API endpoints ---------- */
    if (urlPath === '/api/meshopt-ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, encoder: !!MeshoptEncoder, simplifier: !!MeshoptSimplifier }));
      return;
    }
    if (urlPath === '/api/models') {
      /* liệt kê GLB trong assets/models — client auto-chọn model mẫu */
      const dir = path.join(__dirname, 'assets', 'models');
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.glb')).map(f => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, url: 'assets/models/' + encodeURIComponent(f), size: st.size, mtime: st.mtimeMs };
      }); } catch (e) { }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, files: files }));
      return;
    }
    if (urlPath === '/api/fbx-list') {
      /* liệt kê FBX (đệ quy 1 cấp thư mục con) — client Meshy FBX Rig Import */
      const dir = path.join(__dirname, 'assets', 'models');
      const files = [];
      try {
        fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
          const sub = path.join(dir, e.name);
          if (e.isDirectory()) {
            fs.readdirSync(sub).forEach(f2 => {
              if (f2.toLowerCase().endsWith('.fbx')) {
                const st = fs.statSync(path.join(sub, f2));
                files.push({ name: f2, url: 'assets/models/' + encodeURIComponent(e.name) + '/' + encodeURIComponent(f2), size: st.size });
              }
            });
          } else if (e.name.toLowerCase().endsWith('.fbx')) {
            const st = fs.statSync(path.join(dir, e.name));
            files.push({ name: e.name, url: 'assets/models/' + encodeURIComponent(e.name), size: st.size });
          }
        });
      } catch (err) { }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, files: files }));
      return;
    }
    if (urlPath === '/api/meshopt-encode' && req.method === 'POST') {
      handleMeshoptEncode(req, res).catch((e) => {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      });
      return;
    }
    if (urlPath === '/api/meshopt-simplify' && req.method === 'POST') {
      handleMeshoptSimplify(req, res).catch((e) => {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      });
      return;
    }
    if (urlPath === '/api/rig-analyze' && req.method === 'POST') {
      handleRigAnalyze(req, res).catch((e) => {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      });
      return;
    }
    if (urlPath === '/api/save-export' && req.method === 'POST') {
      handleSaveExport(req, res).catch((e) => {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      });
      return;
    }
    if (urlPath.startsWith('/api/')) {
      res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'unknown api' }));
      return;
    }

    /* ---------- Static files ---------- */
    let p = urlPath;
    if (p === '/') p = '/index.html';
    const file = path.join(__dirname, p);
    if (!file.startsWith(__dirname)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found: ' + p); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });

  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log('Port ' + port + ' bận — thử port ' + (port + 1) + '…');
      start(port + 1);
    } else throw err;
  });

  srv.listen(port, () => {
    console.log('==============================================');
    console.log(' PixiJS Studio × Tripo3D AI Studio v21.0');
    console.log(' Server chạy tại: http://localhost:' + port);
    console.log(' Meshopt API  : ' + (MeshoptEncoder ? 'BẬT (nén geometry server-side)' : 'tắt (npm install meshoptimizer)'));
    console.log(' Nhấn Ctrl+C để dừng');
    console.log('==============================================');
    if (MeshoptEncoder) MeshoptEncoder.ready.then(() => console.log(' MeshoptEncoder WASM ready ✓'));
  });
}

start(parseInt(process.argv[2], 10) || 8080);
