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

## Lần 2 — FileId sai + Object ID ghi int32 (2026-11-23, sửa sau khi user báo vẫn lỗi)

Dù đã sửa footer (lần 1), Mixamo vẫn báo (ảnh chụp màn hình user):

> `ERROR on mapping character: Unsupported FBX type. Please use FBX files 2013 or earlier.`
> `Sorry, unable to map your existing skeleton.`

### Bằng chứng mới: FBX SDK đọc file ra scene RỖNG

Cài `fbx2gltf` (npm, dùng Autodesk FBX SDK thật — `FBX2glTF 0.9.7`,
binary `bin/Linux/FBX2glTF`) và chạy lên các file do writer tạo:

| File | Trước lần 2 | Sau lần 2 |
|---|---|---|
| `thandieu-Mixamo.fbx` | glTF 782B, buffer 0B, **0 mesh** | glTF 3891B, buffer 910.268B, **1 mesh `than_dieu`** |
| `XBot-Mixamo.fbx` | glTF 782B, buffer 0B, **0 mesh** | glTF 84MB, buffer 4.979.072B, **1 mesh + 1 skin (50 joints) + 68 nodes** |
| File Meshy thật (chuẩn) | 1 mesh, buffer 1.414.528B | — |
| File X Bot.fbx gốc (ASCII 7700) | 2 mesh, 2 skin, 68 nodes | — |

SDK đọc được file (exit 0, không lỗi) nhưng **không thấy object nào** —
đây mới là lý do Mixamo báo "Unsupported FBX type": nó map mọi lỗi
đọc scene thành thông báo version. three.js `FBXLoader` vẫn đọc được
vì nó dễ tính, không phải bằng chứng file đúng chuẩn SDK.

### Lỗi gốc 2a — FileId SAI (nguyên nhân chính, `fbx-binary.js`, node `FileId`)

Writer lần 1 dùng FileId:

```
28 B3 2A EB B6 24 CC C2 BF 52 BE 8B 6F A0 B5 2D   ← SAI
```

FileId đúng (Blender `io_scene_fbx/encode_bin.py`: `_FILE_ID`, assimp
`FBXExporter.cpp`: `GENERIC_FILEID`, file Meshy thật) là:

```
28 B3 2A EB B6 24 CC C2 BF C8 B0 2A A9 2B FC F1   ← ĐÚNG
```

9 byte đầu giống nhau, **7 byte cuối khác**. FBX SDK kiểm tra bộ ba
CreationTime + FileId + foot-id theo CRC dựa trên timestamp (quy tắc
không công khai — Blender ghi chú: "fbx has very strict CRC rules, all
based on file timestamp... write files at a fixed time"). Tổ hợp đúng
Blender dùng (và nay writer dùng):

- `CreationTime` = `1970-01-01 10:00:00:000` (đã đúng từ lần 1)
- `FileId` = `28 B3 2A EB B6 24 CC C2 BF C8 B0 2A A9 2B FC F1`
- `FootId` = `FA BC AB 09 D0 C8 D4 66 B1 76 FB 83 1C F7 26 7E` (đã đúng từ lần 1)

**Cách tìm ra (bisect có bằng chứng):** viết trình đọc record nghiêm ngặt
(`~/workspace/.test-fbx/fbx-strict-reader.js`, kiểm tra endOffset mọi
record — file của ta và file Meshy đều PASS, nên cấu trúc record không
phải lỗi), rồi dùng công cụ ghép cây FBX (`fbx-tool.py`, parse → cây →
serialize lại, đã kiểm chứng round-trip file Meshy vẫn đọc được):
ghép "vỏ" (header/Definitions/Documents...) của file Meshy với
Objects/Connections của ta → SDK đọc được mesh (vỏ ta hỏng);
ghép ngược lại → SDK không đọc được (Objects ta không có lỗi).
Bisect từng section của vỏ: chỉ thay **FileId** sang của Meshy là
SDK đọc được mesh. Thay 1 byte bất kỳ trong 7 byte cuối FileId
(đã thử 5 biến thể: đổi byte cuối, byte đầu đuôi, byte giữa, prefix
về 0, đuôi lai) đều làm SDK trả scene rỗng → SDK kiểm tra FileId
theo CRC chính xác từng byte.

### Lỗi gốc 2b — Object ID ghi int32 thay vì int64 (đã sửa kèm)

Đối chiếu kiểu property từng node với file Meshy thật: file thật ghi
mọi object ID bằng int64 (`Geometry [LSS]`, `Model [LSS]`,
`Material [LSS]`, `Document [LSS]`), còn writer ghi int32
(`[ISS]`) trong khi Connections đã dùng int64 (`C [SLL]`).
Đã đổi sang `pL` cho mọi ID object: Geometry, Model (mesh/bone/armature),
NodeAttribute, Deformer (Skin/Cluster), PoseNode.Node, Pose, Material,
Video, Texture, Document (13 chỗ). Các `Version`/`Count`/P-int vẫn giữ
`pI` như file thật. Lưu ý: thí nghiệm ghép vỏ cho thấy lỗi này một mình
không chặn SDK (file ghép E1 dùng ID int32 vẫn đọc được khi FileId đúng),
nhưng `pL` mới đúng chuẩn SDK nên giữ.

### Kiểm thử lần 2 (vòng lặp liên tục)

Mỗi lần sửa xong chạy lại toàn bộ, 2 vòng đều đạt:

- (a) Harness cũ: `test-thandieu-mixamo.js` **20/20**,
  `test-xbot-mixamo.js` **39/39**, `test-fbx-mixamo.js` **73/73**
  (chạy 2 lần).
- (b) `tools/fbx-validate-mixamo.mjs` lên cả 2 file:
  **"Tất cả kiểm tra ĐẠT" (16/16)**.
- (c) `fbx2gltf` (SDK thật) — **TIÊU CHÍ CHÍNH**: thandieu 1 mesh,
  XBot 1 mesh + 1 skin (50 joints) + 68 nodes; cả 2 file harness
  `out-mixamo-rig.fbx` (1 mesh + 1 skin + 8 nodes) và
  `out-mixamo-meshonly.fbx` (1 mesh) cũng đọc được.
- (d) Trình đọc record nghiêm ngặt `fbx-strict-reader.js`: cả 2 file
  **STRICT PARSE OK** (mọi endOffset khớp, footer version 7300 ở offset
  chia hết cho 16); đã sửa reader 2 lần trong quá trình làm (foot-id
  thật là `FA BC AB 09...`, không phải closing magic `F8 5A 8C 6A...`).

File đã làm lại bằng exporter sửa: `~/workspace/.test-fbx/thandieu-Mixamo.fbx`
(6.531.740 B) và `~/workspace/.test-fbx/XBot-Mixamo.fbx` (7.314.892 B),
qua `convert-thandieu.js` và `fix-xbot-mixamo.js` (snapshot
`fbx-binary-snapshot.js` đã cập nhật bằng exporter mới).

## Lưu ý

- Việc import lên Mixamo thật vẫn cần user tự thử (cần tài khoản Adobe) —
  đây là lần đầu file xuất ra có footer/Definitions đúng chuẩn SDK, nên
  khả năng cao sẽ được chấp nhận; nếu Mixamo vẫn báo lỗi, copy nguyên
  văn thông báo lỗi để đối chiếu tiếp.
- `save-manager.js` không cần sửa; nút "Save Mixamo" (mesh-only) và
  "Save Mixamo Rig" (có skeleton) đều dùng chung writer đã sửa.

## Lần 3 — Nhúng texture (màu) + giữ UV khi giảm tris (2026-11-23)

**Triệu chứng user báo:** file `thandieu-Mixamo.fbx` mở được trên Mixamo rồi
nhưng "bị mất màu, vỡ ảnh" — muốn giống hệt file GLB gốc
(`tripo_convert_thandieu.glb`, có 3 ảnh JPEG 1024×1024: baseColor, normal,
metallicRoughness).

### 3.1. Mất màu: exporter đã hỗ trợ nhúng nhưng script chuyển đổi tắt nó

- Exporter `fbx-binary.js` đã có sẵn đường nhúng texture (`Video.Content` +
  `Texture` + connection `OP` vào Material, `opts.textureBytes` cho bytes
  lấy sẵn, mặc định BẬT khi `opts.embedTextures !== false`).
- Nhưng `convert-thandieu.js` xuất với `embedTextures: false` nên file ra
  không có texture nào → Mixamo hiện màu xám.
- Sửa: trích 3 ảnh JPEG từ GLB, đưa vào `opts.textureBytes` theo tên material
  (`tripo_mat_b362476f-...`), xuất với `embedTextures: true`. Nhúng 2/3 ảnh:
  baseColor → `map` (DiffuseColor, JPEG q92), normal → `normalMap`
  (NormalMap, PNG theo quy ước của encoder — tránh lỗi nén JPEG làm sai
  normal). RM (metallicRoughness) không nhúng vì Mixamo không dùng map PBR
  gộp này, exporter cũng không có slot cho nó.
- **Lật dọc ảnh trước khi nhúng:** FBX đọc ảnh bottom-up, glTF lưu top-down,
  exporter ghi UV nguyên gốc (không lật V) nên ảnh phải lật dọc — đúng như
  `encodeTextureToBytes` làm trong trình duyệt (canvas `flipY === false`).
  Trong Node dùng PIL (`flip-texture.py`).

### 3.2. Lỗi chặn thật: thiếu property `Path` trong Video.Properties70

File vòng 1 đã có đủ `Video.Content` đúng bytes + `Texture` + `OP`, vậy mà
`fbx2gltf` 0.9.7 (FBX SDK thật) vẫn báo `could not find a image file for
texture` và thay bằng ảnh 1×1. Đối chiếu file Meshy thật cho thấy Video của
nó có thêm trong Properties70:

```
P: "Path", "KString", "Url", "", "model.fbm/<file>"
```

FBX SDK (`FbxVideo::GetFileName`) đọc đường dẫn ảnh từ property `Path`
này, KHÔNG phải từ node `Filename` — thiếu nó thì SDK không tìm được ảnh
nhúng dù `Video.Content` đủ bytes. Chứng minh bằng bisect trên file Meshy:
chỉ thêm `Path` vào Video là đủ để fbx2gltf trích được ảnh (không cần thêm
`PremultiplyAlpha`/`UseMaterial` vào Texture).

**Sửa exporter** (`js/exporter/fbx-binary.js`, node `Video`): Properties70
không còn rỗng mà chứa `P: Path/KString/Url/""/<file>` (cùng đường dẫn với
`Filename`). Không đổi API `FBXBinary.write`, không mất fix FileId/footer.

### 3.3. "Vỡ ảnh": giảm tris bằng clustering theo vị trí thuần nhoè UV

- Mesh Tripo có rất nhiều UV seam: đỉnh cùng vị trí nhưng UV khác xa
  (vd. cùng vị trí (-0.025, 0.879, 0) mà UV 0.37/0.99 vs 0.43/0.04).
  Clustering cũ gộp theo vị trí rồi lấy trung bình UV → đo được 55,7% tam
  giác chạm cluster lệch UV > 0.05, lệch lớn nhất 0.99 (gần hết texture).
- Sửa `decimateUV` trong `convert-thandieu.js`: key cluster = vị trí + UV
  lượng tử hoá (uvQuant = 1/64) → chỉ gộp đỉnh có UV gần nhau. Kết quả ở
  cell 0.006: 50.000 → **43.133 tris**, lệch UV lớn nhất **0.0051** (~5
  texel ở 1024px), 0 tam giác chạm cluster lệch > 0.05.
- Tác dụng phụ: đỉnh seam không gộp nữa nên vị trí trung bình lệch nhau
  tới ~0.006 → validator đếm 10,02% cạnh hở. Thêm bước hàn vị trí
  (`weldPositions`, eps 0.003, union-find + gán về đúng 1 centroid, không
  động UV): cạnh hở 10,02% → **0,6%** (< 2%), dịch chuyển lớn nhất 0.008
  (0,8 cm ở tỉ lệ 1,8 m).

### 3.4. Kiểm chứng (vòng 3, đều đạt)

- Harness `~/workspace/.test-fbx/test-thandieu-mixamo.js`: **30/30 ×2** (mới
  thêm kiểm tra texture: Video.Content đúng 281.164 B JPEG + 935.709 B PNG,
  OP DiffuseColor/NormalMap, Path, UV trong [0,1], worstUvSpread ≤ 0.01).
- `tools/fbx-validate-mixamo.mjs`: **16/16** ("Tất cả kiểm tra ĐẠT").
- `fbx2gltf` 0.9.7: **không còn warning**, trích được đúng 2 file ảnh
  (md5 khớp byte với ảnh đã lật), glTF có `baseColorTexture` +
  `normalTexture`, mesh đầy đủ. (Lưu ý: vòng 1 fbx2gltf cho ảnh 1×1 là do
  thiếu `Path`, không phải do file sai — đã sửa ở §3.2.)
- Strict reader: **STRICT PARSE OK**; FileId đúng + footer version 7300 ở
  offset chia hết cho 16 vẫn còn.
- Hồi quy: `test-fbx-mixamo.js` 73/73, `test-xbot-mixamo.js` 39/39,
  `test-obj-texture.js` 29/29.

File mới: `~/workspace/.test-fbx/thandieu-Mixamo.fbx` — **8.140.892 B**,
binary FBX 7300, mesh-only, 43.133 tris, 2 texture nhúng (map JPEG 275 KB
+ normalMap PNG 914 KB).

**Lưu ý:** Mixamo chủ yếu dùng diffuse (map); normal map có thể không được
Mixamo hiển thị rõ trong viewer của họ (đó là giới hạn của Mixamo, không
phải lỗi file). Ảnh RM không nhúng — trên Mixamo model sẽ dùng độ bóng
mặc định.

## Lần 4 — Mixamo-safe export: mesh-only + tự decimate giữ UV (2026-11-24)

### 4.1. File Thiếu Lâm: exporter đúng nhưng Mixamo vẫn từ chối

File `tripo_convert_thieulam_mixamo-rig_211511.fbx` do chính studio xuất
(Rig 1 Lượt + Export FBX, đã dùng exporter sửa ở lần 1–3) vẫn bị Mixamo
từ chối, dù FBX SDK thật đọc được đầy đủ: binary FBX 7300, FileId đúng,
footer đúng, 1 mesh, 0 animation, 3 texture nhúng. Nguyên nhân là 3 yếu
tố cộng lại, KHÔNG nằm ở cấu trúc file:

- **Đúng 50.000 tris** = chạm ngưỡng auto-rig của Mixamo.
- **File CÓ skeleton** (65 xương `mixamorig:`, chỉ 24 xương có skin
  weights — 40 xương ngón tay + `HeadTop_End` không skin) nên Mixamo
  đi nhánh map-skeleton có sẵn thay vì auto-rig, mà bind pose A-pose
  (tay 138,6° so với trục dọc, không phải T-pose ~90°) → map thất bại
  ("unable to map your existing skeleton", cùng lỗi từng thấy ở X Bot).
- **Validator + pre-flight đều dùng `>`** (`mixamo-validator.js:103`
  `tris > MAX_TRIS`, `rig-oneclick.js:457` `tris0 > 50000`) nên đúng
  50.000 lọt qua mọi cửa kiểm tra — file lỗi ra đời dù đã qua pre-flight.

File làm lại bằng tay chứng minh công thức đúng
(`~/workspace/.test-fbx/thieulam-Mixamo.fbx`, 9.056.956 B): mesh-only
(bỏ skeleton, Mixamo tự auto-rig), decimate giữ UV xuống **46.917 tris**
(cell 0.007 + weld 0.004, cạnh hở 0,84%), nhúng baseColor JPEG 269.271 B
+ normalMap PNG 1.294.122 B byte-identical với gốc, FBX 7300, FileId
đúng — SDK đọc được, harness 31/31. File Thần Điêu round-3 tương tự
(43.133 tris). Vấn đề còn lại: đưa đúng công thức này vào NÚT EXPORT
để không phải làm tay nữa.

### 4.2. Thay đổi

**Mới — `js/exporter/mixamo-safe-export.js`** (`PixiStudio.MixamoSafeExport`,
nạp trong `index.html` sau `mixamo-validator.js`, trước `save-manager.js`):
`prepare(root)` trả `{ group, report }` — nhóm mesh-only an toàn cho Mixamo:

1. Clone geometry từng mesh, nướng `matrixWorld` vào, **bỏ skeleton/
   skinning** (xoá `skinIndex`/`skinWeight`, dựng lại bằng `THREE.Mesh`
   thường — KHÔNG clone `SkinnedMesh`, vì clone giữ `isSkinnedMesh` và
   skeleton). Material dùng chung (giữ texture để writer nhúng).
2. Chuẩn hoá tỉ lệ y hệt autoScale của `fbx-binary.js` (cao ngoài
   [1,2–3,5] thì scale về 1,8; đáy y=0, tâm X/Z về 0) để cỡ ô decimate
   (mét) ổn định với mọi model.
3. Nếu tổng tris >= 50.000 → sweep tối đa 5 ô
   `[0.007, 0.010, 0.015, 0.022, 0.028]`, dừng ở ô đầu tiên cho
   tris ≤ 47.000 VÀ cạnh hở < 2% VÀ UV spread ≤ 1/64. Thuật toán
   `decimateUV`/`weldPositions` port nguyên từ `convert-thieulam.js`
   (gom đỉnh theo vị trí + UV lượng tử hoá 1/64, trung bình vị trí/
   normal/UV/màu, rồi hàn eps 0.004); KHÔNG dùng `LODGenerator.decimate`
   (làm mất UV). Mesh đa-material (groups > 1) không giảm được nên giữ
   nguyên và tính vào tổng. Không ô nào đạt → trả `group: null` + lỗi
   rõ ("Không giảm được xuống dưới 47000...") — chặn đúng, không xuất
   file lỗi.
4. Đếm xương có/không skin (`countSkinUsage`): xương có skin weight
   > 0 ở ít nhất 1 vertex mới tính là "có skin". Nếu có xương không
   skin (vd 41/65 ở Thiếu Lâm) → cảnh báo tiếng Việt ghi rõ số xương
   bỏ/tổng, rằng skeleton sẽ được bỏ để Mixamo tự auto-rig lại.

**Ngưỡng validator — `js/exporter/mixamo-validator.js:103`:** `>` → `>=`
(đúng 50.000 phải chặn/cảnh báo). Validator vẫn là hàm thuần kiểm tra
model "như hiện tại"; vì nút export giờ tự decimate trước nên pre-flight
không chặn cứng ở ≥ 50k nữa — validator chỉ chạy trên nhóm ĐÃ chuẩn bị,
và chỉ chặn khi decimate xong vẫn không đạt. Hai mạch không mâu thuẫn.

**Gắn vào cả 3 đường xuất Mixamo** (giữ nguyên FBX 7300, Y-up,
UnitScaleFactor 100, `embedTextures: true`, 0 animation; nút export FBX
thường `fbx` KHÔNG đổi):

- `js/exporter/save-manager.js` — helper mới `prepareMixamoSafe(source)`
  + `saveFBXMixamo` và `saveFBXMixamoRig` đều: prepare → pre-flight
  trên nhóm đã chuẩn bị → ghi `FBXBinary.write` mesh-only
  (`noSkeleton: true`, `prepareMixamo: true`). Nút Rig vẫn dựng khung
  65 xương trong scene (để làm animation) nhưng KHÔNG xuất xương ra
  file; thông báo ghi rõ tris trước → sau + cảnh báo xương không skin.
- `js/rigging/rig-oneclick.js` — `buildExportBytes`: bỏ 2 pre-flight
  chặn cứng trên model gốc + check `tris0 > 50000`; thay bằng
  prepare → validate nhóm đã chuẩn bị → ghi mesh-only. Trả thêm
  `mixamoSafe: prepared.report`. Nút đổi nhãn thành "📥 Export Mixamo
  (mesh-only, Mixamo tự rig)" + footnote mới; `exportRiggedFBX` báo
  tris trước → sau. Tên file `*_rigged_mixamo.fbx` giữ nguyên.
- `index.html` — thêm script tag `mixamo-safe-export.js`; tooltip 2 nút
  topbar "Save Mixamo / Save Mixamo Rig" ghi rõ mesh-only < 50k tris.
  `js/ui/panels.js` — cập nhật comment 2 nút.

### 4.3. Kiểm chứng

- Harness mới `~/workspace/.test-fbx/test-mixamo-safe-export.js`:
  **40/40 × 2 vòng** — (a) sphere 59.600 tris → 41.173 tris (ô 0.028),
  không còn skin attributes/xương, UV spread 0,0150 ≤ 1/64, cạnh hở
  0,29%, nguồn không bị sửa; (b) đúng 50.000 tris → decimate xuống
  45.750 (không lọt qua như trước); (c) mesh 1.472 tris → không decimate
  thừa; (d) SkinnedMesh 3 xương/1 có skin → mesh-only + cảnh báo
  "2/3 xương không có skin weights"; (e) round-trip FBX: FBXLoader parse
  được (1 mesh, 0 xương), validator ok, CLI 16/16, fbx2gltf đọc được
  1 mesh/0 skin + trích được texture; (f) validator chặn 50.000, cho qua
  49.999; (g) vertex color giữ được khi decimate; (h) hộp lưới đều 66
  (52.272 tris, ngay cả ô 0.028 cũng chỉ còn 50.052) → prepare trả null
  + lỗi rõ.
- Hồi quy: `test-rig-oneclick.js` **41/41** (mục 3 + 7 cập nhật theo hành
  vi mesh-only mới; mục 7 dùng sphere 59.600 tris thay hộp 52.272),
  `test-fbx-mixamo.js` 73/73, `test-thieulam-mixamo.js` 31/31,
  `test-thandieu-mixamo.js` 30/30. `node --check` 0 lỗi trên 5 file
  mới/sửa. Server smoke 200 cho `index.html` + 5 file JS.
- Giới hạn còn lại: sweep tối đa 5 ô nên mesh lưới đều rất khó giảm
  (vd hộp 52.272 tris) vẫn bị chặn — đúng và trung thực, nhưng user phải
  giảm tay bằng Decimate/LOD; decimate trên máy yếu có thể mất vài giây
  (5 lần thử × decimate + weld trên ~150k verts) — nút đã có loading;
  mesh có `uv2`/morph target sẽ mất các attribute đó khi decimate
  (chỉ giữ position/normal/uv/color); chuẩn hoá tỉ lệ chỉ scale khi cao
  ngoài [1,2–3,5] (theo đúng writer) nên model đã ~1,8 m không đổi.

## Lần 5 — Weld eps tỉ lệ với cỡ ô (2026-11-25, sửa sau khi user báo export vẫn lỗi)

### 5.1. Triệu chứng mới

Sau lần 4 (commit d8baf649), user báo export vẫn không import vào được.
Kiểm tra bằng GLB Tripo thật (`tripo_convert_lenhhosung.glb`, đúng
50.000 tris, profile y hệt Thần Điêu) qua đúng 3 đường xuất của studio
trong Node (GLTFLoader r128 thật + jsdom): `MixamoSafeExport.prepare()`
CHẶN HẲN, không có file nào được tạo:

> Không giảm được xuống dưới 47000 tam giác (thử 5 ô, tốt nhất 23870
> tris, cạnh hở 19.5%) — hãy giảm tay bằng Decimate/LOD trước khi xuất

Nghĩa là lỗi của user KHÔNG chỉ do thử bản studio cũ trước d8baf649 —
đường xuất hiện tại vẫn có lỗi thật với model Tripo 50.000 tris.

### 5.2. Nguyên nhân gốc — weld eps cố định, ô decimate tăng dần

`prepare()` chuẩn hoá chiều cao về 1,8 m rồi sweep 5 ô
[0.007, 0.010, 0.015, 0.022, 0.028] với `weldPositions` eps CỐ ĐỊNH
0.004. Số liệu sweep trên lenhhosung (đo từng ô, trước/sau weld):

| ô | tris | cạnh hở trước weld | cạnh hở sau weld (eps 0.004) | kết quả |
|---|------|-------------------|------------------------------|---------|
| 0.007 | 47.564 | 4,50% | 0,08% | TRƯỢT — 47.564 > đích 47.000 (chỉ thừa 564) |
| 0.010 | 44.280 | 8,50% | 2,17% | TRƯỢT — vượt ngưỡng cạnh hở 2% (chỉ thừa 0,17%) |
| 0.015 | 37.629 | 13,68% | 8,72% | trượt |
| 0.022 | 28.843 | 18,47% | 15,89% | trượt |
| 0.028 | 23.870 | 21,04% | 19,53% | trượt |

Cả 5 ô đều trượt nên `prepare()` trả null → 2 nút export đều báo lỗi,
không tải file về. Cơ chế: khe hở sau decimate tỉ lệ với cỡ ô (tâm
cluster cách nhau ~ô), nên weld eps cố định chỉ hàn được khi ô ≤ 0.008;
ô càng lớn, các cặp seam càng nằm ngoài tầm eps → cạnh hở tăng vọt theo
ô. Mesh tamphong (ô 0.007 cho 46.642 tris, cạnh hở 0,06%) và coco
(ô 0.010 cho 45.921 tris, cạnh hở 1,96% — sát nút) thì lọt qua, nên lỗi
này phụ thuộc từng model — đúng kiểu "lúc được lúc không" user gặp.

### 5.3. Thay đổi (`js/exporter/mixamo-safe-export.js`, duy nhất 1 file)

- Weld eps trong sweep: `cellWeldEps = Math.max(WELD_EPS, cell * 0.5)`
  — tỉ lệ 0.5 = pipeline làm tay đã chứng minh (weld 0.003 ở ô 0.006
  trên file Thần Điêu/Thiếu Lâm). `WELD_EPS = 0.004` giờ là sàn, không
  còn là hằng số; thêm hằng `WELD_RATIO = 0.5`, export ra
  `MixamoSafeExport.WELD_EPS / WELD_RATIO`.
- `report` thêm `weldEps` (eps đã dùng ở ô được chọn / ô tốt nhất);
  thông báo "Đã tự giảm …" ghi thêm weld (vd "ô 0.01, weld 0.0050").
- API không đổi: `prepare(root, opts)` vẫn nhận `opts.weldEps` làm sàn;
  các harness cũ không cần sửa.

### 5.4. Kiểm chứng

- Sweep sau sửa (weld = max(0.004, ô×0.5)), cả 3 GLB Tripo mới:
  lenhhosung dừng ở ô 0.010 → 44.280 tris, cạnh hở 0,61%, maxDisp
  0,0118; tamphong dừng ở ô 0.007 → 46.642 tris, cạnh hở 0,06%;
  coco dừng ở ô 0.010 → 45.921 tris, cạnh hở 0,51%, maxDisp 0,0140.
  maxDisp ~1 cm ở model cao 1,8 m — tương đương pipeline làm tay
  (0,0074 ở 1,0 m ≈ 0,0133 ở 1,8 m).
- Harness mới `~/workspace/.test-fbx/test-studio-export-real-glb.js`:
  **80/80 × 2 vòng** — load GLB lenhhosung thật bằng GLTFLoader r128,
  chạy đúng 3 đường xuất (1) `SaveManager.save('fbx-mixamo')`,
  (2) `SaveManager.save('fbx-mixamo-rig')`, (3) `RigOneClick.runOneClick`
  + `buildExportBytes`. Cả 3 cho file 7.086.940 B: FBX 7300, FileId
  đúng, footer đúng, Video Path `model.fbm/` (texture nhúng, không link
  ngoài), FBXLoader parse được (1 mesh, 0 xương, 0 SkinnedMesh, 0 anim,
  44.280 tris, UV, cao 1,8, đáy y=0), validator ok, CLI 16/16, fbx2gltf
  đọc được 1 mesh/0 skin + trích 2 ảnh + baseColorTexture/normalTexture.
  Texture tới được writer (canvas drawImage +4, translate/flip +4 mỗi
  lần xuất). Đường Mixamo không gọi fetch/XHR/WebSocket (3 fetch( còn
  lại trong save-manager.js đều là `/api/meshopt-*`, ngoài đường Mixamo)
  → file xuất ra dùng offline được.
- 3 file FBX mẫu mới (làm bằng pipeline convert, texture bytes thật):
  `lenhhosung-Mixamo.fbx` 43.321 tris, `tamphong-Mixamo.fbx` 41.291 tris,
  `coco-Mixamo.fbx` 40.989 tris — harness mới
  `~/workspace/.test-fbx/test-tripo3-mixamo.js` **90/90 × 2 vòng**
  (version/FileId/footer, 1 mesh, < 50k, 0 anim/xương, 2 texture đúng
  byte, Video Path, validator CLI 16/16, fbx2gltf trích đúng 2 ảnh).
  Hướng texture đã chứng minh bằng PIL: ảnh trích từ FBX trùng byte
  với ảnh đã lật dọc, hàng đầu của ảnh trích khớp hàng cuối của ảnh gốc
  (mean|d| ~1, khác hẳn hàng đầu ~21–49).
- Hồi quy sau sửa: `test-fbx-mixamo.js` 73/73, `test-thieulam-mixamo.js`
  31/31, `test-thandieu-mixamo.js` 30/30, `test-mixamo-safe-export.js`
  40/40, `test-rig-oneclick.js` 41/41. `node --check` 0 lỗi.
  Server smoke 200 cho `index.html` + file sửa.
- Giới hạn còn lại: kiểm thử Node dùng FakeImage + canvas stub nên chỉ
  chứng minh được texture plumbing (drawImage/flip/Video Path) chứ
  không chứng minh được bytes texture thật trong file do studio xuất —
  bytes thật đã được chứng minh ở đường "provided" của cùng writer
  (convert-tripo3.js + fbx2gltf trích đúng byte). Cần user thử trên
  trình duyệt thật: xuất từ studio rồi upload Mixamo, kiểm tra file
  còn màu không.

## Lần 6 — Xuất FBX có sẵn rig + animation (2026-11-25/26)

Mục đích: 1 file FBX chứa skeleton + skin VÀ 3 animation (Idle/Run/Attack)
của Coco — dùng cho Blender/Unity/Unreal/studio, KHÔNG phải để Mixamo
auto-rig (file đã có sẵn skeleton nên Mixamo sẽ đi nhánh map-skeleton).

### Cách dùng (opt mới `animations`)

```js
FBXBinary.write(root, {
  version: 7300, upAxis: 'Y', embedTextures: true, textureBytes: {...},
  keepSkeleton: true, noSkeleton: false, fps: 30,   // fps mặc định 30
  animations: [
    { name: 'Idle',   clip: idleClip },    // THREE.AnimationClip
    { name: 'Run',    clip: runClip },     // track trỏ tới xương theo tên
    { name: 'Attack', clip: attackClip }   // canonical (mixamorig:Spine...)
  ]
});
```

Mỗi clip ghi đúng chuẩn FBX: 1 AnimationStack + 1 AnimationLayer +
AnimationCurveNode (Lcl Translation / Lcl Rotation / Lcl Scaling cho từng
xương có track) + AnimationCurve (KeyTime int64 KTime + KeyValueFloat
float32 + KeyAttrFlags 8456 + KeyAttrRefCount 1 + node `Default`) +
Connections (stack OO→layer OO→curveNode OP→bone, curve OP→curveNode).
`Takes.Current` + Documents `ActiveAnimStackName` trỏ stack đầu tiên.
`GlobalSettings.TimeSpanStop` = duration clip dài nhất (KTime).

Chuyển đổi: quaternion track (local tuyệt đối) → Euler **extrinsic XYZ**
độ; position track cùng đơn vị với bone Lcl Translation; scale giữ nguyên.
Tên curveNode ghi bare (`R`/`T`/`S`, không prefix `AnimCurveNode::`) vì
three.js BinaryParser giữ nguyên attrName (TextParser mới bỏ prefix).
Connection curveNode→bone dùng tên đầy đủ `Lcl Translation`/`Lcl Rotation`
(như XBot.fbx thật), không dùng `d|T`/`d|R`.

### ASCII là đường đã kiểm chứng, binary hiện lỗi ở fbx2gltf 0.9.7

- **ASCII 7.3 là file chính**: FBX SDK (fbx2gltf 0.9.7) đọc đủ 3 stack
  (Idle 7 / Run 10 / Attack 10 channels), 1 skin 23 joints, 2 texture
  trích đúng byte; three.js FBXLoader parse đủ (1 SkinnedMesh 50.000 tris,
  23 xương, 3 clip đúng duration/tracks); playback + round-trip khớp.
- **Binary 7.3 chỉ là reference**: cùng cây node, cùng nội dung, nhưng
  fbx2gltf 0.9.7 báo `animation 'Idle'/'Run'/'Attack' has zero channels`
  (đã thử 15 biến thể: layer không Properties70, KeyAttrDataFloat,
  KeyVer 4008, TimeMode 6, thứ tự connection, version 7400,
  RotationActive, Take nodes, UnitScaleFactor... — đều không sửa được;
  nguyên nhân gốc chưa tìm ra). three.js đọc được binary (bare names).
  File binary vẫn trích đúng 2 texture byte-exact và validator 16/16.

### 4 lỗi ASCII đã sửa để three.js + SDK đọc được (đều trong fbx-binary.js)

1. **Video.Content phải là base64, không phải hex**: SDK ASCII đọc Content
   dạng base64 — chuỗi hex 525.400 ký tự bị giải mã thành 394.050 byte rác
   (= 525.400 × 3/4), normalMap mất hẳn. Sửa `asciiProp` 'R' sang base64
   → cả 2 texture trích đúng byte (md5 khớp bản binary).
2. **Không ghi `FileId`/`CreationTime`/`Creator` top-level ở ASCII**:
   thành property ngoài mọi node làm TextParser crash (stack rỗng).
   File ASCII thật của SDK (XBot.fbx) cũng không có chúng.
3. **Node lá không props (References, Properties70 rỗng) ghi dạng block
   rỗng `Name:  {` + `}`** như SDK — ghi dòng trơ `Name:` làm parser
   hiểu nhầm là continuation line rồi crash.
4. **Array (`Vertices`, `Indexes`, `KeyTime`...) phải ghi dạng
   `*N {` + dòng `a:` ở indent+1 + chunk tiếp ở cột 0 + `}` đóng ở đúng
   indent node** (như XBot). Ghi `}` ở cột 0 làm TextParser không pop
   được node → mọi node sau array đó bị nuốt (Objects chỉ còn tới
   Deformer, mất Material/Texture/Animation/Connections/Takes).
5. **Không gắn footer nhị phân vào file ASCII**: TextParser tách cả phần
   nhị phân thành "dòng" rồi crash ở `parseNodePropertyContinued`.
   File ASCII thuần chỉ kết thúc bằng newline.
6. **Nối props bằng `,` (không khoảng trắng)**: nối `", "` làm
   `parseNodeSpecialProperty` của three.js thay khoảng trắng đầu tiên
   của đuôi số bằng `_` → `parseFloat("_0.036")` = NaN → toàn bộ xương
   NaN (position/quaternion). SDK ghi `,0,0,0` (số không có khoảng trắng).

### Thứ tự Euler — lỗi 30° ở Attack RightArm

Writer chuyển quaternion → Euler bằng `setFromQuaternion(q, 'XYZ')`
(three.js intrinsic XYZ), nhưng FBX lưu Euler **extrinsic XYZ** và
three.js `getEulerOrder(0)` trả về `'ZYX'` (intrinsic 'ZYX' = extrinsic
XYZ). Đọc lại bằng 'ZYX' trong khi ghi bằng 'XYZ' làm track xoay lớn
lệch tới 30,285° (Attack RightArm). Đã sửa: writer dùng
`setFromQuaternion(q, 'ZYX')` cho cả Lcl Rotation xương lẫn AnimationCurve,
và ghi `P: "RotationOrder", "enum", "", "", 0` vào Properties70 của mọi
Model (như XBot.fbx). Round-trip sau sửa: 27/27 track khớp, lệch tối đa
0,037° (ngưỡng 0,5°). Lưu ý: `RotationOrder = 0` cho `getEulerOrder(0) =
'ZYX'` là đúng — đừng "sửa" thành 5.

### Kiểm thử (file `coco-Rigged-Animated.fbx`, ASCII 7.3, 18.581.948 B)

- Harness `~/workspace/.test-fbx/test-fbx-animation.js`: **42 pass, 0 fail**
  (cấu trúc ASCII 15, FBXLoader parse 17, playback 8, fbx2gltf 1,
  validator 1). 1 SkinnedMesh 50.000 tris (không decimate), skeleton
  23 xương, skin weights tổng 1.0, cao 1,8 m, chân y=0, 5 mesh kiếm là
  con của RightHand (đi theo tay khi animate), 3 clip Idle 2,4 s loop /
  Run 0,8 s loop / Attack 0,9 s once, 7/10/10 tracks, 5/9/5 keyframes.
- Round-trip `test-fbx-roundtrip.js`: so track parse lại với clip gốc
  coco.js — **27/27 khớp, lệch góc tối đa 0,037°, lệch position 0,
  lệch times 0**.
- fbx2gltf 0.9.7 (SDK thật): Idle [0–57] / Run [0–19] / Attack [0–21]
  (24 fps), 7/10/10 channels, 1 skin 23 joints, buffer 2.250.008 B,
  2 ảnh JPEG trích đúng byte (map 262.700 B, normalMap 112.327 B).
  Duration trong glTF là frame đã sample: 2,38 / 0,79 / 0,88 s.
- Validator `tools/fbx-validate-mixamo.mjs`: **16/16 trên file binary
  reference** (cùng nội dung; validator là parser nhị phân nên không
  đọc được file ASCII chính). Các check auto-rig (mesh-to-root, ≤60k
  tris, cạnh hở < 2%) đều đạt, nhưng file này KHÔNG dùng để Mixamo
  auto-rig — nó đã có sẵn skeleton.
- Hồi quy sau sửa: `test-fbx-mixamo.js` 73/73,
  `test-mixamo-safe-export.js` 40/40, `test-coco-character.js` 70/70,
  `test-rig-oneclick.js` 41/41. `node --check` 0 lỗi.
  Server smoke 200 cho `js/exporter/fbx-binary.js` + `index.html`.
- Giới hạn: FBX không lưu cờ loop (Idle/Run loop, Attack once lấy từ
  metadata nguồn); file binary reference hiện zero channels ở fbx2gltf
  0.9.7 (xem trên); chưa thử mở bằng Blender/Unity/Unreal thật —
  cần user thử trên máy thật.

### Mocap thật → FBX (Thiếu Lâm, StaffSpin 4,032 s, 2026-11-26)

- Nguồn: video studio mocap thật (người mặc đồ marker + cầm gậy dài,
  camera cố định, T-pose ở frame 0) + video chibi Thiếu Lâm làm mẫu
  hình. MediaPipe PoseLandmarker heavy trích 96/96 frame, 24 fps,
  clip `staffspin_clip.json` (format `pixistudio-mocap-clip-1`):
  23 xương Mixamo, mỗi xương 96 quaternion delta so với T-pose frame 0
  + Hips có root-motion position (delta mét), staff track = vector đơn
  vị giữa 2 cổ tay + midpoint. `check_mocap.py` ALL HARD CHECKS PASS.
- Compose clip: track rotation = delta × bind pose (rig studio có rest
  quaternion identity nên track = delta); Hips position = restPos +
  root-motion delta. **Đảo trái/phải khi map clip → xương rig** vì rig
  studio bị mirror so với Mixamo + mesh (XBot thật: LeftArm ở +X;
  rig đặt LeftArm ở −X; skin tay +X của mesh gắn vào xương tên
  RightForeArm). Không đảo thì đòn đánh bị gương. Spine1/Spine2 không
  có trong rig 23 xương (delta của chúng là identity nên không mất gì).
- File `thieulam-Rigged-Mocap.fbx` (ASCII 7.3, **29.231.771 B**):
  mesh đầy đủ 46.917 tris (không decimate), 23 xương, 1 clip StaffSpin
  4,032 s once (22 tracks: 21 rotation + 1 Hips position, 96 keys),
  gậy gỗ procedural dài 1,8 m (thân + 2 đầu) gắn RightHand, hướng theo
  staff.direction[0], 2 texture nhúng đúng byte nguồn (map JPEG
  269.271 B, normalMap PNG 1.294.122 B).
- Kiểm thử: harness `test-thieulam-mocap.js` **41/41 ×2 lần** (cấu trúc
  ASCII 14, FBXLoader parse 14, round-trip 1, playback 8, fbx2gltf +
  texture 3, loop 1). Round-trip so với clip nguồn: **22/22 khớp,
  lệch góc tối đa 0,0395°, lệch position 0**. fbx2gltf 0.9.7: 1 skin
  23 joints, 1 animation StaffSpin 3,96 s (sample 24 fps), buffer
  2.035.568 B, 2 texture trích đúng byte. Playback: f45 tay phải lệch
  khỏi rest 1,701 (đòn đâm gậy), root motion Hips 0,316 m, gậy cách tay
  0,0000 m ở mọi mốc, hướng gậy lúc nghỉ lệch staff.direction[0] 0,88°,
  gậy xoay theo tay 36,1° ở t=2,52 s.
- 2 bug thật của writer đã sửa trong `fbx-binary.js` (không chỉ cho
  file này): (1) auto-detect trục dọc đo bbox của **mọi** mesh — gậy
  dài 1,8 m nằm ngang làm bbox X (~2,1 m) vượt chiều cao 1,8 m nên
  nhận nhầm X là trục dọc, xoay cả nhân vật 90° (nằm ngang). Giờ đo
  bbox từ mesh skinned (thân nhân vật), không có skinned thì mới dùng
  mọi mesh. (2) Geometry mesh gắn dưới xương bị nhân đôi `world`:
  verts đã bake `world` rồi lại áp `boneWorld⁻¹·world` → prop lệch
  ~0,8 m và sai hướng (gậy đứng dọc, lơ lửng trên tay). Giờ chỉ áp
  `boneWorld⁻¹`. Bug (2) cũng làm **kiếm của file Coco đã giao bị lệch
  khỏi tay 0,55–1,20 m** — đã re-export Coco bằng writer mới
  (`coco-Rigged-Animated-FIXED.fbx`, kiếm về đúng tay, gap 0,01–0,75 m
  dọc lưỡi kiếm); file Coco đã giao cần phát hành lại.
- **V2 (2026-11-26) — sửa tay biến dạng bằng retarget world-space (Convention M'):**
  User báo tay Thiếu Lâm bị biến dạng khi mở file. Đo thật: góc cổ tay lúc
  nghỉ 147,5° (Thiếu Lâm) / 145,0° (Coco) so với XBot Mixamo thật 0,0° —
  xương bàn tay trong rig studio bị lật (trục +Y chỉ ngược về khuỷu thay vì
  ra đầu ngón tay). Gốc rễ: compose clip theo local space (`delta × rest`)
  ngầm giả định rest model = T-pose performer, nhưng bind model là A-pose
  và rest tay bị lật. Sửa: tính world orientation performer (Q^M = Q × C,
  C đưa frame trích xuất về frame Mixamo +Y = hướng xương), rồi local đích
  = (parent world)⁻¹ × source world — nhưng rig có rest quaternion identity
  + child offset theo A-pose (không dọc +Y) nên cần thêm **R_fix**: phép quay
  đưa +Y về hướng offset A-pose của xương (child local position, chuẩn hóa);
  world đích W = Q^M × R_fix⁻¹ để **đoạn xương** (joint→joint) đi đúng hướng
  performer. Tay khóa theo cẳng tay (H1, local tay = S_ForeArm, không track
  tay) vì frame tay landmark bị lệch do ngón tay cong. Gậy KHÔNG gắn tay nữa:
  xương riêng `ThieulamStaff` (không trong skin) với track T+R từ
  `staff.midpoint_m` + `staff.direction` đo được. Kết quả V2
  (`thieulam-Rigged-Mocap-V2.fbx`, 29.226.256 B): harness
  `test-thieulam-mocap-v2.js` **46/46 ×2 lần** — góc cổ tay 0,00° (trước
  147,45°), tay–gậy t=1,12: 0,115 m / t=2,25: 0,093 m (trước 0,778/0,857 m),
  khuỷu 78,5–174,9°, round-trip world 0,117°, fbx2gltf 1 skin 23 joints +
  1 anim, không warning. Coco V2 (`coco-Rigged-Animated-V2.fbx`,
  18.589.608 B): sửa rest 2 tay về S_ForeArm + re-bind skin, kiếm local =
  S_RightForeArm⁻¹ (world kiếm giữ nguyên, lệch 0,0000 m so với file FIXED),
  build lại 3 clip (track giống hệt cũ vì clip không có track tay);
  harness `test-coco-v2.js` **45/45 ×2 lần** — góc cổ tay 0,00° (trước
  145°), gap gốc lưỡi 0,047 m, fbx2gltf 3 animations. Lưu ý: mô tả video
  "gậy ngang t=1,12 / gậy dọc t=3,96" **không khớp clip đo được**
  (f27 gậy chéo (-0,34,0,42,0,84); f95 gậy gần ngang (-0,86,0,22,0,46),
  tay phải performer cầm gậy 0,040 m) — đối chiếu theo clip, không theo mô
  tả. Hạn chế còn lại: tay model dài gấp ~2× tay performer (cẳng tay model
  0,448 m vs performer 0,22 m) nên ở t=3,96 tay phải model cách gậy 0,214 m
  (overshoot do tỷ lệ model Tripo, không phải lỗi retarget); chưa mở bằng
  Blender/Unity/Unreal thật.
- **WushuAttack — đòn múa võ tay không (2026-11-26, cùng pipeline V2, KHÔNG gậy):**
  User gửi ảnh thủ thế (chibi Thiếu Lâm, FRONT/LEFT/BACK/RIGHT) + video mocap
  studio mới (võ sư Thiếu Lâm thật, áo vàng, tay không, 10,03 s / 240 frame)
  và yêu cầu đòn attack từ tư thế thủ trong ảnh tới các động tác trong video,
  KHÔNG dang tay (cắt T-pose f0–49) và KHÔNG đá (cắt đá f114–144). Clip
  `wushuattack_clip.json` (275.969 B, format `pixistudio-mocap-clip-1`):
  WushuAttack 6,559 s / 157 frame / 24 fps / loop False, 23 xương Mixamo =
  12 frame thủ thế procedural (0,5 s, từ ảnh FRONT: tay phải ngửa ngang ngực,
  tay trái hướng ra trước ngang vai, khuỷu ~90°) + blend 7 frame vào đoạn A
  (video f50–113, đánh tay) + crossfade 7 frame vào đoạn B (video f145–239,
  xoay/đấm/thủ). `check_wushu.py` ALL HARD CHECKS PASS (không frame T-pose,
  không frame đá — gót phải cao tối đa 0,081 m, gối phải ≥128°).
  **Sửa clip trước khi xuất:** clip gốc có 8 frame cẳng tay bị tracking lỗi ở
  đoạn xoay lưng (video f154–172, cổ tay visibility 0,002–0,015) làm khuỷu
  gập tới 4,8–24° — đối chiếu video thấy sai thật (video f146 tay phải duỗi
  thẳng đấm tới trước; video f107 hai tay thu về ngực, khuỷu ~60–90°). Slerp
  nội suy delta thuần KHÔNG đủ (khuỷu vẫn 12–17° vì tay trên cũng xoay) nên
  sửa trực tiếp góc khuỷu: xoay world orientation cẳng tay quanh trục bản lề
  vừa đủ để khuỷu = nội suy tuyến tính giữa 2 frame tốt gần nhất (28–42°).
  Chỉ sửa delta 2 cẳng tay (LeftForeArm f75–76, f86–87; RightForeArm f82–85),
  clip gốc không đổi (`wushuattack_clip_fixed.json`, field `repair` ghi rõ).
  File `thieulam-Rigged-WushuAttack.fbx` (ASCII 7.3, **29.340.180 B**): cùng
  mesh 46.917 tris + rig 23 xương như V2, 1 take WushuAttack 6,559 s once,
  20 tracks (19 rotation + 1 Hips position), KHÔNG xương gậy/mesh gậy,
  2 texture nhúng đúng byte nguồn. Harness `test-thieulam-wushu.js`
  **45/45 ×2 lần** — thủ thế t=0 khớp FK clip 0,0223 m (cả 2 cổ tay), khuỷu
  t=0 95,7°/90,0°, T-pose 0 frame, gót phải cao nhất 0,149 m, gối phải nhỏ
  nhất 115,5°, cổ tay tối đa 0,02°, khuỷu 26,8–174,1°, root motion 0,498 m,
  round-trip 20/20 (0,1169°), world round-trip 0,1422°, fbx2gltf 1 skin
  23 joints + 1 anim WushuAttack 6,50 s, không warning. Hồi quy:
  `test-thieulam-mocap-v2.js` 46/46, `test-fbx-animation.js` 42/42.
- **V3 / Wushu V2 (2026-11-26) — sửa lỗi CHÂN BAY LÊN TRỜI do Euler wrap
  trong writer:** cả 2 file trên đều có chân bay 1,2–1,56 m ở nhiều frame
  (StaffSpin V2: 16 frame, cao nhất 1,56 m @f65; WushuAttack V1: 10 frame,
  cao nhất 1,43 m @f91) trong khi video cho thấy chân chạm đất (chỉ f65
  StaffSpin có nhảy thật, ~0,15–0,25 m). **Nguyên nhân KHÔNG phải clip
  data** (cổ chân landmark ≤0,169 m; chân clip ≤0,20 m) mà là writer:
  Euler ZYX ghi wrap [-180°, +180°] từng key độc lập; khi quay thật vượt
  ngưỡng ±180° giữa 2 key (Hips_RZ 178,6 → -179,3 ở keys 64→65, span
  -357,9°; UpLeg_RZ tương tự), FBXLoader chèn key nội suy đi đường DÀI và
  Hips world lệch 149–176° ở t=f/24 → chân bay. Ở đúng key time thì file
  đúng nên harness cũ bỏ sót — nó chỉ sample ở key time (số "gót phải
  0,149 m" của check (4d) Wushu là chiều cao xương Foot lúc nghỉ đo ở key
  time, không phải lỗi). **Sửa:** unwrap Euler trong writer
  (`fbx-binary.js`, nhánh animation `R`: cộng/trừ 360° cho 2 key liên tiếp
  lệch ≤180°). Góc quay tại mỗi key không đổi (Euler ±360° là cùng 1
  rotation), chỉ đường nội suy đổi sang đường ngắn; không sửa clip JSON.
  File mới `thieulam-Rigged-Mocap-V3.fbx` (29.226.196 B, StaffSpin) +
  `thieulam-Rigged-WushuAttack-V2.fbx` (29.340.115 B, WushuAttack): harness
  mới `test-thieulam-mocap-v3.js` **50/50 ×2** và `test-thieulam-wushu-v2.js`
  **49/49 ×2** — check chân mới (section 8) đo Foot bone world Y khi
  playback FBX dày đặc (key + midpoint + t=f/24, 287/470 mẫu): chân tối đa
  0,211 m / 0,163 m (≤0,30 m), các frame lỗi cũ nay ≤0,193 m / ≤0,118 m,
  Hips world ở t=f/24 lệch ≤10,3° / ≤5,11° (trước 149–176°), không còn
  span Euler ≥180° trong file (tối đa 162,6° / 178,5°), loader không chèn
  thêm key (mọi track đúng 96 / 157 keys). Ngưỡng 0,30 m: cổ chân thật cao
  nhất 0,169 m + biên cho chân model ngắn hơn performer; nhảy thật f65 vẫn
  dưới ngưỡng nên không cần ngoại lệ. Hồi quy: V2 46/46, Wushu V1 45/45,
  `test-fbx-animation.js` 42/42, `test-fbx-roundtrip.js` 27/27,
  `test-coco-v2.js` 45/45. **Bài học:** mọi harness playback sau này phải
  sample cả giữa key (midpoint + t=f/24), không chỉ key time — lỗi nội suy
  chỉ xuất hiện giữa key.
  Hạn chế: cú sửa khuỷu để lại 1 jump world cẳng tay 64,9° @f76 (ranh giới
  đoạn tracking lỗi; clip gốc đã có jump 61,5° @f132 nên cùng bậc); khuỷu
  nhỏ nhất sau sửa 26,8° (sát ngưỡng 25°, là tư thế thu tay đấm thật, không
  phải gập lỗi); đo khuỷu phải dùng khớp tay (Arm), không dùng khớp vai —
  đo bằng vai sai tới 72° (vai cách khớp tay 0,195 m); chưa mở bằng
  Blender/Unity/Unreal thật.
- Giới hạn: Spine/Spine1/Spine2 delta = identity theo cấu trúc (toàn
  bộ gập/xoắn thân nằm trong track Hips — tư thế vẫn đúng nhưng hông
  nghiêng theo thân); đoạn xoay f59–77 visibility thấp (tay trái khuất
  sau thân, MediaPipe mirror nhãn trái/phải); tay trái chuyển ~55–79°
  trong 1 frame ở f45 (đòn đâm gậy, điểm kỳ dị twist) — giữ nguyên như
  đo được; bind pose là A-pose còn delta tính từ T-pose (compose
  delta×bind vẫn đúng); gậy chỉ theo RightHand (tay trái không cầm
  gậy); Hips yaw quét ~344° qua wrap ±180° nên FBXLoader chèn thêm
  key nội suy ở 5 track (97–101 keys thay vì 96 — hành vi của loader,
  writer vẫn ghi đúng 96 keys/curve); chưa mở bằng Blender/Unity/Unreal
  thật — cần user thử trên máy thật.

## Lần 7 — Preset Mixamo không ép mesh-only + nút Save Mixamo im lặng trên model đã rig (2026-11-26)

**Triệu chứng:** user bấm xuất FBX thường rồi upload lên Mixamo, nhận
"Sorry, unable to map your existing skeleton" (ảnh chụp màn hình).

**Gốc 1 — preset không ép mesh-only:** `saveFBXBinary` chỉ truyền
`{fps:30}` + version/upAxis/autoScale từ preset cho `FBXBinary.write`,
KHÔNG có `noSkeleton/prepareMixamo` — file giữ nguyên skeleton (A-pose,
chỉ 24/65 xương có skin) nên Mixamo đi nhánh map-skeleton và thất bại
đúng như ảnh. Preset mặc định là `'mixamo'` nên bấm xuất FBX thường là
dính lỗi này. **Sửa:** `saveFBXBinary` (`js/exporter/save-manager.js`)
khi `SaveManager.exportPreset === 'mixamo'` thì chuyển thẳng sang đường
Mixamo-safe (`saveFBXMixamo`: prepareMixamoSafe + preflight +
`noSkeleton: true, prepareMixamo: true, version 7300`); preset
Unity/Unreal/không preset vẫn giữ skeleton như cũ. Dispatch `case 'fbx'`
đã đi qua `saveFBXBinary` nên tự đúng đường; nút topbar "Save Mixamo"
vẫn gọi `save('fbx-mixamo')`.

**Gốc 2 — nhãn gây hiểu lầm:** format `'fbx'` tên "FBX Binary
(Mixamo-ready)", thông báo sau lưu nói "Mixamo/Blender/Unity đọc được"
— SAI với file có skeleton; format `'fbx-mixamo-rig'` mô tả còn nói
file có 22 xương mixamorig (từ round 4 file xuất ra đã là mesh-only);
Rig 1 Lượt đặt tên file `name_rigged_mixamo.fbx` cho file mesh-only
(chữ "rigged" gây nhầm ngược). **Sửa:** `'fbx'` đổi thành "FBX Binary
(có rig — Blender/Unity/Unreal)", desc nói rõ KHÔNG dùng cho Mixamo
(Mixamo sẽ báo "unable to map your existing skeleton" — muốn lên Mixamo
thì dùng FBX Mixamo mesh-only); `'fbx-mixamo-rig'` đổi thành "FBX 2013
Mixamo-safe (mesh-only, tự auto-rig)", desc sửa theo thực tế (khung 65
xương chỉ ở trong scene để làm animation, không xuất xương ra file);
Rig 1 Lượt đổi tên file thành `name_mixamo.fbx`; thông báo sau lưu ở
`saveFBXBinary` phân biệt file có skeleton ("dùng cho Blender/Unity/
Unreal. KHÔNG upload file này lên Mixamo") và file mesh-only
("Mixamo-safe, upload Mixamo được"); creator string "(Mixamo-ready)"
trong `fbx-binary.js` (header ASCII + Creator) bị gỡ — trước đây nó
đóng dấu vào MỌI file xuất ra kể cả file có rig.

**Gốc 3 — nút Save Mixamo KHÔNG RA FILE trên model vừa rig (harness
mới bắt được):** `MixamoSafeExport.prepare` (và `countTris`) bỏ qua mọi
mesh có `userData.skipSkin` — nhưng `bindSkin` đánh dấu chính SkinnedMesh
của nhân vật bằng `skipSkin: true` (nghĩa là "đã skin, đừng skin lại",
không phải "đừng xuất"), và thay thế mesh gốc bằng SkinnedMesh đó nên
scene sau rig chỉ còn đúng 1 mesh thật — prepare tìm được 0 mesh, báo
"Không có mesh nào để xuất FBX", không có file. Validator
(`mixamo-validator.js`) đã từng sửa đúng lỗi này ("Mesh đã skin
(skipSkin) VẪN là mesh thật phải đếm") nhưng exporter chưa sửa theo.
**Sửa:** `js/exporter/mixamo-safe-export.js` — `countTris` và `prepare`
chỉ bỏ `isBoneVisual`, giữ lại mesh `skipSkin` (prepare đã xử lý đúng
SkinnedMesh: clone geometry, nướng matrixWorld, xoá skinIndex/skinWeight,
dựng lại bằng THREE.Mesh thường).

**Kiểm thử:** harness mới `test-mixamo-preset.js` **48/48 ×2 lần** trên
GLB thật `tripo_convert_lenhhosung.glb` đã rig trước bằng RigOneClick
(23 xương, 1 SkinnedMesh — đúng điều kiện gây lỗi): baseline
`save('fbx-mixamo')` và preset-mixamo `save('fbx')` đều ra file v7300,
0 xương / 0 skin qua FBXLoader + fbx2gltf (1 mesh, 0 LimbNode thô),
43.504 tris (< 50.000, đã decimate giữ UV), thông báo "Save Mixamo xong"
+ "mesh-only (Mixamo tự auto-rig)"; preset Unity/Unreal/không preset
vẫn giữ skeleton v7400 (23 xương, 1 skin); nhãn F1–F8 + tên file Rig 1
Lượt đều đúng; scene nguồn vẫn còn xương sau khi xuất. Hồi quy:
`test-studio-export-real-glb.js` 80/80, `test-mixamo-safe-export.js`
40/40, `test-rig-oneclick.js` 41/41 (check 3.2 cập nhật theo tên file
mới), `test-fbx-mixamo.js` 73/73, `node --check` OK trên 4 file sửa.
**Chưa đẩy GitHub** — chờ user duyệt (gộp cùng lần đẩy writer + docs
đang chờ).

- **HeartDraw + Idle/Run (2026-11-26) — nhân vật Thiếu Lâm 3 trạng thái:**
  user gửi video nhà sư vẽ hình trái tim (T-pose → thu tay → vẽ tim bằng
  2 tay, có vệt sáng hình tim là HIỆU ỨNG video, không phải chuyển động
  thân) và nhờ làm nhân vật Thiếu Lâm trạng thái idle/run + vẽ tim.
  Clip `heartdraw_clip.json` (170.455 B, HeartDraw "Vẽ trái tim", 4,032 s /
  96 frames / 24 fps / loop False, 23 xương, KHÔNG staff track):
  `check_heart.py` ALL HARD CHECKS PASS — f57 hai cổ tay trước ngực
  (Z 0,325/0,378 m), khuỷu gập 101,4°/97,4°; cổ chân chỉ nhích 0,010 m
  (chân chạm đất suốt clip, chân trong video nằm ngoài khung hình nên
  track chân gần như identity); gối ≥145,8°; jump tệ nhất 42,2°
  LeftForeArm @f37. Hips Z bị ZERO có chủ ý (người đứng yên, proxy Z đo
  độ co thân chứ không phải dịch chuyển). File rest riêng
  `heart_rest_locals.json` (tên trường khác: `rest_local_quat` /
  `rest_world_quat` thay vì `L0`/`Q0` — converter phải map lại).
  File mới `thieulam-Rigged-IdleRunHeart.fbx` (29.173.484 B, ASCII 7.3):
  1 SkinnedMesh 46.917 tris + rig 23 xương, 3 takes — Idle 2,4 s loop +
  Run 0,8 s loop (procedural theo mẫu Coco) + HeartDraw 4,032 s once
  (mocap, converter V2 world-space retarget + writer unwrap Euler),
  KHÔNG gậy, 2 texture nhúng đúng byte nguồn. Harness mới
  `test-thieulam-heart.js` **44/44 ×2 lần**: cổ tay 0,00° lúc nghỉ /
  tối đa 0,01° cả 3 clip; vẽ tim f57 cổ tay trước ngực (chest+0,573 /
  +0,440 m), khuỷu 97,7°/99,4° (đo bằng khớp tay); tay khép 0,420 m
  (đáy tim) rồi mở 1,824 m (2 thùy), X-range 1,797 m; chân dày đặc
  (key + midpoint + t=f/24) tối đa 0,169 m (HeartDraw) / 0,120 m (Idle) /
  0,251 m (Run); không còn span Euler ≥180° (tối đa 70,3°);
  round-trip HeartDraw 20/20 (lệch tối đa 0,1262°) + world round-trip
  0,0725°; fbx2gltf SDK: 1 skin 23 joints, 3 anim đúng thời lượng,
  2 images đúng byte, không warning. Hồi quy: V3 50/50, Wushu V2 49/49,
  `test-fbx-animation.js` 42/42. Hai điểm sửa so với mẫu Coco gốc:
  (1) Run GIẢM (chân ±26°/gối 50°/bob 0,04 → ±20°/32°/0,02) để cổ chân
  không bay quá 0,30 m; (2) Run key cuối = key đầu ở mọi track (Coco
  gốc để key cuối = 0/rest nên nối loop giật 20° — harness bắt được,
  đã sửa để loop mượt thật; worstQ sau sửa 0,0000°). Lưu ý đo lường:
  `2*acos(|dot|)` khuếch đại nhiễu float32 thành lệch ảo 0,02–0,04°
  khi so 2 quaternion giống hệt nhau — check loop-seam phải dùng góc
  ổn định (quaternion tương đối + atan2). Chưa mở bằng
  Blender/Unity/Unreal thật.
