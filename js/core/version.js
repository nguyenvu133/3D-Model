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
  window.PixiStudio.VERSION = '20.0.0';
  window.PixiStudio.VERSION_NAME = '20.0';
  window.PixiStudio.RELEASE = {
    version: '20.0.0',
    name: '20.0',
    codename: 'Mixamo Ready',
    date: '2026-11-22',
    previous: '10.0.0'
  };
  /* Có gì mới v20.0 — hiển thị 1 lần sau khi nâng cấp (xem App.boot). */
  window.PixiStudio.CHANGELOG_V20 = [
    'FBX Mixamo: xương, Cluster TransformLink và BindPose giờ đi theo xform (xoay / dịch / scale) — hết lệch skeleton so với mesh.',
    'FBX Mixamo: tự nhận trục dọc dài nhất — model Z-up / X-up từ GLB Tripo/Meshy không còn xuất ra nằm ngang.',
    'FBX Mixamo: sửa dấu xoay X-up (+90°) — trước đây nhân vật bị lộn ngược, đầu ở y=0.',
    'Mới: Mixamo Pre-flight — kiểm tra model trước khi xuất FBX (số tam giác, chiều cao, xương mixamorig, skin, texture) và cảnh báo ngay trong studio.',
    'Mới: hộp thoại “Có gì mới v20.0” hiện 1 lần sau khi nâng cấp.',
    'Phiên bản thống nhất 20.0.0 ở mọi nơi — trước đây chỗ v5.0, chỗ v10.0.',
    'FBX Binary Writer ghi Creator theo đúng phiên bản Studio đang chạy.'
  ];
})();
