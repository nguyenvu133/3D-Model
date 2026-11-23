/* ============================================================
 * core/version.js — Single source of truth cho phiên bản Studio
 *
 * Load TRƯỚC js/core/utils.js (xem index.html / mesh2motion.html).
 * utils.js giữ nguyên VERSION này thay vì ghi đè, để mọi nơi dùng
 * chung một số hiệu: console boot, About modal, FBX Creator,
 * Exporter, server banner. Trước v20.0, số hiệu nằm rải rác
 * (README v5.0, index v10.0, utils '10.0.0') nên không khớp nhau.
 * ============================================================ */
(function () {
  'use strict';

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.VERSION = '21.0.0';
  window.PixiStudio.VERSION_NAME = '21.0';
  window.PixiStudio.RELEASE = {
    version: '21.0.0',
    name: '21.0',
    codename: 'Smart Studio',
    date: '2026-11-23',
    previous: '20.1.0'
  };
  /* Có gì mới v20.0 — hiển thị 1 lần sau khi nâng cấp (xem App.boot). */
  window.PixiStudio.CHANGELOG_V20 = [
    'FBX Mixamo: xương, Cluster TransformLink và BindPose giờ đi theo xform (xoay / dịch / scale) — hết lệch skeleton so với mesh.',
    'FBX Mixamo: tự nhận trục dọc dài nhất — model Z-up / X-up từ GLB Tripo/Meshy không còn xuất ra nằm ngang.',
    'FBX Mixamo: sửa dấu xoay X-up (+90°) — trước đây nhân vật bị lộn ngược, đầu ở y=0.',
    'Mới: Mixamo Pre-flight — kiểm tra model trước khi xuất FBX (số tam giác, chiều cao, xương mixamorig, skin, texture) và cảnh báo ngay trong studio.',
    'Mới: hộp thoại “Có gì mới v20.0” hiện 1 lần sau khi nâng cấp.',
    'Phiên bản thống nhất 20.0.0 ở mọi nơi — trước đây chỗ v5.0, chỗ v10.0.',
    'FBX Binary Writer ghi Creator theo đúng phiên bản Studio đang chạy.',
    'PixiJS engine: studio CDN 7.3.2 → 7.4.3 (bản vá mới nhất dòng v7); game WUXIAMMORPG lên PixiJS 8.23.0.',
    'Mới: PixiJS Effects Engine — particle emitter (burst / lửa / phép / khói), vòng xung kích, chữ nổi 2D, flash màn hình.',
    'Chọn model giờ hiện tên nổi 2D tại vị trí click (PixiJS overlay) + sparkle dùng emitter mới.',
    'Tripo API v2 → v3 (v2 đã tắt 2026-10-31): endpoint mới openapi.tripo3d.ai/v3, model H3.1/P2, poll 2s, link model hết hạn sau 5 phút.',
    'Mới: Tripo Multi-view to 3D (2–4 ảnh), Convert FBX/USDZ/OBJ, Decimate, Smart UV, Segment, Mesh Repair.',
    'Tripo Rig đúng chuẩn docs: rig-check trước rồi mới rig (spec mixamo); Animate chỉ nhận model đã rig (preset:walk/idle/run).',
    'v20.1 — Meshy Animate: Motion Library kiểu Meshy — gộp AutoGen 10 + Presets 16 + FBX + M2M 326 clip, 5 category, search, bấm Add vào tab Added rồi phát lần lượt.',
    'v20.1: Prompt Engine Pro — 1 prompt thành timeline nhiều bước (chạy → chém ×2 → đứng nghỉ), style Heroic/Tired/Angry…, negative prompt, lưu preset prompt.',
    'v20.1: 4 clip AutoGen mới — Wave (vẫy tay), Punch (jab-cross), Kick, Bow (cúi chào); AutoGen giờ 10 clips.',
    'v20.1: Meshy API adapter — Rigging (5cr), Animations 1–10 preset (3cr/action), Text to Motion Prime 10cr / Swift 3cr, Library 631 preset, Balance; clip FBX cloud retarget thẳng lên rig.',
    'v20.1: Smart Rig — tự nhận diện humanoid/4 chân, Align (Rotate/Offset/Height mét), marker khớp cằm/vai/khuỷu/cổ tay/háng/gối/mắt cá, Symmetry, Re-rig, Rig QA báo cáo số.',
    'v20.1: Rig AutoGen thêm preset UE5 Mannequin (pelvis/spine_01…) + tùy chọn Fingers (+20 bone); skeleton.js thêm UE5 Mannequin và Unity Humanoid.',
    'v21.0 — Smart Studio: IK Solver hai xương (tay/chân chạm đúng điểm, pole điều hướng khuỷu/gối) + Foot Planting giữ bàn chân chạm đất.',
    'v21.0: Animation Blender — crossfade mượt A→B, mask blend (clip trên thân + clip dưới thân chạy cùng lúc), additive (vung tay trong lúc chạy).',
    'v21.0: Pose Library — lưu/khôi phục/nội suy tư thế xương (localStorage), pose mẫu T-Pose / A-Pose / Crouch.',
    'v21.0: Export Presets — 1 click xuất đúng chuẩn Mixamo / Unity / Unreal (Z-up) / Godot (GLB) / Roblox.',
    'v21.0: Auto-LOD local — giảm đa giác bằng vertex clustering, sinh LOD0/1/2 ngay trong trình duyệt, không cần cloud.',
    'v21.0: Turntable — xoay model 360° chụp từng khung hình làm thumbnail/preview.',
    'v21.0: Character Controller — điều khiển nhân vật đã rig đi thử bằng WASD (Shift chạy, Space nhảy), tự đổi clip Idle/Walk/Run.',
    'v21.0: Scene Director — 1 click dựng sân khấu: snap mặt đất + xếp hàng/vòng/lưới + frame camera vừa khung.',
    'v21.0: Undo/Redo giờ khôi phục cả tư thế xương (pose snapshot); Perf monitor thêm ngân sách tris/draw call/FPS và cảnh báo.'
  ];
})();
