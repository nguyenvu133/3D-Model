# Mixamo — kiểm thử + file FBX mẫu (cập nhật)

**Ngày:** 22/11/2026 · **Nội dung lỗi đọc từ ảnh bạn gửi (OCR):**

> **ERROR on mapping character: Unsupported FBX type. Please use FBX files 2013 or earlier.**

## Chẩn đoán

1. **Version không phải vấn đề**: 27 byte header của file tôi **giống hệt** file FBX Meshy mà Mixamo đã chấp nhận (đều là `Kaydara FBX Binary`, version 7400 = FBX 2013).
2. Lỗi “Unsupported FBX type” xảy ra ở bước **mapping** (sau khi upload đậu) → Mixamo gặp khó khi xử lý **skeleton tự tạo của tôi** trong quá trình auto-mapping joint.
3. Giải pháp chắc chắn nhất cho Mixamo: **upload MESH-ONLY** (không skeleton) — Mixamo tự auto-rig nhân vật từ mesh T/A-pose. Đây là cách Mixamo hoạt động chuẩn nhất và bỏ qua mọi vấn đề skeleton.

## File mẫu đã lưu (đều xuất từ nhân vật kiem hiep, đã qua FBXLoader kiểm chứng)

| File | Nội dung | Dùng khi nào |
|---|---|---|
| [kiemhiep-mesh-only.fbx](<docs/m2m-v10/kiemhiep-mesh-only.fbx>) (5,9 MB) | **Mesh thuần, không skeleton/skin** — Mixamo tự auto-rig | ⭐ **Thử trước, khả năng đậu cao nhất** |
| [kiemhiep-rigged.fbx](<docs/m2m-v10/kiemhiep-rigged.fbx>) (6,7 MB) | Có skeleton 23 bone + skin (Mixamo có thể dùng rig sẵn) | Nếu bạn muốn Mixamo giữ rig hiện có |

Kiểm chứng bằng `THREE.FBXLoader`:

| File | Bone | Skinned | Mesh | Size |
|---|---|---|---|---|
| mesh-only | 0 | 0 | 1 | 1,518 × 2 × 0,936 |
| rigged | 23 | 1 | 1 | 1,518 × 2 × 0,936 |

## Cách test trên Mixamo

1. Vào https://www.mixamo.com → **Characters** → **Upload Character**.
2. Chọn **kiemhiep-mesh-only.fbx** (bản mesh thuần).
3. Nếu đậu, Mixamo hiện khung auto-mapping → chọn vị trí khớp → Next → nhân vật có rig.
4. Nếu vẫn lỗi, chép **đúng câu lỗi mới** hoặc chụp ảnh bước mapping — tôi sẽ sửa tiếp.

## Đã thay đổi trong code

- [fbx-binary.js](<js/exporter/fbx-binary.js>):
  - Thêm `SceneInfo` (GlobalInfo) vào `FBXHeaderExtension` giống file Blender chuẩn.
  - Thêm option **`noSkeleton: true`** — xuất mesh-only (bỏ bone/skin/pose/armature), Mixamo tự rig.
  - Bỏ `NodeAttribute`/`Model`/`Deformer`/`Pose` khỏi `Definitions` khi noSkeleton; report phản ánh đúng.

## Nếu mesh-only vẫn lỗi mapping, các hướng tiếp theo (chờ thông tin từ bạn)

- Chụp màn hình bước Mapping để tôi thấy Mixamo đặt joint lệch chỗ nào.
- Kiểm tra mesh có lỗ (non-manifold) — Mixamo không rig được mesh hở.
- Định hướng: Mixamo muốn nhân vật đứng thẳng, mặt về +Z; tôi có thể thêm nút xoay model trước khi xuất.
