/* ============================================================
 * ui/notifications.js — Toast notifications + loading overlay
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const ICONS = { success: 'check', warning: 'warning', error: 'error', info: 'info' };
  let loadingState = null;

  const Notifications = {};

  Notifications.show = function (opts) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const type = opts.type || 'info';
    const toast = U.el('div', { class: 'toast ' + type });
    toast.appendChild(U.el('span', { class: 't-ic', html: U.icon(ICONS[type] || 'info') }));
    const msg = U.el('div', { class: 't-msg' });
    if (opts.title) msg.appendChild(U.el('b', { text: opts.title }));
    if (opts.message) msg.appendChild(U.el('span', { text: opts.message }));
    if (opts.progress !== undefined) {
      const p = U.el('div', { class: 'progress' }, [U.el('i')]);
      p.firstChild.style.width = U.clamp(opts.progress, 0, 100) + '%';
      msg.appendChild(p);
    }
    toast.appendChild(msg);
    toast.appendChild(U.el('button', {
      class: 't-close', html: U.icon('x', 'ic-sm'),
      onclick: function () { dismiss(); }
    }));

    function dismiss() {
      toast.classList.add('out');
      setTimeout(function () { toast.remove(); }, 260);
    }

    root.appendChild(toast);
    const duration = opts.duration || (opts.sticky ? 0 : 4200);
    if (duration > 0) setTimeout(dismiss, duration);

    /* giới hạn 6 toast */
    while (root.children.length > 6) root.removeChild(root.firstChild);
  };

  /* ---------- Loading overlay ---------- */
  Notifications.showLoading = function (message, progress, indeterminate) {
    const el = document.getElementById('task-loading');
    if (!el) return;
    loadingState = { message: message, progress: progress };
    el.classList.add('active');
    const title = document.getElementById('task-loading-title');
    if (title) title.textContent = message || 'Loading…';
    const pct = document.getElementById('task-loading-pct');
    const bar = document.getElementById('task-loading-bar');
    if (pct) pct.textContent = progress !== undefined ? Math.round(progress) + '%' : '…';
    if (bar) bar.style.width = (indeterminate ? 70 : (progress || 0)) + '%';
  };

  Notifications.updateLoading = function (progress, message) {
    if (!loadingState) return Notifications.showLoading(message, progress);
    const pct = document.getElementById('task-loading-pct');
    const bar = document.getElementById('task-loading-bar');
    const title = document.getElementById('task-loading-title');
    if (message && title) title.textContent = message;
    if (pct) pct.textContent = Math.round(progress) + '%';
    if (bar) bar.style.width = U.clamp(progress, 0, 100) + '%';
    loadingState.progress = progress;
  };

  Notifications.hideLoading = function () {
    const el = document.getElementById('task-loading');
    if (el) el.classList.remove('active');
    loadingState = null;
  };

  /* ---------- BOOT overlay helpers ---------- */
  Notifications.bootProgress = function (pct, message) {
    const bar = document.getElementById('boot-bar-fill');
    const status = document.getElementById('boot-status');
    if (bar) bar.style.width = U.clamp(pct, 0, 100) + '%';
    if (status && message) status.textContent = message;
  };

  Notifications.hideBoot = function () {
    const overlay = document.getElementById('boot-overlay');
    if (overlay) {
      overlay.classList.add('hide');
      setTimeout(function () { overlay.remove(); }, 600);
    }
  };

  /* Listen global notify event */
  bus.on('notify', function (data) { Notifications.show(data); });

  window.PixiStudio.Notifications = Notifications;
})();
