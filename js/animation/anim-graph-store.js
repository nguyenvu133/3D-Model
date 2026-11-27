/* ============================================================
 * animation/anim-graph-store.js — QUẢN LÝ NHIỀU GRAPH (SM2)
 *
 * Lưu NHIỀU Blend Tree / State Machine + mapping nhân vật↔graph.
 * Format riêng, KHÔNG đổi format graph cũ ('pixistudio-anim-graph-1'):
 * store chỉ giữ nguyên object đã serialize của runtime (BT/SM
 * serialize/deserialize), cộng thêm metadata của riêng store.
 *
 * localStorage key: 'pixistudio-anim-graphs-v2' (versioned).
 *   { format:'pixistudio-anim-graphs-v2', version:2,
 *     entries:[ { id, name, mode:'blendtree'|'statemachine',
 *                 data:<graph đã serialize>, comments:[{id,text,x,y,w,h}],
 *                 characterId:<id NV gắn sẵn|null>, updatedAt } ],
 *     charMap:{ <characterId>: { blendtree:<entryId>, statemachine:<entryId> } },
 *     active:{ blendtree:<entryId|null>, statemachine:<entryId|null> } }
 *
 * characterId = PixiStudio.Models.currentId (id model đang mở),
 * fallback State.data.selectionId (uuid object đang chọn),
 * fallback uuid/tên target. Ghi rõ trong báo cáo SM2.
 *
 * Tương thích ngược: migrateLegacy() đọc key cũ
 * 'pixistudio-anim-graph-1' ({blendtree, statemachine}) thành 2 entry
 * khi store còn trống. importText() nhận cả format v2 mới lẫn
 * format legacy v1 (1 file = 2 graph).
 * ============================================================ */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined' && window.PixiStudio) || {};
  var STORE_KEY = 'pixistudio-anim-graphs-v2';
  var LEGACY_KEY = 'pixistudio-anim-graph-1';
  var FORMAT = 'pixistudio-anim-graphs-v2';

  var _uid = 0;
  function uid(prefix) { _uid++; return (prefix || 'g') + '_' + Date.now().toString(36) + '_' + _uid; }
  function ls() {
    try { return (typeof localStorage !== 'undefined' ? localStorage : window.localStorage); } catch (e) { return null; }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function blankStore() {
    return { format: FORMAT, version: 2, entries: [], charMap: {}, active: { blendtree: null, statemachine: null } };
  }

  function normalize(store) {
    if (!store || typeof store !== 'object') return blankStore();
    if (!Array.isArray(store.entries)) store.entries = [];
    if (!store.charMap || typeof store.charMap !== 'object') store.charMap = {};
    if (!store.active || typeof store.active !== 'object') store.active = { blendtree: null, statemachine: null };
    store.entries.forEach(function (e) {
      if (!e.id) e.id = uid('graph');
      if (!e.mode) e.mode = 'blendtree';
      if (!e.name) e.name = e.mode === 'statemachine' ? 'State Machine' : 'Blend Tree';
      if (!Array.isArray(e.comments)) e.comments = [];
      if (!e.data) e.data = null;
      if (!e.updatedAt) e.updatedAt = Date.now();
    });
    return store;
  }

  var Store = {
    FORMAT: FORMAT, STORE_KEY: STORE_KEY, LEGACY_KEY: LEGACY_KEY,

    load: function () {
      var s = ls();
      if (!s) return blankStore();
      try {
        var text = s.getItem(STORE_KEY);
        if (!text) return blankStore();
        var data = JSON.parse(text);
        if (data.format !== FORMAT && data.version !== 2) return blankStore();
        return normalize(data);
      } catch (e) { return blankStore(); }
    },

    save: function (store) {
      var s = ls();
      if (!s) return { ok: false, error: 'Không có localStorage.' };
      try {
        s.setItem(STORE_KEY, JSON.stringify(store));
        return { ok: true, bytes: JSON.stringify(store).length };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    },

    /* Đọc key legacy v1 ({blendtree, statemachine}) — dùng cho migrate
       và import. Trả {ok, blendtree, statemachine} hoặc {ok:false}. */
    readLegacy: function (text) {
      var data = null;
      if (text !== undefined && text !== null) {
        try { data = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return { ok: false, error: 'JSON lỗi: ' + (e && e.message) }; }
      } else {
        var s = ls();
        if (!s) return { ok: false, error: 'Không có localStorage.' };
        var raw = s.getItem(LEGACY_KEY);
        if (!raw) return { ok: false, error: 'Chưa có graph legacy.' };
        try { data = JSON.parse(raw); } catch (e) { return { ok: false, error: 'JSON legacy lỗi: ' + (e && e.message) }; }
      }
      if (!data || data.format !== LEGACY_KEY) return { ok: false, error: 'Không phải file Anim Graph v1.' };
      return { ok: true, blendtree: data.blendtree || null, statemachine: data.statemachine || null };
    },

    /* Store trống + có legacy → tạo 2 entry từ legacy. Chỉ chạy 1 lần. */
    migrateLegacy: function () {
      var store = Store.load();
      if (store.entries.length) return { ok: false, reason: 'store đã có entry' };
      var leg = Store.readLegacy();
      if (!leg.ok) return { ok: false, reason: leg.error };
      var made = [];
      if (leg.blendtree) {
        var e1 = Store._newEntry('Blend Tree', 'blendtree', leg.blendtree);
        store.entries.push(e1); store.active.blendtree = e1.id; made.push(e1.name);
      }
      if (leg.statemachine) {
        var e2 = Store._newEntry('State Machine', 'statemachine', leg.statemachine);
        store.entries.push(e2); store.active.statemachine = e2.id; made.push(e2.name);
      }
      if (!made.length) return { ok: false, reason: 'legacy rỗng' };
      Store.save(store);
      return { ok: true, imported: made };
    },

    _newEntry: function (name, mode, data, comments) {
      return {
        id: uid('graph'), name: String(name || (mode === 'statemachine' ? 'State Machine' : 'Blend Tree')),
        mode: mode === 'statemachine' ? 'statemachine' : 'blendtree',
        data: data || null, comments: comments || [], characterId: null, updatedAt: Date.now()
      };
    },

    list: function (mode) {
      var store = Store.load();
      var list = store.entries.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      if (mode) list = list.filter(function (e) { return e.mode === mode; });
      return list;
    },

    get: function (id) {
      var store = Store.load();
      return store.entries.find(function (e) { return e.id === id; }) || null;
    },

    create: function (name, mode, data, comments) {
      var store = Store.load();
      var e = Store._newEntry(name, mode, data, comments);
      store.entries.push(e);
      store.active[e.mode] = e.id;
      Store.save(store);
      return { ok: true, entry: e };
    },

    /* Upsert: lưu đè data/comments của entry (editor gọi mỗi lần save). */
    upsert: function (entry) {
      if (!entry || !entry.id) return { ok: false, error: 'Thiếu entry id.' };
      var store = Store.load();
      var i = store.entries.findIndex(function (e) { return e.id === entry.id; });
      entry.updatedAt = Date.now();
      if (i < 0) store.entries.push(clone(entry));
      else store.entries[i] = clone(entry);
      Store.save(store);
      return { ok: true, entry: entry };
    },

    rename: function (id, name) {
      name = String(name || '').trim();
      if (!name) return { ok: false, error: 'Tên trống.' };
      var store = Store.load();
      var e = store.entries.find(function (x) { return x.id === id; });
      if (!e) return { ok: false, error: 'Không có graph ' + id };
      e.name = name; e.updatedAt = Date.now();
      Store.save(store);
      return { ok: true, entry: e };
    },

    duplicate: function (id) {
      var store = Store.load();
      var src = store.entries.find(function (x) { return x.id === id; });
      if (!src) return { ok: false, error: 'Không có graph ' + id };
      var copy = clone(src);
      copy.id = uid('graph');
      copy.name = src.name + ' (bản sao)';
      copy.updatedAt = Date.now();
      /* Node/state id BÊN TRONG data giữ nguyên: mỗi entry chỉ load 1
         graph tại 1 thời điểm nên không đụng id; đổi tên entry là đủ. */
      store.entries.push(copy);
      store.active[copy.mode] = copy.id;
      Store.save(store);
      return { ok: true, entry: copy };
    },

    remove: function (id) {
      var store = Store.load();
      var i = store.entries.findIndex(function (x) { return x.id === id; });
      if (i < 0) return { ok: false, error: 'Không có graph ' + id };
      var mode = store.entries[i].mode;
      store.entries.splice(i, 1);
      if (store.active[mode] === id) {
        var rest = store.entries.filter(function (x) { return x.mode === mode; });
        store.active[mode] = rest.length ? rest[0].id : null;
      }
      Object.keys(store.charMap).forEach(function (cid) {
        if (store.charMap[cid] && store.charMap[cid][mode] === id) delete store.charMap[cid][mode];
      });
      Store.save(store);
      return { ok: true };
    },

    setActive: function (mode, id) {
      var store = Store.load();
      if (id && !store.entries.some(function (x) { return x.id === id && x.mode === mode; })) {
        return { ok: false, error: 'Không có graph ' + id };
      }
      store.active[mode] = id || null;
      Store.save(store);
      return { ok: true };
    },

    getActive: function (mode) {
      var store = Store.load();
      var id = store.active && store.active[mode];
      if (!id) return null;
      return store.entries.find(function (x) { return x.id === id; }) || null;
    },

    /* ---- Mapping nhân vật ↔ graph ---- */
    setCharacterGraph: function (characterId, mode, entryId) {
      if (!characterId) return { ok: false, error: 'Thiếu characterId.' };
      var store = Store.load();
      if (!store.charMap[characterId]) store.charMap[characterId] = {};
      if (entryId) store.charMap[characterId][mode] = entryId;
      else delete store.charMap[characterId][mode];
      Store.save(store);
      return { ok: true };
    },

    getCharacterGraph: function (characterId, mode) {
      if (!characterId) return null;
      var store = Store.load();
      var map = store.charMap[characterId];
      if (!map || !map[mode]) return null;
      return store.entries.find(function (x) { return x.id === map[mode]; }) || null;
    },

    getCharacterMap: function () {
      return Store.load().charMap || {};
    },

    /* ---- Xuất / nhập ---- */
    exportText: function (ids) {
      var store = Store.load();
      var entries = ids
        ? store.entries.filter(function (e) { return ids.indexOf(e.id) >= 0; })
        : store.entries;
      var data = { format: FORMAT, version: 2, entries: entries, charMap: store.charMap, exportedAt: new Date().toISOString() };
      return { ok: true, text: JSON.stringify(data, null, 2) };
    },

    /* Nhận format v2 mới HOẶC legacy v1 ({blendtree, statemachine}).
       Entry trùng id → ghi đè; trùng tên+mode → tạo bản sao tên mới. */
    importText: function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'JSON lỗi: ' + (e && e.message) }; }
      if (!data || typeof data !== 'object') return { ok: false, error: 'Dữ liệu không phải JSON object.' };
      var store = Store.load();
      var imported = [];
      if (data.format === FORMAT && Array.isArray(data.entries)) {
        data.entries.forEach(function (en) {
          if (!en || !en.data || !en.mode) return;
          var copy = clone(en);
          if (!copy.id) copy.id = uid('graph');
          if (store.entries.some(function (x) { return x.id === copy.id; })) copy.id = uid('graph');
          if (store.entries.some(function (x) { return x.mode === copy.mode && x.name === copy.name; })) {
            copy.name = copy.name + ' (nhập ' + new Date().toLocaleDateString('vi-VN') + ')';
          }
          copy.updatedAt = Date.now();
          store.entries.push(copy);
          imported.push(copy.name);
        });
        if (data.charMap && typeof data.charMap === 'object') {
          Object.keys(data.charMap).forEach(function (cid) { store.charMap[cid] = data.charMap[cid]; });
        }
      } else if (data.format === LEGACY_KEY) {
        var made = [];
        if (data.blendtree) {
          var e1 = Store._newEntry((data.blendtree.name || 'Blend Tree') + ' (nhập v1)', 'blendtree', data.blendtree);
          store.entries.push(e1); made.push(e1.name);
        }
        if (data.statemachine) {
          var e2 = Store._newEntry((data.statemachine.name || 'State Machine') + ' (nhập v1)', 'statemachine', data.statemachine);
          store.entries.push(e2); made.push(e2.name);
        }
        imported = made;
      } else {
        return { ok: false, error: 'Không phải file Anim Graph (cần ' + FORMAT + ' hoặc ' + LEGACY_KEY + ').' };
      }
      if (!imported.length) return { ok: false, error: 'File không chứa graph nào.' };
      Store.save(store);
      return { ok: true, imported: imported };
    },

    clearAll: function () {
      var s = ls();
      if (s) { try { s.removeItem(STORE_KEY); } catch (e) {} }
      return { ok: true };
    }
  };

  PS.AnimGraphStore = Store;
})();
