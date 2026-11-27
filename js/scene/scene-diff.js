/* ============================================================
 * scene/scene-diff.js — Scene Diff / Merge
 *
 * So sánh 2 bản serialize của scene (danh sách từ
 * Scene.serializeObjects() — vd scene hiện tại vs bản đã lưu
 * trong project, hoặc 2 project) và merge có chọn lọc:
 *   - khớp object bằng uuid; fallback bằng tên (chỉ khi tên là
 *     duy nhất ở cả 2 bản — tên trùng thì không đoán, báo là
 *     thêm + xóa thay vì đổi).
 *   - added: chỉ có ở B. removed: chỉ có ở A. changed: transform
 *     (position/rotation/scale) / visible / locked / type / name /
 *     primKind / material (nếu entry có trường material) khác.
 *   - merge từng mục (giữ A hoặc lấy B), "Áp tất cả từ B" /
 *     "Giữ tất cả A"; áp lên danh sách (pure, không đụng scene
 *     thật) hoặc áp trực tiếp lên scene đang mở.
 *
 * Giới hạn thật:
 *   - serializeObjects() hiện KHÔNG có material/texture nên diff
 *     material chỉ chạy khi entry mang trường `material` (module
 *     khác bổ sung sau) — so sánh transform/visible/locked là đủ
 *     cho dữ liệu hiện có.
 *   - merge lên scene thật chỉ tái tạo được PRIMITIVE (qua
 *     Scene.createPrimitiveByName); model thêm ở B không tái tạo
 *     được khi thiếu file — mục đó báo skipped kèm lý do, không
 *     tự bịa object.
 *   - object đổi uuid (vd import lại) nhưng cùng tên duy nhất thì
 *     fallback tên vẫn khớp đúng; object đổi cả tên lẫn uuid thì
 *     diff báo thêm + xóa (đúng theo dữ liệu, không đoán mò).
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

  var EPS = 1e-6;

  function numEq(a, b) {
    if (a === b) return true;
    if (typeof a !== 'number' || typeof b !== 'number') return false;
    if (isNaN(a) || isNaN(b)) return isNaN(a) && isNaN(b);
    return Math.abs(a - b) <= EPS;
  }

  function vecEq(a, b) {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!numEq(a[i], b[i])) return false;
    return true;
  }

  function valEq(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) return vecEq(a, b);
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return false;
  }

  function fmtVal(v) {
    if (v === undefined) return '—';
    if (Array.isArray(v)) return '[' + v.map(function (n) { return typeof n === 'number' ? Math.round(n * 1000) / 1000 : String(n); }).join(', ') + ']';
    if (v && typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  function cloneEntry(e) {
    return JSON.parse(JSON.stringify(e));
  }

  var Diff = {
    _lastDiff: null,
    _picks: {}, /* index trong diff.items -> 'A' | 'B' */
    _panelEl: null
  };

  /* ---------- diff ---------- */
  /* Trả { aName, bName, items: [...], summary: {added, removed, changed, total} }
   * Mỗi item: { kind, uuid (uuid ở A, hoặc ở B nếu added), name, type,
   *   a: entryA|null, b: entryB|null, changes: [{field, from, to}] } */
  Diff.diff = function (listA, listB, aName, bName) {
    listA = listA || [];
    listB = listB || [];
    var byUuidA = {}, byUuidB = {};
    var nameCountA = {}, nameCountB = {};
    listA.forEach(function (e) {
      byUuidA[e.uuid] = e;
      nameCountA[e.name] = (nameCountA[e.name] || 0) + 1;
    });
    listB.forEach(function (e) {
      byUuidB[e.uuid] = e;
      nameCountB[e.name] = (nameCountB[e.name] || 0) + 1;
    });
    var matchedB = {}; /* uuid B đã khớp */
    var items = [];

    function compareFields(a, b) {
      var changes = [];
      var fields = ['position', 'rotation', 'scale', 'visible', 'locked', 'type', 'name', 'primKind', 'isPrimitive', 'material'];
      fields.forEach(function (f) {
        var hasA = a && a[f] !== undefined;
        var hasB = b && b[f] !== undefined;
        if (!hasA && !hasB) return;
        if (!valEq(a ? a[f] : undefined, b ? b[f] : undefined)) {
          changes.push({ field: f, from: a ? a[f] : undefined, to: b ? b[f] : undefined });
        }
      });
      return changes;
    }

    listA.forEach(function (a) {
      var b = byUuidB[a.uuid] || null;
      var matchedBy = 'uuid';
      if (!b) {
        /* fallback tên — chỉ khi tên duy nhất ở cả 2 bản */
        if (nameCountA[a.name] === 1 && nameCountB[a.name] === 1) {
          var cand = null;
          listB.forEach(function (e) { if (e.name === a.name) cand = e; });
          if (cand && !matchedB[cand.uuid]) { b = cand; matchedBy = 'name'; }
        }
      }
      if (!b) {
        items.push({ kind: 'removed', uuid: a.uuid, name: a.name, type: a.type, a: cloneEntry(a), b: null, changes: [], matchedBy: null });
        return;
      }
      matchedB[b.uuid] = true;
      var changes = compareFields(a, b);
      if (changes.length) {
        items.push({ kind: 'changed', uuid: a.uuid, name: a.name, type: a.type, a: cloneEntry(a), b: cloneEntry(b), changes: changes, matchedBy: matchedBy });
      }
    });

    listB.forEach(function (b) {
      if (!matchedB[b.uuid]) {
        items.push({ kind: 'added', uuid: b.uuid, name: b.name, type: b.type, a: null, b: cloneEntry(b), changes: [], matchedBy: null });
      }
    });

    var summary = { added: 0, removed: 0, changed: 0, total: items.length };
    items.forEach(function (it) { summary[it.kind]++; });
    var result = { aName: aName || 'A', bName: bName || 'B', items: items, summary: summary, at: new Date().toISOString() };
    Diff._lastDiff = result;
    Diff._picks = {};
    items.forEach(function (it, i) { Diff._picks[i] = 'B'; }); /* mặc định: lấy B */
    return result;
  };

  /* ---------- merge lên DANH SÁCH (pure) ---------- */
  /* picks: { index -> 'A'|'B' }; thiếu index -> mặc định 'B'.
   * Trả danh sách mới = A đã áp các mục chọn B. */
  Diff.applyToList = function (listA, diff, picks) {
    var out = (listA || []).map(cloneEntry);
    var byUuid = {};
    out.forEach(function (e) { byUuid[e.uuid] = e; });
    var removedUuids = {};
    diff.items.forEach(function (item, i) {
      var pick = (picks && picks[i]) || Diff._picks[i] || 'B';
      if (pick === 'A') return; /* giữ bản A: không làm gì */
      if (item.kind === 'added') {
        var nb = cloneEntry(item.b);
        if (!byUuid[nb.uuid]) { out.push(nb); byUuid[nb.uuid] = nb; }
      } else if (item.kind === 'removed') {
        removedUuids[item.uuid] = true;
      } else if (item.kind === 'changed') {
        var target = byUuid[item.uuid];
        if (!target) {
          /* khớp bằng tên (uuid đã đổi) — tìm theo tên trong out */
          out.forEach(function (e) { if (e.name === item.a.name && !target) target = e; });
        }
        if (target) {
          item.changes.forEach(function (c) {
            target[c.field] = cloneEntry(item.b[c.field]);
          });
          /* đồng bộ cả uuid mới nếu khớp bằng tên */
          if (item.b.uuid !== item.a.uuid && target.uuid === item.a.uuid) target.uuid = item.b.uuid;
        }
      }
    });
    return out.filter(function (e) { return !removedUuids[e.uuid]; });
  };

  Diff.applyAllFromB = function (listA, diff) {
    var picks = {};
    diff.items.forEach(function (it, i) { picks[i] = 'B'; });
    return Diff.applyToList(listA, diff, picks);
  };

  Diff.keepAllA = function (listA) {
    return (listA || []).map(cloneEntry);
  };

  /* ---------- merge lên SCENE THẬT ---------- */
  /* picks như trên. Trả { applied: n, skipped: [{name, reason}], errors: [] }.
   * - removed: Scene.deleteObject (qua registry).
   * - changed: set transform/visible/locked trực tiếp lên object3D.
   * - added: chỉ primitive tái tạo được; model/light/camera -> skipped. */
  Diff.applyToScene = function (diff, picks) {
    var Scene = PixiStudio.Scene;
    var report = { applied: 0, skipped: [], errors: [] };
    if (!Scene || !Scene.registry) { report.errors.push('Scene registry không có sẵn'); return report; }
    diff.items.forEach(function (item, i) {
      var pick = (picks && picks[i]) || Diff._picks[i] || 'B';
      if (pick === 'A') return;
      try {
        if (item.kind === 'removed') {
          var regR = Scene.registry[item.uuid];
          if (regR && regR.object3D) { Scene.deleteObject(regR.object3D); report.applied++; }
          else report.skipped.push({ name: item.name, reason: 'Object đã không còn trong scene' });
        } else if (item.kind === 'changed') {
          var regC = Scene.registry[item.uuid];
          if (!regC && item.a) {
            /* thử tìm theo tên (uuid đổi) */
            Object.keys(Scene.registry).forEach(function (u) {
              if (Scene.registry[u].name === item.a.name) regC = Scene.registry[u];
            });
          }
          if (!regC || !regC.object3D) { report.skipped.push({ name: item.name, reason: 'Không tìm thấy object trong scene' }); return; }
          var o = regC.object3D;
          item.changes.forEach(function (c) {
            if (c.field === 'position' && Array.isArray(c.to)) o.position.fromArray(c.to);
            else if (c.field === 'rotation' && Array.isArray(c.to)) o.rotation.fromArray(c.to);
            else if (c.field === 'scale' && Array.isArray(c.to)) o.scale.fromArray(c.to);
            else if (c.field === 'visible') o.visible = !!c.to;
            else if (c.field === 'locked') regC.locked = !!c.to;
            else if (c.field === 'name') { regC.name = c.to; o.name = c.to; }
          });
          report.applied++;
        } else if (item.kind === 'added') {
          if (item.b && item.b.isPrimitive && Scene.createPrimitiveByName) {
            var obj = Scene.createPrimitiveByName(item.b.primKind || 'box');
            if (obj) {
              obj.name = item.b.name;
              if (Array.isArray(item.b.position)) obj.position.fromArray(item.b.position);
              if (Array.isArray(item.b.rotation)) obj.rotation.fromArray(item.b.rotation);
              if (Array.isArray(item.b.scale)) obj.scale.fromArray(item.b.scale);
              obj.visible = item.b.visible !== false;
              var regN = Scene.registry[obj.uuid];
              if (regN) { regN.name = item.b.name; regN.locked = !!item.b.locked; }
              report.applied++;
            } else {
              report.skipped.push({ name: item.name, reason: 'Không tạo được primitive ' + (item.b.primKind || '') });
            }
          } else {
            report.skipped.push({ name: item.name, reason: 'Chỉ tái tạo được primitive; model/light (' + (item.b ? item.b.type : '?') + ') cần file gốc, không tự tạo' });
          }
        }
      } catch (err) {
        report.errors.push(item.name + ': ' + String(err && err.message || err));
      }
    });
    try { bus.emit('scene:changed', { action: 'diff-merge', applied: report.applied }); } catch (e) { /* ignore */ }
    return report;
  };

  /* ---------- nguồn so sánh tiện dụng ---------- */
  Diff.currentSerialized = function () {
    if (PixiStudio.Scene && PixiStudio.Scene.serializeObjects) return PixiStudio.Scene.serializeObjects();
    return [];
  };

  Diff.savedSerialized = function (projectName) {
    try {
      var raw = localStorage.getItem('pixiStudio.project.' + projectName);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return data.objects || [];
    } catch (e) { return null; }
  };

  Diff.compareCurrentWithSaved = function (projectName) {
    var saved = Diff.savedSerialized(projectName);
    if (saved === null) return null;
    return Diff.diff(Diff.currentSerialized(), saved, 'Hiện tại', 'Đã lưu: ' + projectName);
  };

  Diff.listSavedProjects = function () {
    if (PixiStudio.Storage && PixiStudio.Storage.listProjects) return PixiStudio.Storage.listProjects();
    return [];
  };

  /* ---------- xuất báo cáo ---------- */
  Diff.exportReport = function (diff) {
    diff = diff || Diff._lastDiff;
    if (!diff) return null;
    var text = JSON.stringify(diff, null, 2);
    try {
      if (U && U.downloadText) U.downloadText(text, 'scene-diff-' + Date.now() + '.json', 'application/json');
    } catch (e) { /* môi trường không có download — vẫn trả text */ }
    return text;
  };

  /* ---------- UI ---------- */
  Diff.renderPanel = function (container, diff) {
    var wrap = container || document.getElementById('scene-diff-panel');
    if (!wrap) return null;
    diff = diff || Diff._lastDiff;
    wrap.innerHTML = '';
    wrap.appendChild(el('h4', { text: 'Scene Diff / Merge' }));

    if (!diff) {
      wrap.appendChild(el('div', { style: 'font-size:12px;color:var(--text-4);', text: 'Chưa có bản diff nào. So sánh scene hiện tại với 1 project đã lưu, hoặc chạy từ code: PixiStudio.SceneDiff.diff(listA, listB).' }));
    }

    /* hàng chọn nguồn */
    var srcRow = el('div', { style: 'display:flex;gap:6px;margin:6px 0;flex-wrap:wrap;' });
    var sel = el('select', { style: 'flex:1;min-width:140px;' });
    sel.appendChild(el('option', { value: '', text: '— Chọn project đã lưu (B) —' }));
    Diff.listSavedProjects().forEach(function (p) {
      sel.appendChild(el('option', { value: p.name, text: p.name + ' (' + (p.savedAt || '?') + ')' }));
    });
    srcRow.appendChild(sel);
    srcRow.appendChild(el('button', {
      class: 'btn sm', text: 'So với hiện tại',
      onclick: function () {
        if (!sel.value) return;
        var d = Diff.compareCurrentWithSaved(sel.value);
        if (!d) { try { bus.emit('notify', { type: 'warn', title: 'Diff', message: 'Không đọc được project đã lưu.' }); } catch (e) {} return; }
        Diff.renderPanel(wrap, d);
      }
    }));
    wrap.appendChild(srcRow);

    if (diff) {
      var s = diff.summary;
      wrap.appendChild(el('div', {
        style: 'font-size:12px;margin:4px 0;',
        text: diff.aName + '  →  ' + diff.bName + ' — ' + s.total + ' khác biệt: +' + s.added + ' thêm, −' + s.removed + ' xóa, ~' + s.changed + ' đổi'
      }));
      if (!diff.items.length) {
        wrap.appendChild(el('div', { style: 'font-size:12px;color:var(--text-4);', text: 'Hai bản giống hệt nhau.' }));
      } else {
        var table = el('table', { class: 'diff-table', style: 'width:100%;font-size:12px;border-collapse:collapse;' });
        var thead = el('tr', {}, [
          el('th', { text: 'Object', style: 'text-align:left;border-bottom:1px solid var(--border);' }),
          el('th', { text: 'Đổi', style: 'text-align:left;border-bottom:1px solid var(--border);' }),
          el('th', { text: 'A (' + diff.aName + ')', style: 'text-align:left;border-bottom:1px solid var(--border);' }),
          el('th', { text: 'B (' + diff.bName + ')', style: 'text-align:left;border-bottom:1px solid var(--border);' }),
          el('th', { text: 'Lấy', style: 'border-bottom:1px solid var(--border);' })
        ]);
        table.appendChild(thead);
        diff.items.forEach(function (item, i) {
          var changeText = item.kind === 'changed'
            ? item.changes.map(function (c) { return c.field; }).join(', ')
            : (item.kind === 'added' ? 'thêm mới' : 'đã xóa');
          var aText = item.kind === 'added' ? '—' : (item.kind === 'changed'
            ? item.changes.map(function (c) { return c.field + ': ' + fmtVal(c.from); }).join(' | ')
            : fmtVal(item.a ? item.a.position : null));
          var bText = item.kind === 'removed' ? '—' : (item.kind === 'changed'
            ? item.changes.map(function (c) { return c.field + ': ' + fmtVal(c.to); }).join(' | ')
            : fmtVal(item.b ? item.b.position : null));
          var pickCell = el('td', { style: 'text-align:center;white-space:nowrap;' });
          [['A', 'A'], ['B', 'B']].forEach(function (opt) {
            var r = el('input', { type: 'radio', name: 'diff-pick-' + i, value: opt[0], title: opt[0] === 'A' ? 'Giữ bản A' : 'Lấy bản B' });
            r.checked = (Diff._picks[i] || 'B') === opt[0];
            r.addEventListener('change', function () { Diff._picks[i] = opt[0]; });
            pickCell.appendChild(r);
            pickCell.appendChild(el('span', { text: opt[0] + ' ', style: 'font-size:11px;' }));
          });
          table.appendChild(el('tr', {}, [
            el('td', { text: item.name + ' (' + (item.type || '?') + ')' }),
            el('td', { text: changeText }),
            el('td', { text: aText }),
            el('td', { text: bText }),
            pickCell
          ]));
        });
        wrap.appendChild(table);
      }

      var btnRow = el('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;' });
      btnRow.appendChild(el('button', {
        class: 'btn sm', text: 'Áp lựa chọn lên scene',
        onclick: function () {
          var rep = Diff.applyToScene(diff, Diff._picks);
          try { bus.emit('notify', { type: rep.errors.length ? 'warn' : 'success', title: 'Merge', message: 'Đã áp ' + rep.applied + ' mục, bỏ qua ' + rep.skipped.length + ', lỗi ' + rep.errors.length + '.' }); } catch (e) {}
          Diff.renderPanel(wrap, diff);
        }
      }));
      btnRow.appendChild(el('button', {
        class: 'btn sm', text: 'Áp tất cả từ B',
        onclick: function () {
          var picks = {}; diff.items.forEach(function (it, i) { picks[i] = 'B'; });
          Diff.applyToScene(diff, picks);
          Diff.renderPanel(wrap, diff);
        }
      }));
      btnRow.appendChild(el('button', {
        class: 'btn sm', text: 'Giữ tất cả A',
        onclick: function () {
          var picks = {}; diff.items.forEach(function (it, i) { picks[i] = 'A'; });
          Diff.applyToScene(diff, picks);
          Diff.renderPanel(wrap, diff);
        }
      }));
      btnRow.appendChild(el('button', {
        class: 'btn sm', text: 'Xuất báo cáo JSON',
        onclick: function () { Diff.exportReport(diff); }
      }));
      wrap.appendChild(btnRow);
    }

    Diff._panelEl = wrap;
    return wrap;
  };

  Diff.renderPageSection = function () {
    var wrap = el('div', { class: 'page-block', id: 'scene-diff-panel' });
    Diff.renderPanel(wrap, Diff._lastDiff);
    return wrap;
  };

  Diff.registerPageSection = function () {
    if (!PixiStudio.Scene) return false;
    PixiStudio.Scene._extraPageSections = PixiStudio.Scene._extraPageSections || [];
    if (PixiStudio.Scene._extraPageSections.indexOf(Diff.renderPageSection) === -1) {
      PixiStudio.Scene._extraPageSections.push(Diff.renderPageSection);
    }
    return true;
  };

  Diff.init = function () {
    Diff.registerPageSection();
    return Diff;
  };

  window.PixiStudio.SceneDiff = Diff;
  Diff.init();
})();
