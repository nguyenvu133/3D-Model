/* animation/animate-studio.js — Tripo-style Animate workspace for local Studio.
 * Character presets are real local assets. Prompt mode maps supported motion
 * words to real local clips; it never claims cloud generation without backend.
 */
(function () {
  'use strict';
  const U = PixiStudio.Utils;
  const bus = PixiStudio.bus;
  const Studio = { prompt: '', negative: '', duration: 5, last: null };

  const PRESETS = [
    { id: 'hero-glb', name: 'Hero · Kiếm hiệp', description: 'Nhân vật humanoid Tripo-converted, texture PBR 1024, phù hợp kiểm thử rig và GLB animation.', type: 'glb', url: 'assets/models/kiem%20hiep.glb', local: 'assets/models/kiem hiep.glb', tags: 'humanoid hero sword pbr' },
    { id: 'tripo-hero', name: 'Hero · Tripo GLB', description: 'Bản GLB chuyển đổi tương thích Tripo/Meshy, dùng để kiểm tra texture và vật liệu.', type: 'glb', url: 'assets/models/tripo_convert_kiemhiep.glb', local: 'assets/models/tripo_convert_kiemhiep.glb', tags: 'tripo humanoid pbr' },
    { id: 'beetle', name: 'Mega Beetle', description: 'Quái vật mẫu low-poly lớn, dùng để kiểm tra import model và pipeline animation.', type: 'glb', url: 'assets/models/Meshy_AI_Mega_Beetle_20260723_character.glb', local: 'assets/models/Meshy_AI_Mega_Beetle_20260723_character.glb', tags: 'creature beetle monster' },
    { id: 'meshy-running', name: 'Meshy Humanoid · Running FBX', description: 'FBX Mixamo có skeleton 46 bone và clip Running, dùng test Animate AI Gen.', type: 'fbx', url: 'assets/models/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running.fbx', local: 'assets/models/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running/Meshy_AI_kiem_hiep_20261121_animated_mixamo_Running.fbx', tags: 'meshy mixamo running fbx' }
  ];

  function safeText(v) { return String(v || '').replace(/[<>]/g, ''); }
  function currentPromptClip(prompt) {
    const p = String(prompt || '').toLowerCase();
    if (/run|sprint|jog|chạy|chay/.test(p)) return 'Running';
    if (/walk|đi bộ|di bo/.test(p)) return 'Walk';
    if (/attack|slash|sword|strike|đánh|danh|chém|chem/.test(p)) return 'Attack';
    if (/combo|chain hit|liên hoàn|lien hoan/.test(p)) return 'Combo';
    if (/dodge|roll|né|ne|lăn|lan/.test(p)) return 'Dodge';
    if (/dance|nhảy múa|nhay mua/.test(p)) return 'Dance';
    if (/victory|win|chiến thắng|chien thang/.test(p)) return 'Victory';
    return 'Idle';
  }

  Studio.loadPreset = function (preset) {
    if (preset.type === 'glb') {
      return fetch(preset.url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }).then(function (buf) {
        return PixiStudio.Models.loadGLBFromBuffer(buf, preset.name, buf.byteLength);
      }).then(function () {
        Studio.last = preset.id;
        bus.emit('notify', { type: 'success', title: 'Model preset loaded', message: preset.name + ' — đã nạp model thật để kiểm thử.' });
        if (PixiStudio.Viewport) PixiStudio.Viewport.focusSelected();
        return true;
      }).catch(function (e) { bus.emit('notify', { type: 'error', title: 'Load preset lỗi', message: e.message }); return false; });
    }
    if (preset.type === 'fbx' && PixiStudio.FbxRig) {
      return PixiStudio.FbxRig.loadFromUrl(preset.url).then(function (r) {
        PixiStudio.FbxRig.addToViewport();
        PixiStudio.FbxRig.play('Running');
        Studio.last = preset.id;
        bus.emit('notify', { type: 'success', title: 'FBX preset loaded', message: preset.name + ' — Running đang phát trên skeleton thật.' });
        return !!r;
      }).catch(function (e) { bus.emit('notify', { type: 'error', title: 'Load FBX lỗi', message: e.message }); return false; });
    }
    return Promise.resolve(false);
  };

  Studio.generatePrompt = function (prompt, negative, duration) {
    const text = String(prompt || '').trim();
    if (!text) { bus.emit('notify', { type: 'warning', title: 'AI Animation', message: 'Nhập prompt chuyển động trước.' }); return; }
    const clip = currentPromptClip(text);
    const hasLocal = (PixiStudio.FbxRig && PixiStudio.FbxRig.loaded && PixiStudio.FbxRig.generated.some(function (c) { return c.id === clip; })) ||
      (PixiStudio.AnimPresets && PixiStudio.AnimPresets.META.some(function (m) { return m.id === clip.toLowerCase(); }));
    if (hasLocal) {
      if (PixiStudio.FbxRig && PixiStudio.FbxRig.loaded) PixiStudio.FbxRig.play(clip);
      else if (PixiStudio.AnimLibrary) PixiStudio.AnimLibrary.play(clip);
      Studio.last = { prompt: text, negative: negative || '', duration: duration || 5, clip: clip, mode: 'local-prompt-mapped' };
      bus.emit('notify', { type: 'success', title: 'AI Animation local preview', message: 'Prompt đã map vào clip thật: ' + clip + ' · ' + (duration || 5) + 's. Đây là local preview, chưa phải cloud generation.' });
      return Studio.last;
    }
    bus.emit('notify', { type: 'warning', title: 'AI Animation backend chưa kết nối', message: 'Prompt chưa map được clip local. Kết nối Tripo backend trong AI Tools để gửi task thật; không tạo kết quả giả.' });
    return null;
  };

  Studio.renderPanel = function () {
    const body = document.getElementById('animation-page-body');
    if (!body) return;
    const old = document.getElementById('tripo-animate-studio');
    if (old) old.remove();
    const section = U.el('div', { class: 'section-block', id: 'tripo-animate-studio' });
    section.appendChild(U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('wand') }), U.el('span', { text: '✨ Tripo Animate Studio — Presets + AI Animation' })]));
    const sc = U.el('div', { class: 'section-content' });

    sc.appendChild(U.el('div', { class: 'dim small', style: 'line-height:1.5;margin-bottom:8px;', text: 'Workflow: chọn character preset → Rig/Animate → nhập prompt → Preview/Apply → Export GLB. Preset dùng asset thật trong project; AI prompt local chỉ mapping clip khi chưa có backend.' }));
    const modelTitle = U.el('div', { class: 'section-head', style: 'margin:4px 0;' }, [U.el('span', { text: 'Character Model Presets' })]); sc.appendChild(modelTitle);
    const search = U.el('input', { class: 'input', placeholder: 'Search character preset…', style: 'margin-bottom:7px;' }); sc.appendChild(search);
    const grid = U.el('div', { class: 'mt-grid', style: 'grid-template-columns:repeat(2,1fr);gap:6px;' }); sc.appendChild(grid);
    function draw(q) {
      grid.innerHTML = '';
      PRESETS.filter(function (p) { return !q || (p.name + ' ' + p.description + ' ' + p.tags).toLowerCase().indexOf(q.toLowerCase()) >= 0; }).forEach(function (p) {
        const card = U.el('div', { style: 'border:1px solid var(--border-soft);border-radius:8px;padding:7px;min-width:0;' });
        card.appendChild(U.el('b', { text: p.name, style: 'display:block;font-size:11px;' }));
        card.appendChild(U.el('div', { class: 'dim small', style: 'line-height:1.35;margin:4px 0 6px;', text: p.description }));
        const row = U.el('div', { style: 'display:flex;gap:4px;' });
        row.appendChild(U.el('button', { class: 'btn sm primary grow', text: 'Load / Test', onclick: function () { Studio.loadPreset(p); } }));
        row.appendChild(U.el('a', { class: 'btn sm', text: 'File', href: p.url, download: '', target: '_blank' }));
        card.appendChild(row); grid.appendChild(card);
      });
    }
    search.addEventListener('input', function () { draw(search.value); }); draw('');

    const promptTitle = U.el('div', { class: 'section-head', style: 'margin:12px 0 4px;' }, [U.el('span', { text: 'AI Animation — Text to Motion' })]); sc.appendChild(promptTitle);
    const prompt = U.el('textarea', { class: 'input', rows: '3', placeholder: 'Ví dụ: a heroic warrior runs forward, swings a sword twice, then returns to idle' });
    const negative = U.el('input', { class: 'input', placeholder: 'Negative prompt: frozen, sliding feet, broken joints…', style: 'margin-top:6px;' });
    const opts = U.el('div', { style: 'display:flex;gap:6px;align-items:center;margin-top:6px;' });
    const duration = U.el('input', { type: 'number', class: 'input', min: '1', max: '30', value: '5', style: 'width:70px;' });
    opts.appendChild(U.el('span', { class: 'dim small', text: 'Duration' })); opts.appendChild(duration); opts.appendChild(U.el('span', { class: 'dim small', text: 'seconds' }));
    sc.appendChild(prompt); sc.appendChild(negative); sc.appendChild(opts);
    const buttons = U.el('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;' });
    buttons.appendChild(U.el('button', { class: 'btn success grow', text: 'Generate / Preview', onclick: function () { Studio.generatePrompt(prompt.value, negative.value, parseFloat(duration.value) || 5); } }));
    buttons.appendChild(U.el('button', { class: 'btn', text: 'Use Preset Clip', onclick: function () { Studio.generatePrompt('idle breathing', '', parseFloat(duration.value) || 5); } }));
    buttons.appendChild(U.el('button', { class: 'btn', text: 'Clear', onclick: function () { prompt.value = ''; negative.value = ''; } }));
    sc.appendChild(buttons);
    const status = U.el('div', { class: 'dim small', style: 'margin-top:7px;line-height:1.5;', text: 'Backend status: local prompt mapping. Tripo cloud task cần API key trong AI Tools và model/task hợp lệ.' }); sc.appendChild(status);
    section.appendChild(sc); body.insertBefore(section, body.firstChild);
  };
  window.PixiStudio.AnimateStudio = Studio;
})();
