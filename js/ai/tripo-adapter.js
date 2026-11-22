/* ============================================================
 * ai/tripo-adapter.js — Adapter chuẩn Tripo OpenAPI v2.
 * TRẠNG THÁI TRUNG THỰC: chưa có endpoint+key ⇒ mọi task
 * ở trạng thái 'blocked — not connected'. KHÔNG giả lập kết quả.
 * Khi user nhập key thật → POST/POLL api.tripo3d.ai hoạt động.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;

  const DEFAULT_ENDPOINT = 'https://api.tripo3d.ai/v2/openapi';

  /* Provider mặc định (OpenAI-compatible gateway) — đăng ký sẵn để dùng
   * cho Text-to-3D / Rig / Animate. Endpoint này KHÔNG thay được api.tripo3d.ai. */
  const DEFAULT_PROVIDER = 'xingchiapi';
  const PROVIDERS = {
    tripo: {
      label: 'Tripo3D OpenAPI',
      endpoint: DEFAULT_ENDPOINT,
      docs: 'platform.tripo3d.ai',
      models: ['text_to_model', 'image_to_model', 'texture_model', 'upscale_model', 'rig_model', 'animate_model'],
      supportsRig: true
    },
    xingchiapi: {
      label: 'Xingchi API (OpenAI-compatible)',
      endpoint: 'https://api.xingchiapi.com/v1',
      docs: 'api.xingchiapi.com',
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
      type: type,                       // text-to-3d | image-to-3d | upscale | rig | ...
      params: params,
      state: Tripo.config.connected ? 'queued' : 'blocked',
      progress: 0,
      message: Tripo.config.connected
        ? 'Đã thêm vào queue — chờ backend'
        : 'BLOCKED — chưa kết nối backend AI (cần API key hoặc backend local)',
      taskId: null,
      resultUrl: null,
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

  /* ---------- REST (thật khi connected) ---------- */
  function apiFetch(path, opts) {
    return fetch(Tripo.config.endpoint + path, Object.assign({
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + Tripo.config.apiKey
      }
    }, opts || {}));
  }

  /* ---------- TEXT TO 3D ---------- */
  Tripo.textTo3D = function (params) {
    const task = enqueue('text-to-3d', params);
    if (!Tripo.config.connected) {
      bus.emit('notify', {
        type: 'warning', title: 'Tripo AI — Not connected',
        message: 'Nhập API key trong AI Tools → Backend Settings để kích hoạt Text-to-3D thật. Task đang ở trạng thái blocked (không giả lập).',
        duration: 8000
      });
      return Promise.resolve({ ok: false, state: 'blocked', task: task });
    }

    /* REST thật */
    updateTask(task, { state: 'processing', message: 'POST /task/create — gửi prompt tới Tripo…' });
    return apiFetch('/task/create', {
      method: 'POST',
      body: JSON.stringify({
        type: 'text_to_model',
        prompt: params.prompt || '',
        negative_prompt: params.negative_prompt || '',
        model_version: params.quality === 'draft' ? 'v1.4-20230925' : 'v2.0-20240219',
        texture_quality: params.texture_quality || 'standard',
        format: params.format || 'glb'
      })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      if (data && data.data && data.data.task_id) {
        updateTask(task, { taskId: data.data.task_id, message: 'Task id: ' + data.data.task_id });
        /* LƯU model id — dùng cho Texturing/Upscale/Rig/Animate sau này */
        Tripo.lastCreatedModelId = data.data.task_id;
        Tripo._poll(task);
        return { ok: true, state: 'processing', task: task };
      }
      throw new Error('Phản hồi không mong đợi từ API');
    }).catch(function (err) {
      updateTask(task, { state: 'failed', message: 'Lỗi: ' + err.message });
      bus.emit('notify', { type: 'error', title: 'Tripo AI lỗi', message: err.message });
      return { ok: false, state: 'failed', task: task };
    });
  };

  /* ---------- IMAGE TO 3D ---------- */
  Tripo.imageTo3D = function (params) {
    const task = enqueue('image-to-3d', { name: params.fileName || 'image' });
    if (!Tripo.config.connected) {
      bus.emit('notify', {
        type: 'warning', title: 'Tripo AI — Not connected',
        message: 'Cần API key để Image-to-3D. Ảnh đã lưu vào Reference Library (không giả lập generate).',
        duration: 8000
      });
      return Promise.resolve({ ok: false, state: 'blocked', task: task });
    }

    updateTask(task, { state: 'processing', message: 'Upload image → /upload…' });
    /* upload thật: multipart */
    return fetch(Tripo.config.endpoint + '/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + Tripo.config.apiKey },
      body: params.formData instanceof FormData ? params.formData : (function () {
        const fd = new FormData();
        if (params.file) fd.append('file', params.file);
        return fd;
      })()
    }).then(function (res) { return res.json(); })
      .then(function (data) {
        const token = data && data.data && (data.data.image_token || data.data.token);
        if (!token) throw new Error('Upload thất bại');
        return apiFetch('/task/create', {
          method: 'POST',
          body: JSON.stringify({
            type: 'image_to_model',
            file: { type: 'jpg', token: token }
          })
        }).then(function (r) { return r.json(); });
      })
      .then(function (data) {
        if (data && data.data && data.data.task_id) {
          updateTask(task, { taskId: data.data.task_id });
          Tripo.lastCreatedModelId = data.data.task_id;
          Tripo._poll(task);
          return { ok: true, state: 'processing', task: task };
        }
        throw new Error('Create task thất bại');
      })
      .catch(function (err) {
        updateTask(task, { state: 'failed', message: 'Lỗi: ' + err.message });
        bus.emit('notify', { type: 'error', title: 'Tripo AI lỗi', message: err.message });
        return { ok: false, state: 'failed', task: task };
      });
  };

  /* ---------- POLLING task ---------- */
  Tripo._poll = function (task) {
    if (!task.taskId) return;
    if (Tripo._pollTimers[task.id]) clearTimeout(Tripo._pollTimers[task.id]);
    const tick = function () {
      apiFetch('/task/' + task.taskId).then(function (r) { return r.json(); }).then(function (data) {
        const st = data && data.data ? data.data.status : '';
        const prog = data && data.data ? (data.data.progress || 0) : 0;
        if (st === 'success' || st === 'queued_success') {
          const url = data.data.output && (data.data.output.pbr_model || data.data.output.model || data.data.output.url);
          updateTask(task, { state: 'success', progress: 100, message: 'Hoàn tất!', resultUrl: url });
          if (url) {
            /* tải model về và import */
            fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
              PixiStudio.Models.loadGLBFromBuffer(buf, 'AI_Generated', buf.byteLength);
            });
          }
        } else if (st === 'failed' || st === 'cancelled' || st === 'banned') {
          updateTask(task, { state: 'failed', message: 'Backend trả về: ' + st });
        } else {
          updateTask(task, { state: 'processing', progress: Math.round(prog), message: 'Backend: ' + st + ' ' + Math.round(prog) + '%' });
          Tripo._pollTimers[task.id] = setTimeout(tick, 3000);
        }
      }).catch(function (err) {
        updateTask(task, { state: 'failed', message: 'Polling lỗi: ' + err.message });
      });
    };
    Tripo._pollTimers[task.id] = setTimeout(tick, 3000);
  };

  /* ============================================================
     AI MODEL TOOLS — Texturing / Upscale / Auto Rig / Animate
     Chạy THẬT qua Tripo REST khi connected (cần task_id của model
     đã tạo qua Text/Image-to-3D). Polling như các task khác.
     ============================================================ */
  Tripo.lastCreatedModelId = Tripo.lastCreatedModelId || null;

  function runModelTool(toolName, taskType, extraParams, label) {
    if (!Tripo.config.connected) {
      bus.emit('notify', {
        type: 'warning', title: label + ' — Not connected',
        message: 'Nhập API key trong AI Tools → Backend Settings. Không giả lập kết quả.',
        duration: 6000
      });
      return { ok: false };
    }
    if (Tripo.isXingchi() && (taskType === 'rig_model' || taskType === 'animate_model')) {
      bus.emit('notify', {
        type: 'error', title: label + ' — provider không hỗ trợ',
        message: 'xingchiapi là API text/chat (OpenAI-compatible), không có endpoint rig_model / animate_model. Đổi provider sang Tripo3D ở Backend Settings.',
        duration: 10000
      });
      return { ok: false, reason: 'provider-unsupported' };
    }
    const modelId = Tripo.lastCreatedModelId;
    if (!modelId) {
      bus.emit('notify', {
        type: 'warning', title: label + ' — cần model từ AI',
        message: 'Tool này vận hành model ĐÃ TẠO qua Text/Image-to-3D (có task_id Tripo). Hãy tạo model bằng AI Tools trước — model import/upload bên ngoài không có id Tripo.',
        duration: 8000
      });
      return { ok: false };
    }
    const task = enqueue(taskType, Object.assign({ modelId: modelId }, extraParams || {}));
    updateTask(task, { state: 'processing', message: 'POST /task/create — ' + label + ' trên model ' + modelId + '…' });
    const payload = Object.assign({ type: taskType, original_model_id: modelId }, extraParams || {});
    apiFetch('/task/create', {
      method: 'POST',
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      if (data && data.data && data.data.task_id) {
        updateTask(task, { taskId: data.data.task_id, message: label + ' — task ' + data.data.task_id });
        Tripo.lastCreatedModelId = data.data.task_id;   /* kết quả là model mới — chain tiếp được */
        Tripo._poll(task);
        bus.emit('notify', { type: 'success', title: label + ' đã gửi', message: 'Đang xử lý trên backend Tripo…' });
        return { ok: true };
      }
      throw new Error('Phản hồi không mong đợi');
    }).catch(function (err) {
      updateTask(task, { state: 'failed', message: 'Lỗi: ' + err.message });
      bus.emit('notify', { type: 'error', title: label + ' lỗi', message: err.message });
      return { ok: false };
    });
    return { ok: true, task: task };
  }

  /* Texturing — tạo PBR texture cho model có sẵn */
  Tripo.textureModel = function (opts) {
    return runModelTool('Texturing', 'texture_model', Object.assign({ texture_quality: 'standard' }, opts || {}), 'Texturing');
  };

  /* Upscale — tăng độ phân giải model 4x */
  Tripo.upscaleModel = function (opts) {
    return runModelTool('3D Model Upscale', 'upscale_model', opts || {}, 'Upscale');
  };

  /* Auto Rig — sinh skeleton cho model */
  Tripo.rigModel = function (opts) {
    return runModelTool('Auto Rig', 'rig_model', opts || {}, 'Auto Rig');
  };

  /* Auto Animate — cần rig trước; animations: mảng tên preset Tripo */
  Tripo.animateModel = function (animations) {
    return runModelTool('Auto Animate', 'animate_model', {
      animation: animations || ['idle', 'walk', 'run']
    }, 'Auto Animate');
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
      case 'upscale': Tripo.upscaleModel(params); break;
      case 'retopology': enqueue('retopology', params); break;
      case 'texture': Tripo.textureModel(params); break;
      case 'repair': enqueue('mesh-repair', params); break;
      case 'rig': Tripo.rigModel(params); break;
      case 'animate': Tripo.animateModel(params && params.animations); break;
    }
  };

  window.PixiStudio.AI = window.PixiStudio.AI || {};
  window.PixiStudio.AI.Tripo = Tripo;
})();
