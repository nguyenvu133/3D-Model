/* exporter/fbx-binary.js — FBX Binary 7.4 writer có SKELETON + SKIN + BIND POSE
 *
 * Vì sao cần: bộ xuất FBX cũ trong save-manager chỉ ghi ASCII, chỉ có geometry —
 * không có bone, không có skin weight. Mixamo (và cả Blender) từ chối file đó:
 * Mixamo chỉ nhận FBX BINARY 7.4 có mesh đã skin vào skeleton.
 *
 * File này ghi đúng định dạng:
 *   header "Kaydara FBX Binary  \0\x1a\0" + u32 7400
 *   FBXHeaderExtension / GlobalSettings / Documents / Definitions
 *   Objects: Geometry (Vertices, PolygonVertexIndex, Normal, UV, Material)
 *            Model::Mesh, Model::LimbNode (bone), Deformer::Skin,
 *            SubDeformer::Cluster (Indexes/Weights/Transform/TransformLink),
 *            Pose (BindPose), Material
 *   Connections, Takes
 *   footer 16-byte magic
 *
 * Quy ước toạ độ: hình học được BAKE ra world tại bind pose, mọi Model geometry
 * đặt identity, TransformLink = xform * bone.matrixWorld tại bind → công thức skinning
 * chuẩn FBX cho ra đúng rest pose. xform (xoay trục dọc lên +Y, dịch đáy về y=0,
 * scale về cao ~1.8) PHẢI áp cho cả xương / TransformLink / BindPose, không chỉ
 * geometry — nếu không xương sẽ nhỏ/lệch hẳn so với mesh (xem boneWorldX bên dưới).
 */
(function () {
  'use strict';

  const FbxBinary = {};
  const MAGIC = 'Kaydara FBX Binary  \u0000\u001a\u0000';
  const FOOTER_MAGIC = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];
  const VERSION = 7400;
  /* SỐ VERSION FBX ↔ TÊN BẢN (suy trực tiếp từ header file):
   *   "; FBX 7.7.0 project file" + FBXVersion: 7700  (X Bot.fbx, Mixamo/Maya 2020)
   *   ⇒ 7.3 = 7300 = FBX 2013   |   7.4 = 7400 = FBX 2014
   * Mixamo upload từ chối file > 2013 ("Please use FBX files 2013 or earlier"),
   * nên các nút cho Mixamo phải truyền opts.version = 7300. */
  const VERSION_MIXAMO = 7300;
  /* "đuôi" file FBX SDK cho bản BINARY: [magic 16][0][u32 version][u32 0 * 30][magic 16]
   * = 160B, đặt ngay sau null record cuối cùng. */
  const TRAILER_BIN = (function () {
    const b = new Uint8Array(21 + 4 + 120 + 16);
    for (let i = 0; i < 16; i++) b[i] = FOOTER_MAGIC[i];
    b[16] = 0;
    new DataView(b.buffer).setUint32(21, VERSION, true);
    for (let i = 0; i < 16; i++) b[b.length - 16 + i] = FOOTER_MAGIC[i];
    return b;
  })();
  /* "đuôi" cho bản ASCII (không có phần nhị phân): vẫn dùng đúng footId
   * để parser/3ds Max/FBX SDK nhận ra cuối file hợp lệ. */
  const TRAILER_ASCII = (function () {
    const b = new Uint8Array(16 + 1 + 16);
    for (let i = 0; i < 16; i++) b[i] = FOOTER_MAGIC[i];
    b[16] = 0;
    for (let i = 0; i < 16; i++) b[17 + i] = FOOTER_MAGIC[i];
    return b;
  })();
  /* Bản Binary mặc định 7400 (khớp file Meshy/Tripo đã có).
   * Bản ASCII ghi "FBX 7.3.0" (7300) = FBX 2013. */
  const VERSION_ASCII = 7300;

  /* ---------------- property helpers ---------------- */
  function pI(v) { return { k: 'I', v: v | 0 }; }
  function pD(v) { return { k: 'D', v: +v }; }
  function pL(v) { return { k: 'L', v: v }; }
  function pS(v) { return { k: 'S', v: String(v) }; }
  function pB(v) { return { k: 'C', v: v ? 1 : 0 }; }
  function arrD(list) { return { k: 'd', v: list }; }
  function arrI(list) { return { k: 'i', v: list }; }
  function arrB(list) { return { k: 'b', v: list }; }
  function pR(bytes) { return { k: 'R', v: bytes }; }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function node(name, props, children) {
    return { name: name, props: props || [], children: children || [] };
  }

  function encProp(p) {
    const out = [];
    if (p.k === 'I') { const b = new Uint8Array(5); b[0] = 0x49; new DataView(b.buffer).setInt32(1, p.v, true); out.push(b); }
    else if (p.k === 'D') { const b = new Uint8Array(9); b[0] = 0x44; new DataView(b.buffer).setFloat64(1, p.v, true); out.push(b); }
    else if (p.k === 'L') { const b = new Uint8Array(9); b[0] = 0x4C; new DataView(b.buffer).setBigInt64(1, BigInt(Math.round(p.v)), true); out.push(b); }
    else if (p.k === 'C') { out.push(new Uint8Array([0x43, p.v ? 1 : 0])); }
    else if (p.k === 'S') {
      const s = new TextEncoder().encode(p.v);
      const b = new Uint8Array(5 + s.length);
      const dv = new DataView(b.buffer);
      b[0] = 0x53; dv.setUint32(1, s.length, true); b.set(s, 5);
      out.push(b);
    } else if (p.k === 'R') {
      const data = p.v || new Uint8Array(0);
      const b = new Uint8Array(5 + data.length);
      const dv = new DataView(b.buffer);
      b[0] = 0x52; dv.setUint32(1, data.length, true); b.set(data, 5);
      out.push(b);
    } else if (p.k === 'd') {
      const a = p.v, n = a.length;
      const body = new Uint8Array(n * 8);
      const dv = new DataView(body.buffer);
      for (let i = 0; i < n; i++) dv.setFloat64(i * 8, a[i], true);
      const head = new Uint8Array(13);
      const hv = new DataView(head.buffer);
      head[0] = 0x64; hv.setUint32(1, n, true); hv.setUint32(5, 0, true); hv.setUint32(9, n * 8, true);
      out.push(head, body);
    } else if (p.k === 'i') {
      const a = p.v, n = a.length;
      const body = new Uint8Array(n * 4);
      const dv = new DataView(body.buffer);
      for (let i = 0; i < n; i++) dv.setInt32(i * 4, a[i] | 0, true);
      const head = new Uint8Array(13);
      const hv = new DataView(head.buffer);
      head[0] = 0x69; hv.setUint32(1, n, true); hv.setUint32(5, 0, true); hv.setUint32(9, n * 4, true);
      out.push(head, body);
    } else if (p.k === 'b') {
      const a = p.v, n = a.length;
      const body = new Uint8Array(n);
      for (let i = 0; i < n; i++) body[i] = a[i] ? 1 : 0;
      const head = new Uint8Array(13);
      const hv = new DataView(head.buffer);
      head[0] = 0x62; hv.setUint32(1, n, true); hv.setUint32(5, 0, true); hv.setUint32(9, n, true);
      out.push(head, body);
    }
    return out;
  }

  function propsBytes(props) {
    const parts = [];
    let len = 0;
    props.forEach(function (p) { encProp(p).forEach(function (b) { parts.push(b); len += b.length; }); });
    const buf = new Uint8Array(len);
    let o = 0;
    parts.forEach(function (b) { buf.set(b, o); o += b.length; });
    return buf;
  }

  function nodeSize(n) {
    const pb = propsBytes(n.props);
    let size = 13 + n.name.length + pb.length;
    let childSize = 0;
    n.children.forEach(function (c) { childSize += nodeSize(c); });
    if (n.children.length) childSize += 13;   /* null record kết thúc node (bắt buộc) */
    return size + childSize;
  }

  function writeNode(n, offset) {
    const nameBytes = new TextEncoder().encode(n.name);
    const pb = propsBytes(n.props);
    const total = nodeSize(n);
    let childSize = 0;
    n.children.forEach(function (c) { childSize += nodeSize(c); });

    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, offset + total, true);
    dv.setUint32(4, n.props.length, true);
    dv.setUint32(8, pb.length, true);
    buf[12] = nameBytes.length;
    buf.set(nameBytes, 13);
    buf.set(pb, 13 + nameBytes.length);
    let cur = 13 + nameBytes.length + pb.length;
    n.children.forEach(function (c) {
      const cb = writeNode(c, offset + cur);
      buf.set(cb, cur);
      cur += cb.length;
    });
    /* null record nếu có children */
    if (n.children.length) { /* đã zero sẵn */ }
    return buf;
  }

  /* ---------------- scene collection ---------------- */
  function collect(object3D) {
    const meshes = [], bones = [], boneIndex = {};
    object3D.updateMatrixWorld(true);
    object3D.traverse(function (o) {
      if (o.isBone) { boneIndex[o.uuid] = bones.length; bones.push(o); }
      /* BỎ mesh trang trí của bone (octahedron/joint sphere) — nếu không FBX sẽ
         chứa 20+ mesh khối tím và Mixamo/Blender hiển thị rác. */
      if (o.userData && o.userData.isBoneVisual) return;
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) meshes.push(o);
    });
    return { meshes: meshes, bones: bones, boneIndex: boneIndex };
  }

  function mat4ToArray(m) { return Array.prototype.slice.call(m.elements); }

  /* Mã hoá texture thành bytes để nhúng vào FBX (Video.Content).
     glTF (flipY=false) lưu ảnh top-down còn FBX đọc ảnh bottom-up → phải lật dọc,
     nếu không texture sẽ bị lộn ngược khi mở bằng Mixamo/Blender/Maya. */
  function encodeTextureToBytes(tex, slot, opts) {
    try {
      const img = (tex.userData && tex.userData.originalImage) || tex.image;
      if (!img) return null;
      const w = img.width || img.videoWidth || 0;
      const h = img.height || img.videoHeight || 0;
      if (!w || !h) return null;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d');
      const mode = (opts && opts.texFlip) || 'auto';
      const flip = mode === 'v' || (mode === 'auto' && tex.flipY === false);
      if (flip) { cx.translate(0, h); cx.scale(1, -1); }
      cx.drawImage(img, 0, 0, w, h);
      const isNormal = /normal/i.test(slot);
      const mime = isNormal ? 'image/png' : 'image/jpeg';
      const url = c.toDataURL(mime, mime === 'image/jpeg' ? 0.92 : undefined);
      const b64 = url.split(',')[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { bytes: bytes, mime: mime, w: w, h: h, flipped: flip };
    } catch (e) { return null; }
  }

  /* Properties70 chuẩn của FBX: transform nằm Ở ĐÂY (không chỉ node con) —
     three FBXLoader đọc 'Lcl_Translation' in modelNode, Blender/Mixamo cũng vậy. */
  function modelProps(p, e, s, extra) {
    const list = [
      node('P', [pS('Lcl Translation'), pS('Lcl Translation'), pS(''), pS('A'), pD(p[0]), pD(p[1]), pD(p[2])]),
      node('P', [pS('Lcl Rotation'), pS('Lcl Rotation'), pS(''), pS('A'), pD(e[0]), pD(e[1]), pD(e[2])]),
      node('P', [pS('Lcl Scaling'), pS('Lcl Scaling'), pS(''), pS('A'), pD(s[0]), pD(s[1]), pD(s[2])]),
      node('P', [pS('DefaultAttributeIndex'), pS('int'), pS('Integer'), pS(''), pI(0)]),
      node('P', [pS('InheritType'), pS('enum'), pS(''), pS(''), pI(1)])
    ];
    (extra || []).forEach(function (x) { list.push(x); });
    return node('Properties70', [], list);
  }

  /* ---------------- main write ---------------- */
  FbxBinary.write = function (object3D, opts) {
    opts = opts || {};
    /* version ghi vào header + node FBXVersion. 7300 = FBX 2013 (Mixamo yêu cầu
       "2013 or earlier"); 7400 = FBX 2014 (mặc định cũ, Mixamo từ chối). */
    const ver = (opts.version ? (opts.version | 0) : VERSION);
    let noSkeleton = !!opts.noSkeleton;   /* mesh-only → Mixamo tự auto-rig */
    if (opts.prepareMixamo && !opts.keepSkeleton) noSkeleton = true;   /* Mixamo tự auto-rig: bỏ skin/cluster */
    if (!window.THREE) throw new Error('THREE chưa sẵn sàng');
    const sc = collect(object3D);
    if (!sc.meshes.length) throw new Error('Không có mesh nào để xuất FBX');
    const skinned = noSkeleton ? [] : sc.meshes.filter(function (m) { return m.isSkinnedMesh && m.skeleton && m.skeleton.bones && m.skeleton.bones.length; });
    const hasSkin = skinned.length > 0;

    /* id cấp phát */
    let nextId = 100000;
    const id = function () { return nextId++; };

    const objects = [];
    const connections = [];
    const skinnedGeometryIds = [];

    /* --- model root --- */
    const models = [];
    const geoms = [];
    const mats = [];
    const clusters = [];
    const skinId = hasSkin ? id() : 0;
    const armatureId = id();

    /* ---- ASCII (FBX 7.4 text) — cho Mixamo / 3ds Max / Unity đọc chắc chắn -----------------
     * Build từ CÙNG cây node (roots) ở cuối hàm nên nội dung khớp bản binary 1:1.
     * Nhiều pipeline upload chỉ chấp nhận ASCII ("Unsupported FBX type" với binary lạ).
     * ------------------------------------------------------------------------------------ */
    function asciiProp(p) {
      const num = function (x) {
        const v = +x;
        if (!isFinite(v)) return '0';
        const s = String(v);
        return (s.indexOf('.') >= 0 || s.indexOf('e') >= 0) ? s : s + '.0';
      };
      const esc = function (s) {
        return '"' + String(s)
          .replace(/&/g, '&amp;').replace(/\t/g, '&#009;').replace(/\r/g, '&#013;').replace(/\n/g, '&#010;')
          .replace(/\u0000/g, '')
          .replace(/;/g, '&#059;').replace(/,/g, '&#044;').replace(/"/g, '&quot;') + '"';
      };
      if (p.k === 'S') return esc(p.v);
      if (p.k === 'I' || p.k === 'L') return String(Math.round(p.v));
      if (p.k === 'C') return p.v ? 'T' : 'F';
      if (p.k === 'D' || p.k === 'F') return num(p.v);
      if (p.k === 'R') {
        const b = p.v || new Uint8Array(0);
        return esc(Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''));
      }
      if (p.k === 'd' || p.k === 'i' || p.k === 'b') {
        const a = p.v, per = p.k === 'd' ? 100 : 200, lines = [];
        for (let i = 0; i < a.length; i += per) {
          const part = [];
          for (let j = i; j < Math.min(i + per, a.length); j++) part.push(p.k === 'd' ? num(a[j]) : String(a[j] | 0));
          lines.push(part.join(','));
        }
        if (!lines.length) return '*' + a.length + ' {\n\n}';
        return '*' + a.length + ' {\n' + lines.join(',\n') + '\n}';
      }
      return '0';
    }
    function asciiNode(n, depth, out) {
      const ind = new Array(depth + 1).join('\t');
      const props = n.props.map(asciiProp).join(', ');
      const head = ind + n.name + ':' + (props ? ' ' + props : '');
      if (!n.children.length) { out.push(head + '\n'); return; }
      out.push(head + ' {\n');
      n.children.forEach(function (c) { asciiNode(c, depth + 1, out); });
      out.push(ind + '}\n');
    }

    /* ---- Mixamo orientation (tự nhận diện trục "chiều cao") ---------------------
     * Mixamo yêu cầu nhân vật ĐỨNG THẲNG theo trục Y (pose T chuẩn) khi upload.
     * Model từ GLB Tripo/Meshy thường nằm ngang trong FBX (cao theo Z hoặc X).
     * Quy tắc: trục có kích thước dài nhất = trục dọc (chiều cao người/động vật) → đưa lên +Y;
     * nếu là X thì xoay thêm 90° để mặt hướng +Z. Chỉ bake vào vertex, node gốc giữ identity.
     * upAxis: 'keep' | 'Y' (mặc định tự nhận) | 'X' | 'Z' (ép trục nào là trục dọc).
     * -------------------------------------------------------------------------- */
    sc.meshes.forEach(function (m) { m.updateMatrixWorld(true); });
    const xform = new THREE.Matrix4();
    let srcBox = null;
    {
      const bb = new THREE.Box3();
      sc.meshes.forEach(function (m) { bb.expandByObject(m); });
      if (!bb.isEmpty()) srcBox = bb.clone();
    }
    let upAxisName = 'keep', origAxis = 1;
    if (opts.upAxis !== 'keep' && srcBox) {
      const size = srcBox.getSize(new THREE.Vector3());
      const dims = [size.x, size.y, size.z];
      let axis = 1;
      if (opts.upAxis === 'X') axis = 0; else if (opts.upAxis === 'Z') axis = 2;
      /* 'Y' hoặc không truyền = TỰ NHẬN trục dài nhất làm trục dọc (theo đúng
         comment ở đầu khối này). Trước đây nhánh này ép axis = 1 nên model
         Z-up/X-up từ GLB Tripo/Meshy được xuất ra vẫn NẰM NGANG, Mixamo
         không auto-rig được. */
      else axis = dims.indexOf(Math.max.apply(null, dims));
      origAxis = axis;
      upAxisName = 'XYZ'[axis];
      if (axis === 1) {
        xform.identity();
      } else if (axis === 2) {
        xform.makeRotationX(-Math.PI / 2);                     /* Z lên Y (+Z → +Y) */
      } else {
        /* +90° về Z: +X → +Y. Dấu cũ -90° đưa +X → -Y, nhân vật LỘN NGƯỢC
           (đầu ở y=0, chân ở y=1.8) rồi mới dịch đáy về 0. */
        xform.makeRotationZ(Math.PI / 2);
      }
      /* Dịch để đáy chạm y=0 và tâm footprint về gốc — đo SAU khi xoay
       * (nếu xoay, trục "đứng" của vật đổi chỗ nên phải dùng bbox đã biến đổi). */
      const outBox = srcBox.clone().applyMatrix4(xform);
      xform.premultiply(new THREE.Matrix4().makeTranslation(
        -(outBox.min.x + outBox.max.x) / 2, -outBox.min.y, -(outBox.min.z + outBox.max.z) / 2
      ));
    }
    /* nếu mesh vẫn quá nhỏ (GLB xuất bbox cm/mm) → scale để cao ≈ 1.8 đơn vị
     * (Mixamo auto-rig đo theo "chiều cao người" mặc định ~1.8 đơn vị).
     * Áp scale TRƯỚC phép xoay: scale đều nên không lệch hướng. */
    let unitScale = 1;
    if (srcBox && opts.autoScale !== false) {
      const size = srcBox.getSize(new THREE.Vector3());
      const h = Math.max(size.x, size.y, size.z);
      if (h > 0 && (h < 1.2 || h > 3.5)) unitScale = 1.8 / h;
    }
    xform.premultiply(new THREE.Matrix4().makeScale(unitScale, unitScale, unitScale));
    const useSkin = !noSkeleton && hasSkin;

    /* --- FIX (Mixamo): xform phải áp cho CẢ xương, không chỉ geometry ---
     * Trước đây geometry được bake bằng xform (xoay trục dọc lên +Y, dịch đáy
     * về y=0, scale về cao ~1.8) nhưng bone Lcl, Cluster TransformLink và
     * BindPose vẫn dùng matrixWorld GỐC → xương nhỏ/lệch hẳn so với mesh
     * (vd: mesh cao 1.8 nhưng Hips vẫn ở y=0.25), Mixamo/Blender skin sai
     * và auto-rig đo sai chiều cao. Tính world' = xform * bone.matrixWorld
     * cho mọi xương TRƯỚC khi ghi, rồi suy local từ world' của xương cha. */
    const boneWorldX = {};
    sc.bones.forEach(function (b) {
      boneWorldX[b.uuid] = xform.clone().multiply(b.matrixWorld);
    });
    const boneLocalX = function (b) {
      /* world' của xương cha gần nhất (không có → armature, identity) */
      let parentWorld = null;
      let walker = b.parent;
      while (walker) {
        if (walker.isBone && boneWorldX[walker.uuid]) { parentWorld = boneWorldX[walker.uuid]; break; }
        walker = walker.parent;
      }
      const local = new THREE.Matrix4();
      if (parentWorld) local.copy(parentWorld).invert().multiply(boneWorldX[b.uuid]);
      else local.copy(boneWorldX[b.uuid]);
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      local.decompose(p, q, s);
      const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
      return {
        p: [p.x, p.y, p.z],
        e: [THREE.MathUtils.radToDeg(e.x), THREE.MathUtils.radToDeg(e.y), THREE.MathUtils.radToDeg(e.z)],
        s: [s.x, s.y, s.z]
      };
    };
    const xformApplied = !xform.equals(new THREE.Matrix4());

    /* --- bones (Model::LimbNode) --- */
    const boneIds = {};
    sc.bones.forEach(function (b) {
      boneIds[b.uuid] = id();
    });

    /* --- geometry --- */
    const v3 = new THREE.Vector3();
    const n3 = new THREE.Vector3();
    sc.meshes.forEach(function (mesh, mi) {
      const geo = mesh.geometry;
      const pos = geo.attributes.position;
      const idx = geo.index;
      const triCount = idx ? idx.count : pos.count;
      const world = xform.clone().multiply(mesh.matrixWorld);

      /* vertices baked world */
      const verts = [], norms = [], uvs = [], uvIndex2 = [], piv = [];
      const uvAttr = geo.attributes.uv;
      const nAttr = geo.attributes.normal;

      for (let i = 0; i < pos.count; i++) {
        v3.fromBufferAttribute(pos, i).applyMatrix4(world);
        verts.push(v3.x, v3.y, v3.z);
      }
      /* bbox để ghi Properties70.BoundingBox */
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < verts.length; i += 3) {
        if (verts[i] < minX) minX = verts[i]; if (verts[i] > maxX) maxX = verts[i];
        if (verts[i + 1] < minY) minY = verts[i + 1]; if (verts[i + 1] > maxY) maxY = verts[i + 1];
        if (verts[i + 2] < minZ) minZ = verts[i + 2]; if (verts[i + 2] > maxZ) maxZ = verts[i + 2];
      }
      const triList = [];
      for (let t = 0; t < triCount; t++) triList.push(idx ? idx.getX(t) : t);
      /* PolygonVertexIndex: đỉnh cuối của mỗi polygon = ~index (bitwise not) */
      for (let t = 0; t + 2 < triList.length; t += 3) {
        piv.push(triList[t], triList[t + 1], ~triList[t + 2]);
      }
      /* normals + uv theo polygon-vertex */
      const nm = new THREE.Matrix3().getNormalMatrix(world);
      for (let t = 0; t + 2 < triList.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = triList[t + k];
          if (nAttr) { n3.fromBufferAttribute(nAttr, vi).applyMatrix3(nm).normalize(); norms.push(n3.x, n3.y, n3.z); }
          if (uvAttr) uvs.push(uvAttr.getX(vi), uvAttr.getY(vi));
        }
      }
      /* UV theo PolygonVertex: Mixamo/3ds Max đọc kiểu này chắc chắn nhất
       * (file Mixamo gốc cũng ghi ByPolygonVertex + IndexToDirect với UVIndex = 0..n-1). */
      if (uvs.length) { for (let i = 0; i < triList.length; i++) uvIndex2.push(i); }

      const gid = id();
      geoms.push(gid);
      const mid = id();
      const matName = ((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) || {}).name || ('mat_' + mi);
      mats.push({ id: mid, name: matName, color: mesh.material && mesh.material.color ? mesh.material.color : null, material: mesh.material });

      const gChildren = [
        node('Properties70', [], [
          node('P', [pS('BoundingBoxMin'), pS('Vector3D'), pS('Vector'), pS(''), pD(minX), pD(minY), pD(minZ)]),
          node('P', [pS('BoundingBoxMax'), pS('Vector3D'), pS('Vector'), pS(''), pD(maxX), pD(maxY), pD(maxZ)]),
          node('P', [pS('Primary Visibility'), pS('bool'), pS(''), pS(''), pB(true)])
        ]),
        node('Vertices', [arrD(verts)]),
        node('PolygonVertexIndex', [arrI(piv)]),
        node('GeometryVersion', [pI(124)])
      ];
      if (norms.length) {
        gChildren.push(node('LayerElementNormal', [pI(0)], [
          node('Version', [pI(101)]),
          node('Name', [pS('')]),
          node('MappingInformationType', [pS('ByPolygonVertex')]),
          node('ReferenceInformationType', [pS('Direct')]),
          node('Normals', [arrD(norms)])
        ]));
      }
      if (uvs.length) {
        gChildren.push(node('LayerElementUV', [pI(0)], [
          node('Version', [pI(101)]),
          node('Name', [pS('UVMap')]),
          node('MappingInformationType', [pS('ByPolygonVertex')]),
          node('ReferenceInformationType', [pS('IndexToDirect')]),
          node('UV', [arrD(uvs)]),
          node('UVIndex', [arrI(uvIndex2)])
        ]));
      }
      gChildren.push(node('LayerElementMaterial', [pI(0)], [
        node('Version', [pI(101)]),
        node('Name', [pS('')]),
        node('MappingInformationType', [pS('AllSame')]),
        node('ReferenceInformationType', [pS('IndexToDirect')]),
        node('Materials', [arrI([0])])
      ]));
      const layerEls = [];
      if (norms.length) layerEls.push(node('LayerElement', [], [node('Type', [pS('LayerElementNormal')]), node('TypedIndex', [pI(0)])]));
      if (uvs.length) layerEls.push(node('LayerElement', [], [node('Type', [pS('LayerElementUV')]), node('TypedIndex', [pI(0)])]));
      layerEls.push(node('LayerElement', [], [node('Type', [pS('LayerElementMaterial')]), node('TypedIndex', [pI(0)])]));
      gChildren.push(node('Layer', [pI(0)], [node('Version', [pI(100)])].concat(layerEls)));

      objects.push(node('Geometry', [pI(gid), pS('Geometry::' + (mesh.name || ('mesh_' + mi))), pS('Mesh')], gChildren));

      /* mesh model node — geometry đã bake world nên Lcl = identity */
      const meshModelId = id();
      models.push({ id: meshModelId, name: mesh.name || ('mesh_' + mi), matrixWorld: world });
      objects.push(node('Model', [pI(meshModelId), pS('Model::' + (mesh.name || ('mesh_' + mi))), pS('Mesh')], [
        node('Version', [pI(232)]),
        modelProps([0, 0, 0], [0, 0, 0], [1, 1, 1]),
        node('MultiLayer', [pI(0)]),
        node('MultiTake', [pI(0)]),
        node('Shading', [pB(true)]),
        node('Culling', [pS('CullingOff')])
      ]));
      connections.push({ type: 'OO', child: meshModelId, parent: 0 });
      connections.push({ type: 'OO', child: gid, parent: meshModelId });
      connections.push({ type: 'OO', child: mid, parent: meshModelId });

      /* skin clusters */
      if (useSkin && mesh.isSkinnedMesh && mesh.skeleton && mesh.skeleton.bones && mesh.skeleton.bones.length) {
        skinnedGeometryIds.push(gid);
        const sw = geo.attributes.skinWeight, si = geo.attributes.skinIndex;
        if (sw && si) {
          const byBone = {};   /* boneUuid → {indexes:[], weights:[]} */
          for (let i = 0; i < pos.count; i++) {
            for (let k = 0; k < 4; k++) {
              const w = sw.getComponent ? sw.getComponent(i, k) : sw.array[i * 4 + k];
              if (!w || w <= 0.0001) continue;
              const bi = si.getComponent ? si.getComponent(i, k) : si.array[i * 4 + k];
              const bone = mesh.skeleton.bones[bi];
              if (!bone) continue;
              const key = bone.uuid;
              if (!byBone[key]) byBone[key] = { bone: bone, indexes: [], weights: [] };
              byBone[key].indexes.push(i);
              byBone[key].weights.push(+w.toFixed(6));
            }
          }
          Object.keys(byBone).forEach(function (k) {
            const rec = byBone[k];
            const cid = id();
            const link = boneWorldX[rec.bone.uuid].clone();   /* bind world ĐÃ qua xform (khớp geometry đã bake) */
            clusters.push({
              id: cid, boneId: boneIds[rec.bone.uuid] || 0, bone: rec.bone,
              indexes: rec.indexes, weights: rec.weights, transformLink: link,
              transform: new THREE.Matrix4()   /* geometry đã ở world → mesh bind = identity */
            });
            connections.push({ type: 'OO', child: cid, parent: skinId });
            connections.push({ type: 'OO', child: boneIds[rec.bone.uuid] || 0, parent: cid });
          });
        }
      }
    });

    /* --- bone models (bỏ khi noSkeleton → Mixamo tự auto-rig) --- */
    const boneNodes = [];
    if (!noSkeleton) {
      sc.bones.forEach(function (b) {
        const bid = boneIds[b.uuid];
        /* Local transform suy từ world' (đã qua xform) — KHÔNG dùng
           b.position/quaternion/scale gốc vì geometry đã bake xform. */
        const lx = boneLocalX(b);
        const pArr = lx.p, eArr = lx.e, sArr = lx.s;

        const attrId = id();
        objects.push(node('NodeAttribute', [pI(attrId), pS('NodeAttribute::' + b.name), pS('LimbNode')], [
          node('TypeFlags', [pS('Skeleton')])
        ]));
        objects.push(node('Model', [pI(bid), pS('Model::' + b.name), pS('LimbNode')], [
          node('Version', [pI(232)]),
          modelProps(pArr, eArr, sArr)
        ]));
        connections.push({ type: 'OO', child: attrId, parent: bid });

        /* parent: bone gần nhất là bone, ngược lại armature */
        let parentId = armatureId;
        let walker = b.parent;
        while (walker) {
          if (walker.isBone && boneIds[walker.uuid] != null) { parentId = boneIds[walker.uuid]; break; }
          walker = walker.parent;
        }
        connections.push({ type: 'OO', child: bid, parent: parentId });
        boneNodes.push(bid);
      });
    }

    /* --- armature (bỏ khi noSkeleton) --- */
    if (!noSkeleton) {
      objects.push(node('Model', [pI(armatureId), pS('Model::Armature'), pS('Null')], [
        node('Version', [pI(232)]),
        modelProps([0, 0, 0], [0, 0, 0], [1, 1, 1])
      ]));
      connections.push({ type: 'OO', child: armatureId, parent: 0 });
    }

    /* --- skin deformer (bỏ khi noSkeleton) --- */
    if (!noSkeleton && clusters.length) {
      objects.push(node('Deformer', [pI(skinId), pS('Deformer::Skin'), pS('Skin')], [
        node('Version', [pI(101)]),
        node('Link_DeformAcuracy', [pD(50)])
      ]));
      /* QUAN TRỌNG: Skin phải nối vào GEOMETRY (không phải Model).
         three FBXLoader và Blender đều tìm skin ở relationships.children của
         Geometry → nếu nối vào Model thì mesh không được skin (skinned = 0). */
      if (skinnedGeometryIds.length) {
        skinnedGeometryIds.forEach(function (gid2) {
          connections.push({ type: 'OO', child: skinId, parent: gid2 });
        });
      } else if (geoms.length) {
        connections.push({ type: 'OO', child: skinId, parent: geoms[0] });
      }

      clusters.forEach(function (c, ci) {
        objects.push(node('Deformer', [pI(c.id), pS('SubDeformer::Cluster_' + ci), pS('Cluster')], [
          node('Version', [pI(100)]),
          node('UserData', [pS(''), pS('')]),
          node('Indexes', [arrI(c.indexes)]),
          node('Weights', [arrD(c.weights)]),
          node('Transform', [arrD(mat4ToArray(c.transform))]),
          node('TransformLink', [arrD(mat4ToArray(c.transformLink))])
        ]));
      });
    }

    /* --- bind pose (bỏ khi noSkeleton) --- */
    if (!noSkeleton && sc.bones.length) {
      const poseId = id();
      const poseNodes = sc.bones.map(function (b) {
        return node('PoseNode', [], [
          node('Node', [pI(boneIds[b.uuid])]),
          node('Matrix', [arrD(mat4ToArray(boneWorldX[b.uuid]))])   /* bind world ĐÃ qua xform */
        ]);
      });
      objects.push(node('Pose', [pI(poseId), pS('Pose::BIND_POSES'), pS('BindPose')], [
        node('Type', [pS('BindPose')]),
        node('Version', [pI(100)]),
        node('NbPoseNodes', [pI(poseNodes.length)])
      ].concat(poseNodes)));
    }

    /* --- materials --- */
    mats.forEach(function (m) {
      const col = m.color ? [m.color.r, m.color.g, m.color.b] : [0.8, 0.8, 0.8];
      const mt = (Array.isArray(m.material) ? m.material[0] : m.material) || {};
      const props = [
        node('P', [pS('ShadingModel'), pS('KString'), pS(''), pS(''), pS('Phong')]),
        node('P', [pS('DiffuseColor'), pS('Color'), pS(''), pS('A'), pD(col[0]), pD(col[1]), pD(col[2])]),
        node('P', [pS('AmbientColor'), pS('Color'), pS(''), pS('A'), pD(0.2), pD(0.2), pD(0.2)]),
        node('P', [pS('EmissiveColor'), pS('Color'), pS(''), pS('A'), pD(0), pD(0), pD(0)]),
        node('P', [pS('EmissiveFactor'), pS('Number'), pS(''), pS('A'), pD(0)]),
        node('P', [pS('SpecularColor'), pS('Color'), pS(''), pS('A'), pD(1), pD(1), pD(1)]),
        node('P', [pS('SpecularFactor'), pS('Number'), pS(''), pS('A'), pD(0.25)]),
        node('P', [pS('Shininess'), pS('Number'), pS(''), pS('A'), pD(25)]),
        node('P', [pS('ShininessExponent'), pS('Number'), pS(''), pS('A'), pD(25)]),
        node('P', [pS('ReflectionColor'), pS('Color'), pS(''), pS('A'), pD(1), pD(1), pD(1)]),
        node('P', [pS('ReflectionFactor'), pS('Number'), pS(''), pS('A'), pD(0)])
      ];
      if (mt.opacity !== undefined && mt.transparent) {
        props.push(node('P', [pS('TransparencyFactor'), pS('Number'), pS(''), pS('A'), pD(1 - mt.opacity)]));
        props.push(node('P', [pS('Opacity'), pS('Number'), pS(''), pS('A'), pD(mt.opacity)]));
      }
      if (mt.map) props.push(node('P', [pS('DiffuseFactor'), pS('Number'), pS(''), pS('A'), pD(1)]));
      objects.push(node('Material', [pI(m.id), pS('Material::' + m.name), pS('')], [
        node('Version', [pI(102)]),
        node('ShadingModel', [pS('Phong')]),
        node('MultiLayer', [pI(0)]),
        node('Properties70', [], props)
      ]));
    });

    /* --- textures: nhúng ảnh (Video.Content) + Texture + connection OP ---
       Đây là phần tạo MÀU cho FBX: Mixamo/Blender chỉ thấy texture khi ảnh nằm
       trong Video.Content và Texture nối vào Material bằng OP kèm tên property. */
    const texRecords = [];
    const texReport = [];
    if (opts.embedTextures !== false) {
      const SLOTS = [
        ['map', 'DiffuseColor'],
        ['normalMap', 'NormalMap'],
        ['roughnessMap', 'ShininessExponent'],
        ['metalnessMap', 'ReflectionFactor'],
        ['aoMap', 'AmbientColor'],
        ['emissiveMap', 'EmissiveColor']
      ];
      const seen = {};
      const provided = opts.textureBytes || null;   /* {matName:{slot:{b64,mime}}} — bytes lấy sẵn từ FBX nguồn */
      mats.forEach(function (m) {
        const mt = (Array.isArray(m.material) ? m.material[0] : m.material) || {};
        SLOTS.forEach(function (s) {
          const tex = mt[s[0]];
          const pb = provided && provided[m.name] ? provided[m.name][s[0]] : null;
          if (!pb && (!tex || !tex.image)) return;
          const key = m.id + '|' + s[0] + '|' + (tex ? (tex.uuid || '') : 'provided');
          if (seen[key]) return;
          seen[key] = 1;
          let enc = null;
          if (pb && pb.b64) enc = { bytes: b64ToBytes(pb.b64), mime: pb.mime || 'image/jpeg', w: pb.w || 0, h: pb.h || 0, flipped: false };
          else enc = encodeTextureToBytes(tex, s[0], opts);
          if (!enc || !enc.bytes.length) return;
          texRecords.push({
            matId: m.id, matName: m.name, propName: s[1], slot: s[0],
            bytes: enc.bytes, mime: enc.mime, w: enc.w, h: enc.h, flipped: enc.flipped, source: pb ? 'provided' : 'canvas'
          });
        });
      });

      texRecords.forEach(function (t, i) {
        const vid = id();
        const tid = id();
        t.id = tid;
        const ext = t.mime === 'image/png' ? '.png' : '.jpg';
        const vname = (t.matName || 'tex') + '_' + t.slot + '_' + i;
        const file = 'model.fbm/' + vname + ext;
        objects.push(node('Video', [pI(vid), pS('Video::' + vname), pS('Clip')], [
          node('Type', [pS('Clip')]),
          node('Properties70', [], []),
          node('UseMipMap', [pI(0)]),
          node('Filename', [pS(file)]),
          node('RelativeFilename', [pS(file)]),
          node('Content', [pR(t.bytes)])
        ]));
        objects.push(node('Texture', [pI(tid), pS('Texture::' + vname), pS('')], [
          node('Type', [pS('TextureVideoClip')]),
          node('Version', [pI(202)]),
          node('TextureName', [pS('Texture::' + vname)]),
          node('Media', [pS('Video::' + vname)]),
          node('FileName', [pS(file)]),
          node('RelativeFilename', [pS(file)]),
          node('Properties70', [], [])
        ]));
        connections.push({ type: 'OO', child: vid, parent: tid });
        connections.push({ type: 'OP', child: tid, parent: t.matId, prop: t.propName });
        texReport.push(t.matName + '.' + t.slot + ' → ' + t.propName + ' (' + t.mime + ' ' + t.w + 'x' + t.h + ', ' + Math.round(t.bytes.length / 1024) + 'KB' + (t.flipped ? ', flipped' : '') + (t.source === 'provided' ? ', from source' : '') + ')');
      });
    }

    /* ---------------- header sections ---------------- */
    const now = new Date();
    const header = node('FBXHeaderExtension', [], [
      node('FBXHeaderVersion', [pI(1003)]),
      node('FBXVersion', [pI(ver)]),
      node('EncryptionType', [pI(0)]),
      node('CreationTimeStamp', [], [
        node('Version', [pI(1000)]),
        node('Year', [pI(now.getFullYear())]),
        node('Month', [pI(now.getMonth() + 1)]),
        node('Day', [pI(now.getDate())]),
        node('Hour', [pI(now.getHours())]),
        node('Minute', [pI(now.getMinutes())]),
        node('Second', [pI(now.getSeconds())]),
        node('Millisecond', [pI(now.getMilliseconds())])
      ]),
      node('Creator', [pS('PixiJS Studio x Tripo3D AI Studio v10.0 — FBX Binary Writer')]),
      node('SceneInfo', [pS('GlobalInfo\u0000\u0001SceneInfo'), pS('UserData')], [
        node('Type', [pS('UserData')]),
        node('Version', [pI(100)]),
        node('MetaData', [], [
          node('Version', [pI(100)]),
          node('Title', [pS('')]),
          node('Subject', [pS('')]),
          node('Author', [pS('PixiJS Studio')]),
          node('Keywords', [pS('')]),
          node('Revision', [pS('1.0')]),
          node('Comment', [pS('')])
        ]),
        node('Properties70', [], [])
      ])
    ]);

    const globalSettings = node('GlobalSettings', [], [
      node('Version', [pI(1000)]),
      node('Properties70', [], [
        node('P', [pS('UpAxis'), pS('int'), pS('Integer'), pS(''), pI(1)]),
        node('P', [pS('UpAxisSign'), pS('int'), pS('Integer'), pS(''), pI(1)]),
        node('P', [pS('FrontAxis'), pS('int'), pS('Integer'), pS(''), pI(2)]),
        node('P', [pS('FrontAxisSign'), pS('int'), pS('Integer'), pS(''), pI(1)]),
        node('P', [pS('CoordAxis'), pS('int'), pS('Integer'), pS(''), pI(0)]),
        node('P', [pS('CoordAxisSign'), pS('int'), pS('Integer'), pS(''), pI(1)]),
        node('P', [pS('OriginalUpAxis'), pS('int'), pS('Integer'), pS(''), pI(origAxis)]),
        node('P', [pS('OriginalUpAxisSign'), pS('int'), pS('Integer'), pS(''), pI(1)]),
        node('P', [pS('UnitScaleFactor'), pS('double'), pS('Number'), pS(''), pD(100)]),
        node('P', [pS('OriginalUnitScaleFactor'), pS('double'), pS('Number'), pS(''), pD(1)]),
        node('P', [pS('AmbientColor'), pS('ColorRGB'), pS('Color'), pS(''), pD(0), pD(0), pD(0)]),
        node('P', [pS('DefaultCamera'), pS('KString'), pS(''), pS(''), pS('Producer Perspective')]),
        node('P', [pS('TimeMode'), pS('enum'), pS(''), pS(''), pI(11)]),
        node('P', [pS('TimeSpanStart'), pS('KTime'), pS('Time'), pS(''), pL(0)]),
        node('P', [pS('TimeSpanStop'), pS('KTime'), pS('Time'), pS(''), pL(46186158000)]),
        node('P', [pS('CustomFrameRate'), pS('double'), pS('Number'), pS(''), pD(24)])
      ])
    ]);

    const docId = id();
    const documents = node('Documents', [], [
      node('Count', [pI(1)]),
      node('Document', [pI(docId), pS(''), pS('Scene')], [
        node('Properties70', [], [
          node('P', [pS('SourceObject'), pS('object'), pS(''), pS('')]),
          node('P', [pS('ActiveAnimStackName'), pS('KString'), pS(''), pS(''), pS('')])
        ]),
        node('RootNode', [pL(0)])
      ])
    ]);

    const defs = node('Definitions', [], [
      node('Version', [pI(100)]),
      node('Count', [pI(7 + objects.length)])
    ].concat([
      node('ObjectType', [pS('GlobalSettings')], [node('Count', [pI(1)])]),
      node('ObjectType', [pS('Model')], [node('Count', [pI((noSkeleton ? 0 : sc.bones.length) + models.length + (noSkeleton ? 0 : 1))])]),
      node('ObjectType', [pS('NodeAttribute')], [node('Count', [pI(noSkeleton ? 0 : sc.bones.length)])]),
      node('ObjectType', [pS('Geometry')], [node('Count', [pI(geoms.length)])]),
      node('ObjectType', [pS('Material')], [node('Count', [pI(mats.length)])]),
      node('ObjectType', [pS('Texture')], [node('Count', [pI(texRecords.length)])]),
      node('ObjectType', [pS('Video')], [node('Count', [pI(texRecords.length)])]),
      node('ObjectType', [pS('Deformer')], [node('Count', [pI(noSkeleton ? 0 : clusters.length + (clusters.length ? 1 : 0))])]),
      node('ObjectType', [pS('Pose')], [node('Count', [pI(noSkeleton ? 0 : (sc.bones.length ? 1 : 0))])])
    ]));

    const connNode = node('Connections', [], connections.map(function (c) {
      const props = [pS(c.type), pL(c.child), pL(c.parent)];
      /* OP: Texture → Material kèm TÊN PROPERTY (DiffuseColor/NormalMap...).
         Thiếu tên property thì Mixamo/Blender không gắn được texture vào material → mất màu. */
      if (c.prop !== undefined) props.push(pS(c.prop));
      return node('C', props);
    }));

    const takes = node('Takes', [], [node('Current', [pS('')])]);

    /* ---------------- assemble ---------------- */
    const roots = [header,
      node('FileId', [pR(new Uint8Array([0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0x52, 0xbe, 0x8b, 0x6f, 0xa0, 0xb5, 0x2d]))]),
      node('CreationTime', [pS(now.toISOString())]),
      node('Creator', [pS('Blender (FBX Binary 7.4.0)')]),
      globalSettings, documents,
      node('References', [], []),
      defs, node('Objects', [], objects), connNode, takes];

    /* ---- nhánh ASCII (opts.ascii) ----
     * Header kiểu FBX 2013 ASCII: "FBXHeaderExtension + FileId + CreationTime + Creator" ở dạng text,
     * sau đó tới cây node y hệt bản binary. Dùng CÙNG roots nên nội dung khớp 1:1. */
    if (opts.ascii) {
      const vi = VERSION_ASCII;
      const lines = [];
      lines.push('; FBX 7.3.0 project file');
      lines.push('; Created by PixiJS Studio x Tripo3D AI Studio (Mixamo-ready)');
      lines.push('; ----------------------------------------------------');
      lines.push('');
      /* "khai báo" file/version dạng comment có chứa đủ từ khóa FBX */
      lines.push('FBXHeaderExtension:  {');
      lines.push('\tFBXHeaderVersion: 1003');
      lines.push('\tFBXVersion: ' + vi);
      lines.push('\tEncryptionType: 0');
      lines.push('\tCreationTimeStamp:  {');
      lines.push('\t\tVersion: 1000');
      lines.push('\t\tYear: ' + now.getFullYear() + '\n\t\tMonth: ' + (now.getMonth() + 1) + '\n\t\tDay: ' + now.getDate());
      lines.push('\t\tHour: ' + now.getHours() + '\n\t\tMinute: ' + now.getMinutes() + '\n\t\tSecond: ' + now.getSeconds() + '\n\t\tMillisecond: ' + now.getMilliseconds());
      lines.push('\t}');
      lines.push('\tCreator: "PixiJS Studio x Tripo3D AI Studio (Mixamo-ready)"');
      lines.push('}');
      /* toàn bộ cây còn lại trừ FBXHeaderExtension/Creator (đã viết tay phía trên) */
      roots.filter(function (n) { return n.name !== 'FBXHeaderExtension'; })
        .forEach(function (n) { asciiNode(n, 0, lines); });
      /* đuôi file: null + magic + foo (FBX SDK cũng đọc đuôi ở bản ASCII) */
      const enc = new TextEncoder();
      const head = enc.encode(lines.join('\n') + '\n');
      const tailNull = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const tailFoo = new Uint8Array(16 + 1 + 4 + 120 + 16);
      for (let i = 0; i < 16; i++) tailFoo[i] = FOOTER_MAGIC[i];
      tailFoo[16] = 0;
      new DataView(tailFoo.buffer).setUint32(17, vi, true);
      for (let i = 0; i < 16; i++) tailFoo[tailFoo.length - 16 + i] = FOOTER_MAGIC[i];
      const asc = new Uint8Array(head.length + tailNull.length + tailFoo.length);
      asc.set(head, 0); asc.set(tailNull, head.length); asc.set(tailFoo, head.length + tailNull.length);
      return {
        bytes: asc,
        report: {
          bytes: asc.length, format: 'FBX-ASCII-7.3', version: vi,
          meshes: sc.meshes.length, bones: noSkeleton ? 0 : sc.bones.length,
          clusters: noSkeleton ? 0 : clusters.length, materials: mats.length,
          geometryIds: geoms.length, hasSkin: useSkin && clusters.length > 0,
          upAxis: xformApplied ? ('baked: ' + upAxisName + ' → Y, feet at y=0') : 'kept as-is',
          srcUpAxis: upAxisName,
          version: ver, unitScale: +unitScale.toFixed(4), meshOnly: !!noSkeleton
        }
      };
    }

    const headerBytes = new TextEncoder().encode(MAGIC);
    let offset = headerBytes.length + 4;
    let bodySize = 0;
    roots.forEach(function (n) { bodySize += nodeSize(n); });
    bodySize += 13;   /* null record cuối top-level (13 byte căn chỉnh, giá trị 0) */

    const out = new Uint8Array(offset + bodySize);
    out.set(headerBytes, 0);
    new DataView(out.buffer).setUint32(headerBytes.length, ver, true);
    let pos = offset;
    roots.forEach(function (n) {
      const b = writeNode(n, pos);
      out.set(b, pos);
      pos += b.length;
    });
    pos += 13;   /* null record */
    /* --- phần đuôi file (FBX SDK trailer) ---
     * Ngay sau null record: u32 0, 0, refId, encrypted0, footerLen(160) rồi foo:
     *   [magic 16] [\0 + pad] [u32 VERSION] [era 0*120] [magic 16]
     * Một số công cụ dùng FBX SDK (3ds Max, Mixamo pipeline) dựa vào phần này để xác
     * nhận file không cụt — thiếu thì báo "Unsupported FBX type" dù cây node hợp lệ.
     * -------------------------------------------------------------------------- */
    const foo = new Uint8Array(25 + 4 + 120 + 16);
    for (let i = 0; i < 16; i++) foo[i] = FOOTER_MAGIC[i];
    foo[16] = 0;
    new DataView(foo.buffer).setUint32(21, ver, true);
    for (let i = 0; i < 16; i++) foo[foo.length - 16 + i] = FOOTER_MAGIC[i];
    const trailer = new Uint8Array(20 + foo.length);
    new DataView(trailer.buffer).setUint32(16, foo.length, true);
    trailer.set(foo, 20);
    const bytes = new Uint8Array(out.length + trailer.length);
    bytes.set(out, 0);
    bytes.set(trailer, out.length);

    return {
      bytes: bytes,
      report: {
        bytes: bytes.length,
        format: ver === 7300 ? 'FBX-Binary-7.3' : 'FBX-Binary-7.4',
        meshes: sc.meshes.length,
        bones: noSkeleton ? 0 : sc.bones.length,
        clusters: noSkeleton ? 0 : clusters.length,
        materials: mats.length,
        geometryIds: geoms.length,
        hasSkin: noSkeleton ? false : clusters.length > 0,
        textures: texRecords.length,
        textureReport: texReport,
        upAxis: xformApplied ? ('baked: ' + upAxisName + ' → Y, feet at y=0') : 'kept as-is',
        srcUpAxis: upAxisName,
        version: ver,
        versionName: ver === 7300 ? 'FBX 2013' : (ver === 7400 ? 'FBX 2014' : 'FBX ' + ver),
        unitScale: +unitScale.toFixed(4),
        meshOnly: !!noSkeleton
      }
    };
  };

  /* ---------------- minimal reader để tự kiểm tra ---------------- */
  FbxBinary.read = function (bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = 27;   /* 20 magic + 3 (00 1a 00) + 4 version */
    const nodes = [];
    const readNode = function (depth) {
      if (off + 13 > bytes.length) return null;
      const end = dv.getUint32(off, true);
      const numProps = dv.getUint32(off + 4, true);
      const propLen = dv.getUint32(off + 8, true);
      const nameLen = bytes[off + 12];
      if (end === 0 && numProps === 0 && propLen === 0 && nameLen === 0) { off += 13; return null; }
      const name = new TextDecoder().decode(bytes.subarray(off + 13, off + 13 + nameLen));
      off += 13 + nameLen + propLen;
      const children = [];
      while (off < end) {
        const c = readNode(depth + 1);
        if (!c) break;
        children.push(c);
      }
      if (off < end) off = end;
      return { name: name, children: children };
    };
    while (off < bytes.length - 16) {
      const n = readNode(0);
      if (!n) break;
      nodes.push(n);
    }
    return nodes;
  };

  /* Dùng chung cho exporter khác (OBJ+MTL ZIP cần cùng bytes ảnh, cùng quy tắc lật) */
  FbxBinary.encodeTexture = encodeTextureToBytes;

  window.PixiStudio.FBXBinary = FbxBinary;
})();