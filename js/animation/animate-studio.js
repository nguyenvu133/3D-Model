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

  /* Prompt Pro (v20.1): parse thành timeline nhiều bước rồi phát lần lượt.
     Fallback: map 1 clip như cũ khi AnimPrompt chưa nạp. */
  Studio.generatePrompt = function (prompt, negative, duration, styleId) {
    const text = String(prompt || '').trim();
    if (!text) { bus.emit('notify', { type: 'warning', title: 'AI Animation', message: 'Nhập prompt chuyển động trước.' }); return; }
    if (PixiStudio.AnimPrompt) {
      const parsed = PixiStudio.AnimPrompt.parse(text, { negative: negative, duration: duration, style: styleId });
      Studio.last = { prompt: text, negative: negative || '', duration: duration || 0, style: parsed.style, steps: parsed.steps, unmatched: parsed.unmatched, warnings: parsed.warnings, totalDuration: parsed.totalDuration, mode: 'local-prompt-pro' };
      if (parsed.warnings.length) bus.emit('notify', { type: 'warning', title: 'AI Animation Prompt', message: parsed.warnings.join(' ') });
      if (parsed.steps.length) PixiStudio.AnimPrompt.play(parsed);
      return Studio.last;
    }
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

  /* Meshy Cloud Text to Motion: prompt → clip FBX cloud → retarget lên rig.
     Cần API key Meshy (msy_…) — không key thì adapter báo blocked, không giả lập. */
  Studio.generateMeshyCloud = function (prompt, duration, mode) {
    const M = PixiStudio.Meshy;
    const text = String(prompt || '').trim();
    if (!text) { bus.emit('notify', { type: 'warning', title: 'Meshy Text to Motion', message: 'Nhập prompt trước.' }); return Promise.resolve(null); }
    if (!M) { bus.emit('notify', { type: 'warning', title: 'Meshy', message: 'Meshy adapter chưa nạp.' }); return Promise.resolve(null); }
    bus.emit('notify', { type: 'info', title: 'Meshy Text to Motion', message: 'Đang gửi prompt lên Meshy (' + (mode || 'prime') + ', ' + (duration || 4) + 's)…' });
    return M.textToMotion({ prompt: text, mode: mode, duration: duration }).then(function (task) {
      if (!task) return null;
      if (task.state === 'success') {
        bus.emit('notify', { type: 'success', title: 'Meshy Text to Motion xong', message: 'Đang áp clip lên rig hiện tại…' });
        return M.applyTextToMotion(task).then(function () { return task; });
      }
      if (task.state === 'blocked') return task;
      bus.emit('notify', { type: 'error', title: 'Meshy Text to Motion lỗi', message: task.error || 'Task thất bại.' });
      return task;
    });
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

    const promptTitle = U.el('div', { class: 'section-head', style: 'margin:12px 0 4px;' }, [U.el('span', { text: 'AI Animation — Text to Motion (Prompt Pro)' })]); sc.appendChild(promptTitle);
    sc.appendChild(U.el('div', { class: 'dim small', style: 'line-height:1.5;margin-bottom:6px;', text: 'Prompt Pro local: 1 prompt → timeline nhiều bước nối tiếp (vd: chạy tới → chém kiếm ×2 → đứng nghỉ), style đổi tốc độ, negative loại bước. Clip cloud thật (Meshy) ở mục Meshy Cloud bên dưới.' }));
    const prompt = U.el('textarea', { class: 'input', rows: '3', placeholder: 'Ví dụ: a heroic warrior runs forward, swings a sword twice, then returns to idle' });
    const negative = U.el('input', { class: 'input', placeholder: 'Negative prompt: frozen, sliding feet, broken joints…', style: 'margin-top:6px;' });
    const opts = U.el('div', { style: 'display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap;' });
    const duration = U.el('input', { type: 'number', class: 'input', min: '0', max: '30', value: '0', style: 'width:60px;' });
    opts.appendChild(U.el('span', { class: 'dim small', text: 'Duration (0 = tự nhiên)' })); opts.appendChild(duration); opts.appendChild(U.el('span', { class: 'dim small', text: 's' }));
    opts.appendChild(U.el('span', { class: 'dim small', text: 'Style' }));
    const styleSel = U.el('select', { class: 'select', style: 'flex:1;min-width:100px;' });
    [['', 'Auto (đoán từ prompt)'], ['normal', 'Normal'], ['heroic', 'Heroic'], ['tired', 'Tired'], ['angry', 'Angry'], ['happy', 'Happy'], ['slow', 'Slow'], ['fast', 'Fast'], ['sneaky', 'Sneaky']].forEach(function (o) {
      styleSel.appendChild(U.el('option', { value: o[0], text: o[1] }));
    });
    opts.appendChild(styleSel);
    sc.appendChild(prompt); sc.appendChild(negative); sc.appendChild(opts);
    /* Timeline preview (parse trực tiếp khi gõ) */
    const timeline = U.el('div', { class: 'dim small', style: 'margin-top:6px;line-height:1.6;min-height:16px;' });
    sc.appendChild(timeline);
    function paintTimeline() {
      timeline.innerHTML = '';
      if (!PixiStudio.AnimPrompt || !prompt.value.trim()) { timeline.textContent = ''; return; }
      const parsed = PixiStudio.AnimPrompt.parse(prompt.value, { negative: negative.value, duration: parseFloat(duration.value) || 0, style: styleSel.value || undefined });
      if (!parsed.steps.length) { timeline.textContent = '⚠️ ' + (parsed.warnings[0] || 'Chưa map được hành động nào.'); return; }
      timeline.appendChild(U.el('b', { text: 'Timeline: ' }));
      parsed.steps.forEach(function (st, i) {
        if (i) timeline.appendChild(document.createTextNode(' → '));
        timeline.appendChild(U.el('span', { text: st.label + ' ' + st.duration + 's' + (st.repeats > 1 ? ' ×' + st.repeats : '') }));
      });
      timeline.appendChild(U.el('span', { text: ' · tổng ' + parsed.totalDuration + 's · ' + parsed.style.label }));
      if (parsed.unmatched.length) timeline.appendChild(U.el('div', { text: '⚠️ Chưa có clip: ' + parsed.unmatched.join(' · ') }));
    }
    prompt.addEventListener('input', paintTimeline);
    negative.addEventListener('input', paintTimeline);
    duration.addEventListener('input', paintTimeline);
    styleSel.addEventListener('change', paintTimeline);
    const buttons = U.el('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;' });
    buttons.appendChild(U.el('button', { class: 'btn success grow', text: '▶ Generate / Play Timeline', onclick: function () { Studio.generatePrompt(prompt.value, negative.value, parseFloat(duration.value) || 0, styleSel.value || undefined); paintTimeline(); } }));
    buttons.appendChild(U.el('button', { class: 'btn', text: '+ Add to Added', onclick: function () {
      if (!PixiStudio.AnimPrompt) return;
      const parsed = PixiStudio.AnimPrompt.parse(prompt.value, { negative: negative.value, duration: parseFloat(duration.value) || 0, style: styleSel.value || undefined });
      PixiStudio.AnimPrompt.enqueue(parsed);
    } }));
    buttons.appendChild(U.el('button', { class: 'btn', text: '💾 Save Preset', onclick: function () {
      if (!PixiStudio.AnimPrompt) return;
      const name = window.prompt('Tên preset prompt:', prompt.value.slice(0, 30));
      if (name && PixiStudio.AnimPrompt.savePreset(name, prompt.value, { negative: negative.value, duration: parseFloat(duration.value) || 0, style: styleSel.value || 'normal' })) {
        bus.emit('notify', { type: 'success', title: 'Prompt preset đã lưu', message: name });
        paintPresets();
      }
    } }));
    buttons.appendChild(U.el('button', { class: 'btn', text: 'Clear', onclick: function () { prompt.value = ''; negative.value = ''; paintTimeline(); } }));
    sc.appendChild(buttons);
    /* Ví dụ prompt (gồm ví dụ chính thức của Meshy) */
    const exRow = U.el('div', { style: 'display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;' });
    (PixiStudio.AnimPrompt ? PixiStudio.AnimPrompt.EXAMPLES : []).forEach(function (ex) {
      exRow.appendChild(U.el('button', {
        class: 'btn sm', text: '💡 ' + ex.text, title: ex.note,
        onclick: function () { prompt.value = ex.text; paintTimeline(); }
      }));
    });
    sc.appendChild(exRow);
    /* Preset đã lưu */
    const presetList = U.el('div', { style: 'margin-top:6px;display:flex;flex-direction:column;gap:3px;' });
    function paintPresets() {
      presetList.innerHTML = '';
      if (!PixiStudio.AnimPrompt) return;
      const all = PixiStudio.AnimPrompt.loadPresets();
      Object.keys(all).forEach(function (name) {
        const row = U.el('div', { style: 'display:flex;gap:6px;align-items:center;' });
        row.appendChild(U.el('span', { class: 'dim small', style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', text: '📝 ' + name }));
        row.appendChild(U.el('button', { class: 'btn sm', text: 'Load', onclick: function () {
          const p = all[name];
          prompt.value = p.prompt; negative.value = p.negative || '';
          duration.value = p.duration || 0; styleSel.value = p.style || '';
          paintTimeline();
        } }));
        row.appendChild(U.el('button', { class: 'btn sm', text: '✕', onclick: function () { PixiStudio.AnimPrompt.deletePreset(name); paintPresets(); } }));
        presetList.appendChild(row);
      });
    }
    sc.appendChild(presetList);
    paintPresets();

    /* ---- Meshy Cloud: Text to Motion thật qua API ---- */
    const cloudTitle = U.el('div', { class: 'section-head', style: 'margin:12px 0 4px;' }, [U.el('span', { text: '☁️ Meshy Cloud — Text to Motion (API)' })]); sc.appendChild(cloudTitle);
    sc.appendChild(U.el('div', { class: 'dim small', style: 'line-height:1.5;margin-bottom:6px;', text: 'Sinh clip motion thật trên cloud Meshy: prompt ≤400 ký tự, 2–10s. Prime 10 credits (FBX), Swift 3 credits (BVH). File kết quả hết hạn sau ~3 ngày. Cần API key msy_… (gói Meshy trả phí mới gọi được API).' }));
    const keyRow = U.el('div', { style: 'display:flex;gap:6px;margin-bottom:6px;' });
    const keyIn = U.el('input', { type: 'password', class: 'input', placeholder: 'Meshy API key (msy_…)', style: 'flex:1;', value: (PixiStudio.Meshy && PixiStudio.Meshy.config.apiKey) || '' });
    keyRow.appendChild(keyIn);
    keyRow.appendChild(U.el('button', { class: 'btn sm', text: 'Connect', onclick: function () {
      if (PixiStudio.Meshy) { PixiStudio.Meshy.connect('', keyIn.value); paintCloudStatus(); }
    } }));
    keyRow.appendChild(U.el('button', { class: 'btn sm', text: 'Balance', onclick: function () {
      if (!PixiStudio.Meshy) return;
      PixiStudio.Meshy.getBalance().then(function (b) {
        if (b) cloudStatus.textContent = 'Balance: ' + JSON.stringify(b).slice(0, 200);
      });
    } }));
    sc.appendChild(keyRow);
    const cloudRow = U.el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;' });
    const modeSel = U.el('select', { class: 'select', style: 'width:110px;' });
    [['prime', 'Prime · 10cr'], ['swift', 'Swift · 3cr']].forEach(function (o) { modeSel.appendChild(U.el('option', { value: o[0], text: o[1] })); });
    cloudRow.appendChild(modeSel);
    cloudRow.appendChild(U.el('button', {
      class: 'btn primary grow', text: '☁️ Generate (Meshy Cloud)',
      onclick: function () {
        Studio.generateMeshyCloud(prompt.value, parseFloat(duration.value) || 4, modeSel.value).then(function () { paintCloudStatus(); });
      }
    }));
    sc.appendChild(cloudRow);
    const cloudStatus = U.el('div', { class: 'dim small', style: 'margin-top:6px;line-height:1.5;' });
    function paintCloudStatus() {
      const M = PixiStudio.Meshy;
      if (!M) { cloudStatus.textContent = 'Meshy adapter chưa nạp.'; return; }
      const st = M.status();
      cloudStatus.textContent = st.connected ? 'Meshy: đã kết nối · ' + st.endpoint + ' · tasks: ' + M.tasks.length : 'Meshy: chưa kết nối — nhập API key để dùng cloud.';
    }
    sc.appendChild(cloudStatus);
    paintCloudStatus();
    const status = U.el('div', { class: 'dim small', style: 'margin-top:7px;line-height:1.5;', text: 'Backend status: local Prompt Pro (không cần key) + Meshy Cloud (cần key msy_…). Tripo cloud task cần API key trong AI Tools.' }); sc.appendChild(status);
    section.appendChild(sc); body.insertBefore(section, body.firstChild);
  };
  window.PixiStudio.AnimateStudio = Studio;
})();
