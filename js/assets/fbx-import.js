/* ============================================================
 * assets/fbx-import.js — FBX IMPORT HOÀN CHỈNH (v1.0, 2026-11-27)
 * Nhóm 1 — mở rộng import FBX trong studio 3D-Model.
 *
 * Những gì module này làm mà đường dây cũ (model-manager.js
 * loadFBXFromBuffer trực tiếp gọi FBXLoader.parse) chưa làm:
 *   1. Detect version/format TRƯỚC khi parse: binary 6100/7300/
 *      7400/7500/7700 + ASCII 7.x — báo rõ version nào hỗ trợ,
 *      version nào không (binary <6400, ASCII <7000: FBXLoader
 *      r128 từ chối) kèm gợi ý sửa, KHÔNG crash.
 *   2. Texture nhúng: liệt kê texture theo slot (map/normalMap/…),
 *      phân loại nhúng (data:/blob:) / ngoài / chưa load; quét tên
 *      file texture tham chiếu trong buffer + áp texture đi kèm
 *      trong cùng lần kéo-thả (batch) cho slot còn thiếu. Vì texture
 *      nhúng load async qua TextureLoader nên parseDetailed đợi
 *      300ms (opts.textureSettleMs) cho ảnh kịp về rồi mới phân loại,
 *      nếu không trình duyệt thật sẽ báo toàn 'pending' dù đã nhúng.
 *   3. Morph target / blendshape: liệt kê + phát (set weight) +
 *      reset, qua geometry.morphAttributes (FBXLoader r128 parse
 *      BlendShape deformer sẵn).
 *   4. Nhiều take / animation stack: FBXLoader r128 tạo 1 clip
 *      cho mỗi AnimationStack — liệt kê tất cả + chọn take phát
 *      qua Anim manager (listTakes/selectTake).
 *   5. Tên xương chuẩn hóa: canonical 'mixamorig:<Tên>' (strip
 *      regex /^mixamorig:?/i, Bip01, Armature|), đổi tên bone +
 *      viết lại tên track trong clip cho khớp.
 *   6. Skeleton + skin validate: đếm xương, kiểm tra skin weights
 *      (NaN, âm, tổng ≠ 1, đỉnh chưa gán, bone index vượt).
 *   7. Báo lỗi chi tiết theo mã (FbxImportError: code + hint).
 *   8. Validate sau import + báo cáo đầy đủ (mesh/tris/xương/
 *      clip/texture/morph/skin) gắn vào entry.fbxReport.
 *   9. Progress theo giai đoạn (detect → parse → post → done),
 *      yield setTimeout trước bước parse đồng bộ nặng để UI kịp
 *      vẽ loading, không treo cứng.
 *
 * Module KHÔNG phụ thuộc PixiStudio.Utils/bus (chỉ cần THREE +
 * FBXLoader + fflate như đường dây cũ). model-manager.js và
 * fbx-rig-import.js gọi qua PixiStudio.FbxImport, và đều fallback
 * về parse trực tiếp nếu module chưa load.
 * ============================================================ */
(function () {
  'use strict';

  var FbxImport = {};

  /* ---------- Version ---------- */
  FbxImport.SUPPORTED_BINARY_MIN = 6400;   // FBXLoader r128: binary <6400 throw
  FbxImport.SUPPORTED_ASCII_MIN = 7000;    // FBXLoader r128: ASCII <7000 throw
  FbxImport.SUPPORTED_VERSIONS = [6400, 7000, 7100, 7200, 7300, 7400, 7500, 7700];

  FbxImport.describeVersion = function (version) {
    var labels = {
      6100: 'FBX 2010 (6.1)', 6400: 'FBX 2011 (6.4)', 7000: 'FBX 2013 (7.0)',
      7100: 'FBX 2014 (7.1)', 7200: 'FBX 2015 (7.2)', 7300: 'FBX 2016 (7.3)',
      7400: 'FBX 2017/2018 (7.4)', 7500: 'FBX 2019/2020 (7.5)',
      7700: 'FBX 2020+ (7.7)'
    };
    if (labels[version]) return labels[version];
    if (version >= 7000) return 'FBX 7.' + String(version).slice(1, 2) + ' (' + version + ')';
    return 'FBX (' + version + ')';
  };

  /* ---------- Lỗi có mã + gợi ý ---------- */
  function FbxImportError(code, message, hint) {
    var err = new Error(message);
    err.name = 'FbxImportError';
    err.code = code;
    err.hint = hint || '';
    return err;
  }
  FbxImport.FbxImportError = FbxImportError;
  FbxImport.isFbxImportError = function (err) {
    return !!(err && err.name === 'FbxImportError' && err.code);
  };

  /* Map lỗi FBXLoader r128 (throw trong parse) → mã + gợi ý sửa. */
  FbxImport.mapParseError = function (err) {
    var msg = String((err && err.message) || err || 'lỗi không rõ');
    if (/version not supported/i.test(msg)) {
      var m = /FileVersion:\s*(\d+)/.exec(msg);
      var v = m ? parseInt(m[1], 10) : 0;
      return new FbxImportError('UNSUPPORTED_VERSION',
        'FBX version ' + (v || '?') + ' không được hỗ trợ (' + msg.replace(/^THREE\.FBXLoader:\s*/, '') + ').',
        'Xuất lại file bằng FBX 2016 (7300), 2017/2018 (7400) hoặc 2019/2020 (7500) — vd từ Blender: Export FBX, chọn FBX version 7.4 binary; từ Mixamo: file tải về mặc định đã là 7300.');
    }
    if (/Cannot find the version number/i.test(msg)) {
      return new FbxImportError('CORRUPT',
        'Không đọc được version FBX — file có thể đã hỏng hoặc không phải FBX.',
        'Tải lại file gốc, hoặc mở bằng Blender/Autodesk FBX Review rồi xuất lại FBX binary 7400.');
    }
    if (/out of bounds|range|unexpected end/i.test(msg)) {
      return new FbxImportError('CORRUPT',
        'File FBX bị cắt/hỏng giữa chừng khi parse: ' + msg.slice(0, 160) + '.',
        'File chưa tải đủ hoặc ổ đĩa lỗi — tải/upload lại file, kiểm tra dung lượng đúng như file gốc.');
    }
    return new FbxImportError('PARSE_FAILED',
      'Parse FBX thất bại: ' + msg.replace(/^THREE\.FBXLoader:\s*/, '').slice(0, 220) + '.',
      'Thử mở file bằng Blender rồi xuất lại FBX binary 7400; nếu file từ Mixamo, tải lại bản gốc từ mixamo.com.');
  };

  /* Message hiển thị cho notify: tên lỗi + gợi ý sửa. */
  FbxImport.formatError = function (err) {
    if (FbxImport.isFbxImportError(err)) {
      return {
        code: err.code,
        title: 'Import FBX thất bại — ' + err.code,
        message: err.message + (err.hint ? ' Gợi ý: ' + err.hint : ''),
        hint: err.hint || ''
      };
    }
    var mapped = FbxImport.mapParseError(err);
    return { code: mapped.code, title: 'Import FBX thất bại — ' + mapped.code, message: mapped.message + ' Gợi ý: ' + mapped.hint, hint: mapped.hint };
  };

  /* ---------- Helpers buffer ---------- */
  function asView(input) {
    if (!input) return null;
    if (input instanceof ArrayBuffer) {
      return { u8: new Uint8Array(input), view: new DataView(input), buf: input };
    }
    /* Uint8Array / Node Buffer (có .buffer + byteOffset) */
    if (input.buffer instanceof ArrayBuffer && typeof input.byteLength === 'number') {
      var buf = input.buffer.slice ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) : input.buffer;
      return { u8: new Uint8Array(buf), view: new DataView(buf), buf: buf };
    }
    return null;
  }

  function toArrayBuffer(input) {
    var v = asView(input);
    return v ? v.buf : null;
  }

  function decodeAsciiHead(u8, maxLen) {
    var len = Math.min(u8.length, maxLen || 8192);
    var s = '';
    for (var i = 0; i < len; i++) {
      var c = u8[i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  /* ---------- 1. Detect format + version (không parse) ---------- */
  FbxImport.detect = function (arrayBuffer) {
    var v = asView(arrayBuffer);
    if (!v || v.u8.length === 0) {
      return { format: 'unknown', version: 0, versionLabel: '', supported: false,
        code: 'EMPTY_FILE', message: 'File rỗng (0 byte) — chưa có dữ liệu để đọc.',
        hint: 'Chọn lại file FBX trên máy; file có thể chưa tải xong.' };
    }
    var u8 = v.u8;
    /* Binary: magic 21 byte 'Kaydara FBX Binary  \0', version uint32 LE ở offset 23 */
    var magic = 'Kaydara FBX Binary  \0';
    var isBinary = u8.length >= 27;
    if (isBinary) {
      for (var i = 0; i < magic.length; i++) {
        if (u8[i] !== magic.charCodeAt(i)) { isBinary = false; break; }
      }
    }
    if (isBinary) {
      var version = v.view.getUint32(23, true);
      var label = FbxImport.describeVersion(version);
      if (version < FbxImport.SUPPORTED_BINARY_MIN) {
        return { format: 'binary', version: version, versionLabel: label, supported: false,
          code: 'UNSUPPORTED_VERSION',
          message: 'FBX binary version ' + version + ' (' + label + ') quá cũ — FBXLoader r128 chỉ đọc binary từ 6400 trở lên.',
          hint: 'Xuất lại file bằng FBX 2016 (7300) trở lên: Blender → Export FBX → FBX version 7.4 binary; Mixamo tải về mặc định đã là 7300.' };
      }
      if (version > 7700) {
        return { format: 'binary', version: version, versionLabel: label, supported: true,
          code: 'NEWER_VERSION',
          message: 'FBX binary version ' + version + ' (' + label + ') mới hơn bản loader đã kiểm chứng (tới 7700) — vẫn thử đọc, nếu lỗi thì xuất lại 7400.',
          hint: 'Nếu parse lỗi, xuất lại FBX 7400.' };
      }
      return { format: 'binary', version: version, versionLabel: label, supported: true, code: 'OK', message: '', hint: '' };
    }
    /* ASCII: bắt đầu bằng '; FBX' */
    var head = decodeAsciiHead(u8, 8192);
    if (/^;\s*FBX/.test(head)) {
      var m = /FBXVersion:\s*(\d+)/.exec(head);
      var aver = m ? parseInt(m[1], 10) : 0;
      if (!aver) {
        return { format: 'ascii', version: 0, versionLabel: '', supported: false,
          code: 'CORRUPT', message: 'File FBX ASCII nhưng không tìm thấy dòng FBXVersion — file có thể đã hỏng.',
          hint: 'Xuất lại file FBX ASCII 7.4/7.5, hoặc chuyển sang binary 7400.' };
      }
      var alabel = FbxImport.describeVersion(aver);
      if (aver < FbxImport.SUPPORTED_ASCII_MIN) {
        return { format: 'ascii', version: aver, versionLabel: alabel, supported: false,
          code: 'UNSUPPORTED_VERSION',
          message: 'FBX ASCII version ' + aver + ' (' + alabel + ') quá cũ — FBXLoader r128 chỉ đọc ASCII từ 7000 trở lên.',
          hint: 'Xuất lại file bằng FBX ASCII 7.4/7.5, hoặc chuyển sang binary 7400 (nhẹ hơn, đọc nhanh hơn).' };
      }
      return { format: 'ascii', version: aver, versionLabel: alabel, supported: true, code: 'OK', message: '', hint: '' };
    }
    return { format: 'unknown', version: 0, versionLabel: '', supported: false,
      code: 'NOT_FBX',
      message: 'File không phải FBX (không có header binary "Kaydara FBX Binary" cũng không có header ASCII "; FBX").',
      hint: 'Kiểm tra lại file đã chọn — hỗ trợ .fbx (binary 7300/7400/7500/7700, ASCII 7.x), .glb/.gltf, .obj, .stl. File .zip/.rar cần giải nén trước.' };
  };

  /* ---------- 5. Tên xương chuẩn hóa ----------
     Quy ước studio: canonical CÓ prefix 'mixamorig:'.
     strip: 'mixamorigHips' | 'mixamorig:Hips' | 'Hips' | 'Bip01_Hips' |
     'ModelmixamorigHips' | 'Armature|Hips' | 'Model::mixamorig:Hips'
     đều → 'Hips' → canonical 'mixamorig:Hips'.
     Tên container chung ('root'/'Armature'/'Scene') không phải xương
     Mixamo nên giữ nguyên — tránh đổi 'root' thành 'mixamorig:root'. */
  FbxImport.stripBonePrefix = function (name) {
    var n = String(name || '');
    var bar = n.lastIndexOf('|');
    if (bar !== -1) n = n.slice(bar + 1);
    var ns = n.lastIndexOf('::');
    if (ns !== -1) n = n.slice(ns + 2);
    /* 'ModelmixamorigHips' — một số exporter nối tên model + tên xương */
    var mi = n.search(/mixamorig/i);
    if (mi > 0) n = n.slice(mi);
    n = n.replace(/^mixamorig:?/i, '').replace(/^Bip0?1[_:]?/i, '').replace(/^Armature[_:]?/i, '');
    return n;
  };

  FbxImport.isContainerBoneName = function (name) {
    var s = FbxImport.stripBonePrefix(name).toLowerCase();
    return s === 'root' || s === 'armature' || s === 'scene' || s === 'model';
  };

  FbxImport.canonicalBoneName = function (name) {
    if (FbxImport.isContainerBoneName(name)) return String(name || '');
    var short = FbxImport.stripBonePrefix(name);
    return short ? 'mixamorig:' + short : String(name || '');
  };

  /* Đổi tên bone + viết lại tên track clip cho khớp. Track được khớp theo
     DẠNG CHUẨN HÓA (không theo tên gốc): track 'Armature|Hips.quaternion'
     vẫn khớp bone 'Hips' vì cả hai cùng canonical 'mixamorig:Hips'.
     Chỉ viết lại track transform (.quaternion/.position/.scale) — track
     morph (.morphTarget…) trỏ tới mesh, không phải xương. Trả
     {renamed, map, tracksRenamed}. */
  FbxImport.canonicalizeBoneNames = function (object) {
    var map = {};
    var renamed = 0;
    var canonSet = {};
    object.traverse(function (o) {
      if (!o.isBone) return;
      var canon = FbxImport.canonicalBoneName(o.name);
      canonSet[canon] = true;
      if (canon !== o.name) {
        map[o.name] = canon;
        o.name = canon;
        renamed++;
      }
    });
    var tracksRenamed = 0;
    (object.animations || []).forEach(function (clip) {
      (clip.tracks || []).forEach(function (track) {
        if (!/\.(quaternion|position|scale)$/.test(track.name)) return;
        var dot = track.name.indexOf('.');
        if (dot === -1) return;
        var node = track.name.slice(0, dot);
        var canon = FbxImport.canonicalBoneName(node);
        if (canon !== node && canonSet[canon]) {
          track.name = canon + track.name.slice(dot);
          tracksRenamed++;
        }
      });
    });
    return { renamed: renamed, map: map, tracksRenamed: tracksRenamed };
  };

  /* ---------- 6. Skeleton ---------- */
  FbxImport.inspectSkeleton = function (object) {
    var bones = [];
    var skinnedMeshes = 0;
    var maxDepth = 0;
    object.traverse(function (o) {
      if (o.isSkinnedMesh) skinnedMeshes++;
      if (!o.isBone) return;
      var depth = 0, p = o.parent;
      while (p && p.isBone) { depth++; p = p.parent; }
      if (depth > maxDepth) maxDepth = depth;
      bones.push({
        name: o.name,
        canonical: FbxImport.canonicalBoneName(o.name),
        parent: (o.parent && o.parent.isBone) ? o.parent.name : null,
        depth: depth
      });
    });
    return {
      boneCount: bones.length,
      bones: bones,
      roots: bones.filter(function (b) { return !b.parent; }).map(function (b) { return b.name; }),
      skinnedMeshes: skinnedMeshes,
      maxDepth: maxDepth
    };
  };

  /* ---------- 6. Skin weights ---------- */
  FbxImport.validateSkin = function (object, opts) {
    opts = opts || {};
    var sampleEvery = opts.sampleEvery || 1;   // 1 = kiểm hết; file lớn có thể đặt 7
    var issues = [];
    var stats = { meshes: 0, verticesChecked: 0, nan: 0, negative: 0, zero: 0, sumOut: 0, outOfRange: 0 };
    var boneCount = 0;
    object.traverse(function (o) { if (o.isBone) boneCount++; });
    object.traverse(function (o) {
      if (!o.isSkinnedMesh) return;
      stats.meshes++;
      var geo = o.geometry;
      if (!geo || !geo.attributes) return;
      var idx = geo.attributes.skinIndex, wgt = geo.attributes.skinWeight;
      if (!idx || !wgt) {
        issues.push({ code: 'SKIN_NO_WEIGHTS', severity: 'error', mesh: o.name || '(mesh)',
          message: 'SkinnedMesh "' + (o.name || '?') + '" thiếu skinIndex/skinWeight — mesh sẽ không biến dạng theo xương.' });
        return;
      }
      var bones = (o.skeleton && o.skeleton.bones) ? o.skeleton.bones.length : boneCount;
      var count = idx.count;
      var checkedInMesh = 0;
      for (var vi = 0; vi < count; vi += sampleEvery) {
        checkedInMesh++;
        var sum = 0, hasZero = true;
        for (var k = 0; k < 4; k++) {
          /* .array trực tiếp (r128 chưa chắc có getComponent) */
          var w = wgt.array[vi * 4 + k];
          var bi = idx.array[vi * 4 + k];
          if (typeof w !== 'number' || isNaN(w)) { stats.nan++; continue; }
          if (w < 0) stats.negative++;
          if (w > 0) hasZero = false;
          sum += w;
          if (bi < 0 || bi >= bones) stats.outOfRange++;
        }
        if (hasZero) stats.zero++;
        else if (sum < 0.98 || sum > 1.02) stats.sumOut++;
      }
      stats.verticesChecked += checkedInMesh;
    });
    if (stats.nan > 0) {
      issues.push({ code: 'SKIN_NAN_WEIGHTS', severity: 'error',
        message: stats.nan + ' weight NaN trong skin — mesh sẽ biến dạng sai. Xuất lại rig từ phần mềm gốc.' });
    }
    if (stats.outOfRange > 0) {
      issues.push({ code: 'SKIN_BONE_OOR', severity: 'error',
        message: stats.outOfRange + ' skin index trỏ tới xương ngoài phạm vi skeleton — rig/file không khớp. Xuất lại file rig.' });
    }
    if (stats.negative > 0) {
      issues.push({ code: 'SKIN_NEGATIVE', severity: 'error',
        message: stats.negative + ' weight âm trong skin — không hợp lệ.' });
    }
    if (stats.verticesChecked > 0 && stats.zero / stats.verticesChecked > 0.05) {
      issues.push({ code: 'SKIN_UNWEIGHTED', severity: 'warning',
        message: Math.round(stats.zero / stats.verticesChecked * 100) + '% đỉnh không gán weight nào — các đỉnh này đứng yên khi xương chuyển động (kiểm tra lại weight paint).' });
    }
    if (stats.verticesChecked > 0 && stats.sumOut / stats.verticesChecked > 0.05) {
      issues.push({ code: 'SKIN_WEIGHT_SUM', severity: 'warning',
        message: Math.round(stats.sumOut / stats.verticesChecked * 100) + '% đỉnh có tổng weight lệch khỏi 1 — biến dạng có thể phồng/xẹp nhẹ.' });
    }
    var ok = !issues.some(function (i) { return i.severity === 'error'; });
    return { ok: ok, issues: issues, stats: stats };
  };

  /* ---------- 3. Morph target / blendshape ---------- */
  FbxImport.inspectMorphs = function (object) {
    var morphs = [];
    var total = 0;
    object.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      var ma = o.geometry.morphAttributes;
      if (!ma || !ma.position || !ma.position.length) return;
      var targets = ma.position.map(function (attr, i) {
        return {
          name: attr.name || ('morph_' + i),
          index: i,
          vertices: attr.count,
          initialWeight: (o.morphTargetInfluences && typeof o.morphTargetInfluences[i] === 'number')
            ? o.morphTargetInfluences[i] : 0
        };
      });
      total += targets.length;
      morphs.push({ mesh: o.name || '(mesh)', meshUuid: o.uuid, targets: targets });
    });
    return { total: total, meshes: morphs };
  };

  /* Phát morph: đặt weight cho mọi target trùng tên (không phân biệt hoa/thường).
     targetName '*' = tất cả. Trả {applied, meshes}. */
  FbxImport.setMorphWeight = function (object, targetName, weight) {
    var applied = 0, meshes = 0;
    var want = String(targetName == null ? '' : targetName).toLowerCase();
    var all = want === '*' || want === '';
    object.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      var ma = o.geometry.morphAttributes;
      if (!ma || !ma.position || !ma.position.length) return;
      if (!o.morphTargetInfluences) return;
      var hit = false;
      ma.position.forEach(function (attr, i) {
        var n = String(attr.name || ('morph_' + i)).toLowerCase();
        if (all || n === want) {
          o.morphTargetInfluences[i] = weight;
          applied++;
          hit = true;
        }
      });
      if (hit) meshes++;
    });
    return { applied: applied, meshes: meshes };
  };
  FbxImport.playMorph = FbxImport.setMorphWeight;

  FbxImport.resetMorphs = function (object) {
    return FbxImport.setMorphWeight(object, '*', 0);
  };

  /* ---------- 2. Texture: liệt kê theo slot ---------- */
  FbxImport.TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap'];

  FbxImport.inspectTextures = function (object) {
    var items = [];
    var counts = { total: 0, embedded: 0, external: 0, pending: 0 };
    var materialsWithoutMap = 0, materialsSeen = 0;
    object.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (mat) {
        if (!mat) return;
        materialsSeen++;
        if (!mat.map) materialsWithoutMap++;
        FbxImport.TEXTURE_SLOTS.forEach(function (slot) {
          var tex = mat[slot];
          if (!tex) return;
          counts.total++;
          var src = '';
          if (tex.image) {
            src = tex.image.src || tex.image.currentSrc || '';
            if (typeof src !== 'string') src = '';
          }
          var state;
          if (!tex.image) state = 'pending';
          else if (src.indexOf('data:') === 0 || src.indexOf('blob:') === 0) state = 'embedded';
          else if (src) state = 'external';
          else state = 'embedded'; /* image đã load nhưng không có src (canvas/buffer) */
          counts[state] = (counts[state] || 0) + 1;
          items.push({
            mesh: o.name || '(mesh)', material: mat.name || '(material)', slot: slot,
            state: state, src: src ? (src.length > 120 ? src.slice(0, 120) + '…' : src) : '',
            width: tex.image && tex.image.width ? tex.image.width : 0,
            height: tex.image && tex.image.height ? tex.image.height : 0
          });
        });
      });
    });
    return {
      total: counts.total, embedded: counts.embedded || 0,
      external: counts.external || 0, pending: counts.pending || 0,
      materials: materialsSeen, materialsWithoutMap: materialsWithoutMap, items: items
    };
  };

  /* Quét tên file texture tham chiếu trong buffer FBX (Texture/Video
     FileName/RelativeFilename). Heuristic theo byte — dùng để báo tên
     file ngoài còn thiếu + khớp file đi kèm trong batch. */
  function u8ToLatin1(u8, start, end) {
    var parts = [];
    for (var i = start; i < end; i += 32768) {
      var slice = u8.subarray(i, Math.min(end, i + 32768));
      parts.push(String.fromCharCode.apply(null, slice));
    }
    return parts.join('');
  }

  FbxImport.discoverTextureRefs = function (arrayBuffer) {
    var v = asView(arrayBuffer);
    if (!v) return [];
    var u8 = v.u8;
    var found = [], seen = {};
    var re = /[A-Za-z0-9_\-\.\/\\]{3,160}\.(?:jpg|jpeg|png|tga|bmp|webp|tif|tiff|dds|exr)/gi;
    var CHUNK = 1024 * 1024, OVERLAP = 256;
    for (var off = 0; off < u8.length; off += CHUNK) {
      var end = Math.min(u8.length, off + CHUNK + OVERLAP);
      var s = u8ToLatin1(u8, off, end);
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(s)) !== null) {
        var full = m[0].replace(/\\/g, '/');
        var base = full.split('/').pop();
        var key = base.toLowerCase();
        if (key.length < 5 || seen[key]) continue;
        seen[key] = true;
        found.push({ file: full, basename: base });
        if (found.length >= 50) return found;
      }
    }
    return found;
  };

  /* Áp texture đi kèm trong batch (kéo-thả nhiều file) cho các slot
     texture ngoài chưa load được (pending). Khớp theo basename trong
     discoverTextureRefs, theo thứ tự xuất hiện. Best-effort: lỗi
     texture không chặn import. Trả Promise<{applied, failed}>. */
  FbxImport.applyCompanionTextures = function (object, batch, refs) {
    var done = function (r) { return Promise.resolve(r); };
    if (!object || !batch || !window.THREE || !THREE.TextureLoader) return done({ applied: [], failed: [], skipped: 'no-batch-or-loader' });
    var byName = batch.byName || batch.filesByName || null;
    if (!byName) return done({ applied: [], failed: [], skipped: 'no-batch-index' });
    refs = refs || [];
    var refBasenames = refs.map(function (r) { return String(r.basename || r).toLowerCase(); });
    /* file ảnh trong batch khớp với 1 ref (theo basename) */
    var candidates = [];
    Object.keys(byName).forEach(function (lowerName) {
      var base = lowerName.split('/').pop();
      var idx = refBasenames.indexOf(base);
      if (idx !== -1) candidates.push({ order: idx, file: byName[lowerName], basename: base });
    });
    candidates.sort(function (a, b) { return a.order - b.order; });
    if (!candidates.length) return done({ applied: [], failed: [], skipped: 'no-matching-file' });
    /* slot pending, theo thứ tự traverse */
    var pending = [];
    object.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (mat) {
        FbxImport.TEXTURE_SLOTS.forEach(function (slot) {
          var tex = mat[slot];
          if (tex && !tex.image) pending.push({ mat: mat, slot: slot });
        });
      });
    });
    if (!pending.length) return done({ applied: [], failed: [], skipped: 'no-pending-slot' });
    var jobs = [];
    var applied = [], failed = [];
    pending.forEach(function (p, i) {
      var cand = candidates[Math.min(i, candidates.length - 1)];
      if (!cand) return;
      jobs.push(new Promise(function (resolve) {
        var url;
        try {
          url = (window.URL && URL.createObjectURL) ? URL.createObjectURL(cand.file) : null;
        } catch (e) { url = null; }
        if (!url) { failed.push({ slot: p.slot, file: cand.basename, reason: 'no-object-url' }); resolve(); return; }
        try {
          new THREE.TextureLoader().load(url, function (tex) {
            tex.encoding = THREE.sRGBEncoding;
            p.mat[p.slot] = tex;
            p.mat.needsUpdate = true;
            applied.push({ mesh: p.mat.name || '(material)', slot: p.slot, file: cand.basename });
            if (window.URL && URL.revokeObjectURL) URL.revokeObjectURL(url);
            resolve();
          }, undefined, function () {
            failed.push({ slot: p.slot, file: cand.basename, reason: 'load-error' });
            if (window.URL && URL.revokeObjectURL) URL.revokeObjectURL(url);
            resolve();
          });
        } catch (e) {
          failed.push({ slot: p.slot, file: cand.basename, reason: String(e && e.message || e) });
          resolve();
        }
      }));
    });
    return Promise.all(jobs).then(function () { return { applied: applied, failed: failed }; });
  };

  /* ---------- Stats ---------- */
  FbxImport.countStats = function (object) {
    var meshes = 0, vertices = 0, triangles = 0;
    object.traverse(function (o) {
      if (!o.isMesh) return;
      meshes++;
      var geo = o.geometry;
      if (geo && geo.attributes && geo.attributes.position) {
        vertices += geo.attributes.position.count;
        triangles += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
      }
    });
    return { meshes: meshes, vertices: Math.round(vertices), triangles: Math.round(triangles) };
  };

  /* ---------- 4. Nhiều take ---------- */
  FbxImport.listTakes = function (object) {
    return (object.animations || []).map(function (clip) {
      var frames = 0;
      (clip.tracks || []).forEach(function (t) {
        if (t.times && t.times.length > frames) frames = t.times.length;
      });
      return { name: clip.name || 'Clip', duration: clip.duration || 0, tracks: (clip.tracks || []).length, frames: frames };
    });
  };

  /* Phát 1 take theo tên: ưu tiên Anim manager của studio (đã đăng ký
     clip qua setTarget từ entry), fallback mixer riêng. */
  FbxImport.selectTake = function (target, clipName) {
    var object3D = null, clips = [];
    if (target && target.object3D) {
      object3D = target.object3D;
      clips = target.clips || object3D.animations || [];
    } else if (target) {
      object3D = target;
      clips = object3D.animations || [];
    }
    if (!object3D) return { clip: null, via: 'none', error: 'no-target' };
    var clip = null;
    for (var i = 0; i < clips.length; i++) {
      if (clips[i].name === clipName) { clip = clips[i]; break; }
    }
    if (!clip && clips.length && !clipName) clip = clips[0];
    if (!clip) return { clip: null, via: 'none', error: 'take-not-found: ' + clipName };
    try {
      var Anim = window.PixiStudio && PixiStudio.Anim;
      if (Anim && Anim.setTarget && Anim.play) {
        Anim.setTarget(object3D);
        if (Anim.clips.some(function (c) { return c.name === clip.name; })) {
          Anim.play(clip.name);
          return { clip: clip, via: 'anim' };
        }
      }
    } catch (e) { /* fallback mixer */ }
    try {
      if (!object3D.userData._fbxTakeMixer) {
        object3D.userData._fbxTakeMixer = new THREE.AnimationMixer(object3D);
      }
      var mixer = object3D.userData._fbxTakeMixer;
      mixer.stopAllAction();
      var action = mixer.clipAction(clip);
      action.reset();
      action.setLoop(THREE.LoopRepeat);
      action.play();
      return { clip: clip, via: 'mixer' };
    } catch (e) {
      return { clip: clip, via: 'none', error: String(e && e.message || e) };
    }
  };

  /* ---------- 7+8. Validate sau import ---------- */
  FbxImport.validateImport = function (object, meta) {
    meta = meta || {};
    var stats = FbxImport.countStats(object);
    var skel = FbxImport.inspectSkeleton(object);
    var skin = FbxImport.validateSkin(object);
    var morphs = FbxImport.inspectMorphs(object);
    var textures = FbxImport.inspectTextures(object);
    var errors = [], warnings = [];
    if (stats.meshes === 0) {
      errors.push({ code: 'NO_MESH', severity: 'error',
        message: 'File không chứa mesh nào (chỉ có xương/camera/empty) — không có gì để hiển thị.',
        hint: 'Kiểm tra lại file: có thể đây là file chỉ chứa animation (vd punch.fbx chỉ có rig) — import cùng file mesh, hoặc xuất lại kèm mesh.' });
    } else if (stats.triangles === 0) {
      errors.push({ code: 'NO_GEOMETRY', severity: 'error',
        message: 'Có ' + stats.meshes + ' mesh nhưng không có tam giác nào — geometry rỗng.',
        hint: 'Xuất lại file kèm geometry; kiểm tra mesh có bị ẩn/xóa trong phần mềm gốc không.' });
    }
    skin.issues.forEach(function (iss) {
      (iss.severity === 'error' ? errors : warnings).push(iss);
    });
    var clips = FbxImport.listTakes(object);
    if (!clips.length) {
      warnings.push({ code: 'NO_CLIPS', severity: 'warning',
        message: 'File không chứa animation clip nào — import dạng model tĩnh (vẫn dùng được cho rigging/posing).',
        hint: 'Muốn có animation: import thêm file .fbx animation cùng rig, hoặc dùng preset Idle/Walk trong Animation panel.' });
    }
    if (textures.pending > 0) {
      warnings.push({ code: 'TEXTURES_PENDING', severity: 'warning',
        message: textures.pending + ' texture chưa load xong (đang tải async hoặc file ngoài thiếu) — model có thể hiện trắng/xám tạm thời.',
        hint: 'Nếu texture là file ngoài: kéo-thả file ảnh (.jpg/.png) cùng tên vào studio trong cùng lần import; nếu là texture nhúng thì đợi vài giây rồi hard-refresh.' });
    }
    if (meta.refs && meta.refs.length && textures.materialsWithoutMap > 0) {
      warnings.push({ code: 'TEXTURES_EXTERNAL_MISSING', severity: 'warning',
        message: textures.materialsWithoutMap + ' material chưa có texture; file tham chiếu tới: ' + meta.refs.slice(0, 3).map(function (r) { return r.basename; }).join(', ') + (meta.refs.length > 3 ? '…' : '') + '.',
        hint: 'Kéo-thả các file ảnh này cùng lúc với file .fbx để studio tự gán vào đúng slot.' });
    }
    if (skel.boneCount === 0 && skin.stats.meshes > 0) {
      warnings.push({ code: 'NO_SKELETON', severity: 'warning',
        message: 'Có skinned mesh nhưng không tìm thấy xương nào — rig có thể đã tách khỏi mesh.',
        hint: 'Xuất lại file kèm skeleton, hoặc dùng Auto Rig để rig lại mesh.' });
    }
    return {
      ok: errors.length === 0,
      errors: errors, warnings: warnings,
      stats: stats, skeleton: skel, skin: skin, morphs: morphs, textures: textures,
      clips: clips
    };
  };

  /* ---------- 9. Parse đầy đủ, có progress ---------- */
  FbxImport.parseDetailed = function (arrayBuffer, opts) {
    opts = opts || {};
    var name = opts.name || 'model.fbx';
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    var t0 = Date.now();
    function prog(stage, pct, msg) {
      try { onProgress(stage, pct, msg); } catch (e) { /* progress không được phá import */ }
    }
    function tick() { return new Promise(function (res) { setTimeout(res, 0); }); }

    var det = null, object = null, report = null;
    return Promise.resolve()
      .then(function () {
        prog('detect', 5, 'Đang đọc header FBX…');
        return tick();
      })
      .then(function () {
        det = FbxImport.detect(arrayBuffer);
        if (!det.supported) throw new FbxImportError(det.code, det.message, det.hint);
        report = {
          fileName: name, format: det.format, version: det.version, versionLabel: det.versionLabel,
          supportedNote: det.code === 'NEWER_VERSION' ? det.message : ''
        };
        prog('parse', 15, 'Đang parse FBX ' + det.versionLabel + ' (' + det.format + ')…');
        return tick();
      })
      .then(function () {
        var buf = toArrayBuffer(arrayBuffer);
        if (!buf) throw new FbxImportError('EMPTY_FILE', 'Buffer FBX rỗng.', 'Chọn lại file FBX.');
        try {
          object = new THREE.FBXLoader().parse(buf, '');
        } catch (e) {
          throw FbxImport.mapParseError(e);
        }
        if (!object) throw new FbxImportError('EMPTY_SCENE', 'FBX parse xong nhưng không có object.', 'File có thể chỉ chứa animation — import cùng file mesh.');
        prog('post', 70, 'Đang kiểm tra skeleton / skin / morph / texture…');
        return tick();
      })
      .then(function () {
        /* Texture nhúng (blob:/data:) load ASYNC qua TextureLoader — đợi
           một nhịp cho ảnh kịp về rồi mới phân loại nhúng/ngoài, nếu không
           trình duyệt thật sẽ báo toàn 'pending' dù texture đã nhúng sẵn.
           opts.textureSettleMs (mặc định 300ms, 0 = tắt). */
        var settleMs = (opts.textureSettleMs == null ? 300 : opts.textureSettleMs);
        if (!settleMs) return null;
        return new Promise(function (res) { setTimeout(res, settleMs); });
      })
      .then(function () {
        var canon = { renamed: 0, map: {}, tracksRenamed: 0 };
        if (opts.canonicalize !== false) {
          try { canon = FbxImport.canonicalizeBoneNames(object); } catch (e) { /* tên xương lỗi không chặn import */ }
        }
        var validation = FbxImport.validateImport(object, { refs: null });
        var refs = [];
        try { refs = FbxImport.discoverTextureRefs(arrayBuffer); } catch (e) { refs = []; }
        /* validate lại với refs để có cảnh báo texture ngoài thiếu */
        if (refs.length) {
          var v2 = FbxImport.validateImport(object, { refs: refs });
          validation.warnings = v2.warnings;
          validation.errors = v2.errors;
        }
        report.meshes = validation.stats.meshes;
        report.triangles = validation.stats.triangles;
        report.vertices = validation.stats.vertices;
        report.bones = validation.skeleton.boneCount;
        report.boneRoots = validation.skeleton.roots;
        report.bonesRenamed = canon.renamed;
        report.boneMap = canon.map;
        report.clips = validation.clips;
        report.morphs = validation.morphs;
        report.textures = validation.textures;
        report.textureRefs = refs;
        report.skin = validation.skin;
        report.errors = validation.errors;
        report.warnings = validation.warnings;
        report.ok = validation.ok;
        report.parseMs = Date.now() - t0;
        prog('textures', 85, 'Đang gán texture đi kèm (nếu có)…');
        if (opts.batch) {
          return FbxImport.applyCompanionTextures(object, opts.batch, refs)
            .then(function (res) {
              report.companion = res;
              prog('done', 100, 'Import FBX xong.');
              return { object: object, report: report };
            })
            .catch(function () {
              report.companion = { applied: [], failed: [], skipped: 'companion-error' };
              prog('done', 100, 'Import FBX xong.');
              return { object: object, report: report };
            });
        }
        prog('done', 100, 'Import FBX xong.');
        return { object: object, report: report };
      });
  };

  /* Tóm tắt 1 dòng cho notify (tiếng Việt). */
  FbxImport.summarizeReport = function (report) {
    if (!report) return '';
    var parts = [];
    parts.push(report.meshes + ' mesh');
    parts.push(report.triangles.toLocaleString('en-US') + ' tris');
    if (report.bones) parts.push(report.bones + ' xương');
    parts.push(report.clips.length + ' clip' + (report.clips.length ? ' (' + report.clips.map(function (c) { return c.name; }).slice(0, 3).join(', ') + (report.clips.length > 3 ? '…' : '') + ')' : ''));
    var t = report.textures || {};
    if (t.total) parts.push(t.total + ' texture (' + (t.embedded || 0) + ' nhúng' + ((t.external || 0) ? ', ' + t.external + ' ngoài' : '') + ((t.pending || 0) ? ', ' + t.pending + ' chưa load' : '') + ')');
    if (report.morphs && report.morphs.total) parts.push(report.morphs.total + ' morph');
    if (report.warnings && report.warnings.length) parts.push('⚠ ' + report.warnings.length + ' cảnh báo');
    return parts.join(' · ');
  };

  window.PixiStudio.FbxImport = FbxImport;
})();
