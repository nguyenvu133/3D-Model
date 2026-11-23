/* ============================================================
 * assets/importers.js — Pipeline import thật:
 * GLB/GLTF/OBJ/STL model · PNG/JPG/WebP/SVG texture · audio.
 * FBX → trạng thái trung thực (cần converter/fflate runtime).
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Importers = {
    imported: []       // lịch sử import: {name, type, size, at}
  };

  const TYPE_MAP = {
    'glb': 'model', 'gltf': 'model', 'obj': 'model', 'stl': 'model',
    'fbx': 'fbx', 'mtl': 'mtl',
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

    if (type === 'model') {
      return U.readFileAsArrayBuffer(file).then(function (buf) {
        if (ext === 'glb' || ext === 'gltf') {
          return PixiStudio.Models.loadGLBFromBuffer(buf, name, file.size);
        } else if (ext === 'obj') {
          /* kèm batch: model-manager tự tra MTL + ảnh đi kèm */
          return PixiStudio.Models.loadOBJFromBuffer(buf, name, batch
            ? { filesByName: batch.byName, fileNames: batch.fileNames } : null);
        } else {
          return PixiStudio.Models.loadSTLFromBuffer(buf, name);
        }
      }).then(function (entry) {
        bus.emit('notify', {
          type: 'success', title: 'Import thành công',
          message: name + ' — ' + U.formatNumber(entry.stats.triangles) + ' tris · ' + U.formatBytes(file.size)
        });
        Importers._log(file, 'model');
        bus.emit('asset:imported', { name: file.name, type: 'model', size: file.size });
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
        if (PixiStudio.Textures) {
          PixiStudio.Textures.registerTexture(file.name, dataUrl);
        }
        Importers._log(file, 'image');
        bus.emit('asset:imported', { name: file.name, type: 'image', size: file.size, url: dataUrl });
        bus.emit('notify', { type: 'success', title: 'Đã thêm texture', message: file.name });
        return { name: file.name, ok: true, type: 'image' };
      });
    }

    if (type === 'audio') {
      return U.readFileAsDataURL(file).then(function (dataUrl) {
        Importers._log(file, 'audio');
        bus.emit('asset:imported', { name: file.name, type: 'audio', size: file.size, url: dataUrl });
        bus.emit('notify', { type: 'info', title: 'Đã thêm audio asset', message: file.name + ' — sẵn dùng cho game runtime' });
        return { name: file.name, ok: true, type: 'audio' };
      });
    }

    if (type === 'fbx') {
      /* Trung thực: FBXLoader cần fflate — không giả lập */
      bus.emit('notify', {
        type: 'warning', title: 'FBX import chưa khả dụng',
        message: 'FBXLoader cần runtime fflate (bundled). Chuyển FBX → GLB bằng Blender/online rồi import — hoặc chờ v5.1.',
        duration: 7000
      });
      return Promise.resolve({ name: file.name, ok: false, type: 'fbx' });
    }

    bus.emit('notify', {
      type: 'warning', title: 'Định dạng chưa hỗ trợ',
      message: file.name + ' (.' + ext + ') — hỗ trợ: GLB/GLTF/OBJ/STL/ảnh/audio'
    });
    return Promise.resolve({ name: file.name, ok: false, type: type });
  };

  Importers._log = function (file, type) {
    Importers.imported.unshift({ name: file.name, type: type, size: file.size, at: Date.now() });
    if (Importers.imported.length > 50) Importers.imported.pop();
  };

  /* ---------- DRAG & DROP (toàn app) ---------- */
  Importers.setupDragDrop = function () {
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
  Importers.openFileDialog = function () {
    const input = document.getElementById('hidden-file-input');
    if (!input) return;
    input.value = '';
    input.onchange = function () {
      if (input.files && input.files.length) Importers.importFiles(input.files);
    };
    input.click();
  };

  window.PixiStudio.Importers = Importers;
})();
