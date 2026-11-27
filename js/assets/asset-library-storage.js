/* ============================================================
 * assets/asset-library-storage.js — AUTO SAVE / LOAD Asset Library
 * (nhóm B, 2026-11-27)
 *
 * METADATA  → localStorage key `pixistudio.asset-library-v1`
 *             { version: 1, savedAt, assets: [...] }
 * FILE THẬT → IndexedDB `pixistudio-assets`, store `files`
 *             key = asset id, value = { blob, fileName, mime, size, addedAt }
 *
 * THIẾT KẾ:
 * - Asset id BỀN (store id, U.uid('asset')) — KHÔNG dùng 'model-'+entryId
 *   vì entry id được Models sinh lại mỗi lần load (U.uid('model')).
 *   Khi restore, model load xong → syncImportedModels tạo asset mới →
 *   store khớp bằng tên file gốc (meta.fileName) rồi chép meta
 *   (tên đã đổi/tags/favorite/collection) lên asset mới.
 * - Sample assets (9 chibi + props/env/fx) KHÔNG có file thật: chỉ lưu
 *   meta (tên/tags/favorite/collection/rename), khớp lại theo asset.id.
 * - Asset model thiếu file: tạo placeholder { missingFile: true } trong
 *   Library.assets (filter trong syncImportedModels giữ lại asset này),
 *   grid hiện badge "Thiếu file" + nút "Load lại" (decorator + observer,
 *   KHÔNG sửa renderGrid — nhóm C sở hữu renderGrid).
 * - Bytes file lấy từ Importers._fileBuffers (stash trong importers.js):
 *   importOne giữ lại bản copy buf.slice(0) — loader (GLTF/FBXLoader)
 *   có thể detach/transfer ArrayBuffer gốc, bản slice là bản riêng nên
 *   vẫn còn nguyên để lưu IndexedDB. Image/audio chỉ stash dataURL khi
 *   file < 2 MB.
 * - QuotaExceededError (localStorage lẫn IndexedDB): bắt, notify rõ cho
 *   user + đề xuất xóa asset cũ, KHÔNG throw, KHÔNG mất dữ liệu cũ.
 * - restore() gọi từ AssetLibrary.init() (cuối init, async, chạy song
 *   song với loadDefault — cả hai đều thêm model qua syncImportedModels
 *   nên không xung đột). KHÔNG dùng bus 'app:ready' vì event đó phát
 *   SAU loadDefault, muộn hơn không cần thiết; init-hook đủ sớm và
 *   store có guard chống chạy restore 2 lần.
 * - KHÔNG sửa js/core/storage.js — module này độc lập, chỉ tái dùng
 *   cùng quy ước key prefix `pixistudio.*` + bus.emit('notify').
 * ============================================================ */
(function () {
  'use strict';

  var bus = PixiStudio.bus;
  var U = PixiStudio.Utils;

  var META_KEY = 'pixistudio.asset-library-v1';
  var DB_NAME = 'pixistudio-assets';
  var DB_VERSION = 1;
  var STORE_NAME = 'files';

  /* Thumbnail dataURL chỉ lưu khi < ~50KB (chuỗi base64 ~38KB giải mã):
     thumbnail 128x136 PNG thường 10–30KB; lớn hơn thì bỏ để render lại,
     tránh localStorage (~5MB) bị thumbnail chiếm hết. */
  var THUMB_MAX_CHARS = 51200;
  /* Image/audio chỉ lưu file khi < 2MB — lớn hơn thì chỉ lưu meta. */
  var SMALL_FILE_MAX = 2 * 1024 * 1024;
  /* Stash import giữ tối đa 20 file gần nhất (tránh phình RAM). */
  var STASH_MAX = 20;

  var MIME_BY_EXT = {
    glb: 'model/gltf-binary', gltf: 'model/gltf+json',
    fbx: 'application/octet-stream', obj: 'text/plain',
    stl: 'model/stl', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    svg: 'image/svg+xml', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg'
  };

  var Store = {
    _dbPromise: null,
    _memFiles: null,      /* fallback khi trình duyệt không có indexedDB */
    _restoring: false,
    _restored: false,
    _metaCache: null,     /* meta đã load lần cuối (để merge khi _persist) */
    _pendingReimport: null, /* { storeId, fileName } khi user bấm "Load lại" */
    _observer: null,
    _usageTimer: null
  };

  /* ---------- helpers ---------- */
  function notify(type, title, message, duration) {
    try { bus.emit('notify', { type: type, title: title, message: message, duration: duration || 6000 }); } catch (e) { /* bus chưa sẵn — bỏ qua */ }
  }

  function isQuotaError(err) {
    if (!err) return false;
    if (err.name === 'QuotaExceededError' || err.code === 22) return true;
    return /quota/i.test(String(err.message || err));
  }

  function baseName(fileName) {
    return String(fileName || '').replace(/\.[^.]+$/, '');
  }

  function extOf(fileName) {
    var m = /\.([a-z0-9]+)$/i.exec(fileName || '');
    return m ? m[1].toLowerCase() : '';
  }

  function isSampleType(t) {
    /* mọi type không phải model/image/audio đều là sample có sẵn */
    return t !== 'model' && t !== 'image' && t !== 'audio';
  }

  function blobToArrayBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Không đọc được blob')); };
      r.readAsArrayBuffer(blob);
    });
  }

  function blobToDataURL(blob) {
    if (blob.text && blob.type && blob.type.indexOf('text/') === 0) return blob.text();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Không đọc được blob')); };
      r.readAsDataURL(blob);
    });
  }

  function dataURLToBlob(dataUrl, fileName) {
    var m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(dataUrl || '');
    if (!m) return null;
    var mime = m[1] || MIME_BY_EXT[extOf(fileName)] || 'application/octet-stream';
    try {
      var bin = atob(m[3]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    } catch (e) { return null; }
  }

  /* Duck-type thay cho instanceof (an toàn cross-realm: harness vm
     đưa ArrayBuffer/Blob từ realm khác vào, instanceof sẽ sai). */
  function isBlobLike(d) {
    return d && typeof d === 'object' && typeof d.size === 'number' &&
      typeof d.slice === 'function' && typeof d.arrayBuffer === 'function';
  }
  function isArrayBufferLike(d) {
    return d && typeof d === 'object' && typeof d.byteLength === 'number' &&
      typeof d.slice === 'function' && d.BYTES_PER_ELEMENT === undefined;
  }

  function getLibrary() { return PixiStudio.AssetLibrary || null; }

  /* ---------- IndexedDB ---------- */
  Store._openDB = function () {
    if (Store._dbPromise) return Store._dbPromise;
    Store._dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') { Store._memFiles = new Map(); resolve(null); return; }
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (err) { Store._memFiles = new Map(); resolve(null); return; }
      req.onupgradeneeded = function () {
        try {
          if (req.result && req.result.createObjectStore && !req.result.objectStoreNames.contains(STORE_NAME)) {
            req.result.createObjectStore(STORE_NAME);
          }
        } catch (e) { /* store đã có */ }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Mở IndexedDB thất bại')); };
    });
    return Store._dbPromise;
  };

  /* Chạy 1 thao tác objectStore, trả Promise<request.result>.
     Dùng đúng API IDB chuẩn (open/transaction/objectStore/put/get/
     delete/clear) để harness fake-IDB in-memory Map chạy được. */
  Store._idbOp = function (mode, fn) {
    return Store._openDB().then(function (db) {
      if (!db) {
        /* fallback bộ nhớ (không có indexedDB): mô phỏng cùng API,
           trả về request.result như đường IDB thật. */
        if (!Store._memFiles) Store._memFiles = new Map();
        var fbReq = fn({
          put: function (v, k) { Store._memFiles.set(k, v); return { result: k }; },
          get: function (k) { return { result: Store._memFiles.has(k) ? Store._memFiles.get(k) : undefined }; },
          delete: function (k) { Store._memFiles.delete(k); return {}; },
          clear: function () { Store._memFiles.clear(); return {}; }
        });
        return (fbReq && 'result' in fbReq) ? fbReq.result : undefined;
      }
      return new Promise(function (resolve, reject) {
        var tx, store, req;
        try {
          tx = db.transaction(STORE_NAME, mode);
          store = tx.objectStore(STORE_NAME);
          req = fn(store);
        } catch (err) { reject(err); return; }
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('IndexedDB lỗi')); };
      });
    });
  };

  /* ---------- META (localStorage) ---------- */
  Store.loadMeta = function () {
    try {
      var raw = localStorage.getItem(META_KEY);
      if (!raw) return { version: 1, savedAt: null, assets: [] };
      var data = JSON.parse(raw);
      if (Array.isArray(data)) data = { version: 0, assets: data }; /* migrate v0: mảng trần */
      if (!data || !Array.isArray(data.assets)) return { version: 1, savedAt: null, assets: [] };
      data.version = 1; /* migrate dự phòng: mọi bản cũ đều về schema v1 */
      Store._metaCache = data.assets;
      return data;
    } catch (e) {
      console.warn('[AssetLibraryStore] đọc meta lỗi:', e);
      return { version: 1, savedAt: null, assets: [] };
    }
  };

  Store.saveMeta = function (metaArray) {
    var assets = Array.isArray(metaArray) ? metaArray : Store.collectMeta();
    var payload = { version: 1, savedAt: new Date().toISOString(), assets: assets };
    try {
      localStorage.setItem(META_KEY, JSON.stringify(payload));
      Store._metaCache = assets;
      Store.updateUsageUI();
      return true;
    } catch (err) {
      if (isQuotaError(err)) {
        /* Thử lần 2 sau khi bỏ thumbnail (thường chiếm phần lớn meta). */
        try {
          var slim = assets.map(function (a) {
            var c = Object.assign({}, a); c.thumb = ''; return c;
          });
          localStorage.setItem(META_KEY, JSON.stringify({ version: 1, savedAt: payload.savedAt, assets: slim }));
          Store._metaCache = slim;
          notify('warning', 'Bộ nhớ local đầy', 'Đã lưu library nhưng bỏ thumbnail để vừa bộ nhớ — hãy xóa bớt asset cũ.');
          return true;
        } catch (e2) { /* rơi xuống notify bên dưới */ }
        notify('error', 'Bộ nhớ đầy — chưa lưu được library',
          'localStorage đã đầy. Hãy xóa bớt asset cũ (nút "Xóa toàn bộ dữ liệu library" ở cuối panel) rồi thử lại. Dữ liệu cũ vẫn còn nguyên.');
        return false;
      }
      console.warn('[AssetLibraryStore] saveMeta lỗi:', err);
      return false;
    }
  };

  /* Xóa hẳn 1 asset khỏi meta + file (nhóm C gọi khi user xóa asset).
     Sau đó nhóm C gọi Library._persist() như thường lệ. */
  Store.removeMeta = function (id) {
    if (Store._metaCache) Store._metaCache = Store._metaCache.filter(function (a) { return a.id !== id; });
    Store.deleteFile(id);
    return Store.saveMeta(Store._metaCache || []);
  };

  /* Gom meta từ Library.assets hiện tại, MERGE với meta đã lưu:
     asset nào không còn trong grid (vd image/audio chỉ có meta, hoặc
     model thiếu file chưa render) vẫn giữ nguyên meta — tránh _persist
     vô tình xóa mất chúng. Asset đã xóa hẳn phải đi qua removeMeta(). */
  Store.collectMeta = function () {
    var lib = getLibrary();
    var byId = {};
    (Store._metaCache || Store.loadMeta().assets).forEach(function (m) { byId[m.id] = m; });
    if (lib) {
      lib.assets.forEach(function (a) {
        byId[Store.metaIdOf(a)] = Store.metaOf(a);
      });
    }
    return Object.keys(byId).map(function (k) { return byId[k]; });
  };

  /* Id bền của 1 asset trong meta: model dùng _storeId, sample dùng id gốc. */
  Store.metaIdOf = function (asset) {
    if (asset.type === 'model') return asset._storeId || asset.id;
    return asset.id;
  };

  Store.metaOf = function (asset) {
    var lib = getLibrary();
    var entry = asset.entry || null;
    var stats = (entry && entry.stats) || {};
    var bones = stats.bones || 0;
    if (!bones && entry && entry.object3D) {
      try {
        entry.object3D.traverse(function (o) { if (o.isBone) bones++; });
      } catch (e) { /* traverse lỗi — giữ 0 */ }
    }
    var thumb = '';
    if (lib && lib._thumbs && lib._thumbs[asset.id] && lib._thumbs[asset.id].length <= THUMB_MAX_CHARS) {
      thumb = lib._thumbs[asset.id];
    }
    var type = asset.type === 'model' ? 'model'
      : (asset.type === 'image' || asset.type === 'audio') ? asset.type : 'sample';
    return {
      id: Store.metaIdOf(asset),
      name: asset.name || 'Asset',
      cat: asset.cat || 'Imported',
      type: type,
      sampleType: type === 'sample' ? asset.type : undefined,
      fileName: asset.fileName || '',
      fileExt: asset.fileExt || extOf(asset.fileName || ''),
      tags: (asset.tags || []).slice(),
      favorite: !!asset.favorite,
      collectionId: asset.collectionId || null,
      addedAt: asset.addedAt || new Date().toISOString(),
      size: asset.size || asset.fileSize || (entry && entry.fileSize) || 0,
      fileSize: asset.size || asset.fileSize || (entry && entry.fileSize) || 0, /* alias nhóm C dùng fileSize */
      tris: stats.triangles || 0,
      verts: stats.vertices || 0,
      bones: bones,
      clips: (entry && entry.clips && entry.clips.length) || 0,
      thumb: thumb,
      missingFile: !!asset.missingFile
    };
  };

  /* Chép meta (tên đã đổi/tags/favorite/collection) lên 1 asset live. */
  Store.applyMetaToAsset = function (asset, meta) {
    if (!asset || !meta) return;
    if (meta.name) asset.name = meta.name;
    asset.tags = (meta.tags || []).slice();
    asset.favorite = !!meta.favorite;
    asset.collectionId = meta.collectionId || null;
    asset.addedAt = meta.addedAt || asset.addedAt;
    asset.fileName = meta.fileName || asset.fileName;
    asset.fileExt = meta.fileExt || asset.fileExt;
    if (meta.size) { asset.size = meta.size; asset.fileSize = meta.size; }
    if (meta.fileSize && !asset.size) { asset.size = meta.fileSize; asset.fileSize = meta.fileSize; }
    if (meta.type === 'model') asset._storeId = meta.id;
  };

  /* ---------- FILE (IndexedDB) ---------- */
  Store.saveFile = function (id, data, fileName) {
    var blob;
    try {
      if (isBlobLike(data)) blob = data;
      else if (isArrayBufferLike(data)) blob = new Blob([data], { type: MIME_BY_EXT[extOf(fileName)] || 'application/octet-stream' });
      else if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(data)) blob = new Blob([data], { type: MIME_BY_EXT[extOf(fileName)] || 'application/octet-stream' });
      else return Promise.resolve(false);
    } catch (e) { return Promise.resolve(false); }
    var record = { blob: blob, fileName: fileName || '', mime: blob.type, size: blob.size, addedAt: new Date().toISOString() };
    return Store._idbOp('readwrite', function (store) { return store.put(record, id); })
      .then(function () { Store.updateUsageUI(); return true; })
      .catch(function (err) {
        if (isQuotaError(err)) {
          notify('error', 'Bộ nhớ đầy — chưa lưu được file ' + (fileName || ''),
            'IndexedDB đã đầy (' + (blob.size > 1024 * 1024 ? (blob.size / 1048576).toFixed(1) + ' MB' : blob.size + ' B') +
            '). Asset vẫn hiện trong phiên này nhưng sẽ mất khi tắt trang — hãy xóa bớt asset cũ rồi import lại.');
          return false;
        }
        console.warn('[AssetLibraryStore] saveFile lỗi:', err);
        return false;
      });
  };

  Store.loadFile = function (id) {
    return Store._idbOp('readonly', function (store) { return store.get(id); })
      .then(function (rec) { return (rec && rec.blob) ? rec.blob : null; })
      .catch(function (err) { console.warn('[AssetLibraryStore] loadFile lỗi:', err); return null; });
  };

  Store.deleteFile = function (id) {
    return Store._idbOp('readwrite', function (store) { return store.delete(id); })
      .then(function () { Store.updateUsageUI(); return true; })
      .catch(function () { return false; });
  };

  Store.clearAll = function () {
    try { localStorage.removeItem(META_KEY); } catch (e) { /* private mode */ }
    Store._metaCache = [];
    var lib = getLibrary();
    return Store._idbOp('readwrite', function (store) { return store.clear(); })
      .then(function () {
        if (lib) {
          /* Chỉ gỡ placeholder thiếu file; model đang mở vẫn ở trong scene. */
          lib.assets = lib.assets.filter(function (a) { return !a.missingFile; });
          if (lib.renderGrid) lib.renderGrid();
        }
        Store.updateUsageUI();
        notify('success', 'Đã xóa dữ liệu library', 'Đã xóa metadata + toàn bộ file đã lưu. Model đang mở vẫn còn trong scene.');
        return true;
      })
      .catch(function (err) {
        console.warn('[AssetLibraryStore] clearAll lỗi:', err);
        return false;
      });
  };

  Store.estimateUsage = function () {
    var localBytes = 0;
    try { localBytes = (localStorage.getItem(META_KEY) || '').length * 2; } catch (e) { /* private mode */ }
    var meta = Store._metaCache || Store.loadMeta().assets;
    var idbBytes = meta.reduce(function (sum, m) { return sum + (m.size || m.fileSize || 0); }, 0);
    var quotaP = Promise.resolve(null);
    try {
      if (navigator && navigator.storage && navigator.storage.estimate) {
        quotaP = navigator.storage.estimate().catch(function () { return null; });
      }
    } catch (e) { /* không hỗ trợ */ }
    return quotaP.then(function (est) {
      return {
        localBytes: localBytes,
        idbBytes: idbBytes,
        totalBytes: localBytes + idbBytes,
        quota: (est && est.quota) || 0,
        usage: (est && est.usage) || 0,
        label: U.formatBytes(localBytes + idbBytes)
      };
    });
  };

  /* ---------- RESTORE (auto load khi boot) ---------- */
  Store.restore = function () {
    if (Store._restored || Store._restoring) return Promise.resolve({ restored: 0, missing: 0, skipped: 0 });
    Store._restoring = true;
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var meta = Store.loadMeta();
    var lib = getLibrary();
    var stats = { restored: 0, missing: 0, skipped: 0, ms: 0 };
    if (!lib || !meta.assets.length) {
      Store._restoring = false; Store._restored = true;
      Store.updateUsageUI();
      return Promise.resolve(stats);
    }

    var chain = Promise.resolve();
    meta.assets.forEach(function (m) {
      chain = chain.then(function () { return Store._restoreOne(m, stats); });
    });

    return chain.then(function () {
      Store._restoring = false; Store._restored = true;
      var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      stats.ms = Math.round(t1 - t0);
      if (lib.syncImportedModels) lib.syncImportedModels(true);
      if (lib.renderGrid) lib.renderGrid();
      Store._decorateMissingCards();
      Store.updateUsageUI();
      if (stats.restored > 0 || stats.missing > 0) {
        notify(stats.missing ? 'warning' : 'success', 'Asset Library đã khôi phục',
          'Đã tải lại ' + stats.restored + ' model' +
          (stats.missing ? ' · ' + stats.missing + ' asset thiếu file (bấm "Load lại" trên thẻ để import lại)' : '') +
          ' · ' + stats.ms + 'ms');
      }
      return stats;
    }).catch(function (err) {
      Store._restoring = false; Store._restored = true;
      console.warn('[AssetLibraryStore] restore lỗi:', err);
      return stats;
    });
  };

  Store._restoreOne = function (m, stats) {
    var lib = getLibrary();
    if (!lib) { stats.skipped++; return Promise.resolve(); }

    /* Sample: chỉ khớp meta theo id, không có file thật. */
    if (m.type === 'sample' || (m.sampleType && isSampleType(m.sampleType))) {
      var sample = lib.assets.find(function (a) { return a.id === m.id; });
      if (sample) { Store.applyMetaToAsset(sample, m); stats.restored++; }
      else stats.skipped++;
      return Promise.resolve();
    }

    /* Image/audio: có blob thì đăng ký lại texture, không thì giữ meta. */
    if (m.type === 'image' || m.type === 'audio') {
      return Store.loadFile(m.id).then(function (blob) {
        if (!blob) { stats.missing++; return; }
        if (m.type === 'image' && PixiStudio.Textures && PixiStudio.Textures.registerTexture) {
          return blobToDataURL(blob).then(function (url) {
            PixiStudio.Textures.registerTexture(m.fileName || m.name, url);
            stats.restored++;
          }).catch(function () { stats.missing++; });
        }
        stats.restored++;
      });
    }

    /* Model: bắt buộc có file thật mới load được. */
    return Store.loadFile(m.id).then(function (blob) {
      if (!blob) { Store._addMissingPlaceholder(m); stats.missing++; return; }
      return blobToArrayBuffer(blob).then(function (buf) {
        var ext = (m.fileExt || extOf(m.fileName || '')).toLowerCase();
        var name = baseName(m.fileName || m.name);
        var Models = PixiStudio.Models;
        if (!Models) { Store._addMissingPlaceholder(m); stats.missing++; return; }
        var p;
        if (ext === 'glb' || ext === 'gltf') p = Models.loadGLBFromBuffer(buf, name, buf.byteLength);
        else if (ext === 'fbx') p = Models.loadFBXFromBuffer(buf, name, buf.byteLength);
        else if (ext === 'obj') p = Models.loadOBJFromBuffer(buf, name, null);
        else if (ext === 'stl') p = Models.loadSTLFromBuffer(buf, name);
        else p = Promise.reject(new Error('Định dạng .' + ext + ' không hỗ trợ restore'));
        return p.then(function () {
          if (lib.syncImportedModels) lib.syncImportedModels(true);
          var asset = lib.assets.find(function (a) {
            return a.type === 'model' && a.name === name;
          });
          if (asset) { Store.applyMetaToAsset(asset, m); stats.restored++; }
          else stats.skipped++;
        }).catch(function (err) {
          console.warn('[AssetLibraryStore] restore model lỗi:', m.fileName, err);
          Store._addMissingPlaceholder(m);
          stats.missing++;
        });
      });
    });
  };

  Store._addMissingPlaceholder = function (m) {
    var lib = getLibrary();
    if (!lib) return;
    var exists = lib.assets.find(function (a) { return a.id === m.id || (a._storeId === m.id); });
    if (exists) { exists.missingFile = true; return; }
    var placeholder = {
      id: m.id,
      name: m.name || baseName(m.fileName || 'Model'),
      cat: m.cat || 'Imported',
      type: 'model',
      entry: null,
      modelId: null,
      icon: 'model',
      fileName: m.fileName || '',
      fileExt: m.fileExt || '',
      tags: (m.tags || []).slice(),
      favorite: !!m.favorite,
      collectionId: m.collectionId || null,
      addedAt: m.addedAt,
      size: m.size || m.fileSize || 0,
      fileSize: m.size || m.fileSize || 0,
      missingFile: true,
      _storeId: m.id
    };
    /* Nhóm C có _normalizeAsset (điền tags/favorite/stats mặc định) — dùng chung. */
    lib.assets.push(lib._normalizeAsset ? lib._normalizeAsset(placeholder) : placeholder);
  };

  /* ---------- IMPORT STASH → LƯU FILE ---------- */
  Store._onImported = function (d) {
    if (!d || !d.name) return;
    var Imp = PixiStudio.Importers;
    var stash = Imp && Imp._fileBuffers ? Imp._fileBuffers[d.name] : null;
    if (!stash) return; /* model load từ đường khác (AI/Tripo) — không có stash */
    delete Imp._fileBuffers[d.name];

    /* "Load lại" cho asset thiếu file: dùng LẠI store id cũ để file mới
       ghi đè đúng record, meta (tags/rename) được giữ nguyên. */
    var pending = Store._pendingReimport;
    var isReimport = pending && baseName(d.name) === baseName(pending.fileName);

    if (d.type === 'model') {
      var buf = stash.buf;
      if (!buf) return;
      setTimeout(function () {
        var lib = getLibrary();
        if (!lib) return;
        var asset = lib.assets.find(function (a) {
          return a.type === 'model' && a.name === baseName(d.name) && !a._storeId;
        });
        if (!asset) return;
        var id = isReimport ? pending.storeId : U.uid('asset');
        asset._storeId = id;
        asset.fileName = d.name;
        asset.fileExt = stash.ext || extOf(d.name);
        asset.addedAt = new Date().toISOString();
        asset.size = d.size || buf.byteLength;
        if (isReimport) {
          var oldMeta = (Store._metaCache || []).find(function (x) { return x.id === id; });
          if (oldMeta) Store.applyMetaToAsset(asset, oldMeta);
          lib.assets = lib.assets.filter(function (a) { return !(a.missingFile && a._storeId === id && a !== asset); });
          Store._pendingReimport = null;
          if (lib.renderGrid) lib.renderGrid();
        }
        Store.saveFile(id, buf, d.name).then(function (ok) {
          if (ok && lib._persist) lib._persist();
          if (isReimport && ok) notify('success', 'Đã tải lại file', d.name + ' đã được lưu lại vào library.');
        });
      }, 250); /* đợi syncImportedModels (60ms) tạo asset xong */
      return;
    }

    if ((d.type === 'image' || d.type === 'audio') && stash.dataUrl) {
      if (stash.size && stash.size > SMALL_FILE_MAX) return; /* file nặng: chỉ lưu meta */
      var blob = dataURLToBlob(stash.dataUrl, d.name);
      if (!blob) return;
      var id2 = isReimport ? pending.storeId : U.uid('asset');
      if (isReimport) Store._pendingReimport = null;
      Store.saveFile(id2, blob, d.name).then(function (ok) {
        if (!ok) return;
        var meta = {
          id: id2, name: baseName(d.name), cat: 'Imported', type: d.type,
          fileName: d.name, fileExt: extOf(d.name), tags: [], favorite: false,
          collectionId: null, addedAt: new Date().toISOString(), size: d.size || blob.size,
          tris: 0, verts: 0, bones: 0, clips: 0, thumb: '', missingFile: false
        };
        var cache = Store._metaCache || Store.loadMeta().assets;
        cache.push(meta);
        Store.saveMeta(cache);
      });
    }
  };

  /* User bấm "Load lại" trên thẻ thiếu file → mở dialog, file import
     xong sẽ khớp lại qua _pendingReimport trong _onImported. */
  Store.reimportMissing = function (assetId) {
    var lib = getLibrary();
    var asset = lib && lib.assets.find(function (a) { return a.id === assetId; });
    if (!asset || !asset.missingFile) return false;
    Store._pendingReimport = { storeId: asset._storeId || asset.id, fileName: asset.fileName || asset.name };
    if (PixiStudio.Importers && PixiStudio.Importers.openFileDialog) PixiStudio.Importers.openFileDialog();
    notify('info', 'Load lại file', 'Hãy chọn lại file ' + (asset.fileName || asset.name) + ' để khôi phục asset này.');
    return true;
  };

  /* ---------- UI: badge thiếu file + block dung lượng ---------- */
  Store._decorateMissingCards = function () {
    var lib = getLibrary();
    if (!lib || typeof document === 'undefined') return;
    var grid = document.getElementById('asset-grid');
    if (!grid) return;
    var cards = grid.querySelectorAll('.asset-card');
    Array.prototype.forEach.call(cards, function (card) {
      var asset = lib.assets.find(function (a) { return a.id === card.dataset.id; });
      if (!asset || !asset.missingFile) return;
      card.classList.add('missing-file');
      if (card.querySelector('.asset-missing-badge')) return;
      var badge = document.createElement('div');
      badge.className = 'asset-missing-badge';
      badge.textContent = '⚠ Thiếu file';
      card.appendChild(badge);
      var btn = document.createElement('button');
      btn.className = 'asset-missing-btn';
      btn.textContent = 'Load lại file';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        Store.reimportMissing(asset.id);
      });
      card.appendChild(btn);
    });
  };

  Store._watchGrid = function () {
    if (Store._observer || typeof document === 'undefined') return;
    var grid = document.getElementById('asset-grid');
    if (!grid || typeof MutationObserver === 'undefined') return;
    Store._observer = new MutationObserver(function () {
      clearTimeout(Store._usageTimer);
      Store._usageTimer = setTimeout(Store._decorateMissingCards, 50);
    });
    Store._observer.observe(grid, { childList: true, subtree: true });
  };

  Store.updateUsageUI = function () {
    if (typeof document === 'undefined') return;
    var el = document.getElementById('asset-storage-usage');
    if (!el) return;
    el.textContent = 'Đang tính…';
    Store.estimateUsage().then(function (u) {
      el.textContent = 'Đã dùng ' + u.label + ' (local ' + U.formatBytes(u.localBytes) +
        ' + file ' + U.formatBytes(u.idbBytes) + ')' +
        (u.quota ? ' / hạn mức ~' + U.formatBytes(u.quota) : '');
    }).catch(function () { el.textContent = 'Không đo được dung lượng'; });
  };

  Store.init = function () {
    if (Store._inited) return;
    Store._inited = true;
    if (typeof document !== 'undefined') {
      Store._watchGrid();
      Store._decorateMissingCards();
    }
    if (bus && bus.on) {
      bus.on('asset:imported', function (d) { Store._onImported(d); });
    }
    Store.updateUsageUI();
  };

  window.PixiStudio.AssetLibraryStore = Store;
})();
