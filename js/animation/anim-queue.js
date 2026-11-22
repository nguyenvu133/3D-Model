/* ============================================================
 * animation/anim-queue.js — "Added" queue kiểu Meshy Animate (v20.1)
 *
 * Meshy có tab Added: mọi motion đã thêm vào nhân vật, phát lần lượt,
 * export Current / All Added. Queue này làm đúng việc đó ở local:
 *   • add(item) — item: { source: 'autogen'|'preset'|'fbx'|'m2m',
 *                   clipId, label, duration, loop, speed, url? }
 *   • playAll() — phát từng item theo thứ tự, crossfade giữa các clip
 *     AutoGen/FBX (0.22–0.25s), dừng đúng duration từng bước.
 *   • stop() / remove(i) / clear() / move(i, j)
 * Nguồn clip vẫn là clip thật (AutoGen, preset, FBX, M2M) — không giả lập.
 * ============================================================ */
(function () {
  'use strict';

  var bus = PixiStudio.bus;

  var Queue = {
    items: [],          // [{source, clipId, label, duration, loop, speed, url}]
    current: -1,
    playing: false,
    loopQueue: false,
    _timer: null,
    _startedAt: 0
  };

  Queue.add = function (item) {
    if (!item || !item.clipId) return false;
    item.duration = Math.max(0.3, parseFloat(item.duration) || 2);
    item.loop = !!item.loop;
    item.speed = Math.max(0.2, Math.min(3, parseFloat(item.speed) || 1));
    Queue.items.push(item);
    bus.emit('anim-queue:changed', { count: Queue.items.length });
    return true;
  };
  Queue.remove = function (i) {
    if (i < 0 || i >= Queue.items.length) return false;
    if (Queue.playing && i === Queue.current) Queue.stop();
    Queue.items.splice(i, 1);
    bus.emit('anim-queue:changed', { count: Queue.items.length });
    return true;
  };
  Queue.clear = function () { Queue.stop(); Queue.items = []; Queue.current = -1; bus.emit('anim-queue:changed', { count: 0 }); };
  Queue.move = function (i, j) {
    if (i < 0 || i >= Queue.items.length || j < 0 || j >= Queue.items.length) return false;
    var it = Queue.items.splice(i, 1)[0];
    Queue.items.splice(j, 0, it);
    bus.emit('anim-queue:changed', { count: Queue.items.length });
    return true;
  };
  Queue.totalDuration = function () {
    return Queue.items.reduce(function (s, it) { return s + it.duration / it.speed; }, 0);
  };

  /* Phát 1 item bằng đúng player của nguồn đó. Trả về true nếu phát được. */
  Queue.playItem = function (item) {
    if (!item) return false;
    var P = PixiStudio;
    if (item.source === 'autogen' && P.AnimAutoGen) { P.AnimAutoGen.play(item.clipId); return true; }
    if (item.source === 'preset' && P.Anim) { P.Anim.applyPreset(item.clipId); return true; }
    if (item.source === 'fbx' && P.FbxRig && P.FbxRig.loaded) { P.FbxRig.play(item.clipId); return true; }
    if (item.source === 'm2m' && P.M2MMotion && item.url) {
      P.M2MMotion.loop = !!item.loop;
      P.M2MMotion.play(item.url, item.label);
      return true;
    }
    return false;
  };

  Queue._scheduleNext = function () {
    if (!Queue.playing) return;
    var item = Queue.items[Queue.current];
    if (!item) { Queue.stop(); return; }
    var ms = (item.duration / item.speed) * 1000;
    Queue._startedAt = Date.now();
    Queue._timer = setTimeout(function () { Queue.next(); }, ms);
  };

  Queue.playAll = function (startIndex) {
    if (!Queue.items.length) {
      bus.emit('notify', { type: 'warning', title: 'Added queue trống', message: 'Add motion vào queue trước (nút Add ở Motion Library hoặc Prompt).' });
      return false;
    }
    Queue.stop();
    Queue.playing = true;
    Queue.current = Math.max(0, Math.min(startIndex || 0, Queue.items.length - 1));
    var item = Queue.items[Queue.current];
    if (!Queue.playItem(item)) {
      bus.emit('notify', { type: 'warning', title: 'Queue', message: 'Không phát được "' + item.label + '" — kiểm tra rig/clip nguồn.' });
      Queue.playing = false; Queue.current = -1;
      return false;
    }
    bus.emit('anim-queue:played', { index: Queue.current, label: item.label, total: Queue.items.length });
    Queue._scheduleNext();
    return true;
  };

  Queue.next = function () {
    if (!Queue.playing) return;
    Queue.current++;
    if (Queue.current >= Queue.items.length) {
      if (Queue.loopQueue) { Queue.current = 0; }
      else { Queue.stop(); bus.emit('anim-queue:finished', { total: Queue.items.length }); return; }
    }
    var item = Queue.items[Queue.current];
    if (!Queue.playItem(item)) { Queue.next(); return; }
    bus.emit('anim-queue:played', { index: Queue.current, label: item.label, total: Queue.items.length });
    Queue._scheduleNext();
  };

  Queue.stop = function () {
    if (Queue._timer) { clearTimeout(Queue._timer); Queue._timer = null; }
    if (Queue.playing) {
      Queue.playing = false;
      if (PixiStudio.Anim) PixiStudio.Anim.stop();
    }
    Queue.current = -1;
    bus.emit('anim-queue:stopped', {});
  };

  /* Thời gian còn lại của bước đang phát (giây) — cho UI progress */
  Queue.remaining = function () {
    if (!Queue.playing || Queue.current < 0) return 0;
    var item = Queue.items[Queue.current];
    var total = (item.duration / item.speed) * 1000;
    return Math.max(0, (total - (Date.now() - Queue._startedAt)) / 1000);
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.AnimQueue = Queue;
})();
