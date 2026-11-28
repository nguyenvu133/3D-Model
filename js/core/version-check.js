/* ============================================================
 * core/version-check.js — Tự kiểm tra bản mới, tự tải lại
 *
 * Vấn đề: GitHub Pages trả Cache-Control: max-age=600 cho
 * index.html, nên sau mỗi lần đẩy user phải tự gõ ?v=N hoặc chờ
 * ~10 phút mới thấy bản mới. Module này bỏ hẳn việc đó:
 *   - Chạy ngay khi parser tới (script đứng đầu <head>, sau
 *     watchdog): fetch version.json với cache:'no-store' để qua
 *     mặt cache 10 phút của Pages, so với bản đang chạy
 *     (window.__PIXISTUDIO_BUILD, nhúng ở index.html).
 *   - Khác nhau → hiện "Đang tải bản mới…" rồi tự tải lại với
 *     ?v=<bản mới> (giữ nguyên các param khác như scene=/from=).
 *   - Chỉ reload TỐI ĐA 1 LẦN cho 1 version trong 1 phiên
 *     (cờ sessionStorage): Pages deploy chậm vài phút — nếu reload
 *     xong vẫn cũ thì thôi, để user dùng bản cũ bình thường.
 *   - KHÔNG chặn boot: fetch chạy bất đồng bộ, timeout 5s
 *     (AbortController), lỗi/timeout/offline/file:// → im lặng,
 *     không toast lỗi, không chặn gì.
 *   - ĐÃ BOOT XONG mới phát hiện bản mới (vd mạng chậm, fetch về
 *     muộn): KHÔNG ép reload giữa lúc user đang làm việc — chỉ
 *     hiện banner nhỏ dưới màn hình với nút "Tải lại bản mới".
 *
 * KHÔNG dùng service worker, KHÔNG dùng thẻ meta no-cache.
 * ============================================================ */
(function () {
  'use strict';

  var VERSION_URL = 'version.json';
  var TIMEOUT_MS = 5000;      /* fetch version.json quá 5s → bỏ qua */
  var RELOAD_DELAY_MS = 900;  /* cho user kịp đọc "Đang tải bản mới…" */
  var FLAG_KEY = 'pixistudio.update-reloaded'; /* sessionStorage: version đã reload cho */
  var MSG_NEW = '🔄 Đang tải bản mới…';

  function log(msg) {
    try { console.info('[version-check] ' + msg); } catch (e) {}
  }

  /* Bản đang chạy: marker nhúng ở <head> index.html (có trước mọi
     script khác); fallback sang PixiStudio.BUILD ở js/core/version.js. */
  function getCurrent() {
    if (window.__PIXISTUDIO_BUILD) return String(window.__PIXISTUDIO_BUILD);
    if (window.PixiStudio && window.PixiStudio.BUILD) return String(window.PixiStudio.BUILD);
    return '';
  }

  function storeGet(key) {
    try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (e) {}
  }

  function isBooted() {
    return !!(window.PixiStudio && window.PixiStudio.App && window.PixiStudio.App.booted);
  }

  /* URL tải lại: giữ nguyên mọi param hiện có, chỉ đặt/thay ?v=. */
  function buildReloadUrl(latest) {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set('v', latest);
      return u.toString();
    } catch (e) {
      /* Fallback cho trình duyệt rất cũ không có URL API. */
      var href = String(window.location.href).split('#')[0];
      var parts = href.split('?');
      var base = parts[0];
      var params = parts[1] ? parts[1].split('&') : [];
      var out = [];
      var seen = false;
      var i, kv;
      for (i = 0; i < params.length; i++) {
        if (!params[i]) continue;
        kv = params[i].split('=');
        if (kv[0] === 'v') { out.push('v=' + encodeURIComponent(latest)); seen = true; }
        else out.push(params[i]);
      }
      if (!seen) out.push('v=' + encodeURIComponent(latest));
      return base + '?' + out.join('&');
    }
  }

  /* Đường reload đi qua hook để test chặn được (jsdom không navigate
     thật): production không đặt __versionCheckNav → location.replace. */
  function navigate(url) {
    if (typeof window.__versionCheckNav === 'function') {
      window.__versionCheckNav(url);
      return;
    }
    window.location.replace(url);
  }

  /* Hiện "Đang tải bản mới…" — ưu tiên ghi lên #boot-status (splash
     đang hiện), nếu chưa có body thì đợi DOM sẵn rồi hiện banner. */
  function showUpdating(latest) {
    var msg = MSG_NEW + ' ' + latest;
    function apply() {
      var st = document.getElementById('boot-status');
      if (st) { st.textContent = msg; return true; }
      if (document.body) {
        var d = document.createElement('div');
        d.id = 'pixistudio-update-banner';
        d.textContent = msg;
        d.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;background:#1c2333;color:#fff;padding:10px 16px;border-radius:8px;font:14px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)';
        document.body.appendChild(d);
        return true;
      }
      return false;
    }
    if (apply()) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function onReady() {
        document.removeEventListener('DOMContentLoaded', onReady);
        apply();
      });
    } else {
      setTimeout(apply, 300);
    }
  }

  /* Đã boot xong mới biết có bản mới: không ép reload, chỉ hiện
     banner với nút bấm — tránh mất việc user đang làm dở. */
  function showUpdateBanner(latest) {
    function apply() {
      if (!document.body) return false;
      if (document.getElementById('pixistudio-update-banner')) return true;
      var d = document.createElement('div');
      d.id = 'pixistudio-update-banner';
      d.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;background:#1c2333;color:#fff;padding:10px 14px;border-radius:8px;font:14px sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);display:flex;gap:10px;align-items:center';
      var span = document.createElement('span');
      span.textContent = 'Có bản mới ' + latest + ' — bấm để tải lại.';
      var btn = document.createElement('button');
      btn.textContent = 'Tải lại bản mới';
      btn.style.cssText = 'background:#713BFF;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font:14px sans-serif';
      btn.onclick = function () {
        storeSet(FLAG_KEY, latest);
        navigate(buildReloadUrl(latest));
      };
      var x = document.createElement('button');
      x.textContent = '✕';
      x.setAttribute('aria-label', 'Đóng');
      x.style.cssText = 'background:transparent;color:#9aa3b2;border:0;cursor:pointer;font:14px sans-serif';
      x.onclick = function () { if (d.parentNode) d.parentNode.removeChild(d); };
      d.appendChild(span);
      d.appendChild(btn);
      d.appendChild(x);
      document.body.appendChild(d);
      return true;
    }
    if (apply()) return;
    document.addEventListener('DOMContentLoaded', function onReady() {
      document.removeEventListener('DOMContentLoaded', onReady);
      apply();
    });
  }

  function fetchLatest() {
    if (typeof window.fetch !== 'function') return null;
    var opts = { cache: 'no-store' };
    var controller = null;
    var timer = null;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      opts.signal = controller.signal;
      timer = setTimeout(function () {
        try { controller.abort(); } catch (e) {}
      }, TIMEOUT_MS);
    }
    var p = window.fetch(VERSION_URL, opts);
    if (timer) {
      p = p.then(function (res) { clearTimeout(timer); return res; },
        function (err) { clearTimeout(timer); throw err; });
    }
    return p;
  }

  function check() {
    var current = getCurrent();
    var p = fetchLatest();
    if (!p) return; /* không có fetch (trình duyệt quá cũ / file://) → thôi */
    p.then(function (res) {
      if (!res || !res.ok) return null;
      return res.json();
    }).then(function (data) {
      if (!data) return;
      var latest = String((data && data.version) || '').trim();
      if (!latest) return;
      if (latest === current) { log('đang chạy bản mới nhất (' + current + ')'); return; }
      /* Đã reload cho bản này 1 lần trong phiên mà vẫn cũ → Pages
         chưa deploy xong, dừng lại, để user dùng bản cũ bình thường. */
      if (storeGet(FLAG_KEY) === latest) {
        log('bản mới ' + latest + ' chưa deploy xong (đã reload 1 lần) — dùng bản cũ');
        return;
      }
      log('có bản mới ' + latest + ' (đang chạy ' + (current || '(không rõ)') + ')');
      if (isBooted()) { showUpdateBanner(latest); return; }
      storeSet(FLAG_KEY, latest);
      showUpdating(latest);
      setTimeout(function () { navigate(buildReloadUrl(latest)); }, RELOAD_DELAY_MS);
    }).catch(function () {
      /* fetch lỗi / timeout / JSON hỏng / offline → im lặng,
         dùng bản cũ bình thường, không toast lỗi, không chặn boot. */
    });
  }

  /* Chạy ngay khi parser tới: fetch bắt đầu sớm, song song với phần
     còn lại của trang — không chặn boot. */
  try { check(); } catch (e) {}

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.VersionCheck = {
    check: check,
    _test: {
      getCurrent: getCurrent,
      buildReloadUrl: buildReloadUrl,
      showUpdating: showUpdating,
      showUpdateBanner: showUpdateBanner,
      fetchLatest: fetchLatest,
      FLAG_KEY: FLAG_KEY,
      TIMEOUT_MS: TIMEOUT_MS
    }
  };
})();
