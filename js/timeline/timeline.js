/* ============================================================
 * timeline/timeline.js — UI Timeline: ruler canvas, track rows,
 * keyframe diamonds kéo được, playhead, scrub, zoom, graph editor.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const TimelineUI = {
    pxPerFrame: 10,
    activeTab: 'timeline',
    lanesEl: null,
    rulerEl: null,
    rulerCanvas: null,
    playheadEl: null,
    rulerHeadEl: null,
    trackListEl: null
  };

  /* ---------- INIT ---------- */
  TimelineUI.init = function () {
    TimelineUI.lanesEl = document.getElementById('tl-lanes');
    TimelineUI.rulerEl = document.getElementById('tl-ruler');
    TimelineUI.rulerCanvas = document.getElementById('tl-ruler-canvas');
    TimelineUI.playheadEl = document.getElementById('tl-playhead');
    TimelineUI.rulerHeadEl = document.getElementById('tl-ruler-head');
    TimelineUI.trackListEl = document.getElementById('tl-track-list');

    /* Tabs */
    U.$$('[data-tl_tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        TimelineUI.setTab(tab.getAttribute('data-tl_tab'));
      });
    });

    /* Playback buttons */
    const bind = function (id, fn) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    bind('pb-play', function () { PixiStudio.Playback.toggle(); });
    bind('pb-start', function () { PixiStudio.Playback.toStart(); });
    bind('pb-end', function () { PixiStudio.Playback.toEnd(); });
    bind('pb-next', function () { PixiStudio.Playback.stepForward(); });
    bind('pb-prev', function () { PixiStudio.Playback.stepBackward(); });
    bind('add-keyframe-btn', function () {
      const ch = PixiStudio.State.get('timelineChannel') || 'position';
      PixiStudio.Timeline.keys.addKey(ch);
    });
    bind('tl-loop-btn', function () {
      PixiStudio.Playback.loop = !PixiStudio.Playback.loop;
      const btn = document.getElementById('tl-loop-btn');
      if (btn) btn.classList.toggle('active', PixiStudio.Playback.loop);
    });
    const loopBtn = document.getElementById('tl-loop-btn');
    if (loopBtn) loopBtn.classList.add('active');

    /* FPS select */
    const fpsSel = document.getElementById('tl-fps-select');
    if (fpsSel) {
      fpsSel.addEventListener('change', function () {
        PixiStudio.Playback.setFps(parseInt(fpsSel.value, 10));
      });
    }

    /* Sequence / GIF / Video */
    bind('tl-sequence-btn', function () {
      bus.emit('notify', { type: 'info', title: 'Sequence Export', message: 'Dùng Render & Export panel — render frame hiện tại ở độ phân giải tuỳ chọn.' });
      PixiStudio.Exporter.showDialog('sequence');
    });
    bind('tl-gif-btn', function () {
      bus.emit('notify', {
        type: 'warning', title: 'GIF Export — chưa khả dụng',
        message: 'Cần encoder gif.js (planned v5.1). WebM Video hoạt động thật qua MediaRecorder.',
        duration: 6000
      });
    });
    bind('tl-video-btn', function () { PixiStudio.Exporter.recordWebM(); });

    /* Scrubbing trên ruler + lanes */
    TimelineUI._setupScrub(TimelineUI.rulerEl);
    TimelineUI._setupScrub(TimelineUI.lanesEl);

    /* mini play button (bottom collapsed) */
    bind('mini-play-btn', function () { PixiStudio.Playback.toggle(); });

    /* Frame events → update UI */
    bus.on('timeline:frame', function (data) {
      TimelineUI.updatePlayhead(data.frame);
      TimelineUI.updateCounter(data.frame);
    });

    bus.on('timeline:tracks-changed', function () {
      TimelineUI.renderTracks();
    });

    bus.on('selection:changed', function () {
      TimelineUI.renderTracks();
    });

    /* resize */
    window.addEventListener('resize', U.debounce(function () {
      TimelineUI.drawRuler();
    }, 200));

    TimelineUI.renderTracks();
    TimelineUI.drawRuler();
  };

  TimelineUI.setTab = function (tab) {
    TimelineUI.activeTab = tab;
    U.$$('[data-tl_tab]').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tl_tab') === tab);
    });

    const graph = document.getElementById('tl-graph-wrap');
    const lanes = document.getElementById('tl-lanes');
    const ruler = document.getElementById('tl-ruler');
    ['tl-ph-blend', 'tl-ph-constraints', 'tl-ph-sequencer', 'tl-ph-statemachine'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });

    if (tab === 'timeline') {
      if (graph) graph.classList.remove('active');
      if (lanes) lanes.style.display = '';
      if (ruler) ruler.style.display = '';
    } else if (tab === 'graph') {
      if (graph) graph.classList.add('active');
      if (lanes) lanes.style.display = 'none';
      if (ruler) ruler.style.display = '';
      TimelineUI.drawGraph();
    } else {
      /* placeholder tabs */
      if (graph) graph.classList.remove('active');
      if (lanes) lanes.style.display = 'none';
      if (ruler) ruler.style.display = 'none';
      const el = document.getElementById('tl-ph-' + tab);
      if (el) el.classList.add('active');
    }
  };

  /* ---------- RULER ---------- */
  TimelineUI.drawRuler = function () {
    const canvas = TimelineUI.rulerCanvas;
    if (!canvas) return;
    const wrap = TimelineUI.rulerEl;
    if (!wrap) return;
    const w = wrap.clientWidth || 600;
    const h = 26;
    canvas.width = w * (window.devicePixelRatio || 1);
    canvas.height = h * (window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const total = PixiStudio.State.get('totalFrames') || 120;
    const pxf = TimelineUI.pxPerFrame;
    const visibleFrames = Math.ceil(w / pxf);

    /* adapt tick spacing */
    let step = 5;
    while (step * pxf < 44) step *= 2;

    ctx.font = '9px "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    const maxFrame = Math.min(total, Math.max(visibleFrames, 60));

    for (let f = 0; f <= maxFrame; f += step) {
      const x = f * pxf;
      ctx.fillStyle = f % (step * 2) === 0 ? '#8a8a9e' : '#55556a';
      ctx.fillRect(x, h - 8, 1, 8);
      if (f % (step * 2) === 0) {
        ctx.fillStyle = '#b8b8c8';
        ctx.fillText(String(f), x + 3, 8);
      }
    }
    /* minor ticks */
    for (let f = 0; f <= maxFrame; f++) {
      const x = f * pxf;
      ctx.fillStyle = 'rgba(120,120,150,.28)';
      ctx.fillRect(x, h - 4, 1, 4);
    }
  };

  /* ---------- SCRUB ---------- */
  TimelineUI._setupScrub = function (element) {
    if (!element) return;
    let scrubbing = false;
    const frameFromEvent = function (e) {
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left;
      return Math.round(x / TimelineUI.pxPerFrame);
    };
    element.addEventListener('pointerdown', function (e) {
      scrubbing = true;
      PixiStudio.Playback.setFrame(frameFromEvent(e));
      try { element.setPointerCapture && element.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    });
    element.addEventListener('pointermove', function (e) {
      if (scrubbing) PixiStudio.Playback.setFrame(frameFromEvent(e));
    });
    element.addEventListener('pointerup', function () { scrubbing = false; });
    element.addEventListener('pointercancel', function () { scrubbing = false; });
  };

  /* ---------- PLAYHEAD + COUNTER ---------- */
  TimelineUI.updatePlayhead = function (frame) {
    const x = frame * TimelineUI.pxPerFrame;
    if (TimelineUI.playheadEl) TimelineUI.playheadEl.style.left = x + 'px';
    if (TimelineUI.rulerHeadEl) TimelineUI.rulerHeadEl.style.left = x + 'px';
    /* auto-scroll khi playhead vượt khỏi màn */
    if (TimelineUI.lanesEl && PixiStudio.Playback.playing) {
      const w = TimelineUI.lanesEl.clientWidth;
      const scroll = TimelineUI.lanesEl.scrollLeft;
      if (x > scroll + w - 60 || x < scroll) {
        TimelineUI.lanesEl.scrollLeft = Math.max(0, x - w / 2);
        if (TimelineUI.rulerEl) TimelineUI.rulerEl.scrollLeft = TimelineUI.lanesEl.scrollLeft;
      }
    }
    const mini = document.getElementById('mini-frame');
    if (mini) mini.textContent = frame + ' / ' + (PixiStudio.State.get('totalFrames') || 120);
  };

  TimelineUI.updateCounter = function (frame) {
    const cur = document.getElementById('fc-cur');
    const end = document.getElementById('fc-end');
    if (cur) cur.textContent = frame;
    if (end) end.textContent = PixiStudio.State.get('totalFrames') || 120;
  };

  /* ---------- TRACKS RENDER ---------- */
  TimelineUI.renderTracks = function () {
    const list = TimelineUI.trackListEl;
    const lanes = TimelineUI.lanesEl;
    if (!list || !lanes) return;
    list.innerHTML = '';
    /* giữ playhead — rebuild lanes */
    lanes.innerHTML = '<div id="tl-playhead"></div>';
    TimelineUI.playheadEl = document.getElementById('tl-playhead');

    const keys = PixiStudio.Timeline.keys;
    const colors = PixiStudio.Timeline.TRACK_COLORS;

    const buildRow = function (track) {
      /* Left row */
      const row = U.el('div', { class: 'tl-track-row', dataset: { trackId: track.id } }, [
        U.el('span', { class: 'dot', style: 'background:' + colors[track.channel] + ';color:' + colors[track.channel] + ';' }),
        U.el('span', { class: 'name', text: track.targetName + ' · ' + track.channel }),
        U.el('button', {
          class: 'eye' + (track.visible ? '' : ' off'),
          html: U.icon(track.visible ? 'eye' : 'eye-off', 'ic-sm'),
          onclick: function (e) {
            e.stopPropagation();
            track.visible = !track.visible;
            TimelineUI.renderTracks();
          }
        })
      ]);
      row.addEventListener('click', function () {
        PixiStudio.State.set('timelineChannel', track.channel, true);
        U.$$('.tl-track-row', list).forEach(function (r) { r.classList.remove('selected'); });
        row.classList.add('selected');
      });
      list.appendChild(row);

      /* Lane + keyframes */
      const lane = U.el('div', { class: 'tl-lane' });
      lane.style.setProperty('--tl-step', (TimelineUI.pxPerFrame * 5) + 'px');
      track.keys.forEach(function (key, idx) {
        const keyEl = U.el('div', {
          class: 'tl-key key-' + track.channel,
          style: 'left:' + (key.frame * TimelineUI.pxPerFrame) + 'px;color:' + colors[track.channel] + ';'
        });
        keyEl.addEventListener('pointerdown', function (e) {
          e.stopPropagation();
          keys.selectedKey = { trackId: track.id, index: idx };
          /* drag move keyframe */
          const startX = e.clientX;
          const startFrame = key.frame;
          const onMove = function (ev) {
            const delta = (ev.clientX - startX) / TimelineUI.pxPerFrame;
            keys.moveKey(track.id, idx, startFrame + delta);
            keyEl.style.left = (Math.round(startFrame + delta) * TimelineUI.pxPerFrame) + 'px';
            TimelineUI.renderTracks();
          };
          const onUp = function () {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            TimelineUI.renderTracks();
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        });
        keyEl.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          keys.selectedKey = { trackId: track.id, index: idx };
          bus.emit('ui:contextmenu', { x: e.clientX, y: e.clientY, zone: 'keyframe' });
        });
        lane.appendChild(keyEl);
      });
      lanes.appendChild(lane);
    };

    /* Nếu không có track nào → gợi ý track channels cho selection */
    const sel = PixiStudio.State.get('selection');
    if (sel && !keys.tracks.some(function (t) { return t.objectId === sel.uuid; })) {
      ['position', 'rotation', 'scale'].forEach(function (ch) {
        const row = U.el('div', { class: 'tl-track-row', style: 'opacity:.55;' }, [
          U.el('span', { class: 'dot', style: 'background:' + colors[ch] + ';color:' + colors[ch] + ';' }),
          U.el('span', { class: 'name', text: (sel.name || 'Object') + ' · ' + ch }),
          U.el('span', { class: 'dim small', text: '+K' })
        ]);
        row.addEventListener('click', function () {
          keys.addKey(ch);
        });
        list.appendChild(row);
        lanes.appendChild(U.el('div', { class: 'tl-lane' }));
      });
      list.appendChild(U.el('div', { class: 'dim small', style: 'padding:8px 10px;', text: 'Click track để thêm keyframe tại frame hiện tại (K).' }));
    } else if (sel) {
      keys.tracks.filter(function (t) { return t.objectId === sel.uuid; }).forEach(buildRow);
    } else {
      keys.tracks.slice(0, 12).forEach(buildRow);
    }

    TimelineUI.updatePlayhead(PixiStudio.Playback.frame);
    TimelineUI.drawRuler();
  };

  /* ---------- GRAPH EDITOR (canvas thật) ---------- */
  TimelineUI.drawGraph = function () {
    const canvas = document.getElementById('tl-graph-canvas');
    if (!canvas) return;
    const wrap = document.getElementById('tl-graph-wrap');
    const w = wrap.clientWidth || 600, h = wrap.clientHeight || 200;
    canvas.width = w * (window.devicePixelRatio || 1);
    canvas.height = h * (window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    /* grid */
    ctx.strokeStyle = 'rgba(120,120,150,.14)';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    for (let x = 0; x < w; x += TimelineUI.pxPerFrame * 5) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }

    const colors = PixiStudio.Timeline.TRACK_COLORS;
    const keys = PixiStudio.Timeline.keys;
    const total = PixiStudio.State.get('totalFrames') || 120;

    /* vẽ đường value[0] của từng track */
    keys.tracks.forEach(function (track) {
      if (!track.keys.length) return;
      ctx.strokeStyle = colors[track.channel] || '#fff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      let started = false;
      for (let f = 0; f <= total; f += 2) {
        const v = keys.sampleValue(track, f);
        if (!v) continue;
        const x = f * TimelineUI.pxPerFrame;
        const y = h / 2 - v[0] * 26;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      /* keyframe dots */
      track.keys.forEach(function (k) {
        const x = k.frame * TimelineUI.pxPerFrame;
        const y = h / 2 - k.value[0] * 26;
        ctx.fillStyle = colors[track.channel];
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    /* legend */
    const legend = document.getElementById('tl-graph-legend');
    if (legend) {
      legend.innerHTML = '';
      ['position', 'rotation', 'scale'].forEach(function (ch) {
        legend.appendChild(U.el('span', { class: 'g-item' }, [
          U.el('span', { class: 'g-dot', style: 'background:' + colors[ch] + ';' }),
          U.el('span', { text: ch + '.x' })
        ]));
      });
    }
  };

  window.PixiStudio.TimelineUI = TimelineUI;
})();
