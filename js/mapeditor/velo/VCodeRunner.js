/* ============================================================
 * mapeditor/velo/VCodeRunner.js — Bộ dịch V→JS chạy 100% trong
 * trình duyệt (KHÔNG fetch, KHÔNG gọi API, KHÔNG cần mạng).
 *
 * Tự viết lại theo Ý TƯỞNG v2js của Velo (struct→class, ?T→null,
 * !T→exception, enum→chuỗi, map→Map), KHÔNG dùng code Velo/v2js.
 * Đây là bộ dịch SUBSET V, không phải trình biên dịch V thật và
 * KHÔNG chạy engine V — chỉ đủ để chạy các component game.v /
 * combat.v của demo3d (HeroController, FollowCamera, SlimeHop,
 * DroneHover, GolemWalk, OrbPickup, Health, HeroCombat...).
 *
 * API:
 *   VCodeRunner.translate(vSource) → { js, errors:[{line,msg}],
 *     classes:[...], functions:[...] }
 *   VCodeRunner.run(js, VR) → module { classes, functions }
 *     (biên dịch bằng new Function trong sandbox hẹp — xem §sandbox)
 *   VCodeRunner.makeRuntime(hooks) → VR (VeloRuntime, xem §VR)
 *   VCodeRunner.scanSource(vSource) → lỗi cấm (window/document/...)
 *
 * §sandbox — GIỚI HẠN AN TOÀN (đọc kỹ): `new Function` trong trình
 * duyệt KHÔNG phải sandbox bảo mật tuyệt đối. Code ở đây chỉ làm 2
 * lớp rào chắn chống TRUY CẬP NHẦM: (a) quét tĩnh mã nguồn V, chặn
 * các identifier bị cấm (window, document, fetch, eval, ...) kèm số
 * dòng; (b) chạy với 'use strict' và chỉ truyền đúng 3 tham số
 * (VR, Math, console). Code V độc hại vẫn có thể thoát qua các
 * đường khác (ví dụ qua VR). CHỈ chạy code V từ nguồn bạn tin cậy.
 * ============================================================ */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  root.MapEditor = root.MapEditor || {};
  var ME = root.MapEditor;

  /* ================= lỗi dịch (có số dòng, tiếng Việt) ================= */
  function VError(line, msg) {
    this.line = line || 1;
    this.msg = msg;
  }
  VError.prototype.toString = function () { return 'Dòng ' + this.line + ': ' + this.msg; };

  /* `module`/`parent`/`top`/`self` là tên hợp lệ trong V (vd: khai báo
   * `module main`, tham số `mut parent core.Node`) nên KHÔNG chặn ở
   * mã nguồn — lớp quét mã JS sinh ra sẽ chặn khi chúng là biến tự do
   * (không phải biến local đã khai báo). */
  var BANNED_SRC = ['window', 'document', 'fetch', 'eval', 'XMLHttpRequest',
    'localStorage', 'sessionStorage', 'globalThis',
    'Function', 'require', 'process', 'exports', 'WebSocket',
    'indexedDB', 'navigator', 'location', 'alert', 'importScripts'];
  var BANNED = BANNED_SRC.concat(['module', 'parent', 'top', 'self']);

  /* Quét mã nguồn V: chặn identifier bị cấm (bỏ qua chuỗi, comment và
   * truy cập thuộc tính `.window`). Trả về danh sách lỗi {line, msg}. */
  function scanSource(src) {
    var errors = [];
    var lines = String(src || '').split('\n');
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      /* bỏ chuỗi '...' (kể cả nội suy) và comment // */
      var clean = '';
      var inStr = false, i = 0;
      while (i < line.length) {
        var ch = line[i];
        if (inStr) {
          if (ch === '\\') { i += 2; continue; }
          if (ch === "'") inStr = false;
          i++;
          continue;
        }
        if (ch === "'") { inStr = true; i++; continue; }
        if (ch === '/' && line[i + 1] === '/') break;
        clean += ch;
        i++;
      }
      for (var b = 0; b < BANNED_SRC.length; b++) {
        var name = BANNED_SRC[b];
        var re = new RegExp('(^|[^A-Za-z0-9_$.])' + name + '(?![A-Za-z0-9_$])', 'g');
        var m;
        while ((m = re.exec(clean)) !== null) {
          errors.push({ line: li + 1, msg: 'Không được dùng "' + name + '" trong code V (bị chặn bởi sandbox — chỉ được dùng VR, Math, console).' });
        }
      }
    }
    return errors;
  }

  /* Quét mã JS sinh ra (lớp rào thứ hai): chặn identifier bị cấm ở dạng
   * bare (không phải sau dấu chấm, không nằm trong chuỗi). Tên nào đã
   * được khai báo làm biến local (tham số, let/const, tên hàm/class)
   * trong mã sinh ra thì được miễn — nó che (shadow) global cùng tên. */
  function scanGenerated(js) {
    var errors = [];
    var stripped = js.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');
    var declared = {};
    function collectParams(list) {
      if (!list) return;
      list.split(',').forEach(function (p) {
        var m = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)/.exec(p);
        if (m) declared[m[1]] = true;
      });
    }
    var re;
    re = /(?:function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
    var m;
    while ((m = re.exec(stripped)) !== null) declared[m[1]] = true;
    re = /(?:let|const|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
    while ((m = re.exec(stripped)) !== null) declared[m[1]] = true;
    re = /function\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\(([^)]*)\)/g;
    while ((m = re.exec(stripped)) !== null) collectParams(m[1]);
    re = /\(([^)]*)\)\s*=>/g;
    while ((m = re.exec(stripped)) !== null) collectParams(m[1]);
    re = /^[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)\(([^)]*)\)/gm;
    while ((m = re.exec(stripped)) !== null) collectParams(m[2]);
    for (var b = 0; b < BANNED.length; b++) {
      var name = BANNED[b];
      if (declared[name]) continue;
      var re2 = new RegExp('(^|[^A-Za-z0-9_$.])' + name + '(?![A-Za-z0-9_$])', 'g');
      if (re2.test(stripped)) errors.push({ line: 0, msg: 'Mã JS sinh ra chứa identifier bị cấm "' + name + '" — đã chặn trước khi chạy.' });
    }
    return errors;
  }

  var UNSUPPORTED = [
    [/\bspawn\b/, 'spawn/go/channel/lock: chạy song song (concurrency) không dịch được sang JS trong trình duyệt.'],
    [/\bgo\s+[A-Za-z_(]/, 'spawn/go/channel/lock: chạy song song (concurrency) không dịch được sang JS trong trình duyệt.'],
    [/\bC\.[A-Za-z_]/, 'C interop (gọi hàm C qua C.xxx) không dịch được sang JS.'],
    [/\$for\b/, '$for (reflection lúc biên dịch) không dịch được.'],
    [/\$embed_file\b/, '$embed_file không dịch được.'],
    [/\$if\b/, '$if (comptime) không dịch được.'],
    [/^\s*asm\b/, 'asm không dịch được.'],
    [/^\s*goto\b/, 'goto không dịch được.'],
    [/^\s*defer\b/, 'defer chưa được hỗ trợ trong bộ dịch này.'],
    [/^\s*match\b/, 'match chưa được hỗ trợ — dùng if/else thay thế.'],
    [/^\s*select\b/, 'select (channel) không dịch được.']
  ];

  /* ================= TOKENIZER ================= */
  var OPS3 = [];
  var OPS2 = [':=', '==', '!=', '<=', '>=', '&&', '||', '..', '++', '--', '+=', '-=', '*=', '/=', '%=', '<<', '>>'];
  var OPS1 = '+-*/%<>=!&|?:.,;()[]{}';

  function tokenize(src) {
    var toks = [];
    var i = 0, line = 1, n = src.length;
    function push(type, val, ln) { toks.push({ type: type, val: val, line: ln || line }); }
    while (i < n) {
      var ch = src[i];
      if (ch === '\n') { line++; i++; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
      if (ch === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (ch === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
        i += 2; continue;
      }
      /* attribute @[...] — bỏ qua toàn bộ (kể cả chuỗi bên trong) */
      if (ch === '@') {
        var j = i + 1;
        if (src[j] === '[') {
          var depth = 0, inS = false;
          while (j < n) {
            var c = src[j];
            if (inS) { if (c === '\\') { j += 2; continue; } if (c === "'") inS = false; j++; continue; }
            if (c === "'") { inS = true; j++; continue; }
            if (c === '[') depth++;
            else if (c === ']') { depth--; j++; if (depth === 0) break; continue; }
            if (c === '\n') line++;
            j++;
          }
          i = j; continue;
        }
        i++; continue;
      }
      /* chuỗi '...' + nội suy ${...} */
      if (ch === "'") {
        var startLine = line;
        i++;
        var parts = [];
        var buf = '';
        var closed = false;
        while (i < n) {
          var c2 = src[i];
          if (c2 === '\\') {
            var e = src[i + 1];
            if (e === 'n') buf += '\n';
            else if (e === 't') buf += '\t';
            else if (e === 'r') buf += '\r';
            else if (e === "'") buf += "'";
            else if (e === '\\') buf += '\\';
            else if (e === '$') buf += '$';
            else buf += e;
            i += 2; continue;
          }
          if (c2 === "'") { closed = true; i++; break; }
          if (c2 === '\n') { line++; buf += '\n'; i++; continue; }
          if (c2 === '$' && src[i + 1] === '{') {
            if (buf) { parts.push({ text: buf }); buf = ''; }
            var d = 1; i += 2;
            var exprStart = i;
            while (i < n && d > 0) {
              if (src[i] === '{') d++;
              else if (src[i] === '}') { d--; if (d === 0) break; }
              else if (src[i] === "'") {
                i++;
                while (i < n && src[i] !== "'") { if (src[i] === '\\') i++; if (src[i] === '\n') line++; i++; }
              }
              if (src[i] === '\n') line++;
              i++;
            }
            parts.push({ expr: src.slice(exprStart, i), line: startLine });
            i++; /* bỏ } */
            continue;
          }
          buf += c2;
          i++;
        }
        if (!closed) throw new VError(startLine, 'Chuỗi không đóng ngoặc \'...\'');
        if (buf || parts.length === 0) parts.push({ text: buf });
        push('str', parts, startLine);
        continue;
      }
      /* số: 1, 0.5, 1e9, 1_000, 0x1F */
      if (/[0-9]/.test(ch)) {
        var s = i;
        if (ch === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
          i += 2;
          while (i < n && /[0-9a-fA-F_]/.test(src[i])) i++;
        } else {
          while (i < n && /[0-9_]/.test(src[i])) i++;
          if (src[i] === '.' && /[0-9]/.test(src[i + 1] || '')) {
            i++;
            while (i < n && /[0-9_]/.test(src[i])) i++;
          }
          if (src[i] === 'e' || src[i] === 'E') {
            var k = i + 1;
            if (src[k] === '+' || src[k] === '-') k++;
            if (/[0-9]/.test(src[k] || '')) {
              i = k;
              while (i < n && /[0-9_]/.test(src[i])) i++;
            }
          }
        }
        push('num', src.slice(s, i).replace(/_/g, ''), line);
        continue;
      }
      /* $ident (comptime) — giữ lại để báo lỗi rõ ràng */
      if (ch === '$') {
        var m2 = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i + 1));
        if (m2) { push('dollar', '$' + m2[0], line); i += 1 + m2[0].length; continue; }
        push('op', '$', line); i++; continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        var m3 = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
        push('id', m3[0], line);
        i += m3[0].length;
        continue;
      }
      var two = src.slice(i, i + 2);
      if (OPS2.indexOf(two) >= 0) { push('op', two, line); i += 2; continue; }
      if (OPS1.indexOf(ch) >= 0) { push('op', ch, line); i++; continue; }
      throw new VError(line, 'Ký tự không hiểu được: "' + ch + '"');
    }
    push('eof', '', line);
    return toks;
  }

  /* ================= PARSER (AST) ================= */
  var CASTS = { f32: 1, f64: 1, int: 1, i64: 1, i32: 1, u8: 1, u16: 1, u32: 1, u64: 1, bool: 1, string: 1, rune: 1, voidptr: 1 };

  function Parser(toks) {
    this.toks = toks;
    this.pos = 0;
  }
  Parser.prototype.peek = function (k) { return this.toks[Math.min(this.pos + (k || 0), this.toks.length - 1)]; };
  Parser.prototype.next = function () { var t = this.toks[this.pos]; if (this.pos < this.toks.length - 1) this.pos++; return t; };
  Parser.prototype.atOp = function (v) { var t = this.peek(); return t.type === 'op' && t.val === v; };
  Parser.prototype.atId = function (v) { var t = this.peek(); return t.type === 'id' && (v === undefined || t.val === v); };
  Parser.prototype.eatOp = function (v) { if (this.atOp(v)) { this.next(); return true; } return false; };
  Parser.prototype.eatId = function (v) { if (this.atId(v)) { this.next(); return true; } return false; };
  Parser.prototype.expectOp = function (v) {
    if (!this.atOp(v)) { var t = this.peek(); throw new VError(t.line, 'Cần "' + v + '" nhưng gặp "' + t.val + '"'); }
    this.next();
  };
  Parser.prototype.expectId = function (what) {
    var t = this.peek();
    if (t.type !== 'id') throw new VError(t.line, 'Cần ' + (what || 'tên') + ' nhưng gặp "' + t.val + '"');
    this.next();
    return t.val;
  };
  Parser.prototype.err = function (tok, msg) { throw new VError(tok.line, msg); };

  /* --- chương trình: module/import bỏ qua, rồi các khai báo --- */
  Parser.prototype.parseProgram = function () {
    var decls = [];
    while (this.peek().type !== 'eof') {
      if (this.atId('module') || this.atId('import')) {
        /* bỏ cả dòng: module X / import a.b.c */
        while (this.peek().type !== 'eof' && this.peek().line === this.peek().line) {
          var t = this.next();
          if (t.type === 'eof') break;
          /* import có thể viết nhiều tên trên nhiều dòng? không — 1 dòng */
          if (this.peek().line !== t.line) break;
        }
        continue;
      }
      if (this.atId('pub')) { this.next(); }
      if (this.atId('const')) {
        decls.push(this.parseConstDecl());
        continue;
      }
      if (this.atId('struct')) {
        decls.push(this.parseStruct());
        continue;
      }
      if (this.atId('fn')) {
        decls.push(this.parseFn());
        continue;
      }
      if (this.atId('enum')) {
        var et = this.peek();
        throw new VError(et.line, 'enum chưa được hỗ trợ — dùng string thay thế (vd: team string = \'hero\').');
      }
      var t = this.peek();
      throw new VError(t.line, 'Không hiểu khai báo bắt đầu bằng "' + t.val + '" ở cấp cao nhất (chỉ hỗ trợ struct/fn/const/module/import).');
    }
    return decls;
  };

  Parser.prototype.parseConstDecl = function () {
    var kw = this.next(); /* const */
    var name = this.expectId('tên const');
    this.expectOp('=');
    var val = this.parseExpr();
    return { t: 'const', name: name, value: val, line: kw.line };
  };

  /* struct: gom token theo dòng để parse field (default có thể là
   * struct literal 1 dòng; attribute @[...] đã bị tokenizer bỏ). */
  Parser.prototype.parseStruct = function () {
    var kw = this.next(); /* struct */
    var name = this.expectId('tên struct');
    this.expectOp('{');
    var fields = [];
    /* gom các token trong { } theo dòng */
    var depth = 1;
    var curLine = null, curToks = [];
    function flushLine(self) {
      if (!curToks.length) return;
      var first = curToks[0];
      if (first.type === 'id' && (first.val === 'pub' || first.val === 'mut')) {
        /* dòng "pub mut:" / "mut:" / "core.Component" — bỏ */
        if (curToks.length <= 2) return;
        if (curToks[1] && curToks[1].type === 'id' && curToks[1].val === 'mut') return;
        if (curToks[0].val === 'mut') return;
      }
      /* dòng chỉ là đường dẫn kiểu nhúng (core.Component) — không có '=',
       * token thứ 2 là dấu '.' → bỏ */
      if (curToks[1] && curToks[1].type === 'op' && curToks[1].val === '.') return;
      /* field: name type... [= default] */
      var p = new Parser(curToks.concat([{ type: 'eof', val: '', line: first.line }]));
      var fname = p.expectId('tên field của struct ' + name);
      /* type: gom token cho tới '=' hoặc hết dòng; type có thể là
       * &T, []T, map[K]V, assets.AssetRef[X], core.Vec3... */
      var typeToks = [];
      while (p.peek().type !== 'eof' && !p.atOp('=')) typeToks.push(p.next());
      var typeStr = typeToks.map(function (x) { return x.val; }).join('');
      var def = null;
      if (p.eatOp('=')) def = p.parseExpr();
      fields.push({ name: fname, type: typeStr, def: def, line: first.line });
    }
    var self = this;
    while (depth > 0) {
      var tk = this.next();
      if (tk.type === 'eof') throw new VError(tk.line, 'Struct ' + name + ' chưa đóng }');
      if (tk.type === 'op' && tk.val === '{') { depth++; curToks.push(tk); continue; }
      if (tk.type === 'op' && tk.val === '}') {
        depth--;
        if (depth === 0) { flushLine(self); break; }
        curToks.push(tk); continue;
      }
      if (curLine === null) curLine = tk.line;
      if (tk.line !== curLine) { flushLine(self); curLine = tk.line; curToks = []; }
      curToks.push(tk);
    }
    return { t: 'struct', name: name, fields: fields, line: kw.line };
  };

  /* fn: [typeParams] (receiver)? name(params) [retType] { body } */
  Parser.prototype.parseFn = function () {
    var kw = this.next(); /* fn */
    var typeParams = [];
    if (this.atOp('[')) {
      /* fn generic — chỉ hỗ trợ tên hàm generic, vd child_component[T] */
      this.next();
      while (!this.atOp(']')) {
        typeParams.push(this.expectId('tên tham số kiểu'));
        this.eatOp(',');
      }
      this.expectOp(']');
    }
    var receiver = null;
    if (this.atOp('(')) {
      /* phân biệt receiver (mut x Type) với tên hàm đi sau? Viết:
       * fn (mut h HeroController) update(...) — receiver là (...)
       * rồi tới tên. Còn fn name(...) — sau fn là tên luôn. */
      var save = this.pos;
      this.next();
      this.eatId('mut');
      var rname = null, rtype = null;
      if (this.atId()) {
        rname = this.next().val;
        if (this.atOp('&')) this.next();
        var rt = [];
        while (!this.atOp(')')) {
          if (this.peek().type === 'eof') throw new VError(this.peek().line, 'Receiver (mut x Type) chưa đóng )');
          rt.push(this.next().val);
        }
        rtype = rt.join('');
      }
      if (rname && this.atOp(')') && this.peek(1).type === 'id') {
        this.next(); /* ) */
        receiver = { name: rname, type: rtype };
      } else {
        this.pos = save; /* không phải receiver — quay lại */
      }
    }
    var name;
    if (receiver) {
      name = this.expectId('tên method');
    } else if (this.atId()) {
      name = this.next().val;
    } else {
      throw new VError(this.peek().line, 'Cần tên hàm sau fn');
    }
    /* tham số kiểu sau tên hàm: fn name[T](...) */
    if (this.atOp('[')) {
      this.next();
      while (!this.atOp(']')) {
        if (this.peek().type === 'eof') throw new VError(this.peek().line, 'Tham số kiểu [T] chưa đóng ]');
        typeParams.push(this.expectId('tên tham số kiểu'));
        this.eatOp(',');
      }
      this.expectOp(']');
    }
    var params = this.parseParams();
    /* kiểu trả về: ?T, &T, (a, b, T), T, hoặc không có */
    var retMulti = false, retType = '';
    if (this.atOp('(')) {
      /* (bool, bool, core.Vec3) — kiểu trả về nhiều giá trị */
      var rt2 = [];
      this.next();
      var comma = false;
      while (!this.atOp(')')) {
        var tk = this.next();
        if (tk.val === ',') comma = true;
        rt2.push(tk.val);
      }
      this.expectOp(')');
      retMulti = comma;
      retType = rt2.join('');
    } else if (this.peek().type === 'id' || this.atOp('?') || this.atOp('&') || this.atOp('[')) {
      var rt3 = [];
      while (this.peek().type === 'id' || this.atOp('?') || this.atOp('&') || this.atOp('[') || this.atOp(']') || this.atOp('.')) {
        rt3.push(this.next().val);
        if (this.atOp('{')) break;
      }
      retType = rt3.join('');
    }
    var body = this.parseBlock();
    return { t: 'fn', name: name, receiver: receiver, params: params, typeParams: typeParams, retMulti: retMulti, retType: retType, body: body, line: kw.line };
  };

  /* params: (dt f32, mut n core.Node, a int = 5) */
  Parser.prototype.parseParams = function () {
    this.expectOp('(');
    var params = [];
    while (!this.atOp(')')) {
      this.eatId('mut');
      var pname = this.expectId('tên tham số');
      /* bỏ type: gom token cho tới ',' ')' hoặc '=' */
      var typeToks = [];
      while (!this.atOp(',') && !this.atOp(')') && !this.atOp('=')) typeToks.push(this.next());
      var def = null;
      if (this.eatOp('=')) def = this.parseExpr();
      params.push({ name: pname, type: typeToks.map(function (x) { return x.val; }).join(''), def: def });
      if (!this.eatOp(',')) break;
    }
    this.expectOp(')');
    return params;
  };

  Parser.prototype.parseBlock = function () {
    var open = this.peek();
    this.expectOp('{');
    var stmts = [];
    while (!this.atOp('}')) {
      if (this.peek().type === 'eof') throw new VError(open.line, 'Khối { chưa đóng }');
      var s = this.parseStmt();
      if (s) stmts.push(s);
    }
    this.expectOp('}');
    return { t: 'block', stmts: stmts, line: open.line };
  };

  /* --- câu lệnh --- */
  Parser.prototype.parseStmt = function () {
    var tk = this.peek();
    /* kiểm tra lỗi không hỗ trợ trước */
    if (tk.type === 'id') {
      if (tk.val === 'spawn' || tk.val === 'go') throw new VError(tk.line, 'spawn/go (chạy song song) không dịch được sang JS trong trình duyệt.');
      if (tk.val === 'goto') throw new VError(tk.line, 'goto không dịch được.');
      if (tk.val === 'asm') throw new VError(tk.line, 'asm không dịch được.');
      if (tk.val === 'defer') throw new VError(tk.line, 'defer chưa được hỗ trợ trong bộ dịch này.');
      if (tk.val === 'match') throw new VError(tk.line, 'match chưa được hỗ trợ — dùng if/else thay thế.');
      if (tk.val === 'select') throw new VError(tk.line, 'select (channel) không dịch được.');
      if (tk.val === 'lock') throw new VError(tk.line, 'lock (channel/mutex) không dịch được.');
    }
    if (tk.type === 'dollar') throw new VError(tk.line, '"' + tk.val + '" (comptime) không dịch được.');
    if (this.atId('if')) return this.parseIf();
    if (this.atId('for')) return this.parseFor();
    if (this.atId('while')) {
      this.next();
      var cond = this.parseExpr();
      return { t: 'while', cond: cond, body: this.parseBlock(), line: tk.line };
    }
    if (this.atId('return')) {
      this.next();
      if (this.atOp('}')) return { t: 'return', values: [], line: tk.line };
      var vals = [this.parseExpr()];
      while (this.eatOp(',')) vals.push(this.parseExpr());
      return { t: 'return', values: vals, line: tk.line };
    }
    if (this.atId('break')) { this.next(); return { t: 'break', line: tk.line }; }
    if (this.atId('continue')) { this.next(); return { t: 'continue', line: tk.line }; }
    if (this.atId('unsafe')) {
      this.next();
      var blk = this.parseBlock();
      return { t: 'unsafeBlock', body: blk, line: tk.line };
    }
    /* khai báo mut x := ... / x := ... (kể cả nhiều tên a, b := ...) */
    var save = this.pos;
    var isMut = this.eatId('mut');
    if (this.atId()) {
      var names = [];
      var first = this.next().val;
      names.push(first);
      var multi = false;
      while (this.eatOp(',')) {
        this.eatId('mut'); /* V cho `mut best, mut best_t := ...` */
        if (!this.atId()) { this.pos = save; break; }
        names.push(this.next().val);
        multi = true;
      }
      if (this.atOp(':=')) {
        this.next();
        var vals = [this.parseExpr()];
        while (this.eatOp(',')) vals.push(this.parseExpr());
        var node = { t: 'varDecl', names: names, values: vals, line: tk.line };
        node = this.wrapSuffix(node);
        return node;
      }
      if (multi) { this.pos = save; }
      else this.pos = save;
    } else {
      this.pos = save;
    }
    /* câu lệnh biểu thức / gán */
    var expr = this.parseExpr();
    /* gán nhiều: a, b = c, d */
    if (this.atOp(',')) {
      var lhs = [expr];
      while (this.eatOp(',')) lhs.push(this.parseExpr());
      if (this.atOp('=')) {
        this.next();
        var rhs = [this.parseExpr()];
        while (this.eatOp(',')) rhs.push(this.parseExpr());
        return { t: 'assign', lhs: lhs, rhs: rhs, op: '=', line: tk.line };
      }
      throw new VError(this.peek().line, 'Không hiểu dấu "," ở đây (chỉ hỗ trợ gán nhiều a, b = c, d).');
    }
    if (this.atOp('=') || this.atOp('+=') || this.atOp('-=') || this.atOp('*=') || this.atOp('/=') || this.atOp('%=')) {
      var op = this.next().val;
      var rhs1 = this.parseExpr();
      return { t: 'assign', lhs: [expr], rhs: [rhs1], op: op, line: tk.line };
    }
    if (this.atOp('<<')) {
      this.next();
      var rhs2 = this.parseExpr();
      return { t: 'append', target: expr, value: rhs2, line: tk.line };
    }
    var stmt = { t: 'expr', expr: expr, line: tk.line };
    return this.wrapSuffix(stmt);
  };

  /* hậu tố `or { ... }` / `?` ở cuối câu lệnh khai báo/gán/biểu thức */
  Parser.prototype.wrapSuffix = function (stmt) {
    if (this.atId('or') && this.peek(1).type === 'op' && this.peek(1).val === '{') {
      this.next();
      var blk = this.parseBlock();
      stmt.orBlock = blk;
      return stmt;
    }
    if (this.atOp('?')) {
      this.next();
      stmt.propagate = true;
      return stmt;
    }
    return stmt;
  };

  Parser.prototype.parseIf = function () {
    var kw = this.next(); /* if */
    /* binding: if [mut] x := expr { } [else ...] */
    var save = this.pos;
    var isMut = this.eatId('mut');
    if (this.atId() && this.peek(1).type === 'op' && this.peek(1).val === ':=') {
      var bname = this.next().val;
      this.next(); /* := */
      var bexpr = this.parseExpr();
      var thenB = this.parseBlock();
      var elseB = null;
      if (this.eatId('else')) {
        elseB = this.atId('if') ? this.parseIf() : this.parseBlock();
      }
      return { t: 'ifBind', name: bname, expr: bexpr, then: thenB, else: elseB, line: kw.line };
    }
    this.pos = save;
    var cond = this.parseExpr();
    var thenB2 = this.parseBlock();
    var elseB2 = null;
    if (this.eatId('else')) {
      elseB2 = this.atId('if') ? this.parseIf() : this.parseBlock();
    }
    return { t: 'if', cond: cond, then: thenB2, else: elseB2, line: kw.line };
  };

  Parser.prototype.parseFor = function () {
    var kw = this.next(); /* for */
    /* for [mut] x [, y] in expr { } */
    var save = this.pos;
    this.eatId('mut');
    if (this.atId() || this.atOp('_')) {
      var v1;
      if (this.atOp('_')) { this.next(); v1 = '_'; }
      else v1 = this.next().val;
      var v2 = null;
      if (this.eatOp(',')) {
        if (this.atOp('_')) { this.next(); v2 = '_'; }
        else v2 = this.expectId('tên biến vòng for');
      }
      if (this.eatId('in')) {
        var iter = this.parseExpr();
        /* range a..b */
        if (iter.t === 'range') {
          return { t: 'forRange', var: v1, from: iter.from, to: iter.to, body: this.parseBlock(), line: kw.line };
        }
        return { t: 'forIn', vars: v2 ? [v1, v2] : [v1], iter: iter, body: this.parseBlock(), line: kw.line };
      }
      this.pos = save;
    } else {
      this.pos = save;
    }
    /* for cond { } — dạng while */
    var cond = this.parseExpr();
    return { t: 'while', cond: cond, body: this.parseBlock(), line: kw.line };
  };

  /* --- biểu thức (Pratt) --- */
  var BINPREC = {
    '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4,
    'in': 4, '!in': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6
  };

  Parser.prototype.parseExpr = function (minPrec) {
    minPrec = minPrec || 0;
    var left = this.parseUnary();
    for (;;) {
      var op = null, prec = 0;
      var tk = this.peek();
      if (tk.type === 'op' && BINPREC[tk.val] !== undefined) { op = tk.val; prec = BINPREC[op]; }
      else if (tk.type === 'id' && (tk.val === 'in')) { op = 'in'; prec = 4; }
      else if (tk.type === 'op' && tk.val === '!' && this.peek(1).type === 'id' && this.peek(1).val === 'in') {
        op = '!in'; prec = 4;
      }
      else if (tk.type === 'op' && tk.val === '..') { op = '..'; prec = 7; }
      if (!op || prec < minPrec) break;
      if (op === '!in') { this.next(); this.next(); }
      else this.next();
      var right = this.parseExpr(prec + 1);
      if (op === '..') left = { t: 'range', from: left, to: right, line: tk.line };
      else left = { t: 'bin', op: op, left: left, right: right, line: tk.line };
    }
    return left;
  };

  Parser.prototype.parseUnary = function () {
    var tk = this.peek();
    if (tk.type === 'id' && tk.val === 'mut') { this.next(); return this.parseUnary(); }
    if (tk.type === 'op' && (tk.val === '!' || tk.val === '-')) {
      this.next();
      return { t: 'unary', op: tk.val, expr: this.parseUnary(), line: tk.line };
    }
    if (tk.type === 'op' && tk.val === '&') {
      /* &Type{...} — struct literal lấy địa chỉ */
      var save = this.pos;
      this.next();
      var inner = this.parseUnary();
      if (inner.t === 'structLit') { inner.byRef = true; return inner; }
      this.pos = save;
    }
    return this.parsePostfix(this.parsePrimary());
  };

  Parser.prototype.parsePostfix = function (expr) {
    for (;;) {
      var tk = this.peek();
      if (tk.type === 'op' && tk.val === '.') {
        this.next();
        var fname = this.expectId('tên field/method sau dấu .');
        if (this.atOp('(')) {
          var args = this.parseArgs();
          expr = { t: 'call', callee: { t: 'field', obj: expr, name: fname, line: tk.line }, args: args, line: tk.line };
        } else if (this.atOp('[')) {
          /* method generic: obj.get_component[T]() */
          var g = this.tryGenericCall();
          if (g) {
            expr = { t: 'genericCall', callee: { t: 'field', obj: expr, name: fname, line: tk.line }, typeArg: g, args: this.parseArgs(), line: tk.line };
          } else {
            expr = { t: 'field', obj: expr, name: fname, line: tk.line };
          }
        } else {
          expr = { t: 'field', obj: expr, name: fname, line: tk.line };
        }
        continue;
      }
      if (tk.type === 'op' && tk.val === '[') {
        /* index — nhưng generic call đã xử lý ở trên; ở đây là arr[i] */
        this.next();
        var idx = this.parseExpr();
        this.expectOp(']');
        expr = { t: 'index', obj: expr, index: idx, line: tk.line };
        continue;
      }
      if (tk.type === 'op' && (tk.val === '++' || tk.val === '--')) {
        this.next();
        expr = { t: 'postfix', op: tk.val, expr: expr, line: tk.line };
        continue;
      }
      if (tk.type === 'id' && tk.val === 'or' && this.peek(1).type === 'op' && this.peek(1).val === '{') {
        this.next();
        var blk = this.parseBlock();
        expr = { t: 'orExpr', expr: expr, block: blk, line: tk.line };
        continue;
      }
      if (tk.type === 'op' && tk.val === '?') {
        this.next();
        expr = { t: 'propagate', expr: expr, line: tk.line };
        continue;
      }
      break;
    }
    return expr;
  };

  /* thử đọc [Type] rồi '(' — trả về tên kiểu (dạng chuỗi) hoặc null */
  Parser.prototype.tryGenericCall = function () {
    var save = this.pos;
    this.next(); /* [ */
    var parts = [];
    while (!this.atOp(']')) {
      var tk = this.next();
      if (tk.type === 'eof') { this.pos = save; return null; }
      parts.push(tk.val);
    }
    this.next(); /* ] */
    if (!this.atOp('(')) { this.pos = save; return null; }
    return parts.join('');
  };

  Parser.prototype.parseArgs = function () {
    this.expectOp('(');
    var args = [];
    while (!this.atOp(')')) {
      if (this.atId('mut')) this.next();
      args.push(this.parseExpr());
      if (!this.eatOp(',')) break;
    }
    this.expectOp(')');
    return args;
  };

  Parser.prototype.parsePrimary = function () {
    var tk = this.peek();
    if (tk.type === 'num') { this.next(); return { t: 'num', val: tk.val, line: tk.line }; }
    if (tk.type === 'str') {
      this.next();
      return { t: 'str', parts: tk.val, line: tk.line };
    }
    if (tk.type === 'id') {
      if (tk.val === 'true' || tk.val === 'false') { this.next(); return { t: 'bool', val: tk.val === 'true', line: tk.line }; }
      if (tk.val === 'none' || tk.val === 'nil') { this.next(); return { t: 'null', line: tk.line }; }
      if (tk.val === 'if') return this.parseIfExpr();
      if (tk.val === 'fn') return this.parseClosure();
      if (tk.val === 'unsafe') {
        this.next();
        var blk = this.parseBlock();
        /* unsafe { nil } → null; unsafe { expr } → expr; còn lại → null */
        if (blk.stmts.length === 1 && blk.stmts[0].t === 'expr') return blk.stmts[0].expr;
        if (blk.stmts.length === 0) return { t: 'null', line: tk.line };
        throw new VError(tk.line, 'Khối unsafe { ... } nhiều lệnh chỉ dùng được ở vị trí câu lệnh, không phải biểu thức.');
      }
      if (tk.val === 'C') throw new VError(tk.line, 'C interop (C.xxx) không dịch được sang JS.');
      /* đường dẫn ident(.ident)* */
      var parts = [this.next().val];
      while (this.atOp('.')) {
        this.next();
        parts.push(this.expectId('tên sau dấu .'));
      }
      var base = { t: 'ident', name: parts.join('.'), line: tk.line };
      /* generic call: name[Type](...) */
      if (this.atOp('[')) {
        var g = this.tryGenericCall();
        if (g !== null) {
          return { t: 'genericCall', callee: base, typeArg: g, args: this.parseArgs(), line: tk.line };
        }
      }
      if (this.atOp('(')) {
        return { t: 'call', callee: base, args: this.parseArgs(), line: tk.line };
      }
      if (this.atOp('{')) {
        /* struct literal Type{...} — CHỈ khi tên kiểu viết hoa
         * (core.Vec3, Projectile, Shared...). Nếu không, `xs {` trong
         * `for o in xs {` hay `active {` trong `if x.active {` sẽ bị
         * nuốt nhầm dấu { của khối lệnh. */
        var lastSeg = parts[parts.length - 1];
        if (/^[A-Z]/.test(lastSeg)) return this.parseStructLit(base);
        return base;
      }
      return base;
    }
    if (tk.type === 'op' && tk.val === '(') {
      this.next();
      var e = this.parseExpr();
      if (this.eatOp(',')) {
        var items = [e];
        while (true) { items.push(this.parseExpr()); if (!this.eatOp(',')) break; }
        this.expectOp(')');
        return { t: 'array', items: items, line: tk.line };
      }
      this.expectOp(')');
      return e;
    }
    if (tk.type === 'op' && tk.val === '[') {
      this.next();
      if (this.atOp(']')) {
        this.next();
        /* []Type{...} — array literal có kiểu: chỉ hỗ trợ rỗng */
        if (this.atId() || this.atOp('&')) {
          if (this.atOp('&')) this.next();
          var tp = [];
          while (this.atId() || this.atOp('.') || this.atOp('[') || this.atOp(']')) tp.push(this.next().val);
          if (this.atOp('{')) {
            this.next();
            this.expectOp('}');
            return { t: 'array', items: [], line: tk.line };
          }
          throw new VError(tk.line, 'Chỉ hỗ trợ []T{} rỗng, không hỗ trợ []T{...} có phần tử.');
        }
        return { t: 'array', items: [], line: tk.line };
      }
      var items = [this.parseExpr()];
      while (this.eatOp(',')) items.push(this.parseExpr());
      this.expectOp(']');
      return { t: 'array', items: items, line: tk.line };
    }
    if (tk.type === 'op' && tk.val === '.') {
      /* enum literal .space → 'space' */
      this.next();
      var en = this.expectId('tên enum sau dấu .');
      return { t: 'enumLit', val: en, line: tk.line };
    }
    if (tk.type === 'dollar') throw new VError(tk.line, '"' + tk.val + '" (comptime) không dịch được.');
    throw new VError(tk.line, 'Không hiểu biểu thức bắt đầu bằng "' + tk.val + '"');
  };

  /* if-expression: if cond { expr } else { expr } (kể cả else-if) */
  Parser.prototype.parseIfExpr = function () {
    var kw = this.next(); /* if */
    var cond = this.parseExpr();
    var thenB = this.parseBlock();
    var elseB = null;
    if (this.eatId('else')) {
      elseB = this.atId('if') ? this.parseIfExpr() : this.parseBlock();
    }
    return { t: 'ifExpr', cond: cond, then: thenB, else: elseB, line: kw.line };
  };

  /* closure: fn [mut x, y] (params) { body } */
  Parser.prototype.parseClosure = function () {
    var kw = this.next(); /* fn */
    if (this.atOp('[')) {
      this.next();
      while (!this.atOp(']')) this.next();
      this.expectOp(']');
    }
    var params = this.parseParams();
    /* kiểu trả về (bỏ qua) */
    if (this.peek().type === 'id' || this.atOp('?') || this.atOp('&')) {
      while (this.peek().type === 'id' || this.atOp('?') || this.atOp('&') || this.atOp('.') || this.atOp('[') || this.atOp(']')) {
        this.next();
        if (this.atOp('{')) break;
      }
    }
    var body = this.parseBlock();
    return { t: 'closure', params: params, body: body, line: kw.line };
  };

  /* struct literal: Type{ field: expr, ... } hoặc Type{ v1, v2 } */
  Parser.prototype.parseStructLit = function (base) {
    var open = this.peek();
    this.expectOp('{');
    var fields = [];
    var positional = [];
    var named = true;
    while (!this.atOp('}')) {
      if (this.peek().type === 'eof') throw new VError(open.line, 'Struct literal ' + base.name + ' chưa đóng }');
      /* field: name ':' expr  — hoặc positional expr */
      var save = this.pos;
      if (this.atId() && this.peek(1).type === 'op' && this.peek(1).val === ':') {
        var fname = this.next().val;
        this.next(); /* : */
        fields.push({ name: fname, value: this.parseExpr() });
      } else {
        this.pos = save;
        named = false;
        positional.push(this.parseExpr());
      }
      this.eatOp(',');
    }
    this.expectOp('}');
    return { t: 'structLit', type: base.name, fields: fields, positional: positional, named: named, line: open.line };
  };

  /* ================= CODEGEN V-AST → JS ================= */
  function Codegen(decls) {
    this.decls = decls;
    this.tmp = 0;
    this.structNames = {};
    this.fnNames = {};
    decls.forEach(function (d) {
      if (d.t === 'struct') this.structNames[d.name] = d;
      if (d.t === 'fn' && !d.receiver) this.fnNames[d.name] = d;
    }, this);
  }

  Codegen.prototype.newTmp = function (p) { return '__v' + (p || '') + (this.tmp++); };

  Codegen.prototype.gen = function () {
    var out = [];
    out.push('var VCodeModule = { classes: {}, functions: {} };');
    var self = this;
    /* methods gom theo struct */
    var methodsByType = {};
    this.decls.forEach(function (d) {
      if (d.t === 'fn' && d.receiver) {
        var rt = d.receiver.type;
        (methodsByType[rt] = methodsByType[rt] || []).push(d);
      }
    });
    Object.keys(methodsByType).forEach(function (rt) {
      if (!self.structNames[rt]) throw new VError(1, 'Method "' + methodsByType[rt][0].name + '" thuộc kiểu "' + rt + '" chưa khai báo struct.');
    });
    /* struct trước (const/fn có thể dùng chúng) */
    this.decls.forEach(function (d) {
      if (d.t === 'struct') out.push(self.genStruct(d, methodsByType[d.name] || []));
    });
    this.decls.forEach(function (d) {
      if (d.t === 'const') out.push(self.genConst(d));
      else if (d.t === 'fn' && !d.receiver) out.push(self.genTopFn(d));
    });
    return out.join('\n');
  };

  Codegen.prototype.defaultForType = function (type, ctx) {
    var t = (type || '').replace(/\s/g, '');
    if (!t) return 'null';
    if (t === 'core.Vec3') return 'VR.core.vec3(0, 0, 0)';
    if (t === 'core.Vec2') return 'VR.core.vec2(0, 0)';
    if (t === 'string') return "''";
    if (t === 'bool') return 'false';
    if (/f32|f64|int|i64|i32|u8|u16|u32|u64|rune/.test(t)) return '0';
    if (t.indexOf('[]') === 0) return '[]';
    if (t.indexOf('map[') === 0) return 'new Map()';
    if (t.charAt(0) === '&') return 'null';
    return 'null';
  };

  Codegen.prototype.genStruct = function (st, methods) {
    var ctx = this.baseCtx();
    var lines = [];
    lines.push('class ' + st.name + ' extends VR.Component {');
    lines.push('  constructor() {');
    lines.push('    super();');
    var self = this;
    st.fields.forEach(function (f) {
      var defJs = f.def ? self.genExpr(f.def, ctx) : self.defaultForType(f.type, ctx);
      lines.push('    this.' + f.name + ' = ' + defJs + ';');
    });
    lines.push('  }');
    methods.forEach(function (m) {
      lines.push(self.genMethod(m));
    });
    lines.push('}');
    lines.push(st.name + '.__fields = [' + st.fields.map(function (f) { return "'" + f.name + "'"; }).join(', ') + '];');
    lines.push('VCodeModule.classes.' + st.name + ' = ' + st.name + ';');
    return lines.join('\n');
  };

  Codegen.prototype.genConst = function (d) {
    var ctx = this.baseCtx();
    return 'var ' + d.name + ' = ' + this.genExpr(d.value, ctx) + ';';
  };

  Codegen.prototype.baseCtx = function () {
    return { receiver: null, typeParams: {}, scopes: [{}] };
  };

  Codegen.prototype.fnCtx = function (fn) {
    var ctx = this.baseCtx();
    ctx.receiver = fn.receiver ? fn.receiver.name : null;
    var scope = {};
    fn.params.forEach(function (p) { scope[p.name] = true; });
    if (fn.typeParams) fn.typeParams.forEach(function (tp, i) { ctx.typeParams[tp] = '__T' + i; });
    ctx.scopes = [scope];
    return ctx;
  };

  Codegen.prototype.genTopFn = function (fn) {
    var ctx = this.fnCtx(fn);
    var params = fn.params.map(function (p) { return p.name; });
    if (fn.typeParams) fn.typeParams.forEach(function (tp, i) { params.push('__T' + i); });
    var body = this.genBlock(fn.body, ctx, '  ');
    var code = 'function ' + fn.name + '(' + params.join(', ') + ') ' + body + '\nVCodeModule.functions.' + fn.name + ' = ' + fn.name + ';';
    return code;
  };

  Codegen.prototype.genMethod = function (fn) {
    var ctx = this.fnCtx(fn);
    var params = fn.params.map(function (p) { return p.name; });
    if (fn.typeParams) fn.typeParams.forEach(function (tp, i) { params.push('__T' + i); });
    var body = this.genBlock(fn.body, ctx, '    ');
    return '  ' + fn.name + '(' + params.join(', ') + ') ' + body;
  };

  Codegen.prototype.isShadowed = function (ctx, name) {
    for (var i = ctx.scopes.length - 1; i >= 0; i--) if (ctx.scopes[i][name]) return true;
    return false;
  };

  Codegen.prototype.genBlock = function (blk, ctx, indent) {
    ctx.scopes.push({});
    var lines = ['{'];
    var self = this;
    blk.stmts.forEach(function (s) {
      lines.push(self.genStmt(s, ctx, indent + '  '));
    });
    ctx.scopes.pop();
    lines.push(indent + '}');
    return lines.join('\n');
  };

  /* giá trị của khối if-expression: câu lệnh cuối phải là biểu thức */
  Codegen.prototype.blockValue = function (blk, ctx, indent) {
    if (!blk || !blk.stmts.length) throw new VError(blk ? blk.line : 1, 'Khối if-expression rỗng — cần một biểu thức.');
    var last = blk.stmts[blk.stmts.length - 1];
    if (last.t !== 'expr') throw new VError(last.line, 'Khối if-expression phải kết thúc bằng một biểu thức (không phải lệnh gán/if/return).');
    if (blk.stmts.length > 1) throw new VError(last.line, 'Khối if-expression chỉ được chứa một biểu thức duy nhất.');
    return this.genExpr(last.expr, ctx);
  };

  Codegen.prototype.declareNames = function (ctx, names) {
    var scope = ctx.scopes[ctx.scopes.length - 1];
    names.forEach(function (n) { if (n !== '_') scope[n] = true; });
  };

  /* --- câu lệnh --- */
  Codegen.prototype.genStmt = function (s, ctx, indent) {
    var self = this;
    function ind(txt) { return indent + txt; }
    switch (s.t) {
      case 'varDecl': {
        var rhs = s.values[0];
        /* a, b := f(), g() — nhiều giá trị */
        if (s.values.length > 1 || s.names.length > 1) {
          if (s.values.length === 1 && s.names.length > 1) {
            var v1 = self.genValueWithOr(s.values[0], ctx, indent);
            self.declareNames(ctx, s.names);
            return ind('let [' + s.names.join(', ') + '] = ' + v1 + ';');
          }
          var parts = s.values.map(function (v) { return 'VR.__copy(' + self.genExpr(v, ctx) + ')'; });
          self.declareNames(ctx, s.names);
          return ind('let [' + s.names.join(', ') + '] = [' + parts.join(', ') + '];');
        }
        if (s.propagate || (rhs && rhs.t === 'propagate')) {
          var propNode = (rhs && rhs.t === 'propagate') ? rhs : null;
          if (!propNode) throw new VError(s.line, 'Dấu ? chỉ đi sau một biểu thức trả về optional.');
          var inner = self.genExpr(propNode.expr, ctx);
          self.declareNames(ctx, s.names);
          return ind('let ' + s.names[0] + ' = VR.__copy(' + inner + ');\n' +
            ind('if (' + s.names[0] + ' == null) return null;'));
        }
        if (rhs && rhs.t === 'orExpr') return self.genOrStmt(rhs, ctx, indent, function (tmp) {
          self.declareNames(ctx, s.names);
          return ind('let ' + s.names[0] + ' = VR.__copy(' + tmp + ');');
        });
        var valJs = self.genExpr(rhs, ctx);
        self.declareNames(ctx, s.names);
        return ind('let ' + s.names[0] + ' = VR.__copy(' + valJs + ');');
      }
      case 'assign': {
        if (s.op === '=') {
          if (s.lhs.length > 1) {
            var rhss = s.rhs.map(function (v) { return 'VR.__copy(' + self.genExpr(v, ctx) + ')'; });
            var lhss = s.lhs.map(function (l) { return self.genExpr(l, ctx); });
            return ind('[' + lhss.join(', ') + '] = [' + rhss.join(', ') + '];');
          }
          var l = s.lhs[0], r = s.rhs[0];
          if (r && r.t === 'orExpr') return self.genOrStmt(r, ctx, indent, function (tmp) {
            return ind(self.genAssignLine(l, ctx, 'VR.__copy(' + tmp + ')'));
          });
          if (r && r.t === 'propagate') throw new VError(s.line, 'Dấu ? ở vế phải của phép gán chưa được hỗ trợ — dùng := thay thế.');
          return ind(self.genAssignLine(l, ctx, 'VR.__copy(' + self.genExpr(r, ctx) + ')'));
        }
        /* += -= *= /= %= — chỉ dùng cho số trong subset này */
        var l2 = s.lhs[0];
        if (l2.t === 'index') {
          var cur = 'VR.__getIndex(' + self.genExpr(l2.obj, ctx) + ', ' + self.genExpr(l2.index, ctx) + ')';
          return ind('VR.__setIndex(' + self.genExpr(l2.obj, ctx) + ', ' + self.genExpr(l2.index, ctx) + ', ' + cur + ' ' + s.op.slice(0, 1) + ' (' + self.genExpr(s.rhs[0], ctx) + '));');
        }
        return ind(self.genExpr(l2, ctx) + ' ' + s.op + ' (' + self.genExpr(s.rhs[0], ctx) + ');');
      }
      case 'append':
        return ind('VR.__append(' + self.genExpr(s.target, ctx) + ', ' + self.genExpr(s.value, ctx) + ');');
      case 'expr': {
        var e = s.expr;
        if (e.t === 'orExpr') return self.genOrStmt(e, ctx, indent, function () { return ''; });
        if (e.t === 'propagate') {
          return ind('if (VR.__copy(' + self.genExpr(e.expr, ctx) + ') == null) return null;');
        }
        return ind(self.genExpr(e, ctx) + ';');
      }
      case 'if': {
        var code = ind('if (' + self.genExpr(s.cond, ctx) + ') ' + self.genBlock(s.then, ctx, indent));
        if (s.else) {
          code += ' else ' + (s.else.t === 'if' ? self.genStmt(s.else, ctx, indent).replace(/^ +/, '') : self.genBlock(s.else, ctx, indent));
        }
        return code;
      }
      case 'ifBind': {
        var tmp = self.newTmp('b');
        var thenCode, elseCode = '';
        ctx.scopes.push({});
        var code2 = ind('let ' + tmp + ' = (' + self.genExpr(s.expr, ctx) + ');');
        ctx.scopes.pop();
        ctx.scopes.push({});
        ctx.scopes[ctx.scopes.length - 1][s.name] = true;
        var thenBlk = self.genBlockWithDecl(s.then, ctx, indent, s.name, tmp);
        ctx.scopes.pop();
        var out2 = code2 + '\n' + ind('if (' + tmp + ' != null) ' + thenBlk);
        if (s.else) {
          out2 += ' else ' + (s.else.t === 'if' ? self.genStmt(s.else, ctx, indent).replace(/^ +/, '') : self.genBlock(s.else, ctx, indent));
        }
        return out2;
      }
      case 'while':
        return ind('while (' + self.genExpr(s.cond, ctx) + ') ' + self.genBlock(s.body, ctx, indent));
      case 'forRange': {
        ctx.scopes.push({});
        ctx.scopes[ctx.scopes.length - 1][s.var] = true;
        var blk = self.genBlock(s.body, ctx, indent);
        ctx.scopes.pop();
        return ind('for (let ' + s.var + ' = (' + self.genExpr(s.from, ctx) + '); ' + s.var + ' < (' + self.genExpr(s.to, ctx) + '); ' + s.var + '++) ' + blk);
      }
      case 'forIn': {
        ctx.scopes.push({});
        s.vars.forEach(function (v) { if (v !== '_') ctx.scopes[ctx.scopes.length - 1][v] = true; });
        var blk2 = self.genBlock(s.body, ctx, indent);
        ctx.scopes.pop();
        if (s.vars.length === 2) {
          return ind('for (const [' + s.vars[0] + ', ' + s.vars[1] + '] of VR.__entries(' + self.genExpr(s.iter, ctx) + ')) ' + blk2);
        }
        return ind('for (const ' + s.vars[0] + ' of (' + self.genExpr(s.iter, ctx) + ')) ' + blk2);
      }
      case 'return': {
        if (!s.values.length) return ind('return;');
        if (s.values.length === 1) return ind('return VR.__copy(' + self.genExpr(s.values[0], ctx) + ');');
        var vs = s.values.map(function (v) { return 'VR.__copy(' + self.genExpr(v, ctx) + ')'; });
        return ind('return [' + vs.join(', ') + '];');
      }
      case 'break': return ind('break;');
      case 'continue': return ind('continue;');
      case 'unsafeBlock': {
        var lines = [ind('{')];
        s.body.stmts.forEach(function (st) { lines.push(self.genStmt(st, ctx, indent + '  ')); });
        lines.push(ind('}'));
        return lines.join('\n');
      }
      default:
        throw new VError(s.line || 1, 'Câu lệnh chưa được hỗ trợ: ' + s.t);
    }
  };

  /* khối then của ifBind: câu lệnh đầu là `let name = __copy(tmp)` */
  Codegen.prototype.genBlockWithDecl = function (blk, ctx, indent, name, tmp) {
    var lines = ['{'];
    lines.push(indent + '  let ' + name + ' = VR.__copy(' + tmp + ');');
    var self = this;
    blk.stmts.forEach(function (s) { lines.push(self.genStmt(s, ctx, indent + '  ')); });
    lines.push(indent + '}');
    return lines.join('\n');
  };

  /* or { } nhiều lệnh ở cuối lệnh gán/khai báo:
   *   let __orN = (expr); if (__orN == null) { let err = null; ...block }
   * rồi gọi after(tmp) để gán/khai báo từ tmp. */
  Codegen.prototype.genOrStmt = function (orNode, ctx, indent, after) {
    var tmp = this.newTmp('or');
    var lines = [];
    lines.push(indent + 'let ' + tmp + ' = (' + this.genExpr(orNode.expr, ctx) + ');');
    ctx.scopes.push({ err: true });
    var blkLines = [indent + 'if (' + tmp + ' == null) {'];
    blkLines.push(indent + '  let err = null;');
    var self = this;
    orNode.block.stmts.forEach(function (st) { blkLines.push(self.genStmt(st, ctx, indent + '  ')); });
    blkLines.push(indent + '}');
    ctx.scopes.pop();
    lines.push(blkLines.join('\n'));
    var tail = after(tmp);
    if (tail) lines.push(tail);
    return lines.join('\n');
  };

  /* một dòng gán đầy đủ: index trên Map phải qua __setIndex */
  Codegen.prototype.genAssignLine = function (lhs, ctx, rhsJs) {
    if (lhs.t === 'index') {
      return 'VR.__setIndex(' + this.genExpr(lhs.obj, ctx) + ', ' + this.genExpr(lhs.index, ctx) + ', ' + rhsJs + ');';
    }
    return this.genExpr(lhs, ctx) + ' = ' + rhsJs + ';';
  };

  /* --- biểu thức --- */
  Codegen.prototype.genExpr = function (n, ctx) {
    var self = this;
    switch (n.t) {
      case 'num': return n.val;
      case 'bool': return n.val ? 'true' : 'false';
      case 'null': return 'null';
      case 'enumLit': return "'" + n.val + "'";
      case 'str': {
        var out = '`';
        n.parts.forEach(function (p) {
          if (p.text !== undefined) {
            out += p.text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
          } else {
            var sub = new Parser(tokenize(p.expr));
            var ast = sub.parseExpr();
            out += '${' + self.genExpr(ast, ctx) + '}';
          }
        });
        return out + '`';
      }
      case 'ident': return this.genIdent(n.name, ctx);
      case 'field': {
        if (n.name === 'len') return 'VR.__len(' + this.genExpr(n.obj, ctx) + ')';
        return this.genExpr(n.obj, ctx) + '.' + n.name;
      }
      case 'index':
        return 'VR.__getIndex(' + this.genExpr(n.obj, ctx) + ', ' + this.genExpr(n.index, ctx) + ')';
      case 'array':
        return '[' + n.items.map(function (it) { return self.genExpr(it, ctx); }).join(', ') + ']';
      case 'call': return this.genCall(n, ctx);
      case 'genericCall': return this.genGenericCall(n, ctx);
      case 'structLit': return this.genStructLit(n, ctx);
      case 'bin': {
        var l = this.genExpr(n.left, ctx), r = this.genExpr(n.right, ctx);
        switch (n.op) {
          case '+': return 'VR.__add(' + l + ', ' + r + ')';
          case '-': return 'VR.__sub(' + l + ', ' + r + ')';
          case '*': return 'VR.__mul(' + l + ', ' + r + ')';
          case '/': return 'VR.__div(' + l + ', ' + r + ')';
          case '%': return '(' + l + ' % ' + r + ')';
          case '==': return '(' + l + ' == ' + r + ')';
          case '!=': return '(' + l + ' != ' + r + ')';
          case '<': return '(' + l + ' < ' + r + ')';
          case '<=': return '(' + l + ' <= ' + r + ')';
          case '>': return '(' + l + ' > ' + r + ')';
          case '>=': return '(' + l + ' >= ' + r + ')';
          case '&&': return '(' + l + ' && ' + r + ')';
          case '||': return '(' + l + ' || ' + r + ')';
          case 'in': return 'VR.__in(' + l + ', ' + r + ')';
          case '!in': return '(!VR.__in(' + l + ', ' + r + '))';
          default: throw new VError(n.line, 'Toán tử "' + n.op + '" chưa được hỗ trợ.');
        }
      }
      case 'unary':
        return n.op === '!' ? '(!' + this.genExpr(n.expr, ctx) + ')' : '(-' + this.genExpr(n.expr, ctx) + ')';
      case 'postfix':
        return '(' + this.genExpr(n.expr, ctx) + n.op + ')';
      case 'ifExpr': {
        var thenV = this.blockValue(n.then, ctx);
        var elseV = n.else ? (n.else.t === 'ifExpr' ? this.genExpr(n.else, ctx) : this.blockValue(n.else, ctx)) : 'null';
        return '(' + this.genExpr(n.cond, ctx) + ' ? ' + thenV + ' : ' + elseV + ')';
      }
      case 'closure': {
        var cctx = { receiver: ctx.receiver, typeParams: ctx.typeParams, scopes: ctx.scopes.slice() };
        cctx.scopes.push({});
        n.params.forEach(function (p) { cctx.scopes[cctx.scopes.length - 1][p.name] = true; });
        var params = n.params.map(function (p) { return p.name; }).join(', ');
        var body = this.genBlock(n.body, cctx, '  ');
        return '((' + params + ') => ' + body + ')';
      }
      case 'orExpr': {
        /* chỉ dạng 1 biểu thức mới dùng được trong biểu thức */
        if (n.block.stmts.length === 1 && n.block.stmts[0].t === 'expr') {
          return 'VR.__orVal((' + this.genExpr(n.expr, ctx) + '), () => (' + this.genExpr(n.block.stmts[0].expr, ctx) + '))';
        }
        throw new VError(n.line, 'or { ... } nhiều lệnh chỉ dùng được ở cuối lệnh gán/khai báo (:= hoặc =), không dùng được giữa biểu thức.');
      }
      case 'propagate':
        throw new VError(n.line, 'Toán tử ? (trả về none sớm) chỉ hỗ trợ ở cuối lệnh gán/khai báo (:=), không dùng được giữa biểu thức.');
      case 'range':
        throw new VError(n.line, 'Toán tử .. (range) chỉ dùng trong vòng for.');
      default:
        throw new VError(n.line || 1, 'Biểu thức chưa được hỗ trợ: ' + n.t);
    }
  };

  /* identifier (có thể là đường dẫn a.b.c): map module, receiver→this,
   * .len → __len, cast, println/eprintln. */
  Codegen.prototype.genIdent = function (name, ctx) {
    if (name === 'eprintln') return 'console.error';
    if (name === 'println' || name === 'print') return 'console.log';
    var parts = name.split('.');
    var first = parts[0];
    if (parts.length === 1) {
      if (ctx.receiver && first === ctx.receiver && !this.isShadowed(ctx, first)) return 'this';
      return first;
    }
    /* .len ở cuối đường dẫn (stack.len, m.clips.len, h.base.len):
     * array → .length, Map → .size */
    if (parts[parts.length - 1] === 'len') {
      return 'VR.__len(' + this.genIdent(parts.slice(0, -1).join('.'), ctx) + ')';
    }
    /* đường dẫn có chấm */
    if (first === 'math') {
      var rest = parts.slice(1);
      if (rest[0] === 'pi') rest[0] = 'PI';
      return 'Math.' + rest.join('.');
    }
    if (first === 'rand') return 'VR.rand.' + parts.slice(1).join('.');
    if (first === 'core') return 'VR.core.' + parts.slice(1).join('.');
    if (first === 'render3d') return 'VR.render3d.' + parts.slice(1).join('.');
    if (first === 'render') return 'VR.render.' + parts.slice(1).join('.');
    if (first === 'assets') return 'VR.assets.' + parts.slice(1).join('.');
    if (first === 'velo') return 'VR.' + parts.slice(1).join('.');
    if (ctx.receiver && first === ctx.receiver && !this.isShadowed(ctx, first)) {
      return 'this.' + parts.slice(1).join('.');
    }
    return name;
  };

  Codegen.prototype.genCall = function (n, ctx) {
    var callee = n.callee;
    var args = n.args.map(function (a) { return this.genExpr(a, ctx); }, this);
    /* cast: f32(x)/int(x)/u8(x)/voidptr(x)... */
    if (callee.t === 'ident') {
      var nm = callee.name;
      if (nm === 'voidptr') return '(' + (args[0] || 'null') + ')';
      if (nm === 'f32' || nm === 'f64') return 'Number(' + (args[0] || '0') + ')';
      if (nm === 'int' || nm === 'i64' || nm === 'i32' || nm === 'u16' || nm === 'u32' || nm === 'u64') return 'Math.trunc(' + (args[0] || '0') + ')';
      if (nm === 'u8') return 'VR.__u8(' + (args[0] || '0') + ')';
      if (nm === 'bool') return 'Boolean(' + (args[0] || 'false') + ')';
      if (nm === 'string') return 'String(' + (args[0] || "''") + ')';
      return this.genIdent(nm, ctx) + '(' + args.join(', ') + ')';
    }
    /* callee là field: obj.method(...) */
    var objJs = this.genExpr(callee.obj, ctx);
    return objJs + '.' + callee.name + '(' + args.join(', ') + ')';
  };

  Codegen.prototype.genGenericCall = function (n, ctx) {
    var typeJs;
    if (ctx.typeParams && ctx.typeParams[n.typeArg] !== undefined) {
      typeJs = ctx.typeParams[n.typeArg];
    } else {
      var short = n.typeArg.split('.').pop();
      typeJs = "'" + short + "'";
    }
    var args = n.args.map(function (a) { return this.genExpr(a, ctx); }, this);
    args.push(typeJs);
    if (n.callee.t === 'field') {
      return this.genExpr(n.callee.obj, ctx) + '.' + n.callee.name + '(' + args.join(', ') + ')';
    }
    return this.genIdent(n.callee.name, ctx) + '(' + args.join(', ') + ')';
  };

  Codegen.prototype.genStructLit = function (n, ctx) {
    var type = n.type;
    if (type === 'core.Vec3') {
      if (n.named) {
        var fx = this.fieldVal(n.fields, 'x', '0', ctx), fy = this.fieldVal(n.fields, 'y', '0', ctx), fz = this.fieldVal(n.fields, 'z', '0', ctx);
        return 'VR.core.vec3(' + fx + ', ' + fy + ', ' + fz + ')';
      }
      var p = n.positional.map(function (e) { return this.genExpr(e, ctx); }, this);
      while (p.length < 3) p.push('0');
      return 'VR.core.vec3(' + p.slice(0, 3).join(', ') + ')';
    }
    if (type === 'core.Vec2') {
      if (n.named) {
        return 'VR.core.vec2(' + this.fieldVal(n.fields, 'x', '0', ctx) + ', ' + this.fieldVal(n.fields, 'y', '0', ctx) + ')';
      }
      var p2 = n.positional.map(function (e) { return this.genExpr(e, ctx); }, this);
      while (p2.length < 2) p2.push('0');
      return 'VR.core.vec2(' + p2.slice(0, 2).join(', ') + ')';
    }
    if (type.indexOf('.') >= 0) {
      /* kiểu của engine (render3d.Transform3D...) → descriptor */
      var short = type.split('.').pop();
      var fields = n.fields.map(function (f) { return f.name + ': ' + this.genExpr(f.value, ctx); }, this).join(', ');
      return 'VR.__comp(\'' + short + '\', {' + fields + '})';
    }
    if (this.structNames[type]) {
      var fs = n.fields.map(function (f) { return f.name + ': ' + this.genExpr(f.value, ctx); }, this).join(', ');
      return 'VR.__make(' + type + ', {' + fs + '})';
    }
    /* kiểu lạ: trả về object thường */
    var fs2 = n.fields.map(function (f) { return f.name + ': ' + this.genExpr(f.value, ctx); }, this).join(', ');
    return '({' + fs2 + '})';
  };

  Codegen.prototype.fieldVal = function (fields, name, def, ctx) {
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].name === name) return this.genExpr(fields[i].value, ctx);
    }
    return def;
  };

  /* ================= VR — VeloRuntime =================
   * Object JS duy nhất mà code V dịch ra được gọi. Ánh xạ tên V sang
   * hàm JS thật: core.vec2/vec3, math.*, core.rgba, scene.find,
   * scene.store, input(), node.get_component/find/add_child,
   * Transform3D (position/rotation/scale + turn_toward/face/forward),
   * lifecycle component start/update.
   *
   * Quy ước đơn vị: Transform3D.rotation dùng ĐỘ (như Velo) khi code V
   * đọc/ghi; bên dưới tự đổi sang radian cho THREE (rotation của
   * THREE là radian). position/scale dùng mét, giống Velo.
   * Vec3 là kiểu giá trị trong V: gán/khai báo/trả về đều CLONE
   * (qua VR.__copy) để `home = tr.position` không bị kéo theo khi
   * tr.position đổi — xem Codegen.
   * ============================================================ */
  function rad2deg(r) { return r * 180 / Math.PI; }
  function deg2rad(d) { return d * Math.PI / 180; }
  function clampNum(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function wrapDeg(d) {
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  function Vec3(a, b, c) {
    if (a && typeof a === 'object' && 'x' in a && 'y' in a && 'z' in a) this._b = a;
    else this._b = { x: a || 0, y: b || 0, z: c || 0 };
  }
  Object.defineProperties(Vec3.prototype, {
    x: { get: function () { return this._b.x; }, set: function (v) { this._b.x = v; } },
    y: { get: function () { return this._b.y; }, set: function (v) { this._b.y = v; } },
    z: { get: function () { return this._b.z; }, set: function (v) { this._b.z = v; } }
  });
  Vec3.prototype.clone = function () { return new Vec3({ x: this.x, y: this.y, z: this.z }); };
  Vec3.prototype.length = function () { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); };
  Vec3.prototype.normalized = function () {
    var l = this.length();
    return l > 0 ? new Vec3({ x: this.x / l, y: this.y / l, z: this.z / l }) : new Vec3({ x: 0, y: 0, z: 0 });
  };
  Vec3.prototype.mul = function (s) { return new Vec3({ x: this.x * s, y: this.y * s, z: this.z * s }); };
  Vec3.prototype.add = function (v) { return new Vec3({ x: this.x + v.x, y: this.y + v.y, z: this.z + v.z }); };
  Vec3.prototype.sub = function (v) { return new Vec3({ x: this.x - v.x, y: this.y - v.y, z: this.z - v.z }); };
  Vec3.prototype.dot = function (v) { return this.x * v.x + this.y * v.y + this.z * v.z; };
  Vec3.prototype.distance = function (v) { return this.sub(v).length(); };
  Vec3.prototype.lerp = function (t, k) {
    return new Vec3({ x: this.x + (t.x - this.x) * k, y: this.y + (t.y - this.y) * k, z: this.z + (t.z - this.z) * k });
  };

  function Vec2(a, b) {
    if (a && typeof a === 'object' && 'x' in a && 'y' in a) this._b = a;
    else this._b = { x: a || 0, y: b || 0 };
  }
  Object.defineProperties(Vec2.prototype, {
    x: { get: function () { return this._b.x; }, set: function (v) { this._b.x = v; } },
    y: { get: function () { return this._b.y; }, set: function (v) { this._b.y = v; } }
  });
  Vec2.prototype.clone = function () { return new Vec2({ x: this.x, y: this.y }); };
  Vec2.prototype.length = function () { return Math.sqrt(this.x * this.x + this.y * this.y); };
  Vec2.prototype.normalized = function () {
    var l = this.length();
    return l > 0 ? new Vec2({ x: this.x / l, y: this.y / l }) : new Vec2({ x: 0, y: 0 });
  };
  Vec2.prototype.mul = function (s) { return new Vec2({ x: this.x * s, y: this.y * s }); };
  Vec2.prototype.add = function (v) { return new Vec2({ x: this.x + v.x, y: this.y + v.y }); };
  Vec2.prototype.sub = function (v) { return new Vec2({ x: this.x - v.x, y: this.y - v.y }); };
  Vec2.prototype.dot = function (v) { return this.x * v.x + this.y * v.y; };
  Vec2.prototype.distance = function (v) { return this.sub(v).length(); };

  function isVec(v) { return v instanceof Vec3 || v instanceof Vec2; }

  function __copy(v) { return isVec(v) ? v.clone() : v; }
  function __add(a, b) {
    if (isVec(a) && isVec(b)) return a.add(b);
    if (isVec(a) && typeof b === 'number') return a.mul(1).add(typeof b === 'number' ? new (a instanceof Vec3 ? Vec3 : Vec2)({ x: b, y: b, z: b }) : b);
    if (typeof a === 'number' && isVec(b)) return b.add(new (b instanceof Vec3 ? Vec3 : Vec2)({ x: a, y: a, z: a }));
    if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b);
    return a + b;
  }
  function __sub(a, b) {
    if (isVec(a) && isVec(b)) return a.sub(b);
    if (isVec(a) && typeof b === 'number') return a.add(new (a instanceof Vec3 ? Vec3 : Vec2)({ x: -b, y: -b, z: -b }));
    if (typeof a === 'number' && isVec(b)) return new (b instanceof Vec3 ? Vec3 : Vec2)({ x: a - b.x, y: a - b.y, z: (b instanceof Vec3 ? a - b.z : 0) });
    return a - b;
  }
  function __mul(a, b) {
    if (isVec(a) && typeof b === 'number') return a.mul(b);
    if (typeof a === 'number' && isVec(b)) return b.mul(a);
    return a * b;
  }
  function __div(a, b) {
    if (isVec(a) && typeof b === 'number') return a.mul(1 / b);
    return a / b;
  }
  function __in(x, c) {
    if (c == null) return false;
    if (c instanceof Map) return c.has(x);
    if (Array.isArray(c)) return c.indexOf(x) >= 0;
    if (typeof c === 'string') return c.indexOf(x) >= 0;
    return x in c;
  }
  function __getIndex(o, k) {
    if (o == null) return undefined;
    if (o instanceof Map) return o.get(k);
    return o[k];
  }
  function __setIndex(o, k, v) {
    if (o instanceof Map) { o.set(k, v); return v; }
    o[k] = v;
    return v;
  }
  function __append(a, x) {
    if (Array.isArray(x)) { for (var i = 0; i < x.length; i++) a.push(x[i]); }
    else a.push(x);
    return a;
  }
  function __entries(m) {
    if (m instanceof Map) return Array.from(m.entries());
    if (Array.isArray(m)) return m.map(function (v, i) { return [i, v]; });
    if (m && typeof m === 'object') return Object.keys(m).map(function (k) { return [k, m[k]]; });
    return [];
  }
  function __orVal(v, fn) { return v == null ? fn() : v; }
  function __len(x) {
    if (x == null) return 0;
    if (typeof x.length === 'number') return x.length;
    if (x instanceof Map) return x.size;
    if (typeof x.size === 'number') return x.size;
    return 0;
  }
  function __u8(x) { return clampNum(Math.trunc(x) || 0, 0, 255); }
  function __make(Cls, fields) {
    var o = new Cls();
    if (fields) for (var k in fields) o[k] = fields[k];
    return o;
  }
  function __comp(type, fields) {
    var o = { __vcomp: type };
    if (fields) for (var k in fields) o[k] = fields[k];
    return o;
  }

  /* ---------- Component cơ sở: node / scene() / input() ---------- */
  function Component() {
    this.node = null;
    this.__vr = null;
  }
  Component.prototype.scene = function () { return this.__vr ? this.__vr.scene : null; };
  Component.prototype.input = function () { return this.__vr ? this.__vr.input : null; };

  /* ---------- Transform3D: rotation theo ĐỘ (như Velo) ---------- */
  function Transform3D(node) {
    this._node = node;
    var obj = node._obj;
    /* backing đổi độ ↔ radian cho rotation */
    var rotBacking = {};
    ['x', 'y', 'z'].forEach(function (axis) {
      Object.defineProperty(rotBacking, axis, {
        get: function () { return rad2deg(obj.rotation[axis]); },
        set: function (v) { obj.rotation[axis] = deg2rad(v); },
        enumerable: true
      });
    });
    this._rotBacking = rotBacking;
  }
  Object.defineProperties(Transform3D.prototype, {
    position: {
      get: function () { return new Vec3(this._node._obj.position); },
      set: function (v) { var p = this._node._obj.position; p.x = v.x; p.y = v.y; p.z = v.z; }
    },
    rotation: {
      get: function () { return new Vec3(this._rotBacking); },
      set: function (v) { var r = this._node._obj.rotation; r.x = deg2rad(v.x); r.y = deg2rad(v.y); r.z = deg2rad(v.z); }
    },
    scale: {
      get: function () { return new Vec3(this._node._obj.scale); },
      set: function (v) { var s = this._node._obj.scale; s.x = v.x; s.y = v.y; s.z = v.z; }
    }
  });
  Transform3D.prototype.forward = function () {
    var yaw = deg2rad(this.rotation.y);
    return new Vec3({ x: Math.sin(yaw), y: 0, z: Math.cos(yaw) });
  };
  Transform3D.prototype.face = function (dir) {
    this.rotation.y = rad2deg(Math.atan2(dir.x, dir.z));
  };
  Transform3D.prototype.turn_toward = function (dir, maxDeg) {
    var target = rad2deg(Math.atan2(dir.x, dir.z));
    var cur = this.rotation.y;
    var diff = wrapDeg(target - cur);
    var step = clampNum(diff, -Math.abs(maxDeg), Math.abs(maxDeg));
    this.rotation.y = cur + step;
  };

  /* ---------- Node ---------- */
  function Node(name, obj, vr) {
    this.name = name || '';
    this._obj = obj || { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, name: name || '' };
    this.parent = null;
    this.children = [];
    this.active = true;
    this._comps = new Map();
    this._transform = null;
    this.__vr = vr || null;
  }
  Node.prototype.transform = function () {
    if (!this._transform) this._transform = new Transform3D(this);
    return this._transform;
  };
  Node.prototype.find = function (path) {
    var parts = String(path || '').split('/').filter(function (s) { return s !== ''; });
    var cur = this;
    if (parts.length && parts[0] === cur.name) parts.shift();
    for (var i = 0; i < parts.length; i++) {
      var next = null;
      for (var j = 0; j < cur.children.length; j++) {
        if (cur.children[j].name === parts[i]) { next = cur.children[j]; break; }
      }
      if (!next) return null;
      cur = next;
    }
    return cur;
  };
  Node.prototype.get_component = function (type) {
    if (type === 'Transform3D') return this.transform();
    if (this._comps.has(type)) return this._comps.get(type);
    return null;
  };
  Node.prototype.get_components = function (type) {
    var out = [];
    if (type === 'Transform3D') { out.push(this.transform()); return out; }
    if (this._comps.has(type)) out.push(this._comps.get(type));
    return out;
  };
  Node.prototype.add_component = function (comp) {
    if (!comp) return null;
    if (comp instanceof Component) {
      comp.node = this;
      comp.__vr = this.__vr;
      var nm = comp.constructor.__vname || comp.constructor.name || 'Component';
      this._comps.set(nm, comp);
      return comp;
    }
    if (comp.__vcomp) {
      if (comp.__vcomp === 'Transform3D') {
        var tr = this.transform();
        if (comp.position) tr.position = comp.position;
        if (comp.rotation) tr.rotation = comp.rotation;
        if (comp.scale) tr.scale = comp.scale;
        return tr;
      }
      this._comps.set(comp.__vcomp, comp);
      return comp;
    }
    return comp;
  };
  Node.prototype.add_child = function (node) {
    if (!node) return null;
    node.parent = this;
    node.__vr = this.__vr;
    this.children.push(node);
    try {
      /* chỉ add khi cả 2 đều là THREE Object3D — node con ảo của cầu
       * nối (Trail/Dust/Body...) dùng object thường, không add */
      if (this._obj && this._obj.add && node._obj && node._obj.isObject3D) this._obj.add(node._obj);
    } catch (e) { /* THREE object có thể không add được — node logic vẫn chạy */ }
    return node;
  };
  Node.prototype.destroy = function () {
    this.active = false;
    if (this.parent) {
      var idx = this.parent.children.indexOf(this);
      if (idx >= 0) this.parent.children.splice(idx, 1);
      this.parent = null;
    }
    try {
      if (this._obj && this._obj.parent && this._obj.parent.remove) this._obj.parent.remove(this._obj);
    } catch (e) { }
  };
  Node.prototype.after = function (delay, fn) {
    var vr = this.__vr;
    var id = setTimeout(function () { try { fn(); } catch (e) { if (vr && vr.log) vr.log.error('[VCode] lỗi trong after():', e); } }, Math.max(0, (delay || 0) * 1000));
    if (vr) vr._timers.push(id);
    return id;
  };
  Node.new = function (name, vr, createObject) {
    var obj = null;
    try { if (createObject) obj = createObject(name); } catch (e) { obj = null; }
    var node = new Node(name, obj, vr || null);
    return node;
  };

  /* ---------- Store: get/set int/string/bool, đồng bộ qua hooks ---------- */
  function makeStore(hooks) {
    var m = new Map();
    function get(k, dflt) {
      if (hooks.getStore) {
        var v = hooks.getStore(k);
        if (v !== undefined) return v;
      }
      var v2 = m.get(k);
      return v2 === undefined ? dflt : v2;
    }
    function set(k, v) {
      m.set(k, v);
      if (hooks.onStoreSet) { try { hooks.onStoreSet(k, v); } catch (e) { } }
    }
    return {
      _m: m,
      get_int: function (k, d) { var v = get(k, d === undefined ? 0 : d); return typeof v === 'number' ? Math.trunc(v) : (parseInt(v, 10) || 0); },
      set_int: function (k, v) { set(k, Math.trunc(v)); },
      get_string: function (k, d) { var v = get(k, d === undefined ? '' : d); return v === undefined || v === null ? '' : String(v); },
      set_string: function (k, v) { set(k, String(v)); },
      get_bool: function (k, d) { var v = get(k, d === undefined ? false : d); return !!v; },
      set_bool: function (k, v) { set(k, !!v); },
      get: function (k, d) { return get(k, d); },
      set: function (k, v) { set(k, v); }
    };
  }

  /* ---------- makeRuntime(hooks) → VR ---------- */
  function makeRuntime(hooks) {
    hooks = hooks || {};
    var log = hooks.log || (typeof console !== 'undefined' ? console : { log: function () { }, error: function () { }, warn: function () { } });
    var timers = [];

    var store = makeStore(hooks);

    var rootNode = new Node('World', null, null);
    var scene = {
      root: rootNode,
      store: store,
      unscaled_dt: 0.016,
      find: function (path) { return rootNode.find(path); },
      after: function (delay, fn) {
        var id = setTimeout(function () { try { fn(); } catch (e) { log.error('[VCode] lỗi trong scene.after():', e); } }, Math.max(0, (delay || 0) * 1000));
        timers.push(id);
        return id;
      },
      instantiate: function () { return null; } /* chưa hỗ trợ spawn prefab từ V — xem docs */
    };
    Object.defineProperty(scene, 'time', {
      get: function () { return hooks.now ? hooks.now() : 0; }
    });

    var inputState = hooks.inputState || function () {
      return { ax: 0, ay: 0, keys: {}, pressed: {}, mouseDown: false, mousePressed: false, mouseReleased: false, mouseX: 0, mouseY: 0 };
    };
    var input = {
      axis_x: function () { return inputState().ax || 0; },
      axis_y: function () { return inputState().ay || 0; },
      axis: function (a, b) {
        var s = inputState();
        function pressed(k) {
          if (!k) return false;
          var key = String(k).toLowerCase();
          if (s.pressed && s.pressed[key]) return true;
          if (s.keys) {
            if (s.keys['Key' + key.toUpperCase()]) return true;
            if (key === 'space' && (s.keys.Space || s.keys['Space'])) return true;
            if (key === 'left_shift' && (s.keys.ShiftLeft || s.keys.ShiftRight)) return true;
          }
          return false;
        }
        return (pressed(a) ? 1 : 0) - (pressed(b) ? 1 : 0);
      },
      was_pressed: function (key) {
        var s = inputState();
        var k = String(key || '').toLowerCase();
        if (s.pressed && s.pressed[k]) return true;
        if (s.pressed) {
          if (k === 'space' && s.pressed['space']) return true;
          if ((k === 'left_shift' || k === 'shift') && (s.pressed['left_shift'] || s.pressed['shift'])) return true;
        }
        return false;
      },
      get mouse_down() { return !!inputState().mouseDown; },
      get mouse_pressed() { return !!inputState().mousePressed; },
      get mouse_released() { return !!inputState().mouseReleased; },
      get mouse() { var s = inputState(); return new Vec2({ x: s.mouseX || 0, y: s.mouseY || 0 }); }
    };

    var VR = {
      Component: Component,
      core: {
        vec2: function (x, y) { return new Vec2({ x: x || 0, y: y || 0 }); },
        vec3: function (x, y, z) { return new Vec3({ x: x || 0, y: y || 0, z: z || 0 }); },
        rgba: function (r, g, b, a) { return { r: r || 0, g: g || 0, b: b || 0, a: (a === undefined ? 255 : a) }; },
        Node: Node,
        Component: Component
      },
      render3d: {
        transform3d: function (node) { return node ? node.transform() : null; },
        world_matrix: function (node) {
          return {
            translation_part: function () { return node ? node.transform().position.clone() : new Vec3({ x: 0, y: 0, z: 0 }); }
          };
        }
      },
      render: {},
      assets: {},
      rand: {
        f32: function () { return Math.random(); },
        intn: function (n) { return Math.floor(Math.random() * (n || 1)); }
      },
      scene: scene,
      input: input,
      store: store,
      log: log,
      _timers: timers,
      _hooks: hooks,
      __add: __add, __sub: __sub, __mul: __mul, __div: __div,
      __in: __in, __getIndex: __getIndex, __setIndex: __setIndex,
      __append: __append, __entries: __entries, __orVal: __orVal,
      __len: __len, __u8: __u8, __copy: __copy, __make: __make, __comp: __comp,
      dispose: function () {
        timers.forEach(function (id) { try { clearTimeout(id); } catch (e) { } });
        timers.length = 0;
      }
    };
    rootNode.__vr = VR;
    Node.prototype.__vrDefault = VR;
    /* Node.new cần VR + createObject: bọc lại cho runtime này (giữ hàm
     * gốc trước khi ghi đè — nếu không sẽ đệ quy vô hạn) */
    var origNodeNew = Node.new;
    VR.core.Node.new = function (name) {
      return origNodeNew(name, VR, hooks.createObject);
    };
    return VR;
  }

  /* ================= API chính ================= */
  function translate(vSource) {
    var src = String(vSource || '');
    var errors = scanSource(src);
    /* kiểm tra các cấu trúc không dịch được (kèm số dòng) */
    var lines = src.split('\n');
    for (var li = 0; li < lines.length; li++) {
      for (var u = 0; u < UNSUPPORTED.length; u++) {
        if (UNSUPPORTED[u][0].test(lines[li])) {
          errors.push({ line: li + 1, msg: UNSUPPORTED[u][1] });
        }
      }
    }
    if (errors.length) return { js: null, errors: errors, classes: [], functions: [] };
    var decls;
    try {
      var toks = tokenize(src);
      var parser = new Parser(toks);
      decls = parser.parseProgram();
    } catch (e) {
      if (e instanceof VError) return { js: null, errors: [{ line: e.line, msg: e.msg }], classes: [], functions: [] };
      return { js: null, errors: [{ line: 1, msg: 'Lỗi phân tích cú pháp: ' + (e && e.message ? e.message : e) }], classes: [], functions: [] };
    }
    var js;
    try {
      var gen = new Codegen(decls);
      js = gen.gen();
    } catch (e) {
      if (e instanceof VError) return { js: null, errors: [{ line: e.line, msg: e.msg }], classes: [], functions: [] };
      return { js: null, errors: [{ line: 1, msg: 'Lỗi sinh mã JS: ' + (e && e.message ? e.message : e) }], classes: [], functions: [] };
    }
    var genErrs = scanGenerated(js);
    if (genErrs.length) return { js: null, errors: genErrs, classes: [], functions: [] };
    var classes = [], functions = [];
    decls.forEach(function (d) {
      if (d.t === 'struct') classes.push(d.name);
      if (d.t === 'fn' && !d.receiver) functions.push(d.name);
    });
    return { js: js, errors: [], classes: classes, functions: functions };
  }

  /* Biên dịch JS sinh ra bằng new Function trong sandbox hẹp: chỉ truyền
   * VR, Math, console. Lớp rào (a) đã quét tĩnh ở translate(); đây là
   * lớp (b). KHÔNG phải sandbox bảo mật tuyệt đối — chỉ chạy code V
   * từ nguồn tin cậy (xem đầu file). */
  function run(js, VR) {
    if (!js) throw new Error('Không có mã JS để chạy (dịch lỗi trước đó).');
    var errs = scanGenerated(js);
    if (errs.length) throw new Error(errs[0].msg);
    var factory;
    try {
      factory = new Function('VR', 'Math', 'console', '"use strict";\n' + js + '\nreturn VCodeModule;');
    } catch (e) {
      throw new Error('Biên dịch JS sinh ra lỗi: ' + e.message);
    }
    var mod;
    try {
      mod = factory(VR, Math, console);
    } catch (e) {
      throw new Error('Chạy code V dịch ra lỗi: ' + (e && e.message ? e.message : e));
    }
    return mod;
  }

  /* Dịch nhiều file V thành MỘT module JS chung (game.v + combat.v là
   * một chương trình: combat.v gọi hero()/hero_pos() của game.v).
   * Panel nối các file .v đã chọn thành một ô soạn nên cũng dùng chung. */
  function translateAll(sources) {
    var joined = (sources || []).map(function (s, i) {
      return '// ===== file ' + (i + 1) + ' =====\n' + String(s == null ? '' : s);
    }).join('\n');
    return translate(joined);
  }

  var VCodeRunner = {
    translate: translate,
    translateAll: translateAll,
    run: run,
    scanSource: scanSource,
    scanGenerated: scanGenerated,
    makeRuntime: makeRuntime,
    /* expose để test/harness dùng trực tiếp */
    _Vec3: Vec3,
    _Vec2: Vec2,
    _Node: Node,
    _Component: Component,
    _Transform3D: Transform3D
  };

  ME.VCodeRunner = VCodeRunner;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = VCodeRunner;
  }
})();
