/* ============================================================
 * viewport/controls.js — Pointer/Touch input: orbit, pan, zoom,
 * select (raycast), context menu. Hỗ trợ cả mouse & touch.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Controls = {
    _dom: null,
    _orbitCam: null,
    _pointers: new Map(),
    _dragging: false,
    _dragButton: -1,
    _lastX: 0, _lastY: 0,
    _downX: 0, _downY: 0,
    _downTime: 0,
    _pinchDist: 0,
    _pickEnabled: true,
    clickRadius: 6
  };

  Controls.init = function (domElement, orbitCam) {
    Controls._dom = domElement;
    Controls._orbitCam = orbitCam;

    domElement.style.touchAction = 'none';

    domElement.addEventListener('pointerdown', Controls._onPointerDown);
    domElement.addEventListener('pointermove', Controls._onPointerMove);
    domElement.addEventListener('pointerup', Controls._onPointerUp);
    domElement.addEventListener('pointercancel', Controls._onPointerUp);
    domElement.addEventListener('wheel', Controls._onWheel, { passive: false });
    domElement.addEventListener('contextmenu', Controls._onContextMenu);
    domElement.addEventListener('dblclick', Controls._onDblClick);
  };

  /* ---------- Pointer handling ---------- */
  /* FIX pointer-capture (2026-11-27): chỉ coi pointerdown là thao tác
   * viewport khi nó rơi TRỰC TIẾP lên bề mặt viewport — chính wrap hoặc
   * 1 trong 2 canvas render (#three-canvas, #pixi-overlay). Trước đây
   * MỌI pointerdown bubbling từ con cháu trong wrap (vd nút toolbar ARP
   * View) cũng bị setPointerCapture + bắt đầu drag, nên pointerup/click
   * bị retarget về wrap DIV và handler của nút không chạy (đo thật trên
   * chuột: pointerdown target=BUTTON, pointerup/click target=DIV,
   * handler 0 lần; tap cảm ứng cũng bị retarget pointerup). Nút/input/
   * panel/HUD trong wrap được bỏ qua hoàn toàn: không capture, không
   * drag, không track pointer — sự kiện cứ bubble bình thường tới nút. */
  Controls._isViewportTarget = function (target) {
    if (!target) return false;
    if (target === Controls._dom) return true;
    /* Canvas không có con hiển thị được nên target là CANVAS chắc chắn
     * là 1 trong 2 canvas render trong wrap; mọi phần tử DOM khác
     * (toolbar, HUD, panel, nút...) đều là UI. */
    return target.tagName === 'CANVAS';
  };

  Controls._onPointerDown = function (e) {
    if (!Controls._isViewportTarget(e.target)) return;
    Controls._dom.setPointerCapture && Controls._dom.setPointerCapture(e.pointerId);
    Controls._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (Controls._pointers.size === 2) {
      /* bắt đầu pinch */
      const pts = Array.from(Controls._pointers.values());
      Controls._pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      Controls._dragging = false;
      return;
    }

    Controls._dragging = true;
    Controls._dragButton = e.button;
    Controls._lastX = Controls._downX = e.clientX;
    Controls._lastY = Controls._downY = e.clientY;
    Controls._downTime = Date.now();
  };

  Controls._onPointerMove = function (e) {
    /* Track pointers cho pinch */
    if (Controls._pointers.has(e.pointerId)) {
      Controls._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    /* Pinch zoom 2 ngón */
    if (Controls._pointers.size === 2) {
      const pts = Array.from(Controls._pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (Controls._pinchDist > 0 && Math.abs(dist - Controls._pinchDist) > 1) {
        Controls._orbitCam.zoomBy(Controls._pinchDist / Math.max(1, dist));
      }
      Controls._pinchDist = dist;
      return;
    }

    /* Gizmo đang kéo → bỏ qua orbit */
    const tc = PixiStudio.Gizmo.transformControls;
    if (tc && tc.dragging) return;

    if (!Controls._dragging) return;

    const dx = e.clientX - Controls._lastX;
    const dy = e.clientY - Controls._lastY;
    Controls._lastX = e.clientX;
    Controls._lastY = e.clientY;

    if (Controls._dragButton === 0 && !e.shiftKey && !e.ctrlKey) {
      Controls._orbitCam.orbit(dx, dy);
    } else if (Controls._dragButton === 2 || (Controls._dragButton === 0 && e.shiftKey)) {
      Controls._orbitCam.pan(dx, dy);
    } else if (Controls._dragButton === 1) {
      Controls._orbitCam.pan(dx, dy);
    }
  };

  Controls._onPointerUp = function (e) {
    Controls._pointers.delete(e.pointerId);
    if (Controls._pointers.size < 2) Controls._pinchDist = 0;

    const wasDrag = Controls._dragging;
    Controls._dragging = false;

    if (!wasDrag || Controls._dragButton !== 0) return;

    /* Click (không phải drag) → select */
    const moved = Math.hypot(e.clientX - Controls._downX, e.clientY - Controls._downY);
    const quick = Date.now() - Controls._downTime < 450;
    if (moved < Controls.clickRadius && quick && Controls._pickEnabled) {
      Controls.pickAt(e.clientX, e.clientY);
    }
  };

  Controls._onWheel = function (e) {
    e.preventDefault();
    if (e.ctrlKey) {
      /* Ctrl+wheel = zoom nhanh hơn */
      Controls._orbitCam.zoomBy(Math.pow(0.995, e.deltaY));
    } else {
      Controls._orbitCam.zoomBy(Math.pow(0.9985, e.deltaY));
    }
  };

  Controls._onContextMenu = function (e) {
    /* Cùng nguyên nhân pointer-capture: chuột phải lên nút/panel trong
     * wrap không được mở menu context của viewport. */
    if (!Controls._isViewportTarget(e.target)) return;
    e.preventDefault();
    /* Chọn object dưới chuột trước khi mở menu */
    const hit = Controls.raycastAt(e.clientX, e.clientY);
    bus.emit('ui:contextmenu', {
      x: e.clientX, y: e.clientY,
      target: hit ? hit : null,
      zone: 'viewport'
    });
  };

  Controls._onDblClick = function (e) {
    /* Double-click lên nút/panel trong wrap không phải focus viewport. */
    if (!Controls._isViewportTarget(e.target)) return;
    /* Double click → focus object dưới chuột */
    const hit = Controls.raycastAt(e.clientX, e.clientY);
    if (hit) {
      PixiStudio.State.select(hit);
      PixiStudio.Viewport.focusSelected();
    }
  };

  /* ---------- Picking ---------- */
  Controls.raycastAt = function (clientX, clientY) {
    const vp = PixiStudio.Viewport;
    if (!vp || !vp.scene) return null;
    const rect = Controls._dom.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    return vp.pick(ndcX, ndcY);
  };

  Controls.pickAt = function (clientX, clientY) {
    const hit = Controls.raycastAt(clientX, clientY);
    const state = PixiStudio.State;
    if (hit) {
      state.select(hit);
      /* Sparkle Pixi tại vị trí click + tên object nổi 2D (v20.0) */
      const rect = Controls._dom.getBoundingClientRect();
      PixiStudio.PixiRenderer.burst(clientX - rect.left, clientY - rect.top, 14);
      if (hit && hit.name) PixiStudio.PixiRenderer.floatText(hit.name, clientX - rect.left, clientY - rect.top - 14);
    } else {
      state.select(null);
    }
  };

  Controls.setPickEnabled = function (on) { Controls._pickEnabled = !!on; };

  window.PixiStudio.Controls = Controls;
})();
