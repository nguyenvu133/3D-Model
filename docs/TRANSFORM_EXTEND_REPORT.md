# Báo cáo: mở rộng di chuyển object + kiểm thử lại trục Z trên web

**Ngày:** 22/11/2026 · **Server:** `http://127.0.0.1:8099`
**Kiểm thử trên web thật** (Playwright + Chrome), model mặc định [kiem hiep.glb](<assets/models/kiem hiep.glb>).

---

## 1. Kiểm thử trục Z trên web — kết quả

| Cách di chuyển | Kết quả | Chi tiết |
|---|---|---|
| Gizmo kéo trục Z | ✅ | Tìm thấy tay cầm Z, kéo chuột thật 96px → `delta Z = 0,799` |
| Ô nhập Z (Pos) | ✅ | Nhập 1.25 → `position.z = 1.25` |
| Nút nudge Z ▲ / Z ▼ | ✅ | `0 → 0.25 → 0` |
| Kéo object trực tiếp | ✅ (có axis-lock) | Kéo dọc đổi X+Z tùy góc camera; **nhấn X/Y/Z trong lúc kéo để khóa đúng 1 trục** |

## 2. Lỗi đã phát hiện và sửa trong quá trình kiểm thử

1. **`s.rotation.setComponent is not a function`** — ô nhập Rotation gọi API không tồn tại của `THREE.Euler` → **page error** khi gõ số. Đã sửa: gán trực tiếp `rotation.x/y/z` (quy đổi độ → rad). Sau sửa: nhập Z=45° → `rotation.z = 45°`, không còn lỗi.
2. **Kéo dọc không khóa trục được** — trước đây chỉ có Shift=trục Y, kéo dọc tùy camera đổi X+Z. Đã thêm **axis-lock X/Y/Z**: giữ chuột kéo rồi nhấn `X`/`Y`/`Z` để khóa trục (kiểu Blender/Tripo), mặt phẳng kéo được tính lại ngay khi nhấn phím, kèm badge `🔒 Trục X/Y/Z` hiển thị trong panel.

## 3. Mở rộng Object Transform (giống Tripo Generate workspace)

Panel **Camera & Scene** giờ có khối **OBJECT TRANSFORM** đầy đủ:

- **3 hàng nhập số**: `Pos` (X/Y/Z), `Rot°` (X/Y/Z theo độ), `Scale` (X/Y/Z) — thay vì chỉ có Pos như trước
- **World / Local** toggle cho gizmo (đổi hệ quy chiếu transform)
- **Nudge 6 hướng** (Y▲Y▼ Z▲Z▼ X▲X▼ bước 0,25)
- **Align 4 nút**: `Floor` (đặt xuống mặt lưới), `Cen X`, `Cen Z`, `Origin`
- **Snap** (bước 0,05–2), **Follow**, FOV, orbit speed, Focus/Frame all/Ortho/Reset view, Drop floor, Reset T/R/S, Duplicate, Delete, Select all, Clear — giữ nguyên

## 4. Kiểm chứng toàn bộ

| Hạng mục | Kết quả |
|---|---|
| Axis-lock Z khi kéo | ✅ chỉ Z đổi (`delta [0,0,1.451]`) |
| Axis-lock X khi kéo | ✅ chỉ X đổi (`[0.706,0,0]`) |
| Axis-lock Y khi kéo | ✅ chỉ Y đổi (`[0,-0.415,0]`) |
| Ô nhập Rot° (Z=45) | ✅ `rotation.z = 45°` |
| Ô nhập Scale (X=2) | ✅ `scale.x = 2` |
| World/Local toggle | ✅ `local → world → local` |
| Align Floor / Cen X / Cen Z | ✅ bbox min.y=0, center x/z=0 |
| Align Origin | ✅ x=z=0, y giữ trên floor |
| Page error | **0** |

## 5. File

- [interaction.js](<js/viewport/interaction.js>) — axis-lock, Rot/Scale inputs, World/Local, Align, badge trục
- [qa-zmove.mjs](<tools/qa-zmove.mjs>), [qa-transform-ext.mjs](<tools/qa-transform-ext.mjs>) — script kiểm thử
