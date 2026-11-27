/* ============================================================
 * scene/scene-validate.js — Scene Validation
 *
 * Kiểm tra tự động scene đang mở, báo lỗi/cảnh báo theo mức,
 * kèm gợi ý sửa + nút sửa tự động cho lỗi đơn giản:
 *   - duplicate-name: 2 object cùng tên trong registry
 *   - missing-model-ref: userData.modelEntry trỏ tới model đã xóa
 *     khỏi PixiStudio.Models.models
 *   - missing-material: mesh không có material; missing-texture:
 *     material.map có nhưng image rỗng/lỗi
 *   - no-mesh: object (model/primitive) không có mesh nào trong cây con
 *   - bad-transform: NaN/Infinity ở position/rotation/scale
 *   - zero-scale: scale = 0 (object biến mất khỏi render)
 *   - no-lights / too-many-lights: 0 light hoặc >8 light trong scene
 *   - out-of-bounds: object nằm quá xa (|x|,|y|,|z| > giới hạn)
 *   - detached: object còn trong registry nhưng đã rời scene graph
 *   - empty-name: object không có tên
 *
 * validate() CHỈ báo — không tự sửa. Sửa chỉ chạy khi user bấm
 * nút auto-fix (autoFix) hoặc gọi trực tiếp. Sau khi load project
 * / import (bus 'project:loaded') module tự chạy validate và chỉ
 * báo qua notify, không sửa gì.
 *
 * Giới hạn thật:
 *   - material/texture: chỉ kiểm tra được map đã gán trên material
 *     (image null hoặc naturalWidth 0 khi đã complete); texture
 *     load lỗi kiểu khác (404 network, file thiếu trên đĩa) không
 *     nhìn thấy từ object3D nên không báo được ở đây.
 *   - "thừa/thiếu light" đếm light thật trong scene graph; light
 *     tắt (visible=false) vẫn đếm — báo cáo ghi rõ số light đang bật.
 * ============================================================ */
(function () {
  'use strict';

  var bus = (window.PixiStudio && PixiStudio.bus) || { emit: function () {}, on: function () {} };
  var U = (window.PixiStudio && PixiStudio.Utils) || null;

  function el(tag, attrs, children) {
    if (U && U.el) return U.el(tag, attrs, children);
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  var Validate = {
    config: {
      bounds: 1000,    // |x|,|y|,|z| vượt quá thì cảnh báo out-of-bounds
      maxLights: 8,
      minLights: 1
    },
    _lastResult: null,
    _panelEl: null
  };

  function isBadNum(v) {
    return typeof v !== 'number' || !isFinite(v);
  }

  function worldPosOf(obj) {
    try {
      if (obj.getWorldPosition) return obj.getWorldPosition(new THREE.Vector3());
    } catch (e) { /* ignore */ }
    return new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z);
  }

  function meshInfo(obj) {
    var meshes = 0, noMaterial = 0, badTexture = 0;
    obj.traverse(function (o) {
      if (!o.isMesh) return;
      meshes++;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m) { noMaterial++; return; }
        if (m.map) {
          var img = m.map.image;
          if (!img) badTexture++;
          else if (img.naturalWidth !== undefined && img.complete && img.naturalWidth === 0) badTexture++;
          else if (img.width !== undefined && img.naturalWidth === undefined && img.width === 0 && img.height === 0) badTexture++;
        }
      });
    });
    return { meshes: meshes, noMaterial: noMaterial, badTexture: badTexture };
  }

  function countLights() {
    var seen = {};
    var total = 0, visible = 0;
    function add(light) {
      if (!light || !light.isLight || seen[light.uuid]) return;
      seen[light.uuid] = true;
      total++;
      if (light.visible !== false) visible++;
    }
    var scene = PixiStudio.Viewport && PixiStudio.Viewport.scene;
    if (scene) scene.traverse(function (o) { add(o); });
    /* Lighting.group có thể chưa gắn vào scene trong 1 số boot path */
    if (PixiStudio.Lighting && PixiStudio.Lighting.group) {
      PixiStudio.Lighting.group.traverse(function (o) { add(o); });
    }
    return { total: total, visible: visible };
  }

  /* ---------- validate ---------- */
  /* Trả { at, objectCount, errors: [], warnings: [], summary: {error, warning} }
   * Issue: { level, code, uuid, name, message, suggestion, fix }
   * fix: null | 'rename-duplicate' | 'remove-broken-ref' | 'reset-scale' | 'delete-object' */
  Validate.validate = function (opts) {
    var cfg = {};
    Object.keys(Validate.config).forEach(function (k) { cfg[k] = Validate.config[k]; });
    if (opts) Object.keys(opts).forEach(function (k) { cfg[k] = opts[k]; });

    var issues = [];
    var Scene = PixiStudio.Scene;
    var registry = (Scene && Scene.registry) || {};
    var uuids = Object.keys(registry);
    var nameCount = {};
    uuids.forEach(function (uuid) {
      var reg = registry[uuid];
      var n = reg.name || (reg.object3D && reg.object3D.name) || '';
      nameCount[n] = (nameCount[n] || 0) + 1;
    });
    var seenName = {};

    uuids.forEach(function (uuid) {
      var reg = registry[uuid];
      var obj = reg.object3D;
      var name = reg.name || (obj && obj.name) || '(không tên)';
      if (!obj) {
        issues.push({ level: 'error', code: 'missing-object', uuid: uuid, name: name, message: 'Registry có entry nhưng object3D đã mất.', suggestion: 'Xóa entry khỏi registry (nút sửa: xóa object).', fix: 'delete-object' });
        return;
      }
      /* empty-name */
      if (!name || name === '(không tên)') {
        issues.push({ level: 'warning', code: 'empty-name', uuid: uuid, name: name, message: 'Object không có tên.', suggestion: 'Đặt tên gợi nhớ trong Inspector / Scene tree.', fix: null });
      }
      /* duplicate-name (báo từ lần xuất hiện thứ 2 trở đi) */
      if (name && nameCount[name] > 1) {
        seenName[name] = (seenName[name] || 0) + 1;
        if (seenName[name] > 1) {
          issues.push({ level: 'warning', code: 'duplicate-name', uuid: uuid, name: name, message: 'Trùng tên với ' + (nameCount[name] - 1) + ' object khác ("' + name + '").', suggestion: 'Đổi tên thành ' + name + '_' + (seenName[name] - 1) + ' (nút sửa tự động).', fix: 'rename-duplicate' });
        }
      }
      /* detached */
      if (!obj.parent) {
        issues.push({ level: 'warning', code: 'detached', uuid: uuid, name: name, message: 'Object còn trong registry nhưng đã rời khỏi scene (không render).', suggestion: 'Kiểm tra xem object có bị xóa khỏi scene mà chưa unregister không; xóa khỏi registry nếu không dùng nữa.', fix: 'delete-object' });
      }
      /* missing-model-ref */
      var entry = obj.userData && obj.userData.modelEntry;
      if (entry) {
        var models = (PixiStudio.Models && PixiStudio.Models.models) || {};
        if (!entry.id || !models[entry.id]) {
          issues.push({ level: 'error', code: 'missing-model-ref', uuid: uuid, name: name, message: 'userData.modelEntry trỏ tới model "' + (entry.id || '(không có id)') + '" đã không còn trong Models registry.', suggestion: 'Xóa reference hỏng (nút sửa tự động) hoặc import lại model.', fix: 'remove-broken-ref' });
        }
      }
      /* bad-transform + zero-scale */
      ['position', 'rotation', 'scale'].forEach(function (prop) {
        var v = obj[prop];
        if (!v) return;
        ['x', 'y', 'z'].forEach(function (axis) {
          if (isBadNum(v[axis])) {
            issues.push({ level: 'error', code: 'bad-transform', uuid: uuid, name: name, message: prop + '.' + axis + ' = ' + String(v[axis]) + ' (NaN/Infinity) — object sẽ render sai hoặc biến mất.', suggestion: 'Đặt lại ' + prop + '.' + axis + ' về 0 (scale về 1).', fix: null });
          }
        });
      });
      if (obj.scale && (obj.scale.x === 0 || obj.scale.y === 0 || obj.scale.z === 0)) {
        issues.push({ level: 'error', code: 'zero-scale', uuid: uuid, name: name, message: 'Scale có thành phần = 0 (' + [obj.scale.x, obj.scale.y, obj.scale.z].join(', ') + ') — object bị ép phẳng, không thấy được.', suggestion: 'Reset thành phần scale 0 về 1 (nút sửa tự động).', fix: 'reset-scale' });
      }
      /* out-of-bounds */
      if (obj.parent) {
        var wp = worldPosOf(obj);
        if (isFinite(wp.x) && isFinite(wp.y) && isFinite(wp.z)) {
          if (Math.abs(wp.x) > cfg.bounds || Math.abs(wp.y) > cfg.bounds || Math.abs(wp.z) > cfg.bounds) {
            issues.push({ level: 'warning', code: 'out-of-bounds', uuid: uuid, name: name, message: 'Nằm ngoài biên scene: (' + Math.round(wp.x) + ', ' + Math.round(wp.y) + ', ' + Math.round(wp.z) + '), giới hạn ±' + cfg.bounds + 'm.', suggestion: 'Kéo object về gần gốc tọa độ hoặc tăng giới hạn trong cấu hình.', fix: null });
          }
        }
      }
      /* mesh / material / texture */
      if (reg.type === 'primitive' || reg.type === 'model') {
        var info = meshInfo(obj);
        if (info.meshes === 0) {
          issues.push({ level: 'error', code: 'no-mesh', uuid: uuid, name: name, message: 'Object loại "' + reg.type + '" không chứa mesh nào.', suggestion: 'Kiểm tra lại import — model có thể rỗng, hoặc xóa object.', fix: null });
        } else {
          if (info.noMaterial > 0) {
            issues.push({ level: 'warning', code: 'missing-material', uuid: uuid, name: name, message: info.noMaterial + ' mesh không có material (render đen/trắng).', suggestion: 'Gán lại material trong Inspector.', fix: null });
          }
          if (info.badTexture > 0) {
            issues.push({ level: 'warning', code: 'missing-texture', uuid: uuid, name: name, message: info.badTexture + ' material có map nhưng ảnh texture rỗng/lỗi.', suggestion: 'Load lại texture hoặc gỡ map khỏi material.', fix: null });
          }
        }
      }
    });

    /* lights */
    var lights = countLights();
    if (lights.total < cfg.minLights) {
      issues.push({ level: 'warning', code: 'no-lights', uuid: null, name: '(scene)', message: 'Scene không có light nào — model sẽ tối đen.', suggestion: 'Thêm ít nhất 1 directional/hemisphere light.', fix: null });
    } else if (lights.total > cfg.maxLights) {
      issues.push({ level: 'warning', code: 'too-many-lights', uuid: null, name: '(scene)', message: 'Scene có ' + lights.total + ' light (' + lights.visible + ' đang bật), vượt giới hạn ' + cfg.maxLights + ' — có thể chậm trên điện thoại.', suggestion: 'Tắt/bớt light không cần thiết.', fix: null });
    }

    var result = {
      at: new Date().toISOString(),
      objectCount: uuids.length,
      lights: lights,
      errors: issues.filter(function (i) { return i.level === 'error'; }),
      warnings: issues.filter(function (i) { return i.level === 'warning'; }),
      issues: issues,
      summary: {
        error: issues.filter(function (i) { return i.level === 'error'; }).length,
        warning: issues.filter(function (i) { return i.level === 'warning'; }).length
      }
    };
    Validate._lastResult = result;
    return result;
  };

  /* ---------- auto-fix ---------- */
  /* Chỉ sửa các issue có fix != null. issues: mảng issue (mặc định
   * lấy từ lần validate gần nhất). Trả { fixed, failed: [{issue, reason}] }. */
  Validate.autoFix = function (issues) {
    issues = issues || (Validate._lastResult && Validate._lastResult.issues) || [];
    var Scene = PixiStudio.Scene;
    var out = { fixed: 0, failed: [] };
    var renameCounters = {};
    issues.forEach(function (issue) {
      try {
        var reg = issue.uuid && Scene && Scene.registry ? Scene.registry[issue.uuid] : null;
        var obj = reg && reg.object3D;
        if (issue.fix === 'rename-duplicate') {
          if (!obj) { out.failed.push({ issue: issue, reason: 'không tìm thấy object' }); return; }
          var base = issue.name;
          renameCounters[base] = (renameCounters[base] || 0) + 1;
          var newName = base + '_' + renameCounters[base];
          /* tránh đụng tên đã tồn tại */
          var guard = 0;
          while (Scene.registry && Object.keys(Scene.registry).some(function (u) { return Scene.registry[u].name === newName; }) && guard < 100) {
            renameCounters[base]++;
            newName = base + '_' + renameCounters[base];
            guard++;
          }
          if (Scene.rename) Scene.rename(obj, newName);
          else { reg.name = newName; obj.name = newName; }
          out.fixed++;
        } else if (issue.fix === 'remove-broken-ref') {
          if (!obj || !obj.userData) { out.failed.push({ issue: issue, reason: 'không tìm thấy object' }); return; }
          delete obj.userData.modelEntry;
          out.fixed++;
        } else if (issue.fix === 'reset-scale') {
          if (!obj || !obj.scale) { out.failed.push({ issue: issue, reason: 'không tìm thấy object' }); return; }
          ['x', 'y', 'z'].forEach(function (axis) {
            if (obj.scale[axis] === 0 || !isFinite(obj.scale[axis])) obj.scale[axis] = 1;
          });
          out.fixed++;
        } else if (issue.fix === 'delete-object') {
          if (!obj) {
            /* entry không có object — xóa thẳng khỏi registry */
            if (Scene && Scene.registry && issue.uuid) delete Scene.registry[issue.uuid];
            out.fixed++;
            return;
          }
          if (Scene.deleteObject) Scene.deleteObject(obj);
          else { if (obj.parent) obj.parent.remove(obj); delete Scene.registry[issue.uuid]; }
          out.fixed++;
        } else {
          out.failed.push({ issue: issue, reason: 'không có auto-fix cho lỗi này' });
        }
      } catch (err) {
        out.failed.push({ issue: issue, reason: String(err && err.message || err) });
      }
    });
    try { bus.emit('scene:changed', { action: 'validate-autofix', fixed: out.fixed }); } catch (e) { /* ignore */ }
    return out;
  };

  Validate.autoFixAllSimple = function () {
    var result = Validate._lastResult || Validate.validate();
    var fixable = result.issues.filter(function (i) { return !!i.fix; });
    var out = Validate.autoFix(fixable);
    Validate._lastResult = Validate.validate();
    return { fixResult: out, after: Validate._lastResult };
  };

  /* ---------- UI ---------- */
  Validate.renderPanel = function (container, result) {
    var wrap = container || document.getElementById('scene-validate-panel');
    if (!wrap) return null;
    result = result || Validate._lastResult;
    wrap.innerHTML = '';
    wrap.appendChild(el('h4', { text: 'Kiểm tra Scene (Validation)' }));

    var btnRow = el('div', { style: 'display:flex;gap:6px;margin:6px 0;flex-wrap:wrap;' });
    btnRow.appendChild(el('button', {
      class: 'btn sm', text: 'Kiểm tra scene',
      onclick: function () { Validate.renderPanel(wrap, Validate.validate()); }
    }));
    btnRow.appendChild(el('button', {
      class: 'btn sm', text: 'Sửa tất cả lỗi đơn giản',
      onclick: function () {
        var out = Validate.autoFixAllSimple();
        try { bus.emit('notify', { type: out.fixResult.failed.length ? 'warn' : 'success', title: 'Auto-fix', message: 'Đã sửa ' + out.fixResult.fixed + ' lỗi, ' + out.fixResult.failed.length + ' không sửa được.' }); } catch (e) {}
        Validate.renderPanel(wrap, out.after);
      }
    }));
    wrap.appendChild(btnRow);

    if (!result) {
      wrap.appendChild(el('div', { style: 'font-size:12px;color:var(--text-4);', text: 'Chưa chạy kiểm tra. Bấm "Kiểm tra scene".' }));
      Validate._panelEl = wrap;
      return wrap;
    }

    wrap.appendChild(el('div', {
      style: 'font-size:12px;margin:4px 0;',
      text: result.objectCount + ' object — ' + result.summary.error + ' lỗi, ' + result.summary.warning + ' cảnh báo' +
        ' (light: ' + result.lights.total + ', đang bật: ' + result.lights.visible + '). Kiểm tra lúc ' + new Date(result.at).toLocaleTimeString() + '.'
    }));

    if (!result.issues.length) {
      wrap.appendChild(el('div', { style: 'font-size:12px;color:var(--ok,#2e7d32);', text: '✓ Scene sạch, không phát hiện lỗi.' }));
      Validate._panelEl = wrap;
      return wrap;
    }

    var list = el('div', { style: 'display:flex;flex-direction:column;gap:6px;' });
    result.issues.forEach(function (issue) {
      var card = el('div', {
        style: 'border:1px solid ' + (issue.level === 'error' ? '#c62828' : '#f9a825') + ';border-left-width:4px;border-radius:6px;padding:6px 8px;font-size:12px;'
      });
      card.appendChild(el('div', {
        html: '<b>' + (issue.level === 'error' ? 'LỖI' : 'CẢNH BÁO') + '</b> · ' + issue.code + ' · ' + (issue.name || ''),
        style: 'margin-bottom:2px;'
      }));
      card.appendChild(el('div', { text: issue.message }));
      if (issue.suggestion) card.appendChild(el('div', { text: 'Gợi ý: ' + issue.suggestion, style: 'color:var(--text-4);' }));
      if (issue.fix) {
        card.appendChild(el('button', {
          class: 'btn sm', text: 'Sửa tự động', style: 'margin-top:4px;',
          onclick: function () {
            var out = Validate.autoFix([issue]);
            Validate.renderPanel(wrap, Validate.validate());
            try { bus.emit('notify', { type: out.fixed ? 'success' : 'warn', title: 'Auto-fix', message: out.fixed ? 'Đã sửa 1 lỗi.' : 'Không sửa được: ' + (out.failed[0] ? out.failed[0].reason : '?') }); } catch (e) {}
          }
        }));
      }
      list.appendChild(card);
    });
    wrap.appendChild(list);

    Validate._panelEl = wrap;
    return wrap;
  };

  Validate.renderPageSection = function () {
    var wrap = el('div', { class: 'page-block', id: 'scene-validate-panel' });
    Validate.renderPanel(wrap, Validate._lastResult);
    return wrap;
  };

  Validate.registerPageSection = function () {
    if (!PixiStudio.Scene) return false;
    PixiStudio.Scene._extraPageSections = PixiStudio.Scene._extraPageSections || [];
    if (PixiStudio.Scene._extraPageSections.indexOf(Validate.renderPageSection) === -1) {
      PixiStudio.Scene._extraPageSections.push(Validate.renderPageSection);
    }
    return true;
  };

  Validate.init = function () {
    Validate.registerPageSection();
    try {
      if (bus && bus.on) {
        /* chạy validation tự động sau khi load project/import — chỉ báo, không tự sửa */
        bus.on('project:loaded', function (data) {
          var result = Validate.validate();
          try {
            bus.emit('notify', {
              type: result.summary.error ? 'warn' : 'info',
              title: 'Kiểm tra scene sau khi load',
              message: 'Project "' + (data && data.name || '') + '": ' + result.summary.error + ' lỗi, ' + result.summary.warning + ' cảnh báo. Mở Scene page → Validation để xem chi tiết.'
            });
          } catch (e) { /* ignore */ }
        });
      }
    } catch (e) { /* ignore */ }
    return Validate;
  };

  window.PixiStudio.SceneValidate = Validate;
  Validate.init();
})();
