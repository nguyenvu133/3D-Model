/* ============================================================
 * rig/arp-anim-compression.js — NÉN ANIMATION CLIP (nhóm D)
 *
 * Nén clip animation trước khi xuất JSON:
 *   (a) loại keyframe thừa — bỏ key mà giá trị nội suy từ 2 key
 *       kề lệch dưới ngưỡng (position ~1mm, rotation ~0.1°,
 *       scale ~0.001); key đầu/cuối LUÔN giữ;
 *   (b) quantize — quaternion qua float16 (round-trip thật, rồi
 *       chuẩn hoá lại độ dài 1), position làm tròn theo mm,
 *       scale làm tròn 0.001, times làm tròn theo ms;
 *   (c) xuất dạng rút gọn — file JSON giữ nguyên format v1
 *       ('pixistudio-animator-clips-1' / 'pixistudio-arp-keyframe-
 *       clips-1') + cờ `compressed:true` + khối `compression`
 *       (keys/bytes trước-sau, % tiết kiệm, độ lệch tối đa) nên
 *       file cũ (không nén) và file mới đều đọc được bằng
 *       importClip / parseExportJSON cũ — không cần giải nén
 *       (giá trị đã lưu là số thường, chỉ mất độ chính xác thừa).
 *
 * MẶC ĐỊNH: UI Animator bật nén (checkbox mặc định checked);
 * API export giữ mặc định TẮT (opts.compress !== true) để code cũ
 * / harness cũ vẫn ra file v1 byte-identical khi không truyền gì
 * — muốn nén qua API thì truyền {compress:true} hoặc bật
 * Compression.setSettings({enabled:true}) rồi gọi export với
 * opts.compress undefined... (xem getEffectiveOpts: API chỉ bật
 * khi opts.compress === true; UI luôn truyền rõ true/false).
 * Ngưỡng an toàn mặc định: pos 1mm / rot 0.1° / scale 0.001.
 * Đo trên clip thật (harness test-anim-compression.js): Thiếu Lâm
 * Run/Attack — độ lệch tối đa < 2mm / < 0.5° ở ngưỡng mặc định.
 *
 * KHÔNG sửa writer FBX: nén chỉ áp cho export JSON. File FBX xuất
 * ra vẫn dùng clip gốc (FBXBinary.write không biết nén).
 * ============================================================ */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined' && window.PixiStudio) || {};
  var bus = (PS && PS.bus) || { emit: function () {}, on: function () {} };
  var STORE_KEY = 'arp-anim-compression-v1';

  var DEFAULTS = {
    enabled: true,          /* UI mặc định bật; API export mặc định tắt (xem trên) */
    posEps: 0.001,          /* m — 1mm */
    rotEpsDeg: 0.1,         /* độ */
    scaleEps: 0.001,
    quantize: true,         /* float16 quaternion + mm position */
    sampleRate: 60          /* Hz — lưới mẫu khi đo độ lệch */
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function roundTo(v, step) { return Math.round(v / step) * step; }
  function isQuatName(n) { return /\.quaternion$/i.test(n || ''); }
  function isPosName(n) { return /\.position$/i.test(n || ''); }
  function isScaleName(n) { return /\.scale$/i.test(n || ''); }
  function trackSize(name) { return isQuatName(name) ? 4 : 3; }

  /* ---------- float16 round-trip (bit math, không cần DataView.getFloat16) ---------- */
  function floatToHalfBits(f) {
    var buf = new ArrayBuffer(4);
    var f32 = new Float32Array(buf);
    var u32 = new Uint32Array(buf);
    f32[0] = f;
    var x = u32[0];
    var sign = (x >> 16) & 0x8000;
    var exp = ((x >> 23) & 0xff) - 112;   /* 127-15 */
    var mant = x & 0x7fffff;
    if (exp <= 0) {
      if (exp < -10) return sign;
      mant |= 0x800000;
      var shift = 14 - exp;
      var h = (mant >> shift) & 0xffff;
      if ((mant >> (shift - 1)) & 1) h += 1;   /* round-to-nearest */
      return sign | h;
    }
    if (exp >= 31) return sign | 0x7c00;       /* Inf */
    return sign | (exp << 10) | (mant >> 13);
  }
  function halfBitsToFloat(h) {
    var sign = (h & 0x8000) ? -1 : 1;
    var exp = (h >> 10) & 0x1f;
    var mant = h & 0x3ff;
    if (exp === 0) return sign * mant * Math.pow(2, -24);
    if (exp === 31) return mant ? NaN : sign * Infinity;
    return sign * (1 + mant / 1024) * Math.pow(2, exp - 15);
  }
  function quantizeHalf(v) { return halfBitsToFloat(floatToHalfBits(v)); }

  /* ---------- settings (localStorage, có guard) ---------- */
  var _settings = null;
  function getSettings() {
    if (_settings) return Object.assign({}, _settings);
    var s = Object.assign({}, DEFAULTS);
    try {
      var raw = (typeof localStorage !== 'undefined') && localStorage.getItem(STORE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        Object.keys(DEFAULTS).forEach(function (k) {
          if (saved[k] !== undefined) s[k] = saved[k];
        });
      }
    } catch (e) {}
    _settings = s;
    return Object.assign({}, s);
  }
  function setSettings(patch) {
    var s = getSettings();
    if (patch) Object.keys(patch).forEach(function (k) {
      if (k in DEFAULTS) s[k] = patch[k];
    });
    /* chặn ngưỡng vô lý: pos > 1cm hoặc rot > 2° thì méo thấy rõ */
    s.posEps = clamp(+s.posEps || DEFAULTS.posEps, 0.0001, 0.01);
    s.rotEpsDeg = clamp(+s.rotEpsDeg || DEFAULTS.rotEpsDeg, 0.01, 2);
    s.scaleEps = clamp(+s.scaleEps || DEFAULTS.scaleEps, 0.0001, 0.01);
    _settings = s;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch (e) {}
    return Object.assign({}, s);
  }
  function optsFrom(o) {
    var s = getSettings();
    o = o || {};
    return {
      posEps: (o.posEps !== undefined) ? o.posEps : (o.posEpsMm !== undefined ? o.posEpsMm / 1000 : s.posEps),
      rotEpsDeg: (o.rotEpsDeg !== undefined) ? o.rotEpsDeg : s.rotEpsDeg,
      scaleEps: (o.scaleEps !== undefined) ? o.scaleEps : s.scaleEps,
      quantize: (o.quantize !== undefined) ? !!o.quantize : !!s.quantize,
      sampleRate: (o.sampleRate !== undefined) ? o.sampleRate : s.sampleRate
    };
  }

  /* ---------- sampling 1 track tại thời gian t ---------- */
  function sampleTrack(track, t) {
    var times = track.times, vals = track.values;
    var n = times.length, size = trackSize(track.name);
    if (!n) return null;
    if (n === 1 || t <= times[0]) return Array.prototype.slice.call(vals, 0, size);
    if (t >= times[n - 1]) return Array.prototype.slice.call(vals, (n - 1) * size, n * size);
    for (var i = 0; i < n - 1; i++) {
      if (t >= times[i] && t <= times[i + 1]) {
        var span = times[i + 1] - times[i];
        var a = span > 1e-9 ? (t - times[i]) / span : 0;
        var o0 = i * size, o1 = (i + 1) * size;
        if (size === 4) {
          /* slerp quaternion (dùng THREE khi có, fallback nlerp).
             CHUẨN HOÁ trước khi slerp: tracksFromKeys làm tròn quat
             về 4 chữ số nên |q| có thể > 1 (vd 1.00004) → dot > 1 →
             THREE r128 slerp coi như "giống hệt" và TRẢ VỀ key đầu
             cho MỌI t trong đoạn (đóng băng + nhảy cóc). */
          var T = (typeof window !== 'undefined' && window.THREE) || null;
          if (T && T.Quaternion) {
            var qa = new T.Quaternion(vals[o0], vals[o0 + 1], vals[o0 + 2], vals[o0 + 3]).normalize();
            var qb = new T.Quaternion(vals[o1], vals[o1 + 1], vals[o1 + 2], vals[o1 + 3]).normalize();
            qa.slerp(qb, a);
            return [qa.x, qa.y, qa.z, qa.w];
          }
          var dot = vals[o0] * vals[o1] + vals[o0 + 1] * vals[o1 + 1] + vals[o0 + 2] * vals[o1 + 2] + vals[o0 + 3] * vals[o1 + 3];
          var s = dot < 0 ? -1 : 1;
          var out = [];
          for (var k = 0; k < 4; k++) out.push(vals[o0 + k] + (s * vals[o1 + k] - vals[o0 + k]) * a);
          var len = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2] + out[3] * out[3]) || 1;
          return out.map(function (v) { return v / len; });
        }
        var v = [];
        for (var j = 0; j < size; j++) v.push(vals[o0 + j] + (vals[o1 + j] - vals[o0 + j]) * a);
        return v;
      }
    }
    return Array.prototype.slice.call(vals, (n - 1) * size, n * size);
  }
  function quatAngleDeg(a, b) {
    /* CHUẨN HOÁ trước khi acos: tracksFromKeys làm tròn quaternion
       về 4 chữ số thập phân nên |q| ≈ 0.99994 ≠ 1 — acos(|dot|) trực
       tiếp báo ~1.7° cho 2 quaternion GIỐNG HỆT nhau (bẫy đã đo
       được trên clip Keyframe: lệch "ảo" 1.2–1.7°). */
    var na = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3]) || 1;
    var nb = Math.sqrt(b[0] * b[0] + b[1] * b[1] + b[2] * b[2] + b[3] * b[3]) || 1;
    var dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (na * nb);
    dot = Math.min(1, dot);
    return 2 * Math.acos(dot) * 180 / Math.PI;
  }
  function vecDist(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) { var d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  }

  /* ---------- (a) loại key thừa trên 1 track plain ---------- */
  function compressPlainTrack(track, opts) {
    opts = optsFrom(opts);
    var times = (track.times || []).slice();
    var values = (track.values || []).slice();
    var size = trackSize(track.name);
    var n = times.length;
    var keysBefore = n;
    if (!n || values.length !== n * size) {
      return { track: { name: track.name, times: times, values: values }, keysBefore: keysBefore, keysAfter: n, dropped: 0, error: 'values.length không khớp times.length*size' };
    }
    var eps = isQuatName(track.name) ? opts.rotEpsDeg : (isScaleName(track.name) ? opts.scaleEps : opts.posEps);
    var isQuat = isQuatName(track.name);
    /* kept = index các key giữ lại; key đầu/cuối luôn giữ.
       PHA 1 (tham lam): với key giữa i, dự đoán giá trị tại
       times[i] bằng nội suy giữa key giữ gần nhất (kept) và key
       GỐC tiếp theo (i+1) — nếu lệch dưới ngưỡng thì bỏ i.
       PHA 2 (kiểm chứng — BẮT BUỘC): pha 1 chỉ chặn lệch tại
       từng key bị bỏ so với dây cung cục bộ; nhiều key bỏ liên
       tiếp có thể làm dây cung dài lệch khỏi đường cong gốc tới
       vài lần eps (đo được trên Attack: 3.9° ở eps 1°). Nên với
       mỗi đoạn giữa 2 key giữ lại, kiểm tra MỌI key gốc ở giữa so
       với dây cung của đoạn — key nào lệch ≥ eps thì giữ lại key
       lệch nhất, lặp tới khi mọi đoạn đều đạt. Nhờ đó độ lệch TẠI
       CÁC KEY GỐC luôn ≤ eps + sai số quantize; GIỮA các key (nội
       suy slerp/lerp) có thể cao hơn một chút trên clip chuyển
       động nhanh (đo được 0.45° ở eps 0.1° trên Run 0.67s) —
       vẫn dưới 0.5° ở ngưỡng mặc định. */
    var kept = [0];
    for (var i = 1; i < n - 1; i++) {
      var k = kept[kept.length - 1];
      var span = times[i + 1] - times[k];
      var a = span > 1e-9 ? (times[i] - times[k]) / span : 0;
      var dev;
      if (isQuat) {
        var fake = { name: track.name, times: [times[k], times[i + 1]], values: values.slice(k * 4, k * 4 + 4).concat(values.slice((i + 1) * 4, (i + 1) * 4 + 4)) };
        dev = quatAngleDeg(sampleTrack(fake, times[i]), values.slice(i * 4, i * 4 + 4));
        if (dev >= eps) kept.push(i);
      } else {
        var oK = k * size, oN = (i + 1) * size, oI = i * size;
        var pa = [], va = [];
        for (var m = 0; m < size; m++) {
          pa.push(values[oK + m] + (values[oN + m] - values[oK + m]) * a);
          va.push(values[oI + m]);
        }
        dev = vecDist(pa, va);
        if (dev >= eps) kept.push(i);
      }
    }
    if (n > 1) kept.push(n - 1);
    /* PHA 2 — kiểm chứng từng đoạn */
    function worstOnSegment(k0, k1) {
      var worst = { idx: -1, dev: 0 };
      for (var j = k0 + 1; j < k1; j++) {
        var sp = times[k1] - times[k0];
        var aa = sp > 1e-9 ? (times[j] - times[k0]) / sp : 0;
        var dv;
        if (isQuat) {
          var fk = { name: track.name, times: [times[k0], times[k1]], values: values.slice(k0 * 4, k0 * 4 + 4).concat(values.slice(k1 * 4, k1 * 4 + 4)) };
          dv = quatAngleDeg(sampleTrack(fk, times[j]), values.slice(j * 4, j * 4 + 4));
        } else {
          var pp = [], vv = [];
          for (var m2 = 0; m2 < size; m2++) {
            pp.push(values[k0 * size + m2] + (values[k1 * size + m2] - values[k0 * size + m2]) * aa);
            vv.push(values[j * size + m2]);
          }
          dv = vecDist(pp, vv);
        }
        if (dv > worst.dev) worst = { idx: j, dev: dv };
      }
      return worst;
    }
    var changed = true, guard = 0;
    while (changed && guard++ < n + 2) {
      changed = false;
      for (var s = 0; s < kept.length - 1; s++) {
        var w = worstOnSegment(kept[s], kept[s + 1]);
        if (w.idx >= 0 && w.dev >= eps) { kept.splice(s + 1, 0, w.idx); changed = true; break; }
      }
    }
    var outTimes = [], outValues = [];
    kept.forEach(function (idx) {
      outTimes.push(roundTo(times[idx], 0.001));
      for (var j = 0; j < size; j++) {
        var v = values[idx * size + j];
        if (opts.quantize) {
          if (isQuat) v = quantizeHalf(v);
          else v = roundTo(v, 0.001);   /* position mm / scale 0.001 */
        }
        outValues.push(v);
      }
    });
    if (isQuat && opts.quantize) {
      /* chuẩn hoá lại quaternion sau quantize float16 */
      for (var q = 0; q < outValues.length; q += 4) {
        var len = Math.sqrt(outValues[q] * outValues[q] + outValues[q + 1] * outValues[q + 1] + outValues[q + 2] * outValues[q + 2] + outValues[q + 3] * outValues[q + 3]);
        if (len > 1e-9) {
          outValues[q] /= len; outValues[q + 1] /= len; outValues[q + 2] /= len; outValues[q + 3] /= len;
        }
      }
    }
    return {
      track: { name: track.name, times: outTimes, values: outValues },
      keysBefore: keysBefore, keysAfter: kept.length, dropped: keysBefore - kept.length
    };
  }

  function compressPlainTracks(tracks, opts) {
    opts = optsFrom(opts);
    var out = [], keysBefore = 0, keysAfter = 0, errors = [];
    (tracks || []).forEach(function (t) {
      var r = compressPlainTrack(t, opts);
      out.push(r.track);
      keysBefore += r.keysBefore;
      keysAfter += r.keysAfter;
      if (r.error) errors.push(r.error);
    });
    return { tracks: out, keysBefore: keysBefore, keysAfter: keysAfter, dropped: keysBefore - keysAfter, errors: errors };
  }

  /* ---------- nén 1 THREE.AnimationClip (trả clip mới, clip gốc giữ nguyên) ---------- */
  function compressClip(clip, opts) {
    opts = optsFrom(opts);
    if (!clip || !clip.tracks) return { ok: false, error: 'Clip không có tracks.' };
    var T = (typeof window !== 'undefined' && window.THREE) || null;
    if (!T || !T.AnimationClip) return { ok: false, error: 'THREE.AnimationClip chưa sẵn sàng.' };
    var plain = clip.tracks.map(function (tr) {
      return { name: tr.name, times: Array.prototype.slice.call(tr.times), values: Array.prototype.slice.call(tr.values) };
    });
    var bytesBefore = utf8Bytes(JSON.stringify(plain));
    var comp = compressPlainTracks(plain, opts);
    if (comp.errors.length) return { ok: false, error: 'Track lỗi: ' + comp.errors[0] };
    var bytesAfter = utf8Bytes(JSON.stringify(comp.tracks));
    var tracks = [];
    var skipped = [];
    comp.tracks.forEach(function (t) {
      try {
        if (isQuatName(t.name)) tracks.push(new T.QuaternionKeyframeTrack(t.name, t.times, t.values));
        else if (isPosName(t.name) || isScaleName(t.name)) tracks.push(new T.VectorKeyframeTrack(t.name, t.times, t.values));
        else skipped.push(t.name);
      } catch (e) { skipped.push(t.name + ' (' + (e && e.message) + ')'); }
    });
    var out = new T.AnimationClip((clip.name || 'clip') + '_compressed', clip.duration, tracks);
    var dev = measureDeviation(clip, out, opts);
    var stats = {
      keysBefore: comp.keysBefore, keysAfter: comp.keysAfter, dropped: comp.dropped,
      bytesBefore: bytesBefore, bytesAfter: bytesAfter,
      savedPct: bytesBefore ? Math.round((1 - bytesAfter / bytesBefore) * 1000) / 10 : 0,
      keySavedPct: comp.keysBefore ? Math.round((1 - comp.keysAfter / comp.keysBefore) * 1000) / 10 : 0,
      maxPosMm: dev.maxPosMm, maxRotDeg: dev.maxRotDeg, samples: dev.samples,
      skippedTracks: skipped,
      eps: { posEps: opts.posEps, rotEpsDeg: opts.rotEpsDeg, scaleEps: opts.scaleEps, quantize: opts.quantize }
    };
    return { ok: true, clip: out, stats: stats };
  }

  /* ---------- đo độ lệch giữa clip gốc và clip nén ---------- */
  function measureDeviation(clipA, clipB, opts) {
    opts = optsFrom(opts);
    var dur = Math.max(clipA.duration || 0, clipB.duration || 0);
    var rate = Math.max(10, opts.sampleRate || 60);
    var times = {};
    [clipA, clipB].forEach(function (c) {
      (c.tracks || []).forEach(function (t) {
        (t.times || []).forEach(function (tt) { times[roundTo(tt, 0.001)] = true; });
      });
    });
    var nSteps = Math.max(1, Math.ceil(dur * rate));
    for (var s = 0; s <= nSteps; s++) times[roundTo(s / rate, 0.001)] = true;
    var sampleTimes = Object.keys(times).map(Number).sort(function (a, b) { return a - b; });
    var byNameB = {};
    (clipB.tracks || []).forEach(function (t) { byNameB[t.name] = t; });
    var maxPosMm = 0, maxRotDeg = 0, worstPos = null, worstRot = null;
    (clipA.tracks || []).forEach(function (ta) {
      var tb = byNameB[ta.name];
      if (!tb) return;
      var plainA = { name: ta.name, times: Array.prototype.slice.call(ta.times), values: Array.prototype.slice.call(ta.values) };
      var plainB = { name: tb.name, times: Array.prototype.slice.call(tb.times), values: Array.prototype.slice.call(tb.values) };
      sampleTimes.forEach(function (t) {
        if (t > dur + 0.001) return;
        var va = sampleTrack(plainA, t), vb = sampleTrack(plainB, t);
        if (!va || !vb) return;
        if (isQuatName(ta.name)) {
          var d = quatAngleDeg(va, vb);
          if (d > maxRotDeg) { maxRotDeg = d; worstRot = { track: ta.name, t: t }; }
        } else if (isPosName(ta.name)) {
          var dm = vecDist(va, vb) * 1000;
          if (dm > maxPosMm) { maxPosMm = dm; worstPos = { track: ta.name, t: t }; }
        }
      });
    });
    return { maxPosMm: Math.round(maxPosMm * 1000) / 1000, maxRotDeg: Math.round(maxRotDeg * 1000) / 1000, samples: sampleTimes.length, worstPos: worstPos, worstRot: worstRot };
  }

  /* ---------- (c) nén keys Keyframe (pose Euler + hips) ----------
     QUAN TRỌNG: keys lưu Euler nhưng tracks xuất ra là quaternion
     (slerp) — kiểm chứng lệch phải làm trong KHÔNG GIAN QUATERNION
     (eulerToQuat + slerp tay, không cần THREE), vì lệch Euler theo
     từng trục KHÔNG chặn được góc xoay thật: đo được 1.2° ở eps
     0.1° khi kiểm chứng bằng Euler. Sau khi sửa: lệch đo trên
     tracks ≤ eps + sai số quantize. */
  function eulerToQuatXYZ(e) {
    var x = e.x || 0, y = e.y || 0, z = e.z || 0;
    var cx = Math.cos(x / 2), sx = Math.sin(x / 2);
    var cy = Math.cos(y / 2), sy = Math.sin(y / 2);
    var cz = Math.cos(z / 2), sz = Math.sin(z / 2);
    return [
      sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz + sx * sy * cz,
      cx * cy * cz - sx * sy * sz
    ];
  }
  function slerpQuat(a, b, t) {
    var dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    var s = dot < 0 ? -1 : 1;
    dot = Math.min(1, Math.abs(dot));
    if (dot > 0.9995) {
      var out = [];
      for (var i = 0; i < 4; i++) out.push(a[i] + (s * b[i] - a[i]) * t);
      var len = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2] + out[3] * out[3]) || 1;
      return out.map(function (v) { return v / len; });
    }
    var theta = Math.acos(dot), sinT = Math.sin(theta);
    var w0 = Math.sin((1 - t) * theta) / sinT, w1 = Math.sin(t * theta) / sinT;
    var r = [];
    for (var j = 0; j < 4; j++) r.push(a[j] * w0 + s * b[j] * w1);
    return r;
  }
  function compressKeyframeKeys(keys, opts) {
    opts = optsFrom(opts);
    keys = keys || [];
    var n = keys.length;
    if (n <= 2) return { keys: keys.slice(), kept: n, dropped: 0 };
    /* tiền tính quaternion từng xương từng key (1 lần) */
    var quats = keys.map(function (k) {
      var q = {};
      Object.keys(k.pose || {}).forEach(function (b) { q[b] = eulerToQuatXYZ(k.pose[b] || { x: 0, y: 0, z: 0 }); });
      return q;
    });
    function keyDevQuat(prev, cur, next, pi, ci, ni) {
      /* lệch lớn nhất: mọi xương (góc quaternion, độ) + hips (mm) */
      var maxRot = 0, maxPos = 0;
      var span = next.t - prev.t;
      var a = span > 1e-9 ? (cur.t - prev.t) / span : 0;
      var bones = {};
      Object.keys(quats[pi] || {}).forEach(function (b) { bones[b] = true; });
      Object.keys(quats[ci] || {}).forEach(function (b) { bones[b] = true; });
      Object.keys(quats[ni] || {}).forEach(function (b) { bones[b] = true; });
      var IDENT = [0, 0, 0, 1];
      Object.keys(bones).forEach(function (b) {
        var qp = (quats[pi] && quats[pi][b]) || IDENT;
        var qc = (quats[ci] && quats[ci][b]) || IDENT;
        var qn = (quats[ni] && quats[ni][b]) || IDENT;
        var d = quatAngleDeg(slerpQuat(qp, qn, a), qc);
        if (d > maxRot) maxRot = d;
      });
      if (cur.hips || prev.hips || next.hips) {
        var ph = prev.hips || { x: 0, y: 0, z: 0 };
        var ch = cur.hips || { x: 0, y: 0, z: 0 };
        var nh = next.hips || { x: 0, y: 0, z: 0 };
        var px = ph.x + (nh.x - ph.x) * a, py = ph.y + (nh.y - ph.y) * a, pz = ph.z + (nh.z - ph.z) * a;
        maxPos = Math.sqrt((ch.x - px) * (ch.x - px) + (ch.y - py) * (ch.y - py) + (ch.z - pz) * (ch.z - pz)) * 1000;
      }
      return { maxRotDeg: maxRot, maxPosMm: maxPos };
    }
    function keyIndex(k) { return keys.indexOf(k); }
    var kept = [keys[0]];
    for (var i = 1; i < n - 1; i++) {
      var d = keyDevQuat(kept[kept.length - 1], keys[i], keys[i + 1], keyIndex(kept[kept.length - 1]), i, i + 1);
      if (d.maxRotDeg >= opts.rotEpsDeg || d.maxPosMm >= opts.posEps * 1000) kept.push(keys[i]);
    }
    kept.push(keys[n - 1]);
    /* PHA 2 (kiểm chứng): dây cung dài qua nhiều key bỏ liên tiếp
       có thể lệch khỏi đường cong gốc tới vài lần eps; kiểm tra mọi
       key gốc trong từng đoạn, giữ lại key lệch nhất nếu vượt ngưỡng. */
    var changed2 = true, guard2 = 0;
    while (changed2 && guard2++ < n + 2) {
      changed2 = false;
      for (var s2 = 0; s2 < kept.length - 1; s2++) {
        var i0 = keyIndex(kept[s2]), i1 = keyIndex(kept[s2 + 1]);
        var worstJ = -1, worstD = 0;
        for (var j = i0 + 1; j < i1; j++) {
          var dj = keyDevQuat(kept[s2], keys[j], kept[s2 + 1], i0, j, i1);
          var score = Math.max(dj.maxRotDeg / opts.rotEpsDeg, dj.maxPosMm / (opts.posEps * 1000));
          if (score > worstD) { worstD = score; worstJ = j; }
        }
        if (worstJ >= 0 && worstD >= 1) { kept.splice(s2 + 1, 0, keys[worstJ]); changed2 = true; break; }
      }
    }
    return { keys: kept, kept: kept.length, dropped: n - kept.length };
  }

  /* ---------- tiện ích xuất / đọc JSON ---------- */
  function utf8Bytes(s) {
    try { return unescape(encodeURIComponent(s)).length; } catch (e) { return String(s).length; }
  }
  function bytesOfJSON(obj) { return utf8Bytes(JSON.stringify(obj)); }
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function formatStats(st) {
    if (!st) return '—';
    var keys = st.keysBefore + ' → ' + st.keysAfter + ' keys (−' + (st.keySavedPct !== undefined ? st.keySavedPct : 0) + '%)';
    var bytes = formatBytes(st.bytesBefore) + ' → ' + formatBytes(st.bytesAfter) + ' (−' + (st.savedPct !== undefined ? st.savedPct : 0) + '%)';
    var dev = 'lệch tối đa ' + (st.maxPosMm !== undefined ? st.maxPosMm + 'mm' : '?') + ' / ' + (st.maxRotDeg !== undefined ? st.maxRotDeg + '°' : '?');
    return keys + ' · ' + bytes + ' · ' + dev;
  }
  /* Đọc file export JSON của studio (animator/keyframe/coco/hy3d,
     cả bản nén lẫn không nén — nén không cần giải nén vì giá trị
     đã là số thường). */
  function parseExportJSON(text) {
    var data = text;
    if (typeof text === 'string') {
      try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'JSON không parse được: ' + (e && e.message) }; }
    }
    if (!data || !Array.isArray(data.clips) || !data.clips.length) {
      return { ok: false, error: 'File không có clips — cần format pixistudio-*-clips-1.' };
    }
    var keys = 0;
    data.clips.forEach(function (c) {
      (c.tracks || []).forEach(function (t) { keys += (t.times || []).length; });
    });
    return {
      ok: true, format: data.format || 'unknown', compressed: !!data.compressed,
      compression: data.compression || null, clips: data.clips, keyCount: keys,
      clipCount: data.clips.length
    };
  }

  var Compression = {
    DEFAULTS: DEFAULTS,
    STORE_KEY: STORE_KEY,
    getSettings: getSettings,
    setSettings: setSettings,
    quantizeHalf: quantizeHalf,
    floatToHalfBits: floatToHalfBits,
    halfBitsToFloat: halfBitsToFloat,
    sampleTrack: sampleTrack,
    quatAngleDeg: quatAngleDeg,
    compressPlainTrack: compressPlainTrack,
    compressPlainTracks: compressPlainTracks,
    compressClip: compressClip,
    compressKeyframeKeys: compressKeyframeKeys,
    measureDeviation: measureDeviation,
    bytesOfJSON: bytesOfJSON,
    formatBytes: formatBytes,
    formatStats: formatStats,
    parseExportJSON: parseExportJSON
  };

  PS.ArpAnimCompression = Compression;
  if (typeof module !== 'undefined' && module.exports) module.exports = Compression;

})();
