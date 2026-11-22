# Mixamo — file có MÀU + nút "Save Mixamo" (22/11/2026)

## 1. Vì sao FBX trước đây không có màu

`js/exporter/fbx-binary.js` chỉ ghi `Material` với `DiffuseColor=[1,1,1]` — **không có node
`Texture`/`Video` nào**, nên model lên Mixamo luôn trắng/xám.

File FBX Meshy gốc lại có màu vì nó chứa:

| Thành phần | Vai trò |
|---|---|
| `Video` (4 cái) | **ảnh nhúng thẳng vào file** trong property `Content` (raw bytes JPEG/PNG) |
| `Texture` (4 cái) | trỏ tới `Video` qua `Media`, khai `Type = TextureVideoClip` |
| `Connections` | `OO Video → Texture` và `OP Texture → Material` **kèm tên property** (`DiffuseColor`, `NormalMap`, `ShininessExponent`, `ReflectionFactor`) |

Thiếu bất kỳ mảnh nào → mất màu. Đặc biệt connection `OP` **phải có tên property**;
không có thì Blender/Mixamo không biết gắn ảnh vào kênh nào.

## 2. Đã sửa gì

[js/exporter/fbx-binary.js](<js/exporter/fbx-binary.js>)

- Thêm `encodeTextureToBytes(tex, slot, opts)` — vẽ `tex.image` (ưu tiên
  `tex.userData.originalImage`, tức ảnh gốc chưa bị GLTFLoader/texImage xử lý) lên canvas,
  xuất JPEG q0.92 (riêng normal map xuất PNG để không hỏng vector) rồi lấy bytes.
- Thêm khối ghi texture: với mỗi material, quét
  `map→DiffuseColor`, `normalMap→NormalMap`, `roughnessMap→ShininessExponent`,
  `metalnessMap→ReflectionFactor`, `aoMap→AmbientColor`, `emissiveMap→EmissiveColor`;
  ghi `Video` (có `Content` = bytes) + `Texture` + 2 connection.
- `Definitions` giờ đếm **đúng** số `Texture`/`Video` (trước hard-code 0).
- Connection hỗ trợ property thứ 4 (`OP` có tên property).
- Option mới: `embedTextures` (mặc định bật), `texFlip` (`'auto'` mặc định), và
  `textureBytes` — truyền bytes ảnh lấy sẵn từ FBX nguồn (giữ **nguyên byte**, không nén lại).
- `report` thêm `textures` và `textureReport`.

> **Lưu ý về chiều ảnh:** glTF dùng UV gốc *trên-trái*, FBX dùng gốc *dưới-trái*.
> three.js `GLTFLoader` đặt `flipY=false`, `FBXLoader` dùng `flipY=true` mặc định và
> **giữ UV raw**. Vì vậy khi ghi FBX từ nguồn GLB, ảnh **phải được lật dọc** thì viewer
> FBX mới hiển thị giống GLB. `texFlip:'auto'` làm đúng việc này; với nguồn đã là FBX
> thì ảnh được giữ nguyên.

## 3. Nút "Save Mixamo"

- **Topbar** [index.html](<index.html>): nút `Save Mixamo` (`#btn-save-mixamo`) cạnh nút Save,
  phím tắt **Ctrl+Shift+M**.
- **Save Center**: thêm định dạng `fbx-mixamo` = *"FBX Mixamo (MÀU + auto-rig)"*.
- Handler: [js/ui/panels.js](<js/ui/panels.js>) → `PixiStudio.SaveManager.save('fbx-mixamo')`.
- Xuất file: [js/exporter/save-manager.js](<js/exporter/save-manager.js>)
  - `waitForTextures(root, 8000)` — **chờ texture decode xong** trước khi ghi
    (FBXLoader/GLTFLoader giải mã ảnh bất đồng bộ; ghi sớm là mất màu).
  - `saveFBXMixamo()` gọi `FBXBinary.write(target, { noSkeleton:true, prepareMixamo:true,
    upAxis:'Y', autoScale:true, embedTextures:true })`.
  - Cảnh báo khi: ảnh chưa decode xong, model không có texture, hoặc > 50.000 tam giác
    (giới hạn auto-rig của Mixamo).

## 4. Kết quả kiểm chứng thật

| Kiểm tra | Công cụ | Kết quả |
|---|---|---|
| Cấu trúc file | `node tools/fbx-inspect.mjs` | `Texture:4 Video:4`, connection `OP → Material` đủ |
| Ảnh nhúng đúng là ảnh thật | `node tools/fbx-check-embedded.mjs` | 4/4 ảnh hợp lệ, 1024×1024, **khớp byte 100%** với nguồn |
| 16 mục Mixamo | `node tools/fbx-validate-mixamo.mjs` | **16/16 ĐẠT** (FBX 2013, mesh-only, +Y, đáy y=0, cao 1.8, mặt +Z, UV∈[0,1], cạnh hở 0%, 50.000 tris) |
| Nút bấm thật | `node tools/qa-mixamo-button.mjs` | tải về FBX **11,76 MB**, 0 page error, validator 16/16 |
| Nút OBJ ZIP | `node tools/qa-objzip.mjs` | ZIP 6,83 MB: obj+mtl+4 ảnh; render so GLB **khác 0% pixel**, IoU 100% |
| Nguồn GLB → FBX | `node tools/qa-mixamo-glb.mjs` | tải FBX 9,24 MB, 0 page error |
| Chiều texture | `node tools/qa-mixamo-tex-orient.mjs` | ảnh FBX = ảnh GLB **lật dọc** → đúng quy tắc UV, `flippedPct 0.01%` |
| UV không đổi | `node tools/fbx-uv-dump.mjs` | UV xuất ra khớp UV mà FBXLoader đọc từ nguồn (`uv[0] = 0.7166, 0.7827`) |

File mẫu có màu: [monter1-mixamo-color.fbx](<docs/m2m-v10/monter1-mixamo-color.fbx>) —
50.000 tam giác, 4 texture nhúng (basecolor + normal + roughness + metallic), đã qua 16/16.

## 5. Cách tự làm lại

```powershell
# server phải đang chạy ở cổng 8099
node server.js 8099

# xuất FBX có màu từ file nguồn (giữ nguyên byte ảnh)
node tools/fbx-mixamo-fix.mjs "Meshy_AI_tripo_convert_monter1_20261122_texture.fbx" `
  --out "docs/m2m-v10/monter1-mixamo-color.fbx"

# kiểm chứng
node tools/fbx-check-embedded.mjs "docs/m2m-v10/monter1-mixamo-color.fbx" "Meshy_..._texture.fbx"
node tools/fbx-validate-mixamo.mjs "docs/m2m-v10/monter1-mixamo-color.fbx"
```

Trong app: mở `http://127.0.0.1:8099/` → nạp model → bấm **Save Mixamo** (FBX có màu)
hoặc **Save OBJ ZIP** (`.obj` + `.mtl` + ảnh có màu).

```powershell
# kiểm thử nút OBJ ZIP (giải nén + dựng lại + render so sánh)
node tools/qa-objzip.mjs assets/models/tripo_convert_monter1.glb
```

## 6. OBJ thì sao?

OBJ **không mang màu trong một file**. Màu OBJ nằm ở cặp `.obj` + `.mtl` + ảnh texture
(`map_Kd`), tức phải có **3 file cạnh nhau**. Vì vậy có **hai nút**:

| Nút | Xuất ra | Khi nào dùng |
|---|---|---|
| **Save Mixamo** (`#btn-save-mixamo`, Ctrl+Shift+M) | 1 file `.fbx` 2013, mesh-only, texture nhúng trong `Video.Content` | Đường **chắc nhất** để Mixamo thấy màu |
| **Save OBJ ZIP** (`#btn-save-objzip`, Ctrl+Shift+O) | 1 file `.zip`: `model.obj` + `model.mtl` + ảnh + README | Khi cần OBJ (Blender/Maya/Unity/engine khác) **mà vẫn có màu** |

### Nút "Save OBJ ZIP" ghi gì

[js/exporter/save-manager.js](<js/exporter/save-manager.js>) — `buildObjMtlBundle()` + `saveOBJColorZip()`:

- `model.obj`: `v` / `vt` / `vn` / `usemtl` / `mtllib` / `f` (toạ độ đã bake theo world,
  hỗ trợ material group nếu mesh có nhiều material).
- `model.mtl`: `newmtl`, `Kd` (màu material), `Ka`, `Ks`, `Ns`, `Ni`, `d`, `illum 2`, và các dòng ảnh:
  `map_Kd` (basecolor), `norm` (normal), `map_Pr` (roughness), `map_Pm` (metalness),
  `map_Ka` (ao), `map_Ke` (emissive).
- Ảnh texture: ghi thẳng ra file trong ZIP (`<material>_map.jpg`, `<material>_normalMap.png`, …).
- `README.txt`: hướng dẫn import và nhắc rằng **đổi tên file thì phải sửa dòng `map_Kd`**.

**Chiều UV quan trọng:** OBJ dùng gốc UV **dưới-trái** còn glTF dùng gốc **trên-trái**. Nên khi
nguồn là glTF (Meshy/Tripo GLB — `map.flipY === false`) nút này ghi `v' = 1 - v` và **giữ
nguyên ảnh**. Nếu nguồn đã là FBX (`flipY === true`) thì giữ nguyên UV. Lật cả hai (UV *và* ảnh)
là lỗi — sẽ ra ảnh lộn ngược.

### Kiểm chứng nút OBJ ZIP

`node tools/qa-objzip.mjs` (nạp GLB → bấm nút → giải nén → dựng lại + render so sánh):

| Kiểm tra | Kết quả |
|---|---|
| ZIP có gì | `monter1_glb.obj` 5,39 MB + `monter1_glb.mtl` + **4 ảnh** + `README.txt` |
| Ảnh hợp lệ | 4/4 (JPEG/PNG đúng magic bytes) |
| `map_Kd` | trỏ tới file **có thật trong ZIP** ✓ |
| Nội dung OBJ | `v=34757 vt=34757 vn=34757 f=50000 usemtl=1 mtllib=monter1_glb.mtl` |
| `THREE.OBJLoader` đọc lại | **1 mesh, 50.000 tam giác, có UV, gắn được map** ✓ |
| Ảnh `map_Kd` vs basecolor GLB | khớp **99,99%** (không bị lật) |
| Render GLB vs OBJ (cùng ảnh, cùng góc) | bounding box trùng khít, silhouette IoU **100%**, **pixel khác màu 0%** |

File mẫu: [monter1-obj-mtl-color.zip](<docs/m2m-v10/monter1-obj-mtl-color.zip>) (7,16 MB).

> Lưu ý trung thực: Mixamo upload chủ yếu nhận **FBX**; nếu bạn đưa ZIP lên Mixamo mà nó không
> nhận, hãy dùng nút **Save Mixamo**. ZIP này chắc chắn dùng được cho Blender (File > Import >
> Wavefront), Maya, Unity — nơi `.mtl` + ảnh đi kèm là chuẩn.

## 7. Giới hạn đã biết

- Mixamo yêu cầu **FBX 2013 trở xuống** (version ≤ 7400) và **mesh-only** cho auto-rig —
  nút Save Mixamo đã cố định cả hai.
- Mixamo auto-rig chấp nhận **≤ 50.000 tam giác**; vượt thì nút sẽ cảnh báo vàng.
- File xuất ở đây chỉ có **1 mesh 1 material**; model nhiều material sẽ có nhiều `Video`
  (đúng nhưng Mixamo có thể chỉ hiển thị material đầu).
- Mixamo **không đọc được** roughness/metallic theo chuẩn PBR — hai kênh đó được ghi vào
  `ShininessExponent`/`ReflectionFactor` giống hệt file Meshy gốc để tương thích, không
  phải ánh xạ PBR đúng nghĩa.
