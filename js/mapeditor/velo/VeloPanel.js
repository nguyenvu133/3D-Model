/* ============================================================
 * mapeditor/velo/VeloPanel.js — Panel UI Velo trong MapEditor.
 * Gắn vào DOM bằng JS (không sửa MapEditor.html ngoài script
 * tags): thêm 1 section vào cột phải (#me-right), các nút:
 * Import demo3d Velo (fetch main.scene từ GitHub), chọn file
 * .scene local, Export Velo (.scene) + xem trước text,
 * Tải main.scene / Tải .meta / Tải tất cả (tải tuần tự).
 * Toàn bộ text tiếng Việt. Không làm nút giả: nút nào cũng
 * gọi VeloImport/VeloExport thật; nếu chưa có scene thì báo rõ.
 * ============================================================ */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  root.MapEditor = root.MapEditor || {};
  var ME = root.MapEditor;

  var VeloPanel = {
    _inited: false,
    _els: {},
    _vcode: { classes: [], module: null }
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function setStatus(msg, isError) {
    var s = VeloPanel._els.status;
    if (s) {
      s.textContent = msg;
      s.style.color = isError ? '#ff7a7a' : '';
    }
    if (ME.MapEditor && ME.MapEditor.setStatus) ME.MapEditor.setStatus(msg);
  }

  /* Trạng thái model Hero: ✓ FBX thật / ⚠ chibi + lý do + nút chọn file.
   * VeloImport.setHeroStatus gọi vào đây mỗi khi chuỗi load đổi trạng thái. */
  VeloPanel.setHeroStatus = function (mode, detail) {
    var s = VeloPanel._els.heroStatus;
    if (!s) return;
    if (mode === 'fbx') {
      s.textContent = '✓ Hero: Thần Điêu FBX thật — ' + (detail || '');
      s.style.color = '#7ee2a0';
    } else if (mode === 'loading') {
      s.textContent = '⏳ ' + (detail || 'Đang tải Thần Điêu FBX…');
      s.style.color = '';
    } else {
      s.textContent = '⚠ Hero: chibi — ' + (detail || 'chưa load được FBX thật');
      s.style.color = '#ffcf5a';
    }
    if (ME.VeloImport && ME.VeloImport.getHeroStatus) {
      /* đồng bộ lại nếu VeloImport gọi trước khi panel kịp init */
      var cur = ME.VeloImport.getHeroStatus();
      if (cur.mode === 'fbx') { s.textContent = '✓ Hero: Thần Điêu FBX thật — ' + cur.detail; s.style.color = '#7ee2a0'; }
    }
  };

  VeloPanel.pickHeroFBX = function () {
    var input = VeloPanel._els.heroFileInput;
    if (input) input.click();
    else setStatus('Chưa có ô chọn file FBX — tải lại trang.', true);
  };

  VeloPanel.onHeroFileChosen = function (file) {
    if (!file) return;
    if (!ME.VeloImport || !ME.VeloImport.loadHeroFBXFromBuffer) {
      setStatus('VeloImport chưa load.', true);
      return;
    }
    setStatus('Đang parse ' + file.name + '…');
    function done(buf) {
      ME.VeloImport.loadHeroFBXFromBuffer(buf, file.name).then(function (ok) {
        setStatus(ok
          ? 'Đã load Thần Điêu FBX từ file bạn chọn — Hero là Thần Điêu thật (chỉ lưu trong phiên).'
          : 'File FBX đã chọn parse lỗi — Hero giữ dạng chibi.', !ok);
      });
    }
    if (typeof file.arrayBuffer === 'function') {
      file.arrayBuffer().then(done).catch(function (e) { setStatus('Đọc file FBX lỗi: ' + e.message, true); });
    } else {
      var rd = new FileReader();
      rd.onload = function () { done(rd.result); };
      rd.onerror = function () { setStatus('Đọc file FBX lỗi.', true); };
      rd.readAsArrayBuffer(file);
    }
  };

  /* ================= V CODE — chạy code V trong trình duyệt =================
   * Bộ dịch subset V (VCodeRunner, tự viết theo ý tưởng v2js, KHÔNG phải
   * trình biên dịch V thật, KHÔNG chạy engine V). Dịch → đăng ký
   * component vào VeloPlay → chạy như Run Velo thường. Xem docs-vcode. */
  VeloPanel.setVCodeStatus = function (msg, isError) {
    var s = VeloPanel._els.vcodeStatus;
    if (s) { s.textContent = msg; s.style.color = isError ? '#ff7a7a' : ''; }
  };

  VeloPanel.updateVCodeGutter = function () {
    var ta = VeloPanel._els.vcodeText, g = VeloPanel._els.vcodeGutter;
    if (!ta || !g) return;
    var n = ta.value.split('\n').length;
    var nums = [];
    for (var i = 1; i <= n; i++) nums.push(i);
    g.textContent = nums.join('\n');
    g.scrollTop = ta.scrollTop;
  };

  VeloPanel.gotoVCodeLine = function (line) {
    var ta = VeloPanel._els.vcodeText;
    if (!ta) return;
    var lines = ta.value.split('\n');
    line = Math.max(1, Math.min(line, lines.length));
    var off = 0;
    for (var i = 0; i < line - 1; i++) off += lines[i].length + 1;
    ta.focus();
    try { ta.setSelectionRange(off, off + lines[line - 1].length); } catch (e) { }
    ta.scrollTop = Math.max(0, (line - 1) * 15 - 40);
    VeloPanel.updateVCodeGutter();
  };

  VeloPanel.showVCodeErrors = function (errors) {
    var box = VeloPanel._els.vcodeErrors;
    if (!box) return;
    box.innerHTML = '';
    if (!errors || !errors.length) {
      box.textContent = '';
      return;
    }
    errors.forEach(function (err) {
      var d = document.createElement('div');
      d.textContent = 'Dòng ' + err.line + ': ' + err.msg;
      d.style.cssText = 'cursor:pointer;text-decoration:underline;';
      d.title = 'Bấm để nhảy tới dòng ' + err.line;
      d.addEventListener('click', function () { VeloPanel.gotoVCodeLine(err.line || 1); });
      box.appendChild(d);
    });
  };

  VeloPanel.loadVCodeExample = function () {
    var ta = VeloPanel._els.vcodeText;
    if (!ta) return;
    ta.value = '// Ví dụ: component tự viết — xoay node + bob lên xuống.\n' +
      '// Gắn vào Hero (mặc định). Bấm "▶ Chạy code V" rồi xem hero xoay.\n' +
      'pub struct SpinBob {\n' +
      '\tcore.Component\n' +
      'pub mut:\n' +
      '\tspeed f32 = 90\n' +
      '\tamp   f32 = 0.2\n' +
      '\tbase  f32 @[hide]\n' +
      '}\n' +
      '\n' +
      'pub fn (mut s SpinBob) start() {\n' +
      '\ts.base = render3d.transform3d(mut s.node).position.y\n' +
      '}\n' +
      '\n' +
      'pub fn (mut s SpinBob) update(dt f32) {\n' +
      '\tmut tr := render3d.transform3d(mut s.node)\n' +
      '\ttr.rotation.y += s.speed * dt\n' +
      '\ttr.position.y = s.base + f32(math.sin(s.scene().time * 2)) * s.amp\n' +
      '}\n';
    VeloPanel.updateVCodeGutter();
    VeloPanel.showVCodeErrors([]);
    VeloPanel.setVCodeStatus('Đã nạp ví dụ SpinBob — bấm "▶ Chạy code V".');
  };

  VeloPanel.saveVCode = function () {
    var ta = VeloPanel._els.vcodeText;
    if (!ta) return;
    try {
      window.localStorage.setItem('mapeditor.vcode', ta.value);
      VeloPanel.setVCodeStatus('Đã lưu code V vào máy (localStorage mapeditor.vcode).');
    } catch (e) {
      VeloPanel.setVCodeStatus('Lưu lỗi: ' + e.message, true);
    }
  };

  VeloPanel.pickVCodeFiles = function () {
    var input = VeloPanel._els.vcodeFileInput;
    if (input) input.click();
    else VeloPanel.setVCodeStatus('Chưa có ô chọn file .v — tải lại trang.', true);
  };

  VeloPanel.onVCodeFilesChosen = function (files) {
    if (!files || !files.length) return;
    var ta = VeloPanel._els.vcodeText;
    var parts = [];
    var pending = files.length;
    function done() {
      if (--pending > 0) return;
      if (ta) { ta.value = parts.join('\n'); VeloPanel.updateVCodeGutter(); }
      VeloPanel.setVCodeStatus('Đã nạp ' + files.length + ' file .v (' + files.map(function (f) { return f.name; }).join(', ') + ') — bấm "▶ Chạy code V".');
    }
    for (var i = 0; i < files.length; i++) {
      (function (file, idx) {
        var rd = new FileReader();
        rd.onload = function () {
          parts[idx] = '// ===== ' + file.name + ' =====\n' + String(rd.result || '');
          done();
        };
        rd.onerror = function () { parts[idx] = '// LỖI đọc ' + file.name; done(); };
        rd.readAsText(file);
      })(files[i], i);
    }
  };

  VeloPanel.runVCode = function () {
    if (!ME.VCodeRunner) { VeloPanel.setVCodeStatus('VCodeRunner chưa load — tải lại trang.', true); return; }
    var ta = VeloPanel._els.vcodeText;
    if (!ta) return;
    var src = ta.value;
    if (!src.trim()) { VeloPanel.setVCodeStatus('Chưa có code V — bấm "📋 Ví dụ game.v" hoặc chọn file .v.', true); return; }
    var res = ME.VCodeRunner.translate(src);
    if (res.errors && res.errors.length) {
      VeloPanel.showVCodeErrors(res.errors);
      VeloPanel.setVCodeStatus('Dịch lỗi: ' + res.errors.length + ' lỗi (bấm vào từng lỗi để nhảy tới dòng).', true);
      return;
    }
    VeloPanel.showVCodeErrors([]);
    /* biên dịch cần 1 VR tạm (class extends VR.Component lúc chạy) */
    var tmpVR = null;
    var mod = null;
    try {
      tmpVR = ME.VCodeRunner.makeRuntime({});
      mod = ME.VCodeRunner.run(res.js, tmpVR);
    } catch (e) {
      VeloPanel.setVCodeStatus('Biên dịch/chạy lỗi: ' + e.message, true);
      return;
    } finally {
      try { if (tmpVR) tmpVR.dispose(); } catch (e) { }
    }
    if (!ME.VeloPlay) { VeloPanel.setVCodeStatus('VeloPlay chưa load — tải lại trang.', true); return; }
    if (ME.VeloPlay.isActive && ME.VeloPlay.isActive()) ME.VeloPlay.stop();
    ME.VeloPlay.clearVComponents();
    var names = Object.keys(mod.classes || {});
    names.forEach(function (name) { ME.VeloPlay.registerComponent(name, mod.classes[name]); });
    VeloPanel._vcode.classes = names;
    VeloPanel._vcode.module = mod;
    if (!names.length) {
      VeloPanel.setVCodeStatus('Dịch OK nhưng không có struct component nào (cần ít nhất 1 struct, vd: SpinBob).', true);
      return;
    }
    var ok = ME.VeloPlay.start();
    if (!ok) {
      VeloPanel.setVCodeStatus('Đã dịch + đăng ký ' + names.length + ' component (' + names.join(', ') + ') nhưng chưa chạy được — cần scene Velo (import demo3d trước), rồi bấm "▶ Chạy code V" lại.', true);
      return;
    }
    VeloPanel.setVCodeStatus('Đang chạy code V: ' + names.join(', ') + ' — bấm "⏹ Dừng" để về editor (map được khôi phục).');
  };

  VeloPanel.stopVCode = function () {
    if (ME.VeloPlay) {
      if (ME.VeloPlay.isActive && ME.VeloPlay.isActive()) ME.VeloPlay.stop();
      ME.VeloPlay.clearVComponents();
    }
    VeloPanel._vcode.classes = [];
    VeloPanel._vcode.module = null;
    VeloPanel.setVCodeStatus('Đã dừng code V — component đã gỡ, map được khôi phục.');
  };

  function currentData() {
    if (ME.VeloExport && ME.VeloExport.currentData) return ME.VeloExport.currentData();
    return ME.MapEditor ? ME.MapEditor.data : null;
  }

  function showPreview(text) {
    var pre = VeloPanel._els.preview;
    if (pre) pre.textContent = text;
  }

  VeloPanel.importDemo = function () {
    if (!ME.VeloImport || !ME.VeloImport.importDemo3d) {
      setStatus('VeloImport chưa load.', true);
      return;
    }
    setStatus('Đang tải demo3d Velo từ GitHub…');
    ME.VeloImport.importDemo3d().then(function (res) {
      setStatus(res.message || ('Đã import ' + res.objects.length + ' object.'));
      /* cây project hiển thị đúng cấu trúc demo3d đã tải */
      if (ME.VeloProject && ME.VeloProject.showDemoTree) ME.VeloProject.showDemoTree();
    }).catch(function (e) {
      setStatus('Import demo3d lỗi: ' + e.message + ' — thử chọn file .scene local.', true);
    });
  };

  VeloPanel.importFilePicker = function () {
    var input = VeloPanel._els.fileInput;
    if (input) input.click();
  };

  VeloPanel.onFileChosen = function (file) {
    if (!file) return;
    setStatus('Đang import ' + file.name + '…');
    ME.VeloImport.importFile(file).then(function (res) {
      setStatus(res.message || ('Đã import ' + res.objects.length + ' object từ ' + file.name + '.'));
    }).catch(function (e) {
      setStatus('Import file lỗi: ' + e.message, true);
    });
  };

  VeloPanel.exportPreview = function () {
    var data = currentData();
    if (!data) { setStatus('Chưa có scene để export.', true); return null; }
    if (!ME.VeloExport) { setStatus('VeloExport chưa load.', true); return null; }
    try {
      var gen = ME.VeloExport.generate(data);
      showPreview(gen.text);
      var v = ME.VeloExport.validate(gen.text);
      var warn = gen.warnings.length ? ' · ' + gen.warnings.length + ' cảnh báo (xem console)' : '';
      gen.warnings.forEach(function (w) { console.warn('[VeloExport]', w); });
      setStatus(v.ok
        ? 'Export OK: ' + gen.stats.objects + ' object, ' + gen.stats.prefabInstances + ' prefab instance, ' + gen.stats.spawners + ' spawner — parse lại được (' + v.totalNodes + ' node).' + warn
        : 'Export xong nhưng parse lại LỖI: ' + v.errors.join('; '));
      return gen;
    } catch (e) {
      setStatus('Export lỗi: ' + e.message, true);
      return null;
    }
  };

  VeloPanel.downloadScene = function () {
    var gen = VeloPanel.exportPreview();
    if (!gen) return;
    try {
      ME.VeloExport.downloadScene();
      setStatus('Đã tải main.scene (' + gen.stats.objects + ' object).');
    } catch (e) {
      setStatus('Tải main.scene lỗi: ' + e.message, true);
    }
  };

  VeloPanel.downloadMetas = function () {
    var data = currentData();
    if (!data) { setStatus('Chưa có scene để export.', true); return; }
    setStatus('Đang tải các file .meta…');
    ME.VeloExport.downloadMetas(data).then(function (proj) {
      setStatus('Đã tải ' + proj.files.filter(function (f) { return /\.meta$/.test(f.path); }).length + ' file .meta.');
    }).catch(function (e) {
      setStatus('Tải .meta lỗi: ' + e.message, true);
    });
  };

  VeloPanel.downloadAll = function () {
    var data = currentData();
    if (!data) { setStatus('Chưa có scene để export.', true); return; }
    VeloPanel.exportPreview();
    setStatus('Đang tải tất cả file Velo (main.scene + .meta + README)…');
    ME.VeloExport.downloadAll(data).then(function (proj) {
      setStatus('Đã tải tất cả: ' + proj.files.length + ' file (' + proj.files.map(function (f) { return f.path; }).join(', ') + '). Nhớ copy file FBX vào assets/models/ (xem README-VELO.md).');
    }).catch(function (e) {
      setStatus('Tải tất cả lỗi: ' + e.message, true);
    });
  };

  VeloPanel.init = function () {
    if (VeloPanel._inited) return true;
    if (typeof document === 'undefined') return false;
    var right = document.getElementById('me-right');
    var host = right || document.body;
    if (!host) return false;
    VeloPanel._inited = true;

    var head = el('div', 'panel-head', '🎮 Velo — Import/Export .scene');
    var body = el('div', 'panel-body');
    body.style.cssText = 'flex:none;max-height:340px;';
    var inner = el('div');
    inner.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:2px;';

    function btn(label, title, fn) {
      var b = el('button', 'btn sm', label);
      b.title = title || label;
      b.style.textAlign = 'left';
      b.addEventListener('click', fn);
      return b;
    }

    inner.appendChild(btn('⬇ Import demo3d Velo', 'Tải main.scene demo3d từ repo velo-engine/velo (nhánh 3d) rồi dựng vào map', function () { VeloPanel.importDemo(); }));
    inner.appendChild(btn('📁 Mở thư mục project Velo…', 'Chọn cả thư mục project Velo — hiện đường dẫn + số file, bấm Import mới vào (cây project ở cột trái)', function () {
      if (ME.VeloProject && ME.VeloProject.openFolderPicker) {
        ME.VeloProject.openFolderPicker().catch(function (e) { setStatus('Mở thư mục lỗi: ' + e.message, true); });
      } else {
        setStatus('VeloProject chưa load.', true);
      }
    }));
    inner.appendChild(btn('📂 Chọn file .scene…', 'Import file .scene bất kỳ của bạn (cùng parser)', function () { VeloPanel.importFilePicker(); }));
    inner.appendChild(btn('📂 Chọn file FBX Thần Điêu…', 'Chọn file than_dieu_run.fbx trên máy/điện thoại — Hero thành Thần Điêu thật ngay, chỉ lưu trong phiên, không upload đâu cả', function () { VeloPanel.pickHeroFBX(); }));
    inner.appendChild(btn('⬆ Export Velo (.scene) — xem trước', 'Sinh text .scene từ map hiện tại, hiện ở khung xem trước bên dưới', function () { VeloPanel.exportPreview(); }));
    inner.appendChild(btn('⬇ Tải main.scene', 'Tải file main.scene đã export', function () { VeloPanel.downloadScene(); }));
    inner.appendChild(btn('⬇ Tải .meta', 'Tải tuần tự các file .meta (main.scene + prefab + model)', function () { VeloPanel.downloadMetas(); }));
    inner.appendChild(btn('⬇ Tải tất cả', 'Tải tuần tự: main.scene + .meta + README-VELO.md (+ .scene prefab nếu đã tải về)', function () { VeloPanel.downloadAll(); }));

    var note = el('div', null,
      'Import: demo3d Velo (Hero Thần Điêu, 4 đuốc, 7 cây, portal…) — HUD 2D bỏ qua. ' +
      'Mở thư mục project: quét cả thư mục (scenes/prefabs/models/scripts/.v), ' +
      'cây project ở cột trái, tự quét lại khi file đổi. ' +
      'Export: game logic V + file FBX không kèm, xem docs/VELO_INTEGRATION.md.');
    note.style.cssText = 'color:var(--text3);font-size:11px;line-height:1.4;';
    inner.appendChild(note);

    var status = el('div', null, 'Velo sẵn sàng.');
    status.id = 'me-velo-status';
    status.style.cssText = 'font-size:11px;line-height:1.4;min-height:16px;';
    inner.appendChild(status);

    var heroStatus = el('div', null, '⚠ Hero: chibi — chưa load FBX thật (import demo3d để tải từ GitHub, hoặc chọn file FBX bên trên).');
    heroStatus.id = 'me-velo-hero-status';
    heroStatus.style.cssText = 'font-size:11px;line-height:1.4;color:#ffcf5a;';
    inner.appendChild(heroStatus);

    var runNote = el('div', null,
      '▶ Run Velo: chơi game demo3d ngay trong trình duyệt (bản port JS, không cần engine V) — nút "▶ Run Velo" trên toolbar hoặc phím R.');
    runNote.style.cssText = 'color:var(--text3);font-size:11px;line-height:1.4;';
    inner.appendChild(runNote);

    var pre = el('pre', null, '// Xem trước text .scene sẽ hiện ở đây sau khi bấm Export.');
    pre.id = 'me-velo-preview';
    pre.style.cssText = 'font-size:10px;line-height:1.35;max-height:150px;overflow:auto;background:rgba(0,0,0,0.25);padding:6px;border-radius:4px;white-space:pre-wrap;word-break:break-word;margin:0;';
    inner.appendChild(pre);

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.scene';
    fileInput.className = 'hidden';
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (f) VeloPanel.onFileChosen(f);
    });
    inner.appendChild(fileInput);

    var heroFileInput = document.createElement('input');
    heroFileInput.type = 'file';
    heroFileInput.accept = '.fbx';
    heroFileInput.className = 'hidden';
    heroFileInput.addEventListener('change', function () {
      var f = heroFileInput.files && heroFileInput.files[0];
      heroFileInput.value = '';
      if (f) VeloPanel.onHeroFileChosen(f);
    });
    inner.appendChild(heroFileInput);

    body.appendChild(inner);
    if (right) {
      right.appendChild(head);
      right.appendChild(body);
    } else {
      var wrap = el('div');
      wrap.style.cssText = 'position:fixed;right:12px;top:12px;z-index:50;background:#1a2233;color:#fff;padding:10px;border-radius:8px;max-width:320px;';
      wrap.appendChild(head);
      wrap.appendChild(body);
      host.appendChild(wrap);
    }
    VeloPanel._els = { status: status, preview: pre, fileInput: fileInput, heroStatus: heroStatus, heroFileInput: heroFileInput };
    /* đồng bộ trạng thái Hero nếu VeloImport đã load trước panel */
    try {
      if (ME.VeloImport && ME.VeloImport.getHeroStatus) {
        var cur = ME.VeloImport.getHeroStatus();
        if (cur.mode === 'fbx') VeloPanel.setHeroStatus('fbx', cur.detail);
      }
    } catch (e) { }
    /* nạp VeloPlay.js động (không sửa MapEditor.html): xong thì init
     * để có nút ▶ Run Velo trên toolbar. */
    try {
      if (!ME.VeloPlay && typeof document !== 'undefined') {
        var s = document.createElement('script');
        s.src = 'js/mapeditor/velo/VeloPlay.js';
        s.onload = function () { try { if (ME.VeloPlay) ME.VeloPlay.init(); } catch (e) { } };
        document.head.appendChild(s);
      } else if (ME.VeloPlay) {
        ME.VeloPlay.init();
      }
    } catch (e) { }
    /* nạp VCodeRunner.js động (cùng cơ chế): bộ dịch V→JS offline */
    try {
      if (!ME.VCodeRunner && typeof document !== 'undefined') {
        var s2 = document.createElement('script');
        s2.src = 'js/mapeditor/velo/VCodeRunner.js';
        document.head.appendChild(s2);
      }
    } catch (e) { }

    /* ---------- Section V Code ---------- */
    var vHead = el('div', 'panel-head', '💻 V Code — chạy code V trong trình duyệt');
    var vBody = el('div', 'panel-body');
    vBody.style.cssText = 'flex:none;max-height:460px;overflow:auto;';
    var vInner = el('div');
    vInner.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:2px;';

    var vNote = el('div', null,
      'Bộ dịch SUBSET V chạy 100% trong trình duyệt (theo ý tưởng v2js của Velo, tự viết lại) — ' +
      'KHÔNG phải trình biên dịch V thật, KHÔNG chạy engine V, KHÔNG cần mạng. ' +
      'Code V chỉ được dùng VR, Math, console (chặn window/document/fetch...). ' +
      'Component dịch ra chạy cùng scene Velo đã import (hero/slime/drone/golem/orb).');
    vNote.style.cssText = 'color:var(--text3);font-size:11px;line-height:1.4;';
    vInner.appendChild(vNote);

    var editorWrap = el('div');
    editorWrap.style.cssText = 'display:flex;gap:0;border:1px solid rgba(255,255,255,0.15);border-radius:4px;overflow:hidden;background:rgba(0,0,0,0.25);';
    var gutter = el('div', null, '1');
    gutter.id = 'me-vcode-gutter';
    gutter.style.cssText = 'flex:none;width:30px;padding:4px 2px;font:11px/15px monospace;text-align:right;color:var(--text3);white-space:pre;overflow:hidden;user-select:none;background:rgba(0,0,0,0.2);';
    var ta = document.createElement('textarea');
    ta.id = 'me-vcode-text';
    ta.spellcheck = false;
    ta.placeholder = '// Dán code V vào đây (struct + fn update/start)...\n// hoặc bấm "📋 Ví dụ game.v" / "📂 Chọn file .v…"';
    ta.style.cssText = 'flex:1;min-height:140px;resize:vertical;border:0;outline:0;background:transparent;color:inherit;font:11px/15px monospace;padding:4px 6px;white-space:pre;overflow:auto;';
    ta.addEventListener('input', function () { VeloPanel.updateVCodeGutter(); });
    ta.addEventListener('scroll', function () { if (gutter) gutter.scrollTop = ta.scrollTop; });
    try {
      var saved = window.localStorage.getItem('mapeditor.vcode');
      if (saved) ta.value = saved;
    } catch (e) { }
    editorWrap.appendChild(gutter);
    editorWrap.appendChild(ta);
    vInner.appendChild(editorWrap);

    var vBtnRow = el('div');
    vBtnRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    function vbtn(label, title, fn) {
      var b = el('button', 'btn sm', label);
      b.title = title || label;
      b.addEventListener('click', fn);
      vBtnRow.appendChild(b);
      return b;
    }
    vbtn('▶ Chạy code V', 'Dịch code V → đăng ký component → chạy game như Run Velo', function () { VeloPanel.runVCode(); });
    vbtn('⏹ Dừng', 'Dừng game + gỡ component V, khôi phục map', function () { VeloPanel.stopVCode(); });
    vbtn('📂 Chọn file .v…', 'Chọn nhiều file .v trên máy/điện thoại (đọc offline bằng FileReader)', function () { VeloPanel.pickVCodeFiles(); });
    vbtn('📋 Ví dụ game.v', 'Nạp ví dụ component SpinBob ngắn gọn', function () { VeloPanel.loadVCodeExample(); });
    vbtn('💾 Lưu', 'Lưu code đang soạn vào máy (localStorage)', function () { VeloPanel.saveVCode(); });
    vInner.appendChild(vBtnRow);

    var vStatus = el('div', null, 'V Code sẵn sàng — cần scene Velo (import demo3d) để chạy.');
    vStatus.id = 'me-vcode-status';
    vStatus.style.cssText = 'font-size:11px;line-height:1.4;min-height:16px;';
    vInner.appendChild(vStatus);

    var vErrors = el('div', null, '');
    vErrors.id = 'me-vcode-errors';
    vErrors.style.cssText = 'font-size:11px;line-height:1.5;color:#ff9a9a;white-space:pre-wrap;word-break:break-word;';
    vInner.appendChild(vErrors);

    var vcodeFileInput = document.createElement('input');
    vcodeFileInput.type = 'file';
    vcodeFileInput.accept = '.v';
    vcodeFileInput.multiple = true;
    vcodeFileInput.className = 'hidden';
    vcodeFileInput.addEventListener('change', function () {
      var fs = vcodeFileInput.files ? Array.prototype.slice.call(vcodeFileInput.files) : [];
      vcodeFileInput.value = '';
      if (fs.length) VeloPanel.onVCodeFilesChosen(fs);
    });
    vInner.appendChild(vcodeFileInput);

    vBody.appendChild(vInner);
    if (right) {
      right.appendChild(vHead);
      right.appendChild(vBody);
    } else {
      vBody.appendChild(vHead);
    }
    VeloPanel._els.vcodeText = ta;
    VeloPanel._els.vcodeGutter = gutter;
    VeloPanel._els.vcodeStatus = vStatus;
    VeloPanel._els.vcodeErrors = vErrors;
    VeloPanel._els.vcodeFileInput = vcodeFileInput;
    VeloPanel.updateVCodeGutter();
    return true;
  };

  ME.VeloPanel = VeloPanel;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { VeloPanel.init(); });
    } else {
      VeloPanel.init();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ME.VeloPanel;
  }
})();
