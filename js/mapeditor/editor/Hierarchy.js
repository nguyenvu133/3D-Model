/* ============================================================
 * mapeditor/editor/Hierarchy.js — Cây Hierarchy (nhóm + object)
 * Tạo/xoá/đổi tên/duplicate/group, search, ẩn/khoá, click chọn
 * → focus viewport. Kéo-thả đổi nhóm. Render lại khi scene đổi.
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  var Hierarchy = {
    _container: null,
    _search: '',
    _collapsed: {},
    _dragId: null
  };

  Hierarchy.init = function (container, searchInput) {
    Hierarchy._container = container;
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        Hierarchy._search = searchInput.value.trim().toLowerCase();
        Hierarchy.render();
      });
    }
  };

  function el(tag, cls, text, onclick) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    if (onclick) e.addEventListener('click', onclick);
    return e;
  }

  Hierarchy.render = function () {
    var c = Hierarchy._container;
    if (!c || !ME.MapEditor) return;
    c.innerHTML = '';
    var data = ME.MapEditor.data;
    if (!data) return;
    var q = Hierarchy._search;
    var groups = {};
    ME.SceneData.GROUPS.forEach(function (g) { groups[g] = []; });
    data.objects.forEach(function (o) {
      var g = o.group || 'Props';
      if (!groups[g]) groups[g] = [];
      groups[g].push(o);
    });
    /* Scene root */
    var rootRow = el('div', 'h-row h-root', '▾ Scene — ' + (data.name || 'Untitled'));
    rootRow.addEventListener('click', function () { ME.MapEditor.select(null); });
    c.appendChild(rootRow);
    Object.keys(groups).forEach(function (gname) {
      var list = groups[gname];
      if (q) list = list.filter(function (o) { return o.name.toLowerCase().indexOf(q) >= 0 || o.type.toLowerCase().indexOf(q) >= 0; });
      if (!list.length && q) return;
      var open = !Hierarchy._collapsed[gname];
      var grow = el('div', 'h-row h-group');
      var caret = el('span', 'h-caret', open ? '▾ ' : '▸ ');
      grow.appendChild(caret);
      grow.appendChild(el('span', 'h-group-name', gname + '  (' + list.length + ')'));
      grow.addEventListener('click', function () {
        Hierarchy._collapsed[gname] = open;
        Hierarchy.render();
      });
      c.appendChild(grow);
      if (!open) return;
      list.forEach(function (o) {
        var sel = ME.MapEditor.selectedId() === o.id;
        var row = el('div', 'h-row h-obj' + (sel ? ' selected' : '') + (o.visible === false ? ' hidden-obj' : '') + (o.locked ? ' locked-obj' : ''));
        row.style.paddingLeft = '26px';
        row.draggable = true;
        row.dataset.id = o.id;
        row.appendChild(el('span', 'h-icon', Hierarchy._iconFor(o.type)));
        row.appendChild(el('span', 'h-name', o.name));
        var acts = el('span', 'h-actions');
        var eye = el('button', 'h-btn', o.visible === false ? '○' : '●', function (e) {
          e.stopPropagation();
          ME.MapEditor.toggleVisible(o.id);
        });
        eye.title = o.visible === false ? 'Hiện' : 'Ẩn';
        var lock = el('button', 'h-btn', o.locked ? '🔒' : '🔓', function (e) {
          e.stopPropagation();
          ME.MapEditor.toggleLock(o.id);
        });
        lock.title = o.locked ? 'Mở khoá' : 'Khoá';
        acts.appendChild(eye);
        acts.appendChild(lock);
        row.appendChild(acts);
        row.addEventListener('click', function () {
          ME.MapEditor.select(o.id);
        });
        row.addEventListener('dblclick', function () {
          var nn = window.prompt('Đổi tên object:', o.name);
          if (nn && nn.trim()) ME.MapEditor.rename(o.id, nn.trim());
        });
        row.addEventListener('dragstart', function (e) {
          Hierarchy._dragId = o.id;
          e.dataTransfer.setData('text/plain', o.id);
        });
        row.addEventListener('dragover', function (e) { e.preventDefault(); row.classList.add('drag-over'); });
        row.addEventListener('dragleave', function () { row.classList.remove('drag-over'); });
        row.addEventListener('drop', function (e) {
          e.preventDefault();
          row.classList.remove('drag-over');
          var src = Hierarchy._dragId;
          if (src && src !== o.id) {
            /* kéo object lên object khác → cùng nhóm với object đích */
            var target = ME.MapEditor.getObjectData(o.id);
            if (target) ME.MapEditor.setGroup(src, target.group);
          }
        });
        grow.addEventListener('dragover', function (e) { e.preventDefault(); });
        grow.addEventListener('drop', function (e) {
          e.preventDefault();
          var src = Hierarchy._dragId;
          if (src) ME.MapEditor.setGroup(src, gname);
        });
        c.appendChild(row);
      });
    });
    /* footer: số object */
    var foot = el('div', 'h-foot', data.objects.length + ' objects · ' + ME.SceneData.GROUPS.length + ' groups');
    c.appendChild(foot);
  };

  Hierarchy._iconFor = function (type) {
    var map = {
      temple: '⛩', house: '⌂', gate: '🚪', bridge: '🌉',
      pine: '🌲', bamboo: '🎋', rock: '🪨',
      lantern: '🏮', campfire: '🔥', statue: '🗿', fence: '▦', portal: '🌀',
      hero: '🧑', monster: '👹', boss: '👺',
      light: '💡', patrol: '↝', waterfall: '💧',
      box: '▣', sphere: '●', cylinder: '▭', cone: '▲', plane: '▬',
      model: '⬢', terrain: '⛰'
    };
    return map[type] || '▣';
  };

  ME.Hierarchy = Hierarchy;
})();
