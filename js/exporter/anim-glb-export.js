/* ============================================================
 * exporter/anim-glb-export.js — EXPORT GLB KÈM ANIMATION (Meshy-style)
 * Mục tiêu: model import vào (dù chưa có rig) → tự rig + auto-skin →
 * gắn bộ chuyển động đặt sẵn (Idle/Walk/Run/Attack/Combo/Dodge…) →
 * xuất 1 file .glb chứa skeleton + skin + animation clips, tải về dùng
 * được ở Blender/Unity/Meshy/three.js (giống FBX animated của Meshy).
 *
 * Ghi chú kỹ thuật quan trọng:
 *  • Bản GLTFExporter examples/js của three r128 có chữ ký
 *    parse( input, onDone, options ) — KHÔNG có tham số onError.
 *    Truyền sai (onError ở vị trí 3) ⇒ options.binary và options.animations
 *    bị bỏ qua ⇒ file .glb chỉ là JSON và KHÔNG có animation.
 *  • GLTFExporter chỉ ghi animation cho node tìm thấy theo tên track;
 *    nếu 1 track không resolve được thì CẢ CLIP bị bỏ. Vì vậy mọi track
 *    đều đi qua mapClip() để retarget tên bone (mixamorig:Hips ↔ Hips…)
 *    trước khi export.
 *  • Mesh visual của bone (octahedron/joint sphere) + SkeletonHelper được
 *    ẩn đi trong lúc export (options.onlyVisible = true) để file sạch.
 * ============================================================ */
(function () {
  'use strict';

  const bus = PixiStudio.bus;
  const U = PixiStudio.Utils;

  const AnimGLBExport = {
    lastReport: null,
    lastFileName: '',
    _busy: false,
    selected: {},          // id clip → true/false (UI)
    preset: 'Studio Humanoid',
    includeFbx: true,
    includeGlb: true
  };

  /* ============================================================
     1) ĐẢM BẢO RIG + SKIN
     ============================================================ */
  AnimGLBExport.ensureRig = function (target, preset) {
    const RigAutoGen = PixiStudio.RigAutoGen;
    if (!RigAutoGen) return null;
    let rig = RigAutoGen.current;
    if (!rig || rig.target !== target) {
      rig = RigAutoGen.generate(target, preset || AnimGLBExport.preset);
    } else if (!rig.skinnedCount) {
      /* rig có nhưng mesh còn rigid → bind để mesh thật sự cử động */
      try { RigAutoGen.bindSkin(target); } catch (e) { console.warn('[AnimGLBExport] bindSkin lỗi:', e); }
      rig = RigAutoGen.current;
    }
    return rig;
  };

  /* ============================================================
     2) RETARGET TÊN BONE + LỌC CLIP
     ============================================================ */
  function resolveNodeName(name, nodes) {
    if (!name) return null;
    if (nodes.has(name)) return name;
    const cands = [];
    /* mixamorig:Hips / mixamorigHips → Hips */
    if (/^mixamorig:?/i.test(name)) cands.push(name.replace(/^mixamorig:?/i, ''));
    /* Hips → mixamorig:Hips / mixamorigHips */
    cands.push('mixamorig:' + name, 'mixamorig' + name);
    /* Spine1/Spine2 → Spine (rig ta chỉ có Spine/Chest) */
    cands.push(name.replace(/\d+$/, ''));
    /* left_arm / Left_Arm → LeftArm */
    cands.push(name.replace(/[_\-]/g, ''));
    for (let i = 0; i < cands.length; i++) {
      if (nodes.has(cands[i])) return cands[i];
    }
    /* tìm không phân biệt hoa/thường */
    const lower = name.toLowerCase().replace(/^mixamorig:?/, '');
    let found = null;
    nodes.forEach(function (n) {
      if (!found && n.toLowerCase() === lower) found = n;
    });
    return found;
  }

  /* Map 1 clip sang tên bone có trong graph export; trả null nếu không dùng được */
  function mapClip(clip, nodes, label) {
    if (!clip || !clip.tracks || !clip.tracks.length) return null;
    const tracks = [];
    let dropped = 0;
    clip.tracks.forEach(function (t) {
      const dot = t.name.lastIndexOf('.');
      const nodeName = dot > 0 ? t.name.slice(0, dot) : '';
      const prop = dot > 0 ? t.name.slice(dot) : '';
      const resolved = resolveNodeName(nodeName, nodes);
      if (!resolved || !prop) { dropped++; return; }
      if (resolved === nodeName) { tracks.push(t); return; }
      const clone = t.clone();
      clone.name = resolved + prop;
      tracks.push(clone);
    });
    if (!tracks.length) return null;
    /* yêu cầu tối thiểu: phải có bone gốc (hips/root) + ≥4 track → clip mới cử động được */
    const hasRoot = tracks.some(function (t) { return /hips|pelvis|root/i.test(t.name); });
    if (tracks.length < 4 || !hasRoot) return null;
    return {
      clip: new THREE.AnimationClip(clip.name || label || 'Clip', clip.duration, tracks),
      mapped: tracks.length,
      total: clip.tracks.length,
      dropped: dropped
    };
  }

  /* ============================================================
     3) THU THẬP CLIPS (Auto Gen + FBX + clip có sẵn trong model)
     ============================================================ */
  AnimGLBExport.collectClips = function (target, opts) {
    opts = opts || {};
    const nodes = new Set();
    target.traverse(function (o) { if (o.name) nodes.add(o.name); });

    const out = { clips: [], skipped: [], nodeCount: nodes.size };
    const wanted = opts.ids || null;
    const push = function (id, name, clip, source, loop) {
      if (wanted && wanted.indexOf(id) === -1) return;
      const mapped = mapClip(clip, nodes, name);
      if (!mapped) {
        out.skipped.push({ id: id, name: name, source: source, reason: 'không map được bone nào (thiếu Hips/Root)' });
        return;
      }
      mapped.clip.name = name;   /* tên clip trong file GLB — rõ nguồn, tránh trùng tên */
      out.clips.push({
        id: id, name: name, source: source, loop: loop !== false,
        clip: mapped.clip, mapped: mapped.mapped, total: mapped.total
      });
    };

    /* a) Auto Gen clips (rig hiện tại — luôn khớp tên bone) */
    const rig = PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current;
    if (rig && rig.target === target && rig.clips && rig.clips.length) {
      rig.clips.forEach(function (c) { push(c.id, c.id, c.clip, 'autogen', c.loop); });
    }

    /* b) FBX clips (Meshy Running/Idle/Attack) — retarget theo tên bone */
    if (opts.includeFbx !== false && PixiStudio.FbxRig && PixiStudio.FbxRig.loaded && PixiStudio.FbxRig.generated.length) {
      PixiStudio.FbxRig.generated.forEach(function (c) {
        push('fbx-' + c.id, c.id + ' (FBX)', c.clip, 'fbx', c.loop);
      });
    }

    /* c) Clip có sẵn trong GLB đã import */
    if (opts.includeGlb !== false) {
      const entry = PixiStudio.Models && PixiStudio.Models.getCurrent ? PixiStudio.Models.getCurrent() : null;
      if (entry && entry.clips && entry.clips.length) {
        entry.clips.forEach(function (c, i) { push('glb-' + i, c.name || ('Clip' + i), c, 'glb', true); });
      }
    }

    return out;
  };

  /* ============================================================
     4) CHUYỂN ATTRIBUTE SANG FLOAT32 (GLTFExporter r128 dễ sai với
        Int8/Uint16 normalized — model meshopt thường bị vậy)
     ============================================================ */
  function denorm(v, arr) {
    if (arr instanceof Int8Array) return Math.max(v / 127, -1);
    if (arr instanceof Uint8Array) return v / 255;
    if (arr instanceof Int16Array) return Math.max(v / 32767, -1);
    if (arr instanceof Uint16Array) return v / 65535;
    return v;
  }

  function toFloat32Attributes(root) {
    const changed = [];
    const SKIP = { skinIndex: 1, skinWeight: 1 };   /* 2 attribute này giữ nguyên kiểu chuẩn glTF */
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry;
      Object.keys(g.attributes).forEach(function (key) {
        if (SKIP[key]) return;
        const a = g.attributes[key];
        if (a.array instanceof Float32Array && !a.normalized) return;
        const size = a.itemSize;
        const out = new Float32Array(a.count * size);
        for (let i = 0; i < a.count; i++) {
          for (let c = 0; c < size; c++) {
            const raw = c === 0 ? a.getX(i) : c === 1 ? a.getY(i) : c === 2 ? a.getZ(i) : a.getW(i);
            out[i * size + c] = a.normalized ? denorm(raw, a.array) : raw;
          }
        }
        g.setAttribute(key, new THREE.BufferAttribute(out, size));
        changed.push(key + ':' + a.array.constructor.name + '→Float32');
      });
    });
    return changed;
  }

  /* ============================================================
     4b) DÙNG TEXTURE GỐC FULL-RES KHI EXPORT
     Texture display đã bị downscale (Texture Safe Mode ≤512) cho nhẹ GPU;
     ảnh gốc vẫn nằm ở tex.userData.originalImage → tạm đổi sang ảnh gốc trong
     lúc ghi GLB rồi trả lại (nếu không, file xuất ra bị mờ/màu khác file gốc).
     ============================================================ */
  function swapFullResTextures(root) {
    const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'];
    const swapped = [];
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (mat) {
        if (!mat) return;
        slots.forEach(function (slot) {
          const tex = mat[slot];
          if (!tex) return;
          const rec = { tex: tex, image: tex.image, format: tex.format };
          let changed = false;
          /* 1) dùng ảnh GỐC full-res thay vì bản 512 hiển thị */
          if (tex.userData && tex.userData.originalImage && tex.image !== tex.userData.originalImage) {
            tex.image = tex.userData.originalImage;
            changed = true;
          }
          /* 2) normal map KHÔNG được ghi JPEG (chroma subsampling phá dự liệu normal)
                → ép RGBAFormat để GLTFExporter ghi PNG lossless */
          if (slot === 'normalMap' && tex.format !== THREE.RGBAFormat) {
            tex.format = THREE.RGBAFormat;
            changed = true;
          }
          if (changed) {
            tex.needsUpdate = true;
            swapped.push(rec);
          }
        });
      });
    });
    return {
      count: swapped.length,
      restore: function () {
        swapped.forEach(function (s) {
          s.tex.image = s.image;
          s.tex.format = s.format;
          s.tex.needsUpdate = true;
        });
      }
    };
  }

  /* ============================================================
     4c) GIỮ EXTENSION MATERIAL CỦA FILE GỐC (KHR_materials_specular…)
     GLTFLoader r128 bỏ qua extension lạ nên material trong scene không còn dữ liệu
     đó → đọc lại JSON của file nguồn, gắn vào userData.gltfExtensions để
     GLTFExporter ghi kèm (includeCustomExtensions = true).
     ============================================================ */
  AnimGLBExport.preserveSourceMaterialExtensions = function (target) {
    const entry = PixiStudio.Models && PixiStudio.Models.getCurrent ? PixiStudio.Models.getCurrent() : null;
    const url = entry && entry.url;
    if (!url) return Promise.resolve({ count: 0, names: [] });
    return fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      let json = null;
      try { json = AnimGLBExport.readGLBJson(buf); } catch (e) { return { count: 0, names: [] }; }
      const byName = {};
      (json.materials || []).forEach(function (m) {
        if (m && m.name && m.extensions) byName[m.name] = m.extensions;
      });
      let count = 0; const names = [];
      target.traverse(function (o) {
        if (!o.isMesh || !o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (mat) {
          if (!mat || !byName[mat.name]) return;
          mat.userData = mat.userData || {};
          mat.userData.gltfExtensions = JSON.parse(JSON.stringify(byName[mat.name]));
          count++;
          Object.keys(byName[mat.name]).forEach(function (k) { if (names.indexOf(k) === -1) names.push(k); });
        });
      });
      return { count: count, names: names };
    }).catch(function () { return { count: 0, names: [] }; });
  };

  /* ============================================================
     5) BUILD GLB (binary + animations)
     ============================================================ */
  /* GLTF skinned mesh không nên phụ thuộc parent scale. Model trong Studio
     thường được normalize bằng scale=2 và rig root bù scale=0.5; GLTFExporter
     đưa cả hai transform vào skin nên file mở lại bị phóng đại. Bản helper này
     bake scale đồng nhất vào position, export với root scale=1, rồi restore. */
  function flattenExportScale(root) {
    const s = root && root.scale ? root.scale.x : 1;
    if (!root || !isFinite(s) || Math.abs(s - 1) < 1e-6) return function () {};
    const records = [];
    const groups = [];
    root.traverse(function (o) {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position &&
          !(o.userData && o.userData.isBoneVisual)) {
        const pa = o.geometry.attributes.position;
        records.push({ o: o, data: Float32Array.from(pa.array) });
        for (let i = 0; i < pa.array.length; i++) pa.array[i] *= s;
        pa.needsUpdate = true;
        o.geometry.computeBoundingBox();
        o.geometry.computeBoundingSphere();
      }
      if (o !== root && o.name === '__autogen_rig__') {
        groups.push({ o: o, scale: o.scale.clone() });
        o.scale.set(1, 1, 1);
      }
    });
    const rootScale = root.scale.clone();
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    root.traverse(function (o) {
      if (o.isSkinnedMesh && o.skeleton) {
        o.skeleton.calculateInverses();
        o.bind(o.skeleton, o.matrixWorld);
      }
    });
    return function restore() {
      records.forEach(function (r) {
        const pa = r.o.geometry.attributes.position;
        pa.array.set(r.data);
        pa.needsUpdate = true;
        r.o.geometry.computeBoundingBox();
        r.o.geometry.computeBoundingSphere();
      });
      groups.forEach(function (g) { g.o.scale.copy(g.scale); });
      root.scale.copy(rootScale);
      root.updateMatrixWorld(true);
      root.traverse(function (o) {
        if (o.isSkinnedMesh && o.skeleton) {
          o.skeleton.calculateInverses();
          o.bind(o.skeleton, o.matrixWorld);
        }
      });
    };
  }

  AnimGLBExport.buildGLB = function (target, clips, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (!window.THREE || !THREE.GLTFExporter) { reject(new Error('GLTFExporter chưa load (kiểm tra CDN)')); return; }

      const flattenScale = flattenExportScale(target);

      /* ẩn mesh visual của bone + SkeletonHelper để file sạch (onlyVisible = true) */
      const hidden = [];
      target.traverse(function (o) {
        if (!o.visible) return;
        if ((o.userData && o.userData.isBoneVisual) || o.isLineSegments || o.isSkeletonHelper) {
          o.visible = false;
          hidden.push(o);
        }
      });
      const restore = function () { hidden.forEach(function (o) { o.visible = true; }); };

      const attrChanged = toFloat32Attributes(target);
      /* đổi sang texture gốc full-res trong lúc ghi file */
      const texFull = swapFullResTextures(target);
      const exporter = new THREE.GLTFExporter();

      const restoreAll = function () { restore(); texFull.restore(); flattenScale(); };

      const done = function (result) {
        restoreAll();
        if (!(result instanceof ArrayBuffer)) {
          reject(new Error('GLTFExporter trả về ' + Object.prototype.toString.call(result) +
            ' thay vì ArrayBuffer — options phải là tham số thứ 3: parse(input, onDone, options)'));
          return;
        }
        resolve({ buffer: result, hiddenCount: hidden.length, attrChanged: attrChanged, texFullRes: texFull.count });
      };

      try {
        exporter.parse(target, done, {
          binary: true,
          animations: clips.map(function (c) { return c.clip; }),
          onlyVisible: true,
          embedImages: true,
          truncateDrawRange: true,
          includeCustomExtensions: true   /* giữ KHR_materials_specular… của file gốc */
        });
      } catch (err) {
        restoreAll();
        reject(err);
      }
    });
  };

  /* Đọc JSON chunk trong GLB (không cần loader) */
  AnimGLBExport.readGLBJson = function (buffer) {
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('Không phải file GLB (magic sai)');
    const jsonLen = dv.getUint32(12, true);
    const text = new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen));
    return JSON.parse(text);
  };

  /* Tính vị trí world của 1 vertex đã skin — công thức đúng như shader three.js:
     world = Σ w_k * (boneMatrix_k * (bindMatrix * v_local)) với boneMatrix = bone.matrixWorld * inverseBind
     Dùng để CHỨNG MINH mesh thật sự biến dạng khi phát clip (không chỉ bone di chuyển). */
  function sampleSkinnedWorld(mesh, idx, out) {
    const g = mesh.geometry;
    const pos = g.attributes.position, sw = g.attributes.skinWeight, si = g.attributes.skinIndex;
    const v = new THREE.Vector3().fromBufferAttribute(pos, idx).applyMatrix4(mesh.bindMatrix);
    const m = new THREE.Matrix4();
    const tmp = new THREE.Vector3();
    out.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = sw.array[idx * 4 + k];
      if (!w) continue;
      m.fromArray(mesh.skeleton.boneMatrices, si.array[idx * 4 + k] * 16);
      tmp.copy(v).applyMatrix4(m);
      out.addScaledVector(tmp, w);
    }
    return out;
  }

  /* ============================================================
     6) VERIFY — load lại file bằng GLTFLoader THUẦN (không decoder,
        mô phỏng đúng hành vi Blender/Unity/Meshy) + đo bone có cử động
     ============================================================ */
  AnimGLBExport.verifyGLB = function (buffer) {
    return new Promise(function (resolve) {
      let json = null;
      try { json = AnimGLBExport.readGLBJson(buffer); } catch (e) { resolve({ ok: false, error: e.message }); return; }
      if (!THREE.GLTFLoader) { resolve({ ok: false, error: 'GLTFLoader chưa load', json: json }); return; }

      const report = {
        ok: true, json: {
          animations: (json.animations || []).length,
          skins: (json.skins || []).length,
          nodes: (json.nodes || []).length,
          meshes: (json.meshes || []).length,
          materials: (json.materials || []).length,
          images: (json.images || []).length,
          extensionsRequired: json.extensionsRequired || [],
          extensionsUsed: json.extensionsUsed || [],
          leakedVisuals: (json.nodes || []).filter(function (n) { return /octa|sphere|joint|skeleton|helper/i.test(n.name || ''); }).length
        },
        animations: [], skinnedMeshes: 0, meshes: 0, bones: 0, motion: null
      };

      const loader = new THREE.GLTFLoader();
      loader.parse(buffer.slice(0), '', function (gltf) {
        gltf.scene.traverse(function (o) {
          if (o.isSkinnedMesh) report.skinnedMeshes++;
          if (o.isMesh) report.meshes++;
          if (o.isBone) report.bones++;
        });
        /* kích cỡ thật của model trong file (phải khớp model gốc ~2 đơn vị cao) */
        gltf.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        if (!box.isEmpty()) {
          const size = box.getSize(new THREE.Vector3());
          report.size = { x: Math.round(size.x * 1e3) / 1e3, y: Math.round(size.y * 1e3) / 1e3, z: Math.round(size.z * 1e3) / 1e3 };
        }
        (gltf.animations || []).forEach(function (c) {
          report.animations.push({ name: c.name, duration: Math.round(c.duration * 100) / 100, tracks: c.tracks.length });
        });

        /* đo chuyển động THẬT: phát clip đầu, theo dõi bone ở tay/đầu */
        if (gltf.animations.length && report.bones) {
          const mixer = new THREE.AnimationMixer(gltf.scene);
          mixer.clipAction(gltf.animations[0]).play();
          let probe = null;
          gltf.scene.traverse(function (o) {
            if (!probe && o.isBone && /hand|arm|head|hips/i.test(o.name)) probe = o;
          });
          if (probe) {
            const v = new THREE.Vector3();
            let min = Infinity, max = -Infinity;
            for (let i = 0; i < 120; i++) {
              mixer.update(1 / 60);
              gltf.scene.updateMatrixWorld(true);
              v.setFromMatrixPosition(probe.matrixWorld);
              if (v.y < min) min = v.y;
              if (v.y > max) max = v.y;
            }
            report.motion = { clip: gltf.animations[0].name, bone: probe.name, rangeY: Math.round((max - min) * 10000) / 10000 };
          }

          /* ĐO BIẾN DẠNG THẬT của mesh: so vị trí vertex đã skin ở 2 thời điểm khác nhau */
          let skinMesh = null;
          gltf.scene.traverse(function (o) { if (!skinMesh && o.isSkinnedMesh) skinMesh = o; });
          if (skinMesh && gltf.animations.length) {
            const mixer2 = new THREE.AnimationMixer(gltf.scene);
            const act = mixer2.clipAction(gltf.animations[0]);
            act.play();
            mixer2.update(0.01);
            gltf.scene.updateMatrixWorld(true);
            skinMesh.skeleton.update();   /* boneMatrices chỉ được tính khi gọi update() */
            const count = skinMesh.geometry.attributes.position.count;
            const step = Math.max(1, Math.floor(count / 200));
            const before = [];
            const tv = new THREE.Vector3();
            for (let i = 0; i < count; i += step) before.push(sampleSkinnedWorld(skinMesh, i, new THREE.Vector3()).clone());
            mixer2.update(0.35);
            gltf.scene.updateMatrixWorld(true);
            skinMesh.skeleton.update();
            let maxD = 0, moved = 0;
            for (let i = 0, j = 0; i < count; i += step, j++) {
              const now = sampleSkinnedWorld(skinMesh, i, tv);
              const d = now.distanceTo(before[j]);
              if (d > maxD) maxD = d;
              if (d > 0.002) moved++;
            }
            report.deform = {
              clip: gltf.animations[0].name,
              samples: before.length,
              movedVertices: moved,
              maxDelta: Math.round(maxD * 10000) / 10000
            };
          }
        }
        resolve(report);
      }, function (err) {
        resolve({ ok: false, error: String(err && err.message || err), json: report.json });
      });
    });
  };

  /* ============================================================
     7) LƯU FILE VỀ THƯ MỤC PROJECT (server) — tuỳ chọn
     ============================================================ */
  function saveToServer(blob, filename) {
    return fetch('/api/save-export', {
      method: 'POST',
      headers: { 'Content-Type': 'model/gltf-binary', 'X-Filename': filename },
      body: blob
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }

  /* ============================================================
     8) EXPORT NOW — chạy cả pipeline
     ============================================================ */
  AnimGLBExport.exportNow = function (opts) {
    opts = opts || {};
    if (AnimGLBExport._busy) {
      bus.emit('notify', { type: 'info', title: 'Đang export', message: 'Chờ lượt export hiện tại xong đã.' });
      return Promise.resolve(null);
    }
    const target = opts.target || PixiStudio.Viewport.getMainModel();
    if (!target) {
      bus.emit('notify', { type: 'warning', title: 'Export GLB + Animation', message: 'Chưa có model nào. Import model trước.' });
      return Promise.resolve(null);
    }

    AnimGLBExport._busy = true;
    PixiStudio.Notifications.showLoading('Export GLB + Animation — rig/skin/clips…', 5);

    return Promise.resolve()
      .then(function () {
        /* 1) rig + skin */
        const rig = AnimGLBExport.ensureRig(target, opts.preset || AnimGLBExport.preset);
        if (!rig) throw new Error('Không tạo được rig cho model');
        PixiStudio.Notifications.updateLoading(20, 'Đang gom animation clips…');

        /* 2) clips */
        const collected = AnimGLBExport.collectClips(target, {
          ids: opts.ids || null,
          includeFbx: opts.includeFbx !== undefined ? opts.includeFbx : AnimGLBExport.includeFbx,
          includeGlb: opts.includeGlb !== undefined ? opts.includeGlb : AnimGLBExport.includeGlb
        });
        if (!collected.clips.length) throw new Error('Không có clip nào map được vào skeleton của model');

        PixiStudio.Notifications.updateLoading(40, 'Đang ghi GLB (' + collected.clips.length + ' clip)…');
        /* giữ extension material của file nguồn (KHR_materials_specular…) rồi mới ghi */
        return AnimGLBExport.preserveSourceMaterialExtensions(target).then(function (ext) {
          return AnimGLBExport.buildGLB(target, collected.clips, opts).then(function (built) {
            built.sourceExtensions = ext;
            return { rig: rig, collected: collected, built: built };
          });
        });
      })
      .then(function (r) {
        PixiStudio.Notifications.updateLoading(70, 'Verify file bằng GLTFLoader thuần…');
        const blob = new Blob([r.built.buffer], { type: 'model/gltf-binary' });
        const base = (target.name || 'model').replace(/[^\w\-]+/g, '_');
        const fileName = base + '_animated_' + r.collected.clips.length + 'clips.glb';

        return AnimGLBExport.verifyGLB(r.built.buffer).then(function (report) {
          report.fileName = fileName;
          report.bytes = r.built.buffer.byteLength;
          report.bones = report.bones || (r.rig ? r.rig.boneCount : 0);
          report.skinnedBound = r.rig ? (r.rig.skinnedCount || 0) : 0;
          report.clips = r.collected.clips.map(function (c) {
            return c.name + ' (' + c.source + (c.mapped !== c.total ? ', retarget ' + c.mapped + '/' + c.total : '') + ')';
          });
          report.skipped = r.collected.skipped;
          report.hiddenVisuals = r.built.hiddenCount;
          report.attrChanged = r.built.attrChanged;
          report.texFullRes = r.built.texFullRes || 0;
          report.sourceExtensions = r.built.sourceExtensions || { count: 0, names: [] };
          AnimGLBExport.lastReport = report;
          AnimGLBExport.lastFileName = fileName;

          PixiStudio.Notifications.updateLoading(90, 'Đang tải file về…');
          U.downloadBlob(blob, fileName);
          return saveToServer(blob, fileName).then(function (saved) {
            report.savedTo = saved && saved.ok ? saved.path : null;
            return report;
          });
        });
      })
      .then(function (report) {
        AnimGLBExport._busy = false;
        PixiStudio.Notifications.hideLoading();
        const okAnim = report.ok && report.animations.length;
        bus.emit('notify', {
          type: okAnim ? 'success' : 'warning',
          title: okAnim ? '✅ GLB + Animation đã xuất' : '⚠️ GLB xuất nhưng verify có vấn đề',
          message: report.fileName + ' · ' + U.formatBytes(report.bytes) + ' · ' +
            (report.animations.length ? report.animations.length + ' clip [' + report.animations.map(function (a) { return a.name; }).join(', ') + ']' : 'KHÔNG có clip') +
            ' · ' + report.skinnedMeshes + ' skinned mesh · ' + report.bones + ' bone' +
            (report.size ? ' · cao ' + report.size.y + ' đơn vị' : '') +
            (report.deform ? ' · ' + report.deform.movedVertices + '/' + report.deform.samples + ' vertex biến dạng (max ' + report.deform.maxDelta + ')' : '') +
            (report.motion ? ' · bone "' + report.motion.bone + '" chuyển động ' + report.motion.rangeY + ' (verify thật)' : '') +
            (report.savedTo ? ' · đã lưu: ' + report.savedTo : ''),
          duration: 12000
        });
        if (AnimGLBExport.renderPanel) AnimGLBExport.renderPanel();
        return report;
      })
      .catch(function (err) {
        AnimGLBExport._busy = false;
        PixiStudio.Notifications.hideLoading();
        console.error('[AnimGLBExport] lỗi:', err);
        bus.emit('notify', { type: 'error', title: 'Export GLB + Animation lỗi', message: String(err && err.message || err) });
        return null;
      });
  };

  /* ============================================================
     9) UI — section trong Animation panel
     ============================================================ */
  AnimGLBExport.renderPanel = function () {
    const body = document.getElementById('animation-page-body');
    if (!body) return;
    const old = document.getElementById('anim-glb-export-section');
    if (old) old.remove();

    const target = PixiStudio.Viewport.getMainModel();
    const section = U.el('div', { class: 'section-block', id: 'anim-glb-export-section' }, [
      U.el('div', { class: 'section-head' }, [
        U.el('span', { html: U.icon('export') }),
        U.el('span', { text: '📦 Export GLB + Animation (giống Meshy Animate)' })
      ])
    ]);
    const sc = U.el('div', { class: 'section-content' });

    if (!target) {
      sc.appendChild(U.el('div', { class: 'empty-state', style: 'padding:10px;' }, [
        U.el('span', { text: 'Import model trước — export sẽ tự rig + skin + gắn chuyển động đặt sẵn rồi xuất .glb.' })
      ]));
      section.appendChild(sc);
      body.insertBefore(section, body.firstChild);
      return;
    }

    /* danh sách clip khả dụng */
    const available = AnimGLBExport.collectClips(target, { includeFbx: true, includeGlb: true });
    const rigReady = PixiStudio.RigAutoGen && PixiStudio.RigAutoGen.current && PixiStudio.RigAutoGen.current.target === target;

    sc.appendChild(U.el('div', { class: 'info-row' }, [
      U.el('span', { class: 'i-label', text: 'Rig' }),
      rigReady
        ? U.el('span', { class: 'state-badge ok', text: PixiStudio.RigAutoGen.current.boneCount + ' bones · ' + (PixiStudio.RigAutoGen.current.skinnedCount || 0) + ' mesh skin' })
        : U.el('span', { class: 'state-badge pending', text: 'chưa rig — sẽ tự tạo khi export' })
    ]));

    /* chọn preset rig */
    const pw = U.el('div', { class: 'select-wrap', style: 'margin:8px 0;' });
    const sel = U.el('select', { class: 'select' });
    [['Studio Humanoid', 'Rig: Studio Humanoid (Hips/Spine…)'], ['Mixamo Compatible', 'Rig: Mixamo Compatible (mixamorig:Hips…)']].forEach(function (o) {
      const opt = U.el('option', { value: o[0], text: o[1] });
      if (o[0] === AnimGLBExport.preset) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () { AnimGLBExport.preset = sel.value; });
    pw.appendChild(sel);
    sc.appendChild(pw);

    /* checklist clips */
    const clipBox = U.el('div', { style: 'max-height:150px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:8px;padding:6px;margin-bottom:8px;' });
    const ids = [];
    available.clips.forEach(function (c) {
      ids.push(c.id);
      if (AnimGLBExport.selected[c.id] === undefined) AnimGLBExport.selected[c.id] = true;
      const row = U.el('label', { style: 'display:flex;align-items:center;gap:7px;padding:4px 5px;border-radius:6px;font-size:12px;cursor:pointer;' });
      const cb = U.el('input', { type: 'checkbox' });
      cb.checked = AnimGLBExport.selected[c.id] !== false;
      cb.addEventListener('change', function () { AnimGLBExport.selected[c.id] = cb.checked; });
      row.appendChild(cb);
      row.appendChild(U.el('span', { text: c.name + ' · ' + Math.round(c.clip.duration * 100) / 100 + 's' }));
      row.appendChild(U.el('span', { class: 'dim small', style: 'margin-left:auto;', text: c.source + (c.mapped !== c.total ? ' ' + c.mapped + '/' + c.total : '') }));
      clipBox.appendChild(row);
    });
    if (!available.clips.length) {
      clipBox.appendChild(U.el('div', { class: 'dim small', style: 'padding:6px;', text: 'Chưa có clip — bấm Export để tự rig + sinh 6 chuyển động đặt sẵn (Idle/Walk/Run/Attack/Combo/Dodge).' }));
    }
    sc.appendChild(clipBox);

    if (available.skipped.length) {
      sc.appendChild(U.el('div', { class: 'dim small', style: 'margin-bottom:8px;', text: '⏭ Bỏ qua ' + available.skipped.length + ' clip không khớp bone: ' + available.skipped.map(function (s) { return s.name; }).join(', ') }));
    }

    /* nút export */
    sc.appendChild(U.el('button', {
      class: 'btn success lg block',
      style: 'margin-bottom:8px;',
      html: U.icon('export') + '&nbsp; 📦 Export GLB + Animation',
      onclick: function () {
        const selectedIds = ids.filter(function (id) { return AnimGLBExport.selected[id] !== false; });
        AnimGLBExport.exportNow({
          target: target,
          preset: AnimGLBExport.preset,
          ids: selectedIds.length ? selectedIds : null,
          includeFbx: AnimGLBExport.includeFbx,
          includeGlb: AnimGLBExport.includeGlb
        });
      }
    }));
    sc.appendChild(U.el('button', {
      class: 'btn sm block',
      style: 'margin-bottom:8px;',
      html: U.icon('wand') + ' ⚡ Rig + Skin + 6 chuyển động (không tải file)',
      onclick: function () {
        const rig = AnimGLBExport.ensureRig(target, AnimGLBExport.preset);
        if (rig) {
          bus.emit('notify', {
            type: 'success', title: '⚡ Rig + Skin xong',
            message: rig.boneCount + ' bones · ' + (rig.skinnedCount || 0) + ' mesh đã bind — mesh sẽ cử động theo animation.'
          });
          AnimGLBExport.renderPanel();
        }
      }
    }));

    /* báo cáo lần export gần nhất */
    const rep = AnimGLBExport.lastReport;
    if (rep) {
      sc.appendChild(U.el('div', {
        class: 'dim small', style: 'line-height:1.6;border-top:1px solid var(--border-soft);padding-top:8px;',
        html: '<b style="color:var(--success)">Lần export gần nhất:</b> ' + U.escapeHtml(rep.fileName) + '<br>' +
          '· ' + U.formatBytes(rep.bytes) + ' · ' + rep.animations.length + ' clip · ' + rep.skinnedMeshes + ' skinned mesh · ' + rep.bones + ' bone<br>' +
          (rep.texFullRes ? '· texture gốc full-res: <b>' + rep.texFullRes + '</b> ảnh (không dùng bản 512 hiển thị)<br>' : '') +
          (rep.sourceExtensions && rep.sourceExtensions.count ? '· giữ extension gốc: <b>' + U.escapeHtml(rep.sourceExtensions.names.join(', ')) + '</b><br>' : '') +
          (rep.motion ? '· verify: bone <b>' + U.escapeHtml(rep.motion.bone) + '</b> chuyển động ' + rep.motion.rangeY + ' khi phát "' + U.escapeHtml(rep.motion.clip) + '"<br>' : '') +
          (rep.savedTo ? '· file trong project: <b>' + U.escapeHtml(rep.savedTo) + '</b>' : '')
      }));
    }

    sc.appendChild(U.el('div', { class: 'dim small', style: 'margin-top:8px;line-height:1.5;', text: 'File .glb gồm: model + texture + skeleton + skin + các clip đã chọn (chuyển động đặt sẵn). Đọc được ở Blender / Unity / three.js / Meshy.' }));

    section.appendChild(sc);
    body.insertBefore(section, body.firstChild);
  };

  window.PixiStudio.AnimGLBExport = AnimGLBExport;
})();
