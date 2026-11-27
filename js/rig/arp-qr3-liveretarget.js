/* ============================================================
 * rig/arp-qr3-liveretarget.js — LIVE RETARGET PREVIEW (PHẦN 8,
 * vòng mở rộng thứ 3 của Quick Rig / Auto Rig Pro Blend)
 *
 * Phát 1 clip nguồn và xem retarget LIVE lên control rig
 * (QuickRig.current) trong viewport:
 *   • preview(clip, {loop}) — kiểm tra compat trước, rồi mỗi
 *     bước thời gian nội suy từng track của clip (slerp quaternion
 *     / lerp position, scale) và áp lên xương đích trong
 *     QuickRig.current.bones.
 *   • pause / resume / stop — stop TRẢ RIG VỀ POSE TRƯỚC PREVIEW
 *     (snapshot lúc bắt đầu phát).
 *   • switchClip(newClip) — dừng clip cũ, kiểm tra compat clip
 *     mới, phát clip mới.
 *   • tick(dt) đồng bộ — KHÔNG dùng timer thật trong jsdom: UI ở
 *     trình duyệt gọi tick bằng requestAnimationFrame, harness gọi
 *     tick trực tiếp.
 *   • getTime / getProgress / getDuration — time readout.
 *
 * KHI NÀO DÙNG ArpRemap, KHI NÀO FALLBACK (ghi rõ theo spec):
 *   • CÓ ArpRemap (js/rig/arp-remap.js đã load): preview() gọi
 *     ArpRemap.retargetClip(clip, QuickRig.current) để map track
 *     theo tên chuẩn + kiểm tra compat theo đúng luật Remap, rồi
 *     sample clip ĐÃ REMAP (track tên mixamorig:Name.prop).
 *     method trả về = 'arpremap'.
 *   • KHÔNG có ArpRemap: fallback tự map theo tên — strip prefix
 *     "mixamorig:" (regex /^mixamorig:?/i, không phân biệt hoa
 *     thường) rồi khớp không phân biệt hoa thường với tên xương
 *     đích trong QuickRig.current.bones; sample trực tiếp clip
 *     nguồn. method trả về = 'fallback-name-map'.
 *   • checkCompat() LUÔN tự tính (không gọi ArpRemap) để tránh
 *     side-effect (notify/clone clip): compat = số xương đích của
 *     clip map được / tổng xương rig; < 80% thì TỪ CHỐI phát +
 *     trả {ok:false, missing:[...]} liệt kê xương thiếu — ĐÚNG
 *     LUẬT Remap (xem arp-remap.js, MIN_COMPAT 0.80).
 *   • clip JSON (format pixistudio-*-clips-1, tracks {name, times,
 *     values}): dùng ArpRemap.clipFromJSON khi có, fallback tự
 *     dựng THREE.AnimationClip khi không có.
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Chỉ map theo tên xương — KHÔNG xử lý khác tỉ lệ xương, khác
 *     hướng rest-pose, hay khác trục quay giữa 2 rig (giống Remap).
 *   • Track .position của Hips giữ nguyên giá trị gốc (root motion
 *     theo đúng clip nguồn); 2 rig cao khác nhau có thể trượt chân.
 *   • Không retarget morph target / blend shape, chỉ bone tracks.
 *   • Clip từng phần (vd chỉ animate 7 xương) sẽ bị từ chối theo
 *     luật phủ rig ≥ 80% — luật đo độ phủ rig, không đo độ khớp
 *     của clip (xem header arp-remap.js).
 *   • Preview áp trực tiếp lên bone (local quaternion/position);
 *     control helpers (__arp_ctrl_*) không đi theo bone trong lúc
 *     preview — bấm Match to source sau khi dừng nếu cần đồng bộ.
 * ============================================================ */
(function () {
  'use strict';

  var PS = window.PixiStudio || {};
  var bus = PS.bus;
  var U = PS.Utils;
  var MIN_COMPAT = 0.80;   /* < 80% → từ chối, giống luật Remap */

  /* ---------- trạng thái preview ---------- */
  var st = {
    clip: null,            /* THREE.AnimationClip đang phát (đã remap nếu có ArpRemap) */
    clipName: '',
    sourceClipName: '',
    duration: 0,
    time: 0,
    playing: false,
    paused: false,
    loop: true,
    method: '',            /* 'arpremap' | 'fallback-name-map' */
    entries: null,         /* [{track, bone, prop, dst}] đã map xong */
    savedPose: null,       /* snapshot pose trước preview, để stop() khôi phục */
    compat: null
  };

  /* temp objects cho nội suy (tạo lười, tránh rác mỗi tick) */
  var _tq1 = null, _tq2 = null, _tv1 = null, _tv2 = null;
  function temps() {
    var T = window.THREE;
    if (!_tq1) {
      _tq1 = new T.Quaternion();
      _tq2 = new T.Quaternion();
      _tv1 = new T.Vector3();
      _tv2 = new T.Vector3();
    }
  }

  function notify(type, title, message, duration) {
    if (bus && bus.emit) bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 });
  }
  function emit(ev, data) {
    try { if (bus && bus.emit) bus.emit(ev, data); } catch (e) {}
  }
  function getQR() { return (window.PixiStudio && PixiStudio.ArpQuickRig) || null; }
  function getRig() {
    var QR = getQR();
    return (QR && QR.current) ? QR.current : null;
  }
  function getRemap() { return (window.PixiStudio && PixiStudio.ArpRemap) || null; }

  /* ---------- tên xương / track ---------- */
  function normalizeBoneName(name) {
    return String(name || '')
      .replace(/^mixamorig:?/i, '')
      .replace(/^model:?/i, '')
      .trim()
      .toLowerCase();
  }
  /* Track "mixamorig:Hips.position" / "Hips.quaternion" →
     { bone: 'mixamorig:Hips', prop: 'position' }. Tách ở dấu '.'
     CUỐI vì tên xương chứa ':' nhưng không chứa '.'. */
  function parseTrackName(trackName) {
    var name = String(trackName || '');
    var dot = name.lastIndexOf('.');
    if (dot <= 0) return null;
    var prop = name.slice(dot + 1);
    if (prop !== 'position' && prop !== 'quaternion' && prop !== 'scale') return null;
    return { bone: name.slice(0, dot), prop: prop };
  }
  /* Map tên track -> tên xương đích trong QuickRig.current.bones
     (41 tên Mixamo KHÔNG prefix). Trả về tên đích hoặc null. */
  function remapTrackName(trackName, rig) {
    rig = rig || getRig();
    if (!rig || !rig.bones) return null;
    var parsed = parseTrackName(trackName);
    if (!parsed) return null;
    var norm = normalizeBoneName(parsed.bone);
    var keys = Object.keys(rig.bones);
    for (var i = 0; i < keys.length; i++) {
      if (normalizeBoneName(keys[i]) === norm) return keys[i];
    }
    return null;
  }

  /* ---------- clip JSON -> THREE.AnimationClip ----------
     Dùng ArpRemap.clipFromJSON khi có; fallback tự viết khi không. */
  function clipFromJSON(json) {
    var R = getRemap();
    if (R && typeof R.clipFromJSON === 'function') {
      try {
        var c = R.clipFromJSON(json);
        if (c) return c;
      } catch (e) {}
    }
    var T = window.THREE;
    if (!T) return null;
    var data = (typeof json === 'string') ? JSON.parse(json) : json;
    var entry = (data.clips && data.clips[0]) || data;
    if (!entry || !entry.tracks) return null;
    var tracks = entry.tracks.map(function (t) {
      var prop = t.name.slice(t.name.lastIndexOf('.') + 1);
      var times = new Float32Array(t.times);
      var values = new Float32Array(t.values);
      if (prop === 'quaternion') return new T.QuaternionKeyframeTrack(t.name, times, values);
      return new T.VectorKeyframeTrack(t.name, times, values);
    });
    var dur = (entry.duration && entry.duration > 0) ? entry.duration : -1;
    return new T.AnimationClip(entry.name || entry.id || 'clip', dur, tracks);
  }

  /* ---------- liệt kê clip nguồn ----------
     1. clip đã gắn trên QuickRig.current.clips (Mixamo)
     2. ArpRemap.listClips() khi có (studio clips)
     3. target.animations (GLTF/FBX load kèm clip)
     Khử trùng theo tên. */
  function listClips() {
    var out = [], seen = {};
    var push = function (id, clip, source) {
      if (!clip || !clip.tracks || !clip.name) return;
      if (seen[clip.name]) return;
      seen[clip.name] = true;
      out.push({ id: id || clip.name, name: clip.name, clip: clip, source: source || 'studio' });
    };
    var rig = getRig();
    if (rig && rig.clips) rig.clips.forEach(function (c) { push(c.name, c, 'QuickRig'); });
    var R = getRemap();
    if (R && typeof R.listClips === 'function') {
      try { R.listClips().forEach(function (e) { push(e.id, e.clip, e.source); }); } catch (e) {}
    }
    if (rig && rig.target && rig.target.animations) {
      rig.target.animations.forEach(function (c) { push(c.name, c, 'model'); });
    }
    return out;
  }

  /* Chấp nhận: THREE.AnimationClip | entry {clip} | tên clip (string)
     | clip JSON đơn {name, tracks} | JSON bundle {clips:[...]}. */
  function resolveClipInput(input) {
    if (!input) return null;
    if (input.tracks && input.name && typeof input.optimize === 'function') return input; /* AnimationClip */
    if (input.clip && input.clip.tracks) return input.clip;                               /* entry {clip} */
    if (typeof input === 'string') {
      var found = listClips().filter(function (e) { return e.id === input || e.name === input; })[0];
      return found ? found.clip : null;
    }
    if (input.tracks && Array.isArray(input.tracks)) return clipFromJSON(input);          /* clip JSON đơn */
    if (input.clips && Array.isArray(input.clips) && input.clips.length) return clipFromJSON(input.clips[0]);
    return null;
  }

  /* ============================================================
     KIỂM TRA COMPAT — cùng luật Remap:
     compat = số xương ĐÍCH của clip map được / tổng xương rig.
     < 80% → ok=false + missing = xương rig không được clip phủ.
     ============================================================ */
  function checkCompat(clipInput, rig) {
    rig = rig || getRig();
    var result = { ok: false, compat: 0, matched: 0, matchedBones: [], total: 0,
      rigBoneTotal: 0, missing: [], skipped: [], reason: '' };
    var clip = resolveClipInput(clipInput);
    if (!clip) {
      result.reason = 'Không tìm thấy clip nguồn (clip rỗng hoặc tên không có trong studio).';
      return result;
    }
    if (!rig || !rig.bones) {
      result.reason = 'Chưa có control rig — chạy Auto Gen / convert Quick Rig trước.';
      return result;
    }
    var rigNames = Object.keys(rig.bones);
    result.rigBoneTotal = rigNames.length;
    if (!rigNames.length) {
      result.reason = 'Rig đích không có xương nào (model chưa rig?).';
      return result;
    }
    var matchedSet = {}, skippedSet = {}, totalBoneTracks = 0;
    clip.tracks.forEach(function (track) {
      var parsed = parseTrackName(track.name);
      if (!parsed) return;   /* track không phải bone (vd morph) → bỏ qua, không đếm */
      totalBoneTracks++;
      var dst = remapTrackName(track.name, rig);
      if (!dst) { skippedSet[parsed.bone] = true; return; }
      matchedSet[dst] = true;
    });
    result.total = totalBoneTracks;
    result.matchedBones = Object.keys(matchedSet).sort();
    result.matched = result.matchedBones.length;
    result.skipped = Object.keys(skippedSet).sort();
    result.missing = rigNames.filter(function (n) { return !matchedSet[n]; }).sort();
    result.compat = result.matched / rigNames.length;
    if (!totalBoneTracks) {
      result.reason = 'Clip "' + clip.name + '" không có track xương nào để retarget.';
      return result;
    }
    if (result.compat < MIN_COMPAT) {
      result.reason = 'Không tương thích: clip chỉ phủ ' + result.matched + '/' + rigNames.length +
        ' xương rig đích (' + Math.round(result.compat * 100) + '% < 80%). Xương rig thiếu trong clip: ' +
        result.missing.slice(0, 10).join(', ') +
        (result.missing.length > 10 ? ' … +' + (result.missing.length - 10) + ' xương nữa' : '') + '.';
      return result;
    }
    result.ok = true;
    return result;
  }

  /* ---------- snapshot / khôi phục pose ---------- */
  function snapshotPose(rig) {
    var snap = {};
    Object.keys(rig.bones).forEach(function (dst) {
      var b = rig.bones[dst];
      if (!b) return;
      snap[dst] = {
        q: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
        p: [b.position.x, b.position.y, b.position.z],
        s: [b.scale.x, b.scale.y, b.scale.z]
      };
    });
    return snap;
  }
  function restorePose(rig, snap) {
    if (!rig || !snap) return;
    Object.keys(snap).forEach(function (dst) {
      var b = rig.bones[dst];
      if (!b) return;
      var s = snap[dst];
      b.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
      b.position.set(s.p[0], s.p[1], s.p[2]);
      b.scale.set(s.s[0], s.s[1], s.s[2]);
    });
  }

  /* ---------- build entries + nội suy ---------- */
  function buildEntries(clip, rig) {
    var entries = [];
    clip.tracks.forEach(function (track) {
      var parsed = parseTrackName(track.name);
      if (!parsed) return;
      var dst = remapTrackName(track.name, rig);
      if (!dst || !rig.bones[dst]) return;
      entries.push({ track: track, bone: rig.bones[dst], prop: parsed.prop, dst: dst });
    });
    return entries;
  }

  /* Nội suy 1 track tại thời điểm t rồi áp lên xương đích.
     quaternion: slerp; position/scale: lerp tuyến tính. */
  function applySample(entry, t) {
    var track = entry.track;
    var times = track.times, values = track.values;
    var n = times.length;
    if (!n) return;
    temps();
    var prop = entry.prop;
    if (prop === 'quaternion') {
      if (n === 1 || t <= times[0]) {
        _tq1.set(values[0], values[1], values[2], values[3]);
      } else if (t >= times[n - 1]) {
        var o = (n - 1) * 4;
        _tq1.set(values[o], values[o + 1], values[o + 2], values[o + 3]);
      } else {
        var i = 0;
        while (i < n - 2 && times[i + 1] <= t) i++;
        var t0 = times[i], t1 = times[i + 1];
        var a = (t1 > t0) ? (t - t0) / (t1 - t0) : 0;
        var o0 = i * 4, o1 = (i + 1) * 4;
        _tq1.set(values[o0], values[o0 + 1], values[o0 + 2], values[o0 + 3]);
        _tq2.set(values[o1], values[o1 + 1], values[o1 + 2], values[o1 + 3]);
        _tq1.slerp(_tq2, a);
      }
      entry.bone.quaternion.copy(_tq1);
    } else {
      if (n === 1 || t <= times[0]) {
        _tv1.set(values[0], values[1], values[2]);
      } else if (t >= times[n - 1]) {
        var p = (n - 1) * 3;
        _tv1.set(values[p], values[p + 1], values[p + 2]);
      } else {
        var j = 0;
        while (j < n - 2 && times[j + 1] <= t) j++;
        var u0 = times[j], u1 = times[j + 1];
        var b = (u1 > u0) ? (t - u0) / (u1 - u0) : 0;
        var p0 = j * 3, p1 = (j + 1) * 3;
        _tv1.set(values[p0], values[p0 + 1], values[p0 + 2]);
        _tv2.set(values[p1], values[p1 + 1], values[p1 + 2]);
        _tv1.lerp(_tv2, b);
      }
      if (prop === 'position') entry.bone.position.copy(_tv1);
      else if (prop === 'scale') entry.bone.scale.copy(_tv1);
    }
  }
  function applyAt(t) {
    if (!st.entries) return;
    for (var i = 0; i < st.entries.length; i++) applySample(st.entries[i], t);
  }

  /* ---------- UI refresh (section đang mở, nếu có) ---------- */
  var _ui = null;
  function refreshUI() {
    if (_ui && typeof _ui.update === 'function') {
      try { _ui.update(); } catch (e) {}
    }
  }

  /* ============================================================
     PREVIEW — phát clip nguồn, retarget live lên control rig.
     opts: { loop: true (mặc định) }.
     Trả về {ok, clip, sourceClip, duration, compat, matched, total,
       method, tracks} hoặc {ok:false, compat, missing, reason}.
     ============================================================ */
  function preview(clipInput, opts) {
    opts = opts || {};
    var rig = getRig();
    if (!rig) {
      return { ok: false, error: 'Chưa có control rig — chạy Auto Gen / convert Quick Rig trước.' };
    }
    var clip = resolveClipInput(clipInput);
    if (!clip) {
      return { ok: false, error: 'Không tìm thấy clip nguồn (clip rỗng hoặc tên không có trong studio).' };
    }
    /* Dừng preview cũ TRƯỚC khi kiểm tra clip mới (trả pose về trước
       preview): nếu clip mới bị từ chối thì viewport cũng không còn
       phát clip cũ — trạng thái viewport khớp với UI báo từ chối.
       Cùng thứ tự với switchClip: dừng cũ → kiểm tra mới → phát mới. */
    if (st.playing) stop();
    var compat = checkCompat(clip, rig);
    if (!compat.ok) {
      notify('error', 'Live Retarget — clip không tương thích', compat.reason, 12000);
      emit('arpliveretarget:rejected', { clip: clip.name, compat: compat.compat, missing: compat.missing });
      return { ok: false, compat: compat.compat, missing: compat.missing,
        matched: compat.matched, total: compat.rigBoneTotal, reason: compat.reason };
    }
    /* dừng preview cũ trước (trả pose về trước preview) rồi mới phát mới */

    var useClip = clip, method = 'fallback-name-map';
    var R = getRemap();
    if (R && typeof R.retargetClip === 'function') {
      /* CÓ ArpRemap: dùng retargetClip chuẩn (map tên + compat luật
         Remap), rồi sample clip ĐÃ REMAP. */
      try {
        var res = R.retargetClip(clip, rig, {});
        if (res && res.ok && res.clip) {
          useClip = res.clip;
          method = 'arpremap';
        } else if (res) {
          return { ok: false, compat: res.compat, missing: res.missing,
            matched: res.matchedBones, total: res.rigBoneTotal,
            reason: res.reason || compat.reason };
        }
      } catch (e) {
        /* retarget lỗi bất ngờ → rơi về fallback map theo tên */
        method = 'fallback-name-map';
        useClip = clip;
      }
    }
    /* KHÔNG có ArpRemap: fallback — sample trực tiếp clip nguồn,
       map tên track -> xương đích bằng remapTrackName. */
    var entries = buildEntries(useClip, rig);
    if (!entries.length) {
      return { ok: false, error: 'Không map được track nào của clip "' + clip.name + '" lên rig.' };
    }
    st.savedPose = snapshotPose(rig);
    st.clip = useClip;
    st.clipName = useClip.name;
    st.sourceClipName = clip.name;
    st.duration = useClip.duration || 0;
    st.time = 0;
    st.playing = true;
    st.paused = false;
    st.loop = opts.loop !== false;
    st.method = method;
    st.entries = entries;
    st.compat = compat;
    applyAt(0);
    emit('arpliveretarget:play', { clip: st.clipName, source: st.sourceClipName,
      duration: st.duration, method: method, compat: compat.compat });
    refreshUI();
    return { ok: true, clip: st.clipName, sourceClip: st.sourceClipName,
      duration: st.duration, compat: compat.compat, matched: compat.matched,
      total: compat.rigBoneTotal, method: method, tracks: entries.length };
  }

  function pause() {
    if (!st.playing) return { ok: false, error: 'Không có preview nào đang chạy.' };
    if (st.paused) return { ok: false, error: 'Preview đã tạm dừng rồi.' };
    st.paused = true;
    emit('arpliveretarget:pause', { clip: st.clipName, time: st.time });
    refreshUI();
    return { ok: true, clip: st.clipName, time: st.time };
  }

  function resume() {
    if (!st.playing) return { ok: false, error: 'Không có preview nào đang chạy.' };
    if (!st.paused) return { ok: false, error: 'Preview không bị tạm dừng.' };
    st.paused = false;
    emit('arpliveretarget:resume', { clip: st.clipName, time: st.time });
    refreshUI();
    return { ok: true, clip: st.clipName, time: st.time };
  }

  function stop() {
    if (!st.playing && !st.clip) return { ok: false, error: 'Không có preview nào đang chạy.' };
    var rig = getRig();
    if (rig && st.savedPose) restorePose(rig, st.savedPose);
    var name = st.clipName;
    st.playing = false;
    st.paused = false;
    st.time = 0;
    st.duration = 0;
    st.clip = null;
    st.clipName = '';
    st.sourceClipName = '';
    st.entries = null;
    st.savedPose = null;
    st.method = '';
    st.compat = null;
    emit('arpliveretarget:stop', { clip: name });
    refreshUI();
    return { ok: true, clip: name };
  }

  /* Dừng clip cũ (trả pose), kiểm tra compat clip mới, phát clip mới.
     Clip mới bị từ chối → rig đã về pose trước preview, không phát gì. */
  function switchClip(newClip, opts) {
    var wasPlaying = st.playing;
    if (st.playing) stop();
    var res = preview(newClip, opts);
    if (res.ok) emit('arpliveretarget:switch', { clip: res.clip, fromPlaying: wasPlaying });
    return res;
  }

  /* Tick đồng bộ — UI trình duyệt gọi bằng requestAnimationFrame,
     harness gọi trực tiếp. Không dùng timer thật trong module. */
  function tick(dt) {
    if (!st.playing) return { ok: false, playing: false, paused: st.paused, time: st.time };
    if (st.paused) return { ok: false, playing: true, paused: true, time: st.time };
    dt = (typeof dt === 'number' && isFinite(dt) && dt > 0) ? dt : 0;
    if (!st.duration || st.duration <= 0) return { ok: false, error: 'Clip không có duration.' };
    st.time += dt;
    if (st.loop) {
      while (st.time >= st.duration) st.time -= st.duration;
    } else if (st.time >= st.duration) {
      st.time = st.duration;
      applyAt(st.time);
      st.playing = false;
      emit('arpliveretarget:ended', { clip: st.clipName });
      refreshUI();
      return { ok: true, time: st.time, progress: getProgress(), ended: true };
    }
    applyAt(st.time);
    refreshUI();
    return { ok: true, time: st.time, progress: getProgress() };
  }

  function getTime() { return st.time; }
  function getDuration() { return st.duration; }
  function getProgress() { return (st.duration > 0) ? st.time / st.duration : 0; }
  function isPlaying() { return st.playing && !st.paused; }
  function isPaused() { return st.playing && st.paused; }
  function getState() {
    return { playing: st.playing, paused: st.paused, time: st.time,
      duration: st.duration, progress: getProgress(), clipName: st.clipName,
      sourceClipName: st.sourceClipName, method: st.method, loop: st.loop };
  }

  /* ============================================================
     UI SECTION — DOM thuần + inline style, không sửa CSS.
     Dropdown chọn clip nguồn (clip trên rig + clip studio),
     nút Phát / Tạm dừng / Dừng / Chuyển clip, thanh progress +
     time readout, hiện % compat + xương thiếu khi bị từ chối.
     Vòng rAF chỉ chạy khi đang phát (để tick + cập nhật UI);
     core tick(dt) vẫn đồng bộ để harness gọi trực tiếp.
     ============================================================ */
  function el(tag, attrs, children) {
    if (U && U.el) return U.el(tag, attrs, children);
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null) return;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }
  function fmtTime(t) { return (Math.round(t * 100) / 100).toFixed(2) + 's'; }

  function renderSection(container) {
    if (!container) return;
    container.innerHTML = '';
    var state = { selectedId: '', lastCompat: null };
    var wrap = el('div', { class: 'arp-qr3-liveretarget' });
    wrap.appendChild(el('div', { class: 'arp-note', html:
      '<b>▶ Live Retarget Preview</b> — phát clip nguồn và xem retarget live lên control rig. ' +
      'Compat ≥ 80% xương rig mới được phát (luật Remap); dưới 80% sẽ liệt kê xương thiếu. ' +
      'Dừng sẽ trả rig về pose trước khi preview.' }));

    /* --- dropdown clip nguồn --- */
    var select = el('select', { class: 'arp-select', style: 'width:100%;margin-bottom:8px;' });
    var refreshList = function () {
      var clips = listClips();
      select.innerHTML = '';
      if (!clips.length) {
        var opt0 = document.createElement('option');
        opt0.textContent = '— Chưa có clip nào (gắn clip Mixamo vào rig / load FBX kèm clip trước) —';
        opt0.value = '';
        select.appendChild(opt0);
      } else {
        clips.forEach(function (e) {
          var opt = document.createElement('option');
          opt.value = e.name;
          opt.textContent = e.name + '  ·  ' + e.clip.tracks.length + ' tracks · ' + e.clip.duration.toFixed(2) + 's  ·  ' + e.source;
          select.appendChild(opt);
        });
      }
      state.selectedId = select.value;
    };
    refreshList();
    wrap.appendChild(select);
    wrap.appendChild(el('button', {
      class: 'btn', style: 'margin-bottom:8px;',
      text: '↻ Làm mới danh sách clip',
      onclick: function () { refreshList(); renderCompatBox(); }
    }));

    /* --- compat box --- */
    var compatBox = el('div', { class: 'arp-lr-compat small', style: 'line-height:1.6;margin-bottom:8px;' });
    var renderCompatBox = function () {
      var r = state.lastCompat;
      compatBox.innerHTML = '';
      if (!r) {
        if (!state.selectedId) { compatBox.textContent = 'Chưa chọn clip.'; return; }
        r = checkCompat(state.selectedId);
        state.lastCompat = r;
      }
      if (!r.ok) {
        compatBox.appendChild(el('div', { style: 'color:#c00;', html:
          '<b>✕ Từ chối:</b> tương thích ' + Math.round(r.compat * 100) + '% &lt; 80% (phủ ' +
          r.matched + '/' + r.rigBoneTotal + ' xương rig).' }));
        if (r.missing && r.missing.length) {
          compatBox.appendChild(el('div', { text: 'Xương rig thiếu trong clip (' + r.missing.length + '): ' + r.missing.join(', ') }));
        } else if (r.reason) {
          compatBox.appendChild(el('div', { text: r.reason }));
        }
        return;
      }
      compatBox.appendChild(el('div', { style: 'color:#0a7d4a;', html:
        '<b>✓ Tương thích ' + Math.round(r.compat * 100) + '%</b> — phủ ' +
        r.matched + '/' + r.rigBoneTotal + ' xương rig.' }));
      if (r.missing && r.missing.length) {
        compatBox.appendChild(el('div', { text: 'Xương rig không có trong clip (' + r.missing.length + '): ' + r.missing.join(', ') }));
      } else {
        compatBox.appendChild(el('div', { text: 'Phủ 100% rig — không thiếu xương nào.' }));
      }
    };
    select.addEventListener('change', function () {
      state.selectedId = select.value;
      state.lastCompat = null;
      renderCompatBox();
    });
    renderCompatBox();
    wrap.appendChild(compatBox);

    /* --- progress + time readout --- */
    var barOuter = el('div', { style: 'height:10px;background:#ddd;border-radius:5px;overflow:hidden;margin:4px 0;' });
    var bar = el('div', { style: 'height:100%;width:0%;background:#33aa55;' });
    barOuter.appendChild(bar);
    wrap.appendChild(barOuter);
    var timeLabel = el('div', { class: 'arp-lr-time small', style: 'margin-bottom:8px;', text: '0.00s / 0.00s · 0%' });
    wrap.appendChild(timeLabel);

    /* --- nút điều khiển --- */
    var btnRow = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' });
    var playBtn = el('button', { class: 'btn primary', text: '▶ Phát' });
    var pauseBtn = el('button', { class: 'btn', text: '⏸ Tạm dừng' });
    var stopBtn = el('button', { class: 'btn', text: '■ Dừng' });
    var switchBtn = el('button', { class: 'btn', text: '⇄ Chuyển clip' });

    /* vòng rAF: chỉ chạy khi đang phát, tick + cập nhật UI */
    var rafOn = false, lastTs = 0;
    var rafLoop = function () {
      if (!rafOn) return;
      var now = Date.now();
      var dt = lastTs ? (now - lastTs) / 1000 : 0.016;
      if (dt > 0.1) dt = 0.1;
      if (dt < 0) dt = 0;
      lastTs = now;
      tick(dt);
      if (isPlaying()) {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(rafLoop);
        else rafOn = false;
      } else rafOn = false;
    };
    var startRaf = function () {
      if (rafOn) return;
      if (typeof requestAnimationFrame !== 'function') return;
      rafOn = true;
      lastTs = 0;
      requestAnimationFrame(rafLoop);
    };

    playBtn.addEventListener('click', function () {
      if (!state.selectedId) { notify('warning', 'Live Retarget', 'Chưa chọn clip nguồn.'); return; }
      var res = preview(state.selectedId, { loop: true });
      if (!res.ok) {
        state.lastCompat = { ok: false, compat: res.compat || 0, matched: res.matched || 0,
          rigBoneTotal: res.total || 0, missing: res.missing || [], reason: res.reason || res.error || '' };
        renderCompatBox();
        return;
      }
      state.lastCompat = checkCompat(state.selectedId);
      renderCompatBox();
      startRaf();
    });
    pauseBtn.addEventListener('click', function () {
      if (st.paused) resume(); else pause();
    });
    stopBtn.addEventListener('click', function () { stop(); });
    switchBtn.addEventListener('click', function () {
      if (!state.selectedId) { notify('warning', 'Live Retarget', 'Chưa chọn clip nguồn.'); return; }
      var res = switchClip(state.selectedId, { loop: true });
      if (!res.ok) {
        state.lastCompat = { ok: false, compat: res.compat || 0, matched: res.matched || 0,
          rigBoneTotal: res.total || 0, missing: res.missing || [], reason: res.reason || res.error || '' };
        renderCompatBox();
        return;
      }
      state.lastCompat = checkCompat(state.selectedId);
      renderCompatBox();
      startRaf();
    });
    btnRow.appendChild(playBtn);
    btnRow.appendChild(pauseBtn);
    btnRow.appendChild(stopBtn);
    btnRow.appendChild(switchBtn);
    wrap.appendChild(btnRow);

    var updateUI = function () {
      var pct = Math.round(getProgress() * 100);
      bar.style.width = pct + '%';
      timeLabel.textContent = fmtTime(getTime()) + ' / ' + fmtTime(getDuration()) + ' · ' + pct + '%' +
        (st.clipName ? ' · ' + st.clipName : '') +
        (st.method ? ' · ' + st.method : '');
      pauseBtn.textContent = st.paused ? '▶ Tiếp tục' : '⏸ Tạm dừng';
    };
    _ui = { update: updateUI };
    updateUI();

    container.appendChild(wrap);
  }

  /* ---------- expose ---------- */
  var LiveRetarget = {
    MIN_COMPAT: MIN_COMPAT,
    preview: preview,
    pause: pause,
    resume: resume,
    stop: stop,
    switchClip: switchClip,
    tick: tick,
    getTime: getTime,
    getProgress: getProgress,
    getDuration: getDuration,
    isPlaying: isPlaying,
    isPaused: isPaused,
    getState: getState,
    checkCompat: checkCompat,
    listClips: listClips,
    resolveClip: resolveClipInput,
    clipFromJSON: clipFromJSON,
    renderSection: renderSection,
    _test: {
      checkCompat: checkCompat,
      remapTrackName: remapTrackName,
      parseTrackName: parseTrackName,
      normalizeBoneName: normalizeBoneName,
      resolveClip: resolveClipInput,
      clipFromJSON: clipFromJSON,
      listClips: listClips,
      buildEntries: buildEntries,
      snapshotPose: snapshotPose,
      restorePose: restorePose,
      getState: getState
    }
  };

  var QR0 = (window.PixiStudio && PixiStudio.ArpQuickRig) || null;
  if (QR0) {
    QR0.LiveRetarget = LiveRetarget;
    /* hook đăng ký section — coordinator thêm sau; module chạy được
       cả khi chưa có hook (guard try/catch + typeof). */
    if (typeof QR0.registerSection === 'function') {
      try { QR0.registerSection('liveretarget', renderSection); } catch (e) {}
    }
  }
  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpQuickRig = window.PixiStudio.ArpQuickRig || {};
  window.PixiStudio.ArpQuickRig.LiveRetarget = LiveRetarget;
})();
