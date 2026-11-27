/* ============================================================
 * workers/worker-bridge.js — Cầu nối main thread <-> worker
 * (NHÓM 3, 2026-11-27)
 *
 *   PixiStudio.WorkerBridge.runTask(task, payload, opts)
 *     -> Promise (có thêm .cancel())
 *   opts: { timeoutMs (mặc định 60000), transfer: [ArrayBuffer],
 *           onProgress(done, total, message), fallback: fn }
 *
 * Hành vi:
 *   - Worker không hỗ trợ (trình duyệt cũ, file:// — Chrome chặn
 *     Worker từ file://, GitHub Pages thì OK) -> chạy fallback
 *     (nếu có) hoặc reject code WORKER_UNAVAILABLE.
 *   - Worker trả lỗi code UNSUPPORTED (vd fbx-parse) -> chạy
 *     fallback (nếu có) thay vì fail hẳn.
 *   - Timeout / worker crash -> terminate worker cũ, reject, lần
 *     chạy sau tạo worker mới.
 *   - cancel() -> terminate worker, reject code CANCELLED.
 *
 * Helpers dùng trong studio:
 *   decimateGeometryViaWorker(geometry, targetTris, targetError)
 *     -> Promise<{ geometry, trisAfter, err }> (fallback:
 *     MixamoSafeExport.decimateMeshopt trên main thread).
 *   downscaleTextureViaWorker(tex, maxDim, quality)
 *     -> Promise<{ b64, mime, w, h }> (fallback:
 *     SaveManager._optimizeFBX.downscaleTextureToBytes).
 *   runWithProgress(title, promiseFn, opts)
 *     -> { promise, cancel }: hiện overlay #task-loading, cập
 *     nhật % qua Notifications.updateLoading, gắn nút "Hủy" vào
 *     overlay (tạo động, không sửa index.html).
 *
 * Cần load SAU three.min.js + vendor/meshopt (để fallback dùng
 * được MSE) và TRƯỚC save-manager.js (save-manager móc vào bridge).
 * Script tag (coordinator gộp vào index.html, KHÔNG tự sửa file):
 *   <script src="js/workers/worker-bridge.js"></script>
 * ============================================================ */
(function () {
  'use strict';

  var WORKER_URL = 'js/workers/pixistudio-worker.js';
  var DEFAULT_TIMEOUT_MS = 60000;

  var worker = null;          /* singleton Worker */
  var workerStarting = false;
  var nextId = 1;
  var pending = {};           /* id -> { resolve, reject, onProgress, timer, task } */

  var Bridge = {};

  Bridge.WORKER_URL = WORKER_URL;
  Bridge.SUPPORTED_TASKS = ['echo', 'sleep', 'meshopt-decimate', 'texture-downscale'];
  Bridge.UNSUPPORTED_TASKS = {
    'fbx-parse': 'FBXLoader r128 cần document + THREE (ImageLoader tạo <img>)',
    'fbx-write': 'FBXBinary.write nhận THREE.Object3D, serialize tốn ngang thời gian ghi',
    'thumbnail': 'THREE r128 WebGLRenderer cần document'
  };

  /* Worker bị chặn trên file:// (Chrome) và trình duyệt không có
     Worker/Blob/URL. GitHub Pages (https) thì OK. */
  Bridge.isSupported = function () {
    if (typeof Worker === 'undefined') return false;
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return false;
    try {
      if (typeof location !== 'undefined' && location.protocol === 'file:') return false;
    } catch (e) { /* location không đọc được -> cứ thử tạo worker */ }
    return true;
  };

  Bridge.unsupportedReason = function () {
    if (typeof Worker === 'undefined') return 'trình duyệt không có Web Worker';
    try {
      if (typeof location !== 'undefined' && location.protocol === 'file:') {
        return 'Worker bị chặn khi mở file:// — dùng GitHub Pages (https) hoặc chạy qua server';
      }
    } catch (e) {}
    return null;
  };

  Bridge.configure = function (opts) {
    if (opts && opts.workerUrl) WORKER_URL = opts.workerUrl;
  };

  function onWorkerMessage(ev) {
    var msg = (ev && ev.data) || {};
    var entry = pending[msg.id];
    if (!entry) return;
    if (msg.type === 'progress') {
      if (entry.onProgress) { try { entry.onProgress(msg.done, msg.total, msg.message); } catch (e) {} }
      return;
    }
    clearTimeout(entry.timer);
    delete pending[msg.id];
    if (msg.type === 'result') entry.resolve(msg.result);
    else {
      var err = new Error((msg.error && msg.error.message) || 'Worker lỗi không rõ');
      err.code = (msg.error && msg.error.code) || 'WORKER_ERROR';
      err.task = entry.task;
      entry.reject(err);
    }
  }

  function onWorkerError(ev) {
    /* Worker crash / lỗi load script: reject toàn bộ task đang chờ,
       hủy worker để lần sau tạo mới. */
    var err = new Error('Worker lỗi: ' + (ev && (ev.message || ev.filename) || 'không rõ nguyên nhân'));
    err.code = 'WORKER_CRASH';
    Object.keys(pending).forEach(function (id) {
      var entry = pending[id];
      clearTimeout(entry.timer);
      delete pending[id];
      entry.reject(err);
    });
    Bridge.terminate();
  }

  function getWorker() {
    if (worker) return worker;
    if (!Bridge.isSupported()) return null;
    try {
      worker = new Worker(WORKER_URL);
    } catch (e) {
      worker = null;
      return null;
    }
    worker.onmessage = onWorkerMessage;
    worker.onerror = onWorkerError;
    return worker;
  }

  function makeError(message, code) {
    var err = new Error(message);
    err.code = code;
    return err;
  }

  /* Chạy 1 task. Trả Promise có thêm .cancel(). */
  Bridge.runTask = function (task, payload, opts) {
    opts = opts || {};
    var timeoutMs = (typeof opts.timeoutMs === 'number') ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    var fallback = (typeof opts.fallback === 'function') ? opts.fallback : null;
    var onProgress = opts.onProgress || null;

    function runFallback(reasonErr) {
      if (!fallback) return Promise.reject(reasonErr);
      try {
        var r = fallback();
        return (r && typeof r.then === 'function') ? r : Promise.resolve(r);
      } catch (e) { return Promise.reject(e); }
    }

    var w = getWorker();
    if (!w) {
      return runFallback(makeError('Web Worker không khả dụng' +
        (Bridge.unsupportedReason() ? ': ' + Bridge.unsupportedReason() : ''), 'WORKER_UNAVAILABLE'));
    }

    var id = nextId++;
    var cancelled = false;
    var promise = new Promise(function (resolve, reject) {
      var timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(function () {
          if (pending[id]) {
            delete pending[id];
            Bridge.terminate();
            reject(makeError('Worker timeout sau ' + timeoutMs + 'ms (task ' + task + ')', 'TIMEOUT'));
          }
        }, timeoutMs);
      }
      pending[id] = {
        task: task, onProgress: onProgress, timer: timer,
        resolve: resolve,
        reject: function (err) {
          /* Worker báo UNSUPPORTED -> fallback main thread. */
          if (err && err.code === 'UNSUPPORTED' && fallback) {
            runFallback(err).then(resolve, reject);
          } else {
            reject(err);
          }
        }
      };
      try {
        w.postMessage({ id: id, task: task, payload: payload }, opts.transfer || []);
      } catch (e) {
        clearTimeout(timer);
        delete pending[id];
        runFallback(makeError('postMessage sang worker lỗi: ' + (e && e.message || e), 'POSTMESSAGE_ERROR')).then(resolve, reject);
      }
    });
    promise.cancel = function () {
      if (cancelled) return;
      cancelled = true;
      var entry = pending[id];
      if (entry) {
        clearTimeout(entry.timer);
        delete pending[id];
        Bridge.terminate();
        entry.reject(makeError('Task ' + task + ' đã hủy', 'CANCELLED'));
      }
    };
    promise.taskId = id;
    return promise;
  };

  /* Hủy 1 task đang chờ (theo id) hoặc tất cả. */
  Bridge.cancel = function (taskId) {
    if (taskId !== undefined && pending[taskId]) {
      var entry = pending[taskId];
      clearTimeout(entry.timer);
      delete pending[taskId];
      Bridge.terminate();
      entry.reject(makeError('Task ' + entry.task + ' đã hủy', 'CANCELLED'));
      return true;
    }
    return Bridge.cancelAll();
  };

  Bridge.cancelAll = function () {
    var ids = Object.keys(pending);
    if (!ids.length) return false;
    ids.forEach(function (id) {
      var entry = pending[id];
      clearTimeout(entry.timer);
      delete pending[id];
      entry.reject(makeError('Task ' + entry.task + ' đã hủy', 'CANCELLED'));
    });
    Bridge.terminate();
    return true;
  };

  Bridge.terminate = function () {
    if (worker) { try { worker.terminate(); } catch (e) {} }
    worker = null;
    workerStarting = false;
  };

  Bridge.pendingCount = function () { return Object.keys(pending).length; };

  /* ---------------- helper: meshopt decimate ----------------
   * Gửi position + index sang worker, nhận index mới về, dựng lại
   * BufferGeometry (giữ nguyên mọi attribute theo đỉnh — meshopt
   * chỉ đổi index nên UV được bảo toàn, như decimateMeshopt gốc).
   * Trả { geometry, trisAfter, err, viaWorker: true/false }. */
  Bridge.decimateGeometryViaWorker = function (geometry, targetTris, targetError, onProgress) {
    var THREE = (typeof window !== 'undefined') ? window.THREE : null;
    if (!geometry || !geometry.attributes || !geometry.attributes.position) {
      return Promise.reject(makeError('decimate cần geometry có position', 'BAD_INPUT'));
    }
    var pos = geometry.attributes.position;
    var index = geometry.index;
    var posArr = (pos.array instanceof Float32Array) ? pos.array : new Float32Array(pos.array);
    var idxArr;
    if (index && index.array) {
      idxArr = (index.array instanceof Uint32Array) ? index.array : new Uint32Array(index.array);
    } else {
      idxArr = new Uint32Array(pos.count);
      for (var i = 0; i < pos.count; i++) idxArr[i] = i;
    }
    var srcTris = Math.floor(idxArr.length / 3);
    if (srcTris <= targetTris) {
      return Promise.resolve({ geometry: geometry, trisAfter: srcTris, err: 0, viaWorker: false, unchanged: true });
    }
    function buildGeometry(newIndex, err) {
      var g = new THREE.BufferGeometry();
      Object.keys(geometry.attributes).forEach(function (name) {
        g.setAttribute(name, geometry.attributes[name].clone());
      });
      g.setIndex(new THREE.BufferAttribute(newIndex, 1));
      if (g.attributes.normal) g.deleteAttribute('normal');
      g.computeVertexNormals();
      g.computeBoundingBox();
      g.computeBoundingSphere();
      return { geometry: g, trisAfter: Math.floor(newIndex.length / 3), err: err, viaWorker: true };
    }
    function fallbackMainThread() {
      var MSE = (typeof PixiStudio !== 'undefined') ? PixiStudio.MixamoSafeExport : null;
      if (!MSE || typeof MSE.decimateMeshopt !== 'function') {
        return Promise.reject(makeError('meshopt không khả dụng (cả worker lẫn main thread)', 'MESHOPT_UNAVAILABLE'));
      }
      var d = MSE.decimateMeshopt(geometry, targetTris, targetError);
      if (!d) return Promise.resolve({ geometry: geometry, trisAfter: srcTris, err: 0, viaWorker: false, unchanged: true });
      return Promise.resolve({ geometry: d.geometry, trisAfter: d.trisAfter, err: d.err, viaWorker: false });
    }
    /* Copy mảng trước khi transfer (postMessage transfer sẽ detach
       buffer gốc — geometry gốc vẫn cần dùng nếu fallback). */
    var posCopy = new Float32Array(posArr);
    var idxCopy = new Uint32Array(idxArr);
    return Bridge.runTask('meshopt-decimate',
      { positions: posCopy, index: idxCopy, targetTris: targetTris, targetError: targetError },
      { transfer: [posCopy.buffer, idxCopy.buffer], onProgress: onProgress, fallback: fallbackMainThread })
      .then(function (res) {
        /* runTask đã fallback nội bộ (UNSUPPORTED) -> res đã là
           shape { geometry, trisAfter } của main thread. */
        if (res && res.geometry) return res;
        if (res.unchanged) return { geometry: geometry, trisAfter: res.trisAfter, err: 0, viaWorker: true, unchanged: true };
        return buildGeometry(res.index, res.err);
      })
      /* Worker lỗi chung (không chỉ UNSUPPORTED) -> fallback main thread. */
      .catch(function (e) {
        if (e && e.code === 'CANCELLED') throw e;
        return fallbackMainThread();
      });
  };

  /* ---------------- helper: texture downscale ----------------
   * Main thread chỉ decode ảnh -> ImageBitmap (transferable) rồi
   * worker resize + encode JPEG. Fallback: canvas sync cũ.
   * Trả { b64, mime, w, h } — đúng định dạng textureBytes mà
   * FBXBinary.write đã hỗ trợ. */
  Bridge.downscaleTextureViaWorker = function (tex, maxDim, quality) {
    function fallbackMainThread() {
      var SM = (typeof PixiStudio !== 'undefined') ? PixiStudio.SaveManager : null;
      var fn = SM && SM._optimizeFBX && SM._optimizeFBX.downscaleTextureToBytes;
      if (!fn) return Promise.reject(makeError('không có hàm downscale fallback', 'NO_FALLBACK'));
      var r = fn(tex, 'map', maxDim, quality);
      if (!r) return Promise.reject(makeError('downscale main thread trả null', 'DOWNSCALE_NULL'));
      return Promise.resolve(r);
    }
    try {
      var img = (tex.userData && tex.userData.originalImage) || tex.image;
      if (!img) return fallbackMainThread();
      if (typeof createImageBitmap !== 'function') return fallbackMainThread();
      var bitmapP;
      if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
        bitmapP = Promise.resolve(img);
      } else {
        bitmapP = createImageBitmap(img);
      }
      return bitmapP.then(function (bmp) {
        /* flipY PHẢI khớp đường sync downscaleTextureToBytes +
           writer encodeTextureToBytes: chỉ lật khi tex.flipY === false
           (ảnh glTF top-down; FBX đọc bottom-up). Bản cũ dùng
           (tex.flipY !== false) — NGƯỢC: texture FBX (flipY=true
           mặc định) bị lật dọc, render ra mặt lộn lên đỉnh đầu, áo
           sai màu (đo 2026-11-27: async Thiếu Lâm meanRGB
           [174,113,84] vs sync [214,155,108], ảnh chụp xác nhận). */
        var flipY = (tex.flipY === false);
        return Bridge.runTask('texture-downscale',
          { imageBitmap: bmp, maxDim: maxDim, quality: quality, flipY: flipY },
          { transfer: [bmp], fallback: fallbackMainThread });
      }).then(function (res) {
        if (!res || !res.bytes) return fallbackMainThread();
        var bytes = new Uint8Array(res.bytes);
        var b64 = '';
        /* btoa theo chunk để không tràn stack với ảnh lớn.
         * CHUNK PHẢI chia hết cho 3: base64 mã hoá 3 byte -> 4 ký tự;
         * chunk 8192 byte (8192 % 3 = 2) làm mỗi chunk chèn '=' đệm
         * GIỮA chuỗi -> atob() trong fbx-binary.js (b64ToBytes) throw
         * InvalidCharacterError -> FBXBinary.write lỗi -> toàn bộ
         * đường worker tối ưu FBX trả null (đo 2026-11-27 trên
         * Thần Điêu + Thiếu Lâm: 5/5 attempt fail ở atob, file
         * <1MB không bao giờ ra từ đường worker). 8190 = 3 x 2730:
         * mỗi chunk không đệm, chỉ chunk cuối có '=' ở cuối chuỗi. */
        var CHUNK = 8190;
        for (var i = 0; i < bytes.length; i += CHUNK) {
          b64 += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
        }
        return { b64: b64, mime: 'image/jpeg', w: res.w, h: res.h };
      }).catch(function (e) {
        if (e && e.code === 'CANCELLED') throw e;
        return fallbackMainThread();
      });
    } catch (e) {
      return fallbackMainThread();
    }
  };

  /* ---------------- helper: progress + nút hủy ----------------
   * Hiện overlay #task-loading, cập nhật % qua Notifications, gắn
   * nút "Hủy" vào overlay (tạo động lúc chạy — không sửa index.html).
   * Trả { promise, cancel }. */
  Bridge.runWithProgress = function (title, taskPromise, opts) {
    opts = opts || {};
    var N = (typeof PixiStudio !== 'undefined') ? PixiStudio.Notifications : null;
    if (N && N.showLoading) N.showLoading(title || 'Đang xử lý…', 0);
    var overlay = (typeof document !== 'undefined') ? document.getElementById('task-loading') : null;
    var cancelBtn = null;
    function removeCancelBtn() {
      if (cancelBtn && cancelBtn.parentNode) cancelBtn.parentNode.removeChild(cancelBtn);
      cancelBtn = null;
    }
    if (overlay && opts.cancellable !== false) {
      cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Hủy';
      cancelBtn.setAttribute('data-worker-cancel', '1');
      cancelBtn.style.cssText = 'margin-top:8px;padding:6px 14px;border-radius:8px;border:1px solid #f66;background:#3a1d1d;color:#ffb3b3;font-weight:700;cursor:pointer;';
      cancelBtn.onclick = function () { handle.cancel(); };
      overlay.appendChild(cancelBtn);
    }
    var settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      removeCancelBtn();
      if (N && N.hideLoading) N.hideLoading();
    }
    var promise = Promise.resolve(taskPromise).then(function (r) { finish(); return r; }, function (e) { finish(); throw e; });
    if (taskPromise && typeof taskPromise.onProgress === 'function') { /* progress đã gắn ở runTask */ }
    var handle = {
      promise: promise,
      cancel: function () {
        if (taskPromise && typeof taskPromise.cancel === 'function') taskPromise.cancel();
        Bridge.cancelAll();
        finish();
      },
      onProgress: function (pct, message) {
        if (N && N.updateLoading) N.updateLoading(pct, message);
      }
    };
    return handle;
  };

  if (typeof window !== 'undefined') {
    window.PixiStudio = window.PixiStudio || {};
    window.PixiStudio.WorkerBridge = Bridge;
  }
  if (typeof globalThis !== 'undefined' && typeof window === 'undefined') {
    globalThis.PixiStudio = globalThis.PixiStudio || {};
    globalThis.PixiStudio.WorkerBridge = Bridge;
  }
})();
