# Sửa Export FBX để import được vào Mixamo

Ngày: 2026-11-23. File sửa duy nhất: `js/exporter/fbx-binary.js`
(không đổi API `FBXBinary.write`, không đổi opts, không đụng `save-manager.js` —
hai nút Mixamo đã truyền đúng `version: 7300` từ trước).

## Triệu chứng

File FBX xuất từ studio mở được trong three.js / Blender nhưng Mixamo
(`https://www.mixamo.com/#/`, Characters → Upload Character) từ chối.
Nguyên nhân: three.js `FBXLoader` bỏ qua footer, còn Mixamo dùng FBX SDK —
SDK kiểm tra footer, `Definitions/Count` và bộ ba
CreationTime + FileId + foot-id rất nghiêm.

## Lỗi đã sửa

### 1. Footer binary sai hoàn toàn — NGUYÊN NHÂN CHÍNH (fbx-binary.js, `buildFooter`)

Trước đây writer ghi footer 165B:

```
[FOOTER_MAGIC 16B] [0] [4B 0] [u32 version @ offset 21] [120B 0] [FOOTER_MAGIC 16B]
```

kèm thêm 20B "pre-footer" chứa `footerLength` không khớp thực tế.
Sai 3 chỗ so với chuẩn FBX SDK / Blender (đã kiểm chứng trên file Meshy
thật `Meshy_AI_tripo_convert_monter1_20261122_texture.fbx`, upload Mixamo OK,
và trên source Blender `io_scene_fbx/encode_bin.py`, hàm `write()`):

- **foot-id sai**: phải là `FA BC AB 09 D0 C8 D4 66 B1 76 FB 83 1C F7 26 7E`,
  writer ghi nhầm `FOOTER_MAGIC` (`F8 5A 8C 6A ...`).
- **version không căn 16**: SDK đọc version u32 ở offset chia hết cho 16
  tính từ đầu file. Writer ghi ở offset cố định `footer+21` → SDK đọc
  được giá trị rác/0 → `"Unsupported FBX type"`.
- **thừa pre-footer 20B**: chuẩn không có trường `footerLength` nào.

Footer đúng (đã áp dụng cho cả binary lẫn ASCII qua hàm `buildFooter(ver, footStart)`):

```
[foot-id 16B] [4B số 0] [padding 0 × 1..16B sao cho version ở offset % 16 == 0]
[u32 version] [120B số 0] [magic 16B]
```

Công thức padding y hệt Blender:
`pad = ((ofs + 15) & ~15) - ofs` (ofs = sau foot-id + 4B 0), `pad == 0 → 16`.
Hằng `TRAILER_BIN` / `TRAILER_ASCII` cũ (không dùng tới) đã bị xoá.

### 2. `Definitions/Count` sai (fbx-binary.js, phần `defs`)

Trước: `Count = 7 + objects.length`. File thật: `Count = objects.length + 1`
(số object trong `Objects` + 1 node gốc id 0 không nằm trong `Objects`).
Ví dụ file Meshy: Count 12 = 11 Objects + 1. Đã sửa thành `objects.length + 1`.

### 3. `ObjectType` count = 0 vẫn được liệt kê (fbx-binary.js, phần `defs`)

File thật (Meshy, Blender) chỉ liệt kê type đang dùng. Trước đây bản
mesh-only vẫn ghi `NodeAttribute`, `Deformer`, `Pose`, `Texture`, `Video`
với Count 0. Nay lọc bỏ các type có count = 0.

### 4. `CreationTimeStamp` ghi thời gian hiện tại (fbx-binary.js, `FIXED_TS`)

FBX SDK kiểm tra bộ ba CreationTime + FileId + foot-id có khớp nhau không.
Writer đã dùng FileId cố định của Blender (`28 b3 2a eb ...`) nhưng lại ghi
thời gian hiện tại → tổ hợp lệch. Nay ghi cố định theo Blender:
`1970-01-01 10:00:00.000` (cả `CreationTimeStamp` lẫn node `CreationTime`,
cả hai đường binary và ASCII).

### 5. Chuỗi `Creator` không khớp version (fbx-binary.js, phần `roots`)

Trước: luôn ghi `'Blender (FBX Binary 7.4.0)'` kể cả khi xuất 7300.
Nay ghi `7.3.0` khi `ver === 7300`, `7.4.0` khi 7400.

## Đã kiểm tra và KẾT LUẬN ĐÚNG (không sửa)

- **(a) Version 7300**: cả hai nút Mixamo đều truyền đúng —
  `saveFBXMixamo` (`save-manager.js` ~dòng 663) và `saveFBXMixamoRig`
  (~dòng 766) đều có `version: 7300`; preset Mixamo trong
  `export-presets.js` cũng là 7300.
- **(b) GlobalSettings**: `UpAxis = 1` (Y) đúng; `UnitScaleFactor = 100`
  (mét) là đúng vì geometry được auto-scale về cao ~1.8 đơn vị →
  1.8 × 100 = 180 cm, đúng chuẩn người Mixamo. (File Meshy thật dùng
  USF = 1.0 với geometry ~180 đơn vị — tương đương 180 cm.)
- **(c) Connections**: đủ và đúng chiều (đã đối chiếu `X Bot.fbx`):
  Mesh → root 0, Geometry → Mesh, Material → Mesh, Skin → **Geometry**
  (không phải Model), Cluster → Skin, LimbNode → Cluster, LimbNode cha-con,
  NodeAttribute → LimbNode, Pose không cần connection.
- **(d) Takes**: `Takes: { Current: "" }` khớp y hệt file Meshy thật.
- **(f) Geometry**: Normal `ByPolygonVertex`, UV `ByPolygonVertex` +
  `IndexToDirect`, `PolygonVertexIndex` đúng chuẩn (đỉnh cuối mỗi tam giác
  là `~index`).
- **(g) Đường mesh-only** (`prepareMixamo` / `noSkeleton`): tạo file
  mesh-only hợp lệ (1 mesh, 0 bone, không Deformer/Pose) — Mixamo tự
  auto-rig được. Không thiếu BindPose/Skin vì đường này cố tình bỏ skeleton.
- **(i) Không còn lỗi cấu trúc khác**: không id trùng, không thiếu node
  bắt buộc; `FBXLoader` parse được cả 3 đường xuất.

## Kiểm thử

Harness mới: `~/workspace/.test-fbx/test-fbx-mixamo.js` (node, three r128 +
jsdom). Nhân vật mẫu: 5 xương `mixamorig:*` + mesh box có skin weights + UV.
Kiểm tra: header/version 7300, GlobalSettings, Definitions Count,
ObjectType, Connections, Geometry (Normal/UV/PVI), Takes, footer chuẩn SDK
(foot-id + version ở offset % 16 == 0 + magic cuối file), `FBXLoader`
parse lại (đủ mesh/skeleton/skin, cao 1.8), `MixamoValidator.check`,
hồi quy xuất mặc định 7400, và đối chiếu cùng bộ kiểm tra với file Meshy thật.

**Kết quả: 73/73 PASS, chạy 2 lần đều pass** (lần 1 sau sửa, lần 2 xác nhận).
Cross-check: `node tools/fbx-validate-mixamo.mjs out-mixamo-rig.fbx` và
`out-mixamo-meshonly.fbx` — cả hai đều **"Tất cả kiểm tra ĐẠT"**
(16/16 kiểm tra của validator repo). Đường ASCII (`opts.ascii`) cũng đã
được smoke-test: footer đúng (version 7300 ở offset chia hết cho 16).

## Lưu ý

- Việc import lên Mixamo thật vẫn cần user tự thử (cần tài khoản Adobe) —
  đây là lần đầu file xuất ra có footer/Definitions đúng chuẩn SDK, nên
  khả năng cao sẽ được chấp nhận; nếu Mixamo vẫn báo lỗi, copy nguyên
  văn thông báo lỗi để đối chiếu tiếp.
- `save-manager.js` không cần sửa; nút "Save Mixamo" (mesh-only) và
  "Save Mixamo Rig" (có skeleton) đều dùng chung writer đã sửa.
