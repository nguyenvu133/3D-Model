/* ============================================================
 * mapeditor/editor/AssetManager.js — Asset Manager (dưới)
 * Thẻ asset wuxia với thumbnail vẽ bằng canvas 2D (theo hình
 * prefab). Click = chế độ đặt (ghost theo chuột, click để đặt),
 * kéo-thả vào viewport cũng đặt được. Lọc theo category, tìm
 * kiếm, Import GLB (GLTFLoader) + card Thần Điêu.
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  var AssetManager = {
    _grid: null,
    _filter: 'All',
    _search: ''
  };

  AssetManager.init = function (gridEl, filterEl, searchEl) {
    AssetManager._grid = gridEl;
    if (filterEl) {
      filterEl.addEventListener('change', function () {
        AssetManager._filter = filterEl.value;
        AssetManager.render();
      });
    }
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        AssetManager._search = searchEl.value.trim().toLowerCase();
        AssetManager.render();
      });
    }
    AssetManager.render();
  };

  /* vẽ thumbnail 2D đơn giản theo loại prefab */
  function drawThumb(canvas, type) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#1a2233';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2a3550';
    ctx.fillRect(0, H - 16, W, 16);
    ctx.lineWidth = 2;
    function poly(points, fill, stroke) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (var i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
    }
    var cx = W / 2;
    if (type === 'temple') {
      poly([[cx - 34, 34], [cx + 34, 34], [cx, 14]], '#1e4d3a', '#0d2a1e');
      poly([[cx - 40, 40], [cx + 40, 40], [cx + 28, 30], [cx - 28, 30]], '#1e4d3a', '#0d2a1e');
      ctx.fillStyle = '#8a2f26'; ctx.fillRect(cx - 22, 40, 44, 22);
      ctx.fillStyle = '#c9a94f'; ctx.fillRect(cx - 5, 48, 10, 14);
    } else if (type === 'house') {
      poly([[cx - 28, 36], [cx + 28, 36], [cx, 18]], '#1e4d3a', '#0d2a1e');
      ctx.fillStyle = '#7a4a2e'; ctx.fillRect(cx - 22, 36, 44, 22);
      ctx.fillStyle = '#ffc86e'; ctx.fillRect(cx - 14, 44, 8, 8); ctx.fillRect(cx + 6, 44, 8, 8);
    } else if (type === 'gate') {
      ctx.fillStyle = '#6e3f2a';
      ctx.fillRect(cx - 30, 20, 7, 42); ctx.fillRect(cx + 23, 20, 7, 42);
      ctx.fillStyle = '#1e4d3a'; ctx.fillRect(cx - 34, 14, 68, 8);
      poly([[cx - 30, 14], [cx + 30, 14], [cx, 2]], '#1e4d3a', '#0d2a1e');
    } else if (type === 'pine') {
      ctx.fillStyle = '#4a3220'; ctx.fillRect(cx - 3, 48, 6, 14);
      poly([[cx - 18, 50], [cx + 18, 50], [cx, 28]], '#1d4a2e', '#0d2a1e');
      poly([[cx - 13, 34], [cx + 13, 34], [cx, 16]], '#25603a', '#0d2a1e');
      poly([[cx - 8, 20], [cx + 8, 20], [cx, 8]], '#e8eef7', '#b8c8d8');
    } else if (type === 'bamboo') {
      ctx.strokeStyle = '#4a8a3a'; ctx.lineWidth = 4;
      for (var b = -2; b <= 2; b++) {
        ctx.beginPath(); ctx.moveTo(cx + b * 10, 62); ctx.lineTo(cx + b * 10, 14 + Math.abs(b) * 4); ctx.stroke();
      }
    } else if (type === 'rock') {
      poly([[cx - 22, 56], [cx - 14, 34], [cx + 4, 26], [cx + 22, 44], [cx + 16, 56]], '#8a8a94', '#5a5a64');
      poly([[cx - 14, 34], [cx + 4, 26], [cx + 10, 36]], '#e8eef7', '#b8c8d8');
    } else if (type === 'lantern') {
      ctx.strokeStyle = '#2a2018'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, 8); ctx.lineTo(cx, 30); ctx.stroke();
      ctx.fillStyle = '#ff5a3c';
      ctx.beginPath(); ctx.ellipse(cx, 40, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffb347';
      ctx.beginPath(); ctx.ellipse(cx, 40, 12, 14, 0, 0, Math.PI * 2); ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
    } else if (type === 'campfire') {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(cx - 16, 54, 32, 6);
      poly([[cx - 8, 54], [cx + 8, 54], [cx, 30]], '#ff8a2a', '#cc4400');
      poly([[cx - 4, 54], [cx + 4, 54], [cx, 40]], '#ffd94d', '#cc8800');
    } else if (type === 'bridge') {
      ctx.fillStyle = '#7d5a34';
      for (var p = 0; p < 5; p++) ctx.fillRect(cx - 30 + p * 12, 44 - Math.abs(p - 2) * 3, 10, 5);
      ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 30, 40); ctx.lineTo(cx + 30, 40); ctx.stroke();
      ctx.fillStyle = '#3a7ab5'; ctx.fillRect(0, 56, W, 8);
    } else if (type === 'portal') {
      ctx.strokeStyle = '#9d4edd'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(cx, 38, 18, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#6a1fb0';
      ctx.beginPath(); ctx.arc(cx, 38, 13, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'statue') {
      ctx.fillStyle = '#7a7264'; ctx.fillRect(cx - 16, 54, 32, 8);
      ctx.fillStyle = '#9aa4b5'; ctx.fillRect(cx - 7, 30, 14, 24);
      ctx.beginPath(); ctx.arc(cx, 24, 8, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'hero' || type === 'monster' || type === 'boss') {
      var col = type === 'hero' ? '#8a2f26' : (type === 'boss' ? '#5a1a6a' : '#3a5a3a');
      ctx.fillStyle = '#f2c89b';
      ctx.beginPath(); ctx.arc(cx, 24, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.fillRect(cx - 10, 34, 20, 18);
      ctx.fillStyle = '#2c3a58';
      ctx.fillRect(cx - 9, 52, 7, 10); ctx.fillRect(cx + 2, 52, 7, 10);
      if (type === 'boss') { ctx.fillStyle = '#e8e8f2'; ctx.beginPath(); ctx.arc(cx, 14, 10, Math.PI, 0); ctx.fill(); }
    } else if (type === 'light') {
      ctx.fillStyle = '#ffd94d';
      ctx.beginPath(); ctx.arc(cx, 32, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffd94d'; ctx.lineWidth = 2;
      for (var r = 0; r < 8; r++) {
        var a = r / 8 * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 14, 32 + Math.sin(a) * 14);
        ctx.lineTo(cx + Math.cos(a) * 20, 32 + Math.sin(a) * 20);
        ctx.stroke();
      }
    } else if (type === 'waterfall') {
      ctx.fillStyle = '#6a6a74';
      poly([[cx - 24, 56], [cx - 18, 16], [cx + 18, 16], [cx + 24, 56]], '#6a6a74', '#4a4a54');
      ctx.fillStyle = '#7ac8e8'; ctx.fillRect(cx - 6, 16, 12, 40);
      ctx.fillStyle = '#e8f4f8'; ctx.beginPath(); ctx.ellipse(cx, 58, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'patrol') {
      ctx.strokeStyle = '#ffd94d'; ctx.lineWidth = 3; ctx.setLineDash([5, 4]);
      ctx.strokeRect(cx - 24, 14, 48, 36);
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd94d';
      [[-24, 14], [24, 14], [24, 50], [-24, 50]].forEach(function (pt) {
        ctx.beginPath(); ctx.arc(cx + pt[0], pt[1], 4, 0, Math.PI * 2); ctx.fill();
      });
    } else if (type === 'fence') {
      ctx.fillStyle = '#6b4a2a';
      for (var f = 0; f < 5; f++) ctx.fillRect(cx - 28 + f * 14, 30, 5, 26);
      ctx.fillRect(cx - 30, 38, 60, 4);
    } else {
      ctx.fillStyle = '#7a7a94';
      if (type === 'sphere') { ctx.beginPath(); ctx.arc(cx, 36, 16, 0, Math.PI * 2); ctx.fill(); }
      else if (type === 'cylinder') { ctx.fillRect(cx - 12, 20, 24, 32); }
      else if (type === 'cone') { poly([[cx - 18, 52], [cx + 18, 52], [cx, 18]], '#7a7a94', '#4a4a64'); }
      else ctx.fillRect(cx - 16, 20, 32, 32);
    }
  }

  AssetManager.render = function () {
    var g = AssetManager._grid;
    if (!g) return;
    g.innerHTML = '';
    var list = ME.Placement.ASSET_LIST.filter(function (a) {
      if (AssetManager._filter !== 'All' && a.cat !== AssetManager._filter) return false;
      if (AssetManager._search && a.name.toLowerCase().indexOf(AssetManager._search) < 0 && a.type.indexOf(AssetManager._search) < 0) return false;
      return true;
    });
    list.forEach(function (a) {
      var card = document.createElement('div');
      card.className = 'asset-card';
      card.draggable = true;
      card.title = a.name + ' — click để đặt, hoặc kéo vào viewport';
      var cv = document.createElement('canvas');
      cv.width = 96; cv.height = 72;
      cv.className = 'asset-thumb';
      drawThumb(cv, a.type);
      card.appendChild(cv);
      var nm = document.createElement('div');
      nm.className = 'asset-name';
      nm.textContent = a.name;
      card.appendChild(nm);
      card.addEventListener('click', function () {
        if (ME.MapEditor) ME.MapEditor.startPlacement(a.type);
      });
      card.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', 'asset:' + a.type);
        e.dataTransfer.effectAllowed = 'copy';
      });
      g.appendChild(card);
    });
    if (!list.length) {
      var none = document.createElement('div');
      none.className = 'asset-none';
      none.textContent = 'Không có asset nào khớp.';
      g.appendChild(none);
    }
  };

  ME.AssetManager = AssetManager;
})();
