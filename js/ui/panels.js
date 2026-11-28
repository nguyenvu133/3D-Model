/* ============================================================
 * ui/panels.js — Resizers (kéo đổi kích thước panel), collapse,
 * context menu, dropdown system, drawer (tablet/mobile).
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Panels = { dropdown: null };

  /* ============================================================
     RESIZERS — kéo đổi --left-w / --right-w / --bottom-h
     ============================================================ */
  Panels.setupResizers = function () {
    const app = document.getElementById('app');

    const setupDrag = function (el, onMove, vertical) {
      if (!el) return;
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        el.classList.add('dragging');
        document.body.classList.add(vertical ? 'resizing-v' : 'resizing');
        const startX = e.clientX, startY = e.clientY;
        const onPointerMove = function (ev) {
          onMove(ev.clientX - startX, ev.clientY - startY);
        };
        const onPointerUp = function () {
          el.classList.remove('dragging');
          document.body.classList.remove('resizing', 'resizing-v');
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          bus.emit('viewport:resized', {});
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });
    };

    /* Left panel width */
    const rzLeft = document.getElementById('rz-left');
    let leftStart = 0;
    setupDrag(rzLeft, function (dx) {
      const current = parseInt(getComputedStyle(app).getPropertyValue('--left-w')) || 300;
      const startW = leftStart || current;
      leftStart = startW;
      const w = U.clamp(startW + dx, 180, 560);
      app.style.setProperty('--left-w', w + 'px');
    });
    rzLeft.addEventListener('pointerdown', function () { leftStart = parseInt(getComputedStyle(app).getPropertyValue('--left-w')) || 300; });

    /* Right panel width */
    const rzRight = document.getElementById('rz-right');
    let rightStart = 0;
    setupDrag(rzRight, function (dx) {
      const current = parseInt(getComputedStyle(app).getPropertyValue('--right-w')) || 320;
      const startW = rightStart || current;
      rightStart = startW;
      const w = U.clamp(startW - dx, 200, 560);
      app.style.setProperty('--right-w', w + 'px');
    });
    rzRight.addEventListener('pointerdown', function () { rightStart = parseInt(getComputedStyle(app).getPropertyValue('--right-w')) || 320; });

    /* Bottom height */
    const rzBottom = document.getElementById('rz-bottom');
    let bottomStart = 0;
    setupDrag(rzBottom, function (dx, dy) {
      const current = parseInt(getComputedStyle(app).getPropertyValue('--bottom-h')) || 224;
      const startH = bottomStart || current;
      bottomStart = startH;
      const h = U.clamp(startH - dy, 110, 500);
      app.style.setProperty('--bottom-h', h + 'px');
    }, true);
    rzBottom.addEventListener('pointerdown', function () { bottomStart = parseInt(getComputedStyle(app).getPropertyValue('--bottom-h')) || 224; });

    /* Collapse buttons */
    const collapseLeft = document.getElementById('left-collapse-btn');
    if (collapseLeft) {
      collapseLeft.addEventListener('click', function () {
        app.classList.add('left-collapsed');
        PixiStudio.State.set('leftCollapsed', true);
      });
    }
  };

  /* ============================================================
     CONTEXT MENU
     ============================================================ */
  Panels.contextMenu = {
    el: null,
    open: function (items, x, y) {
      const el = document.getElementById('context-menu');
      if (!el) return;
      el.innerHTML = '';
      items.forEach(function (item) {
        if (item.sep) {
          el.appendChild(U.el('div', { class: 'ctx-sep' }));
          return;
        }
        el.appendChild(U.el('div', {
          class: 'ctx-item' + (item.disabled ? ' disabled' : ''),
          html: U.icon(item.icon || 'dots') + '<span>' + item.label + '</span>' + (item.kbd ? '<span class="kbd">' + item.kbd + '</span>' : ''),
          onclick: function () {
            Panels.contextMenu.close();
            if (item.onClick) item.onClick();
          }
        }));
      });
      el.classList.add('open');
      /* giữ trong màn hình */
      const mw = el.offsetWidth, mh = el.offsetHeight;
      el.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
      el.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
    },
    close: function () {
      const el = document.getElementById('context-menu');
      if (el) el.classList.remove('open');
    }
  };

  /* ============================================================
     DROPDOWN MENU
     ============================================================ */
  Panels.dropdown = {
    open: function (items, x, y) {
      const root = document.getElementById('dropdown-root');
      if (!root) return;
      root.innerHTML = '';
      items.forEach(function (item) {
        if (item.sep) {
          root.appendChild(U.el('div', { class: 'ctx-sep' }));
          return;
        }
        if (item.title) {
          root.appendChild(U.el('div', { class: 'dd-title', text: item.title }));
          return;
        }
        root.appendChild(U.el('div', {
          class: 'dd-item',
          html: U.icon(item.icon || 'dots') + '<span>' + item.label + '</span>' + (item.hint ? '<span class="dd-hint">' + item.hint + '</span>' : '') + '<span class="dd-check">✓</span>',
          onclick: function () {
            Panels.dropdown.close();
            if (item.onClick) item.onClick();
          }
        }));
      });
      root.classList.add('open');
      root.style.left = U.clamp(x, 8, window.innerWidth - 220) + 'px';
      root.style.top = U.clamp(y, 60, window.innerHeight - 240) + 'px';
    },
    close: function () {
      const root = document.getElementById('dropdown-root');
      if (root) root.classList.remove('open');
    }
  };

  /* Context menu wiring toàn cục */
  Panels.setupContextMenus = function () {
    bus.on('ui:contextmenu', function (data) {
      const items = [];

      if (data.zone === 'viewport') {
        const sel = data.target;
        items.push({ label: sel ? 'Select ' + (sel.name || 'Object') : 'Deselect', icon: 'cursor', onClick: function () { PixiStudio.State.select(sel || null); } });
        if (sel) {
          items.push({ sep: true });
          items.push({ label: 'Focus', icon: 'focus', kbd: 'F', onClick: function () { PixiStudio.Viewport.focusSelected(); } });
          items.push({ label: 'Duplicate', icon: 'duplicate', kbd: 'Ctrl+D', onClick: function () { PixiStudio.Scene.duplicate(sel); } });
          items.push({ label: 'Rename…', icon: 'edit', onClick: function () { PixiStudio.Modals.prompt({ title: 'Rename', label: 'Tên mới:', value: sel.name || '', onOk: function (v) { if (v.trim()) { PixiStudio.Scene.rename(sel, v.trim()); PixiStudio.Inspector.render(); } } }); } });
          items.push({ label: 'Auto Rig', icon: 'rig', onClick: function () { PixiStudio.Rig.autoRig(sel); } });
          if (PixiStudio.Prefab) items.push({ label: 'Save as Prefab…', icon: 'cube', onClick: function () { PixiStudio.Prefab.createFromObjectInteractive(sel); } });
          items.push({ sep: true });
          items.push({ label: 'Delete', icon: 'trash', kbd: 'Del', onClick: function () { PixiStudio.Scene.deleteObject(sel); } });
        } else {
          items.push({ sep: true });
          items.push({ label: 'Create Box', icon: 'cube', onClick: function () { PixiStudio.Scene.createPrimitive('box'); } });
          items.push({ label: 'Create Sphere', icon: 'cube', onClick: function () { PixiStudio.Scene.createPrimitive('sphere'); } });
        }
      } else if (data.zone === 'tree') {
        const t = data.target;
        if (t) {
          items.push({ label: 'Select', icon: 'cursor', onClick: function () { PixiStudio.State.select(t); } });
          items.push({ label: 'Rename…', icon: 'edit', onClick: function () { PixiStudio.Modals.prompt({ title: 'Rename', label: 'Tên mới:', value: t.name || '', onOk: function (v) { if (v.trim()) PixiStudio.Scene.rename(t, v.trim()); PixiStudio.Scene.renderTree(); } }); } });
          items.push({ label: 'Duplicate', icon: 'duplicate', onClick: function () { PixiStudio.Scene.duplicate(t); } });
          if (PixiStudio.Prefab) items.push({ label: 'Save as Prefab…', icon: 'cube', onClick: function () { PixiStudio.Prefab.createFromObjectInteractive(t); } });
          items.push({ label: 'Lock / Unlock', icon: 'lock', onClick: function () { PixiStudio.Scene.toggleLock(t); PixiStudio.Scene.renderTree(); } });          items.push({ label: 'Hide / Show', icon: 'eye', onClick: function () { PixiStudio.Scene.toggleVisible(t); PixiStudio.Scene.renderTree(); } });
          items.push({ sep: true });
          items.push({ label: 'Delete', icon: 'trash', onClick: function () { PixiStudio.Scene.deleteObject(t); } });
        }
      } else if (data.zone === 'asset') {
        const a = data.asset;
        if (a) {
          const AL = PixiStudio.AssetLibrary;
          items.push({ label: 'Load "' + a.name + '"', icon: 'import', onClick: function () { PixiStudio.AssetLibrary.selectAsset(a.id); } });
          items.push({ label: 'Preview thumbnail', icon: 'image', onClick: function () { PixiStudio.Modals.open({ title: a.name, body: (function () { const img = U.el('img', { src: PixiStudio.AssetLibrary.generateThumbnail(a) || '', style: 'width:100%;border-radius:10px;' }); return img; })(), buttons: [{ label: 'Close', class: 'btn' }] }); } });
          items.push({ sep: true });
          items.push({ label: 'Rename…', icon: 'edit', onClick: function () { if (AL && typeof AL.renameAsset === 'function') AL.renameAsset(a.id); } });
          items.push({ label: 'Duplicate', icon: 'duplicate', onClick: function () { if (AL && typeof AL.duplicateAsset === 'function') AL.duplicateAsset(a.id); } });
          items.push({ label: (a.favorite ? '★ Bỏ favorite' : '☆ Favorite'), icon: 'star', onClick: function () { if (AL && typeof AL.toggleFavorite === 'function') AL.toggleFavorite(a.id); } });
          items.push({ label: 'Add tag…', icon: 'tag', onClick: function () { if (AL && typeof AL.addTag === 'function') AL.addTag(a.id); } });
          items.push({ label: 'Details…', icon: 'info', onClick: function () { if (AL && typeof AL.showDetails === 'function') AL.showDetails(a.id); } });
          items.push({ sep: true });
          items.push({ label: 'Delete', icon: 'trash', onClick: function () { if (AL && typeof AL.deleteAsset === 'function') AL.deleteAsset(a.id); } });
        }
      } else if (data.zone === 'keyframe') {
        items.push({ label: 'Copy keyframe', icon: 'copy', kbd: 'Ctrl+C', onClick: function () { PixiStudio.Timeline.keys.copySelected(); } });
        items.push({ label: 'Delete keyframe', icon: 'trash', kbd: 'Del', onClick: function () { PixiStudio.Timeline.keys.deleteSelected(); } });
      }

      if (items.length) Panels.contextMenu.open(items, data.x, data.y);
    });

    /* đóng menu khi click elsewhere */
    document.addEventListener('pointerdown', function (e) {
      const ctx = document.getElementById('context-menu');
      const dd = document.getElementById('dropdown-root');
      if (ctx && !ctx.contains(e.target)) Panels.contextMenu.close();
      if (dd && !dd.contains(e.target)) Panels.dropdown.close();
    });
  };

  /* ============================================================
     DRAWERS (tablet/mobile) + viewport buttons
     ============================================================ */
  Panels.setupDrawers = function () {
    const leftToggle = document.getElementById('drawer-left-toggle');
    const rightToggle = document.getElementById('drawer-right-toggle');
    const backdrop = document.getElementById('drawer-backdrop');

    if (leftToggle) {
      leftToggle.addEventListener('click', function () {
        document.body.classList.toggle('left-drawer-open');
        document.body.classList.remove('right-drawer-open');
      });
    }
    if (rightToggle) {
      rightToggle.addEventListener('click', function () {
        document.body.classList.toggle('right-drawer-open');
        document.body.classList.remove('left-drawer-open');
      });
    }
    if (backdrop) {
      backdrop.addEventListener('click', function () {
        document.body.classList.remove('left-drawer-open', 'right-drawer-open');
      });
    }
  };

  /* ---------- VIEWPORT BUTTONS ---------- */
  Panels.setupViewportButtons = function () {
    const bind = function (id, fn) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };

    /* View mode select */
    const viewSelect = document.getElementById('view-mode-select');
    if (viewSelect) {
      viewSelect.addEventListener('change', function () {
        PixiStudio.Viewport.setView(viewSelect.value);
        const sbView = document.getElementById('sb-view');
        if (sbView) sbView.textContent = 'View: ' + viewSelect.value;
      });
    }

    /* Shading select */
    const shadingSelect = document.getElementById('shading-select');
    if (shadingSelect) {
      shadingSelect.addEventListener('change', function () {
        PixiStudio.State.set('shading', shadingSelect.value);
        PixiStudio.Viewport.invalidateShading();
      });
    }

    bind('vp-grid-btn', function () {
      const on = !PixiStudio.GridEnv.visible;
      PixiStudio.GridEnv.setVisible(on);
      document.getElementById('vp-grid-btn').classList.toggle('active', on);
    });
    bind('vp-bones-btn', function () {
      const on = PixiStudio.Rig.toggleVisibility();
      document.getElementById('vp-bones-btn').classList.toggle('active', on);
      if (on && !PixiStudio.Rig.current) {
        PixiStudio.Rig.autoRig(null);
        PixiStudio.Rig.toggleVisibility(true);
      }
    });
    bind('vp-cam-btn', function () { PixiStudio.Viewport.resetCamera(); });
    bind('vp-focus-btn', function () { PixiStudio.Viewport.focusSelected(); });
    bind('vp-frame-btn', function () { PixiStudio.Viewport.frameAll(); });
    bind('vp-screenshot-btn', function () {
      const url = PixiStudio.Viewport.screenshot(1920, 1080, 'png');
      if (url) {
        U.downloadDataURL(url, 'viewport_screenshot.png');
        bus.emit('notify', { type: 'success', title: 'Screenshot', message: 'Đã tải 1920×1080 PNG' });
      }
    });
    bind('vp-fullscreen-btn', function () {
      const wrap = document.getElementById('viewport-canvas-wrap');
      if (document.fullscreenElement) document.exitFullscreen();
      else if (wrap) wrap.requestFullscreen().catch(function () { });
    });
    bind('vp-menu-btn', function (e) {
      PixiStudio.Panels.dropdown.open([
        { title: 'Viewport' },
        { label: 'Reset camera', icon: 'camera', onClick: function () { PixiStudio.Viewport.resetCamera(); } },
        { label: 'Focus selected', icon: 'focus', kbd: 'F', onClick: function () { PixiStudio.Viewport.focusSelected(); } },
        { sep: true },
        { label: 'Quad View', icon: 'grid', kbd: '2', onClick: function () { PixiStudio.Viewport.setView('quad'); document.getElementById('view-mode-select').value = 'quad'; } },
        { label: 'Perspective', icon: 'cube', kbd: '1', onClick: function () { PixiStudio.Viewport.setView('perspective'); document.getElementById('view-mode-select').value = 'perspective'; } },
        { label: 'Iso View', icon: 'cube', onClick: function () { PixiStudio.Viewport.setView('iso'); document.getElementById('view-mode-select').value = 'iso'; } },
        { label: 'Frame all', icon: 'expand', onClick: function () { PixiStudio.Viewport.frameAll(); } },
        { sep: true },
        { title: 'Camera bookmarks (Alt+1..5 nhảy · Alt+Shift+1..5 lưu)' },
        { label: 'Lưu bookmark 1', onClick: function () { PixiStudio.Viewport.saveCameraBookmark(0); bus.emit('notify', { type: 'success', title: 'Bookmark', message: 'Đã lưu vị trí camera 1.' }); } },
        { label: 'Lưu bookmark 2', onClick: function () { PixiStudio.Viewport.saveCameraBookmark(1); bus.emit('notify', { type: 'success', title: 'Bookmark', message: 'Đã lưu vị trí camera 2.' }); } },
        { label: 'Lưu bookmark 3', onClick: function () { PixiStudio.Viewport.saveCameraBookmark(2); bus.emit('notify', { type: 'success', title: 'Bookmark', message: 'Đã lưu vị trí camera 3.' }); } },
        { label: 'Lưu bookmark 4', onClick: function () { PixiStudio.Viewport.saveCameraBookmark(3); bus.emit('notify', { type: 'success', title: 'Bookmark', message: 'Đã lưu vị trí camera 4.' }); } },
        { label: 'Lưu bookmark 5', onClick: function () { PixiStudio.Viewport.saveCameraBookmark(4); bus.emit('notify', { type: 'success', title: 'Bookmark', message: 'Đã lưu vị trí camera 5.' }); } },
        { label: 'Tới bookmark 1', onClick: function () { if (!PixiStudio.Viewport.gotoCameraBookmark(0)) bus.emit('notify', { type: 'warning', title: 'Bookmark', message: 'Vị trí 1 chưa lưu.' }); } },
        { label: 'Tới bookmark 2', onClick: function () { if (!PixiStudio.Viewport.gotoCameraBookmark(1)) bus.emit('notify', { type: 'warning', title: 'Bookmark', message: 'Vị trí 2 chưa lưu.' }); } },
        { label: 'Tới bookmark 3', onClick: function () { if (!PixiStudio.Viewport.gotoCameraBookmark(2)) bus.emit('notify', { type: 'warning', title: 'Bookmark', message: 'Vị trí 3 chưa lưu.' }); } },
        { label: 'Tới bookmark 4', onClick: function () { if (!PixiStudio.Viewport.gotoCameraBookmark(3)) bus.emit('notify', { type: 'warning', title: 'Bookmark', message: 'Vị trí 4 chưa lưu.' }); } },
        { label: 'Tới bookmark 5', onClick: function () { if (!PixiStudio.Viewport.gotoCameraBookmark(4)) bus.emit('notify', { type: 'warning', title: 'Bookmark', message: 'Vị trí 5 chưa lưu.' }); } },
        { sep: true },
        { label: 'Toggle Gizmo (Q)', icon: 'cursor', onClick: function () { PixiStudio.Shortcuts.setGizmoMode('select'); } },
        { label: 'Local / World space', icon: 'target', onClick: function () { const s = PixiStudio.State.get('gizmoSpace') === 'local' ? 'world' : 'local'; PixiStudio.State.set('gizmoSpace', s); PixiStudio.Gizmo.setSpace(s); bus.emit('notify', { type: 'info', title: 'Gizmo space', message: s }); } }
      ], e.clientX - 160, e.clientY + 10);
    });

    /* viewport tool strip */
    U.$$('#viewport-tools .vtool').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const tool = btn.getAttribute('data-tool');
        if (tool === 'focus') { PixiStudio.Viewport.focusSelected(); return; }
        if (tool === 'bones') {
          const on = PixiStudio.Rig.toggleVisibility();
          btn.classList.toggle('active', on);
          return;
        }
        PixiStudio.Shortcuts.setGizmoMode(tool);
        U.$$('#viewport-tools .vtool').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });
  };

  /* ---------- Init all ---------- */
  Panels.init = function () {
    Panels.setupResizers();
    Panels.setupContextMenus();
    Panels.setupDrawers();
    Panels.setupViewportButtons();

    /* section collapse toggles */
    U.$$('[data-toggle-section]').forEach(function (head) {
      head.addEventListener('click', function () {
        head.parentElement.classList.toggle('collapsed');
      });
    });

    /* Topbar Export button → Save Center dialog (nếu có SaveManager) */
    const topExport = document.getElementById('btn-export-top');
    if (topExport) {
      topExport.addEventListener('click', function () {
        if (PixiStudio.SaveManager) PixiStudio.SaveManager.openDialog();
      });
    }

    /* Topbar "GLB → FBX Mixamo" → chuyển file .glb trên máy thẳng
       thành FBX Mixamo-safe, KHÔNG cần load model vào scene (nút
       Save Mixamo chỉ xuất model đang ở trong scene). */
    const topConvert = document.getElementById('btn-convert-glb-fbx');
    if (topConvert) {
      topConvert.addEventListener('click', function () {
        if (PixiStudio.SaveManager && PixiStudio.SaveManager.convertGLBToMixamoFBX) PixiStudio.SaveManager.convertGLBToMixamoFBX();
        else bus.emit('notify', { type: 'error', title: 'GLB → FBX Mixamo', message: 'SaveManager chưa sẵn sàng.' });
      });
    }
    /* Topbar "Tối ưu FBX" → tối ưu model đang ở trong scene
       (giảm tris giữ rig + thu nhỏ texture) đến khi file dưới mức
       dung lượng đã chọn ở select cạnh nút (mặc định <1MB) rồi tải về. */
    const topOpt = document.getElementById('btn-optimize-fbx');
    if (topOpt) {
      topOpt.addEventListener('click', function () {
        if (PixiStudio.SaveManager && PixiStudio.SaveManager.optimizeFBXUnder1MB) {
          var targetBytes;
          var sel = document.getElementById('opt-target-size');
          if (sel && sel.value) { var v = parseInt(sel.value, 10); if (isFinite(v) && v > 0) targetBytes = v; }
          PixiStudio.SaveManager.optimizeFBXUnder1MB(targetBytes);
        }
        else bus.emit('notify', { type: 'error', title: 'Tối ưu FBX', message: 'SaveManager chưa sẵn sàng.' });
      });
    }
    /* Topbar "Tạo Skeleton + Skin" (user 2026-11-28 ~20:37) → 1 bấm tự
       tạo skeleton Mixamo 41 xương + skin weights cho model đang load,
       KHÔNG đặt marker tay, KHÔNG tải file: gọi AutoRigPro.run với
       export:false (rig ở lại trong scene, skeleton tự hiện qua
       arp:rig-complete → ArpVpSkeleton.autoShow; xuất sau qua Export
       FBX hiện có). Model đã rig / chưa có model thì run() tự báo và
       dừng, không ghi đè (guard hasRig/alreadyRigged). Khác nút
       "Auto Rig Pro Blend" (mở panel + xuất FBX rigged + .py về máy). */
    const topAutoSkeleton = document.getElementById('btn-auto-skeleton');
    if (topAutoSkeleton) {
      topAutoSkeleton.addEventListener('click', function () {
        if (PixiStudio.AutoRigPro && PixiStudio.AutoRigPro.run) PixiStudio.AutoRigPro.run(null, { export: false });
        else bus.emit('notify', { type: 'error', title: 'Tạo Skeleton + Skin', message: 'AutoRigPro chưa sẵn sàng.' });
      });
    }
    /* Topbar "Auto Rig Pro Blend" → đo landmark + dựng skeleton Mixamo
       41 xương + skin tự động trên model CHƯA rig, xuất FBX rigged +
       script Blender (.py) để lưu thành .blend. Model đã rig thì báo
       và dừng, không ghi đè. */
    const topAutoRigPro = document.getElementById('btn-auto-rig-pro');
    if (topAutoRigPro) {
      topAutoRigPro.addEventListener('click', function () {
        if (PixiStudio.ArpPanel && PixiStudio.ArpPanel.open) PixiStudio.ArpPanel.open();
        else if (PixiStudio.AutoRigPro && PixiStudio.AutoRigPro.run) PixiStudio.AutoRigPro.run();
        else bus.emit('notify', { type: 'error', title: 'Auto Rig Pro Blend', message: 'AutoRigPro chưa sẵn sàng.' });
      });
    }
    /* Topbar "Save Mixamo" → xuất FBX Mixamo-safe (mesh-only < 50k
       tris + texture nhúng, tự decimate giữ UV khi cần) ngay,
       không mở Save Center. Ctrl+Shift+M cũng chạy. */
    const topMixamo = document.getElementById('btn-save-mixamo');
    if (topMixamo) {
      topMixamo.addEventListener('click', function () {
        if (!PixiStudio.SaveManager) {
          bus.emit('notify', { type: 'error', title: 'Save Mixamo', message: 'SaveManager chưa sẵn sàng.' });
          return;
        }
        PixiStudio.SaveManager.save('fbx-mixamo');
      });
    }

    /* Topbar "Xuất FBX chuẩn" → mở CỬA SỔ BẢNG chuẩn hóa Golden
       (PixiStudio.Modals, cùng pattern Save Center): bảng 6 bước đo thật
       từ model đang load, nút "Chuẩn hóa & Xuất FBX" chạy pipeline 5
       bước rồi điền cột Sau + PASS/FAIL từng hàng, sau đó mới tải file
       `<tên-gốc>-Standard.fbx` về. Logic ở js/exporter/
       golden-standard-export.js — nút này chỉ MỞ cửa sổ, không xuất thẳng. */
    const topGoldenStandard = document.getElementById('btn-golden-standard');
    if (topGoldenStandard) {
      topGoldenStandard.addEventListener('click', function () {
        if (PixiStudio.GoldenStandardExport && PixiStudio.GoldenStandardExport.openDialog) PixiStudio.GoldenStandardExport.openDialog();
        else bus.emit('notify', { type: 'error', title: 'Xuất FBX chuẩn', message: 'GoldenStandardExport chưa sẵn sàng.' });
      });
    }

    /* Topbar "Save Mixamo Rig" → FBX 2013 mesh-only Mixamo-safe
       (khung 65 xương vẫn giữ trong scene để làm animation, không
       xuất ra file). Ctrl+Shift+R cũng chạy. */
    const topMixamoRig = document.getElementById('btn-save-mixamo-rig');
    if (topMixamoRig) {
      topMixamoRig.addEventListener('click', function () {
        if (PixiStudio.SaveManager) PixiStudio.SaveManager.save('fbx-mixamo-rig');
        else bus.emit('notify', { type: 'error', title: 'Save Mixamo Rig', message: 'SaveManager chưa sẵn sàng.' });
      });
    }
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
        const t = e.target;
        if (t && t.tagName && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
        e.preventDefault();
        if (PixiStudio.SaveManager) PixiStudio.SaveManager.save('fbx-mixamo-rig');
      }
    });

    /* Topbar "Save OBJ ZIP" → xuất ZIP .obj + .mtl + ảnh texture (OBJ có màu).
       Ctrl+Shift+O cũng chạy. */
    const topObjZip = document.getElementById('btn-save-objzip');
    if (topObjZip) {
      topObjZip.addEventListener('click', function () {
        if (PixiStudio.SaveManager) PixiStudio.SaveManager.save('obj-color');
        else bus.emit('notify', { type: 'error', title: 'Save OBJ ZIP', message: 'SaveManager chưa sẵn sàng.' });
      });
    }
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
        const t = e.target;
        if (t && t.tagName && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
        e.preventDefault();
        if (PixiStudio.SaveManager) PixiStudio.SaveManager.save('obj-color');
      }
    });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
        const t = e.target;
        if (t && t.tagName && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
        e.preventDefault();
        if (PixiStudio.SaveManager) PixiStudio.SaveManager.save('fbx-mixamo');
      }
    });
  };

  window.PixiStudio.Panels = Panels;
  window.PixiStudio.UI = window.PixiStudio.UI || {};
  window.PixiStudio.UI.panels = {
    showLeftPage: function (id) { PixiStudio.Toolbar.selectTool(id); }
  };
})();
