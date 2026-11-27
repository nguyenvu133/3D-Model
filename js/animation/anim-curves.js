/* ============================================================
 * animation/anim-curves.js — CURVE EDITOR NÂNG CAO
 * Nhóm A, vòng Mở rộng Hệ thống Animation.
 *
 * Editor đường cong cho keyframe: chọn 1 xương + 1 track
 * (position/rotation/scale, 1 trục), hiện đường cong theo thời
 * gian; mỗi đoạn key (key i → key i+1) có interpolation riêng:
 * linear, bezier (handle kéo được), ease-in, ease-out,
 * ease-in-out, step (giữ giá trị tới key sau).
 *
 * CÁCH ÁP DỤNG (trung thực với three r128): THREE.KeyframeTrack
 * KHÔNG lưu interpolation từng key — track chỉ là mảng times +
 * values nội suy tuyến tính (quaternion: slerp tuyến tính theo u).
 * Vì vậy "áp curve" = bake easing thành key dày hơn: mỗi đoạn
 * được lấy mẫu lại (mặc định 8 mẫu/đoạn) bằng hàm easing rồi ghi
 * thành clip MỚI; clip gốc không đổi. Vận tốc đầu/cuối của clip
 * mới đo được khác linear đúng như easing yêu cầu.
 *
 * TÍCH HỢP:
 *   • Animator: mở từ clip đang chọn (Animator.openCurveEditor /
 *     nút trong tab Animator) → áp xong đăng ký clip mới bằng
 *     Animator.registerClip.
 *   • Keyframe (arp-qr3-keyframe.js): fromKeyframeClip(kfClip)
 *     đổi clip key {t, pose:{bone:{x,y,z}}, hips} thành
 *     THREE.AnimationClip (quaternion track / xương + position
 *     track Hips) rồi chỉnh curve như clip thường.
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Bezier handle là handle 2D trong không gian (u, giá trị)
 *     của từng đoạn, mặc định (0.33, 0.33)/(0.67, 0.67) ≈ linear;
 *     kéo handle chỉ đổi easing của đoạn đó, không đổi giá trị key.
 *   • Step giữ giá trị key đầu tới sát key sau (mẫu tại u<1 lấy
 *     giá trị đầu, u=1 lấy giá trị sau).
 *   • Baked clip có nhiều key hơn gốc (subdiv × số đoạn) — dung
 *     lượng track tăng theo; subdiv mặc định 8 là đủ mượt cho
 *     preview + phát lại, không nên đặt > 16.
 * ============================================================ */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined' && window.PixiStudio) || {};
  var THREE_REF = (typeof window !== 'undefined' && window.THREE) || (typeof THREE !== 'undefined' ? THREE : null);

  var INTERPS = ['linear', 'bezier', 'ease-in', 'ease-out', 'ease-in-out', 'step'];
  var INTERP_LABELS = {
    linear: 'Linear', bezier: 'Bezier (handle kéo được)',
    'ease-in': 'Ease-in (chậm đầu)', 'ease-out': 'Ease-out (chậm cuối)',
    'ease-in-out': 'Ease-in-out (chậm 2 đầu)', step: 'Step (giữ giá trị)'
  };
  var DEFAULT_SUBDIV = 8;
  var EPS = 1e-6;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round4(v) { return Math.round(v * 10000) / 10000; }

  /* ---------- easing thuần (u: 0→1) ---------- */
  function easeIn(u) { return u * u; }
  function easeOut(u) { return 1 - (1 - u) * (1 - u); }
  function easeInOut(u) {
    return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  }
  /* Bezier cubic 1D: handle (x1,y1),(x2,y2) trong [0,1]²; giải x(t)=u
     bằng Newton + bisection fallback, trả y(t). */
  function cubicBezierY(u, h) {
    var x1 = clamp(h && h.x1 !== undefined ? h.x1 : 0.33, 0, 1);
    var y1 = clamp(h && h.y1 !== undefined ? h.y1 : 0.33, 0, 1);
    var x2 = clamp(h && h.x2 !== undefined ? h.x2 : 0.67, 0, 1);
    var y2 = clamp(h && h.y2 !== undefined ? h.y2 : 0.67, 0, 1);
    function bx(t) {
      var mt = 1 - t;
      return 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t;
    }
    function by(t) {
      var mt = 1 - t;
      return 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t;
    }
    function bxd(t) {
      var mt = 1 - t;
      return 3 * mt * mt * (x1 - 0) + 6 * mt * t * (x2 - x1) + 3 * t * t * (1 - x2);
    }
    var t = clamp(u, 0, 1);
    for (var i = 0; i < 8; i++) {
      var x = bx(t) - u;
      if (Math.abs(x) < 1e-6) break;
      var d = bxd(t);
      if (Math.abs(d) < 1e-6) break;
      t = clamp(t - x / d, 0, 1);
    }
    if (Math.abs(bx(t) - u) > 1e-3) {
      var lo = 0, hi = 1;
      for (var j = 0; j < 20; j++) {
        var mid = (lo + hi) / 2;
        if (bx(mid) < u) lo = mid; else hi = mid;
      }
      t = (lo + hi) / 2;
    }
    return clamp(by(t), 0, 1);
  }

  /* Áp interpolation của 1 đoạn lên u tuyến tính. */
  function applyInterp(interp, u, handles) {
    u = clamp(u, 0, 1);
    if (interp === 'ease-in') return easeIn(u);
    if (interp === 'ease-out') return easeOut(u);
    if (interp === 'ease-in-out') return easeInOut(u);
    if (interp === 'bezier') return cubicBezierY(u, handles);
    if (interp === 'step') return u >= 1 ? 1 : 0;
    return u; /* linear + fallback */
  }

  /* ---------- lấy mẫu track với easing từng đoạn ---------- */
  function trackSize(track) {
    if (track.getValueSize) return track.getValueSize();
    return /\.quaternion$/i.test(track.name || '') ? 4 : 3;
  }
  function isQuatTrack(t) { return /\.quaternion$/i.test(t.name || ''); }

  function sampleVecTrack(track, t, interpForSeg) {
    var times = track.times, vals = track.values, n = times.length;
    function at(i) { return { x: vals[i * 3], y: vals[i * 3 + 1], z: vals[i * 3 + 2] }; }
    if (!n) return { x: 0, y: 0, z: 0 };
    if (t <= times[0] || n === 1) return at(0);
    if (t >= times[n - 1]) return at(n - 1);
    for (var i = 0; i < n - 1; i++) {
      if (t >= times[i] && t <= times[i + 1]) {
        var span = times[i + 1] - times[i];
        var u = span > EPS ? (t - times[i]) / span : 0;
        var e = interpForSeg ? interpForSeg(i, u) : u;
        var va = at(i), vb = at(i + 1);
        return { x: va.x + (vb.x - va.x) * e, y: va.y + (vb.y - va.y) * e, z: va.z + (vb.z - va.z) * e };
      }
    }
    return at(0);
  }

  function sampleQuatTrack(track, t, interpForSeg) {
    var T = THREE_REF;
    var times = track.times, vals = track.values, n = times.length;
    function at(i) {
      return T ? new T.Quaternion(vals[i * 4], vals[i * 4 + 1], vals[i * 4 + 2], vals[i * 4 + 3])
        : { x: vals[i * 4], y: vals[i * 4 + 1], z: vals[i * 4 + 2], w: vals[i * 4 + 3] };
    }
    if (!n) return at(0);
    if (t <= times[0] || n === 1) return at(0);
    if (t >= times[n - 1]) return at(n - 1);
    for (var i = 0; i < n - 1; i++) {
      if (t >= times[i] && t <= times[i + 1]) {
        var span = times[i + 1] - times[i];
        var u = span > EPS ? (t - times[i]) / span : 0;
        var e = interpForSeg ? interpForSeg(i, u) : u;
        var qa = at(i), qb = at(i + 1);
        return (T && qa.slerp) ? qa.slerp(qb, e) : qa;
      }
    }
    return at(0);
  }

  /* Giá trị 1 trục của track tại t (dùng cho preview canvas). */
  function sampleTrackAxis(track, t, axis, interpForSeg) {
    var size = trackSize(track);
    var idx = { x: 0, y: 1, z: 2, w: 3 }[axis];
    if (idx === undefined || idx >= size) return 0;
    if (isQuatTrack(track)) {
      var q = sampleQuatTrack(track, t, interpForSeg);
      return idx === 0 ? q.x : idx === 1 ? q.y : idx === 2 ? q.z : q.w;
    }
    var v = sampleVecTrack(track, t, interpForSeg);
    return idx === 0 ? v.x : idx === 1 ? v.y : v.z;
  }

  /* ---------- trạng thái edit ---------- */
  function createEdit(clip) {
    if (!clip || !clip.tracks) return { ok: false, error: 'Clip không có tracks.' };
    return {
      ok: true,
      clip: clip,
      interps: {}, /* trackName -> {segIdx: interp} */
      handles: {}  /* trackName -> {segIdx: {x1,y1,x2,y2}} */
    };
  }
  function getKeyInterp(edit, trackName, segIdx) {
    var m = edit && edit.interps && edit.interps[trackName];
    return (m && m[segIdx]) || 'linear';
  }
  function setKeyInterp(edit, trackName, segIdx, interp) {
    if (!edit || !edit.interps) return { ok: false, error: 'Edit chưa tạo (createEdit trước).' };
    if (INTERPS.indexOf(interp) < 0) return { ok: false, error: 'Interpolation không biết: ' + interp };
    if (!edit.interps[trackName]) edit.interps[trackName] = {};
    edit.interps[trackName][segIdx] = interp;
    return { ok: true, track: trackName, segment: segIdx, interp: interp };
  }
  function getKeyHandles(edit, trackName, segIdx) {
    var m = edit && edit.handles && edit.handles[trackName];
    return (m && m[segIdx]) || { x1: 0.33, y1: 0.33, x2: 0.67, y2: 0.67 };
  }
  function setKeyHandles(edit, trackName, segIdx, handles) {
    if (!edit || !edit.handles) return { ok: false, error: 'Edit chưa tạo (createEdit trước).' };
    if (!edit.handles[trackName]) edit.handles[trackName] = {};
    edit.handles[trackName][segIdx] = {
      x1: clamp(parseFloat(handles.x1) || 0.33, 0, 1),
      y1: clamp(parseFloat(handles.y1) || 0.33, 0, 1),
      x2: clamp(parseFloat(handles.x2) || 0.67, 0, 1),
      y2: clamp(parseFloat(handles.y2) || 0.67, 0, 1)
    };
    return { ok: true, track: trackName, segment: segIdx, handles: edit.handles[trackName][segIdx] };
  }
  function interpForSegFn(edit, trackName) {
    return function (segIdx, u) {
      return applyInterp(getKeyInterp(edit, trackName, segIdx), u,
        getKeyHandles(edit, trackName, segIdx));
    };
  }

  /* Điểm vẽ preview: [{t, v}] — v là giá trị 1 trục. */
  function curvePoints(edit, trackName, axis, samples) {
    var clip = edit && edit.clip;
    if (!clip) return [];
    var track = null;
    clip.tracks.forEach(function (tr) { if (tr.name === trackName) track = tr; });
    if (!track || !(clip.duration > 0)) return [];
    samples = samples || 64;
    var fn = interpForSegFn(edit, trackName);
    var out = [];
    for (var i = 0; i <= samples; i++) {
      var t = clip.duration * i / samples;
      out.push({ t: round4(t), v: round4(sampleTrackAxis(track, t, axis, fn)) });
    }
    return out;
  }

  /* Áp edit thành clip MỚI (bake easing bằng lấy mẫu dày). Clip gốc
     không đổi: times/values gốc được copy, không sửa tại chỗ. */
  function applyEdit(edit, opts) {
    opts = opts || {};
    var T = THREE_REF;
    if (!T) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    if (!edit || !edit.clip) return { ok: false, error: 'Edit chưa tạo (createEdit trước).' };
    var subdiv = clamp(Math.round(opts.subdiv || DEFAULT_SUBDIV), 1, 16);
    var clip = edit.clip;
    var changedTracks = 0, inserted = 0;
    var tracks = clip.tracks.map(function (tr) {
      var fn = interpForSegFn(edit, tr.name);
      var hasCustom = !!(edit.interps && edit.interps[tr.name] &&
        Object.keys(edit.interps[tr.name]).some(function (k) { return edit.interps[tr.name][k] !== 'linear'; }));
      if (!hasCustom) {
        /* Track không đổi easing: clone y hệt (không đụng gốc). */
        if (isQuatTrack(tr)) return new T.QuaternionKeyframeTrack(tr.name, Array.prototype.slice.call(tr.times), Array.prototype.slice.call(tr.values));
        return new T.VectorKeyframeTrack(tr.name, Array.prototype.slice.call(tr.times), Array.prototype.slice.call(tr.values));
      }
      changedTracks++;
      var size = trackSize(tr);
      var times = [], values = [];
      var n = tr.times.length;
      for (var i = 0; i < n - 1; i++) {
        for (var s = 0; s < subdiv; s++) {
          var u = s / subdiv;
          var t = tr.times[i] + (tr.times[i + 1] - tr.times[i]) * u;
          times.push(round4(t));
          if (isQuatTrack(tr)) {
            var q = sampleQuatTrack(tr, t, fn);
            values.push(round4(q.x), round4(q.y), round4(q.z), round4(q.w));
          } else {
            var v = sampleVecTrack(tr, t, fn);
            values.push(round4(v.x), round4(v.y), round4(v.z));
          }
          inserted++;
        }
      }
      /* Key cuối giữ nguyên. */
      times.push(round4(tr.times[n - 1]));
      for (var k = 0; k < size; k++) values.push(tr.values[(n - 1) * size + k]);
      if (isQuatTrack(tr)) return new T.QuaternionKeyframeTrack(tr.name, times, values);
      return new T.VectorKeyframeTrack(tr.name, times, values);
    });
    var out = new T.AnimationClip((clip.name || 'clip') + '_curve', clip.duration, tracks);
    return { ok: true, clip: out, duration: round4(clip.duration), trackCount: tracks.length,
      changedTracks: changedTracks, insertedKeys: inserted, subdiv: subdiv,
      note: 'Bake easing thành key dày (' + subdiv + ' mẫu/đoạn); clip gốc không đổi.' };
  }

  /* ---------- Keyframe module → THREE clip ---------- */
  function stripBoneName(full) {
    var s = String(full || '').trim();
    s = s.replace(/^(model:{1,2})+/i, '').replace(/^mixamorig:?/i, '');
    s = s.replace(/\.(quaternion|position|scale)$/i, '');
    return s;
  }
  /* kfClip: {name, duration, fps, keys:[{t, pose:{bone:{x,y,z} Euler},
     hips:{x,y,z}}]} → THREE.AnimationClip (quaternion/xương + Hips.position). */
  function fromKeyframeClip(kfClip) {
    var T = THREE_REF;
    if (!T) return { ok: false, error: 'THREE chưa sẵn sàng.' };
    if (!kfClip || !Array.isArray(kfClip.keys) || !kfClip.keys.length) {
      return { ok: false, error: 'Clip keyframe rỗng (không có keys).' };
    }
    var keys = kfClip.keys.slice().sort(function (a, b) { return a.t - b.t; });
    var times = keys.map(function (k) { return k.t; });
    var bones = {};
    keys.forEach(function (k) {
      Object.keys(k.pose || {}).forEach(function (b) { bones[b] = true; });
    });
    var tracks = [];
    Object.keys(bones).forEach(function (bone) {
      var values = [];
      keys.forEach(function (k) {
        var e = (k.pose && k.pose[bone]) || { x: 0, y: 0, z: 0 };
        var q = new T.Quaternion().setFromEuler(new T.Euler(e.x || 0, e.y || 0, e.z || 0));
        values.push(round4(q.x), round4(q.y), round4(q.z), round4(q.w));
      });
      tracks.push(new T.QuaternionKeyframeTrack(bone + '.quaternion', times.slice(), values));
    });
    if (keys[0].hips) {
      var hv = [];
      keys.forEach(function (k) {
        hv.push(round4(k.hips.x || 0), round4(k.hips.y || 0), round4(k.hips.z || 0));
      });
      tracks.push(new T.VectorKeyframeTrack('Hips.position', times.slice(), hv));
    }
    var dur = kfClip.duration || times[times.length - 1] || 0;
    var out = new T.AnimationClip(kfClip.name || 'keyframe', Math.max(dur, 0.001), tracks);
    return { ok: true, clip: out, duration: round4(dur), trackCount: tracks.length, keyCount: keys.length };
  }

  /* ---------- vẽ preview lên canvas ---------- */
  function drawCurve(canvas, points, opts) {
    opts = opts || {};
    if (!canvas || typeof canvas.getContext !== 'function') return { ok: false, error: 'Không có canvas.' };
    var ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, error: 'Canvas 2d context không có.' };
    var W = canvas.width || 320, H = canvas.height || 140;
    ctx.clearRect(0, 0, W, H);
    if (!points || !points.length) return { ok: true, drawn: 0 };
    var vs = points.map(function (p) { return p.v; });
    var vMin = Math.min.apply(null, vs), vMax = Math.max.apply(null, vs);
    if (vMax - vMin < 1e-6) { vMax = vMin + 1; }
    var tMax = points[points.length - 1].t || 1;
    function X(t) { return 8 + (t / (tMax || 1)) * (W - 16); }
    function Y(v) { return H - 8 - ((v - vMin) / (vMax - vMin)) * (H - 16); }
    try {
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(8, H - 8); ctx.lineTo(W - 8, H - 8); ctx.stroke();
      ctx.strokeStyle = '#0aa'; ctx.lineWidth = 2; ctx.beginPath();
      points.forEach(function (p, i) { if (i === 0) ctx.moveTo(X(p.t), Y(p.v)); else ctx.lineTo(X(p.t), Y(p.v)); });
      ctx.stroke();
      (opts.keys || []).forEach(function (k) {
        ctx.fillStyle = '#f80';
        ctx.beginPath(); ctx.arc(X(k.t), Y(k.v), 4, 0, Math.PI * 2); ctx.fill();
      });
      /* Handle bezier của đoạn đang chọn (nếu có): vẽ 2 điểm handle. */
      (opts.handles || []).forEach(function (h) {
        ctx.fillStyle = '#08f';
        ctx.beginPath(); ctx.arc(X(h.t), Y(h.v), 3, 0, Math.PI * 2); ctx.fill();
      });
    } catch (e) { return { ok: false, error: 'Vẽ canvas lỗi: ' + (e && e.message) }; }
    return { ok: true, drawn: points.length, vMin: round4(vMin), vMax: round4(vMax) };
  }

  /* ---------- UI editor (mở từ tab Animator / từ key đã ghi) ---------- */
  function openEditor(container, opts) {
    opts = opts || {};
    var clip = opts.clip || null;
    if (!clip) return { ok: false, error: 'Chưa có clip để mở Curve Editor.' };
    var editR = createEdit(clip);
    if (!editR.ok) return editR;
    var edit = editR;
    if (typeof document === 'undefined') return { ok: false, error: 'Không có document.' };
    container.innerHTML = '';
    function mk(tag, attrs, text) {
      var n = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else n.setAttribute(k, attrs[k]);
      });
      if (text !== undefined) n.textContent = text;
      return n;
    }
    var state = { trackName: opts.trackName || (clip.tracks[0] && clip.tracks[0].name) || '',
      axis: opts.axis || 'x', seg: 0 };
    var boneSel = mk('select', { class: 'arp-select' });
    var axisSel = mk('select', { class: 'arp-select' });
    ['x', 'y', 'z', 'w'].forEach(function (a) {
      var o = mk('option', { value: a }, a.toUpperCase());
      if (a === state.axis) o.selected = true;
      axisSel.appendChild(o);
    });
    function refreshBoneSel() {
      boneSel.innerHTML = '';
      clip.tracks.forEach(function (tr) {
        var o = mk('option', { value: tr.name }, tr.name + ' (' + tr.times.length + ' keys)');
        if (tr.name === state.trackName) o.selected = true;
        boneSel.appendChild(o);
      });
    }
    refreshBoneSel();
    var canvas = mk('canvas', { class: 'arp-curve-canvas' });
    canvas.width = 320; canvas.height = 140;
    canvas.style.width = '100%';
    canvas.style.border = '1px solid #555';
    var interpSel = mk('select', { class: 'arp-select' });
    INTERPS.forEach(function (ip) {
      interpSel.appendChild(mk('option', { value: ip }, INTERP_LABELS[ip]));
    });
    var segLabel = mk('div', { class: 'arp-note' });
    var handleBox = mk('div', { class: 'arp-row' });
    var hInputs = {};
    [['x1', 'Handle 1 x'], ['y1', 'Handle 1 y'], ['x2', 'Handle 2 x'], ['y2', 'Handle 2 y']].forEach(function (pair) {
      var inp = mk('input', { type: 'number', class: 'arp-input', min: '0', max: '1', step: '0.05', value: '0.33' });
      inp.style.width = '56px';
      inp.title = pair[1];
      inp.addEventListener('input', function () {
        var h = getKeyHandles(edit, state.trackName, state.seg);
        h[pair[0]] = clamp(parseFloat(inp.value) || 0, 0, 1);
        setKeyHandles(edit, state.trackName, state.seg, h);
        redraw();
      });
      hInputs[pair[0]] = inp;
      handleBox.appendChild(inp);
    });
    function currentTrack() {
      var t = null;
      clip.tracks.forEach(function (tr) { if (tr.name === state.trackName) t = tr; });
      return t;
    }
    function redraw() {
      var tr = currentTrack();
      if (!tr) return;
      var pts = curvePoints(edit, state.trackName, state.axis, 64);
      var keys = [];
      for (var i = 0; i < tr.times.length; i++) {
        keys.push({ t: tr.times[i], v: sampleTrackAxis(tr, tr.times[i], state.axis, interpForSegFn(edit, state.trackName)) });
      }
      drawCurve(canvas, pts, { keys: keys });
      var nSeg = Math.max(0, tr.times.length - 1);
      state.seg = clamp(state.seg, 0, Math.max(0, nSeg - 1));
      segLabel.textContent = 'Đoạn ' + (state.seg + 1) + '/' + nSeg + ': key ' +
        tr.times[state.seg].toFixed(2) + 's → ' + tr.times[state.seg + 1].toFixed(2) + 's · interp: ' +
        getKeyInterp(edit, state.trackName, state.seg);
      interpSel.value = getKeyInterp(edit, state.trackName, state.seg);
      var h = getKeyHandles(edit, state.trackName, state.seg);
      hInputs.x1.value = h.x1; hInputs.y1.value = h.y1; hInputs.x2.value = h.x2; hInputs.y2.value = h.y2;
      handleBox.style.display = interpSel.value === 'bezier' ? '' : 'none';
    }
    boneSel.addEventListener('change', function () { state.trackName = boneSel.value; state.seg = 0; redraw(); });
    axisSel.addEventListener('change', function () { state.axis = axisSel.value; redraw(); });
    interpSel.addEventListener('change', function () {
      setKeyInterp(edit, state.trackName, state.seg, interpSel.value);
      redraw();
    });
    var prevSeg = mk('button', { class: 'arp-btn arp-btn-sm' }, '◀ Đoạn trước');
    prevSeg.addEventListener('click', function () { state.seg = Math.max(0, state.seg - 1); redraw(); });
    var nextSeg = mk('button', { class: 'arp-btn arp-btn-sm' }, 'Đoạn sau ▶');
    nextSeg.addEventListener('click', function () {
      var tr = currentTrack();
      state.seg = Math.min(Math.max(0, (tr ? tr.times.length : 2) - 2), state.seg + 1);
      redraw();
    });
    var applyBtn = mk('button', { class: 'arp-btn arp-btn-primary' }, 'Áp dụng → lưu clip mới');
    applyBtn.addEventListener('click', function () {
      var r = applyEdit(edit, { subdiv: 8 });
      if (!r.ok) { if (opts.onError) opts.onError(r.error); return; }
      if (opts.onApply) opts.onApply(r);
    });
    var row1 = mk('div', { class: 'arp-row' });
    row1.appendChild(boneSel); row1.appendChild(axisSel);
    var row2 = mk('div', { class: 'arp-row' });
    row2.appendChild(prevSeg); row2.appendChild(interpSel); row2.appendChild(nextSeg);
    container.appendChild(mk('div', { class: 'arp-sec-title' }, 'Curve Editor — ' + (clip.name || 'clip')));
    container.appendChild(row1);
    container.appendChild(canvas);
    container.appendChild(segLabel);
    container.appendChild(row2);
    container.appendChild(handleBox);
    container.appendChild(applyBtn);
    container.appendChild(mk('div', { class: 'arp-note' },
      'Bezier: kéo handle bằng 4 ô số (x1/y1/x2/y2). Áp dụng sẽ bake easing thành clip mới, clip gốc không đổi.'));
    redraw();
    return { ok: true, edit: edit, redraw: redraw };
  }

  var AnimCurves = {
    INTERPS: INTERPS,
    INTERP_LABELS: INTERP_LABELS,
    DEFAULT_SUBDIV: DEFAULT_SUBDIV,
    easeIn: easeIn,
    easeOut: easeOut,
    easeInOut: easeInOut,
    cubicBezierY: cubicBezierY,
    applyInterp: applyInterp,
    sampleVecTrack: sampleVecTrack,
    sampleQuatTrack: sampleQuatTrack,
    sampleTrackAxis: sampleTrackAxis,
    createEdit: createEdit,
    getKeyInterp: getKeyInterp,
    setKeyInterp: setKeyInterp,
    getKeyHandles: getKeyHandles,
    setKeyHandles: setKeyHandles,
    curvePoints: curvePoints,
    applyEdit: applyEdit,
    fromKeyframeClip: fromKeyframeClip,
    drawCurve: drawCurve,
    openEditor: openEditor
  };

  PS.AnimCurves = AnimCurves;
})();
