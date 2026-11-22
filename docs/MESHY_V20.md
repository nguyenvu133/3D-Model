# Meshy Animate — v20.1 “Meshy Animate” (2026-11-22)

Studio mở rộng theo **Meshy workspace Animate** (`meshy.ai/vi/workspace?sidebar=animate`)
và **Meshy Rigging / Text to Motion API**. Nghiên cứu đầy đủ: `/tmp/meshy-research.md`
(docs.meshy.ai, trang tính năng, help center — workspace thật cần login nên không xem
trực tiếp được; giá gói webapp mâu thuẫn giữa các nguồn, chỉ giá API là chắc chắn).

## 1. Meshy làm gì (đã kiểm chứng từ docs chính thức)

| Tính năng Meshy | Mô tả |
|---|---|
| Animate tab | Không gian riêng để rig + gắn motion, preview trong viewer trình duyệt. |
| Library (631 preset) | 5 category: Walk & Run, Daily Actions, Dancing, Fighting, Body Movements. Search theo tên, bấm Add là áp. 22 animation miễn phí mọi gói. |
| Added tab | Motion đã thêm vào nhân vật; download Current hoặc All Added. |
| Text to Motion | Prompt ≤400 ký tự → clip motion (2–10s, bước 0.5). Prime 10 credits (FBX), Swift 3 credits (BVH). Chỉ biped đã rig. |
| Rig Model dialog | Chọn Character Type → Align (Rotate/Offset/Height) → đặt marker khớp (cằm/vai/khuỷu/cổ tay/háng/gối/mắt cá, Symmetry mirror) → Confirm. |
| Humanoid / Quadruped Dog / Smart Rig (Beta) | Humanoid kèm walk + run; 4 chân chỉ có walk; Smart Rig tự động không marker, không dùng library, chỉ tải GLB. |
| Bone overlay | Bật/tắt xem skeleton trong viewer. |
| Skeleton template (download) | Mixamo (mặc định), UE5, Unity Humanoid, Maya HumanIK, Blender Rigify, 3ds Max Biped, CC5, DAZ Genesis 9, meshyrig (24 xương). |
| include_fingers | Thêm xương ngón tay (tên kiểu Mixamo, vd `LeftHandThumb1`). |
| Rigging API | `POST /openapi/v1/rigging` — 5 credits. GLB có texture, mặt +Z, ≤380k tris. |
| Animation API | `POST /openapi/v1/animations` — 3 credits/action, tối đa 10 action/request. |
| Text to Motion API | `POST /openapi/v1/text-to-motion` — Prime 10 / Swift 3 credits. |
| Library API | `GET /openapi/v1/animations/library` — JSON toàn bộ preset + GIF preview. |
| Balance API | `GET /openapi/v1/balance`. |

**Giới hạn Meshy (docs chính thức):** preset + Text to Motion chỉ cho humanoid; 4 chân chỉ
có walk. Rig tay (xương mặt, vật lý đuôi) và animation điện ảnh chi tiết vẫn cần
Blender/Maya. File kết quả API hết hạn sau ~3 ngày. Free plan gọi API → 402.

## 2. Feature map: Meshy → studio local (v20.1)

| Meshy | Studio v20.1 | Ghi chú |
|---|---|---|
| Library 631 preset / 5 category / search / Add | ✅ `js/animation/motion-library.js` — gộp AutoGen 10 + Presets 16 + FBX + M2M 326 clip, đúng 5 category Meshy, search, + Add | Số lượng là clip local thật, không phải 631 clip Meshy |
| Added tab | ✅ `js/animation/anim-queue.js` — queue Add/Play All/Stop/Clear, phát lần lượt có crossfade, tổng thời lượng | Export All Added dùng Anim GLB Export sẵn có |
| Text to Motion (cloud) | ✅ `js/ai/meshy-adapter.js` — prompt ≤400 ký tự, duration 2–10s bước 0.5, Prime/Swift, poll task, clip FBX retarget lên rig | Cần API key `msy_…` (gói trả phí); không key → `blocked` |
| Text to Motion (local, không key) | ✅ `js/animation/anim-prompt.js` — Prompt Pro: 1 prompt → timeline nhiều bước, style, negative, lưu preset | Map sang clip thật có sẵn; bước chưa có clip báo rõ, không bịa |
| Rig Model dialog (Type/Align/Markers) | ✅ `js/rigging/rig-auto-gen.js` — Smart Rig Setup: type, Rotate/Offset/Height, marker % chiều cao, Symmetry, Re-rig | Marker nhập số (chưa kéo trực tiếp trên viewport 3D) |
| Smart Rig (Beta) | ✅ `RigAutoGen.smartRig()` — đo bbox, tự nhận diện humanoid/4 chân, 4 chân dùng CreatureRigs (fox/horse/kaiju) | Creature local, không phải model cloud của Meshy |
| Quadruped Dog | ✅ Có sẵn: CreatureRigs (fox/horse/dragon/bird/snake/shark/spider/kaiju) + M2M motion theo họ | |
| Bone overlay | ✅ Có sẵn: Ẩn/Hiện rig + SkeletonHelper | |
| Skeleton template | ✅ AutoGen: Studio / Mixamo / **UE5 Mannequin** mới; `skeleton.js` thêm **UE5 Mannequin + Unity Humanoid** | Chưa có Maya HumanIK / Blender Rigify / CC5 / DAZ |
| include_fingers | ✅ AutoGen `opts.fingers` — 5 ngón × 2 đoạn / tay (+20 bone), tên kiểu Mixamo | |
| Basic animations kèm rig | ✅ Có sẵn: AutoGen sinh clip ngay sau rig (giờ 10 clips) | |
| Rig QA | ✅ Mới: `RigAutoGen.qaReport()` — bone count, symmetry, rig height, skin coverage | Meshy webapp không có QA số — đây là tính năng local thêm |
| Re-rig | ✅ Mới: `RigAutoGen.reRig()` — rig lại với cùng opts | |

## 3. Cách dùng

### Motion Library (Animation panel)
- Search motion hoặc lọc 5 category → ▶ phát ngay, + Add đưa vào Added.
- Added: ▶ Play All phát lần lượt, ⏹ Stop, 🗑 Clear. Tổng thời lượng hiện bên dưới.

### Prompt Engine Pro (Animate Studio → AI Animation)
- Nhập prompt, ví dụ chính thức của Meshy: `a character waving`,
  `a boxer throws a jab-cross combo`, `jumps over a gap and lands in a crouch`.
- Timeline preview hiện ngay khi gõ: `Run 0.7s → Attack 0.8s ×2 → Idle 2.6s`.
- Duration tổng (0 = tự nhiên), Style (Heroic/Tired/Angry/Happy/Slow/Fast/Sneaky),
  Negative prompt (vd `jumping` sẽ bỏ bước Jump).
- ▶ Generate / Play Timeline phát qua queue; + Add to Added để phát sau;
  💾 Save Preset lưu prompt dùng lại.

### Smart Rig (Rig panel → Smart Rig Setup)
1. Character Type: Smart Rig (tự nhận diện) / Humanoid / Quadruped Dog.
2. Align: Rotate (0/90/180/270), Height (m), Offset X/Z → Align.
3. Markers: nhập % chiều cao cho Cằm/Vai/Khuỷu/Cổ tay/Háng/Gối/Mắt cá
   (mặc định = tỉ lệ rig cũ, không đổi). Symmetry mirror 2 bên (mặc định bật).
   Fingers: thêm ngón tay.
4. 🤖 Smart Rig → rig theo type; 🔁 Re-rig rig lại cùng thông số;
   🧪 Rig QA in báo cáo kiểm tra.

### Meshy Cloud (Animate Studio → Meshy Cloud)
1. Lấy API key tại Meshy account settings (key `msy_…`). Cần gói Meshy trả phí
   mới gọi được API (Free → 402).
2. Dán key → Connect. Balance xem số dư credit.
3. Nhập prompt (≤400 ký tự), chọn Prime (10cr, FBX) / Swift (3cr, BVH),
   duration 2–10s → ☁️ Generate. Task poll mỗi 3s; xong clip FBX được
   retarget thẳng lên rig hiện tại (cần FBXLoader). File hết hạn ~3 ngày —
   tải ngay nếu muốn giữ.
4. Rigging/Animation cloud: dùng `PixiStudio.Meshy.rigModel()` /
   `PixiStudio.Meshy.applyAnimation()` từ console hoặc code (UI chi tiết
   sẽ bổ sung khi có key thật để test).

## 4. Chưa làm được / cần key thật để test

- **Chưa test với key Meshy thật** — mọi endpoint cloud (rigging, animations,
  text-to-motion, library, balance) mới chỉ test bằng mock fetch trong Node.
  Cần key của bạn để chạy thử thật và kiểm tra tên field kết quả
  (`rigged_character_fbx_url`, `fbx_url`…) — adapter quét mọi field `*_url`
  nên phần lớn trường hợp vẫn lấy được file.
- Marker chưa kéo trực tiếp trên viewport 3D (cần gizmo drag) — hiện nhập số %.
- Chưa có skeleton template Maya HumanIK / Blender Rigify / CC5 / DAZ Genesis 9.
- Text to Motion local không sinh chuyển động mới — chỉ ghép clip thật có sẵn.
  Muốn sinh motion mới thật sự, dùng Meshy Cloud (cần key + credits).

## 5. Test

`node /tmp/test-fbx/test-meshy.js` — prompt parser (EN+VI, multi-action, repeats,
negative, duration, style), queue, adapter mock (blocked, validation, poll
success/failed, library, balance), Smart Rig (detect/align/markers/fingers/UE5/QA),
Motion Library (collect/filter), M2M playClip, 10 clip AutoGen validate.
Chạy lại: `node /tmp/test-fbx/test-rig-anim.js` (80 tests cũ).
