/* ============================================================
 * rig/arp-plugin-modelstats.js — PLUGIN MẪU "Model Stats"
 *
 * Đăng ký qua PixiStudio.ArpPlugins (xem contract ở đầu
 * js/rig/arp-plugins.js). Có tab riêng trong cửa sổ ARP
 * (tab: true → tab 'plugin:model-stats', tiêu đề 'Model Stats').
 *
 * Hiện số liệu model hiện tại: số tris, số verts, số xương,
 * số clip animation, số texture + tên model + chiều cao (bbox).
 * Đếm mesh/bbox theo cùng cách arp-smart.js duyệt scene
 * (traverse, bỏ qua marker/ghost/bone-visual helpers).
 * Chưa có model → báo "chưa có model — hãy load model trước".
 * ============================================================ */
(function () {
  'use strict';

  /* Đếm số liệu từ 1 model root. Hàm thuần — harness gọi trực tiếp
     để đối chiếu với số liệu đo độc lập. */
  function collectStats(model) {
    var out = {
      name: '', tris: 0, verts: 0, bones: 0, meshes: 0,
      clips: 0, textures: 0, height: 0, width: 0, depth: 0
    };
    if (!model || !model.traverse) return out;
    out.name = model.name || '';
    var texSet = {};
    var texCount = 0;
    model.traverse(function (o) {
      if (o.isBone) { out.bones++; return; }
      if (!o.isMesh && !o.isSkinnedMesh) return;
      if (o.userData && (o.userData.isArpMarker || o.userData.isArpGhost ||
          o.userData.isBoneVisual || o.userData.skipSkin)) return;
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      out.meshes++;
      var pos = o.geometry.attributes.position;
      out.verts += pos.count;
      var idx = o.geometry.index;
      out.tris += idx ? Math.round(idx.count / 3) : Math.round(pos.count / 3);
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m) return;
        ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap',
         'emissiveMap', 'alphaMap', 'aoMap'].forEach(function (k) {
          var t = m[k];
          if (t && t.image) {
            var key = t.uuid || t.image.src || k;
            if (!texSet[key]) { texSet[key] = true; texCount++; }
          }
        });
      });
    });
    var clips = 0;
    if (model.animations && model.animations.length) clips = model.animations.length;
    else if (model.userData && model.userData.clips && model.userData.clips.length) clips = model.userData.clips.length;
    out.clips = clips;
    out.textures = texCount;
    /* Chiều cao (bbox) — cần THREE. */
    try {
      var THREE = window.THREE;
      if (THREE && THREE.Box3) {
        var box = new THREE.Box3().setFromObject(model);
        if (!box.isEmpty()) {
          var size = box.getSize(new THREE.Vector3());
          out.height = size.y;
          out.width = size.x;
          out.depth = size.z;
        }
      }
    } catch (e) { /* bbox lỗi: giữ height = 0 */ }
    return out;
  }

  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtM(n) { return (Math.round(n * 1000) / 1000).toFixed(3) + ' m'; }

  function renderModelStats(container, ctx) {
    container.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'arp-modelstats';

    var head = document.createElement('div');
    head.className = 'arp-row';
    head.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:10px;';
    var title = document.createElement('b');
    title.textContent = '📊 Model Stats';
    head.appendChild(title);
    var refreshBtn = document.createElement('button');
    refreshBtn.className = 'arp-btn';
    refreshBtn.textContent = '⟳ Làm mới';
    refreshBtn.addEventListener('click', function () { renderModelStats(container, ctx); });
    head.appendChild(refreshBtn);
    wrap.appendChild(head);

    var model = null;
    try { model = ctx.getModel(); } catch (e) { model = null; }
    if (!model) {
      var empty = document.createElement('p');
      empty.className = 'arp-note';
      empty.textContent = 'Chưa có model — hãy load model trước.';
      wrap.appendChild(empty);
      container.appendChild(wrap);
      return;
    }

    var st = collectStats(model);
    var name = st.name;
    try {
      var RAG = window.PixiStudio && PixiStudio.RigAutoGen;
      if (!name && RAG && RAG.current && RAG.current.name) name = RAG.current.name;
    } catch (e) {}
    if (!name) name = '(không tên)';

    var rows = [
      ['Tên model', name],
      ['Số tris', fmtInt(st.tris)],
      ['Số verts', fmtInt(st.verts)],
      ['Số mesh', fmtInt(st.meshes)],
      ['Số xương', fmtInt(st.bones)],
      ['Số clip animation', fmtInt(st.clips)],
      ['Số texture', fmtInt(st.textures)],
      ['Chiều cao (bbox)', fmtM(st.height)],
      ['Rộng × sâu (bbox)', fmtM(st.width) + ' × ' + fmtM(st.depth)]
    ];
    var table = document.createElement('table');
    table.style.cssText = 'border-collapse:collapse;width:100%;font-size:13px;';
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      var td1 = document.createElement('td');
      td1.style.cssText = 'padding:5px 8px;border-bottom:1px solid #ddd;color:#555;';
      td1.textContent = r[0];
      var td2 = document.createElement('td');
      td2.style.cssText = 'padding:5px 8px;border-bottom:1px solid #ddd;font-weight:600;text-align:right;';
      td2.textContent = r[1];
      tr.appendChild(td1);
      tr.appendChild(td2);
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  var ModelStats = {
    collectStats: collectStats,
    render: renderModelStats
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpPluginModelStats = ModelStats;

  /* Đăng ký qua registry (không throw ra ngoài nếu registry chưa có
     hoặc id đã đăng ký — chỉ log rõ). */
  try {
    if (window.PixiStudio.ArpPlugins) {
      PixiStudio.ArpPlugins.register('model-stats', {
        name: 'Model Stats',
        version: '1.0.0',
        description: 'Số liệu model hiện tại: tris, verts, xương, clip animation, texture, chiều cao (bbox).',
        tab: true,
        render: renderModelStats
      });
    } else if (typeof console !== 'undefined') {
      console.warn('[ArpPluginModelStats] ArpPlugins chưa load — plugin chưa đăng ký.');
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.error('[ArpPluginModelStats] đăng ký lỗi:', e && e.message);
  }
})();
