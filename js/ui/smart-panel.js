/* ============================================================
 * ui/smart-panel.js — Smart Studio Panel (v21.0)
 *
 * Một panel duy nhất gom 8 tính năng thông minh mới vào tab
 * Animation: Export Presets, IK, Blend, Pose, Character Controller,
 * Turntable, LOD, Scene Director. Gọi từ toolbar (animation page).
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;

  const SmartPanel = {};

  function el(id) { return document.getElementById(id); }
  function rigClips() {
    const r = PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
    return (r && r.clips) ? r.clips.map(function (c) { return c.id; }) : [];
  }
  function clipOptions(selected) {
    const ids = rigClips();
    if (!ids.length) return '<option value="">(chưa có rig — bấm Auto Rig Gen)</option>';
    return ids.map(function (id) {
      return '<option value="' + id + '"' + (id === selected ? ' selected' : '') + '>' + id + '</option>';
    }).join('');
  }
  function notify(type, title, msg) {
    bus.emit('notify', { type: type, title: title, message: msg });
  }

  SmartPanel.render = function () {
    const host = el('animation-page-body');
    if (!host) return;
    const old = el('smart-studio-section');
    if (old) old.remove();

    const sec = document.createElement('div');
    sec.id = 'smart-studio-section';
    sec.className = 'panel-section';
    sec.innerHTML =
      '<h3>🧠 Smart Studio — v21.0</h3>' +
      '<p class="muted">8 tính năng thông minh, chạy local không cần key.</p>' +

      '<h4>📦 Export Presets — xuất đúng chuẩn engine</h4>' +
      '<div class="row"><select id="sp-preset">' +
      '<option value="mixamo">Mixamo — FBX 2013, Y-up</option>' +
      '<option value="unity">Unity — FBX 2014+, Y-up, mét</option>' +
      '<option value="unreal">Unreal — FBX 2014+, Z-up, cm</option>' +
      '<option value="godot">Godot — GLB, Y-up, mét</option>' +
      '<option value="roblox">Roblox — FBX 2013, Y-up</option>' +
      '</select><button id="sp-preset-apply" class="btn">Áp dụng</button></div>' +
      '<div id="sp-preset-note" class="muted"></div>' +

      '<h4>🎯 IK Solver — tay/chân chạm đúng điểm</h4>' +
      '<div class="row"><select id="sp-ik-limb">' +
      '<option value="LeftArm">Tay trái</option><option value="RightArm">Tay phải</option>' +
      '<option value="LeftLeg">Chân trái</option><option value="RightLeg">Chân phải</option>' +
      '</select>' +
      '<input id="sp-ik-x" type="number" step="0.1" value="0.3" placeholder="X" style="width:64px">' +
      '<input id="sp-ik-y" type="number" step="0.1" value="1.2" placeholder="Y" style="width:64px">' +
      '<input id="sp-ik-z" type="number" step="0.1" value="0.2" placeholder="Z" style="width:64px">' +
      '<button id="sp-ik-solve" class="btn">Giải IK</button></div>' +
      '<div class="row"><button id="sp-ik-hold" class="btn">Giữ IK mỗi frame</button>' +
      '<button id="sp-ik-clear" class="btn">Xóa target giữ</button>' +
      '<button id="sp-ik-plant" class="btn">🦶 Foot Plant (chân chạm đất)</button></div>' +

      '<h4>🎬 Animation Blender — trộn clip</h4>' +
      '<div class="row"><select id="sp-blend-from">' + clipOptions('Walk') + '</select> → ' +
      '<select id="sp-blend-to">' + clipOptions('Run') + '</select>' +
      '<input id="sp-blend-dur" type="number" step="0.1" value="0.5" style="width:56px">s ' +
      '<button id="sp-blend-go" class="btn">Blend</button></div>' +
      '<div class="row"><select id="sp-mask-base">' + clipOptions('Walk') + '</select> + ' +
      '<select id="sp-mask-over">' + clipOptions('Attack') + '</select>' +
      '<select id="sp-mask-part"><option value="upper">Thân trên</option><option value="lower">Thân dưới</option></select>' +
      '<button id="sp-mask-go" class="btn">Mask Blend</button></div>' +
      '<div class="row"><select id="sp-add-base">' + clipOptions('Run') + '</select> + ' +
      '<select id="sp-add-over">' + clipOptions('Punch') + '</select>' +
      '<button id="sp-add-go" class="btn">Additive</button>' +
      '<button id="sp-add-stop" class="btn">Dừng overlay</button></div>' +

      '<h4>🧍 Pose Library — lưu / khôi phục tư thế</h4>' +
      '<div class="row"><input id="sp-pose-name" placeholder="Tên pose…" style="width:140px">' +
      '<button id="sp-pose-save" class="btn">💾 Lưu pose hiện tại</button></div>' +
      '<div class="row"><button class="btn sp-pose-builtin" data-pose="T-Pose">T-Pose</button>' +
      '<button class="btn sp-pose-builtin" data-pose="A-Pose">A-Pose</button>' +
      '<button class="btn sp-pose-builtin" data-pose="Crouch">Crouch</button></div>' +
      '<div id="sp-pose-list" class="muted"></div>' +

      '<h4>🕹️ Character Controller — đi thử bằng WASD</h4>' +
      '<div class="row"><label><input type="checkbox" id="sp-cc-enable"> Bật điều khiển (WASD / ←↑→↓, Shift chạy, Space nhảy)</label></div>' +

      '<h4>🔄 Turntable — xoay 360° chụp từng góc</h4>' +
      '<div class="row"><input id="sp-tt-steps" type="number" value="24" min="4" max="72" style="width:56px"> khung hình ' +
      '<button id="sp-tt-start" class="btn">▶ Bắt đầu</button>' +
      '<button id="sp-tt-stop" class="btn">■ Dừng</button><span id="sp-tt-progress" class="muted"></span></div>' +

      '<h4>📉 Auto-LOD — giảm đa giác local</h4>' +
      '<div class="row"><button id="sp-lod-gen" class="btn">Sinh LOD 0/1/2</button>' +
      '<select id="sp-lod-apply"><option value="0">LOD0 — gốc</option><option value="1">LOD1 — ~50%</option><option value="2">LOD2 — ~25%</option></select>' +
      '<button id="sp-lod-restore" class="btn">Khôi phục gốc</button></div>' +
      '<div id="sp-lod-report" class="muted"></div>' +

      '<h4>🎥 Scene Director — dựng sân khấu 1 click</h4>' +
      '<div class="row"><select id="sp-stage-mode"><option value="row">Hàng ngang</option><option value="circle">Vòng tròn</option><option value="grid">Lưới</option></select>' +
      '<button id="sp-stage-go" class="btn">🎬 Dựng sân khấu</button>' +
      '<button id="sp-stage-snap" class="btn">Snap mặt đất</button></div>';

    host.appendChild(sec);
    SmartPanel._bind();
    SmartPanel._refreshPoseList();
    SmartPanel._refreshPresetNote();
  };

  SmartPanel._refreshPresetNote = function () {
    const P = PixiStudio.ExportPresets;
    const note = el('sp-preset-note');
    if (!P || !note) return;
    const sel = el('sp-preset');
    if (sel) sel.value = P.current;
    const p = P.get(P.current);
    if (p) note.textContent = p.note;
  };

  SmartPanel._refreshPoseList = function () {
    const PL = PixiStudio.PoseLibrary;
    const host = el('sp-pose-list');
    if (!PL || !host) return;
    const names = PL.list();
    host.innerHTML = names.length ? names.map(function (n) {
      return '<span class="chip">' + n +
        ' <button data-apply="' + n + '">Áp</button>' +
        ' <button data-del="' + n + '">✕</button></span>';
    }).join(' ') : 'Chưa lưu pose nào.';
    host.querySelectorAll('[data-apply]').forEach(function (b) {
      b.onclick = function () { PL.applySaved(b.getAttribute('data-apply')); };
    });
    host.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { PL.delete(b.getAttribute('data-del')); SmartPanel._refreshPoseList(); };
    });
  };

  function currentTarget() {
    const R = PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
    return R ? R.target : null;
  }
  function firstMesh(root) {
    let found = null;
    if (root && root.traverse) root.traverse(function (o) { if (!found && o.isMesh) found = o; });
    return found;
  }

  SmartPanel._bind = function () {
    const q = function (id) { return el(id); };

    // Export presets
    if (q('sp-preset-apply')) q('sp-preset-apply').onclick = function () {
      const P = PixiStudio.ExportPresets;
      if (!P) return;
      const id = q('sp-preset').value;
      P.setCurrent(id);
      if (PixiStudio.SaveManager && PixiStudio.SaveManager.setExportPreset) PixiStudio.SaveManager.setExportPreset(id);
      SmartPanel._refreshPresetNote();
      notify('success', 'Export Preset', 'Đã chọn preset ' + (P.get(id) || {}).name + ' cho lần xuất FBX/GLB tiếp theo.');
    };
    if (q('sp-preset')) q('sp-preset').onchange = SmartPanel._refreshPresetNote;

    // IK
    if (q('sp-ik-solve')) q('sp-ik-solve').onclick = function () {
      const IK = PixiStudio.IKSolver;
      if (!IK) return;
      const limb = q('sp-ik-limb').value;
      const res = IK.solveLimb(null, limb,
        { x: +q('sp-ik-x').value, y: +q('sp-ik-y').value, z: +q('sp-ik-z').value });
      notify(res.ok ? (res.reached ? 'success' : 'warning') : 'error', 'IK Solver',
        res.ok ? (limb + ' → target, lệch ' + (res.distance * 100).toFixed(1) + 'cm' + (res.reached ? '' : ' (ngoài tầm với, đã duỗi hết cỡ)')) : 'Không tìm thấy chuỗi xương ' + limb + ' — cần rig trước.');
    };
    if (q('sp-ik-hold')) q('sp-ik-hold').onclick = function () {
      const IK = PixiStudio.IKSolver;
      if (!IK) return;
      IK.setTarget(q('sp-ik-limb').value, +q('sp-ik-x').value, +q('sp-ik-y').value, +q('sp-ik-z').value);
      notify('success', 'IK Solver', 'Đã giữ target mỗi frame — tay/chân sẽ theo điểm này khi animation chạy.');
    };
    if (q('sp-ik-clear')) q('sp-ik-clear').onclick = function () {
      if (PixiStudio.IKSolver) PixiStudio.IKSolver.clearTarget();
      notify('success', 'IK Solver', 'Đã xóa target giữ.');
    };
    if (q('sp-ik-plant')) q('sp-ik-plant').onclick = function () {
      const IK = PixiStudio.IKSolver;
      if (!IK) return;
      const res = IK.plantFeet();
      notify(res.ok ? 'success' : 'error', 'Foot Plant',
        res.ok ? ('Chân đã chạm đất' + (res.lifted > 0 ? ' (nâng model ' + (res.lifted * 100).toFixed(1) + 'cm)' : '')) : 'Cần rig trước.');
    };

    // Blend
    if (q('sp-blend-go')) q('sp-blend-go').onclick = function () {
      const B = PixiStudio.AnimBlender;
      if (!B) return;
      const ok = B.blend(q('sp-blend-from').value, q('sp-blend-to').value, +q('sp-blend-dur').value);
      if (!ok) notify('warning', 'Animation Blender', 'Cần rig có đủ 2 clip.');
    };
    if (q('sp-mask-go')) q('sp-mask-go').onclick = function () {
      const B = PixiStudio.AnimBlender;
      if (!B) return;
      const ok = B.maskBlend(q('sp-mask-base').value, q('sp-mask-over').value, q('sp-mask-part').value, 1);
      if (!ok) notify('warning', 'Animation Blender', 'Mask Blend cần rig + 2 clip (overlay phải có track nhóm xương đó).');
    };
    if (q('sp-add-go')) q('sp-add-go').onclick = function () {
      const B = PixiStudio.AnimBlender;
      if (!B) return;
      const ok = B.additive(q('sp-add-base').value, q('sp-add-over').value, 0.7);
      if (!ok) notify('warning', 'Animation Blender', 'Additive cần rig + 2 clip.');
    };
    if (q('sp-add-stop')) q('sp-add-stop').onclick = function () {
      if (PixiStudio.AnimBlender) PixiStudio.AnimBlender.stopOverlays();
    };

    // Pose
    if (q('sp-pose-save')) q('sp-pose-save').onclick = function () {
      const PL = PixiStudio.PoseLibrary;
      if (!PL) return;
      const name = (q('sp-pose-name').value || '').trim() || ('Pose ' + new Date().toLocaleTimeString('vi-VN'));
      if (PL.save(name)) { SmartPanel._refreshPoseList(); notify('success', 'Pose Library', 'Đã lưu pose "' + name + '".'); }
      else notify('error', 'Pose Library', 'Chưa có rig để lưu pose.');
    };
    document.querySelectorAll('.sp-pose-builtin').forEach(function (b) {
      b.onclick = function () {
        const PL = PixiStudio.PoseLibrary;
        if (PL && PL.applyBuiltin(b.getAttribute('data-pose'))) notify('success', 'Pose Library', 'Đã áp ' + b.getAttribute('data-pose') + '.');
        else notify('warning', 'Pose Library', 'Cần rig trước.');
      };
    });

    // Character controller
    if (q('sp-cc-enable')) q('sp-cc-enable').onchange = function () {
      const CC = PixiStudio.CharacterController;
      if (!CC) return;
      const on = q('sp-cc-enable').checked;
      if (on) {
        if (!CC.attach()) { q('sp-cc-enable').checked = false; notify('warning', 'Character Controller', 'Cần rig trước.'); return; }
      }
      CC.setEnabled(on);
      notify('success', 'Character Controller', on ? 'Đã bật — bấm vào viewport rồi dùng WASD để đi, Shift chạy, Space nhảy.' : 'Đã tắt.');
    };

    // Turntable
    if (q('sp-tt-start')) q('sp-tt-start').onclick = function () {
      const TT = PixiStudio.Turntable;
      if (!TT) return;
      const ok = TT.start(currentTarget(), { steps: +q('sp-tt-steps').value || 24 });
      if (ok) notify('success', 'Turntable', 'Đang xoay chụp ' + TT.steps + ' khung hình…');
    };
    if (q('sp-tt-stop')) q('sp-tt-stop').onclick = function () {
      if (PixiStudio.Turntable) PixiStudio.Turntable.stop();
    };
    bus.on('turntable:frame', function (d) {
      const p = el('sp-tt-progress');
      if (p) p.textContent = ' ' + d.index + '/' + d.total + ' (' + d.angle.toFixed(0) + '°)';
    });
    bus.on('turntable:stopped', function (d) {
      const p = el('sp-tt-progress');
      if (p) p.textContent = ' Xong: ' + d.frames + ' khung hình đã chụp.';
    });

    // LOD
    if (q('sp-lod-gen')) q('sp-lod-gen').onclick = function () {
      const LOD = PixiStudio.LODGenerator;
      const mesh = firstMesh(currentTarget());
      if (!LOD || !mesh) { notify('warning', 'Auto-LOD', 'Cần model có mesh.'); return; }
      const levels = LOD.generateLODs(mesh);
      mesh.userData.__smartLevels = levels;
      const rep = LOD.report(mesh, levels);
      const r = q('sp-lod-report');
      if (r && rep) r.textContent = 'LOD0 ' + rep.levels[0].tris + ' tris → LOD1 ' + rep.levels[1].tris + ' → LOD2 ' + rep.levels[2].tris + ' tris.';
      notify('success', 'Auto-LOD', 'Đã sinh 3 mức LOD.');
    };
    if (q('sp-lod-apply')) q('sp-lod-apply').onchange = function () {
      const LOD = PixiStudio.LODGenerator;
      const mesh = firstMesh(currentTarget());
      if (!LOD || !mesh || !mesh.userData.__smartLevels) return;
      LOD.applyLOD(mesh, +q('sp-lod-apply').value, mesh.userData.__smartLevels);
    };
    if (q('sp-lod-restore')) q('sp-lod-restore').onclick = function () {
      const LOD = PixiStudio.LODGenerator;
      const mesh = firstMesh(currentTarget());
      if (LOD && mesh) LOD.restoreLOD(mesh);
    };

    // Scene director
    if (q('sp-stage-go')) q('sp-stage-go').onclick = function () {
      const SD = PixiStudio.SceneDirector;
      if (!SD) return;
      const objs = [];
      if (PixiStudio.Scene && PixiStudio.Scene.registry) {
        for (const uuid in PixiStudio.Scene.registry) {
          const o = PixiStudio.Scene.registry[uuid] && PixiStudio.Scene.registry[uuid].object3D;
          if (o) objs.push(o);
        }
      }
      if (!objs.length && currentTarget()) objs.push(currentTarget());
      const orbit = PixiStudio.Viewport && PixiStudio.Viewport.orbit;
      const cam = orbit || (PixiStudio.Viewport && PixiStudio.Viewport.orbit && PixiStudio.Viewport.orbit.camera);
      const res = SD.stage(objs, orbit || cam, q('sp-stage-mode').value);
      if (res) notify('success', 'Scene Director', 'Đã dựng sân khấu: ' + res.count + ' model, camera đã frame vừa khung.');
      else notify('warning', 'Scene Director', 'Chưa có model nào trong scene.');
    };
    if (q('sp-stage-snap')) q('sp-stage-snap').onclick = function () {
      const SD = PixiStudio.SceneDirector;
      const t = currentTarget();
      if (SD && t) {
        const dy = SD.groundSnap(t);
        notify('success', 'Scene Director', 'Đã snap mặt đất (dịch ' + (dy * 100).toFixed(1) + 'cm).');
      }
    };
  };

  window.PixiStudio.SmartPanel = SmartPanel;
})();
