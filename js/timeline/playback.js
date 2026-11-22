/* ============================================================
 * timeline/playback.js — Playhead, FPS, loop, frame↔time,
 * điều khiển Timeline keyframes + Animation mixer mỗi frame.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Playback = {
    frame: 0,
    fps: 60,
    totalFrames: 120,
    playing: false,
    loop: true,
    _accumulator: 0
  };

  Playback.setFrame = function (f, silent) {
    const total = PixiStudio.State.get('totalFrames') || Playback.totalFrames;
    Playback.frame = U.clamp(Math.round(f), 0, total);
    if (!silent) bus.emit('timeline:frame', { frame: Playback.frame, fps: Playback.fps, playing: Playback.playing });
    return Playback.frame;
  };

  Playback.setFps = function (fps) {
    Playback.fps = fps;
    PixiStudio.State.set('fps', fps, true);
    bus.emit('timeline:frame', { frame: Playback.frame, fps: fps, playing: Playback.playing });
  };

  Playback.setTotal = function (n) {
    Playback.totalFrames = Math.max(1, Math.round(n));
    PixiStudio.State.set('totalFrames', Playback.totalFrames, true);
    bus.emit('timeline:frame', { frame: Playback.frame, fps: Playback.fps, playing: Playback.playing });
  };

  Playback.play = function () {
    if (Playback.frame >= Playback.totalFrames) Playback.setFrame(0);
    Playback.playing = true;
    bus.emit('timeline:frame', { frame: Playback.frame, fps: Playback.fps, playing: true });
    /* Nếu có animation clip đang chọn → phát luôn */
    if (PixiStudio.Anim.current && PixiStudio.Anim.actions[PixiStudio.Anim.current]) {
      PixiStudio.Anim.resume();
    }
  };

  Playback.pause = function () {
    Playback.playing = false;
    bus.emit('timeline:frame', { frame: Playback.frame, fps: Playback.fps, playing: false });
    if (PixiStudio.Anim.current) PixiStudio.Anim.pause();
  };

  Playback.toggle = function () {
    if (Playback.playing) Playback.pause();
    else Playback.play();
  };

  Playback.stop = function () {
    Playback.playing = false;
    Playback.setFrame(0);
    PixiStudio.Anim.stop();
  };

  Playback.stepForward = function () {
    Playback.pause();
    Playback.setFrame(Playback.frame + 1);
  };

  Playback.stepBackward = function () {
    Playback.pause();
    Playback.setFrame(Playback.frame - 1);
  };

  Playback.toStart = function () { Playback.pause(); Playback.setFrame(0); };
  Playback.toEnd = function () { Playback.pause(); Playback.setFrame(Playback.totalFrames); };

  /* Mỗi frame từ app loop — advance + apply keyframes thật */
  Playback.update = function (dt) {
    if (Playback.playing) {
      Playback._accumulator += dt * Playback.fps;
      while (Playback._accumulator >= 1) {
        Playback._accumulator -= 1;
        let next = Playback.frame + 1;
        if (next > Playback.totalFrames) {
          if (Playback.loop) next = 0;
          else { Playback.pause(); next = Playback.totalFrames; }
        }
        Playback.frame = next;
      }
      bus.emit('timeline:frame', { frame: Playback.frame, fps: Playback.fps, playing: true });
    }

    /* Áp keyframes timeline lên objects (kể cả khi scrub) */
    PixiStudio.Timeline.keys.applyAtFrame(Playback.frame);
  };

  window.PixiStudio.Playback = Playback;
})();
