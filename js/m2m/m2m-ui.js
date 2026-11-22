/* m2m/m2m-ui.js — giao diện + wiring cho mesh2motion.html */
(function () {
  'use strict';
  const P = window.PixiStudio;
  const U = P.Utils;
  const bus = P.bus;
  const Page = window.M2MPage;
  const $ = function (s) { return document.querySelector(s); };
  const $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  const UI = {
    rigId: 'human',
    modelSearch: '',
    animSearch: '',
    animCat: 'All',
    sort: 'name',
    favorites: {},
    selected: [],
    filtered: [],
    tab: 'library',
    lastClip: null
  };

  /* ---------------- toast/plumbing ---------------- */
  function toast(type, title, message) { bus.emit('notify', { type: type, title: title, message: message }); }

  /* ---------------- catalog ---------------- */
  function loadCatalog() {
    return P.M2MMotion.loadCatalog().then(function (cat) {
      if (!cat) { toast('error', 'Catalog', 'Không tải được catalog.json'); return null; }
      const rigs = Object.keys(cat.rigs);
      $('#m2m-rig-count').textContent = rigs.length;
      const total = rigs.reduce(function (s, r) { return s + cat.rigs[r].animations.length; }, 0);
      $('#m2m-catalog-badge').textContent = total + ' motions · CC0';
      $('#m2m-catalog-badge').classList.add('ok');
      buildCategories(rigs);
      buildRigFamilySelect(rigs);
      return cat;
    });
  }

  function buildCategories(rigs) {
    const host = $('#m2m-categories');
    host.innerHTML = '';
    rigs.forEach(function (r) {
      const b = U.el('button', { class: 'chip' + (r === UI.rigId ? ' on' : ''), text: labelOf(r) });
      b.addEventListener('click', function () {
        UI.rigId = r;
        P.M2MMotion.setRig(r);
        $$('#m2m-categories .chip').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        buildModels();
        buildAnimations();
      });
      host.appendChild(b);
    });
  }

  const LABELS = { human: 'Human', fox: 'Fox', bird: 'Bird', dragon: 'Dragon', kaiju: 'Kaiju', spider: 'Spider', snake: 'Snake', shark: 'Fish', horse: 'Horse' };
  function labelOf(r) { return LABELS[r] || (r.charAt(0).toUpperCase() + r.slice(1)); }

  function buildRigFamilySelect(rigs) {
    const sel = $('#m2m-rig-family');
    sel.innerHTML = '<option value="">— họ rig (dùng skeleton gốc) —</option>';
    rigs.forEach(function (r) { sel.appendChild(U.el('option', { value: r, text: labelOf(r) + ' rig' })); });
    sel.value = UI.rigId;
  }

  /* ---------------- model library ---------------- */
  function buildModels() {
    const host = $('#m2m-models');
    host.innerHTML = '';
    const cat = P.M2MMotion.catalog;
    if (!cat) return;
    const rig = cat.rigs[UI.rigId];
    if (!rig) return;
    const items = [{ name: 'base', url: rig.model, base: true }].concat(rig.variations || []);
    const q = UI.modelSearch.toLowerCase();
    items.filter(function (it) { return !q || it.name.toLowerCase().indexOf(q) >= 0 || UI.rigId.indexOf(q) >= 0; }).forEach(function (it) {
      const card = U.el('div', { class: 'mcard', title: it.url });
      const img = U.el('img', { src: P.M2MMotion.previewUrl(UI.rigId, it.base ? 'base-model' : it.name), alt: it.name });
      img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
      card.appendChild(img);
      card.appendChild(U.el('div', { class: 'mt', text: (it.base ? 'Base model' : it.name) }));
      card.appendChild(U.el('div', { class: 'ms', text: UI.rigId + ' · ' + (rig.animations.length) + ' motions' }));
      card.addEventListener('click', function () {
        $$('#m2m-models .mcard').forEach(function (c) { c.classList.remove('on'); });
        card.classList.add('on');
        loadModel(it);
      });
      host.appendChild(card);
    });
  }

  function loadModel(it) {
    toast('info', 'Đang nạp model', it.name + ' (' + UI.rigId + ')');
    Page.loadModelUrl(it.url, 'M2M ' + UI.rigId + ' ' + it.name).then(function (entry) {
      /* model gốc của rig đã có skeleton khớp → dùng luôn */
      const rigLike = Page.adoptExistingSkeleton(entry.object3D, entry.clips || []);
      P.M2MMotion.setRig(UI.rigId);
      if (!rigLike) {
        return Page.buildRig(UI.rigId);
      }
      return null;
    }).then(function () {
      toast('success', 'Model sẵn sàng', it.name + ' · ' + (P.RigAutoGen.current ? P.RigAutoGen.current.boneCount : 0) + ' bone');
      refreshHud();
      buildAnimations();
    }).catch(function (e) {
      toast('error', 'Nạp model lỗi', e.message);
    });
  }

  /* ---------------- animation library ---------------- */
  function catOf(name) {
    const n = name.toLowerCase();
    if (/idle|rest|relax|sleep|wait|standing|pose/.test(n)) return 'Idle';
    if (/attack|punch|kick|sword|slash|shoot|throw|combat|fight|block|defend|hit|death|spell|weapon|grenade|stab|bite/.test(n)) return 'Combat';
    if (/walk|run|jog|sprint|strafe|crawl|climb|swim|jump|roll|dodge|fly|fall|slide|backflip|hop/.test(n)) return 'Movement';
    if (/dance|bow|greet|clap|cheer|victory|cry|laugh|sing|talk|pray|yes|reject|confused|dab/.test(n)) return 'Emotion';
    if (/pick|open|interact|sit|lay|write|drive|drum|guitar/.test(n)) return 'Interaction';
    return 'Action';
  }

  function buildAnimations() {
    const host = $('#m2m-anims');
    host.innerHTML = '';
    const all = P.M2MMotion.motions(UI.rigId) || [];
    const cats = {};
    all.forEach(function (a) { const c = catOf(a.name); cats[c] = (cats[c] || 0) + 1; });
    const chips = $('#m2m-anim-cats');
    chips.innerHTML = '';
    ['All'].concat(Object.keys(cats).sort()).forEach(function (c) {
      const b = U.el('button', { class: 'chip' + (UI.animCat === c ? ' on' : ''), text: c + (c === 'All' ? ' ' + all.length : ' ' + cats[c]) });
      b.addEventListener('click', function () {
        UI.animCat = c;
        $$('#m2m-anim-cats .chip').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        buildAnimations();
      });
      chips.appendChild(b);
    });

    const q = UI.animSearch.toLowerCase();
    const onlyLoop = $('#m2m-f-loop').checked, onlyRoot = $('#m2m-f-root').checked, onlyFav = $('#m2m-f-fav').checked;
    let list = all.filter(function (a) {
      if (q && (a.name + ' ' + (a.tags || []).join(' ')).toLowerCase().indexOf(q) < 0) return false;
      if (UI.animCat !== 'All' && catOf(a.name) !== UI.animCat) return false;
      if (onlyLoop && !a.loop) return false;
      if (onlyRoot && !a.rootMotion) return false;
      if (onlyFav && !UI.favorites[a.url]) return false;
      return true;
    });
    if (UI.sort === 'name') list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (UI.sort === 'duration') list.sort(function (a, b) { return (a.duration || 0) - (b.duration || 0); });
    if (UI.sort === 'category') list.sort(function (a, b) { return catOf(a.name).localeCompare(catOf(b.name)) || a.name.localeCompare(b.name); });
    UI.filtered = list;
    $('#m2m-anim-count').textContent = list.length + ' / ' + all.length;

    list.forEach(function (a) {
      const isSel = UI.selected.some(function (s) { return s.url === a.url; });
      const isPlaying = Page.clipName === a.name;
      const card = U.el('div', { class: 'acard' + (isSel ? ' on' : '') + (isPlaying ? ' playing' : '') });
      card.appendChild(U.el('div', { class: 'an', text: a.name }));
      const meta = U.el('div', { class: 'am' });
      meta.appendChild(U.el('span', { class: 'tag', text: catOf(a.name) }));
      meta.appendChild(U.el('span', { text: (a.duration || 0).toFixed(2) + 's' }));
      if (a.loop) meta.appendChild(U.el('span', { text: '↻' }));
      if (a.rootMotion) meta.appendChild(U.el('span', { text: 'RM' }));
      card.appendChild(meta);
      const cb = U.el('input', { type: 'checkbox', class: 'cb' });
      cb.checked = isSel;
      cb.addEventListener('click', function (e) { e.stopPropagation(); toggleSelect(a); });
      card.appendChild(cb);
      const fav = U.el('button', { class: 'fav' + (UI.favorites[a.url] ? ' on' : ''), text: UI.favorites[a.url] ? '★' : '☆', title: 'Favorite' });
      fav.addEventListener('click', function (e) {
        e.stopPropagation();
        UI.favorites[a.url] = !UI.favorites[a.url];
        try { localStorage.setItem('m2m.favs.v1', JSON.stringify(UI.favorites)); } catch (err) { }
        buildAnimations();
      });
      card.appendChild(fav);
      card.addEventListener('click', function () { playAnimation(a); });
      host.appendChild(card);
    });
    $('#m2m-selcount').textContent = String(UI.selected.length);
  }

  function toggleSelect(a) {
    const i = UI.selected.findIndex(function (s) { return s.url === a.url; });
    if (i >= 0) UI.selected.splice(i, 1); else UI.selected.push({ url: a.url, name: a.name, duration: a.duration, loop: a.loop, rootMotion: a.rootMotion });
    buildAnimations();
    renderSelected();
  }

  function playAnimation(a) {
    UI.lastClip = a;
    Page.play(a.url, a.name).then(function (info) {
      if (!info) return;
      $('#m2m-clipname').textContent = info.name + ' · ' + info.tracks + ' track';
      $('#m2m-play').textContent = '⏸ Pause';
      buildAnimations();
      buildClipBar();
    });
  }

  /* ---------------- selected tab ---------------- */
  function renderSelected() {
    const host = $('#m2m-selected');
    host.innerHTML = '';
    if (!UI.selected.length) {
      host.appendChild(U.el('div', { style: 'color:var(--text-3);font-size:11px', text: 'Chưa chọn clip nào.' }));
    }
    UI.selected.forEach(function (s, i) {
      const row = U.el('div', { class: 'selrow' });
      row.appendChild(U.el('span', { class: 'ri', text: String(i + 1), style: 'width:16px;color:var(--text-3);font-size:10px' }));
      row.appendChild(U.el('span', { class: 'sn', text: s.name }));
      row.appendChild(U.el('span', { style: 'font-size:10px;color:var(--text-3)', text: (s.duration || 0).toFixed(2) + 's' }));
      const bPlay = U.el('button', { class: 'btn xs', text: '▶', title: 'Play' });
      bPlay.addEventListener('click', function () { playAnimation(s); });
      const bUp = U.el('button', { class: 'btn xs', text: '↑', title: 'Lên' });
      bUp.addEventListener('click', function () { if (i > 0) { const t = UI.selected[i - 1]; UI.selected[i - 1] = UI.selected[i]; UI.selected[i] = t; renderSelected(); } });
      const bDn = U.el('button', { class: 'btn xs', text: '↓', title: 'Xuống' });
      bDn.addEventListener('click', function () { if (i < UI.selected.length - 1) { const t = UI.selected[i + 1]; UI.selected[i + 1] = UI.selected[i]; UI.selected[i] = t; renderSelected(); } });
      const bRm = U.el('button', { class: 'btn xs', text: '✕', title: 'Bỏ chọn' });
      bRm.addEventListener('click', function () { UI.selected.splice(i, 1); renderSelected(); buildAnimations(); });
      const bAdd = U.el('button', { class: 'btn xs', text: '＋', title: 'Thêm vào Remix' });
      bAdd.addEventListener('click', function () { Page.remixAdd(s); renderRemix(); });
      [bPlay, bUp, bDn, bAdd, bRm].forEach(function (b) { row.appendChild(b); });
      host.appendChild(row);
    });
    $('#m2m-selcount').textContent = String(UI.selected.length);
    $('#m2m-sel-hint').textContent = UI.selected.length ? (UI.selected.length + ' clip sẽ được nhúng vào GLB khi export') : 'Tick animation ở tab Library rồi xuất GLB kèm model.';
  }

  /* ---------------- remix ---------------- */
  function renderRemix() {
    const host = $('#m2m-remix');
    host.innerHTML = '';
    if (!Page.remix.list.length) {
      host.appendChild(U.el('div', { style: 'color:var(--text-3);font-size:11px', text: 'Sequence rỗng — thêm clip từ tab Selected.' }));
    }
    Page.remix.list.forEach(function (s, i) {
      const row = U.el('div', { class: 'rstep' + (Page.remix.playing && Page.remix.index === i ? ' active' : '') });
      row.appendChild(U.el('span', { class: 'ri', text: String(i + 1) }));
      row.appendChild(U.el('span', { class: 'sn grow', text: s.name }));
      row.appendChild(U.el('span', { style: 'font-size:10px;color:var(--text-3)', text: (s.hold || 0).toFixed(2) + 's' }));
      const up = U.el('button', { class: 'btn xs', text: '↑' }); up.addEventListener('click', function () { Page.remixMove(i, -1); renderRemix(); });
      const dn = U.el('button', { class: 'btn xs', text: '↓' }); dn.addEventListener('click', function () { Page.remixMove(i, 1); renderRemix(); });
      const rm = U.el('button', { class: 'btn xs', text: '✕' }); rm.addEventListener('click', function () { Page.remixRemove(i); renderRemix(); });
      row.appendChild(up); row.appendChild(dn); row.appendChild(rm);
      host.appendChild(row);
    });
  }

  /* ---------------- timeline ---------------- */
  function buildRuler() {
    const r = $('#m2m-ruler');
    if (!r) return;
    Array.prototype.slice.call(r.querySelectorAll('.ruler-tick,.ruler-lbl')).forEach(function (n) { n.remove(); });
    const dur = Math.max(0.5, Page.duration || 3);
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const pct = i / steps * 100;
      r.appendChild(U.el('div', { class: 'ruler-tick' + (i % 5 === 0 ? ' major' : ''), style: 'left:' + pct + '%' }));
      if (i % 2 === 0) r.appendChild(U.el('div', { class: 'ruler-lbl', style: 'left:' + pct + '%', text: (dur * i / steps).toFixed(1) + 's' }));
    }
  }

  function buildClipBar() {
    const host = $('#m2m-clipbar');
    host.innerHTML = '';
    if (!Page.clipName) return;
    const w = Math.max(90, Math.min(520, (Page.duration || 1) * 90));
    const b = U.el('div', { class: 'clipblock', style: 'width:' + w + 'px', text: Page.clipName + '  ' + (Page.duration || 0).toFixed(2) + 's' });
    host.appendChild(b);
  }

  function updateTime() {
    const pct = Page.duration ? (Page.time / Page.duration) * 100 : 0;
    const ph = $('#m2m-playhead');
    if (ph) ph.style.left = Math.min(100, Math.max(0, pct)) + '%';
    $('#m2m-timecode').textContent = (Page.time || 0).toFixed(2) + ' / ' + (Page.duration || 0).toFixed(2) + 's';
    /* frame counter theo FPS */
    const f = Math.round((Page.time || 0) * (Page.fps || 30));
    $('#m2m-hint').textContent = 'Frame ' + f + ' / ' + Math.round((Page.duration || 0) * (Page.fps || 30)) + ' · ' + (Page.fps || 30) + ' FPS';
  }

  function refreshHud() {
    const s = Page.stats();
    const rig = P.RigAutoGen.current;
    $('#m2m-hud').innerHTML =
      '<b>' + s.fps + ' FPS</b> · ' + U.formatNumber(s.tris) + ' tris<br>' +
      s.meshes + ' mesh · ' + s.bones + ' bone<br>' +
      '<span style="color:#63799a">' + (rig ? (rig.name || 'rig') : 'no rig') + '</span>';
  }

  /* ---------------- settings modal ---------------- */
  function openModal(title, bodyEl, footEl) {
    $('#m2m-modal-title').textContent = title;
    const body = $('#m2m-modal-body'); body.innerHTML = '';
    if (bodyEl) body.appendChild(bodyEl);
    const foot = $('#m2m-modal-foot'); foot.innerHTML = '';
    (footEl || []).forEach(function (f) { foot.appendChild(f); });
    $('#m2m-modal').classList.add('on');
  }
  function closeModal() { $('#m2m-modal').classList.remove('on'); }

  function openSettings() {
    const wrap = U.el('div');
    const gr = U.el('div', { class: 'fieldset' }, [U.el('h4', { text: 'Graphics' })]);
    const bg = U.el('input', { class: 'field', type: 'color', value: Page.settings.background });
    bg.addEventListener('input', function () { Page.applySettings({ background: bg.value }); });
    const gridChk = U.el('input', { type: 'checkbox' }); gridChk.checked = !!Page.settings.grid;
    gridChk.addEventListener('change', function () { Page.applySettings({ grid: gridChk.checked }); syncVpButtons(); });
    const shChk = U.el('input', { type: 'checkbox' }); shChk.checked = !!Page.settings.shadows;
    shChk.addEventListener('change', function () { Page.applySettings({ shadows: shChk.checked }); syncVpButtons(); });
    const wfChk = U.el('input', { type: 'checkbox' }); wfChk.checked = !!Page.settings.wireframe;
    wfChk.addEventListener('change', function () { Page.applySettings({ wireframe: wfChk.checked }); syncVpButtons(); });
    const skChk = U.el('input', { type: 'checkbox' }); skChk.checked = !!Page.settings.skeleton;
    skChk.addEventListener('change', function () { Page.applySettings({ skeleton: skChk.checked }); syncVpButtons(); });
    [['Background', bg], ['Grid', gridChk], ['Shadows', shChk], ['Wireframe', wfChk], ['Skeleton', skChk]].forEach(function (p) {
      const row = U.el('div', { class: 'row', style: 'margin-bottom:6px' });
      row.appendChild(U.el('span', { class: 'small grow', text: p[0] }));
      row.appendChild(p[1]);
      gr.appendChild(row);
    });
    wrap.appendChild(gr);

    const cam = U.el('div', { class: 'fieldset' }, [U.el('h4', { text: 'Camera' })]);
    const fov = U.el('input', { type: 'range', min: '20', max: '90', step: '1', value: String(Page.settings.fov) });
    const fovv = U.el('span', { style: 'font-size:10.5px;color:var(--text-3)', text: Page.settings.fov + '°' });
    fov.addEventListener('input', function () { fovv.textContent = fov.value + '°'; Page.applySettings({ fov: parseFloat(fov.value) }); });
    cam.appendChild(U.el('div', { class: 'row' }, [U.el('span', { class: 'small grow', text: 'FOV' }), fov, fovv]));
    const spd = U.el('input', { type: 'range', min: '0.3', max: '3', step: '0.1', value: String(Page.settings.cameraSpeed) });
    const spdv = U.el('span', { style: 'font-size:10.5px;color:var(--text-3)', text: Page.settings.cameraSpeed + 'x' });
    spd.addEventListener('input', function () { spdv.textContent = spd.value + 'x'; Page.applySettings({ cameraSpeed: parseFloat(spd.value) }); });
    cam.appendChild(U.el('div', { class: 'row' }, [U.el('span', { class: 'small grow', text: 'Orbit speed' }), spd, spdv]));
    wrap.appendChild(cam);

    const ui = U.el('div', { class: 'fieldset' }, [U.el('h4', { text: 'Interface' })]);
    const scale = U.el('input', { type: 'range', min: '0.85', max: '1.3', step: '0.05', value: String(Page.settings.uiScale) });
    scale.addEventListener('input', function () { Page.applySettings({ uiScale: parseFloat(scale.value) }); });
    ui.appendChild(U.el('div', { class: 'row' }, [U.el('span', { class: 'small grow', text: 'UI scale' }), scale]));
    wrap.appendChild(ui);

    const ret = U.el('div', { class: 'fieldset' }, [U.el('h4', { text: 'Retarget' })]);
    ret.appendChild(U.el('div', { style: 'font-size:11px;color:var(--text-2);line-height:1.5', text: 'Chọn một animation rồi bấm nút bên dưới để xem chẩn đoán map bone giữa clip nguồn và rig hiện tại.' }));
    const diagOut = U.el('div', { style: 'margin-top:8px' });
    const diagBtn = U.el('button', { class: 'btn sm', text: '🔍 Chẩn đoán retarget' });
    diagBtn.addEventListener('click', function () {
      const a = UI.lastClip || (P.M2MMotion.motions(UI.rigId) || [])[0];
      if (!a) return;
      diagOut.innerHTML = 'đang phân tích…';
      Page.retargetDiagnostics(a.url).then(function (d) {
        if (!d) { diagOut.innerHTML = '<span style="color:var(--warn)">Cần rig + animation.</span>'; return; }
        diagOut.innerHTML = '';
        diagOut.appendChild(U.el('div', { style: 'font-size:11px;line-height:1.6' }, [
          U.el('div', { html: '<b>' + d.clipName + '</b> · mode <b>' + d.mode + '</b>' }),
          U.el('div', { text: 'bone nguồn ' + d.srcBones + ' · bone đích ' + d.targetBones + ' · khớp trực tiếp ' + d.directMatch }),
          U.el('div', { text: 'track sau retarget: ' + d.outTracks })
        ]));
        if (d.missing && d.missing.length) {
          const t = U.el('table', { class: 'diag' });
          t.appendChild(U.el('tr', {}, [U.el('th', { text: 'bone nguồn thiếu ở rig đích' })]));
          d.missing.forEach(function (m) { t.appendChild(U.el('tr', {}, [U.el('td', { text: m })])); });
          diagOut.appendChild(t);
        }
      });
    });
    ret.appendChild(diagBtn);
    ret.appendChild(diagOut);
    wrap.appendChild(ret);

    openModal('Settings', wrap, [
      U.el('button', { class: 'btn', text: 'Đóng', onclick: closeModal }),
      U.el('button', { class: 'btn primary', text: 'Lưu', onclick: function () { Page.applySettings({}); closeModal(); toast('success', 'Settings', 'Đã lưu cấu hình'); } })
    ]);
  }

  /* ---------------- export helpers ---------------- */
  function exportSelectedGLB() {
    if (!UI.selected.length) { toast('warning', 'Export', 'Chưa chọn clip nào.'); return; }
    toast('info', 'Export GLB', 'Đang retarget ' + UI.selected.length + ' clip…');
    Page.exportGLB({ clips: UI.selected, filename: 'm2m-' + UI.rigId + '-' + UI.selected.length + 'clips' })
      .then(function (r) { toast('success', 'Export xong', r.clips + ' clip · ' + Math.round(r.blob.size / 1024) + ' KB'); })
      .catch(function (e) { toast('error', 'Export lỗi', e.message); });
  }

  /* ---------------- AI tab ---------------- */
  function aiState() {
    const Tripo = P.AI && P.AI.Tripo;
    const el = $('#m2m-ai-state');
    if (!Tripo) { el.textContent = 'no adapter'; el.classList.remove('ok'); return null; }
    const st = Tripo.status();
    el.textContent = st.connected ? 'connected · ' + st.mode : 'not connected';
    el.classList.toggle('ok', !!st.connected);
    return Tripo;
  }

  function renderAiTasks() {
    const Tripo = P.AI && P.AI.Tripo;
    const host = $('#m2m-ai-tasks');
    host.innerHTML = '';
    if (!Tripo) return;
    Tripo.queue.slice(0, 6).forEach(function (t) {
      host.appendChild(U.el('div', { class: 'selrow' , style:'padding:4px 6px' }, [
        U.el('span', { class: 'sn', text: t.type + ' · ' + (t.state || '') }),
        U.el('span', { style: 'font-size:10px;color:var(--text-3)', text: (t.message || '').slice(0, 42) })
      ]));
    });
    if (!Tripo.queue.length) host.appendChild(U.el('div', { style: 'color:var(--text-3)', text: 'Chưa có task nào.' }));
  }

  function aiGenerate() {
    const Tripo = P.AI && P.AI.Tripo;
    if (!Tripo) { toast('error', 'AI', 'Tripo adapter chưa nạp'); return; }
    const prompt = $('#m2m-ai-prompt').value.trim();
    if (!prompt) { toast('warning', 'AI', 'Nhập prompt trước.'); return; }
    if (!Tripo.config.connected) {
      toast('warning', 'Chưa kết nối Tripo', 'Nhập API key (nút 🔗 Key) để generate thật. Không giả lập kết quả.');
      return;
    }
    Tripo.textTo3D({
      prompt: prompt,
      negative_prompt: $('#m2m-ai-neg').value,
      quality: $('#m2m-ai-quality').value,
      style: $('#m2m-ai-style').value.split(':')[0],
      polygon: parseInt($('#m2m-ai-poly').value, 10),
      texture_resolution: $('#m2m-ai-tex').value,
      seed: $('#m2m-ai-seed').value || undefined,
      format: 'glb'
    });
    renderAiTasks();
  }

  function aiConnect() {
    const Tripo = P.AI && P.AI.Tripo;
    if (!Tripo) return;
    const wrap = U.el('div');
    const ep = U.el('input', { class: 'field', placeholder: 'https://api.tripo3d.ai/v2/openapi', value: Tripo.config.endpoint || 'https://api.tripo3d.ai/v2/openapi' });
    const key = U.el('input', { class: 'field', placeholder: 'Tripo API key', value: Tripo.config.apiKey || '' });
    wrap.appendChild(U.el('div', { class: 'fieldset' }, [
      U.el('h4', { text: 'Tripo OpenAPI' }),
      U.el('div', { class: 'small', style: 'margin-bottom:4px', text: 'Endpoint' }), ep,
      U.el('div', { class: 'small', style: 'margin:8px 0 4px', text: 'API key' }), key,
      U.el('div', { style: 'margin-top:8px;font-size:11px;color:var(--text-3)', text: 'Key lưu localStorage của trang này. Text-to-3D, Image-to-3D, Texturing, Upscale, Rig, Animate chạy thật qua REST + polling.' })
    ]));
    openModal('Kết nối Tripo AI', wrap, [
      U.el('button', { class: 'btn', text: 'Huỷ', onclick: closeModal }),
      U.el('button', {
        class: 'btn primary', text: 'Kết nối', onclick: function () {
          const r = Tripo.connect(ep.value, key.value);
          if (r.ok) { toast('success', 'Tripo', 'Đã kết nối ' + Tripo.config.mode); closeModal(); aiState(); }
          else toast('warning', 'Tripo', r.reason || 'không kết nối được');
        }
      })
    ]);
  }

  /* ---------------- viewport bar ---------------- */
  function syncVpButtons() {
    $$('#m2m-vpbar .btn[data-vp]').forEach(function (b) {
      const k = b.getAttribute('data-vp');
      if (k === 'grid') b.classList.toggle('on', !!Page.settings.grid);
      if (k === 'shadows') b.classList.toggle('on', !!Page.settings.shadows);
      if (k === 'wireframe') b.classList.toggle('on', !!Page.settings.wireframe);
      if (k === 'skeleton') b.classList.toggle('on', !!Page.settings.skeleton);
    });
  }

  function wireViewportBar() {
    $$('#m2m-vpbar .btn[data-vp]').forEach(function (b) {
      b.addEventListener('click', function () {
        const k = b.getAttribute('data-vp');
        if (k === 'grid') Page.applySettings({ grid: !Page.settings.grid });
        else if (k === 'skeleton') Page.applySettings({ skeleton: !Page.settings.skeleton });
        else if (k === 'wireframe') Page.applySettings({ wireframe: !Page.settings.wireframe });
        else if (k === 'shadows') Page.applySettings({ shadows: !Page.settings.shadows });
        else if (k === 'persp') { Page.camera = Page.camera; Page.setView('perspective'); toast('info', 'Camera', 'Perspective'); }
        else if (k === 'ortho') { toggleOrtho(); }
        else if (k === 'focus') Page.focus();
        else if (k === 'shot') {
          const url = Page.screenshot();
          if (url) { const a = document.createElement('a'); a.href = url; a.download = 'mesh2motion-shot.png'; a.click(); }
        } else if (k === 'reset') { Page.orbit.dTheta = 0.5; Page.orbit.dPhi = 1.25; Page.orbit.dRadius = 4.2; Page.orbit.dTarget.set(0, 1, 0); }
        syncVpButtons();
      });
    });
  }

  function toggleOrtho() {
    const o = Page.orbit;
    const cam = Page.camera;
    const w = Page.wrap.clientWidth || 900, h = Page.wrap.clientHeight || 600;
    if (cam.isOrthographicCamera) {
      const p = new THREE.PerspectiveCamera(Page.settings.fov, w / h, 0.05, 500);
      p.position.copy(cam.position); p.lookAt(o.target);
      Page.camera = p;
    } else {
      const half = Math.max(1, o.radius * 0.45);
      const oc = new THREE.OrthographicCamera(-half * (w / h), half * (w / h), half, -half, 0.05, 500);
      oc.position.copy(cam.position); oc.lookAt(o.target);
      Page.camera = oc;
    }
    toast('info', 'Camera', Page.camera.isOrthographicCamera ? 'Orthographic' : 'Perspective');
  }

  /* ---------------- tabs/nav ---------------- */
  function setTab(t) {
    UI.tab = t;
    $$('.tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === t); });
    $$('.tabpane').forEach(function (p) { p.classList.toggle('on', p.id === 'm2m-tab-' + t); });
  }

  /* ---------------- init ---------------- */
  function init() {
    Page.loadSettings();
    Page.init($('#m2m-viewport'));
    Page.applySettings(Page.settings);
    syncVpButtons();
    wireViewportBar();

    try { UI.favorites = JSON.parse(localStorage.getItem('m2m.favs.v1') || '{}'); } catch (e) { }

    loadCatalog().then(function () {
      buildModels();
      buildAnimations();
      renderSelected();
      renderRemix();
      P.M2MMotion.setRig(UI.rigId);
      aiState();
      renderAiTasks();
      refreshHud();
    });

    /* search/filter */
    $('#m2m-model-search').addEventListener('input', function (e) { UI.modelSearch = e.target.value; buildModels(); });
    $('#m2m-anim-search').addEventListener('input', function (e) { UI.animSearch = e.target.value; buildAnimations(); });
    $('#m2m-sort').addEventListener('change', function (e) { UI.sort = e.target.value; buildAnimations(); });
    ['#m2m-f-loop', '#m2m-f-root', '#m2m-f-fav'].forEach(function (s) { $(s).addEventListener('change', buildAnimations); });
    $('#m2m-selectall').addEventListener('click', function () {
      UI.filtered.forEach(function (a) {
        if (!UI.selected.some(function (s) { return s.url === a.url; })) UI.selected.push({ url: a.url, name: a.name, duration: a.duration, loop: a.loop, rootMotion: a.rootMotion });
      });
      buildAnimations(); renderSelected();
      toast('info', 'Select', UI.filtered.length + ' clip đã chọn');
    });
    $('#m2m-clearsel').addEventListener('click', function () { UI.selected = []; buildAnimations(); renderSelected(); });

    /* model import + rig */
    const fileInput = U.el('input', { type: 'file', accept: '.glb,.gltf,.fbx', style: 'display:none' });
    document.body.appendChild(fileInput);
    fileInput.addEventListener('change', function () {
      const f = fileInput.files[0];
      if (!f) return;
      toast('info', 'Import', f.name);
      Page.importFile(f).then(function (e) {
        toast('success', 'Import xong', f.name + ' · ' + U.formatNumber(e.stats.tris) + ' tris');
        refreshHud();
        const fam = $('#m2m-rig-family').value;
        if (fam) return Page.buildRig(fam).then(function () { toast('success', 'Rig', 'Đã dựng rig ' + fam); refreshHud(); });
      }).catch(function (err) { toast('error', 'Import lỗi', err.message); });
      fileInput.value = '';
    });
    $('#m2m-import-model').addEventListener('click', function () { fileInput.click(); });
    $('#m2m-rig-btn').addEventListener('click', function () {
      const fam = $('#m2m-rig-family').value || UI.rigId;
      Page.buildRig(fam).then(function (rig) {
        if (rig) { toast('success', 'Rig', fam + ' · ' + rig.boneCount + ' bone · ' + rig.skinnedCount + ' mesh'); refreshHud(); }
      }).catch(function (e) { toast('error', 'Rig lỗi', e.message); });
    });
    $('#m2m-rig-family').addEventListener('change', function (e) {
      if (e.target.value) { UI.rigId = e.target.value; P.M2MMotion.setRig(UI.rigId); buildModels(); buildAnimations(); }
    });

    /* ===== Object transform: gizmo + nudge + input XYZ (kể cả trục Y lên/xuống) ===== */
    UI.buildObjectPanel = function () {
      const host = document.getElementById('m2m-object-panel');
      if (!host) return;
      host.innerHTML = '';
      const modeRow = U.el('div', { class: 'row', style: 'margin-bottom:5px' });
      [['move', 'Move'], ['rotate', 'Rotate'], ['scale', 'Scale']].forEach(function (m) {
        const b = U.el('button', { class: 'btn xs' + (Page.gizmoMode === m[0] ? ' on' : ''), text: m[1] });
        b.addEventListener('click', function () {
          Page.setGizmoMode(m[0]);
          Page.attachGizmo(Page.object());
          UI.buildObjectPanel();
        });
        modeRow.appendChild(b);
      });
      host.appendChild(modeRow);

      const st = Page.transformState() || { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
      ['position', 'rotation', 'scale'].forEach(function (key) {
        const r = U.el('div', { class: 'row', style: 'margin-bottom:4px' });
        r.appendChild(U.el('span', { class: 'small', style: 'width:48px', text: key === 'position' ? 'Pos' : key === 'rotation' ? 'Rot°' : 'Scale' }));
        ['X', 'Y', 'Z'].forEach(function (ax, i) {
          const inp = U.el('input', { class: 'field', style: 'width:100%;min-width:0;padding:3px 4px;font-size:10.5px;text-align:center', value: String(st[key][i]) });
          const commit = function () {
            const v = parseFloat(inp.value);
            if (!isFinite(v)) return;
            const arr = (Page.transformState() || st)[key].slice();
            arr[i] = v;
            if (key === 'rotation') arr[i] = v * Math.PI / 180;
            const patch = {}; patch[key] = arr;
            Page.applyTransform(patch);
            UI.buildObjectPanel();
          };
          inp.addEventListener('change', commit);
          inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') commit(); });
          r.appendChild(inp);
        });
        host.appendChild(r);
      });

      const nudge = U.el('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin:5px 0' });
      const step = 0.25;
      [['Y ▲', 'y', step], ['Z ▲', 'z', step], ['X ▲', 'x', step],
       ['Y ▼', 'y', -step], ['Z ▼', 'z', -step], ['X ▼', 'x', -step]].forEach(function (n) {
        const b = U.el('button', { class: 'btn xs', text: n[0], title: 'di chuyển ' + n[1].toUpperCase() + ' ' + n[2] });
        b.addEventListener('click', function () { Page.nudge(n[1], n[2]); UI.buildObjectPanel(); });
        nudge.appendChild(b);
      });
      host.appendChild(nudge);

      const acts = U.el('div', { class: 'row' });
      const b1 = U.el('button', { class: 'btn xs grow', text: 'Drop floor' });
      b1.addEventListener('click', function () { Page.dropToFloor(); UI.buildObjectPanel(); });
      const b2 = U.el('button', { class: 'btn xs grow', text: 'Reset' });
      b2.addEventListener('click', function () { Page.resetTransform(); UI.buildObjectPanel(); });
      acts.appendChild(b1); acts.appendChild(b2);
      host.appendChild(acts);
    };
    UI.buildObjectPanel();
    bus.on('m2m:transform', function () { UI.buildObjectPanel(); });
    bus.on('m2m:model', function () { UI.buildObjectPanel(); });

    /* drag & drop */
    const drop = $('#m2m-drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      $('#m2m-viewport').addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('on'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      $('#m2m-viewport').addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'drop' || e.target === drop) drop.classList.remove('on'); });
    });
    $('#m2m-viewport').addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('on');
      const f = e.dataTransfer.files[0];
      if (!f) return;
      Page.importFile(f).then(function (en) {
        toast('success', 'Import xong', f.name);
        refreshHud();
      }).catch(function (err) { toast('error', 'Import lỗi', err.message); });
    });

    /* playback */
    $('#m2m-play').addEventListener('click', function () {
      if (!Page.action && UI.filtered.length) { playAnimation(UI.filtered[0]); return; }
      Page.toggle();
      $('#m2m-play').textContent = Page.paused ? '▶ Play' : '⏸ Pause';
    });
    $('#m2m-stop').addEventListener('click', function () { Page.stop(); $('#m2m-play').textContent = '▶ Play'; });
    $('#m2m-prev').addEventListener('click', function () { stepAnim(-1); });
    $('#m2m-next').addEventListener('click', function () { stepAnim(1); });
    $('#m2m-speed').addEventListener('change', function (e) { Page.setSpeed(parseFloat(e.target.value)); });
    $('#m2m-loop').addEventListener('change', function (e) { Page.setLoop(e.target.checked); });
    $('#m2m-fps').addEventListener('change', function (e) { Page.fps = parseInt(e.target.value, 10); buildRuler(); updateTime(); });

    /* timeline scrub */
    const ruler = $('#m2m-ruler');
    let scrubbing = false;
    const scrubTo = function (e) {
      const r = ruler.getBoundingClientRect();
      const p = U.clamp((e.clientX - r.left) / r.width, 0, 1);
      Page.seek(p * (Page.duration || 0));
    };
    ruler.addEventListener('pointerdown', function (e) { scrubbing = true; scrubTo(e); ruler.setPointerCapture && ruler.setPointerCapture(e.pointerId); });
    ruler.addEventListener('pointermove', function (e) { if (scrubbing) scrubTo(e); });
    ruler.addEventListener('pointerup', function () { scrubbing = false; });

    /* tabs */
    $$('.tab').forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
    $$('[data-nav]').forEach(function (b) {
      b.addEventListener('click', function () {
        const n = b.getAttribute('data-nav');
        if (n === 'settings') openSettings();
        else if (n === 'use-model' || n === 'use-rigged') fileInput.click();
        else if (n === 'remix') setTab('remix');
        else if (n === 'favorites') { setTab('library'); $('#m2m-f-fav').checked = true; buildAnimations(); }
        else setTab('library');
      });
    });

    /* selected export */
    $('#m2m-sel-glb').addEventListener('click', exportSelectedGLB);
    $('#m2m-sel-json').addEventListener('click', function () {
      if (!UI.selected.length) { toast('warning', 'Export', 'Chưa chọn clip.'); return; }
      Page.exportClipJSON({ clips: UI.selected, filename: 'm2m-clips-' + UI.rigId }).then(function (n) { toast('success', 'JSON', n + ' clip đã xuất'); });
    });

    /* remix */
    $('#m2m-remix-play').addEventListener('click', function () { Page.remixPlay(); });
    $('#m2m-remix-stop').addEventListener('click', function () { Page.remixStop(); renderRemix(); });
    $('#m2m-remix-save').addEventListener('click', function () {
      const n = $('#m2m-remix-name').value.trim() || 'remix';
      toast(Page.remixSave(n) ? 'success' : 'error', 'Remix', Page.remixSave(n) ? 'Đã lưu ' + n : 'Lưu thất bại');
    });
    $('#m2m-remix-load').addEventListener('click', function () {
      const names = Page.remixList();
      if (!names.length) { toast('warning', 'Remix', 'Chưa có remix nào đã lưu.'); return; }
      const n = $('#m2m-remix-name').value.trim() || names[0];
      if (Page.remixLoad(n)) { renderRemix(); toast('success', 'Remix', 'Đã nạp ' + n); }
      else toast('warning', 'Remix', 'Không thấy ' + n);
    });
    $('#m2m-remix-trans').addEventListener('input', function (e) {
      Page.remix.transition = parseFloat(e.target.value);
      $('#m2m-remix-transv').textContent = Page.remix.transition.toFixed(2) + 's';
    });

    /* AI */
    $('#m2m-ai-generate').addEventListener('click', aiGenerate);
    $('#m2m-ai-connect').addEventListener('click', aiConnect);
    $('#m2m-ai-image').addEventListener('click', function () { toast('info', 'Image → 3D', 'Dùng trang Studio (AI Tools) để upload ảnh, hoặc mở khung Image-to-3D bên dưới phần Tripo.'); });
    $('#m2m-ai-rig').addEventListener('click', function () {
      const Tripo = P.AI && P.AI.Tripo;
      if (!Tripo || !Tripo.config.connected) { toast('warning', 'AI', 'Cần kết nối Tripo (🔗 Key).'); return; }
      Tripo.rigModel({}); toast('info', 'AI Rig', 'Đã gửi task rig_model');
      renderAiTasks();
    });

    /* modal close */
    $('#m2m-modal-x').addEventListener('click', closeModal);
    $('#m2m-modal').addEventListener('click', function (e) { if (e.target.id === 'm2m-modal') closeModal(); });

    /* bus updates */
    bus.on('m2m:time', function (d) { Page.time = d.time; Page.duration = d.duration; updateTime(); });
    bus.on('m2m:play', function (d) {
      $('#m2m-clipname').textContent = d.name + ' · ' + d.tracks + ' track';
      $('#m2m-play').textContent = '⏸ Pause';
      buildRuler(); buildClipBar(); buildAnimations(); updateTime();
    });
    bus.on('m2m:remix', function () { renderRemix(); });
    bus.on('m2m:playstate', function (d) { $('#m2m-play').textContent = d.playing ? '⏸ Pause' : '▶ Play'; });
    bus.on('m2m:remixstep', function () { renderRemix(); });
    bus.on('m2m:perf', function () { refreshHud(); });
    bus.on('m2m:model', function () { refreshHud(); });
    bus.on('selection:changed', function () { refreshHud(); });
    bus.on('ai:queue', function () { renderAiTasks(); });
    window.addEventListener('resize', function () { Page.resize(); });

    /* keyboard */
    document.addEventListener('keydown', function (e) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.code === 'Space') { e.preventDefault(); $('#m2m-play').click(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); Page.stepFrame(1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); Page.stepFrame(-1); return; }
      if (e.key === 'f' || e.key === 'F') { Page.focus(); return; }
      if (e.key === 'g' || e.key === 'G') { Page.applySettings({ grid: !Page.settings.grid }); syncVpButtons(); return; }
      if (e.key === 'x' || e.key === 'X') { Page.applySettings({ wireframe: !Page.settings.wireframe }); syncVpButtons(); return; }
      if (e.key === 's' || e.key === 'S') { Page.applySettings({ skeleton: !Page.settings.skeleton }); syncVpButtons(); return; }
      const views = { '1': 'perspective', '3': 'front', '4': 'back', '5': 'left', '6': 'right', '7': 'top', '8': 'bottom' };
      if (views[e.key]) Page.setView(views[e.key]);
    });

    updateTime();
    buildRuler();
  }

  function stepAnim(dir) {
    const list = UI.filtered.length ? UI.filtered : (P.M2MMotion.motions(UI.rigId) || []);
    if (!list.length) return;
    let i = list.findIndex(function (a) { return a.name === Page.clipName; });
    i = (i < 0 ? 0 : i) + dir;
    if (i < 0) i = list.length - 1;
    if (i >= list.length) i = 0;
    playAnimation(list[i]);
  }

  window.addEventListener('DOMContentLoaded', init);
  window.M2MUI = UI;
  UI.renderSelected = function () { renderSelected(); };
  UI.renderRemix = function () { renderRemix(); };
  UI.buildAnimations = function () { buildAnimations(); };
})();