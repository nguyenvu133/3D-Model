/* ============================================================
 * rigging/meshy-rigging.js — RIGGING STUDIO (v5.0.6)
 * Pipeline giống Meshy workspace Rigging:
 *   1. Model preview (FBX Meshy hoặc model hiện tại)
 *   2. Auto-Rigging button (Humanoid) → backend analyze + bone tree
 *   3. ✓ Auto-Rigging complete — N bones status
 *   4. Bone tree preview + Go to Animation
 * Meshy FBX: dùng FBX thật có sẵn skeleton Mixamo — đọc bone tree
 * trực tiếp (không cần sinh) — giống workflow Meshy: upload → rig → animate
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const RIG_PRESETS = [
    { id: 'hero-glb', name: 'Hero · Kiếm hiệp', description: 'Humanoid GLB PBR để test auto-rig, material và export.', url: 'assets/models/kiem%20hiep.glb', type: 'glb' },
    { id: 'tripo-hero', name: 'Hero · Tripo GLB', description: 'Bản GLB chuyển đổi dùng kiểm thử tương thích Tripo/Meshy.', url: 'assets/models/tripo_convert_kiemhiep.glb', type: 'glb' },
    { id: 'beetle', name: 'Mega Beetle', description: 'Creature model để kiểm tra giới hạn humanoid rig.', url: 'assets/models/Meshy_AI_Mega_Beetle_20260723_character.glb', type: 'glb' },
    { id: 'meshy-running', name: 'Meshy Humanoid Running', description: 'FBX Mixamo 46 bones, có clip Running để test animate.', url: 'assets/models/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running.fbx', type: 'fbx' }
  ];

  const MeshyRigging = {
    state: 'idle',          // idle | rigging | rigged
    rigType: 'humanoid',
    boneCount: 0,
    boneNames: [],
    modelSource: '—'        // 'Meshy FBX' | 'Current model'
  };

  /* ============================================================
     AUTO-RIGGING — pipeline Meshy:
     • FBX Meshy loaded → skeleton Mixamo có sẵn (46 bones) → rigged ngay
     • FBX character (không anim) → đọc skeleton
     • Model khác → RigAutoGen backend analyze
     ============================================================ */
  MeshyRigging.autoRig = function () {
    MeshyRigging.state = 'rigging';
    MeshyRigging.renderPanel();
    PixiStudio.Notifications.showLoading('Auto-Rigging — phân tích skeleton…', 40);

    return new Promise(function (resolve) {
      /* Ưu tiên 1: FBX Meshy đã load (có sẵn rig) */
      if (PixiStudio.FbxRig.loaded && PixiStudio.FbxRig.skeleton) {
        setTimeout(function () {
          PixiStudio.FbxRig.addToViewport();
          MeshyRigging.state = 'rigged';
          MeshyRigging.boneCount = PixiStudio.FbxRig.skeleton.boneCount;
          MeshyRigging.boneNames = PixiStudio.FbxRig.skeleton.boneNames.slice();
          MeshyRigging.modelSource = 'Meshy FBX (Mixamo rig)';
          PixiStudio.Notifications.hideLoading();
          /* play Running preview so the user can verify actual motion */
          if (PixiStudio.FbxRig.generated.length) PixiStudio.FbxRig.play('Running');
          /* focus */
          if (PixiStudio.Viewport.orbit) {
            PixiStudio.Viewport.setView('perspective');
            PixiStudio.Viewport.orbit.dTarget.set(0, 1.0, 0);
            PixiStudio.Viewport.orbit.dRadius = 3.6;
          }
          bus.emit('notify', {
            type: 'success', title: '✓ Auto-Rigging complete',
            message: MeshyRigging.boneCount + ' bones Mixamo — model đã trong viewport, play Idle.'
          });
          MeshyRigging.renderPanel();
          resolve(true);
        }, 600);
        return;
      }

      /* Ưu tiên 2: load FBX Meshy từ server rồi rig */
      PixiStudio.FbxRig.autoLoad().then(function (result) {
        if (result) {
          PixiStudio.FbxRig.addToViewport();
          MeshyRigging.state = 'rigged';
          MeshyRigging.boneCount = PixiStudio.FbxRig.skeleton.boneCount;
          MeshyRigging.boneNames = PixiStudio.FbxRig.skeleton.boneNames.slice();
          MeshyRigging.modelSource = 'Meshy FBX (Mixamo rig)';
          PixiStudio.Notifications.hideLoading();
          if (PixiStudio.Viewport.orbit) {
            PixiStudio.Viewport.setView('perspective');
            PixiStudio.Viewport.orbit.dTarget.set(0, 1.0, 0);
            PixiStudio.Viewport.orbit.dRadius = 3.6;
          }
          if (PixiStudio.FbxRig.generated.length) PixiStudio.FbxRig.play('Running');
          bus.emit('notify', {
            type: 'success', title: '✓ Auto-Rigging complete',
            message: MeshyRigging.boneCount + ' bones Mixamo từ ' + PixiStudio.FbxRig.fileName
          });
          MeshyRigging.renderPanel();
          resolve(true);
          return;
        }

        /* Ưu tiên 3: backend analyze trên model hiện tại */
        PixiStudio.Notifications.updateLoading(60, 'Backend analyze vertex distribution…');
        PixiStudio.RigAutoGen.generateAsync(null, 'Studio Humanoid').then(function (skeleton) {
          PixiStudio.RigAutoGen.generate(null, 'Studio Humanoid');
          if (skeleton) PixiStudio.RigAutoGen.applyBackendAnchors(skeleton);
          if (PixiStudio.RigAutoGen.current && PixiStudio.AnimAutoGen) {
            PixiStudio.RigAutoGen.current.clips = PixiStudio.AnimAutoGen.generateAll(PixiStudio.RigAutoGen.current);
          }
          PixiStudio.RigAutoGen.playing = true;
          if (PixiStudio.AnimAutoGen) PixiStudio.AnimAutoGen.play('Idle');
          PixiStudio.Viewport.focusSelected();

          MeshyRigging.state = 'rigged';
          MeshyRigging.boneCount = PixiStudio.RigAutoGen.current ? Object.keys(PixiStudio.RigAutoGen.current.bones).length : 0;
          MeshyRigging.modelSource = 'Current model (backend analyze)';
          PixiStudio.Notifications.hideLoading();
          MeshyRigging.renderPanel();
          resolve(true);
        });
      });
    });
  };

  /* ============================================================
     PANEL RENDER — Meshy Rigging style
     ============================================================ */
  MeshyRigging.renderPanel = function () {
    let body = document.getElementById('rigging-page-body');
    /* Khi user mở toolbar Rig, page-rigging bị ẩn; render vào page-rig chính
       để hai nút Studio/Mixamo và Rig Bridge nằm cùng workflow, không lộn xộn. */
    if (!body || body.closest('.lp-page') && body.closest('.lp-page').classList.contains('hidden')) body = document.getElementById('rig-page-body');
    if (!body) return;
    const isMainRig = body.id === 'rig-page-body';
    const currentRig = PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
    if (currentRig && currentRig.target) {
      MeshyRigging.state = 'rigged';
      MeshyRigging.boneCount = currentRig.boneCount || Object.keys(currentRig.bones || {}).length;
      MeshyRigging.modelSource = currentRig.preset || currentRig.name || 'Current model';
    }
    if (isMainRig) {
      const oldRoot = document.getElementById('meshy-rigging-root');
      if (oldRoot) oldRoot.remove();
      const root = U.el('div', { id: 'meshy-rigging-root' });
      body.appendChild(root);
      body = root;
    } else {
      body.innerHTML = '';
    }
    const rigged = MeshyRigging.state === 'rigged';

    /* Character Rig Presets — model thật, mô tả và tải/test giống workflow
       Tripo/Meshy; không tạo kết quả giả. */
    const presetBlock = U.el('div', { class: 'section-block', style: 'margin-bottom:10px;' });
    presetBlock.appendChild(U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('model') }), U.el('span', { text: 'Character Rig Presets' })]));
    const presetBody = U.el('div', { class: 'section-content' });
    const presetGrid = U.el('div', { style: 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;' });
    RIG_PRESETS.forEach(function (p) {
      const card = U.el('div', { style: 'border:1px solid var(--border-soft);border-radius:8px;padding:6px;min-width:0;' });
      card.appendChild(U.el('b', { text: p.name, style: 'font-size:11px;display:block;' }));
      card.appendChild(U.el('div', { class: 'dim small', text: p.description, style: 'line-height:1.35;margin:3px 0 6px;' }));
      const row = U.el('div', { style: 'display:flex;gap:4px;' });
      row.appendChild(U.el('button', { class: 'btn sm primary grow', text: 'Load / Rig', onclick: function () {
        if (PixiStudio.AnimateStudio) {
          const found = (window.PixiStudio.AnimateStudio && window.PixiStudio.AnimateStudio.loadPreset) ? window.PixiStudio.AnimateStudio.loadPreset(p) : null;
          if (found && found.then) found.then(function () { MeshyRigging.renderPanel(); });
        } else bus.emit('notify', { type: 'warning', title: 'Preset', message: 'Animate Studio chưa sẵn sàng.' });
      } }));
      row.appendChild(U.el('a', { class: 'btn sm', text: 'File', href: p.url, download: '', target: '_blank' }));
      card.appendChild(row); presetGrid.appendChild(card);
    });
    presetBody.appendChild(presetGrid); presetBlock.appendChild(presetBody); body.appendChild(presetBlock);

    /* ==== Auto-Rigging card ==== */
    const card = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('rig') }),
        U.el('span', { text: 'Auto-Rigging — Meshy Pipeline' })
      ])
    ]);
    const cc = U.el('div', { class: 'section-content' });

    /* Model preview thumb */
    const previewRow = U.el('div', { style: 'display:flex;gap:10px;align-items:center;margin-bottom:10px;' });
    const thumb = U.el('div', { style: 'width:56px;height:56px;border-radius:10px;background:linear-gradient(150deg,#2c2c40,#1a1a2c);border:1px solid var(--border);display:grid;place-items:center;color:#b79bff;flex:none;' });
    thumb.innerHTML = U.icon(rigged ? 'character' : 'cube', 'ic-lg');
    previewRow.appendChild(thumb);
    const info = U.el('div', { style: 'flex:1;min-width:0;' });
    const model = PixiStudio.Models.getCurrent();
    info.appendChild(U.el('b', { text: rigged ? 'Rigged Model' : (model ? model.name : 'Chưa chọn model'), style: 'font-size:12.5px;display:block;' }));
    info.appendChild(U.el('span', { class: 'dim small', text: MeshyRigging.modelSource }));
    previewRow.appendChild(info);
    cc.appendChild(previewRow);

    /* Rigging type select */
    const rw = U.el('div', { class: 'select-wrap', style: 'margin-bottom:10px;' });
    const sel = U.el('select', { class: 'select', id: 'meshy-rig-type' });
    [['humanoid', 'Humanoid (Mixamo-compatible)'], ['humanoid23', 'Humanoid 23 bones (Studio)'], ['quadruped', 'Quadruped — ⏸ planned']].forEach(function (o) {
      const opt = U.el('option', { value: o[0], text: o[1] });
      if (o[0] === MeshyRigging.rigType) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      if (sel.value === 'quadruped') {
        bus.emit('notify', { type: 'warning', title: 'Quadruped', message: 'Planned v5.1 — hiện chỉ hỗ trợ Humanoid.' });
        sel.value = MeshyRigging.rigType === 'quadruped' ? 'humanoid' : MeshyRigging.rigType;
        return;
      }
      MeshyRigging.rigType = sel.value;
    });
    rw.appendChild(sel);
    cc.appendChild(rw);

    /* AUTO-RIGGING button lớn kiểu Meshy */
    cc.appendChild(U.el('button', {
      class: 'btn primary lg block' + (MeshyRigging.state === 'rigging' ? '' : ''),
      style: MeshyRigging.state === 'rigging' ? 'opacity:.7;' : '',
      html: MeshyRigging.state === 'rigging'
        ? '<span class="spinner"></span>&nbsp; Rigging…'
        : U.icon('wand') + '&nbsp; Auto-Rigging',
      onclick: function () {
        if (MeshyRigging.state !== 'rigging') MeshyRigging.autoRig();
      }
    }));

    /* Status sau rig */
    if (rigged) {
      const st = U.el('div', { class: 'check-row', style: 'margin-top:10px;' }, [
        U.el('span', { class: 'check', html: U.icon('check', 'ic-sm') }),
        U.el('span', { text: '✓ Auto-Rigging complete — ' + MeshyRigging.boneCount + ' bones' })
      ]);
      cc.appendChild(st);
    }
    card.appendChild(cc);
    body.appendChild(card);

    /* ==== Bone tree ==== */
    if (rigged) {
      const boneSection = U.el('div', { class: 'section-block' }, [
        U.el('div', { class: 'section-head' }, [
          U.el('span', { html: U.icon('rig') }),
          U.el('span', { text: 'Bone Tree (' + MeshyRigging.boneNames.length + ')' })
        ])
      ]);
      const bc = U.el('div', { class: 'section-content', style: 'max-height:180px;overflow-y:auto;' });
      const core = MeshyRigging.boneNames.filter(function (n) {
        return /Hips|Spine|Chest|Neck|Head|Arm|Hand|UpLeg|Leg|Foot|Shoulder|Root/i.test(n) &&
          !/Thumb|Middle|Ring|Index|Pinkie|Toe/i.test(n);
      });
      core.forEach(function (n) {
        bc.appendChild(U.el('div', { class: 'tree-row', style: 'padding:3px 6px;' }, [
          U.el('span', { class: 't-icon', html: U.icon('bone', 'ic-sm') }),
          U.el('span', { class: 't-name', text: n })
        ]));
      });
      boneSection.appendChild(bc);
      body.appendChild(boneSection);

      /* Rigging QA/actions kiểu Tripo: các nút đều tác động lên rig thật,
         không giả lập kết quả cloud. */
      const qaRow = U.el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;' });
      qaRow.appendChild(U.el('button', { class: 'btn sm', text: 'Rig QA', onclick: function () {
        const root = PixiStudio.FbxRig && PixiStudio.FbxRig.loaded ? PixiStudio.FbxRig.fbxRoot : (PixiStudio.RigAutoGen.current && PixiStudio.RigAutoGen.current.target);
        let bones = 0, skinned = 0, meshes = 0;
        if (root) root.traverse(function (o) { if (o.isBone) bones++; if (o.isSkinnedMesh) { skinned++; meshes++; } else if (o.isMesh && !(o.userData && o.userData.isBoneVisual)) meshes++; });
        const quality = bones && skinned ? 'Ready for animation' : 'Needs skin binding';
        bus.emit('notify', { type: bones && skinned ? 'success' : 'warning', title: 'Rig QA', message: bones + ' bones · ' + skinned + '/' + meshes + ' skinned mesh · ' + quality });
      }}));
      qaRow.appendChild(U.el('button', { class: 'btn sm', text: 'Skeleton', onclick: function () {
        if (PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current) PixiStudio.RigAutoGen.toggleVisibility();
        if (PixiStudio.FbxRig && PixiStudio.FbxRig.fbxRoot) PixiStudio.FbxRig.fbxRoot.traverse(function (o) { if (o.isSkeletonHelper) o.visible = !o.visible; });
      }}));
      qaRow.appendChild(U.el('button', { class: 'btn sm', text: 'Re-bind skin', onclick: function () {
        if (PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.rebindSkin) {
          const n = PixiStudio.RigAutoGen.rebindSkin();
          bus.emit('notify', { type: 'success', title: 'Skin re-bound', message: n + ' mesh đã bind lại với skeleton hiện tại.' });
        } else bus.emit('notify', { type: 'warning', title: 'Re-bind skin', message: 'Rig hiện tại là FBX skeleton; dùng clip preview để kiểm tra bind.' });
      }}));
      qaRow.appendChild(U.el('button', { class: 'btn sm', text: 'Export Rig JSON', onclick: function () {
        const src = PixiStudio.FbxRig && PixiStudio.FbxRig.loaded ? PixiStudio.FbxRig.skeleton : (PixiStudio.RigAutoGen.current ? { boneCount: PixiStudio.RigAutoGen.current.boneCount, bones: Object.keys(PixiStudio.RigAutoGen.current.bones) } : null);
        if (src) U.downloadText(JSON.stringify({ format: 'pixi-studio-rig-1', exportedAt: new Date().toISOString(), skeleton: src }, null, 2), 'rig-skeleton.json', 'application/json');
        else bus.emit('notify', { type: 'warning', title: 'Export Rig', message: 'Chưa có skeleton.' });
      }}));
      cc.appendChild(qaRow);
      body.appendChild(U.el('button', {
        class: 'btn accent lg block',
        style: 'margin-bottom:12px;',
        html: U.icon('animation') + '&nbsp; Go to Animation — play clips',
        onclick: function () { PixiStudio.Toolbar.selectTool('animation'); if (PixiStudio.FbxRig.loaded) PixiStudio.FbxRig.play('Running'); }
      }));
    }

    /* Rig Bridge: đổi quy ước giữa Tripo Studio / Meshy Mixamo / Studio Humanoid.
       Cùng một mesh chỉ có một skin active; khi đổi bridge sẽ tháo rig cũ và bind
       lại, tránh hai skeleton dùng chung chồng lên nhau. */
    {
      const bridge = U.el('div', { class: 'section-block', style: 'margin-top:10px;' });
      bridge.appendChild(U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('link') }), U.el('span', { text: 'Rig Bridge — Tripo ↔ Meshy' })]));
      const br = U.el('div', { class: 'section-content' });
      const desc = U.el('div', { class: 'dim small', style: 'line-height:1.45;margin-bottom:7px;', text: 'Chọn chuẩn đích để retarget clip/skin. Meshy = Mixamo naming; Tripo Studio = Studio Humanoid. Chỉ một rig active trên mesh tại một thời điểm.' });
      br.appendChild(desc);
      const select = U.el('select', { class: 'select', style: 'margin-bottom:7px;' });
      [['Studio Humanoid', 'Tripo Studio / Studio Humanoid'], ['Mixamo Compatible', 'Meshy / Mixamo Compatible']].forEach(function (o) { select.appendChild(U.el('option', { value: o[0], text: o[1] })); });
      select.value = (PixiStudio.RigAutoGen.current && PixiStudio.RigAutoGen.current.preset) || 'Studio Humanoid';
      br.appendChild(select);
      const row = U.el('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;' });
      row.appendChild(U.el('button', { class: 'btn sm primary grow', text: 'Apply Bridge', onclick: function () {
        const target = PixiStudio.Viewport.getMainModel();
        if (!target || !PixiStudio.RigAutoGen) { bus.emit('notify', { type: 'warning', title: 'Bridge', message: 'Chưa có model active.' }); return; }
        const rig = PixiStudio.RigAutoGen.generate(target, select.value);
        if (rig) {
          if (PixiStudio.Viewport.focusSelected) PixiStudio.Viewport.focusSelected();
          MeshyRigging.state = 'rigged';
          MeshyRigging.boneCount = rig.boneCount;
          MeshyRigging.modelSource = select.value === 'Mixamo Compatible' ? 'Meshy/Mixamo bridge' : 'Tripo Studio bridge';
          MeshyRigging.renderPanel();
          bus.emit('notify', { type: 'success', title: 'Bridge applied', message: select.value + ' · ' + rig.boneCount + ' bone · skin cũ đã tháo trước khi bind lại.' });
        }
      } }));
      row.appendChild(U.el('button', { class: 'btn sm grow', text: 'Bridge QA', onclick: function () {
        const r = PixiStudio.RigAutoGen.current;
        const t = PixiStudio.Viewport.getMainModel();
        let bones = 0, skinned = 0;
        if (t) t.traverse(function (o) { if (o.isBone) bones++; if (o.isSkinnedMesh) skinned++; });
        bus.emit('notify', { type: bones && skinned ? 'success' : 'warning', title: 'Bridge QA', message: 'active=' + (r ? r.preset : 'none') + ' · ' + bones + ' bone · ' + skinned + ' skinned mesh' });
      } }));
      row.appendChild(U.el('button', { class: 'btn sm', text: 'Export Bridge GLB', onclick: function () {
        if (PixiStudio.AnimGLBExport && PixiStudio.AnimGLBExport.exportNow) PixiStudio.AnimGLBExport.exportNow({ preset: select.value, includeFbx: true, includeGlb: true });
        else bus.emit('notify', { type: 'warning', title: 'Export Bridge', message: 'Animation export module chưa sẵn sàng.' });
      } }));
      br.appendChild(row); bridge.appendChild(br); body.appendChild(bridge);
    }

    /* ==== Pipeline info ==== */
    body.appendChild(U.el('div', { class: 'dim small', style: 'line-height:1.6;margin-bottom:12px;padding:0 2px;', html:
      '<b style="color:#b79bff">Rig/Animation Bridge:</b> Upload model → chọn <b>Studio Humanoid</b> hoặc <b>Meshy/Mixamo</b> → ' +
      '<b>Bridge QA</b> → Preview animation → Export GLB/FBX. Chỉ một skeleton active trên mesh; đổi chuẩn sẽ tháo skin cũ và bind lại.' }));
  };

  MeshyRigging.init = function () {
    if (!MeshyRigging._boundEvents) {
      MeshyRigging._boundEvents = true;
      bus.on('rig:created', function (e) {
        MeshyRigging.state = 'rigged';
        MeshyRigging.boneCount = e && e.boneCount || (PixiStudio.RigAutoGen.current && PixiStudio.RigAutoGen.current.boneCount) || 0;
        MeshyRigging.modelSource = e && e.preset ? e.preset : 'Current model';
        MeshyRigging.renderPanel();
      });
      bus.on('rig:autogen', function (e) {
        MeshyRigging.state = 'rigged';
        MeshyRigging.boneCount = e && e.boneCount || 0;
        MeshyRigging.modelSource = e && e.preset ? e.preset : 'Current model';
        MeshyRigging.renderPanel();
      });
      bus.on('skin:bound', function (e) { if (e && e.count) MeshyRigging.state = 'rigged'; MeshyRigging.renderPanel(); });
    }
    MeshyRigging.renderPanel();
  };

  window.PixiStudio.MeshyRigging = MeshyRigging;
})();
