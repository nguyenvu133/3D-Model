/* ============================================================
 * ui/modals.js — Modal system: open/close, prompt, confirm,
 * Settings, Project Manager, About, Export dialog, pick primitive.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Modals = { _stack: [] };

  Modals.open = function (opts) {
    const root = document.getElementById('modal-root');
    if (!root) return;
    root.innerHTML = '';

    const modal = U.el('div', { class: 'modal' });
    const head = U.el('div', { class: 'modal-head' }, [
      U.el('b', { text: opts.title || 'Dialog' }),
      U.el('button', {
        class: 'icon-btn', html: U.icon('x'),
        onclick: function () { Modals.close(); }
      })
    ]);
    modal.appendChild(head);

    const body = U.el('div', { class: 'modal-body' });
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    modal.appendChild(body);

    if (opts.buttons && opts.buttons.length) {
      const foot = U.el('div', { class: 'modal-foot' });
      opts.buttons.forEach(function (b) {
        foot.appendChild(U.el('button', {
          class: b.class || 'btn',
          text: b.label,
          onclick: function () {
            if (b.onClick) b.onClick();
            if (!b.keepOpen) Modals.close();
          }
        }));
      });
      modal.appendChild(foot);
    }

    root.appendChild(modal);
    root.classList.add('open');

    /* click ngoài → đóng */
    root.onclick = function (e) {
      if (e.target === root) Modals.close();
    };
    /* Esc → đóng (shortcuts cũng handle) */
    Modals._stack.push(modal);
    bus.emit('modal:opened', { title: opts.title });
  };

  Modals.close = function () {
    const root = document.getElementById('modal-root');
    if (root) {
      root.classList.remove('open');
      root.innerHTML = '';
    }
    Modals._stack.length = 0;
    bus.emit('modal:closed', {});
  };

  Modals.isOpen = function () {
    const root = document.getElementById('modal-root');
    return root && root.classList.contains('open');
  };

  /* ---------- PROMPT (input) ---------- */
  Modals.prompt = function (opts) {
    const input = U.el('input', { class: 'input', value: opts.value || '', placeholder: opts.placeholder || '' });
    const wrap = U.el('div', { class: 'form-row' }, [
      U.el('label', { text: opts.label || 'Nhập giá trị:' }),
      input
    ]);
    Modals.open({
      title: opts.title || 'Input',
      body: wrap,
      buttons: [
        { label: 'Cancel', class: 'btn' },
        {
          label: 'OK', class: 'btn primary',
          onClick: function () { if (opts.onOk) opts.onOk(input.value); }
        }
      ]
    });
    setTimeout(function () { input.focus(); input.select(); }, 80);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { Modals.close(); if (opts.onOk) opts.onOk(input.value); }
    });
  };

  /* ---------- CONFIRM ---------- */
  Modals.confirm = function (opts) {
    const wrap = U.el('div', {}, [
      U.el('p', { style: 'color:var(--text-2);line-height:1.6;font-weight:500;', text: opts.message || 'Bạn chắc chắn chứ?' })
    ]);
    Modals.open({
      title: opts.title || 'Confirm',
      body: wrap,
      buttons: [
        { label: 'Cancel', class: 'btn' },
        { label: opts.okLabel || 'OK', class: 'btn ' + (opts.danger ? 'danger' : 'primary'), onClick: function () { if (opts.onOk) opts.onOk(); } }
      ]
    });
  };

  /* ---------- PICK PRIMITIVE ---------- */
  Modals.pickPrimitive = function (onPick) {
    const kinds = [['box', 'Box'], ['sphere', 'Sphere'], ['plane', 'Plane'], ['cylinder', 'Cylinder'], ['cone', 'Cone'], ['torus', 'Torus']];
    const grid = U.el('div', { class: 'mt-grid', style: 'grid-template-columns:repeat(3,1fr);' });
    kinds.forEach(function (k) {
      grid.appendChild(U.el('button', {
        class: 'mt-btn',
        html: U.icon('cube') + '<span>' + k[1] + '</span>',
        onclick: function () { Modals.close(); onPick(k[0]); }
      }));
    });
    Modals.open({ title: 'Create Object', body: grid, buttons: [{ label: 'Cancel', class: 'btn' }] });
  };

  /* ---------- SETTINGS ---------- */
  Modals.showSettings = function () {
    const settings = PixiStudio.State.settings;
    const AIPanel_autoUpdate = PixiStudio.AIPanel ? PixiStudio.AIPanel.autoUpdate : { tripo: true, meshy: true };
    const wrap = U.el('div');

    /* Engine info */
    const snap = PixiStudio.Perf.snapshot();
    wrap.appendChild(U.el('div', { class: 'stat-grid', style: 'margin-bottom:14px;' }, [
      U.el('div', { class: 'stat-cell' }, [U.el('div', { class: 'sc-label', text: 'Renderer' }), U.el('div', { class: 'sc-value', text: 'Three.js r128' })]),
      U.el('div', { class: 'stat-cell' }, [U.el('div', { class: 'sc-label', text: 'WebGL2' }), U.el('div', { class: 'sc-value', text: PixiStudio.ThreeRenderer.webgl2 ? 'Yes' : 'No' })]),
      U.el('div', { class: 'stat-cell' }, [U.el('div', { class: 'sc-label', text: 'WebGPU' }), U.el('div', { class: 'sc-value', text: PixiStudio.ThreeRenderer.webgpuAvailable ? 'Available' : 'No' })]),
      U.el('div', { class: 'stat-cell' }, [U.el('div', { class: 'sc-label', text: 'Max Tex' }), U.el('div', { class: 'sc-value', text: (PixiStudio.ThreeRenderer.maxTextureSize || 0) + 'px' })])
    ]));

    const toggles = [
      ['Shadows (PCF Soft)', settings.shadows, function (on) { settings.shadows = on; PixiStudio.Lighting.setShadows(on); }],
      ['Antialias (reload cần thiết)', settings.antialias, function (on) { settings.antialias = on; }],
      ['PixiJS Overlay FX', PixiStudio.PixiRenderer.enabled, function (on) { PixiStudio.PixiRenderer.setEnabled(on); }],
      ['Autosave (mỗi ' + settings.autosaveInterval + 's)', settings.autosave, function (on) { settings.autosave = on; }],
      ['Quad Labels', PixiStudio.State.get('showQuadLabels'), function (on) { PixiStudio.State.set('showQuadLabels', on); document.getElementById('quad-labels').classList.toggle('hidden', !on); }],
      ['Perf HUD', PixiStudio.State.get('showPerfHud'), function (on) { PixiStudio.State.set('showPerfHud', on); document.getElementById('perf-hud').classList.toggle('hidden', !on); }],
      ['🔄 Auto-update Tripo tasks', AIPanel_autoUpdate.tripo, function (on) { AIPanel_autoUpdate.tripo = on; }],
      ['🔄 Auto-update Meshy FBX', AIPanel_autoUpdate.meshy, function (on) { AIPanel_autoUpdate.meshy = on; }]
    ];
    toggles.forEach(function (t) {
      const row = U.el('div', { class: 'set-row' }, [
        U.el('div', { class: 's-label', text: t[0] })
      ]);
      const toggle = U.el('div', { class: 'toggle' + (t[1] ? ' on' : '') });
      toggle.addEventListener('click', function () {
        t[2](!t[1]); t[1] = !t[1];
        toggle.classList.toggle('on', t[1]);
        PixiStudio.State.saveSettings();
      });
      row.appendChild(toggle);
      wrap.appendChild(row);
    });

    wrap.appendChild(U.el('button', {
      class: 'btn danger block', style: 'margin-top:16px;',
      html: U.icon('trash') + ' Reset toàn bộ settings & timeline',
      onclick: function () {
        Modals.confirm({
          title: 'Reset workspace?',
          message: 'Xoá timeline keyframes + settings (model giữ nguyên).',
          danger: true,
          onOk: function () {
            PixiStudio.Timeline.keys.clearAll();
            PixiStudio.State.resetAll();
            bus.emit('notify', { type: 'success', title: 'Reset xong' });
          }
        });
      }
    }));

    Modals.open({
      title: 'Settings',
      body: wrap,
      buttons: [{ label: 'Done', class: 'btn primary' }]
    });
  };

  /* ---------- PROJECT MANAGER ---------- */
  Modals.showProjectManager = function () {
    const wrap = U.el('div');

    /* Save new */
    const saveRow = U.el('div', { class: 'form-row', style: 'display:flex;gap:6px;' });
    const nameInput = U.el('input', { class: 'input grow', placeholder: 'Tên project…', value: 'My Scene ' + new Date().toLocaleDateString() });
    saveRow.appendChild(nameInput);
    saveRow.appendChild(U.el('button', {
      class: 'btn primary', text: 'Save',
      onclick: function () {
        const name = nameInput.value.trim() || 'untitled';
        PixiStudio.Storage.saveProject(name);
        bus.emit('notify', { type: 'success', title: 'Đã lưu project', message: name });
        Modals.showProjectManager();
      }
    }));
    wrap.appendChild(saveRow);

    wrap.appendChild(U.el('button', {
      class: 'btn block', style: 'margin-bottom:12px;',
      html: U.icon('export') + ' Export project ra file JSON',
      onclick: function () { PixiStudio.Storage.exportProjectFile(nameInput.value.trim() || 'pixi-studio-project'); }
    }));

    /* List */
    const projects = PixiStudio.Storage.listProjects();
    if (!projects.length) {
      wrap.appendChild(U.el('div', { class: 'empty-state' }, [
        U.el('div', { class: 'es-icon', text: '📂' }),
        U.el('b', { text: 'Chưa có project nào' }),
        U.el('span', { text: 'Lưu project đầu tiên — autosave chạy mỗi 60s.' })
      ]));
    } else {
      projects.forEach(function (p) {
        const item = U.el('div', { class: 'project-item' }, [
          U.el('span', { class: 'p-ic', html: U.icon('folder') }),
          U.el('div', { class: 'p-info' }, [
            U.el('b', { text: p.name }),
            U.el('span', { text: p.savedAt + ' · ' + U.formatBytes(p.size) })
          ]),
          U.el('button', {
            class: 'btn sm primary', text: 'Load',
            onclick: function () {
              const ok = PixiStudio.Storage.loadProject(p.name);
              bus.emit('notify', ok
                ? { type: 'success', title: 'Project loaded', message: p.name }
                : { type: 'error', title: 'Load thất bại', message: p.name });
              Modals.close();
            }
          }),
          U.el('button', {
            class: 'btn sm danger', html: U.icon('trash', 'ic-sm'),
            onclick: function () {
              Modals.confirm({
                title: 'Xoá project?',
                message: 'Xoá "' + p.name + '" khỏi localStorage?',
                danger: true,
                onOk: function () {
                  PixiStudio.Storage.deleteProject(p.name);
                  Modals.showProjectManager();
                }
              });
            }
          })
        ]);
        wrap.appendChild(item);
      });
    }

    Modals.open({ title: 'Project Manager', body: wrap, buttons: [{ label: 'Close', class: 'btn' }] });
  };

  /* ---------- ABOUT ---------- */
  Modals.showAbout = function () {
    const wrap = U.el('div', { style: 'text-align:center;' }, [
      U.el('div', { style: 'font-size:44px;margin-bottom:6px;', text: '🎛️' }),
      U.el('b', { style: 'font-size:16px;', text: 'PixiJS Studio × Tripo3D AI Studio' }),
      U.el('p', { class: 'dim', style: 'margin:6px 0 12px;', text: 'v' + PixiStudio.VERSION + ' — All-in-One 3D Game Creation Environment' }),
      U.el('div', { class: 'stat-grid', style: 'text-align:left;' }, [
        U.el('div', { class: 'stat-cell' }, [U.el('div', { class: 'sc-label', text: '3D Engine' }), U.el('div', { class: 'sc-value', text: 'Three.js r128' })]),
        U.el('div', { class: 'stat-cell' }, [U.el('div', { class: 'sc-label', text: '2D Engine' }), U.el('div', { class: 'sc-value', text: 'PixiJS v7' })]),
        U.el('div', { class: 'stat-cell' }, [U.el('div', { class: 'sc-label', text: 'Modules' }), U.el('div', { class: 'sc-value', text: '40+' })]),
        U.el('div', { class: 'stat-cell' }, [U.el('div', { class: 'sc-label', text: 'Model mẫu' }), U.el('div', { class: 'sc-value', text: 'kiemhiep.glb' })])
      ]),
      U.el('p', { class: 'dim small', style: 'margin-top:12px;', text: '100% Vanilla JS — không build tool. Adapter Tripo3D sẵn sàng kết nối backend thật.' })
    ]);
    Modals.open({ title: 'About', body: wrap, buttons: [{ label: 'Close', class: 'btn primary' }] });
  };

  /* ---------- WHAT'S NEW v20.0 ---------- */
  Modals.showWhatsNew = function () {
    const items = (window.PixiStudio && PixiStudio.CHANGELOG_V20) || [];
    const rel = (window.PixiStudio && PixiStudio.RELEASE) || {};
    const wrap = U.el('div', { style: 'text-align:left;' }, [
      U.el('div', { style: 'text-align:center;margin-bottom:8px;' }, [
        U.el('div', { style: 'font-size:40px;', text: '🚀' }),
        U.el('b', { style: 'font-size:16px;', text: 'PixiJS Studio × Tripo3D AI Studio v' + (PixiStudio.VERSION_NAME || PixiStudio.VERSION) }),
        U.el('p', { class: 'dim', style: 'margin:6px 0 4px;', text: (rel.codename ? '“' + rel.codename + '”' : '') + (rel.date ? ' · ' + rel.date : '') + (rel.previous ? ' · nâng cấp từ v' + rel.previous : '') })
      ]),
      U.el('div', {}, items.map(function (it) {
        return U.el('div', { class: 'sc-row', style: 'align-items:flex-start;' }, [
          U.el('span', { style: 'color:var(--success);margin-right:6px;', text: '✓' }),
          U.el('span', { class: 'sc-desc', style: 'white-space:normal;', text: it })
        ]);
      }))
    ]);
    Modals.open({ title: 'Có gì mới trong v' + (PixiStudio.VERSION_NAME || PixiStudio.VERSION), body: wrap, buttons: [{ label: 'Bắt đầu dùng v' + (PixiStudio.VERSION_NAME || PixiStudio.VERSION), class: 'btn primary' }] });
  };

  /* ---------- SHORTCUTS LIST ---------- */
  Modals.showShortcuts = function () {
    const rows = [
      ['W / E / R', 'Gizmo Move / Rotate / Scale'],
      ['Q', 'Select only (tắt gizmo)'],
      ['F', 'Focus object đang chọn'],
      ['Space', 'Play / Pause timeline'],
      ['1 → 8', 'Perspective / Quad / Front / Back / Left / Right / Top / Bottom'],
      ['G', 'Toggle grid'],
      ['X', 'Toggle wireframe'],
      ['Tab', 'Thu gọn left panel'],
      ['K', 'Thêm keyframe tại frame hiện tại'],
      ['Ctrl+S', 'Save project'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
      ['Ctrl+D', 'Duplicate object'],
      ['Delete', 'Xoá object đang chọn'],
      ['Esc', 'Đóng modal / bỏ chọn']
    ];
    const wrap = U.el('div');
    rows.forEach(function (r) {
      wrap.appendChild(U.el('div', { class: 'sc-row' }, [
        U.el('span', { class: 'sc-desc', text: r[1] }),
        U.el('span', { class: 'sc-keys', html: '<span class="kbd">' + r[0] + '</span>' })
      ]));
    });
    Modals.open({ title: 'Keyboard Shortcuts', body: wrap, buttons: [{ label: 'Close', class: 'btn' }] });
  };

  window.PixiStudio.Modals = Modals;
})();
