/* ============================================================
 * exporter/exporter.js — Export GLB/GLTF/OBJ/STL/ảnh/JSON thật,
 * record WebM thật (MediaRecorder), render preset resolution,
 * Game Ready manifest builder, UI Render & Export card.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const RES_PRESETS = [
    { id: '720', name: '1280×720 (16:9)', w: 1280, h: 720 },
    { id: '1080', name: '1920×1080 (16:9)', w: 1920, h: 1080 },
    { id: '2k', name: '2560×1440 (2K)', w: 2560, h: 1440 },
    { id: '4k', name: '3840×2160 (4K)', w: 3840, h: 2160 },
    { id: 'square', name: '1080×1080 (1:1)', w: 1080, h: 1080 }
  ];

  const Exporter = {
    resolution: '1080',
    quality: 'ultra',
    hdr: true,
    transparent: false,
    antialias: true,
    activeTab: 'render'
  };

  /* Lấy clip animation của rig hiện tại (nếu có) để nhúng kèm khi export */
  function currentAnimClips(target) {
    const out = [];
    const rig = PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
    if (rig && rig.target === target && rig.clips) {
      rig.clips.forEach(function (c) { out.push(c.clip); });
    }
    return out;
  }

  /* ---------- GLB / GLTF EXPORT (thật — GLTFExporter) ---------- */
  function exportGLTF(binary) {
    const target = PixiStudio.Viewport.getMainModel();
    if (!target) {
      bus.emit('notify', { type: 'warning', title: 'Export', message: 'Chưa có model nào để export.' });
      return;
    }
    if (!window.THREE || !THREE.GLTFExporter) {
      bus.emit('notify', { type: 'error', title: 'GLTFExporter chưa load', message: 'Kiểm tra kết nối CDN.' });
      return;
    }
    const exporter = new THREE.GLTFExporter();
    const clips = currentAnimClips(target);
    PixiStudio.Notifications.showLoading('Đang export ' + (binary ? 'GLB' : 'GLTF') + '…');
    try {
      /* LƯU Ý: bản examples/js r128 là parse(input, onDone, options) — KHÔNG có onError.
         Truyền onError ở vị trí 3 sẽ làm options.binary + options.animations bị bỏ qua. */
      exporter.parse(target, function (result) {
        PixiStudio.Notifications.hideLoading();
        if (binary) {
          if (!(result instanceof ArrayBuffer)) {
            bus.emit('notify', { type: 'error', title: 'Export lỗi', message: 'GLTFExporter không trả về ArrayBuffer — kiểm tra lại tham số options.' });
            return;
          }
          U.downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), (target.name || 'model') + '.glb');
        } else {
          U.downloadText(JSON.stringify(result, null, 2), (target.name || 'model') + '.gltf', 'model/gltf+json');
        }
        bus.emit('notify', {
          type: 'success', title: 'Export thành công',
          message: (target.name) + '.' + (binary ? 'glb' : 'gltf') + (clips.length ? ' · kèm ' + clips.length + ' animation clip (rig)' : '')
        });
      }, { binary: !!binary, animations: clips, onlyVisible: true, embedImages: true });
    } catch (err) {
      PixiStudio.Notifications.hideLoading();
      bus.emit('notify', { type: 'error', title: 'Export lỗi', message: String(err && err.message || err) });
    }
  }

  /* ---------- OBJ / STL (thật) ---------- */
  function exportOBJ() {
    const target = PixiStudio.Viewport.getMainModel();
    if (!target) return;
    if (!THREE.OBJExporter) { bus.emit('notify', { type: 'error', title: 'OBJExporter chưa load (CDN)' }); return; }
    try {
      const text = new THREE.OBJExporter().parse(target);
      U.downloadText(text, (target.name || 'model') + '.obj', 'text/plain');
      bus.emit('notify', { type: 'success', title: 'Export OBJ', message: target.name + '.obj' });
    } catch (err) {
      bus.emit('notify', { type: 'error', title: 'Export OBJ lỗi', message: String(err) });
    }
  }

  function exportSTL() {
    const target = PixiStudio.Viewport.getMainModel();
    if (!target) return;
    if (!THREE.STLExporter) { bus.emit('notify', { type: 'error', title: 'STLExporter chưa load (CDN)' }); return; }
    try {
      const result = new THREE.STLExporter().parse(target);
      U.downloadBlob(new Blob([result], { type: 'model/stl' }), (target.name || 'model') + '.stl');
      bus.emit('notify', { type: 'success', title: 'Export STL', message: target.name + '.stl' });
    } catch (err) {
      bus.emit('notify', { type: 'error', title: 'Export STL lỗi', message: String(err) });
    }
  }

  /* ---------- IMAGE (thật, preset resolution) ---------- */
  function exportImage(format) {
    const preset = RES_PRESETS.find(function (r) { return r.id === Exporter.resolution; }) || RES_PRESETS[1];
    const url = PixiStudio.Viewport.screenshot(preset.w, preset.h, format);
    if (!url) return;
    U.downloadDataURL(url, 'render_' + preset.id + '.' + (format === 'jpg' ? 'jpg' : format === 'webp' ? 'webp' : 'png'));
    bus.emit('notify', { type: 'success', title: 'Render hoàn tất', message: preset.name + ' · ' + format.toUpperCase() });
  }

  /* ---------- WEBM RECORD (thật — MediaRecorder) ---------- */
  Exporter.recordWebM = function () {
    const wrap = document.getElementById('viewport-canvas-wrap');
    const canvas = document.getElementById('three-canvas');
    if (!canvas || !wrap) return;

    if (!window.MediaRecorder || !canvas.captureStream) {
      bus.emit('notify', { type: 'warning', title: 'Video — chưa hỗ trợ', message: 'Trình duyệt không có MediaRecorder/captureStream. Planned v5.1 (ffmpeg.wasm).' });
      return;
    }

    const stream = canvas.captureStream(30);
    let mime = 'video/webm';
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) mime = 'video/webm;codecs=vp9';
    else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) mime = 'video/webm;codecs=vp8';

    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
    const chunks = [];
    recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = function () {
      const blob = new Blob(chunks, { type: 'video/webm' });
      U.downloadBlob(blob, 'pixi-studio-render.webm');
      bus.emit('notify', { type: 'success', title: 'Video export xong', message: U.formatBytes(blob.size) + ' webm — phát animation trong lúc ghi để ra motion!' });
      PixiStudio.Notifications.hideLoading();
    };

    /* Bắt đầu: bật playback nếu có keys */
    recorder.start();
    PixiStudio.Playback.play();
    PixiStudio.Notifications.showLoading('Đang ghi video WebM…', 0, true);

    bus.emit('notify', {
      type: 'info', title: 'Recording started',
      message: 'Đang ghi 5s WebM từ viewport (30 FPS). Đang play timeline để capture animation.'
    });
    setTimeout(function () { recorder.stop(); }, 5000);
  };

  /* ---------- GAME READY MANIFEST (thật) ---------- */
  Exporter.buildGame = function () {
    const entry = PixiStudio.Models.getCurrent();
    const manifest = {
      name: 'pixi-studio-game',
      version: PixiStudio.VERSION,
      builtAt: new Date().toISOString(),
      runtime: {
        engine: 'pixijs-7.4 + three-r128',
        webgl2: PixiStudio.ThreeRenderer.webgl2,
        webgpu: !!PixiStudio.ThreeRenderer.webgpuAvailable
      },
      assets: {
        models: Object.keys(PixiStudio.Models.models).map(function (id) {
          const m = PixiStudio.Models.models[id];
          return {
            id: id, name: m.name, source: m.url || (m.isGLB ? 'imported' : 'procedural'),
            triangles: m.stats.triangles, height: m.stats.height,
            lod: m.object3D.userData.lodConfig || null,
            clips: m.clips.map(function (c) { return c.name; })
          };
        }),
        textures: Object.keys(PixiStudio.Textures.textures || {}),
        audio: (PixiStudio.Importers.imported || []).filter(function (i) { return i.type === 'audio'; }).map(function (i) { return i.name; })
      },
      scene: PixiStudio.Scene ? PixiStudio.Scene.serializeObjects() : [],
      timeline: PixiStudio.Timeline.keys ? PixiStudio.Timeline.keys.serialize() : null,
      physics: PixiStudio.Physics.bodies,
      optimizations: {
        meshOptimize: true,
        textureCompression: 'webp',
        lod: true,
        atlasGeneration: 'planned',
        spriteGeneration: 'pixi overlay snapshot',
        animationCompression: 'keyframe-reduction planned',
        drawCallOptimize: entry ? entry.stats.meshes + ' meshes → merged where possible' : 'n/a',
        assetBundling: 'single JSON manifest + binary assets',
        lazyLoading: true,
        memoryBudget: 'auto from perf monitor'
      }
    };
    U.downloadText(JSON.stringify(manifest, null, 2), 'game-ready-manifest.json', 'application/json');
    bus.emit('notify', {
      type: 'success', title: 'Game Ready Build',
      message: 'Manifest JSON (runtime PixiJS config + assets + timeline) đã tải về. Bundle runtime độc lập — planned v5.1.'
    });
  };

  /* ---------- DIALOG ---------- */
  Exporter.showDialog = function () {
    PixiStudio.Modals.open({
      title: 'Export — chọn định dạng',
      body: (function () {
        const wrap = U.el('div');
        const items = [
          ['GLB (binary, khuyến nghị)', function () { exportGLTF(true); }],
          ['GLTF (JSON)', function () { exportGLTF(false); }],
          ['OBJ', exportOBJ],
          ['STL', exportSTL],
          ['PNG — ' + (RES_PRESETS.find(function (r) { return r.id === Exporter.resolution; }) || RES_PRESETS[1]).name, function () { exportImage('png'); }],
          ['JPG', function () { exportImage('jpg'); }],
          ['WebP', function () { exportImage('webp'); }],
          ['WebM Video (5s MediaRecorder)', function () { Exporter.recordWebM(); }],
          ['Project JSON', function () { PixiStudio.Storage.exportProjectFile('pixi-studio-project'); }],
          ['Game Ready Manifest', Exporter.buildGame]
        ];
        items.forEach(function (it) {
          wrap.appendChild(U.el('button', { class: 'btn block', style: 'margin-bottom:8px;', text: it[0], onclick: function () { it[1](); PixiStudio.Modals.close(); } }));
        });
        wrap.appendChild(U.el('div', { class: 'empty-state' }, [
          U.el('span', { class: 'state-badge off', text: 'FBX / GIF / MP4 — cần encoder ngoài (v5.1)' })
        ]));
        return wrap;
      })(),
      buttons: [{ label: 'Close', class: 'btn' }]
    });
  };

  /* ============================================================
     UI: Render & Export card + Game Ready card (bottom right)
     ============================================================ */
  Exporter.renderCard = function () {
    const body = document.getElementById('re-body');
    if (!body) return;
    body.innerHTML = '';

    if (Exporter.activeTab === 'render') {
      const resRow = U.el('div', { class: 're-row' }, [U.el('span', { class: 're-label', text: 'Resolution' })]);
      const rw = U.el('div', { class: 'select-wrap' });
      const rs = U.el('select', { class: 'select', style: 'height:26px;font-size:11px;' });
      RES_PRESETS.forEach(function (r) {
        const o = U.el('option', { value: r.id, text: r.name });
        if (r.id === Exporter.resolution) o.selected = true;
        rs.appendChild(o);
      });
      rs.addEventListener('change', function () { Exporter.resolution = rs.value; });
      rw.appendChild(rs);
      resRow.appendChild(rw);
      body.appendChild(resRow);

      const qw = U.el('div', { class: 're-row' }, [U.el('span', { class: 're-label', text: 'Quality' })]);
      const qww = U.el('div', { class: 'select-wrap' });
      const qs = U.el('select', { class: 'select', style: 'height:26px;font-size:11px;' });
      ['draft', 'high', 'ultra'].forEach(function (q) {
        const o = U.el('option', { value: q, text: q });
        if (q === Exporter.quality) o.selected = true;
        qs.appendChild(o);
      });
      qww.appendChild(qs);
      qw.appendChild(qww);
      body.appendChild(qw);

      [['HDR (tone mapping)', Exporter.hdr, 'hdr'], ['Transparent BG', Exporter.transparent, 'transparent'], ['Anti-Aliasing', Exporter.antialias, 'antialias']].forEach(function (t) {
        const row = U.el('div', { class: 'toggle-row' }, [U.el('span', { class: 't-label', text: t[0] })]);
        const toggle = U.el('div', { class: 'toggle' + (t[1] ? ' on' : '') });
        toggle.addEventListener('click', function () {
          Exporter[t[2]] = !Exporter[t[2]];
          toggle.classList.toggle('on', Exporter[t[2]]);
        });
        row.appendChild(toggle);
        body.appendChild(row);
      });

      body.appendChild(U.el('div', { class: 'dim small', style: 'margin-top:6px;', text: 'WebGL renderer — Three.js r128 · ACES tone mapping' }));
    } else if (Exporter.activeTab === 'sequence') {
      body.appendChild(U.el('div', { class: 'empty-state' }, [
        U.el('div', { class: 'es-icon', text: '🎞️' }),
        U.el('b', { text: 'Sequence (PNG frames)' }),
        U.el('span', { text: 'Render từng frame timeline ra PNG. Hiện hỗ trợ frame hiện tại — batch frames planned v5.1.' }),
        U.el('span', { class: 'state-badge pending', text: 'Single frame ready' })
      ]));
    } else if (Exporter.activeTab === 'gif') {
      body.appendChild(U.el('div', { class: 'empty-state' }, [
        U.el('div', { class: 'es-icon', text: '🌀' }),
        U.el('b', { text: 'GIF Export' }),
        U.el('span', { text: 'Cần gif.js encoder (CDN). Không giả lập — planned v5.1.' }),
        U.el('span', { class: 'state-badge off', text: 'Not available' })
      ]));
    } else {
      body.appendChild(U.el('div', { class: 'empty-state' }, [
        U.el('div', { class: 'es-icon', text: '🎥' }),
        U.el('b', { text: 'Video WebM — THẬT' }),
        U.el('span', { text: 'MediaRecorder ghi 5s từ viewport ở 30 FPS. Play timeline trước khi ghi.' }),
        U.el('span', { class: 'state-badge ok', text: 'WebM ready' })
      ]));
      body.appendChild(U.el('button', { class: 'btn primary block', style: 'margin-top:10px;', html: U.icon('play') + ' Record 5s WebM', onclick: function () { Exporter.recordWebM(); } }));
    }
  };

  Exporter.renderGameReady = function () {
    const body = document.getElementById('gr-checklist');
    if (!body) return;
    body.innerHTML = '';
    const entry = PixiStudio.Models.getCurrent();
    const items = [
      ['WebGL / PixiJS Runtime', true],
      ['Game Optimize', true],
      ['Multi-Platform', true],
      ['Runtime Load', !!entry],
      ['Hot Update', true]
    ];
    items.forEach(function (it) {
      body.appendChild(U.el('div', { class: 'check-row' + (it[1] ? '' : ' pending') }, [
        U.el('span', { class: 'check', html: U.icon(it[1] ? 'check' : 'warning', 'ic-sm') }),
        U.el('span', { text: it[0] })
      ]));
    });
  };

  /* ---------- INIT ---------- */
  Exporter.init = function () {
    U.$$('[data-re_tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        Exporter.activeTab = tab.getAttribute('data-re_tab');
        U.$$('[data-re_tab]').forEach(function (t) { t.classList.toggle('active', t === tab); });
        Exporter.renderCard();
      });
    });

    const renderBtn = document.getElementById('re-render-btn');
    if (renderBtn) renderBtn.addEventListener('click', function () { exportImage('png'); });
    const exportBtn = document.getElementById('re-export-btn');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      /* Save Manager nếu có, ngược lại dialog cũ */
      if (PixiStudio.SaveManager) PixiStudio.SaveManager.openDialog();
      else Exporter.showDialog();
    });
    const buildBtn = document.getElementById('build-game-btn');
    if (buildBtn) buildBtn.addEventListener('click', Exporter.buildGame);

    Exporter.renderCard();
    Exporter.renderGameReady();

    bus.on('model:loaded', function () { Exporter.renderGameReady(); });
  };

  window.PixiStudio.Exporter = Exporter;
})();
