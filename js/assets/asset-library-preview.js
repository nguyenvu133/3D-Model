/* ============================================================
 * assets/asset-library-preview.js — XEM TRƯỚC ANIMATION TRONG
 * ASSET LIBRARY (nhóm D)
 *
 * Xem clip NGAY trong Asset Library, không cần import vào scene:
 *   • mỗi card asset có clip thì hiện hàng clip (tên + độ dài) +
 *     nút ▶ phát inline lên thumbnail của card + nút ⤢ mở panel
 *     preview lớn (modal: timeline scrub + play/pause + tên clip
 *     + fps/tracks + nút Mirror);
 *   • modal Chi tiết asset cũng được gắn thêm 1 section preview
 *     (phát inline trong modal, không mở modal lồng nhau).
 *
 * KHÔNG sửa asset-library.js (coordinator Asset Library đang sửa
 * file đó): module này WRAP Library._buildCard / _buildRow /
 * showDetails lúc install() — chỉ thêm DOM, không đổi logic gốc.
 * Nếu Library chưa load hoặc chưa có các hàm đó, install() trả
 * {ok:false} và preview chỉ dùng được qua API trực tiếp.
 *
 * AN TOÀN:
 *   • preview clone object3D của asset (như generateThumbnail) —
 *     model trong scene chính + mixer chính KHÔNG đổi;
 *   • 1 renderer + 1 mixer preview duy nhất, chỉ chạy rAF khi
 *     đang phát; dừng khi đóng modal/card khác/chọn asset khác;
 *   • clone CHIA SẺ geometry/material với model gốc nên KHÔNG
 *     dispose geometry/material của clone (chỉ uncache mixer +
 *     gỡ clone khỏi scene preview);
 *   • rAF tự dừng khi canvas bị gỡ khỏi DOM (đóng modal bằng nút
 *     X / click ngoài / Esc — Modals.close xoá #modal-root).
 *   • Mirror DÙNG LẠI hàm có sẵn (Animator.mirrorClip, fallback
 *     ArpSyncClips.mirrorClip) — không viết lại logic mirror.
 *   • jsdom / máy không có WebGL: _getRenderer() trả null và mọi
 *     thao tác phát trả {ok:false, error:'WebGL...'} thay vì crash.
 * ============================================================ */
(function () {
  'use strict';

  function PS() { return (typeof window !== 'undefined' && window.PixiStudio) || {}; }
  function THREE() { return (typeof window !== 'undefined' && window.THREE) || null; }
  function bus() { var p = PS(); return (p && p.bus) || { emit: function () {}, on: function () {} }; }
  function U() { var p = PS(); return p.Utils || null; }

  function el(tag, attrs, children) {
    var u = U();
    if (u && u.el) return u.el(tag, attrs, children);
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null) return;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    }
    return node;
  }

  var Preview = {
    _installed: false,
    _renderer: null,
    _rendererFailed: false,
    _scene: null,
    _cam: null,
    _raf: 0,
    _current: null,   /* {assetId, clipName, clip, mixer, action, clone, mode, holder, imgBack, scrub, timeLabel, playBtn, onStop} */
    _lastTick: 0
  };

  /* ---------- thông tin clip của 1 asset ---------- */
  function estimateFps(clip) {
    /* fps = nhịp key của track DÀY NHẤT (track thưa như Hips tĩnh
       có thể chỉ vài key trên cả clip → ước lượng sai thấp). */
    var bestTrack = null, bestKeys = 0;
    (clip.tracks || []).forEach(function (t) {
      var n = (t.times || []).length;
      if (n > bestKeys) { bestKeys = n; bestTrack = t; }
    });
    if (!bestTrack || bestKeys < 2) return 30;
    var times = bestTrack.times, dts = [];
    for (var i = 1; i < times.length; i++) { var d = times[i] - times[i - 1]; if (d > 0.001) dts.push(d); }
    if (!dts.length) return 30;
    dts.sort(function (a, b) { return a - b; });
    var fps = Math.round(1 / dts[Math.floor(dts.length / 2)]);
    return (fps >= 1 && fps <= 240) ? fps : 30;
  }
  function clipInfo(clip) {
    if (!clip) return null;
    var keys = 0;
    (clip.tracks || []).forEach(function (t) { keys += (t.times || []).length; });
    return {
      name: clip.name || 'clip', duration: +(clip.duration || 0).toFixed(3),
      fps: estimateFps(clip), trackCount: (clip.tracks || []).length, keyCount: keys, clip: clip
    };
  }
  function getAssetClips(asset) {
    if (!asset) return [];
    var raw = (asset.entry && asset.entry.clips) || (asset.entry && asset.entry.animations) || asset.clips || [];
    if (!Array.isArray(raw)) return [];
    return raw.map(function (c) {
      if (c && c.tracks) return { info: clipInfo(c), clip: c, playable: true };
      return { info: { name: (c && c.name) || String(c), duration: +((c && c.duration) || 0).toFixed(3), fps: 30, trackCount: 0, keyCount: 0, clip: null }, clip: null, playable: false };
    });
  }
  Preview.listClips = function (assetOrId) {
    var a = typeof assetOrId === 'string' ? findAsset(assetOrId) : assetOrId;
    return getAssetClips(a).map(function (c) { return c.info; });
  };
  Preview.clipInfo = clipInfo;
  function findAsset(id) {
    var p = PS();
    var L = p && p.AssetLibrary;
    if (L && typeof L._findAsset === 'function') return L._findAsset(id);
    if (L && Array.isArray(L.assets)) {
      for (var i = 0; i < L.assets.length; i++) if (L.assets[i].id === id) return L.assets[i];
    }
    return null;
  }
  Preview.findAsset = findAsset;

  /* ---------- engine preview (renderer + scene + mixer riêng) ---------- */
  function getRenderer() {
    if (Preview._renderer) return Preview._renderer;
    if (Preview._rendererFailed) return null;
    var T = THREE();
    if (!T) { Preview._rendererFailed = true; return null; }
    try {
      var r = new T.WebGLRenderer({ antialias: true, alpha: true });
      r.setPixelRatio(1);
      r.outputEncoding = T.sRGBEncoding;
      Preview._renderer = r;
      return r;
    } catch (e) {
      Preview._rendererFailed = true;
      return null;
    }
  }
  function getScene() {
    var T = THREE();
    if (!T) return null;
    if (!Preview._scene) {
      var scene = new T.Scene();
      var l1 = new T.DirectionalLight(0xffffff, 1.0); l1.position.set(3, 5, 4);
      var l2 = new T.DirectionalLight(0x9d8fff, 0.5); l2.position.set(-4, 3, -3);
      scene.add(l1, l2, new T.HemisphereLight(0x8a8aff, 0x2a2233, 0.7));
      Preview._scene = scene;
      Preview._cam = new T.PerspectiveCamera(32, 1, 0.1, 50);
    }
    return Preview._scene;
  }
  function frameClone(clone) {
    var T = THREE();
    var box = new T.Box3().setFromObject(clone);
    var center = box.getCenter(new T.Vector3());
    var size = box.getSize(new T.Vector3());
    clone.position.sub(center);
    var dist = Math.max(size.x, size.y, size.z) * 1.5 + 0.5;
    Preview._cam.position.set(dist * 0.55, dist * 0.35, dist);
    Preview._cam.lookAt(0, 0, 0);
  }

  function renderOnce() {
    var r = Preview._renderer, s = Preview._scene, c = Preview._cam;
    if (!r || !s || !c) return;
    try { r.render(s, c); } catch (e) {}
  }
  function loopTick(now) {
    var cur = Preview._current;
    if (!cur) return;
    /* canvas bị gỡ khỏi DOM (đóng modal/X/Esc/click ngoài) → tự dừng */
    if (!cur.holder || !cur.holder.isConnected || !Preview._renderer.domElement.isConnected) { stopPreview('auto-detached'); return; }
    var dt = Preview._lastTick ? Math.min(0.1, (now - Preview._lastTick) / 1000) : 0.016;
    Preview._lastTick = now;
    try { cur.mixer.update(dt); } catch (e) {}
    renderOnce();
    updateScrubUI(cur);
    Preview._raf = (typeof requestAnimationFrame !== 'undefined')
      ? requestAnimationFrame(loopTick)
      : setTimeout(function () { loopTick(Date.now()); }, 16);
  }
  function updateScrubUI(cur) {
    if (!cur) return;
    var t = cur.action ? cur.action.time : 0;
    if (cur.scrub) cur.scrub.value = String(Math.min(t, cur.clip.duration));
    if (cur.timeLabel) cur.timeLabel.textContent = t.toFixed(2) + 's / ' + cur.clip.duration.toFixed(2) + 's';
    if (cur.playBtn) cur.playBtn.textContent = cur.playing ? '⏸ Tạm dừng' : '▶ Phát';
  }

  /* ---------- bắt đầu / dừng preview ---------- */
  function startPreview(asset, clip, holder, opts) {
    opts = opts || {};
    if (!asset || !clip) return { ok: false, error: 'Chưa chọn asset/clip để xem trước.' };
    var entry = asset.entry;
    var root = (entry && entry.object3D) || asset.object3D;
    if (!root) return { ok: false, error: 'Asset "' + (asset.name || asset.id) + '" không có model 3D để xem trước.' };
    var r = getRenderer();
    if (!r) return { ok: false, error: 'WebGL không khả dụng trong môi trường này — không xem trước được (logic clip vẫn kiểm tra được).' };
    var scene = getScene();
    if (!scene) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    stopPreview('replace');
    var T = THREE();
    var clone;
    try { clone = root.clone(true); } catch (e) { return { ok: false, error: 'Clone model lỗi: ' + (e && e.message) }; }
    scene.add(clone);
    frameClone(clone);
    var mixer = new T.AnimationMixer(clone);
    var action;
    try {
      action = mixer.clipAction(clip);
      action.play();
    } catch (e) {
      scene.remove(clone);
      return { ok: false, error: 'Clip "' + clip.name + '" không phát được trên model này: ' + (e && e.message) };
    }
    r.setSize(opts.w || 256, opts.h || 256, false);
    r.domElement.style.width = '100%';
    r.domElement.style.height = 'auto';
    r.domElement.style.display = 'block';
    holder.innerHTML = '';
    holder.appendChild(r.domElement);
    var cur = {
      assetId: asset.id, clipName: clip.name, clip: clip, mixer: mixer, action: action,
      clone: clone, mode: opts.mode || 'modal', holder: holder, playing: true,
      scrub: opts.scrub || null, timeLabel: opts.timeLabel || null, playBtn: opts.playBtn || null,
      imgBack: opts.imgBack || null, cardEl: opts.cardEl || null, onStop: opts.onStop || null
    };
    Preview._current = cur;
    Preview._lastTick = 0;
    renderOnce();
    Preview._raf = (typeof requestAnimationFrame !== 'undefined')
      ? requestAnimationFrame(loopTick)
      : setTimeout(function () { loopTick(Date.now()); }, 16);
    return { ok: true, assetId: asset.id, clipName: clip.name, mode: cur.mode };
  }

  function stopPreview(reason) {
    var cur = Preview._current;
    if (!cur && !Preview._raf) return { ok: true, stopped: false };
    if (Preview._raf) {
      if (typeof cancelAnimationFrame !== 'undefined') { try { cancelAnimationFrame(Preview._raf); } catch (e) {} }
      else clearTimeout(Preview._raf);
      Preview._raf = 0;
    }
    if (cur) {
      try { cur.mixer.uncacheClip(cur.clip); } catch (e) {}
      try { cur.mixer.uncacheRoot(cur.clone); } catch (e) {}
      try { if (Preview._scene) Preview._scene.remove(cur.clone); } catch (e) {}
      /* KHÔNG dispose geometry/material của clone — chia sẻ với model gốc */
      try {
        var r = Preview._renderer;
        if (r && r.domElement.parentNode) r.domElement.parentNode.removeChild(r.domElement);
      } catch (e) {}
      if (cur.onStop) { try { cur.onStop(reason || 'stop'); } catch (e) {} }
    }
    Preview._current = null;
    return { ok: true, stopped: !!cur, reason: reason || 'stop' };
  }
  Preview.startPreview = startPreview;
  Preview.stopPreview = stopPreview;
  Preview.isPlaying = function () { return !!Preview._current; };
  Preview.getState = function () {
    var cur = Preview._current;
    return {
      installed: Preview._installed, running: !!cur,
      mode: cur ? cur.mode : null, assetId: cur ? cur.assetId : null,
      clipName: cur ? cur.clipName : null,
      rendererFailed: Preview._rendererFailed
    };
  };

  /* ---------- phát / tạm dừng / scrub ---------- */
  Preview.togglePlay = function () {
    var cur = Preview._current;
    if (!cur) return { ok: false, error: 'Không có preview đang chạy.' };
    if (cur.playing) {
      cur.action.paused = true; cur.playing = false;
      if (Preview._raf) {
        if (typeof cancelAnimationFrame !== 'undefined') { try { cancelAnimationFrame(Preview._raf); } catch (e) {} }
        else clearTimeout(Preview._raf);
        Preview._raf = 0;
      }
      renderOnce();
    } else {
      cur.action.paused = false; cur.playing = true;
      Preview._lastTick = 0;
      Preview._raf = (typeof requestAnimationFrame !== 'undefined')
        ? requestAnimationFrame(loopTick)
        : setTimeout(function () { loopTick(Date.now()); }, 16);
    }
    updateScrubUI(cur);
    return { ok: true, playing: cur.playing };
  };
  Preview.scrubTo = function (t) {
    var cur = Preview._current;
    if (!cur) return { ok: false, error: 'Không có preview đang chạy.' };
    t = Math.max(0, Math.min(cur.clip.duration, +t || 0));
    var wasPlaying = cur.playing;
    cur.action.paused = true;
    cur.action.time = t;
    try { cur.mixer.update(0.0001); } catch (e) {}   /* r128: update(0) là no-op, dùng epsilon để ép áp pose */
    renderOnce();
    if (wasPlaying) { cur.action.paused = false; }
    updateScrubUI(cur);
    return { ok: true, time: t };
  };

  /* ---------- Mirror — DÙNG LẠI hàm có sẵn, không viết lại ---------- */
  function mirrorClipFn() {
    var p = PS();
    if (p.ArpAnimator && typeof p.ArpAnimator.mirrorClip === 'function') return p.ArpAnimator.mirrorClip;
    if (p.ArpSyncClips && typeof p.ArpSyncClips.mirrorClip === 'function') return p.ArpSyncClips.mirrorClip;
    return null;
  }
  Preview.mirrorAvailable = function () { return !!mirrorClipFn(); };
  Preview.mirrorCurrentClip = function () {
    var cur = Preview._current;
    if (!cur) return { ok: false, error: 'Không có preview đang chạy — mở preview 1 clip trước.' };
    var fn = mirrorClipFn();
    if (!fn) return { ok: false, error: 'Chưa có hàm mirror (Animator/Sync chưa load).' };
    var r;
    try { r = fn(cur.clip); } catch (e) { return { ok: false, error: 'Mirror lỗi: ' + (e && e.message) }; }
    if (!r || !r.ok || !r.clip) return { ok: false, error: (r && r.error) || 'Mirror không trả clip.' };
    var mirrored = toThreeClip(r.clip);
    if (!mirrored) return { ok: false, error: 'Clip mirror không đổi được sang THREE.AnimationClip.' };
    var asset = findAsset(cur.assetId);
    var holder = cur.holder, mode = cur.mode, scrub = cur.scrub, timeLabel = cur.timeLabel, playBtn = cur.playBtn;
    var res = startPreview(asset, mirrored, holder, { mode: mode, w: 256, h: 256, scrub: scrub, timeLabel: timeLabel, playBtn: playBtn });
    if (res.ok && Preview._current) {
      Preview._current.mirroredFrom = cur.clipName;
      Preview._current.clipSelect = cur.clipSelect || null;
    }
    return res.ok ? { ok: true, clipName: mirrored.name, from: cur.clipName } : res;
  };
  function toThreeClip(c) {
    var T = THREE();
    if (!T) return null;
    if (c instanceof T.AnimationClip) return c;
    if (c && Array.isArray(c.tracks) && c.tracks.length) {
      try {
        var tracks = c.tracks.map(function (t) {
          if (/\.quaternion$/.test(t.name)) return new T.QuaternionKeyframeTrack(t.name, t.times, t.values);
          return new T.VectorKeyframeTrack(t.name, t.times, t.values);
        });
        return new T.AnimationClip(c.name || 'clip_mirror', c.duration || 0.001, tracks);
      } catch (e) { return null; }
    }
    return null;
  }

  /* ---------- modal preview lớn ---------- */
  Preview.openPreview = function (assetId, clipName) {
    var p = PS();
    var Modals = p.Modals;
    if (!Modals || typeof Modals.open !== 'function') return { ok: false, error: 'Modals chưa sẵn sàng.' };
    var asset = findAsset(assetId);
    if (!asset) return { ok: false, error: 'Không tìm thấy asset ' + assetId + '.' };
    var clips = getAssetClips(asset);
    if (!clips.length) return { ok: false, error: 'Asset "' + asset.name + '" không có clip nào để xem trước.' };
    var chosen = clips.find(function (c) { return c.info.name === clipName; }) || clips[0];
    if (!chosen.playable) return { ok: false, error: 'Clip "' + chosen.info.name + '" chỉ có metadata, không có dữ liệu track để phát.' };
    var holder = el('div', { style: 'width:100%;max-width:320px;margin:0 auto;background:#191926;border-radius:8px;overflow:hidden;' });
    var infoLine = el('div', { class: 'dim small', style: 'margin:8px 0;' });
    var scrub = el('input', { type: 'range', min: '0', max: String(chosen.info.duration), step: '0.01', value: '0', style: 'width:100%;' });
    var timeLabel = el('span', { class: 'dim small', text: '0.00s / ' + chosen.info.duration.toFixed(2) + 's' });
    var playBtn = el('button', { class: 'btn sm', text: '⏸ Tạm dừng' });
    var mirrorBtn = el('button', { class: 'btn sm', text: '🪞 Mirror', title: Preview.mirrorAvailable() ? 'Phát bản mirror của clip (dùng lại Animator.mirrorClip)' : 'Chưa có hàm mirror (Animator/Sync chưa load)' });
    var clipSel = el('select', { class: 'input', style: 'max-width:220px;' });
    clips.forEach(function (c) {
      clipSel.appendChild(el('option', { value: c.info.name, text: c.info.name + ' (' + c.info.duration.toFixed(2) + 's)' + (c.playable ? '' : ' — không phát được') }));
    });
    clipSel.value = chosen.info.name;
    function refreshInfo(ci) {
      infoLine.textContent = 'Clip: ' + ci.name + ' · dài ' + ci.duration.toFixed(2) + 's · ~' + ci.fps + ' fps · ' + ci.trackCount + ' tracks · ' + ci.keyCount + ' keys';
      scrub.max = String(ci.duration);
    }
    refreshInfo(chosen.info);
    playBtn.addEventListener('click', function () { Preview.togglePlay(); });
    scrub.addEventListener('input', function () { Preview.scrubTo(parseFloat(scrub.value)); });
    mirrorBtn.addEventListener('click', function () {
      var r = Preview.mirrorCurrentClip();
      if (r.ok) {
        refreshInfo(clipInfo(Preview._current.clip));
        infoLine.textContent += ' · mirror từ "' + r.from + '"';
      } else {
        infoLine.textContent = 'Mirror lỗi: ' + r.error;
      }
    });
    clipSel.addEventListener('change', function () {
      var next = clips.find(function (c) { return c.info.name === clipSel.value; });
      if (!next || !next.playable) { infoLine.textContent = 'Clip này không phát được (chỉ có metadata).'; return; }
      var res = startPreview(asset, next.clip, holder, { mode: 'modal', w: 256, h: 256, scrub: scrub, timeLabel: timeLabel, playBtn: playBtn });
      if (res.ok) { refreshInfo(next.info); } else { infoLine.textContent = 'Không xem trước được: ' + res.error; }
    });
    var body = el('div', {}, [
      holder,
      el('div', { class: 'form-row', style: 'margin-top:8px;' }, [el('label', { text: 'Clip:' }), clipSel]),
      infoLine,
      el('div', { class: 'form-row' }, [scrub]),
      el('div', { class: 'form-row' }, [playBtn, mirrorBtn, timeLabel])
    ]);
    Modals.open({
      title: '👁 Xem trước animation — ' + asset.name,
      body: body,
      buttons: [
        { label: '⏹ Dừng', class: 'btn', keepOpen: true, onClick: function () { stopPreview('modal-stop-btn'); playBtn.textContent = '▶ Phát'; } },
        { label: 'Đóng', class: 'btn primary', onClick: function () { stopPreview('modal-close'); } }
      ]
    });
    var res = startPreview(asset, chosen.clip, holder, { mode: 'modal', w: 256, h: 256, scrub: scrub, timeLabel: timeLabel, playBtn: playBtn });
    if (!res.ok) infoLine.textContent = 'Không xem trước được: ' + res.error;
    else if (Preview._current) Preview._current.clipSelect = clipSel;
    return res;
  };

  /* ---------- hàng clip trên card (wrap _buildCard/_buildRow) ---------- */
  function cardClipRow(asset) {
    var clips = getAssetClips(asset);
    var wrap = el('div', { class: 'asset-clip-preview', style: 'display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:2px 6px 6px;' });
    if (!clips.length) {
      wrap.appendChild(el('span', { class: 'dim small', text: 'Không có clip' }));
      return wrap;
    }
    clips.slice(0, 3).forEach(function (c) {
      var row = el('span', { class: 'asset-clip-chip', style: 'display:inline-flex;gap:4px;align-items:center;' });
      row.appendChild(el('span', { class: 'small', text: c.info.name + ' ' + c.info.duration.toFixed(1) + 's' }));
      var play = el('button', {
        class: 'btn sm', text: '▶', title: 'Phát inline lên thumbnail của card',
        style: 'padding:0 6px;line-height:1.4;',
        onclick: function (e) {
          e.stopPropagation();
          if (Preview._current && Preview._current.assetId === asset.id && Preview._current.clipName === c.info.name && Preview._current.mode === 'card') {
            stopPreview('card-toggle-off');
            return;
          }
          startInlineOnCard(asset, c, e);
        }
      });
      play.disabled = !c.playable;
      if (!c.playable) play.title = 'Chỉ có metadata, không phát được';
      row.appendChild(play);
      var expand = el('button', {
        class: 'btn sm', text: '⤢', title: 'Mở panel xem trước lớn (scrub + Mirror)',
        style: 'padding:0 6px;line-height:1.4;',
        onclick: function (e) { e.stopPropagation(); stopPreview('open-modal'); Preview.openPreview(asset.id, c.info.name); }
      });
      expand.disabled = !c.playable;
      row.appendChild(expand);
      wrap.appendChild(row);
    });
    if (clips.length > 3) wrap.appendChild(el('span', { class: 'dim small', text: '+' + (clips.length - 3) + ' clip' }));
    return wrap;
  }
  function startInlineOnCard(asset, clipEntry, evt) {
    var card = evt && evt.target ? evt.target.closest('.asset-card, .asset-row') : null;
    if (!card) { Preview.openPreview(asset.id, clipEntry.info.name); return; }
    var img = card.querySelector('img');
    var btn = evt.target;
    /* Holder RIÊNG cho canvas preview: thay vị trí của <img> thumbnail
       (ẩn img, không xoá) — KHÔNG dùng img.parentNode (= cả card) làm
       holder: startPreview làm holder.innerHTML='' sẽ xoá sạch card. */
    var holder = null;
    if (img) {
      holder = document.createElement('div');
      holder.className = 'asset-clip-inline-holder';
      holder.style.cssText = 'height:136px;overflow:hidden;background:#191926;';
      img.parentNode.insertBefore(holder, img);
      img.style.display = 'none';
    } else {
      holder = card;
    }
    var res = startPreview(asset, clipEntry.clip, holder, {
      mode: 'card', w: 128, h: 136, cardEl: card, imgBack: img,
      onStop: function () {
        try {
          if (img) img.style.display = '';
          if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
          var btns = card.querySelectorAll('.asset-clip-preview .btn');
          btns.forEach(function (b) { if (b.textContent === '⏸') b.textContent = '▶'; });
        } catch (e) {}
      }
    });
    if (res.ok && btn) btn.textContent = '⏸';
    return res;
  }
  Preview.cardClipRow = cardClipRow;

  /* ---------- section preview trong modal Chi tiết ---------- */
  function detailPreviewSection(asset) {
    var clips = getAssetClips(asset);
    var sec = el('div', { class: 'asset-preview-detail', style: 'margin-top:12px;border-top:1px solid var(--border,#333);padding-top:10px;' });
    sec.appendChild(el('label', { text: '👁 Xem trước animation (không cần import vào scene):' }));
    if (!clips.length) {
      sec.appendChild(el('div', { class: 'dim small', text: 'Asset này không có clip nào.' }));
      return sec;
    }
    var holder = el('div', { style: 'width:100%;max-width:260px;margin:6px auto;background:#191926;border-radius:8px;overflow:hidden;min-height:40px;' });
    var info = el('div', { class: 'dim small', style: 'margin:6px 0;' });
    var scrub = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0', style: 'width:100%;' });
    var playBtn = el('button', { class: 'btn sm', text: '▶ Phát' });
    var stopBtn = el('button', { class: 'btn sm', text: '⏹ Dừng' });
    var sel = el('select', { class: 'input', style: 'max-width:220px;' });
    clips.forEach(function (c) {
      sel.appendChild(el('option', { value: c.info.name, text: c.info.name + ' (' + c.info.duration.toFixed(2) + 's · ' + c.info.trackCount + ' tracks · ~' + c.info.fps + ' fps)' }));
    });
    function showInfo(ci) {
      info.textContent = 'Clip: ' + ci.name + ' · dài ' + ci.duration.toFixed(2) + 's · ~' + ci.fps + ' fps · ' + ci.trackCount + ' tracks · ' + ci.keyCount + ' keys';
      scrub.max = String(ci.duration);
    }
    showInfo(clips[0].info);
    playBtn.addEventListener('click', function () {
      var cur = Preview._current;
      if (cur && cur.mode === 'detail' && cur.assetId === asset.id) { Preview.togglePlay(); return; }
      var next = clips.find(function (c) { return c.info.name === sel.value; }) || clips[0];
      if (!next.playable) { info.textContent = 'Clip này chỉ có metadata, không phát được.'; return; }
      var res = startPreview(asset, next.clip, holder, { mode: 'detail', w: 256, h: 256, scrub: scrub, timeLabel: null, playBtn: playBtn });
      if (!res.ok) info.textContent = 'Không xem trước được: ' + res.error;
      else showInfo(next.info);
    });
    stopBtn.addEventListener('click', function () { stopPreview('detail-stop'); playBtn.textContent = '▶ Phát'; });
    scrub.addEventListener('input', function () { Preview.scrubTo(parseFloat(scrub.value)); });
    sel.addEventListener('change', function () {
      var next = clips.find(function (c) { return c.info.name === sel.value; });
      if (next) showInfo(next.info);
    });
    sec.appendChild(el('div', { class: 'form-row', style: 'margin-top:6px;' }, [sel]));
    sec.appendChild(holder);
    sec.appendChild(info);
    sec.appendChild(el('div', { class: 'form-row' }, [scrub]));
    sec.appendChild(el('div', { class: 'form-row' }, [playBtn, stopBtn]));
    return sec;
  }

  /* ---------- install: wrap hàm của AssetLibrary (không sửa file gốc) ---------- */
  Preview.install = function () {
    var p = PS();
    var L = p && p.AssetLibrary;
    if (!L) return { ok: false, error: 'AssetLibrary chưa load.' };
    if (Preview._installed) return { ok: true, already: true };
    var wrappedCard = false, wrappedRow = false, wrappedDetails = false;
    if (typeof L._buildCard === 'function' && !L._buildCard.__previewWrapped) {
      var origCard = L._buildCard;
      var wrapped = function (asset) {
        var card = origCard(asset);
        try {
          if (asset && (asset.type === 'model' || asset.type === 'character')) card.appendChild(cardClipRow(asset));
        } catch (e) {}
        return card;
      };
      wrapped.__previewWrapped = true;
      L._buildCard = wrapped;
      wrappedCard = true;
    }
    if (typeof L._buildRow === 'function' && !L._buildRow.__previewWrapped) {
      var origRow = L._buildRow;
      var wrappedRowFn = function (asset) {
        var row = origRow(asset);
        try {
          if (asset && asset.type === 'model') {
            var clips = getAssetClips(asset);
            if (clips.length) {
              var badge = el('span', { class: 'small', text: '▶ ' + clips.length + ' clip', title: 'Bấm để xem trước clip đầu tiên', style: 'cursor:pointer;' });
              badge.addEventListener('click', function (e) { e.stopPropagation(); Preview.openPreview(asset.id, clips[0].info.name); });
              row.appendChild(badge);
            }
          }
        } catch (e) {}
        return row;
      };
      wrappedRowFn.__previewWrapped = true;
      L._buildRow = wrappedRowFn;
      wrappedRow = true;
    }
    if (typeof L.showDetails === 'function' && !L.showDetails.__previewWrapped) {
      var origDetails = L.showDetails;
      var wrappedDetailsFn = function (id) {
        var asset = findAsset(id);
        var Modals = p.Modals;
        if (!asset || !Modals || typeof Modals.open !== 'function') return origDetails(id);
        var origOpen = Modals.open;
        Modals.open = function (opts) {
          try {
            if (opts && opts.body && opts.body.appendChild) opts.body.appendChild(detailPreviewSection(asset));
          } catch (e) {}
          return origOpen(opts);
        };
        try { return origDetails(id); }
        finally { Modals.open = origOpen; }
      };
      wrappedDetailsFn.__previewWrapped = true;
      L.showDetails = wrappedDetailsFn;
      wrappedDetails = true;
    }
    /* chọn asset khác / đóng modal → dừng preview đang chạy */
    try {
      bus().on('modal:closed', function () { stopPreview('modal-closed'); });
    } catch (e) {}
    Preview._installed = true;
    return { ok: true, wrappedCard: wrappedCard, wrappedRow: wrappedRow, wrappedDetails: wrappedDetails };
  };

  var p0 = PS();
  p0.AssetLibraryPreview = Preview;

  /* Hook test-only (theo convention Animator._test / Keyframe._test):
     harness jsdom không có WebGL nên không startPreview thật được —
     cho phép đặt/xoá _current giả để kiểm tra stopPreview dispose. */
  Preview._test = {
    setCurrent: function (c) { Preview._current = c || null; return Preview.getState(); },
    getCurrent: function () { return Preview._current; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Preview;

  /* tự cài khi AssetLibrary đã có (script load sau asset-library.js) */
  try {
    if (p0.AssetLibrary) Preview.install();
  } catch (e) {}
})();
