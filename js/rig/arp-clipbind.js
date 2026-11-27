/* ============================================================
 * rig/arp-clipbind.js — CLIPBIND-A (vòng clip-binding, bug a)
 * + CLIPBIND-C (2026-11-27 — khớp hiển thị "che" xương thật):
 *   Sau khi import, app.js autoShow dựng nhóm '__arp_canonical_skeleton__'
 *   (js/rig/arp-shared-skeleton.js ensureCanonicalJoints) NGAY DƯỚI model
 *   root: 41 Object3D thường tên NGẮN ('Hips','Spine',…,
 *   userData.isCanonicalJoint=true) — KHÔNG isBone. Track clip sau
 *   canonicalize là 'mixamorig:Hips.quaternion' → r128 parse ra nodeName
 *   'Hips' → findNode gốc (DFS theo tên) gặp khớp hiển thị tên 'Hips'
 *   TRƯỚC khi tới xương thật 'mixamorig:Hips' → CẢ 82 track bind vào
 *   khớp hiển thị, 0 track vào xương thật (đo thật trên trình duyệt:
 *   nToCanon=82, nToBone=0; mixer.time chạy 0.3→8.6s mà mọi khớp đứng
 *   yên tới 4 chữ số thập phân; syncCanonicalPose() sau đó còn ghi đè
 *   khớp hiển thị về pose xương thật đã đông cứng nên cả hai đều đứng
 *   yên). Lớp 1 (vá findNode) trước đây gọi orig() trước rồi tin kết
 *   quả — nên bị khớp hiển thị "che" mất.
 *   SỬA: mọi điểm khớp tên trong file này đều BỎ QUA node hiển thị
 *   (userData.isCanonicalJoint / isBoneVisual — cờ chỉ VP display mới
 *   đặt, không bao giờ là target animation thật): patchedFindNode coi
 *   hit hiển thị là miss rồi rơi xuống resolveNode; findExact +
 *   fallback không phân biệt hoa/thường cũng bỏ qua chúng. Track trỏ
 *   xương thật sự không có vẫn rơi về root như hành vi gốc.
 *
 * VẤN ĐỀ (đo thật trên clip Run Thiếu Lâm, file
 * thieulam-Rigged-AttackRun.fbx — xem harness
 * test-clip-binding-names.js):
 *   • FBXLoader r128 parse ra xương 'mixamorigHips' (KHÔNG ':') +
 *     track 'mixamorigHips.quaternion' → fresh mixer bind 16/16,
 *     6/6 xương đổi quaternion, root đứng yên.
 *   • Studio import qua FbxImport.parseDetailed → canonicalizeBoneNames
 *     đổi xương thành 'mixamorig:Hips' (CÓ ':') + track thành
 *     'mixamorig:Hips.quaternion' (renamed 41 xương / 41 track).
 *   • Sau đó fresh mixer trên đúng model đang hiện: 0/6 xương đổi,
 *     ROOT đổi (rootQ 0.813,−0.216,−0.172,0.513 → 0.838,…): track
 *     Hips lái cả model như 1 khối cứng thay vì lái xương.
 *
 * NGUYÊN NHÂN GỐC (three r128, build/three.js):
 *   PropertyBinding.parseTrackName tách 'mixamorig:Hips.quaternion'
 *   thành directory='mixamorig:', nodeName='Hips' (':' là ký tự phân
 *   cách thư mục trong _directoryRe; _nodeRe CẤM ':' nên nodeName
 *   KHÔNG BAO GIỜ chứa ':'). findNode(root,'Hips') không khớp bone
 *   tên 'mixamorig:Hips' → trả null → constructor làm
 *   `node = findNode(...) || rootNode` → binding rơi về ROOT.
 *
 * QUYẾT ĐỊNH — phương án (C), 2 lớp (KHÔNG chọn A thuần / B):
 *   • (A) "chuẩn hóa tên track theo tên xương canonical lúc bind"
 *     MỘT MÌNH KHÔNG ĐỦ: viết track thành 'mixamorig:Hips.…'
 *     chính là dạng gây lỗi; viết thành 'mixamorigHips.…' thì
 *     nodeName='mixamorigHips' vẫn không khớp bone 'mixamorig:Hips'
 *     trên r128 gốc (đo thật: vẫn 16/16 binding → root, 0/6 xương đổi).
 *   • (B) "ngừng đổi tên xương" bị LOẠI: tên 'mixamorig:' là canonical
 *     của studio — auto-rig-pro / rig-auto-gen / mixamo-skeleton /
 *     local-autogen dựng xương bằng tên này, export Mixamo +
 *     validator đều dựa vào nó; đổi tên xương = chạm hàng chục module.
 *   • (C) GIỮ tên xương 'mixamorig:' trong scene, sửa ở tầng bind:
 *     LỚP 1 (then chốt): vá THREE.PropertyBinding.findNode — static
 *       DUY NHẤT của r128, mọi mixer (Animator, Anim, FbxRig,
 *       AnimBlender, layers, blendtree…) đều đi qua nó — để nodeName
 *       đã strip ('Hips' / 'mixamorigHips') vẫn tìm được bone
 *       'mixamorig:Hips'. Giữ nguyên ngữ nghĩa gốc: khớp chính xác
 *       trước, trả null khi thật sự không thấy (để PropertyBinding
 *       fallback về root như cũ — chỉ cho track không có node).
 *     LỚP 2 (chuẩn hóa tên track): prepareClip(clip) clone clip,
 *       viết lại node của track về dạng KHÔNG ':' ('mixamorig:Hips'
 *       → 'mixamorigHips') — cùng quy ước sanitize của vòng Video
 *       (track ':' bị r128 parse sai làm root xoay 180°). Lớp 2 chỉ
 *       làm tên track parse-sạch + rõ ràng; lớp 1 mới là cái bind đúng.
 *
 * PHẠM VI: không đổi tên xương nào trong scene, không sửa clip gốc
 * (prepareClip luôn clone), không đụng mirror/retarget/remap/layers
 * (chúng giữ nguyên tên track; bind đúng nhờ lớp 1). Clip keyframe
 * không qua mixer nên không cần lớp 2; clip JSON load lại thành
 * THREE.AnimationClip rồi cũng đi qua 2 lớp này lúc clipAction.
 *
 * GIỚI HẠN TRUNG THỰC:
 *   • Track trỏ tới xương THẬT SỰ không có trong model (vd xương ngón
 *     tay thiếu trên model chibi) vẫn rơi về root theo hành vi gốc
 *     của r128 (`|| rootNode`) — ngoài phạm vi vòng này; diagnoseClip
 *     liệt kê được các track đó để vòng sau xử lý.
 *   • Vá findNode chỉ có tác dụng khi ArpClipBind.install() đã chạy
 *     (tự chạy lúc load file + Animator.ensureMixer gọi lại phòng hờ).
 *     Trang nào load arp-animator.js mà KHÔNG load file này thì vẫn
 *     lỗi cũ — index.html đã thêm script tag trước arp-animator.js.
 *   • prepareClip cache theo object clip gốc (WeakMap + fingerprint
 *     tên track): nếu ai đó sửa clip.tracks TẠI CHỖ sau khi bind thì
 *     fingerprint đổi → chuẩn hóa lại; clip mới (trim/retime/mirror)
 *     là object mới nên không dính cache cũ.
 * ============================================================ */
(function () {
  'use strict';

  var T = null;
  try { T = (typeof window !== 'undefined' && window.THREE) || (typeof THREE !== 'undefined' ? THREE : null); } catch (e) { T = null; }

  var ArpClipBind = {};
  ArpClipBind.VERSION = '1.0.0';

  /* THREE có thể load sau file này (CDN) — đọc lại mỗi lần cài. */
  function refreshThree() {
    if (T && T.PropertyBinding) return T;
    try { T = (typeof window !== 'undefined' && window.THREE) || (typeof THREE !== 'undefined' ? THREE : null); } catch (e) {}
    return T;
  }

  /* ---------- Tên xương: strip mọi cách viết về tên lõi ---------- */
  /* 'mixamorig:Hips' | 'mixamorigHips' | 'Model::mixamorig:Hips' |
     'Armature|Hips' | 'Bip01_Hips' | 'model:Hips' → 'Hips'.
     Cùng luật strip với FbxImport.stripBonePrefix (không sửa file đó). */
  ArpClipBind.shortName = function (name) {
    var n = String(name == null ? '' : name);
    var bar = n.lastIndexOf('|');
    if (bar !== -1) n = n.slice(bar + 1);
    var ns = n.lastIndexOf('::');
    if (ns !== -1) n = n.slice(ns + 2);
    var mi = n.search(/mixamorig/i);
    if (mi > 0) n = n.slice(mi);
    n = n.replace(/^mixamorig:?/i, '').replace(/^Bip0?1[_:]?/i, '').replace(/^Armature[_:]?/i, '').replace(/^model:?/i, '');
    return n;
  };

  /* ---------- Tên track r128-safe: bỏ ':' khỏi node ---------- */
  /* 'mixamorig:Hips' → 'mixamorigHips'; 'Hips' / 'mixamorigHips' /
     'LeftArm' giữ nguyên. Chỉ đổi đúng dạng có ':', không đụng tên khác. */
  ArpClipBind.safeNodeName = function (node) {
    var n = String(node == null ? '' : node);
    var bar = n.lastIndexOf('|');
    if (bar !== -1) n = n.slice(bar + 1);
    var ns = n.lastIndexOf('::');
    if (ns !== -1) n = n.slice(ns + 2);
    var m = n.match(/^mixamorig:(.*)$/i);
    return m ? 'mixamorig' + m[1] : n;
  };

  /* 'mixamorig:Hips.quaternion' → 'mixamorigHips.quaternion'.
     Tách ở dấu '.' ĐẦU (node không chứa '.'); tên không có '.' hoặc
     '.' ở đầu (track root '.position', '.bones[…]') giữ nguyên. */
  ArpClipBind.normalizeTrackName = function (trackName) {
    var name = String(trackName == null ? '' : trackName);
    var dot = name.indexOf('.');
    if (dot <= 0) return name;
    return ArpClipBind.safeNodeName(name.slice(0, dot)) + name.slice(dot);
  };

  /* Node name theo đúng luật parse của r128 (để chẩn đoán + đối chiếu). */
  ArpClipBind.parseNodeName = function (trackName) {
    refreshThree();
    try {
      if (T && T.PropertyBinding && typeof T.PropertyBinding.parseTrackName === 'function') {
        var p = T.PropertyBinding.parseTrackName(String(trackName));
        return p ? (p.nodeName || '') : '';
      }
    } catch (e) {}
    var name = String(trackName == null ? '' : trackName);
    var dot = name.indexOf('.');
    return dot > 0 ? name.slice(0, dot) : '';
  };

  /* ---------- Tìm node trong scene theo tên đã strip ---------- */
  /* CLIPBIND-C: node hiển thị (khớp canonical '__arp_canonical_skeleton__'
     tên ngắn 'Hips', joint/bone visual '__arp_vp_*') KHÔNG BAO GIỜ là
     target animation thật — findNode gốc gặp chúng trước xương thật vì
     trùng tên ngắn. Mọi điểm khớp tên dưới đây đều bỏ qua chúng. */
  function isDisplayNode(o) {
    try {
      return !!(o && o.userData && (o.userData.isCanonicalJoint || o.userData.isBoneVisual));
    } catch (e) { return false; }
  }
  ArpClipBind.isDisplayNode = isDisplayNode;

  function findExact(root, name) {
    if (!root || !name) return null;
    var hit = null;
    try {
      if (root.skeleton && typeof root.skeleton.getBoneByName === 'function') {
        var b = root.skeleton.getBoneByName(name);
        if (b !== undefined && b !== null) return b;
      }
    } catch (e) {}
    try {
      root.traverse(function (o) { if (!hit && o.name === name && !isDisplayNode(o)) hit = o; });
    } catch (e) {}
    return hit;
  }

  /* nodeName (dạng r128 đã parse: 'Hips' | 'mixamorigHips' | 'Hips'…)
     → object thật trong scene. Thứ tự: khớp chính xác các ứng viên
     theo tên lõi, rồi mới khớp không phân biệt hoa/thường (cuối cùng,
     để không cướp tên của node khác). Xương được ưu tiên qua
     skeleton.getBoneByName trước khi duyệt cây. */
  ArpClipBind.resolveNode = function (root, nodeName) {
    if (!root || nodeName == null) return null;
    var name = String(nodeName);
    if (!name || name === '.') return null;
    var short = ArpClipBind.shortName(name);
    var cands = [];
    function pushCand(c) { if (c && cands.indexOf(c) < 0) cands.push(c); }
    if (short && short !== name) { pushCand('mixamorig:' + short); pushCand('mixamorig' + short); pushCand(short); }
    pushCand(name);
    if (short) { pushCand('mixamorig:' + short); pushCand('mixamorig' + short); }
    var i, hit;
    for (i = 0; i < cands.length; i++) { hit = findExact(root, cands[i]); if (hit) return hit; }
    /* Dự phòng cuối: khớp không phân biệt hoa/thường. */
    var lower = cands.map(function (c) { return String(c).toLowerCase(); });
    var hit2 = null;
    try {
      root.traverse(function (o) {
        if (!hit2 && o && o.name && !isDisplayNode(o) && lower.indexOf(String(o.name).toLowerCase()) >= 0) hit2 = o;
      });
    } catch (e) {}
    return hit2;
  };

  /* ---------- LỚP 1: vá THREE.PropertyBinding.findNode ---------- */
  ArpClipBind.isInstalled = function () {
    refreshThree();
    try { return !!(T && T.PropertyBinding && T.PropertyBinding.__arpClipBindPatched); } catch (e) { return false; }
  };

  ArpClipBind.install = function () {
    refreshThree();
    if (!T || !T.PropertyBinding || typeof T.PropertyBinding.findNode !== 'function') {
      return { ok: false, reason: 'no-three' };
    }
    if (T.PropertyBinding.__arpClipBindPatched) return { ok: true, patched: false, already: true };
    var orig = T.PropertyBinding.findNode;
    function patchedFindNode(root, nodeName) {
      var hit = null;
      try { hit = orig(root, nodeName); } catch (e) { hit = null; }
      /* CLIPBIND-C: orig có thể trả khớp hiển thị tên ngắn ('Hips') —
         không phải xương thật → coi như miss, rơi xuống resolveNode. */
      if (hit && hit !== root && isDisplayNode(hit)) hit = null;
      if (hit) return hit;
      /* orig trả root cho ''/tên root/uuid, null khi không thấy —
         tới đây là trường hợp không thấy: thử khớp theo tên lõi. */
      if (!nodeName || nodeName === '' || nodeName === '.') return hit;
      try { return ArpClipBind.resolveNode(root, nodeName); } catch (e) { return null; }
    }
    try {
      T.PropertyBinding.findNode = patchedFindNode;
      T.PropertyBinding.__arpClipBindPatched = true;
      T.PropertyBinding.__arpClipBindOriginal = orig;
    } catch (e) { return { ok: false, reason: 'patch-failed: ' + (e && e.message) }; }
    return { ok: true, patched: true };
  };

  ArpClipBind.uninstall = function () {
    try {
      if (T && T.PropertyBinding && T.PropertyBinding.__arpClipBindPatched && T.PropertyBinding.__arpClipBindOriginal) {
        T.PropertyBinding.findNode = T.PropertyBinding.__arpClipBindOriginal;
        T.PropertyBinding.__arpClipBindPatched = false;
        return { ok: true };
      }
    } catch (e) { return { ok: false, reason: String(e && e.message) }; }
    return { ok: false, reason: 'not-installed' };
  };

  /* ---------- LỚP 2: chuẩn hóa tên track lúc bind (clone) ---------- */
  var _cache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function fingerprint(clip) {
    try {
      return (clip.tracks || []).length + '|' + (clip.tracks || []).map(function (t) { return t.name; }).join(',');
    } catch (e) { return ''; }
  }

  /* Trả {clip, renamed, changed, cached}. KHÔNG sửa clip gốc:
     THREE.AnimationClip → clip.clone() (r128 clone track kèm copy
     times/values) rồi đổi tên track trên bản clone; clip plain
     ({tracks:[{name,times,values}]}, vd JSON load) → object mới. */
  ArpClipBind.prepareClip = function (clip) {
    if (!clip || !Array.isArray(clip.tracks)) return { clip: clip, renamed: 0, changed: false };
    var fp = fingerprint(clip);
    if (_cache) {
      var hit = _cache.get(clip);
      if (hit && hit.fp === fp) return { clip: hit.clip, renamed: hit.renamed, changed: hit.changed, cached: true };
    }
    var renamed = 0;
    var out = clip;
    if (typeof clip.clone === 'function') {
      out = clip.clone();
      (out.tracks || []).forEach(function (tr) {
        var nn = ArpClipBind.normalizeTrackName(tr.name);
        if (nn !== tr.name) { tr.name = nn; renamed++; }
      });
    } else {
      var tracks = clip.tracks.map(function (tr) {
        var nn = ArpClipBind.normalizeTrackName(tr.name);
        if (nn !== tr.name) renamed++;
        return { name: nn, times: tr.times, values: tr.values };
      });
      out = { name: clip.name, duration: clip.duration, tracks: tracks };
      if (clip.blendMode !== undefined) out.blendMode = clip.blendMode;
    }
    var res = { clip: out, renamed: renamed, changed: renamed > 0 };
    if (_cache) { try { _cache.set(clip, { clip: out, renamed: renamed, changed: res.changed, fp: fp }); } catch (e) {} }
    return res;
  };

  /* ---------- Chẩn đoán: track nào bind được / rơi về root ---------- */
  ArpClipBind.diagnoseClip = function (clip, root) {
    refreshThree();
    var out = { total: 0, resolved: 0, unresolved: [], toRoot: [] };
    if (!clip || !Array.isArray(clip.tracks)) return out;
    out.total = clip.tracks.length;
    clip.tracks.forEach(function (tr) {
      var nodeName = ArpClipBind.parseNodeName(tr.name);
      var node = null;
      if (root) {
        try {
          node = (T && T.PropertyBinding && typeof T.PropertyBinding.findNode === 'function')
            ? T.PropertyBinding.findNode(root, nodeName) : ArpClipBind.resolveNode(root, nodeName);
        } catch (e) { node = null; }
      }
      if (node && node !== root) out.resolved++;
      else if (node === root) out.toRoot.push({ track: tr.name, node: nodeName });
      else out.unresolved.push({ track: tr.name, node: nodeName });
    });
    return out;
  };

  /* Tiện ích: chuẩn hóa + clipAction trong 1 gọi (cho module khác dùng
     khi không cần cache action theo entry như Animator). */
  ArpClipBind.bindAction = function (mixer, clip) {
    if (!mixer || typeof mixer.clipAction !== 'function') return { ok: false, reason: 'no-mixer' };
    var p = ArpClipBind.prepareClip(clip);
    var action = mixer.clipAction(p.clip);
    return { ok: true, action: action, clip: p.clip, renamed: p.renamed };
  };

  /* Tự cài lớp 1 ngay lúc load (THREE đã có qua CDN ở <head>).
     Animator.ensureMixer gọi lại install() phòng trường hợp file này
     load trước THREE hoặc THREE bị thay sau đó. */
  try { ArpClipBind.install(); } catch (e) {}

  ArpClipBind._test = {
    shortName: ArpClipBind.shortName,
    safeNodeName: ArpClipBind.safeNodeName,
    normalizeTrackName: ArpClipBind.normalizeTrackName,
    parseNodeName: ArpClipBind.parseNodeName,
    resolveNode: ArpClipBind.resolveNode,
    isDisplayNode: ArpClipBind.isDisplayNode,
    install: ArpClipBind.install,
    uninstall: ArpClipBind.uninstall,
    isInstalled: ArpClipBind.isInstalled,
    prepareClip: ArpClipBind.prepareClip,
    diagnoseClip: ArpClipBind.diagnoseClip,
    bindAction: ArpClipBind.bindAction
  };

  if (typeof window !== 'undefined') {
    window.PixiStudio = window.PixiStudio || {};
    window.PixiStudio.ArpClipBind = ArpClipBind;
  }
  if (typeof global !== 'undefined') {
    global.PixiStudio = global.PixiStudio || {};
    global.PixiStudio.ArpClipBind = ArpClipBind;
  }
})();
