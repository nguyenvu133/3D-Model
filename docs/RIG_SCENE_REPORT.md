# Báo cáo: bone map cho 8 họ rig + nâng cấp camera/scene viewport

**Ngày chạy:** 22/11/2026 · **Server:** `http://127.0.0.1:8099` (`node server.js 8099`)
**Nhân vật kiểm thử:** [tripo_convert_monter1.glb](<assets/models/tripo_convert_monter1.glb>) — static mesh 34.757 verts, chưa có rig.

---

## Phần 1 — Bone map cho các rig phi humanoid

### Vấn đề

Trước đây chỉ rig `human` có bảng map bone. Tám rig còn lại dùng hệ tên hoàn toàn khác:

| Rig | Ví dụ tên bone |
|---|---|
| fox / horse / kaiju | `back_leg_upper_l`, `front_leg_shoulder_r`, `tail_3`, `spine_4` |
| dragon | `wing_3_l`, `wing_feather_2_1_r`, `back_leg_ankle_r`, `horn_l` |
| bird | `wing_2_l`, `tail_2`, `UpperLeg_L`, `Toes_R` |
| snake | `tail20`, `tail09`, `neck`, `head` |
| shark | `front_fin_1_l`, `back_fin_2_r`, `tail_6`, `pelvis` |
| spider | `leg_a_2_l`, `leg_d_3_r`, `legs_anchor_2_l`, `hips` |

Nên không thể map sang rig humanoid 23 bone, và cũng không thể dùng bảng humanoid cũ.

### Cách giải quyết

1. **Trích cấu trúc xương gốc** từng rig từ `skeleton.glb` (đã tải) → `assets/animations/mesh2motion/rigs/<rig>.json` bằng [extract-rigs.mjs](<tools/extract-rigs.mjs>).
2. **Dựng rig trên nhân vật import** bằng cách clone chính `skeleton.glb` của rig đó — bone có **đúng tên và đúng rest rotation của nguồn** — rồi scale theo chiều cao mesh đích và bind skin.
3. **Retarget 1:1 theo tên bone** cho các rig này (`identity-by-name`), vì bone đích trùng tên bone gốc.

Module mới: [CreatureRigs](<js/rigging/creature-rigs.js>) · mở rộng map trong [M2MMotion](<js/animation/m2m-motion.js>)

### Hai lỗi gốc đã tìm ra và sửa

| Lỗi | Triệu chứng | Sửa |
|---|---|---|
| Parent của bone là node không tên (`Armature`) nên bị coi là root → **toàn bộ xương gắn phẳng** vào group | Bone di chuyển nhưng travel = 0, animation như đứng yên | Trích xuất nối tới **tổ tiên có tên gần nhất**; chọn bone root có nhiều hậu duệ nhất làm gốc mixer |
| Vị trí rest tính bằng cách **cộng translation mà bỏ qua rotation của parent** | Rig lệch/không khớp khung xương gốc | Bỏ cách tự tính, dùng thẳng `skeleton.glb` gốc (hierarchy + rest rotation chính xác) |

### Kết quả

| Rig | Họ | Bone | Mesh bind | Animation của rig | Track | Biến dạng bbox |
|---|---|---|---|---|---|---|
| fox | Quadruped | 53 | 1 | 21 | 48 | 1,11 ✓ |
| horse | Quadruped | 56 | 1 | 14 | 51 | 1,25 ✓ |
| kaiju | Quadruped | 58 | 1 | 10 | 54 | 1,64 ✓ |
| dragon | Dragon | 99 | 1 | 12 | 95 | 1,18 ✓ |
| bird | Bird | 55 | 1 | 9 | 52 | 1,37 ✓ |
| snake | Serpent | 28 | 1 | 8 | 25 | 1,17 ✓ |
| shark | Fish | 33 | 1 | 7 | 30 | 1,01 ✓ |
| spider | Arachnid | 56 | 1 | 11 | 54 | 2,26 ⚠ |

**8/8 họ dựng được rig và phát animation của chính họ.** Biến dạng được đo bằng công thức skinning trên CPU (`Σ w·(boneMatrix·bindMatrix·v)`), so bbox lúc phát với lúc nghỉ — 7 họ nằm trong 1,01–1,64 lần (hợp lý cho chuyển động), spider 2,26 lần do 8 chân xoè rộng khi gắn rig nhện lên mesh người — cần xem trực quan thay vì coi là lỗi.

Giao diện: [Mesh2Motion Workspace](<js/animation/mesh2motion-studio.js>) có thêm khối **Rig theo họ nhân vật (bone map)** với 7 họ, nút `🦴 Rig nhân vật đã import`, `📦 Nạp model rig này`, `🧪 Rig QA`. Chọn rig ở danh sách animation sẽ tự đổi chế độ map (`humanoid-retarget` hoặc `identity-by-name`).

---

## Phần 2 — Camera & tương tác scene

Module mới: [Interaction](<js/viewport/interaction.js>) + CSS trong [layout.css](<css/layout.css>), khởi động trong [app.js](<js/core/app.js>).

### Tính năng đã thêm

**Chọn & tương tác object**
- Click chọn object trong viewport; Ctrl/Shift+click chọn nhiều
- Hover làm sáng object, đổi con trỏ
- Outline khung bao quanh từng object đang chọn (object chính màu tím, các object khác màu xanh)
- **Kéo trực tiếp object** để di chuyển: kéo thường = mặt đất X/Z, **Shift+kéo = trục Y**; nhóm nhiều object di chuyển cùng delta
- Snap theo lưới (bật/tắt, đổi bước bằng `[` `]`)
- Drop to floor, Reset transform, Duplicate (Ctrl+D), Delete (Del), Select all (Ctrl+A), Clear (Esc)

**Camera**
- Thanh trượt **FOV**, **tốc độ orbit**, **bước snap**
- **Follow** object đang chọn (kiểm chứng hội tụ: gap 7,0 → 0,00 sau ~4s)
- Đổi **Perspective ↔ Orthographic** (phím `O`)
- Reset view, Focus (F), Frame all (Shift+F)
- 8 góc nhìn sẵn có giữ nguyên (phím 1–8)

**HUD**
- Bảng nổi **Camera & Scene** trong viewport (thu gọn được) với 10 nút thao tác
- HUD thông số object đang chọn: tên, số object chọn thêm, toạ độ, số mesh / tam giác / bone

### Kiểm thử

| Hạng mục | Kết quả |
|---|---|
| Bảng Camera & Scene tồn tại | ✓ |
| HUD object tồn tại | ✓ |
| Click chọn object giữa viewport | ✓ chọn `hiepkhach2` |
| Kéo object di chuyển | ✓ (0, 0, 0) → (1,095, 0, 0) |
| Chọn nhiều + outline | ✓ 3 object, 3 outline |
| FOV | ✓ 38 → 64 |
| Ortho ↔ Perspective | ✓ cả hai chiều |
| Follow | ✓ hội tụ về 0 sau ~4s |
| Tốc độ orbit | ✓ 1,8 |
| Drop to floor | ✓ min.y = 0 |
| Reset transform | ✓ x = z = 0 |
| Duplicate / Delete | ✓ 3 → 4 → 3 object |
| Focus | ✓ bán kính 1,96 |
| Snap `]` | ✓ 0,25 → 0,30 |
| Page error | 0 |

### Lỗi gốc đã sửa

**`Duplicate` làm tràn stack** (`Maximum call stack size exceeded`) khi nhân bản model GLB. Nguyên nhân: `userData.modelEntry` trỏ ngược lại chính model → tham chiếu vòng; `Object3D.copy()` của three dùng `JSON.stringify(userData)` nên đệ quy vô hạn.

Đã sửa trong [model-manager.js](<js/models/model-manager.js>) bằng `Object.defineProperty(..., { enumerable: false })`, và thêm nhánh nhân bản an toàn trong [scene-manager.js](<js/scene/scene-manager.js>) khi clone vẫn lỗi.

---

## Bằng chứng

- [creature-rigs.json](rig-scene-test/creature-rigs.json) — bone, số track, travel của từng họ rig
- [skin-deform.json](rig-scene-test/skin-deform.json) — tỉ lệ biến dạng bbox từng họ
- [interaction.json](rig-scene-test/interaction.json) — kết quả kiểm thử tương tác
- [rig_camera_panel.png](rig-scene-test/rig_camera_panel.png) — ảnh giao diện: nhân vật import đang chạy animation `Run` của rig fox, bảng Camera & Scene bên trái

## Chạy lại

```powershell
node server.js 8099
node tools/extract-rigs.mjs                 # cập nhật cấu trúc xương từ skeleton.glb
node tools/qa-creature-rigs.mjs             # 8 họ rig + animation của chính họ
node tools/qa-skin-deform.mjs               # đo biến dạng bằng công thức skinning
node tools/qa-interaction.mjs               # click / kéo / multi-select / camera
node tools/qa-follow.mjs                    # camera follow
```

## Giới hạn

- Rig dựng bằng cách gắn khung xương của loài lên mesh người/hình dạng bất kỳ là **best-effort theo tỉ lệ**, không phải khớp giải phẫu; muốn chính xác phải có mesh đúng loài (dùng `📦 Nạp model rig này` để lấy model gốc của rig).
- Weight skin do thuật toán gán theo 2 đoạn xương gần nhất, không phải weight do artist vẽ.
- Chưa hỗ trợ **chỉnh sửa xương** trong viewport (thêm/xoá/đổi cha bone, chỉnh rest pose) — hiện chỉ dựng nguyên bộ từ rig nguồn.
- Rig động vật chưa retarget được **sang** rig humanoid (chỉ phát được clip của chính họ trên nhân vật).
