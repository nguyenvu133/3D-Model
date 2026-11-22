/* animation/mesh2motion-studio.js — Mesh2Motion-style local workspace.
 *
 * Real data only: 326 animation GLB + 52 model variations downloaded from
 * Mesh2Motion (MIT code / CC0 art — mesh2motion.org) into
 * assets/animations/mesh2motion/. Motions play through M2MMotion retargeting
 * onto the rig currently open in the viewport.
 */
(function () {
  'use strict';
  const U = PixiStudio.Utils;
  const bus = PixiStudio.bus;
  const Studio = { category: 'All', attachedProp: null, rigId: 'human' };

  /* local project models (own assets) shown above the downloaded library */
  const MODEL_PRESETS = [
    { id: 'human', name: 'Human · Kiếm hiệp', kind: 'GLB', url: 'assets/models/kiem%20hiep.glb', description: 'Humanoid PBR model for rig and motion tests.' },
    { id: 'tripo-human', name: 'Human · Tripo converted', kind: 'GLB', url: 'assets/models/tripo_convert_kiemhiep.glb', description: 'Tripo-compatible humanoid sample.' },
    { id: 'meshy-human', name: 'Human · Meshy Mixamo', kind: 'FBX', url: 'assets/models/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running.fbx', description: '46-bone Mixamo skeleton with Running clip.' },
    { id: 'beetle', name: 'Mega Beetle', kind: 'GLB', url: 'assets/models/Meshy_AI_Mega_Beetle_20260723_character.glb', description: 'Creature sample for humanoid-rig compatibility testing.' }
  ];

  const RIGS = [['human', 'Human'], ['fox', 'Fox'], ['horse', 'Horse'], ['dragon', 'Dragon'], ['spider', 'Spider'], ['kaiju', 'Kaiju'], ['bird', 'Bird'], ['snake', 'Snake'], ['shark', 'Shark']];

  function category(name) {
    if (/idle|rest|relax|sleep|wait|standing|pose/i.test(name)) return 'Idle';
    if (/attack|punch|kick|sword|slash|shoot|throw|combat|fight|block|defend|hit|death|spell|weapon|grenade|stab|slash/i.test(name)) return 'Combat';
    if (/walk|run|jog|sprint|strafe|crawl|climb|swim|jump|roll|dodge|fly|fall|slide|backflip/i.test(name)) return 'Locomotion';
    if (/dance|bow|greet|clap|cheer|victory|cry|laugh|sing|talk|pray|yes|reject|confused|dab/i.test(name)) return 'Emote';
    return 'Action';
  }

  function loadFile(file) {
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    U.readFileAsArrayBuffer(file).then(function (buf) {
      if (ext === 'fbx' && PixiStudio.FbxRig) return PixiStudio.FbxRig.loadFromFile(file).then(function () { PixiStudio.FbxRig.addToViewport(); PixiStudio.FbxRig.play('Running'); });
      if (ext === 'glb' || ext === 'gltf') return PixiStudio.Models.loadGLBFromBuffer(buf, file.name, file.size);
      throw new Error('Chỉ hỗ trợ GLB/FBX trong workflow này.');
    }).then(function () { bus.emit('notify', { type: 'success', title: 'Model imported', message: file.name + ' đã sẵn sàng cho Rig/Animate.' }); })
      .catch(function (e) { bus.emit('notify', { type: 'error', title: 'Import lỗi', message: e.message }); });
  }

  Studio.loadPreset = function (p) {
    if (p.kind === 'FBX' && PixiStudio.FbxRig) {
      return PixiStudio.FbxRig.loadFromUrl(p.url).then(function () { PixiStudio.FbxRig.addToViewport(); PixiStudio.FbxRig.play('Running'); })
        .then(function () { bus.emit('notify', { type: 'success', title: 'Preset loaded', message: p.name + ' (FBX rig)' }); });
    }
    return fetch(p.url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(function (buf) { return PixiStudio.Models.loadGLBFromBuffer(buf, p.name, buf.byteLength); })
      .then(function () { bus.emit('notify', { type: 'success', title: 'Preset loaded', message: p.name + ' đã nạp để kiểm thử.' }); })
      .catch(function (e) { bus.emit('notify', { type: 'error', title: 'Preset lỗi', message: e.message }); });
  };

  Studio.attachProp = function (kind) {
    const root = (PixiStudio.FbxRig && PixiStudio.FbxRig.fbxRoot) || (PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current && PixiStudio.RigAutoGen.current.target);
    if (!root) { bus.emit('notify', { type: 'warning', title: 'Props', message: 'Load rig trước để gắn prop vào tay.' }); return; }
    let hand = null;
    root.traverse(function (o) { if (!hand && o.isBone && /RightHand|hand_r/i.test(o.name)) hand = o; });
    if (!hand) { bus.emit('notify', { type: 'warning', title: 'Props', message: 'Không tìm thấy RightHand trên rig hiện tại.' }); return; }
    if (Studio.attachedProp && Studio.attachedProp.parent) Studio.attachedProp.parent.remove(Studio.attachedProp);
    const mat = new THREE.MeshStandardMaterial({ color: kind === 'sword' ? 0xbfc7d5 : kind === 'shield' ? 0x3566d4 : 0xd48b35, metalness: 0.55, roughness: 0.35 });
    const geo = kind === 'shield' ? new THREE.CylinderGeometry(0.18, 0.18, 0.06, 24) : kind === 'staff' ? new THREE.CylinderGeometry(0.025, 0.025, 0.75, 12) : new THREE.BoxGeometry(0.06, 0.7, 0.025);
    const prop = new THREE.Mesh(geo, mat);
    prop.name = 'Prop_' + kind; prop.position.set(0, 0.25, 0); prop.rotation.z = kind === 'sword' ? -0.1 : 0;
    hand.add(prop); Studio.attachedProp = prop;
    bus.emit('notify', { type: 'success', title: 'Prop attached', message: kind + ' → ' + hand.name });
  };

  /* ---------------- panel ---------------- */
  Studio.renderPanel = function () {
    const body = document.getElementById('animation-page-body'); if (!body) return;
    const old = document.getElementById('mesh2motion-workspace'); if (old) old.remove();
    const section = U.el('div', { class: 'section-block', id: 'mesh2motion-workspace' });
    section.appendChild(U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('game') }), U.el('span', { text: 'Mesh2Motion Workspace — Local + Downloaded Library' })]));
    const sc = U.el('div', { class: 'section-content' });
    sc.appendChild(U.el('div', { class: 'dim small', style: 'line-height:1.5;margin-bottom:8px;', text: '326 animation GLB + model variations (CC0, mesh2motion.org) đã tải về assets/animations/mesh2motion. Chọn một → phát ngay bằng retarget trên rig đang mở.' }));

    const input = U.el('input', { type: 'file', accept: '.glb,.gltf,.fbx', style: 'display:none;' });
    input.onchange = function () { loadFile(input.files[0]); }; sc.appendChild(input);
    const top = U.el('div', { style: 'display:flex;gap:6px;margin-bottom:8px;' });
    top.appendChild(U.el('button', { class: 'btn primary grow', text: 'Use Your Model', onclick: function () { input.click(); } }));
    top.appendChild(U.el('button', { class: 'btn grow', text: 'Use Rigged Model', onclick: function () {
      if (PixiStudio.FbxRig && PixiStudio.FbxRig.loaded) { PixiStudio.FbxRig.addToViewport(); PixiStudio.FbxRig.play('Running'); }
      else if (PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current) PixiStudio.RigAutoGen.playing = true;
      else bus.emit('notify', { type: 'warning', title: 'Rigged Model', message: 'Chưa có rigged model — hãy Load FBX hoặc Auto-Rig trước.' });
    } }));
    sc.appendChild(top);

    /* ---- own model presets ---- */
    sc.appendChild(U.el('div', { class: 'section-head', style: 'margin:4px 0;' }, [U.el('span', { text: 'Model Library — project assets' })]));
    MODEL_PRESETS.forEach(function (p) {
      const row = U.el('div', { style: 'display:flex;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border-soft);' });
      row.appendChild(U.el('div', { style: 'flex:1;min-width:0;' }, [U.el('b', { text: p.name, style: 'display:block;font-size:11px;' }), U.el('span', { class: 'dim small', text: p.description })]));
      row.appendChild(U.el('button', { class: 'btn sm', text: 'Load', onclick: function () { Studio.loadPreset(p); } }));
      row.appendChild(U.el('a', { class: 'btn sm', text: 'Download', href: p.url, download: '', target: '_blank' }));
      sc.appendChild(row);
    });

    /* ---- downloaded model variations ---- */
    const varTitle = U.el('div', { class: 'section-head', style: 'margin:10px 0 4px;' }, [U.el('span', { text: 'Downloaded Character Library' })]);
    sc.appendChild(varTitle);
    const varRigRow = U.el('div', { class: 'select-wrap', style: 'margin-bottom:6px;' });
    const varRig = U.el('select', { class: 'select m2m-var-rig' });
    RIGS.forEach(function (r) { varRig.appendChild(U.el('option', { value: r[0], text: r[1] })); });
    varRigRow.appendChild(varRig); sc.appendChild(varRigRow);
    const varGrid = U.el('div', { class: 'm2m-var-grid', style: 'max-height:170px;overflow:auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;' });
    sc.appendChild(varGrid);

    function paintVariations() {
      const M = PixiStudio.M2MMotion;
      varGrid.innerHTML = '';
      if (!M || !M.catalog) { varGrid.appendChild(U.el('div', { class: 'dim small', text: 'Đang tải catalog…' })); return; }
      const rigId = varRig.value;
      const rig = M.catalog.rigs[rigId] || {};
      const vars = M.variations(rigId);
      const items = [{ name: 'base-model', url: rig.model, preview: null }].concat(vars);
      items.forEach(function (v) {
        if (!v.url) return;
        const card = U.el('div', { style: 'border:1px solid var(--border-soft);border-radius:7px;padding:5px;min-width:0;' });
        const prev = M.previewUrl(rigId, v.name);
        if (prev) card.appendChild(U.el('img', { src: prev, style: 'width:100%;height:52px;object-fit:cover;border-radius:5px;margin-bottom:4px;', onerror: 'this.style.display="none"' }));
        card.appendChild(U.el('b', { text: v.name, style: 'font-size:10px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }));
        const brow = U.el('div', { style: 'display:flex;gap:3px;margin-top:4px;' });
        brow.appendChild(U.el('button', { class: 'btn sm grow', text: 'Load', onclick: function () { Studio.loadPreset({ name: v.name, url: v.url, kind: 'GLB' }); } }));
        brow.appendChild(U.el('a', { class: 'btn sm', text: '↓', href: v.url, download: '', target: '_blank' }));
        card.appendChild(brow); varGrid.appendChild(card);
      });
      varTitle.querySelector('span').textContent = 'Downloaded Character Library — ' + rigId + ' (' + (items.length - 1) + ' variations)';
    }
    varRig.addEventListener('change', paintVariations);

    /* ---- props ---- */
    sc.appendChild(U.el('div', { class: 'section-head', style: 'margin:10px 0 4px;' }, [U.el('span', { text: 'Props' })]));
    const propRow = U.el('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;' });
    ['sword', 'shield', 'staff'].forEach(function (k) { propRow.appendChild(U.el('button', { class: 'btn sm', text: k, onclick: function () { Studio.attachProp(k); } })); });
    sc.appendChild(propRow);

    /* ---- motion library (real GLB, retargeted) ---- */
    const libTitle = U.el('div', { class: 'section-head', style: 'margin:10px 0 4px;' }, [U.el('span', { text: 'Motion Library · đang tải…' })]);
    sc.appendChild(libTitle);
    const libTop = U.el('div', { style: 'display:flex;gap:6px;margin-bottom:6px;' });
    const libRig = U.el('select', { class: 'select', style: 'flex:1;' });
    RIGS.forEach(function (r) { libRig.appendChild(U.el('option', { value: r[0], text: r[1] + ' animations' })); });
    libTop.appendChild(libRig);
    libTop.appendChild(U.el('button', { class: 'btn sm', text: '⏹ Stop', onclick: function () { if (PixiStudio.M2MMotion) PixiStudio.M2MMotion.stop(); } }));
    libTop.appendChild(U.el('button', { class: 'btn sm', text: '⏺ Probe', onclick: function () {
      if (!PixiStudio.M2MMotion) return;
      PixiStudio.M2MMotion.probe(700).then(function (r) {
        if (!r) return bus.emit('notify', { type: 'warning', title: 'Probe', message: 'Không tìm thấy bone để đo — cần rig trong viewport.' });
        bus.emit('notify', { type: r.maxTravel > 0.002 ? 'success' : 'warning', title: 'Motion probe', message: 'Bone di chuyển tối đa ' + r.maxTravel + ' đơn vị (' + r.bones.join(', ') + ')' });
      });
    } }));
    sc.appendChild(libTop);
    const search = U.el('input', { class: 'input', placeholder: 'Filter animations (tên hoặc tag: sword, walk, dance…)', style: 'margin-bottom:6px;' });
    sc.appendChild(search);
    const chips = U.el('div', { class: 'chip-row', style: 'margin-bottom:6px;' });
    ['All', 'Locomotion', 'Combat', 'Idle', 'Emote', 'Action'].forEach(function (c) {
      const b = U.el('button', { class: 'chip' + (Studio.category === c ? ' active' : ''), text: c, onclick: function () {
        Studio.category = c;
        chips.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active'); paintMotions();
      } });
      chips.appendChild(b);
    });
    sc.appendChild(chips);
    const grid = U.el('div', { class: 'm2m-lib-grid', style: 'max-height:300px;overflow:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;' });
    sc.appendChild(grid);

    function paintMotions() {
      const M = PixiStudio.M2MMotion;
      grid.innerHTML = '';
      if (!M || !M.catalog) { grid.appendChild(U.el('div', { class: 'dim small', text: 'Catalog chưa tải — chạy: node tools/download-mesh2motion.mjs' })); return; }
      const rigId = libRig.value;
      M.setRig(rigId);
      const all = M.motions(rigId);
      const q = (search.value || '').toLowerCase();
      const cat = Studio.category;
      const shown = all.filter(function (m) {
        const hay = (m.name + ' ' + (m.tags || []).join(' ')).toLowerCase();
        if (q && hay.indexOf(q) < 0) return false;
        if (cat !== 'All' && category(m.name) !== cat) return false;
        return true;
      });
      libTitle.querySelector('span').textContent = 'Motion Library · ' + all.length + ' ' + rigId + ' (CC0) — hiện ' + shown.length;
      shown.forEach(function (m) {
        const btn = U.el('button', {
          class: 'btn sm',
          title: (m.tags || []).join(', ') + ' · ' + (m.duration || 0).toFixed(2) + 's' + (m.loop ? ' · loop' : '') + (m.rootMotion ? ' · root motion' : ''),
          text: m.name + ' · ' + (m.duration || 0).toFixed(1) + 's',
          onclick: function () {
            const M2 = PixiStudio.M2MMotion;
            M2.loop = !!m.loop;
            M2.useRootMotion = !!m.rootMotion;
            btn.classList.add('primary');
            M2.play(m.url, m.name).then(function (info) {
              if (info) {
                bus.emit('notify', { type: 'success', title: 'Playing ' + m.name, message: info.tracks + ' track · ' + info.duration.toFixed(2) + 's · retarget sang rig hiện tại' });
                if (M2.probe) M2.probe(600).then(function (p) {
                  if (p && p.maxTravel <= 0.002) bus.emit('notify', { type: 'warning', title: 'Motion probe', message: m.name + ': bone gần như không đổi — rig hiện tại có thể thiếu bone khớp.' });
                });
              }
            });
          }
        });
        grid.appendChild(btn);
      });
    }
    libRig.addEventListener('change', paintMotions);
    search.addEventListener('input', paintMotions);

    /* ---- Rig theo họ nhân vật: dựng bone đúng tên gốc để clip của rig đó bind 1:1 ---- */
    sc.appendChild(U.el('div', { class: 'section-head', style: 'margin:12px 0 4px;' }, [U.el('span', { text: 'Rig theo họ nhân vật (bone map)' })]));
    const famRow = U.el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;' });
    const famSel = U.el('select', { class: 'select', style: 'flex:1;min-width:120px;' });
    [['humanoid', 'Humanoid — human'], ['quadruped', 'Quadruped — fox/horse/kaiju'], ['dragon', 'Dragon'], ['bird', 'Bird'], ['serpent', 'Serpent — snake'], ['fish', 'Fish — shark'], ['arachnid', 'Arachnid — spider']].forEach(function (f) {
      famSel.appendChild(U.el('option', { value: f[0], text: f[1] }));
    });
    famRow.appendChild(famSel);
    sc.appendChild(famRow);
    const famHint = U.el('div', { class: 'dim small', style: 'line-height:1.45;margin-bottom:6px;' });
    function paintFamily() {
      const C = PixiStudio.CreatureRigs;
      if (!C) { famHint.textContent = 'CreatureRigs chưa nạp.'; return; }
      const fam = C.families[famSel.value];
      famHint.textContent = 'Rig ' + fam.label + ' → bone: ' + fam.rigs.join(', ') + '. Bấm “Rig nhân vật đã import” để dựng bone đúng tên gốc trên mesh đang chọn (cần import model trước).';
    }
    famSel.addEventListener('change', paintFamily); paintFamily(); sc.appendChild(famHint);
    const famBtns = U.el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' });
    famBtns.appendChild(U.el('button', { class: 'btn primary sm grow', text: '🦴 Rig nhân vật đã import', onclick: function () {
      const C = PixiStudio.CreatureRigs;
      if (!C) return;
      const fam = C.families[famSel.value];
      const rigId = fam.rigs[0];
      const target = (PixiStudio.State.get('selection') && PixiStudio.State.get('selection').isObject3D)
        ? PixiStudio.State.get('selection')
        : (PixiStudio.Models.getCurrent() ? PixiStudio.Models.getCurrent().object3D : PixiStudio.Viewport.getMainModel());
      if (!target) { bus.emit('notify', { type: 'warning', title: 'Rig', message: 'Import nhân vật trước (Use Your Model).' }); return; }
      PixiStudio.Notifications.showLoading('Đang dựng rig ' + rigId + '…', 40);
      C.build(target, rigId).then(function (rig) {
        PixiStudio.Notifications.hideLoading();
        if (rig) {
          libRig.value = rigId;
          paintMotions();
          bus.emit('notify', { type: 'info', title: 'Rig xong', message: 'Chọn animation trong danh sách — clip phát theo tên bone ' + rig.boneCount + ' bone.' });
        }
      });
    } }));
    famBtns.appendChild(U.el('button', { class: 'btn sm grow', text: '📦 Nạp model rig này', onclick: function () {
      const C = PixiStudio.CreatureRigs;
      if (!C) return;
      const fam = C.families[famSel.value];
      const base = document.querySelector('#mesh2motion-workspace .m2m-var-rig');
      const rigId = base ? base.value : fam.rigs[0];
      PixiStudio.Notifications.showLoading('Đang nạp model rig ' + rigId + '…', 40);
      C.loadRigModel(rigId).then(function (e) {
        PixiStudio.Notifications.hideLoading();
        if (e) { libRig.value = rigId; paintMotions(); }
      });
    } }));
    famBtns.appendChild(U.el('button', { class: 'btn sm', text: '🧪 Rig QA', onclick: function () {
      const C = PixiStudio.CreatureRigs;
      const rig = C && C.current;
      if (!rig) { bus.emit('notify', { type: 'warning', title: 'Rig QA', message: 'Chưa dựng rig creature.' }); return; }
      let bones = 0, skinned = 0;
      rig.target.traverse(function (o) { if (o.isBone) bones++; if (o.isSkinnedMesh) skinned++; });
      bus.emit('notify', { type: skinned ? 'success' : 'warning', title: 'Rig QA — ' + rig.rigId, message: bones + ' bone · ' + skinned + ' skinned mesh · họ ' + rig.family });
    } }));
    sc.appendChild(famBtns);

    section.appendChild(sc); body.insertBefore(section, body.firstChild);

    /* load catalog then paint both lists */
    if (PixiStudio.M2MMotion) {
      PixiStudio.M2MMotion.loadCatalog().then(function () { paintVariations(); paintMotions(); });
    } else { paintVariations(); paintMotions(); }
  };

  window.PixiStudio.Mesh2Motion = Studio;
})();
