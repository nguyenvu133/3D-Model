/* ============================================================
 * ai/ai-panel.js — UI AI Tools: Text/Image-to-3D, checklist card,
 * local model manager, VRAM/RAM monitor, prompt history, queue.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const AIPanel = {
    referenceImages: [],
    activeTab: 'text'
  };

  /* ---------- Tripo floating card checklist ---------- */
  /* ============================================================
     🚀 AI 3D GENERATION STUDIO (v20.0)
     Bổ sung các tham số generate còn thiếu + batch + history + import lại
     ============================================================ */
  AIPanel._genState = AIPanel._genState || {
    prompt: '', negative: '', style: 'person', quality: 'standard',
    polygon: 30000, tex: '2k', seed: '', batch: 1, imageView: 'single',
    model: 'v3.1-20260211',   /* Tripo v3 — H3.1 mặc định */
    localComplexity: 2, localColor: ''   /* Local Auto Gen */
  };

  /* ---------- Gen mode: 'cloud' (Tripo, cần API key) / 'local' (procedural, không cần key) ---------- */
  AIPanel.GEN_MODE_KEY = 'pixiStudio.aiGenMode';
  AIPanel.getGenMode = function () {
    try {
      const m = localStorage.getItem(AIPanel.GEN_MODE_KEY);
      return m === 'local' ? 'local' : 'cloud';
    } catch (e) { return 'cloud'; }
  };
  AIPanel.setGenMode = function (mode) {
    mode = mode === 'local' ? 'local' : 'cloud';
    try { localStorage.setItem(AIPanel.GEN_MODE_KEY, mode); } catch (e) { }
    AIPanel.renderChecklist();
    return mode;
  };
  /* Local Auto Gen module — do agent khác xây, có thể chưa load: guard mọi chỗ gọi */
  AIPanel._localGen = function () {
    return (PixiStudio.AI || {}).LocalAutoGen || null;
  };
  /* chạy Local Auto Gen (prompt trống → ngẫu nhiên); trả null nếu module chưa load */
  AIPanel.runLocalGenerate = function (opts) {
    const LAG = AIPanel._localGen();
    if (!LAG || typeof LAG.generate !== 'function') {
      bus.emit('notify', { type: 'warning', title: 'Local Auto Gen chưa sẵn sàng', message: 'Module Local Auto Gen chưa load — hard-refresh lại trang.' });
      return null;
    }
    const prompt = (opts.prompt || '').trim();
    if (!prompt) {
      bus.emit('notify', { type: 'info', title: 'Prompt trống — tạo model ngẫu nhiên', message: 'Local Auto Gen sẽ chọn ngẫu nhiên 1 trong 12 loại model.' });
    }
    const seed = (opts.seed !== undefined && opts.seed !== null && opts.seed !== '') ? parseInt(opts.seed, 10) : undefined;
    const batch = opts.batch || 1;
    let result = null;
    try {
      const args = {
        prompt: prompt,
        seed: seed,
        batch: batch,
        complexity: opts.complexity || 2,
        color: opts.color || undefined
      };
      /* batch > 1: generate() của core bỏ qua batch → dùng generateBatch khi có */
      result = (batch > 1 && typeof LAG.generateBatch === 'function')
        ? LAG.generateBatch(args, batch)
        : LAG.generate(args);
    } catch (e) {
      bus.emit('notify', { type: 'error', title: 'Local Auto Gen lỗi', message: (e && e.message) || String(e) });
      return null;
    }
    const done = function (r) {
      if (!r) return;
      if (Array.isArray(r)) {
        const first = r[0] || {};
        bus.emit('notify', {
          type: 'success', title: '💻 Local Auto Gen xong',
          message: 'Đã tạo ' + r.length + ' model · ' + (first.type || '') + ' · seed ' + (first.seed !== undefined && first.seed !== null ? first.seed : '?'),
          duration: 6000
        });
        return;
      }
      bus.emit('notify', {
        type: 'success', title: '💻 Local Auto Gen xong',
        message: (r.name || 'Model') + ' · ' + (r.type || '') + ' · seed ' + (r.seed !== undefined && r.seed !== null ? r.seed : '?') + (r.triCount ? ' · ' + r.triCount + ' tris' : ''),
        duration: 6000
      });
    };
    if (result && typeof result.then === 'function') result.then(done, function (e) { bus.emit('notify', { type: 'error', title: 'Local Auto Gen lỗi', message: (e && e.message) || String(e) }); });
    else done(result);
    return result;
  };
  /* hàng radio chọn chế độ gen — dùng chung cho Generation Studio + 2 modal */
  AIPanel._genModeRadios = function (onChange) {
    const seq = (AIPanel._genModeRadioSeq = (AIPanel._genModeRadioSeq || 0) + 1);
    const name = 'ai-gen-mode-' + seq;
    const mode = AIPanel.getGenMode();
    const row = U.el('div', { style: 'display:flex;gap:12px;margin-bottom:8px;flex-wrap:wrap;' });
    [['cloud', '☁️ Tripo Cloud (cần API key)'], ['local', '💻 Local Auto Gen (không cần key, tạo procedural trên máy)']].forEach(function (o) {
      const lab = U.el('label', { style: 'display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;' });
      const radio = U.el('input', { type: 'radio', name: name, value: o[0] });
      if (o[0] === mode) radio.checked = true;
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        AIPanel.setGenMode(o[0]);
        if (typeof onChange === 'function') onChange(o[0]);
      });
      lab.appendChild(radio);
      lab.appendChild(U.el('span', { text: o[1] }));
      row.appendChild(lab);
    });
    return row;
  };

  AIPanel._renderGenerationStudio = function (body, tripo) {
    const S = AIPanel._genState;
    const section = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('wand') }),
        U.el('span', { text: '🚀 AI 3D Generation Studio' }),
        tripo.config.connected
          ? U.el('span', { class: 'state-badge ok', text: 'connected' })
          : U.el('span', { class: 'state-badge off', text: 'chưa kết nối' })
      ])
    ]);
    const sc = U.el('div', { class: 'section-content' });

    /* chế độ gen: Cloud (Tripo) / Local Auto Gen — đổi mode re-render lại Studio */
    sc.appendChild(AIPanel._genModeRadios(function () { AIPanel.renderPage(); }));
    const isLocal = AIPanel.getGenMode() === 'local';

    /* prompt + negative */
    const prompt = U.el('textarea', { class: 'input', rows: '3', placeholder: 'Prompt: chibi wuxia warrior, teal robe, game-ready, A-pose…', style: 'margin-bottom:6px;' });
    prompt.value = S.prompt;
    prompt.addEventListener('input', function () { S.prompt = prompt.value; });
    sc.appendChild(prompt);

    /* tùy chọn Local Auto Gen — chỉ hiện ở mode local */
    if (isLocal) {
      const localRow = U.el('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap;' });
      localRow.appendChild(U.el('span', { class: 's-label', text: 'Độ chi tiết' }));
      const cxSlider = U.el('input', { type: 'range', class: 'slider', min: '1', max: '3', step: '1', value: String(S.localComplexity || 2), style: 'flex:1;min-width:80px;' });
      const cxVal = U.el('span', { class: 's-val', text: String(S.localComplexity || 2) });
      cxSlider.addEventListener('input', function () { S.localComplexity = parseInt(cxSlider.value, 10); cxVal.textContent = cxSlider.value; });
      localRow.appendChild(cxSlider); localRow.appendChild(cxVal);
      localRow.appendChild(U.el('span', { class: 's-label', text: 'Màu chủ đạo' }));
      const colorIn = U.el('input', { type: 'color', value: S.localColor || '#7fb069', style: 'width:34px;height:26px;padding:0;border:1px solid var(--border);border-radius:6px;background:transparent;cursor:pointer;' });
      colorIn.addEventListener('input', function () { S.localColor = colorIn.value; });
      localRow.appendChild(colorIn);
      localRow.appendChild(U.el('button', {
        class: 'btn sm', text: '🎲 Ngẫu nhiên',
        'data-tooltip': 'Xoá prompt, seed ngẫu nhiên rồi tạo model local ngay',
        onclick: function () {
          S.prompt = ''; prompt.value = '';
          S.seed = String(Math.floor(Math.random() * 1e6)); seedIn.value = S.seed;
          AIPanel.runLocalGenerate({ prompt: '', seed: S.seed, batch: S.batch, complexity: S.localComplexity, color: S.localColor || undefined });
          AIPanel.renderPage();
        }
      }));
      localRow.appendChild(U.el('button', {
        class: 'btn sm', text: '↻ Tạo lại',
        'data-tooltip': 'Giữ nguyên prompt, đổi seed mới rồi tạo lại model local',
        onclick: function () {
          S.seed = String(Math.floor(Math.random() * 1e6)); seedIn.value = S.seed;
          AIPanel.runLocalGenerate({ prompt: S.prompt, seed: S.seed, batch: S.batch, complexity: S.localComplexity, color: S.localColor || undefined });
          AIPanel.renderPage();
        }
      }));
      sc.appendChild(localRow);
    }

    const neg = U.el('input', { class: 'input', placeholder: 'Negative prompt: blurry, extra limbs, watermark…', style: 'margin-bottom:6px;' });
    neg.value = S.negative;
    neg.addEventListener('input', function () { S.negative = neg.value; });
    sc.appendChild(neg);

    /* style / quality */
    const row1 = U.el('div', { style: 'display:flex;gap:6px;margin-bottom:6px;' });
    const styleSel = U.el('select', { class: 'select', style: 'flex:1;height:28px;font-size:11px;' });
    [['person', 'person'], ['creature', 'creature'], ['object', 'object'], ['vehicle', 'vehicle'], ['environment', 'environment']].forEach(function (o) {
      const opt = U.el('option', { value: o[0], text: 'style: ' + o[1] });
      if (o[0] === S.style) opt.selected = true;
      styleSel.appendChild(opt);
    });
    styleSel.addEventListener('change', function () { S.style = styleSel.value; });
    const qSel = U.el('select', { class: 'select', style: 'width:112px;height:28px;font-size:11px;' });
    [['standard', 'standard'], ['detailed', 'detailed']].forEach(function (o) {
      const opt = U.el('option', { value: o[0], text: o[1] });
      if (o[0] === S.quality) opt.selected = true;
      qSel.appendChild(opt);
    });
    qSel.addEventListener('change', function () { S.quality = qSel.value; });
    row1.appendChild(styleSel); row1.appendChild(qSel);
    sc.appendChild(row1);

    /* Tripo v3 model — H3.1 chi tiết / P2 game-ready */
    const row1b = U.el('div', { style: 'display:flex;gap:6px;margin-bottom:6px;' });
    const modelSel = U.el('select', { class: 'select', style: 'flex:1;height:28px;font-size:11px;' });
    Object.keys(tripo.MODELS || {}).forEach(function (m) {
      const opt = U.el('option', { value: m, text: 'model: ' + m + ' — ' + tripo.MODELS[m].label });
      if (m === S.model) opt.selected = true;
      modelSel.appendChild(opt);
    });
    modelSel.addEventListener('change', function () { S.model = modelSel.value; });
    row1b.appendChild(modelSel);
    sc.appendChild(row1b);

    /* polygon / texture / seed */
    const row2 = U.el('div', { style: 'display:flex;gap:6px;margin-bottom:6px;' });
    const polySel = U.el('select', { class: 'select', style: 'flex:1;height:28px;font-size:11px;' });
    [8000, 15000, 30000, 50000].forEach(function (n) {
      const opt = U.el('option', { value: String(n), text: (n / 1000) + 'k poly' });
      if (n === S.polygon) opt.selected = true;
      polySel.appendChild(opt);
    });
    polySel.addEventListener('change', function () { S.polygon = parseInt(polySel.value, 10); });
    const texSel = U.el('select', { class: 'select', style: 'width:98px;height:28px;font-size:11px;' });
    ['1k', '2k', '4k'].forEach(function (t) {
      const opt = U.el('option', { value: t, text: t + ' texture' });
      if (t === S.tex) opt.selected = true;
      texSel.appendChild(opt);
    });
    texSel.addEventListener('change', function () { S.tex = texSel.value; });
    row2.appendChild(polySel); row2.appendChild(texSel);
    sc.appendChild(row2);

    const row3 = U.el('div', { style: 'display:flex;gap:6px;margin-bottom:8px;' });
    const seedIn = U.el('input', { class: 'input', placeholder: 'seed (auto)', style: 'flex:1;' });
    seedIn.value = S.seed;
    seedIn.addEventListener('input', function () { S.seed = seedIn.value; });
    const batchSel = U.el('select', { class: 'select', style: 'width:92px;height:28px;font-size:11px;' });
    /* Local: batch 1/3/5 · Cloud: batch 1/2/4 */
    (isLocal ? [1, 3, 5] : [1, 2, 4]).forEach(function (n) {
      const opt = U.el('option', { value: String(n), text: 'batch ' + n });
      if (n === S.batch) opt.selected = true;
      batchSel.appendChild(opt);
    });
    if ((isLocal ? [1, 3, 5] : [1, 2, 4]).indexOf(S.batch) === -1) { S.batch = 1; batchSel.value = '1'; }
    batchSel.addEventListener('change', function () { S.batch = parseInt(batchSel.value, 10); });
    row3.appendChild(seedIn); row3.appendChild(batchSel);
    sc.appendChild(row3);

    /* generate buttons */
    const genBtn = U.el('button', {
      class: 'btn primary lg block',
      style: 'margin-bottom:6px;',
      html: U.icon('wand') + '&nbsp; ✨ Generate 3D' + (S.batch > 1 ? ' ×' + S.batch : ''),
      onclick: function () {
        const text = prompt.value.trim();
        /* ---- Local Auto Gen: không cần key, không chặn, prompt trống → ngẫu nhiên ---- */
        if (AIPanel.getGenMode() === 'local') {
          AIPanel.runLocalGenerate({ prompt: text, seed: S.seed, batch: S.batch, complexity: S.localComplexity, color: S.localColor || undefined });
          AIPanel.renderPage();
          return;
        }
        /* ---- Cloud (Tripo): flow cũ giữ nguyên ---- */
        if (!text) { bus.emit('notify', { type: 'warning', title: 'AI 3D', message: 'Nhập prompt trước.' }); return; }
        if (!tripo.config.connected) {
          bus.emit('notify', {
            type: 'warning', title: 'Chưa kết nối Tripo',
            message: 'Bấm “Kết nối Tripo AI” trong AI Tools và nhập API key để generate thật. Không giả lập kết quả.',
            duration: 8000
          });
          return;
        }
        const baseSeed = S.seed ? parseInt(S.seed, 10) : Math.floor(Math.random() * 1e6);
        for (let i = 0; i < S.batch; i++) {
          tripo.textTo3D({
            prompt: text,
            negative_prompt: neg.value,
            model: S.model,
            quality: S.quality,
            style: S.style,
            polygon: S.polygon,
            texture_resolution: S.tex,
            seed: baseSeed + i * 7,
            format: 'glb'
          });
        }
        bus.emit('notify', { type: 'info', title: 'Đã gửi ' + S.batch + ' task', message: 'Seed ' + baseSeed + (S.batch > 1 ? ' … ' + (baseSeed + (S.batch - 1) * 7) : '') + ' · theo dõi ở Generation Queue.' });
        AIPanel.renderPage();
      }
    });
    sc.appendChild(genBtn);

    /* image → 3D */
    const imgRow = U.el('div', { style: 'display:flex;gap:6px;margin-bottom:8px;' });
    imgRow.appendChild(U.el('button', {
      class: 'btn sm grow',
      html: U.icon('image') + ' Image → 3D',
      onclick: function () {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.addEventListener('change', function () {
          const file = inp.files[0];
          if (!file) return;
          const fd = new FormData();
          fd.append('file', file);
          tripo.imageTo3D({ formData: fd, file: file, fileName: file.name });
          AIPanel.renderPage();
        });
        inp.click();
      }
    }));
    imgRow.appendChild(U.el('button', {
      class: 'btn sm grow',
      html: '🖼️ Multi-view → 3D',
      'data-tooltip': '2–4 ảnh (ảnh đầu = mặt trước) → model chính xác hơn — Tripo v3 multiview-to-model',
      onclick: function () {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
        inp.addEventListener('change', function () {
          const files = Array.prototype.slice.call(inp.files || []);
          if (files.length < 2) {
            bus.emit('notify', { type: 'warning', title: 'Multi-view cần 2–4 ảnh', message: 'Chọn ít nhất 2 ảnh — ảnh đầu tiên phải là mặt trước (front).' });
            return;
          }
          tripo.multiviewTo3D({ files: files.slice(0, 4) });
          AIPanel.renderPage();
        });
        inp.click();
      }
    }));
    imgRow.appendChild(U.el('button', {
      class: 'btn sm grow',
      html: '📦 Template',
      'data-tooltip': 'Mẫu prompt generate theo loại asset',
      onclick: function () {
        const presets = [
          'chibi wuxia warrior, teal robe, sword on back, game-ready, A-pose, clean topology',
          'cute slime monster, glowing red eyes, symmetric, game sprite, flat background',
          'low poly treasure chest, wooden, iron bands, game prop, centered',
          'sci-fi hover bike, orange accents, hard surface, game ready',
          'modular dungeon corridor, stone bricks, torch lighting, game environment'
        ];
        prompt.value = presets[Math.floor(Math.random() * presets.length)];
        S.prompt = prompt.value;
        bus.emit('notify', { type: 'info', title: 'Template', message: 'Đã điền prompt mẫu — sửa lại rồi Generate.' });
      }
    }));
    sc.appendChild(imgRow);

    /* kết quả gần đây + tải về */
    const recent = tripo.queue.filter(function (t) { return t.resultUrl && t.state === 'success'; }).slice(0, 4);
    if (recent.length) {
      sc.appendChild(U.el('div', { class: 'label-xs', style: 'margin:4px 0 4px;', text: 'Kết quả đã sinh' }));
      recent.forEach(function (t) {
        const row = U.el('div', { class: 'info-row', style: 'gap:6px;' }, [
          U.el('span', { class: 'i-label', text: (t.type || '') + ' · ' + (t.taskId || '').slice(0, 8) })
        ]);
        row.appendChild(U.el('button', {
          class: 'btn sm', text: '↓', 'data-tooltip': 'Tải model về máy',
          onclick: function () {
            fetch(t.resultUrl).then(function (r) { return r.blob(); }).then(function (b) {
              U.downloadBlob(b, 'tripo-' + (t.taskId || 'model').slice(0, 8) + '.glb');
              bus.emit('notify', { type: 'success', title: 'Đã tải', message: 'tripo-' + (t.taskId || '').slice(0, 8) + '.glb' });
            }).catch(function (e) { bus.emit('notify', { type: 'error', title: 'Tải lỗi', message: e.message }); });
          }
        }));
        row.appendChild(U.el('button', {
          class: 'btn sm', text: '↺', 'data-tooltip': 'Nạp lại vào viewport',
          onclick: function () {
            fetch(t.resultUrl).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
              return PixiStudio.Models.loadGLBFromBuffer(buf, 'AI_' + (t.taskId || '').slice(0, 6), buf.byteLength);
            }).then(function () { bus.emit('notify', { type: 'success', title: 'Đã nạp model AI', message: 'Model trong viewport.' }); })
              .catch(function (e) { bus.emit('notify', { type: 'error', title: 'Nạp lỗi', message: e.message }); });
          }
        }));
        sc.appendChild(row);
      });
    }

    sc.appendChild(U.el('div', { class: 'dim small', style: 'margin-top:6px;line-height:1.5;', text: isLocal
      ? '💻 Local Auto Gen = tạo procedural trên máy, KHÔNG phải AI thật — model đơn giản/low-poly, dùng khi chưa có API key. Batch ' + S.batch + ' model/lần, độ chi tiết ' + (S.localComplexity || 2) + '/3.'
      : (tripo.config.connected
        ? 'Generate thật qua Tripo OpenAPI v3: ' + tripo.config.endpoint + ' · batch ' + S.batch + ' task/lần, seed tăng dần. Link model hết hạn sau 5 phút — tải ngay khi xong.'
        : 'Chưa có API key ⇒ mọi nút generate ở trạng thái blocked (không giả lập). Kết nối ở khối “Tripo3D AI” phía trên — hoặc chuyển sang 💻 Local Auto Gen để tạo model ngay không cần key.') }));

    section.appendChild(sc);
    body.appendChild(section);
  };

  /* ---------- Local Upscale / Texturing — chạy trên model đang chọn trong viewport ---------- */
  /* model đích của tool local: selection trong viewport (model local không có modelId Tripo) */
  AIPanel._selectedModel = function () {
    try {
      const sel = PixiStudio.State && PixiStudio.State.get && PixiStudio.State.get('selection');
      if (sel) return sel;
    } catch (e) { }
    return null;
  };
  /* chạy hàm nặng sau 30ms để UI kịp vẽ trạng thái busy; fn trả sync hoặc Promise */
  AIPanel._localToolRun = function (btn, busyText, fn, onDone) {
    btn.disabled = true;
    const oldHtml = btn.innerHTML;
    btn.textContent = busyText;
    setTimeout(function () {
      const restore = function () { btn.disabled = false; btn.innerHTML = oldHtml; };
      let r;
      try { r = fn(); } catch (e) {
        restore();
        bus.emit('notify', { type: 'error', title: 'Local tool lỗi', message: (e && e.message) || String(e) });
        return;
      }
      const finish = function (res) { restore(); if (typeof onDone === 'function') onDone(res); };
      if (r && typeof r.then === 'function') {
        r.then(finish, function (e) { restore(); bus.emit('notify', { type: 'error', title: 'Local tool lỗi', message: (e && e.message) || String(e) }); });
      } else finish(r);
    }, 30);
  };
  /* 10 chất liệu local — chuẩn hoá MATERIALS (mảng string hoặc {id,label}) */
  AIPanel._localMaterials = function () {
    const LAG = AIPanel._localGen();
    const raw = (LAG && LAG.MATERIALS) || ['wood', 'metal', 'stone', 'fabric', 'leather', 'dirt', 'grass', 'ceramic', 'gold', 'skin'];
    return raw.map(function (m) {
      if (m && typeof m === 'object') return { id: m.id || m.name || m.value, label: m.label || m.name || m.id || String(m) };
      return { id: String(m), label: String(m) };
    });
  };

  /* modal Texturing local: chất liệu + size + màu + nhám + lặp */
  AIPanel.openLocalTextureModal = function () {
    const LAG = AIPanel._localGen();
    if (!LAG || typeof LAG.textureModel !== 'function') {
      bus.emit('notify', { type: 'warning', title: 'Local Auto Gen chưa sẵn sàng', message: 'Module Local Auto Gen chưa load — hard-refresh lại trang.' });
      return;
    }
    const target = AIPanel._selectedModel();
    if (!target) {
      bus.emit('notify', { type: 'warning', title: 'Chưa chọn model', message: 'Chọn 1 model trong viewport trước.' });
      return;
    }
    const wrap = U.el('div');
    wrap.appendChild(U.el('div', { class: 'state-badge ok', style: 'margin-bottom:10px;', text: '💻 Texturing local — model: ' + (target.name || 'Object') }));
    wrap.appendChild(U.el('label', { class: 'label-xs', text: 'Chất liệu' }));
    const matSel = U.el('select', { class: 'input', style: 'margin:5px 0;' });
    AIPanel._localMaterials().forEach(function (m) {
      matSel.appendChild(U.el('option', { value: m.id, text: m.label }));
    });
    wrap.appendChild(matSel);
    const row1 = U.el('div', { style: 'display:flex;gap:6px;margin-bottom:6px;' });
    row1.appendChild(U.el('span', { class: 's-label', text: 'Kích thước' }));
    const sizeSel = U.el('select', { class: 'select', style: 'flex:1;height:28px;font-size:11px;' });
    [256, 512, 1024].forEach(function (n) {
      const opt = U.el('option', { value: String(n), text: n + '×' + n });
      if (n === 512) opt.selected = true;
      sizeSel.appendChild(opt);
    });
    row1.appendChild(sizeSel);
    row1.appendChild(U.el('span', { class: 's-label', text: 'Màu chủ đạo' }));
    const colorIn = U.el('input', { type: 'color', value: AIPanel._genState.localColor || '#7fb069', style: 'width:34px;height:26px;padding:0;border:1px solid var(--border);border-radius:6px;background:transparent;cursor:pointer;' });
    row1.appendChild(colorIn);
    wrap.appendChild(row1);
    const row2 = U.el('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:6px;' });
    row2.appendChild(U.el('span', { class: 's-label', text: 'Độ nhám' }));
    const roughSlider = U.el('input', { type: 'range', class: 'slider', min: '0', max: '1', step: '0.05', value: '0.7', style: 'flex:1;' });
    const roughVal = U.el('span', { class: 's-val', text: '0.70' });
    roughSlider.addEventListener('input', function () { roughVal.textContent = parseFloat(roughSlider.value).toFixed(2); });
    row2.appendChild(roughSlider); row2.appendChild(roughVal);
    row2.appendChild(U.el('span', { class: 's-label', text: 'Độ lặp' }));
    const repeatIn = U.el('input', { class: 'input', type: 'number', min: '1', max: '8', step: '1', value: '1', style: 'width:56px;' });
    row2.appendChild(repeatIn);
    wrap.appendChild(row2);
    wrap.appendChild(U.el('div', { class: 'dim small', style: 'margin:4px 0 10px;line-height:1.5;', text: 'Texturing local = họa tiết lặp (procedural), không vẽ theo hình dạng model — không tạo chi tiết mới như AI cloud.' }));
    const applyBtn = U.el('button', { class: 'btn primary lg block', text: '🎨 Áp texture' });
    applyBtn.addEventListener('click', function () {
      const t = AIPanel._selectedModel();
      if (!t) { bus.emit('notify', { type: 'warning', title: 'Chưa chọn model', message: 'Chọn 1 model trong viewport trước.' }); return; }
      AIPanel._localToolRun(applyBtn, '⏳ Đang tạo texture…', function () {
        return LAG.textureModel(t, {
          material: matSel.value,
          color: colorIn.value,
          roughness: parseFloat(roughSlider.value),
          repeat: parseInt(repeatIn.value, 10) || 1,
          size: parseInt(sizeSel.value, 10),
          scope: 'all'
        });
      }, function (r) {
        PixiStudio.Modals.close();
        if (r && r.ok !== false) {
          bus.emit('notify', {
            type: 'success', title: '💻 Texturing local xong',
            message: (r.material || matSel.value) + ' · ' + (r.size || sizeSel.value) + 'px' + (r.maps ? ' · ' + r.maps + ' maps' : '') + (r.message ? ' — ' + r.message : ''),
            duration: 6000
          });
          bus.emit('scene:changed', { action: 'local-texture', name: t.name || 'Object' });
        } else {
          bus.emit('notify', { type: 'error', title: 'Texturing local thất bại', message: (r && r.message) || 'Không rõ nguyên nhân.' });
        }
        AIPanel.renderPage();
      });
    });
    wrap.appendChild(applyBtn);
    PixiStudio.Modals.open({ title: '🎨 Texturing Local', body: wrap, buttons: [{ label: 'Huỷ', class: 'btn' }] });
  };

  /* modal Upscale local: mức 2x/4x + phạm vi mesh/texture/cả hai */
  AIPanel.openLocalUpscaleModal = function () {
    const LAG = AIPanel._localGen();
    if (!LAG || typeof LAG.upscaleModel !== 'function') {
      bus.emit('notify', { type: 'warning', title: 'Local Auto Gen chưa sẵn sàng', message: 'Module Local Auto Gen chưa load — hard-refresh lại trang.' });
      return;
    }
    const target = AIPanel._selectedModel();
    if (!target) {
      bus.emit('notify', { type: 'warning', title: 'Chưa chọn model', message: 'Chọn 1 model trong viewport trước.' });
      return;
    }
    const wrap = U.el('div');
    wrap.appendChild(U.el('div', { class: 'state-badge ok', style: 'margin-bottom:10px;', text: '💻 Upscale local — model: ' + (target.name || 'Object') }));
    wrap.appendChild(U.el('label', { class: 'label-xs', text: 'Mức upscale' }));
    const levelSel = U.el('select', { class: 'input', style: 'margin:5px 0;' });
    [[2, '2x'], [4, '4x']].forEach(function (o) {
      const opt = U.el('option', { value: String(o[0]), text: o[1] });
      if (o[0] === 2) opt.selected = true;
      levelSel.appendChild(opt);
    });
    wrap.appendChild(levelSel);
    wrap.appendChild(U.el('label', { class: 'label-xs', text: 'Phạm vi' }));
    const scopeSel = U.el('select', { class: 'input', style: 'margin:5px 0;' });
    [['both', 'Cả mesh + texture'], ['mesh', 'Chỉ mesh (tăng tris)'], ['texture', 'Chỉ texture (tăng độ phân giải)']].forEach(function (o) {
      const opt = U.el('option', { value: o[0], text: o[1] });
      if (o[0] === 'both') opt.selected = true;
      scopeSel.appendChild(opt);
    });
    wrap.appendChild(scopeSel);
    wrap.appendChild(U.el('div', { class: 'dim small', style: 'margin:4px 0 10px;line-height:1.5;', text: 'Upscale local = nội suy/làm mịn, không tạo chi tiết mới — mesh mịn hơn và texture nét hơn, nhưng không thêm chi tiết như AI cloud.' }));
    const upBtn = U.el('button', { class: 'btn primary lg block', text: '⬆ Upscale' });
    upBtn.addEventListener('click', function () {
      const t = AIPanel._selectedModel();
      if (!t) { bus.emit('notify', { type: 'warning', title: 'Chưa chọn model', message: 'Chọn 1 model trong viewport trước.' }); return; }
      AIPanel._localToolRun(upBtn, '⏳ Đang upscale…', function () {
        return LAG.upscaleModel(t, { level: parseInt(levelSel.value, 10), scope: scopeSel.value });
      }, function (r) {
        PixiStudio.Modals.close();
        if (r && r.ok !== false) {
          const fmt = function (n) { return (n === undefined || n === null) ? '?' : Number(n).toLocaleString('en-US'); };
          const b = r.before || {}, a = r.after || {};
          bus.emit('notify', {
            type: 'success', title: '💻 Upscale local xong',
            message: 'Tris: ' + fmt(b.tris) + ' → ' + fmt(a.tris) + ' · Texture: ' + fmt(b.textureSize) + ' → ' + fmt(a.textureSize) + (r.message ? ' — ' + r.message : ''),
            duration: 8000
          });
          bus.emit('scene:changed', { action: 'local-upscale', name: t.name || 'Object' });
        } else {
          bus.emit('notify', { type: 'error', title: 'Upscale local thất bại', message: (r && r.message) || 'Không rõ nguyên nhân.' });
        }
        AIPanel.renderPage();
      });
    });
    wrap.appendChild(upBtn);
    PixiStudio.Modals.open({ title: '⬆ Upscale Local', body: wrap, buttons: [{ label: 'Huỷ', class: 'btn' }] });
  };

  AIPanel.renderChecklist = function () {
    const list = U.$('#tripo-checklist');
    if (!list) return;
    const connected = PixiStudio.AI.Tripo.config.connected;
    const local = AIPanel.getGenMode() === 'local';
    const items = [
      ['Image to 3D', true],
      ['Text to 3D', true],
      ['3D Model Upscale', connected || local],
      ['Texturing', connected || local],
      ['Auto Rig & Animate', connected],
      ['Local Auto Gen', true]
    ];
    list.innerHTML = '';
    items.forEach(function (it) {
      list.appendChild(U.el('div', { class: 'tripo-item' + (it[1] ? '' : ' pending') }, [
        U.el('span', { class: 'check', html: U.icon(it[1] ? 'check' : 'warning', 'ic-sm') }),
        U.el('span', { text: it[0] })
      ]));
    });
    list.appendChild(U.el('div', { class: 'dim small', style: 'margin-top:4px;line-height:1.5;', text: '💻 Local Auto Gen = tạo procedural trên máy, KHÔNG phải AI thật — model đơn giản/low-poly, dùng khi chưa có API key. 💻 Ở chế độ Local: Upscale + Texturing chạy ngay trên máy (nội suy/làm mịn + texture procedural) — không tạo chi tiết mới như AI cloud.' }));
  };

  /* ---------- Page AI (page-ai) ---------- */
  AIPanel.renderPage = function () {
    const body = U.$('#ai-page-body');
    if (!body) return;
    body.innerHTML = '';
    const tripo = PixiStudio.AI.Tripo;
    const status = tripo.status();

    /* Status card — TRUNG THỰC */
    const statusCard = U.el('div', { class: 'ai-status-card' }, [
      U.el('b', { text: status.providerLabel + ' — ' + (status.connected ? 'Connected (' + status.mode + ')' : 'Not connected') }),
      U.el('p', { text: status.connected
        ? 'Backend: ' + status.endpoint + (status.models.length ? ' · ' + status.models.length + ' model' : '')
        : 'Chưa cấu hình backend. Nhập endpoint + API key để kích hoạt Text/Image-to-3D THẬT. Prototype không giả lập kết quả AI.'
      })
    ]);
    if (status.connected && PixiStudio.AI.Tripo.isXingchi()) {
      statusCard.appendChild(U.el('button', {
        class: 'btn sm', style: 'margin-top:6px;', text: '↻ Tải danh sách model',
        onclick: function () { PixiStudio.AI.Tripo.listModels().then(function () { AIPanel.renderPage(); }); }
      }));
    }
    body.appendChild(statusCard);

    /* Tabs Text / Image */
    const tabs = U.el('div', { class: 'tab-row', style: 'margin-bottom:10px;' });
    [['text', 'Text to 3D'], ['image', 'Image to 3D']].forEach(function (t) {
      tabs.appendChild(U.el('div', {
        class: 'tab' + (AIPanel.activeTab === t[0] ? ' active' : ''),
        text: t[1],
        onclick: function () { AIPanel.activeTab = t[0]; AIPanel.renderPage(); }
      }));
    });
    body.appendChild(tabs);

    if (AIPanel.activeTab === 'text') {
      AIPanel._renderTextForm(body);
    } else {
      AIPanel._renderImageForm(body);
    }

    /* Generation Queue */
    /* ===== 🚀 AI 3D GENERATION STUDIO (v20.0) — đầy đủ tham số + batch + history ===== */
    AIPanel._renderGenerationStudio(body, tripo);

    const queueSection = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('timeline') }), U.el('span', { text: 'Generation Queue (' + status.queueLength + ')' })])
    ]);
    const qc = U.el('div', { class: 'section-content', id: 'ai-queue-content' });
    AIPanel.renderQueue(qc);
    queueSection.appendChild(qc);
    body.appendChild(queueSection);

    /* ===== AI MODEL TOOLS — Texturing / Upscale / Rig / Animate ===== */
    const modelId = tripo.lastCreatedModelId;
    const isLocalTools = AIPanel.getGenMode() === 'local';
    const localTarget = isLocalTools ? AIPanel._selectedModel() : null;
    const toolsSection = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('wand') }), U.el('span', { text: '🧠 AI Model Tools — chạy trên model đã tạo' })])
    ]);
    const tc = U.el('div', { class: 'section-content' });
    tc.appendChild(U.el('div', { class: 'info-row', style: 'margin-bottom:8px;' }, [
      U.el('span', { class: 'i-label', text: isLocalTools ? 'Model đang chọn (viewport)' : 'Model AI hiện tại' }),
      isLocalTools
        ? (localTarget ? U.el('span', { class: 'i-value', text: localTarget.name || 'Object' }) : U.el('span', { class: 'state-badge off', text: 'chưa chọn — bấm 1 model trong viewport' }))
        : (modelId ? U.el('span', { class: 'i-value', text: modelId.slice(0, 16) + '…' }) : U.el('span', { class: 'state-badge off', text: 'chưa có — tạo qua Text/Image-to-3D' }))
    ]));
    if (tripo.isXingchi()) {
      tc.appendChild(U.el('div', { class: 'info-row', style: 'margin-bottom:8px;' }, [
        U.el('span', { class: 'i-label', text: 'Provider' }),
        U.el('span', { class: 'state-badge pending', text: 'xingchiapi — không có /v3/animations/rig / retarget' })
      ]));
    }
    const toolsGrid = U.el('div', { class: 'mt-grid', style: 'grid-template-columns:repeat(2,1fr);gap:5px;' });
    const toolDefs = [
      ['🎨 Texturing', isLocalTools ? 'Texture procedural trên model đang chọn — chạy ngay trên máy' : 'Tạo lại PBR texture cho model — POST /v3/models/texture', function () {
        if (isLocalTools) { AIPanel.openLocalTextureModal(); return; }
        tripo.textureModel(); AIPanel.renderPage();
      }],
      ['🔄 Convert FBX', 'Đổi định dạng sang FBX (Unity/Unreal) — POST /v3/models/convert', function () { tripo.convertModel('FBX'); AIPanel.renderPage(); }],
      ['🦴 Auto Rig', 'Rig-check rồi sinh skeleton (spec mixamo) — /v3/animations/rig (cần trước Animate)', function () { tripo.rigModel(); AIPanel.renderPage(); }],
      ['🎬 Auto Animate', 'Retarget preset idle/walk/run lên model đã rig — /v3/animations/retarget', function () { tripo.animateModel(['idle', 'walk', 'run']); AIPanel.renderPage(); }],
      ['⬇ Decimate', 'Giảm số poly cho game — POST /v3/mesh/decimate (v2 upscale đã bỏ ở v3)', function () { tripo.decimateModel({ face_limit: S.polygon }); AIPanel.renderPage(); }]
    ];
    /* Upscale chỉ có ở Local (Tripo v3 bỏ upscale_model) */
    if (isLocalTools) {
      toolDefs.splice(1, 0, ['⬆ Upscale', 'Tăng tris + độ phân giải texture ngay trên máy (nội suy/làm mịn, không tạo chi tiết mới)', function () { AIPanel.openLocalUpscaleModal(); }]);
    }
    const toolsActive = isLocalTools ? !!localTarget : !!modelId;
    toolDefs.forEach(function (t) {
      toolsGrid.appendChild(U.el('button', {
        class: 'mt-btn' + (toolsActive ? ' primary' : ''),
        html: '<span style="font-size:14px;">' + t[0].split(' ')[0] + '</span><span>' + t[0].replace(/^\S+\s/, '') + '</span>',
        'data-tooltip': t[1],
        onclick: function () { t[2](); }
      }));
    });
    tc.appendChild(toolsGrid);
    tc.appendChild(U.el('div', { class: 'dim small', style: 'margin-top:8px;line-height:1.5;', text: isLocalTools
      ? '💻 Chế độ Local: Texturing + Upscale chạy trên model đang chọn trong viewport — nội suy/làm mịn + texture procedural, không tạo chi tiết mới như AI cloud. Các tool còn lại (Convert/Rig/Animate/Decimate) vẫn chạy qua Tripo khi có model Tripo.'
      : (modelId
        ? 'Tools chạy TRỰC TIẾP qua Tripo REST (task create + polling) — kết quả model mới có task id, dùng tiếp cho tool khác. Tripo v3 không có upscale — chuyển sang 💻 Local Auto Gen để upscale trên máy.'
        : 'Chưa có model Tripo: tạo bằng Text-to-3D hoặc Image-to-3D ở trên — sau khi tạo xong các tool này sẽ bật. Muốn upscale/texture ngay không cần key: chuyển sang 💻 Local Auto Gen và chọn 1 model trong viewport.') }));
    toolsSection.appendChild(tc);
    body.appendChild(toolsSection);

    /* Prompt history */
    const historySection = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('timeline') }), U.el('span', { text: 'Prompt History' })])
    ]);
    const hc = U.el('div', { class: 'section-content' });
    const prompts = PixiStudio.Storage.getPrompts();
    if (prompts.length) {
      prompts.slice(0, 8).forEach(function (p) {
        hc.appendChild(U.el('div', {
          class: 'history-item',
          text: '“' + p.text + '”',
          onclick: function () {
            const input = document.getElementById('ai-prompt-input');
            if (input) input.value = p.text;
          }
        }));
      });
    } else {
      hc.appendChild(U.el('div', { class: 'empty-state', style: 'padding:8px;' }, [
        U.el('span', { text: 'Chưa có prompt nào.' })
      ]));
    }
    historySection.appendChild(hc);
    body.appendChild(historySection);

    /* Local AI + monitors */
    body.appendChild(AIPanel._renderLocalAI());
  };

  AIPanel._renderTextForm = function (body) {
    /* Prompt */
    body.appendChild(U.el('label', { class: 'label-xs', text: 'Prompt' }));
    const prompt = U.el('textarea', {
      class: 'input', id: 'ai-prompt-input',
      placeholder: 'chibi wuxia hero, stylized 3D, game ready, clean topology…',
      style: 'min-height:64px;margin:5px 0 10px;'
    });
    body.appendChild(prompt);

    /* Negative prompt */
    body.appendChild(U.el('label', { class: 'label-xs', text: 'Negative Prompt' }));
    const neg = U.el('input', { class: 'input', placeholder: 'blurry, low poly, noise…', style: 'margin:5px 0 10px;' });
    body.appendChild(neg);

    /* Options row */
    const opts = U.el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px;' });
    const qualityWrap = U.el('div', { class: 'select-wrap' });
    const quality = U.el('select', { class: 'select', style: 'height:28px;font-size:11px;' });
    [['draft', 'Quality: Draft'], ['standard', 'Quality: Standard']].forEach(function (o) { quality.appendChild(U.el('option', { value: o[0], text: o[1] })); });
    qualityWrap.appendChild(quality);
    const styleWrap = U.el('div', { class: 'select-wrap' });
    const style = U.el('select', { class: 'select', style: 'height:28px;font-size:11px;' });
    ['stylize:none', 'stylize:anime', 'stylize:sculpture'].forEach(function (s) { style.appendChild(U.el('option', { value: s, text: s.replace(':', ': ') })); });
    styleWrap.appendChild(style);
    opts.appendChild(qualityWrap); opts.appendChild(styleWrap);
    body.appendChild(opts);

    /* Poly count + texture res */
    const polyRow = U.el('div', { class: 'slider-row' }, [U.el('span', { class: 's-label', text: 'Polygon' })]);
    const poly = U.el('input', { type: 'range', class: 'slider', min: '1000', max: '200000', step: '1000', value: '30000' });
    const polyVal = U.el('span', { class: 's-val', text: '30k' });
    poly.addEventListener('input', function () { polyVal.textContent = Math.round(poly.value / 1000) + 'k'; });
    polyRow.appendChild(poly); polyRow.appendChild(polyVal);
    body.appendChild(polyRow);

    /* Generate button */
    body.appendChild(U.el('button', {
      class: 'btn primary lg block',
      html: U.icon('wand') + '&nbsp; Generate Model ✨',
      onclick: function () {
        const text = prompt.value.trim();
        if (!text) {
          bus.emit('notify', { type: 'warning', title: 'Prompt trống', message: 'Nhập mô tả model trước khi generate.' });
          return;
        }
        PixiStudio.Storage.addPrompt(text, 'text');
        PixiStudio.AI.Tripo.textTo3D({
          prompt: text,
          negative_prompt: neg.value,
          quality: quality.value,
          format: 'glb'
        }).then(function () { AIPanel.renderPage(); });
      }
    }));
  };

  AIPanel._renderImageForm = function (body) {
    body.appendChild(U.el('label', { class: 'label-xs', text: 'Reference Images (front / side / back)' }));
    const dropzone = U.el('div', {
      class: 'section-content',
      style: 'border:1.5px dashed var(--border);border-radius:10px;padding:16px;text-align:center;cursor:pointer;margin:6px 0 10px;',
      onclick: function () {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
        input.onchange = function () {
          const files = Array.prototype.slice.call(input.files);
          let chain = Promise.resolve();
          files.forEach(function (f) {
            chain = chain.then(function () {
              return PixiStudio.Utils.readFileAsDataURL(f).then(function (url) {
                AIPanel.referenceImages.unshift({ name: f.name, url: url });
                AIPanel.renderPage();
              });
            });
          });
        };
        input.click();
      }
    }, [
      U.el('div', { class: 'es-icon', text: '🖼️' }),
      U.el('b', { text: 'Upload Reference Image' }),
      U.el('span', { class: 'dim small', text: 'PNG · JPG · WebP — multi-view supported' })
    ]);
    body.appendChild(dropzone);

    /* Reference list */
    if (AIPanel.referenceImages.length) {
      const row = U.el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;' });
      AIPanel.referenceImages.slice(0, 6).forEach(function (img) {
        row.appendChild(U.el('img', { src: img.url, title: img.name, style: 'width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid var(--primary);' }));
      });
      body.appendChild(row);
    }

    body.appendChild(U.el('button', {
      class: 'btn primary lg block',
      html: U.icon('wand') + '&nbsp; Generate from Image ✨',
      onclick: function () {
        if (!AIPanel.referenceImages.length) {
          bus.emit('notify', { type: 'warning', title: 'Chưa có ảnh', message: 'Upload reference image trước.' });
          return;
        }
        /* FormData thật từ ảnh đầu tiên */
        const first = AIPanel.referenceImages[0];
        fetch(first.url).then(function (r) { return r.blob(); }).then(function (blob) {
          const fd = new FormData();
          fd.append('file', blob, first.name);
          PixiStudio.AI.Tripo.imageTo3D({ formData: fd, file: blob, fileName: first.name })
            .then(function () { AIPanel.renderPage(); });
        });
      }
    }));
  };

  AIPanel.renderQueue = function (container) {
    container.innerHTML = '';
    const queue = PixiStudio.AI.Tripo.queue.slice(0, 8);
    if (!queue.length) {
      container.appendChild(U.el('div', { class: 'empty-state', style: 'padding:8px;' }, [
        U.el('span', { text: 'Queue trống.' })
      ]));
      return;
    }
    queue.forEach(function (task) {
      const stateBadge = {
        blocked: U.el('span', { class: 'state-badge off', text: 'blocked' }),
        queued: U.el('span', { class: 'state-badge pending', text: 'queued' }),
        processing: U.el('span', { class: 'state-badge pending', text: task.progress + '%' }),
        success: U.el('span', { class: 'state-badge ok', text: 'done' }),
        failed: U.el('span', { class: 'state-badge err', text: 'failed' })
      }[task.state];
      const item = U.el('div', { class: 'queue-item' }, [
        U.el('div', { class: 'q-info' }, [
          U.el('b', { text: task.type }),
          U.el('span', { text: task.message })
        ]),
        stateBadge
      ]);
      container.appendChild(item);
    });
  };

  AIPanel._renderLocalAI = function () {
    const wrap = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('cloud') }), U.el('span', { text: 'Local AI — Model Manager' })])
    ]);
    const sc = U.el('div', { class: 'section-content' });

    /* Local model slots — trạng thái trung thực */
    const models = [
      ['TripoSR (local)', 'not installed'],
      ['Stable-Fast-3D', 'not installed'],
      ['Hunyuan3D-2', 'not installed']
    ];
    models.forEach(function (m) {
      sc.appendChild(U.el('div', { class: 'queue-item' }, [
        U.el('div', { class: 'q-info' }, [
          U.el('b', { text: m[0] }),
          U.el('span', { text: 'Backend local chưa đóng gói trong prototype' })
        ]),
        U.el('span', { class: 'state-badge off', text: m[1] })
      ]));
    });

    /* GPU/CPU select */
    const deviceRow = U.el('div', { class: 'toggle-row' }, [U.el('span', { class: 't-label', text: 'Device' })]);
    const dw = U.el('div', { class: 'select-wrap', style: 'width:110px;' });
    const ds = U.el('select', { class: 'select', style: 'height:26px;font-size:11px;' });
    ds.appendChild(U.el('option', { value: 'gpu', text: 'GPU (WebGPU)' }));
    ds.appendChild(U.el('option', { value: 'cpu', text: 'CPU (WASM)' }));
    dw.appendChild(ds);
    deviceRow.appendChild(dw);
    sc.appendChild(deviceRow);

    /* VRAM / RAM monitors — số liệu THẬT nếu browser cho */
    const memory = performance.memory;
    const usedMB = memory ? Math.round(memory.usedJSHeapSize / 1048576) : null;
    const limitMB = memory ? Math.round(memory.jsHeapSizeLimit / 1048576) : null;
    const gpuInfo = PixiStudio.ThreeRenderer.capabilities || {};

    const statGrid = U.el('div', { class: 'stat-grid' });
    statGrid.appendChild(U.el('div', { class: 'stat-cell' }, [
      U.el('div', { class: 'sc-label', text: 'JS Heap' }),
      U.el('div', { class: 'sc-value', text: usedMB ? usedMB + ' MB' : 'n/a', html: usedMB ? usedMB + '<small> MB / ' + limitMB + '</small>' : 'n/a<small>API limited</small>' })
    ]));
    statGrid.appendChild(U.el('div', { class: 'stat-cell' }, [
      U.el('div', { class: 'sc-label', text: 'Max Texture' }),
      U.el('div', { class: 'sc-value', html: (gpuInfo.maxTextureSize || 0) + '<small> px GPU</small>' })
    ]));
    statGrid.appendChild(U.el('div', { class: 'stat-cell' }, [
      U.el('div', { class: 'sc-label', text: 'WebGPU' }),
      U.el('div', { class: 'sc-value', text: PixiStudio.ThreeRenderer.webgpuAvailable ? 'Available' : 'No' })
    ]));
    statGrid.appendChild(U.el('div', { class: 'stat-cell' }, [
      U.el('div', { class: 'sc-label', text: 'WebGL2' }),
      U.el('div', { class: 'sc-value', text: gpuInfo.webgl2 ? 'Yes' : 'No' })
    ]));
    sc.appendChild(statGrid);

    sc.appendChild(U.el('div', { class: 'empty-state', style: 'padding:8px;' }, [
      U.el('span', { class: 'state-badge pending', text: 'Local runtime (TripoSR v.v.) — Planned v5.1, backend tự host' })
    ]));

    /* Backend settings quick form */
    const form = U.el('div', { style: 'margin-top:10px;' });
    form.appendChild(U.el('label', { class: 'label-xs', text: 'Backend Settings — kết nối ngay' }));
    const providers = PixiStudio.AI.Tripo.providers;
    const provInput = U.el('select', { class: 'input', style: 'margin:5px 0;' });
    Object.keys(providers).forEach(function (id) {
      provInput.appendChild(U.el('option', { value: id, text: providers[id].label, selected: PixiStudio.AI.Tripo.config.provider === id }));
    });
    const epInput = U.el('input', {
      class: 'input', placeholder: 'https://openapi.tripo3d.ai/v3', style: 'margin:5px 0;',
      value: PixiStudio.AI.Tripo.config.endpoint || ''
    });
    const keyInput = U.el('input', {
      class: 'input', type: 'password', placeholder: 'API key', style: 'margin:5px 0;',
      value: PixiStudio.AI.Tripo.config.apiKey || ''
    });
    provInput.addEventListener('change', function () {
      const preset = providers[provInput.value];
      if (preset) {
        epInput.value = preset.endpoint;
        keyInput.placeholder = provInput.value === 'xingchiapi' ? 'API key xingchiapi' : 'API key (tsk_…)';
      }
    });
    const connectBtn = U.el('button', {
      class: 'btn primary sm block',
      text: 'Connect Backend',
      onclick: function () {
        const result = PixiStudio.AI.Tripo.connect(epInput.value || undefined, keyInput.value, provInput.value);
        if (!result.ok) {
          bus.emit('notify', { type: 'warning', title: 'Connect thất bại', message: 'API key không được để trống.' });
        } else if (PixiStudio.AI.Tripo.isXingchi() && keyInput.value.trim()) {
          PixiStudio.AI.Tripo.listModels();
        }
        AIPanel.renderPage();
        AIPanel.renderChecklist();
        PixiStudio.Topbar && PixiStudio.Topbar.updateStatus();
      }
    });
    form.appendChild(provInput); form.appendChild(epInput); form.appendChild(keyInput); form.appendChild(connectBtn);
    sc.appendChild(form);

    wrap.appendChild(sc);
    return wrap;
  };

  /* ============================================================
     QUICK GENERATE modal — chạy THẬT text-to-3D khi connected
     ============================================================ */
  AIPanel.openQuickGenerate = function () {
    const wrap = U.el('div');
    const badge = U.el('div', { style: 'margin-bottom:10px;' });
    const updateBadge = function () {
      badge.innerHTML = '';
      if (AIPanel.getGenMode() === 'local') {
        badge.appendChild(U.el('span', { class: 'state-badge ok', text: '💻 Local Auto Gen — tạo procedural trên máy, không cần key' }));
      } else {
        badge.appendChild(U.el('span', { class: 'state-badge ok', text: 'Tripo connected — text-to-3d sẽ chạy thật qua REST' }));
      }
    };
    updateBadge();
    wrap.appendChild(AIPanel._genModeRadios(function () { updateBadge(); updateGenBtn(); }));
    wrap.appendChild(badge);
    wrap.appendChild(U.el('label', { class: 'label-xs', text: 'Prompt' }));
    const prompt = U.el('textarea', {
      class: 'input', style: 'min-height:64px;margin:5px 0 10px;',
      placeholder: 'chibi wuxia hero, stylized 3D, game ready…'
    });
    wrap.appendChild(prompt);
    wrap.appendChild(U.el('label', { class: 'label-xs', text: 'Negative prompt' }));
    const neg = U.el('input', { class: 'input', style: 'margin:5px 0 12px;', placeholder: 'blurry, low poly…' });
    wrap.appendChild(neg);

    const genBtn = U.el('button', { class: 'btn primary lg block' });
    const updateGenBtn = function () {
      genBtn.innerHTML = U.icon('wand') + '&nbsp; ' + (AIPanel.getGenMode() === 'local' ? 'Tạo Model Local 💻' : 'Generate Model ✨');
    };
    updateGenBtn();
    genBtn.addEventListener('click', function () {
      const text = prompt.value.trim();
      /* Local: prompt trống → ngẫu nhiên, không cần key, đóng modal + notify */
      if (AIPanel.getGenMode() === 'local') {
        PixiStudio.Modals.close();
        AIPanel.runLocalGenerate({ prompt: text, seed: AIPanel._genState.seed, batch: AIPanel._genState.batch, complexity: AIPanel._genState.localComplexity, color: AIPanel._genState.localColor || undefined });
        return;
      }
      /* Cloud: flow cũ giữ nguyên */
      if (!text) { bus.emit('notify', { type: 'warning', title: 'Prompt trống' }); return; }
      PixiStudio.Modals.close();
      PixiStudio.Storage.addPrompt(text, 'text');
      PixiStudio.AI.Tripo.textTo3D({
        prompt: text, negative_prompt: neg.value, quality: 'standard', format: 'glb'
      }).then(function (r) {
        if (r.ok) {
          bus.emit('notify', {
            type: 'success', title: 'Task đã gửi tới Tripo',
            message: 'Đang poll — model sẽ TỰ ĐỘNG import vào viewport khi backend trả kết quả.'
          });
        }
      });
    });
    wrap.appendChild(genBtn);
    PixiStudio.Modals.open({ title: '✨ Tripo Text-to-3D', body: wrap, buttons: [{ label: 'Huỷ', class: 'btn' }] });
  };

  /* ============================================================
     CONNECT modal — nhập endpoint + API key, connect ngay
     ============================================================ */
  AIPanel.openConnectModal = function () {
    const wrap = U.el('div');
    wrap.appendChild(U.el('p', { style: 'color:var(--text-2);font-size:12px;line-height:1.6;margin-bottom:10px;', text: 'Nhập API key để Generate chạy THẬT qua REST (task create + polling). Key lưu localStorage — không giả lập kết quả.' }));
    const mainBtn = U.el('button', { class: 'btn primary lg block' });
    const updateMainBtn = function () {
      mainBtn.textContent = AIPanel.getGenMode() === 'local' ? '💻 Dùng Local Auto Gen' : 'Connect & mở Generate';
    };
    wrap.appendChild(AIPanel._genModeRadios(function () { updateMainBtn(); }));
    updateMainBtn();
    const provs = PixiStudio.AI.Tripo.providers;
    wrap.appendChild(U.el('label', { class: 'label-xs', text: 'Provider' }));
    const provSel = U.el('select', { class: 'input', style: 'margin:5px 0;' });
    Object.keys(provs).forEach(function (id) {
      provSel.appendChild(U.el('option', { value: id, text: provs[id].label, selected: PixiStudio.AI.Tripo.config.provider === id }));
    });
    provSel.addEventListener('change', function () { ep.value = (provs[provSel.value] || {}).endpoint || ''; });
    wrap.appendChild(provSel);
    wrap.appendChild(U.el('label', { class: 'label-xs', text: 'Endpoint' }));
    const ep = U.el('input', { class: 'input', style: 'margin:5px 0;', placeholder: 'https://openapi.tripo3d.ai/v3', value: PixiStudio.AI.Tripo.config.endpoint || 'https://openapi.tripo3d.ai/v3' });
    wrap.appendChild(ep);
    wrap.appendChild(U.el('label', { class: 'label-xs', text: 'API key' }));
    const key = U.el('input', { class: 'input', type: 'password', style: 'margin:5px 0 12px;', placeholder: 'API key', value: PixiStudio.AI.Tripo.config.apiKey || '' });
    wrap.appendChild(key);
    mainBtn.addEventListener('click', function () {
      /* Local: không cần key, không gọi Tripo.connect — mở Quick Generate ở chế độ local */
      if (AIPanel.getGenMode() === 'local') {
        AIPanel.setGenMode('local');
        PixiStudio.Modals.close();
        AIPanel.openQuickGenerate();
        AIPanel.renderChecklist();
        return;
      }
      const r = PixiStudio.AI.Tripo.connect(ep.value, key.value, provSel.value);
      if (!r.ok) {
        bus.emit('notify', { type: 'warning', title: 'Connect thất bại', message: 'API key không được để trống.' });
        return;
      }
      PixiStudio.Modals.close();
      AIPanel.openQuickGenerate();
      AIPanel.renderChecklist();
    });
    wrap.appendChild(mainBtn);
    wrap.appendChild(U.el('div', { class: 'dim small', style: 'margin-top:10px;line-height:1.5;', text: 'xingchiapi: https://api.xingchiapi.com/v1 (OpenAI-compatible) · Tripo: platform.tripo3d.ai · Local AI: chạy server.bat + backend tự host tại http://localhost:7860.' }));
    PixiStudio.Modals.open({ title: '🔗 Kết nối Tripo AI', body: wrap, buttons: [{ label: 'Huỷ', class: 'btn' }] });
  };

  /* ============================================================
     AUTO-UPDATE ENGINE
     • Tripo: poll các task processing mỗi 5s — auto-import model khi done
     • Meshy: quét /api/fbx-list mỗi 20s — FBX mới → toast + auto-load + preview
     Toggle trong Settings (mặc định ON).
     ============================================================ */
  AIPanel.autoUpdate = { tripo: true, meshy: true, _tripoTimer: null, _meshyTimer: null, _knownFbx: {} };

  AIPanel.startAutoUpdate = function () {
    /* TRIPO AUTO-UPDATE (v3) — lưới an toàn cho task processing
       (adapter đã poll mỗi 2s; timer này bắt lại task còn processing
       sau khi reload trang, dùng GET /v3/tasks/{id} qua Tripo.getTask) */
    if (AIPanel._tripoTimer) clearInterval(AIPanel._tripoTimer);
    AIPanel._tripoTimer = setInterval(function () {
      if (!AIPanel.autoUpdate.tripo || !PixiStudio.AI.Tripo.config.connected) return;
      const tripo = PixiStudio.AI.Tripo;
      tripo.queue.forEach(function (task) {
        if (task.state !== 'processing' || !task.taskId) return;
        tripo.getTask(task.taskId).then(function (d) {
          if (!d) return;
          if (d.status === 'success') {
            const url = d.output && (d.output.model_url || d.output.model || d.output.pbr_model);
            tripo.lastCreatedModelId = task.taskId;
            bus.emit('ai:task', { id: task.id, state: 'success', progress: 100 });
            bus.emit('notify', { type: 'success', title: 'Tripo task hoàn tất', message: 'Model đang TỰ ĐỘNG import vào viewport… (link hết hạn sau 5 phút)' });
            if (url && /\.glb(\?|$)/i.test(url)) {
              fetch(url).then(function (r2) { return r2.arrayBuffer(); }).then(function (buf) {
                PixiStudio.Models.loadGLBFromBuffer(buf, 'TripoAI_' + task.taskId.slice(0, 8), buf.byteLength);
                PixiStudio.Viewport.focusSelected();
              });
            }
          } else if (d.status === 'failed' || d.status === 'banned' || d.status === 'cancelled') {
            bus.emit('ai:task', { id: task.id, state: 'failed', progress: 0 });
            bus.emit('notify', { type: 'error', title: 'Tripo task fail', message: d.status });
          } else if (d.progress !== undefined) {
            bus.emit('ai:task', { id: task.id, state: 'processing', progress: Math.round(d.progress) });
          }
        }).catch(function () { });
      });
    }, 5000);

    /* MESHY AUTO-UPDATE — quét FBX mới mỗi 20s */
    if (AIPanel._meshyTimer) clearInterval(AIPanel._meshyTimer);
    const scanMeshy = function () {
      if (!AIPanel.autoUpdate.meshy) return;
      if (location.protocol === 'file:') return; /* file://: không có Node bridge server — bỏ qua hẳn, tránh request rác file:///api/fbx-list */
      fetch('/api/fbx-list').then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok || !j.files) return;
        j.files.forEach(function (f) {
          if (!AIPanel.autoUpdate._knownFbx[f.url]) {
            const isNew = Object.keys(AIPanel.autoUpdate._knownFbx).length > 0;
            AIPanel.autoUpdate._knownFbx[f.url] = { name: f.name, size: f.size, seenAt: Date.now() };
            if (isNew && !/animated_mixamo_Running|character_mixamo/i.test(f.name)) {
              bus.emit('notify', {
                type: 'info', title: '🔄 Meshy FBX mới phát hiện',
                message: f.name + ' — mở Animation Studio → Meshy FBX Rig để load (Idle/Attack auto-sinh).',
                duration: 8000
              });
            }
          }
        });
      }).catch(function () { });
    };
    /* seed known files lần đầu (không toast) — bỏ qua trên file:// (không có server) */
    if (location.protocol !== 'file:') {
      fetch('/api/fbx-list').then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok && j.files) {
          j.files.forEach(function (f) { AIPanel.autoUpdate._knownFbx[f.url] = { name: f.name }; });
        }
      }).catch(function () { });
      AIPanel._meshyTimer = setInterval(scanMeshy, 20000);
    }
  };

  AIPanel.setAutoUpdate = function (which, on) {
    AIPanel.autoUpdate[which] = !!on;
    SaveToggle(which, on);
    bus.emit('notify', { type: 'info', title: 'Auto-update ' + which, message: on ? 'BẬT' : 'TẮT' });
  };

  function SaveToggle(which, on) {
    try {
      const st = JSON.parse(localStorage.getItem('pixiStudio.autoUpdate') || '{}');
      st[which] = on;
      localStorage.setItem('pixiStudio.autoUpdate', JSON.stringify(st));
    } catch (e) { }
  }

  /* ---------- Init wiring ---------- */
  AIPanel.init = function () {
    /* khôi phục chế độ gen đã lưu (mặc định cloud) */
    AIPanel.getGenMode();
    AIPanel.renderChecklist();

    /* Tripo card buttons — Generate chạy THẬT khi connected / modal connect khi chưa */
    const genBtn = document.getElementById('tripo-generate');
    if (genBtn) {
      genBtn.addEventListener('click', function () {
        /* Local: mở Quick Generate ở chế độ local (không cần key) */
        if (AIPanel.getGenMode() === 'local') {
          AIPanel.openQuickGenerate();
        } else if (PixiStudio.AI.Tripo.config.connected) {
          AIPanel.openQuickGenerate();
        } else {
          AIPanel.openConnectModal();
        }
      });
    }
    const collapse = document.getElementById('tripo-collapse');
    if (collapse) {
      collapse.addEventListener('click', function (e) {
        e.stopPropagation();
        const card = document.getElementById('tripo-card');
        if (card) {
          card.classList.add('collapsed');
          /* nút mở lại trong viewport menu */
          setTimeout(function () {
            const reopen = document.createElement('button');
            reopen.className = 'icon-btn';
            reopen.id = 'tripo-reopen';
            reopen.style.cssText = 'position:absolute;top:10px;right:12px;z-index:5;';
            reopen.innerHTML = PixiStudio.Utils.icon('wand');
            reopen.setAttribute('data-tooltip', 'Mở lại Tripo AI card');
            reopen.addEventListener('click', function () {
              card.classList.remove('collapsed');
              reopen.remove();
            });
            document.getElementById('viewport-canvas-wrap').appendChild(reopen);
          }, 50);
        }
      });
    }

    /* Sync trạng thái AI vào statusbar */
    bus.on('ai:state', function (data) {
      const dot = document.getElementById('sb-ai-dot');
      const label = document.getElementById('sb-ai-state');
      if (dot) {
        dot.classList.toggle('off', !data.connected);
        dot.classList.toggle('warn', false);
        if (data.connected) dot.classList.add('warn');
      }
      if (label) label.textContent = data.connected ? ('Connected · ' + data.mode) : 'Not connected';
      AIPanel.renderChecklist();
    });

    /* Auto-update engine + restore toggles */
    try {
      const st = JSON.parse(localStorage.getItem('pixiStudio.autoUpdate') || '{}');
      if (st.tripo === false) AIPanel.autoUpdate.tripo = false;
      if (st.meshy === false) AIPanel.autoUpdate.meshy = false;
    } catch (e) { }
    AIPanel.startAutoUpdate();

    bus.on('ai:queue', function () {
      const qc = document.getElementById('ai-queue-content');
      if (qc) AIPanel.renderQueue(qc);
    });
  };

  window.PixiStudio.AIPanel = AIPanel;
})();
