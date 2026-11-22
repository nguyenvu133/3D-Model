/* ============================================================
 * ui/toolbar.js — Left icon rail: active state, tooltip,
 * chuyển page trái theo module. Map page ↔ module functions.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const TOOLS = [
    { id: 'assets', name: 'Assets', icon: 'assets' },
    { id: 'model', name: 'Model', icon: 'model' },
    { id: 'rig', name: 'Rig', icon: 'rig' },
    { id: 'animation', name: 'Animation', icon: 'animation' },
    { id: 'material', name: 'Material', icon: 'material' },
    { id: 'scene', name: 'Scene', icon: 'scene' },
    { id: 'render', name: 'Render', icon: 'render' },
    { id: 'export', name: 'Export', icon: 'export' },
    { sep: true },
    { id: 'ai', name: 'AI Tools', icon: 'ai', cls: 'ai' }
  ];

  const PANEL_TITLES = {
    assets: 'Asset Library',
    model: 'Model Manager',
    rig: 'Rigging Studio',
    animation: 'Animation Studio',
    material: 'Material Studio',
    scene: 'Scene Editor',
    render: 'Render Settings',
    export: 'Export Center',
    ai: 'Tripo3D AI Tools'
  };

  const Toolbar = { activeTool: 'assets' };

  Toolbar.render = function () {
    const nav = document.getElementById('toolbar');
    if (!nav) return;
    nav.innerHTML = '';
    TOOLS.forEach(function (tool) {
      if (tool.sep) {
        nav.appendChild(U.el('div', { class: 'tool-sep' }));
        return;
      }
      const btn = U.el('button', {
        class: 'tool-btn' + (Toolbar.activeTool === tool.id ? ' active' : '') + (tool.cls ? ' ' + tool.cls : ''),
        html: U.icon(tool.icon, 'ic-lg') + '<span>' + tool.name + '</span>',
        'data-tooltip': tool.name,
        'data-tooltip-side': 'right',
        dataset: { tool: tool.id },
        onclick: function () { Toolbar.selectTool(tool.id); }
      });
      nav.appendChild(btn);
    });

    /* spacer + settings shortcut dưới cùng */
    nav.appendChild(U.el('div', { class: 'tool-spacer' }));
    nav.appendChild(U.el('button', {
      class: 'tool-btn',
      html: U.icon('settings', 'ic-lg') + '<span>Settings</span>',
      'data-tooltip': 'Settings & About',
      'data-tooltip-side': 'right',
      onclick: function () { PixiStudio.Modals.showSettings(); }
    }));
    nav.appendChild(U.el('button', {
      class: 'tool-btn',
      html: U.icon('help', 'ic-lg') + '<span>Help</span>',
      'data-tooltip': 'Keyboard shortcuts',
      'data-tooltip-side': 'right',
      onclick: function () { PixiStudio.Modals.showShortcuts(); }
    }));
  };

  Toolbar.selectTool = function (id) {
    Toolbar.activeTool = id;
    PixiStudio.State.set('leftPage', id);
    /* active states */
    U.$$('#toolbar .tool-btn').forEach(function (btn) {
      const toolId = btn.dataset && btn.dataset.tool;
      btn.classList.toggle('active', toolId === id);
    });
    /* pages */
    U.$$('.lp-page').forEach(function (page) {
      page.classList.toggle('hidden', page.id !== 'page-' + id);
    });
    /* title */
    const title = document.getElementById('left-panel-title');
    if (title) title.textContent = PANEL_TITLES[id] || 'Panel';
    /* render page content động */
    Toolbar.renderPage(id);
    /* mở panel nếu đang collapse trên desktop; trên mobile mở drawer */
    const app = document.getElementById('app');
    if (window.innerWidth <= 1023) {
      document.body.classList.add('left-drawer-open');
    } else if (app.classList.contains('left-collapsed')) {
      app.classList.remove('left-collapsed');
      PixiStudio.State.set('leftCollapsed', false);
    }
    bus.emit('ui:page', { page: id });
  };

  /* render page content theo module */
  Toolbar.renderPage = function (id) {
    switch (id) {
      case 'model':
        if (PixiStudio.Models) Toolbar._renderModelPage();
        break;
      case 'rig':
        if (PixiStudio.Rig) PixiStudio.Rig.renderPanel();
        if (PixiStudio.RigAutoGen) PixiStudio.RigAutoGen.renderPanel();
        if (PixiStudio.MeshyRigging) PixiStudio.MeshyRigging.renderPanel();
        break;
      case 'rigging':
        if (PixiStudio.MeshyRigging) PixiStudio.MeshyRigging.renderPanel();
        break;
      case 'animation':
        if (PixiStudio.Anim) PixiStudio.Anim.renderPanel();
        if (PixiStudio.AnimAutoGen) PixiStudio.AnimAutoGen.renderPanel();
        if (PixiStudio.FbxRig) PixiStudio.FbxRig.renderPanel();
        if (PixiStudio.AnimGLBExport) PixiStudio.AnimGLBExport.renderPanel();
        if (PixiStudio.AnimLibrary) PixiStudio.AnimLibrary.renderPanel();
        if (PixiStudio.AnimateStudio) PixiStudio.AnimateStudio.renderPanel();
        if (PixiStudio.MotionLibrary) PixiStudio.MotionLibrary.renderPanel();
        if (PixiStudio.Mesh2Motion) PixiStudio.Mesh2Motion.renderPanel();
        break;
      case 'material':
        if (PixiStudio.Materials) PixiStudio.Materials.renderPanel();
        break;
      case 'scene':
        if (PixiStudio.Scene) PixiStudio.Scene.renderPage();
        break;
      case 'render':
        Toolbar._renderRenderPage();
        break;
      case 'export':
        if (PixiStudio.SaveManager) {
          PixiStudio.SaveManager.renderPage();
          /* thêm estimate element nếu chưa có */
          const body = document.getElementById('export-page-body');
          if (body && !document.getElementById('save-estimate')) {
            body.insertBefore(U.el('div', {
              class: 'dim small mono',
              id: 'save-estimate',
              style: 'background:var(--panel-2);border:1px solid var(--border-soft);border-radius:8px;padding:7px 9px;margin-bottom:10px;'
            }), body.firstChild);
            PixiStudio.SaveManager.updateEstimate();
          }
        } else {
          Toolbar._renderExportPage();
        }
        break;
      case 'ai':
        if (PixiStudio.AIPanel) PixiStudio.AIPanel.renderPage();
        break;
      /* assets tự render (init) */
    }
  };

  /* ---------- Model Manager page ---------- */
  Toolbar._renderModelPage = function () {
    const body = document.getElementById('model-page-body');
    if (!body) return;
    body.innerHTML = '';

    const ids = Object.keys(PixiStudio.Models.models);
    if (!ids.length) {
      body.appendChild(U.el('div', { class: 'empty-state' }, [
        U.el('div', { class: 'es-icon', text: '📦' }),
        U.el('b', { text: 'Chưa có model' }),
        U.el('span', { text: 'Load kiemhiep.glb hoặc import từ Asset Library.' }),
        U.el('button', {
          class: 'btn primary sm', style: 'margin-top:8px;',
          text: 'Load mẫu chuẩn',
          onclick: function () { PixiStudio.Models.loadDefault(); Toolbar._renderModelPage(); }
        })
      ]));
      return;
    }

    ids.forEach(function (id) {
      const entry = PixiStudio.Models.models[id];
      const current = PixiStudio.Models.currentId === id;
      const block = U.el('div', { class: 'section-block' });
      block.appendChild(U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('character') }),
        U.el('span', { text: entry.name }),
        current ? U.el('span', { class: 'state-badge ok', text: 'active' }) : U.el('span')
      ]));
      const sc = U.el('div', { class: 'section-content' });
      [['Faces', U.formatNumber(entry.stats.faces)], ['Tris', U.formatNumber(entry.stats.triangles)],
       ['Meshes', String(entry.stats.meshes)], ['Size', entry.fileSize ? U.formatBytes(entry.fileSize) : '—']].forEach(function (r) {
        sc.appendChild(U.el('div', { class: 'info-row' }, [
          U.el('span', { class: 'i-label', text: r[0] }),
          U.el('span', { class: 'i-value', text: r[1] })
        ]));
      });
      const btns = U.el('div', { style: 'display:flex;gap:6px;margin-top:8px;' }, [
        U.el('button', {
          class: 'btn sm primary grow', text: 'Select',
          onclick: function () {
            PixiStudio.Models.currentId = id;
            PixiStudio.State.select(entry.object3D);
            PixiStudio.Viewport.focusSelected();
          }
        }),
        U.el('button', {
          class: 'btn sm danger', html: U.icon('trash', 'ic-sm'),
          onclick: function () {
            PixiStudio.Models.remove(id);
            Toolbar._renderModelPage();
          }
        })
      ]);
      sc.appendChild(btns);
      block.appendChild(sc);
      body.appendChild(block);
    });
  };

  /* ---------- Render Settings page ---------- */
  Toolbar._renderRenderPage = function () {
    const body = document.getElementById('render-page-body');
    if (!body) return;
    body.innerHTML = '';

    body.appendChild(U.el('h4', { text: 'Render Engine' }));
    const engines = [
      ['three', 'Three.js WebGL (3D viewport)', true],
      ['pixi', 'PixiJS Overlay (2D FX layer)', true],
      ['webgpu', 'WebGPU (auto-detect)', PixiStudio.ThreeRenderer.webgpuAvailable]
    ];
    engines.forEach(function (e) {
      body.appendChild(U.el('div', { class: 'check-row' + (e[2] ? '' : ' off') }, [
        U.el('span', { class: 'check', html: U.icon(e[2] ? 'check' : 'x', 'ic-sm') }),
        U.el('span', { text: e[1] })
      ]));
    });

    body.appendChild(U.el('h4', { text: 'Shading Modes' }));
    const modes = [['lit', 'Lit (PBR + shadows)'], ['solid', 'Solid (flat)'], ['wireframe', 'Wireframe'], ['xray', 'X-Ray'], ['material', 'Material Preview'], ['render', 'Render Preview']];
    const chipRow = U.el('div', { class: 'chip-row' });
    modes.forEach(function (m) {
      chipRow.appendChild(U.el('div', {
        class: 'chip' + (PixiStudio.State.get('shading') === m[0] ? ' active' : ''),
        text: m[1].split(' ')[0],
        onclick: function () {
          PixiStudio.State.set('shading', m[0]);
          document.getElementById('shading-select').value = m[0];
          PixiStudio.Viewport.invalidateShading();
          Toolbar._renderRenderPage();
        }
      }));
    });
    body.appendChild(chipRow);

    body.appendChild(U.el('h4', { text: 'Lighting' }));
    const lights = PixiStudio.Lighting.lights;
    Object.keys(lights).forEach(function (key) {
      const light = lights[key];
      const row = U.el('div', { class: 'toggle-row' }, [
        U.el('span', { class: 't-label', text: light.name })
      ]);
      const toggle = U.el('div', { class: 'toggle' + (light.visible ? ' on' : '') });
      toggle.addEventListener('click', function () {
        light.visible = !light.visible;
        toggle.classList.toggle('on', light.visible);
        if (PixiStudio.Scene) PixiStudio.Scene.renderTree();
      });
      row.appendChild(toggle);
      body.appendChild(row);
    });
  };

  /* ---------- Export Center page ---------- */
  Toolbar._renderExportPage = function () {
    const body = document.getElementById('export-page-body');
    if (!body) return;
    body.innerHTML = '';

    body.appendChild(U.el('h4', { text: 'Export Center' }));
    const items = [
      ['GLB (binary)', function () { PixiStudio.Exporter.showDialog(); }],
      ['Project JSON', function () { PixiStudio.Storage.exportProjectFile('pixi-studio-project'); }],
      ['Game Ready Manifest', function () { PixiStudio.Exporter.buildGame(); }],
      ['WebM Video 5s', function () { PixiStudio.Exporter.recordWebM(); }]
    ];
    items.forEach(function (it) {
      body.appendChild(U.el('button', { class: 'btn block', style: 'margin-bottom:7px;', text: it[0], onclick: it[1] }));
    });

    /* Import history */
    body.appendChild(U.el('h4', { text: 'Import History' }));
    const history = PixiStudio.Importers.imported;
    if (!history.length) {
      body.appendChild(U.el('div', { class: 'empty-state', style: 'padding:8px;' }, [
        U.el('span', { text: 'Chưa import file nào (kéo-thả hoặc nút Import).' })
      ]));
    } else {
      history.slice(0, 8).forEach(function (h) {
        body.appendChild(U.el('div', { class: 'info-row' }, [
          U.el('span', { class: 'i-label', text: h.name }),
          U.el('span', { class: 'i-value', text: h.type + ' · ' + U.formatBytes(h.size) })
        ]));
      });
    }
  };

  window.PixiStudio.Toolbar = Toolbar;
})();
