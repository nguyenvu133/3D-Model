/* ============================================================
 * materials/material-manager.js — 8 loại material, chỉnh tham số
 * PBR THẬT, apply selection/toàn model, UI Material Studio.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const TYPES = [
    { id: 'standard', name: 'PBR Standard', make: function (color) { return new THREE.MeshStandardMaterial({ color: color, roughness: 0.6, metalness: 0.1 }); } },
    { id: 'toon', name: 'Toon Shader', make: function (color) { return new THREE.MeshToonMaterial({ color: color }); } },
    { id: 'cel', name: 'Cel Shading', make: function (color) { const m = new THREE.MeshToonMaterial({ color: color }); m.gradientMap = null; return m; } },
    { id: 'stylized', name: 'Stylized Shader', make: function (color) { return new THREE.MeshStandardMaterial({ color: color, roughness: 0.85, metalness: 0.0, flatShading: true }); } },
    { id: 'water', name: 'Water Shader', make: function (color) { return new THREE.MeshStandardMaterial({ color: 0x2a7fbf, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.72 }); } },
    { id: 'glass', name: 'Glass Shader', make: function (color) { return new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35, side: THREE.DoubleSide }); } },
    { id: 'metal', name: 'Metal Shader', make: function (color) { return new THREE.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.18, metalness: 0.95 }); } },
    { id: 'emissive', name: 'Emissive Shader', make: function (color) { const m = new THREE.MeshStandardMaterial({ color: color, roughness: 0.4 }); m.emissive = new THREE.Color(color); m.emissiveIntensity = 0.65; return m; } }
  ];

  const MaterialManager = {
    currentType: 'standard',
    params: {
      color: '#8a8a9a',
      metalness: 0.1,
      roughness: 0.6,
      emissive: 0,
      emissiveColor: '#713bff',
      opacity: 1,
      flatShading: false,
      wireframe: false,
      doubleSide: false
    },
    applyMode: 'selection'   // selection | whole
  };

  MaterialManager.collectMaterials = function (object3D) {
    const mats = [];
    object3D.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      if (Array.isArray(o.material)) mats.push.apply(mats, o.material);
      else mats.push(o.material);
    });
    return mats;
  };

  MaterialManager.applyType = function (typeId, targetObject) {
    const type = TYPES.find(function (t) { return t.id === typeId; });
    if (!type || !window.THREE) return;
    MaterialManager.currentType = typeId;

    const target = targetObject || PixiStudio.State.get('selection') || PixiStudio.Viewport.getMainModel();
    if (!target) {
      bus.emit('notify', { type: 'warning', title: 'Material', message: 'Chưa có object nào để áp material.' });
      return;
    }

    const newMat = type.make(new THREE.Color(MaterialManager.params.color));
    MaterialManager.applyParams(newMat, MaterialManager.params);

    const scope = MaterialManager.applyMode === 'whole'
      ? PixiStudio.Viewport.getMainModel() || target
      : target;

    scope.traverse(function (o) {
      if (o.isMesh) o.material = newMat;
    });

    bus.emit('material:updated', { id: typeId, params: MaterialManager.params, target: scope.name });
  };

  MaterialManager.applyParams = function (mat, p) {
    if (!mat) return;
    if (p.color !== undefined) mat.color = new THREE.Color(p.color);
    if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
      if (p.metalness !== undefined) mat.metalness = p.metalness;
      if (p.roughness !== undefined) mat.roughness = p.roughness;
      if (p.emissive !== undefined) {
        mat.emissive = new THREE.Color(p.emissiveColor || '#000000');
        mat.emissiveIntensity = p.emissive;
      }
    }
    if (p.opacity !== undefined) {
      mat.opacity = p.opacity;
      mat.transparent = p.opacity < 1;
    }
    if (p.flatShading !== undefined) mat.flatShading = !!p.flatShading;
    if (p.wireframe !== undefined) mat.wireframe = !!p.wireframe;
    if (p.doubleSide !== undefined) mat.side = p.doubleSide ? THREE.DoubleSide : THREE.FrontSide;
    mat.needsUpdate = true;
  };

  MaterialManager.updateParam = function (key, value) {
    MaterialManager.params[key] = value;
    /* AUTO-UPDATE: áp đúng scope — whole model hoặc selection */
    const sel = PixiStudio.State.get('selection');
    const model = PixiStudio.Viewport.getMainModel();
    const target = MaterialManager.applyMode === 'whole' ? (model || sel) : (sel || model);
    if (!target) return;
    MaterialManager.collectMaterials(target).forEach(function (m) {
      MaterialManager.applyParams(m, MaterialManager.params);
    });
    /* live refresh viewport shading */
    PixiStudio.Viewport.invalidateShading();
    bus.emit('material:updated', { id: MaterialManager.currentType, params: MaterialManager.params, target: target.name });
  };

  /* AUTO-UPDATE: material panel tự re-render khi selection đổi */
  bus.on('selection:changed', U.debounce(function () {
    const page = document.getElementById('page-material');
    if (page && !page.classList.contains('hidden') && PixiStudio.Materials) {
      PixiStudio.Materials.renderPanel();
    }
  }, 250));

  /* ============================================================
     UI PANEL (page-material)
     ============================================================ */
  MaterialManager.renderPanel = function () {
    const body = U.$('#material-page-body');
    if (!body) return;
    body.innerHTML = '';

    /* Material type list */
    const grid = U.el('div', { class: 'mt-grid', style: 'grid-template-columns:repeat(2,1fr);' });
    TYPES.forEach(function (t) {
      grid.appendChild(U.el('button', {
        class: 'mt-btn' + (MaterialManager.currentType === t.id ? ' primary' : ''),
        html: U.icon('material') + '<span>' + t.name + '</span>',
        onclick: function () {
          MaterialManager.applyType(t.id);
          MaterialManager.renderPanel();
        }
      }));
    });
    body.appendChild(U.el('div', { class: 'page-block' }, [
      U.el('h4', { text: 'Material Types — 8 shader' }),
      grid
    ]));

    /* Apply scope — select dropdown (auto-update rõ ràng hơn toggle) */
    const scopeRow = U.el('div', { class: 'toggle-row' }, [
      U.el('span', { class: 't-label', text: 'Auto-update scope' })
    ]);
    const scopeWrap = U.el('div', { class: 'select-wrap', style: 'width:150px;' });
    const scopeSel = U.el('select', { class: 'select', style: 'height:26px;font-size:11px;' });
    [['selection', 'Selection'], ['whole', 'Toàn model (live)']].forEach(function (o) {
      const opt = U.el('option', { value: o[0], text: o[1] });
      if (MaterialManager.applyMode === o[0]) opt.selected = true;
      scopeSel.appendChild(opt);
    });
    scopeSel.addEventListener('change', function () {
      MaterialManager.applyMode = scopeSel.value;
      bus.emit('notify', { type: 'info', title: 'Auto-update scope', message: scopeSel.value === 'whole' ? 'Mọi thay đổi material áp TOÀN MODEL live.' : 'Chỉ áp selection.' });
    });
    scopeWrap.appendChild(scopeSel);
    scopeRow.appendChild(scopeWrap);
    body.appendChild(scopeRow);

    /* Material presets — one-click apply */
    const presetRow = U.el('div', { class: 'chip-row', style: 'margin-bottom:10px;' });
    [
      ['Kim loại', 0x9aa4b0, 0.95, 0.18],
      ['Nhựa', 0xe8e8e8, 0.05, 0.45],
      ['Vàng', 0xd8a838, 1.0, 0.25],
      ['Gỗ', 0x8a5a34, 0.0, 0.75],
      ['Đá', 0x7c7c8a, 0.0, 0.9],
      ['Kính', 0xbfe8ff, 0.1, 0.05]
    ].forEach(function (p) {
      presetRow.appendChild(U.el('div', {
        class: 'chip',
        html: '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#' + p[1].toString(16).padStart(6, '0') + ';margin-right:4px;"></span>' + p[0],
        onclick: function () {
          MaterialManager.updateParam('color', '#' + p[1].toString(16).padStart(6, '0'));
          MaterialManager.updateParam('metalness', p[2]);
          MaterialManager.updateParam('roughness', p[3]);
          bus.emit('notify', { type: 'info', title: 'Preset ' + p[0], message: 'Đã áp live (auto-update scope).' });
        }
      }));
    });
    body.appendChild(presetRow);

    /* Params */
    const params = MaterialManager.params;
    const section = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('material') }), U.el('span', { text: 'PBR Parameters' })])
    ]);
    const sc = U.el('div', { class: 'section-content' });

    /* Color picker */
    const colorRow = U.el('div', { class: 'slider-row' }, [
      U.el('span', { class: 's-label', text: 'Base Color' }),
      (function () {
        const c = U.el('input', { type: 'color', class: 'slider', value: params.color, style: 'height:26px;border:none;background:transparent;cursor:pointer;' });
        c.addEventListener('input', function () { MaterialManager.updateParam('color', c.value); });
        return c;
      })(),
      U.el('span', { class: 's-val mono', text: params.color })
    ]);
    sc.appendChild(colorRow);

    /* Sliders */
    const sliders = [
      ['metalness', 'Metallic', 0, 1, 0.01],
      ['roughness', 'Roughness', 0, 1, 0.01],
      ['opacity', 'Opacity', 0.05, 1, 0.01],
      ['emissive', 'Emissive', 0, 2, 0.05]
    ];
    sliders.forEach(function (sdef) {
      const row = U.el('div', { class: 'slider-row' }, [
        U.el('span', { class: 's-label', text: sdef[1] })
      ]);
      const s = U.el('input', { type: 'range', class: 'slider', min: String(sdef[2]), max: String(sdef[3]), step: String(sdef[4]), value: String(params[sdef[0]]) });
      const val = U.el('span', { class: 's-val', text: String(params[sdef[0]]) });
      s.addEventListener('input', function () {
        val.textContent = s.value;
        MaterialManager.updateParam(sdef[0], parseFloat(s.value));
      });
      row.appendChild(s); row.appendChild(val);
      sc.appendChild(row);
    });

    /* Toggles */
    ['flatShading', 'wireframe', 'doubleSide'].forEach(function (key) {
      const row = U.el('div', { class: 'toggle-row' }, [
        U.el('span', { class: 't-label', text: { flatShading: 'Flat Shading', wireframe: 'Wireframe', doubleSide: 'Double Side' }[key] })
      ]);
      const t = U.el('div', { class: 'toggle' + (params[key] ? ' on' : '') });
      t.addEventListener('click', function () {
        params[key] = !params[key];
        t.classList.toggle('on', params[key]);
        MaterialManager.updateParam(key, params[key]);
      });
      row.appendChild(t);
      sc.appendChild(row);
    });

    section.appendChild(sc);
    body.appendChild(section);

    /* Texture slots bridge */
    const texSection = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('image') }), U.el('span', { text: 'Texture Slots' })])
    ]);
    const tsc = U.el('div', { class: 'section-content' });
    if (PixiStudio.Textures) PixiStudio.Textures.renderSlotList(tsc);
    texSection.appendChild(tsc);
    body.appendChild(texSection);
  };

  window.PixiStudio.Materials = MaterialManager;
})();
