/* ============================================================
 * animation/anim-prompt.js — Animation AI Gen Prompt (Pro, local)
 * v20.1 — kiểu Meshy "Text to Motion" nhưng chạy local, không cần key.
 *
 * Meshy Text to Motion: 1 prompt → 1 clip cloud (≤400 ký tự, 2–10s).
 * Prompt Engine này làm mạnh hơn ở phía local:
 *   • Parse 1 prompt thành TIMELINE nhiều hành động nối tiếp
 *     ("runs forward, swings a sword twice, then returns to idle"
 *      → Run → Attack ×2 → Idle), kèm số lần lặp và thời lượng từng bước.
 *   • Style modifier: heroic / tired / angry / happy / slow / fast
 *     → tốc độ phát toàn timeline.
 *   • Negative prompt: loại bước khớp từ cấm (vd "no jumping" bỏ Jump).
 *   • Map sang clip THẬT có sẵn: AutoGen (10) → Preset (16) → FBX (3)
 *     → M2M library (tìm theo tên). Bước nào không có clip → ghi vào
 *     `unmatched` và báo rõ, không tự bịa chuyển động.
 *   • Lưu prompt thành preset (localStorage) để dùng lại.
 * Clip cloud thật (Meshy Text to Motion) vẫn qua PixiStudio.Meshy.
 * ============================================================ */
(function () {
  'use strict';

  var bus = PixiStudio.bus;

  /* Thứ tự quan trọng: combo/punch/kick/heavy phải check trước attack */
  var ACTIONS = [
    { re: /combo|liên hoàn|lien hoan|jab[\s-]?cross|jab cross|chain hit/i, source: 'autogen', clipId: 'Combo', label: 'Combo', loop: false },
    { re: /heavy|smash|đập|dap|chém mạnh|chem manh/i, source: 'preset', clipId: 'heavyAttack', label: 'Heavy Attack', loop: false },
    { re: /punch|jab|hook|uppercut|đấm|\bdam\b/i, source: 'autogen', clipId: 'Punch', label: 'Punch', loop: false },
    { re: /kick|đá|\bda\b/i, source: 'autogen', clipId: 'Kick', label: 'Kick', loop: false },
    { re: /attack|slash|sword|strike|đánh|\bdanh\b|chém|\bchem\b/i, source: 'autogen', clipId: 'Attack', label: 'Attack', loop: false },
    { re: /block|parry|đỡ|\bdo\b|chặn|chan|guard/i, source: 'preset', clipId: 'block', label: 'Block', loop: true },
    { re: /dodge|roll|né|\bne\b|lăn|\blan\b|evade/i, source: 'autogen', clipId: 'Dodge', label: 'Dodge', loop: false },
    { re: /run|sprint|jog|chạy|\bchay\b/i, source: 'autogen', clipId: 'Run', label: 'Run', loop: true },
    { re: /walk|đi bộ|di bo|\bđi\b|stroll|bước|buoc/i, source: 'autogen', clipId: 'Walk', label: 'Walk', loop: true },
    { re: /jump|nhảy lên|nhay len|nhảy qua|nhay qua|leap|\bhop(s|ping)?\b/i, source: 'preset', clipId: 'jump', label: 'Jump', loop: false },
    { re: /dance|nhảy múa|nhay mua|groove/i, source: 'preset', clipId: 'dance', label: 'Dance', loop: true },
    { re: /victory|win|cheer|chiến thắng|chien thang|ăn mừng|an mung|celebrat/i, source: 'preset', clipId: 'victory', label: 'Victory', loop: true },
    { re: /wav|vẫy|vay|wave/i, source: 'autogen', clipId: 'Wave', label: 'Wave', loop: true },
    { re: /\bbow(s|ed|ing)?\b|cúi chào|cui chao|greet|\bchào\b|chao\b/i, source: 'autogen', clipId: 'Bow', label: 'Bow', loop: false },
    { re: /magic|spell|cast|phép|phep|skill|fireball/i, source: 'preset', clipId: 'magic', label: 'Magic', loop: false },
    { re: /\bhit(s|ting)?\b|hurt|trúng đòn|trung don|bị đánh|bi danh|stagger/i, source: 'preset', clipId: 'hit', label: 'Hit Reaction', loop: false },
    { re: /\bdie(s|d)?\b|death|chết|\bchet\b|gục|guc|fall down/i, source: 'preset', clipId: 'death', label: 'Death', loop: false },
    { re: /idle|stand|breath|đứng|\bdung\b|nghỉ|\bnghi\b|wait|chờ|\bcho\b|relax/i, source: 'autogen', clipId: 'Idle', label: 'Idle', loop: true }
  ];

  var STYLES = [
    { re: /heroic|anh hùng|anh hung|brave|dũng cảm|dung cam/i, id: 'heroic', label: 'Heroic', speed: 1.0 },
    { re: /tired|mệt|met|exhausted|kiệt sức|kiet suc|weary/i, id: 'tired', label: 'Tired', speed: 0.7 },
    { re: /angry|giận|gian|furious|tức giận|tuc gian|rage/i, id: 'angry', label: 'Angry', speed: 1.25 },
    { re: /happy|vui|joyful|cheerful|hào hứng|hao hung/i, id: 'happy', label: 'Happy', speed: 1.15 },
    { re: /slow|chậm|cham|slowly/i, id: 'slow', label: 'Slow', speed: 0.6 },
    { re: /fast|quick|nhanh|hurry|vội|voi/i, id: 'fast', label: 'Fast', speed: 1.35 },
    { re: /sneak|lén|lẹn|stealth|trộm|trom/i, id: 'sneaky', label: 'Sneaky', speed: 0.8 }
  ];

  var SPLIT_RE = /[,;]|\bthen\b|\bsau đó\b|\brồi\b|\btiếp theo\b|\s+and\s+|\svà\s+/i;

  /* Thời lượng clip gốc (giây) — dùng khi segment không ghi thời lượng */
  var BASE_DUR = {
    'autogen:Idle': 2.6, 'autogen:Walk': 1.0, 'autogen:Run': 0.7, 'autogen:Attack': 0.8,
    'autogen:Combo': 1.4, 'autogen:Dodge': 0.6, 'autogen:Wave': 2.0, 'autogen:Punch': 1.2,
    'autogen:Kick': 1.0, 'autogen:Bow': 1.4,
    'preset:jump': 1.2, 'preset:heavyAttack': 1.4, 'preset:block': 1.5, 'preset:dance': 2.5,
    'preset:victory': 2.0, 'preset:magic': 1.8, 'preset:hit': 0.8, 'preset:death': 2.2
  };

  function parseRepeats(seg) {
    var m = seg.match(/(\d+)\s*(?:times|lần|lan|x)\b/i);
    if (m) return Math.max(1, Math.min(8, parseInt(m[1], 10)));
    if (/\btwice\b|hai lần|2 lần/i.test(seg)) return 2;
    if (/\bthree times\b|ba lần|3 lần/i.test(seg)) return 3;
    if (/\bfour times\b|bốn lần|4 lần/i.test(seg)) return 4;
    return 1;
  }
  function parseDuration(seg) {
    var m = seg.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|seconds|giây|giay)\b/i);
    return m ? parseFloat(m[1]) : null;
  }
  function detectStyle(text) {
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].re.test(text)) return STYLES[i];
    return { id: 'normal', label: 'Normal', speed: 1 };
  }
  function negativeWords(negative) {
    return String(negative || '').toLowerCase().split(/[,; ]+/).filter(function (w) { return w.length > 2; });
  }

  var Prompt = {
    actions: ACTIONS,
    styles: STYLES,
    EXAMPLES: [
      { text: 'a character waving', note: 'Ví dụ chính thức của Meshy' },
      { text: 'a boxer throws a jab-cross combo', note: 'Ví dụ Meshy MCP' },
      { text: 'jumps over a gap and lands in a crouch', note: 'Ví dụ Meshy MCP · 4s' },
      { text: 'a heroic warrior runs forward, swings a sword twice, then returns to idle', note: 'Timeline 3 bước' },
      { text: 'chiến binh chạy tới, chém kiếm hai lần rồi đứng nghỉ', note: 'Tiếng Việt · 3 bước' }
    ]
  };

  /* Parse prompt → timeline. opts: { duration (tổng giây, scale toàn bộ),
     style (id ép buộc), negative } */
  Prompt.parse = function (prompt, opts) {
    opts = opts || {};
    var text = String(prompt || '').trim();
    var out = { prompt: text, steps: [], unmatched: [], warnings: [], totalDuration: 0, style: null };
    if (!text) { out.warnings.push('Prompt trống.'); return out; }
    var style = opts.style ? (STYLES.filter(function (s) { return s.id === opts.style; })[0] || detectStyle(text)) : detectStyle(text);
    out.style = { id: style.id, label: style.label, speed: style.speed };
    var negs = negativeWords(opts.negative);
    var segments = text.split(SPLIT_RE).map(function (s) { return s.trim(); }).filter(Boolean);
    segments.forEach(function (seg) {
      /* negative prompt: bỏ bước khớp từ cấm (so theo gốc 4 ký tự để
         "jumping" chặn được "jump", "frozen" chặn được "freeze") */
      var blocked = negs.some(function (w) { return seg.toLowerCase().indexOf(w.slice(0, 4)) >= 0; });
      if (blocked) { out.warnings.push('Bỏ "' + seg + '" vì trùng negative prompt.'); return; }
      var hit = null;
      for (var i = 0; i < ACTIONS.length; i++) {
        if (ACTIONS[i].re.test(seg)) { hit = ACTIONS[i]; break; }
      }
      if (!hit) { out.unmatched.push(seg); return; }
      var repeats = parseRepeats(seg);
      var explicit = parseDuration(seg);
      var base = BASE_DUR[hit.source + ':' + hit.clipId] || 1.5;
      var dur = explicit != null ? explicit : base * repeats;
      out.steps.push({
        source: hit.source, clipId: hit.clipId, label: hit.label,
        duration: +dur.toFixed(2), loop: hit.loop, speed: style.speed, repeats: repeats
      });
    });
    if (!out.steps.length) {
      out.warnings.push('Không map được hành động nào — thử: run, attack, wave, dance, jump, punch, kick, bow…');
      return out;
    }
    /* Duration tổng (kiểu Meshy 2–10s): scale toàn bộ bước cho khớp */
    if (opts.duration && isFinite(opts.duration) && opts.duration > 0) {
      var sum = out.steps.reduce(function (s, st) { return s + st.duration / st.speed; }, 0);
      var k = opts.duration / sum;
      out.steps.forEach(function (st) { st.duration = +Math.max(0.3, st.duration * k).toFixed(2); });
    }
    out.totalDuration = +out.steps.reduce(function (s, st) { return s + st.duration / st.speed; }, 0).toFixed(2);
    if (out.unmatched.length) out.warnings.push('Chưa có clip cho: ' + out.unmatched.join(' · ') + ' (đã bỏ qua, các bước khác vẫn phát).');
    return out;
  };

  /* Tìm clip M2M theo tên (khi prompt nhắc motion có trong thư viện 326 clip) */
  Prompt.findM2M = function (name) {
    var M = PixiStudio.M2MMotion;
    if (!M || !M.catalog) return null;
    var q = String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '');
    var best = null;
    Object.keys(M.catalog.rigs || {}).forEach(function (rigId) {
      (M.catalog.rigs[rigId].animations || []).forEach(function (m) {
        var n = m.name.toLowerCase();
        if (n.indexOf(q) >= 0 || q.indexOf(n) >= 0) {
          if (!best || m.name.length < best.name.length) best = { rigId: rigId, name: m.name, url: m.url, duration: m.duration, loop: m.loop, rootMotion: m.rootMotion };
        }
      });
    });
    return best;
  };

  /* Phát timeline qua AnimQueue (clear rồi phát từ đầu) */
  Prompt.play = function (parsed) {
    var Q = PixiStudio.AnimQueue;
    if (!Q) return false;
    if (!parsed || !parsed.steps.length) {
      bus.emit('notify', { type: 'warning', title: 'AI Animation Prompt', message: 'Chưa parse được bước nào — nhập prompt khác.' });
      return false;
    }
    Q.clear();
    parsed.steps.forEach(function (st) {
      Q.add({ source: st.source, clipId: st.clipId, label: st.label + (st.repeats > 1 ? ' ×' + st.repeats : ''), duration: st.duration, loop: st.loop, speed: st.speed });
    });
    var ok = Q.playAll(0);
    if (ok) bus.emit('notify', { type: 'success', title: 'Prompt timeline đang phát', message: parsed.steps.length + ' bước · ' + parsed.totalDuration + 's · style ' + parsed.style.label });
    return ok;
  };

  /* Chỉ add vào queue (không phát) — dùng cho tab Added */
  Prompt.enqueue = function (parsed) {
    var Q = PixiStudio.AnimQueue;
    if (!Q || !parsed || !parsed.steps.length) return 0;
    parsed.steps.forEach(function (st) {
      Q.add({ source: st.source, clipId: st.clipId, label: st.label + (st.repeats > 1 ? ' ×' + st.repeats : ''), duration: st.duration, loop: st.loop, speed: st.speed });
    });
    bus.emit('notify', { type: 'success', title: 'Đã thêm vào Added', message: parsed.steps.length + ' bước từ prompt.' });
    return parsed.steps.length;
  };

  /* ---------- Prompt presets (localStorage) ---------- */
  var STORE_KEY = 'pixiStudio.promptPresets';
  Prompt.loadPresets = function () {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { return {}; }
  };
  Prompt.savePreset = function (name, prompt, opts) {
    if (!name || !prompt) return false;
    var all = Prompt.loadPresets();
    all[name] = { prompt: prompt, negative: (opts && opts.negative) || '', duration: (opts && opts.duration) || 0, style: (opts && opts.style) || 'normal' };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(all)); return true; } catch (e) { return false; }
  };
  Prompt.deletePreset = function (name) {
    var all = Prompt.loadPresets();
    delete all[name];
    try { localStorage.setItem(STORE_KEY, JSON.stringify(all)); return true; } catch (e) { return false; }
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.AnimPrompt = Prompt;
})();
