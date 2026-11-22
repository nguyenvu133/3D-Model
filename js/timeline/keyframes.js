/* ============================================================
 * timeline/keyframes.js — Track & keyframe store THẬT:
 * Position/Rotation/Scale/Bone/Facial/Camera, interpolation,
 * apply transform theo frame, copy/paste, serialize.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const TRACK_COLORS = {
    position: '#27BFFF',
    rotation: '#42DF75',
    scale: '#FFC928',
    bone: '#c44dff',
    facial: '#ff7ab8',
    camera: '#ffffff'
  };

  const Keyframes = {
    tracks: [],            // {id, objectId, targetName, channel, keys:[{frame,value}]}
    selectedKey: null,     // {trackId, index}
    clipboard: null,
    counter: 0
  };

  /* ---------- TRACKS ---------- */
  Keyframes.createTrack = function (object3D, channel) {
    /* 1 track/channel/object */
    const existing = Keyframes.tracks.find(function (t) {
      return t.objectId === object3D.uuid && t.channel === channel;
    });
    if (existing) return existing;
    const track = {
      id: 'track-' + (++Keyframes.counter),
      objectId: object3D.uuid,
      targetName: object3D.name || 'Object',
      channel: channel,
      visible: true,
      keys: []
    };
    Keyframes.tracks.push(track);
    bus.emit('timeline:track', { trackId: track.id, channel: channel, targetName: track.targetName });
    return track;
  };

  Keyframes.removeTrack = function (trackId) {
    Keyframes.tracks = Keyframes.tracks.filter(function (t) { return t.id !== trackId; });
    bus.emit('timeline:tracks-changed', {});
  };

  /* ---------- KEYFRAME CRUD ---------- */
  Keyframes.addKey = function (channel, object3D, frame) {
    const obj = object3D || PixiStudio.State.get('selection');
    if (!obj) {
      bus.emit('notify', { type: 'warning', title: 'Add Keyframe', message: 'Chưa chọn object nào. Click model trong viewport trước.' });
      return null;
    }
    const f = frame === undefined ? PixiStudio.Playback.frame : frame;
    const track = Keyframes.createTrack(obj, channel);

    /* value hiện tại theo channel */
    let value;
    if (channel === 'position') value = [obj.position.x, obj.position.y, obj.position.z];
    else if (channel === 'rotation') value = [obj.rotation.x, obj.rotation.y, obj.rotation.z];
    else if (channel === 'scale') value = [obj.scale.x, obj.scale.y, obj.scale.z];
    else value = [0, 0, 0];

    /* thay keyframe cùng frame nếu có */
    const existingIdx = track.keys.findIndex(function (k) { return k.frame === f; });
    if (existingIdx !== -1) {
      track.keys[existingIdx].value = value;
    } else {
      track.keys.push({ frame: f, value: value });
      track.keys.sort(function (a, b) { return a.frame - b.frame; });
    }

    bus.emit('timeline:key', { trackId: track.id, frame: f, channel: channel });
    bus.emit('timeline:tracks-changed', {});
    return { trackId: track.id, frame: f };
  };

  Keyframes.deleteSelected = function () {
    if (!Keyframes.selectedKey) return false;
    const track = Keyframes.tracks.find(function (t) { return t.id === Keyframes.selectedKey.trackId; });
    if (!track) return false;
    track.keys.splice(Keyframes.selectedKey.index, 1);
    if (!track.keys.length) Keyframes.removeTrack(track.id);
    Keyframes.selectedKey = null;
    bus.emit('timeline:tracks-changed', {});
    return true;
  };

  Keyframes.copySelected = function () {
    if (!Keyframes.selectedKey) return false;
    const track = Keyframes.tracks.find(function (t) { return t.id === Keyframes.selectedKey.trackId; });
    if (!track) return false;
    Keyframes.clipboard = {
      channel: track.channel,
      value: track.keys[Keyframes.selectedKey.index].value.slice(),
      frame: track.keys[Keyframes.selectedKey.index].frame
    };
    bus.emit('notify', { type: 'info', title: 'Keyframe copied', message: track.channel + ' @ frame ' + Keyframes.clipboard.frame });
    return true;
  };

  Keyframes.paste = function (object3D) {
    if (!Keyframes.clipboard) {
      bus.emit('notify', { type: 'warning', title: 'Paste', message: 'Clipboard trống — copy keyframe trước.' });
      return false;
    }
    const obj = object3D || PixiStudio.State.get('selection');
    if (!obj) return false;
    const track = Keyframes.createTrack(obj, Keyframes.clipboard.channel);
    const f = PixiStudio.Playback.frame;
    const existingIdx = track.keys.findIndex(function (k) { return k.frame === f; });
    if (existingIdx !== -1) track.keys[existingIdx].value = Keyframes.clipboard.value.slice();
    else {
      track.keys.push({ frame: f, value: Keyframes.clipboard.value.slice() });
      track.keys.sort(function (a, b) { return a.frame - b.frame; });
    }
    bus.emit('timeline:tracks-changed', {});
    return true;
  };

  Keyframes.moveKey = function (trackId, index, newFrame) {
    const track = Keyframes.tracks.find(function (t) { return t.id === trackId; });
    if (!track || !track.keys[index]) return;
    const total = PixiStudio.State.get('totalFrames');
    newFrame = U.clamp(Math.round(newFrame), 0, total);
    track.keys[index].frame = newFrame;
    track.keys.sort(function (a, b) { return a.frame - b.frame; });
    bus.emit('timeline:tracks-changed', {});
  };

  /* ---------- INTERPOLATION + APPLY (THẬT) ---------- */
  Keyframes.sampleValue = function (track, frame) {
    if (!track.keys.length) return null;
    const keys = track.keys;
    if (frame <= keys[0].frame) return keys[0].value;
    if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (frame >= a.frame && frame <= b.frame) {
        const t = (b.frame === a.frame) ? 0 : (frame - a.frame) / (b.frame - a.frame);
        /* smoothstep cho mượt */
        const s = t * t * (3 - 2 * t);
        return [
          U.lerp(a.value[0], b.value[0], s),
          U.lerp(a.value[1], b.value[1], s),
          U.lerp(a.value[2], b.value[2], s)
        ];
      }
    }
    return keys[0].value;
  };

  Keyframes.applyAtFrame = function (frame) {
    const objects = {};
    Keyframes.tracks.forEach(function (track) {
      if (!track.visible) return;
      if (!objects[track.objectId]) {
        /* tìm object theo uuid */
        let found = null;
        if (PixiStudio.Scene && PixiStudio.Scene.registry[track.objectId]) {
          found = PixiStudio.Scene.registry[track.objectId].object3D;
        } else {
          /* tìm trong model root */
          PixiStudio.Viewport.modelRoot.traverse(function (o) {
            if (!found && o.uuid === track.objectId) found = o;
          });
        }
        objects[track.objectId] = found;
      }
      const obj = objects[track.objectId];
      if (!obj) return;
      const value = Keyframes.sampleValue(track, frame);
      if (!value) return;
      if (track.channel === 'position') obj.position.set(value[0], value[1], value[2]);
      else if (track.channel === 'rotation') obj.rotation.set(value[0], value[1], value[2]);
      else if (track.channel === 'scale') obj.scale.set(value[0], value[1], value[2]);
    });
  };

  /* ---------- CLEAR ---------- */
  Keyframes.clearAll = function () {
    Keyframes.tracks = [];
    Keyframes.selectedKey = null;
    bus.emit('timeline:tracks-changed', {});
  };

  /* ---------- SERIALIZATION ---------- */
  Keyframes.serialize = function () {
    return {
      tracks: Keyframes.tracks.map(function (t) {
        return { objectId: t.objectId, targetName: t.targetName, channel: t.channel, keys: t.keys };
      })
    };
  };

  Keyframes.deserialize = function (data) {
    if (!data || !data.tracks) return;
    Keyframes.tracks = data.tracks.map(function (t, i) {
      return { id: 'track-' + (++Keyframes.counter), objectId: t.objectId, targetName: t.targetName, channel: t.channel, visible: true, keys: t.keys || [] };
    });
    bus.emit('timeline:tracks-changed', {});
  };

  window.PixiStudio.Timeline = window.PixiStudio.Timeline || {};
  window.PixiStudio.Timeline.keys = Keyframes;
  window.PixiStudio.Timeline.TRACK_COLORS = TRACK_COLORS;
})();
