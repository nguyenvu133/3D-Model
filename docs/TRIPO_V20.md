# Tripo Studio × PixiJS Studio — v20.0 (2026-11-22)

Tài liệu này ghi lại: (1) studio.tripo3d.ai có gì, (2) adapter local đã
chuyển sang Tripo OpenAPI v3 như thế nào, (3) cái gì cần key/tiền, (4) cái
gì Tripo **không** có nên studio local tự làm.

Nguồn: developers.tripo3d.ai (Quick Start, API Reference), tripo3d.ai
(pricing), kiểm chứng ngày 2026-11-22. Tripo đổi model/giá thường xuyên —
kiểm tra lại docs chính thức trước khi nạp tiền lớn.

## 1. Tripo AI Studio (web) có gì

| Tính năng Studio | Studio local đã có / làm gì với nó |
|---|---|
| Text to 3D (H3.1/H3.0/H2.5, P2/P1 game-ready) | Có — `Tripo.textTo3D()` qua API v3, chọn model trong AI Tools |
| Image to 3D (1 ảnh) | Có — `Tripo.imageTo3D()`, upload qua `POST /v3/files` → `file_token` |
| Multi-view to 3D (2–4 ảnh, front bắt buộc) | **Mới v20.0** — `Tripo.multiviewTo3D()`, nút “Multi-view → 3D” trong AI Tools |
| Sketch to 3D | Chưa — Studio web có, API v3 không có endpoint riêng (dùng image-to-model với ảnh sketch) |
| AI Image Generator (ảnh tham chiếu) | Chưa — API có `text-to-image` nhưng adapter chưa nối (xem §5) |
| Segmentation / Auto Split | **Mới v20.0** — `Tripo.segmentModel()` → `POST /v3/mesh/segment` |
| Smart Mesh / Retopology (P2 quad, P1 low-poly) | Một phần — `Tripo.decimateModel()` → `POST /v3/mesh/decimate`; P-series chọn ở lúc generate |
| Smart UV | **Mới v20.0** — `Tripo.uvModel()` → `POST /v3/mesh/uv` |
| AI Texturing / PBR (4K, Magic Brush, 8K Max) | Có — `Tripo.textureModel()` → `POST /v3/models/texture` |
| Rig & Animate (7 loại rig, 100+ preset) | Có, đúng chuẩn docs — rig-check → rig (`spec: mixamo`) → retarget `preset:*` |
| Stylize (cartoon/sketch/hologram) | Studio web có; **API đã bỏ (retired)** — không nối được |
| Model library / gallery công khai | Chưa — chỉ có trong web Studio, API không có endpoint gallery |
| DCC Bridge (Blender/Unity/Unreal/Maya…) | Thay bằng Convert FBX/USDZ/OBJ + export FBX Mixamo của studio |
| Export GLB/FBX/OBJ/USDZ/STL/3MF | **Mới v20.0** — `Tripo.convertModel('FBX'|'USDZ'|...)` → `POST /v3/models/convert` |
| Batch generation (Pro 10, Max 30) | Có sẵn — batch 1/2/4 task trong AI Tools |
| Agentic Canvas | Chỉ gói Max, early access — không có API |

**Tripo KHÔNG có:** PixiJS/2D game layer, timeline animation, bone editor,
gizmo, Mesh2Motion — đó là tính năng riêng của studio local, không “port”
từ Tripo được; Tripo chỉ cung cấp model/rig/animation đã sinh sẵn.

## 2. Migration API v2 → v3 (bắt buộc)

Tripo tắt API v2 ngày **2026-10-31**. Adapter cũ
(`https://api.tripo3d.ai/v2/openapi`, `POST /task/create`,
`model_version: v1.4-20230925 / v2.0-20240219`) không còn chạy.

| | v2 (cũ, đã chết) | v3 (mới, v20.0) |
|---|---|---|
| Base URL | `https://api.tripo3d.ai/v2/openapi` | `https://openapi.tripo3d.ai/v3` |
| Tạo task | `POST /task/create` `{type: 'text_to_model'}` | `POST /v3/generation/text-to-model` `{prompt, model}` |
| Ảnh | `POST /upload` → `image_token` | `POST /v3/files` (multipart) → `file_token` |
| Poll | `GET /task/{id}` mỗi 3s | `GET /v3/tasks/{id}` mỗi **2s** (≤1 req/s), tối đa ~10 phút |
| Kết quả | `output.pbr_model / model / url` | `output.model_url` (+ `model_urls` cho retarget) |
| Model | `v1.4`, `v2.0` | `v3.1-20260211` (khuyên dùng), `v3.0-20250812`, `v2.5-20250123`, `P2-20260801`, `P1-20260311` |
| Post-process | `original_model_id` | `input: <task_id>` (chuỗi task) |
| Rig | `rig_model` | `rig-check` → `rig` (`model: v3.0-20260909`, `spec: 'mixamo'`) |
| Animate | `animate_model` | `retarget` (`animations: ['preset:walk', ...]`, `out_format`) |
| Upscale | `upscale_model` | **Đã bỏ ở v3** — thay bằng Decimate (`/v3/mesh/decimate`) |

## 3. Luồng chạy thật (v3)

1. Tạo task → nhận `task_id` ngay.
2. Poll `GET /v3/tasks/{task_id}` mỗi 2s → `status: "success"`.
3. **Tải ngay** `output.model_url` — link hết hạn sau **5 phút**.
   Adapter tự tải GLB và import vào viewport; file không phải GLB
   (vd Convert FBX) thì không tự import, tải tay trong Generation Queue.
4. Post-processing nối chuỗi bằng task_id: generation → texture/convert/
   decimate/uv/segment → rig-check → rig → retarget. Mỗi bước ra task_id
   mới, `Tripo.lastCreatedModelId` trỏ tới task mới nhất.
5. Response báo `consumed_credit` — adapter hiện trong thông báo task.

## 4. Key, tiền, giới hạn — nói thẳng

- **Cần API key Tripo** (tạo ở `platform.tripo3d.ai/api-keys`, chỉ hiện 1 lần).
  Key nhập trong AI Tools → Backend Settings, lưu ở localStorage của
  trình duyệt, không hardcode, không nằm trong project file.
- **API trả theo dùng, 1 credit = $0.01.** Thử: **300 credit / 2 tuần**.
  Ví dụ: text-to-3D H3 có texture ~20 credit ($0.20), image-to-3D ~30,
  rig 25, retarget 10/animation. Chuỗi mẫu image→rig→retarget ≈ 165 credit.
- **Ví Studio và ví API là riêng** — gói Studio (Free 200 credit/tháng…)
  không trả cho API.
- **Free Studio**: model công khai, phi thương mại, export H2.5.
- Chưa có key ⇒ mọi nút generate ở trạng thái `blocked`, không giả lập.
- Key **không bao giờ** được đẩy lên repo hay gửi kèm code.

## 5. Chưa làm (để v20.1+)

- `text-to-image` / `image-to-image` làm ảnh tham chiếu (API có, adapter chưa nối).
- `image-to-multiview` (sinh 4 góc từ 1 ảnh rồi multiview-to-model).
- `image-to-splat` (3D Gaussian splat), `mesh/complete` đã nối (Mesh Repair).
- Webhook thay cho polling.
- Proxy key qua `server.js` để key không nằm ở client (hiện tại key ở
  localStorage trình duyệt — chấp nhận được cho dùng cá nhân, không dùng
  cho deploy công khai).

## 6. Kiểm thử

`node /tmp/test-fbx/test-tripo-v3.js` (fetch giả lập): 50+ assert đạt —
endpoint/payload v3 đúng docs, upload → file_token, multiview inputs
front/left, rig-check → rig (spec mixamo), retarget `preset:*`, chặn
animate khi chưa rig, lỗi code v3 → failed, poll failed → failed, không
còn request v2 nào. **Chưa test với key thật** — cần key Tripo của người
dùng để chạy 1 task thật (tốn ~20 credit).
