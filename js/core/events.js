/* ============================================================
 * core/events.js — EventBus toàn cục (publish/subscribe)
 * ============================================================ */
(function () {
  'use strict';

  function EventBus() {
    this._map = {};       // evt -> [fn,...]
    this._onceMap = {};   // evt -> index set (dùng flag fn.__once)
    this._any = [];       // lắng nghe mọi event (debug)
  }

  EventBus.prototype.on = function (evt, fn) {
    (this._map[evt] = this._map[evt] || []).push(fn);
    return fn; // trả fn để off tiện
  };

  EventBus.prototype.once = function (evt, fn) {
    const wrapped = function () {
      this.off(evt, wrapped);
      fn.apply(null, arguments);
    }.bind(this);
    wrapped.__orig = fn;
    (this._map[evt] = this._map[evt] || []).push(wrapped);
    return wrapped;
  };

  EventBus.prototype.off = function (evt, fn) {
    const list = this._map[evt];
    if (!list) return;
    const idx = list.indexOf(fn);
    if (idx !== -1) list.splice(idx, 1);
    if (!list.length) delete this._map[evt];
  };

  EventBus.prototype.emit = function (evt, data) {
    const list = this._map[evt];
    if (list) {
      // copy để listener có thể off trong khi emit
      const snapshot = list.slice();
      for (let i = 0; i < snapshot.length; i++) {
        try {
          snapshot[i](data, evt);
        } catch (err) {
          console.error('[EventBus] listener lỗi cho "' + evt + '":', err);
        }
      }
    }
    for (let j = 0; j < this._any.length; j++) {
      try { this._any[j](data, evt); } catch (err) { console.error('[EventBus] any-listener lỗi:', err); }
    }
  };

  EventBus.prototype.onAny = function (fn) { this._any.push(fn); return fn; };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.bus = new EventBus();
})();
