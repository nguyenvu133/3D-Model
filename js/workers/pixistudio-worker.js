/* ============================================================
 * workers/pixistudio-worker.js — Web Worker cho tác vụ nặng
 * (NHÓM 3, 2026-11-27)
 *
 * Classic worker (không phải module): chạy qua
 *   new Worker('js/workers/pixistudio-worker.js')
 * từ trang GitHub Pages. KHÔNG có DOM / document / THREE trong
 * worker — chỉ có typed array + WASM + OffscreenCanvas +
 * createImageBitmap. Vì vậy chỉ những task "dữ liệu thuần" mới
 * chuyển được (xem bảng dưới).
 *
 * Giao thức message:
 *   main -> worker : { id, task, payload }
 *   worker -> main : { id, type: 'result', result, transfer? }
 *                   | { id, type: 'progress', done, total, message }
 *                   | { id, type: 'error', error: { message, code } }
 * `id` để bridge ghép Promise. `transfer` (danh sách ArrayBuffer)
 * được postMessage kèm theo để tránh copy.
 *
 * Task hỗ trợ:
 *   echo               — kiểm tra worker sống + đo round-trip.
 *   meshopt-decimate   — edge-collapse (WASM meshopt) trên
 *     { positions: Float32Array, index: Uint32Array, targetTris,
 *       targetError } -> { index: Uint32Array, trisAfter, err }.
 *     KHÔNG cần THREE: chỉ đổi index, UV/attribute giữ nguyên
 *     theo đỉnh (bridge dựng lại BufferGeometry ở main thread).
 *   texture-downscale  — { imageBitmap } (transferable) hoặc
 *     { imageBytes, mime } -> { bytes: ArrayBuffer, w, h,
 *       mime: 'image/jpeg' }. Dùng createImageBitmap +
 *     OffscreenCanvas + convertToBlob (Chrome/Android OK).
 *     Cần OffscreenCanvas + createImageBitmap, nếu không có thì
 *     trả lỗi UNSUPPORTED để bridge fallback về canvas main thread.
 *   sleep              — chẩn đoán/harness: chờ payload.ms rồi
 *     trả { slept: ms }. Dùng để test timeout + cancel.
 *
 * Task KHÔNG chuyển được (trả lỗi code 'UNSUPPORTED', bridge sẽ
 * fallback về main thread — KHÔNG giả vờ chạy được):
 *   fbx-parse   — FBXLoader r128 dùng document.createElement('img')
 *     qua THREE.ImageLoader/TextureLoader để nạp texture nhúng, và
 *     dùng THREE.* (Object3D/SkinnedMesh/AnimationClip) — không có
 *     DOM và không có THREE trong worker. Parse FBX vẫn chạy ở
 *     main thread (js/animation/fbx-rig-import.js).
 *   fbx-write   — PixiStudio.FBXBinary.write nhận THREE.Object3D
 *     (scene graph + skin + animation). Serialize toàn bộ scene
 *     sang worker tốn ngang thời gian ghi file, lại mất skin/bone
 *     binding nếu serialize sai — giữ ở main thread.
 *   thumbnail   — render thumbnail cần WebGLRenderer + document
 *     (THREE r128 Renderer tạo canvas qua document). Worker có
 *     OffscreenCanvas + WebGL nhưng THREE r128 không chạy được
 *     trong worker (cần document). Giữ ở main thread.
 * ============================================================ */
'use strict';

var WORKER_VERSION = '1.0.0';

/* Nạp meshopt WASM (file vendor, UMD -> gán self.MeshoptSimplifier).
   Đường dẫn tương đối theo vị trí worker: js/workers/ -> js/vendor/.
   Trong harness Node, importScripts được stub và MeshoptSimplifier
   được inject sẵn nên khối này được bỏ qua an toàn. */
if (typeof importScripts === 'function') {
  try { importScripts('../vendor/meshopt_simplifier.js'); } catch (e) { /* meshopt task sẽ báo UNSUPPORTED */ }
}

function getMeshopt() {
  if (typeof self !== 'undefined' && self && self.MeshoptSimplifier) return self.MeshoptSimplifier;
  if (typeof MeshoptSimplifier !== 'undefined') return MeshoptSimplifier;
  return null;
}

function unsupported(task, reason) {
  var err = new Error('Task "' + task + '" không chạy được trong worker: ' + reason);
  err.code = 'UNSUPPORTED';
  err.task = task;
  return err;
}

function isArrayBuffer(x) {
  return !!x && (x instanceof ArrayBuffer ||
    Object.prototype.toString.call(x) === '[object ArrayBuffer]');
}

function badInput(msg) {
  var err = new Error(msg);
  err.code = 'BAD_INPUT';
  return err;
}

/* ---------------- task: echo ---------------- */
function taskEcho(payload) {
  return { echo: (payload && payload.value !== undefined) ? payload.value : null, workerVersion: WORKER_VERSION };
}

/* ---------------- task: sleep (chẩn đoán) ---------------- */
function taskSleep(payload) {
  var ms = (payload && typeof payload.ms === 'number') ? payload.ms : 0;
  return new Promise(function (resolve) {
    setTimeout(function () { resolve({ slept: ms }); }, ms);
  });
}

/* ---------------- task: meshopt-decimate ----------------
 * payload: { positions: Float32Array, index: Uint32Array|Uint16Array,
 *            targetTris, targetError }
 * Trả { index: Uint32Array, trisAfter, err, unchanged }.
 * index trả về được transfer (buffer của nó đi kèm postMessage). */
function taskMeshoptDecimate(payload) {
  var M = getMeshopt();
  if (!M || typeof M.simplify !== 'function') {
    throw unsupported('meshopt-decimate', 'MeshoptSimplifier WASM chưa nạp (importScripts js/vendor/meshopt_simplifier.js thất bại)');
  }
  if (!payload || !payload.positions || !payload.index) throw badInput('meshopt-decimate cần positions + index');
  var pos = payload.positions;
  var idx = payload.index;
  /* Duck-typing thay vì instanceof: structured clone trong worker
     thật đã cho đúng realm; instanceof cross-realm (vd harness
     Node vm) sẽ sai và copy thừa — mà meshopt WASM assert fail
     với typed array khác realm với nó. Chỉ copy khi thật sự sai
     kiểu (không phải view 4-byte / 2-4-byte). */
  if (!ArrayBuffer.isView(pos) || pos.BYTES_PER_ELEMENT !== 4) {
    if (pos && pos.length !== undefined) pos = new Float32Array(pos);
    else throw badInput('positions phải là Float32Array');
  }
  if (!ArrayBuffer.isView(idx) || (idx.BYTES_PER_ELEMENT !== 4 && idx.BYTES_PER_ELEMENT !== 2)) {
    if (idx && idx.length !== undefined) idx = new Uint32Array(idx);
    else throw badInput('index phải là Uint32Array/Uint16Array');
  }
  var targetTris = (typeof payload.targetTris === 'number' && payload.targetTris > 0)
    ? Math.floor(payload.targetTris) : 0;
  var targetError = (typeof payload.targetError === 'number' && payload.targetError > 0)
    ? payload.targetError : 0.01;
  var srcTris = Math.floor(idx.length / 3);
  if (!targetTris || srcTris <= targetTris) {
    return { index: (idx instanceof Uint32Array) ? idx : new Uint32Array(idx), trisAfter: srcTris, err: 0, unchanged: true };
  }
  var out;
  try {
    out = M.simplify(idx, pos, 3, targetTris * 3, targetError, ['LockBorder']);
  } catch (e) {
    var err = new Error('MeshoptSimplifier.simplify lỗi: ' + (e && e.message || e));
    err.code = 'MESHOPT_ERROR';
    throw err;
  }
  if (!out || !out[0] || !out[0].length) {
    var err2 = new Error('MeshoptSimplifier.simplify trả về rỗng');
    err2.code = 'MESHOPT_ERROR';
    throw err2;
  }
  var newIndex = (ArrayBuffer.isView(out[0]) && out[0].BYTES_PER_ELEMENT === 4) ? out[0] : new Uint32Array(out[0]);
  return { index: newIndex, trisAfter: Math.floor(newIndex.length / 3), err: out[1], unchanged: false };
}

/* ---------------- task: texture-downscale ----------------
 * payload: { imageBitmap } (ImageBitmap, transferable) hoặc
 *   { imageBytes: ArrayBuffer, mime }.
 *   + { maxDim, quality, flipY }.
 * Trả { bytes: ArrayBuffer, w, h, mime: 'image/jpeg' }.
 * bytes được transfer. */
function taskTextureDownscale(payload) {
  if (typeof createImageBitmap !== 'function' ||
      typeof OffscreenCanvas !== 'function') {
    throw unsupported('texture-downscale', 'trình duyệt không có createImageBitmap/OffscreenCanvas (cần Chrome 69+/Android Chrome)');
  }
  if (!payload) throw badInput('texture-downscale cần imageBitmap hoặc imageBytes');
  var maxDim = (typeof payload.maxDim === 'number' && payload.maxDim > 0) ? Math.floor(payload.maxDim) : 512;
  var quality = (typeof payload.quality === 'number') ? Math.max(0.1, Math.min(1, payload.quality)) : 0.85;
  var flipY = !!payload.flipY;
  var bitmapP;
  if (payload.imageBitmap) {
    bitmapP = Promise.resolve(payload.imageBitmap);
  } else if (payload.imageBytes) {
    var mime = payload.mime || 'image/jpeg';
    var blob = new Blob([payload.imageBytes], { type: mime });
    bitmapP = createImageBitmap(blob);
  } else {
    throw badInput('texture-downscale cần imageBitmap hoặc imageBytes');
  }
  return bitmapP.then(function (bmp) {
    var w0 = bmp.width, h0 = bmp.height;
    if (!w0 || !h0) throw badInput('ảnh nguồn không có kích thước');
    var scale = Math.min(1, maxDim / Math.max(w0, h0));
    var w = Math.max(1, Math.round(w0 * scale));
    var h = Math.max(1, Math.round(h0 * scale));
    var canvas = new OffscreenCanvas(w, h);
    var ctx = canvas.getContext('2d');
    if (!ctx) throw unsupported('texture-downscale', 'OffscreenCanvas không lấy được context 2d');
    if (flipY) { ctx.translate(0, h); ctx.scale(1, -1); }
    ctx.drawImage(bmp, 0, 0, w, h);
    if (typeof bmp.close === 'function') { try { bmp.close(); } catch (e) {} }
    return canvas.convertToBlob({ type: 'image/jpeg', quality: quality }).then(function (outBlob) {
      if (!outBlob) throw new Error('convertToBlob trả về null');
      return outBlob.arrayBuffer().then(function (ab) {
        return { bytes: ab, w: w, h: h, mime: 'image/jpeg' };
      });
    });
  });
}

/* ---------------- task không chuyển được ---------------- */
function taskFbxParse() {
  throw unsupported('fbx-parse', 'FBXLoader r128 cần document (ImageLoader tạo <img> cho texture nhúng) và THREE.* — không có DOM/THREE trong worker');
}
function taskFbxWrite() {
  throw unsupported('fbx-write', 'FBXBinary.write nhận THREE.Object3D (scene graph + skin + animation); serialize scene sang worker tốn ngang thời gian ghi file');
}
function taskThumbnail() {
  throw unsupported('thumbnail', 'THREE r128 WebGLRenderer cần document để tạo canvas — không chạy trong worker');
}

/* Registry — cũng được export cho harness Node kiểm tra trực tiếp. */
var TASKS = {
  'echo': taskEcho,
  'sleep': taskSleep,
  'meshopt-decimate': taskMeshoptDecimate,
  'texture-downscale': taskTextureDownscale,
  'fbx-parse': taskFbxParse,
  'fbx-write': taskFbxWrite,
  'thumbnail': taskThumbnail
};
var SUPPORTED_TASKS = ['echo', 'sleep', 'meshopt-decimate', 'texture-downscale'];
var UNSUPPORTED_TASKS = {
  'fbx-parse': 'FBXLoader r128 cần document + THREE (ImageLoader tạo <img>)',
  'fbx-write': 'FBXBinary.write nhận THREE.Object3D, serialize tốn ngang thời gian ghi',
  'thumbnail': 'THREE r128 WebGLRenderer cần document'
};

/* Dispatcher: chạy 1 task, trả Promise<{result, transfer}>.
   transfer: mảng ArrayBuffer nên transfer về main thread. */
function runTask(task, payload) {
  var fn = TASKS[task];
  if (!fn) {
    var err = new Error('Task không biết: ' + task);
    err.code = 'UNKNOWN_TASK';
    return Promise.reject(err);
  }
  var out;
  try { out = fn(payload); } catch (e) { return Promise.reject(e); }
  return Promise.resolve(out).then(function (result) {
    var transfer = [];
    if (result && result.index && result.index.buffer) transfer.push(result.index.buffer);
    if (result && result.bytes && isArrayBuffer(result.bytes)) transfer.push(result.bytes);
    return { result: result, transfer: transfer };
  });
}

/* onmessage — chỉ đăng ký khi chạy thật trong worker. */
if (typeof self !== 'undefined' && self && typeof self.addEventListener === 'function' &&
    typeof importScripts === 'function') {
  self.addEventListener('message', function (ev) {
    var msg = ev.data || {};
    var id = msg.id;
    var task = msg.task;
    function fail(e) {
      try {
        self.postMessage({ id: id, type: 'error', error: { message: String(e && e.message || e), code: (e && e.code) || 'WORKER_ERROR', task: task } });
      } catch (e2) { /* worker đã chết, không gửi được nữa */ }
    }
    if (id === undefined || !task) { fail(badInput('message worker cần {id, task}')); return; }
    runTask(task, msg.payload).then(function (r) {
      try { self.postMessage({ id: id, type: 'result', result: r.result }, r.transfer); }
      catch (e) { fail(e); }
    }).catch(fail);
  });
}

/* Export cho harness Node (vm): module không tồn tại trong worker thật. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TASKS: TASKS, runTask: runTask, SUPPORTED_TASKS: SUPPORTED_TASKS, UNSUPPORTED_TASKS: UNSUPPORTED_TASKS, WORKER_VERSION: WORKER_VERSION };
}
