# Chuẩn Nhân Vật (Standard Character) — v1

File mẫu (golden): `thieulam-Rigged-FixedAxes-LowPoly-Grounded.fbx`
(7.337.772 byte, md5 `51814488a0906ba8666b070ed6583407`).
Mọi nhân vật khác làm theo đúng chuẩn này thì dùng được ngay trong
studio, Mixamo, Blender, Unity mà không phải sửa lại.

## 1. Thông số chuẩn (đo từ file mẫu)

| Hạng mục | Chuẩn | File mẫu |
|---|---|---|
| Định dạng | Binary FBX 7300 (FBX 2013) | 7300 |
| Trục đứng | Y-up, chân ở y = 0 | Y-up, y = 0 |
| Đơn vị | cm (UnitScaleFactor 100) | 100 |
| Mesh | 1 SkinnedMesh, có UV + normal | 1 mesh |
| Số tris | ≤ 16.000 (tỉ lệ ~0,32 so với gốc ~47k) | 14.932 |
| Xương | Khung Mixamo 41 xương, tên `mixamorig*` | 41 xương |
| Skin | trọng số chuẩn hoá, tổng = 1.0 | tổng 1.0 |
| Animation | ≥ 1 clip, **chân chạm đất** (minSole trong [−0,02, +0,02] m) | 1 clip, đã ground |
| Texture | map JPEG + normalMap PNG nhúng trong file, có thuộc tính Path | 2 ảnh |
| Pivot | gốc toạ độ ở mặt đất, giữa 2 chân | y = 0 |
| Tên object | kiểu binary `Name\x00\x01Class` (chuẩn Blender) | binary |

Lưu ý: file mẫu còn 325 tam giác suy biến (2,2%) do Blender Decimate
tạo ra — chấp nhận được, không ảnh hưởng rig/animation.

## 2. Cách làm ra file chuẩn (công thức)

Đầu vào: 1 file FBX đã rig (tốt nhất là file Mixamo trả về sau khi
auto-rig, hoặc file rig tay có đủ xương + clip).

1. **Sửa trục** — nếu file gốc dựng theo trục Z (Blender xuất, nằm ngửa),
   xoay Rx(+90°) để đứng lên theo trục Y. Chỉ xoay hình học + xương,
   không đụng tới clip.
2. **Ground animation** — với mỗi clip, chỉnh track Hips Y theo từng key
   sao cho bàn chân thấp nhất chạm đất (minSole ≈ 0). Chỉ đổi Hips Y,
   không đổi các xương khác, clip không mất key nào.
3. **Low-poly** — Blender Decimate CHỈ hình học (tỉ lệ ~0,32), rồi
   gắn lại xương + clip + texture NGUYÊN VẸN từ file đã ground
   (hybrid): skinIndex remap theo TÊN xương, trọng số chuẩn hoá về
   tổng 1.0. Không dùng file Blender xuất trực tiếp vì nó làm hỏng clip.
4. **Xuất** — FBX Binary 7300, Y-up, nhúng map JPEG + normalMap PNG
   (kèm thuộc tính Path để FBX SDK tìm được ảnh).

## 3. Dùng mẫu cho nhân vật khác

Chạy script chuẩn (đã tổng quát hoá từ pipeline Thiếu Lâm):

```bash
NODE_PATH=/home/hatch/workspace/.test-fbx/node_modules:/home/hatch/workspace/.test-thandieu/node_modules \
  node ~/workspace/.test-fbx/convert-standard-character.js \
  --input <nhan-vat-da-rig.fbx> --out <ten-nhan-vat> [--ratio 0.32]
```

- `--input`: file FBX đã rig (có xương + clip).
- `--out`: tên nhân vật, file ra là `<ten>-Standard.fbx`.
- `--ratio`: tỉ lệ Decimate (mặc định 0,32). Nhân vật nhiều chi tiết
  thì để 0,35–0,40; nhân vật đơn giản thì 0,25–0,30.
- `--no-ground`: bỏ qua bước ground (khi clip đã chạm đất sẵn).
- `--no-lowpoly`: bỏ qua bước low-poly (giữ nguyên tris gốc).

Kiểm tra file ra bằng:

```bash
NODE_PATH=/home/hatch/workspace/.test-fbx/node_modules:/home/hatch/workspace/.test-thandieu/node_modules \
  node ~/workspace/.test-fbx/test-standard-character.js <ten>-Standard.fbx
```

File đạt chuẩn khi: FBX 7300, 1 SkinnedMesh, ≥ 20 xương, ≥ 1 clip,
chân chạm đất, tris ≤ 16.000 (nếu low-poly), 2 texture, SDK đọc được
1 mesh / 1 skin / 2 ảnh.

## 4. Từ mesh trần (GLB) tới file chuẩn

Nếu nhân vật mới chỉ có mesh trần (file .glb, chưa rig):

1. Nút **GLB → FBX** trong studio (hoặc Save Mixamo) → file mesh-only
   FBX 7300, đúng công thức Mixamo.
2. Upload file đó lên mixamo.com → auto-rig → tải file đã rig về.
3. Chạy script chuẩn ở mục 3 với file đã rig đó.

## 5. Lịch sử

- v1 (2026-11-26): chuẩn hoá từ file Thiếu Lâm LowPoly-Grounded
  (pipeline: FixedAxes → Grounded → LowPoly-Grounded, harness 30/30).
