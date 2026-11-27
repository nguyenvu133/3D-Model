/* ============================================================
 * core/history.js — Undo / Redo toàn diện (v2, 2026-11-27)
 *
 * THIẾT KẾ — state-stack (như ArpQuickRig.History):
 *   _states = [baseline, state-sau-op-1, state-sau-op-2, ...]
 *   _index  = vị trí hiện tại. push() chụp state SAU thao tác
 *   (mọi call-site cũ đã push sau khi đổi nên KHÔNG cần dời),
 *   undo() lùi _index và áp state đó, redo() tiến _index.
 *   push() sau khi đã undo sẽ cắt nhánh redo.
 *   Baseline = state lúc boot xong (app.js gọi captureBaseline()
 *   sau khi loadDefault xong; importOne() cũng chụp nếu chưa có).
 *   Op nào chạy trước khi có baseline thì không undo được về
 *   trước op đó (undo dừng ở state đầu tiên đã ghi) — ghi rõ ở
 *   README trong file + báo cáo vòng.
 *
 * Snapshot MỖI BƯỚC gồm (nhẹ — chỉ số + ref sống, không copy
 * geometry/texture):
 *   entries: transform/visible/name của mọi object trong
 *     Scene.registry + ref sống tới object3D + parentRef (để
 *     undo Create/Import/Duplicate gỡ object ra, undo Delete
 *     gắn lại được; redo gắn lại được).
 *   mats: mỗi mesh con: color/roughness/metalness/opacity/
 *     transparent + ref tới map/normalMap (đổi màu/texture).
 *   pose: quaternion xương rig hiện tại + rootBone position.
 *   physics: bản copy plain của Physics.bodies (mass/collider/...).
 *   assets: Asset Library — ref sống + name/type/favorite/tags.
 *   keyframe: deep-copy plain của ArpQuickRig.Keyframe.clip
 *     (keys là dữ liệu JSON thuần nên copy rẻ).
 *   KHÔNG snapshot: clip THREE.AnimationClip của Animator (đối
 *     tượng THREE, có track + mixer) — phần đó do stack QR3/
 *     sync-history quản lý (xem js/rig/arp-sync-history.js);
 *     ranh giới 2 stack ghi ở cuối file này.
 *
 * RANH GIỚI 2 STACK (quyết định vòng Undo/Redo 2026-11-27):
 *   - Stack toàn cục này: scene-level — import/create/duplicate/
 *     delete/rename, transform (gizmo/viewport/inspector),
 *     material, physics props, asset-library, rig (pose/skeleton
 *     sau Smart/QuickRig/AutoFix — khôi phục POSE, không tháo
 *     skeleton đã dựng), pose từ Pose Library, keyframe clip.
 *   - Stack ArpQuickRig.History (js/rig/arp-qr3-history.js, 25
 *     bước): clip-data của Animator — trim/retime/reverse/mirror/
 *     crossfade/layers (qua arp-sync-history.js recordMutator,
 *     push TRƯỚC + SAU). KHÔNG double-record: các op Animator
 *     KHÔNG push vào stack toàn cục.
 *   - Panel History (js/ui/history-panel.js) hiển thị cả 2 stack.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const MAX = 100;

  const History = {
    _states: [],
    _index: -1,
    _locked: false,
    MAX: MAX,
    /* tương thích code cũ đọc _undo/_redo (chỉ dùng nội bộ trước đây) */
    _undo: [],
    _redo: []
  };

  function _matState(mat) {
    if (!mat) return null;
    const s = {};
    if (mat.color) s.color = mat.color.getHex ? mat.color.getHex() : null;
    if (mat.emissive) s.emissive = mat.emissive.getHex ? mat.emissive.getHex() : null;
    if (typeof mat.roughness === 'number') s.roughness = mat.roughness;
    if (typeof mat.metalness === 'number') s.metalness = mat.metalness;
    if (typeof mat.opacity === 'number') s.opacity = mat.opacity;
    if (typeof mat.transparent === 'boolean') s.transparent = mat.transparent;
    if (typeof mat.flatShading === 'boolean') s.flatShading = mat.flatShading;
    if (typeof mat.wireframe === 'boolean') s.wireframe = mat.wireframe;
    s.map = mat.map || null;
    s.normalMap = mat.normalMap || null;
    return s;
  }

  /* Chụp snapshot hiện tại (state SAU thao tác — xem header). */
  function snapshot(label) {
    const entries = {};
    if (PixiStudio.Scene) {
      const objs = PixiStudio.Scene.registry;
      for (const uuid in objs) {
        const reg = objs[uuid];
        const o = reg && reg.object3D;
        if (!o) continue;
        const mats = {};
        try {
          o.traverse(function (child) {
            if (!child.isMesh || !child.material) return;
            const m = child.material;
            if (Array.isArray(m)) {
              mats[child.uuid] = m.map(function (mm) { return { ref: mm, state: _matState(mm) }; });
            } else {
              mats[child.uuid] = { ref: m, state: _matState(m) };
            }
          });
        } catch (e) { /* traverse lỗi — bỏ qua material của object này */ }
        entries[uuid] = {
          p: [o.position.x, o.position.y, o.position.z],
          r: [o.rotation.x, o.rotation.y, o.rotation.z],
          s: [o.scale.x, o.scale.y, o.scale.z],
          v: o.visible,
          name: o.name,
          type: reg.type || 'object',
          ref: o,
          parentRef: o.parent || null,
          mats: mats
        };
      }
    }
    /* pose xương của rig hiện tại */
    let pose = null;
    const RAG = PixiStudio.RigAutoGen;
    if (RAG && RAG.current && RAG.current.bones) {
      pose = { bones: {}, root: null };
      for (const name in RAG.current.bones) {
        const b = RAG.current.bones[name];
        if (b && b.quaternion) pose.bones[name] = [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w];
      }
      if (RAG.current.rootBone) pose.root = [RAG.current.rootBone.position.x, RAG.current.rootBone.position.y, RAG.current.rootBone.position.z];
    }
    /* physics bodies (plain copy — không có _vel/_rest runtime) */
    let physics = null;
    try {
      const P = PixiStudio.Physics;
      if (P && P.bodies) {
        physics = {};
        for (const uuid in P.bodies) {
          const b = P.bodies[uuid];
          if (!b) continue;
          physics[uuid] = {
            mass: b.mass, gravity: b.gravity, friction: b.friction,
            bounciness: b.bounciness, collider: b.collider,
            colliderSize: b.colliderSize ? b.colliderSize.slice() : [1, 1, 1],
            sim: !!b.sim
          };
        }
      }
    } catch (e) { physics = null; }
    /* asset library (ref sống + field hiển thị; KHÔNG copy file nhị phân) */
    let assets = null;
    try {
      const L = PixiStudio.AssetLibrary;
      if (L && Array.isArray(L.assets)) {
        assets = L.assets.map(function (a) {
          return {
            id: a.id, name: a.name, type: a.type,
            favorite: !!a.favorite, tags: (a.tags || []).slice(), ref: a
          };
        });
      }
    } catch (e) { assets = null; }
    /* keyframe clip (dữ liệu JSON thuần — deep copy rẻ) */
    let keyframe = null;
    let hasKeyframe = false;
    try {
      const KF = PixiStudio.ArpQuickRig && PixiStudio.ArpQuickRig.Keyframe;
      if (KF && KF.clip) {
        hasKeyframe = true;
        keyframe = JSON.parse(JSON.stringify(KF.clip));
      }
    } catch (e) { hasKeyframe = false; keyframe = null; }
    return {
      label: label || 'change', time: Date.now(),
      entries: entries, pose: pose, physics: physics,
      assets: assets, keyframe: keyframe, hasKeyframe: hasKeyframe
    };
  }

  /* Kích thước JSON (phần serialize được) của 1 snapshot — dùng để đo. */
  History.snapshotSize = function (snap) {
    try {
      const s = snap || snapshot('measure');
      return JSON.stringify({
        entries: s.entries, pose: s.pose, physics: s.physics,
        assets: (s.assets || []).map(function (a) { return { id: a.id, name: a.name, type: a.type, favorite: a.favorite, tags: a.tags }; }),
        keyframe: s.keyframe
      }, function (k, v) {
        /* ref/parentRef/map là object sống — thay bằng marker để đo đúng */
        if (k === 'ref' || k === 'parentRef' || k === 'map' || k === 'normalMap') return '[ref]';
        return v;
      }).length;
    } catch (e) { return -1; }
  };

  function _applyMat(mat, s) {
    if (!mat || !s) return;
    try {
      if (s.color !== null && s.color !== undefined && mat.color && mat.color.setHex) mat.color.setHex(s.color);
      if (s.emissive !== null && s.emissive !== undefined && mat.emissive && mat.emissive.setHex) mat.emissive.setHex(s.emissive);
      if (typeof s.roughness === 'number') mat.roughness = s.roughness;
      if (typeof s.metalness === 'number') mat.metalness = s.metalness;
      if (typeof s.opacity === 'number') mat.opacity = s.opacity;
      if (typeof s.transparent === 'boolean') mat.transparent = s.transparent;
      if (typeof s.flatShading === 'boolean') mat.flatShading = s.flatShading;
      if (typeof s.wireframe === 'boolean') mat.wireframe = s.wireframe;
      if ('map' in s) mat.map = s.map;
      if ('normalMap' in s) mat.normalMap = s.normalMap;
      mat.needsUpdate = true;
    } catch (e) { /* material lạ — bỏ qua */ }
  }

  function _applyMats(obj, mats) {
    if (!mats) return;
    try {
      obj.traverse(function (child) {
        if (!child.isMesh || !child.material) return;
        const s = mats[child.uuid];
        if (s === undefined || s === null) return;
        if (Array.isArray(s)) {
          if (Array.isArray(child.material)) {
            s.forEach(function (ms, i) {
              if (!child.material[i] || !ms) return;
              if (ms.ref && child.material[i] !== ms.ref) child.material[i] = ms.ref;
              _applyMat(child.material[i], ms.state);
            });
          } else if (s[0]) {
            if (s[0].ref && child.material !== s[0].ref) child.material = s[0].ref;
            _applyMat(child.material, s[0].state);
          }
        } else {
          if (s.ref && child.material !== s.ref) child.material = s.ref;
          _applyMat(child.material, s.state);
        }
      });
    } catch (e) { /* bỏ qua */ }
  }

  function apply(snap) {
    if (!snap) return;
    /* --- scene: gỡ object thừa, gắn lại object thiếu, restore transform --- */
    if (PixiStudio.Scene) {
      const objs = PixiStudio.Scene.registry;
      Object.keys(objs).forEach(function (uuid) {
        if (snap.entries[uuid]) return;
        const reg = objs[uuid];
        const o = reg && reg.object3D;
        if (o && o.parent) o.parent.remove(o);
        delete objs[uuid];
      });
      for (const uuid in snap.entries) {
        const e = snap.entries[uuid];
        let reg = objs[uuid];
        if (!reg || !reg.object3D) {
          /* object đã bị xoá khỏi registry — gắn lại từ ref sống */
          if (e.ref) {
            try {
              const parent = e.parentRef || (PixiStudio.Viewport && PixiStudio.Viewport.scene) || null;
              if (parent) parent.add(e.ref);
              else if (PixiStudio.Viewport && PixiStudio.Viewport.modelRoot) PixiStudio.Viewport.modelRoot.add(e.ref);
            } catch (err) { /* không gắn lại được — bỏ qua */ }
            if (PixiStudio.Scene.register) {
              try { PixiStudio.Scene.register(e.ref, e.type || 'object', e.name); } catch (err2) { /* bỏ qua */ }
            } else {
              objs[uuid] = { object3D: e.ref, type: e.type || 'object', name: e.name, locked: false, parentId: null };
            }
            reg = objs[uuid];
          }
          if (!reg || !reg.object3D) continue;
        }
        const o = reg.object3D;
        o.position.set(e.p[0], e.p[1], e.p[2]);
        o.rotation.set(e.r[0], e.r[1], e.r[2]);
        o.scale.set(e.s[0], e.s[1], e.s[2]);
        o.visible = e.v;
        o.name = e.name || o.name;
        reg.name = e.name || reg.name;
        _applyMats(o, e.mats);
      }
    }
    /* --- pose xương --- */
    if (snap.pose && snap.pose.bones) {
      const RAG = PixiStudio.RigAutoGen;
      if (RAG && RAG.current && RAG.current.bones) {
        for (const name in snap.pose.bones) {
          const b = RAG.current.bones[name] || RAG.current.bones['mixamorig:' + name];
          if (!b) continue;
          const q = snap.pose.bones[name];
          b.quaternion.set(q[0], q[1], q[2], q[3]);
        }
        if (snap.pose.root && RAG.current.rootBone) RAG.current.rootBone.position.set(snap.pose.root[0], snap.pose.root[1], snap.pose.root[2]);
        if (RAG.current.target) RAG.current.target.updateMatrixWorld(true);
      }
    }
    /* --- physics --- */
    if (snap.physics) {
      try {
        const P = PixiStudio.Physics;
        if (P && P.bodies) {
          Object.keys(P.bodies).forEach(function (uuid) {
            if (!snap.physics[uuid]) delete P.bodies[uuid];
          });
          for (const uuid in snap.physics) {
            const s = snap.physics[uuid];
            const b = P.ensure ? P.ensure(uuid) : (P.bodies[uuid] = {});
            b.mass = s.mass; b.gravity = s.gravity; b.friction = s.friction;
            b.bounciness = s.bounciness; b.collider = s.collider;
            b.colliderSize = s.colliderSize ? s.colliderSize.slice() : [1, 1, 1];
            b.sim = !!s.sim;
          }
        }
      } catch (e) { /* bỏ qua */ }
    }
    /* --- asset library --- */
    if (snap.assets) {
      try {
        const L = PixiStudio.AssetLibrary;
        if (L && Array.isArray(L.assets)) {
          L.assets = snap.assets.map(function (a) {
            const ref = a.ref || {};
            ref.name = a.name; ref.type = a.type; ref.favorite = a.favorite;
            ref.tags = (a.tags || []).slice();
            return ref;
          });
          if (typeof L._refresh === 'function') { try { L._refresh(); } catch (e2) { /* bỏ qua */ } }
          if (typeof L._persistSafe === 'function') { try { L._persistSafe(); } catch (e3) { /* bỏ qua */ } }
        }
      } catch (e) { /* bỏ qua */ }
    }
    /* --- keyframe clip --- */
    if (snap.hasKeyframe) {
      try {
        const KF = PixiStudio.ArpQuickRig && PixiStudio.ArpQuickRig.Keyframe;
        if (KF) KF.clip = snap.keyframe ? JSON.parse(JSON.stringify(snap.keyframe)) : null;
      } catch (e) { /* bỏ qua */ }
    }
    bus.emit('transform:changed', { source: 'history' });
    bus.emit('scene:changed', { action: 'history', label: snap.label });
    bus.emit('history:applied', { label: snap.label });
  }

  function _emitChanged(label) {
    bus.emit('history:changed', {
      canUndo: History.canUndo(), canRedo: History.canRedo(),
      label: label, index: History._index, count: History._states.length
    });
  }

  /* Baseline: state gốc để undo bước đầu tiên có chỗ quay về.
     Gọi 1 lần lúc boot xong (app.js) — gọi lại chỉ reset khi stack rỗng. */
  History.captureBaseline = function (label) {
    if (History._states.length) return false;
    History._states.push(snapshot(label || 'Ban đầu'));
    History._index = 0;
    _emitChanged(label || 'Ban đầu');
    return true;
  };

  History.push = function (label, customSnapshot) {
    if (History._locked) return null;
    const snap = customSnapshot || snapshot(label);
    snap.label = label || snap.label;
    /* cắt nhánh redo phía sau vị trí hiện tại */
    if (History._index < History._states.length - 1) {
      History._states.length = History._index + 1;
    }
    History._states.push(snap);
    if (History._states.length > MAX) {
      History._states.shift();
    }
    History._index = History._states.length - 1;
    History._syncLegacy();
    _emitChanged(label);
    return snap;
  };

  /* push snapshot đặt tên rõ là pose (giữ API cũ). */
  History.pushPose = function (label) {
    return History.push(label || 'pose');
  };

  History.undo = function () {
    if (!History.canUndo()) return false;
    History._locked = true;
    History._index--;
    try { apply(History._states[History._index]); } finally { History._locked = false; }
    History._syncLegacy();
    _emitChanged(History._states[History._index] && History._states[History._index].label);
    return true;
  };

  History.redo = function () {
    if (!History.canRedo()) return false;
    History._locked = true;
    History._index++;
    try { apply(History._states[History._index]); } finally { History._locked = false; }
    History._syncLegacy();
    _emitChanged(History._states[History._index] && History._states[History._index].label);
    return true;
  };

  /* Nhảy tới 1 bước trong danh sách (panel History bấm vào bước). */
  History.jumpTo = function (i) {
    i = Math.max(0, Math.min(History._states.length - 1, i | 0));
    if (!History._states.length || i === History._index) return false;
    History._locked = true;
    History._index = i;
    try { apply(History._states[i]); } finally { History._locked = false; }
    History._syncLegacy();
    bus.emit('history:jumped', { index: i, label: History._states[i].label });
    _emitChanged(History._states[i].label);
    return true;
  };

  History.canUndo = function () { return History._index > 0; };
  History.canRedo = function () { return History._index >= 0 && History._index < History._states.length - 1; };

  /* Danh sách bước cho panel History (label + thời gian + vị trí hiện tại). */
  History.list = function () {
    return History._states.map(function (s, i) {
      return { index: i, label: s.label, time: s.time, current: i === History._index };
    });
  };

  History.clear = function () {
    History._states.length = 0;
    History._index = -1;
    History._syncLegacy();
    _emitChanged(null);
  };

  History.info = function () {
    return {
      undo: History._index > 0 ? History._index : 0,
      redo: History._states.length - 1 - History._index,
      count: History._states.length,
      index: History._index,
      last: History._index >= 0 && History._states[History._index] ? History._states[History._index].label : null
    };
  };

  /* Đồng bộ _undo/_redo cũ (chỉ để code ngoài đọc info kiểu cũ không vỡ). */
  History._syncLegacy = function () {
    History._undo = History._states.slice(0, History._index + 1);
    History._redo = History._states.slice(History._index + 1).reverse();
  };

  window.PixiStudio.History = History;
})();
