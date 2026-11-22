/* ============================================================
 * ai/meshy-adapter.js — Meshy API adapter (v20.1)
 *
 * Meshy public API (docs.meshy.ai/en/api/*, kiểm chứng 2026-11-22):
 *   Base: https://api.meshy.ai
 *   Auth: Authorization: Bearer <key msy_...> (tạo trong Meshy account settings)
 *   Mọi task đều async: POST → { result: "<task_id>" } → poll GET .../{id}
 *   tới SUCCEEDED / FAILED / CANCELED. File kết quả hết hạn sau ~3 ngày.
 *
 *   POST /openapi/v1/rigging        rig humanoid/quadruped (5 credits)
 *   POST /openapi/v1/animations      áp 1–10 preset (action_ids) hoặc clip
 *                                    Text to Motion lên rig (3 cr/action)
 *   POST /openapi/v1/text-to-motion  prompt → clip FBX (prime, 10 cr)
 *                                    hoặc BVH (swift, 3 cr); prompt ≤400 ký
 *                                    tự, duration 2–10s bước 0.5s
 *   GET  /openapi/v1/animations/library  631 preset + preview GIF
 *   GET  /openapi/v1/balance         số dư credit
 *
 * Không có key → mọi thao tác ở trạng thái `blocked`, không giả lập.
 * Key chỉ lưu ở localStorage trình duyệt, không hardcode, không đẩy lên repo.
 * Free plan gọi API → 402 (API cần gói trả phí) — adapter báo rõ lỗi đó.
 * ============================================================ */
(function () {
  'use strict';

  var bus = PixiStudio.bus;

  var Meshy = {
    config: { endpoint: 'https://api.meshy.ai', apiKey: '', connected: false },
    tasks: [],
    lastRigTaskId: null,
    lastMotionTaskId: null,
    _library: null,
    _pollTimers: {}
  };

  /* ---------- credits (docs chính thức, 2026-11-22) ---------- */
  Meshy.CREDITS = { rigging: 5, animationPerAction: 3, textToMotionPrime: 10, textToMotionSwift: 3 };
  Meshy.SKELETON_TEMPLATES = ['meshyrig', 'mixamo', 'ue5_mannequin', 'max_biped', 'unity_humanoid', 'maya_human_ik', 'blender_rigify_basic_human', 'cc5_hd_neutral_base', 'daz_genesis9'];
  Meshy.LIBRARY_CATEGORIES = ['WalkAndRun', 'DailyActions', 'Dancing', 'Fighting', 'BodyMovements'];

  /* ---------- persistence ---------- */
  Meshy.serialize = function () {
    try { localStorage.setItem('pixiStudio.meshy', JSON.stringify({ endpoint: Meshy.config.endpoint, apiKey: Meshy.config.apiKey })); } catch (e) {}
  };
  Meshy.deserialize = function () {
    try {
      var raw = localStorage.getItem('pixiStudio.meshy');
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d.endpoint) Meshy.config.endpoint = d.endpoint;
      if (d.apiKey) { Meshy.config.apiKey = d.apiKey; Meshy.config.connected = true; }
    } catch (e) {}
  };

  Meshy.connect = function (endpoint, apiKey) {
    Meshy.config.endpoint = (endpoint || 'https://api.meshy.ai').replace(/\/$/, '');
    Meshy.config.apiKey = (apiKey || '').trim();
    Meshy.config.connected = !!Meshy.config.apiKey;
    Meshy.serialize();
    bus.emit('notify', Meshy.config.connected
      ? { type: 'success', title: 'Meshy đã kết nối', message: 'API key đã lưu (chỉ ở trình duyệt này).' }
      : { type: 'warning', title: 'Meshy chưa kết nối', message: 'Nhập API key msy_… để dùng Rigging / Text to Motion cloud.' });
    return Meshy.config.connected;
  };
  Meshy.disconnect = function () {
    Meshy.config.apiKey = '';
    Meshy.config.connected = false;
    try { localStorage.removeItem('pixiStudio.meshy'); } catch (e) {}
  };
  Meshy.status = function () {
    return { connected: Meshy.config.connected, endpoint: Meshy.config.endpoint, apiVersion: 'v1', hasKey: !!Meshy.config.apiKey };
  };

  /* ---------- low-level ---------- */
  function headers() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Meshy.config.apiKey };
  }
  function checkV1(res, data) {
    if (!res.ok) {
      var msg = 'HTTP ' + res.status;
      if (res.status === 401) msg = 'API key sai hoặc hết hạn (401)';
      if (res.status === 402) msg = 'Free plan không gọi được API — cần gói Meshy trả phí (402)';
      if (res.status === 422) msg = 'Model không rig được (422): cần humanoid rõ tay chân, mặt +Z, ≤380k tris';
      if (data && data.message) msg += ' — ' + data.message;
      throw new Error(msg);
    }
    return data;
  }
  function newTask(kind, label) {
    var task = { id: 'meshy_' + Date.now() + '_' + Math.floor(Math.random() * 1e6), kind: kind, label: label || kind, state: 'created', progress: 0, createdAt: Date.now() };
    Meshy.tasks.unshift(task);
    if (Meshy.tasks.length > 40) Meshy.tasks.length = 40;
    return task;
  }
  function emitTask(task) { bus.emit('meshy:task', { id: task.id, kind: task.kind, state: task.state, progress: task.progress, result: task.result || null, error: task.error || null }); }

  /* Poll một Meshy task: GET {endpoint}{path}/{id} mỗi 3s tới khi xong.
     Trả về task đã cập nhật (state SUCCEEDED/FAILED/CANCELED). */
  Meshy._poll = function (task, path) {
    var tries = 0, maxTries = 200; /* ~10 phút */
    return new Promise(function (resolve) {
      var tick = function () {
        tries++;
        fetch(Meshy.config.endpoint + path + '/' + task.taskId, { headers: headers() })
          .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
          .then(function (o) {
            var d = checkV1(o.r, o.d);
            var st = d.status || d.state || 'PENDING';
            task.state = st.toLowerCase() === 'succeeded' ? 'success' : st.toLowerCase() === 'failed' ? 'failed' : st.toLowerCase() === 'canceled' ? 'failed' : 'processing';
            task.progress = d.progress != null ? d.progress : (task.state === 'processing' ? Math.min(95, task.progress + 5) : 100);
            task.result = d.result || d;
            if (d.consumed_credits != null) task.credits = d.consumed_credits;
            emitTask(task);
            if (task.state === 'success' || task.state === 'failed' || tries >= maxTries) {
              if (tries >= maxTries && task.state === 'processing') { task.state = 'failed'; task.error = 'Hết thời gian chờ (~10 phút)'; }
              if (task.state === 'failed' && !task.error) task.error = (d.message || d.error || 'Task thất bại');
              emitTask(task);
              resolve(task);
              return;
            }
            Meshy._pollTimers[task.id] = setTimeout(tick, 3000);
          })
          .catch(function (e) {
            task.state = 'failed'; task.error = e.message; emitTask(task); resolve(task);
          });
      };
      tick();
    });
  };

  function createTask(path, payload, task, label) {
    if (!Meshy.config.connected) {
      task.state = 'blocked';
      bus.emit('notify', { type: 'warning', title: 'Meshy chưa kết nối', message: 'Nhập API key Meshy (msy_…) trong Animate Studio → Meshy Cloud để chạy ' + label + '.' });
      emitTask(task);
      return Promise.resolve(task);
    }
    task.state = 'processing';
    emitTask(task);
    return fetch(Meshy.config.endpoint + path, { method: 'POST', headers: headers(), body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
      .then(function (o) {
        var d = checkV1(o.r, o.d);
        var tid = (d.result && typeof d.result === 'string') ? d.result : (d.result && d.result.task_id) || d.task_id || d.id;
        if (!tid) throw new Error('Meshy không trả task_id');
        task.taskId = tid;
        return Meshy._poll(task, path);
      })
      .catch(function (e) {
        task.state = 'failed'; task.error = e.message; emitTask(task);
        bus.emit('notify', { type: 'error', title: 'Meshy ' + label + ' lỗi', message: e.message });
        return task;
      });
  }

  /* ---------- Rigging ---------- */
  /* opts: { modelUrl | inputTaskId, animationType 'biped'|'quadruped',
             heightMeters, skeletonTemplate, includeFingers } */
  Meshy.rigModel = function (opts) {
    opts = opts || {};
    var task = newTask('rigging', 'Meshy Rigging');
    if (!opts.modelUrl && !opts.inputTaskId) {
      task.state = 'failed'; task.error = 'Cần model_url (GLB) hoặc input_task_id';
      emitTask(task); return Promise.resolve(task);
    }
    var payload = {
      animation_type: opts.animationType || 'biped',
      skeleton_template: opts.skeletonTemplate || 'mixamo',
      include_fingers: !!opts.includeFingers
    };
    if (opts.modelUrl) payload.model_url = opts.modelUrl;
    if (opts.inputTaskId) payload.input_task_id = opts.inputTaskId;
    if (opts.heightMeters != null) payload.height_meters = opts.heightMeters;
    return createTask('/openapi/v1/rigging', payload, task, 'Rigging').then(function (t) {
      if (t.state === 'success' && t.taskId) Meshy.lastRigTaskId = t.taskId;
      return t;
    });
  };

  /* ---------- Animations (áp preset / clip lên rig) ---------- */
  /* opts: { rigTaskId, actionId | actionIds[1..10] | motionTaskId } */
  Meshy.applyAnimation = function (opts) {
    opts = opts || {};
    var task = newTask('animation', 'Meshy Animation');
    var rigTaskId = opts.rigTaskId || Meshy.lastRigTaskId;
    if (!rigTaskId) {
      task.state = 'failed'; task.error = 'Chưa có rig task — rig model bằng Meshy trước (hoặc nhập rig_task_id).';
      emitTask(task); return Promise.resolve(task);
    }
    var payload = { rig_task_id: rigTaskId };
    var n = 0;
    if (opts.actionId != null) { payload.action_id = opts.actionId; n = 1; }
    else if (opts.actionIds && opts.actionIds.length) {
      if (opts.actionIds.length > 10) { task.state = 'failed'; task.error = 'Tối đa 10 action/request'; emitTask(task); return Promise.resolve(task); }
      payload.action_ids = opts.actionIds; n = opts.actionIds.length;
    } else if (opts.motionTaskId) { payload.motion_task_id = opts.motionTaskId; n = 1; }
    else { task.state = 'failed'; task.error = 'Cần action_id, action_ids hoặc motion_task_id'; emitTask(task); return Promise.resolve(task); }
    task.actionCount = n;
    return createTask('/openapi/v1/animations', payload, task, 'Animation');
  };

  /* ---------- Text to Motion ---------- */
  /* opts: { prompt (≤400 ký tự), mode 'prime'|'swift', duration 2–10 bước 0.5 } */
  Meshy.textToMotion = function (opts) {
    opts = opts || {};
    var task = newTask('text-to-motion', 'Meshy Text to Motion');
    var prompt = String(opts.prompt || '').trim();
    if (!prompt) { task.state = 'failed'; task.error = 'Nhập prompt mô tả động tác'; emitTask(task); return Promise.resolve(task); }
    if (prompt.length > 400) { task.state = 'failed'; task.error = 'Prompt tối đa 400 ký tự (hiện ' + prompt.length + ')'; emitTask(task); return Promise.resolve(task); }
    var dur = parseFloat(opts.duration);
    if (!isFinite(dur)) dur = 4;
    dur = Math.max(2, Math.min(10, Math.round(dur * 2) / 2)); /* kẹp 2–10, bước 0.5 */
    var payload = { prompt: prompt, mode: opts.mode === 'swift' ? 'swift' : 'prime', duration: dur };
    task.prompt = prompt; task.duration = dur; task.mode = payload.mode;
    task.creditsEstimate = payload.mode === 'swift' ? Meshy.CREDITS.textToMotionSwift : Meshy.CREDITS.textToMotionPrime;
    return createTask('/openapi/v1/text-to-motion', payload, task, 'Text to Motion').then(function (t) {
      if (t.state === 'success' && t.taskId) Meshy.lastMotionTaskId = t.taskId;
      return t;
    });
  };

  /* Lấy URL file kết quả trong result (Meshy trả nhiều tên field khác nhau
     theo từng endpoint — quét mọi field *_url, ưu tiên fbx/glb). */
  Meshy.resultFileUrl = function (task) {
    var r = (task && task.result) || {};
    var flat = {};
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (typeof v === 'string' && /^https?:\/\//.test(v)) flat[k] = v;
        else if (v && typeof v === 'object') walk(v);
      });
    })(r);
    var pref = ['fbx_url', 'rigged_character_fbx_url', 'glb_url', 'rigged_character_glb_url', 'motion_url', 'url', 'download_url', 'file_url'];
    for (var i = 0; i < pref.length; i++) if (flat[pref[i]]) return flat[pref[i]];
    var keys = Object.keys(flat);
    return keys.length ? flat[keys[0]] : null;
  };

  /* Áp clip Text to Motion (FBX) lên rig hiện tại qua M2MMotion retarget.
     Cần THREE.FBXLoader (CDN) — chưa có thì trả về link tải để dùng tay. */
  Meshy.applyTextToMotion = function (task) {
    var url = Meshy.resultFileUrl(task);
    if (!url) {
      bus.emit('notify', { type: 'warning', title: 'Text to Motion', message: 'Task xong nhưng không tìm thấy file kết quả — xem task trên Meshy.' });
      return Promise.resolve(null);
    }
    if (!window.THREE || !THREE.FBXLoader) {
      bus.emit('notify', { type: 'info', title: 'Text to Motion xong', message: 'Clip FBX đã sẵn sàng — tải file để dùng (cần FBXLoader để áp trực tiếp lên rig).', duration: 8000 });
      return Promise.resolve({ url: url, needsFbxLoader: true });
    }
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(function (buf) {
        var loader = new THREE.FBXLoader();
        var scene = loader.parse(buf, '');
        var clip = (scene.animations && scene.animations[0]) || null;
        if (!clip) throw new Error('FBX không có animation clip');
        var rest = {};
        scene.updateMatrixWorld(true);
        scene.traverse(function (o) { if (o.name) rest[o.name] = o.quaternion.clone(); });
        if (PixiStudio.M2MMotion && PixiStudio.M2MMotion.playClip) {
          return PixiStudio.M2MMotion.playClip({ clip: clip, rest: rest, scene: scene }, 'Meshy: ' + (task.prompt || 'text-to-motion'));
        }
        throw new Error('M2MMotion.playClip chưa sẵn sàng');
      })
      .catch(function (e) {
        bus.emit('notify', { type: 'error', title: 'Áp clip Text to Motion lỗi', message: e.message + ' — file FBX: ' + url });
        return { url: url, error: e.message };
      });
  };

  /* ---------- Library + Balance ---------- */
  Meshy.getLibrary = function (force) {
    if (Meshy._library && !force) return Promise.resolve(Meshy._library);
    if (!Meshy.config.connected) return Promise.resolve(null);
    return fetch(Meshy.config.endpoint + '/openapi/v1/animations/library', { headers: headers() })
      .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
      .then(function (o) {
        var d = checkV1(o.r, o.d);
        var list = d.animations || d.result || d.data || [];
        Meshy._library = Array.isArray(list) ? list : [];
        return Meshy._library;
      })
      .catch(function (e) {
        bus.emit('notify', { type: 'error', title: 'Meshy Library lỗi', message: e.message });
        return null;
      });
  };

  Meshy.getBalance = function () {
    if (!Meshy.config.connected) return Promise.resolve(null);
    return fetch(Meshy.config.endpoint + '/openapi/v1/balance', { headers: headers() })
      .then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
      .then(function (o) { var d = checkV1(o.r, o.d); return d; })
      .catch(function (e) {
        bus.emit('notify', { type: 'error', title: 'Meshy Balance lỗi', message: e.message });
        return null;
      });
  };

  Meshy.getTask = function (taskId) {
    return Meshy.tasks.find(function (t) { return t.id === taskId || t.taskId === taskId; }) || null;
  };

  Meshy.deserialize();
  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.Meshy = Meshy;
})();
