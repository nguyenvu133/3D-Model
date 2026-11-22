/* ============================================================
 * rigging/bone-editor.js — Bone list UI, rename, mirror (L↔R)
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const BoneEditor = { container: null, filter: '' };

  BoneEditor.renderBoneList = function (container) {
    const wrap = container || document.getElementById('bone-list-wrap') || BoneEditor.container;
    if (!wrap) return;
    BoneEditor.container = wrap;
    wrap.innerHTML = '';

    const rig = PixiStudio.Rig.current;
    if (!rig) {
      wrap.appendChild(U.el('div', { class: 'empty-state' }, [
        U.el('div', { class: 'es-icon', text: '🦴' }),
        U.el('b', { text: 'Chưa có skeleton' }),
        U.el('span', { text: 'Nhấn Auto Rig để sinh bộ xương từ bounding box model.' })
      ]));
      return;
    }

    /* Search filter */
    const search = U.el('input', {
      class: 'input',
      placeholder: 'Tìm bone…',
      style: 'margin-bottom:8px;',
      oninput: U.debounce(function () {
        BoneEditor.filter = search.value.toLowerCase();
        BoneEditor.renderBoneList(wrap);
      }, 150)
    });
    wrap.appendChild(search);

    /* Hierarchy tree */
    const roots = Object.keys(rig.bones).filter(function (n) { return !rig.bones[n].parentName; });
    const buildNode = function (boneName) {
      const bone = rig.bones[boneName];
      if (BoneEditor.filter && boneName.toLowerCase().indexOf(BoneEditor.filter) === -1) {
        /* vẫn hiện nếu có con khớp */
        const childMatch = bone.children.some(function (c) { return c.name.toLowerCase().indexOf(BoneEditor.filter) !== -1; });
        if (!childMatch) return null;
      }
      const row = U.el('div', {
        class: 'tree-row' + (PixiStudio.Rig.selectedBone === boneName ? ' selected' : ''),
        style: 'padding:4px 8px;',
        onclick: function () { PixiStudio.Rig.selectBone(boneName); }
      }, [
        U.el('span', { class: 't-icon', html: U.icon('bone', 'ic-sm') }),
        U.el('span', { class: 't-name', text: boneName })
      ]);
      const node = U.el('div', {}, [row]);
      if (bone.children.length) {
        const kids = U.el('div', { class: 'tree-children' });
        bone.children.forEach(function (c) {
          const n = buildNode(c.name);
          if (n) kids.appendChild(n);
        });
        node.appendChild(kids);
      }
      return node;
    };

    roots.forEach(function (rootName) {
      const node = buildNode(rootName);
      if (node) wrap.appendChild(node);
    });

    /* Actions row */
    const actions = U.el('div', { style: 'display:flex;gap:6px;margin-top:10px;' }, [
      U.el('button', {
        class: 'btn sm grow', html: U.icon('edit') + ' Rename',
        onclick: function () { BoneEditor.showRenameDialog(); }
      }),
      U.el('button', {
        class: 'btn sm grow', html: U.icon('eye') + ' Mirror',
        onclick: function () { BoneEditor.mirror(); }
      }),
      U.el('button', {
        class: 'btn sm ghost', html: U.icon('eye'),
        'data-tooltip': 'Toggle skeleton visual',
        onclick: function () { PixiStudio.Rig.toggleVisibility(); }
      })
    ]);
    wrap.appendChild(actions);
  };

  BoneEditor.showRenameDialog = function () {
    const rig = PixiStudio.Rig.current;
    if (!rig) {
      bus.emit('notify', { type: 'warning', title: 'Bone Rename', message: 'Chưa có skeleton — chạy Auto Rig trước.' });
      return;
    }
    const boneName = PixiStudio.Rig.selectedBone || Object.keys(rig.bones)[0];
    PixiStudio.Modals.prompt({
      title: 'Rename Bone',
      label: 'Tên mới cho bone:',
      value: boneName,
      onOk: function (newName) {
        if (!newName || !newName.trim() || !rig.bones[boneName]) return;
        const bone = rig.bones[boneName];
        delete rig.bones[boneName];
        bone.name = newName.trim();
        rig.bones[bone.name] = bone;
        /* update children parentName */
        bone.children.forEach(function (c) { c.parentName = bone.name; });
        /* rebuild visual nhanh */
        const target = rig.target;
        if (rig.visualGroup) target.remove(rig.visualGroup);
        const skeleton = { bones: rig.bones };
        const visual = PixiStudio.Rig._buildVisual({ bones: rig.bones }, target);
        rig.visualGroup = visual;
        target.add(visual);
        PixiStudio.Rig.selectedBone = bone.name;
        bus.emit('notify', { type: 'success', title: 'Đã rename bone', message: boneName + ' → ' + bone.name });
        BoneEditor.renderBoneList();
        PixiStudio.Rig.renderPanel();
      }
    });
  };

  /* Mirror: đổi L↔R trong tên bone (rename-only, vị trí đã đối xứng sẵn) */
  BoneEditor.mirror = function () {
    const rig = PixiStudio.Rig.current;
    if (!rig) {
      bus.emit('notify', { type: 'warning', title: 'Mirror Bones', message: 'Chưa có skeleton — chạy Auto Rig trước.' });
      return;
    }
    let count = 0;
    const swapped = {};
    Object.keys(rig.bones).forEach(function (name) {
      const bone = rig.bones[name];
      const mirrored = name
        .replace(/_?L$/, '_TMP').replace(/_?R$/, 'L').replace(/_TMP$/, 'R')
        .replace(/Left/g, 'TMP_').replace(/Right/g, 'Left').replace(/TMP_/g, 'Right');
      if (mirrored !== name) { bone.name = mirrored; count++; }
      swapped[bone.name] = bone;
      if (bone.parentName) {
        bone.parentName = bone.parentName
          .replace(/_?L$/, '_TMP').replace(/_?R$/, 'L').replace(/_TMP$/, 'R')
          .replace(/Left/g, 'TMP_').replace(/Right/g, 'Left').replace(/TMP_/g, 'Right');
      }
    });
    rig.bones = swapped;
    /* rebuild children links */
    Object.keys(rig.bones).forEach(function (n) { rig.bones[n].children = []; });
    Object.keys(rig.bones).forEach(function (n) {
      const b = rig.bones[n];
      if (b.parentName && rig.bones[b.parentName]) rig.bones[b.parentName].children.push(b);
    });
    bus.emit('notify', { type: 'success', title: 'Mirror Bones', message: 'Đã mirror ' + count + ' bone (L ↔ R).' });
    BoneEditor.renderBoneList();
  };

  window.PixiStudio.BoneEditor = BoneEditor;
})();
