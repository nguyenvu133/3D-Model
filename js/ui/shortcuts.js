/* ============================================================
 * ui/shortcuts.js — Keyboard shortcuts toàn cục
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Shortcuts = {};

  Shortcuts.setGizmoMode = function (mode) {
    PixiStudio.State.set('gizmoMode', mode);
    PixiStudio.Gizmo.setMode(mode);
    /* sync viewport tools UI */
    U.$$('#viewport-tools .vtool').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tool') === mode);
    });
  };

  Shortcuts.init = function () {
    document.addEventListener('keydown', function (e) {
      const target = e.target;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);

      /* Ctrl combos — hoạt động cả khi đang typing */
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 's') { e.preventDefault(); PixiStudio.Storage.saveProject('quick-save'); bus.emit('notify', { type: 'success', title: 'Project saved', message: 'quick-save (localStorage)' }); return; }
        if (key === 'z') { e.preventDefault(); PixiStudio.History.undo(); return; }
        if (key === 'y') { e.preventDefault(); PixiStudio.History.redo(); return; }
        if (key === 'd') { e.preventDefault(); PixiStudio.Scene.duplicate(PixiStudio.State.get('selection')); return; }
        if (key === 'c' && PixiStudio.Timeline.keys.selectedKey) { e.preventDefault(); PixiStudio.Timeline.keys.copySelected(); return; }
        if (key === 'v' && !typing) { e.preventDefault(); PixiStudio.Timeline.keys.paste(); return; }
        return;
      }

      if (typing) return;

      /* Esc */
      if (e.key === 'Escape') {
        if (PixiStudio.Modals.isOpen()) PixiStudio.Modals.close();
        else {
          PixiStudio.Panels.contextMenu.close();
          PixiStudio.Panels.dropdown.close();
          PixiStudio.State.select(null);
        }
        return;
      }

      /* Gizmo modes */
      if (e.key === 'w' || e.key === 'W') { Shortcuts.setGizmoMode('move'); return; }
      if (e.key === 'e' || e.key === 'E') { Shortcuts.setGizmoMode('rotate'); return; }
      if (e.key === 'r' || e.key === 'R') { Shortcuts.setGizmoMode('scale'); return; }
      if (e.key === 'q' || e.key === 'Q') { Shortcuts.setGizmoMode('select'); return; }

      /* Focus */
      if (e.key === 'f' || e.key === 'F') { PixiStudio.Viewport.focusSelected(); return; }

      /* Space — play/pause */
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); PixiStudio.Playback.toggle(); return; }

      /* K — add keyframe */
      if (e.key === 'k' || e.key === 'K') {
        PixiStudio.Timeline.keys.addKey(PixiStudio.State.get('timelineChannel') || 'position');
        return;
      }

      /* Grid / wireframe */
      if (e.key === 'g' || e.key === 'G') {
        PixiStudio.GridEnv.setVisible(!PixiStudio.GridEnv.visible);
        const btn = document.getElementById('vp-grid-btn');
        if (btn) btn.classList.toggle('active', PixiStudio.GridEnv.visible);
        return;
      }
      if (e.key === 'x' || e.key === 'X') {
        const next = PixiStudio.State.get('shading') === 'wireframe' ? 'lit' : 'wireframe';
        PixiStudio.State.set('shading', next);
        document.getElementById('shading-select').value = next;
        PixiStudio.Viewport.invalidateShading();
        return;
      }

      /* Tab — collapse left */
      if (e.key === 'Tab') {
        e.preventDefault();
        const app = document.getElementById('app');
        app.classList.toggle('left-collapsed');
        PixiStudio.State.set('leftCollapsed', app.classList.contains('left-collapsed'));
        return;
      }

      /* Number views */
      const viewMap = {
        '1': 'perspective', '2': 'quad', '3': 'front', '4': 'back',
        '5': 'left', '6': 'right', '7': 'top', '8': 'bottom'
      };
      if (viewMap[e.key]) {
        PixiStudio.Viewport.setView(viewMap[e.key]);
        const sel = document.getElementById('view-mode-select');
        if (sel) sel.value = viewMap[e.key];
        const sbView = document.getElementById('sb-view');
        if (sbView) sbView.textContent = 'View: ' + viewMap[e.key];
        return;
      }

      /* Delete */
      if (e.key === 'Delete' || e.key === 'Backspace') {
        /* nếu đang chọn keyframe → xoá key */
        if (PixiStudio.Timeline.keys.selectedKey) {
          PixiStudio.Timeline.keys.deleteSelected();
        } else {
          PixiStudio.Scene.deleteObject(PixiStudio.State.get('selection'));
        }
        return;
      }
    });

    /* Chặn mặc định Ctrl+S / Ctrl+D trong browser */
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && ['s', 'd'].indexOf(e.key.toLowerCase()) !== -1) {
        e.preventDefault();
      }
    });
  };

  window.PixiStudio.Shortcuts = Shortcuts;
})();
