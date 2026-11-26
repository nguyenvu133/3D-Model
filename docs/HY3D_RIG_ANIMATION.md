# HY3D — Học cách rig và animation (bonechar.fbx / punch.fbx)

Tài liệu học trực tiếp trong studio: nhân vật HY3D (Tencent Hunyuan3D)
đã có sẵn trong tab **Animation → 🥊 HY3D** (`js/characters/hy3d.js`).
Mọi số đo dưới đây đo thật bằng FBX SDK (`fbx2gltf` 0.9.7) + three r128
FBXLoader trên đúng 2 file user gửi (xem `docs/HY3D_RIG_ANIMATION.md` §7
để biết file nào, md5 nào). Không có số nào đoán.

> ⚠️ **Cấm kỵ (đã dạy user):** ĐỪNG upload `bonechar.fbx` / `punch.fbx`
> lên Mixamo — FBX 7400 mới hơn giới hạn 7300 của Mixamo, VÀ 2 file đã
> có skeleton nên Mixamo sẽ từ chối map ("Sorry, unable to map your
> existing skeleton"). Muốn lên Mixamo thì xuất mesh-only bằng nút
> **Save Mixamo** trong studio (xem `docs/MIXAMO_EXPORT_FIX.md`).

---

## 1. Hai file là gì, quan hệ với nhau

| File | Kích thước / md5 | Nội dung |
|---|---|---|
| `bonechar.fbx` | 34.988.316 B · `61d99d7a…` | Nhân vật đã rig, **không có animation** |
| `punch.fbx` | 35.210.684 B · `54d74741…` | **Cùng nhân vật đó** + 1 clip đấm |

Hai file là **cùng một nhân vật** — mesh hash đỉnh trùng khớp, bbox trùng
khớp, skeleton trùng khớp. `punch.fbx` = `bonechar.fbx` + thêm 1 clip.
Tên file do user đặt theo nội dung: `bonechar` = nhân vật có xương (bone
character), `punch` = clip đấm.

Cả 2 file đều xuất từ **Blender** (không phải Mixamo, không phải Maya):

| | bonechar.fbx | punch.fbx |
|---|---|---|
| Blender | 4.0.0 · FBX IO 5.8.12 | 3.6.14 · FBX IO 5.4.1 |
| FBX version | 7400 | 7400 |
| Đơn vị | cm (`UnitScaleFactor` 1.0) | cm |
| Trục gốc | Z-up (Blender) | Z-up (Blender) |

Hai phiên bản Blender khác nhau = 2 lần xuất riêng: lần 1 xuất nhân vật
rig sẵn, lần 2 retarget animation rồi xuất lại. Đây là quy trình chuẩn của
HY3D Studio: tạo nhân vật → auto-rig → gắn motion template → xuất FBX.

---

## 2. Rig HY3D — xương, skin, bind pose

### 2.1 Mesh

- 1 SkinnedMesh `node_0001`, đúng **50.000 tris** / **150.000 verts**
  (non-indexed — 3 verts/tri, không dùng index buffer). Đây là giới hạn
  50k quen thuộc của Tripo/HY3D.
- Cao **~153 cm** (đơn vị cm của Blender), mặt hướng **+Z**, chân y≈0.
- 1 material `Material.001`, 3 texture nhúng sẵn trong file:
  - `texture_pbr_20250901.png` — baseColor
  - `texture_pbr_20250901_normal.png` — normalMap
  - `ao_met_rough_Shader Nodetree_Roughness_Green_separated.jpg` —
    AO/metal/rough gói chung (kênh Green = roughness)
- FBXLoader cảnh báo `ShininessExponent map` / `ReflectionFactor map is
  not supported` — **vô hại**, three.js bỏ qua 2 map này, không sửa mesh.

### 2.2 Skeleton — 28 xương, tên kiểu Mixamo KHÔNG prefix

Tên xương giống hệt Mixamo, chỉ khác **không có tiền tố `mixamorig:`**.
Studio đã xử lý cả 2 dạng (regex strip prefix `^mixamorig:?` trong
`rig-auto-gen.js:321`), nên skeleton HY3D map thẳng vào tên canonical
của studio (Hips/Spine/LeftArm/…).

| Xương | Parent | Dài tới xương con (cm) | Ghi chú |
|---|---|---|---|
| `root` | `Armature` | — | gốc skeleton |
| `Hips` | `root` | 7,19 → `Spine` | cao 52,06 cm |
| `Spine` | `Hips` | 7,40 → `Spine1` | |
| `Spine1` | `Spine` | 8,82 → `Spine2` | **đứng yên trong clip Punch** |
| `Spine2` | `Spine1` | 10,15 → `Neck` | |
| `Neck` | `Spine2` | 6,16 → `Head` | |
| `Head` | `Neck` | 50,01 → `Head_end` | xương đầu rất dài (xem §2.4) |
| `Head_end` | `Head` | — | xương cuối, không skin |
| `LeftShoulder` | `Spine2` | 10,67 → `LeftArm` | |
| `LeftArm` | `LeftShoulder` | 14,90 → `LeftForeArm` | cánh tay trên |
| `LeftForeArm` | `LeftArm` | 11,95 → `LeftHand` | cẳng tay |
| `LeftHand` | `LeftForeArm` | 11,85 → `LeftHand_end` | bàn tay |
| `LeftHand_end` | `LeftHand` | — | xương cuối, không skin |
| `RightShoulder` | `Spine2` | 10,38 → `RightArm` | |
| `RightArm` | `RightShoulder` | 14,10 → `RightForeArm` | |
| `RightForeArm` | `RightArm` | 11,62 → `RightHand` | |
| `RightHand` | `RightForeArm` | 11,93 → `RightHand_end` | |
| `RightHand_end` | `RightHand` | — | xương cuối, không skin |
| `LeftUpLeg` | `Hips` | 21,64 → `LeftLeg` | đùi |
| `LeftLeg` | `LeftUpLeg` | 21,52 → `LeftFoot` | cẳng chân |
| `LeftFoot` | `LeftLeg` | 11,89 → `LeftToeBase` | bàn chân |
| `LeftToeBase` | `LeftFoot` | 4,91 → `LeftToeBase_end` | ngón chân |
| `LeftToeBase_end` | `LeftToeBase` | — | xương cuối, không skin |
| `RightUpLeg` | `Hips` | 21,17 → `RightLeg` | |
| `RightLeg` | `RightUpLeg` | 21,51 → `RightFoot` | |
| `RightFoot` | `RightLeg` | 12,26 → `RightToeBase` | |
| `RightToeBase` | `RightFoot` | 5,10 → `RightToeBase_end` | |
| `RightToeBase_end` | `RightToeBase` | — | xương cuối, không skin |

**Không có xương ngón tay** (không có `Thumb`/`Index` như Mixamo), không
có `Chest` (chỉ `Spine`/`Spine1`/`Spine2`), không có `HeadTop_End`
(chỉ `Head_end`).

### 2.3 Skin — 23 xương, weights hoàn hảo

Skin dùng 23 xương (không tính 5 xương `*_end`, không tính `Armature`):

> `root, Hips, Spine, Spine1, Spine2, Neck, Head,`
> `LeftShoulder, LeftArm, LeftForeArm, LeftHand,`
> `RightShoulder, RightArm, RightForeArm, RightHand,`
> `LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase,`
> `RightUpLeg, RightLeg, RightFoot, RightToeBase`

- Weights: **0 đỉnh lệch, tổng đúng 1.0, lệch max 0.000000** — skin
  chuẩn production (do HY3D auto-rig sinh ra, không phải skin theo
  khoảng cách như Rig 1 Lượt của studio).
- Bind pose là **T-pose**: 2 tay dang ngang ở cao vai (tay trái x=+40cm,
  tay phải x=−43cm), chân thẳng, mũi chân hướng +Z.

### 2.4 Tay ĐÚNG hướng — điểm đáng học nhất

Góc giữa hướng cẳng tay (khuỷu → cổ tay) và trục +Y của xương bàn tay
lúc nghỉ:

| | Trái | Phải |
|---|---|---|
| HY3D | **3,7°** | **9,2°** |
| Mixamo XBot (chuẩn) | 0,0° | 0,0° |
| Rig studio trước khi sửa (V1) | 147,5° | 147,5° |

HY3D gần như đúng chuẩn Mixamo. Rig studio cũ lệch 147° nên mọi clip
mocap đều xoắn bàn tay ~147° suốt clip — đó là gốc lỗi "tay biến dạng"
đã sửa ở V2 bằng world-space retarget (xem `docs/MIXAMO_EXPORT_FIX.md`
mục mocap). **Bài học: khi tự rig, kiểm tra góc tay ngay lúc bind —
nếu lệch >10° thì mọi animation sau đó đều hỏng tay.**

### 2.5 Tỉ lệ chibi

Nhân vật cao 153 cm nhưng tỉ lệ không phải người thật:

- Xương đầu `Head → Head_end` dài **~50 cm = 1/3 chiều cao** (người
  thật ~1/7). Đây là nhân vật chibi đầu to.
- Đùi 21,6 cm, cẳng chân 21,5 cm, cánh tay trên 14,9 cm, cẳng tay
  11,9 cm, hông cao 52 cm.
- Hệ quả khi retarget (đã gặp ở Wushu V3): tỉ lệ tay chân khác
  performer người thật nên **không copy góc khớp thô** được — phải
  retarget bằng IK theo vị trí + giữ góc khớp (`d_keep`), xem §5.

---

## 3. Animation Punch — clip đấm 2,333 giây

### 3.1 Cấu trúc clip

- Tên clip: `Armature|39f5afe64eb927df712c0fb9326f718b_remap`
- Dài **2,333 s**, bake **60 fps, 141 keys** (key mỗi 1/60 s).
- **87 tracks** (FBXLoader) / 31 channels (glTF): mỗi xương có 3 track
  `position` / `quaternion` / `scale`. Track `position`/`scale` chỉ có
  2 keys (đứng yên); track `quaternion` của xương động có 124–141 keys.
- **21 xương xoay**, 7 xương đứng yên:

| Xoay (keys > 2) | Đứng yên (2 keys) |
|---|---|
| Hips, Spine, Spine2, Neck, Head, LeftShoulder, LeftArm, LeftForeArm, LeftHand, RightShoulder, RightArm, RightForeArm, RightHand, LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase, RightUpLeg, RightLeg, RightFoot, RightToeBase | `root`, `Armature`, `Spine1`, `Head_end`, `LeftHand_end`, `RightHand_end`, `LeftToeBase_end`, `RightToeBase_end` |

- **Không có root motion**: `Hips.position` hằng số, Hips Y cố định
  52,1 cm — đấm tại chỗ, không di chuyển, không nhún.
- **Loop kín**: key đầu = key cuối trên mọi track quaternion (lệch
  < 1°) — phát `LoopRepeat` không giật. (FBX không lưu cờ loop; tính
  loop suy ra từ dữ liệu.)
- Xoay nhanh nhất mỗi key: `RightForeArm` 27,2° (cú đấm), `LeftHand`
  17,1°, `RightArm` 16,7°, `RightHand` 15,6° — nhanh nhưng không snap
  (so với mocap studio từng có jump 79,3° ở `LeftHand`).

### 3.2 Diễn biến từng pha (đơn vị cm, mặt hướng +Z)

| Thời gian | Tay trái (LHand) | Tay phải (RHand) | Hips Y |
|---|---|---|---|
| t = 0,00 s | (−1,5; 58,8; **+38,4**) — đấm thẳng ra trước, khuỷu 145° (duỗi) | (−12,2; 71,4; −21,4) — thu sau lưng, khuỷu 95° (co, thủ thế) | 52,1 |
| t = 0,17–0,50 s | Thu lên cao (19,6; 85,5; 37,6), khuỷu 140–169° | Chuẩn bị (−19,5; 67,6; −12,5), khuỷu 81–100° | 52,1 |
| t = 0,67 s | Thu về (11,8; 76,7; 18,7), khuỷu 111° | Bắt đầu vươn (−17,8; 66,1; +15,2), khuỷu 59° | 52,1 |
| **t = 0,83–1,17 s** | Thu hẳn về (8,7; 71,2; 5,3), khuỷu 74–82° | **Đấm thẳng (−7,8; 81,1; +43,9), khuỷu 150–157° (duỗi thẳng)** | 52,1 |
| t = 1,33–1,67 s | Vươn lại (18,1; 79,9; −16,6) | Thu về (−24,3; 68,3; 4,4), khuỷu 106–130° | 52,1 |
| t = 1,83–2,33 s | Trở về tư thế đầu | Trở về tư thế đầu | 52,1 |

Tóm tắt: **đấm trái mở đầu → thu về → đấm phải (cross) → thu về →
loop**. Chân vẫn chạm đất suốt clip (xương bàn chân cao 13–24 cm, dao
động do dồn trọng lượng sang chân trước khi đấm).

### 3.3 Ý nghĩa tên clip `_remap`

Tên `Armature|<hash>_remap` là tên action của Blender sau khi
**retarget**: animation gốc (có thể từ motion template của HY3D hoặc
mocap) được map lại (remap) lên armature này trong Blender rồi mới xuất
FBX. Bằng chứng: `punch.fbx` xuất bằng Blender 3.6.14 trong khi
`bonechar.fbx` xuất bằng Blender 4.0.0 — 2 lần xuất riêng, lần sau là
bước retarget + gắn clip.

---

## 4. So sánh: Mixamo — HY3D — Rig studio

| | Mixamo (XBot / Thiếu Lâm rigged) | HY3D | Studio (Rig 1 Lượt) |
|---|---|---|---|
| Tên xương | `mixamorig:Hips` (prefix + `:`) | `Hips` (không prefix) | `mixamorig:*` (23 viewport) |
| Số xương | 65 (XBot, có ngón) / 34 (Thiếu Lâm) | 28 (không ngón) | 23 viewport + 65 khung export |
| Skin | 34 joints (Thiếu Lâm) | 23 joints | 23 |
| Tay lúc nghỉ | 0,0° | 3,7° / 9,2° | 147,5° trước fix → 0,0° sau V2 |
| Bind pose | T-pose | T-pose | A-pose (model Tripo) |
| FBX version | 7700 (gốc) / 7300 (studio xuất) | 7400 (Blender) | 7300 |
| Animation | 1-frame T-pose `mixamo.com` | bake 60 fps, 141 keys, loop | procedural + mocap JSON |
| Đơn vị | cm | cm (Blender) | mét (chuẩn 1,8 m) |
| Ngón tay | có (`Thumb`/`Index`) | không | không (viewport) |
| Xuất từ | Mixamo web | Blender 4.0 / 3.6 | studio (writer riêng) |

**Điểm chung quan trọng:** tên xương HY3D = tên canonical của Mixamo
(trừ prefix), nên clip HY3D map thẳng tên xương sang nhân vật Mixamo
mà không cần bảng map riêng.

---

## 5. Cách áp dụng — retarget clip HY3D sang nhân vật khác

### 5.1 Map thẳng tên xương (khi bind pose giống nhau)

Vì tên xương khớp Mixamo, clip `punch.fbx` gắn thẳng vào bất kỳ
skeleton Mixamo nào bằng `AnimationMixer` (track bind theo tên).
Trong studio: load `punch.fbx` làm clip + load nhân vật đích làm base
— đúng pattern `js/characters/thandieu.js` (base file + clip file riêng).

### 5.2 Khi bind pose khác nhau — world-space retarget / IK

Bind pose HY3D là T-pose; nhân vật Tripo của studio là A-pose; tay
studio cũ lệch 147°. Copy góc khớp thô (local quaternion) sẽ sai.
Hai cách đã chứng minh trong repo:

- **World-space retarget (Convention M')** — `docs/MIXAMO_EXPORT_FIX.md`
  mục mocap (V2): lấy world orientation từng frame của nguồn → local
  của đích qua chuỗi parent rest-pose + `R_fix` (xoay +Y về hướng
  xương con lúc A-pose). Dùng khi copy clip mocap/Blender sang rig
  studio. Tay khóa vào cẳng tay.
- **IK theo vị trí + giữ góc khớp (`d_keep`)** — WushuAttack V3
  (`thieulam-Rigged-WushuAttack-V3.fbx`): đặt cổ tay/cổ chân đúng vị
  trí performer (đã scale theo tỉ lệ), giải khuỷu/gối bằng định luật
  cos — giữ góc khớp đúng 0,00°, tay chạm đích 0,000 m. Dùng khi nhân
  vật chibi (tỉ lệ tay chân khác performer).

### 5.3 Bẫy đã gặp — đừng lặp lại

1. **Frame-0 không phải bind pose.** Model nodes trong `punch.fbx`
   lưu tư thế frame-0 (tay trái đang đấm). `stop()` trong studio khôi
   phục snapshot rest từ `bonechar.fbx`, không phát frame 0 (bài học
   Thần Điêu: frame-0 của clip T-pose Mixamo cũng lệch bind pose).
2. **`skeleton.boneInverses` không khôi phục được bind pose.** Đo
   trong chính `bonechar.fbx`: world quat từ `boneInverses` lệch tới
   16,8° so với hierarchy đã parse. Đừng dùng `boneInverses` làm rest.
3. **Đơn vị cm, không phải mét.** Nhân vật cao 153 đơn vị = 153 cm.
   Studio scale root về cao 2,0 m lúc preview (`Hy3d.addToViewport`,
   như Thần Điêu) — đừng tưởng nhân vật cao 153 m.
4. **Mesh node mang quaternion −90° X** (Z-up Blender → Y-up). Geometry
   local vẫn Z-up; đo kích thước bằng `Box3.setFromObject` (đã qua
   transform), đừng đo `geometry.attributes.position` thô.
5. **Euler wrap khi xuất lại clip.** Writer đổi quaternion → Euler ZYX
   rồi wrap từng key về [−180°, +180°] sẽ tạo span giả ~350° làm chân
   bay lên trời giữa các key (lỗi đã sửa ở V3/Wushu V2 — writer hiện
   tại đã unwrap). Harness playback phải sample **giữa** các key, không
   chỉ ở key time.

---

## 6. Cách dùng trong studio

### 6.1 Upload 2 file FBX lên repo (1 lần)

File FBX là binary nên **không đẩy được qua connector** — upload bằng
GitHub web UI:

1. Mở repo `nguyenvu133/3D-Model` → thư mục `models/` → **Add file →
   Create new file**, gõ `hy3d/.gitkeep` để tạo thư mục (hoặc upload
   thẳng).
2. Vào thư mục `models/hy3d/` → **Add file → Upload files** → chọn
   `bonechar.fbx` + `punch.fbx` → **Commit changes**.
3. Đợi GitHub Pages deploy xong (khoảng 1 phút).

### 6.2 Mở trong studio

1. Mở studio (GitHub Pages) → tab **Animation**.
2. Mục **🥊 HY3D — nhân vật Blender · 2 clips** (sau mục Coco).
3. Bấm **Load từ models/hy3d/** — nhân vật tự vào viewport, clip
   **Punch** tự phát (loop).
4. Chưa upload file lên repo? Bấm **Chọn file bonechar.fbx /
   punch.fbx từ máy…** hoặc kéo-thả 2 file vào khung — dùng được ngay
   không cần repo.

### 6.3 Trong panel có gì

- 2 nút clip: **Đấm thẳng** (2,33 s, loop, FBX thật) + **T-Pose**
  (0,033 s, once, sinh từ bind pose).
- Play / Pause / Resume / **Stop (về T-Pose)** — Stop khôi phục bind
  pose từ `bonechar.fbx`, không phải frame 0.
- Tốc độ 0,25–2x, crossfade 0,25 s, nút **Clips JSON** (export format
  `pixistudio-hy3d-clips-1`), nút **Preview** / **Remove**.
- Mục **Học rig** hiển thị tóm tắt: 28 xương / 23 skin · tay 3,7° ·
  9,2° · 60 fps · loop.
- Nhân vật đăng ký vào `RigAutoGen.current` nên IK / Pose / Bone
  Editor nhận ra như Thần Điêu / Coco.

### 6.4 Nếu chỉ có 1 file

- Chỉ có `punch.fbx`: vẫn load được (dùng làm base luôn) nhưng Stop sẽ
  về **frame-0** (tay trái đấm) chứ không phải T-pose — panel báo rõ.
  Upload thêm `bonechar.fbx` để có T-pose đúng.
- Chỉ có `bonechar.fbx`: chỉ có clip T-Pose tĩnh, không có Punch.

---

## 7. Nguồn số liệu + file liên quan

- File gốc (local): `~/workspace/user/files/bonechar.fbx`
  (34.988.316 B, md5 `61d99d7a98bcb3d59455205459a4df9d`) và
  `~/workspace/user/files/punch.fbx` (35.210.684 B, md5
  `54d747419624bf6fab83953884f1699c`). 2 link Google Drive user gửi
  2026-11-26 ~08:52 +07 (trang HY3D cần đăng nhập nên tải qua Drive).
- Harness kiểm chứng: `~/workspace/.test-fbx/inspect-hy3d.js`
  (mesh/skeleton/skin/bind pose) + `~/workspace/.test-fbx/sample-hy3d-punch.js`
  (diễn biến clip từng 1/6 s) + `~/workspace/.test-fbx/test-hy3d-character.js`
  (module nhân vật trong studio).
- Module studio: `js/characters/hy3d.js` (namespace `PixiStudio.Hy3d`),
  wiring `js/core/app.js` (+1 dòng `Hy3d.update(dt)`) + `index.html`
  (+1 script tag sau `coco.js`).
- Bài học retarget: `docs/MIXAMO_EXPORT_FIX.md` (mục mocap V2/V3,
  Euler unwrap, Lần 7 Mixamo-safe) + `docs/THANDIEU_CHARACTER.md` +
  `docs/COCO_CHARACTER.md`.
