/* ============================================================
 * assets/importers.js — Pipeline import thật:
 * GLB/GLTF/OBJ/STL/FBX model · PNG/JPG/WebP/SVG texture · audio.
 * FBX → load thật bằng FBXLoader r128 + fflate (CDN, index.html:494-497).
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Importers = {
    imported: [],       // lịch sử import: {name, type, size, at}
    /* Stash buffer cho AssetLibraryStore (nhóm B, 2026-11-27):
       map tên file → { buf (bản copy), size, fileName, ext } cho model,
       hoặc { dataUrl, size, fileName } cho image/audio nhẹ (<2MB).
       Store đọc stash này khi nhận bus 'asset:imported' rồi lưu file
       thật vào IndexedDB. Giữ tối đa 20 file gần nhất. */
    _fileBuffers: {}
  };

  Importers._stashBuffer = function (fileName, record) {
    Importers._fileBuffers[fileName] = record;
    var keys = Object.keys(Importers._fileBuffers);
    while (keys.length > 20) delete Importers._fileBuffers[keys.shift()];
  };

  const TYPE_MAP = {
    'glb': 'model', 'gltf': 'model', 'obj': 'model', 'stl': 'model', 'fbx': 'model',
    'mtl': 'mtl',
    'png': 'image', 'jpg': 'image', 'jpeg': 'image', 'webp': 'image', 'svg': 'image', 'gif': 'image',
    'mp3': 'audio', 'wav': 'audio', 'ogg': 'audio',
    'bin': 'bin', 'zip': 'bin'
  };

  Importers.extOf = function (filename) {
    const m = /\.([a-z0-9]+)$/i.exec(filename || '');
    return m ? m[1].toLowerCase() : '';
  };

  Importers.typeOf = function (filename) {
    return TYPE_MAP[Importers.extOf(filename)] || 'unknown';
  };

  /* ---------- IMPORT FILES (từ input/drag-drop) ---------- */
  Importers.importFiles = function (fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return Promise.resolve([]);

    /* .pixistudio.json → load project */
    const projFile = files.find(function (f) { return /\.pixistudio\.json$/i.test(f.name); });
    if (projFile) {
      return PixiStudio.Storage.importProjectFile(projFile).then(function (ok) {
        bus.emit('notify', ok
          ? { type: 'success', title: 'Đã load project', message: projFile.name }
          : { type: 'error', title: 'Load project thất bại', message: projFile.name });
        return [];
      });
    }

    const results = [];
    let chain = Promise.resolve();

    /* Batch context: OBJ tự tra MTL + ảnh đi kèm trong cùng lần import
       (kéo-thả/chọn nhiều file). Tra cứu không phân biệt hoa/thường. */
    const batch = { files: files, byName: {}, fileNames: [] };
    files.forEach(function (f) {
      batch.byName[(f.name || '').toLowerCase()] = f;
      batch.fileNames.push(f.name);
    });

    files.forEach(function (file) {
      chain = chain.then(function () {
        return Importers.importOne(file, batch).then(function (r) {
          results.push(r);
        }).catch(function (err) {
          results.push({ name: file.name, ok: false, error: String(err && err.message || err) });
          bus.emit('notify', { type: 'error', title: 'Import thất bại', message: file.name + ' — ' + (err && err.message || err) });
        });
      });
    });

    return chain.then(function () { return results; });
  };

  Importers.importOne = function (file, batch) {
    const ext = Importers.extOf(file.name);
    const type = TYPE_MAP[ext] || 'unknown';
    const name = file.name.replace(/\.[^.]+$/, '');
    /* Undo/Redo toàn diện (v2): chưa có baseline thì chụp state trước
       khi import — để bước Import đầu tiên undo được về đúng trước đó. */
    if (PixiStudio.History && PixiStudio.History.captureBaseline) PixiStudio.History.captureBaseline();

    if (type === 'model') {
      return U.readFileAsArrayBuffer(file).then(function (buf) {
        /* Stash bản COPY (buf.slice(0)): loader có thể detach/transfer
           ArrayBuffer gốc khi parse, bản copy giữ nguyên để Store lưu
           IndexedDB. Xóa stash sau khi Store đã đọc (trong _onImported). */
        Importers._stashBuffer(file.name, { buf: buf.slice(0), size: file.size, fileName: file.name, ext: ext, type: 'model' });
        if (ext === 'glb' || ext === 'gltf') {
          return PixiStudio.Models.loadGLBFromBuffer(buf, name, file.size);
        } else if (ext === 'fbx') {
          /* kèm batch: FbxImport tự gán texture ngoài đi kèm cùng lần import */
          return PixiStudio.Models.loadFBXFromBuffer(buf, name, file.size, { batch: batch });
        } else if (ext === 'obj') {
          /* kèm batch: model-manager tự tra MTL + ảnh đi kèm */
          return PixiStudio.Models.loadOBJFromBuffer(buf, name, batch
            ? { filesByName: batch.byName, fileNames: batch.fileNames } : null);
        } else {
          return PixiStudio.Models.loadSTLFromBuffer(buf, name);
        }
      }).then(function (entry) {
        /* Thông báo chi tiết khi là FBX: mesh/tris/xương/clip/texture từ fbxReport */
        var detail = U.formatNumber(entry.stats.triangles) + ' tris · ' + U.formatBytes(file.size) +
          (entry.clips && entry.clips.length ? ' · ' + entry.clips.length + ' clip' : '');
        if (entry.fbxReport && PixiStudio.FbxImport) {
          detail = PixiStudio.FbxImport.summarizeReport(entry.fbxReport);
        }
        bus.emit('notify', {
          type: 'success', title: 'Import thành công',
          message: name + ' — ' + detail
        });
        Importers._log(file, 'model');
        bus.emit('asset:imported', { name: file.name, type: 'model', size: file.size });
        /* Undo/Redo toàn diện (v2): import là 1 bước — undo gỡ model khỏi scene */
        if (PixiStudio.History) PixiStudio.History.push('Import ' + file.name);
        return { name: file.name, ok: true, type: 'model' };
      });
    }

    if (type === 'mtl') {
      /* .mtl đi kèm OBJ: OBJ import đã tự đọc từ batch (không phụ thuộc thứ tự file).
         MTL lẻ không có OBJ cùng tên thì chỉ nhắc, không lỗi. */
      const hasObj = batch && batch.files.some(function (f) {
        return Importers.extOf(f.name) === 'obj' &&
          f.name.replace(/\.[^.]+$/, '').toLowerCase() === name.toLowerCase();
      });
      if (hasObj) return Promise.resolve({ name: file.name, ok: true, type: 'mtl', consumed: true });
      bus.emit('notify', {
        type: 'info', title: 'File .mtl',
        message: file.name + ' cần đi kèm file .obj cùng tên — kéo-thả cả hai file cùng lúc.'
      });
      return Promise.resolve({ name: file.name, ok: false, type: 'mtl' });
    }

    if (type === 'image') {
      return U.readFileAsDataURL(file).then(function (dataUrl) {
        /* Stash dataURL chỉ khi file nhẹ (<2MB) để Store lưu IndexedDB. */
        if (file.size < 2 * 1024 * 1024) {
          Importers._stashBuffer(file.name, { dataUrl: dataUrl, size: file.size, fileName: file.name, ext: ext, type: 'image' });
        }
        if (PixiStudio.Textures) {
          PixiStudio.Textures.registerTexture(file.name, dataUrl);
        }
        Importers._log(file, 'image');
        bus.emit('asset:imported', { name: file.name, type: 'image', size: file.size, url: dataUrl });
        bus.emit('notify', { type: 'success', title: 'Đã thêm texture', message: file.name });
        /* Undo/Redo toàn diện (v2): texture vào library là 1 bước */
        if (PixiStudio.History) PixiStudio.History.push('Import texture ' + file.name);
        return { name: file.name, ok: true, type: 'image' };
      });
    }

    if (type === 'audio') {
      return U.readFileAsDataURL(file).then(function (dataUrl) {
        if (file.size < 2 * 1024 * 1024) {
          Importers._stashBuffer(file.name, { dataUrl: dataUrl, size: file.size, fileName: file.name, ext: ext, type: 'audio' });
        }
        Importers._log(file, 'audio');
        bus.emit('asset:imported', { name: file.name, type: 'audio', size: file.size, url: dataUrl });
        bus.emit('notify', { type: 'info', title: 'Đã thêm audio asset', message: file.name + ' — sẵn dùng cho game runtime' });
        /* Undo/Redo toàn diện (v2): audio vào library là 1 bước */
        if (PixiStudio.History) PixiStudio.History.push('Import audio ' + file.name);
        return { name: file.name, ok: true, type: 'audio' };
      });
    }

    bus.emit('notify', {
      type: 'warning', title: 'Định dạng chưa hỗ trợ',
      message: file.name + ' (.' + ext + ') — hỗ trợ: GLB/GLTF/OBJ/STL/FBX/ảnh/audio'
    });
    return Promise.resolve({ name: file.name, ok: false, type: type });
  };

  Importers._log = function (file, type) {
    Importers.imported.unshift({ name: file.name, type: type, size: file.size, at: Date.now() });
    if (Importers.imported.length > 50) Importers.imported.pop();
  };

  /* ---------- DRAG & DROP (toàn app) ---------- */
  Importers.setupDragDrop = function () {
    Importers.bindFileInput(); /* input change phải hoạt động cả khi chưa từng mở dialog */
    const dz = document.getElementById('global-dropzone');
    let dragDepth = 0;

    window.addEventListener('dragenter', function (e) {
      e.preventDefault();
      dragDepth++;
      if (dz) dz.classList.add('active');
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('dragleave', function (e) {
      e.preventDefault();
      dragDepth--;
      if (dragDepth <= 0 && dz) dz.classList.remove('active');
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      dragDepth = 0;
      if (dz) dz.classList.remove('active');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        Importers.importFiles(e.dataTransfer.files);
      }
    });
  };

  /* ---------- HIDDEN FILE INPUT ---------- */
  /* FIX2: bind onchange MỘT LẦN lúc init (không đợi openFileDialog):
     trước đây onchange chỉ được gán trong openFileDialog() nên
     automation (Playwright setInputFiles) hoặc bất kỳ ai set file
     trực tiếp lên #hidden-file-input đều không kích hoạt import. */
  Importers.bindFileInput = function () {
    if (Importers._fileInputBound) return true;
    const input = document.getElementById('hidden-file-input');
    if (!input) return false;
    input.onchange = function () {
      if (input.files && input.files.length) Importers.importFiles(input.files);
    };
    Importers._fileInputBound = true;
    return true;
  };

  Importers.openFileDialog = function () {
    const input = document.getElementById('hidden-file-input');
    if (!input) return;
    Importers.bindFileInput();
    input.value = '';
    input.click();
  };

  /* Bind sớm ngay khi module load (script đặt cuối body nên input
     thường đã có trong DOM); setupDragDrop() gọi lại lúc boot để chắc. */
  try {
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', Importers.bindFileInput);
      else Importers.bindFileInput();
    }
  } catch (e) { /* bind lại ở setupDragDrop */ }

  window.PixiStudio.Importers = Importers;
})();
