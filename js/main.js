/* ============================================================
 * main.js — Entry point: DOMContentLoaded → PixiStudio.App.boot()
 *
 * Chống kẹt im lặng ở splash "Initializing engine…":
 *  - Watchdog ~10s: nếu PixiStudio.App vẫn chưa có thì ghi thông báo
 *    chẩn đoán ra #boot-status, NHƯNG vẫn retry tiếp (để khi script
 *    cuối cùng load xong thì boot bình thường).
 *  - App.boot() bọc try/catch: throw thì hiện lỗi ra #boot-status
 *    (kèm tên lỗi) + console.error đầy đủ, thay vì để splash đứng im.
 *
 * LƯU Ý: watchdog ở đây chỉ chạy khi main.js đã load được. Nếu parser
 * kẹt ở script vendor/CDN ĐỨNG TRƯỚC main.js thì watchdog inline trong
 * <head> của index.html (__bootWatchdogTick) mới là lớp báo lỗi — vì
 * lúc đó main.js chưa bao giờ chạy.
 * ============================================================ */
(function () {
  'use strict';

  var WATCHDOG_MS = 10000;
  var MSG_WAIT = '⏳ Đang chờ script… (mạng/CDN chậm hoặc file vendor thiếu — kiểm tra js/vendor/, xem js/vendor/README.md)';
  var startedAt = Date.now();
  var watchdogShown = false;

  function setBootStatus(msg) {
    var st = document.getElementById('boot-status');
    if (st) st.textContent = msg;
  }

  function start() {
    if (window.PixiStudio && PixiStudio.App) {
      try {
        PixiStudio.App.boot();
      } catch (err) {
        try { console.error('[main.js] App.boot() throw:', err); } catch (e) {}
        setBootStatus('❌ Lỗi khi khởi động: ' + (err && err.name ? err.name + ': ' : '') + (err && err.message ? err.message : String(err)));
      }
      return;
    }
    /* App chưa có: retry sau 50ms như cũ + watchdog 10s (chỉ hiện
       thông báo, KHÔNG dừng retry). */
    if (!watchdogShown && Date.now() - startedAt >= WATCHDOG_MS) {
      watchdogShown = true;
      try {
        var cur = (document.getElementById('boot-status') || {}).textContent || '';
        if (cur.indexOf('Initializing engine') !== -1 || cur.indexOf('Đang chờ script') !== -1) {
          setBootStatus(MSG_WAIT);
        }
      } catch (e) { /* watchdog không được tự throw */ }
    }
    setTimeout(start, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
