/* ============================================================
 * animation/animation-manager.js — Mixer cho GLB clips thật,
 * preset procedural cho sample, play/pause/speed/loop/crossfade,
 * UI panel Animation Studio.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Anim = {
    mixer: null,
    targetObject: null,
    clips: [],              // [{name, duration, clip, isPreset, loop}]
    actions: {},            // name -> THREE.AnimationAction
    current: null,          // name đang phát
    speed: 1.0,
    looping: true,
    _paused: false
  };

  /* ---------- Setup cho 1 object ---------- */
  Anim.setTarget = function (object3D) {
    if (Anim.mixer) { Anim.mixer.stopAllAction(); Anim.mixer.uncacheRoot(Anim.mixer.getRoot()); Anim.mixer = null; }
    Anim.actions = {};
    Anim.current = null;
    Anim.targetObject = object3D;
    if (object3D && window.THREE) {
      Anim.mixer = new THREE.AnimationMixer(object3D);
    }
    /* clips có sẵn từ GLB entry */
    const entry = object3D && object3D.userData && object3D.userData.modelEntry;
    Anim.clips = entry && entry.clips ? entry.clips.map(function (c) {
      return { name: c.name || 'Clip', duration: c.duration || 0, clip: c, isPreset: false, loop: true };
    }) : [];
    bus.emit('animation:clips', { clips: Anim.clips.map(function (c) { return { name: c.name, duration: c.duration, isPreset: c.isPreset }; }) });
  };

  Anim.registerGLTFClips = function (object3D, gltfClips) {
    Anim.setTarget(object3D);
    if (gltfClips && gltfClips.length) {
      bus.emit('notify', {
        type: 'info', title: 'Animation clips',
        message: 'Model có ' + gltfClips.length + ' clip có sẵn — phát được ngay trong Animation panel & Timeline.'
      });
    }
  };

  /* ---------- Thêm preset clip cho object (procedural thật) ---------- */
  Anim.applyPreset = function (presetId) {
    if (!window.THREE) return;
    const target = Anim.targetObject || PixiStudio.Viewport.getMainModel();
    if (!target) {
      bus.emit('notify', { type: 'warning', title: 'Auto Animate', message: 'Chưa có model nào. Load model trước.' });
      return;
    }
    if (!Anim.targetObject || Anim.targetObject !== target) Anim.setTarget(target);

    const meta = PixiStudio.AnimPresets.META.find(function (m) { return m.id === presetId; });
    if (!meta) return;

    /* Nếu đã có preset này thì không nhân bản */
    if (Anim.clips.some(function (c) { return c.name === meta.name; })) {
      Anim.play(meta.name);
      return;
    }

    const clip = PixiStudio.AnimPresets.generate(presetId);
    if (!clip) return;

    /* Track '.position' trên mixer ứng với object gốc — cho chibi sample:
       track position/y bob toàn thân ok. Rotation: quay quanh Y. */
    Anim.clips.push({ name: meta.name, duration: clip.duration, clip: clip, isPreset: true, loop: meta.loop });
    bus.emit('animation:clip', { name: meta.name, duration: clip.duration, isPreset: true });
    Anim.play(meta.name);
  };

  /* ---------- Auto Animate (nút trong Model Tools) ---------- */
  Anim.autoAnimate = function (targetObject) {
    const target = targetObject || PixiStudio.Viewport.getMainModel();
    if (!target) {
      bus.emit('notify', { type: 'warning', title: 'Auto Animate', message: 'Chưa có model nào.' });
      return;
    }
    /* Nếu model GLB có clip sẵn → phát clip đầu tiên */
    const entry = target.userData && target.userData.modelEntry;
    if (entry && entry.isGLB && entry.clips && entry.clips.length) {
      Anim.setTarget(target);
      Anim.play(entry.clips[0].name || 'Clip');
      bus.emit('notify', { type: 'success', title: 'Auto Animate', message: 'Phát clip "' + (entry.clips[0].name || 'Clip') + '" từ GLB (' + entry.clips.length + ' clips).' });
      return;
    }
    /* Không có clip → áp preset Idle + Walk */
    Anim.applyPreset('idle');
    bus.emit('notify', {
      type: 'success', title: 'Auto Animate hoàn tất',
      message: 'Đã gán preset Idle cho ' + (target.name || 'model') + '. 16 preset khả dụng trong Animation panel.'
    });
  };

  /* ---------- Guard: clip phải hợp lệ trước khi phát ----------
     three.js tính valueSize = values.length / times.length. Nếu track được dựng
     sai (ví dụ truyền mảng lồng [quat, quat, …] → Float32Array toàn NaN, length
     = số quaternion) thì valueSize sai → QuaternionLinearInterpolant.interpolate_
     lặp vô hạn (offset += 4 trong khi end = offset + 1) → treo cứng app.
     Trả về danh sách track sai để chặn phát. */
  Anim.validateClip = function (clip) {
    const bad = [];
    if (!clip || !clip.tracks) return bad;
    clip.tracks.forEach(function (t) {
      const size = t.name.indexOf('quaternion') !== -1 ? 4 : 3;
      const need = t.times.length * size;
      if (t.values.length !== need) {
        bad.push(t.name + ' values=' + t.values.length + ' cần=' + need);
      } else if (t.values.length) {
        for (let i = 0; i < t.values.length; i++) {
          if (!isFinite(t.values[i])) { bad.push(t.name + ' có giá trị NaN/Inf'); break; }
        }
      }
    });
    return bad;
  };

  /* ---------- Playback ---------- */
  Anim.play = function (name) {
    if (!Anim.mixer) {
      const target = Anim.targetObject || PixiStudio.Viewport.getMainModel();
      if (target) Anim.setTarget(target);
    }
    if (!Anim.mixer) {
      bus.emit('notify', { type: 'warning', title: 'Animation', message: 'Chưa có model nào để phát animation.' });
      return;
    }
    const clipEntry = Anim.clips.find(function (c) { return c.name === name; });
    if (!clipEntry) return;

    /* chặn clip sai cấu trúc track — tránh treo app */
    const badTracks = Anim.validateClip(clipEntry.clip);
    if (badTracks.length) {
      console.error('[Anim] clip không hợp lệ, đã chặn phát:', name, badTracks);
      bus.emit('notify', {
        type: 'error', title: 'Clip không hợp lệ — đã chặn',
        message: '"' + name + '" có ' + badTracks.length + ' track sai số lượng giá trị (' + badTracks[0] + '). Đã chặn phát để không treo app.'
      });
      return;
    }

    const action = Anim.mixer.clipAction(clipEntry.clip);
    action.reset();
    action.setLoop(clipEntry.loop && Anim.looping ? THREE.LoopRepeat : THREE.LoopOnce);
    action.clampWhenFinished = !clipEntry.loop;
    action.setEffectiveTimeScale(Anim.speed);
    action.setEffectiveWeight(1);
    action.play();

    /* Crossfade từ clip cũ */
    if (Anim.current && Anim.current !== name && Anim.actions[Anim.current]) {
      const old = Anim.actions[Anim.current];
      old.crossFadeTo(action, 0.25, false);
    }

    Anim.actions[name] = action;
    Anim.current = name;
    Anim._paused = false;
    bus.emit('animation:played', { name: name, duration: clipEntry.duration });
  };

  Anim.pause = function () {
    if (Anim.current && Anim.actions[Anim.current]) {
      Anim.actions[Anim.current].paused = true;
    }
    Anim._paused = true;
    bus.emit('animation:paused', {});
  };

  Anim.resume = function () {
    if (Anim.current && Anim.actions[Anim.current]) {
      Anim.actions[Anim.current].paused = false;
    }
    Anim._paused = false;
    bus.emit('animation:resumed', {});
  };

  Anim.stop = function () {
    if (Anim.mixer) Anim.mixer.stopAllAction();
    Anim.current = null;
    Anim._paused = false;
    bus.emit('animation:stopped', {});
  };

  Anim.setSpeed = function (s) {
    Anim.speed = Math.max(0.05, Math.min(4, s));
    if (Anim.current && Anim.actions[Anim.current]) {
      Anim.actions[Anim.current].setEffectiveTimeScale(Anim.speed);
    }
    bus.emit('animation:speed', { speed: Anim.speed });
  };

  Anim.setLoop = function (on) {
    Anim.looping = !!on;
    if (Anim.current && Anim.actions[Anim.current]) {
      Anim.actions[Anim.current].setLoop(Anim.looping ? THREE.LoopRepeat : THREE.LoopOnce);
    }
  };

  /* Mỗi frame từ app loop */
  Anim.update = function (dt) {
    if (Anim.mixer && !Anim._paused) {
      Anim.mixer.update(dt * Anim.speed);
    }
  };

  /* Retarget preset cho GLB có skeleton — thử khớp theo tên bone phổ biến */
  Anim.retargetCheck = function (object3D) {
    const boneNames = [];
    object3D.traverse(function (o) { if (o.isBone && o.name) boneNames.push(o.name); });
    if (!boneNames.length) return { hasBones: false, matches: 0 };
    let matches = 0;
    PixiStudio.AnimPresets.RETARGET_MAP.forEach(function (candidate) {
      if (boneNames.indexOf(candidate) !== -1) matches++;
    });
    return { hasBones: true, matches: matches, boneCount: boneNames.length };
  };

  /* ============================================================
     UI PANEL (page-animation)
     ============================================================ */
  Anim.renderPanel = function () {
    const body = U.$('#animation-page-body');
    if (!body) return;
    body.innerHTML = '';

    /* Current playback card */
    const playback = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('animation') }),
        U.el('span', { text: 'Playback' })
      ])
    ]);
    const pc = U.el('div', { class: 'section-content' });
    const infoRow = U.el('div', { class: 'info-row' }, [
      U.el('span', { class: 'i-label', text: 'Current' }),
      U.el('span', { class: 'i-value', text: Anim.current || '—' })
    ]);
    const speedRow = U.el('div', { class: 'slider-row' }, [
      U.el('span', { class: 's-label', text: 'Speed' }),
      (function () {
        const s = U.el('input', { type: 'range', class: 'slider', min: '0.1', max: '3', step: '0.1', value: String(Anim.speed) });
        s.addEventListener('input', function () {
          Anim.setSpeed(parseFloat(s.value));
          const val = document.getElementById('anim-speed-val');
          if (val) val.textContent = s.value + 'x';
        });
        return s;
      })(),
      U.el('span', { class: 's-val', id: 'anim-speed-val', text: Anim.speed + 'x' })
    ]);
    pc.appendChild(infoRow);
    pc.appendChild(speedRow);
    const btnRow = U.el('div', { style: 'display:flex;gap:6px;' }, [
      U.el('button', { class: 'btn sm grow primary', html: U.icon('play') + ' Play', onclick: function () { if (Anim.current) Anim.play(Anim.current); else if (Anim.clips.length) Anim.play(Anim.clips[0].name); } }),
      U.el('button', { class: 'btn sm grow', html: U.icon('pause') + ' Pause', onclick: function () { Anim.pause(); } }),
      U.el('button', { class: 'btn sm grow', html: U.icon('stop') + ' Stop', onclick: function () { Anim.stop(); } })
    ]);
    pc.appendChild(btnRow);
    playback.appendChild(pc);
    body.appendChild(playback);

    /* GLB clips (nếu có) */
    if (Anim.clips.length) {
      const clipSection = U.el('div', { class: 'section-block' }, [
        U.el('div', { class: 'section-head' }, [
          U.el('span', { html: U.icon('layers') }),
          U.el('span', { text: 'Clips (' + Anim.clips.length + ')' })
        ])
      ]);
      const cc = U.el('div', { class: 'section-content' });
      Anim.clips.forEach(function (c) {
        const row = U.el('div', { class: 'anim-row' }, [
          U.el('div', { class: 'anim-thumb', html: U.icon(c.isPreset ? 'wand' : 'file') }),
          U.el('div', { class: 'a-info' }, [
            U.el('b', { text: c.name }),
            U.el('span', { text: c.duration.toFixed(2) + 's · ' + (c.isPreset ? 'preset' : 'GLB') })
          ]),
          U.el('button', {
            class: 'anim-play' + (Anim.current === c.name ? ' playing' : ''),
            html: U.icon(Anim.current === c.name ? 'pause' : 'play'),
            onclick: function () {
              if (Anim.current === c.name) Anim.pause(); else Anim.play(c.name);
              Anim.renderPanel();
            }
          })
        ]);
        cc.appendChild(row);
      });
      clipSection.appendChild(cc);
      body.appendChild(clipSection);
    }

    /* 16 presets grid */
    const grid = U.el('div', { class: 'mt-grid' });
    PixiStudio.AnimPresets.META.forEach(function (m) {
      grid.appendChild(U.el('button', {
        class: 'mt-btn',
        html: U.icon(m.icon) + '<span>' + m.name + '</span>',
        onclick: function () {
          Anim.applyPreset(m.id);
          Anim.renderPanel();
          /* đồng thời đưa vào timeline playback nếu muốn */
        }
      }));
    });
    body.appendChild(U.el('div', { class: 'page-block' }, [
      U.el('h4', { text: 'Animation Presets — 16 clips procedural' }),
      grid
    ]));

    /* Retarget status trung thực */
    const target = Anim.targetObject || PixiStudio.Viewport.getMainModel();
    if (target) {
      const rt = Anim.retargetCheck(target);
      body.appendChild(U.el('div', { class: 'section-block' }, [
        U.el('div', { class: 'section-head' }, [U.el('span', { html: U.icon('link') }), U.el('span', { text: 'Retargeting' })]),
        U.el('div', { class: 'section-content' }, [
          U.el('div', { class: 'info-row' }, [
            U.el('span', { class: 'i-label', text: 'Skeleton' }),
            U.el('span', { class: 'i-value', text: rt.hasBones ? rt.boneCount + ' bones' : 'no bones (sample)' })
          ]),
          U.el('div', { class: 'info-row' }, [
            U.el('span', { class: 'i-label', text: 'Retarget match' }),
            rt.hasBones && rt.matches > 0
              ? U.el('span', { class: 'state-badge ok', text: rt.matches + ' match' })
              : U.el('span', { class: 'state-badge off', text: 'presets animate object root' })
          ]),
          U.el('div', { class: 'empty-state', style: 'padding:10px;' }, [
            U.el('span', { text: 'Preset procedural điều khiển transform object. Retarget sâu theo bone cần model SkinnedMesh (GLB) — đã hỗ trợ phát clip gốc.' })
          ])
        ])
      ]));
    }
  };

  window.PixiStudio.Anim = Anim;
})();
