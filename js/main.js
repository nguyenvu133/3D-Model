/* ============================================================
 * main.js — Entry point: DOMContentLoaded → PixiStudio.App.boot()
 * ============================================================ */
(function () {
  'use strict';

  function start() {
    if (window.PixiStudio && PixiStudio.App) {
      PixiStudio.App.boot();
    } else {
      /*retry sau 50ms nếu script chưa ready*/
      setTimeout(start, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
