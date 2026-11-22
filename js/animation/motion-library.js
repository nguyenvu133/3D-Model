/* ============================================================
 * animation/motion-library.js — Motion Library kiểu Meshy (v20.1)
 *
 * Meshy Library: 631 motion, 5 category (Walk & Run, Daily Actions,
 * Dancing, Fighting, Body Movements), search theo tên, bấm Add → tab
 * Added, export Current / All Added.
 * Bản local gộp mọi nguồn clip THẬT đang có:
 *   AutoGen 10 · Presets 16 · FBX (Meshy Running/Idle/Attack) ·
 *   M2M 326 CC0 — cùng 5 category + search + Add → AnimQueue (Added).
 * ============================================================ */
(function () {
  'use strict';

  var U = PixiStudio.Utils;
  var bus = PixiStudio.bus;
  var Lib = { category: 'All', query: '' };

  var CATS = ['All', 'Walk & Run', 'Daily Actions', 'Dancing', 'Fighting', 'Body Movements'];

  /* Category cho clip local (theo 5 nhóm của Meshy) */
  var LOCAL_CAT = {
    Walk: 'Walk & Run', Run: 'Walk & Run', Running: 'Walk & Run', Jump: 'Walk & Run',
    jump: 'Walk & Run', run: 'Walk & Run', walk: 'Walk & Run', roll: 'Walk & Run', Dodge: 'Walk & Run', dodge: 'Walk & Run',
    Idle: 'Daily Actions', idle: 'Daily Actions', Wave: 'Daily Actions', Bow: 'Daily Actions',
    Dance: 'Dancing', dance: 'Dancing',
    Attack: 'Fighting', attack: 'Fighting', Combo: 'Fighting', combo: 'Fighting',
    Punch: 'Fighting', Kick: 'Fighting', heavyAttack: 'Fighting', block: 'Fighting',
    hit: 'Fighting', death: 'Fighting', skill: 'Fighting', magic: 'Fighting',
    Victory: 'Body Movements', victory: 'Body Movements'
  };

  function m2mCategory(name) {
    if (/idle|rest|relax|sleep|wait|standing|pose/i.test(name)) return 'Daily Actions';
    if (/attack|punch|kick|sword|slash|shoot|throw|combat|fight|block|defend|hit|death|spell|weapon|grenade|stab/i.test(name)) return 'Fighting';
    if (/walk|run|jog|sprint|strafe|crawl|climb|swim|jump|roll|dodge|fly|fall|slide|backflip/i.test(name)) return 'Walk & Run';
    if (/dance|bow|greet|clap|cheer|victory|cry|laugh|sing|talk|pray|yes|reject|confused|dab/i.test(name)) return 'Dancing';
    return 'Body Movements';
  }

  /* Gom mọi clip thật thành 1 danh sách: {source, clipId, label, duration, loop, url?, cat} */
  Lib.collect = function () {
    var out = [];
    var rig = PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
    if (rig && rig.clips) {
      rig.clips.forEach(function (c) {
        out.push({ source: 'autogen', clipId: c.id, label: c.id, duration: c.duration, loop: c.loop, cat: LOCAL_CAT[c.id] || 'Body Movements' });
      });
    } else {
      (PixiStudio.AnimAutoGen ? PixiStudio.AnimAutoGen.definitions : []).forEach(function (d) {
        out.push({ source: 'autogen', clipId: d.id, label: d.id, duration: d.dur, loop: ['Idle', 'Walk', 'Run', 'Wave'].indexOf(d.id) >= 0, cat: LOCAL_CAT[d.id] || 'Body Movements' });
      });
    }
    if (PixiStudio.AnimPresets && PixiStudio.AnimPresets.META) {
      PixiStudio.AnimPresets.META.forEach(function (m) {
        out.push({ source: 'preset', clipId: m.id, label: m.name, duration: 1.5, loop: m.loop, cat: LOCAL_CAT[m.id] || 'Body Movements' });
      });
    }
    if (PixiStudio.FbxRig && PixiStudio.FbxRig.generated) {
      PixiStudio.FbxRig.generated.forEach(function (g) {
        out.push({ source: 'fbx', clipId: g.id, label: g.name, duration: g.clip ? g.clip.duration : 1.5, loop: g.loop, cat: LOCAL_CAT[g.id] || 'Walk & Run' });
      });
    }
    var M = PixiStudio.M2MMotion;
    if (M && M.catalog) {
      Object.keys(M.catalog.rigs || {}).forEach(function (rigId) {
        (M.catalog.rigs[rigId].animations || []).forEach(function (m) {
          out.push({ source: 'm2m', clipId: m.name, label: m.name, duration: m.duration || 1.5, loop: !!m.loop, url: m.url, rigId: rigId, cat: m2mCategory(m.name) });
        });
      });
    }
    return out;
  };

  Lib.filter = function (all) {
    var q = Lib.query.toLowerCase();
    return all.filter(function (m) {
      if (Lib.category !== 'All' && m.cat !== Lib.category) return false;
      if (q && (m.label + ' ' + m.source + ' ' + (m.rigId || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  };

  Lib.renderPanel = function () {
    var body = document.getElementById('animation-page-body');
    if (!body) return;
    var old = document.getElementById('motion-library-section');
    if (old) old.remove();
    var section = U.el('div', { class: 'section-block', id: 'motion-library-section' });
    section.appendChild(U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('game') }), U.el('span', { text: '📚 Motion Library — kiểu Meshy (AutoGen + Presets + FBX + M2M)' })]));
    var sc = U.el('div', { class: 'section-content' });
    sc.appendChild(U.el('div', { class: 'dim small', style: 'line-height:1.5;margin-bottom:8px;', text: 'Meshy có 631 preset / 5 category. Bản local gộp clip thật đang có — bấm ▶ phát ngay, bấm + Add để đưa vào tab Added rồi phát lần lượt / export All Added.' }));

    var search = U.el('input', { class: 'input', placeholder: 'Search motion… (tên, vd: sword, walk, dance)', style: 'margin-bottom:6px;' });
    search.value = Lib.query;
    sc.appendChild(search);
    var chips = U.el('div', { class: 'chip-row', style: 'margin-bottom:6px;' });
    CATS.forEach(function (c) {
      chips.appendChild(U.el('button', {
        class: 'chip' + (Lib.category === c ? ' active' : ''), text: c,
        onclick: function () { Lib.category = c; chips.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('active'); }); this.classList.add('active'); paint(); }
      }));
    });
    sc.appendChild(chips);
    var count = U.el('div', { class: 'dim small', style: 'margin-bottom:5px;' });
    sc.appendChild(count);
    var grid = U.el('div', { style: 'max-height:260px;overflow:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;' });
    sc.appendChild(grid);

    function paint() {
      var all = Lib.collect();
      var shown = Lib.filter(all);
      count.textContent = 'Tổng ' + all.length + ' motion · hiện ' + Math.min(shown.length, 200) + (shown.length > 200 ? ' / ' + shown.length + ' (lọc thêm để xem hết)' : '');
      grid.innerHTML = '';
      shown.slice(0, 200).forEach(function (m) {
        var card = U.el('div', { style: 'border:1px solid var(--border-soft);border-radius:7px;padding:5px;min-width:0;' });
        card.appendChild(U.el('b', { text: m.label, style: 'font-size:10px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }));
        card.appendChild(U.el('div', { class: 'dim small', text: m.source.toUpperCase() + ' · ' + m.cat + ' · ' + (m.duration || 0).toFixed(1) + 's' + (m.loop ? ' · loop' : '') }));
        var row = U.el('div', { style: 'display:flex;gap:3px;margin-top:4px;' });
        row.appendChild(U.el('button', {
          class: 'btn sm grow', text: '▶ Play',
          onclick: function () {
            if (PixiStudio.AnimQueue) { PixiStudio.AnimQueue.playItem(m); }
          }
        }));
        row.appendChild(U.el('button', {
          class: 'btn sm', text: '+ Add',
          onclick: function () {
            if (PixiStudio.AnimQueue) {
              PixiStudio.AnimQueue.add({ source: m.source, clipId: m.clipId, label: m.label, duration: m.duration, loop: m.loop, url: m.url });
              bus.emit('notify', { type: 'success', title: 'Added', message: m.label + ' đã vào queue.' });
              paintAdded();
            }
          }
        }));
        card.appendChild(row);
        grid.appendChild(card);
      });
    }
    search.addEventListener('input', function () { Lib.query = search.value; paint(); });

    /* ---- Added tab ---- */
    var addedTitle = U.el('div', { class: 'section-head', style: 'margin:12px 0 4px;' }, [U.el('span', { text: '➕ Added — motion đã thêm vào nhân vật' })]);
    sc.appendChild(addedTitle);
    var addedList = U.el('div', { style: 'display:flex;flex-direction:column;gap:3px;' });
    sc.appendChild(addedList);
    var addedRow = U.el('div', { style: 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;' });
    addedRow.appendChild(U.el('button', { class: 'btn success sm grow', text: '▶ Play All', onclick: function () { if (PixiStudio.AnimQueue) PixiStudio.AnimQueue.playAll(0); } }));
    addedRow.appendChild(U.el('button', { class: 'btn sm', text: '⏹ Stop', onclick: function () { if (PixiStudio.AnimQueue) PixiStudio.AnimQueue.stop(); } }));
    addedRow.appendChild(U.el('button', { class: 'btn sm', text: '🗑 Clear', onclick: function () { if (PixiStudio.AnimQueue) PixiStudio.AnimQueue.clear(); paintAdded(); } }));
    sc.appendChild(addedRow);
    var addedInfo = U.el('div', { class: 'dim small', style: 'margin-top:5px;line-height:1.45;' });
    sc.appendChild(addedInfo);

    function paintAdded() {
      var Q = PixiStudio.AnimQueue;
      addedList.innerHTML = '';
      if (!Q || !Q.items.length) {
        addedList.appendChild(U.el('div', { class: 'dim small', text: 'Chưa có motion nào — bấm + Add ở trên hoặc phát prompt.' }));
        addedInfo.textContent = '';
        return;
      }
      Q.items.forEach(function (it, i) {
        var row = U.el('div', { style: 'display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--border-soft);' });
        row.appendChild(U.el('span', { class: 'dim small', text: (i + 1) + '.' }));
        row.appendChild(U.el('div', { style: 'flex:1;min-width:0;' }, [
          U.el('b', { text: it.label, style: 'font-size:11px;display:block;' }),
          U.el('span', { class: 'dim small', text: it.source + ' · ' + (it.duration / it.speed).toFixed(1) + 's' + (it.loop ? ' · loop' : '') })
        ]));
        row.appendChild(U.el('button', { class: 'btn sm', text: '▶', onclick: function () { Q.playAll(i); } }));
        row.appendChild(U.el('button', { class: 'btn sm', text: '✕', onclick: function () { Q.remove(i); paintAdded(); } }));
        addedList.appendChild(row);
      });
      addedInfo.textContent = Q.items.length + ' motion · tổng ' + Q.totalDuration().toFixed(1) + 's · export All Added dùng Anim GLB Export (mở Rig → Export).';
    }

    section.appendChild(sc);
    body.insertBefore(section, body.firstChild);
    paint();
    paintAdded();
    bus.on('anim-queue:changed', function () { paintAdded(); });
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.MotionLibrary = Lib;
})();
