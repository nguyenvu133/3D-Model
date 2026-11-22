/* ============================================================
 * rigging/rig-manager.js — Auto Rig từ bounding box thật,
 * visual skeleton (joint + bone octahedron), bone picking,
 * UI panel Rigging Studio.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const Rig = {
    current: null,        // { name, bones, target, visualGroup }
    selectedBone: null,
    visible: false
  };

  /* ---------- AUTO RIG ---------- */
  Rig.autoRig = function (targetObject) {
    const target = targetObject || PixiStudio.Viewport.getMainModel();
    if (!target) {
      bus.emit('notify', { type: 'warning', title: 'Auto Rig', message: 'Chưa có model nào để rig. Load model trước.' });
      return;
    }

    const presetName = Rig.presetName || 'Mixamo Compatible';
    const skeleton = PixiStudio.Skeleton.buildFromPreset(presetName);
    if (!skeleton) return;

    /* Tính bbox thật để scale skeleton theo model */
    const box = new THREE.Box3().setFromObject(target);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    Object.keys(skeleton.bones).forEach(function (name) {
      const bone = skeleton.bones[name];
      const p = bone.position;
      bone.worldPos = new THREE.Vector3(
        center.x + p[0] * size.x * 1.15,
        box.min.y + p[1] * size.y * 1.02,
        center.z + p[2] * size.z * 1.15
      );
    });

    /* Xoá visual cũ nếu có */
    if (Rig.current && Rig.current.visualGroup) {
      target.remove(Rig.current.visualGroup);
    }

    const visual = Rig._buildVisual(skeleton, target);
    Rig.current = {
      name: presetName,
      bones: skeleton.bones,
      target: target,
      visualGroup: visual,
      preset: presetName
    };

    target.add(visual);
    visual.visible = Rig.visible;
    Rig.visible = true;
    visual.visible = true;

    bus.emit('rig:created', { boneCount: Object.keys(skeleton.bones).length, preset: presetName });
    bus.emit('notify', {
      type: 'success', title: 'Auto Rig hoàn tất',
      message: Object.keys(skeleton.bones).length + ' bones (' + presetName + ') khớp tỷ lệ ' + target.name + '. Bật toggle Bone View để xem.'
    });

    /* Render lại panel rig nếu đang mở */
    Rig.renderPanel();
  };

  Rig._buildVisual = function (skeleton, target) {
    const group = new THREE.Group();
    group.name = '__skeleton_visual__';

    const jointMat = new THREE.MeshBasicMaterial({ color: 0x27bfff });
    const jointSelMat = new THREE.MeshBasicMaterial({ color: 0xffc928 });
    const boneMat = new THREE.MeshBasicMaterial({ color: 0x713bff, transparent: true, opacity: 0.85 });

    Object.keys(skeleton.bones).forEach(function (boneName1) {
      const bone = skeleton.bones[boneName1];
      /* Joint sphere */
      const joint = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), jointMat.clone());
      joint.position.copy(bone.worldPos);
      joint.name = 'joint:' + bone.name;
      joint.userData.boneName = bone.name;
      bone.object3D = joint;
      group.add(joint);

      /* Bone octahedron nối parent → child */
      if (bone.parentName && skeleton.bones[bone.parentName]) {
        const parent = skeleton.bones[bone.parentName];
        const dir = bone.worldPos.clone().sub(parent.worldPos);
        const len = dir.length();
        if (len > 0.001) {
          const boneMesh = new THREE.Mesh(new THREE.OctahedronGeometry(1), boneMat.clone());
          /* Octahedron kéo dài theo Y */
          boneMesh.scale.set(0.035, len / 2, 0.035);
          boneMesh.position.copy(parent.worldPos).add(dir.multiplyScalar(0.5));
          boneMesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            bone.worldPos.clone().sub(parent.worldPos).normalize()
          );
          boneMesh.name = 'bone:' + bone.name;
          group.add(boneMesh);
        }
      }
    });

    group.traverse(function (o) {
      if (o.isMesh) {
        o.userData.pickBone = true;
        o.renderOrder = 999;
        o.material.depthTest = false;
      }
    });

    return group;
  };

  /* ---------- Bone selection ---------- */
  Rig.selectBone = function (boneName) {
    if (!Rig.current) return;
    Rig.selectedBone = boneName;
    /* highlight joints */
    Rig.current.visualGroup.traverse(function (o) {
      if (o.isMesh && o.userData.boneName) {
        o.material.color.setHex(o.userData.boneName === boneName ? 0xffc928 : 0x27bfff);
      }
    });
    PixiStudio.State.set('selectionName', boneName, true);
    bus.emit('bone:selected', { bone: boneName });
    if (PixiStudio.BoneEditor) PixiStudio.BoneEditor.renderBoneList();
  };

  /* ---------- Toggle visibility ---------- */
  Rig.toggleVisibility = function (on) {
    Rig.visible = on === undefined ? !Rig.visible : !!on;
    if (Rig.current && Rig.current.visualGroup) {
      Rig.current.visualGroup.visible = Rig.visible;
    }
    return Rig.visible;
  };

  /* ---------- Bone click picking (raycast joints) ---------- */
  Rig.pickBoneAt = function (ndcX, ndcY, camera) {
    if (!Rig.current || !Rig.current.visualGroup || !Rig.current.visualGroup.visible) return null;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    const hits = raycaster.intersectObjects(Rig.current.visualGroup.children, true);
    for (let i = 0; i < hits.length; i++) {
      if (hits[i].object.userData.boneName) return hits[i].object.userData.boneName;
    }
    return null;
  };

  /* ---------- Preset list ---------- */
  Rig.PRESET_NAMES = Object.keys(PixiStudio.Skeleton.PRESETS);

  Rig.setPreset = function (name) {
    Rig.presetName = name;
    if (Rig.current && Rig.current.target) Rig.autoRig(Rig.current.target);
  };

  /* ============================================================
     UI PANEL (page-rig)
     ============================================================ */
  Rig.renderPanel = function () {
    const body = U.$('#rig-page-body');
    if (!body) return;
    body.innerHTML = '';

    /* Rigging Type / Preset select */
    const presetRow = U.el('div', { class: 'form-row', style: 'margin:12px 0 10px;' });
    presetRow.appendChild(U.el('label', { class: 'label-xs', text: 'Skeleton Preset' }));
    const selectWrap = U.el('div', { class: 'select-wrap' });
    const select = U.el('select', { class: 'select', id: 'rig-preset-select' });
    Rig.PRESET_NAMES.forEach(function (n) {
      const opt = U.el('option', { value: n, text: n });
      if (n === (Rig.current && Rig.current.preset || 'Mixamo Compatible')) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', function () { Rig.setPreset(select.value); });
    selectWrap.appendChild(select);
    presetRow.appendChild(selectWrap);
    body.appendChild(presetRow);

    /* Big AUTO RIG button */
    const autoBtn = U.el('button', {
      class: 'btn primary lg block',
      style: 'margin-bottom:12px;',
      html: U.icon('wand') + '&nbsp; ⚡ AUTO RIG (từ bounding box)',
      onclick: function () { Rig.autoRig(null); }
    });
    body.appendChild(autoBtn);

    /* Current rig info */
    if (Rig.current) {
      const info = U.el('div', { class: 'section-block' });
      const head = U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('rig') }),
        U.el('span', { text: 'Current Rig — ' + Rig.current.preset })
      ]);
      const content = U.el('div', { class: 'section-content' });
      const rows = [
        ['Bones', String(Object.keys(Rig.current.bones).length)],
        ['Target', Rig.current.target.name || 'model'],
        ['Visual', Rig.visible ? 'Visible' : 'Hidden']
      ];
      rows.forEach(function (r) {
        content.appendChild(U.el('div', { class: 'info-row' }, [
          U.el('span', { class: 'i-label', text: r[0] }),
          U.el('span', { class: 'i-value', text: r[1] })
        ]));
      });
      info.appendChild(head);
      info.appendChild(content);
      body.appendChild(info);
    }

    /* Rig tools grid */
    const tools = [
      { id: 'autoPlace', name: 'Auto Bone Placement', icon: 'wand', ok: true, run: function () { Rig.autoRig(null); } },
      { id: 'manualPlace', name: 'Manual Placement', icon: 'cursor', ok: false, hint: 'cần bone-drag tool' },
      { id: 'mirror', name: 'Mirror Bones', icon: 'eye', ok: true, run: function () { PixiStudio.BoneEditor.mirror(); } },
      { id: 'weightPaint', name: 'Weight Painting', icon: 'uv', ok: false, hint: 'cần skin binding' },
      { id: 'skinBind', name: 'Skin Binding', icon: 'link', ok: false, hint: 'cần SkinnedMesh' },
      { id: 'ikfk', name: 'IK / FK', icon: 'target', ok: false, hint: 'v5.1' },
      { id: 'constraints', name: 'Joint Constraints', icon: 'link', ok: false, hint: 'v5.1' },
      { id: 'rename', name: 'Bone Rename', icon: 'edit', ok: true, run: function () { PixiStudio.BoneEditor.showRenameDialog(); } },
      { id: 'hierarchy', name: 'Bone Hierarchy', icon: 'scene', ok: true, run: function () { PixiStudio.UI.panels.showLeftPage('rig'); PixiStudio.BoneEditor.renderBoneList(); } }
    ];
    const grid = U.el('div', { class: 'mt-grid', style: 'grid-template-columns:repeat(3,1fr);' });
    tools.forEach(function (t) {
      const btn = U.el('button', {
        class: 'mt-btn' + (t.ok ? ' primary' : ''),
        html: U.icon(t.icon) + '<span>' + t.name + '</span>',
        'data-tooltip': t.ok ? '' : (t.hint + ' — trạng thái trung thực'),
        onclick: function () {
          if (t.ok) { t.run(); }
          else {
            bus.emit('notify', {
              type: 'warning', title: t.name,
              message: 'Tính năng này cần backend/tool riêng (' + t.hint + '). Không giả lập kết quả.',
              duration: 5000
            });
          }
        }
      });
      grid.appendChild(btn);
    });
    body.appendChild(U.el('div', { class: 'page-block' }, [
      U.el('h4', { text: 'Rig Tools' }),
      grid
    ]));

    /* Bone editor list */
    const boneSection = U.el('div', { class: 'section-block' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('rig') }),
        U.el('span', { text: 'Bone Editor' })
      ])
    ]);
    const boneListWrap = U.el('div', { class: 'section-content', id: 'bone-list-wrap' });
    if (PixiStudio.BoneEditor) PixiStudio.BoneEditor.renderBoneList(boneListWrap);
    boneSection.appendChild(boneListWrap);
    body.appendChild(boneSection);
  };

  window.PixiStudio.Rig = Rig;
})();
