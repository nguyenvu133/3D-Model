/* ============================================================
 * rig/arp-plugins.js — HỆ THỐNG PLUGINS cho Auto Rig Pro Blend
 *
 * Registry độc lập với panel: plugin có thể đăng ký TRƯỚC khi
 * ArpPanel load (registry giữ lại, panel nhận khi mở qua
 * ArpPlugins.syncPanelTabs() — panel gọi trong _build) hoặc SAU
 * khi panel đã load (register gọi syncPanelTabs ngay).
 *
 * ============ CONTRACT ĐĂNG KÝ PLUGIN (cho agent (C) Auto Fix
 * và mọi plugin sau này) ============
 *
 *   PixiStudio.ArpPlugins.register('auto-fix', {
 *     name: 'Auto Fix',            // tên hiển thị (bắt buộc)
 *     version: '1.0.0',           // chuỗi version (khuyến nghị)
 *     description: '...',         // mô tả ngắn hiện trong tab Plugins
 *     tab: true,                  // true = có 1 tab riêng trong cửa sổ
 *                                  //   ARP (id tab: 'plugin:auto-fix');
 *                                  // false/missing = chỉ hiện trong tab
 *                                  //   Plugins, không có tab riêng
 *     enabled: true,              // mặc định bật (trừ khi user đã tắt
 *                                  //   và trạng thái lưu ở localStorage)
 *     render: function (container, ctx) { ... },  // BẮT BUỘC:
 *                                  // dựng UI của plugin vào container
 *     onEnable: function (ctx) {},  // tùy chọn, gọi khi user bật plugin
 *     onDisable: function (ctx) {}  // tùy chọn, gọi khi user tắt plugin
 *   });
 *
 *   - id duy nhất: đăng ký trùng id THROW Error rõ ràng, KHÔNG ghi
 *     đè lặng lẽ. Muốn thay plugin cũ thì unregister(id) trước.
 *   - ctx (context object) truyền vào render/onEnable/onDisable:
 *       ctx.getModel()    → model/rig hiện tại trong scene (thử theo
 *                           thứ tự: RigAutoGen.current.target/root →
 *                           Viewport.getMainModel() → con đầu của
 *                           Viewport.modelRoot → null)
 *       ctx.getSkeleton() → { root, rootBone, bones, boneCount } hoặc
 *                           null khi model chưa có skeleton
 *       ctx.notify(msg, type) → toast qua PixiStudio.Notifications
 *                           (type: 'info'|'success'|'warning'|'error')
 *       ctx.log(...)      → console.log có prefix '[ArpPlugins:<id>]'
 *       ctx.bus           → PixiStudio.bus (nghe/phát sự kiện)
 *       ctx.pluginId      → id của plugin
 *   - Trạng thái bật/tắt lưu ở localStorage 'pixistudio.arp-plugins'
 *     (map id → true/false), khôi phục khi mở lại trang. Plugin bị
 *     TẮT thì tab/section của nó ẨN khỏi panel ngay, không cần reload.
 *   - Plugin nạp từ file .js: xem ArpPlugins.loadFromSource /
 *     loadFromFile bên dưới.
 *
 * ⚠️ GIỚI HẠN BẢO MẬT — ĐỌC KỸ (không phải sandbox thật):
 *   Plugin nạp từ file .js chạy bằng `new Function` TRONG TRANG,
 *   với TOÀN QUYỀN của trang (đọc/ghi DOM, localStorage, gọi mọi
 *   API của studio, fetch mạng). KHÔNG có cô lập, KHÔNG có chặn
 *   quyền. Tab Plugins hiện cảnh báo đỏ rõ ràng và chỉ nên nạp file
 *   từ nguồn tin cậy. Đây là giới hạn đã biết của thiết kế này,
 *   không phải lỗi chưa phát hiện.
 *
 * Nạp: index.html load file này NGAY SAU js/ui/arp-panel.js và
 * TRƯỚC các module tab ARP (arp-smart.js, ...) để registry sẵn
 * sàng khi các tab/plugin load.
 * ============================================================ */
(function () {
  'use strict';

  var STORE_KEY = 'pixistudio.arp-plugins';
  var PLUGINS_TAB_ID = 'plugins';

  var _plugins = {};   /* id -> record */
  var _order = [];     /* id theo thứ tự đăng ký */
  var _listeners = []; /* onChange callbacks */
  var _pluginsTabRegistered = false;

  /* ---------- Persist trạng thái bật/tắt ---------- */

  function loadPersisted() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(STORE_KEY);
      if (!raw) return {};
      var s = JSON.parse(raw);
      return (s && typeof s === 'object') ? s : {};
    } catch (e) { return {}; }
  }

  function savePersisted() {
    try {
      if (!window.localStorage) return;
      var map = {};
      _order.forEach(function (id) { map[id] = !!_plugins[id].enabled; });
      window.localStorage.setItem(STORE_KEY, JSON.stringify(map));
    } catch (e) { /* localStorage đầy/bị chặn: trạng thái chỉ giữ trong phiên */ }
  }

  var _persisted = loadPersisted();

  /* ---------- Context cho plugin ---------- */

  function getModel() {
    try {
      var RAG = window.PixiStudio && PixiStudio.RigAutoGen;
      if (RAG && RAG.current) {
        if (RAG.current.target) return RAG.current.target;
        if (RAG.current.root) return RAG.current.root;
      }
    } catch (e) {}
    try {
      var VP = window.PixiStudio && PixiStudio.Viewport;
      if (VP) {
        if (typeof VP.getMainModel === 'function') {
          var m = VP.getMainModel();
          if (m) return m;
        }
        if (VP.modelRoot && VP.modelRoot.children && VP.modelRoot.children.length) {
          return VP.modelRoot.children[0];
        }
      }
    } catch (e) {}
    try {
      var M = window.PixiStudio && PixiStudio.Models;
      if (M && typeof M.getCurrent === 'function') {
        var mc = M.getCurrent();
        if (mc) return mc;
      }
      if (M && M.current) return M.current;
    } catch (e) {}
    return null;
  }

  function getSkeleton() {
    var model = getModel();
    if (!model || !model.traverse) return null;
    var bones = [];
    var skeleton = null;
    model.traverse(function (o) {
      if (o.isBone) bones.push(o);
      if (!skeleton && o.isSkinnedMesh && o.skeleton) skeleton = o.skeleton;
    });
    if (!bones.length && !skeleton) return null;
    var rootBone = null;
    if (skeleton && skeleton.bones && skeleton.bones.length) rootBone = skeleton.bones[0];
    else if (bones.length) {
      /* xương gốc = xương không có cha là xương */
      for (var i = 0; i < bones.length; i++) {
        var p = bones[i].parent;
        var parentIsBone = false;
        while (p) { if (p.isBone) { parentIsBone = true; break; } p = p.parent; }
        if (!parentIsBone) { rootBone = bones[i]; break; }
      }
      if (!rootBone) rootBone = bones[0];
    }
    return { root: model, rootBone: rootBone, bones: bones, boneCount: bones.length, skeleton: skeleton || null };
  }

  function makeContext(id) {
    var bus = (window.PixiStudio && PixiStudio.bus) || null;
    return {
      pluginId: id,
      getModel: getModel,
      getSkeleton: getSkeleton,
      notify: function (msg, type) {
        var title = 'Plugin: ' + id;
        try {
          var N = window.PixiStudio && PixiStudio.Notifications;
          if (N && typeof N.show === 'function') {
            N.show({ type: type || 'info', title: title, message: String(msg) });
            return;
          }
        } catch (e) {}
        if (bus && bus.emit) bus.emit('notify', { type: type || 'info', title: title, message: String(msg) });
      },
      log: function () {
        var args = ['[ArpPlugins:' + id + ']'].concat(Array.prototype.slice.call(arguments));
        if (typeof console !== 'undefined' && console.log) console.log.apply(console, args);
      },
      bus: bus
    };
  }

  /* ---------- Đồng bộ tab với ArpPanel ---------- */

  function pluginTabId(id) { return 'plugin:' + id; }

  function syncPanelTabs() {
    var Panel = window.PixiStudio && PixiStudio.ArpPanel;
    if (!Panel || typeof Panel.registerTab !== 'function') return false;
    if (!_pluginsTabRegistered) {
      try {
        Panel.registerTab(PLUGINS_TAB_ID, 'Plugins', renderPluginsTab);
        _pluginsTabRegistered = true;
      } catch (e) { /* panel chưa sẵn: lần sync sau sẽ thử lại */ }
    }
    _order.forEach(function (id) {
      var rec = _plugins[id];
      if (!rec || !rec.tab) return;
      var tabId = pluginTabId(id);
      if (rec.enabled) {
        try {
          Panel.registerTab(tabId, rec.name, function (container) {
            rec.render(container, makeContext(id));
          });
        } catch (e) {}
      } else if (typeof Panel.unregisterTab === 'function') {
        try { Panel.unregisterTab(tabId); } catch (e) {}
      }
    });
    return true;
  }

  function emitChange(evt) {
    var snap = ArpPlugins.list();
    _listeners.slice().forEach(function (cb) {
      try { cb(evt, snap); } catch (e) {}
    });
  }

  /* ---------- Registry ---------- */

  var ArpPlugins = {};

  ArpPlugins.STORE_KEY = STORE_KEY;

  /* Đăng ký 1 plugin. Trùng id → THROW Error rõ ràng, không ghi đè.
     Trả true khi đăng ký xong. */
  ArpPlugins.register = function (id, def) {
    if (!id || typeof id !== 'string') {
      throw new Error('ArpPlugins.register: id phải là chuỗi không rỗng.');
    }
    if (!def || typeof def !== 'object') {
      throw new Error('ArpPlugins.register("' + id + '"): def phải là object { name, render, ... }.');
    }
    if (typeof def.render !== 'function') {
      throw new Error('ArpPlugins.register("' + id + '"): thiếu render(container, ctx) — plugin phải có hàm render.');
    }
    if (_plugins[id]) {
      throw new Error('ArpPlugins.register: id "' + id + '" đã được đăng ký bởi plugin "' +
        _plugins[id].name + '" — dùng id khác, hoặc gọi ArpPlugins.unregister("' + id + '") trước.');
    }
    if (!def.name || typeof def.name !== 'string') {
      throw new Error('ArpPlugins.register("' + id + '"): thiếu name (tên hiển thị).');
    }
    var enabled = (typeof def.enabled === 'boolean') ? def.enabled : true;
    if (Object.prototype.hasOwnProperty.call(_persisted, id)) enabled = !!_persisted[id];
    _plugins[id] = {
      id: id,
      name: def.name,
      version: (def.version != null) ? String(def.version) : '',
      description: def.description || '',
      render: def.render,
      onEnable: (typeof def.onEnable === 'function') ? def.onEnable : null,
      onDisable: (typeof def.onDisable === 'function') ? def.onDisable : null,
      tab: !!def.tab,
      source: def.source === 'file' ? 'file' : 'builtin',
      fileName: def.fileName || '',
      enabled: enabled
    };
    _order.push(id);
    savePersisted();
    syncPanelTabs();
    emitChange({ type: 'registered', id: id });
    return true;
  };

  /* Gỡ plugin. Trả true nếu đã gỡ, false nếu id không tồn tại. */
  ArpPlugins.unregister = function (id) {
    if (!_plugins[id]) return false;
    var wasEnabled = _plugins[id].enabled;
    delete _plugins[id];
    var i = _order.indexOf(id);
    if (i >= 0) _order.splice(i, 1);
    delete _persisted[id];
    savePersisted();
    var Panel = window.PixiStudio && PixiStudio.ArpPanel;
    if (Panel && typeof Panel.unregisterTab === 'function') {
      try { Panel.unregisterTab(pluginTabId(id)); } catch (e) {}
    }
    if (wasEnabled) emitChange({ type: 'unregistered', id: id });
    else emitChange({ type: 'unregistered', id: id });
    return true;
  };

  /* Danh sách plugin + trạng thái (bản copy, theo thứ tự đăng ký). */
  ArpPlugins.list = function () {
    return _order.map(function (id) {
      var r = _plugins[id];
      return {
        id: r.id, name: r.name, version: r.version, description: r.description,
        tab: r.tab, source: r.source, fileName: r.fileName, enabled: !!r.enabled
      };
    });
  };

  ArpPlugins.isEnabled = function (id) {
    return !!(_plugins[id] && _plugins[id].enabled);
  };

  ArpPlugins.get = function (id) {
    var r = _plugins[id];
    if (!r) return null;
    return {
      id: r.id, name: r.name, version: r.version, description: r.description,
      tab: r.tab, source: r.source, fileName: r.fileName, enabled: !!r.enabled
    };
  };

  ArpPlugins.enable = function (id) {
    var rec = _plugins[id];
    if (!rec) return false;
    if (rec.enabled) return true;
    rec.enabled = true;
    savePersisted();
    if (rec.onEnable) {
      try { rec.onEnable(makeContext(id)); }
      catch (e) { if (typeof console !== 'undefined') console.error('[ArpPlugins:' + id + '] onEnable lỗi:', e); }
    }
    syncPanelTabs();
    emitChange({ type: 'enabled', id: id });
    return true;
  };

  ArpPlugins.disable = function (id) {
    var rec = _plugins[id];
    if (!rec) return false;
    if (!rec.enabled) return true;
    rec.enabled = false;
    savePersisted();
    if (rec.onDisable) {
      try { rec.onDisable(makeContext(id)); }
      catch (e) { if (typeof console !== 'undefined') console.error('[ArpPlugins:' + id + '] onDisable lỗi:', e); }
    }
    syncPanelTabs();
    emitChange({ type: 'disabled', id: id });
    return true;
  };

  /* Hàm render (đã bind context) để panel gọi. Trả null khi plugin
     không tồn tại hoặc đang TẮT → panel không liệt kê/không render. */
  ArpPlugins.getSection = function (id) {
    var rec = _plugins[id];
    if (!rec || !rec.enabled) return null;
    return function (container) { rec.render(container, makeContext(id)); };
  };

  /* Đăng ký listener: cb(evt, list) khi có plugin đăng ký/gỡ/bật/tắt.
     Trả hàm hủy đăng ký. */
  ArpPlugins.onChange = function (cb) {
    if (typeof cb !== 'function') return function () {};
    _listeners.push(cb);
    return function () {
      var i = _listeners.indexOf(cb);
      if (i >= 0) _listeners.splice(i, 1);
    };
  };

  ArpPlugins.syncPanelTabs = syncPanelTabs;
  ArpPlugins.makeContext = makeContext;

  /* ---------- Nạp plugin từ code .js ---------- */

  /* Chạy 1 chuỗi source JS trong trang. Plugin trong source tự gọi
     ArpPlugins.register(...). Trả { ok, added: [ids], error }.
     ⚠️ KHÔNG phải sandbox: code chạy với toàn quyền trang (xem đầu
     file). Chỉ nạp file từ nguồn tin cậy. */
  ArpPlugins.loadFromSource = function (source, opts) {
    opts = opts || {};
    if (typeof source !== 'string' || !source.trim()) {
      return { ok: false, added: [], error: 'Source rỗng — không có gì để nạp.' };
    }
    var before = {};
    ArpPlugins.list().forEach(function (p) { before[p.id] = true; });
    try {
      var fn = new Function('PixiStudio', 'window', 'document', source);
      fn(window.PixiStudio, window, document);
    } catch (e) {
      return { ok: false, added: [], error: 'Chạy code plugin lỗi: ' + (e && e.message ? e.message : e) };
    }
    var added = [];
    ArpPlugins.list().forEach(function (p) {
      if (!before[p.id]) {
        added.push(p.id);
        var rec = _plugins[p.id];
        if (rec) {
          rec.source = 'file';
          rec.fileName = opts.fileName || '';
        }
      }
    });
    if (!added.length) {
      return { ok: false, added: [], error: 'File chạy xong nhưng không đăng ký plugin nào (thiếu ArpPlugins.register?).' };
    }
    savePersisted();
    emitChange({ type: 'loaded', ids: added });
    return { ok: true, added: added, error: '' };
  };

  /* Đọc 1 File .js (từ <input type=file>) rồi nạp. Trả Promise
     resolve { ok, added, error } như loadFromSource. */
  ArpPlugins.loadFromFile = function (file) {
    return new Promise(function (resolve) {
      if (!file) { resolve({ ok: false, added: [], error: 'Chưa chọn file.' }); return; }
      if (typeof FileReader === 'undefined') {
        resolve({ ok: false, added: [], error: 'Trình duyệt không hỗ trợ FileReader.' });
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        resolve(ArpPlugins.loadFromSource(String(reader.result || ''), { fileName: file.name || '' }));
      };
      reader.onerror = function () {
        resolve({ ok: false, added: [], error: 'Không đọc được file.' });
      };
      reader.readAsText(file);
    });
  };

  /* ---------- Tab "Plugins" (quản lý) ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderPluginsTab(container) {
    container.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'arp-plugins-tab';

    /* Cảnh báo sandbox (chữ đỏ, rõ ràng). */
    var warn = document.createElement('div');
    warn.className = 'arp-plugins-warn';
    warn.style.cssText = 'border:2px solid #c0392b;background:#fdecea;color:#922b21;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px;line-height:1.5;';
    warn.innerHTML = '<b>⚠️ Cảnh báo bảo mật:</b> file .js nạp vào sẽ <b>chạy code trực tiếp trong trang</b> ' +
      'với toàn quyền (đọc/ghi DOM, localStorage, gọi mọi API của studio). ' +
      'Đây <b>KHÔNG phải sandbox thật</b> — chỉ nạp file từ nguồn bạn tin cậy tuyệt đối.';
    wrap.appendChild(warn);

    var head = document.createElement('div');
    head.className = 'arp-row';
    head.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;';
    var title = document.createElement('b');
    title.textContent = 'Plugin đã cài (' + ArpPlugins.list().length + ')';
    head.appendChild(title);
    var refreshBtn = document.createElement('button');
    refreshBtn.className = 'arp-btn';
    refreshBtn.textContent = '⟳ Làm mới';
    refreshBtn.addEventListener('click', function () { renderPluginsTab(container); });
    head.appendChild(refreshBtn);
    var loadBtn = document.createElement('button');
    loadBtn.className = 'arp-btn arp-btn-primary';
    loadBtn.textContent = '📂 Nạp plugin từ file .js';
    head.appendChild(loadBtn);
    wrap.appendChild(head);

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.js,text/javascript';
    fileInput.style.display = 'none';
    wrap.appendChild(fileInput);
    loadBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      ArpPlugins.loadFromFile(f).then(function (res) {
        if (res.ok) {
          ArpPlugins.makeContext('plugins').notify('Đã nạp plugin: ' + res.added.join(', '), 'success');
        } else {
          ArpPlugins.makeContext('plugins').notify('Nạp plugin lỗi: ' + res.error, 'error');
        }
        fileInput.value = '';
        renderPluginsTab(container);
      });
    });

    var listEl = document.createElement('div');
    listEl.className = 'arp-plugins-list';
    var plugins = ArpPlugins.list();
    if (!plugins.length) {
      var empty = document.createElement('p');
      empty.className = 'arp-note';
      empty.textContent = 'Chưa có plugin nào.';
      listEl.appendChild(empty);
    }
    plugins.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'arp-plugin-row';
      row.style.cssText = 'border:1px solid var(--arp-border,#ccc);border-radius:8px;padding:10px 12px;margin-bottom:8px;';
      var top = document.createElement('div');
      top.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
      var nameEl = document.createElement('b');
      nameEl.textContent = p.name + (p.version ? ' v' + p.version : '');
      top.appendChild(nameEl);
      var srcBadge = document.createElement('span');
      srcBadge.style.cssText = 'font-size:11px;padding:2px 6px;border-radius:10px;background:#eee;color:#555;';
      srcBadge.textContent = p.source === 'file' ? ('file ngoài' + (p.fileName ? ': ' + p.fileName : '')) : 'có sẵn';
      top.appendChild(srcBadge);
      if (p.tab) {
        var tabBadge = document.createElement('span');
        tabBadge.style.cssText = 'font-size:11px;padding:2px 6px;border-radius:10px;background:#e8e0ff;color:#5b21b6;';
        tabBadge.textContent = 'có tab riêng';
        top.appendChild(tabBadge);
      }
      var toggle = document.createElement('label');
      toggle.style.cssText = 'margin-left:auto;display:flex;gap:6px;align-items:center;cursor:pointer;';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!p.enabled;
      cb.setAttribute('data-plugin-id', p.id);
      cb.addEventListener('change', function () {
        if (cb.checked) ArpPlugins.enable(p.id);
        else ArpPlugins.disable(p.id);
        renderPluginsTab(container);
      });
      toggle.appendChild(cb);
      var tglText = document.createElement('span');
      tglText.textContent = p.enabled ? 'Bật' : 'Tắt';
      toggle.appendChild(tglText);
      top.appendChild(toggle);
      row.appendChild(top);
      if (p.description) {
        var desc = document.createElement('div');
        desc.className = 'arp-note';
        desc.style.marginTop = '4px';
        desc.textContent = p.description;
        row.appendChild(desc);
      }
      if (p.source === 'file') {
        var rmBtn = document.createElement('button');
        rmBtn.className = 'arp-btn';
        rmBtn.style.marginTop = '6px';
        rmBtn.textContent = '🗑 Gỡ plugin';
        rmBtn.addEventListener('click', function () {
          ArpPlugins.unregister(p.id);
          renderPluginsTab(container);
        });
        row.appendChild(rmBtn);
      }
      listEl.appendChild(row);
    });
    wrap.appendChild(listEl);

    /* Chỗ dành cho Auto Fix (agent (C) làm): nếu module đó chưa
       đăng ký thì hiện dòng "chưa cài" để user biết đang phát triển. */
    if (!ArpPlugins.get('auto-fix')) {
      var af = document.createElement('p');
      af.className = 'arp-note';
      af.style.cssText = 'color:#888;font-style:italic;';
      af.textContent = 'Auto Fix (chưa cài — đang phát triển)';
      wrap.appendChild(af);
    }

    container.appendChild(wrap);
  }

  ArpPlugins.renderPluginsTab = renderPluginsTab;

  /* ---------- Test hooks ---------- */
  ArpPlugins._test = {
    STORE_KEY: STORE_KEY,
    getRecord: function (id) { return _plugins[id] || null; },
    getOrder: function () { return _order.slice(); },
    /* Đọc lại localStorage và áp trạng thái đã lưu lên các plugin
       đang đăng ký (mô phỏng mở lại trang trong harness). */
    reloadPersistedState: function () {
      _persisted = loadPersisted();
      _order.forEach(function (id) {
        if (Object.prototype.hasOwnProperty.call(_persisted, id)) _plugins[id].enabled = !!_persisted[id];
      });
      syncPanelTabs();
      return ArpPlugins.list();
    }
  };

  /* Đăng ký tab Plugins ngay nếu panel đã load; nếu panel chưa load
     thì panel sẽ gọi syncPanelTabs() trong _build khi mở. */
  syncPanelTabs();

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpPlugins = ArpPlugins;
})();
