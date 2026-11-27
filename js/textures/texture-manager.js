/* ============================================================
 * textures/texture-manager.js — Texture registry, slot assignment,
 * UV preview, danh sách texture từ ảnh import.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const SLOTS = [
    { id: 'map', name: 'BaseColor', short: 'BC' },
    { id: 'normalMap', name: 'Normal', short: 'NM' },
    { id: 'roughnessMap', name: 'Roughness', short: 'RG' },
    { id: 'metalnessMap', name: 'Metallic', short: 'MT' },
    { id: 'aoMap', name: 'AO', short: 'AO' },
    { id: 'emissiveMap', name: 'Emission', short: 'EM' }
  ];

  const Textures = {
    textures: {},       // name -> { name, dataUrl, threeTexture }
    activeSlot: 'map'
  };

  Textures.registerTexture = function (name, dataUrl) {
    const entry = { name: name, dataUrl: dataUrl, threeTexture: null };
    if (window.THREE) {
      const img = new Image();
      img.onload = function () {
        const tex = new THREE.Texture(img);
        tex.needsUpdate = true;
        tex.encoding = THREE.sRGBEncoding;
        tex.flipY = false;
        entry.threeTexture = tex;
        bus.emit('texture:ready', { name: name });
      };
      img.src = dataUrl;
    }
    Textures.textures[name] = entry;
    bus.emit('texture:registered', { name: name, count: Object.keys(Textures.textures).length });
  };

  Textures.assign = function (slotId, textureName, targetObject) {
    const entry = Textures.textures[textureName];
    if (!entry || !entry.threeTexture) {
      bus.emit('notify', { type: 'warning', title: 'Texture', message: 'Texture chưa sẵn sàng.' });
      return;
    }
    const target = targetObject || PixiStudio.State.get('selection') || PixiStudio.Viewport.getMainModel();
    if (!target) {
      bus.emit('notify', { type: 'warning', title: 'Texture', message: 'Chưa có object nào.' });
      return;
    }
    let applied = 0;
    target.traverse(function (o) {
      if (o.isMesh && o.material && !Array.isArray(o.material)) {
        o.material[slotId] = entry.threeTexture;
        if (slotId === 'map') o.material.color.setHex(0xffffff);
        o.material.needsUpdate = true;
        applied++;
      }
    });
    bus.emit('texture:assigned', { slot: slotId, texture: textureName, meshes: applied });
    bus.emit('notify', { type: 'success', title: 'Texture gán vào ' + slotId, message: textureName + ' → ' + applied + ' mesh' });
  };

  Textures.clearSlot = function (slotId, targetObject) {
    const target = targetObject || PixiStudio.State.get('selection') || PixiStudio.Viewport.getMainModel();
    if (!target) return;
    target.traverse(function (o) {
      if (o.isMesh && o.material && !Array.isArray(o.material)) {
        o.material[slotId] = null;
        o.material.needsUpdate = true;
      }
    });
    bus.emit('texture:assigned', { slot: slotId, texture: null });
  };

  /* UV coverage thống kê thật */
  Textures.uvStats = function (targetObject) {
    const target = targetObject || PixiStudio.Viewport.getMainModel();
    let withUV = 0, total = 0;
    if (target) {
      target.traverse(function (o) {
        if (o.isMesh && o.geometry) {
          total++;
          if (o.geometry.attributes.uv) withUV++;
        }
      });
    }
    return { withUV: withUV, total: total };
  };

  /* ============================================================
     TEXTURE OPTIMIZER — FIX IAB RENDERER BLOCK (v5.0.8)
     Texture 2048/4096 JPEG decode + GPU upload + per-frame composite
     là nguyên nhân IAB renderer block ("đơ" khi play animation).
     Giải pháp: downscale texture DISPLAY xuống ≤1024 — giữ
     `originalImage` trong tex.userData cho GLBWriter export (4096 gốc).
     Gọi tự động sau mỗi lần load GLB/FBX.
     ============================================================ */
  const DISPLAY_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'];

  Textures.optimizeDisplay = function (root, maxSize) {
    /* SAFE MODE mặc định: 512px — fix IAB renderer block bằng mọi cách.
       Export vẫn dùng originalImage full-res (GLBWriter ưu tiên userData.originalImage). */
    const limit = maxSize || 512;
    let optimized = 0;
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (mat) {
        if (!mat) return;
        DISPLAY_SLOTS.forEach(function (slot) {
          const tex = mat[slot];
          if (!tex || !tex.image || !tex.image.width) return;
          if (tex.image.width <= limit) return;
          /* giữ original cho export (chỉ lần đầu) */
          if (!tex.userData) tex.userData = {};
          if (!tex.userData.originalImage) tex.userData.originalImage = tex.image;
          const srcW = tex.image.width, srcH = tex.image.height;
          const dstW = limit, dstH = Math.max(1, Math.round(srcH * limit / srcW));
          const canvas = document.createElement('canvas');
          canvas.width = dstW; canvas.height = dstH;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          try { ctx.drawImage(tex.image, 0, 0, dstW, dstH); } catch (e) { return; }
          tex.image = canvas;
          tex.needsUpdate = true;
          optimized++;
        });
      });
    });
    if (optimized) {
      bus.emit('notify', {
        type: 'info', title: '🖼 Texture Safe Mode',
        message: optimized + ' texture display ≤' + limit + 'px — fix IAB block. Export vẫn full-res 4096.',
        duration: 5000
      });
    }
    return { optimized: optimized };
  };

  /* mark skinned-bound model đã optimize để không lặp */
  Textures._optimizedRoots = new Set();

  /* Render danh sách slot + texture cho material panel */
  Textures.renderSlotList = function (container) {
    container.innerHTML = '';
    const target = PixiStudio.Viewport.getMainModel();

    SLOTS.forEach(function (slot) {
      const row = U.el('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:6px;' });
      row.appendChild(U.el('span', { class: 'label-xs', style: 'width:86px;', text: slot.name }));

      const selectWrap = U.el('div', { class: 'select-wrap grow' });
      const select = U.el('select', { class: 'select', style: 'height:26px;font-size:11px;' });
      select.appendChild(U.el('option', { value: '', text: '— none —' }));
      Object.keys(Textures.textures).forEach(function (name) {
        select.appendChild(U.el('option', { value: name, text: name }));
      });
      select.addEventListener('change', function () {
        if (select.value) Textures.assign(slot.id, select.value);
        else Textures.clearSlot(slot.id);
        /* Undo/Redo toàn diện (v2): snapshot giữ ref map cũ nên undo
           khôi phục đúng texture slot trước đó. */
        if (PixiStudio.History) PixiStudio.History.push('Texture: ' + slot.name + ' → ' + (select.value || 'none'));
      });
      selectWrap.appendChild(select);
      row.appendChild(selectWrap);
      container.appendChild(row);
    });

    /* Texture list + UV stats */
    const count = Object.keys(Textures.textures).length;
    const uv = Textures.uvStats(target);
    container.appendChild(U.el('div', { class: 'info-row', style: 'margin-top:8px;' }, [
      U.el('span', { class: 'i-label', text: 'Textures' }),
      U.el('span', { class: 'i-value', text: String(count) })
    ]));
    container.appendChild(U.el('div', { class: 'info-row' }, [
      U.el('span', { class: 'i-label', text: 'UV coverage' }),
      U.el('span', { class: 'i-value', text: uv.total ? uv.withUV + '/' + uv.total + ' mesh' : '—' })
    ]));

    if (!count) {
      container.appendChild(U.el('div', { class: 'empty-state', style: 'padding:10px;' }, [
        U.el('span', { text: 'Chưa có texture — import PNG/JPG qua Asset Library hoặc kéo-thả.' })
      ]));
    }
  };

  /* ============================================================
     UI PANEL riêng (page hiện khi toolbar chọn Texture không có
     trang riêng — tích hợp trong Material panel; ở đây render
     thêm section UV/Preview vào material page khi gọi.)
     ============================================================ */
  Textures.renderPanelSection = function (body) {
    const section = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('uv') }), U.el('span', { text: 'Texture Editor' })])
    ]);
    const sc = U.el('div', { class: 'section-content' });

    /* texture list items */
    Object.keys(Textures.textures).forEach(function (name) {
      const entry = Textures.textures[name];
      const row = U.el('div', { class: 'anim-row' }, [
        U.el('img', { src: entry.dataUrl, style: 'width:34px;height:34px;border-radius:8px;object-fit:cover;border:1px solid var(--border);' }),
        U.el('div', { class: 'a-info' }, [
          U.el('b', { text: name }),
          U.el('span', { text: 'image texture' })
        ])
      ]);
      sc.appendChild(row);
    });

    section.appendChild(sc);
    body.appendChild(section);
  };

  window.PixiStudio.Textures = Textures;
})();
