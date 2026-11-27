/* ============================================================
 * inspector/inspector.js — Inspector panel: bind selection thật,
 * transform 2 chiều, model info, material, animation, physics,
 * tabs Inspector/Scene/Properties/Perf.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Inspector = { activeTab: 'inspector', _updating: false };

  /* ---------- TABS ---------- */
  Inspector.showTab = function (tab) {
    Inspector.activeTab = tab;
    U.$$('[data-inspector-tab]').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-inspector-tab') === tab);
    });
    document.getElementById('inspector-body').classList.toggle('hidden', tab !== 'inspector');
    document.getElementById('scene-body').classList.toggle('hidden', tab !== 'scene');
    document.getElementById('properties-body').classList.toggle('hidden', tab !== 'properties');
    document.getElementById('performance-body').classList.toggle('hidden', tab !== 'performance');
    if (tab === 'scene') PixiStudio.Scene.renderTree();
    if (tab === 'performance') PixiStudio.Perf.renderPanel();
    if (tab === 'properties') Inspector.renderProperties();
  };

  /* ---------- MAIN RENDER (Inspector tab) ---------- */
  Inspector.render = function () {
    const body = document.getElementById('inspector-body');
    if (!body) return;
    const sel = PixiStudio.State.get('selection');
    body.innerHTML = '';

    if (!sel) {
      body.appendChild(U.el('div', { class: 'empty-state' }, [
        U.el('div', { class: 'es-icon', text: '👆' }),
        U.el('b', { text: 'Chưa chọn object nào' }),
        U.el('span', { text: 'Click model trong viewport hoặc Scene tree để inspect.' })
      ]));
      return;
    }

    /* ---- Selected card ---- */
    const entry = sel.userData && sel.userData.modelEntry;
    const card = U.el('div', { class: 'sel-card' });
    const thumb = U.el('div', { class: 'sel-thumb' });
    /* dùng thumbnail đã render nếu là asset sample */
    const libMatch = PixiStudio.AssetLibrary && PixiStudio.AssetLibrary.assets.find(function (a) { return a.name === sel.name; });
    if (libMatch && PixiStudio.AssetLibrary._thumbs[libMatch.id]) {
      thumb.appendChild(U.el('img', { src: PixiStudio.AssetLibrary._thumbs[libMatch.id] }));
    } else {
      thumb.innerHTML = U.icon('character', 'ic-lg');
    }
    card.appendChild(thumb);
    const info = U.el('div', { class: 'sel-info' });
    info.appendChild(U.el('b', { text: sel.name || 'Object' }));
    info.appendChild(U.el('span', { text: entry ? (entry.isGLB ? 'Character · GLB' : 'Character · Sample') : 'Object' }));
    card.appendChild(info);
    body.appendChild(card);

    /* ---- Model Information ---- */
    if (entry && entry.stats) {
      const statsSection = U.el('div', { class: 'section-block' }, [
        U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('info') }), U.el('span', { text: 'Model Information' })])
      ]);
      const sc = U.el('div', { class: 'section-content' });
      const rows = [
        ['Name', entry.name], ['Faces', U.formatNumber(entry.stats.faces)],
        ['Vertices', U.formatNumber(entry.stats.vertices)], ['Triangles', U.formatNumber(entry.stats.triangles)],
        ['Mesh Count', String(entry.stats.meshes)], ['Material Count', String(entry.stats.materials)],
        ['Texture Count', String(entry.stats.textures)], ['File Size', entry.fileSize ? U.formatBytes(entry.fileSize) : (entry.isGLB ? U.formatBytes(PixiStudio.Models.config.DEFAULT_MODEL_SIZE || 0) : 'procedural')],
        ['Height', entry.stats.height + ' u']
      ];
      rows.forEach(function (r) {
        sc.appendChild(U.el('div', { class: 'info-row' }, [
          U.el('span', { class: 'i-label', text: r[0] }),
          U.el('span', { class: 'i-value', text: r[1] })
        ]));
      });
      statsSection.appendChild(sc);
      body.appendChild(statsSection);
    }

    /* ---- Transform ---- */
    const transformSection = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('move') }), U.el('span', { text: 'Transform' })])
    ]);
    const tsc = U.el('div', { class: 'section-content' });

    const axisRow = function (label, channel) {
      const isRot = channel === 'rotation';
      const row = U.el('div', { class: 'vec-row' }, [
        U.el('span', { class: 'vec-label', text: label + (isRot ? ' °' : '') })
      ]);
      ['x', 'y', 'z'].forEach(function (ax) {
        const wrap = U.el('div', { class: 'axis-input ' + ax }, [
          U.el('span', { class: 'ax', text: ax.toUpperCase() })
        ]);
        /* Rotation nhập bằng ĐỘ (trước đây ghi thẳng radian: gõ 45 → 45 rad
           = 2578°, model quay loạn — bug user báo "chưa có chế độ xoay"). */
        const input = U.el('input', { type: 'number', step: isRot ? '1' : '0.05', 'data-channel': channel, 'data-axis': ax });
        input.addEventListener('input', function () {
          Inspector._updating = true;
          const v = parseFloat(input.value) || 0;
          const src = channel === 'position' ? sel.position : channel === 'rotation' ? sel.rotation : sel.scale;
          src[ax] = isRot ? THREE.MathUtils.degToRad(v) : v;
          bus.emit('transform:changed', { id: sel.uuid, source: 'inspector', channel: channel });
          Inspector._updating = false;
        });
        /* Undo/Redo toàn diện (v2): 'change' chỉ bắn khi blur/Enter nên
           1 lần sửa = 1 bước (không spam như 'input' khi kéo số). */
        input.addEventListener('change', function () {
          if (PixiStudio.History) PixiStudio.History.push('Transform ' + channel + ' ' + ax.toUpperCase());
        });
        wrap.appendChild(input);
        row.appendChild(wrap);
      });
      return row;
    };

    /* ---- Gizmo mode (đồng bộ 2 chiều với toolbar viewport + phím Q/W/E/R) ---- */
    const modeRow = U.el('div', { style: 'display:flex;gap:6px;margin-bottom:8px;' });
    Inspector._modeBtns = {};
    [['select', 'Chọn (Q)'], ['move', 'Di chuyển (W)'], ['rotate', 'Xoay (E)'], ['scale', 'Scale (R)']].forEach(function (m) {
      const b = U.el('button', {
        class: 'btn sm grow' + (PixiStudio.State.get('gizmoMode') === m[0] ? ' active' : ''),
        text: m[1],
        onclick: function () { if (PixiStudio.ObjectTools) PixiStudio.ObjectTools.setGizmoMode(m[0]); }
      });
      Inspector._modeBtns[m[0]] = b;
      modeRow.appendChild(b);
    });
    tsc.appendChild(modeRow);

    tsc.appendChild(axisRow('Position', 'position'));
    tsc.appendChild(axisRow('Rotation', 'rotation'));
    tsc.appendChild(axisRow('Scale', 'scale'));

    /* ---- Xoay nhanh theo góc số ---- */
    const OT = PixiStudio.ObjectTools;
    const locked = OT && OT.isLocked(sel);
    if (locked) {
      tsc.appendChild(U.el('div', { style: 'margin:6px 0;color:#ffb454;font-size:11.5px;font-weight:700;', text: '🔒 Object đang khoá — mở khoá để chỉnh sửa transform.' }));
    }
    const rotAxisRow = U.el('div', { style: 'display:flex;gap:6px;margin-top:8px;align-items:center;' }, [
      U.el('span', { class: 'vec-label', style: 'font-size:11.5px;font-weight:600;color:var(--text-2);', text: 'Xoay trục' })
    ]);
    Inspector._rotAxis = Inspector._rotAxis || 'y';
    ['x', 'y', 'z'].forEach(function (ax) {
      const b = U.el('button', {
        class: 'btn sm' + (Inspector._rotAxis === ax ? ' active' : ''),
        text: ax.toUpperCase(),
        onclick: function () {
          Inspector._rotAxis = ax;
          rotAxisRow.querySelectorAll('button').forEach(function (bb) { bb.classList.toggle('active', bb.textContent.toLowerCase() === ax); });
        }
      });
      rotAxisRow.appendChild(b);
    });
    tsc.appendChild(rotAxisRow);
    const quickRow = U.el('div', { style: 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;' });
    [-90, -45, -15, 15, 45, 90].forEach(function (d) {
      quickRow.appendChild(U.el('button', {
        class: 'btn sm grow', text: (d > 0 ? '+' : '') + d + '°', disabled: locked ? true : undefined,
        onclick: function () { if (OT) OT.rotateBy(sel, Inspector._rotAxis || 'y', d); }
      }));
    });
    tsc.appendChild(quickRow);

    /* Snap góc + Space + Pivot */
    const optRow = U.el('div', { style: 'display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap;' });
    const snapSel = U.el('select', { class: 'select', style: 'width:96px;height:27px;font-size:11.5px;', disabled: locked ? true : undefined });
    [['0', 'Snap: tắt'], ['15', 'Snap 15°'], ['45', 'Snap 45°'], ['90', 'Snap 90°']].forEach(function (o) {
      const op = U.el('option', { value: o[0], text: o[1] });
      if (String(OT ? OT.getSnapAngle() : 0) === o[0]) op.selected = true;
      snapSel.appendChild(op);
    });
    snapSel.addEventListener('change', function () { if (OT) OT.setSnapAngle(parseInt(snapSel.value, 10)); });
    optRow.appendChild(snapSel);
    const spaceBtn = U.el('button', {
      class: 'btn sm grow', text: 'Không gian: ' + ((PixiStudio.State.get('gizmoSpace') || 'local') === 'local' ? 'Local' : 'World'),
      onclick: function () {
        if (!OT) return;
        const next = OT.setSpace(OT.getSpace() === 'local' ? 'world' : 'local');
        spaceBtn.textContent = 'Không gian: ' + (next === 'local' ? 'Local' : 'World');
      }
    });
    optRow.appendChild(spaceBtn);
    const pivotSel = U.el('select', { class: 'select', style: 'width:118px;height:27px;font-size:11.5px;', disabled: locked ? true : undefined });
    [['object', 'Tâm: object'], ['feet', 'Tâm: chân'], ['origin', 'Tâm: gốc (0,0,0)']].forEach(function (o) {
      const op = U.el('option', { value: o[0], text: o[1] });
      if ((OT ? OT.getPivot() : 'object') === o[0]) op.selected = true;
      pivotSel.appendChild(op);
    });
    pivotSel.addEventListener('change', function () { if (OT) OT.setPivot(pivotSel.value); });
    optRow.appendChild(pivotSel);
    tsc.appendChild(optRow);

    /* Nút utility */
    const tbtns = U.el('div', { style: 'display:flex;gap:6px;margin-top:6px;' }, [
      U.el('button', { class: 'btn sm grow', text: 'Reset', disabled: locked ? true : undefined, onclick: function () { if (OT) OT.resetTransform(sel); else { sel.position.set(0, sel.position.y, 0); sel.scale.set(1, 1, 1); sel.rotation.set(0, 0, 0); } Inspector.syncTransform(sel); bus.emit('transform:changed', { source: 'reset' }); } }),
      U.el('button', { class: 'btn sm grow', text: 'Reset xoay', disabled: locked ? true : undefined, onclick: function () { if (OT) OT.resetRotation(sel); Inspector.syncTransform(sel); } }),
      U.el('button', { class: 'btn sm grow', text: 'Focus (F)', onclick: function () { PixiStudio.Viewport.focusSelected(); } })
    ]);
    tsc.appendChild(tbtns);
    transformSection.appendChild(tsc);
    body.appendChild(transformSection);

    /* ---- Object actions ---- */
    const objSection = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('cube') }), U.el('span', { text: 'Object' })])
    ]);
    const osc = U.el('div', { class: 'section-content' });
    const nameRow = U.el('div', { style: 'display:flex;gap:6px;margin-bottom:6px;' });
    const nameInput = U.el('input', { type: 'text', class: 'input', style: 'flex:1;height:27px;font-size:11.5px;', value: sel.name || '' });
    nameInput.addEventListener('change', function () { if (OT) OT.rename(sel, nameInput.value); });
    nameRow.appendChild(nameInput);
    osc.appendChild(nameRow);
    const actGrid = U.el('div', { class: 'obj-actions' });
    const actBtn = function (label, fn, dis) {
      return U.el('button', { class: 'btn sm', text: label, disabled: dis ? true : undefined, onclick: fn });
    };
    actGrid.appendChild(actBtn('⧉ Nhân bản', function () { if (OT) OT.duplicate(sel); }));
    actGrid.appendChild(actBtn('🗑 Xoá', function () { if (OT) OT.deleteObj(sel); }, locked));
    actGrid.appendChild(actBtn(sel.visible ? '👁 Ẩn' : '👁 Hiện', function () { if (OT) OT.toggleVisible(sel); }));
    actGrid.appendChild(actBtn(locked ? '🔓 Mở khoá' : '🔒 Khoá', function () { if (OT) OT.setLocked(sel, !locked); }));
    actGrid.appendChild(actBtn('🎯 Focus', function () { if (OT) OT.focus(sel); }));
    actGrid.appendChild(actBtn('⬇ Đặt xuống đất', function () { if (OT) OT.alignToGround(sel); }, locked));
    actGrid.appendChild(actBtn('# Snap lưới', function () { if (OT) OT.snapToGrid(sel); }, locked));
    actGrid.appendChild(actBtn('⧉ Copy transform', function () { if (OT) OT.copyTransform(sel); }));
    actGrid.appendChild(actBtn('⎘ Paste transform', function () { if (OT) OT.pasteTransform(sel); }, locked));
    actGrid.appendChild(actBtn('⇄ Lật X', function () { if (OT) OT.flip(sel, 'x'); }, locked));
    osc.appendChild(actGrid);
    const uniRow = U.el('div', { style: 'display:flex;gap:6px;margin-top:6px;align-items:center;' }, [
      U.el('span', { class: 'vec-label', style: 'font-size:11.5px;font-weight:600;color:var(--text-2);', text: 'Scale đều' })
    ]);
    const uniInput = U.el('input', { type: 'number', step: '0.1', min: '0.01', class: 'input', style: 'flex:1;height:27px;font-size:11.5px;', value: String(U.round(sel.scale.x, 3)), disabled: locked ? true : undefined });
    uniInput.addEventListener('change', function () { if (OT) OT.setUniformScale(sel, parseFloat(uniInput.value)); });
    uniRow.appendChild(uniInput);
    osc.appendChild(uniRow);
    objSection.appendChild(osc);
    body.appendChild(objSection);

    Inspector._transformRefs = { object: sel };

    /* ---- Material ---- */
    const matSection = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('material') }), U.el('span', { text: 'Material' })])
    ]);
    const msc = U.el('div', { class: 'section-content' });
    const previewRow = U.el('div', { class: 'mat-preview-row' });
    previewRow.appendChild(U.el('div', { class: 'mat-sphere' }));
    const mw = U.el('div', { class: 'select-wrap grow' });
    const msel = U.el('select', { class: 'select' });
    ['standard', 'toon', 'cel', 'stylized', 'water', 'glass', 'metal', 'emissive'].forEach(function (t) {
      msel.appendChild(U.el('option', { value: t, text: t }));
    });
    msel.addEventListener('change', function () {
      PixiStudio.Materials.applyType(msel.value, sel);
    });
    mw.appendChild(msel);
    previewRow.appendChild(mw);
    msc.appendChild(previewRow);

    /* texture slots mini */
    const slotRow = U.el('div', { class: 'tex-slot-row' });
    [['BC', 'map'], ['NM', 'normalMap'], ['RG', 'roughnessMap'], ['AO', 'aoMap'], ['EM', 'emissiveMap']].forEach(function (s) {
      slotRow.appendChild(U.el('div', {
        class: 'tex-slot', text: s[0],
        'data-tooltip': s[1],
        onclick: function () { PixiStudio.Materials.renderPanel(); PixiStudio.UI.panels.showLeftPage('material'); }
      }));
    });
    msc.appendChild(slotRow);
    matSection.appendChild(msc);
    body.appendChild(matSection);

    /* ---- Animation ---- */
    const animSection = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('animation') }), U.el('span', { text: 'Animation' })])
    ]);
    const asc = U.el('div', { class: 'section-content' });
    const clips = PixiStudio.Anim.clips;
    if (clips.length) {
      clips.slice(0, 6).forEach(function (c) {
        asc.appendChild(U.el('div', { class: 'anim-row' }, [
          U.el('div', { class: 'anim-thumb', html: U.icon(c.isPreset ? 'wand' : 'file') }),
          U.el('div', { class: 'a-info' }, [
            U.el('b', { text: c.name }),
            U.el('span', { text: c.duration.toFixed(2) + 's · 30 FS' })
          ]),
          U.el('button', {
            class: 'anim-play' + (PixiStudio.Anim.current === c.name ? ' playing' : ''),
            html: U.icon('play'),
            onclick: function () { PixiStudio.Anim.play(c.name); }
          })
        ]));
      });
    } else {
      asc.appendChild(U.el('div', { class: 'empty-state', style: 'padding:8px;' }, [
        U.el('span', { text: 'Chưa có clip — dùng Auto Animate hoặc 16 preset trong Animation panel.' })
      ]));
    }
    asc.appendChild(U.el('button', {
      class: 'btn sm block', style: 'margin-top:8px;',
      html: U.icon('plus') + ' Add Clip (preset)',
      onclick: function () { PixiStudio.UI.panels.showLeftPage('animation'); PixiStudio.Anim.renderPanel(); }
    }));
    animSection.appendChild(asc);
    body.appendChild(animSection);

    /* ---- Physics ---- */
    const physSection = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('physics') }), U.el('span', { text: 'Physics' })])
    ]);
    const psc = U.el('div', { class: 'section-content' });
    PixiStudio.Physics.renderSection(psc, sel);
    physSection.appendChild(psc);
    body.appendChild(physSection);
  };

  /* Sync transform inputs từ object (khi gizmo kéo) — Rotation hiển thị ĐỘ */
  Inspector.syncTransform = function (object3D) {
    if (!object3D) return;
    const body = document.getElementById('inspector-body');
    if (!body || Inspector.activeTab !== 'inspector') return;
    U.$$('input[data-channel]', body).forEach(function (input) {
      const ch = input.getAttribute('data-channel');
      const ax = input.getAttribute('data-axis');
      const src = ch === 'position' ? object3D.position : ch === 'rotation' ? object3D.rotation : object3D.scale;
      if (document.activeElement !== input) {
        const v = ch === 'rotation' ? THREE.MathUtils.radToDeg(src[ax]) : src[ax];
        input.value = U.round(v, 3);
      }
    });
  };

  /* Đồng bộ nút mode gizmo (toolbar viewport / phím tắt đổi mode). */
  Inspector.syncModeButtons = function () {
    if (!Inspector._modeBtns) return;
    const mode = PixiStudio.State.get('gizmoMode');
    Object.keys(Inspector._modeBtns).forEach(function (m) {
      Inspector._modeBtns[m].classList.toggle('active', m === mode);
    });
  };

  /* Properties tab */
  Inspector.renderProperties = function () {
    const body = document.getElementById('properties-body');
    if (!body) return;
    body.innerHTML = '';
    const sel = PixiStudio.State.get('selection');
    body.appendChild(U.el('div', { class: 'page-block' }, [
      U.el('h4', { text: 'Object Properties' }),
      sel ? U.el('div', { class: 'section-block' }, [
        U.el('div', { class: 'section-content' }, [
          U.el('div', { class: 'info-row' }, [U.el('span', { class: 'i-label', text: 'UUID' }), U.el('span', { class: 'i-value', text: sel.uuid.slice(0, 13) + '…' })]),
          U.el('div', { class: 'info-row' }, [U.el('span', { class: 'i-label', text: 'Type' }), U.el('span', { class: 'i-value', text: sel.type || 'Object3D' })]),
          U.el('div', { class: 'info-row' }, [U.el('span', { class: 'i-label', text: 'Children' }), U.el('span', { class: 'i-value', text: String(sel.children.length) })]),
          U.el('div', { class: 'info-row' }, [U.el('span', { class: 'i-label', text: 'Visible' }), U.el('span', { class: 'i-value', text: sel.visible ? 'true' : 'false' })])
        ])
      ]) : U.el('div', { class: 'empty-state' }, [U.el('span', { text: 'Chưa chọn object.' })])
    ]));

    /* Settings nhanh */
    const settings = PixiStudio.State.settings;
    const toggles = [
      ['Shadows', settings.shadows, function (on) { settings.shadows = on; PixiStudio.Lighting.setShadows(on); PixiStudio.State.saveSettings(); }],
      ['PixiJS Overlay FX', PixiStudio.PixiRenderer.enabled, function (on) { PixiStudio.PixiRenderer.setEnabled(on); }],
      ['Autosave', settings.autosave, function (on) { settings.autosave = on; PixiStudio.State.saveSettings(); }]
    ];
    toggles.forEach(function (t) {
      const row = U.el('div', { class: 'toggle-row' }, [U.el('span', { class: 't-label', text: t[0] })]);
      const toggle = U.el('div', { class: 'toggle' + (t[1] ? ' on' : '') });
      toggle.addEventListener('click', function () {
        t[2](!t[1]);
        t[1] = !t[1];
        toggle.classList.toggle('on', t[1]);
      });
      row.appendChild(toggle);
      body.appendChild(row);
    });
  };

  /* ---------- EVENT WIRING ---------- */
  Inspector.init = function () {
    U.$$('[data-inspector-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        Inspector.showTab(tab.getAttribute('data-inspector-tab'));
      });
    });

    /* Selection changed → render */
    bus.on('selection:changed', function (data) {
      if (Inspector.activeTab === 'inspector') Inspector.render();
      /* statusbar */
      const sb = document.getElementById('sb-selected');
      if (sb) sb.textContent = data.name || '—';
    });

    /* Transform changed từ gizmo → sync inputs */
    bus.on('transform:changing', function () {
      Inspector.syncTransform(PixiStudio.State.get('selection'));
    });
    bus.on('transform:changed', function (data) {
      if (data.source !== 'inspector') Inspector.syncTransform(PixiStudio.State.get('selection'));
      PixiStudio.History && data.source === 'gizmo' && null;
    });

    /* Gizmo mode đổi từ toolbar viewport / phím tắt → sync nút mode */
    bus.on('state:changed', function (data) {
      if (data.key === 'gizmoMode') Inspector.syncModeButtons();
    });

    /* Model loaded → render */
    bus.on('model:loaded', function () {
      if (Inspector.activeTab === 'inspector') Inspector.render();
      const sbObj = document.getElementById('sb-objects');
      if (sbObj) sbObj.textContent = String(Object.keys(PixiStudio.Models.models).length);
    });

    /* scene add button */
    const addBtn = document.getElementById('scene-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        PixiStudio.Modals.pickPrimitive(function (kind) {
          PixiStudio.Scene.createPrimitive(kind);
          Inspector.showTab('scene');
        });
      });
    }

    Inspector.render();
  };

  window.PixiStudio.Inspector = Inspector;
})();
