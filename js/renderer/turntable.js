/* ============================================================
 * renderer/turntable.js — Turntable Capture (v21.0)
 *
 * Xoay model 360° theo từng bước và chụp từng khung hình từ canvas
 * WebGL (toDataURL) — làm ảnh thumbnail xoay, GIF/preview, hoặc
 * kiểm tra model từ mọi góc. Chạy theo nhịp setTimeout để renderer
 * kịp vẽ xong từng khung.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;

  const Turntable = {
    running: false,
    target: null,
    steps: 24,
    totalDeg: 360,
    stepIndex: 0,
    frames: [],       // [{angle, dataUrl}]
    intervalMs: 140,
    _timer: null,
    _startYaw: 0
  };

  /* Danh sách góc chụp (độ) — hàm thuần, test được không cần renderer. */
  Turntable.angles = function (steps, startDeg, totalDeg) {
    steps = Math.max(1, steps | 0);
    const start = startDeg || 0, total = (totalDeg === undefined) ? 360 : totalDeg;
    const out = [];
    for (let i = 0; i < steps; i++) out.push(start + (total * i) / steps);
    return out;
  };

  Turntable.captureFrame = function () {
    const R = PixiStudio.ThreeRenderer && PixiStudio.ThreeRenderer.renderer;
    if (!R || !R.domElement) return null;
    try { return R.domElement.toDataURL('image/png'); } catch (e) { return null; }
  };

  Turntable.start = function (target, opts) {
    if (Turntable.running) return false;
    target = target || (PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current && PixiStudio.RigAutoGen.current.target);
    if (!target) { bus.emit('notify', { type: 'warning', title: 'Turntable', message: 'Chưa có model để xoay.' }); return false; }
    opts = opts || {};
    Turntable.target = target;
    Turntable.steps = Math.max(1, opts.steps || 24);
    Turntable.totalDeg = (opts.totalDeg === undefined) ? 360 : opts.totalDeg;
    Turntable.intervalMs = opts.intervalMs || 140;
    Turntable.stepIndex = 0;
    Turntable.frames = [];
    Turntable._startYaw = target.rotation.y || 0;
    Turntable.running = true;
    bus.emit('turntable:started', { steps: Turntable.steps });
    Turntable._timer = setTimeout(function () { Turntable.next(); }, Turntable.intervalMs);
    return true;
  };

  /* Tiến 1 bước: xoay + chụp. Trả false khi xong. */
  Turntable.next = function () {
    if (!Turntable.running || !Turntable.target) return false;
    const angles = Turntable.angles(Turntable.steps, 0, Turntable.totalDeg);
    const deg = angles[Turntable.stepIndex];
    Turntable.target.rotation.y = Turntable._startYaw + THREE.MathUtils.degToRad(deg);
    if (Turntable.target.updateMatrixWorld) Turntable.target.updateMatrixWorld(true);
    const shot = Turntable.captureFrame();
    Turntable.frames.push({ angle: Math.round(deg * 10) / 10, dataUrl: shot });
    Turntable.stepIndex++;
    bus.emit('turntable:frame', { index: Turntable.stepIndex, total: Turntable.steps, angle: deg });
    if (Turntable.stepIndex >= Turntable.steps) {
      Turntable.stop();
      return false;
    }
    Turntable._timer = setTimeout(function () { Turntable.next(); }, Turntable.intervalMs);
    return true;
  };

  Turntable.stop = function () {
    if (Turntable._timer) { clearTimeout(Turntable._timer); Turntable._timer = null; }
    const done = Turntable.running;
    Turntable.running = false;
    if (Turntable.target) Turntable.target.rotation.y = Turntable._startYaw;
    bus.emit('turntable:stopped', { frames: Turntable.frames.length });
    return done;
  };

  Turntable.progress = function () {
    return { running: Turntable.running, done: Turntable.stepIndex, total: Turntable.steps, frames: Turntable.frames.length };
  };

  window.PixiStudio.Turntable = Turntable;
})();
