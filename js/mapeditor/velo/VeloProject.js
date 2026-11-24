/* ============================================================
 * mapeditor/velo/VeloProject.js — Import CẢ THƯ MỤC project Velo
 * + cây project đầy đủ, tự cập nhật.
 *
 * User yêu cầu: import phải có ĐƯỜNG DẪN vào (hiện tên thư mục +
 * số file + nút Import xác nhận), không phải click là vào ngay.
 * Quét đệ quy: assets/scenes/*.scene, assets/prefabs/*.scene,
 * assets/models/*.fbx (+ .meta), *.v, velo.toml, README.
 * Resolve .meta ID → file thật: prefab `from @asset("id")` mở đúng
 * file prefab trong thư mục; SkinnedModel3D load FBX THẬT từ thư
 * mục qua blob URL (không còn chibi placeholder khi file có sẵn).
 *
 * - showDirectoryPicker() (Chromium) giữ directory handle → nút
 *   "Quét lại" + tự quét khi focus + mỗi 10s (so size/mtime).
 *   Fallback <input webkitdirectory>: quét lại = chọn lại thư mục.
 * - Cây project: đúng cấu trúc Velo (scenes/prefabs/models/scripts/
 *   velo.toml). Click .scene → load scene; prefab → chèn vào map;
 *   .v → xem code chỉ-đọc; .fbx → load model vào map.
 * - Scene đang mở đổi trên đĩa → hiện nút "Scene đã đổi — Tải lại",
 *   KHÔNG tự tải lại lặng lẽ khi đang sửa.
 * - KHÔNG chạy code V — chỉ đọc/xem. Trình duyệt không cho đọc
 *   đường dẫn tuyệt đối thật: chỉ hiện tên thư mục + relative path.
 *
 * Core (scan/parse/diff) thuần JS, không cần DOM/THREE — test bằng node.
 * ============================================================ */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  root.MapEditor = root.MapEditor || {};
  var ME = root.MapEditor;

  /* ---------- tiện ích thuần ---------- */
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function formatSize(n) {
    if (n === null || n === undefined) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }
  function parseMeta(text) {
    if (!text) return null;
    var out = { id: null, kind: null, version: null };
    String(text).split(/\r?\n/).forEach(function (line) {
      var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2];
    });
    if (!out.id) return null;
    return out;
  }
  function parseVStructs(text) {
    var out = [];
    var re = /pub\s+struct\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    var m;
    while ((m = re.exec(String(text || '')))) {
      if (out.indexOf(m[1]) < 0) out.push(m[1]);
    }
    return out;
  }
  function parseVFunctions(text) {
    var out = [];
    var re = /pub\s+fn\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)/g;
    var m;
    while ((m = re.exec(String(text || '')))) {
      if (out.indexOf(m[1]) < 0) out.push(m[1]);
    }
    return out;
  }
  function classifyPath(relPath) {
    var p = relPath.replace(/\\/g, '/');
    var lower = p.toLowerCase();
    if (/\.meta$/.test(lower)) return { group: 'meta', kind: 'meta' };
    if (/^assets\/scenes\/.*\.scene$/.test(lower)) return { group: 'scenes', kind: 'scene' };
    if (/^assets\/prefabs\/.*\.scene$/.test(lower)) return { group: 'prefabs', kind: 'prefab' };
    if (/^assets\/models\/.*\.(fbx|glb|gltf|obj)$/.test(lower)) return { group: 'models', kind: 'model' };
    if (/\.scene$/.test(lower)) return { group: 'scenes', kind: 'scene' };
    if (/\.v$/.test(lower)) return { group: 'scripts', kind: 'script' };
    if (/(^|\/)velo\.toml$/.test(lower)) return { group: 'config', kind: 'toml' };
    if (/(^|\/)readme(\.md|\.txt)?$/.test(lower)) return { group: 'config', kind: 'readme' };
    if (/^assets\//.test(lower)) return { group: 'assets', kind: 'asset' };
    return { group: 'other', kind: 'file' };
  }
  function readTextOf(file) {
    /* file thật (File/Blob): .text() là hàm. Fixture test: {_text} hoặc .text là chuỗi. */
    if (!file) return Promise.resolve('');
    if (typeof file.text === 'function') {
      try { return Promise.resolve(file.text()); } catch (e) { return Promise.resolve(''); }
    }
    if (typeof file._text === 'string') return Promise.resolve(file._text);
    if (typeof file.text === 'string') return Promise.resolve(file.text);
    return Promise.resolve('');
  }
  function readArrayBufferOf(file) {
    if (!file) return Promise.resolve(null);
    if (typeof file.arrayBuffer === 'function') {
      try { return Promise.resolve(file.arrayBuffer()); } catch (e) { return Promise.resolve(null); }
    }
    return Promise.resolve(null);
  }

  /* ---------- quét thư mục (async: cần đọc .meta) ----------
   * files: [{name, path (relative, VD assets/scenes/main.scene),
   *   size, lastModified, ...file thật hoặc fixture}]
   * Trả project {name, files{path:entry}, metas{id:path}, scenes,
   * prefabs, models, scripts, configs, signature{path:'size:mtime'},
   * counts}. */
  function scanFiles(files, folderName) {
    var proj = {
      name: folderName || '',
      files: {}, metas: {},
      scenes: [], prefabs: [], models: [], scripts: [], configs: [],
      signature: {}, counts: { total: 0, scenes: 0, prefabs: 0, models: 0, scripts: 0 }
    };
    (files || []).forEach(function (f) {
      var rel = (f._relPath || f.path || f.webkitRelativePath || f.name || '').replace(/\\/g, '/');
      /* bỏ tiền tố tên thư mục gốc của webkitdirectory (VD demo3d/assets/...) */
      var parts = rel.split('/');
      if (parts.length > 1 && folderName && parts[0] === folderName) rel = parts.slice(1).join('/');
      if (!rel) return;
      var c = classifyPath(rel);
      var entry = {
        name: rel.split('/').pop(), path: rel, group: c.group, kind: c.kind,
        size: (f.size === undefined || f.size === null) ? null : f.size,
        mtime: f.lastModified || 0, file: f, metaId: null, metaKind: null, missing: false
      };
      proj.files[rel] = entry;
      proj.signature[rel] = entry.size + ':' + entry.mtime;
    });
    /* đọc .meta (nhỏ) để resolve id → file */
    var metaPaths = Object.keys(proj.files).filter(function (p) { return proj.files[p].kind === 'meta'; });
    var jobs = metaPaths.map(function (mp) {
      return readTextOf(proj.files[mp].file).then(function (text) {
        var meta = parseMeta(text);
        if (!meta) return;
        var target = mp.replace(/\.meta$/, '');
        proj.metas[meta.id] = target;
        if (proj.files[target]) {
          proj.files[target].metaId = meta.id;
          proj.files[target].metaKind = meta.kind;
        }
      });
    });
    return Promise.all(jobs).then(function () {
      Object.keys(proj.files).forEach(function (p) {
        var e = proj.files[p];
        if (e.kind === 'scene') proj.scenes.push(p);
        else if (e.kind === 'prefab') proj.prefabs.push(p);
        else if (e.kind === 'model') proj.models.push(p);
        else if (e.kind === 'script') proj.scripts.push(p);
        else if (e.kind === 'toml' || e.kind === 'readme') proj.configs.push(p);
      });
      [proj.scenes, proj.prefabs, proj.models, proj.scripts, proj.configs].forEach(function (arr) { arr.sort(); });
      proj.counts.total = Object.keys(proj.files).length;
      proj.counts.scenes = proj.scenes.length;
      proj.counts.prefabs = proj.prefabs.length;
      proj.counts.models = proj.models.length;
      proj.counts.scripts = proj.scripts.length;
      return proj;
    });
  }

  function diffSignatures(oldSig, newSig) {
    oldSig = oldSig || {}; newSig = newSig || {};
    var added = [], removed = [], changed = [];
    Object.keys(newSig).forEach(function (p) {
      if (!(p in oldSig)) added.push(p);
      else if (oldSig[p] !== newSig[p]) changed.push(p);
    });
    Object.keys(oldSig).forEach(function (p) {
      if (!(p in newSig)) removed.push(p);
    });
    return { added: added, removed: removed, changed: changed };
  }

  /* Cây hiển thị: [{name, path, kind, children[]}] gom theo thư mục. */
  function buildTree(proj) {
    var rootNode = { name: proj.name || 'Velo Project', path: '', kind: 'root', children: [] };
    var dirs = {};
    function dirNode(path) {
      if (!dirs[path]) {
        var node = { name: path.split('/').pop(), path: path, kind: 'dir', children: [] };
        dirs[path] = node;
        var parentPath = path.split('/').slice(0, -1).join('/');
        if (parentPath) dirNode(parentPath).children.push(node);
        else rootNode.children.push(node);
      }
      return dirs[path];
    }
    Object.keys(proj.files).sort().forEach(function (p) {
      var e = proj.files[p];
      var parentPath = p.split('/').slice(0, -1).join('/');
      var parent = parentPath ? dirNode(parentPath) : rootNode;
      parent.children.push({ name: e.name, path: p, kind: e.kind, entry: e, children: null });
    });
    return rootNode;
  }

  /* ---------- VeloProject (browser + node) ---------- */
  var VeloProject = {
    _inited: false,
    _els: {},
    project: null,
    handle: null,       /* FileSystemDirectoryHandle (Chromium) */
    folderName: '',
    _openScenePath: null,
    _openSceneSig: null,
    _sceneChanged: false,
    _watchTimer: null,
    _lastScanAt: 0,
    _pendingFiles: null /* file chờ xác nhận Import (đã quét, chưa import) */
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function setStatus(msg, isError) {
    var s = VeloProject._els.status;
    if (s) { s.textContent = msg; s.style.color = isError ? '#ff7a7a' : ''; }
    if (ME.MapEditor && ME.MapEditor.setStatus) ME.MapEditor.setStatus(msg);
  }
  function notify(title, msg, type) {
    if (ME.MapEditor && ME.MapEditor.notify) ME.MapEditor.notify(title, msg, type);
    else setStatus(title + ': ' + msg, type === 'error');
  }

  /* ---------- liệt kê thư mục qua handle ---------- */
  function enumerateDir(handle, base) {
    var out = [];
    var jobs = [];
    function iter(h, prefix) {
      if (!h.values) return Promise.resolve();
      var p = h.values();
      function next() {
        return p.next().then(function (r) {
          if (r.done) return;
          var entry = r.value;
          var rel = prefix ? prefix + '/' + entry.name : entry.name;
          if (entry.kind === 'file') {
            jobs.push(entry.getFile().then(function (f) { f._relPath = rel; out.push(f); }));
          } else if (entry.kind === 'directory') {
            jobs.push(iter(entry, rel));
          }
          return next();
        });
      }
      return next();
    }
    return iter(handle, base || '').then(function () { return Promise.all(jobs); }).then(function () { return out; });
  }

  VeloProject.scanFileList = function (files, folderName) {
    return scanFiles(files, folderName);
  };

  /* Đăng ký prefab + model của project vào các module Velo để import
   * resolve đúng file trong thư mục (không fetch GitHub). */
  VeloProject.registerProjectAssets = function (proj) {
    var jobs = [];
    /* prefab: đọc text .scene → cache VeloPrefabLibrary */
    proj.prefabs.forEach(function (p) {
      var entry = proj.files[p];
      if (!entry || !entry.file) return;
      jobs.push(readTextOf(entry.file).then(function (text) {
        if (!text) return;
        if (ME.VeloPrefabLibrary && ME.VeloPrefabLibrary.registerText) {
          var id = entry.metaId;
          if (id) ME.VeloPrefabLibrary.registerText(id, text, 'folder:' + proj.name);
        }
      }));
    });
    /* model: map .meta id → File (blob URL khi load) — bỏ qua file
     * đánh dấu missing (VD model demo3d chỉ có .meta, binary chưa tải). */
    proj.models.forEach(function (p) {
      var entry = proj.files[p];
      if (!entry || !entry.file || entry.missing) return;
      if (entry.metaId && ME.VeloImport && ME.VeloImport.setModelFile) {
        ME.VeloImport.setModelFile(entry.metaId, entry.file);
      }
    });
    return Promise.all(jobs);
  };

  VeloProject.applyProject = function (proj, opts) {
    opts = opts || {};
    VeloProject.project = proj;
    VeloProject.folderName = proj.name || VeloProject.folderName;
    VeloProject._sceneChanged = false;
    return VeloProject.registerProjectAssets(proj).then(function () {
      VeloProject.renderTree();
      VeloProject._updatePathBox();
      if (opts.openMainScene !== false) {
        var main = proj.scenes.indexOf('assets/scenes/main.scene') >= 0
          ? 'assets/scenes/main.scene' : (proj.scenes[0] || null);
        if (main) return VeloProject.openScene(main);
      }
      return proj;
    });
  };

  /* Mở 1 scene trong project làm map hiện tại. */
  VeloProject.openScene = function (relPath) {
    var proj = VeloProject.project;
    if (!proj) return Promise.reject(new Error('chưa mở project Velo'));
    var entry = proj.files[relPath];
    if (!entry || !entry.file) return Promise.reject(new Error('không tìm thấy file ' + relPath));
    setStatus('Đang load scene ' + relPath + '…');
    return readTextOf(entry.file).then(function (text) {
      if (!text) throw new Error('file ' + relPath + ' rỗng');
      VeloProject._openScenePath = relPath;
      VeloProject._openSceneSig = proj.signature[relPath];
      VeloProject._sceneChanged = false;
      if (!ME.VeloImport || !ME.VeloImport.importScene) throw new Error('VeloImport chưa load');
      return ME.VeloImport.importScene(text, { name: entry.name.replace(/\.scene$/i, '') });
    }).then(function (res) {
      setStatus('Đã load scene ' + relPath + ' (' + (res.objects ? res.objects.length : 0) + ' object).');
      VeloProject.renderTree();
      VeloProject._updatePathBox();
      return res;
    }).catch(function (e) {
      setStatus('Load scene lỗi: ' + e.message, true);
      throw e;
    });
  };

  /* Chèn 1 prefab của project vào map (tại tâm camera). */
  VeloProject.insertPrefab = function (relPath) {
    var proj = VeloProject.project;
    if (!proj) return Promise.reject(new Error('chưa mở project Velo'));
    var entry = proj.files[relPath];
    if (!entry || !entry.file) return Promise.reject(new Error('không tìm thấy file ' + relPath));
    return readTextOf(entry.file).then(function (text) {
      if (!text) throw new Error('file prefab rỗng');
      if (!ME.VeloImport || !ME.VeloImport.insertPrefabText) throw new Error('VeloImport chưa load');
      return ME.VeloImport.insertPrefabText(text, { name: entry.name.replace(/\.scene$/i, '') });
    }).then(function (res) {
      notify('Velo Project', 'Đã chèn prefab ' + entry.name + ' (' + (res.objects ? res.objects.length : 0) + ' object).', 'success');
      return res;
    }).catch(function (e) {
      notify('Velo Project', 'Chèn prefab lỗi: ' + e.message, 'error');
      throw e;
    });
  };

  /* Mở file model của project vào map (qua AssetManager thật). */
  VeloProject.openModel = function (relPath) {
    var proj = VeloProject.project;
    if (!proj) return Promise.reject(new Error('chưa mở project Velo'));
    var entry = proj.files[relPath];
    if (!entry || !entry.file) return Promise.reject(new Error('không tìm thấy file ' + relPath));
    if (!ME.AssetManager || !ME.AssetManager.importModelFile) {
      return Promise.reject(new Error('AssetManager chưa load'));
    }
    return ME.AssetManager.importModelFile(entry.file);
  };

  /* Xem file code/config chỉ-đọc (200 dòng đầu + struct parse được). */
  VeloProject.viewCode = function (relPath) {
    var proj = VeloProject.project;
    if (!proj) return Promise.reject(new Error('chưa mở project Velo'));
    var entry = proj.files[relPath];
    if (!entry || !entry.file) return Promise.reject(new Error('không tìm thấy file ' + relPath));
    return readTextOf(entry.file).then(function (text) {
      var lines = String(text || '').split('\n');
      var structs = parseVStructs(text);
      var fns = parseVFunctions(text);
      VeloProject._showCodeViewer(entry, lines.slice(0, 200).join('\n'), lines.length, structs, fns);
      return { lines: lines.length, structs: structs, fns: fns };
    });
  };
  VeloProject._showCodeViewer = function (entry, preview, totalLines, structs, fns) {
    if (typeof document === 'undefined') return;
    var old = document.getElementById('me-velo-code-viewer');
    if (old) old.remove();
    var panel = document.createElement('div');
    panel.id = 'me-velo-code-viewer';
    panel.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);';
    var info = 'Dòng: ' + totalLines + (totalLines > 200 ? ' (hiện 200 dòng đầu)' : '') +
      (structs.length ? ' · struct: ' + structs.join(', ') : '') +
      (fns.length ? ' · fn: ' + fns.slice(0, 8).join(', ') + (fns.length > 8 ? '…' : '') : '') +
      ' · CHỈ ĐỌC — không chạy code V.';
    var pre = document.createElement('pre');
    pre.textContent = preview;
    pre.style.cssText = 'font-size:11px;line-height:1.4;max-height:55vh;overflow:auto;background:rgba(0,0,0,.35);padding:10px;border-radius:6px;white-space:pre-wrap;word-break:break-word;margin:10px 0;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#1e2230;color:#eef1f8;max-width:640px;width:94%;padding:18px 20px;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);';
    var h = document.createElement('h3');
    h.style.cssText = 'margin:0;font-size:16px;';
    h.textContent = '📜 ' + entry.path;
    var inf = document.createElement('p');
    inf.style.cssText = 'margin:6px 0 0;font-size:12px;opacity:.8;';
    inf.textContent = info;
    var close = document.createElement('button');
    close.textContent = 'Đóng';
    close.style.cssText = 'padding:8px 14px;border-radius:8px;border:1px solid #555;background:transparent;color:#eef1f8;cursor:pointer;float:right;';
    close.addEventListener('click', function () { panel.remove(); });
    box.appendChild(h); box.appendChild(inf); box.appendChild(pre); box.appendChild(close);
    panel.appendChild(box);
    panel.addEventListener('click', function (e) { if (e.target === panel) panel.remove(); });
    document.body.appendChild(panel);
  };

  /* ---------- mở thư mục: đường dẫn + xác nhận trước khi import ---------- */
  VeloProject.openFolderPicker = function () {
    if (typeof document === 'undefined') return Promise.reject(new Error('cần trình duyệt'));
    /* Chromium: showDirectoryPicker giữ handle để quét lại sau này */
    if (typeof window.showDirectoryPicker === 'function') {
      return window.showDirectoryPicker().then(function (handle) {
        VeloProject.handle = handle;
        return enumerateDir(handle, '').then(function (files) {
          return VeloProject._stageFiles(files, handle.name);
        });
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return null;
        throw new Error('Mở thư mục lỗi: ' + (e && e.message || e));
      });
    }
    /* Fallback Safari/Firefox: <input webkitdirectory> */
    return new Promise(function (resolve, reject) {
      var input = document.createElement('input');
      input.type = 'file';
      input.setAttribute('webkitdirectory', '');
      input.style.display = 'none';
      input.addEventListener('change', function () {
        var files = Array.prototype.slice.call(input.files || []);
        input.remove();
        if (!files.length) { resolve(null); return; }
        var folderName = (files[0].webkitRelativePath || '').split('/')[0] || 'project';
        VeloProject.handle = null; /* không giữ handle → quét lại = chọn lại thư mục */
        VeloProject._stageFiles(files, folderName).then(resolve, reject);
      });
      document.body.appendChild(input);
      input.click();
    });
  };

  /* Quét xong → HIỆN ĐƯỜNG DẪN + số file, chờ user bấm "Import" mới vào. */
  VeloProject._stageFiles = function (files, folderName) {
    return scanFiles(files, folderName).then(function (proj) {
      VeloProject._pendingFiles = { proj: proj, folderName: folderName };
      VeloProject._showPathConfirm(proj, folderName);
      return proj;
    });
  };
  VeloProject._showPathConfirm = function (proj, folderName) {
    if (typeof document === 'undefined') return;
    var box = VeloProject._els.pathBox;
    if (!box) return;
    box.innerHTML = '';
    var title = el('div', null, '📁 ' + folderName);
    title.style.cssText = 'font-weight:700;';
    box.appendChild(title);
    var summary = el('div', null,
      proj.counts.total + ' file · ' + proj.counts.scenes + ' scene · ' + proj.counts.prefabs +
      ' prefab · ' + proj.counts.models + ' model · ' + proj.counts.scripts + ' script (.v)' +
      (VeloProject.handle ? '' : ' · (trình duyệt này không giữ quyền đọc thư mục — quét lại cần chọn lại)'));
    summary.style.cssText = 'font-size:11px;color:var(--text2);line-height:1.5;';
    box.appendChild(summary);
    var row = el('div');
    row.style.cssText = 'display:flex;gap:6px;margin-top:6px;';
    var importBtn = el('button', 'btn sm primary', '⬇ Import project này');
    importBtn.id = 'velo-proj-confirm';
    importBtn.title = 'Import toàn bộ project Velo này vào Map Editor';
    importBtn.addEventListener('click', function () { VeloProject.confirmImport(); });
    var cancelBtn = el('button', 'btn sm', 'Huỷ');
    cancelBtn.id = 'velo-proj-cancel';
    cancelBtn.addEventListener('click', function () {
      VeloProject._pendingFiles = null;
      VeloProject._updatePathBox();
    });
    row.appendChild(importBtn);
    row.appendChild(cancelBtn);
    box.appendChild(row);
  };
  VeloProject.confirmImport = function () {
    var pending = VeloProject._pendingFiles;
    if (!pending) return Promise.resolve(null);
    VeloProject._pendingFiles = null;
    setStatus('Đang import project Velo "' + pending.folderName + '"…');
    return VeloProject.applyProject(pending.proj, {}).then(function () {
      VeloProject.startWatch();
      notify('Velo Project', 'Đã import project "' + pending.folderName + '" (' + pending.proj.counts.total + ' file).', 'success');
      return pending.proj;
    }).catch(function (e) {
      notify('Velo Project', 'Import project lỗi: ' + e.message, 'error');
      throw e;
    });
  };

  /* ---------- cây project (DOM) ---------- */
  VeloProject.renderTree = function () {
    var host = VeloProject._els.tree;
    if (!host) return;
    host.innerHTML = '';
    var proj = VeloProject.project;
    if (!proj) {
      var hint = el('div', 'ins-hint', 'Chưa mở project Velo nào. Bấm "Mở thư mục project Velo…" ở panel Velo (cột phải) hoặc nút bên dưới.');
      host.appendChild(hint);
      return;
    }
    var tree = buildTree(proj);
    function iconFor(kind) {
      return { root: '📁', dir: '📂', scene: '🎬', prefab: '🧩', model: '🦴', script: '📜', toml: '⚙️', readme: '📄', meta: '🏷️', asset: '📦', file: '📄' }[kind] || '📄';
    }
    function renderNode(node, depth) {
      var row = el('div', 'h-row');
      row.style.paddingLeft = (6 + depth * 12) + 'px';
      var icon = el('span', 'h-icon', iconFor(node.kind));
      var name = el('span', 'h-name', node.name);
      row.appendChild(icon);
      row.appendChild(name);
      if (node.kind === 'dir') {
        row.classList.add('h-group');
        var cnt = el('span', null, '(' + node.children.length + ')');
        cnt.style.cssText = 'color:var(--text3);font-size:11px;';
        row.appendChild(cnt);
        var kids = el('div');
        row.addEventListener('click', function () {
          var hidden = kids.style.display === 'none';
          kids.style.display = hidden ? '' : 'none';
          icon.textContent = hidden ? '📂' : '📁';
        });
        host.appendChild(row);
        host.appendChild(kids);
        node.children.forEach(function (ch) {
          var sub = renderNode(ch, depth + 1);
          kids.appendChild(sub);
        });
        return row;
      }
      var entry = node.entry;
      if (entry) {
        if (entry.metaId) {
          var mid = el('span', null, entry.metaId);
          mid.style.cssText = 'color:var(--text3);font-size:10px;font-family:monospace;';
          mid.title = 'Velo asset ID (.meta)';
          row.appendChild(mid);
        }
        var sz = el('span', null, formatSize(entry.size));
        sz.style.cssText = 'color:var(--text3);font-size:10px;';
        row.appendChild(sz);
        if (VeloProject._openScenePath === entry.path) {
          row.classList.add('selected');
          if (VeloProject._sceneChanged) {
            var badge = el('span', null, '● đã đổi');
            badge.style.cssText = 'color:var(--warn);font-size:10px;';
            row.appendChild(badge);
          }
        }
        row.title = entry.path + (entry.metaId ? ' · ID: ' + entry.metaId : '') +
          (entry.kind === 'scene' ? ' — click để load scene này' :
            entry.kind === 'prefab' ? ' — click để chèn prefab vào map' :
            entry.kind === 'model' ? ' — click để load model vào map' :
            entry.kind === 'script' || entry.kind === 'toml' || entry.kind === 'readme' ? ' — click để xem (chỉ đọc)' : '');
        row.addEventListener('click', function () { VeloProject.onFileClick(entry); });
      }
      host.appendChild(row);
      return row;
    }
    tree.children.forEach(function (ch) { renderNode(ch, 0); });
    /* mục "Chưa lưu" — model import trong phiên, sẽ kèm .meta khi Export Velo */
    var unsaved = VeloProject.getUnsavedModelAssets();
    if (unsaved.length) {
      var uHead = el('div', 'h-row h-group');
      uHead.appendChild(el('span', 'h-icon', '🆕'));
      uHead.appendChild(el('span', 'h-name', 'Chưa lưu vào project (' + unsaved.length + ')'));
      host.appendChild(uHead);
      unsaved.forEach(function (a) {
        var r = el('div', 'h-row');
        r.style.paddingLeft = '18px';
        r.appendChild(el('span', 'h-icon', '🦴'));
        r.appendChild(el('span', 'h-name', a.name));
        var mid = el('span', null, a.metaId);
        mid.style.cssText = 'color:var(--text3);font-size:10px;font-family:monospace;';
        mid.title = 'ID .meta sẽ sinh khi Export Velo';
        r.appendChild(mid);
        host.appendChild(r);
      });
    }
  };

  VeloProject.onFileClick = function (entry) {
    if (!entry) return Promise.resolve(null);
    if (entry.kind === 'scene') return VeloProject.openScene(entry.path);
    if (entry.kind === 'prefab') return VeloProject.insertPrefab(entry.path);
    if (entry.kind === 'model') return VeloProject.openModel(entry.path);
    if (entry.kind === 'script' || entry.kind === 'toml' || entry.kind === 'readme') return VeloProject.viewCode(entry.path);
    return Promise.resolve(null);
  };

  VeloProject._updatePathBox = function () {
    var box = VeloProject._els.pathBox;
    if (!box) return;
    if (VeloProject._pendingFiles) return; /* đang chờ xác nhận Import */
    var proj = VeloProject.project;
    if (!proj) {
      box.innerHTML = '';
      var hint = el('div', null, 'Chưa mở project Velo.');
      hint.style.cssText = 'font-size:11px;color:var(--text2);';
      box.appendChild(hint);
      return;
    }
    box.innerHTML = '';
    var title = el('div', null, '📁 ' + (proj.name || 'Velo Project') + (VeloProject.handle ? ' · đã nối thư mục' : ' · đã quét (chọn lại để quét lại)'));
    title.style.cssText = 'font-weight:700;';
    box.appendChild(title);
    var summary = el('div', null,
      proj.counts.total + ' file · ' + proj.counts.scenes + ' scene · ' + proj.counts.prefabs +
      ' prefab · ' + proj.counts.models + ' model · ' + proj.counts.scripts + ' script (.v)');
    summary.style.cssText = 'font-size:11px;color:var(--text2);line-height:1.5;';
    box.appendChild(summary);
    var row = el('div');
    row.style.cssText = 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;';
    var rescanBtn = el('button', 'btn sm', '🔄 Quét lại');
    rescanBtn.id = 'velo-proj-rescan';
    rescanBtn.title = VeloProject.handle ? 'Quét lại thư mục (giữ handle)' : 'Chọn lại thư mục để quét lại';
    rescanBtn.addEventListener('click', function () { VeloProject.rescan(); });
    row.appendChild(rescanBtn);
    if (VeloProject._sceneChanged && VeloProject._openScenePath) {
      var reloadBtn = el('button', 'btn sm primary', '↻ Scene đã đổi — Tải lại');
      reloadBtn.id = 'velo-proj-reload-scene';
      reloadBtn.title = 'File scene đang mở đã đổi trên đĩa — bấm để tải lại (không tự tải lại khi đang sửa)';
      reloadBtn.addEventListener('click', function () { VeloProject.openScene(VeloProject._openScenePath); });
      row.appendChild(reloadBtn);
    }
    box.appendChild(row);
  };

  /* ---------- tự cập nhật ---------- */
  VeloProject.rescan = function () {
    var proj = VeloProject.project;
    if (!proj) { setStatus('Chưa mở project Velo nào để quét lại.', true); return Promise.resolve(null); }
    if (!VeloProject.handle) {
      /* fallback webkitdirectory: không giữ handle → chọn lại thư mục */
      notify('Velo Project', 'Trình duyệt này không giữ quyền đọc thư mục — bấm "Mở thư mục project Velo…" để chọn lại.', 'warning');
      return VeloProject.openFolderPicker();
    }
    return enumerateDir(VeloProject.handle, '').then(function (files) {
      return scanFiles(files, VeloProject.folderName);
    }).then(function (newProj) {
      var diff = diffSignatures(proj.signature, newProj.signature);
      var changedOpen = VeloProject._openScenePath && diff.changed.indexOf(VeloProject._openScenePath) >= 0;
      VeloProject.project = newProj;
      VeloProject._lastScanAt = Date.now();
      if (changedOpen) {
        /* scene đang mở đã đổi → chỉ gắn cờ, KHÔNG tự tải lại */
        VeloProject._sceneChanged = true;
        VeloProject._openSceneSig = newProj.signature[VeloProject._openScenePath];
        notify('Velo Project', 'Scene đang mở (' + VeloProject._openScenePath + ') đã đổi trên đĩa — bấm "Tải lại" khi sẵn sàng.', 'warning');
      }
      return VeloProject.registerProjectAssets(newProj).then(function () {
        VeloProject.renderTree();
        VeloProject._updatePathBox();
        if (diff.added.length || diff.removed.length || diff.changed.length) {
          setStatus('Quét lại: +' + diff.added.length + ' file mới, −' + diff.removed.length + ' file mất, ~' + diff.changed.length + ' file đổi.');
        } else {
          setStatus('Quét lại: không có thay đổi.');
        }
        return { proj: newProj, diff: diff };
      });
    }).catch(function (e) {
      notify('Velo Project', 'Quét lại lỗi: ' + (e && e.message || e), 'error');
      return null;
    });
  };
  VeloProject.startWatch = function () {
    if (typeof window === 'undefined') return;
    if (VeloProject._watchTimer) return;
    VeloProject._watchTimer = setInterval(function () {
      if (!VeloProject.handle || !VeloProject.project) return;
      if (Date.now() - VeloProject._lastScanAt < 9000) return;
      VeloProject.rescan();
    }, 10000);
    window.addEventListener('focus', function () {
      if (!VeloProject.handle || !VeloProject.project) return;
      if (Date.now() - VeloProject._lastScanAt < 5000) return;
      VeloProject.rescan();
    });
  };

  /* ---------- cây demo3d qua GitHub (giữ nút Import demo3d cũ) ---------- */
  VeloProject.showDemoTree = function () {
    var DEMO_URL = (ME.VeloImport && ME.VeloImport.DEMO_URL) ||
      'https://raw.githubusercontent.com/velo-engine/velo/3d/examples/demo3d/assets/scenes/main.scene';
    setStatus('Đang tải cây demo3d Velo…');
    return fetch(DEMO_URL).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (mainText) {
      var files = [{ name: 'main.scene', path: 'assets/scenes/main.scene', size: mainText.length, lastModified: 0, _text: mainText }];
      var lib = ME.VeloPrefabLibrary;
      if (lib && lib.REGISTRY) {
        lib.REGISTRY.forEach(function (r) {
          var cached = lib.getCachedText ? lib.getCachedText(r.id) : null;
          files.push({
            name: r.file, path: 'assets/prefabs/' + r.file,
            size: cached ? cached.length : null, lastModified: 0,
            _text: cached || ''
          });
          files.push({
            name: r.file + '.meta', path: 'assets/prefabs/' + r.file + '.meta',
            size: null, lastModified: 0,
            _text: 'id: ' + r.id + '\nkind: scene\nversion: 1\n'
          });
        });
      }
      files.push({ name: 'main.scene.meta', path: 'assets/scenes/main.scene.meta', size: null, lastModified: 0, _text: 'id: ' + fnv1a('main.scene') + '\nkind: scene\nversion: 1\n' });
      files.push({ name: 'than_dieu_run.fbx', path: 'assets/models/than_dieu_run.fbx', size: null, lastModified: 0, _text: '' });
      files.push({ name: 'than_dieu_run.fbx.meta', path: 'assets/models/than_dieu_run.fbx.meta', size: null, lastModified: 0, _text: 'id: a3d0f8b1\nkind: model\nversion: 1\n' });
      return scanFiles(files, 'demo3d (GitHub)');
    }).then(function (proj) {
      /* model demo chỉ có .meta — file binary chưa tải: đánh dấu để cây hiện rõ */
      if (proj.files['assets/models/than_dieu_run.fbx']) {
        proj.files['assets/models/than_dieu_run.fbx'].missing = true;
      }
      VeloProject.project = proj;
      VeloProject.folderName = 'demo3d (GitHub)';
      VeloProject.handle = null;
      VeloProject.renderTree();
      VeloProject._updatePathBox();
      setStatus('Cây demo3d: ' + proj.counts.total + ' file (model FBX chưa tải — dùng file local models/thandieu/).');
      return proj;
    }).catch(function (e) {
      setStatus('Tải cây demo3d lỗi: ' + e.message, true);
      return null;
    });
  };

  /* ---------- asset import trong phiên (chưa lưu) → Export Velo ---------- */
  VeloProject.getUnsavedModelAssets = function () {
    var out = [];
    if (!ME.AssetManager || !ME.AssetManager.listAssets) return out;
    ME.AssetManager.listAssets().forEach(function (a) {
      if (a.source !== 'import') return;
      /* tên file thật: giữ nguyên đuôi model (.glb/.fbx/.gltf/.obj);
       * chỉ thêm .fbx khi tên chưa có đuôi (VD model procedural). */
      var fileName = a.fileName || a.name || a.id;
      if (!/\.(fbx|glb|gltf|obj)$/i.test(fileName)) fileName += '.fbx';
      var metaId = (ME.VeloExport && ME.VeloExport.assetIdFor)
        ? ME.VeloExport.assetIdFor(fileName) : fnv1a(fileName);
      out.push({ id: a.id, name: a.name, fileName: fileName, metaId: metaId });
    });
    return out;
  };

  /* ---------- panel (DOM) ---------- */
  VeloProject.init = function () {
    if (VeloProject._inited) return true;
    if (typeof document === 'undefined') return false;
    var left = document.getElementById('me-left');
    if (!left) return false;
    VeloProject._inited = true;

    var head = el('div', 'panel-head', '📁 Velo Project');
    var body = el('div', 'panel-body');
    body.style.cssText = 'flex:none;max-height:320px;';
    var inner = el('div');
    inner.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:2px;';

    var pathBox = el('div');
    pathBox.id = 'me-velo-project-path';
    inner.appendChild(pathBox);

    var openBtn = el('button', 'btn sm primary', '📁 Mở thư mục project Velo…');
    openBtn.title = 'Chọn thư mục project Velo (showDirectoryPicker / webkitdirectory) — hiện đường dẫn + số file rồi mới Import';
    openBtn.style.textAlign = 'left';
    openBtn.addEventListener('click', function () {
      VeloProject.openFolderPicker().catch(function (e) {
        setStatus('Mở thư mục lỗi: ' + e.message, true);
      });
    });
    inner.appendChild(openBtn);

    var tree = el('div');
    tree.id = 'me-velo-project-tree';
    inner.appendChild(tree);

    var status = el('div', null, 'Chưa mở project Velo.');
    status.id = 'me-velo-project-status';
    status.style.cssText = 'font-size:11px;line-height:1.4;min-height:16px;';
    inner.appendChild(status);

    body.appendChild(inner);
    left.appendChild(head);
    left.appendChild(body);
    /* bọc thành section thu gọn như các panel khác (mặc định mở) */
    if (ME.MapEditor && ME.MapEditor.wrapPanelSection) {
      ME.MapEditor.wrapPanelSection(head, body, 'velo-project', true);
    }
    VeloProject._els = { pathBox: pathBox, tree: tree, status: status };
    VeloProject._updatePathBox();
    VeloProject.renderTree();
    /* Cây tự cập nhật khi asset trong editor đổi (import GLB/FBX vào
     * map → mục "Chưa lưu"): hook AssetManager.render — được gọi bởi
     * register/unregister lẫn MapEditor._emitNow (debounce 80ms). */
    try {
      if (ME.AssetManager && ME.AssetManager.render && !ME.AssetManager._veloTreeHook) {
        ME.AssetManager._veloTreeHook = true;
        var _amRender = ME.AssetManager.render;
        ME.AssetManager.render = function () {
          var r = _amRender.apply(this, arguments);
          if (VeloProject._inited) { try { VeloProject.renderTree(); } catch (e) { /* cây lỗi thì asset vẫn render */ } }
          return r;
        };
      }
    } catch (e) { /* hook lỗi thì cây chỉ cập nhật khi rescan/import */ }
    return true;
  };

  ME.VeloProject = VeloProject;
  ME.VeloProject._internals = {
    fnv1a: fnv1a, formatSize: formatSize, parseMeta: parseMeta,
    parseVStructs: parseVStructs, parseVFunctions: parseVFunctions,
    classifyPath: classifyPath, scanFiles: scanFiles,
    diffSignatures: diffSignatures, buildTree: buildTree
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ME.VeloProject;
  }
})();
