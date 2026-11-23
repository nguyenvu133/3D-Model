/* ============================================================
 * performance/monitor.js — FPS meter, renderer.info thật,
 * graph canvas, cảnh báo ngưỡng, HUD + statusbar sync.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Monitor = {
    fps: 60,
    frameCount: 0,
    _lastTime: performance.now(),
    _lastPerfSample: 0,
    history: [],           // fps samples (max 180)
    renderHistory: [],
    warningFps: 30,
    dangerFps: 15,
    renderTimeMs: 0,
    loadingTimeMs: 0,
    startedAt: 0,
    /* v21.0 — ngân sách hiệu năng (tris / draw calls / fps). */
    budgets: { tris: 50000, calls: 150, fps: 30 },
    _lastBudgetKey: '',
    _lastBudgetNotify: 0
  };

  /* v21.0 — kiểm tra ngân sách, trả danh sách cảnh báo (hàm thuần). */
  Monitor.checkBudgets = function (fps, calls, tris) {
    const w = [];
    const b = Monitor.budgets;
    if (typeof tris === 'number' && tris > b.tris) w.push('Tam giác ' + tris.toLocaleString('vi-VN') + ' vượt ngân sách ' + b.tris.toLocaleString('vi-VN') + ' — cân nhắc Auto-LOD hoặc Decimate.');
    if (typeof calls === 'number' && calls > b.calls) w.push('Draw call ' + calls + ' vượt ngân sách ' + b.calls + ' — gộp mesh / tắt object thừa.');
    if (typeof fps === 'number' && fps > 0 && fps < b.fps) w.push('FPS ' + fps + ' dưới ngân sách ' + b.fps + ' — giảm quality PixiJS / LOD.');
    return w;
  };
  /* v21.0 — gọi từ tick: emit + notify khi cảnh báo đổi (chống spam). */
  Monitor.checkBudgetsLive = function (fps, calls, tris) {
    const w = Monitor.checkBudgets(fps, calls, tris);
    const key = w.join('|');
    if (key !== Monitor._lastBudgetKey) {
      Monitor._lastBudgetKey = key;
      bus.emit('perf:budget', { ok: !w.length, warnings: w });
      const now = Date.now();
      if (w.length && now - Monitor._lastBudgetNotify > 8000) {
        Monitor._lastBudgetNotify = now;
        bus.emit('notify', { type: 'warning', title: 'Ngân sách hiệu năng', message: w.join(' ') });
      }
    }
    return w;
  };

  Monitor.start = function () {
    Monitor.startedAt = performance.now();
    bus.on('perf:sample', function () { /* hook for plugins */ });
  };

  Monitor.tick = function (dt) {
    Monitor.frameCount++;
    const now = performance.now();
    const elapsed = now - Monitor._lastTime;

    if (elapsed >= 500) {
      Monitor.fps = Math.round(Monitor.frameCount * 1000 / elapsed);
      Monitor.frameCount = 0;
      Monitor._lastTime = now;

      const info = PixiStudio.RendererManager.info();
      Monitor.renderTimeMs = U.round(PixiStudio.RendererManager.renderTimeMs, 2);

      Monitor.history.push(Monitor.fps);
      if (Monitor.history.length > 180) Monitor.history.shift();
      Monitor.renderHistory.push(Monitor.renderTimeMs);
      if (Monitor.renderHistory.length > 180) Monitor.renderHistory.shift();

      /* HUD */
      Monitor._updateHud(info);
      /* Perf panel nếu đang mở */
      if (PixiStudio.Inspector && PixiStudio.Inspector.activeTab === 'performance') {
        Monitor.renderPanel();
      }

      bus.emit('perf:sample', { fps: Monitor.fps, calls: info.calls, tris: info.triangles });
      Monitor.checkBudgetsLive(Monitor.fps, info.calls, info.triangles);
    }
  };

  Monitor._updateHud = function (info) {
    /* HUD chips */
    const fpsChip = document.getElementById('hud-fps');
    if (fpsChip) {
      const b = fpsChip.querySelector('b');
      if (b) b.textContent = Monitor.fps;
      fpsChip.className = 'perf-chip ' + Monitor._grade(Monitor.fps);
    }
    const callsChip = document.getElementById('hud-calls');
    if (callsChip) {
      const b = callsChip.querySelector('b');
      if (b) b.textContent = info.calls;
    }
    const trisChip = document.getElementById('hud-tris');
    if (trisChip) {
      const b = trisChip.querySelector('b');
      if (b) b.textContent = U.formatNumber(info.triangles);
    }

    /* Statusbar */
    const sbFps = document.getElementById('sb-fps');
    if (sbFps) {
      sbFps.textContent = Monitor.fps;
      sbFps.style.color = Monitor.fps < Monitor.dangerFps ? 'var(--danger)' : Monitor.fps < Monitor.warningFps ? 'var(--warning)' : 'var(--success)';
    }
    const sbTris = document.getElementById('sb-tris');
    if (sbTris) sbTris.textContent = U.formatNumber(info.triangles);
    const sbZoom = document.getElementById('sb-zoom');
    if (sbZoom && PixiStudio.Viewport.orbit) {
      sbZoom.textContent = Math.round(520 / PixiStudio.Viewport.orbit.radius * 100) + '%';
    }
  };

  Monitor._grade = function (fps) {
    if (fps >= 50) return 'good';
    if (fps >= Monitor.warningFps) return 'warn';
    return 'bad';
  };

  Monitor.snapshot = function () {
    const info = PixiStudio.RendererManager.info();
    const memory = performance.memory;
    return {
      fps: Monitor.fps,
      drawCalls: info.calls,
      triangles: info.triangles,
      geometries: info.geometries,
      textures: info.textures,
      renderTimeMs: Monitor.renderTimeMs,
      jsHeapMB: memory ? U.round(memory.usedJSHeapSize / 1048576, 1) : null,
      heapLimitMB: memory ? U.round(memory.jsHeapSizeLimit / 1048576, 1) : null,
      maxTextureSize: PixiStudio.ThreeRenderer.maxTextureSize,
      uptimeS: Math.round((performance.now() - Monitor.startedAt) / 1000)
    };
  };

  /* ---------- PERF PANEL (inspector tab) ---------- */
  Monitor.renderPanel = function () {
    const body = document.getElementById('performance-body');
    if (!body) return;
    const snap = Monitor.snapshot();

    body.innerHTML = '';
    body.appendChild(U.el('div', { class: 'page-block' }, [
      U.el('h4', { text: 'Performance Monitor — số liệu thật' })
    ]));

    /* Graph canvas */
    const canvas = U.el('canvas', { id: 'perf-graph-canvas' });
    body.appendChild(canvas);
    Monitor._drawGraph(canvas);

    /* Stats grid */
    const grid = U.el('div', { class: 'stat-grid', style: 'margin-top:10px;' });
    const cells = [
      ['FPS', snap.fps, Monitor._grade(snap.fps)],
      ['Draw Calls', snap.drawCalls, snap.drawCalls > 200 ? 'warn' : 'good'],
      ['Triangles', U.formatNumber(snap.triangles), snap.triangles > 500000 ? 'warn' : 'good'],
      ['Geometries', snap.geometries, ''],
      ['Textures', snap.textures, ''],
      ['Render', snap.renderTimeMs + ' ms', snap.renderTimeMs > 16 ? 'warn' : 'good'],
      ['JS Heap', snap.jsHeapMB ? snap.jsHeapMB + ' MB' : 'n/a', ''],
      ['Uptime', snap.uptimeS + 's', '']
    ];
    cells.forEach(function (c) {
      grid.appendChild(U.el('div', { class: 'stat-cell' }, [
        U.el('div', { class: 'sc-label', text: c[0] }),
        U.el('div', { class: 'sc-value' + (c[2] ? '' : ''), html: U.escapeHtml(String(c[1])) + (c[2] === 'warn' ? ' <small style="color:var(--warning)">⚠</small>' : c[2] === 'bad' ? ' <small style="color:var(--danger)">✖</small>' : '') })
      ]));
    });
    body.appendChild(grid);

    /* Cảnh báo ngưỡng */
    if (snap.fps < Monitor.warningFps) {
      body.appendChild(U.el('div', { class: 'empty-state', style: 'padding:10px;' }, [
        U.el('span', { class: 'state-badge ' + (snap.fps < Monitor.dangerFps ? 'err' : 'pending'), text: snap.fps < Monitor.dangerFps ? 'FPS < 15 — quá thấp!' : 'FPS < 30 — warning' })
      ]));
    }

    body.appendChild(U.el('div', { class: 'dim small', style: 'margin-top:8px;', text: 'GPU memory không expose trực tiếp qua WebGL — dùng JS Heap + texture count làm heuristic.' }));
  };

  Monitor._drawGraph = function (canvas) {
    const w = canvas.clientWidth || 280;
    const h = 110;
    canvas.width = w * (window.devicePixelRatio || 1);
    canvas.height = h * (window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    /* grid lines 30/60 fps */
    [30, 60].forEach(function (fps) {
      const y = h - (fps / 90) * h;
      ctx.strokeStyle = fps === 60 ? 'rgba(66,223,117,.25)' : 'rgba(255,201,40,.25)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(180,180,200,.5)';
      ctx.font = '9px monospace';
      ctx.fillText(String(fps), 4, y - 3);
    });

    if (Monitor.history.length < 2) return;

    /* FPS line */
    const drawSeries = function (data, color, max) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const step = w / Math.max(1, data.length - 1);
      data.forEach(function (v, i) {
        const x = i * step;
        const y = h - U.clamp(v / max, 0, 1) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };

    drawSeries(Monitor.history, '#42df75', 90);
    drawSeries(Monitor.renderHistory.map(function (v) { return v * 6; }), '#713bff', 90);
  };

  window.PixiStudio.Perf = Monitor;
})();
