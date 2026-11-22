# Phân tích `X Bot.fbx` + nút "Save Mixamo Rig" (FBX 2013, có xương mixamorig)

**Ngày:** 22/11/2026 · File phân tích: [X Bot.fbx](<X Bot.fbx>) (7,71 MB)

> **Tìm ra nguyên nhân gốc lỗi Mixamo.** File studio xuất ra trước đây ghi `FBXVersion: 7400`.
> Trong chính `X Bot.fbx` thấy rõ quy ước: dòng đầu `; FBX 7.7.0 project file` đi kèm
> `FBXVersion: 7700` ⇒ **7.4 = 7400 = FBX 2014**, còn **7.3 = 7300 = FBX 2013**.
> Mixamo chỉ nhận "FBX files 2013 or earlier" ⇒ file 7400 **bị từ chối đúng như thông báo
> `Unsupported FBX type. Please use FBX files 2013 or earlier.`**
> Đã sửa: mọi nút cho Mixamo nay ghi **version 7300 (FBX 2013)**.

---

## 1. `X Bot.fbx` là file gì

Do chính **Mixamo (Adobe)** tạo rồi **Maya 2020.2 lưu lại** — đọc từ `SceneInfo`:

| Trường | Giá trị |
|---|---|
| `Original|ApplicationVendor` | Mixamo, Inc. |
| `Original|ApplicationName` | mixamo.com |
| `Original|FileName` | `MotionOnlyScene; Retargeted Clip; Motion Sequence; 1 motions; Skeleton mixamorig:Hips…` |
| `LastSaved|ApplicationName` | Maya (202004) |
| `Creator` | FBX SDK/FBX Plugins version 2020.2 |

## 2. Cấu trúc đầy đủ (đọc bằng `tools/fbx-ascii-analyze.mjs`)

| Thành phần | Số lượng / chi tiết |
|---|---|
| Định dạng | **FBX ASCII** (`; FBX 7.7.0 project file`), `FBXVersion: 7700` |
| Geometry | 2 — `Beta_Surface` 14.232 đỉnh / ≈18.905 tam giác, `Beta_Joints` 10.514 đỉnh / ≈14.360 tam giác |
| UV | có, `ByPolygonVertex` + `IndexToDirect`; normal có |
| Model | 67 = **2 `Model::Mesh`** + **65 `Model::LimbNode`** |
| Tên xương | `mixamorig:Hips`, `mixamorig:Spine`, `mixamorig:Spine1`, `mixamorig:Spine2`, `mixamorig:Neck`, `mixamorig:Head`, `mixamorig:HeadTop_End`, `mixamorig:RightShoulder`, … (prefix **`mixamorig`**) |
| NodeAttribute | 65, tất cả `TypeFlags = "Skeleton"` |
| Deformer | **2 `Skin`** + **129 `Cluster`** (mỗi xương một cluster) |
| Pose | 2 — `Pose::skinCluster1` (65 node), `Pose::skinCluster2` (66 node) — tức **BindPose** |
| Material | 2 Phong: `Beta_HighLimbsGeoSG3` (Kd ≈ 0,837/0,302/0,264), `Beta_Joints_MAT1` (Kd ≈ 0,333/0,125/0,101) |
| Texture / Video | **0** — file này **không có ảnh**, model hiển thị bằng màu vật liệu |
| Animation | 2 `AnimationStack` (`Take 001`, `mixamo.com`) + 2 Layer + 67 CurveNode + 315 Curve |
| GlobalSettings | không có `UpAxis`/`UnitScaleFactor` tuỳ biến (dùng mặc định FBX) |
| Connections | 731 = 464 `OO` + 267 `OP` |

**Kết luận về "dạng file" cần bắt chước:** một *nhân vật có rig* gồm
`Model::Mesh` + nhiều `Model::LimbNode` (`mixamorig:*`) + `NodeAttribute TypeFlags "Skeleton"`
+ `Deformer::Skin` với **1 Cluster cho mỗi xương** + `Pose` BindPose + `Material`.

## 3. Studio đã ghi đúng dạng đó chưa? — Đã đúng, chỉ sai số version

`js/exporter/fbx-binary.js` vốn đã ghi `NodeAttribute TypeFlags "Skeleton"`,
`Model::LimbNode`, `Deformer::Skin` + `Cluster`, `Pose::BIND_POSES`. Khác biệt duy nhất là
`VERSION = 7400`. Đã thêm tham số **`opts.version`** (và `keepSkeleton` để giữ xương khi
`prepareMixamo`), rồi cho các nút Mixamo truyền **7300**.

## 4. Nút mới: **Save Mixamo Rig**

| | |
|---|---|
| Nút | `#btn-save-mixamo-rig` — **"Save Mixamo Rig"**, phím tắt **Ctrl+Shift+R** |
| Save Center | định dạng `fbx-mixamo-rig` = *"FBX 2013 + Mixamo rig (giống X Bot.fbx)"* |
| Code | [save-manager.js](<js/exporter/save-manager.js>) — `saveFBXMixamoRig()`, `ensureMixamoRig()`, `collectRigInfo()` |
| Việc nút làm | 1) **tự auto-rig + auto-skin** bằng preset `Mixamo Compatible` nếu model chưa có xương; 2) chờ texture decode; 3) ghi `FBXBinary.write(target, { version: 7300, prepareMixamo: true, keepSkeleton: true, upAxis: 'Y', autoScale: true, embedTextures: true })` |
| Kết quả | 1 file `.fbx` binary **FBX 2013**, giữ xương `mixamorig:*`, skin + bind pose, texture nhúng |

Nút **Save Mixamo** (mesh-only) cũng đã đổi sang version 7300 — dùng khi bạn muốn để
Mixamo tự auto-rig, không cần xương của studio.

## 5. Bug thật đã phát hiện và sửa trong auto-skin

Khi kiểm tra file xuất ra, thấy **chỉ có 1 Cluster** thay vì 1 cluster/xương. Truy nguyên:
[x rig-auto-gen.js](<js/rigging/rig-auto-gen.js>) — `RigAutoGen.bindSkin()` tra index xương bằng
`boneList.findIndex(bn => bn.name === seg.name)`.

- `segs[].name` lấy từ **khoá** của `rig.bones` = tên **trần**: `Hips`, `Spine`, …
- `boneList` là các `THREE.Bone` mang tên **có prefix**: `mixamorig:Hips`, …

⇒ `findIndex` luôn trả **−1** ⇒ `skinIndices[i*4] = 0` cho **mọi** đỉnh ⇒ cả model chỉ dính vào
xương số 0 (`mixamorig:Root`). Đo được trước khi sửa: `bonesUsed: 1`, `boneIndexRange: [0,0]`.

**Đã sửa**: segment mang theo chính đối tượng `bone`, tra index bằng `boneList.indexOf(bone)`
(khớp theo đối tượng), fallback so tên đã bỏ prefix `mixamorig:`.

Đo lại sau khi sửa: `bonesUsed: 23/23`, `verticesWithoutWeight: 0`, `maxInfluences: 2`.

## 6. Kết quả kiểm chứng thật

`node tools/qa-mixamo-rig.mjs` (nạp GLB → bấm nút → phân tích file → nạp lại bằng FBXLoader):

| Kiểm tra | Kết quả |
|---|---|
| Nút + format tồn tại | `Save Mixamo Rig` / `FBX 2013 + Mixamo rig (giống X Bot.fbx)` ✓ |
| Tự rig khi bấm | 23 xương `mixamorig:*` (23/23), 1 skinned mesh |
| Tải file | **10,07 MB trong 2,1 s**, 0 page error |
| Version | **7300 = FBX 2013** (Mixamo nhận) |
| Rig trong file | 23 `Model::LimbNode`, 23/23 tên `mixamorig`, 1 `Skin`, **23 Cluster**, 1 `Pose` (BindPose) |
| Kích thước | cao **1,8**, đáy **y = 0**, mặt +Z, đứng theo +Y |
| Hình học | 50.000 tam giác, UV + normal đủ, cạnh hở **0%**, nonManifold 0 |
| Texture | 4 kênh nhúng (basecolor/normal/roughness/metallic) |
| Validator 16 mục | **16/16 ĐẠT** |
| Nạp lại file bằng FBXLoader | 23 bone, 1 skinned mesh, `bonesUsedInSkin: 23`, `verticesWithoutWeight: 0` |
| Nút mesh-only cũ | vẫn 16/16, nay cũng version 7300 |

So với `X Bot.fbx`:

| | X Bot.fbx | File nút mới xuất |
|---|---|---|
| version | 7700 (FBX 2020) | **7300 (FBX 2013 — bản Mixamo yêu cầu)** |
| định dạng | ASCII 7.7 (do Maya lưu) | Binary (Mixamo phát hành dạng binary) |
| xương | 65 `mixamorig` | 23 `mixamorig` (preset Mixamo Compatible) |
| cluster | 129 | 23 (1/xương) |
| bind pose | 2 Pose | 1 Pose |
| texture | 0 (không màu) | có, nhúng trong `Video.Content` |
| animation | 2 AnimStack | 0 (file để upload nhân vật, Mixamo gắn motion sau) |

## 7. Cách tự làm lại

```powershell
node server.js 8099                 # server phải đang chạy

# phân tích file X Bot.fbx
node tools/fbx-ascii-analyze.mjs "X Bot.fbx"

# kiểm thử nút Save Mixamo Rig (tự rig → xuất → phân tích → nạp lại)
node tools/qa-mixamo-rig.mjs assets/models/tripo_convert_monter1.glb

# đo dữ liệu skin sau auto-rig (phát hiện lỗi dồn 1 xương)
node tools/qa-rig-skin-probe.mjs assets/models/tripo_convert_monter1.glb

# kiểm tra file bất kỳ
node tools/fbx-validate-mixamo.mjs <file.fbx>     # 16 mục, tự nhận biết có rig
node tools/fbx-inspect.mjs <file.fbx>
```

File mẫu nút mới: [mixamo-2013-rigged.fbx](<docs/m2m-v10/mixamo-2013-rigged.fbx>) — FBX 2013,
23 xương `mixamorig` + skin + bind pose + 4 texture nhúng, 16/16.

## 9. Bản sửa lần 2 — “file vẫn lỗi rig skeleton”

Sau lần 1 (đúng version 7300) bạn vẫn báo lỗi rig skeleton. Soi lại thì **version chỉ là một nửa vấn đề**;
khung xương do studio sinh ra cũng không giống Mixamo:

| | Rig cũ của studio | X Bot.fbx (chuẩn) |
|---|---|---|
| gốc | `Root` (Mixamo không có) | **`Hips`** |
| cột sống | `Spine` → `Chest` | **`Spine` → `Spine1` → `Spine2`** |
| số xương | 23 | **65** (có ngón tay, `Toe_End`, `HeadTop_End`) |
| cluster | 1/xương nhưng **weight dồn 1 xương** (bug đã sửa ở mục 5) | 1/xương thật |

### Đã sửa

1. **Khung xương chuẩn Mixamo 65 xương** — trích thẳng từ `X Bot.fbx` bằng
   [xbot-extract-skeleton.mjs](<tools/xbot-extract-skeleton.mjs>) → dữ liệu ở
   [mixamo-skeleton-data.js](<js/rigging/mixamo-skeleton-data.js>), dựng bởi
   [mixamo-skeleton.js](<js/rigging/mixamo-skeleton.js>) (`PixiStudio.MixamoSkeleton.build`).
   Tên + phân cấp **y hệt X Bot**: `Hips → Spine → Spine1 → Spine2 → Neck/Head/HeadTop_End`,
   2 tay (Shoulder/Arm/ForeArm/Hand + 4 đốt × 5 ngón), 2 chân (UpLeg/Leg/Foot/ToeBase/Toe_End).
2. **Scale geometry trước khi dựng xương.** Lỗi thật đã bắt được: xương cao 1,8 nhưng mesh chỉ cao 1,0
   ⇒ xương nằm ngoài mesh ⇒ **chỉ 11/65 xương có weight**. Nay geometry được chuẩn hoá
   (cao 1,8 · đáy y=0 · giữa x/z=0) **trước**, rồi mới map xương → **24 xương có weight**, không đỉnh mồ côi.
3. **Tay bám theo model.** X Bot là **T-pose**, model Tripo/Meshy thường **A-pose (tay xuôi)**
   ⇒ xương tay nằm ngoài mesh, weight dồn sang xương chân. Module đo đầu chi thật của mesh rồi
   kéo chuỗi `Arm/ForeArm/Hand` (và rải ngón quanh bàn tay) xuống theo đúng hướng tay thật.
4. **Loại xương ngón/đầu mút khỏi skin.** Đo được: đỉnh cẳng tay bị gán vào `RightHandIndex…`
   (đoạn xương ngón rất ngắn nằm sát bàn tay) ⇒ xoay `RightArm` mà đỉnh **không nhúc nhích**.
   Nay xương ngón vẫn có trong khung (để Mixamo map) nhưng **không nhận weight**.
5. **Không sửa scene của bạn** nữa: toàn bộ rig dựng trên **bản sao** geometry.

### Kiểm chứng lần 2

`node tools/qa-rig-deform.mjs` — chứng minh skin thật sự biến dạng:

| Phép thử | Kết quả |
|---|---|
| A. Xoay xương mạnh nhất của đỉnh đầu chi 45° | đỉnh dịch **0,2551** ✓ |
| B. Xoay xương tay, đo đỉnh đầu | dịch **0** (weight không lem) ✓ |
| C. Phân bố weight | 24 xương, tay ~4.900 + 4.700 đỉnh, chân ~8.900 + 5.700, **0 đỉnh mồ côi** |

`node tools/qa-mixamo-rig.mjs` (bấm nút thật → tải → phân tích → nạp lại):

| Kiểm tra | Kết quả |
|---|---|
| File | **10,11 MB**, xuất trong **1,7 s**, 0 page error |
| Version | **7300 = FBX 2013** |
| Khung xương | **65 `Model::LimbNode`**, tên **`mixamorig:` 65/65**, 1 `Skin`, **24 Cluster** (24 xương có weight), 1 `Pose` BindPose |
| Cây xương | `Hips` (gốc) → `Spine` → `Spine1` → `Spine2` → `Neck/Head/HeadTop_End` + 2 tay + 2 chân — **trùng tên và thứ tự X Bot** |
| Hình học | 50.000 tam giác, cao 1,8, đáy y=0, UV+normal đủ, cạnh hở 0% |
| Validator | **16/16 ĐẠT** |
| Nạp lại bằng FBXLoader | 65 bone, 1 skinned mesh, 0 đỉnh mồ côi |

File mẫu mới: [mixamo-2013-rigged.fbx](<docs/m2m-v10/mixamo-2013-rigged.fbx>) (10,6 MB).

## 10. Điểm vẫn chưa kiểm chứng được


- **Chưa upload thử lên mixamo.com** để xác nhận 100%: trang upload yêu cầu đăng nhập Adobe,
  tôi không có tài khoản. Bằng chứng cho việc sửa version là **chính thông báo lỗi của Mixamo**
  (`Please use FBX files 2013 or earlier` — đọc từ ảnh bạn gửi) cộng với quy ước version
  suy trực tiếp từ header `X Bot.fbx` (`FBX 7.7.0` ↔ `7700`).
- `X Bot.fbx` là file **ASCII** vì Maya lưu lại; các bản Mixamo phát hành vẫn là **binary**.
  Nút mới ghi binary (đúng chuẩn phát hành của Mixamo). Nếu bạn upload bản binary 7300 mà
  Mixamo vẫn báo lỗi, hãy gửi lại ảnh thông báo — khi đó hướng tiếp theo là xuất **ASCII 7.3**
  (writer đã có sẵn nhánh ASCII, `VERSION_ASCII = 7300`).
- File mới **không kèm animation** (writer chưa ghi `AnimationStack`). Với bước *Upload
  Character*, Mixamo chỉ cần mesh + rig; motion gắn sau ở bước *Animations*.
