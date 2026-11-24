/* ============================================================
 * rigging/rig-oneclick.js — RIG 1 LƯỢT kiểu Meshy Animate (local)
 *
 * Mô phỏng hộp thoại "Rig Model" của Meshy Animate
 * (https://www.meshy.ai/vi/workspace?sidebar=animate) nhưng chạy
 * HOÀN TOÀN LOCAL, không cần API key msy_:
 *   Meshy cloud:  model_url → animation_type (biped/quadruped)
 *                 → skeleton_template (mixamo/ue5/unity/...)
 *                 → height_meters → include_fingers → Rig → FBX.
 *   Studio local: detect loại → align (mặt +Z, chân y=0, cao chuẩn)
 *                 → marker khớp → dựng skeleton → skinning → QA
 *                 → Export FBX 2013 (writer đã sửa, chuẩn Mixamo).
 *
 * Một cú nhấp "Rig 1 Lượt" chạy hết pipeline; chỉnh marker xong bấm
 * "Rig lại" không cần làm lại từ đầu; rig xong bấm "Export FBX" để
 * tải file <tên-model>_rigged_mixamo.fbx về, upload thẳng lên Mixamo.
 *
 * LƯU Ý TRUNG THỰC (khác Meshy cloud):
 *  • Rig trong viewport dùng RigAutoGen: 23 xương (+20 ngón tay nếu bật
 *    fingers) — tên mixamorig:* khi chọn template Mixamo.
 *  • Export FBX dùng khung xương CHUẨN MIXAMO 65 xương
 *    (MixamoSkeleton.build — trích từ X Bot.fbx) trên bản sao model
 *    cho viewport; FILE xuất ra là mesh-only Mixamo-safe (< 50k
 *    tris, có texture) — Mixamo tự auto-rig, giống file Thiếu Lâm/
 *    Thần Điêu đã sửa tay (round 4). Xem js/exporter/mixamo-safe-export.js.
 *  • Không có khung xương chim: model chim/bốn chân được rig bằng khung
 *    humanoid "cho có" + cảnh báo rõ ràng, không giả vờ khớp.
 *  • Marker chỉnh bằng số % (chưa kéo-thả trên viewport như Meshy).
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const RigOneClick = {
    lastResult: null,   // kết quả lần rig gần nhất
    lastOpts: null,     // opts lần rig gần nhất (cho Rig lại)
    lastBuild: null,    // { target, build } — khung 65 xương đã dựng (cho Export)
    running: false
  };

  /* ---------- Loại nhân vật (map tham số animation_type của Meshy) ---------- */
  RigOneClick.TYPES = {
    auto: { label: '🤖 Tự động nhận diện', animationType: null },
    humanoid: { label: 'Humanoid — người 2 tay 2 chân', animationType: 'biped' },
    quadruped: { label: 'Quadruped — động vật 4 chân', animationType: 'quadruped' },
    bird: { label: 'Bird — chim (thử nghiệm)', animationType: 'biped' },
    custom: { label: 'Custom — chọn preset tay', animationType: 'biped' }
  };

  /* ---------- Skeleton template (map skeleton_template của Meshy) ----------
     Local chỉ dựng được 3 preset thật; các template khác map về preset gần
     nhất và ghi rõ trong UI — không giả vờ hỗ trợ đủ 9 template của Meshy. */
  RigOneClick.TEMPLATES = {
    mixamo: { label: 'Mixamo (mặc định)', preset: 'Mixamo Compatible' },
    ue5_mannequin: { label: 'UE5 Mannequin', preset: 'UE5 Mannequin' },
    unity_humanoid: { label: 'Unity Humanoid', preset: 'Mixamo Compatible' },
    meshyrig: { label: 'Meshy Rig (24 xương)', preset: 'Studio Humanoid' },
    max_biped: { label: '3ds Max Biped → dùng Mixamo', preset: 'Mixamo Compatible' },
    maya_human_ik: { label: 'Maya HumanIK → dùng Mixamo', preset: 'Mixamo Compatible' },
    blender_rigify_basic_human: { label: 'Blender Rigify → dùng Mixamo', preset: 'Mixamo Compatible' },
    cc5_hd_neutral_base: { label: 'CC5 HD → dùng Mixamo', preset: 'Mixamo Compatible' },
    daz_genesis9: { label: 'DAZ Genesis 9 → dùng Mixamo', preset: 'Mixamo Compatible' }
  };

  /* ---------- Marker khớp (tỉ lệ theo chiều cao H) ---------- */
  RigOneClick.MARKER_DEFS = [
    ['chin', 'Cằm'], ['shoulder', 'Vai'], ['elbow', 'Khuỷu'], ['wrist', 'Cổ tay'],
    ['groin', 'Háng'], ['knee', 'Gối'], ['ankle', 'Mắt cá']
  ];

  RigOneClick.DEFAULT_HEIGHT_M = 1.7;   /* Meshy mặc định biped 1.7m */

  function notify(type, title, message, duration) {
    bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 });
  }

  function sanitizeName(name) {
    return String(name || 'model').replace(/\.(glb|gltf|fbx|obj|stl)$/i, '')
      .replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'model';
  }

  function getTarget(target) {
    return target || (PixiStudio.Viewport && PixiStudio.Viewport.getMainModel ? PixiStudio.Viewport.getMainModel() : null);
  }

  function countTris(root) {
    let tris = 0, meshes = 0;
    if (!root || !root.traverse) return { tris: 0, meshes: 0 };
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      if (o.userData && (o.userData.isBoneVisual || o.userData.skipSkin)) return;
      meshes++;
      const pos = o.geometry.attributes.position;
      tris += Math.round((o.geometry.index ? o.geometry.index.count : pos.count) / 3);
    });
    return { tris: tris, meshes: meshes };
  }

  function hasTexture(root) {
    let found = false;
    if (!root || !root.traverse) return false;
    const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
    root.traverse(function (o) {
      if (found || !o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m) return;
        SLOTS.forEach(function (s) {
          const t = m[s];
          if (t && t.image) found = true;
        });
      });
    });
    return found;
  }

  /* Chờ texture decode xong trước khi nhúng (cùng cách làm của SaveManager) */
  function waitForTextures(root, timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    const imgs = [];
    const seen = new Set();
    const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
    if (!root || !root.traverse) return Promise.resolve({ total: 0, ready: 0 });
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m) return;
        SLOTS.forEach(function (s) {
          const t = m[s];
          const im = (t && (t.userData && t.userData.originalImage || t.image)) || null;
          if (im && !seen.has(im)) { seen.add(im); imgs.push(im); }
        });
      });
    });
    if (!imgs.length) return Promise.resolve({ total: 0, ready: 0 });
    const ready = function (im) { return (im.width || im.videoWidth || 0) > 0; };
    const waits = imgs.map(function (im) {
      if (ready(im)) return Promise.resolve(true);
      if (typeof im.decode === 'function') {
        return im.decode().then(function () { return ready(im); }).catch(function () { return ready(im); });
      }
      return new Promise(function (res) {
        const done = function () { res(ready(im)); };
        if (im.addEventListener) {
          im.addEventListener('load', done, { once: true });
          im.addEventListener('error', done, { once: true });
        }
        setTimeout(done, timeoutMs);
      });
    });
    const all = Promise.all(waits).then(function () { return true; });
    const boom = new Promise(function (r) { setTimeout(function () { r(false); }, timeoutMs); });
    return Promise.race([all, boom]).then(function () {
      let ok = 0; imgs.forEach(function (im) { if (ready(im)) ok++; });
      return { total: imgs.length, ready: ok };
    });
  }

  /* Đặt chân model chạm đất y=0 (bước Align của Meshy) */
  function groundSnap(target) {
    if (!window.THREE || !target) return 0;
    target.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return 0;
    const dy = -box.min.y;
    if (Math.abs(dy) > 1e-6) target.position.y += dy;
    target.updateMatrixWorld(true);
    return dy;
  }

  function makeSteps() {
    return [
      { id: 'detect', label: 'Nhận diện loại nhân vật', status: 'pending', detail: '' },
      { id: 'align', label: 'Căn chỉnh (mặt +Z · chân chạm đất · cao chuẩn)', status: 'pending', detail: '' },
      { id: 'markers', label: 'Đặt marker khớp', status: 'pending', detail: '' },
      { id: 'rig', label: 'Dựng skeleton + skinning', status: 'pending', detail: '' },
      { id: 'qa', label: 'Kiểm tra chất lượng (QA)', status: 'pending', detail: '' }
    ];
  }

  function setStep(steps, id, status, detail, onStep) {
    const s = steps.find(function (x) { return x.id === id; });
    if (!s) return;
    s.status = status;
    if (detail !== undefined) s.detail = detail;
    if (typeof onStep === 'function') { try { onStep(s); } catch (e) {} }
  }

  /* ============================================================
     RIG 1 LƯỢT — chạy toàn bộ pipeline trong một lần gọi.
     Không throw ra ngoài: mọi lỗi được ghi vào step + result.
     Trả về Promise<result>.
     ============================================================ */
  RigOneClick.runOneClick = function (target, opts) {
    target = getTarget(target);
    opts = opts || {};
    const onStep = opts.onStep;
    const steps = makeSteps();
    const warnings = [];
    const errors = [];
    const result = {
      ok: false, steps: steps, warnings: warnings, errors: errors,
      type: opts.type || 'auto', detection: null, preset: null,
      boneCount: 0, mixamoBones: 0, skinnedMeshes: 0, tris: 0, height: 0,
      qa: null, validator: null, rig: null, mixamoBuild: null, exportReady: false
    };
    RigOneClick.lastOpts = opts;
    if (RigOneClick.running) {
      notify('warning', 'Rig 1 Lượt', 'Đang rig dở một model khác — chờ xong rồi bấm lại.');
      result.errors.push('Đang rig dở một model khác');
      return Promise.resolve(result);
    }
    if (!target) {
      setStep(steps, 'detect', 'fail', 'Chưa có model nào — load model trước.', onStep);
      notify('warning', 'Rig 1 Lượt', 'Chưa có model nào để rig. Load model trước.');
      result.errors.push('Chưa có model nào');
      RigOneClick.lastResult = result;
      return Promise.resolve(result);
    }
    if (!window.THREE || !PixiStudio.RigAutoGen) {
      setStep(steps, 'detect', 'fail', 'Module RigAutoGen chưa sẵn sàng.', onStep);
      notify('error', 'Rig 1 Lượt', 'Module RigAutoGen chưa nạp — tải lại trang.');
      result.errors.push('RigAutoGen chưa sẵn sàng');
      RigOneClick.lastResult = result;
      return Promise.resolve(result);
    }

    RigOneClick.running = true;
    const RAG = PixiStudio.RigAutoGen;
    const type = opts.type || 'auto';
    const template = RigOneClick.TEMPLATES[opts.template] ? opts.template : 'mixamo';
    const preset = (RigOneClick.TEMPLATES[template] || {}).preset || 'Mixamo Compatible';
    const heightM = parseFloat(opts.heightM) > 0 ? parseFloat(opts.heightM) : RigOneClick.DEFAULT_HEIGHT_M;
    const markers = Object.assign({}, RAG.MARKERS_DEFAULT || {}, opts.markers || {});
    result.type = type;
    result.preset = preset;

    const finish = function () {
      RigOneClick.running = false;
      RigOneClick.lastResult = result;
      if (result.ok) {
        notify('success', '⚡ Rig 1 Lượt xong',
          result.boneCount + ' xương viewport (' + result.preset + ') · khung xuất 65 xương Mixamo · ' +
          result.skinnedMeshes + ' mesh đã skin · cao ' + result.height.toFixed(2) + 'm · ' + result.tris + ' tris' +
          (warnings.length ? ' — LƯU Ý: ' + warnings.join('; ') : ''), 12000);
      } else {
        notify('error', 'Rig 1 Lượt chưa xong', errors.join('; ') || 'Xem từng bước trong panel.', 10000);
      }
      bus.emit('rig:oneclick', { ok: result.ok, type: result.type, boneCount: result.boneCount, warnings: warnings });
      return result;
    };

    /* ---------- BƯỚC 1: DETECT ---------- */
    setStep(steps, 'detect', 'running', 'Đang đo bounding box…', onStep);
    let det = null;
    try { det = RAG.detectCharacterType(target); } catch (e) { det = { type: 'humanoid', confidence: 0, reason: 'Detect lỗi: ' + e.message }; }
    result.detection = det;
    let effType = type;
    if (type === 'auto') effType = (det && det.type === 'quadruped') ? 'quadruped' : 'humanoid';
    if (type === 'bird') {
      warnings.push('Model chim — studio chưa có khung xương chim; rig humanoid sẽ đặt xương tay/chân không khớp cánh/chân chim, chỉ để thử nghiệm. Mixamo auto-rig cũng không nhận chim.');
    }
    if (type === 'quadruped' || (type === 'auto' && effType === 'quadruped')) {
      warnings.push('Model 4 chân — dùng rig Creature (không phải khung Mixamo 65 xương); Export FBX sẽ xuất mesh + rig creature.');
    }
    result.type = effType;
    setStep(steps, 'detect', 'done', (type === 'auto' ? 'Tự nhận diện: ' : 'Đã chọn: ') + (effType === 'quadruped' ? 'Quadruped (4 chân)' : effType === 'humanoid' ? 'Humanoid (2 chân)' : type) + ' · ' + (det ? det.reason : ''), onStep);

    /* ---------- BƯỚC 2: ALIGN ---------- */
    setStep(steps, 'align', 'running', 'Đang căn chỉnh…', onStep);
    let alignState = null;
    try {
      alignState = RAG.align(target, {
        rotateY: opts.rotateY != null ? opts.rotateY : 0,
        offsetX: opts.offsetX || 0,
        offsetZ: opts.offsetZ || 0,
        heightM: heightM
      });
    } catch (e) {
      setStep(steps, 'align', 'fail', 'Align lỗi: ' + e.message, onStep);
      errors.push('Align lỗi: ' + e.message);
      return Promise.resolve(finish());
    }
    const dy = groundSnap(target);
    setStep(steps, 'align', 'done', 'Cao ' + (alignState ? alignState.heightM : heightM) + 'm · xoay ' + (opts.rotateY || 0) + '° · chân về y=0' + (Math.abs(dy) > 1e-6 ? ' (dời ' + dy.toFixed(2) + 'm)' : ''), onStep);

    /* ---------- BƯỚC 3: MARKERS ---------- */
    setStep(steps, 'markers', 'running', 'Đang kiểm tra marker…', onStep);
    const badMarkers = [];
    Object.keys(markers).forEach(function (k) {
      const v = parseFloat(markers[k]);
      if (!isFinite(v) || v < 0 || v > 1) badMarkers.push(k);
      else markers[k] = v;
    });
    if (badMarkers.length) {
      setStep(steps, 'markers', 'fail', 'Marker ngoài 0–100%: ' + badMarkers.join(', '), onStep);
      errors.push('Marker ngoài 0–100%: ' + badMarkers.join(', '));
      return Promise.resolve(finish());
    }
    setStep(steps, 'markers', 'done', 'Cằm ' + Math.round(markers.chin * 100) + '% · Vai ' + Math.round(markers.shoulder * 100) + '% · Háng ' + Math.round(markers.groin * 100) + '% · Gối ' + Math.round(markers.knee * 100) + '% · Mắt cá ' + Math.round(markers.ankle * 100) + '%' + (opts.symmetry === false ? ' · (tắt Symmetry — QA bỏ kiểm tra đối xứng)' : ' · Symmetry mirror 2 bên'), onStep);

    /* ---------- BƯỚC 4: RIG ---------- */
    setStep(steps, 'rig', 'running', 'Đang dựng skeleton…', onStep);

    const afterRig = function () {
      /* ---------- BƯỚC 5: QA ---------- */
      setStep(steps, 'qa', 'running', 'Đang kiểm tra…', onStep);
      const stats = countTris(target);
      result.tris = stats.tris;
      try {
        /* Đo box CHỈ từ mesh thật (loại visual xương + SkeletonHelper) —
           setFromObject cả target sẽ tính cả helper/bone visual làm sai số. */
        const box = new THREE.Box3();
        let hasMesh = false;
        target.traverse(function (o) {
          if (o.isMesh && !(o.userData && o.userData.isBoneVisual)) { box.expandByObject(o); hasMesh = true; }
        });
        result.height = hasMesh && !box.isEmpty() ? (box.max.y - box.min.y) : 0;
      } catch (e) { result.height = 0; }
      let qa = null;
      try { qa = RAG.qaReport(); } catch (e) { qa = { ok: false, checks: [{ name: 'QA', ok: false, detail: 'QA lỗi: ' + e.message }] }; }
      result.qa = qa;
      /* QA đối xứng chỉ tính khi bật Symmetry (mặc định bật) */
      if (opts.symmetry === false && qa && qa.checks) {
        qa.checks = qa.checks.map(function (c) {
          return c.name === 'Symmetry' ? { name: 'Symmetry', ok: true, detail: c.detail + ' (đã tắt kiểm tra)' } : c;
        });
        qa.ok = qa.checks.every(function (c) { return c.ok; });
      }
      const qaBad = (qa && qa.checks ? qa.checks.filter(function (c) { return !c.ok; }) : []);
      qaBad.forEach(function (c) { warnings.push('QA: ' + c.name + ' — ' + c.detail); });
      /* Validator Mixamo trên model đã rig (cảnh báo, không chặn ở bước rig) */
      try {
        if (PixiStudio.MixamoValidator) {
          result.validator = PixiStudio.MixamoValidator.check(target, { mode: 'rig' });
          (result.validator.warnings || []).forEach(function (w) { warnings.push(w); });
        }
      } catch (e) { /* validator optional */ }
      const qaOk = qa ? qa.ok : false;
      setStep(steps, 'qa', qaOk ? 'done' : 'warn',
        (qa ? qa.checks.map(function (c) { return (c.ok ? '✅' : '⚠️') + ' ' + c.name; }).join(' · ') : 'Không chạy được QA'), onStep);
      /* Quadruped: CreatureRigs không skin theo kiểu Mixamo nên chỉ cần có xương */
      result.ok = result.boneCount > 0 && (result.type === 'quadruped' || result.skinnedMeshes > 0);
      if (!result.ok) errors.push('Rig xong nhưng không có xương/skin — xem lại QA.');
      result.exportReady = result.ok;
      const out = finish();
      if (typeof opts.onDone === 'function') { try { opts.onDone(result); } catch (e) {} }
      return out;
    };

    /* Quadruped: rig Creature (async, cần template GLB) */
    if (effType === 'quadruped') {
      if (!PixiStudio.CreatureRigs) {
        setStep(steps, 'rig', 'fail', 'Chưa nạp CreatureRigs — không rig 4 chân được.', onStep);
        errors.push('Chưa nạp CreatureRigs — không rig 4 chân được');
        return Promise.resolve(finish());
      }
      const rigId = (result.height || (det && det.height) || 1.5) < 1 ? 'fox' : ((result.height || 1.5) < 2 ? 'horse' : 'kaiju');
      return PixiStudio.CreatureRigs.build(target, rigId).then(function (rig) {
        if (!rig) {
          setStep(steps, 'rig', 'fail', 'CreatureRigs.build trả về rỗng.', onStep);
          errors.push('Không dựng được rig creature');
          return finish();
        }
        result.rig = rig;
        result.boneCount = rig.boneCount || 0;
        result.skinnedMeshes = 0;
        result.mixamoBones = 0;
        setStep(steps, 'rig', 'done', 'Rig creature "' + rigId + '" · ' + result.boneCount + ' bone (không skin Mixamo)', onStep);
        return afterRig();
      }).catch(function (e) {
        setStep(steps, 'rig', 'fail', 'Rig creature lỗi: ' + (e && e.message || e), onStep);
        errors.push('Rig creature lỗi: ' + (e && e.message || e));
        return finish();
      });
    }

    /* Humanoid / Bird / Custom: khung 65 xương chuẩn Mixamo (bản sao) + rig viewport.
       THÁO rig cũ TRƯỚC (khôi phục mesh rigid) — MixamoSkeleton.build bỏ qua
       SkinnedMesh nên rig lại trên model đã skin sẽ không thu được mesh nào. */
    if (RAG.current && RAG.current.target === target) RAG.clearTarget(target);
    let built = null;
    try {
      if (PixiStudio.MixamoSkeleton) {
        built = PixiStudio.MixamoSkeleton.build(target, { height: 1.8 });
        RigOneClick.lastBuild = { target: target, build: built };
        result.mixamoBuild = built;
        result.mixamoBones = built.stats.bones;
      }
    } catch (e) {
      warnings.push('Không dựng được khung 65 xương chuẩn Mixamo (' + (e && e.message || e) + ') — dùng rig auto-gen, Export sẽ thử lại.');
      RigOneClick.lastBuild = null;
      result.mixamoBuild = null;
    }
    try {
      const rig = RAG.generate(target, preset, false, { markers: markers, fingers: !!opts.fingers });
      if (!rig) {
        setStep(steps, 'rig', 'fail', 'RigAutoGen.generate trả về rỗng.', onStep);
        errors.push('Không tạo được rig');
        return Promise.resolve(finish());
      }
      result.rig = rig;
      result.boneCount = rig.boneCount || Object.keys(rig.bones || {}).length;
      result.skinnedMeshes = rig.skinnedCount || 0;
      setStep(steps, 'rig', 'done',
        result.boneCount + ' xương viewport (' + preset + ')' +
        (built ? ' · khung xuất ' + built.stats.bones + ' xương Mixamo (' + built.stats.bonesUsed + ' xương có skin)' : ' · (chưa có khung 65 xương)') +
        ' · ' + result.skinnedMeshes + ' mesh đã skin', onStep);
    } catch (e) {
      setStep(steps, 'rig', 'fail', 'Dựng rig lỗi: ' + (e && e.message || e), onStep);
      errors.push('Dựng rig lỗi: ' + (e && e.message || e));
      return Promise.resolve(finish());
    }
    return Promise.resolve(afterRig());
  };

  /* Rig lại với marker/opts đã chỉnh — không cần làm lại từ đầu */
  RigOneClick.reRig = function (target, opts) {
    const base = RigOneClick.lastOpts || {};
    const merged = Object.assign({}, base, opts || {});
    return RigOneClick.runOneClick(target, merged);
  };

  /* ============================================================
     EXPORT FBX — dùng đúng FBXBinary.write đã sửa (footer chuẩn SDK,
     FileId đúng, Video Path cho texture), preset Mixamo:
       version 7300 (FBX 2013) · Y-up · autoScale · embedTextures
       khi model có texture.
     ROUND 4 (11-2026) — file xuất ra LUÔN mesh-only Mixamo-safe
     (< 50k tris, có texture), giống hệt 2 file mẫu Thiếu Lâm/
     Thần Điêu đã sửa tay: MixamoSafeExport.prepare bỏ skeleton
     (Mixamo map-skeleton thất bại với xương không skin + A-pose)
     và tự decimate giữ UV khi >= 50k tris. Khung 65 xương vẫn giữ
     trong scene (lastBuild) để làm animation — chỉ không xuất ra file.
     Trả về Promise<{bytes, report, filename, validation, exportGroup,
     mixamoSafe}> hoặc null khi bị chặn. Không throw ra ngoài.
     ============================================================ */
  RigOneClick.buildExportBytes = function (target, modelName) {
    target = getTarget(target);
    if (!target) {
      notify('warning', 'Export FBX', 'Chưa có model nào để xuất.');
      return Promise.resolve(null);
    }
    const name = sanitizeName(modelName || (PixiStudio.Models && PixiStudio.Models.current && PixiStudio.Models.current.name) || target.name || 'model');
    const filename = name + '_rigged_mixamo.fbx';
    const V = PixiStudio.MixamoValidator;
    const W = PixiStudio.FBXBinary;
    if (!W || !W.write) {
      notify('error', 'Export FBX', 'FBXBinary writer chưa nạp.');
      return Promise.resolve(null);
    }

    /* Nhóm nguồn: ưu tiên khung 65 xương đã dựng ở bước rig (giữ
       trong scene để làm animation). Quadruped: KHÔNG dựng khung
       humanoid — xuất thẳng model + rig creature. */
    let out = target, built = null;
    if (RigOneClick.lastResult && RigOneClick.lastResult.type === 'quadruped') {
      out = target; built = null;
    } else if (RigOneClick.lastBuild && RigOneClick.lastBuild.target === target) {
      built = RigOneClick.lastBuild.build;
      out = built.group;
    } else if (PixiStudio.MixamoSkeleton && RigOneClick.lastResult && RigOneClick.lastResult.type !== 'quadruped') {
      try {
        built = PixiStudio.MixamoSkeleton.build(target, { height: 1.8 });
        RigOneClick.lastBuild = { target: target, build: built };
        out = built.group;
      } catch (e) {
        built = null; out = target;
      }
    }

    /* Round 4 — chuẩn bị Mixamo-safe trên nhóm nguồn: bỏ skeleton,
       tự decimate giữ UV nếu >= 50k tris (như 2 file mẫu). KHÔNG
       còn chặn cứng ở >50k nữa: chỉ chặn khi prepare không cứu được. */
    const MSE = PixiStudio.MixamoSafeExport;
    let prepared = null;
    if (MSE && typeof MSE.prepare === 'function') {
      prepared = MSE.prepare(out);
      if (!prepared.group) {
        notify('error', 'Mixamo-safe', 'Không xuất được file Mixamo: ' + prepared.report.errors.join('; '));
        return Promise.resolve(null);
      }
    } else {
      const t0 = countTris(out).tris;
      prepared = { group: out, report: { trisBefore: t0, trisAfter: t0, decimated: false, warnings: [] } };
    }

    /* Pre-flight trên đúng nhóm SẼ xuất (mesh-only, đã chuẩn bị) */
    let validation = null;
    if (V) {
      validation = V.check(prepared.group, { mode: 'mesh-only' });
      if (!validation.ok) {
        notify('error', 'Mixamo Pre-flight', 'Model chưa đủ điều kiện upload Mixamo: ' + validation.errors.join('; '));
        return Promise.resolve(null);
      }
    }

    const tex = hasTexture(out);
    return waitForTextures(out, 8000).then(function (tx) {
      let res;
      try {
        res = W.write(prepared.group, {
          version: 7300,              /* FBX 2013 — Mixamo chỉ nhận ≤ 2013 */
          keepSkeleton: false,        /* mesh-only — Mixamo tự auto-rig */
          noSkeleton: true,
          prepareMixamo: true,
          upAxis: 'Y',
          autoScale: true,
          embedTextures: tex         /* chỉ nhúng khi model có texture */
        });
      } catch (e) {
        notify('error', 'Export FBX lỗi', String(e && e.message || e));
        return null;
      }
      const warn = [];
      if (validation) warn.push.apply(warn, validation.warnings || []);
      warn.push.apply(warn, prepared.report.warnings || []);
      if (!res.report.textures && tx.total) warn.push('texture chưa decode xong (' + tx.ready + '/' + tx.total + ') — file sẽ KHÔNG có màu');
      return { bytes: res.bytes, report: res.report, filename: filename, validation: validation, warnings: warn, exportGroup: prepared.group, hasTexture: tex, built: !!built, mixamoSafe: prepared.report };
    });
  };

  /* Xuất + tải file về (browser). Harness dùng buildExportBytes thay vì hàm này. */
  RigOneClick.exportRiggedFBX = function (target, modelName) {
    return RigOneClick.buildExportBytes(target, modelName).then(function (r) {
      if (!r) return null;
      const blob = new Blob([r.bytes], { type: 'application/octet-stream' });
      U.downloadBlob(blob, r.filename);
      const ms = r.mixamoSafe || {};
      notify(r.warnings.length ? 'warning' : 'success', 'Export Mixamo xong',
        r.report.meshes + ' mesh · mesh-only · ' + (ms.trisBefore != null ? ms.trisBefore + ' → ' : '') + (ms.trisAfter != null ? ms.trisAfter : '?') + ' tam giác · ' +
        r.report.textures + ' texture nhúng · ' + U.formatBytes(r.bytes) +
        ' — Mixamo tự auto-rig; upload Mixamo: Characters → Upload Character.' +
        (r.warnings.length ? ' LƯU Ý: ' + r.warnings.join('; ') : ''), 15000);
      bus.emit('rig:exported', { filename: r.filename, bytes: r.bytes.length, bones: r.report.bones });
      return r;
    });
  };

  /* ============================================================
     UI — section "Rig 1 Lượt" trong Rig panel (rig-page-body).
     Render lại an toàn khi đang chạy: giữ nguyên step log hiện tại.
     ============================================================ */
  RigOneClick.renderPanel = function () {
    const body = document.getElementById('rig-page-body');
    if (!body || !window.THREE) return;
    const old = document.getElementById('rig-oneclick-section');
    if (old) old.remove();

    const section = U.el('div', { class: 'section-block', id: 'rig-oneclick-section' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('wand') }),
        U.el('span', { text: '⚡ Rig 1 Lượt — kiểu Meshy (Local, không cần key)' })
      ])
    ]);
    const sc = U.el('div', { class: 'section-content' });
    sc.appendChild(U.el('div', { class: 'dim small', style: 'line-height:1.5;margin-bottom:8px;', text: 'Một cú nhấp chạy hết: nhận diện loại → căn chỉnh → marker khớp → dựng skeleton → skinning → QA → Export FBX 2013. Chạy local 100%, không tốn credit Meshy. Rig trong viewport: 23 xương (+20 ngón tay); Export FBX dùng khung 65 xương chuẩn Mixamo.' }));

    /* ---- Loại nhân vật + template ---- */
    const row1 = U.el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;' });
    const typeSel = U.el('select', { class: 'select', style: 'flex:1;min-width:150px;' });
    Object.keys(RigOneClick.TYPES).forEach(function (k) {
      typeSel.appendChild(U.el('option', { value: k, text: RigOneClick.TYPES[k].label }));
    });
    typeSel.value = (RigOneClick.lastOpts && RigOneClick.lastOpts.type) || 'auto';
    row1.appendChild(typeSel);
    const tplSel = U.el('select', { class: 'select', style: 'flex:1;min-width:150px;' });
    Object.keys(RigOneClick.TEMPLATES).forEach(function (k) {
      tplSel.appendChild(U.el('option', { value: k, text: RigOneClick.TEMPLATES[k].label }));
    });
    tplSel.value = (RigOneClick.lastOpts && RigOneClick.lastOpts.template) || 'mixamo';
    row1.appendChild(tplSel);
    sc.appendChild(row1);

    /* ---- Align: height + rotate + offset ---- */
    const row2 = U.el('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px;align-items:center;' });
    row2.appendChild(U.el('span', { class: 'dim small', text: 'Cao (m)' }));
    const heightIn = U.el('input', { type: 'number', class: 'input', min: '0.2', max: '5', step: '0.1', value: String((RigOneClick.lastOpts && RigOneClick.lastOpts.heightM) || RigOneClick.DEFAULT_HEIGHT_M), style: 'width:64px;' });
    row2.appendChild(heightIn);
    row2.appendChild(U.el('span', { class: 'dim small', text: 'Xoay' }));
    const rotSel = U.el('select', { class: 'select', style: 'width:64px;' });
    ['0', '90', '180', '270'].forEach(function (d) { rotSel.appendChild(U.el('option', { value: d, text: d + '°' })); });
    rotSel.value = String((RigOneClick.lastOpts && RigOneClick.lastOpts.rotateY) || 0);
    row2.appendChild(rotSel);
    row2.appendChild(U.el('span', { class: 'dim small', text: 'Offset X/Z' }));
    const offX = U.el('input', { type: 'number', class: 'input', step: '0.1', value: '0', style: 'width:56px;' });
    const offZ = U.el('input', { type: 'number', class: 'input', step: '0.1', value: '0', style: 'width:56px;' });
    row2.appendChild(offX); row2.appendChild(offZ);
    sc.appendChild(row2);

    /* ---- Marker grid (% chiều cao) ---- */
    const curM = (PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.markers) || (PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.MARKERS_DEFAULT) || {};
    const markerGrid = U.el('div', { style: 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin-bottom:6px;' });
    const markerInputs = {};
    RigOneClick.MARKER_DEFS.forEach(function (md) {
      const cell = U.el('div', { style: 'min-width:0;' });
      cell.appendChild(U.el('div', { class: 'dim small', text: md[1] + ' %' }));
      const inp = U.el('input', { type: 'number', class: 'input', min: '0', max: '100', step: '1', value: String(Math.round(((curM[md[0]] != null ? curM[md[0]] : 0.5)) * 100)), style: 'width:100%;' });
      markerInputs[md[0]] = inp;
      cell.appendChild(inp);
      markerGrid.appendChild(cell);
    });
    sc.appendChild(markerGrid);
    const optRow = U.el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;align-items:center;' });
    const symChk = U.el('input', { type: 'checkbox', checked: true });
    const symLbl = U.el('label', { class: 'dim small' });
    symLbl.appendChild(symChk); symLbl.appendChild(document.createTextNode(' Symmetry (mirror 2 bên)'));
    const finChk = U.el('input', { type: 'checkbox' });
    const finLbl = U.el('label', { class: 'dim small' });
    finLbl.appendChild(finChk); finLbl.appendChild(document.createTextNode(' Fingers (+20 xương ngón tay)'));
    optRow.appendChild(symLbl); optRow.appendChild(finLbl);
    const resetBtn = U.el('button', {
      class: 'btn sm', text: '↺ Reset marker',
      onclick: function () {
        const d = (PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.MARKERS_DEFAULT) || {};
        RigOneClick.MARKER_DEFS.forEach(function (md) { if (markerInputs[md[0]]) markerInputs[md[0]].value = String(Math.round((d[md[0]] || 0.5) * 100)); });
      }
    });
    optRow.appendChild(resetBtn);
    sc.appendChild(optRow);

    function readMarkers() {
      const m = {};
      RigOneClick.MARKER_DEFS.forEach(function (md) {
        m[md[0]] = Math.max(0, Math.min(1, (parseFloat(markerInputs[md[0]].value) || 0) / 100));
      });
      return m;
    }
    function readOpts() {
      return {
        type: typeSel.value,
        template: tplSel.value,
        heightM: parseFloat(heightIn.value) || RigOneClick.DEFAULT_HEIGHT_M,
        rotateY: parseFloat(rotSel.value) || 0,
        offsetX: parseFloat(offX.value) || 0,
        offsetZ: parseFloat(offZ.value) || 0,
        fingers: finChk.checked,
        symmetry: symChk.checked,
        markers: readMarkers(),
        onStep: paintStep,
        onDone: function () { RigOneClick.renderPanel(); }
      };
    }

    /* ---- Step log + kết quả ---- */
    const stepsDiv = U.el('div', { id: 'rig-oneclick-steps', class: 'dim small', style: 'line-height:1.7;margin-bottom:6px;' });
    const resultDiv = U.el('div', { id: 'rig-oneclick-result', class: 'dim small', style: 'line-height:1.6;margin-bottom:8px;' });
    let exportBtn = null;
    const ICON = { pending: '⬜', running: '⏳', done: '✅', warn: '⚠️', fail: '❌' };
    function paintSteps() {
      const steps = (RigOneClick.lastResult && RigOneClick.lastResult.steps) || [];
      stepsDiv.innerHTML = '';
      steps.forEach(function (s) {
        stepsDiv.appendChild(U.el('div', { html: (ICON[s.status] || '⬜') + ' <b>' + s.label + '</b>' + (s.detail ? ' — ' + s.detail : '') }));
      });
    }
    function paintStep() { paintSteps(); }
    function paintResult() {
      const r = RigOneClick.lastResult;
      resultDiv.innerHTML = '';
      if (!r) { resultDiv.textContent = 'Chưa rig — bấm "Rig 1 Lượt" để chạy pipeline.'; return; }
      const lines = [];
      lines.push((r.ok ? '✅ Rig xong: ' : '❌ Rig chưa xong: ') + r.boneCount + ' xương viewport · khung xuất ' + (r.mixamoBones || '?') + ' xương Mixamo · ' + r.skinnedMeshes + ' mesh đã skin · cao ' + (r.height ? r.height.toFixed(2) : '?') + 'm · ' + r.tris + ' tris');
      (r.warnings || []).forEach(function (w) { lines.push('⚠️ ' + w); });
      (r.errors || []).forEach(function (e) { lines.push('❌ ' + e); });
      lines.forEach(function (t) { resultDiv.appendChild(U.el('div', { text: t })); });
      /* exportBtn chưa tạo xong khi renderPanel chạy lần đầu — guard. */
      if (exportBtn) exportBtn.disabled = !r.exportReady;
    }
    paintSteps();
    paintResult();
    sc.appendChild(stepsDiv);
    sc.appendChild(resultDiv);

    /* ---- Nút hành động ---- */
    const btns = U.el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' });
    btns.appendChild(U.el('button', {
      class: 'btn primary grow', text: '⚡ Rig 1 Lượt',
      onclick: function () {
        stepsDiv.innerHTML = '⏳ Đang chạy pipeline…';
        resultDiv.innerHTML = '';
        RigOneClick.runOneClick(null, readOpts()).then(function () { paintSteps(); paintResult(); });
      }
    }));
    btns.appendChild(U.el('button', {
      class: 'btn grow', text: '🔁 Rig lại',
      onclick: function () {
        stepsDiv.innerHTML = '⏳ Đang rig lại với marker mới…';
        RigOneClick.reRig(null, readOpts()).then(function () { paintSteps(); paintResult(); });
      }
    }));
    exportBtn = U.el('button', {
      class: 'btn success grow', text: '📥 Export Mixamo (mesh-only, Mixamo tự rig)',
      onclick: function () {
        exportBtn.disabled = true;
        exportBtn.textContent = '⏳ Đang xuất FBX…';
        RigOneClick.exportRiggedFBX(null).then(function (r) {
          exportBtn.disabled = !r;
          exportBtn.textContent = '📥 Export Mixamo (mesh-only, Mixamo tự rig)';
          if (r) RigOneClick.renderPanel();
        });
      }
    });
    exportBtn.disabled = !(RigOneClick.lastResult && RigOneClick.lastResult.exportReady);
    btns.appendChild(exportBtn);
    sc.appendChild(btns);
    sc.appendChild(U.el('div', { class: 'dim small', style: 'line-height:1.5;margin-top:6px;', text: 'Export: FBX 2013 (version 7300) · mesh-only < 50k tris (Mixamo tự auto-rig, giống file Thiếu Lâm/Thần Điêu đã sửa) · Y-up · nhúng texture nếu model có màu · tự giảm tris giữ UV khi cần. Khung xương 65 xương vẫn giữ trong scene để làm animation, không xuất ra file. Upload file lên https://www.mixamo.com → Characters → Upload Character.' }));

    section.appendChild(sc);
    body.insertBefore(section, body.firstChild);
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.RigOneClick = RigOneClick;
})();
