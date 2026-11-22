# Sửa lỗi FBX (Mixamo) + di chuyển object theo X/Y/Z

**Ngày:** 22/11/2026 · **Server:** `http://127.0.0.1:8099`

---

## 1. FBX bị Mixamo từ chối

### Chẩn đoán

Bộ xuất cũ (`exportFBXAscii` trong [save-manager.js](<js/exporter/save-manager.js>)) ghi **FBX ASCII** và **chỉ có Geometry**:

| Thành phần | File cũ | Mixamo yêu cầu |
|---|---|---|
| Định dạng | ASCII text | **Binary** 7.4 (header `Kaydara FBX Binary`) |
| Skeleton | ❌ không có bone | ✅ phải có |
| Skin weight | ❌ không có | ✅ phải có |
| Bind pose | ❌ | ✅ |

Vì vậy Mixamo báo lỗi và không hiện hình — đúng như phản ánh. Đối chiếu với file FBX chuẩn do Meshy tạo (`assets/models/Meshy_AI_.../..._Running.fbx`, header binary 7400, có 47 `NodeAttribute`, 48 `Model`, 47 `Deformer`, 1 `Pose`) càng xác nhận: thiếu rig là nguyên nhân.

### Đã làm: bộ ghi FBX Binary 7.4 mới

File mới [fbx-binary.js](<js/exporter/fbx-binary.js>) ghi đúng cấu trúc mà FBX SDK / Mixamo / Blender đọc:

| Section | Nội dung |
|---|---|
| Header | `Kaydara FBX Binary  \0\x1a\0` + u32 `7400` + footer 16-byte magic |
| `FBXHeaderExtension` | version, CreationTimeStamp, Creator |
| `GlobalSettings` | UpAxis, FrontAxis, CoordAxis, UnitScaleFactor |
| `Documents`, `References`, `Definitions` | khai báo đủ loại object + số lượng |
| `Objects: Geometry` | `Vertices` (d), `PolygonVertexIndex` (i, đỉnh cuối = `~index`), `LayerElementNormal` (ByPolygonVertex/Direct), `LayerElementUV` (IndexToDirect), `LayerElementMaterial`, `Layer` |
| `Objects: Model` | `Model::Mesh` + `Model::LimbNode` cho từng bone + `Model::Armature` |
| `Properties70` | `Lcl Translation` / `Lcl Rotation` / `Lcl Scaling` / `DefaultAttributeIndex` / `InheritType` — đặt trong **Properties70** đúng như FBX chuẩn |
| `Objects: Deformer` | `Deformer::Skin` + `SubDeformer::Cluster` mỗi bone: `Indexes`, `Weights`, `Transform`, `TransformLink` |
| `Objects: Pose` | `BindPose` với `PoseNode` = ma trận world của từng bone |
| `Connections` | Model→Root, Geometry→Model, Material→Model, **Skin→Geometry**, Cluster→Skin, Bone→Cluster, bone hierarchy |
| `Takes` | rỗng (clip vẫn xuất qua GLB) |

Ba lỗi gốc đã tìm ra trong lúc làm và sửa:

1. **Mesh trang trí của bone bị xuất kèm** → file có 45 mesh (khối tím + cầu xanh) thay vì 1. Sửa: bỏ mọi mesh có `userData.isBoneVisual`.
2. **Transform không nằm trong `Properties70`** → ba.js `FBXLoader` báo `Cannot use 'in' operator to search for 'RotationOrder' in undefined`. Sửa: thêm `Lcl Translation/Rotation/Scaling` + `DefaultAttributeIndex` vào `Properties70` của mọi Model.
3. **Skin nối vào Model thay vì Geometry** → FBX đọc được nhưng `skinned = 0` (mesh không được skin, Mixamo vẫn từ chối). Sửa: `C: "OO", skinId, geometryId`. Đây là lỗi tinh vi nhất — FBXLoader và Blender đều tìm skin ở `relationships.children` của **Geometry**.

### Kiểm chứng

Xuất FBX từ nhân vật đã auto-rig ([monter1.glb](<assets/models/tripo_convert_monter1.glb>), 34.757 verts), rồi **nạp lại bằng `THREE.FBXLoader`** — một parser độc lập, mô phỏng đúng việc Mixamo/Blender đọc file:

| Chỉ số | Kết quả |
|---|---|
| Header | `Kaydara FBX Binary` · version **7400** |
| Node cấp 1 | FBXHeaderExtension, GlobalSettings, Documents, References, Definitions, Objects, Connections, Takes |
| Objects | Geometry 1 · Model 25 · NodeAttribute 23 · Deformer 24 · Pose 1 · Material 1 |
| Connections | 97 |
| **Nạp lại bằng FBXLoader** | **ok** |
| **Bone đọc được** | **23** |
| **SkinnedMesh** | **1** ✅ |
| Mesh | 1 (không còn mesh trang trí) |
| Kích thước model | 1,518 × 2 × 0,936 (khớp model gốc cao 2) |
| Page error | 0 |

File mẫu xuất ra: [sample-export.fbx](<docs/m2m-v10/sample-export.fbx>) (7,07 MB, 23 bone, 1 skin cluster/bone)

### Thay đổi kèm theo

- Save Center `fbx` giờ ghi **binary có skin** (ASCII chỉ còn là fallback khi thiếu module), tên format đổi thành **“FBX Binary (Mixamo-ready)”**.
- Thông báo sau khi lưu nói rõ số mesh / bone / skin cluster và cảnh báo nếu **chưa có skin** (phải Auto-Rig trước khi upload Mixamo).

---

## 2. Không di chuyển được object theo trục X/Y/Z

Có **hai** nguyên nhân khác nhau ở hai trang:

### 2.1 `index.html` — gizmo bị chặn sự kiện

[interaction.js](<js/viewport/interaction.js>) bắt `pointerdown` ở **capture phase** trên `#viewport-canvas-wrap` và gọi `stopPropagation()` kể cả khi con trỏ đang ở trên tay cầm gizmo → `TransformControls` (gắn trên `#three-canvas`) không nhận được sự kiện ⇒ gizmo hiện ra nhưng kéo không chạy.

Sửa: nếu `tc.dragging` hoặc `tc.axis` khác null thì `return` ngay, không chặn sự kiện; `pointermove` cũng bỏ hover-highlight khi con trỏ trên gizmo.

Đo bằng chuột thật (kéo 96 px mỗi trục): **X +0,648 · Y +0,666 · Z +0,845**.

### 2.2 Bổ sung điều khiển trực tiếp (cả hai trang)

Vì gizmo khó bấm chính xác, thêm khối **OBJECT XYZ** luôn dùng được:

| Trang | Thêm mới |
|---|---|
| `index.html` | trong panel Camera & Scene: 3 ô nhập **X/Y/Z**, 6 nút **Y ▲ Y ▼ Z ▲ Z ▼ X ▲ X ▼** (bước 0,25), Drop floor, Reset |
| `mesh2motion.html` | **trước đây không có công cụ di chuyển nào** → thêm `TransformControls` (Move/Rotate/Scale) + panel **Object Transform** (nhập XYZ, nudge 6 hướng, Drop floor, Reset) |

### Kiểm thử

`index.html`:

| Thao tác | Vị trí sau |
|---|---|
| Y ▲ | (0, **0,25**, 0) |
| Y ▼ | (0, 0, 0) |
| Z ▲ | (0, 0, **0,25**) |
| X ▲ | (**0,25**, 0, 0,25) |
| Nhập số Y = 1.5 | (0, **1,5**, 0,25) |

`mesh2motion.html`:

| Thao tác | Kết quả |
|---|---|
| Gizmo tồn tại / hiện / mode | ✅ / ✅ / `move` |
| Reset | (0, 0, 0) |
| Nudge Y +0,5 | (0, **0,5**, 0) |
| Nudge Z +0,3 | (0, 0,5, **0,3**) |
| Nút UI “Y ▲” | (0, **0,75**, 0,3) |
| Đổi mode Rotate | gizmo mode = `rotate` |
| Drop floor | y = **0** |
| Panel Object Transform | 11 nút |
| Page error (cả 2 trang) | **0** |

Ảnh: [m2m-object-panel.png](<docs/m2m-v10/m2m-object-panel.png>) · gizmo: [gizmo-xyz.json](<docs/m2m-v10/gizmo-xyz.json>)

---

## 3. File thay đổi

**Mới**
- [fbx-binary.js](<js/exporter/fbx-binary.js>) — FBX Binary 7.4 writer (mesh + skeleton + skin + bind pose) + reader để tự kiểm tra

**Sửa**
- [save-manager.js](<js/exporter/save-manager.js>) — `case 'fbx'` dùng writer binary, đổi tên/format descriptor
- [interaction.js](<js/viewport/interaction.js>) — nhường quyền cho gizmo + khối OBJECT XYZ (nhập số + nudge)
- [m2m-engine.js](<js/m2m/m2m-engine.js>) — TransformControls, `nudge`, `applyTransform`, `dropToFloor`, `resetTransform`, `transformState`
- [m2m-ui.js](<js/m2m/m2m-ui.js>) — panel Object Transform
- [mesh2motion.html](<mesh2motion.html>) — nạp TransformControls + khối panel
- [layout.css](<css/layout.css>) — style `.ix-num`

**Kiểm thử**: [qa-fbx.mjs](<tools/qa-fbx.mjs>), [qa-move.mjs](<tools/qa-move.mjs>), [qa-gizmo3.mjs](<tools/qa-gizmo3.mjs>), [qa-gizmo4.mjs](<tools/qa-gizmo4.mjs>), [qa-gizmo-z.mjs](<tools/qa-gizmo-z.mjs>)

## 4. Giới hạn / cần biết

- **Chưa upload thử lên Mixamo** (trang yêu cầu đăng nhập tài khoản). Bằng chứng hiện có: file binary 7400 hợp lệ, **nạp lại thành công bằng FBXLoader với đúng 23 bone và 1 SkinnedMesh**, cấu trúc khớp file FBX chuẩn do Meshy tạo mà Mixamo đã chấp nhận. Nếu Mixamo vẫn từ chối, nghi vấn tiếp theo là đơn vị (cm vs m) và việc thiếu texture nhúng — cả hai đều chỉnh được nhanh.
- **FBX chưa chứa animation**: mục tiêu là để Mixamo tự gán motion. Muốn nhúng clip thì dùng **GLB + Animation** (đã có) hoặc mở rộng writer thêm `AnimationStack/AnimationCurve`.
- FBX dùng double cho vertices/normals nên file lớn (≈7 MB cho 34,7k verts). Có thể giảm bằng cách nén zlib từng array (encoding = 1) ở lần sau.
- FBX chỉ có rig khi model **đã Auto-Rig** trong Studio; nếu xuất ngay sau khi import mesh tĩnh thì file vẫn hợp lệ nhưng không có skin (thông báo sẽ cảnh báo).