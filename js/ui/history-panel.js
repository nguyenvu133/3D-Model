/* ============================================================
 * ui/history-panel.js — Panel Lịch sử Undo/Redo (v2, 2026-11-27)
 * Mở bằng nút "Lịch sử" trên topbar. Hiển thị CẢ 2 STACK:
 *   (1) Stack toàn cục PixiStudio.History — scene-level
 *       (import/transform/material/physics/asset/rig/pose/keyframe)
 *   (2) Stack ArpQuickRig.History — clip-data Animator
 *       (trim/retime/reverse/mirror/layers, qua sync-history)
 * Bấm 1 bước (1) để nhảy tới bước đó (History.jumpTo).
 * Bước (2) chỉ xem + undo/redo riêng bằng nút của nó (không nhảy
 * chéo stack — 2 stack độc lập, xem ranh giới ở history.js).
 * Style inline để không đụng CSS chung các vòng khác đang sửa.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;

  const HistoryPanel = {
    _el: null,
    _open: false
  };

  function _fmtTime(t) {
    try {
      const d = new Date(t);
      const p = function (n) { return (n < 10 ? '0' : '') + n; };
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    } catch (e) { return ''; }
  }

  HistoryPanel._build = function () {
    const el = document.createElement('div');
    el.id = 'history-panel';
    el.style.cssText = 'position:fixed;top:52px;right:12px;width:320px;max-width:92vw;max-height:70vh;' +
      'display:none;flex-direction:column;z-index:1200;background:var(--surface,#1c1c26);' +
      'color:var(--text,#eee);border:1px solid var(--border,#3a3a4a);border-radius:12px;' +
      'box-shadow:0 12px 32px rgba(0,0,0,.45);overflow:hidden;font-size:12px;';
    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border,#3a3a4a);">' +
        '<b style="flex:1;font-size:13px;">Lịch sử — Undo / Redo</b>' +
        '<button class="btn sm" id="hp-clear" data-tooltip="Xoá toàn bộ lịch sử">Xoá</button>' +
        '<button class="btn sm" id="hp-close" aria-label="Đóng">✕</button>' +
      '</div>' +
      '<div style="display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid var(--border,#3a3a4a);">' +
        '<button class="btn sm grow" id="hp-undo">↩ Undo (Ctrl+Z)</button>' +
        '<button class="btn sm grow" id="hp-redo">↪ Redo (Ctrl+Shift+Z)</button>' +
      '</div>' +
      '<div id="hp-list" style="overflow-y:auto;padding:6px 8px;"></div>' +
      '<div id="hp-qr" style="padding:8px 12px;border-top:1px solid var(--border,#3a3a4a);color:var(--muted,#aaa);"></div>';
    document.body.appendChild(el);
    HistoryPanel._el = el;

    el.querySelector('#hp-close').addEventListener('click', function () { HistoryPanel.toggle(false); });
    el.querySelector('#hp-clear').addEventListener('click', function () {
      if (PixiStudio.History) PixiStudio.History.clear();
      HistoryPanel.render();
    });
    el.querySelector('#hp-undo').addEventListener('click', function () {
      if (PixiStudio.History) PixiStudio.History.undo();
    });
    el.querySelector('#hp-redo').addEventListener('click', function () {
      if (PixiStudio.History) PixiStudio.History.redo();
    });
    return el;
  };

  HistoryPanel.render = function () {
    if (!HistoryPanel._el || !HistoryPanel._open) return;
    const H = PixiStudio.History;
    const listEl = HistoryPanel._el.querySelector('#hp-list');
    const qrEl = HistoryPanel._el.querySelector('#hp-qr');
    if (!H) { listEl.innerHTML = '<div style="padding:10px;color:var(--muted,#aaa);">History chưa load.</div>'; return; }
    const steps = H.list();
    const undoBtn = HistoryPanel._el.querySelector('#hp-undo');
    const redoBtn = HistoryPanel._el.querySelector('#hp-redo');
    if (undoBtn) undoBtn.disabled = !H.canUndo();
    if (redoBtn) redoBtn.disabled = !H.canRedo();
    if (!steps.length) {
      listEl.innerHTML = '<div style="padding:10px;color:var(--muted,#aaa);">Chưa có thao tác nào. Thao tác (import, di chuyển, đổi material, rig…) sẽ hiện ở đây.</div>';
    } else {
      listEl.innerHTML = '';
      /* mới nhất lên đầu — bấm để nhảy tới bước đó */
      for (let i = steps.length - 1; i >= 0; i--) {
        const s = steps[i];
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:8px;cursor:pointer;' +
          (s.current
            ? 'background:rgba(113,59,255,.22);outline:1px solid #713bff;font-weight:600;'
            : 'background:transparent;');
        row.title = 'Bấm để nhảy tới bước này';
        const dot = document.createElement('span');
        dot.textContent = s.current ? '●' : '○';
        dot.style.color = s.current ? '#a78bfa' : 'var(--muted,#888)';
        const label = document.createElement('span');
        label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        label.textContent = s.label;
        const time = document.createElement('span');
        time.style.cssText = 'color:var(--muted,#888);font-size:11px;';
        time.textContent = _fmtTime(s.time);
        row.appendChild(dot); row.appendChild(label); row.appendChild(time);
        (function (idx) {
          row.addEventListener('click', function () {
            if (PixiStudio.History) PixiStudio.History.jumpTo(idx);
          });
        })(s.index);
        listEl.appendChild(row);
      }
    }
    /* Stack thứ 2: QuickRig/Animator (chỉ xem + undo/redo riêng) */
    try {
      const QR = PixiStudio.ArpQuickRig && PixiStudio.ArpQuickRig.History;
      if (QR && typeof QR.getHistoryLabels === 'function') {
        const labels = QR.getHistoryLabels() || [];
        qrEl.innerHTML = '';
        const t = document.createElement('div');
        t.innerHTML = '<b style="color:var(--text,#eee);">Animator / Quick Rig</b> — ' +
          'stack riêng cho clip (trim/retime/mirror/layers): ' +
          '<b style="color:var(--text,#eee);">' + labels.length + ' bước</b>.';
        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex;gap:6px;margin-top:6px;';
        const bu = document.createElement('button');
        bu.className = 'btn sm grow'; bu.textContent = '↩ Undo clip';
        bu.disabled = !(typeof QR.canUndo === 'function' && QR.canUndo());
        bu.addEventListener('click', function () { QR.undo(); HistoryPanel.render(); });
        const br = document.createElement('button');
        br.className = 'btn sm grow'; br.textContent = '↪ Redo clip';
        br.disabled = !(typeof QR.canRedo === 'function' && QR.canRedo());
        br.addEventListener('click', function () { QR.redo(); HistoryPanel.render(); });
        btns.appendChild(bu); btns.appendChild(br);
        qrEl.appendChild(t); qrEl.appendChild(btns);
      } else if (QR) {
        qrEl.textContent = 'Animator / Quick Rig: stack riêng cho clip đã load (xem tab Quick Rig → Lịch sử).';
      } else {
        qrEl.textContent = 'Animator / Quick Rig: chưa load — clip Animator dùng stack riêng khi mở tab Quick Rig.';
      }
    } catch (e) {
      qrEl.textContent = 'Animator / Quick Rig: không đọc được stack.';
    }
  };

  HistoryPanel.toggle = function (force) {
    HistoryPanel._open = (force !== undefined) ? !!force : !HistoryPanel._open;
    if (!HistoryPanel._el) HistoryPanel._build();
    HistoryPanel._el.style.display = HistoryPanel._open ? 'flex' : 'none';
    if (HistoryPanel._open) HistoryPanel.render();
    return HistoryPanel._open;
  };

  HistoryPanel.init = function () {
    bus.on('history:changed', function () { HistoryPanel.render(); });
    bus.on('history:jumped', function () { HistoryPanel.render(); });
    bus.on('arpqr-history:undone', function () { HistoryPanel.render(); });
    bus.on('arpqr-history:redone', function () { HistoryPanel.render(); });
  };

  window.PixiStudio.HistoryPanel = HistoryPanel;
})();
