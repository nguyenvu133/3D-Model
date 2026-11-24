/* ============================================================
 * mapeditor/editor/Inspector.js — Inspector cho object đang chọn
 * Transform (position/rotation/scale, reset/copy/paste), Material
 * (màu, roughness, metalness, opacity), Light, Collider (dữ liệu),
 * Patrol waypoints, mesh stats (verts/tris). Không có object thì
 * hiện thông tin scene + terrain.
 * ============================================================ */
(function () {
  'use strict';

  window.MapEditor = window.MapEditor || {};
  var ME = window.MapEditor;

  var Inspector = {
    _container: null,
    _clipboard: null
  };

  Inspector.init = function (container) {
    Inspector._container = container;
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function numInput(value, step, onChange) {
    var inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'in-num';
    inp.value = Math.round(value * 100) / 100;
    inp.step = step || 0.1;
    inp.addEventListener('change', function () {
      var v = parseFloat(inp.value);
      if (isFinite(v)) onChange(v);
    });
    return inp;
  }
  function vecRow(label, arr, onChange, isDeg) {
    var row = el('div', 'ins-row');
    row.appendChild(el('span', 'ins-label', label));
    ['X', 'Y', 'Z'].forEach(function (axis, i) {
      var wrap = el('span', 'ins-vec');
      wrap.appendChild(el('span', 'ins-axis', axis));
      wrap.appendChild(numInput(isDeg ? arr[i] * 180 / Math.PI : arr[i], isDeg ? 1 : 0.1, function (v) {
        onChange(i, isDeg ? v * Math.PI / 180 : v);
      }));
      row.appendChild(wrap);
    });
    return row;
  }
  function section(title) {
    var s = el('div', 'ins-section');
    s.appendChild(el('div', 'ins-head', title));
    return s;
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtNum(v, digits) {
    if (v === undefined || v === null || !isFinite(v)) return '—';
    return String(Math.round(v * Math.pow(10, digits || 2)) / Math.pow(10, digits || 2));
  }
  function fmtVec(arr, digits) {
    if (!arr) return '—';
    return '(' + fmtNum(arr[0], digits) + ', ' + fmtNum(arr[1], digits) + ', ' + fmtNum(arr[2], digits) + ')';
  }

  /* thống kê mesh thật từ THREE.Object3D: verts/tris/bounds/material/con */
  Inspector.meshStats = function (threeObj) {
    var st = { verts: 0, tris: 0, meshes: 0, children: 0, descendants: 0, materials: [], bounds: null, skinned: false };
    if (!threeObj) return st;
    st.children = threeObj.children.length;
    threeObj.traverse(function (ch) {
      st.descendants++;
      if (ch.isMesh) {
        st.meshes++;
        if (ch.isSkinnedMesh) st.skinned = true;
        var g = ch.geometry;
        if (g) {
          if (g.index) st.tris += g.index.count / 3;
          else if (g.attributes.position) st.tris += g.attributes.position.count / 3;
          if (g.attributes.position) st.verts += g.attributes.position.count;
        }
        if (ch.material && st.materials.indexOf(ch.material) < 0) st.materials.push(ch.material);
      }
    });
    st.descendants--; /* trừ chính nó */
    try {
      var box = new THREE.Box3().setFromObject(threeObj);
      if (!box.isEmpty()) {
        var size = box.getSize(new THREE.Vector3());
        st.bounds = [size.x, size.y, size.z];
      }
    } catch (e) { /* Box3 lỗi với object rỗng thì bỏ qua */ }
    return st;
  };

  /* khối "Thông tin" đầu Inspector — mọi số liệu lấy từ object thật */
  Inspector.infoSection = function (obj, threeObj) {
    var s = section('Thông tin');
    var st = Inspector.meshStats(threeObj);
    var rows = [];
    rows.push(['Tên', obj.name]);
    rows.push(['Loại', obj.type + (obj.placeholder ? ' (placeholder)' : '')]);
    rows.push(['Đường dẫn', 'Scene / ' + (obj.group || 'Props') + ' / ' + obj.name]);
    rows.push(['Parent', 'Scene (MapRoot)']);
    rows.push(['Số con', st.children + ' con trực tiếp · ' + st.descendants + ' descendant · ' + st.meshes + ' mesh']);
    rows.push(['Transform local', 'P ' + fmtVec(obj.position) + ' · R° ' + fmtVec([obj.rotation[0] * 180 / Math.PI, obj.rotation[1] * 180 / Math.PI, obj.rotation[2] * 180 / Math.PI], 1) + ' · S ' + fmtVec(obj.scale)]);
    if (threeObj) {
      var wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
      try {
        threeObj.updateWorldMatrix(true, false);
        threeObj.matrixWorld.decompose(wp, wq, ws);
        var eu = new THREE.Euler().setFromQuaternion(wq);
        rows.push(['Transform world', 'P ' + fmtVec([wp.x, wp.y, wp.z]) + ' · R° ' + fmtVec([eu.x * 180 / Math.PI, eu.y * 180 / Math.PI, eu.z * 180 / Math.PI], 1) + ' · S ' + fmtVec([ws.x, ws.y, ws.z])]);
      } catch (e) { rows.push(['Transform world', '—']); }
    }
    rows.push(['Mesh', st.verts.toLocaleString() + ' verts · ' + Math.round(st.tris).toLocaleString() + ' tris' +
      (st.bounds ? ' · bounds ' + fmtVec(st.bounds) + ' m' : ' · bounds —') + (st.skinned ? ' · skinned' : '')]);
    if (st.materials.length) {
      var m0 = st.materials[0];
      var col = (m0.color && m0.color.getHexString) ? '#' + m0.color.getHexString() : '—';
      rows.push(['Material', st.materials.length + ' material · màu ' + col +
        ' · roughness ' + fmtNum(m0.roughness) + ' · metalness ' + fmtNum(m0.metalness) +
        ' · opacity ' + fmtNum(m0.opacity !== undefined ? m0.opacity : 1)]);
    } else {
      rows.push(['Material', '— (không có mesh)']);
    }
    /* components: suy từ data + userData thật */
    var comps = ['Transform', 'Mesh'];
    if (threeObj && threeObj.userData.pointLight) comps.push('PointLight');
    if (obj.collider) comps.push('Collider(' + obj.collider.shape + ')');
    if (obj.path && obj.path.length) comps.push('PatrolPath(' + obj.path.length + ' điểm)');
    if (obj.anim || (threeObj && threeObj.userData.limbs)) comps.push('Animation');
    if (obj.light) comps.push('Light');
    if (obj.url && obj.url.indexOf('import:') === 0) comps.push('ImportedModel');
    if (obj.veloId) comps.push('VeloAsset');
    if (st.skinned) comps.push('SkinnedMesh');
    rows.push(['Components', comps.join(', ')]);
    /* nguồn asset */
    var src = 'Prefab procedural (' + obj.type + ')';
    if (obj.url) {
      if (obj.url.indexOf('import:') === 0) {
        var a = ME.AssetManager ? ME.AssetManager.getAsset(obj.url) : null;
        src = 'File import: ' + (a ? (a.fileName || a.name) : obj.url);
      } else src = obj.url;
    }
    if (obj.veloId) src += ' · Velo asset ID: ' + obj.veloId;
    rows.push(['Nguồn asset', src]);
    /* prefab link */
    var prefabName = obj.type;
    if (ME.Placement && ME.Placement.ASSET_LIST) {
      ME.Placement.ASSET_LIST.forEach(function (a) { if (a.type === obj.type) prefabName = a.name; });
    }
    rows.push(['Prefab', prefabName + ' · id: builtin:' + obj.type]);
    /* collider */
    rows.push(['Collider', obj.collider ? obj.collider.shape + ' ' + fmtVec(obj.collider.size || [1, 1, 1]) : '— (không có)']);
    /* patrol waypoints */
    if (obj.path) {
      var pts = obj.path.map(function (p) { return '(' + fmtNum(p[0], 1) + ', ' + fmtNum(p[1], 1) + ')'; });
      rows.push(['Patrol waypoints', obj.path.length + ' điểm: ' + (pts.slice(0, 6).join(' → ') + (pts.length > 6 ? ' …' : ''))]);
    }
    /* animation */
    var animTxt = obj.anim || '—';
    if (ME.MapEditor && ME.MapEditor._thandieu && ME.MapEditor._thandieu.objectId === obj.id) {
      var t = ME.MapEditor._thandieu;
      var cur = t.current && t.current.getClip ? t.current.getClip().name : (t.clips.length ? t.clips[0].name : '—');
      animTxt = 'FBX Thần Điêu: ' + cur + ' · tốc độ 1.0x · ' + t.clips.length + ' clip';
    } else if (obj.anim) {
      animTxt = obj.anim + ' (procedural · tốc độ 1.0x)';
    }
    rows.push(['Animation', animTxt]);
    var info = el('div', 'ins-info');
    info.innerHTML = rows.map(function (r) {
      return '<div><span style="color:var(--text3)">' + esc(r[0]) + ':</span> <b>' + esc(r[1]) + '</b></div>';
    }).join('');
    s.appendChild(info);
    return s;
  };

  Inspector.render = function () {
    var c = Inspector._container;
    if (!c || !ME.MapEditor) return;
    c.innerHTML = '';
    var data = ME.MapEditor.data;
    var selId = ME.MapEditor.selectedId();
    var obj = selId ? ME.MapEditor.getObjectData(selId) : null;

    if (!obj) {
      var s0 = section('Scene — ' + (data ? data.name : ''));
      var totals = { verts: 0, tris: 0 };
      if (ME.MapEditor.computeSceneStats) {
        var cs = ME.MapEditor.computeSceneStats();
        totals.verts = cs.totalVerts; totals.tris = cs.totalTris;
      }
      var info = el('div', 'ins-info');
      info.innerHTML =
        'Objects: <b>' + (data ? data.objects.length : 0) + '</b><br>' +
        'Vertices: <b>' + totals.verts.toLocaleString() + '</b> · Triangles: <b>' + totals.tris.toLocaleString() + '</b><br>' +
        'Terrain: <b>' + (data && data.terrain ? data.terrain.size + ' × ' + data.terrain.size + ' · ' + data.terrain.segments + ' seg' : '—') + '</b><br>' +
        'Mực nước: <b>' + (data && data.terrain && data.terrain.waterLevel !== null && data.terrain.waterLevel !== undefined ? data.terrain.waterLevel + ' m' : '—') + '</b><br>' +
        'Template: <b>' + (data ? data.template : '—') + '</b><br>' +
        'Weather: <b>' + (data && data.environment ? data.environment.weather : '—') + '</b>';
      s0.appendChild(info);
      s0.appendChild(el('div', 'ins-hint', 'Chọn 1 object trong Hierarchy hoặc click trong viewport để sửa. Shift/Ctrl+click để chọn nhiều.'));
      c.appendChild(s0);
      return;
    }

    /* header */
    var head = el('div', 'ins-title');
    var nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.className = 'in-text';
    nameInp.value = obj.name;
    nameInp.addEventListener('change', function () {
      if (nameInp.value.trim()) ME.MapEditor.rename(obj.id, nameInp.value.trim());
    });
    head.appendChild(nameInp);
    head.appendChild(el('span', 'ins-type', obj.type + (obj.placeholder ? ' · placeholder' : '')));
    c.appendChild(head);

    /* Thông tin đầy đủ — đầu Inspector */
    c.appendChild(Inspector.infoSection(obj, ME.MapEditor.getObject3D(obj.id)));

    /* Transform */
    var sT = section('Transform');
    sT.appendChild(vecRow('Position', obj.position, function (i, v) {
      ME.MapEditor.setTransform(obj.id, 'position', i, v);
    }));
    sT.appendChild(vecRow('Rotation°', obj.rotation, function (i, v) {
      ME.MapEditor.setTransform(obj.id, 'rotation', i, v);
    }, true));
    sT.appendChild(vecRow('Scale', obj.scale, function (i, v) {
      ME.MapEditor.setTransform(obj.id, 'scale', i, Math.max(0.01, v));
    }));
    var tbtns = el('div', 'ins-btnrow');
    [['Reset', function () { ME.MapEditor.resetTransform(obj.id); }],
     ['Copy', function () { Inspector._clipboard = JSON.parse(JSON.stringify({ p: obj.position, r: obj.rotation, s: obj.scale })); }],
     ['Paste', function () {
       if (Inspector._clipboard) ME.MapEditor.applyTransform(obj.id, Inspector._clipboard);
     }],
     ['Focus (F)', function () { ME.MapEditor.focusSelected(); }]
    ].forEach(function (b) {
      var btn = el('button', 'btn sm', b[0]);
      btn.addEventListener('click', b[1]);
      tbtns.appendChild(btn);
    });
    sT.appendChild(tbtns);
    c.appendChild(sT);

    /* Material */
    var sM = section('Material');
    var threeObj = ME.MapEditor.getObject3D(obj.id);
    var mrow = el('div', 'ins-row');
    mrow.appendChild(el('span', 'ins-label', 'Màu'));
    var colorInp = document.createElement('input');
    colorInp.type = 'color';
    var curColor = '#7a7a94';
    if (obj.color !== null && obj.color !== undefined) {
      curColor = '#' + ('000000' + obj.color.toString(16)).slice(-6);
    } else if (threeObj) {
      var found = null;
      threeObj.traverse(function (ch) { if (!found && ch.isMesh && ch.material && ch.material.color) found = ch.material.color; });
      if (found) curColor = '#' + found.getHexString();
    }
    colorInp.value = curColor;
    colorInp.addEventListener('change', function () {
      ME.MapEditor.setColor(obj.id, parseInt(colorInp.value.slice(1), 16));
    });
    mrow.appendChild(colorInp);
    sM.appendChild(mrow);
    var mat = obj.material || {};
    [['Roughness', 'roughness', 0, 1, 0.05, mat.roughness !== undefined ? mat.roughness : 0.85],
     ['Metalness', 'metalness', 0, 1, 0.05, mat.metalness !== undefined ? mat.metalness : 0],
     ['Opacity', 'opacity', 0, 1, 0.05, mat.opacity !== undefined ? mat.opacity : 1]
    ].forEach(function (cfg) {
      var r = el('div', 'ins-row');
      r.appendChild(el('span', 'ins-label', cfg[0]));
      var sl = document.createElement('input');
      sl.type = 'range'; sl.min = cfg[2]; sl.max = cfg[3]; sl.step = cfg[4]; sl.value = cfg[5];
      sl.addEventListener('input', function () {
        ME.MapEditor.setMaterial(obj.id, cfg[1], parseFloat(sl.value));
      });
      r.appendChild(sl);
      r.appendChild(el('span', 'ins-val', String(cfg[5])));
      sM.appendChild(r);
    });
    c.appendChild(sM);

    /* Light */
    if (obj.light || obj.type === 'light' || obj.type === 'lantern' || obj.type === 'campfire' || obj.type === 'portal' || obj.type === 'temple') {
      var sL = section('Light');
      var L = obj.light || { color: 0xffb347, intensity: 0.8, distance: 16 };
      var lr = el('div', 'ins-row');
      lr.appendChild(el('span', 'ins-label', 'Màu đèn'));
      var lc = document.createElement('input');
      lc.type = 'color';
      lc.value = '#' + ('000000' + L.color.toString(16)).slice(-6);
      lc.addEventListener('change', function () {
        ME.MapEditor.setLight(obj.id, 'color', parseInt(lc.value.slice(1), 16));
      });
      lr.appendChild(lc);
      sL.appendChild(lr);
      [['Cường độ', 'intensity', 0, 3, 0.1, L.intensity],
       ['Phạm vi', 'distance', 0, 40, 1, L.distance]
      ].forEach(function (cfg) {
        var r2 = el('div', 'ins-row');
        r2.appendChild(el('span', 'ins-label', cfg[0]));
        var sl2 = document.createElement('input');
        sl2.type = 'range'; sl2.min = cfg[2]; sl2.max = cfg[3]; sl2.step = cfg[4]; sl2.value = cfg[5];
        sl2.addEventListener('input', function () {
          ME.MapEditor.setLight(obj.id, cfg[1], parseFloat(sl2.value));
        });
        r2.appendChild(sl2);
        r2.appendChild(el('span', 'ins-val', String(cfg[5])));
        sL.appendChild(r2);
      });
      c.appendChild(sL);
    }

    /* Collider (dữ liệu — không physics thật, xem docs §5) */
    var sC = section('Collider (dữ liệu)');
    var col = obj.collider || { shape: 'box', size: [1, 1, 1] };
    var crow = el('div', 'ins-row');
    crow.appendChild(el('span', 'ins-label', 'Dạng'));
    var sel = document.createElement('select');
    sel.className = 'in-select';
    ['box', 'sphere', 'none'].forEach(function (sh) {
      var op = document.createElement('option');
      op.value = sh; op.textContent = sh;
      if (col.shape === sh) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener('change', function () {
      ME.MapEditor.setCollider(obj.id, sel.value === 'none' ? null : { shape: sel.value, size: col.size || [1, 1, 1] });
    });
    crow.appendChild(sel);
    sC.appendChild(crow);
    if (col.shape) {
      sC.appendChild(vecRow('Kích thước', col.size || [1, 1, 1], function (i, v) {
        var ns = (col.size || [1, 1, 1]).slice();
        ns[i] = Math.max(0.1, v);
        ME.MapEditor.setCollider(obj.id, { shape: col.shape, size: ns });
      }));
    }
    sC.appendChild(el('div', 'ins-hint', 'Collider chỉ là dữ liệu (hiển thị khung vàng khi bật Collision Preview). Không có physics thật.'));
    c.appendChild(sC);

    /* Patrol */
    if (obj.type === 'patrol') {
      var sP = section('Patrol Path');
      var pts = obj.path || [];
      sP.appendChild(el('div', 'ins-info', 'Waypoints: <b>' + pts.length + '</b> — bấm "Thêm điểm" rồi click lên terrain.'));
      var pbtns = el('div', 'ins-btnrow');
      var addBtn = el('button', 'btn sm', 'Thêm điểm');
      addBtn.addEventListener('click', function () { ME.MapEditor.startAddWaypoint(obj.id); });
      var clrBtn = el('button', 'btn sm', 'Xoá path');
      clrBtn.addEventListener('click', function () { ME.MapEditor.setPath(obj.id, []); });
      pbtns.appendChild(addBtn);
      pbtns.appendChild(clrBtn);
      sP.appendChild(pbtns);
      c.appendChild(sP);
    }

    /* Animation (hero/monster/boss) */
    if (obj.type === 'hero' || obj.type === 'monster' || obj.type === 'boss') {
      var sA = section('Animation');
      var arow = el('div', 'ins-row');
      arow.appendChild(el('span', 'ins-label', 'Clip'));
      var asel = document.createElement('select');
      asel.className = 'in-select';
      ['Idle', 'Walk', 'Run'].forEach(function (a) {
        var op = document.createElement('option');
        op.value = a; op.textContent = a;
        if ((obj.anim || 'Idle') === a) op.selected = true;
        asel.appendChild(op);
      });
      asel.addEventListener('change', function () {
        ME.MapEditor.setAnim(obj.id, asel.value);
      });
      arow.appendChild(asel);
      sA.appendChild(arow);
      if (obj.type === 'hero') {
        var thBtn = el('button', 'btn sm', 'Load Thần Điêu (FBX) thay hero');
        thBtn.addEventListener('click', function () { ME.MapEditor.loadThandieuFor(obj.id); });
        sA.appendChild(thBtn);
        sA.appendChild(el('div', 'ins-hint', 'Cần models/thandieu/thandieu-Mixamo.fbx trong repo. Chưa có file thì vẫn dùng hero chibi.'));
      }
      c.appendChild(sA);
    }

    /* Mesh stats */
    if (threeObj) {
      var verts = 0, tris = 0;
      threeObj.traverse(function (ch) {
        if (ch.isMesh && ch.geometry) {
          var g = ch.geometry;
          if (g.index) tris += g.index.count / 3;
          else if (g.attributes.position) tris += g.attributes.position.count / 3;
          if (g.attributes.position) verts += g.attributes.position.count;
        }
      });
      var sS = section('Mesh');
      sS.appendChild(el('div', 'ins-info', 'Vertices: <b>' + verts.toLocaleString() + '</b><br>Triangles: <b>' + Math.round(tris).toLocaleString() + '</b>'));
      c.appendChild(sS);
    }

    /* actions */
    var sX = section('Object');
    var xbtns = el('div', 'ins-btnrow');
    [['Duplicate (Ctrl+D)', function () { ME.MapEditor.duplicateSelected(); }],
     ['Delete (Del)', function () { ME.MapEditor.deleteSelected(); }],
     ['Ẩn/Hiện', function () { ME.MapEditor.toggleVisible(obj.id); }],
     ['Khoá/Mở', function () { ME.MapEditor.toggleLock(obj.id); }]
    ].forEach(function (b) {
      var btn = el('button', 'btn sm', b[0]);
      btn.addEventListener('click', b[1]);
      xbtns.appendChild(btn);
    });
    sX.appendChild(xbtns);
    c.appendChild(sX);
  };

  ME.Inspector = Inspector;
})();
