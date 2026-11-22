/* ============================================================
 * ai/tripo-adapter.js — Adapter Tripo OpenAPI v3 (v20.0).
 *
 * MIGRATION v2 → v3 (2026-11-22): Tripo tắt API v2 từ 2026-10-31,
 * nên adapter cũ (/v2/openapi/task/create, model_version v1.4/v2.0)
 * không còn chạy. Bản này dùng API v3 chính thức:
 *   Base:    https://openapi.tripo3d.ai/v3
 *   Auth:    Authorization: Bearer <key> (key lấy ở platform.tripo3d.ai/api-keys)
 *   Create:  POST /v3/generation/text-to-model | image-to-model | multiview-to-model
 *   Poll:    GET  /v3/tasks/{task_id} mỗi 2s (≤1 req/s) → status "success"
 *   Download: output.model_url (GLB) — LINK HẾT HẠN SAU 5 PHÚT, tải ngay.
 *   Post:    /v3/models/texture, /v3/models/convert, /v3/mesh/*,
 *            /v3/animations/rig-check → rig → retarget (chuỗi bằng task_id).
 * Nguồn: developers.tripo3d.ai (Quick Start, API Reference) — kiểm chứng 2026-11-22.
 * Chi phí API: trả theo dùng, 1 credit = $0.01; 300 credit thử (2 tuần).
 * Studio và API dùng ví credit RIÊNG — gói Studio không trả cho API.
 *
 * TRẠNG THÁI TRUNG THỰC: chưa có key ⇒ mọi task ở 'blocked — not connected'.
 * KHÔNG giả lập kết quả. Key chỉ lưu ở localStorage của trình duyệt, không
 * hardcode, không nằm trong project file.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;

  const DEFAULT_ENDPOINT = 'https://openapi.tripo3d.ai/v3';
  const POLL_MS = 2000;                 /* docs: poll mỗi 2s, tối đa 1 req/s */
  const POLL_MAX = 300;                 /* ~10 phút rồi dừng, tránh poll vô hạn */

  /* Model catalogue v3 — docs developers.tripo3d.ai/en/docs/models-and-versions */
  const MODELS = {
    'v3.1-20260211': { label: 'H3.1 — chi tiết nhất (khuyên dùng)', series: 'H' },
    'v3.0-20250812': { label: 'H3.0 — ổn định, nhiều tính năng', series: 'H' },
    'v2.5-20250123': { label: 'H2.5 — cân bằng, nhẹ', series: 'H' },
    'P2-20260801': { label: 'P2 — game-ready, quad', series: 'P' },
    'P1-20260311': { label: 'P1 — low-poly', series: 'P' }
  };
  const DEFAULT_MODEL = 'v3.1-20260211';
  const RIG_MODEL = 'v3.0-20260909';    /* rig version khuyên dùng cho humanoid */

  /* Provider mặc định (OpenAI-compatible gateway) — đăng ký sẵn để dùng
   * cho Text-to-3D / Rig / Animate. Endpoint này KHÔNG thay được api.tripo3d.ai. */
  const DEFAULT_PROVIDER = 'xingchiapi';
  const PROVIDERS = {
    tripo: {
      label: 'Tripo3D OpenAPI v3',
      endpoint: DEFAULT_ENDPOINT,
      docs: 'developers.tripo3d.ai',
      apiVersion: 'v3',
      models: Object.keys(MODELS),
      supportsRig: true
    },
    xingchiapi: {
      label: 'Xingchi API (OpenAI-compatible)',
      endpoint: 'https://api.xingchiapi.com/v1',
      docs: 'api.xingchiapi.com',
      apiVersion: 'v1',
      models: [],                 /* điền từ GET /v1/models sau khi kiểm tra key */
      supportsRig: false          /* gateway này chưa có API rig/animate 3D */
    }
  };

  const Tripo = {
    config: {
      provider: DEFAULT_PROVIDER,
      endpoint: PROVIDERS[DEFAULT_PROVIDER].endpoint,
      apiKey: '',                  /* KHÔNG hardcode key — key tự khai từ file api.xingchiapi.com.txt */
      connected: false,
      mode: 'not-connected',      // not-connected | cloud | local
      _keyStorage: { xingchiapi: 'pixiStudio.xingchiKey', tripo: 'pixiStudio.tripoKey' }
    },
    providers: PROVIDERS,
    MODELS: MODELS,
    DEFAULT_MODEL: DEFAULT_MODEL,
    RIG_MODEL: RIG_MODEL,
    isXingchi: function (cfg) {
      cfg = cfg || Tripo.config;
      return cfg.provider === 'xingchiapi' || String(cfg.endpoint || '').indexOf('xingchiapi.com') !== -1;
    },
    queue: [],                    // {id, type, params, state, progress, message, taskId, resultUrl}
    _pollTimers: {}
  };

  /* ---------- SERIALIZATION cho save project ---------- */
  Tripo.serialize = function () {
    return {
      provider: Tripo.config.provider,
      endpoint: Tripo.config.endpoint,
      hasKey: !!Tripo.config.apiKey,
      connected: Tripo.config.connected,
      mode: Tripo.config.mode,
      queue: Tripo.queue.slice(0, 10)
    };
  };

  Tripo.deserialize = function (data) {
    if (!data) return;
    if (data.endpoint) Tripo.config.endpoint = data.endpoint;
    if (data.provider) Tripo.config.provider = data.provider;
    if (data.connected && data.hasKey) {
      /* key lưu riêng để tránh nằm trong project file */
      try {
        Tripo.config.apiKey = localStorage.getItem(Tripo.config._keyStorage[Tripo.config.provider] || 'pixiStudio.tripoKey') || '';
        Tripo.config.connected = !!Tripo.config.apiKey;
        Tripo.config.mode = Tripo.config.connected ? 'cloud' : 'not-connected';
      } catch (e) { }
    }
    if (Array.isArray(data.queue)) Tripo.queue = data.queue;
    bus.emit('ai:state', { connected: Tripo.config.connected, mode: Tripo.config.mode });
  };

  /* ---------- CONNECT ---------- */
  Tripo.connect = function (endpoint, apiKey, provider) {
    const preset = PROVIDERS[provider] || PROVIDERS[DEFAULT_PROVIDER];
    Tripo.config.provider = PROVIDERS[provider] ? provider : (Tripo.isXingchi({ endpoint: endpoint }) ? 'xingchiapi' : 'tripo');
    Tripo.config.endpoint = (endpoint || preset.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '');
    Tripo.config.apiKey = apiKey || '';

    if (!Tripo.config.apiKey) {
      Tripo.config.connected = false;
      Tripo.config.mode = 'not-connected';
      bus.emit('ai:state', { connected: false, mode: Tripo.config.mode });
      return { ok: false, reason: 'API key trống' };
    }

    Tripo.config.connected = true;
    Tripo.config.mode = Tripo.config.endpoint.indexOf('localhost') !== -1 || Tripo.config.endpoint.indexOf('127.0.0.1') !== -1
      ? 'local' : 'cloud';

    try { localStorage.setItem(Tripo.config._keyStorage[Tripo.config.provider] || 'pixiStudio.tripoKey', Tripo.config.apiKey); } catch (e) { }

    bus.emit('ai:state', { connected: true, mode: Tripo.config.mode, provider: Tripo.config.provider });
    bus.emit('notify', {
      type: 'success', title: preset.label + ' connected',
      message: 'Backend: ' + Tripo.config.endpoint + ' (' + Tripo.config.mode + ')'
    });
    return { ok: true, provider: Tripo.config.provider };
  };

  /* ---------- DANH SÁCH MODEL của gateway (xingchiapi) ---------- */
  Tripo.listModels = function () {
    if (!Tripo.config.connected) return Promise.resolve([]);
    if (Tripo.config.provider === 'tripo') {
      /* Tripo v3 không có endpoint /models — catalogue nằm sẵn ở Tripo.MODELS */
      bus.emit('ai:models', { provider: 'tripo', models: Object.keys(MODELS) });
      return Promise.resolve(Object.keys(MODELS));
    }
    return apiFetch('/models').then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      const list = (data && data.data || []).map(function (m) { return m.id || m; });
      PROVIDERS[Tripo.config.provider] && (PROVIDERS[Tripo.config.provider].models = list);
      bus.emit('ai:models', { provider: Tripo.config.provider, models: list });
      return list;
    }).catch(function (err) {
      bus.emit('notify', { type: 'error', title: 'Không đọc được /models', message: err.message });
      return [];
    });
  };

  /* ---------- chat completion (dùng cho prompt rig/animate) ---------- */
  Tripo.chat = function (messages, model) {
    if (!Tripo.config.connected) {
      bus.emit('notify', { type: 'warning', title: 'Chưa kết nối', message: 'Nhập API key xingchiapi trong AI Tools → Backend Settings.' });
      return Promise.resolve(null);
    }
    return apiFetch('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: model || 'gpt-4o-mini', messages: messages, stream: false })
    }).then(function (res) { return res.json(); }).then(function (data) {
      const msg = data && data.choices && data.choices[0] && data.choices[0].message;
      return msg ? msg.content : null;
    }).catch(function (err) {
      bus.emit('notify', { type: 'error', title: 'chat/completions lỗi', message: err.message });
      return null;
    });
  };

  Tripo.disconnect = function () {
    Tripo.config.connected = false;
    Tripo.config.apiKey = '';
    Tripo.config.mode = 'not-connected';
    try { localStorage.removeItem(Tripo.config._keyStorage[Tripo.config.provider] || 'pixiStudio.tripoKey'); } catch (e) { }
    bus.emit('ai:state', { connected: false, mode: 'not-connected' });
  };

  Tripo.status = function () {
    return {
      connected: Tripo.config.connected,
      mode: Tripo.config.mode,
      provider: Tripo.config.provider,
      providerLabel: (PROVIDERS[Tripo.config.provider] || {}).label || Tripo.config.provider,
      apiVersion: (PROVIDERS[Tripo.config.provider] || {}).apiVersion || '?',
      supportsRig: !!(PROVIDERS[Tripo.config.provider] || {}).supportsRig,
      models: (PROVIDERS[Tripo.config.provider] || {}).models || [],
      endpoint: Tripo.config.endpoint || '(chưa cấu hình)',
      queueLength: Tripo.queue.length,
      processing: Tripo.queue.filter(function (q) { return q.state === 'processing'; }).length
    };
  };

  /* ---------- QUEUE ---------- */
  function enqueue(type, params) {
    const task = {
      id: 'task-' + Date.now() + '-' + Math.floor(Math.random() * 999),
      type: type,                       // text-to-3d | image-to-3d | multiview-to-3d | texture | ...
      params: params,
      state: Tripo.config.connected ? 'queued' : 'blocked',
      progress: 0,
      message: Tripo.config.connected
        ? 'Đã thêm vào queue — chờ backend'
        : 'BLOCKED — chưa kết nối backend AI (cần API key hoặc backend local)',
      taskId: null,
      resultUrl: null,
      resultUrls: null,
      credits: null,
      createdAt: Date.now()
    };
    Tripo.queue.unshift(task);
    if (Tripo.queue.length > 30) Tripo.queue.pop();
    bus.emit('ai:task', { id: task.id, state: task.state, progress: 0, type: task.type });
    bus.emit('ai:queue', { queue: Tripo.queue.slice(0, 12) });
    return task;
  }

  function updateTask(task, patch) {
    Object.keys(patch).forEach(function (k) { task[k] = patch[k]; });
    bus.emit('ai:task', { id: task.id, state: task.state, progress: task.progress, message: task.message });
    bus.emit('ai:queue', { queue: Tripo.queue.slice(0, 12) });
  }

  /* ---------- REST v3 ---------- */
  function apiFetch(path, opts) {
    return fetch(Tripo.config.endpoint + path, Object.assign({
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + Tripo.config.apiKey
      }
    }, opts || {}));
  }

  /* v3 trả { code: 0, data: {...} } — code != 0 là lỗi có message */
  function checkV3(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json().then(function (data) {
      if (data && data.code !== undefined && data.code !== 0) {
        throw new Error('Tripo ' + data.code + ': ' + (data.message || data.msg || 'lỗi không rõ'));
      }
      return data;
    });
  }

  function extractTaskId(data) {
    return (data && data.data && data.data.task_id) || (data && data.task_id) || null;
  }
  function extractTask(data) {
    return (data && data.data) || data || {};
  }

  /* Tham số generate chung (text / image / multiview) theo docs v3.
     Panel cũ truyền quality/style/polygon/tex — map sang v3:
       quality 'detailed' → texture_quality detailed; 'draft' → fast
       polygon (số poly) → face_limit
       texture_resolution '1k'/'2k'/'4k' → texture_quality fast/standard/detailed */
  function genParams(params) {
    params = params || {};
    var out = {};
    var model = params.model || params.model_version || DEFAULT_MODEL;
    out.model = MODELS[model] ? model : DEFAULT_MODEL;
    if (params.negative_prompt) out.negative_prompt = params.negative_prompt;
    if (params.texture !== undefined) out.texture = !!params.texture;
    if (params.pbr !== undefined) out.pbr = !!params.pbr;
    var tq = params.texture_quality;
    if (!tq && params.quality === 'detailed') tq = 'detailed';
    if (!tq && params.quality === 'draft') tq = 'fast';
    if (!tq && params.texture_resolution === '4k') tq = 'detailed';
    if (!tq && params.texture_resolution === '1k') tq = 'fast';
    if (tq) out.texture_quality = tq;
    var fl = params.face_limit || params.polygon;
    if (fl) out.face_limit = parseInt(fl, 10);
    if (params.model_seed !== undefined) out.model_seed = params.model_seed;
    if (params.seed !== undefined && params.model_seed === undefined) out.model_seed = parseInt(params.seed, 10) || undefined;
    if (params.texture_seed !== undefined) out.texture_seed = params.texture_seed;
    if (params.quad) out.quad = true;
    if (params.smart_low_poly) out.smart_low_poly = true;
    if (params.geometry_quality) out.geometry_quality = params.geometry_quality;
    return out;
  }

  function createTask(endpoint, payload, task, label) {
    updateTask(task, { state: 'processing', message: 'POST ' + endpoint + ' — ' + label + '…' });
    return apiFetch(endpoint, { method: 'POST', body: JSON.stringify(payload) })
      .then(checkV3)
      .then(function (data) {
        var taskId = extractTaskId(data);
        if (!taskId) throw new Error('Phản hồi không có task_id');
        updateTask(task, { taskId: taskId, message: 'Task id: ' + taskId });
        Tripo.lastCreatedModelId = taskId;
        Tripo.lastCreatedKind = task.type;
        Tripo._poll(task);
        return { ok: true, state: 'processing', task: task };
      })
      .catch(function (err) {
        updateTask(task, { state: 'failed', message: 'Lỗi: ' + err.message });
        bus.emit('notify', { type: 'error', title: 'Tripo AI lỗi', message: err.message });
        return { ok: false, state: 'failed', task: task };
      });
  }

  function needKey() {
    bus.emit('notify', {
      type: 'warning', title: 'Tripo AI — Not connected',
      message: 'Nhập API key trong AI Tools → Backend Settings để kích hoạt thật. Task đang ở trạng thái blocked (không giả lập). Cần key Tripo (platform.tripo3d.ai/api-keys, 300 credit thử) — API v3, không dùng v2 nữa.',
      duration: 9000
    });
  }

  /* ---------- FILE UPLOAD v3: POST /v3/files (multipart) → file_token ---------- */
  Tripo.uploadFile = function (file) {
    var fd = new FormData();
    fd.append('file', file);
    return fetch(Tripo.config.endpoint + '/files', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + Tripo.config.apiKey },
      body: fd
    }).then(checkV3).then(function (data) {
      var d = extractTask(data);
      var token = d.file_token || d.token;
      if (!token) throw new Error('Upload không trả file_token');
      return token;
    });
  };

  /* ---------- TEXT TO 3D (v3) ---------- */
  Tripo.textTo3D = function (params) {
    params = params || {};
    const task = enqueue('text-to-3d', params);
    if (!Tripo.config.connected) { needKey(); return Promise.resolve({ ok: false, state: 'blocked', task: task }); }
    var payload = genParams(params);
    payload.prompt = (params.prompt || '').slice(0, 1024);
    if (!payload.prompt) {
      updateTask(task, { state: 'failed', message: 'Prompt trống' });
      return Promise.resolve({ ok: false, state: 'failed', task: task });
    }
    return createTask('/generation/text-to-model', payload, task, 'Text-to-3D');
  };

  /* ---------- IMAGE TO 3D (v3) ----------
     input: file_token (upload trước qua /v3/files) | URL công khai | task_id ảnh đã tạo */
  Tripo.imageTo3D = function (params) {
    params = params || {};
    const task = enqueue('image-to-3d', { name: params.fileName || params.imageUrl || 'image' });
    if (!Tripo.config.connected) { needKey(); return Promise.resolve({ ok: false, state: 'blocked', task: task }); }

    var inputPromise;
    if (params.imageUrl) inputPromise = Promise.resolve(params.imageUrl);
    else if (params.fileToken) inputPromise = Promise.resolve(params.fileToken);
    else if (params.file) inputPromise = Tripo.uploadFile(params.file);
    else if (params.formData && typeof params.formData.get === 'function' && params.formData.get('file')) {
      inputPromise = Tripo.uploadFile(params.formData.get('file'));
    } else {
      updateTask(task, { state: 'failed', message: 'Thiếu ảnh (file / imageUrl / fileToken)' });
      return Promise.resolve({ ok: false, state: 'failed', task: task });
    }

    updateTask(task, { state: 'processing', message: 'Upload ảnh → /v3/files…' });
    return inputPromise.then(function (input) {
      var payload = genParams(params);
      payload.input = input;
      if (params.enable_image_autofix) payload.enable_image_autofix = true;
      if (params.orientation) payload.orientation = params.orientation;
      return createTask('/generation/image-to-model', payload, task, 'Image-to-3D');
    }).catch(function (err) {
      updateTask(task, { state: 'failed', message: 'Lỗi: ' + err.message });
      bus.emit('notify', { type: 'error', title: 'Tripo AI lỗi', message: err.message });
      return { ok: false, state: 'failed', task: task };
    });
  };

  /* ---------- MULTIVIEW TO 3D (v3, mới) ----------
     inputs: [{front: token|url}, {left: ...}, {back: ...}, {right: ...}]
     front bắt buộc, tối thiểu 2 ảnh. params.files: mảng File theo thứ tự
     [front, left, back, right]; hoặc params.views: [{front: file|url}, ...] */
  Tripo.multiviewTo3D = function (params) {
    params = params || {};
    const task = enqueue('multiview-to-3d', { name: (params.files && params.files.length) + ' views' });
    if (!Tripo.config.connected) { needKey(); return Promise.resolve({ ok: false, state: 'blocked', task: task }); }

    var views = params.views || null;
    var uploadPromise;
    if (views) {
      /* views: [{front: File|string}, {left: ...}] — upload File thành token */
      uploadPromise = Promise.all(views.map(function (v) {
        var key = Object.keys(v)[0];
        var val = v[key];
        if (val instanceof File || (val && val.name && val.size !== undefined)) {
          return Tripo.uploadFile(val).then(function (tok) { var o = {}; o[key] = tok; return o; });
        }
        return Promise.resolve(v);
      }));
    } else if (params.files && params.files.length) {
      var keys = ['front', 'left', 'back', 'right'];
      uploadPromise = Promise.all(params.files.slice(0, 4).map(function (f, i) {
        return Tripo.uploadFile(f).then(function (tok) { var o = {}; o[keys[i]] = tok; return o; });
      }));
    } else if (params.urls && params.urls.length) {
      uploadPromise = Promise.resolve(params.urls.slice(0, 4).map(function (u, i) {
        var o = {}; o[['front', 'left', 'back', 'right'][i]] = u; return o;
      }));
    } else {
      updateTask(task, { state: 'failed', message: 'Cần 2–4 ảnh (files / views / urls), ảnh đầu là mặt trước' });
      return Promise.resolve({ ok: false, state: 'failed', task: task });
    }

    updateTask(task, { state: 'processing', message: 'Upload ' + (params.files ? params.files.length : '') + ' ảnh → /v3/files…' });
    return uploadPromise.then(function (inputs) {
      if (inputs.length < 2) throw new Error('Cần tối thiểu 2 ảnh, ảnh đầu là mặt trước (front)');
      var hasFront = inputs.some(function (o) { return !!o.front; });
      if (!hasFront) throw new Error('Thiếu ảnh mặt trước (front) — ảnh đầu tiên phải là mặt trước');
      var payload = genParams(params);
      payload.inputs = inputs;
      return createTask('/generation/multiview-to-model', payload, task, 'Multiview-to-3D');
    }).catch(function (err) {
      updateTask(task, { state: 'failed', message: 'Lỗi: ' + err.message });
      bus.emit('notify', { type: 'error', title: 'Tripo AI lỗi', message: err.message });
      return { ok: false, state: 'failed', task: task };
    });
  };

  /* ---------- POLLING v3: GET /v3/tasks/{task_id} mỗi 2s ---------- */
  Tripo.getTask = function (taskId) {
    return apiFetch('/tasks/' + encodeURIComponent(taskId)).then(checkV3).then(extractTask);
  };

  Tripo.listTasks = function (taskIds) {
    var ids = taskIds || Tripo.queue.filter(function (t) { return t.taskId; }).map(function (t) { return t.taskId; }).slice(0, 100);
    return apiFetch('/tasks/list', { method: 'POST', body: JSON.stringify({ task_ids: ids }) })
      .then(checkV3).then(extractTask);
  };

  Tripo._poll = function (task) {
    if (!task.taskId) return;
    if (Tripo._pollTimers[task.id]) clearTimeout(Tripo._pollTimers[task.id]);
    var attempts = 0;
    const tick = function () {
      attempts++;
      if (attempts > POLL_MAX) {
        updateTask(task, { state: 'failed', message: 'Hết thời gian chờ (~10 phút) — kiểm tra lại task trên platform.tripo3d.ai' });
        return;
      }
      Tripo.getTask(task.taskId).then(function (d) {
        const st = d.status || '';
        const prog = d.progress !== undefined ? Math.round(d.progress) : 0;
        var credits = d.consumed_credit !== undefined ? d.consumed_credit : (d.credits_consumed !== undefined ? d.credits_consumed : null);
        if (st === 'success') {
          var out = d.output || {};
          var url = out.model_url || out.model || out.pbr_model || null;
          var urls = out.model_urls || (url ? [url] : null);
          updateTask(task, {
            state: 'success', progress: 100,
            message: 'Hoàn tất!' + (credits !== null ? ' · ' + credits + ' credit' : '') + ' · Link tải hết hạn sau 5 phút — tải ngay.',
            resultUrl: url, resultUrls: urls, credits: credits
          });
          if (url && /\.glb(\?|$)/i.test(url) && task.autoImport !== false) {
            /* tải NGAY (link hết hạn sau 5 phút) rồi import vào viewport */
            fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
              PixiStudio.Models.loadGLBFromBuffer(buf, 'AI_Generated', buf.byteLength);
            }).catch(function (e) {
              bus.emit('notify', { type: 'warning', title: 'Tải model AI lỗi', message: 'Link có thể đã hết hạn (5 phút): ' + e.message });
            });
          } else if (url) {
            bus.emit('notify', {
              type: 'success', title: 'Tripo xong — ' + task.type,
              message: 'File sẵn sàng (không phải GLB nên không tự import). Tải trong Generation Queue — link hết hạn sau 5 phút.',
              duration: 8000
            });
          }
        } else if (st === 'failed' || st === 'cancelled' || st === 'banned') {
          updateTask(task, { state: 'failed', message: 'Backend trả về: ' + st + (d.message ? ' — ' + d.message : '') });
        } else {
          updateTask(task, { state: 'processing', progress: Math.min(99, prog), message: 'Backend: ' + st + ' ' + Math.min(99, prog) + '%' });
          Tripo._pollTimers[task.id] = setTimeout(tick, POLL_MS);
        }
      }).catch(function (err) {
        updateTask(task, { state: 'failed', message: 'Polling lỗi: ' + err.message });
      });
    };
    Tripo._pollTimers[task.id] = setTimeout(tick, POLL_MS);
  };

  /* Tải kết quả task về máy (dùng khi không auto-import, vd Convert FBX) */
  Tripo.downloadResult = function (task) {
    if (!task || !task.resultUrl) return Promise.resolve(false);
    return fetch(task.resultUrl).then(function (r) { return r.blob(); }).then(function (b) {
      var ext = (task.resultUrl.match(/\.([a-z0-9]+)(\?|$)/i) || [])[1] || 'glb';
      PixiStudio.U.downloadBlob(b, 'tripo-' + (task.taskId || 'model').slice(0, 8) + '.' + ext.toLowerCase());
      return true;
    }).catch(function (e) {
      bus.emit('notify', { type: 'error', title: 'Tải lỗi', message: e.message + ' (link Tripo hết hạn sau 5 phút)' });
      return false;
    });
  };

  /* ============================================================
     AI MODEL TOOLS (v3) — chạy trên model ĐÃ TẠO (task_id Tripo).
     Chuỗi bằng task_id: generation → texture/convert/decimate/uv/segment
     → rig-check → rig → retarget. Kết quả là model/task mới.
     ============================================================ */
  Tripo.lastCreatedModelId = Tripo.lastCreatedModelId || null;
  Tripo.lastCreatedKind = Tripo.lastCreatedKind || null;

  function needModel(label) {
    bus.emit('notify', {
      type: 'warning', title: label + ' — cần model từ AI',
      message: 'Tool này vận hành model ĐÃ TẠO qua Text/Image/Multiview-to-3D (có task_id Tripo). Hãy tạo model bằng AI Tools trước — model import/upload bên ngoài không có id Tripo.',
      duration: 8000
    });
    return { ok: false };
  }

  function runModelTool(toolName, endpoint, extraParams, label, type) {
    if (!Tripo.config.connected) { needKey(); return { ok: false }; }
    if (Tripo.isXingchi()) {
      bus.emit('notify', {
        type: 'error', title: label + ' — provider không hỗ trợ',
        message: 'xingchiapi là API text/chat (OpenAI-compatible), không có endpoint Tripo v3. Đổi provider sang Tripo3D ở Backend Settings.',
        duration: 10000
      });
      return { ok: false, reason: 'provider-unsupported' };
    }
    const modelId = Tripo.lastCreatedModelId;
    if (!modelId) return needModel(label);
    const task = enqueue(type || toolName, Object.assign({ modelId: modelId }, extraParams || {}));
    var payload = Object.assign({ input: modelId }, extraParams || {});
    return createTask(endpoint, payload, task, label).then(function (r) {
      if (r.ok) bus.emit('notify', { type: 'success', title: label + ' đã gửi', message: 'Đang xử lý trên backend Tripo…' });
      return r;
    });
  }

  /* Texturing — tạo lại PBR texture cho model có sẵn */
  Tripo.textureModel = function (opts) {
    return runModelTool('Texturing', '/models/texture', { texture_quality: (opts && opts.texture_quality) || 'standard' }, 'Texturing', 'texture');
  };

  /* Convert — đổi định dạng: GLTF / FBX / USDZ / OBJ / STL / 3MF */
  Tripo.convertModel = function (format, opts) {
    return runModelTool('Convert ' + (format || 'FBX'), '/models/convert',
      Object.assign({ format: (format || 'FBX').toUpperCase() }, opts || {}), 'Convert ' + (format || 'FBX'), 'convert');
  };

  /* Decimate — giảm số poly (thay cho upscale_model của v2, đã bỏ ở v3) */
  Tripo.decimateModel = function (opts) {
    return runModelTool('Decimate', '/mesh/decimate',
      { face_limit: (opts && (opts.face_limit || opts.polygon)) || 20000 }, 'Decimate', 'decimate');
  };

  /* Smart UV — unwrap/remap UV */
  Tripo.uvModel = function () {
    return runModelTool('Smart UV', '/mesh/uv', {}, 'Smart UV', 'uv');
  };

  /* Segment — tách model thành các part chỉnh sửa được */
  Tripo.segmentModel = function () {
    return runModelTool('Segment', '/mesh/segment', {}, 'Segment', 'segment');
  };

  /* Mesh Complete — vá/lấp lỗ hổng mesh (repair) */
  Tripo.completeModel = function () {
    return runModelTool('Mesh Repair', '/mesh/complete', {}, 'Mesh Repair', 'repair');
  };

  /* Auto Rig — docs: LUÔN rig-check trước, rồi mới rig.
     rig_type lấy từ rig-check (biped/quadruped/...); spec 'mixamo' để
     tương thích Unity/Unreal — skeleton Mixamo dùng chung với studio. */
  Tripo.rigModel = function (opts) {
    opts = opts || {};
    if (!Tripo.config.connected) { needKey(); return Promise.resolve({ ok: false }); }
    if (Tripo.isXingchi()) {
      bus.emit('notify', {
        type: 'error', title: 'Auto Rig — provider không hỗ trợ',
        message: 'xingchiapi không có endpoint rig. Đổi provider sang Tripo3D ở Backend Settings.',
        duration: 10000
      });
      return Promise.resolve({ ok: false, reason: 'provider-unsupported' });
    }
    const modelId = Tripo.lastCreatedModelId;
    if (!modelId) return Promise.resolve(needModel('Auto Rig'));
    const task = enqueue('rig', { modelId: modelId });
    updateTask(task, { state: 'processing', message: 'POST /v3/animations/rig-check…' });
    return apiFetch('/animations/rig-check', { method: 'POST', body: JSON.stringify({ input: modelId }) })
      .then(checkV3).then(function (data) {
        var d = extractTask(data);
        if (!d.riggable) throw new Error('Model không rig được (riggable=false)' + (d.reason ? ': ' + d.reason : ' — thử prompt sạch hơn, tránh pose phức tạp'));
        return d.rig_type || 'biped';
      })
      .then(function (rigType) {
        updateTask(task, { state: 'processing', message: 'Rig-check OK (' + rigType + ') → POST /v3/animations/rig…' });
        var payload = { input: modelId, model: RIG_MODEL, rig_type: rigType, spec: opts.spec || 'mixamo' };
        return createTask('/animations/rig', payload, task, 'Auto Rig');
      })
      .catch(function (err) {
        updateTask(task, { state: 'failed', message: 'Lỗi: ' + err.message });
        bus.emit('notify', { type: 'error', title: 'Auto Rig lỗi', message: err.message });
        return { ok: false, state: 'failed', task: task };
      });
  };

  /* Auto Animate — retarget preset lên model ĐÃ RIG (task rig).
     animations: ['walk','idle','run'] → ['preset:walk', ...] (v3.0 rig). */
  Tripo.animateModel = function (animations, outFormat) {
    if (!Tripo.config.connected) { needKey(); return Promise.resolve({ ok: false }); }
    if (Tripo.isXingchi()) {
      bus.emit('notify', {
        type: 'error', title: 'Auto Animate — provider không hỗ trợ',
        message: 'xingchiapi không có endpoint retarget. Đổi provider sang Tripo3D ở Backend Settings.',
        duration: 10000
      });
      return Promise.resolve({ ok: false, reason: 'provider-unsupported' });
    }
    const modelId = Tripo.lastCreatedModelId;
    if (!modelId) return Promise.resolve(needModel('Auto Animate'));
    if (Tripo.lastCreatedKind !== 'rig') {
      bus.emit('notify', {
        type: 'warning', title: 'Auto Animate — cần model đã rig',
        message: 'Retarget chỉ nhận task_id của model ĐÃ RIG. Hãy bấm Auto Rig trước, đợi xong rồi mới Animate.',
        duration: 8000
      });
      return Promise.resolve({ ok: false, reason: 'not-rigged' });
    }
    const task = enqueue('animate', { modelId: modelId, animations: animations });
    var list = (animations && animations.length ? animations : ['idle', 'walk', 'run']).map(function (a) {
      return a.indexOf('preset:') === 0 ? a : 'preset:' + a;
    });
    var payload = { input: modelId, animations: list, out_format: outFormat || 'glb' };
    return createTask('/animations/retarget', payload, task, 'Auto Animate');
  };

  /* ---------- AI Tools wrapper (nút trong panel) ---------- */
  Tripo.runTool = function (toolId, params) {
    if (!Tripo.config.connected) {
      bus.emit('notify', {
        type: 'warning', title: toolId + ' — Not connected',
        message: 'Tool AI cần backend. Adapter sẵn sàng: AI Tools → Backend Settings → nhập endpoint + API key.',
        duration: 6000
      });
      return;
    }
    switch (toolId) {
      case 'upscale': Tripo.decimateModel(params); break;   /* v2 upscale đã bỏ — v3 dùng Decimate */
      case 'retopology': Tripo.decimateModel(params); break;
      case 'texture': Tripo.textureModel(params); break;
      case 'repair': Tripo.completeModel(); break;
      case 'rig': Tripo.rigModel(params); break;
      case 'animate': Tripo.animateModel(params && params.animations); break;
      case 'convert': Tripo.convertModel(params && params.format || 'FBX'); break;
      case 'segment': Tripo.segmentModel(); break;
      case 'uv': Tripo.uvModel(); break;
    }
  };

  window.PixiStudio.AI = window.PixiStudio.AI || {};
  window.PixiStudio.AI.Tripo = Tripo;
})();
