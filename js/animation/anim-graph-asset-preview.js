/* ============================================================
 * animation/anim-graph-asset-preview.js — XEM TRƯỚC STATE MACHINE
 * TRÊN THUMBNAIL ASSET (SM2, vòng Animation mở rộng).
 *
 * KHÔNG sửa js/assets/asset-library.js (nhóm D đang làm preview
 * trong đó). Module này đứng riêng và chỉ dùng API CÔNG KHAI của
 * Asset Library: PS.AssetLibrary.generateThumbnail (đã có),
 * PS.AssetLibrary._thumbScene / _thumbCam / _getThumbRenderer()
 * (thuộc tính public trên object Library) + PS.Models.models.
 *
 * CÁCH DÙNG (1 dòng trong AssetLibrary._buildCard, do nhóm D thêm):
 *   if (window.PixiStudio.AnimGraphAssetPreview)
 *     PixiStudio.AnimGraphAssetPreview.attachCard(card, asset);
 * attachCard() thêm nút "▶ SM" lên card; bấm nút → phát clip của
 * state mặc định (entry) trong graph đã gắn cho nhân vật đó, vẽ
 * từng frame lên thumbnail <img> (6 frame / ~2s), bấm lần nữa để dừng.
 *
 * Graph được gắn cho asset nào: tra theo thứ tự —
 *   1. AnimGraphStore.getCharacterGraph(asset.modelId || asset.id)
 *   2. attach map của editor (localStorage ATTACH_KEY, theo tên model)
 *   3. graph đang active trong thư viện editor (Editor.listLibrary)
 * Không có graph/clip → nút bấm báo rõ lý do, không crash.
 *
 * GIỚI HẠN: chỉ asset type 'model' có object3D + clip THREE thật;
 * asset 'character' (chibi mẫu) và prop/env không có clip nên không
 * preview được. Cần WebGL thật (trình duyệt) — jsdom chỉ test logic.
 * ============================================================ */
(function () {
  'use strict';

  var PS = (typeof window !== 'undefined' && window.PixiStudio) || {};
  var T = (typeof window !== 'undefined' && window.THREE) ||
          (typeof THREE !== 'undefined' ? THREE : null);
  var doc = (typeof document !== 'undefined') ? document : null;

  var _current = null; /* {card, img, origSrc, timer, mixer, clone, scene} */

  function BT() { return PS.AnimBlendTree; }
  function SM() { return PS.AnimStateMachine; }
  function Store() { return PS.AnimGraphStore || null; }
  function Lib() { return PS.AssetLibrary || null; }
  function ED() { return PS.AnimGraphEditor || null; }

  function ls() {
    try { return (typeof localStorage !== 'undefined' ? localStorage : window.localStorage); } catch (e) { return null; }
  }

  /* Graph (đã deserialize) gắn với asset, kèm nguồn. */
  function resolveGraphForAsset(asset) {
    if (!asset) return { ok: false, error: 'Thiếu asset.' };
    var S = SM(), B = BT();
    if (!S || !B) return { ok: false, error: 'Thiếu module BlendTree/StateMachine.' };
    var charId = asset.modelId || asset.id;
    var entry = null, source = '';
    /* 1. Store v2: charMap[characterId]. */
    try {
      var S2 = Store();
      if (S2) {
        entry = S2.getCharacterGraph(charId, 'statemachine') || S2.getCharacterGraph(charId, 'blendtree');
        if (entry) source = 'store';
      }
    } catch (e) {}
    /* 2. Attach map của editor (theo tên model) + thư viện editor. */
    if (!entry) {
      try {
        var ed = ED();
        if (ed) {
          var s = ls();
          var at = {};
          try { at = JSON.parse((s && s.getItem(ed.ATTACH_KEY)) || '{}'); } catch (e2) { at = {}; }
          var gname = at[asset.name];
          if (gname) {
            var lib = ed.listLibrary ? ed.listLibrary() : { graphs: {} };
            var hit = lib.graphs && lib.graphs[gname];
            if (hit && hit.statemachine) { entry = { data: hit.statemachine, mode: 'statemachine', name: gname }; source = 'attach:' + asset.name; }
            else if (hit && hit.blendtree) { entry = { data: hit.blendtree, mode: 'blendtree', name: gname }; source = 'attach:' + asset.name; }
          }
          if (!entry && lib && lib.active && lib.graphs && lib.graphs[lib.active]) {
            var act = lib.graphs[lib.active];
            if (act.statemachine) { entry = { data: act.statemachine, mode: 'statemachine', name: lib.active }; source = 'library-active'; }
            else if (act.blendtree) { entry = { data: act.blendtree, mode: 'blendtree', name: lib.active }; source = 'library-active'; }
          }
        }
      } catch (e) {}
    }
    if (!entry || !entry.data) return { ok: false, error: 'Asset "' + (asset.name || asset.id) + '" chưa gắn graph nào (gắn trong tab Anim Graph → 📌 Gắn vào model này).' };
    var r = entry.mode === 'statemachine' ? S.deserialize(entry.data) : B.deserialize(entry.data);
    if (!r.ok) return r;
    return { ok: true, graph: r.graph, mode: entry.mode, name: entry.name || r.graph.name, source: source };
  }

  /* Clip phát preview: SM → clip của entry state; BT → clip của node root. */
  function entryClipForGraph(graph, mode) {
    var B = BT(), S = SM();
    if (!graph) return { ok: false, error: 'Thiếu graph.' };
    if (mode === 'statemachine') {
      var st = S.getState(graph, graph.entryStateId) || (graph.states || [])[0];
      if (!st) return { ok: false, error: 'State Machine rỗng.' };
      if (!st.clipId) return { ok: false, error: 'State "' + st.name + '" chưa gán clip.' };
      var clip = B.resolveClip(st.clipId);
      if (!clip) return { ok: false, error: 'Clip "' + st.clipId + '" không tìm thấy.' };
      return { ok: true, clip: clip, label: st.name };
    }
    var root = B.getNode(graph, graph.rootId) || (graph.nodes || [])[0];
    if (!root) return { ok: false, error: 'Blend Tree rỗng.' };
    if (root.type === 'clip' && root.clipId) {
      var c2 = B.resolveClip(root.clipId);
      if (!c2) return { ok: false, error: 'Clip "' + root.clipId + '" không tìm thấy.' };
      return { ok: true, clip: c2, label: root.name };
    }
    return { ok: false, error: 'Preview Blend Tree chỉ hỗ trợ root là node Clip (root hiện tại: ' + root.type + ').' };
  }

  function assetObject3D(asset) {
    if (!asset) return null;
    if (asset.type === 'model') {
      var entry = asset.entry;
      try {
        if (!entry && PS.Models && PS.Models.models) entry = PS.Models.models[asset.modelId];
      } catch (e) {}
      if (!entry || !entry.object3D) return null;
      try { return entry.object3D.clone(true); } catch (e) { return null; }
    }
    return null; /* character mẫu / prop / env: không có clip để preview */
  }

  /* Vẽ frame thumb hiện tại lên <img> (nền gradient giống generateThumbnail). */
  function renderThumbFrame(img, renderer, scene, cam) {
    if (!renderer || !scene || !cam) return false;
    try { renderer.render(scene, cam); } catch (e) { return false; }
    try {
      var out = doc.createElement('canvas');
      out.width = 128; out.height = 136;
      var ctx = out.getContext('2d');
      var grad = ctx.createLinearGradient(0, 0, 128, 136);
      grad.addColorStop(0, '#2c2c44'); grad.addColorStop(1, '#191926');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 136);
      ctx.drawImage(renderer.domElement, 0, 0, 128, 136);
      img.src = out.toDataURL('image/png');
      return true;
    } catch (e) { return false; }
  }

  function stopCurrent(restore) {
    if (!_current) return;
    try { if (_current.timer) clearTimeout(_current.timer); } catch (e) {}
    try {
      if (_current.mixer) _current.mixer.stopAllAction();
      if (_current.scene && _current.clone) _current.scene.remove(_current.clone);
    } catch (e) {}
    if (restore !== false && _current.img && _current.origSrc) {
      try { _current.img.src = _current.origSrc; } catch (e) {}
    }
    if (_current.btn) { try { _current.btn.textContent = '▶ SM'; _current.btn.classList.remove('ag-preview-on'); } catch (e) {} }
    _current = null;
  }

  /* Phát preview lên thumbnail <img> của card. frames ~6, mỗi 250ms. */
  function playOnCard(cardEl, asset, opts) {
    opts = opts || {};
    if (_current && _current.card === cardEl) { stopCurrent(true); return { ok: true, stopped: true }; }
    stopCurrent(true);
    if (!T || !T.AnimationMixer) return { ok: false, error: 'Thiếu THREE.AnimationMixer.' };
    var lib = Lib();
    if (!lib || typeof lib._getThumbRenderer !== 'function' || !lib._thumbScene || !lib._thumbCam) {
      return { ok: false, error: 'Asset Library chưa sẵn sàng thumbnail renderer (mở tab Assets 1 lần để khởi tạo).' };
    }
    var img = cardEl ? cardEl.querySelector('img') : null;
    if (!img) return { ok: false, error: 'Card không có thumbnail <img>.' };
    var gres = resolveGraphForAsset(asset);
    if (!gres.ok) return gres;
    var cres = entryClipForGraph(gres.graph, gres.mode);
    if (!cres.ok) return cres;
    var clone = assetObject3D(asset);
    if (!clone) return { ok: false, error: 'Asset "' + (asset.name || asset.id) + '" không có object3D để preview (chỉ asset model import mới preview được).' };
    var scene = lib._thumbScene, cam = lib._thumbCam;
    var renderer = lib._getThumbRenderer();
    if (!renderer) return { ok: false, error: 'Không tạo được thumbnail renderer.' };
    var box = new T.Box3().setFromObject(clone);
    var center = box.getCenter(new T.Vector3());
    var size = box.getSize(new T.Vector3());
    scene.add(clone);
    clone.position.sub(center);
    var dist = Math.max(size.x, size.y, size.z) * 1.5 + 0.5;
    cam.position.set(dist * 0.55, dist * 0.35, dist);
    cam.lookAt(0, 0, 0);
    var mixer = new T.AnimationMixer(clone);
    var action;
    try {
      action = mixer.clipAction(cres.clip);
      action.reset(); action.setEffectiveWeight(1); action.play();
    } catch (e) {
      try { scene.remove(clone); } catch (e2) {}
      return { ok: false, error: 'Không phát được clip: ' + (e && e.message) };
    }
    var frames = opts.frames || 6;
    var stepMs = opts.stepMs || 250;
    var clipDur = cres.clip.duration || 1;
    var dt = Math.min(clipDur, 2) / frames;
    var state = { card: cardEl, img: img, origSrc: img.src, timer: 0, mixer: mixer, clone: clone, scene: scene, btn: opts.btn || null, frame: 0 };
    _current = state;
    if (state.btn) { try { state.btn.textContent = '■ SM'; state.btn.classList.add('ag-preview-on'); } catch (e) {} }
    function tickFrame() {
      if (!_current || _current !== state) return;
      state.frame++;
      try { mixer.update(dt); } catch (e) {}
      var okDraw = renderThumbFrame(img, renderer, scene, cam);
      if (!okDraw || state.frame >= frames) { stopCurrent(false); return; }
      state.timer = setTimeout(tickFrame, stepMs);
    }
    state.timer = setTimeout(tickFrame, 50);
    return { ok: true, graph: gres.name, state: cres.label, frames: frames };
  }

  /* Gắn nút "▶ SM" lên card asset (nhóm D gọi 1 dòng trong _buildCard). */
  function attachCard(cardEl, asset) {
    if (!cardEl || !asset || !doc) return { ok: false, error: 'Thiếu card/asset.' };
    if (cardEl.querySelector('.ag-preview-btn')) return { ok: false, error: 'Đã gắn nút preview.' };
    var btn = doc.createElement('button');
    btn.className = 'ag-preview-btn';
    btn.type = 'button';
    btn.textContent = '▶ SM';
    btn.title = 'Xem trước State Machine đã gắn (phát state mặc định trên thumbnail)';
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var r = playOnCard(cardEl, asset, { btn: btn });
      if (!r.ok) {
        try {
          var bus = PS.bus;
          if (bus && bus.emit) bus.emit('notify', { type: 'warning', title: 'Anim Graph preview', message: r.error });
        } catch (e) {}
      }
    });
    cardEl.appendChild(btn);
    return { ok: true };
  }

  var Preview = {
    resolveGraphForAsset: resolveGraphForAsset,
    entryClipForGraph: entryClipForGraph,
    playOnCard: playOnCard,
    attachCard: attachCard,
    stop: function () { stopCurrent(true); return { ok: true }; },
    _test: { assetObject3D: assetObject3D }
  };

  PS.AnimGraphAssetPreview = Preview;
})();
