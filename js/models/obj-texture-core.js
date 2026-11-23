/* ============================================================
 * models/obj-texture-core.js — Pure helpers cho OBJ auto-texture.
 * KHÔNG phụ thuộc PixiStudio / DOM / FileReader → test được bằng Node.
 * Browser: window.PixiStudio.OBJTexture (load trước model-manager.js).
 * Node: module.exports (cần global.THREE = three r128).
 * ============================================================ */
(function (root, factory) {
  var api = factory(root.THREE);
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { root.PixiStudio = root.PixiStudio || {}; root.PixiStudio.OBJTexture = api; }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function (THREE) {
  'use strict';

  var IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
  /* map keys mà MTLLoader r128 xử lý (createMaterial_) */
  var MTL_MAP_KEYS = ['map_kd', 'map_ks', 'map_ke', 'norm', 'map_bump', 'bump', 'map_d'];
  /* slot màu → encoding sRGB (như code GLB) */
  var COLOR_SLOTS = ['map', 'emissiveMap'];
  var ALL_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'specularMap', 'alphaMap'];

  function lower(s) { return String(s || '').toLowerCase(); }
  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }
  /* basename của đường dẫn MTL (bỏ thư mục + option -s/-o + dấu ngoặc) */
  function basename(p) {
    if (!p) return '';
    var parts = String(p).trim().split(/\s+/);
    var last = parts[parts.length - 1] || '';
    last = last.replace(/^["']|["']$/g, '');
    return last.split('/').pop().split('\\').pop();
  }
  function isImageName(name) { return IMAGE_EXTS.indexOf(extOf(name)) >= 0; }

  /* ---------- parse OBJ text ---------- */
  function parseMtllib(objText) {
    var out = [];
    var re = /^mtllib[ \t]+(.+)$/gim, m;
    while ((m = re.exec(objText || '')) !== null) {
      var v = m[1].trim().replace(/^["']|["']$/g, '');
      if (v && out.indexOf(v) < 0) out.push(v);
    }
    return out;
  }
  function parseMaterialNames(objText) {
    var out = [];
    var re = /^usemtl[ \t]+(.+)$/gim, m;
    while ((m = re.exec(objText || '')) !== null) {
      var v = m[1].trim();
      if (v && out.indexOf(v) < 0) out.push(v);
    }
    return out;
  }

  /* ---------- phân loại ảnh theo hậu tố tên file ---------- */
  function classifyImage(fileName) {
    var base = String(fileName || '').replace(/\.[^.]+$/, '');
    var low = base.toLowerCase();
    var slot = 'map', suffix = '';
    var rules = [
      [/(?:_normal|_nrm|_norm|_n)$/, 'normalMap'],
      [/(?:_rough|_roughness|_rgh)$/, 'roughnessMap'],
      [/(?:_metal|_metallic|_metalness|_mt)$/, 'metalnessMap'],
      [/(?:_ao|_occlusion)$/, 'aoMap'],
      [/(?:_emissive|_emit|_emis)$/, 'emissiveMap'],
      [/(?:_bump)$/, 'bumpMap'],
      [/(?:_spec|_specular)$/, 'specularMap'],
      [/(?:_diffuse|_diff|_albedo|_basecolor|_base|_color|_col|_map|_d)$/, 'map']
    ];
    for (var i = 0; i < rules.length; i++) {
      var m = rules[i][0].exec(low);
      if (m) { slot = rules[i][1]; suffix = m[0]; break; }
    }
    return { slot: slot, base: suffix ? base.slice(0, base.length - suffix.length) : base };
  }

  /* ---------- khớp MTL + ảnh đi kèm ---------- */
  function resolveCompanions(opts) {
    opts = opts || {};
    var objText = opts.objText || '';
    var objName = opts.objName || 'model';
    var available = opts.availableNames || [];
    var byLower = {}, byBaseLower = {};
    available.forEach(function (n) {
      byLower[lower(n)] = n;
      byBaseLower[lower(basename(n))] = n;
    });

    /* (1) MTL: mtllib trong OBJ trước, rồi cùng tên file */
    var mtl = null;
    parseMtllib(objText).forEach(function (ref) {
      if (mtl) return;
      var hit = byBaseLower[lower(basename(ref))] || byLower[lower(ref)];
      if (hit) mtl = hit;
    });
    if (!mtl && byLower[lower(objName) + '.mtl']) mtl = byLower[lower(objName) + '.mtl'];

    /* (2) ảnh theo tên material / tên model */
    var images = available.filter(isImageName);
    var mats = parseMaterialNames(objText);
    var classified = images.map(function (n) {
      var c = classifyImage(n);
      return { name: n, slot: c.slot, base: c.base };
    });
    function findImage(pred) {
      for (var i = 0; i < classified.length; i++) if (pred(classified[i])) return classified[i];
      return null;
    }
    var byMaterial = {};
    mats.forEach(function (mat) {
      var entry = {};
      ALL_SLOTS.forEach(function (slot) {
        var hit = findImage(function (c) { return c.slot === slot && lower(c.base) === lower(mat); });
        if (hit) entry[slot] = hit.name;
      });
      if (Object.keys(entry).length) byMaterial[mat] = entry;
    });
    /* ảnh tên = tên model (hero.png cho hero.obj) → mọi material */
    var modelImg = findImage(function (c) { return lower(c.base) === lower(objName); });
    if (modelImg) {
      mats.forEach(function (mat) {
        var e = byMaterial[mat] || {};
        if (!e[modelImg.slot]) e[modelImg.slot] = modelImg.name;
        byMaterial[mat] = e;
      });
    }
    /* chỉ có đúng 1 ảnh map → gán toàn bộ (kể cả OBJ không có tên material) */
    var targetMats = mats.length ? mats : ['*'];
    if (!Object.keys(byMaterial).length && images.length === 1) {
      var only = classifyImage(images[0]);
      if (only.slot === 'map') {
        targetMats.forEach(function (mat) { byMaterial[mat] = { map: images[0] }; });
      }
    } else if (!mats.length && modelImg) {
      byMaterial['*'] = {};
      byMaterial['*'][modelImg.slot] = modelImg.name;
    }
    return { mtl: mtl, byMaterial: byMaterial };
  }

  /* ---------- áp texture lên object3D ---------- */
  function collectMaterialNames(object3D) {
    var names = [];
    object3D.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (m && m.name && names.indexOf(m.name) < 0) names.push(m.name);
      });
    });
    return names;
  }

  /* assignments: { [materialName|'*']: { [slot]: THREE.Texture } } */
  function applyTextures(object3D, assignments) {
    var summary = { materials: [], textures: 0 };
    if (!assignments || !object3D) return summary;
    var seenTex = {};
    object3D.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (mat) {
        if (!mat) return;
        var slots = assignments[mat.name] || assignments['*'];
        if (!slots) return;
        Object.keys(slots).forEach(function (slot) {
          var tex = slots[slot];
          if (!tex) return;
          if (!(slot in mat)) return; /* Phong không có roughnessMap… */
          mat[slot] = tex;
          if (COLOR_SLOTS.indexOf(slot) >= 0 && tex.encoding !== undefined && THREE.sRGBEncoding !== undefined) {
            tex.encoding = THREE.sRGBEncoding;
          }
          tex.needsUpdate = true;
          if (!seenTex[tex.uuid]) { seenTex[tex.uuid] = true; summary.textures++; }
        });
        mat.needsUpdate = true;
        if (summary.materials.indexOf(mat.name) < 0) summary.materials.push(mat.name);
      });
    });
    return summary;
  }

  /* ---------- áp MTL (MTLLoader r128) ----------
     resolveTexture(ref) -> THREE.Texture | null (đồng bộ).
     Texture trong MTL không có trong batch → bỏ key map đó, không crash. */
  function applyMtl(object3D, mtlText, resolveTexture) {
    if (!THREE.MTLLoader) throw new Error('MTLLoader chưa load (CDN)');
    var creator = new THREE.MTLLoader().parse(mtlText || '', '');
    var missing = [];
    var infos = creator.materialsInfo || {};
    Object.keys(infos).forEach(function (matName) {
      var info = infos[matName];
      MTL_MAP_KEYS.forEach(function (key) {
        var val = info[key];
        if (val === undefined || val === '') return;
        var file = basename(val);
        if (!file || !resolveTexture(file)) {
          delete info[key];
          missing.push(matName + ':' + key + '=' + file);
        }
      });
    });
    /* chặn MTLLoader tự fetch texture theo đường dẫn tương đối */
    creator.loadTexture = function (url, mapping, onLoad) {
      var tex = resolveTexture(basename(url) || url);
      if (tex) {
        if (mapping !== undefined) tex.mapping = mapping;
        if (onLoad) onLoad(tex);
        return tex;
      }
      /* bare texture đánh dấu: tránh crash ở setMapForType, không tính vào summary */
      var dummy = new THREE.Texture();
      dummy.userData = dummy.userData || {};
      dummy.userData.__objTextureBare = true;
      return dummy;
    };
    creator.preload();
    var applied = [], texCount = 0, seen = {};
    object3D.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (mat, idx) {
        if (!mat || !mat.name || !infos[mat.name]) return; /* material không có trong MTL: giữ nguyên */
        var created = creator.create(mat.name);
        if (!created) return;
        if (Array.isArray(o.material)) o.material[idx] = created;
        else o.material = created;
        COLOR_SLOTS.forEach(function (slot) {
          if (created[slot]) created[slot].encoding = THREE.sRGBEncoding;
        });
        created.needsUpdate = true;
        if (applied.indexOf(mat.name) < 0) applied.push(mat.name);
        ['map', 'specularMap', 'emissiveMap', 'normalMap', 'bumpMap', 'alphaMap'].forEach(function (slot) {
          var t = created[slot];
          if (t && !(t.userData && t.userData.__objTextureBare) && !seen[t.uuid]) { seen[t.uuid] = true; texCount++; }
        });
      });
    });
    return { materials: applied, textures: texCount, missing: missing };
  }

  return {
    IMAGE_EXTS: IMAGE_EXTS,
    basename: basename,
    extOf: extOf,
    isImageName: isImageName,
    parseMtllib: parseMtllib,
    parseMaterialNames: parseMaterialNames,
    classifyImage: classifyImage,
    resolveCompanions: resolveCompanions,
    collectMaterialNames: collectMaterialNames,
    applyTextures: applyTextures,
    applyMtl: applyMtl
  };
});
