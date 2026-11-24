# NHÂN VẬT THẦN ĐIÊU — Mixamo Rig Character

Nhân vật Thần Điêu hoàn chỉnh dùng trong PixiJS Studio × Tripo3D AI Studio,
theo mẫu `js/animation/fbx-rig-import.js` (FbxRig). Load 3 file FBX thật,
chuyển được giữa 11 animation, đăng ký vào `RigAutoGen.current` nên IK,
Pose Library và AnimAutoGen nhận nhân vật.

## 1. File FBX — số liệu đã kiểm chứng

3 file do user gửi (cùng 1 nhân vật, đã kiểm chứng bằng three r128 FBXLoader
+ fbx2gltf 0.9.7 dùng FBX SDK thật):

| File | Kích thước | Nội dung |
|---|---|---|
| `thandieu-Mixamo.fbx` (base, đổi tên từ `thandieu-Mixamo-2af9fcc0.fbx`) | 3.772.864 B | T-pose, clip `mixamo.com` 0.033s (1 frame tĩnh) |
| `Neutral_Idle.fbx` | 4.201.024 B | Clip `mixamo.com` 8.767s, 35 tracks, 34 nodes |
| `Than_dieu_Fast_Run.fbx` | 3.797.328 B | Clip `mixamo.com` 0.533s, 35 tracks, 34 nodes |

Nhân vật chung:

- SkinnedMesh `than_dieu`: **129.399 verts · 43.133 tris**, skin weights hợp
  lệ (tổng 1.0, 0 bad), material `tripo_mat_b362476f-...`
- BBox **1.28 × 1.80 × 1.06**, chân y = 0
- Skeleton **41 bones** (34 bones có skin), root `mixamorigHips`
- Tên bone dạng **no-colon** `mixamorigHips` (biến thể Mixamo không dấu hai
  chấm) — module chuẩn hoá bằng regex `/^mixamorig:?/i` (giống
  `js/rigging/rig-auto-gen.js:321`)

### Đưa 3 file FBX lên repo — BẰNG GITHUB WEB UI (bắt buộc)

File `.fbx` là **binary** nên KHÔNG đẩy được qua GitHub connector (chỉ nhận
text UTF-8). Các file trong `models/thandieu/` ở máy local chỉ dùng để test,
**không bao giờ đưa vào push manifest**. User tự upload:

1. Mở repo `nguyenvu133/3D-Model` trên github.com → thư mục `models/thandieu/`
   (tạo thư mục nếu chưa có).
2. **Add file → Upload files**, chọn đúng 3 file với đúng tên:
   `thandieu-Mixamo.fbx`, `Neutral_Idle.fbx`, `Than_dieu_Fast_Run.fbx`.
3. Commit. Sau đó nút **Load từ models/thandieu/** trong studio sẽ chạy.

Nếu chưa upload mà bấm Load, panel báo rõ file nào thiếu và hướng dẫn chọn
3 file từ máy (nút **Chọn 3 file FBX từ máy…** hoặc kéo-thả vào khung).

## 2. Cách dùng trong studio

Mở tab **Animation** → section **🦅 Thần Điêu — nhân vật Mixamo · 11 clips**
(nằm ngay sau section Meshy FBX Rig).

1. Bấm **Load từ models/thandieu/** (hoặc chọn 3 file FBX từ máy).
   Nhân vật xuất hiện trong viewport, tự phát clip Idle.
2. Bấm 1 trong 11 nút clip để chuyển animation (crossfade 0.25s).
3. **Pause / Resume / Stop** (Stop về T-Pose), thanh trượt **Tốc độ 0.25–2x**.
4. **Preview**: đưa nhân vật ra lại viewport. **Clips JSON**: export toàn bộ
   11 clip ra `thandieu_clips.json` (format `pixistudio-thandieu-clips-1`).
   **Remove**: gỡ nhân vật khỏi viewport.

## 3. Danh sách 11 clips

| # | Clip | Thời lượng | Loop | Nguồn |
|---|---|---|---|---|
| 1 | Idle | 8.767s | loop | FBX thật (Neutral_Idle) |
| 2 | Chạy nhanh (FastRun) | 0.533s | loop | FBX thật (Fast Run) |
| 3 | T-Pose | 0.033s | once | FBX thật (base, 1 frame) |
| 4 | Vỗ cánh (WingFlap) | 1.6s | loop | Sinh: cánh (LeftArm/RightArm) ±50° |
| 5 | Mổ (Peck) | 1.0s | once | Sinh: Neck/Head cúi + Spine gập |
| 6 | Nhảy (Jump) | 0.7s | once | Sinh: Hips +0.25, chân co, cánh dang |
| 7 | Quạt cánh (Attack) | 0.85s | once | Sinh từ data Fast Run (tìm frame RightArm deviation max, mẫu FbxRig.generateAttack) |
| 8 | Xoay 360° (Turn) | 1.2s | once | Sinh: Hips xoay 360° quanh Y |
| 9 | Cúi chào (Bow) | 1.4s | once | Sinh: mẫu GEN.Bow (Spine/Chest/Head gập) |
| 10 | Đi chậm (Walk) | 1.4s | loop | Sinh: chân đung đưa + tay vung (mẫu GEN.Walk) |
| 11 | Ngã xuống (Death) | 1.5s | once | Sinh: Hips hạ 0.72, Spine ngả -65°, cánh dang, dừng ở frame cuối (clamp) |

Clip procedural đều là **rest-relative** (rest quaternion × delta Euler) vì
bone FBX có bind rotation khác identity — không dùng quaternion tuyệt đối.
Mọi clip được validate bằng `PixiStudio.Anim.validateClip` trước khi đăng ký;
clip lỗi bị bỏ + notify, không treo app.

## 4. Tích hợp kỹ thuật

- `js/characters/thandieu.js` — `PixiStudio.Thandieu`, theo mẫu FbxRig.
  Script tag sau `fbx-rig-import.js` trong `index.html`; `js/core/app.js`
  gọi `Thandieu.update(dt)` cạnh `FbxRig.update(dt)` (RigAutoGen.update đẩy
  mixer khi rig Thần Điêu đang là current — module tự tránh cập nhật 2 lần).
- Panel được gắn vào luồng render của Animation tab bằng cách bọc
  `FbxRig.renderPanel()` (không sửa `toolbar.js`).
- Đăng ký `RigAutoGen.current` đúng hình dạng rig hiện tại
  (`name/preset/rootBone/root/bones/helper/mixer/target/boneCount/skeleton/clips`)
  + đồng bộ `PixiStudio.Rig.current` cho Bone Editor. Skeleton có
  `getBoneByName` khớp theo tên đã bỏ prefix (regex `/^mixamorig:?/i`).
- Bus events: `thandieu:loaded`, `thandieu:clip-played`.

## 5. Giới hạn đã biết

- **FBXLoader cảnh báo "Vertex has more than 4 skinning weights"** — three.js
  chỉ giữ 4 weights, **vô hại**, không sửa mesh.
- **Clip T-pose của file lệch bind pose**: frame-0 của clip T-pose trong file
  Mixamo lệch pose lúc mới load ở 25/34 bone (tay 0.51 rad, chân 0.18–0.37 rad,
  ngón tay tới 0.87 rad ở `LeftHandIndex1` — do pre-rotation của skeleton
  trong file). Vì vậy nút **Stop khôi phục trực tiếp bind pose** (pose lúc mới
  load, cũng là điểm 0 của mọi clip procedural); clip **TPose vẫn phát được
  như dữ liệu gốc của file**. Đây là dữ liệu gốc, không phải lỗi module.
- **Rig Mixamo dạng humanoid, cánh = tay** (`LeftArm`/`RightArm`): các clip
  vỗ/quạt cánh thực chất là động tác tay của rig humanoid. Chưa có skeleton
  chim chuyên biệt.
- Thần Điêu là chim (không phải biped người) nên Mixamo auto-rig gốc có thể
  không nhận dạng hoàn hảo — nhưng file đã rig sẵn 41 bones nên dùng trực tiếp
  được trong studio.
- **Chưa test trên điện thoại thật** — mới kiểm thử bằng harness Node
  (jsdom + FBXLoader thật + mixer thật).

## 6. Kiểm thử

Harness `~/workspace/.test-thandieu/test-thandieu-character.js` — load 3 file
FBX thật, chạy logic thật của module (load repo qua HTTP + XHR shim,
load file, normalize, register, phát từng clip, advance mixer, crossfade,
setSpeed, pause/resume, stop, export JSON, panel):

- **121/121 pass × 2 vòng**
- Hồi quy: `test-fbx-mixamo.js` **73/73**, `test-rig-oneclick.js` **39/39**
- `node --check` OK cho `thandieu.js` + `app.js`; server smoke 200 cho
  `index.html`, `js/characters/thandieu.js`, `docs/THANDIEU_CHARACTER.md`
