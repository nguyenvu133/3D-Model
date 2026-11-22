/* ============================================================
 * animation/anim-auto-gen.js — ANIMATION AUTO GEN (v5.1)
 * Sinh 6 animation clips procedural CHẠY TRÊN BONE TREE thật
 * (từ RigAutoGen) bằng THREE.AnimationClip quaternion/vector tracks:
 *   Idle · Walk · Run · Attack · Combo · Dodge
 * Mixer autoplay với crossfade — preview skeleton di động ngay.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;
  const pre = 'mixamorig:';

  function quat(x, y, z) {
    const q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z)
    ));
    return q.toArray();
  }
  const ID = quat(0, 0, 0);

  /* three.js cần mảng SỐ PHẲNG (Vector 3×n, Quaternion 4×n). Truyền mảng lồng
     [quat, quat, …] → Float32Array toàn NaN, độ dài sai → interpolant quaternion
     lặp vô hạn → treo app. fitValues() làm phẳng + khớp times.length × size. */
  function fitValues(times, values, size) {
    const need = times.length * size;
    const def = function (k) { return (size === 4 && k === 3) ? 1 : 0; };
    let flat = values;
    if (values.length && Array.isArray(values[0])) {
      flat = [];
      values.forEach(function (v) { for (let i = 0; i < size; i++) flat.push(v[i]); });
    }
    /* loại bỏ mọi giá trị không hữu hạn — NaN làm three.js lặp vô hạn */
    flat = Array.prototype.map.call(flat, function (x, i) {
      return (typeof x === 'number' && isFinite(x)) ? x : def(i % size);
    });
    if (flat.length === need) return flat;
    const out = flat.slice(0, need);
    /* thiếu → lặp lại frame cuối, TỪNG THÀNH PHẦN MỘT (không vượt quá need) */
    const lastFrame = flat.length >= size ? flat.slice(flat.length - size) : null;
    while (out.length < need) {
      const k = out.length % size;
      out.push(lastFrame ? lastFrame[k] : def(k));
    }
    return out;
  }

  function qTrack(bone, times, values) {
    return new THREE.QuaternionKeyframeTrack(bone + '.quaternion', times, fitValues(times, values, 4));
  }
  function vTrack(bone, times, values) {
    return new THREE.VectorKeyframeTrack(bone + '.position', times, fitValues(times, values, 3));
  }
  function times(n, dur) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(dur * i / (n - 1));
    return out;
  }

  const AnimAutoGen = {
    currentClip: 'Idle',
    definitions: [
      { id: 'Idle', dur: 2.6, icon: 'character' },
      { id: 'Walk', dur: 1.0, icon: 'character' },
      { id: 'Run', dur: 0.7, icon: 'character' },
      { id: 'Attack', dur: 0.8, icon: 'swords' },
      { id: 'Combo', dur: 1.4, icon: 'swords' },
      { id: 'Dodge', dur: 0.6, icon: 'cursor' }
    ]
  };

  /* ---------- Clip generators (bone names theo RigAutoGen map) ---------- */
  const GEN = {};

  GEN.Idle = function (b) {
    const t = times(5, 2.6);
    return new THREE.AnimationClip('Idle', 2.6, [
      vTrack(b.Hips, t, [
        [0, 0, 0], [0, 0.012, 0], [0, 0, 0], [0, 0.012, 0], [0, 0, 0]
      ]),
      qTrack(b.Spine, t, [ID, quat(2, 0, 1.5), ID, quat(2, 0, -1.5), ID]),
      qTrack(b.Head, t, [ID, quat(-3, 4, 0), ID, quat(-3, -4, 0), ID]),
      qTrack(b.LeftArm, t, [ID, quat(0, 0, 6), ID, quat(0, 0, 4), ID]),
      qTrack(b.RightArm, t, [ID, quat(0, 0, -4), ID, quat(0, 0, -6), ID]),
      qTrack(b.LeftForeArm, t, [ID, quat(-8, 0, 0), ID, quat(-5, 0, 0), ID]),
      qTrack(b.RightForeArm, t, [ID, quat(-5, 0, 0), ID, quat(-8, 0, 0), ID])
    ]);
  };

  GEN.Walk = function (b) {
    const t = times(9, 1.0);
    const s = [0, 1, 2, 3, 4, 3, 2, 1, 0];
    return new THREE.AnimationClip('Walk', 1.0, [
      vTrack(b.Hips, t, s.map(function (_, i) { return [0, i % 2 === 0 ? 0.018 : 0, 0]; })),
      qTrack(b.LeftUpLeg, t, s.map(function (_, i) {
        const a = [26, 10, -14, -26, -10, 14, 26, 10, 0][i];
        return quat(a, 0, 0);
      })),
      qTrack(b.RightUpLeg, t, s.map(function (_, i) {
        const a = [-10, -26, -10, 26, 10, -14, -10, -26, 0][i];
        return quat(a, 0, 0);
      })),
      qTrack(b.LeftLeg, t, s.map(function (_, i) {
        const a = [-8, -30, -12, 0, -8, -6, -8, -30, 0][i];
        return quat(a, 0, 0);
      })),
      qTrack(b.RightLeg, t, s.map(function (_, i) {
        const a = [-6, -8, -30, -12, 0, -8, -6, -8, 0][i];
        return quat(a, 0, 0);
      })),
      qTrack(b.LeftArm, t, s.map(function (_, i) {
        const a = [-22, 0, 22, 0, -22, 0, -22, 0, 0][i];
        return quat(a, 0, 0);
      })),
      qTrack(b.RightArm, t, s.map(function (_, i) {
        const a = [22, 0, -22, 0, 22, 0, 22, 0, 0][i];
        return quat(a, 0, 0);
      })),
      qTrack(b.Spine, t, s.map(function (_, i) {
        return quat(i % 2 === 0 ? 3 : 0, i % 2 ? 3 : -3, 0);
      }))
    ]);
  };

  GEN.Run = function (b) {
    const t = times(7, 0.7);
    return new THREE.AnimationClip('Run', 0.7, [
      vTrack(b.Hips, t, [[0, 0.03, 0], [0, 0.09, 0], [0, 0.03, 0], [0, 0.09, 0], [0, 0.03, 0], [0, 0.09, 0], [0, 0.03, 0]]),
      qTrack(b.Spine, t, [quat(8, 0, 0), quat(14, 0, 0), quat(8, 0, 0), quat(14, 0, 0), quat(8, 0, 0), quat(14, 0, 0), quat(8, 0, 0)]),
      qTrack(b.LeftUpLeg, t, [quat(45, 0, 0), quat(-30, 0, 0), quat(45, 0, 0), quat(-30, 0, 0), quat(45, 0, 0), quat(-30, 0, 0), quat(45, 0, 0)]),
      qTrack(b.RightUpLeg, t, [quat(-30, 0, 0), quat(45, 0, 0), quat(-30, 0, 0), quat(45, 0, 0), quat(-30, 0, 0), quat(45, 0, 0), quat(-30, 0, 0)]),
      qTrack(b.LeftLeg, t, [quat(-70, 0, 0), quat(-10, 0, 0), quat(-70, 0, 0), quat(-10, 0, 0), quat(-70, 0, 0), quat(-10, 0, 0), quat(-70, 0, 0)]),
      qTrack(b.RightLeg, t, [quat(-10, 0, 0), quat(-70, 0, 0), quat(-10, 0, 0), quat(-70, 0, 0), quat(-10, 0, 0), quat(-70, 0, 0), quat(-10, 0, 0)]),
      qTrack(b.LeftArm, t, [quat(-80, 0, 0), quat(40, 0, 0), quat(-80, 0, 0), quat(40, 0, 0), quat(-80, 0, 0), quat(40, 0, 0), quat(-80, 0, 0)]),
      qTrack(b.RightArm, t, [quat(40, 0, 0), quat(-80, 0, 0), quat(40, 0, 0), quat(-80, 0, 0), quat(40, 0, 0), quat(-80, 0, 0), quat(40, 0, 0)]),
      qTrack(b.LeftForeArm, t, [quat(-70, 0, 0), quat(-90, 0, 0), quat(-70, 0, 0), quat(-90, 0, 0), quat(-70, 0, 0), quat(-90, 0, 0), quat(-70, 0, 0)]),
      qTrack(b.RightForeArm, t, [quat(-90, 0, 0), quat(-70, 0, 0), quat(-90, 0, 0), quat(-70, 0, 0), quat(-90, 0, 0), quat(-70, 0, 0), quat(-90, 0, 0)])
    ]);
  };

  GEN.Attack = function (b) {
    const t = times(6, 0.8);
    return new THREE.AnimationClip('Attack', 0.8, [
      qTrack(b.Chest, t, [ID, quat(0, -35, 0), quat(0, 45, 0), quat(0, 15, 0), quat(0, 0, 0), ID]),
      qTrack(b.Spine, t, [ID, quat(0, -20, 0), quat(0, 25, 0), quat(0, 8, 0), ID, ID]),
      qTrack(b.RightArm, t, [ID, quat(0, 0, -70), quat(-60, 0, 40), quat(-20, 0, 10), ID, ID]),
      qTrack(b.RightForeArm, t, [ID, quat(-70, 0, 0), quat(-30, 0, 0), quat(-60, 0, 0), ID, ID]),
      qTrack(b.LeftArm, t, [ID, quat(0, 0, 30), quat(20, 0, 10), ID, ID, ID]),
      /* Hips là POSITION (3 thành phần) — trước đây dùng qTrack → NaN */
      vTrack(b.Hips, t, [[0, 0, 0], [0, 0, 0], [0, 0.04, 0.05], [0, 0.02, 0.02], [0, 0, 0], [0, 0, 0]])
    ]);
  };

  GEN.Combo = function (b) {
    const t = times(9, 1.4);
    return new THREE.AnimationClip('Combo', 1.4, [
      qTrack(b.Chest, t, [ID, quat(0, -40, 0), quat(0, 50, 0), quat(0, -10, 0), quat(0, 55, 0), quat(0, -50, 0), quat(0, 20, 0), ID, ID]),
      qTrack(b.RightArm, t, [ID, quat(0, 0, -75), quat(-70, 0, 45), quat(0, 0, -10), quat(-75, 0, -30), quat(40, 0, 60), quat(-30, 0, 10), ID, ID, ID]),
      qTrack(b.LeftArm, t, [ID, quat(30, 0, 40), quat(0, 0, 15), quat(-60, 0, 45), quat(20, 0, 15), quat(-20, 0, 20), ID, ID, ID, ID]),
      /* Hips là POSITION (3 thành phần) — trước đây dùng qTrack → NaN */
      vTrack(b.Hips, t, [[0, 0, 0], [0, 0, 0], [0, 0.03, 0.06], [0, 0, 0.02], [0, 0.03, -0.04], [0, 0.02, 0.03], [0, 0, 0], [0, 0, 0], [0, 0, 0]])
    ]);
  };

  GEN.Dodge = function (b) {
    const t = times(5, 0.6);
    return new THREE.AnimationClip('Dodge', 0.6, [
      vTrack(b.Hips, t, [[0, 0, 0], [0, -0.10, 0], [0, -0.16, -0.12], [0, -0.08, -0.06], [0, 0, 0]]),
      qTrack(b.Spine, t, [ID, quat(10, 0, -14), quat(16, 0, -20), quat(6, 0, -8), ID]),
      qTrack(b.LeftUpLeg, t, [ID, quat(-50, 0, 0), quat(-30, 0, 0), quat(-10, 0, 0), ID]),
      qTrack(b.RightUpLeg, t, [ID, quat(10, 0, 0), quat(20, 0, 0), quat(8, 0, 0), ID]),
      qTrack(b.LeftArm, t, [ID, quat(0, 0, 40), quat(0, 0, 55), quat(0, 0, 20), ID])
    ]);
  };

  /* ---------- Generate tất cả clips cho rig hiện tại ---------- */
  AnimAutoGen.generateAll = function (rig) {
    if (!rig || !rig.bones) return [];
    /* Bone names trong tree: dùng ĐẦ ĐUÔI name (không prefix) — PropertyBinding
       tìm theo nodeName trong hierarchy nên dùng đúng name đã đặt */
    const names = {};
    Object.keys(rig.bones).forEach(function (k) {
      names[k] = rig.bones[k].name;   // 'mixamorig:Hips' hoặc 'Hips'
    });
    const clips = AnimAutoGen.definitions.map(function (def) {
      const fn = GEN[def.id];
      const clip = fn(names);
      return { id: def.id, name: def.id, duration: clip.duration, clip: clip, icon: def.icon, loop: def.id === 'Attack' || def.id === 'Dodge' ? false : true };
    });
    return clips;
  };

  /* ---------- Play / crossfade ---------- */
  AnimAutoGen.play = function (clipId) {
    const rig = PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
    if (!rig || !rig.clips) {
      bus.emit('notify', { type: 'warning', title: 'Animation Auto Gen', message: 'Chưa có Auto Gen rig — bấm ⚡ Auto Rig Gen trước.' });
      return;
    }
    const entry = rig.clips.find(function (c) { return c.id === clipId; });
    if (!entry) return;
    /* chặn clip sai cấu trúc track — tránh treo app (xem Anim.validateClip) */
    const badTracks = PixiStudio.Anim && PixiStudio.Anim.validateClip ? PixiStudio.Anim.validateClip(entry.clip) : [];
    if (badTracks.length) {
      bus.emit('notify', { type: 'error', title: 'Clip Auto Gen không hợp lệ', message: entry.id + ': ' + badTracks[0] + ' — đã chặn phát.' });
      return;
    }
    const mixer = rig.mixer;
    if (!mixer._actions) mixer._actions = {};
    const action = mixer.clipAction(entry.clip);
    action.reset();
    action.setLoop(entry.loop ? THREE.LoopRepeat : THREE.LoopOnce);
    action.clampWhenFinished = !entry.loop;
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.play();
    if (AnimAutoGen.currentClip && mixer._actions[AnimAutoGen.currentClip] && AnimAutoGen.currentClip !== clipId) {
      const old = mixer._actions[AnimAutoGen.currentClip];
      old.crossFadeTo(action, 0.22, false);
    }
    mixer._actions[clipId] = action;
    AnimAutoGen.currentClip = clipId;
    PixiStudio.RigAutoGen.playing = true;
    bus.emit('anim:autogen-played', { clip: clipId, duration: entry.duration });
  };

  /* ---------- UI trong Animation panel ---------- */
  AnimAutoGen.renderPanel = function () {
    const body = document.getElementById('animation-page-body');
    if (!body || document.getElementById('anim-autogen-section')) return;

    const section = U.el('div', { class: 'section-block', id: 'anim-autogen-section' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('wand') }),
        U.el('span', { text: '🎬 Animation Auto Gen — 6 clips trên bone tree' })
      ])
    ]);
    const sc = U.el('div', { class: 'section-content' });

    const rig = PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
    if (!rig || !rig.clips) {
      sc.appendChild(U.el('div', { class: 'empty-state', style: 'padding:10px;' }, [
        U.el('b', { text: 'Chưa có Auto Gen rig' }),
        U.el('span', { text: 'Mở panel Rig → ⚡ AUTO RIG GEN để sinh bone tree + clips tự động.' }),
        U.el('button', {
          class: 'btn primary sm', style: 'margin-top:8px;',
          html: U.icon('wand') + ' Auto Rig Gen ngay',
          onclick: function () {
            if (PixiStudio.RigAutoGen) PixiStudio.RigAutoGen.generate(null, 'Studio Humanoid');
            AnimAutoGen.renderPanel();
          }
        })
      ]));
    /* FIX: section chứa empty-state phải được chèn vào panel — trước đây
       section chỉ appendChild(sc) ở nhánh có rig nên khi chưa rig cả hướng
       dẫn "Chưa có Auto Gen rig" lẫn nút "Auto Rig Gen ngay" đều biến mất. */
    section.appendChild(sc);
    body.insertBefore(section, body.firstChild);
    /* ===== 2 NÚT MESHY-STYLE: Rig AI Gen + Animation AI Gen ===== */
    const meshyBtns = U.el('div', { class: 'section-block', id: 'meshy-gen-buttons' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('wand') }),
        U.el('span', { text: 'AI Gen — giống Meshy Workspace' })
      ])
    ]);
    const mc = U.el('div', { class: 'section-content' });
    mc.appendChild(U.el('button', {
      class: 'btn primary lg block',
      style: 'margin-bottom:8px;',
      html: U.icon('rig') + '&nbsp; 🦴 Rig AI Gen — Auto-Rigging skeleton',
      onclick: function () {
        if (PixiStudio.MeshyRigging) {
          PixiStudio.Topbar.selectWorkspace('rigging');
          PixiStudio.MeshyRigging.autoRig();
        }
      }
    }));
    mc.appendChild(U.el('button', {
      class: 'btn success lg block',
      style: 'margin-bottom:8px;',
      html: U.icon('animation') + '&nbsp; 🎬 Animation AI Gen — Idle/Attack/Running',
      onclick: function () {
        /* Sinh animation: FBX Running có sẵn → play Idle; chưa có → load FBX rồi play */
        if (PixiStudio.FbxRig.loaded && PixiStudio.FbxRig.generated.length) {
          PixiStudio.FbxRig.addToViewport();
          PixiStudio.FbxRig.play('Running');
          bus.emit('notify', { type: 'success', title: '🎬 Animation AI Gen', message: 'Clips Ready: Idle/Attack/Running — đang play Running trên model FBX.' });
        } else {
          PixiStudio.Notifications.showLoading('Animation AI Gen — load FBX Meshy + sinh clips…', 30);
          PixiStudio.FbxRig.autoLoad().then(function (result) {
            PixiStudio.Notifications.hideLoading();
            if (result) {
              PixiStudio.FbxRig.addToViewport();
              PixiStudio.FbxRig.play('Running');
              if (PixiStudio.FbxRig.renderPanel) PixiStudio.FbxRig.renderPanel();
              bus.emit('notify', { type: 'success', title: '🎬 Animation AI Gen hoàn tất', message: 'Idle/Attack sinh từ Running — đang play.' });
            } else {
              bus.emit('notify', { type: 'warning', title: 'Không có FBX', message: 'Cần file FBX trong assets/models — hoặc dùng 16 preset procedural ở dưới.' });
            }
          }).catch(function (e) {
            PixiStudio.Notifications.hideLoading();
            bus.emit('notify', { type: 'error', title: 'Animation AI Gen lỗi', message: e.message });
          });
        }
      }
    }));
    mc.appendChild(U.el('div', { class: 'dim small', style: 'line-height:1.5;', text: 'Pipeline giống Meshy: Upload → 🦴 Rig AI Gen (skeleton Mixamo) → 🎬 Animation AI Gen (Idle/Attack/Running trên cùng model).' }));
    meshyBtns.appendChild(mc);
    body.insertBefore(meshyBtns, body.firstChild);
    return;
  }

    /* Clip buttons grid */
    const grid = U.el('div', { class: 'mt-grid', style: 'grid-template-columns:repeat(3,1fr);gap:5px;' });
    rig.clips.forEach(function (c) {
      grid.appendChild(U.el('button', {
        class: 'mt-btn' + (AnimAutoGen.currentClip === c.id ? ' primary' : ''),
        html: U.icon(c.icon) + '<span>' + c.id + '</span>',
        onclick: function () {
          AnimAutoGen.play(c.id);
          AnimAutoGen.renderPanel();
        }
      }));
    });
    sc.appendChild(grid);

    /* status */
    sc.appendChild(U.el('div', {
      class: 'dim small', style: 'margin-top:8px;line-height:1.5;',
      html: 'Đang phát: <b style="color:#b79bff">' + AnimAutoGen.currentClip + '</b> · skeleton <b style="color:var(--success)">di động thật</b> (THREE.Bone tree + AnimationMixer)'
    }));

    section.appendChild(sc);
    body.insertBefore(section, body.firstChild);
  };

  window.PixiStudio.AnimAutoGen = AnimAutoGen;
})();
