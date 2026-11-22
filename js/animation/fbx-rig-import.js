/* ============================================================
 * animation/fbx-rig-import.js — MESHY FBX RIG IMPORT (v5.1)
 * Học theo Meshy workspace rig+animation pipeline:
 *   1. Đọc FBX thật (FBXLoader + fflate): Meshy_AI_kiem_hiep animated_mixamo
 *   2. Trích skeleton bone tree (Mixamo naming) + Running clip data
 *   3. SINH IDLE & ATTACK từ dữ liệu Running (procedural retarget):
 *      • Idle  — rest pose + breathing sway ±2°, 3.2s loop
 *      • Attack — tìm frame arm-deviation max trong Running → wind-up → strike
 *   4. Đăng ký clips vào mixer — play ngay trong Studio
 *   5. Export clips JSON + áp vào model bất kỳ qua bone-name retarget
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const FbxRig = {
    fbxRoot: null,          // THREE.Group từ FBXLoader
    skeleton: null,         // { boneNames, boneCount, hierarchy }
    runningClip: null,      // THREE.AnimationClip gốc
    generated: [],          // [{id, name, clip, source}]
    mixer: null,            // mixer cho fbxRoot preview
    actions: {},
    current: null,
    loaded: false,
    fileName: '',
    AMPLITUDE: {            // độ sway Idle theo bone
      Spine: 0.045, Spine1: 0.04, Spine2: 0.035,
      Chest: 0.03, Neck: 0.02, Head: 0.05,
      Hips: 0.02, LeftUpLeg: 0.01, RightUpLeg: 0.01,
      LeftArm: 0.03, RightArm: 0.03, LeftForeArm: 0.02, RightForeArm: 0.02,
      LeftHand: 0.015, RightHand: 0.015
    }
  };

  /* ============================================================
     LOAD FBX — url hoặc File
     ============================================================ */
  FbxRig.loadFromUrl = function (url) {
    return new Promise(function (resolve, reject) {
      if (!window.THREE || !THREE.FBXLoader) { reject(new Error('FBXLoader chưa load (CDN)')); return; }
      if (typeof fflate === 'undefined') { reject(new Error('fflate chưa load (CDN)')); return; }
      const loader = new THREE.FBXLoader();
      loader.load(url, function (object) {
        resolve(FbxRig._process(object));
      }, undefined, function (err) {
        reject(new Error('FBX load fail: ' + String(err && err.message || err)));
      });
    });
  };

  FbxRig.loadFromFile = function (file) {
    return new Promise(function (resolve, reject) {
      if (!window.THREE || !THREE.FBXLoader) { reject(new Error('FBXLoader chưa load (CDN)')); return; }
      U.readFileAsArrayBuffer(file).then(function (ab) {
        const loader = new THREE.FBXLoader();
        try {
          const object = loader.parse(ab, '');
          resolve(FbxRig._process(object));
        } catch (e) {
          reject(new Error('FBX parse fail: ' + e.message));
        }
      }).catch(reject);
    });
  };

  FbxRig._process = function (object) {
    FbxRig.fbxRoot = object;
    FbxRig.loaded = true;

    /* Skeleton analysis */
    const boneNames = [];
    const hierarchy = {};
    object.traverse(function (o) {
      if (o.isBone) {
        boneNames.push(o.name);
        hierarchy[o.name] = { parent: o.parent && o.parent.isBone ? o.parent.name : null, children: [] };
      }
    });
    Object.keys(hierarchy).forEach(function (n) {
      const p = hierarchy[n].parent;
      if (p && hierarchy[p]) hierarchy[p].children.push(n);
    });
    FbxRig.skeleton = { boneNames: boneNames, boneCount: boneNames.length, hierarchy: hierarchy };

    /* Extract clips */
    const clips = object.animations || [];
    FbxRig.runningClip = clips.length ? clips[0] : null;

    /* Skinned mesh nhận shadow */
    object.traverse(function (o) {
      if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    });

    /* Mixer preview — gắn vào viewport tạm thời */
    if (FbxRig.mixer) { FbxRig.mixer.stopAllAction(); }
    FbxRig.mixer = new THREE.AnimationMixer(object);
    FbxRig.actions = {};

    bus.emit('fbx:loaded', {
      boneCount: boneNames.length,
      clips: clips.map(function (c) { return { name: c.name, duration: c.duration }; })
    });

    /* Auto-generate Idle + Attack từ Running */
    let genIdle = null, genAtk = null;
    if (FbxRig.runningClip) {
      genIdle = FbxRig.generateIdle(FbxRig.runningClip);
      genAtk = FbxRig.generateAttack(FbxRig.runningClip);
      FbxRig.generated = [
        { id: 'Running', name: 'Running (FBX gốc)', clip: FbxRig.runningClip, loop: true, source: 'fbx' },
        { id: 'Idle', name: 'Idle (auto từ Running)', clip: genIdle, loop: true, source: 'generated' },
        { id: 'Attack', name: 'Attack (auto từ Running)', clip: genAtk, loop: false, source: 'generated' }
      ];
    }

    /* AUTO-PREVIEW: thêm vào viewport + focus + play Idle ngay — animation hiện chạy */
    setTimeout(function () {
      FbxRig.addToViewport();
      if (PixiStudio.Viewport && PixiStudio.Viewport.orbit) {
        PixiStudio.Viewport.setView('perspective');
        PixiStudio.Viewport.orbit.dTarget.set(0, 1.0, 0);
        PixiStudio.Viewport.orbit.dRadius = 3.6;
        PixiStudio.Viewport.orbit.dTheta = 0.6;
        PixiStudio.Viewport.orbit.dPhi = 1.25;
      }
      if (FbxRig.generated.length) FbxRig.play('Running');
      bus.emit('notify', {
        type: 'info', title: '🎞 Preview đang chạy',
        message: 'Model FBX trong viewport — phát Idle. Chọn Running/Attack trong Animation panel.'
      });
    }, 120);

    bus.emit('notify', {
      type: 'success', title: '🎞 FBX Rig Import thành công',
      message: boneNames.length + ' bones Mixamo · clip "' + (FbxRig.runningClip ? FbxRig.runningClip.name : '?') +
        '" (' + (FbxRig.runningClip ? FbxRig.runningClip.duration.toFixed(1) : 0) + 's) · Idle + Attack đã sinh tự động'
    });

    return { object: object, skeleton: FbxRig.skeleton, clips: FbxRig.generated };
  };

  /* ============================================================
     IDLE — từ Running: rest pose mỗi bone + breathing sway nhỏ
     ============================================================ */
  FbxRig.generateIdle = function (runningClip) {
    const dur = 3.2;
    const tracks = [];
    const times = [0, dur * 0.25, dur * 0.5, dur * 0.75, dur];

    runningClip.tracks.forEach(function (track) {
      if (track.name.indexOf('.quaternion') !== -1) {
        const boneName = track.name.split('.')[0];
        /* FBXLoader/Mixamo thường trả "mixamorigHips" hoặc
           "mixamorig:Hips"; AMPLITUDE dùng tên chuẩn "Hips". */
        const canonical = boneName.replace(/^mixamorig:?/i, '').replace(/^Bip01[_:]?/i, '');
        const amp = FbxRig.AMPLITUDE[canonical] !== undefined
          ? FbxRig.AMPLITUDE[canonical]
          : (FbxRig.AMPLITUDE[boneName] !== undefined ? FbxRig.AMPLITUDE[boneName] : 0.018);
        if (amp === undefined) {
          /* bone không trong AMPLITUDE — giữ rest static */
          const rest = new THREE.Quaternion().fromArray(track.values, 0);
          tracks.push(new THREE.QuaternionKeyframeTrack(track.name, [0, dur], [rest.x, rest.y, rest.z, rest.w, rest.x, rest.y, rest.z, rest.w]));
          return;
        }
        /* rest = giá trị đầu */
        const rest = new THREE.Quaternion().fromArray(track.values, 0);
        /* side detection: Left/Right → sway chiều ngược */
        const side = boneName.indexOf('Left') !== -1 ? -1 : boneName.indexOf('Right') !== -1 ? 1 : 0;
        const eulers = [
          [0, 0, 0],
          [amp * (side ? 0.3 : 1), amp * 0.7 * side, amp * 0.5 * side],
          [0, 0, 0],
          [amp * (side ? 0.3 : 1), -amp * 0.7 * side, -amp * 0.5 * side],
          [0, 0, 0]
        ];
        const values = [];
        eulers.forEach(function (e) {
          const q = rest.clone();
          const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2]));
          values.push.apply(values, q.multiply(dq).toArray());
        });
        tracks.push(new THREE.QuaternionKeyframeTrack(track.name, times, values));
      }
      else if (track.name.indexOf('.position') !== -1 && track.name.indexOf('Hips') !== -1) {
        /* Hips position: rest + breathing bob nhỏ */
        const rest = [track.values[0], track.values[1], track.values[2]];
        const values = [
          rest[0], rest[1], rest[2],
          rest[0], rest[1] + 0.008, rest[2],
          rest[0], rest[1], rest[2],
          rest[0], rest[1] + 0.008, rest[2],
          rest[0], rest[1], rest[2]
        ];
        tracks.push(new THREE.VectorKeyframeTrack(track.name, times, values));
      }
      /* bỏ các position track khác (chân stepping của Running) */
    });

    return new THREE.AnimationClip('Idle', dur, tracks);
  };

  /* ============================================================
     ATTACK — từ Running: tìm frame arm deviation max → strike sequence
     Sequence: rest → wind-up (frame max-deviation) → strike (amplitude×1.35
     quanh strike pose) → return rest. Duration 0.85s.
     ============================================================ */
  FbxRig.generateAttack = function (runningClip) {
    const dur = 0.85;
    const times = [0, dur * 0.18, dur * 0.38, dur * 0.58, dur];

    /* rest quaternion của từng bone (từ frame 0) */
    const restQ = {};
    runningClip.tracks.forEach(function (track) {
      if (track.name.indexOf('.quaternion') !== -1) {
        restQ[track.name] = new THREE.Quaternion().fromArray(track.values, 0);
      }
    });

    /* Tìm frame arm-swing mạnh nhất trong Running (RightArm deviation từ rest) */
    let strikeFrameIdx = 0, maxDev = -1;
    runningClip.tracks.forEach(function (track) {
      if (track.name.indexOf('RightArm.quaternion') !== -1) {
        const rest = restQ[track.name];
        const count = track.times.length;
        for (let i = 0; i < count; i++) {
          const q = new THREE.Quaternion().fromArray(track.values, i * 4);
          const dev = Math.abs(q.x - rest.x) + Math.abs(q.y - rest.y) + Math.abs(q.z - rest.z) + Math.abs(q.w - rest.w);
          if (dev > maxDev) { maxDev = dev; strikeFrameIdx = i; }
        }
      }
    });

    /* strike quaternion của từng bone = sample tại strikeFrameIdx (clamp) */
    const strikeQ = {};
    runningClip.tracks.forEach(function (track) {
      if (track.name.indexOf('.quaternion') !== -1) {
        const count = track.times.length;
        const si = Math.min(strikeFrameIdx, count - 1);
        strikeQ[track.name] = new THREE.Quaternion().fromArray(track.values, si * 4);
      }
    });

    /* wind-up = nhân strike với phép đảo quanh Y 60% (giảm hướng) */
    const windUpQ = {};
    Object.keys(strikeQ).forEach(function (name) {
      const q = strikeQ[name].clone();
      const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.55);
      windUpQ[name] = q.slerp(flip.multiply(q), 0.4);
    });

    const tracks = [];
    runningClip.tracks.forEach(function (track) {
      if (track.name.indexOf('.quaternion') !== -1) {
        const rest = restQ[track.name] || new THREE.Quaternion();
        const strike = strikeQ[track.name] || rest;
        const windUp = windUpQ[track.name] || strike;
        const isArm = track.name.indexOf('Arm') !== -1 || track.name.indexOf('Shoulder') !== -1;
        const boost = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), isArm ? -0.35 : -0.12);
        const strikeBoost = strike.clone().multiply(boost);
        const values = [
          rest.x, rest.y, rest.z, rest.w,
          windUp.x, windUp.y, windUp.z, windUp.w,
          strikeBoost.x, strikeBoost.y, strikeBoost.z, strikeBoost.w,
          strike.x, strike.y, strike.z, strike.w,
          rest.x, rest.y, rest.z, rest.w
        ];
        tracks.push(new THREE.QuaternionKeyframeTrack(track.name, times, values));
      }
      else if (track.name.indexOf('.position') !== -1 && track.name.indexOf('Hips') !== -1) {
        const rest = [track.values[0], track.values[1], track.values[2]];
        const values = [
          rest[0], rest[1], rest[2],
          rest[0], rest[1] - 0.015, rest[2],
          rest[0], rest[1] + 0.02, rest[2] + 0.03,
          rest[0], rest[1], rest[2],
          rest[0], rest[1], rest[2]
        ];
        tracks.push(new THREE.VectorKeyframeTrack(track.name, times, values));
      }
    });

    return new THREE.AnimationClip('Attack', dur, tracks);
  };

  /* ============================================================
     PLAY — mixer trên fbxRoot
     ============================================================ */
  FbxRig.play = function (clipId) {
    if (!FbxRig.mixer || !FbxRig.generated.length) {
      bus.emit('notify', { type: 'warning', title: 'FBX Rig', message: 'Load FBX Meshy trước (nút Load FBX trong Animation panel).' });
      return;
    }
    const entry = FbxRig.generated.find(function (c) { return c.id === clipId; });
    if (!entry) return;
    /* chặn clip sai cấu trúc track — tránh treo app (xem Anim.validateClip) */
    const badTracks = PixiStudio.Anim && PixiStudio.Anim.validateClip ? PixiStudio.Anim.validateClip(entry.clip) : [];
    if (badTracks.length) {
      bus.emit('notify', { type: 'error', title: 'Clip FBX không hợp lệ', message: entry.id + ': ' + badTracks[0] + ' — đã chặn phát.' });
      return;
    }
    const action = FbxRig.mixer.clipAction(entry.clip);
    action.reset();
    action.setLoop(entry.loop ? THREE.LoopRepeat : THREE.LoopOnce);
    action.clampWhenFinished = !entry.loop;
    action.play();
    if (FbxRig.current && FbxRig.actions[FbxRig.current] && FbxRig.current !== clipId) {
      FbxRig.actions[FbxRig.current].crossFadeTo(action, 0.25, false);
    }
    FbxRig.actions[clipId] = action;
    FbxRig.current = clipId;
    bus.emit('fbx:clip-played', { clip: clipId });
  };

  FbxRig.update = function (dt) {
    if (FbxRig.mixer && FbxRig.loaded) FbxRig.mixer.update(dt);
  };

  /* ============================================================
     PREVIEW — thêm fbxRoot vào viewport
     ============================================================ */
  FbxRig._hiddenPreview = [];

  FbxRig.addToViewport = function () {
    if (!FbxRig.fbxRoot || !PixiStudio.Viewport.modelRoot) return;
    /* Chỉ hiển thị model đang được preview. Trước đây FBX được thêm cạnh
       kiemhiep.glb ở cùng tọa độ, nên camera vẫn thấy nhân vật tĩnh chồng lên
       nhân vật đang chạy. */
    FbxRig._hiddenPreview = [];
    PixiStudio.Viewport.modelRoot.children.forEach(function (child) {
      if (child !== FbxRig.fbxRoot && child.visible) {
        FbxRig._hiddenPreview.push(child);
        child.visible = false;
      }
    });
    /* DEDUPE: remove existing before re-add */
    if (FbxRig.fbxRoot.parent) FbxRig.fbxRoot.parent.remove(FbxRig.fbxRoot);
    PixiStudio.Viewport.modelRoot.add(FbxRig.fbxRoot);
    /* normalize */
    const box = new THREE.Box3().setFromObject(FbxRig.fbxRoot);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const scale = 2.0 / Math.max(0.001, size.y);
      FbxRig.fbxRoot.scale.setScalar(scale);
      FbxRig.fbxRoot.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(FbxRig.fbxRoot);
      const c2 = box2.getCenter(new THREE.Vector3());
      FbxRig.fbxRoot.position.x -= c2.x;
      FbxRig.fbxRoot.position.z -= c2.z;
      FbxRig.fbxRoot.position.y -= box2.min.y;
    }
    PixiStudio.State.select(FbxRig.fbxRoot);
    if (PixiStudio.Viewport.orbit) {
      PixiStudio.Viewport.orbit.focus(FbxRig.fbxRoot, true);
      PixiStudio.Viewport.setView('perspective');
    }
  };

  FbxRig.removeFromViewport = function () {
    if (FbxRig.fbxRoot && FbxRig.fbxRoot.parent) FbxRig.fbxRoot.parent.remove(FbxRig.fbxRoot);
    (FbxRig._hiddenPreview || []).forEach(function (child) { child.visible = true; });
    FbxRig._hiddenPreview = [];
  };

  /* ============================================================
     EXPORT CLIPS JSON — dùng lại cho các model khác
     ============================================================ */
  FbxRig.exportClipsJSON = function () {
    const data = FbxRig.generated.map(function (c) {
      return {
        id: c.id, name: c.name, duration: c.clip.duration, loop: c.loop, source: c.source,
        tracks: c.clip.tracks.map(function (t) {
          return { name: t.name, times: Array.from(t.times).map(function (x) { return Math.round(x * 1000) / 1000; }), values: Array.from(t.values).map(function (x) { return Math.round(x * 10000) / 10000; }) };
        })
      };
    });
    U.downloadText(JSON.stringify({ format: 'pixistudio-rig-clips-1', skeleton: FbxRig.skeleton, clips: data }, null, 1), 'meshy_rig_clips.json', 'application/json');
    bus.emit('notify', { type: 'success', title: 'Rig clips exported', message: 'meshy_rig_clips.json — Idle/Attack/Running data' });
  };

  /* ============================================================
     AUTO-DETECT + AUTO-LOAD file FBX Meshy trong assets/models
     ============================================================ */
  FbxRig.autoLoad = function () {
    return fetch('/api/fbx-list').then(function (r) { return r.json(); }).then(function (list) {
      if (!list.ok || !list.files || !list.files.length) return null;
      /* ưu tiên animated (Running) */
      const anim = list.files.find(function (f) { return /animated/i.test(f.name); });
      const chosen = anim || list.files[0];
      return FbxRig.loadFromUrl(chosen.url).then(function (result) {
        FbxRig.fileName = chosen.name;
        return result;
      });
    }).catch(function () { return null; });
  };

  /* ============================================================
     UI — section trong Animation panel
     ============================================================ */
  FbxRig.renderPanel = function () {
    const body = document.getElementById('animation-page-body');
    if (!body || document.getElementById('fbx-rig-section')) return;

    const section = U.el('div', { class: 'section-block', id: 'fbx-rig-section' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('animation') }),
        U.el('span', { text: '🎞 Meshy FBX Rig — Running → Idle/Attack' })
      ])
    ]);
    const sc = U.el('div', { class: 'section-content' });

    if (!FbxRig.loaded) {
      sc.appendChild(U.el('button', {
        class: 'btn primary lg block',
        style: 'margin-bottom:8px;',
        html: U.icon('import') + '&nbsp; Load FBX Meshy (auto-detect)',
        onclick: function () {
          PixiStudio.Notifications.showLoading('Đang parse FBX Mixamo…', 30);
          FbxRig.autoLoad().then(function (result) {
            PixiStudio.Notifications.hideLoading();
            if (result) FbxRig.renderPanel();
            else PixiStudio.Notifications.hideLoading();
          }).catch(function (e) {
            PixiStudio.Notifications.hideLoading();
            bus.emit('notify', { type: 'error', title: 'FBX load fail', message: e.message });
          });
        }
      }));
      sc.appendChild(U.el('div', { class: 'dim small', style: 'line-height:1.5;', text: 'Auto-detect file FBX trong assets/models (Meshy_AI_…Running.fbx). Cần fflate + FBXLoader (CDN).' }));
      section.appendChild(sc);
      body.insertBefore(section, body.firstChild);
      return;
    }

    /* Loaded state */
    sc.appendChild(U.el('div', { class: 'info-row' }, [
      U.el('span', { class: 'i-label', text: 'File' }),
      U.el('span', { class: 'i-value', text: FbxRig.fileName.slice(0, 28) })
    ]));
    sc.appendChild(U.el('div', { class: 'info-row' }, [
      U.el('span', { class: 'i-label', text: 'Skeleton' }),
      U.el('span', { class: 'i-value', text: FbxRig.skeleton.boneCount + ' bones Mixamo' })
    ]));
    sc.appendChild(U.el('div', { class: 'info-row', style: 'margin-bottom:8px;' }, [
      U.el('span', { class: 'i-label', text: 'Running clip' }),
      U.el('span', { class: 'i-value', text: FbxRig.runningClip ? FbxRig.runningClip.duration.toFixed(1) + 's' : '—' })
    ]));

    /* Play buttons */
    const grid = U.el('div', { class: 'mt-grid', style: 'grid-template-columns:repeat(3,1fr);gap:5px;' });
    FbxRig.generated.forEach(function (c) {
      grid.appendChild(U.el('button', {
        class: 'mt-btn' + (FbxRig.current === c.id ? ' primary' : ''),
        html: U.icon(c.id === 'Attack' ? 'swords' : 'character') + '<span>' + c.id + '</span>',
        onclick: function () { FbxRig.play(c.id); FbxRig.renderPanel(); }
      }));
    });
    sc.appendChild(grid);

    /* viewport actions */
    const row = U.el('div', { style: 'display:flex;gap:6px;margin-top:8px;' }, [
      U.el('button', { class: 'btn sm grow', html: U.icon('eye') + ' Preview', onclick: function () { FbxRig.addToViewport(); } }),
      U.el('button', { class: 'btn sm grow', html: U.icon('export') + ' Clips JSON', onclick: function () { FbxRig.exportClipsJSON(); } }),
      U.el('button', { class: 'btn sm ghost', html: U.icon('x') + ' Remove', onclick: function () { FbxRig.removeFromViewport(); cleanToasts(); } })
    ]);
    sc.appendChild(row);
    function cleanToasts() { document.querySelectorAll('.toast').forEach(function (t) { t.remove(); }); }

    sc.appendChild(U.el('div', { class: 'dim small', style: 'margin-top:8px;line-height:1.5;', text: 'Idle & Attack sinh procedural từ data Running thật (rest + deviation analysis). Clips JSON export dùng lại cho model khác qua bone-name retarget.' }));

    section.appendChild(sc);
    body.insertBefore(section, body.firstChild);
  };

  window.PixiStudio.FbxRig = FbxRig;
})();
