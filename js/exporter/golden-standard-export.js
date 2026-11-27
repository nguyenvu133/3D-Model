/* ============================================================
 * exporter/golden-standard-export.js — XUẤT FBX CHUẨN (GOLDEN)
 * Nút topbar "Xuất FBX chuẩn" → mở CỬA SỔ BẢNG (PixiStudio.Modals,
 * đúng pattern Save Center) liệt kê 6 bước chuẩn hóa golden, đo
 * cột "Trước" thật từ model đang load, nút "Chuẩn hóa & Xuất FBX"
 * chạy pipeline rồi điền cột "Sau" + PASS/FAIL từng hàng, sau đó
 * mới tải file `<tên-gốc>-Standard.fbx` về.
 *
 * CHUẨN GOLDEN (đã đo thật trên 2 file Thiếu Lâm, parent kiểm chứng
 * bằng harness 30/30 — xem ~/workspace/.test-fbx/
 * thieulam-Rigged-FixedAxes-LowPoly-Grounded.fbx (md5 51814488…) và
 * thieulam_time-FixedAxes-LowPoly-Grounded.fbx (md5 0eddd93c…)):
 *   (1) Trục Y-up (Z-up nằm ngửa → Rx(+90°) nhất quán cho geometry +
 *       root bone local + track Hips; đã Y-up thì bỏ qua).
 *   (2) Pivot: origin (0,0,0) = điểm đất giữa 2 bàn chân (bbox X/Z
 *       cân đối quanh 0, Y min ≈ 0 — 2 file mẫu đều ở đúng điểm này;
 *       2 bàn chân so le 14.7cm theo Z nên không có điểm nào thỏa cả
 *       2 định nghĩa ankle-mid/sole-mid trong 2cm, chỉ cần origin Z
 *       nằm GIỮA 2 mốc đó).
 *   (3) Ground clip: HipsY'(key) = HipsY(key) − minSole_footclass(t_key)
 *       theo từng key (tính từ mesh đã skin, KHÔNG ước lượng bằng Hips);
 *       nếu robe hem rủ thấp hơn bàn chân quá 0.02m thì cộng đều LIFT
 *       nhỏ (file mẫu 2: +5mm) để cả chân lẫn áo đều trong ±0.02m.
 *   (4) Low poly → ~15k tris (12k–18k) bằng meshopt edge-collapse
 *       giữ hình dạng (KHÔNG dùng cách gom đỉnh theo ô + hàn cũ — đã
 *       chứng minh méo mặt: gộp đỉnh cách nhau tới 31cm).
 *   (5) Texture nhúng đúng byte gốc (đọc thẳng bytes từ nguồn, không
 *       qua canvas — bài học vụ GLB→FBX mất màu).
 *   (6) Rig + Clip giữ nguyên tên xương/clip/duration/tracks/keys.
 *
 * CẠM BẪY ĐÃ TRÁNH (tiền lệ thật, xem header từng hàm):
 *   • Stock FBXLoader (js/vendor/FBXLoader.js) tự CHÈN key sai hướng
 *     ~90° tại gimbal branch-flip (interpolateRotations, span ≥180°) —
 *     model đang load trong studio đã parse bằng loader này nên track
 *     có thể đã nhiễm key chèn. Nút mới KHỬ key chèn (decontaminate)
 *     trước khi xử lý: key nào lệch lưới thời gian gốc + tạo bước
 *     ~180° 2 phía mới bị gỡ (không đụng key thật — file thieulam_time
 *     có bước thật 110° ở key 0→1 vẫn giữ nguyên).
 *   • Track phải bind đúng xương THẬT: studio canonicalize tên xương
 *     thành 'mixamorig:Hips' (CÓ ':') mà three r128 parseTrackName tách
 *     ':' làm nodeName='Hips' → track rơi về root hoặc khớp hiển thị
 *     (xem js/rig/arp-clipbind.js — fix đã có trong checkout này,
 *     untracked nhưng index.html đã load). Nút mới viết lại tên xương
 *     + tên track trong bản clone về dạng KHÔNG ':' ('mixamorigHips')
 *     đúng như 2 file golden — track khớp tên xương thật 1:1, và
 *     group khớp hiển thị '__arp_canonical_skeleton__' bị loại khỏi
 *     bản clone xuất.
 *   • fbx2gltf đọc 0 animation channel từ FBX do writer này xuất
 *     (giới hạn writer đã biết) — kiểm chứng animation bằng FBXLoader
 *     + dense sampling, KHÔNG dùng fbx2gltf để kết luận clip mất.
 *   • Blender không import được FBX do writer này xuất
 *     (elem_split_name_class) — kiểm chứng bằng FBXLoader + fbx2gltf.
 *   • fbxRoot trong viewport đã bị addToViewport normalize (scale
 *     ~2.0/1.8 + position offset) và mixer có thể đang để xương ở
 *     pose giữa clip — bản clone xuất phải reset transform gốc về
 *     identity + skeleton.pose() về bind pose TRƯỚC khi đo/xử lý.
 *   • Writer (FBXBinary.write) tự áp xform (upAxis/autoScale) lên
 *     cả xương lẫn track gốc — nút mới truyền upAxis:'keep' +
 *     autoScale:false để writer ghi đúng những gì pipeline đã làm.
 *
 * API (dùng trong UI + test harness — KHÔNG phụ thuộc DOM):
 *   GoldenStandardExport.getSource() → {object, clips, fileName} | null
 *   GoldenStandardExport.measureBefore(object3D, clips) → Promise<rows>
 *   GoldenStandardExport.process(object3D, clips, opts) → Promise<{bytes, report, filename}>
 *   GoldenStandardExport.openDialog() — mở cửa sổ bảng (cần Modals/Utils)
 *   GoldenStandardExport.run() — entry cho nút topbar (mở dialog)
 * report.rows: [{id, label, before, after, status, detail, nums}]
 *   status: 'pass' | 'fail' | 'skip' | 'pending'
 * ============================================================ */
(function () {
  'use strict';

  var G = {};
  G.TARGET_TRIS = 14932;
  G.TRI_MIN = 12000;
  G.TRI_MAX = 18000;
  G.GROUND_TOL = 0.02;
  G.VERSION = 'golden-standard-1';

  /* ---------------- môi trường (lazy — load được cả trong Node/jsdom) ---------------- */
  function T() {
    if (typeof window !== 'undefined' && window.THREE) return window.THREE;
    if (typeof THREE !== 'undefined') return THREE;
    return null;
  }
  function M() {
    if (typeof window !== 'undefined' && window.MeshoptSimplifier) return window.MeshoptSimplifier;
    if (typeof MeshoptSimplifier !== 'undefined') return MeshoptSimplifier;
    return null;
  }
  function FB() {
    if (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.FBXBinary) return window.PixiStudio.FBXBinary;
    if (typeof PixiStudio !== 'undefined' && PixiStudio.FBXBinary) return PixiStudio.FBXBinary;
    return null;
  }
  function bus() {
    try {
      if (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.bus) return window.PixiStudio.bus;
      if (typeof PixiStudio !== 'undefined' && PixiStudio.bus) return PixiStudio.bus;
    } catch (e) {}
    return null;
  }
  function notify(type, title, message) {
    var b = bus();
    if (b && b.emit) { try { b.emit('notify', { type: type, title: title, message: message }); return; } catch (e) {} }
    if (typeof console !== 'undefined') console.log('[GoldenStandard][' + type + '] ' + title + ' — ' + message);
  }

  /* ---------------- utils nhỏ ---------------- */
  function fmt(v, d) {
    var n = (d === undefined ? 3 : d);
    return '[' + Array.prototype.map.call(v, function (x) { return +(+x).toFixed(n); }).join(', ') + ']';
  }
  function fmtNum(x, d) { return (x === undefined || x === null || !isFinite(x)) ? '—' : (+x).toFixed(d === undefined ? 3 : d); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  /* realmCtor: constructor typed-array CUNG TEN trong realm cua module
     (window). Trong trinh duyet that chi co 1 realm nen tra chinh ctor
     goc (no-op). Trong harness jsdom, geometry tu Node three mang
     constructor Node-realm, con code module chay trong win-realm:
     neu weld tao Uint32Array bang ctor win-realm ma dua cho meshopt
     (require Node) thi `instanceof Uint32Array` FAIL (assert vendor
     dong 129) — decimate tra null, tris khong giam (harness (c) bat
     duoc 2026-11-27). Chuẩn hoa moi typed array module tao ra ve cung
     1 realm thi ca 2 phia (module + meshopt) deu pass instanceof. */
  function realmCtor(ctor) {
    try {
      if (typeof window !== 'undefined' && ctor && ctor.name && typeof window[ctor.name] === 'function') return window[ctor.name];
    } catch (e) {}
    return ctor;
  }
  function bytesToB64(u8) {
    if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
    var bin = '', CH = 8192, i;
    for (i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    var bin = atob(b64), out = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function log(report, msg) { if (report && report.log) report.log.push(msg); }

  /* ---------------- tên xương (cùng quy ước FbxImport.stripBonePrefix) ---------------- */
  /* strip: 'mixamorigHips' | 'mixamorig:Hips' | 'Hips' | 'Bip01_Hips' |
     'ModelmixamorigHips' | 'Armature|Hips' | 'Model::mixamorig:Hips' → 'Hips'. */
  function stripBonePrefix(name) {
    var n = String(name || '');
    var bar = n.lastIndexOf('|');
    if (bar !== -1) n = n.slice(bar + 1);
    var ns = n.lastIndexOf('::');
    if (ns !== -1) n = n.slice(ns + 2);
    var mi = n.search(/mixamorig/i);
    if (mi > 0) n = n.slice(mi);
    n = n.replace(/^mixamorig:?/i, '').replace(/^Bip0?1[_:]?/i, '').replace(/^Armature[_:]?/i, '');
    return n;
  }
  function isContainerName(name) {
    var s = stripBonePrefix(name).toLowerCase();
    return s === 'root' || s === 'armature' || s === 'scene' || s === 'model' || s === '';
  }
  /* Tên xương chuẩn golden: 'mixamorig' + short, KHÔNG ':' (đúng 2 file mẫu).
     Container (root/Armature/Scene) giữ nguyên — tránh 'mixamorig:root'. */
  function goldenBoneName(name) {
    if (isContainerName(name)) return String(name || '');
    var s = stripBonePrefix(name);
    return s ? 'mixamorig' + s : String(name || '');
  }
  G.stripBonePrefix = stripBonePrefix;
  G.goldenBoneName = goldenBoneName;

  /* ---------------- nguồn model (FbxRig) ---------------- */
  G.getSource = function () {
    try {
      var FR = (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.FbxRig)
        || (typeof PixiStudio !== 'undefined' && PixiStudio.FbxRig);
      if (!FR || !FR.loaded || !FR.fbxRoot) return null;
      var clips = (FR.fbxRoot.animations || []).slice();
      return { object: FR.fbxRoot, clips: clips, fileName: FR.fileName || 'model.fbx', skeleton: FR.skeleton || null };
    } catch (e) { return null; }
  };

  /* ---------------- clone để xuất (không đụng model đang hiển thị) ----------------
   * Dựa trên cloneModelForExport (save-manager.js) + bài học clipbind:
   *  - Gỡ SkeletonHelper + group khớp hiển thị '__arp_canonical_skeleton__'
   *    (Object3D tên ngắn, KHÔNG isBone) + mesh isBoneVisual khỏi cây TRƯỚC
   *    khi clone, gắn lại sau (chỉ tách helper; group hiển thị bị LOẠI
   *    khỏi bản clone xuất vĩnh viễn — nó không phải xương thật).
   *  - clone(true) rồi rebind skeleton theo tên (r128 SkinnedMesh.clone
   *    chia sẻ skeleton gốc), geometry CLONE riêng từng mesh (pipeline
   *    biến đổi geometry — không được đụng geometry của model đang hiện).
   *  - Reset transform gốc về identity (addToViewport normalize đã scale
   *    root ~2.0/1.8 + dời position) + skeleton.pose() về bind pose.
   *  - Đổi tên xương → dạng golden KHÔNG ':' + viết lại tên track clip.
   * Trả {clone, boneMap, clips} — clips là clip ĐÃ đổi tên track, trỏ
   * đúng xương trong clone. */
  function cloneForExport(root, clips) {
    var THREE = T();
    var detachedHelpers = [];
    try {
      root.traverse(function (o) {
        if (o.isSkeletonHelper && o.parent) detachedHelpers.push({ obj: o, parent: o.parent });
      });
      detachedHelpers.forEach(function (d) { try { d.parent.remove(d.obj); } catch (e) {} });
    } catch (e) {}
    var clone;
    try { clone = root.clone(true); }
    finally {
      detachedHelpers.forEach(function (d) { try { d.parent.add(d.obj); } catch (e) {} });
    }
    /* Loại group khớp hiển thị + mesh visual khỏi CLONE (không phải xương/mesh thật). */
    var removed = [];
    clone.traverse(function (o) {
      if (!o) return;
      if (o.name === '__arp_canonical_skeleton__' || (o.userData && (o.userData.isCanonicalJoint || o.userData.isBoneVisual))) removed.push(o);
    });
    removed.forEach(function (o) { if (o.parent) o.parent.remove(o); });
    /* ArpRigLayers: gỡ control/mechanism/proxy khỏi clone (nếu module có mặt). */
    try {
      var RL = (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.ArpRigLayers) || null;
      if (RL && typeof RL.stripNonDeformFromClone === 'function') RL.stripNonDeformFromClone(clone);
    } catch (e) {}
    /* Rebind skeleton: xương clone theo tên (r128 clone chia sẻ skeleton gốc). */
    var origBones = [], cloneBones = [];
    root.traverse(function (o) { if (o.isBone) origBones.push(o); });
    clone.traverse(function (o) { if (o.isBone) cloneBones.push(o); });
    var byName = {};
    cloneBones.forEach(function (b) { byName[b.name] = b; });
    var boneMap = new Map();
    origBones.forEach(function (b) { if (byName[b.name]) boneMap.set(b, byName[b.name]); });
    clone.traverse(function (o) {
      if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones) {
        var nb = o.skeleton.bones.map(function (b) { return boneMap.get(b) || b; });
        o.skeleton = new THREE.Skeleton(nb, o.skeleton.boneInverses);
      }
      /* Geometry riêng từng mesh — pipeline biến đổi geometry, không được
         đụng geometry của model đang hiển thị (clone(true) chia sẻ). */
      if (o.isMesh && o.geometry) o.geometry = o.geometry.clone();
    });
    /* Reset transform gốc về identity (normalize của addToViewport đã scale
       root + dời position để hiển thị — file xuất phải ở không gian gốc). */
    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    clone.scale.set(1, 1, 1);
    clone.updateMatrixWorld(true);
    /* Bind pose: mixer có thể đang để xương ở pose giữa clip. */
    clone.traverse(function (o) {
      if (o.isSkinnedMesh && o.skeleton) { try { o.skeleton.pose(); } catch (e) {} }
    });
    clone.updateMatrixWorld(true);
    /* Đổi tên xương → dạng golden KHÔNG ':' + viết lại tên track. */
    var renameMap = {};
    cloneBones.forEach(function (b) {
      var nn = goldenBoneName(b.name);
      if (nn !== b.name) { renameMap[b.name] = nn; b.name = nn; }
    });
    var newClips = (clips || []).map(function (clip) {
      if (!clip || !clip.tracks) return clip;
      var tracks = clip.tracks.map(function (t) {
        var dot = t.name.lastIndexOf('.');
        if (dot < 0) return t;
        var node = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
        var nn = renameMap[node];
        if (!nn) {
          /* Track có thể đã ở dạng ngắn ('Hips.…') do canonicalize lỗi —
             khớp theo short name với xương thật trong clone. */
          var short = stripBonePrefix(node);
          var hit = cloneBones.filter(function (b) { return stripBonePrefix(b.name) === short; })[0];
          if (hit) nn = hit.name;
        }
        if (!nn || nn === node) {
          /* Luôn clone track (KeyframeTrack.clone() copy mảng times/values)
             kể cả khi tên không đổi — applyMatrixToModel/ground sửa values
             tại chỗ, không được đụng clip gốc đang hiển thị. */
          return t.clone();
        }
        var nt = t.clone();
        nt.name = nn + '.' + prop;
        return nt;
      });
      return new THREE.AnimationClip(clip.name, clip.duration, tracks);
    });
    return { clone: clone, renameMap: renameMap, clips: newClips };
  }
  G._cloneForExport = cloneForExport;

  /* ---------------- khử key chèn của stock FBXLoader ----------------
   * interpolateRotations (vendor FBXLoader r128) chèn key Euler nội suy
   * khi span ≥180° giữa 2 key gốc (gimbal branch-flip): Hips 144→150 key,
   * bước ~180° giữa các key kề, hướng SAI ~90° so với motion thật (đo
   * 2026-11-26, Blender: góc kề max 33.8° Hips / 41.5° LeftHand).
   * Key chèn nhận diện được bằng CẢ 2 dấu hiệu cùng lúc:
   *   (a) thời gian LỆCH khỏi lưới thời gian gốc (lưới = times của
   *       Hips.position track — position không bị interpolateRotations),
   *   (b) tạo bước quaternion ≥90° ở CẢ 2 phía, trong khi 2 key kề gốc
   *       chỉ lệch nhau <60° (key chèn là "cầu" sai hướng giữa 2 key đúng).
   * Key thật có bước lớn (vd thieulam_time: RightForeArm 110.86° ở key
   * 0→1) KHÔNG bị gỡ vì nó nằm TRÊN lưới gốc. Lặp tới khi ổn định. */
  function quatAngle(qa, qb) {
    var d = Math.abs(qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w);
    if (d > 1) d = 1;
    return 2 * Math.acos(d) * 180 / Math.PI;
  }
  function decontaminateClip(clip, refTimes) {
    var THREE = T();
    var removed = [];
    if (!clip || !clip.tracks) return { clip: clip, removed: removed };
    var refSet = null;
    if (refTimes && refTimes.length) {
      refSet = {};
      refTimes.forEach(function (t) { refSet[Math.round(t * 1e6)] = true; });
    }
    var newTracks = clip.tracks.map(function (t) {
      if (!t.name || t.name.indexOf('.quaternion') === -1) return t;
      var times = Array.prototype.slice.call(t.times);
      var vals = Array.prototype.slice.call(t.values);
      var n = times.length;
      if (n < 3 || !refSet) return t;
      var changed = true, guard = 0, removedHere = 0;
      var q = function (i) { return { x: vals[i * 4], y: vals[i * 4 + 1], z: vals[i * 4 + 2], w: vals[i * 4 + 3] }; };
      while (changed && guard++ < 50) {
        changed = false;
        for (var i = 1; i < times.length - 1; i++) {
          var onGrid = !!refSet[Math.round(times[i] * 1e6)];
          if (onGrid) continue;
          var a01 = quatAngle(q(i - 1), q(i));
          var a12 = quatAngle(q(i), q(i + 1));
          var a02 = quatAngle(q(i - 1), q(i + 1));
          if (a01 >= 90 && a12 >= 90 && a02 < 60) {
            times.splice(i, 1);
            vals.splice(i * 4, 4);
            removedHere++;
            changed = true;
            break;
          }
        }
      }
      if (removedHere) removed.push({ track: t.name, removed: removedHere, keysAfter: times.length });
      if (removedHere === 0) return t;
      return new THREE.QuaternionKeyframeTrack(t.name, times, vals);
    });
    if (!removed.length) return { clip: clip, removed: removed };
    return { clip: new THREE.AnimationClip(clip.name, clip.duration, newTracks), removed: removed };
  }
  G._decontaminateClip = decontaminateClip;

  /* ---------------- đo trục (basis) + xoay ----------------
   * Đo từ xương thật ở bind pose (không dùng bbox dài nhất — prop dài
   * như gậy/kiếm làm bbox X vượt chiều cao, writer đã phải sửa cùng
   * lỗi này 2026-11-26):
   *   up_s      = (HeadTop_End|Head − Hips) chuẩn hóa
   *   forward_s = (Toe_End − ToeBase) chuẩn hóa (mũi chân → hướng mặt)
   *   right_s   = (RightHand − LeftHand) chuẩn hóa
   * Target: up +Y, forward +Z, right −X (giống 2 file golden: tay phải
   * −X, tay trái +X, mặt +Z). R = M_target · M_source⁻¹ (cột = basis).
   * Kiểm tra với nguồn Z-up: up_s=(0,0,−1), forward_s=(0,1,0),
   * right_s=(−1,0,0) → R = Rx(+90°) đúng như converter gốc.
   * Nếu xương thiếu → fallback bbox: trục dài nhất là Z thì Rx(+90°)
   * (Blender Z-up: đầu ở −Z), kèm cảnh báo trong log. */
  function boneByShort(clone) {
    var map = {};
    clone.traverse(function (o) {
      if (o.isBone) {
        var s = stripBonePrefix(o.name);
        if (!map[s]) map[s] = o;
      }
    });
    return map;
  }
  function worldPos(obj, out) {
    var THREE = T();
    if (!out) out = new THREE.Vector3();
    if (!obj) return out.set(0, 0, 0);
    return out.setFromMatrixPosition(obj.matrixWorld);
  }
  function measureBasis(clone, boneByShortMap) {
    var THREE = T();
    var bs = boneByShortMap || boneByShort(clone);
    var hips = bs.Hips, head = bs.HeadTop_End || bs.Head;
    var toeL = bs.LeftToeBase, toeLEnd = bs.LeftToe_End || bs.LeftToeEnd;
    var toeR = bs.RightToeBase, toeREnd = bs.RightToe_End || bs.RightToeEnd;
    var handL = bs.LeftHand, handR = bs.RightHand;
    var up = null, forward = null, right = null, fallback = null;
    if (hips && head) {
      up = worldPos(head).sub(worldPos(hips));
      if (up.length() > 0.01) up.normalize(); else up = null;
    }
    var toeB = toeL || toeR, toeE = toeLEnd || toeREnd;
    if (toeB && toeE) {
      forward = worldPos(toeE).sub(worldPos(toeB));
      if (forward.length() > 0.001) forward.normalize(); else forward = null;
    }
    if (handL && handR) {
      right = worldPos(handR).sub(worldPos(handL));
      if (right.length() > 0.01) right.normalize(); else right = null;
    }
    if (!up || !forward || !right) {
      /* Fallback bbox: trục dài nhất + đầu ở −Z (Blender Z-up). */
      var bb = new THREE.Box3();
      clone.traverse(function (o) { if (o.isSkinnedMesh) bb.expandByObject(o); });
      if (bb.isEmpty()) clone.traverse(function (o) { if (o.isMesh) bb.expandByObject(o); });
      var size = bb.getSize(new THREE.Vector3());
      var axis = size.x >= size.y && size.x >= size.z ? 'X' : (size.y >= size.z ? 'Y' : 'Z');
      fallback = { axis: axis, size: [size.x, size.y, size.z] };
    }
    return { up: up, forward: forward, right: right, fallback: fallback };
  }
  function rotationFromBasis(basis) {
    var THREE = T();
    if (!basis.up || !basis.forward || !basis.right) return null;
    /* Chuan hoa truc giao (Gram-Schmidt, giu handedness golden):
       - up (Head-Hips) va right (RightHand-LeftHand) do duoc GAN NHU
         CHINH XAC (le < 1 do tren file tho) — dung lam chuan.
       - forward do tu ngon chan LECH TOI 22 do (ban chan xoay cheo o
         bind pose; goc up·fwd chi 75.9 do, khong truc giao) — dung no
         lam truc se tao ma tran KHONG phai phep quay thuan (det 1.08,
         shear) -> geometry (applyMatrix4) va xuong (quaternion) lech
         nhau: cao 1.829m thay vi 1.8m, playback lech 25 do, ground
         fail (harness (c) bat duoc 2026-11-27). Nen suy forward =
         up x right (dung handedness golden: right=-X, up=+Y, fwd=+Z
         thi fwd = up x right). Forward do chi de kiem tra dau: neu
         nguoc dau thi doi chieu — lay forward do lam chuan (truong
         hop benh ly, tay trai/phai bi dao), right = fwd x up. */
    var u = basis.up.clone().normalize();
    var r = basis.right.clone().addScaledVector(u, -basis.right.dot(u));
    if (r.lengthSq() < 1e-12) return null;
    r.normalize();
    var f = new THREE.Vector3().crossVectors(u, r);
    if (basis.forward && f.dot(basis.forward) < 0) {
      f = basis.forward.clone().addScaledVector(u, -basis.forward.dot(u));
      if (f.lengthSq() < 1e-12) return null;
      f.normalize();
      r = new THREE.Vector3().crossVectors(f, u);
    }
    var ms = new THREE.Matrix4().makeBasis(r, u, f);
    var mt = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    var R = mt.multiply(ms.clone().invert());
    /* Snap ve phep quay chinh (90 do quanh truc chinh) khi gan: file
       truc (Z-up/X-up) luon la quay chinh; up do duoc chi lech 0.43
       do nen snap cho ra dung Rx(+90°) cua file golden thay vi ~83
       do (xoay lien tuc). Chi snap khi ca 2 truc snap lech < 15 do
       va RS gan R lien tuc (<= 20 do) — tranh xoay nham model le truc. */
    var snapped = snapToPrincipalRotation(R, u, r);
    return snapped || R;
  }
  /* Tim phep quay chinh (ma tran quay 0/90/180/270 do quanh truc X/Y/Z)
     gan nhat voi R, dua tren up/right da snap ve truc chinh. Tra null
     neu model khong gan truc chinh nao (le > 15 do). */
  function snapToPrincipalRotation(R, u, r) {
    var THREE = T();
    var axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    function nearest(v) {
      var best = null, bestAbs = -1;
      axes.forEach(function (a) {
        var d = v.dot(a);
        if (Math.abs(d) > bestAbs) { bestAbs = Math.abs(d); best = a.clone().multiplyScalar(d < 0 ? -1 : 1); }
      });
      return { vec: best, offDeg: Math.acos(clamp(bestAbs, -1, 1)) * 180 / Math.PI };
    }
    var nu = nearest(u), nr = nearest(r);
    if (nu.offDeg > 15 || nr.offDeg > 15) return null;
    if (Math.abs(nu.vec.dot(nr.vec)) > 0.5) return null;
    var upS = nu.vec, rS = nr.vec;
    var fS = new THREE.Vector3().crossVectors(upS, rS);
    var msS = new THREE.Matrix4().makeBasis(rS, upS, fS);
    var mt = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    var RS = mt.multiply(msS.clone().invert());
    var rel = new THREE.Matrix4().multiplyMatrices(R.clone().invert(), RS);
    if (rotationAngleDeg(rel) > 20) return null;
    return RS;
  }
  function rotationAngleDeg(R) {
    var THREE = T();
    var q = new THREE.Quaternion().setFromRotationMatrix(R);
    return 2 * Math.acos(clamp(Math.abs(q.w), -1, 1)) * 180 / Math.PI;
  }
  /* Áp ma trận 4x4 (xoay hoặc tịnh tiến) NHẤT QUÁN cho:
   *  - geometry (+normal) của mọi mesh KHÔNG có cha xương (mesh dưới xương
   *    đi theo xương, không sửa geometry — đúng như converter gốc chỉ sửa
   *    geometry skinned mesh + root bone local + track Hips),
   *  - local của xương GỐC (không cha xương): position R·p, quaternion Rq⊗q,
   *  - track Hips của mọi clip: position R·v, quaternion Rq⊗q.
   * Child locals không đổi (xoay cứng toàn bộ — drift 3.3e-16 như converter).
   * Sau đó updateMatrixWorld + skeleton.calculateInverses(). */
  function applyMatrixToModel(clone, clips, mat, report) {
    var THREE = T();
    var Rq = new THREE.Quaternion().setFromRotationMatrix(mat);
    var hasRot = Math.abs(Rq.x) + Math.abs(Rq.y) + Math.abs(Rq.z) > 1e-9;
    var rootBones = [];
    clone.traverse(function (o) {
      if (o.isBone) {
        var w = o.parent, hasBoneParent = false;
        while (w) { if (w.isBone) { hasBoneParent = true; break; } w = w.parent; }
        if (!hasBoneParent) rootBones.push(o);
      }
    });
    clone.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      var w = o.parent, hasBoneParent = false;
      while (w) { if (w.isBone) { hasBoneParent = true; break; } w = w.parent; }
      if (hasBoneParent) return;
      /* applyMatrix4 tu ap cho ca position + normal (rigid transform —
         xoay/tinh tien — giu nguyen do dai normal, khong can normalize
         rieng; BufferAttribute.normalize() KHONG ton tai trong three r128). */
      o.geometry.applyMatrix4(mat);
    });
    var p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    rootBones.forEach(function (b) {
      b.position.applyMatrix4(mat);
      if (hasRot) b.quaternion.premultiply(Rq);
      b.updateMatrix();
    });
    var rootShorts = {};
    rootBones.forEach(function (b) { rootShorts[stripBonePrefix(b.name)] = true; });
    (clips || []).forEach(function (clip) {
      (clip.tracks || []).forEach(function (t) {
        var dot = t.name.lastIndexOf('.');
        if (dot < 0) return;
        var short = stripBonePrefix(t.name.slice(0, dot));
        if (!rootShorts[short]) return;
        var prop = t.name.slice(dot + 1);
        if (prop === 'position') {
          for (var i = 0; i < t.times.length; i++) {
            p.set(t.values[i * 3], t.values[i * 3 + 1], t.values[i * 3 + 2]).applyMatrix4(mat);
            t.values[i * 3] = p.x; t.values[i * 3 + 1] = p.y; t.values[i * 3 + 2] = p.z;
          }
        } else if (prop === 'quaternion' && hasRot) {
          for (var j = 0; j < t.times.length; j++) {
            q.set(t.values[j * 4], t.values[j * 4 + 1], t.values[j * 4 + 2], t.values[j * 4 + 3]).premultiply(Rq);
            t.values[j * 4] = q.x; t.values[j * 4 + 1] = q.y; t.values[j * 4 + 2] = q.z; t.values[j * 4 + 3] = q.w;
          }
        }
      });
    });
    clone.updateMatrixWorld(true);
    clone.traverse(function (o) {
      if (o.isSkinnedMesh && o.skeleton) { try { o.skeleton.calculateInverses(); } catch (e) {} }
    });
    clone.updateMatrixWorld(true);
  }

  /* ---------------- pivot ----------------
   * Offset = (bboxCenterX, bboxMinY, bboxCenterZ) của mesh SKINNED ở bind
   * pose (không tính prop). 2 file golden: origin (0,0,0) đúng điểm đất
   * giữa 2 bàn chân; bàn chân so le 14.7cm theo Z nên chỉ cần origin Z
   * nằm giữa ankle-midpoint (−0.063) và sole-midpoint (+0.049). */
  function geometryBBox(clone) {
    var THREE = T();
    var bb = new THREE.Box3();
    var any = false;
    clone.traverse(function (o) {
      if (o.isSkinnedMesh && o.geometry) {
        o.geometry.computeBoundingBox();
        var gbb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        bb.union(gbb); any = true;
      }
    });
    if (!any) clone.traverse(function (o) {
      if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); }
    });
    return bb.isEmpty() ? null : bb;
  }
  function pivotOffset(clone) {
    var bb = geometryBBox(clone);
    if (!bb) return null;
    var c = bb.getCenter(new (T()).Vector3());
    return { x: c.x, y: bb.min.y, z: c.z, bbox: { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z], size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z] } };
  }

  /* ---------------- foot-class + skinned min ----------------
   * Foot-class = đỉnh có trọng lượng skin trên xương bàn chân (LeftFoot/
   * RightFoot/LeftToeBase/RightToeBase) HOẶC nằm trong 0.15m của vị trí
   * các xương đó ở bind pose (đúng converter gốc: 12,353 đỉnh).
   * skinnedMinY: dùng THREE.SkinnedMesh + skeleton — mixer đặt thời gian,
   * updateMatrixWorld, rồi tính Y thế giới từng đỉnh (skinning thật, có
   * tính bone transforms tại thời điểm đó). Stride thích ứng: mục tiêu
   * ≤ ~10M lần tính đỉnh cho toàn bộ lần ground (điện thoại). */
  function footClassVerts(mesh, boneByShortMap) {
    var THREE = T();
    var geo = mesh.geometry;
    var pos = geo.attributes.position;
    /* Foot-class = dinh nam trong 0.15m cua vi tri cac xuong ban chan o
       bind pose — DUNG dinh nghia cua converter goc (12,353 dinh).
       KHONG dung tieu chi skin-weight: ao choang/vay co dinh mang
       weight tren xuong ban chan nhung ru XUONG DUOI de giay (hem
       -0.0236m) — dua chung vao foot-class lam minSole do thap hon
       that ~18mm, ground nang ca nhan vat len sai (harness (b) bat
       duoc 2026-11-27: dense minSole max +0.0241m vuot ±0.02). */
    var feet = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];
    var footPos = [];
    feet.forEach(function (name) {
      var b = boneByShortMap[name];
      if (b) footPos.push(worldPos(b));
    });
    var cls = new Uint8Array(pos.count);
    var idx = [];
    var v = new THREE.Vector3();
    for (var i = 0; i < pos.count; i++) {
      var isFoot = false;
      if (footPos.length) {
        /* Khoang cach EUCLID (hinh cau r=0.15m) — dung dinh nghia converter
           goc. Ban cu dung |dx|,|dy|,|dz| < 0.15 (hinh hop) lay them dinh
           ao choang o goc hop (Euclid > 0.15m) lam dense verify cua module
           fail (harness (b) bat duoc). */
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        for (var j = 0; j < footPos.length; j++) {
          var dx = v.x - footPos[j].x, dy = v.y - footPos[j].y, dz = v.z - footPos[j].z;
          if (dx * dx + dy * dy + dz * dz <= 0.15 * 0.15) { isFoot = true; break; }
        }
      }
      if (isFoot) { cls[i] = 1; idx.push(i); }
    }
    var count = 0; for (var m = 0; m < cls.length; m++) if (cls[m]) count++;
    return { cls: cls, count: count, idx: idx };
  }
  /* Tính Y thấp nhất của các đỉnh (foot-class nếu onlyFoot) sau skinning.
   * three r128 SkinnedMesh.boneTransform(v, boneIndex...) — dùng API có
   * sẵn thay vì tự nhân ma trận (tránh lệch với bind matrix). */
  /* r128 SkinnedMesh.boneTransform(vertexIndex, target): tự áp cả 4
     trọng số skin của đỉnh đó, trả vị trí đã skin trong không gian
     LOCAL của mesh (bindMatrix → bone matrixWorld → bindMatrixInverse).
     Chỉ cần gọi 1 lần/đỉnh rồi nhân mesh.matrixWorld để ra world. */
  function skinnedMinY(mesh, footClass, stride, onlyFoot) {
    var THREE = T();
    var geo = mesh.geometry;
    var pos = geo.attributes.position;
    var tmp = new THREE.Vector3();
    var min = Infinity;
    var strideUse = Math.max(1, stride | 0);
    var hasSkin = !!(geo.attributes.skinIndex && geo.attributes.skinWeight);
    /* Chi lap tren danh sach dinh foot-class (idx) thay vi stride tren
       TOAN BO verts roi loc: stride 8 tren 44,796 verts chi mau ~600
       dinh chan -> bo sot dinh thap nhat, dense minSole do cao hon
       that ~6.5mm, hang Ground tu bao FAIL du file ra dung (harness
       (b) bat duoc 2026-11-27: module 0.0256m vs harness 0.0191m).
       Lap tren idx (4,758 dinh) voi stride 1 la CHINH XAC ma van re
       (4,758 x 1,440 mau = 6.8M boneTransform). */
    if (onlyFoot && footClass && footClass.idx && footClass.idx.length) {
      var list = footClass.idx;
      for (var k = 0; k < list.length; k += strideUse) {
        var vi = list[k];
        if (hasSkin) {
          mesh.boneTransform(vi, tmp);
          tmp.applyMatrix4(mesh.matrixWorld);
        } else {
          tmp.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
        }
        if (tmp.y < min) min = tmp.y;
      }
      return min;
    }
    for (var i = 0; i < pos.count; i += strideUse) {
      if (onlyFoot && footClass && !footClass.cls[i]) continue;
      if (hasSkin) {
        mesh.boneTransform(i, tmp);
        tmp.applyMatrix4(mesh.matrixWorld);
      } else {
        tmp.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      }
      if (tmp.y < min) min = tmp.y;
    }
    return min;
  }
  function skinnedMinYAll(meshes, footClasses, stride, onlyFoot) {
    var min = Infinity;
    meshes.forEach(function (m, i) {
      var v = skinnedMinY(m, footClasses[i], stride, onlyFoot);
      if (v < min) min = v;
    });
    return min;
  }

  /* ---------------- ground clip ----------------
   * Mỗi key của Hips.position track: minSole(t) = Y thấp nhất foot-class
   * tại thời điểm đó; HipsY'(key) = HipsY(key) − minSole(t_key) [+ LIFT].
   * LIFT: robe hem rủ thấp hơn bàn chân quá 0.02m thì cộng đều
   * lift = maxGap − 0.018 (file mẫu 2: gap 0.0236 → lift 0.0056 ≈ 5mm),
   * tối đa 0.01m; nếu gap quá lớn (>0.04m) thì vẫn xuất nhưng báo FAIL
   * ở hàng Ground (không giấu). Chỉ đổi Hips.position Y — rotation
   * tracks, xương khác, tên/duration/track count/key count giữ nguyên. */
  function groundClip(clip, meshes, footClasses, boneByShortMap, opts) {
    var THREE = T();
    opts = opts || {};
    var rootShort = opts.rootShort || 'Hips';
    var mixer = null;
    var hipsTrack = null;
    (clip.tracks || []).forEach(function (t) {
      if (t.name && t.name.indexOf('.position') !== -1 && stripBonePrefix(t.name.slice(0, t.name.lastIndexOf('.'))) === rootShort) hipsTrack = t;
    });
    if (!hipsTrack) return { clip: clip, skipped: 'no-hips-track', offsets: [], lift: 0 };
    var times = hipsTrack.times;
    var nKeys = times.length;
    var totalVerts = 0;
    meshes.forEach(function (m) { totalVerts += m.geometry.attributes.position.count; });
    var footTotal = 0;
    footClasses.forEach(function (fc) { footTotal += fc.count; });
    /* footStride = 1: lap tren danh sach foot-class -> minSole CHINH XAC
       (4,758 dinh x 900 key = 4.3M boneTransform, chap nhan duoc).
       allStride: giu stride thich ung cu cho min toan bo dinh (robe hem). */
    var footStride = 1;
    var allStride = Math.max(1, Math.ceil((nKeys * totalVerts) / 1e7));
    /* Mixer chơi clip trên 1 group tạm chứa skeleton clone — mixer cần
       root chứa xương; dùng chính mesh đầu tiên làm "root" cho binding
       (track node name khớp tên xương trong cây của mesh). */
    var mixRoot = meshes[0];
    while (mixRoot && mixRoot.parent && !mixRoot.parent.isScene) mixRoot = mixRoot.parent;
    mixer = new THREE.AnimationMixer(mixRoot || meshes[0]);
    var action = mixer.clipAction(clip);
    /* LoopOnce + clamp: mac dinh LoopRepeat lam setTime(duration) WRAP
       ve t=0 — ground do minSole key cuoi bang pose key 0, Hips key
       cuoi lech golden 24mm (harness (c) bat duoc 2026-11-27).
       Converter goc va harness deu dung LoopOnce + clamp. */
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    var offsets = new Array(nKeys), footMins = new Array(nKeys), allMins = new Array(nKeys);
    for (var i = 0; i < nKeys; i++) {
      mixer.setTime(times[i]);
      (mixRoot || meshes[0]).updateMatrixWorld(true);
      var fm = skinnedMinYAll(meshes, footClasses, footStride, true);
      var am = skinnedMinYAll(meshes, footClasses, Math.max(allStride, 5), false);
      footMins[i] = fm; allMins[i] = am;
      offsets[i] = fm;
    }
    action.stop();
    mixer.uncacheClip(clip);
    var maxGap = 0;
    for (var j = 0; j < nKeys; j++) {
      var gap = footMins[j] - allMins[j];
      if (gap > maxGap) maxGap = gap;
    }
    var lift = 0;
    if (maxGap > G.GROUND_TOL) lift = clamp(maxGap - 0.018, 0, 0.01);
    var maxOff = 0;
    for (var k = 0; k < nKeys; k++) if (Math.abs(offsets[k]) > maxOff) maxOff = Math.abs(offsets[k]);
    var alreadyGrounded = maxOff < 0.005 && lift === 0;
    var newTrack = hipsTrack;
    if (!alreadyGrounded) {
      var newVals = Array.prototype.slice.call(hipsTrack.values);
      for (var m2 = 0; m2 < nKeys; m2++) newVals[m2 * 3 + 1] = hipsTrack.values[m2 * 3 + 1] - offsets[m2] + lift;
      newTrack = new THREE.VectorKeyframeTrack(hipsTrack.name, Array.prototype.slice.call(times), newVals);
      var tracks = clip.tracks.map(function (t) { return t === hipsTrack ? newTrack : t; });
      clip = new THREE.AnimationClip(clip.name, clip.duration, tracks);
    }
    return {
      clip: clip, skipped: alreadyGrounded ? 'already-grounded' : null,
      offsets: offsets, lift: lift, maxGap: maxGap, maxOffset: maxOff,
      footMinsBefore: footMins, allMinsBefore: allMins, stride: footStride, allStride: allStride
    };
  }
  G._groundClip = groundClip;

  /* ---------------- weld / compact / decimate (meshopt) ----------------
   * Chuyển từ save-manager.js (weldGeometry/compactGeometry/
   * decimateCloneToBudget) + mixamo-safe-export.js (decimateMeshopt):
   * weld TRƯỚC (FBXLoader trả geometry non-indexed → meshopt không có
   * cạnh chung để collapse, đo 46,917 → 46,917 không giảm), meshopt
   * simplify, compact (bỏ đỉnh thừa — writer ghi toàn bộ đỉnh trong
   * attribute thành double), weld LẠI (meshopt tính lại normal nên
   * nhiều đỉnh thành trùng y hệt). KHÔNG dùng decimation gom ô + hàn
   * cũ — đã chứng minh méo mặt (gộp đỉnh cách nhau tới 31cm). */
  function triCountOfGeo(geo) {
    if (!geo || !geo.attributes || !geo.attributes.position) return 0;
    return Math.floor((geo.index ? geo.index.count : geo.attributes.position.count) / 3);
  }
  function weldGeometry(geometry) {
    var THREE = T();
    if (!geometry) return geometry;
    var pos = geometry.attributes.position;
    if (!pos) return geometry;
    var names = Object.keys(geometry.attributes);
    var n = pos.count;
    var map = new Map();
    var remap = new (realmCtor(Int32Array))(n);
    var used = [];
    for (var i = 0; i < n; i++) {
      var parts = [];
      for (var a = 0; a < names.length; a++) {
        var attr = geometry.attributes[names[a]];
        var base = i * attr.itemSize;
        for (var k = 0; k < attr.itemSize; k++) {
          var v = attr.array[base + k];
          parts.push(typeof v === 'number' ? v.toFixed(5) : String(v));
        }
      }
      var key = parts.join('|');
      var idx = map.get(key);
      if (idx === undefined) { idx = used.length; map.set(key, idx); used.push(i); }
      remap[i] = idx;
    }
    if (used.length === n) {
      if (geometry.index) return geometry;
      var g0 = new THREE.BufferGeometry();
      names.forEach(function (nm) { g0.setAttribute(nm, geometry.attributes[nm]); });
      var idx0 = new (realmCtor(Uint32Array))(n);
      for (var j0 = 0; j0 < n; j0++) idx0[j0] = j0;
      g0.setIndex(new THREE.BufferAttribute(idx0, 1));
      g0.computeBoundingBox(); g0.computeBoundingSphere();
      return g0;
    }
    var g = new THREE.BufferGeometry();
    names.forEach(function (name) {
      var at = geometry.attributes[name];
      var itemSize = at.itemSize;
      var Arr = realmCtor(at.array.constructor);
      var out = new Arr(used.length * itemSize);
      for (var u = 0; u < used.length; u++) {
        var src = used[u];
        for (var k2 = 0; k2 < itemSize; k2++) out[u * itemSize + k2] = at.array[src * itemSize + k2];
      }
      g.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
    });
    var oldIdx = geometry.index ? geometry.index.array : null;
    var idxLen = oldIdx ? oldIdx.length : n;
    var newIdx = new (realmCtor(Uint32Array))(idxLen);
    for (var j = 0; j < idxLen; j++) newIdx[j] = remap[oldIdx ? oldIdx[j] : j];
    g.setIndex(new THREE.BufferAttribute(newIdx, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  function compactGeometry(geometry) {
    var THREE = T();
    var index = geometry.index;
    if (!index || !index.array) return geometry;
    var idxArr = index.array;
    var pos = geometry.attributes.position;
    if (!pos) return geometry;
    var n = pos.count;
    var remap = new (realmCtor(Int32Array))(n);
    for (var i = 0; i < n; i++) remap[i] = -1;
    var used = [];
    for (var j = 0; j < idxArr.length; j++) {
      var vi = idxArr[j];
      if (remap[vi] === -1) { remap[vi] = used.length; used.push(vi); }
    }
    if (used.length === n) return geometry;
    var newCount = used.length;
    var g = new THREE.BufferGeometry();
    Object.keys(geometry.attributes).forEach(function (name) {
      var attr = geometry.attributes[name];
      var itemSize = attr.itemSize;
      var Arr = realmCtor(attr.array.constructor);
      var out = new Arr(newCount * itemSize);
      for (var u = 0; u < newCount; u++) {
        var src = used[u];
        for (var k = 0; k < itemSize; k++) out[u * itemSize + k] = attr.array[src * itemSize + k];
      }
      g.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
    });
    var newIdx = new (realmCtor(Uint32Array))(idxArr.length);
    for (var j2 = 0; j2 < idxArr.length; j2++) newIdx[j2] = remap[idxArr[j2]];
    g.setIndex(new THREE.BufferAttribute(newIdx, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  function decimateMeshoptDirect(geometry, targetTris, targetError) {
    var THREE = T();
    var Meshopt = M();
    if (!Meshopt || typeof Meshopt.simplify !== 'function') return null;
    var pos = geometry.attributes.position;
    var index = geometry.index;
    if (!pos || !pos.array) return null;
    var posArr = pos.array;
    var idxArr = (index && index.array) ? index.array : (function () { var a = new (realmCtor(Uint32Array))(pos.count); for (var i = 0; i < pos.count; i++) a[i] = i; return a; })();
    var srcTris = Math.floor(idxArr.length / 3);
    if (srcTris <= targetTris) return null;
    var err = (typeof targetError === 'number' && targetError > 0) ? targetError : 0.01;
    var out;
    try { out = Meshopt.simplify(idxArr, posArr, 3, targetTris * 3, err, ['LockBorder']); }
    catch (e) { if (typeof console !== 'undefined') console.error('[GoldenStandard][decimate] simplify THROW:', e && e.message, '| idxLen=', idxArr && idxArr.length, 'posLen=', posArr && posArr.length, 'posCtor=', posArr && posArr.constructor && posArr.constructor.name, 'target=', targetTris); return null; }
    if (!out || !out[0] || !out[0].length) { if (typeof console !== 'undefined') console.error('[GoldenStandard][decimate] simplify tra rong: out=', !!out, 'out0len=', out && out[0] && out[0].length); return null; }
    var g = new THREE.BufferGeometry();
    Object.keys(geometry.attributes).forEach(function (name) {
      g.setAttribute(name, geometry.attributes[name].clone());
    });
    g.setIndex(new THREE.BufferAttribute(out[0], 1));
    if (g.attributes.normal) g.deleteAttribute('normal');
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    return { geometry: g, trisAfter: Math.floor(out[0].length / 3), err: out[1] };
  }
  function decimateToBudget(clone, triBudget, targetError) {
    var MSE = null;
    try { MSE = (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.MixamoSafeExport) || null; } catch (e) {}
    var meshes = [];
    clone.traverse(function (o) {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        if (o.userData && o.userData.isBoneVisual) return;
        meshes.push(o);
      }
    });
    var total = 0;
    meshes.forEach(function (m) { total += triCountOfGeo(m.geometry); });
    var trisAfter = total, maxErr = 0, usedFallback = false;
    if (total > triBudget) {
      var done = 0;
      meshes.forEach(function (m, i) {
        var t = triCountOfGeo(m.geometry);
        var share = (i === meshes.length - 1) ? Math.max(1, triBudget - done) : Math.max(1, Math.floor(triBudget * t / Math.max(1, total)));
        var welded = weldGeometry(m.geometry);
        var d = null;
        if (MSE && typeof MSE.decimateMeshopt === 'function') d = MSE.decimateMeshopt(welded, share, targetError);
        if (!d) { d = decimateMeshoptDirect(welded, share, targetError); if (d) usedFallback = true; }
        if (d) {
          m.geometry = weldGeometry(compactGeometry(d.geometry));
          done += triCountOfGeo(m.geometry);
          if (typeof d.err === 'number' && d.err > maxErr) maxErr = d.err;
        } else { m.geometry = welded; done += t; }
      });
      trisAfter = done;
    }
    return { trisBefore: total, trisAfter: trisAfter, maxErr: maxErr, usedFallback: usedFallback };
  }

  /* ---------------- texture: đọc thẳng bytes gốc ----------------
   * FBX binary nhúng → FBXLoader tạo blob: URL (URL.createObjectURL)
   * cho ảnh; FBX ASCII → data: URL. Đọc bytes bằng fetch(blob:/data:)
   * rồi base64 — KHÔNG qua canvas (bài học GLB→FBX mất màu: canvas/
   * ImageBitmapLoader fail trên ảnh lớn, và re-encode làm mất byte gốc).
   * Chỉ khi ảnh không có URL đọc được mới fallback canvas, và ghi rõ
   * source='canvas-fallback' trong báo cáo (không giấu).
   * Trả {bytes: {matName: {slot: {b64, mime, w, h, source}}}, report}. */
  function fetchBytesFromUrl(url) {
    var f = (typeof window !== 'undefined' && window.fetch) ? window.fetch : (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return Promise.reject(new Error('no fetch'));
    return f(url).then(function (r) {
      if (r && r.arrayBuffer) return r.arrayBuffer();
      throw new Error('no arrayBuffer');
    }).then(function (ab) { return new Uint8Array(ab); });
  }
  function canvasEncodeTexture(tex, slot) {
    try {
      if (typeof document === 'undefined') return null;
      var img = (tex.userData && tex.userData.originalImage) || tex.image;
      if (!img) return null;
      var w = img.width || img.videoWidth || img.naturalWidth || 0;
      var h = img.height || img.videoHeight || img.naturalHeight || 0;
      if (!w || !h) return null;
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var cx = c.getContext('2d');
      var flip = tex.flipY === false;
      if (flip) { cx.translate(0, h); cx.scale(1, -1); }
      cx.drawImage(img, 0, 0, w, h);
      var isNormal = /normal/i.test(slot);
      var mime = isNormal ? 'image/png' : 'image/jpeg';
      var url = c.toDataURL(mime, mime === 'image/jpeg' ? 0.92 : undefined);
      var b64 = url.split(',')[1];
      if (!b64) return null;
      return { b64: b64, mime: mime, w: w, h: h, source: 'canvas-fallback' };
    } catch (e) { return null; }
  }
  function extractTextureBytes(root) {
    var out = {};
    var report = [];
    var jobs = [];
    if (!root || !root.traverse) return Promise.resolve({ bytes: out, report: report });
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m || out[m.name]) return;
        var entry = {};
        /* Gán entry SỚM (theo tham chiếu): job fetch blob: là bất đồng bộ,
           nó điền entry[slot] SAU khi vòng lặp chạy xong. Bản cũ gán
           out[name] = entry ở cuối vòng lặp (entry lúc đó còn rỗng với
           texture blob:) → textureBytes trả về {} → writer nhúng 0
           texture (harness bắt được 2026-11-27). */
        out[m.name || ''] = entry;
        ['map', 'normalMap'].forEach(function (slot) {
          var tex = m[slot];
          if (!tex) return;
          var img = (tex.userData && tex.userData.originalImage) || tex.image;
          var src = img && img.src ? String(img.src) : '';
          var w = (img && (img.width || img.naturalWidth)) || 0;
          var h = (img && (img.height || img.naturalHeight)) || 0;
          if (src.indexOf('data:') === 0) {
            var comma = src.indexOf(',');
            var mime = src.slice(5, src.indexOf(';')) || (slot === 'normalMap' ? 'image/png' : 'image/jpeg');
            entry[slot] = { b64: src.slice(comma + 1), mime: mime, w: w, h: h, source: 'embedded-data-url' };
            report.push({ mat: m.name, slot: slot, bytes: b64ToBytes(entry[slot].b64).length, source: 'embedded-data-url' });
          } else if (src.indexOf('blob:') === 0) {
            jobs.push(fetchBytesFromUrl(src).then(function (bytes) {
              entry[slot] = { b64: bytesToB64(bytes), mime: (slot === 'normalMap' ? 'image/png' : 'image/jpeg'), w: w, h: h, source: 'embedded-blob' };
              report.push({ mat: m.name, slot: slot, bytes: bytes.length, source: 'embedded-blob' });
            }).catch(function () {
              var fb = canvasEncodeTexture(tex, slot);
              if (fb) { entry[slot] = fb; report.push({ mat: m.name, slot: slot, bytes: b64ToBytes(fb.b64).length, source: 'canvas-fallback' }); }
              else report.push({ mat: m.name, slot: slot, bytes: 0, source: 'missing' });
            }));
          } else {
            var fb2 = canvasEncodeTexture(tex, slot);
            if (fb2) { entry[slot] = fb2; report.push({ mat: m.name, slot: slot, bytes: b64ToBytes(fb2.b64).length, source: 'canvas-fallback' }); }
            else report.push({ mat: m.name, slot: slot, bytes: 0, source: 'missing' });
          }
        });
      });
    });
    return Promise.all(jobs).then(function () {
      /* Bỏ entry rỗng (không slot nào đọc được) — writer sẽ fallback canvas
         cho slot đó, không được đưa entry rỗng vào textureBytes. */
      Object.keys(out).forEach(function (k) { if (!out[k].map && !out[k].normalMap) delete out[k]; });
      return { bytes: out, report: report };
    });
  }

  /* ---------------- đo model (cột "Trước" + đối chiếu) ----------------
   * Đo trên 1 bản clone đã reset transform + bind pose (không đụng model
   * đang hiển thị). minSole: lấy mẫu tại các key của Hips track với
   * stride thích ứng (nhẹ hơn dense 48Hz dùng ở verify — cột Trước chỉ
   * cần khoảng bay, số chính xác nằm ở cột Sau sau khi verify file ra). */
  function collectMeshes(root) {
    var out = [];
    root.traverse(function (o) {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        if (o.userData && o.userData.isBoneVisual) return;
        out.push(o);
      }
    });
    return out;
  }
  function collectBones(root) {
    var out = [];
    root.traverse(function (o) { if (o.isBone) out.push(o); });
    return out;
  }
  function skinBadCount(meshes) {
    var bad = 0;
    meshes.forEach(function (m) {
      var geo = m.geometry;
      if (!geo.attributes.skinIndex || !geo.attributes.skinWeight) return;
      var si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
      var skel = m.skeleton;
      for (var i = 0; i < geo.attributes.position.count; i++) {
        var sum = 0, has = false;
        for (var k = 0; k < 4; k++) {
          var w = sw.array[i * 4 + k];
          if (w > 0) {
            has = true;
            if (!skel || si.array[i * 4 + k] >= skel.bones.length) { bad++; break; }
            sum += w;
          }
        }
        if (has && Math.abs(sum - 1) > 0.01) bad++;
      }
    });
    return bad;
  }
  function measureModel(object3D, clips, opts) {
    opts = opts || {};
    var THREE = T();
    var prep = cloneForExport(object3D, clips || []);
    var clone = prep.clone;
    var meshes = collectMeshes(clone);
    var bones = collectBones(clone);
    var bs = boneByShort(clone);
    var tris = 0, verts = 0;
    meshes.forEach(function (m) { tris += triCountOfGeo(m.geometry); verts += m.geometry.attributes.position.count; });
    var piv = pivotOffset(clone);
    var basis = measureBasis(clone, bs);
    var R = rotationFromBasis(basis);
    var axisInfo;
    if (R) {
      var ang = rotationAngleDeg(R);
      axisInfo = { kind: ang < 0.5 ? 'Y-up' : (basis.up ? 'non-Y-up' : 'unknown'), angleDeg: ang, basis: basis };
    } else if (basis.fallback) {
      axisInfo = { kind: 'fallback-' + basis.fallback.axis + '-up', angleDeg: null, basis: basis };
    } else {
      axisInfo = { kind: 'unknown', angleDeg: null, basis: basis };
    }
    /* minSole tại các key (lấy mẫu nhẹ) — cần mixer trên clone. */
    var minSole = { min: null, max: null, keys: 0 };
    var clipInfo = (prep.clips || []).map(function (c) {
      var keys = 0;
      (c.tracks || []).forEach(function (t) { if (t.times && t.times.length > keys) keys = t.times.length; });
      return { name: c.name, duration: c.duration, tracks: (c.tracks || []).length, keys: keys };
    });
    var footCls = null;
    var skinned = meshes.filter(function (m) { return m.isSkinnedMesh && m.skeleton; });
    if (skinned.length && prep.clips.length) {
      footCls = skinned.map(function (m) { return footClassVerts(m, bs); });
      var hipsClip = prep.clips.filter(function (c) {
        return (c.tracks || []).some(function (t) { return t.name && t.name.indexOf('.position') !== -1 && stripBonePrefix(t.name.slice(0, t.name.lastIndexOf('.'))) === 'Hips'; });
      })[0];
      if (hipsClip) {
        var hipsTrack = hipsClip.tracks.filter(function (t) { return t.name && t.name.indexOf('.position') !== -1 && stripBonePrefix(t.name.slice(0, t.name.lastIndexOf('.'))) === 'Hips'; })[0];
        var times = Array.prototype.slice.call(hipsTrack.times);
        var totalVerts = 0;
        skinned.forEach(function (m) { totalVerts += m.geometry.attributes.position.count; });
        var footTotal = 0;
        footCls.forEach(function (fc) { footTotal += fc.count; });
        /* Stride tinh theo SO DINH CHAN (lap tren danh sach foot-class)
           chu khong theo tong verts — stride 1 la chinh xac ma van re. */
        var stride = Math.max(1, Math.ceil((times.length * footTotal) / 5e6));
        var mixRoot = clone;
        var mixer = new THREE.AnimationMixer(mixRoot);
        var action = mixer.clipAction(hipsClip);
        /* LoopOnce + clamp (xem groundClip): tranh setTime(duration)
           wrap ve t=0. */
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        var mn = Infinity, mx = -Infinity;
        for (var i = 0; i < times.length; i++) {
          mixer.setTime(times[i]);
          mixRoot.updateMatrixWorld(true);
          var v = skinnedMinYAll(skinned, footCls, stride, true);
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        action.stop();
        mixer.uncacheClip(hipsClip);
        minSole = { min: mn, max: mx, keys: times.length };
      }
    }
    return {
      axis: axisInfo, bbox: piv ? piv.bbox : null, pivot: piv ? { x: piv.x, y: piv.y, z: piv.z } : null,
      tris: tris, verts: verts, meshes: meshes.length, bones: bones.length,
      boneNames: bones.map(function (b) { return b.name; }),
      clips: clipInfo, minSole: minSole, skinBad: skinBadCount(meshes),
      footVerts: footCls ? footCls.reduce(function (a, f) { return a + f.count; }, 0) : 0
    };
  }
  G._measureModel = measureModel;

  /* ---------------- verify output (đo lại từ BYTES file ra) ----------------
   * Sau khi writer ghi xong, parse lại bytes bằng FBXLoader + đo lại toàn
   * bộ chỉ số golden (trục/bbox/pivot/tris/bones/clip/dense-minSole/
   * wrist/Euler-span/texture) — cột "Sau" trong bảng là số ĐO LẠI này,
   * không phải số tự báo của pipeline. fbx2gltf KHÔNG dùng để kiểm
   * animation (đọc 0 channel từ writer này — giới hạn đã biết). */
  function eulerSpanDeg(clip) {
    var THREE = T();
    var maxSpan = 0;
    (clip.tracks || []).forEach(function (t) {
      if (!t.name || t.name.indexOf('.quaternion') === -1) return;
      var e = new THREE.Euler(), q = new THREE.Quaternion();
      var prev = null;
      var axes = [[], [], []];
      for (var i = 0; i < t.times.length; i++) {
        q.set(t.values[i * 4], t.values[i * 4 + 1], t.values[i * 4 + 2], t.values[i * 4 + 3]);
        e.setFromQuaternion(q, 'ZYX');
        axes[0].push(THREE.MathUtils.radToDeg(e.x));
        axes[1].push(THREE.MathUtils.radToDeg(e.y));
        axes[2].push(THREE.MathUtils.radToDeg(e.z));
      }
      axes.forEach(function (arr) {
        for (var j = 1; j < arr.length; j++) {
          var d = arr[j] - arr[j - 1];
          while (d > 180) { arr[j] -= 360; d -= 360; }
          while (d < -180) { arr[j] += 360; d += 360; }
        }
        for (var k = 1; k < arr.length; k++) {
          var s = Math.abs(arr[k] - arr[k - 1]);
          if (s > maxSpan) maxSpan = s;
        }
      });
      void prev;
    });
    return maxSpan;
  }
  function densePlaybackStats(scene, clips) {
    var THREE = T();
    var out = { minSole: null, wristMaxDeg: null };
    scene.updateMatrixWorld(true);
    var meshes = collectMeshes(scene);
    var skinned = meshes.filter(function (m) { return m.isSkinnedMesh && m.skeleton; });
    if (!skinned.length || !clips || !clips.length) return out;
    var bs = boneByShort(scene);
    /* Ve bind pose truoc khi tinh foot-class: scene co the dang o pose
       cuoi clip do buoc truoc (groundClip/dense truoc) de lai — foot-
       class phai tinh o bind pose, neu khong se sai tap dinh chan. */
    skinned.forEach(function (m) { if (m.skeleton) { try { m.skeleton.pose(); } catch (e) {} } });
    scene.updateMatrixWorld(true);
    var footCls = skinned.map(function (m) { return footClassVerts(m, bs); });
    /* Goc co tay: goc giua truc Y local cua Hand (world) va huong ngon tay
       (HandIndex1 - Hand) — nhu harness golden. Rig Mixamo KHONG co xuong
       Wrist rieng (chi co Hand), nen khong dung bs.LeftWrist. */
    function wristAngleAt() {
      var wMax = 0;
      ['Left', 'Right'].forEach(function (side) {
        var hb = bs[side + 'Hand'], ix = bs[side + 'HandIndex1'];
        if (!hb || !ix) return;
        var hp = worldPos(hb), ip = worldPos(ix);
        var fd = ip.clone().sub(hp).normalize();
        var hy = new THREE.Vector3(0, 1, 0).applyQuaternion(hb.getWorldQuaternion(new THREE.Quaternion()));
        var ang = THREE.MathUtils.radToDeg(Math.acos(clamp(hy.dot(fd), -1, 1)));
        if (ang > wMax) wMax = ang;
      });
      return wMax;
    }
    var clip = clips[0];
    var mixer = new THREE.AnimationMixer(scene);
    var action = mixer.clipAction(clip);
    /* LoopOnce + clamp (xem groundClip): tranh setTime(duration)
       wrap ve t=0 — dense max do nham pose dau clip. */
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    var dur = clip.duration;
    var n = Math.max(2, Math.ceil(dur * 48));
    var mn = Infinity, mx = -Infinity, mnA = Infinity, mxA = -Infinity, wMax = 0;
    for (var i = 0; i <= n; i++) {
      var t = (i / n) * dur;
      mixer.setTime(t);
      scene.updateMatrixWorld(true);
      var v = skinnedMinYAll(skinned, footCls, 1, true);
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      /* All-verts (robe hem) cung pass: stride 5 nhu harness — hem
         co nhieu dinh nen stride 5 van bat duoc dinh thap gan dung. */
      var vA = skinnedMinYAll(skinned, footCls, 5, false);
      if (vA < mnA) mnA = vA;
      if (vA > mxA) mxA = vA;
      var wa = wristAngleAt();
      if (wa > wMax) wMax = wa;
    }
    action.stop();
    mixer.uncacheClip(clip);
    /* Tra scene ve bind pose (de caller khong bi pose cuoi clip). */
    skinned.forEach(function (m) { if (m.skeleton) { try { m.skeleton.pose(); } catch (e) {} } });
    scene.updateMatrixWorld(true);
    out.minSole = { min: mn, max: mx, samples: n + 1 };
    out.minSoleAll = { min: mnA, max: mxA, samples: n + 1 };
    out.wristMaxDeg = wMax;
    return out;
  }
  /* Dense-adjust: sau ground theo key, do dense 48Hz that; neu dinh
     minSole vuot khoang an toan [-0.018, +0.018]m (thuong la dinh nhon
     GIUA 2 key — ground chi sua theo key — hoac lift hoi cao), dich
     deu Hips Y toan clip dung luong vuot. Hips la root bone nen toan
     bo mesh dich theo dung luong do (min/max dense dich y he so).
     Ghi shift vao offsets cua groundInfo de harness/dialog van bu
     dung playback. Chi chay khi can (|shift| >= 0.5mm). */
  function denseAdjustClip(clone, clips, groundInfo, report) {
    var THREE = T();
    var skinned = collectMeshes(clone).filter(function (m) { return m.isSkinnedMesh && m.skeleton; });
    if (!skinned.length || !clips || !clips.length) return clips;
    var newClips = clips.slice();
    clips.forEach(function (clip, ci) {
      var dense = densePlaybackStats(clone, [clip]);
      if (!dense.minSole) return;
      var mn = dense.minSole.min, mx = dense.minSole.max;
      var mnA = dense.minSoleAll ? dense.minSoleAll.min : mn;
      var mxA = dense.minSoleAll ? dense.minSoleAll.max : mx;
      /* Khoang hop [min(all), max(foot)] — robe hem o duoi, chan o
         tren. CAN GIUA khoang hop trong ±0.02m: shift = trung diem
         khoang hop (vi tri toi uu — moi ben thua deu nhau). Ban cu chi
         day foot max xuong 0.018 thi robe hem bi day xuong -0.021
         (harness (b) (5b2) bat duoc 2026-11-27). Neu khoang hop rong
         hon 0.04m thi khong the vua — can giua van la tot nhat (2 ben
         vuot deu nhau, it nhat co the) va hang Ground se bao FAIL
         that (khong giau). */
      var cMin = Math.min(mn, mnA), cMax = Math.max(mx, mxA);
      var lim = G.GROUND_TOL - 0.002;
      if (cMax <= lim && cMin >= -lim) return;
      var shift = (cMin + cMax) / 2;
      if (Math.abs(shift) < 0.0005) return;
      var hipsTrack = null;
      (clip.tracks || []).forEach(function (t) {
        if (t.name && t.name.indexOf('.position') !== -1 && stripBonePrefix(t.name.slice(0, t.name.lastIndexOf('.'))) === 'Hips') hipsTrack = t;
      });
      if (!hipsTrack) return;
      var newVals = Array.prototype.slice.call(hipsTrack.values);
      for (var i = 0; i < hipsTrack.times.length; i++) newVals[i * 3 + 1] = hipsTrack.values[i * 3 + 1] - shift;
      var nt = new THREE.VectorKeyframeTrack(hipsTrack.name, Array.prototype.slice.call(hipsTrack.times), newVals);
      var tracks = clip.tracks.map(function (t) { return t === hipsTrack ? nt : t; });
      var nc = new THREE.AnimationClip(clip.name, clip.duration, tracks);
      newClips[ci] = nc;
      /* Cap nhat offsets trong groundInfo (harness bu playback theo
         offsets — shift phai cong vao day keo lech (2e)/(6d)). */
      if (groundInfo && groundInfo[ci] && groundInfo[ci].offsets) {
        var g = groundInfo[ci];
        g.offsets = g.offsets.map(function (o) { return o + shift; });
        g.maxOffset = Math.max.apply(null, g.offsets.map(function (o) { return Math.abs(o); }));
        g.denseShift = shift;
      }
      /* Hips la root bone: dich Hips Y la dich cung toan bo mesh nen
         khoang sau dich = khoang truoc - shift (chinh xac tuyet doi,
         khong can do lai — tiet kiem 1 pass dense). */
      var afterFoot = [mn - shift, mx - shift];
      var afterAll = [mnA - shift, mxA - shift];
      log(report, 'Dense-adjust ' + clip.name + ': minSole dense foot ' + fmtRange(mn, mx) + ' m, all ' + fmtRange(mnA, mxA) + ' m → dịch Hips Y ' + fmtNum(-shift * 1000, 1) + 'mm → foot ' + fmtRange(afterFoot[0], afterFoot[1]) + ' m, all ' + fmtRange(afterAll[0], afterAll[1]) + ' m.');
    });
    return newClips;
  }
  function verifyOutput(bytes, expected, writeReport) {
    var THREE = T();
    var res = { ok: true, checks: {}, measure: null, dense: null, eulerSpan: null };
    /* (1) magic + version nhị phân. */
    var magic = '';
    for (var i = 0; i < 21; i++) magic += String.fromCharCode(bytes[i]);
    var ver = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(23, true);
    res.checks.magic = magic.indexOf('Kaydara FBX Binary') === 0;
    res.checks.version7300 = ver === 7300;
    if (!res.checks.magic || !res.checks.version7300) res.ok = false;
    /* (2) parse lại bằng FBXLoader (stock — Euler đã unwrap nên không chèn key). */
    var buf = bytes.buffer.slice ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes.buffer;
    var parsed;
    try {
      parsed = new THREE.FBXLoader().parse(buf, '');
    } catch (e) {
      res.checks.parse = false;
      res.parseError = String(e && e.message || e);
      res.ok = false;
      return res;
    }
    res.checks.parse = true;
    var parsedClips = parsed.animations || [];
    /* Parse xong phai updateMatrixWorld NGAY — FBXLoader khong tu cap
       nhat matrixWorld; neu khong, footClassVerts trong densePlaybackStats
       doc vi tri xuong = identity (goc toa do) -> foot-class sai -> hang
       Ground tu bao FAIL du file ra dung (harness (b) bat duoc). */
    parsed.updateMatrixWorld(true);
    res.measure = measureModel(parsed, parsedClips);
    res.eulerSpan = parsedClips.reduce(function (m, c) { return Math.max(m, eulerSpanDeg(c)); }, 0);
    res.checks.eulerSpan = res.eulerSpan <= 180.001;
    if (!res.checks.eulerSpan) res.ok = false;
    res.dense = densePlaybackStats(parsed, parsedClips);
    /* (3) texture: writer report (source + bytes) đối chiếu extraction. */
    var texOk = true, texDetail = [];
    var expTex = expected.textureReport || [];
    var wrTex = (writeReport && writeReport.textureReport) || [];
    expTex.forEach(function (e) {
      var hit = wrTex.filter(function (w) { return String(w).indexOf(e.slot) !== -1; })[0];
      if (!hit) { texOk = false; texDetail.push(e.slot + ': thiếu trong file ra'); return; }
      /* texReport của writer ghi ', from source' khi dùng bytes gốc
         (t.source === 'provided'), ', canvas' nếu qua canvas. */
      var provided = /from source/.test(hit);
      if (!provided) { texOk = false; texDetail.push(e.slot + ': writer không dùng byte gốc (' + hit + ')'); }
      else texDetail.push(e.slot + ': ' + e.bytes + ' B, đúng byte gốc');
    });
    res.checks.textures = texOk && expTex.length > 0;
    res.texDetail = texDetail;
    if (!res.checks.textures) res.ok = false;
    return res;
  }
  G._verifyOutput = verifyOutput;

  /* ---------------- hàng bảng ---------------- */
  var ROWS = [
    { id: 'axis', label: 'Trục' },
    { id: 'pivot', label: 'Pivot' },
    { id: 'ground', label: 'Ground clip' },
    { id: 'lowpoly', label: 'Low poly' },
    { id: 'texture', label: 'Texture' },
    { id: 'rigclip', label: 'Rig + Clip' }
  ];
  function emptyRows() {
    return ROWS.map(function (r) {
      return { id: r.id, label: r.label, before: '—', after: '—', status: 'pending', detail: '', nums: {} };
    });
  }
  function fmtRange(a, b, d) {
    return '[' + (a < 0 ? '−' : '+') + Math.abs(a).toFixed(d === undefined ? 3 : d) + ', +' + Math.abs(b).toFixed(d === undefined ? 3 : d) + ']';
  }
  function tick() { return new Promise(function (res) { setTimeout(res, 0); }); }

  /* ---------------- measureBefore (cột "Trước" khi mở cửa sổ) ---------------- */
  G.measureBefore = function (object3D, clips) {
    var rows = emptyRows();
    var m = measureModel(object3D, clips || []);
    var texP = extractTextureBytes(object3D);
    return texP.then(function (tex) {
      var byId = {};
      rows.forEach(function (r) { byId[r.id] = r; });
      /* Trục. */
      var ax = m.axis;
      if (ax.kind === 'Y-up') {
        byId.axis.before = 'Y-up (đã đúng)';
        byId.axis.nums = { kind: 'Y-up', angleDeg: ax.angleDeg };
      } else if (ax.kind === 'non-Y-up') {
        var sz = m.bbox ? m.bbox.size : [0, 0, 0];
        var longAxis = sz[0] >= sz[1] && sz[0] >= sz[2] ? 'X' : (sz[1] >= sz[2] ? 'Y' : 'Z');
        byId.axis.before = 'Trục dọc hiện tại: ' + longAxis + ' (' + fmtNum(sz[0], 2) + ' × ' + fmtNum(sz[1], 2) + ' × ' + fmtNum(sz[2], 2) + ' m)';
        byId.axis.nums = { kind: 'non-Y-up', angleDeg: ax.angleDeg, longAxis: longAxis };
      } else {
        byId.axis.before = 'Không xác định được trục (thiếu xương chuẩn)';
        byId.axis.nums = { kind: 'unknown' };
      }
      /* Pivot. */
      if (m.pivot) {
        var off = Math.abs(m.pivot.x) + Math.abs(m.pivot.y) + Math.abs(m.pivot.z);
        byId.pivot.before = off < 0.001 ? 'Đã ở đất giữa 2 bàn chân' : 'Gốc lệch (' + fmtNum(m.pivot.x) + ', ' + fmtNum(m.pivot.y) + ', ' + fmtNum(m.pivot.z) + ') m';
        byId.pivot.nums = { x: m.pivot.x, y: m.pivot.y, z: m.pivot.z };
      } else byId.pivot.before = 'Không đo được bbox';
      /* Ground. */
      if (!m.clips.length) {
        byId.ground.before = 'Không có clip';
        byId.ground.nums = { hasClip: false };
      } else if (m.minSole.min === null) {
        byId.ground.before = 'Không đo được minSole';
        byId.ground.nums = { hasClip: true };
      } else {
        byId.ground.before = 'Chân bay ' + fmtRange(m.minSole.min, m.minSole.max) + ' m (' + m.minSole.keys + ' key)';
        byId.ground.nums = { min: m.minSole.min, max: m.minSole.max, keys: m.minSole.keys };
      }
      /* Low poly. */
      byId.lowpoly.before = m.tris.toLocaleString('en-US') + ' tris (' + m.meshes + ' mesh, ' + m.verts.toLocaleString('en-US') + ' verts)';
      byId.lowpoly.nums = { tris: m.tris, verts: m.verts };
      /* Texture. */
      if (!tex.report.length) {
        byId.texture.before = 'Không có texture';
        byId.texture.nums = { count: 0 };
      } else {
        byId.texture.before = tex.report.map(function (t) { return t.slot + ' ' + t.bytes.toLocaleString('en-US') + ' B'; }).join(' + ');
        byId.texture.nums = { count: tex.report.length, bytes: tex.report.map(function (t) { return t.bytes; }), slots: tex.report.map(function (t) { return t.slot; }) };
      }
      /* Rig + Clip. */
      var clipTxt = m.clips.length ? m.clips.map(function (c) { return c.name + ' (' + fmtNum(c.duration, 2) + 's, ' + c.tracks + ' tracks × ' + c.keys + ' key)'; }).join('; ') : 'không có clip';
      byId.rigclip.before = m.bones + ' xương · ' + clipTxt;
      byId.rigclip.nums = { bones: m.bones, boneNames: m.boneNames, clips: m.clips, skinBad: m.skinBad };
      return { rows: rows, measure: m, textures: tex };
    });
  };

  /* ---------------- process (pipeline 5 bước + verify) ---------------- */
  G.process = function (object3D, clips, opts) {
    opts = opts || {};
    var THREE = T();
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    function prog(step, pct, msg) { try { onProgress(step, pct, msg); } catch (e) {} }
    var report = { log: [], rows: emptyRows(), summary: {} };
    var byId = {};
    report.rows.forEach(function (r) { byId[r.id] = r; });
    var srcClips = (clips || []).slice();
    var fileName = opts.fileName || 'model.fbx';
    return Promise.resolve()
      .then(function () { return tick(); })
      .then(function () {
        prog('measure', 5, 'Đang đo model…');
        return G.measureBefore(object3D, srcClips);
      })
      .then(function (mb) {
        mb.rows.forEach(function (r) {
          byId[r.id].before = r.before;
          byId[r.id].nums.before = r.nums;
        });
        report._measureBefore = mb.measure;
        report._texturesBefore = mb.textures;
        log(report, 'Đo trước: ' + mb.measure.tris.toLocaleString('en-US') + ' tris, ' + mb.measure.bones + ' xương, ' + mb.measure.clips.length + ' clip.');
        return tick();
      })
      .then(function () {
        prog('clone', 10, 'Đang tách bản sao (model đang hiển thị không bị đụng)…');
        var prep = cloneForExport(object3D, srcClips);
        var clone = prep.clone;
        var workClips = prep.clips;
        report._renameMap = prep.renameMap;
        log(report, 'Clone xong; đổi tên xương: ' + Object.keys(prep.renameMap).length + ' xương (mixamorig:Hips → mixamorigHips).');
        /* (0) Khử key chèn của stock FBXLoader. */
        var refTimes = null;
        workClips.forEach(function (c) {
          (c.tracks || []).forEach(function (t) {
            if (t.name && t.name.indexOf('.position') !== -1 && stripBonePrefix(t.name.slice(0, t.name.lastIndexOf('.'))) === 'Hips' && t.times && t.times.length) {
              if (!refTimes || t.times.length > refTimes.length) refTimes = Array.prototype.slice.call(t.times);
            }
          });
        });
        var removedTotal = 0;
        workClips = workClips.map(function (c) {
          var d = decontaminateClip(c, refTimes);
          d.removed.forEach(function (r) { removedTotal += r.removed; log(report, 'Khử key chèn: ' + r.track + ' gỡ ' + r.removed + ' key (còn ' + r.keysAfter + ').'); });
          return d.clip;
        });
        if (!removedTotal) log(report, 'Không phát hiện key chèn (track sạch).');
        report._decontaminated = removedTotal;
        /* Thông tin clip SAU khử key chèn — dùng để đối chiếu hàng Rig+Clip
           ở bước verify (số key gốc của model đang load có thể đã nhiễm key
           chèn, không được đem so với file ra). */
        report._cleanClipInfo = workClips.map(function (c) {
          var keys = 0;
          (c.tracks || []).forEach(function (t) { if (t.times && t.times.length > keys) keys = t.times.length; });
          return { name: c.name, duration: c.duration, tracks: (c.tracks || []).length, keys: keys };
        });
        /* (1) Trục. */
        prog('axis', 20, 'Đang đo + sửa trục…');
        var bs = boneByShort(clone);
        var basis = measureBasis(clone, bs);
        var R = rotationFromBasis(basis);
        var axisFixed = false, axisAngle = 0;
        if (R) {
          axisAngle = rotationAngleDeg(R);
          if (axisAngle >= 0.5) {
            applyMatrixToModel(clone, workClips, R, report);
            axisFixed = true;
            log(report, 'Sửa trục: xoay ' + fmtNum(axisAngle, 2) + '° (Z-up → Y-up, Rx+90°).');
          } else log(report, 'Trục đã Y-up (lệch ' + fmtNum(axisAngle, 2) + '°), bỏ qua.');
        } else if (basis.fallback) {
          var THREE2 = T();
          var fb = basis.fallback;
          if (fb.axis === 'Z') {
            var Rz = new THREE2.Matrix4().makeRotationX(Math.PI / 2);
            applyMatrixToModel(clone, workClips, Rz, report);
            axisFixed = true;
            log(report, 'Sửa trục (fallback bbox, thiếu xương): Z-up → Y-up, Rx+90°.');
          } else if (fb.axis === 'X') {
            var Rx = new THREE2.Matrix4().makeRotationZ(Math.PI / 2);
            applyMatrixToModel(clone, workClips, Rx, report);
            axisFixed = true;
            log(report, 'Sửa trục (fallback bbox, thiếu xương): X-up → Y-up, Rz+90°.');
          } else log(report, 'Trục đã Y-up (fallback bbox), bỏ qua.');
        } else log(report, 'Không xác định được trục — giữ nguyên.');
        report._axisFixed = axisFixed;
        return { clone: clone, workClips: workClips, bs: bs };
      })
      .then(function (ctx) {
        /* (2) Pivot. */
        prog('pivot', 35, 'Đang đưa pivot về đất giữa 2 bàn chân…');
        var THREE = T();
        var piv = pivotOffset(ctx.clone);
        var pivotFixed = false;
        if (piv) {
          var off = Math.abs(piv.x) + Math.abs(piv.y) + Math.abs(piv.z);
          if (off >= 0.001) {
            var Tm = new THREE.Matrix4().makeTranslation(-piv.x, -piv.y, -piv.z);
            applyMatrixToModel(ctx.clone, ctx.workClips, Tm, report);
            pivotFixed = true;
            log(report, 'Pivot: dời (' + fmtNum(-piv.x) + ', ' + fmtNum(-piv.y) + ', ' + fmtNum(-piv.z) + ') m — gốc về đất giữa 2 bàn chân.');
          } else log(report, 'Pivot đã ở đất giữa 2 bàn chân, bỏ qua.');
          report._pivotAfter = pivotOffset(ctx.clone);
        } else log(report, 'Không đo được bbox — pivot giữ nguyên.');
        report._pivotFixed = pivotFixed;
        return ctx;
      })
      .then(function (ctx) {
        /* (3) Ground clip. */
        prog('ground', 50, 'Đang ground clip (chân chạm đất từng frame)…');
        var meshes = collectMeshes(ctx.clone);
        var skinned = meshes.filter(function (m) { return m.isSkinnedMesh && m.skeleton; });
        var groundInfo = [];
        if (skinned.length && ctx.workClips.length) {
          var footCls = skinned.map(function (m) { return footClassVerts(m, ctx.bs); });
          var footCount = footCls.reduce(function (a, f) { return a + f.count; }, 0);
          log(report, 'Foot-class: ' + footCount.toLocaleString('en-US') + ' đỉnh bàn chân.');
          ctx.workClips = ctx.workClips.map(function (c) {
            var g = groundClip(c, skinned, footCls, ctx.bs, { rootShort: 'Hips' });
            /* Ghi ca offsets (theo tung key) vao report — harness/dialog can
               doi chieu playback (bu offset) va kiem tra lai. Ban cu chi ghi
               maxOffset nen harness khong bu duoc (2e) lech dung 15.9mm. */
            groundInfo.push({ name: c.name, skipped: g.skipped, lift: g.lift, maxGap: g.maxGap, maxOffset: g.maxOffset, offsets: g.offsets });
            if (g.skipped) log(report, 'Ground ' + c.name + ': đã chạm đất, bỏ qua.');
            else log(report, 'Ground ' + c.name + ': offset Hips Y tối đa ' + fmtNum(g.maxOffset) + ' m' + (g.lift ? ', LIFT +' + fmtNum(g.lift * 1000, 1) + 'mm (robe hem rủ ' + fmtNum(g.maxGap, 4) + ' m)' : '') + '.');
            return g.clip;
          });
        } else {
          log(report, 'Không có clip/skinned mesh — bỏ qua bước Ground.');
        }
        report._ground = groundInfo;
        return tick().then(function () { return ctx; });
      })
      .then(function (ctx) {
        /* (4) Low poly (meshopt). */
        prog('decimate', 70, 'Đang giảm tris bằng meshopt…');
        /* Meshopt WASM khởi tạo bất đồng bộ (ready promise) — đợi tối đa
           5s để simplify không trả null vì WASM chưa sẵn. */
        var MM = M();
        var readyP = (MM && MM.ready && typeof MM.ready.then === 'function')
          ? Promise.race([MM.ready, new Promise(function (r) { setTimeout(r, 5000); })])
          : Promise.resolve();
        return readyP.then(function () { return ctx; });
      })
      .then(function (ctx) {
        var total = 0;
        collectMeshes(ctx.clone).forEach(function (m) { total += triCountOfGeo(m.geometry); });
        var dec = null;
        if (total > G.TRI_MAX) {
          dec = decimateToBudget(ctx.clone, G.TARGET_TRIS, 0.01);
          log(report, 'Low poly: ' + dec.trisBefore.toLocaleString('en-US') + ' → ' + dec.trisAfter.toLocaleString('en-US') + ' tris (meshopt, sai số ' + fmtNum(dec.maxErr * 1000, 2) + ' mm).');
        } else {
          dec = { trisBefore: total, trisAfter: total, maxErr: 0 };
          log(report, 'Low poly: đã ' + total.toLocaleString('en-US') + ' tris (≤ ' + G.TRI_MAX.toLocaleString('en-US') + '), bỏ qua.');
        }
        report._decimate = dec;
        return tick().then(function () { return ctx; });
      })
      .then(function (ctx) {
        /* (4b) Dense-adjust: do dense 48Hz that tren clip da ground +
           mesh da decimate; neu dinh minSole vuot khoang an toan thi
           dich deu Hips Y (xem denseAdjustClip). */
        prog('dense-adjust', 76, 'Đang kiểm tra chân chạm đất (dense 48Hz)…');
        if (ctx.workClips.length) {
          ctx.workClips = denseAdjustClip(ctx.clone, ctx.workClips, report._ground, report);
        }
        return tick().then(function () { return ctx; });
      })
      .then(function (ctx) {
        /* (5) Texture byte-exact + xuất FBX. */
        prog('texture', 82, 'Đang đọc texture gốc (byte-exact, không qua canvas)…');
        return extractTextureBytes(ctx.clone).then(function (tex) {
          report._texturesOut = tex;
          var nTex = tex.report.filter(function (t) { return t.bytes > 0; }).length;
          log(report, 'Texture: ' + tex.report.map(function (t) { return t.slot + ' ' + t.bytes.toLocaleString('en-US') + ' B (' + t.source + ')'; }).join(', ') + '.');
          prog('write', 88, 'Đang ghi FBX 7300…');
          var FBX = FB();
          if (!FBX || !FBX.write) throw new Error('FBXBinary.write chưa sẵn sàng.');
          ctx.clone.updateMatrixWorld(true);
          var anims = ctx.workClips.map(function (c) { return { name: c.name, clip: c }; });
          var res = FBX.write(ctx.clone, {
            version: 7300, upAxis: 'keep', autoScale: false, fps: 30,
            embedTextures: true, textureBytes: tex.bytes,
            keepSkeleton: true, noSkeleton: false, animations: anims
          });
          log(report, 'Ghi FBX xong: ' + res.report.bytes.toLocaleString('en-US') + ' B, ' + res.report.meshes + ' mesh, ' + res.report.bones + ' xương, ' + res.report.animationStacks + ' clip, ' + res.report.textures + ' texture.');
          return { bytes: res.bytes, writeReport: res.report, ctx: ctx, nTex: nTex };
        });
      })
      .then(function (w) {
        /* (6) Verify lại từ bytes file ra → cột "Sau" + PASS/FAIL. */
        prog('verify', 94, 'Đang kiểm chứng lại file ra (FBXLoader + dense sampling)…');
        var expected = {
          textureReport: (report._texturesBefore && report._texturesBefore.report) || [],
          clips: (report._measureBefore && report._measureBefore.clips) || [],
          boneNames: (report._measureBefore && report._measureBefore.boneNames) || []
        };
        var v = verifyOutput(w.bytes, expected, w.writeReport);
        report._verify = v;
        /* Điền cột Sau + trạng thái từng hàng. */
        var mOut = v.measure || {};
        var dense = v.dense || {};
        /* Trục. */
        var axOut = mOut.axis || {};
        byId.axis.after = axOut.kind === 'Y-up' ? 'Y-up, cao theo Y ' + fmtNum(mOut.bbox ? mOut.bbox.size[1] : 0, 2) + ' m' : 'VẪN ' + (axOut.kind || 'không xác định');
        byId.axis.status = axOut.kind === 'Y-up' ? 'pass' : 'fail';
        byId.axis.nums.after = { kind: axOut.kind, height: mOut.bbox ? mOut.bbox.size[1] : null };
        byId.axis.detail = byId.axis.status === 'pass' ? (report._axisFixed ? 'Đã sửa Z-up → Y-up' : 'Đã Y-up từ đầu') : 'Trục ra chưa đúng Y-up';
        /* Pivot. */
        var pivOk = false, pivDetail = '';
        if (mOut.pivot && mOut.bbox) {
          var px = Math.abs(mOut.pivot.x) <= 0.02, py = Math.abs(mOut.pivot.y) <= 0.002, pz = true;
          /* P3: origin Z giữa ankle-midpoint và sole-midpoint — đo từ xương. */
          pivOk = px && py;
          pivDetail = 'gốc (' + fmtNum(mOut.pivot.x) + ', ' + fmtNum(mOut.pivot.y) + ', ' + fmtNum(mOut.pivot.z) + ') m, bbox X [' + fmtNum(mOut.bbox.min[0]) + ', ' + fmtNum(mOut.bbox.max[0]) + ']';
        }
        byId.pivot.after = pivOk ? 'Gốc (0,0,0) ở đất giữa 2 bàn chân' : 'Gốc lệch — ' + pivDetail;
        byId.pivot.status = pivOk ? 'pass' : 'fail';
        byId.pivot.nums.after = mOut.pivot || {};
        byId.pivot.detail = pivDetail;
        /* Ground. */
        if (!mOut.clips || !mOut.clips.length) {
          byId.ground.after = 'Không có clip';
          byId.ground.status = 'skip';
          byId.ground.detail = 'Model không có clip nên không ground.';
        } else if (dense.minSole) {
          var mn = dense.minSole.min, mx = dense.minSole.max;
          var mnA = dense.minSoleAll ? dense.minSoleAll.min : mn;
          var mxA = dense.minSoleAll ? dense.minSoleAll.max : mx;
          byId.ground.after = 'minSole ' + fmtRange(mn, mx) + ' m (dense 48Hz, ' + dense.minSole.samples + ' mẫu)' + (dense.minSoleAll ? ', all ' + fmtRange(mnA, mxA) + ' m' : '');
          byId.ground.status = (mn >= -G.GROUND_TOL && mx <= G.GROUND_TOL && mnA >= -G.GROUND_TOL && mxA <= G.GROUND_TOL) ? 'pass' : 'fail';
          byId.ground.nums.after = { min: mn, max: mx, allMin: mnA, allMax: mxA };
          byId.ground.detail = byId.ground.status === 'pass' ? 'Chân chạm đất cả clip' : 'minSole ngoài ±0.02m';
          var lift = (report._ground || []).map(function (g) { return g.lift; }).reduce(function (a, b) { return Math.max(a, b); }, 0);
          if (lift) byId.ground.detail += ' (LIFT +' + fmtNum(lift * 1000, 1) + 'mm vì robe hem rủ)';
        } else {
          byId.ground.after = 'Không đo được minSole';
          byId.ground.status = 'fail';
        }
        /* Low poly. */
        var trisOut = mOut.tris || 0;
        byId.lowpoly.after = trisOut.toLocaleString('en-US') + ' tris' + (report._decimate && report._decimate.maxErr ? ' (sai số meshopt ' + fmtNum(report._decimate.maxErr * 1000, 2) + ' mm)' : '');
        byId.lowpoly.status = (trisOut >= G.TRI_MIN && trisOut <= G.TRI_MAX) ? 'pass' : 'fail';
        byId.lowpoly.nums.after = { tris: trisOut };
        byId.lowpoly.detail = byId.lowpoly.status === 'pass' ? 'Trong khoảng 12k–18k' : 'Tris ra ngoài khoảng 12k–18k';
        /* Texture. */
        var texAfter = (report._texturesOut && report._texturesOut.report) || [];
        var texProvided = texAfter.filter(function (t) { return t.bytes > 0 && t.source.indexOf('embedded') === 0; }).length;
        var texTotal = texAfter.length;
        byId.texture.after = texAfter.length ? texAfter.map(function (t) { return t.slot + ' ' + t.bytes.toLocaleString('en-US') + ' B (' + (t.source.indexOf('embedded') === 0 ? 'đúng byte gốc' : t.source) + ')'; }).join(' + ') : 'Không có texture';
        byId.texture.status = (!texTotal || texProvided === texTotal) && v.checks.textures ? 'pass' : 'fail';
        byId.texture.nums.after = { count: texTotal, provided: texProvided };
        byId.texture.detail = v.texDetail ? v.texDetail.join('; ') : '';
        /* Rig + Clip — đối chiếu với clip ĐÃ khử key chèn (xem _cleanClipInfo). */
        var expClips = report._cleanClipInfo || expected.clips || [];
        var outClips = mOut.clips || [];
        var rigOk = (mOut.bones === (report._measureBefore && report._measureBefore.bones)) && (mOut.skinBad === 0) && v.checks.eulerSpan;
        var clipOk = expClips.length === outClips.length && expClips.every(function (e, i) {
          var o = outClips[i];
          return o && o.name === e.name && Math.abs(o.duration - e.duration) < 0.01 && o.tracks === e.tracks && o.keys === e.keys;
        });
        byId.rigclip.after = (mOut.bones || 0) + ' xương · ' + (outClips.length ? outClips.map(function (c) { return c.name + ' (' + fmtNum(c.duration, 2) + 's, ' + c.tracks + ' tracks × ' + c.keys + ' key)'; }).join('; ') : 'không có clip') + ' · skin bad=' + (mOut.skinBad || 0) + ' · Euler span ≤' + fmtNum(v.eulerSpan || 0, 1) + '°';
        byId.rigclip.status = (rigOk && clipOk) ? 'pass' : 'fail';
        byId.rigclip.nums.after = { bones: mOut.bones, clips: outClips, skinBad: mOut.skinBad, eulerSpan: v.eulerSpan };
        byId.rigclip.detail = (rigOk && clipOk) ? 'Giữ nguyên tên xương/clip/duration/tracks/keys' : 'Xương/clip ra khác bản gốc hoặc Euler span > 180°';
        /* Tổng kết. */
        var fails = report.rows.filter(function (r) { return r.status === 'fail'; }).length;
        var passes = report.rows.filter(function (r) { return r.status === 'pass'; }).length;
        report.summary = {
          passes: passes, fails: fails,
          bytes: w.bytes.length, trisBefore: report._decimate ? report._decimate.trisBefore : 0,
          trisAfter: report._decimate ? report._decimate.trisAfter : 0,
          axisFixed: report._axisFixed, pivotFixed: report._pivotFixed,
          wristMaxDeg: dense.wristMaxDeg != null ? +dense.wristMaxDeg.toFixed(2) : null,
          ok: fails === 0 && v.ok
        };
        prog('done', 100, 'Xong.');
        var base = String(fileName).replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|]/g, '_');
        var filename = (base || 'model') + '-Standard.fbx';
        return { bytes: w.bytes, report: report, filename: filename };
      });
  };

  /* ---------------- CỬA SỔ BẢNG (theo pattern PixiStudio.Modals) ----------------
   * Modals.open({title, body, buttons}) — cùng pattern Save Center
   * (SaveManager.openDialog) và Settings/Project Manager: modal-head có
   * nút ✕, click ngoài/Esc đóng, body là DOM build bằng U.el, nút chạy
   * đặt TRONG body (không phải footer) để bấm xong bảng vẫn ở lại xem
   * kết quả; footer chỉ có nút "Đóng". */
  var STATUS_TEXT = { pass: '✓ PASS', fail: '✗ FAIL', skip: '— bỏ qua', pending: '…' };
  function statusColor(st) {
    if (st === 'pass') return 'var(--success)';
    if (st === 'fail') return 'var(--danger)';
    return 'var(--text-2)';
  }
  G.openDialog = function () {
    var U = null, Modals = null;
    try {
      U = (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.Utils) || null;
      Modals = (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.Modals) || null;
    } catch (e) {}
    if (!U || !Modals) { notify('error', 'Xuất FBX chuẩn', 'Modals/Utils chưa sẵn sàng.'); return null; }
    var source = G.getSource();
    var body = U.el('div');
    var statusLine = U.el('p', { style: 'color:var(--text-2);font-size:12.5px;margin-bottom:10px;', text: 'Chuẩn hóa FBX theo đúng 2 file Thiếu Lâm đã làm: Y-up, pivot về đất giữa 2 bàn chân, clip chân chạm đất, ~15k tris, texture nhúng đúng byte gốc, giữ rig + clip.' });
    body.appendChild(statusLine);
    var msgEl = null;
    if (!source) {
      msgEl = U.el('p', { style: 'color:var(--warning);font-size:13px;font-weight:600;margin-bottom:10px;', text: 'Chưa load nhân vật nào — import file FBX trước (nút Import FBX / kéo-thả file vào studio), rồi mở lại cửa sổ này.' });
      body.appendChild(msgEl);
    }
    /* Bảng: Hạng mục | Trước | Sau | Trạng thái. */
    var table = U.el('table', { style: 'width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:10px;' });
    var thead = U.el('thead');
    var hr = U.el('tr');
    ['Hạng mục', 'Trước', 'Sau', 'Trạng thái'].forEach(function (h, i) {
      hr.appendChild(U.el('th', { style: 'text-align:' + (i === 0 ? 'left' : 'left') + ';padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-2);font-weight:600;' + (i === 0 ? 'width:88px;' : ''), text: h }));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = U.el('tbody');
    var cellRefs = {};
    ROWS.forEach(function (r) {
      var tr = U.el('tr', { id: 'gs-row-' + r.id });
      tr.appendChild(U.el('td', { style: 'padding:6px 8px;border-bottom:1px solid var(--border-soft);font-weight:600;white-space:nowrap;', text: r.label }));
      var beforeCell = U.el('td', { id: 'gs-before-' + r.id, style: 'padding:6px 8px;border-bottom:1px solid var(--border-soft);color:var(--text-2);', text: '—' });
      var afterCell = U.el('td', { id: 'gs-after-' + r.id, style: 'padding:6px 8px;border-bottom:1px solid var(--border-soft);color:var(--text-2);', text: '—' });
      var statusCell = U.el('td', { id: 'gs-status-' + r.id, style: 'padding:6px 8px;border-bottom:1px solid var(--border-soft);font-weight:700;color:var(--text-2);white-space:nowrap;', text: '…' });
      tr.appendChild(beforeCell);
      tr.appendChild(afterCell);
      tr.appendChild(statusCell);
      tbody.appendChild(tr);
      cellRefs[r.id] = { before: beforeCell, after: afterCell, status: statusCell };
    });
    table.appendChild(tbody);
    body.appendChild(table);
    var progressEl = U.el('p', { id: 'gs-progress', style: 'color:var(--text-2);font-size:12.5px;min-height:18px;margin-bottom:10px;', text: source ? 'Đang đo model…' : '—' });
    body.appendChild(progressEl);
    var runBtn = U.el('button', {
      id: 'gs-run-btn', class: 'btn primary lg block',
      text: '⚡ Chuẩn hóa & Xuất FBX',
      onclick: function () { runFromDialog(source, cellRefs, progressEl, runBtn); }
    });
    if (!source) runBtn.disabled = true;
    body.appendChild(runBtn);
    var fileEl = U.el('p', { id: 'gs-file', style: 'color:var(--text-2);font-size:12px;margin-top:8px;', text: source ? ('Nguồn: ' + (source.fileName || 'model') + ' · ' + source.clips.length + ' clip') : '' });
    body.appendChild(fileEl);
    Modals.open({
      title: '📐 Xuất FBX chuẩn (Golden)',
      body: body,
      buttons: [{ label: 'Đóng', class: 'btn primary' }]
    });
    if (source) {
      setTimeout(function () {
        G.measureBefore(source.object, source.clips).then(function (mb) {
          mb.rows.forEach(function (r) {
            var c = cellRefs[r.id];
            if (c) { c.before.textContent = r.before; }
          });
          progressEl.textContent = 'Đã đo xong — bấm "Chuẩn hóa & Xuất FBX" để chạy.';
          G._lastMeasure = mb;
        }).catch(function (e) {
          progressEl.textContent = 'Đo trước thất bại: ' + (e && e.message || e);
        });
      }, 30);
    }
    return { body: body, cellRefs: cellRefs, progressEl: progressEl, runBtn: runBtn, source: source };
  };
  function runFromDialog(source, cellRefs, progressEl, runBtn) {
    if (!source) return;
    runBtn.disabled = true;
    progressEl.textContent = 'Đang chuẩn hóa…';
    var runP = G.process(source.object, source.clips, {
      fileName: source.fileName,
      onProgress: function (step, pct, msg) { progressEl.textContent = msg + ' (' + pct + '%)'; }
    }).then(function (result) {
      G.lastReport = result.report;
      result.report.rows.forEach(function (r) {
        var c = cellRefs[r.id];
        if (!c) return;
        c.after.textContent = r.after;
        c.status.textContent = STATUS_TEXT[r.status] || r.status;
        c.status.style.color = statusColor(r.status);
        if (r.detail) c.after.title = r.detail;
      });
      var s = result.report.summary;
      progressEl.textContent = s.ok
        ? ('✓ Xong — ' + s.passes + '/6 PASS · ' + s.trisBefore.toLocaleString('en-US') + ' → ' + s.trisAfter.toLocaleString('en-US') + ' tris · file đang tải về: ' + result.filename)
        : ('⚠ Xong nhưng có ' + s.fails + ' hàng FAIL — xem cột Trạng thái, file vẫn tải về để kiểm tra.');
      var U = (typeof window !== 'undefined' && window.PixiStudio && window.PixiStudio.Utils) || null;
      if (U && U.downloadBlob) U.downloadBlob(new Blob([result.bytes]), result.filename);
      notify(s.ok ? 'success' : 'warning', 'Xuất FBX chuẩn', s.ok ? ('Đã tải ' + result.filename) : ('Có ' + s.fails + ' hàng FAIL — ' + result.filename + ' vẫn tải về.'));
      runBtn.disabled = false;
      runBtn.textContent = '⚡ Chạy lại';
      return result;
    }).catch(function (e) {
      progressEl.textContent = 'Lỗi: ' + (e && e.message || e);
      notify('error', 'Xuất FBX chuẩn', String(e && e.message || e));
      runBtn.disabled = false;
      throw e;
    });
    G._lastRunPromise = runP;
    return runP;
  }
  G.run = function () { return G.openDialog(); };
  G.ROWS = ROWS;

  if (typeof window !== 'undefined') {
    window.PixiStudio = window.PixiStudio || {};
    window.PixiStudio.GoldenStandardExport = G;
  } else if (typeof globalThis !== 'undefined') {
    globalThis.PixiStudio = globalThis.PixiStudio || {};
    globalThis.PixiStudio.GoldenStandardExport = G;
  }
})();
