/* ============================================================
 * scene/scene-streaming.js — Scene Streaming (open world)
 *
 * Chia scene thành chunk/vùng theo lưới (mặt phẳng XZ), load/unload
 * chunk theo vị trí camera (mặc định) hoặc object focus:
 *   - chunk trong bán kính load -> hiện (add lại vào scene)
 *   - chunk xa hơn bán kính unload -> gỡ khỏi scene graph nhưng
 *     GIỮ object3D + metadata nhẹ (uuid/tên/loại/vị trí) trong
 *     chunk store để load lại ngay, không mất object.
 *   - hysteresis: ngưỡng unload luôn xa hơn ngưỡng load ít nhất
 *     1 chunk, chống nhấp nháy load/unload liên tục ở biên.
 *
 * KHÔNG sửa scene-manager.js: chỉ đọc PixiStudio.Scene.registry
 * (public) + PixiStudio.Viewport.scene / orbit.camera.
 *
 * Giới hạn thật (ghi rõ, không giấu):
 *   - unload chỉ gỡ khỏi scene graph (hết draw call / raycast /
 *     cập nhật matrix) — geometry/material KHÔNG dispose nên bộ nhớ
 *     GPU chưa giải phóng; đổi lại load lại là tức thì và model có
 *     rig/skin không bị hỏng. Muốn giải phóng GPU thật thì cần vòng
 *     riêng (rebuild primitive từ serialize + dispose có chọn lọc).
 *   - chunk tính theo vị trí WORLD trên mặt XZ; object con (child
 *     của model khác) đi theo chunk của object cha đã đăng ký.
 *   - object không có vị trí hợp lệ (NaN) bị xếp vào chunk (0,0)
 *     và được báo qua SceneValidate thay vì ở đây.
 * ============================================================ */
(function () {
  'use strict';

  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };
  var U = (window.PixiStudio && PixiStudio.Utils) || null;

  function el(tag, attrs, children) {
    if (U && U.el) return U.el(tag, attrs, children);
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  var Streaming = {
    config: {
      enabled: false,
      chunkSize: 10,       // mét / chunk (cạnh ô vuông trên mặt XZ)
      loadDistance: 25,    // mét: chunk có tâm trong khoảng này (tính theo ô) thì load
      unloadDistance: 40,  // mét: chunk xa hơn khoảng này thì unload (phải > loadDistance)
      focus: 'camera',     // 'camera' | 'player' (object focus)
      focusObjectUuid: null,
      updateIntervalMs: 250
    },
    /* chunkKey -> { key, cx, cz, loaded, objects: [{ uuid, name, type, object3D, position:[x,y,z] }] } */
    chunks: {},
    /* uuid -> chunkKey (tra cứu nhanh) */
    objectChunk: {},
    lastFocusChunk: null,
    lastUpdateAt: 0,
    _renderLoopAttached: false,
    _panelEl: null
  };

  /* ---------- helpers ---------- */
  Streaming.chunkKeyFor = function (x, z) {
    var cs = Streaming.config.chunkSize || 10;
    return Math.floor(x / cs) + ',' + Math.floor(z / cs);
  };

  Streaming.chunkCoords = function (key) {
    var p = String(key).split(',');
    return { cx: parseInt(p[0], 10) || 0, cz: parseInt(p[1], 10) || 0 };
  };

  /* Khoảng cách (theo số ô Chebyshev) từ ô focus tới ô chunk. Dùng
   * Chebyshev để vùng load là hình vuông quanh focus — khớp lưới. */
  Streaming.chunkDistanceCells = function (cx, cz, fx, fz) {
    return Math.max(Math.abs(cx - fx), Math.abs(cz - fz));
  };

  Streaming.loadRadiusCells = function () {
    return Math.ceil((Streaming.config.loadDistance || 25) / (Streaming.config.chunkSize || 10));
  };

  Streaming.unloadRadiusCells = function () {
    var cs = Streaming.config.chunkSize || 10;
    var loadR = Streaming.loadRadiusCells();
    var unloadR = Math.ceil((Streaming.config.unloadDistance || 40) / cs);
    /* hysteresis: unload xa hơn load ít nhất 1 ô */
    if (unloadR <= loadR) unloadR = loadR + 1;
    return unloadR;
  };

  Streaming.estimateGeometryBytes = function (obj) {
    if (!obj) return 0;
    var bytes = 0;
    try {
      obj.traverse(function (o) {
        if (!o.isMesh || !o.geometry) return;
        var g = o.geometry;
        if (g.attributes) {
          Object.keys(g.attributes).forEach(function (name) {
            var attr = g.attributes[name];
            if (attr && attr.array) bytes += attr.array.byteLength || attr.array.length * 4;
          });
        }
        if (g.index && g.index.array) bytes += g.index.array.byteLength || g.index.array.length * 2;
      });
    } catch (e) { /* geometry lạ — bỏ qua, vẫn đếm 0 */ }
    return bytes;
  };

  function registryEntries() {
    if (!PixiStudio.Scene || !PixiStudio.Scene.registry) return [];
    return Object.keys(PixiStudio.Scene.registry).map(function (uuid) {
      return PixiStudio.Scene.registry[uuid];
    });
  }

  function worldPosOf(obj) {
    var v = null;
    try {
      if (obj.getWorldPosition) {
        v = obj.getWorldPosition(new THREE.Vector3());
      }
    } catch (e) { v = null; }
    if (!v || !isFinite(v.x) || !isFinite(v.z)) {
      /* fallback: vị trí local (object gắn trực tiếp vào scene) */
      v = new THREE.Vector3(obj.position ? obj.position.x || 0 : 0,
        obj.position ? obj.position.y || 0 : 0,
        obj.position ? obj.position.z || 0 : 0);
    }
    return v;
  }

  function sceneRoot() {
    return PixiStudio.Viewport && PixiStudio.Viewport.scene;
  }

  /* ---------- build / rebuild ---------- */
  /* Quét registry, gán mỗi object vào chunk theo vị trí world hiện tại.
   * Object nào đang ở trong scene thì chunk của nó coi là loaded;
   * object đã bị unload trước đó vẫn nằm trong chunk store của nó. */
  Streaming.rebuild = function () {
    var scene = sceneRoot();
    if (scene) { try { scene.updateMatrixWorld(true); } catch (e) { /* ignore */ } }
    var kept = {}; /* uuid -> entry cũ (giữ trạng thái loaded + object3D) */
    Object.keys(Streaming.chunks).forEach(function (key) {
      Streaming.chunks[key].objects.forEach(function (entry) { kept[entry.uuid] = entry; });
    });
    Streaming.chunks = {};
    Streaming.objectChunk = {};
    registryEntries().forEach(function (reg) {
      var obj = reg.object3D;
      if (!obj) return;
      var wp = worldPosOf(obj);
      var key = Streaming.chunkKeyFor(wp.x, wp.z);
      var old = kept[obj.uuid];
      var entry = old || { uuid: obj.uuid, name: reg.name, type: reg.type, object3D: obj };
      entry.name = reg.name;
      entry.type = reg.type;
      entry.object3D = obj;
      entry.position = [wp.x, wp.y, wp.z];
      if (!Streaming.chunks[key]) {
        Streaming.chunks[key] = { key: key, cx: 0, cz: 0, loaded: false, objects: [] };
        var cc = Streaming.chunkCoords(key);
        Streaming.chunks[key].cx = cc.cx;
        Streaming.chunks[key].cz = cc.cz;
      }
      Streaming.chunks[key].objects.push(entry);
      /* loaded = object hiện đang gắn trong scene graph */
      Streaming.chunks[key].loaded = Streaming.chunks[key].loaded || !!obj.parent;
      Streaming.objectChunk[obj.uuid] = key;
    });
    return Streaming.getStats();
  };

  /* ---------- focus ---------- */
  Streaming.getFocusPosition = function () {
    var vp = PixiStudio.Viewport;
    if (Streaming.config.focus === 'player' && Streaming.config.focusObjectUuid) {
      var reg = PixiStudio.Scene && PixiStudio.Scene.registry && PixiStudio.Scene.registry[Streaming.config.focusObjectUuid];
      if (reg && reg.object3D) return worldPosOf(reg.object3D);
      /* focus object mất rồi -> rơi về camera */
    }
    if (vp && vp.orbit && vp.orbit.camera) return vp.orbit.camera.position.clone();
    if (vp && vp.orbit && vp.orbit.target) return vp.orbit.target.clone();
    return new THREE.Vector3(0, 0, 0);
  };

  /* ---------- load / unload ---------- */
  Streaming.loadChunk = function (key) {
    var chunk = Streaming.chunks[key];
    var scene = sceneRoot();
    if (!chunk || !scene) return 0;
    var n = 0;
    chunk.objects.forEach(function (entry) {
      var obj = entry.object3D;
      if (!obj || obj.parent) return;
      /* Gắn lại đúng parent cũ: parent gốc là scene (đa số) hoặc
       * modelRoot — lưu parentId lúc unload; mặc định scene. */
      var parent = scene;
      if (entry.parentRef && entry.parentRef.parent) parent = entry.parentRef.parent;
      parent.add(obj);
      n++;
    });
    chunk.loaded = true;
    return n;
  };

  Streaming.unloadChunk = function (key) {
    var chunk = Streaming.chunks[key];
    if (!chunk) return 0;
    var n = 0;
    chunk.objects.forEach(function (entry) {
      var obj = entry.object3D;
      if (!obj || !obj.parent) return;
      entry.parentRef = obj.parent; /* nhớ để gắn lại đúng chỗ */
      obj.parent.remove(obj);
      n++;
    });
    chunk.loaded = false;
    return n;
  };

  /* Cập nhật load/unload theo vị trí focus hiện tại. Trả stats.
   * force=true: bỏ qua throttle theo thời gian. */
  Streaming.update = function (force) {
    if (!Streaming.config.enabled) return Streaming.getStats();
    var now = Date.now();
    if (!force && now - Streaming.lastUpdateAt < (Streaming.config.updateIntervalMs || 250)) {
      return Streaming.getStats();
    }
    Streaming.lastUpdateAt = now;
    if (!Object.keys(Streaming.chunks).length) Streaming.rebuild();
    var focus = Streaming.getFocusPosition();
    var cs = Streaming.config.chunkSize || 10;
    var fx = Math.floor(focus.x / cs);
    var fz = Math.floor(focus.z / cs);
    var focusKey = fx + ',' + fz;
    var loadR = Streaming.loadRadiusCells();
    var unloadR = Streaming.unloadRadiusCells();
    var changed = 0;
    Object.keys(Streaming.chunks).forEach(function (key) {
      var chunk = Streaming.chunks[key];
      var d = Streaming.chunkDistanceCells(chunk.cx, chunk.cz, fx, fz);
      if (d <= loadR && !chunk.loaded) changed += Streaming.loadChunk(key);
      else if (d > unloadR && chunk.loaded) changed += Streaming.unloadChunk(key);
      /* trong vùng đệm (loadR < d <= unloadR): giữ nguyên trạng thái */
    });
    if (focusKey !== Streaming.lastFocusChunk) Streaming.lastFocusChunk = focusKey;
    if (changed) {
      try { bus.emit('scene:streaming-changed', { focus: [focus.x, focus.y, focus.z], changed: changed }); } catch (e) { /* ignore */ }
    }
    Streaming.refreshPanel();
    return Streaming.getStats();
  };

  Streaming.loadAll = function () {
    var n = 0;
    Object.keys(Streaming.chunks).forEach(function (key) { n += Streaming.loadChunk(key); });
    Streaming.refreshPanel();
    return n;
  };

  /* Tắt streaming: load lại toàn bộ object vào scene. */
  Streaming.setEnabled = function (enabled) {
    Streaming.config.enabled = !!enabled;
    if (enabled) {
      Streaming.rebuild();
      Streaming.update(true);
    } else {
      Streaming.loadAll();
    }
    try { bus.emit('scene:streaming-toggled', { enabled: Streaming.config.enabled }); } catch (e) { /* ignore */ }
    Streaming.refreshPanel();
    return Streaming.config.enabled;
  };

  Streaming.configure = function (opts) {
    if (!opts) return Streaming.config;
    if (opts.chunkSize !== undefined && opts.chunkSize > 0) Streaming.config.chunkSize = opts.chunkSize;
    if (opts.loadDistance !== undefined && opts.loadDistance >= 0) Streaming.config.loadDistance = opts.loadDistance;
    if (opts.unloadDistance !== undefined && opts.unloadDistance >= 0) Streaming.config.unloadDistance = opts.unloadDistance;
    /* ép hysteresis ngay ở config: unload phải > load */
    if (Streaming.config.unloadDistance <= Streaming.config.loadDistance) {
      Streaming.config.unloadDistance = Streaming.config.loadDistance + Streaming.config.chunkSize;
    }
    if (opts.focus) Streaming.config.focus = opts.focus;
    if (opts.focusObjectUuid !== undefined) Streaming.config.focusObjectUuid = opts.focusObjectUuid;
    if (opts.updateIntervalMs !== undefined) Streaming.config.updateIntervalMs = opts.updateIntervalMs;
    if (Streaming.config.enabled) { Streaming.rebuild(); Streaming.update(true); }
    Streaming.refreshPanel();
    return Streaming.config;
  };

  /* ---------- stats ---------- */
  Streaming.getStats = function () {
    var totalChunks = Object.keys(Streaming.chunks).length;
    var loadedChunks = 0, totalObjects = 0, loadedObjects = 0;
    var bytesLoaded = 0, bytesTotal = 0;
    Object.keys(Streaming.chunks).forEach(function (key) {
      var chunk = Streaming.chunks[key];
      if (chunk.loaded) loadedChunks++;
      chunk.objects.forEach(function (entry) {
        totalObjects++;
        var b = Streaming.estimateGeometryBytes(entry.object3D);
        bytesTotal += b;
        if (chunk.loaded) { loadedObjects++; bytesLoaded += b; }
      });
    });
    var sceneCount = 0;
    var scene = sceneRoot();
    if (scene) {
      scene.traverse(function (o) { if (o.isMesh) sceneCount++; });
    }
    return {
      enabled: Streaming.config.enabled,
      chunkSize: Streaming.config.chunkSize,
      loadDistance: Streaming.config.loadDistance,
      unloadDistance: Streaming.config.unloadDistance,
      loadRadiusCells: Streaming.loadRadiusCells(),
      unloadRadiusCells: Streaming.unloadRadiusCells(),
      focus: Streaming.config.focus,
      totalChunks: totalChunks,
      loadedChunks: loadedChunks,
      totalObjects: totalObjects,
      loadedObjects: loadedObjects,
      unloadedObjects: totalObjects - loadedObjects,
      meshesInScene: sceneCount,
      bytesLoaded: bytesLoaded,
      bytesTotal: bytesTotal,
      bytesSaved: bytesTotal - bytesLoaded
    };
  };

  /* ---------- render loop hook (throttle sẵn trong update) ---------- */
  Streaming.attachToRenderLoop = function () {
    if (Streaming._renderLoopAttached) return true;
    var vp = PixiStudio.Viewport;
    if (!vp || typeof vp.render !== 'function') return false;
    var prevRender = vp.render;
    vp.render = function (dt) {
      var out = prevRender.apply(this, arguments);
      try { if (Streaming.config.enabled) Streaming.update(false); } catch (e) { /* không phá render */ }
      return out;
    };
    Streaming._renderLoopAttached = true;
    return true;
  };

  /* ---------- UI ---------- */
  Streaming.renderPanel = function (container) {
    var wrap = container || document.getElementById('scene-streaming-panel');
    if (!wrap) return null;
    wrap.innerHTML = '';
    var stats = Streaming.getStats();
    var mb = function (b) { return (b / 1048576).toFixed(2) + ' MB'; };

    var head = el('h4', { text: 'Scene Streaming (Open World)' });
    wrap.appendChild(head);

    var toggleRow = el('div', { style: 'display:flex;align-items:center;gap:8px;margin:6px 0;' });
    var toggle = el('input', { type: 'checkbox', id: 'streaming-enabled' });
    toggle.checked = Streaming.config.enabled;
    toggle.addEventListener('change', function () { Streaming.setEnabled(toggle.checked); });
    toggleRow.appendChild(toggle);
    toggleRow.appendChild(el('label', { text: 'Bật streaming theo vị trí camera', style: 'font-size:12px;' }));
    wrap.appendChild(toggleRow);

    function numRow(label, key, min, max, step) {
      var row = el('div', { style: 'display:flex;align-items:center;gap:8px;margin:4px 0;' });
      row.appendChild(el('label', { text: label, style: 'font-size:12px;flex:1;' }));
      var input = el('input', { type: 'number', value: String(Streaming.config[key]), style: 'width:70px;' });
      input.min = min; input.max = max; input.step = step;
      input.addEventListener('change', function () {
        var v = parseFloat(input.value);
        if (isFinite(v)) { var o = {}; o[key] = v; Streaming.configure(o); }
      });
      row.appendChild(input);
      wrap.appendChild(row);
    }
    numRow('Kích thước chunk (m)', 'chunkSize', 2, 100, 1);
    numRow('Khoảng cách load (m)', 'loadDistance', 0, 500, 5);
    numRow('Khoảng cách unload (m)', 'unloadDistance', 0, 500, 5);

    var focusRow = el('div', { style: 'display:flex;align-items:center;gap:8px;margin:4px 0;' });
    focusRow.appendChild(el('label', { text: 'Focus theo', style: 'font-size:12px;flex:1;' }));
    var focusSel = el('select', { style: 'flex:1;' });
    [['camera', 'Camera'], ['player', 'Object focus (player)']].forEach(function (opt) {
      var o = el('option', { value: opt[0], text: opt[1] });
      if (Streaming.config.focus === opt[0]) o.selected = true;
      focusSel.appendChild(o);
    });
    focusSel.addEventListener('change', function () { Streaming.configure({ focus: focusSel.value }); });
    focusRow.appendChild(focusSel);
    wrap.appendChild(focusRow);

    var statsEl = el('div', { class: 'stat-grid' });
    function stat(label, value) {
      statsEl.appendChild(el('div', { class: 'stat-cell' }, [
        el('div', { class: 'sc-label', text: label }),
        el('div', { class: 'sc-value', text: value })
      ]));
    }
    stat('Chunk đã load', stats.loadedChunks + ' / ' + stats.totalChunks);
    stat('Object hiện', stats.loadedObjects + ' / ' + stats.totalObjects);
    stat('Mesh trong scene', String(stats.meshesInScene));
    stat('Geometry đã load', mb(stats.bytesLoaded) + ' / ' + mb(stats.bytesTotal));
    wrap.appendChild(statsEl);
    wrap.appendChild(el('div', {
      style: 'font-size:11px;color:var(--text-4);margin-top:4px;',
      text: 'Unload giữ metadata + object3D trong chunk store nên quay lại là load ngay, không mất object. ' +
        'Geometry không dispose khi unload (xem ghi chú trong js/scene/scene-streaming.js).'
    }));

    var btnRow = el('div', { style: 'display:flex;gap:6px;margin-top:6px;' });
    btnRow.appendChild(el('button', {
      class: 'btn sm', text: 'Quét lại chunk',
      onclick: function () { Streaming.rebuild(); if (Streaming.config.enabled) Streaming.update(true); Streaming.renderPanel(wrap); }
    }));
    btnRow.appendChild(el('button', {
      class: 'btn sm', text: 'Load tất cả',
      onclick: function () { Streaming.loadAll(); Streaming.renderPanel(wrap); }
    }));
    wrap.appendChild(btnRow);

    Streaming._panelEl = wrap;
    return wrap;
  };

  Streaming.refreshPanel = function () {
    if (!Streaming._panelEl || !Streaming._panelEl.isConnected) return;
    /* chỉ refresh số liệu, không rebuild toàn panel (tránh mất focus input) */
    var stats = Streaming.getStats();
    var vals = Streaming._panelEl.querySelectorAll('.sc-value');
    if (vals.length >= 4) {
      vals[0].textContent = stats.loadedChunks + ' / ' + stats.totalChunks;
      vals[1].textContent = stats.loadedObjects + ' / ' + stats.totalObjects;
      vals[2].textContent = String(stats.meshesInScene);
      vals[3].textContent = (stats.bytesLoaded / 1048576).toFixed(2) + ' MB / ' + (stats.bytesTotal / 1048576).toFixed(2) + ' MB';
    }
  };

  /* Section gắn vào Scene page (gọi qua hook chung của Scene page,
   * xem PixiStudio.Scene._extraPageSections — chỉ 1 module wrap
   * Scene.renderPage, các module khác đăng ký section vào đó). */
  Streaming.renderPageSection = function () {
    var wrap = el('div', { class: 'page-block', id: 'scene-streaming-panel' });
    Streaming.renderPanel(wrap);
    return wrap;
  };

  Streaming.registerPageSection = function () {
    if (!PixiStudio.Scene) return false;
    PixiStudio.Scene._extraPageSections = PixiStudio.Scene._extraPageSections || [];
    if (PixiStudio.Scene._extraPageSections.indexOf(Streaming.renderPageSection) === -1) {
      PixiStudio.Scene._extraPageSections.push(Streaming.renderPageSection);
    }
    return true;
  };

  /* Wrap Scene.renderPage 1 lần duy nhất (guard trên chính hàm):
   * sau khi renderPage gốc chạy xong, append các section đã đăng ký. */
  Streaming._installPageHook = function () {
    var Scene = PixiStudio.Scene;
    if (!Scene || typeof Scene.renderPage !== 'function' || Scene.renderPage.__streamingHooked) return false;
    var orig = Scene.renderPage;
    var wrapped = function () {
      var out = orig.apply(this, arguments);
      try {
        var body = document.getElementById('scene-page-body');
        if (body && Scene._extraPageSections) {
          Scene._extraPageSections.forEach(function (fn) {
            try { body.appendChild(fn()); } catch (e) { /* section lỗi thì bỏ qua */ }
          });
        }
      } catch (e) { /* không phá renderPage gốc */ }
      return out;
    };
    wrapped.__streamingHooked = true;
    Scene.renderPage = wrapped;
    return true;
  };

  Streaming.init = function () {
    Streaming.registerPageSection();
    Streaming._installPageHook();
    try {
      if (bus && bus.on) {
        bus.on('scene:changed', function () {
          /* registry đổi -> quét lại chunk ở lần update sau (rẻ, không rebuild ngay) */
          if (Streaming.config.enabled) Streaming.rebuild();
        });
      }
    } catch (e) { /* ignore */ }
    return Streaming;
  };

  window.PixiStudio.SceneStreaming = Streaming;
  Streaming.init();
})();
