/* ============================================================
 * mapeditor/editor/AssetManager.js — Asset Manager (dưới)
 * Thẻ asset wuxia với thumbnail vẽ bằng canvas 2D (theo hình
 * prefab). Click = chế độ đặt (ghost theo chuột, click để đặt),
 * kéo-thả vào viewport cũng đặt được. Lọc theo category, tìm
 * kiếm, Import GLB (GLTFLoader) + card Thần Điêu.
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  var AssetManager = {
    _grid: null,
    _filter: 'All',
    _search: '',
    _registry: {},       /* id -> asset {id, name, kind, source, type, veloId?, fileName?} */
    _order: [],          /* id theo thứ tự đăng ký */
    _loadedModels: {},   /* id -> THREE.Group đã load (import GLB/FBX/OBJ) */
    _importInput: null
  };

  /* ---------- registry thật: prefab built-in + file import + Velo ---------- */
  AssetManager.registerAsset = function (asset) {
    asset = asset || {};
    if (!asset.id) asset.id = 'asset_' + (AssetManager._order.length + 1) + '_' + Math.floor(Math.random() * 1296).toString(36);
    asset.name = asset.name || asset.type || asset.id;
    asset.kind = asset.kind || 'Props';
    asset.source = asset.source || 'builtin';
    if (!AssetManager._registry[asset.id]) AssetManager._order.push(asset.id);
    AssetManager._registry[asset.id] = asset;
    AssetManager.render();
    return asset;
  };
  AssetManager.unregisterAsset = function (id) {
    if (!AssetManager._registry[id]) return false;
    delete AssetManager._registry[id];
    var i = AssetManager._order.indexOf(id);
    if (i >= 0) AssetManager._order.splice(i, 1);
    delete AssetManager._loadedModels[id];
    AssetManager.render();
    return true;
  };
  AssetManager.getAsset = function (id) { return AssetManager._registry[id] || null; };
  AssetManager.listAssets = function () {
    return AssetManager._order.map(function (id) { return AssetManager._registry[id]; });
  };
  AssetManager.getLoadedModel = function (id) { return AssetManager._loadedModels[id] || null; };
  AssetManager.assetCount = function () { return AssetManager._order.length; };

  AssetManager.init = function (gridEl, filterEl, searchEl) {
    AssetManager._grid = gridEl;
    if (filterEl) {
      /* thêm lựa chọn lọc cho asset nhập / Velo (không sửa HTML) */
      ['Model', 'Velo'].forEach(function (k) {
        var has = false;
        for (var i = 0; i < filterEl.options.length; i++) if (filterEl.options[i].value === k) has = true;
        if (!has) {
          var op = document.createElement('option');
          op.value = k; op.textContent = k === 'Model' ? 'Model nhập' : 'Velo';
          filterEl.appendChild(op);
        }
      });
      filterEl.addEventListener('change', function () {
        AssetManager._filter = filterEl.value;
        AssetManager.render();
      });
    }
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        AssetManager._search = searchEl.value.trim().toLowerCase();
        AssetManager.render();
      });
    }
    /* đăng ký prefab built-in vào registry */
    if (ME.Placement && ME.Placement.ASSET_LIST) {
      ME.Placement.ASSET_LIST.forEach(function (a) {
        AssetManager.registerAsset({
          id: 'builtin:' + a.type, name: a.name, kind: a.cat,
          source: 'builtin', type: a.type
        });
      });
    }
    /* nút + input Import GLB/FBX/OBJ (thêm bằng JS, không sửa HTML) */
    var head = gridEl ? gridEl.parentElement : null;
    if (head) {
      var btn = document.createElement('button');
      btn.className = 'btn sm';
      btn.textContent = '＋ Import GLB / FBX / OBJ';
      btn.title = 'Import model 3D vào map (GLB, FBX, OBJ)';
      btn.addEventListener('click', function () {
        if (AssetManager._importInput) AssetManager._importInput.click();
      });
      var headBar = head.querySelector('#me-bottom-head');
      if (headBar) headBar.appendChild(btn);
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.glb,.gltf,.fbx,.obj';
      inp.style.display = 'none';
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        if (f) AssetManager.importModelFile(f).catch(function (e) {
          if (ME.MapEditor) ME.MapEditor.notify('Import model lỗi', e.message, 'error');
        });
        inp.value = '';
      });
      head.appendChild(inp);
      AssetManager._importInput = inp;
    }
    AssetManager.render();
  };

  /* vẽ thumbnail 2D đơn giản theo loại prefab */
  function drawThumb(canvas, type) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#1a2233';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2a3550';
    ctx.fillRect(0, H - 16, W, 16);
    ctx.lineWidth = 2;
    function poly(points, fill, stroke) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (var i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
    }
    var cx = W / 2;
    if (type === 'temple') {
      poly([[cx - 34, 34], [cx + 34, 34], [cx, 14]], '#1e4d3a', '#0d2a1e');
      poly([[cx - 40, 40], [cx + 40, 40], [cx + 28, 30], [cx - 28, 30]], '#1e4d3a', '#0d2a1e');
      ctx.fillStyle = '#8a2f26'; ctx.fillRect(cx - 22, 40, 44, 22);
      ctx.fillStyle = '#c9a94f'; ctx.fillRect(cx - 5, 48, 10, 14);
    } else if (type === 'house') {
      poly([[cx - 28, 36], [cx + 28, 36], [cx, 18]], '#1e4d3a', '#0d2a1e');
      ctx.fillStyle = '#7a4a2e'; ctx.fillRect(cx - 22, 36, 44, 22);
      ctx.fillStyle = '#ffc86e'; ctx.fillRect(cx - 14, 44, 8, 8); ctx.fillRect(cx + 6, 44, 8, 8);
    } else if (type === 'gate') {
      ctx.fillStyle = '#6e3f2a';
      ctx.fillRect(cx - 30, 20, 7, 42); ctx.fillRect(cx + 23, 20, 7, 42);
      ctx.fillStyle = '#1e4d3a'; ctx.fillRect(cx - 34, 14, 68, 8);
      poly([[cx - 30, 14], [cx + 30, 14], [cx, 2]], '#1e4d3a', '#0d2a1e');
    } else if (type === 'pine') {
      ctx.fillStyle = '#4a3220'; ctx.fillRect(cx - 3, 48, 6, 14);
      poly([[cx - 18, 50], [cx + 18, 50], [cx, 28]], '#1d4a2e', '#0d2a1e');
      poly([[cx - 13, 34], [cx + 13, 34], [cx, 16]], '#25603a', '#0d2a1e');
      poly([[cx - 8, 20], [cx + 8, 20], [cx, 8]], '#e8eef7', '#b8c8d8');
    } else if (type === 'bamboo') {
      ctx.strokeStyle = '#4a8a3a'; ctx.lineWidth = 4;
      for (var b = -2; b <= 2; b++) {
        ctx.beginPath(); ctx.moveTo(cx + b * 10, 62); ctx.lineTo(cx + b * 10, 14 + Math.abs(b) * 4); ctx.stroke();
      }
    } else if (type === 'rock') {
      poly([[cx - 22, 56], [cx - 14, 34], [cx + 4, 26], [cx + 22, 44], [cx + 16, 56]], '#8a8a94', '#5a5a64');
      poly([[cx - 14, 34], [cx + 4, 26], [cx + 10, 36]], '#e8eef7', '#b8c8d8');
    } else if (type === 'lantern') {
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, 8); ctx.lineTo(cx, 30); ctx.stroke();
      ctx.fillStyle = '#ff5a3c';
      ctx.beginPath(); ctx.ellipse(cx, 40, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffb347';
      ctx.beginPath(); ctx.ellipse(cx, 40, 12, 14, 0, 0, Math.PI * 2); ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
    } else if (type === 'campfire') {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(cx - 16, 54, 32, 6);
      poly([[cx - 8, 54], [cx + 8, 54], [cx, 30]], '#ff8a2a', '#cc4400');
      poly([[cx - 4, 54], [cx + 4, 54], [cx, 40]], '#ffd94d', '#cc8800');
    } else if (type === 'bridge') {
      ctx.fillStyle = '#7d5a34';
      for (var p = 0; p < 5; p++) ctx.fillRect(cx - 30 + p * 12, 44 - Math.abs(p - 2) * 3, 10, 5);
      ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 30, 40); ctx.lineTo(cx + 30, 40); ctx.stroke();
      ctx.fillStyle = '#3a7ab5'; ctx.fillRect(0, 56, W, 8);
    } else if (type === 'portal') {
      ctx.strokeStyle = '#9d4edd'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(cx, 38, 18, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#6a1fb0';
      ctx.beginPath(); ctx.arc(cx, 38, 13, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'statue') {
      ctx.fillStyle = '#7a7264'; ctx.fillRect(cx - 16, 54, 32, 8);
      ctx.fillStyle = '#9aa4b5'; ctx.fillRect(cx - 7, 30, 14, 24);
      ctx.beginPath(); ctx.arc(cx, 24, 8, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'hero' || type === 'monster' || type === 'boss') {
      var col = type === 'hero' ? '#8a2f26' : (type === 'boss' ? '#5a1a6a' : '#3a5a3a');
      ctx.fillStyle = '#f2c89b';
      ctx.beginPath(); ctx.arc(cx, 24, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.fillRect(cx - 10, 34, 20, 18);
      ctx.fillStyle = '#2c3a58';
      ctx.fillRect(cx - 9, 52, 7, 10); ctx.fillRect(cx + 2, 52, 7, 10);
      if (type === 'boss') { ctx.fillStyle = '#e8e8f2'; ctx.beginPath(); ctx.arc(cx, 14, 10, Math.PI, 0); ctx.fill(); }
    } else if (type === 'light') {
      ctx.fillStyle = '#ffd94d';
      ctx.beginPath(); ctx.arc(cx, 32, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffd94d'; ctx.lineWidth = 2;
      for (var r = 0; r < 8; r++) {
        var a = r / 8 * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 14, 32 + Math.sin(a) * 14);
        ctx.lineTo(cx + Math.cos(a) * 20, 32 + Math.sin(a) * 20);
        ctx.stroke();
      }
    } else if (type === 'waterfall') {
      ctx.fillStyle = '#6a6a74';
      poly([[cx - 24, 56], [cx - 18, 16], [cx + 18, 16], [cx + 24, 56]], '#6a6a74', '#4a4a54');
      ctx.fillStyle = '#7ac8e8'; ctx.fillRect(cx - 6, 16, 12, 40);
      ctx.fillStyle = '#e8f4f8'; ctx.beginPath(); ctx.ellipse(cx, 58, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'patrol') {
      ctx.strokeStyle = '#ffd94d'; ctx.lineWidth = 3; ctx.setLineDash([5, 4]);
      ctx.strokeRect(cx - 24, 14, 48, 36);
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd94d';
      [[-24, 14], [24, 14], [24, 50], [-24, 50]].forEach(function (pt) {
        ctx.beginPath(); ctx.arc(cx + pt[0], pt[1], 4, 0, Math.PI * 2); ctx.fill();
      });
    } else if (type === 'fence') {
      ctx.fillStyle = '#6b4a2a';
      for (var f = 0; f < 5; f++) ctx.fillRect(cx - 28 + f * 14, 30, 5, 26);
      ctx.fillRect(cx - 30, 38, 60, 4);
    } else if (type === 'torii') {
      ctx.fillStyle = '#b02020';
      ctx.fillRect(cx - 28, 22, 7, 40); ctx.fillRect(cx + 21, 22, 7, 40);
      ctx.fillRect(cx - 34, 14, 68, 7);
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(cx - 38, 8, 76, 6);
      ctx.fillStyle = '#c9a94f'; ctx.fillRect(cx - 3, 12, 6, 8);
    } else if (type === 'well') {
      ctx.fillStyle = '#8a8a94'; ctx.fillRect(cx - 20, 44, 40, 16);
      ctx.fillStyle = '#2a5a7a'; ctx.fillRect(cx - 16, 44, 32, 5);
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(cx - 22, 22, 5, 24); ctx.fillRect(cx + 17, 22, 5, 24);
      poly([[cx - 26, 24], [cx + 26, 24], [cx, 8]], '#1e4d3a', '#0d2a1e');
    } else if (type === 'tower') {
      ctx.fillStyle = '#8a2f26'; ctx.fillRect(cx - 14, 38, 28, 24);
      poly([[cx - 22, 40], [cx + 22, 40], [cx, 24]], '#1e4d3a', '#0d2a1e');
      ctx.fillStyle = '#7a4a2e'; ctx.fillRect(cx - 9, 16, 18, 10);
      poly([[cx - 15, 18], [cx + 15, 18], [cx, 6]], '#1e4d3a', '#0d2a1e');
      ctx.fillStyle = '#ffd94d'; ctx.beginPath(); ctx.arc(cx, 4, 3, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'model') {
      ctx.fillStyle = '#713bff';
      ctx.fillRect(cx - 16, 20, 32, 32);
      ctx.fillStyle = '#4a2a8a'; ctx.fillRect(cx - 20, 52, 40, 6);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 11px monospace';
      ctx.fillText('3D', cx - 8, 40);
    } else {
      ctx.fillStyle = '#7a7a94';
      if (type === 'sphere') { ctx.beginPath(); ctx.arc(cx, 36, 16, 0, Math.PI * 2); ctx.fill(); }
      else if (type === 'cylinder') { ctx.fillRect(cx - 12, 20, 24, 32); }
      else if (type === 'cone') { poly([[cx - 18, 52], [cx + 18, 52], [cx, 18]], '#7a7a94', '#4a4a64'); }
      else ctx.fillRect(cx - 16, 20, 32, 32);
    }
  }

  AssetManager.render = function () {
    var g = AssetManager._grid;
    if (!g) return;
    g.innerHTML = '';
    var list = AssetManager.listAssets().filter(function (a) {
      if (AssetManager._filter !== 'All') {
        /* kind 'Velo' lọc theo source, còn lại lọc theo kind/cat */
        if (AssetManager._filter === 'Velo') { if (a.source !== 'velo') return false; }
        else if (a.kind !== AssetManager._filter) return false;
      }
      if (AssetManager._search && a.name.toLowerCase().indexOf(AssetManager._search) < 0 &&
          (a.type || '').indexOf(AssetManager._search) < 0) return false;
      return true;
    });
    /* đếm số asset (hiển thị ở đầu grid) */
    var count = document.createElement('div');
    count.className = 'asset-count';
    count.textContent = list.length + ' / ' + AssetManager._order.length + ' assets' +
      (AssetManager._filter !== 'All' ? ' · lọc: ' + AssetManager._filter : '') +
      (AssetManager._search ? ' · tìm: "' + AssetManager._search + '"' : '');
    g.appendChild(count);
    list.forEach(function (a) {
      var card = document.createElement('div');
      card.className = 'asset-card';
      card.draggable = true;
      var srcLabel = a.source === 'velo' ? 'Velo' : (a.source === 'import' ? 'Import' : 'Built-in');
      card.title = a.name + ' (' + srcLabel + ')' + (a.veloId ? ' · Velo ID: ' + a.veloId : '') + ' — click để đặt, hoặc kéo vào viewport';
      var cv = document.createElement('canvas');
      cv.width = 96; cv.height = 72;
      cv.className = 'asset-thumb';
      drawThumb(cv, a.type || 'model');
      card.appendChild(cv);
      var nm = document.createElement('div');
      nm.className = 'asset-name';
      nm.textContent = a.name;
      card.appendChild(nm);
      if (a.source !== 'builtin') {
        var badge = document.createElement('div');
        badge.className = 'asset-badge';
        badge.textContent = srcLabel;
        card.appendChild(badge);
      }
      card.addEventListener('click', function () {
        if (!ME.MapEditor) return;
        if (a.source === 'import') ME.MapEditor.placeImportedModel(a.id);
        else if (a.source === 'velo' && a.type) ME.MapEditor.startPlacement(a.type);
        else ME.MapEditor.startPlacement(a.type);
      });
      card.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', a.source === 'import' ? 'asset:import:' + a.id : 'asset:' + a.type);
        e.dataTransfer.effectAllowed = 'copy';
      });
      g.appendChild(card);
    });
    if (!list.length) {
      var none = document.createElement('div');
      none.className = 'asset-none';
      none.textContent = 'Không có asset nào khớp.';
      g.appendChild(none);
    }
  };

  /* ---------- import GLB / FBX / OBJ vào map ---------- */
  function ensureOBJLoader() {
    if (window.THREE && THREE.OBJLoader) return Promise.resolve(true);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js';
      s.onload = function () { resolve(!!(window.THREE && THREE.OBJLoader)); };
      s.onerror = function () { reject(new Error('Không tải được OBJLoader (cần mạng CDN)')); };
      document.head.appendChild(s);
    });
  }
  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Không đọc được file')); };
      r.readAsArrayBuffer(file);
    });
  }
  AssetManager.importModelFile = function (file) {
    var name = (file.name || '').toLowerCase();
    var ext = name.indexOf('.glb') >= 0 || name.indexOf('.gltf') >= 0 ? 'glb'
      : name.indexOf('.fbx') >= 0 ? 'fbx'
      : name.indexOf('.obj') >= 0 ? 'obj' : null;
    if (!ext) return Promise.reject(new Error('Chỉ hỗ trợ .glb / .gltf / .fbx / .obj'));
    var needLoader = ext === 'glb' ? (window.THREE && THREE.GLTFLoader)
      : ext === 'fbx' ? (window.THREE && THREE.FBXLoader) : null;
    if (ext === 'obj') needLoader = true; /* OBJLoader tải động bên dưới */
    if (!needLoader) {
      return Promise.reject(new Error(ext === 'glb' ? 'GLTFLoader chưa load (cần mạng CDN).' : 'FBXLoader chưa load (cần mạng CDN).'));
    }
    var loadJob = ext === 'obj' ? ensureOBJLoader().then(function () { return readFileAsArrayBuffer(file); })
      : readFileAsArrayBuffer(file);
    return loadJob.then(function (buf) {
      return new Promise(function (resolve, reject) {
        try {
          if (ext === 'glb') {
            var gl = new THREE.GLTFLoader();
            if (gl.parse) gl.parse(buf, '', function (gltf) { resolve(gltf.scene || gltf); }, function (e) { reject(e || new Error('parse GLB lỗi')); });
            else reject(new Error('GLTFLoader.parse không có (cần GLTFLoader r128 đầy đủ)'));
          } else if (ext === 'fbx') {
            var fl = new THREE.FBXLoader();
            if (fl.parse) resolve(fl.parse(buf, ''));
            else reject(new Error('FBXLoader.parse không có'));
          } else {
            var ol = new THREE.OBJLoader();
            var text = new TextDecoder().decode(buf);
            resolve(ol.parse(text));
          }
        } catch (e) { reject(e); }
      });
    }).then(function (root) {
      var id = 'import:' + file.name.replace(/[^\w\-.]+/g, '_') + '_' + Date.now().toString(36);
      root.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      AssetManager._loadedModels[id] = root;
      var asset = AssetManager.registerAsset({
        id: id, name: file.name.replace(/\.(glb|gltf|fbx|obj)$/i, ''),
        kind: 'Model', source: 'import', type: 'model', fileName: file.name
      });
      if (ME.MapEditor) ME.MapEditor.notify('Import model', 'Đã import "' + file.name + '" — click thẻ để đặt vào map.', 'success');
      return asset;
    });
  };

  ME.AssetManager = AssetManager;
})();
