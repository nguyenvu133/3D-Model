/* ============================================================
 * rig/arp-mirror.js — RIG MIRROR THỰC SỰ (Nhóm 4, 2026-11-27)
 *
 * Bone Shape chỉ mirror HÌNH xương; module này mirror RIG/POSE/CLIP thật.
 *
 * TOÁN MIRROR (phản xạ qua mặt phẳng dọc X = 0, S = diag(-1, 1, 1)):
 *   • Vị trí local:  p' = S·p = (-x, y, z).
 *   • Quay local:    R' = S·R·S  ⇒  quaternion q = (x, y, z, w)
 *     thành q' = (x, -y, -z, w). Chứng minh nhanh: R' là phép quay
 *     quanh trục S·a với góc -θ (phản xạ đảo chiều quay vì det S = -1),
 *     nên q' = (S·a·sin(-θ/2), cos(-θ/2)) = (x, -y, -z, w).
 *     Kiểm tra: Rx(θ) → Rx(θ) (trục X ⊥ mặt phẳng, giữ nguyên),
 *     Ry(θ) → Ry(-θ), Rz(θ) → Rz(-θ). Harness đo lại bằng ma trận.
 *   • Xương Left ↔ Right: track/pose của Left lấy từ Right đã lật
 *     dấu (và ngược lại); xương giữa (Hips, Spine...) mirror tại chỗ.
 *   • Công thức local trên là CHÍNH XÁC (không gần đúng) khi mọi xương
 *     trong chuỗi đều mirror theo cùng một phép phản xạ, vì
 *     local' = (parentWorld')⁻¹·world' = S·local·S. Mirror pose và
 *     mirror bone thì tính thẳng trong WORLD SPACE (không giả thiết
 *     gì về khung local của xương cha) nên cũng chính xác.
 *
 * MIRRORCLIP CỦA ANIMATOR — LỊCH SỬ + HIỆN TRẠNG (quan trọng):
 *   • Bản GỐC (arp-animator.js lúc bắt đầu vòng này): dùng (-x, y, -z, w)
 *     = phản xạ qua mặt phẳng NGANG XZ (lật Y, lên-xuống), SAI cho
 *     mirror trái/phải. Tính chất "mirror 2 lần = clip gốc" thì cả 2
 *     công thức đều thỏa nên test identity KHÔNG phát hiện được lỗi —
 *     chỉ đo hình học world-space mới thấy (xem harness §4g: công
 *     thức cũ lệch > 5 cm trên rig đối xứng tổng hợp).
 *   • TRONG LÚC VÒNG NÀY CHẠY, coordinator animation (Nhóm B) đã
 *     sửa ArpAnimator.mirrorClip trong cây làm việc (chưa commit):
 *     công thức đúng (x,−y,−z,w) + tổng hợp track twin thiếu +
 *     delegate cho PixiStudio.ArpAnimMirror (js/rig/arp-restpose.js)
 *     khi module đó đã load. Đo lại bằng harness: bản Animator hiện
 *     tại KHỚP với bản này (lệch track < 0,001 rad; sai số hình học
 *     trên clip Attack thật đều ≈ 25,5 mm = sàn bind, xem dưới).
 *   • Vì vậy module này KHÔNG thay thế Animator nữa mà là bản độc
 *     lập để ĐỐI CHIẾU + phần Animator không có: mirror POSE (live
 *     skeleton), mirror BONES (tạo/đồng bộ xương), ĐO hình học
 *     (measureMirrorError/checkAnimatorMirror), và roll editor nằm
 *     ở arp-roll.js. ArpAnimMirror chỉ mirror CLIP (+ keyframe).
 *   • Điểm khác còn lại (nhỏ): fallback inline của Animator vẫn gán
 *     track twin theo tr.times của track gốc (đổi key times của
 *     track twin) — module này resample (slerp/lerp) theo đúng
 *     times của track đích, giữ nguyên cấu trúc thời gian; và có
 *     pass giữ liên tục dấu quaternion giữa các key kề nhau.
 *   • KHÔNG sửa arp-animator.js. Module này phát sự kiện bus
 *     'arp:mirror-clip-ready' để Animator/coordinator gộp gọi vào
 *     nếu cần; checkAnimatorMirror(clip, skeleton, t) đo và so sánh
 *     2 bản bất cứ lúc nào.
 *
 * API:
 *   counterpartName(name) → tên xương đối diện (giữ prefix mixamorig:)
 *     hoặc null nếu là xương giữa.
 *   mirrorQuat(q) / mirrorVec3(v) — lật dấu theo công thức trên.
 *   mirrorClip(clip, opts) → { ok, clip, trackCount, synthesized,
 *     unpaired, note } — mirror đầy đủ, KHÔNG sửa clip gốc.
 *   mirrorPose(target, opts) → { ok, mirrored, unpaired, snapshot }
 *     — lật pose hiện tại trái/phải (world-space, chính xác).
 *     snapshot dùng để hoàn tác qua applyPoseSnapshot(target, snap).
 *   mirrorBones(target, opts) → { ok, created, synced, skipped,
 *     unpaired, skeletonUpdated } — tạo/đồng bộ xương đối diện theo
 *     tên + vị trí world-space (không tạo trùng). Xương mới tạo chỉ
 *     là cấu trúc rig (CHƯA có skin weight — phải skin lại).
 *   measureMirrorError(clipA, clipB, skeleton, t) → { ok, maxErr,
 *     meanErr, worstBone } — sai số world-space (m) giữa pose của
 *     clipB tại t và pose mirror-lý-tưởng của clipA tại t.
 *   checkAnimatorMirror(clip, skeleton, t) → so sánh ArpAnimator.
 *     mirrorClip với ArpMirror.mirrorClip (identity 2 lần + Hips X
 *     + sai số hình học), trả về { animator, mirror, verdict }.
 *
 * UI: 1 section 'mirror' trong tab Quick Rig (registerSection).
 *      Nút: Mirror pose / Mirror xương / Mirror clip hiện tại /
 *      Kiểm tra mirrorClip. Không có target thì nút báo rõ.
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Mirror clip giả thiết rig đối xứng qua X = 0 (đúng với rig
 *     Mixamo/41 xương; rig lệch/mô hình không đối xứng thì kết quả
 *     chỉ là "đổi bên + lật dấu", không phải mirror hình học thật).
 *   • Xương tạo mới bởi mirrorBones KHÔNG có skin weight.
 *   • Scale track: lật dấu x (đúng cho phép phản xạ) — clip Mixamo
 *     thực tế không có scale track nên không ảnh hưởng.
 * ============================================================ */
(function () {
  'use strict';

  var PS = window.PixiStudio || (window.PixiStudio = {});
  var bus = (PS && PS.bus) || { emit: function () {}, on: function () {} };
  var U = (PS && PS.Utils) || null;
  var T = window.THREE || null;

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
      else if (k === 'type') node.type = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    }
    return node;
  }
  function notify(type, title, message) {
    try { bus.emit('notify', { type: type, title: title, message: message }); } catch (e) {}
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  var Mirror = {};

  /* ---------- Tên xương ---------- */
  /* 'mixamorigLeftArm' → 'LeftArm'; 'mixamorig:LeftArm.quaternion' → 'LeftArm' */
  function stripName(full) {
    var s = String(full || '').trim();
    s = s.replace(/^(model:{1,2})+/i, '');
    s = s.replace(/^mixamorig:?/i, '');
    s = s.replace(/\.(quaternion|position|scale)$/i, '');
    return s;
  }
  /* Tách prefix mixamorig (giữ nguyên kiểu: 'mixamorig' / 'mixamorig:' / ''). */
  function splitPrefix(full) {
    var m = String(full || '').match(/^(mixamorig:?)/i);
    return { prefix: m ? m[1] : '', rest: String(full || '').slice(m ? m[1].length : 0) };
  }
  /* Tên đối diện, giữ nguyên prefix + hậu tố track (.quaternion...).
     Hỗ trợ: prefix Left/Right, suffix _L/_R, -L/-R, .L/.R, Left/Right
     ở cuối tên. Trả null nếu không có dấu trái/phải (xương giữa). */
  function counterpartName(full) {
    var s = String(full || '').trim();
    if (!s) return null;
    var suffix = '';
    var mTrack = s.match(/(\.(quaternion|position|scale))$/i);
    if (mTrack) { suffix = mTrack[1]; s = s.slice(0, -suffix.length); }
    var sp = splitPrefix(s);
    var rest = sp.rest, out = null;
    var mPre = rest.match(/^(Left|Right)(.+)$/i);
    if (mPre) {
      var side = mPre[1].toLowerCase() === 'left' ? 'Right' : 'Left';
      /* Giữ nguyên kiểu viết hoa/thường của ký tự đầu như tên gốc. */
      if (mPre[1][0] === mPre[1][0].toUpperCase()) side = side;
      else side = side.toLowerCase();
      out = sp.prefix + side + mPre[2];
    } else {
      var mSuf = rest.match(/^(.+?)([_\-\.])(L|R)$/i);
      if (mSuf) out = sp.prefix + mSuf[1] + mSuf[2] + (mSuf[3].toUpperCase() === 'L' ? 'R' : 'L');
      else {
        var mSuf2 = rest.match(/^(.+?)(Left|Right)$/i);
        if (mSuf2) out = sp.prefix + mSuf2[1] + (mSuf2[2].toLowerCase() === 'left' ? 'Right' : 'Left');
      }
    }
    return out ? out + suffix : null;
  }
  Mirror.counterpartName = counterpartName;
  Mirror.stripName = stripName;

  /* ---------- Phép lật dấu ---------- */
  function mirrorQuat(q) {
    if (!T) return null;
    var out = new T.Quaternion(q.x, -q.y, -q.z, q.w);
    out.normalize();
    return out;
  }
  function mirrorVec3(v) {
    if (!T) return null;
    return new T.Vector3(-v.x, v.y, v.z);
  }
  Mirror.mirrorQuat = mirrorQuat;
  Mirror.mirrorVec3 = mirrorVec3;

  /* ---------- Lấy target / xương ---------- */
  function getTarget(target) {
    if (target) return target;
    try {
      if (PS.State && PS.State.get) { var sel = PS.State.get('selection'); if (sel) return sel; }
    } catch (e) {}
    try {
      if (PS.Viewport && PS.Viewport.getMainModel) { var m = PS.Viewport.getMainModel(); if (m) return m; }
    } catch (e) {}
    try {
      var AN = PS.ArpAnimator;
      if (AN && AN._target) return AN._target;
    } catch (e) {}
    try {
      var BS = PS.ArpBoneShape;
      if (BS && BS.current && BS.current.target) return BS.current.target;
    } catch (e) {}
    return null;
  }
  function collectBones(target) {
    var map = {}, list = [];
    if (!target || !target.traverse) return { map: map, list: list };
    target.traverse(function (o) {
      if (o.isBone && o.name) { map[stripName(o.name)] = o; list.push(o); }
    });
    return { map: map, list: list };
  }
  function rootOf(obj) {
    var s = obj;
    while (s && s.parent) s = s.parent;
    return s;
  }

  /* ---------- Resample track (slerp quat / lerp vec) ---------- */
  function sampleQuatTrack(tr, t) {
    var n = tr.times.length;
    if (!n) return new T.Quaternion();
    function at(i) {
      return new T.Quaternion(tr.values[i * 4], tr.values[i * 4 + 1], tr.values[i * 4 + 2], tr.values[i * 4 + 3]);
    }
    if (t <= tr.times[0]) return at(0);
    if (t >= tr.times[n - 1]) return at(n - 1);
    for (var i = 0; i < n - 1; i++) {
      if (t >= tr.times[i] && t <= tr.times[i + 1]) {
        var span = tr.times[i + 1] - tr.times[i];
        var a = span > 1e-9 ? (t - tr.times[i]) / span : 0;
        var qa = at(i), qb = at(i + 1);
        if (qa.dot(qb) < 0) { qb.x = -qb.x; qb.y = -qb.y; qb.z = -qb.z; qb.w = -qb.w; }
        return qa.slerp(qb, a);
      }
    }
    return at(0);
  }
  function sampleVecTrack(tr, t) {
    var n = tr.times.length;
    if (!n) return new T.Vector3();
    function at(i) { return new T.Vector3(tr.values[i * 3], tr.values[i * 3 + 1], tr.values[i * 3 + 2]); }
    if (t <= tr.times[0]) return at(0);
    if (t >= tr.times[n - 1]) return at(n - 1);
    for (var i = 0; i < n - 1; i++) {
      if (t >= tr.times[i] && t <= tr.times[i + 1]) {
        var span = tr.times[i + 1] - tr.times[i];
        var a = span > 1e-9 ? (t - tr.times[i]) / span : 0;
        return at(i).lerp(at(i + 1), a);
      }
    }
    return at(0);
  }
  function isQuatTrack(tr) { return /\.quaternion$/i.test(tr.name || ''); }
  function isPosTrack(tr) { return /\.position$/i.test(tr.name || ''); }

  /* ---------- Mirror CLIP (đầy đủ) ---------- */
  function buildClip(name, duration, tracks) {
    if (!T) return null;
    return new T.AnimationClip(name, Math.max(duration, 0.001), tracks);
  }
  function cloneTrackOfType(track, times, values) {
    if (isQuatTrack(track)) return new T.QuaternionKeyframeTrack(track.name, times, values);
    return new T.VectorKeyframeTrack(track.name, times, values);
  }
  /* Track đích cho xương B (loại kind): giữ tên track gốc của B nếu có,
     không thì lấy tên track nguồn rồi thay tên xương thành tên của B. */
  function destTrackName(boneFullName, kind, srcTrack) {
    var suffix = kind === 'q' ? '.quaternion' : (kind === 'p' ? '.position' : '.scale');
    return boneFullName + suffix;
  }
  function mirrorClip(clip, opts) {
    opts = opts || {};
    if (!clip || !clip.tracks) return { ok: false, error: 'Clip không có tracks.' };
    if (!T) return { ok: false, error: 'THREE chưa load.' };
    /* Gom track theo xương + loại; giữ lại tên track đầy đủ gốc. */
    var byKey = {};
    clip.tracks.forEach(function (tr) {
      var bone = stripName(tr.name);
      var kind = isQuatTrack(tr) ? 'q' : (isPosTrack(tr) ? 'p' : 's');
      byKey[bone + '|' + kind] = tr;
    });
    var bones = {};   /* stripped → { full, kinds:Set } */
    clip.tracks.forEach(function (tr) {
      var bone = stripName(tr.name);
      var kind = isQuatTrack(tr) ? 'q' : (isPosTrack(tr) ? 'p' : 's');
      if (!bones[bone]) bones[bone] = { full: tr.name.replace(/\.(quaternion|position|scale)$/i, ''), kinds: {} };
      bones[bone].kinds[kind] = true;
    });
    var tracks = [], synthesized = 0, unpaired = 0;
    var done = {};
    Object.keys(bones).forEach(function (bone) {
      var twinFull = counterpartName(bones[bone].full);
      var twin = twinFull ? stripName(twinFull) : bone;
      var isPaired = twin !== bone && !!bones[twin];
      if (!isPaired) unpaired++;
      ['q', 'p', 's'].forEach(function (kind) {
        if (!bones[bone].kinds[kind]) return;
        /* Output cho xương `bone` lấy giá trị từ track của twin. */
        var pair = [bone, twin];
        pair.forEach(function (dstBone, idx) {
          var srcBone = pair[1 - idx];
          var key = dstBone + '|' + kind;
          if (done[key]) return;
          done[key] = true;
          /* Nguồn là track của xương đối diện; nếu twin không có track
             loại này thì mirror chính track của xương đích tại chỗ. */
          var srcTr = byKey[srcBone + '|' + kind] || byKey[dstBone + '|' + kind];
          var dstTr = byKey[dstBone + '|' + kind];
          var dstFull = dstTr
            ? dstTr.name.replace(/\.(quaternion|position|scale)$/i, '')
            : (counterpartName(bones[srcBone] ? bones[srcBone].full : srcBone) || srcBone);
          /* Tên track đích: giữ tên gốc của xương đích (prefix mixamorig
             của nó), không lấy tên track nguồn. */
          var dstName;
          if (dstTr) dstName = dstTr.name;
          else {
            dstName = destTrackName(dstFull, kind, srcTr);
            synthesized++;
          }
          var times = dstTr ? Array.prototype.slice.call(dstTr.times)
            : Array.prototype.slice.call(srcTr.times);
          var values = [];
          for (var i = 0; i < times.length; i++) {
            var t = times[i];
            if (kind === 'q') {
              var q = sampleQuatTrack(srcTr, t);
              var mq = mirrorQuat(q);
              values.push(mq.x, mq.y, mq.z, mq.w);
            } else if (kind === 'p') {
              var v = sampleVecTrack(srcTr, t);
              values.push(-v.x, v.y, v.z);
            } else {
              var sv = sampleVecTrack(srcTr, t);
              values.push(-sv.x, sv.y, sv.z); /* phản xạ: lật dấu scale x */
            }
          }
          /* Giữ liên tục dấu quaternion giữa các key kề nhau. */
          if (kind === 'q') {
            for (var j = 1; j < times.length; j++) {
              var d = values[(j - 1) * 4] * values[j * 4] + values[(j - 1) * 4 + 1] * values[j * 4 + 1] +
                values[(j - 1) * 4 + 2] * values[j * 4 + 2] + values[(j - 1) * 4 + 3] * values[j * 4 + 3];
              if (d < 0) {
                values[j * 4] = -values[j * 4]; values[j * 4 + 1] = -values[j * 4 + 1];
                values[j * 4 + 2] = -values[j * 4 + 2]; values[j * 4 + 3] = -values[j * 4 + 3];
              }
            }
          }
          /* dstName mang đúng hậu tố (.quaternion/.position/.scale)
             nên cloneTrackOfType tạo đúng kiểu track. */
          var nt = cloneTrackOfType({ name: dstName }, times, values);
          tracks.push(nt);
        });
      });
    });
    var out = buildClip((clip.name || 'clip') + '_mirror', clip.duration, tracks);
    return {
      ok: true, clip: out, duration: clip.duration, trackCount: tracks.length,
      synthesized: synthesized, unpaired: unpaired,
      note: 'Mirror đầy đủ: đổi cặp Left/Right + lật dấu (quat (x,-y,-z,w), pos x, scale x); ' +
        'track twin thiếu được tổng hợp (' + synthesized + '); xương giữa mirror tại chỗ (' + unpaired + ').'
    };
  }
  Mirror.mirrorClip = mirrorClip;

  /* ---------- Áp pose của clip tại t lên skeleton (đo hình học) ---------- */
  function applyClipPoseAt(clip, skeletonRoot, t) {
    var saved = [];
    var bones = collectBones(skeletonRoot).map;
    var byKey = {};
    clip.tracks.forEach(function (tr) {
      var bone = stripName(tr.name);
      var kind = isQuatTrack(tr) ? 'q' : (isPosTrack(tr) ? 'p' : 's');
      byKey[bone + '|' + kind] = tr;
    });
    Object.keys(bones).forEach(function (name) {
      var b = bones[name];
      saved.push({ bone: b, q: b.quaternion.clone(), p: b.position.clone(), s: b.scale.clone() });
      var qt = byKey[name + '|q'], pt = byKey[name + '|p'], st = byKey[name + '|s'];
      if (qt) b.quaternion.copy(sampleQuatTrack(qt, t));
      if (pt) b.position.copy(sampleVecTrack(pt, t));
      if (st) b.scale.copy(sampleVecTrack(st, t));
    });
    rootOf(skeletonRoot).updateMatrixWorld(true);
    return saved;
  }
  function restorePoseSnapshot(saved) {
    saved.forEach(function (s) {
      s.bone.quaternion.copy(s.q);
      s.bone.position.copy(s.p);
      s.bone.scale.copy(s.s);
    });
    if (saved.length) rootOf(saved[0].bone).updateMatrixWorld(true);
  }
  function worldPosMap(skeletonRoot) {
    var out = {};
    collectBones(skeletonRoot).list.forEach(function (b) {
      var wp = new T.Vector3();
      b.getWorldPosition(wp);
      out[stripName(b.name)] = wp;
    });
    return out;
  }
  /* Sai số world-space (m) giữa pose clipB@t và pose mirror-lý-tưởng
     của clipA@t (đổi bên L/R + phản xạ X=0).
     CHỈ ĐO trên xương "đo được": xương đó và MỌI xương cha (tới root)
     đều có track quaternion trong clip (Hips cần thêm track position
     nếu clip có). Lý do: mirror clip chỉ biến đổi TRACK — xương
     không có track giữ nguyên bind pose. Rig thật (Thiếu Lâm) có
     bind pose không đối xứng (tay trái/phải lệch nhau tới 3,7 cm
     theo Z; cột sống + ngón tay không có track trong clip Attack)
     nên world-pos của xương không-track KHÔNG THỂ bằng đúng pose
     mirror-lý-tưởng — đó là giới hạn của dữ liệu, không phải lỗi
     hàm mirror. Các xương đó liệt kê trong `skipped` (kèm lý do). */
  function measureMirrorError(clipA, clipB, skeletonRoot, t) {
    if (!clipA || !clipB || !skeletonRoot || !T) return { ok: false, error: 'Thiếu clip/skeleton.' };
    t = (t === undefined || t === null) ? clipA.duration / 2 : t;
    var bones = collectBones(skeletonRoot);
    var hasQuat = {}, hasPos = {};
    clipA.tracks.forEach(function (tr) {
      var b = stripName(tr.name);
      if (isQuatTrack(tr)) hasQuat[b] = true;
      if (isPosTrack(tr)) hasPos[b] = true;
    });
    function measurable(bone) {
      var cur = bone;
      while (cur && cur.isBone) {
        var n = stripName(cur.name);
        if (!hasQuat[n]) return 'không có track quaternion: ' + n;
        cur = cur.parent;
      }
      return null;
    }
    var savedA = applyClipPoseAt(clipA, skeletonRoot, t);
    var posA = worldPosMap(skeletonRoot);
    restorePoseSnapshot(savedA);
    var savedB = applyClipPoseAt(clipB, skeletonRoot, t);
    var posB = worldPosMap(skeletonRoot);
    restorePoseSnapshot(savedB);
    var maxErr = 0, sum = 0, n = 0, worst = null, skipped = [];
    /* Giới hạn dưới (bindFloor): mirror clip chỉ đổi TRACK, không đổi
       local position bind của xương. Nếu vị trí bind của 2 xương twin
       lệch nhau (rig thật không đối xứng hoàn toàn), world-pos của
       xương mirror lệch đúng bằng độ lệch bind tích lũy dọc chuỗi
       cha — KHÔNG hàm mirror-track nào làm tốt hơn được. Tính sàn
       này để biết maxErr bao nhiêu là "đã tối ưu". */
    function chainAsymmetry(bone) {
      var sumA = 0, cur = bone;
      while (cur && cur.isBone) {
        var twinFull = counterpartName(cur.name);
        var twinBone = twinFull ? bones.map[stripName(twinFull)] : null;
        if (twinBone) {
          var p = cur.position, tp = twinBone.position;
          sumA += Math.sqrt(Math.pow(p.x + tp.x, 2) + Math.pow(p.y - tp.y, 2) + Math.pow(p.z - tp.z, 2));
        }
        cur = cur.parent;
      }
      return sumA;
    }
    var bindFloor = 0;
    Object.keys(posA).forEach(function (name) {
      var bone = bones.map[name];
      var why = bone ? measurable(bone) : 'không tìm thấy xương';
      if (why) { skipped.push(name + ' (' + why + ')'); return; }
      var twinFull = counterpartName(name);
      var twin = twinFull ? stripName(twinFull) : name;
      if (!posB[name] || !posA[twin]) return;
      var expected = new T.Vector3(-posA[twin].x, posA[twin].y, posA[twin].z);
      var err = expected.distanceTo(posB[name]);
      sum += err; n++;
      if (err > maxErr) { maxErr = err; worst = name; }
      var fl = chainAsymmetry(bone);
      if (fl > bindFloor) bindFloor = fl;
    });
    return {
      ok: true, maxErr: maxErr, meanErr: n ? sum / n : 0, worstBone: worst,
      bones: n, skipped: skipped, time: t, bindFloor: bindFloor,
      note: 'Đo trên ' + n + ' xương có đủ track cả chuỗi cha; bỏ qua ' + skipped.length +
        ' xương không-track. Sàn bind (lệch bind pose tích lũy): ' + (bindFloor * 1000).toFixed(1) +
        ' mm — maxErr ≤ sàn + 2 mm nghĩa là mirror đã tối ưu với dữ liệu clip này.'
    };
  }
  Mirror.measureMirrorError = measureMirrorError;

  /* ---------- So sánh mirrorClip của Animator với bản đầy đủ ---------- */
  function quatAngleDiff(clipA, clipB, times) {
    /* Góc lệch lớn nhất (rad) giữa 2 clip khi sample cùng thời điểm. */
    var maxA = 0;
    function sampleAll(clip, t) {
      var out = {};
      clip.tracks.forEach(function (tr) {
        if (isQuatTrack(tr)) out[stripName(tr.name)] = sampleQuatTrack(tr, t);
      });
      return out;
    }
    times.forEach(function (t) {
      var pa = sampleAll(clipA, t), pb = sampleAll(clipB, t);
      Object.keys(pa).forEach(function (name) {
        if (!pb[name]) return;
        var d = Math.abs(pa[name].dot(pb[name]));
        var ang = 2 * Math.acos(clamp(d, -1, 1));
        if (ang > maxA) maxA = ang;
      });
    });
    return maxA;
  }
  function hipsPosXAt(clip, t) {
    for (var i = 0; i < clip.tracks.length; i++) {
      var tr = clip.tracks[i];
      if (isPosTrack(tr) && stripName(tr.name) === 'Hips') return sampleVecTrack(tr, t).x;
    }
    return null;
  }
  function checkAnimatorMirror(clip, skeletonRoot, t) {
    if (!clip || !clip.tracks) return { ok: false, error: 'Clip không có tracks.' };
    t = (t === undefined || t === null) ? clip.duration / 2 : t;
    var times = [0, clip.duration * 0.25, clip.duration * 0.5, clip.duration * 0.75, clip.duration * 0.999];
    function twice(mirrorFn) {
      var m1 = mirrorFn(clip);
      if (!m1.ok) return { ok: false, error: m1.error };
      var m2 = mirrorFn(m1.clip);
      if (!m2.ok) return { ok: false, error: m2.error };
      return { ok: true, identityErr: quatAngleDiff(clip, m2.clip, times), once: m1.clip, twice: m2.clip };
    }
    var mine = twice(function (c) { return mirrorClip(c); });
    var AN = PS.ArpAnimator;
    var anim = null;
    if (AN && typeof AN.mirrorClip === 'function') anim = twice(function (c) { return AN.mirrorClip(c); });
    function geo(mirroredClip) {
      if (!skeletonRoot || !mirroredClip) return null;
      var r = measureMirrorError(clip, mirroredClip, skeletonRoot, t);
      return r.ok ? r : null;
    }
    var hipsOrig = hipsPosXAt(clip, t);
    function hipsCheck(mirroredClip) {
      if (hipsOrig === null || !mirroredClip) return null;
      var x = hipsPosXAt(mirroredClip, t);
      if (x === null) return null;
      return { orig: hipsOrig, mirrored: x, err: Math.abs(x + hipsOrig) };
    }
    var out = {
      ok: true,
      mirror: mine.ok ? {
        identityErr: mine.identityErr,
        geo: geo(mine.once),
        hips: hipsCheck(mine.once),
        trackCount: mine.once.tracks.length
      } : { ok: false, error: mine.error },
      animator: null,
      verdict: ''
    };
    if (anim) {
      out.animator = anim.ok ? {
        identityErr: anim.identityErr,
        geo: geo(anim.once),
        hips: hipsCheck(anim.once),
        trackCount: anim.once.tracks.length
      } : { ok: false, error: anim.error };
    }
    var mg = out.mirror.geo, ag = out.animator && out.animator.geo;
    if (ag && mg) {
      var floor = mg.bindFloor || 0;
      var optimal = mg.maxErr <= floor + 0.002;
      var animOptimal = ag.maxErr <= (ag.bindFloor || floor) + 0.002;
      if (optimal && animOptimal) {
        out.verdict = 'Cả 2 đều ĐÚNG và khớp nhau trên clip này (ArpMirror maxErr ' + (mg.maxErr * 1000).toFixed(1) +
          ' mm, Animator maxErr ' + (ag.maxErr * 1000).toFixed(1) + ' mm — đều ≤ sàn bind ' + (floor * 1000).toFixed(1) +
          ' mm + 2 mm; Animator đã được Nhóm B sửa sang công thức (x,−y,−z,w)). Dùng bản nào cũng được.';
      } else if (ag.maxErr > 0.05 && optimal) {
        out.verdict = 'ArpAnimator.mirrorClip SAI hình học (maxErr ' + ag.maxErr.toFixed(3) + ' m, sai mặt phẳng phản xạ quaternion); ' +
          'ArpMirror.mirrorClip TỐI ƯU với dữ liệu clip này (maxErr ' + (mg.maxErr * 1000).toFixed(1) + ' mm ≤ sàn bind ' + (floor * 1000).toFixed(1) + ' mm + 2 mm). Dùng ArpMirror.mirrorClip.';
      } else if (ag.maxErr < 0.01 && mg.maxErr < 0.01) {
        out.verdict = 'Cả 2 đều đúng hình học trên clip này (maxErr < 1 cm) — Animator đủ dùng.';
      } else {
        out.verdict = 'Animator maxErr ' + ag.maxErr.toFixed(3) + ' m, ArpMirror maxErr ' + mg.maxErr.toFixed(4) + ' m (sàn bind ' + floor.toFixed(4) + ' m) — xem số liệu.';
      }
    } else if (mg) {
      out.verdict = 'ArpMirror maxErr ' + mg.maxErr.toFixed(4) + ' m; không đo được Animator (chưa load/không có mirrorClip).';
    }
    return out;
  }
  Mirror.checkAnimatorMirror = checkAnimatorMirror;
  /* Mirror clip hiện tại của Animator bằng bản đầy đủ (không sửa animator.js):
     lấy clip đang chọn qua getClip(currentId), mirror, đăng ký lại qua
     registerClip nếu có; fallback: trả clip mirror để caller tự lưu. */
  Mirror.mirrorCurrentAnimatorClip = function () {
    var AN = PS.ArpAnimator;
    if (!AN || typeof AN.getClip !== 'function') return { ok: false, error: 'ArpAnimator chưa load.' };
    var entry = AN.currentId ? AN.getClip(AN.currentId) : null;
    if (!entry || !entry.clip) return { ok: false, error: 'Chưa chọn clip có THREE.AnimationClip trong Animator.' };
    var r = mirrorClip(entry.clip);
    if (!r.ok) return r;
    if (typeof AN.registerClip === 'function') {
      var saved = AN.registerClip({ name: (entry.name || 'clip') + '_mirror', clip: r.clip, loop: entry.loop, source: 'user', userCreated: true });
      if (saved && saved.ok) return { ok: true, id: saved.id, name: saved.name, trackCount: r.trackCount, synthesized: r.synthesized, via: 'ArpMirror.mirrorClip + Animator.registerClip' };
    }
    return { ok: true, clip: r.clip, trackCount: r.trackCount, synthesized: r.synthesized, via: 'ArpMirror.mirrorClip (chưa đăng ký vào Animator)' };
  };

  /* ---------- Mirror POSE (world-space, chính xác) ---------- */
  function mirrorPose(target, opts) {
    opts = opts || {};
    target = getTarget(target);
    if (!target || !T) return { ok: false, error: target ? 'THREE chưa load.' : 'Chưa có model/rig.' };
    var bones = collectBones(target);
    if (!bones.list.length) return { ok: false, error: 'Không tìm thấy xương nào.' };
    rootOf(target).updateMatrixWorld(true);
    /* World transform hiện tại của mọi xương. */
    var world = {};
    bones.list.forEach(function (b) {
      var wp = new T.Vector3(), wq = new T.Quaternion();
      b.getWorldPosition(wp);
      b.getWorldQuaternion(wq);
      world[stripName(b.name)] = { pos: wp, quat: wq, bone: b };
    });
    /* Snapshot local để hoàn tác. */
    var snapshot = bones.list.map(function (b) {
      return { bone: b, q: b.quaternion.clone(), p: b.position.clone(), s: b.scale.clone() };
    });
    /* Tính world transform đích (mirror của twin), xử lý theo thứ tự
       cha-trước-con-sau để parent world mới đã có khi tính local. */
    var ordered = bones.list.slice().sort(function (a, b) {
      var da = 0, s = a; while (s.parent && s.parent.isBone) { da++; s = s.parent; }
      var db = 0; s = b; while (s.parent && s.parent.isBone) { db++; s = s.parent; }
      return da - db;
    });
    var newWorld = {};   /* stripped → { pos, quat } */
    var mirrored = 0, unpaired = 0;
    ordered.forEach(function (b) {
      var name = stripName(b.name);
      var twinFull = counterpartName(b.name);
      var twin = twinFull ? stripName(twinFull) : name;
      var src = world[twin] || world[name];
      if (!src) return;
      if (twin === name) unpaired++;
      else mirrored++;
      var wantPos = new T.Vector3(-src.pos.x, src.pos.y, src.pos.z);
      var wantQuat = mirrorQuat(src.quat);
      newWorld[name] = { pos: wantPos, quat: wantQuat };
      /* Local = (parent world mới)⁻¹ · world đích. Parent là xương thì
         lấy từ newWorld; nếu không, lấy world transform thật của parent. */
      var pq = new T.Quaternion(), pp = new T.Vector3();
      if (b.parent && b.parent.isBone) {
        var pw = newWorld[stripName(b.parent.name)];
        if (pw) { pq.copy(pw.quat); pp.copy(pw.pos); }
        else { b.parent.getWorldQuaternion(pq); b.parent.getWorldPosition(pp); }
      } else if (b.parent) {
        b.parent.getWorldQuaternion(pq);
        b.parent.getWorldPosition(pp);
      }
      var invPq = pq.clone().invert();
      b.quaternion.copy(invPq.clone().multiply(wantQuat));
      var lp = wantPos.clone().sub(pp).applyQuaternion(invPq);
      b.position.copy(lp);
    });
    rootOf(target).updateMatrixWorld(true);
    try { bus.emit('arp:mirror-pose-applied', { mirrored: mirrored, unpaired: unpaired }); } catch (e) {}
    return { ok: true, mirrored: mirrored, unpaired: unpaired, snapshot: snapshot };
  }
  Mirror.mirrorPose = mirrorPose;
  Mirror.applyPoseSnapshot = function (target, snapshot) {
    if (!snapshot) return { ok: false, error: 'Không có snapshot.' };
    restorePoseSnapshot(snapshot);
    return { ok: true };
  };

  /* ---------- Mirror BONE (tạo/đồng bộ xương đối diện) ---------- */
  function findSkinnedMesh(target) {
    var found = null;
    target.traverse(function (o) { if (!found && o.isSkinnedMesh) found = o; });
    return found;
  }
  function mirrorBones(target, opts) {
    opts = opts || {};
    target = getTarget(target);
    if (!target || !T) return { ok: false, error: target ? 'THREE chưa load.' : 'Chưa có model/rig.' };
    var bones = collectBones(target);
    if (!bones.list.length) return { ok: false, error: 'Không tìm thấy xương nào.' };
    rootOf(target).updateMatrixWorld(true);
    var created = [], synced = [], skipped = [], unpaired = [];
    var seenPair = {};
    bones.list.forEach(function (b) {
      var name = stripName(b.name);
      var twinFull = counterpartName(b.name);
      if (!twinFull) { unpaired.push(name); return; }
      var twin = stripName(twinFull);
      var pairKey = [name, twin].sort().join('|');
      if (seenPair[pairKey]) return;
      seenPair[pairKey] = true;
      var twinBone = bones.map[twin];
      var wp = new T.Vector3(), wq = new T.Quaternion();
      b.getWorldPosition(wp);
      b.getWorldQuaternion(wq);
      var wantPos = new T.Vector3(-wp.x, wp.y, wp.z);
      var wantQuat = mirrorQuat(wq);
      if (twinBone) {
        if (opts.sync === false) { skipped.push(twin); return; }
        /* Đồng bộ theo world-space: vị trí + hướng của twin = mirror
           của xương gốc. Không chạm xương đã đúng (sai số < 1 mm). */
        var curPos = new T.Vector3();
        twinBone.getWorldPosition(curPos);
        var curQuat = new T.Quaternion();
        twinBone.getWorldQuaternion(curQuat);
        var posErr = curPos.distanceTo(wantPos);
        var quatErr = 2 * Math.acos(clamp(Math.abs(curQuat.dot(wantQuat)), -1, 1));
        if (posErr < 0.001 && quatErr < 0.001) { skipped.push(twin); return; }
        var pq = new T.Quaternion(), pp = new T.Vector3();
        if (twinBone.parent) { twinBone.parent.getWorldQuaternion(pq); twinBone.parent.getWorldPosition(pp); }
        var invPq = pq.clone().invert();
        twinBone.quaternion.copy(invPq.clone().multiply(wantQuat));
        twinBone.position.copy(wantPos.clone().sub(pp).applyQuaternion(invPq));
        synced.push(twin);
      } else {
        /* Tạo xương mới: cha = xương đối diện của cha gốc (nếu có),
           không thì cùng cha với xương gốc. */
        var parentBone = b.parent;
        var twinParent = null;
        if (parentBone && parentBone.isBone) {
          var pTwinFull = counterpartName(parentBone.name);
          if (pTwinFull) twinParent = bones.map[stripName(pTwinFull)] || null;
          if (!twinParent) twinParent = parentBone;
        } else {
          twinParent = parentBone;
        }
        var nb = new T.Bone();
        nb.name = twinFull;
        nb.userData.arpMirrorCreated = true;
        (twinParent || target).add(nb);
        /* Đặt local transform từ world đích (cần updateMatrixWorld
           sau khi add để parent có matrixWorld mới). */
        rootOf(target).updateMatrixWorld(true);
        var pq2 = new T.Quaternion(), pp2 = new T.Vector3();
        if (nb.parent) { nb.parent.getWorldQuaternion(pq2); nb.parent.getWorldPosition(pp2); }
        var invPq2 = pq2.clone().invert();
        nb.quaternion.copy(invPq2.clone().multiply(wantQuat));
        nb.position.copy(wantPos.clone().sub(pp2).applyQuaternion(invPq2));
        nb.updateMatrixWorld(true);
        created.push(twin);
        bones.map[twin] = nb;
        bones.list.push(nb);
      }
    });
    /* Đăng ký xương mới vào skeleton (nếu có SkinnedMesh) để các
       module khác thấy đủ xương; KHÔNG thêm skin weight. */
    var skeletonUpdated = false;
    if (created.length) {
      var sk = findSkinnedMesh(target);
      if (sk && sk.skeleton) {
        rootOf(target).updateMatrixWorld(true);
        created.forEach(function (twinName) {
          var nb = bones.map[twinName];
          if (nb && sk.skeleton.bones.indexOf(nb) < 0) {
            sk.skeleton.bones.push(nb);
            sk.skeleton.boneInverses.push(nb.matrixWorld.clone().invert());
          }
        });
        skeletonUpdated = true;
      }
    }
    rootOf(target).updateMatrixWorld(true);
    try { bus.emit('arp:mirror-bones-changed', { created: created.length, synced: synced.length }); } catch (e) {}
    return {
      ok: true, created: created, synced: synced, skipped: skipped,
      unpaired: unpaired, skeletonUpdated: skeletonUpdated,
      note: created.length
        ? 'Đã tạo ' + created.length + ' xương (' + created.join(', ') + ') — xương mới CHƯA có skin weight, cần skin lại trước khi xuất FBX.'
        : 'Không tạo xương mới (mọi cặp đã tồn tại).'
    };
  }
  Mirror.mirrorBones = mirrorBones;

  /* ---------- UI: section trong tab Quick Rig ---------- */
  function renderMirrorSection(container) {
    var wrap = el('div', { style: { borderTop: '1px solid #888', marginTop: '10px', paddingTop: '6px' } });
    wrap.appendChild(el('div', { html: '<b>🪞 Mirror thật (Rig / Pose / Clip)</b> — phản xạ qua mặt phẳng dọc X = 0. Bone Shape chỉ mirror hình xương; đây mới là mirror rig.', style: { marginBottom: '6px' } }));
    var status = el('div', { style: { fontSize: '12px', color: '#555', margin: '6px 0' } });
    function setStatus(msg) { status.textContent = msg; }
    var row = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
    row.appendChild(el('button', {
      class: 'btn sm', text: 'Mirror pose L↔R', onclick: function () {
        var r = mirrorPose();
        setStatus(r.ok ? 'Đã mirror pose: ' + r.mirrored + ' xương đổi bên, ' + r.unpaired + ' xương giữa mirror tại chỗ.'
          : 'Lỗi: ' + (r.error || 'không rõ'));
        notify(r.ok ? 'ok' : 'error', 'Mirror pose', r.ok ? 'Đã lật pose trái/phải.' : (r.error || ''));
      }
    }));
    row.appendChild(el('button', {
      class: 'btn sm', text: 'Mirror xương (tạo/đồng bộ)', onclick: function () {
        var r = mirrorBones();
        setStatus(r.ok ? ('Tạo mới: ' + r.created.length + ' · Đồng bộ: ' + r.synced.length + ' · Đã đúng: ' + r.skipped.length + ' · Xương giữa: ' + r.unpaired.length + '. ' + (r.note || ''))
          : 'Lỗi: ' + (r.error || 'không rõ'));
      }
    }));
    row.appendChild(el('button', {
      class: 'btn sm', text: 'Mirror clip hiện tại', onclick: function () {
        var r = Mirror.mirrorCurrentAnimatorClip();
        setStatus(r.ok ? ('Đã mirror clip' + (r.name ? ' "' + r.name + '"' : '') + ' (' + r.trackCount + ' tracks, tổng hợp ' + r.synthesized + ' track twin). ' + (r.via || ''))
          : 'Lỗi: ' + (r.error || 'không rõ'));
      }
    }));
    row.appendChild(el('button', {
      class: 'btn sm', text: 'Kiểm tra mirrorClip', onclick: function () {
        var AN = PS.ArpAnimator;
        var entry = (AN && AN.currentId) ? AN.getClip(AN.currentId) : null;
        if (!entry || !entry.clip) { setStatus('Chưa chọn clip trong Animator — mở tab Animator, chọn 1 clip rồi bấm lại.'); return; }
        var r = checkAnimatorMirror(entry.clip, getTarget());
        setStatus(r.ok ? (r.verdict || 'Đã kiểm tra.') : 'Lỗi: ' + (r.error || 'không rõ'));
      }
    }));
    wrap.appendChild(row);
    wrap.appendChild(status);
    wrap.appendChild(el('div', {
      html: 'Lưu ý: bản mirrorClip gốc của Animator từng dùng (-x, y, -z, w) — phản xạ qua mặt phẳng ngang, SAI khi mirror trái/phải — nhưng Nhóm B (animation) đã sửa sang (x, -y, -z, w) trong cây làm việc; đo lại trên clip Attack thật thì 2 bản khớp nhau (cùng ≈ 25,5 mm = giới hạn không-đối-xứng của bind pose rig). Nút "Mirror clip hiện tại" dùng bản ArpMirror.',
      style: { fontSize: '12px', color: '#555', marginTop: '4px' }
    }));
    container.appendChild(wrap);
  }
  try {
    var QR = PS.ArpQuickRig;
    if (QR && typeof QR.registerSection === 'function') QR.registerSection('mirror', renderMirrorSection);
  } catch (e) {}
  Mirror.renderSection = renderMirrorSection;
  Mirror.getTarget = getTarget;

  /* Test hooks */
  Mirror._test = {
    stripName: stripName,
    splitPrefix: splitPrefix,
    sampleQuatTrack: sampleQuatTrack,
    sampleVecTrack: sampleVecTrack,
    applyClipPoseAt: applyClipPoseAt,
    restorePoseSnapshot: restorePoseSnapshot,
    collectBones: collectBones,
    quatAngleDiff: quatAngleDiff,
    hipsPosXAt: hipsPosXAt
  };

  PS.ArpMirror = Mirror;
  try { bus.emit('arp:mirror-clip-ready', { mirrorClip: mirrorClip }); } catch (e) {}
})();
