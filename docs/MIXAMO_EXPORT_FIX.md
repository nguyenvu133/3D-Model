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
